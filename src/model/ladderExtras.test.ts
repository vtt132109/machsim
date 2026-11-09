/**
 * Ladder extras end to end, through the netlist and the transient engine: function blocks run in a
 * saved design, an analog output module drives a real voltage from a word instruction, and an
 * arithmetic result switches a real load.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder, type PartHandle } from './designkit';
import { buildNetlist } from './netlister';
import { parseDesign, serializeDesign } from './serialize';
import { channelAddress } from './ladderBuild';
import { runAnalyses } from '../sim';
import type { AnalysisResult } from '../sim/results';
import type { LadderBlock, LadderNode, LadderOutput, LadderRung } from '../ladder/types';
import { getPart } from '../library';
import type { LibraryPartDef } from '../library/partkit';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const nc = (address: string): LadderNode => ({ kind: 'contact', type: 'nc', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });
const coil = (address: string): LadderOutput => ({ kind: 'coil', address });

let seq = 0;
const rung = (logic: LadderNode | undefined, outputs: LadderOutput[]): LadderRung => {
  seq += 1;
  return logic ? { id: `x${seq}`, logic, outputs } : { id: `x${seq}`, outputs };
};

const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
};

function at(r: AnalysisResult, name: string, t: number): number {
  const time = r.scale!.re;
  const v = vec(r, name).re;
  let k = 0;
  while (k + 1 < time.length && time[k + 1] <= t) k++;
  return v[k];
}

class Bench {
  readonly b = new DesignBuilder('ladder extras');
  private x = 0;

  constructor(rungs: LadderRung[], blocks: LadderBlock[] = []) {
    this.b.ladderSheet(rungs, 'Ladder 1');
    if (blocks.length) this.b.design.ladderBlocks = blocks;
    this.b.useSheet(0);
    this.part('misc-digital/plc-controller', 'PLC1', { scan: '0.01' }, {});
  }

  part(id: string, ref: string, params: Record<string, string>, pins: Record<string, string>): PartHandle {
    const h = this.b.part(id, ref, this.x, 0, params);
    this.x += 400;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }

  build() {
    const build = buildNetlist(this.b.design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error').map((e) => e.message)).toEqual([]);
    return build;
  }

  run(tstop: number): AnalysisResult {
    const build = this.build();
    const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 0.002, tstop }] });
    expect(r.error, r.error).toBeUndefined();
    return r;
  }
}

describe('analog output module', () => {
  it('is a library part with its own addresses', () => {
    const def = getPart('misc-digital/plc-analog-out-2') as LibraryPartDef;
    expect(def.ladderIo?.kind).toBe('analog-output');
    expect(def.ladderIo?.pins).toEqual(['AQ0', 'AQ1']);
    expect(channelAddress(def.ladderIo!, 1, 1)).toBe('AQ2');
  });

  it('drives its pin to the voltage a word instruction wrote, limited to the module range', () => {
    // AQ0 = AI0 x 2 (a gain of two), AQ1 = 25 V written but the range is 10 V
    const rungs = [
      rung(undefined, [{ kind: 'mul', address: 'AQ0', a: 'AI0', b: '2' }, { kind: 'mov', address: 'AQ1', a: '25' }]),
    ];
    const t = new Bench(rungs);
    t.part('misc-digital/plc-analog-in-2', 'PLCA1', { chan: '0' }, { COM: '0', AI0: 'sense' });
    t.part('misc-digital/plc-analog-out-2', 'PLCO1', { chan: '0', vmax: '10' }, { COM: '0', AQ0: 'dac0', AQ1: 'dac1' });
    t.part('sources/dc-voltage', 'VIN', { value: '2.25' }, { '+': 'sense', '-': '0' });
    t.part('basic/resistor', 'R1', { value: '10k' }, { 1: 'dac0', 2: '0' });
    t.part('basic/resistor', 'R2', { value: '10k' }, { 1: 'dac1', 2: '0' });
    const build = t.build();
    const el = build.ladder!.element;
    expect(build.ladder!.ir.ports.map((p) => p.kind)).toEqual(['ai', 'aq', 'aq']);
    expect(build.ladder!.ir.ports[1]).toEqual({ kind: 'aq', index: 0, vmax: 10 });
    const res = t.run(0.2);
    // the output has a 1 ohm output resistance into 10 k: a 2.25 V input becomes 4.5 V (x2)
    expect(at(res, 'V(dac0)', 0.15)).toBeGreaterThan(4.49);
    expect(at(res, 'V(dac0)', 0.15)).toBeLessThan(4.5);
    expect(at(res, 'V(dac1)', 0.15)).toBeGreaterThan(9.99);
    expect(at(res, 'V(dac1)', 0.15)).toBeLessThan(10.0);
    expect(el).toMatch(/plc/i);
  });

  it('can go negative', () => {
    const t = new Bench([rung(undefined, [{ kind: 'mov', address: 'AQ0', a: '-3.5' }])]);
    t.part('misc-digital/plc-analog-out-2', 'PLCO1', { chan: '0' }, { COM: '0', AQ0: 'dac0' });
    t.part('basic/resistor', 'R1', { value: '10k' }, { 1: 'dac0', 2: '0' });
    const res = t.run(0.1);
    expect(at(res, 'V(dac0)', 0.08)).toBeLessThan(-3.49);
    expect(at(res, 'V(dac0)', 0.08)).toBeGreaterThan(-3.5);
  });

  it('publishes the word and analog read-outs as vectors', () => {
    const t = new Bench([rung(undefined, [{ kind: 'mov', address: 'MW3', a: '12' }, { kind: 'mov', address: 'AQ0', a: '1.5' }])]);
    t.part('misc-digital/plc-analog-out-2', 'PLCO1', { chan: '0' }, { COM: '0', AQ0: 'dac0' });
    t.part('basic/resistor', 'R1', { value: '10k' }, { 1: 'dac0', 2: '0' });
    const build = t.build();
    const el = build.ladder!.element;
    const [res] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 0.005, tstop: 0.1 }], saves: ['all', `Lw3(${el})`, `Lo0(${el})`] });
    expect(res.error).toBeUndefined();
    expect(at(res, `Lw3(${el})`, 0.09)).toBe(12);
    expect(at(res, `Lo0(${el})`, 0.09)).toBeCloseTo(1.5, 9);
  });
});

describe('function blocks in a design', () => {
  const startStop: LadderBlock = {
    id: 'blk1',
    name: 'StartStop',
    inputs: ['START', 'STOP'],
    outputs: ['RUN'],
    rungs: [rung(and(or(no('START'), no('RUN')), nc('STOP')), [coil('RUN')])],
  };

  it('a block called twice drives two real outputs; the design saves and reopens', () => {
    const rungs = [
      rung(undefined, [{ kind: 'call', address: 'M1', block: 'StartStop', args: { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' } }]),
      rung(undefined, [{ kind: 'call', address: 'M2', block: 'StartStop', args: { START: 'I0.2', STOP: 'I0.3', RUN: 'Q0.1' } }]),
    ];
    const t = new Bench(rungs, [startStop]);
    t.part('misc-digital/plc-input-8', 'PLCI1', { byte: '0' }, { COM: '0', I0: 'start1', I1: 'stop1', I2: 'start2', I3: 'stop2' });
    t.part('misc-digital/plc-output-8', 'PLCQ1', { byte: '0' }, { COM: '0', Q0: 'run1', Q1: 'run2' });
    // motor 1 is started by a 24 V pulse at 50 ms and stops being pressed afterwards; motor 2 is never started
    t.part('sources/pulse-voltage', 'B1', { v1: '0', v2: '24', delay: '0.05', width: '0.03', period: '1k', rise: '1u', fall: '1u' }, { '+': 'start1', '-': '0' });
    t.part('basic/resistor', 'RS1', { value: '1k' }, { 1: 'stop1', 2: '0' });
    t.part('basic/resistor', 'RS2', { value: '1k' }, { 1: 'start2', 2: '0' });
    t.part('basic/resistor', 'RS3', { value: '1k' }, { 1: 'stop2', 2: '0' });
    t.part('basic/resistor', 'L1', { value: '1k' }, { 1: 'run1', 2: '0' });
    t.part('basic/resistor', 'L2', { value: '1k' }, { 1: 'run2', 2: '0' });
    const res = t.run(0.3);
    expect(at(res, 'V(run1)', 0.04)).toBeLessThan(1);
    // the button was released at 80 ms; the motor holds itself in
    expect(at(res, 'V(run1)', 0.25)).toBeGreaterThan(20);
    expect(at(res, 'V(run2)', 0.25)).toBeLessThan(1);

    // saving and reopening keeps blocks and calls
    const design = t.b.design;
    const back = parseDesign(serializeDesign(design));
    expect(back.ladderBlocks).toEqual(design.ladderBlocks);
    const again = buildNetlist(back, { includeAnalysis: false });
    expect(again.ladder?.errors).toEqual([]);
    expect(again.ladder?.ir.rungs).toHaveLength(4);
  });

  it('a call to a block that does not exist is an ERC error naming the rung', () => {
    const t = new Bench([rung(undefined, [{ kind: 'call', address: 'M1', block: 'Missing', args: {} }])]);
    t.part('misc-digital/plc-output-8', 'PLCQ1', { byte: '0' }, { COM: '0', Q0: 'run1' });
    const build = buildNetlist(t.b.design, { includeAnalysis: false });
    const msg = build.erc.find((m) => m.detail?.id === 'ladderRung');
    expect(msg).toBeDefined();
    expect(msg!.detail!.params).toMatchObject({ rung: 1, code: 'blockUnknown', text: 'Missing' });
  });
});

describe('a design that becomes a block of another', () => {
  it('brings the function blocks its ladder rungs call', async () => {
    const { childFromDesign } = await import('../ui/store/hierarchyOps');
    const { newDesign } = await import('./types');
    const src = new DesignBuilder('source');
    src.ladderSheet([rung(undefined, [{ kind: 'call', address: 'M1', block: 'StartStop', args: {} }])], 'L');
    src.design.ladderBlocks = [{ id: 'blk1', name: 'StartStop', inputs: [], outputs: [], rungs: [] }];
    const target = newDesign('target');
    const r = childFromDesign(target, src.design, 'Sub');
    expect(r.design.ladderBlocks?.map((b) => b.name)).toEqual(['StartStop']);
    // the target's own block of the same name is kept, and the imported DIFFERENT program is added
    // under a free name that the imported call follows (round 4 fix: it used to answer to the target's block)
    const own = { ...target, ladderBlocks: [{ id: 'mine', name: 'startstop', inputs: ['A'], outputs: [], rungs: [] }] };
    const merged = childFromDesign(own, src.design, 'Sub2');
    expect(merged.design.ladderBlocks?.map((b) => b.name)).toEqual(['startstop', 'StartStop_2']);
    expect(merged.design.ladderBlocks?.[0]).toEqual(own.ladderBlocks[0]);
    const child = merged.design.children!.find((c) => c.id === merged.childId)!;
    const calls = child.sheets.flatMap((s) => s.ladder ?? []).flatMap((r) => r.outputs).filter((o) => o.kind === 'call');
    expect(calls.map((o) => o.block)).toEqual(['StartStop_2']);
    expect(merged.notes.some((n) => n.code === 'ladderBlockRenamed')).toBe(true);
    // the same program under the same name is the same block
    const same = { ...target, ladderBlocks: [{ id: 'mine', name: 'startstop', inputs: [], outputs: [], rungs: [] }] };
    expect(childFromDesign(same, src.design, 'Sub3').design.ladderBlocks).toEqual(same.ladderBlocks);
  });
});
