/**
 * The whole ladder path, end to end: a design with a ladder sheet and a PLC rack becomes one
 * `A_LADDER` element, the element really drives and reads the circuit in a transient, and the
 * wiring mistakes a learner makes come back as ERC messages.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder, type PartHandle } from './designkit';
import { buildNetlist } from './netlister';
import { parseDesign, serializeDesign } from './serialize';
import { channelAddress } from './ladderBuild';
import { runAnalyses } from '../sim';
import type { AnalysisResult } from '../sim/results';
import type { LadderNode, LadderOutput, LadderRung } from '../ladder/types';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const nc = (address: string): LadderNode => ({ kind: 'contact', type: 'nc', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });
const coil = (address: string): LadderOutput => ({ kind: 'coil', address });

let seq = 0;
const rung = (logic: LadderNode | undefined, outputs: LadderOutput[]): LadderRung => {
  seq += 1;
  return logic ? { id: `r${seq}`, logic, outputs } : { id: `r${seq}`, outputs };
};

const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
};

/** Value of a vector at time t (nearest recorded sample at or before t). */
function at(r: AnalysisResult, name: string, t: number): number {
  const time = r.scale!.re;
  const v = vec(r, name).re;
  let k = 0;
  while (k + 1 < time.length && time[k + 1] <= t) k++;
  return v[k];
}

/** A rack bench: supply, ladder sheet, one input module and one output module with a load. */
class Rack {
  readonly b = new DesignBuilder('ladder bench');
  private x = 0;

  constructor(rungs: LadderRung[], scan = 0.01) {
    this.b.ladderSheet(rungs, 'Ladder 1');
    this.b.useSheet(0);
    this.part('sources/dc-voltage', 'V24', { value: '24' }, { '+': 'p24', '-': '0' });
    this.part('misc-digital/plc-controller', 'PLC1', { scan: String(scan) }, {});
  }

  part(id: string, ref: string, params: Record<string, string>, pins: Record<string, string>): PartHandle {
    const h = this.b.part(id, ref, this.x, 0, params);
    this.x += 400;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }

  /** Input module on byte `byte`; `nets` maps channel pin -> net name. */
  inputs(ref: string, byte: string, nets: Record<string, string>): PartHandle {
    return this.part('misc-digital/plc-input-8', ref, { byte }, { COM: '0', ...nets });
  }

  outputs(ref: string, byte: string, nets: Record<string, string>): PartHandle {
    return this.part('misc-digital/plc-output-8', ref, { byte }, { COM: '0', ...nets });
  }

  /** A button: a pulse source that goes to 24 V at `td` for `width` seconds. */
  button(ref: string, net: string, td: number, width: number): PartHandle {
    return this.part('sources/pulse-voltage', ref, { v1: '0', v2: '24', delay: String(td), width: String(width), period: '1k', rise: '1u', fall: '1u' }, { '+': net, '-': '0' });
  }

  /** A switch held at 24 V (a maintained contact). */
  onSwitch(ref: string, net: string): PartHandle {
    return this.part('sources/dc-voltage', ref, { value: '24' }, { '+': net, '-': '0' });
  }

  /** Load on an output channel so its voltage can be read. */
  load(ref: string, net: string): PartHandle {
    return this.part('basic/resistor', ref, { value: '1k' }, { 1: net, 2: '0' });
  }

  build() {
    const build = buildNetlist(this.b.design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error').map((e) => e.message)).toEqual([]);
    return build;
  }

  run(tstop: number, tstep = 0.002): AnalysisResult {
    const build = this.build();
    const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep, tstop }] });
    expect(r.error, r.error).toBeUndefined();
    return r;
  }
}

describe('ladder rack in the netlist', () => {
  it('builds one element for the whole rack, with the channels in address order', () => {
    const r = new Rack([rung(no('I0.0'), [coil('Q0.0')])]);
    r.inputs('PLCI1', '0', { I0: 'in0', I3: 'in3' });
    r.outputs('PLCQ1', '1', { Q0: 'out0' });
    r.onSwitch('V1', 'in0');
    r.onSwitch('V2', 'in3');
    r.load('R1', 'out0');
    const build = r.build();
    const a = build.netlist.elements.filter((e) => e.type === 'A');
    expect(a).toHaveLength(1);
    expect(a[0].nodes).toEqual(['in0', 'in3', 'out0', '0']);
    expect(build.ladder).toBeDefined();
    expect(build.ladder!.refdes).toBe('PLC1');
    expect(build.ladder!.element).toBe(a[0].name);
    expect(build.ladder!.errors).toEqual([]);
    expect(build.ladder!.ir.ports).toEqual([
      { kind: 'di', index: 0, vth: 12, vhys: 4 },
      { kind: 'di', index: 3, vth: 12, vhys: 4 },
      { kind: 'q', index: 8, von: 24 },
    ]);
    expect(build.ladder!.ir.scan).toBeCloseTo(0.01, 12);
  });

  it('puts the analog channels first and takes the scan period from the controller', () => {
    const r = new Rack([rung({ kind: 'compare', op: 'gt', left: 'AI0', right: '5' }, [coil('Q0.0')])], 0.02);
    r.part('misc-digital/plc-analog-in-2', 'PLCA1', { chan: '0' }, { COM: '0', AI0: 'lvl' });
    r.outputs('PLCQ1', '0', { Q0: 'out0' });
    r.part('sources/dc-voltage', 'VL', { value: '8' }, { '+': 'lvl', '-': '0' });
    r.load('R1', 'out0');
    const build = r.build();
    const a = build.netlist.elements.find((e) => e.type === 'A')!;
    expect(a.nodes).toEqual(['lvl', 'out0', '0']);
    expect(build.ladder!.ir.scan).toBeCloseTo(0.02, 12);
  });

  it('names the channels of a module from its address byte', () => {
    expect(channelAddress({ kind: 'input', channels: 8, pins: [] }, 2, 5)).toBe('I2.5');
    expect(channelAddress({ kind: 'output', channels: 8, pins: [] }, 1, 0)).toBe('Q1.0');
    expect(channelAddress({ kind: 'analog-input', channels: 2, pins: [] }, 2, 1)).toBe('AI3');
  });
});

describe('ladder rack ERC', () => {
  const messages = (b: ReturnType<typeof buildNetlist>) => b.erc.map((m) => `${m.severity}:${m.detail?.id ?? m.code}`);

  it('warns about a rack without a ladder sheet', () => {
    const b = new DesignBuilder('no program');
    const h = b.part('misc-digital/plc-input-8', 'PLCI1', 0, 0, { byte: '0' });
    b.labelPin(h, 'COM', '0');
    b.labelPin(h, 'I0', 'in0');
    const v = b.part('sources/dc-voltage', 'V1', 400, 0, { value: '24' });
    b.labelPin(v, '+', 'in0');
    b.labelPin(v, '-', '0');
    expect(messages(buildNetlist(b.design, { includeAnalysis: false }))).toContain('warning:ladderNoProgram');
  });

  it('warns about a ladder sheet without modules', () => {
    const b = new DesignBuilder('no modules');
    b.ladderSheet([rung(no('I0.0'), [coil('Q0.0')])], 'Ladder 1');
    b.useSheet(0);
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '24' });
    b.labelPin(v, '+', 'a');
    b.labelPin(v, '-', '0');
    b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    b.labelPin({ sheet: b.sheet, inst: b.sheet.parts[1] }, '1', 'a');
    b.labelPin({ sheet: b.sheet, inst: b.sheet.parts[1] }, '2', '0');
    expect(messages(buildNetlist(b.design, { includeAnalysis: false }))).toContain('warning:ladderNoModules');
  });

  it('refuses two modules on the same address byte', () => {
    const r = new Rack([rung(no('I0.0'), [coil('Q0.0')])]);
    r.inputs('PLCI1', '0', { I0: 'in0' });
    r.inputs('PLCI2', '0', { I0: 'in1' });
    r.outputs('PLCQ1', '0', { Q0: 'out0' });
    r.onSwitch('V1', 'in0');
    r.onSwitch('V2', 'in1');
    r.load('R1', 'out0');
    const build = buildNetlist(r.b.design, { includeAnalysis: false });
    expect(messages(build)).toContain('error:ladderDuplicateChannel');
  });

  it('refuses modules on different commons', () => {
    const r = new Rack([rung(no('I0.0'), [coil('Q0.0')])]);
    r.inputs('PLCI1', '0', { I0: 'in0' });
    r.part('misc-digital/plc-output-8', 'PLCQ1', { byte: '0' }, { COM: 'other', Q0: 'out0' });
    r.onSwitch('V1', 'in0');
    r.load('R1', 'out0');
    r.load('R2', 'other');
    const build = buildNetlist(r.b.design, { includeAnalysis: false });
    expect(messages(build)).toContain('error:ladderCommonSplit');
  });

  it('reports a rung the compiler could not read and keeps the others running', () => {
    const r = new Rack([rung(no('Z9.9'), [coil('Q0.0')]), rung(no('I0.0'), [coil('Q0.1')])]);
    r.inputs('PLCI1', '0', { I0: 'in0' });
    r.outputs('PLCQ1', '0', { Q0: 'out0', Q1: 'out1' });
    r.onSwitch('V1', 'in0');
    r.load('R1', 'out0');
    r.load('R2', 'out1');
    const build = buildNetlist(r.b.design, { includeAnalysis: false });
    expect(messages(build)).toContain('error:ladderRung');
    expect(build.ladder!.ir.rungs).toHaveLength(1);
  });
});

describe('ladder sheets in a design file', () => {
  it('round-trips through the .msim format, rungs and machines included', () => {
    const r = new Rack([
      rung(and(or(no('I0.0'), no('Q0.0')), nc('I0.1')), [coil('Q0.0'), { kind: 'set', address: 'M1.2' }]),
      { id: 'r-off', comment: 'tắt thử', logic: { kind: 'compare', op: 'ge', left: 'T1.ET', right: '2.5' }, outputs: [{ kind: 'ton', address: 'T1', preset: '3' }], disabled: true },
    ]);
    r.inputs('PLCI1', '0', { I0: 'start', I1: 'stop' });
    r.outputs('PLCQ1', '0', { Q0: 'motor' });
    r.part('misc/water-tank', 'TK1', { volume: '10' }, { PUMP: 'motor', COM: '0' });
    r.load('RM', 'motor');
    const text = serializeDesign(r.b.design);
    const back = parseDesign(text);
    expect(back.sheets.map((s) => s.kind)).toEqual([undefined, 'ladder']);
    expect(back.sheets[1].ladder).toEqual(r.b.design.sheets[1].ladder);
    expect(serializeDesign(back)).toBe(text);
    // and the reloaded design builds the same program
    const a = buildNetlist(r.b.design, { includeAnalysis: false });
    const b = buildNetlist(back, { includeAnalysis: false });
    expect(b.ladder?.ir).toEqual(a.ladder?.ir);
  });

  it('a design without ladder sheets writes nothing extra (older files stay identical)', () => {
    const b = new DesignBuilder('plain');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    b.labelPin(v, '+', 'a');
    b.labelPin(v, '-', '0');
    b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const text = serializeDesign(b.design);
    expect(text).not.toContain('ladder');
    expect(text).not.toContain('"kind"');
    expect(serializeDesign(parseDesign(text))).toBe(text);
  });

  it('rejects a broken ladder sheet with a path to the problem', () => {
    const base = JSON.parse(serializeDesign(new Rack([rung(no('I0.0'), [coil('Q0.0')])]).b.design)) as Record<string, unknown>;
    const sheets = base.sheets as Record<string, unknown>[];
    sheets[1].ladder = [{ id: 'r1', logic: { kind: 'nope' }, outputs: [] }];
    expect(() => parseDesign(JSON.stringify(base))).toThrow(/ladder\[0\]/);
    const bad = JSON.parse(serializeDesign(new Rack([rung(no('I0.0'), [coil('Q0.0')])]).b.design)) as Record<string, unknown>;
    const s2 = bad.sheets as Record<string, unknown>[];
    delete s2[1].kind;
    expect(() => parseDesign(JSON.stringify(bad))).toThrow(/kind/);
  });
});

describe('ladder running in a transient', () => {
  it('a start / stop rung with self-holding keeps the contactor on after the button', () => {
    // (Start OR Q0.0) AND NOT Stop -> Q0.0
    const r = new Rack([rung(and(or(no('I0.0'), no('Q0.0')), nc('I0.1')), [coil('Q0.0')])]);
    r.inputs('PLCI1', '0', { I0: 'start', I1: 'stop' });
    r.outputs('PLCQ1', '0', { Q0: 'motor' });
    r.button('VSTART', 'start', 0.1, 0.1);
    r.button('VSTOP', 'stop', 0.5, 0.1);
    r.load('RM', 'motor');
    const res = r.run(1);
    expect(at(res, 'V(motor)', 0.05)).toBeLessThan(1);
    // on while the button is pressed, and still on after it is released
    expect(at(res, 'V(motor)', 0.2)).toBeGreaterThan(20);
    expect(at(res, 'V(motor)', 0.4)).toBeGreaterThan(20);
    // the stop button drops it out and it stays out
    expect(at(res, 'V(motor)', 0.6)).toBeLessThan(1);
    expect(at(res, 'V(motor)', 0.9)).toBeLessThan(1);
  });

  it('an on-delay timer switches its coil one preset after the input', () => {
    const r = new Rack(
      [
        rung(no('I0.0'), [{ kind: 'ton', address: 'T1', preset: '0.2' }]),
        rung(no('T1'), [coil('Q0.0')]),
      ],
      0.005,
    );
    r.inputs('PLCI1', '0', { I0: 'run' });
    r.outputs('PLCQ1', '0', { Q0: 'lamp' });
    r.button('VRUN', 'run', 0.1, 0.5);
    r.load('RL', 'lamp');
    const res = r.run(0.8, 0.001);
    expect(at(res, 'V(lamp)', 0.25)).toBeLessThan(1);
    // pressed at 0.1 s, so the coil comes on at 0.3 s (within one scan)
    expect(at(res, 'V(lamp)', 0.295)).toBeLessThan(1);
    expect(at(res, 'V(lamp)', 0.32)).toBeGreaterThan(20);
    // the button is released at 0.6 s: the timer clears and the coil drops out at once
    expect(at(res, 'V(lamp)', 0.65)).toBeLessThan(1);
  });

  it('reads a real input level: below the threshold the rung stays off', () => {
    const r = new Rack([rung(no('I0.0'), [coil('Q0.0')])]);
    r.inputs('PLCI1', '0', { I0: 'in0' });
    r.outputs('PLCQ1', '0', { Q0: 'out0' });
    // 8 V is below the 12 V threshold of the module
    r.part('sources/dc-voltage', 'VIN', { value: '8' }, { '+': 'in0', '-': '0' });
    r.load('R1', 'out0');
    const res = r.run(0.2);
    expect(at(res, 'V(out0)', 0.15)).toBeLessThan(1);
  });

  it('an open switch on an input channel reads off, a closed one reads on', () => {
    const make = (pressed: string) => {
      const r = new Rack([rung(no('I0.0'), [coil('Q0.0')])]);
      r.inputs('PLCI1', '0', { I0: 'in0' });
      r.outputs('PLCQ1', '0', { Q0: 'out0' });
      // the button sits between the 24 V rail and the channel, as in a real cabinet
      r.part('basic/push-button', 'S1', { pressed }, { 1: 'p24', 2: 'in0' });
      r.load('R1', 'out0');
      return r.run(0.2);
    };
    expect(at(make('false'), 'V(out0)', 0.15)).toBeLessThan(1);
    expect(at(make('true'), 'V(out0)', 0.15)).toBeGreaterThan(20);
  });

  it('publishes the live read-outs as vectors', () => {
    const r = new Rack([rung(no('I0.0'), [coil('Q0.0')])]);
    r.inputs('PLCI1', '0', { I0: 'in0' });
    r.outputs('PLCQ1', '0', { Q0: 'out0' });
    r.onSwitch('V1', 'in0');
    r.load('R1', 'out0');
    const build = r.build();
    const el = build.ladder!.element;
    const [res] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 0.005, tstop: 0.1 }], saves: ['all', `Lq0(${el})`, `Lscan(${el})`] });
    expect(res.error).toBeUndefined();
    expect(at(res, `Lq0(${el})`, 0.09)).toBe(1);
    expect(at(res, `Lscan(${el})`, 0.09)).toBeGreaterThan(5);
  });
});

describe('a rack below the top level', () => {
  it('a ladder sheet inside a hierarchical block runs in that block', () => {
    const b = new DesignBuilder('Tủ điều khiển');
    const child = b.child('Tủ', { kind: 'hierarchical' });
    b.ladderSheet([rung(no('I0.0'), [coil('Q0.0')])], 'Ladder 1');
    b.useSheet(0);
    const v = b.part('sources/dc-voltage', 'V24', 0, 0, { value: '24' });
    const gnd = b.part('sources/ground', 'GND1', 0, 300);
    const inp = b.part('misc-digital/plc-input-8', 'PLCI1', 300, 0, { byte: '0' });
    const out = b.part('misc-digital/plc-output-8', 'PLCQ1', 700, 0, { byte: '0' });
    const load = b.part('basic/resistor', 'R1', 1100, 0, { value: '1k' });
    b.connect(v, '+', inp, 'I0');
    b.connect(v, '-', gnd, '1');
    b.connect(inp, 'COM', gnd, '1');
    b.connect(out, 'COM', gnd, '1');
    b.connect(out, 'Q0', load, '1');
    b.connect(load, '2', gnd, '1');
    b.root();
    b.block(child, 'X1', 0, 0);
    b.part('sources/ground', 'GND9', 0, 300);
    const build = buildNetlist(b.design);
    expect(build.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    // the program of the block is an A_LADDER element of the block's subcircuit
    const subckt = Object.values(build.netlist.subckts ?? {})[0];
    expect(subckt).toBeDefined();
    expect(subckt.elements.some((e) => e.type === 'A')).toBe(true);
    expect(JSON.stringify(build.netlist)).toContain('"A_LADDER"');
    // and the whole design still simulates
    const [res] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 0.005, tstop: 0.05 }] });
    expect(res.error).toBeUndefined();
  });
});
