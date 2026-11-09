/**
 * Live read-outs of the new displays end to end: the LCD example design simulates through the
 * netlister, and the indicator pipeline (neededVectors, liveLevels, indicatorReadings) shows the
 * text the pattern source wrote, and the schematic renderer draws the LCD characters.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import { lcdHelloExample } from './exampleDesigns';
import { indicatorReadings, liveLevels, neededVectors } from './live';
import { PartGlyph } from '../editor/scene';
import { displayCells, lcdChar } from '../editor/displayGlyphs';
import { getPart } from '../../library';
import { setLang } from '../../i18n';

describe('character LCD live read-out', () => {
  it('the LCD example shows its text in the Simulation tab and on the schematic', () => {
    setLang('en');
    const design = lcdHelloExample();
    const build = buildNetlist(design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const lcd = build.indicators.find((i) => i.kind === 'lcd')!;
    expect(lcd.signals!.length).toBe(32 + 1 + 64);
    // every LCD code node is recorded during an interactive run
    const needed = neededVectors(build).map((n) => n.toLowerCase());
    expect(needed).toContain('v(lcd1.c0)');
    expect(needed).toContain('v(lcd1.st)');
    const spec = design.analysis.specs.tran!;
    const [r] = runAnalyses({ ...build.netlist, analyses: [spec] });
    expect(r.error).toBeUndefined();
    const last: Record<string, number> = {};
    for (const v of r.vectors) last[v.name] = v.re[v.re.length - 1];
    const reading = indicatorReadings(build.indicators, last).find((x) => x.refdes === 'LCD1')!;
    expect(reading.text).toBe('shows: Xin chao! | MachSim LCD');
    const levels = liveLevels(build.indicators, last).schematic;
    expect(levels['LCD1#0']).toBe('X'.charCodeAt(0));
    const def = getPart('indicators/lcd-16x2')!;
    const cells = displayCells(def, 'LCD1', levels)!;
    expect(cells.length).toBe(97);
    const inst = design.sheets[0].parts.find((p) => p.refdes === 'LCD1')!;
    const svg = renderToStaticMarkup(createElement('svg', null, createElement(PartGlyph, { inst, def, level: levels.LCD1, cells })));
    for (const ch of 'MachSim') expect(svg).toContain(`>${ch}</text>`);
    setLang('vi');
  });

  it('maps HD44780 ROM codes to characters', () => {
    expect(['A', 'z', '1'].map((c) => lcdChar(c.charCodeAt(0)))).toEqual(['A', 'z', '1']);
    expect(lcdChar(0x7e)).toBe('→');
    expect(lcdChar(0x5c)).toBe('¥');
    expect(lcdChar(0xdf)).toBe('°');
  });
});
