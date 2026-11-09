/**
 * Section parts of the multi-section logic packages ("7400A" … "7400D", "7474A", "4066B").
 *
 * The whole-chip parts (`ttl/7400`, `cmos/4011` …) draw all four gates in one box. A learner
 * usually wants the gate drawn where it is used, so every gate package also exists as one part per
 * section: four parts 7400A…7400D, each a single distinctive-shape gate. Give them all the same
 * reference designator (U1) and they are one chip in the netlist, the BOM and the PCB netlist, with
 * the gates nobody placed listed as spare (src/model/sections.ts, src/library/sectionKit.ts).
 * The same holds for the dual flip-flops (7474, 7476, 74112, 4013, 4027: one box per flip-flop) and
 * the quad analog switches (4016, 4066: one switch per section).
 *
 * The symbols are derived from the package definition, so the pin numbers, parameters, levels,
 * timing and models are exactly those of the package: pin `name` is the package's pin name ('2A'),
 * `label` is what the learner reads on the gate ('A') and `number` is the DIP pin number.
 */
import { bufferSymbol, gateSymbol, icSymbol, type IcPin } from './kit';
import type { LibraryPartDef } from '../../partkit';
import { makeSectionParts } from '../../sectionKit';
import type { PinDef, SymbolDef } from '../../types';
import { CMOS_PARTS } from './cmos';
import { TTL_PARTS } from './ttl';

/** Shape a section is drawn with. */
type Shape = 'and' | 'or' | 'xor' | 'buf' | 'ff' | 'switch';

export interface SectionSpec {
  /** part id of the package */
  id: string;
  shape: Shape;
  /** output bubble (NAND / NOR / inverter) */
  invert: boolean;
  /** Schmitt-trigger glyph (7414, 4093) */
  schmitt?: boolean;
  /** flip-flops and switches: the title inside the box ('D', 'JK', 'SW') */
  title?: string;
  /** what one section does, in both languages */
  en: string;
  vi: string;
}

/** The packages that also exist section by section. */
const SECTION_SPECS: SectionSpec[] = [
  { id: 'ttl/7400', shape: 'and', invert: true, en: '2-input NAND gate', vi: 'cổng NAND 2 ngõ vào' },
  { id: 'ttl/7402', shape: 'or', invert: true, en: '2-input NOR gate', vi: 'cổng NOR 2 ngõ vào' },
  { id: 'ttl/7404', shape: 'buf', invert: true, en: 'inverter', vi: 'cổng đảo (NOT)' },
  { id: 'ttl/7408', shape: 'and', invert: false, en: '2-input AND gate', vi: 'cổng AND 2 ngõ vào' },
  { id: 'ttl/7410', shape: 'and', invert: true, en: '3-input NAND gate', vi: 'cổng NAND 3 ngõ vào' },
  { id: 'ttl/7414', shape: 'buf', invert: true, schmitt: true, en: 'Schmitt-trigger inverter', vi: 'cổng đảo Schmitt' },
  { id: 'ttl/7420', shape: 'and', invert: true, en: '4-input NAND gate', vi: 'cổng NAND 4 ngõ vào' },
  { id: 'ttl/7432', shape: 'or', invert: false, en: '2-input OR gate', vi: 'cổng OR 2 ngõ vào' },
  { id: 'ttl/7486', shape: 'xor', invert: false, en: '2-input XOR gate', vi: 'cổng XOR 2 ngõ vào' },
  { id: 'cmos/4001', shape: 'or', invert: true, en: '2-input NOR gate', vi: 'cổng NOR 2 ngõ vào' },
  { id: 'cmos/4011', shape: 'and', invert: true, en: '2-input NAND gate', vi: 'cổng NAND 2 ngõ vào' },
  { id: 'cmos/4049', shape: 'buf', invert: true, en: 'inverting buffer', vi: 'bộ đệm đảo' },
  { id: 'cmos/4050', shape: 'buf', invert: false, en: 'buffer', vi: 'bộ đệm' },
  { id: 'cmos/4069', shape: 'buf', invert: true, en: 'inverter', vi: 'cổng đảo (NOT)' },
  { id: 'cmos/4070', shape: 'xor', invert: false, en: '2-input XOR gate', vi: 'cổng XOR 2 ngõ vào' },
  { id: 'cmos/4071', shape: 'or', invert: false, en: '2-input OR gate', vi: 'cổng OR 2 ngõ vào' },
  { id: 'cmos/4081', shape: 'and', invert: false, en: '2-input AND gate', vi: 'cổng AND 2 ngõ vào' },
  { id: 'cmos/4093', shape: 'and', invert: true, schmitt: true, en: '2-input NAND Schmitt trigger', vi: 'cổng NAND Schmitt 2 ngõ vào' },
  // round 4 step 4: flip-flops and analog switches
  { id: 'ttl/7474', shape: 'ff', invert: false, title: 'D', en: 'D flip-flop with preset and clear', vi: 'flip-flop D có đặt trước và xoá' },
  { id: 'ttl/7476', shape: 'ff', invert: false, title: 'JK', en: 'JK flip-flop with preset and clear', vi: 'flip-flop JK có đặt trước và xoá' },
  { id: 'ttl/74112', shape: 'ff', invert: false, title: 'JK', en: 'negative-edge JK flip-flop with preset and clear', vi: 'flip-flop JK kích sườn xuống có đặt trước và xoá' },
  { id: 'cmos/4013', shape: 'ff', invert: false, title: 'D', en: 'D flip-flop with set and reset', vi: 'flip-flop D có set và reset' },
  { id: 'cmos/4027', shape: 'ff', invert: false, title: 'JK', en: 'JK flip-flop with set and reset', vi: 'flip-flop JK có set và reset' },
  { id: 'cmos/4066', shape: 'switch', invert: false, title: 'SW', en: 'bilateral analog switch', vi: 'công tắc tương tự hai chiều' },
];

/** Section pins of a package symbol, grouped by the leading section number of their names. */
export function gatePinGroups(pins: readonly PinDef[]): Map<number, PinDef[]> {
  const out = new Map<number, PinDef[]>();
  for (const p of pins) {
    const m = /^(\d+)([A-Za-z].*)$/.exec(p.name);
    if (!m) continue;
    const k = Number(m[1]);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(p);
  }
  return out;
}

const suffixOf = (name: string): string => /^\d+([A-Za-z].*)$/.exec(name)?.[1] ?? name;

/** Pin label of a section: the package label without the section number ('~1PRE' -> '~PRE'). */
const sectionLabel = (p: PinDef): string => (p.label ?? p.name).replace(/^(~?)\d+/, '$1');

/** A flip-flop or analog-switch section drawn as an IC box with the package pin names. */
function boxSectionSymbol(spec: SectionSpec, pins: PinDef[]): SymbolDef {
  const ic = (p: PinDef, clock = false): IcPin => ({ name: p.name, number: p.number, label: sectionLabel(p), type: p.type ?? 'input', clock });
  if (spec.shape === 'switch') {
    // A and B are the two ends of the switch, C is the control input
    const named = (s: string) => pins.find((p) => suffixOf(p.name).toUpperCase() === s);
    const a = named('A');
    const b = named('B');
    const c = named('C');
    if (!a || !b || !c) throw new Error(`${spec.id}: a switch section needs A, B and C pins`);
    return icSymbol(spec.title ?? 'SW', [ic(a)], [ic(b)], { w: 60, top: [ic(c)] });
  }
  const left = pins.filter((p) => (p.type ?? 'input') === 'input').map((p) => ic(p, /CLK$/i.test(p.name)));
  const right = pins.filter((p) => p.type === 'output').map((p) => ic(p));
  return icSymbol(spec.title ?? 'FF', left, right, { w: 60 });
}

/** One section's symbol: the gate shape with the package's pin names, numbers and types. */
function sectionSymbol(spec: SectionSpec, pins: PinDef[]): SymbolDef {
  if (spec.shape === 'ff' || spec.shape === 'switch') return boxSectionSymbol(spec, pins);
  const ins = pins.filter((p) => suffixOf(p.name).toUpperCase() !== 'Y').sort((a, b) => suffixOf(a.name).localeCompare(suffixOf(b.name)));
  const out = pins.find((p) => suffixOf(p.name).toUpperCase() === 'Y');
  if (!out) throw new Error(`${spec.id}: a gate section needs a 'Y' output pin`);
  const base = spec.shape === 'buf' ? bufferSymbol(spec.invert, spec.schmitt ? { schmitt: true } : {}) : gateSymbol(spec.shape, ins.length, spec.invert);
  // the drawn symbol names its pins A, B, … and Y; swap in the package's names
  const order = [...ins, out];
  const drawn = [...base.pins];
  const mapped: PinDef[] = drawn.map((p, i) => {
    const want = p.name.toUpperCase() === 'Y' ? out : (ins[i] ?? order[i]);
    return {
      ...p,
      name: want.name,
      label: suffixOf(want.name).toUpperCase(),
      ...(want.number !== undefined ? { number: want.number } : {}),
      type: want.type ?? p.type,
    };
  });
  return { ...base, pins: mapped };
}

/** The section parts of one package definition. */
export function sectionPartsOf(pkg: LibraryPartDef, spec: SectionSpec): LibraryPartDef[] {
  const groups = [...gatePinGroups(pkg.symbol.pins).entries()].sort((a, b) => a[0] - b[0]);
  if (groups.length < 2) return [];
  const drafts = groups.map(([, pins], i) => ({ letter: String.fromCharCode(65 + i), symbol: sectionSymbol(spec, pins), own: pins.map((p) => p.name) }));
  const extra = spec.shape === 'ff' ? 'flip-flop' : spec.shape === 'switch' ? 'analog switch' : 'gate';
  return makeSectionParts(pkg, drafts, { en: spec.en, vi: spec.vi }).map((def) => ({ ...def, keywords: [...(def.keywords ?? []), extra] }));
}

const PACKAGES: LibraryPartDef[] = [...TTL_PARTS, ...CMOS_PARTS];

/** Every section part of the gate packages ("7400A" …). */
export const SECTION_PARTS: LibraryPartDef[] = SECTION_SPECS.flatMap((spec) => {
  const pkg = PACKAGES.find((p) => p.id === spec.id);
  if (!pkg) throw new Error(`sectionParts: unknown package ${spec.id}`);
  return sectionPartsOf(pkg, spec);
});
