import {
  addDias,
  cicloEfetivo,
  diaSemana,
  diasNoMes,
  fimAusencia,
  formatarData,
  iso,
  competenciaDe,
  DIAS_ABREV,
} from './datas';
import { ordemHomeOffice, ordemPresencial } from './constantes';
import type {
  Alocacao,
  Aviso,
  Ciclo,
  Colaborador,
  GerarEscalaInput,
  GerarEscalaOutput,
  Modalidade,
  PlanoMensal,
  Unidade,
} from './tipos';

/** Uma equipe inteira concentrada numa unidade acima disso aciona o desempate por balanceamento. */
const LIMITE_CONCENTRACAO_EQUIPE = 4;

interface Candidato {
  colab: Colaborador;
  preferida: number;
  urgencia: number;
  flex: number;
}

/**
 * Motor de geração da escala do mês.
 *
 * Função pura: recebe o retrato completo do mês e devolve alocações, conflitos e
 * aderência, sem tocar em banco nem em estado global. Isso permite rodar a mesma
 * chamada como simulação (dry-run) e como geração definitiva — a diferença está
 * só em gravar ou não o resultado.
 *
 * A precedência aplicada está documentada em REGRAS_MOTOR (constantes.ts) e é a
 * ordem literal dos blocos abaixo.
 */
export function gerarEscala(input: GerarEscalaInput): GerarEscalaOutput {
  const {
    ano, mes, feriados, cicloAncora, toleranciaAderencia, coberturaMinima,
  } = input;

  const nDias = diasNoMes(ano, mes);
  const competencia = competenciaDe(ano, mes);
  const unidades = input.unidades.filter(u => u.ativa).sort((a, b) => a.ordem - b.ordem || a.id - b.id);
  const idsUnidades = unidades.map(u => u.id);
  const nomeUnidade = new Map(unidades.map(u => [u.id, u.nome] as const));

  // Ordem estável de entrada: sem isso, duas gerações com os mesmos dados podem
  // divergir só porque o banco devolveu as linhas em outra ordem.
  const colaboradores = input.colaboradores
    .filter(c => c.status === 'ativo')
    .slice()
    .sort((a, b) => a.id - b.id);

  const planoPorColab = new Map<number, PlanoMensal>(input.planos.map(p => [p.colaboradorId, p]));
  const pinPorChave = new Map(input.pins.map(p => [`${p.colaboradorId}|${p.data}`, p] as const));

  const ausenciasPorColab = new Map<number, { tipo: 'FERIAS' | 'AUSENCIA'; inicio: string; fim: string }[]>();
  for (const a of input.ausencias) {
    const lista = ausenciasPorColab.get(a.colaboradorId) ?? [];
    lista.push({ tipo: a.tipo, inicio: a.inicio, fim: fimAusencia(a.inicio, a.dias) });
    ausenciasPorColab.set(a.colaboradorId, lista);
  }

  const capEspecifica = new Map<string, { total: number; reservadas: number }>();
  const capSemanal = new Map<string, { total: number; reservadas: number }>();
  for (const c of input.capacidades) {
    const valor = { total: c.total, reservadas: c.reservadas };
    if (c.data) capEspecifica.set(`${c.unidadeId}|${c.data}`, valor);
    else if (c.dow !== null) capSemanal.set(`${c.unidadeId}|${c.dow}`, valor);
  }

  /** Posições realmente disponíveis: total menos as reservadas. */
  const posicoesDoDia = (unidade: Unidade, data: string, dow: number): number => {
    const cfg =
      capEspecifica.get(`${unidade.id}|${data}`) ??
      capSemanal.get(`${unidade.id}|${dow}`) ??
      { total: unidade.capacidadeTotal, reservadas: unidade.capacidadeReservadas };
    return Math.max(0, cfg.total - cfg.reservadas);
  };

  const nomeDaEquipe = new Map(input.equipes.map(e => [e.id, e.nome]));

  // ── Cota por equipe: teto de pessoas de uma equipe numa unidade.
  // O dia da semana específico tem precedência sobre a cota geral; par sem cota
  // cadastrada não tem teto próprio, só a capacidade da unidade limita.
  const cotaGeral = new Map<string, number>();
  const cotaSemanal = new Map<string, number>();
  for (const c of input.cotasEquipe) {
    if (c.dow === null) cotaGeral.set(`${c.unidadeId}|${c.equipeId}`, c.limite);
    else cotaSemanal.set(`${c.unidadeId}|${c.equipeId}|${c.dow}`, c.limite);
  }
  const cotaDe = (unidadeId: number, equipeId: number, dow: number): number | null =>
    cotaSemanal.get(`${unidadeId}|${equipeId}|${dow}`)
    ?? cotaGeral.get(`${unidadeId}|${equipeId}`)
    ?? null;

  const conflitos: Aviso[] = [];
  const alertas: Aviso[] = [];
  const datas: string[] = [];
  for (let d = 1; d <= nDias; d++) datas.push(iso(ano, mes, d));

  /** colabId -> data -> alocação decidida. */
  const escala = new Map<number, Map<string, { modalidade: Modalidade; unidadeId: number | null; travado: boolean; postoId: number | null }>>();
  const ocupacao: Record<string, Record<number, number>> = {};
  const capacidadeDia: Record<string, Record<number, number>> = {};
  for (const data of datas) {
    ocupacao[data] = Object.fromEntries(idsUnidades.map(id => [id, 0]));
    const dow = diaSemana(ano, mes, Number(data.slice(8)));
    capacidadeDia[data] = Object.fromEntries(unidades.map(u => [u.id, posicoesDoDia(u, data, dow)]));
  }

  const definir = (
    colabId: number, data: string, modalidade: Modalidade,
    unidadeId: number | null, travado = false, postoId: number | null = null,
  ) => {
    const dias = escala.get(colabId) ?? new Map();
    dias.set(data, { modalidade, unidadeId, travado, postoId });
    escala.set(colabId, dias);
  };

  // ─────────────────────────────────────────────────────────────
  // Regras 1 a 8: tudo que é rígido, decidido pessoa a pessoa.
  // Sobra a lista de dias "presenciais" — candidatos a uma unidade física.
  // ─────────────────────────────────────────────────────────────
  const presenciais = new Map<number, string[]>();
  const fixados = new Map<number, Set<string>>();
  const cotaRestante = new Map<number, Map<number, number>>();

  const dowDoPrimeiro = diaSemana(ano, mes, 1);
  const semanaDoMes = (dia: number) => Math.floor((dia + dowDoPrimeiro - 1) / 7);

  // ─────────────────────────────────────────────────────────────
  // Postos: N dias úteis CONTÍGUOS numa semana, na unidade do posto.
  //
  // Contíguo e semanal porque é assim que o rodízio funciona na prática — quem
  // cobre o Corpo Clínico fica a semana (ou parte dela) inteira, não dias
  // soltos. A semana pode ser fixada no plano; em branco, o motor escolhe a
  // primeira com vaga, o que rodizia entre as pessoas sem trabalho manual.
  // ─────────────────────────────────────────────────────────────
  const postoPorId = new Map(input.postos.filter(p => p.ativo).map(p => [p.id, p]));
  const semanasDoMes = [...new Set(Array.from({ length: nDias }, (_, i) => semanaDoMes(i + 1)))].sort((a, b) => a - b);

  /** Dias úteis de uma semana do mês, em ordem. */
  const uteisDaSemana = (semana: number): string[] => {
    const out: string[] = [];
    for (let d = 1; d <= nDias; d++) {
      if (semanaDoMes(d) !== semana) continue;
      const dow = diaSemana(ano, mes, d);
      if (dow >= 1 && dow <= 5) out.push(datas[d - 1]);
    }
    return out;
  };

  /** postoId|data -> quantas pessoas já estão cobrindo. Respeita `vagas`. */
  const ocupacaoPosto = new Map<string, number>();
  const usoDePosto = (postoId: number, data: string) => ocupacaoPosto.get(`${postoId}|${data}`) ?? 0;

  /** colabId -> data -> postoId, decidido antes do laço principal. */
  const diasDePosto = new Map<number, Map<string, number>>();

  for (const c of colaboradores) {
    const plano = planoPorColab.get(c.id);
    if (!plano?.postos?.length) continue;

    const ausencias = ausenciasPorColab.get(c.id) ?? [];
    const indisponivel = (data: string) => ausencias.some(a => data >= a.inicio && data <= a.fim);

    for (const atrib of plano.postos) {
      const posto = postoPorId.get(atrib.postoId);
      if (!posto) continue;

      // Semana fixada no plano é 1-based para quem preenche; internamente 0-based.
      const candidatas = atrib.semana !== null && atrib.semana !== undefined
        ? [atrib.semana - 1]
        : semanasDoMes;

      let escolhida: string[] | null = null;
      for (const semana of candidatas) {
        const uteis = uteisDaSemana(semana);
        if (uteis.length < atrib.dias) continue;
        const bloco = uteis.slice(0, atrib.dias);
        const livre = bloco.every(d => usoDePosto(posto.id, d) < posto.vagas && !indisponivel(d));
        if (livre) { escolhida = bloco; break; }
      }

      if (!escolhida) {
        conflitos.push({
          nivel: 'erro', colaboradorId: c.id, colaborador: c.nome,
          msg: atrib.semana
            ? `Não foi possível reservar ${atrib.dias} dia(s) seguidos de ${posto.nome} na semana ${atrib.semana}: o posto já está ocupado ou a pessoa tem ausência nesses dias.`
            : `Não há nenhuma semana com ${atrib.dias} dia(s) seguidos livres em ${posto.nome} para ${c.nome}.`,
        });
        continue;
      }

      const mapa = diasDePosto.get(c.id) ?? new Map<string, number>();
      for (const d of escolhida) {
        mapa.set(d, posto.id);
        ocupacaoPosto.set(`${posto.id}|${d}`, usoDePosto(posto.id, d) + 1);
      }
      diasDePosto.set(c.id, mapa);
    }
  }

  for (const c of colaboradores) {
    const plano = planoPorColab.get(c.id);
    const livres: string[] = [];
    const fixos = new Set<string>();
    presenciais.set(c.id, livres);
    fixados.set(c.id, fixos);

    const ausencias = ausenciasPorColab.get(c.id) ?? [];
    const ho = plano?.homeOffice;
    const unidadesFixas = plano?.unidadesFixas ?? {};

    const cicloBase: Ciclo = plano?.ciclo ?? c.ciclo ?? 'IMPAR';
    // O ciclo salvo no plano é decisão explícita do Planejamento e vale como
    // está; sem plano, deriva-se a paridade do mês a partir da âncora.
    const ciclo: Ciclo = c.regime === '12x36'
      ? (plano?.ciclo ?? cicloEfetivo(cicloBase, competencia, cicloAncora))
      : 'IMPAR';

    let ultimoPlantao: number | null = null;

    for (let d = 1; d <= nDias; d++) {
      const data = datas[d - 1];
      const dow = diaSemana(ano, mes, d);

      // 1. Trava manual — decisão já tomada, entra antes de qualquer regra.
      const pin = pinPorChave.get(`${c.id}|${data}`);
      if (pin) {
        definir(c.id, data, pin.modalidade, pin.unidadeId, true);
        if (pin.modalidade === 'UNIDADE' && pin.unidadeId !== null) fixos.add(data);
        if (c.regime === '12x36' && pin.modalidade !== 'DESCANSO') ultimoPlantao = d;
        continue;
      }

      // 2/3. Férias e demais ausências — bloqueio absoluto.
      const ausencia = ausencias.find(a => data >= a.inicio && data <= a.fim);
      if (ausencia) {
        definir(c.id, data, ausencia.tipo === 'FERIAS' ? 'FERIAS' : 'FOLGA', null);
        continue;
      }

      // 4. Regime de trabalho.
      if (c.regime === '12x36') {
        const ehImpar = d % 2 === 1;
        const trabalha = (ciclo === 'IMPAR' && ehImpar) || (ciclo === 'PAR' && !ehImpar);
        if (!trabalha) { definir(c.id, data, 'DESCANSO', null); continue; }
        if (ultimoPlantao === d - 1) {
          conflitos.push({
            nivel: 'erro', colaboradorId: c.id, colaborador: c.nome, data,
            msg: 'Plantões 12x36 em dias consecutivos — o descanso de 36h fica violado.',
          });
        }
        ultimoPlantao = d; // o plantão conta mesmo se cumprido em home office
      } else {
        if (dow === 0 || dow === 6) { definir(c.id, data, 'DESCANSO', null); continue; }
        if (feriados[data]) { definir(c.id, data, 'FERIADO', null); continue; }
      }

      // Posto vence home office e unidade fixa: é escala combinada de cobertura
      // presencial, decidida antes por semana inteira.
      const postoDoDia = diasDePosto.get(c.id)?.get(data);
      if (postoDoDia !== undefined) {
        const posto = postoPorId.get(postoDoDia)!;
        definir(c.id, data, 'UNIDADE', posto.unidadeId, false, posto.id);
        livres.push(data);
        fixos.add(data);
        continue;
      }

      const unidadeFixa = unidadesFixas[dow];
      const temFixa = unidadeFixa !== undefined && idsUnidades.includes(unidadeFixa);

      // 5. Home office fixo no dia da semana.
      if (c.elegHome && ho?.modo === 'FIXO' && ho.diasSemana.includes(dow)) {
        if (temFixa) {
          conflitos.push({
            nivel: 'erro', colaboradorId: c.id, colaborador: c.nome, data,
            msg: `${DIAS_ABREV[dow]} está marcado como home office fixo e como unidade fixa (${nomeUnidade.get(unidadeFixa!)}) ao mesmo tempo.`,
          });
        }
        definir(c.id, data, 'HOME', null);
        continue;
      }

      // 6. Unidade fixa do dia da semana — ocupa posição, sai do rateio livre.
      if (temFixa) {
        definir(c.id, data, 'UNIDADE', unidadeFixa!);
        livres.push(data);
        fixos.add(data);
        continue;
      }

      // 8. A cota de home office só é registrada aqui; a escolha dos dias é
      // feita depois, com visão do mês inteiro. Decidir pessoa a pessoa, como
      // antes, empilhava todo mundo nos mesmos dias preferidos.
      if (c.elegHome && ho?.modo === 'COTA') {
        const semana = semanaDoMes(d);
        const porSemana = cotaRestante.get(c.id) ?? new Map<number, number>();
        if (!porSemana.has(semana)) porSemana.set(semana, ho.quantidade);
        cotaRestante.set(c.id, porSemana);
      }

      livres.push(data);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Regra 8 (escolha dos dias): preferência manda, espalhamento desempata.
  //
  // A preferência da pessoa é a regra primária — quem marcou sexta vai na
  // sexta, mesmo que isso junte gente. O espalhamento age DENTRO do que ela
  // marcou: entre dois dias preferidos, ganha o menos cheio. Só vira critério
  // principal para quem não marcou preferência, ou quando nenhum dia preferido
  // está disponível na semana.
  //
  // A decisão é global e por rodadas. Servir a cota inteira de uma pessoa antes
  // de passar à próxima daria os melhores dias a quem viesse primeiro, então a
  // fila gira a cada dia atribuído. A ordem da fila segue a prioridade por
  // cargo: analista antes de técnico, porque o técnico é quem precisa estar
  // perto do equipamento.
  // ─────────────────────────────────────────────────────────────
  const homePorDia: Record<string, number> = Object.fromEntries(datas.map(d => [d, 0]));
  for (const c of colaboradores) {
    const ho = planoPorColab.get(c.id)?.homeOffice;
    if (ho?.modo !== 'FIXO') continue;
    for (const data of datas) {
      if (escala.get(c.id)?.get(data)?.modalidade === 'HOME') homePorDia[data]++;
    }
  }

  const comCota = colaboradores
    .filter(c => c.elegHome && planoPorColab.get(c.id)?.homeOffice?.modo === 'COTA')
    .slice()
    .sort((a, b) => ordemHomeOffice(a.cargo) - ordemHomeOffice(b.cargo) || a.id - b.id);

  for (const semana of semanasDoMes) {
    // Uma rodada por vez: cada pessoa pega um dia, depois volta para o fim da
    // fila. Servir a cota inteira de uma pessoa antes da próxima daria os
    // melhores dias a quem viesse primeiro.
    const restante = new Map<number, number>();
    for (const c of comCota) restante.set(c.id, cotaRestante.get(c.id)?.get(semana) ?? 0);

    let algoMudou = true;
    while (algoMudou) {
      algoMudou = false;
      for (const c of comCota) {
        if ((restante.get(c.id) ?? 0) <= 0) continue;
        const ho = planoPorColab.get(c.id)!.homeOffice;

        const elegiveis = (presenciais.get(c.id) ?? []).filter(data => {
          const dia = Number(data.slice(8));
          if (semanaDoMes(dia) !== semana) return false;
          if (ho.diasProibidos.includes(diaSemana(ano, mes, dia))) return false;
          if (fixados.get(c.id)?.has(data)) return false; // preso a uma unidade ou posto
          return true;
        });
        if (elegiveis.length === 0) continue;

        // A preferência é a regra primária: se a pessoa marcou dias, a escolha
        // sai de dentro deles, mesmo que isso concentre gente no mesmo dia.
        // O espalhamento é o critério de desempate DENTRO da preferência — e
        // vira o critério principal só para quem não marcou nada, ou quando
        // nenhum dia preferido está disponível na semana.
        const preferidos = elegiveis.filter(d =>
          ho.diasPreferencia.includes(diaSemana(ano, mes, Number(d.slice(8)))));
        const universo = preferidos.length > 0 ? preferidos : elegiveis;

        const melhor = universo.reduce((a, b) => {
          if (homePorDia[a] !== homePorDia[b]) return homePorDia[a] < homePorDia[b] ? a : b;
          return a < b ? a : b;
        });

        definir(c.id, melhor, 'HOME', null);
        homePorDia[melhor]++;
        presenciais.set(c.id, (presenciais.get(c.id) ?? []).filter(x => x !== melhor));
        restante.set(c.id, (restante.get(c.id) ?? 0) - 1);
        algoMudou = true;
      }
    }

    for (const c of comCota) {
      const falta = restante.get(c.id) ?? 0;
      if (falta > 0) {
        alertas.push({
          nivel: 'aviso', colaboradorId: c.id, colaborador: c.nome,
          msg: `Cota de home office não atendida na semana ${semana + 1}: faltam ${falta} dia(s) elegíveis.`,
        });
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Regra 9: metas por unidade, pelo método do maior resto.
  // ─────────────────────────────────────────────────────────────
  const metas: Record<number, Record<number, number>> = {};
  for (const c of colaboradores) {
    const plano = planoPorColab.get(c.id);
    const dist = plano?.distribuicao ?? {};
    const somaDist = idsUnidades.reduce((acc, id) => acc + (dist[id] ?? 0), 0);
    // Sem plano configurado, tudo vai pra unidade base — é o comportamento mais
    // previsível e o que o Planejamento vê como "ainda não distribuído".
    const efetiva: Record<number, number> = somaDist > 0
      ? dist
      : { [c.unidadeBaseId]: 100 };

    const total = (presenciais.get(c.id) ?? []).length;
    const divisor = somaDist > 0 ? somaDist : 100;
    const base = idsUnidades.map(id => {
      const exato = (total * (efetiva[id] ?? 0)) / divisor;
      return { id, piso: Math.floor(exato), resto: exato - Math.floor(exato) };
    });
    let sobra = total - base.reduce((acc, b) => acc + b.piso, 0);
    // Empate no resto: unidade de menor id primeiro, pra a geração ser reprodutível.
    [...base].sort((a, b) => b.resto - a.resto || a.id - b.id).forEach(b => {
      if (sobra > 0) { b.piso++; sobra--; }
    });
    metas[c.id] = Object.fromEntries(base.map(b => [b.id, b.piso]));
  }

  const alocado: Record<number, Record<number, number>> = {};
  for (const c of colaboradores) alocado[c.id] = Object.fromEntries(idsUnidades.map(id => [id, 0]));

  // ─────────────────────────────────────────────────────────────
  // Regras 7 e 11: preenche o dia respeitando capacidade e balanceamento.
  // ─────────────────────────────────────────────────────────────
  for (let d = 1; d <= nDias; d++) {
    const data = datas[d - 1];
    const capacidade = capacidadeDia[data];
    const dowDoDia = diaSemana(ano, mes, d);

    /** unidadeId -> equipeId -> pessoas dessa equipe já colocadas no dia. */
    const porEquipe: Record<number, Record<number, number>> = Object.fromEntries(
      idsUnidades.map(id => [id, {} as Record<number, number>])
    );
    const contaEquipe = (unidadeId: number, equipeId: number) => {
      porEquipe[unidadeId][equipeId] = (porEquipe[unidadeId][equipeId] ?? 0) + 1;
    };

    // Travas e unidades fixas já ocupam posição e contam pra meta. A ocupação
    // sobe para a unidade pai; a meta, não — a meta é do posto onde a pessoa
    // efetivamente ficou, e somar nos dois contaria o mesmo dia duas vezes.
    for (const c of colaboradores) {
      const decidido = escala.get(c.id)?.get(data);
      if (!decidido || decidido.modalidade !== 'UNIDADE' || decidido.unidadeId === null) continue;
      ocupacao[data][decidido.unidadeId]++;
      alocado[c.id][decidido.unidadeId]++;
      contaEquipe(decidido.unidadeId, c.equipeId);
    }

    // Cota estourada só com o que foi fixado: o motor não desfaz decisão rígida,
    // então isso é conflito para o Planejamento resolver, não algo a contornar.
    for (const u of unidades) {
      for (const [equipeStr, usados] of Object.entries(porEquipe[u.id])) {
        const equipeId = Number(equipeStr);
        const limite = cotaDe(u.id, equipeId, dowDoDia);
        if (limite === null || usados <= limite) continue;
        const nomeEquipe = nomeDaEquipe.get(equipeId) ?? `equipe ${equipeId}`;
        conflitos.push({
          nivel: 'erro', data,
          msg: `${u.nome} em ${formatarData(data)} tem ${usados} pessoa(s) de ${nomeEquipe} fixadas para uma cota de ${limite}. Revise as travas e unidades fixas dessa equipe.`,
        });
      }
    }

    // Um dia pode estourar só com o que foi fixado — precisa ser reportado, já
    // que o motor não tem como desfazer uma decisão rígida.
    for (const u of unidades) {
      if (ocupacao[data][u.id] <= capacidade[u.id]) continue;
      const nomes = colaboradores
        .filter(c => {
          const a = escala.get(c.id)?.get(data);
          return a?.modalidade === 'UNIDADE' && a.unidadeId === u.id;
        })
        .map(c => c.nome);
      conflitos.push({
        nivel: 'erro', data,
        msg: `${u.nome} em ${formatarData(data)} tem ${ocupacao[data][u.id]} pessoas fixadas para ${capacidade[u.id]} posições. Revise as travas e unidades fixas de: ${nomes.slice(0, 6).join(', ')}${nomes.length > 6 ? '…' : ''}.`,
      });
    }

    const candidatos: Candidato[] = colaboradores
      .filter(c => (presenciais.get(c.id) ?? []).includes(data) && !escala.get(c.id)?.get(data))
      .map(c => {
        const faltas = idsUnidades.map(id => ({ id, falta: (metas[c.id][id] ?? 0) - alocado[c.id][id] }));
        const maior = faltas.reduce((a, b) => (b.falta > a.falta ? b : a), faltas[0]);
        return { colab: c, preferida: maior.id, urgencia: maior.falta, flex: faltas.filter(f => f.falta > 0).length };
      })
      // Menos flexível primeiro (quem só cabe numa unidade), depois o cargo com
      // prioridade presencial — técnico antes de analista, porque é quem precisa
      // estar perto do equipamento —, depois quem está mais atrasado na meta.
      // Id como último critério mantém a geração determinística.
      .sort((a, b) =>
        a.flex - b.flex
        || ordemPresencial(a.colab.cargo) - ordemPresencial(b.colab.cargo)
        || b.urgencia - a.urgencia
        || a.colab.id - b.colab.id);

    const concentracao: Record<number, Record<number, number>> = Object.fromEntries(
      idsUnidades.map(id => [id, {} as Record<number, number>])
    );

    // Um posto interno só aceita mais alguém se ele E o prédio que o contém
    // tiverem lugar. É a diferença entre "sobra cadeira no Corpo Clínico" e
    // "sobra cadeira no Morumbi": as duas precisam ser verdade.
    const temLugar = (id: number) => ocupacao[data][id] < capacidade[id];

    const dentroDaCota = (id: number, equipeId: number) => {
      const limite = cotaDe(id, equipeId, dowDoDia);
      return limite === null || (porEquipe[id][equipeId] ?? 0) < limite;
    };

    const cabe = (id: number, equipeId: number) => temLugar(id) && dentroDaCota(id, equipeId);

    for (const { colab, preferida } of candidatos) {
      const ordem = [preferida, ...idsUnidades.filter(id => id !== preferida)];
      let colocado = false;

      for (const id of ordem) {
        if (!cabe(id, colab.equipeId)) continue;
        const conc = concentracao[id][colab.equipeId] ?? 0;
        const alternativa = ordem.find(x => x !== id && cabe(x, colab.equipeId));
        // Balanceamento só desempata quando não custa a meta da pessoa.
        if (id !== preferida && alternativa !== undefined && conc > LIMITE_CONCENTRACAO_EQUIPE) continue;
        definir(colab.id, data, 'UNIDADE', id);
        ocupacao[data][id]++;
        alocado[colab.id][id]++;
        contaEquipe(id, colab.equipeId);
        concentracao[id][colab.equipeId] = conc + 1;
        colocado = true;
        break;
      }

      if (!colocado) {
        definir(colab.id, data, 'EXTERNO', null);

        // Distingue lotação de cota: dizer "sem posição" mostrando "Morumbi
        // 3/10" faria o Planejamento procurar o problema no lugar errado.
        const detalhe = unidades.map(u => {
          const lotada = !temLugar(u.id);
          const limite = cotaDe(u.id, colab.equipeId, dowDoDia);
          const barrouCota = !lotada && limite !== null && (porEquipe[u.id][colab.equipeId] ?? 0) >= limite;
          const base = `${u.nome} ${ocupacao[data][u.id]}/${capacidade[u.id]}`;
          return barrouCota ? `${base} — cota da equipe cheia (${limite})` : base;
        }).join(', ');

        const soPorCota = unidades.some(u => {
          const limite = cotaDe(u.id, colab.equipeId, dowDoDia);
          return temLugar(u.id) && limite !== null && (porEquipe[u.id][colab.equipeId] ?? 0) >= limite;
        });

        conflitos.push({
          nivel: 'erro', colaboradorId: colab.id, colaborador: colab.nome, data,
          msg: soPorCota
            ? `Há lugar físico, mas a cota da equipe está cheia em toda unidade elegível (${detalhe}). Alocado como Trabalho Externo.`
            : `Sem posição disponível em nenhuma unidade (${detalhe}). Alocado como Trabalho Externo.`,
        });
      }
    }

    // Regra 11: cobertura mínima, só nos dias em que alguém de fato trabalha.
    const alguemTrabalha = colaboradores.some(c => {
      const a = escala.get(c.id)?.get(data);
      return a && a.modalidade !== 'DESCANSO' && a.modalidade !== 'FERIADO';
    });
    if (alguemTrabalha && coberturaMinima > 0) {
      for (const u of unidades) {
        if (ocupacao[data][u.id] < coberturaMinima) {
          alertas.push({
            nivel: 'aviso', data,
            msg: `${u.nome} com ${ocupacao[data][u.id]} pessoa(s) em ${formatarData(data)} — abaixo da cobertura mínima de ${coberturaMinima}.`,
          });
        }
      }
    }
  }

  // ── Aderência: planejado x realizado por unidade.
  const aderencia = colaboradores.map(c => {
    const desvios = idsUnidades.map(id => ({
      unidadeId: id,
      planejado: metas[c.id][id] ?? 0,
      realizado: alocado[c.id][id] ?? 0,
    }));
    const ok = desvios.every(x => Math.abs(x.planejado - x.realizado) <= toleranciaAderencia);
    if (!ok) {
      alertas.push({
        nivel: 'aviso', colaboradorId: c.id, colaborador: c.nome,
        msg: `Distribuição fora da tolerância: ${desvios
          .map(x => `${nomeUnidade.get(x.unidadeId)} ${x.realizado}/${x.planejado}`)
          .join(' · ')}`,
      });
    }
    return { colaboradorId: c.id, colaborador: c.nome, desvios, ok };
  });

  const alocacoes: Alocacao[] = [];
  for (const c of colaboradores) {
    const dias = escala.get(c.id);
    if (!dias) continue;
    for (const data of datas) {
      const a = dias.get(data);
      if (!a) continue;
      alocacoes.push({
        colaboradorId: c.id, data, modalidade: a.modalidade,
        unidadeId: a.unidadeId, travado: a.travado, postoId: a.postoId ?? null,
      });
    }
  }

  return { alocacoes, conflitos, alertas, ocupacao, capacidadeDia, aderencia, metas };
}

/** Dias corridos cobertos por uma ausência, para exibir o fim calculado. */
export function janelaAusencia(inicio: string, dias: number): { inicio: string; fim: string } {
  return { inicio, fim: addDias(inicio, Math.max(1, dias) - 1) };
}
