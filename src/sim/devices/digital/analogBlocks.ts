/**
 * Analog control-function code models with memory: hysteresis (Schmitt) block, controlled
 * one-shot, edge-sampled sample-and-hold and a regular-sampled PWM modulator. They use the
 * event machinery of the code-model shell (core.ts): state changes only at accepted timepoints,
 * threshold crossings are located by interpolation (with breakpoints placed just after predicted
 * crossings) and the output is an analog Thevenin stage (AnalogOutputSpec, lo = hi = REF,
 * span = 1, so the behaviour's value IS the output voltage above the reference node) that ramps
 * linearly over the edge time. Every model writes its own levels, so `vol` / `voh` of the shell
 * are not used (they keep their defaults); the output resistance `rout` defaults to 1 mΩ.
 *
 *   A_HYST     in out
 *       Schmitt transfer: the output goes to `yhigh` when V(in) rises above `vhigh` and to `ylow`
 *       when it falls below `vlow` (vlow <= vhigh); between the thresholds it keeps its level.
 *       `init` (0 / 1) is the level at power-up while the input lies between the thresholds.
 *       A DC sweep keeps the state from point to point, so sweeping up and then down draws the
 *       loop. The ramp between the levels takes `edge` seconds.
 *   A_ONESHOT  trig cntl clr out          (cntl and clr may be NULL)
 *       Controlled one-shot (monostable): a rising (or, with `falling` = 1, falling) edge of trig
 *       through the threshold `vth` starts a pulse at `yhigh`; it lasts
 *           W = max(pwmin, pw + kpw · V(cntl))     (W = pw when cntl is NULL)
 *       measured between the 50 % points of the edges. `retrig` = 1 restarts the width on every
 *       trigger during the pulse, otherwise triggers during the pulse are ignored. clr high ends
 *       the pulse at once and blocks triggers. The operating point is the idle (`ylow`) state.
 *   A_SAH      in clk out
 *       Edge-sampled sample-and-hold: at every rising (`falling` = 1: falling) clk edge the
 *       output takes the input value at the crossing time (linear interpolation within the step)
 *       and holds it until the next edge. In the operating point the output equals the input.
 *   A_PWM      in out                     (in may be NULL)
 *       Regular-sampled PWM modulator at `freq`: each period starts high and goes low after
 *       D·T, with D = (V(in) - vmin) / (vmax - vmin) clamped to [0, 1] and sampled at the start
 *       of the period (uniform sampling, so every pulse width is exact). With in = NULL,
 *       D = duty + (mod / 2) · sin(2π · fmod · t). The operating point is the start of a period.
 */
import { REF, crossingTime, expectPorts, netlistError, type AnalogOutputSpec, type BehaviourContext, type BehaviourFactory, type EvalIO } from './behaviour';

/** Analog output port with the value = voltage above the reference, ramping over `edge`. */
function voltageOut(ctx: BehaviourContext, port: number, swing: number): AnalogOutputSpec {
  return {
    port,
    lo: REF,
    hi: REF,
    span: 1,
    fullScale: Math.max(Math.abs(swing), 1e-12),
    slew: ctx.p.positive('edge', 1e-9),
    delay: 0,
    rout: ctx.p.positive('rout', 1e-3),
  };
}

/** Output levels `ylow` / `yhigh` (defaults 0 V / 5 V); they must differ. */
function levels(ctx: BehaviourContext): { lo: number; hi: number } {
  const lo = ctx.p.num('ylow', 0);
  const hi = ctx.p.num('yhigh', 5);
  if (lo === hi) throw netlistError(ctx.name, `ylow and yhigh must differ (both ${lo})`);
  return { lo, hi };
}

/** Linear interpolation of analog input k at time t within the current step. */
function analogAt(io: EvalIO, k: number, t: number): number {
  const dt = io.now - io.prevTime;
  if (!(dt > 0)) return io.analog[k];
  const f = Math.min(1, Math.max(0, (t - io.prevTime) / dt));
  return io.analogPrev[k] + f * (io.analog[k] - io.analogPrev[k]);
}

/** Has the wake-up time `t` been reached at the current accepted point? */
function reached(io: EvalIO, t: number): boolean {
  return io.now >= t - Math.max(1e-15, 1e-9 * Math.abs(t));
}

const hysteresis: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 2, 'in out');
  const vlow = ctx.p.num('vlow', -1);
  const vhigh = ctx.p.num('vhigh', 1);
  if (!(vhigh >= vlow)) throw netlistError(ctx.name, `vhigh (${vhigh}) must not be below vlow (${vlow})`);
  const { lo, hi } = levels(ctx);
  const init = ctx.p.flag('init') ? 1 : 0;
  return {
    inputs: [],
    analog: [0],
    outputs: [],
    aoutputs: [voltageOut(ctx, 1, hi - lo)],
    state: 1,
    alwaysEval: true,
    init(io) {
      io.st[0] = init;
    },
    eval(io) {
      const x = io.analog[0];
      const xp = io.analogPrev[0];
      if (io.st[0] === 0 && x > vhigh) {
        io.st[0] = 1;
        if (!io.dc) io.setTime(crossingTime(io.prevTime, xp, io.now, x, vhigh));
      } else if (io.st[0] === 1 && x < vlow) {
        io.st[0] = 0;
        if (!io.dc) io.setTime(crossingTime(io.prevTime, xp, io.now, x, vlow));
      }
      io.aout[0] = io.st[0] === 1 ? hi : lo;
    },
    predict(io) {
      const x = io.analog[0];
      const slope = (x - io.analogPrev[0]) / (io.now - io.prevTime);
      if (io.st[0] === 0 && slope > 0) return io.now + (vhigh - x) / slope;
      if (io.st[0] === 1 && slope < 0) return io.now + (vlow - x) / slope;
      return undefined;
    },
  };
};

const oneShot: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 4, 'trig cntl clr out');
  const { lo, hi } = levels(ctx);
  const pw = ctx.p.nonNeg('pw', 1e-3);
  const kpw = ctx.p.num('kpw', 0);
  const pwmin = ctx.p.positive('pwmin', 1e-9);
  const retrig = ctx.p.flag('retrig');
  const falling = ctx.p.flag('falling');
  const hasCntl = ctx.present[1];
  const width = (v: number) => Math.max(pwmin, hasCntl ? pw + kpw * v : pw);
  return {
    // in[0] = trig, in[1] = clr; analog[0] = cntl
    inputs: [0, 2],
    analog: [1],
    outputs: [],
    aoutputs: [voltageOut(ctx, 3, hi - lo)],
    // st0 = pulse active, st1 = end time of the pulse
    state: 2,
    eval(io) {
      if (io.dc) {
        io.st[0] = 0;
        io.aout[0] = lo;
        return;
      }
      if (io.present[1] === 1 && io.in[1] === 1) {
        io.st[0] = 0;
        io.aout[0] = lo;
        return;
      }
      const edge = falling ? io.falling(0) : io.rising(0);
      if (edge && (io.st[0] === 0 || retrig)) {
        const tc = io.cross[0] > -Infinity ? io.cross[0] : io.now;
        // the ramp starts at the accepted point (never in the past): measure the width from there
        io.st[0] = 1;
        io.st[1] = io.now + width(analogAt(io, 0, tc));
        io.wake(io.st[1]);
      } else if (io.st[0] === 1 && reached(io, io.st[1])) {
        io.st[0] = 0;
      }
      io.aout[0] = io.st[0] === 1 ? hi : lo;
    },
  };
};

const sampleHold: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 3, 'in clk out');
  const falling = ctx.p.flag('falling');
  const swing = ctx.p.positive('fullscale', 10);
  return {
    inputs: [1],
    analog: [0],
    outputs: [],
    aoutputs: [voltageOut(ctx, 2, swing)],
    state: 1,
    alwaysEval: true,
    eval(io) {
      if (io.dc) {
        io.st[0] = io.analog[0];
        io.aout[0] = io.st[0];
        return;
      }
      const edge = falling ? io.falling(0) : io.rising(0);
      if (edge) {
        const tc = io.cross[0] > -Infinity ? io.cross[0] : io.now;
        io.st[0] = analogAt(io, 0, tc);
        io.setTime(tc);
      }
      io.aout[0] = io.st[0];
    },
  };
};

const pwm: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 2, 'in out');
  const { lo, hi } = levels(ctx);
  const freq = ctx.p.positive('freq', 1e3);
  const period = 1 / freq;
  const vmin = ctx.p.num('vmin', 0);
  const vmax = ctx.p.num('vmax', 1);
  if (!(vmax > vmin)) throw netlistError(ctx.name, `vmax (${vmax}) must be above vmin (${vmin})`);
  const duty0 = ctx.p.num('duty', 0.5);
  const mod = ctx.p.num('mod', 0);
  const fmod = ctx.p.nonNeg('fmod', 100);
  const hasIn = ctx.present[0];
  const dutyAt = (io: EvalIO): number => {
    const d = hasIn ? (io.analog[0] - vmin) / (vmax - vmin) : duty0 + (mod / 2) * Math.sin(2 * Math.PI * fmod * io.now);
    return Math.min(1, Math.max(0, d));
  };
  return {
    analog: [0],
    inputs: [],
    outputs: [],
    aoutputs: [voltageOut(ctx, 1, hi - lo)],
    // st0 = start of the running period (-1 before the first one), st1 = its falling-edge time
    state: 2,
    alwaysEval: false,
    init(io) {
      io.st[0] = -1;
      io.st[1] = -1;
    },
    eval(io) {
      if (io.dc) {
        io.aout[0] = dutyAt(io) > 0 ? hi : lo;
        return;
      }
      const start = io.st[0];
      if (start < 0 || reached(io, start + period)) {
        const d = dutyAt(io);
        io.st[0] = io.now;
        io.st[1] = io.now + d * period;
        io.wake(io.now + period);
        if (d > 0 && d < 1) io.wake(io.st[1]);
        io.aout[0] = d > 0 ? hi : lo;
        return;
      }
      if (reached(io, io.st[1]) && io.st[1] < start + period) io.aout[0] = lo;
    },
  };
};

export const ANALOG_BLOCK_BEHAVIOURS: Record<string, BehaviourFactory> = {
  A_HYST: hysteresis,
  A_ONESHOT: oneShot,
  A_SAH: sampleHold,
  A_PWM: pwm,
};
