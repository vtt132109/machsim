/**
 * A whole KiCad schematic project as one MachSim design.
 *
 *   importKicadProject(text, opts) -> Promise<KicadProjectResult>
 *
 * The top sheet becomes the design's sheet. Every hierarchical sheet symbol becomes a **hierarchical
 * block** (a MachSim child design) built from the sub-sheet file it names; the symbol's pins are
 * joined to the nets of the parent through the block's connectors (the sub-sheet's hierarchical
 * labels). A file used by two sheet symbols is read once and becomes one block placed twice, the way
 * KiCad reuses a sheet. Sub-sheets may contain sub-sheets (up to {@link MAX_SHEET_DEPTH} deep); a
 * sheet that includes itself is reported and left as a plain box.
 *
 * Both generations are accepted: a KiCad 6+ `.kicad_sch` and a KiCad 5 `.sch` (converted by
 * kicadLegacy.ts, with the symbols of the `.lib` files in `libraries`). Files are fetched through
 * `opts.read(name)` (the user's file pick, the desktop folder or a test table), by the base name the
 * parent sheet gives; a file that cannot be read is listed in `missing` and its sheet symbol becomes
 * a plain box with the right pins, so the drawing is complete.
 */
import { importedToDesign, type ImportedComponent, type SchematicImportNote, type SchematicImportResult } from './importSchematic';
import { kicadToNetlist } from './kicadImport';
import { isLegacySchematic, legacySchToKicadSch } from './kicadLegacy';
import { parseLegacyLib, parseKicadSym, type KSymbol } from './kicadSymbols';
import type { ChildDesign, Sheet } from './types';

/** Deepest nesting of sheets followed. */
export const MAX_SHEET_DEPTH = 6;

export interface KicadProjectOptions {
  fileName?: string;
  title?: string;
  sheetName?: string;
  /** read a sub-sheet by the file name the parent gives; null when it is not available */
  read?: (file: string) => Promise<string | null> | string | null;
  /** symbols of the `.lib` / `.kicad_sym` files, for KiCad 5 schematics */
  libraries?: readonly KSymbol[];
}

export interface KicadProjectResult extends SchematicImportResult {
  /** sub-sheet files that were needed and could not be read */
  missing: string[];
  /** library symbols a legacy schematic used that no supplied library holds */
  missingSymbols: string[];
  /** sheets read: file names, top sheet first */
  sheetFiles: string[];
}

/** Ids of every item of the sheets prefixed, so a child design's ids never meet the top sheet's. */
function prefixIds(sheets: Sheet[], prefix: string): Sheet[] {
  const p = (id: string) => `${prefix}-${id}`;
  return sheets.map((s) => ({
    ...s,
    id: p(s.id),
    parts: s.parts.map((x) => ({ ...x, id: p(x.id) })),
    wires: s.wires.map((x) => ({ ...x, id: p(x.id) })),
    labels: s.labels.map((x) => ({ ...x, id: p(x.id) })),
    probes: s.probes.map((x) => ({ ...x, id: p(x.id) })),
    notes: s.notes.map((x) => ({ ...x, id: p(x.id) })),
    ...(s.shapes ? { shapes: s.shapes.map((x) => ({ ...x, id: p(x.id) })) } : {}),
  }));
}

const baseKey = (file: string): string => (file.split(/[\\/]/).pop() ?? file).toLowerCase();

/** Library symbols of a `.lib` or `.kicad_sym` text. */
export function librarySymbols(text: string): KSymbol[] {
  return /^\s*EESchema-LIBRARY/i.test(text.replace(/^﻿/, '')) ? parseLegacyLib(text).symbols : parseKicadSym(text).symbols;
}

interface State {
  opts: KicadProjectOptions;
  children: ChildDesign[];
  byFile: Map<string, ChildDesign>;
  missing: Set<string>;
  missingSymbols: Set<string>;
  files: string[];
  notes: SchematicImportNote[];
  counter: number;
}

/** The KiCad 6 text of a sheet, converting a legacy one. */
function sheetText(text: string, state: State, fileName: string): string {
  if (!isLegacySchematic(text)) return text;
  const conv = legacySchToKicadSch(text, state.opts.libraries ?? [], { fileName });
  for (const m of conv.missing) state.missingSymbols.add(m);
  return conv.text;
}

async function loadSheet(text: string, fileName: string, depth: number, stack: string[], state: State, top: boolean): Promise<SchematicImportResult> {
  const imp = kicadToNetlist(sheetText(text, state, fileName), fileName);
  // the sheets are loaded below; the importer's "not imported" warning no longer applies
  imp.warnings = imp.warnings.filter((w) => !/hierarchical sub-sheet\(s\) are not imported/.test(w));
  const extra: ImportedComponent[] = [];
  let index = 0;
  for (const sheet of imp.sheets ?? []) {
    index++;
    const key = baseKey(sheet.file);
    let child = state.byFile.get(key);
    let box = false;
    if (!sheet.file) {
      state.notes.push({ kind: 'warning', what: `the sheet "${sheet.name}" names no file` });
      box = true;
    } else if (stack.includes(key)) {
      state.notes.push({ kind: 'warning', what: `the sheet "${sheet.name}" (${sheet.file}) includes itself and is left as a plain box` });
      box = true;
    } else if (depth >= MAX_SHEET_DEPTH) {
      state.notes.push({ kind: 'warning', what: `the sheet "${sheet.name}" is nested more than ${MAX_SHEET_DEPTH} levels deep and is left as a plain box` });
      box = true;
    } else if (!child) {
      const sub = state.opts.read ? await state.opts.read(sheet.file) : null;
      if (sub === null || sub === undefined) {
        state.missing.add(sheet.file);
        box = true;
      } else {
        state.files.push(sheet.file);
        const res = await loadSheet(sub, sheet.file, depth + 1, [...stack, key], state, false);
        const id = `hb${++state.counter}`;
        child = {
          id,
          kind: 'hierarchical',
          name: uniqueName(state, sheet.name || sheet.file.replace(/\.[^.]+$/, '')),
          sheets: prefixIds(res.design.sheets, id),
          variables: {},
          sourceFile: sheet.file,
        };
        state.children.push(child);
        state.byFile.set(key, child);
      }
    }
    const comp: ImportedComponent = {
      refdes: `HB${index}`,
      symbol: box ? `sheet:${sheet.name}` : `hier:${child?.id ?? ''}`,
      // not the `value`: a value is matched against the library's part names
      fields: { Sheetname: sheet.name, Sheetfile: sheet.file },
      pins: sheet.pins.map((p) => ({ number: p.name, name: p.name, net: p.net })),
      at: { x: sheet.at.x, y: sheet.at.y, pins: Object.fromEntries(sheet.pins.map((p) => [p.name, { x: p.x, y: p.y }])) },
      ...(box || !child ? { box: true } : { block: child }),
    };
    extra.push(comp);
  }
  imp.components.push(...extra);
  const res = importedToDesign(imp, {
    ...(top ? { title: state.opts.title, sheetName: state.opts.sheetName } : { sheetName: state.opts.sheetName }),
    children: [...state.children],
  });
  if (!top) state.notes.push(...res.notes.filter((n) => n.kind !== 'blocks'));
  return res;
}

function uniqueName(state: State, name: string): string {
  const taken = new Set(state.children.map((c) => c.name.toLowerCase()));
  let n = name || 'Sheet';
  for (let k = 2; taken.has(n.toLowerCase()); k++) n = `${name}_${k}`;
  return n;
}

/** Import a project (see the module comment). */
export async function importKicadProject(text: string, opts: KicadProjectOptions = {}): Promise<KicadProjectResult> {
  const fileName = opts.fileName ?? '';
  const state: State = { opts, children: [], byFile: new Map(), missing: new Set(), missingSymbols: new Set(), files: [fileName || 'top'], notes: [], counter: 0 };
  const res = await loadSheet(text, fileName, 0, [baseKey(fileName)], state, true);
  const design = state.children.length ? { ...res.design, children: state.children } : res.design;
  return {
    ...res,
    design,
    notes: [...res.notes, ...state.notes],
    missing: [...state.missing],
    missingSymbols: [...state.missingSymbols],
    sheetFiles: state.files,
  };
}
