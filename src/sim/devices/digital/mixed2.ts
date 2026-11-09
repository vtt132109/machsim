/**
 * More mixed-signal code models: serial converters, classic microprocessor ADCs, a voltage-
 * controlled oscillator and the phase comparators of a PLL.
 *
 *   D_ADC_SPI   vin vref+ vref- ~cs sclk dout
 *       n-bit serial ADC (param n): ~cs falling samples vin (code = floor(2^n (vin - vref-) /
 *       (vref+ - vref-)), clamped) and puts the MSB on dout; each falling sclk edge shifts out
 *       the next bit (MSB first), then dout reads 0; ~cs high releases dout (Z).
 *   D_DAC_SPI   ~cs sclk din ~ldac vref+ vref- out
 *       n-bit serial DAC (param n): while ~cs is low each rising sclk edge shifts din in (MSB
 *       first; only the last n bits are kept, so 16-bit frames with leading command bits work);
 *       ~cs rising loads the DAC latch when ~ldac is low or NULL, ~ldac falling loads it at any
 *       time. out = vref- + latch / 2^n (vref+ - vref-), settling ramp tsettle, rout.
 *   D_ADC0804   vin+ vin- vref2 ~cs ~rd ~wr ~intr d0..d7
 *       8-bit microprocessor ADC: ~wr low (with ~cs low) resets, ~wr rising starts a conversion
 *       of V(vin+) - V(vin-); after tconv the result is latched and ~intr goes low; ~cs and ~rd
 *       low drive d0..d7 (else Z) and ~rd falling resets ~intr. Full scale = 2 V(vref2) (NULL
 *       vref2: vnom); the result is rounded to the nearest code.
 *   D_ADC0809   in0..in7 vref+ vref- adda addb addc ale start oe eoc d0..d7
 *       8-channel 8-bit ADC: ale rising latches the channel address, start falling starts a
 *       conversion of the selected input (eoc low for tconv), oe high drives d0..d7 (else Z).
 *   D_VCO       vin [inh] out
 *       square-wave VCO: f = fa + (V(vin) - va)(fb - fa) / (vb - va), clamped to fmin..fmax;
 *       duty cycle `duty`; the phase is integrated between accepted points and every edge is
 *       placed at its interpolated time (wake-ups at the predicted edges). has_inh = 1 adds an
 *       inhibit input (high: oscillator stopped, output low). Starts low.
 *   D_PHASE_DET sig comp pc1 pc2 pcp
 *       4046 phase comparators: pc1 = sig XOR comp; pc2 = edge-triggered phase-frequency detector
 *       (3-state: high after a sig edge until the next comp edge, low after a comp edge until
 *       the next sig edge, otherwise Z); pcp (phase pulses) is high while pc2 is released.
 */
import { Z, expectPorts, netlistError, range, type BehaviourFactory, type EvalIO } from './behaviour';

function bitsParam(ctx: { p: { int(k: string, d: number): number }; name: string }, def: number): number {
  const n = ctx.p.int('n', def);
  if (!(n >= 1 && n <= 24)) throw netlistError(ctx.name, `n (resolution) must be 1..24 bits (got ${n})`);
  return n;
}

/** Linear interpolation of analog input k at time t of the current step. */
function analogAt(io: EvalIO, k: number, t: number): number {
  const dt = io.now - io.prevTime;
  if (!(dt > 0)) return io.analog[k];
  const f = Math.min(1, Math.max(0, (t - io.prevTime) / dt));
  return io.analogPrev[k] + f * (io.analog[k] - io.analogPrev[k]);
}

function quantize(v: number, lo: number, hi: number, n: number, round: boolean): number {
  const m = 2 ** n;
  const span = hi - lo;
  if (!(span > 0)) return 0;
  const x = (m * (v - lo)) / span;
  const c = round ? Math.floor(x + 0.5) : Math.floor(x + 1e-9);
  return Math.min(m - 1, Math.max(0, c));
}

const adcSpi: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 6, 'vin vref+ vref- ~cs sclk dout');
  const n = bitsParam(ctx, 12);
  return {
    inputs: [3, 4],
    analog: [0, 1, 2],
    outputs: [{ port: 5 }],
    // st0 code, st1 bit index
    state: 2,
    eval(io) {
      const selected = io.in[0] === 0;
      if (io.dc) {
        if (selected) {
          io.st[0] = quantize(io.analog[0], io.analog[2], io.analog[1], n, false);
          io.st[1] = 0;
        }
      } else {
        if (io.falling(0)) {
          const t = io.cross[0];
          io.setTime(t);
          io.st[0] = quantize(analogAt(io, 0, t), analogAt(io, 2, t), analogAt(io, 1, t), n, false);
          io.st[1] = 0;
        }
        if (selected && io.falling(1) && io.cross[1] >= io.cross[0]) {
          io.setTime(io.cross[1]);
          io.st[1] = Math.min(n, io.st[1] + 1);
        }
      }
      const idx = io.st[1];
      io.out[0] = !selected ? Z : idx < n ? Math.floor(io.st[0] / 2 ** (n - 1 - idx)) % 2 : 0;
    },
  };
};

const dacSpi: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 7, '~cs sclk din ~ldac vref+ vref- out');
  const n = bitsParam(ctx, 12);
  const m = 2 ** n;
  return {
    inputs: [0, 1, 2, 3],
    outputs: [],
    aoutputs: [{ port: 6, lo: 5, hi: 4, span: 0, fullScale: 1, slew: ctx.p.positive('tsettle', 1e-6), delay: ctx.p.nonNeg('tpd', 0), rout: ctx.p.positive('rout', 1) }],
    // st0 shift register, st1 DAC latch
    state: 2,
    eval(io) {
      if (!io.dc) {
        const edges: [number, () => void][] = [];
        if (io.rising(1)) {
          const t = io.cross[1];
          if (io.at(0, t) === 0) edges.push([t, () => (io.st[0] = (io.st[0] * 2 + io.at(2, t)) % m)]);
        }
        if (io.rising(0)) {
          const t = io.cross[0];
          if (io.present[3] === 0 || io.at(3, t) === 0) edges.push([t, () => (io.st[1] = io.st[0])]);
        }
        if (io.present[3] === 1 && io.falling(3)) edges.push([io.cross[3], () => (io.st[1] = io.st[0])]);
        edges.sort((a, b) => a[0] - b[0]);
        for (const [t, apply] of edges) {
          io.setTime(t);
          apply();
        }
      }
      io.aout[0] = io.st[1] / m;
    },
  };
};

const adc0804: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 15, 'vin+ vin- vref2 ~cs ~rd ~wr ~intr d0..d7');
  const tconv = ctx.p.positive('tconv', 100e-6);
  const vnom = ctx.p.positive('vnom', 5);
  const vrefPresent = ctx.present[2];
  const convert = (io: EvalIO, t?: number) => {
    const v = (k: number) => (t === undefined ? io.analog[k] : analogAt(io, k, t));
    const span = vrefPresent ? 2 * v(2) : vnom;
    return quantize(v(0) - v(1), 0, span, 8, true);
  };
  return {
    inputs: [3, 4, 5],
    analog: [0, 1, 2],
    outputs: range(6, 9).map((port) => ({ port })),
    // st0 result latch, st1 busy, st2 end time, st3 intr (1 = high), st4 sampled code
    state: 5,
    init(io) {
      io.st[3] = 1;
    },
    eval(io) {
      const cs = io.in[0] === 0;
      if (io.dc) {
        io.st[0] = convert(io);
      } else {
        const wr = 2;
        if (cs && io.in[wr] === 0) {
          io.st[1] = 0;
          io.st[3] = 1;
        } else if (io.rising(wr) && io.at(0, io.cross[wr]) === 0) {
          const t = io.cross[wr];
          io.setTime(t);
          io.st[4] = convert(io, t);
          io.st[1] = 1;
          io.st[2] = t + tconv;
          io.st[3] = 1;
          io.wake(io.st[2]);
        }
        if (io.st[1] === 1 && io.now >= io.st[2] - 1e-9 * Math.max(io.now, 1e-12)) {
          io.st[0] = io.st[4];
          io.st[1] = 0;
          io.st[3] = 0;
        }
        if (cs && io.falling(1)) io.st[3] = 1;
      }
      io.out[0] = io.st[3];
      const read = cs && io.in[1] === 0;
      let v = io.st[0];
      for (let k = 0; k < 8; k++) {
        io.out[1 + k] = read ? v % 2 : Z;
        v = Math.floor(v / 2);
      }
    },
  };
};

const adc0809: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 25, 'in0..in7 vref+ vref- adda addb addc ale start oe eoc d0..d7');
  const tconv = ctx.p.positive('tconv', 100e-6);
  return {
    inputs: [10, 11, 12, 13, 14, 15],
    analog: range(0, 10),
    outputs: range(16, 9).map((port) => ({ port })),
    // st0 latched address, st1 busy, st2 end time, st3 result latch, st4 sampled code
    state: 5,
    eval(io) {
      const addr = io.in[0] + 2 * io.in[1] + 4 * io.in[2];
      if (io.dc) {
        io.st[0] = addr;
        io.st[3] = quantize(io.analog[addr], io.analog[9], io.analog[8], 8, true);
      } else {
        if (io.rising(3)) io.st[0] = io.at(0, io.cross[3]) + 2 * io.at(1, io.cross[3]) + 4 * io.at(2, io.cross[3]);
        if (io.rising(4)) io.st[1] = 0;
        if (io.falling(4)) {
          const t = io.cross[4];
          io.setTime(t);
          const ch = io.st[0];
          io.st[4] = quantize(analogAt(io, ch, t), analogAt(io, 9, t), analogAt(io, 8, t), 8, true);
          io.st[1] = 1;
          io.st[2] = t + tconv;
          io.wake(io.st[2]);
        }
        if (io.st[1] === 1 && io.now >= io.st[2] - 1e-9 * Math.max(io.now, 1e-12)) {
          io.st[3] = io.st[4];
          io.st[1] = 0;
        }
      }
      io.out[0] = io.st[1] === 1 ? 0 : 1;
      const enabled = io.in[5] === 1;
      let v = io.st[3];
      for (let k = 0; k < 8; k++) {
        io.out[1 + k] = enabled ? v % 2 : Z;
        v = Math.floor(v / 2);
      }
    },
  };
};

const vco: BehaviourFactory = (ctx) => {
  const hasInh = ctx.p.flag('has_inh') ? 1 : 0;
  expectPorts(ctx, 2 + hasInh, hasInh ? 'vin inh out' : 'vin out');
  const fmin = ctx.p.nonNeg('fmin', 0);
  const fmax = ctx.p.positive('fmax', 1e6);
  const va = ctx.p.num('va', 0);
  const vb = ctx.p.num('vb', 5);
  const fa = ctx.p.nonNeg('fa', fmin);
  const fb = ctx.p.nonNeg('fb', fmax);
  const duty = ctx.p.num('duty', 0.5);
  if (!(duty > 0 && duty < 1)) throw netlistError(ctx.name, `duty must be between 0 and 1 (got ${duty})`);
  if (!(fmax >= fmin)) throw netlistError(ctx.name, 'fmax must not be below fmin');
  const freq = (v: number): number => {
    const f = vb === va ? fa : fa + ((v - va) * (fb - fa)) / (vb - va);
    return Math.min(fmax, Math.max(fmin, f));
  };
  const boundary = (phi: number) => (phi < duty ? duty : 1);
  return {
    inputs: hasInh ? [1] : [],
    analog: [0],
    outputs: [{ port: 1 + hasInh }],
    // st0 phase (cycles, 0..1), st1 output level
    state: 2,
    alwaysEval: true,
    defaults: { rise_delay: 0, fall_delay: 0 },
    init(io) {
      io.st[0] = duty;
      io.st[1] = 0;
    },
    eval(io) {
      const inhibited = hasInh === 1 && io.in[0] === 1;
      if (io.dc || inhibited) {
        if (inhibited) io.st[1] = 0;
        io.out[0] = io.st[1];
        return;
      }
      const dt = io.now - io.prevTime;
      const f0 = freq(io.analogPrev[0]);
      const f1 = freq(io.analog[0]);
      const dphi = dt > 0 ? 0.5 * (f0 + f1) * dt : 0;
      // a boundary closer than this (in cycles) counts as reached: the wake-up lands on it
      const tol = 1e-6;
      let phi = io.st[0];
      let rem = dphi;
      let used = 0;
      let tEdge: number | undefined;
      for (let guard = 0; rem > 0 && guard < 64; guard++) {
        const b = boundary(phi);
        const need = b - phi;
        if (need > rem + tol) {
          phi += rem;
          break;
        }
        used += Math.max(0, need);
        rem -= need;
        tEdge = io.prevTime + Math.min(1, used / dphi) * dt;
        io.st[1] = b === duty ? 1 : 0;
        phi = b >= 1 ? 0 : b;
      }
      if (tEdge !== undefined) io.setTime(tEdge);
      io.st[0] = phi;
      io.out[0] = io.st[1];
      if (f1 > 0) io.wake(io.now + (boundary(phi) - phi) / f1);
    },
  };
};

const phaseDetector: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 5, 'sig comp pc1 pc2 pcp');
  return {
    inputs: [0, 1],
    outputs: [{ port: 2 }, { port: 3 }, { port: 4 }],
    // st0 up, st1 down
    state: 2,
    eval(io) {
      if (!io.dc) {
        const events: [number, 0 | 1][] = [];
        if (io.rising(0)) events.push([io.cross[0], 0]);
        if (io.rising(1)) events.push([io.cross[1], 1]);
        events.sort((a, b) => a[0] - b[0]);
        for (const [t, which] of events) {
          io.setTime(t);
          if (which === 0) {
            if (io.st[1] === 1) io.st[1] = 0;
            else io.st[0] = 1;
          } else if (io.st[0] === 1) io.st[0] = 0;
          else io.st[1] = 1;
        }
      }
      io.out[0] = io.in[0] ^ io.in[1];
      io.out[1] = io.st[0] === 1 ? 1 : io.st[1] === 1 ? 0 : Z;
      io.out[2] = io.st[0] === 1 || io.st[1] === 1 ? 0 : 1;
    },
  };
};

export const MIXED2_BEHAVIOURS: Record<string, BehaviourFactory> = {
  D_ADC_SPI: adcSpi,
  D_DAC_SPI: dacSpi,
  D_ADC0804: adc0804,
  D_ADC0809: adc0809,
  D_VCO: vco,
  D_PHASE_DET: phaseDetector,
};
