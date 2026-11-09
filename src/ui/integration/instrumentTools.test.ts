/**
 * Instrument tools end to end, through the editor store:
 * - logic converter "expression → circuit": the gates placed next to the converter, the
 *   converter's pins labelled, and the converter's own per-row operating points (what
 *   "circuit → truth table" runs) reproduce the expression's truth table;
 * - default instrument settings apply to newly placed instruments only, and reset;
 * - instrument settings changed in a panel are saved with the design file;
 * - wizard placement renames clashing net labels; the face export SVG is well formed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { parseDesign, serializeDesign } from '../../model/serialize';
import { runAnalyses } from '../../sim';
import type { AnalysisResult } from '../../sim/results';
import { expressionToTable, minimizeSop, tableMinterms } from '../instruments/logic';
import { converterRowAssignments, tableFromRuns } from '../instruments/logicConverter';
import { installInstrumentDefaults, instrumentDefaults, instrumentDefaultsStore, resetInstrumentDefaults, saveInstrumentDefaults, INSTRUMENT_DEFAULTS_KEY } from '../instruments/defaults';
import { cssVariablesBlock, faceSvg, xmlEscape } from '../instruments/faceSnapshot';
import { setPlacementDefaults } from '../store/partDefaults';
import { actions, editor, getState } from '../store';
import { findPartByRefdes } from '../store/designOps';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { SimulationIntegration } from './controller';
import { placeLogicCircuitFor } from './logicPlacement';
import { renameClashingLabels } from '../wizards/wizardDialogs';

function converterDesign(extraLabel?: string) {
  const b = new DesignBuilder('converter');
  b.part('instruments/logic-converter', 'XLC1', 300, 300, { vhigh: '5', threshold: '2.5' });
  if (extraLabel) b.label(extraLabel, 100, 600);
  return b.design;
}

/** What the converter's "circuit → truth table" reads (one OP per row, as the controller runs them). */
function converterTable(n: number): string | null {
  const build = buildNetlist(getState().design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const binding = build.instruments.find((x) => x.refdes === 'XLC1')!;
  const rows = converterRowAssignments(binding, n, 5);
  const runs = rows.map(({ row, values }) => {
    const elements = build.netlist.elements.map((e) => (e.name in values ? { ...e, source: { ...e.source, dc: values[e.name] } } : e));
    const [r] = runAnalyses({ ...build.netlist, elements, analyses: [{ type: 'op' }] });
    return { label: String(row), result: r };
  });
  const result = { ...runs[0].result, runs } as AnalysisResult;
  return tableFromRuns(result, binding.channels.out!, 2.5, 1 << n);
}

describe('logic converter: expression to circuit on the schematic', () => {
  for (const [expr, nandOnly] of [
    ["A'B + AB'", false],
    ["AB + C'D", true],
    ["A'B'C + AB'C' + ABC + A'BC'", false],
  ] as const) {
    it(`${expr} (${nandOnly ? 'NAND' : 'AND-OR'}) is drawn, wired to the converter and reads back its truth table`, async () => {
      actions.loadDesign(converterDesign(), 'lc.msim');
      const { table, inputs } = expressionToTable(expr);
      const { ones, dontCares } = tableMinterms(table);
      const err = await placeLogicCircuitFor('XLC1', minimizeSop(inputs, ones, dontCares), inputs, nandOnly);
      expect(err).toBeNull();
      const sheet = getState().design.sheets[0];
      // gates were added and the converter's pins carry the net names
      expect(sheet.parts.filter((p) => p.partId.startsWith('misc-digital/')).length).toBeGreaterThan(0);
      expect(sheet.labels.map((l) => l.name)).toContain('OUT');
      expect(converterTable(inputs)).toBe(table);
    });
  }

  it('prefixes the net names when the sheet already uses them', async () => {
    actions.loadDesign(converterDesign('A'), 'lc.msim');
    const err = await placeLogicCircuitFor('XLC1', [{ mask: 0b11, value: 0b11 }], 2, false);
    expect(err).toBeNull();
    const names = getState().design.sheets[0].labels.map((l) => l.name);
    expect(names).toContain('XLC1_A');
    expect(names).toContain('XLC1_OUT');
    expect(converterTable(2)).toBe('0001');
  });

  it('reports a converter that no longer exists', async () => {
    actions.loadDesign(converterDesign(), 'lc.msim');
    expect(await placeLogicCircuitFor('XLC9', [], 1, false)).toMatch(/XLC9/);
  });
});

describe('default instrument settings', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) };

  beforeAll(() => {
    installInstrumentDefaults(storage);
    setPlacementDefaults((part) => (part.instrument ? instrumentDefaults(part.id) : undefined));
  });
  afterAll(() => {
    setPlacementDefaults(null);
    resetInstrumentDefaults();
  });

  it('newly placed instruments start with the saved settings; placed ones keep theirs', () => {
    actions.loadDesign(new DesignBuilder('d').design, 'd.msim');
    const def = getPart('instruments/bench-scope')!;
    const first = actions.placePart(def.id, { x: 100, y: 100 })!;
    saveInstrumentDefaults(def, { timebase: '50u', 'A.scale': '0.2', 'trig.mode': 'auto' });
    // only values that differ from the library defaults are stored
    expect(instrumentDefaults(def.id)).toEqual({ timebase: '50u', 'A.scale': '0.2' });
    expect(JSON.parse(memory.get(INSTRUMENT_DEFAULTS_KEY)!)).toEqual({ [def.id]: { timebase: '50u', 'A.scale': '0.2' } });
    const second = actions.placePart(def.id, { x: 400, y: 100 })!;
    const parts = getState().design.sheets[0].parts;
    expect(parts.find((p) => p.id === second)!.params.timebase).toBe('50u');
    expect(parts.find((p) => p.id === first)!.params.timebase).toBe('1m');
    // other parts are not affected
    const r = actions.placePart('basic/resistor', { x: 100, y: 400 })!;
    expect(getState().design.sheets[0].parts.find((p) => p.id === r)!.params.timebase).toBeUndefined();
    resetInstrumentDefaults(def.id);
    const third = actions.placePart(def.id, { x: 700, y: 100 })!;
    expect(getState().design.sheets[0].parts.find((p) => p.id === third)!.params.timebase).toBe('1m');
    expect(instrumentDefaultsStore.getState()[def.id]).toBeUndefined();
  });

  it('ignores a corrupt stored table', () => {
    memory.set(INSTRUMENT_DEFAULTS_KEY, '{not json');
    installInstrumentDefaults(storage);
    expect(instrumentDefaultsStore.getState()).toEqual({});
  });
});

describe('instrument settings travel with the design', () => {
  let ctrl: SimulationIntegration;
  beforeAll(() => {
    ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()), speed: 1 });
  });
  afterAll(() => ctrl.dispose());

  it('a panel change is stored on the part and survives save / open', () => {
    const b = new DesignBuilder('saved');
    b.part('instruments/bench-multimeter', 'XDM1', 100, 100, {});
    actions.loadDesign(b.design, 'saved.msim');
    const def = getPart('instruments/bench-multimeter')!;
    const params = Object.fromEntries(def.params.map((p) => [p.key, p.default]));
    ctrl.instrumentParams('XDM1', { ...params, function: 'acv', math: 'stats', digits: '5.5' });
    const reopened = parseDesign(serializeDesign(getState().design));
    const part = findPartByRefdes(reopened, 'XDM1')!.part;
    expect(part.params.function).toBe('acv');
    expect(part.params.math).toBe('stats');
    expect(part.params.digits).toBe('5.5');
  });
});

describe('wizard placement and face export helpers', () => {
  it('renames fragment labels that clash with the sheet', () => {
    const out = renameClashingLabels(
      [
        { id: 'a', x: 0, y: 0, name: 'OUT', rotation: 0 },
        { id: 'b', x: 10, y: 0, name: 'out', rotation: 0 },
        { id: 'c', x: 20, y: 0, name: 'IN', rotation: 0 },
      ],
      ['OUT', 'OUT_2'],
    );
    // net names are case-insensitive: both spellings are one net and get the same new name
    expect(out.map((l) => l.name)).toEqual(['OUT_3', 'OUT_3', 'IN']);
  });

  it('builds a well-formed face SVG', () => {
    expect(xmlEscape('a<b & "c"')).toBe('a&lt;b &amp; &quot;c&quot;');
    expect(cssVariablesBlock({ '--x': 'red;', 'bad': '1', '--y': '#fff' })).toBe('.msi-face-root { --x: red; --y: #fff; }');
    const svg = faceSvg('<div xmlns="http://www.w3.org/1999/xhtml">hi</div>', '.a > .b { color: red }', 100.4, 50);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="101" height="50"')).toBe(true);
    expect(svg).toContain('<![CDATA[.a > .b { color: red }]]>');
    expect(svg).toContain('<foreignObject');
  });
});
