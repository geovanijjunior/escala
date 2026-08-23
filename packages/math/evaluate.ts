import type { CurupiraModel, Symbol_ } from "./model.js";

export type Window3 = [Symbol_, Symbol_, Symbol_];

/** Janela visível para a parada `stop` numa fita de 60 posições: [topo, meio, base]. */
export function windowAt(strip: Symbol_[], stop: number): Window3 {
  const n = strip.length;
  const s = ((stop % n) + n) % n;
  return [strip[s], strip[(s + 1) % n], strip[(s + 2) % n]];
}

export interface LineWin {
  line: string;
  symbol: Symbol_;
  payLine: number;
  multiplierOfBet: number;
}

/** Avalia as 5 linhas de pagamento sobre uma grade [janela1, janela2, janela3]. */
export function evaluateLines(model: CurupiraModel, grid: [Window3, Window3, Window3]): LineWin[] {
  const wins: LineWin[] = [];
  for (const line of model.paylines) {
    const [r0, r1, r2] = line.rows;
    const a = grid[0][r0];
    const b = grid[1][r1];
    const c = grid[2][r2];
    if (a === b && b === c) {
      const payLine = model.paytable[a].payLine;
      wins.push({
        line: line.id,
        symbol: a,
        payLine,
        multiplierOfBet: payLine / model.betLines,
      });
    }
  }
  return wins;
}

export function sumWins(wins: LineWin[]): number {
  return wins.reduce((acc, w) => acc + w.payLine, 0);
}

/** Gatilho do respin: rolos 1 e 2 mostram o mesmo símbolo na linha do meio, e o rolo 3 mostra símbolo diferente ali. */
export function respinTriggered(model: CurupiraModel, w1: Window3, w2: Window3, w3: Window3): boolean {
  const row = model.respin.triggerRow;
  return w1[row] === w2[row] && w3[row] !== w1[row];
}

/** Valor esperado do multiplicador (1 quando a porta não abre). */
export function expectedMultiplierFactor(model: CurupiraModel): number {
  const totalWeight = model.multiplier.weights.reduce((a, b) => a + b, 0);
  const expectedValue =
    model.multiplier.values.reduce((acc, v, i) => acc + v * model.multiplier.weights[i], 0) / totalWeight;
  const p = model.multiplier.probability;
  return (1 - p) * 1 + p * expectedValue;
}
