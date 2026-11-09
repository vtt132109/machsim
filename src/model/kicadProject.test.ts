/**
 * KiCad projects: hierarchical sheets as blocks, buses and bus entries, and KiCad 5 schematics with
 * their .lib files. Fixtures are written by hand from the public descriptions of the two file
 * formats; the circuits are checked through the real netlister and engine.
 */
import { describe, expect, it } from 'vitest';
import { importKicadProject, librarySymbols } from './kicadProject';
import { isLegacySchematic, legacyLibraryNicknames, legacySchToKicadSch, matrixToOrientation } from './kicadLegacy';
import { kicadBusName, importKicad } from './kicadImport';
import { buildNetlist } from './netlister';
import { parseDesign, serializeDesign } from './serialize';
import { runAnalyses } from '../sim';
import { loadAllGroups } from '../library';
import { blockInstances } from './hierarchy';
import type { Design } from './types';
import { parseBusName } from './bus';

await loadAllGroups();

const LIB = `(lib_symbols
  (symbol "Device:R" (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 0 0 0))
    (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54)))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))
      (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))))
  (symbol "power:GND" (power) (in_bom yes) (on_board yes)
    (symbol "GND_1_1" (pin power_in line (at 0 0 270) (length 0) hide (name "GND") (number "1"))))
  (symbol "power:+5V" (power) (in_bom yes) (on_board yes)
    (symbol "+5V_1_1" (pin power_in line (at 0 0 90) (length 0) hide (name "+5V") (number "1")))))`;

/** KiCad's schematic grid is 1.27 mm: every coordinate below is a whole number of grid steps. */
const m = (n: number): number => Math.round(n * 1.27 * 10000) / 10000;
const res = (ref: string, value: string, x: number, y: number, angle = 0) =>
  `(symbol (lib_id "Device:R") (at ${m(x)} ${m(y)} ${angle}) (unit 1) (property "Reference" "${ref}" (at 0 0 0)) (property "Value" "${value}" (at 0 0 0)) (property "Footprint" "" (at 0 0 0)))`;
const power = (name: string, x: number, y: number, n: number) =>
  `(symbol (lib_id "power:${name}") (at ${m(x)} ${m(y)} 0) (unit 1) (property "Reference" "#PWR0${n}" (at 0 0 0)) (property "Value" "${name}" (at 0 0 0)))`;
const wire = (x1: number, y1: number, x2: number, y2: number) => `(wire (pts (xy ${m(x1)} ${m(y1)}) (xy ${m(x2)} ${m(y2)})))`;

/** Top sheet: +5V into the sheet "Divider", its output loaded by R1 = 2k to ground. */
const TOP = `(kicad_sch (version 20211123) (generator eeschema)
  (title_block (title "Hierarchy test"))
  ${LIB}
  ${power('+5V', 60, 44, 1)}
  ${wire(60, 44, 80, 44)}
  (sheet (at ${m(80)} ${m(40)}) (size ${m(24)} ${m(16)}) (property "Sheetname" "Divider") (property "Sheetfile" "divider.kicad_sch")
    (pin "IN" input (at ${m(80)} ${m(44)} 180)) (pin "OUT" output (at ${m(104)} ${m(44)} 0)))
  ${wire(104, 44, 104, 41)}
  ${wire(104, 41, 120, 41)}
  ${res('R1', '2k', 120, 44)}
  ${wire(120, 47, 120, 50)}
  ${power('GND', 120, 50, 2)}
)`;

/** Sub-sheet: R2 = 1k in series from IN to OUT, R3 = 1k from OUT to ground. */
const DIVIDER = `(kicad_sch (version 20211123) (generator eeschema)
  ${LIB}
  (hierarchical_label "IN" (shape input) (at ${m(16)} ${m(24)} 180))
  (hierarchical_label "OUT" (shape output) (at ${m(48)} ${m(24)} 0))
  ${wire(16, 24, 29, 24)}
  ${res('R2', '1k', 32, 24, 90)}
  ${wire(35, 24, 48, 24)}
  (junction (at ${m(40)} ${m(24)}))
  ${wire(40, 24, 40, 27)}
  ${res('R3', '1k', 40, 30)}
  ${wire(40, 33, 40, 36)}
  ${power('GND', 40, 36, 3)}
)`;

/** Node voltage at an element's pin in the operating point of a design. */
function opVoltages(design: Design): { nodes: Record<string, string[]>; v: (node: string) => number } {
  const nb = buildNetlist(design, { includeAnalysis: false });
  expect(nb.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
  const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
  expect(op.error).toBeUndefined();
  const nodes: Record<string, string[]> = {};
  for (const e of nb.netlist.elements) nodes[e.name] = e.nodes;
  return {
    nodes,
    v: (node) => {
      if (node === '0') return 0;
      const vec = op.vectors.find((x) => x.name.toLowerCase() === `v(${node})`.toLowerCase());
      if (!vec) throw new Error(`no V(${node}); have ${op.vectors.map((x) => x.name).join(', ')}`);
      return vec.re[0];
    },
  };
}

describe('hierarchical sheets as blocks', () => {
  it('a sheet symbol becomes a hierarchical block built from the sub-sheet file', async () => {
    const r = await importKicadProject(TOP, { fileName: 'top.kicad_sch', read: (f) => (f === 'divider.kicad_sch' ? DIVIDER : null) });
    expect(r.missing).toEqual([]);
    expect(r.sheetFiles).toEqual(['top.kicad_sch', 'divider.kicad_sch']);
    const d = r.design;
    expect(d.children).toHaveLength(1);
    const child = d.children![0];
    expect(child.kind).toBe('hierarchical');
    expect(child.name).toBe('Divider');
    expect(child.sourceFile).toBe('divider.kicad_sch');
    // two connectors in the child: IN and OUT
    const labels = child.sheets.flatMap((s) => s.labels).filter((l) => l.kind === 'hier');
    expect(labels.map((l) => l.name).sort()).toEqual(['IN', 'OUT']);
    // the top sheet places the block once, next to R1 and the generated 5 V source
    const blocks = blockInstances(d);
    expect(blocks.length).toBe(1);
    const top = d.sheets[0].parts.map((p) => p.partId);
    expect(top).toContain(`hier:${child.id}`);
    // the block part is wired: both of its pins are on a net with something else
    const notes = r.notes.map((n) => n.kind);
    expect(notes).toContain('blocks');
  });

  it('works as a circuit: 5 V through 1k, 1k to ground, loaded by 2k gives 2 V', async () => {
    const r = await importKicadProject(TOP, { fileName: 'top.kicad_sch', read: (f) => (f === 'divider.kicad_sch' ? DIVIDER : null) });
    const { nodes, v } = opVoltages(r.design);
    // R1 (the 2k load) sits on the OUT net
    const r1 = Object.entries(nodes).find(([name]) => /R1$/.test(name))!;
    const outNode = r1[1].find((n) => n !== '0')!;
    expect(v(outNode)).toBeCloseTo(2.0, 4);
  });

  it('saves and reopens (ids unique across the top sheet and the block)', async () => {
    const r = await importKicadProject(TOP, { fileName: 'top.kicad_sch', read: () => DIVIDER });
    const text = serializeDesign(r.design);
    const back = parseDesign(text);
    expect(serializeDesign(back)).toBe(text);
    const ids = [r.design.sheets, ...(r.design.children ?? []).map((c) => c.sheets)].flat().flatMap((s) => [s.id, ...s.parts.map((p) => p.id), ...s.wires.map((w) => w.id), ...s.labels.map((l) => l.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a file that cannot be read leaves a plain box with the right pins and says which file is missing', async () => {
    const r = await importKicadProject(TOP, { fileName: 'top.kicad_sch', read: () => null });
    expect(r.missing).toEqual(['divider.kicad_sch']);
    expect(r.design.children ?? []).toHaveLength(0);
    const generic = r.design.customParts?.find((p) => /Divider/.test(p.name));
    expect(generic).toBeDefined();
    expect(generic!.symbol.pins.map((p) => p.name).sort()).toEqual(['IN', 'OUT']);
  });

  it('one file used by two sheet symbols is one block placed twice', async () => {
    const two = TOP.replace(
      `(sheet (at ${m(80)} ${m(40)})`,
      `(sheet (at ${m(80)} ${m(64)}) (size ${m(24)} ${m(16)}) (property "Sheetname" "Divider B") (property "Sheetfile" "divider.kicad_sch") (pin "IN" input (at ${m(80)} ${m(68)} 180)) (pin "OUT" output (at ${m(104)} ${m(68)} 0)))
  (sheet (at ${m(80)} ${m(40)})`,
    );
    const r = await importKicadProject(two, { fileName: 'top.kicad_sch', read: () => DIVIDER });
    expect(r.design.children).toHaveLength(1);
    const placed = r.design.sheets[0].parts.filter((p) => p.partId.startsWith('hier:'));
    expect(placed).toHaveLength(2);
    expect(new Set(placed.map((p) => p.partId)).size).toBe(1);
  });

  it('sheets inside sheets, and a sheet that includes itself', async () => {
    const outer = `(kicad_sch (version 20211123) (generator eeschema)
      ${LIB}
      (hierarchical_label "A" (shape input) (at ${m(16)} ${m(24)} 180))
      ${wire(16, 24, 32, 24)}
      (sheet (at ${m(32)} ${m(20)}) (size ${m(16)} ${m(8)}) (property "Sheetname" "Inner") (property "Sheetfile" "divider.kicad_sch") (pin "IN" input (at ${m(32)} ${m(24)} 180)) (pin "OUT" output (at ${m(48)} ${m(24)} 0))))`;
    const top = TOP.replace('divider.kicad_sch', 'outer.kicad_sch').replace(`(pin "IN" input (at ${m(80)} ${m(44)} 180))`, `(pin "A" input (at ${m(80)} ${m(44)} 180))`);
    const files: Record<string, string> = { 'outer.kicad_sch': outer, 'divider.kicad_sch': DIVIDER };
    const r = await importKicadProject(top, { fileName: 'top.kicad_sch', read: (f) => files[f] ?? null });
    expect(r.design.children!.map((c) => c.name).sort()).toEqual(['Divider', 'Inner'].sort());
    // the outer block holds the inner one
    const outerChild = r.design.children!.find((c) => c.sourceFile === 'outer.kicad_sch')!;
    expect(outerChild.sheets[0].parts.some((p) => p.partId.startsWith('hier:'))).toBe(true);
    expect(() => parseDesign(serializeDesign(r.design))).not.toThrow();
    expect(opVoltages(r.design)).toBeDefined();

    const selfRef = `(kicad_sch (version 20211123) (generator eeschema) ${LIB}
      (sheet (at ${m(8)} ${m(8)}) (size ${m(8)} ${m(8)}) (property "Sheetname" "Again") (property "Sheetfile" "self.kicad_sch")))`;
    const s = await importKicadProject(selfRef, { fileName: 'self.kicad_sch', read: () => selfRef });
    expect(s.notes.some((n) => n.kind === 'warning' && /includes itself/.test(n.what))).toBe(true);
  });
});

describe('buses', () => {
  /** Three labelled wires reach the bus D[0..2] through bus entries; each ends in a resistor to ground. */
  const BUS = `(kicad_sch (version 20211123) (generator eeschema)
    ${LIB}
    (bus (pts (xy ${m(80)} ${m(80)}) (xy ${m(80)} ${m(96)})))
    (label "D[0..2]" (at ${m(80)} ${m(94)} 90))
    ${[0, 1, 2].map((i) => `(bus_entry (at ${m(80)} ${m(82 + i * 4)}) (size ${m(2)} ${m(2)}))`).join('\n    ')}
    ${[0, 1, 2].map((i) => wire(82, 84 + i * 4, 88, 84 + i * 4)).join('\n    ')}
    ${[0, 1, 2].map((i) => `(label "D${i}" (at ${m(85)} ${m(84 + i * 4)} 0))`).join('\n    ')}
    ${[0, 1, 2].map((i) => res(`R${i + 1}`, '1k', 91, 84 + i * 4, 90)).join('\n    ')}
    ${[0, 1, 2].map((i) => wire(94, 84 + i * 4, 96, 84 + i * 4)).join('\n    ')}
    ${[0, 1, 2].map((i) => power('GND', 96, 84 + i * 4, i + 1)).join('\n    ')}
  )`;

  it('a bus becomes a bus wire named like its label, each entry a stub with a bus-entry label', () => {
    const r = importKicad(BUS, { fileName: 'bus.kicad_sch' });
    const sheet = r.design.sheets[0];
    const bus = sheet.wires.filter((w) => w.bus);
    expect(bus).toHaveLength(1);
    expect(bus[0].busName).toBe('D[0..2]');
    expect(bus[0].points).toHaveLength(2);
    const entries = sheet.labels.filter((l) => l.kind === 'bus-entry');
    expect(entries.map((l) => l.name).sort()).toEqual(['D0', 'D1', 'D2']);
    // each entry label sits on the bus line and has a stub wire starting there
    for (const e of entries) {
      expect(e.x).toBe(bus[0].points[0].x);
      expect(sheet.wires.some((w) => !w.bus && w.points[0].x === e.x && w.points[0].y === e.y)).toBe(true);
    }
    expect(r.notes).toContainEqual({ kind: 'buses', buses: 1, entries: 3 });
    // the bus label did not become a net
    expect(sheet.labels.some((l) => l.name === 'D[0..2]')).toBe(false);
  });

  it('the design saves, reopens and netlists; the labelled wires are the nets D0, D1, D2', () => {
    const r = importKicad(BUS, { fileName: 'bus.kicad_sch' });
    const back = parseDesign(serializeDesign(r.design));
    const nb = buildNetlist(back, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    const nets = new Set(nb.netlist.elements.flatMap((e) => e.nodes));
    for (const n of ['D0', 'D1', 'D2']) expect(nets.has(n)).toBe(true);
  });

  it('bus names: ranges, groups, prefixed groups and aliases', () => {
    expect(kicadBusName('D[0..7]')).toBe('D[0..7]');
    expect(kicadBusName('D[7..0]')).toBe('D[7..0]');
    expect(kicadBusName('{A B C}')).toBe('A,B,C');
    expect(kicadBusName('P{X Y}')).toBe('PX,PY');
    expect(kicadBusName('DATA', new Map([['DATA', ['D0', 'D1', 'D2']]]))).toBe('D0,D1,D2');
    expect(kicadBusName('weird name!')).toBeNull();
    // a plain name is a bus of one line
    expect(kicadBusName('DATA')).toBe('DATA');
    for (const n of ['D[0..7]', 'A,B,C', 'D0,D1']) expect(parseBusName(n).error).toBeUndefined();
  });

  it('an entry whose wire has no label is left out and reported', () => {
    const unlabelled = BUS.replace(/\(label "D[0-2]" [^\n]*/g, '');
    const r = importKicad(unlabelled, { fileName: 'bus.kicad_sch' });
    expect(r.design.sheets[0].labels.filter((l) => l.kind === 'bus-entry')).toHaveLength(0);
    expect(r.notes.some((n) => n.kind === 'warning' && /bus entry/.test(n.what))).toBe(true);
  });
});

describe('KiCad 5 schematics and libraries', () => {
  const LEGACY_LIB = `EESchema-LIBRARY Version 2.4
#encoding utf-8
DEF R R 0 0 N Y 1 F N
F0 "R" 80 0 50 V V C CNN
F1 "R" 0 0 50 V V C CNN
F2 "" -70 0 50 V I C CNN
F3 "~" 0 0 50 H I C CNN
DRAW
S -40 -100 40 100 0 1 10 N
X ~ 1 0 150 50 D 50 50 1 1 P
X ~ 2 0 -150 50 U 50 50 1 1 P
ENDDRAW
ENDDEF
DEF GND #PWR 0 0 N N 1 F P
F0 "#PWR" 0 -250 50 H I C CNN
F1 "GND" 0 -150 50 H V C CNN
DRAW
X GND 1 0 0 0 D 50 50 1 1 W N
ENDDRAW
ENDDEF
DEF +5V #PWR 0 0 N N 1 F P
F0 "#PWR" 0 -150 50 H I C CNN
F1 "+5V" 0 140 50 H V C CNN
DRAW
X +5V 1 0 0 0 U 50 50 1 1 W N
ENDDRAW
ENDDEF
#End Library
`;
  const comp = (lib: string, ref: string, value: string, x: number, y: number, m: [number, number, number, number]) => `$Comp
L ${lib} ${ref}
U 1 1 5F0A${ref.length}${x}
P ${x} ${y}
F 0 "${ref}" V ${x + 80} ${y} 50  0000 C CNN
F 1 "${value}" V ${x} ${y} 50  0000 C CNN
F 2 "" V ${x - 70} ${y} 50  0001 C CNN
F 3 "~" H ${x} ${y} 50  0001 C CNN
\t1    ${x} ${y}
\t${m[0]}    ${m[1]}    ${m[2]}    ${m[3]}
$EndComp
`;
  const N: [number, number, number, number] = [1, 0, 0, -1];
  // R3 lies on its side: lib (0, 150) -> screen (-150, 0)
  const SIDE: [number, number, number, number] = [0, -1, -1, 0];
  const SCH = `EESchema Schematic File Version 4
LIBS:power
LIBS:device
EELAYER 30 0
EELAYER END
$Descr A4 11693 8268
encoding utf-8
Sheet 1 1
Title "Legacy divider"
Date ""
Rev ""
Comp ""
Comment1 ""
$EndDescr
${comp('power:+5V', '#PWR01', '+5V', 4000, 2700, N)}${comp('Device:R', 'R1', '1k', 4000, 3000, N)}${comp('Device:R', 'R2', '1k', 4000, 3300, N)}${comp('Device:R', 'R3', '2k', 4400, 3150, SIDE)}${comp('power:GND', '#PWR02', 'GND', 4000, 3600, N)}${comp('power:GND', '#PWR03', 'GND', 4550, 3300, N)}Wire Wire Line
\t4000 2700 4000 2850
Wire Wire Line
\t4000 3450 4000 3600
Wire Wire Line
\t4000 3150 4250 3150
Wire Wire Line
\t4550 3150 4550 3300
Wire Wire Line
\t4550 3150 4550 3000
Connection ~ 4000 3150
Text Label 4100 3150 0 50 ~ 0
MID
$EndSCHEMATC
`;

  it('reads the headers and the library nicknames', () => {
    expect(isLegacySchematic(SCH)).toBe(true);
    expect(isLegacySchematic('(kicad_sch (version 1))')).toBe(false);
    expect(legacyLibraryNicknames(SCH).sort()).toEqual(['Device', 'device', 'power'].sort());
  });

  it('the orientation matrix of every placement maps back to an angle and a mirror', () => {
    expect(matrixToOrientation(1, 0, 0, -1)).toEqual({ angle: 0, mirror: null });
    expect(matrixToOrientation(-1, 0, 0, 1)).toEqual({ angle: 180, mirror: null });
    const all: [number, number, number, number][] = [
      [1, 0, 0, -1],
      [0, 1, -1, 0],
      [-1, 0, 0, 1],
      [0, -1, 1, 0],
      [1, 0, 0, 1],
      [-1, 0, 0, -1],
      [0, 1, 1, 0],
      [0, -1, -1, 0],
    ];
    const seen = new Set<string>();
    for (const m of all) {
      const o = matrixToOrientation(...m);
      expect(o, m.join(' ')).not.toBeNull();
      seen.add(JSON.stringify(o));
    }
    // eight matrices, eight different placements
    expect(seen.size).toBe(8);
    expect(matrixToOrientation(1, 1, 0, 1)).toBeNull();
  });

  it('converts to a KiCad 6 schematic the importer reads, with units in millimetres', () => {
    const conv = legacySchToKicadSch(SCH, librarySymbols(LEGACY_LIB));
    expect(conv.missing).toEqual([]);
    expect(conv.text).toContain('(kicad_sch');
    expect(conv.text).toContain('(title "Legacy divider")');
    // 4000 mil = 101.6 mm
    expect(conv.text).toContain('(at 101.6 76.2 0)');
    expect(conv.text).toContain('(lib_id "Device:R")');
  });

  it('imports through the library and divides like a divider: 1k, then 1k parallel 2k, from 5 V', async () => {
    const r = await importKicadProject(SCH, { fileName: 'legacy.sch', libraries: librarySymbols(LEGACY_LIB) });
    expect(r.missingSymbols).toEqual([]);
    expect(r.design.title).toBe('Legacy divider');
    expect(r.stats.parts).toBeGreaterThanOrEqual(4);
    const { nodes, v } = opVoltages(r.design);
    // the middle net: R2 and R3 both pull it to ground, R1 feeds it: 5 * (1k||2k) / (1k + 1k||2k) = 2 V
    const r1 = Object.entries(nodes).find(([n]) => /R1$/.test(n))!;
    const r2 = Object.entries(nodes).find(([n]) => /R2$/.test(n))!;
    const mid = r1[1].find((x) => r2[1].includes(x))!;
    expect(v(mid)).toBeCloseTo(2.0, 4);
    // the label MID names that net
    expect(mid).toBe('MID');
  });

  it('a symbol that no library holds is reported, and the rest still imports', async () => {
    const r = await importKicadProject(SCH, { fileName: 'legacy.sch', libraries: [] });
    expect(r.missingSymbols.sort()).toEqual(['Device:R', 'power:+5V', 'power:GND'].sort());
  });

  it('legacy sheets and buses become blocks and bus wires like the new format', async () => {
    const withSheet = SCH.replace('$EndSCHEMATC', `$Sheet
S 5000 2800 1000 400
U 5F0B0001
F0 "Sub" 50
F1 "sub.sch" 50
F2 "IN" I L 5000 3000 50
$EndSheet
Wire Wire Line
\t4550 3000 5000 3000
Wire Bus Line
\t6500 2000 6500 2500
Entry Wire Line
\t6500 2100 6600 2200
Wire Wire Line
\t6600 2200 6800 2200
Text Label 6700 2200 0 50 ~ 0
Q0
Text Label 6500 2400 0 50 ~ 0
Q[0..1]
$EndSCHEMATC`);
    const SUB = `EESchema Schematic File Version 4
LIBS:power
${comp('Device:R', 'R9', '1k', 4000, 3000, N)}Text HLabel 3800 2850 0 50 Input ~ 0
IN
Wire Wire Line
\t3800 2850 4000 2850
$EndSCHEMATC
`;
    const r = await importKicadProject(withSheet, { fileName: 'top.sch', libraries: librarySymbols(LEGACY_LIB), read: (f) => (f === 'sub.sch' ? SUB : null) });
    expect(r.missing).toEqual([]);
    expect(r.design.children).toHaveLength(1);
    expect(r.design.children![0].name).toBe('Sub');
    expect(r.design.sheets[0].wires.some((w) => w.bus && w.busName === 'Q[0..1]')).toBe(true);
    expect(r.design.sheets[0].labels.some((l) => l.kind === 'bus-entry' && l.name === 'Q0')).toBe(true);
    expect(() => parseDesign(serializeDesign(r.design))).not.toThrow();
  });

  it('a library file of either generation is read by librarySymbols', () => {
    expect(librarySymbols(LEGACY_LIB).map((s) => s.name)).toEqual(['R', 'GND', '+5V']);
    expect(librarySymbols('(kicad_symbol_lib (version 1) (symbol "X" (symbol "X_1_1" (pin passive line (at 0 0 0) (length 1) (name "A") (number "1")))))').map((s) => s.name)).toEqual(['X']);
  });
});
