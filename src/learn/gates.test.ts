/**
 * Real logic ICs in the lessons: the gate and flip-flop steps accept a 7408 / 7474 package (or one
 * of its single-gate sections) as well as the single-gate teaching symbol, pick the gate the
 * learner actually wired, and explain an active-low preset / clear that is tied low.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import { getPart } from '../library';
import type { Design } from '../model/types';
import { LessonCircuit } from './circuit';
import { checkLesson } from './runner';
import { getLesson } from './lessons';
import { builder, p, setAnalyses } from './kit';
import { flipflopUnits, gateUnits, heldAsync, logicIds, pickFlipflop, pickGate, pinSuffix } from './gates';

const run = runAnalyses;
const circuit = (d: Design) => new LessonCircuit(d, run);

/** An AND gate driven by two logic switches with a probe light on its output. */
function andDesign(partId: string, pins: { a: string; b: string; y: string }, b2 = true, extra?: (add: ReturnType<typeof builder>) => void): Design {
  const b = builder('AND gate');
  const u = b.part(partId, 'U1', 320, 200);
  const s1 = b.part('sources/logic-switch', 'S1', 120, 150, { state: 'true', key: 'A' });
  const s2 = b.part('sources/logic-switch', 'S2', 120, 250, { state: b2 ? 'true' : 'false', key: 'B' });
  b.labelPin(s1, 'OUT', 'A');
  b.labelPin(s2, 'OUT', 'B');
  b.labelPin(u, pins.a, 'A');
  b.labelPin(u, pins.b, 'B');
  b.labelPin(u, pins.y, 'Y');
  const x1 = b.part('indicators/probe-red', 'X1', 520, 200);
  b.labelPin(x1, '1', 'Y');
  b.part('sources/vcc', 'VCC1', 320, 110, { voltage: '5' });
  extra?.(b);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** A divide-by-two with the given flip-flop part and pin names. */
function ffDesign(partId: string, pins: { d: string; clk: string; q: string; qn: string }, async: [string, string] | null, asyncNet = 'VCC'): Design {
  const b = builder('Divider');
  const u = b.part(partId, 'U1', 320, 200);
  const clk = b.part('sources/digital-clock', 'V1', 120, 200, { freq: '1k', vhigh: '5' });
  b.labelPin(clk, 'OUT', 'CLK');
  b.labelPin(u, pins.clk, 'CLK');
  b.labelPin(u, pins.d, 'QN');
  b.labelPin(u, pins.q, 'Q');
  b.labelPin(u, pins.qn, 'QN');
  b.part('sources/vcc', 'VCC1', 320, 110, { voltage: '5' });
  if (async) for (const pin of async) b.labelPin(u, pin, asyncNet);
  const sc = b.part('instruments/scope', 'XSC1', 560, 190, { timebase: '1m', 'A.scale': '5', 'B.scale': '5' });
  b.labelPin(sc, 'A+', 'CLK');
  b.labelPin(sc, 'A-', '0');
  b.labelPin(sc, 'B+', 'Q');
  b.labelPin(sc, 'B-', '0');
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
}

describe('finding a gate in whatever part the learner used', () => {
  it('reads the section number off a package pin name', () => {
    expect(pinSuffix('2A')).toBe('A');
    expect(pinSuffix('1CLK')).toBe('CLK');
    expect(pinSuffix('Y')).toBe('Y');
    expect(pinSuffix('QN')).toBe('QN');
  });

  it('lists a logic type in every 74 family, with its sections', () => {
    const ids = logicIds('08', ['cmos/4081']);
    for (const id of ['ttl/74ls08', 'ttl/74std08', 'cmos/74hc08', 'ttl/7408', 'cmos/4081', 'ttl/7408-a', 'ttl/7408-d']) expect(ids, id).toContain(id);
    expect(ids).not.toContain('ttl/7400');
    // the ids it names are real library parts (for the packs that are loaded here)
    expect(getPart('ttl/7408')).toBeDefined();
    expect(getPart('ttl/7408-a')).toBeDefined();
  });

  it('finds four gates in a quad package and one in a section part', () => {
    const quad = circuit(andDesign('ttl/7408', { a: '1A', b: '1B', y: '1Y' }));
    const u1 = quad.parts({ ids: ['ttl/7408'] })[0];
    const units = gateUnits(quad, u1);
    expect(units.map((g) => g.out)).toEqual(['1Y', '2Y', '3Y', '4Y']);
    expect(units[0].inputs).toEqual(['1A', '1B']);

    const section = circuit(andDesign('ttl/7408-a', { a: '1A', b: '1B', y: '1Y' }));
    const sect = section.parts({ ids: ['ttl/7408-a'] })[0];
    expect(gateUnits(section, sect).map((g) => g.out)).toEqual(['1Y']);
  });

  it('picks the gate the learner wired, not simply the first one', () => {
    const c = circuit(andDesign('ttl/7408', { a: '3A', b: '3B', y: '3Y' }));
    const g = pickGate(c, { ids: logicIds('08', ['cmos/4081']) });
    expect(g?.out).toBe('3Y');
    expect(g?.inputs).toEqual(['3A', '3B']);
  });
});

describe('the gate lesson accepts a real IC', () => {
  for (const [name, partId, pins] of [
    ['the teaching symbol', 'misc-digital/and2', { a: 'A', b: 'B', y: 'Y' }],
    ['a 7408 package', 'ttl/7408', { a: '1A', b: '1B', y: '1Y' }],
    ['one 7408 section', 'ttl/7408-a', { a: '1A', b: '1B', y: '1Y' }],
    ['the third gate of a 7408', 'ttl/7408', { a: '3A', b: '3B', y: '3Y' }],
  ] as const) {
    it(`passes every step with ${name}`, async () => {
      const lesson = getLesson('logic-gates')!;
      const both = await checkLesson(lesson, andDesign(partId, pins, true), run, ['gate', 'inputs', 'probe', 'oneOne']);
      for (const id of ['gate', 'inputs', 'probe', 'oneOne']) expect(both[id].ok, `${id}: ${JSON.stringify(both[id].note)}`).toBe(true);
      const one = await checkLesson(lesson, andDesign(partId, pins, false), run, ['zero']);
      expect(one.zero.ok, JSON.stringify(one.zero.note)).toBe(true);
    });
  }

  it('still reports an open gate input on a real package', async () => {
    const d = andDesign('ttl/7408', { a: '1A', b: '1B', y: '1Y' });
    for (const s of d.sheets) s.labels = s.labels.filter((l) => l.name !== 'B');
    const r = await checkLesson(getLesson('logic-gates')!, d, run, ['inputs']);
    expect(r.inputs.ok).toBe(false);
    expect(r.inputs.note?.id).toBe('note:inputOpen');
  });
});

describe('the flip-flop lesson accepts a real IC', () => {
  for (const [name, partId, pins, async] of [
    ['the teaching symbol', 'misc-digital/dff', { d: 'D', clk: 'CLK', q: 'Q', qn: 'QN' }, null],
    ['a 7474 package', 'ttl/7474', { d: '1D', clk: '1CLK', q: '1Q', qn: '1QN' }, ['1PRE', '1CLR']],
    ['the second half of a 7474', 'ttl/7474', { d: '2D', clk: '2CLK', q: '2Q', qn: '2QN' }, ['2PRE', '2CLR']],
  ] as const) {
    it(`passes the toggle and divide steps with ${name}`, async () => {
      const r = await checkLesson(getLesson('flipflop')!, ffDesign(partId, pins, async as [string, string] | null), run, ['parts', 'toggle', 'divide', 'watch']);
      for (const id of ['parts', 'toggle', 'divide', 'watch']) expect(r[id].ok, `${id}: ${JSON.stringify(r[id].note)}`).toBe(true);
      expect(r.divide.note?.params?.value).toBe('500 Hz');
    });
  }

  it('explains an active-low clear that is tied to ground', async () => {
    const d = ffDesign('ttl/7474', { d: '1D', clk: '1CLK', q: '1Q', qn: '1QN' }, ['1PRE', '1CLR'], '0');
    const c = circuit(d);
    const f = pickFlipflop(c, { ids: ['ttl/7474'] })!;
    expect(f.asyncLow).toEqual(['1PRE', '1CLR']);
    expect(heldAsync(c, f)).toEqual(['1PRE', '1CLR']);
    const r = await checkLesson(getLesson('flipflop')!, d, run, ['toggle']);
    expect(r.toggle.ok).toBe(false);
    expect(r.toggle.note).toEqual({ id: 'note:asyncLow', params: { pin: '1PRE, 1CLR' } });
  });

  it('does not treat the active-high SET / RESET of the teaching symbol as held', () => {
    const b = builder('dff');
    const u = b.part('misc-digital/dff', 'U1', 300, 200);
    b.labelPin(u, 'SET', '0');
    b.labelPin(u, 'RESET', '0');
    b.labelPin(u, 'CLK', 'CLK');
    b.labelPin(u, 'D', 'QN');
    b.labelPin(u, 'QN', 'QN');
    b.labelPin(u, 'Q', 'Q');
    b.wire(p(300, 300), p(320, 300));
    const c = circuit(b.design);
    const f = flipflopUnits(c, c.parts({ ids: ['misc-digital/dff'] })[0])[0];
    expect(f.asyncLow).toEqual([]);
    expect(heldAsync(c, f)).toEqual([]);
  });
});
