/**
 * Section parts of the multi-gate logic packages ("7400A" … "7400D").
 *
 * The whole-chip parts (`ttl/7400`, `cmos/4011` …) draw all four gates in one box. A learner
 * usually wants the gate drawn where it is used, so every gate package also exists as one part per
 * section: four parts 7400A…7400D, each a single distinctive-shape gate. Give them all the same
 * reference designator (U1) and they are one chip in the netlist, the BOM and the PCB netlist, with
 * the gates nobody placed listed as spare (src/model/sections.ts, src/library/sectionKit.ts).
 *
 * The symbols are derived from the package definition, so the pin numbers, parameters, levels,
 * timing and models are exactly those of the package: pin `name` is the package's pin name ('2A'),
 * `label` is what the learner reads on the gate ('A') and `number` is the DIP pin number.
 */
import { bufferSymbol, gateSymbol } from './kit';
import type { LibraryPartDef } from '../../partkit';
import { packageFragment } from '../../sectionKit';
import type { PinDef, SymbolDef } from '../../types';
import { CMOS_PARTS } from './cmos';
import { TTL_PARTS } from './ttl';

/** Shape a section is drawn with. */
type Shape = 'and' | 'or' | 'xor' | 'buf';

interface SectionSpec {
  /** part id of the package */
  id: string;
  shape: Shape;
  /** output bubble (NAND / NOR / inverter) */
  invert: boolean;
  /** Schmitt-trigger glyph (7414, 4093) */
  schmitt?: boolean;
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

/** One section's symbol: the gate shape with the package's pin names, numbers and types. */
function sectionSymbol(spec: SectionSpec, pins: PinDef[]): SymbolDef {
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
  const letters = groups.map(([k]) => String.fromCharCode(64 + k));
  return groups.map(([k, pins], i) => {
    const section = letters[i];
    const own = pins.map((p) => p.name);
    const def: LibraryPartDef = {
      id: `${pkg.id}-${section.toLowerCase()}`,
      name: `${pkg.name}${section}`,
      group: pkg.group,
      family: pkg.family,
      description: `${pkg.name} section ${section}: one ${spec.en} of the ${pkg.name} package. Sections of one package share their reference designator (U1A … U1${letters[letters.length - 1]}) and are netlisted as a single chip; unplaced sections are listed as spare gates.`,
      prefix: pkg.prefix,
      symbol: sectionSymbol(spec, pins),
      params: pkg.params,
      toSpice: (ctx) => packageFragment(pkg, ctx, own),
      ...(pkg.footprint !== undefined ? { footprint: pkg.footprint } : {}),
      keywords: [...(pkg.keywords ?? []), `${pkg.name.toLowerCase()}${section.toLowerCase()}`, 'section', 'gate'],
      pkg: { id: pkg.id, section, sections: letters },
      textVi: {
        name: `${pkg.name}${section}`,
        description: `${pkg.name} phần ${section}: một ${spec.vi} của vi mạch ${pkg.name}. Các phần của cùng một vi mạch dùng chung tên linh kiện (U1A … U1${letters[letters.length - 1]}) và chỉ sinh ra một vi mạch trong netlist; phần chưa dùng được báo trong "Cổng còn trống".`,
      },
      ...(pkg.provenance !== undefined ? { provenance: pkg.provenance } : {}),
    };
    if (k !== i + 1) def.pkg = { id: pkg.id, section, sections: letters };
    return def;
  });
}

const PACKAGES: LibraryPartDef[] = [...TTL_PARTS, ...CMOS_PARTS];

/** Every section part of the gate packages ("7400A" …). */
export const SECTION_PARTS: LibraryPartDef[] = SECTION_SPECS.flatMap((spec) => {
  const pkg = PACKAGES.find((p) => p.id === spec.id);
  if (!pkg) throw new Error(`sectionParts: unknown package ${spec.id}`);
  return sectionPartsOf(pkg, spec);
});
