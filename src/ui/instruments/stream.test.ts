import { describe, expect, it } from 'vitest';
import type { InstrumentBinding } from '../../model/types';
import { pushTransientChunk, resultSignal, signalLabel, signalVectorNames } from './signals';
import { InstrumentStream, createInstrumentStream } from './types';

describe('InstrumentStream ring buffer', () => {
  it('stores samples in order and reads windows by time', () => {
    const s = new InstrumentStream(['A', 'B']);
    for (let i = 0; i < 10; i++) s.push(i * 0.1, [i, -i]);
    expect(s.length).toBe(10);
    expect(s.startTime).toBe(0);
    expect(s.endTime).toBeCloseTo(0.9, 12);
    const w = s.read(0.25, 0.55, { edges: false });
    expect(Array.from(w.time).map((t) => Number(t.toFixed(3)))).toEqual([0.3, 0.4, 0.5]);
    expect(Array.from(w.values.A)).toEqual([3, 4, 5]);
    expect(Array.from(w.values.B)).toEqual([-3, -4, -5]);
    // edges include one neighbour on each side
    const e = s.read(0.25, 0.55);
    expect(Array.from(e.values.A)).toEqual([2, 3, 4, 5, 6]);
  });

  it('grows past its initial allocation and keeps every sample up to capacity', () => {
    const s = new InstrumentStream(['x'], 20000);
    for (let i = 0; i < 15000; i++) s.push(i, [i * 2]);
    expect(s.length).toBe(15000);
    expect(s.valueAt('x', 0)).toBe(0);
    expect(s.valueAt('x', 14999)).toBe(29998);
    expect(s.indexAtOrBefore(1234.5)).toBe(1234);
  });

  it('overwrites the oldest samples once full', () => {
    const s = new InstrumentStream(['x'], 8);
    for (let i = 0; i < 20; i++) s.push(i, [i]);
    expect(s.length).toBe(8);
    expect(s.startTime).toBe(12);
    expect(s.endTime).toBe(19);
    expect(Array.from(s.readLast(3).values.x)).toEqual([17, 18, 19]);
    expect(Array.from(s.read(0, 13, { edges: false }).values.x)).toEqual([12, 13]);
  });

  it('handles a million samples per channel with cheap windowed reads', () => {
    const s = new InstrumentStream(['a', 'b']);
    const n = 1_000_000;
    const row = new Float64Array(2);
    for (let i = 0; i < n; i++) {
      row[0] = i;
      row[1] = -i;
      s.push(i * 1e-6, row);
    }
    expect(s.length).toBe(n);
    const w = s.read(0.5, 0.5001, { edges: false });
    expect(w.time.length).toBe(101);
    expect(w.values.a[0]).toBe(500000);
    expect(w.values.b[100]).toBe(-500100);
  });

  it('accepts records by channel name (case-insensitive) and NaN-fills missing channels', () => {
    const s = new InstrumentStream(['A', 'B']);
    s.push(0, { a: 1 });
    s.push(1, { B: 2, extra: 9 });
    expect(s.valueAt('A', 0)).toBe(1);
    expect(Number.isNaN(s.valueAt('B', 0))).toBe(true);
    expect(s.valueAt('b', 1)).toBe(2);
    expect(s.latest()).toEqual({ time: 1, values: { A: Number.NaN, B: 2 } });
  });

  it('clears on a time reversal (simulation restart) and on clear()', () => {
    const s = new InstrumentStream(['x']);
    s.push(0, [1]);
    s.push(1, [2]);
    const v = s.version;
    s.push(0.5, [3]);
    expect(s.length).toBe(1);
    expect(s.startTime).toBe(0.5);
    expect(s.version).toBeGreaterThan(v);
    s.clear();
    expect(s.length).toBe(0);
    expect(Number.isNaN(s.endTime)).toBe(true);
    expect(s.read(0, 1).time.length).toBe(0);
  });

  it('readRecent returns the trailing duration', () => {
    const s = new InstrumentStream(['x']);
    for (let i = 0; i <= 100; i++) s.push(i / 100, [i]);
    const w = s.readRecent(0.1);
    expect(w.time[0]).toBeCloseTo(0.9, 12);
    expect(w.values.x.length).toBe(11);
  });
});

describe('signal resolution', () => {
  const binding: InstrumentBinding = {
    refdes: 'XSC1',
    partId: 'instruments/scope',
    kind: 'oscilloscope',
    params: {},
    channels: {
      A: { kind: 'voltage', pos: 'out', neg: '0' },
      B: { kind: 'voltage', pos: 'a', neg: 'b' },
      I: { kind: 'current', element: 'Vsense' },
      M: { kind: 'voltage', pos: 'missing', neg: '0' },
    },
    drives: [],
  };

  it('pushes transient chunks as differential voltages and branch currents', () => {
    const stream = createInstrumentStream(binding);
    pushTransientChunk(stream, binding, {
      time: Float64Array.of(0, 1e-3),
      vectors: {
        'V(OUT)': Float64Array.of(1, 2),
        'V(a)': Float64Array.of(5, 6),
        'V(b)': Float64Array.of(1, 1),
        'I(vsense)': Float64Array.of(1e-3, 2e-3),
      },
    });
    expect(stream.channels).toEqual(['A', 'B', 'I', 'M']);
    expect(Array.from(stream.readLast(2).values.A)).toEqual([1, 2]);
    expect(Array.from(stream.readLast(2).values.B)).toEqual([4, 5]);
    expect(Array.from(stream.readLast(2).values.I)).toEqual([1e-3, 2e-3]);
    expect(Number.isNaN(stream.valueAt('M', 0))).toBe(true);
  });

  it('names and resolves signals against analysis results', () => {
    expect(signalLabel({ kind: 'voltage', pos: 'a', neg: 'gnd' })).toBe('V(a)');
    expect(signalLabel({ kind: 'voltage', pos: 'a', neg: 'b' })).toBe('V(a,b)');
    expect(signalVectorNames({ kind: 'voltage', pos: 'a', neg: '0' })).toEqual(['V(a)']);
    const r = resultSignal(
      {
        type: 'ac',
        title: 'AC',
        scale: { name: 'frequency', unit: 'Hz', re: Float64Array.of(1, 10) },
        vectors: [
          { name: 'V(a)', unit: 'V', re: Float64Array.of(1, 2), im: Float64Array.of(0, 1) },
          { name: 'V(b)', unit: 'V', re: Float64Array.of(0.5, 0.5), im: Float64Array.of(0.5, 0) },
        ],
        warnings: [],
      },
      { kind: 'voltage', pos: 'A', neg: 'B' },
    );
    expect(Array.from(r!.re)).toEqual([0.5, 1.5]);
    expect(Array.from(r!.im)).toEqual([-0.5, 1]);
  });
});
