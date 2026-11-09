import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import { DesignBuilder } from './designkit';
import { edifToNetlist, importEdif } from './edifImport';
import { isGroundName, powerNetVolts } from './importSchematic';
import { importKicad, kicadPinPosition, kicadToNetlist } from './kicadImport';
import { buildNetlist } from './netlister';
import type { Design } from './types';

const FIX = fileURLToPath(new URL('./fixtures/', import.meta.url));

function op(design: Design): Record<string, number> {
  const build = buildNetlist(design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
  const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars!;
}

/** Node voltage of a net named by a label in the design. */
function v(design: Design, net: string): number {
  const s = op(design);
  const build = buildNetlist(design, { includeAnalysis: false });
  const info = build.nets.find((n) => n.displayName === net || n.name === net);
  expect(info, `net ${net}`).toBeDefined();
  return s[`V(${info!.name})`];
}

describe('KiCad schematic import', () => {
  const text = readFileSync(FIX + 'divider-diode.kicad_sch', 'utf8');

  it('places library pins with KiCad orientation rules (y-up library, counter-clockwise angle)', () => {
    const at = (p: { x: number; y: number }) => [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000];
    expect(at(kicadPinPosition({ x: 0, y: 3.81 }, { x: 10, y: 20, angle: 0 }, { x: false, y: false }))).toEqual([10, 16.19]);
    // 90°: the upper pin moves to the left
    expect(at(kicadPinPosition({ x: 0, y: 3.81 }, { x: 10, y: 20, angle: 90 }, { x: false, y: false }))).toEqual([6.19, 20]);
    // mirror y flips left and right after the rotation
    expect(at(kicadPinPosition({ x: 0, y: 3.81 }, { x: 10, y: 20, angle: 90 }, { x: false, y: true }))).toEqual([13.81, 20]);
    // mirror x flips up and down
    expect(at(kicadPinPosition({ x: 0, y: 3.81 }, { x: 10, y: 20, angle: 0 }, { x: true, y: false }))).toEqual([10, 23.81]);
    // 270°: the upper pin moves to the right
    expect(at(kicadPinPosition({ x: 0, y: 3.81 }, { x: 10, y: 20, angle: 270 }, { x: false, y: false }))).toEqual([13.81, 20]);
  });

  it('reads components, values, pins and nets from wires, junctions, labels and power symbols', () => {
    const net = kicadToNetlist(text, 'divider-diode.kicad_sch');
    expect(net.title).toBe('Divider with diode load');
    expect(net.components.map((c) => `${c.refdes}:${c.value}`)).toEqual(['V1:12', 'R1:10k', 'R2:4k7', 'R3:1k', 'D1:1N4148']);
    const pins = (ref: string) => Object.fromEntries(net.components.find((c) => c.refdes === ref)!.pins.map((p) => [p.number, p.net]));
    expect(pins('R1')['2']).toBe('OUT');
    expect(pins('R2')).toEqual({ '1': 'OUT', '2': 'GND' });
    // the R3 wire ends in the middle of the R1–R2 wire: a T connection
    expect(pins('R3')['1']).toBe('OUT');
    expect(pins('D1')).toEqual({ '1': 'GND', '2': pins('R3')['2'] });
    expect(pins('V1')['1']).toBe(pins('R1')['1']);
    expect(net.namedNets.sort()).toEqual(['GND', 'OUT']);
  });

  it('keeps unannotated symbols ("R?") apart and numbers them itself', () => {
    const raw = text.replace('"Reference" "R1"', '"Reference" "R?"').replace('"Reference" "R3"', '"Reference" "R?"');
    const net = kicadToNetlist(raw, 'unannotated.kicad_sch');
    expect(net.unannotated).toBe(2);
    // R2 keeps its number, the two "R?" get the free ones; no symbol is merged away
    const resistors = net.components.filter((c) => c.symbol === 'Device:R');
    expect(resistors.length).toBe(3);
    expect(resistors.map((c) => c.refdes).sort()).toEqual(['R1', 'R2', 'R3']);
    expect(resistors.map((c) => c.value).sort()).toEqual(['10k', '1k', '4k7']);
    const { notes } = importKicad(raw, { fileName: 'unannotated.kicad_sch' });
    expect(notes.filter((n) => n.kind === 'unannotated')).toEqual([{ kind: 'unannotated', count: 2 }]);
  });

  it('reads a value written with a space before its unit ("4.7 k", "1 kohm 5%")', () => {
    const spaced = text.replace('"Value" "4k7"', '"Value" "4.7 k"').replace('"Value" "1k"', '"Value" "1 kohm 5%"');
    const { design, notes } = importKicad(spaced, { fileName: 'spaced.kicad_sch' });
    expect(notes.filter((n) => n.kind === 'defaultValue')).toEqual([]);
    const value = (ref: string) => design.sheets[0].parts.find((p) => p.refdes === ref)!.params.value;
    expect([value('R1'), value('R2'), value('R3')]).toEqual(['10k', '4.7k', '1k']);
    // and the resistances that reach the netlist are the ones the file meant
    const build = buildNetlist(design);
    const resistors = build.netlist.elements.filter((e) => /^r/i.test(e.name) && e.nodes.length === 2).map((e) => e.value as number);
    expect(resistors.sort((x, y) => x - y)).toEqual([1000, 4700, 10000]);
  });

  it('simulates exactly like the same circuit drawn in MachSim', () => {
    const { design, notes, stats } = importKicad(text, { fileName: 'divider-diode.kicad_sch', sheetName: 'Trang 1' });
    expect(stats.generic).toBe(0);
    expect(notes.filter((n) => n.kind === 'generic')).toEqual([]);
    expect(design.sheets[0].name).toBe('Trang 1');
    const parts = design.sheets[0].parts.filter((p) => !p.partId.startsWith('sources/ground'));
    expect(parts.map((p) => `${p.refdes}=${p.partId}`).sort()).toEqual(['D1=diodes/1n4148', 'R1=basic/resistor', 'R2=basic/resistor', 'R3=basic/resistor', 'V1=sources/dc-voltage']);
    // R1 is drawn vertically like in KiCad, R3 horizontally
    expect(design.sheets[0].parts.find((p) => p.refdes === 'R1')!.rotation % 180).toBe(90);
    expect(design.sheets[0].parts.find((p) => p.refdes === 'R3')!.rotation % 180).toBe(0);
    // reference: the same circuit built from the same library parts
    const b = new DesignBuilder('ref');
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 100, { value: '12' });
    const r1 = b.part('basic/resistor', 'R1', 100, 0, { value: '10k' });
    const r2 = b.part('basic/resistor', 'R2', 200, 100, { value: '4.7k' }, { rotation: 90 });
    const r3 = b.part('basic/resistor', 'R3', 300, 0, { value: '1k' });
    const d1 = b.part('diodes/1n4148', 'D1', 400, 100, {}, { rotation: 90 });
    b.part('sources/ground', 'G', 0, 200);
    b.labelPin(v1, '+', 'TOP');
    b.labelPin(r1, '1', 'TOP');
    b.labelPin(r1, '2', 'OUT');
    b.labelPin(r2, '1', 'OUT');
    b.labelPin(r3, '1', 'OUT');
    b.labelPin(r3, '2', 'MID');
    b.labelPin(d1, 'A', 'MID');
    for (const [h, pin] of [[v1, '-'], [r2, '2'], [d1, 'K']] as const) b.labelPin(h, pin, '0');
    const want = v(b.design, 'OUT');
    expect(want).toBeGreaterThan(0.6);
    expect(want).toBeLessThan(3.84);
    expect(v(design, 'OUT')).toBeCloseTo(want, 9);
  });

  it('turns unknown symbols into generic blocks and power nets without a source into supplies', () => {
    const extra = text
      .replace('(lib_symbols', `(lib_symbols
    (symbol "Connector:Conn_01x02" (in_bom yes) (on_board yes)
      (symbol "Conn_01x02_1_1"
        (pin passive line (at -5.08 0 0) (length 3.81) (name "Pin_1") (number "1"))
        (pin passive line (at -5.08 -2.54 0) (length 3.81) (name "Pin_2") (number "2"))))
    (symbol "power:+5V" (power) (in_bom yes) (on_board yes)
      (symbol "+5V_1_1" (pin power_in line (at 0 0 90) (length 0) hide (name "+5V") (number "1"))))`)
      .replace('(sheet_instances', `(symbol (lib_id "Connector:Conn_01x02") (at 127 127 0) (unit 1) (property "Reference" "J1") (property "Value" "Conn") (pin "1") (pin "2"))
  (symbol (lib_id "power:+5V") (at 121.92 127 0) (unit 1) (property "Reference" "#PWR9") (property "Value" "+5V") (pin "1"))
  (sheet_instances`);
    const { design, notes } = importKicad(extra);
    expect(notes).toContainEqual({ kind: 'generic', refdes: 'J1', symbol: 'Connector:Conn_01x02' });
    expect(notes).toContainEqual({ kind: 'supply', net: '+5V', volts: 5 });
    expect(design.customParts?.map((c) => c.model.kind)).toEqual(['none']);
    expect(design.sheets[0].parts.find((p) => p.refdes === 'J1')!.partId).toBe('custom:import-kicad-connector-conn-01x02-2');
  });

  it('rejects files that are not KiCad schematics', () => {
    expect(() => kicadToNetlist('(edif x)')).toThrow(/not a KiCad schematic/);
    expect(() => kicadToNetlist('(kicad_sch (wire (pts (xy 0 0)')).toThrow(/not closed/);
  });
});

describe('EDIF 2 0 0 import', () => {
  const text = readFileSync(FIX + 'bjt-switch.edf', 'utf8');

  it('reads instances, renamed identifiers, values, %nn% escapes and joined nets', () => {
    const net = edifToNetlist(text, 'bjt-switch.edf');
    expect(net.title).toBe('bjtswitch');
    expect(net.components.map((c) => `${c.refdes}:${c.symbol}:${c.value}`)).toEqual(['VCC1:VDC:12', 'VIN:VDC:DC 5', 'RC:RES:1k', 'RB:RES:100k', 'Q1:Q2N3904:2N3904', 'J1:CONN2:Screw terminal']);
    const q = net.components.find((c) => c.refdes === 'Q1')!;
    expect(Object.fromEntries(q.pins.map((p) => [p.name, p.net]))).toEqual({ C: 'OUT', B: 'N00012', E: 'GND' });
    expect(net.namedNets.sort()).toEqual(['DRIVE', 'GND', 'OUT', 'VSUP']);
  });

  it('simulates exactly like the same circuit drawn in MachSim', () => {
    const { design, notes } = importEdif(text, { fileName: 'bjt-switch.edf' });
    expect(design.sheets[0].parts.find((p) => p.refdes === 'Q1')!.partId).toBe('transistors/2n3904');
    expect(notes.filter((n) => n.kind === 'generic').map((n) => (n as { refdes: string }).refdes)).toEqual(['J1']);
    const b = new DesignBuilder('ref');
    const vcc = b.part('sources/dc-voltage', 'VCC1', 0, 100, { value: '12' });
    const vin = b.part('sources/dc-voltage', 'VIN', 100, 100, { value: '5' });
    const rc = b.part('basic/resistor', 'RC', 200, 0, { value: '1k' });
    const rb = b.part('basic/resistor', 'RB', 300, 0, { value: '100k' });
    const q1 = b.part('transistors/2n3904', 'Q1', 400, 100);
    b.part('sources/ground', 'G', 0, 300);
    for (const [h, pin, n] of [[vcc, '+', 'VSUP'], [rc, '1', 'VSUP'], [rc, '2', 'OUT'], [q1, 'C', 'OUT'], [rb, '2', 'B'], [q1, 'B', 'B'], [vin, '+', 'DRIVE'], [rb, '1', 'DRIVE'], [vcc, '-', '0'], [vin, '-', '0'], [q1, 'E', '0']] as const) b.labelPin(h, pin, n);
    const out = v(b.design, 'OUT');
    // active region: VC = 12 V − hFE·IB·RC with IB ≈ (5 − 0.7) V / 100 kΩ
    expect(out).toBeGreaterThan(1);
    expect(out).toBeLessThan(11);
    expect(v(design, 'OUT')).toBeCloseTo(out, 9);
    expect(v(design, 'DRIVE')).toBeCloseTo(5, 12);
  });

  it('rejects files that are not EDIF', () => {
    expect(() => edifToNetlist('(kicad_sch)')).toThrow(/not an EDIF file/);
    expect(() => edifToNetlist('(edif x (edifVersion 2 0 0))')).toThrow(/no cell with contents/);
  });
});

describe('net-name rules', () => {
  it('knows ground names and the voltage of power-net names', () => {
    expect(['GND', 'gnd', '0', 'GNDA', 'Earth', 'AGND'].every(isGroundName)).toBe(true);
    expect(isGroundName('OUT')).toBe(false);
    expect(['+5V', '-12V', '+3V3', '3.3V', 'VCC', 'VEE', 'OUT'].map(powerNetVolts)).toEqual([5, -12, 3.3, 3.3, 5, -5, null]);
  });
});
