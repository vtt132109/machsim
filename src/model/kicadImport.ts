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
 * merged by reference. Not read: graphics.
 *
 * Buses. A `bus` is read as a bus wire with the name of the bus label on it (`D[0..7]`, `D[7..0]`,
 * a group `{A B C}` or a bus alias, written as a MachSim bus name); a `bus_entry` becomes a short
 * wire from the bus to where the entry's wire starts, with a bus-entry label naming the line (the
 * name is the net label of the wire that touches the entry; an entry whose wire has no label is
 * reported and left out). Connectivity itself never depends on the bus: KiCad joins lines by label
 * name, and so does MachSim.
 *
 * Hierarchical sheets. `hierarchical_label`s become hierarchical connectors of the sheet (`hierLabels`)
 * and each `sheet` symbol is returned in `sheets` with its pins connected to the nets of this sheet;
 * src/model/kicadProject.ts loads the sub-sheet files and turns each into a hierarchical block.
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
import { importedToDesign, isGroundName, type ImportedComponent, type ImportedNetlist, type ImportedSheet, type SchematicImportResult } from './importSchematic';
import { parseBusName } from './bus';

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

/**
 * A KiCad bus label as a MachSim bus name: `D[0..7]` and `D[7..0]` as they are, a group `{A B C}` as
 * `A,B,C`, a prefixed group `P{A B}` as `PA,PB`, a bus alias as the list of its members. Null when
 * the result is not a valid bus name.
 */
export function kicadBusName(raw: string, aliases: ReadonlyMap<string, readonly string[]> = new Map()): string | null {
  const t = raw.trim();
  let name = t;
  const group = /^([^{}\s]*)\{([^{}]*)\}$/.exec(t);
  if (group) {
    name = group[2]
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((m) => `${group[1]}${m}`)
      .join(',');
  } else if (aliases.has(t)) {
    name = (aliases.get(t) ?? []).join(',');
  }
  if (!name) return null;
  return parseBusName(name).error ? null : name;
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
  // ---- buses: segments, their connectivity, aliases and entries
  interface BusSeg extends Segment {
    line: number;
  }
  const busLines: { x: number; y: number }[][] = children(root, 'bus').map((b) => children(child(b, 'pts'), 'xy').map((xy) => ({ x: num(xy[1]), y: num(xy[2]) })));
  const busSegs: BusSeg[] = [];
  busLines.forEach((pts, line) => {
    for (let j = 0; j + 1 < pts.length; j++) busSegs.push({ id: `bus${line}.${j}`, line, ax: pts[j].x, ay: pts[j].y, bx: pts[j + 1].x, by: pts[j + 1].y });
  });
  const busAliases = new Map<string, string[]>();
  for (const a of children(root, 'bus_alias')) busAliases.set(atom(a[1]), children(a, 'members').flatMap((m) => m.slice(1).map(atom)));
  const busEntries = children(root, 'bus_entry').map((e) => {
    const at = child(e, 'at');
    const size = child(e, 'size');
    const x = num(at?.[1]);
    const y = num(at?.[2]);
    return { x, y, x2: x + num(size?.[1]), y2: y + num(size?.[2]) };
  });
  const onBus = (x: number, y: number): boolean => busSegs.some((s) => onSegment(x, y, s));
  const onWire = (x: number, y: number): boolean => segments.some((s) => onSegment(x, y, s));
  for (const j of children(root, 'junction')) {
    const at = child(j, 'at');
    point('junction', num(at?.[1]), num(at?.[2]));
  }
  // labels: same name = same net
  const namedNets = new Set<string>();
  const powerNets = new Set<string>();
  const hierLabels: string[] = [];
  const busLabels: { name: string; x: number; y: number }[] = [];
  for (const kind of ['label', 'global_label', 'hierarchical_label']) {
    for (const l of children(root, kind)) {
      const name = atom(l[1]);
      const at = child(l, 'at');
      if (!name) continue;
      const lx = num(at?.[1]);
      const ly = num(at?.[2]);
      // a label that sits on a bus (and on no wire) names the bus; so does a label whose text is a bus name
      if (onBus(lx, ly) && !onWire(lx, ly)) {
        busLabels.push({ name, x: lx, y: ly });
        continue;
      }
      if (kind === 'hierarchical_label') hierLabels.push(name);
      namedNets.add(name);
      uf.union(point('label', lx, ly), `name@${name}`);
    }
  }
  // sheet symbols: their pins join the nets of this sheet (a pin on a wire end, a label or a junction)
  interface SheetRef {
    name: string;
    file: string;
    x: number;
    y: number;
    w: number;
    h: number;
    pins: { name: string; type: string; k: string; x: number; y: number }[];
  }
  const sheetRefs: SheetRef[] = children(root, 'sheet').map((sh, si) => {
    const at = child(sh, 'at');
    const size = child(sh, 'size');
    const props = new Map(children(sh, 'property').map((p) => [atom(p[1]).replace(/\s+/g, '').toLowerCase(), atom(p[2])]));
    return {
      name: props.get('sheetname') ?? `Sheet${si + 1}`,
      file: props.get('sheetfile') ?? '',
      x: num(at?.[1]),
      y: num(at?.[2]),
      w: num(size?.[1]),
      h: num(size?.[2]),
      pins: children(sh, 'pin').map((p) => {
        const pat = child(p, 'at');
        const px = num(pat?.[1]);
        const py = num(pat?.[2]);
        return { name: atom(p[1]), type: atom(p[2]), k: point(`sheet${si}:${atom(p[1])}`, px, py), x: px, y: py };
      }),
    };
  });
  const entryKeys = busEntries.map((e, i) => {
    // the end that is not on a bus is where the entry's wire starts
    const firstOnBus = onBus(e.x, e.y);
    const wireEnd = firstOnBus ? { x: e.x2, y: e.y2 } : { x: e.x, y: e.y };
    const busEnd = firstOnBus ? { x: e.x, y: e.y } : { x: e.x2, y: e.y2 };
    return { busEnd, wireEnd, k: point(`entry${i}`, wireEnd.x, wireEnd.y), onBus: onBus(busEnd.x, busEnd.y) };
  });

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

  // ---- buses and entries in MachSim units
  const sc = (mm: number) => mm * KICAD_SCALE;
  const busUf = new UnionFind();
  for (const s of busSegs) {
    busUf.find(s.id);
    for (const o of busSegs) {
      if (o === s) continue;
      if (onSegment(s.ax, s.ay, o) || onSegment(s.bx, s.by, o)) busUf.union(s.id, o.id);
    }
  }
  const busNameOfNet = new Map<string, string>();
  for (const l of busLabels) {
    const seg = busSegs.find((s) => onSegment(l.x, l.y, s));
    if (seg) busNameOfNet.set(busUf.find(seg.id), l.name);
  }
  const buses: NonNullable<ImportedNetlist['buses']> = [];
  busLines.forEach((pts, line) => {
    const seg = busSegs.find((s) => s.line === line);
    const raw = seg ? busNameOfNet.get(busUf.find(seg.id)) : undefined;
    const name = raw === undefined ? undefined : kicadBusName(raw, busAliases);
    if (!name) {
      warnings.push(raw === undefined ? 'a bus has no label and is left out' : `the bus name "${raw}" is not a name MachSim understands and the bus is left out`);
      return;
    }
    buses.push({ name, points: pts.map((p) => ({ x: sc(p.x), y: sc(p.y) })) });
  });
  const entries: NonNullable<ImportedNetlist['busEntries']> = [];
  entryKeys.forEach((e) => {
    if (!e.onBus) {
      warnings.push('a bus entry does not touch a bus and is left out');
      return;
    }
    const name = rootName.get(uf.find(e.k));
    const member = name !== undefined && !isGroundName(name) ? name : undefined;
    if (!member) {
      warnings.push('a bus entry whose wire has no net label is left out (name the wire, for example D3)');
      return;
    }
    entries.push({ name: member, bus: { x: sc(e.busEnd.x), y: sc(e.busEnd.y) }, wire: { x: sc(e.wireEnd.x), y: sc(e.wireEnd.y) } });
  });
  const sheets: ImportedSheet[] = sheetRefs.map((s) => ({
    name: s.name,
    file: s.file,
    at: { x: sc(s.x), y: sc(s.y), w: sc(s.w), h: sc(s.h) },
    pins: s.pins.map((p) => ({ name: p.name, type: p.type, net: netOf(p.k, s.name, p.name), x: sc(p.x), y: sc(p.y) })),
  }));
  if (sheets.length) warnings.push(`${sheets.length} hierarchical sub-sheet(s) are not imported: open each sub-sheet file separately`);

  const titleBlock = child(root, 'title_block');
  const title = atom(child(titleBlock, 'title')?.[1]) || fileName.replace(/\.kicad_sch$/i, '');
  return {
    title,
    source: 'kicad',
    fileName,
    components: [...byRef.values()],
    namedNets: [...namedNets],
    powerNets: [...powerNets],
    diodeNumbering: 'KA',
    warnings,
    ...(unannotated > 0 ? { unannotated } : {}),
    ...(buses.length ? { buses } : {}),
    ...(entries.length ? { busEntries: entries } : {}),
    ...(hierLabels.length ? { hierLabels } : {}),
    ...(sheets.length ? { sheets } : {}),
  };
}

/** Import a KiCad schematic as a MachSim design. */
export function importKicad(text: string, opts: { fileName?: string; title?: string; sheetName?: string } = {}): SchematicImportResult {
  return importedToDesign(kicadToNetlist(text, opts.fileName ?? ''), opts);
}
