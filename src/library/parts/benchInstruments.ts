/**
 * Bench-style instruments (group 'instruments', original generic designs — no brand look-alikes):
 *
 *   bench-generator     XAG  function / arbitrary waveform generator: OUT and COM through a 50 Ω
 *                        output resistance (V_<ref> EMF, R_<ref>_o), optional SYNC (TTL square at
 *                        the signal frequency); waveforms and modulation in benchSignals.ts.
 *   bench-multimeter    XDM  6½-digit multimeter: HI–LO voltage / resistance input (10 MΩ or > 10 GΩ),
 *                        separate I (current) terminal through a 0 V sense source and the burden
 *                        resistance to LO; resistance, continuity and diode test push the test
 *                        current out of HI (I_<ref>).
 *   bench-scope         XDS  4-channel digital storage oscilloscope, inputs CH1..CH4 and EXT
 *                        referenced to the common GND terminal (grounded when open).
 *   mixed-signal-scope  XMS  2 analog channels plus 16 logic channels D0..D15 and EXT, all against GND.
 *
 * Channel keys (INSTRUMENT_CHANNELS): generator ['out', 'sync'], multimeter ['v', 'i'], scopes
 * 'A'..'D' (shown as CH1..CH4), 'ext' and 'd0'..'d15'. Every front-panel setting is a param (text,
 * user number syntax), so instrument settings are saved with the design.
 */
import type { SignalRef } from '../../model/types';
import type { ElementIR } from '../../sim/netlist';
import { elB, elI, elR, elSense, elV, internalNode, numParam, pinConnected, selectParam, textParam, type LibraryPartDef } from '../partkit';
import type { ParamDef } from '../types';
import { BENCH_GEN_DEFAULTS, benchGenSettings, benchWave } from './benchSignals';
import { columnSymbol, diff, disp, emittedSources, instrumentBox, put } from './instrumentKit';

// ---------------------------------------------------------------------------
// Function / arbitrary waveform generator
// ---------------------------------------------------------------------------

const D = BENCH_GEN_DEFAULTS;

const benchGenerator: LibraryPartDef = {
  id: 'instruments/bench-generator',
  name: 'Bench Waveform Generator',
  group: 'instruments',
  family: 'Instrument',
  description: 'Bench function / arbitrary waveform generator: sine, square, triangle, ramp, pulse, noise, DC and arbitrary shapes, AM / FM / burst / sweep, 50 Ω output and TTL sync',
  prefix: 'XAG',
  instrument: 'bench-generator',
  virtual: true,
  symbol: instrumentBox('AWG', [{ name: 'OUT', number: '1' }, { name: 'COM', label: 'C', number: '2' }, { name: 'SYNC', label: 'S', number: '3' }], { w: 100 }),
  params: [
    selectParam('waveform', 'Waveform', D.waveform, [['sine', 'Sine'], ['square', 'Square'], ['triangle', 'Triangle'], ['ramp', 'Ramp'], ['pulse', 'Pulse'], ['noise', 'Noise'], ['dc', 'DC'], ['arb', 'Arbitrary']], { showOnSchematic: true }),
    numParam('freq', 'Frequency', D.freq, 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('amplitude', 'Amplitude (peak-to-peak)', D.amplitude, 'V', { showOnSchematic: true, min: 0 }),
    numParam('offset', 'Offset', D.offset, 'V'),
    numParam('duty', 'Duty cycle', D.duty, '%', { min: 1, max: 99 }),
    numParam('symmetry', 'Ramp symmetry', D.symmetry, '%', { min: 0, max: 100 }),
    numParam('width', 'Pulse width', D.width, 's', { min: 0 }),
    numParam('edge', 'Edge time', D.edge, 's', { min: 0 }),
    numParam('phase', 'Phase', D.phase, '°'),
    selectParam('arb', 'Arbitrary shape', D.arb, [['sinc', 'Sinc'], ['exprise', 'Exponential rise'], ['expfall', 'Exponential fall'], ['gauss', 'Gaussian'], ['haversine', 'Haversine'], ['staircase', 'Staircase'], ['cardiac', 'Heartbeat'], ['user', 'User points']]),
    textParam('arbdata', 'Arbitrary points', D.arbdata, { help: 'One period, values −1 … 1' }),
    selectParam('mod', 'Modulation', D.mod, [['none', 'None'], ['am', 'AM'], ['fm', 'FM'], ['burst', 'Burst'], ['sweep', 'Sweep']]),
    numParam('modfreq', 'Modulation frequency', D.modfreq, 'Hz', { min: 0 }),
    numParam('depth', 'AM depth', D.depth, '%', { min: 0, max: 120 }),
    numParam('deviation', 'FM deviation', D.deviation, 'Hz', { min: 0 }),
    numParam('cycles', 'Burst cycles', D.cycles, '', { min: 1 }),
    numParam('burstperiod', 'Burst period', D.burstperiod, 's', { min: 0 }),
    numParam('sweepstop', 'Sweep stop frequency', D.sweepstop, 'Hz', { min: 0 }),
    numParam('sweeptime', 'Sweep time', D.sweeptime, 's', { min: 0 }),
    selectParam('load', 'Load setting', D.load, [['hiz', 'High-Z'], ['50', '50 Ω']]),
    numParam('zout', 'Output resistance', D.zout, 'Ω', { group: 'advanced', min: 0 }),
    selectParam('output', 'Output', D.output, [['on', 'On'], ['off', 'Off']]),
  ],
  groundWhenOpen: ['COM'],
  optionalPins: ['OUT', 'SYNC'],
  toSpice: (ctx) => {
    const s = benchGenSettings(ctx.params);
    const com = ctx.node('COM');
    const els: ElementIR[] = [];
    if (pinConnected(ctx, 'OUT')) {
      const out = ctx.node('OUT');
      if (!s.output) els.push(elR(ctx.name('R', 'off'), out, com, 1e9));
      else {
        const emf = s.zout > 0 ? internalNode(ctx, 'e') : out;
        const wave = benchWave(s);
        if (wave.kind === 'source') els.push(elV(ctx.name('V'), emf, com, wave.spec));
        else els.push(elB(ctx.name('B'), emf, com, 'V', wave.expr));
        if (s.zout > 0) els.push(elR(ctx.name('R', 'o'), emf, out, s.zout));
      }
    }
    if (pinConnected(ctx, 'SYNC')) {
      const T = 1 / s.freq;
      els.push(elV(ctx.name('V', 'sync'), ctx.node('SYNC'), com, { tran: { type: 'PULSE', args: [0, 5, 0, Math.min(10e-9, T / 100), Math.min(10e-9, T / 100), T / 2, T] } }));
    }
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'out', diff(ctx, 'OUT', 'COM'));
    put(ch, 'sync', diff(ctx, 'SYNC', 'COM'));
    return { channels: ch, drives: emittedSources(ctx) };
  },
  keywords: ['bench', 'function generator', 'arbitrary waveform generator', 'awg', 'signal generator', 'xag'],
};

// ---------------------------------------------------------------------------
// 6½-digit multimeter
// ---------------------------------------------------------------------------

export const BENCH_DMM_DEFAULTS: Record<string, string> = {
  function: 'dcv',
  range: 'auto',
  rate: 'medium',
  digits: '6.5',
  math: 'none',
  nullvalue: '0',
  dbref: '1',
  dbmref: '600',
  limitlow: '-1',
  limithigh: '1',
  zin: '10M',
  burden: '0.1',
  itest: '1m',
};

const benchMultimeter: LibraryPartDef = {
  id: 'instruments/bench-multimeter',
  name: 'Bench Multimeter 6½ digit',
  group: 'instruments',
  family: 'Instrument',
  description: '6½-digit bench multimeter: DC / AC volts, DC / AC current (separate I terminal), resistance, frequency, period, continuity and diode test, with null, dB, dBm, limit test and statistics',
  prefix: 'XDM',
  instrument: 'bench-multimeter',
  virtual: true,
  symbol: instrumentBox('DMM', [{ name: 'HI', number: '1' }, { name: 'LO', number: '2' }, { name: 'I', number: '3' }], { w: 100 }),
  params: [
    selectParam('function', 'Function', BENCH_DMM_DEFAULTS.function, [['dcv', 'DC V'], ['acv', 'AC V'], ['dci', 'DC I'], ['aci', 'AC I'], ['ohm', 'Ω'], ['freq', 'Frequency'], ['period', 'Period'], ['cont', 'Continuity'], ['diode', 'Diode']], { showOnSchematic: true }),
    disp(textParam('range', 'Range', BENCH_DMM_DEFAULTS.range, { help: 'auto or a full-scale value' })),
    disp(selectParam('rate', 'Reading rate', BENCH_DMM_DEFAULTS.rate, [['fast', 'Fast'], ['medium', 'Medium'], ['slow', 'Slow']])),
    disp(selectParam('digits', 'Digits', BENCH_DMM_DEFAULTS.digits, [['4.5', '4½'], ['5.5', '5½'], ['6.5', '6½']])),
    disp(selectParam('math', 'Math', BENCH_DMM_DEFAULTS.math, [['none', 'Off'], ['null', 'Null'], ['db', 'dB'], ['dbm', 'dBm'], ['stats', 'Statistics'], ['limit', 'Limit test']])),
    disp(numParam('nullvalue', 'Null value', BENCH_DMM_DEFAULTS.nullvalue, '')),
    disp(numParam('dbref', 'dB reference', BENCH_DMM_DEFAULTS.dbref, 'V', { min: 0 })),
    disp(numParam('dbmref', 'dBm reference resistance', BENCH_DMM_DEFAULTS.dbmref, 'Ω', { min: 0 })),
    disp(numParam('limitlow', 'Lower limit', BENCH_DMM_DEFAULTS.limitlow, '')),
    disp(numParam('limithigh', 'Upper limit', BENCH_DMM_DEFAULTS.limithigh, '')),
    selectParam('zin', 'Input resistance', BENCH_DMM_DEFAULTS.zin, [['10M', '10 MΩ'], ['10G', '> 10 GΩ']]),
    numParam('burden', 'Current shunt (burden)', BENCH_DMM_DEFAULTS.burden, 'Ω', { group: 'advanced', min: 0 }),
    numParam('itest', 'Ohms test current', BENCH_DMM_DEFAULTS.itest, 'A', { group: 'advanced', min: 0 }),
  ],
  groundWhenOpen: ['LO'],
  optionalPins: ['HI', 'I'],
  toSpice: (ctx) => {
    const fn = (ctx.params.function ?? 'dcv').trim().toLowerCase();
    const lo = ctx.node('LO');
    const els: ElementIR[] = [];
    if (pinConnected(ctx, 'HI')) {
      const hi = ctx.node('HI');
      const zin = ctx.num('zin');
      if (!(zin > 0)) throw new Error('bad value for zin: must be > 0');
      els.push(elR(ctx.name('R', 'in'), hi, lo, zin));
      if (fn === 'ohm' || fn === 'cont' || fn === 'diode') {
        const it = ctx.num('itest');
        if (!(it > 0)) throw new Error('bad value for itest: must be > 0');
        els.push(elI(ctx.name('I'), lo, hi, { dc: it }));
      }
    }
    if (pinConnected(ctx, 'I')) {
      const burden = ctx.num('burden');
      if (!(burden >= 0)) throw new Error('bad value for burden: must be ≥ 0');
      if (burden > 0) {
        const m = internalNode(ctx, 'i');
        els.push(elSense(ctx.name('V', 'i'), ctx.node('I'), m), elR(ctx.name('R', 'sh'), m, lo, burden));
      } else els.push(elSense(ctx.name('V', 'i'), ctx.node('I'), lo));
    }
    return { elements: els };
  },
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'v', diff(ctx, 'HI', 'LO'));
    if (ctx.elements.some((e) => e.name === ctx.name('V', 'i'))) ch.i = { kind: 'current', element: ctx.name('V', 'i') };
    const fn = (ctx.params.function ?? 'dcv').trim().toLowerCase();
    return { channels: ch, drives: fn === 'ohm' || fn === 'cont' || fn === 'diode' ? [ctx.name('I')] : [] };
  },
  keywords: ['bench multimeter', 'dmm', '6.5 digit', 'voltmeter', 'ammeter', 'ohmmeter', 'xdm'],
};

// ---------------------------------------------------------------------------
// Digital storage oscilloscope (4 channels) and mixed-signal oscilloscope
// ---------------------------------------------------------------------------

/** Front-panel params of the bench scopes (display group); channel keys A..D are CH1..CH4. */
export function benchScopeParams(channels: string[], digital: boolean): ParamDef[] {
  const out: ParamDef[] = [
    disp(numParam('timebase', 'Timebase', '1m', 's/div', { min: 0 })),
    disp(numParam('xpos', 'Horizontal position', '0', 'div')),
    disp(selectParam('display', 'Display', 'yt', [['yt', 'Y-T'], ['xy', 'X-Y']])),
  ];
  channels.forEach((c, i) => {
    const n = i + 1;
    out.push(
      disp(selectParam(`${c}.on`, `Channel ${n} on`, i < 2 ? 'on' : 'off', [['on', 'On'], ['off', 'Off']])),
      disp(numParam(`${c}.scale`, `Channel ${n} scale`, '1', 'V/div', { min: 0 })),
      disp(numParam(`${c}.pos`, `Channel ${n} position`, '0', 'div')),
      disp(selectParam(`${c}.coupling`, `Channel ${n} coupling`, 'dc', [['ac', 'AC'], ['dc', 'DC'], ['gnd', 'GND']])),
    );
  });
  const trigSources: [string, string][] = [...channels.map((c, i) => [c, `CH${i + 1}`] as [string, string]), ['ext', 'EXT']];
  if (digital) for (let k = 0; k < 16; k++) trigSources.push([`d${k}`, `D${k}`]);
  out.push(
    disp(selectParam('trig.source', 'Trigger source', 'A', trigSources)),
    disp(numParam('trig.level', 'Trigger level', '0', 'V')),
    disp(selectParam('trig.edge', 'Trigger slope', 'rising', [['rising', 'Rising'], ['falling', 'Falling']])),
    disp(selectParam('trig.mode', 'Trigger mode', 'auto', [['auto', 'Auto'], ['normal', 'Normal'], ['single', 'Single']])),
    disp(selectParam('run', 'Acquisition', 'run', [['run', 'Run'], ['stop', 'Stop']])),
    disp(selectParam('math.op', 'Math', 'off', [['off', 'Off'], ['add', 'A + B'], ['sub', 'A − B'], ['mul', 'A × B'], ['fft', 'FFT']])),
    disp(selectParam('math.a', 'Math source 1', 'A', channels.map((c, i) => [c, `CH${i + 1}`] as [string, string]))),
    disp(selectParam('math.b', 'Math source 2', 'B', channels.map((c, i) => [c, `CH${i + 1}`] as [string, string]))),
    disp(selectParam('fft.window', 'FFT window', 'hann', [['hann', 'Hann'], ['rect', 'Rectangular'], ['flattop', 'Flat top']])),
    disp(textParam('meas', 'Measurements', 'freq:A,vpp:A,vrms:A,freq:B,vpp:B', { help: 'type:channel list' })),
    disp(numParam('t1', 'Cursor 1', '2', 'div')),
    disp(numParam('t2', 'Cursor 2', '7', 'div')),
  );
  if (digital) {
    out.push(
      disp(selectParam('dig.on', 'Logic channels', 'on', [['on', 'On'], ['off', 'Off']])),
      disp(numParam('dig.threshold', 'Logic threshold', '1.4', 'V')),
      disp(selectParam('dig.bus', 'Bus display', 'hex', [['off', 'Off'], ['hex', 'Hex'], ['bin', 'Binary']])),
    );
  }
  return out;
}

const SCOPE_CH = ['A', 'B', 'C', 'D'];

const benchScope: LibraryPartDef = {
  id: 'instruments/bench-scope',
  name: 'Digital Storage Oscilloscope (4 channels)',
  group: 'instruments',
  family: 'Instrument',
  description: '4-channel digital storage oscilloscope with automatic measurements, cursors, math (A + B, A − B, A × B), FFT, auto setup and run / stop / single; inputs against the GND terminal',
  prefix: 'XDS',
  instrument: 'bench-scope',
  virtual: true,
  symbol: instrumentBox('DSO', [
    { name: 'CH1', label: '1', number: '1' },
    { name: 'CH2', label: '2', number: '2' },
    { name: 'CH3', label: '3', number: '3' },
    { name: 'CH4', label: '4', number: '4' },
    { name: 'EXT', label: 'T', number: '5' },
    { name: 'GND', label: '⏚', number: '6' },
  ], { w: 140 }),
  params: benchScopeParams(SCOPE_CH, false),
  groundWhenOpen: ['GND'],
  optionalPins: ['CH1', 'CH2', 'CH3', 'CH4', 'EXT'],
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    SCOPE_CH.forEach((c, i) => put(ch, c, diff(ctx, `CH${i + 1}`, 'GND')));
    put(ch, 'ext', diff(ctx, 'EXT', 'GND'));
    return { channels: ch, drives: [] };
  },
  keywords: ['oscilloscope', 'dso', 'digital storage', 'fft', 'bench', 'xds'],
};

const D_PINS = Array.from({ length: 16 }, (_, i) => `D${i}`);

const mixedSignalScope: LibraryPartDef = {
  id: 'instruments/mixed-signal-scope',
  name: 'Mixed-Signal Oscilloscope',
  group: 'instruments',
  family: 'Instrument',
  description: 'Mixed-signal oscilloscope: 2 analog channels and 16 logic channels D0..D15 on one time base, triggering on analog or logic edges, bus value display',
  prefix: 'XMS',
  instrument: 'mixed-signal-scope',
  virtual: true,
  symbol: columnSymbol('MSO', 'left', D_PINS, D_PINS.map((_, i) => i.toString(16).toUpperCase()), ['CH1', 'CH2', 'EXT', 'GND'], 80),
  params: benchScopeParams(['A', 'B'], true),
  groundWhenOpen: ['GND'],
  optionalPins: [...D_PINS, 'CH1', 'CH2', 'EXT'],
  bindInstrument: (ctx) => {
    const ch: Record<string, SignalRef> = {};
    put(ch, 'A', diff(ctx, 'CH1', 'GND'));
    put(ch, 'B', diff(ctx, 'CH2', 'GND'));
    put(ch, 'ext', diff(ctx, 'EXT', 'GND'));
    D_PINS.forEach((p, k) => put(ch, `d${k}`, diff(ctx, p, 'GND')));
    return { channels: ch, drives: [] };
  },
  keywords: ['mixed signal oscilloscope', 'mso', 'logic', 'oscilloscope', 'bench', 'xms'],
};

export const BENCH_INSTRUMENT_PARTS: LibraryPartDef[] = [benchGenerator, benchMultimeter, benchScope, mixedSignalScope];
