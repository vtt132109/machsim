/**
 * Mixed-signal and source code models.
 *
 *   D_OSC          out                        digital clock: freq (Hz), duty (0..1 of the period,
 *                                             measured between 50 % points), td (time of the first
 *                                             rising edge, default 0). Instance params freq / duty /
 *                                             td can be changed at run time (setParam); the phase then
 *                                             restarts at the change.
 *   D_SOURCE       out0 .. out(n-1)           word pattern: word i drives out_k = bit k during
 *                                             [td + i·period, td + (i+1)·period) (word 0 also before
 *                                             td); words come from instance params nwords, w0, w1 ...
 *                                             or the model literal `pattern` (hex words separated by
 *                                             spaces / commas, optional 0x). repeat = 1 (default)
 *                                             cycles, 0 holds the last word.
 *   D_ADC          vin vref+ vref- soc oe eoc d0..d(n-1)
 *                                             n-bit converter: code = floor(2^n (vin - vref-) /
 *                                             (vref+ - vref-)) clamped to 0..2^n-1. A rising soc edge
 *                                             samples vin, eoc goes low and the code appears after
 *                                             tconv (then eoc high). With soc NULL (or continuous = 1)
 *                                             the converter tracks vin at every accepted point. oe
 *                                             (active high, NULL = enabled) tri-states d0..d(n-1).
 *   D_DAC          d0..d(n-1) vref+ vref- out  voltage DAC: out = vref- + (code / 2^n)(vref+ - vref-)
 *                                             behind rout (default 1 Ω), delay tpd, full-scale settling
 *                                             time tsettle (linear ramp).
 *   D_COMPARATOR   in+ in- out                 analog comparator with logic output: high when
 *                                             V(in+) - V(in-) > voffset + vhys/2, low below
 *                                             voffset - vhys/2.
 *   D_DISPLAY      p0 n0 p1 n1 ... out         display sensing: bit j is lit when V(pj) - V(nj) > von;
 *                                             `out` is driven to the integer bit mask (volts) — the
 *                                             schematic reads it to draw segments / bars.
 *   D_HEXDISPLAY   d0 d1 d2 d3 out             decoded hex display: `out` = seven-segment mask of the
 *                                             hex digit (a = bit 0 ... g = bit 6).
 */
import {
  REF,
  Z,
  crossingTime,
  expectPorts,
  netlistError,
  range,
  word,
  type BehaviourFactory,
  type EvalIO,
} from './behaviour';
import { SEGMENT_FONTS } from './msi';

/** Parse hex words "0x0F, ff 1" (whitespace / comma / semicolon separated). */
export function parseHexWords(text: string): number[] {
  const out: number[] = [];
  for (const tok of text.split(/[\s,;]+/)) {
    const t = tok.trim().replace(/^0x/i, '');
    if (!t) continue;
    if (!/^[0-9a-f]+$/i.test(t)) throw new Error(`bad hex word '${tok}'`);
    out.push(parseInt(t, 16));
  }
  return out;
}

const osc: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 1, 'out');
  let freq = ctx.p.positive('freq', 1e3);
  let duty = ctx.p.num('duty', 0.5);
  if (!(duty > 0 && duty < 1)) throw netlistError(ctx.name, `duty must be between 0 and 1 (got ${duty})`);
  let origin = ctx.p.nonNeg('td', 0);
  let rebase = false;
  const edge = (m: number): number => {
    const T = 1 / freq;
    return origin + Math.floor(m / 2) * T + (m % 2 === 1 ? duty * T : 0);
  };
  return {
    inputs: [],
    outputs: [{ port: 0 }],
    state: 2,
    defaults: { rise_delay: 0, fall_delay: 0 },
    eval(io) {
      if (io.dc) {
        io.out[0] = io.st[1];
        return;
      }
      if (rebase) {
        origin = io.now;
        io.st[0] = io.st[1] === 1 ? 1 : 0;
        rebase = false;
      }
      const tol = 1e-9 * Math.max(Math.abs(io.now), 1 / freq);
      let m = io.st[0];
      while (edge(m) <= io.now + tol) {
        io.st[1] = m % 2 === 0 ? 1 : 0;
        m++;
      }
      io.st[0] = m;
      io.out[0] = io.st[1];
      io.wake(edge(m));
    },
    setParam(key, value) {
      if (key === 'freq' && value > 0) freq = value;
      else if (key === 'duty' && value > 0 && value < 1) duty = value;
      else if (key === 'td' && value >= 0) origin = value;
      else return false;
      rebase = key !== 'td';
      return true;
    },
    getParam(key) {
      return key === 'freq' ? freq : key === 'duty' ? duty : key === 'td' ? origin : undefined;
    },
  };
};

const source: BehaviourFactory = (ctx) => {
  const n = ctx.ports;
  if (n < 1 || n > 32) throw netlistError(ctx.name, `a pattern source drives 1..32 outputs (got ${n})`);
  const period = ctx.p.positive('period', 1e-6);
  const td = ctx.p.nonNeg('td', 0);
  const repeat = ctx.p.flag('repeat', true);
  let words: number[];
  const nw = ctx.p.get('nwords');
  if (nw !== undefined) {
    words = range(0, Math.round(nw)).map((k) => Math.max(0, Math.round(ctx.p.num(`w${k}`, 0))));
  } else {
    const text = ctx.p.text('pattern') ?? '';
    try {
      words = parseHexWords(text);
    } catch (e) {
      throw netlistError(ctx.name, (e as Error).message);
    }
  }
  if (words.length === 0) throw netlistError(ctx.name, 'pattern source without words (give nwords / w0.. or a pattern)');
  const write = (io: EvalIO, w: number) => {
    let v = w;
    for (let k = 0; k < n; k++) {
      io.out[k] = v % 2;
      v = Math.floor(v / 2);
    }
  };
  return {
    inputs: [],
    outputs: range(0, n).map((port) => ({ port })),
    state: 1,
    defaults: { rise_delay: 0, fall_delay: 0 },
    eval(io) {
      if (io.dc) {
        write(io, words[0]);
        return;
      }
      const i = io.now < td ? 0 : Math.floor((io.now - td) / period + 1e-9);
      const last = words.length - 1;
      const idx = repeat ? i % words.length : Math.min(i, last);
      io.st[0] = i;
      write(io, words[idx]);
      if (repeat || i < last) io.wake(td + (i + 1) * period);
    },
  };
};

const adc: BehaviourFactory = (ctx) => {
  const n = ctx.ports - 6;
  if (n < 1 || n > 24) throw netlistError(ctx.name, 'an ADC needs vin vref+ vref- soc oe eoc and 1..24 data outputs');
  const tconv = ctx.p.nonNeg('tconv', 1e-6);
  const continuous = ctx.p.flag('continuous', !ctx.present[3]);
  const m = 2 ** n;
  const sample = (a: Float64Array): number => {
    const span = a[1] - a[2];
    if (!(span > 0)) return 0;
    const c = Math.floor((m * (a[0] - a[2])) / span + 1e-9);
    return Math.min(m - 1, Math.max(0, c));
  };
  return {
    inputs: [3, 4],
    analog: [0, 1, 2],
    outputs: [{ port: 5 }, ...range(6, n).map((port) => ({ port }))],
    state: 4,
    alwaysEval: continuous,
    eval(io) {
      if (io.dc || continuous) {
        io.st[0] = sample(io.analog);
        io.st[1] = 0;
      } else {
        if (io.rising(0)) {
          io.st[3] = sample(io.analog);
          io.st[1] = 1;
          io.st[2] = io.time + tconv;
          io.wake(io.st[2]);
        }
        if (io.st[1] === 1 && io.now >= io.st[2] - 1e-9 * Math.max(io.now, 1e-12)) {
          io.st[0] = io.st[3];
          io.st[1] = 0;
        }
      }
      io.out[0] = io.st[1] === 1 ? 0 : 1;
      const enabled = io.present[1] === 0 || io.in[1] === 1;
      let v = io.st[0];
      for (let k = 0; k < n; k++) {
        io.out[1 + k] = enabled ? v % 2 : Z;
        v = Math.floor(v / 2);
      }
    },
  };
};

const dac: BehaviourFactory = (ctx) => {
  const n = ctx.ports - 3;
  if (n < 1 || n > 24) throw netlistError(ctx.name, 'a DAC needs 1..24 data inputs followed by vref+ vref- out');
  const m = 2 ** n;
  return {
    inputs: range(0, n),
    outputs: [],
    aoutputs: [
      {
        port: n + 2,
        lo: n + 1,
        hi: n,
        span: 0,
        fullScale: 1,
        slew: ctx.p.positive('tsettle', 100e-9),
        delay: ctx.p.nonNeg('tpd', 0),
        rout: ctx.p.positive('rout', 1),
      },
    ],
    state: 0,
    eval(io) {
      io.aout[0] = word(io, 0, n) / m;
    },
  };
};

const comparator: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 3, 'in+ in- out');
  const off = ctx.p.num('voffset', 0);
  const hys = ctx.p.nonNeg('vhys', 0);
  const up = off + hys / 2;
  const dn = off - hys / 2;
  return {
    inputs: [],
    analog: [0, 1],
    outputs: [{ port: 2 }],
    state: 1,
    alwaysEval: true,
    eval(io) {
      const d = io.analog[0] - io.analog[1];
      const dp = io.analogPrev[0] - io.analogPrev[1];
      if (io.st[0] === 0 && d > up) {
        io.st[0] = 1;
        if (!io.dc) io.setTime(crossingTime(io.prevTime, dp, io.now, d, up));
      } else if (io.st[0] === 1 && d < dn) {
        io.st[0] = 0;
        if (!io.dc) io.setTime(crossingTime(io.prevTime, dp, io.now, d, dn));
      }
      io.out[0] = io.st[0];
    },
    predict(io) {
      const d = io.analog[0] - io.analog[1];
      const slope = (d - (io.analogPrev[0] - io.analogPrev[1])) / (io.now - io.prevTime);
      if (io.st[0] === 0 && slope > 0) return io.now + (up - d) / slope;
      if (io.st[0] === 1 && slope < 0) return io.now + (dn - d) / slope;
      return undefined;
    },
  };
};

const display: BehaviourFactory = (ctx) => {
  const k = (ctx.ports - 1) / 2;
  if (!Number.isInteger(k) || k < 1 || k > 24) throw netlistError(ctx.name, 'a display sensor needs pairs (p n) followed by the code output');
  const von = ctx.p.num('von', 1.5);
  return {
    inputs: [],
    analog: range(0, 2 * k),
    outputs: [],
    aoutputs: [{ port: 2 * k, lo: REF, hi: REF, span: 1, fullScale: 2 ** k, slew: 1e-12, delay: 0, rout: 1 }],
    state: 0,
    alwaysEval: true,
    eval(io) {
      let mask = 0;
      for (let j = k - 1; j >= 0; j--) mask = mask * 2 + (io.analog[2 * j] - io.analog[2 * j + 1] > von ? 1 : 0);
      io.aout[0] = mask;
    },
  };
};

const hexDisplay: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 5, 'd0 d1 d2 d3 out');
  return {
    inputs: [0, 1, 2, 3],
    outputs: [],
    aoutputs: [{ port: 4, lo: REF, hi: REF, span: 1, fullScale: 128, slew: 1e-12, delay: 0, rout: 1 }],
    state: 0,
    eval(io) {
      io.aout[0] = SEGMENT_FONTS.hex[word(io, 0, 4)];
    },
  };
};

export const MIXED_BEHAVIOURS: Record<string, BehaviourFactory> = {
  D_OSC: osc,
  D_SOURCE: source,
  D_ADC: adc,
  D_DAC: dac,
  D_COMPARATOR: comparator,
  D_DISPLAY: display,
  D_HEXDISPLAY: hexDisplay,
};
