/**
 * The mechatronics parts in the simulator: a machine driven by real circuit levels answers on its
 * sensor pins at the time its own equations predict, its state appears on the report nodes, and a
 * ladder program really controls it (tank filling between the two level switches).
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder, type PartHandle } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import type { AnalysisResult } from '../../sim/results';
import type { LadderNode, LadderOutput, LadderRung } from '../../ladder/types';

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

/** First time a vector rises through `level`. */
function firstRise(r: AnalysisResult, name: string, level: number): number {
  const t = r.scale!.re;
  const v = vec(r, name).re;
  for (let i = 1; i < t.length; i++) if (v[i - 1] < level && v[i] >= level) return t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]);
  return NaN;
}

class Bench {
  readonly b = new DesignBuilder('mecha bench');
  private x = 0;

  part(id: string, ref: string, params: Record<string, string>, pins: Record<string, string> = {}): PartHandle {
    const h = this.b.part(id, ref, this.x, 0, params);
    this.x += 500;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }

  /** Constant 24 V on `net`. */
  on(ref: string, net: string): void {
    this.part('sources/dc-voltage', ref, { value: '24' }, { '+': net, '-': '0' });
  }

  /** 24 V on `net` from `td` for `width` seconds. */
  pulse(ref: string, net: string, td: number, width: number): void {
    this.part('sources/pulse-voltage', ref, { v1: '0', v2: '24', delay: String(td), width: String(width), period: '1k', rise: '1m', fall: '1m' }, { '+': net, '-': '0' });
  }

  /** Load so a sensor pin has a defined node. */
  load(ref: string, net: string, value = '10k'): void {
    this.part('basic/resistor', ref, { value }, { 1: net, 2: '0' });
  }

  run(tstop: number, tstep: number, saves?: string[]): AnalysisResult {
    const build = buildNetlist(this.b.design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error').map((e) => e.message)).toEqual([]);
    const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep, tstop }], ...(saves ? { saves } : {}) });
    expect(r.error, r.error).toBeUndefined();
    return r;
  }

  build() {
    return buildNetlist(this.b.design, { includeAnalysis: false });
  }
}

describe('tank in a circuit', () => {
  it('fills at the pump rate and the switches answer on their pins', () => {
    const k = new Bench();
    k.part('misc/water-tank', 'TK1', { volume: '10', qin: '0.5', qout: '0.35', low: '20', high: '80', start: '0' }, { PUMP: 'pump', LOW: 'low', HIGH: 'high', LEVEL: 'lvl', COM: '0' });
    k.on('VP', 'pump');
    k.load('RL', 'low');
    k.load('RH', 'high');
    k.load('RV', 'lvl');
    const r = k.run(22, 0.05, ['all', 'V(TK1.percent)']);
    // 20 % of 10 L at 0.5 L/s is 4 s, 80 % is 16 s
    expect(firstRise(r, 'V(low)', 12)).toBeCloseTo(4, 1);
    expect(firstRise(r, 'V(high)', 12)).toBeCloseTo(16, 1);
    // the tank is full after 20 s: the level transmitter reads its full scale (10 V) and stays
    expect(at(r, 'V(lvl)', 21)).toBeCloseTo(10, 1);
    // and the report node carries the level in percent
    expect(at(r, 'V(TK1.percent)', 10)).toBeCloseTo(50, 0);
    expect(at(r, 'V(TK1.percent)', 21)).toBeCloseTo(100, 0);
  });

  it('does nothing while the pump pin is below the input threshold', () => {
    const k = new Bench();
    k.part('misc/water-tank', 'TK1', { volume: '10', qin: '0.5', start: '0' }, { PUMP: 'pump', LOW: 'low', COM: '0' });
    k.part('sources/dc-voltage', 'VP', { value: '6' }, { '+': 'pump', '-': '0' });
    k.load('RL', 'low');
    const r = k.run(10, 0.1, ['all', 'V(TK1.percent)']);
    expect(at(r, 'V(TK1.percent)', 9)).toBeCloseTo(0, 6);
    expect(at(r, 'V(low)', 9)).toBeLessThan(1);
  });
});

describe('conveyor in a circuit', () => {
  it('carries an item to the first sensor at the belt speed', () => {
    const k = new Bench();
    k.part('misc/conveyor-belt', 'MB1', { length: '2', speed: '0.5', s1: '0.5', s2: '1.5', window: '0.1', feed: '1', tfeed: '1' }, { RUN: 'run', S1: 's1', S2: 's2', COM: '0' });
    k.on('VR', 'run');
    k.load('R1', 's1');
    k.load('R2', 's2');
    const r = k.run(8, 0.02);
    // the first item is fed at t = 0 and the sensor window opens 0.05 m early: (0.5-0.05)/0.5 = 0.9 s
    expect(firstRise(r, 'V(s1)', 12)).toBeCloseTo(0.9, 1);
    expect(firstRise(r, 'V(s2)', 12)).toBeCloseTo(2.9, 1);
  });

  it('stands still while the motor pin is off', () => {
    const k = new Bench();
    k.part('misc/conveyor-belt', 'MB1', { speed: '0.5', feed: '1', tfeed: '0.5' }, { S1: 's1', COM: '0' });
    k.load('R1', 's1');
    const r = k.run(5, 0.05, ['all', 'V(MB1.travel)']);
    expect(at(r, 'V(MB1.travel)', 4.5)).toBe(0);
    expect(at(r, 'V(s1)', 4.5)).toBeLessThan(1);
  });
});

describe('junction in a circuit', () => {
  it('raises its alarm pin when both directions are green', () => {
    const k = new Bench();
    k.part('misc/traffic-junction', 'MJ1', { tfault: '0.3' }, { NSG: 'nsg', EWG: 'ewg', NSR: 'nsr', EWR: 'ewr', ERR: 'err', COM: '0' });
    // north-south green with east-west red is correct; the east-west green comes on at 1 s
    k.on('V1', 'nsg');
    k.on('V2', 'ewr');
    k.pulse('V3', 'ewg', 1, 2);
    k.load('RE', 'err');
    k.load('R1', 'nsr');
    const r = k.run(3, 0.02);
    expect(at(r, 'V(err)', 0.9)).toBeLessThan(1);
    expect(firstRise(r, 'V(err)', 12)).toBeCloseTo(1.3, 1);
  });
});

describe('door in a circuit', () => {
  it('reaches its limit switch after the travel time and reverses on an obstacle', () => {
    const k = new Bench();
    k.part('misc/garage-door', 'MD1', { ttravel: '4', start: '0' }, { UP: 'up', OPEN: 'open', CLOSED: 'closed', BEAM: 'beam', COM: '0' });
    // the motor is switched on at 0.5 s, so the door stands closed until then
    k.pulse('VU', 'up', 0.5, 6);
    k.load('R1', 'open');
    k.load('R2', 'closed');
    k.load('R3', 'beam');
    const r = k.run(7, 0.02, ['all', 'V(MD1.pos)']);
    expect(at(r, 'V(closed)', 0.3)).toBeGreaterThan(12);
    expect(firstRise(r, 'V(open)', 12)).toBeCloseTo(4.5, 1);
    expect(at(r, 'V(MD1.pos)', 2.5)).toBeCloseTo(50, 0);
    expect(at(r, 'V(beam)', 5)).toBeGreaterThan(12);
  });
});

describe('lift in a circuit', () => {
  it('stays put while the door is open and then travels floor by floor', () => {
    const k = new Bench();
    k.part('misc/lift-3', 'ML1', { tfloor: '2', tdoor: '1', window: '0.04', start: '1' }, { UP: 'up', DOOR: 'door', F1: 'f1', F2: 'f2', F3: 'f3', DOPEN: 'dopen', COM: '0' });
    k.on('VU', 'up');
    k.pulse('VD', 'door', 0, 2);
    k.load('R1', 'f1');
    k.load('R2', 'f2');
    k.load('R3', 'f3');
    k.load('R4', 'dopen');
    const r = k.run(10, 0.02, ['all', 'V(ML1.floor)']);
    // the door is open for the first 2 s, so the car cannot leave floor 1
    expect(at(r, 'V(f1)', 1.9)).toBeGreaterThan(12);
    expect(at(r, 'V(ML1.floor)', 1.9)).toBeCloseTo(1, 2);
    // the door closes in 1 s (from 2 s to 3 s), then the car needs 2 s per floor
    expect(firstRise(r, 'V(f2)', 12)).toBeCloseTo(4.9, 1);
    expect(firstRise(r, 'V(f3)', 12)).toBeCloseTo(6.9, 1);
  });
});

describe('a ladder program controlling a machine', () => {
  it('keeps the tank between its two level switches', () => {
    // Rung 1: (not HIGH) and (NOT LOW or already pumping) -> pump
    //   start pumping when the level falls below the low switch, stop at the high switch
    const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
    const nc = (address: string): LadderNode => ({ kind: 'contact', type: 'nc', address });
    const coil = (address: string): LadderOutput => ({ kind: 'coil', address });
    const rungs: LadderRung[] = [
      {
        id: 'r1',
        comment: 'bơm chạy cho tới khi đầy, chỉ khởi động lại khi cạn dưới mức thấp',
        logic: { kind: 'series', items: [nc('I0.1'), { kind: 'parallel', items: [nc('I0.0'), no('Q0.0')] }] },
        outputs: [coil('Q0.0')],
      },
    ];
    const k = new Bench();
    k.b.ladderSheet(rungs, 'Ladder 1');
    k.b.useSheet(0);
    k.part('misc-digital/plc-controller', 'PLC1', { scan: '0.02' });
    k.part('misc-digital/plc-input-8', 'PLCI1', { byte: '0' }, { I0: 'low', I1: 'high', COM: '0' });
    k.part('misc-digital/plc-output-8', 'PLCQ1', { byte: '0' }, { Q0: 'pump', COM: '0' });
    // the tank starts full and the valve is always open, so it drains until the pump comes on
    k.part('misc/water-tank', 'TK1', { volume: '10', qin: '1', qout: '0.5', low: '20', high: '80', start: '100' }, { PUMP: 'pump', VALVE: 'drain', LOW: 'low', HIGH: 'high', COM: '0' });
    k.on('VV', 'drain');
    const r = k.run(60, 0.1, ['all', 'V(TK1.percent)']);
    // it starts full, so the pump is off; the valve drains it towards the low switch
    expect(at(r, 'V(pump)', 1)).toBeLessThan(1);
    expect(at(r, 'V(TK1.percent)', 1)).toBeGreaterThan(90);
    // the level never leaves the band by much (the pump reacts within one scan)
    const level = vec(r, 'V(TK1.percent)').re;
    const time = r.scale!.re;
    let min = 100;
    let max = 0;
    for (let i = 0; i < time.length; i++) {
      if (time[i] < 20) continue;
      min = Math.min(min, level[i]);
      max = Math.max(max, level[i]);
    }
    expect(min).toBeGreaterThan(15);
    expect(max).toBeLessThan(85);
    // and the pump really switched on and off again
    const pump = vec(r, 'V(pump)').re;
    let edges = 0;
    for (let i = 1; i < pump.length; i++) if (pump[i - 1] < 12 && pump[i] >= 12) edges++;
    expect(edges).toBeGreaterThanOrEqual(1);
  });
});
