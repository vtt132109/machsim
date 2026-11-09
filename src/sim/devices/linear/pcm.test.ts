/** Streamed PCM voltage source (microphone input): samples pushed with setParam('pcm', x) play back at k / pcmfs. */
import { describe, expect, it } from 'vitest';
import { createTransientStepper } from '../../engine/stepper';
import { netlist, res, vsrc } from '../../engine/testing';
import type { ElementIR } from '../../netlist';

const mic = (fs: number): ElementIR => ({ ...vsrc('VMIC', 'in', '0', {}), params: { pcmfs: fs } });

describe('PCM stream source', () => {
  it('plays the pushed samples at k / fs with linear interpolation', () => {
    const fs = 1000;
    const s = createTransientStepper(netlist([mic(fs), res('R1', 'in', '0', 1e3)]), { tstep: 1e-4, saves: ['V(in)'] });
    for (const x of [0, 1, 0, -1, 0, 1]) s.setParam('VMIC', 'pcm', x);
    const c = s.advance(5e-3);
    const v = c.vectors['V(in)'];
    const at = (t: number): number => {
      const k = c.time.findIndex((x) => x >= t - 1e-12);
      return v[k];
    };
    expect(at(1e-3)).toBeCloseTo(1, 6);
    expect(at(2e-3)).toBeCloseTo(0, 6);
    expect(at(3e-3)).toBeCloseTo(-1, 6);
    // between two samples: the straight line, whatever the engine's step lands on
    const k = c.time.findIndex((x) => x > 1.2e-3 && x < 1.8e-3);
    expect(k).toBeGreaterThan(0);
    expect(v[k]).toBeCloseTo(1 - (c.time[k] - 1e-3) / 1e-3, 6);
    expect(at(5e-3)).toBeCloseTo(1, 6);
  });

  it('a 440 Hz tone pushed in blocks while the simulation runs comes out at 440 Hz', () => {
    const fs = 8000;
    const s = createTransientStepper(netlist([mic(fs), res('R1', 'in', '0', 1e3)]), { tstep: 25e-6, saves: ['V(in)'] });
    let pushed = 0;
    const out: number[] = [];
    const times: number[] = [];
    // like the UI: stay 100 ms ahead of the simulation
    for (let t = 0.05; t <= 0.5; t += 0.05) {
      while (pushed / fs < t + 0.1) s.setParam('VMIC', 'pcm', Math.sin((2 * Math.PI * 440 * pushed++) / fs));
      const c = s.advance(t);
      times.push(...c.time);
      out.push(...c.vectors['V(in)']);
    }
    const ups: number[] = [];
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) ups.push(times[i - 1] + (-out[i - 1] / (out[i] - out[i - 1])) * (times[i] - times[i - 1]));
    const f = (ups.length - 1) / (ups[ups.length - 1] - ups[0]);
    expect(f).toBeGreaterThan(438);
    expect(f).toBeLessThan(442);
    expect(Math.max(...out)).toBeGreaterThan(0.98);
  });

  it('holds the last sample when the stream runs dry and rejects pcm on an ordinary source', () => {
    const s = createTransientStepper(netlist([mic(1000), res('R1', 'in', '0', 1e3)]), { tstep: 1e-4, saves: ['V(in)'] });
    s.setParam('VMIC', 'pcm', 0.25);
    s.setParam('VMIC', 'pcm', 0.75);
    s.advance(10e-3);
    expect(s.latest()['V(in)']).toBeCloseTo(0.75, 9);
    const plain = createTransientStepper(netlist([vsrc('V1', 'in', '0', { dc: 1 }), res('R1', 'in', '0', 1e3)]), { tstep: 1e-4 });
    expect(() => plain.setParam('V1', 'pcm', 1)).toThrow();
  });

  it('keeps memory bounded on a long stream', () => {
    const fs = 8000;
    const s = createTransientStepper(netlist([mic(fs), res('R1', 'in', '0', 1e3)]), { tstep: 1e-3, saves: ['V(in)'] });
    let pushed = 0;
    for (let t = 0.5; t <= 20; t += 0.5) {
      while (pushed / fs < t + 0.2) s.setParam('VMIC', 'pcm', Math.sin(pushed++ * 0.1));
      s.advance(t);
    }
    // still reproduces the right value after 20 s although old samples were dropped
    const k = Math.floor(s.time * fs);
    expect(s.latest()['V(in)']).toBeCloseTo(Math.sin(k * 0.1) + (s.time * fs - k) * (Math.sin((k + 1) * 0.1) - Math.sin(k * 0.1)), 2);
  });
});
