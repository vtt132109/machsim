import { describe, expect, it } from 'vitest';
import { buildNetlist, FLOATING_PIN_SHUNT } from './netlister';
import { DesignBuilder } from './designkit';
import { runAnalyses } from '../sim';
import type { ErcMessage, NetlistBuild } from './types';
import type { Netlist } from '../sim/netlist';

function op(netlist: Netlist): Record<string, number> {
  const [r] = runAnalyses({ ...netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars ?? {};
}

const codes = (b: NetlistBuild, code: ErcMessage['code']) => b.erc.filter((m) => m.code === code);
const el = (b: NetlistBuild, name: string) => b.netlist.elements.find((e) => e.name === name);

/** 10 V source, R1 = R2 = 1 kΩ divider, two ground symbols. The middle wire goes R1.2 -> R2.1. */
function divider(reverseMid = false) {
  const b = new DesignBuilder('Divider');
  b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
  b.part('basic/resistor', 'R1', 60, -60);
  b.part('basic/resistor', 'R2', 120, 0, {}, { rotation: 90 });
  b.part('sources/ground', 'GND1', 0, 80);
  b.part('sources/ground', 'GND2', 120, 80);
  b.wire({ x: 0, y: -30 }, { x: 0, y: -60 }, { x: 30, y: -60 });
  const midPts = [
    { x: 90, y: -60 },
    { x: 120, y: -60 },
    { x: 120, y: -30 },
  ];
  b.wire(...(reverseMid ? [...midPts].reverse() : midPts));
  b.wire({ x: 0, y: 30 }, { x: 0, y: 80 });
  b.wire({ x: 120, y: 30 }, { x: 120, y: 80 });
  return b;
}

describe('netlist generation', () => {
  it('builds a divider with deterministic names and the right operating point', () => {
    const build = buildNetlist(divider().design);
    expect(build.erc).toEqual([]);
    expect(build.netlist.elements.map((e) => [e.name, e.nodes])).toEqual([
      ['V1', ['N1', '0']],
      ['R1', ['N1', 'N2']],
      ['R2', ['N2', '0']],
    ]);
    expect(el(build, 'V1')?.source).toEqual({ dc: 10 });
    expect(build.partNets).toMatchObject({ V1: { '+': 'N1', '-': '0' }, R1: { '1': 'N1', '2': 'N2' }, R2: { '1': 'N2', '2': '0' }, GND1: { '1': '0' } });
    const ground = build.nets.find((n) => n.name === '0')!;
    expect(ground.pins).toEqual(expect.arrayContaining([{ refdes: 'V1', pin: '-' }, { refdes: 'R2', pin: '2' }, { refdes: 'GND1', pin: '1' }]));
    expect(build.netlist.analyses).toEqual([{ type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
    expect(op(build.netlist)['V(N2)']).toBeCloseTo(5, 9);
    expect(JSON.stringify(buildNetlist(divider().design))).toBe(JSON.stringify(build));
  });

  it('connects T-junctions and wire ends at pins, but not crossing wires or wires passing over pins', () => {
    // These are the editor's rules (src/ui/store/wireOps.ts): what the schematic shows as
    // connected (nets view, junction dots) is exactly what is simulated.
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', -50, 0); // pins (-80,0) (-20,0)
    b.part('basic/resistor', 'R2', 150, 0); // pins (120,0) (180,0)
    b.wire({ x: -20, y: 0 }, { x: 120, y: 0 });
    b.part('basic/resistor', 'R3', 50, 80, {}, { rotation: 90 }); // pins (50,50) (50,110)
    b.wire({ x: 50, y: 0 }, { x: 50, y: 50 }); // T-junction: endpoint on the horizontal wire
    b.part('basic/resistor', 'R4', 80, -80, {}, { rotation: 90 }); // pins (80,-110) (80,-50)
    b.part('basic/resistor', 'R5', 80, 80, {}, { rotation: 90 }); // pins (80,50) (80,110)
    b.wire({ x: 80, y: -50 }, { x: 80, y: 50 }); // crosses the horizontal wire at (80,0)
    b.part('basic/resistor', 'R6', 20, 30, {}, { rotation: 90 }); // pin 1 at (20,0) on the wire interior
    // corner-to-corner: two L-shaped wires touching only at an interior vertex (200,50)
    b.part('basic/resistor', 'R7', 200, -80, {}, { rotation: 90 }); // pin 2 at (200,-50)
    b.part('basic/resistor', 'R8', 120, 50); // pin 2 at (150,50)
    b.wire({ x: 200, y: -50 }, { x: 200, y: 50 }, { x: 260, y: 50 });
    b.wire({ x: 150, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 100 });
    const build = buildNetlist(b.design);
    const nets = build.partNets;
    const n = nets.R1['2'];
    expect(nets.R2['1']).toBe(n);
    expect(nets.R3['1']).toBe(n);
    expect(nets.R6['1']).not.toBe(n); // the wire only passes over R6.1
    expect(nets.R4['2']).toBe(nets.R5['1']);
    expect(nets.R4['2']).not.toBe(n);
    expect(nets.R7['2']).not.toBe(nets.R8['2']); // touching corners are a crossing
    expect(nets.R7['2']).not.toBe(n);
    const over = build.erc.filter((m) => m.message.includes('passes over it'));
    expect(over.map((m) => [m.refdes, m.pin, m.x, m.y])).toEqual([['R6', '1', 20, 0]]);
  });

  it('an inductor across a DC source is an ERC error, downgraded to a warning for a UIC transient', () => {
    const b = new DesignBuilder('L across V');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    const l = b.part('basic/inductor', 'L1', 200, 0, { value: '1m' });
    b.labelPin(v, '+', 'A');
    b.labelPin(v, '-', '0');
    b.labelPin(l, '1', 'A');
    b.labelPin(l, '2', '0');
    const loops = () => codes(buildNetlist(b.design), 'voltage-loop').map((m) => `${m.severity}:${m.message.slice(0, 18)}`);
    b.design.analysis = { active: 'op', specs: { op: { type: 'op' } } };
    expect(loops()).toEqual(['error:L1 shorts V1 at DC']);
    b.design.analysis = { active: 'tran', specs: { tran: { type: 'tran', tstep: 1e-6, tstop: 1e-4, uic: true } } };
    expect(loops()).toEqual(['warning:L1 shorts V1 at DC']);
  });

  it('a wire ending on a pin connects to it, also at a corner of another wire', () => {
    const b = new DesignBuilder();
    b.part('basic/resistor', 'R1', -50, 0); // pins (-80,0) (-20,0)
    b.part('basic/resistor', 'R2', 100, 60, {}, { rotation: 90 }); // pins (100,30) (100,90)
    // L-shaped wire whose corner is NOT a pin, and a second wire from the corner down to R2.1
    b.wire({ x: -20, y: 0 }, { x: 100, y: 0 }, { x: 160, y: 0 });
    b.wire({ x: 100, y: 0 }, { x: 100, y: 30 });
    const build = buildNetlist(b.design);
    expect(build.partNets.R2['1']).toBe(build.partNets.R1['2']);
    expect(build.erc.filter((m) => m.message.includes('passes over it'))).toEqual([]);
  });

  // since format version 2 plain labels are local to their sheet; global labels (what every
  // version-1 label is migrated to) keep joining across sheets
  it('joins global net labels across sheets (case-insensitive) and honours ground labels', () => {
    const b = new DesignBuilder();
    const r1 = b.part('basic/resistor', 'R1', 0, 0);
    b.labelPin(r1, '2', 'SIG', { global: true });
    b.addSheet('Second');
    const r9 = b.part('basic/resistor', 'R9', 0, 0);
    b.labelPin(r9, '1', 'sig', { global: true });
    b.labelPin(r9, '2', 'gnd');
    const build = buildNetlist(b.design);
    expect(build.partNets.R1['2']).toBe('SIG');
    expect(build.partNets.R9['1']).toBe('SIG');
    expect(build.partNets.R9['2']).toBe('0');
    const sig = build.nets.find((n) => n.name === 'SIG')!;
    expect(sig).toMatchObject({ displayName: 'SIG', named: true });
    expect(sig.pins).toEqual([{ refdes: 'R1', pin: '2' }, { refdes: 'R9', pin: '1' }]);
  });

  it('applies rotation and mirroring to pin positions', () => {
    const b = new DesignBuilder();
    b.part('diodes/1n4148', 'D1', 0, 100, {}, { mirror: true }); // anode now at (30,100)
    b.label('ANODE', 30, 100);
    b.part('basic/resistor', 'R1', 200, 0, {}, { rotation: 270 }); // pin 1 -> (200,30)
    b.label('LOW', 200, 30);
    const build = buildNetlist(b.design);
    expect(build.partNets.D1.A).toBe('ANODE');
    expect(build.partNets.D1.K).toBe('NC_D1_K');
    expect(build.partNets.R1['1']).toBe('LOW');
  });

  it('gives floating pins private nodes with a 1 TΩ shunt and an ERC warning', () => {
    const b = divider();
    b.part('basic/capacitor', 'C1', 300, 0); // pins (270,0) (330,0), both open
    const build = buildNetlist(b.design);
    expect(el(build, 'C1')?.nodes).toEqual(['NC_C1_1', 'NC_C1_2']);
    expect(el(build, 'R_NC_C1_1')).toMatchObject({ type: 'R', nodes: ['NC_C1_1', '0'], value: FLOATING_PIN_SHUNT });
    const fl = codes(build, 'floating-pin');
    expect(fl).toHaveLength(2);
    expect(fl[0]).toMatchObject({ severity: 'warning', refdes: 'C1', pin: '1', x: 270, y: 0, sheetId: 'sheet1' });
    expect(op(build.netlist)['V(N2)']).toBeCloseTo(5, 6);
  });

  it('de-duplicates supply rail sources and reports conflicting voltages', () => {
    const b = new DesignBuilder();
    const v1 = b.part('sources/vcc', 'VCC1', 0, 0);
    const v2 = b.part('sources/vcc', 'VCC2', 200, 0);
    const r1 = b.part('basic/resistor', 'R1', 0, 60, {}, { rotation: 90 });
    const r2 = b.part('basic/resistor', 'R2', 200, 60, {}, { rotation: 90 });
    const g = b.part('sources/ground', 'G1', 100, 150);
    b.connect(v1, '1', r1, '1');
    b.connect(v2, '1', r2, '1');
    b.connect(r1, '2', g, '1');
    b.connect(r2, '2', g, '1');
    const build = buildNetlist(b.design);
    expect(build.erc).toEqual([]);
    expect(build.netlist.elements.filter((e) => e.name === 'V_PWR_VCC')).toEqual([{ type: 'V', name: 'V_PWR_VCC', nodes: ['VCC', '0'], source: { dc: 5 }, params: {} }]);
    expect(build.partNets.R2['1']).toBe('VCC');
    expect(op(build.netlist)['V(VCC)']).toBeCloseTo(5, 9);
    v2.inst.params.voltage = '12';
    const bad = buildNetlist(b.design);
    expect(bad.erc.some((m) => m.severity === 'error' && /V_PWR_VCC/.test(m.message) && m.refdes === 'VCC2')).toBe(true);
  });

  it('skips parts excluded from simulation', () => {
    const b = divider();
    b.part('basic/resistor', 'R3', 60, -120, {}, { excludeFromSim: true });
    b.wire({ x: 30, y: -120 }, { x: 30, y: -60 });
    b.wire({ x: 90, y: -120 }, { x: 90, y: -60 });
    const build = buildNetlist(b.design);
    expect(el(build, 'R3')).toBeUndefined();
    expect(build.partNets.R3).toEqual({ '1': 'N1', '2': 'N2' });
  });

  it('merges custom SPICE models and lets parts use them', () => {
    const b = divider();
    const d = b.part('diodes/1n4148', 'D1', 200, -60, { model: 'MYDIODE' });
    b.labelPin(d, 'A', 'N1x');
    b.labelPin(d, 'K', '0');
    b.design.customSpice = '.model MYDIODE D(IS=1e-12 N=2)\n.param gain=3';
    const build = buildNetlist(b.design);
    expect(el(build, 'D1')?.model).toBe('MYDIODE');
    expect(build.netlist.models.mydiode).toMatchObject({ type: 'D', params: { is: 1e-12, n: 2 } });
    expect(build.netlist.models.ms_1n4148).toBeUndefined();
    expect(build.netlist.params.gain).toBe(3);
    expect(codes(build, 'bad-param')).toEqual([]);
    d.inst.params.model = 'NOPE';
    const missing = buildNetlist(b.design);
    expect(codes(missing, 'bad-param')).toEqual([expect.objectContaining({ refdes: 'D1', message: expect.stringMatching(/NOPE/) })]);
  });

  it('maps label names inside behavioral expressions and rejects unknown nets', () => {
    const b = divider();
    const bv = b.part('sources/behavioral-voltage', 'B1', 300, 0, { expr: '2*V(Mid)' });
    const g = b.part('sources/ground', 'G9', 300, 80);
    b.connect(bv, '-', g, '1');
    b.label('mid', 120, -60);
    const ok = buildNetlist(b.design);
    expect(el(ok, 'B1')?.expr).toBe('V=2*V(mid)');
    expect(ok.partNets.R1['2']).toBe('mid');
    expect(op(ok.netlist)['V(NC_B1_p)']).toBeCloseTo(10, 6);
    bv.inst.params.expr = 'V(nowhere)';
    expect(codes(buildNetlist(b.design), 'bad-param')[0]).toMatchObject({ refdes: 'B1', message: expect.stringMatching(/nowhere/) });
  });
});

describe('probes', () => {
  it('current probe inserts a 0 V source; positive in the wire point order', () => {
    const b = divider();
    const p = b.probe('current', 100, -60, 'P1');
    const build = buildNetlist(b.design);
    expect(build.erc).toEqual([]);
    const sense = el(build, 'V_PR_P1')!;
    expect(sense.source).toEqual({ dc: 0 });
    expect(sense.nodes).toEqual([build.partNets.R1['2'], build.partNets.R2['1']]);
    expect(build.partNets.R1['2']).not.toBe(build.partNets.R2['1']);
    expect(build.probes).toEqual([{ probeId: p.id, name: 'P1', kind: 'current', color: '#e53935', signal: { kind: 'current', element: 'V_PR_P1' } }]);
    expect(op(build.netlist)['I(V_PR_P1)']).toBeCloseTo(5e-3, 9);

    const rev = divider(true);
    rev.probe('current', 100, -60, 'P1');
    expect(op(buildNetlist(rev.design).netlist)['I(V_PR_P1)']).toBeCloseTo(-5e-3, 9);
  });

  it('current probes work at wire corners and wire ends', () => {
    const corner = divider();
    corner.probe('current', 120, -60, 'C');
    expect(op(buildNetlist(corner.design).netlist)['I(V_PR_C)']).toBeCloseTo(5e-3, 9);
    const start = divider();
    start.probe('current', 90, -60, 'S');
    expect(op(buildNetlist(start.design).netlist)['I(V_PR_S)']).toBeCloseTo(5e-3, 9);
    const end = divider();
    end.probe('current', 120, -30, 'E');
    const be = buildNetlist(end.design);
    expect(be.erc).toEqual([]);
    expect(op(be.netlist)['I(V_PR_E)']).toBeCloseTo(5e-3, 9);
  });

  it('power, voltage and differential probes bind the net under them', () => {
    const b = divider();
    b.probe('power', 100, -60, 'PW');
    b.probe('voltage', 0, -45, 'V');
    b.probe('differential', 0, -45, 'D', { x: 120, y: -50 });
    b.probe('digital', 500, 500, 'OFF');
    const build = buildNetlist(b.design);
    const [pw, v, d] = build.probes;
    expect(pw.kind).toBe('power');
    expect(pw.signal).toEqual({ kind: 'voltage', pos: build.partNets.R1['2'], neg: '0' });
    expect(pw.current).toEqual({ kind: 'current', element: 'V_PR_PW' });
    expect(v.signal).toEqual({ kind: 'voltage', pos: 'N1', neg: '0' });
    expect(d.signal).toEqual({ kind: 'voltage', pos: 'N1', neg: build.partNets.R2['1'] });
    expect(build.probes).toHaveLength(3);
    expect(build.erc).toEqual([expect.objectContaining({ code: 'other', severity: 'warning', x: 500, y: 500, sheetId: 'sheet1', message: expect.stringMatching(/OFF/) })]);
  });

  it('current probe off a wire is reported', () => {
    const b = divider();
    b.probe('current', 400, 400, 'X');
    const build = buildNetlist(b.design);
    expect(build.probes).toEqual([]);
    expect(build.erc[0]).toMatchObject({ code: 'other', message: expect.stringMatching(/wire segment/) });
  });
});

describe('instrument and indicator bindings', () => {
  it('binds an oscilloscope and a function generator', () => {
    const b = new DesignBuilder();
    const fg = b.part('instruments/function-generator', 'XFG1', 0, 0, { freq: '2k' }); // + (-20,30) COM (0,30) - (20,30)
    const r = b.part('basic/resistor', 'R1', -20, 80, {}, { rotation: 90 }); // pins (-20,50) (-20,110)
    const g = b.part('sources/ground', 'G1', -20, 140);
    b.connect(fg, '+', r, '1');
    b.connect(r, '2', g, '1');
    const sc = b.part('instruments/scope', 'XSC1', 200, 0);
    b.wire(b.pin(fg, '+'), { x: -20, y: 40 }, { x: b.pin(sc, 'A+').x, y: 40 }, b.pin(sc, 'A+'));
    const build = buildNetlist(b.design);
    expect(build.erc).toEqual([]);
    const node = build.partNets.R1['1'];
    expect(el(build, 'V_XFG1_p')).toMatchObject({ nodes: [node, '0'], source: { tran: { type: 'SIN', args: [0, 1, 2000, 0, 0, 0] }, acMag: 1 } });
    expect(el(build, 'V_XFG1_n')).toBeUndefined();
    expect(build.instruments).toEqual([
      { refdes: 'XFG1', partId: 'instruments/function-generator', kind: 'function-generator', params: expect.objectContaining({ freq: '2k', waveform: 'sine' }), channels: { out: { kind: 'voltage', pos: node, neg: '0' } }, drives: ['V_XFG1_p'] },
      { refdes: 'XSC1', partId: 'instruments/scope', kind: 'oscilloscope', params: expect.objectContaining({ timebase: '1m' }), channels: { A: { kind: 'voltage', pos: node, neg: '0' } }, drives: [] },
    ]);
  });

  it('binds multimeter current mode and LED indicators', () => {
    const b = new DesignBuilder();
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    const mm = b.part('instruments/multimeter', 'XMM1', 100, -100, { mode: 'a' }); // + (90,-70) - (110,-70)
    const r = b.part('basic/resistor', 'R1', 180, -40); // (150,-40) (210,-40)
    const led = b.part('diodes/led-red', 'LED1', 260, 0, {}, { rotation: 90 }); // A (260,-30) K (260,30)
    const g = b.part('sources/ground', 'G1', 0, 60);
    const g2 = b.part('sources/ground', 'G2', 260, 60);
    b.connect(v, '+', mm, '+');
    b.connect(mm, '-', r, '1');
    b.connect(r, '2', led, 'A');
    b.connect(v, '-', g, '1');
    b.connect(led, 'K', g2, '1');
    const build = buildNetlist(b.design);
    expect(build.erc).toEqual([]);
    expect(build.instruments[0].channels.i).toEqual({ kind: 'current', element: 'V_XMM1' });
    expect(build.indicators).toEqual([
      { refdes: 'LED1', partId: 'diodes/led-red', kind: 'led', params: expect.objectContaining({ color: 'red' }), signal: { kind: 'current', element: 'V_LED1_i' } },
    ]);
    const s = op(build.netlist);
    const iLed = s['I(V_LED1_i)'];
    expect(iLed).toBeGreaterThan(2e-3);
    expect(s['I(V_XMM1)']).toBeCloseTo(iLed, 9);
  });
});

describe('ERC', () => {
  it('flags unknown parts, duplicate designators and bad parameters', () => {
    const b = divider();
    b.part('basic/nope', 'Z1', 400, 0);
    b.part('basic/resistor', 'R1', 400, 100, { value: 'abc' });
    b.part('basic/resistor', 'R7', 400, 200, { value: '0' });
    const build = buildNetlist(b.design);
    expect(codes(build, 'unknown-part')).toEqual([expect.objectContaining({ severity: 'error', refdes: 'Z1', x: 400, y: 0, sheetId: 'sheet1' })]);
    expect(codes(build, 'duplicate-refdes')).toEqual([expect.objectContaining({ severity: 'error', refdes: 'R1', x: 400, y: 100 })]);
    const bad = codes(build, 'bad-param');
    expect(bad.map((m) => m.refdes)).toEqual(['R1', 'R7']);
    expect(bad[0].message).toMatch(/abc/);
    expect(bad[1].message).toMatch(/must be > 0/);
  });

  it('flags a missing ground', () => {
    const b = new DesignBuilder();
    const v = b.part('sources/dc-voltage', 'V1', 0, 0);
    const r = b.part('basic/resistor', 'R1', 60, 0, {}, { rotation: 90 });
    b.connect(v, '+', r, '1');
    b.connect(v, '-', r, '2');
    const build = buildNetlist(b.design);
    expect(codes(build, 'no-ground')).toHaveLength(1);
    expect(codes(build, 'current-cutset')).toEqual([]);
  });

  it('flags voltage-source loops (parallel sources, ammeter across a source)', () => {
    const b = divider();
    const v2 = b.part('sources/dc-voltage', 'V2', -100, 0, { value: '5' });
    b.wire(b.pin(v2, '+'), { x: -100, y: -60 }, { x: 0, y: -60 });
    b.wire(b.pin(v2, '-'), { x: -100, y: 80 }, { x: 0, y: 80 });
    const loops = codes(buildNetlist(b.design), 'voltage-loop');
    expect(loops).toHaveLength(1);
    expect(loops[0]).toMatchObject({ severity: 'error', refdes: 'V2' });
    expect(loops[0].message).toMatch(/V1.*V2/);

    const a = divider();
    const am = a.part('indicators/ammeter', 'U1', -60, 0, {}, { rotation: 90 }); // + (-60,-30)  - (-60,30)
    a.wire(a.pin(am, '+'), { x: -60, y: -60 }, { x: 0, y: -60 });
    a.wire(a.pin(am, '-'), { x: -60, y: 80 }, { x: 0, y: 80 });
    expect(codes(buildNetlist(a.design), 'voltage-loop')[0]).toMatchObject({ refdes: 'U1', message: expect.stringMatching(/V_U1/) });
  });

  it('flags current sources without a DC return and capacitor-only nodes', () => {
    const b = new DesignBuilder();
    const i1 = b.part('sources/dc-current', 'I1', 0, 0);
    const c1 = b.part('basic/capacitor', 'C1', 60, -60);
    const g = b.part('sources/ground', 'G1', 0, 80);
    b.connect(i1, '+', c1, '1');
    b.labelPin(c1, '2', '0');
    b.connect(i1, '-', g, '1');
    const cut = codes(buildNetlist(b.design), 'current-cutset');
    expect(cut).toEqual([expect.objectContaining({ severity: 'error', refdes: 'I1' })]);

    const d = divider();
    const c2 = d.part('basic/capacitor', 'C2', 200, -100);
    const c3 = d.part('basic/capacitor', 'C3', 300, -100);
    d.connect(c2, '2', c3, '1');
    d.wire(d.pin(c2, '1'), { x: 170, y: -60 }, { x: 120, y: -60 });
    d.labelPin(c3, '2', 'gnd');
    const warn = codes(buildNetlist(d.design), 'current-cutset');
    expect(warn).toEqual([expect.objectContaining({ severity: 'warning', refdes: 'C2' })]);
  });

  it('flags dangling wires, single-pin nets and nets with several names', () => {
    const b = divider();
    const r = b.part('basic/resistor', 'R5', 300, 0);
    b.wire(b.pin(r, '2'), { x: 400, y: 0 });
    b.labelPin(r, '1', '0');
    b.label('A', 0, -45);
    b.label('B', 15, -60);
    const build = buildNetlist(b.design);
    expect(codes(build, 'dangling-wire')).toEqual([expect.objectContaining({ severity: 'warning', x: 400, y: 0, sheetId: 'sheet1' })]);
    expect(codes(build, 'single-pin-net')).toEqual([expect.objectContaining({ refdes: 'R5', pin: '2', x: 330, y: 0 })]);
    expect(build.erc.some((m) => m.code === 'other' && /several names \(A, B\)/.test(m.message))).toBe(true);
    expect(build.partNets.V1['+']).toBe('A');
  });

  it('a bad instrument setting is an ERC error and no binding is produced', () => {
    const b = divider();
    b.part('instruments/function-generator', 'XFG1', 300, 0, { freq: '0' });
    const build = buildNetlist(b.design);
    expect(codes(build, 'bad-param')[0]).toMatchObject({ refdes: 'XFG1' });
    expect(build.instruments).toEqual([]);
  });
});
