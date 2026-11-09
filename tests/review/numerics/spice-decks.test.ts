/**
 * Review: SPICE decks parsed by parseSpice and solved, checked against hand values.
 * Covers number suffixes, .param / {expr}, parameterised subcircuits, continuation and comment
 * forms, controlled-source sign conventions (SPICE3 manual definitions), waveform sources,
 * .temp, title / .end rules. Linear circuits → exact answers (1e-9 relative).
 */
import { describe, expect, it } from 'vitest';
import { parseSpice } from '../../../src/sim/spice';
import { interp, opValue, runDeck, scaleOf, vec } from './ref';

describe('number syntax', () => {
  const cases: [string, number][] = [
    ['1MEG', 1e6],
    ['1M', 1e-3],
    ['1m', 1e-3],
    ['2.2k', 2.2e3],
    ['1.5Kohm', 1.5e3],
    ['10uF', 1e-5],
    ['1mil', 25.4e-6],
    ['3e3', 3e3],
    ['.5', 0.5],
    ['4.7G', 4.7e9],
    ['1T', 1e12],
    ['100f', 100e-15],
    ['1p', 1e-12],
  ];
  for (const [text, value] of cases) {
    it(`R value ${text} = ${value}`, () => {
      const p = parseSpice(`numbers\nR1 a 0 ${text}\n.end`);
      expect(p.errors).toEqual([]);
      expect(p.netlist.elements[0].value).toBeCloseTo(value, 20);
      expect(p.netlist.elements[0].value! / value).toBeCloseTo(1, 12);
    });
  }
});

describe('title, comments, continuation, .end', () => {
  it('the first line is the title even when it looks like an element', () => {
    const p = parseSpice('R1 a 0 1k\nR2 a 0 2k\n.end');
    expect(p.errors).toEqual([]);
    expect(p.netlist.title).toBe('R1 a 0 1k');
    expect(p.netlist.elements.map((e) => e.name)).toEqual(['R2']);
  });

  it('continuations across comment / blank lines, inline ; and $ comments, cards after .end ignored', () => {
    const [r] = runDeck(`continuation
I1 0 a
* a comment between continuation lines

+ DC 1m ; inline comment
R1 a 0 $ another comment
+ 2k
.op
.end
R2 a 0 1
`);
    expect(opValue(r, 'V(a)')).toBeCloseTo(2, 12);
  });

  it('GND alias and case-insensitive model names', () => {
    const [r] = runDeck(`gnd alias
V1 a GND 1
R1 a b 1k
D1 b gnd MyDiode
.MODEL mydiode D(is=1e-14)
.op
.END`);
    expect(opValue(r, 'V(b)')).toBeGreaterThan(0.5);
    expect(opValue(r, 'V(b)')).toBeLessThan(0.75);
  });
});

describe('.param, {expr} and parameterised subcircuits', () => {
  it('global params and expressions in values', () => {
    const [r] = runDeck(`params
.param rval=2k vin={2*1.5}
V1 a 0 {vin}
R1 a b {rval}
R2 b 0 {rval*2}
.op
.end`);
    expect(opValue(r, 'V(b)')).toBeCloseTo(3 * (4 / 6), 12);
  });

  it('subcircuit defaults and instance overrides', () => {
    const [r] = runDeck(`subckt params
.subckt div in out params: ra=1k rb=1k
R1 in out {ra}
R2 out 0 {rb}
.ends div
V1 a 0 10
X1 a o1 div
X2 a o2 div ra=3k
X3 a o3 div ra=1k rb=4k
.op
.end`);
    expect(opValue(r, 'V(o1)')).toBeCloseTo(5, 12);
    expect(opValue(r, 'V(o2)')).toBeCloseTo(2.5, 12);
    expect(opValue(r, 'V(o3)')).toBeCloseTo(8, 12);
  });

  it('nested subcircuits keep internal nodes separate per instance', () => {
    const [r] = runDeck(`nested
.subckt half in out
R1 in mid 1k
R2 mid out 1k
.ends
.subckt quarter in out
X1 in m half
X2 m out half
R3 m 0 4k
.ends
V1 a 0 6
XA a oa quarter
RLA oa 0 1e12
XB a ob quarter
RLB ob 0 2k
.op
.end`);
    // XA: unloaded → out = m; m = 6·4k/(2k+4k) = 4
    expect(opValue(r, 'V(oa)')).toBeCloseTo(4, 6);
    // XB: m sees 4k ‖ (2k+2k) = 2k → m = 6·2k/(2k+2k) = 3, out = 3·2k/4k = 1.5
    expect(opValue(r, 'V(ob)')).toBeCloseTo(1.5, 9);
  });
});

describe('controlled sources (SPICE3 sign conventions)', () => {
  it('E, F, G, H', () => {
    const [r] = runDeck(`controlled
I1 0 a 1m
V1 a 0 0
E1 e 0 c 0 3
F1 0 f V1 2
G1 0 g c 0 1m
H1 h 0 V1 1k
VC c 0 1
RE e 0 1k
RF f 0 1k
RG g 0 1k
RH h 0 1k
.op
.end`);
    expect(opValue(r, 'I(V1)')).toBeCloseTo(1e-3, 15);
    expect(opValue(r, 'V(e)')).toBeCloseTo(3, 12);
    expect(opValue(r, 'V(f)')).toBeCloseTo(2, 12);
    expect(opValue(r, 'V(g)')).toBeCloseTo(1, 12);
    expect(opValue(r, 'V(h)')).toBeCloseTo(1, 12);
  });

  it('a source delivering power has a negative branch current; I(R) flows n+ → n−', () => {
    const [r] = runDeck(`signs
V1 a 0 10
R1 a 0 1k
.op
.end`);
    expect(opValue(r, 'I(V1)')).toBeCloseTo(-0.01, 15);
    expect(opValue(r, 'I(R1)')).toBeCloseTo(0.01, 15);
    expect(opValue(r, 'P(R1)')).toBeCloseTo(0.1, 12);
  });
});

describe('waveform sources', () => {
  it('PWL with repeat, EXP and SIN with delay/damping', () => {
    const [r] = runDeck(`waves
V1 a 0 PWL(0 0 1m 1 2m 0)
V2 b 0 EXP(0 1 1m 0.2m 3m 0.5m)
V3 c 0 SIN(0.5 1 1k 1m 500)
R1 a 0 1k
R2 b 0 1k
R3 c 0 1k
.tran 10u 5m
.end`);
    const t = scaleOf(r);
    const a = vec(r, 'V(a)').re;
    const b = vec(r, 'V(b)').re;
    const c = vec(r, 'V(c)').re;
    expect(interp(t, a, 0.5e-3)).toBeCloseTo(0.5, 9);
    expect(interp(t, a, 1e-3)).toBeCloseTo(1, 9);
    expect(interp(t, a, 4e-3)).toBeCloseTo(0, 9); // holds the last value
    // EXP: rise from TD1 with TAU1, fall from TD2 with TAU2
    const expAt = (tt: number) =>
      tt < 1e-3 ? 0 : tt < 3e-3 ? 1 - Math.exp(-(tt - 1e-3) / 0.2e-3) : (1 - Math.exp(-(tt - 1e-3) / 0.2e-3)) + (0 - 1) * (1 - Math.exp(-(tt - 3e-3) / 0.5e-3));
    for (const tt of [1.5e-3, 2.9e-3, 3.5e-3, 4.5e-3]) expect(Math.abs(interp(t, b, tt) - expAt(tt))).toBeLessThan(2e-3);
    // SIN: VO + VA·e^(−θ(t−TD))·sin(2πf(t−TD)) for t ≥ TD
    const sinAt = (tt: number) => (tt < 1e-3 ? 0.5 : 0.5 + Math.exp(-500 * (tt - 1e-3)) * Math.sin(2 * Math.PI * 1e3 * (tt - 1e-3)));
    for (const tt of [0.5e-3, 1.25e-3, 2.25e-3, 3.75e-3]) expect(Math.abs(interp(t, c, tt) - sinAt(tt))).toBeLessThan(3e-3);
  });

  it('PWL r= repeat', () => {
    const [r] = runDeck(`pwl repeat
V1 a 0 PWL(0 0 1m 1 2m 0) r=0
R1 a 0 1k
.tran 10u 6m
.end`);
    const t = scaleOf(r);
    const a = vec(r, 'V(a)').re;
    expect(interp(t, a, 2.5e-3)).toBeCloseTo(0.5, 6);
    expect(interp(t, a, 5e-3)).toBeCloseTo(1, 6);
  });
});

describe('.temp and .step', () => {
  it('.temp 100 sets the circuit temperature', () => {
    const [r] = runDeck(`temp card
I1 0 a 1m
R1 a 0 1k tc1=0.01
.temp 100
.op
.end`);
    expect(opValue(r, 'V(a)')).toBeCloseTo(1 + 0.01 * 73, 9);
  });

  it('.step of a resistor value gives one run per value', () => {
    const results = runDeck(`step
V1 a 0 1
R1 a b 1k
R2 b 0 1k
.step R2 list 1k 3k
.op
.end`);
    const runs = results[0].runs ?? [];
    expect(runs.length).toBe(2);
    expect(opValue(runs[0].result, 'V(b)')).toBeCloseTo(0.5, 12);
    expect(opValue(runs[1].result, 'V(b)')).toBeCloseTo(0.75, 12);
  });
});
