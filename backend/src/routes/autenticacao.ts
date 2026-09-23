import type { FastifyInstance } from 'fastify';
import type { ControladorAutenticacao } from '../controllers/autenticacao.ts';

/**
 * As rotas do login. Só expõem e agrupam — nenhuma regra mora aqui.
 */
export function rotasDeAutenticacao(controlador: ControladorAutenticacao) {
  return async function registrar(app: FastifyInstance) {
    app.get('/auth/entrar', controlador.entrar);
    app.get('/auth/retorno', controlador.retorno);
    app.get('/auth/eu', controlador.eu);
    // POST, e não GET: um `GET /auth/sair` é derrubado por qualquer imagem
    // apontando para ele — inclusive num e-mail —, e a pessoa é desconectada
    // sem ter pedido.
    app.post('/auth/sair', controlador.sair);
  };
}
