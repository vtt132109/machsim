/**
 * Circuit inspection for the lesson checkers (src/learn/lessons.ts): which parts are placed, how
 * their pins are connected and what the circuit measures when it is simulated.
 *
 *   const c = new LessonCircuit(design, runAnalyses);
 *   c.parts({ families: ['Resistor'] })          // placed parts (root sheets)
 *   c.net(ref, '1')                              // SPICE node of a pin ("0" = ground)
 *   c.across(meter, r2)                          // both pins on the same two nets
 *   const op = await c.op();  op.v(net)          // operating point
 *   const tr = await c.tran(5e-3);  tr.wave(net) // transient waveform
 *   c.meter(op)                                  // multimeter reading (volts / amperes)
 *
 * Simulation runs are memoised per analysis, so several checks of one lesson share them. The
 * runner is injected (src/sim runAnalyses in tests, the in-process engine loaded on first use in
 * the app), which keeps this module free of the engine and of the DOM.
 */
import { getPart } from '../library';
import type { PartDef } from '../library/types';
import { buildNetlist, type NetlistBuildEx } from '../model/netlister';
import type { Design, ErcMessage, InstrumentBinding, InstrumentKind, PartInstance, SignalRef } from '../model/types';
import type { AnalysisSpec, Netlist } from '../sim/netlist';
import type { AnalysisResult, Vector } from '../sim/results';
import { parseUserNumber } from '../util/units';
import { resolveDesignVariables, substituteVariables } from '../model/variables';
import { defaultParams } from '../library';

/** Runs the analyses of a netlist (src/sim runAnalyses or a worker-backed equivalent). */
export type RunFn = (netlist: Netlist) => AnalysisResult[] | Promise<AnalysisResult[]>;

/** Which placed parts a check looks for (any listed criterion matches). */
export interface PartMatch {
  /** exact library part ids */
  ids?: string[];
  /** part id prefixes, e.g. 'misc-digital/and' */
  prefixes?: string[];
  /** library family names (PartDef.family), e.g. 'Resistor', 'Op-amp' */
  families?: string[];
  /** virtual instrument kinds */
  instruments?: InstrumentKind[];
  /** parts that have every one of these pin names (e.g. the 7490 family: CKA, QA …) */
  pins?: string[];
}

export interface PartRef {
  inst: PartInstance;
  def: PartDef;
  sheetId: string;
}

/** The simulation failed (engine error, no convergence ...); `message` is the engine's text. */
export class SimFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimFailure';
  }
}

/** Values of one analysis result. */
export class SimValues {
  private readonly byName = new Map<string, Vector>();
  constructor(readonly result: AnalysisResult) {
    for (const v of result.vectors) this.byName.set(v.name.toLowerCase(), v);
  }

  vec(name: string): Vector | undefined {
    return this.byName.get(name.toLowerCase());
  }

  /** Node voltage (last sample of a transient), 0 for ground; NaN for an unknown node. */
  v(net: string | undefined): number {
    if (net === undefined) return NaN;
    if (net === '0') return 0;
    const x = this.vec(`V(${net})`);
    return x ? x.re[x.re.length - 1] : NaN;
  }

  /** V(a) − V(b). */
  vd(a: string | undefined, b: string | undefined): number {
    return this.v(a) - this.v(b);
  }

  /** Last value of a vector (e.g. "I(V1)", "I(R1)"), NaN when absent. */
  last(name: string): number {
    const x = this.vec(name);
    return x ? x.re[x.re.length - 1] : NaN;
  }

  /** Time axis of a transient. */
  get time(): Float64Array {
    return this.result.scale?.re ?? new Float64Array(0);
  }

  /** Samples of a node voltage (zeros for ground). */
  wave(net: string | undefined): Float64Array {
    if (net === '0') return new Float64Array(this.time.length);
    const x = net ? this.vec(`V(${net})`) : undefined;
    return x ? x.re : new Float64Array(0);
  }

  /** Value of a node voltage at time t (linear interpolation). */
  at(net: string | undefined, t: number): number {
    const time = this.time;
    const w = this.wave(net);
    if (!w.length) return NaN;
    if (t <= time[0]) return w[0];
    for (let i = 1; i < time.length; i++) {
      if (time[i] >= t) {
        const f = (t - time[i - 1]) / (time[i] - time[i - 1] || 1);
        return w[i - 1] + f * (w[i] - w[i - 1]);
      }
    }
    return w[w.length - 1];
  }

  /** Minimum and maximum of a node voltage from time `from` on. */
  range(net: string | undefined, from = 0): { min: number; max: number } {
    const time = this.time;
    const w = this.wave(net);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < w.length; i++) {
      if (time[i] < from) continue;
      min = Math.min(min, w[i]);
      max = Math.max(max, w[i]);
    }
    return { min, max };
  }

  /** Frequency of a node voltage from its rising crossings of `level` after time `from`; 0 without two crossings. */
  frequency(net: string | undefined, level: number, from = 0): number {
    const time = this.time;
    const w = this.wave(net);
    const crossings: number[] = [];
    for (let i = 1; i < w.length; i++) {
      if (time[i] < from) continue;
      if (w[i - 1] < level && w[i] >= level) {
        const f = (level - w[i - 1]) / (w[i] - w[i - 1] || 1);
        crossings.push(time[i - 1] + f * (time[i] - time[i - 1]));
      }
    }
    if (crossings.length < 2) return 0;
    return (crossings.length - 1) / (crossings[crossings.length - 1] - crossings[0]);
  }

  /** Complex value of a node voltage (AC / single-frequency AC results). */
  phasor(net: string | undefined): { re: number; im: number } {
    if (net === '0') return { re: 0, im: 0 };
    const x = net ? this.vec(`V(${net})`) : undefined;
    if (!x) return { re: NaN, im: NaN };
    const i = x.re.length - 1;
    return { re: x.re[i], im: x.im?.[i] ?? 0 };
  }

  /** |V(a)| / |V(b)| of an AC result. */
  gain(out: string | undefined, input: string | undefined): number {
    const a = this.phasor(out);
    const b = this.phasor(input);
    return Math.hypot(a.re, a.im) / Math.hypot(b.re, b.im);
  }

  /**
   * Value of a `.meas` measurement of this result (src/sim/analyses/meas.ts), by name
   * (case-insensitive); undefined when the result has no such measurement. A measurement whose
   * condition never happened reports NaN, which a lesson tells the learner about.
   */
  measurement(name: string): number | undefined {
    const key = name.toLowerCase();
    return this.result.measurements?.find((m) => m.name.toLowerCase() === key)?.value;
  }

  /** Value of a signal reference (instrument channel). */
  signal(ref: SignalRef | undefined): number {
    if (!ref) return NaN;
    return ref.kind === 'voltage' ? this.vd(ref.pos, ref.neg) : this.last(`I(${ref.element})`);
  }
}

/** Inspection of one design for the lesson checks. */
export class LessonCircuit {
  private buildCache: NetlistBuildEx | null = null;
  private readonly sims = new Map<string, Promise<SimValues>>();

  constructor(
    readonly design: Design,
    private readonly runner: RunFn,
    private readonly lookup: (id: string) => PartDef | undefined = getPart,
  ) {}

  /** Netlist build of the design (without analysis cards). */
  get build(): NetlistBuildEx {
    this.buildCache ??= buildNetlist(this.design, { includeAnalysis: false }) as NetlistBuildEx;
    return this.buildCache;
  }

  /** Placed parts of the root sheets that match (parts excluded from simulation are skipped). */
  parts(m: PartMatch): PartRef[] {
    const out: PartRef[] = [];
    for (const sheet of this.design.sheets) {
      for (const inst of sheet.parts) {
        if (inst.excludeFromSim) continue;
        const def = this.lookup(inst.partId);
        if (!def) continue;
        const hit =
          !!m.ids?.includes(def.id) ||
          !!m.prefixes?.some((p) => def.id.startsWith(p)) ||
          !!m.families?.includes(def.family) ||
          (def.instrument !== undefined && !!m.instruments?.includes(def.instrument)) ||
          (!!m.pins?.length && m.pins.every((n) => def.symbol.pins.some((p) => p.name === n)));
        if (hit) out.push({ inst, def, sheetId: sheet.id });
      }
    }
    return out;
  }

  /** SPICE node of a pin ("0" = ground), undefined when the part or pin is unknown. */
  net(ref: PartRef | undefined, pin: string): string | undefined {
    if (!ref) return undefined;
    return this.build.partNets[ref.inst.refdes]?.[pin];
  }

  /** True when the pin's net connects to at least one other part pin (not floating). */
  pinConnected(ref: PartRef, pin: string): boolean {
    const node = this.net(ref, pin);
    if (!node) return false;
    if (node === '0') return true;
    const info = this.build.nets.find((n) => n.name === node);
    return !!info && info.pins.some((p) => !(p.refdes === ref.inst.refdes && p.pin === pin));
  }

  /** SPICE node of a net named by a label / connector (case-insensitive), undefined when absent. */
  namedNet(name: string): string | undefined {
    const key = name.toLowerCase();
    return this.build.nets.find((n) => n.named && n.displayName.toLowerCase() === key)?.name;
  }

  /** SPICE name of the element of `type` ('V', 'R' …) a part produced (e.g. "V1" for a DC source). */
  element(ref: PartRef | undefined, type: string): string | undefined {
    if (!ref) return undefined;
    const t = type.toUpperCase();
    return this.build.netlist.elements.find((e) => e.type === t && this.build.owners[e.name.toLowerCase()] === ref.inst.refdes)?.name;
  }

  /** Nets of a part's pins, in pin order. */
  pinNets(ref: PartRef): string[] {
    return ref.def.symbol.pins.map((p) => this.net(ref, p.name) ?? '');
  }

  /** Both two-terminal parts sit on the same pair of nets (in either order), e.g. a meter across a resistor. */
  across(a: PartRef | undefined, b: PartRef | undefined, pinsA?: [string, string], pinsB?: [string, string]): boolean {
    if (!a || !b) return false;
    const na = (pinsA ?? twoPins(a)).map((p) => this.net(a, p));
    const nb = (pinsB ?? twoPins(b)).map((p) => this.net(b, p));
    if (na.some((n) => !n) || nb.some((n) => !n) || na[0] === na[1]) return false;
    return (na[0] === nb[0] && na[1] === nb[1]) || (na[0] === nb[1] && na[1] === nb[0]);
  }

  /** The two nets of a two-terminal part share a net with `node` on one side. */
  touches(ref: PartRef | undefined, node: string | undefined): boolean {
    return !!ref && !!node && this.pinNets(ref).includes(node);
  }

  /** Numeric parameter of a placed part (user number syntax, defaults and design variables applied). */
  num(ref: PartRef | undefined, key: string): number {
    if (!ref) return NaN;
    const params = { ...defaultParams(ref.def), ...ref.inst.params };
    let text = params[key] ?? '';
    if (text.includes('{')) {
      try {
        text = substituteVariables(ref.def, params, resolveDesignVariables(this.design.variables)).params[key] ?? text;
      } catch {
        /* keep the raw text */
      }
    }
    return parseUserNumber(text);
  }

  /** Text parameter of a placed part (default applied), lower case. */
  text(ref: PartRef | undefined, key: string): string {
    if (!ref) return '';
    const params = { ...defaultParams(ref.def), ...ref.inst.params };
    return (params[key] ?? '').trim().toLowerCase();
  }

  /** ERC errors of the design (warnings are ignored by the lessons). */
  ercErrors(): ErcMessage[] {
    return this.build.erc.filter((m) => m.severity === 'error');
  }

  /** Instrument binding of a placed instrument. */
  instrument(ref: PartRef | undefined): InstrumentBinding | undefined {
    return ref ? this.build.instruments.find((b) => b.refdes === ref.inst.refdes) : undefined;
  }

  /**
   * Reading of a meter (the given one, else the first multimeter) in its current function:
   * volts (mode v), amperes (mode a); undefined when there is no meter. Meters are the
   * multimeter, the 6½-digit bench multimeter (DC / AC V -> v, DC / AC I -> a) and the panel
   * voltmeter / ammeter indicators (always v / a), see METER_MATCH.
   */
  meter(values: SimValues, ref?: PartRef): { value: number; mode: string; ref: PartRef } | undefined {
    const m = ref ?? this.parts(METER_MATCH)[0];
    if (!m) return undefined;
    const ind = this.build.indicators.find((b) => b.refdes === m.inst.refdes);
    if (ind && (ind.kind === 'voltmeter' || ind.kind === 'ammeter')) return { value: values.signal(ind.signal), mode: this.meterMode(m), ref: m };
    const b = this.instrument(m);
    if (!b) return undefined;
    const mode = this.meterMode(m);
    const value = mode === 'a' ? values.signal(b.channels.i) : values.signal(b.channels.v);
    return { value, mode, ref: m };
  }

  /** What a meter measures: 'v' (volts), 'a' (amperes) or another function ("ohm" …). */
  meterMode(ref: PartRef): string {
    if (ref.def.id === 'indicators/ammeter') return 'a';
    if (ref.def.id === 'indicators/voltmeter') return 'v';
    const t = ((ref.def.instrument === 'bench-multimeter' ? this.text(ref, 'function') : this.text(ref, 'mode')) || 'v').trim().toLowerCase();
    if (t === 'dcv' || t === 'acv') return 'v';
    if (t === 'dci' || t === 'aci') return 'a';
    return t;
  }

  /**
   * Current flowing into a part at one pin (A): the sum over the part's own two-terminal elements
   * on that pin's node (SPICE sign: I(e) flows from e.nodes[0] through e to e.nodes[1]). NaN when
   * an element on the node is not two-terminal or has no current vector.
   */
  pinCurrent(values: SimValues, ref: PartRef, pin: string): number {
    const node = this.net(ref, pin);
    if (!node) return NaN;
    let sum = 0;
    let any = false;
    for (const e of this.build.netlist.elements) {
      if (this.build.owners[e.name.toLowerCase()] !== ref.inst.refdes || !e.nodes.includes(node)) continue;
      if (e.nodes.length !== 2 || e.nodes[0] === e.nodes[1]) return NaN;
      const i = values.last(`I(${e.name})`);
      if (!Number.isFinite(i)) return NaN;
      sum += e.nodes[0] === node ? i : -i;
      any = true;
    }
    return any ? sum : NaN;
  }

  /** Current through a two-terminal part at the operating point (absolute value, A); NaN when unknown. */
  current(values: SimValues, ref: PartRef | undefined): number {
    if (!ref) return NaN;
    const viaPin = this.pinCurrent(values, ref, twoPins(ref)[0]);
    if (Number.isFinite(viaPin)) return Math.abs(viaPin);
    const r = ref.inst.refdes;
    for (const name of [`I(${r})`, `I(D_${r})`, `I(V_${r}_i)`, `I(R_${r})`, `I(V_${r})`]) {
      const v = values.last(name);
      if (Number.isFinite(v)) return Math.abs(v);
    }
    return NaN;
  }

  /** Run one analysis (memoised); throws SimFailure when the engine reports an error. */
  simulate(spec: AnalysisSpec): Promise<SimValues> {
    const key = JSON.stringify(spec);
    let p = this.sims.get(key);
    if (!p) {
      p = (async () => {
        const netlist: Netlist = { ...this.build.netlist, analyses: [spec] };
        let results: AnalysisResult[];
        try {
          results = await this.runner(netlist);
        } catch (e) {
          throw new SimFailure(e instanceof Error ? e.message : String(e));
        }
        const r = results[0];
        if (!r) throw new SimFailure('no result');
        if (r.error) throw new SimFailure(r.error);
        return new SimValues(r);
      })();
      this.sims.set(key, p);
    }
    return p;
  }

  op(): Promise<SimValues> {
    return this.simulate({ type: 'op' });
  }

  /** Transient from 0 to tstop (default output step tstop / 2000). */
  tran(tstop: number, tstep = tstop / 2000, tmax?: number): Promise<SimValues> {
    return this.simulate(tmax ? { type: 'tran', tstep, tstop, tmax } : { type: 'tran', tstep, tstop });
  }

  /** Single-frequency AC analysis (phasors at `freq`). */
  acAt(freq: number): Promise<SimValues> {
    return this.simulate({ type: 'acsingle', freq });
  }
}

/** The two terminals of a two-pin part (its first two pins). */
/** Every part a lesson accepts as "a meter" (see LessonCircuit.meter). */
export const METER_MATCH: PartMatch = { instruments: ['multimeter', 'bench-multimeter'], ids: ['indicators/voltmeter', 'indicators/ammeter'] };

export function twoPins(ref: PartRef): [string, string] {
  const pins = ref.def.symbol.pins;
  return [pins[0]?.name ?? '1', pins[1]?.name ?? '2'];
}
