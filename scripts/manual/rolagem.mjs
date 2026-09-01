/**
 * A tela não pode saltar para o topo a cada botão.
 *
 * Toda Server Action daqui termina em `redirect()`, e redirect no App Router é
 * navegação — navegação rola para o topo. Nas telas longas (plano do mês,
 * ajustes da escala, triagem de solicitações) isso significa rolar a página
 * inteira de novo depois de CADA clique para poder dar o passo seguinte.
 *
 * O roteiro mede o que a pessoa sente: rola até o formulário lá embaixo, clica,
 * e olha onde a página ficou. Tolerância de 200px porque o conteúdo acima do
 * ponto pode encolher ou crescer com a própria ação — o que não pode é voltar
 * para o começo.
 *
 * Cobre também o destino: remover uma ausência pelo painel de ajustes tem de
 * devolver à revisão da escala, não cuspir a pessoa no editor do plano.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { abrirNavegador } from './navegador.mjs';

const BASE = process.env.BASE || 'http://localhost:3000';
const ANA = '00000000-0000-0000-0000-000000000001';
const COMP = 'competencia=2026-11-01';
const TOLERANCIA = 200;

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
const p = await (await b.newContext({ viewport: { width: 1340, height: 900 } })).newPage();
const erros = [];
p.on('pageerror', e => erros.push(e.message));

writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id: ANA, email: 'ana@x' }));

/**
 * Rola até o elemento, clica, e devolve onde a página ficou.
 *
 * O `scrollIntoView` antes do clique é o que reproduz a queixa: sem rolar, a
 * página já estava no topo e o salto não teria como aparecer.
 */
async function clicarLaEmbaixo(url, seletor) {
  await p.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  const alvo = p.locator(seletor).first();
  await alvo.waitFor({ timeout: 15000 });
  await alvo.scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  const antes = await p.evaluate(() => window.scrollY);
  await alvo.click();
  await p.waitForLoadState('networkidle');
  // Dois quadros: a reposição acontece depois de o Next rolar para o topo, e
  // medir no mesmo instante do clique leria o estado do meio do caminho.
  await p.waitForTimeout(700);
  const depois = await p.evaluate(() => window.scrollY);
  return { antes, depois, url: p.url() };
}

/* ── 1. O editor do plano do mês ────────────────────────────────────────── */
//
// O botão de salvar fica no fim de um formulário alto, que é o caso clássico da
// queixa. Duas armadilhas na escolha do alvo, as duas descobertas medindo:
//
//  - formulário com campo obrigatório vazio não envia — o navegador barra
//    antes, não há navegação, e a rolagem fica parada pelo motivo errado. Este
//    já vem preenchido com o plano gravado, então o clique de fato envia;
//  - tela que cabe na janela não tem rolagem para preservar. A primeira versão
//    deste roteiro mediu a lista de feriados, que tinha 900px de altura numa
//    janela de 900px, e passou sem exercitar nada.
console.log('1. Editor do plano do mês, em /planos');
{
  const r = await clicarLaEmbaixo(
    '/planos?competencia=2026-11-01&colab=5',
    'button:text-is("Salvar plano")',
  ).catch(() => null);

  if (r) {
    conferir(r.antes > TOLERANCIA, `o botão estava mesmo fora da primeira tela (${r.antes})`);
    conferir(r.depois > TOLERANCIA, `e a página não voltou ao topo (${r.antes} → ${r.depois})`);
  } else {
    conferir(false, 'não consegui abrir o editor do plano');
  }
}

/* ── 2. Ajustes manuais, no fim de uma tela longa ───────────────────────── */
console.log('\n2. Painel de ajustes, em /gerar');
{
  // Um lançamento à mão para haver o que remover, e para o botão existir.
  await sql("delete from ausencias where inicio = '2026-11-26'");
  const [alvo] = await sql('select id from colaboradores order by id limit 1');
  await sql(
    `insert into ausencias (conta_id, colaborador_id, tipo, inicio, dias, grupo, motivo, criado_por)
     select conta_id, $1, 'AUSENCIA', '2026-11-26', 1, 'Folga', 'Aniversário', criado_por
       from ausencias limit 1`, [alvo.id]);
}

/* ── 3. Remover ausência devolve à revisão, não ao editor do plano ──────── */
console.log('\n3. Remover ausência pelo painel de ajustes');
{
  const r = await clicarLaEmbaixo(
    `/gerar?${COMP}&etapa=revisar`,
    'li:has-text("26/11/2026") button:text-is("Remover")',
  ).catch(() => null);

  if (r) {
    conferir(r.url.includes('/gerar'), `voltou para /gerar, e não para /planos (${r.url.split('?')[0]})`);
    conferir(r.url.includes('etapa=revisar'), 'na etapa de revisar, onde a pessoa estava');
    conferir(r.depois > TOLERANCIA, `sem saltar para o topo (${r.antes} → ${r.depois})`);
    const restou = await sql("select id from ausencias where inicio = '2026-11-26'");
    conferir(restou.length === 0, 'e a ausência saiu mesmo do banco');
  } else {
    conferir(false, 'não achei o botão Remover do lançamento');
  }
}

/* ── 4. A célula da grade abre o painel sem perder o lugar ──────────────── */
//
// A grade é o caso mais duro da queixa, e é de LINK, não de formulário: clicar
// numa célula da vigésima linha para trocar alguém de unidade devolvia a pessoa
// ao topo, e ela tinha de rolar tudo de novo — passando, no meio do caminho,
// pelo painel que já estava aberto. A reposição de rolagem não alcança esse
// caso de propósito (link é para chegar a outro lugar); quem resolve é a
// âncora, que leva direto ao painel.
console.log('\n4. Clique numa célula da grade');
{
  await p.goto(`${BASE}/gerar?${COMP}&etapa=revisar`, { waitUntil: 'networkidle' });
  // Uma célula bem no fim da grade, que é onde o salto doía.
  const celula = p.locator('table a.esc-celula').last();
  await celula.waitFor({ timeout: 15000 });
  await celula.scrollIntoViewIfNeeded();
  await p.waitForTimeout(250);
  const antes = await p.evaluate(() => window.scrollY);
  conferir(antes > TOLERANCIA, `a célula estava fora da primeira tela (${antes})`);

  await celula.click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(700);

  const painel = await p.evaluate(() => {
    const el = document.getElementById('ajuste-do-dia');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { topo: Math.round(r.top), y: Math.round(window.scrollY) };
  });

  if (!painel) {
    conferir(false, 'o painel de ajuste não abriu');
  } else {
    conferir(painel.y > TOLERANCIA, `a tela não voltou ao topo (${antes} → ${painel.y})`);
    // Dentro da janela, e perto do alto dela: é isso que "caiu no painel"
    // significa. Só medir a rolagem deixaria passar parar num ponto qualquer.
    conferir(
      painel.topo >= -30 && painel.topo < 300,
      `e parou no painel que abriu (topo a ${painel.topo}px da janela)`,
    );
  }
}

/* ── 5. Um link continua levando ao topo da tela nova ───────────────────── */
//
// Não há um quarto caso na triagem de solicitações, e a tentativa merece nota:
// ela clicava "Aprovar" no último pedido da lista. Com a massa semeada a lista
// cabia na tela, então não havia salto para medir — e o clique APROVAVA um
// pedido de verdade, consumindo o único que `implantacao.mjs` precisa encontrar
// em triagem. Um caso que não mede nada e ainda quebra a suíte seguinte é pior
// que caso nenhum. Os dois acima já exercitam o mecanismo em telas longas de
// verdade; se um dia a triagem crescer, é o lugar natural para voltar.
//
// A reposição é para a AÇÃO que devolve à mesma tela. Trocar de tela por um
// link é chegar noutro lugar, e chegar no meio dele seria o defeito oposto.
console.log('\n5. Navegar por link ainda começa no topo');
{
  await p.goto(`${BASE}/gerar?${COMP}&etapa=revisar`, { waitUntil: 'networkidle' });
  await p.evaluate(() => window.scrollTo(0, 1200));
  await p.waitForTimeout(200);
  await p.locator('a[href*="/parametros"]').first().click();
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(600);
  const y = await p.evaluate(() => window.scrollY);
  conferir(y < 100, `a tela nova abriu no começo (${y})`);
}

conferir(erros.length === 0, `nenhum erro de JS (${erros.join('; ') || 'limpo'})`);

await b.close();
await banco.end();
console.log(falhas === 0 ? '\n>>> ROLAGEM OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
