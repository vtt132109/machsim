/**
 * File format of the simulation-tools fields: AnalysisSettings.saves / .expressions,
 * Design.interactive and user-defined analysis specs round-trip, are written only when present,
 * and invalid values are reported with JSON paths.
 */
import { describe, expect, it } from 'vitest';
import { newDesign } from './types';
import { DesignFormatError, parseDesign, serializeDesign } from './serialize';

describe('simulation settings in .msim files', () => {
  it('round-trips outputs, expressions, interactive settings and a user-defined analysis', () => {
    const d = newDesign('x');
    d.analysis.saves = ['V(out)', 'I(V1)'];
    d.analysis.expressions = ['V(out)/V(in)'];
    d.analysis.specs.user = { type: 'user', text: '.op\n.tran 1u 1m' };
    d.analysis.active = 'user';
    d.interactive = { initial: 'zero', tstep: 1e-6, tstop: 0.01 };
    d.options = { defl: 2e-6, defw: 1e-5 };
    const back = parseDesign(serializeDesign(d));
    expect(back.analysis).toEqual(d.analysis);
    expect(back.interactive).toEqual(d.interactive);
    expect(back.options).toEqual(d.options);
  });

  it('a design without the new settings is written exactly as before', () => {
    const text = serializeDesign(newDesign('x'));
    expect(text).not.toMatch(/saves|expressions|interactive/);
  });

  it('reports invalid values with their paths', () => {
    const raw = JSON.parse(serializeDesign(newDesign('x')));
    raw.analysis.saves = ['V(a)', 3];
    raw.interactive = { initial: 'later', tstop: -1 };
    try {
      parseDesign(JSON.stringify(raw));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DesignFormatError);
      expect((e as DesignFormatError).issues).toEqual([
        'analysis.saves: expected a list of strings',
        'interactive.initial: must be auto, op, zero or uic (got "later")',
        'interactive.tstop: expected a positive number (got -1)',
      ]);
    }
  });
});
