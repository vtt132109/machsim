/**
 * Lesson files: lessons a teacher writes inside MachSim (Help > Lesson editor), saved as JSON and
 * loaded back into the Lessons panel.
 *
 *   const { lesson, errors } = parseLessonFile(text);   // validated, with the problems listed
 *   const { def, text } = compileLessonFile(lesson);    // a LessonDef + its bilingual text
 *   serializeLessonFile(lesson)                          // the JSON written to a .msimlesson file
 *
 * A built-in lesson (src/learn/lessons) writes its checks as TypeScript, which a teacher cannot do.
 * A lesson file therefore DESCRIBES its checks with the four kinds a classroom exercise needs:
 *
 *   part       the circuit contains n parts of a kind ("two resistors", "an oscilloscope")
 *   connected  a pin of one kind of part sits on the same net as a pin of another (or on ground)
 *   measure    a measured value is within a tolerance of a target (the meter reading, a named
 *              net's voltage, the current through a part): `tolerancePct` of the target, or the
 *              absolute `toleranceAbs` when the step gives one. The step may choose the analysis
 *              (`analysis`, src/learn/readings.ts): the operating point (the default, and what every
 *              older file means), a transient read like a `.meas` card (the value at a time, the
 *              peak, minimum, peak-to-peak, RMS, mean or frequency of a net's or a part's voltage),
 *              or the AC phasor at one frequency (magnitude, dB, phase). A target of 0 ("the balanced
 *              bridge reads 0 V") is checked against the absolute `ZERO_TOLERANCE` of
 *              src/learn/kit.ts, because a percentage of zero is zero and a real circuit answers
 *              a few nanovolts; write `toleranceAbs` to widen that band.
 *   erc        the electrical rules check finds no error
 *
 * and one quiz question type (multiple choice), exactly like the built-in lessons. Every check is
 * run by the same runner on the learner's own design (src/learn/runner.ts), so an authored lesson
 * behaves in the panel like a built-in one: live step status, feedback with the measured number,
 * hints, progress.
 *
 * Progress files (Export / Import progress, and the copy a project keeps) use the same module:
 * {@link serializeProgressFile} / {@link parseProgressFile}.
 *
 * Nothing here touches the DOM or the simulation engine: the panel injects the runner.
 */
import type { LocalizedText } from '../i18n/core';
import type { LessonStepText, LessonText, QuizText } from '../i18n/lessons';
import { serializeDesign, DesignFormatError } from '../model/serialize';
import { parseDesignSafely } from '../model/sanitize';
import { newDesign, type Design } from '../model/types';
import type { LessonCircuit, PartMatch, PartRef } from './circuit';
import { fail, measured, noun, pass, withSim } from './kit';
import { acReading, AC_READINGS, phasorBetween, readingUnit, TRAN_READINGS, transientReading, type LessonAnalysis } from './readings';
import { LESSON_LEVELS, type CheckResult, type LessonCheck, type LessonDef, type LessonLevel } from './types';
import { emptyProgress, type LessonProgress, parseProgress } from './progress';

export const LESSON_FORMAT = 'machsim-lesson';
export const LESSON_VERSION = 1;
export const LESSON_EXTENSION = '.msimlesson';

export const PROGRESS_FORMAT = 'machsim-lesson-progress';
export const PROGRESS_VERSION = 1;
export const PROGRESS_EXTENSION = '.msimprog';

/** Path a project keeps the learner's lesson progress at (Project dialog). */
export const PROJECT_PROGRESS_PATH = 'lessons/progress.msimprog';

/** Which placed parts a `part` / `connected` / `measure` check looks for. */
export interface LessonPartSpec {
  /** library part ids ("basic/resistor") */
  ids?: string[];
  /** part id prefixes ("misc-digital/and") */
  prefixes?: string[];
  /** library family names ("Resistor", "Op-amp") */
  families?: string[];
  /** virtual instrument kinds ("multimeter") */
  instruments?: string[];
}

/** One end of a `connected` check: a pin of a kind of part, or ground. */
export type LessonEnd = { pin: string; part: LessonPartSpec } | { ground: true };

/** What a `measure` check reads. */
export type LessonProbe =
  /** the reading of the multimeter / voltmeter / ammeter the learner placed */
  | { kind: 'meter' }
  /** the voltage of a net the learner named with a label */
  | { kind: 'net'; net: string }
  /** the voltage across a part of a kind (its first two pins) */
  | { kind: 'partVoltage'; part: LessonPartSpec }
  /** the current through a part of a kind */
  | { kind: 'partCurrent'; part: LessonPartSpec };

export type LessonCheckSpec =
  | { kind: 'part'; part: LessonPartSpec; count?: number }
  | { kind: 'connected'; from: LessonEnd; to: LessonEnd }
  | { kind: 'measure'; probe: LessonProbe; target: number; tolerancePct: number; unit: string; toleranceAbs?: number; analysis?: LessonAnalysis }
  | { kind: 'erc' };

export interface LessonFileStep {
  id: string;
  task: LocalizedText;
  hint: LocalizedText;
  check: LessonCheckSpec;
}

export interface LessonFileQuiz {
  id: string;
  question: LocalizedText;
  options: LocalizedText[];
  /** index of the right option */
  answer: number;
  why: LocalizedText;
}

export interface LessonFile {
  format: typeof LESSON_FORMAT;
  version: typeof LESSON_VERSION;
  /** unique id; the progress of a lesson is stored under it */
  id: string;
  level: LessonLevel;
  title: LocalizedText;
  goal: LocalizedText;
  /** MachSim markup (src/model/richText.ts), with $formulas$ */
  theory: LocalizedText;
  steps: LessonFileStep[];
  quiz: LessonFileQuiz[];
  /** who wrote it (shown in the lesson list) */
  author?: string;
  /** the circuit the lesson starts from, as .msim text */
  starter?: string;
  /** the reference solution, as .msim text */
  solution?: string;
}

/** A problem with a lesson file: where it is and what is wrong (rendered by src/i18n/learnUi.ts). */
export interface LessonFileError {
  /** JSON path, e.g. "steps[2].check.target" */
  path: string;
  code: 'missing' | 'type' | 'empty' | 'range' | 'duplicate' | 'unknown' | 'format' | 'design' | 'combination';
  /** extra detail (the value found, the design error) */
  detail?: string;
}

// ---------------------------------------------------------------------------------------------
// an empty lesson (the editor starts from this)

export function newLessonFile(id = 'lesson-1'): LessonFile {
  return {
    format: LESSON_FORMAT,
    version: LESSON_VERSION,
    id,
    level: 'basics',
    title: { vi: '', en: '' },
    goal: { vi: '', en: '' },
    theory: { vi: '', en: '' },
    steps: [],
    quiz: [],
  };
}

/** An empty check of a kind (the editor uses it when a step's kind changes). */
export function newCheckSpec(kind: LessonCheckSpec['kind']): LessonCheckSpec {
  switch (kind) {
    case 'part':
      return { kind: 'part', part: { families: ['Resistor'] }, count: 1 };
    case 'connected':
      return { kind: 'connected', from: { pin: '1', part: { families: ['Resistor'] } }, to: { ground: true } };
    case 'measure':
      return { kind: 'measure', probe: { kind: 'meter' }, target: 5, tolerancePct: 5, unit: 'V' };
    default:
      return { kind: 'erc' };
  }
}

// ---------------------------------------------------------------------------------------------
// validation

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;

class Validator {
  readonly errors: LessonFileError[] = [];

  err(path: string, code: LessonFileError['code'], detail?: string): void {
    this.errors.push(detail === undefined ? { path, code } : { path, code, detail });
  }

  /** A {vi, en} pair; both languages are required so the panel can show either. */
  text(v: unknown, path: string, required = true): LocalizedText {
    if (typeof v !== 'object' || v === null) {
      if (required) this.err(path, 'missing');
      return { vi: '', en: '' };
    }
    const o = v as Record<string, unknown>;
    const out = { vi: typeof o.vi === 'string' ? o.vi.trim() : '', en: typeof o.en === 'string' ? o.en.trim() : '' };
    if (typeof o.vi !== 'string' || typeof o.en !== 'string') this.err(path, 'type');
    else if (required && (!out.vi || !out.en)) this.err(path, 'empty');
    return out;
  }

  strings(v: unknown, path: string): string[] | undefined {
    if (v === undefined) return undefined;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      this.err(path, 'type');
      return undefined;
    }
    const out = (v as string[]).map((x) => x.trim()).filter(Boolean);
    return out.length ? out : undefined;
  }

  part(v: unknown, path: string): LessonPartSpec {
    if (typeof v !== 'object' || v === null) {
      this.err(path, 'missing');
      return {};
    }
    const o = v as Record<string, unknown>;
    const spec: LessonPartSpec = {};
    for (const k of ['ids', 'prefixes', 'families', 'instruments'] as const) {
      const list = this.strings(o[k], `${path}.${k}`);
      if (list) spec[k] = list;
    }
    if (!Object.keys(spec).length) this.err(path, 'empty');
    return spec;
  }

  end(v: unknown, path: string): LessonEnd {
    if (typeof v !== 'object' || v === null) {
      this.err(path, 'missing');
      return { ground: true };
    }
    const o = v as Record<string, unknown>;
    if (o.ground === true) return { ground: true };
    const pin = typeof o.pin === 'string' ? o.pin.trim() : '';
    if (!pin) this.err(`${path}.pin`, 'empty');
    return { pin, part: this.part(o.part, `${path}.part`) };
  }

  probe(v: unknown, path: string): LessonProbe {
    if (typeof v !== 'object' || v === null) {
      this.err(path, 'missing');
      return { kind: 'meter' };
    }
    const o = v as Record<string, unknown>;
    switch (o.kind) {
      case 'meter':
        return { kind: 'meter' };
      case 'net': {
        const net = typeof o.net === 'string' ? o.net.trim() : '';
        if (!net) this.err(`${path}.net`, 'empty');
        return { kind: 'net', net };
      }
      case 'partVoltage':
      case 'partCurrent':
        return { kind: o.kind, part: this.part(o.part, `${path}.part`) };
      default:
        this.err(`${path}.kind`, 'unknown', String(o.kind));
        return { kind: 'meter' };
    }
  }

  /** The analysis of a `measure` step: absent or 'op' (the operating point), a transient or an AC phasor. */
  analysis(v: unknown, path: string): LessonAnalysis | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'object') {
      this.err(path, 'type');
      return undefined;
    }
    const o = v as Record<string, unknown>;
    const seconds = (key: string, required: boolean, max = 1000): number | undefined => {
      if (o[key] === undefined || o[key] === null) {
        if (required) this.err(`${path}.${key}`, 'missing');
        return undefined;
      }
      const n = Number(o[key]);
      if (!Number.isFinite(n) || n < 0 || n > max) {
        this.err(`${path}.${key}`, 'range', String(o[key]));
        return undefined;
      }
      return n;
    };
    switch (o.kind) {
      case 'op':
        return { kind: 'op' };
      case 'tran': {
        const tstop = seconds('tstop', true, 100);
        if (tstop !== undefined && !(tstop > 0)) this.err(`${path}.tstop`, 'range', String(o.tstop));
        const reading = TRAN_READINGS.find((r) => r === o.reading);
        if (!reading) this.err(`${path}.reading`, o.reading === undefined ? 'missing' : 'unknown', String(o.reading));
        const at = seconds('at', reading === 'at', 100);
        const from = seconds('from', false, 100);
        if (tstop !== undefined && at !== undefined && at > tstop) this.err(`${path}.at`, 'range', String(o.at));
        if (tstop !== undefined && from !== undefined && from >= tstop) this.err(`${path}.from`, 'range', String(o.from));
        return { kind: 'tran', tstop: tstop !== undefined && tstop > 0 ? tstop : 1e-3, reading: reading ?? 'final', ...(at !== undefined ? { at } : {}), ...(from !== undefined && from > 0 ? { from } : {}) };
      }
      case 'ac': {
        const freq = Number(o.freq);
        if (!Number.isFinite(freq) || freq <= 0 || freq > 1e12) this.err(`${path}.freq`, o.freq === undefined ? 'missing' : 'range', String(o.freq));
        const reading = AC_READINGS.find((r) => r === o.reading);
        if (!reading) this.err(`${path}.reading`, o.reading === undefined ? 'missing' : 'unknown', String(o.reading));
        return { kind: 'ac', freq: Number.isFinite(freq) && freq > 0 ? freq : 1e3, reading: reading ?? 'mag' };
      }
      default:
        this.err(`${path}.kind`, 'unknown', String(o.kind));
        return undefined;
    }
  }

  check(v: unknown, path: string): LessonCheckSpec {
    if (typeof v !== 'object' || v === null) {
      this.err(path, 'missing');
      return { kind: 'erc' };
    }
    const o = v as Record<string, unknown>;
    switch (o.kind) {
      case 'part': {
        const count = o.count === undefined ? 1 : Number(o.count);
        if (!Number.isInteger(count) || count < 1 || count > 99) this.err(`${path}.count`, 'range', String(o.count));
        return { kind: 'part', part: this.part(o.part, `${path}.part`), count: Number.isInteger(count) && count >= 1 ? count : 1 };
      }
      case 'connected':
        return { kind: 'connected', from: this.end(o.from, `${path}.from`), to: this.end(o.to, `${path}.to`) };
      case 'measure': {
        const target = Number(o.target);
        const tol = o.tolerancePct === undefined ? 5 : Number(o.tolerancePct);
        const abs = o.toleranceAbs === undefined || o.toleranceAbs === null ? undefined : Number(o.toleranceAbs);
        if (!Number.isFinite(target)) this.err(`${path}.target`, 'type', String(o.target));
        if (!Number.isFinite(tol) || tol <= 0 || tol > 100) this.err(`${path}.tolerancePct`, 'range', String(o.tolerancePct));
        if (abs !== undefined && (!Number.isFinite(abs) || abs < 0)) this.err(`${path}.toleranceAbs`, 'range', String(o.toleranceAbs));
        const probe = this.probe(o.probe, `${path}.probe`);
        const analysis = this.analysis(o.analysis, `${path}.analysis`);
        // a transient or AC reading is a voltage of a net or across a part: a meter reading and a
        // part current exist at the operating point only
        if (analysis && analysis.kind !== 'op' && (probe.kind === 'meter' || probe.kind === 'partCurrent')) this.err(`${path}.analysis`, 'combination', probe.kind);
        return {
          kind: 'measure',
          probe,
          target: Number.isFinite(target) ? target : 0,
          tolerancePct: Number.isFinite(tol) && tol > 0 && tol <= 100 ? tol : 5,
          unit: typeof o.unit === 'string' ? o.unit.trim() : '',
          ...(abs !== undefined && Number.isFinite(abs) && abs > 0 ? { toleranceAbs: abs } : {}),
          ...(analysis && analysis.kind !== 'op' ? { analysis } : {}),
        };
      }
      case 'erc':
        return { kind: 'erc' };
      default:
        this.err(`${path}.kind`, 'unknown', String(o.kind));
        return { kind: 'erc' };
    }
  }

  design(v: unknown, path: string): string | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') {
      this.err(path, 'type');
      return undefined;
    }
    try {
      // the integrity layer repairs references a teacher's exported design may carry
      parseDesignSafely(v);
      return v;
    } catch (e) {
      this.err(path, 'design', e instanceof DesignFormatError ? e.message : e instanceof Error ? e.message : String(e));
      return undefined;
    }
  }
}

/**
 * Read a lesson from JSON text. The lesson comes back even when there are problems (the editor
 * shows them next to the fields); `errors` is empty only for a file that is ready to use.
 */
export function parseLessonFile(text: string): { lesson: LessonFile; errors: LessonFileError[] } {
  const v = new Validator();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    v.err('', 'format', e instanceof Error ? e.message : String(e));
    return { lesson: newLessonFile(), errors: v.errors };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    v.err('', 'format');
    return { lesson: newLessonFile(), errors: v.errors };
  }
  const o = raw as Record<string, unknown>;
  if (o.format !== LESSON_FORMAT) v.err('format', 'format', String(o.format));
  if (o.version !== LESSON_VERSION) v.err('version', 'range', String(o.version));
  const id = typeof o.id === 'string' ? o.id.trim() : '';
  if (!ID_RE.test(id)) v.err('id', id ? 'type' : 'missing', id);
  const level = (LESSON_LEVELS as readonly string[]).includes(String(o.level)) ? (o.level as LessonLevel) : 'basics';
  if (!(LESSON_LEVELS as readonly string[]).includes(String(o.level))) v.err('level', 'unknown', String(o.level));

  const steps: LessonFileStep[] = [];
  const stepIds = new Set<string>();
  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  if (!Array.isArray(o.steps)) v.err('steps', 'type');
  else if (!rawSteps.length) v.err('steps', 'empty');
  rawSteps.forEach((s, i) => {
    const path = `steps[${i}]`;
    const so = (typeof s === 'object' && s !== null ? s : {}) as Record<string, unknown>;
    const sid = typeof so.id === 'string' ? so.id.trim() : '';
    if (!ID_RE.test(sid)) v.err(`${path}.id`, sid ? 'type' : 'missing', sid);
    else if (stepIds.has(sid)) v.err(`${path}.id`, 'duplicate', sid);
    stepIds.add(sid);
    steps.push({
      id: sid || `step${i + 1}`,
      task: v.text(so.task, `${path}.task`),
      hint: v.text(so.hint, `${path}.hint`, false),
      check: v.check(so.check, `${path}.check`),
    });
  });

  const quiz: LessonFileQuiz[] = [];
  const quizIds = new Set<string>();
  const rawQuiz = Array.isArray(o.quiz) ? o.quiz : [];
  if (o.quiz !== undefined && !Array.isArray(o.quiz)) v.err('quiz', 'type');
  rawQuiz.forEach((q, i) => {
    const path = `quiz[${i}]`;
    const qo = (typeof q === 'object' && q !== null ? q : {}) as Record<string, unknown>;
    const qid = typeof qo.id === 'string' ? qo.id.trim() : '';
    if (!ID_RE.test(qid)) v.err(`${path}.id`, qid ? 'type' : 'missing', qid);
    else if (quizIds.has(qid)) v.err(`${path}.id`, 'duplicate', qid);
    quizIds.add(qid);
    const options = Array.isArray(qo.options) ? qo.options.map((x, k) => v.text(x, `${path}.options[${k}]`)) : [];
    if (options.length < 2) v.err(`${path}.options`, 'empty', String(options.length));
    const answer = Number(qo.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer >= Math.max(options.length, 1)) v.err(`${path}.answer`, 'range', String(qo.answer));
    quiz.push({
      id: qid || `q${i + 1}`,
      question: v.text(qo.question, `${path}.question`),
      options,
      answer: Number.isInteger(answer) && answer >= 0 && answer < options.length ? answer : 0,
      why: v.text(qo.why, `${path}.why`, false),
    });
  });

  const lesson: LessonFile = {
    format: LESSON_FORMAT,
    version: LESSON_VERSION,
    id: id || 'lesson',
    level,
    title: v.text(o.title, 'title'),
    goal: v.text(o.goal, 'goal'),
    theory: v.text(o.theory, 'theory', false),
    steps,
    quiz,
  };
  if (typeof o.author === 'string' && o.author.trim()) lesson.author = o.author.trim();
  const starter = v.design(o.starter, 'starter');
  if (starter) lesson.starter = starter;
  const solution = v.design(o.solution, 'solution');
  if (solution) lesson.solution = solution;
  return { lesson, errors: v.errors };
}

/** The JSON text of a lesson file (stable key order, so a round trip is byte for byte). */
export function serializeLessonFile(lesson: LessonFile): string {
  const out: Record<string, unknown> = {
    format: LESSON_FORMAT,
    version: LESSON_VERSION,
    id: lesson.id,
    level: lesson.level,
  };
  if (lesson.author) out.author = lesson.author;
  out.title = { vi: lesson.title.vi, en: lesson.title.en };
  out.goal = { vi: lesson.goal.vi, en: lesson.goal.en };
  out.theory = { vi: lesson.theory.vi, en: lesson.theory.en };
  out.steps = lesson.steps.map((s) => ({ id: s.id, task: { vi: s.task.vi, en: s.task.en }, hint: { vi: s.hint.vi, en: s.hint.en }, check: s.check }));
  out.quiz = lesson.quiz.map((q) => ({ id: q.id, question: { vi: q.question.vi, en: q.question.en }, options: q.options.map((o) => ({ vi: o.vi, en: o.en })), answer: q.answer, why: { vi: q.why.vi, en: q.why.en } }));
  if (lesson.starter) out.starter = lesson.starter;
  if (lesson.solution) out.solution = lesson.solution;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** A file name for a lesson ("dien-tro.msimlesson"). */
export function lessonFileName(lesson: LessonFile): string {
  return `${lesson.id.replace(/[^A-Za-z0-9_-]+/g, '-') || 'lesson'}${LESSON_EXTENSION}`;
}

// ---------------------------------------------------------------------------------------------
// compiling the checks

const toMatch = (spec: LessonPartSpec): PartMatch => ({
  ...(spec.ids ? { ids: spec.ids } : {}),
  ...(spec.prefixes ? { prefixes: spec.prefixes } : {}),
  ...(spec.families ? { families: spec.families } : {}),
  ...(spec.instruments ? { instruments: spec.instruments as PartMatch['instruments'] } : {}),
});

/** Text of a part specification, for the feedback ("basic/resistor", "Resistor"). */
export function partSpecText(spec: LessonPartSpec): string {
  return [...(spec.ids ?? []), ...(spec.prefixes ?? []), ...(spec.families ?? []), ...(spec.instruments ?? [])].join(', ');
}

/** The nets an end of a `connected` check sits on (ground is the single node "0"). */
function endNets(c: LessonCircuit, end: LessonEnd): string[] {
  if ('ground' in end) return ['0'];
  const out: string[] = [];
  for (const ref of c.parts(toMatch(end.part))) {
    const n = c.net(ref, end.pin);
    if (n) out.push(n);
  }
  return out;
}

function firstPart(c: LessonCircuit, spec: LessonPartSpec): PartRef | undefined {
  return c.parts(toMatch(spec))[0];
}

/** The `check` function of a described step. */
export function compileCheck(spec: LessonCheckSpec): LessonCheck {
  switch (spec.kind) {
    case 'part': {
      const want = spec.count ?? 1;
      return (c) => {
        const found = c.parts(toMatch(spec.part)).length;
        return found >= want ? pass() : fail('note:filePart', { part: partSpecText(spec.part), n: want, have: found });
      };
    }
    case 'connected':
      return (c) => {
        const a = endNets(c, spec.from);
        const b = endNets(c, spec.to);
        if (!a.length || !b.length) return fail('note:fileConnectMissing', { from: endText(spec.from), to: endText(spec.to) });
        return a.some((x) => b.includes(x)) ? pass() : fail('note:fileConnect', { from: endText(spec.from), to: endText(spec.to) });
      };
    case 'erc':
      return (c) => {
        // an empty sheet has no errors either, which would be a free pass
        if (!c.design.sheets.some((s) => s.parts.length)) return fail('note:fileErcEmpty');
        const errs = c.ercErrors();
        return errs.length ? fail('ercError', { erc: JSON.stringify(errs[0]) }) : pass('note:fileErcOk');
      };
    default: {
      const analysis = spec.analysis;
      if (analysis && analysis.kind !== 'op') return (c) => withSim(c, () => measureOther(c, spec, analysis));
      return (c) =>
        withSim(c, async () => {
          const op = await c.op();
          const p = spec.probe;
          if (p.kind === 'meter') {
            const m = c.meter(op);
            if (!m) return fail('needPart', { part: noun('meter') });
            return measured(m.value, spec.target, spec.tolerancePct, spec.unit, spec.toleranceAbs);
          }
          if (p.kind === 'net') {
            const node = c.namedNet(p.net);
            if (!node) return fail('note:fileNet', { net: p.net });
            return measured(op.v(node), spec.target, spec.tolerancePct, spec.unit, spec.toleranceAbs);
          }
          const ref = firstPart(c, p.part);
          if (!ref) return fail('note:filePart', { part: partSpecText(p.part), n: 1, have: 0 });
          const value = p.kind === 'partCurrent' ? c.current(op, ref) : op.vd(...(c.pinNets(ref).slice(0, 2) as [string, string]));
          return measured(value, spec.target, spec.tolerancePct, spec.unit, spec.toleranceAbs);
        });
    }
  }
}

/** The two nets a transient / AC step reads between: a named net against ground, or across a part. */
function readingNets(c: LessonCircuit, p: LessonProbe): { pos: string; neg: string } | CheckResult {
  if (p.kind === 'net') {
    const node = c.namedNet(p.net);
    return node ? { pos: node, neg: '0' } : fail('note:fileNet', { net: p.net });
  }
  if (p.kind === 'partVoltage') {
    const ref = firstPart(c, p.part);
    if (!ref) return fail('note:filePart', { part: partSpecText(p.part), n: 1, have: 0 });
    const [pos, neg] = c.pinNets(ref).slice(0, 2);
    return pos === undefined || neg === undefined ? fail('note:filePart', { part: partSpecText(p.part), n: 1, have: 0 }) : { pos, neg };
  }
  return fail('note:fileReadingProbe');
}

/** A `measure` step that runs a transient or an AC analysis (see src/learn/readings.ts). */
async function measureOther(c: LessonCircuit, spec: Extract<LessonCheckSpec, { kind: 'measure' }>, analysis: Exclude<LessonAnalysis, { kind: 'op' }>): Promise<CheckResult> {
  const nets = readingNets(c, spec.probe);
  if ('ok' in nets) return nets;
  const unit = spec.unit || readingUnit(analysis);
  let value: number;
  if (analysis.kind === 'tran') {
    const sim = await c.tran(analysis.tstop);
    const r = transientReading(sim.result, nets.pos, nets.neg, analysis);
    if (r.error && !Number.isFinite(r.value)) return fail('note:fileReading', { reading: analysis.reading, message: r.error });
    value = r.value;
  } else {
    const sim = await c.acAt(analysis.freq);
    const phasor = phasorBetween(sim.result, nets.pos, nets.neg);
    if (!phasor) return fail('note:fileReading', { reading: analysis.reading, message: 'no such signal' });
    value = acReading(phasor, analysis.reading);
  }
  return measured(value, spec.target, spec.tolerancePct, unit, spec.toleranceAbs);
}

const endText = (end: LessonEnd): string => ('ground' in end ? '0' : `${partSpecText(end.part)}.${end.pin}`);

/** A described check simulates the circuit (the panel runs those after a pause). */
export const checkSimulates = (spec: LessonCheckSpec): boolean => spec.kind === 'measure';

/** A lesson file turned into what the panel needs: the definition and its bilingual text. */
export interface CompiledLesson {
  def: LessonDef;
  text: LessonText;
  file: LessonFile;
}

function designOf(text: string | undefined, title: string): Design {
  if (!text) return newDesign(title);
  try {
    return parseDesignSafely(text).design;
  } catch {
    return newDesign(title);
  }
}

/**
 * Compile a lesson file. Call it on a lesson that `parseLessonFile` accepted; a lesson with
 * problems still compiles (the broken steps simply never pass), so the editor can preview it.
 */
export function compileLessonFile(file: LessonFile): CompiledLesson {
  const def: LessonDef = {
    id: file.id,
    level: file.level,
    steps: file.steps.map((s) => ({ id: s.id, check: compileCheck(s.check), ...(checkSimulates(s.check) ? { simulates: true as const } : {}) })),
    quiz: file.quiz.map((q) => ({ id: q.id, options: q.options.length, answer: q.answer })),
    solution: () => designOf(file.solution, file.title.vi || file.id),
    ...(file.starter ? { starter: () => designOf(file.starter, file.title.vi || file.id) } : {}),
  };
  const steps: Record<string, LessonStepText> = {};
  for (const s of file.steps) steps[s.id] = { task: s.task, hint: s.hint };
  const quiz: Record<string, QuizText> = {};
  for (const q of file.quiz) quiz[q.id] = { q: q.question, options: q.options, why: q.why };
  return { def, text: { title: file.title, goal: file.goal, theory: file.theory, steps, quiz }, file };
}

/** True when the lesson carries a reference solution the panel can open. */
export const hasSolution = (file: LessonFile): boolean => !!file.solution;

/** The open design as a lesson's starter / solution text. */
export const designText = (d: Design): string => serializeDesign(d);

// ---------------------------------------------------------------------------------------------
// progress files

export interface ProgressFile {
  format: typeof PROGRESS_FORMAT;
  version: typeof PROGRESS_VERSION;
  /** who the progress belongs to (a learner writes their name before handing it in) */
  learner?: string;
  /** ISO 8601 */
  saved?: string;
  progress: LessonProgress;
}

/** The JSON of a progress file (Lessons panel: Export progress; the project copy). */
export function serializeProgressFile(progress: LessonProgress, learner?: string, now: Date = new Date()): string {
  const out: ProgressFile = { format: PROGRESS_FORMAT, version: PROGRESS_VERSION, saved: now.toISOString(), progress };
  if (learner?.trim()) out.learner = learner.trim();
  return `${JSON.stringify(out, null, 2)}\n`;
}

/**
 * Read a progress file. Returns null when the text is not one (a damaged or foreign file is
 * reported to the learner instead of silently replacing their progress).
 */
export function parseProgressFile(text: string): ProgressFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.format !== PROGRESS_FORMAT || o.version !== PROGRESS_VERSION) return null;
  const progress = o.progress === undefined ? emptyProgress() : parseProgress(JSON.stringify(o.progress));
  const out: ProgressFile = { format: PROGRESS_FORMAT, version: PROGRESS_VERSION, progress };
  if (typeof o.learner === 'string' && o.learner.trim()) out.learner = o.learner.trim();
  if (typeof o.saved === 'string') out.saved = o.saved;
  return out;
}

/**
 * Merge an imported progress into the one on this computer: a step that is passed in either copy
 * stays passed, and an answer of the imported copy wins (it is the newer hand-in).
 */
export function mergeProgress(current: LessonProgress, incoming: LessonProgress): LessonProgress {
  const steps: Record<string, string[]> = { ...current.steps };
  for (const [lesson, list] of Object.entries(incoming.steps)) {
    steps[lesson] = [...new Set([...(steps[lesson] ?? []), ...list])];
  }
  const quiz: Record<string, Record<string, number>> = {};
  for (const [lesson, answers] of Object.entries(current.quiz)) quiz[lesson] = { ...answers };
  for (const [lesson, answers] of Object.entries(incoming.quiz)) quiz[lesson] = { ...(quiz[lesson] ?? {}), ...answers };
  return { ...current, steps, quiz, ...(incoming.current ? { current: incoming.current } : {}) };
}

/** Guard used by the file dialogs: is this text a lesson file rather than a progress file? */
export function isLessonFileText(text: string): boolean {
  return /"format"\s*:\s*"machsim-lesson"/.test(text);
}
