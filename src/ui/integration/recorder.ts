/**
 * Recorder of an interactive session's streamed samples, so the session can be captured into the
 * Grapher as a transient result when it stops (or on demand).
 *
 * Every chunk's time points and recorded vectors are appended. Memory stays bounded: when
 * `maxPoints` samples are stored, every second sample is dropped (keeping the newest) and only
 * every second incoming sample is kept from then on, so a long session keeps a uniform, coarser
 * picture of its whole history. Vectors that appear later in a session are padded with NaN before
 * their first sample.
 */
import type { TransientChunk } from '../../sim/api';
import type { AnalysisResult, Vector, VectorUnit } from '../../sim/results';

function unitOf(name: string): VectorUnit {
  const n = name.trim().toLowerCase();
  if (n.startsWith('v(')) return 'V';
  if (n.startsWith('i(')) return 'A';
  if (n.startsWith('p(')) return 'W';
  return '';
}

export class ChunkRecorder {
  private t: number[] = [];
  private v = new Map<string, number[]>();
  private stride = 1;
  private skip = 0;

  constructor(readonly maxPoints = 20000) {}

  /** Number of stored samples. */
  get length(): number {
    return this.t.length;
  }

  clear(): void {
    this.t = [];
    this.v.clear();
    this.stride = 1;
    this.skip = 0;
  }

  push(chunk: TransientChunk): void {
    const names = Object.keys(chunk.vectors);
    for (const n of names) {
      if (!this.v.has(n)) this.v.set(n, new Array<number>(this.t.length).fill(Number.NaN));
    }
    const last = chunk.time.length - 1;
    for (let k = 0; k <= last; k++) {
      // keep every stride-th sample, and always the newest of a chunk
      if (this.skip++ % this.stride !== 0 && k !== last) continue;
      const time = chunk.time[k];
      if (this.t.length && time <= this.t[this.t.length - 1]) continue;
      this.t.push(time);
      for (const [n, arr] of this.v) {
        const src = chunk.vectors[n];
        arr.push(src ? src[k] : Number.NaN);
      }
      if (this.t.length >= this.maxPoints) this.thin();
    }
  }

  /** Drop every second stored sample (keeping the newest) and halve the incoming rate. */
  private thin(): void {
    const keep = (a: number[]) => a.filter((_x, i) => i % 2 === 0 || i === a.length - 1);
    this.t = keep(this.t);
    for (const [n, arr] of this.v) this.v.set(n, keep(arr));
    this.stride *= 2;
  }

  /** The recording as a transient analysis result, or null when fewer than two samples exist. */
  toResult(title: string): AnalysisResult | null {
    if (this.t.length < 2) return null;
    const scale: Vector = { name: 'time', unit: 's', re: Float64Array.from(this.t) };
    const vectors: Vector[] = [...this.v].map(([name, arr]) => ({ name, unit: unitOf(name), re: Float64Array.from(arr) }));
    return { type: 'tran', title, scale, vectors, warnings: [] };
  }
}
