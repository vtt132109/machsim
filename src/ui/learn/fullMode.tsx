/**
 * "Bật chế độ đầy đủ" notice for lesson texts that name a command beginner mode hides.
 *
 * Beginner mode is what the Welcome panel and Getting Started put a first-time learner in, and the
 * Lessons panel is the main thing that learner does. Some lessons are *about* the professional
 * tools (the bill of materials of an assembly variant, the 555 wizard), so their text points at a
 * menu the simplified interface does not show. Instead of leaving the learner looking for a menu
 * that is not there, the lesson page says so and offers one click that switches the full interface
 * on (the same command as Options › Chế độ người mới and the status-bar cell).
 *
 *   lessonHiddenCommands(text)            command ids the lesson text names that beginner mode hides
 *   <FullModeNotice commands=… lang=… />  the notice (renders nothing when the list is empty or
 *                                          the learner is already in full mode)
 */
import { beginnerCommand, menuPathsIn } from '../app/beginner';
import { buildMenus, type MenuContext } from '../app/menus';
import { runCommand } from '../app/extensions';
import { getState, useEditor } from '../store';
import type { LessonText } from '../../i18n/lessons';
import { lt } from '../../i18n/learnUi';
import { t, tDynamic, type Lang } from '../../i18n';

/** A menu model good enough to resolve labels (every command counted as available). */
function labelMenus(): ReturnType<typeof buildMenus> {
  const ctx: MenuContext = {
    state: getState(),
    has: () => true,
    run: () => undefined,
    recent: [],
    openRecent: () => undefined,
    clearRecent: () => undefined,
    setAnalysis: () => undefined,
    setTheme: () => undefined,
    setActiveSheet: () => undefined,
    setVariant: () => undefined,
    simulationConnected: true,
  };
  return buildMenus(ctx);
}

/** Every line of a lesson text, both languages (the learner may read either). */
function allWords(text: LessonText): string {
  const parts: string[] = [text.theory.vi, text.theory.en, text.goal.vi, text.goal.en];
  for (const s of Object.values(text.steps)) parts.push(s.task.vi, s.task.en, s.hint.vi, s.hint.en);
  return parts.join('\n');
}

/**
 * Command ids this lesson text tells the learner to use that beginner mode hides, in the order
 * they appear (duplicates removed). Submenu ids ('menu.…') are not commands and never counted.
 */
export function lessonHiddenCommands(text: LessonText): string[] {
  const menus = labelMenus();
  const out: string[] = [];
  for (const ref of menuPathsIn(allWords(text), menus)) {
    const id = ref.command;
    if (id === undefined || id.startsWith('menu.') || beginnerCommand(id) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

/** Labels of the commands, in the UI language (the menus the learner is looking for). */
function commandLabels(ids: readonly string[]): string {
  return ids.map((id) => tDynamic(`cmd.${id}`, undefined, id)).join(', ');
}

export function FullModeNotice({ commands, lang }: { commands: readonly string[]; lang: Lang }): React.ReactElement | null {
  const beginner = useEditor((s) => s.ui.beginner === true);
  if (!beginner || !commands.length) return null;
  return (
    <p className="ms-lesson-fullmode">
      {lt('lessons.fullModeNeeded', { commands: commandLabels(commands) }, lang)}{' '}
      <button type="button" className="ms-linkbtn" onClick={() => void runCommand('options.beginnerMode')} title={t('beginner.fullTip')}>
        {lt('lessons.fullModeSwitch', undefined, lang)}
      </button>
    </p>
  );
}
