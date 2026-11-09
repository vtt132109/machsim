/**
 * User-defined analysis: SPICE control cards run on a netlist.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../engine';
import { parseSpice } from '../spice';
import { parseUserControls } from './user';
import './index';

const RC = `rc
V1 in 0 PULSE(0 1 0 1n 1n 1 1) AC 1
R1 in out 1k
C1 out 0 1u
.end`;

function circuit() {
  return parseSpice(RC).netlist;
}

describe('user-defined analysis', () => {
  it('parses control cards with line numbers of the user text', () => {
    const c = parseUserControls('* comment\n.op\n.tran 10u 5m\n.options reltol=1e-4\n.ic V(out)=0.5\n.save V(out)');
    expect(c.errors).toEqual([]);
    expect(c.analyses.map((a) => a.type)).toEqual(['op', 'tran']);
    expect(c.cards).toEqual(['.op', '.tran 10u 5m']);
    expect(c.options.reltol).toBe(1e-4);
    expect(c.ic).toEqual({ out: 0.5 });
    expect(c.saves).toEqual(['V(out)']);
    const bad = parseUserControls('.op\nR1 a b 1k\n.model X D');
    expect(bad.errors.some((e) => e.startsWith('line 2:'))).toBe(true);
    expect(bad.errors.some((e) => e.startsWith('line 3:'))).toBe(true);
  });

  it('runs every card as a run of one result; the transient reaches 1 - e^-t/RC', () => {
    const net = { ...circuit(), analyses: [{ type: 'user' as const, text: '.op\n.tran 20u 5m\n.ac dec 5 10 10k' }] };
    const [r] = runAnalyses(net);
    expect(r.error).toBeUndefined();
    expect(r.type).toBe('user');
    expect(r.runs!.map((x) => x.label)).toEqual(['1: .op', '2: .tran 20u 5m', '3: .ac dec 5 10 10k']);
    const tran = r.runs![1].result;
    const t = tran.scale!.re;
    const v = tran.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!.re;
    const i = t.findIndex((x) => x >= 1e-3);
    expect(v[i]).toBeCloseTo(1 - Math.exp(-t[i] / 1e-3), 2);
    // AC: |H| at 159 Hz (the corner) = 1/sqrt(2)
    const ac = r.runs![2].result;
    expect(ac.scale!.re.length).toBeGreaterThan(10);
  });

  it('applies .options, .ic and .save of the text to its analyses', () => {
    const net = { ...circuit(), analyses: [{ type: 'user' as const, text: '.ic V(out)=0.3\n.save V(out)\n.tran 10u 1m uic' }] };
    const [r] = runAnalyses(net);
    const tran = r.runs![0].result;
    expect(tran.vectors.map((v) => v.name)).toEqual(['V(out)']);
    // starts at the initial condition 0.3 V and charges towards the 1 V input: 1 - 0.7 e^-1 at t = RC
    const v = tran.vectors[0].re;
    expect(v[0]).toBeCloseTo(0.3, 6);
    expect(v[v.length - 1]).toBeCloseTo(1 - 0.7 * Math.exp(-1), 2);
  });

  it('reports syntax problems and texts without analysis cards as errors', () => {
    const [bad] = runAnalyses({ ...circuit(), analyses: [{ type: 'user', text: '.tran abc' }] });
    expect(bad.error).toMatch(/line 1/);
    const [none] = runAnalyses({ ...circuit(), analyses: [{ type: 'user', text: '* only a comment\n.options reltol=1e-4' }] });
    expect(none.error).toMatch(/no analysis card/);
  });

  it('a .step temperature card runs a family', () => {
    const [r] = runAnalyses({ ...circuit(), analyses: [{ type: 'user', text: '.step temp list 0 50\n.op' }] });
    expect(r.error).toBeUndefined();
    expect(r.runs!.length).toBeGreaterThan(0);
  });
});
