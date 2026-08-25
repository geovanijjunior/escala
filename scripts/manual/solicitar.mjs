/**
 * O caminho do colaborador para abrir um pedido.
 *
 * Três coisas quebraram aqui ao mesmo tempo, e as três eram invisíveis para
 * quem só olha a tela do Planejamento:
 *
 * 1. "Abrir nova solicitação" levava a `/minha-escala` — a tela do mês, com o
 *    formulário no fim. Quem clica num botão que diz "abrir" espera um
 *    formulário, não uma escala para rolar.
 * 2. Todo pedido morria em "Não foi possível abrir a solicitação". O insert
 *    passou a carregar `aberta_pelo_planejamento`, e num banco sem a 0027 o
 *    PostgREST recusa a linha inteira — inclusive a do colaborador, que não tem
 *    nada com essa coluna.
 * 3. Não estava provado em lugar nenhum que o pedido vale para mês sem escala
 *    publicada, que é o caso mais comum: pede-se férias de dezembro em agosto.
 *
 * O terceiro é o que este roteiro guarda com mais cuidado, porque é o mais fácil
 * de quebrar sem querer — basta alguém exigir uma geração para montar a tela.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const FELIPE = '00000000-0000-0000-0000-000000000003';

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

/** Espera a linha aparecer: a Server Action grava depois do `networkidle`. */
async function ate(fn) {
  for (let i = 0; i < 40; i++) {
    const v = await fn();
    if (v && (!Array.isArray(v) || v.length)) return v;
    await new Promise(r => setTimeout(r, 60));
  }
  return null;
}

writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: FELIPE, email: 'felipe@x' }));
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));

/* ── 1. O botão abre um formulário, e não outra tela ───────────────────── */
console.log('1. O botão abre o formulário');
await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
const botao = p.getByRole('link', { name: /Abrir nova solicitação/i });
conferir(await botao.count() === 1, 'o botão está no cabeçalho de Solicitações');
await botao.first().click();
await p.locator('select[name="tipo"]').waitFor({ timeout: 10000 });
conferir(new URL(p.url()).pathname === '/solicitacoes', 'ficou em /solicitacoes, sem desviar para a escala');
conferir(await p.locator('button:text("Enviar solicitação")').count() === 1, 'o formulário abriu ali mesmo');
// Quem abre para si não escolhe por quem: esse campo é só do Planejamento.
conferir(await p.locator('input[name="colaboradorId"]').count() === 0, 'sem campo "para quem" — ele abre para si');
await p.screenshot({ path: '/tmp/sol-1-form.png', fullPage: true });

/* ── 2. Um pedido comum grava ──────────────────────────────────────────── */
console.log('\n2. O pedido grava');
await sql("delete from solicitacoes where detalhe like 'Roteiro do colaborador%'");
await p.selectOption('select[name="tipo"]', 'AJUSTE_PONTO');
await p.fill('input[name="data"]', '2026-11-27');
await p.fill('textarea[name="detalhe"]', 'Roteiro do colaborador — ajuste de ponto.');
await p.locator('button:text("Enviar solicitação")').click();

const [comum] = (await ate(async () => sql(
  "select id, status, colaborador_id from solicitacoes where detalhe = 'Roteiro do colaborador — ajuste de ponto.'"))) ?? [];
conferir(!!comum, 'gravou');
conferir(comum?.status === 'TRIAGEM', `foi para a triagem (status=${comum?.status})`);
const corpo = await p.locator('body').innerText();
conferir(!/Não foi possível/i.test(corpo), 'nenhuma faixa de erro na tela');

/* ── 3. Mês SEM escala gerada aceita o pedido ──────────────────────────── */
//
// Dezembro de 2026 não tem geração na massa. É o caso real: em agosto se pede
// férias de dezembro, e a escala de dezembro nem existe ainda. Exigir escala
// aqui inverteria a ordem das coisas — o pedido é uma das ENTRADAS da geração.
console.log('\n3. Mês sem escala publicada');
const [dez] = await sql("select id, status from geracoes where competencia = '2026-12-01'");
conferir(!dez, 'dezembro realmente não tem escala gerada (é o cenário do teste)');

await p.goto(`${BASE}/solicitacoes?abrir=1`, { waitUntil: 'networkidle' });
await p.locator('select[name="tipo"]').waitFor({ timeout: 10000 });
await p.selectOption('select[name="tipo"]', 'FOLGA');
await p.fill('input[name="data"]', '2026-12-15');
await p.fill('textarea[name="detalhe"]', 'Roteiro do colaborador — folga em mês sem escala.');
await p.locator('button:text("Enviar solicitação")').click();

const [futuro] = (await ate(async () => sql(
  "select id, status, data from solicitacoes where detalhe = 'Roteiro do colaborador — folga em mês sem escala.'"))) ?? [];
conferir(!!futuro, 'o pedido para um mês sem escala gravou');
conferir(futuro?.status === 'TRIAGEM', `também foi para a triagem (status=${futuro?.status})`);
await p.screenshot({ path: '/tmp/sol-2-futuro.png', fullPage: true });

/* ── 4. Um banco sem a 0027 não pode derrubar o colaborador ────────────── */
//
// A coluna serve ao pedido que o PLANEJAMENTO abre em nome de alguém. O
// colaborador não tem nada com ela, e mandá-la à toa fazia a instalação sem a
// migration recusar todo pedido dele. A conferência derruba a coluna de
// propósito e refaz o caminho: é a única forma de provar que ele não depende
// dela — e ela volta no fim, com ou sem falha no meio.
console.log('\n4. Instalação sem a 0027');
await sql('alter table solicitacoes drop column if exists aberta_pelo_planejamento');
await sql("notify pgrst, 'reload schema'");
try {
  await p.goto(`${BASE}/solicitacoes?abrir=1`, { waitUntil: 'networkidle' });
  await p.locator('select[name="tipo"]').waitFor({ timeout: 10000 });
  await p.selectOption('select[name="tipo"]', 'AJUSTE_PONTO');
  await p.fill('input[name="data"]', '2026-11-29');
  await p.fill('textarea[name="detalhe"]', 'Roteiro do colaborador — sem a coluna da 0027.');
  await p.locator('button:text("Enviar solicitação")').click();

  const [semColuna] = (await ate(async () => sql(
    "select id from solicitacoes where detalhe = 'Roteiro do colaborador — sem a coluna da 0027.'"))) ?? [];
  conferir(!!semColuna, 'o colaborador abre pedido mesmo sem a coluna da 0027');
} finally {
  await sql('alter table solicitacoes add column if not exists aberta_pelo_planejamento boolean not null default false');
  await sql("notify pgrst, 'reload schema'");
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> SOLICITAÇÃO DO COLABORADOR OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
