/**
 * Review round 4, step 3: beginner-mode consistency with the lesson texts.
 *
 * A lesson text that says "Công cụ › Quản lý phương án" is an instruction the learner follows with
 * the mouse. Two things can go wrong, and both used to:
 *
 *  1. the path names a menu MachSim does not have (a translated label drifted, or the lesson names
 *     a submenu that lives in another menu) — the learner looks for a menu that is not there;
 *  2. the path names a command beginner mode hides — the menu exists but not in the interface the
 *     Welcome panel put the learner in.
 *
 * So this test resolves EVERY menu path of EVERY shipped lesson, in both languages, to a command
 * id (1), and then checks that the command is reachable in the mode the lesson is read in: either
 * it is in the beginner allowlist, or the lesson page offers the one-click "Bật chế độ đầy đủ"
 * link, which `lessonHiddenCommands` drives (2).
 */
import { describe, expect, it } from 'vitest';
import { LESSON_TEXT } from '../../../src/i18n/lessons';
import { setLang, type Lang } from '../../../src/i18n';
import { newDesign } from '../../../src/model/types';
import { initialEditorState } from '../../../src/ui/store/editorStore';
import { buildMenus, type MenuContext, type TopMenu } from '../../../src/ui/app/menus';
import { beginnerCommand, menuPathsIn, resolveMenuPath, unreachableMenuPaths } from '../../../src/ui/app/beginner';
import { lessonHiddenCommands } from '../../../src/ui/learn/fullMode';
import { BUILTIN_COMMANDS } from '../../../src/ui/app/commands';
import { EXTENSION_COMMANDS } from '../../../src/ui/app/extensions';

function context(): MenuContext {
  const s = initialEditorState(newDesign('T'));
  return {
    state: s,
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
}

function menusIn(lang: Lang): TopMenu[] {
  setLang(lang);
  return buildMenus(context());
}

/** The text of one lesson in one language (theory, goal and every step task / hint). */
function lessonWords(id: string, lang: Lang): string {
  const t = LESSON_TEXT[id];
  if (!t) throw new Error(`no lesson text ${id}`);
  const parts: string[] = [t.theory[lang], t.goal[lang]];
  for (const s of Object.values(t.steps)) parts.push(s.task[lang], s.hint[lang]);
  return parts.join('\n');
}

const LESSON_IDS = Object.keys(LESSON_TEXT);
const KNOWN_COMMANDS = new Set<string>([...BUILTIN_COMMANDS, ...EXTENSION_COMMANDS]);
/**
 * Commands registered by the panels / report layer rather than listed in the shell's own tables
 * (src/ui/reports/install.ts, src/ui/learn/install.ts).
 */
const PANEL_COMMANDS = new Set([
  'help.lessons',
  'help.lessonEditor',
  'tools.descriptionBox',
  'reports.center',
  'reports.bomFull',
  'reports.componentDetail',
  'reports.modelData',
  'reports.spareGates',
  'reports.crossReference',
  'reports.statistics',
]);

describe('every menu path a shipped lesson names resolves to a command', () => {
  for (const lang of ['vi', 'en'] as const) {
    it(`${lang}: no lesson sends the learner to a menu MachSim does not have`, () => {
      const menus = menusIn(lang);
      const bad: string[] = [];
      let paths = 0;
      for (const id of LESSON_IDS) {
        for (const ref of menuPathsIn(lessonWords(id, lang), menus)) {
          paths += 1;
          if (ref.command === undefined) bad.push(`${id}: "${ref.path}"`);
        }
      }
      // the texts really do name menus (a silent zero would make this test meaningless)
      expect(paths).toBeGreaterThanOrEqual(8);
      expect(bad).toEqual([]);
    });

    it(`${lang}: every resolved path names a real command id (or a submenu)`, () => {
      const menus = menusIn(lang);
      const bad: string[] = [];
      for (const id of LESSON_IDS) {
        for (const ref of menuPathsIn(lessonWords(id, lang), menus)) {
          const cmd = ref.command;
          if (cmd === undefined || cmd.startsWith('menu.')) continue;
          if (!KNOWN_COMMANDS.has(cmd) && !PANEL_COMMANDS.has(cmd)) bad.push(`${id}: "${ref.path}" → ${cmd}`);
        }
      }
      expect(bad).toEqual([]);
    });
  }

  it('resolveMenuPath reads a path on its own, in both languages', () => {
    const vi = menusIn('vi');
    expect(resolveMenuPath('Công cụ › Quản lý phương án', vi)).toBe('tools.variants');
    expect(resolveMenuPath('Đặt → Trang sơ đồ bậc thang', vi)).toBe('place.ladderSheet');
    expect(resolveMenuPath('Mô phỏng › Thiết lập phân tích', vi)).toBe('simulate.analysisSettings');
    const en = menusIn('en');
    expect(resolveMenuPath('Tools › Variant manager', en)).toBe('tools.variants');
    expect(resolveMenuPath('Reports › Spare gates', en)).toBe('reports.spareGates');
    expect(resolveMenuPath('Tools › Circuit wizards › 555 timer', en)).toBe('tools.wizard.555');
    // prose with an arrow is not a menu path
    expect(resolveMenuPath('0 → 1', en)).toBeUndefined();
    expect(resolveMenuPath('Nguồn → Nguồn điện', vi)).toBeUndefined();
  });
});

describe('a lesson that names a hidden command offers the full interface in one click', () => {
  for (const lang of ['vi', 'en'] as const) {
    it(`${lang}: every hidden command a lesson names is announced by the lesson page`, () => {
      const menus = menusIn(lang);
      const bad: string[] = [];
      for (const id of LESSON_IDS) {
        const hiddenInText = menuPathsIn(lessonWords(id, lang), menus)
          .map((r) => r.command)
          .filter((c): c is string => c !== undefined && !c.startsWith('menu.') && !beginnerCommand(c));
        if (!hiddenInText.length) continue;
        // the panel builds the notice from the lesson's text in BOTH languages
        const announced = new Set(lessonHiddenCommands(LESSON_TEXT[id]));
        for (const c of hiddenInText) if (!announced.has(c)) bad.push(`${id}: ${c} is hidden but the lesson page says nothing`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('the lessons that need the full interface are exactly the ones about the professional tools', () => {
    const menus = menusIn('en');
    const needing = LESSON_IDS.filter((id) => lessonHiddenCommands(LESSON_TEXT[id]).length);
    // the variant lesson reads the bill of materials, the 555 lesson uses the circuit wizard
    expect(needing.sort()).toEqual(['timer555', 'variant-boards']);
    expect(lessonHiddenCommands(LESSON_TEXT['variant-boards'])).toContain('reports.bom');
    expect(lessonHiddenCommands(LESSON_TEXT['timer555'])).toContain('tools.wizard.555');
    // and every other lesson is fully usable in beginner mode
    for (const id of LESSON_IDS) {
      if (needing.includes(id)) continue;
      expect(unreachableMenuPaths(lessonWords(id, 'en'), menus, true), id).toEqual([]);
    }
  });
});
