import { createHash, createHmac, randomBytes } from "node:crypto";

export interface EntropyDraw {
  step: string;
  u32: number;
  draws: number;
  value?: number;
  result: number;
}

export function generateServerSeed(): Buffer {
  return randomBytes(32);
}

export function hashServerSeed(serverSeed: Buffer): string {
  return createHash("sha256").update(serverSeed).digest("hex");
}

/**
 * Reduz um `u32` para `[0, n)` com rejeição de amostra. `u32 % n` direto
 * introduz viés de módulo sempre que `n` não divide 2**32 exatamente — o
 * que é o caso de todos os `n` usados neste motor (60, 100). Sem a rejeição,
 * os últimos `2**32 % n` valores da faixa ficam sub-representados.
 */
export function reduceWithRejection(n: number, nextU32: () => number): { value: number; u32: number; draws: number } {
  if (!Number.isInteger(n) || n <= 0) throw new Error("n precisa ser inteiro positivo");
  const limite = Math.floor(2 ** 32 / n) * n;
  let v: number;
  let draws = 0;
  do {
    v = nextU32();
    draws++;
  } while (v >= limite);
  return { value: v % n, u32: v, draws };
}

/**
 * Fluxo de entropia commit-reveal: bloco_k = HMAC_SHA256(serverSeed,
 * `${clientSeed}:${nonce}:${k}`). Cada bloco de 32 bytes é consumido em
 * fatias de 4 bytes big-endian (8 uint32 por bloco); `k` avança quando o
 * bloco corrente se esgota. O verificador independente (tools/verify.ts)
 * replica exatamente esta classe.
 */
export class EntropyStream {
  private readonly serverSeed: Buffer;
  private readonly clientSeed: string;
  private readonly nonce: number;
  private blockIndex = 0;
  private currentBlock: Buffer = Buffer.alloc(0);
  private offset = 0;
  readonly draws: EntropyDraw[] = [];

  constructor(serverSeed: Buffer, clientSeed: string, nonce: number) {
    this.serverSeed = serverSeed;
    this.clientSeed = clientSeed;
    this.nonce = nonce;
  }

  private nextBlock(): Buffer {
    const msg = `${this.clientSeed}:${this.nonce}:${this.blockIndex}`;
    this.blockIndex += 1;
    return createHmac("sha256", this.serverSeed).update(msg).digest();
  }

  private nextU32(): number {
    if (this.offset >= this.currentBlock.length) {
      this.currentBlock = this.nextBlock();
      this.offset = 0;
    }
    const v = this.currentBlock.readUInt32BE(this.offset);
    this.offset += 4;
    return v;
  }

  /** Uniforme em `[0, n)`, com rejeição de amostra obrigatória. */
  nextInt(n: number, step: string): number {
    const { value, u32, draws } = reduceWithRejection(n, () => this.nextU32());
    this.draws.push({ step, u32, draws, result: value });
    return value;
  }

  /** Uniforme em `[0, 1)`, usado como porta probabilística (`< limiar`). */
  nextFloat(step: string): number {
    const u32 = this.nextU32();
    const value = u32 / 2 ** 32;
    this.draws.push({ step, u32, draws: 1, value, result: value });
    return value;
  }
}
