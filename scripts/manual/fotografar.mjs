/**
 * Fotografa as telas do sistema para o manual.
 *
 * Roda contra o dev server apontado para `supabase-pg.mjs` (ver README deste
 * diretório). Cada foto é de tela real com dados reais — nada é montado à mão,
 * porque uma imagem inventada num manual é pior do que nenhuma imagem.
 *
 * O papel da pessoa logada é trocado escrevendo em /tmp/foto-usuario.json, que
 * o shim relê a cada consulta. Assim as três visões saem sem reiniciar o app.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import pg from 'pg';

const db = new pg.Pool({ host: '/tmp', port: 5433, user: 'postgres', database: 'manual' });

const BASE = process.env.BASE || 'http://localhost:3000';
const SAIDA = process.env.SAIDA || 'docs/imagens';
const COMP = 'competencia=2026-11-01';

const PAPEIS = {
  ana:     { id: '00000000-0000-0000-0000-000000000001', email: 'ana.ribeiro@saolucas.com' },
  ricardo: { id: '00000000-0000-0000-0000-000000000002', email: 'ricardo.matos@saolucas.com' },
  felipe:  { id: '00000000-0000-0000-0000-000000000003', email: 'felipe.souza@saolucas.com' },
};

/**
 * Uma foto. `recorte` é um seletor: quando informado, fotografa só aquele
 * pedaço da tela — é o que faz um bloco de Parâmetros ou o sino de
 * notificações caberem legíveis na página do manual, em vez de virarem um
 * detalhe minúsculo numa captura de página inteira.
 */
async function foto(pagina, nome, url, { recorte, antes, inteira = true, janela } = {}) {
  const padrao = pagina.viewportSize();
  if (janela) await pagina.setViewportSize(janela);
  await pagina.goto(BASE + url, { waitUntil: 'networkidle' });
  if (antes) await antes(pagina);
  await pagina.waitForTimeout(350);

  const alvo = recorte ? pagina.locator(recorte).first() : pagina;
  if (recorte && (await alvo.count()) === 0) {
    throw new Error(`recorte "${recorte}" não existe em ${url} — a foto sairia errada`);
  }

  const opcoes = { path: `${SAIDA}/${nome}.png` };
  if (!recorte) opcoes.fullPage = inteira;
  await alvo.screenshot(opcoes);
  if (janela) await pagina.setViewportSize(padrao);
  console.log('  ✓', nome);
}

const roteiro = [];

// ── Planejamento (Ana) — é quem opera o sistema inteiro ──────────────
roteiro.push(['ana', async p => {
  await foto(p, 'inicio', `/?${COMP}`);

  // O painel do sino é `position: absolute`, então a caixa do `<details>` não o
  // contém — fotografar o `<details>` renderia só o ícone. O alvo é o painel.
  await foto(p, 'notificacoes', `/?${COMP}`, {
    recorte: 'header details[open] > div',
    antes: async pg => {
      await pg.locator('summary[aria-label^="Notifica"]').first().click();
      await pg.waitForTimeout(250);
    },
  });

  await foto(p, 'colaboradores', '/colaboradores');
  await foto(p, 'colaborador-editar', '/colaboradores?id=2', { recorte: '#editor-colaborador' });
  await foto(p, 'colaborador-inativar', '/colaboradores?id=2', {
    recorte: '#editor-colaborador',
    antes: async pg => {
      await pg.selectOption('#editor-colaborador select[name="ativo"]', '0');
      await pg.waitForTimeout(200);
      await pg.selectOption('#editor-colaborador select[name="motivoStatus"]', 'DESLIGAMENTO');
      await pg.waitForTimeout(200);
    },
  });

  await foto(p, 'parametros-unidades', '/parametros?aba=unidades', { recorte: '#bloco-unidades' });
  await foto(p, 'parametros-capacidade', '/parametros?aba=unidades', { recorte: '#bloco-capacidade' });
  await foto(p, 'parametros-cotas', '/parametros?aba=unidades', { recorte: '#bloco-cotas' });
  await foto(p, 'parametros-postos', '/parametros?aba=unidades', { recorte: '#bloco-postos' });
  await foto(p, 'parametros-motor', '/parametros?aba=unidades', { recorte: '#bloco-motor' });
  await foto(p, 'parametros-equipes', '/parametros?aba=equipes', { recorte: '#bloco-equipes' });
  await foto(p, 'parametros-feriados', '/parametros?aba=feriados', { recorte: '#bloco-feriados' });
  await foto(p, 'parametros-precedencia', '/parametros?aba=motor');
  await foto(p, 'parametros-auditoria', '/parametros?aba=auditoria');

  await foto(p, 'planos-lista', `/planos?${COMP}`);
  await foto(p, 'plano-felipe', `/planos?${COMP}&colab=1`, { recorte: '#editor-plano' });
  await foto(p, 'plano-carla', `/planos?${COMP}&colab=2`, { recorte: '#editor-plano' });
  await foto(p, 'plano-helena', `/planos?${COMP}&colab=8`, { recorte: '#editor-plano' });
  await foto(p, 'plano-ausencias', `/planos?${COMP}&colab=4`, { recorte: '#ausencias' });

  await foto(p, 'gerar', `/gerar?${COMP}`);
  await foto(p, 'calendario-mes', `/calendario?${COMP}`);
  await foto(p, 'calendario-grade', `/calendario?${COMP}&vista=grade`, { janela: { width: 2100, height: 1320 } });
  await foto(p, 'calendario-dia', `/calendario?${COMP}&vista=dia&dia=2026-11-09`);
  await foto(p, 'ocorrencia', `/calendario?${COMP}&vista=dia&dia=2026-11-09`, {
    recorte: 'table',
    antes: async pg => {
      await pg.locator('button:text("Lançar ocorrência")').nth(4).click();
      await pg.locator('form:has(button:text("Registrar")) select[name="tipo"]').first().selectOption('SAIDA_ANTEC');
      await pg.waitForTimeout(300);
    },
  });
  await foto(p, 'calendario-filtro', `/calendario?${COMP}&q=felipe`);
  await foto(p, 'ocupacao', `/ocupacao?${COMP}&dia=2026-11-09`);
  await foto(p, 'solicitacoes-planejamento', '/solicitacoes');
  await foto(p, 'usuarios', '/usuarios');
}]);

// ── Um conflito de verdade, para o manual poder mostrar como ele aparece ──
//
// A massa foi montada para gerar novembro limpo, o que é o estado normal e o
// que as outras fotos mostram. Mas o capítulo de pendências precisa de uma
// tela com pendência, e desenhar uma à mão seria inventar. Então o roteiro
// cria um choque real — Gustavo tem home office fixo na quarta, e a quarta vai
// virar unidade fixa —, fotografa, e desfaz.
roteiro.push(['ana', async p => {
  const { rows } = await db.query(
    `select id from planos where competencia = '2026-11-01' and colaborador_id = 7`);
  const plano = rows[0].id;
  await db.query(`insert into plano_unidade_fixa (plano_id, dow, unidade_id) values ($1, 3, 1)`, [plano]);
  try {
    await foto(p, 'planos-pendencia', `/planos?${COMP}&pendentes=1`);
    await foto(p, 'gerar-bloqueado', `/gerar?${COMP}`);
  } finally {
    await db.query(`delete from plano_unidade_fixa where plano_id = $1 and dow = 3`, [plano]);
  }
}]);

// ── Gestor (Ricardo) — aprova o que o Planejamento encaminha ─────────
roteiro.push(['ricardo', async p => {
  await foto(p, 'gestor-inicio', `/?${COMP}`);
  await foto(p, 'gestor-solicitacoes', '/solicitacoes');
  await foto(p, 'gestor-calendario', `/calendario?${COMP}`);
}]);

// ── Colaborador (Felipe) — vê a própria escala e pede coisas ─────────
roteiro.push(['felipe', async p => {
  await foto(p, 'minha-escala', `/minha-escala?${COMP}`);
  await foto(p, 'colaborador-solicitacoes', '/solicitacoes');
  await foto(p, 'pedido-ferias', `/minha-escala?${COMP}`, {
    recorte: 'form:has(button:text("Enviar solicitação"))',
    antes: async pg => {
      await pg.selectOption('select[name="tipo"]', 'FERIAS');
      await pg.waitForTimeout(250);
      await pg.selectOption('select[name="opcaoFerias"]', '20+10A');
      await pg.fill('input[name="data"]', '2027-01-04');
      await pg.waitForTimeout(300);
    },
  });
}]);

// O formato dos campos <input type="date"> e <input type="time"> segue o idioma
// do NAVEGADOR, não o `locale` do contexto: sem isto o Chromium desenha
// mm/dd/yyyy e 08:00 AM, e o manual mostraria data e hora no formato errado.
// `--lang` sozinho não basta — o LANG do processo é o que decide.
const navegador = await chromium.launch({
  args: ['--lang=pt-BR'],
  env: { ...process.env, LANG: 'pt_BR.UTF-8', LANGUAGE: 'pt_BR' },
});
mkdirSync(SAIDA, { recursive: true });

for (const [papel, cenas] of roteiro) {
  console.log(`\n${papel}:`);
  writeFileSync('/tmp/foto-usuario.json', JSON.stringify(PAPEIS[papel]));

  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'light',
  });
  const pagina = await contexto.newPage();
  pagina.on('console', m => { if (m.type() === 'error') console.log('    [console]', m.text()); });
  await cenas(pagina);
  await contexto.close();
}

await navegador.close();
await db.end();
console.log('\nfotos em', SAIDA);
