import type { Pool, PoolClient } from "pg";
import { drawRound, type RoundDraw } from "./draw.js";
import { postEntry, getBalance } from "./ledger.js";
import { ensureActiveCycle, getCycleById, nextNonce } from "./seedCycle.js";
import { loadModel } from "../math/model.js";

export class InsufficientBalanceError extends Error {}
export class InvalidBetError extends Error {}

export type RoundState = "BET_ACCEPTED" | "RNG_DRAWN" | "BASE_EVALUATED" | "SETTLED";

interface RoundRow {
  id: string;
  account_id: string;
  seed_cycle_id: string;
  model_id: string;
  bet: string;
  nonce: number;
  idempotency_key: string;
  state: RoundState;
  reel_stops: number[] | null;
  grid: RoundDraw["grid"] | null;
  base_wins: RoundDraw["baseWins"] | null;
  respin: RoundDraw["respin"] | null;
  multiplier: number | null;
  win: string | null; // fichas (já escaladas pela aposta), não unidades de aposta-linha
  entropy: RoundDraw["entropy"] | null;
  balance_after: string | null;
}

export interface PlayRoundInput {
  accountId: string;
  bet: bigint;
  clientSeed: string;
  modelId: string;
  idempotencyKey: string;
}

export interface RoundResponse {
  roundId: string;
  nonce: number;
  serverHash: string;
  modelHash: string;
  reelStops: [number, number, number];
  grid: RoundDraw["grid"];
  baseWins: RoundDraw["baseWins"];
  respin: RoundDraw["respin"];
  multiplier: number;
  totalMultiplierOfBet: number;
  win: string;
  balance: string;
  entropy: RoundDraw["entropy"];
}

/**
 * Máquina de estados da rodada (seção 5), com idempotência via
 * `Idempotency-Key`. Cada estado é persistido em sua própria transação
 * antes da transição seguinte: uma queda de conexão nunca provoca um novo
 * sorteio, porque `drawRound` é puro — refazer o cálculo com os mesmos
 * (serverSeed, clientSeed, nonce) já persistidos produz byte a byte o
 * mesmo resultado.
 *
 * Concorrência na mesma `Idempotency-Key` é serializada por um advisory
 * lock de sessão, mantido pelo mesmo client em todas as transações da
 * chamada — reenvios encontram a rodada já `SETTLED` e não repetem nada.
 */
export async function playRound(pool: Pool, input: PlayRoundInput): Promise<RoundResponse> {
  const client = await pool.connect();
  const lockKey = `${input.accountId}:${input.idempotencyKey}`;
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [lockKey]);

    let row = await fetchRound(client, input.accountId, input.idempotencyKey);
    if (!row) row = await acceptBet(client, input);
    if (row.state === "BET_ACCEPTED") row = await drawAndEvaluate(client, row);
    if (row.state === "BASE_EVALUATED") row = await settle(client, row);

    return await toResponse(client, row);
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [lockKey]);
    client.release();
  }
}

async function fetchRound(client: PoolClient, accountId: string, idempotencyKey: string): Promise<RoundRow | null> {
  const result = await client.query<RoundRow>(
    `select * from rounds where account_id = $1 and idempotency_key = $2`,
    [accountId, idempotencyKey],
  );
  return result.rows[0] ?? null;
}

async function acceptBet(client: PoolClient, input: PlayRoundInput): Promise<RoundRow> {
  const { model } = loadModel(input.modelId);
  if (input.bet <= BigInt(0) || input.bet % BigInt(model.betLines) !== BigInt(0)) {
    throw new InvalidBetError(`aposta precisa ser múltiplo positivo de ${model.betLines}`);
  }

  await client.query("begin");
  try {
    const cycle = await ensureActiveCycle(client, input.accountId, input.clientSeed);
    const nonce = await nextNonce(client, cycle.id);

    const balance = await getBalance(client, input.accountId);
    if (balance < input.bet) {
      throw new InsufficientBalanceError(`saldo insuficiente para a conta ${input.accountId}`);
    }

    const inserted = await client.query<RoundRow>(
      `insert into rounds (account_id, seed_cycle_id, model_id, bet, nonce, idempotency_key, state)
       values ($1, $2, $3, $4, $5, $6, 'BET_ACCEPTED')
       returning *`,
      [input.accountId, cycle.id, input.modelId, input.bet.toString(), nonce, input.idempotencyKey],
    );
    const row = inserted.rows[0];

    const posted = await postEntry(client, {
      accountId: input.accountId,
      roundId: row.id,
      type: "BET",
      amount: -input.bet,
      modelId: input.modelId,
    });
    if (!posted) throw new Error("lançamento BET duplicado numa rodada recém-criada — não deveria acontecer");

    await client.query("commit");
    return row;
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

async function drawAndEvaluate(client: PoolClient, row: RoundRow): Promise<RoundRow> {
  const cycle = await getCycleById(client, row.seed_cycle_id);
  const { model } = loadModel(row.model_id);
  const draw = drawRound(cycle.serverSeed, cycle.clientSeed, row.nonce, row.model_id);

  await client.query("begin");
  await client.query(
    `update rounds set state = 'RNG_DRAWN', reel_stops = $1, entropy = $2, updated_at = now() where id = $3`,
    [draw.reelStops, JSON.stringify(draw.entropy), row.id],
  );
  await client.query("commit");

  const betLineUnit = BigInt(row.bet) / BigInt(model.betLines);
  const winChips = BigInt(draw.win) * betLineUnit;

  await client.query("begin");
  const updated = await client.query<RoundRow>(
    `update rounds
     set state = 'BASE_EVALUATED', grid = $1, base_wins = $2, respin = $3, multiplier = $4, win = $5, updated_at = now()
     where id = $6
     returning *`,
    [
      JSON.stringify(draw.grid),
      JSON.stringify(draw.baseWins),
      JSON.stringify(draw.respin),
      draw.multiplier,
      winChips.toString(),
      row.id,
    ],
  );
  await client.query("commit");
  return updated.rows[0];
}

async function settle(client: PoolClient, row: RoundRow): Promise<RoundRow> {
  await client.query("begin");
  try {
    const win = BigInt(row.win ?? "0");
    if (win > BigInt(0)) {
      await postEntry(client, {
        accountId: row.account_id,
        roundId: row.id,
        type: "WIN",
        amount: win,
        modelId: row.model_id,
      });
    }
    const balance = await getBalance(client, row.account_id);
    const updated = await client.query<RoundRow>(
      `update rounds set state = 'SETTLED', balance_after = $1, updated_at = now() where id = $2 returning *`,
      [balance.toString(), row.id],
    );
    await client.query("commit");
    return updated.rows[0];
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

async function toResponse(client: PoolClient, row: RoundRow): Promise<RoundResponse> {
  const cycle = await getCycleById(client, row.seed_cycle_id);
  const { hash: modelHash } = loadModel(row.model_id);
  const win = BigInt(row.win ?? "0");

  return {
    roundId: row.id,
    nonce: row.nonce,
    serverHash: cycle.serverHash,
    modelHash,
    reelStops: row.reel_stops as [number, number, number],
    grid: row.grid as RoundDraw["grid"],
    baseWins: row.base_wins as RoundDraw["baseWins"],
    respin: row.respin as RoundDraw["respin"],
    multiplier: row.multiplier ?? 1,
    totalMultiplierOfBet: Number(win) / Number(BigInt(row.bet)),
    win: win.toString(),
    balance: row.balance_after ?? "0",
    entropy: row.entropy as RoundDraw["entropy"],
  };
}
