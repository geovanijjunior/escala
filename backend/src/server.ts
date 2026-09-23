import { lerAmbiente } from './config/ambiente.ts';
import { prisma } from './config/prisma.ts';
import { construirApp } from './app.ts';
import { limparSessoesVencidas } from './repositories/sessoes.ts';

/**
 * A subida do processo. A aplicação em si mora em `app.ts`.
 *
 * Aqui só o que pertence a um processo de verdade: ler o ambiente, escutar
 * numa porta, varrer sessões vencidas e desligar com ordem. Nada disso cabe num
 * teste, e é justamente por isso que está separado.
 */

const amb = lerAmbiente();
const app = await construirApp(amb);

/** A varredura das sessões vencidas, de hora em hora. */
const relogio = setInterval(() => {
  limparSessoesVencidas()
    .then(n => { if (n) app.log.info({ apagadas: n }, 'sessões vencidas apagadas'); })
    .catch(e => app.log.warn({ err: e }, 'limpeza de sessões falhou'));
}, 3600_000);
// Sem `unref`, este temporizador sozinho impede o processo de terminar.
relogio.unref();

/**
 * Encerramento ordenado.
 *
 * Sem isto, o SIGTERM do orquestrador mata o processo no meio das requisições
 * em andamento: quem estava salvando recebe conexão fechada, e o deploy vira um
 * punhado de erros que ninguém consegue reproduzir depois.
 */
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sinal, () => {
    app.log.info({ sinal }, 'encerrando');
    app.close()
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}

await app.listen({ port: amb.porta, host: '0.0.0.0' });
