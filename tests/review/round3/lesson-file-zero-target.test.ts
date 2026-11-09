/**
 * Review round 3: teacher-authored lesson files (step 8, src/learn/lessonFile.ts).
 *
 * A `measure` step checks |value − target| ≤ |target|·tol% (src/learn/kit.ts near()). With a target
 * of 0 — "the voltage across the closed switch is 0 V", "no current flows through the open
 * branch", "the output of the balanced bridge is 0 V", all ordinary classroom checks — the allowed
 * error collapses to 1e-15, so a simulated 2 nV (a switch's on-resistance, a 1 GΩ leak, solver
 * round-off) fails for ever. The lesson editor and parseLessonFile accept target 0 without a word,
 * so the teacher publishes a step no learner can pass.
 *
 * Expected: either the file is refused / warned about (an error on steps[0].check.target), or a
 * zero target is checked with an absolute tolerance so a few nanovolts pass. Fails today.
 */
import { describe, expect, it } from 'vitest';
import { near } from '../../../src/learn/kit';
import { parseLessonFile, serializeLessonFile, newLessonFile } from '../../../src/learn/lessonFile';

function lessonWithTarget(target: number): string {
  const l = newLessonFile('cau-can-bang');
  l.title = { vi: 'Cầu cân bằng', en: 'Balanced bridge' };
  l.goal = { vi: 'Điện áp ra của cầu cân bằng bằng 0', en: 'A balanced bridge outputs 0 V' };
  l.steps = [
    {
      id: 'zero',
      task: { vi: 'Đo điện áp giữa hai nhánh cầu', en: 'Measure the voltage between the two arms' },
      hint: { vi: '', en: '' },
      check: { kind: 'measure', probe: { kind: 'meter' }, target, tolerancePct: 5, unit: 'V' },
    },
  ];
  return serializeLessonFile(l);
}

describe('a measure step with target 0 in a lesson file', () => {
  it('control: a 5 V target with 5 % accepts 5.1 V', () => {
    const { errors } = parseLessonFile(lessonWithTarget(5));
    expect(errors).toEqual([]);
    expect(near(5.1, 5, 5)).toBe(true);
  });

  it('is either refused by the validator or passes a simulated 2 nV', () => {
    const { errors } = parseLessonFile(lessonWithTarget(0));
    const refused = errors.some((e) => e.path === 'steps[0].check.target');
    if (!refused) expect(near(2e-9, 0, 5)).toBe(true);
  });
});
