/**
 * O regime é da pessoa; o turno tem três valores.
 *
 * Duas mudanças que só se provam operando a tela, e uma delas é a que
 * realmente importa: ANTES, o regime vinha da equipe e o campo nem existia no
 * cadastro da pessoa. Quem precisasse de um plantonista dentro de um time
 * administrativo não tinha como fazê-lo — a saída era partir o time em dois só
 * para o sistema aceitar, e depois pagar isso em cota, escala e aprovação.
 *
 * O roteiro cobra as duas pontas:
 *
 *  - a equipe NÃO pede mais regime, e pede turno com as três opções;
 *  - a pessoa pede regime, e duas pessoas de regimes diferentes convivem na
 *    mesma equipe — que era o estado impossível de representar.
 *
 * E cobra o vespertino onde ele some mais fácil: no rótulo. Havia oito telas
 * com `turno === 'N' ? 'Noturno' : 'Diurno'`, e cada uma chamaria o vespertino
 * de diurno, calada.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const ANA = '00000000-0000-0000-0000-000000000001';

const banco = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5433),
  user: process.env.PGUSER || 'postgres',
  database: process.env.PGDATABASE || 'manual',
});
const sql = async (t, a = []) => (await banco.query(t, a)).rows;

let falhas = 0;
const conferir = (ok, rotulo) => {
  console.log(`  ${ok ? 'ok' : 'FALHOU'}: ${rotulo}`);
  if (!ok) falhas++;
};

const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));
writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: ANA, email: 'ana@x' }));

const faixaDeErro = () => p.evaluate(() => {
  const el = [...document.querySelectorAll('[role="status"]')]
    .find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
  return el ? el.textContent.trim() : null;
});

/* ── 1. A equipe: turno de três, e nenhum regime ─────────────────────── */
console.log('1. Cadastro de equipe');
{
  await p.goto(`${BASE}/parametros?aba=equipes&equipe=novo`, { waitUntil: 'networkidle' });
  const form = p.locator('form:has(button:text-is("Adicionar equipe"))');
  await form.waitFor({ timeout: 15000 });

  const turnos = await form.locator('select[name="turno"] option').evaluateAll(os => os.map(o => o.value));
  conferir(
    turnos.length === 3 && turnos.includes('D') && turnos.includes('V') && turnos.includes('N'),
    `o turno oferece os três (${turnos.join(', ')})`,
  );
  const rotulos = await form.locator('select[name="turno"] option').evaluateAll(os => os.map(o => o.textContent.trim()));
  conferir(rotulos.includes('Vespertino'), `e o vespertino está nomeado (${rotulos.join(', ')})`);

  conferir(await form.locator('select[name="regime"]').count() === 0,
    'a equipe NÃO pede mais regime');

  await sql("delete from equipes where nome = 'Equipe da Tarde'");
  await form.locator('input[name="nome"]').fill('Equipe da Tarde');
  await form.locator('select[name="turno"]').selectOption('V');
  await form.locator('button:text-is("Adicionar equipe")').click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);

  const [criada] = await sql("select id, turno from equipes where nome = 'Equipe da Tarde'");
  conferir(criada?.turno === 'V', `gravou o vespertino (${criada?.turno})`);
  conferir(!await faixaDeErro(), 'sem erro na tela');

  // E o rótulo na lista: aqui é onde um `if` de dois valores mentiria.
  await p.goto(`${BASE}/parametros?aba=equipes`, { waitUntil: 'networkidle' });
  const linha = await p.locator('tr', { hasText: 'Equipe da Tarde' }).first().innerText();
  conferir(/Vespertino/i.test(linha), `a lista diz Vespertino, e não Diurno ("${linha.replace(/\n/g, ' ').slice(0, 60)}")`);
}

/* ── 2. A pessoa: regime próprio ─────────────────────────────────────── */
console.log('\n2. Regime na ficha da pessoa');
{
  await p.goto(`${BASE}/colaboradores?novo=1`, { waitUntil: 'networkidle' });
  const f = p.locator('form:has(select[name="cargo"])').first();
  await f.waitFor({ timeout: 15000 });
  conferir(await f.locator('select[name="regime"]').count() === 1, 'a ficha pede regime');
  const turnos = await f.locator('select[name="turno"] option').evaluateAll(os => os.map(o => o.value));
  conferir(turnos.length === 3, `e o turno dela também tem três (${turnos.join(', ')})`);
}

/* ── 3. Dois regimes na MESMA equipe ─────────────────────────────────── */
//
// O estado que antes era impossível. O motor sempre soube resolvê-lo — ele lê
// `c.regime`, da pessoa, e nunca o da equipe —, mas o cadastro não deixava
// chegar até ele.
console.log('\n3. Plantonista e administrativo no mesmo time');
{
  await sql("delete from colaboradores where matricula in ('MIX-1', 'MIX-2')");
  const [equipe] = await sql("select id, nome from equipes where nome = 'Técnicos de Campo'");
  const [unidade] = await sql('select id from unidades where ativa limit 1');

  const cadastrar = async (matricula, nome, regime) => {
    await p.goto(`${BASE}/colaboradores?novo=1`, { waitUntil: 'networkidle' });
    const f = p.locator('form:has(select[name="cargo"])').first();
    await f.locator('input[name="nome"]').fill(nome);
    await f.locator('input[name="matricula"]').fill(matricula);
    await f.locator('select[name="equipeId"]').selectOption(String(equipe.id));
    await f.locator('select[name="unidadeBaseId"]').selectOption(String(unidade.id));
    await f.locator('select[name="regime"]').selectOption(regime);
    if (regime === '12x36') {
      // Plantão entra 07:00 e sai 19:00; o formulário não impõe, então digito.
      await f.locator('input[name="entrada"]').fill('07:00');
      await f.locator('input[name="saida"]').fill('19:00');
    }
    await f.locator('button[type="submit"]').first().click();
    await p.waitForLoadState('networkidle');
    await p.waitForTimeout(500);
    return faixaDeErro();
  };

  conferir(!await cadastrar('MIX-1', 'Plantonista do Time', '12x36'), 'o plantonista entra');
  conferir(!await cadastrar('MIX-2', 'Administrativo do Time', '5x2'), 'o administrativo também');

  const gravados = await sql(
    "select matricula, regime from colaboradores where matricula in ('MIX-1','MIX-2') order by matricula");
  conferir(gravados[0]?.regime === '12x36', `MIX-1 ficou 12x36 (${gravados[0]?.regime})`);
  conferir(gravados[1]?.regime === '5x2', `MIX-2 ficou 5x2 (${gravados[1]?.regime})`);
  conferir(gravados.length === 2, 'os dois na mesma equipe, sem o sistema reclamar');

  await sql("delete from colaboradores where matricula in ('MIX-1', 'MIX-2')");
  await sql("delete from equipes where nome = 'Equipe da Tarde'");
}

/* ── 4. O vespertino aparece nomeado nas telas de leitura ────────────── */
console.log('\n4. O rótulo do vespertino, onde ele sumiria');
{
  // A massa semeia a equipe "Analistas de Sistemas" no turno vespertino.
  await p.goto(`${BASE}/colaboradores`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const texto = await p.evaluate(() => document.body.innerText);
  conferir(/Vespertino/i.test(texto), 'a lista de colaboradores nomeia o turno vespertino');
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.slice(0, 2).join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> REGIME E TURNO OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
