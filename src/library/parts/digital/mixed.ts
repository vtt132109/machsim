/**
 * Mixed group: converters between the analog and the digital domain (ideal 0 / vhigh logic
 * referenced to ground, code models from src/sim/devices/digital/mixed.ts).
 *
 *   mixed/adc8               8-bit ADC: VIN, VREF+, VREF-, SOC, OE -> D0..D7, EOC.
 *                            code = floor(256 (VIN - VREF-) / (VREF+ - VREF-)), clamped. A rising
 *                            SOC starts a conversion (EOC low for tconv); an unconnected SOC
 *                            converts continuously. OE (active high, open = enabled) tri-states D.
 *   mixed/dac8               8-bit voltage DAC: VOUT = VREF- + code/256 (VREF+ - VREF-), settling
 *                            ramp `tsettle`, output resistance `rout`.
 *   mixed/comparator-logic   analog comparator with a logic output (hysteresis vhys around
 *                            voffset, delay `delay`).
 */
import { numParam, type LibraryPartDef } from '../../partkit';
import { ampSymbol, line, poly } from '../../symbols';
import type { ParamDef, ToSpiceContext } from '../../types';
import { aElement, familyModel, icSymbol, idealLevels, inp, optionalNode, out, type PowerNodes } from './kit';

const GROUND_REF: PowerNodes = { nodes: ['0'], pwr: 1 };
const BITS = Array.from({ length: 8 }, (_, k) => `D${k}`);

const vhighParam = (): ParamDef => numParam('vhigh', 'Logic high level', '5', 'V', { min: 0.1, group: 'model' });
const thresholdParam = (): ParamDef => numParam('threshold', 'Logic input threshold', '2.5', 'V', { group: 'model' });

function logic(ctx: ToSpiceContext, delay: number) {
  const vhigh = ctx.num('vhigh');
  if (!(vhigh > 0)) throw new Error('bad value for vhigh: must be > 0');
  const threshold = ctx.params.threshold !== undefined ? ctx.num('threshold') : vhigh / 2;
  return idealLevels(vhigh, delay, threshold);
}

const adc8: LibraryPartDef = {
  id: 'mixed/adc8',
  name: 'ADC 8-bit',
  group: 'mixed',
  family: 'Converters',
  description: 'Ideal 8-bit analog-to-digital converter with start / end of conversion and 3-state outputs',
  prefix: 'U',
  symbol: icSymbol('ADC', [{ name: 'VIN', type: 'passive' }, { name: 'VREFP', label: 'VREF+', type: 'passive' }, { name: 'VREFN', label: 'VREF-', type: 'passive' }, null, inp('SOC'), inp('OE')], [...BITS.map((b) => out(b)), null, out('EOC')]),
  params: [numParam('tconv', 'Conversion time', '1u', 's', { min: 0, showOnSchematic: true }), vhighParam(), thresholdParam()],
  optionalPins: ['SOC', 'OE', 'EOC', ...BITS],
  toSpice: (ctx) => {
    const m = familyModel('MS_ADC8', 'D_ADC', logic(ctx, 10e-9), 1, { tconv: ctx.num('tconv') });
    const ports = [ctx.node('VIN'), ctx.node('VREFP'), ctx.node('VREFN'), optionalNode(ctx, 'SOC'), optionalNode(ctx, 'OE'), ctx.node('EOC'), ...BITS.map((b) => ctx.node(b))];
    return { elements: [aElement(ctx.name('A'), ports, GROUND_REF, m.name)], models: [m] };
  },
  keywords: ['adc', 'analog to digital', 'converter', 'mixed'],
  provenance: 'MachSim ideal converter code model (D_ADC): truncating 8-bit quantiser, no INL / DNL, configurable conversion time',
};

const dac8: LibraryPartDef = {
  id: 'mixed/dac8',
  name: 'DAC 8-bit',
  group: 'mixed',
  family: 'Converters',
  description: 'Ideal 8-bit voltage-output digital-to-analog converter',
  prefix: 'U',
  symbol: icSymbol('DAC', [...BITS.map((b) => inp(b)), null, { name: 'VREFP', label: 'VREF+', type: 'passive' }, { name: 'VREFN', label: 'VREF-', type: 'passive' }], [null, null, null, null, { name: 'VOUT', type: 'output' }]),
  params: [
    numParam('tsettle', 'Full-scale settling time', '100n', 's', { min: 1e-12, showOnSchematic: true }),
    numParam('rout', 'Output resistance', '1', 'Ω', { min: 1e-6 }),
    thresholdParam(),
  ],
  toSpice: (ctx) => {
    const lv = idealLevels(5, 0, ctx.num('threshold'));
    const m = familyModel('MS_DAC8', 'D_DAC', lv, 1, { tsettle: ctx.num('tsettle'), rout: ctx.num('rout'), tpd: 10e-9 });
    const ports = [...BITS.map((b) => ctx.node(b)), ctx.node('VREFP'), ctx.node('VREFN'), ctx.node('VOUT')];
    return { elements: [aElement(ctx.name('A'), ports, GROUND_REF, m.name)], models: [m] };
  },
  keywords: ['dac', 'digital to analog', 'converter', 'mixed'],
  provenance: 'MachSim ideal converter code model (D_DAC): exact binary weights, linear settling ramp',
};

const comparatorLogic: LibraryPartDef = {
  id: 'mixed/comparator-logic',
  name: 'Comparator (logic output)',
  group: 'mixed',
  family: 'Comparators',
  description: 'Analog comparator whose output is a logic signal: high when V(IN+) - V(IN-) exceeds voffset (with hysteresis vhys)',
  prefix: 'U',
  symbol: ampSymbol({ plusOnTop: true, extra: [poly([-4, 6, 2, 6, 2, -2, 8, -2]), line(-2, -6, 8, -6)] }),
  params: [
    numParam('vhys', 'Hysteresis', '10m', 'V', { min: 0 }),
    numParam('voffset', 'Input offset', '0', 'V', { group: 'model' }),
    numParam('delay', 'Response time', '100n', 's', { min: 0, group: 'model' }),
    vhighParam(),
  ],
  toSpice: (ctx) => {
    const m = familyModel('MS_CMPLOGIC', 'D_COMPARATOR', logic(ctx, ctx.num('delay')), 1, { vhys: ctx.num('vhys'), voffset: ctx.num('voffset') });
    return { elements: [aElement(ctx.name('A'), [ctx.node('IN+'), ctx.node('IN-'), ctx.node('OUT')], GROUND_REF, m.name)], models: [m] };
  },
  keywords: ['comparator', 'analog to logic', 'mixed', 'threshold'],
  provenance: 'MachSim code model (D_COMPARATOR): ideal threshold with hysteresis and a fixed response time',
};

export const MIXED_PARTS: LibraryPartDef[] = [adc8, dac8, comparatorLogic];
