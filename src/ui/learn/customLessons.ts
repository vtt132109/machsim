/**
 * Lessons a teacher wrote or loaded from a file, kept on this computer.
 *
 * The lesson files themselves (src/learn/lessonFile.ts) are stored as their JSON text in browser
 * storage under {@link LESSON_FILES_KEY}, so a learner who opened a teacher's lesson still has it
 * after a restart. Every change compiles the files again and hands the result to the lesson
 * registry (src/learn/lessons), which is what the Lessons panel lists.
 *
 *   installCustomLessons();              // once, when the Lessons panel or the editor loads
 *   addCustomLesson(file);               // add / replace by id (the editor and "Open lesson file")
 *   removeCustomLesson(id);
 *   useCustomLessons();                  // React: the list of lesson files
 */
import { useSyncExternalStore } from 'react';
import { compileLessonFile, parseLessonFile, serializeLessonFile, type LessonFile } from '../../learn/lessonFile';
import { setCustomLessons } from '../../learn/lessons';
import { createStore } from '../store/createStore';
import { browserStorage, type KeyValueStorage } from '../app/files';

export const LESSON_FILES_KEY = 'machsim.lessonfiles.v1';

/** The lesson files on this computer, in list order. */
export const customLessonStore = createStore<readonly LessonFile[]>([]);

/** Read the stored lesson files; a damaged entry is skipped rather than losing the others. */
export function readLessonFiles(storage: KeyValueStorage | null): LessonFile[] {
  if (!storage) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(LESSON_FILES_KEY) ?? 'null');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: LessonFile[] = [];
  for (const text of raw) {
    if (typeof text !== 'string') continue;
    const { lesson, errors } = parseLessonFile(text);
    if (!errors.length) out.push(lesson);
  }
  return out;
}

export function writeLessonFiles(storage: KeyValueStorage | null, list: readonly LessonFile[]): void {
  try {
    storage?.setItem(LESSON_FILES_KEY, JSON.stringify(list.map(serializeLessonFile)));
  } catch {
    /* storage full or disabled: the lessons live for this session only */
  }
}

let installed = false;

/** Load the stored lesson files and keep the registry and the storage in step (idempotent). */
export function installCustomLessons(storage: KeyValueStorage | null = browserStorage()): void {
  if (installed) return;
  installed = true;
  customLessonStore.setState(readLessonFiles(storage));
  publish();
  customLessonStore.subscribe(() => {
    publish();
    writeLessonFiles(storage, customLessonStore.getState());
  });
}

function publish(): void {
  setCustomLessons(customLessonStore.getState().map(compileLessonFile));
}

/** Add a lesson file, replacing an earlier one with the same id. */
export function addCustomLesson(file: LessonFile): void {
  const list = customLessonStore.getState();
  const i = list.findIndex((f) => f.id === file.id);
  customLessonStore.setState(i < 0 ? [...list, file] : [...list.slice(0, i), file, ...list.slice(i + 1)]);
}

export function removeCustomLesson(id: string): void {
  customLessonStore.setState(customLessonStore.getState().filter((f) => f.id !== id));
}

export function findCustomLesson(id: string): LessonFile | undefined {
  return customLessonStore.getState().find((f) => f.id === id);
}

/** React hook: the lesson files on this computer. */
export function useCustomLessons(): readonly LessonFile[] {
  return useSyncExternalStore(customLessonStore.subscribe, customLessonStore.getState, customLessonStore.getState);
}
