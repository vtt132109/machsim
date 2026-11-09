/**
 * Per-net settings (pure): what a net is called, how it is drawn, how it is simulated and how the
 * PCB tool should route it.
 *
 * Settings live in `Design.nets`, keyed by the net's user-visible name (the label / power-symbol
 * name, or the auto name "N3" of an unnamed net). Keys are matched without case, so "Vout" and
 * "VOUT" are the same net. A net with no entry uses the defaults, so a design that never opens the
 * dialog keeps exactly the same file.
 *
 *   netSettings(design, name)              the entry of one net (undefined when it has none)
 *   setNetSettings(design, name, patch)    write / merge / drop one entry (returns a new Design)
 *   renameNetSettings(design, from, to)    follow a net rename (Net settings dialog)
 *   mergeNetSettings(design, from, to)     follow a rename onto an existing net (fields merge)
 *   applyNetColor(design, name, color, …)  recolour the wires of a net so the sheet shows it
 *   applyNetColors(design, nets)           give EVERY wire of every coloured net its colour, so a
 *                                          wire drawn into the net later is coloured too (the
 *                                          editor calls this after each edit)
 *   pcbNetProperties(design)               the PCB-relevant fields, by net name (export)
 *   netClassOf / NET_CLASS_PRESETS         trace width / clearance presets a learner can pick
 *
 * Units: trace width and clearance are millimetres (what every PCB tool asks for); the netlist
 * export writes them as plain numbers in mm.
 */
import type { Design, NetSettings, Sheet } from './types';

/** Routing-layer hints offered by the dialog (free text is accepted too). */
export const NET_LAYER_HINTS = ['any', 'top', 'bottom', 'inner', 'power'] as const;
export type NetLayerHint = (typeof NET_LAYER_HINTS)[number];

/** Ready-made net classes: trace width and clearance in mm. */
export const NET_CLASS_PRESETS: { id: string; width: number; clearance: number }[] = [
  { id: 'signal', width: 0.25, clearance: 0.2 },
  { id: 'bus', width: 0.3, clearance: 0.2 },
  { id: 'power', width: 0.8, clearance: 0.3 },
  { id: 'highVoltage', width: 1, clearance: 1.5 },
];

export function netClassOf(id: string | undefined): { id: string; width: number; clearance: number } | undefined {
  return id === undefined ? undefined : NET_CLASS_PRESETS.find((c) => c.id === id);
}

const key = (name: string): string => name.trim().toLowerCase();

/** The settings entry of a net, found without case. */
export function netSettings(design: Pick<Design, 'nets'>, name: string): NetSettings | undefined {
  const nets = design.nets;
  if (!nets) return undefined;
  const k = key(name);
  for (const [n, v] of Object.entries(nets)) if (key(n) === k) return v;
  return undefined;
}

/** True when the entry carries nothing worth saving. */
export function isEmptyNetSettings(s: NetSettings | undefined): boolean {
  if (!s) return true;
  return Object.values(s).every((v) => v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v)));
}

function dropEmpty(s: NetSettings): NetSettings {
  const out: NetSettings = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/**
 * Merge `patch` into the settings of one net. Fields set to undefined / '' are removed; when
 * nothing is left the whole entry (and `Design.nets`, when it becomes empty) disappears again.
 */
export function setNetSettings(design: Design, name: string, patch: NetSettings): Design {
  const k = key(name);
  const all = Object.entries(design.nets ?? {});
  const entries = all.filter(([n]) => key(n) !== k);
  // an entry that exists keeps its spelling (renameNetSettings is the way to change it)
  const spelling = all.find(([n]) => key(n) === k)?.[0] ?? name.trim();
  const merged = dropEmpty({ ...(netSettings(design, name) ?? {}), ...patch });
  const next = Object.fromEntries(isEmptyNetSettings(merged) ? entries : [...entries, [spelling, merged]]);
  if (!Object.keys(next).length) {
    if (!design.nets) return design;
    const { nets: _drop, ...rest } = design;
    return rest as Design;
  }
  return { ...design, nets: next };
}

/** Move the settings of net `from` to net `to` (an existing entry of `to` is replaced). */
export function renameNetSettings(design: Design, from: string, to: string): Design {
  const s = netSettings(design, from);
  if (!s) return design;
  const cleared = setNetSettings(design, from, Object.fromEntries(Object.keys(s).map((k) => [k, undefined])) as NetSettings);
  return setNetSettings(cleared, to, s);
}

/**
 * Give every wire of a net the net's colour so the sheet shows it. `wireIds` are the wires on that
 * net (from the netlister's connectivity); an empty / undefined colour clears their colour again.
 */
export function applyNetColor(design: Design, wireIds: { sheetId: string; wireId: string }[], color: string | undefined): Design {
  if (!wireIds.length) return design;
  const bySheet = new Map<string, Set<string>>();
  for (const w of wireIds) {
    if (!bySheet.has(w.sheetId)) bySheet.set(w.sheetId, new Set());
    bySheet.get(w.sheetId)!.add(w.wireId);
  }
  let changed = false;
  const sheets: Sheet[] = design.sheets.map((sh) => {
    const ids = bySheet.get(sh.id);
    if (!ids) return sh;
    let touched = false;
    const wires = sh.wires.map((w) => {
      if (!ids.has(w.id)) return w;
      if ((w.color ?? '') === (color ?? '')) return w;
      touched = true;
      if (color) return { ...w, color };
      const { color: _c, ...rest } = w;
      return rest;
    });
    if (!touched) return sh;
    changed = true;
    return { ...sh, wires };
  });
  return changed ? { ...design, sheets } : design;
}

/** One net with the wires that belong to it (from the editor's connectivity view). */
export interface NetWires {
  /** user-visible net name (label / power-symbol name, or the auto name) */
  name: string;
  wires: { sheetId: string; wireId: string }[];
}

/**
 * Give every wire of every **coloured** net that net's colour, on the root sheets and inside child
 * designs. This is what makes a net's colour follow the NET and not the individual wires: a wire
 * drawn into a coloured net later gets the colour, and a wire that leaves the net keeps whatever
 * it had (only {@link applyNetColor}, i.e. the Net settings dialog, clears colours).
 *
 * Returns the same design when every wire already has the right colour, so the editor can call it
 * after each edit; a design whose `nets` carries no colour at all costs one map lookup.
 */
export function applyNetColors(design: Design, nets: readonly NetWires[]): Design {
  const colors = new Map<string, string>();
  for (const [name, s] of Object.entries(design.nets ?? {})) if (s.color) colors.set(key(name), s.color);
  if (!colors.size) return design;
  const want = new Map<string, string>();
  for (const net of nets) {
    const color = colors.get(key(net.name));
    if (!color) continue;
    for (const w of net.wires) want.set(`${w.sheetId}\u0000${w.wireId}`, color);
  }
  if (!want.size) return design;
  const paint = (sheets: Sheet[]): Sheet[] => {
    let changed = false;
    const out = sheets.map((sh) => {
      let touched = false;
      const wires = sh.wires.map((w) => {
        const color = want.get(`${sh.id}\u0000${w.id}`);
        if (color === undefined || w.color === color) return w;
        touched = true;
        return { ...w, color };
      });
      if (!touched) return sh;
      changed = true;
      return { ...sh, wires };
    });
    return changed ? out : sheets;
  };
  const sheets = paint(design.sheets);
  let childChanged = false;
  const children = design.children?.map((c) => {
    const s = paint(c.sheets);
    if (s === c.sheets) return c;
    childChanged = true;
    return { ...c, sheets: s };
  });
  if (sheets === design.sheets && !childChanged) return design;
  return { ...design, sheets, ...(children ? { children } : {}) };
}

/**
 * Follow a net rename: the settings of `from` move to `to`, and when `to` already has settings the
 * two are **merged** (the renamed net's own fields win) instead of one of them disappearing. This
 * is what happens when a learner renames a label onto an existing net name, or wires two named
 * nets together so the names merge.
 */
export function mergeNetSettings(design: Design, from: string, to: string): Design {
  const mine = netSettings(design, from);
  if (!mine || key(from) === key(to)) return design;
  const theirs = netSettings(design, to) ?? {};
  const cleared = setNetSettings(design, from, Object.fromEntries(Object.keys(mine).map((k) => [k, undefined])) as NetSettings);
  return setNetSettings(cleared, to, { ...theirs, ...mine });
}

/** PCB-relevant fields of one net (what the netlist exports carry). */
export interface PcbNetProperties {
  /** trace width in mm */
  width?: number;
  /** clearance in mm */
  clearance?: number;
  /** routing-layer hint */
  layer?: string;
  /** net class name */
  netClass?: string;
}

/**
 * The PCB fields of every net that has any, by net name. A net class fills in the width and the
 * clearance it stands for unless the net overrides them.
 */
export function pcbNetProperties(design: Pick<Design, 'nets'>): Map<string, PcbNetProperties> {
  const out = new Map<string, PcbNetProperties>();
  for (const [name, s] of Object.entries(design.nets ?? {})) {
    const preset = netClassOf(s.netClass);
    const p: PcbNetProperties = {};
    const width = s.traceWidth ?? preset?.width;
    const clearance = s.clearance ?? preset?.clearance;
    if (width !== undefined) p.width = width;
    if (clearance !== undefined) p.clearance = clearance;
    if (s.layer) p.layer = s.layer;
    if (s.netClass) p.netClass = s.netClass;
    if (Object.keys(p).length) out.set(name.trim(), p);
  }
  return out;
}

/** Lookup for the exports: PCB properties of a net by its (case-insensitive) name. */
export function pcbNetLookup(design: Pick<Design, 'nets'>): (name: string) => PcbNetProperties | undefined {
  const map = pcbNetProperties(design);
  const lower = new Map([...map.entries()].map(([n, p]) => [key(n), p]));
  return (name) => lower.get(key(name));
}
