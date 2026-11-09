/**
 * One sample per catalogue family reproduces a key datasheet number in a small circuit, through
 * the real netlister and engine (tolerances reflect the fit, see each module's header).
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import type { AnalysisSpec } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { microstrip, spiralInductance } from './rf';
import { loadAllGroups } from '../index';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

type B = DesignBuilder;
type H = ReturnType<B['part']>;

/** Build a circuit (ground net '0' available through labels) and run analyses. */
function run(build: (b: B) => void, specs: AnalysisSpec[]): AnalysisResult[] {
  const b = new DesignBuilder('datasheet');
  build(b);
  const nb = buildNetlist(b.design, { includeAnalysis: false });
  const errs = nb.erc.filter((m) => m.severity === 'error');
  expect(errs.map((e) => e.message)).toEqual([]);
  const res = runAnalyses({ ...nb.netlist, analyses: specs });
  for (const r of res) expect(r.error).toBeUndefined();
  return res;
}

const v = (r: AnalysisResult, name: string): Float64Array => {
  const x = r.vectors.find((y) => y.name.toLowerCase() === name.toLowerCase());
  if (!x) throw new Error(`no vector ${name} in ${r.vectors.map((y) => y.name).join(', ')}`);
  return x.re;
};
const last = (a: Float64Array) => a[a.length - 1];

/** DC voltage source between net `pos` and ground. */
function vsrc(b: B, ref: string, pos: string, value: string, x = -400): H {
  const s = b.part('sources/dc-voltage', ref, x, 0, { value });
  b.labelPin(s, '+', pos);
  b.labelPin(s, '-', '0');
  return s;
}
/** DC current source pushing `value` into net `into` (returning from ground). */
function isrc(b: B, ref: string, into: string, value: string, x = -300): H {
  const s = b.part('sources/dc-current', ref, x, 0, { value });
  b.labelPin(s, '+', into);
  b.labelPin(s, '-', '0');
  return s;
}
function res(b: B, ref: string, a: string, c: string, value: string, x = 0): H {
  const r = b.part('basic/resistor', ref, x, 300, { value });
  b.labelPin(r, '1', a);
  b.labelPin(r, '2', c);
  return r;
}
function place(b: B, id: string, ref: string, pins: Record<string, string>, params: Record<string, string> = {}): H {
  const h = b.part(id, ref, 0, 0, params);
  for (const [p, net] of Object.entries(pins)) b.labelPin(h, p, net);
  return h;
}
const OP: AnalysisSpec = { type: 'op' };

describe('diodes', () => {
  it('Zener 1N4733A: VZ = 5.1 V at IZT = 49 mA; BZX79C12: 12 V at 5 mA', () => {
    const [a] = run((b) => {
      isrc(b, 'I1', 'K', '49m');
      place(b, 'diodes/1n4733a', 'D1', { A: '0', K: 'K' });
    }, [OP]);
    expect(v(a, 'V(K)')[0]).toBeCloseTo(5.1, 2);
    const [c] = run((b) => {
      isrc(b, 'I1', 'K', '5m');
      place(b, 'diodes/bzx79c12', 'D1', { A: '0', K: 'K' });
    }, [OP]);
    expect(v(c, 'V(K)')[0]).toBeCloseTo(12, 2);
  });

  it('rectifiers: 1N5408 VF ≈ 0.95 V at 3 A, UF4007 ≈ 1.4 V at 1 A; Schottky SS34 ≈ 0.5 V at 3 A, BAT43 0.33 V at 2 mA', () => {
    for (const [id, i, vf] of [
      ['diodes/1n5408', '3', 0.95],
      ['diodes/uf4007', '1', 1.4],
      ['diodes/ss34', '3', 0.5],
      ['diodes/bat43', '2m', 0.33],
    ] as const) {
      const [a] = run((b) => {
        isrc(b, 'I1', 'A', i);
        place(b, id, 'D1', { A: 'A', K: '0' });
      }, [OP]);
      expect(v(a, 'V(A)')[0], id).toBeGreaterThan(vf * 0.97);
      expect(v(a, 'V(A)')[0], id).toBeLessThan(vf * 1.03);
    }
  });

  it('LEDs: blue 5 mm 3.1 V at 20 mA, white 1 W 3.5 V at 350 mA', () => {
    for (const [id, i, vf] of [
      ['diodes/led-blue-5mm', '20m', 3.1],
      ['diodes/led-white-1w', '350m', 3.5],
    ] as const) {
      const [a] = run((b) => {
        isrc(b, 'I1', 'A', i);
        place(b, id, 'D1', { A: 'A', K: '0' });
      }, [OP]);
      expect(v(a, 'V(A)')[0], id).toBeCloseTo(vf, 1);
    }
  });

  it('TVS: P6KE15A breaks down at 15 V (1 mA); P6KE15CA clamps both polarities', () => {
    const [a] = run((b) => {
      isrc(b, 'I1', 'K', '1m');
      place(b, 'diodes/p6ke15a', 'D1', { A: '0', K: 'K' });
    }, [OP]);
    expect(v(a, 'V(K)')[0]).toBeCloseTo(15, 1);
    for (const sign of [1, -1]) {
      const [c] = run((b) => {
        isrc(b, 'I1', 'K', sign > 0 ? '1m' : '-1m');
        place(b, 'diodes/p6ke15ca', 'D1', { A: '0', K: 'K' });
      }, [OP]);
      expect(Math.abs(v(c, 'V(K)')[0])).toBeGreaterThan(14.3);
      expect(Math.abs(v(c, 'V(K)')[0])).toBeLessThan(15.7);
    }
  });

  it('bridge KBPC1010 rectifies with two diode drops', () => {
    const [a] = run((b) => {
      vsrc(b, 'V1', 'AC1', '10');
      place(b, 'diodes/kbpc1010', 'D1', { AC1: 'AC1', AC2: '0', '+': 'P', '-': 'N' });
      res(b, 'RL', 'P', 'N', '10');
    }, [OP]);
    const vout = v(a, 'V(P)')[0] - v(a, 'V(N)')[0];
    expect(vout).toBeGreaterThan(8.2);
    expect(vout).toBeLessThan(9);
  });
});

describe('thyristors', () => {
  it('SCR BT151 latches on with gate current and stays on without it', () => {
    const spec: AnalysisSpec = { type: 'tran', tstep: 10e-6, tstop: 4e-3 };
    const [tr] = run((b) => {
      vsrc(b, 'V1', 'S', '12');
      res(b, 'RL', 'S', 'A', '100');
      place(b, 'diodes/bt151-500r', 'X1', { A: 'A', K: '0', G: 'G' });
      const g = b.part('sources/pulse-current', 'IG', -200, 0, { v1: '0', v2: '5m', delay: '1m', rise: '1u', fall: '1u', width: '1m', period: '10' });
      b.labelPin(g, '+', 'G');
      b.labelPin(g, '-', '0');
    }, [spec]);
    const t = tr.scale!.re;
    const va = v(tr, 'V(A)');
    const at = (x: number) => va[t.findIndex((y) => y >= x)];
    expect(at(0.5e-3)).toBeGreaterThan(11.9);
    expect(at(1.5e-3)).toBeLessThan(2);
    expect(at(3.5e-3)).toBeLessThan(2);
  });

  it('TRIAC BT136 conducts in both directions when triggered by either gate polarity', () => {
    for (const s of [1, -1]) {
      const [op] = run((b) => {
        vsrc(b, 'V1', 'S', String(12 * s));
        res(b, 'RL', 'S', 'T', '100');
        place(b, 'diodes/bt136-600', 'X1', { MT2: 'T', MT1: '0', G: 'G' });
        isrc(b, 'IG', 'G', String(0.02 * s));
      }, [OP]);
      expect(Math.abs(v(op, 'V(T)')[0])).toBeLessThan(2.5);
    }
  });

  it('DIAC DB3 breaks over near 32 V', () => {
    const [tr] = run((b) => {
      const r = b.part('sources/pwl-voltage', 'V1', -200, 0, { points: '0 0, 2m 40' });
      b.labelPin(r, '+', 'S');
      b.labelPin(r, '-', '0');
      res(b, 'R1', 'S', 'A', '1k');
      place(b, 'diodes/db3', 'X1', { A1: 'A', A2: '0' });
    }, [{ type: 'tran', tstep: 2e-6, tstop: 2e-3 }]);
    const peak = Math.max(...v(tr, 'V(A)'));
    expect(peak).toBeGreaterThan(28);
    expect(peak).toBeLessThan(36);
    // after breakover the voltage folds back
    expect(last(v(tr, 'V(A)'))).toBeLessThan(peak - 3);
  });

  it('UJT 2N2646 relaxation oscillator runs near 1 / (R·C·ln(1 / (1 − η)))', () => {
    const [tr] = run((b) => {
      vsrc(b, 'V1', 'VB', '12');
      res(b, 'RT', 'VB', 'E', '10k');
      const c = b.part('basic/capacitor', 'CT', 100, 300, { value: '100n' });
      b.labelPin(c, '1', 'E');
      b.labelPin(c, '2', '0');
      res(b, 'R2', 'VB', 'B2', '470', 200);
      res(b, 'R1', 'B1', '0', '47', 300);
      place(b, 'transistors/2n2646', 'Q1', { E: 'E', B2: 'B2', B1: 'B1' });
    }, [{ type: 'tran', tstep: 2e-6, tstop: 10e-3 }]);
    const t = tr.scale!.re;
    const ve = v(tr, 'V(E)');
    const falls: number[] = [];
    for (let i = 1; i < ve.length; i++) if (ve[i - 1] > 4 && ve[i] <= 4 && t[i] > 1e-3) falls.push(t[i]);
    expect(falls.length).toBeGreaterThanOrEqual(3);
    const f = (falls.length - 1) / (falls[falls.length - 1] - falls[0]);
    const expected = 1 / (10e3 * 100e-9 * Math.log(1 / (1 - 0.65)));
    expect(f).toBeGreaterThan(expected * 0.6);
    expect(f).toBeLessThan(expected * 1.5);
  });
});

describe('transistors', () => {
  it('BJT BC337-40 hFE ≈ 400 and TIP142 Darlington ≈ 2000 at the datasheet test currents', () => {
    for (const [id, ic, hfe] of [
      ['transistors/bc337-40', 0.1, 400],
      ['transistors/2n5551', 0.01, 100],
      ['transistors/tip142', 5, 2000],
    ] as const) {
      const [op] = run((b) => {
        vsrc(b, 'VCE', 'C', '5');
        isrc(b, 'IB', 'B', String(ic / hfe));
        place(b, id, 'Q1', { C: 'C', B: 'B', E: '0' });
      }, [OP]);
      expect(-v(op, 'I(VCE)')[0] / ic, id).toBeGreaterThan(0.95);
      expect(-v(op, 'I(VCE)')[0] / ic, id).toBeLessThan(1.05);
    }
  });

  it('MOSFET IRF3205 RDS(on) ≈ 8 mΩ at VGS = 10 V; 2N7002 ≈ 1.6 Ω', () => {
    for (const [id, rds] of [
      ['transistors/irf3205', 0.008],
      ['transistors/2n7002', 1.6],
    ] as const) {
      const id1 = rds < 0.1 ? 1 : 0.01;
      const [op] = run((b) => {
        vsrc(b, 'VG', 'G', '10');
        isrc(b, 'ID', 'D', String(id1));
        place(b, id, 'Q1', { D: 'D', G: 'G', S: '0' });
      }, [OP]);
      expect(v(op, 'V(D)')[0] / id1, id).toBeGreaterThan(rds * 0.9);
      expect(v(op, 'V(D)')[0] / id1, id).toBeLessThan(rds * 1.1);
    }
  });

  it('JFET 2N3819 IDSS ≈ 10 mA at VGS = 0', () => {
    const [op] = run((b) => {
      vsrc(b, 'VD', 'D', '10');
      place(b, 'transistors/2n3819', 'Q1', { D: 'D', G: '0', S: '0' });
    }, [OP]);
    const id = -v(op, 'I(VD)')[0];
    expect(id).toBeGreaterThan(10e-3);
    expect(id).toBeLessThan(10.6e-3);
  });

  it('IGBT FGH40N60SMD: VCE(sat) ≈ 1.9 V at 40 A and VGE = 15 V', () => {
    const [op] = run((b) => {
      vsrc(b, 'VG', 'G', '15');
      isrc(b, 'IC', 'C', '40');
      place(b, 'transistors/fgh40n60smd', 'Q1', { C: 'C', G: 'G', E: '0' });
    }, [OP]);
    expect(v(op, 'V(C)')[0]).toBeGreaterThan(1.6);
    expect(v(op, 'V(C)')[0]).toBeLessThan(2.2);
  });
});

describe('analog ICs', () => {
  const opampSupplies = (b: B) => {
    vsrc(b, 'VP', 'VP', '15', -500);
    vsrc(b, 'VN', 'VN', '-15', -600);
  };

  it('OP27 inverting amplifier: gain 100, bandwidth ≈ GBW / 101', () => {
    const [ac] = run((b) => {
      opampSupplies(b);
      const s = b.part('sources/ac-voltage', 'VIN', -300, 0, { amp: '10m', acmag: '1' });
      b.labelPin(s, '+', 'IN');
      b.labelPin(s, '-', '0');
      res(b, 'R1', 'IN', 'M', '1k');
      res(b, 'RF', 'M', 'OUT', '100k', 200);
      place(b, 'analog/op27', 'U1', { 'IN-': 'M', 'IN+': '0', OUT: 'OUT', 'V+': 'VP', 'V-': 'VN' });
    }, [{ type: 'ac', sweep: 'dec', points: 50, fstart: 100, fstop: 1e6 }]);
    const f = ac.scale!.re;
    const re = v(ac, 'V(OUT)');
    const im = ac.vectors.find((x) => x.name === 'V(OUT)')!.im!;
    const mag = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    expect(mag[0]).toBeCloseTo(100, 0);
    const fc = f[mag.findIndex((m) => m < 100 / Math.SQRT2)];
    expect(fc).toBeGreaterThan((8e6 / 101) * 0.8);
    expect(fc).toBeLessThan((8e6 / 101) * 1.25);
  });

  it('INA128 with RG = 5.556 kΩ has a gain of 10', () => {
    const [op] = run((b) => {
      opampSupplies(b);
      vsrc(b, 'VA', 'A', '0.1');
      place(b, 'analog/ina128', 'U1', { 'IN+': 'A', 'IN-': '0', RG1: 'G1', RG2: 'G2', REF: '0', OUT: 'OUT', 'V+': 'VP', 'V-': 'VN' });
      res(b, 'RG', 'G1', 'G2', '5.556k');
    }, [OP]);
    expect(v(op, 'V(OUT)')[0]).toBeCloseTo(1.0, 2);
  });

  it('references: LM4040-2.5 shunt and REF02 series give their nominal voltages', () => {
    const [a] = run((b) => {
      vsrc(b, 'V1', 'S', '12');
      res(b, 'R1', 'S', 'K', '9.5k');
      place(b, 'analog/lm4040-2.5', 'D1', { A: '0', K: 'K' });
    }, [OP]);
    expect(v(a, 'V(K)')[0]).toBeCloseTo(2.5, 2);
    const [c] = run((b) => {
      vsrc(b, 'V1', 'S', '15');
      place(b, 'analog/ref02', 'U1', { IN: 'S', GND: '0', OUT: 'OUT' });
      res(b, 'RL', 'OUT', '0', '5k');
    }, [OP]);
    expect(v(c, 'V(OUT)')[0]).toBeCloseTo(5, 2);
  });

  it('NE555 and TLC555 astable run at ≈ 1.44 / ((RA + 2RB)·C)', () => {
    for (const id of ['analog/ne555', 'analog/tlc555']) {
      const [tr] = run((b) => {
        vsrc(b, 'V1', 'VCC', '9');
        place(b, id, 'U1', { VCC: 'VCC', RST: 'VCC', GND: '0', TRIG: 'T', THR: 'T', DIS: 'D', OUT: 'OUT' });
        res(b, 'RA', 'VCC', 'D', '1k');
        res(b, 'RB', 'D', 'T', '10k', 100);
        const c = b.part('basic/capacitor', 'C1', 200, 300, { value: '100n' });
        b.labelPin(c, '1', 'T');
        b.labelPin(c, '2', '0');
      }, [{ type: 'tran', tstep: 5e-6, tstop: 10e-3 }]);
      const t = tr.scale!.re;
      const o = v(tr, 'V(OUT)');
      const ups: number[] = [];
      for (let i = 1; i < o.length; i++) if (o[i - 1] < 4 && o[i] >= 4 && t[i] > 1e-3) ups.push(t[i]);
      const f = (ups.length - 1) / (ups[ups.length - 1] - ups[0]);
      expect(f, id).toBeGreaterThan((1.44 / (21e3 * 100e-9)) * 0.85);
      expect(f, id).toBeLessThan((1.44 / (21e3 * 100e-9)) * 1.15);
    }
  });
});

describe('power', () => {
  it('linear regulators: 78L05, MCP1700-3.3 near dropout, LM1117-ADJ with a divider', () => {
    const [a] = run((b) => {
      vsrc(b, 'V1', 'IN', '12');
      place(b, 'power/78l05', 'U1', { IN: 'IN', GND: '0', OUT: 'OUT' });
      res(b, 'RL', 'OUT', '0', '100');
    }, [OP]);
    expect(v(a, 'V(OUT)')[0]).toBeCloseTo(5, 1);
    const [c] = run((b) => {
      vsrc(b, 'V1', 'IN', '3.6');
      place(b, 'power/mcp1700-3.3', 'U1', { IN: 'IN', GND: '0', OUT: 'OUT' });
      res(b, 'RL', 'OUT', '0', '33');
    }, [OP]);
    expect(v(c, 'V(OUT)')[0]).toBeCloseTo(3.3, 1);
    const [d] = run((b) => {
      vsrc(b, 'V1', 'IN', '9');
      place(b, 'power/lm1117-adj', 'U1', { IN: 'IN', ADJ: 'ADJ', OUT: 'OUT' });
      res(b, 'R1', 'OUT', 'ADJ', '120');
      res(b, 'R2', 'ADJ', '0', '360', 100);
    }, [OP]);
    expect(v(d, 'V(OUT)')[0]).toBeCloseTo(5, 1);
  });

  it('averaged converters follow their ideal conversion ratios', () => {
    const vin = 12;
    const cases: [string, number][] = [
      ['power/buck-converter', 0.25 * vin],
      ['power/boost-converter', vin / (1 - 0.25)],
      ['power/buckboost-converter', (-vin * 0.25) / (1 - 0.25)],
      ['power/cuk-converter', (-vin * 0.25) / (1 - 0.25)],
    ];
    for (const [id, ideal] of cases) {
      const [op] = run((b) => {
        vsrc(b, 'V1', 'IN', String(vin));
        place(b, id, 'U1', { IN: 'IN', OUT: 'OUT', GND: '0' }, { duty: '0.25', rl: '1m' });
        res(b, 'RL', 'OUT', '0', '100');
      }, [OP]);
      expect(v(op, 'V(OUT)')[0] / ideal, id).toBeGreaterThan(0.99);
      expect(v(op, 'V(OUT)')[0] / ideal, id).toBeLessThan(1.005);
    }
  });

  it('LM2596-5.0 in its application circuit regulates 5 V from 12 V and draws ≈ VOUT·IOUT / VIN', () => {
    const [op] = run((b) => {
      vsrc(b, 'V1', 'IN', '12');
      place(b, 'power/lm2596-5.0', 'U1', { VIN: 'IN', GND: '0', SW: 'SW', FB: 'OUT' });
      const l = b.part('basic/inductor', 'L1', 100, 0, { value: '33u' });
      b.labelPin(l, '1', 'SW');
      b.labelPin(l, '2', 'OUT');
      place(b, 'diodes/1n5822', 'D1', { A: '0', K: 'SW' });
      res(b, 'RL', 'OUT', '0', '5');
    }, [OP]);
    expect(v(op, 'V(OUT)')[0]).toBeCloseTo(5, 3);
    const pin = 12 * -v(op, 'I(V1)')[0];
    expect(pin).toBeGreaterThan(5);
    expect(pin).toBeLessThan(5 / 0.85);
  });

  it('PWM controller duty = VC / ramp peak; PI controller drives an RC plant to the set point', () => {
    const [tr] = run((b) => {
      vsrc(b, 'V1', 'VC', '1.5');
      place(b, 'power/pwm-controller', 'U1', { VC: 'VC', OUT: 'OUT', GND: '0' }, { freq: '10k', vramp: '5' });
      res(b, 'RL', 'OUT', '0', '10k');
    }, [{ type: 'tran', tstep: 1e-6, tstop: 1e-3 }]);
    const o = v(tr, 'V(OUT)');
    const t = tr.scale!.re;
    let hi = 0;
    for (let i = 1; i < o.length; i++) if (t[i] > 0.2e-3 && o[i] > 2.5) hi += t[i] - t[i - 1];
    expect(hi / 0.8e-3).toBeCloseTo(0.3, 1);
    const [pi] = run((b) => {
      vsrc(b, 'VSP', 'SP', '2');
      place(b, 'analog/pi-controller', 'U1', { SP: 'SP', PV: 'PV', OUT: 'U' }, { kp: '1', ki: '200' });
      res(b, 'R1', 'U', 'PV', '1k');
      const c = b.part('basic/capacitor', 'C1', 100, 300, { value: '10u' });
      b.labelPin(c, '1', 'PV');
      b.labelPin(c, '2', '0');
    }, [{ type: 'tran', tstep: 50e-6, tstop: 0.1 }]);
    expect(last(v(pi, 'V(PV)'))).toBeCloseTo(2, 2);
  });

  it('fuses: F1A melts at 3 A after a few ms (τ = 20 ms) and carries 1 A indefinitely', () => {
    const [tr] = run((b) => {
      const s = b.part('sources/step-voltage', 'V1', -300, 0, { v0: '0', v1: '3', tstep: '1m', trise: '1u' });
      b.labelPin(s, '+', 'S');
      b.labelPin(s, '-', '0');
      place(b, 'power/fuse-f-1a', 'F1', { '1': 'S', '2': 'A' });
      res(b, 'RL', 'A', '0', '1');
    }, [{ type: 'tran', tstep: 50e-6, tstop: 20e-3 }]);
    const t = tr.scale!.re;
    const va = v(tr, 'V(A)');
    const melt = t[va.findIndex((x, i) => t[i] > 1.1e-3 && x < 0.5)] - 1e-3;
    const expected = -20e-3 * Math.log(1 - 2.25 / 9);
    expect(melt).toBeGreaterThan(expected * 0.85);
    expect(melt).toBeLessThan(expected * 1.15);
    const [ok] = run((b) => {
      vsrc(b, 'V1', 'S', '1');
      place(b, 'power/fuse-f-1a', 'F1', { '1': 'S', '2': 'A' });
      res(b, 'RL', 'A', '0', '1');
    }, [{ type: 'tran', tstep: 1e-3, tstop: 0.2 }]);
    expect(last(v(ok, 'V(A)'))).toBeGreaterThan(0.95);
  });
});

describe('electromechanical', () => {
  it('relay 12 V SPDT: pulls in at the nominal coil voltage, not at 50 %', () => {
    for (const [vc, closed] of [
      ['12', true],
      ['6', false],
    ] as const) {
      const [tr] = run((b) => {
        vsrc(b, 'VC', 'C', vc);
        vsrc(b, 'VS', 'S', '5', -500);
        place(b, 'electromechanical/relay-12v-spdt', 'K1', { C1: 'C', C2: '0', COM: 'S', NO: 'NO', NC: 'NC' });
        res(b, 'R1', 'NO', '0', '1k');
        res(b, 'R2', 'NC', '0', '1k', 100);
      }, [{ type: 'tran', tstep: 1e-4, tstop: 50e-3 }]);
      expect(last(v(tr, 'V(NO)')) > 4, vc).toBe(closed);
      expect(last(v(tr, 'V(NC)')) > 4, vc).toBe(!closed);
    }
  });

  it('MCB C10 trips magnetically at 100 A but not at 12 A', () => {
    const trip = (r: string) =>
      run((b) => {
        vsrc(b, 'V1', 'S', '12');
        place(b, 'electromechanical/mcb-c10', 'Q1', { '1': 'S', '2': 'A' });
        res(b, 'RL', 'A', '0', r);
      }, [{ type: 'tran', tstep: 1e-4, tstop: 10e-3 }])[0];
    expect(last(v(trip('0.12'), 'V(A)'))).toBeLessThan(0.1);
    expect(last(v(trip('1'), 'V(A)'))).toBeGreaterThan(11.9);
  });

  it('stepper: energising phase A then phase B turns the rotor by one 1.8° step', () => {
    const [tr] = run((b) => {
      const a = b.part('sources/pwl-voltage', 'VA', -300, 0, { points: '0 3.3, 50m 3.3, 50.1m 0' });
      b.labelPin(a, '+', 'A');
      b.labelPin(a, '-', '0');
      const c = b.part('sources/pwl-voltage', 'VB', -400, 0, { points: '0 0, 50m 0, 50.1m 3.3' });
      b.labelPin(c, '+', 'B');
      b.labelPin(c, '-', '0');
      place(b, 'electromechanical/stepper-bipolar', 'M1', { 'A+': 'A', 'A-': '0', 'B+': 'B', 'B-': '0' });
    }, [{ type: 'tran', tstep: 50e-6, tstop: 0.15 }]);
    const deg = v(tr, 'V(M1.deg)');
    const t = tr.scale!.re;
    expect(Math.abs(deg[t.findIndex((x) => x >= 0.049)])).toBeLessThan(0.1);
    expect(last(deg)).toBeGreaterThan(1.6);
    expect(last(deg)).toBeLessThan(2.0);
  });

  it('three-phase induction motor runs up close to synchronous speed (4 poles, 50 Hz: 157 rad/s)', () => {
    const [tr] = run((b) => {
      const s = b.part('sources/three-phase-adjustable', 'V1', -300, 0, { v1: '230', v2: '230', v3: '230' });
      b.labelPin(s, 'L1', 'U');
      b.labelPin(s, 'L2', 'V');
      b.labelPin(s, 'L3', 'W');
      b.labelPin(s, 'N', '0');
      place(b, 'electromechanical/induction-motor-3ph', 'M1', { U: 'U', V: 'V', W: 'W' });
    }, [{ type: 'tran', tstep: 2e-4, tstop: 1.2 }]);
    const w = last(v(tr, 'V(M1.w)'));
    expect(w).toBeGreaterThan(0.93 * 157.08);
    expect(w).toBeLessThan(157.08);
  });
});

describe('misc and RF', () => {
  it('RTD PT100 is 138.5 Ω at 100 °C; type K thermocouple gives ≈ 4.1 mV at 100 °C (0 °C reference); LM35 250 mV at 25 °C', () => {
    const [a] = run((b) => {
      isrc(b, 'I1', 'R', '1m');
      place(b, 'misc/rtd-pt100', 'RT1', { '1': 'R', '2': '0' }, { temp: '100' });
    }, [OP]);
    expect(v(a, 'V(R)')[0] / 1e-3).toBeCloseTo(138.5, 0);
    const [c] = run((b) => {
      place(b, 'misc/thermocouple-k', 'TC1', { '+': 'P', '-': '0' }, { temp: '100', tref: '0' });
      res(b, 'RL', 'P', '0', '10meg');
    }, [OP]);
    expect(v(c, 'V(P)')[0]).toBeGreaterThan(4.0e-3);
    expect(v(c, 'V(P)')[0]).toBeLessThan(4.2e-3);
    const [d] = run((b) => {
      vsrc(b, 'V1', 'VS', '5');
      place(b, 'misc/lm35', 'U1', { '+VS': 'VS', VOUT: 'OUT', GND: '0' }, { temp: '25' });
      res(b, 'RL', 'OUT', '0', '100k');
    }, [OP]);
    expect(v(d, 'V(OUT)')[0]).toBeCloseTo(0.25, 3);
  });

  it('12AX7 plate current ≈ 1 mA at 250 V / −2 V (datasheet 1.2 mA)', () => {
    const [op] = run((b) => {
      vsrc(b, 'VP', 'P', '250');
      vsrc(b, 'VG', 'G', '-2', -500);
      place(b, 'misc/tube-12ax7', 'V1', { P: 'P', G: 'G', K: '0' });
    }, [OP]);
    const ip = -v(op, 'I(VP)')[0];
    expect(ip).toBeGreaterThan(0.84e-3);
    expect(ip).toBeLessThan(1.56e-3);
  });

  it('microstrip on 1.6 mm FR-4 with W = 3 mm is ≈ 50 Ω; the planar spiral formula gives nH', () => {
    const { z0, eeff } = microstrip(3, 1.6, 4.4);
    expect(z0).toBeGreaterThan(48);
    expect(z0).toBeLessThan(53);
    expect(eeff).toBeGreaterThan(3.2);
    expect(eeff).toBeLessThan(3.5);
    const l = spiralInductance(3.5, 300e-6, 100e-6);
    expect(l).toBeGreaterThan(3e-9);
    expect(l).toBeLessThan(10e-9);
  });

  it('ferrite bead 600 Ω and RF inductor 100 nH have their rated impedance', () => {
    const z = (id: string, f: number) => {
      const [ac] = run((b) => {
        const s = b.part('sources/ac-current', 'I1', -300, 0, { amp: '1m', acmag: '1' });
        b.labelPin(s, '+', 'A');
        b.labelPin(s, '-', '0');
        place(b, id, 'L1', { '1': 'A', '2': '0' });
      }, [{ type: 'acsingle', freq: f }]);
      const x = ac.vectors.find((y) => y.name === 'V(A)')!;
      return Math.hypot(x.re[0], x.im?.[0] ?? 0);
    };
    expect(z('rf/ferrite-bead-600', 100e6) / 600).toBeCloseTo(1, 1);
    expect(z('rf/rfl-100n', 10e6) / (2 * Math.PI * 10e6 * 100e-9)).toBeCloseTo(1, 1);
  });
});
