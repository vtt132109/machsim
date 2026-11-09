/**
 * Lesson files: validation of every field, a byte-for-byte round trip, the four described check
 * kinds running on real circuits, and progress files (export / import / merge).
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import { newDesign } from '../model/types';
import { serializeDesign } from '../model/serialize';
import { checkLesson, simulatingSteps, structuralSteps } from './runner';
import { builder, measured, near, p, setAnalyses } from './kit';
import {
  compileLessonFile,
  lessonFileName,
  LESSON_EXTENSION,
  LESSON_FORMAT,
  mergeProgress,
  newCheckSpec,
  newLessonFile,
  parseLessonFile,
  parseProgressFile,
  serializeLessonFile,
  serializeProgressFile,
  isLessonFileText,
  partSpecText,
  type LessonFile,
} from './lessonFile';
import { answerQuiz, emptyProgress, markPassed } from './progress';
import { feedbackText } from '../i18n/lessons';

const run = runAnalyses;

/** A 12 V source and a 20 k / 10 k divider; the meter reads 4 V across the lower resistor. */
function dividerDesign() {
  const b = builder('Divider');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 150, { value: '20k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 250, { value: '10k' }, { rotation: 90 });
  const m = b.part('instruments/multimeter', 'XMM1', 420, 200, { mode: 'v' });
  b.wire(b.pin(v1, '+'), p(100, 120), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(r2, '2'), p(250, 320), p(100, 320));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.part('sources/ground', 'GND1', 100, 320);
  b.label('OUT', 250, 200);
  b.labelPin(m, '+', 'OUT');
  b.labelPin(m, '-', '0');
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** A lesson file that describes the divider exercise with all four check kinds. */
function dividerLesson(): LessonFile {
  const bi = (vi: string, en: string) => ({ vi, en });
  return {
    format: LESSON_FORMAT,
    version: 1,
    id: 'teacher-divider',
    level: 'basics',
    author: 'Cô Lan',
    title: bi('Cầu phân áp của lớp', 'The class voltage divider'),
    goal: bi('Dựng cầu phân áp 12 V và đo 4 V.', 'Build a 12 V divider and measure 4 V.'),
    theory: bi('## Công thức\n$U_2 = U \\cdot R_2 / (R_1 + R_2)$', '## The formula\n$V_2 = V \\cdot R_2 / (R_1 + R_2)$'),
    steps: [
      { id: 'parts', task: bi('Đặt hai điện trở.', 'Place two resistors.'), hint: bi('Nhóm Linh kiện cơ bản.', 'The Basic group.'), check: { kind: 'part', part: { families: ['Resistor'] }, count: 2 } },
      { id: 'ground', task: bi('Nối nguồn xuống đất.', 'Ground the source.'), hint: bi('Chân − của nguồn.', 'The source’s − pin.'), check: { kind: 'connected', from: { pin: '-', part: { ids: ['sources/dc-voltage'] } }, to: { ground: true } } },
      { id: 'clean', task: bi('Sửa hết lỗi điện.', 'Fix every electrical error.'), hint: bi('Chạy ERC.', 'Run ERC.'), check: { kind: 'erc' } },
      { id: 'read', task: bi('Đo 4 V.', 'Measure 4 V.'), hint: bi('Đồng hồ ở chế độ V.', 'The meter in V mode.'), check: { kind: 'measure', probe: { kind: 'meter' }, target: 4, tolerancePct: 3, unit: 'V' } },
      { id: 'net', task: bi('Đặt nhãn OUT.', 'Label the net OUT.'), hint: bi('Nhãn net.', 'A net label.'), check: { kind: 'measure', probe: { kind: 'net', net: 'OUT' }, target: 4, tolerancePct: 3, unit: 'V' } },
    ],
    quiz: [
      {
        id: 'ratio',
        question: bi('Nếu hai điện trở bằng nhau, điện áp ra bằng bao nhiêu?', 'With two equal resistors, what is the output?'),
        options: [bi('Bằng nguồn', 'The supply'), bi('Một nửa nguồn', 'Half the supply'), bi('Bằng không', 'Zero')],
        answer: 1,
        why: bi('Cầu chia đều.', 'The divider splits it evenly.'),
      },
    ],
  };
}

describe('lesson file validation', () => {
  it('accepts a complete lesson and reports no problem', () => {
    const { lesson, errors } = parseLessonFile(serializeLessonFile(dividerLesson()));
    expect(errors).toEqual([]);
    expect(lesson.id).toBe('teacher-divider');
    expect(lesson.author).toBe('Cô Lan');
    expect(lesson.steps.map((s) => s.check.kind)).toEqual(['part', 'connected', 'erc', 'measure', 'measure']);
  });

  it('round trips byte for byte, with the circuits', () => {
    const file: LessonFile = { ...dividerLesson(), starter: serializeDesign(newDesign('Start')), solution: serializeDesign(dividerDesign()) };
    const text = serializeLessonFile(file);
    const again = serializeLessonFile(parseLessonFile(text).lesson);
    expect(again).toBe(text);
    expect(parseLessonFile(text).errors).toEqual([]);
    expect(parseLessonFile(text).lesson.solution).toBe(file.solution);
    expect(isLessonFileText(text)).toBe(true);
    expect(lessonFileName(file)).toBe(`teacher-divider${LESSON_EXTENSION}`);
  });

  it('names the field of every problem it finds', () => {
    const bad = {
      format: LESSON_FORMAT,
      version: 1,
      id: 'has space',
      level: 'rocket-science',
      title: { vi: 'A', en: '' },
      goal: { vi: 'B', en: 'B' },
      steps: [
        { id: 'a', task: { vi: 'x', en: 'y' }, check: { kind: 'part', part: {}, count: 0 } },
        { id: 'a', task: { vi: 'x', en: 'y' }, check: { kind: 'wishful' } },
        { id: 'b', task: { vi: 'x', en: 'y' }, check: { kind: 'measure', probe: { kind: 'net', net: '' }, target: 'lots', tolerancePct: 500 } },
      ],
      quiz: [{ id: 'q', question: { vi: 'x', en: 'y' }, options: [{ vi: 'a', en: 'a' }], answer: 4 }],
      solution: '{not a design}',
    };
    const { errors } = parseLessonFile(JSON.stringify(bad));
    const seen = errors.map((e) => `${e.path}:${e.code}`);
    expect(seen).toContain('id:type');
    expect(seen).toContain('level:unknown');
    expect(seen).toContain('title:empty');
    expect(seen).toContain('steps[0].check.count:range');
    expect(seen).toContain('steps[0].check.part:empty');
    expect(seen).toContain('steps[1].id:duplicate');
    expect(seen).toContain('steps[1].check.kind:unknown');
    expect(seen).toContain('steps[2].check.probe.net:empty');
    expect(seen).toContain('steps[2].check.target:type');
    expect(seen).toContain('steps[2].check.tolerancePct:range');
    expect(seen).toContain('quiz[0].options:empty');
    expect(seen).toContain('quiz[0].answer:range');
    expect(seen).toContain('solution:design');
  });

  it('refuses text that is not a lesson file at all', () => {
    expect(parseLessonFile('{oops').errors[0].code).toBe('format');
    expect(parseLessonFile('[]').errors[0].code).toBe('format');
    expect(parseLessonFile(JSON.stringify({ format: 'something-else' })).errors.map((e) => e.path)).toContain('format');
    expect(parseLessonFile(JSON.stringify({ format: LESSON_FORMAT, version: 9 })).errors.map((e) => e.code)).toContain('range');
    // an empty lesson is reported as having no steps
    expect(parseLessonFile(serializeLessonFile(newLessonFile())).errors.map((e) => `${e.path}:${e.code}`)).toContain('steps:empty');
  });

  it('every problem code has a Vietnamese and English text, and the notes the checks use exist', async () => {
    const { lt } = await import('../i18n/learnUi');
    for (const code of ['missing', 'type', 'empty', 'range', 'duplicate', 'unknown', 'format', 'design'] as const) {
      expect(lt(`ed.err.${code}`, undefined, 'vi').length, code).toBeGreaterThan(2);
      expect(lt(`ed.err.${code}`, undefined, 'en').length, code).toBeGreaterThan(2);
    }
    for (const id of ['note:filePart', 'note:fileConnect', 'note:fileConnectMissing', 'note:fileNet', 'note:fileErcOk', 'note:fileErcEmpty']) {
      expect(feedbackText(id), id).toBeDefined();
    }
  });

  it('newCheckSpec gives a usable default for every kind', () => {
    for (const kind of ['part', 'connected', 'measure', 'erc'] as const) {
      const spec = newCheckSpec(kind);
      expect(spec.kind).toBe(kind);
      const { errors } = parseLessonFile(
        serializeLessonFile({ ...newLessonFile(), title: { vi: 'a', en: 'b' }, goal: { vi: 'a', en: 'b' }, steps: [{ id: 's1', task: { vi: 'a', en: 'b' }, hint: { vi: '', en: '' }, check: spec }] }),
      );
      expect(errors, kind).toEqual([]);
    }
    expect(partSpecText({ families: ['Resistor'], ids: ['basic/resistor'] })).toBe('basic/resistor, Resistor');
  });
});

describe('described checks on real circuits', () => {
  it('every step of an authored lesson passes on its solution and fails on an empty sheet', async () => {
    const { def } = compileLessonFile({ ...dividerLesson(), solution: serializeDesign(dividerDesign()) });
    const ok = await checkLesson(def, def.solution(), run);
    for (const s of def.steps) expect(ok[s.id].ok, `${s.id}: ${JSON.stringify(ok[s.id].note)}`).toBe(true);
    const empty = await checkLesson(def, newDesign(), run);
    for (const s of def.steps) expect(empty[s.id].ok, s.id).toBe(false);
    expect(empty.parts.note).toEqual({ id: 'note:filePart', params: { part: 'Resistor', n: 2, have: 0 } });
    expect(empty.net.note?.id).toBe('note:fileNet');
    // only the measuring steps simulate
    expect(simulatingSteps(def)).toEqual(['read', 'net']);
    expect(structuralSteps(def)).toEqual(['parts', 'ground', 'clean']);
  });

  it('a measure step reports the number it measured', async () => {
    const { def } = compileLessonFile({ ...dividerLesson(), solution: serializeDesign(dividerDesign()) });
    const d = def.solution();
    for (const s of d.sheets) for (const q of s.parts) if (q.refdes === 'R1') q.params = { ...q.params, value: '10k' };
    const r = await checkLesson(def, d, run, ['read']);
    expect(r.read.ok).toBe(false);
    expect(r.read.note).toEqual({ id: 'measured', params: { value: '6 V', target: '4 V', tol: 3 } });
  });

  it('a target of 0 accepts the nanovolts a real circuit answers, and toleranceAbs widens the band', () => {
    // a percentage of zero is zero: without an absolute floor no learner could ever pass
    expect(near(2e-9, 0, 5)).toBe(true);
    expect(near(0.05, 0, 5)).toBe(false);
    expect(near(0.05, 0, 5, 0.1)).toBe(true);
    // a non-zero target keeps the percentage band
    expect(near(5.1, 5, 5)).toBe(true);
    expect(near(5.3, 5, 5)).toBe(false);
    // the feedback names the absolute band instead of "0 V ± 5 %"
    expect(measured(0.05, 0, 5, 'V').note).toEqual({ id: 'measuredAbs', params: { value: '50 mV', target: '0 V', band: '1 µV' } });
    expect(measured(2e-9, 0, 5, 'V').ok).toBe(true);
  });

  it('round-trips toleranceAbs and refuses a negative one', () => {
    const l = newLessonFile('zero');
    l.title = { vi: 'Cầu cân bằng', en: 'Balanced bridge' };
    l.goal = { vi: 'Điện áp ra bằng 0', en: 'The output is 0 V' };
    l.steps = [
      {
        id: 'zero',
        task: { vi: 'a', en: 'b' },
        hint: { vi: '', en: '' },
        check: { kind: 'measure', probe: { kind: 'meter' }, target: 0, tolerancePct: 5, unit: 'V', toleranceAbs: 1e-3 },
      },
    ];
    const back = parseLessonFile(serializeLessonFile(l));
    expect(back.errors).toEqual([]);
    expect(back.lesson!.steps[0].check).toEqual({ kind: 'measure', probe: { kind: 'meter' }, target: 0, tolerancePct: 5, unit: 'V', toleranceAbs: 1e-3 });
    const bad = parseLessonFile(serializeLessonFile(l).replace('"toleranceAbs": 0.001', '"toleranceAbs": -1'));
    expect(bad.errors.map((e) => e.path)).toEqual(['steps[0].check.toleranceAbs']);
  });

  it('a connected check also works part to part, and reports a missing part', async () => {
    const { def } = compileLessonFile({
      ...dividerLesson(),
      steps: [
        { id: 'series', task: { vi: 'a', en: 'b' }, hint: { vi: '', en: '' }, check: { kind: 'connected', from: { pin: '2', part: { ids: ['basic/resistor'] } }, to: { pin: '1', part: { ids: ['basic/resistor'] } } } },
        { id: 'scope', task: { vi: 'a', en: 'b' }, hint: { vi: '', en: '' }, check: { kind: 'connected', from: { pin: 'A+', part: { instruments: ['oscilloscope'] } }, to: { ground: true } } },
      ],
    });
    const r = await checkLesson(def, dividerDesign(), run);
    expect(r.series.ok).toBe(true);
    expect(r.scope.ok).toBe(false);
    expect(r.scope.note?.id).toBe('note:fileConnectMissing');
  });

  it('an ERC step fails with the ERC message, and passes once the mistake is fixed', async () => {
    const { def } = compileLessonFile(dividerLesson());
    const d = dividerDesign();
    // the classic beginner slip: the same reference designator on two parts
    for (const s of d.sheets) for (const q of s.parts) if (q.refdes === 'R2') q.refdes = 'R1';
    const bad = await checkLesson(def, d, run, ['clean']);
    expect(bad.clean.ok).toBe(false);
    expect(JSON.parse(String(bad.clean.note?.params?.erc)).code).toBe('duplicate-refdes');
    const good = await checkLesson(def, dividerDesign(), run, ['clean']);
    expect(good.clean.ok).toBe(true);
    expect(good.clean.note?.id).toBe('note:fileErcOk');
  });

  it('a part check can also ask for an instrument and for a current', async () => {
    const { def } = compileLessonFile({
      ...dividerLesson(),
      steps: [
        { id: 'meter', task: { vi: 'a', en: 'b' }, hint: { vi: '', en: '' }, check: { kind: 'part', part: { instruments: ['multimeter'] } } },
        { id: 'current', task: { vi: 'a', en: 'b' }, hint: { vi: '', en: '' }, check: { kind: 'measure', probe: { kind: 'partCurrent', part: { ids: ['basic/resistor'] } }, target: 400e-6, tolerancePct: 2, unit: 'A' } },
        { id: 'vdrop', task: { vi: 'a', en: 'b' }, hint: { vi: '', en: '' }, check: { kind: 'measure', probe: { kind: 'partVoltage', part: { ids: ['basic/resistor'] } }, target: 8, tolerancePct: 2, unit: 'V' } },
      ],
    });
    const r = await checkLesson(def, dividerDesign(), run);
    expect(r.meter.ok).toBe(true);
    expect(r.current.ok, JSON.stringify(r.current.note)).toBe(true);
    expect(r.vdrop.ok, JSON.stringify(r.vdrop.note)).toBe(true);
  });

  it('compiles the text and the quiz the panel shows', () => {
    const { text, def } = compileLessonFile(dividerLesson());
    expect(text.title.vi).toBe('Cầu phân áp của lớp');
    expect(Object.keys(text.steps)).toEqual(def.steps.map((s) => s.id));
    expect(text.quiz.ratio.options.length).toBe(3);
    expect(def.quiz).toEqual([{ id: 'ratio', options: 3, answer: 1 }]);
    // no solution in the file: the panel gets an empty sheet rather than a crash
    expect(compileLessonFile(dividerLesson()).def.solution().sheets[0].parts).toEqual([]);
  });
});

describe('progress files', () => {
  it('writes, reads and merges progress', () => {
    let a = emptyProgress();
    a = markPassed(a, 'ohm', ['source', 'resistor']);
    a = answerQuiz(a, 'ohm', 'double', 1);
    const text = serializeProgressFile(a, '  Minh  ', new Date('2026-03-04T05:06:07Z'));
    const file = parseProgressFile(text);
    expect(file?.learner).toBe('Minh');
    expect(file?.saved).toBe('2026-03-04T05:06:07.000Z');
    expect(file?.progress).toEqual(a);

    let b = emptyProgress();
    b = markPassed(b, 'ohm', ['loop']);
    b = markPassed(b, 'divider', ['parts']);
    b = answerQuiz(b, 'ohm', 'double', 2);
    const merged = mergeProgress(a, b);
    expect(merged.steps.ohm.sort()).toEqual(['loop', 'resistor', 'source']);
    expect(merged.steps.divider).toEqual(['parts']);
    expect(merged.quiz.ohm.double).toBe(2);
  });

  it('refuses a file that is not a progress file', () => {
    expect(parseProgressFile('nonsense')).toBeNull();
    expect(parseProgressFile('[]')).toBeNull();
    expect(parseProgressFile(JSON.stringify({ format: 'machsim-design' }))).toBeNull();
    expect(parseProgressFile(JSON.stringify({ format: 'machsim-lesson-progress', version: 2 }))).toBeNull();
    // a progress file with a damaged body reads as empty progress rather than throwing
    expect(parseProgressFile(JSON.stringify({ format: 'machsim-lesson-progress', version: 1, progress: 7 }))?.progress).toEqual(emptyProgress());
  });
});
