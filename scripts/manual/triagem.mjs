/**
 * As saídas da triagem, e o que se faz com o que ficou estacionado.
 *
 * A triagem tinha duas saídas de verdade — encaminhar ou recusar — e a lista de
 * espera era um beco: entrava-se nela e só se saía promovendo ao gestor. Faltava
 * o pedido legítimo que simplesmente não é agora, e faltava poder decidir de
 * dentro do estacionamento.
 *
 * Este roteiro percorre as cinco saídas e as quatro decisões que partem de fila
 * e tratativa, uma a uma, clicando o que a tela oferece e conferindo o banco
 * depois de cada uma. O motivo opcional é exercitado junto: o que se digita nele
 * tem de chegar ao histórico do pedido, e não sumir.
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
async function ate(fn) {
  for (let i = 0; i < 50; i++) {
    const v = await fn();
    if (v && (!Array.isArray(v) || v.length)) return v;
    await new Promise(r => setTimeout(r, 60));
  }
  return null;
}

const [{ conta_id: CONTA }] = await sql('select conta_id from perfis where id = $1', [ANA]);

/** Um pedido novo em triagem, com marca própria para ser achado depois. */
async function semear(marca, tipo = 'TROCA_UNIDADE', status = 'TRIAGEM') {
  await sql(`delete from solicitacao_eventos where solicitacao_id in
               (select id from solicitacoes where detalhe = $1)`, [marca]);
  await sql('delete from solicitacoes where detalhe = $1', [marca]);
  const [linha] = await sql(`
    insert into solicitacoes (conta_id, colaborador_id, tipo, data, detalhe, status, unidade_desejada_id)
    values ($1, 3, $2, '2026-11-19', $3, $4,
            (select id from unidades where conta_id = $1 order by id limit 1))
    returning id`, [CONTA, tipo, marca, status]);
  return linha.id;
}

writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: ANA, email: 'ana@x' }));
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));

const cartao = marca => p.locator('section.esc-card').filter({ hasText: marca });

/** Clica um botão no cartão daquele pedido e espera o status virar. */
async function decidir(marca, botao, aba = '') {
  await p.goto(`${BASE}/solicitacoes${aba && `?aba=${aba}`}`, { waitUntil: 'networkidle' });
  const c = cartao(marca);
  await c.first().waitFor({ timeout: 10000 });
  await c.getByRole('button', { name: botao }).first().click();
}

/* ── 1. As cinco saídas da triagem ─────────────────────────────────────── */
console.log('1. As cinco saídas da triagem');

const CASOS = [
  ['Triagem — aprovar',    'Aprovar',             'APROVADA'],
  ['Triagem — encaminhar', 'Encaminhar ao gestor', 'GESTOR'],
  ['Triagem — fila',       'Lista de espera',      'FILA'],
  ['Triagem — tratativa',  'Tratativa futura',     'TRATATIVA'],
];

for (const [marca, botao, esperado] of CASOS) {
  const id = await semear(marca);
  await decidir(marca, botao);
  const [linha] = (await ate(async () =>
    sql('select status from solicitacoes where id = $1 and status <> $2', [id, 'TRIAGEM']))) ?? [];
  conferir(linha?.status === esperado, `"${botao}" levou a ${esperado} (deu ${linha?.status})`);
}

// A quinta saída exige motivo, e é a única que exige.
{
  const marca = 'Triagem — recusar';
  const id = await semear(marca);
  await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
  const c = cartao(marca);
  await c.first().waitFor({ timeout: 10000 });
  await c.getByRole('button', { name: /^Recusar$/ }).click();
  const campo = c.locator('input[name="motivo"]');
  await campo.waitFor({ timeout: 5000 });
  conferir(true, '"Recusar" abre o campo em vez de decidir na hora');
  await campo.fill('Sem cobertura possível nesta data.');
  await c.getByRole('button', { name: /Confirmar recusa/i }).click();
  const [linha] = (await ate(async () =>
    sql("select status, motivo_recusa from solicitacoes where id = $1 and status = 'RECUSADA'", [id]))) ?? [];
  conferir(linha?.status === 'RECUSADA', 'recusou');
  conferir(linha?.motivo_recusa === 'Sem cobertura possível nesta data.', 'a justificativa ficou no pedido');
}

/* ── 2. Motivo opcional: um clique decide, e o texto é oferecido ───────── */
console.log('\n2. Motivo opcional nas decisões que não exigem');
{
  const marca = 'Triagem — com observação';
  const id = await semear(marca);
  await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
  const c = cartao(marca);
  await c.first().waitFor({ timeout: 10000 });

  // Fechado por padrão: aprovar não pode custar dois cliques a quem não comenta.
  conferir(await c.locator('input[name="motivo"]').count() === 0, 'o campo começa fechado');
  await c.getByRole('button', { name: /\+ observação/ }).click();
  const campo = c.locator('input[name="motivo"]');
  await campo.waitFor({ timeout: 5000 });
  conferir(await campo.count() === 1, 'há UM campo de observação no cartão, não um por botão');
  await campo.fill('Combinado com a chefia na reunião de terça.');
  // O texto tem de valer para QUALQUER decisão do cartão, e não só para a que
  // estiver ao lado do campo: quem escreve a observação e depois muda de ideia
  // sobre o botão não espera perdê-la.
  await c.getByRole('button', { name: /^Tratativa futura$/ }).click();

  const [linha] = (await ate(async () =>
    sql("select status from solicitacoes where id = $1 and status = 'TRATATIVA'", [id]))) ?? [];
  conferir(!!linha, 'decidiu com a observação preenchida');
  const eventos = await sql(
    'select detalhe from solicitacao_eventos where solicitacao_id = $1 order by id desc limit 1', [id]);
  conferir(
    eventos[0]?.detalhe?.includes('Combinado com a chefia'),
    `a observação chegou ao histórico ("${eventos[0]?.detalhe ?? '—'}")`,
  );
}

/* ── 3. Fila e tratativa deixam de ser becos ───────────────────────────── */
console.log('\n3. Decidir de dentro do estacionamento');

for (const [marca, status, aba, botao, esperado] of [
  ['Fila — aprovar',       'FILA',      'fila',      /^Aprovar$/, 'APROVADA'],
  ['Fila — promover',      'FILA',      'fila',      /Promover ao gestor/, 'GESTOR'],
  ['Tratativa — aprovar',  'TRATATIVA', 'tratativa', /^Aprovar$/, 'APROVADA'],
]) {
  const id = await semear(marca, 'TROCA_UNIDADE', status);
  await decidir(marca, botao, aba);
  const [linha] = (await ate(async () =>
    sql('select status from solicitacoes where id = $1 and status <> $2', [id, status]))) ?? [];
  conferir(linha?.status === esperado, `${status}: "${botao.source ?? botao}" levou a ${esperado} (deu ${linha?.status})`);
}

for (const [marca, status, aba] of [
  ['Fila — recusar', 'FILA', 'fila'],
  ['Tratativa — recusar', 'TRATATIVA', 'tratativa'],
]) {
  const id = await semear(marca, 'TROCA_UNIDADE', status);
  await p.goto(`${BASE}/solicitacoes?aba=${aba}`, { waitUntil: 'networkidle' });
  const c = cartao(marca);
  await c.first().waitFor({ timeout: 10000 });
  await c.getByRole('button', { name: /^Recusar$/ }).click();
  await c.locator('input[name="motivo"]').waitFor({ timeout: 5000 });
  await c.locator('input[name="motivo"]').fill('Retomado e recusado na revisão do mês.');
  await c.getByRole('button', { name: /Confirmar recusa/i }).click();
  const [linha] = (await ate(async () =>
    sql("select status from solicitacoes where id = $1 and status = 'RECUSADA'", [id]))) ?? [];
  conferir(!!linha, `${status}: recusa com motivo encerrou o pedido`);
}

/* ── 4. A aba existe, e o pedido estacionado sai da caixa da triagem ───── */
console.log('\n4. Onde o estacionado aparece');
{
  const marca = 'Tratativa — visível';
  await semear(marca, 'TROCA_UNIDADE', 'TRATATIVA');
  await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
  conferir(await cartao(marca).count() === 0, 'não aparece na aba Abertas');
  await p.goto(`${BASE}/solicitacoes?aba=tratativa`, { waitUntil: 'networkidle' });
  conferir(await cartao(marca).count() === 1, 'aparece na aba Tratativas futuras');
  conferir((await cartao(marca).innerText()).includes('Tratativa futura'), 'o cartão mostra o estado');
  await p.screenshot({ path: '/tmp/triagem-tratativa.png', fullPage: true });
}

/* ── 5. A fila renumera ao perder alguém por qualquer porta ────────────── */
console.log('\n5. A ordem da fila sobrevive à saída pelo meio');
{
  // A fila precisa estar VAZIA antes: qualquer pedido esquecido nela entra na
  // renumeração e desloca as três posições que este trecho mede. A primeira
  // versão media 2,3 e acusava um buraco que era só o resto do passo 1.
  await sql("delete from solicitacao_eventos where solicitacao_id in (select id from solicitacoes where status = 'FILA')");
  await sql("delete from solicitacoes where status = 'FILA'");
  const ids = [];
  for (let i = 1; i <= 3; i++) {
    const [l] = await sql(`
      insert into solicitacoes (conta_id, colaborador_id, tipo, data, detalhe, status, posicao_fila, unidade_desejada_id)
      values ($1, 3, 'TROCA_UNIDADE', '2026-11-19', $2, 'FILA', $3,
              (select id from unidades where conta_id = $1 order by id limit 1))
      returning id`, [CONTA, `Fila ordem ${i}`, i]);
    ids.push(l.id);
  }
  // Aprova o do meio: quem era 3º tem de virar 2º.
  await decidir('Fila ordem 2', /^Aprovar$/, 'fila');
  await ate(async () => sql("select 1 from solicitacoes where id = $1 and status = 'APROVADA'", [ids[1]]));
  const restantes = await sql(
    'select posicao_fila from solicitacoes where id = any($1) and status = $2 order by posicao_fila',
    [[ids[0], ids[2]], 'FILA']);
  conferir(
    restantes.map(r => r.posicao_fila).join(',') === '1,2',
    `sem buraco na ordem depois da aprovação (${restantes.map(r => r.posicao_fila).join(',') || 'vazio'})`,
  );
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> TRIAGEM OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
