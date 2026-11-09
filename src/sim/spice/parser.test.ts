import { describe, expect, it } from 'vitest';
import { parseSpice, type SpiceParseResult } from './parser';
import type { ElementIR, Netlist } from '../netlist';

/** Parse and require a clean result. */
function ok(text: string, opts?: Parameters<typeof parseSpice>[1]): Netlist {
  const r = parseSpice(text, opts);
  expect(r.errors).toEqual([]);
  return r.netlist;
}

function el(n: Netlist, name: string): ElementIR {
  const e = n.elements.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!e) throw new Error(`element ${name} not found`);
  return e;
}

describe('lines, comments and continuations', () => {
  it('reads the title, skips comments and joins continuation lines', () => {
    const n = ok(
      [
        'My test circuit',
        '* full-line comment',
        '// another comment',
        '; and another',
        'R1 in out 1k ; inline comment',
        'R2 out 0 2k $ ngspice inline comment',
        'R3 out $node 3k',
        'C1 out 0',
        '* comment between continuation lines',
        '+ 10n',
        '',
        'V1 in 0 DC 5 // trailing',
        '.END',
        'R99 a b 1',
      ].join('\n'),
    );
    expect(n.title).toBe('My test circuit');
    expect(n.elements.map((e) => e.name)).toEqual(['R1', 'R2', 'R3', 'C1', 'V1']);
    expect(el(n, 'R1')).toMatchObject({ type: 'R', nodes: ['in', 'out'], value: 1000, line: 5 });
    expect(el(n, 'R3').nodes).toEqual(['out', '$node']);
    expect(el(n, 'C1')).toMatchObject({ nodes: ['out', '0'], value: 10e-9, line: 8 });
    expect(el(n, 'V1').source).toEqual({ dc: 5 });
  });

  it('is case-insensitive for keywords and keeps the case of names', () => {
    const n = ok('t\nvIn In 0 dc 1 Ac 1\n.TrAn 1U 1m\n');
    expect(el(n, 'vin')).toMatchObject({ name: 'vIn', nodes: ['In', '0'], source: { dc: 1, acMag: 1 } });
    expect(n.analyses).toEqual([{ type: 'tran', tstep: 1e-6, tstop: 1e-3 }]);
  });

  it('honours hasTitle: false for library text', () => {
    const n = ok('R1 a b 1\n', { hasTitle: false });
    expect(n.elements).toHaveLength(1);
    expect(n.title).toBe('');
  });

  it('applies .title', () => {
    expect(ok('first\n.title Real title here\n').title).toBe('Real title here');
  });
});

describe('passive elements', () => {
  it('reads R, C, L values, options and models', () => {
    const n = ok(
      [
        't',
        '.model RMOD R(tc1=0.001)',
        '.model CMOD C()',
        'R1 1 2 4k7 tc=0.001,2e-6 m=2 temp=50',
        'R2 1 2 r=1meg',
        'R3 1 2 RMOD 10',
        'R4 1 2 10 RMOD',
        'R5 1 2 {rval*2}',
        'R6 1 2 rval',
        'R7 1 2 2R2 tc1=1m tc2=2u',
        'R8 1 2 47k5',
        'C4 1 0 4n7',
        'C1 1 0 2.2uF ic=1.5',
        'C2 1 0 CMOD 1p',
        'L1 1 2 10mH ic=1m',
        'L2 1 2 l=1u',
        'C3 1 0 1u Rser=0.1',
        '.param rval=1k',
      ].join('\n'),
    );
    expect(el(n, 'R1')).toMatchObject({ value: 4700, params: { tc1: 0.001, tc2: 2e-6, m: 2, temp: 50 } });
    expect(el(n, 'R2').value).toBe(1e6);
    expect(el(n, 'R3')).toMatchObject({ model: 'RMOD', value: 10 });
    expect(el(n, 'R4')).toMatchObject({ model: 'RMOD', value: 10 });
    expect(el(n, 'R5')).toMatchObject({ stringParams: { value: 'rval*2' } });
    expect(el(n, 'R5').value).toBeUndefined();
    expect(el(n, 'R6').stringParams).toEqual({ value: 'rval' });
    expect(el(n, 'R7')).toMatchObject({ value: 2.2, params: { tc1: 1e-3, tc2: 2e-6 } });
    expect(el(n, 'R8').value).toBe(47500);
    expect(el(n, 'C4').value).toBe(4.7e-9);
    expect(el(n, 'C1')).toMatchObject({ value: 2.2e-6, params: { ic: 1.5 } });
    expect(el(n, 'C2')).toMatchObject({ model: 'CMOD', value: 1e-12 });
    expect(el(n, 'L1')).toMatchObject({ value: 10e-3, params: { ic: 1e-3 } });
    expect(el(n, 'L2').value).toBeCloseTo(1e-6, 18);
    // LTspice Rser= is honoured as an explicit series resistor (it used to be stored and ignored)
    expect(el(n, 'C3')).toMatchObject({ params: {}, nodes: ['C3_rser', '0'] });
    expect(el(n, 'RC3_rser')).toMatchObject({ type: 'R', nodes: ['1', 'C3_rser'], value: 0.1 });
  });

  it('reads mutual coupling', () => {
    const n = ok('t\nL1 1 0 1m\nL2 2 0 1m\nL3 3 0 1m\nK1 L1 L2 L3 0.98\nK2 L1 L2 {kc}\n.param kc=0.5\n');
    expect(el(n, 'K1')).toMatchObject({ type: 'K', nodes: [], inductors: ['L1', 'L2', 'L3'], value: 0.98 });
    expect(el(n, 'K2')).toMatchObject({ inductors: ['L1', 'L2'], stringParams: { value: 'kc' } });
  });

  it('warns about a PSpice core model on K', () => {
    const r = parseSpice('t\nK1 L1 L2 0.9 KCORE\n');
    expect(r.errors).toEqual([]);
    expect(r.netlist.elements[0]).toMatchObject({ value: 0.9, inductors: ['L1', 'L2'] });
    expect(r.warnings.join('\n')).toMatch(/line 2: K1: magnetic core model 'KCORE' ignored/);
  });
});

describe('independent sources', () => {
  it('reads DC, AC and DISTOF specifications', () => {
    const n = ok(
      [
        't',
        'V1 1 0 DC 5 AC 1 45',
        'V2 2 0 3.3',
        'V3 3 0 AC',
        'V4 4 0 dc 0 ac 2 distof1 0.1 90 distof2 0.2',
        'I1 0 5 1mA',
        'V5 6 0',
        'V6 7 0 dc={vdd} Rser=1',
        '.param vdd=12',
      ].join('\n'),
    );
    expect(el(n, 'V1').source).toEqual({ dc: 5, acMag: 1, acPhase: 45 });
    expect(el(n, 'V2').source).toEqual({ dc: 3.3 });
    expect(el(n, 'V3').source).toEqual({ acMag: 1 });
    expect(el(n, 'V4').source).toEqual({ dc: 0, acMag: 2, distof1: [0.1, 90], distof2: [0.2, 0] });
    expect(el(n, 'I1')).toMatchObject({ type: 'I', nodes: ['0', '5'], source: { dc: 1e-3 } });
    expect(el(n, 'V5').source).toEqual({});
    expect(el(n, 'V6')).toMatchObject({ source: {}, stringParams: { dc: 'vdd' }, params: {}, nodes: ['V6_rser', '0'] });
    expect(el(n, 'RV6_rser')).toMatchObject({ type: 'R', nodes: ['7', 'V6_rser'], value: 1 });
  });

  it('reads every transient waveform', () => {
    const n = ok(
      [
        't',
        'V1 1 0 SIN(0 1 1k 1m 10 90)',
        'V2 1 0 PULSE(0, 5, 1n, 2n, 3n, 1u, 2u)',
        'V3 1 0 PWL(0 0 1m 1 2m 0) r=1m td=0.5m',
        'V4 1 0 EXP(0 1 1u 1u 5u 2u)',
        'V5 1 0 SFFM(0 1 10k 5 1k)',
        'V6 1 0 AM(1 0.5 1k 100k 1m)',
        'V7 1 0 DC 1 SINE(1 2 50) AC 1',
        'V8 1 0 PWL (0,0) (1m,5) (2m,0)',
        'V9 1 0 pulse 0 1 0 1n 1n 5n 10n',
      ].join('\n'),
    );
    expect(el(n, 'V1').source?.tran).toEqual({ type: 'SIN', args: [0, 1, 1000, 1e-3, 10, 90] });
    expect(el(n, 'V2').source?.tran).toEqual({ type: 'PULSE', args: [0, 5, 1e-9, 2e-9, 3e-9, 1e-6, 2e-6] });
    const pwl = el(n, 'V3').source?.tran;
    expect(pwl?.type).toBe('PWL');
    expect(pwl?.repeatFrom).toBe(1e-3);
    expect(pwl?.args).toHaveLength(6);
    [0.5e-3, 0, 1.5e-3, 1, 2.5e-3, 0].forEach((v, i) => expect(pwl?.args[i]).toBeCloseTo(v, 15));
    expect(el(n, 'V4').source?.tran).toEqual({ type: 'EXP', args: [0, 1, 1e-6, 1e-6, 5e-6, 2e-6] });
    expect(el(n, 'V5').source?.tran).toEqual({ type: 'SFFM', args: [0, 1, 1e4, 5, 1e3] });
    expect(el(n, 'V6').source?.tran).toEqual({ type: 'AM', args: [1, 0.5, 1e3, 1e5, 1e-3] });
    expect(el(n, 'V7').source).toEqual({ dc: 1, acMag: 1, tran: { type: 'SIN', args: [1, 2, 50] } });
    expect(el(n, 'V8').source?.tran).toEqual({ type: 'PWL', args: [0, 0, 1e-3, 5, 2e-3, 0] });
    expect(el(n, 'V9').source?.tran).toEqual({ type: 'PULSE', args: [0, 1, 0, 1e-9, 1e-9, 5e-9, 10e-9] });
  });

  it('keeps expression waveform arguments as stringParams', () => {
    const n = ok('t\nV1 1 0 SIN(0 {amp} {f0*2})\nV2 2 0 PWL(0 0 {tr} 1) td={dly} r=0\n.param amp=2 f0=1k tr=1u dly=1m\n');
    const v1 = el(n, 'V1');
    expect(v1.source?.tran?.args.slice(0, 1)).toEqual([0]);
    expect(Number.isNaN(v1.source?.tran?.args[1])).toBe(true);
    expect(v1.stringParams).toEqual({ 'tran[1]': 'amp', 'tran[2]': 'f0*2' });
    const v2 = el(n, 'V2');
    expect(v2.stringParams).toEqual({ 'tran[2]': 'tr', 'tran.td': 'dly' });
    expect(v2.source?.tran?.repeatFrom).toBe(0);
  });

  it('rejects malformed sources with line numbers', () => {
    const r = parseSpice('t\nV1 1 0 PWL(0 0 1m)\nV2 1 0 SIN(0 1\nV3 1 0 1 2\nV4 1 0 trnoise(1 2)\n');
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(r.errors[0].message).toMatch(/PWL needs \(time, value\) pairs/);
    expect(r.errors[1].message).toMatch(/missing '\)'/);
    expect(r.errors[2].message).toMatch(/unexpected '2'/);
    expect(r.errors[3].message).toMatch(/not supported/);
  });
});

describe('controlled and behavioral sources', () => {
  it('reads linear E, F, G, H', () => {
    const n = ok('t\nE1 out 0 in 0 10\nG1 out 0 (in, 0) 1m\nF1 out 0 Vsense 2\nH1 out 0 Vsense 1k\n');
    expect(el(n, 'E1')).toMatchObject({ type: 'E', nodes: ['out', '0', 'in', '0'], value: 10 });
    expect(el(n, 'G1')).toMatchObject({ type: 'G', nodes: ['out', '0', 'in', '0'], value: 1e-3 });
    expect(el(n, 'F1')).toMatchObject({ type: 'F', nodes: ['out', '0'], control: 'Vsense', value: 2 });
    expect(el(n, 'H1')).toMatchObject({ type: 'H', control: 'Vsense', value: 1000 });
  });

  it('turns POLY(1) plain gains into native elements', () => {
    const n = ok('t\nE1 a 0 POLY(1) b 0 0 2.5\nF1 a 0 POLY(1) Vs 0 3\nG1 a 0 POLY(1) (b,0) 0 1m 0\n');
    expect(el(n, 'E1')).toMatchObject({ type: 'E', nodes: ['a', '0', 'b', '0'], value: 2.5 });
    expect(el(n, 'F1')).toMatchObject({ type: 'F', control: 'Vs', value: 3 });
    expect(el(n, 'G1')).toMatchObject({ type: 'G', nodes: ['a', '0', 'b', '0'], value: 1e-3 });
  });

  it('converts other polynomials to B sources', () => {
    const n = ok('t\nE1 a 0 POLY(2) 1 0 2 0 0.5 1 1 0 3\nH1 a 0 POLY(1) Vs 1 2 3\nG2 a 0 POLY(1) b c 0 {gm}\n');
    expect(el(n, 'BE1')).toMatchObject({
      type: 'B',
      nodes: ['a', '0'],
      expr: 'V=0.5 + V(1,0) + V(2,0) + 3 * V(1,0) * V(2,0)',
    });
    expect(el(n, 'BH1').expr).toBe('V=1 + 2 * I(Vs) + 3 * I(Vs) * I(Vs)');
    expect(el(n, 'BG2').expr).toBe('I=(gm) * V(b,c)');
  });

  it('converts VALUE, VOL/CUR and TABLE forms to B sources', () => {
    const n = ok(
      [
        't',
        'E1 out 0 VALUE = {V(in) * 2 + 1}',
        'G1 out 0 value={ V(a,b) / 1k }',
        'E2 x 0 vol=\'V(in)**2\'',
        'G2 x 0 cur=\'limit(V(in), 0, 1m)\'',
        'E3 y 0 TABLE {V(in)} = (0,0) (1,5) (2,6)',
        'G3 y 0 TABLE V(in) = (0, 0) (1, 1m)',
      ].join('\n'),
    );
    expect(el(n, 'BE1')).toMatchObject({ type: 'B', nodes: ['out', '0'], expr: 'V=V(in) * 2 + 1', line: 2 });
    expect(el(n, 'BG1').expr).toBe('I=V(a,b) / 1k');
    expect(el(n, 'BE2').expr).toBe('V=V(in)**2');
    expect(el(n, 'BG2').expr).toBe('I=limit(V(in), 0, 1m)');
    expect(el(n, 'BE3').expr).toBe('V=table(V(in), 0, 0, 1, 5, 2, 6)');
    expect(el(n, 'BG3').expr).toBe('I=table(V(in), 0, 0, 1, 0.001)');
  });

  it('reads B sources with V=, I=, R= and trailing parameters', () => {
    const n = ok(
      [
        't',
        'B1 out 0 V=V(in)^2 + sin(2*pi*1k*time)',
        'B2 a b I = {I(V1) * 2}',
        'B3 c 0 V=V(x) > 1 ? 1 : 0 tc1=0.01',
        'B4 d e R=1k + V(d)',
        'B5 f 0 V=V(f)==1',
      ].join('\n'),
    );
    expect(el(n, 'B1')).toMatchObject({ type: 'B', nodes: ['out', '0'], expr: 'V=V(in)^2 + sin(2*pi*1k*time)' });
    expect(el(n, 'B2').expr).toBe('I=I(V1) * 2');
    expect(el(n, 'B3')).toMatchObject({ expr: 'V=V(x) > 1 ? 1 : 0', params: { tc1: 0.01 } });
    expect(el(n, 'B4').expr).toBe('I=V(d,e) / (1k + V(d))');
    expect(el(n, 'B5').expr).toBe('V=V(f)==1');
  });

  it('reports unsupported or broken controlled sources', () => {
    // LAPLACE sources are supported since the engine round (spice/laplace.ts), FREQ and
    // CHEBYSHEV since round 3 (dialect.test.ts); a FREQ table without whole triples is an error
    const r = parseSpice('t\nE1 a 0 FREQ {V(in)} = (0,0)\nB1 a 0 X=1\nB2 a 0 V={1 +}\nE2 a 0 b 0\n');
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(r.errors[0].message).toMatch(/FREQ needs \(frequency, magnitude, phase\) triples/);
    expect(r.errors[1].message).toMatch(/expected V=<expr>/);
    expect(r.errors[2].message).toMatch(/invalid expression/);
    expect(r.errors[3].message).toMatch(/missing gain/);
  });
});

describe('semiconductors, switches, lines, instances', () => {
  const text = [
    't',
    '.model DMOD D(Is=1e-14)',
    '.model QN NPN(BF=100)',
    '.model JN NJF',
    '.model MN NMOS(LEVEL=1 VTO=0.7)',
    '.model ZM NMF',
    '.model SW1 SW(Ron=1 Roff=1meg Vt=0.5)',
    '.model CS1 CSW(It=1m)',
    '.model LT LTRA(R=0.1 L=1u C=1p LEN=1)',
    '.model AND2 d_and(rise_delay=1n)',
    'D1 a k DMOD',
    'D2 a k DMOD 2 off ic=0.6',
    'D3 a k DMOD area=3 m=2 temp=85',
    'Q1 c b e QN',
    'Q2 c b e sub QN 1.5 off ic=0.7,5',
    'Q3 c b e 0 QN',
    'J1 d g s JN 2 ic=1,-1',
    'M1 d g s b MN L=1u W=10u AD=1p AS=1p PD=4u PS=4u m=4 ic=1,2,0',
    'M2 d g s MN',
    'Z1 d g s ZM off',
    'S1 1 2 3 0 SW1 off',
    'W1 1 2 Vctl CS1 on',
    'T1 1 0 2 0 z0=50 td=10n',
    'T2 1 0 2 0 Z0=75 f=1meg nl=0.5 ic=1,2,3,4',
    'O1 1 0 2 0 LT',
    'X1 in out 0 amp gain=10 rin={2*rbase}',
    'X2 in out filt PARAMS: fc=1k',
    'XU3 a b c',
    'A1 [a b] y AND2',
    'A2 %vd(in 0) out AND2',
    'A3 x ~y AND2',
    'A4 in out AND2',
    '.param rbase=1k',
  ].join('\n');

  it('reads every device form', () => {
    const r = parseSpice(text);
    expect(r.errors).toEqual([]);
    const n = r.netlist;
    expect(el(n, 'D1')).toMatchObject({ type: 'D', nodes: ['a', 'k'], model: 'DMOD', params: {} });
    expect(el(n, 'D2').params).toEqual({ area: 2, off: 1, ic: 0.6 });
    expect(el(n, 'D3').params).toEqual({ area: 3, m: 2, temp: 85 });
    expect(el(n, 'Q1')).toMatchObject({ nodes: ['c', 'b', 'e'], model: 'QN' });
    expect(el(n, 'Q2')).toMatchObject({ nodes: ['c', 'b', 'e', 'sub'], model: 'QN', params: { area: 1.5, off: 1, ic_vbe: 0.7, ic_vce: 5 } });
    expect(el(n, 'Q3')).toMatchObject({ nodes: ['c', 'b', 'e', '0'], model: 'QN' });
    expect(el(n, 'J1')).toMatchObject({ nodes: ['d', 'g', 's'], model: 'JN', params: { area: 2, ic_vds: 1, ic_vgs: -1 } });
    expect(el(n, 'M1')).toMatchObject({
      nodes: ['d', 'g', 's', 'b'],
      model: 'MN',
      params: { l: 1e-6, w: 10e-6, ad: 1e-12, as: 1e-12, pd: 4e-6, ps: 4e-6, m: 4, ic_vds: 1, ic_vgs: 2, ic_vbs: 0 },
    });
    expect(el(n, 'M2')).toMatchObject({ nodes: ['d', 'g', 's', 's'], model: 'MN' });
    expect(el(n, 'Z1')).toMatchObject({ type: 'Z', nodes: ['d', 'g', 's'], params: { off: 1 } });
    expect(el(n, 'S1')).toMatchObject({ type: 'S', nodes: ['1', '2', '3', '0'], model: 'SW1', params: { off: 1 } });
    expect(el(n, 'W1')).toMatchObject({ type: 'W', nodes: ['1', '2'], control: 'Vctl', model: 'CS1', params: { on: 1 } });
    expect(el(n, 'T1')).toMatchObject({ type: 'T', nodes: ['1', '0', '2', '0'], params: { z0: 50, td: 10e-9 } });
    expect(el(n, 'T2').params).toEqual({ z0: 75, f: 1e6, nl: 0.5, ic_v1: 1, ic_i1: 2, ic_v2: 3, ic_i2: 4 });
    expect(el(n, 'O1')).toMatchObject({ type: 'O', model: 'LT' });
    expect(el(n, 'X1')).toMatchObject({
      type: 'X',
      nodes: ['in', 'out', '0'],
      model: 'amp',
      stringParams: { gain: '10', rin: '2*rbase' },
    });
    expect(el(n, 'X2')).toMatchObject({ nodes: ['in', 'out'], model: 'filt', stringParams: { fc: '1k' } });
    expect(el(n, 'XU3')).toMatchObject({ nodes: ['a', 'b'], model: 'c' });
    expect(el(n, 'XU3').stringParams).toBeUndefined();
    expect(el(n, 'A1')).toMatchObject({ type: 'A', nodes: ['a', 'b', 'y'], model: 'AND2', stringParams: { ports: '[ # # ] #' } });
    expect(el(n, 'A2')).toMatchObject({ nodes: ['in', '0', 'out'], stringParams: { ports: '%vd ( # # ) #' } });
    expect(el(n, 'A3')).toMatchObject({ nodes: ['x', 'y'], stringParams: { ports: '# ~#' } });
    expect(el(n, 'A4').stringParams).toBeUndefined();
    // undefined subcircuits are reported as warnings with their line
    expect(r.warnings).toContain('line 26: X1: subcircuit \'amp\' is not defined');
  });

  it('reports structural errors with their line numbers', () => {
    const r = parseSpice(
      [
        't',
        'D1 a k',
        'Q1 c b',
        'M1 d g s',
        'S1 1 2 3',
        'T1 1 0 2 0 z0=50',
        'X1',
        'R1 a',
        'R2 a b',
        'Y1 a b 1',
        'R4 c d 1',
        'R3 a b 1 2 3',
        'r4 e f 2',
      ].join('\n'),
    );
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13]);
    expect(r.errors[0].message).toMatch(/expected 2 nodes and a model name/);
    expect(r.errors[4].message).toMatch(/needs td= or f=/);
    expect(r.errors[5].message).toMatch(/X1: missing subcircuit name/);
    expect(r.errors[6].message).toMatch(/missing node n-/);
    expect(r.errors[7].message).toMatch(/R2: missing value/);
    expect(r.errors[8].message).toMatch(/unsupported element type 'Y'/);
    expect(r.errors[9].message).toMatch(/unexpected '3'/);
    expect(r.errors[10].message).toMatch(/duplicate element name 'r4'/);
  });
});

describe('.model cards', () => {
  it('reads a manufacturer-style model line', () => {
    const n = ok(
      't\n.model D1N4148 D(Is=2.52n Rs=.568 N=1.752 Cjo=4p M=.4 tt=20n Iave=200m Vpk=75 mfg=OnSemi type=silicon)\n',
    );
    expect(n.models.d1n4148).toEqual({
      name: 'D1N4148',
      type: 'D',
      params: { is: 2.52e-9, rs: 0.568, n: 1.752, cjo: 4e-12, m: 0.4, tt: 20e-9, iave: 0.2, vpk: 75 },
      stringParams: { mfg: 'OnSemi', type: 'silicon' },
    });
  });

  it('accepts cards with and without parentheses, continuation and commas', () => {
    const n = ok(
      [
        't',
        '.MODEL Q2N2222 NPN (IS=14.34f XTI=3 EG=1.11 VAF=74.03 BF=255.9',
        '+ NE=1.307, ISE=14.34f, IKF=.2847 VCEO=40 ICRATING=800m MFG="NXP Semi")',
        '.model M1 NMOS LEVEL=3 VTO=0.8 KP=50u',
        '.model DX D',
        '.model RLOAD RES(R=1 TC1=0.01)',
        '.model SWX VSWITCH(RON=1 ROFF=1MEG VON=1 VOFF=0)',
        '.model pwl1 pwl(x_array=[-1 0 1] y_array=[0, 0, 1])',
        '.model DP D(IS={isat*2} BV=\'bv0\')',
        '.model D2 ako:DX D(BV=100)',
        '.model D3 AKO:D2 (RS=2)',
        '.model DPART D(part=1N914 alt=2N2222)',
      ].join('\n'),
    );
    expect(n.models.dpart.stringParams).toEqual({ part: '1N914', alt: '2N2222' });
    expect(n.models.q2n2222.type).toBe('NPN');
    expect(n.models.q2n2222.params).toMatchObject({ is: 14.34e-15, xti: 3, vaf: 74.03, bf: 255.9, ne: 1.307, ikf: 0.2847, vceo: 40, icrating: 0.8 });
    expect(n.models.q2n2222.stringParams).toEqual({ mfg: 'NXP Semi' });
    expect(n.models.m1).toEqual({ name: 'M1', type: 'NMOS', params: { level: 3, vto: 0.8, kp: 50e-6 } });
    expect(n.models.dx).toEqual({ name: 'DX', type: 'D', params: {} });
    expect(n.models.rload).toEqual({ name: 'RLOAD', type: 'R', params: { r: 1, tc1: 0.01 } });
    expect(n.models.swx.type).toBe('SW');
    expect(n.models.pwl1.stringParams).toEqual({ x_array: '[-1 0 1]', y_array: '[0 0 1]' });
    expect(n.models.dp).toEqual({ name: 'DP', type: 'D', params: {}, stringParams: { is: '{isat*2}', bv: '{bv0}' } });
    expect(n.models.d2).toEqual({ name: 'D2', type: 'D', params: { bv: 100 } });
    expect(n.models.d3).toEqual({ name: 'D3', type: 'D', params: { bv: 100, rs: 2 } });
  });

  it('reports model errors and redefinitions', () => {
    const r = parseSpice('t\n.model\n.model DQ\n.model D9 ako:NOPE D\n.model DA D(IS=)\n.model DB D\n.model DB D(N=2)\n');
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(r.errors[2].message).toMatch(/AKO base model 'NOPE'/);
    expect(r.warnings).toContain("line 7: model 'DB' redefined");
    expect(r.netlist.models.db.params).toEqual({ n: 2 });
  });
});

describe('subcircuits and parameters', () => {
  it('reads nested subcircuits with parameters and local models', () => {
    const n = ok(
      [
        't',
        '.subckt amp in out PARAMS: gain=10 rin={2*rbase}',
        '.param rf={gain*rin}',
        '.model DL D(IS=1n)',
        'R1 in mid {rin}',
        'X1 mid out stage g=3',
        '.subckt stage a b params: g=1',
        'E1 b 0 a 0 {g}',
        '.ends stage',
        '.ends amp',
        '.subckt divider top bot r=1k',
        'R1 top bot {r}',
        '.ends',
        'X1 1 2 amp gain=5',
      ].join('\n'),
    );
    const amp = n.subckts.amp;
    expect(amp.name).toBe('amp');
    expect(amp.ports).toEqual(['in', 'out']);
    expect(amp.params).toEqual({ gain: '10', rin: '2*rbase', rf: 'gain*rin' });
    expect(amp.models.dl.params).toEqual({ is: 1e-9 });
    expect(amp.elements.map((e) => e.name)).toEqual(['R1', 'X1']);
    expect(amp.subckts.stage).toMatchObject({ ports: ['a', 'b'], params: { g: '1' } });
    expect(amp.subckts.stage.elements[0]).toMatchObject({ type: 'E', stringParams: { value: 'g' } });
    expect(n.subckts.divider).toMatchObject({ ports: ['top', 'bot'], params: { r: '1k' } });
    expect(n.elements).toHaveLength(1);
    expect(n.subckts.stage).toBeUndefined();
  });

  it('reports unbalanced .subckt / .ends', () => {
    const r = parseSpice('t\n.ends\n.subckt open a b\nR1 a b 1\n');
    expect(r.errors).toEqual([
      { line: 2, message: '.ends without a matching .subckt' },
      { line: 3, message: '.subckt open has no matching .ends' },
    ]);
    const w = parseSpice('t\n.subckt s a\nR1 a 0 1\n.ends other\n');
    expect(w.warnings).toContain('line 4: .ends other closes .subckt s');
  });

  it('reads .param in all its forms', () => {
    const n = ok(
      [
        't',
        '.param a=1k b={a*2} c=\'a+b\'',
        '.param d = a * 3, e=2',
        '.param f=4k7',
        '.PARAM A=2k',
        '.param g = a>=1 ? 1 : 0',
      ].join('\n'),
    );
    expect(n.params).toEqual({ b: 'a*2', c: 'a+b', d: 'a * 3', e: 2, f: 4700, A: 2000, g: 'a>=1 ? 1 : 0' });
  });

  it('reads .func, .global and HSPICE function parameters', () => {
    const n = ok('t\n.func sq(x) {x*x}\n.func mix(a, b) = a*0.3 + b*0.7\n.param half(v)=\'v/2\'\n.global vcc vee\n.global VCC 5v\n');
    expect(n.params).toEqual({ 'sq(x)': 'x*x', 'mix(a,b)': 'a*0.3 + b*0.7', 'half(v)': 'v/2', '.global': 'vcc vee 5v' });
  });

  it('detects circular and undefined parameters at their lines', () => {
    const r = parseSpice('t\n.param a={b+1}\n.param b={a*2}\n');
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].message).toMatch(/circular parameter definition/);
    expect([2, 3]).toContain(r.errors[0].line);
    const u = parseSpice('t\n.param x=1\n.param y={x+zz}\n');
    expect(u.errors).toEqual([{ line: 3, message: "parameter 'y': undefined parameter 'zz'" }]);
  });
});

describe('includes and libraries', () => {
  const files: Record<string, string> = {
    'models.inc': '* model file\n.model DI D(IS=2n)\n.param rinc=470\n',
    'nested.inc': '.include models.inc\nR9 9 0 {rinc}\n',
    'corners.lib': [
      '* corner library',
      '.lib tt',
      '.model NCH NMOS(VTO=0.5)',
      '.lib corners.lib common',
      '.endl tt',
      '.lib ff',
      '.model NCH NMOS(VTO=0.4)',
      '.endl ff',
      '.lib common',
      '.param vdd=1.8',
      '.endl common',
    ].join('\n'),
    'bad.inc': 'R1 a\n',
    'loop.inc': '.include loop.inc\n',
  };
  const resolveInclude = (p: string) => files[p.replace(/^["']|["']$/g, '')];

  it('expands .include and nested includes', () => {
    const n = ok('t\n.include "nested.inc"\nD1 1 0 DI\n', { resolveInclude });
    expect(n.models.di.params).toEqual({ is: 2e-9 });
    expect(n.params).toEqual({ rinc: 470 });
    expect(el(n, 'R9')).toMatchObject({ stringParams: { value: 'rinc' }, line: 2 });
  });

  it('selects .lib sections, including sections referenced from a section', () => {
    const n = ok("t\n.lib 'corners.lib' tt\n", { resolveInclude });
    expect(n.models.nch.params).toEqual({ vto: 0.5 });
    expect(n.params).toEqual({ vdd: 1.8 });
    const f = ok('t\n.LIB corners.lib FF\n', { resolveInclude });
    expect(f.models.nch.params).toEqual({ vto: 0.4 });
    expect(f.params).toEqual({});
  });

  it('includes a whole library file with one-argument .lib and skips local section blocks', () => {
    const n = ok('t\n.lib models.inc\n.lib unused\nR1 1 0 1\n.endl\nR2 1 0 2\n', { resolveInclude });
    expect(n.models.di).toBeDefined();
    expect(n.elements.map((e) => e.name)).toEqual(['R2']);
  });

  it('resolves nested includes next to the including file first', () => {
    const tree: Record<string, string> = {
      'lib/a.lib': '.include b.lib\n',
      'lib/b.lib': '.model DB D(N=1.1)\n',
      'b.lib': '.model DB D(N=9)\n',
    };
    const requests: string[] = [];
    const n = ok('t\n.include lib/a.lib\n', {
      fileName: 'main.cir',
      resolveInclude: (p) => {
        requests.push(p);
        return tree[p];
      },
    });
    expect(n.models.db.params).toEqual({ n: 1.1 });
    expect(requests).toEqual(['lib/a.lib', 'lib/b.lib']);
  });

  it('reports include problems at the including line', () => {
    const r = parseSpice('t\nR0 a 0 1\n.include missing.inc\n.inc bad.inc\n.lib corners.lib nope\n.include loop.inc\n', { resolveInclude });
    expect(r.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(r.errors[0].message).toBe("include file 'missing.inc' not found");
    expect(r.errors[1].message).toMatch(/^bad\.inc:1: .*missing node n-/);
    expect(r.errors[2].message).toBe("section 'nope' not found in 'corners.lib'");
    expect(r.errors[3].message).toMatch(/recursive include of 'loop.inc'/);
    const noResolver = parseSpice('t\n.include x.inc\n');
    expect(noResolver.errors[0]).toEqual({ line: 2, message: "cannot read 'x.inc': no include file resolver is available" });
  });
});

describe('control cards', () => {
  it('reads every analysis card', () => {
    const n = ok(
      [
        't',
        '.param fmax=1meg tend=10m',
        '.op',
        '.dc V1 0 5 0.1',
        '.dc lin V1 0 5 1 V2 0 1 0.5',
        '.dc temp -40 125 5',
        '.ac dec 10 1 {fmax}',
        '.ac lin 101 1k 2k',
        '.ac oct 5 100 1.6k',
        '.ac list 1k 2k 5k',
        '.tran 1u {tend}',
        '.tran 0.1u 2m 1m 10n uic',
        '.tran 5m',
        '.noise V(out) V1 dec 10 10 100k',
        '.noise v(out, ref) I1 lin 20 1k 2k 5',
        '.tf V(out) Vin',
        '.tf I(Vsense) Vin',
        '.sens V(out,0)',
        '.sens I(V1) ac dec 5 1 1k',
        '.pz in 0 out 0 vol pz',
        '.pz 1 0 2 0 cur pol',
        '.four 1k V(out) v(in)',
        '.four 50 5 V(out)',
        '.disto dec 10 1k 1meg 0.9',
      ].join('\n'),
    );
    expect(n.analyses).toEqual([
      { type: 'op' },
      { type: 'dc', src: 'V1', start: 0, stop: 5, step: 0.1 },
      { type: 'dc', src: 'V1', start: 0, stop: 5, step: 1, src2: { src: 'V2', start: 0, stop: 1, step: 0.5 } },
      { type: 'dc', src: 'temp', start: -40, stop: 125, step: 5 },
      { type: 'ac', sweep: 'dec', points: 10, fstart: 1, fstop: 1e6 },
      { type: 'ac', sweep: 'lin', points: 101, fstart: 1e3, fstop: 2e3 },
      { type: 'ac', sweep: 'oct', points: 5, fstart: 100, fstop: 1600 },
      { type: 'ac', sweep: 'list', points: 3, fstart: 1e3, fstop: 5e3, list: [1e3, 2e3, 5e3] },
      { type: 'tran', tstep: 1e-6, tstop: 10e-3 },
      { type: 'tran', tstep: 0.1e-6, tstop: 2e-3, tstart: 1e-3, tmax: 10e-9, uic: true },
      { type: 'tran', tstep: 5e-6, tstop: 5e-3 },
      { type: 'noise', output: 'out', src: 'V1', sweep: 'dec', points: 10, fstart: 10, fstop: 1e5 },
      { type: 'noise', output: 'out', ref: 'ref', src: 'I1', sweep: 'lin', points: 20, fstart: 1e3, fstop: 2e3 },
      { type: 'tf', output: 'V(out)', src: 'Vin' },
      { type: 'tf', output: 'I(Vsense)', src: 'Vin' },
      { type: 'sens', output: 'V(out,0)' },
      { type: 'sens', output: 'I(V1)', ac: { sweep: 'dec', points: 5, fstart: 1, fstop: 1e3 } },
      { type: 'pz', inPos: 'in', inNeg: '0', outPos: 'out', outNeg: '0', transfer: 'vol', find: 'pz' },
      { type: 'pz', inPos: '1', inNeg: '0', outPos: '2', outNeg: '0', transfer: 'cur', find: 'pol' },
      { type: 'four', fundamental: 1e3, harmonics: 9, outputs: ['V(out)', 'V(in)'] },
      { type: 'four', fundamental: 50, harmonics: 5, outputs: ['V(out)'] },
      { type: 'disto', sweep: 'dec', points: 10, fstart: 1e3, fstop: 1e6, f2overf1: 0.9 },
    ]);
  });

  it('gives a PSpice .noise without sweep the sweep of the .ac analysis', () => {
    const n = ok('t\n.noise V(out) V1 10\n.ac dec 20 1 10k\n');
    expect(n.analyses[0]).toEqual({ type: 'noise', output: 'out', src: 'V1', sweep: 'dec', points: 20, fstart: 1, fstop: 1e4 });
    const r = parseSpice('t\n.noise V(out) V1\n');
    expect(r.errors).toEqual([{ line: 2, message: '.noise without a frequency sweep needs an .ac dec/oct/lin analysis' }]);
    expect(r.netlist.analyses).toEqual([]);
  });

  it('reports analysis errors with line numbers', () => {
    const r = parseSpice(
      't\n.tran\n.ac dec 0 1 10\n.ac foo 1 2 3\n.dc V1 0 1 0\n.pz 1 0 2 0 vol xx\n.tran 1u {nope}\n.four 0 V(a)\n.dc dec V1 1 10 5\n',
    );
    expect(r.errors.map((e) => e.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(r.errors[0].message).toBe('missing stop time');
    expect(r.errors[5].message).toMatch(/cannot evaluate 'nope': undefined parameter 'nope'/);
    expect(r.warnings).toContain('line 9: .dc: only linear sweeps of sources or temperature are supported; analysis ignored');
  });

  it('maps .options, .temp, .ic, .nodeset and output requests', () => {
    const r = parseSpice(
      [
        't',
        '.options reltol=1e-4 abstol=1p vntol=1u gmin=1e-13 method=gear maxord=3 itl1=200 itl4=40',
        '+ tnom=25 chgtol=1e-15 trtol=5 itl2=60 gminsteps=5 srcsteps=8 rshunt=1e12 seed=7 noacct numdgt=8',
        '.option itl6=20',
        '.temp 85',
        '.ic V(out)=1.5 v(in)=0',
        '.nodeset V(mid)={vm}',
        '.param vm=2.5',
        '.save V(out) I(V1) all',
        '.print tran v(out) vdb(mid) i(R1) ic(Q1) @m1[id]',
        '.probe',
        '.plot ac vm(out)',
      ].join('\n'),
    );
    expect(r.errors).toEqual([]);
    const n = r.netlist;
    expect(n.options).toEqual({
      reltol: 1e-4,
      abstol: 1e-12,
      vntol: 1e-6,
      gmin: 1e-13,
      method: 'gear',
      maxord: 3,
      itl1: 200,
      itl4: 40,
      tnom: 25,
      chgtol: 1e-15,
      trtol: 5,
      itl2: 60,
      gminSteps: 5,
      srcSteps: 20,
      rshunt: 1e12,
      seed: 7,
      temp: 85,
    });
    expect(n.ic).toEqual({ out: 1.5, in: 0 });
    expect(n.nodeset).toEqual({ mid: 2.5 });
    expect(n.saves).toEqual(['V(out)', 'I(V1)', 'all', 'V(mid)', 'I(R1)', 'ic(Q1)']);
    expect(r.warnings).toContain('line 2: options ignored: noacct, numdgt');
    expect(r.warnings).toContain('line 10: device-internal outputs are not supported: @m1[id]');
  });

  it('maps method=euler to first-order Gear with a warning', () => {
    const r = parseSpice('t\n.options method=euler\n');
    expect(r.netlist.options).toEqual({ method: 'gear', maxord: 1 });
    expect(r.warnings[0]).toMatch(/line 2: method=euler mapped to Gear order 1/);
  });

  it('wraps analyses for several .temp values and for .step', () => {
    const n = ok('t\n.temp 0 27 100\n.op\n.tran 1u 1m\n');
    expect(n.analyses).toEqual([
      { type: 'tempsweep', temps: [0, 27, 100], base: { type: 'op' } },
      { type: 'tempsweep', temps: [0, 27, 100], base: { type: 'tran', tstep: 1e-6, tstop: 1e-3 } },
    ]);
    expect(n.options.temp).toBeUndefined();
    const s = ok('t\n.step R1 1k 3k 1k\n.op\n');
    expect(s.analyses).toEqual([{ type: 'paramsweep', target: 'R1', param: 'value', values: [1000, 2000, 3000], base: { type: 'op' } }]);
    const m = ok('t\n.step NPN QN(BF) list 50 100\n.ac dec 1 1 10\n');
    expect(m.analyses[0]).toMatchObject({ type: 'paramsweep', target: 'QN', param: 'bf', model: true, values: [50, 100] });
    const d = ok('t\n.step dec temp 1 100 1\n');
    expect(d.analyses).toEqual([{ type: 'tempsweep', temps: [1, 10, 100], base: { type: 'op' } }]);
    // .step param sweeps a global parameter since round 3 (outermost, re-evaluated per run)
    const p = ok('t\n.param x=1\n.step param x 1 2 1\n');
    expect(p.analyses).toEqual([{ type: 'paramsweep', target: 'x', param: 'value', global: true, values: [1, 2], base: { type: 'op' } }]);
  });

  it('reads .meas cards and ignores .control blocks and unknown cards with warnings', () => {
    const r = parseSpice(
      ['t', '.meas tran vmax MAX V(out)', '.control', 'run', 'plot v(out)', '.endc', '.foo bar', '.backanno', 'R1 1 0 1'].join('\n'),
    );
    expect(r.errors).toEqual([]);
    expect(r.netlist.elements).toHaveLength(1);
    expect(r.netlist.measures).toEqual([{ analysis: 'tran', name: 'vmax', kind: 'max', expr: 'V(out)', line: 2 }]);
    expect(r.warnings).toEqual([
      'line 3: .control block ignored (interactive simulator commands are not supported)',
      "line 7: unknown control card '.foo' ignored",
      'line 8: .backanno is not supported; ignored',
    ]);
  });

  it('reads *@machsim analysis pragmas in order', () => {
    const n = ok(
      't\n.op\n*@machsim analysis {"type":"acsingle","freq":1000}\n.tran 1u 1m\n*@machsim analysis {"type":"tracewidth","base":{"type":"tran","tstep":1e-6,"tstop":1e-3},"tempRise":10,"copperOz":1,"external":true}\n',
    );
    expect(n.analyses.map((a) => a.type)).toEqual(['op', 'acsingle', 'tran', 'tracewidth']);
    expect(n.analyses[1]).toEqual({ type: 'acsingle', freq: 1000 });
    const bad = parseSpice('t\n*@machsim analysis {"type":"bogus"}\n*@machsim analysis {oops\n');
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3]);
  });

  it('ignores analysis cards inside a subcircuit with a warning', () => {
    const r = parseSpice('t\n.subckt s a\n.tran 1u 1m\nR1 a 0 1\n.ends\n');
    expect(r.netlist.analyses).toEqual([]);
    expect(r.warnings).toContain('line 3: .tran is not allowed inside .subckt s; ignored');
  });
});

describe('robustness', () => {
  it('never throws, whatever the input', () => {
    const inputs = [
      '',
      '\n\n',
      't\n+ continuation first',
      't\nR1 a b {unbalanced',
      't\nV1 a b SIN(',
      "t\n.param x='unterminated",
      't\n.model',
      't\nX',
      't\n.subckt\n',
      't\n.func f(\n',
      't\nE1 a b POLY(x) 1 2',
      't\n.ic V(a)\n',
      't\nA1 [a b y and',
    ];
    for (const text of inputs) {
      let result: SpiceParseResult | undefined;
      expect(() => {
        result = parseSpice(text);
      }).not.toThrow();
      for (const e of result?.errors ?? []) expect(e.line).toBeGreaterThan(0);
    }
  });
});
