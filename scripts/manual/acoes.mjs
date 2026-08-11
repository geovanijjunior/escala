/**
 * Exercita cada ação de escrita com dados válidos e confere que ela gravou.
 *
 * O critério é duplo: nenhuma faixa de erro na tela E a linha correspondente no
 * banco. Só olhar a tela deixaria passar a ação que redireciona feliz sem ter
 * escrito nada.
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import pg from 'pg';

// Semeia antes de começar. Sem isto o roteiro só passa na primeira execução: a
// segunda encontra os códigos que ela mesma cadastrou e acusa 13 falhas que são
// dela. Suíte que só roda uma vez não serve para regressão.
execFileSync('npx', ['tsx', 'scripts/manual/semear.ts'], {
  stdio: 'ignore',
  env: { ...process.env, PGDATABASE: process.env.PGDATABASE || 'manual' },
});

const db = new pg.Pool({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.PGDATABASE || 'manual' });
const BASE = process.env.BASE || 'http://localhost:3000';
const COMP = 'competencia=2026-11-01';
const como = id => writeFileSync('/tmp/foto-usuario.json', JSON.stringify({ id, email: 'x@x' }));
const ANA = '00000000-0000-0000-0000-000000000001';
const RICARDO = '00000000-0000-0000-0000-000000000002';
const FELIPE = '00000000-0000-0000-0000-000000000003';

const b = await chromium.launch({ args: ['--lang=pt-BR'], env: { ...process.env, LANG: 'pt_BR.UTF-8' } });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'pt-BR' });
const p = await ctx.newPage();
let falhas = 0;

const conta = async sql => Number((await db.query(sql)).rows[0].c);

/**
 * Roda uma ação e confere tela + banco.
 *
 * A conferência insiste por alguns segundos em vez de olhar uma vez depois de
 * uma espera fixa. A espera fixa dava dois danos: acusava falha em ação que só
 * demorou mais que o combinado, e — pior — devolvia o controle com a
 * requisição ainda em voo, de modo que o `como()` seguinte trocava o usuário
 * embaixo dela e a gravação saía com o nome errado. Passei um tempo atrás de
 * um bug de permissão que era só isto.
 */
async function acao(nome, url, passos, sql, esperado) {
  const antes = sql ? await conta(sql) : null;
  await p.goto(BASE + url, { waitUntil: 'networkidle' });
  await p.waitForTimeout(200);
  try { await passos(p); } catch (e) {
    falhas++; console.log(`  ERRO  ${nome.padEnd(34)} não consegui operar: ${String(e).split('\n')[0].slice(0, 90)}`);
    return;
  }
  await p.waitForLoadState('networkidle');

  const bateu = d => esperado === undefined ? d > antes : d === esperado;
  let depois = null;
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(150);
    if (sql === null) break;
    depois = await conta(sql);
    if (bateu(depois)) break;
  }

  const faixa = await p.evaluate(() => {
    const el = [...document.querySelectorAll('[role="status"]')].find(e => /rose|--rose/.test(e.getAttribute('style') || ''));
    return el ? el.textContent.trim() : null;
  });
  const gravou = sql === null || bateu(depois);

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

// O lançamento virou um botão por linha, com campos que mudam pelo tipo.
await acao('ocorrência: atraso', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await p.locator('button:text("Lançar ocorrência")').first().click();
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('ATRASO');
  await f.locator('input[name="minutos"]').fill('20');
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='ATRASO'");

await acao('ocorrência: falta com dias', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await p.locator('button:text("Lançar ocorrência")').first().click();
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('FALTA_J');
  await f.locator('input[name="dias"]').fill('3');
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='FALTA_J' and dias = 3");

await acao('ocorrência: saída antecipada', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await p.locator('button:text("Lançar ocorrência")').first().click();
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('SAIDA_ANTEC');
  await f.locator('input[name="horaSaida"]').fill('15:00');
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='SAIDA_ANTEC' and minutos = 120");

await acao('ocorrência: troca com parceiro', `/calendario?${COMP}&vista=dia&dia=2026-11-12`, async p => {
  await p.locator('button:text("Lançar ocorrência")').first().click();
  const f = p.locator('form:has(button:text("Registrar"))').first();
  await f.locator('select[name="tipo"]').selectOption('TROCA');
  await f.locator('select[name="parceiroId"]').selectOption({ index: 1 });
  await f.locator('button:text("Registrar")').click();
}, "select count(*) c from ocorrencias where tipo='TROCA' and parceiro_id is not null");

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

// ── Mural ─────────────────────────────────────────────────────
// Anexos de mentira, mas com o cabeçalho de verdade: o CHECK da tabela e o
// filtro do formulário olham o MIME, e um arquivo vazio não exercita o bytea.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');

como(ANA);
await acao('publicarComunicado (com anexos)', '/mural', async p => {
  await p.fill('input[name="titulo"]', 'Manutenção do ar-condicionado');
  await p.fill('textarea[name="corpo"]', 'O Morumbi fica sem climatização na quinta pela manhã.');
  await p.selectOption('select[name="publico"]', 'colaboradores');
  await p.setInputFiles('input[name="anexos"]', [
    { name: 'aviso.png', mimeType: 'image/png', buffer: PNG },
    { name: 'circular.pdf', mimeType: 'application/pdf', buffer: PDF },
  ]);
  await p.click('button:text("Publicar comunicado")');
}, "select count(*) c from comunicado_anexos", 2);

// O anexo tem que voltar byte a byte: bytea que passa pelo hex errado vira um
// PNG que o navegador recusa, e a tela não denuncia nada.
{
  const { rows } = await db.query(
    "select id, tamanho, octet_length(conteudo) real, tipo from comunicado_anexos order by id");
  const ruim = rows.find(r => Number(r.tamanho) !== Number(r.real));
  if (ruim) { falhas++; console.log(`  FALHOU anexo íntegro no banco            #${ruim.id}: ${ruim.tamanho} enviados, ${ruim.real} gravados`); }
  else {
    const r = await p.request.get(`${BASE}/mural/anexo/${rows[0].id}`);
    const corpo = Buffer.from(await r.body());
    const ok = r.status() === 200 && corpo.length === Number(rows[0].tamanho)
      && r.headers()['content-type'] === rows[0].tipo;
    if (!ok) { falhas++; console.log(`  FALHOU rota do anexo                     ${r.status()} ${corpo.length}B, esperado ${rows[0].tamanho}B ${rows[0].tipo}`); }
    else console.log(`  ok     rota do anexo                     ${corpo.length}B ${rows[0].tipo}`);
  }
}

await acao('publicarComunicado (gestores)', '/mural', async p => {
  await p.fill('input[name="titulo"]', 'Fechamento do mês');
  await p.fill('textarea[name="corpo"]', 'Enviem os ajustes até sexta.');
  await p.selectOption('select[name="publico"]', 'gestores');
  await p.click('button:text("Publicar comunicado")');
}, "select count(*) c from comunicados where publico='gestores'", 1);

// Comunicado para gestores não pode aparecer para colaborador: é aqui que a
// policy vale ou não vale, e a consulta da tela não repete o filtro.
como(FELIPE);
{
  await p.goto(`${BASE}/mural`, { waitUntil: 'networkidle' });
  const texto = await p.evaluate(() => document.body.innerText);
  const vazou = /Fechamento do mês/.test(texto);
  const viuOSeu = /Manutenção do ar-condicionado/.test(texto);
  if (vazou || !viuOSeu) {
    falhas++;
    console.log(`  FALHOU recorte do mural p/ colaborador    ${vazou ? 'viu o comunicado dos gestores' : 'não viu o comunicado da equipe dele'}`);
  } else console.log('  ok     recorte do mural p/ colaborador');
}

// O gestor publica para a equipe; o seletor de público nem aparece para ele.
como(RICARDO);
await acao('gestor publica p/ a equipe', '/mural', async p => {
  await p.fill('input[name="titulo"]', 'Reunião de time na terça');
  await p.fill('textarea[name="corpo"]', 'Sala 3, às 9h.');
  await p.click('button:text("Publicar comunicado")');
}, "select count(*) c from comunicados where autor_nome = 'Ricardo Matos'", 1);

{
  const { rows } = await db.query(
    "select publico, equipe_id from comunicados where autor_nome = 'Ricardo Matos'");
  const errado = rows.find(r => r.publico !== 'colaboradores' || r.equipe_id === null);
  if (errado) { falhas++; console.log(`  FALHOU gestor preso à própria equipe     publico=${errado.publico} equipe=${errado.equipe_id}`); }
  else console.log('  ok     gestor preso à própria equipe');
}

// ── Alteração de escala publicada avisa quem depende dela ─────
// A regeração lá em cima deixou a versão nova em rascunho, e rascunho não
// avisa ninguém de propósito. Publicar aqui é o que põe o cenário em pé.
como(ANA);
await acao('publicar para a equipe', `/calendario?${COMP}`, async p => {
  await p.click('button:text("Publicar para a equipe")');
}, "select count(*) c from geracoes where atual and status='publicada'", 1);

await acao('mover avisando só os afetados', `/calendario?${COMP}&vista=dia&dia=2026-11-17`, async p => {
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption('HOME');
  await f.locator('select[name="alcance"]').selectOption('afetados');
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from avisos where rota like '%2026-11-17%'");

const soAfetados = await conta("select count(*) c from avisos where rota like '%2026-11-17%'");
await acao('mover avisando a escala toda', `/calendario?${COMP}&vista=dia&dia=2026-11-18`, async p => {
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption('HOME');
  await f.locator('select[name="alcance"]').selectOption('todos');
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from avisos where rota like '%2026-11-18%'");

{
  const todos = await conta("select count(*) c from avisos where rota like '%2026-11-18%'");
  if (todos <= soAfetados) {
    falhas++;
    console.log(`  FALHOU "todos" avisa mais que "afetados"  afetados=${soAfetados}, todos=${todos}`);
  } else console.log(`  ok     "todos" avisa mais que "afetados"  ${soAfetados} → ${todos}`);
}

// O gestor também altera depois de publicada, e o log fica para os dois.
como(RICARDO);
await acao('gestor move escala publicada', `/calendario?${COMP}&vista=dia&dia=2026-11-19`, async p => {
  const f = p.locator('form:has(button:text("Mover"))').first();
  await f.locator('select[name="destino"]').selectOption('HOME');
  await f.locator('button:text("Mover")').click();
}, "select count(*) c from logs where acao = 'Alocação ajustada'");

// ── Remoção ───────────────────────────────────────────────────
como(ANA);
await acao('removerComunicado', '/mural', async p => {
  await p.locator('button:text("Remover")').first().click();
}, "select count(*) c from comunicados", 2);

await b.close();
await db.end();
console.log(falhas ? `\n${falhas} ação(ões) com problema` : '\ntodas as ações gravaram sem erro');
