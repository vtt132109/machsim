/**
 * Review round 2: the reference solution of a guided lesson ("Xem lời giải") is what a beginner
 * copies. It should be a clean drawing: running Tools > ERC on it must not report problems. Two
 * solutions are not clean:
 *  - flipflop: a stub wire from U1.Q ends in the air at (460, 210) (src/learn/lessons/digital.ts
 *    flipflopLayout) — ERC "Wire end at (460, 210) is not connected to anything";
 *  - adc-dac: the DAC output net OUT has only the DAC pin on it (no meter / probe / load) — ERC
 *    "Net OUT connects only to U2 pin VOUT", while the lesson tells the learner to measure VOUT.
 * The test fails while any reference solution or starter produces an ERC error or warning (the
 * rc-charge starter is excluded: its open source pin is the learner's task).
 */
import { describe, expect, it } from 'vitest';
import { LESSONS } from '../../../src/learn/lessons';
import { buildNetlist } from '../../../src/model/netlister';

describe('lesson reference solutions are ERC-clean', () => {
  for (const lesson of LESSONS) {
    it(`${lesson.id}: the solution has no ERC errors or warnings`, () => {
      const build = buildNetlist(lesson.solution());
      const problems = build.erc.filter((m) => m.severity === 'error' || m.severity === 'warning').map((m) => m.message);
      expect(problems).toEqual([]);
    });
  }
});
