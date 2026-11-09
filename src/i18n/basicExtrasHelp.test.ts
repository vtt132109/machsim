/**
 * Learner help of the round-3 Basic / Analog / Misc parts: every new family has a complete
 * "What is this?" page, the parts with their own behaviour (non-ideal R / L / C, Z loads,
 * multi-control switches, magnetic cores, annotation markers, OTA / CFA / PLL / isolation amplifier,
 * gate drivers) have an F1 page in both languages, and the "Real parts" guide is in the help browser.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { BASIC_EXTRA_CATALOG } from '../library/catalog/basicExtras';
import { ANALOG_EXTRA_CATALOG } from '../library/catalog/analogExtras';
import { FAMILY_HELP, type HelpEntry } from './help';
import { PART_HELP } from './partHelp';
import { GUIDE_ORDER, GUIDE_PAGES } from './helpGuides';
import { BASIC_EXTRA_PART_HELP } from './basicExtrasHelp';

const complete = (e: HelpEntry | undefined): boolean =>
  !!e && [e.what, e.use, e.read, e.tip].every((x) => x === undefined || (x.vi.trim().length > 10 && x.en.trim().length > 10 && x.vi !== x.en)) && !!e.what && !!e.read;

describe('round-3 part help', () => {
  it('every new family has a page with what / how to read it', () => {
    // (Switch, Transformer, Inductor and Instrumentation amplifier pages existed before round 3)
    const older = new Set(['Switch', 'Transformer', 'Inductor', 'Instrumentation amplifier']);
    const families = new Set([...BASIC_EXTRA_CATALOG, ...ANALOG_EXTRA_CATALOG].map((p) => p.family).filter((f) => !older.has(f)));
    expect(families.size).toBe(13);
    expect([...families].filter((f) => !complete(FAMILY_HELP[f]))).toEqual([]);
  });

  it('parts with their own behaviour have an F1 page, and every page belongs to a real part', () => {
    const ids = [
      'basic/nonideal-capacitor',
      'basic/nonideal-inductor',
      'basic/nonideal-resistor',
      'basic/nonideal-electrolytic',
      'basic/z-load-rx',
      'basic/z-load-polar',
      'basic/dip-switch-8',
      'basic/rotary-switch-6',
      'basic/keypad-4x4',
      'basic/transformer-saturating',
      'basic/inductor-saturating',
      'basic/coupled-inductors-3',
      'basic/transformer-2p2s',
      'basic/no-connect',
      'basic/earth-marker',
      'analog/ota',
      'analog/cfoa',
      'analog/pll',
      'analog/isolation-amplifier',
      'misc/gate-driver',
      'misc/half-bridge-driver',
    ];
    expect(ids.filter((id) => !complete(PART_HELP[id]))).toEqual([]);
    expect(Object.keys(BASIC_EXTRA_PART_HELP).filter((id) => !getPart(id))).toEqual([]);
    // the markers say plainly that they do not ground anything
    expect(PART_HELP['basic/earth-marker'].read!.vi).toMatch(/KHÔNG nối/);
  });

  it('the real-parts guide is listed with substantial sections in both languages', () => {
    expect(GUIDE_ORDER).toContain('realParts');
    const page = GUIDE_PAGES.realParts;
    expect(page.sections.length).toBeGreaterThanOrEqual(4);
    for (const sec of page.sections) expect(sec.body.vi.length > 200 && sec.body.en.length > 200 && sec.body.vi !== sec.body.en).toBe(true);
  });
});
