import { EntropyStream, type EntropyDraw } from "./rng.js";
import { loadModel } from "../math/model.js";
import { evaluateLines, respinTriggered, sumWins, windowAt } from "../math/evaluate.js";
import type { LineWin, Window3 } from "../math/evaluate.js";

export interface RespinOutcome {
  triggered: boolean;
  fired: boolean;
  stop?: number;
  wins: LineWin[];
}

export interface RoundDraw {
  modelId: string;
  modelHash: string;
  reelStops: [number, number, number];
  grid: [Window3, Window3, Window3];
  baseWins: LineWin[];
  baseWin: number;
  respin: RespinOutcome;
  totalPreMultiplier: number;
  multiplier: number;
  win: number;
  entropy: EntropyDraw[];
}

/**
 * Contrato de verificação (seção 4.1): ordem fixa de consumo de entropia.
 * `tools/verify.ts` chama exatamente esta função com os mesmos seeds e
 * precisa reproduzir `reelStops`, `win` e `multiplier` byte a byte.
 *
 * 1. u32 → [0,60) parada do rolo 1
 * 2. u32 → [0,60) parada do rolo 2
 * 3. u32 → [0,60) parada do rolo 3
 * 4. só se houver gatilho de respin: u32/2**32 → porta do respin (< 0.35)
 * 5. só se a porta abrir: u32 → [0,60) nova parada do rolo 3
 * 6. só se prêmio > 0: u32/2**32 → porta do multiplicador (< 0.065)
 * 7. só se a porta abrir: u32 → [0,100) → valor do multiplicador por peso acumulado
 */
export function drawRound(
  serverSeed: Buffer,
  clientSeed: string,
  nonce: number,
  modelId = "curupira.v1",
): RoundDraw {
  const { model, hash } = loadModel(modelId);
  const stream = new EntropyStream(serverSeed, clientSeed, nonce);

  const r1 = stream.nextInt(60, "reel1");
  const r2 = stream.nextInt(60, "reel2");
  const r3 = stream.nextInt(60, "reel3");

  const w1 = windowAt(model.reels.reel1, r1);
  const w2 = windowAt(model.reels.reel2, r2);
  const w3 = windowAt(model.reels.reel3, r3);

  const baseWins = evaluateLines(model, [w1, w2, w3]);
  const baseWin = sumWins(baseWins);
  const triggered = respinTriggered(model, w1, w2, w3);

  const respin: RespinOutcome = { triggered, fired: false, wins: [] };
  let respinWin = 0;
  let finalW3 = w3;

  if (triggered) {
    const gate = stream.nextFloat("respinGate");
    respin.fired = gate < model.respin.probability;
    if (respin.fired) {
      const r3b = stream.nextInt(60, "reel3Respin");
      respin.stop = r3b;
      finalW3 = windowAt(model.reels.reel3, r3b);
      respin.wins = evaluateLines(model, [w1, w2, finalW3]);
      respinWin = sumWins(respin.wins);
    }
  }

  const totalPreMultiplier = baseWin + respinWin;

  let multiplier = 1;
  if (totalPreMultiplier > 0) {
    const gate = stream.nextFloat("multiplierGate");
    if (gate < model.multiplier.probability) {
      const pick = stream.nextInt(100, "multiplierValue");
      const totalWeight = model.multiplier.weights.reduce((a, b) => a + b, 0);
      let cumulative = 0;
      for (let i = 0; i < model.multiplier.values.length; i++) {
        cumulative += (model.multiplier.weights[i] / totalWeight) * 100;
        if (pick < cumulative) {
          multiplier = model.multiplier.values[i];
          break;
        }
      }
    }
  }

  return {
    modelId,
    modelHash: hash,
    reelStops: [r1, r2, r3],
    grid: [w1, w2, finalW3],
    baseWins,
    baseWin,
    respin,
    totalPreMultiplier,
    multiplier,
    win: totalPreMultiplier * multiplier,
    entropy: stream.draws,
  };
}
