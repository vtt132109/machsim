/**
 * Looking at, and operating, one placed copy of a block (round 4 step 3): opening a block remembers
 * WHICH copy was opened (EditorState.viewPath), a click or key on a switch inside changes only that
 * copy (PartInstance.inner), undo does not bring the old state back, and the canvas gets the live
 * values of the copy it shows.
 */
import { describe, expect, it } from 'vitest';
import { setLang } from '../../i18n';
import { DesignBuilder } from '../../model/designkit';
import { liveParams, resolveLiveName, scopedLive } from '../../model/hierarchy';
import type { Design } from '../../model/types';
import { CanvasInteraction, NULL_HOST } from '../editor/interaction';
import { activeViewPath, createEditor } from './editorStore';

setLang('en');

function twoSwitchBlocks(): { design: Design; x1: string; x2: string } {
  const b = new DesignBuilder('two blocks');
  const child = b.child('SW', { kind: 'subcircuit' });
  b.label('IN', -100, 0, { kind: 'hier' });
  const s = b.part('basic/switch-spst', 'S1', 100, 0, { closed: 'false', key: 'A' });
  const r = b.part('basic/resistor', 'R1', 300, 0, { value: '1k' });
  const g = b.part('sources/ground', 'G1', 400, 200);
  b.labelPin(s, '1', 'IN');
  b.labelPin(s, '2', 'M');
  b.labelPin(r, '1', 'M');
  b.labelPin(r, '2', 'GND0');
  b.labelPin(g, '1', 'GND0');
  b.root();
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  const gnd = b.part('sources/ground', 'G0', 0, 200);
  const x1 = b.block(child, 'X1', 300, 0);
  const x2 = b.block(child, 'X2', 300, 200);
  b.labelPin(v, '+', 'VIN');
  b.labelPin(x1, 'IN', 'VIN');
  b.labelPin(x2, 'IN', 'VIN');
  b.labelPin(v, '-', 'G');
  b.labelPin(gnd, '1', 'G');
  const root = b.design.sheets[0];
  return { design: b.design, x1: root.parts.find((p) => p.refdes === 'X1')!.id, x2: root.parts.find((p) => p.refdes === 'X2')!.id };
}

describe('opening a placed copy', () => {
  it('remembers which copy was opened and goes back to the block it came from', () => {
    const { design, x1, x2 } = twoSwitchBlocks();
    const ed = createEditor({ design });
    expect(activeViewPath(ed.getState())).toEqual([]);
    expect(ed.actions.openBlock(x2)).toBe(true);
    expect(activeViewPath(ed.getState())).toEqual(['X2']);
    expect(ed.actions.goToParent()).toBe(true);
    expect(activeViewPath(ed.getState())).toEqual([]);
    expect(ed.getState().selection).toEqual([{ kind: 'part', id: x2 }]);
    expect(ed.actions.openBlock(x1)).toBe(true);
    expect(activeViewPath(ed.getState())).toEqual(['X1']);
  });

  it('falls back to the first copy when the sheet is reached some other way', () => {
    const { design } = twoSwitchBlocks();
    const ed = createEditor({ design });
    ed.actions.openChild(design.children![0].id);
    expect(activeViewPath(ed.getState())).toEqual(['X1']);
  });

  it('findAndShow opens the copy named by a dotted path', () => {
    const { design } = twoSwitchBlocks();
    const ed = createEditor({ design });
    expect(ed.actions.findAndShow('X2.S1')).toBe(true);
    expect(activeViewPath(ed.getState())).toEqual(['X2']);
    expect(ed.actions.findAndShow('X7.S1')).toBe(false);
  });
});

describe('operating a switch inside a copy', () => {
  it('a click changes only the copy that is open, and undo keeps the state', () => {
    const { design, x2 } = twoSwitchBlocks();
    const ed = createEditor({ design });
    ed.actions.openBlock(x2);
    const seen: string[] = [];
    ed.actions.onInteractiveChange((r, p, v) => seen.push(`${r}.${p}=${v}`));
    expect(ed.actions.interact('S1', 'click', undefined, activeViewPath(ed.getState()))).toBe('true');
    expect(seen).toEqual(['X2.S1.closed=true']);
    const d = ed.getState().design;
    expect(liveParams(resolveLiveName(d, 'X2.S1')!).closed).toBe('true');
    expect(liveParams(resolveLiveName(d, 'X1.S1')!).closed).toBe('false');
    // the block design's own switch is untouched
    expect(d.children![0].sheets[0].parts[0].params.closed).toBe('false');
    // a second click toggles it back
    expect(ed.actions.interact('S1', 'click', undefined, ['X2'])).toBe('false');
    expect(ed.actions.interact('S1', 'click', undefined, ['X2'])).toBe('true');
    // an ordinary edit followed by undo does not bring the old switch state back
    ed.actions.renumber();
    ed.actions.undo();
    expect(liveParams(resolveLiveName(ed.getState().design, 'X2.S1')!).closed).toBe('true');
  });

  it('returns null for a copy that does not exist', () => {
    const { design } = twoSwitchBlocks();
    const ed = createEditor({ design });
    expect(ed.actions.interact('S1', 'click', undefined, ['X9'])).toBeNull();
    expect(ed.actions.setInteractiveParam('S1', 'closed', 'true', ['X9'])).toBe(false);
  });
});

describe('keys operate the switches of every copy', () => {
  it('the key of a switch inside a block toggles that switch in each placed copy', () => {
    const { design } = twoSwitchBlocks();
    const ed = createEditor({ design });
    const ix = new CanvasInteraction(ed, { ...NULL_HOST });
    expect(ix.interactiveTargets('a').sort()).toEqual(['X1.S1', 'X2.S1']);
    const seen: string[] = [];
    ed.actions.onInteractiveChange((r, p, v) => seen.push(`${r}.${p}=${v}`));
    expect(ix.interactiveKey({ key: 'a' }, 'down')).toBe(true);
    expect(seen.sort()).toEqual(['X1.S1.closed=true', 'X2.S1.closed=true']);
    // one copy is then opened and clicked: only that one flips back
    ed.actions.interact('S1', 'click', undefined, ['X1']);
    expect(liveParams(resolveLiveName(ed.getState().design, 'X1.S1')!).closed).toBe('false');
    expect(liveParams(resolveLiveName(ed.getState().design, 'X2.S1')!).closed).toBe('true');
  });
});

describe('live values of the copy on screen', () => {
  it('picks the keys of one copy, or the top level', () => {
    const map = { 'X1/LED1': 0, 'X2/LED1': 1, LED1: 0.5, 'X2/X3/LED1': 0.2, 'X2/LED2#0': 3 };
    expect(scopedLive(map, ['X2'])).toEqual({ LED1: 1, 'LED2#0': 3 });
    expect(scopedLive(map, ['X2', 'X3'])).toEqual({ LED1: 0.2 });
    expect(scopedLive(map, [])).toEqual({ LED1: 0.5 });
    const flat = { LED1: 1 };
    expect(scopedLive(flat, [])).toBe(flat);
  });
});
