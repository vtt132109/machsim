import { describe, expect, it } from 'vitest';
import { writeSpice } from './writer';
import { parseSpice } from './parser';
import { flattenNetlist } from './flatten';
import { formatSpiceNumber, parseSpiceNumberExact } from './numbers';
import { emptyNetlist, type ElementIR, type Netlist, type SubcktDef } from '../netlist';

/** Deep copy without ElementIR.line (not preserved by the writer). */
function withoutLines(n: Netlist): Netlist {
  const strip = (els: ElementIR[]) =>
    els.map((e) => {
      const c = { ...e };
      delete c.line;
      return c;
    });
  const stripSub = (defs: Record<string, SubcktDef>): Record<string, SubcktDef> =>
    Object.fromEntries(
      Object.entries(defs).map(([k, d]) => [k, { ...d, elements: strip(d.elements), subckts: stripSub(d.subckts) }]),
    );
  const copy = structuredClone(n);
  return { ...copy, elements: strip(copy.elements), subckts: stripSub(copy.subckts) };
}

function parsed(text: string): Netlist {
  const r = parseSpice(text);
  expect(r.errors).toEqual([]);
  return r.netlist;
}

function roundTrip(n: Netlist, lineWidth?: number): { text: string; back: Netlist } {
  const text = writeSpice(n, { lineWidth });
  const r = parseSpice(text);
  expect(r.errors).toEqual([]);
  return { text, back: r.netlist };
}

const FULL = [
  'Round trip test',
  '.global vcc vee',
  '.param rbase=1k gain={rbase/100} f0=1.5k',
  '.func sq(x) {x*x}',
  '.model DMOD D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)',
  '.model QN NPN(BF=255.9 IS=14.34f VAF=74.03 MFG="NXP Semi" part=2N2222)',
  '.model MN NMOS(LEVEL=3 VTO=0.8 KP=50u)',
  '.model DX D',
  '.model DP D(IS={rbase*1e-17})',
  '.model SW1 SW(Ron=1 Roff=1meg Vt=0.5)',
  '.model CS1 CSW(It=1m Ih=0.1m)',
  '.model LT LTRA(R=0.1 L=1u C=1p LEN=1)',
  '.model AND2 d_and(rise_delay=1n fall_delay=2n)',
  '.model PW pwl(x_array=[-1 0 1] y_array=[0 0 1])',
  '.subckt amp in out PARAMS: g=10 rin={2*rbase}',
  '.param rf={g*rin}',
  '.func half(v) {v/2}',
  '.model DL D(IS=1n)',
  'R1 in mid {rin}',
  'X1 mid out stage k={half(g)}',
  '.subckt stage a b params: k=1',
  'E1 b 0 a 0 {k}',
  '.ends stage',
  'D1 mid 0 DL',
  '.ends amp',
  'R1 in out 4k7 tc=0.001,2e-6 m=2',
  'R2 out 0 RMODX 10',
  '.model RMODX R(tc1=1m)',
  'R3 out 0 {sq(gain)}',
  'C1 out 0 2.2u ic=1.5',
  'L1 out 1 10m ic=1m',
  'L2 1 0 1m',
  'K1 L1 L2 0.98',
  'V1 in 0 DC 5 AC 1 45 SIN(0 {gain} {f0} 1m 10 90)',
  'V2 2 0 PULSE(0 5 1n 2n 3n 1u 2u)',
  'V3 3 0 PWL(0 0 {1/f0} 1 2m 0) r=1m td={1/f0}',
  'V4 4 0 dc 0 ac 2 distof1 0.1 90 distof2 0.2',
  'V5 5 0',
  'V6 6 0 dc={rbase/200} Rser=1',
  'V7 7 0 EXP(0 1 1u 1u 5u 2u)',
  'V8 8 0 SFFM(0 1 10k 5 1k)',
  'I1 0 9 AM(1 0.5 1k 100k 1m)',
  'I2 0 9 1.25m AC 1',
  'E1 out 0 in 0 10',
  'G1 out 0 in 0 {1/rbase}',
  'F1 out 0 V1 2',
  'H1 out 0 V1 1k',
  'E2 out 0 VALUE = {V(in) * 2 + 1}',
  'E3 a 0 POLY(2) 1 0 2 0 0.5 1 1 0 3',
  'G2 y 0 TABLE {V(in)} = (0,0) (1,5) (2,6)',
  'B1 out 0 V=V(in)^2 + sin(2*pi*1k*time)',
  'B2 a b I={I(V1) * 2} tc1=0.01',
  'D1 a k DMOD 2 off ic=0.6',
  'D2 a k DMOD area={gain} m=2',
  'Q1 c b e QN',
  'Q2 c b e sub QN 1.5 off ic=0.7,5',
  'J1 d g s JX 2 ic=1,-1',
  '.model JX NJF',
  'M1 d g s b MN L=1u W=10u AD=1p AS=1p PD=4u PS=4u m=4 ic=1,2,0',
  'M2 d g s MN off',
  'Z1 d g s ZM off',
  '.model ZM NMF',
  'S1 1 2 3 0 SW1 off',
  'W1 1 2 V1 CS1 on',
  'T1 1 0 2 0 z0=50 td=10n',
  'T2 1 0 2 0 Z0=75 f=1meg nl=0.5 ic=1,2,3,4',
  'O1 1 0 2 0 LT',
  'X1 in out amp g=5',
  'X2 in out amp PARAMS: g={gain*2} rin=10k',
  'A1 [a b] y AND2',
  'A2 %vd(in 0) out AND2',
  'A3 x ~y AND2',
  '.options reltol=1e-4 abstol=1p method=gear maxord=3 gminsteps=5 srcsteps=8',
  '.temp 85',
  '.ic V(out)=1.5 V(in)=0',
  '.nodeset V(mid)=2.5',
  '.save V(out) I(V1) all ic(Q1)',
  '.op',
  '.dc V1 0 5 0.1 V2 0 1 0.5',
  '.dc temp -40 125 5',
  '.ac dec 10 1 1meg',
  '.ac list 1k 2k 5k',
  '.tran 1u 10m',
  '.tran 0.1u 2m 1m 10n uic',
  '.noise V(out, ref) V1 lin 20 1k 2k',
  '.tf V(out) V1',
  '.sens I(V1) ac dec 5 1 1k',
  '.pz in 0 out 0 vol pz',
  '.four 1k 7 V(out) V(in)',
  '.disto dec 10 1k 1meg 0.9',
  '.end',
].join('\n');

describe('writer -> parser round trip', () => {
  it('reproduces every card form exactly', () => {
    const original = parsed(FULL);
    const { text, back } = roundTrip(original);
    expect(withoutLines(back)).toEqual(withoutLines(original));
    // and a second round trip is textually stable
    expect(writeSpice(back)).toBe(text);
  });

  it('round-trips with line folding disabled and with very narrow folding', () => {
    const original = parsed(FULL);
    expect(withoutLines(roundTrip(original, 0).back)).toEqual(withoutLines(original));
    const narrow = roundTrip(original, 24);
    expect(withoutLines(narrow.back)).toEqual(withoutLines(original));
    expect(narrow.text).toMatch(/\n\+ /);
  });

  it('round-trips a flattened netlist', () => {
    const flat = flattenNetlist(parsed(FULL));
    const { back } = roundTrip(flat);
    expect(withoutLines(back)).toEqual(withoutLines(flat));
  });

  it('writes analyses without a SPICE card as pragmas and reads them back', () => {
    const n = emptyNetlist('pragmas');
    n.elements.push({ type: 'R', name: 'R1', nodes: ['1', '0'], value: 1e3, params: {} });
    n.analyses.push(
      { type: 'acsingle', freq: 1e3 },
      { type: 'paramsweep', target: 'R1', param: 'value', values: [1, 2], base: { type: 'op' } },
      { type: 'tempsweep', temps: [0, 50], base: { type: 'tran', tstep: 1e-6, tstop: 1e-3 } },
      {
        type: 'montecarlo',
        runs: 10,
        seed: 3,
        tolerances: [{ target: 'R1', param: 'value', tol: 0.05, dist: 'gaussian' }],
        base: { type: 'op' },
        measure: { output: 'V(1)', func: 'max' },
      },
      { type: 'four', fundamental: 50, harmonics: 9, outputs: ['V(1)'], settleCycles: 4 },
      { type: 'tran', tstep: 1e-6, tstop: 1e-3, tmax: 1e-7 },
      { type: 'ac', sweep: 'dec', points: 10, fstart: 1, fstop: 1e3, list: [5] },
      { type: 'noisefig', output: '1', src: 'V1', rsource: 50, freq: 1e3 },
      { type: 'batch', items: [{ type: 'op' }, { type: 'tf', output: 'V(1)', src: 'V1' }] },
    );
    const { text, back } = roundTrip(n);
    expect(back.analyses).toEqual(n.analyses);
    expect(text.split('\n').filter((l) => l.startsWith('*@machsim analysis '))).toHaveLength(9);
  });

  it('round-trips hand-built IR with numeric overrides on instances as equivalent text', () => {
    const n = emptyNetlist('lib');
    n.subckts.cell = { name: 'cell', ports: ['a'], params: { r: '1k' }, elements: [{ type: 'R', name: 'R1', nodes: ['a', '0'], params: {}, stringParams: { value: 'r' } }], models: {}, subckts: {} };
    n.elements.push({ type: 'X', name: 'X1', nodes: ['n'], model: 'cell', params: { r: 2200 } });
    const { back } = roundTrip(n);
    expect(back.elements[0]).toMatchObject({ type: 'X', stringParams: { r: '2.2k' } });
    expect(flattenNetlist(back).elements[0]).toMatchObject({ name: 'R.X1.R1', value: 2200 });
  });
});

describe('formatting details', () => {
  it('writes compact, exact numbers', () => {
    for (const v of [0, 1, -1, 1500, 1e6, 2.2e-6, 3e-9, 1 / 3, Math.PI * 1e-12, 4.7e3, 1e-21, 6.02e23, -0.25, 25.4e-6]) {
      expect(parseSpiceNumberExact(formatSpiceNumber(v))).toBe(v);
    }
    expect(formatSpiceNumber(1500)).toBe('1.5k');
    expect(formatSpiceNumber(1e6)).toBe('1meg');
    expect(formatSpiceNumber(3e-9)).toBe('3n');
    expect(formatSpiceNumber(1 / 3)).toBe(String(1 / 3));
    expect(formatSpiceNumber(Infinity)).toBe('1e999');
    expect(parseSpiceNumberExact('1e999')).toBe(Infinity);
  });

  it('reads suffixed numbers exactly', () => {
    expect(parseSpiceNumberExact('3n')).toBe(3e-9);
    expect(parseSpiceNumberExact('2.2uF')).toBe(2.2e-6);
    expect(parseSpiceNumberExact('1.5e3k')).toBe(1.5e6);
    expect(parseSpiceNumberExact('10MEG')).toBe(1e7);
    expect(parseSpiceNumberExact('5m')).toBe(5e-3);
    expect(parseSpiceNumberExact('2mil')).toBeCloseTo(50.8e-6, 18);
    expect(parseSpiceNumberExact('x')).toBeNaN();
  });

  it('produces readable cards', () => {
    const text = writeSpice(
      parsed('demo\n.param a=1k\nR1 1 0 {a*2}\nV1 1 0 DC 5 SIN(0 1 1k)\nB1 2 0 I=V(1)/a\nX1 1 2 sub k=3\n.subckt sub p q params: k=1\nR1 p q {k}\n.ends\n.tran 1u 1m\n'),
    );
    expect(text).toBe(
      [
        'demo',
        '.param a=1k',
        '.subckt sub p q params: k=1',
        'R1 p q {k}',
        '.ends sub',
        'R1 1 0 {a*2}',
        'V1 1 0 DC 5 SIN(0 1 1k)',
        'B1 2 0 I={V(1)/a}',
        'X1 1 2 sub params: k=3',
        '.tran 1u 1m',
        '.end',
        '',
      ].join('\n'),
    );
  });
});
