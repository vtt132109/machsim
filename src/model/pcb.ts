/**
 * Transfer to PCB software (pure):
 *
 *   pcbComponents(design)            physical parts (no power symbols, instruments, virtual parts or
 *                                    excludeFromBom parts) with refdes path, value, footprint, a stable
 *                                    uid (the instance id, "<block id>/<part id>" inside blocks) and
 *                                    every pin with its physical number and net
 *   kicadNetlist(design, meta)       KiCad s-expression netlist ("(export (version "E") …)") with
 *                                    components, footprints, tstamps = uid, and nets
 *   csvNetlist(design)               generic pin list: Reference,Value,Footprint,Pin,PinName,Net,Uid
 *   readNetlistSnapshot(text)        components + pin nets of a netlist exported earlier (either form)
 *   forwardAnnotation(old, design)   the changes since that export -> AnnotationChange[]
 *   annotationText(changes, dir)     MachSim annotation file ("MachSim annotation\t1" …)
 *   parseAnnotation(text)            commands of an annotation file (also bare "old new" rename pairs)
 *   applyBackAnnotation(design, cmds) rename / value / footprint changes applied to the schematic
 *
 * Pin numbers are PinDef.number (the pin name when the symbol has none). Net names are the label /
 * auto names of the schematic ("0" for ground is written as "GND"). Footprints come from the part's
 * BOM / PCB fields (PartInstance.fields.footprint) or the library part.
 */
import { getPart } from '../library';
import type { PartDef } from '../library/types';
import { partFields, partValue } from './bom';
import { designPartLookup } from './hierarchy';
import { buildNetlist, type NetlistBuildEx } from './netlister';
import { isVirtualPart, placedParts } from './reports';
import { partLocked } from './restrictions';
import { packageParts } from './sections';
import { pcbNetLookup } from './netSettings';
import type { Design, PartInstance } from './types';

export interface PcbPin {
  number: string;
  name: string;
  net: string;
}

export interface PcbComponent {
  ref: string;
  value: string;
  footprint: string;
  uid: string;
  partId: string;
  description: string;
  pins: PcbPin[];
}

/** Net name for PCB tools (ground "0" becomes GND). */
const pcbNetName = (n: string): string => (n === '0' ? 'GND' : n);

function safeBuild(design: Design): NetlistBuildEx | null {
  try {
    return buildNetlist(design, { includeAnalysis: false });
  } catch {
    return null;
  }
}

/** Block instance ids along a part path (for uids inside blocks). */
function blockUid(design: Design, prefix: string, inst: PartInstance): string {
  if (!prefix) return inst.id;
  // the block refdes path maps to instance ids level by level
  const ids: string[] = [];
  let sheets = design.sheets;
  for (const ref of prefix.split('/').filter(Boolean)) {
    const block = sheets.flatMap((s) => s.parts).find((p) => p.refdes === ref);
    if (!block) break;
    ids.push(block.id);
    const child = design.children?.find((c) => `hier:${c.id}` === block.partId);
    sheets = child?.sheets ?? [];
  }
  return [...ids, inst.id].join('/');
}

export function pcbComponents(design: Design, build: NetlistBuildEx | null = safeBuild(design)): PcbComponent[] {
  const byNode = new Map((build?.nets ?? []).map((n) => [n.name, n.displayName]));
  const out: PcbComponent[] = [];
  // the placed sections of a multi-section package are one component with all of its pins
  for (const p of packageParts(placedParts(design), getPart)) {
    if (isVirtualPart(p.def) || p.inst.excludeFromBom) continue;
    const nets = build?.partNets[p.path] ?? {};
    out.push({
      ref: p.path,
      value: partValue(p.def, p.params),
      footprint: partFields(p.inst, p.def).footprint,
      uid: blockUid(design, p.prefix, p.inst),
      partId: p.def.id,
      description: p.def.description,
      pins: p.def.symbol.pins.map((pin) => {
        const node = nets[pin.name];
        const net = node === undefined || node.startsWith('NC_') ? '' : pcbNetName(byNode.get(node) ?? node);
        return { number: pin.number ?? pin.name, name: pin.name, net };
      }),
    });
  }
  return out;
}

/** Nets with their (ref, pin number) nodes, sorted by name. */
export function pcbNets(components: PcbComponent[]): { name: string; nodes: { ref: string; pin: string }[] }[] {
  const map = new Map<string, { ref: string; pin: string }[]>();
  for (const c of components) {
    for (const p of c.pins) {
      if (!p.net) continue;
      if (!map.has(p.net)) map.set(p.net, []);
      map.get(p.net)!.push({ ref: c.ref, pin: p.number });
    }
  }
  return [...map.entries()].map(([name, nodes]) => ({ name, nodes })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

// ---------------------------------------------------------------------------------------------
// KiCad s-expression netlist

const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export interface NetlistMeta {
  source: string;
  date: string;
  tool: string;
}

export function kicadNetlist(design: Design, meta: NetlistMeta): string {
  const comps = pcbComponents(design);
  const props = pcbNetLookup(design);
  const lines: string[] = ['(export (version "E")', '  (design', `    (source ${q(meta.source)})`, `    (date ${q(meta.date)})`, `    (tool ${q(meta.tool)}))`, '  (components'];
  for (const c of comps) {
    lines.push(`    (comp (ref ${q(c.ref)})`);
    lines.push(`      (value ${q(c.value)})`);
    lines.push(`      (footprint ${q(c.footprint)})`);
    lines.push(`      (libsource (lib "machsim") (part ${q(c.partId)}) (description ${q(c.description)}))`);
    lines.push(`      (tstamps ${q(c.uid)}))`);
  }
  lines.push('  )', '  (nets');
  pcbNets(comps).forEach((n, i) => {
    lines.push(`    (net (code ${q(String(i + 1))}) (name ${q(n.name === 'GND' ? 'GND' : `/${n.name}`)})`);
    // net settings (Net settings dialog) as extra fields of the net, in mm — a MachSim extension
    // that PCB tools ignore when they do not know it (docs/ARCHITECTURE.md)
    const p = props(n.name === 'GND' ? '0' : n.name) ?? props(n.name);
    if (p?.netClass !== undefined) lines.push(`      (class ${q(p.netClass)})`);
    if (p?.width !== undefined) lines.push(`      (width ${q(String(p.width))})`);
    if (p?.clearance !== undefined) lines.push(`      (clearance ${q(String(p.clearance))})`);
    if (p?.layer !== undefined) lines.push(`      (layer ${q(p.layer)})`);
    for (const node of n.nodes) lines.push(`      (node (ref ${q(node.ref)}) (pin ${q(node.pin)}))`);
    lines[lines.length - 1] += ')';
  });
  lines.push('  )', ')');
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// generic CSV

const csv = (v: string): string => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const CSV_NETLIST_HEADER = ['Reference', 'Value', 'Footprint', 'Pin', 'PinName', 'Net', 'Uid'];

export function csvNetlist(design: Design): string {
  const lines = [CSV_NETLIST_HEADER.join(',')];
  for (const c of pcbComponents(design)) for (const p of c.pins) lines.push([c.ref, c.value, c.footprint, p.number, p.name, p.net, c.uid].map(csv).join(','));
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------------------------
// reading an earlier export

export interface NetlistSnapshot {
  components: { ref: string; value: string; footprint: string; uid: string }[];
  /** `${uid}#${pin}` -> net name */
  pinNets: Map<string, string>;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

type SExpr = string | SExpr[];

function parseSExpr(text: string): SExpr[] {
  const stack: SExpr[][] = [[]];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '(') {
      const list: SExpr[] = [];
      stack[stack.length - 1].push(list);
      stack.push(list);
      i++;
    } else if (ch === ')') {
      if (stack.length > 1) stack.pop();
      i++;
    } else if (ch === '"') {
      let s = '';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) i++;
        s += text[i];
        i++;
      }
      i++;
      stack[stack.length - 1].push(s);
    } else if (/\s/.test(ch)) i++;
    else {
      let s = '';
      while (i < text.length && !/[\s()"]/.test(text[i])) s += text[i++];
      stack[stack.length - 1].push(s);
    }
  }
  return stack[0];
}

const field = (list: SExpr[], key: string): string => {
  const f = list.find((x) => Array.isArray(x) && x[0] === key) as SExpr[] | undefined;
  return f && typeof f[1] === 'string' ? f[1] : '';
};

/** Components and pin nets of a KiCad (s-expression) or MachSim CSV netlist; throws on other text. */
export function readNetlistSnapshot(text: string): NetlistSnapshot {
  const trimmed = text.trim();
  const snap: NetlistSnapshot = { components: [], pinNets: new Map() };
  if (trimmed.startsWith('(')) {
    const root = parseSExpr(trimmed).find((x) => Array.isArray(x) && x[0] === 'export') as SExpr[] | undefined;
    if (!root) throw new Error('not a KiCad netlist (no export block)');
    const comps = (root.find((x) => Array.isArray(x) && x[0] === 'components') as SExpr[] | undefined) ?? [];
    const uidOf = new Map<string, string>();
    for (const c of comps) {
      if (!Array.isArray(c) || c[0] !== 'comp') continue;
      const ref = field(c, 'ref');
      const uid = field(c, 'tstamps') || field(c, 'tstamp') || ref;
      uidOf.set(ref, uid);
      snap.components.push({ ref, value: field(c, 'value'), footprint: field(c, 'footprint'), uid });
    }
    const nets = (root.find((x) => Array.isArray(x) && x[0] === 'nets') as SExpr[] | undefined) ?? [];
    for (const n of nets) {
      if (!Array.isArray(n) || n[0] !== 'net') continue;
      const name = field(n, 'name').replace(/^\//, '');
      for (const node of n) {
        if (!Array.isArray(node) || node[0] !== 'node') continue;
        const ref = field(node, 'ref');
        snap.pinNets.set(`${uidOf.get(ref) ?? ref}#${field(node, 'pin')}`, name);
      }
    }
    return snap;
  }
  const lines = trimmed.split(/\r?\n/);
  const head = parseCsvLine(lines[0] ?? '');
  const idx = (k: string) => head.findIndex((h) => h.trim().toLowerCase() === k.toLowerCase());
  const [ri, vi, fi, pi, ni, ui] = ['Reference', 'Value', 'Footprint', 'Pin', 'Net', 'Uid'].map(idx);
  if (ri < 0 || pi < 0 || ni < 0) throw new Error('not a MachSim CSV netlist (Reference, Pin and Net columns are needed)');
  const seen = new Set<string>();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const ref = f[ri] ?? '';
    const uid = (ui >= 0 ? f[ui] : '') || ref;
    if (!seen.has(uid)) {
      seen.add(uid);
      snap.components.push({ ref, value: vi >= 0 ? f[vi] ?? '' : '', footprint: fi >= 0 ? f[fi] ?? '' : '', uid });
    }
    snap.pinNets.set(`${uid}#${f[pi] ?? ''}`, f[ni] ?? '');
  }
  return snap;
}

// ---------------------------------------------------------------------------------------------
// annotation

export type AnnotationChange =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'value'; ref: string; from: string; to: string }
  | { kind: 'footprint'; ref: string; from: string; to: string }
  | { kind: 'add'; ref: string; value: string; footprint: string }
  | { kind: 'remove'; ref: string }
  | { kind: 'net'; ref: string; pin: string; from: string; to: string };

/** Changes of the schematic since `old` was exported (parts matched by uid, then by refdes). */
export function forwardAnnotation(old: NetlistSnapshot, design: Design): AnnotationChange[] {
  const now = pcbComponents(design);
  const out: AnnotationChange[] = [];
  const oldByUid = new Map(old.components.map((c) => [c.uid, c]));
  const oldByRef = new Map(old.components.map((c) => [c.ref, c]));
  const matched = new Set<string>();
  for (const c of now) {
    const o = oldByUid.get(c.uid) ?? oldByRef.get(c.ref);
    if (!o) {
      out.push({ kind: 'add', ref: c.ref, value: c.value, footprint: c.footprint });
      continue;
    }
    matched.add(o.uid);
    if (o.ref !== c.ref) out.push({ kind: 'rename', from: o.ref, to: c.ref });
    if (o.value !== c.value) out.push({ kind: 'value', ref: c.ref, from: o.value, to: c.value });
    if (o.footprint !== c.footprint) out.push({ kind: 'footprint', ref: c.ref, from: o.footprint, to: c.footprint });
    for (const p of c.pins) {
      const before = old.pinNets.get(`${o.uid}#${p.number}`) ?? '';
      if (before !== p.net && (before || p.net)) out.push({ kind: 'net', ref: c.ref, pin: p.number, from: before, to: p.net });
    }
  }
  for (const o of old.components) if (!matched.has(o.uid)) out.push({ kind: 'remove', ref: o.ref });
  return out;
}

export const ANNOTATION_HEADER = 'MachSim annotation\t1';

/** Annotation file text (tab-separated: kind, then its fields). */
export function annotationText(changes: AnnotationChange[], direction: 'forward' | 'backward', date: string): string {
  const lines = [ANNOTATION_HEADER, `Direction\t${direction}`, `Date\t${date}`, '***'];
  for (const c of changes) {
    switch (c.kind) {
      case 'rename':
        lines.push(`rename\t${c.from}\t${c.to}`);
        break;
      case 'value':
      case 'footprint':
        lines.push(`${c.kind}\t${c.ref}\t${c.from}\t${c.to}`);
        break;
      case 'add':
        lines.push(`add\t${c.ref}\t${c.value}\t${c.footprint}`);
        break;
      case 'remove':
        lines.push(`remove\t${c.ref}`);
        break;
      case 'net':
        lines.push(`net\t${c.ref}\t${c.pin}\t${c.from}\t${c.to}`);
        break;
    }
  }
  return lines.join('\r\n') + '\r\n';
}

export interface AnnotationCommand {
  line: number;
  change: AnnotationChange;
}

export interface ParsedAnnotation {
  commands: AnnotationCommand[];
  /** lines that could not be read */
  errors: number[];
}

/**
 * Commands of an annotation file: the MachSim format ("rename R1 R5", "value R2 1k 4.7k" or
 * "value R2 4.7k", "footprint C1 0805", tab- or space-separated) or bare "old new" refdes pairs
 * (one rename per line, as PCB tools write after re-annotating the board). '#' / '*' lines and the
 * header are ignored.
 */
export function parseAnnotation(text: string): ParsedAnnotation {
  const out: ParsedAnnotation = { commands: [], errors: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith('#') || line.startsWith('*') || line === ANNOTATION_HEADER || /^(Direction|Date)\t/.test(raw)) return;
    // tab-separated (values may hold spaces: "2.2 kΩ"), else whitespace-separated
    const f = (raw.includes('\t') ? line.split('\t').map((x) => x.trim()) : line.split(/\s+/)).filter((x) => x !== '');
    const kind = f[0].toLowerCase();
    const push = (change: AnnotationChange) => out.commands.push({ line: n, change });
    if (kind === 'rename' && f.length >= 3) push({ kind: 'rename', from: f[1], to: f[2] });
    else if ((kind === 'value' || kind === 'footprint') && f.length >= 3) push({ kind, ref: f[1], from: f.length >= 4 ? f[2] : '', to: f[f.length - 1] });
    else if (kind === 'add' && f.length >= 2) push({ kind: 'add', ref: f[1], value: f[2] ?? '', footprint: f[3] ?? '' });
    else if (kind === 'remove' && f.length >= 2) push({ kind: 'remove', ref: f[1] });
    else if (kind === 'net' && f.length >= 4) push({ kind: 'net', ref: f[1], pin: f[2], from: f.length >= 5 ? f[3] : '', to: f[f.length - 1] });
    else if (f.length === 2 && /^[A-Za-z]+\d+[A-Za-z]?$/.test(f[0]) && /^[A-Za-z]+\d+[A-Za-z]?$/.test(f[1])) push({ kind: 'rename', from: f[0], to: f[1] });
    else out.errors.push(n);
  });
  return out;
}

export type BackAnnotationSkip = 'unknownRef' | 'refTaken' | 'noValue' | 'locked' | 'unsupported';

export interface BackAnnotationResult {
  design: Design;
  applied: number;
  skipped: { line: number; reason: BackAnnotationSkip; ref: string; kind: string }[];
}

/** The parameter a PCB "value" sets: the first showOnSchematic number / text parameter. */
function valueParam(def: PartDef): string | undefined {
  return def.params.find((p) => p.showOnSchematic && (p.kind === 'number' || p.kind === 'text'))?.key;
}

/**
 * Apply back-annotation commands to the root sheets: renames (done together, so swaps such as
 * R1 <-> R2 work), values and footprints. Add / remove / net changes concern the PCB only and are
 * reported as skipped. Parts locked by the instructor are left alone.
 */
export function applyBackAnnotation(design: Design, commands: AnnotationCommand[]): BackAnnotationResult {
  const lookup = designPartLookup(design, getPart);
  const skipped: BackAnnotationResult['skipped'] = [];
  const parts = design.sheets.flatMap((s) => s.parts);
  const byRef = new Map(parts.map((p) => [p.refdes, p]));
  const patch = new Map<string, Partial<PartInstance>>();
  const renames = new Map<string, string>();
  let applied = 0;
  for (const { line, change } of commands) {
    const ref = change.kind === 'rename' ? change.from : change.ref;
    if (change.kind === 'add' || change.kind === 'remove' || change.kind === 'net') {
      skipped.push({ line, reason: 'unsupported', ref, kind: change.kind });
      continue;
    }
    const inst = byRef.get(ref);
    if (!inst) {
      skipped.push({ line, reason: 'unknownRef', ref, kind: change.kind });
      continue;
    }
    if (partLocked(design, inst.id)) {
      skipped.push({ line, reason: 'locked', ref, kind: change.kind });
      continue;
    }
    const p = patch.get(inst.id) ?? {};
    if (change.kind === 'rename') renames.set(inst.id, change.to);
    else if (change.kind === 'footprint') p.fields = { ...(inst.fields ?? {}), ...(p.fields ?? {}), footprint: change.to };
    else {
      const def = lookup(inst.partId);
      const key = def ? valueParam(def) : undefined;
      if (!key) {
        skipped.push({ line, reason: 'noValue', ref, kind: change.kind });
        continue;
      }
      p.params = { ...inst.params, ...(p.params ?? {}), [key]: change.to };
    }
    patch.set(inst.id, p);
    applied += 1;
  }
  // renames: the final set of reference designators must stay unique
  const finalRef = new Map(parts.map((p) => [p.id, renames.get(p.id) ?? p.refdes]));
  const counts = new Map<string, number>();
  for (const r of finalRef.values()) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const [id, to] of renames) {
    if ((counts.get(to) ?? 0) > 1) {
      const line = commands.find((c) => c.change.kind === 'rename' && c.change.to === to)?.line ?? 0;
      skipped.push({ line, reason: 'refTaken', ref: to, kind: 'rename' });
      renames.delete(id);
      applied -= 1;
    }
  }
  const next: Design = {
    ...design,
    sheets: design.sheets.map((s) => ({
      ...s,
      parts: s.parts.map((p) => {
        const pp = patch.get(p.id);
        const r = renames.get(p.id);
        return pp || r ? { ...p, ...(pp ?? {}), ...(r ? { refdes: r } : {}) } : p;
      }),
    })),
  };
  return { design: next, applied, skipped };
}

