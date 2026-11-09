import { describe, expect, it } from 'vitest';
import { runAnalyses } from '..';
import type { AnalysisSpec, ElementIR } from '../netlist';
import type { AnalysisResult } from '../results';
import { idc, netlist, res, vdc, vsrc } from '../engine/testing';
import { MIL_PER_OZ, ipc2221Width } from './tracewidth';

function tw(elements: ElementIR[], spec: Partial<Extract<AnalysisSpec, { type: 'tracewidth' }>>): AnalysisResult {
  const full: AnalysisSpec = { type: 'tracewidth', base: { type: 'tran', tstep: 1e-4, tstop: 0.02 }, tempRise: 10, copperOz: 1, external: true, ...spec };
  const [r] = runAnalyses(netlist(elements, [full]));
  expect(r.error).toBeUndefined();
  return r;
}

describe('IPC-2221 width', () => {
  it('follows I = k ΔT^0.44 A^0.725', () => {
    const w = ipc2221Width(1, 10, 1, true);
    const area = Math.pow(1 / (0.048 * Math.pow(10, 0.44)), 1 / 0.725);
    expect(w.areaMil2).toBeCloseTo(area, 12);
    expect(w.areaMil2).toBeCloseTo(16.3, 1);
    expect(w.widthMil).toBeCloseTo(area / MIL_PER_OZ, 12);
    expect(w.widthMm).toBeCloseTo((area / MIL_PER_OZ) * 0.0254, 12);
    // inverse check: the formula gives back the current
    expect(0.048 * Math.pow(10, 0.44) * Math.pow(w.areaMil2, 0.725)).toBeCloseTo(1, 12);
  });

  it('scales with layer, copper weight and temperature rise', () => {
    const ext = ipc2221Width(2, 20, 1, true);
    const int = ipc2221Width(2, 20, 1, false);
    expect(int.areaMil2 / ext.areaMil2).toBeCloseTo(Math.pow(2, 1 / 0.725), 12);
    expect(ipc2221Width(2, 20, 2, true).widthMil).toBeCloseTo(ext.widthMil / 2, 12);
    expect(ipc2221Width(2, 40, 1, true).areaMil2 / ext.areaMil2).toBeCloseTo(Math.pow(2, -0.44 / 0.725), 12);
    expect(ipc2221Width(0, 10, 1, true).widthMil).toBe(0);
    expect(() => ipc2221Width(1, 0, 1, true)).toThrow();
  });
});

describe('trace width analysis', () => {
  it('sizes traces for the RMS current of a sine', () => {
    // 10 V amplitude across 10 Ω: 1 A peak, 1/√2 A rms through R1, V1 and both nets
    const r = tw([vsrc('V1', 'a', '0', { tran: { type: 'SIN', args: [0, 10, 50] } }), res('R1', 'a', '0', 10)], {});
    const rows = r.table?.rows ?? [];
    expect(rows.map((x) => x[0]).sort()).toEqual(['0', 'a']);
    for (const row of rows) {
      expect(Math.abs((row[1] as number) - Math.SQRT1_2)).toBeLessThan(1e-4);
      // the peak is taken from the samples: within 1 - cos(ω·tstep/2) of the true crest
      expect(Math.abs((row[2] as number) - 1)).toBeLessThan(1 - Math.cos(2 * Math.PI * 50 * 0.5e-4) + 1e-9);
    }
    const expected = ipc2221Width(Math.SQRT1_2, 10, 1, true).widthMil;
    expect(Math.abs((r.scalars?.['width(a)'] as number) / expected - 1)).toBeLessThan(2e-4);
    expect(r.scalars?.max_width_mm).toBeCloseTo((r.scalars?.max_width_mil as number) * 0.0254, 12);
    expect(Math.abs((rows[0][6] as number) / ipc2221Width(1, 10, 1, true).widthMil - 1)).toBeLessThan(2e-4);
    expect(r.runs?.[0].result.type).toBe('tran');
  });

  it('assigns each net the largest terminal current connected to it', () => {
    // 3 A source feeding R1 || R2 (1 Ω and 2 Ω): 2 A and 1 A branches, 3 A in the source
    const r = tw([idc('I1', '0', 'a', 3), res('R1', 'a', '0', 1), res('R2', 'a', '0', 2)], {
      base: { type: 'tran', tstep: 1e-3, tstop: 1e-2 },
      external: false,
      copperOz: 2,
      tempRise: 20,
    });
    const row = (r.table?.rows ?? []).find((x) => x[0] === 'a') as (string | number)[];
    expect(row[1] as number).toBeCloseTo(3, 9);
    expect(row[3]).toBe('I1');
    expect(row[4] as number).toBeCloseTo(ipc2221Width(3, 20, 2, false).widthMil, 6);
  });

  it('warns outside the IPC-2221 range and validates its inputs', () => {
    const r = tw([vdc('V1', 'a', '0', 50), res('R1', 'a', '0', 1)], { base: { type: 'tran', tstep: 1e-3, tstop: 1e-2 }, tempRise: 5 });
    expect(r.warnings.some((w) => /35 A/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /10–100/.test(w))).toBe(true);
    const [bad] = runAnalyses(
      netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 1)], [{ type: 'tracewidth', base: { type: 'tran', tstep: 1e-3, tstop: 1e-2 }, tempRise: 10, copperOz: 0, external: true }]),
    );
    expect(bad.error).toMatch(/copper/);
  });
});
