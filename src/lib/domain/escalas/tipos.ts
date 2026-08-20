export type Regime = '12x36' | '5x2';
export type Turno = 'D' | 'N';
export type Ciclo = 'IMPAR' | 'PAR';
export type StatusColaborador = 'ativo' | 'afastado' | 'desligado';
export type ModoHomeOffice = 'FIXO' | 'COTA';
export type StatusGeracao = 'rascunho' | 'publicada' | 'encerrada';
/**
 * Os cinco papéis, em ordem decrescente de alcance.
 *
 * `admin_geral` responde pelo sistema: cria as áreas e o administrador de cada
 * uma, e deliberadamente NÃO enxerga o que acontece dentro delas. `admin_local`
 * responde por uma área: cria o Planejamento e cuida dos cadastros de base, mas
 * não monta plano nem gera escala. Do Planejamento para baixo nada mudou.
 */
export type PapelEscalas =
  | 'admin_geral'
  | 'admin_local'
  | 'planejamento'
  | 'gestor'
  | 'colaborador';

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
  /**
   * Equipe que cobre o posto. Nulo = qualquer equipe.
   *
   * O posto é do time que exerce a função — quem cobre enfermagem é da
   * enfermagem. Isto FILTRA quem pode ser marcado; QUEM cobre e por quantos
   * dias continua sendo decidido no plano do mês de cada pessoa.
   */
  equipeId: number | null;
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
  /**
   * Falso para a equipe que só usa o fluxo de solicitações.
   *
   * Os colaboradores dela não entram na geração e, por consequência, não ocupam
   * posição em unidade nenhuma — a capacidade do prédio vale só para quem é
   * escalado. Eles seguem pedindo férias, folga e licença normalmente.
   */
  naEscala: boolean;
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
  /**
   * Ciclo base do 12x36, quando algum dia foi cadastrado.
   *
   * Não é mais pedido no cadastro: quem manda é `PlanoMensal.ciclo`, que o
   * motor lê primeiro e que a validação de plano exige antes de deixar gerar.
   * O campo sobrevive como histórico do que já existia.
   */
  ciclo: Ciclo | null;
  /** Horários reais de trabalho. A duração é a diferença entre os dois. */
  entrada: string;
  saida: string;
  unidadeBaseId: number;
  elegHome: boolean;
  elegExterno: boolean;
  sextaReduzida: boolean;
  status: StatusColaborador;
  /**
   * Por que foi inativado — chave de MOTIVOS_INATIVACAO, vazio quando ativo.
   * Opcional porque é dado de cadastro: o motor decide por `status` e nunca
   * lê o motivo, então exigi-lo obrigaria toda fixture de teste a inventar um.
   */
  motivoStatus?: string;
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
  /**
   * Competência de onde as regras vieram, quando este mês não tem plano próprio
   * e herdou o do mês anterior. Ausente quando o plano foi salvo neste mês.
   *
   * O motor ignora este campo — é informação para a tela dizer de onde a regra
   * veio. Sem ela, plano herdado e plano conferido ficam indistinguíveis, e a
   * diferença importa: um foi decidido para este mês, o outro só não foi
   * revisado ainda.
   */
  herdadoDe?: string | null;
}

export interface CapacidadeOverride {
  unidadeId: number;
  dow: number | null;
  data: string | null;
  total: number;
  reservadas: number;
}

/**
 * PISO de pessoas de uma equipe numa unidade — "no Morumbi preciso de pelo
 * menos 3 técnicos 12x36 todo dia".
 *
 * `dow` nulo vale para todos os dias; um dia da semana específico tem
 * precedência sobre o geral. Par (unidade, equipe) sem cota não tem exigência:
 * a unidade se vira com quem a distribuição mandar.
 *
 * É mínimo, não máximo. O motor serve estas vagas ANTES da distribuição
 * percentual e avisa quando não conseguir preenchê-las — não há teto por
 * equipe: quem limita quantos cabem é a capacidade da unidade.
 */
export interface CotaEquipe {
  unidadeId: number;
  equipeId: number;
  dow: number | null;
  minimo: number;
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
  /**
   * O nome entra nas mensagens de conflito; `naEscala` decide quem é escalado.
   * A equipe fora da escala continua na lista para que suas cotas e mensagens
   * façam sentido caso alguém as consulte — o que o motor faz é não alocar
   * ninguém dela.
   */
  equipes: { id: number; nome: string; naEscala: boolean }[];
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
