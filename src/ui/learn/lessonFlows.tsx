/**
 * Lesson-file flows (lazy chunk, loaded by Help > Lesson editor and by the Lessons panel):
 * writing a lesson, reading a lesson file, and exporting / importing lesson progress.
 *
 *   openLessonEditor(id?)        // write a new lesson, or edit one loaded from a file
 *   openLessonFileFlow()         // pick a .msimlesson file and add it to the lesson list
 *   exportProgressFlow()         // write the learner's progress to a .msimprog file
 *   importProgressFlow()         // read one and merge it into the progress on this computer
 */
import { alertDialog, confirmDialog, openCustomDialog, promptText } from '../common/dialogs';
import { exportFile, pickTextFile } from '../app/files';
import { actions } from '../store';
import { t, tr } from '../../i18n';
import { lt } from '../../i18n/learnUi';
import {
  LESSON_EXTENSION,
  PROGRESS_EXTENSION,
  lessonFileName,
  mergeProgress,
  parseLessonFile,
  parseProgressFile,
  serializeLessonFile,
  serializeProgressFile,
  type LessonFile,
  type LessonFileError,
} from '../../learn/lessonFile';
import { addCustomLesson, findCustomLesson, installCustomLessons } from './customLessons';
import { lessonProgress } from './LessonsPanel';
import { LessonEditorDialog } from './LessonEditor';

const errorLines = (errors: readonly LessonFileError[]): string =>
  errors
    .slice(0, 8)
    .map((e) => `${e.path || '?'}: ${lt(`ed.err.${e.code}`)}${e.detail ? ` (${e.detail})` : ''}`)
    .join('\n');

/** Add a lesson to the list on this computer and say so in the Simulation messages. */
function keep(file: LessonFile): void {
  installCustomLessons();
  addCustomLesson(file);
  actions.addSimMessage('info', lt('lessons.fileAdded', { title: tr(file.title) }), 'lessonFile');
}

/** Help > Lesson editor (and "Edit this lesson" in the Lessons panel). */
export function openLessonEditor(lessonId?: string): void {
  installCustomLessons();
  const initial = lessonId ? findCustomLesson(lessonId) : undefined;
  openCustomDialog((close) => (
    <LessonEditorDialog
      initial={initial}
      close={close}
      onSave={(file, write) => {
        close();
        keep(file);
        if (write) void exportFile(lessonFileName(file), serializeLessonFile(file), { name: 'MachSim', extensions: [LESSON_EXTENSION.slice(1)] });
      }}
    />
  ));
}

/** Pick a .msimlesson file and add the lesson it holds to the list. */
export async function openLessonFileFlow(): Promise<void> {
  const f = await pickTextFile([LESSON_EXTENSION, '.json']);
  if (!f) return;
  const { lesson, errors } = parseLessonFile(f.text);
  if (errors.length) {
    await alertDialog({ title: lt('lessons.openFile'), message: `${f.name}\n\n${lt('lessons.fileBad')}\n${errorLines(errors)}` });
    return;
  }
  keep(lesson);
}

/** Write the learner's progress to a file (optionally with their name in it). */
export async function exportProgressFlow(): Promise<void> {
  const name = await promptText({ title: lt('lessons.exportProgress'), label: lt('lessons.learnerName'), initial: '', validate: () => null });
  if (name === null) return;
  const text = serializeProgressFile(lessonProgress.getState(), name);
  await exportFile(`machsim-progress${PROGRESS_EXTENSION}`, text, { name: 'MachSim', extensions: [PROGRESS_EXTENSION.slice(1)] });
}

/** Read a progress file and merge it into the progress on this computer. */
export async function importProgressFlow(): Promise<void> {
  const f = await pickTextFile([PROGRESS_EXTENSION, '.json']);
  if (!f) return;
  const file = parseProgressFile(f.text);
  if (!file) {
    await alertDialog({ title: lt('lessons.importProgress'), message: `${f.name}\n\n${lt('lessons.progressBad')}` });
    return;
  }
  const merged = mergeProgress(lessonProgress.getState(), file.progress);
  lessonProgress.setState(merged);
  actions.addSimMessage('info', lt('lessons.progressImported', { n: Object.keys(merged.steps).length }), 'lessonFile');
}

/** Remove a lesson loaded from a file from the list (after confirmation). */
export async function removeLessonFileFlow(file: LessonFile, remove: (id: string) => void): Promise<void> {
  const ok = await confirmDialog({ title: lt('lessons.removeFile'), message: lt('lessons.removeFileConfirm', { title: tr(file.title) }), okLabel: t('common.delete'), danger: true });
  if (ok) remove(file.id);
}
