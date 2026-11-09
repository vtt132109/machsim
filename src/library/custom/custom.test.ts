/**
 * User components: PartDef building (SPICE subcircuit, .model, built-in reuse, LED indicator),
 * netlisting and simulation through the real netlister and engine, design embedding and file
 * round trip, per-part model override, SPICE model libraries (includes, dependencies, pin mapping).
 */
import { describe, expect, it } from 'vitest';
import { getPart, listParts, registerRuntimeParts, libraryVersion, subscribeLibrary } from '../index';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { parseDesign, serializeDesign, DesignFormatError } from '../../model/serialize';
import { runAnalyses } from '../../sim';
import type { AnalysisResult } from '../../sim/results';
import { boxSymbol } from '../symbols';
import {
  autoMapPins,
  customPartDef,
  customPartProblems,
  embedCustomPart,
  modelDependencies,
  modelEntries,
  parseModelLibrary,
  partFromLibrary,
  refreshFromDatabase,
  syncCustomParts,
  templateSymbol,
  usedCustomIds,
  type CustomPartData,
} from './index';
import { loadAllGroups } from '../index';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

const v = (r: AnalysisResult, name: string): number => {
  const x = r.vectors.find((y) => y.name.toLowerCase() === name.toLowerCase());
  if (!x) throw new Error(`no vector ${name} in ${r.vectors.map((y) => y.name).join(', ')}`);
  return x.re[x.re.length - 1];
};

const DIVIDER_TEXT = `* two-resistor divider with a ratio parameter
.subckt DIV2 IN OUT GND PARAMS: RTOP=1k RBOT=1k
R1 IN OUT {RTOP}
R2 OUT GND {RBOT}
.ends DIV2
`;

function divider(params?: CustomPartData['params']): CustomPartData {
  return {
    id: 'custom:div2',
    name: 'Divider DIV2',
    group: 'misc',
    family: 'User',
    description: 'test divider',
    prefix: 'U',
    symbol: boxSymbol({ left: [{ name: 'A' }, { name: 'G' }], right: [{ name: 'Y' }] }),
    params,
    model: { kind: 'spice', text: DIVIDER_TEXT, name: 'DIV2', pins: ['A', 'Y', 'G'] },
  };
}

/** Output of the divider (top, bottom) loaded by the bench's 1 GΩ resistor, from 10 V. */
const divided = (top: number, bottom: number) => {
  const low = (bottom * 1e9) / (bottom + 1e9);
  return (10 * low) / (top + low);
};

/** Source V1 = 10 V on net IN, the part between IN / OUT / 0. */
function benchWith(data: CustomPartData, pins: Record<string, string>, params: Record<string, string> = {}) {
  const b = new DesignBuilder('custom');
  b.design.customParts = [data];
  const s = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '10' });
  b.labelPin(s, '+', 'IN');
  b.labelPin(s, '-', '0');
  const u = b.part(data.id, 'U1', 0, 0, params);
  for (const [pin, net] of Object.entries(pins)) b.labelPin(u, pin, net);
  const r = b.part('basic/resistor', 'RL', 200, 0, { value: '1G' });
  b.labelPin(r, '1', 'OUT');
  b.labelPin(r, '2', '0');
  return b.design;
}

describe('user component from a SPICE subcircuit', () => {
  it('netlists as an X element on the mapped pins and simulates', () => {
    const design = benchWith(divider(), { A: 'IN', Y: 'OUT', G: '0' });
    const nb = buildNetlist(design, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const x = nb.netlist.elements.find((e) => e.type === 'X')!;
    expect(x.name).toBe('X_U1');
    expect(x.model).toBe('DIV2');
    expect(x.nodes).toEqual(['IN', 'OUT', '0']);
    expect(Object.keys(nb.netlist.subckts)).toContain('div2');
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    expect(op.error).toBeUndefined();
    expect(v(op, 'V(OUT)')).toBeCloseTo(divided(1e3, 1e3), 9);
  });

  it('passes number parameters as subcircuit PARAMS overrides', () => {
    const data = divider([
      { key: 'RTOP', label: 'Top', default: '1k', kind: 'number', group: 'model' },
      { key: 'RBOT', label: 'Bottom', default: '1k', kind: 'number', group: 'model' },
    ]);
    const design = benchWith(data, { A: 'IN', Y: 'OUT', G: '0' }, { RTOP: '3k' });
    const nb = buildNetlist(design, { includeAnalysis: false });
    expect(nb.netlist.elements.find((e) => e.type === 'X')!.stringParams).toEqual({ RTOP: '3000', RBOT: '1000' });
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    expect(v(op, 'V(OUT)')).toBeCloseTo(divided(3e3, 1e3), 9);
  });

  it('reports problems: unknown model, unmapped terminal, unknown / duplicate pin', () => {
    const base = divider();
    expect(customPartProblems(base)).toEqual([]);
    expect(customPartProblems({ ...base, model: { ...base.model, name: 'NOPE' } as CustomPartData['model'] }).map((p) => p.code)).toEqual(['modelMissing']);
    expect(customPartProblems({ ...base, model: { kind: 'spice', text: DIVIDER_TEXT, name: 'DIV2', pins: ['A', '', 'G'] } }).map((p) => p.code)).toEqual(['terminalUnmapped']);
    expect(customPartProblems({ ...base, model: { kind: 'spice', text: DIVIDER_TEXT, name: 'DIV2', pins: ['A', 'Q', 'A'] } }).map((p) => p.code)).toEqual(['pinUnknown', 'pinUsedTwice']);
    expect(customPartProblems({ ...base, model: { kind: 'spice', text: '.subckt X a b\nR1 a b\n.ends', name: 'X', pins: ['A', 'G'] } }).map((p) => p.code)).toContain('spiceError');
  });

  it('an ERC error (not a crash) when the model text is broken', () => {
    const bad = { ...divider(), model: { kind: 'spice' as const, text: DIVIDER_TEXT, name: 'MISSING', pins: ['A', 'Y', 'G'] } };
    const nb = buildNetlist(benchWith(bad, { A: 'IN', Y: 'OUT', G: '0' }), { includeAnalysis: false });
    expect(nb.erc.some((m) => m.severity === 'error' && m.refdes === undefined ? false : /MISSING is not defined/.test(m.message))).toBe(true);
  });
});

describe('user component from a .model card', () => {
  const diodeText = '.model DMY D(IS=2.52n N=1.752 RS=0.568)';
  const data: CustomPartData = {
    id: 'custom:my-diode',
    name: 'MyDiode',
    group: 'diodes',
    family: 'Generic diode',
    description: 'test',
    prefix: 'D',
    symbol: templateSymbol('diode'),
    model: { kind: 'spice', text: diodeText, name: 'DMY', pins: ['A', 'K'] },
  };

  it('emits one D element with the card and reproduces the diode equation', () => {
    const b = new DesignBuilder('d');
    b.design.customParts = [data];
    const i = b.part('sources/dc-current', 'I1', -200, 0, { value: '10m' });
    b.labelPin(i, '+', 'A');
    b.labelPin(i, '-', '0');
    const d = b.part(data.id, 'D1', 0, 0);
    b.labelPin(d, 'A', 'A');
    b.labelPin(d, 'K', '0');
    const nb = buildNetlist(b.design, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(nb.netlist.elements.find((e) => e.type === 'D')).toMatchObject({ name: 'D1', nodes: ['A', '0'], model: 'DMY' });
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    const vt = 8.617333262e-5 * 300.15;
    const expected = 1.752 * vt * Math.log(10e-3 / 2.52e-9 + 1) + 10e-3 * 0.568;
    expect(v(op, 'V(A)')).toBeCloseTo(expected, 4);
  });

  it('an LED indicator adds a sense source and binds the glow to its current', () => {
    const led: CustomPartData = { ...data, id: 'custom:my-led', symbol: templateSymbol('led'), prefix: 'LED', indicator: { kind: 'led', color: 'green' } };
    const def = customPartDef(led);
    expect(def.indicator?.kind).toBe('led');
    expect(def.params.some((p) => p.key === 'color' && p.default === 'green')).toBe(true);
    const b = new DesignBuilder('led');
    b.design.customParts = [led];
    const i = b.part('sources/dc-current', 'I1', -200, 0, { value: '15m' });
    b.labelPin(i, '+', 'A');
    b.labelPin(i, '-', '0');
    const h = b.part(led.id, 'LED1', 0, 0);
    b.labelPin(h, 'A', 'A');
    b.labelPin(h, 'K', '0');
    const nb = buildNetlist(b.design, { includeAnalysis: false });
    expect(nb.indicators).toHaveLength(1);
    const sig = nb.indicators[0].signal;
    expect(sig).toEqual({ kind: 'current', element: 'V_LED1_i' });
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    expect(Math.abs(v(op, 'I(V_LED1_i)'))).toBeCloseTo(15e-3, 9);
  });
});

describe('user component reusing a library part (new symbol)', () => {
  it('maps the library pins onto the new symbol and keeps the library model', () => {
    const npn = getPart('transistors/2n2222a') ?? listParts().find((p) => p.family === 'NPN BJT' && p.toSpice)!;
    const base = partFromLibrary(npn, { name: 'My NPN' });
    // a box symbol with differently named pins: 1 = E, 2 = B, 3 = C
    const data: CustomPartData = {
      ...base,
      symbol: boxSymbol({ left: [{ name: '1' }, { name: '2' }], right: [{ name: '3' }] }),
      model: { kind: 'builtin', partId: npn.id, pinMap: { E: '1', B: '2', C: '3' } },
    };
    expect(customPartProblems(data)).toEqual([]);
    const b = new DesignBuilder('npn');
    b.design.customParts = [data];
    const vc = b.part('sources/dc-voltage', 'VC', -300, 0, { value: '5' });
    b.labelPin(vc, '+', 'VCC');
    b.labelPin(vc, '-', '0');
    const rb = b.part('basic/resistor', 'RB', -200, 100, { value: '430k' });
    b.labelPin(rb, '1', 'VCC');
    b.labelPin(rb, '2', 'B');
    const rc = b.part('basic/resistor', 'RC', -200, 200, { value: '1k' });
    b.labelPin(rc, '1', 'VCC');
    b.labelPin(rc, '2', 'C');
    const q = b.part(data.id, 'Q1', 0, 0);
    b.labelPin(q, '1', '0');
    b.labelPin(q, '2', 'B');
    b.labelPin(q, '3', 'C');
    const nb = buildNetlist(b.design, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const qel = nb.netlist.elements.find((e) => e.type === 'Q')!;
    expect(qel.nodes.slice(0, 3)).toEqual(['C', 'B', '0']);
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    // the same circuit with the library part itself gives the same collector voltage
    const b2 = new DesignBuilder('npn2');
    const vc2 = b2.part('sources/dc-voltage', 'VC', -300, 0, { value: '5' });
    b2.labelPin(vc2, '+', 'VCC');
    b2.labelPin(vc2, '-', '0');
    const rb2 = b2.part('basic/resistor', 'RB', -200, 100, { value: '430k' });
    b2.labelPin(rb2, '1', 'VCC');
    b2.labelPin(rb2, '2', 'B');
    const rc2 = b2.part('basic/resistor', 'RC', -200, 200, { value: '1k' });
    b2.labelPin(rc2, '1', 'VCC');
    b2.labelPin(rc2, '2', 'C');
    const q2 = b2.part(npn.id, 'Q1', 0, 0);
    b2.labelPin(q2, 'E', '0');
    b2.labelPin(q2, 'B', 'B');
    b2.labelPin(q2, 'C', 'C');
    const [op2] = runAnalyses({ ...buildNetlist(b2.design, { includeAnalysis: false }).netlist, analyses: [{ type: 'op' }] });
    expect(v(op, 'V(C)')).toBeCloseTo(v(op2, 'V(C)'), 9);
    expect(v(op, 'V(C)')).toBeGreaterThan(0.3);
    expect(v(op, 'V(C)')).toBeLessThan(4.9);
  });

  it('new default values of the library parameters are used', () => {
    const res = getPart('basic/resistor')!;
    const data = partFromLibrary(res, { name: 'R 2k2', params: { value: '2.2k' } });
    expect(data.model).toMatchObject({ kind: 'builtin', partId: 'basic/resistor', params: { value: '2.2k' } });
    const def = customPartDef(data);
    expect(def.params.find((p) => p.key === 'value')?.default).toBe('2.2k');
    const b = new DesignBuilder('r');
    b.design.customParts = [data];
    const s = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '2.2' });
    b.labelPin(s, '+', 'A');
    b.labelPin(s, '-', '0');
    const r = b.part(data.id, 'R1', 0, 0);
    b.labelPin(r, '1', 'A');
    b.labelPin(r, '2', '0');
    const [op] = runAnalyses({ ...buildNetlist(b.design, { includeAnalysis: false }).netlist, analyses: [{ type: 'op' }] });
    expect(Math.abs(v(op, 'I(V1)'))).toBeCloseTo(1e-3, 9);
  });
});

describe('design embedding', () => {
  it('a design file carries its user components and simulates after a round trip', () => {
    const design = benchWith(divider(), { A: 'IN', Y: 'OUT', G: '0' });
    const text = serializeDesign(design);
    const back = parseDesign(text);
    expect(back.customParts).toHaveLength(1);
    expect(serializeDesign(back)).toBe(text);
    const [op] = runAnalyses({ ...buildNetlist(back, { includeAnalysis: false }).netlist, analyses: [{ type: 'op' }] });
    expect(v(op, 'V(OUT)')).toBeCloseTo(divided(1e3, 1e3), 9);
  });

  it('rejects malformed component data with JSON paths', () => {
    const raw = JSON.parse(serializeDesign(benchWith(divider(), { A: 'IN', Y: 'OUT', G: '0' })));
    raw.customParts[0].id = 'div2';
    raw.customParts[0].symbol.pins[0].x = 'left';
    raw.customParts[0].model.kind = 'magic';
    let err: unknown;
    try {
      parseDesign(JSON.stringify(raw));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DesignFormatError);
    const issues = (err as DesignFormatError).issues;
    expect(issues).toContain('customParts[0].id: must start with "custom:"');
    expect(issues.some((i) => i.startsWith('customParts[0].symbol.pins[0].x'))).toBe(true);
    expect(issues.some((i) => i.startsWith('customParts[0].model.kind'))).toBe(true);
  });

  it('designs without user components keep their JSON unchanged', () => {
    const b = new DesignBuilder('plain');
    b.part('basic/resistor', 'R1', 0, 0);
    const text = serializeDesign(b.design);
    expect(text).not.toContain('customParts');
    expect(serializeDesign(parseDesign(text))).toBe(text);
  });

  it('syncCustomParts embeds used parts from the lookup and drops unused copies', () => {
    const data = divider();
    const b = new DesignBuilder('sync');
    b.part(data.id, 'U1', 0, 0);
    const synced = syncCustomParts(b.design, (id) => (id === data.id ? data : undefined));
    expect(synced.customParts).toEqual([data]);
    expect(syncCustomParts(synced, () => undefined)).toBe(synced);
    expect(usedCustomIds(synced)).toEqual(new Set([data.id]));
    const empty = { ...synced, sheets: synced.sheets.map((s) => ({ ...s, parts: [] })) };
    expect(syncCustomParts(empty, () => data).customParts).toBeUndefined();
    const plain = new DesignBuilder('x').design;
    expect(syncCustomParts(plain, () => data)).toBe(plain);
  });

  it('refreshFromDatabase replaces changed copies only', () => {
    const data = divider();
    const d = embedCustomPart(new DesignBuilder('r').design, data);
    expect(refreshFromDatabase(d, () => data).updated).toEqual([]);
    const newer = { ...data, description: 'v2' };
    const r = refreshFromDatabase(d, () => newer);
    expect(r.updated).toEqual([data.id]);
    expect(r.design.customParts![0].description).toBe('v2');
  });
});

describe('run-time registry', () => {
  it('registers, lists, looks up and notifies; built-in ids are never shadowed', () => {
    const before = listParts().length;
    const v0 = libraryVersion();
    let calls = 0;
    const off = subscribeLibrary(() => (calls += 1));
    const def = customPartDef(divider());
    registerRuntimeParts('db:user', [def]);
    expect(getPart('custom:div2')).toBe(def);
    expect(listParts()).toHaveLength(before + 1);
    expect(libraryVersion()).toBeGreaterThan(v0);
    // a design copy wins over the database copy
    const designCopy = customPartDef({ ...divider(), description: 'design copy' });
    registerRuntimeParts('design', [designCopy]);
    expect(getPart('custom:div2')).toBe(designCopy);
    expect(listParts()).toHaveLength(before + 1);
    // a run-time part cannot replace a built-in id
    registerRuntimeParts('db:corporate', [{ ...customPartDef(divider()), id: 'basic/resistor' }]);
    expect(getPart('basic/resistor')?.name).not.toBe('Divider DIV2');
    registerRuntimeParts('db:user', []);
    registerRuntimeParts('design', []);
    registerRuntimeParts('db:corporate', []);
    expect(getPart('custom:div2')).toBeUndefined();
    expect(listParts()).toHaveLength(before);
    off();
    expect(calls).toBe(6);
  });
});

describe('per-part model override', () => {
  function diodeBench(override?: string, customSpice?: string, partId = 'diodes/1n4148') {
    const b = new DesignBuilder('ov');
    if (customSpice) b.design.customSpice = customSpice;
    const i = b.part('sources/dc-current', 'I1', -200, 0, { value: '10m' });
    b.labelPin(i, '+', 'A');
    b.labelPin(i, '-', '0');
    const d = b.part(partId, 'D1', 0, 0);
    if (override) d.inst.modelOverride = override;
    b.labelPin(d, 'A', 'A');
    b.labelPin(d, 'K', '0');
    return buildNetlist(b.design, { includeAnalysis: false });
  }

  it('swaps the diode model for the imported card', () => {
    const nb = diodeBench('DUSER', '.model DUSER D(IS=1e-12 N=2 RS=0)');
    expect(nb.erc.filter((m) => /override/i.test(m.message))).toEqual([]);
    expect(nb.netlist.elements.find((e) => e.type === 'D')!.model).toBe('DUSER');
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    const vt = 8.617333262e-5 * 300.15;
    expect(v(op, 'V(A)')).toBeCloseTo(2 * vt * Math.log(10e-3 / 1e-12 + 1), 4);
  });

  it('warns and keeps the own model for unknown or unfitting cards', () => {
    const unknown = diodeBench('NOPE');
    expect(unknown.erc.find((m) => m.detail?.id === 'modelOverrideUnknown')).toBeTruthy();
    const wrong = diodeBench('QX', '.model QX NPN(BF=100)');
    expect(wrong.erc.find((m) => m.detail?.id === 'modelOverrideIncompatible')).toBeTruthy();
    expect(wrong.netlist.elements.find((e) => e.type === 'D')!.model).not.toBe('QX');
  });

  it('a subcircuit replaces an X element with the same port count', () => {
    const b = new DesignBuilder('opamp');
    b.design.customSpice = '.subckt FOLLOW P N O VP VN\nE1 O 0 P 0 1\n.ends';
    const vin = b.part('sources/dc-voltage', 'V1', -300, 0, { value: '1.25' });
    b.labelPin(vin, '+', 'IN');
    b.labelPin(vin, '-', '0');
    const vp = b.part('sources/dc-voltage', 'V2', -300, 200, { value: '15' });
    b.labelPin(vp, '+', 'VP');
    b.labelPin(vp, '-', '0');
    const vn = b.part('sources/dc-voltage', 'V3', -300, 400, { value: '-15' });
    b.labelPin(vn, '+', 'VN');
    b.labelPin(vn, '-', '0');
    // the library op-amp macromodel is a 5-port X element
    const u = b.part('analog/opamp', 'U1', 0, 0);
    u.inst.modelOverride = 'FOLLOW';
    b.labelPin(u, 'IN+', 'IN');
    b.labelPin(u, 'IN-', 'OUT');
    b.labelPin(u, 'OUT', 'OUT');
    b.labelPin(u, 'V+', 'VP');
    b.labelPin(u, 'V-', 'VN');
    const nb = buildNetlist(b.design, { includeAnalysis: false });
    const x = nb.netlist.elements.find((e) => e.type === 'X')!;
    expect(x.model).toBe('FOLLOW');
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    expect(v(op, 'V(OUT)')).toBeCloseTo(1.25, 6);
  });

  it('survives a design file round trip', () => {
    const b = new DesignBuilder('ov');
    const d = b.part('diodes/1n4148', 'D1', 0, 0);
    d.inst.modelOverride = 'DUSER';
    const back = parseDesign(serializeDesign(b.design));
    expect(back.sheets[0].parts[0].modelOverride).toBe('DUSER');
  });
});

describe('SPICE model libraries', () => {
  it('lists models and subcircuits with their terminals', () => {
    const lib = parseModelLibrary(`${DIVIDER_TEXT}\n.model Q1X NPN(BF=200)\n.model SWX SW(VT=1)\n`);
    expect(lib.errors).toEqual([]);
    const e = modelEntries(lib);
    expect(e.map((x) => [x.name, x.kind, x.type, x.terminals.join(' ')])).toEqual([
      ['DIV2', 'subckt', 'SUBCKT', 'IN OUT GND'],
      ['Q1X', 'model', 'NPN', 'C B E'],
      ['SWX', 'model', 'SW', ''],
    ]);
    expect(e[0].params).toEqual({ RTOP: '1k', RBOT: '1k' });
  });

  it('resolves .include and .lib sections from the file map and reports missing files', () => {
    const main = `.include "models/opa.lib"\n.lib "parts.lib" fast\n.include missing.inc\n`;
    const files = new Map([
      ['models/opa.lib', '.subckt BUF a y\nE1 y 0 a 0 1\n.ends\n.include helper.lib\n'],
      ['models/helper.lib', '.model DH D(IS=1e-15)\n'],
      ['parts.lib', '.lib slow\n.model DS D(N=2)\n.endl\n.lib fast\n.model DF D(N=1.1)\n.endl\n'],
    ]);
    const lib = parseModelLibrary(main, { files });
    expect(lib.subckts.map((s) => s.name)).toEqual(['BUF']);
    expect(lib.models.map((m) => m.name).sort()).toEqual(['DF', 'DH']);
    expect(lib.missing).toEqual(['missing.inc']);
  });

  it('collects the top-level cards a subcircuit needs', () => {
    const lib = parseModelLibrary(`
.subckt TOP a b
X1 a m INNER
D1 m b DTOP
.ends
.subckt INNER p q
Q1 p q 0 QIN
.model QLOCAL NPN
.ends
.model DTOP D
.model QIN NPN
.model UNUSED PNP
`);
    const deps = modelDependencies(lib, 'TOP');
    expect(deps.subckts.map((s) => s.name).sort()).toEqual(['INNER', 'TOP']);
    expect(deps.models.map((m) => m.name).sort()).toEqual(['DTOP', 'QIN']);
  });

  it('maps terminals to symbol pins by name, synonym, then order', () => {
    expect(autoMapPins(['C', 'B', 'E'], ['E', 'B', 'C'])).toEqual(['C', 'B', 'E']);
    expect(autoMapPins(['INP', 'INN', 'OUT', 'VCC', 'VEE'], ['IN-', 'IN+', 'OUT', 'V+', 'V-'])).toEqual(['IN+', 'IN-', 'OUT', 'V+', 'V-']);
    expect(autoMapPins(['anode', 'cathode'], ['A', 'K'])).toEqual(['A', 'K']);
    expect(autoMapPins(['x', 'y', 'z'], ['1', '2'])).toEqual(['1', '2', '']);
  });
});
