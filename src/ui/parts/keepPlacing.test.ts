/**
 * "Reopen after placing": the watcher must survive the editor store's notification order (the
 * one-shot placement patches the tool back to select, which notifies subscribers, and only then
 * tells the placement listeners), reopen the dialog exactly once, and give up on Esc, on another
 * tool, on another part and on a refused placement.
 *
 * The fake host below reproduces that order, and one test drives the real editor store to prove
 * the order is the one the watcher is written for.
 */
import { describe, expect, it } from 'vitest';
import { keepPlacing, type PlaceHost } from './keepPlacing';
import { createEditor } from '../store/editorStore';
import { getPart } from '../../library';

/** A store that behaves like the editor store: tool patches notify first, placements after. */
function fakeHost() {
  const subs = new Set<() => void>();
  const placedCbs = new Set<(instId: string, partId: string) => void>();
  const deferred: (() => void)[] = [];
  let placing: string | null = null;
  let allow = true;
  const host: PlaceHost = {
    startPlacing: (partId) => {
      placing = allow ? partId : null;
      for (const s of [...subs]) s();
    },
    onPartPlaced: (cb) => {
      placedCbs.add(cb);
      return () => placedCbs.delete(cb);
    },
    subscribe: (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    placingNow: () => placing,
    defer: (fn) => deferred.push(fn),
  };
  return {
    host,
    refuse: () => {
      allow = false;
    },
    /** place a part: tool back to select (subscribers first), then the placement listeners */
    place: (partId: string, instId = 'inst1') => {
      placing = null;
      for (const s of [...subs]) s();
      for (const cb of [...placedCbs]) cb(instId, partId);
    },
    /** Esc or another tool: only the tool changes */
    endTool: (next: string | null = null) => {
      placing = next;
      for (const s of [...subs]) s();
    },
    /** run what the host deferred (the real host: a setTimeout 0 turn) */
    flush: () => {
      const run = deferred.splice(0);
      for (const f of run) f();
    },
    counts: () => ({ subs: subs.size, placed: placedCbs.size, deferred: deferred.length }),
  };
}

describe('keep placing', () => {
  it('reopens the dialog after the part is placed, although the tool change is announced first', () => {
    const f = fakeHost();
    const opened: string[] = [];
    keepPlacing(f.host, 'basic/resistor', (id) => opened.push(id));
    expect(f.host.placingNow()).toBe('basic/resistor');
    f.place('basic/resistor');
    // the reopen happens on the placement callback, not on the deferred decision
    expect(opened).toEqual(['basic/resistor']);
    f.flush();
    expect(opened).toEqual(['basic/resistor']);
    // and the watcher let go of the store
    expect(f.counts()).toEqual({ subs: 0, placed: 0, deferred: 0 });
  });

  it('gives up without reopening when the learner presses Esc', () => {
    const f = fakeHost();
    const opened: string[] = [];
    keepPlacing(f.host, 'basic/resistor', (id) => opened.push(id));
    f.endTool(null);
    expect(f.counts().subs).toBe(1); // still deciding
    f.flush();
    expect(opened).toEqual([]);
    expect(f.counts()).toEqual({ subs: 0, placed: 0, deferred: 0 });
    // a placement that arrives after Esc (another part placed by the browser panel) is ignored
    f.place('basic/resistor');
    expect(opened).toEqual([]);
  });

  it('gives up when another part goes into the ghost, and ignores other parts being placed', () => {
    const f = fakeHost();
    const opened: string[] = [];
    keepPlacing(f.host, 'basic/resistor', (id) => opened.push(id));
    f.endTool('basic/capacitor');
    f.flush();
    expect(opened).toEqual([]);
    const g = fakeHost();
    keepPlacing(g.host, 'basic/resistor', (id) => opened.push(id));
    g.place('basic/capacitor');
    g.flush();
    expect(opened).toEqual([]);
  });

  it('stops at once when the placement is refused, and can be stopped by the caller', () => {
    const f = fakeHost();
    f.refuse();
    const opened: string[] = [];
    keepPlacing(f.host, 'hier:nested', (id) => opened.push(id));
    expect(f.counts().subs).toBe(0);
    expect(f.counts().placed).toBe(0);
    // a decision already scheduled does nothing once the watcher has stopped
    f.flush();
    expect(opened).toEqual([]);
    const g = fakeHost();
    const stop = keepPlacing(g.host, 'basic/resistor', (id) => opened.push(id));
    stop();
    expect(g.counts().subs).toBe(0);
    g.place('basic/resistor');
    expect(opened).toEqual([]);
  });

  it('the real editor store announces the tool change before the placement (the order above)', () => {
    const ed = createEditor({ lookup: getPart });
    const order: string[] = [];
    const offStore = ed.subscribe(() => {
      if (ed.getState().tool.kind !== 'place') order.push('tool');
    });
    const offPlaced = ed.actions.onPartPlaced(() => order.push('placed'));
    ed.actions.startPlacing('basic/resistor', { once: true });
    expect(ed.getState().tool).toMatchObject({ kind: 'place', partId: 'basic/resistor', once: true });
    const id = ed.actions.placePart('basic/resistor', { x: 100, y: 100 });
    expect(id).toBeTruthy();
    expect(ed.getState().tool.kind).toBe('select');
    // the tool change is announced first: that is why keepPlacing defers its decision
    expect(order[order.indexOf('placed') - 1]).toBe('tool');
    expect(order.filter((x) => x === 'placed')).toEqual(['placed']);
    offStore();
    offPlaced();
  });
});
