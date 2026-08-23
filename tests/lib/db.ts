import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TEST_DATABASE_URL =
  process.env.SLOT_TEST_DATABASE_URL ?? "postgres://escala_slot:escala_slot@127.0.0.1:5432/escala_slot";

export async function isDatabaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const TABLES = ["ledger_entries", "rounds", "seed_cycles", "account_balances"];

/** Recria o schema do zero a partir da migração — cada suíte parte de um banco limpo. */
export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query(`drop table if exists ${TABLES.join(", ")} cascade`);
  const migration = readFileSync(path.join(__dirname, "../../apps/api/migrations/0001_init.sql"), "utf8");
  await pool.query(migration);
}

export async function grantChips(pool: Pool, accountId: string, amount: bigint, modelId = "curupira.v1"): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into ledger_entries (account_id, round_id, type, amount, model_id) values ($1, $2, 'GRANT', $3, $4)`,
      [accountId, randomUUID(), amount.toString(), modelId],
    );
    await client.query(
      `insert into account_balances (account_id, balance, updated_at) values ($1, $2, now())
       on conflict (account_id) do update set balance = account_balances.balance + excluded.balance, updated_at = now()`,
      [accountId, amount.toString()],
    );
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
