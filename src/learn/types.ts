/**
 * Guided lessons (Help > Lessons): the contract between the lesson definitions (src/learn/lessons),
 * their text (src/i18n/lessons, Vietnamese + English) and the Lessons panel (src/ui/learn).
 *
 * A lesson has a goal, a theory page, steps the app checks automatically on the learner's own
 * circuit, and a short quiz. Each step's `check` inspects the open design through a
 * {@link LessonCircuit} (placed parts, connections, simulated values) and returns a CheckResult;
 * the feedback note is shown under the step ("Đo được 4.21 V; cần 4.00 V ± 3 %").
 * Every lesson has a reference solution (shown with "Xem lời giải"); tests run every check on it.
 */
import type { Design } from '../model/types';
import type { LessonCircuit } from './circuit';

export type LessonLevel = 'basics' | 'semiconductors' | 'amplifiers' | 'digital' | 'automation' | 'workflow';

/** The levels in learning order (sections of the lesson list). */
export const LESSON_LEVELS: readonly LessonLevel[] = ['basics', 'semiconductors', 'amplifiers', 'digital', 'automation', 'workflow'];

/** Names of things the feedback texts mention ({noun} params), localized by src/i18n/lessons. */
export type NounId =
  | 'mcu'
  | 'source'
  | 'acSource'
  | 'pulseSource'
  | 'resistor'
  | 'capacitor'
  | 'diode'
  | 'led'
  | 'zener'
  | 'npn'
  | 'opamp'
  | 'comparator'
  | 'timer'
  | 'andGate'
  | 'probeLight'
  | 'dff'
  | 'clock'
  | 'counter'
  | 'decoder'
  | 'display'
  | 'adc'
  | 'dac'
  | 'meter'
  | 'scope'
  | 'ground';

/** A parameter of a feedback text: a formatted value, or a localized noun. */
export type FeedbackParam = string | number | { noun: NounId };

/**
 * Feedback shown under a step. `id` is a generic text of FEEDBACK (src/i18n/lessons) or
 * `note:<key>`, a lesson-specific text (LessonText.notes[key]).
 */
export interface Feedback {
  id: string;
  params?: Record<string, FeedbackParam>;
}

export interface CheckResult {
  ok: boolean;
  note?: Feedback;
}

/** A step check. May simulate (async); must never throw (the runner reports exceptions as failures). */
export type LessonCheck = (c: LessonCircuit) => CheckResult | Promise<CheckResult>;

export interface LessonStepDef {
  /** unique in the lesson; text key LessonText.steps[id] */
  id: string;
  check: LessonCheck;
  /** the check simulates the circuit (the panel shows "checking…" and runs it after a pause) */
  simulates?: boolean;
}

export interface QuizDef {
  /** unique in the lesson; text key LessonText.quiz[id] */
  id: string;
  /** number of options */
  options: number;
  /** index of the right option */
  answer: number;
}

export interface LessonDef {
  id: string;
  level: LessonLevel;
  steps: LessonStepDef[];
  quiz: QuizDef[];
  /** starting circuit (absent: an empty sheet) */
  starter?: () => Design;
  /** reference solution: every step passes on it (or on its `variants` entry) */
  solution: () => Design;
  /**
   * Steps that test a second state of the circuit (reverse the diode, switch the input off …):
   * the solution variant for that step.
   */
  variants?: Record<string, () => Design>;
}
