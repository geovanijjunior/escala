import { describe, expect, it } from "vitest";
import { generateServerSeed, hashServerSeed } from "../packages/engine/rng.js";
import { drawRound } from "../packages/engine/draw.js";

describe("drawRound — determinismo e forma do contrato", () => {
  it("é determinístico: mesmos seeds e nonce produzem a mesma rodada", () => {
    const serverSeed = generateServerSeed();
    const a = drawRound(serverSeed, "mata-fechada", 1);
    const b = drawRound(serverSeed, "mata-fechada", 1);
    expect(a).toEqual(b);
  });

  it("nonces diferentes produzem paradas diferentes (com altíssima probabilidade)", () => {
    const serverSeed = generateServerSeed();
    const a = drawRound(serverSeed, "mata-fechada", 1);
    const b = drawRound(serverSeed, "mata-fechada", 2);
    expect(a.reelStops).not.toEqual(b.reelStops);
  });

  it("clientSeed diferente produz paradas diferentes (com altíssima probabilidade)", () => {
    const serverSeed = generateServerSeed();
    const a = drawRound(serverSeed, "semente-a", 1);
    const b = drawRound(serverSeed, "semente-b", 1);
    expect(a.reelStops).not.toEqual(b.reelStops);
  });

  it("paradas sempre em [0,60), grid com 3 colunas de 3 símbolos", () => {
    const serverSeed = generateServerSeed();
    for (let nonce = 0; nonce < 200; nonce++) {
      const round = drawRound(serverSeed, "seed-fixa", nonce);
      for (const stop of round.reelStops) {
        expect(stop).toBeGreaterThanOrEqual(0);
        expect(stop).toBeLessThan(60);
      }
      expect(round.grid).toHaveLength(3);
      for (const col of round.grid) expect(col).toHaveLength(3);
      expect(round.multiplier === 1 || [2, 4, 10].includes(round.multiplier)).toBe(true);
      if (round.totalPreMultiplier === 0) expect(round.win).toBe(0);
    }
  });

  it("respin só dispara quando o gatilho está presente", () => {
    const serverSeed = generateServerSeed();
    for (let nonce = 0; nonce < 500; nonce++) {
      const round = drawRound(serverSeed, "seed-fixa", nonce);
      if (!round.respin.triggered) {
        expect(round.respin.fired).toBe(false);
        expect(round.respin.stop).toBeUndefined();
      }
    }
  });

  it("serverHash é o SHA-256 do serverSeed e não revela o seed", () => {
    const serverSeed = generateServerSeed();
    const hash = hashServerSeed(serverSeed);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(serverSeed.toString("hex"));
  });
});
