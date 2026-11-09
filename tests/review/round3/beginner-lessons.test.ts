/**
 * Review round 3: beginner mode (step 8, src/ui/app/beginner.ts) hides the commands that the
 * round-3 lessons (also step 8) tell the learner to use.
 *
 * Getting Started and the Welcome panel steer a first-time learner into beginner mode, and the
 * Lessons panel is the main thing that learner does. But the hints / theory of the shipped lessons
 * name menu commands that are NOT in BEGINNER_COMMANDS, so in beginner mode the menu the text
 * points at does not exist:
 *   - "Place → Ladder sheet"          ladder-start-stop, ladder-traffic   (place.ladderSheet)
 *   - "Edit › Save selection as snippet" rc-stages                       (file.snippetSave)
 *   - "Tools › Variant manager"        variant-boards                    (tools.variants)
 *   - "Tools › Active variant"         variant-boards                    (submenu id menu.activeVariant,
 *                                                                          hidden on purpose by HIDDEN_SUBMENUS)
 *   - "Reports › Spare gates"          the 7408 lesson                   (reports.spareGates; the whole
 *                                                                          Reports menu is hidden)
 * and the rc-stages / real-capacitor lessons recommend the single-frequency AC analysis
 * ('acsingle'), which beginnerAnalyses() drops.
 *
 * Expected: every command a shipped lesson tells the learner to use is reachable in beginner mode
 * (or the lesson text says how to switch the mode off). Fails today.
 */
import { describe, expect, it } from 'vitest';
import { LESSON_TEXT } from '../../../src/i18n/lessons';
import { beginnerAnalyses, beginnerCommand, BEGINNER_MENUS } from '../../../src/ui/app/beginner';
import { ANALYSIS_ORDER } from '../../../src/ui/app/menus';

/** All Vietnamese and English text of a lesson (theory and every step hint / task). */
function lessonWords(id: string): string {
  const t = LESSON_TEXT[id];
  if (!t) throw new Error(`no lesson text ${id}`);
  const parts: string[] = [t.theory.vi, t.theory.en];
  for (const s of Object.values(t.steps)) parts.push(s.task.vi, s.task.en, s.hint.vi, s.hint.en);
  return parts.join('\n');
}

describe('commands named by the shipped lessons are visible in beginner mode', () => {
  const cases: { lesson: string; says: RegExp; command: string }[] = [
    { lesson: 'ladder-start-stop', says: /Place → Ladder sheet/, command: 'place.ladderSheet' },
    { lesson: 'ladder-traffic', says: /Place → Ladder sheet/, command: 'place.ladderSheet' },
    // round 4 corrected the path: the Edit menu holds the command itself, there is no "Snippets"
    // submenu under Edit (the submenu with that name is in the File menu)
    { lesson: 'rc-stages', says: /Edit › Save selection as snippet/, command: 'file.snippetSave' },
    { lesson: 'variant-boards', says: /Tools › Variant manager/, command: 'tools.variants' },
  ];
  for (const c of cases) {
    it(`${c.lesson}: "${c.says.source}" → ${c.command}`, () => {
      // the lesson really tells the learner to use that menu …
      expect(lessonWords(c.lesson)).toMatch(c.says);
      // … so beginner mode must not hide it
      expect(beginnerCommand(c.command)).toBe(true);
    });
  }

  it('a lesson that says "Reports › Spare gates" needs the Reports menu', () => {
    const words = Object.keys(LESSON_TEXT).map(lessonWords).join('\n');
    expect(words).toMatch(/Reports › Spare gates/);
    expect(BEGINNER_MENUS).toContain('reports');
    expect(beginnerCommand('reports.spareGates')).toBe(true);
  });

  it('the single-frequency AC analysis the rc-stages lesson recommends stays selectable', () => {
    expect(lessonWords('rc-stages')).toMatch(/single-frequency AC/);
    expect(beginnerAnalyses(ANALYSIS_ORDER, true, 'op')).toContain('acsingle');
  });
});
