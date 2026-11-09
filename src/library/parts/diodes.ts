/**
 * Diodes group: generic / switching / rectifier / Schottky / Zener diodes, LEDs, bridge
 * rectifiers, varactor, photodiode and an SCR.
 *
 * Model provenance. Real part numbers use MachSim's own fits to the published datasheet
 * characteristics (forward voltage at stated currents, junction capacitance, reverse recovery,
 * breakdown voltage at the stated test current). They are NOT vendor model files; each part's
 * `provenance` says which datasheet figures the fit reproduces. Model names carry the prefix
 * "MS_" so they never clash with user-imported models.
 *
 * Zener diodes are modelled with three elements so both the forward drop and the datasheet
 * Zener impedance are right at the same time:
 *   D_f   A -> K       forward junction (no breakdown)
 *   D_r   A -> n       breakdown junction (IS = 1e-20, BV, IBV = 1 mA, NBV = 1)
 *   R_z   n -> K       ZZT
 * with BV = VZ - IZT·ZZT - Vt·ln(IZT / 1 mA) so that V(K,A) = VZ at IZT.
 *
 * LEDs contain a 0 V sense source in series ("V_<refdes>_i") whose current drives the indicator.
 */

import type { ModelCard } from '../../sim/netlist';
import { thermalVoltage } from '../../sim/device';
import {
  card,
  defaultNums,
  elD,
  elI,
  elQ,
  elR,
  elSense,
  elX,
  internalNode,
  keyParam,
  modelOverride,
  numParam,
  optNum,
  paramModelName,
  selectParam,
  subckt,
  textParam,
  type LibraryPartDef,
} from '../partkit';
import { diodeBody, line, makeSymbol, pin, poly, text, twoPinH } from '../symbols';
import type { ParamDef, SymbolPrim, ToSpiceContext } from '../types';

/** Thermal voltage at the default circuit / nominal temperature (27 °C). */
const VT = thermalVoltage(300.15);

const modelNameParam = (): ParamDef =>
  textParam('model', 'SPICE model override', '', { group: 'model', help: 'Name of a user-imported .model to use instead of the built-in one (blank = built-in)' });

interface DiodeOpts {
  slug: string;
  name: string;
  family: string;
  description: string;
  model: ModelCard;
  body?: Parameters<typeof diodeBody>[0];
  provenance: string;
  footprint?: string;
  keywords?: string[];
}

function diodeSymbol(kind: Parameters<typeof diodeBody>[0] = 'plain') {
  return twoPinH(diodeBody(kind), { names: ['A', 'K'] });
}

/** Single-junction diode part with a fixed built-in model card. */
function fixedDiode(o: DiodeOpts): LibraryPartDef {
  return {
    id: `diodes/${o.slug}`,
    name: o.name,
    group: 'diodes',
    family: o.family,
    description: o.description,
    prefix: 'D',
    symbol: diodeSymbol(o.body),
    params: [modelNameParam()],
    toSpice: (ctx) => {
      const m = modelOverride(ctx, o.model.name);
      return { elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), m)], models: m === o.model.name ? [o.model] : [] };
    },
    provenance: o.provenance,
    footprint: o.footprint ?? 'DO-35',
    keywords: o.keywords ?? [],
  };
}

// ---------------------------------------------------------------------------
// Generic diode (all main model parameters editable)
// ---------------------------------------------------------------------------

const GEN_KEYS = ['is', 'n', 'rs', 'cjo', 'vj', 'm', 'tt'];

const genericDiodeParams: ParamDef[] = [
  numParam('is', 'Saturation current IS', '10f', 'A', { group: 'model', min: 0 }),
  numParam('n', 'Emission coefficient N', '1', '', { group: 'model', min: 0 }),
  numParam('rs', 'Series resistance RS', '0', 'Ω', { group: 'model', min: 0 }),
  numParam('cjo', 'Zero-bias capacitance CJO', '0', 'F', { group: 'model', min: 0 }),
  numParam('vj', 'Junction potential VJ', '1', 'V', { group: 'model', min: 0 }),
  numParam('m', 'Grading coefficient M', '0.5', '', { group: 'model', min: 0 }),
  numParam('tt', 'Transit time TT', '0', 's', { group: 'model', min: 0 }),
  numParam('bv', 'Reverse breakdown BV', '', 'V', { group: 'model', help: 'Blank = no breakdown' }),
  numParam('ibv', 'Current at BV', '1m', 'A', { group: 'model', min: 0 }),
  modelNameParam(),
];

/** Model card from the editable generic-diode params (hash-suffixed name when not default). */
function genericDiodeModel(ctx: ToSpiceContext, base: string, defs: ParamDef[]): ModelCard {
  const vals: Record<string, number> = {};
  for (const k of GEN_KEYS) vals[k] = ctx.num(k);
  const bv = optNum(ctx, 'bv');
  if (bv !== undefined) {
    vals.bv = bv;
    vals.ibv = ctx.num('ibv');
  }
  const name = paramModelName(base, vals, defaultNums(defs, GEN_KEYS));
  return card(name, 'D', vals);
}

const genericDiode: LibraryPartDef = {
  id: 'diodes/diode',
  name: 'Diode',
  group: 'diodes',
  family: 'Generic diode',
  description: 'Junction diode with editable SPICE parameters',
  prefix: 'D',
  symbol: diodeSymbol(),
  params: genericDiodeParams,
  toSpice: (ctx) => {
    const override = (ctx.params.model ?? '').trim();
    if (override) return { elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), override)] };
    const m = genericDiodeModel(ctx, 'MS_DGEN', genericDiodeParams);
    return { elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), m.name)], models: [m] };
  },
  provenance: 'SPICE3 junction diode; defaults are the SPICE defaults except IS = 10 fA',
  footprint: 'DO-35',
  keywords: ['diode', 'generic', 'junction'],
};

const schottkyGenericParams: ParamDef[] = genericDiodeParams.map((p) => {
  const d: Record<string, string> = { is: '1u', n: '1.05', rs: '0.1', cjo: '50p', vj: '0.4', m: '0.5', tt: '0' };
  return d[p.key] !== undefined ? { ...p, default: d[p.key] } : p;
});

const genericSchottky: LibraryPartDef = {
  ...genericDiode,
  id: 'diodes/schottky',
  name: 'Schottky Diode',
  family: 'Schottky diode',
  description: 'Schottky barrier diode with editable SPICE parameters (low forward drop, no stored charge)',
  symbol: diodeSymbol('schottky'),
  params: schottkyGenericParams,
  toSpice: (ctx) => {
    const override = (ctx.params.model ?? '').trim();
    if (override) return { elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), override)] };
    const m = genericDiodeModel(ctx, 'MS_DSCH', schottkyGenericParams);
    return { elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), m.name)], models: [m] };
  },
  provenance: 'SPICE3 junction diode with Schottky-like defaults (IS = 1 µA, N = 1.05)',
  keywords: ['schottky', 'diode', 'low drop'],
};

// ---------------------------------------------------------------------------
// Switching and rectifier diodes
// ---------------------------------------------------------------------------

const D1N4148 = card('MS_1N4148', 'D', { is: 3e-9, n: 1.8, rs: 0.6, cjo: 4e-12, vj: 0.7, m: 0.35, tt: 6e-9, bv: 100, ibv: 100e-6 });
const D1N914 = card('MS_1N914', 'D', { is: 3e-9, n: 1.8, rs: 0.6, cjo: 4e-12, vj: 0.7, m: 0.35, tt: 6e-9, bv: 100, ibv: 100e-6 });

const switchingDiodes = [
  fixedDiode({
    slug: '1n4148',
    name: '1N4148',
    family: 'Switching diode',
    description: 'Small-signal fast switching diode, 100 V / 200 mA',
    model: D1N4148,
    provenance: 'MachSim fit to 1N4148 datasheet figures: VF ≈ 0.70 V @ 10 mA, CD ≤ 4 pF, trr ≈ 4 ns, V(BR) ≥ 100 V @ 100 µA',
    keywords: ['1n4148', 'switching', 'signal diode'],
  }),
  fixedDiode({
    slug: '1n914',
    name: '1N914',
    family: 'Switching diode',
    description: 'Small-signal fast switching diode, 100 V',
    model: D1N914,
    provenance: 'MachSim fit to 1N914 datasheet figures: VF ≈ 0.70 V @ 10 mA, CD ≤ 4 pF, trr ≈ 4 ns, V(BR) ≥ 100 V',
    keywords: ['1n914', 'switching', 'signal diode'],
  }),
];

const RECTIFIERS: [string, number][] = [
  ['1N4001', 50],
  ['1N4002', 100],
  ['1N4003', 200],
  ['1N4004', 400],
  ['1N4005', 600],
  ['1N4006', 800],
  ['1N4007', 1000],
];

function rectifierModel(pn: string, vrrm: number): ModelCard {
  return card(`MS_${pn}`, 'D', { is: 15e-9, n: 1.9, rs: 0.04, cjo: 30e-12, vj: 0.5, m: 0.33, tt: 4e-6, bv: vrrm, ibv: 5e-6 });
}

const rectifierDiodes = RECTIFIERS.map(([pn, vrrm]) =>
  fixedDiode({
    slug: pn.toLowerCase(),
    name: pn,
    family: 'Rectifier diode',
    description: `General-purpose 1 A rectifier, VRRM = ${vrrm} V`,
    model: rectifierModel(pn, vrrm),
    provenance: `MachSim fit to the 1N400x datasheet: VF ≈ 0.92 V @ 1 A (max 1.1 V), CJ ≈ 15 pF @ 4 V, standard recovery (TT 4 µs), breakdown at VRRM = ${vrrm} V`,
    footprint: 'DO-41',
    keywords: [pn.toLowerCase(), 'rectifier', 'power diode', '1n400x'],
  }),
);

const SCHOTTKY_1N58: [string, number, number, number][] = [
  // part, VRRM, IS, N   (VF @ 1 A = 0.45 / 0.55 / 0.60 V with RS = 0.05 Ω)
  ['1N5817', 20, 1.92e-7, 1.0],
  ['1N5818', 30, 1.0e-7, 1.2],
  ['1N5819', 40, 7.8e-8, 1.3],
];

const schottkyDiodes = [
  ...SCHOTTKY_1N58.map(([pn, vr, is, n]) =>
    fixedDiode({
      slug: pn.toLowerCase(),
      name: pn,
      family: 'Schottky diode',
      description: `1 A Schottky barrier rectifier, VRRM = ${vr} V`,
      model: card(`MS_${pn}`, 'D', { is, n, rs: 0.05, cjo: 110e-12, vj: 0.35, m: 0.5, tt: 0, bv: vr, ibv: 1e-3 }),
      body: 'schottky',
      provenance: `MachSim fit to the ${pn} datasheet: VF ${pn === '1N5817' ? '0.45' : pn === '1N5818' ? '0.55' : '0.60'} V @ 1 A, CJ ≈ 110 pF, IR ≤ 1 mA at VRRM`,
      footprint: 'DO-41',
      keywords: [pn.toLowerCase(), 'schottky', 'rectifier'],
    }),
  ),
  fixedDiode({
    slug: 'bat54',
    name: 'BAT54',
    family: 'Schottky diode',
    description: 'Small-signal Schottky diode, 30 V / 200 mA',
    model: card('MS_BAT54', 'D', { is: 4.2e-9, n: 1.0, rs: 3.1, cjo: 10e-12, vj: 0.35, m: 0.5, tt: 0, bv: 30, ibv: 2e-6 }),
    body: 'schottky',
    provenance: 'MachSim fit to the BAT54 datasheet: VF 0.32 V @ 1 mA, 0.50 V @ 30 mA, CD ≈ 10 pF, V(BR) 30 V',
    footprint: 'SOT-23',
    keywords: ['bat54', 'schottky', 'signal'],
  }),
];

// ---------------------------------------------------------------------------
// Zener diodes
// ---------------------------------------------------------------------------

export interface ZenerSpec {
  vz: number;
  izt: number;
  zzt: number;
  cjo: number;
}

/** Elements and models of a Zener (see module header). `tag` makes the model names unique. */
export function zenerFragment(ctx: ToSpiceContext, tag: string, z: ZenerSpec) {
  const ibv = 1e-3;
  const bv = z.vz - z.izt * z.zzt - VT * Math.log(z.izt / ibv);
  if (!(bv > 0)) throw new Error('bad value for vz: breakdown voltage must exceed IZT·ZZT');
  const fwd = card(`MS_${tag}_F`, 'D', { is: 1e-9, n: 1.5, rs: 0.5, cjo: z.cjo, vj: 0.75, m: 0.33, tt: 50e-9 });
  const brk = card(`MS_${tag}_R`, 'D', { is: 1e-20, n: 1, bv, ibv, nbv: 1 });
  const n = internalNode(ctx, 'z');
  return {
    elements: [
      elD(ctx.name('D', 'f'), ctx.node('A'), ctx.node('K'), fwd.name),
      elD(ctx.name('D', 'r'), ctx.node('A'), n, brk.name),
      elR(ctx.name('R', 'z'), n, ctx.node('K'), z.zzt),
    ],
    models: [fwd, brk],
  };
}

const ZENERS: [string, ZenerSpec][] = [
  ['1N4728A', { vz: 3.3, izt: 76e-3, zzt: 10, cjo: 400e-12 }],
  ['1N4733A', { vz: 5.1, izt: 49e-3, zzt: 7, cjo: 250e-12 }],
  ['1N4735A', { vz: 6.2, izt: 41e-3, zzt: 2, cjo: 200e-12 }],
  ['1N4739A', { vz: 9.1, izt: 28e-3, zzt: 5, cjo: 130e-12 }],
  ['1N4742A', { vz: 12, izt: 21e-3, zzt: 9, cjo: 100e-12 }],
  ['1N4744A', { vz: 15, izt: 17e-3, zzt: 14, cjo: 80e-12 }],
];

function zenerSymbol() {
  return diodeSymbol('zener');
}

const zenerDiodes: LibraryPartDef[] = ZENERS.map(([pn, z]) => ({
  id: `diodes/${pn.toLowerCase()}`,
  name: pn,
  group: 'diodes',
  family: 'Zener diode',
  description: `${z.vz} V 1 W Zener diode (IZT = ${z.izt * 1e3} mA, ZZT = ${z.zzt} Ω)`,
  prefix: 'D',
  symbol: zenerSymbol(),
  params: [],
  toSpice: (ctx) => zenerFragment(ctx, pn, z),
  provenance: `MachSim three-element Zener fit to the 1N47xxA datasheet table: VZ = ${z.vz} V and ZZT = ${z.zzt} Ω at IZT = ${z.izt * 1e3} mA, VF ≈ 0.85 V @ 200 mA; capacitance approximate`,
  footprint: 'DO-41',
  keywords: [pn.toLowerCase(), 'zener', `${z.vz}v`, 'reference', 'regulator'],
}));

const ZENER_KEYS = ['vz', 'izt', 'zzt', 'cjo'];
const genericZenerParams: ParamDef[] = [
  numParam('vz', 'Zener voltage VZ', '5.1', 'V', { showOnSchematic: true, min: 0 }),
  numParam('izt', 'Test current IZT', '20m', 'A', { min: 0 }),
  numParam('zzt', 'Zener impedance ZZT', '5', 'Ω', { min: 0 }),
  numParam('cjo', 'Junction capacitance', '100p', 'F', { group: 'model', min: 0 }),
];

const genericZener: LibraryPartDef = {
  id: 'diodes/zener',
  name: 'Zener Diode',
  group: 'diodes',
  family: 'Zener diode',
  description: 'Zener diode specified by VZ at IZT and its dynamic impedance ZZT',
  prefix: 'D',
  symbol: zenerSymbol(),
  params: genericZenerParams,
  toSpice: (ctx) => {
    const z: ZenerSpec = { vz: ctx.num('vz'), izt: ctx.num('izt'), zzt: ctx.num('zzt'), cjo: ctx.num('cjo') };
    if (!(z.izt > 0) || !(z.zzt > 0)) throw new Error('bad value for izt/zzt: must be > 0');
    const tag = paramModelName('ZGEN', z as unknown as Record<string, number>, defaultNums(genericZenerParams, ZENER_KEYS));
    return zenerFragment(ctx, tag, z);
  },
  provenance: 'MachSim three-element Zener model (forward junction + breakdown junction + ZZT)',
  footprint: 'DO-41',
  keywords: ['zener', 'reference', 'regulator', 'breakdown'],
};

// ---------------------------------------------------------------------------
// LEDs
// ---------------------------------------------------------------------------

interface LedSpec {
  color: string;
  css: string;
  vf: number;
  n: number;
  rs: number;
  wavelength: string;
}

const LEDS: [string, LedSpec][] = [
  ['red', { color: 'Red', css: '#e53935', vf: 1.9, n: 2.0, rs: 3, wavelength: '630 nm' }],
  ['orange', { color: 'Orange', css: '#fb8c00', vf: 2.0, n: 2.0, rs: 3, wavelength: '605 nm' }],
  ['yellow', { color: 'Yellow', css: '#fdd835', vf: 2.0, n: 2.0, rs: 3, wavelength: '590 nm' }],
  ['green', { color: 'Green', css: '#43a047', vf: 2.1, n: 2.0, rs: 3, wavelength: '565 nm' }],
  ['blue', { color: 'Blue', css: '#1e88e5', vf: 3.1, n: 2.6, rs: 8, wavelength: '470 nm' }],
  ['white', { color: 'White', css: '#f5f5f5', vf: 3.2, n: 2.6, rs: 8, wavelength: 'broadband' }],
  ['infrared', { color: 'Infrared', css: '#8e24aa', vf: 1.25, n: 1.5, rs: 1, wavelength: '940 nm' }],
];

/** LED model card fitted to VF at IF (20 mA): IS = IF / exp((VF - IF·RS) / (N·Vt)). */
export function ledModel(name: string, vf: number, ifwd: number, n: number, rs: number): ModelCard {
  const is = ifwd / Math.exp((vf - ifwd * rs) / (n * VT));
  return card(name, 'D', { is, n, rs, cjo: 20e-12, vj: 1.8, m: 0.4, tt: 20e-9, bv: 5, ibv: 10e-6 });
}

export function ledSymbol(css: string) {
  const body = diodeBody('led').map((p): SymbolPrim => (p.kind === 'polyline' && p.closed && p.points.length === 6 && p.points[0] === -8 ? { ...p, fill: css } : p));
  return twoPinH(body, { names: ['A', 'K'] });
}

/** CSS colour of each LED colour name (used by the schematic glow). */
export const LED_COLORS: Record<string, string> = Object.fromEntries(LEDS.map(([slug, s]) => [slug, s.css]));

export const ledIndicatorParams = (color: string): ParamDef[] => [
  selectParam('color', 'Colour', color, LEDS.map(([slug, s]) => [slug, s.color] as [string, string]), { group: 'display' }),
  numParam('ion', 'Turn-on current', '1m', 'A', { group: 'display', min: 0, help: 'Current at which the LED starts to glow on the schematic' }),
  numParam('imax', 'Full-brightness current', '20m', 'A', { group: 'display', min: 0 }),
];

export function ledFragment(ctx: ToSpiceContext, model: ModelCard) {
  const mid = internalNode(ctx, 'a');
  const m = modelOverride(ctx, model.name);
  return {
    elements: [elSense(ctx.name('V', 'i'), ctx.node('A'), mid), elD(ctx.name('D'), mid, ctx.node('K'), m)],
    models: m === model.name ? [model] : [],
  };
}

export const ledBinding = {
  bindIndicator: (b: { name(type: string, suffix?: string): string }) => ({ signal: { kind: 'current' as const, element: b.name('V', 'i') } }),
};

const colorLeds: LibraryPartDef[] = LEDS.map(([slug, s]) => {
  const model = ledModel(`MS_LED_${slug.toUpperCase()}`, s.vf, 20e-3, s.n, s.rs);
  return {
    id: `diodes/led-${slug}`,
    name: `LED ${s.color}`,
    group: 'diodes',
    family: 'LED',
    description: `${s.color} LED (${s.wavelength}), VF ≈ ${s.vf} V @ 20 mA`,
    prefix: 'LED',
    symbol: ledSymbol(s.css),
    params: [...ledIndicatorParams(slug), modelNameParam()],
    toSpice: (ctx) => ledFragment(ctx, model),
    indicator: { kind: 'led', signal: 'current' },
    ...ledBinding,
    provenance: `MachSim fit: typical 5 mm ${s.color.toLowerCase()} LED, VF = ${s.vf} V @ 20 mA (N = ${s.n}, RS = ${s.rs} Ω), VR(max) 5 V`,
    footprint: 'LED-5MM',
    keywords: ['led', 'light emitting diode', s.color.toLowerCase(), 'indicator'],
  };
});

const genericLedParams: ParamDef[] = [
  numParam('vf', 'Forward voltage @ 20 mA', '2', 'V', { showOnSchematic: false, min: 0 }),
  numParam('n', 'Emission coefficient', '2', '', { group: 'model', min: 0 }),
  numParam('rs', 'Series resistance', '3', 'Ω', { group: 'model', min: 0 }),
  ...ledIndicatorParams('red'),
  modelNameParam(),
];

const genericLed: LibraryPartDef = {
  id: 'diodes/led',
  name: 'LED',
  group: 'diodes',
  family: 'LED',
  description: 'LED specified by its forward voltage at 20 mA',
  prefix: 'LED',
  symbol: ledSymbol('#e53935'),
  params: genericLedParams,
  toSpice: (ctx) => {
    const vals = { vf: ctx.num('vf'), n: ctx.num('n'), rs: ctx.num('rs') };
    if (!(vals.vf > 0 && vals.n > 0 && vals.rs >= 0)) throw new Error('bad value for vf/n/rs');
    const name = paramModelName('MS_LED_GEN', vals, defaultNums(genericLedParams, ['vf', 'n', 'rs']));
    return ledFragment(ctx, ledModel(name, vals.vf, 20e-3, vals.n, vals.rs));
  },
  indicator: { kind: 'led', signal: 'current' },
  ...ledBinding,
  provenance: 'MachSim LED model fitted from the given VF at 20 mA',
  footprint: 'LED-5MM',
  keywords: ['led', 'light emitting diode', 'indicator'],
};

// ---------------------------------------------------------------------------
// Bridge rectifiers (subcircuits)
// ---------------------------------------------------------------------------

export function bridgeSymbol() {
  return makeSymbol(
    [
      poly([0, -30, 30, 0, 0, 30, -30, 0], true),
      line(-40, 0, -30, 0),
      line(30, 0, 40, 0),
      line(0, -40, 0, -30),
      line(0, 30, 0, 40),
      poly([-6, 6, 6, 6, 0, -5], true),
      line(-6, -5, 6, -5),
      text(-24, -10, '~', 10),
      text(24, -10, '~', 10),
      text(9, -22, '+', 9),
      text(9, 30, '−', 9),
    ],
    [
      pin('AC1', -40, 0, 'left', { number: '1' }),
      pin('AC2', 40, 0, 'right', { number: '2' }),
      pin('+', 0, -40, 'up', { number: '3' }),
      pin('-', 0, 40, 'down', { number: '4' }),
    ],
    { refPos: { x: 30, y: -28 }, valuePos: { x: 30, y: 36 } },
  );
}

function bridgePart(slug: string, name: string, description: string, diode: ModelCard, provenance: string): LibraryPartDef {
  const sub = subckt(
    `MS_BRIDGE_${slug.toUpperCase().replace(/-/g, '_')}`,
    ['ac1', 'ac2', 'p', 'n'],
    [elD('D1', 'ac1', 'p', diode.name), elD('D2', 'ac2', 'p', diode.name), elD('D3', 'n', 'ac1', diode.name), elD('D4', 'n', 'ac2', diode.name)],
    [diode],
  );
  return {
    id: `diodes/${slug}`,
    name,
    group: 'diodes',
    family: 'Bridge rectifier',
    description,
    prefix: 'D',
    symbol: bridgeSymbol(),
    params: [],
    toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('AC1'), ctx.node('AC2'), ctx.node('+'), ctx.node('-')], sub.name)], subckts: [sub] }),
    provenance,
    footprint: 'BRIDGE-4P',
    keywords: ['bridge', 'rectifier', 'full wave', 'graetz'],
  };
}

const bridges = [
  bridgePart('bridge-rectifier', 'Bridge Rectifier 1 A', 'Full-wave bridge of four 1 A / 400 V rectifier diodes', card('MS_BRIDGE_DIODE', 'D', { is: 15e-9, n: 1.9, rs: 0.04, cjo: 30e-12, vj: 0.5, m: 0.33, tt: 4e-6, bv: 400, ibv: 5e-6 }), 'Four diodes with the MachSim 1N4004 fit (VF ≈ 0.92 V @ 1 A each)'),
  bridgePart('bridge-schottky', 'Schottky Bridge Rectifier', 'Low-drop full-wave bridge of four 1 A / 40 V Schottky diodes', card('MS_BRIDGE_SCHOTTKY', 'D', { is: 7.8e-8, n: 1.3, rs: 0.05, cjo: 110e-12, vj: 0.35, m: 0.5, tt: 0, bv: 40, ibv: 1e-3 }), 'Four diodes with the MachSim 1N5819 fit (VF ≈ 0.60 V @ 1 A each)'),
];

// ---------------------------------------------------------------------------
// Varactor, photodiode, SCR
// ---------------------------------------------------------------------------

const VAR_KEYS = ['cjo', 'vj', 'm', 'rs'];
const varactorParams: ParamDef[] = [
  numParam('cjo', 'Zero-bias capacitance', '30p', 'F', { showOnSchematic: true, min: 0 }),
  numParam('vj', 'Junction potential', '0.75', 'V', { group: 'model', min: 0 }),
  numParam('m', 'Grading coefficient', '0.5', '', { group: 'model', min: 0 }),
  numParam('rs', 'Series resistance', '0.5', 'Ω', { group: 'model', min: 0 }),
];

const varactor: LibraryPartDef = {
  id: 'diodes/varactor',
  name: 'Varactor Diode',
  group: 'diodes',
  family: 'Varactor',
  description: 'Variable-capacitance diode: C(VR) = CJO / (1 + VR/VJ)^M when reverse biased',
  prefix: 'D',
  symbol: diodeSymbol('varactor'),
  params: varactorParams,
  toSpice: (ctx) => {
    const vals = { cjo: ctx.num('cjo'), vj: ctx.num('vj'), m: ctx.num('m'), rs: ctx.num('rs') };
    const name = paramModelName('MS_VARACTOR', vals, defaultNums(varactorParams, VAR_KEYS));
    const m = card(name, 'D', { is: 1e-14, n: 1, ...vals, bv: 30, ibv: 10e-6 });
    return { elements: [elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), name)], models: [m] };
  },
  provenance: 'SPICE depletion-capacitance diode with user-set CJO / VJ / M',
  footprint: 'SOD-323',
  keywords: ['varactor', 'varicap', 'tuning diode'],
};

const PHOTO_MODEL = card('MS_PHOTODIODE', 'D', { is: 1e-10, n: 1.1, rs: 10, cjo: 10e-12, vj: 0.6, m: 0.5, bv: 50, ibv: 10e-6 });

const photodiode: LibraryPartDef = {
  id: 'diodes/photodiode',
  name: 'Photodiode',
  group: 'diodes',
  family: 'Photodiode',
  description: "Photodiode: junction diode plus a photocurrent (cathode -> anode inside) proportional to the light level. Key 'L' changes the light level.",
  prefix: 'D',
  symbol: diodeSymbol('photo'),
  params: [
    numParam('iph', 'Photocurrent at 100 %', '100u', 'A', { min: 0 }),
    numParam('light', 'Light level', '50', '%', { min: 0, max: 100, showOnSchematic: true }),
    keyParam('L'),
  ],
  interactive: { kind: 'slider', param: 'light', label: 'Light level', key: 'L', step: 5 },
  toSpice: (ctx) => {
    const light = ctx.num('light');
    if (light < 0 || light > 100) throw new Error('bad value for light: must be between 0 and 100 %');
    return {
      elements: [
        elD(ctx.name('D'), ctx.node('A'), ctx.node('K'), PHOTO_MODEL.name),
        elI(ctx.name('I', 'ph'), ctx.node('K'), ctx.node('A'), { dc: (ctx.num('iph') * light) / 100 }),
      ],
      models: [PHOTO_MODEL],
    };
  },
  provenance: 'Generic silicon PIN photodiode: dark current ≈ 0.1 nA, CJ 10 pF; photocurrent scales linearly with light',
  footprint: 'PD-5MM',
  keywords: ['photodiode', 'light sensor', 'pin diode', 'optical'],
};

export const SCR_SUB = subckt(
  'MS_SCR',
  ['a', 'k', 'g'],
  [elQ('QP', 'g', 'nb', 'a', 'MS_SCR_PNP'), elQ('QN', 'nb', 'g', 'k', 'MS_SCR_NPN'), elR('RGK', 'g', 'k', 1000)],
  [
    card('MS_SCR_PNP', 'PNP', { is: 1e-14, bf: 2, br: 0.5, cje: 20e-12, cjc: 20e-12, tf: 50e-9, tr: 1e-6 }),
    card('MS_SCR_NPN', 'NPN', { is: 1e-14, bf: 50, br: 0.5, cje: 20e-12, cjc: 10e-12, tf: 20e-9, tr: 1e-6 }),
  ],
);

const scr: LibraryPartDef = {
  id: 'diodes/scr',
  name: 'SCR (Thyristor)',
  group: 'diodes',
  family: 'Thyristor',
  description: 'Silicon controlled rectifier (two-transistor model): latches on with ≈ 0.6 mA gate current, holds above ≈ 1 mA anode current',
  prefix: 'D',
  symbol: makeSymbol(
    [...diodeBody(), line(-30, 0, -20, 0), line(20, 0, 30, 0), line(6, 4, 10, 10), line(10, 10, 10, 20)],
    [pin('A', -30, 0, 'left', { number: '1' }), pin('K', 30, 0, 'right', { number: '2' }), pin('G', 10, 20, 'down', { number: '3' })],
    { refPos: { x: 0, y: -14 }, valuePos: { x: -12, y: 22 } },
  ),
  params: [],
  toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('A'), ctx.node('K'), ctx.node('G')], SCR_SUB.name)], subckts: [SCR_SUB] }),
  provenance: 'Textbook two-transistor thyristor model (PNP βF = 2, NPN βF = 50, RGK = 1 kΩ); no forward breakover',
  footprint: 'TO-92',
  keywords: ['scr', 'thyristor', 'silicon controlled rectifier'],
};

export const DIODE_PARTS: LibraryPartDef[] = [
  genericDiode,
  ...switchingDiodes,
  ...rectifierDiodes,
  genericSchottky,
  ...schottkyDiodes,
  genericZener,
  ...zenerDiodes,
  genericLed,
  ...colorLeds,
  ...bridges,
  varactor,
  photodiode,
  scr,
];
