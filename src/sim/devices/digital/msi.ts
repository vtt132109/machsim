/**
 * MSI building blocks as single code models (one element per function block of a 74xx / 40xx
 * part). Inputs and outputs are listed LSB first; '~' marks an active-low pin.
 *
 *   D_CNT_DIV2_DIV5   cka ckb r01 r02 r91 r92 qa qb qc qd         7490: ÷2 (cka -> qa) and ÷5
 *                                                                 (ckb -> qb qc qd), falling edges;
 *                                                                 r0 = r01·r02 clears, r9 = r91·r92
 *                                                                 presets 9 (dominates). ic = count.
 *   D_CNT_DIV2_DIV8   cka ckb r01 r02 qa qb qc qd                 7493: ÷2 and ÷8 sections.
 *   D_CNT_DIV2_DIV6   cka ckb r01 r02 qa qb qc qd                 7492: ÷2 and ÷6 sections (the ÷6
 *                                                                 section is ÷3 on qb qc then ÷2 on qd:
 *                                                                 qd qc qb = 000 001 010 100 101 110).
 *   D_CNT_SYNC        clk ~clr ~load enp ent d0..dn-1 q0..qn-1 rco
 *                                                                 74161 / 74163: synchronous binary
 *                                                                 counter, rising edge, synchronous
 *                                                                 load; clear asynchronous, or
 *                                                                 synchronous with sync_clear = 1;
 *                                                                 rco = ent · (q = modulus - 1);
 *                                                                 param modulus (default 2^n, 10 for
 *                                                                 the 74160 / 74162 decade counters).
 *   D_CNT_UPDOWN      up down clr ~load d0..dn-1 q0..qn-1 ~co ~bo  74193: counts on the rising edge
 *                                                                 of up (down high) or down (up
 *                                                                 high); clr (high) and ~load are
 *                                                                 asynchronous; ~co low while
 *                                                                 q = max and up low, ~bo low while
 *                                                                 q = 0 and down low; param modulus
 *                                                                 (10: 74192 decade counter).
 *   D_CNT_JOHNSON     clk ~inh rst q0..q(m-1) co                  4017 (m = 10): one-hot decoded
 *                                                                 Johnson counter; counts on clk
 *                                                                 rising with ~inh low or ~inh
 *                                                                 falling with clk high; co high
 *                                                                 for counts 0 .. m/2-1.
 *   D_CNT_RIPPLE      clk rst q(taps)...                          4040 / 4060: binary ripple counter
 *                                                                 of `stages` stages, falling edge,
 *                                                                 rst high clears; `tapmask` bit k
 *                                                                 = stage k+1 is brought out
 *                                                                 (default: every stage).
 *   D_SHIFT_SIPO      a b clk ~clr q0..q(n-1)                     74164: q0 <- a·b on rising clk.
 *   D_SHIFT_PISO      sh/~ld clk inh ser d0..d(n-1) qh ~qh         74165: ~ld low loads d
 *                                                                 asynchronously; shifts (stage 0
 *                                                                 <- ser) on the rising edge of
 *                                                                 clk OR inh.
 *   D_DECODER         a0..a(n-1) en_high... en_low... [stb] y0..  74138 / 74139: params n, en_high,
 *                                                                 en_low (enable counts), out_low
 *                                                                 (default 1: active-low outputs),
 *                                                                 outputs (count, default 2^n: 7442
 *                                                                 uses 10, codes 10-15 select none),
 *                                                                 strobe (1: address latch input stb,
 *                                                                 transparent while high; 4514).
 *   D_MUX             s0..s(n-1) d0..d(2^n-1) [~g] [~oe] y [w]    74151 / 74153 / 74157: params n,
 *                                                                 strobe (1 = ~g present), has_w
 *                                                                 (1 = complementary output w), tri
 *                                                                 (~g high releases the outputs
 *                                                                 instead of forcing y low: 74251 /
 *                                                                 74257), invert (y = ~selected:
 *                                                                 74158 / 74258), has_oe (separate
 *                                                                 active-low output enable: 4512).
 *   D_ADDER           a0..a(n-1) b0..b(n-1) cin s0..s(n-1) cout   74283
 *   D_MAGCOMP         a0..a(n-1) b0..b(n-1) i_gt i_eq i_lt o_gt o_eq o_lt   7485 with cascading.
 *   D_BCD7SEG         a b c d ~lt ~rbi ~bi/~rbo sa..sg            7447: open-collector active-low
 *                                                                 segment outputs; ~bi/~rbo is a
 *                                                                 bidirectional pin with internal
 *                                                                 pull-up (bi_pullup, default 4 kΩ).
 *                                                                 active_high = 1 (7448): a lit
 *                                                                 segment releases its output, pulled
 *                                                                 up by seg_pullup (default 2 kΩ);
 *                                                                 tails = 1 (74247 / 74248): 6 and 9
 *                                                                 with tails.
 *   D_BCD7SEG_LATCH   a b c d ~lt ~bl le sa..sg                   4511: latch (le high holds),
 *                                                                 active-high outputs, 10-15 blank.
 *   D_REGISTER        d0..d(n-1) clk ~clr q0..q(n-1) [~q0..~q(n-1)] 74174 / 74175: params has_qn,
 *                                                                 clr_low (default 1), clk_edge.
 *   D_ONESHOT         mode 0:   trig ~clr q ~q                    monostables: pulse width tw;
 *                     mode 121: ~a1 ~a2 b q ~q                    74121: trigger T = b·~(a1·a2),
 *                     mode 122: ~a1 ~a2 b1 b2 ~clr q ~q           74122: T = ~(a1·a2)·b1·b2·clr
 *                                                                 (retriggerable),
 *                     mode 123: ~a b ~clr q ~q                    74123: T = ~a·b·clr (retrigger-
 *                                                                 able); mode 221: same pins and
 *                                                                 trigger, not retriggerable (74221),
 *                     mode 4538: +tr -tr ~cd q ~q                 4538 / 4528: T = +tr + ~(-tr)
 *                                                                 (retriggerable); a pulse starts on
 *                                                                 the rising edge of T.
 *   D_TRANSCEIVER     dir ~oe a0..a(n-1) b0..b(n-1)               74245: dir = 1 drives B from A,
 *                                                                 dir = 0 drives A from B.
 *
 * Seven-segment patterns are bit masks a = bit 0 ... g = bit 6 (see SEGMENT_FONTS).
 */
import {
  Z,
  expectPorts,
  netlistError,
  range,
  setWord,
  word,
  wordAt,
  type Behaviour,
  type BehaviourContext,
  type BehaviourFactory,
  type EvalIO,
} from './behaviour';

/** Seven-segment fonts: index = input code (0..15), bit k = segment a..g. */
export const SEGMENT_FONTS = {
  /** 7446 / 7447: tailless 6 and 9, special symbols for 10..14, blank for 15. */
  ttl7447: [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7c, 0x07, 0x7f, 0x67, 0x58, 0x4c, 0x62, 0x69, 0x78, 0x00],
  /** 4511: tailless 6 and 9, codes 10..15 blank. */
  cmos4511: [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7c, 0x07, 0x7f, 0x67, 0, 0, 0, 0, 0, 0],
  /** Hexadecimal display: 0-9 (with tails), A b C d E F. */
  hex: [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f, 0x77, 0x7c, 0x39, 0x5e, 0x79, 0x71],
} as const;

const outs = (start: number, count: number) => range(start, count).map((port) => ({ port }));

function divisible(ctx: BehaviourContext, fixed: number, per: number, layout: string): number {
  const n = (ctx.ports - fixed) / per;
  if (!Number.isInteger(n) || n < 1) throw netlistError(ctx.name, `port count ${ctx.ports} does not match the layout ${layout}`);
  return n;
}

// ---------------------------------------------------------------------------------------------
// counters

/** Output word of the ÷B section for count k (binary, or the 7492's ÷3·÷2 sequence). */
type SectionCode = (k: number) => number;
const binaryCode: SectionCode = (k) => k;
/** 7492 ÷6 section: qb qc count ÷3, qd toggles every third count. */
const div6Code: SectionCode = (k) => (k % 3) + 4 * Math.floor(k / 3);

function sectionCounter(modB: number, nb: number, preset9: boolean, code: SectionCode = binaryCode): BehaviourFactory {
  const nIn = preset9 ? 6 : 4;
  return (ctx) => {
    expectPorts(ctx, nIn + 1 + nb, preset9 ? 'cka ckb r01 r02 r91 r92 qa qb qc qd' : 'cka ckb r01 r02 qa qb qc qd');
    const ic = Math.max(0, ctx.p.int('ic', 0));
    return {
      inputs: range(0, nIn),
      outputs: outs(nIn, 1 + nb),
      state: 2,
      init(io) {
        io.st[0] = ic % 2;
        io.st[1] = Math.floor(ic / 2) % modB;
      },
      eval(io) {
        const r0 = io.in[2] === 1 && io.in[3] === 1;
        const r9 = preset9 && io.in[4] === 1 && io.in[5] === 1;
        if (r9) {
          io.st[0] = 1;
          io.st[1] = 4;
        } else if (r0) {
          io.st[0] = 0;
          io.st[1] = 0;
        } else if (!io.dc) {
          if (io.falling(0)) io.st[0] = 1 - io.st[0];
          if (io.falling(1)) io.st[1] = (io.st[1] + 1) % modB;
        }
        io.out[0] = io.st[0];
        setWord(io, 1, nb, code(io.st[1]));
      },
    };
  };
}

/** Counter modulus parameter (2..full, default full). */
export function modulusOf(ctx: BehaviourContext, full: number): number {
  const m = ctx.p.int('modulus', full);
  if (!(m >= 2 && m <= full)) throw netlistError(ctx.name, `modulus must be 2..${full} (got ${m})`);
  return m;
}

/** Next count up: wraps at the modulus; a loaded state beyond it counts on in binary. */
export function countUp(q: number, m: number, full: number): number {
  return q < m ? (q + 1) % m : (q + 1) % full;
}

/** Next count down: 0 wraps to modulus - 1; a state beyond the modulus counts down in binary. */
export function countDown(q: number, m: number): number {
  return q === 0 ? m - 1 : q - 1;
}

const syncCounter: BehaviourFactory = (ctx) => {
  const n = divisible(ctx, 6, 2, 'clk ~clr ~load enp ent d0..dn-1 q0..qn-1 rco');
  const full = 2 ** n;
  const m = modulusOf(ctx, full);
  const syncClear = ctx.p.flag('sync_clear');
  const ic = Math.max(0, ctx.p.int('ic', 0)) % m;
  return {
    inputs: range(0, 5 + n),
    outputs: outs(5 + n, n + 1),
    state: 1,
    init(io) {
      io.st[0] = ic;
    },
    eval(io) {
      if (!syncClear && io.in[1] === 0) io.st[0] = 0;
      else if (!io.dc && io.rising(0)) {
        const t = io.cross[0];
        io.setTime(t);
        if (syncClear && io.at(1, t) === 0) io.st[0] = 0;
        else if (io.at(2, t) === 0) io.st[0] = wordAt(io, 5, n, t);
        else if (io.at(3, t) === 1 && io.at(4, t) === 1) io.st[0] = countUp(io.st[0], m, full);
      }
      setWord(io, 0, n, io.st[0]);
      io.out[n] = io.in[4] === 1 && io.st[0] === m - 1 ? 1 : 0;
    },
  };
};

const upDownCounter: BehaviourFactory = (ctx) => {
  const n = divisible(ctx, 6, 2, 'up down clr ~load d0..dn-1 q0..qn-1 ~co ~bo');
  const full = 2 ** n;
  const m = modulusOf(ctx, full);
  const ic = Math.max(0, ctx.p.int('ic', 0)) % m;
  return {
    inputs: range(0, 4 + n),
    outputs: outs(4 + n, n + 2),
    state: 1,
    init(io) {
      io.st[0] = ic;
    },
    eval(io) {
      if (io.in[2] === 1) io.st[0] = 0;
      else if (io.in[3] === 0) io.st[0] = word(io, 4, n);
      else if (!io.dc) {
        if (io.rising(0) && io.at(1, io.cross[0]) === 1) {
          io.st[0] = countUp(io.st[0], m, full);
          io.setTime(io.cross[0]);
        }
        if (io.rising(1) && io.at(0, io.cross[1]) === 1) {
          io.st[0] = countDown(io.st[0], m);
          io.setTime(io.cross[1]);
        }
      }
      const q = io.st[0];
      setWord(io, 0, n, q);
      io.out[n] = q === m - 1 && io.in[0] === 0 ? 0 : 1;
      io.out[n + 1] = q === 0 && io.in[1] === 0 ? 0 : 1;
    },
  };
};

const johnsonCounter: BehaviourFactory = (ctx) => {
  const m = ctx.ports - 4;
  if (m < 2) throw netlistError(ctx.name, `a Johnson counter needs clk ~inh rst, at least 2 decoded outputs and co (got ${ctx.ports} nodes)`);
  const ic = Math.max(0, ctx.p.int('ic', 0)) % m;
  return {
    inputs: [0, 1, 2],
    outputs: outs(3, m + 1),
    state: 1,
    init(io) {
      io.st[0] = ic;
    },
    eval(io) {
      if (io.in[2] === 1) io.st[0] = 0;
      else if (!io.dc) {
        const byClk = io.rising(0) && io.at(1, io.cross[0]) === 0;
        const byInh = io.falling(1) && io.at(0, io.cross[1]) === 1;
        if (byClk || byInh) {
          io.st[0] = (io.st[0] + 1) % m;
          io.setTime(byClk ? io.cross[0] : io.cross[1]);
        }
      }
      const c = io.st[0];
      for (let k = 0; k < m; k++) io.out[k] = c === k ? 1 : 0;
      io.out[m] = c < m / 2 ? 1 : 0;
    },
  };
};

const rippleCounter: BehaviourFactory = (ctx) => {
  const nOut = ctx.ports - 2;
  if (nOut < 1) throw netlistError(ctx.name, 'a ripple counter needs clk rst and at least one output');
  const stages = ctx.p.int('stages', nOut);
  if (stages < 1 || stages > 40) throw netlistError(ctx.name, `stages must be 1..40 (got ${stages})`);
  const mask = ctx.p.get('tapmask');
  const taps: number[] = [];
  if (mask === undefined) for (let k = 0; k < stages; k++) taps.push(k);
  else for (let k = 0; k < stages; k++) if (Math.floor(mask / 2 ** k) % 2 === 1) taps.push(k);
  if (taps.length !== nOut) throw netlistError(ctx.name, `tapmask selects ${taps.length} stages but ${nOut} outputs are connected`);
  const m = 2 ** stages;
  return {
    inputs: [0, 1],
    outputs: outs(2, nOut),
    state: 1,
    eval(io) {
      if (io.in[1] === 1) io.st[0] = 0;
      else if (!io.dc && io.falling(0)) io.st[0] = (io.st[0] + 1) % m;
      const c = io.st[0];
      taps.forEach((k, i) => {
        io.out[i] = Math.floor(c / 2 ** k) % 2;
      });
    },
  };
};

// ---------------------------------------------------------------------------------------------
// shift registers

const sipo: BehaviourFactory = (ctx) => {
  const n = ctx.ports - 4;
  if (n < 1) throw netlistError(ctx.name, 'a SIPO shift register needs a b clk ~clr and at least one output');
  const m = 2 ** n;
  return {
    inputs: [0, 1, 2, 3],
    outputs: outs(4, n),
    state: 1,
    eval(io) {
      if (io.in[3] === 0) io.st[0] = 0;
      else if (!io.dc && io.rising(2)) {
        const t = io.cross[2];
        io.setTime(t);
        const din = io.at(0, t) & io.at(1, t);
        io.st[0] = (io.st[0] * 2 + din) % m;
      }
      setWord(io, 0, n, io.st[0]);
    },
  };
};

const piso: BehaviourFactory = (ctx) => {
  const n = ctx.ports - 6;
  if (n < 1) throw netlistError(ctx.name, 'a PISO shift register needs sh/~ld clk inh ser, data inputs, qh and ~qh');
  const m = 2 ** n;
  return {
    inputs: range(0, 4 + n),
    outputs: outs(4 + n, 2),
    state: 1,
    eval(io) {
      if (io.in[0] === 0) io.st[0] = word(io, 4, n);
      else if (!io.dc) {
        const before = io.prev[1] | io.prev[2];
        const after = io.in[1] | io.in[2];
        if (before === 0 && after === 1) {
          const t = Math.max(io.cross[1], io.cross[2]);
          io.setTime(t);
          io.st[0] = (io.st[0] * 2 + io.at(3, t)) % m;
        }
      }
      const qh = Math.floor(io.st[0] / 2 ** (n - 1)) % 2;
      io.out[0] = qh;
      io.out[1] = 1 - qh;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// decoders, multiplexers, arithmetic

const decoder: BehaviourFactory = (ctx) => {
  const eh = Math.max(0, ctx.p.int('en_high', 0));
  const el = Math.max(0, ctx.p.int('en_low', 0));
  const stb = ctx.p.flag('strobe') ? 1 : 0;
  const count = ctx.p.get('outputs');
  let n = ctx.p.get('n');
  if (n === undefined) {
    for (let k = 1; k <= 8; k++) if (k + eh + el + stb + (count ?? 2 ** k) === ctx.ports) n = k;
  }
  const nOut = count === undefined || n === undefined ? 2 ** (n ?? 0) : Math.round(count);
  if (n === undefined || !Number.isInteger(n) || n < 1 || nOut < 1 || nOut > 2 ** n || n + eh + el + stb + nOut !== ctx.ports) {
    throw netlistError(ctx.name, `port count ${ctx.ports} does not match a decoder with ${eh} high and ${el} low enables`);
  }
  const bits = n;
  const activeLow = ctx.p.flag('out_low', true);
  const first = bits + eh + el + stb;
  return {
    inputs: range(0, first),
    outputs: outs(first, nOut),
    state: stb,
    eval(io) {
      let enabled = true;
      for (let k = 0; k < eh; k++) if (io.in[bits + k] !== 1) enabled = false;
      for (let k = 0; k < el; k++) if (io.in[bits + eh + k] !== 0) enabled = false;
      let a = word(io, 0, bits);
      if (stb) {
        // address latch: transparent while the strobe is high
        if (io.in[bits + eh + el] === 1) io.st[0] = a;
        a = io.st[0];
      }
      for (let k = 0; k < nOut; k++) {
        const on = enabled && k === a;
        io.out[k] = on !== activeLow ? 1 : 0;
      }
    },
  };
};

const mux: BehaviourFactory = (ctx) => {
  const strobe = ctx.p.flag('strobe') ? 1 : 0;
  const hasW = ctx.p.flag('has_w') ? 1 : 0;
  const hasOe = ctx.p.flag('has_oe') ? 1 : 0;
  const tri = ctx.p.flag('tri');
  const invert = ctx.p.flag('invert');
  const fixed = strobe + hasOe + 1 + hasW;
  let n = ctx.p.get('n');
  if (n === undefined) for (let k = 1; k <= 6; k++) if (k + 2 ** k + fixed === ctx.ports) n = k;
  if (n === undefined || !Number.isInteger(n) || n < 1 || n + 2 ** n + fixed !== ctx.ports) {
    throw netlistError(ctx.name, `port count ${ctx.ports} does not match a multiplexer (strobe=${strobe}, has_oe=${hasOe}, has_w=${hasW})`);
  }
  const bits = n;
  const nData = 2 ** bits;
  const nIn = bits + nData + strobe + hasOe;
  return {
    inputs: range(0, nIn),
    outputs: outs(nIn, 1 + hasW),
    state: 0,
    eval(io) {
      const off = strobe === 1 && io.in[bits + nData] === 1;
      const released = (off && tri) || (hasOe === 1 && io.present[bits + nData + strobe] === 1 && io.in[bits + nData + strobe] === 1);
      if (released) {
        io.out[0] = Z;
        if (hasW) io.out[1] = Z;
        return;
      }
      const sel = off ? 0 : io.in[bits + word(io, 0, bits)];
      const y = invert ? 1 - sel : sel;
      io.out[0] = y;
      if (hasW) io.out[1] = 1 - sel;
    },
  };
};

const adder: BehaviourFactory = (ctx) => {
  const n = divisible(ctx, 2, 3, 'a0..a(n-1) b0..b(n-1) cin s0..s(n-1) cout');
  return {
    inputs: range(0, 2 * n + 1),
    outputs: outs(2 * n + 1, n + 1),
    state: 0,
    eval(io) {
      const sum = word(io, 0, n) + word(io, n, n) + io.in[2 * n];
      setWord(io, 0, n + 1, sum);
    },
  };
};

const magComp: BehaviourFactory = (ctx) => {
  const n = divisible(ctx, 6, 2, 'a0..a(n-1) b0..b(n-1) i_gt i_eq i_lt o_gt o_eq o_lt');
  return {
    inputs: range(0, 2 * n + 3),
    outputs: outs(2 * n + 3, 3),
    state: 0,
    eval(io) {
      const a = word(io, 0, n);
      const b = word(io, n, n);
      const gt = io.in[2 * n];
      const eq = io.in[2 * n + 1];
      const lt = io.in[2 * n + 2];
      let r: [number, number, number];
      if (a > b) r = [1, 0, 0];
      else if (a < b) r = [0, 0, 1];
      else if (eq === 1) r = [0, 1, 0];
      else if (gt === 1 && lt === 0) r = [1, 0, 0];
      else if (gt === 0 && lt === 1) r = [0, 0, 1];
      else if (gt === 1 && lt === 1) r = [0, 0, 0];
      else r = [1, 0, 1];
      io.out[0] = r[0];
      io.out[1] = r[1];
      io.out[2] = r[2];
    },
  };
};

// ---------------------------------------------------------------------------------------------
// seven-segment decoders

function writeSegments(io: EvalIO, mask: number, activeLow: boolean): void {
  for (let k = 0; k < 7; k++) {
    const on = Math.floor(mask / 2 ** k) % 2 === 1;
    io.out[k] = on !== activeLow ? 1 : 0;
  }
}

const bcd7segTtl: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 14, 'a b c d ~lt ~rbi ~bi/~rbo sa..sg');
  const pullup = ctx.p.positive('bi_pullup', 4e3);
  const activeHigh = ctx.p.flag('active_high');
  const segPullup = activeHigh ? ctx.p.positive('seg_pullup', 2e3) : undefined;
  const base = SEGMENT_FONTS.ttl7447;
  const font = ctx.p.flag('tails') ? base.map((m, k) => (k === 6 ? 0x7d : k === 9 ? 0x6f : m)) : base;
  const b: Behaviour = {
    inputs: range(0, 7),
    outputs: [...range(7, 7).map((port) => ({ port, openDrain: true, pullup: segPullup })), { port: 6, openDrain: true, pullup }],
    state: 0,
    eval(io) {
      const code = word(io, 0, 4);
      const rbo = io.in[4] === 1 && io.in[5] === 0 && code === 0;
      const blank = io.in[6] === 0 || rbo;
      const mask = blank ? 0 : io.in[4] === 0 ? 0x7f : font[code];
      writeSegments(io, mask, !activeHigh);
      io.out[7] = rbo ? 0 : 1;
    },
  };
  return b;
};

const bcd7segLatch: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 14, 'a b c d ~lt ~bl le sa..sg');
  const font = SEGMENT_FONTS.cmos4511;
  return {
    inputs: range(0, 7),
    outputs: outs(7, 7),
    state: 1,
    eval(io) {
      if (io.in[6] === 0) io.st[0] = word(io, 0, 4);
      const mask = io.in[4] === 0 ? 0x7f : io.in[5] === 0 ? 0 : font[io.st[0] % 16];
      writeSegments(io, mask, false);
    },
  };
};

// ---------------------------------------------------------------------------------------------
// registers, monostables, transceivers

const register: BehaviourFactory = (ctx) => {
  const hasQn = ctx.p.flag('has_qn');
  const n = divisible(ctx, 2, hasQn ? 3 : 2, hasQn ? 'd0..d(n-1) clk ~clr q0..q(n-1) ~q0..~q(n-1)' : 'd0..d(n-1) clk ~clr q0..q(n-1)');
  const clrLow = ctx.p.flag('clr_low', true);
  const rising = ctx.p.flag('clk_edge', true);
  return {
    inputs: range(0, n + 2),
    outputs: outs(n + 2, hasQn ? 2 * n : n),
    state: 1,
    eval(io) {
      if (io.present[n + 1] === 1 && io.in[n + 1] === (clrLow ? 0 : 1)) io.st[0] = 0;
      else if (!io.dc && (rising ? io.rising(n) : io.falling(n))) {
        const t = io.cross[n];
        io.setTime(t);
        io.st[0] = wordAt(io, 0, n, t);
      }
      setWord(io, 0, n, io.st[0]);
      if (hasQn) for (let k = 0; k < n; k++) io.out[n + k] = 1 - io.out[k];
    },
  };
};

const oneShot: BehaviourFactory = (ctx) => {
  const mode = ctx.p.int('mode', 0);
  const layouts: Record<number, [number, string]> = {
    0: [4, 'trig ~clr q ~q'],
    121: [5, '~a1 ~a2 b q ~q'],
    122: [7, '~a1 ~a2 b1 b2 ~clr q ~q'],
    123: [5, '~a b ~clr q ~q'],
    221: [5, '~a b ~clr q ~q'],
    4538: [5, '+tr -tr ~cd q ~q'],
  };
  const lay = layouts[mode];
  if (!lay) throw netlistError(ctx.name, `one-shot mode must be 0, 121, 122, 123, 221 or 4538 (got ${mode})`);
  expectPorts(ctx, lay[0], lay[1]);
  const tw = ctx.p.positive('tw', 1e-6);
  const retrig = ctx.p.flag('retrig', mode === 123 || mode === 122 || mode === 4538);
  const nIn = lay[0] - 2;
  const trigger = (v: Uint8Array): number => {
    if (mode === 121) return v[2] === 1 && !(v[0] === 1 && v[1] === 1) ? 1 : 0;
    if (mode === 122) return !(v[0] === 1 && v[1] === 1) && v[2] === 1 && v[3] === 1 && v[4] === 1 ? 1 : 0;
    if (mode === 123 || mode === 221) return v[0] === 0 && v[1] === 1 && v[2] === 1 ? 1 : 0;
    if (mode === 4538) return v[0] === 1 || v[1] === 0 ? 1 : 0;
    return v[0];
  };
  const clrIndex = mode === 123 || mode === 221 || mode === 4538 ? 2 : mode === 122 ? 4 : mode === 0 ? 1 : -1;
  return {
    inputs: range(0, nIn),
    outputs: outs(nIn, 2),
    state: 2,
    eval(io) {
      const cleared = clrIndex >= 0 && io.present[clrIndex] === 1 && io.in[clrIndex] === 0;
      if (cleared) io.st[0] = 0;
      else if (!io.dc) {
        if (trigger(io.prev) === 0 && trigger(io.in) === 1 && (io.st[0] === 0 || retrig)) {
          io.st[0] = 1;
          io.st[1] = io.time + tw;
          io.wake(io.st[1]);
        }
        if (io.timer && io.st[0] === 1 && io.now >= io.st[1] - 1e-9 * Math.max(io.now, 1e-12)) io.st[0] = 0;
      }
      io.out[0] = io.st[0];
      io.out[1] = 1 - io.st[0];
    },
  };
};

const transceiver: BehaviourFactory = (ctx) => {
  const n = divisible(ctx, 2, 2, 'dir ~oe a0..a(n-1) b0..b(n-1)');
  return {
    inputs: range(0, 2 + 2 * n),
    outputs: outs(2, 2 * n),
    state: 0,
    eval(io) {
      const enabled = io.in[1] === 0;
      const aToB = io.in[0] === 1;
      for (let k = 0; k < n; k++) {
        io.out[k] = enabled && !aToB ? io.in[2 + n + k] : Z;
        io.out[n + k] = enabled && aToB ? io.in[2 + k] : Z;
      }
    },
  };
};

export const MSI_BEHAVIOURS: Record<string, BehaviourFactory> = {
  D_CNT_DIV2_DIV5: sectionCounter(5, 3, true),
  D_CNT_DIV2_DIV8: sectionCounter(8, 3, false),
  D_CNT_DIV2_DIV6: sectionCounter(6, 3, false, div6Code),
  D_CNT_SYNC: syncCounter,
  D_CNT_UPDOWN: upDownCounter,
  D_CNT_JOHNSON: johnsonCounter,
  D_CNT_RIPPLE: rippleCounter,
  D_SHIFT_SIPO: sipo,
  D_SHIFT_PISO: piso,
  D_DECODER: decoder,
  D_MUX: mux,
  D_ADDER: adder,
  D_MAGCOMP: magComp,
  D_BCD7SEG: bcd7segTtl,
  D_BCD7SEG_LATCH: bcd7segLatch,
  D_REGISTER: register,
  D_ONESHOT: oneShot,
  D_TRANSCEIVER: transceiver,
};
