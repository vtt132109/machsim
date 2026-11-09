/**
 * SPICE netlist writer: Netlist IR -> text.
 *
 *   writeSpice(netlist, { lineWidth? }) -> string
 *
 * The output is SPICE3/ngspice syntax that parseSpice() reads back to an equal IR (round trip;
 * ElementIR.line is not preserved). Numbers use the short engineering form of toSpiceNumber
 * (1.5k, 1meg, 10n) whenever that reads back exactly, else the shortest exact decimal form.
 * With `digits` (reports for people) numbers are first rounded to that many significant digits
 * (is=7.128405745229947e-18 -> is=7.12841e-18); the IR and the simulation are unaffected.
 * Unevaluated expressions (stringParams, .param strings, subcircuit PARAMS:) are written in
 * {braces}. Long cards are folded with "+" continuation lines.
 *
 * Analyses that have no SPICE card (acsingle, noisefig, paramsweep, tempsweep, montecarlo,
 * worstcase, nestedsweep, tracewidth, batch), or whose fields a card cannot carry exactly, are
 * written as "*@machsim analysis {json}" pragma lines: plain comments for other simulators,
 * read back verbatim by parseSpice.
 *
 * Layout: title, .global, .param, .func, .model, .subckt blocks, elements, .options, .temp, .ic,
 * .nodeset, .save, analyses, .meas, .end. LAPLACE and FREQ elements are written as such (FREQ
 * with MAG DEG tables); CHEBYSHEV cards were expanded by the reader into LAPLACE stages and are
 * written as those stages.
 */

import type { AnalysisSpec, ElementIR, ModelCard, Netlist, SimOptions, SubcktDef } from '../netlist';
import { distofKey, tranArgKey } from './irfields';
import { formatTransform } from './laplace';
import { formatMeasCard } from './measure';
import { IC_KEYS } from './elements';
import { PRAGMA_PREFIX, isNumberWord, parseNumberWord } from './lexer';
import { formatSpiceNumber } from './numbers';
import { GLOBAL_NODES_KEY, isFuncKey, parseFuncKey } from './params';

export interface WriteSpiceOptions {
  /** Fold cards longer than this with "+" continuation lines (default 100; 0 disables folding). */
  lineWidth?: number;
  /**
   * Significant digits for a human-readable listing (e.g. 6). Default: exact numbers, so that
   * parseSpice reads the text back bit-for-bit (use the default for files).
   */
  digits?: number;
}

/** Write a netlist as SPICE text (see module header). */
export function writeSpice(netlist: Netlist, opts: WriteSpiceOptions = {}): string {
  const previous = displayDigits;
  displayDigits = opts.digits !== undefined && opts.digits >= 1 ? Math.min(17, Math.round(opts.digits)) : undefined;
  try {
    return writeSpiceText(netlist, opts);
  } finally {
    displayDigits = previous;
  }
}

function writeSpiceText(netlist: Netlist, opts: WriteSpiceOptions): string {
  const width = opts.lineWidth ?? 100;
  const out: string[] = [];
  const card = (text: string) => out.push(...fold(text, width));

  out.push(netlist.title.replace(/[\r\n]+/g, ' '));

  const globals = netlist.params[GLOBAL_NODES_KEY];
  if (typeof globals === 'string' && globals.trim() !== '') card(`.global ${globals.trim()}`);
  for (const [key, value] of Object.entries(netlist.params)) {
    if (key.startsWith('.') || isFuncKey(key)) continue;
    card(`.param ${key}=${typeof value === 'number' ? num(value) : `{${value}}`}`);
  }
  writeFunctions(netlist.params, card);
  for (const m of Object.values(netlist.models)) card(modelCard(m));
  for (const s of Object.values(netlist.subckts)) writeSubckt(s, card);
  for (const el of netlist.elements) card(elementCard(el));

  writeOptions(netlist.options, card);
  if (Object.keys(netlist.ic).length > 0) card(`.ic ${nodeValues(netlist.ic)}`);
  if (Object.keys(netlist.nodeset).length > 0) card(`.nodeset ${nodeValues(netlist.nodeset)}`);
  if (netlist.saves.length > 0) card(`.save ${netlist.saves.join(' ')}`);
  for (const a of netlist.analyses) out.push(...fold(analysisCard(a), width));
  for (const m of netlist.measures ?? []) card(formatMeasCard(m, num));
  out.push('.end');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

/** Significant digits of the listing being written (undefined = exact); set by writeSpice. */
let displayDigits: number | undefined;

/** Number text: exact by default, rounded to `displayDigits` significant digits for listings. */
function num(value: number): string {
  if (displayDigits === undefined || !Number.isFinite(value) || value === 0) return formatSpiceNumber(value);
  return formatSpiceNumber(Number(value.toPrecision(displayDigits)));
}

function braced(expr: string): string {
  return `{${expr}}`;
}

/** A literal string for a .model parameter: bare when it reads back as the same word. */
function literal(text: string): string {
  if (/^[A-Za-z0-9_][A-Za-z0-9_.$+-]*$/.test(text) && parseNumberWord(text, false) === undefined) return text;
  return `"${text.replace(/"/g, "'")}"`;
}

/** Text of an override / subcircuit default: bare SPICE number when possible, else {expr}. */
function exprOrNumber(text: string): string {
  const t = text.trim();
  return /^\S+$/.test(t) && isNumberWord(t) ? t : braced(t);
}

function nodeValues(values: Record<string, number>): string {
  return Object.entries(values)
    .map(([node, v]) => `V(${node})=${num(v)}`)
    .join(' ');
}

/** Split a card into physical lines at spaces outside braces and quotes. */
function fold(text: string, width: number): string[] {
  if (width <= 0 || text.length <= width || text.startsWith(PRAGMA_PREFIX)) return [text];
  const words: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === ' ' && depth === 0) {
      if (i > start) words.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (start < text.length) words.push(text.slice(start));
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if (line !== '' && line.length + 1 + w.length > width) {
      lines.push(line);
      line = `+ ${w}`;
    } else line = line === '' ? w : `${line} ${w}`;
  }
  if (line !== '') lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Parameters, functions, models, subcircuits
// ---------------------------------------------------------------------------------------------

function writeFunctions(table: Record<string, number | string>, card: (text: string) => void): void {
  for (const [key, body] of Object.entries(table)) {
    if (!isFuncKey(key)) continue;
    const sig = parseFuncKey(key);
    if (!sig) continue;
    card(`.func ${sig.name}(${sig.args.join(',')}) {${String(body)}}`);
  }
}

function modelCard(m: ModelCard): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(m.params)) parts.push(`${k}=${num(v)}`);
  for (const [k, v] of Object.entries(m.stringParams ?? {})) {
    const t = v.trim();
    parts.push(`${k}=${t.startsWith('{') || t.startsWith('[') ? t : literal(v)}`);
  }
  return parts.length > 0 ? `.model ${m.name} ${m.type}(${parts.join(' ')})` : `.model ${m.name} ${m.type}`;
}

function writeSubckt(s: SubcktDef, card: (text: string) => void): void {
  const params = Object.entries(s.params)
    .filter(([k]) => !isFuncKey(k) && !k.startsWith('.'))
    .map(([k, v]) => `${k}=${exprOrNumber(v)}`);
  card(`.subckt ${[s.name, ...s.ports].join(' ')}${params.length > 0 ? ` params: ${params.join(' ')}` : ''}`);
  writeFunctions(s.params, card);
  for (const m of Object.values(s.models)) card(modelCard(m));
  for (const inner of Object.values(s.subckts)) writeSubckt(inner, card);
  for (const el of s.elements) card(elementCard(el));
  card(`.ends ${s.name}`);
}

// ---------------------------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------------------------

/** Keys written by an element's own syntax (never as generic key=value). */
const SOURCE_STRING_KEYS = /^(dc|acmag|acphase|tran\[\d+\]|tran\.r|tran\.td|distof[12]\[[01]\])$/;

function valueText(el: ElementIR): string | undefined {
  if (el.value !== undefined) return num(el.value);
  const e = el.stringParams?.value;
  return e !== undefined ? braced(e) : undefined;
}

/** key=value pairs for el.params / el.stringParams, minus `skip`; ic lists are re-combined. */
function namedParams(el: ElementIR, skip: ReadonlySet<string> = new Set()): string[] {
  const parts: string[] = [];
  const used = new Set(skip);
  const sp = el.stringParams ?? {};
  const icKeys = IC_KEYS[el.type];
  if (icKeys && icKeys.length > 1) {
    const vals = icKeys.map((k) => (el.params[k] !== undefined ? num(el.params[k]) : sp[k] !== undefined ? braced(sp[k]) : undefined));
    if (vals.every((v) => v !== undefined)) {
      parts.push(`ic=${vals.join(',')}`);
      for (const k of icKeys) used.add(k);
    }
  }
  for (const [k, v] of Object.entries(el.params)) if (!used.has(k)) parts.push(`${k}=${num(v)}`);
  for (const [k, v] of Object.entries(sp)) if (!used.has(k) && k !== 'value' && k !== 'ports') parts.push(`${k}=${braced(v)}`);
  return parts;
}

/** Bare flags (off / on) for params equal to 1, removed from the named list. */
function flags(el: ElementIR, names: readonly string[]): { words: string[]; skip: Set<string> } {
  const words: string[] = [];
  const skip = new Set<string>();
  for (const f of names) {
    if (el.params[f] === 1) {
      words.push(f);
      skip.add(f);
    }
  }
  return { words, skip };
}

function join(...parts: (string | undefined | string[])[]): string {
  const flat: string[] = [];
  for (const p of parts) {
    if (p === undefined) continue;
    if (Array.isArray(p)) flat.push(...p);
    else if (p !== '') flat.push(p);
  }
  return flat.join(' ');
}

function elementCard(el: ElementIR): string {
  const nodes = el.nodes.join(' ');
  switch (el.type) {
    case 'R':
    case 'C':
    case 'L':
      return join(el.name, nodes, valueText(el), el.model, namedParams(el));
    case 'K':
      return join(el.name, (el.inductors ?? []).join(' '), valueText(el), namedParams(el));
    case 'V':
    case 'I':
      return sourceCard(el);
    case 'E':
    case 'G':
      if (el.laplace) {
        const gain = el.value ?? 1;
        const input = `V(${el.nodes[2]},${el.nodes[3]})`;
        return join(el.name, el.nodes.slice(0, 2), 'LAPLACE', `{${gain === 1 ? input : `${num(gain)}*${input}`}}`, '=', `{${formatTransform(el.laplace.num, el.laplace.den)}}`);
      }
      if (el.freqTable) {
        const gain = el.value ?? 1;
        const input = `V(${el.nodes[2]},${el.nodes[3]})`;
        const t = el.freqTable;
        const rows = t.f.map((f, i) => `(${num(f)}, ${num(t.mag[i])}, ${num(t.phase[i])})`);
        return join(el.name, el.nodes.slice(0, 2), 'FREQ', `{${gain === 1 ? input : `${num(gain)}*${input}`}}`, 'MAG', 'DEG', '=', rows, t.delay ? `DELAY=${num(t.delay)}` : undefined);
      }
      return join(el.name, nodes, valueText(el), namedParams(el));
    case 'F':
    case 'H':
      return join(el.name, nodes, el.control, valueText(el), namedParams(el));
    case 'B': {
      const m = /^\s*([^=]*)=([\s\S]*)$/.exec(el.expr ?? '');
      const kind = (m?.[1].trim() || 'V').toUpperCase();
      return join(el.name, nodes, `${kind}=${braced((m?.[2] ?? el.expr ?? '').trim())}`, namedParams(el));
    }
    case 'D':
    case 'Q':
    case 'J':
    case 'Z':
    case 'M': {
      const f = flags(el, ['off']);
      return join(el.name, nodes, el.model, f.words, namedParams(el, f.skip));
    }
    case 'S':
    case 'W': {
      const f = flags(el, ['on', 'off']);
      return join(el.name, nodes, el.type === 'W' ? el.control : undefined, el.model, f.words, namedParams(el, f.skip));
    }
    case 'T':
    case 'O':
      return join(el.name, nodes, el.model, namedParams(el));
    case 'X': {
      const overrides: string[] = [];
      for (const [k, v] of Object.entries(el.params)) overrides.push(`${k}=${num(v)}`);
      for (const [k, v] of Object.entries(el.stringParams ?? {})) overrides.push(`${k}=${exprOrNumber(v)}`);
      return join(el.name, nodes, el.model, overrides.length > 0 ? ['params:', ...overrides] : undefined);
    }
    case 'A':
      return join(el.name, codeModelPorts(el), el.model, namedParams(el));
  }
}

function codeModelPorts(el: ElementIR): string {
  const template = el.stringParams?.ports;
  if (template === undefined) return el.nodes.join(' ');
  const slots = template.split(/\s+/).filter((t) => t !== '');
  if (slots.filter((t) => t === '#' || t === '~#').length !== el.nodes.length) return el.nodes.join(' ');
  let k = 0;
  return slots.map((t) => (t === '#' ? el.nodes[k++] : t === '~#' ? `~${el.nodes[k++]}` : t)).join(' ');
}

function sourceCard(el: ElementIR): string {
  const src = el.source ?? {};
  const sp = el.stringParams ?? {};
  const parts: string[] = [el.name, ...el.nodes];
  if (sp.dc !== undefined) parts.push('DC', braced(sp.dc));
  else if (src.dc !== undefined) parts.push('DC', num(src.dc));
  else if (el.value !== undefined) parts.push('DC', num(el.value));
  const mag = sp.acmag !== undefined ? braced(sp.acmag) : src.acMag !== undefined ? num(src.acMag) : undefined;
  const phase = sp.acphase !== undefined ? braced(sp.acphase) : src.acPhase !== undefined ? num(src.acPhase) : undefined;
  if (mag !== undefined) {
    parts.push('AC', mag);
    if (phase !== undefined) parts.push(phase);
  } else if (phase !== undefined) parts.push(`acphase=${phase}`);
  for (const which of [1, 2] as const) {
    const pair = which === 1 ? src.distof1 : src.distof2;
    if (!pair) continue;
    const text = ([0, 1] as const).map((i) => {
      const e = sp[distofKey(which, i)];
      return e !== undefined ? braced(e) : num(pair[i]);
    });
    parts.push(`DISTOF${which}`, ...text);
  }
  const tran = src.tran;
  if (tran) {
    const args = tran.args.map((v, i) => {
      const e = sp[tranArgKey(i)];
      return e !== undefined ? braced(e) : num(v);
    });
    parts.push(`${tran.type}(${args.join(' ')})`);
    if (tran.type === 'PWL') {
      if (sp['tran.r'] !== undefined) parts.push(`r=${braced(sp['tran.r'])}`);
      else if (tran.repeatFrom !== undefined) parts.push(`r=${num(tran.repeatFrom)}`);
      if (sp['tran.td'] !== undefined) parts.push(`td=${braced(sp['tran.td'])}`);
    }
  }
  for (const [k, v] of Object.entries(el.params)) parts.push(`${k}=${num(v)}`);
  for (const [k, v] of Object.entries(sp)) if (!SOURCE_STRING_KEYS.test(k)) parts.push(`${k}=${braced(v)}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------------------------
// Options and analyses
// ---------------------------------------------------------------------------------------------

const OPTION_NAMES: Readonly<Record<Exclude<keyof SimOptions, 'temp' | 'method'>, string>> = {
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
  gminSteps: 'gminsteps',
  srcSteps: 'srcsteps',
  rshunt: 'rshunt',
  seed: 'seed',
  defl: 'defl',
  defw: 'defw',
  defad: 'defad',
  defas: 'defas',
};

function writeOptions(options: Partial<SimOptions>, card: (text: string) => void): void {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(options) as [keyof SimOptions, SimOptions[keyof SimOptions] | undefined][]) {
    if (value === undefined || field === 'temp') continue;
    if (field === 'method') parts.push(`method=${String(value)}`);
    else parts.push(`${OPTION_NAMES[field]}=${num(value as number)}`);
  }
  if (parts.length > 0) card(`.options ${parts.join(' ')}`);
  if (options.temp !== undefined) card(`.temp ${num(options.temp)}`);
}

function pragma(spec: AnalysisSpec): string {
  return `${PRAGMA_PREFIX} analysis ${JSON.stringify(spec)}`;
}

function sweepText(s: { sweep: string; points: number; fstart: number; fstop: number }): string {
  return `${s.sweep} ${num(s.points)} ${num(s.fstart)} ${num(s.fstop)}`;
}

/** The SPICE card for an analysis, or a pragma line when no card represents it exactly. */
function analysisCard(a: AnalysisSpec): string {
  switch (a.type) {
    case 'op':
      return '.op';
    case 'dc': {
      const sweep = (s: { src: string; start: number; stop: number; step: number }) =>
        `${s.src} ${num(s.start)} ${num(s.stop)} ${num(s.step)}`;
      return `.dc ${sweep(a)}${a.src2 ? ` ${sweep(a.src2)}` : ''}`;
    }
    case 'ac': {
      if (a.sweep === 'list') {
        const l = a.list ?? [];
        if (l.length > 0 && a.points === l.length && a.fstart === l[0] && a.fstop === l[l.length - 1]) {
          return `.ac list ${l.map(num).join(' ')}`;
        }
        return pragma(a);
      }
      return a.list === undefined ? `.ac ${sweepText(a)}` : pragma(a);
    }
    case 'tran': {
      if ((a.tstart === undefined && a.tmax !== undefined) || a.uic === false) return pragma(a);
      const parts = ['.tran', num(a.tstep), num(a.tstop)];
      if (a.tstart !== undefined) parts.push(num(a.tstart));
      if (a.tmax !== undefined) parts.push(num(a.tmax));
      if (a.uic) parts.push('uic');
      return parts.join(' ');
    }
    case 'noise': {
      if (a.sweep === 'list') return pragma(a);
      const out = a.ref !== undefined ? `V(${a.output},${a.ref})` : `V(${a.output})`;
      return `.noise ${out} ${a.src} ${sweepText(a)}`;
    }
    case 'tf':
      return `.tf ${a.output} ${a.src}`;
    case 'sens':
      if (a.ac?.sweep === 'list') return pragma(a);
      return a.ac ? `.sens ${a.output} ac ${sweepText(a.ac)}` : `.sens ${a.output}`;
    case 'pz':
      return `.pz ${a.inPos} ${a.inNeg} ${a.outPos} ${a.outNeg} ${a.transfer} ${a.find}`;
    case 'four':
      if (a.settleCycles !== undefined || a.tstep !== undefined || a.samples !== undefined || a.outputs.length === 0) return pragma(a);
      return `.four ${num(a.fundamental)} ${num(a.harmonics)} ${a.outputs.join(' ')}`;
    case 'disto':
      if (a.sweep === 'list') return pragma(a);
      return `.disto ${sweepText(a)}${a.f2overf1 !== undefined ? ` ${num(a.f2overf1)}` : ''}`;
    default:
      return pragma(a);
  }
}
