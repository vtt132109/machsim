/**
 * Analog IC catalogue (group Analog): op-amps, comparators, instrumentation amplifiers, voltage
 * references and 555-family timers.
 *
 * Models (MachSim behavioural macromodels parameterised from datasheet typical values):
 *   op-amp        opampSubckt() of src/library/parts/analog.ts (one section of dual / quad
 *                 parts): AVOL, GBW, slew rate, RIN, ROUT, VOS, IQ, output headroom, ISC.
 *   comparator    comparatorSubckt(): response time constant, IQ, open-collector or push-pull.
 *   in-amp        the classic three-op-amp topology built from the op-amp macromodel: two input
 *                 buffers with internal feedback resistors RF (gain set by the external RG
 *                 between RG1 and RG2: G = 1 + 2·RF / RG) and a unity-gain difference stage
 *                 referred to REF. With RG open the gain is 1.
 *   reference     shunt types: the three-element Zener model with a 1 mA test current and the
 *                 datasheet dynamic impedance; series types: the behavioural regulator of
 *                 src/library/parts/power.ts with the datasheet dropout and quiescent current.
 *   timer         the behavioural 555 of src/library/parts/analog.ts with the output-high drop,
 *                 supply current and discharge resistance of each variant (bipolar / CMOS).
 */
import type { ElementIR, SubcktDef } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import { comparatorSubckt, comparatorSymbol, opampNodes, opampSubckt, REAL_OPAMPS, type OpampParams } from '../parts/analog';
import { makeSectionParts } from '../sectionKit';
import { opampPackageParts } from './opampSections';
import { posRegulator, type RegSpec } from '../parts/power';
import { zenerFragment } from '../parts/diodes';
import { elB, elC, elR, elX, subckt, type LibraryPartDef } from '../partkit';
import { ampSymbol, boxSymbol, diodeBody, twoPinH } from '../symbols';
import type { SymbolDef, ToSpiceContext } from '../types';
import { eng, modelName, slug, withMeta } from './kit';

const n = (s: string, pn: string): number => {
  const v = parseUserNumber(s);
  if (!Number.isFinite(v)) throw new Error(`bad analog catalogue value '${s}' in ${pn}`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// op-amps: "names avol gbw slew rin rout vos iq vsatp vsatn isc vmax input rr package"
//   names: one or more part numbers sharing the section data, joined by '/'; ':2' / ':4' marks a
//          dual / quad package (the part is one section of it)
//   input: bipolar | jfet | cmos;  rr: - | o (rail-to-rail output) | io (rail-to-rail in/out)

const OPAMP_TEXT = [
  'LM2904:2 100k 1M 0.3M 10M 50 2m 0.35m 1.5 20m 40m 26 bipolar - DIP-8',
  'LM2902:4 100k 1.2M 0.5M 10M 50 2m 0.18m 1.5 20m 40m 26 bipolar - DIP-14',
  'LM301A 160k 1M 0.5M 2M 75 2m 1.8m 1.5 1.5 25m 36 bipolar - DIP-8',
  'LM307 160k 1M 0.5M 2M 75 2m 1.8m 1.5 1.5 25m 36 bipolar - DIP-8',
  'LM308 300k 0.3M 0.15M 40M 75 2m 0.3m 1 1 5m 36 bipolar - DIP-8',
  'LM318 200k 15M 70M 3M 50 4m 5m 2 2 21m 40 bipolar - DIP-8',
  'LF351/LF353:2 100k 4M 13M 1T 100 5m 1.8m 1.5 1.5 20m 36 jfet - DIP-8',
  'LF356 200k 5M 12M 1T 100 3m 5m 1.5 1.5 20m 44 jfet - DIP-8',
  'LF411/LF412:2 200k 4M 15M 1T 100 0.8m 1.8m 1.5 1.5 25m 36 jfet - DIP-8',
  'TL061/TL062:2/TL064:4 6k 1M 3.5M 1T 100 3m 0.2m 1.5 1.5 15m 36 jfet - DIP-8',
  'TL072:2/TL074:4 200k 3M 13M 1T 100 3m 1.4m 1.5 1.5 40m 36 jfet - DIP-8',
  'TL082:2/TL084:4 200k 3M 13M 1T 100 3m 1.4m 1.5 1.5 40m 36 jfet - DIP-8',
  'NE5534 100k 10M 13M 100k 50 0.5m 4m 1 1 38m 44 bipolar - DIP-8',
  'OP27 1.8M 8M 2.8M 6M 70 10u 3m 1.5 1.5 25m 44 bipolar - DIP-8',
  'OP37 1.8M 63M 17M 6M 70 10u 3m 1.5 1.5 25m 44 bipolar - DIP-8',
  'OP177 12M 0.6M 0.3M 45M 60 10u 1.6m 1.5 1.5 30m 44 bipolar - DIP-8',
  'OP97 2M 0.9M 0.2M 30M 100 10u 0.38m 1 1 10m 40 bipolar - DIP-8',
  'OPA134/OPA2134:2 1M 8M 20M 10T 50 0.5m 4m 1 1 40m 36 jfet - DIP-8',
  'OPA627 1M 16M 55M 10T 50 0.1m 7m 1.5 1.5 45m 36 jfet - DIP-8',
  'OPA604/OPA2604:2 300k 20M 25M 10T 50 1m 5.3m 1.5 1.5 35m 48 jfet - DIP-8',
  'OPA350 3M 38M 22M 10T 20 0.15m 5.2m 10m 10m 40m 5.5 cmos io SO-8',
  'OPA340/OPA2340:2 3M 5.5M 6M 10T 30 0.15m 0.75m 5m 5m 50m 5.5 cmos io SO-8',
  'OPA376 1M 5.5M 2M 10T 30 5u 0.76m 10m 10m 30m 5.5 cmos io SO-8',
  'OPA1611/OPA1612:2 3M 40M 27M 20k 10 0.1m 3.6m 1 1 55m 36 bipolar - SO-8',
  'OPA277/OPA2277:2 3M 1M 0.8M 100M 50 10u 0.8m 1 1 35m 36 bipolar - DIP-8',
  'MCP6001/MCP6002:2/MCP6004:4 400k 1M 0.6M 10T 50 4.5m 0.1m 25m 25m 6m 6 cmos io SOT-23-5',
  'MCP601 100k 2.8M 2.3M 10T 50 2m 0.23m 15m 15m 22m 6 cmos o DIP-8',
  'MCP6271 100k 2M 0.9M 10T 50 3m 0.17m 15m 15m 25m 6 cmos io DIP-8',
  'LMV321/LMV358:2/LMV324:4 100k 1M 1M 10T 50 1.7m 0.13m 10m 10m 60m 5.5 cmos o SOT-23-5',
  'LM6132 100k 10M 14M 10M 50 2m 0.36m 50m 50m 10m 24 bipolar io DIP-8',
  'AD8605 300k 10M 5M 10T 30 20u 1.2m 20m 20m 80m 5.5 cmos io SOT-23-5',
  'AD8610 300k 25M 50M 10T 50 0.1m 2.5m 1.5 1.5 30m 26 jfet - SO-8',
  'AD820/AD822:2 1M 1.9M 3M 10T 60 0.4m 0.62m 10m 10m 15m 36 jfet o DIP-8',
  'AD8031/AD8032:2 12k 80M 30M 300k 20 1.5m 0.75m 30m 30m 50m 12 bipolar io SO-8',
  'AD797 20M 110M 20M 7.5k 3 25u 8.2m 2 2 80m 36 bipolar - DIP-8',
  'AD711/AD712:2 400k 4M 20M 3T 50 0.3m 2.5m 1.5 1.5 25m 36 jfet - DIP-8',
  'CA3140 100k 4.5M 9M 1.5T 60 5m 4m 3 0.15 40m 36 cmos - DIP-8',
  'CA3130 100k 15M 10M 1.5T 50 8m 10m 10m 10m 20m 16 cmos o DIP-8',
  'LT1001 800k 0.8M 0.25M 80M 60 18u 2.1m 1 1 30m 44 bipolar - DIP-8',
  'LT1028 20M 75M 15M 20M 20 10u 7.4m 1.5 1.5 30m 44 bipolar - DIP-8',
  'LT1013:2/LT1014:4 7M 0.8M 0.4M 400M 100 40u 0.35m 1 5m 20m 44 bipolar - DIP-8',
  'LT1006 1.5M 0.9M 0.4M 400M 100 20u 0.34m 1 5m 20m 44 bipolar - DIP-8',
  'LM833:2 300k 15M 7M 175k 37 0.3m 2.5m 1.5 1.5 40m 36 bipolar - DIP-8',
  'LM4558:2/RC4558:2/NJM4558:2 100k 2.8M 1.7M 5M 75 0.5m 2.5m 1.5 1.5 25m 44 bipolar - DIP-8',
  'NJM4580:2 300k 15M 5M 10M 75 0.5m 3m 1 1 50m 36 bipolar - DIP-8',
  'LM6171 10k 100M 3.6G 4M 14 1.5m 2.5m 1.5 1.5 100m 36 bipolar - DIP-8',
  'LM7171 3.6k 200M 4.1G 3M 15 0.2m 6.5m 1.5 1.5 100m 36 bipolar - DIP-8',
  'LM837:4 300k 25M 10M 1M 50 0.3m 2.5m 1.5 1.5 40m 36 bipolar - DIP-14',
  'TLV2372:2 100k 3M 2.4M 1T 50 2m 0.55m 10m 10m 30m 16 cmos io SO-8',
  'TLV2462:2 300k 6.4M 1.6M 1T 30 0.3m 0.5m 50m 50m 80m 6 cmos io SO-8',
  'TLC2272:2/TLC2274:4 200k 2.2M 3.6M 1T 50 0.3m 1.1m 50m 50m 30m 16 cmos o DIP-8',
  'TLC272:2/TLC274:4 25k 1.7M 3.6M 1T 100 1.1m 0.7m 1.2 10m 30m 18 cmos - DIP-8',
  'LMC6482:2/LMC6484:4 3M 1.5M 1.3M 10T 50 0.11m 0.5m 5m 5m 30m 15.5 cmos io DIP-8',
  'LMC7101 100k 1M 1M 10T 50 0.11m 0.8m 10m 10m 30m 15.5 cmos io SOT-23-5',
  'LM8261 100k 21M 12M 10M 50 0.7m 1m 30m 30m 50m 30 bipolar io SOT-23-5',
  'LM6142 100k 17M 25M 10M 50 0.9m 0.65m 10m 10m 10m 24 bipolar io DIP-8',
  'MAX4166 100k 5M 2M 10M 50 0.25m 1.3m 20m 20m 50m 6.5 bipolar io SO-8',
  'MAX4238 1M 1M 0.35M 10T 50 2u 0.6m 10m 10m 20m 6 cmos io SOT-23-5',
  // wideband voltage-feedback amplifiers (round 3)
  'OPA656 1.8k 230M 290M 1T 10 0.25m 14m 1.7 1.7 70m 13 jfet - SO-8',
  'THS4031 30k 100M 100M 10M 20 0.5m 8.5m 1.5 1.5 90m 33 bipolar - SO-8',
  'AD8065 100k 145M 180M 1T 10 0.4m 6.4m 1.2 1.2 30m 24 jfet o SOT-23-5',
];

const OPAMP_SYMBOL = ampSymbol({ supplies: true });
const INPUT_VI: Record<string, string> = { bipolar: 'lưỡng cực', jfet: 'JFET', cmos: 'CMOS' };

/** Dual / quad types of the hand-written op-amps (parts/analog.ts) that also exist as packages with sections. */
const HAND_WRITTEN_PACKAGES: Record<string, 2 | 4> = { LM358: 2, LM324: 4, NE5532: 2 };

/** The whole chip and the sections of every dual / quad op-amp type (round 4 step 4). */
const opampPackages: LibraryPartDef[] = [
  ...REAL_OPAMPS.filter((o) => HAND_WRITTEN_PACKAGES[o.pn] !== undefined).flatMap((o) =>
    opampPackageParts({
      pn: o.pn,
      channels: HAND_WRITTEN_PACKAGES[o.pn],
      sub: opampSubckt(`MS_${o.pn}`, o.p),
      footprint: o.footprint,
      en: o.description.replace(/ \(one section[^)]*\)/, ''),
      vi: `Khuếch đại thuật toán ${o.pn}`,
      provenance: `MachSim op-amp macromodel parameterised from ${o.pn} datasheet typical values: ${o.source}`,
      keywords: [o.pn.toLowerCase(), 'op-amp', 'opamp', 'operational amplifier', ...o.keywords],
    }),
  ),
  ...OPAMP_TEXT.flatMap(opampRowPackages),
];

/** The whole chip and the sections of the dual / quad types named in one op-amp table row (round 4: also used by the library-breadth packs). */
export function opampRowPackages(t: string): LibraryPartDef[] {
    const f = t.split(/\s+/);
    const p: OpampParams = { avol: n(f[1], f[0]), gbw: n(f[2], f[0]), slew: n(f[3], f[0]), rin: n(f[4], f[0]), rout: n(f[5], f[0]), vos: n(f[6], f[0]), iq: n(f[7], f[0]), vsatp: n(f[8], f[0]), vsatn: n(f[9], f[0]), isc: n(f[10], f[0]) };
    return f[0].split('/').flatMap((x) => {
      const [pn, ch] = x.split(':');
      if (ch !== '2' && ch !== '4') return [];
      const input = f[12];
      return opampPackageParts({
        pn,
        channels: ch === '4' ? 4 : 2,
        sub: opampSubckt(modelName(pn), p),
        footprint: ch === '4' ? (f[14].startsWith('DIP') ? 'DIP-14' : 'SO-14') : f[14] === 'SOT-23-5' ? 'SO-8' : f[14],
        en: `${input === 'jfet' ? 'JFET-input' : input === 'cmos' ? 'CMOS' : 'Bipolar'} op-amp ${pn}: GBW ${eng(p.gbw, 'Hz')}, SR ${eng(p.slew / 1e6, 'V/µs')}, VOS ${eng(p.vos, 'V')}`,
        vi: `Khuếch đại thuật toán ${input === 'jfet' ? 'đầu vào JFET' : input === 'cmos' ? 'CMOS' : INPUT_VI.bipolar} ${pn}: GBW ${eng(p.gbw, 'Hz')}, tốc độ quét ${eng(p.slew / 1e6, 'V/µs')}, VOS ${eng(p.vos, 'V')}`,
        provenance: `MachSim op-amp macromodel parameterised from ${pn} datasheet typical values: AVOL ${eng(p.avol, 'V/V')}, GBW ${eng(p.gbw, 'Hz')}, SR ${eng(p.slew / 1e6, 'V/µs')}, RIN ${eng(p.rin, 'Ω')}, VOS ${eng(p.vos, 'V')}, IQ ${eng(p.iq, 'A')}, ISC ${eng(p.isc, 'A')}`,
        keywords: [pn.toLowerCase(), 'op-amp', 'opamp', 'operational amplifier', input],
      });
    });
}

const opamps: LibraryPartDef[] = OPAMP_TEXT.flatMap(opampRowParts);

/** The parts (one per name, a section of the dual / quad where marked) of one op-amp table row. */
export function opampRowParts(t: string): LibraryPartDef[] {
  const f = t.split(/\s+/);
  const names = f[0].split('/').map((x) => {
    const [pn, ch] = x.split(':');
    return { pn, ch: ch ? Number(ch) : 1 };
  });
  const pn0 = names[0].pn;
  const p: OpampParams = { avol: n(f[1], pn0), gbw: n(f[2], pn0), slew: n(f[3], pn0), rin: n(f[4], pn0), rout: n(f[5], pn0), vos: n(f[6], pn0), iq: n(f[7], pn0), vsatp: n(f[8], pn0), vsatn: n(f[9], pn0), isc: n(f[10], pn0) };
  const vmax = n(f[11], pn0);
  const input = f[12];
  const rr = f[13];
  const pkg = f[14];
  return names.map(({ pn, ch }) => {
    const sub = opampSubckt(modelName(pn), p);
    const sections = ch === 4 ? ' (one section of the quad)' : ch === 2 ? ' (one section of the dual)' : '';
    const sectionsVi = ch === 4 ? ' (một kênh của IC bốn kênh)' : ch === 2 ? ' (một kênh của IC hai kênh)' : '';
    const rrEn = rr === 'io' ? ', rail-to-rail input / output' : rr === 'o' ? ', rail-to-rail output' : '';
    const rrVi = rr === 'io' ? ', vào / ra sát nguồn' : rr === 'o' ? ', ra sát nguồn' : '';
    const figures = `GBW ${eng(p.gbw, 'Hz')}, SR ${eng(p.slew / 1e6, 'V/µs')}, VOS ${eng(p.vos, 'V')}, supply ≤ ${vmax} V`;
    const figuresVi = `GBW ${eng(p.gbw, 'Hz')}, tốc độ quét ${eng(p.slew / 1e6, 'V/µs')}, VOS ${eng(p.vos, 'V')}, nguồn ≤ ${vmax} V`;
    return withMeta(
      {
        id: `analog/${slug(pn)}`,
        name: pn,
        group: 'analog',
        family: 'Op-amp',
        description: `${input === 'jfet' ? 'JFET-input' : input === 'cmos' ? 'CMOS' : 'Bipolar'} op-amp${rrEn}${sections}: ${figures}`,
        prefix: 'U',
        symbol: OPAMP_SYMBOL,
        params: [],
        toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), opampNodes(ctx), sub.name)], subckts: [sub] }),
        provenance: `MachSim op-amp macromodel parameterised from ${pn} datasheet typical values: AVOL ${eng(p.avol, 'V/V')}, GBW ${eng(p.gbw, 'Hz')}, SR ${eng(p.slew / 1e6, 'V/µs')}, RIN ${eng(p.rin, 'Ω')}, VOS ${eng(p.vos, 'V')}, IQ ${eng(p.iq, 'A')}, ISC ${eng(p.isc, 'A')}`,
        footprint: ch === 4 ? (pkg.startsWith('DIP') ? 'DIP-14' : 'SO-14') : pkg,
        keywords: [pn.toLowerCase(), 'op-amp', 'opamp', 'operational amplifier', input, rr !== '-' ? 'rail-to-rail' : 'standard'],
      },
      {
        vi: `Khuếch đại thuật toán ${input === 'jfet' ? 'đầu vào JFET' : input === 'cmos' ? 'CMOS' : INPUT_VI.bipolar}${rrVi}${sectionsVi}: ${figuresVi}`,
        specs: { gbw: p.gbw, slew: p.slew, vos: p.vos, vsupply: vmax, iq: p.iq, input, output: rr === '-' ? 'standard' : 'rail-to-rail', package: pkg },
        sortKey: p.gbw,
        series: 'Op-amp',
      },
    );
  });
}

// ---------------------------------------------------------------------------------------------
// comparators: "pn tresp iq oc|pp vmax package"

const COMP_TEXT = [
  'LM2903 300n 0.4m oc 36 DIP-8',
  'LM2901 300n 0.2m oc 36 DIP-14',
  'LM319 80n 4m oc 36 DIP-14',
  'LM306 40n 10m oc 24 DIP-8',
  'LM360 6n 20m pp 13 DIP-8',
  'LM361 14n 20m pp 30 DIP-14',
  'LM397 440n 0.25m oc 30 SOT-23-5',
  'TLV3501 4.5n 3.2m pp 5.5 SOT-23-6',
  'LMV331 200n 40u oc 5.5 SOT-23-5',
  'LMV393 200n 40u oc 5.5 SO-8',
  'LMV339 200n 40u oc 5.5 SO-14',
  'LT1016 10n 25m pp 15 DIP-8',
  'AD8561 7n 7m pp 10 SO-8',
  'TLC3702 1.1u 20u pp 16 DIP-8',
  'TLC372 200n 150u oc 18 DIP-8',
  'MCP6541 4u 0.6u pp 5.5 SOT-23-5',
];

const COMP_SYMBOL = comparatorSymbol();
/** One comparator table row ("pn tresp iq oc|pp vmax package"). */
export function comparatorRow(t: string): LibraryPartDef {
  const [pn, trS, iqS, out, vmaxS, pkg] = t.split(/\s+/);
  const tresp = n(trS, pn);
  const iq = n(iqS, pn);
  const oc = out === 'oc';
  const sub = comparatorSubckt(modelName(pn), { tresp, vhys: 0, iq, oc });
  return withMeta(
    {
      id: `analog/${slug(pn)}`,
      name: pn,
      group: 'analog',
      family: 'Comparator',
      description: `Voltage comparator, ${oc ? 'open-collector' : 'push-pull'} output, response ≈ ${eng(tresp, 's')}, IQ ${eng(iq, 'A')}, supply ≤ ${vmaxS} V`,
      prefix: 'U',
      symbol: COMP_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), opampNodes(ctx), sub.name)], subckts: [sub] }),
      provenance: `MachSim behavioural comparator parameterised from the ${pn} datasheet: response time ≈ ${eng(tresp, 's')}, supply current ${eng(iq, 'A')}, ${oc ? 'open-collector' : 'push-pull'} output`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'comparator', oc ? 'open collector' : 'push-pull'],
    },
    {
      vi: `Bộ so sánh điện áp, ngõ ra ${oc ? 'collector hở' : 'kéo-đẩy'}, thời gian đáp ứng ≈ ${eng(tresp, 's')}, IQ ${eng(iq, 'A')}, nguồn ≤ ${vmaxS} V`,
      specs: { iq, vsupply: n(vmaxS, pn), output: oc ? 'open-collector' : 'push-pull', package: pkg },
      sortKey: tresp,
      series: 'Comparator',
    },
  );
}

const comparators: LibraryPartDef[] = COMP_TEXT.map(comparatorRow);

// ---------------------------------------------------------------------------------------------
// instrumentation amplifiers (three-op-amp topology with external RG)

interface InAmpRow {
  pn: string;
  rf: number;
  rd: number;
  amp: OpampParams;
  formula: string;
  pkg: string;
  input: string;
}

const BIP: OpampParams = { avol: 1e6, gbw: 1.3e6, slew: 4e6, rin: 10e9, rout: 50, vos: 10e-6, iq: 0.25e-3, vsatp: 1.2, vsatn: 1.2, isc: 25e-3 };
const INAMPS: InAmpRow[] = [
  { pn: 'INA128', rf: 25e3, rd: 40e3, amp: BIP, formula: 'G = 1 + 50 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
  { pn: 'INA129', rf: 24.7e3, rd: 40e3, amp: BIP, formula: 'G = 1 + 49.4 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
  { pn: 'INA118', rf: 25e3, rd: 60e3, amp: { ...BIP, gbw: 0.8e6, slew: 0.9e6, iq: 0.12e-3 }, formula: 'G = 1 + 50 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
  { pn: 'INA121', rf: 25e3, rd: 40e3, amp: { ...BIP, gbw: 0.6e6, slew: 0.7e6, rin: 1e12, vos: 0.2e-3, iq: 0.15e-3 }, formula: 'G = 1 + 50 kΩ / RG', pkg: 'DIP-8', input: 'jfet' },
  { pn: 'INA333', rf: 50e3, rd: 100e3, amp: { ...BIP, gbw: 0.15e6, slew: 0.16e6, rin: 1e12, vos: 10e-6, iq: 0.017e-3, vsatp: 0.05, vsatn: 0.05, isc: 10e-3 }, formula: 'G = 1 + 100 kΩ / RG', pkg: 'MSOP-8', input: 'cmos' },
  { pn: 'INA826', rf: 24.7e3, rd: 40e3, amp: { ...BIP, gbw: 1e6, slew: 1e6, iq: 0.2e-3, vsatn: 0.1 }, formula: 'G = 1 + 49.4 kΩ / RG', pkg: 'SO-8', input: 'bipolar' },
  { pn: 'AD620', rf: 24.7e3, rd: 10e3, amp: { ...BIP, gbw: 1e6, slew: 1.2e6, vos: 30e-6, iq: 0.3e-3 }, formula: 'G = 1 + 49.4 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
  { pn: 'AD622', rf: 25.25e3, rd: 10e3, amp: { ...BIP, gbw: 1e6, slew: 1.2e6, vos: 60e-6, iq: 0.3e-3 }, formula: 'G = 1 + 50.5 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
  { pn: 'AD8221', rf: 24.7e3, rd: 20e3, amp: { ...BIP, gbw: 0.8e6, slew: 2e6, vos: 25e-6, iq: 0.3e-3 }, formula: 'G = 1 + 49.4 kΩ / RG', pkg: 'SO-8', input: 'bipolar' },
  { pn: 'LT1167', rf: 24.7e3, rd: 10e3, amp: { ...BIP, gbw: 1e6, slew: 1.2e6, vos: 15e-6, iq: 0.3e-3 }, formula: 'G = 1 + 49.4 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
  // round 3: more three-op-amp in-amps (datasheet gain equations, typical G = 1 bandwidth / slew rate)
  { pn: 'AD623', rf: 50e3, rd: 50e3, amp: { ...BIP, gbw: 0.8e6, slew: 0.3e6, vos: 25e-6, iq: 0.375e-3, vsatp: 0.1, vsatn: 0.1 }, formula: 'G = 1 + 100 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
  { pn: 'AD8421', rf: 4.95e3, rd: 10e3, amp: { ...BIP, gbw: 10e6, slew: 35e6, vos: 25e-6, iq: 2e-3 }, formula: 'G = 1 + 9.9 kΩ / RG', pkg: 'SO-8', input: 'bipolar' },
  { pn: 'AD8422', rf: 9.9e3, rd: 10e3, amp: { ...BIP, gbw: 2.2e6, slew: 0.8e6, vos: 25e-6, iq: 0.33e-3 }, formula: 'G = 1 + 19.8 kΩ / RG', pkg: 'SO-8', input: 'bipolar' },
  { pn: 'AD8226', rf: 24.7e3, rd: 20e3, amp: { ...BIP, gbw: 1.5e6, slew: 0.4e6, vos: 100e-6, iq: 0.35e-3 }, formula: 'G = 1 + 49.4 kΩ / RG', pkg: 'SO-8', input: 'bipolar' },
  { pn: 'INA819', rf: 25e3, rd: 20e3, amp: { ...BIP, gbw: 2e6, slew: 0.9e6, vos: 35e-6, iq: 0.35e-3 }, formula: 'G = 1 + 50 kΩ / RG', pkg: 'SO-8', input: 'bipolar' },
  { pn: 'INA821', rf: 24.7e3, rd: 20e3, amp: { ...BIP, gbw: 4.7e6, slew: 2e6, vos: 35e-6, iq: 0.6e-3 }, formula: 'G = 1 + 49.4 kΩ / RG', pkg: 'SO-8', input: 'bipolar' },
  { pn: 'INA163', rf: 3e3, rd: 10e3, amp: { ...BIP, gbw: 3.4e6, slew: 15e6, vos: 0.2e-3, iq: 12e-3 }, formula: 'G = 1 + 6 kΩ / RG', pkg: 'SO-14', input: 'bipolar' },
  { pn: 'INA217', rf: 5e3, rd: 10e3, amp: { ...BIP, gbw: 1.3e6, slew: 15e6, vos: 0.1e-3, iq: 10e-3 }, formula: 'G = 1 + 10 kΩ / RG', pkg: 'DIP-8', input: 'bipolar' },
];

const INAMP_SYMBOL: SymbolDef = boxSymbol({
  w: 80,
  h: 80,
  left: [{ name: 'IN-', label: '−', number: '2', type: 'input' }, { name: 'RG1', number: '1' }, { name: 'RG2', number: '8' }, { name: 'IN+', label: '+', number: '3', type: 'input' }],
  right: [{ name: 'OUT', number: '6', type: 'output' }, { name: 'REF', number: '5' }],
  top: [{ name: 'V+', number: '7', type: 'power' }],
  bottom: [{ name: 'V-', label: 'V−', number: '4', type: 'power' }],
  title: 'INA',
  titleSize: 9,
  titlePos: { x: 6, y: -24 },
});

const inamps: LibraryPartDef[] = INAMPS.map((r) => {
  const amp = opampSubckt(modelName(r.pn, 'AMP'), r.amp);
  const els: ElementIR[] = [
    elX('X1', ['inp', 'rg1', 'o1', 'vcc', 'vee'], amp.name),
    elR('RF1', 'o1', 'rg1', r.rf),
    elX('X2', ['inn', 'rg2', 'o2', 'vcc', 'vee'], amp.name),
    elR('RF2', 'o2', 'rg2', r.rf),
    elR('R1', 'o2', 'm', r.rd),
    elR('R2', 'm', 'out', r.rd),
    elR('R3', 'o1', 'p', r.rd),
    elR('R4', 'p', 'ref', r.rd),
    elX('X3', ['p', 'm', 'out', 'vcc', 'vee'], amp.name),
  ];
  const sub: SubcktDef = subckt(modelName(r.pn), ['inp', 'inn', 'rg1', 'rg2', 'ref', 'out', 'vcc', 'vee'], els);
  sub.subckts[amp.name.toLowerCase()] = amp;
  return withMeta(
    {
      id: `analog/${slug(r.pn)}`,
      name: r.pn,
      group: 'analog',
      family: 'Instrumentation amplifier',
      description: `Instrumentation amplifier, gain set by RG between RG1 and RG2: ${r.formula} (RG open: G = 1)`,
      prefix: 'U',
      symbol: INAMP_SYMBOL,
      params: [],
      optionalPins: ['RG1', 'RG2'],
      toSpice: (ctx) => ({
        elements: [elX(ctx.name('X'), [ctx.node('IN+'), ctx.node('IN-'), ctx.node('RG1'), ctx.node('RG2'), ctx.node('REF'), ctx.node('OUT'), ctx.node('V+'), ctx.node('V-')], sub.name)],
        subckts: [sub],
      }),
      provenance: `MachSim three-op-amp model of the ${r.pn}: internal RF = ${eng(r.rf, 'Ω')} (${r.formula}), ${eng(r.rd, 'Ω')} difference stage, op-amp sections with datasheet GBW ${eng(r.amp.gbw, 'Hz')} and slew rate`,
      footprint: r.pkg,
      keywords: [r.pn.toLowerCase(), 'instrumentation amplifier', 'in-amp', 'bridge amplifier', 'differential'],
    },
    { vi: `Khuếch đại đo lường, hệ số khuếch đại đặt bằng RG nối giữa RG1 và RG2: ${r.formula} (để hở RG: G = 1)`, specs: { gbw: r.amp.gbw, input: r.input, package: r.pkg }, sortKey: r.rf, series: 'In-amp' },
  );
});

// ---------------------------------------------------------------------------------------------
// voltage references

/** Shunt: "pn vref zzt package". */
const SHUNT_TEXT = [
  'LM4040-2.0 2.048 0.3 SOT-23',
  'LM4040-2.5 2.5 0.3 SOT-23',
  'LM4040-3.0 3.0 0.4 SOT-23',
  'LM4040-4.1 4.096 0.5 SOT-23',
  'LM4040-5.0 5.0 0.5 SOT-23',
  'LM4040-8.2 8.192 0.6 SOT-23',
  'LM4040-10 10.0 0.7 SOT-23',
  'LM4041-1.2 1.225 0.5 SOT-23',
  'LM385-1.2 1.235 0.6 TO-92',
  'LM385-2.5 2.5 0.6 TO-92',
  'LM336-2.5 2.49 0.2 TO-92',
  'LM336-5.0 5.0 0.6 TO-92',
  'LT1004-1.2 1.235 0.4 TO-92',
  'LT1004-2.5 2.5 0.4 TO-92',
  'LT1009 2.5 0.2 TO-92',
  'ICL8069 1.23 1 TO-92',
];

const SHUNT_SYMBOL = twoPinH(diodeBody('zener'), { names: ['A', 'K'] });

/** One shunt-reference table row ("pn vref zzt package"). */
export function shuntRow(t: string): LibraryPartDef {
  const [pn, vS, zS, pkg] = t.split(/\s+/);
  const vref = n(vS, pn);
  const zzt = n(zS, pn);
  // forward / breakdown junction model; the 1 mA test point sits on the reference voltage
  const z = { vz: vref, izt: 1e-3, zzt, cjo: 20e-12 };
  return withMeta(
    {
      id: `analog/${slug(pn)}`,
      name: pn,
      group: 'analog',
      family: 'Voltage reference',
      description: `${vref} V precision shunt reference (use with a series resistor like a Zener), dynamic impedance ≈ ${zzt} Ω`,
      prefix: 'D',
      symbol: SHUNT_SYMBOL,
      params: [],
      toSpice: (ctx: ToSpiceContext) => zenerFragment(ctx, pn.replace(/[^A-Za-z0-9]/g, '_'), z),
      provenance: `MachSim Zener-type model of the ${pn}: VR = ${vref} V at 1 mA, dynamic impedance ${zzt} Ω (datasheet typical)`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'voltage reference', 'shunt reference', 'precision'],
    },
    { vi: `Nguồn áp chuẩn kiểu song song ${vref} V (dùng với điện trở nối tiếp như diode Zener), trở kháng động ≈ ${zzt} Ω`, specs: { vout: vref, package: pkg }, sortKey: vref, series: 'Shunt reference' },
  );
}

const shuntRefs: LibraryPartDef[] = SHUNT_TEXT.map(shuntRow);

/** Series: "pn vout dropout iq iout package". */
const SERIES_TEXT = [
  'REF01 10 2 1m 10m DIP-8',
  'REF02 5 2 1m 10m DIP-8',
  'REF03 2.5 2 1m 10m DIP-8',
  'REF5025 2.5 0.2 0.8m 10m SO-8',
  'REF5050 5 0.2 0.8m 10m SO-8',
  'REF3030 3.0 0.05 50u 25m SOT-23',
  'REF3033 3.3 0.05 50u 25m SOT-23',
  'ADR4525 2.5 0.3 0.7m 10m SO-8',
  'ADR4550 5 0.3 0.7m 10m SO-8',
  'AD580 2.5 2 1m 10m TO-52',
  'MAX6125 2.5 0.2 0.1m 10m SOT-23',
  'LT1460-2.5 2.5 0.2 0.13m 20m SO-8',
  'LT1460-5 5 0.2 0.13m 20m SO-8',
];

const SERIES_SYMBOL: SymbolDef = boxSymbol({ w: 60, h: 40, left: [{ name: 'IN', number: '2', type: 'power' }], right: [{ name: 'OUT', number: '6', type: 'power' }], bottom: [{ name: 'GND', number: '4' }], title: 'REF', titleSize: 9, titlePos: { x: 0, y: -6 } });

/** One series-reference table row ("pn vout dropout iq iout package"). */
export function seriesRow(t: string): LibraryPartDef {
  const [pn, vS, dS, iqS, ioS, pkg] = t.split(/\s+/);
  const s: RegSpec = { pn, kind: 'pos', v: n(vS, pn), vdo: n(dS, pn), ilim: n(ioS, pn) * 2, iq: n(iqS, pn), rout: 0.05, description: '', footprint: pkg };
  const sub = posRegulator(modelName(pn), s);
  return withMeta(
    {
      id: `analog/${slug(pn)}`,
      name: pn,
      group: 'analog',
      family: 'Voltage reference',
      description: `${s.v} V precision series reference, dropout ${s.vdo} V, up to ${eng(s.ilim / 2, 'A')} output, IQ ${eng(s.iq, 'A')}`,
      prefix: 'U',
      symbol: SERIES_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('IN'), ctx.node('GND'), ctx.node('OUT')], sub.name)], subckts: [sub] }),
      provenance: `MachSim behavioural series reference from the ${pn} datasheet: VOUT ${s.v} V, dropout ${s.vdo} V, quiescent current ${eng(s.iq, 'A')}, output ${eng(s.ilim / 2, 'A')}`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'voltage reference', 'series reference', 'precision'],
    },
    { vi: `Nguồn áp chuẩn kiểu nối tiếp ${s.v} V, sụt áp tối thiểu ${s.vdo} V, dòng ra tới ${eng(s.ilim / 2, 'A')}, IQ ${eng(s.iq, 'A')}`, specs: { vout: s.v, dropout: s.vdo, iq: s.iq, package: pkg }, sortKey: s.v, series: 'Series reference' },
  );
}

const seriesRefs: LibraryPartDef[] = SERIES_TEXT.map(seriesRow);

// ---------------------------------------------------------------------------------------------
// timers

interface TimerVariant {
  pn: string;
  /** output-high drop below VCC, V */
  vdrop: number;
  iq: number;
  /** minimum supply for full supply current, V */
  vmin: number;
  cmos: boolean;
}

/** 555 core (ports gnd trig out rst ctrl thr dis vcc) — the behavioural model of parts/analog.ts with variant data. */
function timerCore(name: string, v: TimerVariant): SubcktDef {
  return subckt(name, ['gnd', 'trig', 'out', 'rst', 'ctrl', 'thr', 'dis', 'vcc'], [
    elR('R1', 'vcc', 'ctrl', v.cmos ? 100e3 : 5000),
    elR('R2', 'ctrl', 'lo', v.cmos ? 100e3 : 5000),
    elR('R3', 'lo', 'gnd', v.cmos ? 100e3 : 5000),
    elR('RRST', 'vcc', 'rst', 100e3),
    elB('BS', 's', '0', 'V', '0.5+0.5*tanh(200*(V(lo)-V(trig)))'),
    elB('BR', 'r', '0', 'V', '0.5+0.5*tanh(200*(V(thr)-V(ctrl)))'),
    elB('BX', 'x', '0', 'V', '0.5+0.5*tanh(200*(0.7-V(rst,gnd)))'),
    elB('BL', 'qr', '0', 'V', '0.5+0.5*tanh(8*(V(q)-0.5)+24*V(s)-12*V(r)-40*V(x)-60*(1-u(time)))'),
    elR('RQ', 'qr', 'q', 1000),
    elC('CQ', 'q', '0', 10e-12),
    elB('BQD', 'qd', '0', 'V', '0.5+0.5*tanh(20*(V(q)-0.5))'),
    elB('BO', 'o1', 'gnd', 'V', `V(qd)*max(V(vcc,gnd)-${v.vdrop},0)+(1-V(qd))*min(${v.cmos ? 0.05 : 0.1},max(V(vcc,gnd),0))`),
    elR('RO', 'o1', 'out', v.cmos ? 30 : 10),
    elB('BD', 'dis', 'gnd', 'I', `(1-V(qd))*limit(V(dis,gnd)/${v.cmos ? 15 : 10},-0.2,0.2)`),
    elB('BQ', 'vcc', 'gnd', 'I', `${v.iq}*limit(V(vcc,gnd)/${v.vmin},0,1)+max(-I(BO),0)`),
  ]);
}

const TIMERS: TimerVariant[] = [
  { pn: 'NE555', vdrop: 1.7, iq: 3e-3, vmin: 4.5, cmos: false },
  { pn: 'SA555', vdrop: 1.7, iq: 3e-3, vmin: 4.5, cmos: false },
  { pn: 'LM555', vdrop: 1.7, iq: 3e-3, vmin: 4.5, cmos: false },
  { pn: 'NA555', vdrop: 1.7, iq: 3e-3, vmin: 4.5, cmos: false },
  { pn: 'TLC555', vdrop: 0.1, iq: 170e-6, vmin: 2, cmos: true },
  { pn: 'ICM7555', vdrop: 0.1, iq: 60e-6, vmin: 2, cmos: true },
  { pn: 'LMC555', vdrop: 0.1, iq: 100e-6, vmin: 1.5, cmos: true },
  { pn: 'TS555', vdrop: 0.1, iq: 110e-6, vmin: 2, cmos: true },
];

const TIMER_SYMBOL = (title: string): SymbolDef =>
  boxSymbol({
    w: 80,
    h: 60,
    left: [{ name: 'TRIG', number: '2', type: 'input' }, { name: 'THR', number: '6', type: 'input' }, { name: 'CTRL', label: 'CV', number: '5' }],
    right: [{ name: 'OUT', number: '3', type: 'output' }, { name: 'DIS', number: '7' }],
    top: [{ name: 'RST', label: 'R', number: '4', type: 'input' }, { name: 'VCC', label: 'V', number: '8', type: 'power' }],
    bottom: [{ name: 'GND', label: 'G', number: '1', type: 'power' }],
    title,
    titlePos: { x: 0, y: 4 },
  });

const timers: LibraryPartDef[] = TIMERS.map((v) => {
  const core = timerCore(modelName(v.pn), v);
  const kind = v.cmos ? 'CMOS' : 'bipolar';
  return withMeta(
    {
      id: `analog/${slug(v.pn)}`,
      name: v.pn,
      group: 'analog',
      family: 'Timer',
      description: `${kind} 555 timer (astable / monostable), output high ≈ VCC − ${v.vdrop} V, supply current ${eng(v.iq, 'A')}; f ≈ 1.44 / ((RA + 2RB)·C)`,
      prefix: 'U',
      symbol: TIMER_SYMBOL('555'),
      params: [],
      optionalPins: ['CTRL', 'RST'],
      toSpice: (ctx) => ({
        elements: [elX(ctx.name('X'), [ctx.node('GND'), ctx.node('TRIG'), ctx.node('OUT'), ctx.node('RST'), ctx.node('CTRL'), ctx.node('THR'), ctx.node('DIS'), ctx.node('VCC')], core.name)],
        subckts: [core],
      }),
      provenance: `MachSim behavioural 555 with the ${v.pn} datasheet output-high drop (${v.vdrop} V), supply current (${eng(v.iq, 'A')}) and ${v.cmos ? 'CMOS (high-impedance divider)' : 'bipolar (3 × 5 kΩ divider)'} internals`,
      footprint: 'DIP-8',
      keywords: [v.pn.toLowerCase(), '555', 'timer', 'astable', 'monostable', v.cmos ? 'cmos' : 'bipolar'],
    },
    { vi: `IC định thời 555 loại ${v.cmos ? 'CMOS' : 'lưỡng cực'} (đa hài / đơn ổn), mức ra cao ≈ VCC − ${v.vdrop} V, dòng nguồn ${eng(v.iq, 'A')}; f ≈ 1.44 / ((RA + 2RB)·C)`, specs: { iq: v.iq, vsupply: v.cmos ? 15 : 16, package: 'DIP-8' }, sortKey: v.iq, series: '555' },
  );
});

/** NE556 / TLC556: two 555 cores in one 14-pin package. */
const DUAL_TIMERS: TimerVariant[] = [
  { pn: 'NE556', vdrop: 1.7, iq: 6e-3, vmin: 4.5, cmos: false },
  { pn: 'TLC556', vdrop: 0.1, iq: 340e-6, vmin: 2, cmos: true },
];

const dualTimers: LibraryPartDef[] = DUAL_TIMERS.map((v) => {
  const core = timerCore(modelName(v.pn), { ...v, iq: v.iq / 2 });
  const sym = boxSymbol({
    w: 100,
    h: 120,
    left: [
      { name: 'TRIG1', number: '6', type: 'input' },
      { name: 'THR1', number: '2', type: 'input' },
      { name: 'CTRL1', label: 'CV1', number: '3' },
      { name: 'TRIG2', number: '8', type: 'input' },
      { name: 'THR2', number: '12', type: 'input' },
      { name: 'CTRL2', label: 'CV2', number: '11' },
    ],
    right: [
      { name: 'OUT1', number: '5', type: 'output' },
      { name: 'DIS1', number: '1' },
      { name: 'RST1', label: 'R1', number: '4', type: 'input' },
      { name: 'OUT2', number: '9', type: 'output' },
      { name: 'DIS2', number: '13' },
      { name: 'RST2', label: 'R2', number: '10', type: 'input' },
    ],
    top: [{ name: 'VCC', label: 'V', number: '14', type: 'power' }],
    bottom: [{ name: 'GND', label: 'G', number: '7', type: 'power' }],
    title: '556',
  });
  const node = (ctx: ToSpiceContext, k: 1 | 2) => [ctx.node('GND'), ctx.node(`TRIG${k}`), ctx.node(`OUT${k}`), ctx.node(`RST${k}`), ctx.node(`CTRL${k}`), ctx.node(`THR${k}`), ctx.node(`DIS${k}`), ctx.node('VCC')];
  return withMeta(
    {
      id: `analog/${slug(v.pn)}`,
      name: v.pn,
      group: 'analog',
      family: 'Timer',
      description: `Dual ${v.cmos ? 'CMOS' : 'bipolar'} 555 timer (two independent timers, shared supply), supply current ${eng(v.iq, 'A')}`,
      prefix: 'U',
      symbol: sym,
      params: [],
      optionalPins: ['CTRL1', 'CTRL2', 'RST1', 'RST2', 'TRIG2', 'THR2', 'OUT2', 'DIS2'],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X', '1'), node(ctx, 1), core.name), elX(ctx.name('X', '2'), node(ctx, 2), core.name)], subckts: [core] }),
      provenance: `Two MachSim behavioural 555 cores with the ${v.pn} datasheet output drop and supply current`,
      footprint: 'DIP-14',
      keywords: [v.pn.toLowerCase(), '556', 'dual timer', 'timer'],
    },
    { vi: `Hai IC định thời 555 ${v.cmos ? 'CMOS' : 'lưỡng cực'} trong một vỏ (hai bộ độc lập, chung nguồn), dòng nguồn ${eng(v.iq, 'A')}`, specs: { iq: v.iq, package: 'DIP-14' }, sortKey: v.iq + 1, series: '556' },
  );
});

/** NE556 / TLC556 section by section: each timer with its own pins and the shared VCC / GND. */
const dualTimerSections: LibraryPartDef[] = dualTimers.flatMap((pkg) => {
  const numbers = new Map(pkg.symbol.pins.map((p) => [p.name, p.number]));
  const drafts = ([1, 2] as const).map((k) => {
    const base = TIMER_SYMBOL('555');
    const rename = (name: string): string => (name === 'VCC' || name === 'GND' ? name : `${name}${k}`);
    const pins = base.pins.map((p) => ({ ...p, name: rename(p.name), number: numbers.get(rename(p.name)) }));
    return { letter: String.fromCharCode(64 + k), symbol: { ...base, pins }, own: pins.map((p) => p.name), optionalPins: [`CTRL${k}`, `RST${k}`] };
  });
  return makeSectionParts(pkg, drafts, { en: '555 timer', vi: 'bộ định thời 555' });
});

export const ANALOG_CATALOG: LibraryPartDef[] = [...opamps, ...opampPackages, ...comparators, ...inamps, ...shuntRefs, ...seriesRefs, ...timers, ...dualTimers, ...dualTimerSections];
