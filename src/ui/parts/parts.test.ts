/**
 * Component tools (pure layers): the component wizard's output netlists and simulates for every
 * model source, part databases persist and reach the library registry and the open design, SPICE
 * import resolves includes and fits placed parts, and the symbol editor operations.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getPart, listParts } from '../../library';
import { customPartDef } from '../../library/custom/partDef';
import { parseModelLibrary } from '../../library/custom/spiceModels';
import { getMaker, runMaker, verifyMaker } from '../../library/modelmaker';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import type { AnalysisResult } from '../../sim/results';
import { createEditor } from '../store/editorStore';
import { DesignBuilder } from '../../model/designkit';
import {
  commitDatabase,
  findUserPart,
  getDatabase,
  installDesignLink,
  installPartDatabases,
  memoryDbStorage,
  resetPartDatabases,
  savePart,
} from './partDatabases';
import { appendCustomSpice, inlineIncludes, overrideFits, quickBench, readBench, resolveModelText } from './spiceImport';
import { addPin, deleteTarget, fitBBox, hitTest, moveTarget, nextPinName, parseSymbolFile, pinIssues, SymbolFileError, symbolToFile, translateSymbol } from './symbolEditModel';
import { buildPart, modelNameFor, modelTerminals, newWizard, setBuiltin, setMapping, setModelSource, setSpice, setTemplate, stepIssues, testDesign, wizardFromPart, wizardFromPlaced } from './wizardModel';
import { newDatabase, upsertPart } from '../../library/custom/database';
import { loadAllGroups } from '../../library';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}`);
  return v.re[v.re.length - 1];
};

afterEach(() => resetPartDatabases());

describe('component wizard output', () => {
  it('a maker-made diode: built part netlists, simulates and reproduces the datasheet point', () => {
    let s = newWizard({ maker: 'diode' });
    s = { ...s, name: 'Điốt chỉnh lưu 1A' };
    expect(s.template).toBe('diode');
    expect(s.prefix).toBe('D');
    expect(s.pinMap).toEqual(['A', 'K']);
    const { result } = runMaker(getMaker('diode'), s.makerInput, modelNameFor(s.name), (nl) => runAnalyses(nl));
    expect(stepIssues(s, 'model', undefined, result)).toEqual([]);
    const part = buildPart(s, result, new Set());
    expect(part.id).toBe('custom:diot-chinh-luu-1a');
    expect(part.model).toMatchObject({ kind: 'spice', name: 'DIOT_CHINH_LUU_1A', maker: { id: 'diode' } });
    expect(part.provenance).toMatch(/model maker \(diode\)/);
    expect(stepIssues(s, 'save', part)).toEqual([]);
    // in a circuit: 10 mA forward
    const b = new DesignBuilder('w');
    b.design.customParts = [part];
    const i = b.part('sources/dc-current', 'I1', -200, 0, { value: '10m' });
    b.labelPin(i, '+', 'A');
    b.labelPin(i, '-', '0');
    const d = b.part(part.id, 'D1', 0, 0);
    b.labelPin(d, 'A', 'A');
    b.labelPin(d, 'K', '0');
    const nb = buildNetlist(b.design, { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    expect(vec(op, 'V(A)')).toBeCloseTo(0.72, 2);
  });

  it('a pasted subcircuit on a box symbol with a parameter', () => {
    let s = newWizard();
    s = setTemplate(s, 'box', { left: 2, right: 1 });
    expect(s.symbol.pins.map((p) => p.name)).toEqual(['1', '2', '3']);
    s = setModelSource(s, 'spice');
    s = setSpice(s, '.subckt ATT IN OUT GND PARAMS: K=0.5\nE1 OUT GND IN GND {K}\n.ends', 'ATT');
    expect(modelTerminals(s)).toEqual(['IN', 'OUT', 'GND']);
    expect(s.params.map((p) => [p.key, p.default])).toEqual([['K', '0.5']]);
    s = setMapping(s, 0, '1');
    s = setMapping(s, 1, '3');
    s = setMapping(s, 2, '2');
    s = { ...s, name: 'Attenuator' };
    const part = buildPart(s, undefined, new Set());
    expect(part.model).toMatchObject({ kind: 'spice', pins: ['1', '3', '2'] });
    const b = new DesignBuilder('att');
    b.design.customParts = [part];
    const v = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '8' });
    b.labelPin(v, '+', 'IN');
    b.labelPin(v, '-', '0');
    const u = b.part(part.id, 'U1', 0, 0, { K: '0.25' });
    b.labelPin(u, '1', 'IN');
    b.labelPin(u, '2', '0');
    b.labelPin(u, '3', 'OUT');
    const r = b.part('basic/resistor', 'RL', 200, 0, { value: '1k' });
    b.labelPin(r, '1', 'OUT');
    b.labelPin(r, '2', '0');
    const [op] = runAnalyses({ ...buildNetlist(b.design, { includeAnalysis: false }).netlist, analyses: [{ type: 'op' }] });
    expect(vec(op, 'V(OUT)')).toBeCloseTo(2, 9);
  });

  it('a library part with a redrawn symbol (builtin model) and the test bench solves', () => {
    let s = newWizard();
    s = setTemplate(s, 'box', { left: 1, right: 1 });
    s = setModelSource(s, 'builtin');
    s = setBuiltin(s, 'basic/resistor');
    expect(s.builtinMap).toEqual({ '1': '1', '2': '2' });
    s = { ...s, name: 'Box resistor', builtinParams: { value: '2k' } };
    const part = buildPart(s, undefined, new Set());
    const nb = buildNetlist(testDesign(part), { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const [op] = runAnalyses({ ...nb.netlist, analyses: [{ type: 'op' }] });
    expect(op.error).toBeUndefined();
    // pins at 2 V and 1 V through 1 kΩ each: 1 V across 4 kΩ, 0.5 V across the 2 kΩ part
    expect(Math.abs(vec(op, 'V(P0)') - vec(op, 'V(P1)'))).toBeCloseTo(0.5, 6);
  });

  it('an LED template glows with the model current; the motor maker uses the library motor', () => {
    let s = newWizard({ maker: 'led' });
    s = { ...s, name: 'My LED', ledColor: 'green' };
    const { result } = runMaker(getMaker('led'), s.makerInput, modelNameFor(s.name));
    const part = buildPart(s, result, new Set());
    expect(part.indicator).toEqual({ kind: 'led', color: 'green' });
    expect(customPartDef(part).indicator?.kind).toBe('led');
    let m = newWizard({ maker: 'acmotor' });
    m = { ...m, name: 'Motor 0.75 kW' };
    const fit = runMaker(getMaker('acmotor'), m.makerInput, modelNameFor(m.name));
    const motor = buildPart(m, fit.result, new Set());
    expect(motor.model).toMatchObject({ kind: 'builtin', partId: 'electromechanical/induction-motor-3ph', pinMap: { U: 'U', V: 'V', W: 'W' } });
    const outcomes = verifyMaker(getMaker('acmotor').checks(fit.values, fit.result), (nl) => runAnalyses(nl));
    expect(outcomes.every((o) => o.pass)).toBe(true);
  });

  it('step checks: name, pins, mapping', () => {
    const s = newWizard();
    expect(stepIssues(s, 'info').map((i) => i.code)).toEqual(['noName']);
    const dup = { ...s, symbol: { ...s.symbol, pins: s.symbol.pins.map((p) => ({ ...p, name: 'X' })) } };
    expect(stepIssues(dup, 'pins').map((i) => i.code)).toContain('duplicatePin');
    let sp = setSpice(setModelSource(s, 'spice'), '.subckt T A B C\nR1 A B 1\nR2 B C 1\n.ends', 'T');
    sp = setTemplate(sp, 'box', { left: 2, right: 1 });
    sp = setMapping(sp, 1, sp.pinMap[0]);
    expect(stepIssues(sp, 'mapping').map((i) => i.code)).toEqual(['pinUsedTwice']);
  });

  it('editing: an existing component keeps its id; a placed library part becomes a new component', () => {
    const lib = getPart('basic/resistor')!;
    const placed = wizardFromPlaced(lib, { value: '330' }, 'inst7');
    expect(placed.replaceInstance).toBe('inst7');
    expect(placed.source).toBe('builtin');
    expect(placed.builtinParams).toEqual({ value: '330' });
    const part = buildPart({ ...placed, name: 'R330' }, undefined, new Set());
    expect(part.id).toBe('custom:r330');
    const again = wizardFromPart(part, 'user');
    expect(again.editingId).toBe('custom:r330');
    expect(buildPart(again, undefined, new Set([part.id])).id).toBe('custom:r330');
  });
});

describe('part databases at run time', () => {
  it('loads from storage, registers the parts, persists changes', async () => {
    const stored = upsertPart(newDatabase('user'), { id: 'custom:x1', name: 'X1', group: 'misc', family: 'User', description: '', prefix: 'U', symbol: getPart('basic/resistor')!.symbol, model: { kind: 'builtin', partId: 'basic/resistor', pinMap: { '1': '1', '2': '2' } } });
    const storage = memoryDbStorage({ user: JSON.stringify(stored) });
    const before = listParts().length;
    await installPartDatabases(storage);
    expect(getDatabase('user').parts).toHaveLength(1);
    expect(getPart('custom:x1')?.name).toBe('X1');
    expect(listParts()).toHaveLength(before + 1);
    expect(findUserPart('custom:x1')?.kind).toBe('user');
    await savePart('corporate', { ...stored.parts[0], id: 'custom:y1', name: 'Y1' });
    expect(JSON.parse(storage.data.corporate!).parts[0].id).toBe('custom:y1');
    expect(getPart('custom:y1')?.name).toBe('Y1');
  });

  it('a broken stored database is reported and not overwritten on load', async () => {
    const storage = memoryDbStorage({ user: '{not json' });
    await installPartDatabases(storage);
    const { partDbStore } = await import('./partDatabases');
    expect(partDbStore.getState().error?.user).toMatch(/JSON/);
    expect(storage.data.user).toBe('{not json');
  });

  it('placing a database part embeds it; editing it in the database refreshes the design', async () => {
    await installPartDatabases(memoryDbStorage());
    const data = { id: 'custom:r1k', name: 'R 1k', group: 'basic' as const, family: 'User', description: 'v1', prefix: 'R', symbol: getPart('basic/resistor')!.symbol, model: { kind: 'builtin' as const, partId: 'basic/resistor', pinMap: { '1': '1', '2': '2' } } };
    await savePart('user', data);
    const ed = createEditor();
    const off = installDesignLink(ed.subscribe, { getDesign: () => ed.getState().design, applyDesign: (fn) => ed.actions.applyDesign(fn) });
    ed.actions.placePart('custom:r1k', { x: 100, y: 100 });
    expect(ed.getState().design.customParts?.map((p) => p.id)).toEqual(['custom:r1k']);
    const r = await commitDatabase('user', upsertPart(getDatabase('user'), { ...data, description: 'v2' }));
    expect(r.updatedInDesign).toEqual(['custom:r1k']);
    expect(ed.getState().design.customParts?.[0].description).toBe('v2');
    // deleting the instance drops the embedded copy (in-use list)
    ed.actions.selectAll();
    ed.actions.deleteSelection();
    expect(ed.getState().design.customParts).toBeUndefined();
    off();
  });
});

describe('SPICE import', () => {
  it('resolves nested includes through the fetcher and inlines them', async () => {
    const files: Record<string, string> = {
      'lib/amp.lib': '.subckt AMP IN OUT\nE1 OUT 0 IN 0 10\n.ends\n.include "helper.inc"\n',
      'lib/helper.inc': '.model DH D(IS=1e-15)\n',
    };
    const asked: string[] = [];
    const res = await resolveModelText('.include "lib/amp.lib"\n.include missing.lib\n', async (p) => {
      asked.push(p);
      return files[p] ?? null;
    });
    expect(res.lib.subckts.map((s) => s.name)).toEqual(['AMP']);
    expect(res.lib.models.map((m) => m.name)).toEqual(['DH']);
    expect(res.unresolved).toEqual(['missing.lib']);
    expect(asked).toContain('lib/helper.inc');
    const flat = inlineIncludes('.include "lib/amp.lib"\n', res.files);
    const again = parseModelLibrary(flat);
    expect(again.missing).toEqual([]);
    expect(again.subckts.map((s) => s.name)).toEqual(['AMP']);
    expect(again.models.map((m) => m.name)).toEqual(['DH']);
  });

  it('inlines only the requested .lib section', () => {
    const files = new Map([['m.lib', '.lib tt\n.model DT D(N=1)\n.endl\n.lib ff\n.model DF D(N=2)\n.endl\n']]);
    const lib = parseModelLibrary(inlineIncludes('.lib m.lib ff\n', files));
    expect(lib.models.map((m) => m.name)).toEqual(['DF']);
  });

  it('adds model text to Custom SPICE once', () => {
    const d = new DesignBuilder('x').design;
    const a = appendCustomSpice(d, '.model D1X D(IS=1n)', 'imported');
    expect(a.added).toEqual(['D1X']);
    expect(a.design.customSpice).toContain('.model D1X');
    const b = appendCustomSpice(a.design, '.model D1X D(IS=2n)\n.model D2X D');
    expect(b.added).toEqual(['D2X']);
    expect(b.skipped).toEqual(['D1X']);
    expect(appendCustomSpice(b.design, '.model D2X D').design).toBe(b.design);
  });

  it('decides whether a model fits a placed part, and test-simulates models', () => {
    const lib = parseModelLibrary('.model DU D(IS=1e-12 N=1.9)\n.model QN NPN(BF=150)\n.model QP PNP(BF=80)\n.subckt FIVE a b c d e\nR1 a b 1k\n.ends');
    expect(overrideFits(getPart('diodes/1n4148')!, lib, 'DU')).toBe(true);
    expect(overrideFits(getPart('diodes/1n4148')!, lib, 'QN')).toBe(false);
    expect(overrideFits(getPart('analog/opamp')!, lib, 'FIVE')).toBe(true);
    const qd = quickBench(lib, 'DU')!;
    const rd = readBench(qd, runAnalyses(qd.netlist));
    expect(rd.ok && rd.readings[0].value).toBeCloseTo(1.9 * 8.617333262e-5 * 300.15 * Math.log(1e-3 / 1e-12 + 1), 3);
    const qp = quickBench(lib, 'QP')!;
    const rp = readBench(qp, runAnalyses(qp.netlist));
    expect(rp.ok).toBe(true);
    if (rp.ok) expect(rp.readings.find((x) => x.key === 'vbe')!.value).toBeLessThan(-0.4);
    const qs = quickBench(lib, 'FIVE')!;
    expect(readBench(qs, runAnalyses(qs.netlist)).ok).toBe(true);
  });
});

describe('symbol editor operations', () => {
  const empty = { bbox: { x: 0, y: 0, w: 0, h: 0 }, prims: [], pins: [] };

  it('adds pins with stubs and unique names, hit-tests, moves, deletes', () => {
    let s = fitBBox({ ...empty, prims: [{ kind: 'rect' as const, x: -20, y: -20, w: 40, h: 40 }] });
    const a = addPin(s, -30, 0, 'left');
    s = a.symbol;
    expect(s.pins[0]).toMatchObject({ name: '1', x: -30, y: 0, dir: 'left', number: '1' });
    expect(s.prims[1]).toEqual({ kind: 'line', x1: -30, y1: 0, x2: -20, y2: 0 });
    expect(nextPinName(s)).toBe('2');
    s = addPin(s, 30, 0, 'right').symbol;
    expect(hitTest(s, 29, 1)).toEqual({ kind: 'pin', index: 1 });
    expect(hitTest(s, 0, -20)).toEqual({ kind: 'prim', index: 0 });
    expect(hitTest(s, 0, 0)).toBeNull();
    s = moveTarget(s, { kind: 'pin', index: 1 }, 10, 10);
    expect(s.pins[1]).toMatchObject({ x: 40, y: 10 });
    expect(pinIssues(s)).toEqual([]);
    s = moveTarget(s, { kind: 'pin', index: 1 }, 5, 0);
    expect(pinIssues(s)).toEqual([{ index: 1, code: 'offGrid' }]);
    s = deleteTarget(s, { kind: 'prim', index: 0 });
    expect(s.prims).toHaveLength(2);
    const f = fitBBox(s);
    expect(f.bbox).toEqual({ x: -30, y: 0, w: 75, h: 10 });
    const t = translateSymbol(f, 10, 0);
    expect(t.pins[0].x).toBe(-20);
  });

  it('exports and imports symbol files, rejecting bad ones', () => {
    const sym = fitBBox(addPin(addPin(empty, -10, 0, 'left').symbol, 10, 0, 'right').symbol);
    const text = symbolToFile(sym, 'Two pins');
    const back = parseSymbolFile(text);
    expect(back.name).toBe('Two pins');
    expect(back.symbol.pins.map((p) => p.name)).toEqual(['1', '2']);
    expect(() => parseSymbolFile('nope')).toThrow(SymbolFileError);
    expect(() => parseSymbolFile(JSON.stringify({ format: 'machsim-symbol', version: 1, symbol: { ...sym, pins: [] } }))).toThrow(/at least one pin/);
    expect(() => parseSymbolFile(JSON.stringify({ format: 'machsim-symbol', version: 1, symbol: { ...sym, prims: [{ kind: 'line', x1: 'a' }] } }))).toThrow(/prims\[0\]/);
  });
});
