/**
 * Shared helpers of the generated part catalogue (src/library/catalog/*).
 *
 * The catalogue turns compact data tables (one row per real part number: datasheet ratings and
 * typical characteristics) into ordinary LibraryPartDefs through per-family generators. Every
 * generated part
 *   - has an id '<group>/<slug>' and the part number (or value) as its name;
 *   - carries an English description plus a Vietnamese one (`textVi`), written by the generator
 *     from the same numbers, so the translation test covers thousands of parts without a table;
 *   - lists its parametric data in `specs` (browser filters, src/library/specs.ts) and a
 *     `sortKey` (nominal value / voltage) so families list in a natural order;
 *   - names its built-in model "MS_<part number>" and states in `provenance` which datasheet
 *     figures the model was fitted to (no vendor model files are copied).
 */
import { formatEng, toSpiceNumber } from '../../util/units';
import { sanitizeName, textParam, boolParam, type LibraryPartDef, type PartSpecs } from '../partkit';
import type { ParamDef } from '../types';

/** User-number text of a value ("4.7k", "100n", "2.2M"). */
export function userNum(v: number): string {
  const s = toSpiceNumber(Number(v.toPrecision(6)));
  return s.replace(/meg$/i, 'M');
}

/** Engineering text with unit and up to 3 significant digits ("4.7 kΩ", "100 nF"). */
export function eng(v: number, unit = '', digits = 3): string {
  return formatEng(v, unit, digits);
}

/** Built-in model / subcircuit name of a part number. */
export function modelName(pn: string, suffix = ''): string {
  return `MS_${sanitizeName(pn.toUpperCase())}${suffix ? `_${suffix}` : ''}`;
}

/** Id slug of a part number ("BC337-40" -> "bc337-40", "1.5KE6.8A" -> "1.5ke6.8a"). */
export function slug(pn: string): string {
  return pn
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

let modelParamDef: ParamDef | null = null;
/** The shared "SPICE model override" parameter (same wording as the hand-written parts). */
export function modelOverrideParam(): ParamDef {
  modelParamDef ??= textParam('model', 'SPICE model override', '', { group: 'model', help: 'Name of a user-imported .model to use instead of the built-in one (blank = built-in)' });
  return modelParamDef;
}

/** Bool param that switches burn-out on for rated parts. */
export function burnParam(def: boolean): ParamDef {
  return boolParam('burn', 'Burn out when overloaded', def, {
    group: 'advanced',
    help: 'When on, the part opens (burns out) as soon as a rating is exceeded during simulation, and the messages explain why',
  });
}

/** Thermal time-constant param of rated parts (power ratings). */
export function tauParam(def = '10m'): ParamDef {
  return { key: 'tau', label: 'Thermal time constant', default: def, kind: 'number', unit: 's', group: 'advanced', min: 0, help: 'How fast the part heats up: the power is averaged over this time before it is compared with the rating' };
}

export interface CatalogFields {
  specs?: PartSpecs;
  vi: string;
  nameVi?: string;
  sortKey?: number;
  series?: string;
}

/** Attach the catalogue metadata to a part definition. */
export function withMeta(p: Omit<LibraryPartDef, 'textVi'>, m: CatalogFields): LibraryPartDef {
  const out: LibraryPartDef = { ...p, textVi: m.nameVi ? { name: m.nameVi, description: m.vi } : { description: m.vi } };
  if (m.specs) out.specs = m.specs;
  if (m.sortKey !== undefined) out.sortKey = m.sortKey;
  if (m.series) out.series = m.series;
  return out;
}

/** Remove parts whose id already exists (hand-written parts win) and duplicates inside a list. */
export function dedupe(parts: LibraryPartDef[], existing: ReadonlySet<string>): LibraryPartDef[] {
  const seen = new Set(existing);
  const out: LibraryPartDef[] = [];
  for (const p of parts) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}
