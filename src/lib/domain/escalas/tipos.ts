export type Regime = '12x36' | '5x2';
export type Turno = 'D' | 'N';
export type Ciclo = 'IMPAR' | 'PAR';
export type StatusColaborador = 'ativo' | 'afastado' | 'desligado';
export type ModoHomeOffice = 'FIXO' | 'COTA';
export type StatusGeracao = 'rascunho' | 'publicada' | 'encerrada';
export type PapelEscalas = 'planejamento' | 'gestor' | 'colaborador';

/** Categorias de alocação de um dia. UNIDADE é a única que exige `unidadeId`. */
export type Modalidade =
  | 'UNIDADE'
  | 'HOME'
  | 'EXTERNO'
  | 'EVENTO'
  | 'TREINA'
  | 'FERIAS'
  | 'FOLGA'
  | 'FERIADO'
  | 'AFAST'
  | 'DESCANSO';

export interface Unidade {
  id: number;
  codigo: string;
  nome: string;
  sigla: string;
  cor: string;
  bg: string;
  capacidadeTotal: number;
  capacidadeReservadas: number;
  ordem: number;
  ativa: boolean;
}

/**
 * Função exercida dentro de uma unidade — o Corpo Clínico dentro do Morumbi.
 *
 * Não é lugar concorrente da unidade: quem está no posto ocupa uma posição
 * normal do Morumbi. O posto só registra o que a pessoa faz ali, então não
 * entra na capacidade nem na distribuição percentual.
 */
export interface Posto {
  id: number;
  unidadeId: number;
  nome: string;
  vagas: number;
  ativo: boolean;
}

/**
 * Atribuição do posto no plano do mês: N dias úteis contíguos a partir da
 * segunda-feira. `semana` nula deixa o motor escolher, que é o que permite
 * rodiziar o posto entre as pessoas sem alocação manual.
 */
export interface PostoDoPlano {
  postoId: number;
  dias: number;
  semana: number | null;
}

export interface Equipe {
  id: number;
  codigo: string;
  nome: string;
  regime: Regime;
  turno: Turno;
  gestorId: string | null;
}

export interface Colaborador {
  id: number;
  perfilId: string | null;
  nome: string;
  matricula: string;
  email: string;
  cargo: string;
  equipeId: number;
  gestorId: string | null;
  regime: Regime;
  turno: Turno;
  ciclo: Ciclo | null;
  entrada: string;
  jornada: number;
  unidadeBaseId: number;
  elegHome: boolean;
  elegExterno: boolean;
  sextaReduzida: boolean;
  status: StatusColaborador;
  admissao: string;
  desligamento: string | null;
}

export interface Ausencia {
  id: number;
  colaboradorId: number;
  tipo: 'FERIAS' | 'AUSENCIA';
  inicio: string;
  dias: number;
  grupo: string;
  motivo: string;
}

export interface HomeOffice {
  modo: ModoHomeOffice | null;
  diasSemana: number[];
  quantidade: number;
  diasPreferencia: number[];
  diasProibidos: number[];
}

export interface PlanoMensal {
  id: number;
  colaboradorId: number;
  competencia: string;
  ciclo: Ciclo | null;
  homeOffice: HomeOffice;
  /** unidadeId -> percentual (deve somar 100 entre as unidades ativas). */
  distribuicao: Record<number, number>;
  /** dia da semana (0-6) -> unidadeId travado. */
  unidadesFixas: Record<number, number>;
  /** Postos que esta pessoa cobre no mês. */
  postos: PostoDoPlano[];
}

export interface CapacidadeOverride {
  unidadeId: number;
  dow: number | null;
  data: string | null;
  total: number;
  reservadas: number;
}

/**
 * Teto de pessoas de uma equipe numa unidade — "no Morumbi cabem 5 técnicos
 * 12x36 e 3 analistas".
 *
 * `dow` nulo vale para todos os dias; um dia da semana específico tem
 * precedência sobre o geral. Par (unidade, equipe) sem cota não tem teto
 * próprio: só a capacidade da unidade limita, então quem não precisa da regra
 * não cadastra nada.
 *
 * É um teto, não uma reserva ociosa. Quando as cotas somam a capacidade livre
 * da unidade, o teto vira garantia na prática: se os analistas já bateram 3, um
 * quarto analista não ocupa o lugar que sobrou de técnico.
 */
export interface CotaEquipe {
  unidadeId: number;
  equipeId: number;
  dow: number | null;
  limite: number;
}

export interface Pin {
  colaboradorId: number;
  data: string;
  modalidade: Modalidade;
  unidadeId: number | null;
}

export interface Alocacao {
  colaboradorId: number;
  data: string;
  modalidade: Modalidade;
  unidadeId: number | null;
  travado: boolean;
  /** Preenchido quando a pessoa está cobrindo um posto naquele dia. */
  postoId: number | null;
}

export interface Aviso {
  nivel: 'erro' | 'aviso';
  colaboradorId?: number;
  colaborador?: string;
  data?: string;
  msg: string;
}

export interface DesvioUnidade {
  unidadeId: number;
  planejado: number;
  realizado: number;
}

export interface Aderencia {
  colaboradorId: number;
  colaborador: string;
  desvios: DesvioUnidade[];
  ok: boolean;
}

export interface GerarEscalaInput {
  ano: number;
  /** 0-11, como em Date. */
  mes: number;
  unidades: Unidade[];
  /** Só id e nome interessam ao motor — o nome entra nas mensagens de conflito. */
  equipes: { id: number; nome: string }[];
  postos: Posto[];
  colaboradores: Colaborador[];
  planos: PlanoMensal[];
  ausencias: Ausencia[];
  capacidades: CapacidadeOverride[];
  cotasEquipe: CotaEquipe[];
  feriados: Record<string, string>;
  pins: Pin[];
  /** Mês âncora do ciclo 12x36 no formato YYYY-MM-DD (dia 1º). */
  cicloAncora: string;
  toleranciaAderencia: number;
  coberturaMinima: number;
}

export interface GerarEscalaOutput {
  alocacoes: Alocacao[];
  conflitos: Aviso[];
  alertas: Aviso[];
  /** data -> unidadeId -> pessoas alocadas. */
  ocupacao: Record<string, Record<number, number>>;
  /** data -> unidadeId -> posições operacionais no dia. */
  capacidadeDia: Record<string, Record<number, number>>;
  aderencia: Aderencia[];
  metas: Record<number, Record<number, number>>;
}
