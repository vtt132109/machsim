/**
 * The quick-reference card: a printable page of keyboard shortcuts and the main menus, offered in
 * the print preview ("Quick-reference card"). A learner pins it beside the screen; a teacher hands
 * it out with the first lesson.
 *
 * Nothing is typed twice: the shortcut table is the same list as Help > Keyboard shortcuts
 * (SHORTCUT_HELP) and the menu table is read from the live menu model, so a command added later
 * appears on the card by itself, and in beginner mode the card shows only the menus and commands
 * the learner really has on the screen. The texts are in src/i18n/printText.ts (`pt`).
 *
 *   quickReferenceContents({ beginner })   -> the contents the print job paginates:
 *                                              1. the first circuit in six steps (a document)
 *                                              2. the keyboard shortcuts (a table)
 *                                              3. the main menus (a table)
 */
import { t } from '../../i18n';
import { pt, type PrintTextKey } from '../../i18n/printText';
import { beginnerCommand, beginnerMenus } from '../app/beginner';
import { buildMenus, type MenuContext, type TopMenu } from '../app/menus';
import { SHORTCUT_HELP } from '../app/shortcuts';
import type { MenuEntry } from '../common/Menu';
import { getState } from '../store';
import type { DocContent, PrintContent, TableContent } from './printModel';

/** The menu ids the card knows a purpose for (src/ui/app/menus.ts), in the order of the menu bar. */
export const QUICK_MENU_PURPOSE: readonly (readonly [menu: string, text: PrintTextKey])[] = [
  ['file', 'qrMenuFile'],
  ['edit', 'qrMenuEdit'],
  ['view', 'qrMenuView'],
  ['place', 'qrMenuPlace'],
  ['simulate', 'qrMenuSimulate'],
  ['tools', 'qrMenuTools'],
  ['reports', 'qrMenuReports'],
  ['options', 'qrMenuOptions'],
  ['window', 'qrMenuWindow'],
  ['help', 'qrMenuHelp'],
];

/** How many commands of a menu the card lists before it says "…". */
export const QUICK_MENU_ITEMS = 8;

/** The menu model with nothing selected, as the menu bar shows it (any handler counts as present). */
function liveMenus(beginner: boolean): TopMenu[] {
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
    simulationConnected: true,
  };
  return beginnerMenus(buildMenus(ctx), beginner);
}

/** The command entries of a menu that name a command (no separators, no data entries such as recent files). */
function commandEntries(items: readonly MenuEntry[]): { label: string; shortcut?: string }[] {
  const out: { label: string; shortcut?: string }[] = [];
  for (const e of items) {
    if ('type' in e && e.type === 'separator') continue;
    if (e.type === 'submenu' || !('label' in e) || !e.id || e.id.startsWith('menu.')) continue;
    out.push({ label: e.label.replace(/…$/, ''), shortcut: e.shortcut });
  }
  return out;
}

/** "Chạy (F5), Dừng (Shift+F5) …" — the commands of one menu as the card prints them. */
export function menuSummary(items: readonly MenuEntry[], limit = QUICK_MENU_ITEMS): string {
  const all = commandEntries(items);
  // the commands that have a shortcut are the ones worth remembering: they come first
  const ranked = [...all.filter((c) => c.shortcut), ...all.filter((c) => !c.shortcut)];
  const shown = ranked.slice(0, limit).map((c) => (c.shortcut ? `${c.label} (${c.shortcut})` : c.label));
  return all.length > limit ? `${shown.join(' · ')} · …` : shown.join(' · ');
}

/** Shortcut rows that stand for one command: in beginner mode the command is hidden, so the row is not listed. */
const SHORTCUT_COMMAND: Readonly<Record<string, string>> = { 'keys.place.bus': 'place.bus', 'keys.edit.findReplace': 'edit.findReplace' };

export function shortcutTable(beginner = false): TableContent {
  const rows: string[][] = [];
  for (const sec of SHORTCUT_HELP) {
    for (const r of sec.rows) {
      const cmd = SHORTCUT_COMMAND[r.action];
      if (beginner && cmd && !beginnerCommand(cmd)) continue;
      rows.push([t(sec.section), r.keys, t(r.action)]);
    }
  }
  return { kind: 'table', id: 'quickref:keys', label: pt('qrKeysLabel'), table: { title: pt('qrKeysTitle'), header: [pt('qrColGroup'), pt('qrColKeys'), pt('qrColDoes')], rows, weights: [2, 4, 7] } };
}

export function menuTable(beginner: boolean): TableContent {
  const rows: string[][] = [];
  for (const m of liveMenus(beginner)) {
    const base = QUICK_MENU_PURPOSE.find(([id]) => id === m.id)?.[1];
    const purpose = beginner && base === 'qrMenuEdit' ? 'qrMenuEditBeginner' : base;
    rows.push([m.label, purpose ? pt(purpose) : '', menuSummary(m.items)]);
  }
  return { kind: 'table', id: 'quickref:menus', label: pt('qrMenusLabel'), table: { title: pt('qrMenusTitle'), subtitle: beginner ? pt('qrMenusBeginner') : undefined, header: [pt('qrColMenu'), pt('qrColFor'), pt('qrColMain')], rows, weights: [2, 4, 9] } };
}

export function firstCircuitDoc(): DocContent {
  const steps: PrintTextKey[] = ['qrStep1', 'qrStep2', 'qrStep3', 'qrStep4', 'qrStep5', 'qrStep6'];
  return {
    kind: 'doc',
    id: 'quickref:start',
    label: pt('qrStartLabel'),
    title: pt('qrStartTitle'),
    blocks: [
      { kind: 'heading', text: pt('qrStartHeading') },
      { kind: 'bullets', items: steps.map((k, i) => `${i + 1}. ${pt(k)}`) },
      { kind: 'heading', text: pt('qrHelpHeading') },
      { kind: 'bullets', items: [pt('qrHelp1'), pt('qrHelp2'), pt('qrHelp3')] },
    ],
  };
}

/** The pages of the card, for the current language and (when asked) the beginner interface. */
export function quickReferenceContents(opts: { beginner: boolean }): PrintContent[] {
  return [firstCircuitDoc(), shortcutTable(opts.beginner), menuTable(opts.beginner)];
}
