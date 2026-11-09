/**
 * Indicators group: voltmeter, ammeter, lamp, probe lights and buzzer.
 *
 * Every indicator declares `indicator.kind` (contract) and implements `bindIndicator`, which
 * returns the simulation signal the schematic display reads (see NetlistBuildEx.indicators in
 * src/model/netlister.ts):
 *   voltmeter  V(+,-) across its internal resistance            (params: mode dc|ac)
 *   ammeter    I(V_<refdes>) of its 0 V sense source, + -> -    (params: mode dc|ac)
 *   lamp       V(1,2); power = V² / R with R = Vrated² / Prated
 *   probe      V(pin) vs ground; lights when above `threshold`
 *   buzzer     V(+,-); sounds when above `von`
 * (The 7-segment / bar-graph displays belong to the digital catalogue.)
 */

import { elR, elSense, internalNode, numParam, selectParam, type InstrumentBindContext, type LibraryPartDef } from '../partkit';
import { arc, circle, line, makeSymbol, meterSymbol, pin, text, twoPinH } from '../symbols';
import type { SignalRef } from '../../model/types';

function across(ctx: InstrumentBindContext, a: string, b: string): SignalRef | null {
  const pa = ctx.net(a);
  const pb = ctx.net(b);
  if (pa === null && pb === null) return null;
  return { kind: 'voltage', pos: pa ?? '0', neg: pb ?? '0' };
}

const modeParam = () => selectParam('mode', 'Mode', 'dc', [['dc', 'DC'], ['ac', 'AC (RMS)']], { showOnSchematic: true });

const voltmeter: LibraryPartDef = {
  id: 'indicators/voltmeter',
  name: 'Voltmeter',
  group: 'indicators',
  family: 'Meter',
  description: 'Panel voltmeter reading V(+,-) (DC average or AC RMS) with a finite internal resistance',
  prefix: 'U',
  virtual: true,
  symbol: meterSymbol('V'),
  params: [modeParam(), numParam('resistance', 'Internal resistance', '10M', 'Ω', { min: 0 })],
  indicator: { kind: 'voltmeter', signal: 'voltage' },
  toSpice: (ctx) => {
    const r = ctx.num('resistance');
    if (!(r > 0)) throw new Error('bad value for resistance: must be > 0');
    return { elements: [elR(ctx.name('R'), ctx.node('+'), ctx.node('-'), r)] };
  },
  bindIndicator: (ctx) => {
    const s = across(ctx, '+', '-');
    return s ? { signal: s } : null;
  },
  keywords: ['voltmeter', 'meter', 'voltage'],
};

const ammeter: LibraryPartDef = {
  id: 'indicators/ammeter',
  name: 'Ammeter',
  group: 'indicators',
  family: 'Meter',
  description: 'Panel ammeter: 0 V sense source in series, reads the current flowing + -> - (DC average or AC RMS)',
  prefix: 'U',
  virtual: true,
  symbol: meterSymbol('A'),
  params: [modeParam(), numParam('resistance', 'Internal resistance', '0', 'Ω', { min: 0, help: '0 = ideal' })],
  indicator: { kind: 'ammeter', signal: 'current' },
  toSpice: (ctx) => {
    const r = ctx.num('resistance');
    if (r < 0) throw new Error('bad value for resistance: must be >= 0');
    if (r === 0) return { elements: [elSense(ctx.name('V'), ctx.node('+'), ctx.node('-'))] };
    const mid = internalNode(ctx, 'm');
    return { elements: [elSense(ctx.name('V'), ctx.node('+'), mid), elR(ctx.name('R'), mid, ctx.node('-'), r)] };
  },
  bindIndicator: (ctx) => ({ signal: { kind: 'current', element: ctx.name('V') } }),
  keywords: ['ammeter', 'meter', 'current'],
};

const lamp: LibraryPartDef = {
  id: 'indicators/lamp',
  name: 'Lamp',
  group: 'indicators',
  family: 'Lamp',
  description: 'Incandescent lamp at its hot resistance R = Vrated² / Prated; glows with the dissipated power',
  prefix: 'X',
  symbol: twoPinH([circle(0, 0, 12), line(-8.5, -8.5, 8.5, 8.5), line(-8.5, 8.5, 8.5, -8.5), line(-20, 0, -12, 0), line(12, 0, 20, 0)]),
  params: [
    numParam('vrated', 'Rated voltage', '12', 'V', { showOnSchematic: true, min: 0 }),
    numParam('prated', 'Rated power', '10', 'W', { showOnSchematic: true, min: 0 }),
  ],
  indicator: { kind: 'lamp', signal: 'voltage' },
  toSpice: (ctx) => {
    const v = ctx.num('vrated');
    const p = ctx.num('prated');
    if (!(v > 0 && p > 0)) throw new Error('bad value for vrated/prated: must be > 0');
    return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), (v * v) / p)] };
  },
  bindIndicator: (ctx) => {
    const s = across(ctx, '1', '2');
    return s ? { signal: s } : null;
  },
  footprint: 'LAMP-2P',
  keywords: ['lamp', 'bulb', 'light'],
};

const PROBE_COLORS: [string, string, string][] = [
  ['red', 'Red', '#e53935'],
  ['green', 'Green', '#43a047'],
  ['blue', 'Blue', '#1e88e5'],
  ['yellow', 'Yellow', '#fdd835'],
];

const probes: LibraryPartDef[] = PROBE_COLORS.map(([slug, label, css]) => ({
  id: `indicators/probe-${slug}`,
  name: `Probe Light ${label}`,
  group: 'indicators',
  family: 'Probe light',
  description: `Single-terminal logic probe lamp (${label.toLowerCase()}): lights when the pin voltage exceeds the threshold`,
  prefix: 'X',
  virtual: true,
  symbol: makeSymbol(
    [line(0, 0, 0, 10), circle(0, 20, 10, css), line(-7, 13, 7, 27), line(-7, 27, 7, 13)],
    [pin('1', 0, 0, 'up', { type: 'input' })],
    { refPos: { x: 16, y: 16 }, valuePos: { x: 16, y: 28 } },
  ),
  params: [numParam('threshold', 'Threshold voltage', '2.5', 'V', { showOnSchematic: true }), selectParam('color', 'Colour', slug, PROBE_COLORS.map(([s, l]) => [s, l] as [string, string]), { group: 'display' })],
  indicator: { kind: 'probe', signal: 'voltage' },
  toSpice: (ctx) => ({ elements: [elR(ctx.name('R'), ctx.node('1'), '0', 1e9)] }),
  bindIndicator: (ctx) => {
    const n = ctx.net('1');
    return n === null ? null : { signal: { kind: 'voltage', pos: n, neg: '0' } };
  },
  keywords: ['probe', 'logic probe', 'indicator', slug],
}));

const buzzer: LibraryPartDef = {
  id: 'indicators/buzzer',
  name: 'Buzzer',
  group: 'indicators',
  family: 'Buzzer',
  description: 'Active buzzer: resistive load R = Vrated / Irated that sounds when V(+,-) exceeds Von',
  prefix: 'LS',
  symbol: twoPinH([arc(0, 6, 12, 180, 360), line(-12, 6, 12, 6), line(-20, 0, -12, 0), line(12, 0, 20, 0), text(0, 2, '♪', 9)], { names: ['+', '-'], labels: ['+', undefined] }),
  params: [
    numParam('vrated', 'Rated voltage', '5', 'V', { min: 0 }),
    numParam('irated', 'Rated current', '30m', 'A', { min: 0 }),
    numParam('von', 'Sound threshold', '1.5', 'V'),
    numParam('freq', 'Tone frequency', '2.4k', 'Hz', { group: 'display', min: 0 }),
  ],
  indicator: { kind: 'buzzer', signal: 'voltage' },
  toSpice: (ctx) => {
    const v = ctx.num('vrated');
    const i = ctx.num('irated');
    if (!(v > 0 && i > 0)) throw new Error('bad value for vrated/irated: must be > 0');
    return { elements: [elR(ctx.name('R'), ctx.node('+'), ctx.node('-'), v / i)] };
  },
  bindIndicator: (ctx) => {
    const s = across(ctx, '+', '-');
    return s ? { signal: s } : null;
  },
  footprint: 'BUZZER-12MM',
  keywords: ['buzzer', 'beeper', 'sounder', 'alarm'],
};

export const INDICATOR_PARTS: LibraryPartDef[] = [voltmeter, ammeter, lamp, ...probes, buzzer];
