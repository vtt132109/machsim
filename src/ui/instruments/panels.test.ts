/**
 * Render every instrument panel to static markup (react-dom/server, no DOM) with realistic
 * inputs and check the readouts it shows. Canvas drawing runs in effects and is not exercised
 * here; the measurement and formatting paths are.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { InstrumentBinding, InstrumentKind, SignalRef } from '../../model/types';
import type { AnalysisResult } from '../../sim/results';
import { instrumentPanels } from './registry';
import { InstrumentStream } from './types';
import type { InstrumentPanelProps } from './types';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

const v = (pos: string): SignalRef => ({ kind: 'voltage', pos, neg: '0' });

function binding(kind: InstrumentKind, channels: InstrumentBinding['channels'], drives: string[] = []): InstrumentBinding {
  return { refdes: 'X1', partId: `instruments/${kind}`, kind, params: {}, channels, drives };
}

function streamOf(channels: string[], n: number, dt: number, f: (t: number) => number[]): InstrumentStream {
  const s = new InstrumentStream(channels);
  for (let i = 0; i < n; i++) s.push(i * dt, f(i * dt));
  return s;
}

function render(kind: InstrumentKind, props: Partial<InstrumentPanelProps> & { binding: InstrumentBinding }): string {
  const Panel = instrumentPanels[kind]!;
  const full: InstrumentPanelProps = {
    stream: new InstrumentStream(Object.keys(props.binding.channels)),
    simTime: 0,
    running: true,
    params: {},
    onParamsChange: () => {},
    ...props,
  };
  // strip tags so assertions read like the visible text
  return renderToStaticMarkup(createElement(Panel, full)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

const w = 2 * Math.PI * 1000;

describe('instrument panels render their readings', () => {
  it('multimeter shows an auto-ranged DC voltage', () => {
    const stream = streamOf(['v', 'i'], 200, 1e-5, () => [1.2345, Number.NaN]);
    const text = render('multimeter', { binding: binding('multimeter', { v: v('a') }), stream, params: { mode: 'v', coupling: 'dc' } });
    expect(text).toContain('1.2345 V');
    expect(text).toContain('Range 2 V');
  });

  it('multimeter shows AC true RMS in mV', () => {
    // 1000 samples per period keeps the piecewise-linear RMS error below 1e-5
    const stream = streamOf(['v'], 20000, 1e-6, (t) => [0.5 + 0.1 * Math.sin(w * t)]);
    const text = render('multimeter', { binding: binding('multimeter', { v: v('a') }), stream, params: { mode: 'v', coupling: 'ac' } });
    expect(text).toContain('70.71');
    expect(text).toContain('mV');
  });

  it('current clamp shows the instantaneous current and the output voltage', () => {
    const stream = streamOf(['i'], 50, 1e-5, () => [2e-3]);
    const text = render('current-clamp', { binding: binding('current-clamp', { i: { kind: 'current', element: 'V_XCP1' } }), stream, params: { ratio: '100' } });
    // exactly 2 mA does not fit the 2 mA range (max 1.9999), so the 20 mA range is used
    expect(text).toContain('2.000 mA');
    expect(text).toContain('200 mV');
  });

  it('wattmeter shows average power and power factor', () => {
    const stream = streamOf(['v', 'i'], 6000, 1e-6 * 3.7, (t) => [10 * Math.sin(w * t), 2 * Math.sin(w * t)]);
    const text = render('wattmeter', { binding: binding('wattmeter', { v: v('a'), i: { kind: 'current', element: 'V_XWM1' } }), stream });
    expect(text).toMatch(/(9\.99\d|10\.00\d) W/);
    expect(text).toContain('1.000');
  });

  it('frequency counter shows the frequency of a sine', () => {
    const stream = streamOf(['in'], 20000, 1e-6, (t) => [Math.sin(w * t)]);
    const text = render('frequency-counter', { binding: binding('frequency-counter', { in: v('a') }), stream });
    expect(text).toContain('1.0000 kHz');
  });

  it('distortion analyzer shows THD of a known signal', () => {
    const stream = streamOf(['in'], 20000, 1e-6, (t) => [Math.sin(w * t) + 0.1 * Math.sin(3 * w * t)]);
    const text = render('distortion-analyzer', { binding: binding('distortion-analyzer', { in: v('a') }), stream, params: { freq: '1k' } });
    // 333 samples per period of the 3rd harmonic: THD within 0.01 % of 10 %
    expect(text).toMatch(/ (9\.99\d\d|10\.00\d) % /);
  });

  it('function generator lists its settings and terminal levels', () => {
    const text = render('function-generator', { binding: binding('function-generator', {}, ['V_XFG1_p']), params: { waveform: 'square', freq: '2k', amplitude: '5', offset: '1' } });
    expect(text).toContain('Signal options');
    expect(text).toContain('1 V ± 5 V');
  });

  it('oscilloscope shows cursor readouts for connected channels', () => {
    const stream = streamOf(['A', 'B', 'ext'], 5000, 1e-6, (t) => [Math.sin(w * t), 2, 0]);
    const text = render('oscilloscope', { binding: binding('oscilloscope', { A: v('a'), B: v('b') }), stream, params: { timebase: '200u', t1: '0', t2: '5' } });
    expect(text).toContain('Channel A');
    expect(text).toContain('T2−T1');
    // T2 - T1 = 5 divisions x 200 us
    expect(text).toContain('1 ms');
    // channel B is a flat 2 V
    expect(text).toContain('2 V');
    const four = render('oscilloscope-4ch', { binding: binding('oscilloscope-4ch', { A: v('a'), D: v('d') }), stream: new InstrumentStream(['A', 'D']) });
    expect(four).toContain('Channel D');
  });

  it('Bode plotter reports the -3 dB corner of an RC low pass', () => {
    const f = Float64Array.from({ length: 121 }, (_, i) => 10 ** (1 + i / 30));
    const re = f.map((x) => 1 / (1 + (x / 1000) ** 2));
    const im = f.map((x) => -(x / 1000) / (1 + (x / 1000) ** 2));
    const ac: AnalysisResult = {
      type: 'ac',
      title: 'AC',
      scale: { name: 'frequency', unit: 'Hz', re: f },
      vectors: [
        { name: 'V(in)', unit: 'V', re: new Float64Array(f.length).fill(1), im: new Float64Array(f.length) },
        { name: 'V(out)', unit: 'V', re, im },
      ],
      warnings: [],
    };
    const text = render('bode-plotter', { binding: binding('bode-plotter', { in: v('in'), out: v('out') }), ac, params: { fstart: '10', fstop: '10meg' } });
    expect(text).toContain('1 kHz');
    const missing = render('bode-plotter', { binding: binding('bode-plotter', { in: v('in'), out: v('out') }) });
    expect(missing).toContain('Run the AC sweep');
  });

  it('spectrum analyzer finds the peak of a tone', () => {
    const stream = streamOf(['in'], 50000, 1e-6, (t) => [Math.sin(2 * Math.PI * 2000 * t)]);
    const text = render('spectrum-analyzer', { binding: binding('spectrum-analyzer', { in: v('a') }), stream, params: { fstart: '0', fstop: '10k', resolution: '50' } });
    // 2 kHz falls on a bin of the 50 Hz grid; 1 V peak = 0.707 V RMS = -3.01 dBV
    expect(text).toContain('Peak 2 kHz · -3.01 dBV');
  });

  it('IV analyzer tabulates one curve per run', () => {
    const run = (k: number): AnalysisResult => ({
      type: 'dc',
      title: 'DC',
      scale: { name: 'V_XIV1_v', unit: 'V', re: Float64Array.of(0, 5, 10) },
      vectors: [{ name: 'I(V_XIV1_i)', unit: 'A', re: Float64Array.of(0, k * 1e-3, k * 1e-3) }],
      warnings: [],
    });
    const dc: AnalysisResult = { ...run(1), runs: [{ label: 'Ib = 10 µA', result: run(1) }, { label: 'Ib = 20 µA', result: run(2) }] };
    const text = render('iv-analyzer', {
      binding: binding('iv-analyzer', { i: { kind: 'current', element: 'V_XIV1_i' } }, ['V_XIV1_v', 'I_XIV1_b']),
      dc,
      params: { device: 'bjt-npn', cursor: '5' },
    });
    expect(text).toContain('Ib = 20 µA');
    expect(text).toContain('2 mA');
  });

  it('network analyzer shows S-parameters at the marker', () => {
    const freq = Float64Array.of(1e6, 1e7);
    const run = (v1: number, v2: number): AnalysisResult => ({
      type: 'ac',
      title: 'AC',
      scale: { name: 'frequency', unit: 'Hz', re: freq },
      vectors: [
        { name: 'V(p1)', unit: 'V', re: Float64Array.of(v1, v1), im: Float64Array.of(0, 0) },
        { name: 'V(p2)', unit: 'V', re: Float64Array.of(v2, v2), im: Float64Array.of(0, 0) },
      ],
      warnings: [],
    });
    const ac: AnalysisResult = { ...run(2 / 3, 1 / 3), runs: [{ label: 'forward', result: run(2 / 3, 1 / 3) }, { label: 'reverse', result: run(1 / 3, 2 / 3) }] };
    const text = render('network-analyzer', { binding: binding('network-analyzer', { p1: v('p1'), p2: v('p2') }, ['V_XNA1_1', 'V_XNA1_2']), ac, params: { display: 's' } });
    expect(text).toContain('S21');
    // |S21| = 2/3 -> -3.52 dB ; |S11| = 1/3 -> -9.54 dB
    expect(text).toContain('-3.52 dB');
    expect(text).toContain('-9.54 dB');
    expect(text).toContain('unconditional');
  });

  it('logic analyzer reads words at the cursors', () => {
    const chans = [...Array.from({ length: 16 }, (_, i) => `d${i}`), 'clk', 'qual', 'trig'];
    const stream = streamOf(chans, 2000, 1e-5, (t) => chans.map((c) => (c === 'd0' ? (Math.floor(t * 1000) % 2 ? 5 : 0) : c === 'd1' ? 5 : 0)));
    const ch: InstrumentBinding['channels'] = {};
    for (let i = 0; i < 16; i++) ch[`d${i}`] = v(`n${i}`);
    const text = render('logic-analyzer', { binding: binding('logic-analyzer', ch), stream, params: { clockrate: '10k', pre: '0', post: '100' } });
    expect(text).toMatch(/T1 [\d.]+ ms · 000[23]/);
  });

  it('word generator lists the pattern words', () => {
    const text = render('word-generator', { binding: binding('word-generator', {}, ['V_XWG1_b0']), params: { pattern: '0,1,FF', bits: '8', mode: 'step', pos: '2' } });
    expect(text).toContain('Address 02');
    expect(text).toContain('word FF');
  });

  it('logic converter shows the truth table', () => {
    const html = renderToStaticMarkup(
      createElement(instrumentPanels['logic-converter']!, {
        binding: binding('logic-converter', { out: v('y') }, ['V_XLC1_A', 'V_XLC1_B']),
        stream: new InstrumentStream(['out']),
        simTime: 0,
        running: false,
        params: { inputs: '2', table: '0110' },
        onParamsChange: () => {},
      }),
    );
    expect(html).toContain('aria-label="Row 1 output 1"');
    expect(html).toContain('aria-label="Row 3 output 0"');
    expect(html).toContain('2 inputs wired');
  });
});
