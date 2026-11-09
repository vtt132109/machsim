/**
 * Seeded pseudo-random numbers for Monte Carlo analyses.
 *
 * Generator: xoshiro128** (Blackman & Vigna, public-domain algorithm) on four 32-bit words,
 * seeded through the SplitMix32 mixer so that any integer seed (including 0) gives a
 * well-distributed state. Sequences are identical on every platform for a given seed.
 *
 *   const rng = new Random(seed);
 *   rng.next()          // uniform in [0, 1), 53-bit resolution
 *   rng.uniform(a, b)   // uniform in [a, b)
 *   rng.gaussian()      // standard normal (Marsaglia polar method; the spare value is cached)
 */

/** SplitMix32 step: returns the next mixed word and the advanced state. */
function splitmix32(state: number): [number, number] {
  const s = (state + 0x9e3779b9) | 0;
  let z = s;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  z ^= z >>> 16;
  return [z >>> 0, s];
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export class Random {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spare: number | undefined;

  constructor(seed: number) {
    let st = Number.isFinite(seed) ? Math.trunc(seed) | 0 : 0;
    // fold the high part of large seeds in as well
    const hi = Number.isFinite(seed) ? Math.trunc(seed / 4294967296) | 0 : 0;
    st ^= Math.imul(hi, 0x27d4eb2d);
    const words: number[] = [];
    for (let k = 0; k < 4; k++) {
      const [w, next] = splitmix32(st);
      words.push(w);
      st = next;
    }
    [this.s0, this.s1, this.s2, this.s3] = words;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Next 32-bit unsigned integer. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform double in [0, 1) with 53 random bits. */
  next(): number {
    const a = this.nextUint32() >>> 5; // 27 bits
    const b = this.nextUint32() >>> 6; // 26 bits
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** Uniform double in [a, b). */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Standard normal deviate (mean 0, standard deviation 1). */
  gaussian(): number {
    if (this.spare !== undefined) {
      const s = this.spare;
      this.spare = undefined;
      return s;
    }
    for (;;) {
      const u = 2 * this.next() - 1;
      const v = 2 * this.next() - 1;
      const r = u * u + v * v;
      if (r > 0 && r < 1) {
        const f = Math.sqrt((-2 * Math.log(r)) / r);
        this.spare = v * f;
        return u * f;
      }
    }
  }
}
