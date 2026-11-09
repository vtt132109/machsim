/**
 * Grading of description-box questions (Design.descriptionBox.questions) and lesson quizzes.
 *
 *   gradeAnswer(question, response) -> 'correct' | 'wrong' | 'unanswered' | 'ungraded'
 *   gradeAll(box)                   -> { correct, wrong, unanswered, ungraded, total, results }
 *   normalizeAnswerText(s)          -> lower case, no Vietnamese diacritics, single spaces
 *
 * Number answers use the user number syntax (4.7k, 10m, 2.2M = mega) and also accept a decimal
 * comma ("4,7") as Vietnamese learners write it; a trailing unit ("4.7 kΩ", "3 V") is ignored.
 * The tolerance is relative, in percent (default 5 %); a zero answer needs |response| ≤ 1e-12.
 * Text answers list accepted answers separated by "|" and are compared after normalisation.
 */
import { parseUserNumber } from '../util/units';
import type { DescriptionBox, StudentQuestion } from './types';

export type AnswerGrade = 'correct' | 'wrong' | 'unanswered' | 'ungraded';

/** Default relative tolerance of number answers, percent. */
export const DEFAULT_ANSWER_TOLERANCE = 5;

/** Lower case, without Vietnamese diacritics (đ -> d), trimmed, single spaces, no end punctuation. */
export function normalizeAnswerText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.,;:!?"'()]+|[.,;:!?"'()]+$/g, '')
    .trim();
}

/** A number typed by a student: user syntax, decimal comma accepted. NaN when it is not a number. */
export function parseAnswerNumber(text: string): number {
  let s = text.trim();
  // "4,7" -> "4.7" (a single comma used as the decimal separator); "1,000" stays thousands
  if (/^[+-]?\d+,\d+/.test(s) && !s.includes('.') && !/^[+-]?\d{1,3}(,\d{3})+(\D|$)/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  return parseUserNumber(s);
}

export function gradeAnswer(q: StudentQuestion, response: string | undefined): AnswerGrade {
  const r = (response ?? '').trim();
  if (!r) return 'unanswered';
  const key = q.answer?.trim();
  if (!key) return 'ungraded';
  switch (q.kind) {
    case 'choice':
      return r === key ? 'correct' : 'wrong';
    case 'number': {
      const want = parseAnswerNumber(key);
      const got = parseAnswerNumber(r);
      if (!Number.isFinite(want)) return 'ungraded';
      if (!Number.isFinite(got)) return 'wrong';
      const tol = (q.tolerance ?? DEFAULT_ANSWER_TOLERANCE) / 100;
      const limit = want === 0 ? 1e-12 : Math.abs(want) * tol;
      return Math.abs(got - want) <= limit * (1 + 1e-9) ? 'correct' : 'wrong';
    }
    case 'text': {
      const got = normalizeAnswerText(r);
      return key
        .split('|')
        .map(normalizeAnswerText)
        .filter(Boolean)
        .some((a) => a === got)
        ? 'correct'
        : 'wrong';
    }
  }
}

export interface GradeSummary {
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  ungraded: number;
  results: Record<string, AnswerGrade>;
}

/** Grade every question of a description box against its saved answers. */
export function gradeAll(box: DescriptionBox | undefined): GradeSummary {
  const out: GradeSummary = { total: 0, correct: 0, wrong: 0, unanswered: 0, ungraded: 0, results: {} };
  for (const q of box?.questions ?? []) {
    const g = gradeAnswer(q, box?.answers?.[q.id]);
    out.results[q.id] = g;
    out.total += 1;
    out[g] += 1;
  }
  return out;
}

/** A new question id not used in the box ("q1", "q2" …). */
export function newQuestionId(box: DescriptionBox | undefined): string {
  const used = new Set((box?.questions ?? []).map((q) => q.id));
  for (let i = 1; ; i++) if (!used.has(`q${i}`)) return `q${i}`;
}

/** A new image id not used in the box ("img1" …). */
export function newImageId(box: DescriptionBox | undefined): string {
  const used = new Set((box?.images ?? []).map((q) => q.id));
  for (let i = 1; ; i++) if (!used.has(`img${i}`)) return `img${i}`;
}
