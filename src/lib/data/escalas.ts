import { createClient } from '@/lib/supabase/server';
import { gerarEscala } from '@/lib/domain/escalas/motor';
import { checarPlanos, type Pendencia } from '@/lib/domain/escalas/validacao';
import { addDias, diasNoMes, iso, partesIso } from '@/lib/domain/escalas/datas';
import type {
  Alocacao, Ausencia, Aviso, Colaborador, Equipe, GerarEscalaOutput,
  Modalidade, PlanoMensal, StatusGeracao, Unidade,
} from '@/lib/domain/escalas/tipos';
import type { StatusSolicitacao, TipoOcorrencia, TipoSolicitacao } from '@/lib/domain/escalas/constantes';

/* ============================================================
   Linhas cruas do banco → tipos de domínio
   ============================================================ */

interface LinhaUnidade {
  id: number; codigo: string; nome: string; sigla: string; cor: string; bg: string;
  capacidade_total: number; capacidade_reservadas: number; ordem: number; ativa: boolean;
  pai_id: number | null;
}

interface LinhaColaborador {
  id: number; perfil_id: string | null; nome: string; matricula: string; email: string;
  cargo: string; equipe_id: number; gestor_id: string | null; regime: '12x36' | '5x2';
  turno: 'D' | 'N'; ciclo: 'IMPAR' | 'PAR' | null; entrada: string; jornada: number;
  unidade_base_id: number; eleg_home: boolean; eleg_externo: boolean; sexta_reduzida: boolean;
  status: 'ativo' | 'afastado' | 'desligado'; admissao: string; desligamento: string | null;
}

interface LinhaPlano {
  id: number; colaborador_id: number; competencia: string; ciclo: 'IMPAR' | 'PAR' | null;
  ho_modo: 'FIXO' | 'COTA' | null; ho_dias_semana: number[]; ho_quantidade: number;
  ho_dias_preferencia: number[]; ho_dias_proibidos: number[];
  plano_distribuicao: { unidade_id: number; percentual: number }[] | null;
  plano_unidade_fixa: { dow: number; unidade_id: number }[] | null;
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
  detalhe: string;
  parceiroId: number | null;
  parceiroNome: string | null;
  aceiteParceiro: 'PENDENTE' | 'ACEITO' | 'RECUSADO' | null;
  unidadeDesejadaId: number | null;
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
  ordem: u.ordem, ativa: u.ativa, paiId: u.pai_id ?? null,
});

const paraColaborador = (c: LinhaColaborador): Colaborador => ({
  id: c.id, perfilId: c.perfil_id, nome: c.nome, matricula: c.matricula, email: c.email,
  cargo: c.cargo, equipeId: c.equipe_id, gestorId: c.gestor_id, regime: c.regime, turno: c.turno,
  ciclo: c.ciclo, entrada: (c.entrada ?? '08:00').slice(0, 5), jornada: Number(c.jornada),
  unidadeBaseId: c.unidade_base_id, elegHome: c.eleg_home, elegExterno: c.eleg_externo,
  sextaReduzida: c.sexta_reduzida, status: c.status, admissao: c.admissao, desligamento: c.desligamento,
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
});

/* ============================================================
   Leituras
   ============================================================ */

export async function listarUnidades(): Promise<Unidade[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('unidades').select('*').order('ordem').order('id');
  return ((data ?? []) as LinhaUnidade[]).map(paraUnidade);
}

export async function listarEquipes(): Promise<Equipe[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('equipes').select('*').order('nome');
  return ((data ?? []) as { id: number; codigo: string; nome: string; regime: '12x36' | '5x2'; turno: 'D' | 'N'; gestor_id: string | null }[])
    .map(e => ({ id: e.id, codigo: e.codigo, nome: e.nome, regime: e.regime, turno: e.turno, gestorId: e.gestor_id }));
}

export async function listarColaboradores(): Promise<Colaborador[]> {
  const supabase = await createClient();
  const { data } = await supabase.from('colaboradores').select('*').order('nome');
  return ((data ?? []) as LinhaColaborador[]).map(paraColaborador);
}

export async function listarFeriados(ano?: number): Promise<{ data: string; nome: string }[]> {
  const supabase = await createClient();
  let q = supabase.from('feriados').select('data, nome').order('data');
  if (ano) q = q.gte('data', `${ano}-01-01`).lte('data', `${ano}-12-31`);
  const { data } = await q;
  return (data ?? []) as { data: string; nome: string }[];
}

export interface ConfigEscalas {
  cicloAncora: string;
  toleranciaAderencia: number;
  coberturaMinima: number;
}

export async function getConfig(contaId: string): Promise<ConfigEscalas> {
  const supabase = await createClient();
  const { data } = await supabase.from('config').select('*').eq('conta_id', contaId).maybeSingle();
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
  capacidades: { unidadeId: number; dow: number | null; data: string | null; total: number; reservadas: number }[];
  feriados: Record<string, string>;
  pins: { colaboradorId: number; data: string; modalidade: Modalidade; unidadeId: number | null }[];
  config: ConfigEscalas;
}

export async function carregarContextoMes(competencia: string, contaId: string): Promise<ContextoMes> {
  const supabase = await createClient();
  const [ano, mes] = partesIso(competencia);
  const primeiro = competencia;
  const ultimo = iso(ano, mes, diasNoMes(ano, mes));

  const [unidades, equipes, colaboradores, config, planosRes, ausRes, capRes, ferRes, pinRes] = await Promise.all([
    listarUnidades(),
    listarEquipes(),
    listarColaboradores(),
    getConfig(contaId),
    supabase
      .from('planos')
      .select('*, plano_distribuicao(unidade_id, percentual), plano_unidade_fixa(dow, unidade_id)')
      .eq('competencia', competencia),
    // Ausências que interceptam o mês, mesmo tendo começado antes dele.
    supabase
      .from('ausencias')
      .select('*')
      .lte('inicio', ultimo)
      .gte('inicio', addDias(primeiro, -365)),
    supabase.from('capacidades').select('*'),
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
    planos: ((planosRes.data ?? []) as LinhaPlano[]).map(paraPlano),
    ausencias,
    capacidades: ((capRes.data ?? []) as { unidade_id: number; dow: number | null; data: string | null; total: number; reservadas: number }[])
      .map(c => ({ unidadeId: c.unidade_id, dow: c.dow, data: c.data, total: c.total, reservadas: c.reservadas })),
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
    colaboradores: ctx.colaboradores,
    planos: ctx.planos,
    ausencias: ctx.ausencias,
    capacidades: ctx.capacidades,
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
  const { data } = await supabase
    .from('geracoes')
    .select('*')
    .eq('competencia', competencia)
    .eq('atual', true)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id, competencia: data.competencia, versao: data.versao, status: data.status,
    escopo: data.escopo, conflitos: data.conflitos ?? [], alertas: data.alertas ?? [],
    aderencia: data.aderencia ?? [], geradaEm: data.gerada_em, geradaPorNome: data.gerada_por_nome,
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
      .select('colaborador_id, data, modalidade, unidade_id, travado')
      .eq('geracao_id', geracaoId)
      .order('data')
      .order('colaborador_id')
      .range(de, de + passo - 1);
    if (error || !data || data.length === 0) break;
    linhas.push(...(data as { colaborador_id: number; data: string; modalidade: Modalidade; unidade_id: number | null; travado: boolean }[])
      .map(a => ({ colaboradorId: a.colaborador_id, data: a.data, modalidade: a.modalidade, unidadeId: a.unidade_id, travado: a.travado })));
    if (data.length < passo) break;
  }
  return linhas;
}

export async function listarSolicitacoes(): Promise<Solicitacao[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('solicitacoes')
    .select(`*,
      colaborador:colaboradores!solicitacoes_colaborador_id_fkey(id, nome, equipe_id),
      parceiro:colaboradores!solicitacoes_parceiro_id_fkey(id, nome),
      solicitacao_eventos(etapa, detalhe, por_nome, em)`)
    .order('criado_em', { ascending: false });

  type Linha = {
    id: number; colaborador_id: number; tipo: TipoSolicitacao; data: string; detalhe: string;
    parceiro_id: number | null; aceite_parceiro: 'PENDENTE' | 'ACEITO' | 'RECUSADO' | null;
    unidade_desejada_id: number | null; status: StatusSolicitacao; posicao_fila: number | null;
    motivo_recusa: string | null; aplicada: boolean; criado_em: string;
    colaborador: { id: number; nome: string; equipe_id: number } | null;
    parceiro: { id: number; nome: string } | null;
    solicitacao_eventos: { etapa: string; detalhe: string; por_nome: string; em: string }[] | null;
  };

  return ((data ?? []) as Linha[]).map(s => ({
    id: s.id,
    colaboradorId: s.colaborador_id,
    colaboradorNome: s.colaborador?.nome ?? '—',
    equipeId: s.colaborador?.equipe_id ?? null,
    tipo: s.tipo,
    data: s.data,
    detalhe: s.detalhe,
    parceiroId: s.parceiro_id,
    parceiroNome: s.parceiro?.nome ?? null,
    aceiteParceiro: s.aceite_parceiro,
    unidadeDesejadaId: s.unidade_desejada_id,
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
  const { data } = await q;
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
  const { data } = await supabase
    .from('logs')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(limite);
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
