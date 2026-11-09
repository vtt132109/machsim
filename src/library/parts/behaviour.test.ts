/**
 * Behavioural checks of catalogue parts through the real netlister and simulation engine.
 * Circuits are wired with net labels on the pins ("0" = ground).
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist, type NetlistBuildEx } from '../../model/netlister';
import { elementValueChanges } from '../../model/interactive';
import { createTransientStepper, findVector, runAnalyses } from '../../sim';
import type { AnalysisSpec } from '../../sim/netlist';

class Circuit {
  readonly b = new DesignBuilder('behaviour');
  private x = 0;

  add(partId: string, refdes: string, pins: Record<string, string>, params: Record<string, string> = {}) {
    const h = this.b.part(partId, refdes, this.x, 0, params);
    this.x += 400;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }

  build(): NetlistBuildEx {
    const r = buildNetlist(this.b.design);
    expect(r.erc.filter((m) => m.severity === 'error')).toEqual([]);
    return r;
  }

  op(): Record<string, number> {
    const [r] = runAnalyses({ ...this.build().netlist, analyses: [{ type: 'op' }] });
    expect(r.error).toBeUndefined();
    return r.scalars ?? {};
  }

  tran(spec: Omit<Extract<AnalysisSpec, { type: 'tran' }>, 'type'>, names: string[]): { t: Float64Array; v: Record<string, Float64Array> } {
    const [r] = runAnalyses({ ...this.build().netlist, analyses: [{ type: 'tran', ...spec }] });
    expect(r.error).toBeUndefined();
    const v: Record<string, Float64Array> = {};
    for (const n of names) {
      const vec = findVector(r, n);
      expect(vec, n).toBeDefined();
      v[n] = vec!.re;
    }
    return { t: r.scale!.re, v };
  }
}

function risingCrossings(t: Float64Array, y: Float64Array, level: number, after = 0): number[] {
  const out: number[] = [];
  for (let i = 1; i < y.length; i++) {
    if (t[i] < after) continue;
    if (y[i - 1] < level && y[i] >= level) out.push(t[i - 1] + ((level - y[i - 1]) / (y[i] - y[i - 1])) * (t[i] - t[i - 1]));
  }
  return out;
}

const max = (a: Float64Array, from = 0) => Math.max(...Array.from(a).slice(from));

describe('passives and switches', () => {
  it('potentiometer divides by its setting', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'TOP', '-': '0' }, { value: '10' });
    c.add('basic/potentiometer', 'R1', { '1': 'TOP', '2': '0', W: 'W' }, { percent: '25' });
    expect(c.op()['V(W)']).toBeCloseTo(7.5, 6);
  });

  it('SPST switch toggles in a running transient via setParam on the contact resistor', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '5' });
    const sw = c.add('basic/switch-spst', 'S1', { '1': 'IN', '2': 'OUT' });
    c.add('basic/resistor', 'R1', { '1': 'OUT', '2': '0' }, { value: '1k' });
    const before = c.build().netlist;
    const stepper = createTransientStepper(before, { tstep: 1e-4 });
    stepper.advance(1e-3);
    expect(stepper.latest()['V(OUT)']).toBeLessThan(1e-3);
    sw.inst.params.closed = 'true';
    const after = c.build().netlist;
    const changes = elementValueChanges(before, after);
    expect(changes).toEqual([{ element: 'R_S1', param: 'value', value: 1e-3 }]);
    for (const ch of changes!) stepper.setParam(ch.element, ch.param, ch.value);
    stepper.advance(2e-3);
    expect(stepper.latest()['V(OUT)']).toBeCloseTo(5, 3);
  });

  it('transformer steps a 10 V peak sine down 10:1', () => {
    const c = new Circuit();
    c.add('sources/ac-voltage', 'V1', { '+': 'P', '-': '0' }, { amplitude: '10', freq: '1k' });
    c.add('basic/transformer', 'T1', { P1: 'P', P2: '0', S1: 'S', S2: '0' }, { turns: '10' });
    c.add('basic/resistor', 'R1', { '1': 'S', '2': '0' }, { value: '1k' });
    const { v } = c.tran({ tstep: 1e-5, tstop: 3e-3 }, ['V(S)']);
    expect(max(v['V(S)'])).toBeGreaterThan(0.95);
    expect(max(v['V(S)'])).toBeLessThan(1.02);
  });

  it('relay closes its NO contact above the pull-in current', () => {
    const run = (vcoil: string) => {
      const c = new Circuit();
      c.add('sources/dc-voltage', 'V1', { '+': 'COIL', '-': '0' }, { value: vcoil });
      c.add('sources/dc-voltage', 'V2', { '+': 'SUP', '-': '0' }, { value: '5' });
      c.add('electromechanical/relay-spdt', 'K1', { C1: 'COIL', C2: '0', COM: 'SUP', NO: 'NO', NC: 'NC' });
      c.add('basic/resistor', 'R1', { '1': 'NO', '2': '0' }, { value: '1k' });
      c.add('basic/resistor', 'R2', { '1': 'NC', '2': '0' }, { value: '1k' });
      return c.op();
    };
    const on = run('12');
    expect(on['V(NO)']).toBeCloseTo(5, 2);
    expect(on['V(NC)']).toBeLessThan(0.01);
    const off = run('0');
    expect(off['V(NO)']).toBeLessThan(0.01);
    expect(off['V(NC)']).toBeCloseTo(5, 2);
  });

  it('fuse opens above its rating and conducts below it', () => {
    const run = (load: string) => {
      const c = new Circuit();
      c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '5' });
      c.add('power/fuse', 'F1', { '1': 'IN', '2': 'OUT' }, { rating: '1' });
      c.add('basic/resistor', 'R1', { '1': 'OUT', '2': '0' }, { value: load });
      return c.op()['V(OUT)'];
    };
    expect(run('10')).toBeCloseTo(5, 2);
    expect(run('1')).toBeLessThan(0.01);
  });
});

describe('semiconductors', () => {
  it('red LED draws ≈ 20 mA from 5 V through 150 Ω and drops ≈ 1.9 V', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '5' });
    c.add('basic/resistor', 'R1', { '1': 'IN', '2': 'A' }, { value: '150' });
    c.add('diodes/led-red', 'LED1', { A: 'A', K: '0' });
    const s = c.op();
    expect(s['I(V_LED1_i)']).toBeGreaterThan(19.5e-3);
    expect(s['I(V_LED1_i)']).toBeLessThan(21e-3);
    expect(s['V(A)']).toBeGreaterThan(1.85);
    expect(s['V(A)']).toBeLessThan(1.95);
  });

  it('1N4733A regulates near 5.1 V', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '12' });
    c.add('basic/resistor', 'R1', { '1': 'IN', '2': 'Z' }, { value: '470' });
    c.add('diodes/1n4733a', 'D1', { A: '0', K: 'Z' });
    const v = c.op()['V(Z)'];
    expect(v).toBeGreaterThan(4.8);
    expect(v).toBeLessThan(5.1);
  });

  it('bridge rectifier delivers the sine peak minus two diode drops', () => {
    const c = new Circuit();
    c.add('sources/ac-voltage', 'V1', { '+': 'AC1', '-': 'AC2' }, { amplitude: '10', freq: '50' });
    c.add('diodes/bridge-rectifier', 'D1', { AC1: 'AC1', AC2: 'AC2', '+': 'P', '-': '0' });
    c.add('basic/resistor', 'R1', { '1': 'P', '2': '0' }, { value: '1k' });
    c.add('basic/resistor', 'R2', { '1': 'AC2', '2': '0' }, { value: '1meg' });
    const { v } = c.tran({ tstep: 1e-4, tstop: 40e-3 }, ['V(P)']);
    const peak = max(v['V(P)']);
    expect(peak).toBeGreaterThan(8.4);
    expect(peak).toBeLessThan(8.9);
    expect(Math.min(...v['V(P)'])).toBeGreaterThan(-0.05);
  });

  it('2N3904 is biased in the active region with a realistic beta', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'VCC', '-': '0' }, { value: '10' });
    c.add('basic/resistor', 'RB', { '1': 'VCC', '2': 'B' }, { value: '470k' });
    c.add('basic/resistor', 'RC', { '1': 'VCC', '2': 'C' }, { value: '1k' });
    c.add('transistors/2n3904', 'Q1', { C: 'C', B: 'B', E: '0' });
    const s = c.op();
    const ib = (10 - s['V(B)']) / 470e3;
    const ic = (10 - s['V(C)']) / 1e3;
    expect(s['V(B)']).toBeGreaterThan(0.55);
    expect(s['V(B)']).toBeLessThan(0.75);
    expect(ic / ib).toBeGreaterThan(150);
    expect(ic / ib).toBeLessThan(450);
    expect(s['V(C)']).toBeGreaterThan(0.3);
  });

  it('2N7000 switches on with RDS(on) close to the datasheet value', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'G', '-': '0' }, { value: '10' });
    c.add('sources/dc-voltage', 'V2', { '+': 'SUP', '-': '0' }, { value: '5' });
    c.add('basic/resistor', 'RL', { '1': 'SUP', '2': 'D' }, { value: '10' });
    c.add('transistors/2n7000', 'Q1', { D: 'D', G: 'G', S: '0' });
    const s = c.op();
    const id = (5 - s['V(D)']) / 10;
    const rds = s['V(D)'] / id;
    expect(rds).toBeGreaterThan(1.1);
    expect(rds).toBeLessThan(1.4);
  });

  it('optocoupler output current follows CTR · IF', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '5' });
    c.add('basic/resistor', 'R1', { '1': 'IN', '2': 'A' }, { value: '380' });
    c.add('misc/4n25', 'U1', { A: 'A', K: '0', C: 'C', E: '0' });
    c.add('basic/resistor', 'RL', { '1': 'IN', '2': 'C' }, { value: '100' });
    const s = c.op();
    const iF = s['I(V_U1_led)'];
    const iC = (5 - s['V(C)']) / 100;
    expect(iF).toBeGreaterThan(8e-3);
    expect(iC / iF).toBeGreaterThan(0.45);
    expect(iC / iF).toBeLessThan(0.55);
  });
});

describe('analog ICs', () => {
  it('LM741 inverting amplifier with gain -10', () => {
    const c = new Circuit();
    c.add('sources/vcc', 'VCC1', { '1': 'VCC' }, { voltage: '15' });
    c.add('sources/vee', 'VEE1', { '1': 'VEE' }, { voltage: '-15' });
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '0.5' });
    c.add('basic/resistor', 'R1', { '1': 'IN', '2': 'INV' }, { value: '1k' });
    c.add('basic/resistor', 'R2', { '1': 'INV', '2': 'OUT' }, { value: '10k' });
    c.add('analog/lm741', 'U1', { 'IN+': '0', 'IN-': 'INV', OUT: 'OUT', 'V+': 'VCC', 'V-': 'VEE' });
    const s = c.op();
    expect(Math.abs(s['V(OUT)'] + 5)).toBeLessThan(0.02);
    // the output current (0.5 mA into the feedback network) is drawn from the negative rail
    expect(s['I(V_PWR_VEE)']).toBeGreaterThan(0);
  });

  it('macromodel op-amp saturates at its output headroom', () => {
    const c = new Circuit();
    c.add('sources/vcc', 'VCC1', { '1': 'VCC' }, { voltage: '15' });
    c.add('sources/vee', 'VEE1', { '1': 'VEE' }, { voltage: '-15' });
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '1' });
    c.add('analog/opamp', 'U1', { 'IN+': 'IN', 'IN-': '0', OUT: 'OUT', 'V+': 'VCC', 'V-': 'VEE' }, { vsatp: '1.5' });
    c.add('basic/resistor', 'RL', { '1': 'OUT', '2': '0' }, { value: '10k' });
    // 15 V - 1.5 V headroom, divided by ROUT = 50 Ω into the 10 kΩ load
    expect(c.op()['V(OUT)']).toBeCloseTo((13.5 * 10e3) / (10e3 + 50), 3);
  });

  it('macromodel op-amp follower slews at the specified rate', () => {
    const c = new Circuit();
    c.add('sources/vcc', 'VCC1', { '1': 'VCC' }, { voltage: '15' });
    c.add('sources/vee', 'VEE1', { '1': 'VEE' }, { voltage: '-15' });
    c.add('sources/pulse-voltage', 'V1', { '+': 'IN', '-': '0' }, { v1: '0', v2: '5', delay: '10u', rise: '10n', fall: '10n', width: '1', period: '2' });
    c.add('analog/lm741', 'U1', { 'IN+': 'IN', 'IN-': 'OUT', OUT: 'OUT', 'V+': 'VCC', 'V-': 'VEE' });
    const { t, v } = c.tran({ tstep: 0.1e-6, tstop: 30e-6 }, ['V(OUT)']);
    const at = (time: number) => {
      const i = t.findIndex((x) => x >= time);
      return v['V(OUT)'][i];
    };
    // 0.5 V/µs: 2 V after 4 µs of slewing (from 1 V to 3 V between 12 µs and 16 µs)
    const slope = (at(16e-6) - at(12e-6)) / 4e-6;
    expect(slope).toBeGreaterThan(0.45e6);
    expect(slope).toBeLessThan(0.55e6);
    expect(at(29e-6)).toBeCloseTo(5, 1);
  });

  it('ideal 3-terminal op-amp: non-inverting gain of 2 and output limit', () => {
    const c = new Circuit();
    const v = c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '1' });
    c.add('basic/resistor', 'R1', { '1': 'INV', '2': '0' }, { value: '1k' });
    c.add('basic/resistor', 'R2', { '1': 'INV', '2': 'OUT' }, { value: '1k' });
    c.add('analog/opamp-ideal-3', 'U1', { 'IN+': 'IN', 'IN-': 'INV', OUT: 'OUT' });
    expect(c.op()['V(OUT)']).toBeCloseTo(2, 4);
    v.inst.params.value = '10';
    expect(c.op()['V(OUT)']).toBeCloseTo(15, 6);
  });

  it('LM393 open-collector output with a pull-up', () => {
    const run = (vp: string, vn: string) => {
      const c = new Circuit();
      c.add('sources/vcc', 'VCC1', { '1': 'VCC' }, { voltage: '5' });
      c.add('sources/dc-voltage', 'V1', { '+': 'P', '-': '0' }, { value: vp });
      c.add('sources/dc-voltage', 'V2', { '+': 'N', '-': '0' }, { value: vn });
      c.add('analog/lm393', 'U1', { 'IN+': 'P', 'IN-': 'N', OUT: 'OUT', 'V+': 'VCC', 'V-': '0' });
      c.add('basic/resistor', 'RP', { '1': 'VCC', '2': 'OUT' }, { value: '10k' });
      return c.op()['V(OUT)'];
    };
    expect(run('2', '1')).toBeGreaterThan(4.99);
    expect(run('1', '2')).toBeLessThan(0.05);
  });

  it('instrumentation amplifier amplifies the difference around REF', () => {
    const c = new Circuit();
    c.add('sources/vcc', 'VCC1', { '1': 'VCC' }, { voltage: '15' });
    c.add('sources/vee', 'VEE1', { '1': 'VEE' }, { voltage: '-15' });
    c.add('sources/dc-voltage', 'V1', { '+': 'P', '-': '0' }, { value: '1.1' });
    c.add('sources/dc-voltage', 'V2', { '+': 'N', '-': '0' }, { value: '1.0' });
    c.add('sources/dc-voltage', 'V3', { '+': 'REF', '-': '0' }, { value: '2' });
    c.add('analog/instrumentation-amplifier', 'U1', { 'IN+': 'P', 'IN-': 'N', OUT: 'OUT', 'V+': 'VCC', 'V-': 'VEE', REF: 'REF' }, { gain: '10' });
    expect(c.op()['V(OUT)']).toBeCloseTo(3, 3);
  });

  it('TL431 shunt reference holds 2.495 V', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '5' });
    c.add('basic/resistor', 'R1', { '1': 'IN', '2': 'K' }, { value: '1k' });
    c.add('analog/tl431', 'U1', { K: 'K', A: '0', REF: 'K' });
    expect(c.op()['V(K)']).toBeCloseTo(2.495, 2);
  });

  it('555 timer oscillates at 1.44 / ((RA + 2 RB) C) in astable mode', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'VCC', '-': '0' }, { value: '5' });
    c.add('basic/resistor', 'RA', { '1': 'VCC', '2': 'DIS' }, { value: '1k' });
    c.add('basic/resistor', 'RB', { '1': 'DIS', '2': 'TH' }, { value: '10k' });
    c.add('basic/capacitor', 'C1', { '1': 'TH', '2': '0' }, { value: '10n' });
    c.add('analog/555', 'U1', { VCC: 'VCC', GND: '0', TRIG: 'TH', THR: 'TH', DIS: 'DIS', OUT: 'OUT', RST: 'VCC' });
    c.add('basic/resistor', 'RL', { '1': 'OUT', '2': '0' }, { value: '10k' });
    const { t, v } = c.tran({ tstep: 0.5e-6, tstop: 1.5e-3 }, ['V(OUT)', 'V(TH)']);
    const edges = risingCrossings(t, v['V(OUT)'], 1.65, 0.2e-3);
    expect(edges.length).toBeGreaterThanOrEqual(6);
    const period = (edges[edges.length - 1] - edges[0]) / (edges.length - 1);
    const expected = (Math.LN2 * (1e3 + 2 * 10e3) * 10e-9);
    expect(Math.abs(period / expected - 1)).toBeLessThan(0.05);
    expect(max(v['V(OUT)'], 10)).toBeGreaterThan(3.2);
    // the timing capacitor swings between 1/3 and 2/3 of VCC
    const th = Array.from(v['V(TH)']).filter((_, i) => t[i] > 0.3e-3);
    expect(Math.max(...th)).toBeCloseTo(10 / 3, 1);
    expect(Math.min(...th)).toBeCloseTo(5 / 3, 1);
  });
});

describe('regulators', () => {
  const fixed = (part: string, vin: string, load: string) => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: vin });
    c.add(part, 'U1', { IN: 'IN', GND: '0', OUT: 'OUT' });
    c.add('basic/resistor', 'RL', { '1': 'OUT', '2': '0' }, { value: load });
    return c.op();
  };

  it('7805 regulates, drops out and current-limits', () => {
    const s = fixed('power/7805', '9', '100');
    expect(s['V(OUT)']).toBeCloseTo(5, 2);
    expect(-s['I(V1)']).toBeCloseTo(0.05 + 5e-3, 3);
    expect(fixed('power/7805', '6', '100')['V(OUT)']).toBeCloseTo(4, 1);
    const limited = fixed('power/7805', '9', '1')['V(OUT)'];
    expect(limited).toBeGreaterThan(1.4);
    expect(limited).toBeLessThan(1.6);
  });

  it('7905 regulates a negative rail', () => {
    expect(fixed('power/7905', '-9', '100')['V(OUT)']).toBeCloseTo(-5, 2);
  });

  it('LM317 output follows 1.25 V (1 + R2/R1) + IADJ R2', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '12' });
    c.add('power/lm317', 'U1', { IN: 'IN', ADJ: 'ADJ', OUT: 'OUT' });
    c.add('basic/resistor', 'R1', { '1': 'OUT', '2': 'ADJ' }, { value: '240' });
    c.add('basic/resistor', 'R2', { '1': 'ADJ', '2': '0' }, { value: '720' });
    expect(c.op()['V(OUT)']).toBeCloseTo(1.25 * 4 + 50e-6 * 720, 2);
  });
});

describe('electromechanical and control blocks', () => {
  it('DC motor reaches ω = Kt·V / (Ra·B + Kt²)', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '6' });
    c.add('electromechanical/dc-motor', 'M1', { '+': 'IN', '-': '0' });
    const build = c.build();
    expect(build.indicators[0]).toMatchObject({ kind: 'motor', signal: { kind: 'voltage', pos: 'M1.w', neg: '0' } });
    const s = c.op();
    expect(s['V(M1.w)']).toBeCloseTo(500, 3);
    expect(-s['I(V1)']).toBeCloseTo(0.5, 6);
  });

  it('integrator block ramps at k·Vin', () => {
    const c = new Circuit();
    c.add('sources/dc-voltage', 'V1', { '+': 'IN', '-': '0' }, { value: '1' });
    c.add('analog/integrator', 'A1', { IN: 'IN', OUT: 'OUT' }, { k: '1000' });
    c.add('basic/resistor', 'RL', { '1': 'OUT', '2': '0' }, { value: '1k' });
    const { t, v } = c.tran({ tstep: 1e-5, tstop: 1e-3, uic: true }, ['V(OUT)']);
    expect(v['V(OUT)'][v['V(OUT)'].length - 1]).toBeCloseTo(1000 * t[t.length - 1], 2);
  });
});
