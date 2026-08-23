import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { grantChips, isDatabaseReachable, TEST_DATABASE_URL } from "./lib/db.js";
import { playRound } from "../packages/engine/round.js";
import { drawRound } from "../packages/engine/draw.js";
import { generateServerSeed, hashServerSeed } from "../packages/engine/rng.js";

const dbReachable = await isDatabaseReachable();

/**
 * Teste 8 da seção 10: mesma `Idempotency-Key` × 100 requisições concorrentes
 * → exatamente 1 par de lançamentos no ledger (nunca sorteia de novo).
 */
describe.skipIf(!dbReachable)("Idempotência de rodada (teste 8)", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20 });

  afterAll(async () => {
    await pool.end();
  });

  it("100 requisições concorrentes com a mesma chave produzem exatamente 1 BET e no máximo 1 WIN", async () => {
    const accountId = randomUUID();
    const idempotencyKey = randomUUID();
    await grantChips(pool, accountId, BigInt(10_000));

    const requests = Array.from({ length: 100 }, () =>
      playRound(pool, {
        accountId,
        bet: BigInt(100),
        clientSeed: "concorrencia-idempotencia",
        modelId: "curupira.v1",
        idempotencyKey,
      }),
    );
    const results = await Promise.all(requests);

    const roundIds = new Set(results.map((r) => r.roundId));
    expect(roundIds.size).toBe(1);

    const first = results[0];
    for (const r of results) expect(r).toEqual(first);

    const entries = await pool.query(
      `select type, count(*)::int as n from ledger_entries where round_id = $1 group by type`,
      [first.roundId],
    );
    const counts = Object.fromEntries(entries.rows.map((row) => [row.type, row.n]));
    expect(counts.BET).toBe(1);
    expect(counts.WIN ?? 0).toBeLessThanOrEqual(1);

    const rounds = await pool.query(`select count(*)::int as n from rounds where id = $1`, [first.roundId]);
    expect(rounds.rows[0].n).toBe(1);
  }, 30_000);

  it("Idempotency-Key diferente para a mesma conta cria uma rodada nova", async () => {
    const accountId = randomUUID();
    await grantChips(pool, accountId, BigInt(1_000));

    const a = await playRound(pool, {
      accountId,
      bet: BigInt(100),
      clientSeed: "seed",
      modelId: "curupira.v1",
      idempotencyKey: randomUUID(),
    });
    const b = await playRound(pool, {
      accountId,
      bet: BigInt(100),
      clientSeed: "seed",
      modelId: "curupira.v1",
      idempotencyKey: randomUUID(),
    });

    expect(a.roundId).not.toBe(b.roundId);
  });

  it("recupera uma rodada travada em BET_ACCEPTED pelo estado, sem sortear de novo", async () => {
    // Simula uma queda de conexão exatamente como a seção 5 descreve: o débito
    // já foi persistido (BET_ACCEPTED + lançamento BET), mas a liquidação não
    // rodou. `playRound` precisa retomar dali usando o MESMO (serverSeed,
    // clientSeed, nonce) já gravados — nunca gerar um nonce/seed novos.
    const accountId = randomUUID();
    const idempotencyKey = randomUUID();
    const clientSeed = "recuperacao-de-estado";
    const bet = BigInt(100);
    await grantChips(pool, accountId, BigInt(1_000));

    const serverSeed = generateServerSeed();
    const serverHash = hashServerSeed(serverSeed);
    const nonce = 7;

    const cycle = await pool.query(
      `insert into seed_cycles (account_id, server_seed, server_hash, client_seed, next_nonce)
       values ($1, $2, $3, $4, $5) returning id`,
      [accountId, serverSeed, serverHash, clientSeed, nonce + 1],
    );
    const seedCycleId = cycle.rows[0].id;

    const roundInsert = await pool.query(
      `insert into rounds (account_id, seed_cycle_id, model_id, bet, nonce, idempotency_key, state)
       values ($1, $2, 'curupira.v1', $3, $4, $5, 'BET_ACCEPTED') returning id`,
      [accountId, seedCycleId, bet.toString(), nonce, idempotencyKey],
    );
    const roundId = roundInsert.rows[0].id;

    await pool.query(
      `insert into ledger_entries (account_id, round_id, type, amount, model_id) values ($1, $2, 'BET', $3, 'curupira.v1')`,
      [accountId, roundId, (-bet).toString()],
    );
    await pool.query(
      `insert into account_balances (account_id, balance, updated_at) values ($1, $2, now())
       on conflict (account_id) do update set balance = account_balances.balance + excluded.balance, updated_at = now()`,
      [accountId, (-bet).toString()],
    );

    const expected = drawRound(serverSeed, clientSeed, nonce, "curupira.v1");

    const result = await playRound(pool, { accountId, bet, clientSeed, modelId: "curupira.v1", idempotencyKey });

    expect(result.roundId).toBe(roundId);
    expect(result.reelStops).toEqual(expected.reelStops);
    expect(result.entropy).toEqual(expected.entropy);

    const betEntries = await pool.query(`select count(*)::int as n from ledger_entries where round_id = $1 and type = 'BET'`, [
      roundId,
    ]);
    expect(betEntries.rows[0].n).toBe(1); // não debitou de novo

    const state = await pool.query(`select state from rounds where id = $1`, [roundId]);
    expect(state.rows[0].state).toBe("SETTLED");
  });
});

if (!dbReachable) {
  console.warn(
    `\n[tests/04-round-idempotency] Postgres não alcançável em ${TEST_DATABASE_URL} — suíte pulada. ` +
      "Suba um Postgres com as migrations de apps/api/migrations aplicadas para rodar este teste.\n",
  );
}
