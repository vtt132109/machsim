/**
 * The sample circuits show what their notes promise: each check compares a simulated number with
 * the textbook formula quoted on the sample's sheet.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../src/model/netlister';
import { parseDesign } from '../src/model/serialize';
import { runAnalyses } from '../src/sim';
import { parseSpice } from '../src/sim/spice';
import type { AnalysisResult } from '../src/sim/results';
import type { AnalysisType } from '../src/sim/netlist';

const DIR = fileURLToPath(new URL('../examples/', import.meta.url));

function run(file: string, type: AnalysisType): AnalysisResult {
  const design = parseDesign(readFileSync(DIR + file, 'utf8'));
  const build = buildNetlist(design, { includeAnalysis: false });
  const [r] = runAnalyses({ ...build.netlist, analyses: [design.analysis.specs[type]!] });
  expect(r.error, `${file} ${type}`).toBeUndefined();
  return r;
}

function vec(r: AnalysisResult, name: string) {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name} in ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
}

/** Value at the first sample at or after x (dB for complex vectors). */
function at(r: AnalysisResult, name: string, x: number): number {
  const s = r.scale!.re;
  const v = vec(r, name);
  let i = 0;
  while (i < s.length - 1 && s[i] < x) i++;
  return v.im ? 20 * Math.log10(Math.hypot(v.re[i], v.im[i])) : v.re[i];
}

/** Times at which a vector crosses `level` in either direction. */
function crossings(r: AnalysisResult, name: string, level: number): number[] {
  const t = r.scale!.re;
  const v = vec(r, name).re;
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const a = v[i - 1];
    const b = v[i];
    if ((a < level && b >= level) || (a > level && b <= level)) out.push(t[i - 1] + ((level - a) / (b - a)) * (t[i] - t[i - 1]));
  }
  return out;
}

function span(r: AnalysisResult, name: string, from: number, to: number): [number, number] {
  const s = r.scale!.re;
  const v = vec(r, name);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < s.length; i++) if (s[i] >= from && s[i] <= to) {
    lo = Math.min(lo, v.re[i]);
    hi = Math.max(hi, v.re[i]);
  }
  return [lo, hi];
}

describe('sample circuits match their formulas', () => {
  it("Ohm's law and series / parallel resistors", () => {
    // 9 mA through R1 plus 0.9 µA through the 10 MΩ voltmeter
    expect(run('11-ohms-law.msim', 'op').scalars!['I(V1)']).toBeCloseTo(-(9e-3 + 9 / 10e6), 9);
    expect(run('12-series-parallel.msim', 'op').scalars!['V(MID)']).toBeCloseTo(6, 4);
    expect(run('15-wheatstone-bridge.msim', 'op').scalars!['V(B)'] - run('15-wheatstone-bridge.msim', 'op').scalars!['V(A)']).toBeCloseTo(10 * (1.2 / 2.2 - 0.5), 3);
  });

  it('RC charging reaches 63 % after one time constant, RLC peaks at f0', () => {
    expect(at(run('13-rc-charging.msim', 'tran'), 'V(VC)', 0.1) / 5).toBeCloseTo(1 - Math.exp(-1), 2);
    const ac = run('14-rlc-resonance.msim', 'ac');
    const f0 = 1 / (2 * Math.PI * Math.sqrt(10e-3 * 1e-6));
    expect(at(ac, 'V(OUT)', f0)).toBeGreaterThan(-1);
    expect(at(ac, 'V(OUT)', f0 / 4)).toBeLessThan(-20);
  });

  it('Zener regulator holds 5.1 V; the 7805 holds 5 V above its dropout', () => {
    expect(at(run('17-zener-regulator.msim', 'dc'), 'V(OUT)', 12)).toBeCloseTo(5.1, 0);
    const dc = run('31-regulator-7805.msim', 'dc');
    expect(at(dc, 'V(VOUT)', 12)).toBeCloseTo(5, 2);
    expect(at(dc, 'V(VOUT)', 5)).toBeLessThan(4.5);
  });

  it('op-amp samples: summing −3 V, non-inverting gain 10, integrator 0.5 Vpp triangle', () => {
    expect(run('21-summing-amplifier.msim', 'op').scalars!['V(OUT)']).toBeCloseTo(-3, 1);
    const [lo, hi] = span(run('20-non-inverting-amplifier.msim', 'tran'), 'V(OUT)', 2e-3, 5e-3);
    expect(hi).toBeCloseTo(1, 1);
    expect(lo).toBeCloseTo(-1, 1);
    const tri = span(run('22-integrator.msim', 'tran'), 'V(OUT)', 5e-3, 1e-2);
    expect(tri[1] - tri[0]).toBeCloseTo(0.5, 1);
  });

  it('555 one-shot pulse lasts 1.1·R·C', () => {
    const r = run('27-555-monostable.msim', 'tran');
    const s = r.scale!.re;
    const out = vec(r, 'V(OUT)').re;
    let first = -1;
    let last = -1;
    for (let i = 0; i < s.length && s[i] < 0.3; i++) if (out[i] > 4.5) {
      if (first < 0) first = s[i];
      last = s[i];
    }
    expect((last - first) / (1.1 * 100e3 * 1e-6)).toBeCloseTo(1, 1);
  });

  it('power samples: doubler ≈ 2·Vp − 2·Vd, full-wave ≈ Vp − Vd', () => {
    const [, dbl] = span(run('32-voltage-doubler.msim', 'tran'), 'V(OUT)', 0.04, 0.05);
    expect(dbl).toBeGreaterThan(18);
    expect(dbl).toBeLessThan(19.5);
    const [lo, hi] = span(run('30-full-wave-ct.msim', 'tran'), 'V(OUT)', 0.15, 0.2);
    expect(hi).toBeGreaterThan(14.5);
    expect(hi - lo).toBeLessThan(0.6);
  });

  it('transmission line: half the step first, then Γ = 0.5 comes back after 2·td', () => {
    const r = run('35-transmission-line.msim', 'tran');
    expect(at(r, 'V(NEAR)', 15e-9)).toBeCloseTo(1, 2);
    expect(at(r, 'V(NEAR)', 40e-9)).toBeCloseTo(1.5, 2);
    expect(at(r, 'V(FAR)', 30e-9)).toBeCloseTo(1.5, 2);
  });

  it('analysis samples: three sweep runs, four temperatures with −2 mV/°C, 51 Monte Carlo rows', () => {
    expect(run('39-parameter-sweep.msim', 'paramsweep').runs).toHaveLength(3);
    const temp = run('40-temperature-sweep.msim', 'tempsweep');
    const vd = temp.runs!.map((x) => at(x.result, 'V(VD)', 5));
    expect(vd).toHaveLength(4);
    expect((vd[3] - vd[0]) / 150).toBeCloseTo(-0.002, 3);
    expect(run('41-monte-carlo.msim', 'montecarlo').runs!.length).toBeGreaterThanOrEqual(50);
    expect(run('42-fourier-clipper.msim', 'four').scalars!['THD(V(OUT))']).toBeGreaterThan(10);
  });

  it('hierarchy: block parameters give two gains; the cascade falls at −40 dB/decade', () => {
    const r = run('45-hierarchical-block.msim', 'tran');
    expect(span(r, 'V(OUT1)', 1e-3, 5e-3)[1]).toBeCloseTo(1, 2);
    expect(span(r, 'V(OUT2)', 1e-3, 5e-3)[1]).toBeCloseTo(0.47, 2);
    const ac = run('43-subcircuit-cascade.msim', 'ac');
    const slope = at(ac, 'V(OUT)', 1e5) - at(ac, 'V(OUT)', 1e4);
    expect(slope).toBeGreaterThan(-41);
    expect(slope).toBeLessThan(-38);
  });

  it('round 3: the block loop reaches 63 % at 2 ms (.meas), the isolated secondary gives 5 V peak against its reference, the SPICE family measures 1/(2πRC)', () => {
    const loop = run('46-block-control-loop.msim', 'tran');
    const m = new Map(loop.measurements!.map((x) => [x.name, x.value]));
    expect(m.get('t63')).toBeCloseTo(2e-3, 5);
    expect(m.get('tf63')).toBeCloseTo(2e-3, 5);
    expect(m.get('e2ms')).toBeCloseTo(Math.exp(-1), 3);
    const iso = run('47-reference-ground.msim', 'tran');
    const t = iso.scale!.re;
    const sec = vec(iso, 'V(SEC)').re;
    const ref = vec(iso, 'V(GNDREF1)').re;
    let peak = 0;
    for (let i = 0; i < t.length; i++) if (t[i] > 0.02) peak = Math.max(peak, Math.abs(sec[i] - ref[i]));
    expect(peak).toBeGreaterThan(4.8);
    expect(peak).toBeLessThan(5.05);
    const build = buildNetlist(parseDesign(readFileSync(DIR + '47-reference-ground.msim', 'utf8')));
    expect(build.probes.find((p) => p.name === 'Vsec')?.signal).toEqual({ kind: 'voltage', pos: 'SEC', neg: 'GNDREF1' });
    const deck = parseSpice(readFileSync(DIR + 'spice/meas-step-filter.cir', 'utf8'));
    expect(deck.errors).toEqual([]);
    const [ac] = runAnalyses(deck.netlist);
    const f3 = ac.runs!.map((x) => x.result.measurements!.find((q) => q.name === 'f3db')!.value);
    // 50 points per decade: the crossing is interpolated within 0.1 %
    [1e3, 2e3, 5e3].forEach((r, k) => expect(Math.abs(f3[k] / (1 / (2 * Math.PI * r * 100e-9)) - 1)).toBeLessThan(2e-3));
  });

  it('round 3 real parts: the real capacitor resonates at 1/(2π√(ESL·C)) with ESR/50 Ω at the bottom, the PLL locks with V(VC) = (fin − f0)/kv, the DIP switch lights LEDs 1 and 3', () => {
    const cap = run('48-real-capacitor.msim', 'ac');
    const m = new Map(cap.measurements!.map((x) => [x.name, x.value]));
    const f0 = 1 / (2 * Math.PI * Math.sqrt(2e-9 * 100e-9));
    expect(Math.abs(m.get('fres')! / f0 - 1)).toBeLessThan(0.01);
    // the bottom of V(CR) is ESR/(50 Ω + ESR) ≈ −64.4 dB (50 points per decade sample it within 1 dB)
    expect(m.get('vmin')!).toBeGreaterThan(20 * Math.log10(0.03 / 50.03) - 0.01);
    expect(m.get('vmin')!).toBeLessThan(20 * Math.log10(0.03 / 50.03) + 1);
    // the ideal capacitor keeps falling: at 1 GHz it is far below the real one
    expect(at(cap, 'V(CI)', 1e9)).toBeLessThan(at(cap, 'V(CR)', 1e9) - 30);
    const pll = run('49-pll-lock.msim', 'tran');
    const q = new Map(pll.measurements!.map((x) => [x.name, x.value]));
    expect(q.get('vcavg')!).toBeCloseTo((10.3e3 - 10e3) / 2e3, 2);
    expect(q.get('tper')! * 10.3e3).toBeCloseTo(1, 3);
    const dip = run('50-dip-switch-leds.msim', 'tran');
    const last = (name: string) => vec(dip, name).re[vec(dip, name).re.length - 1];
    const i = (k: number) => (last(`V(S${k})`) - last(`V(L${k})`)) / 330;
    expect(i(1)).toBeGreaterThan(8e-3);
    expect(i(1)).toBeLessThan(10e-3);
    expect(i(3)).toBeGreaterThan(8e-3);
    expect(Math.abs(i(2))).toBeLessThan(1e-6);
    expect(Math.abs(i(4))).toBeLessThan(1e-6);
  });
  it('round 3 microcontroller samples: the blink period is the machine-cycle count, the counter steps every half second, and the serial sample sends "Hello MachSim" at 9600 baud', () => {
    // 51: CPL (1) + ACALL (2) + [MOV R7 (1) + 200 x (MOV R6 (1) + 250 x DJNZ R6 (2) + DJNZ R7 (2)) + RET (2)] + SJMP (2)
    // = 1 + 2 + 1 + 200 * 503 + 2 + 2 = 100608 machine cycles of 1 us per half period
    const blink = run('51-mcu-blink.msim', 'tran');
    const half = 100608e-6;
    const edges = crossings(blink, 'V(P1_0)', 2.5);
    expect(edges.length).toBeGreaterThan(8);
    for (let i = 2; i < edges.length; i++) expect(Math.abs((edges[i] - edges[i - 1]) / half - 1)).toBeLessThan(0.01);

    // 52: timer 0 reloads 65536 - 50000 counts, so an interrupt every 50 ms; ten of them step the digit
    const seg = run('52-mcu-seven-segment.msim', 'tran');
    const digitAt = (t: number): number => {
      let code = 0;
      for (let k = 0; k < 7; k++) if (at(seg, `V(S${k})`, t) < 2.5) code |= 1 << k;
      return code;
    };
    // the common-anode codes of 0, 1 and 2 are the complements of 3Fh, 06h and 5Bh
    expect(digitAt(0.2)).toBe(0x3f);
    expect(digitAt(0.7)).toBe(0x06);
    expect(digitAt(1.2)).toBe(0x5b);
    expect(digitAt(2.2)).toBe(0x66); // 4 after four steps

    // 54: 9600 baud with an 11.0592 MHz crystal is 32 x 3 = 96 machine cycles per bit = 104.17 us
    const ser = run('54-mcu-serial.msim', 'tran');
    const bit = (96 * 12) / 11.0592e6;
    const starts = crossings(ser, 'V(TXD)', 2.5).filter((_t, i) => true);
    expect(starts.length).toBeGreaterThan(4);
    // the first falling edge is the start bit of 'H' = 48h = 0100 1000: bits 3 and 6 are 1
    const t0 = starts[0];
    const sample = (k: number) => at(ser, 'V(TXD)', t0 + (k + 0.5) * bit);
    const frame = Array.from({ length: 10 }, (_x, k) => (sample(k) > 2.5 ? 1 : 0));
    expect(frame).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 0, 1]);
  });
  it('round 3 automation samples: the traffic phases follow the cycle timer, the tank stops at its high switch, and the start / stop rung holds itself', () => {
    // 56: one 20 s cycle timer; 0-8 s north-south green, 8-10 s amber, 10-18 s east-west green,
    // 18-20 s east-west amber, and the junction model never reports an unsafe combination
    const tr = run('56-ladder-traffic.msim', 'tran');
    const hi = (name: string, t: number) => at(tr, name, t) > 12;
    expect(hi('V(NSG)', 4)).toBe(true);
    expect(hi('V(EWR)', 4)).toBe(true);
    expect(hi('V(NSY)', 9)).toBe(true);
    expect(hi('V(EWG)', 14)).toBe(true);
    expect(hi('V(NSR)', 14)).toBe(true);
    expect(hi('V(EWY)', 19)).toBe(true);
    // the cycle restarts: 1 s after the end of the cycle it is north-south green again
    expect(hi('V(NSG)', 21)).toBe(true);
    // ERR stays dark for the whole run
    for (const t of [1, 5, 9, 11, 15, 19, 21]) expect(at(tr, 'V(ERR)', t)).toBeLessThan(1);

    // 57: 10 L at 0.5 L/s reaches the 80 % high switch after 16 s and the pump rests there
    const tank = run('57-ladder-tank.msim', 'tran');
    expect(at(tank, 'V(PUMP)', 5)).toBeGreaterThan(20);
    expect(at(tank, 'V(TK1.percent)', 8)).toBeCloseTo(40, 0);
    const off = crossings(tank, 'V(PUMP)', 12).filter((t) => t > 1);
    expect(off[0]).toBeCloseTo(16, 1);
    expect(at(tank, 'V(PUMP)', 20)).toBeLessThan(1);
    expect(at(tank, 'V(TK1.percent)', 20)).toBeCloseTo(80, 0);
    // the level transmitter reads 8 V at 80 % of its 10 V full scale, so the alarm stays off
    expect(at(tank, 'V(LVL)', 20)).toBeCloseTo(8, 1);
    expect(at(tank, 'V(ALARM)', 20)).toBeLessThan(1);

    // 55: the program itself is the proof of the self-holding rung: (I0.0 OR Q0.0) AND I0.1
    const start = parseDesign(readFileSync(DIR + '55-ladder-start-stop.msim', 'utf8'));
    const build = buildNetlist(start, { includeAnalysis: false });
    expect(build.ladder?.errors).toEqual([]);
    const expr = build.ladder!.ir.rungs[0].expr!;
    expect(expr.k).toBe('and');
    const items = expr.k === 'and' ? expr.items : [];
    const held = items.find((x) => x.k === 'or');
    expect(held?.k === 'or' && held.items.some((x) => x.k === 'bit' && x.ref.area === 'Q')).toBe(true);
    // with the start button held down the contactor comes on within two scans and stays on
    const pressed = parseDesign(readFileSync(DIR + '55-ladder-start-stop.msim', 'utf8'));
    const s1 = pressed.sheets[0].parts.find((x) => x.refdes === 'S1')!;
    s1.params = { ...s1.params, pressed: 'true' };
    const pb = buildNetlist(pressed, { includeAnalysis: false });
    const [res] = runAnalyses({ ...pb.netlist, analyses: [{ type: 'tran', tstep: 2e-3, tstop: 0.5 }] });
    expect(res.error).toBeUndefined();
    expect(at(res, 'V(KM1)', 0.05)).toBeGreaterThan(20);
    expect(at(res, 'V(KM1)', 0.45)).toBeGreaterThan(20);
  });
});
