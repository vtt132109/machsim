/**
 * Non-ideal batteries: state of charge, internal resistance that rises as the battery empties and
 * a discharge curve per chemistry (alkaline, NiMH, Li-ion, lead-acid).
 *
 * Model (MachSim behavioural, textbook "Rint + OCV(SoC)" battery model):
 *   - the state of charge is the voltage of a 1 F node, SoC' = I_in / (3600 · capacity[Ah]), where
 *     I_in is the current flowing INTO the + terminal (negative while the battery delivers power):
 *     a battery of C Ah delivering a constant I runs empty after exactly C·3600 / I seconds. The
 *     initial SoC is set through a 100 MΩ tie to a bias source so that it is valid in the operating
 *     point; charging stops at 100 % (rechargeable chemistries) and primary cells (alkaline)
 *     cannot be charged at all;
 *   - the open-circuit voltage is `cells · table(SoC, …)`, a per-cell discharge curve of the
 *     chemistry, fading to zero over the last 2 % of the charge (the battery is empty);
 *   - the internal resistance is R0·(1 + rise·(1 − SoC)²): it grows as the battery empties, much
 *     more for alkaline cells (rise 3) than for Li-ion (0.8);
 *   - terminal voltage = OCV − R(SoC)·I_out, so a load current sags the voltage by I·R.
 * The state of charge is the internal node V(<refdes>.soc), in 0 … 1.
 *
 * Discharge curves are generic typical shapes read from manufacturers' published discharge graphs
 * (0.2 C – 0.5 C), not a specific cell's data.
 */
import type { ElementIR } from '../../sim/netlist';
import { elB, elC, elR, elSense, elV, ex, internalNode, numParam, selectParam, type LibraryPartDef } from '../partkit';
import { line, makeSymbol, pin, rect, text } from '../symbols';
import type { ToSpiceContext } from '../types';
import { eng, withMeta } from './kit';

export type Chemistry = 'alkaline' | 'nimh' | 'liion' | 'leadacid';

export interface ChemistrySpec {
  /** per-cell open-circuit voltage against the state of charge: [soc, volts] pairs, ascending */
  curve: [number, number][];
  /** how many times larger the internal resistance is at empty than at full charge, minus one */
  rise: number;
  rechargeable: boolean;
  name: string;
  nameVi: string;
}

export const CHEMISTRIES: Record<Chemistry, ChemistrySpec> = {
  alkaline: { curve: [[0, 0.8], [0.05, 1.0], [0.15, 1.12], [0.3, 1.22], [0.5, 1.3], [0.7, 1.38], [0.9, 1.5], [1, 1.6]], rise: 3, rechargeable: false, name: 'Alkaline', nameVi: 'Kiềm (alkaline)' },
  nimh: { curve: [[0, 1.0], [0.03, 1.12], [0.1, 1.2], [0.3, 1.24], [0.7, 1.28], [0.9, 1.34], [1, 1.42]], rise: 1, rechargeable: true, name: 'NiMH', nameVi: 'NiMH' },
  liion: { curve: [[0, 3.0], [0.03, 3.3], [0.1, 3.5], [0.2, 3.6], [0.4, 3.7], [0.6, 3.8], [0.8, 3.98], [0.9, 4.08], [1, 4.2]], rise: 0.8, rechargeable: true, name: 'Li-ion', nameVi: 'Li-ion' },
  leadacid: { curve: [[0, 1.75], [0.1, 1.93], [0.3, 1.98], [0.5, 2.03], [0.7, 2.08], [0.9, 2.12], [1, 2.15]], rise: 1, rechargeable: true, name: 'Lead-acid', nameVi: 'Axit–chì' },
};

/** Per-cell open-circuit voltage at a state of charge (0 … 1), linear between the curve points. */
export function batteryCellVoltage(chem: Chemistry, soc: number): number {
  const c = CHEMISTRIES[chem].curve;
  const x = Math.min(1, Math.max(0, soc));
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][0]) return c[i - 1][1] + ((x - c[i - 1][0]) / (c[i][0] - c[i - 1][0])) * (c[i][1] - c[i - 1][1]);
  }
  return c[c.length - 1][1];
}

/** Internal resistance (Ω) at a state of charge for a full-charge resistance r0. */
export function batteryResistance(chem: Chemistry, r0: number, soc: number): number {
  const x = Math.min(1, Math.max(0, soc));
  return r0 * (1 + CHEMISTRIES[chem].rise * (1 - x) * (1 - x));
}

/** Seconds a battery of `capacityAh` needs to go from `soc0` to empty at a constant discharge current. */
export function batteryRuntime(capacityAh: number, current: number, soc0 = 1): number {
  return (soc0 * capacityAh * 3600) / current;
}

const CHEM_OPTIONS = (Object.keys(CHEMISTRIES) as Chemistry[]).map((c) => [c, CHEMISTRIES[c].name] as [string, string]);

const BATTERY_SYMBOL = (cells: number) =>
  makeSymbol(
    [line(0, -30, 0, -12), line(-12, -12, 12, -12), line(-6, -6, 6, -6), line(-12, 0, 12, 0), line(-6, 6, 6, 6), line(0, 6, 0, 30), text(14, -14, '+', 8, 'start'), text(14, 22, `${cells}×`, 6, 'start'), rect(-16, -18, 32, 30, undefined, 3)],
    [pin('+', 0, -30, 'up', { label: undefined, number: '1' }), pin('-', 0, 30, 'down', { number: '2' })],
    { refPos: { x: 24, y: -6 }, valuePos: { x: 24, y: 12 } },
  );

/** Elements of a battery. Pure of the part: exported for the tests. */
export function batteryElements(ctx: ToSpiceContext, chem: Chemistry, cells: number, capacity: number, r0: number, soc0: number): ElementIR[] {
  const spec = CHEMISTRIES[chem];
  const sense = ctx.name('V', 'sense');
  const mid = internalNode(ctx, 'm');
  const soc = internalNode(ctx, 'soc');
  const bias = internalNode(ctx, 'bias');
  const s = `limit(V(${soc}),0,1)`;
  const table = `table(${s},${spec.curve.map(([x, y]) => `${ex(x)},${ex(y * cells)}`).join(',')})`;
  // the open-circuit voltage fades to zero over the last 2 % of the charge
  const ocv = `${table}*limit(V(${soc})/0.02,0,1)`;
  const r = `${ex(r0)}*(1+${ex(spec.rise)}*(1-${s})*(1-${s}))`;
  // charging: none at all for a primary cell; a rechargeable stops taking charge at 100 %
  const charge = spec.rechargeable ? `limit((1-V(${soc}))/0.01,0,1)` : '0';
  return [
    elSense(sense, ctx.node('+'), mid),
    // V(mid, −) = OCV − R·I_out, with I_out = −I(sense)
    elB(ctx.name('B', 'cell'), mid, ctx.node('-'), 'V', `${ocv}+${r}*I(${sense})`),
    // SoC' = I_in / (3600·C): a current into the 1 F node, only after t = 0 (the operating point
    // keeps the initial charge whatever the load draws)
    elB(ctx.name('B', 'soc'), '0', soc, 'I', `u(time)*if(I(${sense})<0,I(${sense}),I(${sense})*${charge})/${ex(3600 * capacity)}`),
    elC(ctx.name('C', 'soc'), soc, '0', 1),
    // initial charge: a bias source behind 100 MΩ fixes the operating point and leaks negligibly
    elV(ctx.name('V', 'bias'), bias, '0', { dc: soc0 }),
    elR(ctx.name('R', 'bias'), bias, soc, 1e8),
  ];
}

const SOC_HELP = 'Charge left at the start of the simulation, in percent of the capacity';

function batteryParams(chem: Chemistry, cells: number, capacity: string, r0: string) {
  return [
    selectParam('chem', 'Chemistry', chem, CHEM_OPTIONS, { help: 'Sets the discharge curve and how fast the internal resistance rises (alkaline cells cannot be recharged)' }),
    numParam('cells', 'Cells in series', String(cells), '', { min: 1, help: 'A 9 V block is 6 alkaline cells, a 12 V lead-acid battery is 6 cells, a 3S Li-ion pack is 3 cells' }),
    numParam('capacity', 'Capacity', capacity, 'Ah', { min: 0, showOnSchematic: true, help: 'Charge the battery delivers from full to empty at a moderate current' }),
    numParam('soc', 'Initial charge', '100', '%', { min: 0, max: 100, help: SOC_HELP }),
    numParam('r0', 'Internal resistance (full)', r0, 'Ω', { group: 'advanced', min: 0, help: 'Internal resistance of the whole battery when full; it rises as the charge falls' }),
  ];
}

function batteryToSpice(ctx: ToSpiceContext) {
  const chem = (ctx.params.chem ?? 'alkaline') as Chemistry;
  if (!(chem in CHEMISTRIES)) throw new Error('bad value for chem: choose alkaline, nimh, liion or leadacid');
  const cells = ctx.num('cells');
  const capacity = ctx.num('capacity');
  const r0 = ctx.num('r0');
  const soc = ctx.num('soc');
  if (!(cells >= 1)) throw new Error('bad value for cells: must be >= 1');
  if (!(capacity > 0)) throw new Error('bad value for capacity: must be > 0');
  if (!(r0 >= 0)) throw new Error('bad value for r0: must be >= 0');
  if (!(soc >= 0 && soc <= 100)) throw new Error('bad value for soc: must be between 0 and 100');
  return { elements: batteryElements(ctx, chem, Math.round(cells), capacity, r0, soc / 100) };
}

interface Preset {
  slug: string;
  name: string;
  nameVi: string;
  chem: Chemistry;
  cells: number;
  ah: number;
  r0: number;
}

const PRESETS: Preset[] = [
  { slug: 'aaa-alkaline', name: 'Battery AAA Alkaline 1.5 V', nameVi: 'Pin AAA kiềm 1.5 V', chem: 'alkaline', cells: 1, ah: 1.2, r0: 0.25 },
  { slug: 'aa-alkaline', name: 'Battery AA Alkaline 1.5 V', nameVi: 'Pin AA kiềm 1.5 V', chem: 'alkaline', cells: 1, ah: 2.8, r0: 0.15 },
  { slug: 'd-alkaline', name: 'Battery D Alkaline 1.5 V', nameVi: 'Pin D kiềm 1.5 V', chem: 'alkaline', cells: 1, ah: 12, r0: 0.1 },
  { slug: '9v-alkaline', name: 'Battery 9 V Alkaline', nameVi: 'Pin vuông 9 V kiềm', chem: 'alkaline', cells: 6, ah: 0.55, r0: 1.7 },
  { slug: 'aa-nimh', name: 'Battery AA NiMH 1.2 V', nameVi: 'Pin AA NiMH 1.2 V', chem: 'nimh', cells: 1, ah: 2, r0: 0.05 },
  { slug: '18650-liion', name: 'Battery 18650 Li-ion 3.7 V', nameVi: 'Pin 18650 Li-ion 3.7 V', chem: 'liion', cells: 1, ah: 3, r0: 0.05 },
  { slug: '3s-liion', name: 'Battery Li-ion 3S 11.1 V', nameVi: 'Bộ pin Li-ion 3S 11.1 V', chem: 'liion', cells: 3, ah: 2.5, r0: 0.15 },
  { slug: '6v-leadacid', name: 'Battery Lead-Acid 6 V', nameVi: 'Ắc quy axit–chì 6 V', chem: 'leadacid', cells: 3, ah: 4.5, r0: 0.04 },
  { slug: '12v-leadacid', name: 'Battery Lead-Acid 12 V', nameVi: 'Ắc quy axit–chì 12 V', chem: 'leadacid', cells: 6, ah: 7, r0: 0.025 },
];

const nominal = (chem: Chemistry, cells: number) => batteryCellVoltage(chem, 0.5) * cells;

function batteryPart(id: string, name: string, nameVi: string, chem: Chemistry, cells: number, ah: number, r0: number, generic: boolean): LibraryPartDef {
  const spec = CHEMISTRIES[chem];
  const vfull = batteryCellVoltage(chem, 1) * cells;
  return withMeta(
    {
      id,
      name,
      group: 'sources',
      family: 'Batteries',
      description: `${generic ? 'Non-ideal battery' : `${spec.name} battery`}: the state of charge falls with the charge drawn (${ah} Ah delivers 1 A for ${eng(batteryRuntime(ah, 1), 's', 3)}), the internal resistance (${eng(r0, 'Ω', 3)} when full) rises as it empties, and the voltage follows the ${spec.name} discharge curve from ${vfull.toFixed(2)} V when full${spec.rechargeable ? '' : ' (cannot be recharged)'}. State of charge = V(<refdes>.soc)`,
      prefix: 'BT',
      symbol: BATTERY_SYMBOL(cells),
      params: batteryParams(chem, cells, String(ah), String(r0)),
      toSpice: batteryToSpice,
      virtual: false,
      provenance: 'MachSim Rint + OCV(SoC) battery model: generic discharge curves of the chemistry read from published manufacturer graphs; capacity by coulomb counting',
      footprint: 'BATTERY-HOLDER',
      keywords: ['battery', 'cell', 'state of charge', 'soc', 'discharge', 'capacity', 'internal resistance', spec.name.toLowerCase(), `${nominal(chem, cells).toFixed(1)}v`],
    },
    {
      vi: `${generic ? 'Pin không lý tưởng' : `Pin ${spec.nameVi}`}: mức điện tích giảm theo điện tích đã lấy ra (${ah} Ah cấp 1 A trong ${eng(batteryRuntime(ah, 1), 's', 3)}), điện trở trong (${eng(r0, 'Ω', 3)} khi đầy) tăng dần khi pin cạn, điện áp đi theo đường cong xả ${spec.nameVi} từ ${vfull.toFixed(2)} V khi đầy${spec.rechargeable ? '' : ' (không sạc lại được)'}. Mức điện tích = V(<ký hiệu>.soc)`,
      nameVi,
      specs: { vin: Number(nominal(chem, cells).toFixed(2)), capacity: ah },
      sortKey: nominal(chem, cells),
      series: 'Battery',
    },
  );
}

const generic = batteryPart('sources/battery-nonideal', 'Non-Ideal Battery', 'Pin không lý tưởng', 'alkaline', 1, 2.8, 0.15, true);

export const BATTERY_CATALOG: LibraryPartDef[] = [generic, ...PRESETS.map((p) => batteryPart(`sources/battery-${p.slug}`, p.name, p.nameVi, p.chem, p.cells, p.ah, p.r0, false))];
