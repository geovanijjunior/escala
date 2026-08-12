import { createClient } from '@/lib/supabase/server';
import { gerarEscala } from '@/lib/domain/escalas/motor';
import { checarPlanos, type Pendencia } from '@/lib/domain/escalas/validacao';
import { addDias, diasNoMes, iso, partesIso } from '@/lib/domain/escalas/datas';
import type {
  Alocacao, Ausencia, Aviso, Colaborador, Equipe, GerarEscalaOutput,
  Modalidade, PlanoMensal, Posto, StatusGeracao, Unidade,
} from '@/lib/domain/escalas/tipos';
import { TIPOS_SOLICITACAO } from '@/lib/domain/escalas/constantes';
import { formatarData } from '@/lib/domain/escalas/datas';
import type { StatusSolicitacao, TipoOcorrencia, TipoSolicitacao } from '@/lib/domain/escalas/constantes';

/* ============================================================
   Linhas cruas do banco → tipos de domínio
   ============================================================ */

interface LinhaUnidade {
  id: number; codigo: string; nome: string; sigla: string; cor: string; bg: string;
  capacidade_total: number; capacidade_reservadas: number; ordem: number; ativa: boolean;
}

interface LinhaColaborador {
  id: number; perfil_id: string | null; nome: string; matricula: string; email: string;
  cargo: string; equipe_id: number; gestor_id: string | null; regime: '12x36' | '5x2';
  turno: 'D' | 'N'; ciclo: 'IMPAR' | 'PAR' | null; entrada: string; jornada: number;
  unidade_base_id: number; eleg_home: boolean; eleg_externo: boolean; sexta_reduzida: boolean;
  status: 'ativo' | 'afastado' | 'desligado'; motivo_status: string | null;
  admissao: string; desligamento: string | null;
}

interface LinhaPlano {
  id: number; colaborador_id: number; competencia: string; ciclo: 'IMPAR' | 'PAR' | null;
  ho_modo: 'FIXO' | 'COTA' | null; ho_dias_semana: number[]; ho_quantidade: number;
  ho_dias_preferencia: number[]; ho_dias_proibidos: number[];
  plano_distribuicao: { unidade_id: number; percentual: number }[] | null;
  plano_unidade_fixa: { dow: number; unidade_id: number }[] | null;
  plano_posto: { posto_id: number; dias: number; semana: number | null }[] | null;
}

export interface Geracao {
  id: number;
  competencia: string;
  versao: number;
  status: StatusGeracao;
  escopo: string;
  conflitos: Aviso[];
  alertas: Aviso[];
  aderencia: GerarEscalaOutput['aderencia'];
  geradaEm: string;
  geradaPorNome: string;
}

export interface Solicitacao {
  id: number;
  colaboradorId: number;
  colaboradorNome: string;
  equipeId: number | null;
  tipo: TipoSolicitacao;
  data: string;
  /** Fim do período, quando o tipo cobre mais de um dia (férias, folga longa). */
  dataFim: string | null;
  detalhe: string;
  parceiroId: number | null;
  parceiroNome: string | null;
  aceiteParceiro: 'PENDENTE' | 'ACEITO' | 'RECUSADO' | null;
  unidadeDesejadaId: number | null;
  /** Combinação de férias escolhida (chave de OPCOES_FERIAS). */
  opcaoFerias: string | null;
  /** Se quem pediu já lançou as férias no Fiori. */
  lancadoFiori: boolean | null;
  /** Motivo da folga ou licença, vindo da lista de ausências. */
  motivo: string | null;
  status: StatusSolicitacao;
  posicaoFila: number | null;
  motivoRecusa: string | null;
  aplicada: boolean;
  criadoEm: string;
  eventos: { etapa: string; detalhe: string; porNome: string; em: string }[];
}

export interface Ocorrencia {
  id: number;
  colaboradorId: number;
  colaboradorNome: string;
  data: string;
  tipo: TipoOcorrencia;
  minutos: number;
  obs: string;
}

const paraUnidade = (u: LinhaUnidade): Unidade => ({
  id: u.id, codigo: u.codigo, nome: u.nome, sigla: u.sigla, cor: u.cor, bg: u.bg,
  capacidadeTotal: u.capacidade_total, capacidadeReservadas: u.capacidade_reservadas,
  ordem: u.ordem, ativa: u.ativa,
});

const paraColaborador = (c: LinhaColaborador): Colaborador => ({
  id: c.id, perfilId: c.perfil_id, nome: c.nome, matricula: c.matricula, email: c.email,
  cargo: c.cargo, equipeId: c.equipe_id, gestorId: c.gestor_id, regime: c.regime, turno: c.turno,
  ciclo: c.ciclo, entrada: (c.entrada ?? '08:00').slice(0, 5), jornada: Number(c.jornada),
  unidadeBaseId: c.unidade_base_id, elegHome: c.eleg_home, elegExterno: c.eleg_externo,
  sextaReduzida: c.sexta_reduzida, status: c.status, motivoStatus: c.motivo_status ?? '',
  admissao: c.admissao, desligamento: c.desligamento,
});

const paraPlano = (p: LinhaPlano): PlanoMensal => ({
  id: p.id,
  colaboradorId: p.colaborador_id,
  competencia: p.competencia,
  ciclo: p.ciclo,
  homeOffice: {
    modo: p.ho_modo,
    diasSemana: p.ho_dias_semana ?? [],
    quantidade: p.ho_quantidade ?? 0,
    diasPreferencia: p.ho_dias_preferencia ?? [],
    diasProibidos: p.ho_dias_proibidos ?? [],
  },
  distribuicao: Object.fromEntries((p.plano_distribuicao ?? []).map(d => [d.unidade_id, d.percentual])),
  unidadesFixas: Object.fromEntries((p.plano_unidade_fixa ?? []).map(f => [f.dow, f.unidade_id])),
  postos: (p.plano_posto ?? []).map(x => ({ postoId: x.posto_id, dias: x.dias, semana: x.semana })),
});

/* ============================================================
   Leituras
   ============================================================ */

/**
 * Desembrulha uma leitura deixando o erro à vista.
 *
 * `const { data } = await supabase…` descarta o erro e devolve `undefined`, que
 * o código seguinte trata como "não há nada". Foi assim que a tela de
 * solicitações passou a mostrar "Nada por aqui" enquanto o contador do menu
 * dizia 2: a consulta falhava, o `catch` não existia, e a falha virava lista
 * vazia — o modo mais caro de errar, porque parece que o sistema está certo.
 *
 * Aqui a falha continua não derrubando a página (uma tela parcial é melhor que
 * um erro 500 no cabeçalho), mas vai para o log do servidor com o nome da
 * consulta, que é o que faltava para alguém perceber.
 */
function conferir<T>(
  rotulo: string,
  r: { data: T; error: { message: string; code?: string } | null },
): T {
  if (r.error) {
    console.error(`[escala] ${rotulo}: ${r.error.message}${r.error.code ? ` (${r.error.code})` : ''}`);
  }
  return r.data;
}

export async function listarUnidades(): Promise<Unidade[]> {
  const supabase = await createClient();
  const data = conferir('listarUnidades', await supabase.from('unidades').select('*').order('ordem').order('id'));
  return ((data ?? []) as LinhaUnidade[]).map(paraUnidade);
}

export async function listarEquipes(): Promise<Equipe[]> {
  const supabase = await createClient();
  const data = conferir('listarEquipes', await supabase.from('equipes').select('*').order('nome'));
  return ((data ?? []) as { id: number; codigo: string; nome: string; regime: '12x36' | '5x2'; turno: 'D' | 'N'; gestor_id: string | null }[])
    .map(e => ({ id: e.id, codigo: e.codigo, nome: e.nome, regime: e.regime, turno: e.turno, gestorId: e.gestor_id }));
}

export async function listarColaboradores(): Promise<Colaborador[]> {
  const supabase = await createClient();
  const data = conferir('listarColaboradores', await supabase.from('colaboradores').select('*').order('nome'));
  return ((data ?? []) as LinhaColaborador[]).map(paraColaborador);
}

export async function listarFeriados(ano?: number): Promise<{ data: string; nome: string }[]> {
  const supabase = await createClient();
  let q = supabase.from('feriados').select('data, nome').order('data');
  if (ano) q = q.gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`);
  const data = conferir('listarFeriados', await q);
  return (data ?? []) as { data: string; nome: string }[];
}

export interface ConfigEscalas {
  cicloAncora: string;
  toleranciaAderencia: number;
  coberturaMinima: number;
}

export async function getConfig(contaId: string): Promise<ConfigEscalas> {
  const supabase = await createClient();
  const data = conferir('getConfig', await supabase.from('config').select('*').eq('conta_id', contaId).maybeSingle());
  return {
    cicloAncora: data?.ciclo_ancora ?? iso(new Date().getFullYear(), 0, 1),
    toleranciaAderencia: data?.tolerancia_aderencia ?? 1,
    coberturaMinima: data?.cobertura_minima ?? 1,
  };
}

/** Tudo que o motor precisa para um mês, numa leitura só. */
export interface ContextoMes {
  competencia: string;
  ano: number;
  mes: number;
  unidades: Unidade[];
  equipes: Equipe[];
  colaboradores: Colaborador[];
  planos: PlanoMensal[];
  ausencias: Ausencia[];
  postos: Posto[];
  capacidades: { unidadeId: number; dow: number | null; data: string | null; total: number; reservadas: number }[];
  cotasEquipe: { unidadeId: number; equipeId: number; dow: number | null; limite: number }[];
  feriados: Record<string, string>;
  pins: { colaboradorId: number; data: string; modalidade: Modalidade; unidadeId: number | null }[];
  config: ConfigEscalas;
}

/**
 * Plano do mês, caindo para o mês anterior de quem ainda não tem um.
 *
 * A distribuição entre unidades, o home office, a unidade fixa e o posto são
 * configuração recorrente: mudam de vez em quando, não todo mês. Exigir que
 * fossem redigitados a cada competência produzia meses sem plano nenhum — e
 * mês sem plano não é "mês sem regra", é uma pessoa que o motor distribui como
 * se nada tivesse sido combinado com ela.
 *
 * O que NÃO é herdado são férias e ausências, e não por esquecimento: elas são
 * eventos datados, vêm de solicitação aprovada, e repeti-las no mês seguinte
 * marcaria de férias quem já voltou. Por isso elas nem passam por aqui — vivem
 * em `ausencias`, com data própria.
 *
 * `linhas` vem ordenada da competência mais recente para a mais antiga, então
 * a primeira ocorrência de cada colaborador é o plano mais novo que ele tem.
 */
function comHeranca(linhas: LinhaPlano[], competencia: string): PlanoMensal[] {
  const escolhido = new Map<number, LinhaPlano>();
  for (const l of linhas) {
    if (!escolhido.has(l.colaborador_id)) escolhido.set(l.colaborador_id, l);
  }
  return [...escolhido.values()].map(l => ({
    ...paraPlano(l),
    // A competência passa a ser a do mês pedido: o motor trabalha sobre este
    // mês, e um plano que se apresenta como sendo de outro romperia toda
    // comparação por competência daqui pra frente.
    competencia,
    herdadoDe: l.competencia === competencia ? null : l.competencia,
  }));
}

export async function carregarContextoMes(competencia: string, contaId: string): Promise<ContextoMes> {
  const supabase = await createClient();
  const [ano, mes] = partesIso(competencia);
  const primeiro = competencia;
  const ultimo = iso(ano, mes, diasNoMes(ano, mes));

  const [unidades, equipes, colaboradores, config, planosRes, ausRes, capRes, cotaRes, postoRes, ferRes, pinRes] = await Promise.all([
    listarUnidades(),
    listarEquipes(),
    listarColaboradores(),
    getConfig(contaId),
    // O mês em questão e os doze anteriores, na mesma consulta: os anteriores
    // servem para herdar as regras de quem ainda não tem plano deste mês. Ver
    // `comHeranca` logo abaixo.
    supabase
      .from('planos')
      .select('*, plano_distribuicao(unidade_id, percentual), plano_unidade_fixa(dow, unidade_id), plano_posto(posto_id, dias, semana)')
      .lte('competencia', competencia)
      .gte('competencia', iso(ano - 1, mes, 1))
      .order('competencia', { ascending: false }),
    // Ausências que interceptam o mês, mesmo tendo começado antes dele.
    supabase
      .from('ausencias')
      .select('*')
      .lte('inicio', ultimo)
      .gte('inicio', addDias(primeiro, -365)),
    supabase.from('capacidades').select('*'),
    supabase.from('cotas_equipe').select('*'),
    supabase.from('postos').select('*').order('nome'),
    supabase.from('feriados').select('data, nome').gte('data', primeiro).lte('data', ultimo),
    supabase.from('pins').select('*').gte('data', primeiro).lte('data', ultimo),
  ]);

  const ausencias: Ausencia[] = ((ausRes.data ?? []) as {
    id: number; colaborador_id: number; tipo: 'FERIAS' | 'AUSENCIA'; inicio: string; dias: number; grupo: string; motivo: string;
  }[])
    .map(a => ({
      id: a.id, colaboradorId: a.colaborador_id, tipo: a.tipo,
      inicio: a.inicio, dias: a.dias, grupo: a.grupo, motivo: a.motivo,
    }))
    // Descarta o que termina antes do mês começar (o filtro por data no banco é
    // só um limitador grosseiro, já que o fim é calculado a partir de dias).
    .filter(a => addDias(a.inicio, a.dias - 1) >= primeiro);

  return {
    competencia, ano, mes, unidades, equipes, colaboradores, config,
    planos: comHeranca((planosRes.data ?? []) as LinhaPlano[], competencia),
    ausencias,
    capacidades: ((capRes.data ?? []) as { unidade_id: number; dow: number | null; data: string | null; total: number; reservadas: number }[])
      .map(c => ({ unidadeId: c.unidade_id, dow: c.dow, data: c.data, total: c.total, reservadas: c.reservadas })),
    postos: ((postoRes.data ?? []) as { id: number; unidade_id: number; nome: string; vagas: number; ativo: boolean }[])
      .map(p => ({ id: p.id, unidadeId: p.unidade_id, nome: p.nome, vagas: p.vagas, ativo: p.ativo })),
    cotasEquipe: ((cotaRes.data ?? []) as { unidade_id: number; equipe_id: number; dow: number | null; limite: number }[])
      .map(c => ({ unidadeId: c.unidade_id, equipeId: c.equipe_id, dow: c.dow, limite: c.limite })),
    feriados: Object.fromEntries(((ferRes.data ?? []) as { data: string; nome: string }[]).map(f => [f.data, f.nome])),
    pins: ((pinRes.data ?? []) as { colaborador_id: number; data: string; modalidade: Modalidade; unidade_id: number | null }[])
      .map(p => ({ colaboradorId: p.colaborador_id, data: p.data, modalidade: p.modalidade, unidadeId: p.unidade_id })),
  };
}

/** Roda o motor sem gravar nada — é o dry-run mostrado antes de confirmar. */
export function simular(ctx: ContextoMes, pinsExtras: ContextoMes['pins'] = []): GerarEscalaOutput {
  return gerarEscala({
    ano: ctx.ano,
    mes: ctx.mes,
    unidades: ctx.unidades,
    equipes: ctx.equipes,
    colaboradores: ctx.colaboradores,
    planos: ctx.planos,
    ausencias: ctx.ausencias,
    capacidades: ctx.capacidades,
    cotasEquipe: ctx.cotasEquipe,
    postos: ctx.postos,
    feriados: ctx.feriados,
    pins: [...ctx.pins, ...pinsExtras],
    cicloAncora: ctx.config.cicloAncora,
    toleranciaAderencia: ctx.config.toleranciaAderencia,
    coberturaMinima: ctx.config.coberturaMinima,
  });
}

export function pendenciasDoMes(ctx: ContextoMes): Pendencia[] {
  return checarPlanos({
    colaboradores: ctx.colaboradores,
    planos: ctx.planos,
    ausencias: ctx.ausencias,
    unidades: ctx.unidades,
  });
}

export async function getGeracaoAtual(competencia: string): Promise<Geracao | null> {
  const supabase = await createClient();
  const data = conferir('getGeracaoAtual', await supabase
    .from('geracoes')
    .select('*')
    .eq('competencia', competencia)
    .eq('atual', true)
    .maybeSingle());
  if (!data) return null;
  return {
    id: data.id, competencia: data.competencia, versao: data.versao, status: data.status,
    escopo: data.escopo,
    // `?? []` só cobre null. Uma coluna jsonb pode guardar objeto, número ou
    // texto, e a tela faz spread em cima — um único registro torto derrubava a
    // tela de geração inteira com "conflitos is not iterable". A escala está
    // gravada e correta; recusar-se a exibi-la por causa do painel de avisos é
    // a troca errada.
    conflitos: Array.isArray(data.conflitos) ? data.conflitos : [],
    alertas: Array.isArray(data.alertas) ? data.alertas : [],
    aderencia: Array.isArray(data.aderencia) ? data.aderencia : [],
    geradaEm: data.gerada_em, geradaPorNome: data.gerada_por_nome,
  };
}

export async function listarAlocacoes(geracaoId: number): Promise<Alocacao[]> {
  const supabase = await createClient();
  const linhas: Alocacao[] = [];
  // Um mês de 60 pessoas passa de 1800 linhas — acima do teto padrão do
  // PostgREST, então pagina explicitamente em vez de truncar em silêncio.
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    const { data, error } = await supabase
      .from('alocacoes')
      .select('colaborador_id, data, modalidade, unidade_id, travado, posto_id')
      .eq('geracao_id', geracaoId)
      .order('data')
      .order('colaborador_id')
      .range(de, de + passo - 1);
    if (error || !data || data.length === 0) break;
    linhas.push(...(data as { colaborador_id: number; data: string; modalidade: Modalidade; unidade_id: number | null; travado: boolean; posto_id: number | null }[])
      .map(a => ({
        colaboradorId: a.colaborador_id, data: a.data, modalidade: a.modalidade,
        unidadeId: a.unidade_id, travado: a.travado, postoId: a.posto_id ?? null,
      })));
    if (data.length < passo) break;
  }
  return linhas;
}

export async function listarSolicitacoes(): Promise<Solicitacao[]> {
  const supabase = await createClient();
  // Sem dica de constraint. `solicitacoes` aponta para `colaboradores` duas
  // vezes — quem pediu e o parceiro da troca —, e desambiguar pelo nome da
  // constraint amarrou esta tela à migration em vigor: a 0009 renomeia essas
  // FKs, e a consulta inteira passou a ser recusada pelo PostgREST de um lado
  // ou do outro da migration, deixando a tela vazia sem dizer por quê. Os nomes
  // vêm de uma segunda consulta, que não depende de nome de constraint nenhum.
  //
  // O embed de `solicitacao_eventos` fica: é a única FK entre as duas tabelas,
  // então não há o que desambiguar.
  const data = conferir('listarSolicitacoes', await supabase
    .from('solicitacoes')
    .select('*, solicitacao_eventos(etapa, detalhe, por_nome, em)')
    .order('criado_em', { ascending: false }));

  type Linha = {
    id: number; colaborador_id: number; tipo: TipoSolicitacao; data: string; data_fim: string | null; detalhe: string;
    parceiro_id: number | null; aceite_parceiro: 'PENDENTE' | 'ACEITO' | 'RECUSADO' | null;
    unidade_desejada_id: number | null; status: StatusSolicitacao; posicao_fila: number | null;
    opcao_ferias: string | null; lancado_fiori: boolean | null; motivo: string | null;
    motivo_recusa: string | null; aplicada: boolean; criado_em: string;
    solicitacao_eventos: { etapa: string; detalhe: string; por_nome: string; em: string }[] | null;
  };

  const linhas = (data ?? []) as Linha[];
  if (linhas.length === 0) return [];

  const ids = [...new Set(linhas.flatMap(s => [s.colaborador_id, s.parceiro_id]))]
    .filter((n): n is number => typeof n === 'number');
  const pessoas = conferir('listarSolicitacoes/colaboradores', await supabase
    .from('colaboradores').select('id, nome, equipe_id').in('id', ids)) ?? [];
  const porId = new Map((pessoas as { id: number; nome: string; equipe_id: number }[]).map(c => [c.id, c]));

  return linhas.map(s => ({
    id: s.id,
    colaboradorId: s.colaborador_id,
    colaboradorNome: porId.get(s.colaborador_id)?.nome ?? '—',
    equipeId: porId.get(s.colaborador_id)?.equipe_id ?? null,
    tipo: s.tipo,
    data: s.data,
    dataFim: s.data_fim ?? null,
    detalhe: s.detalhe,
    parceiroId: s.parceiro_id,
    parceiroNome: s.parceiro_id ? porId.get(s.parceiro_id)?.nome ?? null : null,
    aceiteParceiro: s.aceite_parceiro,
    unidadeDesejadaId: s.unidade_desejada_id,
    opcaoFerias: s.opcao_ferias ?? null,
    lancadoFiori: s.lancado_fiori ?? null,
    motivo: s.motivo ?? null,
    status: s.status,
    posicaoFila: s.posicao_fila,
    motivoRecusa: s.motivo_recusa,
    aplicada: s.aplicada,
    criadoEm: s.criado_em,
    eventos: (s.solicitacao_eventos ?? [])
      .slice()
      .sort((a, b) => a.em.localeCompare(b.em))
      .map(e => ({ etapa: e.etapa, detalhe: e.detalhe, porNome: e.por_nome, em: e.em })),
  }));
}

export async function listarOcorrencias(de?: string, ate?: string): Promise<Ocorrencia[]> {
  const supabase = await createClient();
  let q = supabase
    .from('ocorrencias')
    .select('*, colaborador:colaboradores(nome)')
    .order('data', { ascending: false });
  if (de) q = q.gte('data', de);
  if (ate) q = q.lte('data', ate);
  const data = conferir('listarOcorrencias', await q);
  type Linha = {
    id: number; colaborador_id: number; data: string; tipo: TipoOcorrencia;
    minutos: number; obs: string; colaborador: { nome: string } | null;
  };
  return ((data ?? []) as Linha[]).map(o => ({
    id: o.id, colaboradorId: o.colaborador_id, colaboradorNome: o.colaborador?.nome ?? '—',
    data: o.data, tipo: o.tipo, minutos: o.minutos, obs: o.obs,
  }));
}

export async function listarLogs(limite = 60) {
  const supabase = await createClient();
  const data = conferir('listarLogs', await supabase
    .from('logs')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(limite));
  return (data ?? []) as { id: number; usuario_nome: string; acao: string; detalhe: string; criado_em: string }[];
}

/** Meses que já têm plano ou geração — alimenta o seletor de competência. */
export async function listarCompetencias(): Promise<string[]> {
  const supabase = await createClient();
  const [planos, geracoes] = await Promise.all([
    supabase.from('planos').select('competencia'),
    supabase.from('geracoes').select('competencia'),
  ]);
  const set = new Set<string>();
  for (const p of (planos.data ?? []) as { competencia: string }[]) set.add(p.competencia);
  for (const g of (geracoes.data ?? []) as { competencia: string }[]) set.add(g.competencia);
  return [...set].sort();
}

/* ============================================================
   Notificações
   ============================================================ */

export interface Notificacao {
  id: string;
  etapa: string;
  detalhe: string;
  porNome: string;
  em: string;
  /** Para onde o aviso leva ao ser aberto. */
  rota: string;
  naoLida: boolean;
}

/**
 * O que mudou desde a última vez que a pessoa olhou.
 *
 * O direcionamento é da RLS: a policy de `solicitacao_eventos` já entrega só os
 * eventos que este papel pode ver — os próprios pedidos e trocas para o
 * colaborador, a equipe para o gestor, a conta para o planejamento. Por isso a
 * consulta não filtra por destinatário: não existe destinatário a filtrar.
 *
 * Eventos causados pela própria pessoa ficam de fora — ninguém precisa ser
 * avisado do que acabou de fazer.
 */
/**
 * O que ainda falta a pessoa ler no sino.
 *
 * Só o não lido. Um sino que mantém na lista o que já foi aberto vira um
 * histórico que ninguém pediu, e o número ao lado dele deixa de significar
 * "tem coisa nova" — que é a única pergunta que um sino responde.
 *
 * "Lido" tem duas formas, e as duas contam: a leitura item a item
 * (`notificacoes_lidas`, gravada ao abrir um aviso) e o corte em massa
 * (`perfis.notificacoes_vistas_em`, gravado por "Marcar como lidas"). Manter as
 * duas evita inserir uma linha por item toda vez que alguém zera o sino inteiro.
 */
export async function listarNotificacoes(
  usuarioId: string,
  vistasEm: string,
  limite = 20,
): Promise<{ itens: Notificacao[]; naoLidas: number }> {
  const supabase = await createClient();

  // Duas fontes. `solicitacao_eventos` é o andamento dos pedidos, recortado por
  // RLS conforme o papel. `avisos` é o que tem destinatário explícito — mudança
  // na escala publicada, comunicado novo. O sino junta as duas e ordena por
  // data, porque para quem lê é tudo "o que aconteceu comigo".
  const [eventosRes, avisosRes] = await Promise.all([
    supabase
      .from('solicitacao_eventos')
      .select('id, solicitacao_id, etapa, detalhe, por_id, por_nome, em, solicitacoes(tipo, data, colaborador_id)')
      .neq('por_id', usuarioId)
      .order('em', { ascending: false })
      .limit(limite),
    supabase
      .from('avisos')
      .select('id, titulo, detalhe, rota, por_nome, em:criado_em')
      .order('criado_em', { ascending: false })
      .limit(limite),
  ]);

  type LinhaEvento = {
    id: number; solicitacao_id: number; etapa: string; detalhe: string;
    por_nome: string; em: string;
    solicitacoes: { tipo: string; data: string; colaborador_id: number } | null;
  };
  type LinhaAviso = {
    id: number; titulo: string; detalhe: string; rota: string; por_nome: string; em: string;
  };

  const eventos = (conferir('listarNotificacoes/eventos', eventosRes) ?? []) as unknown as LinhaEvento[];
  const avisos = (conferir('listarNotificacoes/avisos', avisosRes) ?? []) as unknown as LinhaAviso[];

  const lidas = new Set(((conferir('listarNotificacoes/lidas', await supabase
    .from('notificacoes_lidas')
    .select('chave')) ?? []) as { chave: string }[]).map(l => l.chave));

  const ids = [...new Set(eventos.map(e => e.solicitacoes?.colaborador_id).filter((n): n is number => !!n))];
  const pessoas = ids.length
    ? conferir('listarNotificacoes/colaboradores', await supabase
        .from('colaboradores').select('id, nome').in('id', ids)) ?? []
    : [];
  const nomePorId = new Map((pessoas as { id: number; nome: string }[]).map(c => [c.id, c.nome]));

  const deEventos: Notificacao[] = eventos.map(e => {
    const tipo = e.solicitacoes?.tipo ?? '';
    const quando = e.solicitacoes?.data ?? '';
    const quem = nomePorId.get(e.solicitacoes?.colaborador_id ?? -1) ?? '';
    return {
      id: `evento-${e.id}`,
      etapa: e.etapa,
      detalhe: [TIPOS_SOLICITACAO[tipo as TipoSolicitacao]?.label ?? 'Solicitação',
                quando && `de ${formatarData(quando)}`, quem].filter(Boolean).join(' · '),
      porNome: e.por_nome,
      em: e.em,
      rota: '/solicitacoes',
      naoLida: e.em > vistasEm,
    };
  });

  const deAvisos: Notificacao[] = avisos.map(a => ({
    id: `aviso-${a.id}`,
    etapa: a.titulo,
    detalhe: a.detalhe,
    porNome: a.por_nome,
    em: a.em,
    rota: a.rota,
    naoLida: a.em > vistasEm,
  }));

  const itens = [...deEventos, ...deAvisos]
    .filter(i => i.naoLida && !lidas.has(i.id))
    .sort((x, y) => y.em.localeCompare(x.em))
    .slice(0, limite);

  // Todos os itens da lista são, por construção, não lidos — o contador é o
  // tamanho dela. Ele não pode divergir do que a pessoa vê ao abrir o painel:
  // sino marcando 3 sobre uma lista de 1 foi exatamente a queixa que trouxe
  // esta mudança.
  return { itens, naoLidas: itens.length };
}

/** Uma ausência de outra pessoa que cai dentro do período pedido. */
export interface AusenciaSobreposta {
  colaboradorId: number;
  nome: string;
  tipo: 'FERIAS' | 'AUSENCIA';
  motivo: string;
  inicio: string;
  fim: string;
}

/**
 * Quem mais está fora no período — o contexto que falta para decidir férias.
 *
 * O gestor decidia com um pedido isolado na tela e nenhuma noção de quantos da
 * equipe já estavam fora naquelas semanas. A informação existia (em Planos, mês
 * a mês), mas exigia sair da decisão para procurá-la, e na prática ninguém saía:
 * aprovava-se, e o buraco aparecia na semana da folha.
 *
 * A RLS já recorta — o gestor enxerga a equipe dele. O pedido em questão sai da
 * lista, senão a pessoa apareceria como concorrente de si mesma.
 */
export async function listarAusenciasSobrepostas(
  inicio: string,
  fim: string,
  exceto: number,
): Promise<AusenciaSobreposta[]> {
  const supabase = await createClient();

  // `ausencias` guarda início e duração, não fim, então a consulta não consegue
  // filtrar o fim no banco: busca uma janela generosa para trás e recorta aqui.
  const linhas = conferir('listarAusenciasSobrepostas', await supabase
    .from('ausencias')
    .select('colaborador_id, tipo, motivo, inicio, dias, colaboradores(nome)')
    .lte('inicio', fim)
    .gte('inicio', addDias(inicio, -365))) ?? [];

  return (linhas as unknown as {
    colaborador_id: number; tipo: 'FERIAS' | 'AUSENCIA'; motivo: string | null;
    inicio: string; dias: number; colaboradores: { nome: string } | null;
  }[])
    .filter(a => a.colaborador_id !== exceto)
    .map(a => ({
      colaboradorId: a.colaborador_id,
      nome: a.colaboradores?.nome ?? `Colaborador ${a.colaborador_id}`,
      tipo: a.tipo,
      motivo: a.motivo ?? '',
      inicio: a.inicio,
      fim: addDias(a.inicio, Math.max(1, a.dias) - 1),
    }))
    .filter(a => a.fim >= inicio)
    .sort((x, y) => x.inicio.localeCompare(y.inicio) || x.nome.localeCompare(y.nome));
}

/** Uma alteração feita na escala publicada e ainda não comunicada. */
export interface AlteracaoPendente {
  id: number;
  colaboradorId: number;
  colaboradorNome: string;
  data: string;
  de: string;
  para: string;
  porNome: string;
}

/** A caixa de saída da geração: o que mudou e ainda não foi avisado. */
export async function listarAlteracoesPendentes(geracaoId: number): Promise<AlteracaoPendente[]> {
  const supabase = await createClient();
  const linhas = conferir('listarAlteracoesPendentes', await supabase
    .from('alteracoes_pendentes')
    .select('id, colaborador_id, data, de, para, por_nome, colaboradores(nome)')
    .eq('geracao_id', geracaoId)
    .order('data')) ?? [];

  return (linhas as unknown as {
    id: number; colaborador_id: number; data: string; de: string; para: string;
    por_nome: string; colaboradores: { nome: string } | null;
  }[]).map(l => ({
    id: l.id,
    colaboradorId: l.colaborador_id,
    colaboradorNome: l.colaboradores?.nome ?? `Colaborador ${l.colaborador_id}`,
    data: l.data,
    de: l.de,
    para: l.para,
    porNome: l.por_nome,
  }));
}
