/**
 * Review round 2: guided lessons (src/learn). The Kirchhoff lesson asks for the main current and a
 * branch current. A learner who places TWO ammeters at once (one in the main line, one in a
 * branch, the natural way to see I = I2 + I3) never passes the branch step: both meter steps read
 * only the first multimeter found (`c.meter(await c.op(), m[0])` in
 * src/learn/lessons/basics.ts), so the second, correctly placed meter is ignored and the learner
 * gets "this is not a branch current".
 *
 * Expected: each step passes when ANY placed ammeter measures the asked current.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../../../src/sim';
import { checkLesson } from '../../../src/learn/runner';
import { getLesson } from '../../../src/learn/lessons';
import { builder, p, setAnalyses } from '../../../src/learn/kit';

/** Kirchhoff circuit with XMM1 (A mode) in the main line and XMM2 (A mode) in the R3 branch. */
function twoMeters() {
  const b = builder('Kirchhoff, two meters');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 240, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 160, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 340, 260, { value: '2k' }, { rotation: 90 });
  const r3 = b.part('basic/resistor', 'R3', 440, 260, { value: '3k' }, { rotation: 90 });
  const xmm1 = b.part('instruments/multimeter', 'XMM1', 170, 110, { mode: 'a' });
  const xmm2 = b.part('instruments/multimeter', 'XMM2', 390, 110, { mode: 'a' });
  b.wire(b.pin(v1, '+'), p(100, 140), b.pin(xmm1, '+'));
  b.wire(b.pin(xmm1, '-'), p(180, 160), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(340, 160), b.pin(r2, '1'));
  b.wire(p(340, 160), p(380, 160), b.pin(xmm2, '+'));
  b.wire(b.pin(xmm2, '-'), p(440, 140), b.pin(r3, '1'));
  b.wire(b.pin(r2, '2'), p(340, 330), p(100, 330));
  b.wire(b.pin(r3, '2'), p(440, 330), p(340, 330));
  b.wire(b.pin(v1, '-'), p(100, 330));
  b.part('sources/ground', 'GND1', 100, 330);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

describe('Kirchhoff lesson with two ammeters', () => {
  it('control: the circuit is the lesson circuit (junction step passes)', async () => {
    const r = await checkLesson(getLesson('kirchhoff')!, twoMeters(), runAnalyses, ['junction']);
    expect(r.junction.ok).toBe(true);
  });

  it('the main-current and branch-current steps both pass when one meter sits in each place', async () => {
    const r = await checkLesson(getLesson('kirchhoff')!, twoMeters(), runAnalyses, ['mainCurrent', 'branchCurrent']);
    expect(r.mainCurrent.ok).toBe(true);
    // today: fails with note:notBranch because only XMM1 (main line, 6.55 mA) is read
    expect({ ok: r.branchCurrent.ok, note: r.branchCurrent.note?.id }).toEqual({ ok: true, note: 'okValue' });
  });
});
