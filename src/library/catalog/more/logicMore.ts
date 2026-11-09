/**
 * Logic-IC breadth (round 4): more device types and families, and the order codes and packages in
 * which the 74xx / 4000B parts are sold. A catalogue pack ('logic-more', groups TTL and CMOS).
 *
 * 1. New 74xx types built from the existing code models and the public JEDEC pinouts:
 *      74x238   3-to-8 decoder with active-high outputs (same pinout as the 138)
 *      74x533 / 563 / 564   octal latch / register with inverting outputs (373 / 573 / 574 pinouts)
 *      74x620 / 645   octal bus transceivers, inverting / non-inverting (245 pinout)
 *      74LS290 / 293   decade and binary ripple counters (7490 / 7493 pinouts)
 *      CD4724B  8-bit addressable latch (4099 pinout)
 *    and the families some existing types also exist in (74HC73, 74AC109, 74ACT112, 74F30 …), the
 *    74HC versions of 4000-series numbers (HC4022, HC4516, HC4585).
 * 2. Second sources and packages of every 74xx / 4000B part: "SN74LS00N" (Texas Instruments DIP),
 *    "SN74HC00D" (SOIC), "SN74HC00PW" (TSSOP), "DM74LS00N" (Fairchild), "CD74HC00E" (Harris),
 *    "CD4017BE / BM / BPW", "HCF4017BEY" (ST), "HEF4017BP" (NXP), "MC14017BCP" (ON). Each is the
 *    base part under another order code and footprint (variants.ts): same pins, levels and timing.
 */
import type { LibraryPartDef } from '../../partkit';
import { ALL_PARTS } from '../../parts';
import { fams, logicParts, names, type LogicSpec } from '../logicKit';
import { LOGIC_CATALOG } from '../logicCatalog';
import { LOGIC74_SPECS, octalReg, transceiver } from '../logic74';
import { LOGIC4000_SPECS } from '../logic4000';
import { repackage, variantId, type VariantSpec } from './variants';

const spec74 = (pn: string): LogicSpec => {
  const s = LOGIC74_SPECS.find((x) => x.pn === pn);
  if (!s) throw new Error(`unknown 74xx type ${pn}`);
  return s;
};
const spec4000 = (pn: string): LogicSpec => {
  const s = LOGIC4000_SPECS.find((x) => x.pn === pn);
  if (!s) throw new Error(`unknown 4000 type ${pn}`);
  return s;
};

// ---------------------------------------------------------------------------------------------
// new device types

const Y138 = [15, 14, 13, 12, 11, 10, 9, 7];

/** 3-to-8 decoder with true (active-high) outputs: the 138 pinout, `out_low: 0`. */
const DEC238: LogicSpec = {
  ...spec74('138'),
  pn: '238',
  name: '3-to-8 line decoder / demultiplexer, active-high outputs',
  vi: 'Bộ giải mã / phân kênh 3 sang 8, ngõ ra tích cực cao',
  desc: 'Active-high outputs, enabled when G1 is high and ~G2A, ~G2B are low (the 138 with true outputs).',
  descVi: 'Ngõ ra tích cực cao, hoạt động khi G1 cao và ~G2A, ~G2B thấp (như 138 nhưng ngõ ra không đảo).',
  right: names('Y', 8).map((n, i) => `${n}:${Y138[i]}`).join(' '),
  fams: fams('HC HCT'),
  build: (b) => b.add(undefined, ['A', 'B', 'C', 'G1', 'G2A', 'G2B', ...names('Y', 8)], b.model('D_DECODER', 2.2, { en_high: 1, en_low: 2, out_low: 0 })),
};

const INVERTING_LATCH = (pn: string, flow: boolean, latch: boolean, fam: string): LogicSpec =>
  octalReg({
    pn,
    name: latch ? `Octal transparent latch with 3-state inverting outputs${flow ? ' (flow-through)' : ''}` : 'Octal D flip-flop with 3-state inverting outputs (flow-through)',
    vi: latch ? `Tám chốt trong suốt, ngõ ra ba trạng thái đảo${flow ? ', chân thẳng hàng' : ''}` : 'Tám flip-flop D, ngõ ra ba trạng thái đảo, chân thẳng hàng',
    desc: `As the ${latch ? (flow ? '573' : '373') : '574'} with complemented outputs.`,
    descVi: `Như ${latch ? (flow ? '573' : '373') : '574'} nhưng ngõ ra đảo.`,
    fam,
    latch,
    ctrl1: 'OE',
    flow,
    invert: true,
  });

const NEW_74: LogicSpec[] = [
  DEC238,
  INVERTING_LATCH('533', false, true, 'LS ALS HC HCT'),
  INVERTING_LATCH('563', true, true, 'LS ALS HC HCT AC ACT'),
  INVERTING_LATCH('564', true, false, 'LS ALS HC HCT AC ACT'),
  transceiver('645', 'Octal bus transceiver with 3-state outputs (645)', 'Tám bộ thu phát bus ba trạng thái (645)', false, 'LS ALS HC HCT ACT'),
  transceiver('620', 'Octal bus transceiver with 3-state inverting outputs', 'Tám bộ thu phát bus ba trạng thái, đảo mức', true, 'LS ALS'),
  { ...spec74('90'), pn: '290', fams: fams('LS'), name: 'Decade counter (÷2 and ÷5), 290', vi: 'Bộ đếm thập phân (÷2 và ÷5), 290' },
  { ...spec74('93'), pn: '293', fams: fams('LS'), name: '4-bit binary counter (÷2 and ÷8), 293', vi: 'Bộ đếm nhị phân 4 bit (÷2 và ÷8), 293' },
  { ...spec4000('4099'), pn: '4724', name: '8-bit addressable latch (4724)', vi: 'Chốt 8 bit đánh địa chỉ (4724)' },
];

/** Families that existing 74xx types are also made in (type number -> families to add). */
const EXTRA_74: Record<string, string> = {
  '73': 'HC',
  '20': 'AC ACT',
  '30': 'F AS',
  '14': 'S',
  '109': 'AC ACT',
  '112': 'AC ACT',
  '125': 'F',
  '164': 'F',
};

/** 74HC versions of 4000-series numbers. */
const EXTRA_4000: Record<string, string> = { '4022': 'HC', '4516': 'HC', '4585': 'HC' };

function extraFamilies(): LogicSpec[] {
  const out: LogicSpec[] = [];
  for (const [pn, f] of Object.entries(EXTRA_74)) {
    const s = spec74(pn);
    out.push({ ...s, fams: fams(f).filter((x) => !s.fams.includes(x)) });
  }
  for (const [pn, f] of Object.entries(EXTRA_4000)) {
    const s = spec4000(pn);
    out.push({ ...s, fams: fams(f).filter((x) => !s.fams.includes(x)) });
  }
  return out;
}

/** The new device types and family additions: base parts of this pack. */
export const LOGIC_NEW: LibraryPartDef[] = logicParts([...NEW_74, ...extraFamilies()]);

// ---------------------------------------------------------------------------------------------
// order codes and packages

interface OrderCode {
  prefix: string;
  suffix: string;
  kind: 'DIP' | 'SOIC' | 'TSSOP';
  maker: [string, string];
  /** skip five-digit 4000 numbers (the MC14xxx scheme has no 40xxx numbers) */
  fourDigitOnly?: boolean;
}

const TI: [string, string] = ['Texas Instruments', 'Texas Instruments'];
const FAIRCHILD: [string, string] = ['Fairchild / onsemi', 'Fairchild / onsemi'];
const HARRIS: [string, string] = ['Harris / Texas Instruments', 'Harris / Texas Instruments'];
const ST: [string, string] = ['STMicroelectronics', 'STMicroelectronics'];
const NXP: [string, string] = ['NXP / Nexperia', 'NXP / Nexperia'];
const ON: [string, string] = ['onsemi (Motorola)', 'onsemi (Motorola)'];
const SIGNETICS: [string, string] = ['Signetics / NXP', 'Signetics / NXP'];

const SN = (suffix: string, kind: OrderCode['kind']): OrderCode => ({ prefix: 'SN', suffix, kind, maker: TI });

/** Order codes per library family (ids and names follow the makers' public part-number schemes). */
export const ORDER_CODES: Record<string, OrderCode[]> = {
  '74STD': [SN('N', 'DIP'), { prefix: 'DM', suffix: 'N', kind: 'DIP', maker: FAIRCHILD }],
  '74LS': [SN('N', 'DIP'), SN('D', 'SOIC'), { prefix: 'DM', suffix: 'N', kind: 'DIP', maker: FAIRCHILD }],
  '74S': [SN('N', 'DIP'), { prefix: 'DM', suffix: 'N', kind: 'DIP', maker: FAIRCHILD }],
  '74ALS': [SN('N', 'DIP'), SN('D', 'SOIC')],
  '74AS': [SN('N', 'DIP')],
  '74F': [SN('N', 'DIP'), SN('D', 'SOIC'), { prefix: 'N', suffix: 'N', kind: 'DIP', maker: SIGNETICS }],
  '74HC': [SN('N', 'DIP'), SN('D', 'SOIC'), SN('PW', 'TSSOP'), { prefix: 'CD', suffix: 'E', kind: 'DIP', maker: HARRIS }],
  '74HCT': [SN('N', 'DIP'), SN('D', 'SOIC'), { prefix: 'CD', suffix: 'E', kind: 'DIP', maker: HARRIS }],
  '74AC': [SN('N', 'DIP'), SN('D', 'SOIC')],
  '74ACT': [SN('N', 'DIP'), SN('D', 'SOIC')],
  '4000': [
    { prefix: 'CD', suffix: 'BE', kind: 'DIP', maker: TI },
    { prefix: 'CD', suffix: 'BM', kind: 'SOIC', maker: TI },
    { prefix: 'CD', suffix: 'BPW', kind: 'TSSOP', maker: TI },
    { prefix: 'HCF', suffix: 'BEY', kind: 'DIP', maker: ST },
    { prefix: 'HEF', suffix: 'BP', kind: 'DIP', maker: NXP },
    { prefix: 'MC1', suffix: 'BCP', kind: 'DIP', maker: ON, fourDigitOnly: true },
  ],
};

const KIND_PHRASE: Record<OrderCode['kind'], [string, string]> = {
  DIP: ['plastic DIP (through-hole)', 'vỏ DIP nhựa (chân xuyên lỗ)'],
  SOIC: ['SOIC (surface-mount)', 'vỏ dán SOIC'],
  TSSOP: ['TSSOP (surface-mount)', 'vỏ dán TSSOP'],
};

/** Standard lead counts of the packages the order codes come in. */
const LEAD_COUNTS = [8, 14, 16, 18, 20, 24, 28, 40];

/**
 * Number of leads of the package: the footprint's pad count, or, where the footprint names too few pads
 * for the pin numbers (the hand-written CD4049 / CD4050 are drawn on a DIP-14 but have 16 pins), the next
 * standard lead count above the highest pin number.
 */
function leads(part: LibraryPartDef): number {
  const fromFootprint = Number((part.footprint ?? '').replace(/^\D+-?/, '')) || 14;
  const highest = Math.max(0, ...part.symbol.pins.map((p) => Number(p.number) || 0));
  return highest <= fromFootprint ? fromFootprint : (LEAD_COUNTS.find((n) => n >= highest) ?? highest);
}

/** The variants of one base logic part (order code x package). */
export function logicVariants(base: LibraryPartDef): LibraryPartDef[] {
  const codes = ORDER_CODES[base.family];
  if (!codes) return [];
  const pins = leads(base);
  const out: LibraryPartDef[] = [];
  for (const c of codes) {
    if (c.fourDigitOnly && base.name.length !== 4) continue;
    const name = `${c.prefix}${base.name}${c.suffix}`;
    const footprint = c.kind === 'DIP' ? `DIP-${pins}` : `${c.kind === 'SOIC' ? 'SOIC' : 'TSSOP'}-${pins}`;
    const [pe, pv] = KIND_PHRASE[c.kind];
    const v: VariantSpec = {
      id: variantId(base, name),
      name,
      footprint,
      pkg: footprint,
      en: `the ${pins}-pin ${pe} version with the ${c.maker[0]} order code`,
      vi: `bản ${pins} chân ${pv}, mã đặt hàng kiểu ${c.maker[1]}`,
      keywords: [c.maker[0].toLowerCase(), c.kind.toLowerCase()],
    };
    out.push(repackage(base, v));
  }
  return out;
}

/** The hand-written 4000B parts of the core library (packages only, no sections; the hand-written 74xx parts duplicate the STD family of the logic pack). */
const CORE_4000: LibraryPartDef[] = ALL_PARTS.filter((p) => p.group === 'cmos' && p.family === '4000' && !(p as LibraryPartDef).pkg) as LibraryPartDef[];

/** Base parts (whole packages) that get order-code variants. */
export function logicBases(): LibraryPartDef[] {
  const packages = LOGIC_CATALOG.filter((p) => !p.pkg);
  return [...packages, ...LOGIC_NEW];
}

/** Every part of the pack: new base parts and the variants of all 74xx / 4000B packages. */
export function logicMoreParts(): LibraryPartDef[] {
  const bases = logicBases();
  const hand = CORE_4000;
  return [...LOGIC_NEW, ...[...bases, ...hand].flatMap(logicVariants)];
}

export const LOGIC_MORE_CATALOG: LibraryPartDef[] = logicMoreParts();

