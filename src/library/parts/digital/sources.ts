/**
 * Digital sources (group 'sources'): digital clock, logic constants and the interactive logic
 * switch. Each has a single output pin OUT referenced to ground (implicit, drawn as a ground
 * glyph).
 *
 *   sources/digital-clock   D_OSC code model: freq, duty (% of the period between 50 % points),
 *                           delay (first rising edge), vhigh, edge (0-100 % rise / fall time).
 *                           freq / duty / delay are instance parameters of the element, so the
 *                           interactive simulator changes them in place (setParam).
 *   sources/logic-high      ideal DC source at vhigh;  sources/logic-low: 0 V.
 *   sources/logic-switch    ideal DC source toggled between 0 V and vhigh by its key
 *                           (param 'state', InteractiveDef toggle; default key Space).
 */
import { boolParam, elV, keyParam, numParam, parseBool, type LibraryPartDef } from '../../partkit';
import { circle, line, makeSymbol, pin, poly, rect, sourceGlyph, text } from '../../symbols';
import type { SymbolDef, SymbolPrim } from '../../types';
import { aElement, familyModel, idealLevels } from './kit';

/** Single-output source symbol: body around the origin, OUT pin at (40, 0), ground glyph below. */
function outSymbol(body: SymbolPrim[]): SymbolDef {
  const prims: SymbolPrim[] = [
    ...body,
    line(20, 0, 40, 0),
    line(0, 15, 0, 24),
    line(-8, 24, 8, 24),
    line(-5, 27, 5, 27),
    line(-2, 30, 2, 30),
  ];
  return makeSymbol(prims, [pin('OUT', 40, 0, 'right', { type: 'output' })], { refPos: { x: 0, y: -22 }, valuePos: { x: 26, y: 16 } });
}

const clockSymbol = outSymbol([line(15, 0, 20, 0), circle(0, 0, 15), ...sourceGlyph('clock')]);

const digitalClock: LibraryPartDef = {
  id: 'sources/digital-clock',
  name: 'Digital clock',
  group: 'sources',
  family: 'Digital sources',
  description: 'Logic clock 0 / vhigh with a set frequency and duty cycle (first rising edge after `delay`)',
  prefix: 'V',
  virtual: true,
  symbol: clockSymbol,
  params: [
    numParam('freq', 'Frequency', '1k', 'Hz', { min: 1e-9, showOnSchematic: true }),
    numParam('duty', 'Duty cycle', '50', '%', { min: 0.1, max: 99.9 }),
    numParam('vhigh', 'High level', '5', 'V', { min: 0.1, showOnSchematic: true }),
    numParam('delay', 'Delay to first edge', '0', 's', { min: 0, group: 'advanced' }),
    numParam('edge', 'Rise / fall time', '1n', 's', { min: 1e-12, group: 'advanced' }),
  ],
  toSpice: (ctx) => {
    const vhigh = ctx.num('vhigh');
    const lv = { ...idealLevels(vhigh, 0, vhigh / 2, 1), tr: ctx.num('edge'), tf: ctx.num('edge') };
    const m = familyModel('MS_DIGCLOCK', 'D_OSC', lv);
    const freq = ctx.num('freq');
    const duty = ctx.num('duty') / 100;
    if (!(freq > 0)) throw new Error('bad value for freq: must be > 0');
    if (!(duty > 0 && duty < 1)) throw new Error('bad value for duty: must be between 0 and 100 %');
    return {
      elements: [aElement(ctx.name('A'), [ctx.node('OUT')], { nodes: ['0'], pwr: 1 }, m.name, { freq, duty, td: ctx.num('delay') })],
      models: [m],
    };
  },
  keywords: ['clock', 'digital clock', 'square wave', 'oscillator', 'logic'],
};

function constant(high: boolean): LibraryPartDef {
  const body: SymbolPrim[] = [rect(-15, -12, 30, 24), text(0, 5, high ? '1' : '0', 12, 'middle', true), line(15, 0, 20, 0), line(0, 12, 0, 15)];
  return {
    id: `sources/logic-${high ? 'high' : 'low'}`,
    name: `Logic ${high ? 'high (1)' : 'low (0)'}`,
    group: 'sources',
    family: 'Digital sources',
    description: high ? 'Ideal logic 1: DC source at vhigh' : 'Ideal logic 0: DC source at 0 V',
    prefix: 'V',
    virtual: true,
    symbol: outSymbol(body),
    params: high ? [numParam('vhigh', 'High level', '5', 'V', { min: 0, showOnSchematic: true })] : [],
    toSpice: (ctx) => ({ elements: [elV(ctx.name('V'), ctx.node('OUT'), '0', { dc: high ? ctx.num('vhigh') : 0 })] }),
    keywords: ['logic constant', high ? 'high' : 'low', high ? 'vcc' : 'gnd', high ? '1' : '0'],
  };
}

const logicSwitch: LibraryPartDef = {
  id: 'sources/logic-switch',
  name: 'Interactive logic switch',
  group: 'sources',
  family: 'Digital sources',
  description: 'Logic level toggled by a key during simulation: 0 V (state off) or vhigh (state on)',
  prefix: 'S',
  virtual: true,
  symbol: outSymbol([rect(-15, -12, 30, 24, false, 3), poly([-9, 4, -2, 4, 6, -5]), circle(-9, 4, 1.5, true), circle(8, 4, 1.5, true), line(15, 0, 20, 0), line(0, 12, 0, 15)]),
  params: [
    boolParam('state', 'State (on = high)', false, { showOnSchematic: true }),
    numParam('vhigh', 'High level', '5', 'V', { min: 0 }),
    keyParam('Space'),
  ],
  interactive: { kind: 'toggle', param: 'state', label: 'Toggle', key: 'Space' },
  toSpice: (ctx) => ({ elements: [elV(ctx.name('V'), ctx.node('OUT'), '0', { dc: parseBool(ctx.params.state) ? ctx.num('vhigh') : 0 })] }),
  keywords: ['logic switch', 'interactive', 'toggle', 'digital input', 'key'],
};

export const DIGITAL_SOURCE_PARTS: LibraryPartDef[] = [digitalClock, constant(true), constant(false), logicSwitch];
