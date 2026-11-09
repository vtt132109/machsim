/**
 * SPICE netlist reader: text -> Netlist IR (src/sim/netlist.ts).
 *
 *   parseSpice(text, { resolveInclude?, fileName?, hasTitle? }) -> { netlist, warnings, errors }
 *
 * Dialect: SPICE3 / ngspice, plus the PSpice and LTspice forms people paste from vendor model
 * files. The first line is the title (SPICE rule; `hasTitle: false` for library files). Comments:
 * "*" lines, "//" and ";" lines, inline ";", " $ ", " //". "+" continues the previous card. Keywords
 * and names are case-insensitive (names keep their case in the IR).
 *
 * Cards
 *   elements          every ElementType of netlist.ts, see elements.ts for the syntax. An instance
 *                     parameter the element's device does not use (LTspice Cpar=, a typo) is kept
 *                     but reported as a warning; LTspice Rser= on V / C / L becomes an explicit
 *                     series resistor R<name>_rser through the node <name>_rser. An X instance
 *                     parameter the subcircuit does not declare is reported too (checkReferences).
 *   .model            name [ako:base] type [(] p=v ... [)]   numeric -> params, {expr} -> stringParams
 *                     as "{expr}", other words/strings -> stringParams literal. Unknown parameters are
 *                     kept. PSpice type names RES CAP IND VSWITCH ISWITCH GASFET map to R C L SW CSW NMF.
 *   .subckt/.ends     name ports [PARAMS:] [p=v ...]; may nest; local .model/.subckt/.param/.func
 *   .param            name=value ... (values: numbers, {expr}, 'expr', or bare expressions)
 *   .func             name(args) [=] {body}
 *   .global           node names
 *   .include / .inc   file (via opts.resolveInclude; a relative path is first tried next to the
 *                     including file, e.g. "lib/a.lib" including "b.lib" asks for "lib/b.lib")
 *   .lib              file section  (section between ".lib section" and ".endl" of that file);
 *                     ".lib file" alone includes the whole file (PSpice); ".lib name ... .endl" blocks
 *                     in the text itself are section definitions and are skipped
 *   .options          known keys -> SimOptions; others reported as ignored
 *   .temp             one value -> options.temp; several -> every analysis wrapped in a 'tempsweep'
 *   .step             temp | param <name> | element | modeltype model(param), lin/dec/oct/list ->
 *                     'paramsweep' / 'tempsweep' wrapper (one .step supported). ".step param" sweeps
 *                     a global .param (paramsweep with global: true, outermost, re-evaluated per run)
 *   analyses          .op .dc .ac .tran .noise .tf .sens .pz .four .disto (see controls.ts)
 *   .ic / .nodeset    V(node)=value ...
 *   .meas / .measure  TRAN / AC / DC measurements -> netlist.measures (measure.ts; evaluated on the
 *                     results by src/sim/analyses/meas.ts)
 *   .save .print .plot .probe   output requests -> netlist.saves
 *   .title            sets the title;  .end stops reading
 *   .control ... .endc and other tool-specific cards are ignored with a warning.
 *   "*@machsim analysis {json}" pragma lines (written by writer.ts) add an analysis verbatim.
 *
 * Netlist IR encodings that have no dedicated field (see params.ts): .func definitions are stored
 * in Netlist.params / SubcktDef.params under "name(arg,...)" keys, .global nodes under ".global".
 * Values given as expressions are kept unevaluated in ElementIR.stringParams (irfields.ts);
 * flattenNetlist() evaluates them. Analysis/option/.ic arguments are evaluated here against the
 * global .param values.
 *
 * Diagnostics: every error carries the 1-based line of the offending card in the main text (for
 * cards from included files: the line of the .include, with "file:line:" in the message). Warnings
 * are strings prefixed with "line N:". The reader never throws on bad input.
 */

import {
  emptyNetlist,
  type AnalysisSpec,
  type AnalysisType,
  type ElementIR,
  type ModelCard,
  type Netlist,
  type NoiseAnalysis,
  type SubcktDef,
} from '../netlist';
import { stripExpressionDelimiters } from './expr';
import { CardError, parseNumberWord, splitLogicalLines, tokenValue, tokenizeCard, type LogicalLine, type Tok } from './lexer';
import { GLOBAL_NODES_KEY, ParamError, buildParamScope, makeFuncKey, parseFuncKey, type ParamScope } from './params';
import { checkExpr, isAssign, isValueTok, parseElementCard, splitParasitics, type ElementContext } from './elements';
import {
  parseAnalysisCard,
  parseNodeValues,
  parseOptionsCard,
  parseStepCard,
  parseTempCard,
  readOutputs,
  type ControlContext,
  type StepSpec,
} from './controls';
import { parseMeasCard } from './measure';

export interface SpiceParseOptions {
  /** Return the text of an .include / .lib file, or undefined when it does not exist. */
  resolveInclude?(path: string): string | undefined;
  /** Name of the main text, used in messages from nested files. */
  fileName?: string;
  /** The first line is the title (SPICE rule). Default true; pass false for model/library files. */
  hasTitle?: boolean;
}

export interface SpiceParseError {
  /** 1-based line in the main text */
  line: number;
  message: string;
}

export interface SpiceParseResult {
  netlist: Netlist;
  /** "line N: message" */
  warnings: string[];
  errors: SpiceParseError[];
}

/** Parse SPICE netlist text. Never throws; problems are reported in errors/warnings. */
export function parseSpice(text: string, opts: SpiceParseOptions = {}): SpiceParseResult {
  return new SpiceReader(opts).read(text);
}

/** Every AnalysisSpec type, for validating pragma analyses. */
const ANALYSIS_TYPES: ReadonlySet<AnalysisType> = new Set<AnalysisType>([
  'op',
  'dc',
  'ac',
  'acsingle',
  'tran',
  'noise',
  'tf',
  'sens',
  'pz',
  'four',
  'disto',
  'noisefig',
  'paramsweep',
  'tempsweep',
  'montecarlo',
  'worstcase',
  'nestedsweep',
  'tracewidth',
  'batch',
  'user',
]);

const ANALYSIS_CARDS = new Set(['op', 'dc', 'ac', 'tran', 'noise', 'tf', 'sens', 'pz', 'four', 'disto']);
const DEFERRED_CARDS = new Set([...ANALYSIS_CARDS, 'options', 'option', 'opt', 'temp', 'ic', 'nodeset', 'step']);
const IGNORED_CARDS = new Set([
  'backanno',
  'width',
  'csparam',
  'alter',
  'data',
  'enddata',
  'mc',
  'wcase',
  'worst',
  'net',
  'hb',
  'distribution',
  'loadbias',
  'savebias',
  'stimulus',
  'vector',
  'watch',
  'extract',
  'text',
  'pss',
  'sp',
  'lin',
  'wave',
  'dist',
]);

const MODEL_TYPE_ALIASES: Readonly<Record<string, string>> = {
  RES: 'R',
  CAP: 'C',
  IND: 'L',
  VSWITCH: 'SW',
  ISWITCH: 'CSW',
  GASFET: 'NMF',
};

const MAX_INCLUDE_DEPTH = 16;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MODEL_ELEMENT_TYPES = new Set(['D', 'Q', 'J', 'M', 'Z', 'S', 'W', 'O', 'A']);

/** A logical card after include expansion. */
interface Card {
  text: string;
  /** line reported in diagnostics (main text) */
  line: number;
  /** "file:line: " prefix for cards that came from an included file, else "" */
  where: string;
  pragma?: boolean;
}

/** Definition scope: the top level or one .subckt body. */
interface Scope {
  def?: SubcktDef;
  parent?: Scope;
  card?: Card;
  elements: ElementIR[];
  models: Record<string, ModelCard>;
  subckts: Record<string, SubcktDef>;
  names: Set<string>;
}

function firstWord(text: string): string {
  return text.trim().split(/\s+/, 1)[0].toLowerCase();
}

function findCard(lines: readonly LogicalLine[], from: number, keyword: string): number {
  for (let j = from + 1; j < lines.length; j++) {
    if (!lines[j].pragma && firstWord(lines[j].text) === keyword) return j;
  }
  return -1;
}

function unquote(s: string): string {
  return s.replace(/^(['"])(.*)\1$/, '$2');
}

/** Lines of `.lib <section>` ... `.endl` in a library file; undefined when the section is absent. */
function extractSection(lines: readonly LogicalLine[], section: string): LogicalLine[] | undefined {
  const want = section.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const words = lines[i].text.trim().split(/\s+/);
    if (words.length === 2 && words[0].toLowerCase() === '.lib' && unquote(words[1]).toLowerCase() === want) {
      const end = findCard(lines, i, '.endl');
      return lines.slice(i + 1, end < 0 ? lines.length : end);
    }
  }
  return undefined;
}

/** Remove keys equal to `name` ignoring case (so redefinitions replace, whatever the case). */
function deleteKeyCI(table: Record<string, unknown>, name: string): void {
  const lower = name.toLowerCase();
  for (const k of Object.keys(table)) if (k.toLowerCase() === lower) delete table[k];
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class SpiceReader {
  private readonly netlist: Netlist = emptyNetlist();
  /** warnings with the line they belong to (sorted by line in the result) */
  private readonly warnings: { line: number; text: string }[] = [];
  private readonly errors: SpiceParseError[] = [];
  private readonly top: Scope;
  private scope: Scope;
  private readonly modelNames = new Set<string>();
  private readonly deferred: Card[] = [];
  /** lower-case .param / .func key -> defining card */
  private readonly paramCards = new Map<string, Card>();
  private globalScope: ParamScope | undefined;
  private globalScopeError: string | undefined;
  private temps: { values: number[]; card: Card } | undefined;
  private step: { spec: StepSpec; card: Card } | undefined;
  private readonly pendingNoise: { spec: NoiseAnalysis; card: Card }[] = [];

  constructor(private readonly opts: SpiceParseOptions) {
    this.top = {
      elements: this.netlist.elements,
      models: this.netlist.models,
      subckts: this.netlist.subckts,
      names: new Set(),
    };
    this.scope = this.top;
  }

  read(text: string): SpiceParseResult {
    const cards = this.expand(text);
    for (const c of cards) {
      const m = c.pragma ? null : /^\.model\s+(\S+)/i.exec(c.text);
      if (m) this.modelNames.add(m[1].toLowerCase());
    }
    for (const c of cards) this.guard(c, () => this.processCard(c));
    while (this.scope !== this.top) {
      const s = this.scope;
      if (s.card && s.def) this.error(s.card, `.subckt ${s.def.name} has no matching .ends`);
      this.scope = s.parent ?? this.top;
    }
    this.paramScope();
    for (const c of this.deferred) this.guard(c, () => this.processDeferred(c));
    this.finishAnalyses();
    this.checkReferences();
    this.errors.sort((a, b) => a.line - b.line);
    const warnings = this.warnings.map((w, i) => ({ ...w, i })).sort((a, b) => a.line - b.line || a.i - b.i);
    return { netlist: this.netlist, warnings: warnings.map((w) => w.text), errors: this.errors };
  }

  // ------------------------------------------------------------------ diagnostics

  private error(card: Card, message: string): void {
    this.errors.push({ line: card.line, message: card.where + message });
  }

  private warn(card: Card, message: string): void {
    this.warnings.push({ line: card.line, text: `line ${card.line}: ${card.where}${message}` });
  }

  private guard(card: Card, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.error(card, errorMessage(e));
    }
  }

  // ------------------------------------------------------------------ include expansion

  private expand(text: string): Card[] {
    const { title, lines } = splitLogicalLines(text, this.opts.fileName, this.opts.hasTitle !== false, (line, message) =>
      this.errors.push({ line, message }),
    );
    if (title !== undefined) this.netlist.title = title;
    const out: Card[] = [];
    this.expandLines(lines, out, undefined, [(this.opts.fileName ?? '').toLowerCase()]);
    return out;
  }

  private expandLines(lines: readonly LogicalLine[], out: Card[], anchor: Card | undefined, stack: readonly string[]): void {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const card: Card = anchor
        ? { text: l.text, line: anchor.line, where: `${l.file ?? '?'}:${l.line}: `, pragma: l.pragma }
        : { text: l.text, line: l.line, where: '', pragma: l.pragma };
      if (l.pragma) {
        out.push(card);
        continue;
      }
      const kw = firstWord(l.text);
      if (kw === '.end') return;
      if (kw === '.control') {
        const j = findCard(lines, i, '.endc');
        this.warn(card, '.control block ignored (interactive simulator commands are not supported)');
        if (j < 0) {
          this.error(card, '.control without a matching .endc');
          return;
        }
        i = j;
        continue;
      }
      if (kw === '.endc') {
        this.warn(card, '.endc without .control ignored');
        continue;
      }
      if (kw === '.endl') continue;
      const from = l.file ?? this.opts.fileName;
      if (kw === '.include' || kw === '.inc') {
        this.guard(card, () => {
          const args = tokenizeCard(l.text).slice(1).filter(isValueTok);
          if (args.length === 0) throw new CardError(`${kw}: missing file name`);
          this.include(card, out, stack, args[0].v, undefined, from);
        });
        continue;
      }
      if (kw === '.lib') {
        let args: Tok[] = [];
        try {
          args = tokenizeCard(l.text).slice(1).filter(isValueTok);
        } catch (e) {
          this.error(card, errorMessage(e));
          continue;
        }
        if (args.length === 0) {
          this.error(card, '.lib: missing file or section name');
          continue;
        }
        if (args.length === 1 && this.resolveFile(args[0].v, from) === undefined) {
          // not a file: a section definition in this text (".lib name ... .endl"), skipped
          const j = findCard(lines, i, '.endl');
          if (j >= 0) {
            i = j;
            continue;
          }
        }
        this.guard(card, () => this.include(card, out, stack, args[0].v, args[1]?.v, from));
        continue;
      }
      out.push(card);
    }
  }

  /**
   * Resolve an include path: relative paths are first tried next to the including file
   * (ngspice rule), then as written.
   */
  private resolveFile(path: string, from: string | undefined): { path: string; content: string } | undefined {
    const resolve = this.opts.resolveInclude;
    if (!resolve) return undefined;
    const dir = from !== undefined && !/^([A-Za-z]:)?[\\/]/.test(path) ? /^(.*)[\\/][^\\/]*$/.exec(from)?.[1] : undefined;
    if (dir !== undefined) {
      const joined = `${dir}/${path}`;
      const content = resolve(joined);
      if (content !== undefined) return { path: joined, content };
    }
    const content = resolve(path);
    return content !== undefined ? { path, content } : undefined;
  }

  private include(
    card: Card,
    out: Card[],
    stack: readonly string[],
    requested: string,
    section: string | undefined,
    from: string | undefined,
  ): void {
    if (!this.opts.resolveInclude) throw new CardError(`cannot read '${requested}': no include file resolver is available`);
    if (stack.length > MAX_INCLUDE_DEPTH) throw new CardError('includes nested too deeply');
    const file = this.resolveFile(requested, from);
    if (!file) throw new CardError(`include file '${requested}' not found`);
    const { path, content } = file;
    const key = path.toLowerCase() + (section ? `#${section.toLowerCase()}` : '');
    if (stack.includes(key)) throw new CardError(`recursive include of '${path}'${section ? ` section ${section}` : ''}`);
    const { lines } = splitLogicalLines(content, path, false, (line, message) => this.error(card, `${path}:${line}: ${message}`));
    let selected: readonly LogicalLine[] = lines;
    if (section !== undefined) {
      const sec = extractSection(lines, section);
      if (!sec) throw new CardError(`section '${section}' not found in '${path}'`);
      selected = sec;
    }
    this.expandLines(selected, out, card, [...stack, key]);
  }

  // ------------------------------------------------------------------ cards

  private processCard(card: Card): void {
    if (card.pragma) {
      this.deferred.push(card);
      return;
    }
    const toks = tokenizeCard(card.text);
    if (toks.length === 0) return;
    const head = toks[0];
    if (head.t !== 'word') throw new CardError(`unexpected '${head.v}' at the start of a card`);
    if (head.v.startsWith('.')) {
      this.dotCard(head.v.slice(1).toLowerCase(), toks, card);
      return;
    }
    // elements a card expands to before its own (CHEBYSHEV filter sections)
    const extra: ElementIR[] = [];
    const ctx: ElementContext = {
      line: card.line,
      isModel: (name) => this.modelNames.has(name.toLowerCase()),
      warn: (message) => this.warn(card, message),
      addElement: (e) => extra.push(e),
    };
    const el = parseElementCard(toks, card.text, ctx);
    // LTspice Rser= / Lser= / Rpar= / Cpar= on V / C / L become explicit elements
    for (const e of [...extra, el, ...splitParasitics(el)]) {
      const key = e.name.toLowerCase();
      if (this.scope.names.has(key)) throw new CardError(`duplicate element name '${e.name}'`);
      this.scope.names.add(key);
      this.scope.elements.push(e);
    }
  }

  private dotCard(cmd: string, toks: readonly Tok[], card: Card): void {
    switch (cmd) {
      case 'model':
        this.model(toks, card);
        return;
      case 'subckt':
        this.subckt(toks, card);
        return;
      case 'ends':
        this.ends(toks, card);
        return;
      case 'param':
      case 'params':
        this.param(toks, card);
        return;
      case 'func':
        this.func(toks, 1, card);
        return;
      case 'global':
        this.global(toks, card);
        return;
      case 'title':
        this.netlist.title = card.text.replace(/^\s*\S+\s*/, '');
        return;
      case 'save':
      case 'probe':
      case 'print':
      case 'plot':
        this.saves(cmd, toks, card);
        return;
      case 'meas':
      case 'measure':
        if (this.scope !== this.top) {
          this.warn(card, `.${cmd} inside a .subckt ignored`);
          return;
        }
        this.deferred.push(card);
        return;
      default:
        break;
    }
    if (DEFERRED_CARDS.has(cmd)) {
      if (this.scope !== this.top) {
        this.warn(card, `.${cmd} is not allowed inside .subckt ${this.scope.def?.name ?? ''}; ignored`);
        return;
      }
      this.deferred.push(card);
      return;
    }
    if (IGNORED_CARDS.has(cmd)) {
      this.warn(card, `.${cmd} is not supported; ignored`);
      return;
    }
    this.warn(card, `unknown control card '.${cmd}' ignored`);
  }

  // ---- models

  private findModel(name: string): ModelCard | undefined {
    const key = name.toLowerCase();
    for (let s: Scope | undefined = this.scope; s; s = s.parent) {
      if (s.models[key]) return s.models[key];
    }
    return undefined;
  }

  private model(toks: readonly Tok[], card: Card): void {
    const nameTok = toks[1];
    if (!nameTok || nameTok.t !== 'word') throw new CardError('.model: missing model name');
    const name = nameTok.v;
    let k = 2;
    let base: ModelCard | undefined;
    let typeTok = toks[k];
    if (typeTok?.t === 'word' && /^ako:/i.test(typeTok.v)) {
      let baseName = typeTok.v.slice(4);
      k++;
      if (baseName === '') {
        const t = toks[k];
        if (!t || t.t !== 'word') throw new CardError(`.model ${name}: missing AKO base model`);
        baseName = t.v;
        k++;
      }
      base = this.findModel(baseName);
      if (!base) throw new CardError(`.model ${name}: AKO base model '${baseName}' must be defined before it`);
      typeTok = toks[k];
    }
    let type: string;
    if (typeTok?.t === 'word' && !isAssign(toks, k)) {
      const upper = typeTok.v.toUpperCase();
      type = Object.hasOwn(MODEL_TYPE_ALIASES, upper) ? MODEL_TYPE_ALIASES[upper] : upper;
      k++;
    } else if (base) {
      type = base.type;
    } else {
      throw new CardError(`.model ${name}: missing model type`);
    }
    const mc: ModelCard = { name, type, params: base ? { ...base.params } : {} };
    const sp: Record<string, string> = base?.stringParams ? { ...base.stringParams } : {};
    while (k < toks.length) {
      const t = toks[k];
      if (t.t === '(' || t.t === ')' || t.t === ',') {
        k++;
        continue;
      }
      if (isAssign(toks, k)) {
        const key = t.v.toLowerCase();
        const v = toks[k + 2];
        if (v?.t === '[') {
          const items: string[] = [];
          let j = k + 3;
          for (; j < toks.length && toks[j].t !== ']'; j++) if (toks[j].t !== ',') items.push(toks[j].v);
          if (j >= toks.length) throw new CardError(`.model ${name}: missing ']' after '${t.v}=['`);
          sp[key] = `[${items.join(' ')}]`;
          delete mc.params[key];
          k = j + 1;
          continue;
        }
        if (!isValueTok(v)) throw new CardError(`.model ${name}: missing value for '${t.v}'`);
        if (v.t === 'brace' || v.t === 'quote') {
          checkExpr(v.v);
          sp[key] = `{${v.v}}`;
          delete mc.params[key];
        } else {
          // no RKM reading here: part names such as 1N914 are literal strings in model cards
          const n = v.t === 'word' ? parseNumberWord(v.v, false) : undefined;
          if (n !== undefined) {
            mc.params[key] = n;
            delete sp[key];
          } else {
            sp[key] = v.v;
            delete mc.params[key];
          }
        }
        k += 3;
        continue;
      }
      if (t.t === 'word') {
        this.warn(card, `.model ${name}: '${t.v}' ignored`);
        k++;
        continue;
      }
      throw new CardError(`.model ${name}: unexpected '${t.v}'`);
    }
    if (Object.keys(sp).length > 0) mc.stringParams = sp;
    const key = name.toLowerCase();
    if (this.scope.models[key]) this.warn(card, `model '${name}' redefined`);
    this.scope.models[key] = mc;
  }

  // ---- subcircuits

  private subckt(toks: readonly Tok[], card: Card): void {
    const nameTok = toks[1];
    if (!nameTok || nameTok.t !== 'word') throw new CardError('.subckt: missing subcircuit name');
    const sub = nameTok.v;
    const ports: string[] = [];
    const params: Record<string, string> = {};
    const setParam = (key: string, t: Tok | undefined) => {
      if (!isValueTok(t)) throw new CardError(`.subckt ${sub}: missing value for parameter '${key}'`);
      if (!IDENT_RE.test(key)) throw new CardError(`.subckt ${sub}: invalid parameter name '${key}'`);
      deleteKeyCI(params, key);
      params[key] = checkExpr(t.v.trim());
    };
    // ports, then sections: PARAMS: (or bare name=value pairs), PSpice OPTIONAL: / TEXT: (ignored)
    let section: 'ports' | 'params' | 'ignored' = 'ports';
    let k = 2;
    while (k < toks.length) {
      const t = toks[k];
      const label = t.t === 'word' ? /^(params|optional|text):(.*)$/i.exec(t.v) : null;
      if (label) {
        const kind = label[1].toLowerCase();
        if (kind === 'params') section = 'params';
        else {
          section = 'ignored';
          this.warn(card, `.subckt ${sub}: ${kind.toUpperCase()}: section ignored`);
        }
        k++;
        if (label[2] !== '' && section === 'params') {
          // "PARAMS:r=1k" glued together
          if (toks[k]?.t !== '=') throw new CardError(`.subckt ${sub}: bad PARAMS: syntax`);
          setParam(label[2], toks[k + 1]);
          k += 2;
        }
        continue;
      }
      if (section === 'ignored') {
        k++;
        continue;
      }
      if (isAssign(toks, k)) {
        section = 'params';
        setParam(t.v, toks[k + 2]);
        k += 3;
        continue;
      }
      if (t.t === ',' || t.t === '(' || t.t === ')') {
        k++;
        continue;
      }
      if (section === 'params') throw new CardError(`.subckt ${sub}: unexpected '${t.v}' in the parameter list`);
      if (t.t !== 'word') throw new CardError(`.subckt ${sub}: invalid port '${t.v}'`);
      ports.push(t.v);
      k++;
    }
    const def: SubcktDef = { name: nameTok.v, ports, params, elements: [], models: {}, subckts: {} };
    const key = def.name.toLowerCase();
    if (this.scope.subckts[key]) this.warn(card, `subcircuit '${def.name}' redefined`);
    this.scope.subckts[key] = def;
    this.scope = {
      def,
      parent: this.scope,
      card,
      elements: def.elements,
      models: def.models,
      subckts: def.subckts,
      names: new Set(),
    };
  }

  private ends(toks: readonly Tok[], card: Card): void {
    const def = this.scope.def;
    if (!def || !this.scope.parent) throw new CardError('.ends without a matching .subckt');
    const given = toks[1];
    if (given && given.v.toLowerCase() !== def.name.toLowerCase()) {
      this.warn(card, `.ends ${given.v} closes .subckt ${def.name}`);
    }
    this.scope = this.scope.parent;
  }

  // ---- parameters and functions

  private param(toks: readonly Tok[], card: Card): void {
    let k = 1;
    if (k >= toks.length) throw new CardError('.param: missing parameter definition');
    while (k < toks.length) {
      const t = toks[k];
      if (t.t === ',') {
        k++;
        continue;
      }
      if (t.t !== 'word') throw new CardError(`.param: expected a parameter name, found '${t.v}'`);
      if (toks[k + 1]?.t === '(') {
        // HSPICE-style function definition: .param f(x) = {x*2}
        this.func(toks, k, card);
        return;
      }
      if (!isAssign(toks, k)) throw new CardError(`.param: expected '${t.v}=<value>'`);
      const start = toks[k + 2];
      let j = k + 2;
      let depth = 0;
      for (; j < toks.length; j++) {
        const u = toks[j];
        if (u.t === '(') depth++;
        else if (u.t === ')') depth--;
        else if (depth === 0 && j > k + 2) {
          if (isAssign(toks, j) && IDENT_RE.test(u.v)) break;
          if (u.t === ',' && isAssign(toks, j + 1)) break;
        }
      }
      const end = j < toks.length ? toks[j].pos : card.text.length;
      const raw = stripExpressionDelimiters(card.text.slice(start.pos, end).trim());
      this.defineParam(t.v, raw, card);
      k = j;
    }
  }

  private defineParam(name: string, raw: string, card: Card): void {
    if (!IDENT_RE.test(name)) throw new CardError(`.param: invalid parameter name '${name}'`);
    if (raw === '') throw new CardError(`.param ${name}: missing value`);
    const num = /\s/.test(raw) ? undefined : parseNumberWord(raw);
    const text = num === undefined ? checkExpr(raw) : raw;
    const def = this.scope.def;
    if (def) {
      deleteKeyCI(def.params, name);
      def.params[name] = text;
      return;
    }
    deleteKeyCI(this.netlist.params, name);
    this.netlist.params[name] = num ?? text;
    this.paramCards.set(name.toLowerCase(), card);
  }

  /** .func name(a, b) [=] body   (k = index of the name token) */
  private func(toks: readonly Tok[], k: number, card: Card): void {
    const nameTok = toks[k];
    if (!nameTok || nameTok.t !== 'word' || !IDENT_RE.test(nameTok.v)) throw new CardError('.func: missing function name');
    if (toks[k + 1]?.t !== '(') throw new CardError(`.func ${nameTok.v}: expected '(' after the name`);
    const args: string[] = [];
    let j = k + 2;
    for (; j < toks.length && toks[j].t !== ')'; j++) {
      const t = toks[j];
      if (t.t === ',') continue;
      if (t.t !== 'word' || !IDENT_RE.test(t.v)) throw new CardError(`.func ${nameTok.v}: invalid argument '${t.v}'`);
      if (args.some((a) => a.toLowerCase() === t.v.toLowerCase())) throw new CardError(`.func ${nameTok.v}: duplicate argument '${t.v}'`);
      args.push(t.v);
    }
    if (j >= toks.length) throw new CardError(`.func ${nameTok.v}: missing ')'`);
    j++;
    if (toks[j]?.t === '=') j++;
    const bodyTok = toks[j];
    if (!bodyTok) throw new CardError(`.func ${nameTok.v}: missing body`);
    const body = checkExpr(stripExpressionDelimiters(card.text.slice(bodyTok.pos)));
    const key = makeFuncKey(nameTok.v, args);
    const table: Record<string, number | string> = this.scope.def ? this.scope.def.params : this.netlist.params;
    const lower = nameTok.v.toLowerCase();
    for (const existing of Object.keys(table)) {
      if (parseFuncKey(existing)?.name.toLowerCase() === lower) delete table[existing];
    }
    table[key] = body;
    if (!this.scope.def) this.paramCards.set(key.toLowerCase(), card);
  }

  private global(toks: readonly Tok[], card: Card): void {
    if (this.scope !== this.top) this.warn(card, '.global inside a .subckt applies to the whole netlist');
    const current = this.netlist.params[GLOBAL_NODES_KEY];
    const names = typeof current === 'string' ? current.split(/\s+/).filter((s) => s !== '') : [];
    for (const t of toks.slice(1)) {
      if (t.t !== 'word') continue;
      if (!names.some((n) => n.toLowerCase() === t.v.toLowerCase())) names.push(t.v);
    }
    if (names.length > 0) this.netlist.params[GLOBAL_NODES_KEY] = names.join(' ');
  }

  private saves(cmd: string, toks: readonly Tok[], card: Card): void {
    if (this.scope !== this.top) {
      this.warn(card, `.${cmd} inside a .subckt ignored`);
      return;
    }
    const { outputs, ignored } = readOutputs(toks, 1, cmd === 'print' || cmd === 'plot');
    if (ignored.length > 0) this.warn(card, `device-internal outputs are not supported: ${ignored.join(' ')}`);
    for (const o of outputs) {
      if (!this.netlist.saves.some((s) => s.toLowerCase() === o.toLowerCase())) this.netlist.saves.push(o);
    }
  }

  // ------------------------------------------------------------------ deferred control cards

  /** Global .param scope (built once, after every .param is known). */
  private paramScope(): ParamScope | undefined {
    if (this.globalScope || this.globalScopeError !== undefined) return this.globalScope;
    try {
      this.globalScope = buildParamScope(this.netlist.params);
    } catch (e) {
      this.globalScopeError = errorMessage(e);
      const card = e instanceof ParamError && e.param ? this.paramCards.get(e.param.toLowerCase()) : undefined;
      if (card) this.error(card, this.globalScopeError);
      else this.errors.push({ line: 1, message: this.globalScopeError });
    }
    return this.globalScope;
  }

  private num(t: Tok): number {
    const v = t.t === 'string' ? { expr: t.v } : tokenValue(t);
    if (!v) throw new CardError(`expected a number, found '${t.v}'`);
    if (v.num !== undefined) return v.num;
    const scope = this.paramScope();
    if (!scope) throw new CardError(`cannot evaluate '${v.expr}': ${this.globalScopeError ?? 'parameters unavailable'}`);
    try {
      return scope.evaluate(v.expr);
    } catch (e) {
      throw new CardError(`cannot evaluate '${v.expr}': ${errorMessage(e)}`);
    }
  }

  /** A number given as text (SPICE number, or an expression of global .param values). */
  private numText(text: string): number {
    const raw = stripExpressionDelimiters(text.trim());
    const n = /\s/.test(raw) ? undefined : parseNumberWord(raw);
    if (n !== undefined) return n;
    const scope = this.paramScope();
    if (!scope) throw new CardError(`cannot evaluate '${raw}': ${this.globalScopeError ?? 'parameters unavailable'}`);
    try {
      return scope.evaluate(raw);
    } catch (e) {
      throw new CardError(`cannot evaluate '${raw}': ${errorMessage(e)}`);
    }
  }

  private processDeferred(card: Card): void {
    if (card.pragma) {
      this.pragma(card);
      return;
    }
    const toks = tokenizeCard(card.text);
    const cmd = toks[0].v.slice(1).toLowerCase();
    const ctx: ControlContext = { num: (t) => this.num(t), warn: (m) => this.warn(card, m) };
    switch (cmd) {
      case 'meas':
      case 'measure': {
        const d = parseMeasCard(card.text, (text) => this.numText(text), card.line);
        const list = (this.netlist.measures ??= []);
        if (list.some((m) => m.name.toLowerCase() === d.name.toLowerCase() && m.analysis === d.analysis)) this.warn(card, `.meas ${d.name} is defined twice; both are evaluated`);
        list.push(d);
        return;
      }
      case 'options':
      case 'option':
      case 'opt': {
        const { options, ignored } = parseOptionsCard(toks, ctx);
        Object.assign(this.netlist.options, options);
        if (ignored.length > 0) this.warn(card, `options ignored: ${ignored.join(', ')}`);
        return;
      }
      case 'temp': {
        const values = parseTempCard(toks, ctx);
        if (this.temps) this.temps.values.push(...values);
        else this.temps = { values, card };
        return;
      }
      case 'ic':
        Object.assign(this.netlist.ic, parseNodeValues(toks, ctx, '.ic'));
        return;
      case 'nodeset':
        Object.assign(this.netlist.nodeset, parseNodeValues(toks, ctx, '.nodeset'));
        return;
      case 'step': {
        const spec = parseStepCard(toks, ctx);
        if (!spec) return;
        if (this.step) {
          this.warn(card, 'only one .step is supported; this one is ignored');
          return;
        }
        this.step = { spec, card };
        return;
      }
      default: {
        const r = parseAnalysisCard(cmd, toks, ctx);
        if (!r.spec) return;
        this.netlist.analyses.push(r.spec);
        if (r.needsAcSweep && r.spec.type === 'noise') this.pendingNoise.push({ spec: r.spec, card });
      }
    }
  }

  private pragma(card: Card): void {
    const m = /^(\S+)\s*([\s\S]*)$/.exec(card.text);
    const kind = m?.[1].toLowerCase() ?? '';
    if (kind !== 'analysis') {
      this.warn(card, `unknown *@machsim pragma '${kind}' ignored`);
      return;
    }
    let spec: unknown;
    try {
      spec = JSON.parse(m?.[2] ?? '');
    } catch (e) {
      throw new CardError(`*@machsim analysis: invalid JSON (${errorMessage(e)})`);
    }
    if (
      typeof spec !== 'object' ||
      spec === null ||
      typeof (spec as { type?: unknown }).type !== 'string' ||
      !ANALYSIS_TYPES.has((spec as { type: AnalysisType }).type)
    ) {
      throw new CardError('*@machsim analysis: not an analysis specification');
    }
    this.netlist.analyses.push(spec as AnalysisSpec);
  }

  private finishAnalyses(): void {
    const n = this.netlist;
    for (const { spec, card } of this.pendingNoise) {
      const ac = n.analyses.find((a) => a.type === 'ac');
      if (!ac || ac.type !== 'ac' || ac.sweep === 'list') {
        this.error(card, '.noise without a frequency sweep needs an .ac dec/oct/lin analysis');
        n.analyses.splice(n.analyses.indexOf(spec), 1);
        continue;
      }
      spec.sweep = ac.sweep;
      spec.points = ac.points;
      spec.fstart = ac.fstart;
      spec.fstop = ac.fstop;
    }
    const step = this.step;
    // a .step of a global parameter re-evaluates the whole netlist per value: it must be the
    // outermost sweep (wrapped after .temp), the other targets wrap first as before
    const wrapStep = () => {
      if (!step) return;
      const { target, values } = step.spec;
      const bases: AnalysisSpec[] = n.analyses.length > 0 ? n.analyses : [{ type: 'op' }];
      n.analyses = bases.map((base): AnalysisSpec => {
        if (target.kind === 'temp') return { type: 'tempsweep', temps: values.slice(), base };
        if (target.kind === 'param') return { type: 'paramsweep', target: target.target, param: 'value', global: true, values: values.slice(), base };
        const spec: AnalysisSpec = { type: 'paramsweep', target: target.target, param: target.param, values: values.slice(), base };
        if (target.kind === 'model') spec.model = true;
        return spec;
      });
    };
    const target = step?.spec.target;
    const globalName = target?.kind === 'param' ? target.target : undefined;
    const globalOk = globalName !== undefined && Object.keys(n.params).some((k) => k.toLowerCase() === globalName.toLowerCase());
    if (step && globalName !== undefined && !globalOk) {
      this.error(step.card, `.step param: parameter '${globalName}' is not defined (add .param ${globalName}=<value>)`);
    } else if (globalName === undefined) wrapStep();
    if (this.temps) {
      const { values } = this.temps;
      if (values.length === 1) n.options.temp = values[0];
      else {
        const bases: AnalysisSpec[] = n.analyses.length > 0 ? n.analyses : [{ type: 'op' }];
        n.analyses = bases.map((base): AnalysisSpec => ({ type: 'tempsweep', temps: values.slice(), base }));
      }
    }
    if (globalOk) wrapStep();
  }

  /**
   * Warn about subcircuits / models that are referenced but defined nowhere in the input, and about
   * subcircuit instance parameters (X1 ... name=value) the subcircuit does not declare: they would
   * be ignored silently (a typo such as "gian=10" for "gain=10").
   */
  private checkReferences(): void {
    const subckts = new Map<string, SubcktDef>();
    const models = new Set(this.modelNames);
    const elements: ElementIR[] = [];
    const collect = (defs: Record<string, SubcktDef>) => {
      for (const d of Object.values(defs)) {
        if (!subckts.has(d.name.toLowerCase())) subckts.set(d.name.toLowerCase(), d);
        elements.push(...d.elements);
        collect(d.subckts);
      }
    };
    elements.push(...this.netlist.elements);
    collect(this.netlist.subckts);
    for (const el of elements) {
      if (!el.model) continue;
      const line = el.line ?? 0;
      const where = el.line !== undefined ? `line ${el.line}: ` : '';
      if (el.type === 'X' && !subckts.has(el.model.toLowerCase())) {
        this.warnings.push({ line, text: `${where}${el.name}: subcircuit '${el.model}' is not defined` });
      } else if (el.type === 'X') {
        const declared = new Set(Object.keys(subckts.get(el.model.toLowerCase())!.params).map((k) => k.toLowerCase()));
        for (const key of Object.keys(el.stringParams ?? {})) {
          if (!declared.has(key.toLowerCase())) this.warnings.push({ line, text: `${where}${el.name}: instance parameter '${key}' is not a parameter of subcircuit '${el.model}' and is ignored` });
        }
      } else if (MODEL_ELEMENT_TYPES.has(el.type) && !models.has(el.model.toLowerCase())) {
        this.warnings.push({ line, text: `${where}${el.name}: model '${el.model}' is not defined` });
      }
    }
  }
}
