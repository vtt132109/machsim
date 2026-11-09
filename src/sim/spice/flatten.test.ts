import { describe, expect, it } from 'vitest';
import { FlattenError, flattenNetlist, flattenNetlistWithWarnings } from './flatten';
import { parseSpice } from './parser';
import { emptyNetlist, type ElementIR, type Netlist } from '../netlist';

function parse(text: string): Netlist {
  const r = parseSpice(text);
  expect(r.errors).toEqual([]);
  return r.netlist;
}

function flat(text: string): Netlist {
  return flattenNetlist(parse(text));
}

function find(n: Netlist, name: string): ElementIR {
  const e = n.elements.find((x) => x.name === name);
  if (!e) throw new Error(`no element ${name} in [${n.elements.map((x) => x.name).join(', ')}]`);
  return e;
}

describe('parameter evaluation without subcircuits', () => {
  it('evaluates global parameters in dependency order and every element expression', () => {
    const src = parse(
      [
        't',
        '.param c={b*2} b={a+1} a=1k',
        '.func dbl(x) {2*x}',
        '.param vdd=5 f0=1k',
        'R1 1 0 {dbl(a)}',
        'C1 1 0 {1/(2*pi*f0*a)} ic={vdd/2}',
        'V1 1 0 DC {vdd} AC {vdd/5} {45*2} SIN(0 {vdd} {f0})',
        'V2 2 0 PWL(0 0 {1/f0} {vdd}) td={1/f0} r={0}',
        'V3 3 0 distof1 {vdd/10} 30',
        'K1 L1 L2 {0.5+0.49}',
        'L1 1 0 1m',
        'L2 2 0 1m',
        '.model DM D(IS={1f*a} N=1.5 mfg=Acme)',
        'D1 1 0 DM area={c/1k}',
      ].join('\n'),
    );
    const before = structuredClone(src);
    const n = flattenNetlist(src);
    expect(src).toEqual(before);
    expect(n.params).toEqual({ c: 2002, b: 1001, a: 1000, vdd: 5, f0: 1000 });
    expect(find(n, 'R1')).toMatchObject({ value: 2000 });
    expect(find(n, 'R1').stringParams).toBeUndefined();
    expect(find(n, 'C1').value).toBeCloseTo(1 / (2 * Math.PI * 1e6), 18);
    expect(find(n, 'C1').params).toEqual({ ic: 2.5 });
    expect(find(n, 'V1').source).toEqual({ dc: 5, acMag: 1, acPhase: 90, tran: { type: 'SIN', args: [0, 5, 1000] } });
    expect(find(n, 'V2').source?.tran).toEqual({ type: 'PWL', args: [1e-3, 0, 2e-3, 5], repeatFrom: 0 });
    expect(find(n, 'V3').source?.distof1).toEqual([0.5, 30]);
    expect(find(n, 'K1').value).toBeCloseTo(0.99, 15);
    expect(n.models.dm).toEqual({ name: 'DM', type: 'D', params: { is: 1e-12, n: 1.5 }, stringParams: { mfg: 'Acme' } });
    expect(find(n, 'D1').params.area).toBeCloseTo(2.002, 12);
    expect(n.subckts).toEqual({});
  });

  it('folds parameters and functions into B expressions', () => {
    const n = flat('t\n.param k=3\n.func sq(x) {x*x}\nB1 out 0 V={k*sq(V(in))} \nE1 a gnd VALUE={V(in,0)*k + time}\n');
    expect(find(n, 'B1').expr).toBe('V=3 * (V(in) * V(in))');
    expect(find(n, 'BE1').expr).toBe('V=V(in) * 3 + time');
  });

  it('is idempotent', () => {
    const n = flat('t\n.param r=2k\nR1 1 0 {r}\nB1 2 0 I={V(1)/r}\nX1 1 2 sub\n.subckt sub a b\nR1 a n {r*2}\nC1 n b 1n\n.ends\n');
    expect(flattenNetlist(n)).toEqual(n);
  });

  it('keeps netlists without expressions intact', () => {
    const src = emptyNetlist('plain');
    src.elements.push({ type: 'R', name: 'R1', nodes: ['a', '0'], value: 50, params: { tc1: 0.01 } });
    src.analyses.push({ type: 'tran', tstep: 1e-6, tstop: 1e-3 });
    src.saves.push('V(a)');
    const n = flattenNetlist(src);
    expect(n).toEqual(src);
    expect(n.elements[0]).not.toBe(src.elements[0]);
    expect(n.analyses).not.toBe(src.analyses);
  });
});

describe('subcircuit expansion', () => {
  const nested = [
    'nested subcircuits',
    '.global vcc',
    '.param rbase=1k',
    '.subckt inner a b params: r=100',
    'R3 a n5 {r}',
    'C1 n5 b 1p',
    'R4 n5 vcc 1meg',
    'R5 n5 gnd 2meg',
    '.ends inner',
    '.subckt outer in out params: gain=2',
    'X2 in mid inner r={gain*rbase}',
    'R3 mid out 10',
    'Rg out 0 1',
    '.ends outer',
    'X1 1 2 outer gain=3',
    'XB 3 4 outer',
    'Vcc vcc 0 5',
  ].join('\n');

  it('names elements and nodes as R.X1.X2.R3 / X1.X2.n5 and maps ports', () => {
    const n = flat(nested);
    expect(n.elements.map((e) => e.name)).toEqual([
      'R.X1.X2.R3',
      'C.X1.X2.C1',
      'R.X1.X2.R4',
      'R.X1.X2.R5',
      'R.X1.R3',
      'R.X1.Rg',
      'R.XB.X2.R3',
      'C.XB.X2.C1',
      'R.XB.X2.R4',
      'R.XB.X2.R5',
      'R.XB.R3',
      'R.XB.Rg',
      'Vcc',
    ]);
    expect(find(n, 'R.X1.X2.R3')).toMatchObject({ nodes: ['1', 'X1.X2.n5'], value: 3000 });
    expect(find(n, 'C.X1.X2.C1').nodes).toEqual(['X1.X2.n5', 'X1.mid']);
    expect(find(n, 'R.X1.X2.R4').nodes).toEqual(['X1.X2.n5', 'vcc']);
    expect(find(n, 'R.X1.X2.R5').nodes).toEqual(['X1.X2.n5', 'gnd']);
    expect(find(n, 'R.X1.R3').nodes).toEqual(['X1.mid', '2']);
    expect(find(n, 'R.X1.Rg').nodes).toEqual(['2', '0']);
    expect(find(n, 'R.XB.X2.R3')).toMatchObject({ nodes: ['3', 'XB.X2.n5'], value: 2000 });
    expect(n.elements.some((e) => e.type === 'X')).toBe(false);
    expect(n.params).toEqual({ rbase: 1000 });
  });

  it('lets inner instances see the parameters of the instances above them', () => {
    const n = flat(
      [
        't',
        '.subckt leaf a',
        'R1 a 0 {rv}',
        '.ends',
        '.subckt mid a params: rv=5',
        'X1 a leaf',
        '.ends',
        'Xm n mid rv=7',
        'Xd d mid',
      ].join('\n'),
    );
    expect(find(n, 'R.Xm.X1.R1').value).toBe(7);
    expect(find(n, 'R.Xd.X1.R1').value).toBe(5);
  });

  it('scopes local models and renames them only on a clash', () => {
    const n = flat(
      [
        't',
        '.model DG D(IS=1e-14)',
        '.subckt cell a k params: is0=1n',
        '.model DL D(IS={is0})',
        '.model DG D(IS=5e-9)',
        'D1 a k DL',
        'D2 a k DG',
        '.ends',
        '.subckt same a k',
        '.model DS D(N=2)',
        'D1 a k DS',
        '.ends',
        'X1 1 0 cell',
        'X2 2 0 cell is0=2n',
        'X3 3 0 cell',
        'X4 4 0 same',
        'X5 5 0 same',
        'D9 9 0 DG',
      ].join('\n'),
    );
    expect(find(n, 'D.X1.D1').model).toBe('DL');
    expect(find(n, 'D.X1.D2').model).toBe('X1.DG');
    expect(find(n, 'D.X2.D1').model).toBe('X2.DL');
    expect(find(n, 'D.X2.D2').model).toBe('X1.DG');
    expect(find(n, 'D.X3.D1').model).toBe('DL');
    expect(find(n, 'D.X4.D1').model).toBe('DS');
    expect(find(n, 'D.X5.D1').model).toBe('DS');
    expect(find(n, 'D9').model).toBe('DG');
    expect(n.models.dg.params).toEqual({ is: 1e-14 });
    expect(n.models.dl.params).toEqual({ is: 1e-9 });
    expect(n.models['x2.dl']).toEqual({ name: 'X2.DL', type: 'D', params: { is: 2e-9 } });
    expect(n.models['x1.dg']).toEqual({ name: 'X1.DG', type: 'D', params: { is: 5e-9 } });
    expect(Object.keys(n.models).sort()).toEqual(['dg', 'dl', 'ds', 'x1.dg', 'x2.dl']);
  });

  it('prefers a local subcircuit definition over a global one of the same name', () => {
    const n = flat(
      [
        't',
        '.subckt load a',
        'R1 a 0 1',
        '.ends',
        '.subckt wrap a',
        '.subckt load a',
        'R1 a 0 99',
        '.ends',
        'X1 a load',
        '.ends',
        'Xw 1 wrap',
        'Xl 2 load',
      ].join('\n'),
    );
    expect(find(n, 'R.Xw.X1.R1').value).toBe(99);
    expect(find(n, 'R.Xl.R1').value).toBe(1);
  });

  it('maps device references of F/H/W, K and B sources', () => {
    const n = flat(
      [
        't',
        '.subckt blk in out',
        'Vs in m 0',
        'F1 out 0 Vs 2',
        'H1 h 0 Vs 1k',
        'W1 out w Vs SWM',
        'L1 m 0 1u',
        'L2 out 0 1u',
        'K1 L1 L2 0.9',
        'B1 b 0 V=V(in,m)*I(Vs) + I(Vtop)',
        'G1 out 0 VALUE={V(h)/1k}',
        '.ends',
        '.model SWM CSW(it=1m)',
        'Vtop t 0 1',
        'X1 a z blk',
      ].join('\n'),
    );
    expect(find(n, 'F.X1.F1')).toMatchObject({ nodes: ['z', '0'], control: 'V.X1.Vs' });
    expect(find(n, 'H.X1.H1')).toMatchObject({ nodes: ['X1.h', '0'], control: 'V.X1.Vs' });
    expect(find(n, 'W.X1.W1')).toMatchObject({ control: 'V.X1.Vs', model: 'SWM' });
    expect(find(n, 'K.X1.K1').inductors).toEqual(['L.X1.L1', 'L.X1.L2']);
    expect(find(n, 'B.X1.B1').expr).toBe('V=V(a,X1.m) * I(V.X1.Vs) + I(Vtop)');
    expect(find(n, 'B.X1.BG1')).toMatchObject({ nodes: ['z', '0'], expr: 'I=V(X1.h) / 1000' });
  });
});

describe('errors and warnings', () => {
  // the parser reports some of these problems too; flatten must catch them on its own
  const fails = (text: string, re: RegExp) => {
    let err: unknown;
    try {
      flattenNetlist(parseSpice(text).netlist);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FlattenError);
    expect((err as Error).message).toMatch(re);
    return err as FlattenError;
  };

  it('reports undefined subcircuits and port mismatches with the line', () => {
    const e = fails('t\nR1 1 0 1\nX7 1 2 nosuch\n', /^X7 \(line 3\): subcircuit 'nosuch' is not defined$/);
    expect(e.element).toBe('X7');
    expect(e.line).toBe(3);
    fails('t\n.subckt s a b\nR1 a b 1\n.ends\nX1 1 s\n', /has 2 port\(s\) but 1 node\(s\) are connected/);
  });

  it('detects recursive instantiation', () => {
    fails('t\n.subckt a p\nX1 p b\n.ends\n.subckt b p\nX1 p a\n.ends\nX0 1 a\n', /recursive instantiation of subcircuit 'a'/);
  });

  it('reports parameter problems', () => {
    fails('t\n.param x={y}\n.param y={x}\n', /circular parameter definition/);
    fails('t\nR1 1 0 {nope*2}\n', /^R1 \(line 2\): value=nope\*2: undefined parameter 'nope'$/);
    fails('t\n.subckt s a params: p=1\nR1 a 0 {p/q}\n.ends\nX1 1 s\n', /^X1\.R1 \(line 3\): value=p\/q: undefined parameter 'q'$/);
    fails('t\nX1 1 s k={zz}\n.subckt s a params: k=1\nR1 a 0 {k}\n.ends\n', /parameter k=zz: undefined parameter 'zz'/);
    fails('t\nB1 1 0 V=nosuch(V(2))\n', /unknown function 'nosuch'/);
    fails('t\nR1 1 0 {V(2)}\n', /not constant/);
  });

  it('rejects duplicate names created by flattening', () => {
    fails('t\nR.X1.R1 1 0 1\n.subckt s a\nR1 a 0 1\n.ends\nX1 1 s\n', /duplicate element name 'R.X1.R1'/);
  });

  it('warns about instance parameters the subcircuit does not declare', () => {
    const r = flattenNetlistWithWarnings(parse('t\n.subckt s a params: k=1\nR1 a 0 {k*typo}\n.ends\nX1 1 s typo=2\n'));
    expect(r.warnings).toEqual(["X1: parameter 'typo' is not declared by subcircuit 's'"]);
    expect(find(r.netlist, 'R.X1.R1').value).toBe(2);
  });
});
