import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type Symbol_ = "CUR" | "COC" | "POT" | "TAT" | "FLR" | "FOL" | "PEG";

export interface Payline {
  id: string;
  rows: [number, number, number];
}

export interface CurupiraModel {
  modelId: string;
  betLines: number;
  symbols: Symbol_[];
  paytable: Record<Symbol_, { payLine: number }>;
  reels: { reel1: Symbol_[]; reel2: Symbol_[]; reel3: Symbol_[] };
  paylines: Payline[];
  respin: { reel: number; triggerRow: number; probability: number };
  multiplier: { probability: number; values: number[]; weights: number[] };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadRaw(modelId: string): string {
  const filePath = path.join(__dirname, "models", `${modelId}.json`);
  return readFileSync(filePath, "utf8");
}

const cache = new Map<string, { model: CurupiraModel; hash: string }>();

export function loadModel(modelId = "curupira.v1"): { model: CurupiraModel; hash: string } {
  const cached = cache.get(modelId);
  if (cached) return cached;

  const raw = loadRaw(modelId);
  const hash = createHash("sha256").update(raw).digest("hex");
  const model = JSON.parse(raw) as CurupiraModel;

  if (model.reels.reel1.length !== 60 || model.reels.reel2.length !== 60 || model.reels.reel3.length !== 60) {
    throw new Error(`modelo ${modelId}: cada fita precisa ter exatamente 60 posições`);
  }
  if (model.modelId !== modelId) {
    throw new Error(`modelo ${modelId}: campo modelId interno (${model.modelId}) não bate com o arquivo`);
  }

  Object.freeze(model.reels.reel1);
  Object.freeze(model.reels.reel2);
  Object.freeze(model.reels.reel3);
  Object.freeze(model.paytable);
  Object.freeze(model.paylines);
  Object.freeze(model);

  const entry = { model, hash };
  cache.set(modelId, entry);
  return entry;
}
