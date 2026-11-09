/**
 * Review (completeness lens): features the code or UI claims that fail when exercised.
 *
 * Each test exercises the same path as the application (DesignBuilder design -> buildNetlist ->
 * runAnalyses, or the analysis defaults the controller uses) and asserts the behaviour the
 * claim promises. The tests FAIL while the defect exists.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';
import { buildBom } from '../../../src/model/bom';
import type { ProbeKind } from '../../../src/model/types';
import { runAnalyses } from '../../../src/sim';
import type { AnalysisSpec } from '../../../src/sim/netlist';
import type { AnalysisResult } from '../../../src/sim/results';
import { getParamValue } from '../../../src/sim/analyses/modify';
import { defaultSpec, elementParamChoices, validateSpec } from '../../../src/ui/analysis/specs';
import { ANALYSIS_ORDER } from '../../../src/ui/app/menus';
import { circuitElements, specContext } from '../../../src/ui/integration/circuitInfo';
import { loadExample } from '../../helpers';

const value = (r: AnalysisResult, name: string) => r.vectors.find((v) => v.name.toLowerCase() === name.toLowerCase())?.re[0];

describe('Global parameters ("use {name} in part values", PropertiesPanel.tsx)', () => {
  function divider(r2: string) {
    const b = new DesignBuilder('vars');
    b.design.variables = { Rload: '2k' };
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
    const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const r = b.part('basic/resistor', 'R2', 400, 0, { value: r2 });
    b.labelPin(v, '+', 'A');
    b.labelPin(v, '-', '0');
    b.labelPin(r1, '1', 'A');
    b.labelPin(r1, '2', 'OUT');
    b.labelPin(r, '1', 'OUT');
    b.labelPin(r, '2', '0');
    b.part('sources/ground', 'G1', 0, 300);
    return buildNetlist(b.design, { includeAnalysis: false });
  }

  it.each(['{Rload}', '{2*Rload/2}'])('a resistor value %s netlists without ERC errors and simulates', (text) => {
    const build = divider(text);
    expect(build.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    // V(OUT) = 10 V * 2k / (1k + 2k)
    expect(value(op, 'V(OUT)')).toBeCloseTo(20 / 3, 6);
  });
});

describe('Current / power probes (Place > Probe)', () => {
  function circuit(probes: [ProbeKind, number][]) {
    const b = new DesignBuilder('probes');
    const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '10' });
    const r1 = b.part('basic/resistor', 'R1', 300, 100, { value: '1k' });
    const r2 = b.part('basic/resistor', 'R2', 500, 100, { value: '1k' });
    // one wire V1+ -> (100,100) -> R1.1 at (270,100); probes sit on its horizontal segment
    b.wire(b.pin(v1, '+'), { x: 100, y: 100 }, b.pin(r1, '1'));
    b.connect(r1, '2', r2, '1');
    b.labelPin(r2, '2', '0');
    b.labelPin(v1, '-', '0');
    b.part('sources/ground', 'G1', 100, 300);
    probes.forEach(([k, x], i) => b.probe(k, x, 100, `P${i}`));
    const build = buildNetlist(b.design, { includeAnalysis: false });
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    return { build, op };
  }

  it('control: one current probe reads the 5 mA loop current', () => {
    const { op } = circuit([['current', 230]]);
    expect(value(op, 'I(V_PR_P0)')).toBeCloseTo(5e-3, 9);
  });

  it.each([
    ['a current and a power probe', [['current', 230], ['power', 210]] as [ProbeKind, number][]],
    ['two current probes', [['current', 230], ['current', 150]] as [ProbeKind, number][]],
  ])('%s on the same wire keep the circuit closed', (_name, probes) => {
    const { build, op } = circuit(probes);
    expect(build.erc).toEqual([]);
    expect(op.error).toBeUndefined();
    // both sense sources carry the loop current and R1 still sees 5 V
    expect(value(op, 'I(V_PR_P0)')).toBeCloseTo(5e-3, 9);
    expect(value(op, 'I(V_PR_P1)')).toBeCloseTo(5e-3, 9);
    expect(value(op, 'I(R1)')).toBeCloseTo(5e-3, 9);
  });
});

describe('Analysis defaults ("defaultSpec: a valid starting spec", specs.ts) as used by Run when nothing is saved', () => {
  for (const file of ['02-rc-lowpass.msim', '04-common-emitter.msim']) {
    const design = loadExample(file);
    const build = buildNetlist(design, { includeAnalysis: false });
    const ctx = specContext(build);
    it.each(ANALYSIS_ORDER.map((t) => [t]))(`${file}: the default %s spec runs without an error`, (type) => {
      const spec = defaultSpec(type, ctx);
      expect(validateSpec(spec, ctx).filter((i) => i.severity === 'error')).toEqual([]);
      const [r] = runAnalyses({ ...build.netlist, analyses: [spec] });
      expect(r.error).toBeUndefined();
    });
  }

  it('the default pole-zero spec of the RC low-pass measures a transfer from input to output and finds the 1/RC pole', () => {
    const design = loadExample('02-rc-lowpass.msim');
    const build = buildNetlist(design, { includeAnalysis: false });
    const spec = defaultSpec('pz', specContext(build));
    expect(spec.type).toBe('pz');
    if (spec.type !== 'pz') return;
    expect(spec.inPos.toLowerCase()).not.toBe(spec.outPos.toLowerCase());
    const [r] = runAnalyses({ ...build.netlist, analyses: [spec] });
    const poles = (r.table?.rows ?? []).filter((row) => String(row[0]).toLowerCase().startsWith('pole')).map((row) => Number(row[1]));
    // R1 = 1k, C1 = 100n -> s = -1e4 rad/s
    expect(poles.some((p) => Math.abs(p + 1e4) < 1)).toBe(true);
  });

  it('control: with input IN and output OUT the same circuit has the -1e4 rad/s pole', () => {
    const design = loadExample('02-rc-lowpass.msim');
    const build = buildNetlist(design, { includeAnalysis: false });
    const spec: AnalysisSpec = { type: 'pz', inPos: 'IN', inNeg: '0', outPos: 'OUT', outNeg: '0', transfer: 'vol', find: 'pz' };
    const [r] = runAnalyses({ ...build.netlist, analyses: [spec] });
    const poles = (r.table?.rows ?? []).filter((row) => String(row[0]).toLowerCase().startsWith('pole')).map((row) => Number(row[1]));
    expect(poles.some((p) => Math.abs(p + 1e4) < 1)).toBe(true);
  });
});

describe('Sweep / tolerance targets offered by the analysis forms (forms.tsx SweepTarget / Tolerances offer elementParamChoices)', () => {
  // Corrected by the fix engineer. The original test swept "value" on EVERY element because
  // forms.tsx offered ['value', ...el.params] unconditionally. The fix makes the forms offer
  // elementParamChoices(el): "value" only when the element has one (a source defined only by its
  // transient waveform has no DC value), plus the waveform / AC / instance parameters. The test
  // now checks that every parameter the forms offer, on two examples, can actually be swept.
  it.each(['02-rc-lowpass.msim', '04-common-emitter.msim'])('%s: every parameter offered for every element can be swept in a parameter sweep', (file) => {
    const build = buildNetlist(loadExample(file), { includeAnalysis: false });
    const failures: string[] = [];
    let offered = 0;
    for (const el of circuitElements(build)) {
      if (el.model) continue;
      for (const param of elementParamChoices(el)) {
        offered++;
        const nominal = getParamValue(build.netlist, el.name, param);
        if (nominal === undefined) {
          failures.push(`${el.name}.${param}: offered but has no nominal value`);
          continue;
        }
        const spec: AnalysisSpec = { type: 'paramsweep', target: el.name, param, values: [nominal * 0.9 || 0.1, nominal * 1.1 || 0.2], base: { type: 'op' } };
        const [r] = runAnalyses({ ...build.netlist, analyses: [spec] });
        if (r.error) failures.push(`${el.name}.${param}: ${r.error}`);
      }
    }
    expect(offered).toBeGreaterThan(5);
    expect(failures).toEqual([]);
  });

  it('the sine-only function-generator source offers its waveform parameters, not "value"', () => {
    const build = buildNetlist(loadExample('02-rc-lowpass.msim'), { includeAnalysis: false });
    const fg = circuitElements(build).find((e) => e.name === 'V_XFG1_p');
    expect(fg).toBeDefined();
    const choices = elementParamChoices(fg);
    expect(choices).not.toContain('value');
    expect(choices).toEqual(expect.arrayContaining(['vo', 'va', 'freq']));
    expect(getParamValue(build.netlist, 'V_XFG1_p', 'freq')).toBeGreaterThan(0);
  });
});

describe('Resistor "Tolerance" parameter ("Used by Monte Carlo / worst-case analyses and the BOM", parts/basic.ts)', () => {
  it('1 % and 5 % resistors of the same value are separate BOM lines', () => {
    const b = new DesignBuilder('bom');
    b.part('basic/resistor', 'R1', 0, 0, { value: '1k', tolerance: '1' });
    b.part('basic/resistor', 'R2', 200, 0, { value: '1k', tolerance: '5' });
    const rows = buildBom(b.design).filter((r) => r.refdes.some((d) => d.startsWith('R')));
    expect(rows).toHaveLength(2);
  });
});
