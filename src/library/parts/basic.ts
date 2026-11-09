/**
 * Basic group: resistors (fixed, potentiometer, rheostat, thermistors, LDR), capacitors,
 * inductors, coupled inductors / transformers and switches.
 *
 * Interactive parts keep a CONSTANT topology: every switch contact is a resistor whose value is
 * `ron` or `roff` depending on the state parameter, and sliders change resistor / capacitor /
 * inductor values. Re-running toSpice after an interaction therefore only changes element
 * values, which the interactive stepper applies with setParam(element, 'value', v)
 * (see src/model/interactive.ts).
 *
 * Variable parts (potentiometer, rheostat, variable C / L) never produce a zero value: the
 * effective fraction is clamped to [1e-6, 1] of the nominal value.
 */

import {
  boolOf,
  boolParam,
  cswModel,
  defaultNums,
  elC,
  elK,
  elL,
  elR,
  elS,
  elSense,
  elV,
  elW,
  internalNode,
  keyParam,
  numParam,
  optNum,
  paramModelName,
  selectParam,
  stepParam,
  swModel,
  textOf,
  wPulse,
  type LibraryPartDef,
} from '../partkit';
import {
  arrow,
  arrowHead,
  capacitorBody,
  circle,
  humpsV,
  inductorBody,
  line,
  makeSymbol,
  pin,
  poly,
  rect,
  resistorBody,
  text,
  twoPinH,
  variableArrow,
  zigzag,
} from '../symbols';
import type { ElementIR } from '../../sim/netlist';
import type { ParamDef, SymbolPrim, ToSpiceContext } from '../types';

const MIN_FRACTION = 1e-6;

function fraction(ctx: ToSpiceContext, key = 'percent'): number {
  const p = ctx.num(key);
  if (p < 0 || p > 100) throw new Error(`bad value for ${key}: must be between 0 and 100 %`);
  return Math.max(MIN_FRACTION, p / 100);
}

function positive(ctx: ToSpiceContext, key: string): number {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
}

const percentParam = (def = '50'): ParamDef =>
  numParam('percent', 'Setting', def, '%', { min: 0, max: 100, showOnSchematic: true, help: 'Interactive setting (0..100 %)' });

// ---------------------------------------------------------------------------
// Resistors
// ---------------------------------------------------------------------------

const resistor: LibraryPartDef = {
  id: 'basic/resistor',
  name: 'Resistor',
  group: 'basic',
  family: 'Resistor',
  description: 'Resistor with optional linear / quadratic temperature coefficients',
  prefix: 'R',
  symbol: twoPinH(resistorBody()),
  params: [
    numParam('value', 'Resistance', '1k', 'Ω', { showOnSchematic: true, min: 0 }),
    numParam('tolerance', 'Tolerance', '5', '%', { group: 'advanced', min: 0, help: 'Used by Monte Carlo / worst-case analyses and the BOM' }),
    numParam('tc1', 'TC1', '0', '1/°C', { group: 'advanced' }),
    numParam('tc2', 'TC2', '0', '1/°C²', { group: 'advanced' }),
    numParam('power', 'Power rating', '0.25', 'W', { group: 'advanced', min: 0 }),
  ],
  toSpice: (ctx) => {
    const r = positive(ctx, 'value');
    const params: Record<string, number> = {};
    const tc1 = ctx.num('tc1');
    const tc2 = ctx.num('tc2');
    if (tc1 !== 0) params.tc1 = tc1;
    if (tc2 !== 0) params.tc2 = tc2;
    return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), r, params)] };
  },
  footprint: 'RES-AXIAL-400',
  keywords: ['resistor', 'ohm', 'res'],
};

const potentiometer: LibraryPartDef = {
  id: 'basic/potentiometer',
  name: 'Potentiometer',
  group: 'basic',
  family: 'Variable resistor',
  description: "Three-terminal potentiometer: R(1-W) = R·setting, R(W-2) = R·(1 - setting). Key 'A' increases the setting (Shift+A decreases).",
  prefix: 'R',
  symbol: makeSymbol(
    [line(-30, 0, -20, 0), line(20, 0, 30, 0), poly(zigzag(-20, 20)), ...arrow(0, -30, 0, -8, 5)],
    [pin('1', -30, 0, 'left', { number: '1' }), pin('2', 30, 0, 'right', { number: '3' }), pin('W', 0, -30, 'up', { number: '2' })],
    { refPos: { x: -22, y: -16 }, valuePos: { x: 0, y: 22 } },
  ),
  params: [
    numParam('value', 'Resistance', '10k', 'Ω', { showOnSchematic: true, min: 0 }),
    percentParam('50'),
    keyParam('A'),
    stepParam('5'),
  ],
  interactive: { kind: 'slider', param: 'percent', label: 'Wiper position', key: 'A', step: 5 },
  toSpice: (ctx) => {
    const r = positive(ctx, 'value');
    const f = fraction(ctx);
    const rest = Math.max(MIN_FRACTION, 1 - f);
    return {
      elements: [elR(ctx.name('R', 'a'), ctx.node('1'), ctx.node('W'), r * f), elR(ctx.name('R', 'b'), ctx.node('W'), ctx.node('2'), r * rest)],
    };
  },
  footprint: 'POT-3P',
  keywords: ['pot', 'potentiometer', 'trimmer', 'variable resistor', 'wiper'],
};

const rheostat: LibraryPartDef = {
  id: 'basic/rheostat',
  name: 'Variable Resistor',
  group: 'basic',
  family: 'Variable resistor',
  description: "Two-terminal variable resistor (rheostat): R = value · setting. Key 'A' changes the setting.",
  prefix: 'R',
  symbol: twoPinH([...resistorBody(), ...variableArrow()]),
  params: [numParam('value', 'Resistance', '10k', 'Ω', { showOnSchematic: true, min: 0 }), percentParam('50'), keyParam('A'), stepParam('5')],
  interactive: { kind: 'slider', param: 'percent', label: 'Setting', key: 'A', step: 5 },
  toSpice: (ctx) => ({ elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), positive(ctx, 'value') * fraction(ctx))] }),
  footprint: 'POT-3P',
  keywords: ['rheostat', 'variable resistor', 'trimmer'],
};

function thermistorBody(sign: '+' | '−'): SymbolPrim[] {
  return [rect(-18, -6, 36, 12), line(-18, 12, 12, -12), line(12, -12, 18, -12), text(0, 22, `${sign}t°`, 8)];
}

const ntc: LibraryPartDef = {
  id: 'basic/ntc-thermistor',
  name: 'NTC Thermistor',
  group: 'basic',
  family: 'Thermistor',
  description: 'NTC thermistor, beta model R(T) = R25·exp(B·(1/T - 1/298.15 K)); the temperature is an interactive setting',
  prefix: 'RT',
  symbol: twoPinH(thermistorBody('−'), { bodyHalf: 18, valuePos: { x: 0, y: 34 } }),
  params: [
    numParam('r25', 'Resistance at 25 °C', '10k', 'Ω', { showOnSchematic: true, min: 0 }),
    numParam('beta', 'B constant', '3950', 'K', { min: 0 }),
    numParam('temp', 'Body temperature', '25', '°C', { min: -40, max: 150 }),
    keyParam('T'),
  ],
  interactive: { kind: 'slider', param: 'temp', label: 'Temperature', key: 'T', step: 5 },
  toSpice: (ctx) => {
    const t = ctx.num('temp') + 273.15;
    if (!(t > 0)) throw new Error('bad value for temp');
    const r = positive(ctx, 'r25') * Math.exp(ctx.num('beta') * (1 / t - 1 / 298.15));
    return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), r)] };
  },
  provenance: 'Beta-parameter thermistor equation (standard textbook model); B = 3950 K is a common value for 10 kΩ NTC beads',
  footprint: 'RES-RADIAL-100',
  keywords: ['ntc', 'thermistor', 'temperature sensor'],
};

const ptc: LibraryPartDef = {
  id: 'basic/ptc-thermistor',
  name: 'PTC Thermistor',
  group: 'basic',
  family: 'Thermistor',
  description: 'Linear PTC (silicon-type) thermistor R(T) = R25·(1 + α·(T - 25 °C)); the temperature is an interactive setting',
  prefix: 'RT',
  symbol: twoPinH(thermistorBody('+'), { bodyHalf: 18, valuePos: { x: 0, y: 34 } }),
  params: [
    numParam('r25', 'Resistance at 25 °C', '1k', 'Ω', { showOnSchematic: true, min: 0 }),
    numParam('alpha', 'Temperature coefficient', '0.0077', '1/°C'),
    numParam('temp', 'Body temperature', '25', '°C', { min: -40, max: 150 }),
    keyParam('T'),
  ],
  interactive: { kind: 'slider', param: 'temp', label: 'Temperature', key: 'T', step: 5 },
  toSpice: (ctx) => {
    const r = positive(ctx, 'r25') * (1 + ctx.num('alpha') * (ctx.num('temp') - 25));
    if (!(r > 0)) throw new Error('bad value for temp: resistance would be <= 0');
    return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), r)] };
  },
  provenance: 'Linear temperature-coefficient model; α = 0.77 %/°C is typical of silicon PTC sensors (KTY-style)',
  footprint: 'RES-RADIAL-100',
  keywords: ['ptc', 'thermistor', 'temperature sensor', 'kty'],
};

const ldr: LibraryPartDef = {
  id: 'basic/ldr',
  name: 'Photoresistor (LDR)',
  group: 'basic',
  family: 'Photoresistor',
  description: 'Light-dependent resistor: R = R10·(E / 10 lx)^-γ, limited to the dark resistance; the light level is an interactive setting (100 % = max illuminance)',
  prefix: 'R',
  symbol: twoPinH([rect(-18, -6, 36, 12), ...arrow(-14, -22, -6, -9), ...arrow(-4, -22, 4, -9)], { bodyHalf: 18 }),
  params: [
    numParam('r10', 'Resistance at 10 lx', '10k', 'Ω', { showOnSchematic: true, min: 0 }),
    numParam('rdark', 'Dark resistance', '1M', 'Ω', { min: 0 }),
    numParam('gamma', 'Gamma', '0.7', '', { min: 0 }),
    numParam('luxmax', 'Illuminance at 100 %', '1000', 'lx', { min: 0 }),
    numParam('light', 'Light level', '50', '%', { min: 0, max: 100, showOnSchematic: true }),
    keyParam('L'),
  ],
  interactive: { kind: 'slider', param: 'light', label: 'Light level', key: 'L', step: 5 },
  toSpice: (ctx) => {
    const lux = (ctx.num('light') / 100) * ctx.num('luxmax');
    const rdark = positive(ctx, 'rdark');
    const r = lux > 0 ? Math.min(rdark, positive(ctx, 'r10') * Math.pow(lux / 10, -ctx.num('gamma'))) : rdark;
    return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), r)] };
  },
  provenance: 'Power-law photoconductor model R ∝ E^-γ (γ ≈ 0.7 typical for CdS cells)',
  footprint: 'LDR-5MM',
  keywords: ['ldr', 'photoresistor', 'photocell', 'cds', 'light sensor'],
};

// ---------------------------------------------------------------------------
// Capacitors and inductors
// ---------------------------------------------------------------------------

function icParam(unit: string, label: string): ParamDef {
  return numParam('ic', label, '', unit, { group: 'advanced', help: 'Initial condition used with "use initial conditions" (blank = none)' });
}

function capElement(ctx: ToSpiceContext, value: number, a: string, b: string): ElementIR {
  const ic = optNum(ctx, 'ic');
  return elC(ctx.name('C'), a, b, value, ic === undefined ? {} : { ic });
}

const capacitor: LibraryPartDef = {
  id: 'basic/capacitor',
  name: 'Capacitor',
  group: 'basic',
  family: 'Capacitor',
  description: 'Non-polarized capacitor',
  prefix: 'C',
  symbol: twoPinH(capacitorBody()),
  params: [
    numParam('value', 'Capacitance', '1u', 'F', { showOnSchematic: true, min: 0 }),
    icParam('V', 'Initial voltage'),
    numParam('tolerance', 'Tolerance', '10', '%', { group: 'advanced', min: 0 }),
    numParam('vrating', 'Voltage rating', '50', 'V', { group: 'advanced', min: 0 }),
  ],
  toSpice: (ctx) => ({ elements: [capElement(ctx, positive(ctx, 'value'), ctx.node('1'), ctx.node('2'))] }),
  footprint: 'CAP-RADIAL-200',
  keywords: ['capacitor', 'cap', 'ceramic', 'film'],
};

const electrolytic: LibraryPartDef = {
  id: 'basic/electrolytic',
  name: 'Electrolytic Capacitor',
  group: 'basic',
  family: 'Capacitor',
  description: 'Polarized (electrolytic) capacitor; + terminal on the left',
  prefix: 'C',
  symbol: twoPinH(capacitorBody(true), { names: ['+', '-'] }),
  params: [
    numParam('value', 'Capacitance', '10u', 'F', { showOnSchematic: true, min: 0 }),
    icParam('V', 'Initial voltage'),
    numParam('tolerance', 'Tolerance', '20', '%', { group: 'advanced', min: 0 }),
    numParam('vrating', 'Voltage rating', '25', 'V', { group: 'advanced', min: 0 }),
  ],
  toSpice: (ctx) => ({ elements: [capElement(ctx, positive(ctx, 'value'), ctx.node('+'), ctx.node('-'))] }),
  footprint: 'CAP-RADIAL-250',
  keywords: ['electrolytic', 'polarized', 'capacitor', 'cap'],
};

const variableCapacitor: LibraryPartDef = {
  id: 'basic/variable-capacitor',
  name: 'Variable Capacitor',
  group: 'basic',
  family: 'Capacitor',
  description: "Variable capacitor: C = value · setting. Key 'C' changes the setting.",
  prefix: 'C',
  symbol: twoPinH([...capacitorBody(), ...variableArrow()]),
  params: [numParam('value', 'Maximum capacitance', '100p', 'F', { showOnSchematic: true, min: 0 }), percentParam('50'), keyParam('C'), stepParam('5')],
  interactive: { kind: 'slider', param: 'percent', label: 'Setting', key: 'C', step: 5 },
  toSpice: (ctx) => ({ elements: [elC(ctx.name('C'), ctx.node('1'), ctx.node('2'), positive(ctx, 'value') * fraction(ctx))] }),
  footprint: 'CAP-TRIM-3P',
  keywords: ['trimmer', 'variable capacitor', 'tuning'],
};

function indElements(ctx: ToSpiceContext, value: number): ElementIR[] {
  const ic = optNum(ctx, 'ic');
  const rser = ctx.num('rser');
  if (rser < 0) throw new Error('bad value for rser: must be >= 0');
  const lp: Record<string, number> = ic === undefined ? {} : { ic };
  if (rser === 0) return [elL(ctx.name('L'), ctx.node('1'), ctx.node('2'), value, lp)];
  const mid = internalNode(ctx, 'r');
  return [elL(ctx.name('L'), ctx.node('1'), mid, value, lp), elR(ctx.name('R', 'ser'), mid, ctx.node('2'), rser)];
}

const inductor: LibraryPartDef = {
  id: 'basic/inductor',
  name: 'Inductor',
  group: 'basic',
  family: 'Inductor',
  description: 'Inductor with optional series (winding) resistance',
  prefix: 'L',
  symbol: twoPinH(inductorBody()),
  params: [
    numParam('value', 'Inductance', '1m', 'H', { showOnSchematic: true, min: 0 }),
    numParam('rser', 'Series resistance', '0', 'Ω', { group: 'advanced', min: 0 }),
    icParam('A', 'Initial current'),
    numParam('tolerance', 'Tolerance', '10', '%', { group: 'advanced', min: 0 }),
  ],
  toSpice: (ctx) => ({ elements: indElements(ctx, positive(ctx, 'value')) }),
  footprint: 'IND-AXIAL-500',
  keywords: ['inductor', 'coil', 'choke'],
};

const variableInductor: LibraryPartDef = {
  id: 'basic/variable-inductor',
  name: 'Variable Inductor',
  group: 'basic',
  family: 'Inductor',
  description: "Variable inductor: L = value · setting. Key 'L' changes the setting.",
  prefix: 'L',
  symbol: twoPinH([...inductorBody(), ...variableArrow()]),
  params: [
    numParam('value', 'Maximum inductance', '10m', 'H', { showOnSchematic: true, min: 0 }),
    percentParam('50'),
    keyParam('L'),
    stepParam('5'),
    numParam('rser', 'Series resistance', '0', 'Ω', { group: 'advanced', min: 0 }),
    icParam('A', 'Initial current'),
  ],
  interactive: { kind: 'slider', param: 'percent', label: 'Setting', key: 'L', step: 5 },
  toSpice: (ctx) => ({ elements: indElements(ctx, positive(ctx, 'value') * fraction(ctx)) }),
  footprint: 'IND-VAR',
  keywords: ['variable inductor', 'tuning coil'],
};

// ---------------------------------------------------------------------------
// Coupled inductors and transformers
// ---------------------------------------------------------------------------

function coilsSymbol(core: boolean, centreTap: boolean) {
  const prims: SymbolPrim[] = [
    line(-40, -20, -10, -20),
    line(-40, 20, -10, 20),
    ...humpsV(-20, 20, -10, 4, false),
    ...humpsV(-20, 20, 10, 4, true),
    line(10, -20, 40, -20),
    line(10, 20, 40, 20),
    circle(-20, -26, 1.8, true),
    circle(20, -26, 1.8, true),
  ];
  if (core) prims.push(line(-2, -22, -2, 22), line(2, -22, 2, 22));
  const pins = [
    pin('P1', -40, -20, 'left', { number: '1' }),
    pin('P2', -40, 20, 'left', { number: '2' }),
    pin('S1', 40, -20, 'right', { number: '3' }),
    pin('S2', 40, 20, 'right', { number: centreTap ? '5' : '4' }),
  ];
  if (centreTap) {
    prims.push(line(20, 0, 40, 0));
    pins.push(pin('CT', 40, 0, 'right', { number: '4' }));
  }
  return makeSymbol(prims, pins, { refPos: { x: 0, y: -34 }, valuePos: { x: 0, y: 36 } });
}

const coupledInductors: LibraryPartDef = {
  id: 'basic/coupled-inductors',
  name: 'Coupled Inductors',
  group: 'basic',
  family: 'Transformer',
  description: 'Two magnetically coupled inductors (mutual inductance M = k·sqrt(L1·L2)); dots mark P1 and S1',
  prefix: 'T',
  symbol: coilsSymbol(false, false),
  params: [
    numParam('l1', 'Inductance L1', '1m', 'H', { showOnSchematic: true, min: 0 }),
    numParam('l2', 'Inductance L2', '1m', 'H', { showOnSchematic: true, min: 0 }),
    numParam('k', 'Coupling coefficient', '0.99', '', { min: 0, max: 1 }),
  ],
  toSpice: (ctx) => {
    const k = ctx.num('k');
    if (!(k > 0 && k <= 1)) throw new Error('bad value for k: must be in (0, 1]');
    const la = ctx.name('L', 'a');
    const lb = ctx.name('L', 'b');
    return {
      elements: [
        elL(la, ctx.node('P1'), ctx.node('P2'), positive(ctx, 'l1')),
        elL(lb, ctx.node('S1'), ctx.node('S2'), positive(ctx, 'l2')),
        elK(ctx.name('K'), [la, lb], k),
      ],
    };
  },
  keywords: ['coupled', 'mutual inductance', 'k'],
};

const transformerParams = (): ParamDef[] => [
  numParam('turns', 'Turns ratio Np:Ns', '10', '', { showOnSchematic: true, min: 0, help: 'Primary turns per secondary turn (10 = 10:1 step-down)' }),
  numParam('lp', 'Primary inductance', '10', 'H', { min: 0 }),
  numParam('k', 'Coupling coefficient', '0.999', '', { min: 0, max: 1 }),
  numParam('rp', 'Primary resistance', '10m', 'Ω', { group: 'advanced', min: 0 }),
  numParam('rs', 'Secondary resistance', '10m', 'Ω', { group: 'advanced', min: 0 }),
  numParam('riso', 'Isolation resistance', '1G', 'Ω', { group: 'advanced', min: 0, help: 'Leakage between windings (gives the secondary a DC reference)' }),
];

/** Winding: optional series resistance then the inductor, from node a to node b. */
function winding(ctx: ToSpiceContext, tag: string, a: string, b: string, l: number, r: number): { els: ElementIR[]; lname: string } {
  const lname = ctx.name('L', tag);
  if (r <= 0) return { els: [elL(lname, a, b, l)], lname };
  const mid = internalNode(ctx, tag);
  return { els: [elR(ctx.name('R', tag), a, mid, r), elL(lname, mid, b, l)], lname };
}

function transformerCommon(ctx: ToSpiceContext): { n: number; lp: number; k: number; rp: number; rs: number; riso: number } {
  const n = positive(ctx, 'turns');
  const k = ctx.num('k');
  if (!(k > 0 && k <= 1)) throw new Error('bad value for k: must be in (0, 1]');
  return { n, lp: positive(ctx, 'lp'), k, rp: ctx.num('rp'), rs: ctx.num('rs'), riso: ctx.num('riso') };
}

const transformer: LibraryPartDef = {
  id: 'basic/transformer',
  name: 'Transformer',
  group: 'basic',
  family: 'Transformer',
  description: 'Two-winding transformer Np:Ns with coupling k (Ls = Lp/turns²); dots mark P1 and S1',
  prefix: 'T',
  symbol: coilsSymbol(true, false),
  params: transformerParams(),
  toSpice: (ctx) => {
    const t = transformerCommon(ctx);
    const p = winding(ctx, 'p', ctx.node('P1'), ctx.node('P2'), t.lp, t.rp);
    const s = winding(ctx, 's', ctx.node('S1'), ctx.node('S2'), t.lp / (t.n * t.n), t.rs);
    const els = [...p.els, ...s.els, elK(ctx.name('K'), [p.lname, s.lname], t.k)];
    if (t.riso > 0) els.push(elR(ctx.name('R', 'iso'), ctx.node('P2'), ctx.node('S2'), t.riso));
    return { elements: els };
  },
  footprint: 'XFMR-4P',
  keywords: ['transformer', 'xfmr', 'mains', 'isolation'],
};

const transformerCT: LibraryPartDef = {
  id: 'basic/transformer-ct',
  name: 'Center-Tapped Transformer',
  group: 'basic',
  family: 'Transformer',
  description: 'Transformer with a centre-tapped secondary; Np:Ns is the ratio to the WHOLE secondary (S1-S2)',
  prefix: 'T',
  symbol: coilsSymbol(true, true),
  params: transformerParams(),
  toSpice: (ctx) => {
    const t = transformerCommon(ctx);
    const half = t.lp / (2 * t.n) ** 2;
    const p = winding(ctx, 'p', ctx.node('P1'), ctx.node('P2'), t.lp, t.rp);
    const s1 = winding(ctx, 's1', ctx.node('S1'), ctx.node('CT'), half, t.rs / 2);
    const s2 = winding(ctx, 's2', ctx.node('CT'), ctx.node('S2'), half, t.rs / 2);
    const els = [
      ...p.els,
      ...s1.els,
      ...s2.els,
      elK(ctx.name('K', 'ps1'), [p.lname, s1.lname], t.k),
      elK(ctx.name('K', 'ps2'), [p.lname, s2.lname], t.k),
      elK(ctx.name('K', 's1s2'), [s1.lname, s2.lname], t.k),
    ];
    if (t.riso > 0) els.push(elR(ctx.name('R', 'iso'), ctx.node('P2'), ctx.node('CT'), t.riso));
    return { elements: els };
  },
  footprint: 'XFMR-5P',
  keywords: ['transformer', 'center tap', 'centre tap', 'ct', 'full wave'],
};

// ---------------------------------------------------------------------------
// Switches
// ---------------------------------------------------------------------------

const switchResistances = (): ParamDef[] => [
  numParam('ron', 'On resistance', '1m', 'Ω', { group: 'advanced', min: 0 }),
  numParam('roff', 'Off resistance', '1G', 'Ω', { group: 'advanced', min: 0 }),
];

function contact(ctx: ToSpiceContext, suffix: string | undefined, a: string, b: string, closed: boolean): ElementIR {
  const r = closed ? positive(ctx, 'ron') : positive(ctx, 'roff');
  return elR(ctx.name('R', suffix), a, b, r);
}

const spst: LibraryPartDef = {
  id: 'basic/switch-spst',
  name: 'SPST Switch',
  group: 'basic',
  family: 'Switch',
  description: "Single-pole single-throw toggle switch (contact = ron / roff resistor). Toggled with the Space key by default.",
  prefix: 'S',
  symbol: twoPinH([line(-20, 0, -14, 0), circle(-14, 0, 2), circle(14, 0, 2), line(-13, -1, 12, -11), line(14, 0, 20, 0)]),
  params: [boolParam('closed', 'Closed', false, { showOnSchematic: false }), keyParam('Space'), ...switchResistances()],
  interactive: { kind: 'toggle', param: 'closed', label: 'Toggle', key: 'Space' },
  toSpice: (ctx) => ({ elements: [contact(ctx, undefined, ctx.node('1'), ctx.node('2'), boolOf(ctx, 'closed'))] }),
  footprint: 'SW-TOGGLE-2P',
  keywords: ['switch', 'spst', 'toggle', 'on off'],
};

function spdtPrims(dy: number): SymbolPrim[] {
  return [
    line(-30, dy, -12, dy),
    circle(-12, dy, 2),
    circle(12, dy - 10, 2),
    circle(12, dy + 10, 2),
    line(12, dy - 10, 30, dy - 10),
    line(12, dy + 10, 30, dy + 10),
    line(-11, dy - 1, 10, dy - 9),
  ];
}

const spdt: LibraryPartDef = {
  id: 'basic/switch-spdt',
  name: 'SPDT Switch',
  group: 'basic',
  family: 'Switch',
  description: 'Single-pole double-throw switch: COM connects to A or B. Toggled with the Space key by default.',
  prefix: 'S',
  symbol: makeSymbol(
    [...spdtPrims(0), text(26, -14, 'A', 7), text(26, 22, 'B', 7)],
    [pin('COM', -30, 0, 'left', { number: '1' }), pin('A', 30, -10, 'right', { number: '2' }), pin('B', 30, 10, 'right', { number: '3' })],
    { refPos: { x: 0, y: -20 }, valuePos: { x: 0, y: 28 } },
  ),
  params: [selectParam('position', 'Position', 'A', [['A', 'COM–A'], ['B', 'COM–B']]), keyParam('Space'), ...switchResistances()],
  interactive: { kind: 'toggle', param: 'position', label: 'Toggle', key: 'Space' },
  toSpice: (ctx) => {
    const a = textOf(ctx, 'position', 'A').trim().toUpperCase() !== 'B';
    return {
      elements: [contact(ctx, 'a', ctx.node('COM'), ctx.node('A'), a), contact(ctx, 'b', ctx.node('COM'), ctx.node('B'), !a)],
    };
  },
  footprint: 'SW-TOGGLE-3P',
  keywords: ['switch', 'spdt', 'changeover', 'toggle'],
};

const dpdt: LibraryPartDef = {
  id: 'basic/switch-dpdt',
  name: 'DPDT Switch',
  group: 'basic',
  family: 'Switch',
  description: 'Double-pole double-throw switch: COM1/COM2 connect to A1/A2 or B1/B2 together. Toggled with the Space key by default.',
  prefix: 'S',
  symbol: makeSymbol(
    [...spdtPrims(-20), ...spdtPrims(20), line(0, -14, 0, 14), text(26, -34, 'A', 7), text(26, 42, 'B', 7)],
    [
      pin('COM1', -30, -20, 'left', { number: '1' }),
      pin('A1', 30, -30, 'right', { number: '2' }),
      pin('B1', 30, -10, 'right', { number: '3' }),
      pin('COM2', -30, 20, 'left', { number: '4' }),
      pin('A2', 30, 10, 'right', { number: '5' }),
      pin('B2', 30, 30, 'right', { number: '6' }),
    ],
    { refPos: { x: 0, y: -40 }, valuePos: { x: 0, y: 48 } },
  ),
  params: [selectParam('position', 'Position', 'A', [['A', 'COM–A'], ['B', 'COM–B']]), keyParam('Space'), ...switchResistances()],
  interactive: { kind: 'toggle', param: 'position', label: 'Toggle', key: 'Space' },
  toSpice: (ctx) => {
    const a = textOf(ctx, 'position', 'A').trim().toUpperCase() !== 'B';
    return {
      elements: [
        contact(ctx, 'a1', ctx.node('COM1'), ctx.node('A1'), a),
        contact(ctx, 'b1', ctx.node('COM1'), ctx.node('B1'), !a),
        contact(ctx, 'a2', ctx.node('COM2'), ctx.node('A2'), a),
        contact(ctx, 'b2', ctx.node('COM2'), ctx.node('B2'), !a),
      ],
    };
  },
  footprint: 'SW-TOGGLE-6P',
  keywords: ['switch', 'dpdt', 'double pole', 'reversing'],
};

const pushButton: LibraryPartDef = {
  id: 'basic/push-button',
  name: 'Push Button',
  group: 'basic',
  family: 'Switch',
  description: 'Momentary push button (normally open or normally closed). Held with the Space key by default.',
  prefix: 'S',
  symbol: twoPinH([line(-20, 0, -14, 0), circle(-14, 0, 2), circle(14, 0, 2), line(14, 0, 20, 0), line(-16, -8, 16, -8), line(0, -8, 0, -16), line(-5, -16, 5, -16)]),
  params: [
    boolParam('pressed', 'Pressed', false),
    selectParam('contact', 'Contact', 'no', [['no', 'Normally open'], ['nc', 'Normally closed']]),
    keyParam('Space'),
    ...switchResistances(),
  ],
  interactive: { kind: 'momentary', param: 'pressed', label: 'Press', key: 'Space' },
  toSpice: (ctx) => {
    const pressed = boolOf(ctx, 'pressed');
    const nc = textOf(ctx, 'contact', 'no').trim().toLowerCase() === 'nc';
    return { elements: [contact(ctx, undefined, ctx.node('1'), ctx.node('2'), nc ? !pressed : pressed)] };
  },
  footprint: 'SW-TACT-6MM',
  keywords: ['push button', 'pushbutton', 'momentary', 'tactile', 'key'],
};

/**
 * Controlled switch: contact 1-2 on top, control terminals C+ / C- below. The voltage-controlled
 * variant feeds a sensing box; the current-controlled one draws the control current path
 * straight through the part (C+ -> C-, arrow) with the sensing box on it.
 */
function controlledSwitchSymbol(letter: 'V' | 'I') {
  const prims: SymbolPrim[] = [
    line(-30, -10, -14, -10),
    circle(-14, -10, 2),
    circle(14, -10, 2),
    line(-13, -11, 12, -21),
    line(14, -10, 30, -10),
    rect(-10, 4, 20, 14),
    text(0, 15, letter, 9),
    line(0, -16, 0, 4, 1),
  ];
  if (letter === 'I') prims.push(line(-30, 10, -10, 10), line(10, 10, 30, 10), line(-10, 10, 10, 10), arrowHead(24, 10, 0, 5, 2.5));
  else prims.push(line(-30, 10, -10, 10), line(10, 10, 30, 10), text(-20, 6, '+', 7), text(20, 6, '−', 7));
  return makeSymbol(
    prims,
    [
      pin('1', -30, -10, 'left', { number: '1' }),
      pin('2', 30, -10, 'right', { number: '2' }),
      pin('C+', -30, 10, 'left', { number: '3' }),
      pin('C-', 30, 10, 'right', { number: '4' }),
    ],
    { refPos: { x: 0, y: -28 }, valuePos: { x: 0, y: 32 } },
  );
}

const VSW_KEYS = ['von', 'voff', 'ron', 'roff'];

const vSwitch: LibraryPartDef = {
  id: 'basic/voltage-controlled-switch',
  name: 'Voltage-Controlled Switch',
  group: 'basic',
  family: 'Switch',
  description: 'Switch 1-2 closes when V(C+,C-) rises above Von and opens when it falls below Voff (hysteresis when Von > Voff)',
  prefix: 'S',
  symbol: controlledSwitchSymbol('V'),
  params: [
    numParam('von', 'Turn-on voltage', '1', 'V', { showOnSchematic: true }),
    numParam('voff', 'Turn-off voltage', '0.5', 'V'),
    numParam('ron', 'On resistance', '1', 'Ω', { min: 0 }),
    numParam('roff', 'Off resistance', '1G', 'Ω', { min: 0 }),
  ],
  toSpice: (ctx) => {
    const von = ctx.num('von');
    const voff = ctx.num('voff');
    if (von < voff) throw new Error('bad value for voff: must not exceed von');
    const vals = { von, voff, ron: positive(ctx, 'ron'), roff: positive(ctx, 'roff') };
    const name = paramModelName('MS_VSW', vals, defaultNums(vSwitch.params, VSW_KEYS));
    return {
      elements: [elS(ctx.name('S'), ctx.node('1'), ctx.node('2'), ctx.node('C+'), ctx.node('C-'), name)],
      models: [swModel(name, (von + voff) / 2, (von - voff) / 2, vals.ron, vals.roff)],
    };
  },
  provenance: 'SPICE3 SW switch model (threshold / hysteresis), parameters chosen by the user',
  keywords: ['voltage controlled switch', 'vcsw', 's switch', 'analog switch'],
};

const ISW_KEYS = ['ion', 'ioff', 'ron', 'roff'];

const iSwitch: LibraryPartDef = {
  id: 'basic/current-controlled-switch',
  name: 'Current-Controlled Switch',
  group: 'basic',
  family: 'Switch',
  description: 'Switch 1-2 closes when the current flowing C+ -> C- through the part exceeds Ion and opens below Ioff',
  prefix: 'S',
  symbol: controlledSwitchSymbol('I'),
  params: [
    numParam('ion', 'Turn-on current', '1m', 'A', { showOnSchematic: true }),
    numParam('ioff', 'Turn-off current', '0.5m', 'A'),
    numParam('ron', 'On resistance', '1', 'Ω', { min: 0 }),
    numParam('roff', 'Off resistance', '1G', 'Ω', { min: 0 }),
  ],
  toSpice: (ctx) => {
    const ion = ctx.num('ion');
    const ioff = ctx.num('ioff');
    if (ion < ioff) throw new Error('bad value for ioff: must not exceed ion');
    const vals = { ion, ioff, ron: positive(ctx, 'ron'), roff: positive(ctx, 'roff') };
    const name = paramModelName('MS_ISW', vals, defaultNums(iSwitch.params, ISW_KEYS));
    const sense = ctx.name('V', 'sense');
    return {
      elements: [elSense(sense, ctx.node('C+'), ctx.node('C-')), elW(ctx.name('W'), ctx.node('1'), ctx.node('2'), sense, name)],
      models: [cswModel(name, (ion + ioff) / 2, (ion - ioff) / 2, vals.ron, vals.roff)],
    };
  },
  provenance: 'SPICE3 CSW switch model (threshold / hysteresis), parameters chosen by the user',
  keywords: ['current controlled switch', 'cssw', 'w switch'],
};

const timeDelaySwitch: LibraryPartDef = {
  id: 'basic/time-delay-switch',
  name: 'Time-Delay Switch',
  group: 'basic',
  family: 'Switch',
  description: 'Switch that closes at time Ton and opens at Toff (stays closed when Toff <= Ton)',
  prefix: 'S',
  symbol: twoPinH([
    line(-20, 0, -14, 0),
    circle(-14, 0, 2),
    circle(14, 0, 2),
    line(-13, -1, 12, -11),
    line(14, 0, 20, 0),
    circle(0, 14, 6),
    line(0, 14, 0, 10),
    line(0, 14, 3, 14),
  ]),
  params: [
    numParam('ton', 'Close at', '1m', 's', { showOnSchematic: true, min: 0 }),
    numParam('toff', 'Open at', '5m', 's', { min: 0 }),
    numParam('ron', 'On resistance', '1m', 'Ω', { group: 'advanced', min: 0 }),
    numParam('roff', 'Off resistance', '1G', 'Ω', { group: 'advanced', min: 0 }),
  ],
  toSpice: (ctx) => {
    const ton = ctx.num('ton');
    const toff = ctx.num('toff');
    if (ton < 0) throw new Error('bad value for ton: must be >= 0');
    const edge = 1e-9;
    const pw = toff > ton ? Math.max(0, toff - ton - edge) : 1e30;
    const ron = positive(ctx, 'ron');
    const roff = positive(ctx, 'roff');
    const vals = { ron, roff };
    const name = paramModelName('MS_TDSW', vals, { ron: 1e-3, roff: 1e9 });
    const ctl = internalNode(ctx, 'ctl');
    return {
      elements: [
        elV(ctx.name('V', 'ctl'), ctl, '0', { tran: wPulse(0, 1, ton, edge, edge, pw, 0) }),
        elS(ctx.name('S'), ctx.node('1'), ctx.node('2'), ctl, '0', name),
      ],
      models: [swModel(name, 0.5, 0, ron, roff)],
    };
  },
  provenance: 'SPICE3 SW switch driven by an internal PULSE control source (ideal timing)',
  keywords: ['time delay', 'timer switch', 'td switch'],
};

export const BASIC_PARTS: LibraryPartDef[] = [
  resistor,
  potentiometer,
  rheostat,
  ntc,
  ptc,
  ldr,
  capacitor,
  electrolytic,
  variableCapacitor,
  inductor,
  variableInductor,
  coupledInductors,
  transformer,
  transformerCT,
  spst,
  spdt,
  dpdt,
  pushButton,
  vSwitch,
  iSwitch,
  timeDelaySwitch,
];
