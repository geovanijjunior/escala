import { gerarEscala } from './motor';
import { cicloEfetivo } from './datas';
import type { Colaborador, PlanoMensal, Unidade } from './tipos';

let falhas = 0;
const ok = (cond: boolean, nome: string, extra = '') => {
  if (!cond) { falhas++; console.log('FALHOU:', nome, extra); }
  else console.log('ok:', nome);
};

const unidades: Unidade[] = [
  { id: 1, codigo: 'MOR', nome: 'Morumbi', sigla: 'MOR', cor: '#000', bg: '#fff', capacidadeTotal: 4, capacidadeReservadas: 0, ordem: 1, ativa: true, paiId: null },
  { id: 2, codigo: 'PAU', nome: 'Paulista', sigla: 'PAU', cor: '#000', bg: '#fff', capacidadeTotal: 4, capacidadeReservadas: 0, ordem: 2, ativa: true, paiId: null },
];

const mkColab = (id: number, over: Partial<Colaborador> = {}): Colaborador => ({
  id, perfilId: null, nome: `P${id}`, matricula: String(id), email: '', cargo: 'Analista Jr',
  equipeId: 1, gestorId: null, regime: '5x2', turno: 'D', ciclo: null, entrada: '08:00', jornada: 8,
  unidadeBaseId: 1, elegHome: true, elegExterno: false, sextaReduzida: true, status: 'ativo',
  admissao: '2024-01-01', desligamento: null, ...over,
});

const mkPlano = (colaboradorId: number, over: Partial<PlanoMensal> = {}): PlanoMensal => ({
  id: colaboradorId, colaboradorId, competencia: '2026-08-01', ciclo: null,
  homeOffice: { modo: null, diasSemana: [], quantidade: 0, diasPreferencia: [], diasProibidos: [] },
  distribuicao: { 1: 100, 2: 0 }, unidadesFixas: {}, ...over,
});

const equipes = [{ id: 1, nome: 'Técnicos 12x36' }, { id: 2, nome: 'Analistas' }];

const base = {
  ano: 2026, mes: 7, unidades, equipes, ausencias: [], capacidades: [], cotasEquipe: [],
  feriados: {}, pins: [], cicloAncora: '2026-01-01', toleranciaAderencia: 1, coberturaMinima: 0,
};

// ── 1. 5x2 não trabalha fim de semana e respeita feriado
{
  const r = gerarEscala({ ...base, colaboradores: [mkColab(1)], planos: [mkPlano(1)], feriados: { '2026-08-05': 'Teste' } });
  const dom = r.alocacoes.find(a => a.data === '2026-08-02'); // domingo
  const fer = r.alocacoes.find(a => a.data === '2026-08-05');
  const seg = r.alocacoes.find(a => a.data === '2026-08-03');
  ok(dom?.modalidade === 'DESCANSO', '5x2 descansa no domingo', dom?.modalidade);
  ok(fer?.modalidade === 'FERIADO', '5x2 folga no feriado', fer?.modalidade);
  ok(seg?.modalidade === 'UNIDADE' && seg.unidadeId === 1, '5x2 vai pra unidade base na segunda');
}

// ── 2. 12x36 alterna dias e nunca cai em dias consecutivos
{
  const c = mkColab(1, { regime: '12x36', ciclo: 'IMPAR', jornada: 12 });
  const r = gerarEscala({ ...base, colaboradores: [c], planos: [mkPlano(1, { ciclo: 'IMPAR' })] });
  const trabalhados = r.alocacoes.filter(a => a.modalidade === 'UNIDADE').map(a => Number(a.data.slice(8)));
  ok(trabalhados.every(d => d % 2 === 1), '12x36 IMPAR só em dias ímpares');
  ok(trabalhados.length === 16, '12x36 em agosto/2026 tem 16 plantões ímpares', String(trabalhados.length));
  ok(r.conflitos.length === 0, '12x36 sem conflito de descanso', JSON.stringify(r.conflitos));
}

// ── 3. paridade do ciclo vira sozinha após mês de 31 dias
{
  ok(cicloEfetivo('IMPAR', '2026-01-01', '2026-01-01') === 'IMPAR', 'âncora mantém o ciclo');
  ok(cicloEfetivo('IMPAR', '2026-02-01', '2026-01-01') === 'PAR', 'janeiro (31d) inverte em fevereiro');
  ok(cicloEfetivo('IMPAR', '2026-03-01', '2026-01-01') === 'PAR', 'fevereiro (28d) mantém em março');
  ok(cicloEfetivo('IMPAR', '2026-04-01', '2026-01-01') === 'IMPAR', 'março (31d) inverte em abril');
  ok(cicloEfetivo('IMPAR', '2025-12-01', '2026-01-01') === 'PAR', 'funciona pra trás da âncora');
}

// ── 4. distribuição 50/50 fica dentro da tolerância
{
  const colaboradores = [1, 2, 3, 4].map(i => mkColab(i));
  const planos = [1, 2, 3, 4].map(i => mkPlano(i, { distribuicao: { 1: 50, 2: 50 } }));
  const r = gerarEscala({ ...base, colaboradores, planos });
  ok(r.aderencia.every(a => a.ok), '50/50 fica dentro da tolerância', JSON.stringify(r.aderencia));
  const p1 = r.aderencia[0].desvios;
  ok(Math.abs(p1[0].realizado - p1[1].realizado) <= 1, 'os dias ficam repartidos entre as duas unidades', JSON.stringify(p1));
}

// ── 5. capacidade estourada manda o excedente pra Externo com conflito
{
  const colaboradores = Array.from({ length: 9 }, (_, i) => mkColab(i + 1));
  const planos = colaboradores.map(c => mkPlano(c.id, { distribuicao: { 1: 50, 2: 50 } }));
  const r = gerarEscala({ ...base, colaboradores, planos });
  const externos = r.alocacoes.filter(a => a.modalidade === 'EXTERNO');
  ok(externos.length > 0, '9 pessoas para 8 posições geram Trabalho Externo', String(externos.length));
  ok(r.conflitos.some(c => c.msg.includes('Sem posição disponível')), 'conflito de capacidade registrado');
  const seg = '2026-08-03';
  ok(r.ocupacao[seg][1] <= 4 && r.ocupacao[seg][2] <= 4, 'capacidade nunca é estourada pelo motor');
}

// ── 6. home office fixo e cota
{
  const cFixo = mkColab(1, { nome: 'Fixo' });
  const cCota = mkColab(2, { nome: 'Cota' });
  const r = gerarEscala({
    ...base,
    colaboradores: [cFixo, cCota],
    planos: [
      mkPlano(1, { homeOffice: { modo: 'FIXO', diasSemana: [2, 4], quantidade: 0, diasPreferencia: [], diasProibidos: [] } }),
      mkPlano(2, { homeOffice: { modo: 'COTA', diasSemana: [], quantidade: 2, diasPreferencia: [1, 3], diasProibidos: [5] } }),
    ],
  });
  const homeFixo = r.alocacoes.filter(a => a.colaboradorId === 1 && a.modalidade === 'HOME');
  ok(homeFixo.every(a => [2, 4].includes(new Date(a.data + 'T12:00:00').getDay())), 'home fixo cai só nos dias marcados');
  const homeCota = r.alocacoes.filter(a => a.colaboradorId === 2 && a.modalidade === 'HOME');
  ok(homeCota.every(a => new Date(a.data + 'T12:00:00').getDay() !== 5), 'cota nunca usa dia proibido');
  ok(homeCota.length >= 8, 'cota de 2 dias/semana rende ~2 por semana útil', String(homeCota.length));
}

// ── 7. trava manual sobrevive e ocupa posição
{
  const r = gerarEscala({
    ...base,
    colaboradores: [mkColab(1)],
    planos: [mkPlano(1, { distribuicao: { 1: 100, 2: 0 } })],
    pins: [{ colaboradorId: 1, data: '2026-08-03', modalidade: 'UNIDADE', unidadeId: 2 }],
  });
  const a = r.alocacoes.find(x => x.data === '2026-08-03');
  ok(a?.unidadeId === 2 && a.travado, 'trava manual vence a distribuição');
  ok(r.ocupacao['2026-08-03'][2] === 1, 'trava conta na ocupação da unidade');
}

// ── 8. ausência que começa no mês anterior segue bloqueando
{
  const r = gerarEscala({
    ...base,
    colaboradores: [mkColab(1)],
    planos: [mkPlano(1)],
    ausencias: [{ id: 1, colaboradorId: 1, tipo: 'FERIAS', inicio: '2026-07-20', dias: 30, grupo: '', motivo: '' }],
  });
  const d3 = r.alocacoes.find(a => a.data === '2026-08-03');
  const d20 = r.alocacoes.find(a => a.data === '2026-08-20');
  ok(d3?.modalidade === 'FERIAS', 'férias iniciadas em julho cobrem agosto', d3?.modalidade);
  ok(d20?.modalidade === 'UNIDADE', 'depois do fim das férias volta a trabalhar', d20?.modalidade);
}

// ── 9. mesma entrada gera exatamente o mesmo resultado
{
  const colaboradores = Array.from({ length: 6 }, (_, i) => mkColab(i + 1));
  const planos = colaboradores.map(c => mkPlano(c.id, { distribuicao: { 1: 50, 2: 50 } }));
  const a = gerarEscala({ ...base, colaboradores, planos });
  const b = gerarEscala({ ...base, colaboradores: [...colaboradores].reverse(), planos: [...planos].reverse() });
  ok(JSON.stringify(a.alocacoes) === JSON.stringify(b.alocacoes), 'geração é determinística independente da ordem de entrada');
}

// ── 10. capacidade por data específica tem precedência
{
  const colaboradores = [1, 2, 3].map(i => mkColab(i));
  const planos = colaboradores.map(c => mkPlano(c.id, { distribuicao: { 1: 100, 2: 0 } }));
  const r = gerarEscala({
    ...base, colaboradores, planos,
    capacidades: [{ unidadeId: 1, dow: null, data: '2026-08-03', total: 1, reservadas: 0 }],
  });
  ok(r.capacidadeDia['2026-08-03'][1] === 1, 'capacidade específica do dia é aplicada');
  ok(r.ocupacao['2026-08-03'][1] === 1, 'só 1 pessoa entra na unidade nesse dia');
  ok(r.ocupacao['2026-08-04'][1] === 3, 'no dia seguinte volta a capacidade padrão');
}


// ── Sub-unidade: um posto dentro de outra unidade (Corpo Clínico no Morumbi)
{
  const comPosto: Unidade[] = [
    ...unidades,
    { id: 3, codigo: 'CCL', nome: 'Corpo Clínico', sigla: 'CCL', cor: '#000', bg: '#fff', capacidadeTotal: 1, capacidadeReservadas: 0, ordem: 3, ativa: true, paiId: 1 },
  ];
  const baseP = { ...base, unidades: comPosto };

  // Quem está no posto ocupa lugar também no prédio que o contém.
  {
    const r = gerarEscala({
      ...baseP,
      colaboradores: [mkColab(1)],
      planos: [mkPlano(1, { distribuicao: { 1: 0, 2: 0, 3: 100 } })],
    });
    const seg = r.alocacoes.find(a => a.data === '2026-08-03');
    ok(seg?.unidadeId === 3, 'posto interno recebe a alocação', String(seg?.unidadeId));
    ok(r.ocupacao['2026-08-03'][3] === 1, 'ocupação contada no posto', String(r.ocupacao['2026-08-03'][3]));
    ok(r.ocupacao['2026-08-03'][1] === 1, 'ocupação sobe para a unidade pai', String(r.ocupacao['2026-08-03'][1]));
  }

  // O posto tem 1 vaga: o segundo candidato não entra nele.
  {
    const r = gerarEscala({
      ...baseP,
      colaboradores: [mkColab(1), mkColab(2)],
      planos: [
        mkPlano(1, { distribuicao: { 1: 0, 2: 0, 3: 100 } }),
        mkPlano(2, { distribuicao: { 1: 0, 2: 0, 3: 100 } }),
      ],
    });
    const noPosto = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 3);
    ok(noPosto.length === 1, 'posto de 1 vaga não recebe 2 pessoas', String(noPosto.length));
  }

  // Prédio lotado bloqueia o posto mesmo com vaga nele.
  {
    const apertado: Unidade[] = [
      { ...comPosto[0], capacidadeTotal: 2 },
      comPosto[1],
      { ...comPosto[2], capacidadeTotal: 5 },
    ];
    const r = gerarEscala({
      ...base,
      unidades: apertado,
      colaboradores: [mkColab(1), mkColab(2), mkColab(3)],
      planos: [
        mkPlano(1, { distribuicao: { 1: 0, 2: 0, 3: 100 } }),
        mkPlano(2, { distribuicao: { 1: 0, 2: 0, 3: 100 } }),
        mkPlano(3, { distribuicao: { 1: 0, 2: 0, 3: 100 } }),
      ],
    });
    const dentro = r.ocupacao['2026-08-03'][1];
    ok(dentro <= 2, 'pai de 2 lugares não é estourado pelo posto', String(dentro));
    const terceiro = r.alocacoes.find(a => a.data === '2026-08-03' && a.colaboradorId === 3);
    ok(terceiro?.unidadeId !== 3, 'terceira pessoa não entra no posto com o pai cheio', String(terceiro?.unidadeId));
  }

  // Cobertura mínima não cobra presença de posto interno.
  {
    const r = gerarEscala({
      ...baseP,
      coberturaMinima: 1,
      colaboradores: [mkColab(1)],
      planos: [mkPlano(1, { distribuicao: { 1: 100, 2: 0, 3: 0 } })],
    });
    const sobrePosto = r.alertas.filter(a => a.msg.includes('Corpo Clínico'));
    ok(sobrePosto.length === 0, 'posto interno fora da cobertura mínima', String(sobrePosto.length));
  }
}

// ── Cota por equipe: teto de pessoas de uma equipe numa unidade
{
  // 4 técnicos (equipe 1) querendo o Morumbi, que tem 4 lugares mas cota 2.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [{ unidadeId: 1, equipeId: 1, dow: null, limite: 2 }],
      colaboradores: [1, 2, 3, 4].map(id => mkColab(id, { equipeId: 1 })),
      planos: [1, 2, 3, 4].map(id => mkPlano(id, { distribuicao: { 1: 100, 2: 0 } })),
    });
    const noMor = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1);
    ok(noMor.length === 2, 'cota de 2 limita a equipe mesmo com 4 lugares', String(noMor.length));
    const foram = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 2);
    ok(foram.length === 2, 'os excedentes vão para a outra unidade', String(foram.length));
  }

  // Equipe sem cota cadastrada não é limitada.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [{ unidadeId: 1, equipeId: 1, dow: null, limite: 2 }],
      colaboradores: [1, 2, 3].map(id => mkColab(id, { equipeId: 2 })),
      planos: [1, 2, 3].map(id => mkPlano(id, { distribuicao: { 1: 100, 2: 0 } })),
    });
    const noMor = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1);
    ok(noMor.length === 3, 'equipe sem cota não é limitada', String(noMor.length));
  }

  // Cota por dia da semana tem precedência sobre a geral.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [
        { unidadeId: 1, equipeId: 1, dow: null, limite: 3 },
        { unidadeId: 1, equipeId: 1, dow: 1, limite: 1 }, // segunda
      ],
      colaboradores: [1, 2, 3].map(id => mkColab(id, { equipeId: 1 })),
      planos: [1, 2, 3].map(id => mkPlano(id, { distribuicao: { 1: 100, 2: 0 } })),
    });
    const seg = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1); // segunda
    const ter = r.alocacoes.filter(a => a.data === '2026-08-04' && a.unidadeId === 1); // terça
    ok(seg.length === 1, 'cota da segunda (1) vence a geral (3)', String(seg.length));
    ok(ter.length === 3, 'terça usa a cota geral (3)', String(ter.length));
  }

  // Cotas que fecham a capacidade viram garantia: analista não toma lugar de técnico.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [
        { unidadeId: 1, equipeId: 1, dow: null, limite: 3 }, // técnicos
        { unidadeId: 1, equipeId: 2, dow: null, limite: 1 }, // analistas
      ],
      colaboradores: [
        mkColab(1, { equipeId: 2 }), mkColab(2, { equipeId: 2 }), mkColab(3, { equipeId: 2 }),
        mkColab(4, { equipeId: 1 }),
      ],
      planos: [1, 2, 3, 4].map(id => mkPlano(id, { distribuicao: { 1: 100, 2: 0 } })),
    });
    const analistas = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1 && a.colaboradorId <= 3);
    const tecnico = r.alocacoes.find(a => a.data === '2026-08-03' && a.colaboradorId === 4);
    ok(analistas.length === 1, 'analistas param na cota de 1', String(analistas.length));
    ok(tecnico?.unidadeId === 1, 'lugar do técnico continua disponível para ele', String(tecnico?.unidadeId));
  }

  // Cota estourada por trava é conflito, não é contornada silenciosamente.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [{ unidadeId: 1, equipeId: 1, dow: null, limite: 1 }],
      colaboradores: [mkColab(1, { equipeId: 1 }), mkColab(2, { equipeId: 1 })],
      planos: [mkPlano(1), mkPlano(2)],
      pins: [
        { colaboradorId: 1, data: '2026-08-03', modalidade: 'UNIDADE' as const, unidadeId: 1 },
        { colaboradorId: 2, data: '2026-08-03', modalidade: 'UNIDADE' as const, unidadeId: 1 },
      ],
    });
    const sobreCota = r.conflitos.filter(c => c.msg.includes('cota de 1'));
    ok(sobreCota.length === 1, 'trava que estoura a cota vira conflito', String(sobreCota.length));
    ok(sobreCota[0]?.msg.includes('Técnicos 12x36'), 'conflito nomeia a equipe', sobreCota[0]?.msg ?? '');
  }
}

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
