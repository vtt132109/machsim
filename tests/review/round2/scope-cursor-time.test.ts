/**
 * Review round 2: oscilloscope cursor readout (src/ui/instruments/OscilloscopePanel.tsx shows
 * T1, T2 and T2−T1 with eng(t, 's', 4, timebase / 100), i.e. 4 significant digits). After an
 * interactive run has gone on for a while the absolute cursor times lose the digits that matter:
 * seen in the app on example 04 at 500 µs/div after ~72 s of simulated time —
 *   T1 = "72.2 s", T2 = "72.21 s", T2−T1 = "2.5 ms"
 * and after ~637 s both T1 and T2 read "637.4 s" while T2−T1 still reads "2.5 ms",
 * so T2 − T1 read off the table (10 ms, then 0) contradicts the T2−T1 row (2.5 ms). The display
 * resolution of the time base (5 µs here) is known (step argument) but not used to keep digits.
 *
 * Expected: the T1 / T2 texts resolve the cursor positions at least to the time-base step, so their
 * difference agrees with the T2−T1 row.
 */
import { describe, expect, it } from 'vitest';
import { eng } from '../../../src/ui/instruments/panelKit';
import { parseUserNumber } from '../../../src/util/units';

const seconds = (text: string) => parseUserNumber(text.replace(/\s/g, '').replace('−', '-'));

describe('scope cursor times keep the time-base resolution', () => {
  const timebase = 500e-6; // s/div
  const step = timebase / 100;
  const t1 = 72.2025;
  const t2 = t1 + 2.5e-3;

  it('control: near t = 0 the readouts agree', () => {
    const a = eng(0.0012, 's', 4, step);
    const b = eng(0.0037, 's', 4, step);
    expect(seconds(b) - seconds(a)).toBeCloseTo(2.5e-3, 6);
  });

  it('after 72 s the difference of the T1 / T2 texts equals T2−T1 within one step', () => {
    const shown1 = eng(t1, 's', 4, step);
    const shown2 = eng(t2, 's', 4, step);
    const delta = eng(t2 - t1, 's', 4, step);
    expect({ shown1, shown2, delta, diff: Math.abs(seconds(shown2) - seconds(shown1) - (t2 - t1)) <= step }).toEqual({ shown1, shown2, delta, diff: true });
  });
});
