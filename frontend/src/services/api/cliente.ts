import { configuracao } from '../../config/ambiente';

/**
 * O cliente HTTP da aplicação — `fetch` nativo, como o padrão exige.
 *
 * Nada de Axios: o padrão é explícito, e a razão prática é que `fetch` já faz
 * o que este projeto precisa. O que ele NÃO faz sozinho, e por isso existe
 * este módulo, são três coisas que, repetidas em cada chamada, acabam
 * repetidas de forma diferente em cada chamada:
 *
 *  1. `credentials: 'include'` — sem isso o cookie de sessão não vai junto, e
 *     a API responde 401 para quem está logado. É o esquecimento mais comum, e
 *     o sintoma ("deslogou sozinho") não aponta para a causa;
 *  2. o erro. `fetch` só rejeita quando a rede falha: um 500 chega como uma
 *     resposta normal, e quem não conferir `response.ok` segue adiante tratando
 *     a página de erro como se fossem os dados;
 *  3. o 401, que não é erro de tela — é sessão vencida, e a resposta certa é
 *     levar a pessoa ao login, não mostrar uma faixa vermelha.
 */

export class ErroDaApi extends Error {
  // Campos declarados e atribuídos no corpo, e não como parâmetros do
  // construtor: o `tsconfig` do Vite liga `erasableSyntaxOnly`, que recusa
  // sintaxe que não some ao apagar os tipos — e parâmetro-propriedade GERA
  // código. É o preço de o navegador poder rodar o arquivo sem transpilar.
  readonly status: number;
  /** O corpo da resposta, quando veio em JSON. Para depuração. */
  readonly detalhe?: unknown;

  constructor(status: number, mensagem: string, detalhe?: unknown) {
    super(mensagem);
    this.name = 'ErroDaApi';
    this.status = status;
    this.detalhe = detalhe;
  }
}

/** Sessão vencida ou ausente. Quem chama decide se leva ao login. */
export class SemSessao extends ErroDaApi {
  constructor(mensagem = 'Sua sessão expirou. Entre de novo.') {
    super(401, mensagem);
    this.name = 'SemSessao';
  }
}

type Opcoes = Omit<RequestInit, 'body'> & { corpo?: unknown };

async function pedir<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const { corpo, headers, ...resto } = opcoes;

  let resposta: Response;
  try {
    resposta = await fetch(`${configuracao.urlDaApi}${caminho}`, {
      ...resto,
      // Sem isto o cookie de sessão não acompanha a requisição.
      credentials: 'include',
      headers: {
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch (causa) {
    // Aqui é rede mesmo: servidor fora, DNS, cabo. A mensagem diz isso em vez
    // de "Failed to fetch", que não ajuda ninguém.
    throw new ErroDaApi(0, 'Não foi possível falar com o servidor. Verifique sua conexão.', causa);
  }

  if (resposta.status === 401) throw new SemSessao();

  if (!resposta.ok) {
    const detalhe = await resposta.json().catch(() => null) as { erro?: string } | null;
    throw new ErroDaApi(
      resposta.status,
      detalhe?.erro ?? `O servidor respondeu ${resposta.status}.`,
      detalhe,
    );
  }

  // 204 e 205 não têm corpo; chamar `.json()` neles estoura.
  if (resposta.status === 204 || resposta.status === 205) return undefined as T;

  return await resposta.json() as T;
}

export const api = {
  buscar: <T>(caminho: string) => pedir<T>(caminho),
  criar: <T>(caminho: string, corpo: unknown) => pedir<T>(caminho, { method: 'POST', corpo }),
  alterar: <T>(caminho: string, corpo: unknown) => pedir<T>(caminho, { method: 'PUT', corpo }),
  remover: <T>(caminho: string) => pedir<T>(caminho, { method: 'DELETE' }),
};
