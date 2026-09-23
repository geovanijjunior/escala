import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Ambiente } from '../config/ambiente.ts';
import { AcessoNegado, type ServicoAutenticacao } from '../services/autenticacao.ts';
import { ErroSso, gerarPkce, gerarValorUnico, type ServicoSso } from '../services/sso.ts';
import * as sessoes from '../repositories/sessoes.ts';

/**
 * A entrada e a saída das requisições de login.
 *
 * O controlador não decide nada sobre acesso: ele lê o pedido, chama o serviço
 * e monta a resposta. A regra de quem entra está em `services/autenticacao.ts`,
 * e é lá que se olha quando alguém pergunta por que fulano não consegue entrar.
 */

const COOKIE_SESSAO = 'jornada_sessao';
const COOKIE_LOGIN = 'jornada_login';
/** O ida-e-volta ao provedor leva segundos; dez minutos cobrem quem se distrai. */
const MINUTOS_DO_LOGIN = 10;

interface EstadoDoLogin {
  estado: string;
  nonce: string;
  verificador: string;
  /** Para onde levar a pessoa depois de entrar. */
  destino: string;
}

export class ControladorAutenticacao {
  constructor(
    private readonly amb: Ambiente,
    private readonly sso: ServicoSso,
    private readonly auth: ServicoAutenticacao,
  ) {}

  /**
   * Começa o login: monta o desafio e manda a pessoa ao provedor.
   *
   * `estado`, `nonce` e `verificador` nascem aqui e vão num cookie assinado e
   * de vida curta — precisam sobreviver ao desvio até o Keycloak e voltar, e
   * não podem ser escolhidos por quem chega.
   */
  entrar = async (req: FastifyRequest, resp: FastifyReply) => {
    const { verificador, desafio } = gerarPkce();
    const estado: EstadoDoLogin = {
      estado: gerarValorUnico(),
      nonce: gerarValorUnico(),
      verificador,
      destino: destinoInterno((req.query as { destino?: string })?.destino),
    };

    resp.setCookie(COOKIE_LOGIN, JSON.stringify(estado), {
      ...this.opcoesDeCookie(),
      maxAge: MINUTOS_DO_LOGIN * 60,
      signed: true,
    });

    try {
      const url = await this.sso.urlDeAutorizacao({
        estado: estado.estado,
        nonce: estado.nonce,
        desafio,
      });
      return resp.redirect(url);
    } catch (e) {
      // O provedor fora do ar não pode virar uma página de erro do Fastify com
      // pilha de chamadas: quem clicou em "Entrar" é uma pessoa, e o que ela
      // precisa saber é que o problema não é dela.
      req.log.error({ err: e }, 'não foi possível montar a ida ao provedor');
      return this.voltarComErro(
        resp,
        'O login corporativo está indisponível no momento. Tente de novo em alguns minutos.',
      );
    }
  };

  /**
   * O retorno do provedor.
   *
   * Sempre termina num desvio para o frontend — com sessão aberta, ou com o
   * motivo da recusa na barra de endereços. Devolver JSON aqui não serviria:
   * quem chega neste endereço é o navegador voltando de outro site, não o
   * nosso código.
   */
  retorno = async (req: FastifyRequest, resp: FastifyReply) => {
    const q = req.query as { code?: string; state?: string; error?: string; error_description?: string };
    const bruto = req.cookies[COOKIE_LOGIN];
    resp.clearCookie(COOKIE_LOGIN, this.opcoesDeCookie());

    // O provedor recusou — a pessoa cancelou, ou o MFA falhou.
    if (q.error) {
      req.log.warn({ erro: q.error, detalhe: q.error_description }, 'provedor recusou o login');
      return this.voltarComErro(resp, 'Não foi possível entrar pelo login corporativo.');
    }

    const estado = this.lerEstado(req, bruto);
    if (!estado) {
      return this.voltarComErro(resp, 'Sua tentativa de login expirou. Tente de novo.');
    }

    // Sem esta comparação, um link montado por terceiro faria o navegador de
    // quem clicasse concluir um login com o código do atacante — e a vítima
    // passaria a operar o sistema dentro da conta dele, achando que é a sua.
    if (!q.state || q.state !== estado.estado) {
      req.log.warn('estado do login não confere');
      return this.voltarComErro(resp, 'Sua tentativa de login não confere. Tente de novo.');
    }

    if (!q.code) return this.voltarComErro(resp, 'O provedor não devolveu o código de autorização.');

    try {
      const { valorDoCookie } = await this.auth.concluirLogin({
        codigo: q.code,
        verificador: estado.verificador,
        nonce: estado.nonce,
        ip: req.ip,
        agente: String(req.headers['user-agent'] ?? ''),
      });

      resp.setCookie(COOKIE_SESSAO, valorDoCookie, {
        ...this.opcoesDeCookie(),
        maxAge: this.amb.sessao.horas * 3600,
      });

      return resp.redirect(`${this.amb.urlDoFrontend}${estado.destino}`);
    } catch (e) {
      if (e instanceof AcessoNegado) {
        // Mensagem da pessoa, não do sistema: ela diz o que fazer.
        req.log.info({ motivo: e.motivo }, 'acesso negado no login');
        return this.voltarComErro(resp, e.message);
      }
      if (e instanceof ErroSso) {
        // O detalhe vai para o log de quem investiga, e não para a tela: pode
        // conter configuração do provedor.
        req.log.error({ err: e, causa: e.causa }, 'falha ao falar com o provedor');
        return this.voltarComErro(resp, 'Não foi possível concluir o login corporativo. Tente de novo.');
      }
      throw e;
    }
  };

  /** Quem está na sessão. É o que o frontend pergunta ao carregar. */
  eu = async (req: FastifyRequest, resp: FastifyReply) => {
    const sessao = await sessoes.sessaoValida(req.cookies[COOKIE_SESSAO] ?? '');
    if (!sessao) return resp.code(401).send({ erro: 'Sem sessão.' });
    return resp.send({
      id: sessao.perfilId,
      nome: sessao.nome,
      email: sessao.email,
      papel: sessao.papel,
      contaId: sessao.contaId,
    });
  };

  sair = async (req: FastifyRequest, resp: FastifyReply) => {
    const valor = req.cookies[COOKIE_SESSAO] ?? '';
    if (valor) await this.auth.encerrar(valor);
    resp.clearCookie(COOKIE_SESSAO, this.opcoesDeCookie());
    return resp.send({ ok: true });
  };

  private lerEstado(req: FastifyRequest, bruto: string | undefined): EstadoDoLogin | null {
    if (!bruto) return null;
    const aberto = req.unsignCookie(bruto);
    if (!aberto.valid || !aberto.value) return null;
    try {
      const e = JSON.parse(aberto.value) as EstadoDoLogin;
      return e.estado && e.nonce && e.verificador ? e : null;
    } catch {
      return null;
    }
  }

  private voltarComErro(resp: FastifyReply, mensagem: string) {
    return resp.redirect(`${this.amb.urlDoFrontend}/login?erro=${encodeURIComponent(mensagem)}`);
  }

  private opcoesDeCookie() {
    return {
      path: '/',
      httpOnly: true,
      secure: this.amb.sessao.cookieSeguro,
      // `lax` e não `strict`: o retorno do provedor é uma navegação vinda de
      // outro site, e com `strict` o navegador não mandaria o cookie — o login
      // nunca fecharia. `lax` cobre o CSRF que importa, porque só acompanha
      // navegação de nível superior, nunca requisição de escrita de outro site.
      sameSite: 'lax' as const,
    };
  }
}

/**
 * Para onde voltar depois do login, aceitando só caminho interno.
 *
 * Sem esta conferência o parâmetro `destino` faria o nosso login desviar para
 * qualquer endereço — inclusive uma cópia da nossa tela, hospedada por
 * terceiro, que a pessoa alcançaria logo depois de entrar de verdade e com a
 * confiança de quem acabou de autenticar.
 */
function destinoInterno(bruto: unknown): string {
  const v = String(bruto ?? '');
  return /^\/[a-zA-Z0-9][\w/-]*$/.test(v) ? v : '/';
}

export { COOKIE_SESSAO };
