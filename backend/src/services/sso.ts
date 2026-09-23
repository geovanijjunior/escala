import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Ambiente } from '../config/ambiente.ts';

/**
 * O SSO corporativo, pelo fluxo Authorization Code + PKCE.
 *
 * Por que este fluxo, e não o `grant_type=password` do `curl` que circula por
 * aí: naquele, a nossa tela pede a senha corporativa e a repassa ao provedor.
 * A aplicação passa a ver — e a poder registrar por acidente, num log, num
 * relatório de erro — a senha de rede de todo mundo. É exatamente o que o SSO
 * existe para impedir, e ainda impede o MFA, que acontece na tela do provedor.
 *
 * Aqui a pessoa é levada ao Keycloak, digita a senha LÁ, e volta com um código
 * de uso único que só vale trocado pelo nosso segredo de cliente.
 *
 * O PKCE cobre o trecho que o segredo não cobre: entre o Keycloak e nós, o
 * código viaja pela barra de endereços do navegador, onde fica no histórico e
 * no log de qualquer intermediário. Sem PKCE, quem o pescasse ali poderia
 * trocá-lo por um token. Com PKCE, a troca exige também o `verificador`, que
 * nunca saiu do servidor.
 */

/** O que o provedor publica sobre si. Só os campos que usamos. */
interface Descoberta {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri: string;
  issuer: string;
}

export interface IdentidadeSso {
  /** Identificador estável da pessoa no provedor. Não é o e-mail. */
  sub: string;
  email: string;
  nome: string;
  /** A sessão do lado do provedor, quando ele a informa. */
  sid: string;
}

export interface TokensSso {
  accessToken: string;
  idToken: string;
  refreshToken: string | null;
  expiraEm: number;
}

export class ErroSso extends Error {
  constructor(mensagem: string, readonly causa?: unknown) {
    super(mensagem);
    this.name = 'ErroSso';
  }
}

const base64url = (b: Buffer) => b.toString('base64url');

/**
 * O par do PKCE.
 *
 * O verificador fica no servidor, preso à tentativa de login; o desafio é o
 * hash dele, e é o único que viaja. Quem interceptar o desafio não consegue
 * voltar ao verificador — é o que torna o código roubado inútil.
 */
export function gerarPkce(): { verificador: string; desafio: string } {
  const verificador = base64url(randomBytes(32));
  const desafio = base64url(createHash('sha256').update(verificador).digest());
  return { verificador, desafio };
}

/** Valor de uso único, para `state` e `nonce`. */
export const gerarValorUnico = () => base64url(randomBytes(24));

export class ServicoSso {
  private descoberta: Promise<Descoberta> | null = null;
  private chaves: ReturnType<typeof createRemoteJWKSet> | null = null;

  constructor(private readonly amb: Ambiente) {}

  /**
   * O documento de descoberta do provedor, buscado uma vez e reaproveitado.
   *
   * Buscado, e não escrito à mão na configuração: os endereços de autorização,
   * token e JWKS mudam quando o provedor muda de versão ou de caminho base, e
   * um endereço fixo no nosso código quebraria sem aviso. A promessa é
   * guardada (não o resultado) para que dez requisições simultâneas na partida
   * façam uma busca só.
   */
  private async obterDescoberta(): Promise<Descoberta> {
    if (!this.descoberta) {
      const url = `${this.amb.sso.emissor}/.well-known/openid-configuration`;
      this.descoberta = fetch(url)
        .then(async r => {
          if (!r.ok) throw new ErroSso(`O provedor de identidade respondeu ${r.status} em ${url}.`);
          const d = await r.json() as Descoberta;
          if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri) {
            throw new ErroSso('O documento de descoberta do provedor veio incompleto.');
          }
          return d;
        })
        .catch(e => {
          // Zerado para que a próxima tentativa busque de novo: guardar uma
          // promessa rejeitada deixaria o SSO quebrado até reiniciar o
          // processo, por causa de uma indisponibilidade de um segundo.
          this.descoberta = null;
          throw e instanceof ErroSso ? e : new ErroSso('Não foi possível falar com o provedor de identidade.', e);
        });
    }
    return this.descoberta;
  }

  /** Para onde mandar a pessoa. */
  async urlDeAutorizacao(p: { estado: string; nonce: string; desafio: string }): Promise<string> {
    const d = await this.obterDescoberta();
    const params = new URLSearchParams({
      client_id: this.amb.sso.clienteId,
      redirect_uri: this.amb.sso.redirecionamento,
      response_type: 'code',
      scope: 'openid profile email',
      state: p.estado,
      nonce: p.nonce,
      code_challenge: p.desafio,
      code_challenge_method: 'S256',
    });
    return `${d.authorization_endpoint}?${params}`;
  }

  /** O código que voltou, trocado pelos tokens. */
  async trocarCodigo(codigo: string, verificador: string): Promise<TokensSso> {
    const d = await this.obterDescoberta();
    const corpo = new URLSearchParams({
      grant_type: 'authorization_code',
      code: codigo,
      redirect_uri: this.amb.sso.redirecionamento,
      client_id: this.amb.sso.clienteId,
      client_secret: this.amb.sso.clienteSegredo,
      code_verifier: verificador,
    });

    const r = await fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
    });

    if (!r.ok) {
      // O corpo do erro do provedor traz `error_description`, que costuma ser
      // exato ("Code not valid"). Não vai para a tela — pode conter detalhe de
      // configuração —, mas vai para o log de quem investiga.
      const detalhe = await r.text().catch(() => '');
      throw new ErroSso(`A troca do código falhou (${r.status}). ${detalhe.slice(0, 300)}`);
    }

    const t = await r.json() as {
      access_token: string; id_token: string; refresh_token?: string; expires_in?: number;
    };
    if (!t.id_token) throw new ErroSso('O provedor não devolveu o token de identidade.');

    return {
      accessToken: t.access_token,
      idToken: t.id_token,
      refreshToken: t.refresh_token ?? null,
      expiraEm: t.expires_in ?? 300,
    };
  }

  /**
   * Quem é a pessoa, segundo o token — depois de conferir que o token é mesmo
   * do provedor e é mesmo para nós.
   *
   * Ler as informações sem verificar a assinatura seria aceitar qualquer
   * identidade que alguém digitasse: o token é apenas texto codificado, não
   * cifrado, e qualquer um monta um. A verificação usa a chave pública que o
   * provedor publica, e cobra também emissor, destinatário, validade e o
   * `nonce` — sem o `nonce`, um token legítimo capturado de outra sessão
   * poderia ser reapresentado aqui.
   */
  async identidadeDoToken(idToken: string, nonce: string): Promise<IdentidadeSso> {
    const d = await this.obterDescoberta();
    this.chaves ??= createRemoteJWKSet(new URL(d.jwks_uri));

    let dados: JWTPayload;
    try {
      const r = await jwtVerify(idToken, this.chaves, {
        issuer: d.issuer,
        audience: this.amb.sso.clienteId,
      });
      dados = r.payload;
    } catch (e) {
      throw new ErroSso('O token de identidade não passou na verificação.', e);
    }

    if (dados.nonce !== nonce) {
      throw new ErroSso('O token de identidade veio de outra tentativa de login.');
    }

    const sub = String(dados.sub ?? '');
    const email = String(dados.email ?? '').trim().toLowerCase();
    if (!sub) throw new ErroSso('O token de identidade não trouxe o identificador da pessoa.');
    if (!email) {
      // Sem e-mail não há como ligar quem chegou a quem já está cadastrado na
      // escala, e o primeiro login é justamente esse encontro.
      throw new ErroSso('O token de identidade não trouxe o e-mail. Peça ao time do SSO o escopo "email".');
    }

    return {
      sub,
      email,
      nome: String(dados.name ?? dados.preferred_username ?? email),
      sid: String(dados.sid ?? ''),
    };
  }

  /** Encerra também do lado do provedor, quando ele oferece o endereço. */
  async urlDeSaida(idToken: string): Promise<string | null> {
    const d = await this.obterDescoberta();
    if (!d.end_session_endpoint) return null;
    const params = new URLSearchParams({
      id_token_hint: idToken,
      post_logout_redirect_uri: this.amb.urlDoFrontend,
    });
    return `${d.end_session_endpoint}?${params}`;
  }
}
