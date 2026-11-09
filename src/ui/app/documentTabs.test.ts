/**
 * The shell's document functions with several designs open: opening puts a design in a tab of its
 * own (never discarding the current one), autosave writes ONE recovery record that holds every
 * unsaved design, and crash recovery brings them all back, each in a tab.
 */
import { describe, expect, it } from 'vitest';
import { actions, getState } from '../store';
import { isDirty } from '../store/editorStore';
import { documents } from './documentSet';
import { buildRecoveryRecord, confirmDiscardChanges, loadDesignText, newDocument, openGeneratedDesign, syncRecovery, recoveryStore } from './document';
import { parseAutosave, recordDocuments } from './files';
import { browserRecoveryStore } from './recovery';
import { DesignBuilder } from '../../model/designkit';
import { serializeDesign } from '../../model/serialize';
import { newDesign } from '../../model/types';
import { setLang } from '../../i18n';

setLang('en');

function design(title: string, resistors: number) {
  const b = new DesignBuilder(title);
  for (let i = 0; i < resistors; i++) b.part('basic/resistor', `R${i + 1}`, i * 100, 0);
  return b.design;
}

describe('opening designs in tabs', () => {
  it('opens files, generated designs and New designs in tabs of their own and discards nothing', async () => {
    // the start-up design is empty and untouched: the first design replaces it
    expect(documents.count()).toBe(1);
    expect(await loadDesignText(serializeDesign(design('Alpha', 2)), 'alpha.msim', null, true)).toBe(true);
    expect(documents.count()).toBe(1);
    expect(getState().design.title).toBe('Alpha');
    // edit it: the next open must not touch it
    actions.placePart('basic/resistor', { x: 0, y: 300 });
    expect(isDirty(getState())).toBe(true);
    expect(await openGeneratedDesign(design('Beta', 1), 'beta.msim')).toBe(true);
    expect(documents.count()).toBe(2);
    expect(getState().design.title).toBe('Beta');
    expect(documents.list().map((d) => [d.fileName, d.dirty])).toEqual([
      ['alpha.msim', true],
      ['beta.msim', true], // generated designs are unsaved
    ]);
    await newDocument();
    expect(documents.count()).toBe(3);
    expect(getState().fileName).toBe('Untitled.msim');
    // back to Alpha: its edit is still there
    await documents.switchTo(documents.list()[0].id);
    expect(getState().design.sheets[0].parts).toHaveLength(3);
  });

  it('confirmDiscardChanges only refuses when the limit of open documents is reached', async () => {
    expect(await confirmDiscardChanges()).toBe(true);
    expect(documents.canOpen()).toBe(true);
  });
});

describe('the same desktop file', () => {
  it('opening a file that is already open shows its tab instead of opening a copy', async () => {
    const before = documents.count();
    const target = { kind: 'desktop' as const, path: 'C:\\work\\same.msim' };
    expect(await loadDesignText(serializeDesign(design('Same', 1)), 'same.msim', target, true)).toBe(true);
    expect(documents.count()).toBe(before + 1);
    const id = documents.activeId();
    await documents.switchTo(documents.list()[0].id);
    expect(documents.activeId()).not.toBe(id);
    // opened again (different letter case, as Windows paths are): the existing tab comes back
    expect(await loadDesignText(serializeDesign(design('Same', 1)), 'same.msim', { kind: 'desktop', path: 'c:\\WORK\\Same.msim' }, true)).toBe(true);
    expect(documents.count()).toBe(before + 1);
    expect(documents.activeId()).toBe(id);
  });
});

describe('moving content between designs', () => {
  it('copies a selection into another open design and shows it there; the source stays as it was', async () => {
    const { copySelectionToDocument, placePartInDocument } = await import('./documentFlows');
    await openGeneratedDesign(design('Source', 2), 'source.msim');
    const source = documents.activeId();
    await openGeneratedDesign(design('Target', 0), 'target.msim');
    const targetId = documents.activeId();
    await documents.switchTo(source);
    actions.selectAll();
    expect(await copySelectionToDocument(targetId)).toBe(true);
    expect(documents.activeId()).toBe(targetId);
    expect(getState().design.title).toBe('Target');
    expect(getState().design.sheets[0].parts.map((p) => p.refdes)).toEqual(['R1', 'R2']);
    // the source design is untouched
    await documents.switchTo(source);
    expect(getState().design.sheets[0].parts).toHaveLength(2);
    // a library part dropped on a tab is placed in that design
    expect(await placePartInDocument(targetId, 'basic/capacitor')).toBe(true);
    expect(getState().design.title).toBe('Target');
    expect(getState().design.sheets[0].parts.map((p) => p.refdes)).toEqual(['R1', 'R2', 'C1']);
  });

  it('does nothing for the document that is already current or without a selection', async () => {
    const { copySelectionToDocument, placePartInDocument } = await import('./documentFlows');
    const here = documents.activeId();
    actions.clearSelection();
    expect(await copySelectionToDocument(here)).toBe(false);
    expect(await placePartInDocument(here, 'basic/resistor')).toBe(false);
    const other = documents.list().find((d) => d.id !== here)!;
    expect(await copySelectionToDocument(other.id)).toBe(false);
    expect(documents.activeId()).toBe(here);
  });
});

describe('autosave and recovery of every open design', () => {
  it('writes one record with the first unsaved design in front and the others in `others`', () => {
    const rec = buildRecoveryRecord(1234)!;
    expect(rec).toBeTruthy();
    const docs = recordDocuments(rec);
    expect(docs.map((d) => d.fileName)).toEqual(documents.dirtyDocuments().map((d) => d.fileName));
    expect(docs.length).toBeGreaterThanOrEqual(2);
    expect(rec.savedAt).toBe(1234);
    // the JSON in the recovery slot reads back to the same documents
    const back = parseAutosave(JSON.stringify(rec))!;
    expect(recordDocuments(back)).toEqual(docs);
    for (const d of docs) expect(() => JSON.parse(d.text)).not.toThrow();
  });

  it('an older single-design record still reads as one document', () => {
    const old = parseAutosave(JSON.stringify({ fileName: 'old.msim', savedAt: 5, text: serializeDesign(newDesign('Old')) }))!;
    expect(recordDocuments(old).map((d) => d.fileName)).toEqual(['old.msim']);
    expect(old.others).toBeUndefined();
  });

  it('a damaged `others` entry is ignored, the rest of the record survives', () => {
    const rec = parseAutosave(JSON.stringify({ fileName: 'a.msim', savedAt: 1, text: '{}', others: [{ fileName: 'b.msim' }, { fileName: 'c.msim', savedAt: 2, text: '{}' }, 7] }))!;
    expect(recordDocuments(rec).map((d) => d.fileName)).toEqual(['a.msim', 'c.msim']);
  });

  it('the browser recovery slot stores and returns the whole record', async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const slot = browserRecoveryStore(storage);
    const rec = buildRecoveryRecord(99)!;
    expect(await slot.writeRecord(rec)).toBe(true);
    const read = (await slot.readRecord())!;
    expect(recordDocuments(read).map((d) => d.fileName)).toEqual(recordDocuments(rec).map((d) => d.fileName));
  });

  it('saving the only unsaved design clears the slot; with another still unsaved the slot keeps that one', async () => {
    // mark every design saved except the current one
    for (const d of documents.list()) {
      if (d.id === documents.activeId()) continue;
      await documents.switchTo(d.id);
      actions.markSaved();
    }
    await documents.switchTo(documents.list()[0].id);
    const active = documents.activeId();
    actions.placePart('basic/resistor', { x: 0, y: 500 });
    expect(documents.dirtyDocuments().map((d) => d.id)).toContain(active);
    const rec = buildRecoveryRecord()!;
    expect(recordDocuments(rec).map((d) => d.fileName)).toEqual(documents.dirtyDocuments().map((d) => d.fileName));
    actions.markSaved();
    for (const d of documents.list()) {
      await documents.switchTo(d.id);
      actions.markSaved();
    }
    expect(buildRecoveryRecord()).toBeNull();
    syncRecovery();
    expect(await recoveryStore().readRecord()).toBeNull();
  });
});
