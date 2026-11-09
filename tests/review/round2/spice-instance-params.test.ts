/**
 * Review round 2: SPICE import (File > Import SPICE netlist / Import SPICE as schematic, desktop
 * --batch). Decks exported by the free simulators learners use most often put series resistance
 * on sources and reactive parts as an instance parameter (`V1 in 0 5 Rser=1`,
 * `L1 a b 1m Rser=10`). src/sim/spice/parser.ts stores ANY `name=value` instance parameter in
 * ElementIR.params, and the devices ignore the names they do not know. The result is a silently
 * different circuit: no error, no warning, wrong node voltages.
 *
 * Expected: an instance parameter the element does not use is reported (warning naming it), or
 * the series resistance is honoured. The tests fail while it is dropped silently.
 */
import { describe, expect, it } from 'vitest';
import { parseSpice } from '../../../src/sim/spice/parser';
import { runAnalyses } from '../../../src/sim';

function opOf(text: string) {
  const r = parseSpice(text);
  const [res] = runAnalyses(r.netlist);
  return { warnings: r.warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join('\n'), errors: r.errors, s: res.scalars ?? {} };
}

describe('unknown / unsupported instance parameters in SPICE decks', () => {
  it('control: plain deck without instance parameters', () => {
    const o = opOf('* plain\nV1 in 0 5\nR1 in 0 10\n.op\n.end\n');
    expect(o.s['V(in)']).toBeCloseTo(5, 9);
  });

  it('V1 … Rser=1 is either honoured (V(in) = 5·10/11) or reported', () => {
    const o = opOf('* rser on a source\nV1 in 0 5 Rser=1\nR1 in 0 10\n.op\n.end\n');
    const honoured = Math.abs(o.s['V(in)'] - (5 * 10) / 11) < 1e-6;
    const reported = /rser/i.test(o.warnings) || o.errors.some((e) => /rser/i.test(e.message));
    // today: V(in) = 5 V, I(V1) = −0.5 A, no warning
    expect(honoured || reported).toBe(true);
  });

  it('L1 … Rser=10 is either honoured (V(out) = 0.5 V) or reported', () => {
    const o = opOf('* rser on an inductor\nV1 in 0 1\nL1 in out 1m Rser=10\nR1 out 0 10\n.op\n.end\n');
    const honoured = Math.abs(o.s['V(out)'] - 0.5) < 1e-6;
    const reported = /rser/i.test(o.warnings) || o.errors.some((e) => /rser/i.test(e.message));
    expect(honoured || reported).toBe(true);
  });

  it('a misspelt instance parameter (R1 … foo=3) is reported', () => {
    const o = opOf('* typo\nV1 in 0 1\nR1 in 0 10 foo=3\n.op\n.end\n');
    expect(/foo/i.test(o.warnings) || o.errors.some((e) => /foo/i.test(e.message))).toBe(true);
  });
});
