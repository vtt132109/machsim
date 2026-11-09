/**
 * Editor-level connectivity: groups pins, wires and labels into nets for display purposes
 * (spreadsheet "Nets" tab, net highlighting, wire tooltips).
 *
 * Rules (same as wireOps.ts and src/model/connectivity.ts): wire ends connect to wires they touch
 * and to pins at the same point; net labels and probes attach anywhere on a wire or on a pin; on
 * one sheet the same name (case-insensitive) is one net; plain labels are local to their sheet
 * unless marked global; off-page connectors join their name across the sheets passed in; global
 * labels / connectors and power/ground symbols (PartDef.globalNet) join the global name. Bus
 * wires are a separate layer and are not part of any net here. Pass the sheets of one design
 * level (`{ ...design, sheets: child.sheets }` for a child design). This is a UI view of the
 * schematic; the authoritative SPICE netlist is produced by the netlister (src/model).
 */
import type { Design, PinRef, Point } from '../../model/types';
import type { PartLookup } from './types';
import { sheetPins } from './designOps';
import { onWire, pointKey, wireEnds } from './wireOps';

export interface EditorNet {
  /** stable within one computation: "N$1", label name, or global net name */
  name: string;
  named: boolean;
  pins: PinRef[];
  wireIds: string[];
  labelIds: string[];
  sheetIds: string[];
}

export interface Connectivity {
  nets: EditorNet[];
  /** wire id -> net index */
  wireNet: Map<string, number>;
  /** "refdes.pin" -> net index */
  pinNet: Map<string, number>;
}

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a);
    if (p === undefined) {
      this.parent.set(a, a);
      return a;
    }
    let root = a;
    while (p !== root) {
      root = p;
      p = this.parent.get(root) ?? root;
    }
    // path compression
    let cur = a;
    while (cur !== root) {
      const next = this.parent.get(cur) ?? root;
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

export function computeConnectivity(design: Pick<Design, 'sheets'>, lookup: PartLookup): Connectivity {
  const uf = new UnionFind();
  const pk = (sheetId: string, p: Point) => `${sheetId}@${pointKey(p)}`;
  const globalNames = new Map<string, string>();

  for (const sheet of design.sheets) {
    const pins = sheetPins(sheet, lookup);
    const ends: Point[] = [];
    const netWires = sheet.wires.filter((w) => !w.bus);
    for (const w of netWires) if (w.points.length >= 2) ends.push(...wireEnds(w));
    for (const w of netWires) {
      if (w.points.length < 2) continue;
      const wk = `wire:${w.id}`;
      // own ends (pins sitting there join through the shared point key)
      for (const e of wireEnds(w)) uf.union(wk, pk(sheet.id, e));
      // other wires' ends touching this wire anywhere (T-connections)
      for (const e of ends) if (onWire(w, e)) uf.union(wk, pk(sheet.id, e));
      // net labels attach anywhere on a wire
      for (const l of sheet.labels) if (onWire(w, l)) uf.union(wk, pk(sheet.id, l));
    }
    for (const pin of pins) {
      uf.find(`pin:${pin.refdes}.${pin.name}`);
      uf.union(`pin:${pin.refdes}.${pin.name}`, pk(sheet.id, pin));
      const def = lookup(sheet.parts.find((p) => p.id === pin.partId)?.partId ?? '');
      if (def?.globalNet !== undefined) {
        const g = def.globalNet.toLowerCase();
        globalNames.set(g, def.globalNet);
        uf.union(`global:${g}`, pk(sheet.id, pin));
        uf.union(`labelname:${sheet.id}:${g}`, pk(sheet.id, pin));
      }
    }
    for (const l of sheet.labels) {
      const name = l.name.trim().toLowerCase();
      if (!name) continue;
      const kind = l.kind ?? 'label';
      uf.union(`label:${l.id}`, pk(sheet.id, l));
      uf.union(`labelname:${sheet.id}:${name}`, pk(sheet.id, l));
      if (kind === 'offpage') uf.union(`offpage:${name}`, pk(sheet.id, l));
      else if (kind === 'hier') uf.union(`port:${name}`, pk(sheet.id, l));
      else if (kind === 'global' || (kind === 'label' && l.global)) uf.union(`global:${name}`, pk(sheet.id, l));
      if (name === '0' || name === 'gnd') uf.union('global:0', pk(sheet.id, l));
    }
  }

  const byRoot = new Map<string, EditorNet>();
  const netOf = (key: string): EditorNet => {
    const root = uf.find(key);
    let n = byRoot.get(root);
    if (!n) {
      n = { name: '', named: false, pins: [], wireIds: [], labelIds: [], sheetIds: [] };
      byRoot.set(root, n);
    }
    return n;
  };
  const labelNames = new Map<EditorNet, string>();
  const globals = new Map<EditorNet, string>();
  for (const sheet of design.sheets) {
    for (const pin of sheetPins(sheet, lookup)) {
      const n = netOf(`pin:${pin.refdes}.${pin.name}`);
      n.pins.push({ refdes: pin.refdes, pin: pin.name });
      if (!n.sheetIds.includes(sheet.id)) n.sheetIds.push(sheet.id);
    }
    for (const w of sheet.wires) {
      if (w.points.length < 2 || w.bus) continue;
      const n = netOf(`wire:${w.id}`);
      n.wireIds.push(w.id);
      if (!n.sheetIds.includes(sheet.id)) n.sheetIds.push(sheet.id);
    }
    for (const l of sheet.labels) {
      if (!l.name.trim()) continue;
      const n = netOf(`label:${l.id}`);
      n.labelIds.push(l.id);
      if (!labelNames.has(n)) labelNames.set(n, l.name.trim());
      if (!n.sheetIds.includes(sheet.id)) n.sheetIds.push(sheet.id);
    }
  }
  for (const [g, display] of globalNames) {
    const n = netOf(`global:${g}`);
    globals.set(n, display === '0' ? 'GND' : display);
  }

  const nets: EditorNet[] = [];
  let auto = 0;
  for (const n of byRoot.values()) {
    if (n.pins.length === 0 && n.wireIds.length === 0 && n.labelIds.length === 0) continue;
    const g = globals.get(n);
    const l = labelNames.get(n);
    if (g) {
      n.name = g;
      n.named = true;
    } else if (l) {
      n.name = l;
      n.named = true;
    } else {
      auto += 1;
      n.name = `N$${auto}`;
    }
    nets.push(n);
  }
  nets.sort((a, b) => Number(b.named) - Number(a.named) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const wireNet = new Map<string, number>();
  const pinNet = new Map<string, number>();
  nets.forEach((n, i) => {
    for (const w of n.wireIds) wireNet.set(w, i);
    for (const p of n.pins) pinNet.set(`${p.refdes}.${p.pin}`, i);
  });
  return { nets, wireNet, pinNet };
}
