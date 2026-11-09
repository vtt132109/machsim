/**
 * KiCad schematic import (.kicad_sch, the public s-expression format of KiCad 6 and later).
 *
 *   kicadToNetlist(text, fileName) -> ImportedNetlist (src/model/importSchematic.ts)
 *   importKicad(text, opts)        -> SchematicImportResult (design + notes)
 *
 * Read: `lib_symbols` (pins of every unit with their connection points and names; `(power)`
 * symbols), placed `symbol`s (lib_id, at x y angle, mirror, unit, Reference / Value / Footprint and
 * Sim.* / Spice_* properties), `wire`s, `junction`s, `label` / `global_label` /
 * `hierarchical_label`. Connectivity follows KiCad's rules: anything at a wire end connects; a wire
 * end, pin, label or junction lying on another wire connects to it (crossing wires without a
 * junction do not); labels with the same name are one net; power symbols name a global net by their
 * Value; hidden power-input pins join the net named after the pin. Units of a multi-unit part are
 * merged by reference. Not read: buses, hierarchical sub-sheets (reported), graphics.
 *
 * Unannotated sheets. KiCad writes "R?" (or a bare "R") for a symbol whose designator has not been
 * assigned yet, and that is "not numbered", never "the same part": merging by reference would
 * collapse every resistor of a sheet the learner never ran Annotate on into one component. Such
 * symbols are therefore kept apart, each gets the next free designator of its prefix (R1, R2 …,
 * skipping the numbers the annotated symbols already use) and a warning says so.
 *
 * Coordinates: library pins are y-up, the sheet is y-down; a placed symbol's pin is
 * rotate(angle, counter-clockwise)·flip-y(pin), then mirrored (`mirror x` flips vertically, `mirror
 * y` horizontally), plus the symbol position. Sheet millimetres become MachSim units at
 * 1.27 mm (KiCad's 50 mil grid) = 10 units (MachSim's grid).
 */
import { atom, child, children, head, parseSexpr, type SNode } from '../util/sexpr';
import { importedToDesign, isGroundName, type ImportedComponent, type ImportedNetlist, type SchematicImportResult } from './importSchematic';

/** MachSim units per KiCad millimetre. */
export const KICAD_SCALE = 10 / 1.27;

interface LibPin {
  number: string;
  name: string;
  x: number;
  y: number;
  /** pin type: passive, power_in … */
  type: string;
  hidden: boolean;
  unit: number;
}

interface LibSymbol {
  power: boolean;
  pins: LibPin[];
}

const key = (x: number, y: number) => `${Math.round(x * 1000)},${Math.round(y * 1000)}`;

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    if (!this.parent.has(a)) {
      this.parent.set(a, a);
      return a;
    }
    let root = a;
    for (let up = this.parent.get(root)!; up !== root; up = this.parent.get(root)!) root = up;
    // path compression
    for (let cur = a; cur !== root; ) {
      const next: string = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function num(n: SNode | undefined): number {
  const v = Number(atom(n));
  return Number.isFinite(v) ? v : 0;
}

function prop(list: SNode[], name: string): string | undefined {
  for (const p of children(list, 'property')) if (atom(p[1]) === name) return atom(p[2]);
  return undefined;
}

function libSymbols(root: SNode[]): Map<string, LibSymbol> {
  const out = new Map<string, LibSymbol>();
  const libs = child(root, 'lib_symbols');
  for (const sym of children(libs, 'symbol')) {
    const name = atom(sym[1]);
    const pins: LibPin[] = [];
    const collect = (node: SNode[], unit: number) => {
      for (const pin of children(node, 'pin')) {
        const at = child(pin, 'at');
        pins.push({
          type: atom(pin[1]),
          number: atom(child(pin, 'number')?.[1]),
          name: atom(child(pin, 'name')?.[1]),
          x: num(at?.[1]),
          y: num(at?.[2]),
          hidden: pin.some((x) => atom(x) === 'hide') || atom(child(pin, 'hide')?.[1]) === 'yes',
          unit,
        });
      }
    };
    collect(sym, 0);
    for (const sub of children(sym, 'symbol')) {
      // "R_1_1": unit 1, body style 1; unit 0 pins belong to every unit; De Morgan style 2 is skipped
      const m = /_(\d+)_(\d+)$/.exec(atom(sub[1]));
      const unit = m ? Number(m[1]) : 0;
      const style = m ? Number(m[2]) : 1;
      if (style > 1) continue;
      collect(sub, unit);
    }
    out.set(name, { power: !!child(sym, 'power'), pins });
  }
  return out;
}

/** Sheet position (mm) of a library pin of a symbol at (x, y, angle) with mirror flags. */
export function kicadPinPosition(pin: { x: number; y: number }, at: { x: number; y: number; angle: number }, mirror: { x: boolean; y: boolean }): { x: number; y: number } {
  const sx = pin.x;
  const sy = -pin.y;
  const a = (at.angle * Math.PI) / 180;
  const c = Math.round(Math.cos(a) * 1e9) / 1e9;
  const s = Math.round(Math.sin(a) * 1e9) / 1e9;
  let x = sx * c + sy * s;
  let y = -sx * s + sy * c;
  if (mirror.x) y = -y;
  if (mirror.y) x = -x;
  return { x: at.x + x, y: at.y + y };
}

interface Segment {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

function onSegment(px: number, py: number, s: Segment): boolean {
  const tol = 1e-3;
  const minX = Math.min(s.ax, s.bx) - tol;
  const maxX = Math.max(s.ax, s.bx) + tol;
  const minY = Math.min(s.ay, s.by) - tol;
  const maxY = Math.max(s.ay, s.by) + tol;
  if (px < minX || px > maxX || py < minY || py > maxY) return false;
  const cross = (s.bx - s.ax) * (py - s.ay) - (s.by - s.ay) * (px - s.ax);
  const len = Math.hypot(s.bx - s.ax, s.by - s.ay) || 1;
  return Math.abs(cross) / len < tol;
}

/** Connectivity of a KiCad schematic as an ImportedNetlist. */
export function kicadToNetlist(text: string, fileName = ''): ImportedNetlist {
  const root = parseSexpr(text);
  if (head(root) !== 'kicad_sch') throw new Error(`not a KiCad schematic (the file starts with "${head(root) || '?'}", expected kicad_sch)`);
  const warnings: string[] = [];
  const libs = libSymbols(root);
  const uf = new UnionFind();
  const segments: Segment[] = [];
  const points: { k: string; x: number; y: number }[] = [];
  const point = (prefixKey: string, x: number, y: number) => {
    const k = `${prefixKey}@${key(x, y)}`;
    points.push({ k, x, y });
    uf.union(k, `pt@${key(x, y)}`);
    return k;
  };
  // wires
  children(root, 'wire').forEach((w, i) => {
    const pts = children(child(w, 'pts'), 'xy').map((xy) => ({ x: num(xy[1]), y: num(xy[2]) }));
    for (let j = 0; j + 1 < pts.length; j++) {
      const id = `wire${i}.${j}`;
      segments.push({ id, ax: pts[j].x, ay: pts[j].y, bx: pts[j + 1].x, by: pts[j + 1].y });
      uf.union(id, point('wend', pts[j].x, pts[j].y));
      uf.union(id, point('wend', pts[j + 1].x, pts[j + 1].y));
    }
  });
  if (children(root, 'bus').length) warnings.push('buses are not imported (their bus entries are ignored)');
  if (children(root, 'sheet').length) warnings.push(`${children(root, 'sheet').length} hierarchical sub-sheet(s) are not imported: open each sub-sheet file separately`);
  for (const j of children(root, 'junction')) {
    const at = child(j, 'at');
    point('junction', num(at?.[1]), num(at?.[2]));
  }
  // labels: same name = same net
  const namedNets = new Set<string>();
  const powerNets = new Set<string>();
  for (const kind of ['label', 'global_label', 'hierarchical_label']) {
    for (const l of children(root, kind)) {
      const name = atom(l[1]);
      const at = child(l, 'at');
      if (!name) continue;
      namedNets.add(name);
      uf.union(point('label', num(at?.[1]), num(at?.[2])), `name@${name}`);
    }
  }
  if (children(root, 'hierarchical_label').length) warnings.push('hierarchical labels are imported as net labels of this sheet');

  // placed symbols
  interface Placed {
    ref: string;
    libId: string;
    value: string;
    fields: Record<string, string>;
    at: { x: number; y: number; angle: number };
    pins: { number: string; name: string; k: string; x: number; y: number }[];
    /** false for "R?" / "R" / "": KiCad has not annotated this symbol yet */
    annotated: boolean;
  }
  const placed: Placed[] = [];
  let placedCount = 0;
  for (const sym of children(root, 'symbol')) {
    const libId = atom(child(sym, 'lib_id')?.[1]);
    const lib = libs.get(libId);
    const atL = child(sym, 'at');
    const at = { x: num(atL?.[1]), y: num(atL?.[2]), angle: num(atL?.[3]) };
    const mir = atom(child(sym, 'mirror')?.[1]);
    const mirror = { x: mir === 'x', y: mir === 'y' };
    const unit = num(child(sym, 'unit')?.[1]) || 1;
    const ref = prop(sym, 'Reference') ?? '';
    const value = prop(sym, 'Value') ?? '';
    if (!lib) {
      warnings.push(`${ref || libId}: library symbol ${libId} is missing from lib_symbols`);
      continue;
    }
    const libPins = lib.pins.filter((p) => p.unit === 0 || p.unit === unit);
    if (lib.power) {
      const name = value || libId.split(':').pop() || 'PWR';
      for (const p of libPins) {
        const pos = kicadPinPosition(p, at, mirror);
        uf.union(point('power', pos.x, pos.y), `name@${name}`);
      }
      namedNets.add(name);
      if (!isGroundName(name)) powerNets.add(name);
      continue;
    }
    const fields: Record<string, string> = {};
    for (const p of children(sym, 'property')) {
      const k = atom(p[1]);
      if (k !== 'Reference' && k !== 'Value') fields[k] = atom(p[2]);
    }
    // an unannotated symbol is its own part: its pin keys must not be shared with the next "R?"
    const annotated = /\d$/.test(ref.trim());
    const instance = annotated ? ref : `?${++placedCount}`;
    const pins = libPins.map((p) => {
      const pos = kicadPinPosition(p, at, mirror);
      // hidden power-input pins connect to the global net named after the pin (classic KiCad rule)
      const k = point(`pin:${instance}:${p.number}`, pos.x, pos.y);
      if (p.hidden && p.type === 'power_in' && p.name && p.name !== '~') {
        uf.union(k, `name@${p.name}`);
        namedNets.add(p.name);
        if (!isGroundName(p.name)) powerNets.add(p.name);
      }
      return { number: p.number, name: p.name, k, x: pos.x, y: pos.y };
    });
    placed.push({ ref, libId, value, fields, at, pins, annotated });
  }
  // every point on a wire connects to that wire
  for (const pt of points) for (const s of segments) if (onSegment(pt.x, pt.y, s)) uf.union(pt.k, s.id);

  // net names: a label / power name in the set, else an automatic name
  const rootName = new Map<string, string>();
  const names = [...namedNets].sort((a, b) => Number(powerNets.has(b) || isGroundName(b)) - Number(powerNets.has(a) || isGroundName(a)) || a.localeCompare(b));
  for (const n of names) {
    const r = uf.find(`name@${n}`);
    if (!rootName.has(r)) rootName.set(r, n);
  }
  const autoName = new Map<string, string>();
  const netOf = (k: string, ref: string, pin: string): string => {
    const r = uf.find(k);
    const n = rootName.get(r);
    if (n) return n;
    if (!autoName.has(r)) autoName.set(r, `Net-(${ref}-Pad${pin})`);
    return autoName.get(r)!;
  };

  // components: the UNITS of one annotated reference are merged, unannotated symbols are not
  const byRef = new Map<string, ImportedComponent>();
  const usedNumbers = new Map<string, Set<number>>();
  for (const p of placed) {
    if (!p.annotated) continue;
    const m = /^(.*?)(\d+)$/.exec(p.ref.trim());
    if (!m) continue;
    const key = m[1].toUpperCase();
    if (!usedNumbers.has(key)) usedNumbers.set(key, new Set());
    usedNumbers.get(key)!.add(Number(m[2]));
  }
  /** Next free designator for an unannotated symbol ("R?" -> "R1", "R2" …). */
  const freeRefdes = (ref: string, libId: string): string => {
    const letters = (/^[A-Za-z_]+/.exec(ref.trim().replace(/\?+$/, '')) ?? [])[0] ?? (/^[A-Za-z]/.test(libId.split(':').pop() ?? '') ? (libId.split(':').pop() as string)[0].toUpperCase() : 'U');
    const key = letters.toUpperCase();
    if (!usedNumbers.has(key)) usedNumbers.set(key, new Set());
    const used = usedNumbers.get(key)!;
    let n = 1;
    while (used.has(n)) n++;
    used.add(n);
    return `${letters}${n}`;
  };
  let unannotated = 0;
  for (const p of placed) {
    const refdes = p.annotated ? p.ref : freeRefdes(p.ref, p.libId);
    if (!p.annotated) unannotated++;
    const pins = p.pins.map((q) => ({ number: q.number, ...(q.name && q.name !== '~' ? { name: q.name } : {}), net: netOf(q.k, refdes, q.number) }));
    const pinPos = Object.fromEntries(p.pins.map((q) => [q.number, { x: q.x * KICAD_SCALE, y: q.y * KICAD_SCALE }]));
    const existing = p.annotated ? byRef.get(p.ref) : undefined;
    if (existing) {
      for (const pin of pins) if (!existing.pins.some((x) => x.number === pin.number)) existing.pins.push(pin);
      // a multi-unit part has no single orientation to fit
      if (existing.at) existing.at.pins = {};
      continue;
    }
    byRef.set(p.annotated ? p.ref : `?${byRef.size}\u0000${refdes}`, {
      refdes,
      symbol: p.libId,
      value: p.value,
      pins,
      at: { x: p.at.x * KICAD_SCALE, y: p.at.y * KICAD_SCALE, pins: pinPos },
      fields: p.fields,
    });
  }

  const titleBlock = child(root, 'title_block');
  const title = atom(child(titleBlock, 'title')?.[1]) || fileName.replace(/\.kicad_sch$/i, '');
  return { title, source: 'kicad', fileName, components: [...byRef.values()], namedNets: [...namedNets], powerNets: [...powerNets], diodeNumbering: 'KA', warnings, ...(unannotated > 0 ? { unannotated } : {}) };
}

/** Import a KiCad schematic as a MachSim design. */
export function importKicad(text: string, opts: { fileName?: string; title?: string; sheetName?: string } = {}): SchematicImportResult {
  return importedToDesign(kicadToNetlist(text, opts.fileName ?? ''), opts);
}
