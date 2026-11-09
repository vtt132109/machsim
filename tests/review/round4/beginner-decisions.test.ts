/**
 * Round 4 step 9: the beginner-mode review of every command round 4 added.
 *
 * Beginner mode (src/ui/app/beginner.ts) is an allowlist: a command nobody puts there stays
 * hidden. That is the right default for professional tools, but it must be a DECISION, not an
 * accident, so this test keeps a table with one line per round-4 command: is it in the beginner
 * interface, and why. It also fails when a command appears in the menu model that is neither a
 * round-3 command (menu-ids-round3.json is the snapshot of the menu ids at the end of round 3) nor
 * in the table, so the next engineer who adds a command is asked the question.
 *
 * The rule behind the table: a beginner needs a command when the first circuit, the tutorial or a
 * lesson that is reachable in beginner mode needs it; exchange formats, drawing-order tools, layer
 * switches, scripting and per-project naming rules are for the second month.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { beginnerCommand } from '../../../src/ui/app/beginner';

interface Decision {
  /** in the beginner interface */
  beginner: boolean;
  why: string;
  /** only reachable from a context menu (no entry in the menu bar) */
  context?: boolean;
}

export const ROUND4_DECISIONS: Record<string, Decision> = {
  // several designs
  'file.close': { beginner: true, why: 'a learner who opens a second design must be able to close it' },
  'file.closeAll': { beginner: false, why: 'closing one at a time is enough; quitting asks once for the rest' },
  'file.saveAll': { beginner: false, why: 'Save of the design in view is enough; the quit question offers Save all' },
  window: { beginner: false, why: 'the Window menu is hidden; the tabs, Ctrl+Tab and the next / previous commands do the job' },
  'window.next': { beginner: true, why: 'keyboard way between the tabs' },
  'window.previous': { beginner: true, why: 'keyboard way between the tabs' },
  'window.recent': { beginner: false, why: 'the same as Ctrl+Tab between two designs; only useful with many open' },
  // editing tools
  'edit.layers': { beginner: false, why: 'view switches for worksheets and netlist teaching; the print-handout lesson offers the full interface' },
  'menu.order': { beginner: false, why: 'drawing order of notes and shapes: decoration, not circuit' },
  'edit.order.front': { beginner: false, why: 'drawing order' },
  'edit.order.back': { beginner: false, why: 'drawing order' },
  'edit.order.forward': { beginner: false, why: 'drawing order' },
  'edit.order.backward': { beginner: false, why: 'drawing order' },
  'menu.pasteSpecial': { beginner: false, why: 'Ctrl+V already pastes; the special forms are for rearranging designs' },
  'edit.pasteSpecial.keepNames': { beginner: false, why: 'keeps reference designators: a professional workflow' },
  'edit.pasteSpecial.values': { beginner: false, why: 'copies values between circuits: a professional workflow' },
  'edit.pasteSpecial.block': { beginner: false, why: 'subcircuits are the hierarchy topic' },
  'tools.refdesRules': { beginner: false, why: 'project naming rules; a beginner keeps R, C, U' },
  'place.newPackage': { beginner: false, why: 'chooses where a section of a multi-section chip goes; the default is right' },
  // simulation and sound
  'simulate.audio': { beginner: true, why: 'the speaker lessons and sample 72 need the volume, mute and level bar' },
  // exchange and automation
  'edit.copySystem': { beginner: false, why: 'sends a circuit to other programs; Ctrl+C inside MachSim is enough' },
  'edit.pasteSystem': { beginner: false, why: 'Ctrl+V already falls back to the system clipboard when MachSim has nothing' },
  'tools.importKicadSymbols': { beginner: false, why: 'exchange with another CAD program' },
  'tools.exportKicadSymbols': { beginner: false, why: 'exchange with another CAD program' },
  'tools.script': { beginner: false, why: 'programming; the script-sweep lesson shows the one-click switch to the full interface' },
  // right-click menus
  'view.instruments': { beginner: false, why: 'right-click "Open instrument panel": the tutorial teaches the double-click, and the allowlist holds real commands only', context: true },
  'place.saveBlock': { beginner: false, why: 'saving a block to a file is the hierarchy topic', context: true },
};

const SRC = join(__dirname, '../../../src');

/** Ids named in the menu model source (item('x') and { id: 'x' }). */
function menuIds(): string[] {
  const text = readFileSync(join(SRC, 'ui/app/menus.ts'), 'utf8');
  const out = new Set<string>();
  for (const m of text.matchAll(/item\('([A-Za-z0-9_.]+)'/g)) out.add(m[1]);
  for (const m of text.matchAll(/\bid: '([A-Za-z0-9_.]+)'/g)) out.add(m[1]);
  return [...out];
}

describe('every command round 4 added has a beginner-mode decision', () => {
  it('the table agrees with the allowlist', () => {
    const wrong = Object.entries(ROUND4_DECISIONS)
      .filter(([id, d]) => beginnerCommand(id) !== d.beginner)
      .map(([id, d]) => `${id}: table says ${d.beginner ? 'visible' : 'hidden'}`);
    expect(wrong).toEqual([]);
  });

  it('every decision has a reason', () => {
    for (const [id, d] of Object.entries(ROUND4_DECISIONS)) expect(d.why.length, id).toBeGreaterThan(8);
  });

  it('no menu command is new without a decision (menu ids minus the round-3 snapshot)', () => {
    const round3 = new Set<string>(JSON.parse(readFileSync(join(__dirname, 'menu-ids-round3.json'), 'utf8')) as string[]);
    const fresh = menuIds().filter((id) => !round3.has(id) && !(id in ROUND4_DECISIONS));
    expect(fresh, `decide the beginner visibility of: ${fresh.join(', ')} (add it to ROUND4_DECISIONS in tests/review/round4/beginner-decisions.test.ts)`).toEqual([]);
  });

  it('every menu-bar decision names a command the menu model really has', () => {
    const ids = new Set(menuIds());
    const stale = Object.entries(ROUND4_DECISIONS)
      .filter(([id, d]) => !d.context && !ids.has(id))
      .map(([id]) => id);
    expect(stale).toEqual([]);
  });

  it('the context-menu decisions are in the canvas menu source', () => {
    const canvas = readFileSync(join(SRC, 'ui/app/canvasHost.ts'), 'utf8');
    for (const [id, d] of Object.entries(ROUND4_DECISIONS)) if (d.context) expect(canvas, id).toContain(`'${id}'`);
  });

  it('a hidden command that a shipped lesson names is announced by the lesson page (see beginner-menu-paths)', () => {
    // the three lessons that need the full interface are exactly the ones about the hidden commands
    expect(beginnerCommand('place.newHierBlock')).toBe(false);
    expect(beginnerCommand('tools.script')).toBe(false);
    expect(beginnerCommand('edit.layers')).toBe(false);
  });
});
