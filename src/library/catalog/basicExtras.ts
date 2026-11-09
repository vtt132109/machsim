/**
 * Basic-group families of round 3: the parts a learner meets in a real lab that the ideal R, L, C
 * do not show, plus drawing-only symbols.
 *
 * Non-ideal RLC   resistor with lead inductance Ls and parallel capacitance Cp; capacitor with
 *                 ESR, ESL and leakage; inductor with winding resistance, parallel (winding)
 *                 capacitance and optional core loss; non-ideal electrolytic. The AC sweep shows the
 *                 self-resonance f = 1/(2π√(L·C)) of each (capacitor: ESL with C, inductor: L with
 *                 Cp, resistor: Ls with Cp).
 * Z load          a complex impedance given at one frequency f as R + jX or as |Z|∠φ, realised as
 *                 R in series (or in parallel) with the L (X > 0) or C (X < 0) that has reactance
 *                 X at f: exact at f, frequency dependent like that R-L / R-C pair elsewhere.
 * Resistor pack   bussed SIP networks (n − 1 resistors to pin 1), isolated DIP / SIP networks,
 *                 dual (Thevenin) terminators: one part with many pins.
 * Socket          IC sockets: placeholders for the BOM; every pin only passes its net through
 *                 (LibraryPartDef.annotation = 'placeholder', not simulated).
 * Schematic symbols  test point, signal arrows, antenna, chassis / earth markers, no-connect mark:
 *                 drawing symbols only (annotation = 'symbol'); they never join the SPICE ground.
 * Switch          DIP switch packs and keypad matrices with one control per position / key
 *                 (InteractiveDef.controls: click the position or press its key while the
 *                 simulation runs), single-pole rotary switches (click a contact or press R).
 * Transformer     multi-winding transformers (1 + 2, 1 + 3, 2 + 2 windings), three coupled
 *                 inductors with a coupling factor per pair, a saturating transformer and a
 *                 saturating inductor (nonlinear core, below).
 * Controlled RLC  resistor, capacitor and inductor whose value follows a control voltage
 *                 (R / C / L = base + gain·V(C+,C−), clamped to a minimum).
 * 3D learner parts   pictorial symbols (colour bands, LED dome, can, TO-92, DIP) of everyday parts
 *                 with fixed values; electrically they are the generic part (same model, same
 *                 breadboard body).
 *
 * NONLINEAR CORE (saturating transformer / inductor): the flux linkage λ = ∫v dt of the
 * magnetising branch is integrated on a 1 F node; the magnetising current is
 *   i(λ) = λ/Lm · (1 + (λ/λsat)^8),
 * an odd, smooth, monotonic curve that is linear (inductance Lm) well below λsat and rises
 * steeply above it — the knee of a real B-H curve without hysteresis. The secondary windings are
 * ideal transformer windings (E / F controlled sources) with their copper resistance, so the
 * turns ratio is exact and only the magnetising current saturates.
 */
import type { ElementIR } from '../../sim/netlist';
import { BASIC_PARTS } from '../parts/basic';
import { DIODE_PARTS } from '../parts/diodes';
import { TRANSISTOR_PARTS } from '../parts/transistors';
import { ANALOG_PARTS } from '../parts/analog';
import { boolOf, boolParam, elB, elC, elE, elF, elG, elK, elL, elR, elSense, ex, internalNode, keyParam, numParam, optNum, selectParam, textOf, textParam, type LibraryPartDef } from '../partkit';
import { arc, arrowHead, boxSymbol, capacitorBody, circle, humps, humpsV, inductorBody, line, makeSymbol, path, pin, poly, rect, resistorBody, text, twoPinH, zigzag } from '../symbols';
import { seriesValues } from '../series';
import type { InteractiveControl, ParamDef, PinDef, SymbolPrim, ToSpiceContext } from '../types';
import { toSpiceNumber } from '../../util/units';
import { eng, userNum, withMeta } from './kit';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};
const nonNeg = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v >= 0)) throw new Error(`bad value for ${key}: must be >= 0`);
  return v;
};
/** Optional positive param: blank or 0 = element left out. */
const optPos = (ctx: ToSpiceContext, key: string): number => {
  const v = optNum(ctx, key);
  if (v === undefined) return 0;
  if (!(v >= 0)) throw new Error(`bad value for ${key}: must be >= 0`);
  return v;
};
const code = (v: number): string => toSpiceNumber(Number(v.toPrecision(6))).toLowerCase();

function icParam(unit: string, label: string): ParamDef {
  return numParam('ic', label, '', unit, { group: 'advanced', help: 'Initial condition used with "use initial conditions" (blank = none)' });
}

// ---------------------------------------------------------------------------------------------
// Non-ideal RLC

/** Vertical zigzag from (x, y0) to (x, y1). */
function zigzagV(x: number, y0: number, y1: number, amp = 4, peaks = 6): number[] {
  const pts = [x, y0];
  const step = (y1 - y0) / peaks;
  for (let i = 0; i < peaks; i++) pts.push(x + (i % 2 === 0 ? -amp : amp), y0 + (i + 0.5) * step);
  pts.push(x, y1);
  return pts;
}

/** Small parasitic capacitor drawn above a body from x = -24 to 24 (thin plates at x = ±2). */
function parasiticCap(y = -14): SymbolPrim[] {
  return [line(-24, 0, -24, y), line(-24, y, -2, y), line(-2, y - 4, -2, y + 4), line(2, y - 4, 2, y + 4), line(2, y, 24, y), line(24, y, 24, 0)];
}

const NI_R_SYMBOL = twoPinH([poly(zigzag(-14, 14, 0, 5, 6)), ...humps(-22, -14, 0, 1), ...parasiticCap()], { bodyHalf: 22, valuePos: { x: 0, y: 20 } });
const NI_C_SYMBOL = twoPinH(
  [poly(zigzag(-22, -14, 0, 3, 3)), ...humps(-14, -6, 0, 2), line(-6, 0, -3, 0), line(-3, -10, -3, 10, 2), line(3, -10, 3, 10, 2), line(3, 0, 22, 0)],
  { bodyHalf: 22 },
);
const NI_ECAP_SYMBOL = twoPinH(
  [poly(zigzag(-22, -14, 0, 3, 3)), ...humps(-14, -6, 0, 2), line(-6, 0, -3, 0), line(-3, -10, -3, 10, 2), arc(11, 0, 10, 135, 225), line(1, 0, 22, 0), text(-11, -9, '+', 9)],
  { names: ['+', '-'], bodyHalf: 22 },
);
const NI_L_SYMBOL = twoPinH([poly(zigzag(-22, -14, 0, 3, 3)), ...humps(-14, 22, 0, 3), ...parasiticCap(-16)], { bodyHalf: 22, valuePos: { x: 0, y: 20 } });

const nonIdealResistor = withMeta(
  {
    id: 'basic/nonideal-resistor',
    name: 'Non-Ideal Resistor',
    group: 'basic',
    family: 'Non-ideal RLC',
    description: 'Resistor with its lead inductance Ls in series and its parallel capacitance Cp: |Z| falls above f = 1/(2π·R·Cp) (or rises when Ls dominates); self-resonance near 1/(2π√(Ls·Cp))',
    prefix: 'R',
    symbol: NI_R_SYMBOL,
    params: [
      numParam('value', 'Resistance', '1k', 'Ω', { showOnSchematic: true, min: 0, picker: 'E24' }),
      numParam('ls', 'Series inductance', '15n', 'H', { min: 0, help: 'Inductance of the leads and the resistive element (about 1 nH per mm of lead); 0 = none' }),
      numParam('cp', 'Parallel capacitance', '0.3p', 'F', { min: 0, help: 'Capacitance between the end caps; it bypasses large resistances at high frequency; 0 = none' }),
      numParam('tolerance', 'Tolerance', '5', '%', { group: 'advanced', min: 0, help: 'Used by Monte Carlo / worst-case analyses and the BOM' }),
    ],
    toSpice: (ctx) => {
      const r = pos(ctx, 'value');
      const ls = nonNeg(ctx, 'ls');
      const cp = nonNeg(ctx, 'cp');
      const a = ctx.node('1');
      const b = ctx.node('2');
      const els: ElementIR[] = [];
      if (ls > 0) {
        const m = internalNode(ctx, 'l');
        els.push(elL(ctx.name('L', 's'), a, m, ls), elR(ctx.name('R'), m, b, r));
      } else els.push(elR(ctx.name('R'), a, b, r));
      if (cp > 0) els.push(elC(ctx.name('C', 'p'), a, b, cp));
      return { elements: els };
    },
    provenance: 'Textbook high-frequency equivalent circuit of a resistor (R + Ls in series, Cp across); default parasitics typical of a 0.25 W axial resistor',
    footprint: 'RES-AXIAL-400',
    keywords: ['non-ideal', 'nonideal', 'parasitic', 'real resistor', 'lead inductance', 'stray capacitance', 'resistor'],
  },
  {
    vi: 'Điện trở có điện cảm chân Ls nối tiếp và điện dung ký sinh Cp song song: |Z| giảm khi tần số vượt 1/(2π·R·Cp) (hoặc tăng khi Ls trội); cộng hưởng riêng gần 1/(2π√(Ls·Cp))',
    nameVi: 'Điện trở không lý tưởng',
  },
);

function capElements(ctx: ToSpiceContext, a: string, b: string): ElementIR[] {
  const c = pos(ctx, 'value');
  const esr = nonNeg(ctx, 'esr');
  const esl = nonNeg(ctx, 'esl');
  const rleak = optPos(ctx, 'rleak');
  const ic = optNum(ctx, 'ic');
  const els: ElementIR[] = [];
  let n = a;
  if (esr > 0) {
    const m = internalNode(ctx, 'r');
    els.push(elR(ctx.name('R', 'esr'), n, m, esr));
    n = m;
  }
  if (esl > 0) {
    const m = internalNode(ctx, 'l');
    els.push(elL(ctx.name('L', 'esl'), n, m, esl));
    n = m;
  }
  els.push(elC(ctx.name('C'), n, b, c, ic === undefined ? {} : { ic }));
  if (rleak > 0) els.push(elR(ctx.name('R', 'leak'), n, b, rleak));
  return els;
}

function capParams(value: string, esr: string, esl: string, rleak: string, picker: 'E12' | 'E6', vr: string): ParamDef[] {
  return [
    numParam('value', 'Capacitance', value, 'F', { showOnSchematic: true, min: 0, picker }),
    numParam('esr', 'Equivalent series resistance (ESR)', esr, 'Ω', { min: 0, help: 'Loss resistance of the plates, leads and electrolyte; sets the impedance at the self-resonance; 0 = none' }),
    numParam('esl', 'Equivalent series inductance (ESL)', esl, 'H', { min: 0, help: 'Inductance of the leads and plates; above the self-resonance 1/(2π√(ESL·C)) the capacitor behaves like an inductor; 0 = none' }),
    numParam('rleak', 'Leakage resistance', rleak, 'Ω', { min: 0, help: 'Insulation (leakage) resistance across the capacitance; blank or 0 = none' }),
    icParam('V', 'Initial voltage'),
    numParam('tolerance', 'Tolerance', '10', '%', { group: 'advanced', min: 0 }),
    numParam('vrating', 'Voltage rating', vr, 'V', { group: 'advanced', min: 0 }),
  ];
}

const nonIdealCapacitor = withMeta(
  {
    id: 'basic/nonideal-capacitor',
    name: 'Non-Ideal Capacitor',
    group: 'basic',
    family: 'Non-ideal RLC',
    description: 'Capacitor with ESR and ESL in series and a leakage resistance across it: capacitive below the self-resonance f = 1/(2π√(ESL·C)), |Z| = ESR at f, inductive above',
    prefix: 'C',
    symbol: NI_C_SYMBOL,
    params: capParams('100n', '30m', '2n', '1G', 'E12', '50'),
    toSpice: (ctx) => ({ elements: capElements(ctx, ctx.node('1'), ctx.node('2')) }),
    provenance: 'Textbook series R-L-C model of a capacitor with a parallel leakage resistance; defaults typical of a 100 nF multilayer ceramic capacitor (ESL ≈ 2 nH)',
    footprint: 'CAP-RADIAL-200',
    keywords: ['non-ideal', 'nonideal', 'esr', 'esl', 'leakage', 'self-resonance', 'srf', 'real capacitor', 'capacitor', 'decoupling'],
  },
  {
    vi: 'Tụ điện có ESR và ESL nối tiếp cùng điện trở rò song song: tính dung dưới tần số cộng hưởng riêng f = 1/(2π√(ESL·C)), |Z| = ESR tại f, tính cảm ở trên',
    nameVi: 'Tụ điện không lý tưởng',
  },
);

const nonIdealElectrolytic = withMeta(
  {
    id: 'basic/nonideal-electrolytic',
    name: 'Non-Ideal Electrolytic Capacitor',
    group: 'basic',
    family: 'Non-ideal RLC',
    description: 'Electrolytic capacitor with its typical large ESR, ESL and leakage current (+ on the left): the impedance floor ESR and the self-resonance show in an AC sweep',
    prefix: 'C',
    symbol: NI_ECAP_SYMBOL,
    params: capParams('100u', '150m', '10n', '1M', 'E6', '25'),
    toSpice: (ctx) => ({ elements: capElements(ctx, ctx.node('+'), ctx.node('-')) }),
    provenance: 'Textbook series R-L-C model with leakage; defaults typical of a 100 µF / 25 V radial aluminium electrolytic (ESR ≈ 0.15 Ω at 100 kHz, leakage ≈ 0.01·C·V)',
    footprint: 'CAP-RADIAL-250',
    keywords: ['non-ideal', 'nonideal', 'esr', 'esl', 'electrolytic', 'leakage', 'ripple', 'real capacitor'],
  },
  {
    vi: 'Tụ hoá có ESR, ESL và dòng rò điển hình (cực + bên trái): phân tích AC thấy mức trở kháng nhỏ nhất bằng ESR và điểm cộng hưởng riêng',
    nameVi: 'Tụ hoá không lý tưởng',
  },
);

const nonIdealInductor = withMeta(
  {
    id: 'basic/nonideal-inductor',
    name: 'Non-Ideal Inductor',
    group: 'basic',
    family: 'Non-ideal RLC',
    description: 'Inductor with its winding resistance in series and its winding capacitance Cp across it (optional core-loss resistance): inductive up to the self-resonance f = 1/(2π√(L·Cp)), capacitive above',
    prefix: 'L',
    symbol: NI_L_SYMBOL,
    params: [
      numParam('value', 'Inductance', '100u', 'H', { showOnSchematic: true, min: 0, picker: 'E12' }),
      numParam('rser', 'Winding resistance', '200m', 'Ω', { min: 0, help: 'DC resistance of the copper winding; 0 = none' }),
      numParam('cp', 'Parallel capacitance', '5p', 'F', { min: 0, help: 'Capacitance between the turns; with L it sets the self-resonance; 0 = none' }),
      numParam('rpar', 'Core-loss resistance', '', 'Ω', { min: 0, help: 'Resistance across the inductance for core losses (limits the impedance peak at the self-resonance); blank or 0 = none' }),
      icParam('A', 'Initial current'),
      numParam('tolerance', 'Tolerance', '10', '%', { group: 'advanced', min: 0 }),
    ],
    toSpice: (ctx) => {
      const l = pos(ctx, 'value');
      const rs = nonNeg(ctx, 'rser');
      const cp = nonNeg(ctx, 'cp');
      const rp = optPos(ctx, 'rpar');
      const ic = optNum(ctx, 'ic');
      const a = ctx.node('1');
      const b = ctx.node('2');
      const els: ElementIR[] = [];
      let n = a;
      if (rs > 0) {
        const m = internalNode(ctx, 'r');
        els.push(elR(ctx.name('R', 'ser'), a, m, rs));
        n = m;
      }
      els.push(elL(ctx.name('L'), n, b, l, ic === undefined ? {} : { ic }));
      if (rp > 0) els.push(elR(ctx.name('R', 'core'), n, b, rp));
      if (cp > 0) els.push(elC(ctx.name('C', 'p'), a, b, cp));
      return { elements: els };
    },
    provenance: 'Textbook equivalent circuit of an inductor (winding R in series, winding capacitance across, optional core-loss R); defaults typical of a 100 µH radial choke',
    footprint: 'IND-RADIAL-500',
    keywords: ['non-ideal', 'nonideal', 'parasitic', 'winding capacitance', 'self-resonance', 'srf', 'real inductor', 'inductor', 'choke'],
  },
  {
    vi: 'Cuộn cảm có điện trở dây quấn nối tiếp và điện dung giữa các vòng Cp song song (tuỳ chọn điện trở tổn hao lõi): tính cảm đến tần số cộng hưởng riêng f = 1/(2π√(L·Cp)), tính dung ở trên',
    nameVi: 'Cuộn cảm không lý tưởng',
  },
);

// ---------------------------------------------------------------------------------------------
// Z load

/** Series R + jX at f as elements between a and b (series or parallel equivalent). */
export function zLoadElements(ctx: ToSpiceContext, r: number, x: number, f: number, topology: string): ElementIR[] {
  if (!(f > 0)) throw new Error('bad value for freq: must be > 0');
  if (!(r >= 0)) throw new Error('bad value for r: the resistance must be >= 0 (a load does not deliver power)');
  if (r === 0 && x === 0) throw new Error('bad value for r: the impedance must not be zero');
  const w = 2 * Math.PI * f;
  const a = ctx.node('1');
  const b = ctx.node('2');
  const react = (tag: string, n1: string, n2: string, xr: number): ElementIR => (xr > 0 ? elL(ctx.name('L', tag), n1, n2, xr / w) : elC(ctx.name('C', tag), n1, n2, -1 / (w * xr)));
  if (topology === 'parallel') {
    const z2 = r * r + x * x;
    const els: ElementIR[] = [];
    if (r > 0) els.push(elR(ctx.name('R'), a, b, z2 / r));
    if (x !== 0) els.push(react('p', a, b, z2 / x));
    return els;
  }
  if (x === 0) return [elR(ctx.name('R'), a, b, r)];
  if (r === 0) return [react('s', a, b, x)];
  const m = internalNode(ctx, 'z');
  return [elR(ctx.name('R'), a, m, r), react('s', m, b, x)];
}

const Z_SYMBOL = twoPinH([rect(-16, -8, 32, 16), text(0, 4, 'Z', 10, 'middle', true)], { bodyHalf: 16 });

const topologyParam = (): ParamDef =>
  selectParam('topology', 'Equivalent circuit', 'series', [
    ['series', 'R and X in series'],
    ['parallel', 'Parallel R and X (same Z at f)'],
  ], { help: 'Both give exactly Z at the design frequency; they differ at other frequencies (the series form with X < 0 blocks DC, the parallel form with X > 0 shorts DC)' });

const zLoadRX = withMeta(
  {
    id: 'basic/z-load-rx',
    name: 'Impedance Load (R + jX)',
    group: 'basic',
    family: 'Z load',
    description: 'Complex load Z = R + jX at the frequency f: X > 0 inductive (an inductor L = X/(2πf)), X < 0 capacitive (C = −1/(2πf·X)), in series or as the parallel equivalent',
    prefix: 'Z',
    symbol: Z_SYMBOL,
    params: [
      numParam('r', 'Resistance R', '50', 'Ω', { showOnSchematic: true, min: 0 }),
      numParam('x', 'Reactance X', '25', 'Ω', { showOnSchematic: true, help: 'Positive = inductive, negative = capacitive (at the frequency f)' }),
      numParam('freq', 'Frequency', '1k', 'Hz', { min: 0, help: 'Frequency at which the load has exactly this impedance' }),
      topologyParam(),
    ],
    toSpice: (ctx) => ({ elements: zLoadElements(ctx, ctx.num('r'), ctx.num('x'), ctx.num('freq'), textOf(ctx, 'topology', 'series').trim()) }),
    provenance: 'Exact R-L or R-C realisation of a complex impedance at one frequency (circuit theory)',
    virtual: true,
    keywords: ['z load', 'impedance', 'complex load', 'r+jx', 'reactance', 'load'],
  },
  { vi: 'Tải phức Z = R + jX tại tần số f: X > 0 tính cảm (cuộn cảm L = X/(2πf)), X < 0 tính dung (tụ C = −1/(2πf·X)), mắc nối tiếp hoặc dạng song song tương đương', nameVi: 'Tải trở kháng (R + jX)' },
);

const zLoadPolar = withMeta(
  {
    id: 'basic/z-load-polar',
    name: 'Impedance Load (|Z|∠φ)',
    group: 'basic',
    family: 'Z load',
    description: 'Complex load given by its magnitude |Z| and phase φ at the frequency f: R = |Z|·cos φ, X = |Z|·sin φ (φ > 0 inductive, φ < 0 capacitive)',
    prefix: 'Z',
    symbol: Z_SYMBOL,
    params: [
      numParam('mag', 'Magnitude |Z|', '100', 'Ω', { showOnSchematic: true, min: 0 }),
      numParam('phase', 'Phase angle φ', '30', '°', { showOnSchematic: true, min: -90, max: 90, help: 'Between −90° (pure capacitor) and +90° (pure inductor)' }),
      numParam('freq', 'Frequency', '1k', 'Hz', { min: 0, help: 'Frequency at which the load has exactly this impedance' }),
      topologyParam(),
    ],
    toSpice: (ctx) => {
      const mag = pos(ctx, 'mag');
      const ph = ctx.num('phase');
      if (!(ph >= -90 && ph <= 90)) throw new Error('bad value for phase: must be between -90 and 90 degrees');
      const rad = (ph * Math.PI) / 180;
      const r = Math.abs(ph) === 90 ? 0 : mag * Math.cos(rad);
      return { elements: zLoadElements(ctx, r, mag * Math.sin(rad), ctx.num('freq'), textOf(ctx, 'topology', 'series').trim()) };
    },
    provenance: 'Exact R-L or R-C realisation of a complex impedance at one frequency (circuit theory)',
    virtual: true,
    keywords: ['z load', 'impedance', 'complex load', 'magnitude', 'phase', 'polar', 'load'],
  },
  { vi: 'Tải phức cho bằng độ lớn |Z| và góc pha φ tại tần số f: R = |Z|·cos φ, X = |Z|·sin φ (φ > 0 tính cảm, φ < 0 tính dung)', nameVi: 'Tải trở kháng (|Z|∠φ)' },
);

// ---------------------------------------------------------------------------------------------
// Resistor packs

const packValueParams = (value: string): ParamDef[] => [
  numParam('value', 'Resistance of each resistor', value, 'Ω', { showOnSchematic: true, min: 0, picker: 'E24' }),
  numParam('tolerance', 'Tolerance', '2', '%', { group: 'advanced', min: 0 }),
  numParam('power', 'Power per resistor', '0.125', 'W', { group: 'advanced', min: 0 }),
];

/** Pins along the bottom edge, 20 apart, centred (SIP networks). */
function sipPins(n: number, names: string[]): PinDef[] {
  return names.map((nm, i) => pin(nm, -(n - 1) * 10 + 20 * i, 30, 'down', { number: String(i + 1) }));
}

function bussedSip(n: number, value?: number): LibraryPartDef {
  const names = Array.from({ length: n }, (_, i) => String(i + 1));
  const xs = names.map((_, i) => -(n - 1) * 10 + 20 * i);
  const w = 20 * n;
  const prims: SymbolPrim[] = [rect(-w / 2, -30, w, 50), line(xs[0], 20, xs[0], -22), line(xs[0], -22, xs[n - 1], -22), circle(xs[0], -22, 1.6, true)];
  for (let i = 0; i < n; i++) prims.push(line(xs[i], 20, xs[i], 30));
  for (let i = 1; i < n; i++) prims.push(line(xs[i], 20, xs[i], 14), poly(zigzagV(xs[i], 14, -16, 4, 6)), line(xs[i], -16, xs[i], -22), circle(xs[i], -22, 1.6, true));
  prims.push(text(xs[0] + 5, 13, '1', 7, 'start'));
  const fixed = value !== undefined;
  const slugPart = fixed ? `-${code(value)}` : '';
  const vText = fixed ? eng(value, 'Ω') : '';
  return withMeta(
    {
      id: `basic/rpack-sip${n}-bussed${slugPart}`,
      name: fixed ? `${vText} ×${n - 1} SIP-${n}` : `Bussed Resistor Network SIP-${n}`,
      group: 'basic',
      family: 'Resistor pack',
      description: `${n - 1} ${fixed ? `${vText} ` : ''}resistors in one SIP-${n} package, each from pin 2…${n} to the common pin 1 (pull-up / pull-down networks)`,
      prefix: 'RN',
      symbol: makeSymbol(prims, sipPins(n, names), { refPos: { x: 0, y: -38 }, valuePos: { x: 0, y: 44 } }),
      params: packValueParams(fixed ? userNum(value) : '10k'),
      toSpice: (ctx) => {
        const r = pos(ctx, 'value');
        return { elements: names.slice(1).map((p) => elR(ctx.name('R', p), ctx.node(p), ctx.node('1'), r)) };
      },
      optionalPins: names.slice(1),
      footprint: `SIP-${n}`,
      keywords: ['resistor network', 'resistor array', 'rpack', 'sip', 'bussed', 'pull-up', 'pull-down'],
    },
    {
      vi: `${n - 1} điện trở ${fixed ? `${vText} ` : ''}trong một vỏ SIP-${n}, mỗi điện trở nối từ chân 2…${n} về chân chung 1 (mạng kéo lên / kéo xuống)`,
      ...(fixed ? {} : { nameVi: `Mảng điện trở chung chân SIP-${n}` }),
      specs: { resistance: value ?? 10e3, package: `SIP-${n}`, positions: n - 1 },
      ...(fixed ? { sortKey: value } : {}),
      series: 'Resistor network',
    },
  );
}

function isolatedDip(n: number, value?: number): LibraryPartDef {
  const half = n / 2;
  const fixed = value !== undefined;
  const vText = fixed ? eng(value, 'Ω') : '';
  const extra: SymbolPrim[] = [];
  const h = 20 * half;
  for (let i = 0; i < half; i++) {
    const y = -(half - 1) * 10 + 20 * i;
    extra.push(line(-30, y, -14, y), poly(zigzag(-14, 14, y, 4, 6)), line(14, y, 30, y));
  }
  extra.push(arc(0, -h / 2, 6, 0, 180));
  const left = Array.from({ length: half }, (_, i) => ({ name: String(i + 1), number: String(i + 1), label: '' }));
  const right = Array.from({ length: half }, (_, i) => ({ name: String(n - i), number: String(n - i), label: '' }));
  return withMeta(
    {
      id: `basic/rpack-dip${n}-isolated${fixed ? `-${code(value)}` : ''}`,
      name: fixed ? `${vText} ×${half} DIP-${n}` : `Isolated Resistor Network DIP-${n}`,
      group: 'basic',
      family: 'Resistor pack',
      description: `${half} separate ${fixed ? `${vText} ` : ''}resistors in one DIP-${n} package, resistor k between pin k and pin ${n + 1}−k`,
      prefix: 'RN',
      symbol: boxSymbol({ w: 60, h, left, right, extra }),
      params: packValueParams(fixed ? userNum(value) : '1k'),
      toSpice: (ctx) => {
        const r = pos(ctx, 'value');
        return { elements: left.map((p, i) => elR(ctx.name('R', p.name), ctx.node(p.name), ctx.node(right[i].name), r)) };
      },
      optionalPins: [...left, ...right].map((p) => p.name),
      footprint: `DIP-${n}`,
      keywords: ['resistor network', 'resistor array', 'rpack', 'dip', 'isolated', 'led resistors'],
    },
    {
      vi: `${half} điện trở ${fixed ? `${vText} ` : ''}riêng rẽ trong một vỏ DIP-${n}, điện trở thứ k nối giữa chân k và chân ${n + 1}−k`,
      ...(fixed ? {} : { nameVi: `Mảng điện trở riêng rẽ DIP-${n}` }),
      specs: { resistance: value ?? 1e3, package: `DIP-${n}`, positions: half },
      ...(fixed ? { sortKey: value } : {}),
      series: 'Resistor network',
    },
  );
}

function isolatedSip(n: number): LibraryPartDef {
  const names = Array.from({ length: n }, (_, i) => String(i + 1));
  const xs = names.map((_, i) => -(n - 1) * 10 + 20 * i);
  const w = 20 * n;
  const prims: SymbolPrim[] = [rect(-w / 2, -20, w, 40)];
  for (let i = 0; i < n; i++) prims.push(line(xs[i], 20, xs[i], 30));
  for (let i = 0; i + 1 < n; i += 2) prims.push(line(xs[i], 20, xs[i], 0), poly(zigzag(xs[i], xs[i + 1], 0, 4, 4)), line(xs[i + 1], 0, xs[i + 1], 20));
  return withMeta(
    {
      id: `basic/rpack-sip${n}-isolated`,
      name: `Isolated Resistor Network SIP-${n}`,
      group: 'basic',
      family: 'Resistor pack',
      description: `${n / 2} separate resistors in one SIP-${n} package, between pins 1–2, 3–4 …`,
      prefix: 'RN',
      symbol: makeSymbol(prims, sipPins(n, names), { refPos: { x: 0, y: -28 }, valuePos: { x: 0, y: 44 } }),
      params: packValueParams('1k'),
      toSpice: (ctx) => {
        const r = pos(ctx, 'value');
        const els: ElementIR[] = [];
        for (let i = 0; i + 1 < n; i += 2) els.push(elR(ctx.name('R', names[i]), ctx.node(names[i]), ctx.node(names[i + 1]), r));
        return { elements: els };
      },
      optionalPins: names,
      footprint: `SIP-${n}`,
      keywords: ['resistor network', 'resistor array', 'rpack', 'sip', 'isolated'],
    },
    { vi: `${n / 2} điện trở riêng rẽ trong một vỏ SIP-${n}, nối giữa các chân 1–2, 3–4 …`, nameVi: `Mảng điện trở riêng rẽ SIP-${n}`, specs: { resistance: 1e3, package: `SIP-${n}`, positions: n / 2 }, series: 'Resistor network' },
  );
}

const terminator = (() => {
  const lines = Array.from({ length: 8 }, (_, i) => ({ name: `L${i + 1}`, number: String(i + 2), label: String(i + 1) }));
  // a small divider glyph (V+ — R1 — line — R2 — GND) inside the box
  const extra: SymbolPrim[] = [poly(zigzagV(18, -46, -16, 3, 4)), circle(18, -10, 1.6, true), line(18, -16, 18, -4), line(18, -10, 8, -10), poly(zigzagV(18, -4, 26, 3, 4)), line(18, 26, 18, 30), text(26, -30, 'R1', 7, 'start'), text(26, 12, 'R2', 7, 'start')];
  return withMeta(
    {
      id: 'basic/rpack-sip10-terminator',
      name: 'Dual Terminator Network SIP-10',
      group: 'basic',
      family: 'Resistor pack',
      description: '8 lines, each with R1 to pin 1 (supply) and R2 to pin 10 (ground): a Thevenin termination of R1∥R2 at V·R2/(R1 + R2)',
      prefix: 'RN',
      symbol: boxSymbol({ w: 80, h: 160, left: lines, top: [{ name: 'V', number: '1', label: 'V+', type: 'power' }], bottom: [{ name: 'G', number: '10', label: 'GND', type: 'power' }], extra }),
      params: [
        numParam('r1', 'Resistance to pin 1 (R1)', '220', 'Ω', { showOnSchematic: true, min: 0, picker: 'E24' }),
        numParam('r2', 'Resistance to pin 10 (R2)', '330', 'Ω', { showOnSchematic: true, min: 0, picker: 'E24' }),
        numParam('tolerance', 'Tolerance', '2', '%', { group: 'advanced', min: 0 }),
      ],
      toSpice: (ctx) => {
        const r1 = pos(ctx, 'r1');
        const r2 = pos(ctx, 'r2');
        const els: ElementIR[] = [];
        for (const l of lines) els.push(elR(ctx.name('R', `${l.name}a`), ctx.node(l.name), ctx.node('V'), r1), elR(ctx.name('R', `${l.name}b`), ctx.node(l.name), ctx.node('G'), r2));
        return { elements: els };
      },
      optionalPins: lines.map((l) => l.name),
      footprint: 'SIP-10',
      keywords: ['terminator', 'termination', 'resistor network', 'thevenin', 'rpack', 'bus termination'],
    },
    { vi: '8 đường, mỗi đường có R1 về chân 1 (nguồn) và R2 về chân 10 (đất): kết cuối Thevenin R1∥R2 ở mức V·R2/(R1 + R2)', nameVi: 'Mảng điện trở kết cuối kép SIP-10', specs: { package: 'SIP-10', positions: 8 }, series: 'Resistor network' },
  );
})();

const PACK_VALUES = seriesValues('E6', 100, 100e3);
const resistorPacks: LibraryPartDef[] = [
  ...[6, 8, 9, 10].map((n) => bussedSip(n)),
  ...[8, 14, 16].map((n) => isolatedDip(n)),
  isolatedSip(8),
  terminator,
  ...PACK_VALUES.map((v) => bussedSip(9, v)),
  ...PACK_VALUES.map((v) => isolatedDip(16, v)),
];

// ---------------------------------------------------------------------------------------------
// IC sockets (placeholders, not simulated)

function dipSocket(n: number): LibraryPartDef {
  const half = n / 2;
  const left = Array.from({ length: half }, (_, i) => ({ name: String(i + 1), number: String(i + 1), label: String(i + 1) }));
  const right = Array.from({ length: half }, (_, i) => ({ name: String(n - i), number: String(n - i), label: String(n - i) }));
  const h = 20 * half;
  return withMeta(
    {
      id: `basic/socket-dip${n}`,
      name: `DIP-${n} IC Socket`,
      group: 'basic',
      family: 'Socket',
      description: `Socket for a ${n}-pin DIP IC: listed in the BOM, not simulated; each pin only passes its net through (place the IC itself as its own part)`,
      prefix: 'XS',
      symbol: boxSymbol({ w: 60, h, left, right, extra: [arc(0, -h / 2, 7, 0, 180), rect(-22, -h / 2 + 10, 44, h - 20, undefined, 3)] }),
      params: [],
      annotation: 'placeholder',
      optionalPins: [...left, ...right].map((p) => p.name),
      footprint: `DIP-${n}-SOCKET`,
      keywords: ['socket', 'ic socket', 'dip socket', 'holder', 'placeholder'],
    },
    { vi: `Đế cắm IC DIP ${n} chân: có trong BOM, không mô phỏng; mỗi chân chỉ cho net đi qua (IC đặt riêng bằng linh kiện của nó)`, nameVi: `Đế IC DIP-${n}`, specs: { package: `DIP-${n}`, positions: n }, sortKey: n },
  );
}

const sockets: LibraryPartDef[] = [8, 14, 16, 18, 20, 24, 28, 40].map(dipSocket);

// ---------------------------------------------------------------------------------------------
// Schematic (annotation) symbols — drawing only, never simulated

interface SymbolSpec {
  slug: string;
  name: string;
  nameVi: string;
  description: string;
  vi: string;
  prefix: string;
  prims: SymbolPrim[];
  pin: PinDef;
  physical?: string;
  keywords: string[];
}

function annotationSymbol(s: SymbolSpec): LibraryPartDef {
  return withMeta(
    {
      id: `basic/${s.slug}`,
      name: s.name,
      group: 'basic',
      family: 'Schematic symbols',
      description: `${s.description}. Drawing symbol only: it is not simulated`,
      prefix: s.prefix,
      symbol: makeSymbol(s.prims, [s.pin]),
      params: [],
      annotation: 'symbol',
      ...(s.physical ? { footprint: s.physical } : { virtual: true }),
      keywords: ['schematic symbol', 'annotation', 'not simulated', ...s.keywords],
    },
    { vi: `${s.vi}. Chỉ là ký hiệu vẽ, không tham gia mô phỏng`, nameVi: s.nameVi },
  );
}

const annotationSymbols: LibraryPartDef[] = [
  annotationSymbol({
    slug: 'test-point',
    name: 'Test Point',
    nameVi: 'Điểm đo',
    description: 'Marks a point of the circuit where you put a probe or meter lead (a test pad or loop on the board)',
    vi: 'Đánh dấu một điểm của mạch để đặt que đo hoặc đầu dò (pad / khuyên đo trên mạch in)',
    prefix: 'TP',
    prims: [circle(0, -6, 5), line(0, -1, 0, 10)],
    pin: pin('1', 0, 10, 'down', { number: '1' }),
    physical: 'TESTPOINT',
    keywords: ['test point', 'tp', 'probe point', 'measurement point'],
  }),
  annotationSymbol({
    slug: 'signal-input',
    name: 'Signal Input Arrow',
    nameVi: 'Mũi tên tín hiệu vào',
    description: 'Shows where a signal enters the circuit (the arrow points into the circuit)',
    vi: 'Cho biết chỗ tín hiệu đi vào mạch (mũi tên chỉ vào mạch)',
    prefix: 'SIG',
    prims: [poly([-30, -6, -12, -6, -6, 0, -12, 6, -30, 6], true), line(-6, 0, 0, 0)],
    pin: pin('1', 0, 0, 'right', { number: '1' }),
    keywords: ['signal arrow', 'input', 'port', 'off-sheet'],
  }),
  annotationSymbol({
    slug: 'signal-output',
    name: 'Signal Output Arrow',
    nameVi: 'Mũi tên tín hiệu ra',
    description: 'Shows where a signal leaves the circuit (the arrow points away from the circuit)',
    vi: 'Cho biết chỗ tín hiệu đi ra khỏi mạch (mũi tên chỉ ra ngoài)',
    prefix: 'SIG',
    prims: [line(0, 0, 6, 0), poly([6, -6, 24, -6, 30, 0, 24, 6, 6, 6], true)],
    pin: pin('1', 0, 0, 'left', { number: '1' }),
    keywords: ['signal arrow', 'output', 'port', 'off-sheet'],
  }),
  annotationSymbol({
    slug: 'signal-bidirectional',
    name: 'Bidirectional Signal Arrow',
    nameVi: 'Mũi tên tín hiệu hai chiều',
    description: 'Shows a signal that goes both ways (bus line, I/O pin)',
    vi: 'Cho biết tín hiệu đi cả hai chiều (đường bus, chân vào / ra)',
    prefix: 'SIG',
    prims: [line(0, 0, 6, 0), poly([6, 0, 12, -6, 24, -6, 30, 0, 24, 6, 12, 6], true)],
    pin: pin('1', 0, 0, 'left', { number: '1' }),
    keywords: ['signal arrow', 'bidirectional', 'io', 'port'],
  }),
  annotationSymbol({
    slug: 'antenna',
    name: 'Antenna',
    nameVi: 'Ăng-ten',
    description: 'Antenna symbol at the input or output of a radio stage',
    vi: 'Ký hiệu ăng-ten ở đầu vào hoặc đầu ra của tầng vô tuyến',
    prefix: 'ANT',
    prims: [line(0, 20, 0, -14), poly([-12, -26, 0, -14, 12, -26]), line(-12, -26, 12, -26)],
    pin: pin('1', 0, 20, 'down', { number: '1' }),
    physical: 'ANTENNA',
    keywords: ['antenna', 'aerial', 'rf', 'radio'],
  }),
  annotationSymbol({
    slug: 'chassis-marker',
    name: 'Chassis Ground Marker',
    nameVi: 'Ký hiệu nối vỏ máy',
    description: 'Marks a connection to the metal chassis or enclosure (does NOT tie the net to the simulation ground — use Ground from the Sources group for 0 V)',
    vi: 'Đánh dấu chỗ nối vào khung / vỏ kim loại (KHÔNG nối net vào đất của mô phỏng — muốn 0 V hãy dùng Đất trong nhóm Nguồn)',
    prefix: 'CH',
    prims: [line(0, -10, 0, 0), line(-12, 0, 12, 0), line(-12, 0, -17, 8), line(-2, 0, -7, 8), line(8, 0, 3, 8)],
    pin: pin('1', 0, -10, 'up', { number: '1' }),
    keywords: ['chassis', 'frame', 'enclosure', 'ground marker'],
  }),
  annotationSymbol({
    slug: 'earth-marker',
    name: 'Protective Earth Marker',
    nameVi: 'Ký hiệu nối đất bảo vệ',
    description: 'Marks the protective-earth connection of mains equipment (does NOT tie the net to the simulation ground — use Ground from the Sources group for 0 V)',
    vi: 'Đánh dấu chỗ nối đất bảo vệ của thiết bị dùng điện lưới (KHÔNG nối net vào đất của mô phỏng — muốn 0 V hãy dùng Đất trong nhóm Nguồn)',
    prefix: 'PE',
    prims: [line(0, -10, 0, 0), line(-12, 0, 12, 0), line(-8, 4, 8, 4), line(-4, 8, 4, 8), circle(0, 3, 15)],
    pin: pin('1', 0, -10, 'up', { number: '1' }),
    keywords: ['earth', 'protective earth', 'pe', 'safety ground', 'ground marker'],
  }),
  annotationSymbol({
    slug: 'no-connect',
    name: 'No-Connect Mark',
    nameVi: 'Dấu chân không nối',
    description: 'Put on a pin that is left open on purpose: the pin is marked and ERC no longer warns that it is not connected',
    vi: 'Đặt lên chân cố ý để hở: chân được đánh dấu và ERC không còn cảnh báo chân chưa nối',
    prefix: 'NC',
    prims: [line(-5, -5, 5, 5), line(-5, 5, 5, -5)],
    pin: pin('1', 0, 0, 'down', { number: '1' }),
    keywords: ['no connect', 'nc', 'open pin', 'unused pin', 'not connected'],
  }),
];

// ---------------------------------------------------------------------------------------------
// Switches: DIP switch packs, rotary switches, keypads

const switchResistances = (ron = '1m', roff = '1G'): ParamDef[] => [
  numParam('ron', 'On resistance', ron, 'Ω', { group: 'advanced', min: 0 }),
  numParam('roff', 'Off resistance', roff, 'Ω', { group: 'advanced', min: 0 }),
];

/** Default keys of the positions of a DIP switch: 1…9, then 0. */
const dipKey = (i: number): string => (i < 9 ? String(i + 1) : '0');

function dipSwitch(n: number): LibraryPartDef {
  const ys = Array.from({ length: n }, (_, i) => -(n - 1) * 10 + 20 * i);
  const left = ys.map((_, i) => ({ name: `A${i + 1}`, number: String(i + 1), label: '' }));
  const right = ys.map((_, i) => ({ name: `B${i + 1}`, number: String(2 * n - i), label: '' }));
  const extra: SymbolPrim[] = [text(0, -(n - 1) * 10 - 14, 'ON', 7)];
  ys.forEach((y, i) => extra.push(line(-20, y, -9, y), rect(-9, y - 5, 18, 10, undefined, 2), line(9, y, 20, y), text(-14, y - 4, String(i + 1), 6)));
  const controls: InteractiveControl[] = ys.map((y, i) => ({ param: `s${i + 1}`, label: String(i + 1), key: dipKey(i), at: { x: 0, y } }));
  return withMeta(
    {
      id: `basic/dip-switch-${n}`,
      name: `DIP Switch ${n}-Position`,
      group: 'basic',
      family: 'Switch',
      description: `${n} independent on / off switches in one DIP-${2 * n} package (position k joins Ak and Bk). While the simulation runs click a position or press its key (1, 2, …) to flip it`,
      prefix: 'S',
      symbol: boxSymbol({ w: 40, h: Math.max(40, 20 * n), left, right, extra }),
      params: [
        ...ys.map((_, i) => boolParam(`s${i + 1}`, `Switch ${i + 1} on`, false)),
        textParam('keys', 'Keys', '', { help: 'Keys of the positions in order, separated by spaces (blank = 1, 2, 3 …; "-" keeps the default of one position)' }),
        ...switchResistances(),
      ],
      interactive: { kind: 'toggle', param: 's1', label: 'Switch', controls, keysParam: 'keys' },
      toSpice: (ctx) => {
        const ron = pos(ctx, 'ron');
        const roff = pos(ctx, 'roff');
        return { elements: ys.map((_, i) => elR(ctx.name('R', String(i + 1)), ctx.node(`A${i + 1}`), ctx.node(`B${i + 1}`), boolOf(ctx, `s${i + 1}`) ? ron : roff)) };
      },
      optionalPins: [...left, ...right].map((p) => p.name),
      footprint: `DIP-${2 * n}`,
      keywords: ['dip switch', 'switch pack', 'configuration switch', 'dil switch', 'switch'],
    },
    { vi: `${n} công tắc bật / tắt độc lập trong một vỏ DIP-${2 * n} (vị trí k nối Ak với Bk). Khi đang mô phỏng, bấm vào một vị trí hoặc nhấn phím của nó (1, 2, …) để gạt`, nameVi: `Công tắc DIP ${n} vị trí`, specs: { positions: n, package: `DIP-${2 * n}` }, sortKey: n, series: 'DIP switch' },
  );
}

function rotarySwitch(n: number): LibraryPartDef {
  const ys = Array.from({ length: n }, (_, i) => -(n - 1) * 10 + 20 * i);
  const positions = ys.map((_, i) => String(i + 1));
  const prims: SymbolPrim[] = [line(-40, 0, -20, 0), circle(-20, 0, 2.5, true), line(-20, 0, 7, ys[0])];
  ys.forEach((y, i) => prims.push(circle(10, y, 2.2), line(12, y, 40, y), text(26, y - 5, String(i + 1), 6)));
  const pins = [pin('COM', -40, 0, 'left', { number: '1' }), ...ys.map((y, i) => pin(`P${i + 1}`, 40, y, 'right', { number: String(i + 2) }))];
  const controls: InteractiveControl[] = ys.map((y, i) => ({ param: 'position', label: String(i + 1), value: String(i + 1), at: { x: 10, y } }));
  return withMeta(
    {
      id: `basic/rotary-switch-${n}`,
      name: `Rotary Switch 1-Pole ${n}-Position`,
      group: 'basic',
      family: 'Switch',
      description: `Single-pole ${n}-position rotary switch: COM connects to the selected position P1…P${n}. While the simulation runs click a contact to select it, or press the key (default R) to step to the next position`,
      prefix: 'S',
      symbol: makeSymbol(prims, pins, { refPos: { x: 0, y: ys[0] - 16 }, valuePos: { x: 0, y: ys[n - 1] + 20 } }),
      params: [selectParam('position', 'Position', '1', positions, { showOnSchematic: true }), keyParam('R'), ...switchResistances()],
      interactive: { kind: 'toggle', param: 'position', label: 'Position', key: 'R', controls },
      toSpice: (ctx) => {
        const sel = textOf(ctx, 'position', '1').trim();
        const ron = pos(ctx, 'ron');
        const roff = pos(ctx, 'roff');
        return { elements: positions.map((p) => elR(ctx.name('R', p), ctx.node('COM'), ctx.node(`P${p}`), p === sel ? ron : roff)) };
      },
      optionalPins: positions.map((p) => `P${p}`),
      footprint: `ROTARY-1P${n}T`,
      keywords: ['rotary switch', 'selector', 'wafer switch', 'band switch', 'switch'],
    },
    { vi: `Công tắc xoay 1 cực ${n} vị trí: COM nối với vị trí đang chọn P1…P${n}. Khi đang mô phỏng, bấm vào một tiếp điểm để chọn, hoặc nhấn phím (mặc định R) để sang vị trí kế tiếp`, nameVi: `Công tắc xoay 1 cực ${n} vị trí`, specs: { positions: n }, sortKey: 100 + n, series: 'Rotary switch' },
  );
}

/** Key labels of the keypads, row by row. */
const KEYPAD_LAYOUTS: Record<'4x4' | '4x3', string[][]> = {
  '4x4': [
    ['1', '2', '3', 'A'],
    ['4', '5', '6', 'B'],
    ['7', '8', '9', 'C'],
    ['*', '0', '#', 'D'],
  ],
  '4x3': [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['*', '0', '#'],
  ],
};

/** Parameter key of a keypad key ("*" → kstar, "#" → khash). */
export const keypadParam = (label: string): string => (label === '*' ? 'kstar' : label === '#' ? 'khash' : `k${label.toLowerCase()}`);

function keypad(layout: '4x4' | '4x3'): LibraryPartDef {
  const rows = KEYPAD_LAYOUTS[layout];
  const nr = rows.length;
  const nc = rows[0].length;
  const kx = (c: number) => -(nc - 1) * 12 + 24 * c;
  const ky = (r: number) => -54 + 24 * r;
  const pinNames = [...rows.map((_, r) => `R${r + 1}`), ...rows[0].map((_, c) => `C${c + 1}`)];
  const np = pinNames.length;
  const px = (i: number) => -(np - 1) * 10 + 20 * i;
  const prims: SymbolPrim[] = [rect(-Math.max(nc * 12 + 8, np * 10), -72, 2 * Math.max(nc * 12 + 8, np * 10), 112, undefined, 6)];
  const controls: InteractiveControl[] = [];
  rows.forEach((row, r) =>
    row.forEach((lab, c) => {
      prims.push(rect(kx(c) - 9, ky(r) - 9, 18, 18, undefined, 3), text(kx(c), ky(r) + 4, lab, 9, 'middle', true));
      controls.push({ param: keypadParam(lab), label: lab, key: lab, at: { x: kx(c), y: ky(r) } });
    }),
  );
  pinNames.forEach((nm, i) => prims.push(line(px(i), 40, px(i), 50), text(px(i), 33, nm, 6)));
  const pins = pinNames.map((nm, i) => pin(nm, px(i), 50, 'down', { number: String(i + 1) }));
  return withMeta(
    {
      id: `basic/keypad-${layout}`,
      name: `Keypad ${layout} Matrix`,
      group: 'basic',
      family: 'Switch',
      description: `${nr * nc}-key matrix keypad: pressing a key joins its row pin R1…R${nr} to its column pin C1…C${nc}. While the simulation runs click a key or press the same key on the keyboard (held while pressed)`,
      prefix: 'S',
      symbol: makeSymbol(prims, pins, { refPos: { x: 0, y: -80 }, valuePos: { x: 0, y: 62 } }),
      params: [
        ...rows.flat().map((lab) => boolParam(keypadParam(lab), `Key ${lab} pressed`, false)),
        textParam('keys', 'Keys', '', { help: 'Keyboard keys of the keypad keys row by row, separated by spaces (blank = the printed labels; "-" keeps the default of one key)' }),
        ...switchResistances('10', '100M'),
      ],
      interactive: { kind: 'momentary', param: keypadParam(rows[0][0]), label: 'Key', controls, keysParam: 'keys' },
      toSpice: (ctx) => {
        const ron = pos(ctx, 'ron');
        const roff = pos(ctx, 'roff');
        const els: ElementIR[] = [];
        rows.forEach((row, r) =>
          row.forEach((lab, c) => {
            const p = keypadParam(lab);
            els.push(elR(ctx.name('R', p), ctx.node(`R${r + 1}`), ctx.node(`C${c + 1}`), boolOf(ctx, p) ? ron : roff));
          }),
        );
        return { elements: els };
      },
      optionalPins: pinNames,
      footprint: `HDR-1X${np}`,
      keywords: ['keypad', 'keyboard', 'matrix keypad', 'membrane keypad', 'switch', 'scan'],
    },
    { vi: `Bàn phím ma trận ${nr * nc} phím: nhấn một phím là nối chân hàng R1…R${nr} của nó với chân cột C1…C${nc}. Khi đang mô phỏng, bấm vào phím hoặc nhấn đúng phím đó trên bàn phím (giữ là đang nhấn)`, nameVi: `Bàn phím ma trận ${layout}`, specs: { positions: nr * nc }, sortKey: 200 + nr * nc, series: 'Keypad' },
  );
}

const switches: LibraryPartDef[] = [...[2, 3, 4, 5, 6, 8, 10].map(dipSwitch), ...[3, 4, 6, 8, 12].map(rotarySwitch), keypad('4x3'), keypad('4x4')];

// ---------------------------------------------------------------------------------------------
// Magnetics: multi-winding transformers, three coupled inductors, nonlinear core

/** Winding: optional series resistance then the inductor, from node a to node b. */
function winding(ctx: ToSpiceContext, tag: string, a: string, b: string, l: number, r: number): { els: ElementIR[]; lname: string } {
  const lname = ctx.name('L', tag);
  if (r <= 0) return { els: [elL(lname, a, b, l)], lname };
  const mid = internalNode(ctx, tag);
  return { els: [elR(ctx.name('R', tag), a, mid, r), elL(lname, mid, b, l)], lname };
}

const kOf = (ctx: ToSpiceContext, key: string): number => {
  const k = ctx.num(key);
  if (!(k > 0 && k < 1)) throw new Error(`bad value for ${key}: must be between 0 and 1 (1 = ideal coupling is not allowed for three or more windings)`);
  return k;
};

/** Vertical winding (humps) between y0 and y1 at x with pin stubs to ±40, and its dot. */
function windingPrims(side: 'left' | 'right', y0: number, y1: number): SymbolPrim[] {
  const x = side === 'left' ? -10 : 10;
  const px = side === 'left' ? -40 : 40;
  const n = Math.max(2, Math.round((y1 - y0) / 10));
  return [line(px, y0, x, y0), line(px, y1, x, y1), ...humpsV(y0, y1, x, n, side === 'right'), circle(side === 'left' ? -20 : 20, y0 - 6, 1.8, true)];
}

interface WindingLayout {
  pins: [string, string];
  side: 'left' | 'right';
  y0: number;
  y1: number;
}

function multiWindingSymbol(ws: WindingLayout[]) {
  const prims: SymbolPrim[] = [];
  const pins: PinDef[] = [];
  let num = 1;
  let top = Infinity;
  let bottom = -Infinity;
  for (const w of ws) {
    prims.push(...windingPrims(w.side, w.y0, w.y1));
    const px = w.side === 'left' ? -40 : 40;
    pins.push(pin(w.pins[0], px, w.y0, w.side, { number: String(num++) }), pin(w.pins[1], px, w.y1, w.side, { number: String(num++) }));
    top = Math.min(top, w.y0);
    bottom = Math.max(bottom, w.y1);
  }
  prims.push(line(-2, top - 2, -2, bottom + 2), line(2, top - 2, 2, bottom + 2));
  return makeSymbol(prims, pins, { refPos: { x: 0, y: top - 16 }, valuePos: { x: 0, y: bottom + 16 } });
}

interface MultiSpec {
  slug: string;
  name: string;
  nameVi: string;
  description: string;
  vi: string;
  primaries: 1 | 2;
  secondaries: number;
}

function multiWinding(s: MultiSpec): LibraryPartDef {
  const layout: WindingLayout[] = [];
  const total = Math.max(s.primaries, s.secondaries);
  const span = 40;
  const gap = 20;
  const height = total * span + (total - 1) * gap;
  const startY = -Math.round(height / 2 / 10) * 10;
  const place = (count: number, side: 'left' | 'right', names: (i: number) => [string, string]) => {
    const h = count * span + (count - 1) * gap;
    const y = startY + Math.round((height - h) / 2 / 10) * 10;
    for (let i = 0; i < count; i++) layout.push({ pins: names(i), side, y0: y + i * (span + gap), y1: y + i * (span + gap) + span });
  };
  place(s.primaries, 'left', (i) => [`P${2 * i + 1}`, `P${2 * i + 2}`]);
  place(s.secondaries, 'right', (i) => [`S${2 * i + 1}`, `S${2 * i + 2}`]);
  const secParams: ParamDef[] = [];
  for (let i = 0; i < s.secondaries; i++) {
    secParams.push(numParam(`n${i + 1}`, `Turns ratio Np:Ns${i + 1}`, String([10, 20, 5][i] ?? 10), '', { showOnSchematic: i === 0, min: 0, help: `Primary turns per turn of secondary ${i + 1} (S${2 * i + 1}–S${2 * i + 2}); 10 = 10:1 step-down` }));
  }
  return withMeta(
    {
      id: `basic/${s.slug}`,
      name: s.name,
      group: 'basic',
      family: 'Transformer',
      description: s.description,
      prefix: 'T',
      symbol: multiWindingSymbol(layout),
      params: [
        ...secParams,
        numParam('lp', 'Primary inductance', '10', 'H', { min: 0 }),
        numParam('k', 'Coupling coefficient', '0.999', '', { min: 0, max: 1, help: 'Coupling between every pair of windings (below 1)' }),
        numParam('rp', 'Primary resistance', '10m', 'Ω', { group: 'advanced', min: 0 }),
        numParam('rs', 'Secondary resistance', '10m', 'Ω', { group: 'advanced', min: 0 }),
        numParam('riso', 'Isolation resistance', '1G', 'Ω', { group: 'advanced', min: 0, help: 'Leakage between windings (gives the secondary a DC reference)' }),
      ],
      toSpice: (ctx) => {
        const lp = pos(ctx, 'lp');
        const k = kOf(ctx, 'k');
        const rp = nonNeg(ctx, 'rp');
        const rs = nonNeg(ctx, 'rs');
        const riso = nonNeg(ctx, 'riso');
        const els: ElementIR[] = [];
        const ls: string[] = [];
        const refs: string[] = [];
        for (let i = 0; i < s.primaries; i++) {
          const w = winding(ctx, `p${i + 1}`, ctx.node(`P${2 * i + 1}`), ctx.node(`P${2 * i + 2}`), lp, rp);
          els.push(...w.els);
          ls.push(w.lname);
          refs.push(ctx.node(`P${2 * i + 2}`));
        }
        for (let i = 0; i < s.secondaries; i++) {
          const n = pos(ctx, `n${i + 1}`);
          const w = winding(ctx, `s${i + 1}`, ctx.node(`S${2 * i + 1}`), ctx.node(`S${2 * i + 2}`), lp / (n * n), rs);
          els.push(...w.els);
          ls.push(w.lname);
          refs.push(ctx.node(`S${2 * i + 2}`));
        }
        for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) els.push(elK(ctx.name('K', `${i + 1}${j + 1}`), [ls[i], ls[j]], k));
        if (riso > 0) for (let i = 1; i < refs.length; i++) els.push(elR(ctx.name('R', `iso${i}`), refs[0], refs[i], riso));
        return { elements: els };
      },
      footprint: `XFMR-${2 * (s.primaries + s.secondaries)}P`,
      keywords: ['transformer', 'multi-winding', 'multiple secondaries', 'xfmr', 'dual primary', 'isolation'],
    },
    { vi: s.vi, nameVi: s.nameVi },
  );
}

const multiWindings: LibraryPartDef[] = [
  multiWinding({
    slug: 'transformer-1p2s',
    name: 'Transformer, Two Secondaries',
    nameVi: 'Biến áp hai cuộn thứ cấp',
    description: 'One primary and two separate secondaries with their own turns ratios Np:Ns1 and Np:Ns2 (e.g. a supply with two output voltages); dots mark the in-phase ends',
    vi: 'Một cuộn sơ cấp và hai cuộn thứ cấp riêng, mỗi cuộn có tỉ số vòng Np:Ns1, Np:Ns2 riêng (vd. nguồn cho hai điện áp ra); dấu chấm đánh dấu các đầu cùng pha',
    primaries: 1,
    secondaries: 2,
  }),
  multiWinding({
    slug: 'transformer-1p3s',
    name: 'Transformer, Three Secondaries',
    nameVi: 'Biến áp ba cuộn thứ cấp',
    description: 'One primary and three separate secondaries with their own turns ratios; dots mark the in-phase ends',
    vi: 'Một cuộn sơ cấp và ba cuộn thứ cấp riêng, mỗi cuộn có tỉ số vòng riêng; dấu chấm đánh dấu các đầu cùng pha',
    primaries: 1,
    secondaries: 3,
  }),
  multiWinding({
    slug: 'transformer-2p2s',
    name: 'Transformer, Dual Primary and Dual Secondary',
    nameVi: 'Biến áp hai cuộn sơ cấp, hai cuộn thứ cấp',
    description: 'Two equal primaries (in parallel for 115 V, in series for 230 V) and two secondaries; dots mark the in-phase ends',
    vi: 'Hai cuộn sơ cấp giống nhau (song song cho 115 V, nối tiếp cho 230 V) và hai cuộn thứ cấp; dấu chấm đánh dấu các đầu cùng pha',
    primaries: 2,
    secondaries: 2,
  }),
];

const coupledInductors3 = withMeta(
  {
    id: 'basic/coupled-inductors-3',
    name: 'Three Coupled Inductors',
    group: 'basic',
    family: 'Transformer',
    description: 'Three magnetically coupled inductors with a coupling factor per pair (M12 = k12·√(L1·L2) …); dots mark L1+, L2+ and L3+',
    prefix: 'T',
    symbol: multiWindingSymbol([
      { pins: ['L1+', 'L1-'], side: 'left', y0: -50, y1: -10 },
      { pins: ['L2+', 'L2-'], side: 'right', y0: -50, y1: -10 },
      { pins: ['L3+', 'L3-'], side: 'right', y0: 10, y1: 50 },
    ]),
    params: [
      numParam('l1', 'Inductance L1', '1m', 'H', { showOnSchematic: true, min: 0 }),
      numParam('l2', 'Inductance L2', '1m', 'H', { min: 0 }),
      numParam('l3', 'Inductance L3', '1m', 'H', { min: 0 }),
      numParam('k12', 'Coupling factor k12', '0.9', '', { min: 0, max: 1, help: 'Coupling between L1 and L2 (0 = none, close to 1 = tight)' }),
      numParam('k13', 'Coupling factor k13', '0.9', '', { min: 0, max: 1, help: 'Coupling between L1 and L3' }),
      numParam('k23', 'Coupling factor k23', '0.9', '', { min: 0, max: 1, help: 'Coupling between L2 and L3' }),
    ],
    toSpice: (ctx) => {
      const names = [1, 2, 3].map((i) => ctx.name('L', String(i)));
      const els: ElementIR[] = [1, 2, 3].map((i) => elL(names[i - 1], ctx.node(`L${i}+`), ctx.node(`L${i}-`), pos(ctx, `l${i}`)));
      const pairs: [number, number][] = [
        [1, 2],
        [1, 3],
        [2, 3],
      ];
      const ks = pairs.map(([a, b]) => ctx.num(`k${a}${b}`));
      if (ks.some((k) => !(k >= 0 && k < 1))) throw new Error('bad value for k12: every coupling factor must be in [0, 1)');
      const [k12, k13, k23] = ks;
      // the inductance matrix must be positive definite (otherwise no physical core realises it)
      if (1 - k12 * k12 - k13 * k13 - k23 * k23 + 2 * k12 * k13 * k23 <= 0) throw new Error('bad value for k12: these coupling factors are not physically possible together (the inductance matrix is not positive definite)');
      pairs.forEach(([a, b], i) => {
        if (ks[i] > 0) els.push(elK(ctx.name('K', `${a}${b}`), [names[a - 1], names[b - 1]], ks[i]));
      });
      return { elements: els };
    },
    keywords: ['coupled inductors', 'mutual inductance', 'k', 'three windings', 'coupling factor'],
  },
  { vi: 'Ba cuộn cảm ghép từ với hệ số ghép riêng cho từng cặp (M12 = k12·√(L1·L2) …); dấu chấm ở L1+, L2+ và L3+', nameVi: 'Ba cuộn cảm ghép' },
);

/**
 * Magnetising branch with a saturating core between nodes a and b (see the module comment):
 * flux node λ (1 F, λ' = V(a,b)), current i(λ) = λ/lm·(1 + (λ/λsat)^8). The flux starts from the
 * operating point: a DC voltage across the winding there (a source starting at its peak) is a
 * short-circuit current that offsets the flux, exactly like the inrush of a real core.
 */
function coreBranch(ctx: ToSpiceContext, a: string, b: string, lm: number, lsat: number): ElementIR[] {
  const flux = internalNode(ctx, 'flux');
  const x = `(V(${flux})/${ex(lsat)})`;
  return [
    elG(ctx.name('G', 'flux'), '0', flux, a, b, 1),
    elC(ctx.name('C', 'flux'), flux, '0', 1),
    elR(ctx.name('R', 'flux'), flux, '0', 1e12),
    elB(ctx.name('B', 'mag'), a, b, 'I', `V(${flux})/${ex(lm)}*(1+${x}*${x}*${x}*${x}*${x}*${x}*${x}*${x})`),
    // 1 GΩ across the winding: a DC path for ERC (the branch itself is a controlled current source)
    elR(ctx.name('R', 'core'), a, b, 1e9),
  ];
}

/** Saturation parameters → Lm and λsat (exact peak magnetising current at the rated peak flux). */
export function coreFit(vrated: number, frated: number, imag: number, ksat: number): { lm: number; lsat: number; lrated: number } {
  const lrated = (Math.SQRT2 * vrated) / (2 * Math.PI * frated);
  const lsat = ksat * lrated;
  const lm = (lrated * (1 + Math.pow(1 / ksat, 8))) / (Math.SQRT2 * imag);
  return { lm, lsat, lrated };
}

const saturatingTransformer = withMeta(
  {
    id: 'basic/transformer-saturating',
    name: 'Saturating Transformer',
    group: 'basic',
    family: 'Transformer',
    description: 'Transformer with a nonlinear (saturating) iron core: exact turns ratio Np:Ns, magnetising current set at the rated voltage, rising steeply when the flux exceeds the saturation flux (over-voltage, low frequency, switch-on inrush)',
    prefix: 'T',
    symbol: (() => {
      const base = multiWindingSymbol([
        { pins: ['P1', 'P2'], side: 'left', y0: -20, y1: 20 },
        { pins: ['S1', 'S2'], side: 'right', y0: -20, y1: 20 },
      ]);
      return { ...base, prims: [...base.prims, line(-6, -22, -6, 22), line(6, -22, 6, 22), text(0, 34, 'SAT', 6)] };
    })(),
    params: [
      numParam('turns', 'Turns ratio Np:Ns', '10', '', { showOnSchematic: true, min: 0, help: 'Primary turns per secondary turn (10 = 10:1 step-down)' }),
      numParam('vrated', 'Rated primary voltage (RMS)', '230', 'V', { min: 0 }),
      numParam('frated', 'Rated frequency', '50', 'Hz', { min: 0 }),
      numParam('imag', 'Magnetising current at rated voltage (RMS)', '20m', 'A', { min: 0, help: 'No-load primary current at the rated voltage and frequency' }),
      numParam('ksat', 'Saturation flux / rated flux', '1.3', '', { min: 1, help: 'How far above the rated peak flux the core saturates (1.2 … 1.5 for mains transformers)' }),
      numParam('rp', 'Primary resistance', '2', 'Ω', { group: 'advanced', min: 0 }),
      numParam('rs', 'Secondary resistance', '50m', 'Ω', { group: 'advanced', min: 0 }),
      numParam('riso', 'Isolation resistance', '1G', 'Ω', { group: 'advanced', min: 0, help: 'Leakage between windings (gives the secondary a DC reference)' }),
    ],
    toSpice: (ctx) => {
      const n = pos(ctx, 'turns');
      const ksat = ctx.num('ksat');
      if (!(ksat > 1)) throw new Error('bad value for ksat: must be > 1');
      const fit = coreFit(pos(ctx, 'vrated'), pos(ctx, 'frated'), pos(ctx, 'imag'), ksat);
      const rp = nonNeg(ctx, 'rp');
      const rs = nonNeg(ctx, 'rs');
      const riso = nonNeg(ctx, 'riso');
      const p1 = ctx.node('P1');
      const p2 = ctx.node('P2');
      const s1 = ctx.node('S1');
      const s2 = ctx.node('S2');
      const a = rp > 0 ? internalNode(ctx, 'p') : p1;
      const b = internalNode(ctx, 'sb');
      const c = rs > 0 ? internalNode(ctx, 'sc') : s1;
      const sense = ctx.name('V', 'sec');
      const els: ElementIR[] = [];
      if (rp > 0) els.push(elR(ctx.name('R', 'p'), p1, a, rp));
      els.push(...coreBranch(ctx, a, p2, fit.lm, fit.lsat));
      // ideal transformer: V(b,S2) = V(a,P2)/n, and the primary carries I(sec)/n
      els.push(elE(ctx.name('E', 'sec'), b, s2, a, p2, 1 / n), elSense(sense, b, c), elF(ctx.name('F', 'pri'), a, p2, sense, 1 / n));
      if (rs > 0) els.push(elR(ctx.name('R', 's'), c, s1, rs));
      if (riso > 0) els.push(elR(ctx.name('R', 'iso'), p2, s2, riso));
      return { elements: els };
    },
    provenance: 'MachSim behavioural core: flux-integrating magnetising branch i(λ) = λ/Lm·(1 + (λ/λsat)^8) fitted to the rated magnetising current, ideal transformer windings with copper resistance',
    footprint: 'XFMR-4P',
    keywords: ['transformer', 'saturation', 'nonlinear core', 'magnetic core', 'inrush', 'iron core', 'magnetising current'],
  },
  { vi: 'Biến áp có lõi sắt phi tuyến (bão hoà): tỉ số vòng Np:Ns chính xác, dòng từ hoá đặt theo điện áp định mức, tăng vọt khi từ thông vượt từ thông bão hoà (quá áp, tần số thấp, dòng xung kích khi đóng điện)', nameVi: 'Biến áp bão hoà' },
);

const saturatingInductor = withMeta(
  {
    id: 'basic/inductor-saturating',
    name: 'Saturating Inductor',
    group: 'basic',
    family: 'Inductor',
    description: 'Inductor with a saturating core: inductance L at small currents, falling to half near the saturation current Isat and far lower above it (i(λ) = λ/L·(1 + (λ/λsat)^8))',
    prefix: 'L',
    symbol: twoPinH([...inductorBody(true), text(0, 16, 'SAT', 6)]),
    params: [
      numParam('value', 'Inductance (unsaturated)', '1m', 'H', { showOnSchematic: true, min: 0 }),
      numParam('isat', 'Saturation current', '1', 'A', { showOnSchematic: true, min: 0, help: 'Current at which the core saturates: the incremental inductance has fallen far below L' }),
      numParam('rser', 'Winding resistance', '50m', 'Ω', { group: 'advanced', min: 0 }),
    ],
    toSpice: (ctx) => {
      const l = pos(ctx, 'value');
      // i(λsat) = 2·λsat/L = Isat  ⇒  λsat = L·Isat/2
      const lsat = (l * pos(ctx, 'isat')) / 2;
      const rs = nonNeg(ctx, 'rser');
      const a = ctx.node('1');
      const m = rs > 0 ? internalNode(ctx, 'r') : a;
      const els: ElementIR[] = rs > 0 ? [elR(ctx.name('R', 'ser'), a, m, rs)] : [];
      els.push(...coreBranch(ctx, m, ctx.node('2'), l, lsat));
      return { elements: els };
    },
    provenance: 'MachSim behavioural core: flux-integrating branch i(λ) = λ/L·(1 + (λ/λsat)^8), λsat = L·Isat/2',
    footprint: 'IND-RADIAL-500',
    keywords: ['saturating inductor', 'saturation', 'nonlinear inductor', 'magnetic core', 'choke', 'swinging choke'],
  },
  { vi: 'Cuộn cảm có lõi bão hoà: điện cảm L khi dòng nhỏ, giảm còn một nửa gần dòng bão hoà Isat và nhỏ hơn nhiều khi vượt quá (i(λ) = λ/L·(1 + (λ/λsat)^8))', nameVi: 'Cuộn cảm bão hoà' },
);

const magnetics: LibraryPartDef[] = [...multiWindings, coupledInductors3, saturatingTransformer, saturatingInductor];

// ---------------------------------------------------------------------------------------------
// Voltage-controlled R / C / L: the value follows a control voltage V(C+,C−)
//   R = R0 + kr·V(c)  → behavioural current V(1,2)/R
//   C = C0 + kc·V(c)  → i = C·dv/dt: a 1 nF reference capacitor driven by a copy of V(1,2), its
//                        current scaled by C/1 nF (dv/dt form: exact while C changes slowly)
//   L = L0 + kl·V(c)  → v = L·di/dt: a 1 mH reference inductor carries a copy of the current, its
//                        voltage scaled by L/1 mH
// Each value is clamped to a minimum so it never reaches zero or turns negative.

/** Body with the control terminals C+ / C− below (like the controlled switches). */
function controlledSymbol(body: SymbolPrim[]) {
  return makeSymbol(
    [line(-30, -10, -20, -10), line(20, -10, 30, -10), ...body, line(-30, 10, -10, 10), line(10, 10, 30, 10), rect(-10, 4, 20, 12), text(0, 13, 'V', 8), line(0, -2, 0, 4, 1), text(-20, 6, '+', 7), text(20, 6, '−', 7)],
    [pin('1', -30, -10, 'left', { number: '1' }), pin('2', 30, -10, 'right', { number: '2' }), pin('C+', -30, 10, 'left', { number: '3' }), pin('C-', 30, 10, 'right', { number: '4' })],
    { refPos: { x: 0, y: -28 }, valuePos: { x: 0, y: 30 } },
  );
}
const shiftY = (prims: SymbolPrim[], dy: number): SymbolPrim[] =>
  prims.map((p) => {
    switch (p.kind) {
      case 'line':
        return { ...p, y1: p.y1 + dy, y2: p.y2 + dy };
      case 'polyline':
        return { ...p, points: p.points.map((v, i) => (i % 2 ? v + dy : v)) };
      case 'arc':
      case 'circle':
        return { ...p, cy: p.cy + dy };
      case 'rect':
        return { ...p, y: p.y + dy };
      case 'text':
        return { ...p, y: p.y + dy };
      default:
        return p;
    }
  });

const ctlExpr = (ctx: ToSpiceContext): string => `V(${ctx.node('C+')},${ctx.node('C-')})`;
/** Clamped value expression "max(v0 + k·V(c), vmin)". */
const valueExpr = (ctx: ToSpiceContext, v0: string, k: string, vmin: string): string => `max(${ex(ctx.num(v0))}+${ex(ctx.num(k))}*${ctlExpr(ctx)},${ex(pos(ctx, vmin))})`;

interface VcSpec {
  slug: string;
  name: string;
  nameVi: string;
  description: string;
  vi: string;
  prefix: string;
  body: SymbolPrim[];
  params: ParamDef[];
  build: (ctx: ToSpiceContext) => ElementIR[];
  keywords: string[];
}

function vcPart(s: VcSpec): LibraryPartDef {
  return withMeta(
    {
      id: `basic/${s.slug}`,
      name: s.name,
      group: 'basic',
      family: 'Controlled RLC',
      description: s.description,
      prefix: s.prefix,
      symbol: controlledSymbol(shiftY(s.body, -10)),
      params: s.params,
      toSpice: (ctx) => ({ elements: [...s.build(ctx), elR(ctx.name('R', 'ctl'), ctx.node('C+'), ctx.node('C-'), 1e12)] }),
      provenance: 'Ideal behavioural voltage-controlled element (value = base + gain·V(C+,C−), clamped to a minimum)',
      virtual: true,
      keywords: ['voltage controlled', 'vcr', 'controlled', 'variable', ...s.keywords],
    },
    { vi: s.vi, nameVi: s.nameVi },
  );
}

const controlledRlc: LibraryPartDef[] = [
  vcPart({
    slug: 'vc-resistor',
    name: 'Voltage-Controlled Resistor',
    nameVi: 'Điện trở điều khiển bằng áp',
    description: 'Resistor between 1 and 2 whose value is R = R0 + kr·V(C+,C−) (never below Rmin); models a JFET or LDR used as a variable resistor, AGC loops, voltage-controlled filters',
    vi: 'Điện trở giữa chân 1 và 2 có giá trị R = R0 + kr·V(C+,C−) (không nhỏ hơn Rmin); dùng làm JFET hay quang trở như biến trở, vòng tự động điều chỉnh độ lợi, bộ lọc điều khiển bằng áp',
    prefix: 'R',
    body: [poly(zigzag(-20, 20))],
    params: [
      numParam('r0', 'Resistance at 0 V control', '1k', 'Ω', { showOnSchematic: true, min: 0 }),
      numParam('kr', 'Change per control volt', '1k', 'Ω/V'),
      numParam('rmin', 'Minimum resistance', '1', 'Ω', { group: 'advanced', min: 0 }),
    ],
    build: (ctx) => [elB(ctx.name('B'), ctx.node('1'), ctx.node('2'), 'I', `V(${ctx.node('1')},${ctx.node('2')})/${valueExpr(ctx, 'r0', 'kr', 'rmin')}`), elR(ctx.name('R', 'dc'), ctx.node('1'), ctx.node('2'), 1e12)],
    keywords: ['voltage controlled resistor', 'vcr', 'agc'],
  }),
  vcPart({
    slug: 'vc-capacitor',
    name: 'Voltage-Controlled Capacitor',
    nameVi: 'Tụ điện điều khiển bằng áp',
    description: 'Capacitor between 1 and 2 whose value is C = C0 + kc·V(C+,C−) (never below Cmin): i = C·dv/dt; models a varactor tuned by a control voltage, voltage-controlled oscillators and filters',
    vi: 'Tụ điện giữa chân 1 và 2 có giá trị C = C0 + kc·V(C+,C−) (không nhỏ hơn Cmin): i = C·dv/dt; dùng như diode biến dung chỉnh bằng điện áp, mạch dao động và lọc điều khiển bằng áp',
    prefix: 'C',
    body: [line(-20, 0, -3, 0), line(-3, -9, -3, 9, 2), line(3, -9, 3, 9, 2), line(3, 0, 20, 0)],
    params: [
      numParam('c0', 'Capacitance at 0 V control', '1u', 'F', { showOnSchematic: true, min: 0 }),
      numParam('kc', 'Change per control volt', '100n', 'F/V'),
      numParam('cmin', 'Minimum capacitance', '1p', 'F', { group: 'advanced', min: 0 }),
    ],
    build: (ctx) => {
      const x = internalNode(ctx, 'x');
      const y = internalNode(ctx, 'y');
      const sense = ctx.name('V', 'ref');
      const cref = 1e-9;
      return [
        elE(ctx.name('E', 'copy'), x, '0', ctx.node('1'), ctx.node('2'), 1),
        elC(ctx.name('C', 'ref'), x, y, cref),
        elSense(sense, y, '0'),
        elB(ctx.name('B'), ctx.node('1'), ctx.node('2'), 'I', `I(${sense})*${valueExpr(ctx, 'c0', 'kc', 'cmin')}/${ex(cref)}`),
        elR(ctx.name('R', 'dc'), ctx.node('1'), ctx.node('2'), 1e12),
      ];
    },
    keywords: ['voltage controlled capacitor', 'varactor', 'vcc', 'tuning'],
  }),
  vcPart({
    slug: 'vc-inductor',
    name: 'Voltage-Controlled Inductor',
    nameVi: 'Cuộn cảm điều khiển bằng áp',
    description: 'Inductor between 1 and 2 whose value is L = L0 + kl·V(C+,C−) (never below Lmin): v = L·di/dt; models a saturable-reactor (magnetic amplifier) tuned by a control voltage',
    vi: 'Cuộn cảm giữa chân 1 và 2 có giá trị L = L0 + kl·V(C+,C−) (không nhỏ hơn Lmin): v = L·di/dt; dùng như cuộn kháng bão hoà (khuếch đại từ) chỉnh bằng điện áp',
    prefix: 'L',
    body: [...humps(-20, 20, 0, 4)],
    params: [
      numParam('l0', 'Inductance at 0 V control', '1m', 'H', { showOnSchematic: true, min: 0 }),
      numParam('kl', 'Change per control volt', '100u', 'H/V'),
      numParam('lmin', 'Minimum inductance', '1n', 'H', { group: 'advanced', min: 0 }),
    ],
    build: (ctx) => {
      const m = internalNode(ctx, 'm');
      const y = internalNode(ctx, 'y');
      const sense = ctx.name('V', 'i');
      const lref = 1e-3;
      return [
        elSense(sense, ctx.node('1'), m),
        elF(ctx.name('F', 'copy'), '0', y, sense, 1),
        elL(ctx.name('L', 'ref'), y, '0', lref),
        elB(ctx.name('B'), m, ctx.node('2'), 'V', `V(${y})*${valueExpr(ctx, 'l0', 'kl', 'lmin')}/${ex(lref)}`),
      ];
    },
    keywords: ['voltage controlled inductor', 'saturable reactor', 'magnetic amplifier', 'tuning'],
  }),
];

// ---------------------------------------------------------------------------------------------
// 3D learner parts: pictorial symbols of everyday parts with fixed values

const BAND_HEX = ['#1b1b1b', '#6b3a1e', '#d42a1f', '#f07a12', '#f4d21f', '#2e9e3f', '#2457c9', '#7a3db8', '#8a8a8a', '#f4f4f0'];
const GOLD = '#c9a23a';
const SILVER = '#c4c8cc';

/** 4-band colour code (IEC 60062) of a resistance: two digits, multiplier, gold (5 %). */
export function bandColors(r: number): string[] {
  const e = Math.floor(Math.log10(r) + 1e-9) - 1;
  const sig = Math.round(r / Math.pow(10, e));
  const mult = e >= 0 && e <= 9 ? BAND_HEX[e] : e === -1 ? GOLD : SILVER;
  return [BAND_HEX[Math.floor(sig / 10) % 10], BAND_HEX[sig % 10], mult, GOLD];
}

const findBase = (id: string): LibraryPartDef => {
  const p = [...BASIC_PARTS, ...DIODE_PARTS, ...TRANSISTOR_PARTS, ...ANALOG_PARTS].find((x) => x.id === id);
  if (!p) throw new Error(`3D part base ${id} missing`);
  return p;
};

/** Replace the named params of a base part by single-option selects (the 3D part's fixed values). */
function fixParams(base: LibraryPartDef, fixed: Record<string, [string, string]>): ParamDef[] {
  return base.params.map((p) => {
    const f = fixed[p.key];
    if (!f) return p;
    return selectParam(p.key, p.label, f[0], [f], { ...(p.unit !== undefined ? { unit: p.unit } : {}), showOnSchematic: true, group: p.group ?? 'value', help: 'Fixed value of this 3D part (use the generic part for other values)' });
  });
}

interface Pictorial {
  slug: string;
  base: string;
  name: string;
  nameVi: string;
  symbolPrims: SymbolPrim[];
  pins: PinDef[];
  fixed: Record<string, [string, string]>;
  sortKey: number;
}

function pictorial(p: Pictorial): LibraryPartDef {
  const base = findBase(p.base);
  const names = new Set(base.symbol.pins.map((x) => x.name));
  if (p.pins.some((x) => !names.has(x.name)) || p.pins.length !== names.size) throw new Error(`3D part ${p.slug}: pins differ from ${p.base}`);
  return withMeta(
    {
      ...base,
      id: `basic/3d-${p.slug}`,
      name: p.name,
      group: 'basic',
      family: '3D learner parts',
      description: `${p.name} drawn as it looks in real life; it simulates exactly like the generic ${base.name}`,
      symbol: makeSymbol(p.symbolPrims, p.pins),
      params: fixParams(base, p.fixed),
      keywords: ['3d', 'realistic', 'pictorial', 'learner', ...(base.keywords ?? [])],
    },
    { vi: `${p.nameVi} vẽ giống hình thật; mô phỏng giống hệt linh kiện chung tương ứng`, nameVi: p.nameVi, sortKey: p.sortKey },
  );
}

/** Horizontal leads from the pins to the body (2-lead parts drawn standing up on their leads). */
const legs = (x: number, y: number): SymbolPrim[] => [line(-30, 0, -x, 0), line(-x, 0, -x, y), line(x, y, x, 0), line(x, 0, 30, 0)];
const twoPins = (a = '1', b = '2'): PinDef[] => [pin(a, -30, 0, 'left', { number: '1' }), pin(b, 30, 0, 'right', { number: '2' })];

function resistor3d(v: number): Pictorial {
  const [b1, b2, b3, b4] = bandColors(v);
  return {
    slug: `resistor-${code(v)}`,
    base: 'basic/resistor',
    name: `3D Resistor ${eng(v, 'Ω')}`,
    nameVi: `Điện trở 3D ${eng(v, 'Ω')}`,
    symbolPrims: [line(-30, 0, -17, 0), line(17, 0, 30, 0), rect(-17, -7, 34, 14, '#e3c79a', 6), rect(-11, -7, 3, 14, b1), rect(-6, -7, 3, 14, b2), rect(-1, -7, 3, 14, b3), rect(9, -7, 3, 14, b4)],
    pins: twoPins(),
    fixed: { value: [userNum(v), eng(v, 'Ω')] },
    sortKey: v,
  };
}

const LED_3D: [string, string, string][] = [
  ['red', '#e53935', 'đỏ'],
  ['green', '#43a047', 'xanh lá'],
  ['yellow', '#fdd835', 'vàng'],
  ['blue', '#1e88e5', 'xanh dương'],
];

function led3d([slug, css, vi]: [string, string, string], i: number): Pictorial {
  const colour = slug.charAt(0).toUpperCase() + slug.slice(1);
  return {
    slug: `led-${slug}`,
    base: `diodes/led-${slug}`,
    name: `3D LED ${colour}`,
    nameVi: `LED 3D ${vi}`,
    symbolPrims: [...legs(4, -8), rect(-9, -11, 18, 3, css), path('M -7 -11 L -7 -22 Q -7 -30 0 -30 Q 7 -30 7 -22 L 7 -11 Z', css), line(7, -11, 7, -22, 2), text(-12, -5, '+', 7)],
    pins: twoPins('A', 'K'),
    fixed: { color: [slug, colour] },
    sortKey: 1e9 + i,
  };
}

const ceramic3d: Pictorial = {
  slug: 'capacitor-100n',
  base: 'basic/capacitor',
  name: '3D Ceramic Capacitor 100 nF',
  nameVi: 'Tụ gốm 3D 100 nF',
  symbolPrims: [...legs(4, -8), circle(0, -17, 10, '#e08a2c'), text(0, -14, '104', 6)],
  pins: twoPins(),
  fixed: { value: ['100n', '100 nF'] },
  sortKey: 2e9,
};

function electrolytic3d(v: number, label: string, i: number): Pictorial {
  return {
    slug: `electrolytic-${code(v)}`,
    base: 'basic/electrolytic',
    name: `3D Electrolytic Capacitor ${label}`,
    nameVi: `Tụ hoá 3D ${label}`,
    symbolPrims: [...legs(5, -6), rect(-11, -36, 22, 30, '#2c4f9e', 3), rect(4, -36, 7, 30, '#c8d2e6', 2), text(7, -21, '−', 8), text(-14, -4, '+', 7)],
    pins: twoPins('+', '-'),
    fixed: { value: [userNum(v), label] },
    sortKey: 2e9 + 1 + i,
  };
}

function to92(slug: string, base: string, label: string, i: number): Pictorial {
  const xs: [string, number][] = [
    ['E', -20],
    ['B', 0],
    ['C', 20],
  ];
  return {
    slug,
    base,
    name: `3D Transistor ${label}`,
    nameVi: `Transistor 3D ${label}`,
    symbolPrims: [path('M -20 8 L -20 -10 Q -20 -28 0 -28 Q 20 -28 20 -10 L 20 8 Z', '#808080'), ...xs.flatMap(([n, x]) => [line(x, 8, x, 30), text(x + 6, 22, n, 6)])],
    pins: xs.map(([n, x]) => pin(n, x, 30, 'down', { number: n === 'C' ? '1' : n === 'B' ? '2' : '3' })),
    fixed: {},
    sortKey: 3e9 + i,
  };
}

const timer3d: Pictorial = (() => {
  const top = ['VCC', 'DIS', 'THR', 'CTRL'];
  const bottom = ['GND', 'TRIG', 'OUT', 'RST'];
  const xs = [-30, -10, 10, 30];
  const prims: SymbolPrim[] = [rect(-40, -22, 80, 44, '#808080', 2), arc(-40, 0, 6, 270, 450), circle(-31, 13, 2, '#e0e0e0')];
  xs.forEach((x, i) => {
    prims.push(rect(x - 3, -30, 6, 8, '#c8c8c8'), line(x, -30, x, -40), rect(x - 3, 22, 6, 8, '#c8c8c8'), line(x, 30, x, 40));
    prims.push(text(x, -46, top[i], 6), text(x, 48, bottom[i], 6));
  });
  return {
    slug: '555',
    base: 'analog/555',
    name: '3D 555 Timer',
    nameVi: 'IC định thời 555 3D',
    symbolPrims: prims,
    // DIP-8 top view, notch left: pins 1…4 along the bottom, 8…5 along the top
    pins: [...bottom.map((n, i) => pin(n, xs[i], 40, 'down', { number: String(i + 1) })), ...top.map((n, i) => pin(n, xs[i], -40, 'up', { number: String(8 - i) }))],
    fixed: {},
    sortKey: 4e9,
  };
})();

const button3d: Pictorial = {
  slug: 'push-button',
  base: 'basic/push-button',
  name: '3D Push Button',
  nameVi: 'Nút nhấn 3D',
  symbolPrims: [line(-30, 0, -13, 0), line(13, 0, 30, 0), rect(-13, -13, 26, 26, '#6b6b6b', 2), circle(0, 0, 8, '#d84a3a'), circle(-9, -9, 1.5, '#cfcfcf'), circle(9, 9, 1.5, '#cfcfcf')],
  pins: twoPins(),
  fixed: {},
  sortKey: 5e9,
};

const slide3d: Pictorial = {
  slug: 'slide-switch',
  base: 'basic/switch-spdt',
  name: '3D Slide Switch',
  nameVi: 'Công tắc gạt 3D',
  symbolPrims: [line(-30, 0, -16, 0), line(16, -10, 30, -10), line(16, 10, 30, 10), rect(-16, -16, 32, 32, '#3f6fb5', 2), rect(-10, -5, 20, 10, '#1d2f4f', 1), rect(-10, -5, 9, 10, '#e8e8e8', 1), text(22, -16, 'A', 6), text(22, 20, 'B', 6)],
  pins: [pin('COM', -30, 0, 'left', { number: '1' }), pin('A', 30, -10, 'right', { number: '2' }), pin('B', 30, 10, 'right', { number: '3' })],
  fixed: {},
  sortKey: 5e9 + 1,
};

const pot3d: Pictorial = {
  slug: 'potentiometer-10k',
  base: 'basic/potentiometer',
  name: '3D Potentiometer 10 kΩ',
  nameVi: 'Chiết áp 3D 10 kΩ',
  symbolPrims: [line(-30, 0, -15, 0), line(15, 0, 30, 0), line(0, -30, 0, -15), circle(0, 0, 15, '#3b78c4'), circle(0, 0, 7, '#dcdcdc'), line(0, 0, 0, -7, 2)],
  pins: [pin('1', -30, 0, 'left', { number: '1' }), pin('2', 30, 0, 'right', { number: '3' }), pin('W', 0, -30, 'up', { number: '2' })],
  fixed: { value: ['10k', '10 kΩ'] },
  sortKey: 5e9 + 2,
};

const learner3d: LibraryPartDef[] = [
  ...[220, 330, 1e3, 4.7e3, 10e3, 100e3].map((v) => pictorial(resistor3d(v))),
  ...LED_3D.map((l, i) => pictorial(led3d(l, i))),
  pictorial(ceramic3d),
  pictorial(electrolytic3d(10e-6, '10 µF', 0)),
  pictorial(electrolytic3d(100e-6, '100 µF', 1)),
  pictorial(to92('npn-2n3904', 'transistors/2n3904', '2N3904 NPN', 0)),
  pictorial(to92('pnp-2n3906', 'transistors/2n3906', '2N3906 PNP', 1)),
  pictorial(timer3d),
  pictorial(button3d),
  pictorial(slide3d),
  pictorial(pot3d),
];

export const BASIC_EXTRA_CATALOG: LibraryPartDef[] = [
  nonIdealResistor,
  nonIdealCapacitor,
  nonIdealElectrolytic,
  nonIdealInductor,
  zLoadRX,
  zLoadPolar,
  ...resistorPacks,
  ...sockets,
  ...annotationSymbols,
  ...switches,
  ...magnetics,
  ...controlledRlc,
  ...learner3d,
];
