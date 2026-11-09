/**
 * Interactive-session recorder: capture into a transient result with bounded memory.
 */
import { describe, expect, it } from 'vitest';
import { ChunkRecorder } from './recorder';

function chunk(t0: number, n: number, dt: number, extra = false) {
  const time = Float64Array.from({ length: n }, (_, i) => t0 + i * dt);
  const vectors: Record<string, Float64Array> = { 'V(out)': time.map((t) => 2 * t) };
  if (extra) vectors['I(V1)'] = time.map(() => 1e-3);
  return { time, vectors };
}

describe('ChunkRecorder', () => {
  it('captures every sample of short sessions as a transient result', () => {
    const r = new ChunkRecorder(1000);
    r.push(chunk(0, 10, 0.1));
    r.push(chunk(1, 10, 0.1, true));
    const res = r.toResult('Mô phỏng tương tác')!;
    expect(res.type).toBe('tran');
    expect(res.scale!.re.length).toBe(20);
    expect(res.vectors.map((v) => v.name)).toEqual(['V(out)', 'I(V1)']);
    expect(res.vectors[0].unit).toBe('V');
    expect(res.vectors[1].unit).toBe('A');
    // a vector that appears later is NaN before its first sample
    expect(Number.isNaN(res.vectors[1].re[0])).toBe(true);
    expect(res.vectors[1].re[15]).toBe(1e-3);
  });

  it('thins long sessions to the limit and keeps the whole time span and the newest sample', () => {
    const r = new ChunkRecorder(100);
    for (let k = 0; k < 50; k++) r.push(chunk(k, 20, 0.05));
    expect(r.length).toBeLessThanOrEqual(100);
    const res = r.toResult('x')!;
    const t = res.scale!.re;
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBeCloseTo(49.95, 9);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThan(t[i - 1]);
    expect(res.vectors[0].re[t.length - 1]).toBeCloseTo(2 * 49.95, 9);
  });

  it('needs two samples', () => {
    const r = new ChunkRecorder();
    expect(r.toResult('x')).toBeNull();
  });
});
