/**
 * Review: convergence on hard circuits (positive feedback, bistability, large capacitors,
 * relaxation and ring oscillators) — each run must complete without error AND give the
 * physically right answer.
 *
 * References:
 * - Inverting Schmitt trigger built from an ideal tanh amplifier o' = 5·tanh(G·(V(p) − V(in)))
 *   with output divider k = RL/(RL+Ro) and feedback β = 1/2: the static transfer curve has
 *   folds where 1 = k·5·G·β·sech²(u). The switching inputs are ±(o_f·β − atanh(t_f)/G) with
 *   t_f = √(1 − 1/(k·5·G·β)), o_f = k·5·t_f (computed below, ≈ ±2.376 V).
 * - Bistable CMOS latch: .nodeset must select the state; a transient with .ic must hold it.
 * - Bridge rectifier, 2200 µF: ripple ≈ I_load/(2·f·C) (valid when ripple ≪ Vpeak).
 * - 555 astable: t_high = ln2·(RA+RB)·C, t_low = ln2·(RB+Rdis)·C with the model's 10 Ω
 *   discharge switch — frequency to 2 % (comparator gain 200 /V gives ~mV threshold shifts).
 * - Ring of three ideal digital inverters with 10 ns delay: period exactly 2·3·10 ns.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../../../src/sim';
import { parseSpice } from '../../../src/sim/spice';
import { getPart } from '../../../src/library';
import { crossTimes, interp, opValue, rel, runDeck, scaleOf, vec } from './ref';

describe('Schmitt trigger with positive feedback', () => {
  const G = 1000;
  const k = 20 / 21; // RL = R1 + R2 = 20k, Ro = 1k
  const beta = 0.5;
  const tf = Math.sqrt(1 - 1 / (k * 5 * G * beta));
  const of = k * 5 * tf;
  const vth = of * beta - Math.atanh(tf) / G;
  const deck = (analysis: string) => `schmitt
VIN in 0 DC 0 PULSE(-5 5 0 0.5m 0.5m 1n 1m)
B1 ob 0 V=5*tanh(${G}*(V(p)-V(in)))
RO ob o 1k
CO o 0 10p
R1 o p 10k
R2 p 0 10k
${analysis}
.end`;

  it('reference threshold is ≈ 2.376 V', () => {
    expect(vth).toBeGreaterThan(2.37);
    expect(vth).toBeLessThan(2.385);
  });

  it('transient on a ±5 V triangle switches at ±Vth (±15 mV)', () => {
    const [r] = runDeck(deck('.tran 1u 3m'));
    const t = scaleOf(r);
    const vo = vec(r, 'V(o)').re;
    const vin = vec(r, 'V(in)').re;
    const falls = crossTimes(t, vo, 0, 'fall');
    const rises = crossTimes(t, vo, 0, 'rise');
    expect(falls.length).toBeGreaterThanOrEqual(2);
    expect(rises.length).toBeGreaterThanOrEqual(2);
    for (const tc of falls) expect(Math.abs(interp(t, vin, tc) - vth), `fall at ${tc}`).toBeLessThan(15e-3);
    for (const tc of rises) expect(Math.abs(interp(t, vin, tc) + vth), `rise at ${tc}`).toBeLessThan(15e-3);
  });

  it('DC sweeps up and down show the hysteresis (continuation follows each branch)', () => {
    const [up] = runDeck(deck('.dc VIN -5 5 0.01'));
    const [down] = runDeck(deck('.dc VIN 5 -5 -0.01'));
    const fall = crossTimes(scaleOf(up), vec(up, 'V(o)').re, 0, 'fall');
    expect(fall.length).toBe(1);
    expect(Math.abs(fall[0] - vth)).toBeLessThan(0.015);
    // sweeping down the scale decreases: reverse it for the crossing helper
    const sd = Array.from(scaleOf(down)).reverse();
    const vd = Array.from(vec(down, 'V(o)').re).reverse();
    const rise = crossTimes(sd, vd, 0, 'fall'); // in ascending-input order the output falls at −Vth
    expect(rise.length).toBe(1);
    expect(Math.abs(rise[0] + vth)).toBeLessThan(0.015);
  });
});

describe('bistable CMOS latch', () => {
  const latch = (extra: string) => `latch
VDD vdd 0 5
M1 qb q 0 0 NM W=10u L=1u
M2 qb q vdd vdd PM W=20u L=1u
M3 q qb 0 0 NM W=10u L=1u
M4 q qb vdd vdd PM W=20u L=1u
.model NM NMOS(LEVEL=1 VTO=0.8 KP=100u LAMBDA=0.01)
.model PM PMOS(LEVEL=1 VTO=-0.8 KP=50u LAMBDA=0.01)
${extra}
.end`;

  it('.nodeset V(q)=5 selects q high / qb low', () => {
    const [r] = runDeck(latch('.nodeset V(q)=5 V(qb)=0\n.op'));
    expect(opValue(r, 'V(q)')).toBeGreaterThan(4.99);
    expect(opValue(r, 'V(qb)')).toBeLessThan(0.01);
  });

  it('.nodeset V(q)=0 selects the other state', () => {
    const [r] = runDeck(latch('.nodeset V(q)=0 V(qb)=5\n.op'));
    expect(opValue(r, 'V(q)')).toBeLessThan(0.01);
    expect(opValue(r, 'V(qb)')).toBeGreaterThan(4.99);
  });

  it('without a nodeset the OP is a valid solution (metastable point or a rail state)', () => {
    const [r] = runDeck(latch('.op'));
    const q = opValue(r, 'V(q)');
    const qb = opValue(r, 'V(qb)');
    const meta = Math.abs(q - qb) < 1e-3;
    const rail = (q > 4.99 && qb < 0.01) || (q < 0.01 && qb > 4.99);
    expect(meta || rail).toBe(true);
  });

  it('transient from .ic holds the state', () => {
    const [r] = runDeck(latch('C1 q 0 10f\nC2 qb 0 10f\n.ic V(q)=0 V(qb)=5\n.tran 1n 100n'));
    const vq = vec(r, 'V(q)').re;
    expect(vq[vq.length - 1]).toBeLessThan(0.01);
  });
});

describe('bridge rectifier with a large reservoir capacitor', () => {
  it('runs 200 ms from power-up; ripple ≈ I/(2fC) within 25 %', () => {
    const [r] = runDeck(`bridge
VAC a b SIN(0 12 50)
RG b 0 1meg
D1 a p DR
D2 b p DR
D3 n a DR
D4 n b DR
C1 p n 2200u
RL p n 100
.model DR D(IS=7.02767n RS=0.0341512 N=1.80803 CJO=10p)
.tran 50u 200m
.end`);
    const t = scaleOf(r);
    const vp = vec(r, 'V(p)').re;
    const vn = vec(r, 'V(n)').re;
    const w: number[] = [];
    for (let i = 0; i < t.length; i++) if (t[i] >= 0.16) w.push(vp[i] - vn[i]);
    const max = Math.max(...w);
    const min = Math.min(...w);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    expect(max).toBeLessThan(12);
    expect(max).toBeGreaterThan(9.5); // two diode drops at the charging peak
    const ref = mean / 100 / (2 * 50 * 2200e-6);
    expect(Math.abs(max - min - ref) / ref).toBeLessThan(0.25);
  });
});

describe('555 astable (library behavioural model)', () => {
  it('frequency = 1/(ln2·(RA + 2RB + 10 Ω)·C) within 2 %', () => {
    const part = getPart('analog/555');
    expect(part?.toSpice).toBeDefined();
    const pins: Record<string, string> = { GND: '0', TRIG: 'cap', OUT: 'out', RST: 'vcc', CTRL: 'cv', THR: 'cap', DIS: 'dis', VCC: 'vcc' };
    const frag = part!.toSpice!({
      refdes: 'U1',
      params: {},
      node: (p) => pins[p],
      num: () => Number.NaN,
      name: (type, suffix) => `${type}U1${suffix ? `_${suffix}` : ''}`,
    });
    const RA = 1e3;
    const RB = 10e3;
    const C = 10e-9;
    const parsed = parseSpice(`astable
VCC vcc 0 9
RA vcc dis ${RA}
RB dis cap ${RB}
C1 cap 0 ${C}
CV cv 0 10n
RL out 0 10k
.tran 0.5u 2m
.end`);
    expect(parsed.errors).toEqual([]);
    const nl = parsed.netlist;
    nl.elements.push(...frag.elements);
    for (const s of frag.subckts ?? []) nl.subckts[s.name.toLowerCase()] = s;
    const [r] = runAnalyses(nl);
    expect(r.error).toBeUndefined();
    const t = scaleOf(r);
    const vo = vec(r, 'V(out)').re;
    const ups = crossTimes(t, vo, 4.5, 'rise').filter((x) => x > 0.5e-3);
    expect(ups.length).toBeGreaterThan(5);
    const period = (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
    const ref = Math.LN2 * (RA + 2 * RB + 10) * C;
    expect(rel(period, ref)).toBeLessThan(0.02);
    // capacitor swings between VCC/3 and 2·VCC/3
    const vc = vec(r, 'V(cap)').re;
    const late: number[] = [];
    for (let i = 0; i < t.length; i++) if (t[i] > 1e-3) late.push(vc[i]);
    expect(Math.max(...late)).toBeCloseTo(6, 1);
    expect(Math.min(...late)).toBeCloseTo(3, 1);
  });
});

describe('ring oscillators', () => {
  it('three ideal digital inverters, 10 ns each: period 60 ns (±0.1 %)', () => {
    const [r] = runDeck(`digital ring
A1 a b inv
A2 b c inv
A3 c a inv
.model inv D_INVERTER(rise_delay=10n fall_delay=10n rise_time=1n fall_time=1n)
.tran 0.1n 1u
.end`);
    const t = scaleOf(r);
    const va = vec(r, 'V(a)').re;
    const ups = crossTimes(t, va, 2.5, 'rise').filter((x) => x > 100e-9);
    expect(ups.length).toBeGreaterThan(10);
    const period = (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
    expect(rel(period, 60e-9)).toBeLessThan(1e-3);
  });

  it('five-stage CMOS ring (level-1 MOSFETs) oscillates rail to rail with a stable period', () => {
    const stages = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const lines: string[] = ['cmos ring', 'VDD vdd 0 5'];
    stages.forEach((inp, k) => {
      const out = stages[(k + 1) % stages.length];
      lines.push(`MN${k} ${out} ${inp} 0 0 NM W=2u L=1u`);
      lines.push(`MP${k} ${out} ${inp} vdd vdd PM W=4u L=1u`);
      lines.push(`C${k} ${out} 0 50f`);
    });
    lines.push('.model NM NMOS(LEVEL=1 VTO=0.8 KP=100u)');
    lines.push('.model PM PMOS(LEVEL=1 VTO=-0.8 KP=50u)');
    lines.push('.ic V(n1)=0');
    lines.push('.tran 0.05n 100n');
    lines.push('.end');
    const [r] = runDeck(lines.join('\n'));
    const t = scaleOf(r);
    const v = vec(r, 'V(n1)').re;
    const late: number[] = [];
    for (let i = 0; i < t.length; i++) if (t[i] > 50e-9) late.push(v[i]);
    expect(Math.max(...late)).toBeGreaterThan(4.9);
    expect(Math.min(...late)).toBeLessThan(0.1);
    const ups = crossTimes(t, v, 2.5, 'rise').filter((x) => x > 30e-9);
    expect(ups.length).toBeGreaterThan(3);
    const periods = ups.slice(1).map((x, i) => x - ups[i]);
    const pmean = periods.reduce((a, b) => a + b, 0) / periods.length;
    for (const p of periods) expect(Math.abs(p - pmean) / pmean).toBeLessThan(0.01);
  });
});
