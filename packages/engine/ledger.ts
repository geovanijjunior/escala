/** Qualquer coisa com `.query()` no formato do `pg` — `Pool` ou `PoolClient`. */
export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export type LedgerEntryType = "BET" | "WIN" | "REFUND" | "GRANT";

export interface LedgerEntryInput {
  accountId: string;
  /**
   * NOT NULL no schema (seção 6). Para lançamentos administrativos (GRANT)
   * sem rodada por trás, o chamador passa um UUID sintético — serve só
   * para preservar a unicidade `(round_id, type)`, sem FK para `rounds`.
   */
  roundId: string;
  type: LedgerEntryType;
  amount: bigint;
  modelId: string;
}

/**
 * Lançamento imutável em `ledger_entries` + atualização do snapshot em
 * `account_balances`, num único statement (CTE de escrita encadeada) —
 * atômico por construção, então funciona tanto passando um `Pool` quanto
 * um `PoolClient` já dentro de uma transação do chamador. Nunca
 * `UPDATE saldo = saldo - x`.
 *
 * Idempotente por natureza: `UNIQUE (round_id, type)` garante que o mesmo
 * par (rodada, tipo) nunca é lançado duas vezes — em concorrência, a
 * segunda tentativa apenas não insere nada (`ON CONFLICT DO NOTHING`), a
 * CTE fica vazia, e o saldo não é debitado/creditado de novo.
 */
export async function postEntry(client: Queryable, entry: LedgerEntryInput): Promise<boolean> {
  const result = await client.query(
    `with novo_lancamento as (
       insert into ledger_entries (account_id, round_id, type, amount, model_id)
       values ($1, $2, $3, $4, $5)
       on conflict (round_id, type) do nothing
       returning account_id, amount
     )
     insert into account_balances (account_id, balance, updated_at)
     select account_id, amount, now() from novo_lancamento
     on conflict (account_id)
     do update set balance = account_balances.balance + excluded.balance, updated_at = now()`,
    [entry.accountId, entry.roundId, entry.type, entry.amount.toString(), entry.modelId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function getBalance(client: Queryable, accountId: string): Promise<bigint> {
  const result = await client.query<{ balance: string }>(
    `select balance from account_balances where account_id = $1`,
    [accountId],
  );
  return BigInt(result.rows[0]?.balance ?? 0);
}

export interface ReconciliationResult {
  accountId: string;
  ledgerSum: bigint;
  snapshotBalance: bigint;
  matches: boolean;
}

/** Teste 9 (seção 10): SUM(amount) do ledger deve bater o snapshot materializado. */
export async function reconcile(client: Queryable, accountId: string): Promise<ReconciliationResult> {
  const [sumResult, balanceResult] = await Promise.all([
    client.query<{ sum: string | null }>(`select sum(amount) as sum from ledger_entries where account_id = $1`, [
      accountId,
    ]),
    client.query<{ balance: string }>(`select balance from account_balances where account_id = $1`, [accountId]),
  ]);

  const ledgerSum = BigInt(sumResult.rows[0]?.sum ?? 0);
  const snapshotBalance = BigInt(balanceResult.rows[0]?.balance ?? 0);

  return { accountId, ledgerSum, snapshotBalance, matches: ledgerSum === snapshotBalance };
}
