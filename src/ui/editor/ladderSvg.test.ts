/**
 * Drawing a ladder sheet as SVG (print, Export image, the sample preview).
 */
import { describe, expect, it } from 'vitest';
import { addOutput, insertParallel, insertSeries, newRung, withLogic } from '../../ladder/edit';
import type { LadderRung } from '../../ladder/types';
import { LADDER_COL, LADDER_RAIL_LEFT, LADDER_COIL_COL, ladderDiagramWidth, ladderSheetSvg } from './ladderSvg';

/** I0.0 in series with I0.1, driving the coil Q0.0 — the start / stop rung of sample 55. */
function startStop(): LadderRung {
  const r = newRung('r1', 'I0.0', 'Q0.0');
  return withLogic(r, insertSeries(r.logic, [], { kind: 'contact', type: 'no', address: 'I0.1' }));
}

describe('ladderSheetSvg', () => {
  it('draws every address of a rung and the two rails', () => {
    const { markup, width, height } = ladderSheetSvg([startStop()]);
    for (const address of ['I0.0', 'I0.1', 'Q0.0']) expect(markup).toContain(`>${address}<`);
    expect(width).toBe(ladderDiagramWidth(2));
    expect(width).toBe(LADDER_RAIL_LEFT + 2 * LADDER_COL + LADDER_COIL_COL + 40);
    expect(height).toBeGreaterThan(60);
    // the rails are the two full-height lines of the rung
    expect([...markup.matchAll(/stroke-width:3/g)].length).toBe(2);
    // colours come from the export palette, so the same markup prints in colour and in mono
    expect(markup).toContain('var(--wire)');
    expect(markup).not.toContain('#');
  });

  it('a parallel branch adds a row and two vertical links', () => {
    const base = startStop();
    const r = withLogic(base, insertParallel(base.logic, [0], { kind: 'contact', type: 'no', address: 'Q0.0' }));
    const one = ladderSheetSvg([startStop()]);
    const two = ladderSheetSvg([r]);
    expect(two.height).toBeGreaterThan(one.height);
    expect(two.markup).toContain('>Q0.0<');
  });

  it('a timer coil shows its code and its preset', () => {
    let r = newRung('r2', 'I0.0', 'Q0.1');
    r = addOutput(r, { kind: 'ton', address: 'T1', preset: '5' }, 0);
    const { markup } = ladderSheetSvg([r]);
    expect(markup).toContain('>T1<');
    expect(markup).toContain('>5<');
    expect(markup).toContain('>Q0.1<');
  });

  it('escapes a rung comment and keeps the caption', () => {
    const r = { ...startStop(), comment: 'a < b & "c"' };
    const { markup } = ladderSheetSvg([r]);
    expect(markup).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(markup).not.toContain('a < b');
  });

  it('an empty program draws nothing', () => {
    expect(ladderSheetSvg([]).markup).toBe('');
  });
});
