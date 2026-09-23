import type { FastifyInstance } from 'fastify';
import { listar, resumo } from '../controllers/colaboradores.ts';
import { exigirSessao } from '../middlewares/sessao.ts';

/**
 * As rotas de colaboradores.
 *
 * `exigirSessao` entra como `onRequest` de cada rota, e não como uma conferência
 * dentro do controlador: a rota que alguém esquecer de proteger tem de ser
 * visível AQUI, numa linha, e não escondida no meio de um arquivo de regras.
 */
export async function rotasDeColaboradores(app: FastifyInstance) {
  app.get('/colaboradores', { onRequest: exigirSessao }, listar);
  app.get('/colaboradores/resumo', { onRequest: exigirSessao }, resumo);
}
