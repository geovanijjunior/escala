/**
 * Massa de exemplo para as fotos do manual.
 *
 * O objetivo é que cada tela conte a mesma história: uma equipe de suporte de TI
 * hospitalar em duas unidades, com o Corpo Clínico dentro do Morumbi, férias em
 * curso, solicitações em estágios diferentes e a escala de novembro publicada.
 * Números redondos demais deixam a tela irreal; poucos demais deixam a grade
 * vazia. Catorze pessoas cabem numa captura e ainda enchem o mês.
 */
import pg from 'pg';
import { deflateSync } from 'node:zlib';
import { gerarEscala } from '../../src/lib/domain/escalas/motor';

import type { Colaborador, PlanoMensal, Unidade } from '../../src/lib/domain/escalas/tipos';

pg.types.setTypeParser(1082, (v: string) => v);
// Respeita PGDATABASE: a massa é semeada em mais de um banco — um por nível de
// migration — para conferir que o app roda em todos eles.
const db = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'manual',
});

const CONTA = '11111111-1111-1111-1111-111111111111';
// A segunda área existe para a varredura ter o que NÃO ver: com uma só, todo
// teste de isolamento passa por falta de dado alheio, não por causa da RLS.
const AREA2 = '22222222-2222-2222-2222-222222222222';
const ANA    = '00000000-0000-0000-0000-000000000001'; // planejamento
const RICARDO = '00000000-0000-0000-0000-000000000002'; // gestor
const FELIPE  = '00000000-0000-0000-0000-000000000003'; // colaborador
const CARLA   = '00000000-0000-0000-0000-000000000004'; // colaborador (parceira de troca)
const MARCOS  = '00000000-0000-0000-0000-000000000005'; // administrador da área
const HELENA  = '00000000-0000-0000-0000-000000000009'; // administradora geral (sem área)

const COMP = '2026-11-01';
const ANO = 2026, MES = 10; // novembro

/**
 * PNG em tons de cinza com um degradê, montado à mão.
 *
 * Escrever o formato aqui evita uma dependência só para semear um anexo, e o
 * arquivo sai com alguns KB — tamanho de anexo real, que é o que a foto do
 * manual precisa mostrar.
 */
function pngCinza(largura: number, altura: number): Buffer {
  const tabela = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const byte of b) c = tabela[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const pedaco = (tipo: string, dados: Buffer) => {
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const soma = Buffer.alloc(4); soma.writeUInt32BE(crc(corpo));
    return Buffer.concat([tam, corpo, soma]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;   // bits por amostra
  ihdr[9] = 0;   // tons de cinza

  // Uma linha de filtro 0 seguida dos pixels, por linha.
  const cru = Buffer.alloc(altura * (largura + 1));
  for (let y = 0; y < altura; y++) {
    const base = y * (largura + 1);
    for (let x = 0; x < largura; x++) {
      cru[base + 1 + x] = 200 - Math.round(((x / largura) + (y / altura)) * 60);
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(cru)),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  await db.query('truncate contas cascade');
  await db.query('delete from auth.users');

  await db.query(`insert into contas (id, nome) values
    ($1, 'Hospital São Lucas — Suporte TI'),
    ($2, 'Clínica Alvorada — Enfermagem')`, [CONTA, AREA2]);

  // O gatilho on_auth_user_created cria o perfil a partir do metadata — é o mesmo
  // caminho do convite real, então basta inserir o usuário com conta_id e papel.
  // `conta_id` nulo é o Administrador Geral: o trigger o cria sem área nenhuma.
  const usuario = (id: string, nome: string, email: string, papel: string, conta: string | null = CONTA) =>
    db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3::jsonb)`,
      [id, email, JSON.stringify({ conta_id: conta, nome, papel })]);

  await usuario(HELENA, 'Helena Prado', 'helena.prado@jornada.app', 'admin_geral', null);
  await usuario(MARCOS, 'Marcos Vieira', 'marcos.vieira@saolucas.com', 'admin_local');
  await usuario(ANA, 'Ana Ribeiro', 'ana.ribeiro@saolucas.com', 'planejamento');
  await usuario(RICARDO, 'Ricardo Matos', 'ricardo.matos@saolucas.com', 'gestor');
  await usuario(FELIPE, 'Felipe Souza', 'felipe.souza@saolucas.com', 'colaborador');
  await usuario(CARLA, 'Carla Nunes', 'carla.nunes@saolucas.com', 'colaborador');

  // A segunda área nasce com administradora e nada mais: é assim que uma área
  // recém-criada aparece no console do Geral, e é o estado que o indicador
  // "mês não publicado" precisa ter para não ficar sempre zerado.
  await usuario('00000000-0000-0000-0000-00000000000a', 'Beatriz Lima',
    'beatriz.lima@alvorada.com', 'admin_local', AREA2);

  await db.query(`insert into config (conta_id, ciclo_ancora, tolerancia_aderencia, cobertura_minima)
    values ($1, '2026-01-01', 3, 1)`, [CONTA]);

  await db.query(`insert into unidades (id, conta_id, codigo, nome, sigla, cor, bg, capacidade_total, capacidade_reservadas, ordem)
    overriding system value values
    (1,$1,'MOR','Morumbi','MOR','#1A4E93','#DCEAF8',16,2,1),
    (2,$1,'PAU','Paulista','PAU','#0A6169','#D7F0F1',12,1,2)`, [CONTA]);

  await db.query(`insert into postos (id, conta_id, unidade_id, nome, vagas)
    overriding system value values (1,$1,1,'Corpo Clínico',1)`, [CONTA]);

  await db.query(`insert into equipes (id, conta_id, codigo, nome, regime, turno, gestor_id)
    overriding system value values
    (1,$1,'TEC','Técnicos de Campo','5x2','D',$2),
    (2,$1,'ANA','Analistas de Sistemas','5x2','D',$2),
    (3,$1,'PLA','Plantão 12x36','12x36','D',$2)`, [CONTA, RICARDO]);

  // Reservas maiores na segunda e na sexta: dia de reunião no Morumbi.
  await db.query(`insert into capacidades (conta_id, unidade_id, dow, total, reservadas) values
    ($1,1,1,16,4), ($1,1,5,16,4)`, [CONTA]);

  // Piso, não teto: o mínimo de cada equipe por unidade.
  await db.query(`insert into cotas_equipe (conta_id, unidade_id, equipe_id, dow, minimo) values
    ($1,1,1,null,2), ($1,1,2,null,1), ($1,2,1,null,1)`, [CONTA]);

  // `on conflict do nothing` porque a conta já nasce com os feriados nacionais
  // do ano corrente (trigger da 0022), e estes três estão entre eles.
  await db.query(`insert into feriados (conta_id, data, nome) values
    ($1,'2026-11-02','Finados'), ($1,'2026-11-15','Proclamação da República'),
    ($1,'2026-11-20','Consciência Negra')
    on conflict (conta_id, data) do nothing`, [CONTA]);

  /**
   * O elenco. Está escrito por extenso, e não gerado por `i % n`, porque cada
   * pessoa aqui existe para ilustrar uma regra do sistema — e uma massa
   * gerada por módulo produz combinações impossíveis (home office fixo na
   * quarta em quem também tem unidade fixa na quarta, por exemplo).
   *
   * `morumbi` é o percentual do rateio; o resto vai para a Paulista.
   * O plantão 12x36 tem quatro pessoas: dois ciclos × duas unidades, que é o
   * mínimo para as duas casas abrirem todo dia, inclusive fim de semana.
   */
  type Home = { modo: 'FIXO' | 'COTA'; dias?: number[]; quantidade?: number; preferencia?: number[] };
  type Pessoa = {
    nome: string; cargo: string; equipe: number; regime: '5x2' | '12x36';
    morumbi: number; perfil?: string; ciclo?: 'IMPAR' | 'PAR'; home?: Home;
  };

  const pessoas: Pessoa[] = [
    // Felipe é o técnico do Corpo Clínico: presencial o mês inteiro, sem home.
    { nome: 'Felipe Souza',    cargo: 'Técnico II',   equipe: 1, regime: '5x2', morumbi: 100, perfil: FELIPE },
    { nome: 'Carla Nunes',     cargo: 'Analista Sr',  equipe: 2, regime: '5x2', morumbi: 50,  perfil: CARLA,
      home: { modo: 'COTA', quantidade: 2, preferencia: [4, 5] } },
    { nome: 'Bruno Alencar',   cargo: 'Técnico I',    equipe: 1, regime: '5x2', morumbi: 75,
      home: { modo: 'COTA', quantidade: 1, preferencia: [3] } },
    { nome: 'Daniela Prado',   cargo: 'Analista Pl',  equipe: 2, regime: '5x2', morumbi: 50,
      home: { modo: 'COTA', quantidade: 2, preferencia: [2, 4] } },
    { nome: 'Eduardo Lima',    cargo: 'Técnico III',  equipe: 1, regime: '5x2', morumbi: 100 },
    { nome: 'Fernanda Castro', cargo: 'Analista Jr',  equipe: 2, regime: '5x2', morumbi: 25,
      home: { modo: 'COTA', quantidade: 2, preferencia: [3, 5] } },
    { nome: 'Gustavo Reis',    cargo: 'Técnico II',   equipe: 1, regime: '5x2', morumbi: 75,
      home: { modo: 'FIXO', dias: [3] } },
    { nome: 'Helena Vasques',  cargo: 'Especialista', equipe: 2, regime: '5x2', morumbi: 25,
      home: { modo: 'COTA', quantidade: 3, preferencia: [1, 3, 5] } },
    { nome: 'Igor Bertoldo',   cargo: 'Técnico I',    equipe: 1, regime: '5x2', morumbi: 50,
      home: { modo: 'COTA', quantidade: 1, preferencia: [5] } },
    { nome: 'Juliana Moraes',  cargo: 'Analista Pl',  equipe: 2, regime: '5x2', morumbi: 50,
      home: { modo: 'COTA', quantidade: 2, preferencia: [2, 4] } },
    { nome: 'Kleber Antunes',  cargo: 'Técnico II',   equipe: 3, regime: '12x36', morumbi: 100, ciclo: 'IMPAR' },
    { nome: 'Lívia Ferraz',    cargo: 'Técnico I',    equipe: 3, regime: '12x36', morumbi: 100, ciclo: 'PAR' },
    { nome: 'Marcos Tavares',  cargo: 'Técnico III',  equipe: 3, regime: '12x36', morumbi: 0,   ciclo: 'IMPAR' },
    { nome: 'Otávio Bandeira', cargo: 'Técnico I',    equipe: 3, regime: '12x36', morumbi: 0,   ciclo: 'PAR' },
    { nome: 'Natália Duarte',  cargo: 'Analista Jr',  equipe: 2, regime: '5x2', morumbi: 25,
      home: { modo: 'COTA', quantidade: 2, preferencia: [1, 5] } },
  ];

  const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  for (const [i, p] of pessoas.entries()) {
    await db.query(
      `insert into colaboradores
        (id, conta_id, perfil_id, nome, matricula, email, cargo, equipe_id, gestor_id,
         regime, turno, ciclo, entrada, saida, unidade_base_id, eleg_home, status, admissao)
       overriding system value
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'D',$11,'08:00','17:00',$12,$13,'ativo','2024-03-01')`,
      [i + 1, CONTA, p.perfil ?? null, p.nome, String(1000 + i),
       semAcento(p.nome.toLowerCase().replace(/ /g, '.')) + '@saolucas.com',
       p.cargo, p.equipe, RICARDO, p.regime, p.ciclo ?? null,
       p.morumbi >= 50 ? 1 : 2, !!p.home]);
  }
  // As tabelas acima receberam ids explícitos (`overriding system value`), o que
  // NÃO adianta a sequência: o primeiro insert feito pela tela tentaria o id 1 e
  // colidiria com a chave primária. Empurrar as sequências para longe dos ids
  // semeados é o que deixa a base de demonstração utilizável de verdade.
  for (const t of ['unidades', 'postos', 'equipes', 'colaboradores']) {
    await db.query(`select setval(pg_get_serial_sequence('${t}','id'), 100, false)`);
  }

  // Férias em curso e uma ausência curta — a grade fica realista.
  await db.query(`insert into ausencias (conta_id, colaborador_id, tipo, inicio, dias, grupo, motivo, criado_por) values
    ($1, 4, 'FERIAS', '2026-11-09', 12, '', '', $2),
    ($1, 9, 'AUSENCIA', '2026-11-17', 2, 'Atestado', 'Consulta', $2)`, [CONTA, ANA]);

  // Planos: distribuição, unidade fixa, home office e o posto do Felipe.
  for (const [i, p] of pessoas.entries()) {
    const id = i + 1;
    const { rows } = await db.query(
      `insert into planos (conta_id, colaborador_id, competencia, ciclo, ho_modo, ho_dias_semana,
                           ho_quantidade, ho_dias_preferencia, ho_dias_proibidos, atualizado_por)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [CONTA, id, COMP, p.ciclo ?? null, p.home?.modo ?? null,
       p.home?.dias ?? [], p.home?.quantidade ?? 0, p.home?.preferencia ?? [], [], ANA]);
    const plano = rows[0].id;

    await db.query(`insert into plano_distribuicao (plano_id, unidade_id, percentual) values ($1,1,$2),($1,2,$3)`,
      [plano, p.morumbi, 100 - p.morumbi]);

    if (id === 1) {
      await db.query(`insert into plano_posto (conta_id, plano_id, posto_id, dias, semana) values ($1,$2,1,5,2)`, [CONTA, plano]);
    }
    if (id === 2) {
      await db.query(`insert into plano_unidade_fixa (plano_id, dow, unidade_id) values ($1,1,2),($1,5,2)`, [plano]);
    }
  }

  // ── Gera a escala com o motor de verdade e publica ──────────────
  const q = async (s: string) => (await db.query(s)).rows;
  const unidades: Unidade[] = (await q('select * from unidades order by ordem')).map(u => ({
    id: u.id, codigo: u.codigo, nome: u.nome, sigla: u.sigla, cor: u.cor, bg: u.bg,
    capacidadeTotal: u.capacidade_total, capacidadeReservadas: u.capacidade_reservadas,
    ordem: u.ordem, ativa: u.ativa,
  }));
  const colaboradores: Colaborador[] = (await q('select * from colaboradores order by id')).map(c => ({
    id: c.id, perfilId: c.perfil_id, nome: c.nome, matricula: c.matricula, email: c.email,
    cargo: c.cargo, equipeId: c.equipe_id, gestorId: c.gestor_id, regime: c.regime, turno: c.turno,
    ciclo: c.ciclo, entrada: c.entrada, saida: c.saida, unidadeBaseId: c.unidade_base_id,
    elegHome: c.eleg_home, elegExterno: c.eleg_externo, sextaReduzida: c.sexta_reduzida,
    status: c.status, admissao: c.admissao, desligamento: c.desligamento,
  }));
  const planos: PlanoMensal[] = await Promise.all((await q(`select * from planos where competencia = '${COMP}'`)).map(async p => ({
    id: p.id, colaboradorId: p.colaborador_id, competencia: p.competencia, ciclo: p.ciclo,
    homeOffice: {
      modo: p.ho_modo, diasSemana: p.ho_dias_semana ?? [], quantidade: p.ho_quantidade ?? 0,
      diasPreferencia: p.ho_dias_preferencia ?? [], diasProibidos: p.ho_dias_proibidos ?? [],
    },
    distribuicao: Object.fromEntries((await q(`select * from plano_distribuicao where plano_id=${p.id}`)).map(d => [d.unidade_id, d.percentual])),
    unidadesFixas: Object.fromEntries((await q(`select * from plano_unidade_fixa where plano_id=${p.id}`)).map(f => [f.dow, f.unidade_id])),
    postos: (await q(`select * from plano_posto where plano_id=${p.id}`)).map(x => ({ postoId: x.posto_id, dias: x.dias, semana: x.semana })),
  })));

  const resultado = gerarEscala({
    ano: ANO, mes: MES, unidades,
    equipes: (await q('select id, nome, na_escala from equipes')).map(e => ({ id: e.id, nome: e.nome, naEscala: e.na_escala ?? true })),
    postos: (await q('select * from postos')).map(p => ({ id: p.id, unidadeId: p.unidade_id, nome: p.nome, vagas: p.vagas, ativo: p.ativo, equipeId: p.equipe_id ?? null })),
    colaboradores, planos,
    ausencias: (await q('select * from ausencias')).map(a => ({
      id: a.id, colaboradorId: a.colaborador_id, tipo: a.tipo, inicio: a.inicio,
      dias: a.dias, grupo: a.grupo, motivo: a.motivo,
    })),
    capacidades: (await q('select * from capacidades')).map(c => ({
      unidadeId: c.unidade_id, dow: c.dow, data: c.data, total: c.total, reservadas: c.reservadas,
    })),
    cotasEquipe: (await q('select * from cotas_equipe')).map(c => ({
      unidadeId: c.unidade_id, equipeId: c.equipe_id, dow: c.dow, minimo: c.minimo,
    })),
    feriados: Object.fromEntries((await q('select * from feriados')).map(f => [f.data, f.nome])),
    pins: [], cicloAncora: '2026-01-01', toleranciaAderencia: 3, coberturaMinima: 1,
  });

  const ger = await db.query(
    `insert into geracoes (conta_id, competencia, versao, status, conflitos, alertas, aderencia, gerada_por, gerada_por_nome, gerada_em)
     values ($1,$2,1,'publicada',$3,$4,$5,$6,'Ana Ribeiro','2026-10-29 16:48-03') returning id`,
    [CONTA, COMP, JSON.stringify(resultado.conflitos), JSON.stringify(resultado.alertas),
     JSON.stringify(resultado.aderencia), ANA]);

  for (const a of resultado.alocacoes) {
    await db.query(
      `insert into alocacoes (conta_id, geracao_id, colaborador_id, data, modalidade, unidade_id, posto_id)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [CONTA, ger.rows[0].id, a.colaboradorId, a.data, a.modalidade, a.unidadeId, a.postoId]);
  }

  // ── O mês corrente, para a tela "Hoje" não nascer vazia ──────
  //
  // A massa mostra novembro de 2026 porque é o mês das capturas do manual. Só
  // que o app do colaborador abre em "Hoje", e "hoje" é a data real de quem
  // roda isto — normalmente um mês qualquer sem escala nenhuma. Uma
  // demonstração que abre num vazio não demonstra nada.
  //
  // Os planos do mês de referência valem para o mês corrente sem cópia: a
  // herança já faz isso. O que falta é a escala gerada.
  const agora = new Date();
  const [anoHoje, mesHoje] = [agora.getFullYear(), agora.getMonth()];
  const compHoje = `${anoHoje}-${String(mesHoje + 1).padStart(2, '0')}-01`;

  if (compHoje !== COMP) {
    const doMesCorrente = gerarEscala({
      ano: anoHoje,
      mes: mesHoje,
      unidades,
      equipes: (await q('select id, nome, na_escala from equipes')).map(e => ({ id: e.id, nome: e.nome, naEscala: e.na_escala ?? true })),
      postos: (await q('select * from postos')).map(p => ({ id: p.id, unidadeId: p.unidade_id, nome: p.nome, vagas: p.vagas, ativo: p.ativo, equipeId: p.equipe_id ?? null })),
      colaboradores,
      // Mesmos planos, competência trocada: é exatamente o que a herança
      // entrega ao motor quando o mês não tem plano próprio.
      planos: planos.map(pl => ({ ...pl, competencia: compHoje })),
      ausencias: [],
      capacidades: (await q('select * from capacidades')).map(c => ({
        unidadeId: c.unidade_id, dow: c.dow, data: c.data, total: c.total, reservadas: c.reservadas,
      })),
      cotasEquipe: (await q('select * from cotas_equipe')).map(c => ({
        unidadeId: c.unidade_id, equipeId: c.equipe_id, dow: c.dow, minimo: c.minimo,
      })),
      feriados: {},
      pins: [], cicloAncora: '2026-01-01', toleranciaAderencia: 3, coberturaMinima: 1,
    });

    const gerHoje = await db.query(
      `insert into geracoes (conta_id, competencia, versao, status, conflitos, alertas, aderencia, gerada_por, gerada_por_nome)
       values ($1,$2,1,'publicada',$3,$4,$5,$6,'Ana Ribeiro') returning id`,
      [CONTA, compHoje, JSON.stringify(doMesCorrente.conflitos), JSON.stringify(doMesCorrente.alertas),
       JSON.stringify(doMesCorrente.aderencia), ANA]);

    for (const a of doMesCorrente.alocacoes) {
      await db.query(
        `insert into alocacoes (conta_id, geracao_id, colaborador_id, data, modalidade, unidade_id, posto_id)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [CONTA, gerHoje.rows[0].id, a.colaboradorId, a.data, a.modalidade, a.unidadeId, a.postoId]);
    }
  }

  // ── Solicitações em estágios diferentes, para a tela ter o que mostrar ──
  const sol = async (colab: number, tipo: string, data: string, detalhe: string,
                     status: string, extra: Record<string, unknown> = {}) => {
    const cols = ['conta_id', 'colaborador_id', 'tipo', 'data', 'detalhe', 'status', ...Object.keys(extra)];
    const vals = [CONTA, colab, tipo, data, detalhe, status, ...Object.values(extra)];
    const { rows } = await db.query(
      `insert into solicitacoes (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, vals);
    return rows[0].id;
  };

  const s1 = await sol(1, 'FERIAS', '2026-12-07', 'Férias programadas de dezembro, já combinadas com a equipe.',
    'GESTOR', { data_fim: '2026-12-21', criado_em: '2026-10-26 08:42-03' });
  const s2 = await sol(2, 'TROCA_UNIDADE', '2026-11-24', 'Preciso estar na Paulista para o treinamento do novo PACS.',
    'TRIAGEM', { unidade_desejada_id: 2, criado_em: '2026-10-28 09:05-03' });
  const s3 = await sol(6, 'TROCA_HORARIO', '2026-11-26', 'Troca de plantão com a Carla por consulta médica.',
    'AGUARDA_PARCEIRO', { parceiro_id: 2, aceite_parceiro: 'PENDENTE', criado_em: '2026-10-28 17:31-03' });
  const s4 = await sol(10, 'FOLGA', '2026-11-13', 'Compensação de banco de horas do plantão de outubro.',
    'APROVADA', { aplicada: true, criado_em: '2026-10-22 11:20-03' });

  // Datas fixas, e não `now()`: as imagens do manual são congeladas, e um
  // carimbo relativo ao dia da captura contaria uma história incoerente com o
  // mês de novembro que aparece na grade. Aqui é o fim de outubro — quando o
  // Planejamento monta o mês seguinte.
  await db.query(`insert into solicitacao_eventos (conta_id, solicitacao_id, etapa, detalhe, por_id, por_nome, em) values
    ($1,$2,'Aberta','',$8,'Felipe Souza','2026-10-26 08:42-03'),
    ($1,$2,'Encaminhada ao gestor','Dentro da janela de férias combinada com a equipe.',$6,'Ana Ribeiro','2026-10-27 14:10-03'),
    ($1,$3,'Aberta','',$7,'Carla Nunes','2026-10-28 09:05-03'),
    ($1,$4,'Aberta','',$6,'Fernanda Castro','2026-10-28 17:31-03'),
    ($1,$5,'Aberta','',$6,'Juliana Moraes','2026-10-22 11:20-03'),
    ($1,$5,'Aprovada na triagem','13/11/2026 lançado como ausência e travado na escala.',$6,'Ana Ribeiro','2026-10-23 10:02-03')`,
    [CONTA, s1, s2, s3, s4, ANA, CARLA, FELIPE]);

  await db.query(`insert into ocorrencias (conta_id, colaborador_id, data, tipo, minutos, obs, registrado_por) values
    ($1, 3, '2026-11-05', 'ATRASO', 25, 'Trânsito na Marginal', $2),
    ($1, 7, '2026-11-11', 'FALTA_J', 0, 'Atestado entregue no RH', $2)`, [CONTA, RICARDO]);

  await db.query(`insert into logs (conta_id, usuario_id, usuario_nome, acao, detalhe, criado_em) values
    ($1,$2,'Ana Ribeiro','Escala publicada','Novembro de 2026 · versão 1','2026-10-29 16:48-03'),
    ($1,$2,'Ana Ribeiro','Plano mensal salvo','Felipe Souza · novembro de 2026','2026-10-29 15:12-03'),
    ($1,$2,'Ana Ribeiro','Cota por equipe ajustada','Técnicos de Campo em Morumbi · todos os dias · até 6','2026-10-28 11:03-03'),
    ($1,$3,'Ricardo Matos','Ocorrência registrada','Bruno Alencar · atraso de 25 min em 05/11/2026','2026-11-05 09:26-03')`,
    [CONTA, ANA, RICARDO]);

  // ── Mural ───────────────────────────────────────────────────
  // Um comunicado do Planejamento para todo mundo, um do gestor para a equipe
  // dele e um só para gestores — as três formas que o mural tem. Sem os três,
  // a foto do manual não mostraria a diferença entre elas.
  const { rows: [aviso] } = await db.query(
    `insert into comunicados (conta_id, titulo, corpo, publico, equipe_id, fixado, autor_id, autor_nome, criado_em)
     values
     ($1,'Manutenção do ar-condicionado no Morumbi',
        'A climatização do 3º andar fica desligada na quinta, 12/11, das 7h às 12h. Quem estiver escalado para o Corpo Clínico nesse período pode usar as salas do 2º andar.',
        'colaboradores', null, true, $2, 'Ana Ribeiro', '2026-11-09 08:15-03')
     returning id`, [CONTA, ANA]);

  await db.query(
    `insert into comunicados (conta_id, titulo, corpo, publico, equipe_id, fixado, autor_id, autor_nome, criado_em)
     values
     ($1,'Reunião mensal da equipe','Terça, 17/11, às 9h, na sala 3 do Morumbi. Quem estiver em home office participa pelo link de sempre.',
        'colaboradores', 1, false, $3, 'Ricardo Matos', '2026-11-10 17:40-03'),
     ($1,'Fechamento de novembro','Enviem os ajustes de escala até sexta, 27/11. Depois disso o mês é encerrado e as alterações passam a exigir justificativa.',
        'gestores', null, false, $2, 'Ana Ribeiro', '2026-11-10 09:00-03')`,
    [CONTA, ANA, RICARDO]);

  // Anexo de verdade, gerado aqui: um PNG de tamanho plausível. Um arquivo de
  // 70 bytes apareceria no mural como "planta.png (70 B)", que se lê como
  // anexo quebrado e ensinaria a coisa errada a quem olha a foto do manual.
  const png = pngCinza(900, 600);
  await db.query(
    `insert into comunicado_anexos (conta_id, comunicado_id, nome, tipo, tamanho, conteudo)
     values ($1,$2,'planta-3o-andar.png','image/png',$3,$4)`,
    [CONTA, aviso.id, png.length, png]);

  // ── Avisos do sino ──────────────────────────────────────────
  // O sino junta o andamento das solicitações com estes. Sem uma linha aqui, a
  // foto do sino mostraria só metade do que ele passou a fazer.
  await db.query(
    `insert into avisos (conta_id, perfil_id, titulo, detalhe, rota, por_id, por_nome, criado_em) values
     ($1,$2,'Escala alterada — 11/11/2026','Felipe Souza: agora está como Home Office',
        '/calendario?competencia=2026-11-01&dia=2026-11-11',$4,'Ana Ribeiro','2026-11-10 10:22-03'),
     ($1,$3,'Escala alterada — 11/11/2026','Felipe Souza: agora está como Home Office',
        '/calendario?competencia=2026-11-01&dia=2026-11-11',$4,'Ana Ribeiro','2026-11-10 10:22-03'),
     ($1,$3,'Novo comunicado no mural','Manutenção do ar-condicionado no Morumbi','/mural',$4,'Ana Ribeiro','2026-11-09 08:15-03')`,
    [CONTA, RICARDO, FELIPE, ANA]);

  console.log(`massa pronta: ${colaboradores.length} pessoas, ${resultado.alocacoes.length} alocações, ` +
              `${resultado.conflitos.length} conflitos, ${resultado.alertas.length} alertas`);
  await db.end();
}

main().catch(e => { console.error(e); process.exit(1); });
