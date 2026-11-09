/**
 * Review: interactive TransientStepper (src/sim/engine/stepper.ts) — chunking, sample spacing,
 * live setParam on sources / passives, and error reporting.
 *
 * Expected values are analytic RC responses; tolerances 2e-3 of full scale (trapezoidal with
 * SPICE LTE control, see tests/review/numerics/transient.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { createTransientStepper } from '../../../src/sim';
import { parseSpice } from '../../../src/sim/spice';
import type { TransientChunk } from '../../../src/sim/api';

function netlist(text: string) {
  const p = parseSpice(text);
  expect(p.errors).toEqual([]);
  return p.netlist;
}

function concat(chunks: TransientChunk[], name: string) {
  const t: number[] = [];
  const v: number[] = [];
  for (const c of chunks) {
    t.push(...c.time);
    v.push(...c.vectors[name]);
  }
  return { t, v };
}

const RC = `rc
V1 in 0 DC 0
R1 in out 1k
C1 out 0 1u
.end`;

describe('chunking', () => {
  it('advancing in many small chunks yields exactly the same samples as one big chunk', () => {
    const a = createTransientStepper(netlist(`rc
V1 in 0 SIN(0 1 1k)
R1 in out 1k
C1 out 0 1u
.end`), { tstep: 10e-6 });
    const b = createTransientStepper(netlist(`rc
V1 in 0 SIN(0 1 1k)
R1 in out 1k
C1 out 0 1u
.end`), { tstep: 10e-6 });
    const one = a.advance(3e-3);
    const many: TransientChunk[] = [];
    for (let k = 1; k <= 30; k++) many.push(b.advance(k * 1e-4));
    const m = concat(many, 'V(out)');
    expect(m.t.length).toBe(one.time.length);
    for (let i = 0; i < m.t.length; i++) {
      expect(m.t[i]).toBe(one.time[i]);
      expect(m.v[i]).toBe(one.vectors['V(out)'][i]);
    }
  });

  it('first chunk starts at t = 0 and samples are never more than tstep apart', () => {
    const s = createTransientStepper(netlist(RC), { tstep: 20e-6 });
    const c = s.advance(1e-3);
    expect(c.time[0]).toBe(0);
    for (let i = 1; i < c.time.length; i++) expect(c.time[i] - c.time[i - 1]).toBeLessThanOrEqual(20e-6 * (1 + 1e-9));
    expect(s.time).toBeGreaterThanOrEqual(1e-3);
  });
});

describe('setParam', () => {
  it('stepping V1 dc 0 → 1 V at t1 gives 1 − e^(−(t−t1)/τ)', () => {
    const s = createTransientStepper(netlist(RC), { tstep: 10e-6 });
    s.advance(1e-3);
    const t1 = s.time;
    s.setParam('V1', 'dc', 1);
    const c = s.advance(t1 + 5e-3);
    for (let i = 0; i < c.time.length; i++) {
      const ref = 1 - Math.exp(-(c.time[i] - t1) / 1e-3);
      expect(Math.abs(c.vectors['V(out)'][i] - ref), `t=${c.time[i]}`).toBeLessThan(2e-3);
    }
    expect(s.latest()['V(in)']).toBe(1);
  });

  it('changing R1 mid-run changes the time constant', () => {
    const s = createTransientStepper(netlist(`rc
V1 in 0 DC 1
R1 in out 1k
C1 out 0 1u
.ic V(out)=0
.end`), { tstep: 10e-6, uic: true });
    s.advance(1e-3);
    const t1 = s.time;
    const v1 = s.latest()['V(out)'];
    expect(Math.abs(v1 - (1 - Math.exp(-t1 / 1e-3)))).toBeLessThan(2e-3);
    s.setParam('R1', 'value', 10e3);
    const c = s.advance(t1 + 10e-3);
    const last = c.time.length - 1;
    const ref = 1 - (1 - v1) * Math.exp(-(c.time[last] - t1) / 10e-3);
    expect(Math.abs(c.vectors['V(out)'][last] - ref)).toBeLessThan(2e-3);
  });

  it('changing the SIN frequency takes effect (zero crossings move to the new period)', () => {
    const s = createTransientStepper(netlist(`sin
V1 a 0 SIN(0 1 1k)
R1 a 0 1k
.end`), { tstep: 5e-6 });
    s.advance(2e-3);
    s.setParam('V1', 'freq', 2e3);
    const c = s.advance(6e-3);
    // after the change: v = sin(2π·2k·t) (time-based waveform) → zero crossings every 250 µs
    const zc: number[] = [];
    const v = c.vectors['V(a)'];
    for (let i = 1; i < c.time.length; i++) {
      if (c.time[i] < 2.2e-3) continue;
      if ((v[i - 1] < 0 && v[i] >= 0) || (v[i - 1] > 0 && v[i] <= 0)) {
        zc.push(c.time[i - 1] + ((c.time[i] - c.time[i - 1]) * v[i - 1]) / (v[i - 1] - v[i]));
      }
    }
    expect(zc.length).toBeGreaterThan(10);
    const spacing = (zc[zc.length - 1] - zc[0]) / (zc.length - 1);
    expect(Math.abs(spacing - 250e-6)).toBeLessThan(1e-6);
  });

  it('open-ended run hits PULSE corners exactly even after thousands of periods and after a period change', () => {
    const s = createTransientStepper(netlist(`pulse
V1 a 0 PULSE(0 1 0 10n 10n 490n 1u)
R1 a 0 1k
.end`), { tstep: 100e-9 });
    const times: number[] = [];
    for (let k = 1; k <= 50; k++) times.push(...s.advance(k * 100e-6).time); // 5 ms = 5000 periods
    const has = (x: number) => times.some((v) => Math.abs(v - x) <= 1e-12 * Math.max(1, x) + 1e-15);
    for (const base of [4.990e-3, 4.995e-3, 4.999e-3]) {
      // corners of the period starting at `base` (td = 0): base, +10n, +500n, +510n
      for (const c of [0, 10e-9, 500e-9, 510e-9]) expect(has(base + c), `corner at ${base + c}`).toBe(true);
    }
    // change the period to 2 µs: from now on, edges every 2 µs (absolute time grid of the waveform)
    s.setParam('V1', 'per', 2e-6);
    const t1 = s.time;
    const later: number[] = [];
    for (let k = 1; k <= 10; k++) later.push(...s.advance(t1 + k * 10e-6).time);
    const nextStart = Math.ceil((t1 + 1e-9) / 2e-6) * 2e-6;
    const hasL = (x: number) => later.some((v) => Math.abs(v - x) <= 1e-12 * x + 1e-15);
    expect(hasL(nextStart + 2e-6), 'rising corner of the new period').toBe(true);
    expect(hasL(nextStart + 2e-6 + 510e-9), 'falling corner of the new period').toBe(true);
  });

  it('unknown element is reported as an error', () => {
    const s = createTransientStepper(netlist(RC), { tstep: 10e-6 });
    expect(() => s.setParam('R99', 'value', 1)).toThrow(/not found/);
  });

  it('an unknown parameter name is reported instead of being silently ignored', () => {
    // A UI typo ("resistance " vs "value", or a part that maps its knob to a param the device
    // does not know) would otherwise leave the circuit unchanged without any message.
    const s = createTransientStepper(netlist(RC), { tstep: 10e-6 });
    s.advance(1e-4);
    expect(() => s.setParam('C1', 'no_such_param', 5)).toThrow();
  });
});
