/**
 * Live parts inside hierarchical blocks and subcircuits (round 4, step 3): every placed copy of a
 * block has its own instruments, indicators, probes and switch / potentiometer state.
 *
 *  - an instrument inside a block copy is named by its path ("X2.XMM1") and reads the voltages of
 *    THAT copy (two copies of one block with different instance parameters read different values);
 *  - an LED inside a block lights, and only in the copy whose current flows;
 *  - a switch inside a block copy toggles only that copy (PartInstance.inner), also while a
 *    simulation runs (the running stepper takes the change without a restart);
 *  - a probe inside a block measures the copy it sits in;
 *  - the state of a copy saves and reopens.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { createTransientStepper, findVector, runAnalyses } from '../sim';
import { liveLevels, lowerValues, neededVectors, probeKey, readSignal } from '../ui/integration/live';
import { newRung } from '../ladder/edit';
import { DesignBuilder } from './designkit';
import { copyPaths, innerKey, liveParams, resolveLiveName, scopedLive, withLiveParam } from './hierarchy';
import { elementValueChanges } from './interactive';
import { buildNetlist } from './netlister';
import { parseDesign, serializeDesign } from './serialize';
import type { Design } from './types';

/** Two copies of a divider block, each with a multimeter across its lower resistor. */
function dividerCopies(): Design {
  const b = new DesignBuilder('Two dividers');
  const child = b.child('DIV', { kind: 'subcircuit', variables: { RB: '1k' } });
  b.label('IN', -100, 0, { kind: 'hier' });
  const r1 = b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 300, 0, { value: '{RB}' });
  const m = b.part('instruments/multimeter', 'XMM1', 500, 0);
  const g = b.part('sources/ground', 'G1', 400, 200);
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'MID');
  b.labelPin(r2, '1', 'MID');
  b.labelPin(r2, '2', 'GND0');
  b.labelPin(m, '+', 'MID');
  b.labelPin(m, '-', 'GND0');
  b.labelPin(g, '1', 'GND0');
  b.root();
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  const gnd = b.part('sources/ground', 'G0', 0, 200);
  const x1 = b.block(child, 'X1', 300, 0, { RB: '1k' });
  const x2 = b.block(child, 'X2', 300, 200, { RB: '3k' });
  b.labelPin(v, '+', 'VIN');
  b.labelPin(x1, 'IN', 'VIN');
  b.labelPin(x2, 'IN', 'VIN');
  b.labelPin(v, '-', 'G');
  b.labelPin(gnd, '1', 'G');
  return b.design;
}

/** Two copies of "switch + 330 Ω + LED" with a probe on the LED's anode. */
function ledCopies(): Design {
  const b = new DesignBuilder('Two lamps');
  const child = b.child('LAMP', { kind: 'subcircuit' });
  b.label('IN', -100, 0, { kind: 'hier' });
  const s = b.part('basic/switch-spst', 'S1', 100, 0, { closed: 'false' });
  const r = b.part('basic/resistor', 'R1', 300, 0, { value: '330' });
  const led = b.part('diodes/led-red', 'LED1', 500, 0);
  const g = b.part('sources/ground', 'G1', 600, 200);
  const pins = getPart('diodes/led-red')!.symbol.pins.map((x) => x.name);
  b.labelPin(s, '1', 'IN');
  b.labelPin(s, '2', 'A1');
  b.labelPin(r, '1', 'A1');
  b.labelPin(r, '2', 'A2');
  b.labelPin(led, pins[0], 'A2');
  b.labelPin(led, pins[1], 'GND0');
  b.labelPin(g, '1', 'GND0');
  b.probe('voltage', 450, 40, 'PA');
  b.label('A2', 450, 40);
  b.root();
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  const gnd = b.part('sources/ground', 'G0', 0, 200);
  const x1 = b.block(child, 'X1', 300, 0);
  const x2 = b.block(child, 'X2', 300, 200);
  b.labelPin(v, '+', 'VIN');
  b.labelPin(x1, 'IN', 'VIN');
  b.labelPin(x2, 'IN', 'VIN');
  b.labelPin(v, '-', 'G');
  b.labelPin(gnd, '1', 'G');
  return b.design;
}

const opValues = (d: Design): Record<string, number> => {
  const build = buildNetlist(d, { includeAnalysis: false });
  const r = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] })[0];
  expect(r.error).toBeUndefined();
  return Object.fromEntries(r.vectors.map((v) => [v.name, v.re[0]]));
};

describe('instruments inside blocks', () => {
  it('names each copy by its path and reads that copy\'s own voltages', () => {
    const d = dividerCopies();
    const build = buildNetlist(d, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(build.instruments.map((i) => i.refdes).sort()).toEqual(['X1.XMM1', 'X2.XMM1']);
    const values = lowerValues(opValues(d));
    const read = (name: string) => readSignal(build.instruments.find((i) => i.refdes === name)!.channels.v, values)!;
    // 5 V · RB / (1 kΩ + RB), the 1 GΩ meter loads the divider by a few ppm
    expect(read('X1.XMM1')).toBeCloseTo((5 * 1000) / 2000, 4);
    expect(read('X2.XMM1')).toBeCloseTo((5 * 3000) / 4000, 4);
    const scope = build.instruments.find((i) => i.refdes === 'X2.XMM1')!.scope!;
    expect(scope).toMatchObject({ path: ['X2'], local: 'XMM1' });
  });

  it('a multimeter in a nested block is named by the whole path', () => {
    const b = new DesignBuilder('nested');
    const inner = b.child('INNER', { kind: 'subcircuit' });
    b.label('P', -100, 0, { kind: 'hier' });
    const r = b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
    const m = b.part('instruments/multimeter', 'XMM1', 300, 0);
    const g = b.part('sources/ground', 'G1', 200, 200);
    b.labelPin(r, '1', 'P');
    b.labelPin(r, '2', 'GND0');
    b.labelPin(m, '+', 'P');
    b.labelPin(m, '-', 'GND0');
    b.labelPin(g, '1', 'GND0');
    const outer = b.child('OUTER', { kind: 'hierarchical' });
    b.label('Q', -100, 0, { kind: 'hier' });
    const bi = b.block(inner, 'X9', 100, 0);
    b.labelPin(bi, 'P', 'Q');
    b.root();
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '2' });
    const gnd = b.part('sources/ground', 'G0', 0, 200);
    const bo = b.block(outer, 'HB1', 300, 0);
    b.labelPin(v, '+', 'N');
    b.labelPin(bo, 'Q', 'N');
    b.labelPin(v, '-', 'G');
    b.labelPin(gnd, '1', 'G');
    const build = buildNetlist(b.design, { includeAnalysis: false });
    expect(build.instruments.map((i) => i.refdes)).toEqual(['HB1.X9.XMM1']);
    const values = lowerValues(opValues(b.design));
    expect(readSignal(build.instruments[0].channels.v, values)).toBeCloseTo(2, 6);
    expect(copyPaths(b.design, inner)).toEqual([['HB1', 'X9']]);
  });

  it('resolves a path back to the part and its copy state', () => {
    const d = dividerCopies();
    expect(resolveLiveName(d, 'X2.XMM1')?.part.partId).toBe('instruments/multimeter');
    expect(resolveLiveName(d, 'X2.XMM1')?.path).toEqual(['X2']);
    expect(resolveLiveName(d, 'V1')?.path).toEqual([]);
    expect(resolveLiveName(d, 'X9.XMM1')).toBeNull();
    expect(resolveLiveName(d, 'X2.NOPE')).toBeNull();
  });
});

describe('indicators and probes inside blocks', () => {
  it('an LED in a block lights, in the copy whose switch is closed only', () => {
    let d = ledCopies();
    const lit = (design: Design) => {
      const build = buildNetlist(design, { includeAnalysis: false });
      const values = opValues(design);
      return { build, levels: liveLevels(build.indicators, values).schematic };
    };
    // both switches open: both dark
    let r = lit(d);
    expect(r.build.indicators.map((i) => i.refdes).sort()).toEqual(['X1.LED1', 'X2.LED1']);
    expect(r.levels['X1/LED1']).toBe(0);
    expect(r.levels['X2/LED1']).toBe(0);
    // close S1 in copy X2 only
    const ref = resolveLiveName(d, 'X2.S1')!;
    d = withLiveParam(d, ref, 'closed', 'true');
    r = lit(d);
    expect(r.levels['X1/LED1']).toBe(0);
    expect(r.levels['X2/LED1']).toBeGreaterThan(0.3);
    // the block design itself is untouched: the switch there is still open
    expect(d.children![0].sheets[0].parts.find((p) => p.refdes === 'S1')!.params.closed).toBe('false');
    expect(liveParams(resolveLiveName(d, 'X2.S1')!).closed).toBe('true');
    expect(liveParams(resolveLiveName(d, 'X1.S1')!).closed).toBe('false');
    // the canvas picks the keys of the copy it shows
    expect(scopedLive(r.levels, ['X2'])).toHaveProperty('LED1');
    expect(scopedLive(r.levels, ['X1']).LED1).toBe(0);
    expect(scopedLive(r.levels, [])['X2/LED1']).toBeUndefined();
  });

  it('a probe inside a block measures the copy it sits in', () => {
    let d = ledCopies();
    d = withLiveParam(d, resolveLiveName(d, 'X1.S1')!, 'closed', 'true');
    const build = buildNetlist(d, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.code === 'other' && m.detail?.id === 'probeFirstInstance')).toEqual([]);
    const probes = build.probes.filter((p) => p.path);
    expect(probes.map((p) => probeKey(p)).length).toBe(2);
    expect(new Set(probes.map((p) => probeKey(p))).size).toBe(2);
    const values = lowerValues(opValues(d));
    const volt = (path: string) => readSignal(probes.find((p) => p.path!.join('/') === path)!.signal, values)!;
    // copy X1 conducts (LED forward voltage ~ 1.7 V); copy X2 has its switch open, so only the
    // switch's leakage (a fraction of a microampere) flows and the LED sits near 1 V
    expect(volt('X1')).toBeGreaterThan(1.4);
    expect(volt('X1')).toBeLessThan(2.6);
    expect(volt('X2')).toBeLessThan(1.2);
    expect(probes.every((p) => p.name.includes('.'))).toBe(true);
  });
});

describe('switches inside blocks while simulating', () => {
  it('toggling one copy changes only that copy, in place (no restart)', () => {
    const d0 = ledCopies();
    const b0 = buildNetlist(d0, { includeAnalysis: false });
    const stepper = createTransientStepper(b0.netlist, { tstep: 1e-4 });
    stepper.advance(1e-3);
    const ledNode = (b: ReturnType<typeof buildNetlist>, path: string) => {
      const probe = b.probes.find((p) => p.path?.join('/') === path)!;
      return probe.signal.kind === 'voltage' ? probe.signal.pos : '';
    };
    const v = (b: ReturnType<typeof buildNetlist>, path: string) => stepper.latest()[`V(${ledNode(b, path)})`];
    expect(v(b0, 'X1')).toBeLessThan(1.2);
    expect(v(b0, 'X2')).toBeLessThan(1.2);

    const d1 = withLiveParam(d0, resolveLiveName(d0, 'X2.S1')!, 'closed', 'true');
    const b1 = buildNetlist(d1, { includeAnalysis: false });
    // the two copies now have different subcircuits, yet the change is a plain setParam
    expect(Object.keys(b1.netlist.subckts).length).toBeGreaterThan(Object.keys(b0.netlist.subckts).length);
    const changes = elementValueChanges(b0.netlist, b1.netlist);
    expect(changes).not.toBeNull();
    expect(changes!.length).toBeGreaterThan(0);
    stepper.setParam(changes![0].element, changes![0].param, changes![0].value);
    for (const c of changes!.slice(1)) stepper.setParam(c.element, c.param, c.value);
    stepper.advance(3e-3);
    expect(v(b1, 'X2')).toBeGreaterThan(1.4);
    expect(v(b1, 'X1')).toBeLessThan(1.2);
    // closing the other copy as well, and reopening the first
    const d2 = withLiveParam(withLiveParam(d1, resolveLiveName(d1, 'X1.S1')!, 'closed', 'true'), resolveLiveName(d1, 'X2.S1')!, 'closed', 'false');
    const b2 = buildNetlist(d2, { includeAnalysis: false });
    const changes2 = elementValueChanges(b1.netlist, b2.netlist);
    expect(changes2).not.toBeNull();
    for (const c of changes2!) stepper.setParam(c.element, c.param, c.value);
    stepper.advance(6e-3);
    expect(v(b2, 'X1')).toBeGreaterThan(1.4);
    expect(v(b2, 'X2')).toBeLessThan(1.2);
  });

  it('a top-level interactive change is still a plain in-place change', () => {
    const d = ledCopies();
    const b0 = buildNetlist(d, { includeAnalysis: false });
    const v = d.sheets[0].parts.find((p) => p.refdes === 'V1')!;
    const d1: Design = { ...d, sheets: [{ ...d.sheets[0], parts: d.sheets[0].parts.map((p) => (p === v ? { ...p, params: { ...p.params, value: '3' } } : p)) }] };
    const changes = elementValueChanges(b0.netlist, buildNetlist(d1, { includeAnalysis: false }).netlist);
    expect(changes?.map((c) => c.param)).toContain('dc');
  });
});

describe('state of a block copy saves and reopens', () => {
  it('round-trips PartInstance.inner byte for byte', () => {
    let d = ledCopies();
    d = withLiveParam(d, resolveLiveName(d, 'X2.S1')!, 'closed', 'true');
    const text = serializeDesign(d);
    expect(text).toContain('"inner"');
    const back = parseDesign(text);
    expect(serializeDesign(back)).toBe(text);
    expect(liveParams(resolveLiveName(back, 'X2.S1')!).closed).toBe('true');
    expect(liveParams(resolveLiveName(back, 'X1.S1')!).closed).toBe('false');
  });

  it('keys nested copies relative to the top-level block', () => {
    expect(innerKey(['X1'], 'S1')).toBe('S1');
    expect(innerKey(['X1', 'X2'], 'S1')).toBe('X2/S1');
  });

  it('ignores the state of a part that no longer exists', () => {
    let d = ledCopies();
    d = withLiveParam(d, resolveLiveName(d, 'X2.S1')!, 'closed', 'true');
    const x2 = d.sheets[0].parts.find((p) => p.refdes === 'X2')!;
    const stale: Design = { ...d, sheets: [{ ...d.sheets[0], parts: d.sheets[0].parts.map((p) => (p === x2 ? { ...p, inner: { ...p.inner, GONE: { closed: 'true' } } } : p)) }] };
    const build = buildNetlist(stale, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const r = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] })[0];
    expect(r.error).toBeUndefined();
    expect(findVector(r, 'V(VIN)')).toBeDefined();
  });
});

describe('ladder programs inside blocks', () => {
  it('every placed copy has its own program binding, found by path', () => {
    const b = new DesignBuilder('PLC twice');
    const child = b.child('Cabinet', { kind: 'hierarchical' });
    b.part('misc-digital/plc-controller', 'PLC1', 0, 0);
    const inp = b.part('misc-digital/plc-input-4', 'PLCI1', 300, 0);
    const v = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '24' });
    b.connect(v, '+', inp, 'I0');
    const gnd = b.part('sources/ground', 'GND1', 100, 400);
    b.connect(v, '-', gnd, '1');
    b.connect(inp, 'COM', gnd, '1');
    b.ladderSheet([newRung('r1')]);
    b.root();
    b.block(child, 'X1', 0, 0);
    b.block(child, 'X2', 0, 200);
    b.part('sources/ground', 'GND0', 0, 400);
    const build = buildNetlist(b.design);
    expect(build.ladder).toBeUndefined();
    expect(build.ladders?.map((l) => l.scope!.path.join('/')).sort()).toEqual(['X1', 'X2']);
    const names = build.ladders!.map((l) => l.element);
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => n.startsWith('A.X'))).toBe(true);
    // the vectors the live view needs are recorded for both copies
    expect(neededVectors(build).filter((n) => n.startsWith('Lscan('))).toHaveLength(2);
    // the sheets the program came from are the child's ladder sheet
    expect(build.ladders![0].sheetIds).toEqual([b.design.children![0].sheets.find((s) => s.kind === 'ladder')!.id]);
  });
});
