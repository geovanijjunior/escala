import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { isDatabaseReachable, TEST_DATABASE_URL } from "./lib/db.js";
import { postEntry, reconcile } from "../packages/engine/ledger.js";

const dbReachable = await isDatabaseReachable();

/**
 * Teste 9 da seção 10: SUM(amount) do ledger deve bater o saldo
 * materializado após operações concorrentes. O alvo oficial é 1M de
 * operações — aqui uma amostra moderada roda dentro do Vitest; a versão
 * em escala real está em tests/sim/09-reconciliacao.ts.
 */
describe.skipIf(!dbReachable)("Reconciliação do ledger (teste 9)", () => {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20 });

  afterAll(async () => {
    await pool.end();
  });

  it("SUM(amount) bate o snapshot após lançamentos concorrentes em várias contas", async () => {
    const accounts = Array.from({ length: 10 }, () => randomUUID());
    const entriesPerAccount = 50;

    const jobs: Promise<boolean>[] = [];
    for (const accountId of accounts) {
      for (let i = 0; i < entriesPerAccount; i++) {
        const roundId = randomUUID();
        jobs.push(
          postEntry(pool, { accountId, roundId, type: "GRANT", amount: BigInt(1_000), modelId: "curupira.v1" }),
        );
      }
    }
    await Promise.all(jobs);

    for (const accountId of accounts) {
      const result = await reconcile(pool, accountId);
      expect(result.matches).toBe(true);
      expect(result.ledgerSum).toBe(BigInt(entriesPerAccount) * BigInt(1_000));
      expect(result.snapshotBalance).toBe(result.ledgerSum);
    }
  }, 60_000);

  it("lançamentos concorrentes de BET e WIN na mesma rodada nunca duplicam (round_id, type)", async () => {
    const accountId = randomUUID();
    const roundId = randomUUID();

    const results = await Promise.all([
      postEntry(pool, { accountId, roundId, type: "BET", amount: BigInt(-100), modelId: "curupira.v1" }),
      postEntry(pool, { accountId, roundId, type: "BET", amount: BigInt(-100), modelId: "curupira.v1" }),
      postEntry(pool, { accountId, roundId, type: "BET", amount: BigInt(-100), modelId: "curupira.v1" }),
    ]);

    expect(results.filter(Boolean).length).toBe(1);

    const count = await pool.query(`select count(*)::int as n from ledger_entries where round_id = $1`, [roundId]);
    expect(count.rows[0].n).toBe(1);

    const result = await reconcile(pool, accountId);
    expect(result.matches).toBe(true);
    expect(result.ledgerSum).toBe(BigInt(-100));
  });
});

if (!dbReachable) {
  console.warn(`\n[tests/05-ledger-reconciliation] Postgres não alcançável em ${TEST_DATABASE_URL} — suíte pulada.\n`);
}
