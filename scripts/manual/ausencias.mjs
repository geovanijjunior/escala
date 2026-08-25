/**
 * O que a ausência É, e como achar a de alguém.
 *
 * O bloco "Férias e ausências já aprovadas" mostrava só o primeiro nome numa
 * pastilha, com duas cores para quatro naturezas: férias, folga, licença e
 * atestado. Quem montava o mês via "Eduardo" num dia e não sabia se ele estava
 * de férias, de licença paternidade ou com atestado — e para descobrir ia a
 * Planos, uma pessoa por vez, que é exatamente o caminho que este bloco existe
 * para poupar.
 *
 * E não havia como recortar: numa área com duzentas pessoas, o mês inteiro
 * numa tela só é uma parede.
 *
 * Este roteiro monta um dezembro com as quatro naturezas, confere que cada uma
 * se identifica no calendário E na lista de baixo, e filtra por equipe e por
 * colaborador.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const ANA = '00000000-0000-0000-0000-000000000001';
const COMP = 'competencia=2026-12-01';

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

// Dezembro de 2026 não tem escala gerada na massa — é o cenário deste bloco,
// que só aparece quando não há calendário para mostrar no lugar.
await sql("delete from ausencias where inicio >= '2026-12-01' and inicio <= '2026-12-31'");
await sql(`
  insert into ausencias (conta_id, colaborador_id, tipo, inicio, dias, grupo, motivo, criado_por)
  select c.conta_id, c.id, v.tipo, v.inicio::date, v.dias, v.grupo, v.motivo, $1
  from (values
    (1, 'FERIAS',   '2026-12-07', 15, '',         ''),
    (2, 'AUSENCIA', '2026-12-10',  3, 'Licença',  'Paternidade'),
    (3, 'AUSENCIA', '2026-12-14',  2, 'Atestado', 'Consulta'),
    (5, 'AUSENCIA', '2026-12-21',  1, 'Folga',    'Aniversário')
  ) as v(cid, tipo, inicio, dias, grupo, motivo)
  join colaboradores c on c.id = v.cid`, [ANA]);

const pessoas = Object.fromEntries(
  (await sql('select id, nome from colaboradores where id in (1,2,3,5)')).map(r => [r.id, r.nome]));

writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: ANA, email: 'ana@x' }));
const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1340, height: 1100 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));

const bloco = () => p.locator('section').filter({ hasText: 'Férias e ausências já aprovadas' }).first();
const abrir = async (extra = '') => {
  await p.goto(`${BASE}/calendario?${COMP}${extra}`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
};

/* ── 1. Cada natureza se identifica ────────────────────────────────────── */
console.log('1. A natureza da ausência aparece');
await abrir();
conferir(await bloco().count() === 1, 'o bloco aparece no mês sem escala');

const texto = await bloco().innerText();
for (const rotulo of ['FÉRIAS', 'LICENÇA', 'ATESTADO', 'FOLGA']) {
  conferir(texto.includes(rotulo), `"${rotulo}" identificado no calendário`);
}

// A lista de baixo é onde cabe o motivo por extenso — uma pastilha de nove
// pixels não comporta "Licença — Paternidade".
for (const motivo of ['Paternidade', 'Consulta', 'Aniversário']) {
  conferir(texto.includes(motivo), `o motivo "${motivo}" consta na lista`);
}
// `innerText` devolve o texto COMO É PINTADO, e `esc-rotulo` põe tudo em
// maiúscula por CSS — comparar com a string do código acusa diferença onde há
// só folha de estilo.
const contaPeriodos = (t, n) => new RegExp(`${n} per[íi]odo\\(s\\) no m[êe]s`, 'i').test(t);
conferir(contaPeriodos(texto, 4), 'a lista conta os períodos');
conferir(/07\/12\/2026 a 21\/12\/2026 · 15 dia\(s\)/.test(texto), 'o período das férias aparece por extenso');
await p.screenshot({ path: '/tmp/aus-1-detalhe.png', fullPage: true });

/* ── 2. Filtro por equipe ──────────────────────────────────────────────── */
console.log('\n2. Filtro por equipe');
const [equipe] = await sql(`
  select e.id, e.nome from equipes e
   join colaboradores c on c.equipe_id = e.id
  where c.id = 2 limit 1`);
await abrir(`&equipe=${equipe.id}`);
const soEquipe = await bloco().innerText();
conferir(soEquipe.includes(pessoas[2]), `${pessoas[2]} continua visível (é da equipe ${equipe.nome})`);
conferir(!soEquipe.includes(pessoas[1].split(' ')[0]), `${pessoas[1]} sumiu (é de outra equipe)`);

/* ── 3. Filtro por colaborador ─────────────────────────────────────────── */
console.log('\n3. Filtro por colaborador');
await abrir(`&q=${encodeURIComponent(pessoas[3])}`);
const soUm = await bloco().innerText();
conferir(contaPeriodos(soUm, 1), 'sobrou um período só');
conferir(soUm.includes('ATESTADO'), 'e é o atestado da pessoa filtrada');
conferir(!soUm.includes(pessoas[1].split(' ')[0]), 'os demais sumiram');

// O campo é digitável e traz a lista, como no calendário gerado.
await abrir();
const campo = bloco().locator('input[name="q"]');
conferir(await campo.count() === 1, 'o filtro de colaborador aceita digitação');
const lista = await campo.getAttribute('list');
const nomes = await p.evaluate(id => [...document.getElementById(id).options].map(o => o.value), lista);
conferir(nomes.length === 4, `a lista traz só quem está fora no mês (${nomes.length})`);

/* ── 4. Filtro que não sobra ninguém diz isso ──────────────────────────── */
console.log('\n4. Filtro sem resultado');
await abrir('&q=Ninguem%20Com%20Esse%20Nome');
conferir(
  (await bloco().innerText()).includes('Ninguém fora neste mês'),
  'o bloco explica que o filtro é que esvaziou a lista',
);

conferir(erros.length === 0, `nenhum erro de JS (${erros.join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> AUSÊNCIAS OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
