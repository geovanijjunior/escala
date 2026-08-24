import { diaSemana, formatarData, fimAusencia, partesIso } from './datas';
import type {
  Alocacao, Ausencia, Aviso, CapacidadeOverride, Colaborador, Equipe, Unidade,
} from './tipos';

/**
 * Quantos lugares a unidade tem naquele dia, já descontadas as reservadas.
 *
 * A capacidade tem três origens, da mais específica para a mais geral: um
 * ajuste para AQUELA data, um ajuste para aquele dia da semana, e o padrão da
 * unidade. A regra estava embutida na conferência, e a tela do dia precisa do
 * mesmo número para poder dizer "4 de 4" — recalculá-lo lá seria uma segunda
 * cópia, do tipo que fica para trás quando a primeira muda.
 */
export function capacidadeOperacional(
  unidade: Unidade,
  data: string,
  dow: number,
  capacidades: CapacidadeOverride[],
): number {
  const especifica = capacidades.find(c => c.unidadeId === unidade.id && c.data === data);
  const semanal = capacidades.find(c => c.unidadeId === unidade.id && !c.data && c.dow === dow);
  const cfg = especifica ?? semanal
    ?? { total: unidade.capacidadeTotal, reservadas: unidade.capacidadeReservadas };
  return Math.max(0, cfg.total - cfg.reservadas);
}

export interface ConferirAlocacoesInput {
  alocacoes: Alocacao[];
  colaboradores: Colaborador[];
  equipes: Equipe[];
  unidades: Unidade[];
  capacidades: CapacidadeOverride[];
  cotasEquipe: { unidadeId: number; equipeId: number; dow: number | null; minimo: number }[];
  ausencias: Ausencia[];
  coberturaMinima: number;
}

/**
 * Confere uma escala que já existe, em vez de produzir uma nova.
 *
 * O motor devolve conflitos como subproduto de gerar. Depois que alguém move
 * gente à mão, aqueles conflitos passam a descrever uma escala que não é mais
 * a que está no banco: mover três pessoas para o Morumbi lotava a unidade e a
 * tela continuava dizendo "0 conflitos", porque o número vinha da geração.
 *
 * Rodar o motor de novo não serve para conferir — ele devolveria *outra*
 * escala, não um diagnóstico desta. Daqui sai só o diagnóstico.
 *
 * Nada aqui bloqueia: quem reorganiza um mês publicado às vezes precisa passar
 * por um estado inválido para chegar num válido — mover A antes de mover B
 * estoura a unidade no meio do caminho. Travar a primeira metade da operação
 * impediria a segunda. Por isso conflito aqui é informação, não impedimento.
 */
export function conferirAlocacoes({
  alocacoes, colaboradores, equipes, unidades, capacidades, cotasEquipe, ausencias, coberturaMinima,
}: ConferirAlocacoesInput): { conflitos: Aviso[]; alertas: Aviso[] } {
  const conflitos: Aviso[] = [];
  const alertas: Aviso[] = [];

  const colabPorId = new Map(colaboradores.map(c => [c.id, c]));
  const nomeDaEquipe = new Map(equipes.map(e => [e.id, e.nome]));
  const ativas = unidades.filter(u => u.ativa);

  const capEspecifica = new Map<string, { total: number; reservadas: number }>();
  const capSemanal = new Map<string, { total: number; reservadas: number }>();
  for (const c of capacidades) {
    if (c.data) capEspecifica.set(`${c.unidadeId}|${c.data}`, c);
    else if (c.dow !== null) capSemanal.set(`${c.unidadeId}|${c.dow}`, c);
  }
  const operacionais = (unidade: Unidade, data: string, dow: number) => {
    const cfg =
      capEspecifica.get(`${unidade.id}|${data}`)
      ?? capSemanal.get(`${unidade.id}|${dow}`)
      ?? { total: unidade.capacidadeTotal, reservadas: unidade.capacidadeReservadas };
    return Math.max(0, cfg.total - cfg.reservadas);
  };

  const cotaGeral = new Map<string, number>();
  const cotaSemanal = new Map<string, number>();
  for (const c of cotasEquipe) {
    if (c.dow === null) cotaGeral.set(`${c.unidadeId}|${c.equipeId}`, c.minimo);
    else cotaSemanal.set(`${c.unidadeId}|${c.equipeId}|${c.dow}`, c.minimo);
  }
  const minimoDe = (unidadeId: number, equipeId: number, dow: number): number | null =>
    cotaSemanal.get(`${unidadeId}|${equipeId}|${dow}`)
    ?? cotaGeral.get(`${unidadeId}|${equipeId}`)
    ?? null;

  const ausenciasPorColab = new Map<number, Ausencia[]>();
  for (const a of ausencias) {
    ausenciasPorColab.set(a.colaboradorId, [...(ausenciasPorColab.get(a.colaboradorId) ?? []), a]);
  }

  // ── Uma pessoa, um lugar por dia ─────────────────────────────
  const vistos = new Set<string>();
  for (const a of alocacoes) {
    const chave = `${a.colaboradorId}|${a.data}`;
    if (vistos.has(chave)) {
      const c = colabPorId.get(a.colaboradorId);
      conflitos.push({
        nivel: 'erro',
        colaboradorId: a.colaboradorId,
        colaborador: c?.nome,
        data: a.data,
        msg: `${c?.nome ?? 'Colaborador'} tem mais de uma alocação em ${formatarData(a.data)}.`,
      });
    }
    vistos.add(chave);
  }

  // ── Ninguém trabalha durante a própria ausência ──────────────
  for (const a of alocacoes) {
    if (a.modalidade === 'FERIAS' || a.modalidade === 'FOLGA'
      || a.modalidade === 'AFAST' || a.modalidade === 'FERIADO' || a.modalidade === 'DESCANSO') continue;
    const bate = (ausenciasPorColab.get(a.colaboradorId) ?? [])
      .find(x => a.data >= x.inicio && a.data <= fimAusencia(x.inicio, x.dias));
    if (bate) {
      const c = colabPorId.get(a.colaboradorId);
      conflitos.push({
        nivel: 'erro',
        colaboradorId: a.colaboradorId,
        colaborador: c?.nome,
        data: a.data,
        msg: `${c?.nome ?? 'Colaborador'} está escalado em ${formatarData(a.data)}, mas tem `
          + `${bate.tipo === 'FERIAS' ? 'férias' : 'ausência'} nesse dia.`,
      });
    }
  }

  // ── Capacidade, cota por equipe e cobertura, dia a dia ───────
  const porData = new Map<string, Alocacao[]>();
  for (const a of alocacoes) porData.set(a.data, [...(porData.get(a.data) ?? []), a]);

  for (const [data, doDia] of [...porData.entries()].sort()) {
    const [ano, mes, diaDoMes] = partesIso(data);
    const dow = diaSemana(ano, mes, diaDoMes);
    const naUnidade = doDia.filter(a => a.modalidade === 'UNIDADE');
    const alguemTrabalha = doDia.some(a => a.modalidade === 'UNIDADE' || a.modalidade === 'HOME');

    for (const u of ativas) {
      const daUnidade = naUnidade.filter(a => a.unidadeId === u.id);
      const teto = operacionais(u, data, dow);
      if (daUnidade.length > teto) {
        conflitos.push({
          nivel: 'erro',
          data,
          msg: `${u.nome} com ${daUnidade.length} pessoa(s) em ${formatarData(data)} — `
            + `${teto} posição(ões) operacional(is).`,
        });
      }

      // Cota por equipe: a conferência espelha o motor, e o motor passou a
      // tratar a cota como PISO. Falta de gente é alerta, não conflito — a
      // escala publicada continua válida, o que falta é cobertura.
      //
      // O laço percorre as cotas cadastradas, e não as equipes presentes: a
      // equipe que ficou com ZERO pessoas na unidade é justamente a que mais
      // precisa aparecer, e ela não estaria no mapa de presentes.
      const porEquipe = new Map<number, number>();
      for (const a of daUnidade) {
        const eq = colabPorId.get(a.colaboradorId)?.equipeId;
        if (eq !== undefined) porEquipe.set(eq, (porEquipe.get(eq) ?? 0) + 1);
      }
      // `vistas` porque o mesmo par pode ter duas linhas — a cota geral e a de
      // um dia da semana. `minimoDe` já resolve qual vence; sem a deduplicação,
      // o alerta sairia repetido para o mesmo par no mesmo dia.
      const vistas = new Set<number>();
      for (const c of cotasEquipe) {
        if (c.unidadeId !== u.id || vistas.has(c.equipeId)) continue;
        vistas.add(c.equipeId);
        const minimo = minimoDe(u.id, c.equipeId, dow);
        if (minimo === null || minimo <= 0) continue;
        const n = porEquipe.get(c.equipeId) ?? 0;
        if (n >= minimo) continue;
        alertas.push({
          nivel: 'aviso',
          data,
          msg: `${nomeDaEquipe.get(c.equipeId) ?? 'Equipe'} com ${n} de ${minimo} pessoa(s) exigida(s) `
            + `em ${u.nome} em ${formatarData(data)}.`,
        });
      }

      if (alguemTrabalha && coberturaMinima > 0 && daUnidade.length < coberturaMinima) {
        alertas.push({
          nivel: 'aviso',
          data,
          msg: `${u.nome} com ${daUnidade.length} pessoa(s) em ${formatarData(data)} — `
            + `abaixo da cobertura mínima de ${coberturaMinima}.`,
        });
      }
    }
  }

  return { conflitos, alertas };
}
