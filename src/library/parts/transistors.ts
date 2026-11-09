/**
 * Transistors group: BJTs (generic, small-signal, power, Darlington), JFETs and MOSFETs.
 *
 * Pins: BJT C / B / E; JFET D / G / S; MOSFET D / G / S (+ B for 4-terminal parts).
 * Element names follow ctx.name(): a refdes "Q1" gives "Q1" for a BJT, "J_Q1" / "M_Q1" for FETs.
 *
 * Model provenance
 * - 2N3904, 2N3906, 2N2222A, 2N2907A: Gummel-Poon parameter sets following the manufacturer-
 *   published (Fairchild / onsemi) SPICE models. BC547B / BC557B follow the Philips / NXP
 *   published models. 2N5457 follows the onsemi published JFET model.
 * - BD139/BD140, TIP31C/TIP32C, 2N3055, TIP120/TIP125, J310, 2N5460: MachSim fits to datasheet
 *   typical hFE, VBE(on), fT and capacitances (not vendor files).
 * - MOSFETs: SPICE level-1 approximations fitted by MachSim to the datasheet threshold voltage,
 *   RDS(on) at VGS = 10 V (5 V for BSS84), Ciss / Crss and body-diode VSD. Level 1 has no
 *   sub-threshold conduction or velocity saturation, so curves away from those points are
 *   approximate. Model W = L = 100 µm (W/L = 1, so KP is the device transconductance factor);
 *   CGSO / CGDO are per metre of W (Ciss - Crss = CGSO·W, Crss = CGDO·W). Power MOSFETs add a
 *   separate body diode element (source -> drain for N-channel).
 */

import type { ModelCard } from '../../sim/netlist';
import {
  card,
  defaultNums,
  elD,
  elJ,
  elM,
  elQ,
  elR,
  elX,
  modelOverride,
  numParam,
  optNum,
  paramModelName,
  subckt,
  textParam,
  type LibraryPartDef,
} from '../partkit';
import { bjtSymbol, jfetSymbol, mosfetSymbol } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';

const modelNameParam = (): ParamDef =>
  textParam('model', 'SPICE model override', '', { group: 'model', help: 'Name of a user-imported .model to use instead of the built-in one (blank = built-in)' });

const W = 100e-6;
const L = 100e-6;

// ---------------------------------------------------------------------------
// BJTs
// ---------------------------------------------------------------------------

interface BjtOpts {
  pn: string;
  pnp: boolean;
  description: string;
  model: ModelCard;
  provenance: string;
  footprint: string;
  family?: string;
  keywords?: string[];
}

function fixedBjt(o: BjtOpts): LibraryPartDef {
  return {
    id: `transistors/${o.pn.toLowerCase()}`,
    name: o.pn,
    group: 'transistors',
    family: o.family ?? (o.pnp ? 'PNP BJT' : 'NPN BJT'),
    description: o.description,
    prefix: 'Q',
    symbol: bjtSymbol(o.pnp),
    params: [modelNameParam()],
    toSpice: (ctx) => {
      const m = modelOverride(ctx, o.model.name);
      return { elements: [elQ(ctx.name('Q'), ctx.node('C'), ctx.node('B'), ctx.node('E'), m)], models: m === o.model.name ? [o.model] : [] };
    },
    provenance: o.provenance,
    footprint: o.footprint,
    keywords: [o.pn.toLowerCase(), 'bjt', 'transistor', o.pnp ? 'pnp' : 'npn', ...(o.keywords ?? [])],
  };
}

const M2N3904 = card('MS_2N3904', 'NPN', {
  is: 6.734e-15, xti: 3, eg: 1.11, vaf: 74.03, bf: 416.4, ne: 1.259, ise: 6.734e-15, ikf: 66.78e-3, xtb: 1.5, br: 0.7371, nc: 2, isc: 0, ikr: 0,
  rc: 1, cjc: 3.638e-12, mjc: 0.3085, vjc: 0.75, fc: 0.5, cje: 4.493e-12, mje: 0.2593, vje: 0.75, tr: 239.5e-9, tf: 301.2e-12, itf: 0.4, vtf: 4, xtf: 2, rb: 10,
});
const M2N3906 = card('MS_2N3906', 'PNP', {
  is: 1.41e-15, xti: 3, eg: 1.11, vaf: 18.7, bf: 180.7, ne: 1.5, ise: 0, ikf: 80e-3, xtb: 1.5, br: 4.977, nc: 2, isc: 0, ikr: 0,
  rc: 2.5, cjc: 9.728e-12, mjc: 0.5776, vjc: 0.75, fc: 0.5, cje: 8.063e-12, mje: 0.3677, vje: 0.75, tr: 33.42e-9, tf: 179.3e-12, itf: 0.4, vtf: 4, xtf: 6, rb: 10,
});
export const M2N2222A = card('MS_2N2222A', 'NPN', {
  is: 14.34e-15, xti: 3, eg: 1.11, vaf: 74.03, bf: 255.9, ne: 1.307, ise: 14.34e-15, ikf: 0.2847, xtb: 1.5, br: 6.092, nc: 2, isc: 0, ikr: 0,
  rc: 1, cjc: 7.306e-12, mjc: 0.3416, vjc: 0.75, fc: 0.5, cje: 22.01e-12, mje: 0.377, vje: 0.75, tr: 46.91e-9, tf: 411.1e-12, itf: 0.6, vtf: 1.7, xtf: 3, rb: 10,
});
export const M2N2907A = card('MS_2N2907A', 'PNP', {
  is: 650.6e-18, xti: 3, eg: 1.11, vaf: 115.7, bf: 231.7, ne: 1.829, ise: 54.81e-15, ikf: 1.079, xtb: 1.5, br: 3.563, nc: 2, isc: 0, ikr: 0,
  rc: 0.715, cjc: 14.76e-12, mjc: 0.5383, vjc: 0.75, fc: 0.5, cje: 19.82e-12, mje: 0.3357, vje: 0.75, tr: 111.3e-9, tf: 603.7e-12, itf: 0.65, vtf: 5, xtf: 1.7, rb: 10,
});
const MBC547B = card('MS_BC547B', 'NPN', {
  is: 2.39e-14, nf: 1.008, ise: 3.545e-15, ne: 1.541, bf: 294.3, ikf: 0.1357, vaf: 63.2, nr: 1.004, isc: 6.272e-14, nc: 1.243, br: 7.946, ikr: 0.1144, var: 25.9,
  rb: 1, irb: 1e-6, rbm: 1, re: 0.4683, rc: 0.85, xtb: 0, eg: 1.11, xti: 3, cje: 1.358e-11, vje: 0.65, mje: 0.3279, tf: 4.391e-10, xtf: 120, vtf: 2.643, itf: 0.7495,
  ptf: 0, cjc: 3.728e-12, vjc: 0.3997, mjc: 0.2955, xcjc: 0.6193, tr: 1e-32, fc: 0.9579,
});
const MBC557B = card('MS_BC557B', 'PNP', {
  is: 3.83e-14, nf: 1.008, ise: 1.22e-14, ne: 1.528, bf: 344.4, ikf: 0.08039, vaf: 21.11, nr: 1.005, isc: 2.85e-13, nc: 1.28, br: 14.84, ikr: 0.047, var: 32.02,
  rb: 1, irb: 1e-6, rbm: 1, re: 0.6202, rc: 0.5713, xtb: 0, eg: 1.11, xti: 3, cje: 1.23e-11, vje: 0.6106, mje: 0.378, tf: 5.6e-10, xtf: 3.414, vtf: 5.23, itf: 0.1483,
  ptf: 0, cjc: 1.084e-11, vjc: 0.1022, mjc: 0.3563, xcjc: 0.6288, tr: 1e-32, fc: 0.8027,
});

export function powerBjt(name: string, pnp: boolean, p: { is: number; bf: number; ikf: number; ise: number; cje: number; cjc: number; tf: number; tr: number; rb: number; re: number; rc: number }): ModelCard {
  return card(name, pnp ? 'PNP' : 'NPN', { ...p, nf: 1, ne: 1.5, vaf: 100, br: 5, xtb: 1.5, eg: 1.11, xti: 3, vje: 0.75, mje: 0.33, vjc: 0.75, mjc: 0.33, fc: 0.5 });
}

const MBD139 = powerBjt('MS_BD139', false, { is: 5e-14, bf: 150, ikf: 0.8, ise: 1e-13, cje: 100e-12, cjc: 30e-12, tf: 0.8e-9, tr: 100e-9, rb: 1, re: 0.1, rc: 0.2 });
const MBD140 = powerBjt('MS_BD140', true, { is: 5e-14, bf: 150, ikf: 0.8, ise: 1e-13, cje: 100e-12, cjc: 40e-12, tf: 0.8e-9, tr: 100e-9, rb: 1, re: 0.1, rc: 0.2 });
const MTIP31C = powerBjt('MS_TIP31C', false, { is: 1e-12, bf: 80, ikf: 1.5, ise: 1e-11, cje: 200e-12, cjc: 100e-12, tf: 40e-9, tr: 1e-6, rb: 2, re: 0.05, rc: 0.1 });
const MTIP32C = powerBjt('MS_TIP32C', true, { is: 1e-12, bf: 80, ikf: 1.5, ise: 1e-11, cje: 200e-12, cjc: 120e-12, tf: 40e-9, tr: 1e-6, rb: 2, re: 0.05, rc: 0.1 });
const M2N3055 = powerBjt('MS_2N3055', false, { is: 5e-12, bf: 60, ikf: 6, ise: 5e-11, cje: 600e-12, cjc: 300e-12, tf: 50e-9, tr: 2e-6, rb: 0.5, re: 0.02, rc: 0.05 });

const realBjts: LibraryPartDef[] = [
  fixedBjt({ pn: '2N3904', pnp: false, description: 'General-purpose NPN, 40 V / 200 mA, fT 300 MHz', model: M2N3904, provenance: 'Gummel-Poon parameters following the manufacturer-published (Fairchild/onsemi) 2N3904 model', footprint: 'TO-92', keywords: ['small signal'] }),
  fixedBjt({ pn: '2N3906', pnp: true, description: 'General-purpose PNP, 40 V / 200 mA, fT 250 MHz', model: M2N3906, provenance: 'Gummel-Poon parameters following the manufacturer-published (Fairchild/onsemi) 2N3906 model', footprint: 'TO-92', keywords: ['small signal'] }),
  fixedBjt({ pn: '2N2222A', pnp: false, description: 'General-purpose NPN switch / amplifier, 40 V / 800 mA', model: M2N2222A, provenance: 'Gummel-Poon parameters following the manufacturer-published (Fairchild/onsemi) 2N2222A model', footprint: 'TO-92', keywords: ['switching'] }),
  fixedBjt({ pn: '2N2907A', pnp: true, description: 'General-purpose PNP switch / amplifier, 60 V / 600 mA', model: M2N2907A, provenance: 'Gummel-Poon parameters following the manufacturer-published (Fairchild/onsemi) 2N2907A model', footprint: 'TO-92', keywords: ['switching'] }),
  fixedBjt({ pn: 'BC547B', pnp: false, description: 'Low-noise NPN, 45 V / 100 mA, hFE 200-450', model: MBC547B, provenance: 'Gummel-Poon parameters following the Philips/NXP published BC547B model', footprint: 'TO-92', keywords: ['small signal', 'low noise'] }),
  fixedBjt({ pn: 'BC557B', pnp: true, description: 'Low-noise PNP, 45 V / 100 mA, hFE 200-450', model: MBC557B, provenance: 'Gummel-Poon parameters following the Philips/NXP published BC557B model', footprint: 'TO-92', keywords: ['small signal', 'low noise'] }),
  fixedBjt({ pn: 'BD139', pnp: false, description: 'Medium-power NPN, 80 V / 1.5 A, 12.5 W', model: MBD139, provenance: 'MachSim fit to BD139 datasheet: hFE ≈ 100 @ 150 mA, VBE(on) < 1 V @ 0.5 A, fT ≈ 190 MHz', footprint: 'TO-126', keywords: ['power', 'medium power'] }),
  fixedBjt({ pn: 'BD140', pnp: true, description: 'Medium-power PNP, 80 V / 1.5 A, 12.5 W', model: MBD140, provenance: 'MachSim fit to BD140 datasheet: hFE ≈ 100 @ 150 mA, VBE(on) < 1 V @ 0.5 A, fT ≈ 190 MHz', footprint: 'TO-126', keywords: ['power', 'medium power'] }),
  fixedBjt({ pn: 'TIP31C', pnp: false, description: 'Power NPN, 100 V / 3 A, 40 W', model: MTIP31C, provenance: 'MachSim fit to TIP31C datasheet: hFE ≥ 25 @ 1 A, VBE(on) < 1.8 V @ 3 A, fT ≈ 3 MHz', footprint: 'TO-220', keywords: ['power'] }),
  fixedBjt({ pn: 'TIP32C', pnp: true, description: 'Power PNP, 100 V / 3 A, 40 W', model: MTIP32C, provenance: 'MachSim fit to TIP32C datasheet: hFE ≥ 25 @ 1 A, VBE(on) < 1.8 V @ 3 A, fT ≈ 3 MHz', footprint: 'TO-220', keywords: ['power'] }),
  fixedBjt({ pn: '2N3055', pnp: false, description: 'Power NPN, 60 V / 15 A, 115 W', model: M2N3055, provenance: 'MachSim fit to 2N3055 datasheet: hFE 20-70 @ 4 A, VBE(on) ≈ 1.5 V @ 4 A, fT ≈ 2.5 MHz', footprint: 'TO-3', keywords: ['power'] }),
];

// Generic BJT with editable parameters ------------------------------------------------

const BJT_KEYS = ['is', 'bf', 'br', 'cje', 'cjc', 'tf', 'tr', 'rb', 're', 'rc'];
const BJT_OPT_KEYS = ['vaf', 'ikf'];

function genericBjtParams(): ParamDef[] {
  return [
    numParam('bf', 'Forward beta BF', '100', '', { group: 'model', showOnSchematic: true, min: 0 }),
    numParam('is', 'Saturation current IS', '10f', 'A', { group: 'model', min: 0 }),
    numParam('br', 'Reverse beta BR', '1', '', { group: 'model', min: 0 }),
    numParam('vaf', 'Early voltage VAF', '100', 'V', { group: 'model', help: 'Blank = infinite' }),
    numParam('ikf', 'High-injection knee IKF', '', 'A', { group: 'model', help: 'Blank = infinite' }),
    numParam('cje', 'B-E capacitance CJE', '10p', 'F', { group: 'model', min: 0 }),
    numParam('cjc', 'B-C capacitance CJC', '5p', 'F', { group: 'model', min: 0 }),
    numParam('tf', 'Forward transit time TF', '0.5n', 's', { group: 'model', min: 0 }),
    numParam('tr', 'Reverse transit time TR', '50n', 's', { group: 'model', min: 0 }),
    numParam('rb', 'Base resistance RB', '10', 'Ω', { group: 'model', min: 0 }),
    numParam('re', 'Emitter resistance RE', '0', 'Ω', { group: 'model', min: 0 }),
    numParam('rc', 'Collector resistance RC', '1', 'Ω', { group: 'model', min: 0 }),
    modelNameParam(),
  ];
}

function genericBjt(pnp: boolean): LibraryPartDef {
  const params = genericBjtParams();
  const base = pnp ? 'MS_QPGEN' : 'MS_QNGEN';
  const defaults = Object.fromEntries(Object.entries(defaultNums(params, [...BJT_KEYS, ...BJT_OPT_KEYS])).filter(([, v]) => Number.isFinite(v)));
  return {
    id: `transistors/${pnp ? 'pnp' : 'npn'}`,
    name: pnp ? 'PNP Transistor' : 'NPN Transistor',
    group: 'transistors',
    family: pnp ? 'PNP BJT' : 'NPN BJT',
    description: `Generic ${pnp ? 'PNP' : 'NPN'} bipolar transistor with editable Gummel-Poon parameters`,
    prefix: 'Q',
    symbol: bjtSymbol(pnp),
    params,
    toSpice: (ctx) => {
      const override = (ctx.params.model ?? '').trim();
      const q = (m: string) => elQ(ctx.name('Q'), ctx.node('C'), ctx.node('B'), ctx.node('E'), m);
      if (override) return { elements: [q(override)] };
      const vals: Record<string, number> = {};
      for (const k of BJT_KEYS) vals[k] = ctx.num(k);
      for (const k of BJT_OPT_KEYS) {
        const v = optNum(ctx, k);
        if (v !== undefined) vals[k] = v;
      }
      const name = paramModelName(base, vals, defaults);
      return { elements: [q(name)], models: [card(name, pnp ? 'PNP' : 'NPN', vals)] };
    },
    provenance: 'SPICE Gummel-Poon BJT with textbook defaults (β = 100, VAF = 100 V)',
    footprint: 'TO-92',
    keywords: ['bjt', 'transistor', pnp ? 'pnp' : 'npn', 'generic'],
  };
}

// Darlingtons --------------------------------------------------------------------------

function darlington(pn: string, pnp: boolean, description: string): LibraryPartDef {
  const t = pnp ? 'PNP' : 'NPN';
  const drv = powerBjt(`MS_${pn}_DRV`, pnp, { is: 5e-14, bf: 150, ikf: 0.5, ise: 1e-13, cje: 50e-12, cjc: 20e-12, tf: 5e-9, tr: 200e-9, rb: 5, re: 0.2, rc: 0.5 });
  const out = powerBjt(`MS_${pn}_OUT`, pnp, { is: 1e-12, bf: 60, ikf: 3, ise: 1e-11, cje: 300e-12, cjc: 150e-12, tf: 40e-9, tr: 1e-6, rb: 1, re: 0.02, rc: 0.05 });
  const fw = card(`MS_${pn}_FW`, 'D', { is: 1e-12, n: 1, rs: 0.05, bv: 60, ibv: 1e-6, tt: 100e-9, cjo: 100e-12 });
  const sub = subckt(
    `MS_${pn}`,
    ['c', 'b', 'e'],
    [
      elQ('Q1', 'c', 'b', 'm', drv.name),
      elQ('Q2', 'c', 'm', 'e', out.name),
      elR('R1', 'b', 'm', 8000),
      elR('R2', 'm', 'e', 120),
      pnp ? elD('DFW', 'c', 'e', fw.name) : elD('DFW', 'e', 'c', fw.name),
    ],
    [drv, out, fw],
  );
  return {
    id: `transistors/${pn.toLowerCase()}`,
    name: pn,
    group: 'transistors',
    family: `${t} Darlington`,
    description,
    prefix: 'Q',
    symbol: bjtSymbol(pnp, { darlington: true }),
    params: [],
    toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('C'), ctx.node('B'), ctx.node('E')], sub.name)], subckts: [sub] }),
    provenance: `MachSim Darlington subcircuit (driver + output transistor, 8 kΩ / 120 Ω base-emitter resistors, freewheel diode) fitted to the ${pn} datasheet: hFE ≥ 1000 @ 3 A, VCE(sat) ≈ 2 V`,
    footprint: 'TO-220',
    keywords: [pn.toLowerCase(), 'darlington', 'power', t.toLowerCase()],
  };
}

const darlingtons = [
  darlington('TIP120', false, 'NPN power Darlington, 60 V / 5 A, hFE ≥ 1000'),
  darlington('TIP125', true, 'PNP power Darlington, 60 V / 5 A, hFE ≥ 1000'),
];

// ---------------------------------------------------------------------------
// JFETs
// ---------------------------------------------------------------------------

function jfetPart(id: string, name: string, pch: boolean, description: string, model: ModelCard | null, provenance: string, params: ParamDef[] = [], keywords: string[] = []): LibraryPartDef {
  return {
    id: `transistors/${id}`,
    name,
    group: 'transistors',
    family: pch ? 'P-channel JFET' : 'N-channel JFET',
    description,
    prefix: 'Q',
    symbol: jfetSymbol(pch),
    params: [...params, modelNameParam()],
    toSpice: (ctx) => {
      const override = (ctx.params.model ?? '').trim();
      const j = (m: string) => elJ(ctx.name('J'), ctx.node('D'), ctx.node('G'), ctx.node('S'), m);
      if (override) return { elements: [j(override)] };
      const m = model ?? genericJfetModel(ctx, pch, params);
      return { elements: [j(m.name)], models: [m] };
    },
    provenance,
    footprint: 'TO-92',
    keywords: ['jfet', 'fet', pch ? 'p-channel' : 'n-channel', ...keywords],
  };
}

const JFET_KEYS = ['vto', 'beta', 'lambda', 'cgs', 'cgd', 'is'];

function jfetParams(): ParamDef[] {
  return [
    numParam('vto', 'Pinch-off voltage VTO', '-2', 'V', { group: 'model', showOnSchematic: true }),
    numParam('beta', 'Transconductance BETA', '1m', 'A/V²', { group: 'model', min: 0 }),
    numParam('lambda', 'Channel-length modulation', '0', '1/V', { group: 'model', min: 0 }),
    numParam('cgs', 'G-S capacitance CGS', '2p', 'F', { group: 'model', min: 0 }),
    numParam('cgd', 'G-D capacitance CGD', '1p', 'F', { group: 'model', min: 0 }),
    numParam('is', 'Gate saturation current IS', '10f', 'A', { group: 'model', min: 0 }),
  ];
}

function genericJfetModel(ctx: ToSpiceContext, pch: boolean, params: ParamDef[]): ModelCard {
  const vals: Record<string, number> = {};
  for (const k of JFET_KEYS) vals[k] = ctx.num(k);
  const name = paramModelName(pch ? 'MS_JPGEN' : 'MS_JNGEN', vals, defaultNums(params, JFET_KEYS));
  return card(name, pch ? 'PJF' : 'NJF', vals);
}

const jfets: LibraryPartDef[] = [
  jfetPart('njfet', 'N-Channel JFET', false, 'Generic N-channel JFET (Shichman-Hodges) with editable parameters', null, 'SPICE JFET with IDSS = BETA·VTO² = 4 mA by default', jfetParams(), ['generic']),
  jfetPart('pjfet', 'P-Channel JFET', true, 'Generic P-channel JFET (Shichman-Hodges) with editable parameters', null, 'SPICE JFET with IDSS = BETA·VTO² = 4 mA by default', jfetParams(), ['generic']),
  jfetPart(
    '2n5457',
    '2N5457',
    false,
    'N-channel JFET, IDSS 1-5 mA, VGS(off) -0.5 to -6 V',
    card('MS_2N5457', 'NJF', { vto: -1.372, beta: 1.125e-3, lambda: 2.3e-3, rd: 1, rs: 1, is: 33.57e-15, cgd: 1.6e-12, cgs: 2.414e-12, pb: 1, fc: 0.5, b: 1 }),
    'Parameters following the manufacturer-published (onsemi) 2N5457 SPICE model',
  ),
  jfetPart(
    'j310',
    'J310',
    false,
    'N-channel VHF/UHF JFET, IDSS 24-60 mA',
    card('MS_J310', 'NJF', { vto: -3, beta: 4.4e-3, lambda: 0.02, rd: 1, rs: 1, is: 1e-14, cgd: 2.5e-12, cgs: 3e-12, pb: 1, fc: 0.5 }),
    'MachSim fit to J310 datasheet: IDSS ≈ 40 mA, VGS(off) ≈ -3 V, Ciss 5 pF, Crss 2.5 pF',
    [],
    ['rf', 'vhf'],
  ),
  jfetPart(
    '2n5460',
    '2N5460',
    true,
    'P-channel general-purpose JFET, IDSS 1-5 mA',
    card('MS_2N5460', 'PJF', { vto: -2, beta: 0.75e-3, lambda: 0.01, rd: 2, rs: 2, is: 1e-14, cgd: 2e-12, cgs: 5e-12, pb: 1, fc: 0.5 }),
    'MachSim fit to 2N5460 datasheet: IDSS ≈ 3 mA, VGS(off) ≈ 2 V, Ciss 7 pF, Crss 2 pF',
  ),
];

// ---------------------------------------------------------------------------
// MOSFETs
// ---------------------------------------------------------------------------

export interface MosFit {
  pn: string;
  pch: boolean;
  description: string;
  /** threshold magnitude, V */
  vth: number;
  /** RDS(on) at |VGS| = vgsOn */
  rdson: number;
  vgsOn: number;
  ciss: number;
  crss: number;
  lambda: number;
  /** body diode */
  bvdss: number;
  diodeIs: number;
  coss: number;
  footprint: string;
}

/** Level-1 model from a datasheet fit: KP·(|VGS| - Vth) = 1 / RDS(on) (deep triode, W/L = 1). */
export function mosfetFitModel(f: MosFit): { mos: ModelCard; diode: ModelCard } {
  const kp = 1 / (f.rdson * (f.vgsOn - f.vth));
  const mos = card(`MS_${f.pn}`, f.pch ? 'PMOS' : 'NMOS', {
    level: 1,
    vto: f.pch ? -f.vth : f.vth,
    kp,
    lambda: f.lambda,
    cgso: (f.ciss - f.crss) / W,
    cgdo: f.crss / W,
    is: 1e-15,
  });
  const diode = card(`MS_${f.pn}_BD`, 'D', { is: f.diodeIs, n: 1, rs: 0.01, cjo: Math.max(1e-12, f.coss - f.crss), vj: 0.7, m: 0.4, tt: 50e-9, bv: f.bvdss, ibv: 10e-6 });
  return { mos, diode };
}

function fittedMosfet(f: MosFit): LibraryPartDef {
  const { mos, diode } = mosfetFitModel(f);
  return {
    id: `transistors/${f.pn.toLowerCase()}`,
    name: f.pn,
    group: 'transistors',
    family: f.pch ? 'P-channel MOSFET' : 'N-channel MOSFET',
    description: f.description,
    prefix: 'Q',
    symbol: mosfetSymbol(f.pch, { bodyDiode: true }),
    params: [modelNameParam()],
    toSpice: (ctx) => {
      const m = modelOverride(ctx, mos.name);
      const d = ctx.node('D');
      const s = ctx.node('S');
      return {
        elements: [
          elM(ctx.name('M'), d, ctx.node('G'), s, s, m, { w: W, l: L }),
          f.pch ? elD(ctx.name('D', 'body'), d, s, diode.name) : elD(ctx.name('D', 'body'), s, d, diode.name),
        ],
        models: m === mos.name ? [mos, diode] : [diode],
      };
    },
    provenance: `MachSim level-1 fit to the ${f.pn} datasheet: |VGS(th)| ≈ ${f.vth} V, RDS(on) ≈ ${f.rdson} Ω @ |VGS| = ${f.vgsOn} V, Ciss ${f.ciss * 1e12} pF, Crss ${f.crss * 1e12} pF, V(BR)DSS ${f.bvdss} V (approximation)`,
    footprint: f.footprint,
    keywords: [f.pn.toLowerCase(), 'mosfet', 'fet', f.pch ? 'p-channel' : 'n-channel', 'enhancement'],
  };
}

const MOS_FITS: MosFit[] = [
  { pn: '2N7000', pch: false, description: 'N-channel enhancement MOSFET, 60 V / 200 mA', vth: 2.1, rdson: 1.2, vgsOn: 10, ciss: 20e-12, crss: 5e-12, lambda: 0.01, bvdss: 60, diodeIs: 1e-14, coss: 11e-12, footprint: 'TO-92' },
  { pn: 'BS170', pch: false, description: 'N-channel enhancement MOSFET, 60 V / 500 mA', vth: 2.1, rdson: 1.2, vgsOn: 10, ciss: 24e-12, crss: 5e-12, lambda: 0.01, bvdss: 60, diodeIs: 1e-14, coss: 17e-12, footprint: 'TO-92' },
  { pn: 'IRF540N', pch: false, description: 'N-channel power MOSFET, 100 V / 33 A, 44 mΩ', vth: 3, rdson: 0.04, vgsOn: 10, ciss: 1960e-12, crss: 40e-12, lambda: 0.005, bvdss: 100, diodeIs: 5.8e-12, coss: 250e-12, footprint: 'TO-220' },
  { pn: 'IRF9540N', pch: true, description: 'P-channel power MOSFET, -100 V / -23 A, 117 mΩ', vth: 3, rdson: 0.1, vgsOn: 10, ciss: 1300e-12, crss: 240e-12, lambda: 0.005, bvdss: 100, diodeIs: 5e-12, coss: 400e-12, footprint: 'TO-220' },
  { pn: 'IRFZ44N', pch: false, description: 'N-channel power MOSFET, 55 V / 49 A, 17.5 mΩ', vth: 3, rdson: 0.015, vgsOn: 10, ciss: 1470e-12, crss: 88e-12, lambda: 0.005, bvdss: 55, diodeIs: 1e-11, coss: 360e-12, footprint: 'TO-220' },
  { pn: 'BSS138', pch: false, description: 'N-channel logic-level MOSFET, 50 V / 200 mA (SOT-23)', vth: 1.3, rdson: 1.0, vgsOn: 10, ciss: 27e-12, crss: 6e-12, lambda: 0.01, bvdss: 50, diodeIs: 1e-14, coss: 13e-12, footprint: 'SOT-23' },
  { pn: 'BSS84', pch: true, description: 'P-channel MOSFET, -50 V / -130 mA (SOT-23)', vth: 1.7, rdson: 6, vgsOn: 5, ciss: 30e-12, crss: 10e-12, lambda: 0.01, bvdss: 50, diodeIs: 1e-14, coss: 20e-12, footprint: 'SOT-23' },
];

// Generic MOSFETs -----------------------------------------------------------------------

const MOS_KEYS = ['vto', 'kp', 'lambda', 'cgso', 'cgdo', 'gamma'];

function genericMosParams(pch: boolean): ParamDef[] {
  return [
    numParam('vto', 'Threshold voltage VTO', pch ? '-2' : '2', 'V', { group: 'model', showOnSchematic: true }),
    numParam('kp', 'Transconductance KP', '20m', 'A/V²', { group: 'model', min: 0 }),
    numParam('lambda', 'Channel-length modulation', '0.01', '1/V', { group: 'model', min: 0 }),
    numParam('gamma', 'Body-effect GAMMA', '0', '√V', { group: 'model', min: 0 }),
    numParam('cgso', 'G-S overlap capacitance', '0', 'F/m', { group: 'model', min: 0 }),
    numParam('cgdo', 'G-D overlap capacitance', '0', 'F/m', { group: 'model', min: 0 }),
    numParam('w', 'Channel width W', '100u', 'm', { group: 'advanced', min: 0 }),
    numParam('l', 'Channel length L', '100u', 'm', { group: 'advanced', min: 0 }),
    modelNameParam(),
  ];
}

function genericMosfet(pch: boolean, four: boolean): LibraryPartDef {
  const params = genericMosParams(pch);
  const defaults = defaultNums(params, MOS_KEYS);
  const t = pch ? 'P' : 'N';
  return {
    id: `transistors/${pch ? 'pmos' : 'nmos'}${four ? '-4t' : ''}`,
    name: `${t}MOS ${four ? '(4-terminal)' : '(3-terminal)'}`,
    group: 'transistors',
    family: pch ? 'P-channel MOSFET' : 'N-channel MOSFET',
    description: `Generic ${t}-channel enhancement MOSFET (SPICE level 1)${four ? ' with a separate bulk terminal' : ', bulk tied to source'}`,
    prefix: 'Q',
    symbol: mosfetSymbol(pch, { fourTerminal: four }) as SymbolDef,
    params,
    toSpice: (ctx) => {
      const s = ctx.node('S');
      const b = four ? ctx.node('B') : s;
      const inst = { w: ctx.num('w'), l: ctx.num('l') };
      if (!(inst.w > 0 && inst.l > 0)) throw new Error('bad value for w/l: must be > 0');
      const mm = (m: string) => elM(ctx.name('M'), ctx.node('D'), ctx.node('G'), s, b, m, inst);
      const override = (ctx.params.model ?? '').trim();
      if (override) return { elements: [mm(override)] };
      const vals: Record<string, number> = {};
      for (const k of MOS_KEYS) vals[k] = ctx.num(k);
      const name = paramModelName(pch ? 'MS_MPGEN' : 'MS_MNGEN', vals, defaults);
      return { elements: [mm(name)], models: [card(name, pch ? 'PMOS' : 'NMOS', { level: 1, ...vals })] };
    },
    provenance: 'SPICE level-1 (Shichman-Hodges) MOSFET; KP·W/L = 20 mA/V² by default',
    footprint: four ? 'SOT-143' : 'TO-92',
    keywords: ['mosfet', 'fet', pch ? 'pmos' : 'nmos', 'generic', four ? '4 terminal' : '3 terminal'],
  };
}

export const TRANSISTOR_PARTS: LibraryPartDef[] = [
  genericBjt(false),
  genericBjt(true),
  ...realBjts,
  ...darlingtons,
  ...jfets,
  genericMosfet(false, false),
  genericMosfet(true, false),
  genericMosfet(false, true),
  genericMosfet(true, true),
  ...MOS_FITS.map(fittedMosfet),
];
