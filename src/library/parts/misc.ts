/**
 * Miscellaneous groups:
 *   misc               quartz crystals (Butterworth-Van Dyke RLC), optocouplers
 *   rf                 lossless transmission lines (SPICE T)
 *   electromechanical  DC motor (R-L-back-EMF with mechanical analogue), relays
 *   connectors         pin headers / terminal blocks (graphic-only, no simulation model)
 *
 * DC motor electrical analogue (all SI): armature RA, LA and back-EMF E = Kt·ω in series; the
 * torque Kt·i drives the internal node "<refdes>.w" whose VOLTAGE is the shaft speed ω in rad/s:
 * C = J (kg·m²), R = 1/B (viscous friction N·m·s), current source = load torque (N·m).
 *
 * Relay: coil RCOIL + LCOIL in series with a 0 V sense source; a behavioral node holds |Icoil|
 * and SPICE switches with hysteresis close the NO contact above the pull-in current and the NC
 * contact below the drop-out current (topology is constant, so it works interactively).
 */

import {
  card,
  defaultNums,
  elB,
  elC,
  elD,
  elE,
  elF,
  elI,
  elL,
  elQ,
  elR,
  elS,
  elSense,
  elT,
  internalNode,
  internalNodeName,
  numParam,
  paramModelName,
  swModel,
  type LibraryPartDef,
} from '../partkit';
import { arrow, boxSymbol, circle, line, makeSymbol, pin, poly, rect, text, twoPinH } from '../symbols';
import type { ElementIR, ModelCard } from '../../sim/netlist';
import type { ParamDef, SymbolPrim, ToSpiceContext } from '../types';
import { ledModel } from './diodes';

function positive(ctx: ToSpiceContext, key: string): number {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
}

// ---------------------------------------------------------------------------
// Crystals
// ---------------------------------------------------------------------------

function crystalParams(fs: string, c1: string, r1: string, c0: string): ParamDef[] {
  return [
    numParam('fs', 'Series resonance', fs, 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('c1', 'Motional capacitance', c1, 'F', { group: 'model', min: 0 }),
    numParam('r1', 'Motional resistance', r1, 'Ω', { group: 'model', min: 0 }),
    numParam('c0', 'Shunt capacitance', c0, 'F', { group: 'model', min: 0 }),
  ];
}

function crystal(slug: string, name: string, description: string, defs: ParamDef[], provenance: string): LibraryPartDef {
  return {
    id: `misc/${slug}`,
    name,
    group: 'misc',
    family: 'Crystal',
    description,
    prefix: 'Y',
    symbol: twoPinH([rect(-6, -10, 12, 20), line(-11, -12, -11, 12, 2), line(11, -12, 11, 12, 2), line(-20, 0, -11, 0), line(11, 0, 20, 0)]),
    params: defs,
    toSpice: (ctx) => {
      const fs = positive(ctx, 'fs');
      const c1 = positive(ctx, 'c1');
      const l1 = 1 / ((2 * Math.PI * fs) ** 2 * c1);
      const a = internalNode(ctx, 'a');
      const b = internalNode(ctx, 'b');
      return {
        elements: [
          elL(ctx.name('L'), ctx.node('1'), a, l1),
          elC(ctx.name('C', 'm'), a, b, c1),
          elR(ctx.name('R'), b, ctx.node('2'), positive(ctx, 'r1')),
          elC(ctx.name('C', 'p'), ctx.node('1'), ctx.node('2'), positive(ctx, 'c0')),
        ],
      };
    },
    provenance,
    footprint: slug === 'crystal-32k768' ? 'XTAL-TUNING-FORK' : 'HC-49',
    keywords: ['crystal', 'xtal', 'quartz', 'resonator', 'oscillator'],
  };
}

const crystals = [
  crystal('crystal', 'Crystal', 'Quartz crystal (Butterworth-Van Dyke: L1-C1-R1 in parallel with C0); L1 follows from fs and C1', crystalParams('4M', '15f', '25', '5p'), 'Typical AT-cut HC-49 values: C1 15 fF, R1 25 Ω, C0 5 pF'),
  crystal('crystal-32k768', 'Crystal 32.768 kHz', 'Watch (tuning-fork) crystal, 32.768 kHz', crystalParams('32.768k', '2f', '35k', '1.5p'), 'Typical tuning-fork watch crystal: C1 2 fF, R1 35 kΩ, C0 1.5 pF'),
  crystal('crystal-8m', 'Crystal 8 MHz', '8 MHz AT-cut crystal (HC-49)', crystalParams('8M', '20f', '30', '5p'), 'Typical AT-cut HC-49 values: C1 20 fF, R1 30 Ω, C0 5 pF'),
  crystal('crystal-16m', 'Crystal 16 MHz', '16 MHz AT-cut crystal (HC-49)', crystalParams('16M', '20f', '20', '6p'), 'Typical AT-cut HC-49 values: C1 20 fF, R1 20 Ω, C0 6 pF'),
];

// ---------------------------------------------------------------------------
// Optocouplers
// ---------------------------------------------------------------------------

const OPTO_LED = ledModel('MS_OPTO_LED', 1.2, 10e-3, 1.6, 1);
const OPTO_Q = card('MS_OPTO_Q', 'NPN', { is: 1e-14, bf: 300, vaf: 80, cje: 10e-12, cjc: 15e-12, tf: 2e-6, tr: 10e-6, rb: 10, rc: 10 });
const OPTO_BF = 300;

function optoSymbol() {
  const prims: SymbolPrim[] = [
    rect(-30, -30, 60, 60),
    // LED (vertical, anode top) on the left
    line(-40, -20, -15, -20),
    line(-15, -20, -15, -6),
    poly([-21, -6, -9, -6, -15, 4], true),
    line(-21, 4, -9, 4),
    line(-15, 4, -15, 20),
    line(-15, 20, -40, 20),
    ...arrow(-6, -4, 2, -4),
    ...arrow(-6, 4, 2, 4),
    // phototransistor on the right
    line(8, -10, 8, 10, 2),
    line(8, -4, 18, -14),
    line(18, -14, 18, -20),
    line(18, -20, 40, -20),
    line(8, 4, 18, 14),
    line(18, 14, 18, 20),
    line(18, 20, 40, 20),
  ];
  return makeSymbol(
    prims,
    [
      pin('A', -40, -20, 'left', { number: '1' }),
      pin('K', -40, 20, 'left', { number: '2' }),
      pin('C', 40, -20, 'right', { number: '5' }),
      pin('E', 40, 20, 'right', { number: '4' }),
    ],
    { refPos: { x: 0, y: -36 }, valuePos: { x: 0, y: 44 } },
  );
}

function optocoupler(slug: string, name: string, description: string, ctr: string, provenance: string): LibraryPartDef {
  return {
    id: `misc/${slug}`,
    name,
    group: 'misc',
    family: 'Optocoupler',
    description,
    prefix: 'U',
    symbol: optoSymbol(),
    params: [numParam('ctr', 'Current transfer ratio', ctr, '%', { showOnSchematic: true, min: 0 }), numParam('riso', 'Isolation resistance', '100G', 'Ω', { group: 'advanced', min: 0 })],
    toSpice: (ctx) => {
      const ctrv = ctx.num('ctr') / 100;
      if (!(ctrv >= 0)) throw new Error('bad value for ctr: must be >= 0');
      const a1 = internalNode(ctx, 'a');
      const b = internalNode(ctx, 'b');
      const sense = ctx.name('V', 'led');
      const els: ElementIR[] = [
        elSense(sense, ctx.node('A'), a1),
        elD(ctx.name('D'), a1, ctx.node('K'), OPTO_LED.name),
        elF(ctx.name('F'), ctx.node('E'), b, sense, ctrv / OPTO_BF),
        elQ(ctx.name('Q'), ctx.node('C'), b, ctx.node('E'), OPTO_Q.name),
        elR(ctx.name('R', 'be'), b, ctx.node('E'), 10e6),
      ];
      const riso = ctx.num('riso');
      if (riso > 0) els.push(elR(ctx.name('R', 'iso'), ctx.node('K'), ctx.node('E'), riso));
      return { elements: els, models: [OPTO_LED, OPTO_Q] };
    },
    provenance,
    footprint: 'DIP-6',
    keywords: ['optocoupler', 'optoisolator', 'opto', slug],
  };
}

const optocouplers = [
  optocoupler('optocoupler', 'Optocoupler', 'Generic LED-phototransistor optocoupler; IC ≈ CTR·IF in the active region', '100', 'MachSim behavioral optocoupler: IR LED (VF 1.2 V @ 10 mA) driving a phototransistor base current CTR·IF/βF'),
  optocoupler('4n25', '4N25', 'Phototransistor optocoupler, CTR ≥ 20 %', '50', 'MachSim behavioral optocoupler with the 4N25 datasheet typical CTR (50 %), VF 1.2 V @ 10 mA'),
  optocoupler('pc817', 'PC817', 'Phototransistor optocoupler, CTR 50-600 %', '100', 'MachSim behavioral optocoupler with CTR 100 % (PC817 rank range 50-600 %), VF 1.2 V @ 10 mA'),
];

// ---------------------------------------------------------------------------
// Transmission lines (rf)
// ---------------------------------------------------------------------------

export function tlineSymbol() {
  return makeSymbol(
    [
      line(-40, -10, -20, -10),
      line(-40, 10, -20, 10),
      line(20, -10, 40, -10),
      line(20, 10, 40, 10),
      line(-20, -8, 20, -8),
      line(-20, 8, 20, 8),
      { kind: 'arc', cx: -20, cy: 0, r: 8, start: 90, end: 270 },
      { kind: 'arc', cx: -20, cy: 0, r: 8, start: 270, end: 450 },
      { kind: 'arc', cx: 20, cy: 0, r: 8, start: 270, end: 450 },
      line(-20, -10, -20, -8),
      line(-20, 10, -20, 8),
      line(20, -10, 20, -8),
      line(20, 10, 20, 8),
    ],
    [
      pin('A+', -40, -10, 'left', { number: '1' }),
      pin('A-', -40, 10, 'left', { number: '2' }),
      pin('B+', 40, -10, 'right', { number: '3' }),
      pin('B-', 40, 10, 'right', { number: '4' }),
    ],
    { refPos: { x: 0, y: -16 }, valuePos: { x: 0, y: 24 } },
  );
}

const tline: LibraryPartDef = {
  id: 'rf/transmission-line',
  name: 'Lossless Transmission Line',
  group: 'rf',
  family: 'Transmission line',
  description: 'Ideal lossless transmission line with characteristic impedance Z0 and delay TD (SPICE T)',
  prefix: 'T',
  virtual: true,
  symbol: tlineSymbol(),
  params: [numParam('z0', 'Characteristic impedance', '50', 'Ω', { showOnSchematic: true, min: 0 }), numParam('td', 'Delay', '1n', 's', { showOnSchematic: true, min: 0 })],
  toSpice: (ctx) => ({ elements: [elT(ctx.name('T'), ctx.node('A+'), ctx.node('A-'), ctx.node('B+'), ctx.node('B-'), positive(ctx, 'z0'), positive(ctx, 'td'))] }),
  keywords: ['transmission line', 'tline', 'delay line', 'z0'],
};

const coax: LibraryPartDef = {
  ...tline,
  id: 'rf/coax',
  name: 'Coaxial Cable',
  family: 'Transmission line',
  description: 'Lossless coaxial cable given by length and velocity factor: TD = length / (VF·c)',
  virtual: false,
  params: [
    numParam('z0', 'Characteristic impedance', '50', 'Ω', { showOnSchematic: true, min: 0 }),
    numParam('length', 'Length', '1', 'm', { showOnSchematic: true, min: 0 }),
    numParam('vf', 'Velocity factor', '0.66', '', { min: 0, max: 1 }),
  ],
  toSpice: (ctx) => {
    const td = positive(ctx, 'length') / (positive(ctx, 'vf') * 299792458);
    return { elements: [elT(ctx.name('T'), ctx.node('A+'), ctx.node('A-'), ctx.node('B+'), ctx.node('B-'), positive(ctx, 'z0'), td)] };
  },
  footprint: 'COAX',
  keywords: ['coax', 'cable', 'rg58', 'transmission line'],
};

// ---------------------------------------------------------------------------
// DC motor (electromechanical)
// ---------------------------------------------------------------------------

const MOTOR_KEYS = ['ra', 'la', 'kt', 'j', 'b', 'tload'];

export const dcMotor: LibraryPartDef = {
  id: 'electromechanical/dc-motor',
  name: 'DC Motor',
  group: 'electromechanical',
  family: 'Motor',
  description: 'Permanent-magnet DC motor: armature R-L, back-EMF Kt·ω, inertia J, viscous friction B and load torque; speed is V(<refdes>.w) in rad/s',
  prefix: 'M',
  symbol: twoPinH([circle(0, 0, 14), text(0, 5, 'M', 13, 'middle', true), line(-20, 0, -14, 0), line(14, 0, 20, 0), text(-22, -8, '+', 9)], { names: ['+', '-'], bodyHalf: 20 }),
  params: [
    numParam('ra', 'Armature resistance', '2', 'Ω', { min: 0 }),
    numParam('la', 'Armature inductance', '1m', 'H', { min: 0 }),
    numParam('kt', 'Torque / back-EMF constant', '10m', 'N·m/A', { showOnSchematic: true, min: 0 }),
    numParam('j', 'Rotor inertia', '10u', 'kg·m²', { min: 0 }),
    numParam('b', 'Viscous friction', '10u', 'N·m·s', { min: 0 }),
    numParam('tload', 'Load torque', '0', 'N·m'),
  ],
  indicator: { kind: 'motor', signal: 'w' },
  toSpice: (ctx) => {
    const v: Record<string, number> = {};
    for (const k of MOTOR_KEYS) v[k] = ctx.num(k);
    if (!(v.ra > 0 && v.la > 0 && v.kt > 0 && v.j > 0 && v.b > 0)) throw new Error('bad value for motor parameters: ra, la, kt, j and b must be > 0');
    const n1 = internalNode(ctx, 'n1');
    const n2 = internalNode(ctx, 'n2');
    const n3 = internalNode(ctx, 'n3');
    const w = internalNode(ctx, 'w');
    const sense = ctx.name('V', 'i');
    const els: ElementIR[] = [
      elR(ctx.name('R', 'a'), ctx.node('+'), n1, v.ra),
      elL(ctx.name('L', 'a'), n1, n2, v.la),
      elSense(sense, n2, n3),
      elE(ctx.name('E', 'emf'), n3, ctx.node('-'), w, '0', v.kt),
      elF(ctx.name('F', 'torque'), '0', w, sense, v.kt),
      elC(ctx.name('C', 'j'), w, '0', v.j),
      elR(ctx.name('R', 'b'), w, '0', 1 / v.b),
    ];
    if (v.tload !== 0) els.push(elI(ctx.name('I', 'load'), w, '0', { dc: v.tload }));
    return { elements: els };
  },
  bindIndicator: (ctx) => ({ signal: { kind: 'voltage', pos: internalNodeName(ctx.refdes, 'w'), neg: '0' }, current: { kind: 'current', element: ctx.name('V', 'i') } }),
  provenance: 'Standard DC-motor equations (electrical analogue of the mechanical system); defaults resemble a small 6-12 V hobby motor',
  footprint: 'MOTOR-2P',
  keywords: ['motor', 'dc motor', 'actuator', 'electromechanical'],
};

// ---------------------------------------------------------------------------
// Relays (electromechanical)
// ---------------------------------------------------------------------------

const RELAY_KEYS = ['rcoil', 'lcoil', 'ion', 'ioff', 'ron', 'roff'];

function relayParams(): ParamDef[] {
  return [
    numParam('rcoil', 'Coil resistance', '400', 'Ω', { min: 0 }),
    numParam('lcoil', 'Coil inductance', '100m', 'H', { min: 0 }),
    numParam('ion', 'Pull-in current', '20m', 'A', { showOnSchematic: true, min: 0 }),
    numParam('ioff', 'Drop-out current', '10m', 'A', { min: 0 }),
    numParam('ron', 'Contact on resistance', '50m', 'Ω', { group: 'advanced', min: 0 }),
    numParam('roff', 'Contact off resistance', '1G', 'Ω', { group: 'advanced', min: 0 }),
  ];
}

function relaySymbol(spdt: boolean) {
  const prims: SymbolPrim[] = [
    rect(-34, -12, 20, 24),
    line(-40, -20, -24, -20),
    line(-24, -20, -24, -12),
    line(-40, 20, -24, 20),
    line(-24, 20, -24, 12),
    line(-34, 12, -14, -12),
    line(-14, 0, 4, 0, 1),
    line(10, 20, 10, 6),
    circle(10, 6, 2),
    line(11, 5, 28, -12),
    line(30, -20, 30, -12),
    circle(30, -12, 2),
    line(40, -20, 30, -20),
  ];
  const pins = [
    pin('C1', -40, -20, 'left', { number: '1' }),
    pin('C2', -40, 20, 'left', { number: '2' }),
    pin('COM', 10, 20, 'down', { number: '3' }),
    pin('NO', 40, -20, 'right', { number: '4' }),
  ];
  if (spdt) {
    prims.push(circle(30, 4, 2), line(30, 4, 30, 0), line(30, 0, 40, 0), text(34, 12, 'NC', 6, 'start'));
    pins.push(pin('NC', 40, 0, 'right', { number: '5' }));
  }
  prims.push(text(34, -24, 'NO', 6, 'start'));
  return makeSymbol(prims, pins, { refPos: { x: -24, y: -26 }, valuePos: { x: -24, y: 34 } });
}

function relay(spdt: boolean): LibraryPartDef {
  const params = relayParams();
  return {
    id: `electromechanical/relay-${spdt ? 'spdt' : 'spst'}`,
    name: spdt ? 'Relay SPDT' : 'Relay SPST-NO',
    group: 'electromechanical',
    family: 'Relay',
    description: `Electromechanical relay: coil C1-C2; COM-NO closes above the pull-in current${spdt ? ', COM-NC closes below the drop-out current' : ''}`,
    prefix: 'K',
    symbol: relaySymbol(spdt),
    params,
    toSpice: (ctx) => {
      const v: Record<string, number> = {};
      for (const k of RELAY_KEYS) v[k] = ctx.num(k);
      if (!(v.rcoil > 0 && v.lcoil > 0 && v.ron > 0 && v.roff > 0)) throw new Error('bad value for relay parameters: rcoil, lcoil, ron and roff must be > 0');
      if (!(v.ion > v.ioff && v.ioff >= 0)) throw new Error('bad value for ion: pull-in current must exceed the drop-out current');
      const tag = paramModelName('MS_RELAY', v, defaultNums(params, RELAY_KEYS));
      const thr = (v.ion + v.ioff) / 2;
      const hys = (v.ion - v.ioff) / 2;
      const no: ModelCard = swModel(`${tag}_NO`, thr, hys, v.ron, v.roff);
      const nc: ModelCard = swModel(`${tag}_NC`, -thr, hys, v.ron, v.roff);
      const a = internalNode(ctx, 'a');
      const b = internalNode(ctx, 'b');
      const c = internalNode(ctx, 'ctl');
      const sense = ctx.name('V', 'coil');
      const els: ElementIR[] = [
        elR(ctx.name('R', 'coil'), ctx.node('C1'), a, v.rcoil),
        elL(ctx.name('L', 'coil'), a, b, v.lcoil),
        elSense(sense, b, ctx.node('C2')),
        elB(ctx.name('B'), c, '0', 'V', `abs(I(${sense}))`),
        elS(ctx.name('S', 'no'), ctx.node('COM'), ctx.node('NO'), c, '0', no.name),
      ];
      const models = [no];
      if (spdt) {
        els.push({ ...elS(ctx.name('S', 'nc'), ctx.node('COM'), ctx.node('NC'), '0', c, nc.name), params: { on: 1 } });
        models.push(nc);
      }
      return { elements: els, models };
    },
    provenance: 'MachSim relay: coil R-L with |I| threshold switches (SPICE SW with hysteresis); defaults resemble a 12 V / 400 Ω signal relay',
    footprint: spdt ? 'RELAY-5P' : 'RELAY-4P',
    keywords: ['relay', spdt ? 'spdt' : 'spst', 'coil', 'contact', 'electromechanical'],
  };
}

// ---------------------------------------------------------------------------
// Connectors (graphic only)
// ---------------------------------------------------------------------------

function header(n: number, kind: 'header' | 'terminal'): LibraryPartDef {
  const pinsList = Array.from({ length: n }, (_, i) => ({ name: String(i + 1), number: String(i + 1) }));
  const sym = boxSymbol({
    w: 20,
    h: n * 20,
    left: pinsList,
    extra: kind === 'terminal' ? pinsList.map((_, i) => circle(0, -(n - 1) * 10 + 20 * i, 4)) : [],
  });
  return {
    id: `connectors/${kind}-${n}`,
    name: kind === 'header' ? `Pin Header 1×${n}` : `Terminal Block ${n}-way`,
    group: 'connectors',
    family: kind === 'header' ? 'Header' : 'Terminal block',
    description: `${kind === 'header' ? '2.54 mm pin header' : 'Screw terminal block'} with ${n} positions (graphic / BOM only, no simulation model)`,
    prefix: 'J',
    symbol: sym,
    params: [],
    optionalPins: pinsList.map((p) => p.name),
    footprint: kind === 'header' ? `HDR-1X${n}-2.54` : `TB-${n}P-5.08`,
    keywords: ['connector', kind, 'header', 'terminal'],
  };
}

const connectors = [header(2, 'header'), header(3, 'header'), header(4, 'header'), header(2, 'terminal'), header(3, 'terminal')];

export const MISC_PARTS: LibraryPartDef[] = [...crystals, ...optocouplers, tline, coax, dcMotor, relay(false), relay(true), ...connectors];
