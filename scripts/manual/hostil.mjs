/**
 * Manda dado hostil para cada formulário e confere que nada entrou.
 *
 * `acoes.mjs` prova que o caminho bom grava. Este prova o contrário — que o
 * caminho ruim NÃO grava — e o critério é invertido: uma faixa de erro na tela
 * é o resultado esperado, e a linha a mais no banco é a falha.
 *
 * O ataque não é hipotético. Server Action é endpoint: o Next publica uma rota
 * para cada uma, e o `<select>` que a tela desenhou com três opções aceita
 * qualquer valor que chegue no POST. Por isso metade das sondas abaixo mexe no
 * DOM antes de enviar — injeta um `<option>` com id de outra área, troca o
 * `type` de um campo, apaga o `max` de um número. É o que qualquer pessoa faz
 * com o inspetor aberto, e é exatamente o que a validação de servidor existe
 * para aguentar.
 *
 *   node scripts/manual/hostil.mjs
 *
 * Precisa do dev server contra o shim e do banco `manual` semeado.
 */
import { abrirNavegador } from './navegador.mjs';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const db = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'manual',
});

const BASE = process.env.BASE || 'http://localhost:3000';
const como = id => writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id, email: 'x@x' }));
const ANA = '00000000-0000-0000-0000-000000000001';     // planejamento, área 1
const FELIPE = '00000000-0000-0000-0000-000000000003';  // colaborador, área 1

const b = await abrirNavegador({ args: ['--lang=pt-BR'] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const p = await ctx.newPage();
let falhas = 0;

const conta = async sql => Number((await db.query(sql)).rows[0].c);
const ok = t => console.log(`  \x1b[32mok\x1b[0m     ${t}`);
const erro = t => { console.log(`  \x1b[31mFALHOU\x1b[0m ${t}`); falhas++; };

/**
 * Uma sonda: opera a tela e exige que o banco NÃO tenha mudado.
 *
 * A tela é evidência secundária. Uma ação pode recusar em silêncio, redirecionar
 * feliz ou mostrar faixa vermelha — o que não pode, em nenhum desses casos, é
 * ter escrito. Por isso a contagem no banco é o que decide, e a faixa entra só
 * no relato, para separar "recusou e avisou" de "recusou calado".
 */
async function sonda(nome, url, passos, sql, { exigeEnvio = true } = {}) {
  const antes = await conta(sql);
  let enviou = false;
  try {
    await p.goto(BASE + url, { waitUntil: 'networkidle' });
    await p.waitForTimeout(200);

    // Um `required` não preenchido faz o navegador barrar o envio antes de sair
    // da máquina — e a sonda passaria sem ter mandado nada, que é o pior
    // resultado que uma suíte pode dar: a aprovação de um teste que não
    // aconteceu. Foi o que houve com as duas primeiras sondas de capacidade,
    // paradas num campo `sigla` que elas não preenchiam.
    // `request` (na saída) e não `requestfinished` (na volta), com `on` e não
    // `once`. As duas escolhas custaram uma sonda intermitente cada: `once` se
    // descarta no primeiro request qualquer — normalmente um chunk de JS — e a
    // conclusão do POST às vezes só chega depois do redirect, quando o listener
    // já foi solto. O disparo na saída acontece antes de tudo isso.
    const viuPost = r => { if (r.method() === 'POST') enviou = true; };
    p.on('request', viuPost);
    try {
      await passos(p);
      await p.waitForLoadState('networkidle');
      await p.waitForTimeout(600);
    } finally {
      p.off('request', viuPost);
    }
  } catch (e) {
    // Não conseguir sequer operar a tela não é aprovação: pode ser a sonda
    // desatualizada em relação ao formulário, e aí ela não está testando nada.
    erro(`${nome.padEnd(46)} não consegui operar: ${String(e).split('\n')[0].slice(0, 70)}`);
    return;
  }

  const depois = await conta(sql);
  const faixa = await p.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')]
      .find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
    return el ? el.textContent.trim().slice(0, 60) : null;
  });

  if (depois !== antes) erro(`${nome.padEnd(46)} GRAVOU (${antes} → ${depois})`);
  else if (exigeEnvio && !enviou) erro(`${nome.padEnd(46)} o formulário nem chegou a ser enviado — a sonda não testou nada`);
  else ok(`${nome.padEnd(46)} ${faixa ? 'recusou: ' + faixa : 'recusou (sem faixa)'}`);
}

console.log('\n\x1b[1m── Números fora de faixa\x1b[0m\n');

como(ANA);

// O `min`/`max` do input é conforto de digitação, não validação: some com um
// clique no inspetor. Quem precisa recusar é o servidor.
await sonda(
  'capacidade negativa na unidade',
  '/parametros?aba=unidades&unidade=novo',
  async p => {
    const f = p.locator('form').filter({ has: p.locator('input[name="capacidadeTotal"]') }).first();
    await f.locator('input[name="nome"]').fill('Unidade Hostil');
    await f.locator('input[name="sigla"]').fill('HOS');
    await f.locator('input[name="capacidadeTotal"]').evaluate(el => { el.removeAttribute('min'); el.value = '-40'; });
    await f.locator('button[type="submit"]').first().click();
  },
  "select count(*) c from unidades where nome = 'Unidade Hostil'",
);

await sonda(
  'reservadas maior que a capacidade total',
  '/parametros?aba=unidades&unidade=novo',
  async p => {
    const f = p.locator('form').filter({ has: p.locator('input[name="capacidadeTotal"]') }).first();
    await f.locator('input[name="nome"]').fill('Unidade Invertida');
    await f.locator('input[name="sigla"]').fill('INV');
    await f.locator('input[name="capacidadeTotal"]').fill('5');
    await f.locator('input[name="capacidadeReservadas"]').evaluate(el => { el.removeAttribute('max'); el.value = '900'; });
    await f.locator('button[type="submit"]').first().click();
  },
  "select count(*) c from unidades where nome = 'Unidade Invertida'",
);

await sonda(
  'ano de feriado fora de 2000–2100',
  '/parametros?aba=feriados',
  async p => {
    const f = p.locator('form').filter({ has: p.locator('input[name="ano"]') }).first();
    await f.locator('input[name="ano"]').evaluate(el => { el.removeAttribute('min'); el.value = '1' ; });
    await f.getByRole('button', { name: /Trazer/ }).click();
  },
  'select count(*) c from feriados',
);

console.log('\n\x1b[1m── Horários impossíveis\x1b[0m\n');

await sonda(
  'colaborador com saída igual à entrada',
  '/colaboradores?novo=1',
  async p => {
    const f = p.locator('#editor-colaborador');
    await f.locator('input[name="nome"]').fill('Turno Nulo');
    await f.locator('input[name="matricula"]').fill('HOSTIL1');
    await f.locator('input[name="admissao"]').fill('2024-01-01');
    await f.locator('select[name="equipeId"]').selectOption({ index: 1 });
    await f.locator('select[name="unidadeBaseId"]').selectOption({ index: 1 });
    await f.locator('input[name="entrada"]').fill('08:00');
    await f.locator('input[name="saida"]').fill('08:00');
    await f.locator('button[type="submit"]').first().click();
  },
  "select count(*) c from colaboradores where matricula = 'HOSTIL1'",
);

await sonda(
  'horário que o navegador não valida (campo virou texto)',
  '/colaboradores?novo=1',
  async p => {
    const f = p.locator('#editor-colaborador');
    await f.locator('input[name="nome"]').fill('Turno Torto');
    await f.locator('input[name="matricula"]').fill('HOSTIL2');
    await f.locator('input[name="admissao"]').fill('2024-01-01');
    await f.locator('select[name="equipeId"]').selectOption({ index: 1 });
    await f.locator('select[name="unidadeBaseId"]').selectOption({ index: 1 });
    // `type=time` recusa "99:99" na digitação; trocar para texto é o caminho
    // de quem não passa pela digitação.
    await f.locator('input[name="saida"]').evaluate(el => { el.type = 'text'; el.value = '99:99'; });
    await f.locator('button[type="submit"]').first().click();
  },
  "select count(*) c from colaboradores where matricula = 'HOSTIL2'",
);

console.log('\n\x1b[1m── Vínculo com outra área\x1b[0m\n');

// O caso que a RLS existe para barrar: um id que EXISTE, mas é de outra área.
// Um id inventado seria recusado por não existir, o que não prova nada sobre
// isolamento — só sobre chave estrangeira.
//
// A segunda área do seed nasce vazia, então a massa do alvo é criada aqui, por
// SQL direto. Fora do app de propósito: pelo app não haveria como, e é isso que
// está sob teste.
const outraConta = (await db.query(`
  select id from contas where id <> (select conta_id from perfis where id = $1) limit 1`, [ANA])).rows[0]?.id;

let outraEquipe = null, outraUnidade = null;
if (outraConta) {
  outraEquipe = (await db.query(`
    insert into equipes (conta_id, codigo, nome, regime, turno)
    values ($1, 'ALVO', 'Equipe da outra área', '5x2', 'D') returning id`, [outraConta])).rows[0].id;
  outraUnidade = (await db.query(`
    insert into unidades (conta_id, codigo, nome, sigla)
    values ($1, 'ALVO', 'Unidade da outra área', 'ALV') returning id`, [outraConta])).rows[0].id;
}

if (!outraEquipe || !outraUnidade) {
  erro('massa insuficiente: o banco `manual` precisa de uma segunda área');
} else {
  await sonda(
    `colaborador apontando para equipe de outra área (${outraEquipe})`,
    '/colaboradores?novo=1',
    async p => {
      const f = p.locator('#editor-colaborador');
      await f.locator('input[name="nome"]').fill('Vinculo Cruzado');
      await f.locator('input[name="matricula"]').fill('HOSTIL3');
      await f.locator('input[name="admissao"]').fill('2024-01-01');
      await f.locator('select[name="unidadeBaseId"]').selectOption({ index: 1 });
      // O `<select>` só oferece as equipes da área. Injetar a opção é o que
      // um POST forjado faz sem passar por tela nenhuma.
      await f.locator('select[name="equipeId"]').evaluate((el, id) => {
        const o = document.createElement('option');
        o.value = String(id); o.textContent = 'forjada'; el.appendChild(o); el.value = String(id);
      }, outraEquipe);
      await f.locator('button[type="submit"]').first().click();
    },
    "select count(*) c from colaboradores where matricula = 'HOSTIL3'",
  );

  await sonda(
    `posto apontando para unidade de outra área (${outraUnidade})`,
    '/parametros?aba=unidades&form=posto',
    async p => {
      const f = p.locator('form').filter({ has: p.locator('input[name="vagas"]') }).first();
      await f.locator('input[name="nome"]').fill('Posto Cruzado');
      await f.locator('select[name="unidadeId"]').evaluate((el, id) => {
        const o = document.createElement('option');
        o.value = String(id); o.textContent = 'forjada'; el.appendChild(o); el.value = String(id);
      }, outraUnidade);
      await f.locator('button[type="submit"]').first().click();
    },
    "select count(*) c from postos where nome = 'Posto Cruzado'",
  );

  await sonda(
    `cota mínima sobre unidade de outra área (${outraUnidade})`,
    '/parametros?aba=unidades&form=cota',
    async p => {
      const f = p.locator('form').filter({ has: p.locator('input[name="minimo"]') }).first();
      await f.locator('select[name="unidadeId"]').evaluate((el, id) => {
        const o = document.createElement('option');
        o.value = String(id); o.textContent = 'forjada'; el.appendChild(o); el.value = String(id);
      }, outraUnidade);
      await f.locator('input[name="minimo"]').fill('7');
      await f.locator('button[type="submit"]').first().click();
    },
    `select count(*) c from cotas_equipe where unidade_id = ${outraUnidade} and minimo = 7`,
  );

  // A massa do alvo sai daqui: ela existe para as sondas acima e não deve
  // sobrar para a próxima execução nem para as fotos do manual.
  await db.query('delete from unidades where id = $1', [outraUnidade]);
  await db.query('delete from equipes where id = $1', [outraEquipe]);
}

console.log('\n\x1b[1m── Papel que não pode\x1b[0m\n');

// A tela nem desenha o formulário para o colaborador. A ação, no entanto,
// continua publicada — e é ela que precisa recusar.
como(FELIPE);

await sonda(
  'colaborador tentando abrir /parametros',
  '/parametros?aba=unidades&unidade=novo',
  async p => {
    // Aqui o envio pode legitimamente não acontecer: a rota redireciona antes
    // de desenhar o formulário, que é o comportamento certo. Daí `exigeEnvio`
    // desligado — mais a conferência de que a tela realmente NÃO é a de
    // Parâmetros, para "não enviou" não virar desculpa.
    const f = p.locator('form').filter({ has: p.locator('input[name="capacidadeTotal"]') });
    if (await f.count()) {
      await f.first().locator('input[name="nome"]').fill('Unidade do Colaborador');
      await f.first().locator('input[name="sigla"]').fill('COL');
      await f.first().locator('button[type="submit"]').first().click();
    } else if (new URL(p.url()).pathname === '/parametros') {
      throw new Error('a tela de Parâmetros abriu para o colaborador');
    }
  },
  "select count(*) c from unidades where nome = 'Unidade do Colaborador'",
  { exigeEnvio: false },
);

console.log('\n\x1b[1m── Texto que tenta virar código\x1b[0m\n');

como(ANA);

// Injeção de SQL contra um app que usa PostgREST/parâmetros não deveria nem
// começar — mas "não deveria" é o que se verifica. O critério aqui é o
// contrário dos anteriores: a linha PRECISA entrar, com o texto literal, e o
// banco precisa continuar de pé depois.
{
  const veneno = "Robert'); drop table colaboradores;--";
  await p.goto(BASE + '/parametros?aba=equipes&equipe=novo', { waitUntil: 'networkidle' });
  await p.waitForTimeout(200);
  try {
    const f = p.locator('form').filter({ has: p.locator('select[name="regime"]') }).first();
    await f.locator('input[name="nome"]').fill(veneno);
    await f.locator('button[type="submit"]').first().click();
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(600);

    const guardado = (await db.query('select nome from equipes where nome = $1', [veneno])).rows[0]?.nome;
    const tabelaViva = await conta("select count(*) c from information_schema.tables where table_name = 'colaboradores'");

    if (tabelaViva !== 1) erro('injeção de SQL derrubou a tabela colaboradores');
    else if (guardado !== veneno) erro(`o texto foi alterado ao gravar: ${guardado ?? '(não gravou)'}`);
    else ok('nome com aspas e ponto-e-vírgula guardado literal, tabela intacta');

    await db.query('delete from equipes where nome = $1', [veneno]);
  } catch (e) {
    erro(`injeção de SQL: não consegui operar: ${String(e).split('\n')[0].slice(0, 70)}`);
  }
}

await b.close();
await db.end();

console.log('');
if (falhas === 0) console.log('\x1b[32m>>> NENHUMA ENTRADA HOSTIL PASSOU\x1b[0m');
else { console.log(`\x1b[31m>>> ${falhas} sonda(s) falharam\x1b[0m`); process.exit(1); }
