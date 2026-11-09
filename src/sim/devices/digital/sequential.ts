/**
 * Sequential primitives: edge-triggered flip-flops and level-sensitive latches.
 *
 * Port layouts (XSPICE order):
 *   D_DFF      d clk set reset q qn
 *   D_JKFF     j k clk set reset q qn
 *   D_TFF      t clk set reset q qn
 *   D_SRFF     s r clk set reset q qn
 *   D_DLATCH   d enable set reset q qn
 *   D_SRLATCH  s r enable set reset q qn
 *
 * Model parameters
 *   clk_edge    1 = rising edge (default, XSPICE), 0 = falling edge
 *   set_low     1 = set input active low (TTL PRE), default 0 (active high, XSPICE)
 *   reset_low   1 = reset input active low (TTL CLR), default 0
 *   enable_low  latches: 1 = enable active low, default 0
 *   ic          initial state of q (0 / 1), default 0
 * Set / reset are asynchronous and dominate the clock / enable; with both active both outputs
 * are high (TTL behaviour) and the stored state is left unchanged. A NULL set / reset / enable
 * port is inactive (enable: always enabled).
 *
 * Data inputs are sampled at the interpolated clock crossing: an input whose own crossing lies
 * before the clock crossing (within the same step) is taken at its new value, otherwise at its
 * old value; outputs are delayed from the clock crossing.
 */
import { expectPorts, range, type BehaviourContext, type BehaviourFactory, type EvalIO } from './behaviour';

type Kind = 'd' | 'jk' | 't' | 'sr';

interface AsyncPins {
  set: number;
  reset: number;
  setLow: boolean;
  resetLow: boolean;
}

/** Apply async set / reset; returns true when they control the outputs. */
function applyAsync(io: EvalIO, a: AsyncPins, q: number): boolean {
  const set = io.present[a.set] === 1 && io.in[a.set] === (a.setLow ? 0 : 1);
  const reset = io.present[a.reset] === 1 && io.in[a.reset] === (a.resetLow ? 0 : 1);
  if (set && reset) {
    io.out[q] = 1;
    io.out[q + 1] = 1;
    return true;
  }
  if (set) io.st[0] = 1;
  else if (reset) io.st[0] = 0;
  return set || reset;
}

function asyncPins(ctx: BehaviourContext, set: number): AsyncPins {
  return { set, reset: set + 1, setLow: ctx.p.flag('set_low'), resetLow: ctx.p.flag('reset_low') };
}

function writeQ(io: EvalIO, q: number): void {
  io.out[q] = io.st[0];
  io.out[q + 1] = 1 - io.st[0];
}

function flipflop(kind: Kind): BehaviourFactory {
  const nData = kind === 'jk' || kind === 'sr' ? 2 : 1;
  const names = { d: 'd', jk: 'j k', t: 't', sr: 's r' }[kind];
  return (ctx) => {
    expectPorts(ctx, nData + 5, `${names} clk set reset q qn`);
    const clk = nData;
    const pins = asyncPins(ctx, nData + 1);
    const rising = ctx.p.flag('clk_edge', true);
    const ic = ctx.p.flag('ic') ? 1 : 0;
    return {
      inputs: range(0, nData + 3),
      outputs: [{ port: nData + 3 }, { port: nData + 4 }],
      state: 1,
      init(io) {
        io.st[0] = ic;
      },
      eval(io) {
        if (applyAsync(io, pins, 0)) {
          if (io.out[0] === 1 && io.out[1] === 1) return;
        } else if (!io.dc && (rising ? io.rising(clk) : io.falling(clk))) {
          const t = io.cross[clk];
          io.setTime(t);
          const a = io.at(0, t);
          const b = nData === 2 ? io.at(1, t) : 0;
          const q = io.st[0];
          switch (kind) {
            case 'd':
              io.st[0] = a;
              break;
            case 't':
              if (a === 1) io.st[0] = 1 - q;
              break;
            case 'jk':
              if (a === 1 && b === 1) io.st[0] = 1 - q;
              else if (a === 1) io.st[0] = 1;
              else if (b === 1) io.st[0] = 0;
              break;
            case 'sr':
              if (a === 1 && b === 0) io.st[0] = 1;
              else if (a === 0 && b === 1) io.st[0] = 0;
              break;
          }
        }
        writeQ(io, 0);
      },
    };
  };
}

function latch(sr: boolean): BehaviourFactory {
  const nData = sr ? 2 : 1;
  return (ctx) => {
    expectPorts(ctx, nData + 5, `${sr ? 's r' : 'd'} enable set reset q qn`);
    const en = nData;
    const pins = asyncPins(ctx, nData + 1);
    const enLow = ctx.p.flag('enable_low');
    const ic = ctx.p.flag('ic') ? 1 : 0;
    return {
      inputs: range(0, nData + 3),
      outputs: [{ port: nData + 3 }, { port: nData + 4 }],
      state: 1,
      init(io) {
        io.st[0] = ic;
      },
      eval(io) {
        if (applyAsync(io, pins, 0)) {
          if (io.out[0] === 1 && io.out[1] === 1) return;
        } else if (io.present[en] === 0 || io.in[en] === (enLow ? 0 : 1)) {
          if (!sr) io.st[0] = io.in[0];
          else if (io.in[0] === 1 && io.in[1] === 0) io.st[0] = 1;
          else if (io.in[0] === 0 && io.in[1] === 1) io.st[0] = 0;
        }
        writeQ(io, 0);
      },
    };
  };
}

export const SEQUENTIAL_BEHAVIOURS: Record<string, BehaviourFactory> = {
  D_DFF: flipflop('d'),
  D_JKFF: flipflop('jk'),
  D_TFF: flipflop('t'),
  D_SRFF: flipflop('sr'),
  D_DLATCH: latch(false),
  D_SRLATCH: latch(true),
};
