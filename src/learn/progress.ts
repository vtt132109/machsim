/**
 * Lesson progress of one learner (passed steps, quiz answers), kept per computer in browser
 * storage (key PROGRESS_KEY) by the Lessons panel. Pure state transitions + (de)serialisation;
 * a corrupt stored value reads as empty progress.
 *
 * Steps stay passed once the check succeeded ("sticky"): later steps may change the circuit (an
 * ammeter breaks the loop it measures, the diode is turned round …) without taking the tick away.
 */
import type { LessonDef } from './types';

export const PROGRESS_KEY = 'machsim.lessons.v1';

export interface LessonProgress {
  /** lesson id -> passed step ids */
  steps: Record<string, string[]>;
  /** lesson id -> quiz id -> chosen option */
  quiz: Record<string, Record<string, number>>;
  /** lesson last opened */
  current?: string;
}

export const emptyProgress = (): LessonProgress => ({ steps: {}, quiz: {} });

export function parseProgress(text: string | null | undefined): LessonProgress {
  if (!text) return emptyProgress();
  try {
    const raw = JSON.parse(text) as Partial<LessonProgress>;
    const out = emptyProgress();
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw.steps ?? {})) if (Array.isArray(v)) out.steps[k] = v.filter((x): x is string => typeof x === 'string');
      for (const [k, v] of Object.entries(raw.quiz ?? {})) {
        if (!v || typeof v !== 'object') continue;
        const q: Record<string, number> = {};
        for (const [qk, qv] of Object.entries(v)) if (typeof qv === 'number' && Number.isInteger(qv)) q[qk] = qv;
        out.quiz[k] = q;
      }
      if (typeof raw.current === 'string') out.current = raw.current;
    }
    return out;
  } catch {
    return emptyProgress();
  }
}

export const serializeProgress = (p: LessonProgress): string => JSON.stringify(p);

/** Mark steps passed (returns the same object when nothing is new). */
export function markPassed(p: LessonProgress, lessonId: string, stepIds: string[]): LessonProgress {
  const have = p.steps[lessonId] ?? [];
  const add = stepIds.filter((s) => !have.includes(s));
  if (!add.length) return p;
  return { ...p, steps: { ...p.steps, [lessonId]: [...have, ...add] } };
}

export function answerQuiz(p: LessonProgress, lessonId: string, quizId: string, option: number): LessonProgress {
  return { ...p, quiz: { ...p.quiz, [lessonId]: { ...(p.quiz[lessonId] ?? {}), [quizId]: option } } };
}

export function resetLesson(p: LessonProgress, lessonId: string): LessonProgress {
  const steps = { ...p.steps };
  const quiz = { ...p.quiz };
  delete steps[lessonId];
  delete quiz[lessonId];
  return { ...p, steps, quiz };
}

export function setCurrent(p: LessonProgress, lessonId: string | undefined): LessonProgress {
  return p.current === lessonId ? p : { ...p, current: lessonId };
}

export interface LessonStatus {
  stepsPassed: number;
  stepsTotal: number;
  quizCorrect: number;
  quizTotal: number;
  /** every step passed and every quiz question answered correctly */
  complete: boolean;
}

export function lessonStatus(p: LessonProgress, lesson: LessonDef): LessonStatus {
  const passed = new Set(p.steps[lesson.id] ?? []);
  const answers = p.quiz[lesson.id] ?? {};
  const stepsPassed = lesson.steps.filter((s) => passed.has(s.id)).length;
  const quizCorrect = lesson.quiz.filter((q) => answers[q.id] === q.answer).length;
  return {
    stepsPassed,
    stepsTotal: lesson.steps.length,
    quizCorrect,
    quizTotal: lesson.quiz.length,
    complete: stepsPassed === lesson.steps.length && quizCorrect === lesson.quiz.length,
  };
}
