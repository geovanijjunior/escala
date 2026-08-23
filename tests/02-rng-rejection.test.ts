import { describe, expect, it } from "vitest";
import { reduceWithRejection } from "../packages/engine/rng.js";

/**
 * Teste 5 da seção 10: viés de módulo. `n = 60` não divide 2**32, então
 * `u32 % 60` teria uma cauda de valores 0..2**32 % 60 sobre-representada.
 * Este teste prova que a rejeição está ativa: injeta um u32 que cai na
 * faixa rejeitável e verifica que o stream descarta e consome outro.
 */
describe("reduceWithRejection — rejeição de amostra", () => {
  const n = 60;
  const limite = Math.floor(2 ** 32 / n) * n; // 4294967280

  it("descarta um u32 na faixa rejeitável e consome o próximo", () => {
    const sequence = [limite, limite + 7, 4_000_000_005]; // os dois primeiros >= limite
    let i = 0;
    const nextU32 = () => sequence[i++];

    const result = reduceWithRejection(n, nextU32);

    expect(result.draws).toBe(3); // rejeitou 2, aceitou o 3º
    expect(result.u32).toBe(4_000_000_005);
    expect(result.value).toBe(4_000_000_005 % n);
  });

  it("aceita de primeira quando o u32 já está sob o limite", () => {
    const nextU32 = () => 123;
    const result = reduceWithRejection(n, nextU32);
    expect(result.draws).toBe(1);
    expect(result.value).toBe(123 % n);
  });

  it("sem rejeição, o resultado divergiria — prova que a rejeição muda o valor retornado", () => {
    const rejectable = limite; // seria um resultado válido (embora enviesado) sob módulo ingênuo
    const sequence = [rejectable, 999];
    let i = 0;
    const result = reduceWithRejection(n, () => sequence[i++]);

    const valorSemRejeicao = rejectable % n;
    expect(result.value).not.toBe(valorSemRejeicao);
    expect(result.value).toBe(999 % n);
  });

  it("nunca retorna um valor fora de [0, n)", () => {
    for (let trial = 0; trial < 1000; trial++) {
      const nextU32 = () => Math.floor(Math.random() * 2 ** 32);
      const { value } = reduceWithRejection(n, nextU32);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(n);
    }
  });
});
