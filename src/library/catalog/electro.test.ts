/**
 * Round-4 electromechanical parts, batteries, flux sources, file sources and the audio parts through
 * the real netlister and engine: relay coil / contact linking across sheets, time-delay relays, the
 * fuse I²t trip time, the breaker and overload trip curves, transformer regulation, battery runtime
 * and file playback.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import type { AnalysisSpec } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { BATTERY_CATALOG, batteryCellVoltage, batteryResistance, batteryRuntime } from './batteries';
import { BREAKER_CURVES, breakerTripTime, fuseMeltTime } from './protection';
import { OVERLOAD_CLASSES, overloadTau, overloadTripTime, type OverloadClass } from './relays';
import { lineTransformerDesign, typicalLineTransformer } from './lineMagnetics';
import { measurementPlayback } from './measurementSource';
import { wavPwl, wavSamples } from './audio';
import { encodeWav, bytesToBase64 } from '../../audio/wav';
import { loadAllGroups } from '../index';

await loadAllGroups();

type B = DesignBuilder;
type H = ReturnType<B['part']>;

function build(make: (b: B) => void) {
  const b = new DesignBuilder('electro');
  make(b);
  return buildNetlist(b.design, { includeAnalysis: false });
}

function run(make: (b: B) => void, specs: AnalysisSpec[]): { res: AnalysisResult[]; erc: ReturnType<typeof build>['erc'] } {
  const nb = build(make);
  const errs = nb.erc.filter((m) => m.severity === 'error');
  expect(errs.map((e) => e.message)).toEqual([]);
  const res = runAnalyses({ ...nb.netlist, analyses: specs });
  for (const r of res) expect(r.error).toBeUndefined();
  return { res, erc: nb.erc };
}

const vec = (r: AnalysisResult, name: string): Float64Array => {
  const x = r.vectors.find((y) => y.name.toLowerCase() === name.toLowerCase());
  if (!x) throw new Error(`no vector ${name} in ${r.vectors.map((y) => y.name).join(', ')}`);
  return x.re;
};
const time = (r: AnalysisResult): Float64Array => r.scale!.re;
const last = (a: Float64Array) => a[a.length - 1];

/** First time the vector rises above (dir 1) or falls below (dir -1) a level, interpolated. */
function crossing(r: AnalysisResult, name: string, level: number, dir: 1 | -1 = 1): number {
  const t = time(r);
  const v = vec(r, name);
  for (let i = 1; i < v.length; i++) {
    if ((dir === 1 && v[i - 1] < level && v[i] >= level) || (dir === -1 && v[i - 1] > level && v[i] <= level)) return t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]);
  }
  return Number.NaN;
}

/** next free x position of a builder (every part gets its own column so pins never touch) */
const columns = new WeakMap<B, number>();
const nextX = (b: B): number => {
  const x = (columns.get(b) ?? -600) + 200;
  columns.set(b, x);
  return x;
};

function dc(b: B, ref: string, pos: string, value: string, _x?: number): H {
  void _x;
  const s = b.part('sources/dc-voltage', ref, nextX(b), 0, { value });
  b.labelPin(s, '+', pos);
  b.labelPin(s, '-', '0');
  return s;
}
function res(b: B, ref: string, a: string, c: string, value: string, _x?: number): H {
  void _x;
  const r = b.part('basic/resistor', ref, nextX(b), 300, { value });
  b.labelPin(r, '1', a);
  b.labelPin(r, '2', c);
  return r;
}
function place(b: B, id: string, ref: string, pins: Record<string, string>, params: Record<string, string> = {}, _x?: number): H {
  void _x;
  const h = b.part(id, ref, nextX(b), 0, params);
  for (const [p, net] of Object.entries(pins)) b.labelPin(h, p, net);
  return h;
}
const tran = (tstep: number, tstop: number): AnalysisSpec => ({ type: 'tran', tstep, tstop });

describe('relay coil and contacts linked by name', () => {
  /** coil K1 (12 V) on sheet 1; NO, NC and changeover contacts on sheet 2 and an NO contact on sheet 1 */
  const circuit = (vcoil: string) => (b: B) => {
    dc(b, 'VC', 'C', vcoil);
    place(b, 'electromechanical/coil-dc-12v', 'K1', { A1: 'C', A2: '0' });
    dc(b, 'VS', 'S', '5', -500);
    place(b, 'electromechanical/relay-contact-no', 'KC9', { '13': 'S', '14': 'SHEET1' }, { coil: 'K1' }, 200);
    res(b, 'R9', 'SHEET1', '0', '1k', 100);
    b.addSheet('Contacts');
    b.useSheet(1);
    dc(b, 'VS2', 'S', '5', -500);
    place(b, 'electromechanical/relay-contact-no', 'KC1', { '13': 'S', '14': 'NO' }, { coil: 'K1' });
    place(b, 'electromechanical/relay-contact-nc', 'KC2', { '21': 'S', '22': 'NC' }, { coil: 'K1' }, 100);
    place(b, 'electromechanical/relay-contact-co', 'KC3', { '11': 'S', '12': 'CONC', '14': 'CONO' }, { coil: 'K1' }, 200);
    res(b, 'R1', 'NO', '0', '1k');
    res(b, 'R2', 'NC', '0', '1k', 100);
    res(b, 'R3', 'CONC', '0', '1k', 200);
    res(b, 'R4', 'CONO', '0', '1k', 300);
  };

  it('one coil drives any number of contacts on other sheets', () => {
    const { res: r, erc } = run(circuit('12'), [tran(1e-4, 50e-3)]);
    expect(erc.filter((m) => m.code === 'other' && m.detail?.id?.startsWith('contact'))).toEqual([]);
    const v = (n: string) => last(vec(r[0], `V(${n})`));
    expect(v('NO')).toBeGreaterThan(4.9);
    expect(v('NC')).toBeLessThan(0.1);
    expect(v('CONC')).toBeLessThan(0.1);
    expect(v('CONO')).toBeGreaterThan(4.9);
    expect(v('SHEET1')).toBeGreaterThan(4.9);
  });

  it('a de-energised coil leaves every contact in its rest position', () => {
    const { res: r } = run(circuit('0'), [tran(1e-4, 20e-3)]);
    const v = (n: string) => last(vec(r[0], `V(${n})`));
    expect(v('NO')).toBeLessThan(0.1);
    expect(v('NC')).toBeGreaterThan(4.9);
    expect(v('CONC')).toBeGreaterThan(4.9);
    expect(v('CONO')).toBeLessThan(0.1);
  });

  it('pulls in at the nominal coil voltage, not at half of it (like the single-part relay)', () => {
    const { res: r } = run(circuit('6'), [tran(1e-4, 30e-3)]);
    expect(last(vec(r[0], 'V(NO)'))).toBeLessThan(0.1);
  });

  it('the coil name is matched without regard to case or spaces', () => {
    const make = (name: string) => (b: B) => {
      dc(b, 'VC', 'C', '12');
      place(b, 'electromechanical/coil-dc-12v', 'K1', { A1: 'C', A2: '0' });
      dc(b, 'VS', 'S', '5', -500);
      place(b, 'electromechanical/relay-contact-no', 'KC1', { '13': 'S', '14': 'NO' }, { coil: name });
      res(b, 'R1', 'NO', '0', '1k');
    };
    expect(last(vec(run(make(' k1 '), [tran(1e-4, 20e-3)]).res[0], 'V(NO)'))).toBeGreaterThan(4.9);
  });

  it('ERC: a contact whose coil does not exist, is not a coil, or is unnamed raises a warning and rests', () => {
    const make = (name: string) => (b: B) => {
      dc(b, 'VC', 'C', '12');
      place(b, 'electromechanical/coil-dc-12v', 'K1', { A1: 'C', A2: '0' });
      dc(b, 'VS', 'S', '5', -500);
      place(b, 'electromechanical/relay-contact-no', 'KC1', { '13': 'S', '14': 'NO' }, { coil: name });
      res(b, 'R1', 'NO', '0', '1k');
    };
    const missing = run(make('K7'), [tran(1e-4, 20e-3)]);
    expect(missing.erc.map((m) => m.detail?.id)).toContain('contactNoCoil');
    expect(missing.erc.find((m) => m.detail?.id === 'contactNoCoil')).toMatchObject({ severity: 'warning', refdes: 'KC1', detail: { params: { coil: 'K7' } } });
    expect(last(vec(missing.res[0], 'V(NO)'))).toBeLessThan(0.1);
    const notCoil = run(make('R1'), [tran(1e-4, 20e-3)]);
    expect(notCoil.erc.map((m) => m.detail?.id)).toContain('contactNotCoil');
    const unnamed = run(make('  '), [tran(1e-4, 20e-3)]);
    expect(unnamed.erc.map((m) => m.detail?.id)).toContain('contactNoName');
  });

  it('a coil excluded from the simulation counts as missing', () => {
    const nb = build((b) => {
      dc(b, 'VC', 'C', '12');
      const k = place(b, 'electromechanical/coil-dc-12v', 'K1', { A1: 'C', A2: '0' });
      k.inst.excludeFromSim = true;
      place(b, 'electromechanical/relay-contact-no', 'KC1', { '13': 'S', '14': 'NO' }, { coil: 'K1' });
    });
    expect(nb.erc.map((m) => m.detail?.id)).toContain('contactNoCoil');
  });

  it('three-pole main contacts follow a contactor coil and a supplementary block follows the same coil', () => {
    const { res: r } = run(
      (b) => {
        dc(b, 'VC', 'C', '24');
        place(b, 'electromechanical/contactor-coil-24vdc', 'KM1', { A1: 'C', A2: '0' });
        dc(b, 'VS', 'S', '12', -500);
        place(b, 'electromechanical/contactor-contact-3p', 'KC1', { L1: 'S', T1: 'T1', L2: 'S', T2: 'T2', L3: 'S', T3: 'T3' }, {}, 200);
        place(b, 'electromechanical/supplementary-block-2no2nc', 'KC2', { '13': 'S', '14': 'A', '31': 'S', '32': 'B' }, {}, 500);
        for (const [k, n] of [['T1', 0], ['T2', 100], ['T3', 200], ['A', 300], ['B', 400]] as const) res(b, `R${k}`, k, '0', '1k', n);
      },
      [tran(1e-4, 60e-3)],
    );
    for (const n of ['T1', 'T2', 'T3', 'A']) expect(last(vec(r[0], `V(${n})`)), n).toBeGreaterThan(11.9);
    expect(last(vec(r[0], 'V(B)'))).toBeLessThan(0.1);
  });
});

describe('time-delay relays', () => {
  const timerCircuit = (kind: 'on-delay' | 'off-delay', points: string) => (b: B) => {
    const v = b.part('sources/pwl-voltage', 'VC', nextX(b), 0, { points });
    b.labelPin(v, '+', 'C');
    b.labelPin(v, '-', '0');
    place(b, `electromechanical/timer-coil-${kind}`, 'KT1', { A1: 'C', A2: '0' }, { delay: '0.2' });
    dc(b, 'VS', 'S', '5', -500);
    place(b, 'electromechanical/timer-contact-no', 'KC1', { '17': 'S', '18': 'OUT' });
    res(b, 'R1', 'OUT', '0', '1k');
  };

  it('on-delay: the contact closes one delay time after the coil is energised and opens at once on release', () => {
    // coil 24 V from t = 0.1 s to 0.8 s
    const { res: r } = run(timerCircuit('on-delay', '0 0, 0.1 0, 0.1001 24, 0.8 24, 0.8001 0, 1.2 0'), [tran(1e-3, 1.2)]);
    const close = crossing(r[0], 'V(OUT)', 2.5, 1);
    expect(close).toBeGreaterThan(0.1 + 0.2 - 0.02);
    expect(close).toBeLessThan(0.1 + 0.2 + 0.03);
    const open = crossing(r[0], 'V(OUT)', 2.5, -1);
    expect(open).toBeGreaterThan(0.8);
    expect(open).toBeLessThan(0.8 + 0.03);
  });

  it('on-delay: a coil released before the delay never closes the contact', () => {
    const { res: r } = run(timerCircuit('on-delay', '0 0, 0.1 0, 0.1001 24, 0.2 24, 0.2001 0, 0.8 0'), [tran(1e-3, 0.8)]);
    expect(Math.max(...vec(r[0], 'V(OUT)'))).toBeLessThan(0.5);
  });

  it('off-delay: closes at once and opens one delay time after the coil is released', () => {
    const { res: r } = run(timerCircuit('off-delay', '0 0, 0.1 0, 0.1001 24, 0.5 24, 0.5001 0, 1.2 0'), [tran(1e-3, 1.2)]);
    const close = crossing(r[0], 'V(OUT)', 2.5, 1);
    expect(close).toBeGreaterThan(0.1);
    expect(close).toBeLessThan(0.1 + 0.03);
    const open = crossing(r[0], 'V(OUT)', 2.5, -1);
    expect(open).toBeGreaterThan(0.5 + 0.2 - 0.02);
    expect(open).toBeLessThan(0.5 + 0.2 + 0.03);
  });
});

describe('fuse I²t', () => {
  it('fuseMeltTime is I²t / (I² − Imin²) and infinite at or below the minimum melting current', () => {
    expect(fuseMeltTime(5, 1.5, 4)).toBeCloseTo(4 / (25 - 2.25), 12);
    expect(fuseMeltTime(1.5, 1.5, 4)).toBe(Number.POSITIVE_INFINITY);
    expect(fuseMeltTime(-5, 1.5, 4)).toBeCloseTo(fuseMeltTime(5, 1.5, 4), 12);
  });

  it('blows after I²t / (I² − Imin²) at a constant current, and stays open', () => {
    const { res: r } = run(
      (b) => {
        dc(b, 'V1', 'S', '20');
        place(b, 'power/fuse-i2t', 'F1', { '1': 'S', '2': 'A' }, { in: '1', i2t: '4' });
        res(b, 'R1', 'A', '0', '4');
      },
      [tran(0.5e-3, 0.6)],
    );
    // the current before it blows (fuse cold resistance max(1 mΩ, 0.05/In) = 50 mΩ plus the 10 µΩ contact)
    const i = vec(r[0], 'V(A)')[1] / 4;
    const expected = fuseMeltTime(i, 1.5, 4);
    const t = crossing(r[0], 'V(A)', 0.5, -1);
    expect(i).toBeGreaterThan(4.8);
    expect(t / expected).toBeGreaterThan(0.97);
    expect(t / expected).toBeLessThan(1.03);
    expect(last(vec(r[0], 'V(A)'))).toBeLessThan(0.05);
  });

  it('a mild overload below the minimum melting current never blows it', () => {
    const { res: r } = run(
      (b) => {
        dc(b, 'V1', 'S', '5');
        place(b, 'power/fuse-i2t', 'F1', { '1': 'S', '2': 'A' }, { in: '1', i2t: '1' });
        res(b, 'R1', 'A', '0', '4');
      },
      [tran(5e-3, 3)],
    );
    expect(last(vec(r[0], 'V(A)'))).toBeGreaterThan(4.5);
  });

  it('a larger I²t takes proportionally longer at the same current', () => {
    const blow = (i2t: string) =>
      crossing(
        run(
          (b) => {
            dc(b, 'V1', 'S', '20');
            place(b, 'power/fuse-i2t', 'F1', { '1': 'S', '2': 'A' }, { in: '1', i2t });
            res(b, 'R1', 'A', '0', '4');
          },
          [tran(0.5e-3, 0.6)],
        ).res[0],
        'V(A)',
        0.5,
        -1,
      );
    expect(blow('8') / blow('4')).toBeGreaterThan(1.95);
    expect(blow('8') / blow('4')).toBeLessThan(2.05);
  });
});

describe('circuit breaker trip curve', () => {
  it('curve formulas: magnetic bands and the thermal time', () => {
    for (const c of Object.keys(BREAKER_CURVES) as (keyof typeof BREAKER_CURVES)[]) {
      expect(BREAKER_CURVES[c].mag).toBeGreaterThanOrEqual(BREAKER_CURVES[c].min);
      expect(BREAKER_CURVES[c].mag).toBeLessThanOrEqual(BREAKER_CURVES[c].max);
    }
    expect(breakerTripTime('C', 1.3)).toBe(Number.POSITIVE_INFINITY);
    expect(breakerTripTime('C', 2.5)).toBeCloseTo(10 * Math.log(6.25 / (6.25 - 1.69)), 12);
    expect(breakerTripTime('B', 4)).toBeLessThan(0.01);
    // the same multiple trips thermally on a D curve and magnetically on a B curve
    expect(breakerTripTime('B', 5)).toBeLessThan(0.01);
    expect(breakerTripTime('D', 5)).toBeGreaterThan(0.1);
  });

  it('trips thermally after τ·ln(m² / (m² − 1.3²)) at 2.5 × In', () => {
    const { res: r } = run(
      (b) => {
        dc(b, 'V1', 'S', '20');
        place(b, 'electromechanical/breaker-adjustable', 'Q1', { '1': 'S', '2': 'A' }, { in: '2', curve: 'D' });
        res(b, 'R1', 'A', '0', '3.99');
      },
      [tran(5e-3, 6)],
    );
    const i = vec(r[0], 'V(A)')[1] / 3.99;
    const m = i / 2;
    const expected = breakerTripTime('D', m);
    const t = crossing(r[0], 'V(A)', 1, -1);
    expect(m).toBeGreaterThan(2.4);
    expect(m).toBeLessThan(2.6);
    expect(t / expected).toBeGreaterThan(0.95);
    expect(t / expected).toBeLessThan(1.06);
  });

  it('a B curve trips magnetically at a multiple that a D curve carries', () => {
    const final = (curve: string) =>
      last(
        vec(
          run(
            (b) => {
              dc(b, 'V1', 'S', '20');
              place(b, 'electromechanical/breaker-adjustable', 'Q1', { '1': 'S', '2': 'A' }, { in: '2', curve });
              res(b, 'R1', 'A', '0', '1.9');
            },
            [tran(1e-3, 0.2)],
          ).res[0],
          'V(A)',
        ),
      );
    // 20 V / 1.9 Ω ≈ 10.5 A = 5.3 × In: above the B magnetic trip (4), below the D one (15)
    expect(final('B')).toBeLessThan(0.5);
    expect(final('D')).toBeGreaterThan(19);
  });
});

describe('thermal overload relay', () => {
  it('trip times follow the class: t = τ·ln(m² / (m² − 1.2)) and 4 / 7 / 13 / 20 s at 7.2 × Ir', () => {
    for (const c of Object.keys(OVERLOAD_CLASSES) as OverloadClass[]) {
      expect(overloadTripTime(c, 7.2)).toBeCloseTo(OVERLOAD_CLASSES[c], 9);
      expect(overloadTau(c)).toBeGreaterThan(0);
    }
    expect(overloadTripTime('10', 1.05)).toBe(Number.POSITIVE_INFINITY);
    expect(overloadTripTime('10', 1.2)).toBeLessThan(overloadTripTime('20', 1.2));
    expect(overloadTripTime('10', 2)).toBeLessThan(overloadTripTime('10', 1.5));
  });

  it('trips a class 10A relay at 7.2 × Ir after 4 s, and its 95-96 contact opens', () => {
    // Ir = 1 A: 7.2 A through the heater
    const { res: r } = run(
      (b) => {
        dc(b, 'V1', 'S', '7.2');
        place(b, 'electromechanical/overload-relay-1p', 'FR1', { L1: 'S', T1: 'A' }, { ir: '1', class: '10A' });
        res(b, 'R1', 'A', '0', '0.999');
        dc(b, 'V2', 'C', '5', -500);
        place(b, 'electromechanical/overload-contact-nc', 'KC1', { '95': 'C', '96': 'OK' }, { coil: 'FR1' });
        place(b, 'electromechanical/overload-contact-no', 'KC2', { '97': 'C', '98': 'FAULT' }, { coil: 'FR1' }, 200);
        res(b, 'R2', 'OK', '0', '1k', 100);
        res(b, 'R3', 'FAULT', '0', '1k', 300);
      },
      [tran(10e-3, 6)],
    );
    expect(vec(r[0], 'V(OK)')[2]).toBeGreaterThan(4.9);
    expect(vec(r[0], 'V(FAULT)')[2]).toBeLessThan(0.1);
    const t = crossing(r[0], 'V(OK)', 2.5, -1);
    expect(t).toBeGreaterThan(3.8);
    expect(t).toBeLessThan(4.3);
    expect(last(vec(r[0], 'V(FAULT)'))).toBeGreaterThan(4.9);
    // the heater stays in the circuit: the load current is not interrupted, only the contacts change
    expect(last(vec(r[0], 'V(A)'))).toBeGreaterThan(7);
  });

  it('does not trip at 1.05 × Ir however long it runs', () => {
    const { res: r } = run(
      (b) => {
        dc(b, 'V1', 'S', '1.05');
        place(b, 'electromechanical/overload-relay-1p', 'FR1', { L1: 'S', T1: 'A' }, { ir: '1', class: '10A' });
        res(b, 'R1', 'A', '0', '0.999');
        dc(b, 'V2', 'C', '5', -500);
        place(b, 'electromechanical/overload-contact-nc', 'KC1', { '95': 'C', '96': 'OK' }, { coil: 'FR1' });
        res(b, 'R2', 'OK', '0', '1k', 100);
      },
      [tran(0.5, 1500)],
    );
    expect(last(vec(r[0], 'V(OK)'))).toBeGreaterThan(4.9);
  });
});

describe('motor starter', () => {
  it('the contactor pulls in, carries the motor current, and trips on a locked-rotor overload', () => {
    const { res: r } = run(
      (b) => {
        dc(b, 'VC', 'C', '24');
        // locked motor: 12 V across 2 Ω = 6 A against a 1 A setting
        dc(b, 'VL', 'L', '12', -500);
        place(b, 'electromechanical/motor-starter-dol', 'KM1', { A1: 'C', A2: '0', L1: 'L', T1: 'M' }, { ir: '1', class: '10A' });
        res(b, 'RM', 'M', '0', '1.999');
        dc(b, 'VCT', 'CT', '5', -500);
        place(b, 'electromechanical/overload-contact-no', 'KC1', { '97': 'CT', '98': 'X' }, { coil: 'KM1' });
        res(b, 'RX', 'X', '0', '1k', 100);
      },
      [tran(10e-3, 6)],
    );
    expect(vec(r[0], 'V(M)')[3]).toBeGreaterThan(5.5);
    expect(last(vec(r[0], 'V(M)'))).toBeGreaterThan(5.5);
  });
});

describe('line transformer', () => {
  it('lineTransformerDesign solves the winding resistance so that the rated load sees the rated voltage', () => {
    const d = lineTransformerDesign({ vp: 230, vs: 12, va: 50, regulation: 12, noLoad: 12, freq: 50 });
    expect(d.vs0).toBeCloseTo(13.44, 9);
    expect(d.is).toBeCloseTo(50 / 12, 12);
    expect(d.n).toBeCloseTo(230 / 13.44, 9);
    // |V0| = |Vs + Is·(R + jX)| with the load in phase with Vs
    const re = 12 + d.is * d.r;
    const im = d.is * d.x;
    expect(Math.hypot(re, im)).toBeCloseTo(13.44, 9);
    expect(d.rp / d.n ** 2 + d.rs).toBeCloseTo(d.r, 12);
    expect(d.lm * 2 * Math.PI * 50 * d.im).toBeCloseTo(230, 6);
  });

  it('typical regulation falls with the rating', () => {
    expect(typicalLineTransformer(5).regulation).toBeGreaterThan(typicalLineTransformer(100).regulation);
    expect(typicalLineTransformer(100).regulation).toBeGreaterThan(typicalLineTransformer(1000).regulation);
    expect(typicalLineTransformer(50).regulation).toBe(12);
    expect(typicalLineTransformer(5000).regulation).toBe(5);
  });

  const ac = (load: string, id = 'electromechanical/line-transformer') => {
    const out = run(
      (b) => {
        const s = b.part('sources/ac-voltage', 'V1', nextX(b), 0, { amplitude: String(230 * Math.SQRT2), freq: '50', acmag: String(230 * Math.SQRT2) });
        b.labelPin(s, '+', 'P');
        b.labelPin(s, '-', '0');
        place(b, id, 'T1', { P1: 'P', P2: '0', S1: 'S', S2: '0' });
        if (load !== '') res(b, 'RL', 'S', '0', load);
      },
      [{ type: 'acsingle', freq: 50 }],
    ).res[0];
    const re = vec(out, 'V(S)')[0];
    const im = out.vectors.find((x) => x.name === 'V(S)')?.im?.[0] ?? 0;
    const ip = out.vectors.find((x) => x.name.toLowerCase() === 'i(v1)');
    return { vrms: Math.hypot(re, im) / Math.SQRT2, ip: ip ? Math.hypot(ip.re[0], ip.im?.[0] ?? 0) / Math.SQRT2 : Number.NaN };
  };

  it('the secondary reads the rated voltage at rated load, the regulation higher at no load', () => {
    // rated load: R = Vs² / VA = 144 / 50
    const full = ac('2.88').vrms;
    expect(full).toBeGreaterThan(12 * 0.99);
    expect(full).toBeLessThan(12 * 1.01);
    const none = ac('').vrms;
    expect(none).toBeGreaterThan(12 * 1.12 * 0.99);
    expect(none).toBeLessThan(12 * 1.12 * 1.01);
    // regulation measured the textbook way: (no load − full load) / full load
    const reg = (none - full) / full;
    expect(reg).toBeGreaterThan(0.11);
    expect(reg).toBeLessThan(0.13);
  });

  it('the no-load primary current is the stated percentage of the rated primary current', () => {
    const rated = 50 / 230;
    const i0 = ac('').ip;
    expect(i0 / rated).toBeGreaterThan(0.115);
    expect(i0 / rated).toBeLessThan(0.125);
  });

  it('the catalogue presets carry their typical regulation', () => {
    const none = ac('', 'electromechanical/line-transformer-230v-12v-25va').vrms;
    // 25 VA: 15 % regulation, so 13.8 V unloaded
    expect(none).toBeGreaterThan(13.8 * 0.985);
    expect(none).toBeLessThan(13.8 * 1.015);
  });
});

describe('battery', () => {
  it('discharge curve and resistance helpers', () => {
    expect(batteryCellVoltage('alkaline', 1)).toBeCloseTo(1.6, 12);
    expect(batteryCellVoltage('alkaline', 0)).toBeCloseTo(0.8, 12);
    expect(batteryCellVoltage('liion', 1)).toBeCloseTo(4.2, 12);
    expect(batteryCellVoltage('liion', 0.5)).toBeGreaterThan(3.7);
    expect(batteryCellVoltage('liion', 0.5)).toBeLessThan(3.8);
    expect(batteryCellVoltage('leadacid', 1)).toBeCloseTo(2.15, 12);
    expect(batteryCellVoltage('nimh', 0.5)).toBeGreaterThan(1.24);
    for (const c of ['alkaline', 'nimh', 'liion', 'leadacid'] as const) {
      let prev = -1;
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const v = batteryCellVoltage(c, s);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      // the resistance rises as the battery empties
      expect(batteryResistance(c, 0.1, 0)).toBeGreaterThan(batteryResistance(c, 0.1, 1));
    }
    expect(batteryResistance('alkaline', 0.1, 0)).toBeCloseTo(0.4, 12);
    expect(batteryRuntime(2, 1)).toBe(7200);
  });

  /** battery B1 loaded by a constant current source `amps`; returns the result */
  const discharge = (params: Record<string, string>, amps: string, tstop: number, tstep: number) =>
    run(
      (b) => {
        place(b, 'sources/battery-nonideal', 'BT1', { '+': 'P', '-': '0' }, params);
        const i = b.part('sources/dc-current', 'I1', nextX(b), 0, { value: amps });
        b.labelPin(i, '+', '0');
        b.labelPin(i, '-', 'P');
      },
      [tran(tstep, tstop)],
    ).res[0];

  it('a battery of C Ah delivering a constant I is empty after C·3600 / I seconds', () => {
    // 5 mAh at 1 A: 18 s
    const r = discharge({ chem: 'nimh', capacity: '0.005', soc: '100' }, '1', 20, 0.05);
    const t50 = crossing(r, 'V(BT1.soc)', 0.5, -1);
    expect(t50 / 9).toBeGreaterThan(0.99);
    expect(t50 / 9).toBeLessThan(1.01);
    const t0 = crossing(r, 'V(BT1.soc)', 0.02, -1);
    expect(t0 / 17.64).toBeGreaterThan(0.99);
    expect(t0 / 17.64).toBeLessThan(1.01);
  });

  it('the runtime scales with the capacity and with the initial charge', () => {
    const half = crossing(discharge({ chem: 'liion', capacity: '0.005', soc: '50' }, '1', 12, 0.05), 'V(BT1.soc)', 0.25, -1);
    expect(half / 4.5).toBeGreaterThan(0.99);
    expect(half / 4.5).toBeLessThan(1.01);
    const big = crossing(discharge({ chem: 'liion', capacity: '0.01', soc: '100' }, '1', 30, 0.05), 'V(BT1.soc)', 0.5, -1);
    expect(big / 18).toBeGreaterThan(0.99);
    expect(big / 18).toBeLessThan(1.01);
  });

  it('the terminal voltage is OCV − R(SoC)·I and sags more as the battery empties', () => {
    const r = discharge({ chem: 'alkaline', capacity: '0.005', soc: '100', r0: '0.2' }, '0.5', 34, 0.2);
    const v = vec(r, 'V(P)');
    const soc = vec(r, 'V(BT1.soc)');
    for (const k of [2, Math.floor(v.length / 2)]) {
      const s = soc[k];
      const expected = batteryCellVoltage('alkaline', s) - batteryResistance('alkaline', 0.2, s) * 0.5;
      expect(v[k]).toBeCloseTo(expected, 2);
    }
    // the voltage falls monotonically while discharging
    for (let k = 3; k < v.length; k++) expect(v[k]).toBeLessThanOrEqual(v[k - 1] + 1e-6);
    expect(v[v.length - 1]).toBeLessThan(v[2] - 0.3);
  });

  it('an unloaded battery keeps its charge and open-circuit voltage', () => {
    const r = run(
      (b) => {
        place(b, 'sources/battery-nonideal', 'BT1', { '+': 'P', '-': '0' }, { chem: 'liion', cells: '3', soc: '80' });
        res(b, 'R1', 'P', '0', '1G');
      },
      [{ type: 'op' }, tran(0.1, 5)],
    );
    expect(vec(r.res[0], 'V(P)')[0]).toBeCloseTo(3 * batteryCellVoltage('liion', 0.8), 2);
    expect(last(vec(r.res[1], 'V(BT1.soc)'))).toBeCloseTo(0.8, 3);
  });

  it('a rechargeable battery charges (SoC rises) and an alkaline cell does not', () => {
    const charge = (chem: string) => {
      const r = run(
        (b) => {
          place(b, 'sources/battery-nonideal', 'BT1', { '+': 'P', '-': '0' }, { chem, capacity: '0.005', soc: '50' });
          const i = b.part('sources/dc-current', 'I1', nextX(b), 0, { value: '0.5' });
          b.labelPin(i, '+', 'P');
          b.labelPin(i, '-', '0');
        },
        [tran(0.05, 5)],
      ).res[0];
      return last(vec(r, 'V(BT1.soc)'));
    };
    // 0.5 A for 5 s into 18 C: +0.139
    expect(charge('nimh')).toBeGreaterThan(0.5 + 0.13);
    expect(charge('nimh')).toBeLessThan(0.5 + 0.15);
    expect(charge('alkaline')).toBeCloseTo(0.5, 3);
  });

  it('all presets solve and start at their full-charge voltage', () => {
    for (const p of BATTERY_CATALOG) {
      const r = run((b) => {
        place(b, p.id, 'BT1', { '+': 'P', '-': '0' });
        res(b, 'R1', 'P', '0', '1G');
      }, [{ type: 'op' }]);
      const cells = Number(p.params.find((x) => x.key === 'cells')!.default);
      const chem = p.params.find((x) => x.key === 'chem')!.default as 'alkaline';
      expect(vec(r.res[0], 'V(P)')[0], p.id).toBeCloseTo(cells * batteryCellVoltage(chem, 1), 2);
    }
  });
});

describe('magnetic flux sources', () => {
  it('a sine flux of peak Φm at f induces N·2πf·Φm', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/flux-generator', 'V1', { '+': 'A', '-': '0' }, { peak: '1m', freq: '50', turns: '100' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-4, 0.06)],
    );
    const e = vec(r[0], 'V(A)');
    expect(Math.max(...e)).toBeGreaterThan(100 * 2 * Math.PI * 50 * 1e-3 * 0.99);
    expect(Math.max(...e)).toBeLessThan(100 * 2 * Math.PI * 50 * 1e-3 * 1.01);
    // the flux itself is observable and peaks at Φm
    const phi = vec(r[0], 'V(V1.phi)');
    expect(Math.max(...phi)).toBeGreaterThan(0.99e-3);
    expect(Math.max(...phi)).toBeLessThan(1.01e-3);
  });

  it('a triangle flux induces a square wave of N·4·f·Φm', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/flux-generator', 'V1', { '+': 'A', '-': '0' }, { wave: 'triangle', peak: '1m', freq: '100', turns: '10' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-5, 0.03)],
    );
    const t = time(r[0]);
    const e = vec(r[0], 'V(A)');
    // the triangle rises during the first quarter period (1 ms): e = N·4·f·Φm = 10·4·100·1e-3 = 4 V
    const k = t.findIndex((x) => x >= 1e-3);
    expect(e[k]).toBeGreaterThan(3.9);
    expect(e[k]).toBeLessThan(4.1);
    // and falls from 2.5 ms to 7.5 ms
    const k2 = t.findIndex((x) => x >= 5e-3);
    expect(e[k2]).toBeLessThan(-3.9);
    expect(e[k2]).toBeGreaterThan(-4.1);
  });

  it('a constant flux source induces nothing', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/flux-source', 'V1', { '+': 'A', '-': '0' }, { flux: '5m', turns: '200' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-3, 0.02)],
    );
    expect(Math.max(...vec(r[0], 'V(A)').map(Math.abs))).toBeLessThan(1e-6);
    expect(vec(r[0], 'V(V1.phi)')[5]).toBeCloseTo(5e-3, 9);
  });
});

describe('measurement file source', () => {
  const lvm = ['LabVIEW-like header line', 'Writer_Version\t2', '***End_of_Header***', '', 'X_Value\tChannel A [V]\tChannel B [V]', '0\t0\t10', '0.01\t1\t20', '0.02\t3\t30', '0.03\t2\t40'].join('\r\n');

  it('plays the chosen channel of an LVM text with time scaling, value scaling, offset and delay', () => {
    const p = measurementPlayback(lvm, 1, 1, 1, 0, 0);
    expect(p.channels).toBe(2);
    expect(p.label).toBe('Channel A');
    expect(p.pairs).toEqual([0, 0, 0.01, 1, 0.02, 3, 0.03, 2]);
    const q = measurementPlayback(lvm, 2, 2, 0.5, 1, 0.1);
    [0, 6, 0.1, 6, 0.12, 11, 0.14, 16, 0.16, 21].forEach((x, i) => expect(q.pairs[i]).toBeCloseTo(x, 12));
    expect(q.pairs).toHaveLength(10);
  });

  it('reads CSV with a decimal comma and a unit prefix in the header', () => {
    const csv = 'time (ms);V(out) [mV]\n0;0\n1;1,5\n2;3';
    const p = measurementPlayback(csv, 1, 1, 1, 0, 0);
    expect(p.pairs[2]).toBeCloseTo(1e-3, 12);
    expect(p.pairs[3]).toBeCloseTo(1.5e-3, 12);
  });

  it('explains a missing channel and an unreadable file', () => {
    expect(() => measurementPlayback(lvm, 3, 1, 1, 0, 0)).toThrow(/the file has 2 channels/);
    expect(() => measurementPlayback('hello world', 1, 1, 1, 0, 0)).toThrow(/bad value for data/);
  });

  it('the part reproduces the measured values in a transient run', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/measurement-voltage', 'V1', { '+': 'A', '-': '0' }, { data: lvm, channel: '1' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-3, 0.03)],
    );
    const t = time(r[0]);
    const v = vec(r[0], 'V(A)');
    const at = (x: number) => v[t.findIndex((y) => y >= x - 1e-9)];
    expect(at(0.01)).toBeCloseTo(1, 6);
    expect(at(0.02)).toBeCloseTo(3, 6);
    expect(at(0.03)).toBeCloseTo(2, 6);
    // between samples the waveform is the straight line: 100·t on the first segment
    const k = t.findIndex((x) => x > 0.004 && x < 0.008);
    expect(v[k]).toBeCloseTo(100 * t[k], 6);
  });

  it('the default data and the current source variant run immediately', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/measurement-current', 'I1', { '+': 'A', '-': '0' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-4, 5e-3)],
    );
    expect(Math.max(...vec(r[0], 'V(A)'))).toBeGreaterThan(0.5);
  });

  it('repeats the recording when asked to', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/measurement-voltage', 'V1', { '+': 'A', '-': '0' }, { data: lvm, channel: '1', repeat: 'true' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-3, 0.075)],
    );
    const t = time(r[0]);
    const v = vec(r[0], 'V(A)');
    // the second cycle starts at 0.03 s: value 3 at 0.05 s
    expect(v[t.findIndex((y) => y >= 0.05 - 1e-9)]).toBeCloseTo(3, 1);
  });
});

describe('WAV file source', () => {
  const tone = (n: number, fs: number, f: number): Float32Array => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / fs));
  const wavText = bytesToBase64(encodeWav({ sampleRate: 8000, channels: [tone(800, 8000, 500)] }));

  it('decodes to samples and PWL pairs with amplitude, time scale and delay', () => {
    const s = wavSamples(wavText);
    expect(s.rate).toBe(8000);
    expect(s.samples).toHaveLength(800);
    const pairs = wavPwl(wavText, 2, 1, 0.01);
    expect(pairs.slice(0, 4)).toEqual([0, 0, 0.01, 0]);
    expect(pairs[2 * 5 + 1]).toBeCloseTo(2 * s.samples[4], 12);
    expect(pairs[2 * 5]).toBeCloseTo(0.01 + 4 / 8000, 12);
    expect(wavPwl(wavText, 1, 2, 0)[2]).toBeCloseTo(2 / 8000, 12);
  });

  it('an empty file plays the built-in burst, a bad one explains itself', () => {
    expect(wavSamples('').samples).toHaveLength(160);
    expect(() => wavSamples('not base64 !')).toThrow(/bad value for wav/);
    expect(() => wavSamples(bytesToBase64(Uint8Array.from([1, 2, 3, 4])))).toThrow(/bad value for wav/);
  });

  it('the part plays the file as a voltage in a transient run', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/wav-voltage', 'V1', { '+': 'A', '-': '0' }, { wav: wavText, amplitude: '2' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-5, 0.01)],
    );
    // 500 Hz at 0.5 full scale × 2 V = 1 V peak
    const v = vec(r[0], 'V(A)');
    expect(Math.max(...v)).toBeGreaterThan(0.98);
    expect(Math.max(...v)).toBeLessThan(1.01);
    const t = time(r[0]);
    expect(v[t.findIndex((x) => x >= 0.5e-3 - 1e-9)]).toBeCloseTo(1, 1);
  });

  it('the default burst runs immediately', () => {
    const { res: r } = run(
      (b) => {
        place(b, 'sources/wav-voltage', 'V1', { '+': 'A', '-': '0' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-5, 0.02)],
    );
    expect(Math.max(...vec(r[0], 'V(A)'))).toBeGreaterThan(0.9);
  });
});

describe('audio parts', () => {
  it('the speaker is an 8 Ω-class load whose voltage is an indicator signal', () => {
    const nb = build((b) => {
      dc(b, 'V1', 'S', '2');
      place(b, 'indicators/speaker', 'LS1', { '+': 'S', '-': '0' });
    });
    const ind = nb.indicators.find((i) => i.refdes === 'LS1');
    expect(ind?.kind).toBe('speaker');
    expect(ind?.signal).toEqual({ kind: 'voltage', pos: 'S', neg: '0' });
    const r = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] })[0];
    // DC: the voice coil is 0.8 × 8 Ω
    expect(Math.abs(vec(r, 'I(V1)')[0])).toBeCloseTo(2 / 6.4, 3);
  });

  it('headphones publish a left and a right channel', () => {
    const nb = build((b) => {
      dc(b, 'V1', 'L', '1');
      dc(b, 'V2', 'R', '0.5', -500);
      place(b, 'indicators/headphones', 'LS1', { L: 'L', R: 'R', COM: '0' });
    });
    const ind = nb.indicators.find((i) => i.refdes === 'LS1');
    expect(ind?.signal).toEqual({ kind: 'voltage', pos: 'L', neg: '0' });
    expect(ind?.signals).toEqual([{ kind: 'voltage', pos: 'R', neg: '0' }]);
  });

  it('the microphone part builds a streamed source scaled by its gain, or a sine in test-tone mode', () => {
    const live = build((b) => {
      place(b, 'sources/microphone', 'V1', { '+': 'A', '-': '0' }, { gain: '2', rate: '16000' });
      res(b, 'R1', 'A', '0', '1k');
    });
    const stream = live.netlist.elements.find((e) => e.params.pcmfs !== undefined);
    expect(stream?.name).toBe('V1_mic');
    expect(stream?.params.pcmfs).toBe(16000);
    expect(live.netlist.elements.find((e) => e.type === 'E')?.value).toBe(2);
    const tone = run(
      (b) => {
        place(b, 'sources/microphone', 'V1', { '+': 'A', '-': '0' }, { source: 'tone', gain: '1.5', tonefreq: '1k' });
        res(b, 'R1', 'A', '0', '1k');
      },
      [tran(1e-5, 3e-3)],
    );
    expect(Math.max(...vec(tone.res[0], 'V(A)'))).toBeGreaterThan(1.49);
  });
});
