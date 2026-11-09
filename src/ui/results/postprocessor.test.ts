import { describe, expect, it } from 'vitest';
import type { AnalysisResult, Vector } from '../../sim/results';
import { PostprocessorError, availableVectorNames, compileExpression, evaluateExpression } from './postprocessor';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

function vec(name: string, re: number[], im?: number[], unit: Vector['unit'] = 'V'): Vector {
  const v: Vector = { name, unit, re: Float64Array.from(re) };
  if (im) v.im = Float64Array.from(im);
  return v;
}

/** AC result: V(in) = 1, V(out) = 1/(1 + j f/1000) at f = 10, 1000, 100000 Hz */
const freqs = [10, 1000, 100000];
const outRe: number[] = [];
const outIm: number[] = [];
for (const f of freqs) {
  const x = f / 1000;
  outRe.push(1 / (1 + x * x));
  outIm.push(-x / (1 + x * x));
}
const ac: AnalysisResult = {
  type: 'ac',
  title: 'AC analysis',
  scale: vec('frequency', freqs, undefined, 'Hz'),
  vectors: [vec('V(in)', [1, 1, 1], [0, 0, 0]), vec('V(out)', outRe, outIm)],
  warnings: [],
};

/** Transient: 1 kHz sine of amplitude 2 sampled at 2001 points over 2 ms; V(b) = 0.5 */
const N = 2001;
const time = Array.from({ length: N }, (_, i) => (i / (N - 1)) * 2e-3);
const tran: AnalysisResult = {
  type: 'tran',
  title: 'Transient',
  scale: vec('time', time, undefined, 's'),
  vectors: [
    vec('V(a)', time.map((t) => 2 * Math.sin(2 * Math.PI * 1000 * t))),
    vec('V(b)', time.map(() => 0.5)),
    vec('I(V1)', time.map((t) => 1e-3 * t), undefined, 'A'),
    vec('V(ramp)', time.map((t) => 1000 * t)),
  ],
  warnings: [],
};

const ev = (e: string, r: AnalysisResult = tran) => evaluateExpression(e, { result: r });

describe('postprocessor parsing', () => {
  it('collects vector references and treats V(a,b) as one reference', () => {
    const c = compileExpression('db(V(out)/V(in)) + V(a, b) * 2k');
    expect(c.references).toEqual(['V(out)', 'V(in)', 'V(a,b)']);
  });

  it('reports syntax errors with a position', () => {
    expect(() => compileExpression('V(out) +')).toThrow(PostprocessorError);
    try {
      compileExpression('2 * (V(a) + 1');
    } catch (e) {
      expect(e).toBeInstanceOf(PostprocessorError);
      expect((e as PostprocessorError).position).toBe(13);
    }
    expect(() => compileExpression('max(1,2,3)')).toThrow(/argument/);
    expect(() => compileExpression('')).toThrow(/Empty/);
  });
});

describe('postprocessor arithmetic', () => {
  it('honours precedence, right-associative power and SPICE suffixes', () => {
    expect(ev('1 + 2 * 3').value).toBe(7);
    expect(ev('-2^2').value).toBe(-4);
    expect(ev('2^3^2').value).toBe(512);
    expect(ev('(1 + 2) * 3').value).toBe(9);
    expect(ev('1k + 2meg + 3m + 4u').value).toBeCloseTo(2001000.003004, 9);
    expect(ev('pi').value).toBeCloseTo(Math.PI, 15);
  });

  it('does complex arithmetic with j', () => {
    const r = ev('(1 + 2*j) * (3 - j)');
    expect(r.value).toBeCloseTo(5, 12);
    expect(r.valueIm).toBeCloseTo(5, 12);
    const d = ev('1 / j');
    expect(d.value).toBeCloseTo(0, 12);
    expect(d.valueIm).toBeCloseTo(-1, 12);
    const s = ev('sqrt(-4)');
    expect(s.value).toBeCloseTo(0, 12);
    expect(s.valueIm).toBeCloseTo(2, 12);
    const p = ev('(-8)^(1/3)');
    expect(p.value).toBeCloseTo(1, 12); // principal cube root: 2 * e^{j pi/3}
    expect(p.valueIm).toBeCloseTo(Math.sqrt(3), 12);
  });

  it('broadcasts scalars over vectors and subtracts node pairs', () => {
    const r = ev('V(a,b)');
    expect(r.vector.re.length).toBe(N);
    expect(r.vector.re[250]).toBeCloseTo(2 * Math.sin(Math.PI / 2) - 0.5, 9); // t = 0.25 ms
    const k = ev('2 * V(b) + 1');
    expect(k.vector.re[0]).toBe(2);
    expect(k.scalar).toBe(false);
    expect(ev('b').vector.re[3]).toBe(0.5); // bare node name resolves to V(b)
    expect(ev('V(a, 0)').vector.re[250]).toBeCloseTo(2, 9);
    expect(ev('V(0)').value).toBe(0);
  });

  it('rejects unknown vectors and mismatched lengths', () => {
    expect(() => ev('V(nope)')).toThrow(/Unknown vector/);
    const bad: AnalysisResult = { ...tran, vectors: [...tran.vectors, vec('V(short)', [1, 2])] };
    expect(() => ev('V(a) + V(short)', bad)).toThrow(/length mismatch/);
  });
});

describe('postprocessor AC functions', () => {
  it('computes gain in dB, magnitude, phase, real and imaginary parts', () => {
    const g = ev('db(V(out)/V(in))', ac);
    expect(g.vector.unit).toBe('dB');
    expect(g.vector.re[0]).toBeCloseTo(10 * Math.log10(1 / 1.0001), 9);
    expect(g.vector.re[1]).toBeCloseTo(-3.0103, 4);
    expect(g.vector.re[2]).toBeCloseTo(-40.0004, 4);
    const p = ev('ph(V(out))', ac);
    expect(p.vector.unit).toBe('deg');
    expect(p.vector.re[1]).toBeCloseTo(-45, 9);
    expect(ev('vdb(out)', ac).vector.re[1]).toBeCloseTo(-3.0103, 4);
    expect(ev('vp(out)', ac).vector.re[2]).toBeCloseTo((-Math.atan(100) * 180) / Math.PI, 9);
    expect(ev('mag(V(out))', ac).vector.re[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(ev('real(V(out))', ac).vector.re[1]).toBeCloseTo(0.5, 12);
    expect(ev('imag(V(out))', ac).vector.re[1]).toBeCloseTo(-0.5, 12);
    const v = ev('V(out)/V(in)', ac).vector;
    expect(v.im).toBeDefined();
    expect(v.im![1]).toBeCloseTo(-0.5, 12);
    expect(ev('frequency * 2', ac).vector.re[2]).toBe(200000);
  });
});

describe('postprocessor scale functions', () => {
  it('derivative of a sine is a cosine, integral of a ramp is quadratic', () => {
    const d = ev('deriv(V(a))').vector.re;
    // d/dt 2 sin(wt) = 2w cos(wt), checked at interior points
    const w = 2 * Math.PI * 1000;
    expect(d[1000] / (2 * w)).toBeCloseTo(Math.cos(w * time[1000]), 4);
    expect(d[250] / (2 * w)).toBeCloseTo(Math.cos(w * time[250]), 4);
    const i = ev('integ(V(ramp))').vector.re;
    // integral of 1000 t dt = 500 t^2; at t = 2 ms -> 2e-3
    expect(i[N - 1]).toBeCloseTo(500 * 4e-6, 12);
  });

  it('running avg / rms, scalar mean, max and min', () => {
    const r = ev('rms(V(a))').vector.re;
    expect(r[N - 1]).toBeCloseTo(Math.SQRT2, 5); // 2 / sqrt(2) over whole periods
    const a = ev('avg(V(a))').vector.re;
    expect(a[N - 1]).toBeCloseTo(0, 6);
    expect(ev('mean(V(ramp))').value).toBeCloseTo(1, 12); // ramp 0..2 averages to 1
    expect(ev('max(V(a))').value).toBeCloseTo(2, 6);
    expect(ev('min(V(a))').value).toBeCloseTo(-2, 6);
    expect(ev('max(V(a)) - min(V(a))').value).toBeCloseTo(4, 6);
    const m2 = ev('max(V(a), V(b))').vector.re;
    expect(m2[0]).toBe(0.5);
    expect(m2[250]).toBeCloseTo(2, 9);
    const sc = ev('max(V(a))');
    expect(sc.scalar).toBe(true);
    expect(sc.vector.re.length).toBe(N); // broadcast for plotting
  });

  it('element-wise math functions', () => {
    expect(ev('abs(-3)').value).toBe(3);
    expect(ev('log10(1000)').value).toBeCloseTo(3, 12);
    expect(ev('log(e)').value).toBeCloseTo(1, 12);
    expect(ev('sqrt(16)').value).toBe(4);
    expect(ev('sin(pi/2) + cos(0)').value).toBeCloseTo(2, 12);
    expect(ev('I(V1) * 1k').vector.re[N - 1]).toBeCloseTo(2e-3, 12);
    expect(ev('time').vector.re[N - 1]).toBeCloseTo(2e-3, 15);
  });

  it('scale functions need a scale', () => {
    const op: AnalysisResult = { type: 'op', title: 'OP', vectors: [vec('V(x)', [3])], warnings: [] };
    expect(ev('V(x) * 2', op).value).toBe(6);
    expect(() => ev('deriv(V(x))', op)).toThrow(/swept/);
  });

  it('lists available names', () => {
    expect(availableVectorNames(ac)).toEqual(['frequency', 'V(in)', 'V(out)']);
  });
});
