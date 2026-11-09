/**
 * Several designs open at once: each document keeps its own undo history, selection, dirty flag and
 * simulation state; the close / close-all / save-all flows ask what they should and never drop an
 * unsaved design on Cancel. Plain editors, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { createEditor, isDirty } from '../store/editorStore';
import { testLookup } from '../store/testParts';
import { newDesign } from '../../model/types';
import { createDocumentManager, designIsEmpty, MAX_DOCUMENTS, type CloseHost, type DocumentExtension, type UnsavedChoice } from './documents';
import { setLang } from '../../i18n';

setLang('en');

function setup(extra: { max?: number } = {}) {
  const editor = createEditor({ lookup: testLookup });
  const manager = createDocumentManager({ editor, blank: () => newDesign('Blank'), maxDocuments: extra.max });
  return { editor, manager };
}

type Setup = ReturnType<typeof setup>;

/** Edit the current document: place `n` resistors. */
function draw(s: Setup, n = 1) {
  for (let i = 0; i < n; i++) s.editor.actions.placePart('test/resistor', { x: i * 100, y: 0 });
}

const partsOf = (s: Setup) => s.editor.getState().design.sheets[0].parts.length;

/** A close host with scripted answers, recording what was asked. */
function host(answers: UnsavedChoice[], saved: boolean[] = []) {
  const asked: { why: string; names: string[] }[] = [];
  const h: CloseHost & { asked: typeof asked; saves: number } = {
    asked,
    saves: 0,
    async askUnsaved(docs, why) {
      asked.push({ why, names: docs.map((d) => d.fileName) });
      return answers.shift() ?? 'cancel';
    },
    async saveActive() {
      h.saves += 1;
      return saved.shift() ?? true;
    },
  };
  return h;
}

describe('opening documents', () => {
  it('replaces an untouched start-up design and opens further designs in new tabs', async () => {
    const s = setup();
    expect(s.manager.count()).toBe(1);
    const d1 = newDesign('One');
    expect(await s.manager.open(d1, 'one.msim')).toBe(s.manager.activeId());
    // the empty start-up design was replaced, not left behind
    expect(s.manager.count()).toBe(1);
    expect(s.editor.getState().design.title).toBe('One');
    await s.manager.open(newDesign('Two'), 'two.msim');
    expect(s.manager.count()).toBe(2);
    expect(s.manager.list().map((d) => d.fileName)).toEqual(['one.msim', 'two.msim']);
    expect(s.manager.activeId()).toBe(s.manager.list()[1].id);
  });

  it('a design with content is never replaced', async () => {
    const s = setup();
    draw(s);
    await s.manager.open(newDesign('Two'), 'two.msim');
    expect(s.manager.count()).toBe(2);
  });

  it('a design opened from a file is not "pristine" even when it is empty', async () => {
    const s = setup();
    await s.manager.open(newDesign('One'), 'one.msim');
    await s.manager.open(newDesign('Two'), 'two.msim');
    expect(s.manager.count()).toBe(2);
  });

  it('the file layer can veto the replacement (a document saved under a path)', async () => {
    const s = setup();
    s.manager.setReplaceable(() => false);
    expect(s.manager.canOpen()).toBe(true);
    await s.manager.open(newDesign('Two'), 'two.msim');
    expect(s.manager.count()).toBe(2);
  });

  it('New (replace: false) always adds a tab', async () => {
    const s = setup();
    await s.manager.open(newDesign('Blank 2'), 'Untitled.msim', { replace: false });
    expect(s.manager.count()).toBe(2);
  });

  it('refuses to open more than the limit and says so (null)', async () => {
    const s = setup({ max: 2 });
    draw(s);
    expect(await s.manager.open(newDesign('B'), 'b.msim')).not.toBeNull();
    draw(s);
    expect(s.manager.canOpen()).toBe(false);
    expect(await s.manager.open(newDesign('C'), 'c.msim')).toBeNull();
    expect(s.manager.count()).toBe(2);
    expect(MAX_DOCUMENTS).toBe(16);
  });

  it('designIsEmpty looks at every kind of content', () => {
    expect(designIsEmpty(newDesign())).toBe(true);
    const s = setup();
    draw(s);
    expect(designIsEmpty(s.editor.getState().design)).toBe(false);
    expect(designIsEmpty({ ...newDesign(), children: [{ id: 'c', kind: 'subcircuit', name: 'x', sheets: [], variables: {} } as never] })).toBe(false);
  });
});

describe('document isolation', () => {
  it('each document has its own undo history, selection and dirty flag', async () => {
    const s = setup();
    draw(s, 2); // document A: two resistors, dirty
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    const b = s.manager.activeId();
    expect(isDirty(s.editor.getState())).toBe(false);
    expect(s.editor.getState().history.past).toHaveLength(0);
    draw(s, 1);
    s.editor.actions.selectAll();
    expect(s.editor.getState().selection).toHaveLength(1);

    await s.manager.switchTo(a);
    expect(partsOf(s)).toBe(2);
    expect(s.editor.getState().history.past).toHaveLength(2);
    expect(s.editor.getState().selection).toHaveLength(1); // the last placed part of A was selected
    s.editor.actions.undo();
    expect(partsOf(s)).toBe(1);

    await s.manager.switchTo(b);
    expect(partsOf(s)).toBe(1);
    expect(s.editor.getState().history.past).toHaveLength(1);
    // B's undo does not touch A
    s.editor.actions.undo();
    expect(partsOf(s)).toBe(0);
    await s.manager.switchTo(a);
    expect(partsOf(s)).toBe(1);
    expect(s.editor.getState().history.future).toHaveLength(1);
  });

  it('dirty flags follow the document: saving one leaves the others dirty', async () => {
    const s = setup();
    draw(s);
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    draw(s);
    const b = s.manager.activeId();
    expect(s.manager.dirtyDocuments().map((d) => d.id)).toEqual([a, b]);
    s.editor.actions.markSaved();
    expect(s.manager.dirtyDocuments().map((d) => d.id)).toEqual([a]);
    expect(s.manager.list().find((d) => d.id === b)!.dirty).toBe(false);
    await s.manager.switchTo(a);
    expect(isDirty(s.editor.getState())).toBe(true);
    expect(s.manager.list().find((d) => d.id === a)!.dirty).toBe(true);
  });

  it('the file name and title of each document are listed', async () => {
    const s = setup();
    await s.manager.open({ ...newDesign('Alpha') }, 'alpha.msim');
    await s.manager.open({ ...newDesign('Beta') }, 'beta.msim');
    expect(s.manager.list().map((d) => [d.fileName, d.title])).toEqual([
      ['alpha.msim', 'Alpha'],
      ['beta.msim', 'Beta'],
    ]);
  });

  it('simulation state (status, messages, probe values, rating states) stays with its document', async () => {
    const s = setup();
    draw(s);
    s.editor.actions.setSimStatus({ state: 'running', message: 'A runs', simTime: 0.5 });
    s.editor.actions.addSimMessage('info', 'message of A', 'test');
    s.editor.actions.setProbeValues({ p1: '3 V' });
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    expect(s.editor.getState().sim.state).toBe('idle');
    expect(s.editor.getState().simMessages).toHaveLength(0);
    expect(s.editor.getState().probeValues).toEqual({});
    s.editor.actions.addSimMessage('warning', 'message of B', 'test');
    await s.manager.switchTo(a);
    expect(s.editor.getState().sim).toMatchObject({ state: 'running', message: 'A runs', simTime: 0.5 });
    expect(s.editor.getState().simMessages.map((m) => m.text)).toEqual(['message of A']);
    expect(s.editor.getState().probeValues).toEqual({ p1: '3 V' });
  });

  it('per-sheet views and the active sheet are kept per document', async () => {
    const s = setup();
    const sheet2 = s.editor.actions.addSheet();
    s.editor.actions.setView(sheet2, { panX: 5, panY: 6, zoom: 2 });
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    expect(s.editor.getState().views).toEqual({});
    await s.manager.switchTo(a);
    expect(s.editor.getState().activeSheetId).toBe(sheet2);
    expect(s.editor.getState().views[sheet2]).toEqual({ panX: 5, panY: 6, zoom: 2 });
  });

  it('the clipboard is shared, so a copy in one document pastes into another', async () => {
    const s = setup();
    draw(s);
    s.editor.actions.selectAll();
    s.editor.actions.copy();
    await s.manager.open(newDesign('B'), 'b.msim');
    expect(partsOf(s)).toBe(0);
    s.editor.actions.paste({ x: 40, y: 40 });
    expect(partsOf(s)).toBe(1);
  });

  it('the tool is reset to Select when a document is shown', async () => {
    const s = setup();
    draw(s);
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    s.editor.actions.setTool({ kind: 'wire' });
    await s.manager.switchTo(a);
    expect(s.editor.getState().tool.kind).toBe('select');
  });
});

describe('extensions (file location, Grapher runs, simulation results)', () => {
  function withExtension(s: Setup) {
    let value = 'start';
    const log: string[] = [];
    const ext: DocumentExtension = {
      id: 'test',
      capture: () => value,
      restore: (d) => {
        value = (d as string | undefined) ?? 'new';
        log.push(`restore:${value}`);
      },
      beforeLeave: async () => {
        log.push('leave');
      },
    };
    s.manager.registerExtension(ext);
    return { get: () => value, set: (v: string) => (value = v), log };
  }

  it('captures when a document is left and restores when it returns; new documents start fresh', async () => {
    const s = setup();
    const ext = withExtension(s);
    ext.set('A-data');
    draw(s);
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    expect(ext.get()).toBe('new');
    ext.set('B-data');
    await s.manager.switchTo(a);
    expect(ext.get()).toBe('A-data');
    await s.manager.switchTo(s.manager.list()[1].id);
    expect(ext.get()).toBe('B-data');
    expect(ext.log.filter((l) => l === 'leave').length).toBe(3);
  });

  it('beforeLeave runs first (a running simulation is stopped before the document changes)', async () => {
    const s = setup();
    draw(s);
    const seen: string[] = [];
    s.manager.registerExtension({
      id: 'sim',
      capture: () => null,
      restore: () => undefined,
      beforeLeave: async () => {
        await Promise.resolve();
        seen.push(`design had ${partsOf(s)} part(s) when leaving`);
      },
    });
    await s.manager.open(newDesign('B'), 'b.msim');
    expect(seen).toEqual(['design had 1 part(s) when leaving']);
  });

  it('removing a document does not capture it but still lets extensions wind down', async () => {
    const s = setup();
    const ext = withExtension(s);
    draw(s);
    await s.manager.open(newDesign('B'), 'b.msim');
    ext.log.length = 0;
    await s.manager.remove(s.manager.activeId());
    expect(ext.log[0]).toBe('leave');
    expect(s.manager.count()).toBe(1);
  });
});

describe('switching', () => {
  async function three() {
    const s = setup();
    draw(s);
    const ids = [s.manager.activeId()];
    await s.manager.open(newDesign('B'), 'b.msim');
    ids.push(s.manager.activeId());
    await s.manager.open(newDesign('C'), 'c.msim');
    ids.push(s.manager.activeId());
    return { s, ids };
  }

  it('next / previous wrap around in tab order', async () => {
    const { s, ids } = await three();
    expect(s.manager.activeId()).toBe(ids[2]);
    await s.manager.next();
    expect(s.manager.activeId()).toBe(ids[0]);
    await s.manager.previous();
    expect(s.manager.activeId()).toBe(ids[2]);
    await s.manager.previous();
    expect(s.manager.activeId()).toBe(ids[1]);
  });

  it('"last used" toggles between the two most recent documents', async () => {
    const { s, ids } = await three();
    await s.manager.switchTo(ids[0]);
    await s.manager.switchToRecent();
    expect(s.manager.activeId()).toBe(ids[2]);
    await s.manager.switchToRecent();
    expect(s.manager.activeId()).toBe(ids[0]);
  });

  it('a single document has nothing to switch to', async () => {
    const s = setup();
    expect(await s.manager.next()).toBe(false);
    expect(await s.manager.switchToRecent()).toBe(false);
    expect(await s.manager.switchTo('missing')).toBe(false);
  });

  it('move reorders the tabs without changing the current document', async () => {
    const { s, ids } = await three();
    s.manager.move(ids[2], 0);
    expect(s.manager.list().map((d) => d.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(s.manager.activeId()).toBe(ids[2]);
  });

  it('rapid switches run one after another and end on the last one asked for', async () => {
    const { s, ids } = await three();
    const results = await Promise.all([s.manager.switchTo(ids[0]), s.manager.switchTo(ids[1]), s.manager.switchTo(ids[0])]);
    expect(results).toEqual([true, true, true]);
    expect(s.manager.activeId()).toBe(ids[0]);
    expect(partsOf(s)).toBe(1);
  });

  it('the view store follows the current document and its dirty flag', async () => {
    const { s, ids } = await three();
    expect(s.manager.view.getState().activeId).toBe(ids[2]);
    await s.manager.switchTo(ids[0]);
    expect(s.manager.view.getState().activeId).toBe(ids[0]);
    expect(s.manager.view.getState().docs.find((d) => d.id === ids[0])!.dirty).toBe(true);
  });
});

describe('closing', () => {
  it('closing a clean document asks nothing; the neighbour used last becomes current', async () => {
    const s = setup();
    draw(s);
    s.editor.actions.markSaved();
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    await s.manager.open(newDesign('C'), 'c.msim');
    const c = s.manager.activeId();
    await s.manager.switchTo(a);
    const h = host([]);
    expect(await s.manager.close(c, h)).toBe(true);
    expect(h.asked).toHaveLength(0);
    expect(s.manager.list().map((d) => d.fileName)).toEqual(['Untitled.msim', 'b.msim']);
    expect(s.manager.activeId()).toBe(a);
  });

  it('a dirty document asks about that document only; Cancel keeps it open', async () => {
    const s = setup();
    draw(s);
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    draw(s);
    const h = host(['cancel']);
    expect(await s.manager.close(a, h)).toBe(false);
    expect(h.asked).toEqual([{ why: 'close', names: ['Untitled.msim'] }]);
    expect(s.manager.count()).toBe(2);
    expect(h.saves).toBe(0);
  });

  it('Save saves that document (switching to it) and then closes it', async () => {
    const s = setup();
    draw(s);
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    draw(s);
    const saved: string[] = [];
    const h = host(['save']);
    h.saveActive = async () => {
      saved.push(s.editor.getState().fileName);
      s.editor.actions.markSaved();
      return true;
    };
    expect(await s.manager.close(a, h)).toBe(true);
    expect(saved).toEqual(['Untitled.msim']);
    expect(s.manager.list().map((d) => d.fileName)).toEqual(['b.msim']);
  });

  it('a failed or cancelled Save keeps the document', async () => {
    const s = setup();
    draw(s);
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    const h = host(['save'], [false]);
    expect(await s.manager.close(a, h)).toBe(false);
    expect(s.manager.count()).toBe(2);
  });

  it('Don\'t save drops the changes', async () => {
    const s = setup();
    draw(s);
    const a = s.manager.activeId();
    await s.manager.open(newDesign('B'), 'b.msim');
    const h = host(['discard']);
    expect(await s.manager.close(a, h)).toBe(true);
    expect(s.manager.count()).toBe(1);
    expect(h.saves).toBe(0);
  });

  it('closing the last document leaves one empty design', async () => {
    const s = setup();
    draw(s);
    s.editor.actions.markSaved();
    expect(await s.manager.close(s.manager.activeId(), host([]))).toBe(true);
    expect(s.manager.count()).toBe(1);
    expect(s.editor.getState().design.title).toBe('Blank');
    expect(isDirty(s.editor.getState())).toBe(false);
  });
});

describe('Close all, Save all and quit', () => {
  async function dirtyTrio() {
    const s = setup();
    draw(s);
    s.editor.actions.markSaved(); // A is clean
    await s.manager.open(newDesign('B'), 'b.msim');
    draw(s);
    await s.manager.open(newDesign('C'), 'c.msim');
    draw(s, 2);
    return s;
  }

  it('asks ONCE with the list of unsaved documents', async () => {
    const s = await dirtyTrio();
    const h = host(['discard']);
    expect(await s.manager.closeAll(h)).toBe(true);
    expect(h.asked).toEqual([{ why: 'closeAll', names: ['b.msim', 'c.msim'] }]);
    expect(s.manager.count()).toBe(1);
  });

  it('Cancel closes nothing', async () => {
    const s = await dirtyTrio();
    expect(await s.manager.closeAll(host(['cancel']))).toBe(false);
    expect(s.manager.count()).toBe(3);
  });

  it('Save all saves every dirty document, then closes', async () => {
    const s = await dirtyTrio();
    const savedNames: string[] = [];
    const h = host(['save']);
    h.saveActive = async () => {
      savedNames.push(s.editor.getState().fileName);
      s.editor.actions.markSaved();
      return true;
    };
    expect(await s.manager.closeAll(h)).toBe(true);
    expect(savedNames).toEqual(['b.msim', 'c.msim']);
    expect(s.manager.count()).toBe(1);
  });

  it('a save that fails stops Close all and keeps the documents open', async () => {
    const s = await dirtyTrio();
    let n = 0;
    const h = host(['save']);
    h.saveActive = async () => {
      n += 1;
      if (n === 2) return false;
      s.editor.actions.markSaved();
      return true;
    };
    expect(await s.manager.closeAll(h)).toBe(false);
    expect(s.manager.count()).toBe(3);
    // the first was saved, the second still has its changes
    expect(s.manager.dirtyDocuments().map((d) => d.fileName)).toEqual(['c.msim']);
  });

  it('nothing unsaved: no question at all', async () => {
    const s = setup();
    await s.manager.open(newDesign('B'), 'b.msim');
    const h = host([]);
    expect(await s.manager.closeAll(h)).toBe(true);
    expect(h.asked).toHaveLength(0);
  });

  it('quit asks once and leaves the documents open for the shell to end', async () => {
    const s = await dirtyTrio();
    const h = host(['discard']);
    expect(await s.manager.closeAll(h, 'quit')).toBe(true);
    expect(h.asked[0].why).toBe('quit');
    expect(s.manager.count()).toBe(3);
  });

  it('quit with Cancel keeps the window open', async () => {
    const s = await dirtyTrio();
    expect(await s.manager.closeAll(host(['cancel']), 'quit')).toBe(false);
  });

  it('saveAll returns to the document the learner was in', async () => {
    const s = await dirtyTrio();
    const current = s.manager.activeId();
    const h = host([]);
    h.saveActive = async () => {
      s.editor.actions.markSaved();
      return true;
    };
    expect(await s.manager.saveAll(h)).toBe(true);
    expect(s.manager.activeId()).toBe(current);
    expect(s.manager.dirtyDocuments()).toEqual([]);
  });

  it('dirtyContents lists the designs for the crash-recovery record', async () => {
    const s = await dirtyTrio();
    const c = s.manager.dirtyContents();
    expect(c.map((x) => x.fileName)).toEqual(['b.msim', 'c.msim']);
    expect(c.map((x) => x.design.sheets[0].parts.length)).toEqual([1, 2]);
  });
});
