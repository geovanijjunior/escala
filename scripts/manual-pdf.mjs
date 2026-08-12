/**
 * Gera docs/manual.pdf a partir de docs/manual.html.
 *
 *   node scripts/manual-pdf.mjs
 *
 * O PDF sai do mesmo arquivo que a versão web, então os dois nunca divergem —
 * o que muda entre eles é só o bloco `@media print` do próprio manual.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Playwright não é dependência do projeto: ele arrasta um navegador inteiro, e
// o manual é gerado de vez em quando, não a cada build. Quem precisa regenerar
// instala na hora. Sem isto, o erro seria um ERR_MODULE_NOT_FOUND cru.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error(
    'Falta o Playwright, que este script usa para imprimir a página.\n' +
    '  npm i -D playwright && npx playwright install chromium\n\n' +
    'Alternativa sem instalar nada: abra docs/manual.html no navegador e' +
    ' imprima em PDF (Ctrl+P). O CSS de impressão já está preparado.'
  );
  process.exit(1);
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// `CHROMIUM_EXECUTAVEL` aponta um Chromium já instalado. Em CI e em containers
// prontos ele existe, mas quase nunca na build exata que o Playwright espera —
// e o erro que sai daí pede um download que não é necessário. Mesma variável de
// scripts/manual/navegador.mjs.
const executavel = process.env.CHROMIUM_EXECUTAVEL;
const navegador = await chromium.launch(executavel ? { executablePath: executavel } : {});
// colorScheme claro à força: quem gera num sistema em tema escuro receberia um
// PDF de fundo preto, que não é o que se manda para a impressora.
const pagina = await navegador.newPage({ colorScheme: 'light' });

await pagina.goto(`file://${raiz}/docs/manual.html`, { waitUntil: 'load' });
await pagina.emulateMedia({ media: 'print', colorScheme: 'light' });

await pagina.pdf({
  path: `${raiz}/docs/manual.pdf`,
  format: 'A4',
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: `
    <div style="width:100%;font-family:system-ui,sans-serif;font-size:7.5pt;color:#5A6A80;
                padding:0 15mm;display:flex;justify-content:space-between;">
      <span>Escala &middot; Manual de operação</span>
      <span style="font-variant-numeric:tabular-nums;">
        <span class="pageNumber"></span> / <span class="totalPages"></span>
      </span>
    </div>`,
  margin: { top: '16mm', bottom: '18mm', left: '15mm', right: '15mm' },
});

await navegador.close();
console.log('docs/manual.pdf gerado');
