/**
 * Sample 78 (tank control with a function block, word math and an analog output) behaves as its
 * notes say, through the real netlister and engine: the pump is the block's output, the gauge is
 * 0.5 x the level in volts on an analog output, the word counter counts the pump starts, and the
 * saved file holds the block.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../../../src/model/netlister';
import { parseDesign } from '../../../src/model/serialize';
import { runAnalyses } from '../../../src/sim';
import type { AnalysisResult } from '../../../src/sim/results';
import { crossReference, xrefWarnings } from '../../../src/ladder/xref';
import { ladderBlockSample } from '../../../src/ui/integration/ladderSamples';

const FILE = fileURLToPath(new URL('../../../examples/78-ladder-function-block.msim', import.meta.url));

function at(r: AnalysisResult, name: string, t: number): number {
  const time = r.scale!.re;
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).slice(0, 40).join(', ')}`);
  let k = 0;
  while (k + 1 < time.length && time[k + 1] <= t) k++;
  return v.re[k];
}

describe('sample 78: tank with a function block', () => {
  const design = parseDesign(readFileSync(FILE, 'utf8'));
  const build = buildNetlist(design, { includeAnalysis: false });

  it('the file holds the block and the rungs, and is what the builder makes', () => {
    expect(design.ladderBlocks?.map((b) => b.name)).toEqual(['BomHaiMuc']);
    const sheet = design.sheets.find((s) => s.kind === 'ladder')!;
    expect(sheet.ladder!.map((r) => r.outputs[0].kind)).toEqual(['call', 'mul', 'add', 'coil']);
    expect(JSON.parse(JSON.stringify(ladderBlockSample())).ladderBlocks).toEqual(JSON.parse(JSON.stringify(design.ladderBlocks)));
  });

  it('compiles without a problem and passes ERC with no warning', () => {
    expect(build.ladder?.errors).toEqual([]);
    expect(build.erc.map((m) => `${m.severity}: ${m.message}`)).toEqual([]);
    // the call became plain rungs: the 4 drawn rungs plus the block's one
    expect(build.ladder!.ir.rungs).toHaveLength(5);
    expect(build.ladder!.ir.words).toBe(1);
    expect(build.ladder!.ir.aouts).toBe(1);
  });

  it('the pump runs 16 s, then rests; the gauge reads half the level; the pump started once', () => {
    const [tr] = runAnalyses({ ...build.netlist, analyses: [design.analysis.specs.tran!], saves: ['all', `Lw0(${build.ladder!.element})`, `Lo0(${build.ladder!.element})`] });
    expect(tr.error).toBeUndefined();
    expect(at(tr, 'V(PUMP)', 5)).toBeGreaterThan(20);
    expect(at(tr, 'V(PUMP)', 20)).toBeLessThan(1);
    // 80 % of a 10 V transmitter is 8 V; the gauge is AQ0 = AI0 x 0.5, so 4 V
    expect(at(tr, 'V(LVL)', 20)).toBeCloseTo(8, 1);
    expect(at(tr, 'V(GAUGE)', 20)).toBeGreaterThan(3.95);
    expect(at(tr, 'V(GAUGE)', 20)).toBeLessThan(4.01);
    // the gauge follows the level while it rises: at 8 s the tank is at 40 % (4 V), the gauge at 2 V
    expect(at(tr, 'V(GAUGE)', 8)).toBeCloseTo(2, 1);
    // one start so far: MW0 = 1, the alarm (MW0 >= 2) is dark
    expect(at(tr, `Lw0(${build.ladder!.element})`, 20)).toBe(1);
    expect(at(tr, 'V(ALARM)', 20)).toBeLessThan(1);
  });

  it('the cross-reference shows MW0 written in rung 3 and read in rung 4, and nothing suspicious', () => {
    const sheet = design.sheets.find((s) => s.kind === 'ladder')!;
    const entries = crossReference([{ sheetId: sheet.id, sheetName: sheet.name, rungs: sheet.ladder! }], design.ladderBlocks);
    const mw0 = entries.find((e) => e.address === 'MW0')!;
    expect(mw0.uses.map((u) => `${u.role}${u.rungIndex + 1}`).sort()).toEqual(['read3', 'read4', 'write3'].sort());
    // the sample is deliberately clean: only the private memory of the block is not an issue
    expect(xrefWarnings(entries).filter((w) => w.kind !== 'local')).toEqual([]);
  });
});
