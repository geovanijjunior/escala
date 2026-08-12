import { chromium } from 'playwright';

/**
 * Abre o Chromium para os roteiros de captura e de varredura.
 *
 * Existe por causa de um detalhe que já custou meia hora: o Playwright só
 * aceita o Chromium da build exata que a versão dele espera, e ambientes de CI
 * costumam trazer um Chromium pronto de outra build. O erro que sai daí —
 * "Executable doesn't exist at .../chromium_headless_shell-1234" seguido de
 * "run npx playwright install" — parece pedir um download, mas o navegador está
 * instalado; é só a build que não bate. `CHROMIUM_EXECUTAVEL` aponta o binário
 * existente e resolve, sem baixar nada e sem prender o repositório a um caminho
 * de container.
 *
 * Sem a variável, o comportamento é o de sempre: o Chromium do próprio
 * Playwright.
 */
export function abrirNavegador(opcoes = {}) {
  const executavel = process.env.CHROMIUM_EXECUTAVEL;
  return chromium.launch({ ...opcoes, ...(executavel ? { executablePath: executavel } : {}) });
}
