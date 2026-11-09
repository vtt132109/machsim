/**
 * Correctness review, round 4: Place › Hierarchical block from a file (`childFromDesign`) meets
 * ladder function blocks (step 7).
 *
 * Function blocks live in the ROOT design (`Design.ladderBlocks`) and are called by name. When a
 * .msim file becomes a block, its function blocks are merged with `mergeLadderBlocks`, which skips
 * every incoming block whose NAME the target already uses — even when the two blocks are different
 * programs. The imported ladder sheet then calls the target's block: e.g. the file's "Motor" latches
 * a motor with a stop button, the target's "Motor" is a plain pass-through, and the imported program
 * silently runs the wrong logic. Nothing is reported (the sanitize notes stay empty).
 *
 * Accepted outcomes: the incoming block is kept under another name and the imported calls follow
 * it, or the notes name the clash so the learner knows.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { childFromDesign } from '../../../src/ui/store/hierarchyOps';
import type { Design } from '../../../src/model/types';
import type { LadderBlock } from '../../../src/ladder/types';

function withBlock(title: string, block: LadderBlock): Design {
  const b = new DesignBuilder(title);
  b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
  return { ...b.design, ladderBlocks: [block] };
}

const passThrough: LadderBlock = {
  id: 'fb1',
  name: 'Motor',
  inputs: ['IN1'],
  outputs: ['OUT1'],
  rungs: [{ id: 'r1', comment: '', logic: { kind: 'contact', type: 'no', address: 'IN1' }, outputs: [{ kind: 'coil', address: 'OUT1' }] }],
};

const inverted: LadderBlock = {
  id: 'fb1',
  name: 'Motor',
  inputs: ['IN1'],
  outputs: ['OUT1'],
  rungs: [{ id: 'r1', comment: '', logic: { kind: 'contact', type: 'nc', address: 'IN1' }, outputs: [{ kind: 'coil', address: 'OUT1' }] }],
};

const sameProgram = (a: LadderBlock, b: LadderBlock): boolean =>
  JSON.stringify([a.inputs, a.outputs, a.rungs.map((r) => [r.logic, r.outputs])]) === JSON.stringify([b.inputs, b.outputs, b.rungs.map((r) => [r.logic, r.outputs])]);

describe('two different function blocks with the same name', () => {
  it('the imported program keeps its own block, or the clash is reported', () => {
    const target = withBlock('Target', passThrough);
    const source = withBlock('Source', inverted);
    const out = childFromDesign(target, source, 'Imported');
    const keptIncoming = (out.design.ladderBlocks ?? []).some((b) => sameProgram(b, inverted));
    const reported = out.notes.some((n) => n.names.some((x) => /Motor/i.test(x)));
    expect(keptIncoming || reported, `blocks ${JSON.stringify(out.design.ladderBlocks?.map((b) => b.name))}, notes ${JSON.stringify(out.notes)}`).toBe(true);
  });
});
