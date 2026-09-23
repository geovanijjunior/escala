/**
 * As variáveis de ambiente, lidas e conferidas uma vez só, na partida.
 *
 * O servidor RECUSA subir com configuração faltando, e é de propósito. A
 * alternativa — ler `process.env.X` no ponto de uso — adia o erro para o
 * primeiro visitante que percorre aquele caminho: o deploy sobe verde, e a
 * falta do segredo do SSO só aparece quando alguém tenta entrar, como um 500
 * sem relação aparente com configuração. Aqui a implantação errada não sobe.
 *
 * Nenhum valor tem padrão de produção. Um `CHAVE_SECRETA` com valor de fábrica
 * é o tipo de conveniência que sobrevive até a produção e vira incidente.
 */

export interface Ambiente {
  porta: number;
  ambiente: 'desenvolvimento' | 'homologacao' | 'producao';
  urlDoFrontend: string;
  bancoUrl: string;
  sso: {
    emissor: string;
    clienteId: string;
    clienteSegredo: string;
    redirecionamento: string;
  };
  sessao: {
    /** Duração da sessão, em horas. */
    horas: number;
    cookieSeguro: boolean;
    /**
     * Assina os cookies de curta duração do login (o estado do PKCE). Sem
     * assinatura, quem editasse aquele cookie escolheria o `nonce` conferido
     * logo depois — e a conferência passaria a validar o que o atacante
     * mandou contra o que o atacante mandou.
     */
    chaveDeAssinatura: string;
  };
}

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor || !valor.trim()) {
    throw new Error(
      `Variável de ambiente ${nome} não está definida. `
      + 'Veja backend/.env.exemplo para a lista completa.',
    );
  }
  return valor.trim();
}

/**
 * Uma chave que serve para assinar.
 *
 * O tamanho mínimo não é formalidade: uma chave de oito caracteres é
 * adivinhável por força bruta em tempo trivial, e quem a adivinha forja os
 * cookies que ela protege. Trinta e dois caracteres é o piso de quem gera com
 * `openssl rand -base64 32`, que é o que o README manda fazer.
 */
function chaveForte(nome: string): string {
  const valor = obrigatoria(nome);
  if (valor.length < 32) {
    throw new Error(`${nome} tem ${valor.length} caracteres; use ao menos 32. Gere com: openssl rand -base64 32`);
  }
  return valor;
}

function numero(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (!bruto) return padrao;
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Variável de ambiente ${nome} precisa ser um número positivo; veio "${bruto}".`);
  }
  return n;
}

export function lerAmbiente(): Ambiente {
  const ambiente = (process.env.NODE_ENV_APP ?? 'desenvolvimento') as Ambiente['ambiente'];
  if (!['desenvolvimento', 'homologacao', 'producao'].includes(ambiente)) {
    throw new Error(`NODE_ENV_APP inválido: "${ambiente}". Use desenvolvimento, homologacao ou producao.`);
  }

  const emissor = obrigatoria('SSO_EMISSOR').replace(/\/+$/, '');
  // Um emissor em http:// leva o token de identidade por um canal que qualquer
  // intermediário lê. Em desenvolvimento local pode ser preciso; em qualquer
  // outro lugar é erro de configuração, não escolha.
  if (ambiente !== 'desenvolvimento' && !emissor.startsWith('https://')) {
    throw new Error(`SSO_EMISSOR precisa ser https fora de desenvolvimento; veio "${emissor}".`);
  }

  return {
    porta: numero('PORTA', 3333),
    ambiente,
    urlDoFrontend: obrigatoria('URL_DO_FRONTEND').replace(/\/+$/, ''),
    bancoUrl: obrigatoria('DATABASE_URL'),
    sso: {
      emissor,
      clienteId: obrigatoria('SSO_CLIENTE_ID'),
      clienteSegredo: obrigatoria('SSO_CLIENTE_SEGREDO'),
      redirecionamento: obrigatoria('SSO_REDIRECIONAMENTO'),
    },
    sessao: {
      horas: numero('SESSAO_HORAS', 8),
      // Cookie sem `Secure` viaja em texto aberto se alguém acessar por http.
      // Só desenvolvimento local justifica.
      cookieSeguro: ambiente !== 'desenvolvimento',
      chaveDeAssinatura: chaveForte('CHAVE_DE_ASSINATURA'),
    },
  };
}
