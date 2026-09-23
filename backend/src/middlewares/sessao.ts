import type { FastifyReply, FastifyRequest } from 'fastify';
import { COOKIE_SESSAO } from '../controllers/autenticacao.ts';
import * as sessoes from '../repositories/sessoes.ts';

/**
 * A sessão de quem pediu, resolvida antes de a rota rodar.
 *
 * Existe como comportamento transversal, e não como uma linha no começo de
 * cada controlador, porque a versão "cada rota resolve a sua" falha de um jeito
 * silencioso: a rota que alguém esquecer de proteger não dá erro — ela
 * responde, e responde a qualquer um.
 */

declare module 'fastify' {
  interface FastifyRequest {
    sessao?: sessoes.SessaoAberta;
  }
}

/** Anexa a sessão quando houver. Não recusa nada — é o `exigirSessao` que recusa. */
export async function carregarSessao(req: FastifyRequest): Promise<void> {
  const valor = req.cookies[COOKIE_SESSAO] ?? '';
  if (!valor) return;
  const sessao = await sessoes.sessaoValida(valor);
  if (sessao && !sessao.bloqueado) req.sessao = sessao;
}

/** Barra quem não tem sessão. */
export async function exigirSessao(req: FastifyRequest, resp: FastifyReply): Promise<void> {
  if (!req.sessao) {
    // 401 e não 403: a diferença importa para o frontend, que leva a pessoa ao
    // login no primeiro caso e mostra "sem permissão" no segundo.
    await resp.code(401).send({ erro: 'Faça login para continuar.' });
  }
}

/**
 * Barra quem tem sessão mas não tem o papel.
 *
 * Devolve um gancho para ser usado junto de `exigirSessao`, na ordem — sem
 * sessão, o papel nem chega a ser perguntado.
 */
export function exigirPapel(...papeis: string[]) {
  return async (req: FastifyRequest, resp: FastifyReply): Promise<void> => {
    if (!req.sessao) {
      await resp.code(401).send({ erro: 'Faça login para continuar.' });
      return;
    }
    if (!papeis.includes(req.sessao.papel)) {
      await resp.code(403).send({ erro: 'Você não tem permissão para esta ação.' });
    }
  };
}
