'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSessao, exigirAprovador, exigirPlanejamento, type Sessao } from '@/lib/sessao';
import { registrarLog } from '@/lib/log';
import { voltar } from '@/lib/volta';
import { getGeracaoAtual } from '@/lib/data/escalas';
import { addDias, formatarData, iso, partesIso } from '@/lib/domain/escalas/datas';
import { TIPOS_SOLICITACAO, type TipoSolicitacao } from '@/lib/domain/escalas/constantes';
import type { Modalidade } from '@/lib/domain/escalas/tipos';

const VOLTA = '/solicitacoes';

function erro(rota: string, msg: string): never {
  redirect(`${rota}?erro=${encodeURIComponent(msg)}`);
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

  let parceiroId: number | null = null;
  let unidadeDesejadaId: number | null = null;

  if (tipo === 'TROCA_HORARIO') {
    parceiroId = Number(formData.get('parceiroId') ?? 0) || null;
    if (!parceiroId) erro(volta, 'Selecione o colega com quem a troca será feita.');
    if (parceiroId === colaboradorId) erro(volta, 'Não dá para trocar de plantão com você mesmo.');

    const { data: ambos } = await supabase
      .from('colaboradores')
      .select('id, equipe_id, regime, status')
      .in('id', [colaboradorId, parceiroId]);
    const eu = ambos?.find(c => c.id === colaboradorId);
    const ele = ambos?.find(c => c.id === parceiroId);
    if (!eu || !ele) erro(volta, 'Colaborador não encontrado.');
    if (ele.status !== 'ativo') erro(volta, 'O colega selecionado não está ativo.');
    if (eu.regime !== ele.regime) erro(volta, 'A troca só vale entre pessoas do mesmo regime de trabalho.');
  }

  if (tipo === 'TROCA_UNIDADE') {
    unidadeDesejadaId = Number(formData.get('unidadeDesejadaId') ?? 0) || null;
    if (!unidadeDesejadaId) erro(volta, 'Selecione a unidade desejada.');
  }

  const status = tipo === 'TROCA_HORARIO' ? 'AGUARDA_PARCEIRO' : 'TRIAGEM';

  const { data: nova, error } = await supabase
    .from('solicitacoes')
    .insert({
      conta_id: sessao.conta.id,
      colaborador_id: colaboradorId,
      tipo,
      data,
      detalhe,
      parceiro_id: parceiroId,
      aceite_parceiro: tipo === 'TROCA_HORARIO' ? 'PENDENTE' : null,
      unidade_desejada_id: unidadeDesejadaId,
      status,
    })
    .select('id')
    .single();

  if (error || !nova) erro(volta, 'Não foi possível abrir a solicitação.');

  await registrarEvento(sessao, nova.id, 'Aberta', `${TIPOS_SOLICITACAO[tipo].label} para ${formatarData(data)}`);
  await registrarLog(sessao, 'Solicitação aberta', `#${nova.id} · ${TIPOS_SOLICITACAO[tipo].label} · ${formatarData(data)}`);

  revalidatePath('/', 'layout');
  voltar(volta, formData);
}

/* ============================================================
   FLUXO DE APROVAÇÃO
   ============================================================ */

type Acao =
  | 'ACEITAR_PARCEIRO' | 'RECUSAR_PARCEIRO'
  | 'ENCAMINHAR' | 'FILA' | 'PROMOVER' | 'RECUSAR_TRIAGEM' | 'APROVAR_TRIAGEM'
  | 'APROVAR' | 'RECUSAR_GESTOR';

/** Transições permitidas: de onde parte, para onde vai e quem pode acionar. */
const TRANSICOES: Record<Acao, { de: string[]; para: string; etapa: string; exigeMotivo: boolean }> = {
  ACEITAR_PARCEIRO: { de: ['AGUARDA_PARCEIRO'], para: 'TRIAGEM', etapa: 'Aceita pelo parceiro', exigeMotivo: false },
  RECUSAR_PARCEIRO: { de: ['AGUARDA_PARCEIRO'], para: 'RECUSADA', etapa: 'Recusada pelo parceiro', exigeMotivo: true },
  ENCAMINHAR: { de: ['TRIAGEM'], para: 'GESTOR', etapa: 'Encaminhada ao gestor', exigeMotivo: false },
  FILA: { de: ['TRIAGEM'], para: 'FILA', etapa: 'Enviada para a lista de espera', exigeMotivo: false },
  PROMOVER: { de: ['FILA'], para: 'GESTOR', etapa: 'Promovida da lista de espera', exigeMotivo: false },
  RECUSAR_TRIAGEM: { de: ['TRIAGEM'], para: 'RECUSADA', etapa: 'Recusada na triagem', exigeMotivo: true },
  // Aprovar sem passar pelo gestor. É prerrogativa só do Planejamento: se o
  // gestor pudesse fazê-lo, ele estaria decidindo antes de a triagem escolher
  // se o caso é dele — e o encaminhamento deixaria de significar alguma coisa.
  APROVAR_TRIAGEM: { de: ['TRIAGEM'], para: 'APROVADA', etapa: 'Aprovada na triagem', exigeMotivo: false },
  APROVAR: { de: ['GESTOR'], para: 'APROVADA', etapa: 'Aprovada pelo gestor', exigeMotivo: false },
  RECUSAR_GESTOR: { de: ['GESTOR'], para: 'RECUSADA', etapa: 'Recusada pelo gestor', exigeMotivo: true },
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

  // Autorização por papel, refeita no servidor (a UI só esconde os botões).
  if (acao === 'ACEITAR_PARCEIRO' || acao === 'RECUSAR_PARCEIRO') {
    if (s.parceiro_id !== sessao.colaboradorId) erro(volta, 'Só o colega convidado pode responder a essa troca.');
  } else if (acao === 'APROVAR' || acao === 'RECUSAR_GESTOR') {
    exigirAprovador(sessao.papel, volta);
  } else {
    exigirPlanejamento(sessao.papel, volta);
    if (acao === 'FILA' && !TIPOS_SOLICITACAO[s.tipo as TipoSolicitacao].fila) {
      erro(volta, 'Esse tipo de solicitação não usa lista de espera.');
    }
  }

  const patch: Record<string, unknown> = { status: regra.para };
  if (acao === 'ACEITAR_PARCEIRO') patch.aceite_parceiro = 'ACEITO';
  if (acao === 'RECUSAR_PARCEIRO') patch.aceite_parceiro = 'RECUSADO';
  if (regra.exigeMotivo) patch.motivo_recusa = motivo;

  if (acao === 'FILA') {
    const { data: fila } = await supabase
      .from('solicitacoes')
      .select('posicao_fila')
      .eq('status', 'FILA')
      .order('posicao_fila', { ascending: false })
      .limit(1);
    patch.posicao_fila = (fila?.[0]?.posicao_fila ?? 0) + 1;
  }
  if (acao === 'PROMOVER' || regra.para === 'RECUSADA' || regra.para === 'APROVADA') patch.posicao_fila = null;

  let resumoEfeito = '';
  if (acao === 'APROVAR' || acao === 'APROVAR_TRIAGEM') {
    resumoEfeito = await aplicarNaEscala(sessao, s, volta);
    patch.aplicada = resumoEfeito !== '';
  }

  const { error } = await supabase.from('solicitacoes').update(patch).eq('id', id);
  if (error) erro(volta, 'Não foi possível registrar a decisão.');

  await registrarEvento(sessao, id, regra.etapa, motivo || resumoEfeito);

  // Ao sair da fila, renumera quem ficou pra trás — senão a lista fica com buracos.
  if (acao === 'PROMOVER' || (s.status === 'FILA' && regra.para === 'RECUSADA')) {
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

  await registrarLog(sessao, `Solicitação ${regra.etapa.toLowerCase()}`, `#${id} · ${resumoEfeito || motivo}`);
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
    id: number; tipo: TipoSolicitacao; data: string; colaborador_id: number;
    parceiro_id: number | null; unidade_desejada_id: number | null;
  },
  volta: string
): Promise<string> {
  const supabase = await createClient();
  const [ano, mes] = partesIso(s.data);
  const competencia = iso(ano, mes, 1);
  const geracao = await getGeracaoAtual(competencia);

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
    if (geracao) {
      await supabase
        .from('alocacoes')
        .update({ modalidade, unidade_id: unidadeId, travado: true })
        .eq('geracao_id', geracao.id)
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
    case 'FERIAS': {
      const tipoAusencia = s.tipo === 'FERIAS' ? 'FERIAS' : 'AUSENCIA';

      // Se o dia já está coberto por outra ausência, não duplica o lançamento —
      // a trava abaixo já garante o efeito na escala.
      const { data: existentes } = await supabase
        .from('ausencias')
        .select('inicio, dias')
        .eq('colaborador_id', s.colaborador_id)
        .lte('inicio', s.data);
      const jaCoberto = (existentes ?? []).some(
        (a: { inicio: string; dias: number }) => addDias(a.inicio, a.dias - 1) >= s.data
      );

      if (!jaCoberto) {
        await supabase.from('ausencias').insert({
          conta_id: sessao.conta.id,
          colaborador_id: s.colaborador_id,
          tipo: tipoAusencia,
          inicio: s.data,
          dias: 1,
          grupo: tipoAusencia === 'AUSENCIA' ? 'Folga' : '',
          motivo: tipoAusencia === 'AUSENCIA' ? 'Compensação' : '',
          criado_por: sessao.usuario.id,
        });
      }
      await travar(s.colaborador_id, s.data, s.tipo === 'FERIAS' ? 'FERIAS' : 'FOLGA', null, `Solicitação #${s.id} aprovada`);
      return `${formatarData(s.data)} lançado como ${s.tipo === 'FERIAS' ? 'férias' : 'ausência'} e travado na escala.`;
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
  const data = String(formData.get('data') ?? '');
  const tipo = String(formData.get('tipo') ?? '');
  const minutos = Number(formData.get('minutos') ?? 0);

  if (!colaboradorId) erro(volta, 'Selecione o colaborador.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) erro(volta, 'Data inválida.');
  const tiposValidos = ['ATRASO', 'FALTA_J', 'FALTA_I', 'SAIDA_ANTEC', 'PAUSA_EXC', 'SEM_MARCACAO', 'TROCA', 'OBS'];
  if (!tiposValidos.includes(tipo)) erro(volta, 'Tipo de ocorrência inválido.');
  if (minutos < 0) erro(volta, 'Minutos não podem ser negativos.');

  const supabase = await createClient();
  const { error } = await supabase.from('ocorrencias').insert({
    conta_id: sessao.conta.id,
    colaborador_id: colaboradorId,
    data,
    tipo,
    minutos,
    obs: String(formData.get('obs') ?? '').trim(),
    registrado_por: sessao.usuario.id,
  });
  if (error) erro(volta, `Não foi possível registrar a ocorrência: ${error.message}`);

  await registrarLog(sessao, 'Ocorrência registrada', `Colaborador ${colaboradorId} · ${formatarData(data)} · ${tipo}`);
  revalidatePath('/', 'layout');
  redirect(`${volta}?${new URLSearchParams({ competencia: String(formData.get('competencia') ?? ''), dia: data, ok: '1' })}`);
}
