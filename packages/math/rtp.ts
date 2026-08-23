import { loadModel } from "./model.js";
import { evaluateLines, respinTriggered, sumWins, windowAt } from "./evaluate.js";
import type { CurupiraModel } from "./model.js";

export interface EnumerationResult {
  modelId: string;
  modelHash: string;
  sampleSpace: number;
  rtp: number;
  houseEdge: number;
  hitFrequency: number;
  lessThanBetFrequency: number;
  dryLossFrequency: number;
  sigma: number;
  pGe10x: number;
  pGe100x: number;
  capMultiplier: number;
  respinTriggerFrequency: number;
  expectedTurnoverToRuinPerUnitBankroll: number;
}

interface MultBranch {
  prob: number;
  factor: number;
}

function multiplierBranches(model: CurupiraModel): MultBranch[] {
  const p = model.multiplier.probability;
  const totalWeight = model.multiplier.weights.reduce((a, b) => a + b, 0);
  const branches: MultBranch[] = [{ prob: 1 - p, factor: 1 }];
  for (let i = 0; i < model.multiplier.values.length; i++) {
    branches.push({
      prob: p * (model.multiplier.weights[i] / totalWeight),
      factor: model.multiplier.values[i],
    });
  }
  return branches;
}

/**
 * Enumeração exata: percorre as 216.000 janelas (60³), pesa cada uma pelas
 * probabilidades exatas de respin e multiplicador (também enumeradas, nunca
 * amostradas), e acumula a distribuição completa do prêmio por rodada.
 */
export function enumerateExact(modelId = "curupira.v1"): EnumerationResult {
  const { model, hash } = loadModel(modelId);
  const { reel1, reel2, reel3 } = model.reels;
  const n = reel1.length; // 60
  const betTotal = model.betLines;
  const multBranches = multiplierBranches(model);

  let sampleSpace = 0;
  let sumWeight = 0;
  let sumWeightedPrize = 0;
  let sumWeightedPrizeSq = 0;
  let hitWeight = 0;
  let lessThanBetWeight = 0;
  let dryLossWeight = 0;
  let ge10xWeight = 0;
  let ge100xWeight = 0;
  let maxMultiple = 0;
  let triggeredCount = 0;

  for (let r1 = 0; r1 < n; r1++) {
    const w1 = windowAt(reel1, r1);
    for (let r2 = 0; r2 < n; r2++) {
      const w2 = windowAt(reel2, r2);
      for (let r3 = 0; r3 < n; r3++) {
        sampleSpace++;
        const w3 = windowAt(reel3, r3);
        const baseWin = sumWins(evaluateLines(model, [w1, w2, w3]));
        const triggered = respinTriggered(model, w1, w2, w3);

        const xBranches: { prob: number; value: number }[] = [];
        if (!triggered) {
          xBranches.push({ prob: 1, value: baseWin });
        } else {
          triggeredCount++;
          const pRespin = model.respin.probability;
          xBranches.push({ prob: 1 - pRespin, value: baseWin });
          for (let r3p = 0; r3p < n; r3p++) {
            const w3p = windowAt(reel3, r3p);
            const respinWin = sumWins(evaluateLines(model, [w1, w2, w3p]));
            xBranches.push({ prob: pRespin / n, value: baseWin + respinWin });
          }
        }

        for (const xb of xBranches) {
          for (const mb of multBranches) {
            const weight = xb.prob * mb.prob;
            const prize = xb.value * mb.factor;
            const multiple = prize / betTotal;

            sumWeight += weight;
            sumWeightedPrize += weight * prize;
            sumWeightedPrizeSq += weight * prize * prize;
            if (prize > 0) hitWeight += weight;
            if (prize > 0 && prize < betTotal) lessThanBetWeight += weight;
            if (prize === 0) dryLossWeight += weight;
            if (multiple >= 10) ge10xWeight += weight;
            if (multiple >= 100) ge100xWeight += weight;
            if (multiple > maxMultiple) maxMultiple = multiple;
          }
        }
      }
    }
  }

  const totalWeight = sumWeight; // deve bater sampleSpace (cada combo soma peso 1)
  const meanPrize = sumWeightedPrize / totalWeight;
  const meanPrizeSq = sumWeightedPrizeSq / totalWeight;
  const varPrize = meanPrizeSq - meanPrize * meanPrize;
  const sigmaMultiple = Math.sqrt(varPrize) / betTotal;

  const rtp = meanPrize / betTotal;
  const houseEdge = 1 - rtp;

  return {
    modelId,
    modelHash: hash,
    sampleSpace,
    rtp,
    houseEdge,
    hitFrequency: hitWeight / totalWeight,
    lessThanBetFrequency: lessThanBetWeight / totalWeight,
    dryLossFrequency: dryLossWeight / totalWeight,
    sigma: sigmaMultiple,
    pGe10x: ge10xWeight / totalWeight,
    pGe100x: ge100xWeight / totalWeight,
    capMultiplier: maxMultiple,
    respinTriggerFrequency: triggeredCount / sampleSpace,
    expectedTurnoverToRuinPerUnitBankroll: houseEdge > 0 ? 1 / houseEdge : Infinity,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = enumerateExact();
  console.log(JSON.stringify(result, null, 2));
}
