import { describe, expect, it } from 'vitest';
import { checkCurrentCutsets, checkDuplicateRefdes, checkGround, checkModelRefs, checkVoltageLoops, unknownPartMessage, validateParams } from './erc';
import { getPart } from '../library';
import type { ElementIR } from '../sim/netlist';

const R = (name: string, a: string, b: string): ElementIR => ({ type: 'R', name, nodes: [a, b], value: 1e3, params: {} });
const C = (name: string, a: string, b: string): ElementIR => ({ type: 'C', name, nodes: [a, b], value: 1e-6, params: {} });
const V = (name: string, a: string, b: string): ElementIR => ({ type: 'V', name, nodes: [a, b], source: { dc: 1 }, params: {} });
const I = (name: string, a: string, b: string): ElementIR => ({ type: 'I', name, nodes: [a, b], source: { dc: 1e-3 }, params: {} });

describe('validateParams', () => {
  const res = getPart('basic/resistor')!;
  const sw = getPart('basic/switch-spdt')!;
  const spst = getPart('basic/switch-spst')!;
  const pot = getPart('basic/potentiometer')!;
  const loc = { refdes: 'R1', sheetId: 's', x: 10, y: 20 };

  it('accepts valid text in user number syntax', () => {
    expect(validateParams(res, { value: '4.7k', tolerance: '1', tc1: '0', tc2: '0', power: '0.5' }, loc)).toEqual([]);
    expect(validateParams(res, { value: '1 MΩ' }, loc)).toEqual([]);
  });

  it('accepts the decimal comma and the RKM code, and refuses text with an unread rest', () => {
    expect(validateParams(res, { value: '4,7k' }, loc)).toEqual([]);
    expect(validateParams(res, { value: '4k7' }, loc)).toEqual([]);
    const m = validateParams(res, { value: '4.7.3k' }, loc);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ severity: 'error', code: 'bad-param', refdes: 'R1', detail: { id: 'paramUnreadText', params: { text: '4.7.3k', rest: '.3k', value: '4.7 Ω' } } });
    expect(validateParams(res, { value: '1,2,3' }, loc)[0].detail?.id).toBe('paramUnreadText');
  });

  it('reports unparsable, empty and out-of-range numbers with the location', () => {
    expect(validateParams(res, { value: 'ten' }, loc)).toEqual([
      {
        severity: 'error',
        code: 'bad-param',
        message: "R1: Resistance = 'ten' is not a number",
        detail: { id: 'paramNotNumber', params: { refdes: 'R1', label: 'Resistance', text: 'ten' } },
        refdes: 'R1',
        sheetId: 's',
        x: 10,
        y: 20,
      },
    ]);
    expect(validateParams(res, { value: '' }, loc)[0].message).toMatch(/Resistance is empty/);
    expect(validateParams(res, { value: '-1' }, loc)[0].message).toMatch(/below the minimum 0 Ω/);
    expect(validateParams(pot, { percent: '101' }, loc)[0].message).toMatch(/above the maximum 100 %/);
  });

  it('checks select options and booleans', () => {
    expect(validateParams(sw, { position: 'b' }, loc)).toEqual([]);
    expect(validateParams(sw, { position: 'C' }, loc)[0].message).toMatch(/not one of A, B/);
    expect(validateParams(spst, { closed: 'maybe' }, loc)[0].message).toMatch(/not true \/ false/);
    expect(validateParams(spst, { closed: 'on' }, loc)).toEqual([]);
  });
});

describe('part-level checks', () => {
  it('duplicate designators are case-insensitive, exempt power symbols and flag empty ones', () => {
    const msgs = checkDuplicateRefdes([
      { refdes: 'R1', sheetId: 'a', x: 0, y: 0 },
      { refdes: 'r1', sheetId: 'b', x: 5, y: 6 },
      { refdes: 'GND1', exempt: true },
      { refdes: 'GND1', exempt: true },
      { refdes: ' ', sheetId: 'a', x: 1, y: 1 },
    ]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ code: 'duplicate-refdes', refdes: 'r1', sheetId: 'b', x: 5, y: 6, message: expect.stringMatching(/different sheets/) });
    expect(msgs[1].message).toMatch(/empty reference designator/);
  });

  it('unknown part message', () => {
    expect(unknownPartMessage('foo/bar', { refdes: 'U9', sheetId: 's', x: 1, y: 2 })).toEqual({
      severity: 'error',
      code: 'unknown-part',
      message: "U9: unknown library part 'foo/bar'",
      detail: { id: 'unknownPart', params: { refdes: 'U9', partId: 'foo/bar' } },
      refdes: 'U9',
      sheetId: 's',
      x: 1,
      y: 2,
    });
  });
});

describe('topology checks', () => {
  it('ground', () => {
    expect(checkGround([])).toBeNull();
    expect(checkGround([R('R1', 'a', 'gnd')])).toBeNull();
    expect(checkGround([R('R1', 'a', 'b')])?.code).toBe('no-ground');
  });

  it('voltage loops through V, E, H and V-type B elements', () => {
    const owner = (n: string) => ({ refdes: n.toUpperCase() });
    expect(checkVoltageLoops([V('V1', 'a', '0'), R('R1', 'a', '0')])).toEqual([]);
    const par = checkVoltageLoops([V('V1', 'a', '0'), V('V2', 'a', '0')], owner);
    expect(par).toEqual([expect.objectContaining({ code: 'voltage-loop', refdes: 'V2', message: expect.stringMatching(/V1, V2/) })]);
    const tri = checkVoltageLoops([
      V('V1', 'a', '0'),
      { type: 'E', name: 'E1', nodes: ['b', 'a', 'x', '0'], value: 2, params: {} },
      { type: 'B', name: 'B1', nodes: ['b', 'gnd'], expr: 'V=1', params: {} },
    ]);
    expect(tri[0].message).toMatch(/E1, V1, B1/);
    expect(checkVoltageLoops([V('V1', 'a', '0'), { type: 'B', name: 'B1', nodes: ['a', '0'], expr: 'I=1m', params: {} }])).toEqual([]);
    expect(checkVoltageLoops([V('V9', 'n', 'N')])[0].message).toMatch(/short-circuited/);
  });

  it('inductors are DC shorts: a source across an inductor and parallel inductors are loops', () => {
    const L = (name: string, a: string, b: string) => ({ type: 'L' as const, name, nodes: [a, b], value: 1e-3, params: {} });
    // V1 directly across L1 (a transformer primary on a DC supply)
    const across = checkVoltageLoops([V('V1', 'a', '0'), L('L1', 'a', '0')]);
    expect(across).toEqual([expect.objectContaining({ severity: 'error', code: 'voltage-loop', message: expect.stringMatching(/^L1 shorts V1 at DC/) })]);
    // in series with a source, or behind a resistor, an inductor is fine
    expect(checkVoltageLoops([V('V1', 'a', '0'), L('L1', 'a', 'b'), R('R1', 'b', '0')])).toEqual([]);
    expect(checkVoltageLoops([V('V1', 'a', '0'), R('R1', 'a', 'b'), L('L1', 'b', '0')])).toEqual([]);
    // parallel inductors and a self-shorted inductor
    const par = checkVoltageLoops([V('V1', 'a', '0'), R('R1', 'a', 'b'), L('L1', 'b', '0'), L('L2', 'b', '0')]);
    expect(par.map((m) => m.message)).toEqual([expect.stringMatching(/^Inductors form a loop at DC: L1, L2/)]);
    expect(checkVoltageLoops([L('L3', 'b', 'b')])[0].message).toMatch(/L3 is short-circuited.*inductor is a short circuit at DC/);
    // a UIC transient never solves the DC point: the caller downgrades inductor loops to warnings
    const uic = checkVoltageLoops([V('V1', 'a', '0'), L('L1', 'a', '0'), V('V2', 'c', '0'), V('V3', 'c', '0')], undefined, { inductorSeverity: 'warning' });
    expect(uic.map((m) => m.severity)).toEqual(['warning', 'error']); // V2 || V3 stays an error
  });

  it('current-source cutsets are errors, capacitor-only nodes are warnings', () => {
    const owner = (n: string) => ({ refdes: n });
    const err = checkCurrentCutsets([I('I1', 'a', '0'), C('C1', 'a', '0')], owner);
    expect(err).toEqual([expect.objectContaining({ severity: 'error', code: 'current-cutset', refdes: 'I1', net: 'a' })]);
    const g = checkCurrentCutsets([V('V1', 'in', '0'), { type: 'G', name: 'G1', nodes: ['0', 'o', 'in', '0'], value: 1e-3, params: {} }, C('C1', 'o', '0')]);
    expect(g[0]).toMatchObject({ severity: 'error', message: expect.stringMatching(/G1/) });
    const gate = checkCurrentCutsets([
      V('V1', 'd', '0'),
      { type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'n', params: {} },
      C('C1', 'g', '0'),
    ]);
    expect(gate).toEqual([expect.objectContaining({ severity: 'warning', net: 'g' })]);
    expect(checkCurrentCutsets([V('V1', 'a', '0'), R('R1', 'a', 'b'), C('C1', 'b', '0'), I('I1', 'b', '0')])).toEqual([]);
    expect(checkCurrentCutsets([{ type: 'T', name: 'T1', nodes: ['a', '0', 'b', '0'], params: { z0: 50, td: 1e-9 } }, V('V1', 'a', '0')])).toEqual([]);
  });

  it('undefined models and subcircuits', () => {
    const els: ElementIR[] = [
      { type: 'D', name: 'D1', nodes: ['a', '0'], model: 'DX', params: {} },
      { type: 'X', name: 'X1', nodes: ['a', '0'], model: 'SUB', params: {} },
      { type: 'Q', name: 'Q1', nodes: ['a', 'b', '0'], params: {} },
    ];
    const msgs = checkModelRefs(els, { dx: {} }, {});
    expect(msgs.map((m) => m.message)).toEqual(["X1: subcircuit 'SUB' is not defined", 'Q1 has no model']);
  });
});
