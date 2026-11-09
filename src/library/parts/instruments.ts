/**
 * Virtual instruments (group 'instruments'). Each part sets `instrument` (InstrumentKind) and
 * `bindInstrument`, which the netlister turns into an InstrumentBinding:
 *   channels  keys follow INSTRUMENT_CHANNELS of src/ui/instruments/types.ts
 *   drives    names of the sources the instrument injects (for setParam / sweeps)
 * Reference terminals (the '-' / COM inputs) are tied to ground when left unconnected
 * (`groundWhenOpen`); unconnected signal inputs simply produce no channel.
 *
 * Electrical models
 *   multimeter XMM       V / dB: RI (1 GΩ) across +,-   A: 0 V sense + -> - (channel i)
 *                        Ω: test current ITEST pushed out of '+' (R = v / itest), 1 GΩ shunt
 *   function gen XFG     V_<ref>_p: V(+) - V(COM) = w(t);  V_<ref>_n: V(COM) - V(-) = w(t)
 *                        (outputs symmetric about COM), AC magnitude = amplitude
 *   oscilloscope XSC     ideal (no load); channels A, B (C, D), ext = V(x+) - V(x-)
 *   bode plotter XBP     ideal; channels in = V(IN+,IN-), out = V(OUT+,OUT-)
 *   wattmeter XWM        0 V sense I+ -> I- (channel i), voltage V(V+,V-) (channel v)
 *   counter XFC, spectrum XSA, distortion XDA: ideal inputs (channel in)
 *   IV analyzer XIV      swept source V_<ref>_v across P-N with sense V_<ref>_i into P;
 *                        control: I_<ref>_b into G (BJT) or V_<ref>_g G-N (MOSFET); 1 GΩ N->ground
 *   network an. XNA      port k: V_<ref>_k (AC EMF, port 1 = 1 V, port 2 = 0) through Z0
 *   logic analyzer XLA   ideal inputs d0..d15, clk, qual, trig
 *   word generator XWG   V_<ref>_b<k> from output b<k> to ground (PWL per bit)
 *   logic converter XLC  V_<ref>_<A..H> from each connected input to ground (dc 0; the
 *                        integration layer steps them), channel out
 *   current clamp XCP    0 V sense I+ -> I-; output V(V+,V-) = ratio·I (CCVS)
 */

import type { SignalRef } from '../../model/types';
import type { ElementIR, SourceSpec, Waveform } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import {
  elH,
  elI,
  elR,
  elSense,
  elV,
  internalNode,
  numParam,
  pinConnected,
  selectParam,
  textOf,
  textParam,
  type InstrumentBindContext,
  type InstrumentChannels,
  type LibraryPartDef,
} from '../partkit';
import { circle, line, makeSymbol, pin, sineGlyph, text, type BoxPin } from '../symbols';
import { columnSymbol, diff, disp, emittedSources, instrumentBox, put, single } from './instrumentKit';
import type { ParamDef, ToSpiceContext } from '../types';

function num(ctx: ToSpiceContext, key: string, min?: number): number {
  const v = ctx.num(key);
  if (min !== undefined && !(v >= min)) throw new Error(`bad value for ${key}: must be >= ${min}`);
  return v;
}

// ---------------------------------------------------------------------------
// Multimeter
// ---------------------------------------------------------------------------

const multimeter: LibraryPartDef = {
  id: 'instruments/multimeter',
  name: 'Multimeter',
  group: 'instruments',
  family: 'Instrument',
  description: 'Digital multimeter: voltage, current, resistance and dB (DC or AC true RMS)',
  prefix: 'XMM',
  instrument: 'multimeter',
  virtual: true,
  symbol: instrumentBox('XMM', [{ name: '+', number: '1' }, { name: '-', label: '−', number: '2' }]),
  params: [
    selectParam('mode', 'Function', 'v', [['v', 'Voltage'], ['a', 'Current'], ['ohm', 'Resistance'], ['db', 'Decibel']], { showOnSchematic: true }),
    selectParam('coupling', 'Coupling', 'dc', [['dc', 'DC'], ['ac', 'AC (RMS)']]),
    numParam('ri', 'Voltmeter resistance', '1G', 'Ω', { group: 'advanced', min: 0 }),
    numParam('ra', 'Ammeter resistance', '0', 'Ω', { group: 'advanced', min: 0, help: '0 = ideal' }),
    numParam('itest', 'Ohmmeter test current', '1m', 'A', { group: 'advanced', min: 0 }),
    numParam('dbref', 'dB reference voltage', '774.597m', 'V', { group: 'advanced', min: 0 }),
  ],
  groundWhenOpen: ['-'],
  toSpice: (ctx) => {
    const mode = textOf(ctx, 'mode', 'v').trim().toLowerCase();
    const p = ctx.node('+');
    const n = ctx.node('-');
    if (mode === 'a') {
      const ra = num(ctx, 'ra', 0);
      if (ra === 0) return { elements: [elSense(ctx.name('V'), p, n)] };
      const mid = internalNode(ctx, 'm');
      return { elements: [elSense(ctx.name('V'), p, mid), elR(ctx.name('R'), mid, n, ra)] };
    }
    const ri = num(ctx, 'ri', 0);
    const els: ElementIR[] = ri > 0 ? [elR(ctx.name('R'), p, n, ri)] : [];
    if (mode === 'ohm') els.push(elI(ctx.name('I'), n, p, { dc: num(ctx, 'itest', 0) }));
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'v', diff(ctx, '+', '-'));
    const mode = (ctx.params.mode ?? 'v').trim().toLowerCase();
    if (mode === 'a') ch.i = { kind: 'current', element: ctx.name('V') };
    return { channels: ch, drives: mode === 'ohm' ? [ctx.name('I')] : [] };
  },
  keywords: ['multimeter', 'dmm', 'voltmeter', 'ammeter', 'ohmmeter', 'xmm'],
};

// ---------------------------------------------------------------------------
// Function generator
// ---------------------------------------------------------------------------

/** Generator waveform relative to COM (settings validated like the instrument panel). */
export function generatorWaveform(params: Record<string, string>): { tran: Waveform; acMag: number } {
  const get = (k: string): number => {
    const v = parseUserNumber(params[k] ?? '');
    if (!Number.isFinite(v)) throw new Error(`bad value for ${k}`);
    return v;
  };
  const w = (params.waveform ?? 'sine').trim().toLowerCase();
  const f = get('freq');
  const duty = get('duty') / 100;
  const a = get('amplitude');
  const off = get('offset');
  const rt = get('risetime');
  if (!(f > 0)) throw new Error('bad value for freq: must be > 0');
  if (!(duty >= 0.01 && duty <= 0.99)) throw new Error('bad value for duty: must be 1..99 %');
  if (!(a >= 0)) throw new Error('bad value for amplitude: must be >= 0');
  if (!(rt > 0)) throw new Error('bad value for risetime: must be > 0');
  const T = 1 / f;
  const lo = off - a;
  const hi = off + a;
  let tran: Waveform;
  if (w === 'sine') tran = { type: 'SIN', args: [off, a, f, 0, 0, 0] };
  else if (w === 'triangle') tran = { type: 'PULSE', args: [lo, hi, 0, duty * T, (1 - duty) * T, 0, T] };
  else if (w === 'square') {
    const tr = Math.min(rt, duty * T * 0.5, (1 - duty) * T * 0.5);
    tran = { type: 'PULSE', args: [lo, hi, 0, tr, tr, Math.max(0, duty * T - tr), T] };
  } else throw new Error(`bad value for waveform: '${w}' (sine, triangle or square)`);
  return { tran, acMag: a };
}

const functionGenerator: LibraryPartDef = {
  id: 'instruments/function-generator',
  name: 'Function Generator',
  group: 'instruments',
  family: 'Instrument',
  description: 'Sine / triangle / square generator; + and - outputs are symmetric about COM',
  prefix: 'XFG',
  instrument: 'function-generator',
  virtual: true,
  symbol: instrumentBox('XFG', [{ name: '+', number: '1' }, { name: 'COM', label: 'C', number: '2' }, { name: '-', label: '−', number: '3' }], {
    w: 80,
  }),
  params: [
    selectParam('waveform', 'Waveform', 'sine', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square']], { showOnSchematic: true }),
    numParam('freq', 'Frequency', '1k', 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('duty', 'Duty cycle', '50', '%', { min: 1, max: 99 }),
    numParam('amplitude', 'Amplitude (peak)', '1', 'V', { showOnSchematic: true, min: 0 }),
    numParam('offset', 'Offset', '0', 'V'),
    numParam('risetime', 'Rise / fall time', '1n', 's', { group: 'advanced', min: 0 }),
  ],
  groundWhenOpen: ['COM'],
  optionalPins: ['+', '-'],
  toSpice: (ctx) => {
    const { tran, acMag } = generatorWaveform(ctx.params);
    const els: ElementIR[] = [];
    const com = ctx.node('COM');
    if (pinConnected(ctx, '+')) els.push(elV(ctx.name('V', 'p'), ctx.node('+'), com, { tran: { ...tran, args: [...tran.args] }, acMag }));
    if (pinConnected(ctx, '-')) els.push(elV(ctx.name('V', 'n'), com, ctx.node('-'), { tran: { ...tran, args: [...tran.args] }, acMag }));
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'out', diff(ctx, '+', 'COM'));
    return { channels: ch, drives: emittedSources(ctx) };
  },
  keywords: ['function generator', 'signal generator', 'xfg', 'sine', 'square', 'triangle'],
};

// ---------------------------------------------------------------------------
// Oscilloscopes
// ---------------------------------------------------------------------------

function scopeParams(channels: string[]): ParamDef[] {
  const out: ParamDef[] = [
    disp(numParam('timebase', 'Timebase', '1m', 's/div', { min: 0 })),
    disp(numParam('xpos', 'X position', '0', 'div')),
    disp(selectParam('display', 'Display', 'yt', [['yt', 'Y/T'], ['add', 'Add'], ['ba', 'B/A'], ['ab', 'A/B']])),
  ];
  for (const c of channels) {
    out.push(disp(numParam(`${c}.scale`, `Channel ${c} scale`, '1', 'V/div', { min: 0 })));
    out.push(disp(numParam(`${c}.pos`, `Channel ${c} position`, '0', 'div')));
    out.push(disp(selectParam(`${c}.coupling`, `Channel ${c} coupling`, 'dc', [['ac', 'AC'], ['dc', 'DC'], ['gnd', '0']])));
  }
  out.push(
    disp(selectParam('trig.source', 'Trigger source', 'A', [...channels.map((c) => [c, c] as [string, string]), ['ext', 'Ext']])),
    disp(numParam('trig.level', 'Trigger level', '0', 'V')),
    disp(selectParam('trig.edge', 'Trigger edge', 'rising', [['rising', 'Rising'], ['falling', 'Falling']])),
    disp(selectParam('trig.mode', 'Trigger mode', 'auto', [['auto', 'Auto'], ['normal', 'Normal'], ['single', 'Single'], ['none', 'None']])),
  );
  return out;
}

function scope(four: boolean): LibraryPartDef {
  const chans = four ? ['A', 'B', 'C', 'D'] : ['A', 'B'];
  const bottom: BoxPin[] = chans.flatMap((c, i) => [
    { name: `${c}+`, label: `${c}+`, number: String(2 * i + 1) },
    { name: `${c}-`, label: `${c}−`, number: String(2 * i + 2) },
  ]);
  const ext: BoxPin[] = [
    { name: 'Ext+', label: 'T+', number: String(bottom.length + 1) },
    { name: 'Ext-', label: 'T−', number: String(bottom.length + 2) },
  ];
  return {
    id: four ? 'instruments/scope-4ch' : 'instruments/scope',
    name: four ? 'Oscilloscope (4 channels)' : 'Oscilloscope',
    group: 'instruments',
    family: 'Instrument',
    description: `${four ? 'Four' : 'Two'}-channel oscilloscope with external trigger; each channel shows V(x+) - V(x-) (x- grounded when open)`,
    prefix: 'XSC',
    instrument: four ? 'oscilloscope-4ch' : 'oscilloscope',
    virtual: true,
    symbol: instrumentBox('XSC', four ? bottom : [...bottom, ...ext], four ? { w: 180, right: ext } : { w: 140 }),
    params: scopeParams(chans),
    groundWhenOpen: [...chans.map((c) => `${c}-`), 'Ext-'],
    optionalPins: [...chans.flatMap((c) => [`${c}+`, `${c}-`]), 'Ext+', 'Ext-'],
    bindInstrument: (ctx) => {
      const ch: Record<string, SignalRef> = {};
      for (const c of chans) put(ch, c, diff(ctx, `${c}+`, `${c}-`));
      put(ch, 'ext', diff(ctx, 'Ext+', 'Ext-'));
      return { channels: ch, drives: [] };
    },
    keywords: ['oscilloscope', 'scope', 'xsc', 'waveform'],
  };
}

// ---------------------------------------------------------------------------
// Bode plotter, wattmeter, counter, spectrum / distortion analyzers
// ---------------------------------------------------------------------------

const bodePlotter: LibraryPartDef = {
  id: 'instruments/bode-plotter',
  name: 'Bode Plotter',
  group: 'instruments',
  family: 'Instrument',
  description: 'Magnitude / phase of V(OUT+,OUT-) / V(IN+,IN-) versus frequency (needs an AC source in the circuit)',
  prefix: 'XBP',
  instrument: 'bode-plotter',
  virtual: true,
  symbol: instrumentBox('XBP', [
    { name: 'IN+', label: 'I+', number: '1' },
    { name: 'IN-', label: 'I−', number: '2' },
    { name: 'OUT+', label: 'O+', number: '3' },
    { name: 'OUT-', label: 'O−', number: '4' },
  ]),
  params: [
    disp(selectParam('mode', 'Mode', 'mag', [['mag', 'Magnitude'], ['phase', 'Phase']])),
    disp(selectParam('hscale', 'Horizontal scale', 'log', [['log', 'Log'], ['lin', 'Linear']])),
    disp(selectParam('vscale', 'Vertical scale', 'log', [['log', 'Log (dB)'], ['lin', 'Linear']])),
    numParam('fstart', 'Start frequency', '1', 'Hz', { min: 0 }),
    numParam('fstop', 'Stop frequency', '10G', 'Hz', { min: 0 }),
    numParam('points', 'Points per decade', '100', '', { min: 1 }),
    disp(numParam('mmin', 'Magnitude min', '-200', '')),
    disp(numParam('mmax', 'Magnitude max', '20', '')),
    disp(numParam('pmin', 'Phase min', '-720', '°')),
    disp(numParam('pmax', 'Phase max', '720', '°')),
  ],
  groundWhenOpen: ['IN-', 'OUT-'],
  optionalPins: ['IN+', 'IN-', 'OUT+', 'OUT-'],
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'in', diff(ctx, 'IN+', 'IN-'));
    put(ch, 'out', diff(ctx, 'OUT+', 'OUT-'));
    return { channels: ch, drives: [] };
  },
  keywords: ['bode', 'frequency response', 'xbp', 'gain', 'phase'],
};

const wattmeter: LibraryPartDef = {
  id: 'instruments/wattmeter',
  name: 'Wattmeter',
  group: 'instruments',
  family: 'Instrument',
  description: 'Average power and power factor: voltage across V+,V- times the current flowing I+ -> I- through the meter',
  prefix: 'XWM',
  instrument: 'wattmeter',
  virtual: true,
  symbol: instrumentBox('XWM', [
    { name: 'V+', label: 'V+', number: '1' },
    { name: 'V-', label: 'V−', number: '2' },
    { name: 'I+', label: 'I+', number: '3' },
    { name: 'I-', label: 'I−', number: '4' },
  ]),
  params: [],
  groundWhenOpen: ['V-'],
  toSpice: (ctx) => ({ elements: [elSense(ctx.name('V'), ctx.node('I+'), ctx.node('I-'))] }),
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'v', diff(ctx, 'V+', 'V-'));
    ch.i = { kind: 'current', element: ctx.name('V') };
    return { channels: ch, drives: [] };
  },
  keywords: ['wattmeter', 'power', 'power factor', 'xwm'],
};

function singleInput(id: string, name: string, description: string, prefix: string, kind: 'frequency-counter' | 'spectrum-analyzer' | 'distortion-analyzer', params: ParamDef[], keywords: string[]): LibraryPartDef {
  return {
    id: `instruments/${id}`,
    name,
    group: 'instruments',
    family: 'Instrument',
    description,
    prefix,
    instrument: kind,
    virtual: true,
    symbol: instrumentBox(prefix, [{ name: 'IN+', label: '+', number: '1' }, { name: 'IN-', label: '−', number: '2' }]),
    params,
    groundWhenOpen: ['IN-'],
    bindInstrument: (ctx) => {
      const ch: Record<string, SignalRef> = {};
      put(ch, 'in', diff(ctx, 'IN+', 'IN-'));
      return { channels: ch, drives: [] };
    },
    keywords,
  };
}

const frequencyCounter = singleInput(
  'frequency-counter',
  'Frequency Counter',
  'Frequency, period, pulse widths and rise / fall times of V(IN+,IN-)',
  'XFC',
  'frequency-counter',
  [
    disp(selectParam('measure', 'Measurement', 'freq', [['freq', 'Frequency'], ['period', 'Period'], ['pulse', 'Pulse'], ['edges', 'Rise / fall']])),
    selectParam('coupling', 'Coupling', 'ac', [['ac', 'AC'], ['dc', 'DC']]),
    numParam('sensitivity', 'Sensitivity (RMS)', '3m', 'V', { min: 0 }),
    numParam('triglevel', 'Trigger level', '0', 'V'),
  ],
  ['frequency counter', 'counter', 'xfc', 'period'],
);

const spectrumAnalyzer = singleInput(
  'spectrum-analyzer',
  'Spectrum Analyzer',
  'Amplitude spectrum (windowed FFT) of V(IN+,IN-) over a start..stop span',
  'XSA',
  'spectrum-analyzer',
  [
    numParam('fstart', 'Start frequency', '0', 'Hz', { min: 0 }),
    numParam('fstop', 'Stop frequency', '10k', 'Hz', { min: 0 }),
    selectParam('window', 'Window', 'hann', [['hann', 'Hann'], ['rect', 'Rectangular'], ['flattop', 'Flat top']]),
    disp(selectParam('units', 'Amplitude units', 'db', [['db', 'dB'], ['dbm', 'dBm'], ['lin', 'Linear']])),
  ],
  ['spectrum analyzer', 'fft', 'xsa', 'frequency domain'],
);

const distortionAnalyzer = singleInput(
  'distortion-analyzer',
  'Distortion Analyzer',
  'Total harmonic distortion and SINAD of V(IN+,IN-) at the given fundamental',
  'XDA',
  'distortion-analyzer',
  [
    numParam('freq', 'Fundamental frequency', '1k', 'Hz', { min: 0 }),
    selectParam('mode', 'Measurement', 'thd', [['thd', 'THD'], ['sinad', 'SINAD']]),
    selectParam('definition', 'THD definition', 'ieee', [['ieee', 'IEEE (vs fundamental)'], ['iec', 'IEC (vs total RMS)']]),
    numParam('harmonics', 'Harmonics', '10', '', { min: 2 }),
  ],
  ['distortion analyzer', 'thd', 'sinad', 'xda'],
);

// ---------------------------------------------------------------------------
// IV analyzer
// ---------------------------------------------------------------------------

const IV_CONTROL_DEFAULT: Record<string, number> = { 'bjt-npn': 10e-6, 'bjt-pnp': -10e-6, nmos: 2, pmos: -2 };

const ivAnalyzer: LibraryPartDef = {
  id: 'instruments/iv-analyzer',
  name: 'IV Analyzer',
  group: 'instruments',
  family: 'Instrument',
  description: 'Current-voltage curve tracer for diodes, BJTs and MOSFETs (connect the device ONLY to the analyzer): P = anode / collector / drain, G = base / gate, N = cathode / emitter / source',
  prefix: 'XIV',
  instrument: 'iv-analyzer',
  virtual: true,
  symbol: instrumentBox('XIV', [
    { name: 'P', label: '+', number: '1' },
    { name: 'G', label: 'G', number: '2' },
    { name: 'N', label: '−', number: '3' },
  ], { w: 80 }),
  params: [
    selectParam('device', 'Device', 'diode', [['diode', 'Diode'], ['bjt-npn', 'BJT NPN'], ['bjt-pnp', 'BJT PNP'], ['nmos', 'MOSFET N'], ['pmos', 'MOSFET P']], { showOnSchematic: true }),
    numParam('vstart', 'Sweep start', '', 'V', { help: 'Blank = device preset' }),
    numParam('vstop', 'Sweep stop', '', 'V', { help: 'Blank = device preset' }),
    numParam('vstep', 'Sweep step', '', 'V', { help: 'Blank = device preset' }),
    numParam('cstart', 'Control start', '', '', { help: 'Base current (A) or gate voltage (V); blank = preset' }),
    numParam('cstop', 'Control stop', '', '', { help: 'Blank = preset' }),
    numParam('csteps', 'Control steps', '', '', { help: 'Blank = preset' }),
    disp(selectParam('iscale', 'Current scale', 'lin', [['lin', 'Linear'], ['log', 'Log']])),
  ],
  optionalPins: ['G'],
  toSpice: (ctx) => {
    const device = textOf(ctx, 'device', 'diode').trim().toLowerCase();
    if (!['diode', 'bjt-npn', 'bjt-pnp', 'nmos', 'pmos'].includes(device)) throw new Error(`bad value for device: '${device}'`);
    const blankOr = (k: string, d: number) => {
      const t = (ctx.params[k] ?? '').trim();
      return t === '' ? d : ctx.num(k);
    };
    const m = internalNode(ctx, 'm');
    const nNode = ctx.node('N');
    const els: ElementIR[] = [
      elV(ctx.name('V', 'v'), m, nNode, { dc: blankOr('vstart', 0) }),
      elSense(ctx.name('V', 'i'), m, ctx.node('P')),
      elR(ctx.name('R', 'ref'), nNode, '0', 1e9),
    ];
    if (device.startsWith('bjt')) els.push(elI(ctx.name('I', 'b'), nNode, ctx.node('G'), { dc: blankOr('cstart', IV_CONTROL_DEFAULT[device]) }));
    else if (device !== 'diode') els.push(elV(ctx.name('V', 'g'), ctx.node('G'), nNode, { dc: blankOr('cstart', IV_CONTROL_DEFAULT[device]) }));
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = { i: { kind: 'current', element: ctx.name('V', 'i') } };
    put(ch, 'v', diff(ctx, 'P', 'N'));
    const drives = [ctx.name('V', 'v')];
    const control = ctx.elements.find((e) => e.name === ctx.name('I', 'b') || e.name === ctx.name('V', 'g'));
    if (control) drives.push(control.name);
    return { channels: ch, drives };
  },
  keywords: ['iv analyzer', 'curve tracer', 'xiv', 'characteristic'],
};

// ---------------------------------------------------------------------------
// Network analyzer
// ---------------------------------------------------------------------------

const networkAnalyzer: LibraryPartDef = {
  id: 'instruments/network-analyzer',
  name: 'Network Analyzer',
  group: 'instruments',
  family: 'Instrument',
  description: 'Two-port S-parameters: each port is an AC source behind Z0 (port 1 driven = forward run); P1 / P2 referenced to ground',
  prefix: 'XNA',
  instrument: 'network-analyzer',
  virtual: true,
  symbol: instrumentBox('XNA', [{ name: 'P1', number: '1' }, { name: 'P2', number: '2' }]),
  params: [
    numParam('z0', 'Reference impedance', '50', 'Ω', { min: 0 }),
    numParam('fstart', 'Start frequency', '1M', 'Hz', { min: 0 }),
    numParam('fstop', 'Stop frequency', '10G', 'Hz', { min: 0 }),
    numParam('points', 'Points per decade', '50', '', { min: 1 }),
    disp(selectParam('display', 'Display', 's', [['s', 'S-parameters'], ['z', 'Z-parameters'], ['y', 'Y-parameters'], ['h', 'H-parameters'], ['smith', 'Smith chart']])),
  ],
  optionalPins: ['P2'],
  toSpice: (ctx) => {
    const z0 = ctx.num('z0');
    if (!(z0 > 0)) throw new Error('bad value for z0: must be > 0');
    const els: ElementIR[] = [];
    (['1', '2'] as const).forEach((k) => {
      const p = `P${k}`;
      if (!pinConnected(ctx, p)) return;
      const s = internalNode(ctx, `s${k}`);
      const spec: SourceSpec = k === '1' ? { dc: 0, acMag: 1 } : { dc: 0 };
      els.push(elV(ctx.name('V', k), s, '0', spec), elR(ctx.name('R', k), s, ctx.node(p), z0));
    });
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'p1', single(ctx, 'P1'));
    put(ch, 'p2', single(ctx, 'P2'));
    return { channels: ch, drives: emittedSources(ctx) };
  },
  keywords: ['network analyzer', 's-parameters', 'xna', 'smith chart', 'rf'],
};

// ---------------------------------------------------------------------------
// Logic analyzer, word generator, logic converter
// ---------------------------------------------------------------------------

const LA_INPUTS = Array.from({ length: 16 }, (_, i) => `d${i}`);

const logicAnalyzer: LibraryPartDef = {
  id: 'instruments/logic-analyzer',
  name: 'Logic Analyzer',
  group: 'instruments',
  family: 'Instrument',
  description: '16-channel logic analyzer with external clock, clock qualifier and trigger inputs (ideal inputs, threshold-based)',
  prefix: 'XLA',
  instrument: 'logic-analyzer',
  virtual: true,
  symbol: columnSymbol('XLA', 'left', LA_INPUTS, LA_INPUTS.map((_, i) => i.toString(16).toUpperCase()), ['clk', 'qual', 'trig']),
  params: [
    numParam('threshold', 'Threshold', '2.5', 'V'),
    selectParam('clock', 'Clock', 'internal', [['internal', 'Internal'], ['external', 'External']]),
    numParam('clockrate', 'Internal clock rate', '10k', 'Hz', { min: 0 }),
    selectParam('clkedge', 'Clock edge', 'rising', [['rising', 'Rising'], ['falling', 'Falling']]),
    selectParam('qual', 'Clock qualifier', 'x', [['x', 'X'], ['0', '0'], ['1', '1']]),
    selectParam('trigmode', 'Trigger', 'none', [['none', 'None'], ['pattern', 'Pattern']]),
    textParam('pattern', 'Trigger pattern', 'xxxxxxxxxxxxxxxx', { help: '16 characters 0 / 1 / x, MSB (d15) first' }),
    numParam('pre', 'Pre-trigger samples', '100', '', { min: 0 }),
    numParam('post', 'Post-trigger samples', '400', '', { min: 0 }),
  ],
  optionalPins: [...LA_INPUTS, 'clk', 'qual', 'trig'],
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    for (const p of [...LA_INPUTS, 'clk', 'qual', 'trig']) put(ch, p, single(ctx, p));
    return { channels: ch, drives: [] };
  },
  keywords: ['logic analyzer', 'xla', 'digital', 'timing diagram'],
};

const WG_OUTPUTS = Array.from({ length: 16 }, (_, i) => `b${i}`);

export interface WordGenSpec {
  words: number[];
  freq: number;
  mode: 'cycle' | 'burst' | 'step';
  start: number;
  end: number;
  pos: number;
  vlow: number;
  vhigh: number;
  rise: number;
}

/** Parse hex words ("0000,00FF ..."; optional 0x) masked to `bits`. Throws on invalid tokens. */
export function parseWordPattern(text: string, bits: number): number[] {
  const mask = bits >= 32 ? 0xffffffff : 2 ** bits - 1;
  const out: number[] = [];
  for (const tok of text.split(/[\s,;]+/).filter(Boolean)) {
    const t = tok.replace(/^0x/i, '');
    if (!/^[0-9a-f]{1,8}$/i.test(t)) throw new Error(`bad value for pattern: '${tok}' is not a hex word`);
    out.push((parseInt(t, 16) & mask) >>> 0);
  }
  return out.length ? out : [0];
}

/**
 * Source spec of output bit `bit`: step mode -> DC level of word `pos`; cycle -> PWL over one pass
 * start..end repeating from 0; burst -> one pass, then the last word holds. Transitions take
 * `rise` and END on the word boundaries k/freq.
 */
export function wordBitSource(s: WordGenSpec, bit: number): SourceSpec {
  const level = (w: number) => (((w >>> bit) & 1) === 1 ? s.vhigh : s.vlow);
  if (s.mode === 'step') return { dc: level(s.words[s.pos] ?? 0) };
  const seq = s.words.slice(s.start, s.end + 1);
  const levels = seq.map(level);
  if (levels.every((l) => l === levels[0])) return { dc: levels[0] };
  const T = 1 / s.freq;
  const tr = Math.min(s.rise, T / 4);
  const pts = [0, levels[0]];
  let prev = levels[0];
  for (let k = 1; k < levels.length; k++) {
    if (levels[k] !== prev) {
      pts.push(k * T - tr, prev, k * T, levels[k]);
      prev = levels[k];
    }
  }
  if (s.mode === 'burst') return { tran: { type: 'PWL', args: pts } };
  const tEnd = levels.length * T;
  if (prev !== levels[0]) pts.push(tEnd - tr, prev, tEnd, levels[0]);
  else pts.push(tEnd, prev);
  return { tran: { type: 'PWL', args: pts, repeatFrom: 0 } };
}

function wordGenSpec(ctx: ToSpiceContext): WordGenSpec {
  const bits = Math.round(num(ctx, 'bits', 1));
  if (bits > 32) throw new Error('bad value for bits: at most 32');
  const words = parseWordPattern(textOf(ctx, 'pattern'), bits);
  const last = words.length - 1;
  const int = (k: string, d: number) => {
    const t = (ctx.params[k] ?? '').trim();
    return t === '' ? d : Math.round(ctx.num(k));
  };
  const start = Math.max(0, Math.min(last, int('start', 0)));
  const end = Math.max(start, Math.min(last, int('end', last)));
  const mode = textOf(ctx, 'mode', 'cycle').trim().toLowerCase();
  if (mode !== 'cycle' && mode !== 'burst' && mode !== 'step') throw new Error(`bad value for mode: '${mode}'`);
  const freq = ctx.num('freq');
  if (!(freq > 0)) throw new Error('bad value for freq: must be > 0');
  return {
    words,
    freq,
    mode,
    start,
    end,
    pos: Math.max(0, Math.min(last, int('pos', start))),
    vlow: ctx.num('vlow'),
    vhigh: ctx.num('vhigh'),
    rise: num(ctx, 'rise', 0) || 1e-9,
  };
}

const wordGenerator: LibraryPartDef = {
  id: 'instruments/word-generator',
  name: 'Word Generator',
  group: 'instruments',
  family: 'Instrument',
  description: '16-bit word generator: plays hex words at the word rate on outputs b0..b15 (cycle, burst or step mode)',
  prefix: 'XWG',
  instrument: 'word-generator',
  virtual: true,
  symbol: columnSymbol('XWG', 'right', WG_OUTPUTS, WG_OUTPUTS.map((_, i) => i.toString(16).toUpperCase()), []),
  params: [
    textParam('pattern', 'Words (hex)', '0,1,2,3,4,5,6,7,8,9,A,B,C,D,E,F', { help: 'Comma-separated hex words, address 0 first' }),
    numParam('freq', 'Word rate', '1k', 'Hz', { showOnSchematic: true, min: 0 }),
    selectParam('mode', 'Mode', 'cycle', [['cycle', 'Cycle'], ['burst', 'Burst'], ['step', 'Step']]),
    numParam('bits', 'Word width', '16', 'bit', { min: 1, max: 32 }),
    numParam('start', 'Start address', '0', '', { min: 0 }),
    numParam('end', 'End address', '', '', { help: 'Blank = last word' }),
    numParam('pos', 'Step position', '0', '', { min: 0 }),
    numParam('vhigh', 'High level', '5', 'V'),
    numParam('vlow', 'Low level', '0', 'V'),
    numParam('rise', 'Edge time', '10n', 's', { group: 'advanced', min: 0 }),
    disp(selectParam('display', 'Display', 'hex', [['hex', 'Hex'], ['bin', 'Binary']])),
  ],
  optionalPins: WG_OUTPUTS,
  toSpice: (ctx) => {
    const s = wordGenSpec(ctx);
    const els: ElementIR[] = [];
    WG_OUTPUTS.forEach((p, bit) => {
      if (pinConnected(ctx, p)) els.push(elV(ctx.name('V', p), ctx.node(p), '0', wordBitSource(s, bit)));
    });
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    for (const p of WG_OUTPUTS) put(ch, p, single(ctx, p));
    return { channels: ch, drives: emittedSources(ctx) };
  },
  keywords: ['word generator', 'pattern generator', 'xwg', 'digital'],
};

const LC_INPUTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const logicConverter: LibraryPartDef = {
  id: 'instruments/logic-converter',
  name: 'Logic Converter',
  group: 'instruments',
  family: 'Instrument',
  description: 'Truth table / Boolean expression tool: drives inputs A..H and reads OUT ("circuit -> truth table"), or converts between table and expression',
  prefix: 'XLC',
  instrument: 'logic-converter',
  virtual: true,
  symbol: instrumentBox('XLC', LC_INPUTS.map((n, i) => ({ name: n, number: String(i + 1) })), { w: 180, right: [{ name: 'OUT', label: 'Out', number: '9', type: 'input' }] }),
  params: [
    numParam('vhigh', 'Logic 1 level', '5', 'V'),
    numParam('threshold', 'Output threshold', '2.5', 'V'),
    textParam('table', 'Truth table', '', { help: "One character (0, 1, X) per row, row 0 = all inputs 0; A is the MSB" }),
    textParam('expr', 'Expression', '', { help: "Boolean expression in A..H, e.g. A'B + C" }),
  ],
  optionalPins: [...LC_INPUTS, 'OUT'],
  toSpice: (ctx) => {
    const els: ElementIR[] = [];
    for (const p of LC_INPUTS) if (pinConnected(ctx, p)) els.push(elV(ctx.name('V', p), ctx.node(p), '0', { dc: 0 }));
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'out', single(ctx, 'OUT'));
    return { channels: ch, drives: emittedSources(ctx) };
  },
  keywords: ['logic converter', 'truth table', 'boolean', 'xlc'],
};

// ---------------------------------------------------------------------------
// Current clamp
// ---------------------------------------------------------------------------

const currentClamp: LibraryPartDef = {
  id: 'instruments/current-clamp',
  name: 'Current Clamp',
  group: 'instruments',
  family: 'Instrument',
  description: 'Current probe: the conductor runs I+ -> I- through the clamp; output V(V+,V-) = ratio · I (connect to a scope)',
  prefix: 'XCP',
  instrument: 'current-clamp',
  virtual: true,
  symbol: makeSymbol(
    [
      line(-30, 0, 30, 0),
      circle(0, 0, 12),
      sineGlyph(0, -20, 10, 3),
      line(-10, 12, -10, 30),
      line(10, 12, 10, 30),
      text(0, -30, 'XCP', 8, 'middle', true),
    ],
    [pin('I+', -30, 0, 'left', { number: '1' }), pin('I-', 30, 0, 'right', { number: '2' }), pin('V+', -10, 30, 'down', { label: '+', number: '3' }), pin('V-', 10, 30, 'down', { label: '−', number: '4' })],
    { refPos: { x: 22, y: -18 }, valuePos: { x: 24, y: 24 } },
  ),
  params: [numParam('ratio', 'Output ratio', '1', 'V/A', { showOnSchematic: true })],
  groundWhenOpen: ['V-'],
  optionalPins: ['V+', 'V-'],
  toSpice: (ctx) => {
    const sense = ctx.name('V');
    const els: ElementIR[] = [elSense(sense, ctx.node('I+'), ctx.node('I-'))];
    if (pinConnected(ctx, 'V+')) els.push(elH(ctx.name('H'), ctx.node('V+'), ctx.node('V-'), sense, ctx.num('ratio')));
    return { elements: els };
  },
  bindInstrument: (ctx): InstrumentChannels => ({ channels: { i: { kind: 'current', element: ctx.name('V') } }, drives: [] }),
  keywords: ['current clamp', 'current probe', 'xcp'],
};

export const INSTRUMENT_PARTS: LibraryPartDef[] = [
  multimeter,
  functionGenerator,
  scope(false),
  scope(true),
  bodePlotter,
  wattmeter,
  frequencyCounter,
  ivAnalyzer,
  spectrumAnalyzer,
  networkAnalyzer,
  distortionAnalyzer,
  logicAnalyzer,
  wordGenerator,
  logicConverter,
  currentClamp,
];
