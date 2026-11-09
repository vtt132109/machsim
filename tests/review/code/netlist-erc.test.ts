/**
 * Review: schematic connectivity, netlister and ERC edge cases (src/model).
 * Designs are built with DesignBuilder; electrical expectations are checked by solving the OP.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';
import { checkCurrentCutsets, checkVoltageLoops } from '../../../src/model/erc';
import type { ElementIR } from '../../../src/sim/netlist';
import { runAnalyses } from '../../../src/sim';
import type { NetlistBuild } from '../../../src/model/types';

const el = (type: ElementIR['type'], name: string, nodes: string[], value?: number): ElementIR => ({ type, name, nodes, value, params: {} });
const codes = (b: NetlistBuild) => b.erc.map((m) => `${m.severity}:${m.code}`);

function opOf(b: NetlistBuild) {
  const [r] = runAnalyses({ ...b.netlist, analyses: [{ type: 'op' }] });
  return r;
}

describe('ERC topology rules', () => {
  it('a DC voltage source directly across an inductor is flagged before simulation (the OP is singular)', () => {
    const els = [
      { ...el('V', 'V1', ['a', '0']), source: { dc: 5 } },
      el('L', 'L1', ['a', '0'], 1e-3),
    ];
    // the engine cannot solve it: V1 and L1 impose V(a) = 5 and V(a) = 0 at DC
    const [r] = runAnalyses({ title: 't', elements: els, models: {}, subckts: {}, params: {}, options: {}, analyses: [{ type: 'op' }], ic: {}, nodeset: {}, saves: [] });
    expect(r.error).toMatch(/singular/i);
    // ERC should catch it as a voltage loop (L is a DC short), like a source shorted by a wire
    expect(checkVoltageLoops(els).map((m) => m.code)).toContain('voltage-loop');
  });

  it('a current source in series with a capacitor is a current-cutset error', () => {
    const els = [
      { ...el('I', 'I1', ['0', 'a']), source: { dc: 1e-3 } },
      el('C', 'C1', ['a', '0'], 1e-6),
    ];
    const msgs = checkCurrentCutsets(els);
    expect(msgs.map((m) => `${m.severity}:${m.code}`)).toEqual(['error:current-cutset']);
  });

  it('a capacitor-coupled node is only a warning; a node behind a resistor is fine', () => {
    const els = [
      { ...el('V', 'V1', ['in', '0']), source: { dc: 1 } },
      el('C', 'C1', ['in', 'x'], 1e-6),
      el('C', 'C2', ['x', '0'], 1e-6),
      el('R', 'R1', ['in', 'y'], 1e3),
    ];
    const msgs = checkCurrentCutsets(els);
    expect(msgs.map((m) => `${m.severity}:${m.code}:${m.net}`)).toEqual(['warning:current-cutset:x']);
  });

  it('parallel sources are a voltage loop; series sources are not', () => {
    const v = (n: string, a: string, b: string) => ({ ...el('V', n, [a, b]), source: { dc: 1 } });
    expect(checkVoltageLoops([v('V1', 'a', '0'), v('V2', 'a', '0')]).length).toBe(1);
    expect(checkVoltageLoops([v('V1', 'a', '0'), v('V2', 'b', 'a')]).length).toBe(0);
    expect(checkVoltageLoops([v('V1', 'a', 'gnd'), v('V2', 'a', '0')]).length).toBe(1); // gnd alias
  });
});

describe('connectivity edge cases', () => {
  /** V1 (10 V) at x=0 with ground; R1 horizontal; R2 vertical to ground. */
  function base() {
    const b = new DesignBuilder();
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
    const g1 = b.part('sources/ground', 'GND1', 0, 80);
    b.connect(v1, '-', g1, '1');
    return { b, v1 };
  }

  it('collinear overlapping wires (an endpoint on the other wire interior) connect', () => {
    const { b, v1 } = base();
    const r1 = b.part('basic/resistor', 'R1', 230, -60); // pins (200,-60) (260,-60)
    const g2 = b.part('sources/ground', 'GND2', 260, 80);
    const p = b.pin(v1, '+'); // (0,-30)
    b.wire(p, { x: 0, y: -60 }, { x: 120, y: -60 });
    b.wire({ x: 80, y: -60 }, { x: 200, y: -60 }); // overlaps 80..120
    b.wire(b.pin(r1, '2'), { x: 260, y: 80 });
    void g2;
    const build = buildNetlist(b.design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(build.partNets.R1['1']).toBe(build.partNets.V1['+']);
    const r = opOf(build);
    expect(r.error).toBeUndefined();
    expect(r.scalars![`I(V1)`]).toBeCloseTo(-10 / 1e3, 12);
  });

  it('a net label in the interior of a wire joins the wire, across sheets', () => {
    const { b, v1 } = base();
    b.wire(b.pin(v1, '+'), { x: 0, y: -60 }, { x: 100, y: -60 });
    b.label('VX', 50, -60, { global: true }); // wire interior; global: plain labels are local to their sheet since format v2
    b.addSheet();
    const r1 = b.part('basic/resistor', 'R1', 30, 0, {}, { rotation: 90 }); // pins (30,-30) (30,30)
    const g = b.part('sources/ground', 'GND2', 30, 80);
    b.labelPin(r1, '1', 'vx', { global: true }); // case-insensitive
    b.connect(r1, '2', g, '1');
    const build = buildNetlist(b.design);
    expect(build.partNets.R1['1']).toBe(build.partNets.V1['+']);
    expect(codes(build)).not.toContain('warning:single-pin-net');
    // the only free wire end is the stub beyond the label
    expect(build.erc.filter((m) => m.code === 'dangling-wire').map((m) => [m.x, m.y])).toEqual([[100, -60]]);
    expect(opOf(build).scalars!['I(V1)']).toBeCloseTo(-10 / 1e3, 12);
  });

  it('ground through a "GND" label only (no ground symbol) is node 0', () => {
    const b = new DesignBuilder();
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    const r1 = b.part('basic/resistor', 'R1', 60, -30, {}, {});
    b.labelPin(v1, '-', 'GND');
    b.connect(v1, '+', r1, '1');
    b.labelPin(r1, '2', 'gnd');
    const build = buildNetlist(b.design);
    expect(codes(build)).not.toContain('error:no-ground');
    expect(build.partNets.V1['-']).toBe('0');
    expect(build.partNets.R1['2']).toBe('0');
  });

  it('a wire ending on a T-junction or a label is not dangling; a free end is', () => {
    const { b, v1 } = base();
    const r1 = b.part('basic/resistor', 'R1', 130, -60);
    const g2 = b.part('sources/ground', 'GND2', 160, 80);
    b.wire(b.pin(v1, '+'), { x: 0, y: -60 }, b.pin(r1, '1'));
    b.connect(r1, '2', g2, '1');
    b.wire({ x: 50, y: -60 }, { x: 50, y: -100 }); // T from the wire interior to a label
    b.label('TAP', 50, -100);
    b.wire({ x: 70, y: -60 }, { x: 70, y: -120 }); // T with a free end at (70,-120)
    const build = buildNetlist(b.design);
    const dang = build.erc.filter((m) => m.code === 'dangling-wire').map((m) => [m.x, m.y]);
    expect(dang).toEqual([[70, -120]]);
  });

  it('crossing wires do not connect', () => {
    const { b, v1 } = base();
    const r1 = b.part('basic/resistor', 'R1', 130, -60);
    const g2 = b.part('sources/ground', 'GND2', 160, 80);
    b.wire(b.pin(v1, '+'), { x: 0, y: -60 }, b.pin(r1, '1'));
    b.connect(r1, '2', g2, '1');
    const r2 = b.part('basic/resistor', 'R2', 50, -120, {}, { rotation: 90 }); // pins (50,-150) (50,-90)
    const g3 = b.part('sources/ground', 'GND3', 50, 0);
    b.wire(b.pin(r2, '2'), { x: 50, y: 0 }); // passes through (50,-60) — a crossing, not a junction
    void g3;
    const build = buildNetlist(b.design);
    expect(build.partNets.R2['2']).toBe('0');
    expect(build.partNets.V1['+']).not.toBe('0');
    expect(opOf(build).scalars!['I(V1)']).toBeCloseTo(-10 / 1e3, 12);
  });
});
