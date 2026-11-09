/**
 * Round 4 fixes: tests for the corrections that the review repro tests do not cover by themselves.
 *
 *  - the sections of one chip are fitted / left off as a unit; a hand-excluded section is reported
 *    and still supplies the shared pins
 *  - relay contacts that name a coil are part of that relay in the BOM and the PCB netlist (a clip-on
 *    contact block stays a separate item)
 *  - designator-prefix rule texts: the file reader and the dialog agree
 *  - X-Y traces and postprocessor expressions survive a Grapher snapshot
 *  - printing does not make a saved design "unsaved"; a recovery record remembers the file path
 *  - a reading problem of a lesson step has a stable code
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES_DIR } from '../../helpers';
import { loadAllGroups } from '../../../src/library';
import { parseDesign } from '../../../src/model/serialize';
import { isFitted, setFitted } from '../../../src/model/variants';
import { buildNetlist } from '../../../src/model/netlister';
import { buildBom } from '../../../src/model/bom';
import { pcbComponents } from '../../../src/model/pcb';
import { DesignBuilder } from '../../../src/model/designkit';
import { refdesRuleTextProblem } from '../../../src/model/serialize';
import { validateRules } from '../../../src/model/refdesRules';
import { partLookup } from '../../../src/ui/store';
import { createEditor, isDirty } from '../../../src/ui/store/editorStore';
import { readingProblem } from '../../../src/learn/lessonFile';
import { parseAutosave, recordDocuments } from '../../../src/ui/app/files';
import { runFromSaved, runToSaved } from '../../../src/ui/results/savedGrapher';
import type { RunRecord } from '../../../src/ui/results/runs';
import type { Design } from '../../../src/model/types';

beforeAll(async () => {
  await loadAllGroups();
});

describe('sections of one chip', () => {
  const sample = (): Design => parseDesign(readFileSync(EXAMPLES_DIR + '73-dual-opamp-variants.msim', 'utf8'));

  it('setFitted with a library lookup takes the other sections of the chip along', () => {
    const d = sample();
    const variant = d.variants!.list[0].id;
    const u1a = d.sheets[0].parts.find((p) => p.partId === 'analog/lm358-dual-a')!;
    const u1b = d.sheets[0].parts.find((p) => p.partId === 'analog/lm358-dual-b')!;
    const next = setFitted(d, [u1a.id], variant, false, partLookup);
    const parts = next.sheets[0].parts;
    expect(isFitted(parts.find((p) => p.id === u1a.id)!, variant)).toBe(false);
    expect(isFitted(parts.find((p) => p.id === u1b.id)!, variant)).toBe(false);
    // and back
    const back = setFitted(next, [u1b.id], variant, true, partLookup);
    expect(back.sheets[0].parts.every((p) => isFitted(p, variant))).toBe(true);
  });

  it('a section left out by hand is reported, and the other section keeps its supply', () => {
    const d = sample();
    const u1a = d.sheets[0].parts.find((p) => p.partId === 'analog/lm358-dual-a')!;
    const excluded: Design = { ...d, sheets: d.sheets.map((s) => ({ ...s, parts: s.parts.map((p) => (p.id === u1a.id ? { ...p, excludeFromSim: true } : p)) })) };
    const b = buildNetlist(excluded, { includeAnalysis: false });
    const msg = b.erc.find((m) => m.detail?.id === 'sectionPartlyLeftOut');
    expect(msg?.severity).toBe('warning');
    // the supply pins wired on the excluded section are still on the chip
    const chip = b.netlist.elements.find((e) => e.type === 'X' && /U1/i.test(e.name));
    expect(chip).toBeDefined();
    expect(chip!.nodes.filter((n) => n.startsWith('NC_') || n === '0').length).toBeLessThan(chip!.nodes.length);
  });
});

describe('a relay is one item in the BOM and the PCB netlist', () => {
  it('contacts are folded into their coil; a clip-on contact block and a contact with no coil stay items', () => {
    const b = new DesignBuilder('Relay');
    b.part('electromechanical/coil-dc-12v', 'K1', 0, 0);
    b.part('electromechanical/relay-contact-no', 'KC1', 0, 200, { coil: 'K1' });
    b.part('electromechanical/supplementary-block-2no2nc', 'KC2', 200, 200, { coil: 'K1' });
    b.part('electromechanical/relay-contact-nc', 'KC3', 400, 200, { coil: 'K9' });
    const d = b.design;
    const refs = buildBom(d).flatMap((r) => r.refdes).sort();
    expect(refs).toEqual(['K1', 'KC2', 'KC3']);
    expect(pcbComponents(d).map((c) => c.ref).sort()).toEqual(['K1', 'KC2', 'KC3']);
  });
});

describe('designator-prefix rule texts', () => {
  it('the file reader refuses exactly what the dialog refuses', () => {
    const cases: [string, string][] = [['R X', ''], ['R1', ''], ['', ''], ['A_', ''], ['U1_', ''], ['a-b', ''], ['ABCDEFGHIJKLM', ''], ['X', 'A1']];
    for (const [text, global] of cases) {
      const dialog = validateRules(global ? { global, map: { R: text } } : { map: { R: text } }, ['R']).some((p) => p.code === 'badText' || p.code === 'tooLong' || p.code === 'endsInDigit');
      const reader = refdesRuleTextProblem(text, global) !== null;
      expect(reader, `text ${JSON.stringify(text)} global ${JSON.stringify(global)}`).toBe(dialog);
    }
  });
});

describe('Grapher pages', () => {
  it('an X-Y trace keeps its own x values, name and unit through a snapshot', () => {
    const run: RunRecord = {
      id: 1,
      source: 'analysis',
      name: 'BH',
      time: 1,
      results: [
        {
          type: 'tran',
          title: 'Transient',
          scale: { name: 'time', unit: 's', re: Float64Array.of(0, 1, 2) },
          vectors: [{ name: 'vs(B,H)', unit: 'T', re: Float64Array.of(0, 0.5, 1), xValues: Float64Array.of(0, 100, 200), xName: 'H', xUnit: 'A/m' }],
          warnings: [],
        },
      ],
    };
    const back = runFromSaved(JSON.parse(JSON.stringify(runToSaved(run))));
    const v = back.results[0].vectors[0];
    expect(Array.from(v.xValues ?? [])).toEqual([0, 100, 200]);
    expect(v.xName).toBe('H');
    expect(v.xUnit).toBe('A/m');
  });
});

describe('printing and recovery', () => {
  it('a quiet page-setup change leaves a saved design saved, an ordinary one does not', () => {
    const editor = createEditor({ design: new DesignBuilder('P').design });
    expect(isDirty(editor.getState())).toBe(false);
    editor.actions.setPrintSetup({ footer: true }, { quiet: true });
    expect(editor.getState().design.printSetup).toEqual({ footer: true });
    expect(isDirty(editor.getState())).toBe(false);
    editor.actions.setPrintSetup({ footer: false });
    expect(isDirty(editor.getState())).toBe(true);
    // a design that already has unsaved changes stays unsaved
    editor.actions.setPrintSetup({ footer: true }, { quiet: true });
    expect(isDirty(editor.getState())).toBe(true);
  });

  it('a recovery record keeps the desktop path of each document', () => {
    const text = JSON.stringify({ fileName: 'a.msim', savedAt: 5, text: '{}', path: 'C:\\x\\a.msim', others: [{ fileName: 'b.msim', savedAt: 5, text: '{}', path: 'C:\\x\\b.msim' }, { fileName: 'c.msim', savedAt: 5, text: '{}' }] });
    const rec = parseAutosave(text)!;
    expect(recordDocuments(rec).map((d) => d.path)).toEqual(['C:\\x\\a.msim', 'C:\\x\\b.msim', undefined]);
  });
});

describe('lesson reading problems', () => {
  it('the engine wording is mapped to a stable code', () => {
    expect(readingProblem('no samples')).toBe('noSamples');
    expect(readingProblem('no such signal')).toBe('noSignal');
    expect(readingProblem('the signal does not repeat in the window')).toBe('noRepeat');
    expect(readingProblem('anything else')).toBe('noValue');
  });
});

describe('comparator packages with sections (LM393, LM339)', () => {
  it('two LM393 sections U1A / U1B share one chip and its supply, wired on one section only', async () => {
    const { runAnalyses } = await import('../../../src/sim');
    const b = new DesignBuilder('LM393');
    const a = b.part('analog/lm393-dual-a', 'U1', 0, 0);
    const c = b.part('analog/lm393-dual-b', 'U1', 0, 200);
    const vcc = b.part('sources/dc-voltage', 'V1', -300, 0, { value: '5' });
    const hi = b.part('sources/dc-voltage', 'V2', -300, 100, { value: '3' });
    const mid = b.part('sources/dc-voltage', 'V3', -300, 200, { value: '2' });
    const lo = b.part('sources/dc-voltage', 'V4', -300, 300, { value: '1' });
    const r1 = b.part('basic/resistor', 'R1', 300, 0, { value: '10k' });
    const r2 = b.part('basic/resistor', 'R2', 300, 200, { value: '10k' });
    for (const [part, net] of [[vcc, 'VCC'], [hi, 'HI'], [mid, 'MID'], [lo, 'LO']] as const) {
      b.labelPin(part, '+', net);
      b.labelPin(part, '-', '0');
    }
    b.labelPin(a, 'V+', 'VCC');
    b.labelPin(a, 'V-', '0');
    b.labelPin(a, '1IN+', 'HI');
    b.labelPin(a, '1IN-', 'MID');
    b.labelPin(a, '1OUT', 'O1');
    b.labelPin(c, '2IN+', 'LO');
    b.labelPin(c, '2IN-', 'MID');
    b.labelPin(c, '2OUT', 'O2');
    for (const [r, net] of [[r1, 'O1'], [r2, 'O2']] as const) {
      b.labelPin(r, '1', 'VCC');
      b.labelPin(r, '2', net);
    }
    const build = buildNetlist(b.design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const [res] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    const v = (name: string) => res.vectors.find((x) => x.name.toLowerCase() === `v(${name})`)!.re[0];
    // IN+ (3 V) above IN- (2 V): the open-collector output is released and the pull-up takes it to 5 V
    expect(v('o1')).toBeGreaterThan(4.9);
    // IN+ (1 V) below IN- (2 V): the output is pulled to ground
    expect(v('o2')).toBeLessThan(0.3);
    // one chip in the BOM
    expect(buildBom(b.design).filter((r) => r.name.includes('LM393')).flatMap((r) => r.refdes)).toEqual(['U1']);
  });

  it('the quad LM339 uses its own pin-out (outputs 1 and 2 on pins 2 and 1)', async () => {
    const { getPart } = await import('../../../src/library');
    const pins = getPart('analog/lm339-quad')!.symbol.pins;
    const number = (name: string) => pins.find((p) => p.name === name)?.number;
    expect([number('1OUT'), number('2OUT'), number('V+'), number('V-'), number('4OUT')]).toEqual(['2', '1', '3', '12', '13']);
    expect(getPart('analog/lm339-quad-d')).toBeDefined();
  });
});
