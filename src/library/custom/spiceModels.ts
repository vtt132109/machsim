/**
 * SPICE model libraries for user components: read `.model` / `.subckt` text (pasted, opened from a
 * `.lib` / `.mod` / `.cir` file, or written by a model maker), list what it defines, find the cards
 * a model depends on, and say which terminals a model has.
 *
 *   parseModelLibrary(text, { files })  -> ModelLibrary (models, subcircuits, errors, missing includes)
 *   modelEntries(lib)                    -> one ModelEntry per top-level card (for pickers)
 *   modelTerminals(lib, name)            -> terminal names in SPICE order (undefined: unusable)
 *   modelDependencies(lib, name)         -> the cards to emit for `name` (itself + what it uses)
 *   autoMapPins(terminals, symbolPins)   -> a symbol pin per terminal (by name, then by order)
 *
 * Includes: `.include` / `.lib file [section]` are resolved through `files`, a map of file text by
 * normalised path relative to the main text's folder (`normalizeIncludePath`). Paths that are not in
 * the map are reported in `missing`, so the UI can fetch them (desktop bridge or an open dialog) and
 * parse again; nested includes resolve relative to the including file first (ngspice rule).
 */
import type { ElementType, ModelCard, SubcktDef } from '../../sim/netlist';
import { parseSpice, type SpiceParseError } from '../../sim/spice/parser';

/** Element type and terminal names (SPICE node order) of every device model type a part can use. */
export const DEVICE_TERMINALS: Readonly<Record<string, { element: ElementType; terminals: readonly string[] }>> = {
  D: { element: 'D', terminals: ['A', 'K'] },
  NPN: { element: 'Q', terminals: ['C', 'B', 'E'] },
  PNP: { element: 'Q', terminals: ['C', 'B', 'E'] },
  NMOS: { element: 'M', terminals: ['D', 'G', 'S', 'B'] },
  PMOS: { element: 'M', terminals: ['D', 'G', 'S', 'B'] },
  NJF: { element: 'J', terminals: ['D', 'G', 'S'] },
  PJF: { element: 'J', terminals: ['D', 'G', 'S'] },
  NMF: { element: 'Z', terminals: ['D', 'G', 'S'] },
  PMF: { element: 'Z', terminals: ['D', 'G', 'S'] },
};

export interface ModelLibrary {
  models: ModelCard[];
  subckts: SubcktDef[];
  errors: SpiceParseError[];
  warnings: string[];
  /** include paths (normalised) that were requested but are not in `files` */
  missing: string[];
  /** number of element / analysis cards outside any subcircuit (ignored for a model library) */
  ignoredCards: number;
}

export interface ModelEntry {
  name: string;
  kind: 'model' | 'subckt';
  /** model type (D, NPN, NMOS, ...) or 'SUBCKT' */
  type: string;
  /** terminal names (device terminals or subcircuit ports); empty when the type cannot be used by a part */
  terminals: string[];
  /** subcircuit default parameters (PARAMS:) */
  params: Record<string, string>;
}

/** Normalise an include path: forward slashes, no leading "./", lower case. */
export function normalizeIncludePath(path: string): string {
  let p = path.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  while (p.startsWith('./')) p = p.slice(2);
  return p.toLowerCase();
}

/** Parse model text. `files` holds included files by normalised path. Never throws. */
export function parseModelLibrary(text: string, opts: { files?: ReadonlyMap<string, string>; fileName?: string } = {}): ModelLibrary {
  const files = opts.files ?? new Map<string, string>();
  const missing: string[] = [];
  const res = parseSpice(text, {
    hasTitle: false,
    fileName: opts.fileName ?? 'model',
    resolveInclude: (path) => {
      const key = normalizeIncludePath(path);
      const hit = files.get(key);
      if (hit === undefined && !missing.includes(key)) missing.push(key);
      return hit;
    },
  });
  const nl = res.netlist;
  // a missing nested file is first tried next to its parent: keep only names still missing
  const stillMissing = missing.filter((m) => !files.has(m));
  return {
    models: Object.values(nl.models),
    subckts: Object.values(nl.subckts),
    errors: res.errors,
    warnings: res.warnings,
    missing: stillMissing,
    ignoredCards: nl.elements.length + nl.analyses.length,
  };
}

/** One entry per top-level card, subcircuits first, each group sorted by name. */
export function modelEntries(lib: ModelLibrary): ModelEntry[] {
  const subs: ModelEntry[] = lib.subckts.map((s) => ({ name: s.name, kind: 'subckt', type: 'SUBCKT', terminals: [...s.ports], params: { ...s.params } }));
  const models: ModelEntry[] = lib.models.map((m) => ({ name: m.name, kind: 'model', type: m.type.toUpperCase(), terminals: [...(DEVICE_TERMINALS[m.type.toUpperCase()]?.terminals ?? [])], params: {} }));
  const byName = (a: ModelEntry, b: ModelEntry) => a.name.localeCompare(b.name);
  return [...subs.sort(byName), ...models.sort(byName)];
}

export function findModelCard(lib: Pick<ModelLibrary, 'models'>, name: string): ModelCard | undefined {
  const n = name.toLowerCase();
  return lib.models.find((m) => m.name.toLowerCase() === n);
}

export function findSubckt(lib: Pick<ModelLibrary, 'subckts'>, name: string): SubcktDef | undefined {
  const n = name.toLowerCase();
  return lib.subckts.find((s) => s.name.toLowerCase() === n);
}

/** Terminals of a card in SPICE order, or undefined when no such card / the type has no part form. */
export function modelTerminals(lib: Pick<ModelLibrary, 'models' | 'subckts'>, name: string): string[] | undefined {
  const s = findSubckt(lib, name);
  if (s) return [...s.ports];
  const m = findModelCard(lib, name);
  const dev = m ? DEVICE_TERMINALS[m.type.toUpperCase()] : undefined;
  return dev ? [...dev.terminals] : undefined;
}

/**
 * The top-level cards needed to simulate `name`: the card itself plus every top-level model or
 * subcircuit its elements reference (recursively; definitions local to a subcircuit shadow
 * top-level ones). Unknown references are left for the netlister's undefined-model check.
 */
export function modelDependencies(lib: Pick<ModelLibrary, 'models' | 'subckts'>, name: string): { models: ModelCard[]; subckts: SubcktDef[] } {
  const models = new Map<string, ModelCard>();
  const subckts = new Map<string, SubcktDef>();
  const visitSub = (s: SubcktDef, scope: { models: Set<string>; subckts: Set<string> }) => {
    const local = {
      models: new Set([...scope.models, ...Object.keys(s.models).map((k) => k.toLowerCase())]),
      subckts: new Set([...scope.subckts, ...Object.keys(s.subckts).map((k) => k.toLowerCase())]),
    };
    for (const inner of Object.values(s.subckts)) visitSub(inner, local);
    for (const el of s.elements) {
      if (!el.model) continue;
      const ref = el.model.toLowerCase();
      if (el.type === 'X') {
        if (local.subckts.has(ref)) continue;
        addSub(ref);
      } else if (!local.models.has(ref)) addModel(ref);
    }
  };
  const addModel = (ref: string) => {
    if (models.has(ref)) return;
    const m = findModelCard(lib, ref);
    if (m) models.set(ref, m);
  };
  const addSub = (ref: string) => {
    if (subckts.has(ref)) return;
    const s = findSubckt(lib, ref);
    if (!s) return;
    subckts.set(ref, s);
    visitSub(s, { models: new Set(), subckts: new Set() });
  };
  const key = name.toLowerCase();
  if (findSubckt(lib, key)) addSub(key);
  else addModel(key);
  return { models: [...models.values()], subckts: [...subckts.values()] };
}

/** Synonyms used to match model terminals to symbol pins by name. */
const PIN_SYNONYMS: string[][] = [
  ['a', 'anode', '+', 'p', '1'],
  ['k', 'cathode', '-', '2'],
  ['in+', 'inp', '+in', 'non', 'noninv', 'in_p', 'vinp', 'p'],
  ['in-', 'inn', '-in', 'inv', 'in_n', 'vinn', 'n'],
  ['out', 'o', 'output', 'vout'],
  ['v+', 'vcc', 'vdd', 'vp', 'vs+', 'v_p', 'pos'],
  ['v-', 'vee', 'vss', 'vn', 'vs-', 'v_n', 'neg', 'gnd'],
];

function canon(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Suggest a symbol pin for every terminal: exact (case-insensitive) names first, then synonyms
 * (anode / A, IN+ / INP, VCC / V+ ...), then the remaining pins in order. '' = no pin left.
 */
export function autoMapPins(terminals: readonly string[], symbolPins: readonly string[]): string[] {
  const free = new Set(symbolPins);
  const out: string[] = terminals.map(() => '');
  const take = (i: number, pin: string) => {
    out[i] = pin;
    free.delete(pin);
  };
  terminals.forEach((term, i) => {
    const hit = symbolPins.find((p) => free.has(p) && canon(p) === canon(term));
    if (hit) take(i, hit);
  });
  terminals.forEach((term, i) => {
    if (out[i]) return;
    const group = PIN_SYNONYMS.find((g) => g.includes(canon(term)));
    if (!group) return;
    const hit = symbolPins.find((p) => free.has(p) && group.includes(canon(p)));
    if (hit) take(i, hit);
  });
  terminals.forEach((_term, i) => {
    if (out[i]) return;
    const next = symbolPins.find((p) => free.has(p));
    if (next) take(i, next);
  });
  return out;
}
