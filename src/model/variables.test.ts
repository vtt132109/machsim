import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { runAnalyses } from '../sim';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { isPlainNumber, resolveDesignVariables, resolveParamText, substituteVariables, variableParamValue } from './variables';

describe('resolveDesignVariables', () => {
  it('evaluates user numbers and expressions that refer to other variables in any order', () => {
    const s = resolveDesignVariables({ gain: '{2*Rload/1k}', Rload: '2k', big: '1M', small: '10m', tau: 'Rload*Cx', Cx: '100n' });
    expect(s.errors).toEqual([]);
    expect(s.values.get('rload')).toBe(2000);
    expect(s.values.get('gain')).toBeCloseTo(4, 12);
    expect(s.values.get('big')).toBe(1e6); // user syntax: M = mega
    expect(s.values.get('small')).toBeCloseTo(0.01, 15);
    expect(s.values.get('tau')).toBeCloseTo(2e-4, 15);
  });

  it('reports circular definitions and unknown names without throwing', () => {
    const s = resolveDesignVariables({ a: '{b+1}', b: '{a*2}', c: '{nope}', d: '5' });
    expect(s.values.get('d')).toBe(5);
    expect(s.values.has('a')).toBe(false);
    expect(s.values.has('b')).toBe(false);
    expect(s.values.has('c')).toBe(false);
    const byName = Object.fromEntries(s.errors.map((e) => [e.name, e.message]));
    expect(byName.a).toMatch(/circular/);
    expect(byName.b).toMatch(/a/);
    expect(byName.c).toMatch(/undefined parameter 'nope'/);
  });
});

describe('part values that use variables', () => {
  const scope = resolveDesignVariables({ Rload: '2k' });

  it('resolveParamText accepts {expr} and bare variable names, ignores ordinary values', () => {
    expect(resolveParamText('{Rload}', scope)).toEqual({ value: 2000 });
    expect(resolveParamText(' {Rload*1.5} ', scope)).toEqual({ value: 3000 });
    expect(resolveParamText('rload', scope)).toEqual({ value: 2000 });
    expect(resolveParamText('4.7k', scope)).toBeNull();
    expect(resolveParamText('other', scope)).toBeNull();
    expect(resolveParamText('{Rx}', scope)).toEqual({ error: expect.stringMatching(/Rx/) });
  });

  it('substituteVariables only rewrites number parameters', () => {
    const def = getPart('basic/resistor')!;
    const out = substituteVariables(def, { value: '{Rload/4}', tolerance: '1' }, scope);
    expect(out.errors).toEqual([]);
    expect(out.params).toEqual({ value: '500', tolerance: '1' });
    const same = { value: '1k' };
    expect(substituteVariables(def, same, scope).params).toBe(same);
  });

  it('classifies plain numbers and builds .param values', () => {
    expect(isPlainNumber('2.2 µF')).toBe(true);
    expect(isPlainNumber('2*3')).toBe(false);
    expect(variableParamValue('1M')).toBe(1e6);
    expect(variableParamValue('{2*Rload}')).toBe('{2*Rload}');
  });

  it('the netlister simulates {expr} values and reports bad references as ERC errors', () => {
    const build = (r2: string, vars: Record<string, string>) => {
      const b = new DesignBuilder('vars');
      b.design.variables = vars;
      const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '{Vs}' });
      const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
      const r = b.part('basic/resistor', 'R2', 400, 0, { value: r2 });
      b.labelPin(v, '+', 'A');
      b.labelPin(v, '-', '0');
      b.labelPin(r1, '1', 'A');
      b.labelPin(r1, '2', 'OUT');
      b.labelPin(r, '1', 'OUT');
      b.labelPin(r, '2', '0');
      return buildNetlist(b.design, { includeAnalysis: false });
    };
    const ok = build('{3*Rload}', { Rload: '1k', Vs: '8' });
    expect(ok.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(ok.netlist.params).toEqual({ Rload: 1000, Vs: 8 });
    const [op] = runAnalyses({ ...ok.netlist, analyses: [{ type: 'op' }] });
    expect(op.scalars!['V(OUT)']).toBeCloseTo(6, 9); // 8 V * 3k / 4k
    const bad = build('{Rmissing}', { Rload: '1k', Vs: '8' });
    expect(bad.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([expect.stringMatching(/^R2: Resistance = '\{Rmissing\}': .*Rmissing/)]);
    const badVar = build('{Rload}', { Rload: '{Rload+1}', Vs: '8' });
    expect(badVar.erc.some((m) => m.severity === 'error' && /Global parameter Rload: .*circular/.test(m.message))).toBe(true);
  });
});
