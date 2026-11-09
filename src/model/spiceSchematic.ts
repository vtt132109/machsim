/**
 * SPICE netlist -> readable schematic (File > Import SPICE as schematic).
 *
 *   pspiceCompat(text)                  comment out PSpice-only cards (.ALIASES blocks, .STMLIB,
 *                                       .EXTERNAL, .FILE, .PROBE64 …) with notes
 *   spiceToSchematic(netlist, opts)     Netlist IR (parseSpice) -> { design, notes, stats }
 *
 * Mapping. Elements become library parts when the part reproduces the element exactly:
 *   R C L (value, tc1 / tc2, ic) · V / I with DC, AC and SIN / PULSE / PWL waveforms · linear E / G ·
 *   D, 3-terminal Q, M, J with the deck's .model card attached as PartInstance.modelOverride.
 * Everything else becomes a "SPICE block": a user component (Design.customParts) whose model is a
 * .subckt — the X instances' own subcircuits, or a wrapper subcircuit around the element(s). K
 * couplings travel with their inductors and F / H / W sources with their controlling V sources, so
 * the netlist of the drawn schematic simulates exactly like the deck. The deck's .param values
 * become design variables, its .model / .subckt cards the design's custom SPICE text, its analyses
 * and options the design's analysis settings.
 *
 * Placement: sources in the first column, then every part by breadth-first distance (in parts)
 * from the sources; columns and rows sized to the largest symbol plus routing space. Two-terminal
 * parts with one grounded pin stand vertically with that pin at the bottom.
 * Routing: ground pins get ground symbols (a short stub when the pin does not point down); every
 * other net is routed on the 10-unit grid with A* (bends and crossings cost extra, parts and other
 * nets' pins / corners are obstacles, perpendicular crossings are allowed). Multi-pin nets grow as a
 * tree (new branches end on the existing wire: a T-junction). Nets with many pins, or that cannot be
 * routed, are joined with net labels at the pins. Every routed net keeps its SPICE node name as a
 * net label, so V(out) of the deck is V(out) of the schematic.
 */
import { getPart } from '../library';
import type { PartDef, PinDef, SymbolDef } from '../library/types';
import type { CustomPartData } from '../library/custom/types';
import { customPartDef } from '../library/custom/partDef';
import { boxSymbol } from '../library/symbols';
import { emptyNetlist, isGroundNode, type AnalysisSpec, type AnalysisType, type ElementIR, type ModelCard, type Netlist, type SubcktDef } from '../sim/netlist';
import { writeSpice } from '../sim/spice';
import { parseUserNumber, toSpiceNumber } from '../util/units';
import { instanceBBox, localToSheet, rotatePoint } from './geometry';
import type { Design, NetLabel, PartInstance, Point, Rotation, Wire } from './types';
import { newDesign, newSheet } from './types';

// ---------------------------------------------------------------------------------------------
// PSpice compatibility

const PSPICE_ONLY = /^\s*\.(stmlib|external|file|probe64|lib\s+nom\.lib|vector|watch|alias)\b/i;

/** Comment out PSpice-only cards; returns the text and what was changed. */
export function pspiceCompat(text: string): { text: string; changed: string[] } {
  const changed = new Set<string>();
  let inAliases = false;
  const lines = text.split(/\r?\n/).map((line) => {
    const t = line.trim().toLowerCase();
    if (t.startsWith('.aliases')) {
      inAliases = true;
      changed.add('.ALIASES');
      return `* ${line}`;
    }
    if (inAliases) {
      if (t.startsWith('.endaliases')) inAliases = false;
      return `* ${line}`;
    }
    const m = PSPICE_ONLY.exec(line);
    if (m) {
      changed.add(`.${m[1].split(/\s+/)[0].toUpperCase()}`);
      return `* ${line}`;
    }
    return line;
  });
  return { text: lines.join('\n'), changed: [...changed] };
}

// ---------------------------------------------------------------------------------------------
// results

export type ImportNote =
  | { kind: 'block'; name: string }
  | { kind: 'label'; net: string }
  | { kind: 'controlled'; name: string; control: string }
  | { kind: 'pspice'; what: string }
  /** .func / .ic / .nodeset / .meas cards kept in the design's custom SPICE text */
  | { kind: 'carried'; what: string }
  | { kind: 'unsupported'; what: string };

export interface SpiceSchematicResult {
  design: Design;
  notes: ImportNote[];
  stats: { parts: number; wires: number; labels: number; blocks: number; grounds: number };
}

export interface SpiceSchematicOptions {
  title?: string;
  /** file name (block descriptions) */
  fileName?: string;
  /** library lookup (tests) */
  lookup?: (id: string) => PartDef | undefined;
}

// ---------------------------------------------------------------------------------------------
// numbers

/** A number as user-syntax text that parseUserNumber reads back exactly. */
function userNum(v: number): string {
  const s = toSpiceNumber(v);
  return parseUserNumber(s) === v ? s : String(v);
}

// ---------------------------------------------------------------------------------------------
// items: what goes on the sheet

export interface PinNet {
  pin: string;
  node: string;
}

/**
 * A part to place by {@link placeAndRoute}: library part, parameter values and the net of each
 * pin. Importers of other schematic formats (src/model/importSchematic.ts) pass `at` for every
 * item to keep the source drawing's positions and orientations.
 */
export interface SchematicItem {
  refdes: string;
  partId: string;
  def: PartDef;
  params: Record<string, string>;
  modelOverride?: string;
  pins: PinNet[];
  source: boolean;
  /** fixed position (sheet units, snapped to the grid) and orientation */
  at?: { x: number; y: number; rotation: Rotation; mirror: boolean };
}
type Item = SchematicItem;

const sanitize = (s: string): string => s.replace(/[^A-Za-z0-9_]/g, '_');

/** Refdes from an element name: PSpice "R_R1" -> "R1"; unique in the design. */
function refdesFor(name: string, used: Set<string>): string {
  let base = name;
  const m = /^([A-Za-z])_(.+)$/.exec(name);
  if (m) base = m[2];
  base = base.replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z]/.test(base)) base = `${name[0]}${base}`;
  let ref = base;
  for (let i = 2; used.has(ref.toUpperCase()); i++) ref = `${base}_${i}`;
  used.add(ref.toUpperCase());
  return ref;
}

/** The library part that reproduces an element exactly, or null (the element becomes a block). */
function mapElement(el: ElementIR, models: Record<string, ModelCard>): { partId: string; params: Record<string, string>; pins: string[]; modelOverride?: string } | null {
  const extraParams = (allowed: string[]) => Object.keys(el.params).every((k) => allowed.includes(k) || (k === 'm' && el.params.m === 1));
  if (el.stringParams && Object.keys(el.stringParams).length) return null;
  switch (el.type) {
    case 'R':
    case 'C':
    case 'L': {
      if (el.value === undefined || el.model || !(el.value > 0)) return null;
      const allowed = el.type === 'R' ? ['tc1', 'tc2'] : ['ic'];
      if (!extraParams(allowed)) return null;
      const params: Record<string, string> = { value: userNum(el.value) };
      for (const k of allowed) if (el.params[k] !== undefined) params[k] = userNum(el.params[k]);
      const partId = el.type === 'R' ? 'basic/resistor' : el.type === 'C' ? 'basic/capacitor' : 'basic/inductor';
      return { partId, params, pins: ['1', '2'] };
    }
    case 'V':
    case 'I': {
      const src = el.source ?? {};
      if (src.distof1 || src.distof2 || !extraParams([])) return null;
      const kind = el.type === 'V' ? 'voltage' : 'current';
      // library current sources push their current out of the + pin: SPICE n+ is their − pin
      const pins = el.type === 'V' ? ['+', '-'] : ['-', '+'];
      const ac: Record<string, string> = { acmag: userNum(src.acMag ?? 0) };
      if (src.acPhase) ac.acphase = userNum(src.acPhase);
      const w = src.tran;
      if (!w) return { partId: `sources/dc-${kind}`, params: { value: userNum(src.dc ?? 0), ...ac }, pins };
      const a = w.args;
      if (w.type === 'SIN' && a.length >= 3) {
        if (src.dc !== undefined && src.dc !== a[0]) return null;
        const params = { offset: userNum(a[0]), amplitude: userNum(a[1]), freq: userNum(a[2]), delay: userNum(a[3] ?? 0), damping: userNum(a[4] ?? 0), phase: userNum(a[5] ?? 0), ...ac };
        return { partId: `sources/ac-${kind}`, params, pins };
      }
      if (w.type === 'PULSE' && a.length >= 7 && a[3] > 0 && a[4] > 0) {
        if (src.dc !== undefined && src.dc !== a[0]) return null;
        const params = { v1: userNum(a[0]), v2: userNum(a[1]), delay: userNum(a[2]), rise: userNum(a[3]), fall: userNum(a[4]), width: userNum(a[5]), period: userNum(a[6]), ...ac };
        return { partId: `sources/pulse-${kind}`, params, pins };
      }
      if (w.type === 'PWL' && a.length >= 2 && a.length % 2 === 0) {
        if (src.dc !== undefined && src.dc !== a[1]) return null;
        if (w.repeatFrom !== undefined && w.repeatFrom !== a[0]) return null;
        const pairs: string[] = [];
        for (let i = 0; i < a.length; i += 2) pairs.push(`${userNum(a[i])} ${userNum(a[i + 1])}`);
        return { partId: `sources/pwl-${kind}`, params: { points: pairs.join(', '), repeat: w.repeatFrom !== undefined ? 'true' : 'false', ...ac }, pins };
      }
      return null;
    }
    case 'E':
    case 'G':
      if (el.laplace || el.value === undefined || el.nodes.length !== 4 || !extraParams([])) return null;
      // the library VCCS drives its current out of out+: SPICE n+ is its out− pin
      return { partId: el.type === 'E' ? 'sources/vcvs' : 'sources/vccs', params: { [el.type === 'E' ? 'gain' : 'gm']: userNum(el.value) }, pins: el.type === 'E' ? ['out+', 'out-', 'in+', 'in-'] : ['out-', 'out+', 'in+', 'in-'] };
    case 'D': {
      const m = el.model ? models[el.model.toLowerCase()] : undefined;
      if (!m || m.type !== 'D' || !extraParams([])) return null;
      return { partId: 'diodes/diode', params: {}, pins: ['A', 'K'], modelOverride: m.name };
    }
    case 'Q': {
      const m = el.model ? models[el.model.toLowerCase()] : undefined;
      if (!m || (m.type !== 'NPN' && m.type !== 'PNP') || el.nodes.length !== 3 || !extraParams([])) return null;
      return { partId: m.type === 'NPN' ? 'transistors/npn' : 'transistors/pnp', params: {}, pins: ['C', 'B', 'E'], modelOverride: m.name };
    }
    case 'M': {
      const m = el.model ? models[el.model.toLowerCase()] : undefined;
      if (!m || (m.type !== 'NMOS' && m.type !== 'PMOS') || el.nodes.length !== 4 || !extraParams(['w', 'l'])) return null;
      const params: Record<string, string> = {};
      if (el.params.w !== undefined) params.w = userNum(el.params.w);
      if (el.params.l !== undefined) params.l = userNum(el.params.l);
      return { partId: m.type === 'NMOS' ? 'transistors/nmos-4t' : 'transistors/pmos-4t', params, pins: ['D', 'G', 'S', 'B'], modelOverride: m.name };
    }
    case 'J': {
      const m = el.model ? models[el.model.toLowerCase()] : undefined;
      if (!m || (m.type !== 'NJF' && m.type !== 'PJF') || el.nodes.length !== 3 || !extraParams([])) return null;
      return { partId: m.type === 'NJF' ? 'transistors/njfet' : 'transistors/pjfet', params: {}, pins: ['D', 'G', 'S'], modelOverride: m.name };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// SPICE blocks (user components with a .subckt model)

/** Model cards and subcircuits an element list needs (recursively through subcircuits). */
function dependencies(elements: ElementIR[], netlist: Netlist): { models: ModelCard[]; subckts: SubcktDef[] } {
  const models = new Map<string, ModelCard>();
  const subckts = new Map<string, SubcktDef>();
  const visit = (els: ElementIR[], localModels: Record<string, ModelCard>, localSubs: Record<string, SubcktDef>) => {
    for (const e of els) {
      if (!e.model) continue;
      const key = e.model.toLowerCase();
      if (e.type === 'X') {
        const s = localSubs[key] ?? netlist.subckts[key];
        if (s && !subckts.has(key) && !localSubs[key]) {
          subckts.set(key, s);
          visit(s.elements, s.models, s.subckts);
        }
      } else if (!localModels[key] && netlist.models[key]) models.set(key, netlist.models[key]);
    }
  };
  visit(elements, {}, {});
  return { models: [...models.values()], subckts: [...subckts.values()] };
}

/** SPICE text of model cards and subcircuits (no title, no .end). */
function cardsText(models: ModelCard[], subckts: SubcktDef[]): string {
  const n = emptyNetlist('cards');
  for (const m of models) n.models[m.name.toLowerCase()] = m;
  for (const s of subckts) n.subckts[s.name.toLowerCase()] = s;
  return writeSpice(n)
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() && l.trim().toLowerCase() !== '.end')
    .join('\n');
}

/**
 * .func / .ic / .nodeset / .meas cards of a deck as SPICE text for Design.customSpice, and the
 * list of what was carried (for the import notes).
 */
function controlCardsText(netlist: Netlist): { text: string; carried: string[] } {
  const n = emptyNetlist('cards');
  const carried: string[] = [];
  for (const [k, v] of Object.entries(netlist.params)) {
    if (!k.includes('(') || k.startsWith('.')) continue;
    n.params[k] = v;
    carried.push(`.func ${k}`);
  }
  n.ic = { ...netlist.ic };
  n.nodeset = { ...netlist.nodeset };
  if (Object.keys(n.ic).length) carried.push(`.ic ${Object.keys(n.ic).map((x) => `V(${x})`).join(' ')}`);
  if (Object.keys(n.nodeset).length) carried.push(`.nodeset ${Object.keys(n.nodeset).map((x) => `V(${x})`).join(' ')}`);
  if (netlist.measures?.length) {
    n.measures = netlist.measures.map(({ line: _line, ...rest }) => rest);
    for (const m of netlist.measures) carried.push(`.meas ${m.analysis.toUpperCase()} ${m.name}`);
  }
  const text = writeSpice(n)
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() && l.trim().toLowerCase() !== '.end')
    .join('\n');
  return { text, carried };
}

/** Box symbol with the ports split left / right. */
export function blockSymbol(ports: string[], title: string): SymbolDef {
  const half = Math.ceil(ports.length / 2);
  return boxSymbol({ left: ports.slice(0, half).map((p) => ({ name: p })), right: ports.slice(half).map((p) => ({ name: p })), w: 100, title });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block';
}

function blockPart(sub: SubcktDef, netlist: Netlist, fileName: string, title: string, deckWide: string[]): CustomPartData {
  const deps = dependencies([{ type: 'X', name: 'X', nodes: sub.ports, model: sub.name, params: {} }], netlist);
  if (!deps.subckts.some((s) => s.name.toLowerCase() === sub.name.toLowerCase())) deps.subckts.unshift(sub);
  const pinNames = sub.ports.map((p, i) => (sub.ports.indexOf(p) === i ? p : `${p}_${i + 1}`));
  return {
    id: `custom:spice-${slug(sub.name)}`,
    name: title,
    group: 'misc',
    family: 'SPICE block',
    description: `SPICE subcircuit ${sub.name}${fileName ? ` imported from ${fileName}` : ''}`,
    prefix: 'X',
    symbol: blockSymbol(pinNames, title),
    params: Object.keys(sub.params).length ? Object.entries(sub.params).map(([key, def]) => ({ key, label: key, kind: 'number' as const, default: def.replace(/^\{|\}$/g, ''), group: 'model' as const })) : undefined,
    model: { kind: 'spice', text: [...deckWide, cardsText(deps.models, deps.subckts)].filter(Boolean).join('\n'), name: sub.name, pins: pinNames },
    provenance: `SPICE netlist${fileName ? ` ${fileName}` : ''}`,
  };
}

// ---------------------------------------------------------------------------------------------
// conversion

/** Nodes (V(a), V(a,b)) and source currents (I(Vx)) a behavioural expression refers to. */
export function exprRefs(expr: string | undefined): { nodes: string[]; currents: string[] } {
  const nodes: string[] = [];
  const currents: string[] = [];
  if (!expr) return { nodes, currents };
  const body = expr.replace(/^\s*[VIR]\s*=/i, '');
  for (const m of body.matchAll(/(?<![A-Za-z0-9_])V\(\s*([^,()\s]+)\s*(?:,\s*([^()\s]+)\s*)?\)/gi)) for (const n of [m[1], m[2]]) if (n && !nodes.includes(n)) nodes.push(n);
  for (const m of body.matchAll(/(?<![A-Za-z0-9_])I\(\s*([^()\s]+)\s*\)/gi)) if (!currents.includes(m[1])) currents.push(m[1]);
  return { nodes, currents };
}

/** Union-find over element indices (K with its inductors, F / H / W with their control sources). */
function groupElements(els: ElementIR[]): number[][] {
  const parent = els.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const byName = new Map(els.map((e, i) => [e.name.toLowerCase(), i]));
  els.forEach((e, i) => {
    if (e.type === 'K') for (const l of e.inductors ?? []) {
      const j = byName.get(l.toLowerCase());
      if (j !== undefined) union(i, j);
    }
    if ((e.type === 'F' || e.type === 'H' || e.type === 'W') && e.control) {
      const j = byName.get(e.control.toLowerCase());
      if (j !== undefined) union(i, j);
    }
    // behavioural sources that read a source current I(Vx) travel with that source
    for (const c of exprRefs(e.expr).currents) {
      const j = byName.get(c.toLowerCase());
      if (j !== undefined) union(i, j);
    }
  });
  const groups = new Map<number, number[]>();
  els.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });
  return [...groups.values()];
}

const DIRS: Record<string, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } };

/** Outward direction of a placed pin (PinDef.dir, else the nearest body edge), after rotation / mirror. */
function pinOutward(pin: PinDef, def: PartDef, inst: Pick<PartInstance, 'rotation' | 'mirror'>): Point {
  let d: Point;
  if (pin.dir) d = DIRS[pin.dir];
  else {
    const b = def.symbol.bbox;
    const dl = Math.abs(pin.x - b.x);
    const dr = Math.abs(b.x + b.w - pin.x);
    const du = Math.abs(pin.y - b.y);
    const dd = Math.abs(b.y + b.h - pin.y);
    const m = Math.min(dl, dr, du, dd);
    d = m === dl ? DIRS.left : m === dr ? DIRS.right : m === du ? DIRS.up : DIRS.down;
  }
  const mirrored = inst.mirror ? { x: -d.x, y: d.y } : d;
  const r = rotatePoint(mirrored, inst.rotation);
  return { x: Math.round(r.x), y: Math.round(r.y) };
}

/** Rotation that puts pin `grounded` of a vertical two-terminal symbol at the bottom. */
function verticalRotation(def: PartDef, groundedPin: string): Rotation {
  const pins = def.symbol.pins;
  const p = pins.find((x) => x.name === groundedPin)!;
  const other = pins.find((x) => x.name !== groundedPin)!;
  // symbols are horizontal (pins left / right) or vertical (pins top / bottom)
  if (Math.abs(p.x - other.x) >= Math.abs(p.y - other.y)) return p.x > other.x ? 90 : 270;
  return p.y > other.y ? 0 : 180;
}

const G = 10;
const snap = (v: number): number => Math.round(v / G) * G;

/** Convert a parsed netlist into a schematic design. */
export function spiceToSchematic(netlist: Netlist, opts: SpiceSchematicOptions = {}): SpiceSchematicResult {
  const lookup = opts.lookup ?? getPart;
  const notes: ImportNote[] = [];
  const fileName = opts.fileName ?? '';
  const used = new Set<string>();
  const items: Item[] = [];
  const customParts: CustomPartData[] = [];
  const customById = new Map<string, CustomPartData>();
  const blocks: SubcktDef[] = [];
  const els = netlist.elements;
  const groups = groupElements(els);

  // deck-wide .param text used by subcircuit blocks (their bodies may refer to global parameters)
  const deckWide: string[] = [];

  const addCustom = (data: CustomPartData): PartDef => {
    if (!customById.has(data.id)) {
      customById.set(data.id, data);
      customParts.push(data);
    }
    return customPartDef(customById.get(data.id)!);
  };

  for (const group of groups) {
    const members = group.map((i) => els[i]);
    if (members.length === 1) {
      const el = members[0];
      if (el.type === 'X' && el.model) {
        const sub = netlist.subckts[el.model.toLowerCase()];
        if (sub) {
          const data = blockPart(sub, netlist, fileName, sub.name, deckWide);
          const def = addCustom(data);
          const params: Record<string, string> = {};
          const keys = new Map(Object.keys(sub.params).map((k) => [k.toLowerCase(), k]));
          for (const [k, v] of Object.entries(el.stringParams ?? {})) {
            const n = parseUserNumber(v.replace(/^\{|\}$/g, ''));
            if (Number.isFinite(n)) params[keys.get(k.toLowerCase()) ?? k] = userNum(n);
            else notes.push({ kind: 'unsupported', what: `${el.name} ${k}=${v}` });
          }
          const model = data.model as Extract<CustomPartData['model'], { kind: 'spice' }>;
          items.push({ refdes: refdesFor(el.name, used), partId: def.id, def, params, pins: model.pins.map((pin, i) => ({ pin, node: el.nodes[i] ?? '0' })), source: false });
          continue;
        }
      }
      const m = mapElement(el, netlist.models);
      if (m) {
        const def = lookup(m.partId);
        if (def) {
          items.push({ refdes: refdesFor(el.name, used), partId: m.partId, def, params: m.params, modelOverride: m.modelOverride, pins: m.pins.map((pin, i) => ({ pin, node: el.nodes[i] })), source: el.type === 'V' || el.type === 'I' });
          continue;
        }
      }
    }
    // a SPICE block wrapping the element(s)
    const ports: string[] = [];
    for (const e of members) for (const n of [...e.nodes, ...exprRefs(e.expr).nodes]) if (!isGroundNode(n) && !ports.includes(n)) ports.push(n);
    const name = `MS_IMP_${sanitize(members[0].name).toUpperCase()}`;
    const sub: SubcktDef = { name, ports, params: {}, elements: members.map((e) => ({ ...e })), models: {}, subckts: {} };
    blocks.push(sub);
    const deps = dependencies(members, netlist);
    const pinNames = ports.map((p) => p);
    const data: CustomPartData = {
      id: `custom:spice-${slug(name)}`,
      name: members.map((e) => e.name).join(' + '),
      group: 'misc',
      family: 'SPICE block',
      description: `SPICE element${members.length > 1 ? 's' : ''} ${members.map((e) => e.name).join(', ')}${fileName ? ` from ${fileName}` : ''}`,
      prefix: 'X',
      symbol: blockSymbol(pinNames.length ? pinNames : ['n'], members[0].name),
      model: { kind: 'spice', text: [...deckWide, cardsText(deps.models, [...deps.subckts, sub])].filter(Boolean).join('\n'), name, pins: pinNames },
      provenance: `SPICE netlist${fileName ? ` ${fileName}` : ''}`,
    };
    const def = addCustom(data);
    items.push({ refdes: refdesFor(members[0].name, used), partId: def.id, def, params: {}, pins: ports.map((p) => ({ pin: p, node: p })), source: members.some((e) => e.type === 'V' || e.type === 'I') });
    notes.push({ kind: 'block', name: members.map((e) => e.name).join(', ') });
    for (const e of members) if ((e.type === 'F' || e.type === 'H' || e.type === 'W') && e.control) notes.push({ kind: 'controlled', name: e.name, control: e.control });
  }

  const layout = placeAndRoute(items, notes);

  // ------------------------------------------------------------------ design
  const design = newDesign(opts.title || netlist.title || fileName || 'SPICE');
  const sheet = newSheet('sheet1', 'Sheet 1');
  sheet.parts = layout.parts;
  sheet.wires = layout.wires;
  sheet.labels = layout.labels;
  design.sheets = [sheet];
  if (customParts.length) design.customParts = customParts;
  // models the overrides refer to, and every other card of the deck, go into the custom SPICE text
  const overrideModels = Object.values(netlist.models);
  const cards = cardsText(overrideModels, Object.values(netlist.subckts));
  // .func, .ic, .nodeset and .meas travel as cards of the custom SPICE text: the netlister applies
  // them to the schematic's netlist (functions for expressions, initial conditions by net name,
  // measurements on the results)
  const extra = controlCardsText(netlist);
  for (const what of extra.carried) notes.push({ kind: 'carried', what });
  const text = [cards, extra.text].filter((x) => x.trim()).join('\n');
  if (text.trim()) design.customSpice = `* ${fileName || 'SPICE netlist'}\n${text}\n`;
  for (const [k, v] of Object.entries(netlist.params)) {
    if (k.includes('(') || k.startsWith('.')) continue;
    design.variables[k] = typeof v === 'number' ? userNum(v) : v.replace(/^\{|\}$/g, '');
  }
  design.options = { ...netlist.options };
  const specs: Partial<Record<AnalysisType, AnalysisSpec>> = {};
  const kept: AnalysisSpec[] = [];
  for (const a0 of netlist.analyses) {
    let a = a0;
    // a .step of a global parameter re-evaluates the deck's expressions, which the schematic has
    // already turned into part values: keep the analysis it steps and say so
    while (a.type === 'paramsweep' && a.global) {
      notes.push({ kind: 'unsupported', what: `.step param ${a.target}` });
      a = a.base;
    }
    const fixed = a.type === 'tran' && !(a.tstep > 0) ? { ...a, tstep: a.tstop / 1000 } : a;
    kept.push(fixed);
    if (!specs[fixed.type]) specs[fixed.type] = fixed;
  }
  if (kept.length) design.analysis = { active: kept[0].type, specs: { ...design.analysis.specs, ...specs } };
  return {
    design,
    notes,
    stats: { parts: items.length, wires: layout.wires.length, labels: layout.labels.length, blocks: customParts.length, grounds: layout.grounds },
  };
}

// ---------------------------------------------------------------------------------------------
// placement and routing

interface Placed {
  item: Item;
  inst: PartInstance;
  pins: { pin: string; node: string; at: Point; out: Point }[];
}

const COL_GAP = 100;
const ROW_GAP = 90;
const LABEL_NET_PINS = 7;

/**
 * Place parts (breadth-first columns from the sources, or each item's fixed `at` when every item
 * has one; overlapping fixed parts are moved right until free) and route every net (see the module
 * comment). Nets in `opts.unnamed` (importers' automatic net names) get no name label when they
 * are routed as wires.
 */
export function placeAndRoute(items: Item[], notes: ImportNote[], opts: { unnamed?: ReadonlySet<string> } = {}): { parts: PartInstance[]; wires: Wire[]; labels: NetLabel[]; grounds: number } {
  // ---- columns by breadth-first distance from the sources
  const netItems = new Map<string, number[]>();
  items.forEach((it, i) => {
    for (const p of it.pins) {
      if (isGroundNode(p.node)) continue;
      if (!netItems.has(p.node)) netItems.set(p.node, []);
      netItems.get(p.node)!.push(i);
    }
  });
  const col = new Array<number>(items.length).fill(-1);
  const order: number[] = [];
  const bfs = (starts: number[]) => {
    const queue = [...starts];
    for (const s of starts) col[s] = 0;
    while (queue.length) {
      const i = queue.shift()!;
      order.push(i);
      for (const p of items[i].pins) {
        if (isGroundNode(p.node)) continue;
        for (const j of netItems.get(p.node) ?? []) {
          if (col[j] >= 0) continue;
          col[j] = items[j].source ? col[i] : col[i] + 1;
          queue.push(j);
        }
      }
    }
  };
  bfs(items.map((it, i) => (it.source ? i : -1)).filter((i) => i >= 0));
  for (let i = 0; i < items.length; i++) if (col[i] < 0) bfs([i]);

  // ---- orientation and size
  const rotation = items.map((it): Rotation => {
    const grounded = it.pins.filter((p) => isGroundNode(p.node));
    if (it.pins.length === 2 && grounded.length === 1) return verticalRotation(it.def, grounded[0].pin);
    return 0;
  });
  const sizes = items.map((it, i) => {
    const bb = instanceBBox({ id: '', partId: it.partId, refdes: it.refdes, x: 0, y: 0, rotation: rotation[i], mirror: false, params: {} }, it.def);
    return bb;
  });
  const columns = new Map<number, number[]>();
  for (const i of order) {
    if (!columns.has(col[i])) columns.set(col[i], []);
    columns.get(col[i])!.push(i);
  }
  const colIds = [...columns.keys()].sort((a, b) => a - b);
  const placed: Placed[] = new Array(items.length);
  const fixed = items.length > 0 && items.every((it) => it.at);
  const place = (i: number, inst: PartInstance) => {
    if (items[i].modelOverride) inst.modelOverride = items[i].modelOverride;
    const pins = items[i].pins.map((p) => {
      const def = items[i].def.symbol.pins.find((q) => q.name === p.pin)!;
      return { pin: p.pin, node: p.node, at: localToSheet({ x: def.x, y: def.y }, inst), out: pinOutward(def, items[i].def, inst) };
    });
    placed[i] = { item: items[i], inst, pins };
  };
  if (fixed) {
    // keep the source drawing: positions on the grid, moved right while they overlap a placed part
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const overlaps = (b: { x: number; y: number; w: number; h: number }) => boxes.some((o) => b.x < o.x + o.w + 20 && o.x < b.x + b.w + 20 && b.y < o.y + o.h + 20 && o.y < b.y + b.h + 20);
    const orderFixed = items.map((_, i) => i).sort((a, b) => items[a].at!.y - items[b].at!.y || items[a].at!.x - items[b].at!.x);
    for (const i of orderFixed) {
      const at = items[i].at!;
      const inst: PartInstance = { id: `p${i + 1}`, partId: items[i].partId, refdes: items[i].refdes, x: snap(at.x), y: snap(at.y), rotation: at.rotation, mirror: at.mirror, params: { ...items[i].params } };
      for (let step = 0; step < 400; step++) {
        const bb = instanceBBox(inst, items[i].def);
        if (!overlaps(bb)) break;
        inst.x += G;
      }
      boxes.push(instanceBBox(inst, items[i].def));
      place(i, inst);
    }
  }
  let x0 = 100;
  for (const c of fixed ? [] : colIds) {
    const list = columns.get(c)!;
    const width = Math.max(...list.map((i) => sizes[i].w));
    let y = 100;
    for (const i of list) {
      const bb = sizes[i];
      // origin so that the body's left edge is at the column start and its top at y
      const ox = snap(x0 + (width - bb.w) / 2 - bb.x);
      const oy = snap(y - bb.y);
      const inst: PartInstance = { id: `p${i + 1}`, partId: items[i].partId, refdes: items[i].refdes, x: ox, y: oy, rotation: rotation[i], mirror: false, params: { ...items[i].params } };
      place(i, inst);
      y += bb.h + ROW_GAP;
    }
    x0 += width + COL_GAP;
  }

  const parts: PartInstance[] = placed.map((p) => p.inst);
  const wires: Wire[] = [];
  const labels: NetLabel[] = [];
  let seq = 0;
  const wid = () => `w${++seq}`;
  const lid = () => `l${++seq}`;

  // ---- routing grid
  const all = placed.flatMap((p) => {
    const bb = instanceBBox(p.inst, p.item.def);
    return [bb];
  });
  const minX = Math.min(...all.map((b) => b.x), 0) - 120;
  const minY = Math.min(...all.map((b) => b.y), 0) - 120;
  const maxX = Math.max(...all.map((b) => b.x + b.w), 0) + 120;
  const maxY = Math.max(...all.map((b) => b.y + b.h), 0) + 160;
  const W = Math.ceil((maxX - minX) / G) + 1;
  const H = Math.ceil((maxY - minY) / G) + 1;
  const idx = (p: Point) => Math.round((p.y - minY) / G) * W + Math.round((p.x - minX) / G);
  const pt = (k: number): Point => ({ x: minX + (k % W) * G, y: minY + Math.floor(k / W) * G });
  /** 0 free, 1 blocked (body / ground), 2 pin, 3 wire H, 4 wire V, 5 wire corner / end */
  const cell = new Uint8Array(W * H);
  const owner = new Int32Array(W * H).fill(-1);
  const netIds = new Map<string, number>();
  const netId = (n: string) => {
    if (!netIds.has(n)) netIds.set(n, netIds.size);
    return netIds.get(n)!;
  };
  for (const p of placed) {
    const bb = instanceBBox(p.inst, p.item.def);
    for (let y = Math.ceil(bb.y / G) * G; y <= bb.y + bb.h; y += G) for (let x = Math.ceil(bb.x / G) * G; x <= bb.x + bb.w; x += G) cell[idx({ x, y })] = 1;
  }
  for (const p of placed) {
    for (const pin of p.pins) {
      const k = idx(pin.at);
      cell[k] = 2;
      owner[k] = isGroundNode(pin.node) ? -2 : netId(pin.node);
    }
  }

  // ---- ground symbols
  let grounds = 0;
  for (const p of placed) {
    for (const pin of p.pins) {
      if (!isGroundNode(pin.node)) continue;
      grounds += 1;
      if (pin.out.y < 0) {
        labels.push({ id: lid(), x: pin.at.x, y: pin.at.y, name: 'GND', rotation: 0 });
        continue;
      }
      // a 20-unit stub away from the body, the ground symbol hanging below its end
      const at = { x: pin.at.x + pin.out.x * 20, y: pin.at.y + pin.out.y * 20 };
      wires.push({ id: wid(), points: [pin.at, at] });
      // the stub is an obstacle: no other wire may run along it
      for (let t = 0; t <= 20; t += G) {
        const k = idx({ x: pin.at.x + pin.out.x * t, y: pin.at.y + pin.out.y * t });
        if (cell[k] !== 2) cell[k] = 1;
      }
      parts.push({ id: `g${grounds}`, partId: 'sources/ground', refdes: `GND${grounds}`, x: at.x, y: at.y, rotation: 0, mirror: false, params: {} });
      for (let y = at.y; y <= at.y + 30; y += G) for (let x = at.x - 20; x <= at.x + 20; x += G) if (cell[idx({ x, y })] === 0) cell[idx({ x, y })] = 1;
    }
  }

  // ---- nets
  const pinsByNet = new Map<string, { at: Point; out: Point }[]>();
  for (const p of placed) for (const pin of p.pins) {
    if (isGroundNode(pin.node)) continue;
    if (!pinsByNet.has(pin.node)) pinsByNet.set(pin.node, []);
    pinsByNet.get(pin.node)!.push({ at: pin.at, out: pin.out });
  }
  const netOrder = [...pinsByNet.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));

  const route = (net: number, from: Point, targets: Set<number>, start: Point): number[] | null => {
    // A* from `from` to any target cell; state = cell * 4 + direction
    const s = idx(from);
    const h = (k: number) => {
      const p = pt(k);
      return (Math.abs(p.x - start.x) + Math.abs(p.y - start.y)) / G;
    };
    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    const open: [number, number][] = [];
    const push = (state: number, f: number) => {
      open.push([f, state]);
      let i = open.length - 1;
      while (i > 0) {
        const j = (i - 1) >> 1;
        if (open[j][0] <= open[i][0]) break;
        [open[i], open[j]] = [open[j], open[i]];
        i = j;
      }
    };
    const pop = (): [number, number] => {
      const top = open[0];
      const last = open.pop()!;
      if (open.length) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < open.length && open[l][0] < open[m][0]) m = l;
          if (r < open.length && open[r][0] < open[m][0]) m = r;
          if (m === i) break;
          [open[i], open[m]] = [open[m], open[i]];
          i = m;
        }
      }
      return top;
    };
    const steps = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let d = 0; d < 4; d++) {
      dist.set(s * 4 + d, 0);
      push(s * 4 + d, h(s));
    }
    let expansions = 0;
    while (open.length && expansions < 60000) {
      const [, state] = pop();
      expansions += 1;
      const k = state >> 2;
      const d = state & 3;
      const g = dist.get(state)!;
      if (k !== s && targets.has(k)) {
        const path = [k];
        let st = state;
        while (prev.has(st)) {
          st = prev.get(st)!;
          path.push(st >> 2);
        }
        return path.reverse().filter((c, i, a) => i === 0 || c !== a[i - 1]);
      }
      const p = pt(k);
      for (let nd = 0; nd < 4; nd++) {
        const nx = p.x + steps[nd][0] * G;
        const ny = p.y + steps[nd][1] * G;
        if (nx < minX || ny < minY || nx > maxX || ny > maxY) continue;
        const nk = idx({ x: nx, y: ny });
        const c = cell[nk];
        const horizontal = nd < 2;
        let cost = 1;
        if (targets.has(nk)) {
          /* the goal: a pin of the net or a cell of its tree */
        } else if (c === 1 || c === 2 || c === 5) continue;
        else if (c === 3 || c === 4) {
          if (owner[nk] === net) continue;
          // only straight perpendicular crossings of another net
          if ((c === 3 && horizontal) || (c === 4 && !horizontal)) continue;
          cost += 6;
        }
        if (k !== s && nd !== d) {
          // no corner on top of another net's wire
          if (cell[k] === 3 || cell[k] === 4) continue;
          cost += 4;
        }
        // leaving the start pin: go outward first
        const ns = nk * 4 + nd;
        const ng = g + cost;
        if (ng < (dist.get(ns) ?? Infinity)) {
          dist.set(ns, ng);
          prev.set(ns, state);
          push(ns, ng + h(nk));
        }
      }
    }
    return null;
  };

  /** Draw a routed path; returns its cells that later branches of the net may end on (no crossings). */
  const commitPath = (net: number, path: number[]): number[] => {
    const safe: number[] = [];
    const pts = path.map(pt);
    // polyline: keep the corners
    const poly: Point[] = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];
      if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) continue;
      poly.push(b);
    }
    poly.push(pts[pts.length - 1]);
    wires.push({ id: wid(), points: poly });
    for (let i = 0; i < path.length; i++) {
      const k = path[i];
      if (cell[k] === 2) continue;
      const a = pts[i - 1];
      const c = pts[i + 1];
      const isEnd = i === 0 || i === path.length - 1;
      const corner = !isEnd && a && c && !(a.x === c.x || a.y === c.y);
      const prevKind = cell[k];
      let kind: number;
      if (isEnd || corner) kind = 5;
      else kind = a.y === pts[i].y ? 3 : 4;
      // crossing another net: the cell becomes blocked for further wires
      const crossing = (prevKind === 3 || prevKind === 4) && owner[k] !== net;
      if (crossing) kind = 5;
      else {
        owner[k] = net;
        safe.push(k);
      }
      cell[k] = kind;
    }
    return safe;
  };

  for (const [name, pins] of netOrder) {
    const net = netId(name);
    if (pins.length < 2) {
      labels.push({ id: lid(), x: pins[0].at.x, y: pins[0].at.y, name, rotation: 0 });
      continue;
    }
    const span = Math.max(...pins.map((p) => p.at.x)) - Math.min(...pins.map((p) => p.at.x)) + Math.max(...pins.map((p) => p.at.y)) - Math.min(...pins.map((p) => p.at.y));
    let ok = pins.length < LABEL_NET_PINS && span < 1600;
    const tree = new Set<number>();
    if (ok) {
      tree.add(idx(pins[0].at));
      // connect the other pins, nearest first
      const rest = pins.slice(1).sort((a, b) => Math.abs(a.at.x - pins[0].at.x) + Math.abs(a.at.y - pins[0].at.y) - (Math.abs(b.at.x - pins[0].at.x) + Math.abs(b.at.y - pins[0].at.y)));
      for (const p of rest) {
        const path = route(net, p.at, tree, pins[0].at);
        if (!path) {
          ok = false;
          break;
        }
        for (const k of commitPath(net, path)) tree.add(k);
        tree.add(idx(p.at));
      }
    }
    if (ok && opts.unnamed?.has(name)) continue;
    if (ok) {
      // the SPICE node name, on a straight stretch of the net's own wire (never on a crossing)
      const straight = [...tree].filter((k) => (cell[k] === 3 || cell[k] === 4) && owner[k] === net);
      const k = straight.length ? straight[Math.floor(straight.length / 2)] : idx(pins[0].at);
      const at = pt(k);
      labels.push({ id: lid(), x: at.x, y: at.y, name, rotation: 0 });
      // no later wire may cross the label (it would join that net)
      if (cell[k] !== 2) cell[k] = 5;
    } else {
      for (const p of pins) labels.push({ id: lid(), x: p.at.x, y: p.at.y, name, rotation: 0 });
      notes.push({ kind: 'label', net: name });
    }
  }
  return { parts, wires, labels, grounds };
}
