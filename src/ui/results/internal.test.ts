/**
 * Grapher operating-point view: helper vectors the netlister adds (LED current-sense source,
 * nodes inside a part) are hidden unless "show internal" is on, and the operating point is listed
 * in a single table.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { runAnalyses } from '../../sim';
import { setLang } from '../../i18n';
import { buildPlotData, internalVectorCount, isInternalVector, resultTables } from './plotModel';
import type { AnalysisResult } from '../../sim/results';

setLang('en');

function ledOperatingPoint(): AnalysisResult {
  const b = new DesignBuilder('led');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  b.part('sources/ground', 'GND1', 0, 100);
  const r = b.part('basic/resistor', 'R1', 100, 0, { value: '220' });
  const d = b.part('diodes/led-red', 'LED1', 200, 0, {});
  b.wire(b.pin(v, '+'), b.pin(r, '1'));
  b.wire(b.pin(r, '2'), b.pin(d, 'A'));
  b.wire(b.pin(d, 'K'), { x: 0, y: 100 });
  b.wire(b.pin(v, '-'), { x: 0, y: 100 });
  const build = buildNetlist(b.design);
  build.netlist.analyses = [{ type: 'op' }];
  return runAnalyses(build.netlist)[0];
}

describe('internal helper vectors', () => {
  it('classifies helper vectors and keeps user-visible ones', () => {
    for (const n of ['I(V_LED1_i)', 'P(V_LED1_i)', 'V(LED1.a)', 'I(V_XFG1_p)', 'I(V_PWR_VCC)', 'V(NC_R1_2)']) expect(isInternalVector(n), n).toBe(true);
    for (const n of ['V(N1)', 'I(R1)', 'P(D_LED1)', 'I(V1)', 'I(V_PR_P1)', 'V(OUT_1)', 'V(a,b)', 'time']) expect(isInternalVector(n), n).toBe(false);
  });

  it('never hides postprocessor expressions, also those reading other pages', () => {
    for (const n of ['V(OUT) - tran1.V(OUT)', 'db(V(out)/V(in))', 'tran2.V(out)*2', 'digital(V(q), 2.5)']) expect(isInternalVector(n), n).toBe(false);
  });

  it('shows one operating-point table without the LED sense source by default', () => {
    const op = ledOperatingPoint();
    expect(op.error).toBeUndefined();
    expect(internalVectorCount(op)).toBe(3);
    const tables = resultTables(op);
    expect(tables).toHaveLength(1);
    expect(tables[0].title).toBe('Operating point');
    const names = tables[0].rows.map((r) => r[0]);
    expect(names).toContain('V(N2)');
    expect(names).toContain('I(R1)');
    expect(names).not.toContain('I(V_LED1_i)');
    expect(names).not.toContain('P(V_LED1_i)');
    expect(names).not.toContain('V(LED1.a)');
    const all = resultTables(op, { showInternal: true });
    expect(all).toHaveLength(1);
    expect(all[0].rows.map((r) => r[0])).toContain('I(V_LED1_i)');
    // LED current ≈ (5 V − VF) / 220 Ω
    const i = Number(tables[0].rows.find((r) => r[0] === 'I(R1)')![1]);
    expect(i).toBeGreaterThan(0.013);
    expect(i).toBeLessThan(0.0155);
  });

  it('leaves helper traces out of plots unless asked', () => {
    const scale = { name: 'time', unit: 's' as const, re: new Float64Array([0, 1]) };
    const res: AnalysisResult = {
      type: 'tran',
      title: 'Transient analysis',
      scale,
      vectors: [
        { name: 'V(out)', unit: 'V', re: new Float64Array([0, 1]) },
        { name: 'I(V_LED1_i)', unit: 'A', re: new Float64Array([0, 1e-3]) },
      ],
      warnings: [],
    };
    expect(buildPlotData(res)!.traces.map((t) => t.vector)).toEqual(['V(out)']);
    expect(buildPlotData(res, { showInternal: true })!.traces.map((t) => t.vector)).toEqual(['V(out)', 'I(V_LED1_i)']);
  });
});
