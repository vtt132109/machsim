/**
 * Learner help: the tutorial covers the basic workflow, and every component group, family,
 * instrument and analysis has a "What is this?" page in both languages. Contextual help (F1)
 * picks the selected part or instrument.
 */
import { describe, expect, it } from 'vitest';
import { GROUPS, listParts, getPart } from '../library';
import type { AnalysisType } from '../sim/netlist';
import { ANALYSIS_HELP, FAMILY_HELP, GETTING_STARTED, GROUP_HELP, INSTRUMENT_HELP, type HelpEntry } from './help';
import { INSTRUMENT_KINDS } from '../ui/instruments/titles';
import { ANALYSIS_ORDER } from '../ui/app/menus';
import { contextTopic, setFocusHelp, topicForPart } from '../ui/help/open';
import { newDesign } from '../model/types';
import { PART_HELP } from './partHelp';
import { SIGNAL_BLOCK_CATALOG } from '../library/catalog/signalBlocks';
import { GUIDE_ORDER, GUIDE_PAGES } from './helpGuides';
import { loadAllGroups } from '../library';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

function complete(e: HelpEntry | undefined): boolean {
  if (!e) return false;
  return [e.what, e.use, e.read, e.tip].every((x) => x === undefined || (x.vi.trim().length > 10 && x.en.trim().length > 10 && x.vi !== x.en));
}

describe('help content', () => {
  it('walks a beginner through place, wire, values, instrument, run and read', () => {
    expect(GETTING_STARTED.length).toBeGreaterThanOrEqual(7);
    const text = GETTING_STARTED.map((s) => `${s.title.vi} ${s.body.vi}`).join(' ').toLowerCase();
    for (const word of ['đặt', 'nối dây', 'giá trị', 'đồng hồ vạn năng', 'chạy', 'f5', 'đọc']) expect(text).toContain(word);
    for (const s of GETTING_STARTED) expect(s.title.en && s.body.en).toBeTruthy();
  });

  it('has a page for every group and family of the library', () => {
    expect(GROUPS.filter((g) => !complete(GROUP_HELP[g.id])).map((g) => g.id)).toEqual([]);
    const families = new Set(listParts().map((p) => p.family || 'General'));
    expect([...families].filter((f) => !complete(FAMILY_HELP[f]))).toEqual([]);
  });

  it('has a part page for every round-3 source and control block, and for the ABM sources', () => {
    const ids = [...SIGNAL_BLOCK_CATALOG.map((p) => p.id), 'sources/behavioral-voltage', 'sources/behavioral-current'];
    expect(ids.filter((id) => !complete(PART_HELP[id]))).toEqual([]);
    expect(Object.keys(PART_HELP).filter((id) => !getPart(id))).toEqual([]);
    for (const id of ['signalBlocks', 'spiceMeasure'] as const) {
      expect(GUIDE_ORDER).toContain(id);
      for (const sec of GUIDE_PAGES[id].sections) expect(sec.body.vi.length > 100 && sec.body.en.length > 100 && sec.body.vi !== sec.body.en).toBe(true);
    }
  });

  it('has a page with "how to read it" for every instrument and analysis', () => {
    expect(INSTRUMENT_KINDS.filter((k) => !complete(INSTRUMENT_HELP[k]) || !INSTRUMENT_HELP[k].read)).toEqual([]);
    expect(ANALYSIS_ORDER.filter((a: AnalysisType) => !complete(ANALYSIS_HELP[a]) || !ANALYSIS_HELP[a].read)).toEqual([]);
  });

  it('F1 explains the selected part, or the instrument itself', () => {
    const d = newDesign();
    d.sheets[0].parts.push(
      { id: 'p1', partId: 'basic/resistor', refdes: 'R1', x: 0, y: 0, rotation: 0, mirror: false, params: {} },
      { id: 'p2', partId: 'instruments/scope', refdes: 'XSC1', x: 100, y: 0, rotation: 0, mirror: false, params: {} },
    );
    expect(contextTopic({ design: d, selection: [{ kind: 'part', id: 'p1' }] })).toEqual({ kind: 'part', partId: 'basic/resistor' });
    expect(contextTopic({ design: d, selection: [{ kind: 'part', id: 'p2' }] })).toEqual({ kind: 'instrument', instrument: 'oscilloscope' });
    expect(contextTopic({ design: d, selection: [] })).toEqual({ kind: 'index' });
    expect(topicForPart(getPart('instruments/multimeter')!)).toEqual({ kind: 'instrument', instrument: 'multimeter' });
  });

  it('F1 prefers the focused component-browser row (group, family) and falls back afterwards', () => {
    const d = newDesign();
    d.sheets[0].parts.push({ id: 'p1', partId: 'basic/resistor', refdes: 'R1', x: 0, y: 0, rotation: 0, mirror: false, params: {} });
    const state = { design: d, selection: [{ kind: 'part' as const, id: 'p1' }] };
    let focused: ReturnType<typeof contextTopic> | null = { kind: 'group', group: 'basic' };
    const off = setFocusHelp(() => focused);
    expect(contextTopic(state)).toEqual({ kind: 'group', group: 'basic' });
    focused = { kind: 'family', group: 'diodes', family: 'LED' };
    expect(contextTopic(state)).toEqual({ kind: 'family', group: 'diodes', family: 'LED' });
    // focus left the browser: the provider answers null and the selection is explained
    focused = null;
    expect(contextTopic(state)).toEqual({ kind: 'part', partId: 'basic/resistor' });
    off();
    focused = { kind: 'group', group: 'basic' };
    expect(contextTopic(state)).toEqual({ kind: 'part', partId: 'basic/resistor' });
  });
});
