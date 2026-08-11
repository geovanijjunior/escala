/**
 * Exercita cada ação de escrita com dados válidos e confere que ela gravou.
 *
 * O critério é duplo: nenhuma faixa de erro na tela E a linha correspondente no
 * banco. Só olhar a tela deixaria passar a ação que redireciona feliz sem ter
 * escrito nada.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const db = new pg.Pool({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.PGDATABASE || 'manual' });
const COMP = 'competencia=2026-11-01';
const como = id => writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id, email: 'x@x' }));
const ANA = '00000000-0000-0000-0000-000000000001';
const RICARDO = '00000000-0000-0000-0000-000000000002';

const b = await chromium.launch({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8' } });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const p = await ctx.newPage();
let falhas = 0;

const conta = async sql => Number((await db.query(sql)).rows[0].c);

/** Roda uma ação e confere tela + banco. */
async function acao(nome, url, passos, sql, esperado) {
  const antes = sql ? await conta(sql) : null;
  await p.goto('http://localhost:3000' + url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(200);
  try { await passos(p); } catch (e) {
    falhas++; console.log(`  ERRO  ${nome.padEnd(34)} não consegui operar: ${String(e).split('\n')[0].slice(0, 90)}`);
    return;
  }
  await p.waitForLoadState('networkidle');
  await p.waitForTimeout(400);

  const faixa = await p.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')].find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
    return el ? el.textContent.trim() : null;
  });
  const depois = sql ? await conta(sql) : null;
  const gravou = sql === null || (esperado === undefined ? depois > antes : depois === esperado);

  if (faixa || !gravou) {
    falhas++;
    console.log(`  FALHOU ${nome.padEnd(33)} ${faixa ? 'erro na tela: ' + faixa : `banco não mudou (${antes} → ${depois})`}`);
  } else {
    console.log(`  ok     ${nome.padEnd(33)} ${sql ? `${antes} → ${depois}` : ''}`);
  }
}

como(ANA);

// ── Parâmetros ────────────────────────────────────────────────
await acao('salvarUnidade', '/parametros?aba=unidades', async p => {
  await p.fill('form:has(button:text("Adicionar unidade")) input[name="nome"]', 'Vila Olímpia');
  await p.fill('input[name="codigo"]', 'VLO');
  await p.fill('input[name="sigla"]', 'VLO');
  await p.click('button:text("Adicionar unidade")');
}, "select count(*) c from unidades");

await acao('salvarCapacidade', '/parametros?aba=unidades', async p => {
  const f = p.locator('form:has(button:text("Salvar"))').filter({ has: p.locator('input[name="reservadas"]') }).first();
  await f.locator('label:has-text("Qua") input[type=checkbox]').check();
  await f.locator('input[name="reservadas"]').fill('3');
  await f.locator('button:text("Salvar")').click();
}, "select count(*) c from capacidades");

await acao('salvarCotaEquipe', '/parametros?aba=unidades', async p => {
  const f = p.locator('form:has(button:text("Salvar cota"))');
  await f.locator('select[name="unidadeId"]').selectOption({ index: 1 });
  await f.locator('input[name="limite"]').fill('4');
  await f.locator('button:text("Salvar cota")').click();
}, "select count(*) c from cotas_equipe");

await acao('salvarPosto', '/parametros?aba=unidades', async p => {
  const f = p.locator('form:has(button:text("Adicionar posto"))');
  await f.locator('input[name="nome"]').fill('Pronto Atendimento');
  await f.locator('button:text("Adicionar posto")').click();
}, "select count(*) c from postos");

await acao('salvarParametros', '/parametros?aba=unidades', async p => {
  await p.fill('input[name="tolerancia"]', '4');
  await p.click('button:text("Salvar parâmetros")');
}, "select tolerancia_aderencia c from config", 4);

await acao('salvarEquipe', '/parametros?aba=equipes', async p => {
  const f = p.locator('form:has(button:text("Adicionar equipe"))');
  await f.locator('input[name="nome"]').fill('Infraestrutura');
  await f.locator('input[name="codigo"]').fill('INF');
  await f.locator('button:text("Adicionar equipe")').click();
}, "select count(*) c from equipes");

await acao('salvarFeriado', '/parametros?aba=feriados', async p => {
  const f = p.locator('form:has(button:text("Adicionar feriado"))');
  await f.locator('input[name="data"]').fill('2026-12-25');
  await f.locator('input[name="nome"]').fill('Natal');
  await f.locator('button:text("Adicionar feriado")').click();
}, "select count(*) c from feriados");

// ── Plano do mês ──────────────────────────────────────────────
await acao('salvarPlano', `/planos?${COMP}&colab=3`, async p => {
  // Muda a distribuição para 100% na primeira unidade — dá para conferir no banco.
  const linhas = p.locator('#editor-plano [data-unidade], #editor-plano label:has(button:text("100%"))');
  await p.locator('#editor-plano button:text-is("0%")').nth(1).click();
  await p.locator('#editor-plano button:text-is("100%")').first().click();
  void linhas;
  await p.click('#editor-plano button:text("Salvar plano")');
}, "select percentual c from plano_distribuicao d join planos pl on pl.id = d.plano_id"
 + " where pl.colaborador_id = 3 and pl.competencia = '2026-11-01' and d.unidade_id = 1", 100);

await acao('salvarAusencia (férias)', `/planos?${COMP}&colab=3`, async p => {
  const f = p.locator('form:has(button:text("Lançar férias"))');
  await f.locator('input[name="inicio"]').fill('2026-12-01');
  await f.locator('input[name="fim"]').fill('2026-12-10');
  await f.locator('button:text("Lançar férias")').click();
}, "select count(*) c from ausencias where tipo='FERIAS'");

await acao('salvarAusencia (ausência)', `/planos?${COMP}&colab=5`, async p => {
  const f = p.locator('form:has(button:text("Adicionar ausência"))');
  await f.locator('input[name="inicio"]').fill('2026-11-24');
  await f.locator('button:text("Adicionar ausência")').click();
}, "select count(*) c from ausencias where tipo='AUSENCIA'");

// ── Calendário ────────────────────────────────────────────────
await acao('reposicionarAlocacao', `/calendario?${COMP}&vista=dia&dia=2026-11-10`, async p => {
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption('HOME');
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from alocacoes where travado and data='2026-11-10'");

await acao('alternarTrava', `/calendario?${COMP}&vista=dia&dia=2026-11-11`, async p => {
  await p.locator('button:text("Travar")').first().click();
}, "select count(*) c from alocacoes where travado and data='2026-11-11'");

await acao('registrarOcorrencia', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  const f = p.locator('form:has(button:text("Registrar"))');
  await f.locator('select[name="colaboradorId"]').selectOption({ index: 1 });
  await f.locator('input[name="minutos"]').fill('15');
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias");

// ── Geração ───────────────────────────────────────────────────
await acao('regerar mês completo', `/gerar?${COMP}`, async p => {
  await p.click('button:text("Regerar mês completo")');
}, "select max(versao) c from geracoes where competencia='2026-11-01'", 2);

await acao('regeração parcial', `/gerar?${COMP}`, async p => {
  const f = p.locator('form:has(button:text("Regerar apenas o recorte"))');
  await f.locator('input[type=checkbox]').first().check();
  await f.locator('button:text("Regerar apenas o recorte")').click();
}, "select max(versao) c from geracoes where competencia='2026-11-01'", 3);

// ── Solicitações ──────────────────────────────────────────────
// Cada decisão consome o cartão em triagem, então cada uma abre o seu.
await db.query(`insert into solicitacoes (conta_id, colaborador_id, tipo, data, detalhe, status)
  select c.id, 3, 'TROCA_UNIDADE', '2026-11-19', 'Pedido de teste ' || g, 'TRIAGEM'
  from contas c, generate_series(1, 2) g`);

await acao('decidir: encaminhar', '/solicitacoes', async p => {
  await p.locator('button:text("Encaminhar ao gestor")').first().click();
}, "select count(*) c from solicitacoes where status='GESTOR'", 2);

await acao('decidir: enviar para a fila', '/solicitacoes', async p => {
  await p.locator('button:text("Enviar para a lista de espera")').first().click();
}, "select count(*) c from solicitacoes where status='FILA'");

await acao('decidir: recusar', '/solicitacoes', async p => {
  await p.locator('button:text("Recusar na triagem")').first().click();
  await p.locator('input[name="motivo"]').fill('Sem cobertura na data pedida.');
  await p.locator('button:text("Confirmar recusa")').click();
}, "select count(*) c from solicitacoes where status='RECUSADA'");

como(RICARDO);
await acao('gestor aprova', '/solicitacoes', async p => {
  await p.locator('button:text("Aprovar")').first().click();
}, "select count(*) c from solicitacoes where status='APROVADA'");

// ── Colaboradores ─────────────────────────────────────────────
como(ANA);
await acao('salvarColaborador', '/colaboradores?novo=1', async p => {
  await p.fill('#editor-colaborador input[name="nome"]', 'Paula Rezende');
  await p.fill('#editor-colaborador input[name="matricula"]', '2001');
  await p.selectOption('#editor-colaborador select[name="equipeId"]', { index: 1 });
  await p.selectOption('#editor-colaborador select[name="unidadeBaseId"]', { index: 1 });
  await p.fill('#editor-colaborador input[name="admissao"]', '2026-01-05');
  await p.click('#editor-colaborador button:text("Salvar colaborador")');
}, "select count(*) c from colaboradores");

// ── Usuários ──────────────────────────────────────────────────
como(ANA);
await acao('convidarUsuario', '/usuarios', async p => {
  const f = p.locator('form:has(button:text("Criar acesso"))');
  await f.locator('input[name="nome"]').fill('Paula Rezende');
  await f.locator('input[name="email"]').fill('paula.rezende@saolucas.com');
  await f.locator('button:text("Criar acesso")').click();
}, null);

await b.close();
await db.end();
console.log(falhas ? `\n${falhas} ação(ões) com problema` : '\ntodas as ações gravaram sem erro');
