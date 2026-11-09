/**
 * Multi-section analog packages: dual / quad op-amps (LM358, LM324, TL072, TL074 and every other
 * dual or quad part of the catalogue) and the dual 555 timers (NE556, TLC556).
 *
 * The single-section parts of the catalogue ("TL072": one op-amp triangle with its own supply
 * pins) keep working exactly as before. For each dual / quad type this module adds
 *   - the whole chip, "TL072 (dual)": one DIP-8 box with every pin;
 *   - one part per section, "TL072A" / "TL072B": the op-amp triangle with the package's pin names
 *     ('1IN+', '1IN-', '1OUT', 'V+', 'V-' for section A, '2IN+' … for B).
 * Sections of one chip share the reference designator (U1A, U1B) and the **supply pins**: V+ and
 * V- are the same pins in every section, so wiring the supply on one section is enough (the
 * netlister merges the shared pins and warns when two sections connect them to different nets).
 * An unplaced section is a spare amplifier, listed in Reports > Spare gates with the textbook
 * advice to tie it off (src/model/sections.ts, src/library/sectionKit.ts).
 *
 * Pinouts are the de-facto standard ones shared by the LM358 / TL072 (DIP-8, dual) and
 * LM324 / TL074 (DIP-14, quad) families, from the public datasheets: 1OUT 1IN- 1IN+ V- 2IN+ 2IN-
 * 2OUT V+ for the dual; 1OUT 1IN- 1IN+ V+ 2IN+ 2IN- 2OUT 3OUT 3IN- 3IN+ V- 4IN+ 4IN- 4OUT for the
 * quad. A few parts in other packages (SO-8, SOT-23-8) have the same logical pinout.
 */
import type { SubcktDef } from '../../sim/netlist';
import { elX, type LibraryPartDef } from '../partkit';
import { makeSectionParts } from '../sectionKit';
import { ampSymbol } from '../symbols';
import { icSymbol, type IcPin } from '../parts/digital/kit';
import type { PinDef, SymbolDef, ToSpiceContext } from '../types';
import { opampNodes } from '../parts/analog';

/** DIP pin numbers of the dual (8 pins) and the quad (14 pins) op-amp. */
const DUAL_PINS: Record<string, string> = { '1OUT': '1', '1IN-': '2', '1IN+': '3', 'V-': '4', '2IN+': '5', '2IN-': '6', '2OUT': '7', 'V+': '8' };
const QUAD_PINS: Record<string, string> = {
  '1OUT': '1', '1IN-': '2', '1IN+': '3', 'V+': '4', '2IN+': '5', '2IN-': '6', '2OUT': '7',
  '3OUT': '8', '3IN-': '9', '3IN+': '10', 'V-': '11', '4IN+': '12', '4IN-': '13', '4OUT': '14',
};

/** What a dual / quad op-amp type needs to become a package with sections. */
export interface OpampPackageSpec {
  /** part number: 'TL072' */
  pn: string;
  channels: 2 | 4;
  /** the op-amp macromodel of one channel (ports inp inn out vcc vee) */
  sub: SubcktDef;
  footprint: string;
  /** library family of the parts ('Op-amp') */
  family?: string;
  /** one-line description of the amplifier, in both languages (without the section remark) */
  en: string;
  vi: string;
  provenance: string;
  keywords: string[];
}

const letter = (k: number): string => String.fromCharCode(64 + k);

/** The whole chip: every channel in one box. */
function packageSymbol(spec: OpampPackageSpec, numbers: Record<string, string>): SymbolDef {
  const pin = (name: string, type: IcPin['type']): IcPin => ({ name, number: numbers[name], type });
  const left: (IcPin | null)[] = [];
  const right: (IcPin | null)[] = [];
  for (let k = 1; k <= spec.channels; k++) {
    if (k > 1) {
      left.push(null);
      right.push(null);
    }
    left.push(pin(`${k}IN+`, 'input'), pin(`${k}IN-`, 'input'));
    right.push(pin(`${k}OUT`, 'output'), null);
  }
  return icSymbol(spec.pn, left, right, { w: 80, top: [pin('V+', 'power')], bottom: [pin('V-', 'power')] });
}

/** One channel: the op-amp triangle with the package's pin names and DIP numbers. */
function sectionSymbol(k: number, numbers: Record<string, string>): SymbolDef {
  const base = ampSymbol({ supplies: true });
  const rename = (name: string): string => (name === 'V+' || name === 'V-' ? name : `${k}${name}`);
  const pins: PinDef[] = base.pins.map((p) => ({ ...p, name: rename(p.name), number: numbers[rename(p.name)] }));
  return { ...base, pins };
}

/** The whole chip and its sections: `[<pn> (dual), <pn>A, <pn>B]` (a quad adds C and D). */
export function opampPackageParts(spec: OpampPackageSpec): LibraryPartDef[] {
  const numbers = spec.channels === 4 ? QUAD_PINS : DUAL_PINS;
  const kind = spec.channels === 4 ? 'quad' : 'dual';
  const kindVi = spec.channels === 4 ? 'bốn' : 'kép';
  const nodes = (ctx: ToSpiceContext, k: number): string[] => {
    // the channel's own pins under the package's names; the supply pins are shared
    const sub = { ...ctx, node: (pin: string) => ctx.node(pin === 'V+' || pin === 'V-' ? pin : `${k}${pin}`) };
    return opampNodes(sub);
  };
  const pkg: LibraryPartDef = {
    id: `analog/${spec.pn.toLowerCase().replace(/[^a-z0-9.+-]+/g, '-')}-${kind}`,
    name: `${spec.pn} (${kind})`,
    group: 'analog',
    family: spec.family ?? 'Op-amp',
    description: `${spec.en}: the whole ${kind} chip with all ${spec.channels} amplifiers and the shared supply pins. Place the sections one by one (${spec.pn}A, ${spec.pn}B …) to draw each amplifier where it is used.`,
    prefix: 'U',
    symbol: packageSymbol(spec, numbers),
    params: [],
    toSpice: (ctx) => ({
      elements: Array.from({ length: spec.channels }, (_, i) => elX(ctx.name('X', String(i + 1)), nodes(ctx, i + 1), spec.sub.name)),
      subckts: [spec.sub],
    }),
    optionalPins: Array.from({ length: spec.channels - 1 }, (_, i) => i + 2).flatMap((k) => [`${k}IN+`, `${k}IN-`, `${k}OUT`]),
    provenance: spec.provenance,
    footprint: spec.footprint,
    keywords: [...spec.keywords, kind, 'package', 'whole chip'],
    textVi: { name: `${spec.pn} (${kindVi})`, description: `${spec.vi}: cả vi mạch ${kindVi} với ${spec.channels} bộ khuếch đại và chân nguồn dùng chung. Có thể đặt từng phần (${spec.pn}A, ${spec.pn}B …) để vẽ mỗi bộ khuếch đại đúng chỗ dùng nó.` },
  };
  const drafts = Array.from({ length: spec.channels }, (_, i) => {
    const k = i + 1;
    return { letter: letter(k), symbol: sectionSymbol(k, numbers), own: [`${k}IN+`, `${k}IN-`, `${k}OUT`, 'V+', 'V-'] };
  });
  const sections = makeSectionParts(pkg, drafts, { en: 'op-amp', vi: 'bộ khuếch đại thuật toán', nameBase: spec.pn }).map((s) => ({
    ...s,
    description: `${spec.pn} section ${s.pkg!.section}: one op-amp of the ${kind} ${spec.pn}. ${spec.en}. Sections share the reference designator (U1A … U1${letter(spec.channels)}) and the supply pins V+ / V-, and are netlisted as one chip; an unplaced section is a spare amplifier (tie its + input to ground and its - input to its output).`,
    keywords: [...spec.keywords, `${spec.pn.toLowerCase()}${s.pkg!.section.toLowerCase()}`, 'section', 'op-amp', 'opamp'],
    textVi: {
      name: `${spec.pn}${s.pkg!.section}`,
      description: `${spec.pn} phần ${s.pkg!.section}: một bộ khuếch đại thuật toán của ${spec.pn} ${kindVi}. ${spec.vi}. Các phần dùng chung tên linh kiện (U1A … U1${letter(spec.channels)}) và chân nguồn V+ / V-, chỉ sinh ra một vi mạch trong netlist; phần chưa dùng là bộ khuếch đại thừa (nối ngõ vào + xuống đất, ngõ vào - nối với ngõ ra).`,
    },
  }));
  return [pkg, ...sections];
}
