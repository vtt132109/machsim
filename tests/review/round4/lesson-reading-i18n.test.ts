/**
 * Correctness review, round 4: what a Vietnamese learner reads when a teacher's transient / AC
 * `measure` step (round 4 step 3, src/learn/lessonFile.ts `measureOther`) cannot take its reading.
 *
 * The step fails with `note:fileReading` and the params `{ reading, message }`, where `reading` is
 * the internal key ('frequency', 'rms', 'pp' ...) and `message` is the English text of the
 * measurement engine ("the signal does not repeat in the window", "no such signal"). The lesson
 * panel (`feedbackLine`) interpolates both as they are into the Vietnamese sentence, so the learner
 * reads e.g. "Không đọc được “frequency” từ mạch: the signal does not repeat in the window."
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { serializeDesign } from '../../../src/model/serialize';
import type { Design } from '../../../src/model/types';
import { runAnalyses } from '../../../src/sim';
import { compileLessonFile, LESSON_FORMAT, type LessonCheckSpec, type LessonFile } from '../../../src/learn/lessonFile';
import { checkLesson } from '../../../src/learn/runner';
import { feedbackLine } from '../../../src/ui/learn/LessonsPanel';

const bi = (vi: string, en: string) => ({ vi, en });

/** A source into a 1k / 1k divider, OUT in the middle; `dc` = a 5 V battery instead of a 1 kHz sine. */
function divider(dc: boolean): Design {
  const b = new DesignBuilder('Divider');
  const v = dc ? b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' }) : b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '2', freq: '1k' });
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '1k' });
  const g = b.part('sources/ground', 'G1', 200, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r2, '1', 'OUT');
  b.labelPin(r2, '2', 'GND0');
  b.labelPin(v, '-', 'GND0');
  b.labelPin(g, '1', 'GND0');
  return b.design;
}

function lesson(check: LessonCheckSpec): LessonFile {
  return {
    format: LESSON_FORMAT,
    version: 1,
    id: 'review-reading',
    level: 'basics',
    title: bi('Đo tần số', 'Measure the frequency'),
    goal: bi('Đo.', 'Measure.'),
    theory: bi('Đo.', 'Measure.'),
    steps: [{ id: 's1', task: bi('Đo tần số ở OUT.', 'Measure the frequency at OUT.'), hint: bi('Nhãn OUT.', 'The OUT label.'), check }],
    quiz: [],
    solution: serializeDesign(divider(false)),
  };
}

/** English words the engine messages and the reading keys use; none belongs in a Vietnamese sentence. */
const ENGLISH = /\b(signal|repeat|window|such|frequency|reading|measured|mean level|not)\b/i;

describe('a transient reading that cannot be taken, in Vietnamese', () => {
  it('the frequency of a DC circuit: the feedback is fully Vietnamese', async () => {
    const check: LessonCheckSpec = { kind: 'measure', probe: { kind: 'net', net: 'OUT' }, target: 1000, tolerancePct: 2, unit: '', analysis: { kind: 'tran', tstop: 5e-3, reading: 'frequency' } };
    const { def } = compileLessonFile(lesson(check));
    const got = (await checkLesson(def, divider(true), runAnalyses)).s1;
    expect(got.ok).toBe(false);
    expect(got.note?.id).toBe('note:fileReading');
    const vi = feedbackLine(got.note!, 'vi');
    expect(vi).toMatch(/Không đọc được/);
    expect(vi, vi).not.toMatch(ENGLISH);
  });
});
