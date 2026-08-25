/**
 * Afastamento por atestado médico, das duas portas de abertura.
 *
 * O grupo Atestado sempre existiu em `GRUPOS_AUSENCIA`, com três motivos, e o
 * Planejamento podia lançá-lo à mão no plano do mês. O que faltava era o TIPO
 * de solicitação: quem apresentava um atestado não tinha como registrá-lo, e
 * quem recebia o papel na mão só podia lançar a ausência direto — sem pedido,
 * sem decisão de ninguém e sem histórico de quem aprovou o quê.
 *
 * Na prática ia como "Licença", que é outra coisa: licença se programa
 * (paternidade, gala, nojo) e atestado chega depois do fato. Somados, o
 * relatório de afastamentos não distinguia o previsível do imprevisível — que é
 * a única coisa que ele precisa distinguir.
 *
 * O roteiro abre pelos dois caminhos, aprova, e confere no banco que a ausência
 * nasceu no grupo Atestado e não em Folga, que era onde o `else` da gravação
 * mandava tudo o que não fosse licença.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const ANA = '00000000-0000-0000-0000-000000000001';
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
async function ate(fn) {
  for (let i = 0; i < 50; i++) {
    const v = await fn();
    if (v && (!Array.isArray(v) || v.length)) return v;
    await new Promise(r => setTimeout(r, 60));
  }
  return null;
}

const b = await abrirNavegador();
const p = await (await b.newContext({ viewport: { width: 1340, height: 1000 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));

const cartao = marca => p.locator('section.esc-card').filter({ hasText: marca });

/* ── 1. O colaborador registra o próprio atestado ──────────────────────── */
console.log('1. Aberto pelo colaborador');
{
  const marca = 'Atestado — aberto pelo colaborador';
  await sql(`delete from solicitacao_eventos where solicitacao_id in
               (select id from solicitacoes where detalhe = $1)`, [marca]);
  await sql('delete from solicitacoes where detalhe = $1', [marca]);

  writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: FELIPE, email: 'felipe@x' }));
  await p.goto(`${BASE}/solicitacoes?abrir=1`, { waitUntil: 'networkidle' });
  await p.locator('select[name="tipo"]').waitFor({ timeout: 10000 });

  const tipos = await p.locator('select[name="tipo"] option').evaluateAll(os => os.map(o => o.textContent.trim()));
  conferir(tipos.includes('Atestado médico'), `"Atestado médico" está na lista de tipos (${tipos.length} tipos)`);

  await p.selectOption('select[name="tipo"]', 'ATESTADO');
  await p.waitForTimeout(300);

  // Atestado cobre PERÍODO — um afastamento de sete dias é sete dias — e traz
  // os motivos do grupo Atestado, não os de folga.
  conferir(await p.locator('input[name="dataFim"]').count() === 1, 'o formulário pede o fim do período');
  const motivos = await p.locator('select[name="motivo"] option').evaluateAll(os => os.map(o => o.value));
  conferir(
    motivos.includes('Afastamento por doença') && motivos.includes('Consulta ou exame')
      && motivos.includes('Acompanhamento de familiar'),
    `os motivos são os do grupo Atestado (${motivos.join(', ')})`,
  );
  conferir(!motivos.includes('Aniversário'), 'e não os de folga');
  // Nenhum motivo pode repetir o nome do tipo. "Tipo: Atestado médico · Motivo:
  // Atestado médico" era a lista antiga, e não acrescentava nada a quem escolhe.
  conferir(!motivos.includes('Atestado médico'), 'e nenhum deles repete o nome do tipo');

  // Cada motivo se explica ao lado do campo. É a diferença entre saber que há
  // três opções e saber qual delas é a sua.
  const ajuda = () => p.locator('label:has(select[name="motivo"]) span.esc-ajuda').innerText();
  await p.selectOption('select[name="motivo"]', 'Consulta ou exame');
  await p.waitForTimeout(200);
  const daConsulta = (await ajuda().catch(() => '')).trim();
  conferir(daConsulta.length > 20, `"Consulta ou exame" vem explicado ("${daConsulta.slice(0, 55)}…")`);

  await p.selectOption('select[name="motivo"]', 'Acompanhamento de familiar');
  await p.waitForTimeout(200);
  const doFamiliar = (await ajuda().catch(() => '')).trim();
  conferir(
    doFamiliar.length > 20 && doFamiliar !== daConsulta,
    `e o do familiar traz outra explicação ("${doFamiliar.slice(0, 55)}…")`,
  );

  await p.selectOption('select[name="motivo"]', 'Afastamento por doença');
  await p.fill('input[name="data"]', '2026-12-14');
  await p.fill('input[name="dataFim"]', '2026-12-16');
  await p.fill('textarea[name="detalhe"]', marca);
  await p.locator('button:text("Enviar solicitação")').click();

  const [criada] = (await ate(async () => sql(
    'select id, status, tipo, data_fim, motivo from solicitacoes where detalhe = $1', [marca]))) ?? [];
  conferir(criada?.tipo === 'ATESTADO', `gravou como ATESTADO (${criada?.tipo})`);
  conferir(criada?.status === 'TRIAGEM', 'foi para a triagem');
  // `date` volta do driver como Date, não como texto: comparar o começo da
  // string dá "Wed Dec 16 2026…" e acusa diferença onde há só formatação.
  const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  conferir(iso(criada?.data_fim) === '2026-12-16', `o período inteiro foi gravado (${iso(criada?.data_fim)})`);
  conferir(criada?.motivo === 'Afastamento por doença', `o motivo veio junto (${criada?.motivo})`);
  await p.screenshot({ path: '/tmp/atestado-1-colab.png', fullPage: true });
}

/* ── 2. O Planejamento registra o atestado que chegou na mão dele ──────── */
console.log('\n2. Aberto pelo Planejamento, em nome da pessoa');
{
  const marca = 'Atestado — aberto pelo Planejamento';
  await sql(`delete from solicitacao_eventos where solicitacao_id in
               (select id from solicitacoes where detalhe = $1)`, [marca]);
  await sql('delete from solicitacoes where detalhe = $1', [marca]);
  await sql("delete from ausencias where inicio = '2026-12-21'");
  await sql("delete from pins where data between '2026-12-21' and '2026-12-23'");

  writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: ANA, email: 'ana@x' }));
  await p.goto(`${BASE}/solicitacoes?abrir=1`, { waitUntil: 'networkidle' });
  const paraQuem = p.locator('input[list]').first();
  await paraQuem.waitFor({ timeout: 10000 });

  const tipos = await p.locator('select[name="tipo"] option').evaluateAll(os => os.map(o => o.textContent.trim()));
  conferir(tipos.includes('Atestado médico'), 'o tipo também está na abertura do Planejamento');

  const lista = await paraQuem.getAttribute('list');
  const rotulos = await p.evaluate(id => [...document.getElementById(id).options].map(o => o.value), lista);
  const [alvo] = await sql('select id, nome from colaboradores where id = 5');
  const rotulo = rotulos.find(r => r.startsWith(alvo.nome));
  await paraQuem.fill(rotulo);
  await p.waitForTimeout(250);

  await p.selectOption('select[name="tipo"]', 'ATESTADO');
  await p.waitForTimeout(300);
  await p.selectOption('select[name="motivo"]', 'Consulta ou exame');
  await p.fill('input[name="data"]', '2026-12-21');
  await p.fill('input[name="dataFim"]', '2026-12-23');
  await p.fill('textarea[name="detalhe"]', marca);
  await p.locator('button:text("Abrir solicitação")').click();

  const [criada] = (await ate(async () => sql(
    'select id, tipo, status from solicitacoes where detalhe = $1', [marca]))) ?? [];
  conferir(criada?.tipo === 'ATESTADO', 'gravou como ATESTADO');

  /* ── 3. Aprovado, vira ausência do grupo certo ─────────────────────── */
  console.log('\n3. Aprovado, entra na escala como Atestado');
  await p.goto(`${BASE}/solicitacoes`, { waitUntil: 'networkidle' });
  const c = cartao(marca);
  await c.first().waitFor({ timeout: 10000 });
  await c.getByRole('button', { name: /^Aprovar$/ }).click();

  const [aus] = (await ate(async () => sql(
    `select tipo, grupo, motivo, dias from ausencias
      where colaborador_id = $1 and inicio = '2026-12-21'`, [alvo.id]))) ?? [];
  conferir(!!aus, 'a ausência foi gravada');
  // O `else` da gravação mandava para "Folga" tudo o que não fosse licença: um
  // atestado aprovado apareceria no histórico como folga.
  conferir(aus?.grupo === 'Atestado', `no grupo Atestado, e não em Folga (${aus?.grupo})`);
  conferir(aus?.motivo === 'Consulta ou exame', `com o motivo do pedido (${aus?.motivo})`);
  conferir(Number(aus?.dias) === 3, `cobrindo os três dias (${aus?.dias})`);

  const travas = await sql(
    "select data from pins where colaborador_id = $1 and data between '2026-12-21' and '2026-12-23'", [alvo.id]);
  conferir(travas.length === 3, `os três dias travados na escala (${travas.length})`);

  const eventos = await sql(
    'select detalhe from solicitacao_eventos where solicitacao_id = $1 order by id desc limit 1', [criada.id]);
  conferir(
    /atestado/i.test(eventos[0]?.detalhe ?? ''),
    `o histórico diz que foi lançado como atestado ("${eventos[0]?.detalhe ?? '—'}")`,
  );
  await p.screenshot({ path: '/tmp/atestado-2-aprovado.png', fullPage: true });
}

/* ── 4. E aparece nomeado no calendário do mês ─────────────────────────── */
console.log('\n4. No bloco de férias e ausências');
{
  await p.goto(`${BASE}/calendario?competencia=2026-12-01`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const bloco = p.locator('section').filter({ hasText: 'Férias e ausências já aprovadas' }).first();
  conferir(await bloco.count() === 1, 'o bloco existe no mês');
  const t = await bloco.innerText();
  conferir(t.includes('ATESTADO'), 'a ausência aparece identificada como ATESTADO');
  conferir(t.includes('Consulta ou exame'), 'com o motivo na lista');
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> ATESTADO OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
