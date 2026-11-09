/**
 * Facts about a library part for the "Select a component" dialog and its Detail report (pure; the
 * UI translates the labels):
 *
 *   partDatabaseOf(def)       'master' (built-in, read-only), 'corporate', 'user' or 'design' (a user
 *                             component only embedded in the open design)
 *   modelInfo(def)            what simulates the part: kind (none / primitive / model / subcircuit /
 *                             behavioural / code model / instrument), model id, manufacturer
 *   partDetails(def)          the dialog's detail fields: Function, Model manufacturer / ID, Package
 *                             manufacturer / type, Hyperlink (a web link for user components that
 *                             have one, else the in-app help page), provenance
 *   partModelText(def)        the SPICE listing behind the part (.model / .subckt cards and the
 *                             element cards with the pin names as nodes); `editable` only for a user
 *                             component's own SPICE text
 *   partDetailReport(def)     everything above plus pins, parameters and specifications, as data
 *
 * Model manufacturer: the vendor named in the provenance when the model follows a vendor's
 * published model ("Philips/NXP published BC547B model"), else MachSim (models fitted by MachSim
 * to public datasheet figures, and the generic parts). Package manufacturer: a user component's
 * user field (manufacturer / nhà sản xuất), else generic (industry-standard outline names).
 */
import { isBuiltinPart, runtimeParts } from './index';
import type { PartDef } from './types';
import { asLibraryPart } from './partkit';
import { partFragment, pinNodes } from './partFingerprint';
import { isCustomPartDef, parsedModelText } from './custom/partDef';
import { findSubckt } from './custom/spiceModels';
import { partSpecs } from './specs';
import { emptyNetlist, type ElementIR } from '../sim/netlist';
import { writeSpice } from '../sim/spice/writer';

export type PartDatabaseKind = 'master' | 'corporate' | 'user' | 'design';

/** Which database a part comes from. */
export function partDatabaseOf(def: Pick<PartDef, 'id'>): PartDatabaseKind {
  if (isBuiltinPart(def.id)) return 'master';
  if (runtimeParts('db:user').some((p) => p.id === def.id)) return 'user';
  if (runtimeParts('db:corporate').some((p) => p.id === def.id)) return 'corporate';
  return 'design';
}

export type ModelKind = 'none' | 'primitive' | 'model' | 'subcircuit' | 'behavioral' | 'code-model' | 'instrument';

export interface ModelInfo {
  kind: ModelKind;
  /** model / subcircuit name, code-model type or element letters ('' for none) */
  id: string;
  /** SPICE model type (D, NPN, NMOS …) of a .model card */
  type?: string;
  /** who made the model: a vendor named in the provenance, else 'MachSim' ('' for none) */
  manufacturer: string;
}

/** Vendors whose published models some parts follow (matched in the provenance text). */
const VENDORS = ['Philips/NXP', 'NXP', 'Philips', 'Texas Instruments', 'ON Semiconductor', 'onsemi', 'Fairchild', 'Motorola', 'STMicroelectronics', 'Vishay', 'Infineon', 'International Rectifier', 'Analog Devices', 'Linear Technology', 'Microchip', 'Diodes Incorporated', 'Toshiba', 'Rohm', 'Nexperia', 'National Semiconductor', 'Renesas', 'Burr-Brown', 'Zetex'];

/** The vendor of a published model named in a provenance text, if any. */
export function vendorOf(provenance: string | undefined): string | undefined {
  if (!provenance || !/\bpublished\b|\bmanufacturer\b|\bvendor\b/i.test(provenance)) return undefined;
  return VENDORS.find((v) => provenance.includes(v));
}

const elementKinds = (els: readonly ElementIR[]) => [...new Set(els.map((e) => e.type))].join(' ');

/** What simulates a part (see ModelKind). */
export function modelInfo(def: PartDef): ModelInfo {
  const lib = asLibraryPart(def);
  if (def.instrument) return { kind: 'instrument', id: def.instrument, manufacturer: 'MachSim' };
  if (!def.toSpice || lib.annotation) return { kind: 'none', id: '', manufacturer: '' };
  const manufacturer = vendorOf(def.provenance) ?? (isCustomPartDef(def) && def.custom.model.kind === 'spice' ? (def.custom.author ?? '') : 'MachSim');
  if (isCustomPartDef(def) && def.custom.model.kind === 'spice') {
    const m = def.custom.model;
    const sub = findSubckt(parsedModelText(m.text), m.name);
    return { kind: sub ? 'subcircuit' : 'model', id: m.name, manufacturer: manufacturer || 'MachSim' };
  }
  const frag = partFragment(def);
  if (!frag) return { kind: 'primitive', id: '', manufacturer };
  const sub = frag.subckts?.[0];
  if (sub) return { kind: 'subcircuit', id: sub.name, manufacturer };
  const card = frag.models?.[0];
  const code = frag.elements.find((e) => e.type === 'A');
  if (card && !code) return { kind: 'model', id: card.name, type: card.type, manufacturer };
  if (code) return { kind: 'code-model', id: card ? card.type : (code.model ?? 'A'), manufacturer };
  if (frag.elements.some((e) => e.type === 'B')) return { kind: 'behavioral', id: elementKinds(frag.elements), manufacturer };
  return { kind: 'primitive', id: elementKinds(frag.elements), manufacturer };
}

export type PartHyperlink = { kind: 'url'; url: string } | { kind: 'help' };

export interface PartDetails {
  id: string;
  name: string;
  group: string;
  family: string;
  prefix: string;
  database: PartDatabaseKind;
  /** Function: the part's description */
  function: string;
  model: ModelInfo;
  /** package type (footprint / package spec) and its manufacturer ('' = generic outline) */
  packageType: string;
  packageManufacturer: string;
  hyperlink: PartHyperlink;
  provenance?: string;
}

/** A user component's user field by one of several names (case-insensitive). */
function userField(def: PartDef, names: string[]): string {
  if (!isCustomPartDef(def)) return '';
  for (const [k, v] of Object.entries(def.custom.fields ?? {})) if (names.includes(k.trim().toLowerCase()) && v.trim()) return v.trim();
  return '';
}

/** The detail fields of the Select-a-component dialog. */
export function partDetails(def: PartDef): PartDetails {
  const specs = partSpecs(def);
  const pkg = def.footprint ?? (typeof specs.package === 'string' ? specs.package : '');
  const link = def.hyperlink?.trim();
  return {
    id: def.id,
    name: def.name,
    group: def.group,
    family: def.family || 'General',
    prefix: def.prefix,
    database: partDatabaseOf(def),
    function: def.description,
    model: modelInfo(def),
    packageType: pkg,
    packageManufacturer: pkg ? userField(def, ['package manufacturer', 'nhà sản xuất vỏ', 'nha san xuat vo', 'manufacturer', 'nhà sản xuất', 'nha san xuat', 'mfr']) : '',
    hyperlink: link && /^https?:\/\//i.test(link) ? { kind: 'url', url: link } : { kind: 'help' },
    ...(def.provenance ? { provenance: def.provenance } : {}),
  };
}

export interface ModelText {
  /** the listing ('' when the part has no simulation model) */
  text: string;
  /** a user component's own SPICE text (may be edited and saved back to its database) */
  editable: boolean;
  /** 'none' (drawing only / no model), 'listing' (generated from the part), 'user' (the user's text) */
  source: 'none' | 'listing' | 'user';
}

/**
 * The SPICE text behind a part: a user component's own model text, or a listing generated from the
 * part with its default values (cards, then the elements one instance produces, nodes named after
 * the pins). Read-only for built-in parts.
 */
export function partModelText(def: PartDef): ModelText {
  if (isCustomPartDef(def) && def.custom.model.kind === 'spice') return { text: def.custom.model.text, editable: true, source: 'user' };
  const frag = asLibraryPart(def).annotation ? null : partFragment(def);
  if (!frag) return { text: '', editable: false, source: 'none' };
  const n = emptyNetlist(`* ${def.name} (${def.id})`);
  for (const m of frag.models ?? []) n.models[m.name.toLowerCase()] = m;
  for (const s of frag.subckts ?? []) n.subckts[s.name.toLowerCase()] = s;
  n.elements = frag.elements;
  const nodes = pinNodes(def);
  const pinLine = `* pins: ${def.symbol.pins.map((p) => `${p.name}=${nodes.get(p.name)}`).join(' ')}`;
  let text: string;
  try {
    text = writeSpice(n);
  } catch {
    return { text: '', editable: false, source: 'none' };
  }
  const lines = text.split(/\r?\n/);
  lines.splice(1, 0, pinLine, ...(def.provenance ? [`* model: ${def.provenance}`] : []));
  return { text: lines.join('\n'), editable: false, source: 'listing' };
}

export interface DetailReport {
  details: PartDetails;
  pins: { name: string; number: string; type: string; label: string }[];
  params: { key: string; label: string; default: string; unit: string; kind: string; options: string[] }[];
  specs: [string, number | string][];
  model: ModelText;
  keywords: string[];
  series?: string;
}

/** Everything the Detail report shows about a part (as data; see the module header). */
export function partDetailReport(def: PartDef): DetailReport {
  const lib = asLibraryPart(def);
  return {
    details: partDetails(def),
    pins: def.symbol.pins.map((p, i) => ({ name: p.name, number: p.number ?? String(i + 1), type: p.type ?? 'passive', label: p.label ?? '' })),
    params: def.params.map((p) => ({ key: p.key, label: p.label, default: p.default, unit: p.unit ?? '', kind: p.kind, options: (p.options ?? []).map((o) => o.value) })),
    specs: Object.entries(partSpecs(def)),
    model: partModelText(def),
    keywords: [...(def.keywords ?? [])],
    ...(lib.series ? { series: lib.series } : {}),
  };
}
