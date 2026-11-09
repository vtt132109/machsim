/**
 * Beginner mode (pure): the simplified user interface a learner meets on the first run.
 *
 * MachSim has the feature list of a professional capture-and-simulate program, which is exactly
 * what makes it frightening to open. Beginner mode keeps the commands a first circuit needs and
 * hides the rest — the whole menu bar, the toolbar groups and the analysis list are filtered
 * through this module, so nothing has to be duplicated and a command added later is simply not in
 * the beginner list until someone puts it there.
 *
 *   beginnerMenus(buildMenus(ctx), true)       // the filtered menu bar
 *   beginnerCommand('file.exportXml')          // false: hidden in beginner mode
 *   beginnerAnalyses()                         // the four analyses a beginner uses
 *   beginnerToolbar(prefs, true)               // toolbar groups, advanced ones switched off
 *
 * Nothing is taken away for good: the switch is Options › Beginner mode (command
 * `options.beginnerMode`), the status bar shows the mode and the Welcome panel offers it on the
 * first run. Hidden commands keep working when a shortcut or another panel runs them — the mode
 * tidies the screen, it does not lock the program.
 *
 * **Rule for anyone adding a lesson:** a command a shipped lesson tells the learner to open has to
 * be in the beginner list, because beginner mode is what the Welcome panel and Getting Started put
 * the learner in. `tests/review/round3/beginner-lessons.test.ts` reads the lesson texts and fails
 * when they name a menu this module hides.
 */
import type { AnalysisType } from '../../sim/netlist';
import type { TopMenu } from './menus';
import type { MenuEntry } from '../common/Menu';
import { TOOLBAR_GROUPS, type ToolbarGroup, type ToolbarPrefs } from './customize';

/**
 * Commands a beginner sees in the menus and on the toolbar: everything a first circuit needs —
 * open / save, the clipboard, zoom, placing parts and wires, voltage and current probes, Run and
 * the result windows, the electrical rules check, and the whole Help menu (that is where the
 * lessons are). Everything else is hidden until full mode is switched back on.
 */
export const BEGINNER_COMMANDS: readonly string[] = [
  // file
  'file.new',
  'file.open',
  'file.examples',
  'file.save',
  'file.saveAs',
  'file.exportPng',
  'file.print',
  'file.info',
  // several designs: a learner who opens a second one needs to close it and to move between them
  // (the Window menu itself stays hidden; the tabs, Ctrl+Tab and these two commands are enough)
  'file.close',
  'window.next',
  'window.previous',
  // snippets: the rc-stages lesson says "Edit › Snippets › Save snippet"
  'file.snippetSave',
  'file.snippetPlace',
  'file.snippetOpen',
  // edit
  'edit.undo',
  'edit.redo',
  'edit.cut',
  'edit.copy',
  'edit.paste',
  'edit.duplicate',
  'edit.delete',
  'edit.selectAll',
  'edit.rotateCw',
  'edit.rotateCcw',
  'edit.flipH',
  'edit.flipV',
  'edit.find',
  'edit.properties',
  // view
  'view.zoomIn',
  'view.zoomOut',
  'view.zoom100',
  'view.fitAll',
  'view.fitSelection',
  'view.grid',
  'view.erc',
  'view.browser',
  'view.properties',
  'view.dock',
  'view.nextSheet',
  'view.prevSheet',
  // place
  'place.component',
  'place.wire',
  'place.label',
  'place.text',
  'place.comment',
  'place.probe.voltage',
  'place.probe.current',
  'place.sheet',
  'place.renameSheet',
  'place.deleteSheet',
  // the two ladder lessons say "Place → Ladder sheet"
  'place.ladderSheet',
  // simulate
  'simulate.run',
  'simulate.pause',
  'simulate.stop',
  'simulate.runAnalysis',
  'simulate.analysisSettings',
  'simulate.grapher',
  'simulate.clearMessages',
  // the Audio window: master volume, mute and the "slower than real time" notice of a speaker circuit
  'simulate.audio',
  // tools
  'tools.erc',
  'tools.clearErc',
  'tools.annotate',
  'tools.descriptionBox',
  // the variant-boards lesson says "Tools › Variant manager" and "Tools › Active variant"
  'tools.variants',
  // reports: the 7408 lesson says "Reports › Spare gates"
  'reports.spareGates',
  // options
  'options.beginnerMode',
  'options.autosave',
  // help (all of it: the lessons live here)
  'help.gettingStarted',
  'help.lessons',
  'help.lessonEditor',
  'help.whatsNew',
  'help.context',
  'help.topics',
  'help.shortcuts',
  'help.welcome',
  'help.about',
];

const BEGINNER_SET = new Set(BEGINNER_COMMANDS);

/** True when the command belongs to the beginner interface. */
export function beginnerCommand(id: string): boolean {
  return BEGINNER_SET.has(id);
}

/**
 * Top menus a beginner sees. Reports is in the list for the one report a lesson uses (spare
 * gates); the rest of its items are filtered out by {@link beginnerCommand}, so the menu shows
 * exactly that entry.
 */
export const BEGINNER_MENUS: readonly string[] = ['file', 'edit', 'view', 'place', 'simulate', 'tools', 'reports', 'options', 'help'];

/**
 * Analyses a beginner can choose: the operating point, the transient, the AC sweep, the DC sweep
 * and the single-frequency AC point the RC lessons use (one magnitude and one phase, easier to
 * read than a whole curve). The other sixteen (noise, distortion, pole-zero, sweeps of sweeps,
 * Monte Carlo …) need a vocabulary a first-year learner does not have yet.
 */
export const BEGINNER_ANALYSIS_TYPES: readonly AnalysisType[] = ['op', 'tran', 'ac', 'dc', 'acsingle'];

const BEGINNER_ANALYSIS_SET = new Set<string>(BEGINNER_ANALYSIS_TYPES);

/**
 * The analyses of `all` a beginner may pick (every one of them in full mode). `keep` is the
 * analysis the open design uses: a file that was set up with an advanced analysis keeps it in the
 * list, so beginner mode never shows a selector whose current value is missing.
 */
export function beginnerAnalyses(all: readonly AnalysisType[], beginner: boolean, keep?: AnalysisType): AnalysisType[] {
  return beginner ? all.filter((a) => BEGINNER_ANALYSIS_SET.has(a) || a === keep) : [...all];
}

/** Toolbar groups a beginner sees (the transform, tools and view groups are hidden). */
export const BEGINNER_TOOLBAR_GROUPS: readonly ToolbarGroup[] = ['file', 'history', 'clipboard', 'zoom', 'simulate'];

/**
 * The learner's toolbar preferences with the advanced groups switched off in beginner mode. The
 * stored preferences are never changed, so leaving beginner mode brings back exactly the toolbar
 * the learner had.
 */
export function beginnerToolbar(prefs: ToolbarPrefs | undefined, beginner: boolean): ToolbarPrefs {
  if (!beginner) return prefs ?? {};
  const out: ToolbarPrefs = { ...prefs };
  for (const g of TOOLBAR_GROUPS) if (!BEGINNER_TOOLBAR_GROUPS.includes(g)) out[g] = false;
  return out;
}

/**
 * Submenus hidden as a whole (their items are built from data, so they carry no command id).
 * "Active variant" is NOT hidden: the variant-boards lesson tells the learner to use it, and the
 * submenu is empty anyway until a design has variants.
 */
const HIDDEN_SUBMENUS = new Set<string>();

/** True when an entry survives the filter (id-less entries built from data always do). */
function keepEntry(e: MenuEntry): boolean {
  if (e.type === 'separator') return true;
  if (e.type === 'submenu') {
    if (e.id !== undefined && HIDDEN_SUBMENUS.has(e.id)) return false;
    // a submenu whose command items are all hidden goes away; one built from data (recent files,
    // sheets, themes) keeps its id-less items and stays
    return e.items.filter(keepEntry).some((x) => x.type !== 'separator');
  }
  if (e.id === undefined) return true;
  // the design's own analysis stays listed even when it is an advanced one (it is the checked item)
  if (e.id.startsWith('analysis.')) return BEGINNER_ANALYSIS_SET.has(e.id.slice('analysis.'.length)) || e.checked === true;
  return beginnerCommand(e.id);
}

/** Drop leading, trailing and doubled separators. */
function tidy(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of items) {
    if (e.type === 'separator') {
      if (!out.length || out[out.length - 1].type === 'separator') continue;
    }
    out.push(e);
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

function filterEntries(items: MenuEntry[]): MenuEntry[] {
  const kept: MenuEntry[] = [];
  for (const e of items) {
    if (!keepEntry(e)) continue;
    kept.push(e.type === 'submenu' ? { ...e, items: tidy(filterEntries(e.items)) } : e);
  }
  return tidy(kept);
}

/**
 * The menu bar a beginner sees: the advanced top menus, items and submenus removed and the
 * separators tidied up. `beginner === false` returns the model unchanged (same object).
 */
export function beginnerMenus(menus: TopMenu[], beginner: boolean): TopMenu[] {
  if (!beginner) return menus;
  return menus
    .filter((m) => BEGINNER_MENUS.includes(m.id))
    .map((m) => ({ ...m, items: filterEntries(m.items) }))
    .filter((m) => m.items.length > 0);
}

/**
 * The same filter for a flat list of entries — the canvas context menu and the sheet-tab menu.
 * Beginner mode has to be consistent: a command the menu bar hides must not reappear on the
 * right-click menu, or the learner meets a dialog the simplified interface never mentions.
 * Entries without an `id` (built from data) always stay, as in the menu bar.
 */
export function beginnerEntries(items: MenuEntry[], beginner: boolean): MenuEntry[] {
  if (!beginner) return items;
  return tidy(filterEntries(items));
}

// ---------------------------------------------------------------------------------------------
// menu paths named in texts (lessons, help)
// ---------------------------------------------------------------------------------------------

/** Separators a MachSim text uses between the steps of a menu path. */
const PATH_SEPARATOR = /\s*[›→»]\s*|\s+>\s+/;

/** Words of a label / path segment, without diacritics, markup or trailing punctuation. */
function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\*\*|`|[“”"']/g, ' ')
    .replace(/[…:.,;!?()]/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');
}

/**
 * The top menu a path starts with. The name has to match **exactly** (word for word, without case
 * or diacritics), so prose with an arrow in it ("Đất (nhóm Nguồn → Nguồn điện)") is not read as a
 * menu path.
 */
function topMenuOf(menus: TopMenu[], segment: string): TopMenu | undefined {
  const seg = words(segment);
  if (!seg.length) return undefined;
  return menus.find((m) => {
    const label = words(m.label);
    return label.length === seg.length && label.every((w, i) => w === seg[i]);
  });
}

/** Every entry under `items`, breadth first, with the submenus it passed through. */
function flatten(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  const walk = (list: MenuEntry[]) => {
    for (const e of list) {
      if (e.type === 'separator') continue;
      out.push(e);
      if (e.type === 'submenu') walk(e.items);
    }
  };
  walk(items);
  return out;
}

/** How many leading words two word lists share. */
function commonPrefix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/**
 * The entry of `items` (at any depth) a path segment names, or undefined.
 *
 * A text segment carries the menu label **first** and then whatever the sentence goes on to say
 * ("Variant manager → “Add variant”", "Bill of materials: follows the active variant"), and the
 * label itself may carry more than the text repeats ("Bill of materials (BOM)…"). So the match is
 * on the shared leading words: the entry that shares the most wins, an entry whose whole label (or
 * the whole segment) is covered wins over one that is only partly covered, and on a tie the
 * shorter label and a real command (rather than a submenu) win.
 */
function entryFor(items: MenuEntry[], segment: string): MenuEntry | undefined {
  const seg = words(segment);
  if (!seg.length) return undefined;
  let best: MenuEntry | undefined;
  let bestRank = -1;
  for (const e of flatten(items)) {
    if (e.type === 'separator') continue;
    const label = words(e.label);
    if (!label.length) continue;
    const score = commonPrefix(label, seg);
    if (score === 0) continue;
    const full = score === label.length || score === seg.length;
    const rank = (full ? 10_000 : 0) + score * 100 - (label.length - score) + (e.type === 'submenu' ? 0 : 1);
    if (rank > bestRank) {
      bestRank = rank;
      best = e;
    }
  }
  return best;
}

/**
 * The command (or submenu) id a menu path from a text names: "Tools › Variant manager", "Đặt →
 * Trang sơ đồ bậc thang", "Simulate › Analysis settings › Custom SPICE". The first segment is the
 * top menu; the following ones are matched against everything under it, so a text that says
 * "Edit › Snippets › Save snippet" finds Edit's "Save selection as snippet…" even though the
 * submenu it names lives in the File menu. Matching ignores case, Vietnamese diacritics, markup
 * and the trailing "…", and accepts a segment that carries extra words ("Variant manager and add
 * a second one").
 *
 * Returns undefined when the path names no menu MachSim has — which is what the lesson test
 * reports, because a learner following it would be stuck.
 */
export function resolveMenuPath(path: string, menus: TopMenu[]): string | undefined {
  const parts = path.split(PATH_SEPARATOR).map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length < 2) return undefined;
  const top = topMenuOf(menus, parts[0]);
  if (!top) return undefined;
  let items = top.items;
  let id: string | undefined;
  for (const segment of parts.slice(1)) {
    const e = entryFor(items, segment);
    if (!e || e.type === 'separator') break;
    if (e.type === 'submenu') {
      items = e.items;
      id = e.id ?? id;
      continue;
    }
    return e.id ?? id;
  }
  return id;
}

/** A menu path a text names, with the command it resolves to (undefined = no such menu). */
export interface MenuPathRef {
  path: string;
  command: string | undefined;
}

/** The top menu named by the last 1..4 words of a text piece ("… menu Đặt"). */
function trailingMenu(piece: string, menus: TopMenu[]): { menu: TopMenu; name: string } | undefined {
  const raw = piece.trim().split(/\s+/);
  for (let n = Math.min(4, raw.length); n >= 1; n--) {
    const name = raw.slice(raw.length - n).join(' ');
    const menu = topMenuOf(menus, name);
    if (menu) return { menu, name };
  }
  return undefined;
}

/** A piece of a path, shortened for the diagnostic text. */
function shortPiece(piece: string): string {
  const t = piece.trim().replace(/\s+/g, ' ');
  return t.length > 44 ? `${t.slice(0, 44)}…` : t;
}

/**
 * Menu paths a text names, in the order they appear: a run of pieces separated by "›", "→", "»"
 * or " > " that starts with the name of a top menu and goes on naming entries that exist under
 * it. Resolution stops at the first piece that names nothing, so ordinary prose around the path
 * ("… menu Đặt → Trang sơ đồ bậc thang. Nối chân COM …") neither hides the path nor extends it,
 * and an arrow used as prose ("nhóm Nguồn → Nguồn điện") is not read as a menu path at all.
 */
export function menuPathsIn(text: string, menus: TopMenu[]): MenuPathRef[] {
  const pieces = text.split(/\s*(?:[›→»]|(?:^| )>(?= ))\s*/);
  const out: MenuPathRef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pieces.length - 1; i++) {
    const head = trailingMenu(pieces[i], menus);
    if (!head) continue;
    const parts = [head.name];
    let items = head.menu.items;
    let id: string | undefined;
    for (let j = i + 1; j < pieces.length; j++) {
      const e = entryFor(items, pieces[j]);
      if (!e || e.type === 'separator') break;
      parts.push(shortPiece(pieces[j]));
      if (e.type === 'submenu') {
        items = e.items;
        id = e.id ?? id;
        continue;
      }
      id = e.id ?? id;
      break;
    }
    const path = parts.join(' › ');
    if (parts.length < 2 || seen.has(path)) continue;
    seen.add(path);
    out.push({ path, command: id });
  }
  return out;
}

/**
 * Menu paths of a text that a beginner cannot reach: either the path names no menu at all, or it
 * resolves to a command beginner mode hides. The Lessons panel shows a one-click "Bật chế độ đầy
 * đủ" link for the second kind (src/ui/learn/LessonsPanel.tsx), and
 * `tests/review/round4/beginner-menu-paths.test.ts` fails for the first.
 */
export function unreachableMenuPaths(text: string, menus: TopMenu[], beginner: boolean): MenuPathRef[] {
  return menuPathsIn(text, menus).filter((r) => (r.command === undefined ? true : beginner && !beginnerCommand(r.command) && !r.command.startsWith('menu.')));
}

/** True when a text tells the learner to use a command beginner mode hides. */
export function textNeedsFullMode(text: string, menus: TopMenu[]): boolean {
  return menuPathsIn(text, menus).some((r) => r.command !== undefined && !r.command.startsWith('menu.') && !beginnerCommand(r.command));
}
