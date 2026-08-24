import { gerarEscala } from './motor';
import { cicloDoMes, cicloEfetivo, iso } from './datas';
import type { Colaborador, PlanoMensal, Unidade } from './tipos';

let falhas = 0;
const ok = (cond: boolean, nome: string, extra = '') => {
  if (!cond) { falhas++; console.log('FALHOU:', nome, extra); }
  else console.log('ok:', nome);
};

const unidades: Unidade[] = [
  { id: 1, codigo: 'MOR', nome: 'Morumbi', sigla: 'MOR', cor: '#000', bg: '#fff', capacidadeTotal: 4, capacidadeReservadas: 0, ordem: 1, ativa: true },
  { id: 2, codigo: 'PAU', nome: 'Paulista', sigla: 'PAU', cor: '#000', bg: '#fff', capacidadeTotal: 4, capacidadeReservadas: 0, ordem: 2, ativa: true },
];

const mkColab = (id: number, over: Partial<Colaborador> = {}): Colaborador => ({
  id, perfilId: null, nome: `P${id}`, matricula: String(id), email: '', cargo: 'Analista Jr',
  equipeId: 1, gestorId: null, regime: '5x2', turno: 'D', ciclo: null, entrada: '08:00', saida: '17:00',
  unidadeBaseId: 1, elegHome: true, elegExterno: false, sextaReduzida: true, status: 'ativo',
  admissao: '2024-01-01', desligamento: null, ...over,
});

const mkPlano = (colaboradorId: number, over: Partial<PlanoMensal> = {}): PlanoMensal => ({
  id: colaboradorId, colaboradorId, competencia: '2026-08-01', ciclo: null,
  homeOffice: { modo: null, diasSemana: [], quantidade: 0, diasPreferencia: [], diasProibidos: [] },
  distribuicao: { 1: 100, 2: 0 }, unidadesFixas: {}, postos: [], ...over,
});

const equipes = [
  { id: 1, nome: 'Técnicos 12x36', naEscala: true },
  { id: 2, nome: 'Analistas', naEscala: true },
];

const base = {
  ano: 2026, mes: 7, unidades, equipes, postos: [], ausencias: [], capacidades: [], cotasEquipe: [],
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
  const c = mkColab(1, { regime: '12x36', ciclo: 'IMPAR', saida: '19:00' });
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

  // `cicloDoMes` é quem o motor e a tela consultam. As três origens da
  // paridade, na ordem em que valem.
  const ANCORA = '2026-01-01';

  ok(cicloDoMes({ ciclo: 'IMPAR', herdadoDe: null }, null, '2026-02-01', ANCORA) === 'IMPAR',
    'plano salvo NESTE mês vale como está, mesmo contrariando a virada');
  ok(cicloDoMes({ ciclo: 'PAR', herdadoDe: null }, 'IMPAR', '2026-08-01', ANCORA) === 'PAR',
    'decisão do mês ignora o ciclo histórico do cadastro');

  // O defeito que isto trava: um plano herdado de janeiro entrava em fevereiro
  // com a paridade de janeiro, e a pessoa emendava dois plantões na virada.
  ok(cicloDoMes({ ciclo: 'IMPAR', herdadoDe: '2026-01-01' }, null, '2026-02-01', ANCORA) === 'PAR',
    'plano herdado de janeiro (31d) entra virado em fevereiro');
  ok(cicloDoMes({ ciclo: 'IMPAR', herdadoDe: '2026-01-01' }, null, '2026-03-01', ANCORA) === 'PAR',
    'fevereiro (28d) não vira de novo em março');
  ok(cicloDoMes({ ciclo: 'IMPAR', herdadoDe: '2026-01-01' }, null, '2026-04-01', ANCORA) === 'IMPAR',
    'março (31d) devolve a paridade original em abril');

  ok(cicloDoMes(null, 'IMPAR', '2026-02-01', ANCORA) === 'PAR',
    'sem plano, deriva do cadastro contra a âncora');
  ok(cicloDoMes(null, null, ANCORA, ANCORA) === 'IMPAR',
    'sem plano e sem cadastro, cai em ímpares');
}

// ── 3b. plano herdado não congela a paridade na escala gerada
{
  // O MESMO plano, decidido em janeiro, gerando dois meses seguidos. Janeiro
  // tem 31 dias, então fevereiro precisa sair na paridade oposta.
  const plantonista = mkColab(1, { regime: '12x36', ciclo: 'IMPAR', turno: 'N', saida: '07:00' });
  const herdado = { ciclo: 'IMPAR' as const, herdadoDe: '2026-01-01' };

  const diasDe = (ano: number, mes: number) => gerarEscala({
    ...base, ano, mes,
    colaboradores: [plantonista],
    planos: [mkPlano(1, { ...herdado, competencia: iso(ano, mes, 1) })],
  }).alocacoes
    .filter(a => a.modalidade === 'UNIDADE')
    .map(a => Number(a.data.slice(8)));

  const jan = diasDe(2026, 0);
  const fev = diasDe(2026, 1);

  ok(jan.length > 0 && jan.every(d => d % 2 === 1),
    'janeiro sai nos ímpares, como o plano diz', JSON.stringify(jan.slice(0, 4)));
  ok(fev.length > 0 && fev.every(d => d % 2 === 0),
    'fevereiro sai nos PARES, virado pelo mês de 31 dias', JSON.stringify(fev.slice(0, 4)));

  // A razão de tudo isto: 31/jan e 1º/fev não podem ser dois plantões seguidos.
  ok(!(jan.includes(31) && fev.includes(1)),
    'a virada do mês não emenda dois plantões');
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


// ── Cota por equipe: PISO de pessoas de uma equipe numa unidade
{
  // Duas unidades, e o plano de todo mundo aponta 100% para a Paulista (2).
  // O piso de 2 no Morumbi (1) tem de puxar gente para lá mesmo assim — é a
  // diferença entre um mínimo e uma preferência.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [{ unidadeId: 1, equipeId: 1, dow: null, minimo: 2 }],
      colaboradores: [1, 2, 3, 4].map(id => mkColab(id, { equipeId: 1 })),
      planos: [1, 2, 3, 4].map(id => mkPlano(id, { distribuicao: { 1: 0, 2: 100 } })),
    });
    const noMor = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1);
    ok(noMor.length === 2, 'piso de 2 puxa gente contra a distribuição', String(noMor.length));
    const naPau = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 2);
    ok(naPau.length === 2, 'o resto segue o plano', String(naPau.length));
  }

  // Piso não é teto: com todo mundo planejado para o Morumbi, um mínimo de 2
  // não impede os 4 de ficarem lá.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [{ unidadeId: 1, equipeId: 1, dow: null, minimo: 2 }],
      colaboradores: [1, 2, 3, 4].map(id => mkColab(id, { equipeId: 1 })),
      planos: [1, 2, 3, 4].map(id => mkPlano(id, { distribuicao: { 1: 100, 2: 0 } })),
    });
    const noMor = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1);
    ok(noMor.length === 4, 'mínimo não limita quem quer ficar', String(noMor.length));
  }

  // Equipe sem cota cadastrada não é puxada para lugar nenhum.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [{ unidadeId: 1, equipeId: 1, dow: null, minimo: 2 }],
      colaboradores: [1, 2, 3].map(id => mkColab(id, { equipeId: 2 })),
      planos: [1, 2, 3].map(id => mkPlano(id, { distribuicao: { 1: 0, 2: 100 } })),
    });
    const noMor = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1);
    ok(noMor.length === 0, 'equipe sem piso não é deslocada', String(noMor.length));
  }

  // Piso por dia da semana tem precedência sobre o geral.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [
        { unidadeId: 1, equipeId: 1, dow: null, minimo: 1 },
        { unidadeId: 1, equipeId: 1, dow: 1, minimo: 3 }, // segunda
      ],
      colaboradores: [1, 2, 3].map(id => mkColab(id, { equipeId: 1 })),
      planos: [1, 2, 3].map(id => mkPlano(id, { distribuicao: { 1: 0, 2: 100 } })),
    });
    const seg = r.alocacoes.filter(a => a.data === '2026-08-03' && a.unidadeId === 1); // segunda
    const ter = r.alocacoes.filter(a => a.data === '2026-08-04' && a.unidadeId === 1); // terça
    ok(seg.length === 3, 'piso da segunda (3) vence o geral (1)', String(seg.length));
    ok(ter.length === 1, 'terça usa o piso geral (1)', String(ter.length));
  }

  // Não há gente suficiente: alerta, e a escala do dia continua válida.
  {
    const r = gerarEscala({
      ...base,
      cotasEquipe: [{ unidadeId: 1, equipeId: 1, dow: null, minimo: 3 }],
      colaboradores: [mkColab(1, { equipeId: 1 })],
      planos: [mkPlano(1, { distribuicao: { 1: 100, 2: 0 } })],
    });
    const faltou = r.alertas.filter(a => a.data === '2026-08-03' && a.msg.includes('exigida'));
    ok(faltou.length === 1, 'piso não atingido vira alerta', String(faltou.length));
    ok(faltou[0]?.msg.includes('1 de 3'), 'o alerta diz quanto faltou', faltou[0]?.msg ?? '');
    ok(r.conflitos.length === 0, 'e não vira conflito', r.conflitos.map(c => c.msg).join(' | '));
  }
}


// ── Postos: N dias úteis contíguos numa semana, dentro da unidade
{
  const postos = [{ id: 7, unidadeId: 1, nome: 'Corpo Clínico', vagas: 1, ativo: true, equipeId: null }];
  const baseP = { ...base, postos };

  // 5 dias = uma semana inteira de segunda a sexta, sempre no Morumbi.
  {
    const r = gerarEscala({
      ...baseP,
      colaboradores: [mkColab(1)],
      planos: [mkPlano(1, {
        distribuicao: { 1: 0, 2: 100 },
        postos: [{ postoId: 7, dias: 5, semana: 2 }],
      })],
    });
    const noPosto = r.alocacoes.filter(a => a.postoId === 7).map(a => a.data).sort();
    ok(noPosto.length === 5, '5 dias de posto viram 5 alocações', String(noPosto.length));
    const dows = noPosto.map(d => new Date(`${d}T12:00:00Z`).getUTCDay());
    ok(dows.join(',') === '1,2,3,4,5', 'de segunda a sexta, contíguos', dows.join(','));
    const forasDoMorumbi = r.alocacoes.filter(a => a.postoId === 7 && a.unidadeId !== 1);
    ok(forasDoMorumbi.length === 0, 'posto sempre na unidade dele', String(forasDoMorumbi.length));
  }

  // 3 dias = segunda, terça e quarta.
  {
    const r = gerarEscala({
      ...baseP,
      colaboradores: [mkColab(1)],
      planos: [mkPlano(1, { postos: [{ postoId: 7, dias: 3, semana: 2 }] })],
    });
    const dows = r.alocacoes.filter(a => a.postoId === 7)
      .map(a => new Date(`${a.data}T12:00:00Z`).getUTCDay()).sort();
    ok(dows.join(',') === '1,2,3', '3 dias começam na segunda', dows.join(','));
  }

  // Vaga única: duas pessoas na mesma semana não cabem, a segunda vai para outra.
  {
    const r = gerarEscala({
      ...baseP,
      colaboradores: [mkColab(1), mkColab(2)],
      planos: [
        mkPlano(1, { postos: [{ postoId: 7, dias: 5, semana: null }] }),
        mkPlano(2, { postos: [{ postoId: 7, dias: 5, semana: null }] }),
      ],
    });
    const semanas = new Set(r.alocacoes.filter(a => a.postoId === 7)
      .map(a => `${a.colaboradorId}|${a.data.slice(0, 7)}`));
    const porPessoa = [1, 2].map(id => r.alocacoes.filter(a => a.postoId === 7 && a.colaboradorId === id));
    ok(porPessoa[0].length === 5 && porPessoa[1].length === 5, 'as duas pessoas cobrem o posto', `${porPessoa[0].length}/${porPessoa[1].length}`);
    const sobrepoe = porPessoa[0].some(a => porPessoa[1].some(b => b.data === a.data));
    ok(!sobrepoe, 'posto de 1 vaga não recebe duas ao mesmo tempo', String(sobrepoe));
    ok(semanas.size === 2, 'motor rodiziou entre semanas diferentes', String(semanas.size));
  }

  // Semana fixada e sem vaga vira conflito em vez de sumir em silêncio.
  {
    const r = gerarEscala({
      ...baseP,
      colaboradores: [mkColab(1), mkColab(2)],
      planos: [
        mkPlano(1, { postos: [{ postoId: 7, dias: 5, semana: 2 }] }),
        mkPlano(2, { postos: [{ postoId: 7, dias: 5, semana: 2 }] }),
      ],
    });
    const conflito = r.conflitos.filter(c => c.msg.includes('Corpo Clínico'));
    ok(conflito.length === 1, 'semana lotada no posto vira conflito', String(conflito.length));
  }

  // ── O posto reservado a uma equipe (0021)
  const postoDaEquipe1 = [{ id: 7, unidadeId: 1, nome: 'Corpo Clínico', vagas: 1, ativo: true, equipeId: 1 }];

  {
    const r = gerarEscala({
      ...base,
      postos: postoDaEquipe1,
      colaboradores: [mkColab(1, { equipeId: 1 })],
      planos: [mkPlano(1, { postos: [{ postoId: 7, dias: 5, semana: 2 }] })],
    });
    const noPosto = r.alocacoes.filter(a => a.postoId === 7);
    ok(noPosto.length === 5, 'quem é da equipe do posto entra normalmente', String(noPosto.length));
    ok(r.conflitos.length === 0, 'e não gera conflito', String(r.conflitos.length));
  }

  {
    // Pessoa da equipe 2 atribuída a um posto da equipe 1. O plano é que está
    // errado, e o motor precisa DIZER isso: alocar mesmo assim poria alguém de
    // fora cobrindo o posto sem ninguém notar, que é o estado difícil de achar
    // depois. Recusar calado seria igualmente ruim — o dia sumiria da escala.
    const r = gerarEscala({
      ...base,
      postos: postoDaEquipe1,
      colaboradores: [mkColab(1, { equipeId: 2 })],
      planos: [mkPlano(1, { postos: [{ postoId: 7, dias: 5, semana: 2 }] })],
    });
    const conflito = r.conflitos.filter(c => c.msg.includes('Corpo Clínico'));
    ok(conflito.length === 1, 'posto de outra equipe vira conflito', String(conflito.length));
    const noPosto = r.alocacoes.filter(a => a.postoId === 7);
    ok(noPosto.length === 0, 'e ninguém de fora da equipe ocupa o posto', String(noPosto.length));
  }

  {
    // `equipeId` nulo é como os postos existiam antes da coluna. Se isso
    // deixasse de valer, todo posto já cadastrado viraria inválido de uma vez.
    const r = gerarEscala({
      ...baseP,
      colaboradores: [mkColab(1, { equipeId: 2 })],
      planos: [mkPlano(1, { postos: [{ postoId: 7, dias: 5, semana: 2 }] })],
    });
    const noPosto = r.alocacoes.filter(a => a.postoId === 7);
    ok(noPosto.length === 5, 'posto sem equipe aceita qualquer uma', String(noPosto.length));
  }
}

// ── Home office: preferência manda, espalhamento desempata dentro dela
{
  const semana = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']; // seg..sex
  const contaPorDia = (r: ReturnType<typeof gerarEscala>) =>
    semana.map(d => r.alocacoes.filter(a => a.data === d && a.modalidade === 'HOME').length);

  const seisComPreferencia = (diasPreferencia: number[]) => {
    const colaboradores = [1, 2, 3, 4, 5, 6].map(id => mkColab(id, { cargo: 'Analista Pl' }));
    return {
      colaboradores,
      planos: colaboradores.map(c => mkPlano(c.id, {
        distribuicao: { 1: 100, 2: 0 },
        homeOffice: { modo: 'COTA' as const, diasSemana: [], quantidade: 1, diasPreferencia, diasProibidos: [] },
      })),
    };
  };

  // Todos preferem sexta: todos vão na sexta. A preferência é a regra primária e
  // NÃO é sacrificada para espalhar.
  {
    const r = gerarEscala({ ...base, ...seisComPreferencia([5]) });
    const porDia = contaPorDia(r);
    ok(porDia[4] === 6, 'preferência única é respeitada mesmo concentrando', `distribuição: ${porDia.join('/')}`);
  }

  // Sem preferência marcada: aí sim o espalhamento decide sozinho.
  {
    const r = gerarEscala({ ...base, ...seisComPreferencia([]) });
    const porDia = contaPorDia(r);
    ok(Math.max(...porDia) <= 2, 'sem preferência, o motor espalha', `distribuição: ${porDia.join('/')}`);
    ok(porDia.reduce((a, b) => a + b, 0) === 6, 'a cota de cada um foi atendida', String(porDia.reduce((a, b) => a + b, 0)));
  }

  // Preferindo quinta e sexta: espalha entre os dois dias preferidos, e só eles.
  {
    const r = gerarEscala({ ...base, ...seisComPreferencia([4, 5]) });
    const porDia = contaPorDia(r);
    ok(porDia[0] + porDia[1] + porDia[2] === 0, 'nada fora dos dias preferidos', `distribuição: ${porDia.join('/')}`);
    ok(porDia[3] === 3 && porDia[4] === 3, 'espalha entre os preferidos', `distribuição: ${porDia.join('/')}`);
  }

  // Dia proibido continua sendo barreira absoluta.
  {
    const colaboradores = [1, 2].map(id => mkColab(id));
    const r = gerarEscala({
      ...base,
      colaboradores,
      planos: colaboradores.map(c => mkPlano(c.id, {
        distribuicao: { 1: 100, 2: 0 },
        homeOffice: { modo: 'COTA' as const, diasSemana: [], quantidade: 1, diasPreferencia: [1], diasProibidos: [1] },
      })),
    });
    const naSegunda = r.alocacoes.filter(a => a.data === '2026-08-10' && a.modalidade === 'HOME');
    ok(naSegunda.length === 0, 'dia proibido vence a preferência', String(naSegunda.length));
  }
}

// ── Prioridade: analista no home office, técnico na posição presencial
{
  // Uma vaga de home por semana na prática: 2 pessoas, 1 unidade com 1 lugar.
  const apertada: Unidade[] = [{ ...unidades[0], capacidadeTotal: 1 }, unidades[1]];
  const r = gerarEscala({
    ...base,
    unidades: apertada,
    colaboradores: [
      mkColab(1, { cargo: 'Técnico II', equipeId: 1 }),
      mkColab(2, { cargo: 'Analista Sr', equipeId: 2 }),
    ],
    planos: [
      mkPlano(1, { distribuicao: { 1: 100, 2: 0 } }),
      mkPlano(2, { distribuicao: { 1: 100, 2: 0 } }),
    ],
  });
  const seg = '2026-08-03';
  const tecnico = r.alocacoes.find(a => a.data === seg && a.colaboradorId === 1);
  const analista = r.alocacoes.find(a => a.data === seg && a.colaboradorId === 2);
  ok(tecnico?.unidadeId === 1, 'técnico fica com a posição presencial disputada', String(tecnico?.unidadeId));
  ok(analista?.unidadeId !== 1, 'analista cede a posição ao técnico', String(analista?.unidadeId));
}

// ── Regressão: posto exige que a pessoa trabalhe TODOS os dias do bloco
// Achado pelo fuzzing (semente 3): um 12x36 recebia bloco de segunda a quinta e
// só aparecia terça e quinta. Nos outros dois o posto constava ocupado sem
// ninguém lá, e bloqueava quem poderia cobrir.
{
  const postos = [{ id: 7, unidadeId: 1, nome: 'Corpo Clínico', vagas: 1, ativo: true, equipeId: null }];

  // 12x36 não cobre dias seguidos: vira conflito, não meia-cobertura.
  {
    const r = gerarEscala({
      ...base,
      postos,
      colaboradores: [mkColab(1, { regime: '12x36', ciclo: 'IMPAR' })],
      planos: [mkPlano(1, { ciclo: 'IMPAR', postos: [{ postoId: 7, dias: 4, semana: null }] })],
    });
    const noPosto = r.alocacoes.filter(a => a.postoId === 7);
    ok(noPosto.length === 0, '12x36 não recebe bloco de posto pela metade', String(noPosto.length));
    const conflito = r.conflitos.filter(c => c.msg.includes('12x36') && c.msg.includes('Corpo Clínico'));
    ok(conflito.length === 1, 'e o motivo é reportado como conflito', conflito[0]?.msg ?? 'nenhum');
  }

  // 5x2 na mesma configuração cobre normalmente.
  {
    const r = gerarEscala({
      ...base,
      postos,
      colaboradores: [mkColab(1)],
      planos: [mkPlano(1, { postos: [{ postoId: 7, dias: 4, semana: null }] })],
    });
    ok(r.alocacoes.filter(a => a.postoId === 7).length === 4, '5x2 cobre os 4 dias', String(r.alocacoes.filter(a => a.postoId === 7).length));
  }

  // Férias no meio da semana empurram o bloco para outra semana.
  {
    const r = gerarEscala({
      ...base,
      postos,
      colaboradores: [mkColab(1)],
      planos: [mkPlano(1, { postos: [{ postoId: 7, dias: 5, semana: null }] })],
      ausencias: [{ id: 1, colaboradorId: 1, tipo: 'FERIAS' as const, inicio: '2026-08-05', dias: 2, grupo: '', motivo: '' }],
    });
    const dias = r.alocacoes.filter(a => a.postoId === 7).map(a => a.data).sort();
    ok(dias.length === 5, 'bloco de 5 dias ainda é entregue', String(dias.length));
    ok(!dias.includes('2026-08-05') && !dias.includes('2026-08-06'), 'e evita os dias de férias', dias.join(','));
  }
}

// ── Equipe fora da escala: não é alocada e não ocupa posição
{
  const equipesComUmaFora = [
    { id: 1, nome: 'Técnicos 12x36', naEscala: true },
    { id: 2, nome: 'Só solicitações', naEscala: false },
  ];
  // Cinco pessoas para uma unidade de quatro posições: se a equipe 2 contasse,
  // alguém sobraria e viraria conflito de capacidade.
  const colaboradores = [
    mkColab(1, { equipeId: 1 }),
    mkColab(2, { equipeId: 1 }),
    mkColab(3, { equipeId: 2 }),
    mkColab(4, { equipeId: 2 }),
    mkColab(5, { equipeId: 2 }),
  ];
  const planos = colaboradores.map(c => mkPlano(c.id, { homeOffice: { modo: null, diasSemana: [], quantidade: 0, diasPreferencia: [], diasProibidos: [] } }));
  const r = gerarEscala({ ...base, equipes: equipesComUmaFora, colaboradores, planos });

  const alocados = new Set(r.alocacoes.map(a => a.colaboradorId));
  ok([...alocados].every(id => id <= 2), 'só a equipe da escala é alocada', [...alocados].join(','));
  ok(alocados.size === 2, 'as duas pessoas da equipe escalada entram', String(alocados.size));

  // A segunda-feira é dia útil: só os dois da equipe 1 podem ocupar o Morumbi.
  const seg = r.ocupacao['2026-08-03']?.[1] ?? 0;
  ok(seg === 2, 'quem está fora da escala não ocupa posição', String(seg));
  ok(r.conflitos.length === 0, 'e não gera conflito de capacidade', r.conflitos.map(c => c.msg).join(' | '));

  // A aderência é dos escalados; quem não entra não aparece como desviado.
  ok(r.aderencia.every(a => a.colaboradorId <= 2), 'aderência ignora equipe fora da escala');
}

console.log(falhas === 0 ? '\nTODOS OS TESTES PASSARAM' : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
