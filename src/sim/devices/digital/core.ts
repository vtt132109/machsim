/**
 * Electrical shell of the digital / mixed-signal code models ('A' elements).
 *
 * The MNA engine has no separate event-driven kernel, so every code model is an ordinary
 * device whose logic behaviour (behaviour.ts) is evaluated at well-defined moments:
 *
 * Element layout
 *   A<name> <port nodes...> [<vsup>] [<ref>] <model>
 *   - instance param `pwr` (default 0) = number of trailing supply nodes:
 *       0: output levels and input thresholds are relative to ground (ideal digital);
 *       1: the last node is the reference (ground pin) of the part;
 *       2: the last two nodes are [vsup, ref]: the output high level tracks the supply
 *          (voh - vnom below V(vsup)) and, with `thresh_scale`, the input thresholds scale with
 *          (V(vsup) - V(ref)) / vnom (CMOS). Output current is then drawn from vsup / ref.
 *   - a port node named "null" (XSPICE NULL) is unconnected: an input reads 0 and
 *     `io.present` is 0; an output is not driven.
 *   - stringParams.ports (written by the SPICE parser for "[a b] ~y" port lists) marks
 *     inverted ports ("~#"): inputs are complemented after thresholding, outputs before driving.
 *
 * Inputs
 *   Thresholds are relative to the reference node: switch to 1 above vth + vhys/2 and to 0 below
 *   vth - vhys/2 (vth defaults to (vil + vih)/2, or to the middle of vol..voh); with vtp / vtn
 *   (Schmitt) the input switches high above vtp and low below vtn. A voltage between the two
 *   thresholds keeps the previous value. Every input also loads its node with rin (default
 *   1 TΩ) to vin_float above the reference: TTL parts use rin ≈ kΩ and vin_float ≈ 1.8 V, so a
 *   floating TTL input reads high, as on the bench.
 *
 * Outputs
 *   Thevenin stage: resistance rlow .. rhigh (default rout) to the level
 *   vol + s (voh - vol), where the level s(t) and the drive e(t) (1 = driven, 0 = Z with roff,
 *   or the internal pull-up of an open-drain pin) are piecewise-linear schedules (pwl.ts).
 *   A change requested at event time te starts at te + delay - ramp/2 (never before the
 *   accepted time), so the 50 % point of an unloaded output lies `rise_delay` / `fall_delay`
 *   after the input threshold crossing; the ramp from 0 to 100 % takes rise_time / fall_time.
 *   Enable / disable (Z) changes use tz_delay / tz_time.
 *
 * Timing of the logic
 *   - Operating point and DC sweep (mode 'op' / 'dc', also the OP before a transient): the
 *     behaviour runs inside load() at every Newton iteration with zero delay and no edges
 *     (flip-flops hold their state, async set / reset and transparent latches act). An output
 *     change calls noncon(), so the iteration continues until the logic is consistent. Every
 *     iteration evaluates from the internal state of the last converged solve (the init state
 *     for the first one), so an input that only looked active while the iterate was still far
 *     from the solution (e.g. an active-low preset at 0 V in the first iteration) leaves no trace;
 *     a converged solve commits its state (DC sweeps keep it from point to point).
 *     Logic loops without a DC solution (ring oscillators, symmetric latches) are made
 *     solvable deterministically: a device whose outputs changed in 8 + (k mod 64) iterations
 *     of one solve (k = its order among the code models) is frozen until the solve converges.
 *   - Transient: the logic state lives in the state vector and changes ONLY at accepted
 *     timepoints (accept hook). Input crossings are located by linear interpolation between
 *     accepted points; when an input's slope predicts a crossing within the next step, a
 *     breakpoint is placed just after it, so slow analog inputs are not detected late. Output
 *     changes are scheduled with their delays and the ramp corners are registered as
 *     breakpoints (addBreakpoint, and breakpointsBetween for corners scheduled at t = 0 or
 *     before a discontinuity), so edges are resolved exactly whatever the output step.
 *     load() then stamps a matrix that depends only on time.
 *   - UIC transient: the single initial load runs the behaviour once on the .ic voltages; the
 *     outputs take those values from the first step on.
 *
 * X / Z policy
 *   Inputs are always resolved to 0 / 1 (no X propagation): an undriven net reads through the
 *   input load (CMOS: 0 V via the netlister's floating-pin shunt, TTL: high), and a voltage in
 *   the threshold band keeps the last value. Z exists only on outputs (tri-state, open drain);
 *   bus contention is resolved by the analog network (the node settles at the divider voltage
 *   and every receiver thresholds that). Flip-flops with set and reset both active drive both
 *   outputs high (like TTL parts), clocked SR elements with S = R = 1 keep their state.
 */
import { GROUND, type AcContext, type Device, type LoadContext, type SetupContext } from '../../device';
import type { ElementIR } from '../../netlist';
import { SimulationError } from '../../results';
import type { AcceptContext, EngineDeviceExtensions } from '../../engine/hooks';
import { ParamReader, REF, Z, crossingTime, netlistError, type AnalogOutputSpec, type Behaviour, type EvalIO, type OutputSpec } from './behaviour';
import { Pwl } from './pwl';
import { getBehaviourFactory } from './registry';

/** Port index of an unconnected (XSPICE NULL) port. */
const NO_NODE = -2;
/** Output value stored before the first evaluation (forces a change). */
const UNSET = 255;
/** Freeze threshold of the operating-point oscillation guard: BASE + (ordinal mod SPREAD). */
const FREEZE_BASE = 8;
const FREEZE_SPREAD = 64;

const ordinals = new WeakMap<SetupContext, number>();

/** Matrix / rhs writer shared by the real and the AC stamp helpers. */
interface Stamper {
  mat(r: number, c: number, v: number): void;
  rhs(r: number, v: number): void;
}

/**
 * Thevenin source between `out` and the rails: i_out = g (target - V(out)) with
 * target = (1-s) V(lo) + s V(hi) + c. The current returns through `ret`, or — when ret is
 * null — is split between hi (fraction s) and lo (fraction 1-s), which is exact charge
 * bookkeeping for a supply-powered push-pull stage.
 */
function stampDrive(st: Stamper, out: number, lo: number, hi: number, ret: number | null, g: number, s: number, c: number): void {
  const a = g * (1 - s);
  const b = g * s;
  st.mat(out, out, g);
  st.mat(out, lo, -a);
  st.mat(out, hi, -b);
  st.rhs(out, g * c);
  const row = (r: number, f: number) => {
    if (r < 0 || f === 0) return;
    st.mat(r, out, -f * g);
    st.mat(r, lo, f * a);
    st.mat(r, hi, f * b);
    st.rhs(r, -f * g * c);
  };
  if (ret === null) {
    row(hi, s);
    row(lo, 1 - s);
  } else row(ret, 1);
}

/** Conductance g from `node` to `ref` in series with an EMF vf (node side positive). */
function stampLoad(st: Stamper, node: number, ref: number, g: number, vf: number): void {
  st.mat(node, node, g);
  st.mat(node, ref, -g);
  st.mat(ref, ref, g);
  st.mat(ref, node, -g);
  st.rhs(node, g * vf);
  st.rhs(ref, -g * vf);
}

/** Parse an XSPICE port template ("[ # # ] ~#") into per-node inversion flags. */
export function invertedPorts(template: string | undefined, count: number): boolean[] {
  const out = new Array<boolean>(count).fill(false);
  if (!template) return out;
  const tokens = template.match(/~?#/g) ?? [];
  tokens.slice(0, count).forEach((t, i) => {
    out[i] = t.startsWith('~');
  });
  return out;
}

/** Mutable implementation of the behaviour I/O block. */
class IoBlock implements EvalIO {
  dc = true;
  now = 0;
  prevTime = 0;
  time = 0;
  timer = false;
  readonly in: Uint8Array;
  readonly prev: Uint8Array;
  readonly present: Uint8Array;
  readonly cross: Float64Array;
  readonly analog: Float64Array;
  readonly analogPrev: Float64Array;
  readonly st: Float64Array;
  readonly out: Uint8Array;
  readonly aout: Float64Array;
  readonly wakes: number[] = [];
  eventTime: number | undefined;

  constructor(nIn: number, nAn: number, nSt: number, nOut: number, nAout: number) {
    this.in = new Uint8Array(nIn);
    this.prev = new Uint8Array(nIn);
    this.present = new Uint8Array(nIn);
    this.cross = new Float64Array(nIn).fill(-Infinity);
    this.analog = new Float64Array(nAn);
    this.analogPrev = new Float64Array(nAn);
    this.st = new Float64Array(nSt);
    this.out = new Uint8Array(nOut);
    this.aout = new Float64Array(nAout);
  }

  rising(i: number): boolean {
    return this.prev[i] === 0 && this.in[i] === 1;
  }

  falling(i: number): boolean {
    return this.prev[i] === 1 && this.in[i] === 0;
  }

  at(i: number, t: number): number {
    return this.cross[i] <= t ? this.in[i] : this.prev[i];
  }

  setTime(t: number): void {
    this.eventTime = Math.min(this.now, Math.max(this.prevTime, t));
  }

  wake(t: number): void {
    if (!this.dc && Number.isFinite(t)) this.wakes.push(t);
  }
}

interface DigitalOut {
  node: number;
  invert: boolean;
  openDrain: boolean;
  /** conductance of the released (Z) pin */
  gz: number;
  /** level the released pin is pulled to (1 = high level, 0 = low level) */
  zt: number;
  level: Pwl;
  drive: Pwl;
}

interface AnalogOut {
  node: number;
  lo: number;
  hi: number;
  spec: AnalogOutputSpec;
  value: Pwl;
}

/** Generic 'A' element: electrical shell around a {@link Behaviour}. */
export class CodeModelDevice implements Device, EngineDeviceExtensions {
  readonly type = 'A' as const;
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = false;

  private readonly el: ElementIR;
  private beh!: Behaviour;
  private modelType = '';
  private pwr = 0;
  private ref = GROUND;
  private sup = GROUND;
  private portNodes: number[] = [];
  private inNodes: number[] = [];
  private inInvert: boolean[] = [];
  private anNodes: number[] = [];
  private outs: DigitalOut[] = [];
  private aouts: AnalogOut[] = [];
  private loadNodes: number[] = [];

  // electrical parameters
  private vol = 0;
  private voh = 5;
  private vnom = 5;
  private rlow = 100;
  private rhigh = 100;
  private riseTime = 1e-9;
  private fallTime = 1e-9;
  private riseDelay = 1e-9;
  private fallDelay = 1e-9;
  private tzDelay = 1e-9;
  private tzTime = 1e-9;
  private thrHi = 2.5;
  private thrLo = 2.5;
  private threshScale = false;
  private gin = 1e-12;
  private vfloat = 0;
  /** time between an input crossing and the earliest output ramp start (detection lateness allowed) */
  private slack = 0;

  // state layout
  private base = 0;
  private nIn = 0;
  private nSt = 0;
  private nOut = 0;
  private nAout = 0;
  private io!: IoBlock;

  // operating point bookkeeping
  private ordinal = 0;
  private opStarted = false;
  private changes = 0;
  private frozen = false;
  private opLevel = new Float64Array(0);
  private opDrive = new Float64Array(0);
  private opA = new Float64Array(0);
  /** internal state of the last converged DC solve (or the init state) */
  private opState = new Float64Array(0);

  // transient bookkeeping
  private tranStarted = false;
  private forceEval = false;
  private prevTime = 0;
  private vPrev = new Float64Array(0);
  private wakes: number[] = [];

  constructor(el: ElementIR) {
    this.el = el;
    this.name = el.name;
    this.nodeNames = el.nodes.slice();
  }

  /** Code model type of the element (upper case), available after setup. */
  get codeModel(): string {
    return this.modelType;
  }

  setup(ctx: SetupContext): void {
    const el = this.el;
    if (!el.model) throw netlistError(el.name, 'code model element without a model name');
    const card = ctx.model(el.model);
    if (!card) throw netlistError(el.name, `model '${el.model}' not found`);
    this.modelType = card.type.toUpperCase();
    const factory = getBehaviourFactory(this.modelType);
    if (!factory) throw new SimulationError(`${el.name}: code model type '${card.type}' is not supported`, 'unsupported');

    const pwr = Math.round(el.params.pwr ?? 0);
    if (pwr < 0 || pwr > 2) throw netlistError(el.name, `pwr must be 0, 1 or 2 (got ${el.params.pwr})`);
    const nPorts = el.nodes.length - pwr;
    if (nPorts < 1) throw netlistError(el.name, 'no port nodes');
    this.pwr = pwr;
    const nodeOf = (n: string): number => (/^null$/i.test(n.trim()) ? NO_NODE : ctx.node(n));
    this.portNodes = el.nodes.slice(0, nPorts).map(nodeOf);
    if (pwr >= 1) this.ref = ctx.node(el.nodes[el.nodes.length - 1]);
    if (pwr === 2) this.sup = ctx.node(el.nodes[el.nodes.length - 2]);
    const present = this.portNodes.map((n) => n !== NO_NODE);
    const inv = invertedPorts(el.stringParams?.ports, nPorts);

    const p = new ParamReader(el.params, card, el.name);
    const beh = factory({ ports: nPorts, present, p, name: el.name });
    p.fallback = beh.defaults ?? {};
    this.beh = beh;
    const checkPort = (i: number, what: string) => {
      if (!(Number.isInteger(i) && i >= 0 && i < nPorts)) throw new SimulationError(`${el.name}: behaviour ${what} port ${i} out of range`, 'internal');
    };
    beh.inputs.forEach((i) => checkPort(i, 'input'));
    (beh.analog ?? []).forEach((i) => checkPort(i, 'analog input'));
    beh.outputs.forEach((o) => checkPort(o.port, 'output'));
    (beh.aoutputs ?? []).forEach((o) => checkPort(o.port, 'analog output'));

    this.resolveElectrical(p);

    this.inNodes = beh.inputs.map((i) => this.portNodes[i]);
    this.inInvert = beh.inputs.map((i) => inv[i]);
    this.anNodes = (beh.analog ?? []).map((i) => this.portNodes[i]);
    const roff = p.positive('roff', 1e9);
    this.outs = beh.outputs.map((o: OutputSpec) => ({
      node: this.portNodes[o.port],
      invert: inv[o.port],
      openDrain: !!o.openDrain || p.flag('open_drain'),
      gz: o.pullup !== undefined && o.pullup > 0 ? 1 / o.pullup : 1 / roff,
      zt: o.pullup !== undefined && o.pullup > 0 ? 1 : 0,
      level: new Pwl(0),
      drive: new Pwl(1),
    }));
    const portOrRef = (i: number) => (i === REF ? this.ref : this.portNodes[i]);
    this.aouts = (beh.aoutputs ?? []).map((spec) => {
      if (spec.lo !== REF) checkPort(spec.lo, 'analog reference');
      if (spec.hi !== REF) checkPort(spec.hi, 'analog reference');
      if (!(spec.rout > 0) || !(spec.slew > 0) || !(spec.fullScale > 0)) throw netlistError(el.name, 'analog output needs rout, slew and fullScale > 0');
      return { node: this.portNodes[spec.port], lo: portOrRef(spec.lo), hi: portOrRef(spec.hi), spec, value: new Pwl(0) };
    });
    const margins = [
      this.riseDelay - this.riseTime / 2,
      this.fallDelay - this.fallTime / 2,
      this.tzDelay - this.tzTime / 2,
      ...this.aouts.map((a) => a.spec.delay),
    ];
    this.slack = Math.max(0, Math.min(...margins));
    const loaded = new Set<number>();
    for (const n of [...this.inNodes, ...this.anNodes]) if (n >= 0) loaded.add(n);
    this.loadNodes = [...loaded];

    this.nIn = beh.inputs.length;
    this.nSt = beh.state;
    this.nOut = beh.outputs.length;
    this.nAout = this.aouts.length;
    this.base = ctx.state(this.nIn + this.nSt + this.nOut + this.nAout);
    this.io = new IoBlock(this.nIn, this.anNodes.length, this.nSt, this.nOut, this.nAout);
    for (let k = 0; k < this.nIn; k++) this.io.present[k] = this.inNodes[k] === NO_NODE ? 0 : 1;
    this.opLevel = new Float64Array(this.nOut);
    this.opDrive = new Float64Array(this.nOut).fill(1);
    this.opA = new Float64Array(this.nAout);
    this.opState = new Float64Array(this.nSt);
    this.vPrev = new Float64Array(this.nIn);

    const k = ordinals.get(ctx) ?? 0;
    ordinals.set(ctx, k + 1);
    this.ordinal = k;
  }

  private resolveElectrical(p: ParamReader): void {
    this.vol = p.num('vol', 0);
    this.voh = p.num('voh', 5);
    if (!(this.voh > this.vol)) throw netlistError(this.name, `voh (${this.voh}) must be above vol (${this.vol})`);
    this.vnom = p.positive('vnom', 5);
    const rout = p.positive('rout', 100);
    this.rlow = p.positive('rlow', rout);
    this.rhigh = p.positive('rhigh', rout);
    this.riseTime = p.nonNeg('rise_time', 1e-9);
    this.fallTime = p.nonNeg('fall_time', 1e-9);
    this.riseDelay = p.nonNeg('rise_delay', 1e-9);
    this.fallDelay = p.nonNeg('fall_delay', 1e-9);
    this.tzDelay = p.nonNeg('tz_delay', (this.riseDelay + this.fallDelay) / 2);
    this.tzTime = p.nonNeg('tz_time', Math.min(this.riseTime, this.fallTime));
    const vil = p.get('vil');
    const vih = p.get('vih');
    const vth = p.get('vth') ?? (vil !== undefined && vih !== undefined ? (vil + vih) / 2 : (this.vol + this.voh) / 2);
    const hys = p.nonNeg('vhys', 0);
    let hi = vth + hys / 2;
    let lo = vth - hys / 2;
    const vtp = p.get('vtp');
    const vtn = p.get('vtn');
    if (vtp !== undefined && vtn !== undefined) {
      hi = vtp;
      lo = vtn;
    } else if (this.beh.schmitt && hys === 0) {
      const w = 0.1 * (this.voh - this.vol);
      hi = vth + w;
      lo = vth - w;
    }
    if (hi < lo) throw netlistError(this.name, `upper input threshold (${hi}) below the lower one (${lo})`);
    this.thrHi = hi;
    this.thrLo = lo;
    this.threshScale = this.pwr === 2 && p.flag('thresh_scale');
    const rin = p.num('rin', 1e12);
    this.gin = rin > 0 && Number.isFinite(rin) ? 1 / rin : 0;
    this.vfloat = p.num('vin_float', 0);
  }

  // ------------------------------------------------------------------------------------------
  // input reading

  private thresholdScale(x: (i: number) => number): number {
    if (!this.threshScale) return 1;
    const s = (x(this.sup) - x(this.ref)) / this.vnom;
    return s > 0 ? s : 0;
  }

  private readInput(x: (i: number) => number, k: number): number {
    const n = this.inNodes[k];
    return n === NO_NODE ? 0 : x(n) - x(this.ref);
  }

  private resolveLogic(v: number, prev: number, scale: number, present: boolean, invert: boolean): number {
    if (!present) return 0;
    const raw = invert ? 1 - prev : prev;
    let r: number;
    if (raw === 1) r = v < this.thrLo * scale ? 0 : 1;
    else r = v > this.thrHi * scale ? 1 : 0;
    return invert ? 1 - r : r;
  }

  private readAnalog(x: (i: number) => number): void {
    const a = this.io.analog;
    for (let k = 0; k < this.anNodes.length; k++) {
      const n = this.anNodes[k];
      a[k] = n === NO_NODE ? 0 : x(n) - x(this.ref);
    }
  }

  // ------------------------------------------------------------------------------------------
  // rails and stamps

  /** Low / high rail constants (target = (1-s)(V(lo)+cl) + s(V(hi)+ch)). */
  private rails(srcFact: number): { lo: number; hi: number; cl: number; ch: number } {
    if (this.pwr === 2) return { lo: this.ref, hi: this.sup, cl: this.vol * srcFact, ch: (this.voh - this.vnom) * srcFact };
    return { lo: this.ref, hi: this.ref, cl: this.vol * srcFact, ch: this.voh * srcFact };
  }

  private stampAll(st: Stamper, levels: (k: number) => number, drives: (k: number) => number, avals: (k: number) => number, srcFact: number): void {
    const { lo, hi, cl, ch } = this.rails(srcFact);
    for (const n of this.loadNodes) if (this.gin > 0) stampLoad(st, n, this.ref, this.gin, this.vfloat * srcFact);
    for (let k = 0; k < this.outs.length; k++) {
      const o = this.outs[k];
      if (o.node === NO_NODE) continue;
      const s = levels(k);
      const e = drives(k);
      const gOn = 1 / (this.rlow + s * (this.rhigh - this.rlow));
      const g1 = e * gOn;
      const g2 = (1 - e) * o.gz;
      const g = g1 + g2;
      const sEff = (g1 * s + g2 * o.zt) / g;
      stampDrive(st, o.node, lo, hi, null, g, sEff, (1 - sEff) * cl + sEff * ch);
    }
    for (let k = 0; k < this.aouts.length; k++) {
      const a = this.aouts[k];
      if (a.node === NO_NODE) continue;
      const s = avals(k);
      stampDrive(st, a.node, a.lo, a.hi, this.ref, 1 / a.spec.rout, s, s * a.spec.span * srcFact);
    }
  }

  load(ctx: LoadContext): void {
    const st: Stamper = { mat: ctx.addMatrix, rhs: ctx.addRhs };
    if (ctx.mode === 'tran' && !ctx.tranOp) {
      const t = ctx.time;
      this.stampAll(
        st,
        (k) => this.outs[k].level.value(t),
        (k) => this.outs[k].drive.value(t),
        (k) => this.aouts[k].value.value(t),
        1,
      );
      return;
    }
    this.operatingPointLoad(ctx);
    this.stampAll(
      st,
      (k) => this.opLevel[k],
      (k) => this.opDrive[k],
      (k) => this.opA[k],
      ctx.srcFact,
    );
  }

  acLoad(ctx: AcContext): void {
    const st: Stamper = { mat: (r, c, v) => ctx.addMatrix(r, c, v, 0), rhs: () => undefined };
    this.stampAll(
      st,
      (k) => this.opLevel[k],
      (k) => this.opDrive[k],
      (k) => this.opA[k],
      1,
    );
  }

  convTest(ctx: LoadContext): boolean {
    if (ctx.mode !== 'tran' || ctx.tranOp) {
      // the solve converged: the next one starts with a fresh oscillation guard and from this state
      this.changes = 0;
      this.frozen = false;
      const stOff = this.base + this.nIn;
      for (let k = 0; k < this.nSt; k++) this.opState[k] = ctx.state0[stOff + k];
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------
  // operating point

  /** Level / drive of an output for desired value d (instantaneous, operating point). */
  private applyInstant(k: number, d: number): void {
    const o = this.outs[k];
    let v = d;
    if (o.invert && v !== Z) v = 1 - v;
    if (v === Z) this.opDrive[k] = 0;
    else if (o.openDrain && v === 1) {
      this.opLevel[k] = 1;
      this.opDrive[k] = 0;
    } else {
      this.opLevel[k] = v;
      this.opDrive[k] = 1;
    }
  }

  private operatingPointLoad(ctx: LoadContext): void {
    const s0 = ctx.state0;
    const b = this.base;
    const io = this.io;
    const fresh = !this.opStarted || ctx.initJunctions;
    if (fresh) {
      this.opStarted = true;
      this.changes = 0;
      this.frozen = false;
      for (let k = 0; k < this.nIn; k++) s0[b + k] = 0;
      for (let k = 0; k < this.nOut; k++) s0[b + this.nIn + this.nSt + k] = UNSET;
      for (let k = 0; k < this.nAout; k++) s0[b + this.nIn + this.nSt + this.nOut + k] = NaN;
    }
    const x = ctx.x;
    const scale = this.thresholdScale(x);
    for (let k = 0; k < this.nIn; k++) {
      const v = this.readInput(x, k);
      const l = this.resolveLogic(v, s0[b + k], scale, io.present[k] === 1, this.inInvert[k]);
      io.in[k] = l;
      io.prev[k] = l;
      io.cross[k] = -Infinity;
      s0[b + k] = l;
    }
    this.readAnalog(x);
    io.analogPrev.set(io.analog);
    io.dc = true;
    io.now = 0;
    io.prevTime = 0;
    io.time = 0;
    io.timer = false;
    io.eventTime = undefined;
    io.wakes.length = 0;
    const stOff = b + this.nIn;
    const outOff = stOff + this.nSt;
    const aOff = outOff + this.nOut;
    if (fresh) {
      io.st.fill(0);
      this.beh.init?.(io);
      for (let k = 0; k < this.nSt; k++) s0[stOff + k] = io.st[k];
      this.opState.set(io.st);
    }
    io.st.set(this.opState);
    for (let k = 0; k < this.nOut; k++) io.out[k] = s0[outOff + k] === UNSET ? 0 : s0[outOff + k];
    for (let k = 0; k < this.nAout; k++) io.aout[k] = Number.isNaN(s0[aOff + k]) ? 0 : s0[aOff + k];
    this.beh.eval(io);

    if (!this.frozen) {
      let changed = false;
      for (let k = 0; k < this.nOut; k++) if (io.out[k] !== s0[outOff + k]) changed = true;
      for (let k = 0; k < this.nAout; k++) if (!(io.aout[k] === s0[aOff + k])) changed = true;
      if (changed) {
        for (let k = 0; k < this.nSt; k++) s0[stOff + k] = io.st[k];
        for (let k = 0; k < this.nOut; k++) s0[outOff + k] = io.out[k];
        for (let k = 0; k < this.nAout; k++) s0[aOff + k] = io.aout[k];
        ctx.noncon();
        this.changes++;
        if (this.changes >= FREEZE_BASE + (this.ordinal % FREEZE_SPREAD)) this.frozen = true;
      } else {
        for (let k = 0; k < this.nSt; k++) s0[stOff + k] = io.st[k];
      }
    }
    for (let k = 0; k < this.nOut; k++) this.applyInstant(k, s0[outOff + k]);
    for (let k = 0; k < this.nAout; k++) this.opA[k] = s0[aOff + k];
  }

  // ------------------------------------------------------------------------------------------
  // transient

  beginTransient(): void {
    this.tranStarted = false;
    this.wakes = [];
  }

  private schedule(ctx: AcceptContext, k: number, d: number, te: number): void {
    const o = this.outs[k];
    if (o.node === NO_NODE) return;
    let v = d;
    if (o.invert && v !== Z) v = 1 - v;
    let level: number;
    let drive: number;
    if (v === Z) {
      level = o.level.final;
      drive = 0;
    } else if (o.openDrain && v === 1) {
      level = 1;
      drive = 0;
    } else {
      level = v;
      drive = 1;
    }
    const now = ctx.time;
    const add = (r: [number, number] | null) => {
      if (!r) return;
      ctx.addBreakpoint(r[0]);
      ctx.addBreakpoint(r[1]);
    };
    if (level !== o.level.final) {
      const rising = level > o.level.final;
      const delay = rising ? this.riseDelay : this.fallDelay;
      const ramp = rising ? this.riseTime : this.fallTime;
      add(o.level.schedule(now, te + delay - ramp / 2, level, ramp));
    }
    if (drive !== o.drive.final) {
      add(o.drive.schedule(now, te + this.tzDelay - this.tzTime / 2, drive, this.tzTime));
    }
  }

  private scheduleAnalog(ctx: AcceptContext, k: number, value: number, te: number): void {
    const a = this.aouts[k];
    if (a.node === NO_NODE || value === a.value.final) return;
    const r = a.value.schedule(ctx.time, te + a.spec.delay, value, a.spec.slew / a.spec.fullScale);
    if (r) {
      ctx.addBreakpoint(r[0]);
      ctx.addBreakpoint(r[1]);
    }
  }

  accept(ctx: AcceptContext): void {
    const now = ctx.time;
    const s0 = ctx.state0;
    const b = this.base;
    const io = this.io;
    const stOff = b + this.nIn;
    const outOff = stOff + this.nSt;
    const aOff = outOff + this.nOut;
    const x = ctx.x;
    const first = !this.tranStarted;
    if (first) {
      this.tranStarted = true;
      for (let k = 0; k < this.nOut; k++) {
        this.outs[k].level.reset(this.opLevel[k]);
        this.outs[k].drive.reset(this.opDrive[k]);
      }
      for (let k = 0; k < this.nAout; k++) this.aouts[k].value.reset(this.opA[k]);
      this.prevTime = now;
      for (let k = 0; k < this.nIn; k++) this.vPrev[k] = this.readInput(x, k);
      this.readAnalog(x);
      io.analogPrev.set(io.analog);
    }

    // inputs: logic with hysteresis against the last accepted state, crossing times
    const scale = this.thresholdScale(x);
    let changed = false;
    let te = -Infinity;
    for (let k = 0; k < this.nIn; k++) {
      const v = this.readInput(x, k);
      const prev = s0[b + k];
      const l = this.resolveLogic(v, prev, scale, io.present[k] === 1, this.inInvert[k]);
      io.prev[k] = prev;
      io.in[k] = l;
      if (l !== prev) {
        changed = true;
        const raw = this.inInvert[k] ? 1 - l : l;
        const thr = (raw === 1 ? this.thrHi : this.thrLo) * scale;
        const tc = first ? now : crossingTime(this.prevTime, this.vPrev[k], now, v, thr);
        io.cross[k] = tc;
        if (tc > te) te = tc;
      } else {
        io.cross[k] = -Infinity;
        if (!first) this.predictCrossing(ctx, k, v, l, scale);
      }
      this.vPrev[k] = v;
    }
    if (!first) {
      io.analogPrev.set(io.analog);
      this.readAnalog(x);
    }

    const tol = Math.max(1e-21, 1e-9 * Math.abs(now));
    let timer = this.wakes.length > 0 && this.wakes[0] <= now + tol;
    let needEval = first || changed || timer || this.forceEval || !!this.beh.alwaysEval;
    this.forceEval = false;
    io.dc = false;
    io.now = now;
    io.prevTime = this.prevTime;
    for (let pass = 0; needEval && pass < 8; pass++) {
      if (timer) while (this.wakes.length > 0 && this.wakes[0] <= now + tol) this.wakes.shift();
      io.timer = timer;
      io.time = te > -Infinity ? te : now;
      io.eventTime = undefined;
      io.wakes.length = 0;
      for (let k = 0; k < this.nSt; k++) io.st[k] = s0[stOff + k];
      for (let k = 0; k < this.nOut; k++) io.out[k] = s0[outOff + k] === UNSET ? 0 : s0[outOff + k];
      for (let k = 0; k < this.nAout; k++) io.aout[k] = Number.isNaN(s0[aOff + k]) ? 0 : s0[aOff + k];
      this.beh.eval(io);
      const tEvent = io.eventTime ?? io.time;
      for (let k = 0; k < this.nSt; k++) s0[stOff + k] = io.st[k];
      for (let k = 0; k < this.nOut; k++) {
        if (io.out[k] !== s0[outOff + k]) {
          this.schedule(ctx, k, io.out[k], tEvent);
          s0[outOff + k] = io.out[k];
        }
      }
      for (let k = 0; k < this.nAout; k++) {
        if (!(io.aout[k] === s0[aOff + k])) {
          this.scheduleAnalog(ctx, k, io.aout[k], tEvent);
          s0[aOff + k] = io.aout[k];
        }
      }
      for (const w of io.wakes) this.addWake(ctx, w);
      // after the first pass, inputs count as settled (no edges)
      io.prev.set(io.in);
      io.cross.fill(-Infinity);
      te = -Infinity;
      timer = this.wakes.length > 0 && this.wakes[0] <= now + tol;
      needEval = timer;
    }
    for (let k = 0; k < this.nIn; k++) s0[b + k] = io.in[k];
    if (!first && this.beh.predict && now > this.prevTime) {
      const tp = this.beh.predict(io);
      if (tp !== undefined) this.landAfter(ctx, tp);
    }
    this.prevTime = now;
    for (const o of this.outs) {
      o.level.prune(now);
      o.drive.prune(now);
    }
    for (const a of this.aouts) a.value.prune(now);
  }

  /**
   * Extrapolate an input's last slope to its next threshold crossing; when that crossing lies
   * within the next step or two, place a breakpoint just after it so the crossing is detected
   * (and its delay measured) at the right time instead of at the end of a long step.
   */
  private predictCrossing(ctx: AcceptContext, k: number, v: number, logicNow: number, scale: number): void {
    if (this.io.present[k] === 0) return;
    const dtLast = ctx.time - this.prevTime;
    if (!(dtLast > 0)) return;
    const slope = (v - this.vPrev[k]) / dtLast;
    const raw = this.inInvert[k] ? 1 - logicNow : logicNow;
    let tp: number;
    if (raw === 0 && slope > 0) tp = ctx.time + (this.thrHi * scale - v) / slope;
    else if (raw === 1 && slope < 0) tp = ctx.time + (this.thrLo * scale - v) / slope;
    else return;
    if (tp - ctx.time < 2 * dtLast) this.landAfter(ctx, tp);
  }

  /**
   * Breakpoint slightly after a predicted crossing at time tp — only when the next step (at
   * most twice the last one) could detect the crossing later than the outputs' delay slack;
   * otherwise interpolation already yields the exact output timing.
   */
  private landAfter(ctx: AcceptContext, tp: number): void {
    const now = ctx.time;
    const dtLast = now - this.prevTime;
    if (!(tp > now) || !(tp - now < 2 * dtLast) || 2 * dtLast <= this.slack) return;
    ctx.addBreakpoint(tp + Math.max(1e-4 * dtLast, 1e-15));
  }

  /** Pending ramp corners and wake-up times in (from, to] (also re-queried after a discontinuity). */
  breakpointsBetween(from: number, to: number): number[] {
    const out: number[] = [];
    const take = (t: number) => {
      if (t > from && t <= to) out.push(t);
    };
    for (const o of this.outs) {
      o.level.times().forEach(take);
      o.drive.times().forEach(take);
    }
    for (const a of this.aouts) a.value.times().forEach(take);
    this.wakes.forEach(take);
    return out.sort((a, b) => a - b);
  }

  private addWake(ctx: AcceptContext, t: number): void {
    const w = this.wakes;
    let i = w.length;
    while (i > 0 && w[i - 1] > t) i--;
    if (i > 0 && w[i - 1] === t) return;
    w.splice(i, 0, t);
    if (t > ctx.time) ctx.addBreakpoint(t);
  }

  // ------------------------------------------------------------------------------------------
  // runtime parameters

  setParam(param: string, value: number): void {
    const key = param.trim().toLowerCase();
    if (!this.beh?.setParam || !this.beh.setParam(key, value)) {
      throw new SimulationError(`${this.name}: parameter '${param}' cannot be changed at run time`, 'unsupported');
    }
    this.forceEval = true;
  }

  getParam(param: string): number | undefined {
    return this.beh?.getParam?.(param.trim().toLowerCase());
  }

  /** Scheduled output level (0..1) of digital output k at time t (diagnostics / tests). */
  outputLevel(k: number, t: number): number {
    return this.outs[k].level.value(t);
  }

  /**
   * Internal read-outs of the behaviour (see {@link Behaviour.probes}), published as derived
   * device outputs so a panel can watch them live. Behaviours without probes() add no vectors.
   */
  outputs(): Record<string, number> {
    return this.beh?.probes?.() ?? {};
  }
}
