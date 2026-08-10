import type { Modalidade } from './tipos';

/**
 * Catálogo das modalidades que não são unidade física. As unidades entram como
 * modalidade 'UNIDADE' e trazem rótulo, sigla e cores da própria linha em
 * `unidades` — por isso não aparecem aqui.
 */
export const MODALIDADES: Record<
  Exclude<Modalidade, 'UNIDADE'>,
  { label: string; sigla: string; cor: string; bg: string; tipo: 'REMOTO' | 'AUSENCIA' }
> = {
  HOME: { label: 'Home Office', sigla: 'HO', cor: '#6D28D9', bg: '#EDE9FE', tipo: 'REMOTO' },
  EXTERNO: { label: 'Trabalho Externo', sigla: 'EXT', cor: '#0A6E8A', bg: '#CFFAFE', tipo: 'REMOTO' },
  EVENTO: { label: 'Evento', sigla: 'EVT', cor: '#C2410C', bg: '#FFEDD5', tipo: 'REMOTO' },
  TREINA: { label: 'Treinamento', sigla: 'TRE', cor: '#7C3AED', bg: '#F3E8FF', tipo: 'REMOTO' },
  FERIAS: { label: 'Férias', sigla: 'FÉR', cor: '#B45309', bg: '#FEF3C7', tipo: 'AUSENCIA' },
  FOLGA: { label: 'Ausência', sigla: 'AUS', cor: '#526176', bg: '#F1F5F9', tipo: 'AUSENCIA' },
  FERIADO: { label: 'Feriado', sigla: 'FRD', cor: '#A16207', bg: '#FEF9C3', tipo: 'AUSENCIA' },
  AFAST: { label: 'Afastamento', sigla: 'AFA', cor: '#BE123C', bg: '#FFE4E9', tipo: 'AUSENCIA' },
  DESCANSO: { label: 'Descanso', sigla: '—', cor: '#5B6B80', bg: '#F1F5F9', tipo: 'AUSENCIA' },
};

export const MODALIDADES_AUSENCIA: Modalidade[] = ['FERIAS', 'FOLGA', 'FERIADO', 'AFAST', 'DESCANSO'];

export function ehAusencia(m: Modalidade): boolean {
  return MODALIDADES_AUSENCIA.includes(m);
}

/** Dia em que a pessoa efetivamente trabalha (presencial ou remoto). */
export function ehDiaTrabalhado(m: Modalidade): boolean {
  return !ehAusencia(m);
}

export const GRUPOS_AUSENCIA: { grupo: string; motivos: string[] }[] = [
  { grupo: 'Folga', motivos: ['Aniversário', 'Banco de Horas', 'Profissional da Saúde', 'Compensação', 'Doação de Sangue'] },
  { grupo: 'Licença', motivos: ['Nojo (falecimento)', 'Gala (casamento)', 'Paternidade', 'Maternidade', 'Sem vencimento'] },
  { grupo: 'Atestado', motivos: ['Atestado médico', 'Consulta', 'Acompanhamento familiar'] },
  { grupo: 'Outros', motivos: ['Convocação legal', 'Suspensão', 'Outros'] },
];

/** Motivos de saúde só aparecem para Planejamento e gestor direto (LGPD). */
export const GRUPOS_SENSIVEIS = ['Atestado'];

export type TipoSolicitacao =
  | 'AJUSTE_PONTO' | 'BANCO_HORAS' | 'FERIAS' | 'FOLGA' | 'ATRASO'
  | 'PAUSA' | 'SAIDA_ANTEC' | 'TROCA_HORARIO' | 'TROCA_UNIDADE';

export const TIPOS_SOLICITACAO: Record<TipoSolicitacao, { label: string; fila: boolean; sla: number }> = {
  AJUSTE_PONTO: { label: 'Ajuste de Ponto', fila: false, sla: 48 },
  BANCO_HORAS: { label: 'Banco de Horas', fila: false, sla: 72 },
  FERIAS: { label: 'Férias', fila: false, sla: 120 },
  FOLGA: { label: 'Folgas', fila: false, sla: 48 },
  ATRASO: { label: 'Justificativa de Atraso', fila: false, sla: 24 },
  PAUSA: { label: 'Pausas', fila: false, sla: 24 },
  SAIDA_ANTEC: { label: 'Saída Antecipada', fila: false, sla: 24 },
  TROCA_HORARIO: { label: 'Troca de Horário', fila: true, sla: 48 },
  TROCA_UNIDADE: { label: 'Troca de Unidade', fila: true, sla: 72 },
};

export type StatusSolicitacao =
  | 'AGUARDA_PARCEIRO' | 'TRIAGEM' | 'GESTOR' | 'FILA' | 'APROVADA' | 'RECUSADA';

export const STATUS_SOLICITACAO: Record<StatusSolicitacao, { label: string; cor: string; bg: string }> = {
  AGUARDA_PARCEIRO: { label: 'Aguarda parceiro', cor: '#6D28D9', bg: '#EDE9FE' },
  TRIAGEM: { label: 'Em triagem', cor: '#1A4E93', bg: '#DCEAF8' },
  GESTOR: { label: 'Com o gestor', cor: '#B45309', bg: '#FEF3C7' },
  FILA: { label: 'Lista de espera', cor: '#0A6169', bg: '#D7F0F1' },
  APROVADA: { label: 'Aprovada', cor: '#15803D', bg: '#DCFCE7' },
  RECUSADA: { label: 'Recusada', cor: '#BE123C', bg: '#FFE4E9' },
};

export const STATUS_ABERTOS: StatusSolicitacao[] = ['AGUARDA_PARCEIRO', 'TRIAGEM', 'GESTOR', 'FILA'];

export type TipoOcorrencia =
  | 'ATRASO' | 'FALTA_J' | 'FALTA_I' | 'SAIDA_ANTEC'
  | 'PAUSA_EXC' | 'SEM_MARCACAO' | 'TROCA' | 'OBS';

export const TIPOS_OCORRENCIA: Record<TipoOcorrencia, { label: string; cor: string; pedeMinutos: boolean }> = {
  ATRASO: { label: 'Atraso', cor: '#B45309', pedeMinutos: true },
  FALTA_J: { label: 'Falta justificada', cor: '#64748B', pedeMinutos: false },
  FALTA_I: { label: 'Falta injustificada', cor: '#BE123C', pedeMinutos: false },
  SAIDA_ANTEC: { label: 'Saída antecipada', cor: '#B45309', pedeMinutos: true },
  PAUSA_EXC: { label: 'Pausa excedida', cor: '#B45309', pedeMinutos: true },
  SEM_MARCACAO: { label: 'Ausência de marcação', cor: '#6D28D9', pedeMinutos: false },
  TROCA: { label: 'Troca realizada', cor: '#2463B5', pedeMinutos: false },
  OBS: { label: 'Observação', cor: '#64748B', pedeMinutos: false },
};

export const CARGOS = [
  'Técnico I', 'Técnico II', 'Técnico III',
  'Analista Jr', 'Analista Pl', 'Analista Sr',
  'Especialista', 'Líder', 'Aprendiz',
];

/** Degraus permitidos na distribuição por unidade — sem digitação livre. */
export const DEGRAUS_PCT = [0, 25, 50, 75, 100];

export const STATUS_GERACAO: Record<string, { label: string; cor: string; bg: string }> = {
  rascunho: { label: 'Rascunho', cor: '#B45309', bg: '#FEF3C7' },
  publicada: { label: 'Publicada', cor: '#15803D', bg: '#DCFCE7' },
  encerrada: { label: 'Encerrada', cor: '#64748B', bg: '#F1F5F9' },
};

/** Documentação da precedência aplicada pelo motor, na ordem em que roda. */
export const REGRAS_MOTOR: { n: number; titulo: string; desc: string; rigida: boolean }[] = [
  { n: 1, titulo: 'Travas manuais', desc: 'Um ajuste travado no calendário é decisão já tomada: o motor o respeita antes de qualquer regra e o conta na ocupação da unidade.', rigida: true },
  { n: 2, titulo: 'Férias', desc: 'Bloqueio absoluto. Nenhuma outra regra reabre o dia.', rigida: true },
  { n: 3, titulo: 'Ausências', desc: 'Folga, licença, atestado e afastamento bloqueiam o dia, mesmo que iniciados em outro mês.', rigida: true },
  { n: 4, titulo: 'Regime de trabalho', desc: '12x36 alterna dias pares/ímpares a partir do ciclo do mês; 5x2 trabalha de segunda a sexta e folga em feriado.', rigida: true },
  { n: 5, titulo: 'Home office fixo', desc: 'Dias da semana marcados como home office não entram na distribuição por unidade.', rigida: true },
  { n: 6, titulo: 'Unidade fixa por dia da semana', desc: 'Ex.: toda terça na Paulista. Ocupa posição e sai da distribuição percentual livre.', rigida: true },
  { n: 7, titulo: 'Capacidade da unidade', desc: 'Nunca aloca acima das posições operacionais (total menos reservadas). Quem ocupa um posto interno ocupa lugar também na unidade que o contém, então o prédio cheio bloqueia o posto. Quem não couber vira Trabalho Externo com conflito registrado.', rigida: true },
  { n: 8, titulo: 'Cota de posições por equipe', desc: 'Teto de pessoas de cada equipe por unidade, opcionalmente por dia da semana. Quando as cotas somam a capacidade livre, o teto vira garantia: a vaga de uma equipe não é ocupada por outra.', rigida: true },
  { n: 9, titulo: 'Cota semanal de home office', desc: 'A quantidade é rígida; o dia é flexível. Dias proibidos nunca são usados.', rigida: true },
  { n: 10, titulo: 'Distribuição percentual', desc: 'Reparte os dias presenciais entre as unidades pelo método do maior resto, dentro da tolerância configurada.', rigida: false },
  { n: 11, titulo: 'Preferência de home office', desc: 'Tenta usar os dias preferidos antes de qualquer outro dia elegível.', rigida: false },
  { n: 12, titulo: 'Balanceamento e cobertura', desc: 'Evita concentrar a mesma equipe numa unidade e avisa quando a cobertura mínima do dia não é atingida. A cobertura mínima só é cobrada das unidades principais.', rigida: false },
];

/**
 * Famílias de cargo que o motor usa para desempatar.
 *
 * A regra da operação: analista tem prioridade no home office, técnico tem
 * prioridade na posição presencial — o técnico é quem precisa estar perto do
 * equipamento. Derivado do prefixo porque CARGOS é uma lista fechada do próprio
 * sistema; cargo fora dela cai em 'OUTRO' e não recebe nem perde prioridade.
 */
export type FamiliaCargo = 'TECNICO' | 'ANALISTA' | 'OUTRO';

export function familiaDoCargo(cargo: string): FamiliaCargo {
  const c = cargo.trim().toLowerCase();
  if (c.startsWith('técnico') || c.startsWith('tecnico')) return 'TECNICO';
  if (c.startsWith('analista')) return 'ANALISTA';
  return 'OUTRO';
}

/** Menor vem primeiro na disputa por home office. */
export function ordemHomeOffice(cargo: string): number {
  const f = familiaDoCargo(cargo);
  return f === 'ANALISTA' ? 0 : f === 'OUTRO' ? 1 : 2;
}

/** Menor vem primeiro na disputa por posição presencial. */
export function ordemPresencial(cargo: string): number {
  const f = familiaDoCargo(cargo);
  return f === 'TECNICO' ? 0 : f === 'OUTRO' ? 1 : 2;
}
