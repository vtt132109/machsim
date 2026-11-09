/**
 * The guided lessons, in learning order: basics (Ohm's law … RC filter), semiconductors (diode …
 * common-emitter amplifier), op-amps and timers, digital (gates … ADC / DAC, an 8051 blinking an
 * LED).
 */
import type { LessonDef } from '../types';
import { LESSON_LEVELS } from '../types';
import type { CompiledLesson } from '../lessonFile';
import type { LessonText } from '../../i18n/lessons';
import { LESSON_TEXT } from '../../i18n/lessons';
import { divider, kirchhoff, ohm, rcCharge, rcFilter, seriesParallel } from './basics';
import { bjtSwitch, ceAmp, diode, led, rectifier, zener } from './semis';
import { comparator, opampInverting, opampNonInverting, timer555 } from './amps';
import { adcDac, counter7seg, flipflop, logicGates } from './digital';
import { mcuBlink } from './mcu';
import { ladderStartStop } from './ladder';
import { hysteresisBlock, icPackage, ladderTraffic, mcuButton, measRise, rcStages, realCapacitor, realFlipflop, transferBlock, variantBoards } from './round3';
import { blockMeters, dualOpamp, mcuDebug, printHandout, stepSweep } from './round4';
import { audioFilter, batteryRuntime, relayLatch, scriptSweep } from './round4b';

export const LESSONS: readonly LessonDef[] = [
  ohm,
  divider,
  seriesParallel,
  kirchhoff,
  rcCharge,
  rcFilter,
  realCapacitor,
  diode,
  led,
  zener,
  rectifier,
  bjtSwitch,
  ceAmp,
  opampInverting,
  opampNonInverting,
  comparator,
  timer555,
  hysteresisBlock,
  transferBlock,
  logicGates,
  flipflop,
  icPackage,
  realFlipflop,
  counter7seg,
  adcDac,
  mcuBlink,
  mcuButton,
  ladderStartStop,
  ladderTraffic,
  rcStages,
  variantBoards,
  measRise,
  printHandout,
  blockMeters,
  stepSweep,
  dualOpamp,
  mcuDebug,
  relayLatch,
  audioFilter,
  batteryRuntime,
  scriptSweep,
];

export { LESSON_LEVELS };

/**
 * Lessons a teacher wrote in the app and loaded from files (src/learn/lessonFile.ts). They are
 * registered by the Lessons panel (src/ui/learn/customLessons.ts) and behave exactly like the
 * built-in ones; the built-ins always come first in a level.
 */
let custom: readonly CompiledLesson[] = [];

/** Replace the lessons loaded from files (the panel calls this whenever the file list changes). */
export function setCustomLessons(list: readonly CompiledLesson[]): void {
  const seen = new Set(LESSONS.map((l) => l.id));
  const out: CompiledLesson[] = [];
  for (const c of list) {
    if (seen.has(c.def.id)) continue;
    seen.add(c.def.id);
    out.push(c);
  }
  custom = out;
}

/** The lessons loaded from files, in list order. */
export function customLessons(): readonly CompiledLesson[] {
  return custom;
}

/** Every lesson the panel lists: the built-in ones, then the ones loaded from files. */
export function allLessons(): readonly LessonDef[] {
  return custom.length ? [...LESSONS, ...custom.map((c) => c.def)] : LESSONS;
}

export function getLesson(id: string): LessonDef | undefined {
  return LESSONS.find((l) => l.id === id) ?? custom.find((c) => c.def.id === id)?.def;
}

/** Text of a lesson (built-in: the i18n catalogue; from a file: the file's own text). */
export function lessonTextOf(id: string): LessonText | undefined {
  return LESSON_TEXT[id] ?? custom.find((c) => c.def.id === id)?.text;
}

/** The lesson after `id` in learning order (undefined after the last one). */
export function nextLesson(id: string): LessonDef | undefined {
  const list = allLessons();
  const i = list.findIndex((l) => l.id === id);
  return i >= 0 ? list[i + 1] : undefined;
}
