/**
 * Completeness review round 3 — "Ladder diagram" (step 6) is claimed implemented, and so are
 * "Print / Print setup" and "Export ảnh SVG / PNG". Two basic uses fail:
 *
 *  1. A ladder sheet prints / exports as an EMPTY page. printDesign() and File › Export image draw
 *     every sheet through sheetToSvg(), which renders the schematic lists only; a ladder sheet
 *     keeps those empty and stores its program in `Sheet.ladder`, so the rungs (contacts I0.0 /
 *     I0.1, coil Q0.0 of sample 55) never reach the paper. A learner who prints the ladder
 *     exercise to hand in gets a blank frame. (Step 6 lists this as a gap; the Print row of the
 *     matrix still said "implemented".)
 *
 *  2. A PLC rack and its ladder sheet placed inside a hierarchical block / subcircuit are silently
 *     ignored: buildNetlist() builds the A_LADDER element for the top level only
 *     (`if (!isChild)` in src/model/netlister.ts) and says nothing, so the coils never switch and
 *     ERC is clean. The same rack at the top level with no I/O module gets the `ladderNoModules`
 *     warning, so the checker exists — it just never runs below the top level.
 *
 * Expected: the printed / exported ladder sheet shows its rungs, and a ladder program that will
 * not run produces an ERC warning.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { newRung } from '../../../../src/ladder/edit';
import { getPart } from '../../../../src/library';
import { DesignBuilder } from '../../../../src/model/designkit';
import { buildNetlist } from '../../../../src/model/netlister';
import { parseDesign } from '../../../../src/model/serialize';
import { planPrint } from '../../../../src/ui/app/printPlan';
import { sheetToSvg } from '../../../../src/ui/editor/exportImage';

const sample = () => parseDesign(readFileSync(new URL('../../../../examples/55-ladder-start-stop.msim', import.meta.url), 'utf8'));

describe('a ladder sheet on paper', () => {
  it('control: the schematic sheet of sample 55 prints its parts', () => {
    const d = sample();
    const sch = d.sheets.find((s) => s.kind !== 'ladder')!;
    expect(sheetToSvg(d, sch.id, getPart).svg).toContain('V1');
  });

  it('the print plan includes the ladder sheet and its picture shows the rungs (I0.0, I0.1, Q0.0)', () => {
    const d = sample();
    const ladder = d.sheets.find((s) => s.kind === 'ladder')!;
    expect(ladder.ladder!.length).toBeGreaterThan(0);
    const plan = planPrint(d, ladder.id, { sheets: 'all' });
    expect(plan.pages.map((p) => p.sheetId)).toContain(ladder.id);
    const svg = sheetToSvg(d, ladder.id, getPart).svg;
    for (const address of ['I0.0', 'I0.1', 'Q0.0']) expect(svg).toContain(address);
  });
});

/** a controller + 4-input module + one rung, at the top level or inside a hierarchical block */
function rack(inBlock: boolean) {
  const b = new DesignBuilder('PLC');
  const child = inBlock ? b.child('Tủ điều khiển', { kind: 'hierarchical' }) : '';
  b.part('misc-digital/plc-controller', 'PLC1', 0, 0);
  const inp = b.part('misc-digital/plc-input-4', 'PLCI1', 300, 0);
  // 24 V on channel I0.0, COM on 0 V
  const v = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '24' });
  b.connect(v, '+', inp, 'I0');
  const gnd = b.part('sources/ground', 'GND1', 100, 400);
  b.connect(v, '-', gnd, '1');
  b.connect(inp, 'COM', gnd, '1');
  b.ladderSheet([newRung('r1')]);
  if (inBlock) {
    b.root();
    b.block(child, 'X1', 0, 0);
    b.part('sources/ground', 'GND1', 0, 300);
  }
  const build = buildNetlist(b.design);
  // the program runs when an A_LADDER model card reaches the netlist (top level or a subcircuit)
  const runs = JSON.stringify(build.netlist).includes('"A_LADDER"');
  const reported = build.erc.some((m) => (m.detail?.id ?? '').startsWith('ladder'));
  return { runs, reported };
}

describe('a ladder program below the top level', () => {
  it('control: a top-level controller with no I/O module is reported (ladderNoModules)', () => {
    const b = new DesignBuilder('PLC gốc');
    b.part('misc-digital/plc-controller', 'PLC1', 0, 0);
    b.ladderSheet([newRung('r1')]);
    const ids = buildNetlist(b.design).erc.map((m) => m.detail?.id);
    expect(ids).toContain('ladderNoModules');
  });

  it('control: the same rack at the top level runs (an A_LADDER element is built)', () => {
    expect(rack(false).runs).toBe(true);
  });

  it('a rack + ladder sheet inside a hierarchical block is either run or reported', () => {
    const r = rack(true);
    expect(r.runs || r.reported).toBe(true);
  });
});
