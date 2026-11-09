/**
 * Element-card parsing for the SPICE reader (parser.ts): one tokenised card -> one ElementIR.
 *
 * Supported syntax (case-insensitive keywords; values are SPICE numbers, {expr}, 'expr' or bare
 * parameter names; see irfields.ts for where unevaluated expressions are stored):
 *   Rxx n+ n- [model] value [r=..] [tc=tc1[,tc2]] [tc1=..] [tc2=..] [m=..] [temp=..] [k=v ...]
 *   Cxx / Lxx n+ n- [model] value [ic=..] [m=..] [Rser= Lser= Rpar= Cpar=] [k=v ...]   (c= / l= also give the value)
 *   Kxx L1 L2 [L3 ...] k
 *   Vxx / Ixx n+ n- [[DC] v] [AC [mag [phase]]] [DISTOF1 [mag [phase]]] [DISTOF2 ..]
 *          [SIN|PULSE|PWL|EXP|SFFM|AM (args) [r=..] [td=..]] [Rser= Cpar= (V only)] [k=v ...]
 *   Unknown k=v instance parameters are kept in ElementIR.params and reported through ctx.warn
 *   (KNOWN_INSTANCE_PARAMS); the parasitics become explicit elements (splitParasitics).
 *   Exx n+ n- nc+ nc- gain | Gxx n+ n- nc+ nc- gm
 *   Fxx n+ n- Vctl gain    | Hxx n+ n- Vctl rm
 *   E/G/F/H ... POLY(n) controls coefficients  -> native linear element when it is a plain gain,
 *                                                 otherwise a B source with the polynomial
 *   E/G ... VALUE={expr} | VOL='expr' | CUR='expr'  -> B source (V= for E, I= for G)
 *   E/G ... TABLE {expr} = (x1,y1) (x2,y2) ...     -> B source using table()
 *   E/G ... LAPLACE {V(a,b)} = {N(s)/D(s)}          -> ElementIR.laplace (laplace.ts)
 *   E/G ... FREQ {V(a,b)} [MAG|DB DEG|RAD R_I] = (f,m,p)... [DELAY=t] -> ElementIR.freqTable
 *   E/G ... CHEBYSHEV {V(a,b)} = LP|HP|BP|BR freqs ripple atten -> cascade of LAPLACE stages
 *   V / C / L ... Rser= Lser= Rpar= Cpar= (LTspice parasitics) -> explicit R / L / C elements
 *                                                    (splitParasitics)
 *   Bxx n+ n- V=expr | I=expr | R=expr             (R= becomes I=V(n+,n-)/(expr))
 *   Dxx a k model [area] [off] [ic=vd] [k=v ...]
 *   Qxx c b e [s] model [area] [off] [ic=vbe,vce] [k=v ...]
 *   Jxx / Zxx d g s model [area] [off] [ic=vds,vgs]
 *   Mxx d g s [b] model [l= w= ad= as= pd= ps= nrd= nrs= m=] [off] [ic=vds,vgs,vbs]
 *   Sxx n+ n- nc+ nc- model [on|off] | Wxx n+ n- Vctl model [on|off]
 *   Txx p1+ p1- p2+ p2- z0=.. (td=.. | f=.. [nl=..]) [ic=v1,i1,v2,i2]
 *   Oxx p1+ p1- p2+ p2- model
 *   Xxx n1 .. nN subckt [PARAMS:] [name=value ...]   (overrides kept as text in stringParams)
 *   Axx <XSPICE port list> model   (brackets/%modifiers kept as a template in stringParams.ports)
 *
 * Behavioral conversions name the new B element "B" + original name (e.g. E1 -> BE1) so that the
 * IR rule "first letter of the name = element type" holds.
 */

import type { ElementIR, ElementType, SourceSpec, WaveformType } from '../netlist';
import { formatExprNumber, parseExpression, stripExpressionDelimiters } from './expr';
import { distofKey, tranArgKey } from './irfields';
import { laplaceInput, rationalTransform } from './laplace';
import { designChebyshev } from './chebyshev';
import { CardError, parseNumberWord, tokenValue, type Tok, type ValueText } from './lexer';

/** Services the element parser needs from the reader. */
export interface ElementContext {
  /** Source line of the card (stored in ElementIR.line). */
  readonly line: number;
  /** True when `name` is a model defined anywhere in the input (case-insensitive). */
  isModel(name: string): boolean;
  warn(message: string): void;
  /**
   * Emit an extra element the card expands to, placed before the card's own element (the stages
   * of a CHEBYSHEV filter). Readers without it reject such cards.
   */
  addElement?(el: ElementIR): void;
}

// ---------------------------------------------------------------------------------------------
// Token helpers (also used by the control-card parsers)
// ---------------------------------------------------------------------------------------------

/** A token that can carry a value: word, {brace}, 'quote' or "string". */
export type ValueTok = Tok & { t: 'word' | 'brace' | 'quote' | 'string' };
/** A bare word token. */
export type WordTok = Tok & { t: 'word' };

export function isValueTok(t: Tok | undefined): t is ValueTok {
  return t !== undefined && (t.t === 'word' || t.t === 'brace' || t.t === 'quote' || t.t === 'string');
}

const ASSIGN_KEY_RE = /^[A-Za-z_][A-Za-z0-9_./]*$/;

/**
 * `key =` (and not `key ==`) at index k, where key looks like a parameter name. The name check
 * keeps unbraced comparisons such as "x>=1" (tokens "x>", "=", "1") from reading as assignments.
 */
export function isAssign(toks: readonly Tok[], k: number): boolean {
  const t = toks[k];
  return t?.t === 'word' && toks[k + 1]?.t === '=' && toks[k + 2]?.t !== '=' && ASSIGN_KEY_RE.test(t.v);
}

/** Validate expression syntax; returns the text (CardError on bad syntax). */
export function checkExpr(text: string): string {
  try {
    parseExpression(text);
  } catch (e) {
    throw new CardError(`invalid expression '${text}': ${(e as Error).message}`);
  }
  return text;
}

/** Interpret a token as a value: number, or (syntax-checked) expression text. */
export function valueOf(t: Tok): ValueText {
  if (t.t === 'string') {
    if (t.v === '') throw new CardError('empty value');
    return { expr: checkExpr(t.v) };
  }
  const v = tokenValue(t);
  if (!v) throw new CardError(`expected a value but found '${t.v}'`);
  if (v.expr !== undefined) checkExpr(v.expr);
  return v;
}

/** True for a bare word that is not a number (candidate model / node / keyword). */
export function isNonNumericWord(t: Tok | undefined): t is WordTok {
  return t !== undefined && t.t === 'word' && parseNumberWord(t.v) === undefined;
}

export interface NamedArg {
  /** lower-case key */
  key: string;
  vals: Tok[];
  tok: Tok;
}

export interface SplitArgs {
  /** positional value tokens (punctuation dropped) */
  pos: Tok[];
  named: NamedArg[];
}

/**
 * Split tokens from `start` into positional values and `key=value[,value...]` / `key=(v v ...)`
 * assignments. Stray punctuation is skipped.
 */
export function splitArgs(toks: readonly Tok[], start: number): SplitArgs {
  const pos: Tok[] = [];
  const named: NamedArg[] = [];
  let k = start;
  while (k < toks.length) {
    const t = toks[k];
    if (isAssign(toks, k)) {
      const vals: Tok[] = [];
      k += 2;
      if (toks[k]?.t === '(') {
        let depth = 0;
        for (; k < toks.length; k++) {
          const u = toks[k];
          if (u.t === '(') depth++;
          else if (u.t === ')') {
            depth--;
            if (depth === 0) {
              k++;
              break;
            }
          } else if (isValueTok(u)) vals.push(u);
        }
      } else if (isValueTok(toks[k])) {
        vals.push(toks[k]);
        k++;
        while (toks[k]?.t === ',' && isValueTok(toks[k + 1]) && !isAssign(toks, k + 1)) {
          vals.push(toks[k + 1]);
          k += 2;
        }
      }
      named.push({ key: t.v.toLowerCase(), vals, tok: t });
      continue;
    }
    if (isValueTok(t)) pos.push(t);
    k++;
  }
  return { pos, named };
}

// ---------------------------------------------------------------------------------------------
// IR setters
// ---------------------------------------------------------------------------------------------

function setParam(el: ElementIR, key: string, v: ValueText): void {
  if (v.num !== undefined) {
    el.params[key] = v.num;
    if (el.stringParams) delete el.stringParams[key];
  } else {
    (el.stringParams ??= {})[key] = v.expr;
    delete el.params[key];
  }
}

function setValue(el: ElementIR, v: ValueText): void {
  if (v.num !== undefined) {
    el.value = v.num;
    if (el.stringParams) delete el.stringParams.value;
  } else {
    (el.stringParams ??= {}).value = v.expr;
    delete el.value;
  }
}

function hasValue(el: ElementIR): boolean {
  return el.value !== undefined || el.stringParams?.value !== undefined;
}

/** Instance-parameter names filled by a comma list `ic=a,b,...`. */
const IC_KEYS: Partial<Record<ElementType, string[]>> = {
  C: ['ic'],
  L: ['ic'],
  D: ['ic'],
  Q: ['ic_vbe', 'ic_vce'],
  J: ['ic_vds', 'ic_vgs'],
  Z: ['ic_vds', 'ic_vgs'],
  M: ['ic_vds', 'ic_vgs', 'ic_vbs'],
  T: ['ic_v1', 'ic_i1', 'ic_v2', 'ic_i2'],
};

/** Named parameters that give the element's primary value. */
const VALUE_KEYS: Partial<Record<ElementType, string[]>> = {
  R: ['r', 'resistance'],
  C: ['c', 'capacitance'],
  L: ['l', 'inductance'],
  K: ['k', 'coupling'],
  E: ['gain'],
  F: ['gain'],
  G: ['gain', 'transconductance'],
  H: ['gain', 'transresistance'],
};

export { IC_KEYS };

/**
 * Instance parameters the MachSim devices actually read, per element type (lower case, after the
 * parser's own renames: ic= lists, tc= -> tc1/tc2, value keys). Any other `name=value` on such an
 * element would be stored and silently ignored, so the reader warns about it (an LTspice
 * `Cpar=`, a typo such as `R1 a b 10 foo=3`). Types not listed (X, A, O) are not checked here:
 * subcircuit overrides and code-model parameters have their own rules.
 */
/** Instance parameters of the LTspice-style parasitics: `Rser=`, `Lser=`, `Rpar=`, `Cpar=`. */
const SERIES_R = 'rser';
const SERIES_L = 'lser';
const PARALLEL_R = 'rpar';
const PARALLEL_C = 'cpar';

/** Parasitics each element type accepts (LTspice: V Rser / Cpar; C all four; L Rser / Rpar / Cpar). */
const PARASITICS: Partial<Record<ElementType, readonly string[]>> = {
  V: [SERIES_R, PARALLEL_C],
  C: [SERIES_R, SERIES_L, PARALLEL_R, PARALLEL_C],
  L: [SERIES_R, PARALLEL_R, PARALLEL_C],
};

const SEMI_COMMON = ['area', 'm', 'off', 'temp', 'dtemp'];
const KNOWN_INSTANCE_PARAMS: Partial<Record<ElementType, ReadonlySet<string>>> = {
  R: new Set(['tc1', 'tc2', 'temp', 'm']),
  C: new Set(['ic', 'm', ...PARASITICS.C!]),
  L: new Set(['ic', 'm', ...PARASITICS.L!]),
  K: new Set(),
  V: new Set(PARASITICS.V),
  I: new Set(),
  E: new Set(),
  F: new Set(),
  G: new Set(),
  H: new Set(),
  B: new Set(),
  D: new Set([...SEMI_COMMON, 'ic']),
  Q: new Set([...SEMI_COMMON, 'ic_vbe', 'ic_vce', 'icvbe', 'icvce']),
  J: new Set([...SEMI_COMMON, 'ic_vds', 'ic_vgs', 'icvds', 'icvgs']),
  Z: new Set([...SEMI_COMMON, 'ic_vds', 'ic_vgs', 'icvds', 'icvgs']),
  M: new Set(['w', 'l', 'ad', 'as', 'pd', 'ps', 'nrd', 'nrs', 'm', 'off', 'temp', 'dtemp', 'delvto', 'ic_vds', 'ic_vgs', 'ic_vbs', 'icvds', 'icvgs', 'icvbs']),
  S: new Set(['vt', 'vh', 'von', 'voff', 'ron', 'roff', 'on', 'off', 'state']),
  W: new Set(['it', 'ih', 'ion', 'ioff', 'ron', 'roff', 'on', 'off', 'state']),
  T: new Set(['z0', 'zo', 'td', 'f', 'freq', 'nl', 'rel', 'abs', 'ic_v1', 'ic_i1', 'ic_v2', 'ic_i2']),
};

/** Warn when `key` is an instance parameter the element's device does not use. */
function checkInstanceParam(el: ElementIR, key: string, spelled: string, ctx: ElementContext | undefined): void {
  const known = KNOWN_INSTANCE_PARAMS[el.type];
  if (!ctx || !known || known.has(key)) return;
  ctx.warn(`${el.name}: instance parameter '${spelled}' is not supported by MachSim and is ignored (the circuit simulates without it)`);
}

function applyNamed(el: ElementIR, named: readonly NamedArg[], ctx?: ElementContext): void {
  for (const n of named) {
    if (n.vals.length === 0) throw new CardError(`missing value for '${n.key}'`);
    const icKeys = IC_KEYS[el.type];
    if (n.key === 'ic' && icKeys) {
      if (n.vals.length > icKeys.length) {
        throw new CardError(`ic= takes at most ${icKeys.length} value(s) for a ${el.type} element`);
      }
      n.vals.forEach((t, j) => setParam(el, icKeys[j], valueOf(t)));
      continue;
    }
    if (n.key === 'tc') {
      if (n.vals.length > 2) throw new CardError('tc= takes at most 2 values (tc1, tc2)');
      setParam(el, 'tc1', valueOf(n.vals[0]));
      if (n.vals[1]) setParam(el, 'tc2', valueOf(n.vals[1]));
      checkInstanceParam(el, 'tc1', n.tok.v, ctx);
      continue;
    }
    if (n.vals.length !== 1) throw new CardError(`'${n.key}' takes a single value`);
    if (VALUE_KEYS[el.type]?.includes(n.key)) setValue(el, valueOf(n.vals[0]));
    else {
      setParam(el, n.key, valueOf(n.vals[0]));
      checkInstanceParam(el, n.key, n.tok.v, ctx);
    }
  }
}

/** Remove a parasitic parameter from `el`: its numeric value or expression, undefined when absent / 0. */
function takeParasitic(el: ElementIR, key: string): { num?: number; expr?: string } | undefined {
  const num = el.params[key];
  const expr = el.stringParams?.[key];
  if (num === undefined && expr === undefined) return undefined;
  delete el.params[key];
  if (el.stringParams) {
    delete el.stringParams[key];
    if (Object.keys(el.stringParams).length === 0) delete el.stringParams;
  }
  if (expr === undefined && num === 0) return undefined;
  return expr !== undefined ? { expr } : { num };
}

function parasiticElement(type: 'R' | 'L' | 'C', name: string, nodes: string[], v: { num?: number; expr?: string }, line: number | undefined): ElementIR {
  const e: ElementIR = { type, name, nodes, params: {}, ...(line !== undefined ? { line } : {}) };
  if (v.expr !== undefined) e.stringParams = { value: v.expr };
  else e.value = v.num;
  return e;
}

/**
 * LTspice parasitics on V, C and L elements made explicit (MachSim's reading of the LTspice
 * equivalent circuits):
 *   V   n+ —Rser— [source] — n-,                       Cpar across n+ / n-
 *   C   n+ —Rser—Lser— [C ∥ Rpar] — n-,                Cpar across n+ / n-
 *   L   n+ —Rser— [L ∥ Rpar] — n-,                     Cpar across n+ / n-
 * The element moves to the internal node after its series parts ("<name>_rser", then
 * "<name>_lser"), so I(V1) / I(L1) stay the current through the element itself and V(n+) the
 * terminal voltage. New elements: "R<name>_rser", "L<name>_lser", "R<name>_rpar", "C<name>_cpar"
 * (values or expressions copied). A parasitic of 0 is dropped. Returns the extra elements
 * (empty when there are none); `el` is updated in place.
 */
export function splitParasitics(el: ElementIR): ElementIR[] {
  const keys = PARASITICS[el.type];
  if (!keys) return [];
  const take = (k: string) => (keys.includes(k) ? takeParasitic(el, k) : undefined);
  const rser = take(SERIES_R);
  const lser = take(SERIES_L);
  const rpar = take(PARALLEL_R);
  const cpar = take(PARALLEL_C);
  const out: ElementIR[] = [];
  const [np, nn] = [el.nodes[0], el.nodes[1]];
  let at = np;
  if (rser) {
    const inner = `${el.name}_rser`;
    out.push(parasiticElement('R', `R${el.name}_rser`, [at, inner], rser, el.line));
    at = inner;
  }
  if (lser) {
    const inner = `${el.name}_lser`;
    out.push(parasiticElement('L', `L${el.name}_lser`, [at, inner], lser, el.line));
    at = inner;
  }
  el.nodes = [at, ...el.nodes.slice(1)];
  if (rpar) out.push(parasiticElement('R', `R${el.name}_rpar`, [at, nn], rpar, el.line));
  if (cpar) out.push(parasiticElement('C', `C${el.name}_cpar`, [np, nn], cpar, el.line));
  return out;
}

/** LTspice `Rser=` only (kept for callers of the older API): the series resistor, or null. */
export function splitSeriesResistance(el: ElementIR): ElementIR | null {
  if (el.type !== 'V' && el.type !== 'C' && el.type !== 'L') return null;
  const v = takeParasitic(el, SERIES_R);
  if (!v) return null;
  const inner = `${el.name}_rser`;
  const r = parasiticElement('R', `R${el.name}_rser`, [el.nodes[0], inner], v, el.line);
  el.nodes = [inner, ...el.nodes.slice(1)];
  return r;
}

function nodeName(t: Tok | undefined, what: string): string {
  if (!t) throw new CardError(`missing ${what}`);
  if (t.t !== 'word') throw new CardError(`invalid ${what} '${t.v}'`);
  return t.v;
}

function newElement(type: ElementType, name: string, nodes: string[], ctx: ElementContext): ElementIR {
  return { type, name, nodes, params: {}, line: ctx.line };
}

function flagParam(el: ElementIR, t: Tok, allowed: readonly string[]): boolean {
  if (t.t !== 'word') return false;
  const w = t.v.toLowerCase();
  if (!allowed.includes(w)) return false;
  el.params[w] = 1;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Element parsers
// ---------------------------------------------------------------------------------------------

/** Parse one element card. `text` is the card text the tokens were produced from. */
export function parseElementCard(toks: readonly Tok[], text: string, ctx: ElementContext): ElementIR {
  const nameTok = toks[0];
  if (!nameTok || nameTok.t !== 'word') throw new CardError('expected an element name');
  const name = nameTok.v;
  const letter = name[0].toUpperCase();
  switch (letter) {
    case 'R':
    case 'C':
    case 'L':
      return parseTwoTerminal(letter, name, toks, ctx);
    case 'K':
      return parseCoupling(name, toks, ctx);
    case 'V':
    case 'I':
      return parseSource(letter, name, toks, ctx);
    case 'E':
    case 'G':
      return parseVoltageControlled(letter, name, toks, text, ctx);
    case 'F':
    case 'H':
      return parseCurrentControlled(letter, name, toks, text, ctx);
    case 'B':
      return parseBehavioral(name, toks, text, ctx);
    case 'D':
      return parseSemi('D', name, toks, ctx, 2);
    case 'Q':
      return parseBjt(name, toks, ctx);
    case 'J':
    case 'Z':
      return parseSemi(letter, name, toks, ctx, 3);
    case 'M':
      return parseMosfet(name, toks, ctx);
    case 'S':
    case 'W':
      return parseSwitch(letter, name, toks, ctx);
    case 'T':
      return parseTline(name, toks, ctx);
    case 'O':
      return parseLossyLine(name, toks, ctx);
    case 'X':
      return parseInstance(name, toks, ctx);
    case 'A':
      return parseCodeModel(name, toks, ctx);
    default:
      throw new CardError(`unsupported element type '${letter}' (${name})`);
  }
}

function parseTwoTerminal(type: 'R' | 'C' | 'L', name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  const el = newElement(type, name, [nodeName(pos[0], 'node n+'), nodeName(pos[1], 'node n-')], ctx);
  const rest = pos.slice(2);
  if (rest.length > 2) throw new CardError(`unexpected '${rest[2].v}'`);
  const known = (t: Tok) => t.t === 'word' && ctx.isModel(t.v);
  if (rest.length === 1) {
    const t = rest[0];
    if (known(t)) el.model = t.v;
    else setValue(el, valueOf(t));
  } else if (rest.length === 2) {
    const [a, b] = rest;
    const aModel = known(a) || isNonNumericWord(a);
    const bModel = known(b) || isNonNumericWord(b);
    if (aModel && (!bModel || (known(a) && !known(b)))) {
      el.model = a.v;
      setValue(el, valueOf(b));
    } else if (bModel) {
      setValue(el, valueOf(a));
      el.model = b.v;
    } else {
      throw new CardError(`unexpected '${b.v}' (only one value allowed)`);
    }
  }
  applyNamed(el, named, ctx);
  if (!hasValue(el) && !el.model) throw new CardError(`${name}: missing value`);
  return el;
}

function parseCoupling(name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  const el = newElement('K', name, [], ctx);
  let names = pos;
  if (!named.some((n) => VALUE_KEYS.K?.includes(n.key))) {
    // PSpice allows a core model after the coupling value: K1 L1 L2 0.9 KMOD
    let last = pos.length - 1;
    if (last >= 2 && isNonNumericWord(pos[last]) && !isNonNumericWord(pos[last - 1])) {
      ctx.warn(`${name}: magnetic core model '${pos[last].v}' ignored`);
      last--;
    }
    if (last < 0) throw new CardError(`${name}: missing coupling coefficient`);
    setValue(el, valueOf(pos[last]));
    names = pos.slice(0, last);
  }
  applyNamed(el, named, ctx);
  if (names.length < 2) throw new CardError(`${name}: needs at least two inductor names`);
  el.inductors = names.map((t) => {
    const n = nodeName(t, 'inductor name');
    if (n[0].toUpperCase() !== 'L') throw new CardError(`${name}: '${n}' is not an inductor`);
    return n;
  });
  return el;
}

// ---- independent sources ---------------------------------------------------------------------

const WAVEFORMS: Record<string, WaveformType> = {
  sin: 'SIN',
  sine: 'SIN',
  pulse: 'PULSE',
  pwl: 'PWL',
  exp: 'EXP',
  sffm: 'SFFM',
  am: 'AM',
};

const SOURCE_KEYWORDS = new Set(['dc', 'ac', 'distof1', 'distof2', ...Object.keys(WAVEFORMS)]);
const UNSUPPORTED_SOURCE_KEYWORDS = new Set(['trnoise', 'trrandom', 'pat', 'wavefile', 'external']);

function isSourceKeyword(t: Tok | undefined): boolean {
  return t !== undefined && t.t === 'word' && SOURCE_KEYWORDS.has(t.v.toLowerCase());
}

/** A value token that is not a source keyword and does not start an assignment. */
function isSourceValue(toks: readonly Tok[], k: number): boolean {
  const t = toks[k];
  return isValueTok(t) && !isSourceKeyword(t) && !isAssign(toks, k);
}

function parseSource(type: 'V' | 'I', name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const el = newElement(type, name, [nodeName(toks[1], 'node n+'), nodeName(toks[2], 'node n-')], ctx);
  const src: SourceSpec = {};
  el.source = src;
  const setSrc = (key: 'dc' | 'acmag' | 'acphase', v: ValueText) => {
    if (v.num !== undefined) {
      if (key === 'dc') src.dc = v.num;
      else if (key === 'acmag') src.acMag = v.num;
      else src.acPhase = v.num;
    } else {
      (el.stringParams ??= {})[key] = v.expr;
    }
  };
  const setDistof = (which: 1 | 2, idx: 0 | 1, v: ValueText) => {
    const field = which === 1 ? 'distof1' : 'distof2';
    const pair: [number, number] = src[field] ?? [1, 0];
    if (v.num !== undefined) pair[idx] = v.num;
    else {
      pair[idx] = NaN;
      (el.stringParams ??= {})[distofKey(which, idx)] = v.expr;
    }
    src[field] = pair;
  };
  let dcGiven = false;
  let k = 3;
  while (k < toks.length) {
    const t = toks[k];
    const w = t.t === 'word' ? t.v.toLowerCase() : '';
    if (isAssign(toks, k)) {
      const valTok = toks[k + 2];
      if (!isValueTok(valTok)) throw new CardError(`missing value for '${t.v}'`);
      const v = valueOf(valTok);
      if (w === 'dc') {
        setSrc('dc', v);
        dcGiven = true;
      } else if (w === 'ac' || w === 'acmag') setSrc('acmag', v);
      else if (w === 'acphase') setSrc('acphase', v);
      else {
        setParam(el, w, v);
        checkInstanceParam(el, w, t.v, ctx);
      }
      k += 3;
      continue;
    }
    if (w === 'dc') {
      k++;
      if (isSourceValue(toks, k)) {
        setSrc('dc', valueOf(toks[k]));
        k++;
      } else src.dc = 0;
      dcGiven = true;
      continue;
    }
    if (w === 'ac') {
      k++;
      if (isSourceValue(toks, k)) {
        setSrc('acmag', valueOf(toks[k]));
        k++;
        if (isSourceValue(toks, k)) {
          setSrc('acphase', valueOf(toks[k]));
          k++;
        }
      } else src.acMag = 1;
      continue;
    }
    if (w === 'distof1' || w === 'distof2') {
      const which = w === 'distof1' ? 1 : 2;
      k++;
      setDistof(which, 0, isSourceValue(toks, k) ? valueOf(toks[k++]) : { num: 1 });
      if (isSourceValue(toks, k)) setDistof(which, 1, valueOf(toks[k++]));
      continue;
    }
    if (Object.hasOwn(WAVEFORMS, w)) {
      if (src.tran) throw new CardError(`${name}: more than one transient waveform`);
      k = parseWaveform(el, src, WAVEFORMS[w], toks, k + 1);
      continue;
    }
    if (UNSUPPORTED_SOURCE_KEYWORDS.has(w)) throw new CardError(`${name}: '${t.v}' sources are not supported`);
    if (isValueTok(t)) {
      if (dcGiven) throw new CardError(`${name}: unexpected '${t.v}'`);
      setSrc('dc', valueOf(t));
      dcGiven = true;
      k++;
      continue;
    }
    throw new CardError(`${name}: unexpected '${t.v}'`);
  }
  return el;
}

const MIN_WAVE_ARGS: Record<WaveformType, number> = { SIN: 2, PULSE: 2, PWL: 2, EXP: 2, SFFM: 2, AM: 2 };

/** Parse waveform arguments starting at k (just after the keyword); returns the next index. */
function parseWaveform(el: ElementIR, src: SourceSpec, type: WaveformType, toks: readonly Tok[], k: number): number {
  const vals: Tok[] = [];
  if (toks[k]?.t === '(') {
    // one group, or PSpice-style PWL pairs "(t1,v1) (t2,v2) ..."
    do {
      let depth = 0;
      for (; k < toks.length; k++) {
        const u = toks[k];
        if (u.t === '(') depth++;
        else if (u.t === ')') {
          depth--;
          if (depth === 0) {
            k++;
            break;
          }
        } else if (isValueTok(u)) vals.push(u);
        else if (u.t !== ',') throw new CardError(`unexpected '${u.v}' in ${type} arguments`);
      }
      if (depth !== 0) throw new CardError(`missing ')' after ${type} arguments`);
    } while (type === 'PWL' && toks[k]?.t === '(');
  } else {
    while (k < toks.length && (isSourceValue(toks, k) || toks[k].t === ',')) {
      if (toks[k].t !== ',') vals.push(toks[k]);
      k++;
    }
  }
  if (vals.length < MIN_WAVE_ARGS[type]) throw new CardError(`${type} needs at least ${MIN_WAVE_ARGS[type]} arguments`);
  if (type === 'PWL' && vals.length % 2 !== 0) throw new CardError('PWL needs (time, value) pairs');
  const args: number[] = [];
  vals.forEach((t, i) => {
    const v = valueOf(t);
    if (v.num !== undefined) args.push(v.num);
    else {
      args.push(NaN);
      (el.stringParams ??= {})[tranArgKey(i)] = v.expr;
    }
  });
  src.tran = { type, args };
  if (type === 'PWL') {
    // trailing r=<time> and td=<delay>
    while (isAssign(toks, k)) {
      const key = toks[k].v.toLowerCase();
      if (key !== 'r' && key !== 'td') break;
      const valTok = toks[k + 2];
      if (!isValueTok(valTok)) throw new CardError(`missing value for '${key}'`);
      const v = valueOf(valTok);
      if (key === 'r') {
        if (v.num !== undefined) src.tran.repeatFrom = v.num;
        else (el.stringParams ??= {})['tran.r'] = v.expr;
      } else {
        const timesNumeric = args.every((a, i) => i % 2 === 1 || !Number.isNaN(a));
        if (v.num !== undefined && timesNumeric) {
          for (let i = 0; i < args.length; i += 2) args[i] += v.num;
        } else {
          (el.stringParams ??= {})['tran.td'] = v.num !== undefined ? formatExprNumber(v.num) : v.expr;
        }
      }
      k += 3;
    }
  }
  return k;
}

// ---- controlled sources ----------------------------------------------------------------------

/** Raw expression text from token index k to the end of the card (delimiters removed). */
function restExpression(toks: readonly Tok[], text: string, k: number, what: string): string {
  const first = toks[k];
  if (!first) throw new CardError(`missing ${what} expression`);
  const raw = stripExpressionDelimiters(text.slice(first.pos));
  if (raw === '') throw new CardError(`empty ${what} expression`);
  return checkExpr(raw);
}

function behavioralFrom(orig: string, kind: 'V' | 'I', nodes: string[], expr: string, ctx: ElementContext): ElementIR {
  return { type: 'B', name: `B${orig}`, nodes, params: {}, expr: `${kind}=${expr}`, line: ctx.line };
}

function coefText(v: ValueText): string {
  return v.num !== undefined ? formatExprNumber(v.num) : `(${v.expr})`;
}

/**
 * Monomials of the SPICE polynomial source: coefficient j multiplies the product of the
 * controlling variables listed in terms[j] (graded lexicographic order: p0, x1..xn, x1², x1x2, ...).
 */
export function polyTerms(dims: number, count: number): number[][] {
  const terms: number[][] = [[]];
  for (let degree = 1; terms.length < count; degree++) {
    const combo = (start: number, left: number, acc: number[]): void => {
      if (terms.length >= count) return;
      if (left === 0) {
        terms.push(acc.slice());
        return;
      }
      for (let v = start; v < dims; v++) {
        acc.push(v);
        combo(v, left - 1, acc);
        acc.pop();
      }
    };
    combo(0, degree, []);
  }
  return terms.slice(0, count);
}

/** Polynomial expression text for controlling variables `vars` (already formatted). */
export function polyExpression(vars: readonly string[], coeffs: readonly ValueText[]): string {
  const terms = polyTerms(vars.length, coeffs.length);
  const parts: string[] = [];
  coeffs.forEach((c, j) => {
    if (c.num === 0) return;
    const factors = terms[j].map((v) => vars[v]);
    if (factors.length === 0) parts.push(coefText(c));
    else if (c.num === 1) parts.push(factors.join(' * '));
    else parts.push([coefText(c), ...factors].join(' * '));
  });
  return parts.length > 0 ? parts.join(' + ') : '0';
}

interface PolySpec {
  dims: number;
  /** index of the first token after "POLY(n)" */
  next: number;
}

function readPolyHeader(toks: readonly Tok[], k: number): PolySpec {
  // toks[k] is the POLY word
  if (toks[k + 1]?.t !== '(' || toks[k + 3]?.t !== ')') throw new CardError('expected POLY(n)');
  const nTok = toks[k + 2];
  const n = nTok.t === 'word' ? parseNumberWord(nTok.v) : undefined;
  if (n === undefined || !Number.isInteger(n) || n < 1) throw new CardError(`invalid POLY dimension '${nTok.v}'`);
  return { dims: n, next: k + 4 };
}

function parsePolyValues(toks: readonly Tok[], k: number, ctx: ElementContext, name: string): Tok[] {
  const { pos, named } = splitArgs(toks, k);
  for (const n of named) ctx.warn(`${name}: '${n.key}=' ignored on a POLY source`);
  return pos;
}

function parseVoltageControlled(
  type: 'E' | 'G',
  name: string,
  toks: readonly Tok[],
  text: string,
  ctx: ElementContext,
): ElementIR {
  const nodes = [nodeName(toks[1], 'node n+'), nodeName(toks[2], 'node n-')];
  const kind = type === 'E' ? 'V' : 'I';
  const t3 = toks[3];
  const kw = t3?.t === 'word' ? t3.v.toLowerCase() : '';
  if (kw === 'value' || ((kw === 'vol' || kw === 'cur') && toks[4]?.t === '=')) {
    if (kw === 'vol' && type !== 'E') throw new CardError(`${name}: vol= is only valid for E sources`);
    if (kw === 'cur' && type !== 'G') throw new CardError(`${name}: cur= is only valid for G sources`);
    const k = toks[4]?.t === '=' ? 5 : 4;
    return behavioralFrom(name, kind, nodes, restExpression(toks, text, k, 'VALUE'), ctx);
  }
  if (kw === 'table') {
    const exprTok = toks[4];
    if (!exprTok) throw new CardError(`${name}: missing TABLE expression`);
    let input: string;
    let k: number;
    if (exprTok.t === 'brace' || exprTok.t === 'quote') {
      input = checkExpr(exprTok.v);
      k = 5;
    } else {
      // unbraced: everything up to the '=' that introduces the pairs
      let j = 4;
      while (j < toks.length && toks[j].t !== '=') j++;
      if (j >= toks.length) throw new CardError(`${name}: TABLE needs '= (x,y) ...'`);
      input = checkExpr(text.slice(exprTok.pos, toks[j].pos).trim());
      k = j;
    }
    const vals = splitArgs(toks, k).pos.map(valueOf);
    if (vals.length < 2 || vals.length % 2 !== 0) throw new CardError(`${name}: TABLE needs (x, y) pairs`);
    const args = vals.map((v) => (v.num !== undefined ? formatExprNumber(v.num) : v.expr));
    return behavioralFrom(name, kind, nodes, `table(${input}, ${args.join(', ')})`, ctx);
  }
  if (kw === 'poly') {
    const { dims, next } = readPolyHeader(toks, 3);
    const pos = parsePolyValues(toks, next, ctx, name);
    if (pos.length < 2 * dims) throw new CardError(`${name}: POLY(${dims}) needs ${2 * dims} controlling nodes`);
    const ctl = pos.slice(0, 2 * dims).map((t) => nodeName(t, 'controlling node'));
    const coeffs = pos.slice(2 * dims).map(valueOf);
    if (coeffs.length === 0) throw new CardError(`${name}: POLY needs coefficients`);
    if (dims === 1 && isPlainGain(coeffs)) {
      const el = newElement(type, name, [...nodes, ctl[0], ctl[1]], ctx);
      el.value = coeffs[1]?.num ?? 0;
      return el;
    }
    const vars: string[] = [];
    for (let d = 0; d < dims; d++) vars.push(`V(${ctl[2 * d]},${ctl[2 * d + 1]})`);
    return behavioralFrom(name, kind, nodes, polyExpression(vars, coeffs), ctx);
  }
  if (kw === 'laplace') {
    // LAPLACE {input} = {transform}
    const inTok = toks[4];
    let k = 5;
    if (toks[k]?.t === '=') k++;
    const trTok = toks[k];
    if (!inTok || !trTok || !isValueTok(inTok) || !isValueTok(trTok)) throw new CardError(`${name}: LAPLACE needs {input} = {transform}`);
    let input: { pos: string; neg: string; gain: number };
    let tr: { num: number[]; den: number[] };
    try {
      input = laplaceInput(inTok.v);
      tr = rationalTransform(trTok.v);
    } catch (e) {
      throw new CardError(`${name}: ${(e as Error).message}`);
    }
    const el = newElement(type, name, [...nodes, input.pos, input.neg], ctx);
    el.value = input.gain;
    el.laplace = tr;
    return el;
  }
  if (kw === 'freq') return parseFreqTable(type, name, nodes, toks, ctx);
  if (kw === 'chebyshev') return parseChebyshev(type, name, nodes, toks, ctx);
  const { pos, named } = splitArgs(toks, 3);
  const el = newElement(type, name, [...nodes, nodeName(pos[0], 'controlling node nc+'), nodeName(pos[1], 'controlling node nc-')], ctx);
  if (pos.length > 3) throw new CardError(`${name}: unexpected '${pos[3].v}'`);
  if (pos[2]) setValue(el, valueOf(pos[2]));
  applyNamed(el, named, ctx);
  if (!hasValue(el)) throw new CardError(`${name}: missing gain`);
  return el;
}

/** The braced / quoted controlling expression of a FREQ / CHEBYSHEV card (toks[4]). */
function controlInput(name: string, toks: readonly Tok[], kw: string): { pos: string; neg: string; gain: number } {
  const inTok = toks[4];
  if (!inTok || (inTok.t !== 'brace' && inTok.t !== 'quote' && inTok.t !== 'string')) throw new CardError(`${name}: ${kw} needs {input} = ...`);
  try {
    return laplaceInput(inTok.v);
  } catch (e) {
    throw new CardError(`${name}: ${(e as Error).message.replace('LAPLACE', kw)}`);
  }
}

function plainNumber(t: Tok, what: string): number {
  const v = valueOf(t);
  if (v.num === undefined) throw new CardError(`${what} must be a number (found '${t.v}')`);
  return v.num;
}

/**
 * E/G ... FREQ {V(a,b)} [MAG|DB] [DEG|RAD] [R_I] = (f, m, p) (f, m, p) ... [DELAY=t]
 * (defaults: magnitude in dB, phase in degrees; R_I: real and imaginary parts). The table may
 * also be a flat list of triples. Stored as ElementIR.freqTable (linear magnitude, unwrapped
 * phase in degrees).
 */
function parseFreqTable(type: 'E' | 'G', name: string, nodes: string[], toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const input = controlInput(name, toks, 'FREQ');
  let k = 5;
  let db = true;
  let deg = true;
  let ri = false;
  for (; k < toks.length && toks[k].t !== '='; k++) {
    const w = toks[k].t === 'word' ? toks[k].v.toLowerCase() : '';
    if (w === 'mag') db = false;
    else if (w === 'db') db = true;
    else if (w === 'deg') deg = true;
    else if (w === 'rad') deg = false;
    else if (w === 'r_i') ri = true;
    else throw new CardError(`${name}: unexpected '${toks[k].v}' before the FREQ table (MAG, DB, DEG, RAD or R_I)`);
  }
  if (toks[k]?.t !== '=') throw new CardError(`${name}: FREQ needs '= (f, magnitude, phase) ...'`);
  k++;
  const vals: Tok[] = [];
  let delay: number | undefined;
  for (; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === '(' || t.t === ')' || t.t === ',') continue;
    if (isAssign(toks, k) && t.v.toLowerCase() === 'delay') {
      delay = plainNumber(toks[k + 2], `${name}: DELAY`);
      if (!(delay >= 0)) throw new CardError(`${name}: DELAY must not be negative`);
      k += 2;
      continue;
    }
    if (!isValueTok(t)) throw new CardError(`${name}: unexpected '${t.v}' in the FREQ table`);
    vals.push(t);
  }
  if (vals.length < 3 || vals.length % 3 !== 0) throw new CardError(`${name}: FREQ needs (frequency, magnitude, phase) triples`);
  const f: number[] = [];
  const mag: number[] = [];
  const phase: number[] = [];
  for (let i = 0; i < vals.length; i += 3) {
    const fi = plainNumber(vals[i], `${name}: FREQ frequency`);
    const a = plainNumber(vals[i + 1], `${name}: FREQ magnitude`);
    const b = plainNumber(vals[i + 2], `${name}: FREQ phase`);
    if (!(fi >= 0)) throw new CardError(`${name}: FREQ frequencies must not be negative`);
    if (f.length && !(fi > f[f.length - 1])) throw new CardError(`${name}: FREQ frequencies must increase`);
    let m: number;
    let p: number;
    if (ri) {
      m = Math.hypot(a, b);
      p = (Math.atan2(b, a) * 180) / Math.PI;
      // unwrap against the previous point
      if (phase.length) while (p - phase[phase.length - 1] > 180) p -= 360;
      if (phase.length) while (p - phase[phase.length - 1] < -180) p += 360;
    } else {
      m = db ? Math.pow(10, a / 20) : a;
      p = deg ? b : (b * 180) / Math.PI;
      if (!(m >= 0)) throw new CardError(`${name}: a linear FREQ magnitude must not be negative`);
    }
    f.push(fi);
    mag.push(m);
    phase.push(p);
  }
  const el = newElement(type, name, [...nodes, input.pos, input.neg], ctx);
  el.value = input.gain;
  el.freqTable = { f, mag, phase, ...(delay ? { delay } : {}) };
  return el;
}

/**
 * E/G ... CHEBYSHEV {V(a,b)} = LP|HP fpass fstop ripple atten  |  BP|BR f1 f2 f3 f4 ripple atten
 * (see chebyshev.ts). Realised as a cascade of first / second order LAPLACE stages: the stages
 * before the last are E elements "<name>_s<k>" (G cards: "E<name>_s<k>") driving internal nodes
 * "<name>#c<k>"; the card's own element is the last stage.
 */
function parseChebyshev(type: 'E' | 'G', name: string, nodes: string[], toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const input = controlInput(name, toks, 'CHEBYSHEV');
  if (toks[5]?.t !== '=') throw new CardError(`${name}: CHEBYSHEV needs '= LP|HP|BP|BR frequencies ripple attenuation'`);
  const kindTok = toks[6];
  const kind = kindTok?.t === 'word' ? kindTok.v.toUpperCase() : '';
  if (kind !== 'LP' && kind !== 'HP' && kind !== 'BP' && kind !== 'BR') throw new CardError(`${name}: CHEBYSHEV type must be LP, HP, BP or BR`);
  const nums = toks.slice(7).filter((t) => t.t !== ',' && t.t !== '(' && t.t !== ')').map((t) => plainNumber(t, `${name}: CHEBYSHEV value`));
  const nf = kind === 'LP' || kind === 'HP' ? 2 : 4;
  if (nums.length !== nf + 2) throw new CardError(`${name}: CHEBYSHEV ${kind} needs ${nf} frequencies, the ripple and the attenuation`);
  let design;
  try {
    design = designChebyshev({ kind, edges: nums.slice(0, nf), ripple: nums[nf], atten: nums[nf + 1] });
  } catch (e) {
    throw new CardError(`${name}: ${(e as Error).message}`);
  }
  const secs = design.sections;
  if (secs.length > 1 && !ctx.addElement) throw new CardError(`${name}: CHEBYSHEV filters need a reader that can add elements`);
  let inPos = input.pos;
  let inNeg = input.neg;
  let gain = input.gain;
  for (let i = 0; i < secs.length - 1; i++) {
    const node = `${name}#c${i + 1}`;
    const stage = newElement('E', `${type === 'E' ? '' : 'E'}${name}_s${i + 1}`, [node, '0', inPos, inNeg], ctx);
    stage.value = gain;
    stage.laplace = secs[i];
    ctx.addElement!(stage);
    inPos = node;
    inNeg = '0';
    gain = 1;
  }
  const el = newElement(type, name, [...nodes, inPos, inNeg], ctx);
  el.value = gain;
  el.laplace = secs[secs.length - 1];
  return el;
}

/** POLY(1) p0 p1 [0 0 ...] with p0 = 0: an ordinary linear gain p1. */
function isPlainGain(coeffs: readonly ValueText[]): boolean {
  return (
    coeffs.length >= 1 &&
    coeffs[0].num === 0 &&
    (coeffs.length < 2 || coeffs[1].num !== undefined) &&
    coeffs.slice(2).every((c) => c.num === 0)
  );
}

function parseCurrentControlled(
  type: 'F' | 'H',
  name: string,
  toks: readonly Tok[],
  text: string,
  ctx: ElementContext,
): ElementIR {
  const nodes = [nodeName(toks[1], 'node n+'), nodeName(toks[2], 'node n-')];
  const kind = type === 'H' ? 'V' : 'I';
  const t3 = toks[3];
  const kw = t3?.t === 'word' ? t3.v.toLowerCase() : '';
  if (kw === 'value') {
    const k = toks[4]?.t === '=' ? 5 : 4;
    return behavioralFrom(name, kind, nodes, restExpression(toks, text, k, 'VALUE'), ctx);
  }
  if (kw === 'poly') {
    const { dims, next } = readPolyHeader(toks, 3);
    const pos = parsePolyValues(toks, next, ctx, name);
    if (pos.length < dims) throw new CardError(`${name}: POLY(${dims}) needs ${dims} controlling sources`);
    const ctl = pos.slice(0, dims).map((t) => nodeName(t, 'controlling source'));
    const coeffs = pos.slice(dims).map(valueOf);
    if (coeffs.length === 0) throw new CardError(`${name}: POLY needs coefficients`);
    if (dims === 1 && isPlainGain(coeffs)) {
      const el = newElement(type, name, nodes, ctx);
      el.control = ctl[0];
      el.value = coeffs[1]?.num ?? 0;
      return el;
    }
    return behavioralFrom(name, kind, nodes, polyExpression(ctl.map((c) => `I(${c})`), coeffs), ctx);
  }
  const { pos, named } = splitArgs(toks, 3);
  const el = newElement(type, name, nodes, ctx);
  el.control = nodeName(pos[0], 'controlling source name');
  if (pos.length > 2) throw new CardError(`${name}: unexpected '${pos[2].v}'`);
  if (pos[1]) setValue(el, valueOf(pos[1]));
  applyNamed(el, named, ctx);
  if (!hasValue(el)) throw new CardError(`${name}: missing gain`);
  return el;
}

/** Instance parameters that may follow a B-source expression. */
const B_TRAILING = new Set(['tc1', 'tc2', 'temp', 'dtemp', 'm', 'ic', 'rpar', 'cpar', 'noiseless']);

function parseBehavioral(name: string, toks: readonly Tok[], text: string, ctx: ElementContext): ElementIR {
  const nodes = [nodeName(toks[1], 'node n+'), nodeName(toks[2], 'node n-')];
  const kindTok = toks[3];
  const kw = kindTok?.t === 'word' ? kindTok.v.toLowerCase() : '';
  if (!(kw === 'v' || kw === 'i' || kw === 'r') || toks[4]?.t !== '=') {
    throw new CardError(`${name}: expected V=<expr>, I=<expr> or R=<expr>`);
  }
  const start = toks[5];
  if (!start) throw new CardError(`${name}: missing expression`);
  // the expression runs to the end of the card or to a trailing "param=" assignment
  let end = text.length;
  let depth = 0;
  let trailing = toks.length;
  for (let j = 5; j < toks.length; j++) {
    const t = toks[j];
    if (t.t === '(') depth++;
    else if (t.t === ')') depth--;
    else if (depth === 0 && j > 5 && isAssign(toks, j) && B_TRAILING.has(t.v.toLowerCase())) {
      end = t.pos;
      trailing = j;
      break;
    }
  }
  const exprText = checkExpr(stripExpressionDelimiters(text.slice(start.pos, end)));
  if (exprText === '') throw new CardError(`${name}: empty expression`);
  let expr: string;
  if (kw === 'r') expr = `I=V(${nodes[0]},${nodes[1]}) / (${exprText})`;
  else expr = `${kw.toUpperCase()}=${exprText}`;
  const el: ElementIR = { type: 'B', name, nodes, params: {}, expr, line: ctx.line };
  applyNamed(el, splitArgs(toks, trailing).named, ctx);
  return el;
}

// ---- semiconductors, switches, lines ---------------------------------------------------------

/** Model + optional area / flags after the nodes (D, J, Z share this layout). */
function finishSemi(el: ElementIR, rest: readonly Tok[], named: readonly NamedArg[], name: string, flags: readonly string[], ctx: ElementContext): void {
  const modelTok = rest[0];
  if (!modelTok || modelTok.t !== 'word') throw new CardError(`${name}: missing model name`);
  el.model = modelTok.v;
  let areaSet = false;
  for (const t of rest.slice(1)) {
    if (flagParam(el, t, flags)) continue;
    if (!areaSet) {
      setParam(el, 'area', valueOf(t));
      areaSet = true;
      continue;
    }
    throw new CardError(`${name}: unexpected '${t.v}'`);
  }
  applyNamed(el, named, ctx);
}

function parseSemi(type: 'D' | 'J' | 'Z', name: string, toks: readonly Tok[], ctx: ElementContext, nodeCount: number): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  if (pos.length < nodeCount + 1) throw new CardError(`${name}: expected ${nodeCount} nodes and a model name`);
  const el = newElement(
    type,
    name,
    pos.slice(0, nodeCount).map((t) => nodeName(t, 'node')),
    ctx,
  );
  finishSemi(el, pos.slice(nodeCount), named, name, ['off'], ctx);
  return el;
}

/** A word naming a model defined in the input (model names such as 2N2222 may look numeric). */
function isKnownModel(t: Tok | undefined, ctx: ElementContext): boolean {
  return t !== undefined && t.t === 'word' && ctx.isModel(t.v);
}

function isFlagWord(t: Tok | undefined): boolean {
  return t !== undefined && t.t === 'word' && ['off', 'on'].includes(t.v.toLowerCase());
}

function parseBjt(name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  if (pos.length < 4) throw new CardError(`${name}: expected collector, base, emitter nodes and a model name`);
  // Q c b e [s] model ...: decide whether the 4th word is a substrate node or the model
  let nodeCount = 3;
  const w3 = pos[3];
  const w4 = pos[4];
  if (isKnownModel(w3, ctx)) nodeCount = 3;
  else if (isKnownModel(w4, ctx)) nodeCount = 4;
  else if (isNonNumericWord(w4) && !isFlagWord(w4)) nodeCount = 4;
  const el = newElement('Q', name, pos.slice(0, nodeCount).map((t) => nodeName(t, 'node')), ctx);
  finishSemi(el, pos.slice(nodeCount), named, name, ['off'], ctx);
  return el;
}

function parseMosfet(name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  if (pos.length < 4) throw new CardError(`${name}: expected drain, gate, source [, bulk] nodes and a model name`);
  const threeTerminal = pos.length === 4 || (isKnownModel(pos[3], ctx) && !isKnownModel(pos[4], ctx));
  const nodes = pos.slice(0, threeTerminal ? 3 : 4).map((t) => nodeName(t, 'node'));
  if (threeTerminal) nodes.push(nodes[2]); // bulk tied to source (VDMOS-style 3-terminal device)
  const el = newElement('M', name, nodes, ctx);
  const rest = pos.slice(threeTerminal ? 3 : 4);
  const modelTok = rest[0];
  if (!modelTok || modelTok.t !== 'word') throw new CardError(`${name}: missing model name`);
  el.model = modelTok.v;
  for (const t of rest.slice(1)) {
    if (!flagParam(el, t, ['off'])) throw new CardError(`${name}: unexpected '${t.v}'`);
  }
  applyNamed(el, named, ctx);
  return el;
}

function parseSwitch(type: 'S' | 'W', name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  const nodeCount = type === 'S' ? 4 : 2;
  if (pos.length < nodeCount + (type === 'W' ? 2 : 1)) {
    throw new CardError(type === 'S' ? `${name}: expected 4 nodes and a model name` : `${name}: expected 2 nodes, a controlling source and a model name`);
  }
  const el = newElement(type, name, pos.slice(0, nodeCount).map((t) => nodeName(t, 'node')), ctx);
  let k = nodeCount;
  if (type === 'W') el.control = nodeName(pos[k++], 'controlling source name');
  el.model = nodeName(pos[k++], 'model name');
  for (const t of pos.slice(k)) {
    if (!flagParam(el, t, ['on', 'off'])) throw new CardError(`${name}: unexpected '${t.v}'`);
  }
  applyNamed(el, named, ctx);
  return el;
}

function parseTline(name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  if (pos.length < 4) throw new CardError(`${name}: expected 4 nodes`);
  if (pos.length > 4) throw new CardError(`${name}: unexpected '${pos[4].v}' (lossy T lines with a model are not supported; use an O element)`);
  const el = newElement('T', name, pos.map((t) => nodeName(t, 'node')), ctx);
  applyNamed(el, named, ctx);
  if (el.params.zo !== undefined && el.params.z0 === undefined) {
    el.params.z0 = el.params.zo;
    delete el.params.zo;
  }
  const has = (k: string) => el.params[k] !== undefined || el.stringParams?.[k] !== undefined;
  if (!has('td') && !has('f')) throw new CardError(`${name}: needs td= or f=`);
  return el;
}

function parseLossyLine(name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  const { pos, named } = splitArgs(toks, 1);
  if (pos.length !== 5) throw new CardError(`${name}: expected 4 nodes and a model name`);
  const el = newElement('O', name, pos.slice(0, 4).map((t) => nodeName(t, 'node')), ctx);
  el.model = nodeName(pos[4], 'model name');
  applyNamed(el, named, ctx);
  return el;
}

// ---- subcircuit instances and code models ----------------------------------------------------

function overrideText(t: Tok): string {
  if (t.t === 'string') return checkExpr(t.v);
  const v = valueOf(t);
  return v.num !== undefined ? (t.t === 'word' ? t.v : formatExprNumber(v.num)) : v.expr;
}

function parseInstance(name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  // positional words up to "PARAMS:" or the first assignment
  const positional: Tok[] = [];
  let k = 1;
  const overrides: Record<string, string> = {};
  while (k < toks.length) {
    const t = toks[k];
    if (t.t === 'word' && /^params:/i.test(t.v)) {
      const restOfWord = t.v.slice(7);
      if (restOfWord !== '') {
        // "PARAMS:r=1k" glued together
        if (toks[k + 1]?.t !== '=' || !isValueTok(toks[k + 2])) throw new CardError(`${name}: bad PARAMS: syntax`);
        overrides[restOfWord.toLowerCase()] = overrideText(toks[k + 2]);
        k += 3;
      } else k++;
      break;
    }
    if (isAssign(toks, k)) break;
    if (isValueTok(t)) positional.push(t);
    k++;
  }
  const { pos, named } = splitArgs(toks, k);
  if (pos.length > 0) throw new CardError(`${name}: unexpected '${pos[0].v}' after the parameter list`);
  for (const n of named) {
    if (n.vals.length !== 1) throw new CardError(`${name}: parameter '${n.key}' needs exactly one value`);
    overrides[n.key] = overrideText(n.vals[0]);
  }
  if (positional.length < 1) throw new CardError(`${name}: missing subcircuit name`);
  const sub = positional[positional.length - 1];
  const el = newElement('X', name, positional.slice(0, -1).map((t) => nodeName(t, 'node')), ctx);
  el.model = nodeName(sub, 'subcircuit name');
  if (Object.keys(overrides).length > 0) el.stringParams = overrides;
  return el;
}

function parseCodeModel(name: string, toks: readonly Tok[], ctx: ElementContext): ElementIR {
  // last word (outside any bracket) before assignments is the model
  let end = toks.length;
  for (let j = 1; j < toks.length; j++) {
    if (isAssign(toks, j)) {
      end = j;
      break;
    }
  }
  let modelIdx = -1;
  for (let j = end - 1; j >= 1; j--) {
    if (toks[j].t === 'word') {
      modelIdx = j;
      break;
    }
    if (toks[j].t !== ',') break;
  }
  if (modelIdx < 0) throw new CardError(`${name}: missing model name`);
  const nodes: string[] = [];
  const template: string[] = [];
  let structured = false;
  let depth = 0;
  for (let j = 1; j < modelIdx; j++) {
    const t = toks[j];
    if (t.t === 'word') {
      if (t.v.startsWith('%')) {
        template.push(t.v.toLowerCase());
        structured = true;
        continue;
      }
      const inverted = t.v.startsWith('~');
      const node = inverted ? t.v.slice(1) : t.v;
      if (node === '') throw new CardError(`${name}: empty node name`);
      nodes.push(node);
      template.push(inverted ? '~#' : '#');
      if (inverted) structured = true;
      continue;
    }
    if (t.t === '[' || t.t === '(') depth++;
    else if (t.t === ']' || t.t === ')') depth--;
    if (t.t === '[' || t.t === ']' || t.t === '(' || t.t === ')') {
      template.push(t.t);
      structured = true;
      continue;
    }
    if (t.t === ',') continue;
    throw new CardError(`${name}: unexpected '${t.v}' in the port list`);
  }
  if (depth !== 0) throw new CardError(`${name}: unbalanced brackets in the port list`);
  const el = newElement('A', name, nodes, ctx);
  el.model = toks[modelIdx].v;
  if (structured) el.stringParams = { ports: template.join(' ') };
  applyNamed(el, splitArgs(toks, end).named);
  return el;
}
