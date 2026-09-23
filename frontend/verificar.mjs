/**
 * Confere o frontend novo num navegador de verdade.
 *
 *   node verificar.mjs
 *
 * Existe porque `npm run build` só prova que o TypeScript compila. O que
 * interessa é outra coisa: a tela pinta, a chamada sai com o cookie, o recorte
 * de quem está logado chega até a tabela, e o console fica limpo. Nada disso
 * aparece num build verde — e o erro mais comum desta arquitetura, o
 * `credentials` esquecido, se manifesta como um 401 que a tela mostra como
 * "sessão expirou" para quem acabou de entrar.
 *
 * Variáveis: FRONTEND, API, COOKIE (o valor de sessão, de
 * `backend/scripts/sessao-de-teste.ts`).
 */
import { chromium } from 'playwright';

const FRONTEND = process.env.FRONTEND || 'http://localhost:5173';
const COOKIE = process.env.COOKIE || '';

let falhas = 0;
const conferir = (ok, rotulo) => {
  console.log(`  ${ok ? 'ok' : 'FALHOU'}: ${rotulo}`);
  if (!ok) falhas++;
};

const navegador = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTAVEL || undefined,
});
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
const pagina = await contexto.newPage();

const errosDeJs = [];
pagina.on('pageerror', e => errosDeJs.push(e.message));
pagina.on('console', m => {
  if (m.type() !== 'error') return;
  // O 401 de `/auth/eu` é o caminho previsto de quem ainda não entrou: o
  // navegador registra toda resposta 4xx como erro de console, e contá-lo aqui
  // reprovaria o comportamento correto. Qualquer outro erro conta.
  if (/401 \(Unauthorized\)/.test(m.text())) return;
  errosDeJs.push(m.text());
});

/* ── 1. Sem sessão, a porta é o login ────────────────────────────────── */
console.log('1. Sem sessão');
await pagina.goto(FRONTEND, { waitUntil: 'networkidle' });
const textoDoLogin = await pagina.evaluate(() => document.body.innerText);
conferir(/login corporativo/i.test(textoDoLogin), 'a tela de login aparece');
conferir(
  await pagina.locator('input[type="password"]').count() === 0,
  'e NÃO há campo de senha — a senha corporativa não passa por esta aplicação',
);

/* ── 2. Com sessão, a lista carrega ──────────────────────────────────── */
console.log('\n2. Com sessão');
if (!COOKIE) {
  console.log('  (pulado: sem COOKIE no ambiente)');
} else {
  await contexto.addCookies([{
    name: 'jornada_sessao', value: COOKIE, domain: 'localhost', path: '/',
  }]);
  await pagina.goto(FRONTEND, { waitUntil: 'networkidle' });
  await pagina.waitForTimeout(600);

  const texto = await pagina.evaluate(() => document.body.innerText);
  conferir(/Colaboradores/.test(texto), 'a tela de colaboradores abriu');

  const linhas = await pagina.locator('table tbody tr').count();
  conferir(linhas > 0, `a tabela veio da API com ${linhas} linha(s)`);
  conferir(
    !/Carregando…/.test(texto),
    'e saiu do estado de carregamento — o cookie foi junto na chamada',
  );

  // O filtro do lado do cliente.
  await pagina.locator('input[placeholder*="matrícula"]').fill('zzzzz-nao-existe');
  await pagina.waitForTimeout(250);
  const vazio = await pagina.evaluate(() => document.body.innerText);
  conferir(/Ninguém encontrado/.test(vazio), 'a busca sem resultado explica o vazio em vez de só sumir');

  await pagina.locator('input[placeholder*="matrícula"]').fill('');
  await pagina.waitForTimeout(250);
}

/* ── 3. A paleta institucional chegou à tela ─────────────────────────── */
console.log('\n3. Identidade visual');
const tema = await pagina.evaluate(() => {
  const raiz = getComputedStyle(document.documentElement);
  return {
    primaria: raiz.getPropertyValue('--primaria').trim(),
    fundo: raiz.getPropertyValue('--fundo').trim(),
    corpo: getComputedStyle(document.body).backgroundColor,
  };
});
conferir(tema.primaria.toUpperCase() === '#1A4E93', `o azul principal está aplicado (${tema.primaria})`);
conferir(tema.fundo.toUpperCase() === '#FFFFFF', `o branco predominante está no tema (${tema.fundo})`);

conferir(errosDeJs.length === 0,
  `console sem erro inesperado (${errosDeJs.slice(0, 2).join(' | ') || 'limpo'})`);

await navegador.close();
console.log(falhas === 0 ? '\n>>> FRONTEND OK' : `\n>>> ${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
