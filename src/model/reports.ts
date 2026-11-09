/**
 * Design reports (pure data; the Reports dialog localizes and formats them, src/ui/reports):
 *
 *   placedParts(design)         every placed part, also inside blocks (path "HB1/R1"), with the
 *                               values evaluated for that block's parameters
 *   componentDetails(design)    part, value, every parameter, pins with numbers / types / nets,
 *                               footprint, models, BOM fields, provenance
 *   modelData(design)           every .model / .subckt the netlist uses, its parameters, its users
 *   spareGates(design)          unused sections of multi-section ICs (7400 gates, 7474 flip-flops,
 *                               4066 switches, dual / quad op-amps, 556 timers)
 *   crossReference(design)      parts by sheet and drawing zone (rows A…F, columns 1…8); nets by
 *                               the sheets and pins they reach
 *   schematicStatistics(design) counts of sheets, parts by group, wires, length, nets, pins …
 *
 * Values hidden by the instructor (Design.restrictions.hideValues) are reported as "?".
 */
import { asLibraryPart } from '../library/partkit';
import { defaultParams, getPart } from '../library';
import type { ParamDef, PartDef, PartGroup } from '../library/types';
import { partFields, partTolerance, partValue } from './bom';
import { childIdOfPart, getChild, designPartLookup } from './hierarchy';
import { buildNetlist, type NetlistBuildEx } from './netlister';
import { sheetFrame } from './paper';
import { HIDDEN_VALUE, valuesHidden } from './restrictions';
import type { Design, PartInstance, Sheet } from './types';
import type { PartFields } from './types';
import type { SubcktDef } from '../sim/netlist';
import { childVariableScope, resolveDesignVariables, substituteVariables, type VariableScope } from './variables';
import { splitRefdes } from './annotate';
import { variantView } from './variants';
import { packageParts, sectionPartId } from './sections';

// ---------------------------------------------------------------------------------------------
// traversal

export interface PlacedPart {
  /** refdes path: "R1" on the root, "HB1/R1" inside block HB1 */
  path: string;
  inst: PartInstance;
  def: PartDef;
  sheet: Sheet;
  /** block path ("" on the root, "HB1/" inside HB1) */
  prefix: string;
  /** parameters with defaults, evaluated for the block (values of the root parts as typed) */
  params: Record<string, string>;
}

/**
 * Every placed part (root sheets, then the inside of each placed block in order); blocks themselves
 * are not listed. Parts the active design variant does not fit carry excludeFromSim /
 * excludeFromBom (variants.ts variantView).
 */
export function placedParts(input: Design): PlacedPart[] {
  const design = variantView(input);
  const lookup = designPartLookup(design, getPart);
  const out: PlacedPart[] = [];
  const visit = (sheets: Sheet[], prefix: string, scope: VariableScope, chain: string[]) => {
    for (const sheet of sheets) {
      for (const inst of sheet.parts) {
        const childId = childIdOfPart(inst.partId);
        if (childId !== undefined) {
          const child = getChild(design, childId);
          if (!child || chain.includes(childId)) continue;
          visit(child.sheets, `${prefix}${inst.refdes}/`, childVariableScope(scope, child.variables, inst.params), [...chain, childId]);
          continue;
        }
        const def = lookup(inst.partId);
        if (!def) continue;
        let params = { ...defaultParams(def), ...inst.params };
        if (prefix) {
          try {
            params = substituteVariables(def, params, scope).params;
          } catch {
            /* keep the typed values */
          }
        }
        out.push({ path: `${prefix}${inst.refdes}`, inst, def, sheet, prefix, params });
      }
    }
  };
  visit(design.sheets, '', resolveDesignVariables(design.variables), []);
  return out;
}

/** A power / ground symbol, an instrument or another virtual part (no physical component). */
export function isVirtualPart(def: PartDef): boolean {
  return def.globalNet !== undefined || !!def.instrument || !!asLibraryPart(def).virtual;
}

export { partFields };

function compareRefdes(a: string, b: string): number {
  const sa = splitRefdes(a.split('/').pop() ?? a);
  const sb = splitRefdes(b.split('/').pop() ?? b);
  const da = a.split('/').length;
  const db = b.split('/').length;
  if (da !== db) return da - db;
  return sa.prefix.localeCompare(sb.prefix) || (sa.num ?? 0) - (sb.num ?? 0) || a.localeCompare(b);
}

// ---------------------------------------------------------------------------------------------
// component detail

export interface ComponentPin {
  name: string;
  number: string;
  type: string;
  /** net name as shown (label name, auto name, "0" for ground) */
  net: string;
}

export interface ComponentDetail {
  path: string;
  sheet: string;
  def: PartDef;
  value: string;
  tolerance: string;
  params: { def: ParamDef; value: string; modified: boolean }[];
  pins: ComponentPin[];
  fields: Required<PartFields>;
  /** model / subcircuit names of the part's simulation elements */
  models: string[];
  excludeFromSim: boolean;
  excludeFromBom: boolean;
  provenance: string;
}

/** Display name of a SPICE node (the label / auto name of root nets, the node name otherwise). */
function netNames(build: NetlistBuildEx): (node: string | undefined) => string {
  const byNode = new Map(build.nets.map((n) => [n.name, n.displayName]));
  return (node) => (node === undefined ? '' : node === '0' ? '0' : byNode.get(node) ?? node);
}

function safeBuild(design: Design): NetlistBuildEx | null {
  try {
    return buildNetlist(design, { includeAnalysis: false });
  } catch {
    return null;
  }
}

/** Models / subcircuits used by each part (by refdes path). */
function modelsByOwner(build: NetlistBuildEx | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!build) return out;
  for (const e of build.netlist.elements) {
    if (!e.model) continue;
    const owner = build.owners[e.name.toLowerCase()];
    if (!owner) continue;
    const list = out.get(owner) ?? [];
    if (!list.includes(e.model)) list.push(e.model);
    out.set(owner, list);
  }
  return out;
}

export function componentDetails(design: Design): ComponentDetail[] {
  const build = safeBuild(design);
  const name = build ? netNames(build) : () => '';
  const models = modelsByOwner(build);
  const hidden = valuesHidden(design);
  // the placed sections of a multi-section package are one chip (src/model/sections.ts)
  const out = packageParts(placedParts(design), getPart)
    .filter((p) => p.def.globalNet === undefined)
    .map((p): ComponentDetail => {
      const nets = build?.partNets[p.path] ?? {};
      const masked = hidden && !p.def.instrument;
      return {
        path: p.path,
        sheet: p.sheet.name,
        def: p.def,
        value: masked ? HIDDEN_VALUE : partValue(p.def, p.params),
        tolerance: masked ? HIDDEN_VALUE : partTolerance(p.def, p.params),
        params: p.def.params.map((d) => ({ def: d, value: masked ? HIDDEN_VALUE : p.params[d.key] ?? d.default, modified: p.inst.params[d.key] !== undefined && p.inst.params[d.key] !== d.default })),
        pins: p.def.symbol.pins.map((pin) => ({ name: pin.name, number: pin.number ?? '', type: pin.type ?? 'passive', net: name(nets[pin.name]) })),
        fields: partFields(p.inst, p.def),
        models: models.get(p.path) ?? models.get(p.inst.refdes) ?? [],
        excludeFromSim: !!p.inst.excludeFromSim,
        excludeFromBom: !!p.inst.excludeFromBom,
        provenance: p.def.provenance ?? '',
      };
    });
  return out.sort((a, b) => compareRefdes(a.path, b.path));
}

// ---------------------------------------------------------------------------------------------
// model data

export interface ModelEntry {
  name: string;
  kind: 'model' | 'subckt';
  /** device type (NPN, D, NMOS …) of a .model; '' for a subcircuit */
  type: string;
  /** numeric and text parameters (subcircuits: PARAMS: defaults) */
  params: [string, string][];
  /** subcircuit ports */
  ports: string[];
  /** element count of a subcircuit body */
  elements: number;
  /** refdes paths of the parts using it */
  usedBy: string[];
  /** provenance of the first part that uses it */
  provenance: string;
}

const numText = (v: number): string => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6))));

export function modelData(design: Design): ModelEntry[] {
  const build = safeBuild(design);
  if (!build) return [];
  const users = new Map<string, Set<string>>();
  const note = (model: string, owner: string | undefined) => {
    if (!owner) return;
    const k = model.toLowerCase();
    if (!users.has(k)) users.set(k, new Set());
    users.get(k)!.add(owner);
  };
  for (const e of build.netlist.elements) if (e.model) note(e.model, build.owners[e.name.toLowerCase()]);
  const defs = new Map(placedParts(design).map((p) => [p.path, p.def]));
  const hidden = valuesHidden(design);
  const entry = (name: string, kind: ModelEntry['kind'], type: string, params: [string, string][], ports: string[], elements: number): ModelEntry => {
    const usedBy = [...(users.get(name.toLowerCase()) ?? [])].sort(compareRefdes);
    return { name, kind, type, params: hidden ? params.map(([k]) => [k, HIDDEN_VALUE]) : params, ports, elements, usedBy, provenance: (usedBy.length && defs.get(usedBy[0])?.provenance) || '' };
  };
  const out: ModelEntry[] = [];
  for (const m of Object.values(build.netlist.models)) {
    const params: [string, string][] = [...Object.entries(m.params).map(([k, v]): [string, string] => [k, numText(v)]), ...Object.entries(m.stringParams ?? {})];
    out.push(entry(m.name, 'model', m.type, params, [], 0));
  }
  const visitSub = (subs: Record<string, SubcktDef>) => {
    for (const s of Object.values(subs)) {
      // subcircuits used through X elements of the top level, or nested ones (their parent's users)
      for (const e of s.elements) if (e.model) for (const u of users.get(s.name.toLowerCase()) ?? []) note(e.model, u);
      out.push(entry(s.name, 'subckt', '', Object.entries(s.params), s.ports, s.elements.length));
      for (const m of Object.values(s.models)) {
        const params: [string, string][] = Object.entries(m.params).map(([k, v]): [string, string] => [k, numText(v)]);
        out.push(entry(m.name, 'model', m.type, params, [], 0));
      }
      visitSub(s.subckts);
    }
  };
  visitSub(build.netlist.subckts);
  // a model card defined in several places is listed once
  const seen = new Set<string>();
  return out
    .filter((m) => {
      const k = `${m.kind}:${m.name.toLowerCase()}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'model' ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// spare gates

export interface GateSection {
  /** section number ("1" … "4") */
  section: string;
  pins: string[];
  spare: boolean;
}

export interface SpareGateEntry {
  path: string;
  def: PartDef;
  sections: GateSection[];
  /** sections in use / total */
  used: number;
}

const RAIL_NAMES = new Set(['0', 'gnd', 'vcc', 'vdd', 'vee', 'vss', 'v+', 'v-']);

/** Sections of a multi-section part from its pin names ("1A", "1B", "1Y", "2A" …); [] for one section. */
export function gateSections(def: PartDef): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of def.symbol.pins) {
    const m = /^(\d+)([A-Za-z].*)$/.exec(p.name);
    if (!m) continue;
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1])!.push(p.name);
  }
  return out.size >= 2 ? out : new Map();
}

/**
 * Sections of a package whose pin names do not start with the section number (the 556: TRIG1,
 * TRIG2 …), from its section parts (`<package id>-a`, `-b` …): section letter -> the pins that
 * belong to that section alone (shared pins such as VCC / GND are left out). Empty for an ordinary
 * part or a package without section parts.
 */
export function packageSections(def: PartDef): Map<string, string[]> {
  const found: { letter: string; pins: string[] }[] = [];
  for (let k = 1; k <= 8; k++) {
    const letter = String.fromCharCode(64 + k);
    const section = getPart(sectionPartId(def.id, letter));
    if (!section) break;
    found.push({ letter, pins: section.symbol.pins.map((p) => p.name) });
  }
  if (found.length < 2) return new Map();
  const count = new Map<string, number>();
  for (const s of found) for (const p of s.pins) count.set(p, (count.get(p) ?? 0) + 1);
  return new Map(found.map((s) => [s.letter, s.pins.filter((p) => count.get(p) === 1)]));
}

/**
 * Unused sections of every multi-section IC. A section is spare when none of its outputs drives
 * another pin and none of its inputs is connected to a signal (inputs tied to a supply rail or
 * ground, as unused inputs should be, still count as spare). A net that only joins pins of the
 * section itself (an unused op-amp wired as a follower: - input to its own output) does not make
 * the section used either.
 */
export function spareGates(design: Design): SpareGateEntry[] {
  const build = safeBuild(design);
  if (!build) return [];
  const pinsOn = new Map<string, { refdes: string; pin: string }[]>();
  for (const n of build.nets) pinsOn.set(n.name, n.pins);
  const rail = new Map(build.nets.map((n) => [n.name, n.name === '0' || RAIL_NAMES.has(n.displayName.toLowerCase())]));
  const out: SpareGateEntry[] = [];
  for (const p of packageParts(placedParts(design), getPart)) {
    let sections = gateSections(p.def);
    if (!sections.size) sections = packageSections(p.def);
    if (!sections.size) continue;
    const nets = build.partNets[p.path] ?? {};
    const list: GateSection[] = [];
    for (const [section, pins] of sections) {
      let used = false;
      const own = new Set(pins);
      for (const pin of pins) {
        const node = nets[pin];
        if (!node || node.startsWith('NC_') || rail.get(node)) continue;
        // connected to at least one pin that is not a pin of this section itself
        if ((pinsOn.get(node) ?? []).some((q) => !(q.refdes === p.path && own.has(q.pin)))) used = true;
      }
      list.push({ section, pins, spare: !used });
    }
    out.push({ path: p.path, def: p.def, sections: list, used: list.filter((s) => !s.spare).length });
  }
  return out.sort((a, b) => compareRefdes(a.path, b.path));
}

// ---------------------------------------------------------------------------------------------
// cross reference

export interface CrossRefPart {
  path: string;
  def: PartDef;
  value: string;
  sheet: string;
  /** drawing zone: row letter (A … F, top to bottom) + column number (1 … 8, left to right) */
  zone: string;
}

export interface CrossRefNet {
  name: string;
  sheets: string[];
  pins: string[];
}

export const ZONE_COLUMNS = 8;
export const ZONE_ROWS = 6;

/** Drawing zone of a point on a sheet ("B3"). */
export function sheetZone(sheet: Sheet, x: number, y: number): string {
  const f = sheetFrame(sheet.props);
  const col = Math.min(ZONE_COLUMNS, Math.max(1, Math.floor((x / f.w) * ZONE_COLUMNS) + 1));
  const row = Math.min(ZONE_ROWS, Math.max(1, Math.floor((y / f.h) * ZONE_ROWS) + 1));
  return `${String.fromCharCode(64 + row)}${col}`;
}

export function crossReference(design: Design): { parts: CrossRefPart[]; nets: CrossRefNet[] } {
  const hidden = valuesHidden(design);
  const parts = placedParts(design)
    .filter((p) => p.def.globalNet === undefined)
    .map((p) => ({ path: p.path, def: p.def, value: hidden && !p.def.instrument ? HIDDEN_VALUE : partValue(p.def, p.params), sheet: p.sheet.name, zone: sheetZone(p.sheet, p.inst.x, p.inst.y) }))
    .sort((a, b) => compareRefdes(a.path, b.path));
  const build = safeBuild(design);
  const sheetOf = new Map<string, string>();
  for (const p of placedParts(design)) sheetOf.set(p.path, p.sheet.name);
  const nets: CrossRefNet[] = (build?.nets ?? [])
    .map((n) => ({
      name: n.displayName,
      sheets: [...new Set(n.pins.map((r) => sheetOf.get(r.refdes) ?? ''))].filter(Boolean),
      pins: n.pins.map((r) => `${r.refdes}.${r.pin}`).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { parts, nets };
}

// ---------------------------------------------------------------------------------------------
// statistics

export interface SchematicStatistics {
  sheets: number;
  childDesigns: number;
  blocks: number;
  parts: number;
  /** physical components (BOM parts) */
  components: number;
  virtualParts: number;
  instruments: number;
  powerSymbols: number;
  byGroup: Partial<Record<PartGroup, number>>;
  wires: number;
  segments: number;
  /** total wire length, mm (4 schematic units per mm) */
  wireLength: number;
  buses: number;
  labels: number;
  connectors: number;
  probes: number;
  notes: number;
  shapes: number;
  nets: number;
  pins: number;
  unconnectedPins: number;
  ercErrors: number;
  ercWarnings: number;
}

export function schematicStatistics(design: Design): SchematicStatistics {
  const sheets = [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)];
  const lookup = designPartLookup(design, getPart);
  const st: SchematicStatistics = {
    sheets: sheets.length,
    childDesigns: design.children?.length ?? 0,
    blocks: 0,
    parts: 0,
    components: 0,
    virtualParts: 0,
    instruments: 0,
    powerSymbols: 0,
    byGroup: {},
    wires: 0,
    segments: 0,
    wireLength: 0,
    buses: 0,
    labels: 0,
    connectors: 0,
    probes: 0,
    notes: 0,
    shapes: 0,
    nets: 0,
    pins: 0,
    unconnectedPins: 0,
    ercErrors: 0,
    ercWarnings: 0,
  };
  for (const s of sheets) {
    for (const inst of s.parts) {
      if (childIdOfPart(inst.partId) !== undefined) {
        st.blocks += 1;
        continue;
      }
      st.parts += 1;
      const def = lookup(inst.partId);
      if (!def) continue;
      st.pins += def.symbol.pins.length;
      st.byGroup[def.group] = (st.byGroup[def.group] ?? 0) + 1;
      if (def.globalNet !== undefined) st.powerSymbols += 1;
      else if (def.instrument) st.instruments += 1;
      else if (asLibraryPart(def).virtual) st.virtualParts += 1;
      else st.components += 1;
    }
    for (const w of s.wires) {
      if (w.bus) st.buses += 1;
      else st.wires += 1;
      for (let i = 1; i < w.points.length; i++) {
        st.segments += 1;
        st.wireLength += Math.abs(w.points[i].x - w.points[i - 1].x) + Math.abs(w.points[i].y - w.points[i - 1].y);
      }
    }
    for (const l of s.labels) {
      if (!l.kind || l.kind === 'label') st.labels += 1;
      else st.connectors += 1;
    }
    st.probes += s.probes.length;
    st.notes += s.notes.length;
    st.shapes += s.shapes?.length ?? 0;
  }
  st.wireLength = Math.round((st.wireLength / 4) * 10) / 10;
  const build = safeBuild(design);
  if (build) {
    st.nets = build.nets.length;
    st.unconnectedPins = build.erc.filter((m) => m.code === 'floating-pin').length;
    st.ercErrors = build.erc.filter((m) => m.severity === 'error').length;
    st.ercWarnings = build.erc.length - st.ercErrors;
  }
  return st;
}

