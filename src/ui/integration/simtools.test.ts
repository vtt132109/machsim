/**
 * Controller features of the simulation-tools round, end to end in-process: run history for the
 * Grapher, Output-tab saves, interactive settings (stop time, zero start, capture) and the
 * convergence assistant on a circuit that does not converge with the default options.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import type { Design } from '../../model/types';
import { createEditor } from '../store/editorStore';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { SimulationIntegration } from './controller';
import { rcLowPassExample, voltageDividerExample } from './exampleDesigns';
import { setLang } from '../../i18n';

setLang('en');

async function waitFor(cond: () => boolean, timeoutMs = 8000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function setup(design: Design, speed = Infinity) {
  const editor = createEditor({ design });
  const ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()), speed, liveIntervalMs: 20 });
  return { editor, ctrl, messages: () => editor.getState().simMessages.map((m) => `${m.severity}: ${m.text}`) };
}

/** Plain RC divider without instruments (one-shot runs). */
function divider(): Design {
  const b = new DesignBuilder('div');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '3k' });
  b.labelPin(v, '+', 'A');
  b.labelPin(v, '-', '0');
  b.labelPin(r1, '1', 'A');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r2, '1', 'OUT');
  b.labelPin(r2, '2', '0');
  b.part('sources/ground', 'G1', 0, 300);
  const at = b.pin(r2, '1');
  b.probe('voltage', at.x, at.y, 'P1');
  b.design.analysis.active = 'op';
  return b.design;
}

describe('run history and Output tab', () => {
  it('every one-shot run becomes a history record with the Output-tab expressions', async () => {
    const d = divider();
    d.analysis.expressions = ['V(OUT)/V(A)'];
    const { ctrl } = setup(d);
    await ctrl.run();
    await ctrl.run();
    const runs = ctrl.live.getState().runs;
    expect(runs.map((r) => r.id)).toEqual([1, 2]);
    expect(runs[0].source).toBe('analysis');
    expect(runs[0].expressions).toEqual(['V(OUT)/V(A)']);
    expect(runs[1].results[0].type).toBe('op');
  });

  it('saves only the selected outputs, plus what probes need', async () => {
    const d = divider();
    d.analysis.saves = ['V(A)'];
    const { ctrl } = setup(d);
    await ctrl.run();
    const op = ctrl.live.getState().results[0];
    const names = op.vectors.map((v) => v.name.toLowerCase());
    expect(names).toContain('v(a)');
    // the probe P1 sits on OUT: its vector is kept
    expect(names).toContain('v(out)');
    expect(names).not.toContain('i(v_pwr_a)');
    expect(names.length).toBeLessThan(5);
  });
});

describe('interactive settings', () => {
  it('stops automatically at the end time and captures the session into the history', async () => {
    const d = rcLowPassExample();
    d.interactive = { initial: 'op', tstep: 1e-5, tstop: 2e-3 };
    const { ctrl, messages } = setup(d);
    await ctrl.run();
    expect(ctrl.live.getState().mode).toBe('interactive');
    await ctrl.idle();
    expect(messages().some((m) => m.includes('Stopped at the end time'))).toBe(true);
    const last = ctrl.live.getState().runs.at(-1)!;
    expect(last.source).toBe('interactive');
    const tr = last.results[0];
    expect(tr.type).toBe('tran');
    const t = tr.scale!.re;
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(2e-3);
    expect(tr.vectors.length).toBeGreaterThan(0);
  });

  it("'auto' initial conditions restart from a zero state when the operating point fails", async () => {
    // MID is joined only through capacitors: no DC operating point, but a transient from zero runs
    const b = new DesignBuilder('auto');
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const c1 = b.part('basic/capacitor', 'C1', 400, 0, { value: '1u' });
    const c2 = b.part('basic/capacitor', 'C2', 600, 0, { value: '1u' });
    const xmm = b.part('instruments/multimeter', 'XMM1', 800, 0, { mode: 'v' });
    b.labelPin(v1, '+', 'A');
    b.labelPin(v1, '-', '0');
    b.labelPin(r, '1', 'A');
    b.labelPin(r, '2', 'B');
    b.labelPin(c1, '1', 'B');
    b.labelPin(c1, '2', 'MID');
    b.labelPin(c2, '1', 'MID');
    b.labelPin(c2, '2', '0');
    // the meter reads B: its input resistance must not give MID a DC path
    b.labelPin(xmm, '+', 'B');
    b.labelPin(xmm, '-', '0');
    b.part('sources/ground', 'G1', 0, 300);
    b.design.analysis.active = 'tran';
    b.design.interactive = { initial: 'auto', tstep: 1e-5, tstop: 5e-3 };
    const { ctrl, messages } = setup(b.design);
    await ctrl.run();
    await waitFor(() => messages().some((m) => m.includes('restarting from a zero state')), 8000, 'automatic restart');
    await waitFor(() => ctrl.live.getState().simTime > 1e-3, 8000, 'simulated time after the restart');
    await ctrl.idle();
    // B charges towards 5 V through 1 kOhm into 0.5 uF (tau = 0.5 ms): 5 (1 - e^-10) at 5 ms
    const v = ctrl.live.getState().streams.XMM1.latest()!.values.v;
    expect(v).toBeCloseTo(5, 2);
  });

  it('captures a running session on demand', async () => {
    const { ctrl } = setup(voltageDividerExample());
    await ctrl.run();
    await waitFor(() => ctrl.live.getState().simTime > 1e-4, 8000, 'some simulated time');
    expect(ctrl.captureInteractive()).toBe(true);
    expect(ctrl.live.getState().runs.length).toBe(1);
    await ctrl.stop();
    await ctrl.idle();
  });
});

describe('convergence assistant', () => {
  /** A node joined only through capacitors has no DC path: singular until RSHUNT gives it one. */
  function capacitorNode(): Design {
    const b = new DesignBuilder('float');
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const c1 = b.part('basic/capacitor', 'C1', 400, 0, { value: '1u' });
    const c2 = b.part('basic/capacitor', 'C2', 600, 0, { value: '1u' });
    b.labelPin(v1, '+', 'A');
    b.labelPin(v1, '-', '0');
    b.labelPin(r, '1', 'A');
    b.labelPin(r, '2', 'B');
    b.labelPin(c1, '1', 'B');
    b.labelPin(c1, '2', 'MID');
    b.labelPin(c2, '1', 'MID');
    b.labelPin(c2, '2', '0');
    b.part('sources/ground', 'G1', 0, 300);
    b.design.analysis.active = 'op';
    return b.design;
  }

  it('remembers the failure and finds the fix that makes the operating point run', async () => {
    const { ctrl, editor } = setup(capacitorNode());
    await ctrl.run();
    expect(editor.getState().simMessages.filter((m) => m.source === 'erc' && m.severity === 'error')).toEqual([]);
    const failure = ctrl.live.getState().lastFailure;
    expect(failure?.type).toBe('op');
    expect(failure?.message).toMatch(/Singular/i);
    const seen: string[] = [];
    const r = await ctrl.tryConvergenceFixes('op', (a) => seen.push(`${a.fix.id}:${a.ok}`));
    expect(r.fixed?.id).toBe('rshunt');
    expect(seen).toEqual(['rshunt:true']);
    expect(ctrl.live.getState().lastFailure).toBeNull();
    const op = ctrl.live.getState().results[0];
    expect(op.vectors.find((v) => v.name.toLowerCase() === 'v(b)')!.re[0]).toBeCloseTo(5, 3);
    // the assisted run is in the history like any run
    expect(ctrl.live.getState().runs.at(-1)!.name).toMatch(/convergence assistant/);
  });
});
