import { describe, expect, it } from "vitest";
import { enumerateExact } from "../packages/math/rtp.js";

/**
 * Teste 1 da seção 10: RTP exato por enumeração das 216.000 janelas.
 * Fonte da verdade — se este teste falhar, o modelo mudou (fitas, paytable
 * ou probabilidades de feature deixaram de bater com a seção 3.5).
 */
describe("RTP exato (curupira.v1)", () => {
  const result = enumerateExact("curupira.v1");

  it("percorre o espaço amostral completo (60³)", () => {
    expect(result.sampleSpace).toBe(216_000);
  });

  it("bate 0.964251 com tolerância 1e-6", () => {
    expect(result.rtp).toBeCloseTo(0.964251, 6);
  });

  it("margem da casa é 1 - RTP", () => {
    expect(result.houseEdge).toBeCloseTo(0.035749, 6);
  });

  it("frequência de gatilho do respin bate 17,892%", () => {
    expect(result.respinTriggerFrequency).toBeCloseTo(0.17892, 3);
  });

  it("hit frequency (com respin) bate 41,38%", () => {
    expect(result.hitFrequency).toBeCloseTo(0.4138, 3);
  });

  it("nenhuma rodada excede o teto teórico de 3.616×", () => {
    expect(result.capMultiplier).toBeLessThanOrEqual(3616);
  });
});
