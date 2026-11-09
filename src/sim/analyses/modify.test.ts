import { describe, expect, it } from 'vitest';
import type { Netlist } from '../netlist';
import { netlist, res, vsrc } from '../engine/testing';
import { cloneNetlist, findElement, getParamValue, modifyNetlist, paramLabel, setParamValue, valueLabel, withSaves, withTemperature } from './modify';

function base(): Netlist {
  const n = netlist(
    [
      vsrc('V1', 'in', '0', { dc: 2, acMag: 1, tran: { type: 'SIN', args: [0, 1, 1e3] } }),
      res('R1', 'in', 'out', 1e3, { tc1: 1e-3 }),
      res('R.X1.R3', 'out', '0', 470),
      { type: 'D', name: 'D1', nodes: ['out', '0'], params: { area: 2 }, model: 'DM', stringParams: { area: '{2*a}' } },
    ],
    [],
    { models: [{ name: 'DM', type: 'D', params: { is: 1e-14 }, stringParams: { is: '{isx}' } }], options: { temp: 40 } },
  );
  return n;
}

describe('netlist modification', () => {
  it('deep-copies without touching the input', () => {
    const n = base();
    const m = modifyNetlist(n, [
      { target: 'R1', param: 'value', value: 2e3 },
      { target: 'DM', param: 'IS', model: true, value: 1e-13 },
    ]);
    expect(findElement(m, 'r1')?.value).toBe(2e3);
    expect(findElement(n, 'R1')?.value).toBe(1e3);
    expect(m.models.dm.params.is).toBe(1e-13);
    expect(n.models.dm.params.is).toBe(1e-14);
    expect(m.models.dm.stringParams?.is).toBeUndefined();
    expect(n.models.dm.stringParams?.is).toBe('{isx}');
    const c = cloneNetlist(n);
    expect(c).toEqual(n);
    expect(c.elements[0]).not.toBe(n.elements[0]);
  });

  it('reads and writes source fields and waveform parameters', () => {
    const n = base();
    expect(getParamValue(n, 'V1', 'value')).toBe(2);
    expect(getParamValue(n, 'V1', 'acmag')).toBe(1);
    expect(getParamValue(n, 'V1', 'acphase')).toBe(0);
    expect(getParamValue(n, 'V1', 'freq')).toBe(1e3);
    const m = cloneNetlist(n);
    setParamValue(m, 'V1', 'dc', 3, false);
    setParamValue(m, 'V1', 'ac', 0.5, false);
    setParamValue(m, 'V1', 'freq', 2e3, false);
    setParamValue(m, 'V1', 'acphase', 90, false);
    const src = findElement(m, 'V1')?.source;
    expect(src?.dc).toBe(3);
    expect(src?.acMag).toBe(0.5);
    expect(src?.acPhase).toBe(90);
    expect(src?.tran?.args[2]).toBe(2e3);
    expect(findElement(n, 'V1')?.source?.tran?.args[2]).toBe(1e3);
  });

  it('sets instance parameters and drops their string expressions', () => {
    const m = modifyNetlist(base(), [{ target: 'D1', param: 'area', value: 3 }]);
    const d = findElement(m, 'D1');
    expect(d?.params.area).toBe(3);
    expect(d?.stringParams?.area).toBeUndefined();
    expect(getParamValue(m, 'R1', 'tc1')).toBe(1e-3);
    expect(getParamValue(m, 'R1', 'tc2')).toBeUndefined();
  });

  it('finds flattened subcircuit elements by their instance path', () => {
    const n = base();
    expect(findElement(n, 'X1.R3')?.name).toBe('R.X1.R3');
    expect(getParamValue(n, 'x1.r3', 'value')).toBe(470);
  });

  it('treats "temp" as the circuit temperature', () => {
    const n = base();
    expect(getParamValue(n, 'temp', 'value')).toBe(40);
    expect(modifyNetlist(n, [{ target: 'temp', param: '', value: 85 }]).options.temp).toBe(85);
    expect(withTemperature(n, -10).options.temp).toBe(-10);
    expect(n.options.temp).toBe(40);
    expect(withSaves(n, ['V(out)']).saves).toEqual(['V(out)']);
  });

  it('reports unknown targets and invalid values', () => {
    expect(() => modifyNetlist(base(), [{ target: 'R9', param: 'value', value: 1 }])).toThrow(/R9/);
    expect(() => modifyNetlist(base(), [{ target: 'NOPE', param: 'is', model: true, value: 1 }])).toThrow(/NOPE/);
    expect(() => modifyNetlist(base(), [{ target: 'R1', param: 'value', value: Number.NaN }])).toThrow();
  });

  it('labels swept quantities', () => {
    expect(paramLabel('R1', 'value')).toBe('R1');
    expect(paramLabel('R1', 'TC1')).toBe('R1:tc1');
    expect(paramLabel('QM', 'bf', true)).toBe('QM:bf');
    expect(paramLabel('temp', 'value')).toBe('temp');
    expect(valueLabel('C1', 'value', false, 1e-9)).toBe('C1=1e-9');
    expect(valueLabel('R1', 'value', false, 4700)).toBe('R1=4700');
    expect(valueLabel('R1', 'value', false, 0.0015)).toBe('R1=0.0015');
  });
});
