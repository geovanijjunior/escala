/**
 * Bateria de propriedades do motor.
 *
 * Os testes de `motor.teste.ts` são casos que eu escolhi — cobrem só cenários em
 * que alguém já pensou. Aqui é o contrário: geram-se milhares de meses
 * aleatórios (equipes, capacidades, cotas, postos, férias, travas, feriados) e
 * verifica-se que as INVARIANTES do domínio valem em todos eles.
 *
 * Uma invariante é algo que precisa ser verdade sempre, independentemente da
 * entrada. "Ninguém trabalha durante as próprias férias" não depende de
 * configuração — se quebrar uma vez em dez mil, é bug.
 *
 * O gerador é semeado. Quando uma propriedade falha, a semente é impressa e
 * `SEMENTE=<n> npx tsx ...` reproduz exatamente aquele mês.
 */
import { gerarEscala } from './motor';
import { diaSemana, diasNoMes, addDias, iso } from './datas';
import type {
  Ausencia, Colaborador, CotaEquipe, GerarEscalaInput, PlanoMensal, Pin, Posto, Unidade,
} from './tipos';

/* ============================================================
   Gerador semeado (mulberry32) — falhas precisam ser reproduzíveis
   ============================================================ */

function prng(semente: number) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Aleatorio {
  int(min: number, max: number): number;
  bool(p?: number): boolean;
  de<T>(lista: T[]): T;
  amostra<T>(lista: T[], max: number): T[];
}

export function aleatorio(semente: number): Aleatorio {
  const r = prng(semente);
  const int = (min: number, max: number) => min + Math.floor(r() * (max - min + 1));
  return {
    int,
    bool: (p = 0.5) => r() < p,
    de: <T,>(lista: T[]) => lista[int(0, lista.length - 1)],
    amostra: <T,>(lista: T[], max: number) => {
      const n = int(0, Math.min(max, lista.length));
      const copia = lista.slice();
      const out: T[] = [];
      for (let i = 0; i < n; i++) out.push(...copia.splice(int(0, copia.length - 1), 1));
      return out;
    },
  };
}

/* ============================================================
   Geração de um mês inteiro plausível
   ============================================================ */

const CARGOS = ['Técnico I', 'Técnico II', 'Analista Jr', 'Analista Sr', 'Especialista', 'Líder'];

export function gerarCenario(a: Aleatorio): GerarEscalaInput {
  const ano = a.int(2025, 2027);
  const mes = a.int(0, 11);
  const nDias = diasNoMes(ano, mes);

  const nUnidades = a.int(1, 4);
  const unidades: Unidade[] = Array.from({ length: nUnidades }, (_, i) => {
    const total = a.int(0, 14);
    return {
      id: i + 1,
      codigo: `U${i + 1}`,
      nome: `Unidade ${i + 1}`,
      sigla: `U${i + 1}`,
      cor: '#000',
      bg: '#fff',
      capacidadeTotal: total,
      capacidadeReservadas: a.int(0, total),
      ordem: i + 1,
      ativa: a.bool(0.9),
    };
  });
  // Ao menos uma ativa, senão não há para onde alocar e o cenário perde sentido.
  if (!unidades.some(u => u.ativa)) unidades[0].ativa = true;
  const ativas = unidades.filter(u => u.ativa);

  const nEquipes = a.int(1, 3);
  // Todas na escala: a exclusão por equipe tem teste determinístico próprio em
  // motor.teste.ts. Sortear aqui misturaria "ninguém foi alocado porque a
  // equipe está fora" com falha de invariante, e o contraexemplo do fuzzer
  // deixaria de apontar para a causa.
  const equipes = Array.from({ length: nEquipes }, (_, i) => ({ id: i + 1, nome: `Equipe ${i + 1}`, naEscala: true }));

  const postos: Posto[] = a.bool(0.4)
    ? Array.from({ length: a.int(1, 2) }, (_, i) => ({
        id: i + 1,
        unidadeId: a.de(ativas).id,
        nome: `Posto ${i + 1}`,
        vagas: a.int(1, 2),
        ativo: a.bool(0.85),
      }))
    : [];

  const nColabs = a.int(1, 18);
  const colaboradores: Colaborador[] = Array.from({ length: nColabs }, (_, i) => {
    const regime = a.bool(0.35) ? '12x36' as const : '5x2' as const;
    return {
      id: i + 1,
      perfilId: null,
      nome: `P${i + 1}`,
      matricula: String(i + 1),
      email: '',
      cargo: a.de(CARGOS),
      equipeId: a.de(equipes).id,
      gestorId: null,
      regime,
      turno: 'D' as const,
      ciclo: a.bool() ? 'IMPAR' as const : 'PAR' as const,
      entrada: '08:00',
      jornada: 8,
      unidadeBaseId: a.de(ativas).id,
      elegHome: a.bool(0.7),
      elegExterno: a.bool(0.3),
      sextaReduzida: a.bool(0.3),
      status: a.bool(0.9) ? 'ativo' as const : 'afastado' as const,
      admissao: '2024-01-01',
      desligamento: null,
    };
  });

  const planos: PlanoMensal[] = colaboradores.map(c => {
    // Distribuição fecha em 100 entre as ativas, como a tela obriga.
    const pesos = ativas.map(() => a.int(0, 4));
    const soma = pesos.reduce((x, y) => x + y, 0);
    const distribuicao: Record<number, number> = {};
    if (soma === 0) {
      distribuicao[c.unidadeBaseId] = 100;
    } else {
      let resta = 100;
      ativas.forEach((u, i) => {
        const v = i === ativas.length - 1 ? resta : Math.round((pesos[i] / soma) * 100);
        distribuicao[u.id] = Math.max(0, Math.min(resta, v));
        resta -= distribuicao[u.id];
      });
    }

    const unidadesFixas: Record<number, number> = {};
    for (const dow of a.amostra([1, 2, 3, 4, 5], 2)) unidadesFixas[dow] = a.de(ativas).id;

    const modo = a.bool(0.3) ? 'FIXO' as const : a.bool(0.5) ? 'COTA' as const : null;
    // Um dia não pode ser home fixo e unidade fixa ao mesmo tempo — a tela
    // bloqueia isso, então o cenário também respeita.
    const diasSemana = modo === 'FIXO'
      ? a.amostra([1, 2, 3, 4, 5], 2).filter(d => unidadesFixas[d] === undefined)
      : [];

    const postosDoPlano = postos
      .filter(p => p.ativo && (distribuicao[p.unidadeId] ?? 0) > 0 && a.bool(0.3))
      .map(p => ({ postoId: p.id, dias: a.int(1, 5), semana: a.bool(0.5) ? a.int(1, 6) : null }));

    return {
      id: c.id,
      colaboradorId: c.id,
      competencia: iso(ano, mes, 1),
      ciclo: a.bool(0.7) ? c.ciclo : null,
      homeOffice: {
        modo,
        diasSemana,
        quantidade: modo === 'COTA' ? a.int(1, 3) : 0,
        diasPreferencia: modo === 'COTA' ? a.amostra([1, 2, 3, 4, 5], 3) : [],
        diasProibidos: modo === 'COTA' ? a.amostra([1, 2, 3, 4, 5], 2) : [],
      },
      distribuicao,
      unidadesFixas,
      postos: postosDoPlano,
    };
  });

  // Ausências: podem começar antes do mês e invadir, como na vida real.
  const ausencias: Ausencia[] = [];
  for (const c of colaboradores) {
    if (!a.bool(0.35)) continue;
    const inicio = addDias(iso(ano, mes, 1), a.int(-20, nDias - 1));
    ausencias.push({
      id: ausencias.length + 1,
      colaboradorId: c.id,
      tipo: a.bool(0.4) ? 'FERIAS' : 'AUSENCIA',
      inicio,
      dias: a.int(1, 25),
      grupo: 'Teste',
      motivo: 'Teste',
    });
  }

  const capacidades = ativas.flatMap(u => {
    const out = [];
    if (a.bool(0.3)) {
      const total = a.int(0, 12);
      out.push({ unidadeId: u.id, dow: a.int(1, 5), data: null, total, reservadas: a.int(0, total) });
    }
    if (a.bool(0.2)) {
      const total = a.int(0, 12);
      out.push({ unidadeId: u.id, dow: null, data: iso(ano, mes, a.int(1, nDias)), total, reservadas: a.int(0, total) });
    }
    return out;
  });

  const cotasEquipe: CotaEquipe[] = [];
  for (const u of ativas) {
    for (const e of equipes) {
      if (!a.bool(0.25)) continue;
      cotasEquipe.push({ unidadeId: u.id, equipeId: e.id, dow: a.bool(0.3) ? a.int(1, 5) : null, limite: a.int(0, 6) });
    }
  }

  const pins: Pin[] = [];
  for (const c of a.amostra(colaboradores, 4)) {
    if (!a.bool(0.5)) continue;
    const modalidade = a.de(['UNIDADE', 'HOME', 'EXTERNO', 'FOLGA'] as const);
    pins.push({
      colaboradorId: c.id,
      data: iso(ano, mes, a.int(1, nDias)),
      modalidade,
      unidadeId: modalidade === 'UNIDADE' ? a.de(ativas).id : null,
    });
  }

  const feriados: Record<string, string> = {};
  for (let i = 0; i < a.int(0, 3); i++) feriados[iso(ano, mes, a.int(1, nDias))] = 'Feriado';

  return {
    ano, mes, unidades, equipes, postos, colaboradores, planos, ausencias,
    capacidades, cotasEquipe, feriados, pins,
    cicloAncora: iso(a.int(2024, 2026), a.int(0, 11), 1),
    toleranciaAderencia: a.int(0, 5),
    coberturaMinima: a.int(0, 3),
  };
}

/* ============================================================
   Invariantes
   ============================================================ */

type Falha = string | null;
const inv: { nome: string; checa: (e: GerarEscalaInput, r: ReturnType<typeof gerarEscala>) => Falha }[] = [];

const ativos = (e: GerarEscalaInput) => e.colaboradores.filter(c => c.status === 'ativo');
const datasDoMes = (e: GerarEscalaInput) =>
  Array.from({ length: diasNoMes(e.ano, e.mes) }, (_, i) => iso(e.ano, e.mes, i + 1));

inv.push({
  nome: 'toda pessoa ativa tem exatamente uma alocação por dia',
  checa: (e, r) => {
    const esperado = ativos(e).length * diasNoMes(e.ano, e.mes);
    const chaves = new Set(r.alocacoes.map(a => `${a.colaboradorId}|${a.data}`));
    if (chaves.size !== r.alocacoes.length) return 'há alocações duplicadas para a mesma pessoa no mesmo dia';
    if (r.alocacoes.length !== esperado) return `esperado ${esperado} alocações, veio ${r.alocacoes.length}`;
    return null;
  },
});

inv.push({
  nome: 'ninguém aparece em unidade durante férias ou ausência',
  checa: (e, r) => {
    for (const au of e.ausencias) {
      const fim = addDias(au.inicio, au.dias - 1);
      const invasoras = r.alocacoes.filter(
        x => x.colaboradorId === au.colaboradorId && x.data >= au.inicio && x.data <= fim
          && x.modalidade === 'UNIDADE' && !x.travado
      );
      if (invasoras.length) return `${au.colaboradorId} alocado em ${invasoras[0].data}, dentro de ${au.inicio}..${fim}`;
    }
    return null;
  },
});

inv.push({
  nome: 'capacidade da unidade nunca é estourada pelo preenchimento livre',
  checa: (e, r) => {
    for (const data of datasDoMes(e)) {
      for (const u of e.unidades.filter(x => x.ativa)) {
        const cap = r.capacidadeDia[data]?.[u.id] ?? 0;
        const ocupada = r.ocupacao[data]?.[u.id] ?? 0;
        // Estouro só é aceitável quando vem de decisão rígida (trava/unidade
        // fixa), e nesse caso o motor é obrigado a registrar conflito.
        if (ocupada > cap) {
          const temConflito = r.conflitos.some(c => c.data === data && c.msg.includes(u.nome));
          if (!temConflito) return `${u.nome} em ${data}: ${ocupada}/${cap} sem conflito registrado`;
        }
      }
    }
    return null;
  },
});

inv.push({
  nome: 'cota por equipe nunca é estourada sem conflito',
  checa: (e, r) => {
    const porColab = new Map(e.colaboradores.map(c => [c.id, c]));
    for (const data of datasDoMes(e)) {
      const dow = diaSemana(e.ano, e.mes, Number(data.slice(8)));
      const conta = new Map<string, number>();
      for (const al of r.alocacoes.filter(x => x.data === data && x.modalidade === 'UNIDADE')) {
        const c = porColab.get(al.colaboradorId);
        if (!c || al.unidadeId === null) continue;
        const k = `${al.unidadeId}|${c.equipeId}`;
        conta.set(k, (conta.get(k) ?? 0) + 1);
      }
      for (const cota of e.cotasEquipe) {
        const especifica = e.cotasEquipe.find(
          x => x.unidadeId === cota.unidadeId && x.equipeId === cota.equipeId && x.dow === dow
        );
        const vigente = especifica ?? e.cotasEquipe.find(
          x => x.unidadeId === cota.unidadeId && x.equipeId === cota.equipeId && x.dow === null
        );
        if (!vigente) continue;
        const usados = conta.get(`${cota.unidadeId}|${cota.equipeId}`) ?? 0;
        if (usados > vigente.limite) {
          const temConflito = r.conflitos.some(c => c.data === data && c.msg.includes('cota'));
          if (!temConflito) return `unidade ${cota.unidadeId} / equipe ${cota.equipeId} em ${data}: ${usados} > ${vigente.limite}`;
        }
      }
    }
    return null;
  },
});

inv.push({
  nome: '12x36 nunca trabalha dois dias seguidos sem conflito registrado',
  checa: (e, r) => {
    for (const c of ativos(e).filter(x => x.regime === '12x36')) {
      const dele = r.alocacoes.filter(a => a.colaboradorId === c.id).sort((a, b) => a.data.localeCompare(b.data));
      for (let i = 1; i < dele.length; i++) {
        const trabalhaHoje = dele[i].modalidade !== 'DESCANSO';
        const trabalhaOntem = dele[i - 1].modalidade !== 'DESCANSO';
        if (trabalhaHoje && trabalhaOntem) {
          const temConflito = r.conflitos.some(x => x.colaboradorId === c.id && x.data === dele[i].data);
          const ehAusencia = ['FERIAS', 'FOLGA', 'FERIADO'].includes(dele[i].modalidade)
            || ['FERIAS', 'FOLGA', 'FERIADO'].includes(dele[i - 1].modalidade);
          if (!temConflito && !ehAusencia && !dele[i].travado && !dele[i - 1].travado) {
            return `${c.nome} trabalha em ${dele[i - 1].data} e ${dele[i].data}`;
          }
        }
      }
    }
    return null;
  },
});

inv.push({
  nome: 'trava manual é sempre respeitada',
  checa: (e, r) => {
    for (const p of e.pins) {
      if (!ativos(e).some(c => c.id === p.colaboradorId)) continue;
      const a = r.alocacoes.find(x => x.colaboradorId === p.colaboradorId && x.data === p.data);
      if (!a) return `trava de ${p.colaboradorId} em ${p.data} sumiu`;
      if (a.modalidade !== p.modalidade) return `trava de ${p.colaboradorId} em ${p.data}: ${a.modalidade} ≠ ${p.modalidade}`;
      if (a.unidadeId !== p.unidadeId) return `trava de ${p.colaboradorId} em ${p.data}: unidade ${a.unidadeId} ≠ ${p.unidadeId}`;
    }
    return null;
  },
});

inv.push({
  nome: 'home office fixo cai só nos dias marcados',
  checa: (e, r) => {
    for (const c of ativos(e)) {
      const ho = e.planos.find(p => p.colaboradorId === c.id)?.homeOffice;
      if (ho?.modo !== 'FIXO') continue;
      for (const a of r.alocacoes.filter(x => x.colaboradorId === c.id && x.modalidade === 'HOME' && !x.travado)) {
        const dow = diaSemana(e.ano, e.mes, Number(a.data.slice(8)));
        if (!ho.diasSemana.includes(dow)) return `${c.nome} em home no dia da semana ${dow}, fora do fixo`;
      }
    }
    return null;
  },
});

inv.push({
  nome: 'cota de home office nunca usa dia proibido',
  checa: (e, r) => {
    for (const c of ativos(e)) {
      const ho = e.planos.find(p => p.colaboradorId === c.id)?.homeOffice;
      if (ho?.modo !== 'COTA') continue;
      for (const a of r.alocacoes.filter(x => x.colaboradorId === c.id && x.modalidade === 'HOME' && !x.travado)) {
        const dow = diaSemana(e.ano, e.mes, Number(a.data.slice(8)));
        if (ho.diasProibidos.includes(dow)) return `${c.nome} em home num dia proibido (${dow})`;
      }
    }
    return null;
  },
});

inv.push({
  // Trava o rateio da cota em semanas encurtadas. Sem ele, uma semana com um
  // dia útil só aceitava a cota cheia — e o motor mandava o time inteiro para
  // casa nesse dia, porque era o único lugar onde a cota cabia.
  nome: 'cota de home office por semana nunca passa do rateio pelo tamanho da semana',
  checa: (e, r) => {
    const nDias = new Date(Date.UTC(e.ano, e.mes + 1, 0)).getUTCDate();
    const dowDoPrimeiro = diaSemana(e.ano, e.mes, 1);
    const semanaDe = (dia: number) => Math.floor((dia + dowDoPrimeiro - 1) / 7);

    const uteis = new Map<number, number>();
    for (let d = 1; d <= nDias; d++) {
      const dow = diaSemana(e.ano, e.mes, d);
      const data = `${e.ano}-${String(e.mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dow === 0 || dow === 6 || e.feriados[data]) continue;
      uteis.set(semanaDe(d), (uteis.get(semanaDe(d)) ?? 0) + 1);
    }

    for (const c of ativos(e)) {
      const ho = e.planos.find(p => p.colaboradorId === c.id)?.homeOffice;
      if (ho?.modo !== 'COTA') continue;

      const porSemana = new Map<number, number>();
      for (const a of r.alocacoes.filter(x => x.colaboradorId === c.id && x.modalidade === 'HOME' && !x.travado)) {
        const s = semanaDe(Number(a.data.slice(8)));
        porSemana.set(s, (porSemana.get(s) ?? 0) + 1);
      }
      for (const [s, usados] of porSemana) {
        const teto = Math.min(ho.quantidade, Math.round((ho.quantidade * (uteis.get(s) ?? 0)) / 5));
        if (usados > teto) return `${c.nome} recebeu ${usados} home na semana ${s + 1}, teto ${teto}`;
      }
    }
    return null;
  },
});

inv.push({
  nome: 'quem não é elegível a home office nunca recebe home',
  checa: (e, r) => {
    for (const c of ativos(e).filter(x => !x.elegHome)) {
      const achou = r.alocacoes.find(a => a.colaboradorId === c.id && a.modalidade === 'HOME' && !a.travado);
      if (achou) return `${c.nome} não é elegível mas recebeu home em ${achou.data}`;
    }
    return null;
  },
});

inv.push({
  nome: 'posto é sempre na unidade dele, em dias úteis contíguos, sem estourar vagas',
  checa: (e, r) => {
    const porId = new Map(e.postos.map(p => [p.id, p]));
    // Agrupa por (pessoa, POSTO): a mesma pessoa pode cobrir dois postos
    // diferentes em semanas diferentes, e isso não é descontinuidade.
    const porPessoaPosto = new Map<string, string[]>();

    for (const a of r.alocacoes.filter(x => x.postoId !== null)) {
      const p = porId.get(a.postoId!);
      if (!p) return `alocação aponta para posto inexistente ${a.postoId}`;
      if (!p.ativo) return `posto inativo ${p.nome} recebeu alocação`;
      if (a.unidadeId !== p.unidadeId) return `posto ${p.nome} alocado na unidade ${a.unidadeId}, não na ${p.unidadeId}`;
      const dow = diaSemana(e.ano, e.mes, Number(a.data.slice(8)));
      if (dow === 0 || dow === 6) return `posto ${p.nome} alocado num fim de semana (${a.data})`;
      const k = `${a.colaboradorId}|${a.postoId}`;
      const lista = porPessoaPosto.get(k) ?? [];
      lista.push(a.data);
      porPessoaPosto.set(k, lista);
    }

    // Vagas simultâneas
    const porPostoDia = new Map<string, number>();
    for (const a of r.alocacoes.filter(x => x.postoId !== null)) {
      const k = `${a.postoId}|${a.data}`;
      porPostoDia.set(k, (porPostoDia.get(k) ?? 0) + 1);
    }
    for (const [k, n] of porPostoDia) {
      const p = porId.get(Number(k.split('|')[0]))!;
      if (n > p.vagas) return `posto ${p.nome} com ${n} pessoas em ${k.split('|')[1]}, vagas=${p.vagas}`;
    }

    // Contiguidade em dias úteis
    for (const [k, dias] of porPessoaPosto) {
      const colabId = k.split('|')[0];
      const ord = dias.slice().sort();
      for (let i = 1; i < ord.length; i++) {
        let esperado = addDias(ord[i - 1], 1);
        while ([0, 6].includes(diaSemana(...(([Number(esperado.slice(0, 4)), Number(esperado.slice(5, 7)) - 1, Number(esperado.slice(8))]) as [number, number, number])))) {
          esperado = addDias(esperado, 1);
        }
        if (ord[i] !== esperado) return `posto de ${colabId} não é contíguo: ${ord[i - 1]} → ${ord[i]}`;
      }
    }
    return null;
  },
});

inv.push({
  nome: 'unidade fixa do dia da semana é respeitada quando o dia é presencial',
  checa: (e, r) => {
    for (const c of ativos(e)) {
      const plano = e.planos.find(p => p.colaboradorId === c.id);
      if (!plano) continue;
      for (const a of r.alocacoes.filter(x => x.colaboradorId === c.id && x.modalidade === 'UNIDADE' && !x.travado && x.postoId === null)) {
        const dow = diaSemana(e.ano, e.mes, Number(a.data.slice(8)));
        const fixa = plano.unidadesFixas[dow];
        if (fixa !== undefined && e.unidades.some(u => u.id === fixa && u.ativa) && a.unidadeId !== fixa) {
          return `${c.nome} em ${a.data} deveria estar na unidade fixa ${fixa}, está na ${a.unidadeId}`;
        }
      }
    }
    return null;
  },
});

inv.push({
  nome: 'alocação em unidade sempre aponta para uma unidade ativa existente',
  checa: (e, r) => {
    const ativasIds = new Set(e.unidades.filter(u => u.ativa).map(u => u.id));
    for (const a of r.alocacoes) {
      if (a.modalidade === 'UNIDADE') {
        if (a.unidadeId === null) return `alocação UNIDADE sem unidade em ${a.data}`;
        if (!ativasIds.has(a.unidadeId) && !a.travado) return `unidade ${a.unidadeId} inativa/inexistente em ${a.data}`;
      } else if (a.unidadeId !== null && !a.travado) {
        return `modalidade ${a.modalidade} com unidade preenchida em ${a.data}`;
      }
    }
    return null;
  },
});

inv.push({
  nome: 'a mesma entrada produz exatamente a mesma escala',
  checa: (e) => {
    const a = gerarEscala(e);
    const b = gerarEscala(e);
    const sa = JSON.stringify(a.alocacoes);
    const sb = JSON.stringify(b.alocacoes);
    if (sa !== sb) return 'duas execuções divergiram';
    if (JSON.stringify(a.conflitos) !== JSON.stringify(b.conflitos)) return 'conflitos divergiram';
    return null;
  },
});

inv.push({
  nome: 'ocupação relatada bate com as alocações emitidas',
  checa: (e, r) => {
    for (const data of datasDoMes(e)) {
      for (const u of e.unidades.filter(x => x.ativa)) {
        const real = r.alocacoes.filter(a => a.data === data && a.modalidade === 'UNIDADE' && a.unidadeId === u.id).length;
        const relatada = r.ocupacao[data]?.[u.id] ?? 0;
        if (real !== relatada) return `${u.nome} em ${data}: ocupação diz ${relatada}, alocações somam ${real}`;
      }
    }
    return null;
  },
});

/* ============================================================
   Execução
   ============================================================ */

// Só roda a bateria quando ESTE arquivo é o executado. Sem a guarda, importar o
// gerador para diagnosticar uma semente dispararia as 3000 rodadas de novo.
const executandoDireto = process.argv[1]?.includes('motor.propriedades');

const RODADAS = Number(process.env.RODADAS ?? 3000);
const SEMENTE_FIXA = process.env.SEMENTE ? Number(process.env.SEMENTE) : null;

let falhas = 0;
const porInvariante = new Map<string, number>();
const t0 = Date.now();

const sementes = SEMENTE_FIXA !== null ? [SEMENTE_FIXA] : Array.from({ length: RODADAS }, (_, i) => i + 1);

if (executandoDireto) {
  for (const semente of sementes) {
    const entrada = gerarCenario(aleatorio(semente));
    let resultado;
    try {
      resultado = gerarEscala(entrada);
    } catch (err) {
      falhas++;
      console.log(`EXCEÇÃO na semente ${semente}: ${(err as Error).message}`);
      continue;
    }
    for (const { nome, checa } of inv) {
      const problema = checa(entrada, resultado);
      if (problema) {
        falhas++;
        porInvariante.set(nome, (porInvariante.get(nome) ?? 0) + 1);
        if ((porInvariante.get(nome) ?? 0) <= 3) {
          console.log(`FALHOU [semente ${semente}] ${nome}\n         ${problema}`);
        }
      }
    }
  }

  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n${sementes.length} cenários × ${inv.length} invariantes = ${sementes.length * inv.length} verificações em ${seg}s`
  );

  if (falhas === 0) {
    console.log('TODAS AS PROPRIEDADES SE MANTIVERAM');
  } else {
    console.log(`\n${falhas} violação(ões):`);
    for (const [nome, n] of [...porInvariante].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${nome}`);
    }
    console.log('\nReproduza um caso com: SEMENTE=<n> npx tsx src/lib/domain/escalas/motor.propriedades.ts');
    process.exit(1);
  }
}
