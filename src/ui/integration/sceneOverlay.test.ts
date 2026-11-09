/**
 * Live indicator rendering on the schematic: a seven-segment part draws exactly the segments of
 * the mask the controller stores as its level; other indicators glow.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getPart } from '../../library';
import type { PartInstance } from '../../model/types';
import { SEGMENT_FONTS } from '../../sim/devices/digital';
import { PartGlyph } from '../editor/scene';

const inst = (partId: string, refdes: string): PartInstance => ({ id: 'p1', partId, refdes, x: 100, y: 100, rotation: 0, mirror: false, params: {} });
const lit = (svg: string) => (svg.match(/stroke="#ff3b30"/g) ?? []).length;

describe('seven-segment overlay', () => {
  for (const partId of ['indicators/seven-seg-ca', 'indicators/seven-seg-cc', 'indicators/hex-display']) {
    it(`${partId} lights the segments of the mask`, () => {
      const def = getPart(partId)!;
      for (const digit of [1, 7, 8]) {
        const mask = SEGMENT_FONTS.ttl7447[digit];
        const svg = renderToStaticMarkup(createElement('svg', null, createElement(PartGlyph, { inst: inst(partId, 'U1'), def, level: mask })));
        const bits = [0, 1, 2, 3, 4, 5, 6].filter((b) => (mask >> b) & 1).length;
        expect(lit(svg)).toBe(bits);
        expect(svg).not.toContain('ms-glow');
      }
      const dark = renderToStaticMarkup(createElement('svg', null, createElement(PartGlyph, { inst: inst(partId, 'U1'), def, level: 0 })));
      expect(lit(dark)).toBe(0);
    });
  }

  it('an LED glows instead', () => {
    const def = getPart('diodes/led-red')!;
    const svg = renderToStaticMarkup(createElement('svg', null, createElement(PartGlyph, { inst: inst('diodes/led-red', 'LED1'), def, level: 0.5 })));
    expect(svg).toContain('ms-glow');
    expect(lit(svg)).toBe(0);
  });
});
