/**
 * Teste 3 da seção 10 — Uniformidade.
 * Qui-quadrado nas paradas de cada rolo sobre N amostras (alvo: 20.000.000), p > 0.01.
 *
 *   npx tsx tests/sim/03-uniformidade.ts                 # 20.000.000 (padrão)
 *   SAMPLES=2000000 npx tsx tests/sim/03-uniformidade.ts # amostra menor, para checagem rápida
 */
import { generateServerSeed } from "../../packages/engine/rng.js";
import { drawRound } from "../../packages/engine/draw.js";
import { chiSquarePValue } from "./estatistica.js";

const SAMPLES = Number(process.env.SAMPLES ?? 20_000_000);
const BINS = 60;

function chiSquareUniform(counts: number[], total: number): { statistic: number; pValue: number } {
  const expected = total / counts.length;
  let statistic = 0;
  for (const observed of counts) statistic += (observed - expected) ** 2 / expected;
  return { statistic, pValue: chiSquarePValue(statistic, counts.length - 1) };
}

function main() {
  console.log(`Uniformidade das paradas — ${SAMPLES.toLocaleString("pt-BR")} amostras`);
  const serverSeed = generateServerSeed();
  const counts = [new Array(BINS).fill(0), new Array(BINS).fill(0), new Array(BINS).fill(0)];

  const t0 = Date.now();
  for (let nonce = 0; nonce < SAMPLES; nonce++) {
    const round = drawRound(serverSeed, "sim-uniformidade", nonce);
    counts[0][round.reelStops[0]]++;
    counts[1][round.reelStops[1]]++;
    counts[2][round.reelStops[2]]++;
  }
  const elapsedS = (Date.now() - t0) / 1000;

  let allPass = true;
  for (let reel = 0; reel < 3; reel++) {
    const { statistic, pValue } = chiSquareUniform(counts[reel], SAMPLES);
    const pass = pValue > 0.01;
    allPass &&= pass;
    console.log(
      `rolo ${reel + 1}: χ² = ${statistic.toFixed(3)} (df=${BINS - 1}), p = ${pValue.toFixed(5)} — ${pass ? "PASSOU" : "FALHOU"}`,
    );
  }
  console.log(`tempo: ${elapsedS.toFixed(1)}s (${(SAMPLES / elapsedS).toFixed(0)} amostras/s)`);

  if (!allPass) {
    console.error("FALHA: pelo menos um rolo rejeita uniformidade (p <= 0.01)");
    process.exit(1);
  }
  console.log("PASSOU: uniformidade não rejeitada em nenhum rolo (p > 0.01)");
}

main();
