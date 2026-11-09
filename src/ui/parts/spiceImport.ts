/**
 * SPICE model import (Tools › Import SPICE model): resolving includes, making the text
 * self-contained, adding it to a design, checking that a model fits a placed part, and a quick test
 * bench per model type. Pure functions; the dialog is SpiceImportDialog.tsx.
 *
 *   resolveModelText(text, fetch)     parse, fetch every missing .include / .lib file (desktop bridge
 *                                     or a file picker) and parse again until nothing new appears
 *   inlineIncludes(text, files)       replace the include cards by the included text (.lib sections cut)
 *   appendCustomSpice(design, text)   add model text to Design.customSpice (skips cards already there)
 *   overrideFits(def, lib, name)      whether `name` can replace the part's model (PartInstance.modelOverride)
 *   quickBench(lib, name)             a small bias circuit for the model + summary of the results
 */
import { applyModelOverride } from '../../model/modelOverride';
import type { Design } from '../../model/types';
import { elementName } from '../../library/partkit';
import type { PartDef } from '../../library/types';
import { defaultParams } from '../../library';
import { findModelCard, findSubckt, normalizeIncludePath, parseModelLibrary, type ModelLibrary } from '../../library/custom/spiceModels';
import { emptyNetlist, type ElementIR, type Netlist } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { parseUserNumber } from '../../util/units';

/** Fetch an include by its normalised path (null = not found / cancelled). */
export type IncludeFetcher = (path: string) => Promise<string | null>;

export interface ResolvedModels {
  lib: ModelLibrary;
  files: Map<string, string>;
  /** includes that could not be fetched */
  unresolved: string[];
}

export async function resolveModelText(text: string, fetch: IncludeFetcher, known: ReadonlyMap<string, string> = new Map()): Promise<ResolvedModels> {
  const files = new Map(known);
  const failed = new Set<string>();
  let lib = parseModelLibrary(text, { files });
  for (let round = 0; round < 12; round++) {
    const todo = lib.missing.filter((m) => !failed.has(m) && !files.has(m));
    if (todo.length === 0) break;
    for (const path of todo) {
      const content = await fetch(path);
      if (content === null) failed.add(path);
      else files.set(path, content);
    }
    lib = parseModelLibrary(text, { files });
  }
  // a path counts as unresolved only when none of its spellings were found
  const unresolved = lib.missing.filter((m) => !files.has(m));
  return { lib, files, unresolved };
}

const INCLUDE_RE = /^\s*\.(include|inc|lib)\s+("[^"]+"|'[^']+'|\S+)(?:\s+(\S+))?\s*$/i;

/** Lines of `.lib <section>` … `.endl` in `text` (undefined when the section is not there). */
function libSection(text: string, section: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    const m = /^\s*\.(lib|endl)\b\s*(\S*)/i.exec(line);
    if (m && m[1].toLowerCase() === 'lib' && !inside && m[2].toLowerCase() === section.toLowerCase()) {
      inside = true;
      continue;
    }
    if (m && m[1].toLowerCase() === 'endl' && inside) return out.join('\n');
    if (inside) out.push(line);
  }
  return inside ? out.join('\n') : undefined;
}

/** Replace include cards by the text of the included files (recursive; unknown files stay as they are). */
export function inlineIncludes(text: string, files: ReadonlyMap<string, string>, depth = 0, dir = ''): string {
  if (depth > 10) return text;
  return text
    .split(/\r?\n/)
    .map((line) => {
      const m = INCLUDE_RE.exec(line);
      if (!m) return line;
      const kind = m[1].toLowerCase();
      // ".lib name" without a file (a section header inside the text) is not an include
      if (kind === 'lib' && m[3] === undefined && !/[./\\]/.test(m[2])) return line;
      const raw = m[2].replace(/^["']|["']$/g, '');
      const key = normalizeIncludePath(raw);
      const joined = dir ? normalizeIncludePath(`${dir}/${raw}`) : key;
      const path = files.has(joined) ? joined : files.has(key) ? key : undefined;
      if (path === undefined) return line;
      const sub = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      let body = files.get(path)!;
      if (kind === 'lib' && m[3] !== undefined) {
        const sec = libSection(body, m[3]);
        if (sec === undefined) return line;
        body = sec;
      }
      return `* ---- ${raw}${m[3] ? ` (${m[3]})` : ''}\n${inlineIncludes(body, files, depth + 1, sub)}\n* ---- /${raw}`;
    })
    .join('\n');
}

/**
 * Add model text to the design's Custom SPICE. Cards whose names are already defined there are
 * left out (the existing definition is kept); returns the names added and skipped.
 */
export function appendCustomSpice(design: Design, text: string, title = ''): { design: Design; added: string[]; skipped: string[] } {
  const existing = parseModelLibrary(design.customSpice ?? '');
  const incoming = parseModelLibrary(text);
  const have = new Set([...existing.models.map((m) => m.name.toLowerCase()), ...existing.subckts.map((s) => s.name.toLowerCase())]);
  const names = [...incoming.subckts.map((s) => s.name), ...incoming.models.map((m) => m.name)];
  const added = names.filter((n) => !have.has(n.toLowerCase()));
  const skipped = names.filter((n) => have.has(n.toLowerCase()));
  if (added.length === 0) return { design, added, skipped };
  const head = title ? `* ${title}\n` : '';
  const prev = (design.customSpice ?? '').trimEnd();
  return { design: { ...design, customSpice: `${prev ? `${prev}\n\n` : ''}${head}${text.trim()}\n` }, added, skipped };
}

/** True when `name` from `lib` can replace the model of parts of `def` (same rule as the netlister). */
export function overrideFits(def: PartDef, lib: Pick<ModelLibrary, 'models' | 'subckts'>, name: string): boolean {
  if (!def.toSpice) return false;
  const params = defaultParams(def);
  try {
    const frag = def.toSpice({
      refdes: 'U1',
      params,
      node: (pin) => `n_${pin}`,
      num: (key) => {
        const v = parseUserNumber(params[key] ?? '');
        if (Number.isFinite(v)) return v;
        throw new Error(`bad value for ${key}`);
      },
      name: (type, suffix) => elementName(type, 'U1', suffix),
    });
    return !applyModelOverride(frag, name, { model: (n) => findModelCard(lib, n), subckt: (n) => findSubckt(lib, n) }).problem;
  } catch {
    // parts whose defaults need the full netlister context: decide by the model kind alone
    return false;
  }
}

export interface QuickBench {
  netlist: Netlist;
  /** what to read: label (i18n key under parts.bench.*) and vector */
  reads: { key: string; vector: string; unit: string }[];
}

const v = (name: string, p: string, n: string, dc: number): ElementIR => ({ type: 'V', name, nodes: [p, n], params: {}, source: { dc } });
const i = (name: string, p: string, n: string, dc: number): ElementIR => ({ type: 'I', name, nodes: [p, n], params: {}, source: { dc } });
const r = (name: string, a: string, b: string, value: number): ElementIR => ({ type: 'R', name, nodes: [a, b], value, params: {} });

/**
 * A small operating-point bench for one model: diode 1 mA forward; BJT with 10 µA base current at
 * VCE = 5 V; MOSFET VGS = VDS = 5 V; JFET VGS = 0, VDS = 5 V; subcircuit ports k of n through 1 kΩ to
 * (n − k) V. Polarity follows the model type.
 */
export function quickBench(lib: Pick<ModelLibrary, 'models' | 'subckts'>, name: string): QuickBench | undefined {
  const nl = emptyNetlist(name);
  for (const m of lib.models) nl.models[m.name.toLowerCase()] = m;
  for (const s of lib.subckts) nl.subckts[s.name.toLowerCase()] = s;
  nl.analyses = [{ type: 'op' }];
  const sub = findSubckt(lib, name);
  if (sub) {
    const n = sub.ports.length;
    sub.ports.forEach((_p, k) => nl.elements.push(r(`RB${k}`, `p${k}`, `s${k}`, 1e3), v(`VB${k}`, `s${k}`, '0', n - k)));
    nl.elements.push({ type: 'X', name: 'XDUT', nodes: sub.ports.map((_p, k) => `p${k}`), model: sub.name, params: {} });
    return { netlist: nl, reads: sub.ports.map((p, k) => ({ key: p, vector: `V(p${k})`, unit: 'V' })) };
  }
  const card = findModelCard(lib, name);
  if (!card) return undefined;
  const t = card.type.toUpperCase();
  const neg = t === 'PNP' || t === 'PMOS' || t === 'PJF' || t === 'PMF';
  const s = neg ? -1 : 1;
  switch (t) {
    case 'D':
      nl.elements.push(i('IF', '0', 'a', 1e-3), { type: 'D', name: 'DDUT', nodes: ['a', '0'], model: card.name, params: {} });
      return { netlist: nl, reads: [{ key: 'vf', vector: 'V(a)', unit: 'V' }] };
    case 'NPN':
    case 'PNP':
      nl.elements.push(v('VC', 'c', '0', 5 * s), i('IB', neg ? 'b' : '0', neg ? '0' : 'b', 10e-6), { type: 'Q', name: 'QDUT', nodes: ['c', 'b', '0'], model: card.name, params: {} });
      return { netlist: nl, reads: [{ key: 'vbe', vector: 'V(b)', unit: 'V' }, { key: 'ic', vector: 'I(VC)', unit: 'A' }] };
    case 'NMOS':
    case 'PMOS':
      nl.elements.push(v('VD', 'd', '0', 5 * s), v('VG', 'g', '0', 5 * s), { type: 'M', name: 'MDUT', nodes: ['d', 'g', '0', '0'], model: card.name, params: {} });
      return { netlist: nl, reads: [{ key: 'id', vector: 'I(VD)', unit: 'A' }] };
    case 'NJF':
    case 'PJF':
    case 'NMF':
    case 'PMF':
      nl.elements.push(v('VD', 'd', '0', 5 * s), v('VG', 'g', '0', 0), { type: t.endsWith('MF') ? 'Z' : 'J', name: `${t.endsWith('MF') ? 'Z' : 'J'}DUT`, nodes: ['d', 'g', '0'], model: card.name, params: {} });
      return { netlist: nl, reads: [{ key: 'id', vector: 'I(VD)', unit: 'A' }] };
    default:
      return undefined;
  }
}

export interface BenchReading {
  key: string;
  value: number;
  unit: string;
}

/** Values of a quick bench run, or the simulator's error. */
export function readBench(b: QuickBench, results: AnalysisResult[]): { ok: true; readings: BenchReading[] } | { ok: false; error: string } {
  const res = results[0];
  if (!res) return { ok: false, error: '?' };
  if (res.error) return { ok: false, error: res.error };
  const readings: BenchReading[] = [];
  for (const rd of b.reads) {
    const vec = res.vectors.find((x) => x.name.toLowerCase() === rd.vector.toLowerCase());
    if (vec) readings.push({ key: rd.key, value: vec.re[vec.re.length - 1], unit: rd.unit });
  }
  return { ok: true, readings };
}
