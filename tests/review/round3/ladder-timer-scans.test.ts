/**
 * Review round 3: on-delay / off-delay timer resolution of the ladder scan machine
 * (src/ladder/machine.ts runTimer).
 *
 * The step-6 contract: "scans happen at a fixed period (10 ms default) so timers accumulate exact
 * multiples of it and TON is done exactly `preset` seconds after the rung became true". The timer
 * accumulates the elapsed time by repeated floating-point addition (elapsed = min(preset,
 * elapsed + dt)). Ten additions of 0.01 give 0.09999999999999999 < 0.1, so a 100 ms timer needs an
 * ELEVENTH scan; the same happens for 2.3 s, 5 s (the traffic-light green time a learner types
 * first), 1.1 s at a 1 ms scan, etc. The done bit comes one scan late and "T1.ET = 0.1" style
 * comparisons never see the value the learner typed.
 *
 * Expected: done after exactly round(preset / scan) scans following the scan in which the rung
 * became true. Fails today for the presets listed.
 */
import { describe, expect, it } from 'vitest';
import { LadderMachine } from '../../../src/ladder/machine';
import { compileLadder } from '../../../src/ladder/program';
import type { LadderOutputKind } from '../../../src/ladder/types';

/** Scans after the start scan until T1's done bit changes (TON: goes 1; TOF: goes 0). */
function scansUntilDone(kind: Extract<LadderOutputKind, 'ton' | 'tof'>, preset: string, scan: number): number {
  const { ir, errors } = compileLadder(
    [
      { id: 'r1', logic: { kind: 'contact', type: 'no', address: 'I0.0' }, outputs: [{ kind, address: 'T1', preset }] },
      { id: 'r2', logic: { kind: 'contact', type: 'no', address: 'T1' }, outputs: [{ kind: 'coil', address: 'Q0.0' }] },
    ],
    { scan },
  );
  expect(errors).toEqual([]);
  const m = new LadderMachine(ir);
  if (kind === 'tof') {
    m.setInputBit(0, 1);
    m.scan();
    m.setInputBit(0, 0);
  } else m.setInputBit(0, 1);
  m.scan(); // the scan in which the rung changed
  for (let k = 1; k < 100000; k++) {
    m.scan();
    const done = m.outputs[0];
    if ((kind === 'ton' && done === 1) || (kind === 'tof' && done === 0)) return k;
  }
  return -1;
}

describe('ladder timers finish after exactly preset / scan scans', () => {
  it('control: TON 0.5 s at 10 ms = 50 scans', () => {
    expect(scansUntilDone('ton', '0.5', 0.01)).toBe(50);
  });
  const cases: [string, number, number][] = [
    ['0.1', 0.01, 10],
    ['5', 0.01, 500],
    ['2,3', 0.01, 230],
    ['1.1', 0.001, 1100],
  ];
  for (const [preset, scan, want] of cases) {
    it(`TON ${preset} s at ${scan * 1000} ms scan = ${want} scans`, () => {
      expect(scansUntilDone('ton', preset, scan)).toBe(want);
    });
  }
  it('TOF 0.1 s at 10 ms = 10 scans', () => {
    expect(scansUntilDone('tof', '0.1', 0.01)).toBe(10);
  });
});
