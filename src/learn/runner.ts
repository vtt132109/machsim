/**
 * Runs the step checks of a lesson on a design.
 *
 *   const results = await checkLesson(lesson, design, runAnalyses);   // stepId -> CheckResult
 *   checkStructure(lesson, design, run)                                // only the non-simulating steps
 *
 * A check that throws is reported as a failed step with the error text (feedback 'internal'),
 * so one broken check never stops the others. Simulations are shared between the steps of one
 * run (LessonCircuit memoises them).
 */
import type { Design } from '../model/types';
import { LessonCircuit, type RunFn } from './circuit';
import type { CheckResult, LessonDef, LessonStepDef } from './types';

async function runStep(step: LessonStepDef, c: LessonCircuit): Promise<CheckResult> {
  try {
    return await step.check(c);
  } catch (e) {
    return { ok: false, note: { id: 'internal', params: { message: e instanceof Error ? e.message : String(e) } } };
  }
}

/** Check the given steps (default: all) of a lesson; results by step id. */
export async function checkLesson(lesson: LessonDef, design: Design, run: RunFn, only?: readonly string[]): Promise<Record<string, CheckResult>> {
  const c = new LessonCircuit(design, run);
  const out: Record<string, CheckResult> = {};
  for (const step of lesson.steps) {
    if (only && !only.includes(step.id)) continue;
    out[step.id] = await runStep(step, c);
  }
  return out;
}

/** Ids of the steps that inspect the drawing only (fast: run on every edit). */
export function structuralSteps(lesson: LessonDef): string[] {
  return lesson.steps.filter((s) => !s.simulates).map((s) => s.id);
}

/** Ids of the steps that simulate the circuit (run after a pause, or with "Check now"). */
export function simulatingSteps(lesson: LessonDef): string[] {
  return lesson.steps.filter((s) => s.simulates).map((s) => s.id);
}
