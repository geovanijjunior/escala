import { PrismaClient } from '@prisma/client';

/**
 * O cliente do Prisma, um por processo.
 *
 * Um por processo, e não um por requisição: cada `new PrismaClient()` abre o
 * próprio pool de conexões, e o Postgres tem um teto de conexões que se
 * alcança rápido quando cada requisição traz um pool novo. O sintoma é o pior
 * possível — funciona em desenvolvimento, com um visitante, e derruba o banco
 * sob carga.
 *
 * `globalThis` guarda a instância porque o `tsx watch` recarrega o módulo a
 * cada alteração de arquivo: sem isso, meia hora de desenvolvimento acumula
 * dezenas de pools órfãos.
 */
const guardado = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = guardado.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV_APP === 'producao'
    ? ['warn', 'error']
    : ['warn', 'error', 'query'],
});

if (process.env.NODE_ENV_APP !== 'producao') guardado.prisma = prisma;
