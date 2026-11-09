/**
 * The simulation controller end to end, in-process: a real editor store (createEditor), the
 * real netlister and engine behind the in-process worker transport.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import type { Design } from '../../model/types';
import { createEditor } from '../store/editorStore';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import type { AnalysisResult } from '../../sim/results';
import { SimulationIntegration } from './controller';
import { astable555Example, cmosInverterExample, EXAMPLES, rcLowPassExample, voltageDividerExample } from './exampleDesigns';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
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
  const results: AnalysisResult[][] = [];
  let problems = 0;
  const ctrl = new SimulationIntegration({
    editor,
    client: new SimClient(() => createInProcessTransport()),
    speed,
    liveIntervalMs: 20,
    onResults: (r) => results.push(r),
    onProblems: () => problems++,
  });
  return { editor, ctrl, results, problems: () => problems, messages: () => editor.getState().simMessages.map((m) => `${m.severity}: ${m.text}`) };
}

describe('interactive streaming', () => {
  it('streams the divider voltage into the multimeter and stops cleanly', async () => {
    const { editor, ctrl } = setup(voltageDividerExample());
    await ctrl.run();
    expect(ctrl.live.getState().mode).toBe('interactive');
    await waitFor(() => (ctrl.live.getState().streams.XMM1?.length ?? 0) > 20, 8000, 'multimeter samples');
    const v = ctrl.live.getState().streams.XMM1.latest()!.values.v;
    expect(v).toBeCloseTo((12 * 4.7e3 * 1e9) / (4.7e3 + 1e9) / (10e3 + (4.7e3 * 1e9) / (4.7e3 + 1e9)), 6);
    expect(editor.getState().sim.state).toBe('running');
    await waitFor(() => editor.getState().sim.simTime > 0, 4000, 'status time');
    await ctrl.stop();
    await ctrl.idle();
    expect(editor.getState().sim.state).toBe('idle');
    expect(editor.getState().sim.message).toMatch(/^Stopped at t = /);
    expect(ctrl.live.getState().mode).toBe('idle');
    // the panel keeps the last capture after Stop
    expect(ctrl.live.getState().streams.XMM1.length).toBeGreaterThan(20);
  });

  it('feeds the scope, runs the Bode sweep and applies generator edits live', async () => {
    const { editor, ctrl, messages } = setup(rcLowPassExample());
    await ctrl.run();
    await waitFor(() => !!ctrl.live.getState().ac.XBP1, 8000, 'Bode AC result');
    const ac = ctrl.live.getState().ac.XBP1;
    expect(ac.type).toBe('ac');
    expect(ac.vectors.map((x) => x.name)).toEqual(expect.arrayContaining(['V(IN)', 'V(OUT)']));
    await waitFor(() => ctrl.live.getState().simTime > 4e-3, 8000, '4 ms of simulated time');
    const scope = ctrl.live.getState().streams.XSC1;
    expect(scope.channels).toEqual(['A', 'B']);
    const period = (t0: number) => {
      const w = scope.read(t0, scope.endTime);
      const ups: number[] = [];
      const a = w.values.A;
      for (let i = 1; i < a.length; i++) if (a[i - 1] < 0 && a[i] >= 0) ups.push(w.time[i]);
      return (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
    };
    expect(period(1e-3)).toBeCloseTo(1e-3, 5);
    // turn the generator's frequency knob: applied in place (no restart)
    const params = { ...editor.getState().design.sheets[0].parts.find((p) => p.refdes === 'XFG1')!.params };
    ctrl.instrumentParams('XFG1', { waveform: 'sine', freq: '2k', duty: '50', amplitude: params.amplitude, offset: '0', risetime: '1n' });
    // the edit reaches the worker after the current slice; give it a few slices
    const tChange = ctrl.live.getState().simTime;
    await new Promise((r) => setTimeout(r, 200));
    await waitFor(() => ctrl.live.getState().simTime > tChange + 10e-3, 8000, 'time after the edit');
    expect(messages().filter((m) => !m.startsWith('info'))).toEqual([]);
    expect(period(scope.endTime - 3e-3)).toBeCloseTo(0.5e-3, 5);
    expect(messages().some((m) => /restarted/.test(m))).toBe(false);
    expect(editor.getState().design.sheets[0].parts.find((p) => p.refdes === 'XFG1')!.params.freq).toBe('2k');
    await ctrl.stop();
    await ctrl.idle();
  });

  it('blinks the 555 LED and lights it on the breadboard map', async () => {
    const { editor, ctrl } = setup(astable555Example());
    const seen = new Set<string>();
    const unsub = editor.subscribe(() => {
      const lvl = editor.getState().indicatorLevels.LED1;
      if (lvl !== undefined) seen.add(lvl > 0.2 ? 'on' : 'off');
    });
    await ctrl.run();
    await waitFor(() => seen.has('on') && seen.has('off'), 15000, 'LED on and off');
    unsub();
    expect(ctrl.live.getState().readings.find((r) => r.refdes === 'LED1')?.text).toMatch(/A$/);
    await ctrl.stop();
    await ctrl.idle();
    expect(editor.getState().indicatorLevels).toEqual({});
  });

  it('operates a switch while running (setParam, no restart)', async () => {
    const b = new DesignBuilder('switch');
    const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '5' });
    const s1 = b.part('basic/switch-spst', 'S1', 230, 100, { closed: 'false' });
    const r1 = b.part('basic/resistor', 'R1', 360, 100, { value: '330' });
    const led = b.part('diodes/led-red', 'LED1', 460, 170, {}, { rotation: 90 });
    b.part('sources/ground', 'GND1', 100, 260);
    b.wire(b.pin(v1, '+'), { x: 100, y: 100 }, b.pin(s1, '1'));
    b.connect(s1, '2', r1, '1');
    b.wire(b.pin(r1, '2'), { x: 460, y: 100 }, b.pin(led, 'A'));
    b.wire(b.pin(led, 'K'), { x: 460, y: 260 }, { x: 100, y: 260 });
    b.wire(b.pin(v1, '-'), { x: 100, y: 260 });
    const { editor, ctrl, messages } = setup(b.design);
    await ctrl.run();
    await waitFor(() => ctrl.live.getState().readings.length > 0, 8000, 'first reading');
    // open switch: only the 1 GΩ off-resistance leaks (nA)
    expect(editor.getState().indicatorLevels.LED1 ?? 0).toBeLessThan(1e-3);
    expect(editor.actions.interact('S1', 'click')).toBe('true');
    await waitFor(() => (editor.getState().indicatorLevels.LED1 ?? 0) > 0.3, 8000, 'LED lit');
    // (5 V − ≈2 V) / 330 Ω ≈ 9 mA of the 20 mA full brightness
    expect(editor.getState().indicatorLevels.LED1).toBeGreaterThan(0.35);
    expect(editor.getState().indicatorLevels.LED1).toBeLessThan(0.6);
    expect(messages().some((m) => /restarted/.test(m))).toBe(false);
    expect(editor.getState().history.past).toHaveLength(0); // no undo step for the toggle
    await ctrl.stop();
    await ctrl.idle();
  });

  it('restarts when an instrument setting changes the circuit structure', async () => {
    const { ctrl, messages } = setup(voltageDividerExample());
    await ctrl.run();
    await waitFor(() => (ctrl.live.getState().streams.XMM1?.length ?? 0) > 5, 8000, 'samples');
    ctrl.instrumentParams('XMM1', { mode: 'a', coupling: 'dc', ri: '1G', ra: '0', itest: '1m', dbref: '774.597m' });
    await waitFor(() => !!ctrl.live.getState().build?.instruments.find((i) => i.refdes === 'XMM1')?.channels.i, 8000, 'ammeter binding');
    expect(messages().some((m) => /restarted/.test(m))).toBe(true);
    // the ammeter now sits across R2 and shorts it: I = 12 V / 10 kΩ
    await waitFor(() => (ctrl.live.getState().streams.XMM1?.length ?? 0) > 5, 8000, 'samples after restart');
    expect(ctrl.live.getState().streams.XMM1.latest()!.values.i).toBeCloseTo(12 / 10e3, 9);
    await ctrl.stop();
    await ctrl.idle();
  });

  it('traces a diode with the IV analyzer', async () => {
    const b = new DesignBuilder('iv');
    const xiv = b.part('instruments/iv-analyzer', 'XIV1', 200, 100);
    const d1 = b.part('diodes/1n4148', 'D1', 200, 220, {}, { rotation: 90 });
    b.wire(b.pin(xiv, 'P'), { x: b.pin(xiv, 'P').x, y: 160 }, { x: 200, y: 160 }, b.pin(d1, 'A'));
    b.wire(b.pin(d1, 'K'), { x: 200, y: 280 }, { x: b.pin(xiv, 'N').x + 40, y: 280 }, { x: b.pin(xiv, 'N').x + 40, y: 150 }, { x: b.pin(xiv, 'N').x, y: 150 }, b.pin(xiv, 'N'));
    const { ctrl } = setup(b.design);
    await ctrl.run();
    await waitFor(() => !!ctrl.live.getState().dc.XIV1, 8000, 'IV sweep');
    const dc = ctrl.live.getState().dc.XIV1;
    const i = dc.vectors.find((v) => v.name.toLowerCase() === 'i(v_xiv1_i)')!.re;
    // forward current grows exponentially with the swept voltage
    expect(i[i.length - 1]).toBeGreaterThan(1e-3);
    expect(Math.abs(i[0])).toBeLessThan(1e-6);
    await ctrl.stop();
    await ctrl.idle();
  });
});

describe('one-shot analyses', () => {
  it('runs the active DC sweep, reports it and hands the results to the grapher', async () => {
    const { editor, ctrl, results } = setup(cmosInverterExample());
    await ctrl.run();
    expect(results).toHaveLength(1);
    expect(results[0][0].type).toBe('dc');
    expect(ctrl.live.getState().results[0].type).toBe('dc');
    expect(editor.getState().sim.state).toBe('idle');
    expect(editor.getState().sim.message).toMatch(/^Done: DC sweep/);
  });

  it('an operating point updates the probe read-outs', async () => {
    const { editor, ctrl } = setup(cmosInverterExample());
    await ctrl.runAnalysis('op');
    const probes = editor.getState().design.sheets[0].probes;
    const vout = probes.find((p) => p.name === 'Vout')!;
    expect(editor.getState().probeValues[vout.id]).toBe('V: 2.5 V');
    const vin = probes.find((p) => p.name === 'Vin')!;
    expect(editor.getState().probeValues[vin.id]).toBe('V: 2.5 V');
  });

  it('ERC errors block the run and are marked on the canvas', async () => {
    const b = new DesignBuilder('no ground');
    const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '5' });
    const r1 = b.part('basic/resistor', 'R1', 200, 200, {}, { rotation: 90 });
    b.wire(b.pin(v1, '+'), { x: 100, y: 160 }, { x: 200, y: 160 }, b.pin(r1, '1'));
    b.wire(b.pin(v1, '-'), { x: 100, y: 240 }, { x: 200, y: 240 }, b.pin(r1, '2'));
    const { editor, ctrl, results, problems } = setup(b.design);
    await ctrl.run();
    expect(results).toHaveLength(0);
    expect(editor.getState().sim.state).toBe('error');
    expect(editor.getState().sim.message).toMatch(/^ERC: 1 error/);
    expect(editor.getState().ercMarkers.some((m) => m.code === 'no-ground')).toBe(true);
    expect(editor.getState().simMessages.some((m) => m.source === 'erc' && m.severity === 'error')).toBe(true);
    expect(problems()).toBe(1);
  });

  it('cancels a long analysis', async () => {
    const d = rcLowPassExample();
    d.analysis.specs.tran = { type: 'tran', tstep: 1e-8, tstop: 10 };
    const { editor, ctrl } = setup(d);
    const p = ctrl.runAnalysis('tran');
    await waitFor(() => ctrl.active, 2000, 'run started');
    await ctrl.stop();
    await p;
    expect(editor.getState().sim.message).toBe('Transient cancelled');
    expect(ctrl.active).toBe(false);
  });
});

describe('microcontroller debugging through the controller', () => {
  const blink = () => EXAMPLES.find((e) => e.file === '51-mcu-blink.msim')!.build();
  const core = (ctrl: SimulationIntegration): string => ctrl.live.getState().build!.mcus![0].element;
  const readout = (ctrl: SimulationIntegration, key: string): number => {
    const want = `${key}(${core(ctrl)})`.toLowerCase();
    const hit = Object.entries(ctrl.live.getState().latest).find(([k]) => k.toLowerCase() === want);
    if (!hit) throw new Error(`no read-out ${key}`);
    return hit[1];
  };

  it('Start debugging holds the run before the first instruction and a step moves the circuit clock by the instruction time', async () => {
    const { editor, ctrl } = setup(blink(), 1);
    await ctrl.startDebugging();
    await waitFor(() => ctrl.live.getState().session === 'paused', 8000, 'the hold before the first instruction');
    expect(editor.getState().sim.message).toMatch(/debugger/i);
    expect(ctrl.live.getState().simTime).toBe(0);
    expect(readout(ctrl, 'Mpc')).toBe(0);
    // CPL P1.0 is one machine cycle: 1 µs at 12 MHz
    ctrl.setElementParam(core(ctrl), 'step', 1);
    ctrl.resume();
    await waitFor(() => ctrl.live.getState().session === 'paused' && readout(ctrl, 'Mcyc') === 1, 8000, 'one step');
    expect(ctrl.live.getState().simTime).toBeCloseTo(1e-6, 12);
    // the toolbar Run releases the debugger hold: the program goes on and the clock moves
    await ctrl.run();
    await waitFor(() => ctrl.live.getState().session === 'running' && ctrl.live.getState().simTime > 2e-3, 8000, 'the program running on');
    await ctrl.stop();
    await ctrl.idle();
  });
});
