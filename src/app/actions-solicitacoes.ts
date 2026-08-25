'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirAprovador, exigirPlanejamento, type Sessao } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { avisarConviteDeTroca } from '@/lib/avisos';
import { voltar, rotaComErro } from '@/lib/volta';
import { getGeracaoAtual } from '@/lib/data/escalas';
import { mensagemErroBanco } from '@/lib/erros-banco';
import { addDias, diffDias, dowDeIso, fimDoTurno, formatarData, iso, partesIso } from '@/lib/domain/escalas/datas';
import { GRUPOS_AUSENCIA, GRUPO_DO_TIPO, OPCOES_FERIAS, TIPOS_COM_EFEITO_NA_ESCALA, TIPOS_COM_PERIODO, TIPOS_OCORRENCIA, TIPOS_SOLICITACAO, type TipoOcorrencia, type TipoSolicitacao } from '@/lib/domain/escalas/constantes';
import type { Modalidade } from '@/lib/domain/escalas/tipos';

const VOLTA = '/solicitacoes';

/** "17:30" → 1050. Comparar horário como texto só funciona com zero à esquerda. */
const emMinutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function erro(rota: string, msg: string): never {
  redirect(rotaComErro(rota, msg));
}

async function registrarEvento(
  sessao: Sessao,
  solicitacaoId: number,
  etapa: string,
  detalhe = ''
) {
  const supabase = await createClient();
  await supabase.from('solicitacao_eventos').insert({
    conta_id: sessao.conta.id,
    solicitacao_id: solicitacaoId,
    etapa,
    detalhe,
    por_id: sessao.usuario.id,
    por_nome: sessao.usuario.nome,
  });
}

/* ============================================================
   ABERTURA
   ============================================================ */

export async function abrirSolicitacao(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? '/minha-escala');

  const tipo = String(formData.get('tipo') ?? '') as TipoSolicitacao;
  if (!TIPOS_SOLICITACAO[tipo]) erro(volta, 'Tipo de solicitação inválido.');

  const data = String(formData.get('data') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erro(volta, 'Informe a data de referência.');

  // Férias, folga e licença cobrem período; o banco recusa data_fim nos demais.
  const dataFimBruta = String(formData.get('dataFim') ?? '').trim();
  const aceitaPeriodo = TIPOS_COM_PERIODO.includes(tipo);
  if (dataFimBruta && !aceitaPeriodo) erro(volta, 'Esse tipo de solicitação vale para um dia só.');
  if (tipo === 'FERIAS' && !dataFimBruta) erro(volta, 'Informe a data final das férias.');
  if (tipo === 'LICENCA' && !dataFimBruta) erro(volta, 'Informe a data final da licença.');
  if (dataFimBruta && !/^\d{4}-\d{2}-\d{2}$/.test(dataFimBruta)) erro(volta, 'Data final inválida.');
  if (dataFimBruta && dataFimBruta < data) erro(volta, 'O fim do período não pode ser anterior ao início.');
  const dataFim = aceitaPeriodo && dataFimBruta ? dataFimBruta : null;
  if (dataFim && diffDias(data, dataFim) + 1 > 365) erro(volta, 'O período não pode passar de 365 dias.');

  const detalhe = String(formData.get('detalhe') ?? '').trim();
  if (detalhe.length < 5) erro(volta, 'Descreva a justificativa da solicitação.');

  // A pessoa abre para si; Planejamento pode abrir em nome de alguém.
  const alvoBruto = Number(formData.get('colaboradorId') ?? 0);
  const colaboradorId = sessao.papel === 'planejamento' && alvoBruto ? alvoBruto : sessao.colaboradorId;
  if (!colaboradorId) erro(volta, 'Seu usuário não está vinculado a um colaborador da escala.');

  const supabase = await createClient();

  // Mês encerrado não recebe mais pedido — o registro histórico está fechado.
  const [ano, mes] = partesIso(data);
  const geracao = await getGeracaoAtual(iso(ano, mes, 1));
  if (geracao?.status === 'encerrada') erro(volta, 'O mês dessa data já foi encerrado e não aceita novas solicitações.');

  let unidadeDesejadaId: number | null = null;
  if (tipo === 'TROCA_UNIDADE') {
    unidadeDesejadaId = Number(formData.get('unidadeDesejadaId') ?? 0) || null;
    if (!unidadeDesejadaId) erro(volta, 'Selecione a unidade desejada.');
  }

  // Opção de férias: define o parcelamento e quantos dias de abono. O fim já
  // vem calculado da tela, mas a opção é conferida aqui — a tela é palpite,
  // o servidor é decisão.
  let opcaoFerias: string | null = null;
  let lancadoFiori: boolean | null = null;
  if (tipo === 'FERIAS') {
    const escolha = String(formData.get('opcaoFerias') ?? '');
    if (!OPCOES_FERIAS.some(o => o.chave === escolha)) erro(volta, 'Escolha a opção de férias.');
    opcaoFerias = escolha;
    lancadoFiori = formData.get('lancadoFiori') === '1';
  }

  // Folga e licença tiram o motivo da mesma lista que o Planejamento usa ao
  // lançar a ausência — assim o pedido aprovado vira ausência sem retrabalho.
  let motivo: string | null = null;
  const grupo = GRUPO_DO_TIPO[tipo];
  if (grupo) {
    const escolhido = String(formData.get('motivo') ?? '').trim();
    const permitidos = GRUPOS_AUSENCIA.find(g => g.grupo === grupo)?.motivos ?? [];
    if (!permitidos.includes(escolhido)) erro(volta, `Selecione o motivo da ${grupo.toLowerCase()}.`);
    motivo = escolhido;
  }

  // Troca de plantão com um colega nomeado passa PRIMEIRO por ele.
  //
  // A máquina de estados já previa este caminho (`AGUARDA_PARCEIRO` →
  // `TRIAGEM`), mas a abertura fixava triagem e parceiro nulo — não havia como
  // escolher alguém, porque o colaborador não enxergava a própria equipe. Com
  // a 0026 ele passou a enxergar, e o caminho previsto pode enfim ser usado.
  //
  // O parceiro segue OPCIONAL. Quem já combinou a troca nomeia o colega, e o
  // pedido vai a ele — ninguém é trocado sem saber. Quem só precisa sair
  // daquele dia e não tem par deixa em branco, e o pedido vai direto à
  // triagem, como antes: exigir um nome obrigaria a inventar um antes de saber
  // se a troca é possível.
  let parceiroId: number | null = null;
  if (tipo === 'TROCA_HORARIO') {
    const escolhido = Number(formData.get('parceiroId') ?? 0) || null;
    if (escolhido) {
      if (escolhido === colaboradorId) erro(volta, 'A troca precisa ser com outra pessoa.');

      // A conferência é feita pelo client sob RLS, e por isso ela É a
      // validação: depois da 0026 esta leitura só devolve colega ATIVO da
      // própria equipe. Um id forjado de outra equipe — ou de outra área — não
      // traz linha nenhuma.
      const { data: colega } = await supabase
        .from('colaboradores')
        .select('id')
        .eq('id', escolhido)
        .eq('status', 'ativo')
        .maybeSingle();
      if (!colega) erro(volta, 'Escolha um colega ativo da sua equipe para a troca.');
      parceiroId = escolhido;
    }
  }

  // Quem abriu decide o caminho.
  //
  // Aberto pelo Planejamento EM NOME de alguém, o pedido pula a triagem: quem
  // triaria é justamente quem abriu, e mandá-lo para a própria caixa seria
  // pedir que ele aprovasse a própria decisão. Vai direto ao gestor, e volta
  // depois para implantação — ver `decidirSolicitacao`.
  //
  // A troca com parceiro nomeado continua vindo antes de tudo: nada anda antes
  // de o colega aceitar, independentemente de quem abriu.
  const peloPlanejamento = sessao.papel === 'planejamento' && colaboradorId !== sessao.colaboradorId;

  // Existe, é desta conta e tem gestor?
  //
  // A leitura é feita pelo client sob RLS, então ela É a validação da conta: um
  // id de outra área não traz linha nenhuma. A equipe importa por outro motivo
  // — a caixa do gestor é recortada pela equipe dele, e um pedido de alguém sem
  // equipe mandado para `GESTOR` não apareceria para gestor nenhum. Nesse caso
  // ele fica na triagem do próprio Planejamento, que pode aprovar direto.
  let temGestor = false;
  if (peloPlanejamento) {
    const { data: alvo } = await supabase
      .from('colaboradores')
      .select('id, equipe_id, status')
      .eq('id', colaboradorId)
      .maybeSingle();
    if (!alvo) erro(volta, 'Colaborador não encontrado nesta área.');
    if (alvo.status !== 'ativo') erro(volta, 'Esse colaborador não está ativo.');
    temGestor = alvo.equipe_id !== null;
  }

  const status = parceiroId
    ? 'AGUARDA_PARCEIRO'
    : peloPlanejamento && temGestor ? 'GESTOR' : 'TRIAGEM';

  const { data: nova, error } = await supabase
    .from('solicitacoes')
    .insert({
      conta_id: sessao.conta.id,
      colaborador_id: colaboradorId,
      tipo,
      data,
      data_fim: dataFim,
      detalhe,
      parceiro_id: parceiroId,
      aceite_parceiro: null,
      // Só vai quando é verdade.
      //
      // Mandar `false` explicitamente não acrescenta nada — é o padrão da
      // coluna — e custa caro numa instalação que ainda não rodou a 0027: o
      // PostgREST recusa a linha inteira por causa de uma coluna que só
      // interessa ao Planejamento, e quem não consegue abrir pedido nenhum é o
      // COLABORADOR. Omitindo, o caminho dele volta a funcionar em qualquer
      // banco, e só o fluxo que depende da coluna precisa dela.
      ...(peloPlanejamento ? { aberta_pelo_planejamento: true } : {}),
      unidade_desejada_id: unidadeDesejadaId,
      opcao_ferias: opcaoFerias,
      lancado_fiori: lancadoFiori,
      motivo,
      status,
    })
    .select('id')
    .single();

  // A mensagem diz O QUE falhou. "Não foi possível abrir a solicitação" era
  // verdadeira e inútil: mandava procurar em toda parte um erro que o banco
  // tinha acabado de descrever com precisão — coluna faltando, migration não
  // aplicada, chave estrangeira fora da conta. `mensagemErroBanco` traduz e diz
  // qual arquivo rodar.
  if (error || !nova) {
    erro(volta, error
      ? `Não foi possível abrir a solicitação: ${mensagemErroBanco(error)}`
      : 'Não foi possível abrir a solicitação.');
  }

  await registrarEvento(sessao, nova.id, 'Aberta', `${TIPOS_SOLICITACAO[tipo].label} para ${formatarData(data)}`);
  await registrarLog(sessao, 'Solicitação aberta', `#${nova.id} · ${TIPOS_SOLICITACAO[tipo].label} · ${formatarData(data)}`);

  // O convite só serve se o convidado souber dele: o pedido fica parado em
  // `AGUARDA_PARCEIRO` até ele responder, e o prazo corre nesse meio-tempo.
  if (parceiroId) await avisarConviteDeTroca(sessao, { parceiroId, data });

  revalidatePath('/', 'layout');
  // Quem abre para si sabe o que pediu; quem abre por outro precisa saber para
  // onde o pedido foi, porque o caminho não é o mesmo — e o cartão que ele vai
  // procurar na lista está no nome de outra pessoa.
  voltar(volta, formData, peloPlanejamento
    ? {
        abrir: '',
        ok: temGestor
          ? `Solicitação aberta e enviada ao gestor. Aprovada, ela volta para você implantar.`
          : `Solicitação aberta. Esse colaborador não tem equipe, então o pedido ficou na sua triagem.`,
      }
    : {});
}

/* ============================================================
   FLUXO DE APROVAÇÃO
   ============================================================ */

type Acao =
  | 'ACEITAR_PARCEIRO' | 'RECUSAR_PARCEIRO'
  | 'ENCAMINHAR' | 'FILA' | 'TRATATIVA' | 'PROMOVER' | 'RECUSAR_TRIAGEM' | 'APROVAR_TRIAGEM'
  | 'APROVAR_FILA' | 'RECUSAR_FILA'
  | 'APROVAR_TRATATIVA' | 'RECUSAR_TRATATIVA'
  | 'APROVAR' | 'RECUSAR_GESTOR' | 'FILA_GESTOR'
  | 'CONFIRMAR_IMPLANTACAO';

/** Transições permitidas: de onde parte, para onde vai e quem pode acionar. */
const TRANSICOES: Record<Acao, { de: string[]; para: string; etapa: string; exigeMotivo: boolean }> = {
  ACEITAR_PARCEIRO: { de: ['AGUARDA_PARCEIRO'], para: 'TRIAGEM', etapa: 'Aceita pelo parceiro', exigeMotivo: false },
  RECUSAR_PARCEIRO: { de: ['AGUARDA_PARCEIRO'], para: 'RECUSADA', etapa: 'Recusada pelo parceiro', exigeMotivo: true },
  ENCAMINHAR: { de: ['TRIAGEM'], para: 'GESTOR', etapa: 'Encaminhada ao gestor', exigeMotivo: false },
  FILA: { de: ['TRIAGEM'], para: 'FILA', etapa: 'Enviada para a lista de espera', exigeMotivo: false },
  // Estacionar sem recusar. A lista de espera guarda ORDEM para quando abrir
  // posição, e por isso só vale onde se disputa posição; tratativa futura é
  // outra coisa — o pedido está certo, só não é agora. Sem ela, a triagem
  // escolhia entre recusar (que apaga o pedido) e deixar em TRIAGEM (que
  // entulha a caixa de quem tria com o que já foi lido e adiado).
  TRATATIVA: {
    de: ['TRIAGEM'], para: 'TRATATIVA', etapa: 'Enviada para tratativas futuras', exigeMotivo: false,
  },
  PROMOVER: { de: ['FILA'], para: 'GESTOR', etapa: 'Promovida da lista de espera', exigeMotivo: false },
  // Sair da fila e da tratativa pela decisão, e não só pela promoção ao gestor.
  // Quem estacionou o pedido é quem costuma retomá-lo, e obrigá-lo a encaminhar
  // ao gestor um caso que ele mesmo pode resolver era um desvio a mais no
  // caminho — o mesmo motivo pelo qual APROVAR_TRIAGEM existe.
  APROVAR_FILA: {
    de: ['FILA'], para: 'APROVADA', etapa: 'Aprovada na lista de espera', exigeMotivo: false,
  },
  RECUSAR_FILA: {
    de: ['FILA'], para: 'RECUSADA', etapa: 'Recusada na lista de espera', exigeMotivo: true,
  },
  APROVAR_TRATATIVA: {
    de: ['TRATATIVA'], para: 'APROVADA', etapa: 'Aprovada nas tratativas futuras', exigeMotivo: false,
  },
  RECUSAR_TRATATIVA: {
    de: ['TRATATIVA'], para: 'RECUSADA', etapa: 'Recusada nas tratativas futuras', exigeMotivo: true,
  },
  RECUSAR_TRIAGEM: { de: ['TRIAGEM'], para: 'RECUSADA', etapa: 'Recusada na triagem', exigeMotivo: true },
  // Aprovar sem passar pelo gestor. É prerrogativa só do Planejamento: se o
  // gestor pudesse fazê-lo, ele estaria decidindo antes de a triagem escolher
  // se o caso é dele — e o encaminhamento deixaria de significar alguma coisa.
  APROVAR_TRIAGEM: { de: ['TRIAGEM'], para: 'APROVADA', etapa: 'Aprovada na triagem', exigeMotivo: false },
  // O destino desta aqui não é sempre `APROVADA` — ver `destino`, logo abaixo.
  APROVAR: { de: ['GESTOR'], para: 'APROVADA', etapa: 'Aprovada pelo gestor', exigeMotivo: false },
  // A confirmação de que já está na escala. Nos pedidos que passam por
  // `IMPLANTAR`, é o efeito colateral DESTA transição que aplica férias e
  // travas — não o da aprovação do gestor.
  CONFIRMAR_IMPLANTACAO: {
    de: ['IMPLANTAR'], para: 'APROVADA', etapa: 'Implantada na escala', exigeMotivo: false,
  },
  RECUSAR_GESTOR: { de: ['GESTOR'], para: 'RECUSADA', etapa: 'Recusada pelo gestor', exigeMotivo: true },
  // O gestor também enfileira. Antes a lista de espera era só da triagem, então
  // o gestor que recebia um pedido bom numa data cheia só tinha "recusar" — e
  // recusar apaga o pedido, obrigando a pessoa a abrir outro quando a data
  // abrisse. Enfileirar preserva a ordem de chegada.
  FILA_GESTOR: { de: ['GESTOR'], para: 'FILA', etapa: 'Enviada para a lista de espera pelo gestor', exigeMotivo: false },
};

export async function decidirSolicitacao(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? VOLTA);
  const acao = String(formData.get('acao') ?? '') as Acao;
  const id = Number(formData.get('id'));
  const motivo = String(formData.get('motivo') ?? '').trim();

  const regra = TRANSICOES[acao];
  if (!regra || !id) erro(volta, 'Ação inválida.');

  const supabase = await createClient();
  const { data: s } = await supabase
    .from('solicitacoes')
    .select('*')
    .eq('id', id)
    .single();
  if (!s) erro(volta, 'Solicitação não encontrada.');

  if (!regra.de.includes(s.status)) {
    erro(volta, `Essa solicitação está em "${s.status}" e não aceita mais essa ação.`);
  }
  if (regra.exigeMotivo && motivo.length < 5) erro(volta, 'Uma recusa precisa de justificativa.');

  // Quem decide nem sempre é quem pode executar.
  //
  // Aprovar férias, folga, licença ou troca significa gravar ausência e travar
  // dias — e escrever em `ausencias` e `pins` é privilégio do Planejamento, na
  // RLS. O gestor decide, mas o banco recusa a escrita dele.
  //
  // Enquanto a aprovação do gestor ia direto para `APROVADA`, esses dois
  // inserts falhavam em silêncio: o pedido ficava marcado como "Aplicada na
  // escala", o histórico dizia que os dias tinham sido travados, e nada disso
  // tinha acontecido. A tela mentia — a pior forma de errar, porque ninguém vai
  // conferir o que o sistema afirma ter feito.
  //
  // `IMPLANTAR` é a etapa que faltava. A decisão do gestor vale; o que ela não
  // faz mais é fingir uma escrita que a RLS não permite. O pedido volta para o
  // Planejamento, que lança e confirma. Os tipos sem efeito na escala —
  // ajuste de ponto, banco de horas, atraso — a aprovação encerra na hora,
  // porque ali não há nada para implantar.
  const precisaImplantacao =
    acao === 'APROVAR' && TIPOS_COM_EFEITO_NA_ESCALA.includes(s.tipo as TipoSolicitacao);
  const destino = precisaImplantacao ? 'IMPLANTAR' : regra.para;
  const etapa = precisaImplantacao ? 'Aprovada pelo gestor — a implantar' : regra.etapa;

  // Autorização por papel, refeita no servidor (a UI só esconde os botões).
  if (acao === 'ACEITAR_PARCEIRO' || acao === 'RECUSAR_PARCEIRO') {
    if (s.parceiro_id !== sessao.colaboradorId) erro(volta, 'Só o colega convidado pode responder a essa troca.');
  } else if (acao === 'APROVAR' || acao === 'RECUSAR_GESTOR' || acao === 'FILA_GESTOR') {
    // Encaminhar é delegar. Enquanto o Planejamento também podia decidir depois
    // de encaminhar, o gestor nunca sabia se o pedido ainda era dele — e dois
    // aprovadores sobre a mesma linha é como uma decisão acaba tomada duas
    // vezes, em sentidos opostos. Depois do encaminhamento a decisão é do
    // gestor, e só dele.
    if (sessao.papel !== 'gestor') {
      erro(volta, 'Depois de encaminhada, a decisão é do gestor da equipe.');
    }
    if (acao === 'FILA_GESTOR' && !TIPOS_SOLICITACAO[s.tipo as TipoSolicitacao].fila) {
      erro(volta, 'Esse tipo de solicitação não usa lista de espera.');
    }
  } else {
    exigirPlanejamento(sessao.papel, volta);
    if (acao === 'FILA' && !TIPOS_SOLICITACAO[s.tipo as TipoSolicitacao].fila) {
      erro(volta, 'Esse tipo de solicitação não usa lista de espera.');
    }
  }

  const patch: Record<string, unknown> = { status: destino };
  if (acao === 'ACEITAR_PARCEIRO') patch.aceite_parceiro = 'ACEITO';
  if (acao === 'RECUSAR_PARCEIRO') patch.aceite_parceiro = 'RECUSADO';
  if (regra.exigeMotivo) patch.motivo_recusa = motivo;

  if (destino === 'FILA') {
    const { data: fila } = await supabase
      .from('solicitacoes')
      .select('posicao_fila')
      .eq('status', 'FILA')
      .order('posicao_fila', { ascending: false })
      .limit(1);
    patch.posicao_fila = (fila?.[0]?.posicao_fila ?? 0) + 1;
  }
  if (acao === 'PROMOVER' || destino === 'RECUSADA' || destino === 'APROVADA') patch.posicao_fila = null;

  // O efeito na escala acontece quando o pedido CHEGA a aprovado — não quando
  // alguém aprova. É a mesma distinção de sempre, agora com consequência: a
  // aprovação do gestor que passa por IMPLANTAR não mexe em nada, e quem mexe é
  // a confirmação do Planejamento, que é quem a RLS deixa escrever.
  let resumoEfeito = '';
  if (destino === 'APROVADA') {
    resumoEfeito = await aplicarNaEscala(sessao, s, volta);
    patch.aplicada = resumoEfeito !== '';
  }

  const { error } = await supabase.from('solicitacoes').update(patch).eq('id', id);
  if (error) erro(volta, 'Não foi possível registrar a decisão.');

  // Os dois, quando há os dois. `motivo || resumoEfeito` fazia a observação de
  // quem aprovou APAGAR o registro do que a aprovação mexeu na escala — e é o
  // segundo que alguém procura quando quer saber por que aquele dia mudou.
  await registrarEvento(sessao, id, etapa, [motivo, resumoEfeito].filter(Boolean).join(' · '));

  // Ao sair da fila, renumera quem ficou pra trás — senão a lista fica com buracos.
  // Qualquer saída da fila renumera quem ficou, e não só a promoção e a recusa:
  // aprovar direto da lista deixaria um buraco na ordem, e a ordem É a razão de
  // a lista existir.
  if (s.status === 'FILA' && destino !== 'FILA') {
    const { data: restantes } = await supabase
      .from('solicitacoes')
      .select('id')
      .eq('status', 'FILA')
      .order('posicao_fila');
    let pos = 1;
    for (const r of restantes ?? []) {
      await supabase.from('solicitacoes').update({ posicao_fila: pos++ }).eq('id', r.id);
    }
  }

  await registrarLog(sessao, `Solicitação ${etapa.toLowerCase()}`, `#${id} · ${resumoEfeito || motivo}`);
  revalidatePath('/', 'layout');
  voltar(volta, formData);
}

/**
 * Efeito real da aprovação sobre a escala.
 *
 * É o ponto que o protótipo não tinha: lá a tela dizia "a escala será atualizada
 * automaticamente" e nada acontecia. Aqui a aprovação grava uma trava (que
 * sobrevive a regerações) e ajusta a alocação da geração vigente.
 *
 * Devolve um resumo do que mudou, ou string vazia quando o tipo de solicitação
 * não tem efeito sobre a escala (ajuste de ponto, banco de horas etc.).
 */
async function aplicarNaEscala(
  sessao: Sessao,
  s: {
    id: number; tipo: TipoSolicitacao; data: string; data_fim: string | null;
    colaborador_id: number; parceiro_id: number | null; unidade_desejada_id: number | null; motivo: string | null;
  },
  volta: string
): Promise<string> {
  const supabase = await createClient();
  const [ano, mes] = partesIso(s.data);
  const competencia = iso(ano, mes, 1);
  const geracao = await getGeracaoAtual(competencia);

  // Um período pode atravessar o mês — férias de 25/11 a 05/12 tocam duas
  // gerações. A geração é resolvida pelo mês de CADA dia, com cache para não
  // repetir a consulta a cada data do intervalo.
  const geracaoPorMes = new Map<string, Awaited<ReturnType<typeof getGeracaoAtual>>>([[competencia, geracao]]);
  const geracaoDoDia = async (data: string) => {
    const [a, m] = partesIso(data);
    const comp = iso(a, m, 1);
    if (!geracaoPorMes.has(comp)) geracaoPorMes.set(comp, await getGeracaoAtual(comp));
    return geracaoPorMes.get(comp) ?? null;
  };

  const travar = async (colaboradorId: number, data: string, modalidade: Modalidade, unidadeId: number | null, motivo: string) => {
    await supabase.from('pins').upsert(
      {
        conta_id: sessao.conta.id,
        colaborador_id: colaboradorId,
        data,
        modalidade,
        unidade_id: unidadeId,
        motivo,
        criado_por: sessao.usuario.id,
      },
      { onConflict: 'colaborador_id,data' }
    );
    const g = await geracaoDoDia(data);
    if (g) {
      await supabase
        .from('alocacoes')
        .update({ modalidade, unidade_id: unidadeId, travado: true })
        .eq('geracao_id', g.id)
        .eq('colaborador_id', colaboradorId)
        .eq('data', data);
    }
  };

  if (geracao?.status === 'encerrada') erro(volta, 'O mês da solicitação está encerrado — reabra o planejamento antes de aprovar.');

  switch (s.tipo) {
    case 'TROCA_UNIDADE': {
      if (!s.unidade_desejada_id) return '';
      await travar(s.colaborador_id, s.data, 'UNIDADE', s.unidade_desejada_id, `Solicitação #${s.id} aprovada`);
      return `Alocação de ${formatarData(s.data)} movida para a unidade solicitada e travada.`;
    }

    case 'TROCA_HORARIO': {
      if (!s.parceiro_id || !geracao) return '';
      const { data: atuais } = await supabase
        .from('alocacoes')
        .select('colaborador_id, modalidade, unidade_id')
        .eq('geracao_id', geracao.id)
        .eq('data', s.data)
        .in('colaborador_id', [s.colaborador_id, s.parceiro_id]);

      const meu = atuais?.find(a => a.colaborador_id === s.colaborador_id);
      const dele = atuais?.find(a => a.colaborador_id === s.parceiro_id);
      if (!meu || !dele) return '';

      await travar(s.colaborador_id, s.data, dele.modalidade as Modalidade, dele.unidade_id, `Troca da solicitação #${s.id}`);
      await travar(s.parceiro_id, s.data, meu.modalidade as Modalidade, meu.unidade_id, `Troca da solicitação #${s.id}`);

      // A troca também vira ocorrência, para aparecer no histórico dos dois.
      await supabase.from('ocorrencias').insert([
        { conta_id: sessao.conta.id, colaborador_id: s.colaborador_id, data: s.data, tipo: 'TROCA', obs: `Troca aprovada (solicitação #${s.id})`, registrado_por: sessao.usuario.id },
        { conta_id: sessao.conta.id, colaborador_id: s.parceiro_id, data: s.data, tipo: 'TROCA', obs: `Troca aprovada (solicitação #${s.id})`, registrado_por: sessao.usuario.id },
      ]);
      return `Plantões de ${formatarData(s.data)} trocados entre os dois colaboradores.`;
    }

    case 'FOLGA':
    case 'LICENCA':
    case 'FERIAS': {
      const tipoAusencia = s.tipo === 'FERIAS' ? 'FERIAS' : 'AUSENCIA';
      const fim = s.data_fim ?? s.data;
      const dias = diffDias(s.data, fim) + 1;

      // A ausência é o que faz o período aparecer marcado no plano do mês e
      // bloquear o motor. Antes gravava sempre 1 dia, então férias de 10 dias
      // deixavam 9 deles livres para alocação.
      const { data: existentes } = await supabase
        .from('ausencias')
        .select('inicio, dias')
        .eq('colaborador_id', s.colaborador_id);
      const jaCoberto = (existentes ?? []).some((a: { inicio: string; dias: number }) => {
        const outroFim = addDias(a.inicio, a.dias - 1);
        return s.data <= outroFim && a.inicio <= fim; // sobreposição
      });

      if (!jaCoberto) {
        await supabase.from('ausencias').insert({
          conta_id: sessao.conta.id,
          colaborador_id: s.colaborador_id,
          tipo: tipoAusencia,
          inicio: s.data,
          dias,
          // O motivo veio do pedido; 'Compensação' era um chute que apagava
          // a razão real — atestado virava folga por compensação no histórico.
          grupo: tipoAusencia === 'AUSENCIA' ? (s.tipo === 'LICENCA' ? 'Licença' : 'Folga') : '',
          motivo: tipoAusencia === 'AUSENCIA' ? (s.motivo || 'Compensação') : '',
          criado_por: sessao.usuario.id,
        });
      }

      // Trava dia a dia. A ausência já bloqueia a geração, mas a trava é o que
      // segura o período numa escala JÁ gerada, sem esperar a regeração.
      for (let i = 0; i < dias; i++) {
        const d = addDias(s.data, i);
        await travar(s.colaborador_id, d, s.tipo === 'FERIAS' ? 'FERIAS' : 'FOLGA', null, `Solicitação #${s.id} aprovada`);
      }

      const rotulo = s.tipo === 'FERIAS' ? 'férias' : 'ausência';
      return dias === 1
        ? `${formatarData(s.data)} lançado como ${rotulo} e travado na escala.`
        : `${formatarData(s.data)} a ${formatarData(fim)} (${dias} dias) lançados como ${rotulo} e travados na escala.`;
    }

    default:
      // Ajuste de ponto, banco de horas, atraso, pausa e saída antecipada não
      // mexem na alocação do dia — a aprovação vale como registro formal.
      return '';
  }
}

/* ============================================================
   OCORRÊNCIAS
   ============================================================ */

export async function registrarOcorrencia(formData: FormData) {
  const sessao = await getSessao();
  const volta = String(formData.get('volta') ?? '/calendario');
  exigirAprovador(sessao.papel, volta);

  const colaboradorId = Number(formData.get('colaboradorId'));
  const tipo = String(formData.get('tipo') ?? '') as TipoOcorrencia;
  const obs = String(formData.get('obs') ?? '').trim();
  let data = String(formData.get('data') ?? '');

  if (!colaboradorId) erro(volta, 'Selecione o colaborador.');
  if (!TIPOS_OCORRENCIA[tipo]) erro(volta, 'Tipo de ocorrência inválido.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erro(volta, 'Data inválida.');

  // Ocorrência é registro do que aconteceu, e nada acontece contra uma escala
  // que ninguém viu. Em rascunho o dia ainda é hipótese — o que se faz ali é
  // mover a alocação. A tela já esconde o botão; isto é a mesma regra do lado
  // que decide.
  const [anoOc, mesOc] = partesIso(data);
  const geracaoDaData = await getGeracaoAtual(iso(anoOc, mesOc, 1));
  if (geracaoDaData?.status === 'rascunho') {
    erro(volta, 'A escala desse mês ainda é rascunho. Publique antes de lançar ocorrências.');
  }

  const supabase = await createClient();

  // Cada tipo pede uma coisa diferente, e o servidor conferindo por tipo é o que
  // impede um atraso sem minutos ou uma troca sem parceiro de entrar como
  // registro vazio — antes tudo isso cabia na observação, em texto livre.
  let minutos = 0;
  let dias = 1;
  let horaSaida: string | null = null;
  let parceiroId: number | null = null;

  switch (TIPOS_OCORRENCIA[tipo].pede) {
    case 'minutos': {
      minutos = Number(formData.get('minutos') ?? 0);
      if (!Number.isInteger(minutos) || minutos < 1) {
        erro(volta, 'Informe quantos minutos, como um número inteiro maior que zero.');
      }
      break;
    }

    case 'dias': {
      dias = Number(formData.get('dias') ?? 0);
      if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
        erro(volta, 'Informe quantos dias de falta, entre 1 e 365.');
      }
      const inicio = String(formData.get('inicio') ?? '').trim();
      if (inicio) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) erro(volta, 'Data de início inválida.');
        data = inicio; // a falta começa no dia informado, não no dia aberto na tela
      }
      break;
    }

    case 'saida': {
      horaSaida = String(formData.get('horaSaida') ?? '').trim();
      if (!/^\d{2}:\d{2}$/.test(horaSaida)) erro(volta, 'Informe o horário de saída.');

      // Os minutos saem do horário cadastrado, não da digitação: quem lança
      // sabe a que horas a pessoa saiu, não quanto isso deu. `fimDoTurno` é a
      // mesma função que as telas usam para exibir a faixa — é o que garante
      // que o horário cobrado aqui seja o mesmo que a pessoa viu na escala.
      const { data: c } = await supabase
        .from('colaboradores')
        .select('saida, sexta_reduzida')
        .eq('id', colaboradorId)
        .single();
      if (!c) erro(volta, 'Colaborador não encontrado.');

      const fimPrevisto = fimDoTurno(String(c.saida).slice(0, 5), c.sexta_reduzida, dowDeIso(data));
      minutos = emMinutos(fimPrevisto) - emMinutos(horaSaida);
      if (minutos <= 0) {
        erro(volta, `Saída às ${horaSaida} não é antecipada: o turno terminava às ${fimPrevisto}.`);
      }
      break;
    }

    case 'parceiro': {
      parceiroId = Number(formData.get('parceiroId') ?? 0) || null;
      if (!parceiroId) erro(volta, 'Selecione com quem a troca foi feita.');
      if (parceiroId === colaboradorId) erro(volta, 'A troca precisa ser com outra pessoa.');
      break;
    }

    case 'nada':
      if (!obs) erro(volta, 'Escreva a observação — é o único conteúdo deste registro.');
      break;
  }

  const { error } = await supabase.from('ocorrencias').insert({
    conta_id: sessao.conta.id,
    colaborador_id: colaboradorId,
    data,
    tipo,
    minutos,
    dias,
    hora_saida: horaSaida,
    parceiro_id: parceiroId,
    obs,
    registrado_por: sessao.usuario.id,
  });
  if (error) erro(volta, `Não foi possível registrar a ocorrência: ${mensagemErroBanco(error)}`);

  await registrarLog(
    sessao,
    'Ocorrência registrada',
    `Colaborador ${colaboradorId} · ${formatarData(data)} · ${TIPOS_OCORRENCIA[tipo].label}`
    + (minutos ? ` · ${minutos} min` : '')
    + (dias > 1 ? ` · ${dias} dias` : ''),
  );
  revalidatePath('/', 'layout');
  redirect(`${volta}?${new URLSearchParams({ competencia: String(formData.get('competencia') ?? ''), dia: data, ok: '1' })}`);
}
