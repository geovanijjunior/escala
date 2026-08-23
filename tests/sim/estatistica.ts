/** Utilitários estatísticos independentes de framework, para os testes da seção 10. */

/** Função gama regularizada inferior P(a,x) — série (Numerical Recipes 6.2.5). */
function gammaSeries(a: number, x: number): number {
  const gln = lnGamma(a);
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 1; n <= 500; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gln);
}

/** Função gama regularizada superior Q(a,x) — fração contínua (Numerical Recipes 6.2.7). */
function gammaContinuedFraction(a: number, x: number): number {
  const gln = lnGamma(a);
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

function lnGamma(x: number): number {
  const cof = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xShift = x - 1;
  let a = 0.99999999999980993;
  const t = xShift + 7.5;
  for (let i = 0; i < cof.length; i++) a += cof[i] / (xShift + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (xShift + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Q(a,x): gama incompleta regularizada superior — usada como p-valor do qui-quadrado. */
function upperIncompleteGammaRegularized(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new Error("parâmetros inválidos");
  if (x === 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaContinuedFraction(a, x);
}

/** p-valor da cauda superior de uma qui-quadrado com `df` graus de liberdade. */
export function chiSquarePValue(statistic: number, df: number): number {
  return upperIncompleteGammaRegularized(df / 2, statistic / 2);
}

/** Φ(z) — CDF da normal padrão, via erf (Abramowitz & Stegun 7.1.26). */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export function twoTailedPValue(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

export interface RunsTestResult {
  runs: number;
  n1: number;
  n2: number;
  z: number;
  pValue: number;
}

/** Runs test de Wald–Wolfowitz sobre uma sequência binária. */
export function runsTest(bits: boolean[]): RunsTestResult {
  const n1 = bits.filter((b) => b).length;
  const n2 = bits.length - n1;
  let runs = 1;
  for (let i = 1; i < bits.length; i++) if (bits[i] !== bits[i - 1]) runs++;

  const n = n1 + n2;
  const meanRuns = (2 * n1 * n2) / n + 1;
  const varianceRuns = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const z = (runs - meanRuns) / Math.sqrt(varianceRuns);
  return { runs, n1, n2, z, pValue: twoTailedPValue(z) };
}

/** Autocorrelação de Pearson na `sequence` para o `lag` dado. */
export function autocorrelation(sequence: number[], lag: number): number {
  const n = sequence.length;
  const mean = sequence.reduce((a, b) => a + b, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) denominator += (sequence[i] - mean) ** 2;
  for (let i = 0; i < n - lag; i++) numerator += (sequence[i] - mean) * (sequence[i + lag] - mean);
  return numerator / denominator;
}
