/**
 * Control-card parsing for the SPICE reader (parser.ts): analyses, output requests, options,
 * .temp / .step sweeps and .ic / .nodeset.
 *
 * Analyses (SPICE3/ngspice syntax, plus the PSpice/LTspice variants noted):
 *   .op
 *   .dc [lin] src start stop step [[lin] src2 start2 stop2 step2]   (src may be "temp")
 *   .ac dec|oct|lin points fstart fstop   |   .ac list f1 f2 ...
 *   .tran tstep tstop [tstart [tmax]] [uic|skipbp]   (LTspice ".tran tstop": tstep = tstop/1000)
 *   .noise V(out[,ref]) src [dec|oct|lin points fstart fstop [pts_per_summary]]
 *          (PSpice form without a sweep takes the sweep of the .ac analysis)
 *   .tf V(out[,ref])|I(Vx) src
 *   .sens V(out[,ref])|I(Vx) [ac dec|oct|lin points fstart fstop]
 *   .pz in+ in- out+ out- vol|cur pol|zer|pz
 *   .four freq [nharmonics] out1 [out2 ...]     (default 9 harmonics)
 *   .disto dec|oct|lin points fstart fstop [f2overf1]
 * Numeric arguments may be expressions of global .param values; the reader evaluates them through
 * ControlContext.num().
 */

import type { AnalysisSpec, NoiseAnalysis, SimOptions, SweepType } from '../netlist';
import { CardError, parseNumberWord, type Tok } from './lexer';
import { isAssign, isValueTok } from './elements';

export interface ControlContext {
  /** Evaluate a value token (number or expression of global parameters). */
  num(t: Tok): number;
  warn(message: string): void;
}

function numAt(toks: readonly Tok[], k: number, what: string, ctx: ControlContext): number {
  const t = toks[k];
  if (!isValueTok(t)) throw new CardError(`missing ${what}`);
  return ctx.num(t);
}

function wordAt(toks: readonly Tok[], k: number, what: string): string {
  const t = toks[k];
  if (!t || t.t !== 'word') throw new CardError(`missing ${what}`);
  return t.v;
}

const SWEEPS: Readonly<Record<string, SweepType>> = { dec: 'dec', oct: 'oct', lin: 'lin', list: 'list' };

function sweepWord(t: Tok | undefined): SweepType | undefined {
  if (!t || t.t !== 'word') return undefined;
  const w = t.v.toLowerCase();
  return Object.hasOwn(SWEEPS, w) ? SWEEPS[w] : undefined;
}

interface Sweep {
  sweep: SweepType;
  points: number;
  fstart: number;
  fstop: number;
  list?: number[];
  next: number;
}

function readSweep(toks: readonly Tok[], k: number, ctx: ControlContext, allowList: boolean): Sweep {
  const sweep = sweepWord(toks[k]);
  if (!sweep || (sweep === 'list' && !allowList)) {
    throw new CardError(`expected a sweep type (dec, oct, lin${allowList ? ', list' : ''})`);
  }
  k++;
  if (sweep === 'list') {
    const list: number[] = [];
    while (isValueTok(toks[k])) list.push(ctx.num(toks[k++]));
    if (list.length === 0) throw new CardError('empty frequency list');
    if (list.some((f) => !(f > 0))) throw new CardError('list frequencies must be positive');
    return { sweep, points: list.length, fstart: list[0], fstop: list[list.length - 1], list, next: k };
  }
  const points = numAt(toks, k, 'number of points', ctx);
  const fstart = numAt(toks, k + 1, 'start frequency', ctx);
  const fstop = numAt(toks, k + 2, 'stop frequency', ctx);
  if (!(points >= 1) || !Number.isInteger(points)) throw new CardError(`number of points must be a positive integer (got ${points})`);
  if (!(fstart > 0)) throw new CardError('start frequency must be positive');
  if (!(fstop >= fstart)) throw new CardError('stop frequency must not be below the start frequency');
  return { sweep, points, fstart, fstop, next: k + 3 };
}

/** Reads NAME(arg[,arg]) at index k. */
function readCall(toks: readonly Tok[], k: number): { fn: string; args: string[]; next: number } | undefined {
  const t = toks[k];
  if (!t || t.t !== 'word' || toks[k + 1]?.t !== '(') return undefined;
  const args: string[] = [];
  let j = k + 2;
  for (; j < toks.length && toks[j].t !== ')'; j++) {
    const u = toks[j];
    if (u.t === ',') continue;
    if (u.t !== 'word') throw new CardError(`unexpected '${u.v}' in ${t.v}(...)`);
    args.push(u.v);
  }
  if (j >= toks.length) throw new CardError(`missing ')' after ${t.v}(`);
  if (args.length === 0) throw new CardError(`empty ${t.v}()`);
  return { fn: t.v, args, next: j + 1 };
}

/**
 * Canonical output-request name. AC print variants (VM, VDB, VP, VR, VI, VPH and the I forms)
 * collapse to V(...) / I(...); device outputs such as Ic(Q1) keep their key.
 */
export function outputName(fn: string, args: readonly string[]): string {
  const f = fn.toLowerCase();
  if (/^v(m|db|p|r|i|ph)?$/.test(f)) return `V(${args.join(',')})`;
  if (/^i(m|db|p|r|i|ph)?$/.test(f) && args.length === 1) return `I(${args[0]})`;
  return `${fn}(${args.join(',')})`;
}

function readSignal(toks: readonly Tok[], k: number, what: string): { text: string; fn: 'v' | 'i'; args: string[]; next: number } {
  const call = readCall(toks, k);
  if (!call) throw new CardError(`expected ${what} as V(node[,ref]) or I(source)`);
  const name = outputName(call.fn, call.args);
  const fn = name[0] === 'V' ? 'v' : name[0] === 'I' && name[1] === '(' ? 'i' : undefined;
  if (!fn) throw new CardError(`expected ${what} as V(node[,ref]) or I(source), got '${call.fn}(...)'`);
  if (fn === 'v' && call.args.length > 2) throw new CardError('V() takes one or two nodes');
  return { text: name, fn, args: call.args, next: call.next };
}

const PRINT_ANALYSES = new Set(['tran', 'ac', 'dc', 'op', 'noise', 'disto', 'tf', 'sens', 'pz']);

/**
 * Output requests of .save / .print / .plot / .probe. `skipAnalysis` drops a leading analysis
 * keyword (.print tran ...). Device-internal requests (@m1[id]) are reported in `ignored`.
 */
export function readOutputs(toks: readonly Tok[], start: number, skipAnalysis: boolean): { outputs: string[]; ignored: string[] } {
  const outputs: string[] = [];
  const ignored: string[] = [];
  let k = start;
  if (skipAnalysis && toks[k]?.t === 'word' && PRINT_ANALYSES.has(toks[k].v.toLowerCase())) k++;
  while (k < toks.length) {
    const t = toks[k];
    if (t.t === 'word' && t.v.startsWith('@')) {
      let text = t.v;
      k++;
      if (toks[k]?.t === '[') {
        while (k < toks.length && toks[k].t !== ']') text += toks[k++].v;
        text += ']';
        k++;
      }
      ignored.push(text);
      continue;
    }
    const call = readCall(toks, k);
    if (call) {
      outputs.push(outputName(call.fn, call.args));
      k = call.next;
      continue;
    }
    if (t.t === 'word') outputs.push(t.v.toLowerCase() === 'all' ? 'all' : t.v);
    k++;
  }
  return { outputs, ignored };
}

/** Result of parsing an analysis card. `needsAcSweep`: PSpice .noise without its own sweep. */
export interface AnalysisParse {
  spec?: AnalysisSpec;
  needsAcSweep?: boolean;
}

/** Parse an analysis card (`cmd` = lower-case card keyword without the dot). */
export function parseAnalysisCard(cmd: string, toks: readonly Tok[], ctx: ControlContext): AnalysisParse {
  switch (cmd) {
    case 'op':
      return { spec: { type: 'op' } };
    case 'dc':
      return parseDc(toks, ctx);
    case 'ac': {
      const s = readSweep(toks, 1, ctx, true);
      if (s.next < toks.length) throw new CardError(`unexpected '${toks[s.next].v}'`);
      const spec: AnalysisSpec = { type: 'ac', sweep: s.sweep, points: s.points, fstart: s.fstart, fstop: s.fstop };
      if (s.list) spec.list = s.list;
      return { spec };
    }
    case 'tran':
      return { spec: parseTran(toks, ctx) };
    case 'noise':
      return parseNoise(toks, ctx);
    case 'tf': {
      const out = readSignal(toks, 1, 'the output');
      const src = wordAt(toks, out.next, 'input source name');
      return { spec: { type: 'tf', output: out.text, src } };
    }
    case 'sens': {
      const out = readSignal(toks, 1, 'the output');
      let k = out.next;
      const spec: AnalysisSpec = { type: 'sens', output: out.text };
      if (toks[k]?.t === 'word' && toks[k].v.toLowerCase() === 'ac') {
        const s = readSweep(toks, k + 1, ctx, false);
        spec.ac = { sweep: s.sweep, points: s.points, fstart: s.fstart, fstop: s.fstop };
        k = s.next;
      } else if (k < toks.length) {
        ctx.warn('.sens: only the first output is analysed');
      }
      return { spec };
    }
    case 'pz': {
      const nodes = [0, 1, 2, 3].map((j) => wordAt(toks, 1 + j, 'pole-zero node'));
      const transfer = wordAt(toks, 5, 'transfer type (vol or cur)').toLowerCase();
      const find = wordAt(toks, 6, 'pz analysis type (pol, zer or pz)').toLowerCase();
      if (transfer !== 'vol' && transfer !== 'cur') throw new CardError(`expected vol or cur, got '${transfer}'`);
      if (find !== 'pol' && find !== 'zer' && find !== 'pz') throw new CardError(`expected pol, zer or pz, got '${find}'`);
      return {
        spec: { type: 'pz', inPos: nodes[0], inNeg: nodes[1], outPos: nodes[2], outNeg: nodes[3], transfer, find },
      };
    }
    case 'four': {
      const fundamental = numAt(toks, 1, 'fundamental frequency', ctx);
      if (!(fundamental > 0)) throw new CardError('fundamental frequency must be positive');
      let k = 2;
      let harmonics = 9;
      const t = toks[k];
      if (t && t.t === 'word' && toks[k + 1]?.t !== '(' && parseNumberWord(t.v) !== undefined) {
        harmonics = ctx.num(t);
        k++;
      }
      if (!Number.isInteger(harmonics) || harmonics < 1) throw new CardError('number of harmonics must be a positive integer');
      const { outputs } = readOutputs(toks, k, false);
      if (outputs.length === 0) throw new CardError('.four needs at least one output');
      return { spec: { type: 'four', fundamental, harmonics, outputs } };
    }
    case 'disto': {
      const s = readSweep(toks, 1, ctx, false);
      const spec: AnalysisSpec = { type: 'disto', sweep: s.sweep, points: s.points, fstart: s.fstart, fstop: s.fstop };
      if (isValueTok(toks[s.next])) {
        const r = ctx.num(toks[s.next]);
        if (!(r > 0 && r <= 1)) throw new CardError('f2overf1 must be in (0, 1]');
        spec.f2overf1 = r;
      }
      return { spec };
    }
    default:
      throw new CardError(`unknown analysis '.${cmd}'`);
  }
}

function parseDc(toks: readonly Tok[], ctx: ControlContext): AnalysisParse {
  let k = 1;
  const readOne = () => {
    if (sweepWord(toks[k]) === 'lin') k++;
    const kind = sweepWord(toks[k]);
    if (kind === 'dec' || kind === 'oct' || kind === 'list') return undefined;
    const src = wordAt(toks, k, 'sweep source');
    if (src.toLowerCase() === 'param') return undefined;
    if (sweepWord(toks[k + 1]) === 'list') return undefined;
    const start = numAt(toks, k + 1, 'sweep start', ctx);
    const stop = numAt(toks, k + 2, 'sweep stop', ctx);
    const step = numAt(toks, k + 3, 'sweep step', ctx);
    if (step === 0 && start !== stop) throw new CardError('sweep step must not be zero');
    k += 4;
    return { src, start, stop, step };
  };
  const first = readOne();
  if (!first) {
    ctx.warn('.dc: only linear sweeps of sources or temperature are supported; analysis ignored');
    return {};
  }
  const spec: AnalysisSpec = { type: 'dc', ...first };
  if (k < toks.length) {
    const second = readOne();
    if (!second) {
      ctx.warn('.dc: only linear sweeps of sources or temperature are supported; analysis ignored');
      return {};
    }
    spec.src2 = second;
    if (k < toks.length) throw new CardError(`unexpected '${toks[k].v}'`);
  }
  return { spec };
}

const TRAN_IGNORED = new Set(['startup', 'steady', 'nodiscard', 'nokeep']);

function parseTran(toks: readonly Tok[], ctx: ControlContext): AnalysisSpec {
  const nums: number[] = [];
  let uic = false;
  for (let k = 1; k < toks.length; k++) {
    const t = toks[k];
    const w = t.t === 'word' ? t.v.toLowerCase() : '';
    if (w === 'uic' || w === 'skipbp') {
      uic = true;
      continue;
    }
    if (TRAN_IGNORED.has(w)) {
      ctx.warn(`.tran option '${t.v}' ignored`);
      continue;
    }
    if (!isValueTok(t)) throw new CardError(`unexpected '${t.v}'`);
    if (nums.length >= 4) throw new CardError(`unexpected '${t.v}'`);
    nums.push(ctx.num(t));
  }
  if (nums.length === 0) throw new CardError('missing stop time');
  const [a, b, tstart, tmax] = nums;
  const tstop = nums.length === 1 ? a : b;
  const tstep = nums.length === 1 ? a / 1000 : a;
  if (!(tstop > 0)) throw new CardError('stop time must be positive');
  if (!(tstep >= 0)) throw new CardError('time step must not be negative');
  const spec: AnalysisSpec = { type: 'tran', tstep, tstop };
  if (tstart !== undefined) {
    if (!(tstart >= 0 && tstart < tstop)) throw new CardError('start time must be in [0, tstop)');
    spec.tstart = tstart;
  }
  if (tmax !== undefined) {
    if (!(tmax > 0)) throw new CardError('maximum step must be positive');
    spec.tmax = tmax;
  }
  if (uic) spec.uic = true;
  return spec;
}

function parseNoise(toks: readonly Tok[], ctx: ControlContext): AnalysisParse {
  const out = readSignal(toks, 1, 'the noise output');
  if (out.fn !== 'v') throw new CardError('noise output must be a voltage V(node[,ref])');
  const src = wordAt(toks, out.next, 'input source name');
  const spec: NoiseAnalysis = {
    type: 'noise',
    output: out.args[0],
    src,
    sweep: 'dec',
    points: 0,
    fstart: 0,
    fstop: 0,
  };
  if (out.args[1] !== undefined) spec.ref = out.args[1];
  const k = out.next + 1;
  if (sweepWord(toks[k]) === undefined) return { spec, needsAcSweep: true };
  const s = readSweep(toks, k, ctx, false);
  spec.sweep = s.sweep;
  spec.points = s.points;
  spec.fstart = s.fstart;
  spec.fstop = s.fstop;
  return { spec };
}

// ---------------------------------------------------------------------------------------------
// .options
// ---------------------------------------------------------------------------------------------

type NumericOption = Exclude<keyof SimOptions, 'method'>;

const OPTION_KEYS: Readonly<Record<string, NumericOption>> = {
  temp: 'temp',
  tnom: 'tnom',
  gmin: 'gmin',
  reltol: 'reltol',
  abstol: 'abstol',
  vntol: 'vntol',
  chgtol: 'chgtol',
  trtol: 'trtol',
  itl1: 'itl1',
  itl2: 'itl2',
  itl4: 'itl4',
  maxord: 'maxord',
  gminsteps: 'gminSteps',
  srcsteps: 'srcSteps',
  itl6: 'srcSteps',
  rshunt: 'rshunt',
  seed: 'seed',
  defl: 'defl',
  defw: 'defw',
  defad: 'defad',
  defas: 'defas',
};

/** Parse a .options card into SimOptions fields; unknown options are listed in `ignored`. */
export function parseOptionsCard(toks: readonly Tok[], ctx: ControlContext): { options: Partial<SimOptions>; ignored: string[] } {
  const options: Partial<SimOptions> = {};
  const ignored: string[] = [];
  let k = 1;
  while (k < toks.length) {
    const t = toks[k];
    if (t.t !== 'word') {
      k++;
      continue;
    }
    const key = t.v.toLowerCase();
    if (!isAssign(toks, k)) {
      ignored.push(t.v);
      k++;
      continue;
    }
    const valTok = toks[k + 2];
    if (!isValueTok(valTok)) throw new CardError(`missing value for option '${t.v}'`);
    k += 3;
    if (key === 'method') {
      const m = valTok.v.toLowerCase();
      if (m === 'trap' || m === 'trapezoidal') options.method = 'trap';
      else if (m === 'gear') options.method = 'gear';
      else if (m === 'euler' || m === 'be') {
        options.method = 'gear';
        options.maxord = 1;
        ctx.warn(`method=${valTok.v} mapped to Gear order 1 (backward Euler)`);
      } else throw new CardError(`unknown integration method '${valTok.v}'`);
      continue;
    }
    const field = Object.hasOwn(OPTION_KEYS, key) ? OPTION_KEYS[key] : undefined;
    if (!field) {
      ignored.push(t.v);
      continue;
    }
    options[field] = ctx.num(valTok);
  }
  return { options, ignored };
}

// ---------------------------------------------------------------------------------------------
// .ic / .nodeset, .temp, .step
// ---------------------------------------------------------------------------------------------

/** Parse "V(node)=value ..." pairs of .ic / .nodeset. */
export function parseNodeValues(toks: readonly Tok[], ctx: ControlContext, card: string): Record<string, number> {
  const out: Record<string, number> = {};
  let k = 1;
  while (k < toks.length) {
    if (toks[k].t === ',') {
      k++;
      continue;
    }
    const call = readCall(toks, k);
    if (!call) throw new CardError(`${card}: expected V(node)=value, found '${toks[k].v}'`);
    const fn = call.fn.toLowerCase();
    if (toks[call.next]?.t !== '=' || !isValueTok(toks[call.next + 1])) {
      throw new CardError(`${card}: expected '=' and a value after ${call.fn}(${call.args.join(',')})`);
    }
    const value = ctx.num(toks[call.next + 1]);
    k = call.next + 2;
    if (fn !== 'v' || call.args.length !== 1) {
      ctx.warn(`${card}: ${call.fn}(${call.args.join(',')}) ignored (only node voltages V(node) are supported)`);
      continue;
    }
    out[call.args[0]] = value;
  }
  return out;
}

/** Values of a .temp card. */
export function parseTempCard(toks: readonly Tok[], ctx: ControlContext): number[] {
  const temps: number[] = [];
  for (let k = 1; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === ',') continue;
    if (!isValueTok(t)) throw new CardError(`unexpected '${t.v}'`);
    temps.push(ctx.num(t));
  }
  if (temps.length === 0) throw new CardError('.temp needs at least one temperature');
  return temps;
}

/** What a .step card sweeps. */
export type StepTarget =
  | { kind: 'temp' }
  | { kind: 'element'; target: string; param: string }
  | { kind: 'model'; target: string; param: string }
  /** a global .param (".step param name ...") */
  | { kind: 'param'; target: string };

export interface StepSpec {
  target: StepTarget;
  values: number[];
}

/** Values of a lin / dec / oct sweep (inclusive of stop within rounding). */
export function sweepValues(kind: 'lin' | 'dec' | 'oct', start: number, stop: number, step: number): number[] {
  const out: number[] = [];
  if (kind === 'lin') {
    if (step === 0) return [start];
    const n = Math.floor((stop - start) / step + 1e-9);
    if (n < 0) throw new CardError('sweep step has the wrong sign');
    for (let i = 0; i <= n; i++) out.push(start + i * step);
    return out;
  }
  if (!(start > 0 && stop >= start)) throw new CardError('logarithmic sweeps need 0 < start <= stop');
  if (!(step >= 1)) throw new CardError('points per decade/octave must be at least 1');
  const ratio = Math.pow(kind === 'dec' ? 10 : 2, 1 / step);
  const n = Math.floor(Math.log(stop / start) / Math.log(ratio) + 1e-9);
  for (let i = 0; i <= n; i++) out.push(start * Math.pow(ratio, i));
  return out;
}

/**
 * Parse .step (LTspice / PSpice):
 *   .step [lin|dec|oct] TARGET start stop step   |   .step TARGET list v1 v2 ...
 *   TARGET = temp | param <name> | <element> | <modeltype> <model>(<param>)
 * The sweep keyword may also follow `param <name>` (".step param R list 1k 2k", LTspice
 * ".step param R 1k 10k 1k", PSpice ".step param R dec 1k 100k 5").
 */
export function parseStepCard(toks: readonly Tok[], ctx: ControlContext): StepSpec | undefined {
  let k = 1;
  let kind: 'lin' | 'dec' | 'oct' = 'lin';
  const sw = sweepWord(toks[k]);
  if (sw === 'lin' || sw === 'dec' || sw === 'oct') {
    kind = sw;
    k++;
  }
  const first = wordAt(toks, k, 'sweep target');
  let target: StepTarget;
  if (first.toLowerCase() === 'temp') {
    target = { kind: 'temp' };
    k++;
  } else if (first.toLowerCase() === 'param') {
    const name = wordAt(toks, k + 1, 'parameter name');
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new CardError(`.step param: invalid parameter name '${name}'`);
    target = { kind: 'param', target: name };
    k += 2;
    const after = sweepWord(toks[k]);
    if (after === 'lin' || after === 'dec' || after === 'oct') {
      kind = after;
      k++;
    }
  } else if (toks[k + 1]?.t === 'word' && toks[k + 2]?.t === '(') {
    const model = toks[k + 1].v;
    const param = wordAt(toks, k + 3, 'model parameter');
    if (toks[k + 4]?.t !== ')') throw new CardError(`expected ')' after ${model}(${param}`);
    target = { kind: 'model', target: model, param: param.toLowerCase() };
    k += 5;
  } else {
    target = { kind: 'element', target: first, param: 'value' };
    k++;
  }
  let values: number[];
  if (sweepWord(toks[k]) === 'list') {
    values = [];
    for (k++; k < toks.length; k++) {
      if (toks[k].t === ',') continue;
      values.push(numAt(toks, k, 'list value', ctx));
    }
    if (values.length === 0) throw new CardError('.step list needs values');
  } else {
    const start = numAt(toks, k, 'sweep start', ctx);
    const stop = numAt(toks, k + 1, 'sweep stop', ctx);
    const step = numAt(toks, k + 2, 'sweep increment', ctx);
    if (k + 3 < toks.length) throw new CardError(`unexpected '${toks[k + 3].v}'`);
    values = sweepValues(kind, start, stop, step);
  }
  return { target, values };
}
