/**
 * File > File information: what a design contains (pure; the dialog adds the file path, size and
 * dates from the file system and localises the names).
 *
 *   designInfo(design, lookup) -> DesignInfo
 *
 * Counts cover the root sheets and every child design (subcircuits / hierarchical blocks): sheets,
 * placed parts by library group and family (blocks, instruments and ground / power symbols counted
 * separately as well), wires and buses, net labels and connectors, probes, notes, shapes, nets of
 * the netlister (ground included, every hierarchy level), global parameters, embedded user
 * components, custom SPICE models / subcircuits, and the ladder sheets with their rungs, rung
 * elements (contacts and comparisons), coils / timers / counters and the distinct PLC addresses
 * they use. Restrictions report which instructor limits are set; the simulation profile
 * summarises analyses, options, digital and interactive settings.
 */
import type { PartDef } from '../library/types';
import { buildNetlist } from './netlister';
import { isBlockPartId, resolvePart } from './hierarchy';
import type { AnalysisType, SimOptions } from '../sim/netlist';
import type { Design, DesignMeta, InstrumentKind, Sheet } from './types';
import type { LadderNode, LadderRung } from '../ladder/types';

export interface FamilyCount {
  group: string;
  family: string;
  count: number;
}

/** What the ladder sheets of a design hold (File information). */
export interface LadderInfo {
  /** sheets whose kind is 'ladder' */
  sheets: number;
  rungs: number;
  /** rungs kept in the file but skipped by the scan */
  disabled: number;
  /** contacts and comparison contacts, over every rung */
  contacts: number;
  /** coils, timers and counters on the right rail */
  outputs: number;
  /** distinct PLC locations the rungs use (I0.0, Q0.1, T1 …; T1 and T1.ET are one) */
  addresses: number;
}

export interface DesignInfo {
  title: string;
  /** format version of the file (after migration) */
  version: number;
  meta: DesignMeta;
  sheets: { root: number; child: number; total: number };
  childDesigns: { subcircuits: number; hierarchical: number };
  parts: {
    /** every placed part, blocks, instruments and ground / power symbols included */
    total: number;
    /** parts that take part in the simulation (not excluded, not instruments, not symbols) */
    components: number;
    blocks: number;
    instruments: number;
    /** ground and power symbols */
    symbols: number;
    excludedFromSim: number;
    unknown: number;
    byFamily: FamilyCount[];
  };
  instrumentKinds: InstrumentKind[];
  wires: number;
  buses: number;
  labels: number;
  connectors: number;
  probes: number;
  notes: number;
  shapes: number;
  /** nets of the netlist (ground included), -1 when the netlister could not run */
  nets: number;
  variables: number;
  customParts: number;
  /** .model / .subckt cards of the design's custom SPICE text */
  customModels: number;
  faults: number;
  restrictions: {
    present: boolean;
    hideValues: boolean;
    lockParts: boolean;
    lockedParts: number;
    disabledAnalyses: AnalysisType[];
    disabledInstruments: InstrumentKind[];
    lockDescription: boolean;
    hideAnswers: boolean;
  };
  simulation: {
    active: AnalysisType;
    /** analyses with saved settings, the active one first */
    analyses: AnalysisType[];
    /** simulator options set in the design (Simulate > Analysis settings > Options) */
    options: (keyof SimOptions)[];
    digitalMode: 'auto' | 'ideal' | 'real';
    digitalTiming: 'typical' | 'max' | 'zero';
    interactive: boolean;
    outputVariables: number;
    expressions: number;
  };
  /** ladder sheets, rungs and rung elements (absent sheets give every count 0) */
  ladder: LadderInfo;
  descriptionBox: boolean;
  questions: number;
  breadboard: boolean;
  grapherPages: number;
}

/** Rung elements and addresses of the ladder sheets (File information). */
export function ladderInfo(sheets: readonly Sheet[]): LadderInfo {
  const out: LadderInfo = { sheets: 0, rungs: 0, disabled: 0, contacts: 0, outputs: 0, addresses: 0 };
  const addresses = new Set<string>();
  // T1 and T1.ET are the same timer, so the count is "how many PLC locations", not "how many texts"
  const location = (a: string) => a.trim().toUpperCase().replace(/\.(ET|CV)$/, '');
  const walk = (n: LadderNode | undefined) => {
    if (!n) return;
    if (n.kind === 'contact') {
      out.contacts += 1;
      addresses.add(location(n.address));
    } else if (n.kind === 'compare') {
      out.contacts += 1;
      for (const a of [n.left, n.right]) if (/^[A-Za-z]/.test(a.trim())) addresses.add(location(a));
    } else for (const item of n.items) walk(item);
  };
  for (const sheet of sheets) {
    if (sheet.kind !== 'ladder') continue;
    out.sheets += 1;
    const rungs: readonly LadderRung[] = sheet.ladder ?? [];
    out.rungs += rungs.length;
    for (const r of rungs) {
      if (r.disabled) out.disabled += 1;
      walk(r.logic);
      out.outputs += r.outputs.length;
      for (const o of r.outputs) addresses.add(location(o.address));
    }
  }
  addresses.delete('');
  out.addresses = addresses.size;
  return out;
}

const SYMBOL_FAMILIES = /ground|power symbol|rail/i;

function isSymbol(def: PartDef): boolean {
  return def.id === 'sources/ground' || /^sources\/(vcc|vdd|vee|vss)$/.test(def.id) || (SYMBOL_FAMILIES.test(def.family) && def.symbol.pins.length === 1 && def.group === 'sources');
}

/** Contents and settings of a design for the File information dialog. */
export function designInfo(design: Design, lookup: (id: string) => PartDef | undefined): DesignInfo {
  const allSheets: Sheet[] = [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)];
  const families = new Map<string, FamilyCount>();
  const instrumentKinds = new Set<InstrumentKind>();
  let total = 0;
  let components = 0;
  let blocks = 0;
  let instruments = 0;
  let symbols = 0;
  let excluded = 0;
  let unknown = 0;
  let faults = 0;
  let wires = 0;
  let buses = 0;
  let labels = 0;
  let connectors = 0;
  let probes = 0;
  let notes = 0;
  let shapes = 0;
  for (const sheet of allSheets) {
    for (const p of sheet.parts) {
      total++;
      faults += p.faults?.length ?? 0;
      if (p.excludeFromSim) excluded++;
      if (isBlockPartId(p.partId)) {
        blocks++;
        continue;
      }
      const def = resolvePart(design, p.partId, lookup);
      if (!def) {
        unknown++;
        continue;
      }
      const key = `${def.group}\u0000${def.family}`;
      const fc = families.get(key) ?? { group: def.group, family: def.family, count: 0 };
      fc.count++;
      families.set(key, fc);
      if (def.instrument) {
        instruments++;
        instrumentKinds.add(def.instrument);
      } else if (isSymbol(def)) symbols++;
      else if (!p.excludeFromSim) components++;
    }
    for (const w of sheet.wires) {
      if (w.bus) buses++;
      else wires++;
    }
    for (const l of sheet.labels) {
      if ((l.kind ?? 'label') === 'label') labels++;
      else connectors++;
    }
    probes += sheet.probes.length;
    notes += sheet.notes.length;
    shapes += sheet.shapes?.length ?? 0;
  }
  let nets = -1;
  try {
    nets = buildNetlist(design, { includeAnalysis: false }).nets.length;
  } catch {
    nets = -1;
  }
  const r = design.restrictions;
  const specs = Object.keys(design.analysis.specs) as AnalysisType[];
  const analyses = [design.analysis.active, ...specs.filter((a) => a !== design.analysis.active)];
  const customModels = (design.customSpice ?? '').split(/\r?\n/).filter((l) => /^\s*\.(model|subckt)\b/i.test(l)).length;
  const byFamily = [...families.values()].sort((a, b) => b.count - a.count || a.group.localeCompare(b.group) || a.family.localeCompare(b.family));
  return {
    title: design.title,
    version: design.version,
    meta: { ...(design.meta ?? {}) },
    sheets: { root: design.sheets.length, child: allSheets.length - design.sheets.length, total: allSheets.length },
    childDesigns: {
      subcircuits: (design.children ?? []).filter((c) => c.kind === 'subcircuit').length,
      hierarchical: (design.children ?? []).filter((c) => c.kind === 'hierarchical').length,
    },
    parts: { total, components, blocks, instruments, symbols, excludedFromSim: excluded, unknown, byFamily },
    instrumentKinds: [...instrumentKinds].sort(),
    wires,
    buses,
    labels,
    connectors,
    probes,
    notes,
    shapes,
    nets,
    variables: Object.keys(design.variables).length,
    customParts: design.customParts?.length ?? 0,
    customModels,
    faults,
    restrictions: {
      present: !!r,
      hideValues: !!r?.hideValues,
      lockParts: !!r?.lockParts,
      lockedParts: r?.lockedParts?.length ?? 0,
      disabledAnalyses: [...(r?.disabledAnalyses ?? [])],
      disabledInstruments: [...(r?.disabledInstruments ?? [])],
      lockDescription: !!r?.lockDescription,
      hideAnswers: !!r?.hideAnswers,
    },
    simulation: {
      active: design.analysis.active,
      analyses,
      options: Object.keys(design.options) as (keyof SimOptions)[],
      digitalMode: design.digital?.mode ?? 'auto',
      digitalTiming: design.digital?.timing ?? 'typical',
      interactive: !!design.interactive,
      outputVariables: design.analysis.saves?.length ?? 0,
      expressions: design.analysis.expressions?.length ?? 0,
    },
    ladder: ladderInfo(allSheets),
    descriptionBox: !!design.descriptionBox?.text.trim(),
    questions: design.descriptionBox?.questions?.length ?? 0,
    breadboard: !!design.breadboard,
    grapherPages: design.grapher?.pages.length ?? 0,
  };
}

/** Byte size of a text saved as UTF-8 (the .msim size before the file exists). */
export function utf8Size(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
