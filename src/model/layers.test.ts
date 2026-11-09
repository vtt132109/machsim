/**
 * Layer settings (Edit > Layer settings): the model, the file format, and what the SVG export draws
 * when a layer is hidden or switched on.
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from '../ui/store/editorStore';
import { testLookup } from '../ui/store/testParts';
import { sheetToSvg } from '../ui/editor/exportImage';
import { LAYER_DEFAULTS, LAYER_IDS, layerSummary, layerTable, layerVisible, normalizeLayers, setLayersOnSheets, setSheetLayers } from './layers';
import { parseDesign, serializeDesign } from './serialize';
import { newDesign, newSheet } from './types';
import type { PartDef } from '../library/types';
import { setLang } from '../i18n';

setLang('en');

describe('layer model', () => {
  it('has eight layers; net names and pin numbers are off until asked for', () => {
    expect(LAYER_IDS).toEqual(['grid', 'refdes', 'values', 'labels', 'netNames', 'pinNumbers', 'comments', 'graphics']);
    expect(LAYER_DEFAULTS.netNames).toBe(false);
    expect(LAYER_DEFAULTS.pinNumbers).toBe(false);
    expect(LAYER_IDS.filter((id) => LAYER_DEFAULTS[id])).toHaveLength(6);
    const s = newSheet('s', 'S');
    expect(layerTable(s)).toEqual(LAYER_DEFAULTS);
    expect(layerSummary(s)).toEqual([]);
  });

  it('only what differs from the default is stored', () => {
    const s = newSheet('s', 'S');
    const hidden = setSheetLayers(s, { values: false, refdes: true });
    expect(hidden.layers).toEqual({ values: false });
    expect(layerVisible(hidden, 'values')).toBe(false);
    expect(layerVisible(hidden, 'refdes')).toBe(true);
    // back to the default removes the field again
    const again = setSheetLayers(hidden, { values: true });
    expect('layers' in again).toBe(false);
    expect(again).toEqual(s);
  });

  it('setting a layer to the value it has returns the same sheet', () => {
    const s = newSheet('s', 'S');
    expect(setSheetLayers(s, { values: true })).toBe(s);
    const h = setSheetLayers(s, { netNames: true });
    expect(setSheetLayers(h, { netNames: true })).toBe(h);
  });

  it('normalizeLayers drops defaults and unknown entries', () => {
    expect(normalizeLayers({ grid: true, netNames: true, graphics: false })).toEqual({ netNames: true, graphics: false });
    expect(normalizeLayers({ grid: true })).toBeUndefined();
    expect(normalizeLayers(undefined)).toBeUndefined();
  });

  it('can change several sheets, or only the named ones', () => {
    const sheets = [newSheet('a', 'A'), newSheet('b', 'B')];
    const all = setLayersOnSheets(sheets, { comments: false });
    expect(all.map((s) => layerVisible(s, 'comments'))).toEqual([false, false]);
    const one = setLayersOnSheets(sheets, { comments: false }, new Set(['b']));
    expect(one.map((s) => layerVisible(s, 'comments'))).toEqual([true, false]);
    expect(setLayersOnSheets(sheets, { comments: true })).toBe(sheets);
  });
});

describe('layers in the design file', () => {
  it('round-trips byte for byte and a design without layers writes no field', () => {
    const d = newDesign('L');
    expect(serializeDesign(d)).not.toContain('layers');
    d.sheets = [setSheetLayers(d.sheets[0], { values: false, pinNumbers: true })];
    const text = serializeDesign(d);
    expect(text).toContain('"layers"');
    const back = parseDesign(text);
    expect(back.sheets[0].layers).toEqual({ values: false, pinNumbers: true });
    expect(serializeDesign(back)).toBe(text);
  });

  it('a ladder sheet keeps its layers in file order too', () => {
    const d = newDesign('L');
    const ladder = { ...newSheet('lad', 'Ladder'), kind: 'ladder' as const, ladder: [{ id: 'r1', logic: { kind: 'contact' as const, type: 'no' as const, address: 'I0.0' }, outputs: [{ kind: 'coil' as const, address: 'Q0.0' }] }] };
    d.sheets = [d.sheets[0], setSheetLayers(ladder, { grid: false })];
    const text = serializeDesign(d);
    expect(serializeDesign(parseDesign(text))).toBe(text);
  });

  it('rejects an unknown layer or a non-boolean value', () => {
    const d = newDesign('L');
    const raw = JSON.parse(serializeDesign(d));
    raw.sheets[0].layers = { shadows: true };
    expect(() => parseDesign(JSON.stringify(raw))).toThrow(/shadows/);
    raw.sheets[0].layers = { values: 'no' };
    expect(() => parseDesign(JSON.stringify(raw))).toThrow(/values/);
  });
});

/** a part with numbered pins, for the pin-number layer */
const CHIP: PartDef = {
  id: 'test/chip',
  name: 'Chip',
  group: 'basic',
  family: 'Chip',
  description: 'test chip',
  prefix: 'U',
  symbol: {
    bbox: { x: -30, y: -20, w: 60, h: 40 },
    prims: [{ kind: 'rect', x: -30, y: -20, w: 60, h: 40 }],
    pins: [
      { name: 'A', x: -30, y: 0, dir: 'left', number: '7' },
      { name: 'B', x: 30, y: 0, dir: 'right', number: '14' },
    ],
    refPos: { x: 0, y: -26 },
    valuePos: { x: 0, y: 30 },
  },
  params: [{ key: 'value', label: 'Type', unit: '', default: '7400', kind: 'text', showOnSchematic: true, group: 'value' }],
};
const lookup = (id: string) => (id === 'test/chip' ? CHIP : testLookup(id));

function demo() {
  const ed = createEditor({ lookup });
  ed.actions.placePart('test/resistor', { x: 100, y: 100 });
  ed.actions.placePart('test/chip', { x: 300, y: 100 });
  ed.actions.addWire([
    { x: 130, y: 100 },
    { x: 270, y: 100 },
  ]);
  ed.actions.addNetLabel({ x: 200, y: 100 }, 'OUT');
  ed.actions.addNote({ x: 100, y: 300 }, 'plain text');
  ed.actions.addComment({ x: 100, y: 340 }, 'a sticky comment');
  ed.actions.addShape({ kind: 'rect', points: [{ x: 50, y: 400 }, { x: 150, y: 450 }] });
  return ed;
}

const svgOf = (ed: ReturnType<typeof demo>) => {
  const { design } = ed.getState();
  return sheetToSvg(design, design.sheets[0].id, lookup).svg;
};

describe('layers in the SVG export', () => {
  it('draws everything by default; net names and pin numbers only when asked for', () => {
    const svg = svgOf(demo());
    expect(svg).toContain('>R1<');
    expect(svg).toContain('>1kΩ<');
    expect(svg).toContain('>OUT<');
    expect(svg).toContain('class="ms-layer-labels"');
    expect(svg).toContain('plain text');
    expect(svg).toContain('class="ms-layer-shapes"');
    expect(svg).not.toContain('class="ms-layer-netnames"');
    expect(svg).not.toContain('class="ms-pin-numbers"');
  });

  it('hiding reference designators removes R1 / U1 but keeps the values', () => {
    const ed = demo();
    ed.actions.setSheetLayers({ refdes: false });
    const svg = svgOf(ed);
    expect(svg).not.toContain('>R1<');
    expect(svg).not.toContain('>U1<');
    expect(svg).toContain('>1kΩ<');
  });

  it('hiding values removes the value text but keeps the designators (a worksheet)', () => {
    const ed = demo();
    ed.actions.setSheetLayers({ values: false });
    const svg = svgOf(ed);
    expect(svg).toContain('>R1<');
    expect(svg).not.toContain('>1kΩ<');
    expect(svg).not.toContain('>7400<');
  });

  it('hiding net labels removes the label layer; the wiring is untouched', () => {
    const ed = demo();
    ed.actions.setSheetLayers({ labels: false });
    const svg = svgOf(ed);
    expect(svg).not.toContain('>OUT<');
    expect(svg).not.toContain('class="ms-layer-labels"');
    expect(svg).toContain('class="ms-wire"');
    // the design is unchanged: the label is still there and the net still has its name
    expect(ed.getState().design.sheets[0].labels).toHaveLength(1);
  });

  it('hiding graphics removes the shapes; hiding comments removes only sticky comments', () => {
    const ed = demo();
    ed.actions.setSheetLayers({ graphics: false });
    expect(svgOf(ed)).not.toContain('class="ms-layer-shapes"');
    expect(svgOf(ed)).toContain('plain text');
    ed.actions.setSheetLayers({ graphics: true, comments: false });
    const svg = svgOf(ed);
    expect(svg).toContain('class="ms-layer-shapes"');
    expect(svg).toContain('plain text');
    expect(svg).not.toContain('a sticky comment');
  });

  it('the pin-number layer draws the physical pin numbers of the chip', () => {
    const ed = demo();
    ed.actions.setSheetLayers({ pinNumbers: true });
    const svg = svgOf(ed);
    expect(svg).toContain('class="ms-pin-numbers"');
    expect(svg).toContain('>7<');
    expect(svg).toContain('>14<');
  });

  it('the net-names layer writes the name of each net along its wires', () => {
    const ed = demo();
    ed.actions.setSheetLayers({ netNames: true });
    const svg = svgOf(ed);
    expect(svg).toContain('class="ms-layer-netnames"');
    expect(svg).toMatch(/class="ms-net-name"[^>]*>OUT</);
  });

  it('layer changes are one undo step and leave the netlist alone', () => {
    const ed = demo();
    const before = ed.getState().design;
    expect(ed.actions.setSheetLayers({ values: false, refdes: false })).toBe(true);
    expect(ed.getState().history.past.at(-1)).toBe(before);
    expect(ed.actions.setSheetLayers({ values: false })).toBe(false);
    ed.actions.undo();
    expect(ed.getState().design).toBe(before);
  });

  it('can be applied to several sheets at once', () => {
    const ed = demo();
    const second = ed.actions.addSheet();
    ed.actions.setSheetLayers({ values: false }, ed.getState().design.sheets.map((s) => s.id));
    expect(ed.getState().design.sheets.every((s) => s.layers?.values === false)).toBe(true);
    expect(second).toBeTruthy();
  });
});
