import { DIAS_ABREV, fimAusencia, intervalosSobrepoem } from './datas';
import type { Ausencia, Colaborador, PlanoMensal, Unidade } from './tipos';

export interface Pendencia {
  colaboradorId: number;
  colaborador: string;
  msg: string;
}

interface ChecarInput {
  colaboradores: Colaborador[];
  planos: PlanoMensal[];
  ausencias: Ausencia[];
  unidades: Unidade[];
}

/**
 * Pré-checagem dos planos do mês. Enquanto houver pendência, o motor não roda:
 * gerar uma escala sobre um plano incompleto produz um resultado que parece
 * válido e não é.
 */
export function checarPlanos({ colaboradores, planos, ausencias, unidades }: ChecarInput): Pendencia[] {
  const pendencias: Pendencia[] = [];
  const idsUnidades = unidades.filter(u => u.ativa).map(u => u.id);
  const planoPorColab = new Map(planos.map(p => [p.colaboradorId, p]));
  const ausenciasPorColab = new Map<number, Ausencia[]>();
  for (const a of ausencias) {
    ausenciasPorColab.set(a.colaboradorId, [...(ausenciasPorColab.get(a.colaboradorId) ?? []), a]);
  }

  for (const c of colaboradores.filter(x => x.status === 'ativo')) {
    const add = (msg: string) => pendencias.push({ colaboradorId: c.id, colaborador: c.nome, msg });
    const plano = planoPorColab.get(c.id);

    if (!plano) {
      add('Sem plano configurado para o mês.');
    } else {
      const soma = idsUnidades.reduce((acc, id) => acc + (plano.distribuicao[id] ?? 0), 0);
      if (soma !== 100) add(`A distribuição entre unidades soma ${soma}% — precisa somar 100%.`);

      if (c.regime === '12x36' && !plano.ciclo) add('Regime 12x36 sem ciclo definido para o mês.');

      const ho = plano.homeOffice;
      if (ho.modo === 'FIXO') {
        if (ho.diasSemana.length === 0) add('Home office fixo sem nenhum dia da semana selecionado.');
        for (const dow of ho.diasSemana) {
          if (plano.unidadesFixas[dow] !== undefined) {
            add(`${DIAS_ABREV[dow]} está marcado ao mesmo tempo como home office fixo e como unidade fixa.`);
          }
        }
      }
      if (ho.modo === 'COTA' && ho.quantidade < 1) add('Cota de home office precisa de pelo menos 1 dia por semana.');
      if (ho.modo && !c.elegHome) add('Home office configurado, mas o colaborador não está marcado como elegível.');

      for (const [dowStr, unidadeId] of Object.entries(plano.unidadesFixas)) {
        if (!idsUnidades.includes(unidadeId)) {
          add(`${DIAS_ABREV[Number(dowStr)]} está fixado numa unidade que não existe mais ou foi desativada.`);
        }
      }
    }

    // Sobreposição de ausências: no protótipo duas ausências podiam cobrir o
    // mesmo dia sem aviso, e a segunda simplesmente não tinha efeito.
    const lista = (ausenciasPorColab.get(c.id) ?? [])
      .slice()
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 0; i < lista.length; i++) {
      const a = lista[i];
      if (!a.inicio) { add('Ausência sem data de início.'); continue; }
      if (!a.dias || a.dias < 1) { add('Ausência sem quantidade de dias.'); continue; }
      if (a.tipo === 'AUSENCIA' && (!a.grupo || !a.motivo)) add('Ausência sem grupo ou motivo preenchido.');

      for (let j = i + 1; j < lista.length; j++) {
        const b = lista[j];
        if (!b.inicio || !b.dias) continue;
        if (intervalosSobrepoem(a.inicio, fimAusencia(a.inicio, a.dias), b.inicio, fimAusencia(b.inicio, b.dias))) {
          add(`Duas ausências se sobrepõem a partir de ${b.inicio.split('-').reverse().join('/')}.`);
        }
      }
    }
  }

  return pendencias;
}
