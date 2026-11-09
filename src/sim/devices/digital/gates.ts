/**
 * Combinational primitives: gates, buffers, Schmitt triggers, tri-state buffers, bridges and
 * pull-up / pull-down drivers.
 *
 * Port layouts (XSPICE order; supply nodes follow when pwr > 0, see core.ts):
 *   D_AND D_NAND D_OR D_NOR D_XOR D_XNOR   in1 .. inN out        (N >= 1; XOR = odd parity)
 *   D_BUFFER D_INVERTER                     in out
 *   D_SCHMITT D_SCHMITT_INV                 in out                (hysteresis vtp / vtn; default
 *                                                                  vth ± 10 % of the swing)
 *   D_TRISTATE                              in enable out         (enable active high, or low with
 *                                                                  enable_low = 1; invert = 1 for
 *                                                                  an inverting buffer)
 *   ADC_BRIDGE DAC_BRIDGE                   in1 .. inN out1 .. outN  (per-bit buffers: all nets are
 *                                                                  analog in MachSim, so a bridge
 *                                                                  only re-levels the signal)
 *   D_PULLUP D_PULLDOWN                     out                   (weak driver, default rout 1 kΩ)
 */
import { Z, expectPorts, netlistError, range, type BehaviourContext, type BehaviourFactory } from './behaviour';

type Reduce = (v: Uint8Array, n: number) => number;

const and: Reduce = (v, n) => {
  for (let i = 0; i < n; i++) if (v[i] === 0) return 0;
  return 1;
};
const or: Reduce = (v, n) => {
  for (let i = 0; i < n; i++) if (v[i] === 1) return 1;
  return 0;
};
const xor: Reduce = (v, n) => {
  let p = 0;
  for (let i = 0; i < n; i++) p ^= v[i];
  return p;
};

function gate(fn: Reduce, invert: boolean): BehaviourFactory {
  return (ctx: BehaviourContext) => {
    if (ctx.ports < 2) throw netlistError(ctx.name, `a gate needs at least one input and one output (got ${ctx.ports} nodes)`);
    const n = ctx.ports - 1;
    return {
      inputs: range(0, n),
      outputs: [{ port: n }],
      state: 0,
      eval(io) {
        const v = fn(io.in, n);
        io.out[0] = invert ? 1 - v : v;
      },
    };
  };
}

function buffer(invert: boolean, schmitt: boolean): BehaviourFactory {
  return (ctx) => {
    expectPorts(ctx, 2, 'in out');
    return {
      inputs: [0],
      outputs: [{ port: 1 }],
      state: 0,
      schmitt,
      eval(io) {
        io.out[0] = invert ? 1 - io.in[0] : io.in[0];
      },
    };
  };
}

const tristate: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 3, 'in enable out');
  const low = ctx.p.flag('enable_low');
  const invert = ctx.p.flag('invert');
  return {
    inputs: [0, 1],
    outputs: [{ port: 2 }],
    state: 0,
    eval(io) {
      const enabled = io.present[1] === 0 || io.in[1] === (low ? 0 : 1);
      io.out[0] = enabled ? (invert ? 1 - io.in[0] : io.in[0]) : Z;
    },
  };
};

const bridge: BehaviourFactory = (ctx) => {
  if (ctx.ports < 2 || ctx.ports % 2 !== 0) throw netlistError(ctx.name, `a bridge needs N inputs followed by N outputs (got ${ctx.ports} nodes)`);
  const n = ctx.ports / 2;
  return {
    inputs: range(0, n),
    outputs: range(n, n).map((port) => ({ port })),
    state: 0,
    eval(io) {
      for (let k = 0; k < n; k++) io.out[k] = io.in[k];
    },
  };
};

function pull(level: 0 | 1): BehaviourFactory {
  return (ctx) => {
    expectPorts(ctx, 1, 'out');
    return {
      inputs: [],
      outputs: [{ port: 0 }],
      state: 0,
      defaults: { rout: 1e3 },
      eval(io) {
        io.out[0] = level;
      },
    };
  };
}

export const GATE_BEHAVIOURS: Record<string, BehaviourFactory> = {
  D_AND: gate(and, false),
  D_NAND: gate(and, true),
  D_OR: gate(or, false),
  D_NOR: gate(or, true),
  D_XOR: gate(xor, false),
  D_XNOR: gate(xor, true),
  D_BUFFER: buffer(false, false),
  D_INVERTER: buffer(true, false),
  D_SCHMITT: buffer(false, true),
  D_SCHMITT_INV: buffer(true, true),
  D_TRISTATE: tristate,
  ADC_BRIDGE: bridge,
  DAC_BRIDGE: bridge,
  D_PULLUP: pull(1),
  D_PULLDOWN: pull(0),
};
