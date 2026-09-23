import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { Ambiente } from './config/ambiente.ts';
import { prisma } from './config/prisma.ts';
import { ServicoSso } from './services/sso.ts';
import { ServicoAutenticacao } from './services/autenticacao.ts';
import { ControladorAutenticacao } from './controllers/autenticacao.ts';
import { rotasDeAutenticacao } from './routes/autenticacao.ts';
import { rotasDeColaboradores } from './routes/colaboradores.ts';
import { carregarSessao } from './middlewares/sessao.ts';

/**
 * A montagem da aplicação, separada da subida do processo.
 *
 * `server.ts` lê o ambiente, chama isto e escuta numa porta. Aqui não há
 * `listen`, nem `process.exit`, nem leitura de variável de ambiente — o
 * ambiente CHEGA pronto. É o que permite ao teste montar a mesma aplicação
 * apontada para um provedor de identidade de mentira, sem subir porta nenhuma
 * e sem depender da rede.
 *
 * A montagem é explícita — configuração, serviços, controladores, rotas, nesta
 * ordem — em vez de cada módulo buscar o que precisa. Custa algumas linhas e
 * devolve a possibilidade de trocar o provedor sem procurar quem o importou.
 */
export async function construirApp(amb: Ambiente): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: amb.ambiente === 'producao' ? 'info' : 'debug',
      // O corpo de uma resposta de erro do provedor pode trazer token. Nunca
      // registrar cabeçalho de autorização nem cookie é mais barato do que
      // descobrir depois que o log virou um arquivo de credenciais.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    // O `x-forwarded-for` do balanceador precisa ser confiado para `req.ip`
    // valer alguma coisa; sem isso toda sessão fica registrada com o IP interno
    // dele.
    trustProxy: amb.ambiente !== 'desenvolvimento',
  });

  await app.register(cookie, { secret: amb.sessao.chaveDeAssinatura });

  /**
   * O frontend roda em outra origem e precisa mandar o cookie de sessão junto.
   *
   * `origin` é uma lista fechada de propósito: com `*`, `credentials` nem
   * funciona — e se funcionasse, qualquer site poderia chamar a nossa API com
   * a sessão de quem estivesse logado.
   */
  app.addHook('onRequest', async (req, resp) => {
    const origem = req.headers.origin;
    if (origem && origem === amb.urlDoFrontend) {
      resp.header('Access-Control-Allow-Origin', origem);
      resp.header('Access-Control-Allow-Credentials', 'true');
      resp.header('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      resp.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE');
      resp.header('Access-Control-Allow-Headers', 'Content-Type');
      return resp.code(204).send();
    }
  });

  app.addHook('onRequest', carregarSessao);

  const sso = new ServicoSso(amb);
  const autenticacao = new ServicoAutenticacao(amb, sso);
  const controlador = new ControladorAutenticacao(amb, sso, autenticacao);

  await app.register(rotasDeAutenticacao(controlador));
  await app.register(rotasDeColaboradores);

  /**
   * Saúde do processo, para o balanceador.
   *
   * Toca o banco de propósito: um processo que responde e não alcança o
   * Postgres está de pé e não serve para nada, e um health check que só prova
   * que o Node subiu mantém no ar exatamente esse estado.
   */
  app.get('/saude', async (_req, resp) => {
    try {
      await prisma.$queryRaw`select 1`;
      return { ok: true, ambiente: amb.ambiente };
    } catch (e) {
      app.log.error({ err: e }, 'banco inacessível');
      return resp.code(503).send({ ok: false, erro: 'Banco indisponível.' });
    }
  });

  return app;
}
