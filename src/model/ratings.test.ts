/**
 * Rated parts: the netlister adds stress monitors only when burn-out is on; a stress of 1 is
 * found at the operating point or at the right transient instant; re-running with the part
 * opened shows the circuit after the failure.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { applyBlows, findBlowEvents, ratingStress } from './ratings';
import { runAnalyses } from '../sim';
import type { AnalysisResult } from '../sim/results';

const vec = (r: AnalysisResult, name: string) => r.vectors.find((v) => v.name.toLowerCase() === name.toLowerCase())!.re;

/** V1 (12 V or a step) across part U (pins 1/2 or +/-) through an optional series resistor. */
function bench(partId: string, params: Record<string, string>, source: Record<string, string> = { value: '12' }, sourceId = 'sources/dc-voltage', pins: [string, string] = ['1', '2'], rseries?: string) {
  const b = new DesignBuilder('rated');
  const v = b.part(sourceId, 'V1', -200, 0, source);
  const g = b.part('sources/ground', 'G1', -200, 200);
  b.connect(v, '-', g, '1');
  const p = b.part(partId, 'R1', 0, 0, params);
  if (rseries) {
    const r = b.part('basic/resistor', 'RS', -100, -100, { value: rseries });
    b.connect(v, '+', r, '1');
    b.connect(r, '2', p, pins[0]);
  } else b.connect(v, '+', p, pins[0]);
  b.labelPin(p, pins[1], '0');
  return buildNetlist(b.design, { includeAnalysis: false });
}

describe('rated parts in the netlist', () => {
  it('adds nothing while burn-out is off', () => {
    const off = bench('basic/res-100', {});
    expect(off.ratings).toBeUndefined();
    expect(off.netlist.elements.map((e) => e.name)).toEqual(['V1', 'R1']);
    const on = bench('basic/res-100', { burn: 'true' });
    expect(on.ratings).toHaveLength(1);
    expect(on.ratings![0]).toMatchObject({ refdes: 'R1', partId: 'basic/res-100', blowSource: 'V_R1_blow' });
    expect(on.ratings![0].terms.map((t) => [t.kind, t.limit])).toEqual([['power', 0.25]]);
    expect(on.erc.filter((m) => m.severity === 'error')).toEqual([]);
  });

  it('a 100 Ω / 0.25 W resistor on 12 V burns out at the operating point (1.44 W) and opens', () => {
    const build = bench('basic/res-100', { burn: 'true' });
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(op.error).toBeUndefined();
    expect(-vec(op, 'I(V1)')[0]).toBeCloseTo(0.12, 4);
    const values = new Map(op.vectors.map((v) => [v.name.toLowerCase(), v.re[0]]));
    expect(ratingStress(build.ratings![0], values)!.ratio).toBeCloseTo(1.44 / 0.25, 3);
    const events = findBlowEvents(build.ratings!, [op]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ refdes: 'R1', kind: 'power', limit: 0.25 });
    expect(events[0].value).toBeCloseTo(1.44, 3);
    expect(events[0].time).toBeUndefined();
    const [after] = runAnalyses({ ...applyBlows(build.netlist, events), analyses: [{ type: 'op' }] });
    expect(Math.abs(vec(after, 'I(V1)')[0])).toBeLessThan(1e-7);
  });

  it('a resistor within its rating stays intact', () => {
    const build = bench('basic/res-1k', { burn: 'true' });
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(findBlowEvents(build.ratings!, [op])).toEqual([]);
    const values = new Map(op.vectors.map((v) => [v.name.toLowerCase(), v.re[0]]));
    expect(ratingStress(build.ratings![0], values)!.ratio).toBeCloseTo(0.144 / 0.25, 3);
  });

  it('the thermal time constant delays a transient burn-out', () => {
    // 12 V step at 1 ms onto 100 Ω: P / Pmax = 5.76, heat = 5.76·(1 − e^(−t/τ)) reaches 1 after τ·ln(5.76/4.76)
    const build = bench('basic/res-100', { burn: 'true', tau: '10m' }, { v0: '0', v1: '12', tstep: '1m', trise: '1u' }, 'sources/step-voltage', ['1', '2']);
    const [tr] = runAnalyses({ ...build.netlist, analyses: [{ type: 'tran', tstep: 20e-6, tstop: 10e-3 }] });
    expect(tr.error).toBeUndefined();
    const [e] = findBlowEvents(build.ratings!, [tr]);
    const expected = 1e-3 + 10e-3 * Math.log(5.76 / 4.76);
    expect(e.time!).toBeGreaterThan(expected * 0.95);
    expect(e.time!).toBeLessThan(expected * 1.05);
    // re-run: the part works until the burn-out instant, then opens
    const [again] = runAnalyses({ ...applyBlows(build.netlist, [e]), analyses: [{ type: 'tran', tstep: 20e-6, tstop: 10e-3 }] });
    const t = again.scale!.re;
    const i = vec(again, 'I(V1)');
    const at = (x: number) => i[t.findIndex((v) => v >= x)];
    expect(-at(e.time! * 0.9)).toBeCloseTo(0.12, 3);
    expect(Math.abs(at(9e-3))).toBeLessThan(1e-6);
  });

  it('capacitor and electrolytic voltage ratings (including reverse polarity)', () => {
    const cap = bench('basic/rated-capacitor', { vrating: '10' }, { value: '12' }, 'sources/dc-voltage', ['1', '2'], '1k');
    const [op] = runAnalyses({ ...cap.netlist, analyses: [{ type: 'op' }] });
    const [e] = findBlowEvents(cap.ratings!, [op]);
    expect(e).toMatchObject({ kind: 'voltage', limit: 10 });
    expect(e.value).toBeCloseTo(12, 2);
    // electrolytic wired backwards: -12 V across + / - exceeds the 1 V reverse limit
    const rev = bench('basic/rated-electrolytic', {}, { value: '12' }, 'sources/dc-voltage', ['-', '+'], '1k');
    const [op2] = runAnalyses({ ...rev.netlist, analyses: [{ type: 'op' }] });
    const [e2] = findBlowEvents(rev.ratings!, [op2]);
    expect(e2).toMatchObject({ kind: 'voltage', limit: 1 });
    expect(e2.value).toBeCloseTo(12, 1);
  });

  it('an LED without a series resistor exceeds its current rating', () => {
    const led = bench('basic/rated-led', {}, { value: '5' }, 'sources/dc-voltage', ['A', 'K'], '22');
    const [op] = runAnalyses({ ...led.netlist, analyses: [{ type: 'op' }] });
    const [e] = findBlowEvents(led.ratings!, [op]);
    expect(e.kind).toBe('current');
    expect(e.limit).toBeCloseTo(0.03, 6);
    // (5 V − ≈ 2 V) / (22 Ω + 3 Ω) ≈ 0.12 A
    expect(e.value).toBeGreaterThan(0.08);
    // with 330 Ω the current is ≈ 9 mA: no burn-out
    const ok = bench('basic/rated-led', {}, { value: '5' }, 'sources/dc-voltage', ['A', 'K'], '330');
    const [op2] = runAnalyses({ ...ok.netlist, analyses: [{ type: 'op' }] });
    expect(findBlowEvents(ok.ratings!, [op2])).toEqual([]);
  });

  it('transistor power includes both junctions (Σ V·I over the pins)', () => {
    const b = new DesignBuilder('q');
    const v = b.part('sources/dc-voltage', 'VCC', -200, 0, { value: '20' });
    const g = b.part('sources/ground', 'G1', -200, 200);
    b.connect(v, '-', g, '1');
    const q = b.part('basic/rated-npn', 'Q1', 0, 0, { pmax: '500m' });
    const rc = b.part('basic/resistor', 'RC', 0, -200, { value: '100' });
    const rb = b.part('basic/resistor', 'RB', -100, 0, { value: '20k' });
    b.connect(v, '+', rc, '1');
    b.connect(rc, '2', q, 'C');
    b.connect(v, '+', rb, '1');
    b.connect(rb, '2', q, 'B');
    b.labelPin(q, 'E', '0');
    const build = buildNetlist(b.design, { includeAnalysis: false });
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(op.error).toBeUndefined();
    const vce = vec(op, `V(${build.partNets.Q1.C})`)[0];
    const vbe = vec(op, `V(${build.partNets.Q1.B})`)[0];
    const ic = (20 - vce) / 100;
    const ib = (20 - vbe) / 20e3;
    const values = new Map(op.vectors.map((x) => [x.name.toLowerCase(), x.re[0]]));
    const power = build.ratings![0].terms.find((t) => t.kind === 'power')!;
    const ratio = values.get(`v(${power.signal.kind === 'voltage' ? power.signal.pos.toLowerCase() : ''})`)!;
    expect(ratio * 0.5).toBeCloseTo(vce * ic + vbe * ib, 4);
  });
});
