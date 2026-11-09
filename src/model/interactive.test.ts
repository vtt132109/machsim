import { describe, expect, it } from 'vitest';
import { elementValueChanges } from './interactive';
import { buildNetlist } from './netlister';
import { DesignBuilder } from './designkit';

function circuit() {
  const b = new DesignBuilder();
  const fg = b.part('instruments/function-generator', 'XFG1', 0, 0);
  const pot = b.part('basic/potentiometer', 'R1', 200, 0);
  const sw = b.part('basic/switch-spdt', 'S1', 400, 0);
  const pwl = b.part('sources/pwl-voltage', 'V1', 600, 0);
  const d = b.part('diodes/diode', 'D1', 800, 0);
  b.labelPin(fg, '+', 'A');
  b.labelPin(pot, '1', 'A');
  b.labelPin(pot, '2', '0');
  b.labelPin(sw, 'COM', 'A');
  b.labelPin(pwl, '+', 'A2');
  b.labelPin(pwl, '-', '0');
  b.labelPin(d, 'A', 'A2');
  b.labelPin(d, 'K', '0');
  return { b, fg, pot, sw, pwl, d };
}

const net = (c: ReturnType<typeof circuit>) => buildNetlist(c.b.design).netlist;

describe('elementValueChanges', () => {
  it('no edit -> no changes', () => {
    const c = circuit();
    expect(elementValueChanges(net(c), net(c))).toEqual([]);
  });

  it('slider, switch and generator edits become setParam calls', () => {
    const c = circuit();
    const before = net(c);
    c.pot.inst.params.percent = '20';
    c.sw.inst.params.position = 'B';
    c.fg.inst.params.freq = '5k';
    c.fg.inst.params.amplitude = '2';
    const changes = elementValueChanges(before, net(c));
    expect(changes).toEqual([
      { element: 'V_XFG1_p', param: 'acmag', value: 2 },
      { element: 'V_XFG1_p', param: 'va', value: 2 },
      { element: 'V_XFG1_p', param: 'freq', value: 5000 },
      { element: 'R1_a', param: 'value', value: 2000 },
      { element: 'R1_b', param: 'value', value: 8000 },
      { element: 'R_S1_a', param: 'value', value: 1e9 },
      { element: 'R_S1_b', param: 'value', value: 1e-3 },
    ]);
  });

  it('requires a restart for waveform-type, PWL table, model and topology changes', () => {
    const c = circuit();
    const before = net(c);
    c.fg.inst.params.waveform = 'square';
    expect(elementValueChanges(before, net(c))).toBeNull();

    const c2 = circuit();
    const b2 = net(c2);
    c2.pwl.inst.params.points = '0 0, 1m 1';
    expect(elementValueChanges(b2, net(c2))).toBeNull();

    const c3 = circuit();
    const b3 = net(c3);
    c3.d.inst.params.n = '2';
    expect(elementValueChanges(b3, net(c3))).toBeNull();

    const c4 = circuit();
    const b4 = net(c4);
    c4.b.part('basic/resistor', 'R9', 1000, 0);
    expect(elementValueChanges(b4, net(c4))).toBeNull();
  });
});
