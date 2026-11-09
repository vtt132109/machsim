/**
 * Round 4 step 9: the numbers written on the nine learner samples (90-98) are what the circuits do.
 * Every expectation is a textbook formula computed here from the part values, not a stored result:
 *
 *   90  RC low-pass and high-pass: |H(fc)| = 1/sqrt(2); the print setup and layers survive a save
 *   91  divider copies: V = 5 V * RB / (1k + RB); each copy has its own meter, named by path
 *   92  .step: fc = 1 / (2 pi Rx C) for Rx = 1k, 2.2k, 4.7k
 *   93  8051: P1.0 toggles after exactly 1000 machine cycles (core) = 1 ms (circuit)
 *   94  battery: SoC' = -I / (3600 C); a 5 mAh cell at 50 mA is empty after 360 s
 *   95  7474 sections: Q1 = f/2, Q2 = f/4
 *   96  line transformer: rated load 12 V RMS, no load 12 V * (1 + 15 %)
 *   97  fuse: t = I2t / (I^2 - Imin^2); breaker: t = tau ln(m^2 / (m^2 - 1.3^2))
 *   98  measurement source: the PWL source passes through the file's samples
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAllGroups } from '../../../src/library';
import { Cpu8051, SFR } from '../../../src/mcu/cpu8051';
import { buildProgram } from '../../../src/mcu/program';
import { buildNetlist } from '../../../src/model/netlister';
import { applySteps } from '../../../src/model/steps';
import { parseDesign, serializeDesign } from '../../../src/model/serialize';
import type { Design } from '../../../src/model/types';
import { runAnalyses } from '../../../src/sim';
import type { AnalysisSpec } from '../../../src/sim/netlist';
import type { AnalysisResult } from '../../../src/sim/results';
import { batteryRuntime } from '../../../src/library/catalog/batteries';
import { breakerTripTime } from '../../../src/library/catalog/protection';
import { fuseMeltTime } from '../../../src/library/catalog/protection';
import { lowerValues, readSignal } from '../../../src/ui/integration/live';
import * as S from '../../../src/ui/integration/learnSamples';

beforeAll(async () => {
  await loadAllGroups();
});

function run(d: Design, spec: AnalysisSpec): AnalysisResult {
  const nb = buildNetlist(d, { includeAnalysis: false });
  expect(nb.erc.map((m) => `${m.severity}: ${m.message}`)).toEqual([]);
  const r = runAnalyses({ ...nb.netlist, analyses: [spec] })[0];
  expect(r.error).toBeUndefined();
  return r;
}

const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no vector ${name} in ${r.vectors.map((x) => x.name).join(' ')}`);
  return v;
};
const mag = (r: AnalysisResult, name: string, k: number) => {
  const v = vec(r, name);
  return Math.hypot(v.re[k], v.im?.[k] ?? 0);
};
/** Index of the AC point nearest to f. */
const near = (r: AnalysisResult, f: number) => {
  const x = r.scale!.re;
  let best = 0;
  for (let i = 0; i < x.length; i++) if (Math.abs(Math.log(x[i] / f)) < Math.abs(Math.log(x[best] / f))) best = i;
  return best;
};
const valueAt = (r: AnalysisResult, name: string, t: number) => {
  const x = r.scale!.re;
  const v = vec(r, name).re;
  for (let i = 1; i < x.length; i++) if (x[i] >= t) return v[i - 1] + ((t - x[i - 1]) / (x[i] - x[i - 1])) * (v[i] - v[i - 1]);
  return v[v.length - 1];
};
/** Frequency of rising crossings of `level` after time `from`. */
function frequency(r: AnalysisResult, name: string, level: number, from: number): number {
  const t = r.scale!.re;
  const w = vec(r, name).re;
  const xs: number[] = [];
  for (let i = 1; i < w.length; i++) if (t[i] >= from && w[i - 1] < level && w[i] >= level) xs.push(t[i - 1] + ((level - w[i - 1]) / (w[i] - w[i - 1])) * (t[i] - t[i - 1]));
  return xs.length < 2 ? 0 : (xs.length - 1) / (xs[xs.length - 1] - xs[0]);
}
const crossing = (r: AnalysisResult, name: string, level: number, falling = true): number => {
  const t = r.scale!.re;
  const w = vec(r, name).re;
  for (let i = 1; i < w.length; i++) if (falling ? w[i - 1] >= level && w[i] < level : w[i - 1] < level && w[i] >= level) return t[i - 1] + ((level - w[i - 1]) / (w[i] - w[i - 1])) * (t[i] - t[i - 1]);
  return NaN;
};
const peakAfter = (r: AnalysisResult, name: string, from: number) => {
  const t = r.scale!.re;
  const w = vec(r, name).re;
  let m = 0;
  for (let i = 0; i < t.length; i++) if (t[i] >= from) m = Math.max(m, Math.abs(w[i]));
  return m;
};

describe('90 hand-out: two filters and a saved print setup', () => {
  it('both filters pass 1/sqrt(2) at fc = 1/(2 pi R C), one low-pass and one high-pass', () => {
    const d = S.handoutSample();
    const r = run(d, { type: 'ac', sweep: 'dec', points: 200, fstart: 10, fstop: 1e5 });
    const fc = 1 / (2 * Math.PI * 1000 * 159e-9);
    expect(S.HANDOUT_FC).toBeCloseTo(fc, 6);
    const k = near(r, fc);
    const f = r.scale!.re[k];
    const lp = 1 / Math.sqrt(1 + (f / fc) ** 2);
    const hp = f / fc / Math.sqrt(1 + (f / fc) ** 2);
    expect(mag(r, 'V(OUT)', k)).toBeCloseTo(lp, 3);
    expect(mag(r, 'V(OUT_2)', k)).toBeCloseTo(hp, 3);
    // low frequencies: the low-pass passes, the high-pass blocks; the other way round at 100 kHz
    expect(mag(r, 'V(OUT)', 0)).toBeGreaterThan(0.99);
    expect(mag(r, 'V(OUT_2)', 0)).toBeLessThan(0.02);
    const last = r.scale!.re.length - 1;
    expect(mag(r, 'V(OUT_2)', last)).toBeGreaterThan(0.99);
  });

  it('keeps its page setup and layers through a save and reopen', () => {
    const d = S.handoutSample();
    const back = parseDesign(serializeDesign(d));
    expect(back.printSetup).toEqual({ paper: 'A4', orientation: 'landscape', scale: 'fit', sheets: 'all', includeInstruments: true, footer: true, marginMm: 12 });
    expect(back.sheets.map((s) => s.layers?.netNames)).toEqual([true, true]);
    expect(back.sheets).toHaveLength(2);
  });
});

describe('91 two copies of a block with a meter each', () => {
  it('the meters are named by path and read 5 V * RB / (1k + RB)', () => {
    const d = S.blockMetersSample();
    const nb = buildNetlist(d, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(nb.instruments.map((i) => i.refdes).sort()).toEqual(['X1.XMM1', 'X2.XMM1']);
    const r = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] })[0];
    const values = lowerValues(Object.fromEntries(r.vectors.map((v) => [v.name, v.re[0]])));
    const read = (name: string) => readSignal(nb.instruments.find((i) => i.refdes === name)!.channels.v, values)!;
    expect(read('X1.XMM1')).toBeCloseTo((5 * 1000) / (1000 + 1000), 4);
    expect(read('X2.XMM1')).toBeCloseTo((5 * 3000) / (1000 + 3000), 4);
  });
});

describe('92 .step on a schematic', () => {
  it('draws one AC run per Rx with the corner frequency 1/(2 pi Rx C)', () => {
    const d = S.stepSweepSample();
    const nb = buildNetlist(d, { includeAnalysis: false });
    expect(nb.erc).toEqual([]);
    const out = applySteps(d, d.analysis.specs.ac!, (n) => ({ ...n, analyses: [] }));
    expect(out.errors).toEqual([]);
    expect(out.stepped).toBe(true);
    const [result] = runAnalyses({ ...nb.netlist, analyses: [out.spec] });
    expect(result.error).toBeUndefined();
    expect(result.runs).toHaveLength(3);
    const corner = (res: AnalysisResult): number => {
      const f = res.scale!.re;
      const v = vec(res, 'V(OUT)');
      const m = Array.from(f, (_, k) => Math.hypot(v.re[k], v.im![k]));
      const target = m[0] * Math.SQRT1_2;
      for (let k = 1; k < f.length; k++) if (m[k] <= target) return f[k - 1] * Math.pow(f[k] / f[k - 1], (m[k - 1] - target) / (m[k - 1] - m[k]));
      return NaN;
    };
    [1000, 2200, 4700].forEach((rx, k) => {
      const want = 1 / (2 * Math.PI * rx * 100e-9);
      expect(corner(result.runs![k].result) / want).toBeGreaterThan(0.97);
      expect(corner(result.runs![k].result) / want).toBeLessThan(1.03);
    });
  });
});

describe('93 8051 with an exact delay', () => {
  it('the core toggles P1.0 every 1000 machine cycles', () => {
    const build = buildProgram(S.DEBUG_PROGRAM);
    expect(build.asmErrors).toEqual([]);
    const cpu = new Cpu8051();
    cpu.loadCode(build.bytes);
    const p1 = () => cpu.sfr[SFR.P1 - 0x80] & 1;
    const edges: number[] = [];
    let last = p1();
    for (let i = 0; i < 4000 && edges.length < 5; i++) {
      cpu.step();
      if (p1() !== last) {
        last = p1();
        edges.push(cpu.cycles);
      }
    }
    expect(edges).toHaveLength(5);
    for (let k = 1; k < edges.length; k++) expect(edges[k] - edges[k - 1]).toBe(S.DEBUG_HALF_PERIOD_CYCLES);
  });

  it('the circuit shows 500 Hz at the pin (1 ms half period at 12 MHz)', () => {
    const d = S.mcuDebugSample();
    const r = run(d, { type: 'tran', tstep: 1e-5, tstop: 1e-2 });
    expect(frequency(r, 'V(P1_0)', 2.5, 1e-3) / 500).toBeGreaterThan(0.98);
    expect(frequency(r, 'V(P1_0)', 2.5, 1e-3) / 500).toBeLessThan(1.02);
  });
});

describe('94 battery runtime', () => {
  const r = () => run(S.batteryRuntimeSample(), { type: 'tran', tstep: 2, tstop: 420 });

  it('a constant current empties a 5 mAh cell after C * 3600 / I = 360 s, linearly', () => {
    expect(batteryRuntime(0.005, 0.05)).toBe(360);
    const res = r();
    for (const t of [60, 120, 180, 240, 300]) expect(valueAt(res, 'V(BT1.soc)', t)).toBeCloseTo(1 - t / 360, 2);
    expect(valueAt(res, 'V(BT1.soc)', 400)).toBeLessThan(0.01);
  });

  it('the resistor load draws less as the voltage sags, so it lasts longer', () => {
    const res = r();
    // both start at about 50 mA; the resistor-loaded cell drains ever more slowly
    for (const [t, gap] of [[120, 0.005], [240, 0.03], [330, 0.05]] as const) expect(valueAt(res, 'V(BT2.soc)', t)).toBeGreaterThan(valueAt(res, 'V(BT1.soc)', t) + gap);
    expect(valueAt(res, 'V(BT2.soc)', 380)).toBeGreaterThan(0.02);
    // and the terminal voltage of the resistor-loaded cell falls with the charge
    expect(valueAt(res, 'V(P2)', 300)).toBeLessThan(valueAt(res, 'V(P2)', 10) - 0.2);
  });
});

describe('95 a 7474 in two sections', () => {
  it('Q1 = f/2 and Q2 = f/4 of the 1 kHz clock', () => {
    const d = S.dividerSectionsSample();
    const refs = d.sheets[0].parts.filter((p) => p.refdes === 'U1');
    expect(refs).toHaveLength(2);
    const res = run(d, { type: 'tran', tstep: 1e-5, tstop: 1e-2 });
    expect(frequency(res, 'V(Q1)', 2.5, 1e-3)).toBeGreaterThan(480);
    expect(frequency(res, 'V(Q1)', 2.5, 1e-3)).toBeLessThan(520);
    expect(frequency(res, 'V(Q2)', 2.5, 1e-3)).toBeGreaterThan(240);
    expect(frequency(res, 'V(Q2)', 2.5, 1e-3)).toBeLessThan(260);
  });
});

describe('96 line transformer regulation', () => {
  it('reads 12 V RMS at the rated load and 12 V * 1.15 unloaded (peak values)', () => {
    const res = run(S.transformerRegulationSample(), { type: 'tran', tstep: 2e-4, tstop: 0.12 });
    const loaded = peakAfter(res, 'V(S1)', 0.08) / Math.SQRT2;
    const open = peakAfter(res, 'V(S2)', 0.08) / Math.SQRT2;
    expect(loaded / 12).toBeGreaterThan(0.98);
    expect(loaded / 12).toBeLessThan(1.02);
    expect(open / (12 * 1.15)).toBeGreaterThan(0.98);
    expect(open / (12 * 1.15)).toBeLessThan(1.02);
    // regulation = (Vs0 - Vs) / Vs = 15 %
    expect((open - loaded) / loaded).toBeGreaterThan(0.13);
    expect((open - loaded) / loaded).toBeLessThan(0.17);
  });
});

describe('97 fuse against breaker', () => {
  it('the fuse blows near I2t / (I^2 - Imin^2) and the breaker near tau ln(m^2 / (m^2 - 1.3^2))', () => {
    const res = run(S.fuseBreakerSample(), { type: 'tran', tstep: 5e-4, tstop: 1 });
    const f = S.FUSE_SAMPLE;
    const tFuse = fuseMeltTime(24 / 2.4, f.kmin * f.in, f.i2t);
    const tBreaker = breakerTripTime('C', 24 / 2.4 / 2);
    expect(tFuse).toBeCloseTo(0.5 / (100 - 9), 6);
    expect(tBreaker).toBeCloseTo(10 * Math.log(25 / (25 - 1.69)), 6);
    const fuse = crossing(res, 'V(L1)', 12);
    const breaker = crossing(res, 'V(L2)', 12);
    expect(fuse / tFuse).toBeGreaterThan(0.85);
    expect(fuse / tFuse).toBeLessThan(1.15);
    expect(breaker / tBreaker).toBeGreaterThan(0.92);
    expect(breaker / tBreaker).toBeLessThan(1.08);
    // the fuse acts about 100 times faster
    expect(breaker / fuse).toBeGreaterThan(50);
  });
});

describe('98 replay of a recorded waveform', () => {
  it('the source passes through the samples of the file and interpolates linearly between them', () => {
    const res = run(S.measurementReplaySample(), { type: 'tran', tstep: 5e-5, tstop: 0.01 });
    expect(valueAt(res, 'V(SENS)', 0.001)).toBeCloseTo(0.2, 3);
    expect(valueAt(res, 'V(SENS)', 0.002)).toBeCloseTo(1.8, 3);
    expect(valueAt(res, 'V(SENS)', 0.0025)).toBeCloseTo(1.95, 2);
    expect(valueAt(res, 'V(SENS)', 0.01)).toBeCloseTo(2, 3);
  });

  it('the RC filter (tau = 1 ms) settles on the 2 V plateau', () => {
    const res = run(S.measurementReplaySample(), { type: 'tran', tstep: 5e-5, tstop: 0.01 });
    // the input is 2 V +/- 0.1 V from 3 ms on: 7 tau later the output is within 0.1 V of it
    expect(valueAt(res, 'V(OUT)', 0.01)).toBeGreaterThan(1.85);
    expect(valueAt(res, 'V(OUT)', 0.01)).toBeLessThan(2.05);
    // at t = 1 ms the input has only reached 0.2 V, so the output is still far below it
    expect(valueAt(res, 'V(OUT)', 0.001)).toBeLessThan(0.2);
  });
});

describe('the files in examples/ are the builders output', () => {
  const DIR = fileURLToPath(new URL('../../../examples/', import.meta.url));
  for (const [file, build] of Object.entries(S.LEARN_SAMPLE_BUILDERS)) {
    it(`${file} is up to date`, () => {
      expect(readFileSync(DIR + file, 'utf8')).toBe(serializeDesign(build()));
    });
  }
});
