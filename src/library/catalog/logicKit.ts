/**
 * Generator of the logic-IC catalogue (74xx families and the 4000B series).
 *
 * A device type is described once (LogicSpec): its function, pinout in a compact text form, the
 * families it exists in, and a build function that emits the code-model elements through the
 * shared IcBuilder (src/library/parts/digital/ttl.ts). `logicParts()` expands every type into one
 * part per family:
 *   - 74 families: id '<group>/74<fam><pn>' ('ttl/74ls00', 'cmos/74hc595'; STD: 'ttl/74std00'),
 *     name '74LS00' (STD: '7400'), library family '74LS' / '74HC' …; TTL families sit in the TTL
 *     group, HC / HCT / AC / ACT in the CMOS group. The family fixes levels, thresholds, input
 *     loading, output resistance and typical delays (kit.ts FAMILIES).
 *   - 4000B series: id 'cmos/<pn>', name '<pn>', family '4000', with the VDD parameter (3..18 V).
 * Every part has hidden power pins (kit.ts powerNodes), an English and Vietnamese description, the
 * catalogue specs (propagation delay, output type, output current, supply, package) and a sort key.
 *
 * Pin text (one string per side, tokens separated by spaces):
 *   NAME:NUM        pin NAME with physical number NUM; '~NAME' draws the label with a bar (the
 *                   pin is still called NAME); 'NAME@LABEL' sets the label ('_' = space);
 *                   a trailing '>' draws a clock wedge; '|' leaves an empty row.
 *   prefixes        '+' output, '-' input, '=' bidirectional, '%' passive (analog); the default is
 *                   input on the left side and output on the right side.
 */
import type { ParamDef, PinType } from '../types';
import type { LibraryPartDef } from '../partkit';
import { CMOS74_FAMILIES, FAMILIES, cmosLevels, icSymbol, levelsFor, powerNodes, powerParams, vddParam, type IcPin, type TtlFamily } from '../parts/digital/kit';
import { IcBuilder } from '../parts/digital/ttl';
import { withMeta } from './kit';

export type LogicFamily = TtlFamily | '4000';

export const ALL_74: TtlFamily[] = ['STD', 'LS', 'S', 'F', 'ALS', 'AS', 'HC', 'HCT', 'AC', 'ACT'];

/** Family list from text: names separated by spaces; 'ALL' = every 74 family, 'TTL', 'CMOS'. */
export function fams(text: string): LogicFamily[] {
  const out: LogicFamily[] = [];
  for (const t of text.trim().split(/\s+/)) {
    const list: LogicFamily[] = t === 'ALL' ? ALL_74 : t === 'TTL' ? ['STD', 'LS', 'S', 'F', 'ALS', 'AS'] : t === 'CMOS' ? ['HC', 'HCT', 'AC', 'ACT'] : [t as LogicFamily];
    for (const f of list) {
      if (f !== '4000' && !(f in FAMILIES)) throw new Error(`unknown logic family '${f}'`);
      if (!out.includes(f)) out.push(f);
    }
  }
  return out;
}

const TYPE_OF: Record<string, PinType> = { '+': 'output', '-': 'input', '=': 'bidir', '%': 'passive' };

/**
 * ERC pin type of the outputs that follows from the device's output stage (`LogicSpec.output`):
 * a 3-state part's push-pull outputs are `tristate`, an open-collector / open-drain part's are
 * `open-collector`. That is what makes the pin-type matrix rows fire
 * (src/model/ercMatrix.ts): two 7400 outputs wired together are an error, two 7403 (open
 * collector) outputs on a pull-up are the normal wired-AND, and an ordinary output driving a
 * 74244 bus line is a warning. Bidirectional pins (bus transceivers) keep `bidir`: the direction
 * pin decides who drives, and the matrix already treats them as a shared line.
 */
function outputPinType(pins: (IcPin | null)[], output: LogicSpec['output']): (IcPin | null)[] {
  const type: PinType | undefined = output === '3-state' ? 'tristate' : output === 'open-collector' || output === 'open-drain' ? 'open-collector' : undefined;
  if (type === undefined) return pins;
  return pins.map((p) => (p && p.type === 'output' ? { ...p, type } : p));
}

/** Parse one side of a pinout ("A:1 B:2 | ~CLR:9 CLK:8>"). */
export function side(text: string, defaultType: PinType): (IcPin | null)[] {
  const out: (IcPin | null)[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    if (tok === '|') {
      out.push(null);
      continue;
    }
    const m = tok.match(/^([+\-=%]?)(~?)([A-Za-z0-9_]+)(?:@([^:]+))?:([0-9]+)(>?)$/);
    if (!m) throw new Error(`bad pin token '${tok}'`);
    const [, pre, bar, name, label, num, clock] = m;
    const lbl = label !== undefined ? label.replace(/_/g, ' ') : `${bar}${name}`;
    out.push({ name, number: num, label: lbl, type: pre ? TYPE_OF[pre] : defaultType, clock: clock === '>' });
  }
  return out;
}

export type LogicKind = 'gate' | 'buffer' | 'flip-flop' | 'latch' | 'register' | 'counter' | 'shift' | 'decoder' | 'encoder' | 'mux' | 'arithmetic' | 'comparator' | 'parity' | 'monostable' | 'transceiver' | 'display' | 'switch' | 'pll';

export interface LogicSpec {
  /** type number without the family: '00', '595', '4040' (74 families) or the 4000 number */
  pn: string;
  name: string;
  vi: string;
  /** one or two sentences on the function (English / Vietnamese) */
  desc: string;
  descVi: string;
  /** package pins (14, 16, 20, 24) */
  pins: number;
  /** hidden power pins when not at the corners, e.g. 'VCC = 5, GND = 10' */
  power?: string;
  left: string;
  right: string;
  w?: number;
  fams: LogicFamily[];
  kind: LogicKind;
  output?: 'totem-pole' | 'open-collector' | '3-state' | 'open-drain' | 'analog';
  schmitt?: boolean;
  /** representative path delay in gate delays (specs) */
  delay?: number;
  /** strong 4000B output (4049 / 4050) */
  strong?: boolean;
  params?: ParamDef[];
  optional?: string[];
  keywords?: string[];
  build(b: IcBuilder, fam: LogicFamily): void;
}

/** Part number of a type in a family ('7400', '74LS00', '74HC4040', '4040'). */
export function partNumber(spec: Pick<LogicSpec, 'pn'>, fam: LogicFamily): string {
  if (fam === '4000') return spec.pn;
  return `74${fam === 'STD' ? '' : fam}${spec.pn}`;
}

/** Library id of a type in a family. */
export function partIdOf(spec: Pick<LogicSpec, 'pn'>, fam: LogicFamily): string {
  if (fam === '4000') return `cmos/${spec.pn.toLowerCase()}`;
  return `${CMOS74_FAMILIES.includes(fam) ? 'cmos' : 'ttl'}/74${fam.toLowerCase()}${spec.pn.toLowerCase()}`;
}

/** Library family name ('74LS', '74STD', '4000'). */
export function libraryFamily(fam: LogicFamily): string {
  return fam === '4000' ? '4000' : `74${fam}`;
}

const NOTE: Record<LogicFamily, [string, string]> = {
  STD: ['Standard TTL: about 10 ns per gate, 16 mA outputs.', 'TTL chuẩn: khoảng 10 ns mỗi cổng, ngõ ra 16 mA.'],
  LS: ['Low-power Schottky TTL, the classic lab family: about 10 ns per gate, 8 mA outputs.', 'TTL Schottky công suất thấp, họ hay dùng trong phòng thí nghiệm: khoảng 10 ns mỗi cổng, ngõ ra 8 mA.'],
  S: ['Schottky TTL: about 3 ns per gate, 20 mA outputs.', 'TTL Schottky: khoảng 3 ns mỗi cổng, ngõ ra 20 mA.'],
  F: ['FAST TTL: about 3.5 ns per gate, 20 mA outputs.', 'TTL FAST: khoảng 3,5 ns mỗi cổng, ngõ ra 20 mA.'],
  ALS: ['Advanced low-power Schottky TTL: about 5 ns per gate, 8 mA outputs, small input current.', 'TTL Schottky công suất thấp cải tiến: khoảng 5 ns mỗi cổng, ngõ ra 8 mA, dòng vào nhỏ.'],
  AS: ['Advanced Schottky TTL: about 1.7 ns per gate, 20 mA outputs.', 'TTL Schottky cải tiến: khoảng 1,7 ns mỗi cổng, ngõ ra 20 mA.'],
  HC: ['High-speed CMOS (2-6 V): about 8 ns per gate at 5 V, input threshold at VCC/2, 4 mA outputs.', 'CMOS tốc độ cao (2-6 V): khoảng 8 ns mỗi cổng ở 5 V, ngưỡng vào bằng VCC/2, ngõ ra 4 mA.'],
  HCT: ['High-speed CMOS with TTL input thresholds (1.4 V), a drop-in for LS parts: about 10 ns per gate, 4 mA outputs.', 'CMOS tốc độ cao có ngưỡng vào kiểu TTL (1,4 V), thay thế trực tiếp cho họ LS: khoảng 10 ns mỗi cổng, ngõ ra 4 mA.'],
  AC: ['Advanced CMOS: about 5 ns per gate, 24 mA outputs, input threshold at VCC/2.', 'CMOS cải tiến: khoảng 5 ns mỗi cổng, ngõ ra 24 mA, ngưỡng vào bằng VCC/2.'],
  ACT: ['Advanced CMOS with TTL input thresholds: about 6 ns per gate, 24 mA outputs.', 'CMOS cải tiến có ngưỡng vào kiểu TTL: khoảng 6 ns mỗi cổng, ngõ ra 24 mA.'],
  '4000': ['4000B CMOS (3-18 V, set by the VDD parameter): about 60 ns per gate at 5 V, faster at higher VDD.', 'CMOS 4000B (3-18 V, đặt bằng tham số VDD): khoảng 60 ns mỗi cổng ở 5 V, nhanh hơn khi VDD cao.'],
};

/** Output sink current of the family (A), for the specs. */
const IOUT: Record<LogicFamily, number> = { STD: 16e-3, LS: 8e-3, S: 20e-3, F: 20e-3, ALS: 8e-3, AS: 20e-3, HC: 4e-3, HCT: 4e-3, AC: 24e-3, ACT: 24e-3, '4000': 0.88e-3 };
const VMAX: Record<LogicFamily, number> = { STD: 5.25, LS: 5.25, S: 5.25, F: 5.5, ALS: 5.5, AS: 5.5, HC: 6, HCT: 5.5, AC: 6, ACT: 5.5, '4000': 18 };

function cornerPower(pins: number, cmos: boolean): string {
  const [vcc, gnd] = cmos ? ['VDD', 'VSS'] : ['VCC', 'GND'];
  return `${vcc} = ${pins}, ${gnd} = ${pins / 2}`;
}

/** One part of a type in a family. */
export function logicPart(spec: LogicSpec, fam: LogicFamily): LibraryPartDef {
  const is4000 = fam === '4000';
  const pn = partNumber(spec, fam);
  const power = spec.power ?? cornerPower(spec.pins, is4000);
  const powerText = is4000 ? power.replace(/^VCC/, 'VDD').replace(/GND/, 'VSS') : power.replace(/^VDD/, 'VCC').replace(/VSS/, 'GND');
  const [note, noteVi] = NOTE[fam];
  const left = outputPinType(side(spec.left, 'input'), spec.output);
  const right = outputPinType(side(spec.right, 'output'), spec.output);
  const base = is4000 ? null : FAMILIES[fam];
  const tpd = (is4000 ? 60e-9 : (base!.tplh + base!.tphl) / 2) * (spec.delay ?? 1);
  const group = is4000 || CMOS74_FAMILIES.includes(fam as TtlFamily) ? 'cmos' : 'ttl';
  const numeric = Number(spec.pn.replace(/\D/g, '')) || 0;
  return withMeta(
    {
      id: partIdOf(spec, fam),
      name: pn,
      group,
      family: libraryFamily(fam),
      description: `${spec.name}. ${spec.desc} ${note} Hidden power pins (${powerText}) on the ${is4000 ? 'VDD' : 'VCC'} net.`,
      prefix: 'U',
      symbol: icSymbol(pn, left, right, { w: spec.w }),
      params: [...(is4000 ? [vddParam()] : []), ...(spec.params ?? []), ...powerParams(is4000 ? 'vddnet' : 'vccnet', is4000 ? 'VDD' : 'VCC')],
      toSpice: (ctx) => {
        let levels;
        if (is4000) {
          const vdd = ctx.num('vdd');
          if (!(vdd >= 3 && vdd <= 18)) throw new Error(`bad value for vdd: ${vdd} V (3..18 V)`);
          levels = levelsFor(ctx, cmosLevels(vdd, spec.strong));
        } else levels = levelsFor(ctx, FAMILIES[fam as TtlFamily]);
        const b = new IcBuilder(ctx, levels, `MS_${pn.toUpperCase()}`, powerNodes(ctx, is4000 ? 'vddnet' : 'vccnet', is4000 ? 'VDD' : 'VCC'));
        spec.build(b, fam);
        return { elements: b.elements, models: b.models };
      },
      optionalPins: spec.optional,
      footprint: `DIP-${spec.pins}`,
      keywords: [pn, ...(is4000 ? [`cd${spec.pn}`, `hef${spec.pn}`] : [`74${spec.pn}`, `74xx${spec.pn}`]), group === 'cmos' ? 'cmos' : 'ttl', spec.kind, ...(spec.keywords ?? [])],
      provenance: `MachSim code model (${spec.name.toLowerCase()}); ${is4000 ? '4000B levels and delays scaled with VDD' : `${libraryFamily(fam)} levels, input loading and typical delays`} from public datasheet figures`,
    },
    {
      vi: `${spec.vi}. ${spec.descVi} ${noteVi}`,
      specs: {
        tpd,
        output: spec.output ?? 'totem-pole',
        input: spec.schmitt ? 'schmitt' : 'standard',
        iout: IOUT[fam],
        vsupply: VMAX[fam],
        positions: spec.pins,
        package: `DIP-${spec.pins}`,
      },
      sortKey: numeric,
      series: libraryFamily(fam),
    },
  );
}

/** Every part of a list of types (one per type and family). */
export function logicParts(specs: LogicSpec[]): LibraryPartDef[] {
  const out: LibraryPartDef[] = [];
  for (const s of specs) for (const f of s.fams) out.push(logicPart(s, f));
  return out;
}

// ---------------------------------------------------------------------------------------------
// build helpers

/** Gate sections: [input pin names, output pin name]. */
export type Sections = [string[], string][];

/** One element per section with the same model. */
export function gates(b: IcBuilder, type: string, sections: Sections, factor = 1, extra: Record<string, number> = {}): void {
  const m = b.model(type, factor, extra);
  sections.forEach(([ins, o], i) => b.add(String(i + 1), [...ins, o], m));
}

/** Pin names 'P0'..'P(n-1)' (or with a start index). */
export function names(prefix: string, n: number, from = 0, suffix = ''): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + from}${suffix}`);
}
