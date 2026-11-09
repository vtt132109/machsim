/**
 * Thyristor catalogue (group Diodes): SCRs, TRIACs, DIACs, Shockley diodes / SIDACs and a GTO.
 *
 * Models (MachSim behavioural subcircuits from the textbook two-transistor thyristor):
 *   SCR      PNP (βF = 2) + NPN (βF = 50) latch, gate-cathode resistor RGK = 0.62 V / IGT so
 *            the part fires at the datasheet gate current, a breakover diode across the centre
 *            junction (BV = 1.2·VDRM: the part also fires when the forward voltage is too high),
 *            and an anode resistance giving the on-state voltage VTM at 1.4·IT(rms).
 *   TRIAC    two antiparallel SCR structures; the gate looks like a junction of either polarity
 *            and |IG| is injected into the gate of both structures, so any gate current above
 *            IGT fires the TRIAC in both directions (quadrants I–IV alike).
 *   DIAC     two antiparallel branches of a small Shockley structure (ΔV + 1 V) in series with
 *            a Zener: breakover at ±VBO, folding back by about ΔV once it conducts.
 *   Shockley four-layer diode / SIDAC: the SCR structure triggered only by its breakover diode.
 *   GTO      SCR structure with a low-gain PNP (α sum just above 1): a negative gate current of
 *            about IT / 5 turns it off.
 */
import type { ElementIR, ModelCard, SubcktDef } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import { card, elB, elD, elQ, elR, elSense, elX, numParam, defaultNums, paramModelName, subckt, type LibraryPartDef } from '../partkit';
import { diodeBody, line, makeSymbol, pin, poly, twoPinH } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';
import { eng, modelName, slug, withMeta } from './kit';

const n = (s: string, pn: string): number => {
  const v = parseUserNumber(s);
  if (!Number.isFinite(v)) throw new Error(`bad thyristor value '${s}' in ${pn}`);
  return v;
};

interface ScrSpec {
  vdrm: number;
  it: number;
  igt: number;
  vtm: number;
  /** PNP / NPN current gains */
  bp?: number;
  bn?: number;
  /** no gate terminal (Shockley / SIDAC): breakover only */
  breakover?: number;
}

/** Elements of one SCR structure between a and k with gate node g (prefix keeps names unique). */
function scrElements(p: string, a: string, k: string, g: string, s: ScrSpec, models: { qp: string; qn: string; dbo: string }): ElementIR[] {
  const ra = Math.max(1e-3, (s.vtm - 1.0) / (1.4 * s.it));
  const ai = `${p}ai`;
  const nb = `${p}nb`;
  return [
    elR(`R${p}A`, a, ai, ra),
    // OFF: the operating point starts from the blocking state (a thyristor powers up off)
    elQ(`Q${p}P`, g, nb, ai, models.qp, { off: 1 }),
    elQ(`Q${p}N`, nb, g, k, models.qn, { off: 1 }),
    elR(`R${p}GK`, g, k, 0.62 / s.igt),
    elD(`D${p}BO`, g, nb, models.dbo),
  ];
}

function scrModels(name: string, s: ScrSpec): { cards: ModelCard[]; names: { qp: string; qn: string; dbo: string } } {
  const is = 1e-14 * Math.max(0.1, s.it);
  const qp = card(`${name}_P`, 'PNP', { is, bf: s.bp ?? 2, br: 0.5, cje: 20e-12 * Math.sqrt(s.it), cjc: 20e-12 * Math.sqrt(s.it), tf: 50e-9, tr: 1e-6 });
  const qn = card(`${name}_N`, 'NPN', { is, bf: s.bn ?? 50, br: 0.5, cje: 20e-12 * Math.sqrt(s.it), cjc: 10e-12 * Math.sqrt(s.it), tf: 20e-9, tr: 1e-6 });
  const dbo = card(`${name}_BO`, 'D', { is: 1e-18, n: 1, bv: s.breakover ?? 1.2 * s.vdrm, ibv: 1e-6, rs: 10 });
  return { cards: [qp, qn, dbo], names: { qp: qp.name, qn: qn.name, dbo: dbo.name } };
}

function scrSubckt(name: string, s: ScrSpec): SubcktDef {
  const m = scrModels(name, s);
  return subckt(name, ['a', 'k', 'g'], scrElements('1', 'a', 'k', 'g', s, m.names), m.cards);
}

const SCR_SYMBOL: SymbolDef = makeSymbol(
  [...diodeBody(), line(-30, 0, -20, 0), line(20, 0, 30, 0), line(6, 4, 10, 10), line(10, 10, 10, 20)],
  [pin('A', -30, 0, 'left', { number: '1' }), pin('K', 30, 0, 'right', { number: '2' }), pin('G', 10, 20, 'down', { number: '3', type: 'input' })],
  { refPos: { x: 0, y: -14 }, valuePos: { x: -12, y: 22 } },
);

const GTO_SYMBOL: SymbolDef = makeSymbol(
  [...diodeBody(), line(-30, 0, -20, 0), line(20, 0, 30, 0), line(6, 4, 10, 10), line(10, 10, 10, 20), line(13, 8, 13, 14)],
  [pin('A', -30, 0, 'left', { number: '1' }), pin('K', 30, 0, 'right', { number: '2' }), pin('G', 10, 20, 'down', { number: '3', type: 'input' })],
  { refPos: { x: 0, y: -14 }, valuePos: { x: -12, y: 22 } },
);

const TRIAC_SYMBOL: SymbolDef = makeSymbol(
  [line(-30, 0, -8, 0), line(8, 0, 30, 0), line(-8, -12, -8, 12), line(8, -12, 8, 12), poly([-8, -12, -8, 0, 8, -6], true), poly([8, 0, 8, 12, -8, 6], true), line(8, 6, 10, 10), line(10, 10, 10, 20)],
  [pin('MT2', -30, 0, 'left', { number: '2' }), pin('MT1', 30, 0, 'right', { number: '1' }), pin('G', 10, 20, 'down', { number: '3', type: 'input' })],
  { refPos: { x: 0, y: -18 }, valuePos: { x: -14, y: 24 } },
);

const DIAC_SYMBOL: SymbolDef = twoPinH([line(-20, 0, -8, 0), line(8, 0, 20, 0), line(-8, -12, -8, 12), line(8, -12, 8, 12), poly([-8, -12, -8, 0, 8, -6], true), poly([8, 0, 8, 12, -8, 6], true)], { names: ['A1', 'A2'] });

const SHOCKLEY_SYMBOL: SymbolDef = twoPinH([...diodeBody(), line(8, 8, 4, 12)], { names: ['A', 'K'] });

// ---------------------------------------------------------------------------------------------
// SCRs: "pn VDRM IT(rms) IGT VTM package"

const SCR_TEXT = [
  ...['2N5060 30', '2N5061 60', '2N5062 100', '2N5063 150', '2N5064 200'].map((s) => `${s} 0.8 200u 1.7 TO-92`),
  ...['MCR100-3 100', 'MCR100-4 200', 'MCR100-6 400', 'MCR100-8 600'].map((s) => `${s} 0.8 200u 1.7 TO-92`),
  ...['C106B 200', 'C106D 400', 'C106M 600'].map((s) => `${s} 4 200u 2.2 TO-126`),
  'TIC106D 400 5 60u 1.7 TO-220',
  'TIC116D 400 8 5m 1.7 TO-220',
  'TIC126D 400 12 5m 1.6 TO-220',
  ...['BT151-500R 500', 'BT151-650R 650', 'BT151-800R 800'].map((s) => `${s} 12 2m 1.75 TO-220`),
  ...['BT152-400R 400', 'BT152-600R 600', 'BT152-800R 800'].map((s) => `${s} 20 3m 1.6 TO-220`),
  'TYN608 600 8 5m 1.6 TO-220',
  'TYN612 600 12 5m 1.6 TO-220',
  'TYN1012 1000 12 5m 1.6 TO-220',
  ...['2N6504 50', '2N6505 100', '2N6506 200', '2N6507 400', '2N6508 600', '2N6509 800'].map((s) => `${s} 25 9m 1.8 TO-220`),
];

const scrs: LibraryPartDef[] = SCR_TEXT.map((t) => {
  const [pn, vS, itS, igtS, vtmS, pkg] = t.split(/\s+/);
  const s: ScrSpec = { vdrm: n(vS, pn), it: n(itS, pn), igt: n(igtS, pn), vtm: n(vtmS, pn) };
  const sub = scrSubckt(modelName(pn), s);
  const tail = `${s.vdrm} V / ${eng(s.it, 'A')} RMS, IGT ≈ ${eng(s.igt, 'A')}, VTM ≈ ${s.vtm} V`;
  return withMeta(
    {
      id: `diodes/${slug(pn)}`,
      name: pn,
      group: 'diodes',
      family: 'Thyristor',
      description: `Silicon controlled rectifier (SCR), ${tail}`,
      prefix: 'D',
      symbol: SCR_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('A'), ctx.node('K'), ctx.node('G')], sub.name)], subckts: [sub] }),
      provenance: `MachSim two-transistor SCR (RGK = 0.62 V / IGT, breakover at 1.2·VDRM) fitted to the ${pn} datasheet: ${tail}`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'scr', 'thyristor', 'phase control'],
    },
    { vi: `Thyristor (SCR), ${tail}`, specs: { vdrm: s.vdrm, irating: s.it, igt: s.igt, package: pkg }, sortKey: s.it * 1e4 + s.vdrm, series: 'SCR' },
  );
});

// ---------------------------------------------------------------------------------------------
// TRIACs: "pn VDRM IT(rms) IGT package"

const TRIAC_TEXT = [
  'BT136-500 500 4 10m TO-220',
  'BT136-600 600 4 10m TO-220',
  'BT136-800 800 4 10m TO-220',
  'BT137-600 600 8 10m TO-220',
  'BT138-600 600 12 10m TO-220',
  'BT139-600 600 16 10m TO-220',
  'BTA08-600B 600 8 50m TO-220',
  'BTA12-600B 600 12 50m TO-220',
  'BTA16-600B 600 16 50m TO-220',
  'BTA24-600B 600 25 50m TO-220',
  'BTA41-600B 600 40 50m TOP-3',
  'BTB16-600B 600 16 50m TO-220',
  'MAC97A6 400 0.6 5m TO-92',
  'MAC97A8 600 0.6 5m TO-92',
  'Z0103MA 600 1 3m TO-92',
  'Z0607MA 600 0.8 5m TO-92',
  'TIC206D 400 4 5m TO-220',
  'TIC226D 400 8 50m TO-220',
  'TIC246D 400 16 50m TO-220',
  '2N6071A 200 4 5m TO-126',
  '2N6073A 400 4 5m TO-126',
];

const triacs: LibraryPartDef[] = TRIAC_TEXT.map((t) => {
  const [pn, vS, itS, igtS, pkg] = t.split(/\s+/);
  const s: ScrSpec = { vdrm: n(vS, pn), it: n(itS, pn), igt: n(igtS, pn), vtm: 1.55 };
  const name = modelName(pn);
  const m = scrModels(name, s);
  const dg = card(`${name}_G`, 'D', { is: 1e-12, n: 1.5, rs: 10 });
  const sense = 'VG';
  const absIg = `(sqrt(I(${sense})*I(${sense})+1e-12)-1e-6)`;
  const els: ElementIR[] = [
    elSense(sense, 'g', 'gi'),
    elD('DG1', 'gi', 'mt1', dg.name),
    elD('DG2', 'mt1', 'gi', dg.name),
    ...scrElements('1', 'mt2', 'mt1', 'g1', s, m.names),
    ...scrElements('2', 'mt1', 'mt2', 'g2', s, m.names),
    elB('BG1', 'mt1', 'g1', 'I', absIg),
    elB('BG2', 'mt2', 'g2', 'I', absIg),
  ];
  const sub = subckt(name, ['mt2', 'mt1', 'g'], els, [...m.cards, dg]);
  const tail = `${s.vdrm} V / ${eng(s.it, 'A')} RMS, IGT ≈ ${eng(s.igt, 'A')}`;
  return withMeta(
    {
      id: `diodes/${slug(pn)}`,
      name: pn,
      group: 'diodes',
      family: 'TRIAC',
      description: `TRIAC (bidirectional thyristor for AC switching), ${tail}`,
      prefix: 'D',
      symbol: TRIAC_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('MT2'), ctx.node('MT1'), ctx.node('G')], sub.name)], subckts: [sub] }),
      provenance: `MachSim TRIAC (two antiparallel SCR structures fired by |IG|) fitted to the ${pn} datasheet: ${tail}`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'triac', 'ac switch', 'dimmer', 'phase control'],
    },
    { vi: `TRIAC (thyristor hai chiều để đóng cắt điện xoay chiều), ${tail}`, specs: { vdrm: s.vdrm, irating: s.it, igt: s.igt, package: pkg }, sortKey: s.it * 1e4 + s.vdrm, series: 'TRIAC' },
  );
});

// ---------------------------------------------------------------------------------------------
// DIACs, Shockley diodes / SIDACs, GTO

function diacSubckt(name: string, vbo: number, dv: number): SubcktDef {
  const s: ScrSpec = { vdrm: dv, it: 1, igt: 1e-3, vtm: 2, breakover: dv + 1 };
  const m = scrModels(name, s);
  const z = card(`${name}_Z`, 'D', { is: 1e-14, n: 1, bv: Math.max(1, vbo - dv - 1.6), ibv: 1e-6, rs: 5 });
  return subckt(
    name,
    ['a1', 'a2'],
    [...scrElements('1', 'a1', 'm1', 'g1', s, m.names), elD('DZ1', 'a2', 'm1', z.name), ...scrElements('2', 'a2', 'm2', 'g2', s, m.names), elD('DZ2', 'a1', 'm2', z.name)],
    [...m.cards, z],
  );
}

const DIAC_ROWS: [string, number, number][] = [
  ['DB3', 32, 6],
  ['DB4', 40, 6],
  ['DB6', 63, 8],
  ['BR100', 32, 6],
];

const diacParams: ParamDef[] = [numParam('vbo', 'Breakover voltage', '32', 'V', { showOnSchematic: true, min: 2 }), numParam('dv', 'Fold-back voltage', '6', 'V', { min: 1 })];

const diacs: LibraryPartDef[] = [
  withMeta(
    {
      id: 'diodes/diac',
      name: 'DIAC',
      group: 'diodes',
      family: 'DIAC',
      description: 'Bidirectional trigger diode: blocks until |V| reaches the breakover voltage, then conducts and folds back by ΔV',
      prefix: 'D',
      symbol: DIAC_SYMBOL,
      params: diacParams,
      toSpice: (ctx: ToSpiceContext) => {
        const vbo = ctx.num('vbo');
        const dv = ctx.num('dv');
        if (!(vbo > dv + 2)) throw new Error('bad value for vbo: breakover must exceed the fold-back voltage by 2 V');
        const sub = diacSubckt(paramModelName('MS_DIAC', { vbo, dv }, defaultNums(diacParams, ['vbo', 'dv'])), vbo, dv);
        return { elements: [elX(ctx.name('X'), [ctx.node('A1'), ctx.node('A2')], sub.name)], subckts: [sub] };
      },
      provenance: 'MachSim DIAC: two antiparallel (Shockley + Zener) branches with editable breakover and fold-back',
      footprint: 'DO-35',
      keywords: ['diac', 'trigger diode', 'phase control', 'dimmer'],
    },
    { vi: 'Diode kích hai chiều: chặn cho đến khi |V| đạt điện áp đánh thủng, sau đó dẫn và điện áp giảm đi ΔV', nameVi: 'DIAC' },
  ),
  ...DIAC_ROWS.map(([pn, vbo, dv]) => {
    const sub = diacSubckt(modelName(pn), vbo, dv);
    return withMeta(
      {
        id: `diodes/${slug(pn)}`,
        name: pn,
        group: 'diodes',
        family: 'DIAC',
        description: `Bidirectional trigger diode, VBO ≈ ±${vbo} V, fold-back ΔV ≈ ${dv} V`,
        prefix: 'D',
        symbol: DIAC_SYMBOL,
        params: [],
        toSpice: (ctx: ToSpiceContext) => ({ elements: [elX(ctx.name('X'), [ctx.node('A1'), ctx.node('A2')], sub.name)], subckts: [sub] }),
        provenance: `MachSim DIAC fitted to the ${pn} datasheet: breakover ±${vbo} V, ΔV ≥ ${dv - 1} V`,
        footprint: 'DO-35',
        keywords: [pn.toLowerCase(), 'diac', 'trigger diode'],
      },
      { vi: `Diode kích hai chiều, VBO ≈ ±${vbo} V, điện áp giảm ΔV ≈ ${dv} V`, specs: { vbr: vbo, package: 'DO-35' }, sortKey: vbo, series: 'DIAC' },
    );
  }),
];

function shockleySubckt(name: string, vbo: number, it: number): SubcktDef {
  const s: ScrSpec = { vdrm: vbo, it, igt: 5e-3, vtm: 1.5, breakover: vbo - 0.6 };
  const m = scrModels(name, s);
  return subckt(name, ['a', 'k'], scrElements('1', 'a', 'k', 'g', s, m.names), m.cards);
}

const shockleyParams: ParamDef[] = [numParam('vbo', 'Breakover voltage', '20', 'V', { showOnSchematic: true, min: 1 })];

const SIDACS: [string, number][] = [
  ['K1050G', 108],
  ['K1200G', 120],
  ['K2200G', 220],
  ['K2500G', 250],
];

const shockleys: LibraryPartDef[] = [
  withMeta(
    {
      id: 'diodes/shockley',
      name: 'Shockley Diode',
      group: 'diodes',
      family: 'Shockley diode',
      description: 'Four-layer (Shockley) diode: blocks until the breakover voltage, then latches on until the current falls below the holding current',
      prefix: 'D',
      symbol: SHOCKLEY_SYMBOL,
      params: shockleyParams,
      toSpice: (ctx: ToSpiceContext) => {
        const vbo = ctx.num('vbo');
        if (!(vbo > 1)) throw new Error('bad value for vbo: must be > 1 V');
        const sub = shockleySubckt(paramModelName('MS_SHOCKLEY', { vbo }, { vbo: 20 }), vbo, 1);
        return { elements: [elX(ctx.name('X'), [ctx.node('A'), ctx.node('K')], sub.name)], subckts: [sub] };
      },
      provenance: 'MachSim four-layer diode: two-transistor latch triggered by a breakover junction',
      footprint: 'DO-35',
      keywords: ['shockley', 'four layer diode', 'trigger', 'breakover'],
    },
    { vi: 'Diode bốn lớp (Shockley): chặn cho đến điện áp đánh thủng rồi tự giữ dẫn cho tới khi dòng nhỏ hơn dòng duy trì', nameVi: 'Diode Shockley' },
  ),
  ...SIDACS.map(([pn, vbo]) => {
    const sub = shockleySubckt(modelName(pn), vbo, 1);
    return withMeta(
      {
        id: `diodes/${slug(pn)}`,
        name: pn,
        group: 'diodes',
        family: 'Shockley diode',
        description: `SIDAC (high-voltage bilateral trigger, one direction modelled), breakover ≈ ${vbo} V, 1 A`,
        prefix: 'D',
        symbol: SHOCKLEY_SYMBOL,
        params: [],
        toSpice: (ctx: ToSpiceContext) => ({ elements: [elX(ctx.name('X'), [ctx.node('A'), ctx.node('K')], sub.name)], subckts: [sub] }),
        provenance: `MachSim four-layer latch fitted to the ${pn} datasheet breakover voltage (≈ ${vbo} V); only the A → K direction is modelled`,
        footprint: 'DO-15',
        keywords: [pn.toLowerCase(), 'sidac', 'trigger', 'igniter'],
      },
      { vi: `SIDAC (linh kiện kích cao áp, mô phỏng một chiều), điện áp đánh thủng ≈ ${vbo} V, 1 A`, specs: { vbr: vbo, package: 'DO-15' }, sortKey: vbo, series: 'SIDAC' },
    );
  }),
];

const gtoSub = scrSubckt('MS_GTO', { vdrm: 600, it: 10, igt: 50e-3, vtm: 2, bp: 0.5, bn: 4 });
const gto: LibraryPartDef = withMeta(
  {
    id: 'diodes/gto',
    name: 'GTO Thyristor',
    group: 'diodes',
    family: 'GTO',
    description: 'Gate turn-off thyristor, 600 V / 10 A: a positive gate pulse turns it on, a negative gate current of about IT / 5 turns it off',
    prefix: 'D',
    symbol: GTO_SYMBOL,
    params: [],
    toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('A'), ctx.node('K'), ctx.node('G')], gtoSub.name)], subckts: [gtoSub] }),
    provenance: 'MachSim two-transistor GTO (PNP βF = 0.5, NPN βF = 4, loop gain just above 1, turn-off gain ≈ 5)',
    footprint: 'TO-247',
    keywords: ['gto', 'gate turn-off', 'thyristor', 'inverter'],
  },
  { vi: 'Thyristor tắt được bằng cực cổng (GTO), 600 V / 10 A: xung cổng dương để mở, dòng cổng âm khoảng IT / 5 để tắt', nameVi: 'Thyristor GTO', specs: { vdrm: 600, irating: 10 } },
);

export const THYRISTOR_CATALOG: LibraryPartDef[] = [...scrs, ...triacs, ...diacs, ...shockleys, gto];
