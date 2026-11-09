/**
 * Transient analysis core (shared by the .tran runner and the interactive TransientStepper).
 *
 * Algorithm (SPICE3-style, implemented from the published method descriptions):
 * - Initial point: DC operating point with charges stored (`tranOp`, .ic values forced), or with
 *   UIC the .ic node voltages / device initial conditions without solving.
 * - Each timepoint is solved by Newton (limit itl4) with charge integration: backward Euler
 *   (order 1) for the first step and after every breakpoint, then trapezoidal or variable-step
 *   Gear-2 (options.method). A Newton failure divides the step by 8 and restarts at order 1.
 *   Ringing control (a deliberate deviation from SPICE3): with the trapezoidal method the first
 *   STARTUP_BE_STEPS (3) steps after each restart are backward Euler, which damps the stiff modes
 *   a sharp edge excites instead of letting trapezoidal steps h ≫ τ ring around the solution.
 * - Local truncation error: devices return their admissible step via TruncContext.terr(), which
 *   estimates the error from divided differences of the stored charges (tolerances from reltol,
 *   abstol, chgtol, trtol). A step is accepted when the estimate allows more than 0.9 of it; the
 *   next step is at most twice the last one, never above the maximum step.
 * - Maximum step: min(tmax, tstep) when tmax is given, else min(tstep, (tstop - tstart)/50),
 *   further limited by device maxTimestep() (e.g. transmission-line delay). Keeping it <= tstep
 *   guarantees at least one accepted sample in every tstep interval.
 * - Breakpoints (waveform corners, tstart, tstop, dynamic ones requested by devices on accept) are
 *   hit exactly; after a breakpoint the step restarts at 0.1*min(previous step, gap to the next
 *   breakpoint). Open-ended runs (tstop = Infinity) query breakpoints window by window.
 * - "Timestep too small" (step below 1e-11 * max step) raises SimulationError code 'timestep'
 *   naming the node / device that failed to converge.
 */
import type { TruncContext } from '../device';
import { SimulationError } from '../results';
import type { Circuit } from './circuit';
import type { AcceptContext, EngineDevice } from './hooks';
import { describeFailure, newtonSolve, solveOperatingPoint } from './newton';
import { RealSystem, checkAbort, type AbortFlag } from './system';

/** LTE error coefficients of trapezoidal (orders 1, 2) and Gear (BDF) integration. */
const TRAP_COEFF = [0.5, 1 / 12];
const GEAR_COEFF = [0.5, 2 / 9];

/**
 * Backward-Euler steps taken after every restart of integration (t = 0, breakpoint, Newton
 * failure, discontinuity) before the trapezoidal rule is used. Each BE step with h ≥ 10·τ cuts a
 * stiff mode excited by the edge by ≥ 11×, so three steps bring even a full-scale excitation
 * below 1e-3 (ringing control, see accept()).
 */
const STARTUP_BE_STEPS = 3;

export interface TransientParams {
  /** Nominal output step (s). */
  tstep: number;
  /** Stop time (s); Infinity for an open-ended (interactive) run. */
  tstop: number;
  /** Samples before tstart are not reported by the runner (still simulated). */
  tstart?: number;
  /** Maximum internal step (s). */
  tmax?: number;
  /** Use initial conditions instead of an operating point. */
  uic?: boolean;
  signal?: AbortFlag;
}

/** The next step the engine intends to take. */
export interface StepPlan {
  dt: number;
  /** Time of the planned point. */
  time: number;
  hitsBreakpoint: boolean;
}

interface MutableAcceptContext extends AcceptContext {
  time: number;
  dt: number;
  state0: Float64Array;
}

interface MutableTruncContext extends TruncContext {
  dt: number;
  order: number;
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toPrecision(6) : String(v);
}

export class TransientEngine {
  readonly circuit: Circuit;
  readonly sys: RealSystem;
  readonly tstep: number;
  readonly tstop: number;
  readonly tstart: number;
  readonly uic: boolean;
  /** Maximum step from tstep / tmax / tstop (device limits come on top). */
  readonly maxStep: number;
  /** Smallest admissible step. */
  readonly delmin: number;
  /** Breakpoints closer than this are merged / snapped to. */
  readonly minBreak: number;
  /** Time of the last accepted point. */
  time = 0;
  acceptedSteps = 0;
  rejectedSteps = 0;
  newtonIterations = 0;

  private dt: number;
  private order = 1;
  /**
   * Accepted steps since the last (re)start of integration — t = 0, a breakpoint, a Newton
   * failure, a discontinuity. With the trapezoidal method the first STARTUP_BE_STEPS steps after
   * a restart use backward Euler; see accept().
   */
  private sinceRestart = 0;
  private readonly maxOrder: number;
  private readonly deltaOld = new Float64Array(4);
  private breaks: number[] = [];
  private breakHead = 0;
  private horizon = 0;
  private deviceMaxStep = Infinity;
  private readonly lastX: Float64Array;
  private initialized = false;
  private lastFailure = '';
  private readonly truncDevices: EngineDevice[];
  private readonly acceptDevices: EngineDevice[];
  private readonly bpDevices: EngineDevice[];
  private readonly truncCtx: MutableTruncContext;
  private readonly acceptCtx: MutableAcceptContext;
  private readonly diff = new Float64Array(4);
  private readonly deltmp = new Float64Array(4);

  constructor(circuit: Circuit, params: TransientParams, sys: RealSystem = new RealSystem(circuit)) {
    if (!(params.tstep > 0) || !Number.isFinite(params.tstep)) {
      throw new SimulationError(`Transient analysis: invalid tstep ${params.tstep}`, 'netlist');
    }
    if (!(params.tstop > 0)) throw new SimulationError(`Transient analysis: invalid tstop ${params.tstop}`, 'netlist');
    this.circuit = circuit;
    this.sys = sys;
    this.tstep = params.tstep;
    this.tstop = params.tstop;
    this.tstart = Math.max(0, params.tstart ?? 0);
    if (this.tstart >= this.tstop) throw new SimulationError('Transient analysis: tstart must be smaller than tstop', 'netlist');
    this.uic = !!params.uic;
    sys.signal = params.signal;
    const span = this.tstop - this.tstart;
    const tmax = params.tmax !== undefined && params.tmax > 0 ? params.tmax : undefined;
    this.maxStep = tmax !== undefined ? Math.min(tmax, this.tstep) : Math.min(this.tstep, Number.isFinite(span) ? span / 50 : Infinity);
    this.delmin = 1e-11 * this.maxStep;
    this.minBreak = 5e-5 * this.maxStep;
    this.dt = this.maxStep / 10;
    this.maxOrder = Math.max(1, Math.min(2, Math.floor(circuit.options.maxord) || 2));
    this.lastX = new Float64Array(circuit.size);
    this.truncDevices = circuit.devices.filter((d) => typeof d.truncate === 'function');
    this.acceptDevices = circuit.devices.filter((d) => typeof d.accept === 'function');
    this.bpDevices = circuit.devices.filter((d) => typeof d.breakpointsBetween === 'function' || typeof d.breakpoints === 'function');
    const self = this;
    this.truncCtx = {
      dt: 0,
      order: 1,
      terr: (q: number) => self.terr(q),
    };
    this.acceptCtx = {
      time: 0,
      dt: 0,
      x: (i: number) => (i < 0 ? 0 : self.sys.x[i]),
      state0: sys.states[0],
      options: circuit.options,
      addBreakpoint: (t: number) => self.addBreakpoint(t),
    };
  }

  /** Solution of the last accepted point (do not modify). */
  get solution(): Float64Array {
    return this.lastX;
  }

  /** Integration order that will be used for the next step. */
  get currentOrder(): number {
    return this.order;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  private maxStepEff(): number {
    return Math.min(this.maxStep, this.deviceMaxStep);
  }

  private computeDeviceMaxStep(): void {
    let m = Infinity;
    for (const d of this.circuit.devices) {
      if (d.maxTimestep) {
        const v = d.maxTimestep();
        if (v > 0 && v < m) m = v;
      }
    }
    this.deviceMaxStep = m;
  }

  /** Compute the initial point (operating point, or UIC initial conditions) at t = 0. */
  initialize(): void {
    const c = this.circuit;
    const sys = this.sys;
    const ctx = sys.ctx;
    const opts = c.options;
    for (const d of c.devices) d.beginTransient?.({ tstep: this.tstep, tstop: this.tstop });
    if (!this.uic) {
      solveOperatingPoint(sys, { mode: 'op', tranOp: true });
    } else {
      sys.x.fill(0);
      sys.xPrev.fill(0);
      for (const ic of c.ic) sys.x[ic.index] = ic.value;
      const set = (i: number, v: number) => {
        if (i >= 0 && i < sys.n && Number.isFinite(v)) sys.x[i] = v;
      };
      for (const d of c.devices) d.initialConditions?.(set);
      ctx.mode = 'op';
      ctx.tranOp = true;
      ctx.uic = true;
      ctx.initJunctions = true;
      ctx.initTimepoint = false;
      ctx.time = 0;
      ctx.dt = 0;
      ctx.srcFact = 1;
      ctx.gmin = opts.gmin;
      sys.forced = [];
      sys.diagGmin = 0;
      sys.states[0].fill(0);
      sys.assemble(); // devices store their initial charges / fluxes; the matrix is not solved
      ctx.initJunctions = false;
      // node voltages implied by capacitor ic= (reported t = 0 point, first Newton guess)
      const known = new Set<number>(c.ic.map((ic) => ic.index));
      const get = (i: number): number | undefined => (i < 0 ? 0 : known.has(i) ? sys.x[i] : undefined);
      const setV = (i: number, v: number) => {
        if (i < 0 || i >= sys.n || !Number.isFinite(v) || known.has(i)) return;
        sys.x[i] = v;
        known.add(i);
      };
      for (const d of c.devices) d.initialVoltages?.(setV, get);
    }
    sys.forced = [];
    ctx.tranOp = false;
    ctx.uic = this.uic;
    ctx.mode = 'tran';
    ctx.srcFact = 1;
    ctx.time = 0;
    this.time = 0;
    this.acceptCtx.time = 0;
    this.acceptCtx.dt = 0;
    this.acceptCtx.state0 = sys.states[0];
    for (const d of this.acceptDevices) d.accept?.(this.acceptCtx);
    sys.seedHistory();
    this.lastX.set(sys.x);
    this.order = 1;
    this.sinceRestart = 0;
    this.deltaOld.fill(this.maxStep);
    this.computeDeviceMaxStep();
    this.dt = Math.min(this.maxStepEff(), this.tstep) / 10;
    this.breaks = [];
    this.breakHead = 0;
    this.horizon = 0;
    const fixed: number[] = [];
    if (this.tstart > 0) fixed.push(this.tstart);
    if (Number.isFinite(this.tstop)) fixed.push(this.tstop);
    this.insertBreaks(fixed);
    this.initialized = true;
  }

  // ------------------------------------------------------------------ breakpoints

  private insertBreaks(list: number[]): void {
    if (list.length === 0) return;
    const all = this.breaks.slice(this.breakHead);
    for (const t of list) if (Number.isFinite(t) && t > this.time + this.minBreak) all.push(t);
    all.sort((a, b) => a - b);
    const out: number[] = [];
    for (const t of all) {
      if (out.length === 0 || t - out[out.length - 1] > this.minBreak) out.push(t);
      else if (t === this.tstop) out[out.length - 1] = t; // never lose tstop to a merge
    }
    this.breaks = out;
    this.breakHead = 0;
  }

  /** Make sure every device breakpoint up to `until` is queued. */
  private ensureBreakpoints(until: number): void {
    const target = Number.isFinite(this.tstop) ? this.tstop : until;
    if (this.horizon >= target || this.bpDevices.length === 0) {
      if (this.horizon < target) this.horizon = target;
      return;
    }
    const from = this.horizon;
    const to = Number.isFinite(this.tstop) ? this.tstop : Math.max(until, from + 256 * this.maxStepEff());
    const fresh: number[] = [];
    for (const d of this.bpDevices) {
      const list = d.breakpointsBetween
        ? d.breakpointsBetween(from, to)
        : (d.breakpoints?.(to) ?? []).filter((t) => t > from);
      for (const t of list) fresh.push(t);
    }
    this.horizon = to;
    this.insertBreaks(fresh);
  }

  private nextBreak(): number {
    this.ensureBreakpoints(this.time + 4 * this.maxStepEff());
    const lim = this.time + this.minBreak;
    while (this.breakHead < this.breaks.length && this.breaks[this.breakHead] <= lim) this.breakHead++;
    if (this.breakHead > 4096) {
      this.breaks = this.breaks.slice(this.breakHead);
      this.breakHead = 0;
    }
    return this.breakHead < this.breaks.length ? this.breaks[this.breakHead] : Infinity;
  }

  /** Request a breakpoint at time t (> current time). */
  addBreakpoint(t: number): void {
    if (t > this.time + this.minBreak && t <= this.tstop) this.insertBreaks([t]);
  }

  // ------------------------------------------------------------------ stepping

  /** The step the engine will attempt next (before any rejection). */
  planStep(): StepPlan {
    const nb = Math.min(this.nextBreak(), this.tstop);
    let dt = Math.min(this.dt, this.maxStepEff());
    const remain = nb - this.time;
    // snap onto a breakpoint that is less than minBreak ahead — but never stretch the step by more
    // than half: when the truncation error asks for steps below minBreak (time constants far
    // shorter than the breakpoint resolution), stretching would be rejected again and again; the
    // short step is taken instead and the breakpoint, now closer than minBreak, is merged
    if (dt >= remain - this.minBreak && (dt >= remain || remain <= 1.5 * dt)) return { dt: remain, time: nb, hitsBreakpoint: true };
    if (dt * 1.5 > remain) dt = remain / 2;
    return { dt, time: this.time + dt, hitsBreakpoint: false };
  }

  /** True once the stop time has been reached. */
  get finished(): boolean {
    return this.time >= this.tstop - this.minBreak;
  }

  /**
   * Advance by one accepted timepoint. Returns false (without doing anything) when tstop has
   * been reached. Throws SimulationError 'timestep' when the step collapses.
   */
  step(): boolean {
    if (!this.initialized) this.initialize();
    if (this.finished) return false;
    for (;;) {
      checkAbort(this.sys.signal);
      const plan = this.planStep();
      const dt = plan.dt;
      if (!this.solveTimepoint(plan.time, dt)) {
        this.rejectedSteps++;
        this.order = 1;
        this.sinceRestart = 0;
        this.dt = dt / 8;
        if (this.dt < this.delmin) {
          throw new SimulationError(
            `Timestep too small at t = ${fmt(this.time)} s (step ${fmt(this.dt)} s): ${this.lastFailure}`,
            'timestep',
            this.lastFailure,
          );
        }
        continue;
      }
      const newDt = this.truncationStep(dt);
      if (newDt > 0.9 * dt || dt <= this.delmin) {
        this.accept(plan, newDt);
        return true;
      }
      this.rejectedSteps++;
      let next = newDt;
      if (!(next >= this.delmin)) {
        if (dt > this.delmin) next = this.delmin;
        else {
          throw new SimulationError(
            `Timestep too small at t = ${fmt(this.time)} s: local truncation error cannot be met`,
            'timestep',
          );
        }
      }
      this.dt = next;
    }
  }

  /** Solve the timepoint at time `t` reached with step `dt`; false when Newton fails. */
  private solveTimepoint(t: number, dt: number): boolean {
    const sys = this.sys;
    const ctx = sys.ctx;
    sys.states[0].set(sys.states[1]);
    this.deltaOld[0] = dt;
    ctx.mode = 'tran';
    ctx.time = t;
    ctx.setIntegration({ order: this.order, method: this.circuit.options.method, dt, dtPrev: this.deltaOld[1] });
    sys.x.set(this.lastX);
    sys.xPrev.set(this.lastX);
    const r = newtonSolve(sys, { maxIter: Math.max(1, this.circuit.options.itl4), initTimepoint: true });
    this.newtonIterations += r.iterations;
    if (r.converged) return true;
    if (r.error && r.error.code === 'singular' && this.circuit.allLinear) throw r.error;
    this.lastFailure = describeFailure(sys, r);
    return false;
  }

  /** Smallest step admitted by the devices' truncation error at the solved point. */
  private truncationStep(dt: number): number {
    if (this.truncDevices.length === 0) return Infinity;
    const tc = this.truncCtx;
    tc.dt = dt;
    tc.order = this.order;
    let m = Infinity;
    for (const d of this.truncDevices) {
      const v = (d.truncate as (ctx: TruncContext) => number)(tc);
      if (v < m) m = v;
    }
    return m;
  }

  private accept(plan: StepPlan, newDt: number): void {
    const sys = this.sys;
    const prevDt = plan.dt;
    const savedDt = Math.min(this.dt, this.maxStepEff());
    this.time = plan.time;
    const ac = this.acceptCtx;
    ac.time = this.time;
    ac.dt = prevDt;
    ac.state0 = sys.states[0];
    for (const d of this.acceptDevices) d.accept?.(ac);
    sys.rotateStates();
    this.lastX.set(sys.x);
    const dOld = this.deltaOld;
    for (let k = dOld.length - 1; k > 0; k--) dOld[k] = dOld[k - 1];
    this.acceptedSteps++;
    if (plan.hitsBreakpoint) {
      this.order = 1;
      this.sinceRestart = 0;
      const nb = Math.min(this.nextBreak(), this.tstop);
      const gap = nb - this.time;
      this.dt = Math.min(newDt, 0.1 * Math.min(savedDt, gap > 0 ? gap : savedDt));
    } else {
      // Ringing control. A sharp edge stepped over with h ≫ τ excites the stiff modes of the
      // circuit; trapezoidal integration barely damps them (amplification
      // (1 − h/2τ)/(1 + h/2τ) → −1) and the divided-difference LTE estimate, measured against
      // reltol·|q|, does not see a ±1 % point-to-point alternation, so it would ring for
      // thousands of time constants. Backward Euler damps each such mode by 1/(1 + h/τ) per step:
      // a few BE steps after every restart bring a full-scale excitation far below reltol,
      // after which the trapezoidal rule takes over. Gear-2 (BDF2) is L-stable and switches
      // order right away, as in SPICE3.
      this.sinceRestart++;
      const holdBe = this.circuit.options.method !== 'gear' && this.sinceRestart < STARTUP_BE_STEPS;
      if (this.order < this.maxOrder && !holdBe) this.order = this.maxOrder;
      this.dt = Math.min(newDt, 2 * prevDt);
    }
    this.dt = Math.min(this.dt, this.maxStepEff());
    if (!(this.dt > this.delmin)) this.dt = 2 * this.delmin;
  }

  /**
   * Notify a discontinuity at the current time (an element value changed between steps):
   * restart integration at order 1 with a short step and re-query breakpoints.
   */
  discontinuity(): void {
    this.order = 1;
    this.sinceRestart = 0;
    this.computeDeviceMaxStep();
    this.dt = Math.min(this.dt, 0.1 * this.maxStepEff());
    this.breaks = [];
    this.breakHead = 0;
    this.horizon = this.time;
    if (Number.isFinite(this.tstop)) this.insertBreaks([this.tstop]);
  }

  // ------------------------------------------------------------------ truncation error

  /**
   * Admissible step for the charge in state slot q (current in q+1), from the (order+1)-th divided
   * difference of the charge history: del = trtol*tol / max(abstol, C*|dd|), root of order `order`.
   */
  private terr(q: number): number {
    const sys = this.sys;
    const s = sys.states;
    const opts = this.circuit.options;
    const order = this.order;
    const dt = this.truncCtx.dt;
    const q0 = s[0][q];
    const q1 = s[1][q];
    const volttol = opts.abstol + opts.reltol * Math.max(Math.abs(s[0][q + 1]), Math.abs(s[1][q + 1]));
    const chargetol = (opts.reltol * Math.max(Math.max(Math.abs(q0), Math.abs(q1)), opts.chgtol)) / dt;
    const tol = Math.max(volttol, chargetol);
    const diff = this.diff;
    const deltmp = this.deltmp;
    const dOld = this.deltaOld;
    for (let i = 0; i <= order + 1; i++) diff[i] = s[i][q];
    for (let i = 0; i <= order; i++) deltmp[i] = dOld[i];
    let j = order;
    for (;;) {
      for (let i = 0; i <= j; i++) diff[i] = (diff[i] - diff[i + 1]) / deltmp[i];
      if (--j < 0) break;
      for (let i = 0; i <= j; i++) deltmp[i] = deltmp[i + 1] + dOld[i];
    }
    const factor = (this.circuit.options.method === 'gear' ? GEAR_COEFF : TRAP_COEFF)[order - 1];
    let del = (opts.trtol * tol) / Math.max(opts.abstol, factor * Math.abs(diff[0]));
    if (order === 2) del = Math.sqrt(del);
    else if (order > 2) del = Math.pow(del, 1 / order);
    return del;
  }
}
