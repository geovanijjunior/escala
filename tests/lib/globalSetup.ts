import { Pool } from "pg";
import { isDatabaseReachable, resetSchema, TEST_DATABASE_URL } from "./db.js";

/**
 * Vitest garante que `globalSetup` termina antes de qualquer arquivo de
 * teste começar a rodar — por isso o reset do schema mora aqui, uma vez
 * só, em vez de em cada `beforeAll`. Arquivos de teste rodam em paralelo
 * (processos/pools separados); resetar o schema a partir de cada um
 * corre risco de disputa em `CREATE EXTENSION IF NOT EXISTS` e nos
 * próprios `DROP/CREATE TABLE`.
 */
export async function setup(): Promise<void> {
  if (!(await isDatabaseReachable())) return;
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await resetSchema(pool);
  } finally {
    await pool.end();
  }
}
