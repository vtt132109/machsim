/**
 * Rated parts in a real simulation session (in-process engine): an overloaded part burns out,
 * opens, is marked on the schematic and explained in the messages — live in an interactive run
 * and by re-running a one-shot analysis.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import type { Design } from '../../model/types';
import { createEditor } from '../store/editorStore';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import type { AnalysisResult } from '../../sim/results';
import { SimulationIntegration } from './controller';
import { chunkBlow, ratingMessage, ratingStates, sameRatingStates } from './ratings';
import type { RatingBinding } from '../../model/ratings';
import { setLang } from '../../i18n';

setLang('en');

async function waitFor(cond: () => boolean, timeoutMs = 8000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 12 V across a rated 100 Ω / 0.25 W resistor (1.44 W) next to an intact 1 kΩ one. */
function overloaded(): Design {
  const b = new DesignBuilder('burn');
  const v = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '12' });
  b.labelPin(v, '+', 'S');
  b.labelPin(v, '-', '0');
  const r1 = b.part('basic/rated-resistor', 'R1', 0, 0, { value: '100' });
  b.labelPin(r1, '1', 'S');
  b.labelPin(r1, '2', '0');
  const r2 = b.part('basic/rated-resistor', 'R2', 0, 200, { value: '1k' });
  b.labelPin(r2, '1', 'S');
  b.labelPin(r2, '2', '0');
  return b.design;
}

const ctrls: SimulationIntegration[] = [];
afterAll(() => {
  for (const c of ctrls) c.dispose();
});

function setup(design: Design) {
  const editor = createEditor({ design });
  const results: AnalysisResult[][] = [];
  const ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()), speed: Infinity, liveIntervalMs: 20, onResults: (r) => results.push(r) });
  ctrls.push(ctrl);
  return { editor, ctrl, results, messages: () => editor.getState().simMessages.map((m) => `${m.severity}/${m.source}: ${m.text}`) };
}

describe('burn-out in simulation sessions', () => {
  it('an interactive run burns the overloaded resistor out live and marks it', async () => {
    const { editor, ctrl, messages } = setup(overloaded());
    await ctrl.run();
    expect(ctrl.live.getState().mode).toBe('interactive');
    await waitFor(() => editor.getState().ratingStates.R1?.state === 'blown', 8000, 'R1 burnt out');
    expect(editor.getState().ratingStates.R2).toBeUndefined();
    expect(messages().some((m) => /^error\/rating: R1 burnt out: power 1\.44 W exceeded its rating of 250 mW/.test(m))).toBe(true);
    // the open part dissipates nothing any more: its heat (P / Pmax through τ = 10 ms) dies away,
    // while the intact R2 keeps its 0.144 W / 0.25 W = 58 %
    await waitFor(() => (ctrl.live.getState().latest['V(R1.rpw)'] ?? 9) < 0.05, 8000, 'R1 cooling down');
    expect(ctrl.live.getState().latest['V(R2.rpw)']).toBeCloseTo(0.576, 3);
    await ctrl.stop();
    await ctrl.idle();
    // the burnt mark stays after Stop, and the next run starts with a new part
    expect(editor.getState().ratingStates.R1?.state).toBe('blown');
  });

  it('a one-shot operating point is re-run with the burnt part open', async () => {
    const { editor, ctrl, results, messages } = setup(overloaded());
    await ctrl.runAnalysis('op');
    await ctrl.idle();
    const op = results[results.length - 1][0];
    const i = op.vectors.find((v) => v.name === 'I(V1)')!.re[0];
    expect(i).toBeCloseTo(-0.012, 6);
    expect(editor.getState().ratingStates).toEqual({ R1: { state: 'blown', pct: 576 } });
    expect(messages().filter((m) => m.startsWith('error/rating'))).toHaveLength(1);
    expect(messages().some((m) => m.startsWith('info/rating: Simulated again'))).toBe(true);
  });
});

describe('rating helpers', () => {
  const binding: RatingBinding = { refdes: 'R9', partId: 'basic/rated-resistor', blowSource: 'V_R9_blow', terms: [{ kind: 'power', signal: { kind: 'voltage', pos: 'R9.rpw', neg: '0' }, limit: 0.25 }] };

  it('finds the first burn-out sample in a chunk and explains it', () => {
    const chunk = { time: new Float64Array([0, 1e-3, 2e-3, 3e-3]), vectors: { 'V(R9.rpw)': new Float64Array([0.2, 0.9, 1.1, 1.3]) } };
    const e = chunkBlow(binding, chunk)!;
    expect(e).toMatchObject({ refdes: 'R9', kind: 'power', time: 2e-3 });
    expect(e.value).toBeCloseTo(0.275, 6);
    expect(ratingMessage(e)).toBe('R9 burnt out: power 275 mW exceeded its rating of 250 mW at t = 2 ms. The part dissipated more heat than it can stand, so it burnt and went open. Choose a part with a higher power rating, or reduce the voltage / current through it (for example a larger series resistor).');
    expect(chunkBlow(binding, { time: new Float64Array([0]), vectors: { 'V(R9.rpw)': new Float64Array([0.5]) } })).toBeNull();
  });

  it('marks parts hot from 80 % and keeps burnt parts burnt', () => {
    expect(ratingStates([binding], new Map([['v(r9.rpw)', 0.85]]), new Map())).toEqual({ R9: { state: 'hot', pct: 85 } });
    expect(ratingStates([binding], new Map([['v(r9.rpw)', 0.5]]), new Map())).toEqual({});
    const blown = new Map([['R9', { refdes: 'R9', partId: 'x', blowSource: 'V', kind: 'power' as const, ratio: 2, value: 0.5, limit: 0.25 }]]);
    expect(ratingStates([binding], new Map([['v(r9.rpw)', 0]]), blown)).toEqual({ R9: { state: 'blown', pct: 200 } });
    expect(sameRatingStates({ R9: { state: 'hot', pct: 85 } }, { R9: { state: 'hot', pct: 85 } })).toBe(true);
    expect(sameRatingStates({ R9: { state: 'hot', pct: 85 } }, {})).toBe(false);
  });
});
