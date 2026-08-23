/**
 * Teste 4 da seção 10 — Independência.
 * Autocorrelação de lag 1..10 e runs test na sequência de retornos.
 *
 *   npx tsx tests/sim/04-independencia.ts                 # 20.000.000 (padrão)
 *   SAMPLES=2000000 npx tsx tests/sim/04-independencia.ts # amostra menor, para checagem rápida
 */
import { generateServerSeed } from "../../packages/engine/rng.js";
import { drawRound } from "../../packages/engine/draw.js";
import { autocorrelation, runsTest, twoTailedPValue } from "./estatistica.js";

const SAMPLES = Number(process.env.SAMPLES ?? 20_000_000);
const MAX_LAG = 10;

function main() {
  console.log(`Independência dos retornos — ${SAMPLES.toLocaleString("pt-BR")} amostras`);
  const serverSeed = generateServerSeed();
  const returns = new Float64Array(SAMPLES);
  const hits = new Array<boolean>(SAMPLES);

  const t0 = Date.now();
  for (let nonce = 0; nonce < SAMPLES; nonce++) {
    const round = drawRound(serverSeed, "sim-independencia", nonce);
    returns[nonce] = round.win;
    hits[nonce] = round.win > 0;
  }
  const elapsedS = (Date.now() - t0) / 1000;

  let allPass = true;

  console.log("\nAutocorrelação (limiar informal: |r| < 3/√N; p-valor via z = r·√N):");
  const returnsArray = Array.from(returns);
  for (let lag = 1; lag <= MAX_LAG; lag++) {
    const r = autocorrelation(returnsArray, lag);
    const z = r * Math.sqrt(SAMPLES);
    const pValue = twoTailedPValue(z);
    const pass = pValue > 0.01;
    allPass &&= pass;
    console.log(`  lag ${lag.toString().padStart(2)}: r = ${r.toExponential(3)}, p = ${pValue.toFixed(5)} — ${pass ? "ok" : "FALHOU"}`);
  }

  console.log("\nRuns test (sequência acerto/erro):");
  const { runs, n1, n2, z, pValue } = runsTest(hits);
  const runsPass = pValue > 0.01;
  allPass &&= runsPass;
  console.log(`  runs = ${runs}, acertos = ${n1}, erros = ${n2}, z = ${z.toFixed(4)}, p = ${pValue.toFixed(5)} — ${runsPass ? "PASSOU" : "FALHOU"}`);

  console.log(`\ntempo: ${elapsedS.toFixed(1)}s (${(SAMPLES / elapsedS).toFixed(0)} amostras/s)`);

  if (!allPass) {
    console.error("FALHA: sequência de retornos rejeita independência (p <= 0.01 em algum teste)");
    process.exit(1);
  }
  console.log("PASSOU: independência não rejeitada (autocorrelação lag 1..10 e runs test)");
}

main();
