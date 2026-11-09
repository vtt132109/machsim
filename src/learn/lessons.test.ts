/**
 * Lesson checkers: every step of every lesson passes on the lesson's reference solution (or on
 * its variant for "second state" steps), fails on an empty sheet, and fails with the right
 * feedback on typical mistakes. Also checks that every text the lessons use exists in Vietnamese
 * and English.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import { newDesign, type Design } from '../model/types';
import { parseRichText } from '../model/richText';
import { LESSONS, getLesson, nextLesson } from './lessons';
import { checkLesson, simulatingSteps, structuralSteps } from './runner';
import { FEEDBACK, LESSON_TEXT, LEVELS, NOTES, NOUNS, feedbackText } from '../i18n/lessons';
import { answerQuiz, emptyProgress, lessonStatus, markPassed, parseProgress, resetLesson, serializeProgress } from './progress';
import type { LessonDef } from './types';
import { builder, p, setAnalyses } from './kit';

const run = runAnalyses;

async function stepResult(lesson: LessonDef, design: Design, step: string) {
  return (await checkLesson(lesson, design, run, [step]))[step];
}

/** Change a part parameter of a design (by refdes) — the typical learner mistake. */
function withParam(design: Design, refdes: string, key: string, value: string): Design {
  for (const s of design.sheets) for (const p of s.parts) if (p.refdes === refdes) p.params = { ...p.params, [key]: value };
  return design;
}

describe('lesson catalogue', () => {
  it('has at least 20 lessons with unique ids, in four levels', () => {
    expect(LESSONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(LESSONS.length);
    expect(new Set(LESSONS.map((l) => l.level))).toEqual(new Set(Object.keys(LEVELS)));
    expect(getLesson('ohm')?.id).toBe('ohm');
    expect(nextLesson('ohm')?.id).toBe('divider');
    expect(nextLesson(LESSONS[LESSONS.length - 1].id)).toBeUndefined();
  });

  it('covers the required topics', () => {
    const ids = LESSONS.map((l) => l.id);
    for (const id of ['ohm', 'divider', 'series-parallel', 'rc-charge', 'rc-filter', 'diode', 'led', 'zener', 'rectifier', 'bjt-switch', 'ce-amp', 'opamp-inverting', 'opamp-noninverting', 'comparator', 'timer555', 'logic-gates', 'flipflop', 'counter-7seg', 'adc-dac']) expect(ids).toContain(id);
  });

  it.each(LESSONS.map((l) => [l.id, l] as const))('%s has complete bilingual text', (_id, lesson) => {
    const text = LESSON_TEXT[lesson.id];
    expect(text, lesson.id).toBeDefined();
    for (const t of [text.title, text.goal, text.theory]) {
      expect(t.vi.trim().length).toBeGreaterThan(5);
      expect(t.en.trim().length).toBeGreaterThan(5);
      expect(t.vi).not.toBe(t.en);
    }
    // theory parses into headings / paragraphs / formulas, no unbalanced block formula left over
    for (const lang of ['vi', 'en'] as const) {
      const blocks = parseRichText(text.theory[lang]);
      expect(blocks.length).toBeGreaterThan(2);
      // a block or inline formula
      expect(JSON.stringify(blocks)).toContain('"kind":"math"');
      expect(JSON.stringify(blocks)).not.toContain('$$');
    }
    expect(Object.keys(text.steps).sort()).toEqual(lesson.steps.map((s) => s.id).sort());
    for (const s of Object.values(text.steps)) for (const t of [s.task, s.hint]) expect(t.vi && t.en).toBeTruthy();
    expect(Object.keys(text.quiz).sort()).toEqual(lesson.quiz.map((q) => q.id).sort());
    for (const q of lesson.quiz) {
      const qt = text.quiz[q.id];
      expect(qt.options.length, `${lesson.id}.${q.id}`).toBe(q.options);
      expect(q.answer).toBeGreaterThanOrEqual(0);
      expect(q.answer).toBeLessThan(q.options);
      expect(qt.q.vi && qt.q.en && qt.why.vi && qt.why.en).toBeTruthy();
      for (const o of qt.options) expect(o.vi && o.en).toBeTruthy();
    }
    expect(lesson.quiz.length).toBeGreaterThanOrEqual(3);
    expect(lesson.steps.length).toBeGreaterThanOrEqual(3);
  });

  it('every feedback id the checks use has text', () => {
    const dir = join(__dirname, 'lessons');
    const used = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8') + readFileSync(join(__dirname, 'kit.ts'), 'utf8') + readFileSync(join(__dirname, 'runner.ts'), 'utf8');
      for (const m of src.matchAll(/(?:fail|pass)\('([A-Za-z0-9:]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/id: '([A-Za-z]+)', params/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(80);
    for (const id of used) expect(feedbackText(id), id).toBeDefined();
    for (const t of [...Object.values(FEEDBACK), ...Object.values(NOTES), ...Object.values(NOUNS)]) {
      // same placeholders in both languages
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(ph(t.vi)).toBe(ph(t.en));
    }
  });
});

describe('lesson checkers on the reference solutions', () => {
  it.each(LESSONS.map((l) => [l.id, l] as const))('%s: every step passes on its solution and fails on an empty sheet', async (_id, lesson) => {
    const solved = await checkLesson(lesson, lesson.solution(), run);
    for (const step of lesson.steps) {
      const variant = lesson.variants?.[step.id];
      const r = variant ? await stepResult(lesson, variant(), step.id) : solved[step.id];
      expect(r.ok, `${lesson.id}.${step.id}: ${JSON.stringify(r.note)}`).toBe(true);
      if (variant) {
        // a variant step tests a second state: it does not pass on the default solution
        expect(solved[step.id].ok, `${lesson.id}.${step.id} on the default solution`).toBe(false);
      }
    }
    const empty = await checkLesson(lesson, newDesign(), run);
    for (const step of lesson.steps) expect(empty[step.id].ok, `${lesson.id}.${step.id} on an empty sheet`).toBe(false);
    if (lesson.starter) {
      const start = await checkLesson(lesson, lesson.starter(), run);
      expect(Object.values(start).filter((r) => r.ok).length, `${lesson.id} starter`).toBeLessThan(lesson.steps.length);
    }
  });

  it('splits steps into structural and simulating ones', () => {
    for (const l of LESSONS) {
      expect([...structuralSteps(l), ...simulatingSteps(l)].sort()).toEqual(l.steps.map((s) => s.id).sort());
    }
    expect(simulatingSteps(getLesson('ohm')!)).toEqual(['loop', 'ammeter']);
  });
});

describe('lesson checkers catch mistakes', () => {
  it("Ohm's law: a 2 kΩ resistor fails the value step and the ammeter reads half the current", async () => {
    const l = getLesson('ohm')!;
    const d = withParam(l.solution(), 'R1', 'value', '2k');
    const r = await checkLesson(l, d, run);
    expect(r.resistor.ok).toBe(false);
    expect(r.resistor.note?.id).toBe('needValue');
    // the loop still follows I = V/R with the learner's values
    expect(r.loop.ok).toBe(true);
    expect(r.loop.note?.params?.value).toBe('4.5 mA');
  });

  it('Ohm: a meter left in V mode is reported', async () => {
    const l = getLesson('ohm')!;
    const r = await stepResult(l, withParam(l.solution(), 'XMM1', 'mode', 'v'), 'ammeter');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('meterMode');
  });

  it('divider: equal resistors read 6 V instead of 4 V', async () => {
    const l = getLesson('divider')!;
    const r = await stepResult(l, withParam(l.solution(), 'R1', 'value', '10k'), 'target');
    expect(r.ok).toBe(false);
    expect(r.note).toEqual({ id: 'measured', params: { value: '6 V', target: '4 V', tol: 3 } });
  });

  it('a circuit without ground is explained as an ERC error before simulating', async () => {
    const l = getLesson('divider')!;
    const d = l.solution();
    for (const s of d.sheets) s.parts = s.parts.filter((p) => p.partId !== 'sources/ground');
    const r = await stepResult(l, d, 'target');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('ercError');
    expect(JSON.parse(String(r.note?.params?.erc)).code).toBe('no-ground');
  });

  it('RC filter: C = 1 µF moves the cut-off to ≈ 99 Hz', async () => {
    const l = getLesson('rc-filter')!;
    const r = await stepResult(l, withParam(l.solution(), 'C1', 'value', '1u'), 'fc');
    expect(r.ok).toBe(false);
    expect(r.note?.params?.value).toBe('99.5 Hz');
  });

  it('RC charging: a pulse shorter than 3τ is refused, the 63 % point follows R·C', async () => {
    const l = getLesson('rc-charge')!;
    expect((await stepResult(l, withParam(l.solution(), 'V1', 'width', '0.1'), 'tau')).note?.id).toBe('note:pulseShort');
    const r = await stepResult(l, withParam(l.solution(), 'R1', 'value', '20k'), 'tau');
    expect(r.ok).toBe(true);
    expect(r.note?.params?.tau).toBe('200 ms');
  });

  it('LED: 100 Ω gives too much current', async () => {
    const l = getLesson('led')!;
    const r = await stepResult(l, withParam(l.solution(), 'R1', 'value', '100'), 'current');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('range');
  });

  it('Zener: a forward-biased Zener is recognised', async () => {
    const l = getLesson('zener')!;
    const d = l.solution();
    for (const s of d.sheets) for (const p of s.parts) if (p.refdes === 'D1') p.rotation = 90;
    const r = await stepResult(l, d, 'regulate');
    expect(r.note?.id).toBe('note:zenerForward');
  });

  it('rectifier: a 10 µF filter leaves too much ripple', async () => {
    const l = getLesson('rectifier')!;
    const r = await stepResult(l, withParam(l.solution(), 'C1', 'value', '10u'), 'filter');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:rippleBig');
  });

  it('BJT switch: a 100 kΩ base resistor does not saturate the transistor', async () => {
    const l = getLesson('bjt-switch')!;
    const r = await stepResult(l, withParam(l.solution(), 'RB', 'value', '100k'), 'on');
    expect(r.ok).toBe(false);
    expect(['note:notSaturated', 'note:ledDim']).toContain(r.note?.id);
  });

  it('CE amplifier: without the bypass capacitor the gain is only about 3', async () => {
    const l = getLesson('ce-amp')!;
    const r = await stepResult(l, l.starter!(), 'gain');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:ceGainLow');
    expect(Number(r.note?.params?.gain)).toBeGreaterThan(2);
    expect(Number(r.note?.params?.gain)).toBeLessThan(5);
  });

  it('op-amp: Rf = 22 kΩ gives a gain of −22, not −10', async () => {
    const l = getLesson('opamp-inverting')!;
    const r = await stepResult(l, withParam(l.solution(), 'RF', 'value', '22k'), 'gain');
    expect(r.ok).toBe(false);
    expect(r.note).toEqual({ id: 'note:gainWrong', params: { gain: '-22.00' } });
  });

  it('555: C = 1 µF runs at ≈ 100 Hz and fails the 1 kHz target', async () => {
    const l = getLesson('timer555')!;
    const r = await stepResult(l, withParam(l.solution(), 'C1', 'value', '1u'), 'frequency');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:freqWrong');
    expect(r.note?.params?.predicted).toBe('98.6 Hz');
  });

  it('flip-flop: D left on Q (no feedback from QN) fails the toggle step', async () => {
    const l = getLesson('flipflop')!;
    const d = l.solution();
    // cut the QN -> D wire
    for (const s of d.sheets) s.wires = s.wires.filter((w) => w.points.length < 5);
    const r = await stepResult(l, d, 'toggle');
    expect(r.note?.id).toBe('note:qnToD');
  });

  it('ADC: a 4 V input gives code 204 and the DAC returns it within 1 LSB', async () => {
    const l = getLesson('adc-dac')!;
    const d = withParam(l.solution(), 'V1', 'value', '4');
    const r = await checkLesson(l, d, run);
    expect(r.code.note?.params?.code).toBe(204);
    expect(r.back.ok).toBe(true);
  });
});

describe('lesson progress', () => {
  it('keeps passed steps, answers and completion; survives a round trip and bad input', () => {
    const l = getLesson('ohm')!;
    let p = emptyProgress();
    p = markPassed(p, 'ohm', ['source', 'resistor']);
    expect(markPassed(p, 'ohm', ['source'])).toBe(p);
    p = markPassed(p, 'ohm', ['loop', 'ammeter']);
    for (const q of l.quiz) p = answerQuiz(p, 'ohm', q.id, q.answer);
    expect(lessonStatus(p, l)).toEqual({ stepsPassed: 4, stepsTotal: 4, quizCorrect: 3, quizTotal: 3, complete: true });
    p = answerQuiz(p, 'ohm', 'double', 0);
    expect(lessonStatus(p, l).complete).toBe(false);
    const back = parseProgress(serializeProgress(p));
    expect(back).toEqual(p);
    expect(lessonStatus(resetLesson(p, 'ohm'), l).stepsPassed).toBe(0);
    expect(parseProgress('{not json')).toEqual(emptyProgress());
    expect(parseProgress(JSON.stringify({ steps: { ohm: [1, 'loop'] }, quiz: { ohm: { a: 'x', b: 2 } } }))).toEqual({ steps: { ohm: ['loop'] }, quiz: { ohm: { b: 2 } } });
  });
});

describe('any meter counts as "a meter"', () => {
  /** The divider lesson circuit measured with `partId` across R2 (pins `hi` -> OUT, `lo` -> ground). */
  function dividerWith(partId: string, params: Record<string, string>, hi: string, lo: string): Design {
    const b = builder('Divider, other meter');
    const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '12' });
    const r1 = b.part('basic/resistor', 'R1', 250, 150, { value: '20k' }, { rotation: 90 });
    const r2 = b.part('basic/resistor', 'R2', 250, 250, { value: '10k' }, { rotation: 90 });
    const m = b.part(partId, 'XDM1', 420, 200, params);
    b.wire(b.pin(v1, '+'), p(100, 120), b.pin(r1, '1'));
    b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
    b.wire(b.pin(r2, '2'), p(250, 320), p(100, 320));
    b.wire(b.pin(v1, '-'), p(100, 320));
    b.part('sources/ground', 'GND1', 100, 320);
    b.label('OUT', 250, 200);
    b.labelPin(m, hi, 'OUT');
    b.labelPin(m, lo, '0');
    return setAnalyses(b.design, 'op', [{ type: 'op' }]);
  }

  for (const [partId, params, hi, lo] of [
    ['instruments/bench-multimeter', { function: 'dcv' }, 'HI', 'LO'],
    ['indicators/voltmeter', {}, '+', '-'],
  ] as const) {
    it(`the divider lesson accepts ${partId} for its meter steps`, async () => {
      const r = await checkLesson(getLesson('divider')!, dividerWith(partId, { ...params }, hi, lo), run, ['meter', 'target']);
      expect({ meter: r.meter.ok, target: r.target.ok, note: r.target.note?.id }).toEqual({ meter: true, target: true, note: 'okValue' });
    });
  }

  it('a bench multimeter set to current is reported as the wrong function', async () => {
    const r = await checkLesson(getLesson('divider')!, dividerWith('instruments/bench-multimeter', { function: 'dci' }, 'HI', 'LO'), run, ['meter']);
    expect({ ok: r.meter.ok, note: r.meter.note?.id }).toEqual({ ok: false, note: 'meterMode' });
  });
});
