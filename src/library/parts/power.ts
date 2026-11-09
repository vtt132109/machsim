/**
 * Power group: linear voltage regulators and a fuse.
 *
 * Regulators are behavioral subcircuits (MachSim originals) parameterised from datasheet
 * typical values:
 *   output     V(OUT) set by the reference (fixed or ADJ + VREF), never closer than the dropout
 *              voltage VDO to the input; output resistance ROUT
 *   limit      output current limited to ILIM (the internal source voltage is clamped to
 *              V(out) ± ILIM·ROUT)
 *   supply     the load current is drawn from IN (mirror source), plus the quiescent current
 *              (fixed types) or the 50 µA ADJ current (adjustable types)
 * Not modelled: line / load regulation errors, ripple rejection limits, thermal shutdown.
 *
 * Fuse: a 0 V sense source, a behavioral |I| monitor and a latching SPICE switch. The fuse opens
 * as soon as |I| exceeds the rating (no I²t integration) and stays open until the simulation is
 * restarted.
 */

import type { ElementIR, SubcktDef } from '../../sim/netlist';
import { elB, elR, elS, elSense, elX, ex, internalNode, numParam, paramModelName, subckt, swModel, type LibraryPartDef } from '../partkit';
import { boxSymbol, line, rect, twoPinH } from '../symbols';

export interface RegSpec {
  pn: string;
  kind: 'pos' | 'neg' | 'adj' | 'adjneg';
  /** output voltage magnitude (fixed) or reference voltage (adjustable) */
  v: number;
  vdo: number;
  ilim: number;
  iq: number;
  rout: number;
  description: string;
  footprint: string;
}

/** Fixed positive regulator (ports in gnd out). */
export function posRegulator(name: string, s: RegSpec): SubcktDef {
  const lim = s.ilim * s.rout;
  return subckt(name, ['in', 'gnd', 'out'], [
    elB('BO', 'o1', 'gnd', 'V', `min(min(${ex(s.v)},max(V(in,gnd)-${ex(s.vdo)},0)),V(out,gnd)+${ex(lim)})`),
    elR('RO', 'o1', 'out', s.rout),
    elB('BI', 'in', 'gnd', 'I', `max(-I(BO),0)+${ex(s.iq)}*limit(V(in,gnd)/2,0,1)`),
  ]);
}

/** Fixed negative regulator (ports in gnd out); V(out,gnd) = -v. */
function negRegulator(name: string, s: RegSpec): SubcktDef {
  const lim = s.ilim * s.rout;
  return subckt(name, ['in', 'gnd', 'out'], [
    elB('BO', 'o1', 'gnd', 'V', `max(max(${ex(-s.v)},min(V(in,gnd)+${ex(s.vdo)},0)),V(out,gnd)-${ex(lim)})`),
    elR('RO', 'o1', 'out', s.rout),
    elB('BI', 'gnd', 'in', 'I', `max(I(BO),0)+${ex(s.iq)}*limit(-V(in,gnd)/2,0,1)`),
  ]);
}

/** Adjustable positive regulator (ports in adj out); V(out,adj) = v (1.25 V). */
function adjRegulator(name: string, s: RegSpec): SubcktDef {
  const lim = s.ilim * s.rout;
  return subckt(name, ['in', 'adj', 'out'], [
    elB('BO', 'o1', 'adj', 'V', `min(min(${ex(s.v)},V(in,adj)-${ex(s.vdo)}),V(out,adj)+${ex(lim)})`),
    elR('RO', 'o1', 'out', s.rout),
    elB('BI', 'in', 'adj', 'I', `max(-I(BO),0)+${ex(s.iq)}*limit(V(in,out)/2,0,1)`),
  ]);
}

/** Adjustable negative regulator (ports in adj out); V(out,adj) = -v. */
function adjNegRegulator(name: string, s: RegSpec): SubcktDef {
  const lim = s.ilim * s.rout;
  return subckt(name, ['in', 'adj', 'out'], [
    elB('BO', 'o1', 'adj', 'V', `max(max(${ex(-s.v)},V(in,adj)+${ex(s.vdo)}),V(out,adj)-${ex(lim)})`),
    elR('RO', 'o1', 'out', s.rout),
    elB('BI', 'adj', 'in', 'I', `max(I(BO),0)+${ex(s.iq)}*limit(V(out,in)/2,0,1)`),
  ]);
}

const REGULATORS: RegSpec[] = [
  { pn: '7805', kind: 'pos', v: 5, vdo: 2, ilim: 1.5, iq: 5e-3, rout: 0.02, description: '+5 V 1.5 A fixed linear regulator', footprint: 'TO-220' },
  { pn: '7809', kind: 'pos', v: 9, vdo: 2, ilim: 1.5, iq: 5e-3, rout: 0.02, description: '+9 V 1.5 A fixed linear regulator', footprint: 'TO-220' },
  { pn: '7812', kind: 'pos', v: 12, vdo: 2, ilim: 1.5, iq: 5e-3, rout: 0.02, description: '+12 V 1.5 A fixed linear regulator', footprint: 'TO-220' },
  { pn: '7815', kind: 'pos', v: 15, vdo: 2, ilim: 1.5, iq: 5e-3, rout: 0.02, description: '+15 V 1.5 A fixed linear regulator', footprint: 'TO-220' },
  { pn: '7905', kind: 'neg', v: 5, vdo: 1.1, ilim: 1.5, iq: 3e-3, rout: 0.02, description: '-5 V 1.5 A fixed linear regulator', footprint: 'TO-220' },
  { pn: '7912', kind: 'neg', v: 12, vdo: 1.1, ilim: 1.5, iq: 3e-3, rout: 0.02, description: '-12 V 1.5 A fixed linear regulator', footprint: 'TO-220' },
  { pn: '7915', kind: 'neg', v: 15, vdo: 1.1, ilim: 1.5, iq: 3e-3, rout: 0.02, description: '-15 V 1.5 A fixed linear regulator', footprint: 'TO-220' },
  { pn: 'LM317', kind: 'adj', v: 1.25, vdo: 1.7, ilim: 2.2, iq: 50e-6, rout: 0.01, description: 'Adjustable positive regulator: VOUT = 1.25 V·(1 + R2/R1) + IADJ·R2', footprint: 'TO-220' },
  { pn: 'LM337', kind: 'adjneg', v: 1.25, vdo: 1.7, ilim: 2.2, iq: 65e-6, rout: 0.01, description: 'Adjustable negative regulator: VOUT = -1.25 V·(1 + R2/R1)', footprint: 'TO-220' },
  { pn: 'LM1117-3.3', kind: 'pos', v: 3.3, vdo: 1.1, ilim: 1.2, iq: 5e-3, rout: 0.02, description: '+3.3 V 800 mA low-dropout regulator', footprint: 'SOT-223' },
];

export function regulatorPart(s: RegSpec): LibraryPartDef {
  const name = `MS_${s.pn.replace(/[^A-Za-z0-9]/g, '_')}`;
  const sub = s.kind === 'pos' ? posRegulator(name, s) : s.kind === 'neg' ? negRegulator(name, s) : s.kind === 'adj' ? adjRegulator(name, s) : adjNegRegulator(name, s);
  const adj = s.kind === 'adj' || s.kind === 'adjneg';
  const ref = adj ? 'ADJ' : 'GND';
  const vtext = s.kind === 'pos' ? `+${s.v} V` : s.kind === 'neg' ? `-${s.v} V` : s.kind === 'adj' ? 'VREF 1.25 V' : 'VREF -1.25 V';
  return {
    id: `power/${s.pn.toLowerCase()}`,
    name: s.pn,
    group: 'power',
    family: adj ? 'Adjustable regulator' : 'Fixed regulator',
    description: s.description,
    prefix: 'U',
    symbol: boxSymbol({
      w: 60,
      h: 40,
      left: [{ name: 'IN', number: s.kind === 'neg' ? '2' : adj ? '3' : '1', type: 'power' }],
      right: [{ name: 'OUT', number: s.kind === 'neg' ? '3' : adj ? '2' : '3', type: 'power' }],
      bottom: [{ name: ref, number: s.kind === 'neg' ? '1' : adj ? '1' : '2' }],
      title: s.pn,
      titleSize: 9,
      titlePos: { x: 0, y: -6 },
    }),
    params: [],
    toSpice: (ctx) => ({
      elements: [elX(ctx.name('X'), [ctx.node('IN'), ctx.node(ref), ctx.node('OUT')], sub.name)],
      subckts: [sub],
    }),
    provenance: `MachSim behavioral regulator from datasheet typicals: ${vtext}, dropout ${s.vdo} V, current limit ${s.ilim} A, ${adj ? 'ADJ current' : 'quiescent current'} ${s.iq * 1e3} mA`,
    footprint: s.footprint,
    keywords: [s.pn.toLowerCase(), 'regulator', 'voltage regulator', 'linear regulator', adj ? 'adjustable' : 'fixed', s.kind.includes('neg') ? 'negative' : 'positive'],
  };
}

const fuse: LibraryPartDef = {
  id: 'power/fuse',
  name: 'Fuse',
  group: 'power',
  family: 'Fuse',
  description: 'Fuse: conducts with its cold resistance until |I| exceeds the rating, then opens and stays open (instant, no I²t)',
  prefix: 'F',
  symbol: twoPinH([rect(-14, -5, 28, 10), line(-20, 0, 20, 0)]),
  params: [
    numParam('rating', 'Current rating', '1', 'A', { showOnSchematic: true, min: 0 }),
    numParam('r', 'Cold resistance', '10m', 'Ω', { group: 'advanced', min: 0 }),
  ],
  toSpice: (ctx) => {
    const rating = ctx.num('rating');
    const r = ctx.num('r');
    if (!(rating > 0)) throw new Error('bad value for rating: must be > 0');
    if (!(r > 0)) throw new Error('bad value for r: must be > 0');
    const name = paramModelName('MS_FUSE', { rating, r }, { rating: 1, r: 10e-3 });
    const sense = ctx.name('V', 'sense');
    const a = internalNode(ctx, 'a');
    const c = internalNode(ctx, 'ctl');
    // switch control V(0, c) = -|I|: off below -rating (|I| > rating), on above +1 A·V (never) -> latches open
    const sw: ElementIR = { ...elS(ctx.name('S'), a, ctx.node('2'), '0', c, name), params: { on: 1 } };
    return {
      elements: [elSense(sense, ctx.node('1'), a), elB(ctx.name('B'), c, '0', 'V', `abs(I(${sense}))`), sw],
      models: [swModel(name, (1 - rating) / 2, (1 + rating) / 2, r, 1e9)],
    };
  },
  provenance: 'MachSim latching fuse built from a SPICE SW switch with hysteresis',
  footprint: 'FUSE-5X20',
  keywords: ['fuse', 'protection', 'overcurrent'],
};

export const POWER_PARTS: LibraryPartDef[] = [...REGULATORS.map(regulatorPart), fuse];
