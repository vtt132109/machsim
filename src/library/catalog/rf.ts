/**
 * RF catalogue (group RF): RF inductors and capacitors with parasitics, microstrip, stripline and
 * rectangular waveguide sections, planar spiral inductor, interdigital capacitor, ferrite beads
 * and a dual-gate RF MOSFET. (RF bipolar transistors live in bjts.ts, RF power MOSFETs in fets.ts.)
 *
 * Models (published closed-form design equations, approximate):
 *   RF L        L + RS (Q = 40 at 100 MHz) with the parallel winding capacitance that puts the
 *               self-resonance at SRF ≈ 6 GHz·(1 nH / L)^0.45 (typical 0603 wire-wound / multilayer),
 *               damped by a series resistance in the capacitance branch (Q ≈ 20 at the SRF)
 *   RF C        C + ESR 0.1 Ω + ESL 0.5 nH (0603 C0G)
 *   microstrip  Hammerstad–Jensen εeff and Z0 from W, H, εr; lossless line with delay ℓ·√εeff / c
 *   stripline   Cohn: Z0 = 60/√εr·ln(4b / (0.67π·w·(0.8 + t/w))); delay ℓ·√εr / c
 *   waveguide   TE10 mode: fc = c / 2a, wave impedance 377 / √(1 − (fc/f)²) and group delay at the
 *               design frequency — valid only near that frequency
 *   spiral L    modified Wheeler formula (Mohan et al., 1999): L = K1·µ0·n²·davg / (1 + K2·ρ)
 *   IDC         Alley / Bahl: C = (εr + 1)·ℓ·[(N − 3)·A1 + A2]
 *   ferrite     RDC + (R ∥ L) with |Z| at 100 MHz as rated
 */
import type { ElementIR } from '../../sim/netlist';
import { card, elC, elL, elM, elR, elT, internalNode, numParam, type LibraryPartDef } from '../partkit';
import { tlineSymbol } from '../parts/misc';
import { capacitorBody, inductorBody, line, makeSymbol, pin, rect, text, twoPinH } from '../symbols';
import { seriesValues } from '../series';
import { toSpiceNumber } from '../../util/units';
import type { ParamDef, ToSpiceContext } from '../types';
import { eng, userNum, withMeta } from './kit';

const C0 = 299792458;
const MU0 = 4e-7 * Math.PI;
const code = (v: number): string => toSpiceNumber(Number(v.toPrecision(6))).toLowerCase();

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// RF inductors / capacitors

const RFL_SYMBOL = twoPinH([...inductorBody(), text(0, 14, 'RF', 6)]);
const RFC_SYMBOL = twoPinH([...capacitorBody(), text(0, 18, 'RF', 6)]);

function rfInductorParams(l: number): ParamDef[] {
  const srf = 6e9 * Math.pow(1e-9 / l, 0.45);
  return [
    numParam('value', 'Inductance', userNum(l), 'H', { showOnSchematic: true, min: 0, picker: 'E12' }),
    numParam('q', 'Quality factor at 100 MHz', '40', '', { min: 1 }),
    numParam('srf', 'Self-resonant frequency', userNum(Number(srf.toPrecision(2))), 'Hz', { min: 0 }),
  ];
}

const rfInductors: LibraryPartDef[] = seriesValues('E12', 1e-9, 1e-6).map((l) =>
  withMeta(
    {
      id: `rf/rfl-${code(l)}`,
      name: `RF ${eng(l, 'H')}`,
      group: 'rf',
      family: 'RF inductor',
      description: `${eng(l, 'H')} RF inductor (0603) with series loss (Q = 40 at 100 MHz) and self-resonance`,
      prefix: 'L',
      symbol: RFL_SYMBOL,
      params: rfInductorParams(l),
      toSpice: (ctx) => {
        const lv = pos(ctx, 'value');
        const rs = (2 * Math.PI * 100e6 * lv) / pos(ctx, 'q');
        const cp = 1 / (Math.pow(2 * Math.PI * pos(ctx, 'srf'), 2) * lv);
        const m = internalNode(ctx, 'm');
        const x = internalNode(ctx, 'x');
        // the winding capacitance carries the self-resonance damping resistance (Q ≈ 20 at the SRF)
        const rd = Math.sqrt(lv / cp) / 20;
        return {
          elements: [elL(ctx.name('L'), ctx.node('1'), m, lv), elR(ctx.name('R', 's'), m, ctx.node('2'), rs), elR(ctx.name('R', 'p'), ctx.node('1'), x, rd), elC(ctx.name('C', 'p'), x, ctx.node('2'), cp)],
        };
      },
      provenance: 'MachSim RF inductor: L + RS from Q at 100 MHz, parallel winding C from the self-resonant frequency with Q ≈ 20 damping (typical 0603 values)',
      footprint: 'IND-0603',
      keywords: ['rf inductor', 'chip inductor', 'uhf', 'vhf', userNum(l).toLowerCase()],
    },
    { vi: `Cuộn cảm cao tần ${eng(l, 'H')} (0603) có tổn hao nối tiếp (Q = 40 ở 100 MHz) và tần số tự cộng hưởng`, specs: { inductance: l }, sortKey: l, series: 'RF inductor' },
  ),
);

const rfCaps: LibraryPartDef[] = seriesValues('E12', 1e-12, 10e-9).map((c) =>
  withMeta(
    {
      id: `rf/rfc-${code(c)}`,
      name: `RF ${eng(c, 'F')}`,
      group: 'rf',
      family: 'RF capacitor',
      description: `${eng(c, 'F')} C0G RF capacitor (0603) with ESR and ESL (self-resonance at ${eng(1 / (2 * Math.PI * Math.sqrt(c * 0.5e-9)), 'Hz')})`,
      prefix: 'C',
      symbol: RFC_SYMBOL,
      params: [numParam('value', 'Capacitance', userNum(c), 'F', { showOnSchematic: true, min: 0, picker: 'E12' }), numParam('esr', 'ESR', '100m', 'Ω', { min: 0 }), numParam('esl', 'ESL', '500p', 'H', { min: 0 })],
      toSpice: (ctx) => {
        const a = internalNode(ctx, 'a');
        const b = internalNode(ctx, 'b');
        return { elements: [elR(ctx.name('R', 'esr'), ctx.node('1'), a, Math.max(1e-6, ctx.num('esr'))), elL(ctx.name('L', 'esl'), a, b, Math.max(1e-15, ctx.num('esl'))), elC(ctx.name('C'), b, ctx.node('2'), pos(ctx, 'value'))] };
      },
      provenance: 'MachSim RF capacitor: series ESR and ESL (typical 0603 C0G values)',
      footprint: 'CAP-0603',
      keywords: ['rf capacitor', 'c0g', 'np0', 'chip capacitor', userNum(c).toLowerCase()],
    },
    { vi: `Tụ cao tần C0G ${eng(c, 'F')} (0603) có ESR và ESL`, specs: { capacitance: c }, sortKey: c, series: 'RF capacitor' },
  ),
);

// ---------------------------------------------------------------------------------------------
// transmission-line sections

/** Hammerstad–Jensen microstrip: Z0 and εeff from W/H and εr. */
export function microstrip(w: number, h: number, er: number): { z0: number; eeff: number } {
  const u = w / h;
  if (u <= 1) {
    const eeff = (er + 1) / 2 + ((er - 1) / 2) * (1 / Math.sqrt(1 + 12 / u) + 0.04 * (1 - u) * (1 - u));
    return { z0: (60 / Math.sqrt(eeff)) * Math.log(8 / u + u / 4), eeff };
  }
  const eeff = (er + 1) / 2 + ((er - 1) / 2) / Math.sqrt(1 + 12 / u);
  return { z0: (120 * Math.PI) / (Math.sqrt(eeff) * (u + 1.393 + 0.667 * Math.log(u + 1.444))), eeff };
}

/** Cohn stripline (centred strip of width w, thickness t between grounds b apart). */
export function stripline(w: number, b: number, t: number, er: number): number {
  return (60 / Math.sqrt(er)) * Math.log((4 * b) / (0.67 * Math.PI * w * (0.8 + t / w)));
}

const TLINE_SYMBOL = tlineSymbol();

const lines: LibraryPartDef[] = [
  withMeta(
    {
      id: 'rf/microstrip',
      name: 'Microstrip Line',
      group: 'rf',
      family: 'Transmission line',
      description: 'Microstrip line section on a PCB: Z0 and effective permittivity from strip width W, substrate height H and εr (default FR-4, 50 Ω); lossless',
      prefix: 'T',
      symbol: TLINE_SYMBOL,
      params: [numParam('w', 'Strip width W', '3', 'mm', { min: 0, showOnSchematic: true }), numParam('h', 'Substrate height H', '1.6', 'mm', { min: 0 }), numParam('er', 'Relative permittivity εr', '4.4', '', { min: 1 }), numParam('len', 'Length', '50', 'mm', { min: 0 })],
      toSpice: (ctx) => {
        const { z0, eeff } = microstrip(pos(ctx, 'w'), pos(ctx, 'h'), pos(ctx, 'er'));
        const td = (pos(ctx, 'len') * 1e-3 * Math.sqrt(eeff)) / C0;
        return { elements: [elT(ctx.name('T'), ctx.node('A+'), ctx.node('A-'), ctx.node('B+'), ctx.node('B-'), z0, td)] };
      },
      provenance: 'Hammerstad–Jensen closed-form microstrip equations (zero-thickness strip, quasi-static)',
      footprint: 'PCB-TRACE',
      keywords: ['microstrip', 'pcb trace', 'transmission line', '50 ohm', 'rf'],
    },
    { vi: 'Đoạn đường truyền vi dải trên mạch in: Z0 và hằng số điện môi hiệu dụng tính từ độ rộng W, chiều dày đế H và εr (mặc định FR-4, 50 Ω); không tổn hao', nameVi: 'Đường vi dải (microstrip)' },
  ),
  withMeta(
    {
      id: 'rf/stripline',
      name: 'Stripline',
      group: 'rf',
      family: 'Transmission line',
      description: 'Symmetric stripline section (strip between two ground planes): Z0 from strip width, thickness, ground spacing and εr (Cohn); lossless',
      prefix: 'T',
      symbol: TLINE_SYMBOL,
      params: [numParam('w', 'Strip width W', '0.7', 'mm', { min: 0, showOnSchematic: true }), numParam('b', 'Ground plane spacing', '1.6', 'mm', { min: 0 }), numParam('t', 'Strip thickness', '0.035', 'mm', { min: 0 }), numParam('er', 'Relative permittivity εr', '4.4', '', { min: 1 }), numParam('len', 'Length', '50', 'mm', { min: 0 })],
      toSpice: (ctx) => {
        const er = pos(ctx, 'er');
        const z0 = stripline(pos(ctx, 'w'), pos(ctx, 'b'), Math.max(0, ctx.num('t')), er);
        if (!(z0 > 0)) throw new Error('bad value for w: the strip is too wide for the ground spacing');
        const td = (pos(ctx, 'len') * 1e-3 * Math.sqrt(er)) / C0;
        return { elements: [elT(ctx.name('T'), ctx.node('A+'), ctx.node('A-'), ctx.node('B+'), ctx.node('B-'), z0, td)] };
      },
      provenance: 'Cohn closed-form stripline impedance (narrow strip approximation)',
      footprint: 'PCB-TRACE',
      keywords: ['stripline', 'pcb', 'transmission line', 'rf'],
    },
    { vi: 'Đoạn đường truyền dải kẹp đối xứng (dải dẫn giữa hai mặt đất): Z0 tính từ độ rộng, độ dày dải, khoảng cách mặt đất và εr (Cohn); không tổn hao', nameVi: 'Đường dải kẹp (stripline)' },
  ),
  ...(
    [
      ['waveguide', 'Rectangular Waveguide', 'Ống dẫn sóng chữ nhật', 22.86, 10.16, '10G'],
      ['waveguide-wr62', 'Waveguide WR-62', 'Ống dẫn sóng WR-62', 15.8, 7.9, '15G'],
      ['waveguide-wr137', 'Waveguide WR-137', 'Ống dẫn sóng WR-137', 34.85, 15.8, '6G'],
    ] as const
  ).map(([slugId, name, nameVi, a, b, f0]) =>
    withMeta(
      {
        id: `rf/${slugId}`,
        name,
        group: 'rf',
        family: 'Transmission line',
        description: `Rectangular waveguide section (TE10 mode, a = ${a} mm, b = ${b} mm, cutoff ${eng(C0 / (2 * a * 1e-3), 'Hz')}), modelled as a line with the wave impedance and delay at the design frequency`,
        prefix: 'T',
        symbol: TLINE_SYMBOL,
        params: [numParam('a', 'Broad wall a', String(a), 'mm', { min: 0 }), numParam('b', 'Narrow wall b', String(b), 'mm', { min: 0 }), numParam('f0', 'Design frequency', f0, 'Hz', { min: 0, showOnSchematic: true }), numParam('len', 'Length', '100', 'mm', { min: 0 })],
        toSpice: (ctx) => {
          const fc = C0 / (2 * pos(ctx, 'a') * 1e-3);
          const f0v = pos(ctx, 'f0');
          if (!(f0v > fc)) throw new Error(`bad value for f0: below the TE10 cutoff ${eng(fc, 'Hz')}`);
          const k = Math.sqrt(1 - (fc / f0v) * (fc / f0v));
          const z0 = 376.73 / k;
          const td = (pos(ctx, 'len') * 1e-3) / (C0 * k);
          return { elements: [elT(ctx.name('T'), ctx.node('A+'), ctx.node('A-'), ctx.node('B+'), ctx.node('B-'), z0, td)] };
        },
        provenance: 'TE10 rectangular-waveguide relations (cutoff c/2a, wave impedance, group velocity) evaluated at the design frequency',
        footprint: 'WAVEGUIDE',
        keywords: ['waveguide', 'microwave', 'te10', 'rf'],
      },
      { vi: `Đoạn ống dẫn sóng chữ nhật (mode TE10, a = ${a} mm, b = ${b} mm, tần số cắt ${eng(C0 / (2 * a * 1e-3), 'Hz')}), mô hình hoá như đường truyền có trở kháng sóng và độ trễ ở tần số thiết kế`, nameVi },
    ),
  ),
];

// ---------------------------------------------------------------------------------------------
// planar passives

/** Modified Wheeler inductance of a square planar spiral (H). */
export function spiralInductance(n: number, dout: number, din: number): number {
  const davg = (dout + din) / 2;
  const rho = (dout - din) / (dout + din);
  return (2.34 * MU0 * n * n * davg) / (1 + 2.75 * rho);
}

/** Alley / Bahl interdigital capacitance (F); lengths in µm. */
export function interdigitalCapacitance(n: number, len: number, w: number, h: number, er: number): number {
  const a1 = 4.409 * Math.tanh(0.55 * Math.pow(h / w, 0.45)) * 1e-6;
  const a2 = 9.92 * Math.tanh(0.52 * Math.pow(h / w, 0.5)) * 1e-6;
  return (er + 1) * len * ((n - 3) * a1 + a2) * 1e-12;
}

const SPIRAL_SYMBOL = twoPinH([rect(-14, -14, 28, 28), rect(-9, -9, 18, 18), rect(-4, -4, 8, 8), line(-20, 0, -14, 0), line(14, 0, 20, 0)]);
const IDC_SYMBOL = twoPinH([line(-20, 0, -12, 0), line(12, 0, 20, 0), line(-12, -12, -12, 12), line(12, -12, 12, 12), line(-12, -9, 6, -9), line(-12, 0, 6, 0), line(-12, 9, 6, 9), line(12, -4, -6, -4), line(12, 4, -6, 4)]);

const planar: LibraryPartDef[] = [
  withMeta(
    {
      id: 'rf/spiral-inductor',
      name: 'Spiral Inductor',
      group: 'rf',
      family: 'RF inductor',
      description: 'Square planar spiral inductor: L from turns, outer and inner diameter (modified Wheeler formula), with series metal resistance and shunt capacitance',
      prefix: 'L',
      symbol: SPIRAL_SYMBOL,
      params: [
        numParam('turns', 'Turns', '3.5', '', { min: 1, showOnSchematic: true }),
        numParam('dout', 'Outer diameter', '300u', 'm', { min: 0 }),
        numParam('din', 'Inner diameter', '100u', 'm', { min: 0 }),
        numParam('rs', 'Series resistance', '2', 'Ω', { min: 0 }),
        numParam('cp', 'Shunt capacitance', '50f', 'F', { min: 0 }),
      ],
      toSpice: (ctx) => {
        const dout = pos(ctx, 'dout');
        const din = pos(ctx, 'din');
        if (!(dout > din)) throw new Error('bad value for din: must be smaller than the outer diameter');
        const l = spiralInductance(pos(ctx, 'turns'), dout, din);
        const m = internalNode(ctx, 'm');
        const els: ElementIR[] = [elL(ctx.name('L'), ctx.node('1'), m, l), elR(ctx.name('R', 's'), m, ctx.node('2'), Math.max(1e-6, ctx.num('rs')))];
        const cp = ctx.num('cp');
        if (cp > 0) els.push(elC(ctx.name('C', 'p'), ctx.node('1'), ctx.node('2'), cp));
        return { elements: els };
      },
      provenance: 'Modified Wheeler expression for square spirals (Mohan, Hershenson, Boyd, Lee, IEEE JSSC 1999)',
      footprint: 'PCB-SPIRAL',
      keywords: ['spiral inductor', 'planar inductor', 'mmic', 'rfic', 'rf'],
    },
    { vi: 'Cuộn cảm xoắn phẳng hình vuông: L tính từ số vòng, đường kính ngoài và trong (công thức Wheeler cải tiến), có điện trở kim loại nối tiếp và điện dung song song', nameVi: 'Cuộn cảm xoắn phẳng' },
  ),
  withMeta(
    {
      id: 'rf/interdigital-capacitor',
      name: 'Interdigital Capacitor',
      group: 'rf',
      family: 'RF capacitor',
      description: 'Planar interdigital capacitor: C from the number of fingers, finger length and width, substrate height and εr (Alley / Bahl closed form)',
      prefix: 'C',
      symbol: IDC_SYMBOL,
      params: [
        numParam('fingers', 'Number of fingers', '10', '', { min: 4, showOnSchematic: true }),
        numParam('len', 'Finger length', '500', 'µm', { min: 0 }),
        numParam('w', 'Finger width', '10', 'µm', { min: 0 }),
        numParam('h', 'Substrate height', '635', 'µm', { min: 0 }),
        numParam('er', 'Relative permittivity εr', '9.8', '', { min: 1 }),
      ],
      toSpice: (ctx) => ({ elements: [elC(ctx.name('C'), ctx.node('1'), ctx.node('2'), interdigitalCapacitance(pos(ctx, 'fingers'), pos(ctx, 'len'), pos(ctx, 'w'), pos(ctx, 'h'), pos(ctx, 'er')))] }),
      provenance: 'Alley (1970) / Bahl interdigital capacitor closed-form expression',
      footprint: 'PCB-IDC',
      keywords: ['interdigital capacitor', 'planar capacitor', 'mmic', 'rf'],
    },
    { vi: 'Tụ răng lược phẳng: C tính từ số răng, chiều dài và độ rộng răng, chiều dày đế và εr (công thức Alley / Bahl)', nameVi: 'Tụ răng lược' },
  ),
];

// ---------------------------------------------------------------------------------------------
// ferrite beads

const BEAD_SYMBOL = twoPinH([rect(-12, -6, 24, 12, true), line(-20, 0, -12, 0), line(12, 0, 20, 0)]);
const BEADS: [z: number, rdc: number, pkg: string][] = [
  [30, 0.015, '0603'],
  [60, 0.025, '0603'],
  [120, 0.04, '0603'],
  [220, 0.05, '0603'],
  [330, 0.08, '0603'],
  [470, 0.1, '0603'],
  [600, 0.15, '0603'],
  [1000, 0.3, '0805'],
  [1500, 0.4, '0805'],
  [2200, 0.6, '0805'],
];

const beads: LibraryPartDef[] = BEADS.map(([z, rdc, pkg]) => {
  const r = 1.4 * z;
  const xl = (r * z) / Math.sqrt(r * r - z * z);
  const l = xl / (2 * Math.PI * 100e6);
  return withMeta(
    {
      id: `rf/ferrite-bead-${z}`,
      name: `Ferrite Bead ${z} Ω`,
      group: 'rf',
      family: 'Ferrite bead',
      description: `Ferrite bead, ${z} Ω at 100 MHz, RDC ${eng(rdc, 'Ω')} (${pkg}): low resistance at DC, lossy impedance at RF`,
      prefix: 'FB',
      symbol: BEAD_SYMBOL,
      params: [],
      toSpice: (ctx) => {
        const m = internalNode(ctx, 'm');
        return { elements: [elR(ctx.name('R', 'dc'), ctx.node('1'), m, rdc), elL(ctx.name('L'), m, ctx.node('2'), l), elR(ctx.name('R', 'p'), m, ctx.node('2'), r)] };
      },
      provenance: `MachSim ferrite-bead model: RDC + (R ∥ L) with |Z| = ${z} Ω at 100 MHz (R = 1.4·Z)`,
      footprint: `FB-${pkg}`,
      keywords: ['ferrite bead', 'emi', 'filter', 'chip bead'],
    },
    { vi: `Hạt ferrite chống nhiễu, ${z} Ω ở 100 MHz, RDC ${eng(rdc, 'Ω')} (${pkg}): điện trở nhỏ ở DC, trở kháng tổn hao ở cao tần`, nameVi: `Hạt ferrite ${z} Ω`, specs: { resistance: z, package: pkg }, sortKey: z, series: 'Ferrite bead' },
  );
});

// ---------------------------------------------------------------------------------------------
// dual-gate RF MOSFETs

const DG_SYMBOL = makeSymbol(
  [line(-30, -10, -12, -10), line(-30, 10, -12, 10), line(-12, -16, -12, -4, 2), line(-12, 4, -12, 16, 2), line(-6, -18, -6, 18, 2), line(-6, -14, 10, -14), line(10, -14, 10, -30), line(-6, 14, 10, 14), line(10, 14, 10, 30)],
  [pin('G1', -30, 10, 'left', { number: '3', type: 'input' }), pin('G2', -30, -10, 'left', { number: '4', type: 'input' }), pin('D', 10, -30, 'up', { number: '2' }), pin('S', 10, 30, 'down', { number: '1' })],
  { refPos: { x: 24, y: -6 }, valuePos: { x: 24, y: 8 } },
);

const dualGate: LibraryPartDef[] = (
  [
    ['BF998', -0.6, 16e-3],
    ['BF992', -0.8, 20e-3],
  ] as const
).map(([pn, vto, kp]) => {
  const m = card(`MS_${pn}`, 'NMOS', { level: 1, vto, kp, lambda: 0.02, cgso: 2e-12 / 100e-6, cgdo: 0.025e-12 / 100e-6 });
  return withMeta(
    {
      id: `rf/${pn.toLowerCase()}`,
      name: pn,
      group: 'rf',
      family: 'RF transistor',
      description: 'Dual-gate N-channel depletion MOSFET for VHF / UHF amplifiers and mixers (G1 signal, G2 gain control)',
      prefix: 'Q',
      symbol: DG_SYMBOL,
      params: [],
      toSpice: (ctx) => {
        const mid = internalNode(ctx, 'mid');
        return {
          elements: [elM(ctx.name('M', '1'), mid, ctx.node('G1'), ctx.node('S'), ctx.node('S'), m.name, { w: 100e-6, l: 100e-6 }), elM(ctx.name('M', '2'), ctx.node('D'), ctx.node('G2'), mid, ctx.node('S'), m.name, { w: 100e-6, l: 100e-6 })],
          models: [m],
        };
      },
      provenance: `MachSim cascode of two level-1 depletion MOSFETs approximating the ${pn} datasheet transfer characteristic (VGS(off) ≈ ${vto} V)`,
      footprint: 'SOT-143',
      keywords: [pn.toLowerCase(), 'dual gate', 'mosfet', 'vhf', 'uhf', 'mixer', 'agc'],
    },
    { vi: 'MOSFET kênh N hai cổng chế độ nghèo cho khuếch đại và trộn tần VHF / UHF (G1 tín hiệu, G2 điều khiển hệ số khuếch đại)', specs: { vth: vto, package: 'SOT-143' }, series: 'RF MOSFET' },
  );
});

export const RF_CATALOG: LibraryPartDef[] = [...rfInductors, ...planar, ...rfCaps, ...lines, ...beads, ...dualGate];
