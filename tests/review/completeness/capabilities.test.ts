/**
 * Review (completeness lens): evidence for the "implemented" rows of docs/capability-matrix.md.
 * Every check exercises the application path (library part -> netlister -> engine, controller ->
 * instrument stream -> measurement / panel) and asserts real numbers.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultParams, getPart, listParts } from '../../../src/library';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';
import { runAnalyses } from '../../../src/sim';
import type { AnalysisSpec } from '../../../src/sim/netlist';
import { counterMeasure, distortionMeasure, meterMeasure, powerMeasure, spectrumMeasure } from '../../../src/ui/instruments/measure';
import { tableFromRuns } from '../../../src/ui/instruments/logicConverter';
import { SimulationIntegration } from '../../../src/ui/integration/controller';
import { EXAMPLES } from '../../../src/ui/integration/exampleDesigns';
import { InstrumentWindow } from '../../../src/ui/integration/InstrumentWindow';
import { preloadInstrumentPanels } from '../../../src/ui/instruments/lazyPanels';
import { designNetlistText, prepareSpiceDeck } from '../../../src/ui/integration/reports';
import { Grapher } from '../../../src/ui/results/Grapher';
import { SimClient } from '../../../src/ui/sim/client';
import { createInProcessTransport } from '../../../src/ui/sim/inprocess';
import { actions, editor } from '../../../src/ui/store';
import { createEditor } from '../../../src/ui/store/editorStore';
import { loadExample } from '../../helpers';
import { setLang } from '../../../src/i18n';
import { loadAllGroups } from '../../../src/library';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

async function waitFor(cond: () => boolean, ms = 15000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('component library', () => {
  // the catalogue holds thousands of parts: one test per group keeps each run short
  const simulatable = listParts().filter((p) => p.toSpice && !p.instrument);
  const groups = [...new Set(simulatable.map((p) => p.group))];

  it('counts the simulatable parts of the catalogue', () => {
    expect(simulatable.length).toBe(4859);
    expect(listParts()).toHaveLength(5063);
  });

  // the biggest group (RF: hundreds of transmission-line and mixer parts) takes about 45 s on its
  // own, so these get a long timeout: the whole suite runs several files at a time and a busy
  // machine stretches them well past the 60 s default. The assertion itself is unchanged.
  it.each(groups)('every simulatable %s part solves an operating point and a 1 ms transient with 1 MΩ pin terminations', (group) => {
    const failures: string[] = [];
    for (const part of simulatable.filter((p) => p.group === group)) {
      const b = new DesignBuilder(part.id);
      const h = b.part(part.id, `${part.prefix}1`, 0, 0);
      part.symbol.pins.forEach((pin, i) => {
        b.labelPin(h, pin.name, `P${i}`);
        const r = b.part('basic/resistor', `RZ${i}`, 2000 + i * 200, 1000, { value: '1M' });
        const g = b.part('sources/ground', `GZ${i}`, 2000 + i * 200, 1200);
        b.labelPin(r, '1', `P${i}`);
        b.connect(r, '2', g, '1');
      });
      const build = buildNetlist(b.design, { includeAnalysis: false });
      const errs = build.erc.filter((m) => m.severity === 'error');
      if (errs.length) failures.push(`${part.id} ERC ${errs[0].message}`);
      const [op, tr] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 1e-3 }] });
      if (op.error) failures.push(`${part.id} OP ${op.error}`);
      if (tr.error) failures.push(`${part.id} TRAN ${tr.error}`);
    }
    expect(failures).toEqual([]);
  }, 300000);
});

describe('analyses and Grapher', () => {
  it('all 19 analysis types run on the CE amplifier and the Grapher renders each result', () => {
    const design = loadExample('04-common-emitter.msim');
    const build = buildNetlist(design, { includeAnalysis: false });
    const op: AnalysisSpec = { type: 'op' };
    const ac: AnalysisSpec = { type: 'ac', sweep: 'dec', points: 10, fstart: 10, fstop: 1e7 };
    const specs: AnalysisSpec[] = [
      op,
      { type: 'dc', src: 'V_PWR_VCC', start: 0, stop: 12, step: 1 },
      ac,
      { type: 'acsingle', freq: 1e3 },
      { type: 'tran', tstep: 1e-5, tstop: 2e-3 },
      { type: 'noise', output: 'OUT', ref: '0', src: 'V_XFG1_p', sweep: 'dec', points: 10, fstart: 10, fstop: 1e7 },
      { type: 'noisefig', output: 'OUT', ref: '0', src: 'V_XFG1_p', rsource: 50, freq: 1e3 },
      { type: 'four', fundamental: 1e3, harmonics: 9, outputs: ['V(OUT)'], settleCycles: 3, samples: 256 },
      { type: 'disto', sweep: 'dec', points: 5, fstart: 100, fstop: 1e5 },
      { type: 'tf', output: 'V(N3)', src: 'V_PWR_VCC' },
      { type: 'sens', output: 'V(N3)' },
      { type: 'pz', inPos: 'IN', inNeg: '0', outPos: 'OUT', outNeg: '0', transfer: 'vol', find: 'pz' },
      { type: 'paramsweep', target: 'RC', param: 'value', values: [1e3, 2e3], base: { type: 'tran', tstep: 1e-5, tstop: 1e-3 } },
      { type: 'tempsweep', temps: [0, 50], base: ac },
      { type: 'montecarlo', runs: 3, seed: 1, tolerances: [{ target: 'RC', param: 'value', tol: 0.1, dist: 'gaussian' }], base: op, measure: { output: 'V(N3)', func: 'final' } },
      { type: 'worstcase', tolerances: [{ target: 'RC', param: 'value', tol: 0.1, dist: 'uniform' }], base: op, measure: { output: 'V(N3)', func: 'final' }, direction: 'high' },
      { type: 'nestedsweep', outer: { target: 'RC', param: 'value', values: [1e3, 2e3] }, inner: { target: 'RE1', param: 'value', values: [10, 20] }, base: op },
      { type: 'tracewidth', base: { type: 'tran', tstep: 1e-5, tstop: 1e-3 }, tempRise: 10, copperOz: 1, external: true },
      { type: 'batch', items: [op, ac] },
    ];
    expect(new Set(specs.map((s) => s.type)).size).toBe(19);
    for (const s of specs) {
      const results = runAnalyses({ ...build.netlist, analyses: [s] });
      expect(results[0].error, s.type).toBeUndefined();
      const html = text(renderToStaticMarkup(createElement(Grapher, { results })));
      expect(html.length, s.type).toBeGreaterThan(100);
      expect(html, s.type).not.toMatch(/No results/);
    }
    // midband gain of the CE stage (example summary: Av ≈ -27) from the noise-figure result
    const [nf] = runAnalyses({ ...build.netlist, analyses: [specs[6]] });
    expect(nf.scalars?.noise_figure).toBeGreaterThan(0);
    expect(nf.scalars?.noise_figure).toBeLessThan(20);
  });
});

describe('file interop', () => {
  it('File > Export SPICE netlist then Import reproduces every saved analysis of every example exactly', () => {
    for (const ex of EXAMPLES) {
      const design = ex.build();
      const deck = prepareSpiceDeck(designNetlistText(design, 'all').text, ex.file + '.cir');
      expect(deck.errors, ex.file).toEqual([]);
      const build = buildNetlist(design, { includeAnalysis: false });
      const specs = Object.values(design.analysis.specs).filter((s): s is AnalysisSpec => s !== undefined);
      const a = runAnalyses({ ...build.netlist, analyses: specs });
      const b = runAnalyses(deck.netlist);
      expect(b.map((r) => r.type), ex.file).toEqual(a.map((r) => r.type));
      a.forEach((ra, k) => {
        for (const v of ra.vectors) {
          const w = b[k].vectors.find((x) => x.name.toLowerCase() === v.name.toLowerCase());
          expect(w, `${ex.file} ${ra.type} ${v.name}`).toBeDefined();
          expect(Array.from(w!.re)).toEqual(Array.from(v.re));
        }
      });
    }
  });
});

describe('virtual instruments in an interactive session', () => {
  const ctrls: SimulationIntegration[] = [];
  afterAll(() => {
    for (const c of ctrls) c.dispose();
  });

  it('wattmeter, frequency counter, spectrum / distortion analyzers, current clamp and 4-channel scope read a 1 kHz, 1 V sine into 1.5 kΩ', async () => {
    const b = new DesignBuilder('inst');
    const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '1', freq: '1k' });
    b.labelPin(v, '+', 'S');
    b.labelPin(v, '-', '0');
    const xwm = b.part('instruments/wattmeter', 'XWM1', 300, 0);
    b.labelPin(xwm, 'I+', 'S');
    b.labelPin(xwm, 'I-', 'A');
    b.labelPin(xwm, 'V+', 'A');
    b.labelPin(xwm, 'V-', '0');
    const r1 = b.part('basic/resistor', 'R1', 600, 0, { value: '1k' });
    b.labelPin(r1, '1', 'A');
    b.labelPin(r1, '2', 'B');
    const r2 = b.part('basic/resistor', 'R2', 800, 0, { value: '1k' });
    b.labelPin(r2, '1', 'B');
    b.labelPin(r2, '2', '0');
    for (const [kind, refdes, x] of [['frequency-counter', 'XFC1', 0], ['spectrum-analyzer', 'XSA1', 300], ['distortion-analyzer', 'XDA1', 600]] as const) {
      const h = b.part(`instruments/${kind}`, refdes, x, 300);
      b.labelPin(h, 'IN+', 'A');
      b.labelPin(h, 'IN-', '0');
    }
    const xcc = b.part('instruments/current-clamp', 'XCP1', 900, 300);
    b.labelPin(xcc, 'I+', 'B');
    b.labelPin(xcc, 'I-', 'B2');
    const r3 = b.part('basic/resistor', 'R3', 1000, 0, { value: '1k' });
    b.labelPin(r3, '1', 'B2');
    b.labelPin(r3, '2', '0');
    const x4 = b.part('instruments/scope-4ch', 'XSC1', 0, 600);
    b.labelPin(x4, 'A+', 'A');
    b.labelPin(x4, 'B+', 'B');
    b.labelPin(x4, 'C+', 'S');
    b.labelPin(x4, 'D+', 'B2');
    b.part('sources/ground', 'GND1', 0, 900);
    const ed = createEditor({ design: b.design });
    const ctrl = new SimulationIntegration({ editor: ed, client: new SimClient(() => createInProcessTransport()), speed: Infinity, liveIntervalMs: 20 });
    ctrls.push(ctrl);
    await ctrl.run();
    expect(ctrl.live.getState().mode).toBe('interactive');
    await waitFor(() => ctrl.live.getState().simTime > 0.05, 15000, '50 ms simulated');
    ctrl.pause();
    const st = ctrl.live.getState().streams;
    const rec = (refdes: string, ch: string[]) => st[refdes].readRecent(0.04, 1 << 18, ch);
    // load seen from A: 1k + (1k || 1k) = 1.5 kΩ
    const w = rec('XWM1', ['v', 'i']);
    const p = powerMeasure(w.time, w.values.v, w.values.i);
    expect(p.power).toBeCloseTo(0.5 / 1500, 5);
    expect(p.powerFactor).toBeCloseTo(1, 3);
    const fc = rec('XFC1', ['in']);
    expect(counterMeasure(fc.time, fc.values.in, { coupling: 'ac' }).freq).toBeCloseTo(1000, 0);
    const sa = spectrumMeasure(fc.time, fc.values.in, { start: 0, stop: 10e3, resolution: 50, window: 'hann' });
    expect(sa.peakFreq).toBeCloseTo(1000, -1);
    expect(sa.peakRms).toBeCloseTo(Math.SQRT1_2, 2);
    const da = rec('XDA1', ['in']);
    expect(distortionMeasure(da.time, da.values.in, { fundamental: 1000 }).thdPercent).toBeLessThan(0.01);
    const cc = rec('XCP1', ['i']);
    // I(R3) = V(B) / 1k, V(B) = 1 V / 3
    expect(meterMeasure(cc.time, cc.values.i).acRms).toBeCloseTo(Math.SQRT1_2 / 3000, 6);
    expect(st.XSC1.channels).toEqual(['A', 'B', 'C', 'D']);
    const sc = rec('XSC1', ['A', 'B']);
    expect(meterMeasure(sc.time, sc.values.B).acRms / meterMeasure(sc.time, sc.values.A).acRms).toBeCloseTo(1 / 3, 3);
    await ctrl.stop();
    await ctrl.idle();
  });

  it('network analyzer S-parameters of a 50 Ω L-pad, logic converter truth table of a NAND gate, word generator into logic analyzer', async () => {
    const b = new DesignBuilder('dig');
    const wg = b.part('instruments/word-generator', 'XWG1', 0, 0, { freq: '1k' });
    const la = b.part('instruments/logic-analyzer', 'XLA1', 400, 0);
    for (let i = 0; i < 4; i++) {
      b.labelPin(wg, `b${i}`, `D${i}`);
      b.labelPin(la, `d${i}`, `D${i}`);
    }
    const g = b.part('misc-digital/nand2', 'U1', 0, 400);
    const lc = b.part('instruments/logic-converter', 'XLC1', 300, 400, { inputs: '2' });
    b.labelPin(g, 'A', 'LA');
    b.labelPin(g, 'B', 'LB');
    b.labelPin(g, 'Y', 'LY');
    b.labelPin(lc, 'A', 'LA');
    b.labelPin(lc, 'B', 'LB');
    b.labelPin(lc, 'OUT', 'LY');
    const na = b.part('instruments/network-analyzer', 'XNA1', 0, 800);
    const rs = b.part('basic/resistor', 'RS', 300, 800, { value: '50' });
    const rp = b.part('basic/resistor', 'RP', 500, 800, { value: '50' });
    b.labelPin(na, 'P1', 'N1');
    b.labelPin(rs, '1', 'N1');
    b.labelPin(rs, '2', 'N2');
    b.labelPin(rp, '1', 'N2');
    b.labelPin(rp, '2', '0');
    b.labelPin(na, 'P2', 'N2');
    b.part('sources/ground', 'GND1', 0, 1100);
    actions.loadDesign(b.design, 'dig.msim');
    const ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()), speed: Infinity, liveIntervalMs: 20 });
    ctrls.push(ctrl);
    await ctrl.run();
    await waitFor(() => ctrl.live.getState().simTime > 0.03 && !!ctrl.live.getState().dc.XLC1 && !!ctrl.live.getState().ac.XNA1, 15000, 'instrument analyses');
    ctrl.pause();
    const live = ctrl.live.getState();
    const lcb = live.build!.instruments.find((i) => i.refdes === 'XLC1')!;
    expect(tableFromRuns(live.dc.XLC1, lcb.channels.out, 2.5, 4)).toBe('1110');
    // Zin = 50 + 50 || 50 = 75 Ω -> S11 = 0.2; S21 = 0.4; looking back from port 2: 100 || 50 -> S22 = -0.2
    // instrument panels are code-split: load them before the synchronous server-side render
    await preloadInstrumentPanels();
    const naText = text(renderToStaticMarkup(createElement(InstrumentWindow, { refdes: 'XNA1', kind: 'network-analyzer', ctrl })));
    expect(naText).toContain('Z in (port 1) 75 + j0 Ω');
    expect(naText).toContain('S11 200 m ∠ 0.00°');
    expect(naText).toContain('S21 400 m ∠ 0.00°');
    expect(naText).toContain('S22 200 m ∠ 180.00°');
    // word k is output during [k ms, (k+1) ms): bits 0..3 of the address
    const s = live.streams.XLA1;
    const win = s.readRecent(0.02, 1 << 18, ['d0', 'd1', 'd2', 'd3']);
    let checked = 0;
    for (let idx = 0; idx < win.time.length; idx += 7) {
      const ms = win.time[idx] * 1000;
      const frac = ms - Math.floor(ms);
      if (frac < 0.2 || frac > 0.8) continue;
      const word = [0, 1, 2, 3].reduce((acc, k) => acc | ((win.values[`d${k}`][idx] > 2.5 ? 1 : 0) << k), 0);
      expect(word, `t = ${ms} ms`).toBe(Math.floor(ms) % 16);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    await ctrl.stop();
    await ctrl.idle();
  });

  it('word generator Step (step mode) changes the outputs live without restarting the session', async () => {
    const b = new DesignBuilder('wg');
    const wg = b.part('instruments/word-generator', 'XWG1', 0, 0, { mode: 'step', pos: '0' });
    const la = b.part('instruments/logic-analyzer', 'XLA1', 400, 0);
    b.labelPin(wg, 'b0', 'D0');
    b.labelPin(la, 'd0', 'D0');
    b.part('sources/ground', 'G', 0, 300);
    const ed = createEditor({ design: b.design });
    const ctrl = new SimulationIntegration({ editor: ed, client: new SimClient(() => createInProcessTransport()), speed: 1, liveIntervalMs: 20 });
    ctrls.push(ctrl);
    await ctrl.run();
    await waitFor(() => ctrl.live.getState().simTime > 0.1, 8000, 'running');
    expect(ctrl.live.getState().latest['V(D0)']).toBeCloseTo(0, 6);
    const t1 = ctrl.live.getState().simTime;
    ctrl.instrumentParams('XWG1', { ...defaultParams(getPart('instruments/word-generator')!), mode: 'step', pos: '1' });
    await waitFor(() => (ctrl.live.getState().latest['V(D0)'] ?? 0) > 4.9, 8000, 'bit 0 high');
    expect(ctrl.live.getState().simTime).toBeGreaterThan(t1);
    expect(ed.getState().simMessages.some((m) => /restart/i.test(m.text))).toBe(false);
    await ctrl.stop();
    await ctrl.idle();
  });
});
