import type { PoolClient } from "pg";
import { generateServerSeed, hashServerSeed } from "./rng.js";

export interface SeedCycle {
  id: string;
  accountId: string;
  serverSeed: Buffer;
  serverHash: string;
  clientSeed: string;
  nextNonce: number;
}

/** Cria o primeiro ciclo de uma conta, se ainda não existir um ativo. */
export async function ensureActiveCycle(client: PoolClient, accountId: string, clientSeed: string): Promise<SeedCycle> {
  const existing = await getActiveCycle(client, accountId);
  if (existing) return existing;
  return startCycle(client, accountId, clientSeed);
}

export async function getCycleById(client: PoolClient, cycleId: string): Promise<SeedCycle> {
  const result = await client.query(
    `select id, account_id, server_seed, server_hash, client_seed, next_nonce
     from seed_cycles where id = $1`,
    [cycleId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`ciclo ${cycleId} não encontrado`);
  return rowToCycle(row);
}

export async function getActiveCycle(client: PoolClient, accountId: string): Promise<SeedCycle | null> {
  const result = await client.query(
    `select id, account_id, server_seed, server_hash, client_seed, next_nonce
     from seed_cycles where account_id = $1 and active for update`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return rowToCycle(row);
}

export async function startCycle(client: PoolClient, accountId: string, clientSeed: string): Promise<SeedCycle> {
  const serverSeed = generateServerSeed();
  const serverHash = hashServerSeed(serverSeed);
  const result = await client.query(
    `insert into seed_cycles (account_id, server_seed, server_hash, client_seed)
     values ($1, $2, $3, $4)
     returning id, account_id, server_seed, server_hash, client_seed, next_nonce`,
    [accountId, serverSeed, serverHash, clientSeed],
  );
  return rowToCycle(result.rows[0]);
}

/** Consome e avança o próximo nonce do ciclo ativo, de forma atômica. */
export async function nextNonce(client: PoolClient, cycleId: string): Promise<number> {
  const result = await client.query<{ next_nonce: number }>(
    `update seed_cycles set next_nonce = next_nonce + 1 where id = $1 returning next_nonce - 1 as next_nonce`,
    [cycleId],
  );
  return Number(result.rows[0].next_nonce);
}

/** Encerra o ciclo, revela o serverSeed anterior, e abre um novo. */
export async function rotateCycle(
  client: PoolClient,
  accountId: string,
  newClientSeed: string,
): Promise<{ revealed: { serverSeed: string; serverHash: string; clientSeed: string }; next: SeedCycle }> {
  const current = await getActiveCycle(client, accountId);
  if (!current) throw new Error(`conta ${accountId} não tem ciclo ativo`);

  await client.query(`update seed_cycles set active = false, revealed_at = now() where id = $1`, [current.id]);
  const next = await startCycle(client, accountId, newClientSeed);

  return {
    revealed: {
      serverSeed: current.serverSeed.toString("hex"),
      serverHash: current.serverHash,
      clientSeed: current.clientSeed,
    },
    next,
  };
}

function rowToCycle(row: {
  id: string;
  account_id: string;
  server_seed: Buffer;
  server_hash: string;
  client_seed: string;
  next_nonce: number;
}): SeedCycle {
  return {
    id: row.id,
    accountId: row.account_id,
    serverSeed: row.server_seed,
    serverHash: row.server_hash,
    clientSeed: row.client_seed,
    nextNonce: Number(row.next_nonce),
  };
}
