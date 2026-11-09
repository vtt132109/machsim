/**
 * KiCad symbol libraries: fixtures written from the public descriptions of the .kicad_sym
 * (s-expression) and the legacy .lib formats. Pin geometry, units, derived symbols, fields, SPICE
 * fields (through the real netlister and engine), the export and its round trip.
 */
import { describe, expect, it } from 'vitest';
import { importKicadSymbols, kicadLibSymbolsSexpr, parseKicadSym, parseLegacyLib, partsToKicadSym, KicadSymbolError } from './kicadSymbols';
import { readCustomPart } from '../library/custom/validate';
import { customPartDef, customPartProblems } from '../library/custom/partDef';
import { parseSexpr, children, head, child, atom } from '../util/sexpr';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { runAnalyses } from '../sim';
import type { AnalysisResult } from '../sim/results';
import { loadAllGroups } from '../library';

await loadAllGroups();

const LIB = `(kicad_symbol_lib (version 20211014) (generator kicad_symbol_editor)
  (symbol "R" (pin_numbers hide) (pin_names (offset 0)) (in_bom yes) (on_board yes)
    (property "Reference" "R" (id 0) (at 2.032 0 90) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (id 1) (at 0 0 90) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Resistor_SMD:R_0805_2012Metric" (id 2) (at -1.778 0 90) (effects (font (size 1.27 1.27)) hide))
    (property "Datasheet" "https://example.org/resistor.pdf" (id 3) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "ki_keywords" "R res resistor" (id 4) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "ki_description" "Resistor" (id 5) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Sim.Device" "R" (id 6) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Sim.Params" "r=4.7k" (id 7) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Sim.Pins" "1=1 2=2" (id 8) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (symbol "R_0_1"
      (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type none))))
    (symbol "R_1_1"
      (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))))
  (symbol "LM358" (pin_names (offset 0.254)) (in_bom yes) (on_board yes)
    (property "Reference" "U" (id 0) (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "LM358" (id 1) (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Package_DIP:DIP-8_W7.62mm" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Manufacturer" "Example Semi" (id 3) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (symbol "LM358_0_1"
      (polyline (pts (xy -5.08 5.08) (xy 5.08 0) (xy -5.08 -5.08) (xy -5.08 5.08)) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type background))))
    (symbol "LM358_1_1"
      (pin output line (at 7.62 0 180) (length 2.54) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin input line (at -7.62 -2.54 0) (length 2.54) (name "-" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
      (pin input line (at -7.62 2.54 0) (length 2.54) (name "+" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27))))))
    (symbol "LM358_2_1"
      (pin input line (at -7.62 2.54 0) (length 2.54) (name "+" (effects (font (size 1.27 1.27)))) (number "5" (effects (font (size 1.27 1.27)))))
      (pin input line (at -7.62 -2.54 0) (length 2.54) (name "-" (effects (font (size 1.27 1.27)))) (number "6" (effects (font (size 1.27 1.27)))))
      (pin output line (at 7.62 0 180) (length 2.54) (name "~" (effects (font (size 1.27 1.27)))) (number "7" (effects (font (size 1.27 1.27))))))
    (symbol "LM358_3_1"
      (pin power_in line (at -2.54 7.62 270) (length 3.81) (name "V+" (effects (font (size 1.27 1.27)))) (number "8" (effects (font (size 1.27 1.27)))))
      (pin power_in line (at -2.54 -7.62 90) (length 3.81) (name "V-" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))))
  (symbol "Q_NPN" (pin_names (offset 0) hide) (in_bom yes) (on_board yes)
    (property "Reference" "Q" (id 0) (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "Q_NPN" (id 1) (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Sim.Device" "NPN" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Sim.Params" "bf=200 is=1e-14 vaf=100" (id 3) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Sim.Pins" "1=C 2=B 3=E" (id 4) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (symbol "Q_NPN_0_1"
      (circle (center 1.27 0) (radius 2.8194) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type none)))
      (arc (start 2.54 -2.54) (mid 3.81 0) (end 2.54 2.54) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type none))))
    (symbol "Q_NPN_1_1"
      (pin passive line (at 2.54 5.08 270) (length 2.54) (name "C" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin input line (at -5.08 0 0) (length 5.08) (name "B" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 2.54 -5.08 90) (length 2.54) (name "E" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))))
  (symbol "D" (pin_numbers hide) (pin_names (offset 1.016) hide) (in_bom yes) (on_board yes)
    (property "Reference" "D" (id 0) (at 0 2.54 0) (effects (font (size 1.27 1.27))))
    (property "Value" "D" (id 1) (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (symbol "D_0_1"
      (polyline (pts (xy -1.27 1.27) (xy -1.27 -1.27)) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type none)))
      (polyline (pts (xy 1.27 0) (xy -1.27 0)) (stroke (width 0) (type default) (color 0 0 0 0)) (fill (type none)))
      (polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27) (xy -1.27 0) (xy 1.27 1.27)) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type none))))
    (symbol "D_1_1"
      (pin passive line (at -3.81 0 0) (length 2.54) (name "K" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 3.81 0 180) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))))
  (symbol "D_Zener" (extends "D") (pin_numbers hide) (pin_names (offset 1.016) hide) (in_bom yes) (on_board yes)
    (property "Reference" "D" (id 0) (at 0 2.54 0) (effects (font (size 1.27 1.27))))
    (property "Value" "D_Zener" (id 1) (at 0 -2.54 0) (effects (font (size 1.27 1.27))))
    (property "ki_keywords" "diode zener" (id 4) (at 0 0 0) (effects (font (size 1.27 1.27)) hide)))
  (symbol "GND" (power) (pin_names (offset 0) hide) (in_bom yes) (on_board yes)
    (property "Reference" "#PWR" (id 0) (at 0 -6.35 0) (effects (font (size 1.27 1.27)) hide))
    (property "Value" "GND" (id 1) (at 0 -3.81 0) (effects (font (size 1.27 1.27))))
    (symbol "GND_0_1"
      (polyline (pts (xy 0 0) (xy 0 -1.27) (xy 1.27 -1.27) (xy 0 -2.54) (xy -1.27 -1.27) (xy 0 -1.27)) (stroke (width 0) (type default) (color 0 0 0 0)) (fill (type none))))
    (symbol "GND_1_1"
      (pin power_in line (at 0 0 270) (length 0) hide (name "GND" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))))
  (symbol "SN74HC00_NAND" (in_bom yes) (on_board yes)
    (property "Reference" "U" (id 0) (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "SN74HC00_NAND" (id 1) (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "SN74HC00_NAND_0_1"
      (rectangle (start -5.08 5.08) (end 5.08 -5.08) (stroke (width 0.254) (type default) (color 0 0 0 0)) (fill (type background)))
      (text "&" (at 0 0 0) (effects (font (size 2.54 2.54)))))
    (symbol "SN74HC00_NAND_1_1"
      (pin input inverted (at -7.62 2.54 0) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin input clock (at -7.62 -2.54 0) (length 2.54) (name "B" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
      (pin output line (at 7.62 0 180) (length 2.54) hide (name "Y" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
      (pin tri_state line (at 0 7.62 270) (length 2.54) (name "OE" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27))))))))
`;

describe('reading a .kicad_sym library', () => {
  const { symbols, notes } = parseKicadSym(LIB);
  const byName = (n: string) => symbols.find((s) => s.name === n)!;

  it('lists the symbols with their pins, fields and graphics', () => {
    expect(symbols.map((s) => s.name)).toEqual(['R', 'LM358', 'Q_NPN', 'D', 'D_Zener', 'GND', 'SN74HC00_NAND']);
    const r = byName('R');
    expect(r.props.Footprint).toBe('Resistor_SMD:R_0805_2012Metric');
    expect(r.hidePinNumbers).toBe(true);
    expect(r.pins.map((p) => [p.number, p.x, p.y, p.angle, p.length, p.type])).toEqual([
      ['1', 0, 3.81, 270, 1.27, 'passive'],
      ['2', 0, -3.81, 90, 1.27, 'passive'],
    ]);
    expect(r.graphics).toEqual([{ kind: 'rect', x1: -1.016, y1: -2.54, x2: 1.016, y2: 2.54, fill: 'none', unit: 0 }]);
  });

  it('units: pins of each unit and of the common unit', () => {
    const lm = byName('LM358');
    expect(lm.units).toBe(3);
    expect(lm.pins.filter((p) => p.unit === 1).map((p) => p.number)).toEqual(['1', '2', '3']);
    expect(lm.pins.filter((p) => p.unit === 3).map((p) => p.type)).toEqual(['power_in', 'power_in']);
  });

  it('a derived symbol takes the body of its base and keeps its own fields', () => {
    const z = byName('D_Zener');
    expect(z.pins).toHaveLength(2);
    expect(z.graphics).toHaveLength(3);
    expect(z.props.ki_keywords).toBe('diode zener');
  });

  it('an arc through three points becomes a centre and counter-clockwise angles', () => {
    const arc = byName('Q_NPN').graphics.find((g) => g.kind === 'arc')!;
    if (arc.kind !== 'arc') throw new Error('not an arc');
    // start (2.54, -2.54), mid (3.81, 0), end (2.54, 2.54): a circle round (1.27, 0) of radius sqrt(1.27² + 2.54²)... through the three points
    expect(Math.hypot(2.54 - arc.cx, -2.54 - arc.cy)).toBeCloseTo(arc.r, 9);
    expect(Math.hypot(3.81 - arc.cx, 0 - arc.cy)).toBeCloseTo(arc.r, 9);
    expect(Math.hypot(2.54 - arc.cx, 2.54 - arc.cy)).toBeCloseTo(arc.r, 9);
    // counter-clockwise from the lower end to the upper end passes the right-most point (angle 0)
    expect(arc.a1).toBeGreaterThan(180);
    expect(arc.a2).toBeLessThan(180);
  });

  it('refuses a file that is not a symbol library', () => {
    expect(() => parseKicadSym('(kicad_sch (version 1))')).toThrow(KicadSymbolError);
    expect(() => parseKicadSym('not s-expressions at all')).toThrow(KicadSymbolError);
    expect(notes).toEqual([]);
  });
});

describe('symbols as user parts', () => {
  const r = importKicadSymbols(LIB, { fileName: 'device.kicad_sym', family: 'KiCad Device' });
  const part = (name: string) => r.parts.find((p) => p.name === name)!;

  it('every part passes the same validation a saved database goes through, and is ready to simulate', () => {
    for (const p of r.parts) {
      const issues: string[] = [];
      expect(readCustomPart(JSON.parse(JSON.stringify(p)), 'p', issues), p.name).not.toBeNull();
      expect(issues, p.name).toEqual([]);
      expect(customPartProblems(p), p.name).toEqual([]);
      expect(customPartDef(p).symbol.pins.length).toBe(p.symbol.pins.length);
    }
  });

  it('power symbols are left out and a symbol with three units makes three parts', () => {
    expect(r.parts.map((p) => p.name)).toEqual(['R', 'LM358 A', 'LM358 B', 'LM358 C', 'Q_NPN', 'D', 'D_Zener', 'SN74HC00_NAND']);
    expect(r.notes.some((n) => n.code === 'powerSkipped' && n.name === 'GND')).toBe(true);
    expect(r.notes.some((n) => n.code === 'units' && n.name === 'LM358' && n.units === 3)).toBe(true);
    expect(r.families).toEqual(expect.arrayContaining([{ group: 'basic', name: 'KiCad Device' }]));
  });

  it('pins land on the 10-unit grid with the right side, type, label and number', () => {
    const rr = part('R');
    // 3.81 mm = 30 units; KiCad y is up, MachSim y is down
    expect(rr.symbol.pins).toEqual([
      { name: '1', x: 0, y: -30, dir: 'up', type: 'passive', number: '1' },
      { name: '2', x: 0, y: 30, dir: 'down', type: 'passive', number: '2' },
    ]);
    expect(rr.symbol.pins.every((p) => p.x % 10 === 0 && p.y % 10 === 0)).toBe(true);
    // the body: the rectangle 2.032 mm x 5.08 mm
    const rect = rr.symbol.prims.find((q) => q.kind === 'rect')!;
    expect(rect).toMatchObject({ kind: 'rect', x: -8, y: -20, w: 16, h: 40 });
    // and the stub lines run from the pin to the body edge (1.27 mm = 10 units long)
    expect(rr.symbol.prims.filter((q) => q.kind === 'line')).toEqual([
      { kind: 'line', x1: 0, y1: -30, x2: 0, y2: -20 },
      { kind: 'line', x1: 0, y1: 30, x2: 0, y2: 20 },
    ]);
    const op = part('LM358 A');
    expect(op.symbol.pins.map((p) => [p.name, p.x, p.y, p.dir, p.type, p.label])).toEqual([
      ['1', 60, 0, 'right', 'output', undefined],
      ['2', -60, 20, 'left', 'input', '-'],
      ['3', -60, -20, 'left', 'input', '+'],
    ]);
    const supply = part('LM358 C');
    expect(supply.symbol.pins.map((p) => [p.name, p.type, p.dir])).toEqual([
      ['8', 'power-in', 'up'],
      ['4', 'power-in', 'down'],
    ]);
  });

  it('keeps the fields: prefix, footprint without the library nickname, link, keywords, user fields', () => {
    const rr = part('R');
    expect(rr.prefix).toBe('R');
    expect(rr.footprint).toBe('R_0805_2012Metric');
    expect(rr.hyperlink).toBe('https://example.org/resistor.pdf');
    expect(rr.keywords).toEqual(['R', 'res', 'resistor']);
    expect(rr.description).toBe('Resistor');
    expect(rr.group).toBe('basic');
    expect(rr.provenance).toContain('device.kicad_sym');
    expect(part('LM358 A').fields).toEqual({ Manufacturer: 'Example Semi' });
    expect(part('LM358 A').prefix).toBe('U');
  });

  it('draws inverted and clock pins, hidden pins without a label, fills and text', () => {
    const nand = part('SN74HC00_NAND');
    const kinds = nand.symbol.prims.map((p) => p.kind);
    expect(kinds).toContain('circle'); // the inversion bubble
    expect(kinds).toContain('polyline'); // the clock triangle
    expect(kinds).toContain('text');
    expect(nand.symbol.prims.find((p) => p.kind === 'rect')).toMatchObject({ fill: true });
    expect(nand.symbol.pins.find((p) => p.name === '3')?.label).toBeUndefined();
    expect(nand.symbol.pins.find((p) => p.name === '4')).toMatchObject({ type: 'tristate', dir: 'up' });
    const types = Object.fromEntries(nand.symbol.pins.map((p) => [p.name, p.type]));
    expect(types).toEqual({ '1': 'input', '2': 'input', '3': 'output', '4': 'tristate' });
  });

  it('the diode: a closed filled-less triangle, and the derived zener has the same body', () => {
    expect(part('D').symbol.prims.length).toBe(part('D_Zener').symbol.prims.length);
    expect(part('D_Zener').keywords).toEqual(['diode', 'zener']);
    expect(part('D').group).toBe('diodes');
  });

  it('bounding boxes cover the shapes and the pins', () => {
    for (const p of r.parts) {
      for (const pin of p.symbol.pins) {
        expect(pin.x).toBeGreaterThanOrEqual(p.symbol.bbox.x - 0.001);
        expect(pin.x).toBeLessThanOrEqual(p.symbol.bbox.x + p.symbol.bbox.w + 0.001);
        expect(pin.y).toBeGreaterThanOrEqual(p.symbol.bbox.y - 0.001);
        expect(pin.y).toBeLessThanOrEqual(p.symbol.bbox.y + p.symbol.bbox.h + 0.001);
      }
    }
  });
});

describe('SPICE fields', () => {
  const r = importKicadSymbols(LIB);
  const part = (name: string) => r.parts.find((p) => p.name === name)!;

  it('R with Sim.Params reuses the library resistor with that value', () => {
    expect(part('R').model).toEqual({ kind: 'builtin', partId: 'basic/resistor', pinMap: { '1': '1', '2': '2' }, params: { value: '4.7k' } });
  });

  it('NPN with Sim.Params becomes a .model card on the pins named by Sim.Pins', () => {
    const q = part('Q_NPN');
    expect(q.group).toBe('transistors');
    expect(q.model.kind).toBe('spice');
    if (q.model.kind !== 'spice') throw new Error();
    expect(q.model.text).toBe('.model Q_NPN NPN(bf=200 is=1e-14 vaf=100)');
    expect(q.model.pins).toEqual(['1', '2', '3']);
  });

  it('a symbol with no model says so', () => {
    expect(part('D').model.kind).toBe('none');
    expect(r.notes.some((n) => n.code === 'noModel' && n.name === 'D')).toBe(true);
  });

  /** Source V1 = 10 V at node IN, the part U1 on the given nets, a resistive load. */
  function bench(partData: ReturnType<typeof part>, pins: Record<string, string>, extra: (b: DesignBuilder) => void) {
    const b = new DesignBuilder('kicad bench');
    b.design.customParts = [partData];
    const s = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '10' });
    b.labelPin(s, '+', 'IN');
    b.labelPin(s, '-', '0');
    const u = b.part(partData.id, 'U1', 0, 0, {});
    for (const [pin, net] of Object.entries(pins)) b.labelPin(u, pin, net);
    extra(b);
    const nb = buildNetlist(b.design, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    expect(op.error).toBeUndefined();
    return op;
  }
  const v = (op: AnalysisResult, name: string): number => op.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase())!.re[0];

  it('the imported 4.7k resistor divides like a 4.7k resistor', () => {
    // IN - U1(4.7k) - OUT - 1k - ground
    const op = bench(part('R'), { '1': 'IN', '2': 'OUT' }, (b) => {
      const r = b.part('basic/resistor', 'R2', 300, 0, { value: '1k' });
      b.labelPin(r, '1', 'OUT');
      b.labelPin(r, '2', '0');
    });
    expect(v(op, 'V(OUT)')).toBeCloseTo((10 * 1000) / 5700, 6);
  });

  it('the imported transistor biases like a transistor with bf = 200', () => {
    const op = bench(part('Q_NPN'), { '1': 'C', '2': 'B', '3': '0' }, (b) => {
      const rc = b.part('basic/resistor', 'RC', 300, 0, { value: '1k' });
      b.labelPin(rc, '1', 'IN');
      b.labelPin(rc, '2', 'C');
      const rb = b.part('basic/resistor', 'RB', 500, 0, { value: '1M' });
      b.labelPin(rb, '1', 'IN');
      b.labelPin(rb, '2', 'B');
    });
    // Ib = (10 - 0.65) / 1M = 9.35 uA, Ic = 200 * Ib = 1.87 mA, so about 8.1 V at the collector
    expect(v(op, 'V(C)')).toBeGreaterThan(7.7);
    expect(v(op, 'V(C)')).toBeLessThan(8.5);
  });

  it('a subcircuit named by Sim.Library is embedded when the file is supplied, and reported when it is not', () => {
    const lib = `(kicad_symbol_lib (version 20220914) (generator test)
      (symbol "AMP" (in_bom yes) (on_board yes)
        (property "Reference" "U" (id 0) (at 0 0 0) (effects (font (size 1.27 1.27))))
        (property "Value" "AMP" (id 1) (at 0 0 0) (effects (font (size 1.27 1.27))))
        (property "Sim.Device" "SUBCKT" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
        (property "Sim.Library" "C:/models/amp.lib" (id 3) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
        (property "Sim.Name" "TWOX" (id 4) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
        (property "Sim.Pins" "1=IN 2=OUT 3=GND" (id 5) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
        (symbol "AMP_0_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08) (stroke (width 0.254) (type default)) (fill (type none))))
        (symbol "AMP_1_1"
          (pin input line (at -7.62 0 0) (length 2.54) (name "IN") (number "1"))
          (pin output line (at 7.62 0 180) (length 2.54) (name "OUT") (number "2"))
          (pin power_in line (at 0 -7.62 90) (length 2.54) (name "GND") (number "3")))))`;
    const missing = importKicadSymbols(lib);
    expect(missing.parts[0].model.kind).toBe('none');
    expect(missing.notes).toContainEqual({ code: 'modelLibraryMissing', name: 'AMP', file: 'C:/models/amp.lib' });
    const model = '.subckt TWOX IN OUT GND\nE1 OUT GND IN GND 2\nRL OUT GND 1MEG\n.ends TWOX\n';
    const ok = importKicadSymbols(lib, { libraries: new Map([['amp.lib', model]]) });
    const m = ok.parts[0].model;
    expect(m.kind).toBe('spice');
    if (m.kind !== 'spice') throw new Error();
    expect(m.name).toBe('TWOX');
    expect(m.pins).toEqual(['1', '2', '3']);
    expect(m.text.toLowerCase()).toContain('.subckt twox');
    // and it simulates: a gain of 2
    const op = bench(ok.parts[0], { '1': 'IN', '2': 'OUT', '3': '0' }, () => undefined);
    expect(v(op, 'V(OUT)')).toBeCloseTo(20, 6);
  });
});

describe('a legacy .lib', () => {
  const LEGACY = `EESchema-LIBRARY Version 2.4
#encoding utf-8
#
# R
#
DEF R R 0 0 N Y 1 F N
F0 "R" 80 0 50 V V C CNN
F1 "R" 0 0 50 V V C CNN
F2 "Resistor_SMD:R_0805" -70 0 50 V I C CNN
F3 "~" 0 0 50 H I C CNN
$FPLIST
 R_*
$ENDFPLIST
DRAW
S -40 -100 40 100 0 1 10 N
X ~ 1 0 150 50 D 50 50 1 1 P
X ~ 2 0 -150 50 U 50 50 1 1 P
ENDDRAW
ENDDEF
#
# 7400
#
DEF 74LS00 U 0 30 Y Y 5 L N
F0 "U" 0 50 50 H V C CNN
F1 "74LS00" 0 -50 50 H V C CNN
F2 "" 0 0 50 H I C CNN
F3 "" 0 0 50 H I C CNN
DRAW
A 120 -100 100 1800 -1800 1 1 0 N
P 4 1 1 0 0 150 -150 150 -150 -150 0 -150 N
T 0 -50 0 40 0 1 1 NAND N
X ~ 1 -300 100 150 R 50 50 1 1 I
X ~ 2 -300 -100 150 R 50 50 1 1 I
X ~ 3 300 0 150 L 50 50 1 1 O I
X VCC 14 0 600 0 D 50 50 5 1 W
X GND 7 0 -600 0 U 50 50 5 1 W
ENDDRAW
ENDDEF
#
#End Library
`;

  it('reads units, pins, types, shapes and fields', () => {
    const { symbols } = parseLegacyLib(LEGACY);
    expect(symbols.map((s) => s.name)).toEqual(['R', '74LS00']);
    const r = symbols[0];
    // 150 mil = 3.81 mm, a pin pointing down into the body (orientation D) sits above it
    expect(r.pins.map((p) => [p.number, +p.x.toFixed(3), +p.y.toFixed(3), p.angle, +p.length.toFixed(3), p.type])).toEqual([
      ['1', 0, 3.81, 270, 1.27, 'passive'],
      ['2', 0, -3.81, 90, 1.27, 'passive'],
    ]);
    expect(r.graphics[0]).toMatchObject({ kind: 'rect', fill: 'none' });
    expect(r.props.Footprint).toBe('Resistor_SMD:R_0805');
    const nand = symbols[1];
    expect(nand.units).toBe(5);
    expect(nand.pins.map((p) => [p.number, p.type, p.style, p.unit])).toEqual([
      ['1', 'input', 'line', 1],
      ['2', 'input', 'line', 1],
      ['3', 'output', 'inverted', 1],
      ['14', 'power_in', 'line', 5],
      ['7', 'power_in', 'line', 5],
    ]);
  });

  it('imports like the new format: same resistor geometry as the .kicad_sym one', () => {
    const legacy = importKicadSymbols(LEGACY).parts.find((p) => p.name === 'R')!;
    const modern = importKicadSymbols(LIB).parts.find((p) => p.name === 'R')!;
    expect(legacy.symbol.pins).toEqual(modern.symbol.pins);
    expect(legacy.symbol.prims).toEqual(modern.symbol.prims);
    expect(legacy.footprint).toBe('R_0805');
  });

  it('refuses another file', () => {
    expect(() => parseLegacyLib('(kicad_symbol_lib)')).toThrow(KicadSymbolError);
  });

  it('writes the lib_symbols list the schematic importer reads', () => {
    const { symbols } = parseLegacyLib(LEGACY);
    const root = parseSexpr(kicadLibSymbolsSexpr(symbols));
    expect(head(root)).toBe('lib_symbols');
    const sym = children(root, 'symbol')[0];
    expect(atom(sym[1])).toBe('R');
    const pins = children(children(sym, 'symbol')[0], 'pin');
    expect(pins).toHaveLength(2);
    expect(atom(child(pins[0], 'number')?.[1])).toBe('1');
  });
});

describe('exporting a .kicad_sym library', () => {
  const imported = importKicadSymbols(LIB);

  it('writes a library KiCad can read: symbols, fields, graphics and pins', () => {
    const out = partsToKicadSym(imported.parts, { libraryName: 'my lib' });
    const root = parseSexpr(out.text);
    expect(head(root)).toBe('kicad_symbol_lib');
    const names = children(root, 'symbol').map((s) => atom(s[1]));
    expect(names).toEqual(['R', 'LM358_A', 'LM358_B', 'LM358_C', 'Q_NPN', 'D', 'D_Zener', 'SN74HC00_NAND']);
    const r = children(root, 'symbol')[0];
    const props = Object.fromEntries(children(r, 'property').map((p) => [atom(p[1]), atom(p[2])]));
    expect(props.Reference).toBe('R');
    expect(props.Footprint).toBe('R_0805_2012Metric');
    expect(props['Sim.Device']).toBe('R');
    expect(props['Sim.Params']).toBe('r=4.7k');
    // a 3.81 mm pin, pointing the way the body lies
    const pins = children(children(r, 'symbol')[1], 'pin');
    expect(pins.map((p) => [atom(p[1]), atom(child(p, 'at')?.[1]), atom(child(p, 'at')?.[2]), atom(child(p, 'at')?.[3]), atom(child(p, 'length')?.[1])])).toEqual([
      ['passive', '0', '3.81', '270', '1.27'],
      ['passive', '0', '-3.81', '90', '1.27'],
    ]);
    expect(out.modelFile).toBe('my_lib.lib');
  });

  it('round trip: export then import gives the same pins, types, numbers and shapes', () => {
    const again = importKicadSymbols(partsToKicadSym(imported.parts).text).parts;
    expect(again.map((p) => p.name)).toEqual(imported.parts.map((p) => p.name.replace(/\s+/g, '_')));
    imported.parts.forEach((p, i) => {
      const q = again[i];
      expect(q.symbol.pins.map((x) => [x.name, x.x, x.y, x.dir, x.type, x.number, x.label])).toEqual(p.symbol.pins.map((x) => [x.name, x.x, x.y, x.dir, x.type, x.number, x.label]));
      expect(q.symbol.prims.filter((x) => x.kind === 'rect')).toEqual(p.symbol.prims.filter((x) => x.kind === 'rect'));
      expect(q.symbol.prims.filter((x) => x.kind === 'line').length).toBe(p.symbol.prims.filter((x) => x.kind === 'line').length);
      expect(q.prefix).toBe(p.prefix);
    });
  });

  it('a part with a SPICE model writes the model text and points at it', () => {
    const q = imported.parts.find((p) => p.name === 'Q_NPN')!;
    const out = partsToKicadSym([q], { libraryName: 'models' });
    expect(out.models).toBe('.model Q_NPN NPN(bf=200 is=1e-14 vaf=100)');
    expect(out.text).toContain('(property "Sim.Library" "models.lib"');
    expect(out.text).toContain('"Sim.Name" "Q_NPN"');
    // and the model comes back when both texts are given
    const back = importKicadSymbols(out.text, { libraries: new Map([['models.lib', out.models]]) });
    expect(back.parts[0].model.kind).toBe('spice');
  });

  it('draws arcs and circles the way they were imported (an arc survives the round trip)', () => {
    const q = imported.parts.find((p) => p.name === 'Q_NPN')!;
    const arc = q.symbol.prims.find((p) => p.kind === 'arc')!;
    const back = importKicadSymbols(partsToKicadSym([q]).text).parts[0].symbol.prims.find((p) => p.kind === 'arc')!;
    if (arc.kind !== 'arc' || back.kind !== 'arc') throw new Error('arc expected');
    expect(back.cx).toBeCloseTo(arc.cx, 0);
    expect(back.cy).toBeCloseTo(arc.cy, 0);
    expect(back.r).toBeCloseTo(arc.r, 0);
    expect(back.start).toBeCloseTo(arc.start, 0);
    expect(back.end).toBeCloseTo(arc.end, 0);
  });
});
