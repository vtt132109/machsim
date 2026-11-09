/**
 * The example designs shipped in examples/*.msim:
 *  - each file is exactly the serialised output of its builder in
 *    src/ui/integration/exampleDesigns.ts (run with MACHSIM_UPDATE_EXAMPLES=1 to rewrite them);
 *  - each file loads with parseDesign, netlists without ERC errors or warnings, and every saved
 *    analysis runs without an error;
 *  - the File > Open samples catalogue (examples.ts) lists every file, at least 40 schematic
 *    samples cover every topic of the sample browser, each with Vietnamese and English texts;
 *  - opening a sample names it and its sheets in the UI language ("Trang 1").
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDesign, serializeDesign } from '../src/model/serialize';
import { buildNetlist } from '../src/model/netlister';
import { runAnalyses } from '../src/sim';
import { EXAMPLES } from '../src/ui/integration/exampleDesigns';
import { SAMPLE_TOPICS, SPICE_EXAMPLES, exampleCatalog, sampleKey, uncataloguedExampleFiles } from '../src/ui/integration/examples';
import { localizeSample, sampleTitle } from '../src/ui/integration/SampleBrowser';
import { SAMPLE_TEXT, SAMPLE_TOPIC_TEXT } from '../src/i18n/samples';
import { setLang } from '../src/i18n';

const DIR = fileURLToPath(new URL('../examples/', import.meta.url));
const UPDATE = process.env.MACHSIM_UPDATE_EXAMPLES === '1';

describe('example files', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.file} matches its builder`, () => {
      const text = serializeDesign(ex.build());
      const path = DIR + ex.file;
      if (UPDATE || !existsSync(path)) {
        if (!UPDATE) throw new Error(`${ex.file} is missing: run the tests with MACHSIM_UPDATE_EXAMPLES=1`);
        writeFileSync(path, text, 'utf8');
      }
      expect(readFileSync(path, 'utf8')).toBe(text);
    });

    it(`${ex.file} loads, passes ERC and runs every saved analysis`, () => {
      const design = parseDesign(readFileSync(DIR + ex.file, 'utf8'));
      expect(design.title).toBe(ex.title);
      const build = buildNetlist(design, { includeAnalysis: false });
      expect(build.erc.map((m) => `${m.severity}: ${m.message}`)).toEqual([]);
      const specs = Object.values(design.analysis.specs);
      expect(specs.length).toBeGreaterThan(0);
      expect(design.analysis.specs[design.analysis.active]).toBeDefined();
      const results = runAnalyses({ ...build.netlist, analyses: specs.filter((s) => s !== undefined) });
      for (const r of results) expect(r.error, `${ex.file} ${r.type}`).toBeUndefined();
    });
  }

  it('every file in examples/ has a builder or metadata and a catalogue entry', async () => {
    const designs = readdirSync(DIR).filter((f) => f.endsWith('.msim')).sort();
    expect(designs).toEqual(EXAMPLES.map((e) => e.file).sort());
    const decks = readdirSync(DIR + 'spice').filter((f) => f.endsWith('.cir')).map((f) => `spice/${f}`).sort();
    expect(decks).toEqual(SPICE_EXAMPLES.map((e) => e.file).sort());
    expect(uncataloguedExampleFiles()).toEqual([]);
    const catalog = exampleCatalog();
    expect(catalog.filter((e) => e.kind === 'design').map((e) => e.file)).toEqual(EXAMPLES.map((e) => e.file));
    expect(catalog.filter((e) => e.kind === 'spice').map((e) => e.file)).toEqual(SPICE_EXAMPLES.map((e) => e.file));
    for (const entry of catalog) {
      expect(await entry.load()).toBe(readFileSync(DIR + entry.file, 'utf8'));
    }
  });

  it('SPICE deck titles match the catalogue', () => {
    for (const ex of SPICE_EXAMPLES) {
      const first = readFileSync(DIR + ex.file, 'utf8').split(/\r?\n/)[0].trim();
      expect(first).toBe(ex.title);
    }
  });

  it('ships at least 40 schematic samples, at least three per topic', () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(40);
    for (const topic of SAMPLE_TOPICS) expect(EXAMPLES.filter((e) => e.topic === topic).length, topic).toBeGreaterThanOrEqual(3);
    for (const e of [...EXAMPLES, ...SPICE_EXAMPLES]) expect(SAMPLE_TOPICS, e.file).toContain(e.topic);
  });

  it('has Vietnamese and English titles and summaries for every sample and topic', () => {
    for (const e of exampleCatalog()) {
      const text = SAMPLE_TEXT[sampleKey(e.file)];
      expect(text, e.file).toBeDefined();
      for (const v of [text.title, text.summary]) {
        expect(v.vi.trim(), e.file).not.toBe('');
        expect(v.en.trim(), e.file).not.toBe('');
        expect(v.vi, e.file).not.toBe(v.en);
      }
    }
    expect(Object.keys(SAMPLE_TEXT).sort()).toEqual(exampleCatalog().map((e) => sampleKey(e.file)).sort());
    for (const topic of SAMPLE_TOPICS) expect(SAMPLE_TOPIC_TEXT[topic].title.vi).not.toBe('');
  });

  it('opens a sample with its title and sheet names in the UI language', () => {
    const multi = EXAMPLES.find((e) => e.file === '44-multi-sheet.msim')!;
    const design = parseDesign(readFileSync(DIR + multi.file, 'utf8'));
    expect(design.sheets.map((s) => s.name)).toEqual(['Sheet 1', 'Sheet 2']);
    setLang('vi');
    try {
      const vi = localizeSample(design, sampleTitle(multi));
      expect(vi.title).toBe('Hai trang nối bằng đầu nối sang trang');
      expect(vi.sheets.map((s) => s.name)).toEqual(['Trang 1', 'Trang 2']);
      setLang('en');
      const en = localizeSample(design, sampleTitle(multi));
      expect(en.title).toBe('Two sheets joined by off-page connectors');
      expect(en.sheets.map((s) => s.name)).toEqual(['Sheet 1', 'Sheet 2']);
      // child designs' sheets are renamed as well
      setLang('vi');
      const blocks = EXAMPLES.find((e) => e.file === '43-subcircuit-cascade.msim')!;
      const child = localizeSample(parseDesign(readFileSync(DIR + blocks.file, 'utf8')), sampleTitle(blocks));
      expect(child.children?.[0].sheets[0].name).toBe('Trang 1');
    } finally {
      setLang('vi');
    }
  });
});
