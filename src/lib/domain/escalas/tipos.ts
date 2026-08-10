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
}

export interface CapacidadeOverride {
  unidadeId: number;
  dow: number | null;
  data: string | null;
  total: number;
  reservadas: number;
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
  colaboradores: Colaborador[];
  planos: PlanoMensal[];
  ausencias: Ausencia[];
  capacidades: CapacidadeOverride[];
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
