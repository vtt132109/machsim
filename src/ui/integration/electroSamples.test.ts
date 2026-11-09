/**
 * The round-4 samples do what their descriptions say (the generic sample tests only check that they
 * load, pass ERC and run): the contactor circuit pulls in and the overload relay drops it, the timer
 * lamps switch at the times named, and the speaker sample carries the two tones.
 */
import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../../model/netlister';
import type { Design } from '../../model/types';
import { runAnalyses } from '../../sim';
import type { AnalysisResult } from '../../sim/results';
import { overloadTripTime } from '../../library/catalog/relays';
import { contactorStartStopSample, speakerFilterSample, timerRelaysSample } from './electroSamples';
import { loadAllGroups } from '../../library';

await loadAllGroups();

function tran(design: Design): AnalysisResult {
  const nb = buildNetlist(design, { includeAnalysis: false });
  expect(nb.erc.map((m) => `${m.severity}: ${m.message}`)).toEqual([]);
  const spec = design.analysis.specs.tran!;
  const [r] = runAnalyses({ ...nb.netlist, analyses: [spec] });
  expect(r.error).toBeUndefined();
  return r;
}

const vec = (r: AnalysisResult, name: string): Float64Array => r.vectors.find((v) => v.name.toLowerCase() === name.toLowerCase())!.re;

function crossing(r: AnalysisResult, name: string, level: number, dir: 1 | -1): number {
  const t = r.scale!.re;
  const v = vec(r, name);
  for (let i = 1; i < v.length; i++) if ((dir === 1 && v[i - 1] < level && v[i] >= level) || (dir === -1 && v[i - 1] > level && v[i] <= level)) return t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]);
  return Number.NaN;
}

describe('sample 70: start-stop contactor', () => {
  const pressed = (key: 'S1' | 'S2'): Design => {
    const d = contactorStartStopSample();
    for (const s of d.sheets) for (const p of s.parts) if (p.refdes === key) p.params.pressed = 'true';
    return d;
  };

  it('keeps the coil and the motor leads dead until Start is pressed', () => {
    const d = contactorStartStopSample();
    d.analysis.specs.tran = { type: 'tran', tstep: 1e-3, tstop: 0.2 };
    const r = tran(d);
    expect(Math.max(...vec(r, 'V(C)'))).toBeLessThan(0.1);
    expect(Math.max(...vec(r, 'V(M2)'))).toBeLessThan(0.1);
  });

  it('Start pulls the contactor in across the sheets, the stop button (normally closed) drops it', () => {
    const d = pressed('S1');
    d.analysis.specs.tran = { type: 'tran', tstep: 1e-3, tstop: 0.3 };
    const r = tran(d);
    expect(vec(r, 'V(C)')[vec(r, 'V(C)').length - 1]).toBeGreaterThan(23);
    // the power sheet's contact followed the coil of the other sheet: the locked load draws ≈ 12 V × 6 A
    expect(vec(r, 'V(M2)')[vec(r, 'V(M2)').length - 1]).toBeGreaterThan(11.5);
    const both = pressed('S1');
    for (const s of both.sheets) for (const p of s.parts) if (p.refdes === 'S2') p.params.pressed = 'true';
    both.analysis.specs.tran = { type: 'tran', tstep: 1e-3, tstop: 0.3 };
    const stop = tran(both);
    expect(Math.max(...vec(stop, 'V(C)'))).toBeLessThan(0.1);
  });

  it('the jammed 6 A load trips the overload relay after τ·ln(m² / (m² − 1.2)) and the coil drops out', () => {
    const d = pressed('S1');
    d.analysis.specs.tran = { type: 'tran', tstep: 5e-3, tstop: 9 };
    const r = tran(d);
    const m2 = vec(r, 'V(M2)');
    const current = m2[10] / 1.99;
    expect(current).toBeGreaterThan(5.5);
    const expected = overloadTripTime('10A', current / 1);
    const drop = crossing(r, 'V(C)', 12, -1);
    expect(drop / expected).toBeGreaterThan(0.95);
    expect(drop / expected).toBeLessThan(1.1);
    expect(vec(r, 'V(M2)')[m2.length - 1]).toBeLessThan(0.1);
  });
});

describe('sample 71: timer relays', () => {
  it('the on-delay lamp lights 3 s after the coil, the off-delay lamp at once and stays on 3 s after release', () => {
    const r = tran(timerRelaysSample());
    const on = crossing(r, 'V(L1)', 12, 1);
    expect(on).toBeGreaterThan(3.95);
    expect(on).toBeLessThan(4.1);
    const off1 = crossing(r, 'V(L2)', 12, 1);
    expect(off1).toBeGreaterThan(0.99);
    expect(off1).toBeLessThan(1.1);
    const off2 = crossing(r, 'V(L2)', 12, -1);
    expect(off2).toBeGreaterThan(8.95);
    expect(off2).toBeLessThan(9.1);
    // the on-delay lamp goes out at once when the coil is released at 6 s
    const gone = crossing(r, 'V(L1)', 12, -1);
    expect(gone).toBeGreaterThan(6);
    expect(gone).toBeLessThan(6.1);
  });
});

describe('sample 72: speaker behind an RC low-pass', () => {
  it('the speaker voltage holds the 440 Hz tone at full size and the 3 kHz tone at ≈ 47 %', () => {
    const d = speakerFilterSample();
    const nb = buildNetlist(d, { includeAnalysis: false });
    // the output of the filter at the two tones (V1 and V2 carry AC magnitude 1 each)
    const gain = (r: AnalysisResult) => Math.hypot(r.vectors.find((v) => v.name === 'V(OUT)')!.re[0], r.vectors.find((v) => v.name === 'V(OUT)')!.im?.[0] ?? 0);
    const res = runAnalyses({ ...nb.netlist, analyses: [{ type: 'acsingle', freq: 440 }] });
    const res2 = runAnalyses({ ...nb.netlist, analyses: [{ type: 'acsingle', freq: 3000 }] });
    // both sources contribute their AC magnitude of 1: compare the magnitudes against the RC response
    const h = (f: number) => 1 / Math.hypot(1, (2 * Math.PI * f * 1e3 * 100e-9));
    expect(gain(res[0])).toBeGreaterThan(0.95 * 2 * h(440));
    expect(gain(res[0])).toBeLessThan(1.05 * 2 * h(440));
    expect(gain(res2[0]) / gain(res[0])).toBeCloseTo(h(3000) / h(440), 2);
    // and the transient keeps the sound within the speaker's range
    const r = tran(d);
    const out = vec(r, 'V(OUT)');
    expect(Math.max(...out)).toBeGreaterThan(1.5);
    expect(Math.max(...out)).toBeLessThan(3.2);
    expect(nb.indicators.some((i) => i.kind === 'speaker' && i.refdes === 'LS1')).toBe(true);
  });
});
