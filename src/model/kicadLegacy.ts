/**
 * KiCad 5 and earlier schematics (`.sch`, "EESchema Schematic File Version 2 / 4") → the KiCad 6
 * s-expression schematic the importer in kicadImport.ts reads.
 *
 *   isLegacySchematic(text)                       the file starts with the EESchema header
 *   legacyLibraryNicknames(text)                  library nicknames the schematic uses (to find the .lib files)
 *   legacySchToKicadSch(text, libs, opts)         -> { text, missing, notes }
 *
 * Why a conversion instead of a second importer: the connectivity rules (wire ends, junctions, labels
 * by name, power symbols, hidden power pins, multi-unit merging, unannotated symbols, buses, entries
 * and sheets) are the same in both generations, so the legacy file is only re-expressed — then one
 * importer does the electrical work and the two can never disagree.
 *
 * Read from the public description of the legacy format. Units are mils (1/1000 inch, y down); the
 * output is millimetres. A component is the block `$Comp … $EndComp`:
 *   L <lib>:<part> <reference>     which library symbol
 *   U <unit> <convert> <timestamp> which unit
 *   P <x> <y>                      position
 *   F <n> "<text>" …               fields (0 reference, 1 value, 2 footprint, 3 datasheet, 4+ user fields)
 *   <unit> <x> <y> / <a> <b> <c> <d>   the placement line and the 2x2 orientation matrix
 * The matrix `1 0 0 -1` is the normal orientation (the library is y up, the sheet y down); any other
 * of the eight (four rotations, mirrored or not) is turned back into an angle and a mirror flag by
 * trying them against the matrix, using the same pin transform the importer uses.
 * Wires and buses are `Wire Wire Line` / `Wire Bus Line` followed by one line of two points;
 * `Entry Wire Line` is a bus entry; `Connection ~ x y` a junction; `Text Label|GLabel|HLabel x y …`
 * is followed by the label text; `$Sheet … $EndSheet` is a hierarchical sheet with `F0` its name,
 * `F1` its file and `F2…` its pins.
 */
import { kicadLibSymbolsSexpr, type KSymbol } from './kicadSymbols';
import { kicadPinPosition } from './kicadImport';

const MIL_TO_MM = 0.0254;

export function isLegacySchematic(text: string): boolean {
  return /^\s*EESchema Schematic File Version/i.test(text.replace(/^﻿/, ''));
}

/** Nicknames of the libraries a legacy schematic uses: the `LIBS:` lines and the `L Nick:Part` lines. */
export function legacyLibraryNicknames(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const libs = /^LIBS:(.+)$/.exec(line.trim());
    if (libs) out.add(libs[1].trim());
    const comp = /^L\s+([^:\s]+):(\S+)\s+/.exec(line);
    if (comp) out.add(comp[1]);
  }
  return [...out];
}

const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const f = (v: number): string => {
  const r = Math.round(v * 10000) / 10000;
  return Object.is(r, -0) ? '0' : String(r);
};
const mm = (mil: string | number): number => (Number(mil) || 0) * MIL_TO_MM;

/** Angle (degrees) and mirror flag whose pin transform equals the orientation matrix; null if none does. */
export function matrixToOrientation(a: number, b: number, c: number, d: number): { angle: number; mirror: 'x' | 'y' | null } | null {
  const want = (px: number, py: number): [number, number] => [a * px + b * py, c * px + d * py];
  for (const mirror of [null, 'x', 'y'] as const) {
    for (const angle of [0, 90, 180, 270]) {
      let ok = true;
      for (const [px, py] of [[1, 0], [0, 1]] as const) {
        const got = kicadPinPosition({ x: px, y: py }, { x: 0, y: 0, angle }, { x: mirror === 'x', y: mirror === 'y' });
        const [wx, wy] = want(px, py);
        if (Math.abs(got.x - wx) > 1e-6 || Math.abs(got.y - wy) > 1e-6) ok = false;
      }
      if (ok) return { angle, mirror };
    }
  }
  return null;
}

export interface LegacyConversion {
  /** the schematic as KiCad 6 text */
  text: string;
  /** library symbols the schematic uses but no supplied library holds */
  missing: string[];
  notes: string[];
}

const SHEET_PIN_TYPE: Record<string, string> = { I: 'input', O: 'output', B: 'bidirectional', T: 'tri_state', U: 'passive' };
const SIDE_ANGLE: Record<string, number> = { L: 180, R: 0, T: 90, B: 270 };

interface Comp {
  libId: string;
  reference: string;
  unit: number;
  x: number;
  y: number;
  fields: { n: number; text: string; name: string }[];
  matrix: [number, number, number, number];
}

/** Convert a legacy schematic. `libs` are the symbols of the supplied `.lib` files. */
export function legacySchToKicadSch(text: string, libs: readonly KSymbol[], opts: { fileName?: string } = {}): LegacyConversion {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const notes: string[] = [];
  const bare = (id: string) => (id.split(':').pop() ?? id).toLowerCase();
  const libByName = new Map(libs.map((s) => [bare(s.name), s]));
  const body: string[] = [];
  const usedLib = new Map<string, KSymbol>();
  const missing = new Set<string>();
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('Title ')) title = (/"(.*)"/.exec(t)?.[1] ?? '').trim();
    if (t === '$Comp') {
      const comp: Comp = { libId: '', reference: '', unit: 1, x: 0, y: 0, fields: [], matrix: [1, 0, 0, -1] };
      for (i++; i < lines.length && lines[i].trim() !== '$EndComp'; i++) {
        const l = lines[i].trim();
        const tok = l.split(/\s+/);
        if (tok[0] === 'L') {
          comp.libId = tok[1] ?? '';
          comp.reference = tok[2] ?? '';
        } else if (tok[0] === 'U') comp.unit = Number(tok[1]) || 1;
        else if (tok[0] === 'P') {
          comp.x = Number(tok[1]) || 0;
          comp.y = Number(tok[2]) || 0;
        } else if (tok[0] === 'F') {
          const m = /^F\s+(\d+)\s+"((?:[^"\\]|\\.)*)"(.*)$/.exec(l);
          if (m) {
            const name = /"((?:[^"\\]|\\.)*)"\s*$/.exec(m[3])?.[1] ?? '';
            comp.fields.push({ n: Number(m[1]), text: m[2].replace(/\\(.)/g, '$1'), name });
          }
        } else if (/^-?\d+$/.test(tok[0]) && tok.length === 3) {
          // "unit x y": the placement line
          comp.unit = Number(tok[0]) || comp.unit;
          comp.x = Number(tok[1]);
          comp.y = Number(tok[2]);
        } else if (tok.length === 4 && tok.every((x) => /^-?\d+$/.test(x))) comp.matrix = tok.map(Number) as [number, number, number, number];
      }
      const lib = libByName.get(bare(comp.libId));
      if (!lib) missing.add(comp.libId);
      else if (!usedLib.has(comp.libId)) usedLib.set(comp.libId, { ...lib, name: comp.libId });
      const o = matrixToOrientation(...comp.matrix);
      if (!o) notes.push(`${comp.reference}: unusual orientation matrix ${comp.matrix.join(' ')}, drawn unrotated`);
      const props = comp.fields
        .map((fl) => {
          const name = fl.n === 0 ? 'Reference' : fl.n === 1 ? 'Value' : fl.n === 2 ? 'Footprint' : fl.n === 3 ? 'Datasheet' : fl.name || `Field${fl.n}`;
          return `(property ${q(name)} ${q(fl.text)} (at 0 0 0))`;
        })
        .join(' ');
      // a legacy file with no F lines still has the reference in the L line
      const fallback = comp.fields.some((fl) => fl.n === 0) ? '' : `(property "Reference" ${q(comp.reference)} (at 0 0 0))`;
      body.push(`  (symbol (lib_id ${q(comp.libId)}) (at ${f(mm(comp.x))} ${f(mm(comp.y))} ${o?.angle ?? 0})${o?.mirror ? ` (mirror ${o.mirror})` : ''} (unit ${comp.unit}) ${fallback}${props})`);
      continue;
    }
    if (t === '$Sheet') {
      let x = 0;
      let y = 0;
      let w = 0;
      let h = 0;
      let name = '';
      let file = '';
      const pins: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== '$EndSheet'; i++) {
        const l = lines[i].trim();
        const tok = l.split(/\s+/);
        if (tok[0] === 'S') {
          x = Number(tok[1]);
          y = Number(tok[2]);
          w = Number(tok[3]);
          h = Number(tok[4]);
        } else if (tok[0] === 'F0') name = /"((?:[^"\\]|\\.)*)"/.exec(l)?.[1] ?? '';
        else if (tok[0] === 'F1') file = /"((?:[^"\\]|\\.)*)"/.exec(l)?.[1] ?? '';
        else if (/^F\d+$/.test(tok[0])) {
          const m = /^F\d+\s+"((?:[^"\\]|\\.)*)"\s+(\S)\s+(\S)\s+(-?\d+)\s+(-?\d+)/.exec(l);
          if (m) pins.push(`(pin ${q(m[1])} ${SHEET_PIN_TYPE[m[2]] ?? 'passive'} (at ${f(mm(m[4]))} ${f(mm(m[5]))} ${SIDE_ANGLE[m[3]] ?? 0}))`);
        }
      }
      body.push(`  (sheet (at ${f(mm(x))} ${f(mm(y))}) (size ${f(mm(w))} ${f(mm(h))}) (property "Sheetname" ${q(name)} (at 0 0 0)) (property "Sheetfile" ${q(file)} (at 0 0 0)) ${pins.join(' ')})`);
      continue;
    }
    const wire = /^Wire\s+(Wire|Bus|Notes)\s+Line/.exec(t);
    if (wire) {
      const next = (lines[++i] ?? '').trim().split(/\s+/);
      if (wire[1] === 'Notes') continue;
      const [x1, y1, x2, y2] = next;
      body.push(`  (${wire[1] === 'Wire' ? 'wire' : 'bus'} (pts (xy ${f(mm(x1))} ${f(mm(y1))}) (xy ${f(mm(x2))} ${f(mm(y2))})))`);
      continue;
    }
    const entry = /^Entry\s+(Wire|Bus)\s+(Line|Bus)/.exec(t);
    if (entry) {
      const [x1, y1, x2, y2] = (lines[++i] ?? '').trim().split(/\s+/);
      if (entry[1] === 'Wire') body.push(`  (bus_entry (at ${f(mm(x1))} ${f(mm(y1))}) (size ${f(mm(x2) - mm(x1))} ${f(mm(y2) - mm(y1))}))`);
      continue;
    }
    const junction = /^Connection\s+~\s+(-?\d+)\s+(-?\d+)/.exec(t);
    if (junction) {
      body.push(`  (junction (at ${f(mm(junction[1]))} ${f(mm(junction[2]))}))`);
      continue;
    }
    const label = /^Text\s+(Label|GLabel|HLabel)\s+(-?\d+)\s+(-?\d+)\s+(\d+)/.exec(t);
    if (label) {
      const name = (lines[++i] ?? '').trim().replace(/~/g, ' ').trim();
      if (!name) continue;
      const kind = label[1] === 'Label' ? 'label' : label[1] === 'GLabel' ? 'global_label' : 'hierarchical_label';
      body.push(`  (${kind} ${q(name)} (at ${f(mm(label[2]))} ${f(mm(label[3]))} ${(Number(label[4]) * 90) % 360}))`);
    }
  }
  const out = [
    `(kicad_sch (version 20211123) (generator machsim-legacy-import)`,
    ...(title ? [`  (title_block (title ${q(title)}))`] : []),
    `  ${kicadLibSymbolsSexpr([...usedLib.values()]).split('\n').join('\n  ')}`,
    ...body,
    ')',
  ];
  if (missing.size) notes.push(`no library symbol for ${[...missing].join(', ')}: supply the .lib file that holds it`);
  return { text: `${out.join('\n')}\n`, missing: [...missing], notes: opts.fileName ? notes : notes };
}
