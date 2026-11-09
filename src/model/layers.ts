/**
 * Drawing layers of a sheet (Edit > Layer settings), pure.
 *
 * A sheet draws several kinds of things on top of each other: the grid, the reference designators
 * and values of the parts, the net labels, the names of the nets, the physical pin numbers, sticky
 * comments and graphic annotations. A learner who prints a worksheet for a classmate wants the
 * values hidden; a teacher who explains a netlist wants the net names and pin numbers shown. The
 * choice is stored per sheet in `Sheet.layers` and only differs from the defaults when the learner
 * changed it, so an untouched design round-trips byte for byte.
 *
 * Hiding a layer is a view choice: nothing is deleted, the netlist, the ERC and the BOM do not
 * change, and the SVG / PNG export and the print preview follow the same switches (they draw the
 * sheet with the same scene component).
 *
 *   layerVisible(sheet, 'values')            true / false
 *   setSheetLayers(sheet, { values: false }) a sheet with the layer hidden (unchanged sheet when
 *                                            the value is already that)
 *   layerSummary(sheet)                      the ids that differ from the defaults
 */
import type { Sheet, SheetLayers } from './types';

export type LayerId = keyof SheetLayers;

/** Every layer, in the order the dialog lists them. */
export const LAYER_IDS: readonly LayerId[] = ['grid', 'refdes', 'values', 'labels', 'netNames', 'pinNumbers', 'comments', 'graphics'];

/** Visibility of a layer on a sheet nobody touched. */
export const LAYER_DEFAULTS: Readonly<Record<LayerId, boolean>> = {
  grid: true,
  refdes: true,
  values: true,
  labels: true,
  netNames: false,
  pinNumbers: false,
  comments: true,
  graphics: true,
};

/** Whether `layer` is drawn on the sheet. */
export function layerVisible(sheet: Pick<Sheet, 'layers'> | undefined, layer: LayerId): boolean {
  return sheet?.layers?.[layer] ?? LAYER_DEFAULTS[layer];
}

/** The layers as a complete table (every id with its effective visibility). */
export function layerTable(sheet: Pick<Sheet, 'layers'> | undefined): Record<LayerId, boolean> {
  const out = { ...LAYER_DEFAULTS };
  for (const id of LAYER_IDS) out[id] = layerVisible(sheet, id);
  return out;
}

/** Ids of the layers whose visibility differs from the default. */
export function layerSummary(sheet: Pick<Sheet, 'layers'> | undefined): LayerId[] {
  return LAYER_IDS.filter((id) => layerVisible(sheet, id) !== LAYER_DEFAULTS[id]);
}

/** A layers record holding only the entries that differ from the defaults (undefined when none). */
export function normalizeLayers(layers: SheetLayers | undefined): SheetLayers | undefined {
  if (!layers) return undefined;
  const out: SheetLayers = {};
  for (const id of LAYER_IDS) {
    const v = layers[id];
    if (typeof v === 'boolean' && v !== LAYER_DEFAULTS[id]) out[id] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The sheet with some layers shown or hidden. Returns the SAME sheet when nothing changes, and a
 * sheet without a `layers` field when every layer is back to its default.
 */
export function setSheetLayers(sheet: Sheet, patch: SheetLayers): Sheet {
  const next: SheetLayers = { ...(sheet.layers ?? {}) };
  for (const id of LAYER_IDS) {
    const v = patch[id];
    if (typeof v === 'boolean') next[id] = v;
  }
  const normalized = normalizeLayers(next);
  const before = normalizeLayers(sheet.layers);
  if (JSON.stringify(normalized ?? null) === JSON.stringify(before ?? null) && (sheet.layers === undefined) === (before === undefined)) return sheet;
  if (!normalized) {
    const { layers: _drop, ...rest } = sheet;
    void _drop;
    return rest;
  }
  return { ...sheet, layers: normalized };
}

/** Every sheet of a list with the same layer patch (Edit > Layer settings > "all sheets"). */
export function setLayersOnSheets(sheets: Sheet[], patch: SheetLayers, only?: ReadonlySet<string>): Sheet[] {
  let changed = false;
  const out = sheets.map((s) => {
    if (only && !only.has(s.id)) return s;
    const n = setSheetLayers(s, patch);
    if (n !== s) changed = true;
    return n;
  });
  return changed ? out : sheets;
}
