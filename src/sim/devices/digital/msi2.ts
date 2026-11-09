/**
 * More MSI function blocks for the 74xx / 4000 catalogue (one code model per function block).
 * Inputs and outputs are listed LSB first; '~' marks an active-low pin.
 *
 * Counters
 *   D_CNT_UD1      clk ~cten dn ~load d0..d(n-1) q0..q(n-1) maxmin ~rco
 *                  74190 / 74191: single-clock up / down counter. Counts on the rising clock edge
 *                  while ~cten is low (dn low = up, high = down); ~load is asynchronous; maxmin is
 *                  high at the end of the count (max going up, 0 going down); ~rco = low while
 *                  ~cten, clk are low and maxmin is high. Param modulus (10: 74190).
 *   D_CNT_UD2      clk ud ~load ~enp ~ent d0..d(n-1) q0..q(n-1) ~rco
 *                  74168 / 74169: synchronous up / down counter, ud high = up, synchronous load,
 *                  counts while ~enp = ~ent = 0, ~rco low while ~ent is low at the end of the
 *                  count. Param modulus (10: 74168).
 *   D_CNT_UD3      clk pe ~ci ud [rst] [bd] p0..p(n-1) q0..q(n-1) ~co
 *                  4510 / 4516 / 4029: preset enable pe (async, high), carry in ~ci, ud high = up,
 *                  rst (async, high; has_rst = 0 removes it), bd high = binary / low = decade
 *                  (has_bd = 1, 4029), else param modulus. ~co low when ~ci is low at the end of
 *                  the count.
 *   D_CNT_EN       clk en rst q0..q(n-1)
 *                  4518 / 4520: counts on clk rising while en is high, or on en falling while clk
 *                  is low; rst high clears. Param modulus (10: 4518).
 *   D_CNT_7SEG     clk inh rst dei sa..sg co deo uc
 *                  4026: decade counter with a seven-segment decoder (tails on 6 and 9); counts on
 *                  clk rising while inh is low; dei low blanks the segments (deo = dei); co is high
 *                  for counts 0-4; uc = segment c, not blanked.
 * Shift registers
 *   D_SHIFT_UNIV   s0 s1 dsr dsl ~clr clk d0..d(n-1) q0..q(n-1)
 *                  74194: s1 s0 = 00 hold, 01 shift toward q(n-1) (q0 <- dsr), 10 shift toward q0
 *                  (q(n-1) <- dsl), 11 parallel load; rising clock; ~clr asynchronous.
 *   D_SHIFT_JK     j ~k sh/~ld clk ~clr d0..d(n-1) q0..q(n-1) ~q(n-1)
 *                  74195: sh/~ld low loads on the clock edge; high shifts, q0 <- J·~q0 + ~K·q0.
 *   D_SHIFT_STORE  ser srclk [~srclr] rclk oe q0..q(n-1) qs [qs2]
 *                  74595 / 4094: serial shift register (q0 side first) with a storage register:
 *                  rclk rising copies it (latch = 1: transparent while rclk is high, 4094); oe low
 *                  enables the 3-state outputs (oe_high = 1: high enables); qs = last stage
 *                  (always driven), qs2 (has_qs2) = last stage re-timed on the falling clock.
 *   D_SHIFT_PISO2  ser clk [inh] ld [~clr] d0..d(n-1) outputs...
 *                  74166 / 4014 / 4021: parallel load when ld = load level (load_high), on the
 *                  clock edge or at once (async_load); otherwise shifts toward the last stage
 *                  (stage 0 <- ser) on the rising edge of clk OR inh; param taps = bit mask of
 *                  the stages brought out (default: the last one only).
 * Registers and latches
 *   D_REG          d0..d(n-1) clk [~oe x oe] [~en x en] [clr] [pol] q0..q(n-1) [~q0..]
 *                  generic n-bit register / latch: latch = 1 (transparent while clk = active
 *                  level, le_low = 1: active low), else edge-triggered (clk_edge, default rising);
 *                  oe = number of active-low output enables (3-state), oe_high = 1: active high;
 *                  en = number of active-low load enables (74377 / 74173), clr (has_clr, clr_low
 *                  default 1, async), pol (4042: transparent while clk equals pol), invert (q =
 *                  ~d), has_qn.
 *   D_ADDR_LATCH   a0..a(n-1) d g clr q0..q(2^n-1)
 *                  74259 / 4099 addressable latch: g active and clr inactive: the addressed latch
 *                  follows d; g inactive: hold; g active and clr active: demultiplexer; clr active
 *                  and g inactive: all cleared. Params g_low, clr_low (default 1 = 74259).
 *   D_SRLATCH_N    ~s1 [~s2] ~r q
 *                  74279: active-low set-reset latch (ns = 1 or 2 set inputs); both active: q high.
 * Encoders, arithmetic, parity, gates
 *   D_PRIENC       mode 148: ~i0..~i7 ~ei ~a0 ~a1 ~a2 ~gs ~eo      (8-to-3 priority, i7 highest)
 *                  mode 147: ~i1..~i9 ~a ~b ~c ~d                 (10-to-4 BCD priority)
 *                  mode 4532: d0..d7 ei q0 q1 q2 gs eo           (active-high 8-to-3)
 *   D_ALU181       a0..a3 b0..b3 s0..s3 m cn f0..f3 aeqb ~p ~g cn4
 *                  74181 (active-high data): t1 = A + (S0·B) + (S1·~B), t2 = S2·A·~B + S3·A·B
 *                  (bitwise OR / AND); arithmetic (m = 0): F = t1 plus t2 plus ~cn; logic (m = 1):
 *                  F = ~(t1 XOR t2); cn4 = ~carry out, ~g = ~(t1 + t2 >= 16), ~p = ~(t1 = 15);
 *                  aeqb (open collector) high when F = 1111.
 *   D_CLA182       cn ~g0 ~p0 ~g1 ~p1 ~g2 ~p2 ~g3 ~p3 cnx cny cnz ~g ~p   74182 look-ahead.
 *   D_EQCOMP       p0..p(n-1) q0..q(n-1) [~g] ~peq [~pgt]
 *                  74688 / 74682: ~peq low when P = Q (and ~g low, has_g); ~pgt low when P > Q.
 *   D_PARITY       i0..i(n-1) [even_in odd_in] even odd
 *                  74280: even = 1 for an even number of high inputs; ctrl = 1 (74180) adds the
 *                  cascade inputs: (1,0) as 74280, (0,1) swapped, (1,1) both low, (0,0) both high.
 *   D_AOI          inputs of each AND group ... y
 *                  AND-OR(-INVERT): param groups = AND-group sizes as decimal digits (22 = two
 *                  2-input groups), invert (default 1).
 */
import { Z, expectPorts, netlistError, range, setWord, word, wordAt, type BehaviourContext, type BehaviourFactory, type EvalIO } from './behaviour';
import { SEGMENT_FONTS, countDown, countUp, modulusOf } from './msi';

const outs = (start: number, count: number) => range(start, count).map((port) => ({ port }));

function solveN(ctx: BehaviourContext, fixed: number, per: number, layout: string): number {
  const n = (ctx.ports - fixed) / per;
  if (!Number.isInteger(n) || n < 1 || n > 24) throw netlistError(ctx.name, `port count ${ctx.ports} does not match the layout ${layout}`);
  return n;
}

/** Explicit width parameter n (checked against the port count by the caller). */
function widthParam(ctx: BehaviourContext): number {
  const n = ctx.p.int('n', 0);
  if (!(n >= 1 && n <= 32)) throw netlistError(ctx.name, `parameter n (width) must be 1..32 (got ${n})`);
  return n;
}

function checkPorts(ctx: BehaviourContext, expected: number, layout: string): void {
  if (ctx.ports !== expected) throw netlistError(ctx.name, `expected ${expected} port nodes (${layout}), got ${ctx.ports}`);
}

// ---------------------------------------------------------------------------------------------
// counters

const counterUd1: BehaviourFactory = (ctx) => {
  const n = solveN(ctx, 6, 2, 'clk ~cten dn ~load d0..d(n-1) q0..q(n-1) maxmin ~rco');
  const full = 2 ** n;
  const m = modulusOf(ctx, full);
  return {
    inputs: range(0, 4 + n),
    outputs: outs(4 + n, n + 2),
    state: 1,
    eval(io) {
      if (io.in[3] === 0) io.st[0] = word(io, 4, n);
      else if (!io.dc && io.rising(0)) {
        const t = io.cross[0];
        if (io.at(1, t) === 0) {
          io.setTime(t);
          io.st[0] = io.at(2, t) === 0 ? countUp(io.st[0], m, full) : countDown(io.st[0], m);
        }
      }
      const q = io.st[0];
      setWord(io, 0, n, q);
      const maxmin = (io.in[2] === 0 && q === m - 1) || (io.in[2] === 1 && q === 0);
      io.out[n] = maxmin ? 1 : 0;
      io.out[n + 1] = io.in[1] === 0 && io.in[0] === 0 && maxmin ? 0 : 1;
    },
  };
};

const counterUd2: BehaviourFactory = (ctx) => {
  const n = solveN(ctx, 6, 2, 'clk ud ~load ~enp ~ent d0..d(n-1) q0..q(n-1) ~rco');
  const full = 2 ** n;
  const m = modulusOf(ctx, full);
  return {
    inputs: range(0, 5 + n),
    outputs: outs(5 + n, n + 1),
    state: 1,
    eval(io) {
      if (!io.dc && io.rising(0)) {
        const t = io.cross[0];
        io.setTime(t);
        if (io.at(2, t) === 0) io.st[0] = wordAt(io, 5, n, t);
        else if (io.at(3, t) === 0 && io.at(4, t) === 0) io.st[0] = io.at(1, t) === 1 ? countUp(io.st[0], m, full) : countDown(io.st[0], m);
      }
      const q = io.st[0];
      setWord(io, 0, n, q);
      const end = io.in[1] === 1 ? q === m - 1 : q === 0;
      io.out[n] = io.in[4] === 0 && end ? 0 : 1;
    },
  };
};

const counterUd3: BehaviourFactory = (ctx) => {
  const hasRst = ctx.p.flag('has_rst', true) ? 1 : 0;
  const hasBd = ctx.p.flag('has_bd') ? 1 : 0;
  const fixed = 5 + hasRst + hasBd;
  const n = solveN(ctx, fixed, 2, 'clk pe ~ci ud [rst] [bd] p0..p(n-1) q0..q(n-1) ~co');
  const full = 2 ** n;
  const fixedM = hasBd ? full : modulusOf(ctx, full);
  const rst = hasRst ? 4 : -1;
  const bd = hasBd ? 4 + hasRst : -1;
  const p0 = 4 + hasRst + hasBd;
  return {
    inputs: range(0, p0 + n),
    outputs: outs(p0 + n, n + 1),
    state: 1,
    eval(io) {
      const m = bd >= 0 ? (io.in[bd] === 1 ? full : Math.min(10, full)) : fixedM;
      if (rst >= 0 && io.in[rst] === 1) io.st[0] = 0;
      else if (io.in[1] === 1) io.st[0] = word(io, p0, n);
      else if (!io.dc && io.rising(0)) {
        const t = io.cross[0];
        if (io.at(2, t) === 0) {
          io.setTime(t);
          io.st[0] = io.at(3, t) === 1 ? countUp(io.st[0], m, full) : countDown(io.st[0], m);
        }
      }
      const q = io.st[0];
      setWord(io, 0, n, q);
      const end = io.in[3] === 1 ? q === m - 1 : q === 0;
      io.out[n] = io.in[2] === 0 && end ? 0 : 1;
    },
  };
};

const counterEn: BehaviourFactory = (ctx) => {
  const n = ctx.ports - 3;
  if (n < 1 || n > 24) throw netlistError(ctx.name, 'an enable counter needs clk en rst and outputs');
  const full = 2 ** n;
  const m = modulusOf(ctx, full);
  return {
    inputs: [0, 1, 2],
    outputs: outs(3, n),
    state: 1,
    eval(io) {
      if (io.in[2] === 1) io.st[0] = 0;
      else if (!io.dc) {
        const byClk = io.rising(0) && io.at(1, io.cross[0]) === 1;
        const byEn = io.falling(1) && io.at(0, io.cross[1]) === 0;
        if (byClk || byEn) {
          io.setTime(byClk ? io.cross[0] : io.cross[1]);
          io.st[0] = countUp(io.st[0], m, full);
        }
      }
      setWord(io, 0, n, io.st[0]);
    },
  };
};

const counter7seg: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 14, 'clk inh rst dei sa..sg co deo uc');
  const font = SEGMENT_FONTS.hex;
  return {
    inputs: [0, 1, 2, 3],
    outputs: outs(4, 10),
    state: 1,
    eval(io) {
      if (io.in[2] === 1) io.st[0] = 0;
      else if (!io.dc && io.rising(0) && io.at(1, io.cross[0]) === 0) {
        io.setTime(io.cross[0]);
        io.st[0] = (io.st[0] + 1) % 10;
      }
      const c = io.st[0];
      const mask = font[c];
      const shown = io.in[3] === 1 ? mask : 0;
      for (let k = 0; k < 7; k++) io.out[k] = Math.floor(shown / 2 ** k) % 2;
      io.out[7] = c < 5 ? 1 : 0;
      io.out[8] = io.in[3];
      io.out[9] = Math.floor(mask / 4) % 2;
    },
  };
};

// ---------------------------------------------------------------------------------------------
// shift registers

const shiftUniversal: BehaviourFactory = (ctx) => {
  const n = solveN(ctx, 6, 2, 's0 s1 dsr dsl ~clr clk d0..d(n-1) q0..q(n-1)');
  const top = 2 ** (n - 1);
  const m = 2 ** n;
  return {
    inputs: range(0, 6 + n),
    outputs: outs(6 + n, n),
    state: 1,
    eval(io) {
      if (io.in[4] === 0) io.st[0] = 0;
      else if (!io.dc && io.rising(5)) {
        const t = io.cross[5];
        io.setTime(t);
        const mode = io.at(0, t) + 2 * io.at(1, t);
        const q = io.st[0];
        if (mode === 1) io.st[0] = ((q * 2) % m) + io.at(2, t);
        else if (mode === 2) io.st[0] = Math.floor(q / 2) + top * io.at(3, t);
        else if (mode === 3) io.st[0] = wordAt(io, 6, n, t);
      }
      setWord(io, 0, n, io.st[0]);
    },
  };
};

const shiftJk: BehaviourFactory = (ctx) => {
  const n = solveN(ctx, 6, 2, 'j ~k sh/~ld clk ~clr d0..d(n-1) q0..q(n-1) ~q(n-1)');
  const m = 2 ** n;
  return {
    inputs: range(0, 5 + n),
    outputs: outs(5 + n, n + 1),
    state: 1,
    eval(io) {
      if (io.in[4] === 0) io.st[0] = 0;
      else if (!io.dc && io.rising(3)) {
        const t = io.cross[3];
        io.setTime(t);
        const q = io.st[0];
        if (io.at(2, t) === 0) io.st[0] = wordAt(io, 5, n, t);
        else {
          const q0 = q % 2;
          const j = io.at(0, t);
          const kb = io.at(1, t);
          const next = q0 === 0 ? j : kb;
          io.st[0] = ((q * 2) % m) + next;
        }
      }
      setWord(io, 0, n, io.st[0]);
      io.out[n] = 1 - io.out[n - 1];
    },
  };
};

const shiftStore: BehaviourFactory = (ctx) => {
  const hasClr = ctx.p.flag('has_clr', true) ? 1 : 0;
  const hasQs2 = ctx.p.flag('has_qs2') ? 1 : 0;
  const latch = ctx.p.flag('latch');
  const oeHigh = ctx.p.flag('oe_high');
  const n = ctx.ports - 4 - hasClr - 1 - hasQs2;
  if (n < 1 || n > 24) throw netlistError(ctx.name, 'a shift / store register needs ser srclk [~srclr] rclk oe, outputs and qs');
  const m = 2 ** n;
  const clr = hasClr ? 2 : -1;
  const rclk = 2 + hasClr;
  const oe = rclk + 1;
  return {
    inputs: range(0, oe + 1),
    outputs: [...outs(oe + 1, n), { port: oe + 1 + n }, ...(hasQs2 ? [{ port: oe + 2 + n }] : [])],
    // st0 shift register, st1 storage register, st2 re-timed last stage
    state: 3,
    eval(io) {
      // storage first: on a shared clock edge it takes the value before the shift
      if (latch) {
        if (io.in[rclk] === 1) io.st[1] = io.st[0];
      } else if (!io.dc && io.rising(rclk)) {
        io.setTime(io.cross[rclk]);
        io.st[1] = io.st[0];
      }
      if (clr >= 0 && io.in[clr] === 0) io.st[0] = 0;
      else if (!io.dc && io.rising(1)) {
        const t = io.cross[1];
        io.setTime(t);
        io.st[0] = ((io.st[0] * 2) % m) + io.at(0, t);
      }
      if (latch && io.in[rclk] === 1) io.st[1] = io.st[0];
      const last = Math.floor(io.st[0] / 2 ** (n - 1)) % 2;
      if (!io.dc && io.falling(1)) io.st[2] = last;
      if (io.dc) io.st[2] = last;
      const enabled = io.present[oe] === 0 || io.in[oe] === (oeHigh ? 1 : 0);
      if (enabled) setWord(io, 0, n, io.st[1]);
      else for (let k = 0; k < n; k++) io.out[k] = Z;
      io.out[n] = last;
      if (hasQs2) io.out[n + 1] = io.st[2];
    },
  };
};

const shiftPiso2: BehaviourFactory = (ctx) => {
  const n = widthParam(ctx);
  const hasInh = ctx.p.flag('has_inh') ? 1 : 0;
  const hasClr = ctx.p.flag('has_clr') ? 1 : 0;
  const loadHigh = ctx.p.flag('load_high');
  const asyncLoad = ctx.p.flag('async_load');
  const mask = ctx.p.int('taps', 2 ** (n - 1));
  const taps = range(0, n).filter((k) => Math.floor(mask / 2 ** k) % 2 === 1);
  const inh = hasInh ? 2 : -1;
  const ld = 2 + hasInh;
  const clr = hasClr ? ld + 1 : -1;
  const d0 = ld + 1 + hasClr;
  checkPorts(ctx, d0 + n + taps.length, 'ser clk [inh] ld [~clr] d0..d(n-1) taps');
  const m = 2 ** n;
  // the shift register's stage 0 receives ser; the last stage (n-1) is the serial output
  return {
    inputs: range(0, d0 + n),
    outputs: outs(d0 + n, taps.length),
    state: 1,
    eval(io) {
      const loading = io.in[ld] === (loadHigh ? 1 : 0);
      if (clr >= 0 && io.in[clr] === 0) io.st[0] = 0;
      else if (asyncLoad && loading) io.st[0] = word(io, d0, n);
      else if (!io.dc) {
        const before = io.prev[1] | (inh >= 0 ? io.prev[inh] : 0);
        const after = io.in[1] | (inh >= 0 ? io.in[inh] : 0);
        if (before === 0 && after === 1) {
          const t = Math.max(io.cross[1], inh >= 0 ? io.cross[inh] : -Infinity);
          io.setTime(t);
          if (!asyncLoad && io.at(ld, t) === (loadHigh ? 1 : 0)) io.st[0] = wordAt(io, d0, n, t);
          else io.st[0] = ((io.st[0] * 2) % m) + io.at(0, t);
        }
      }
      // stage k of the data word: d0 is loaded into the stage shifted out last
      taps.forEach((k, i) => {
        io.out[i] = Math.floor(io.st[0] / 2 ** k) % 2;
      });
    },
  };
};

// ---------------------------------------------------------------------------------------------
// registers and latches

const register: BehaviourFactory = (ctx) => {
  const n = widthParam(ctx);
  const isLatch = ctx.p.flag('latch');
  const leLow = ctx.p.flag('le_low');
  const rising = ctx.p.flag('clk_edge', true);
  const nOe = Math.max(0, ctx.p.int('oe', 0));
  const oeHigh = ctx.p.flag('oe_high');
  const nEn = Math.max(0, ctx.p.int('en', 0));
  const hasClr = ctx.p.flag('has_clr') ? 1 : 0;
  const clrLow = ctx.p.flag('clr_low', true);
  const hasPol = ctx.p.flag('pol') ? 1 : 0;
  const invert = ctx.p.flag('invert');
  const hasQn = ctx.p.flag('has_qn') ? 1 : 0;
  const clk = n;
  const oe0 = n + 1;
  const en0 = oe0 + nOe;
  const clr = hasClr ? en0 + nEn : -1;
  const pol = hasPol ? en0 + nEn + hasClr : -1;
  const nIn = n + 1 + nOe + nEn + hasClr + hasPol;
  checkPorts(ctx, nIn + n * (1 + hasQn), 'd0..d(n-1) clk [~oe] [~en] [clr] [pol] q.. [~q..]');
  const loadEnabled = (io: EvalIO, t?: number): boolean => {
    for (let k = 0; k < nEn; k++) if ((t === undefined ? io.in[en0 + k] : io.at(en0 + k, t)) !== 0) return false;
    return true;
  };
  return {
    inputs: range(0, nIn),
    outputs: outs(nIn, n * (1 + hasQn)),
    state: 1,
    eval(io) {
      if (clr >= 0 && io.in[clr] === (clrLow ? 0 : 1)) io.st[0] = 0;
      else if (isLatch) {
        const active = pol >= 0 ? io.in[clk] === io.in[pol] : io.in[clk] === (leLow ? 0 : 1);
        if (active && loadEnabled(io)) io.st[0] = word(io, 0, n);
      } else if (!io.dc && (rising ? io.rising(clk) : io.falling(clk))) {
        const t = io.cross[clk];
        if (loadEnabled(io, t)) {
          io.setTime(t);
          io.st[0] = wordAt(io, 0, n, t);
        }
      }
      let enabled = true;
      for (let k = 0; k < nOe; k++) if (io.present[oe0 + k] === 1 && io.in[oe0 + k] !== (oeHigh ? 1 : 0)) enabled = false;
      const q = io.st[0];
      for (let k = 0; k < n; k++) {
        const b = Math.floor(q / 2 ** k) % 2;
        const v = invert ? 1 - b : b;
        io.out[k] = enabled ? v : Z;
        if (hasQn) io.out[n + k] = enabled ? 1 - v : Z;
      }
    },
  };
};

const addressableLatch: BehaviourFactory = (ctx) => {
  let n = 0;
  for (let k = 1; k <= 6; k++) if (k + 3 + 2 ** k === ctx.ports) n = k;
  if (!n) throw netlistError(ctx.name, `port count ${ctx.ports} does not match an addressable latch (a.. d g clr q..)`);
  const gLow = ctx.p.flag('g_low', true);
  const clrLow = ctx.p.flag('clr_low', true);
  const nOut = 2 ** n;
  return {
    inputs: range(0, n + 3),
    outputs: outs(n + 3, nOut),
    state: 1,
    eval(io) {
      const g = io.in[n + 1] === (gLow ? 0 : 1);
      const clr = io.in[n + 2] === (clrLow ? 0 : 1);
      const a = word(io, 0, n);
      const bit = 2 ** a;
      const d = io.in[n];
      let q = io.st[0];
      if (clr && !g) q = 0;
      else if (clr && g) q = d ? bit : 0;
      else if (g) q = d ? q | bit : q & ~bit;
      io.st[0] = q;
      setWord(io, 0, nOut, q);
    },
  };
};

const srLatchN: BehaviourFactory = (ctx) => {
  const ns = ctx.p.int('ns', 1);
  if (ns !== 1 && ns !== 2) throw netlistError(ctx.name, `ns must be 1 or 2 (got ${ns})`);
  checkPorts(ctx, ns + 2, ns === 1 ? '~s ~r q' : '~s1 ~s2 ~r q');
  return {
    inputs: range(0, ns + 1),
    outputs: [{ port: ns + 1 }],
    state: 1,
    eval(io) {
      let set = false;
      for (let k = 0; k < ns; k++) if (io.in[k] === 0) set = true;
      const reset = io.in[ns] === 0;
      if (set && reset) {
        io.out[0] = 1;
        return;
      }
      if (set) io.st[0] = 1;
      else if (reset) io.st[0] = 0;
      io.out[0] = io.st[0];
    },
  };
};

// ---------------------------------------------------------------------------------------------
// encoders

const priorityEncoder: BehaviourFactory = (ctx) => {
  const mode = ctx.p.int('mode', 148);
  if (mode === 147) {
    expectPorts(ctx, 13, '~i1..~i9 ~a ~b ~c ~d');
    return {
      inputs: range(0, 9),
      outputs: outs(9, 4),
      state: 0,
      eval(io) {
        let k = 0;
        for (let i = 8; i >= 0; i--) {
          if (io.in[i] === 0) {
            k = i + 1;
            break;
          }
        }
        setWord(io, 0, 4, 15 - k);
      },
    };
  }
  if (mode !== 148 && mode !== 4532) throw netlistError(ctx.name, `priority encoder mode must be 148, 147 or 4532 (got ${mode})`);
  expectPorts(ctx, 14, mode === 148 ? '~i0..~i7 ~ei ~a0 ~a1 ~a2 ~gs ~eo' : 'd0..d7 ei q0 q1 q2 gs eo');
  const low = mode === 148;
  return {
    inputs: range(0, 9),
    outputs: outs(9, 5),
    state: 0,
    eval(io) {
      const on = (v: number) => (low ? v === 0 : v === 1);
      const lv = (b: boolean) => (b !== low ? 1 : 0);
      if (!on(io.in[8])) {
        setWord(io, 0, 3, low ? 7 : 0);
        io.out[3] = lv(false);
        io.out[4] = lv(false);
        return;
      }
      let k = -1;
      for (let i = 7; i >= 0; i--) {
        if (on(io.in[i])) {
          k = i;
          break;
        }
      }
      if (k < 0) {
        setWord(io, 0, 3, low ? 7 : 0);
        io.out[3] = lv(false);
        io.out[4] = lv(true);
      } else {
        setWord(io, 0, 3, low ? 7 - k : k);
        io.out[3] = lv(true);
        io.out[4] = lv(false);
      }
    },
  };
};

// ---------------------------------------------------------------------------------------------
// arithmetic

/** 74181 (active-high data): F, A=B, ~P, ~G and Cn+4 for operands a, b, select s, mode m, carry pin cn. */
export function alu181(a: number, b: number, s: number, m: number, cn: number): { f: number; aeqb: number; p: number; g: number; cn4: number } {
  const nb = ~b & 15;
  const s0 = s & 1 ? 15 : 0;
  const s1 = s & 2 ? 15 : 0;
  const s2 = s & 4 ? 15 : 0;
  const s3 = s & 8 ? 15 : 0;
  const t1 = (a | (b & s0) | (nb & s1)) & 15;
  const t2 = ((a & nb & s2) | (a & b & s3)) & 15;
  const sum = t1 + t2 + (cn ? 0 : 1);
  const f = m ? ~(t1 ^ t2) & 15 : sum & 15;
  return { f, aeqb: f === 15 ? 1 : 0, p: t1 === 15 ? 0 : 1, g: t1 + t2 >= 16 ? 0 : 1, cn4: sum >= 16 ? 0 : 1 };
}

const alu: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 22, 'a0..a3 b0..b3 s0..s3 m cn f0..f3 aeqb ~p ~g cn4');
  return {
    inputs: range(0, 14),
    outputs: [...outs(14, 4), { port: 18, openDrain: true }, { port: 19 }, { port: 20 }, { port: 21 }],
    state: 0,
    eval(io) {
      const r = alu181(word(io, 0, 4), word(io, 4, 4), word(io, 8, 4), io.in[12], io.in[13]);
      setWord(io, 0, 4, r.f);
      io.out[4] = r.aeqb;
      io.out[5] = r.p;
      io.out[6] = r.g;
      io.out[7] = r.cn4;
    },
  };
};

const cla182: BehaviourFactory = (ctx) => {
  expectPorts(ctx, 14, 'cn ~g0 ~p0 ~g1 ~p1 ~g2 ~p2 ~g3 ~p3 cnx cny cnz ~g ~p');
  return {
    inputs: range(0, 9),
    outputs: outs(9, 5),
    state: 0,
    eval(io) {
      const c = io.in[0] === 1;
      const g = [0, 1, 2, 3].map((k) => io.in[1 + 2 * k] === 0);
      const p = [0, 1, 2, 3].map((k) => io.in[2 + 2 * k] === 0);
      const cx = g[0] || (p[0] && c);
      const cy = g[1] || (p[1] && g[0]) || (p[1] && p[0] && c);
      const cz = g[2] || (p[2] && g[1]) || (p[2] && p[1] && g[0]) || (p[2] && p[1] && p[0] && c);
      const gg = g[3] || (p[3] && g[2]) || (p[3] && p[2] && g[1]) || (p[3] && p[2] && p[1] && g[0]);
      const pp = p[3] && p[2] && p[1] && p[0];
      io.out[0] = cx ? 1 : 0;
      io.out[1] = cy ? 1 : 0;
      io.out[2] = cz ? 1 : 0;
      io.out[3] = gg ? 0 : 1;
      io.out[4] = pp ? 0 : 1;
    },
  };
};

const eqComparator: BehaviourFactory = (ctx) => {
  const n = widthParam(ctx);
  const hasG = ctx.p.flag('has_g') ? 1 : 0;
  const hasGt = ctx.p.flag('has_gt') ? 1 : 0;
  checkPorts(ctx, 2 * n + hasG + 1 + hasGt, 'p0..p(n-1) q0..q(n-1) [~g] ~peq [~pgt]');
  const nIn = 2 * n + hasG;
  return {
    inputs: range(0, nIn),
    outputs: outs(nIn, 1 + hasGt),
    state: 0,
    eval(io) {
      const p = word(io, 0, n);
      const q = word(io, n, n);
      const en = !hasG || io.in[2 * n] === 0;
      io.out[0] = en && p === q ? 0 : 1;
      if (hasGt) io.out[1] = p > q ? 0 : 1;
    },
  };
};

const parity: BehaviourFactory = (ctx) => {
  const ctrl = ctx.p.flag('ctrl') ? 2 : 0;
  const n = ctx.ports - 2 - ctrl;
  if (n < 1 || n > 32) throw netlistError(ctx.name, 'a parity generator needs data inputs and the even / odd outputs');
  return {
    inputs: range(0, n + ctrl),
    outputs: outs(n + ctrl, 2),
    state: 0,
    eval(io) {
      let odd = 0;
      for (let k = 0; k < n; k++) odd ^= io.in[k];
      let even = 1 - odd;
      let oddOut = odd;
      if (ctrl) {
        const ei = io.in[n];
        const oi = io.in[n + 1];
        if (ei === 1 && oi === 1) {
          even = 0;
          oddOut = 0;
        } else if (ei === 0 && oi === 0) {
          even = 1;
          oddOut = 1;
        } else if (ei === 0) {
          even = odd;
          oddOut = 1 - odd;
        }
      }
      io.out[0] = even;
      io.out[1] = oddOut;
    },
  };
};

const aoi: BehaviourFactory = (ctx) => {
  const spec = String(ctx.p.int('groups', 22));
  const groups = spec.split('').map(Number);
  if (groups.some((g) => !(g >= 1 && g <= 9))) throw netlistError(ctx.name, `groups must be decimal digits 1..9 (got ${spec})`);
  const nIn = groups.reduce((a, b) => a + b, 0);
  checkPorts(ctx, nIn + 1, 'AND-group inputs ... y');
  const invert = ctx.p.flag('invert', true);
  return {
    inputs: range(0, nIn),
    outputs: [{ port: nIn }],
    state: 0,
    eval(io) {
      let any = false;
      let i = 0;
      for (const g of groups) {
        let all = true;
        for (let k = 0; k < g; k++) if (io.in[i + k] === 0) all = false;
        if (all) any = true;
        i += g;
      }
      io.out[0] = any !== invert ? 1 : 0;
    },
  };
};

export const MSI2_BEHAVIOURS: Record<string, BehaviourFactory> = {
  D_CNT_UD1: counterUd1,
  D_CNT_UD2: counterUd2,
  D_CNT_UD3: counterUd3,
  D_CNT_EN: counterEn,
  D_CNT_7SEG: counter7seg,
  D_SHIFT_UNIV: shiftUniversal,
  D_SHIFT_JK: shiftJk,
  D_SHIFT_STORE: shiftStore,
  D_SHIFT_PISO2: shiftPiso2,
  D_REG: register,
  D_ADDR_LATCH: addressableLatch,
  D_SRLATCH_N: srLatchN,
  D_PRIENC: priorityEncoder,
  D_ALU181: alu,
  D_CLA182: cla182,
  D_EQCOMP: eqComparator,
  D_PARITY: parity,
  D_AOI: aoi,
};
