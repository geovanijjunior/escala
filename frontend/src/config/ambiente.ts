/**
 * A configuração da aplicação, lida do ambiente de build do Vite.
 *
 * Centralizada, e conferida na carga: um `VITE_URL_DA_API` esquecido faria
 * todas as chamadas irem para caminhos relativos do próprio frontend, que
 * responderiam o `index.html`. O sintoma é péssimo — nenhum erro de rede, e
 * `JSON.parse` estourando em HTML, o que manda quem investiga procurar defeito
 * no parser.
 *
 * Tudo aqui é PÚBLICO. O Vite embute estas variáveis no pacote que vai para o
 * navegador, então nenhuma delas pode ser segredo — nada de chave de API, nada
 * de client secret. O segredo do SSO vive no backend, e é por isso que a troca
 * do código por token acontece lá.
 */

const urlDaApi = String(import.meta.env.VITE_URL_DA_API ?? '').replace(/\/+$/, '');

if (!urlDaApi) {
  throw new Error(
    'VITE_URL_DA_API não está definida. Copie .env.exemplo para .env e preencha.',
  );
}

export const configuracao = {
  urlDaApi,
  /** `true` só no `npm run dev`; o Vite resolve isto em tempo de build. */
  emDesenvolvimento: import.meta.env.DEV,
} as const;
