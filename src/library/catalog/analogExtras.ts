/**
 * Analog ICs and blocks of round 3 (groups Analog and Misc): operational transconductance
 * amplifiers, current-feedback amplifiers, a generic phase-locked loop, isolation amplifiers,
 * difference amplifiers and MOSFET gate drivers.
 *
 * Models (MachSim behavioural models from textbook relations; datasheet typical values where a
 * part number is named, noted in `provenance`):
 *   OTA        bipolar differential pair biased by the current into IABC (two diode drops above
 *              V−): I(OUT) = IABC·tanh(V(IN+,IN−)/(2·VT)), so gm = IABC/(2·VT) is proportional to
 *              the bias current (VT = k·T/q follows the simulation temperature). The output is a
 *              current (drawn from the supply rails) with an output resistance to ground and
 *              clamp diodes to the rails.
 *   CFOA       current-feedback amplifier: unity buffer IN+ → IN− with output resistance RINV,
 *              the error current out of IN− drives a transimpedance RT ∥ CT, output buffer with
 *              swing and current limits. Closed-loop bandwidth ≈ 1/(2π·CT·(RF + G·RINV)),
 *              nearly independent of the gain G (the defining property of a CFA).
 *   PLL        phase detector (sign of the input × cos of the VCO phase, gain kd·2/π V/rad near
 *              lock), RC loop filter on the VCTRL pin (add your own R / C there) and a VCO
 *              f = f0 + kv·V(VCTRL). Hold-in range ±(2/π)·kd·kv around f0.
 *   isolation  V(OUT,GND2) = G·V(IN+,IN−) through a single-pole bandwidth, output swing limited
 *              by the output supplies (or ± a set limit when they are open); the two grounds are
 *              joined only by the barrier (riso ∥ ciso).
 *   diff amp   one op-amp section with four matched resistors (G = R2/R1); SENSE ties to OUT
 *              when left open.
 *   gate drv   input threshold (smooth, between VIL and VIH), propagation delay through a
 *              matched lossless line, totem-pole output: pull-up resistance ROH to the supply,
 *              pull-down ROL to the reference, both limited to the peak current.
 */
import type { ElementIR, SubcktDef } from '../../sim/netlist';
import { opampSubckt, type OpampParams } from '../parts/analog';
import { card, elB, elC, elD, elE, elF, elR, elSense, elT, elX, ex, hash8, internalNode, numParam, pinConnected, selectParam, subckt, textOf, type LibraryPartDef } from '../partkit';
import { ampSymbol, boxSymbol, line, makeSymbol, pin, text } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';
import { eng, modelName, slug, userNum, withMeta } from './kit';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

/** Thermal voltage expression of the simulation temperature (temper in °C). */
const VT_EXPR = '(8.617333e-5*(temper+273.15))';

// ---------------------------------------------------------------------------------------------
// OTA

interface OtaRow {
  pn: string;
  rin: number;
  rout: number;
  iq: number;
  description: string;
  vi: string;
  pkg: string;
}

const OTA_DIODE = card('MS_OTA_VBE', 'D', { is: 1e-14, n: 1 });

/** OTA subcircuit (ports: inp inn iabc out vcc vee). */
export function otaSubckt(name: string, rin: number, rout: number, iq: number): SubcktDef {
  const ib = 'max(I(VABC),0)';
  const x = `${ib}*tanh(V(inp,inn)/(2*${VT_EXPR}))`;
  const els: ElementIR[] = [
    elR('RIN', 'inp', 'inn', rin),
    // bias input: two diode drops above V−; the current into IABC sets gm
    elSense('VABC', 'iabc', 'b1'),
    elD('D1', 'b1', 'b2', OTA_DIODE.name),
    elD('D2', 'b2', 'vee', OTA_DIODE.name),
    // output current into OUT; the supplies deliver it (sourced from V+ when positive, sunk into V−
    // when negative) — split on separate elements so the kink of max() at 0 never reaches the
    // signal path's transconductance
    elB('BOUT', '0', 'out', 'I', x),
    elB('BSRC', 'vcc', '0', 'I', `max(${x},0)`),
    elB('BSNK', '0', 'vee', 'I', `max(-(${x}),0)`),
    elR('ROUT', 'out', '0', rout),
    elD('DCP', 'out', 'vcc', OTA_DIODE.name),
    elD('DCN', 'vee', 'out', OTA_DIODE.name),
    elB('BQ', 'vcc', 'vee', 'I', `${ex(iq)}*limit(V(vcc,vee),0,1)`),
  ];
  return subckt(name, ['inp', 'inn', 'iabc', 'out', 'vcc', 'vee'], els, [OTA_DIODE]);
}

const OTA_SYMBOL: SymbolDef = (() => {
  const base = ampSymbol({ supplies: true, label: 'gm' });
  // IABC enters the lower edge of the triangle (y = 25 at x = −20)
  return makeSymbol([...base.prims, line(-20, 25, -20, 40), text(-16, 36, 'IABC', 6, 'start')], [...base.pins, pin('IABC', -20, 40, 'down', { type: 'input', number: '1' })], {
    refPos: base.refPos,
    valuePos: { x: 12, y: 50 },
  });
})();

const otaNodes = (ctx: ToSpiceContext): string[] => [ctx.node('IN+'), ctx.node('IN-'), ctx.node('IABC'), ctx.node('OUT'), ctx.node('V+'), ctx.node('V-')];

const OTA_ROWS: OtaRow[] = [
  { pn: 'CA3080', rin: 26e3, rout: 15e6, iq: 0, description: 'single OTA', vi: 'một bộ OTA', pkg: 'DIP-8' },
  { pn: 'LM13700', rin: 26e3, rout: 50e6, iq: 0.65e-3, description: 'one amplifier of the dual (linearising diodes and Darlington buffer not modelled)', vi: 'một bộ của IC hai kênh (không mô hình diode tuyến tính hoá và tầng đệm Darlington)', pkg: 'DIP-16' },
  { pn: 'NE5517', rin: 26e3, rout: 50e6, iq: 0.65e-3, description: 'one amplifier of the dual (linearising diodes and buffer not modelled)', vi: 'một bộ của IC hai kênh (không mô hình diode tuyến tính hoá và tầng đệm)', pkg: 'DIP-16' },
];

const genericOta: LibraryPartDef = withMeta(
  {
    id: 'analog/ota',
    name: 'Transconductance Amplifier (OTA)',
    group: 'analog',
    family: 'Transconductance amplifier',
    description: 'Operational transconductance amplifier: output CURRENT = gm·V(IN+,IN−) with gm = IABC/(2·VT) ≈ 19.3 mS per mA of bias current into IABC (current limited to ±IABC); a load resistor RL gives a voltage gain gm·RL',
    prefix: 'U',
    symbol: OTA_SYMBOL,
    params: [
      numParam('rin', 'Differential input resistance', '26k', 'Ω', { min: 0 }),
      numParam('rout', 'Output resistance', '15M', 'Ω', { min: 0 }),
      numParam('iq', 'Quiescent current', '0', 'A', { group: 'advanced', min: 0, help: 'Supply current besides the bias and output currents' }),
    ],
    toSpice: (ctx) => {
      const rin = pos(ctx, 'rin');
      const rout = pos(ctx, 'rout');
      const iq = Math.max(0, ctx.num('iq'));
      const sub = otaSubckt(`MS_OTA_${hash8(`${rin};${rout};${iq}`)}`, rin, rout, iq);
      return { elements: [elX(ctx.name('X'), otaNodes(ctx), sub.name)], subckts: [sub] };
    },
    provenance: 'MachSim behavioural OTA: bipolar differential pair I = IABC·tanh(Vd/2VT) (textbook), bias pin two diode drops above V−',
    virtual: true,
    keywords: ['ota', 'transconductance', 'gm', 'iabc', 'vca', 'voltage controlled amplifier', 'current output'],
  },
  { vi: 'Khuếch đại hỗ dẫn (OTA): ngõ ra là DÒNG = gm·V(IN+,IN−) với gm = IABC/(2·VT) ≈ 19.3 mS cho mỗi mA dòng phân cực vào IABC (dòng ra giới hạn ±IABC); điện trở tải RL cho hệ số khuếch đại áp gm·RL', nameVi: 'Khuếch đại hỗ dẫn (OTA)' },
);

const otas: LibraryPartDef[] = [
  genericOta,
  ...OTA_ROWS.map((r) => {
    const sub = otaSubckt(modelName(r.pn), r.rin, r.rout, r.iq);
    return withMeta(
      {
        id: `analog/${slug(r.pn)}`,
        name: r.pn,
        group: 'analog',
        family: 'Transconductance amplifier',
        description: `Operational transconductance amplifier, ${r.description}: gm = IABC/(2·VT), output current ±IABC`,
        prefix: 'U',
        symbol: OTA_SYMBOL,
        params: [],
        toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), otaNodes(ctx), sub.name)], subckts: [sub] }),
        provenance: `MachSim behavioural OTA (I = IABC·tanh(Vd/2VT)) with ${r.pn} datasheet typical input resistance ${eng(r.rin, 'Ω')} (at IABC ≈ 1 mA) and output resistance ${eng(r.rout, 'Ω')}`,
        footprint: r.pkg,
        keywords: [r.pn.toLowerCase(), 'ota', 'transconductance', 'vca', 'gm'],
      },
      { vi: `Khuếch đại hỗ dẫn, ${r.vi}: gm = IABC/(2·VT), dòng ra ±IABC`, specs: { input: 'bipolar', package: r.pkg }, series: 'OTA' },
    );
  }),
];

// ---------------------------------------------------------------------------------------------
// current-feedback op-amp

export interface CfoaParams {
  /** transimpedance at DC, Ω */
  rt: number;
  /** transcapacitance, F */
  ct: number;
  /** inverting-input (buffer output) resistance, Ω */
  rinv: number;
  rout: number;
  iq: number;
  /** output swing headroom from each rail, V */
  vsat: number;
  isc: number;
}

/** Current-feedback amplifier subcircuit (ports: inp inn out vcc vee). */
export function cfoaSubckt(name: string, p: CfoaParams): SubcktDef {
  const swing = p.isc * p.rout;
  const els: ElementIR[] = [
    elE('EB', 'e', '0', 'inp', '0', 1),
    elSense('VSE', 'e', 'f'),
    elR('RINV', 'f', 'inn', p.rinv),
    // error current out of the inverting input → transimpedance RT ∥ CT
    elF('FZ', '0', 'z', 'VSE', 1),
    elR('RT', 'z', '0', p.rt),
    elC('CT', 'z', '0', p.ct),
    elB('BCL', 'z', '0', 'I', 'max(V(z)-V(vcc),0)+min(V(z)-V(vee),0)'),
    elB('BO', 'o1', '0', 'V', `limit(limit(V(z),V(out)-${ex(swing)},V(out)+${ex(swing)}),V(vee)+${ex(p.vsat)},V(vcc)-${ex(p.vsat)})`),
    elR('RO', 'o1', 'out', p.rout),
    elB('BQ', 'vcc', 'vee', 'I', `${ex(p.iq)}*limit(V(vcc,vee),0,1)`),
    elB('BSRC', 'vcc', '0', 'I', 'max(-I(BO),0)'),
    elB('BSNK', '0', 'vee', 'I', 'max(I(BO),0)'),
  ];
  return subckt(name, ['inp', 'inn', 'out', 'vcc', 'vee'], els);
}

const CFOA_SYMBOL = ampSymbol({ supplies: true, label: 'CFA' });
const cfoaNodes = (ctx: ToSpiceContext): string[] => [ctx.node('IN+'), ctx.node('IN-'), ctx.node('OUT'), ctx.node('V+'), ctx.node('V-')];

const CFOA_KEYS: (keyof CfoaParams)[] = ['rt', 'ct', 'rinv', 'rout', 'iq', 'vsat', 'isc'];

const genericCfoa: LibraryPartDef = withMeta(
  {
    id: 'analog/cfoa',
    name: 'Current-Feedback Op-Amp',
    group: 'analog',
    family: 'Current-feedback amplifier',
    description: 'Current-feedback (transimpedance) op-amp: the closed-loop bandwidth ≈ 1/(2π·CT·(RF + G·RINV)) is set by the feedback resistor RF and hardly changes with the gain G; use RF near the recommended value, never a capacitor alone in the feedback path',
    prefix: 'U',
    symbol: CFOA_SYMBOL,
    params: [
      numParam('rt', 'Transimpedance RT', '3M', 'Ω', { min: 0, help: 'Open-loop gain from the error current to the output voltage at DC' }),
      numParam('ct', 'Transcapacitance CT', '4.5p', 'F', { min: 0, help: 'Sets the bandwidth with the feedback resistor: f ≈ 1/(2π·CT·RF)' }),
      numParam('rinv', 'Inverting-input resistance', '50', 'Ω', { min: 0 }),
      numParam('rout', 'Output resistance', '15', 'Ω', { group: 'advanced', min: 0 }),
      numParam('iq', 'Quiescent current', '6.5m', 'A', { group: 'advanced', min: 0 }),
      numParam('vsat', 'Output headroom', '3', 'V', { group: 'advanced', min: 0 }),
      numParam('isc', 'Output current limit', '60m', 'A', { group: 'advanced', min: 0 }),
    ],
    toSpice: (ctx) => {
      const p = Object.fromEntries(CFOA_KEYS.map((k) => [k, ctx.num(k)])) as unknown as CfoaParams;
      for (const k of ['rt', 'ct', 'rinv', 'rout', 'isc'] as const) if (!(p[k] > 0)) throw new Error(`bad value for ${k}: must be > 0`);
      const sub = cfoaSubckt(`MS_CFOA_${hash8(CFOA_KEYS.map((k) => p[k]).join(';'))}`, p);
      return { elements: [elX(ctx.name('X'), cfoaNodes(ctx), sub.name)], subckts: [sub] };
    },
    provenance: 'MachSim behavioural current-feedback amplifier: input buffer, transimpedance RT ∥ CT, output buffer (textbook CFA model)',
    virtual: true,
    keywords: ['current feedback', 'cfa', 'cfoa', 'transimpedance', 'wideband', 'video amplifier', 'high speed'],
  },
  { vi: 'Op-amp hồi tiếp dòng (khuếch đại xuyên trở): băng thông vòng kín ≈ 1/(2π·CT·(RF + G·RINV)) do điện trở hồi tiếp RF quyết định và gần như không đổi theo hệ số khuếch đại G; dùng RF gần giá trị khuyến nghị, không dùng riêng tụ điện làm hồi tiếp', nameVi: 'Op-amp hồi tiếp dòng' },
);

interface CfoaRow {
  pn: string;
  p: CfoaParams;
  bw: string;
  pkg: string;
}

const CFOA_ROWS: CfoaRow[] = [
  { pn: 'AD844', p: { rt: 3e6, ct: 4.5e-12, rinv: 50, rout: 15, iq: 6.5e-3, vsat: 3, isc: 60e-3 }, bw: 'transimpedance 3 MΩ, transcapacitance 4.5 pF, RINV 50 Ω', pkg: 'DIP-8' },
  // CT fitted to a −3 dB bandwidth of 420 MHz at G = +1 with RF = 1 kΩ: CT = 1/(2π·420 MHz·(1 kΩ + 15 Ω))
  { pn: 'THS3001', p: { rt: 1.3e6, ct: 0.373e-12, rinv: 15, rout: 10, iq: 6.6e-3, vsat: 1.5, isc: 100e-3 }, bw: '−3 dB bandwidth 420 MHz at G = +1, RF = 1 kΩ, RINV 15 Ω', pkg: 'SO-8' },
];

const cfoas: LibraryPartDef[] = [
  genericCfoa,
  ...CFOA_ROWS.map((r) => {
    const sub = cfoaSubckt(modelName(r.pn), r.p);
    return withMeta(
      {
        id: `analog/${slug(r.pn)}`,
        name: r.pn,
        group: 'analog',
        family: 'Current-feedback amplifier',
        description: `Current-feedback op-amp: ${r.bw}; bandwidth set by RF`,
        prefix: 'U',
        symbol: CFOA_SYMBOL,
        params: [],
        toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), cfoaNodes(ctx), sub.name)], subckts: [sub] }),
        provenance: `MachSim current-feedback model parameterised from ${r.pn} datasheet typical values (${r.bw}; supply current ${eng(r.p.iq, 'A')})`,
        footprint: r.pkg,
        keywords: [r.pn.toLowerCase(), 'current feedback', 'cfa', 'wideband', 'video'],
      },
      { vi: `Op-amp hồi tiếp dòng: ${r.bw.replace('transimpedance', 'trở kháng xuyên').replace('transcapacitance', 'dung kháng xuyên').replace('−3 dB bandwidth', 'băng thông −3 dB')}; băng thông do RF quyết định`, specs: { iq: r.p.iq, package: r.pkg }, series: 'CFA' },
    );
  }),
];

// ---------------------------------------------------------------------------------------------
// PLL block

const PLL_SYMBOL = boxSymbol({
  w: 80,
  h: 60,
  left: [{ name: 'IN', type: 'input' }],
  right: [{ name: 'OUT', type: 'output' }, { name: 'PD', type: 'output' }],
  bottom: [{ name: 'VC', label: 'VCTRL' }],
  title: 'PLL',
  titlePos: { x: 0, y: -8 },
  extra: [text(0, 6, 'PD-LF-VCO', 6)],
});

/** Hold-in range of the PLL block (Hz either side of f0): (2/π)·kd·kv. */
export const pllHoldRange = (kd: number, kv: number): number => (2 / Math.PI) * kd * kv;

const pll: LibraryPartDef = withMeta(
  {
    id: 'analog/pll',
    name: 'Phase-Locked Loop',
    group: 'analog',
    family: 'PLL',
    description: 'Phase-locked loop block: phase detector, RC loop filter (on the VCTRL pin) and VCO f = f0 + kv·V(VCTRL). Locked, OUT has the input frequency and V(VCTRL) = (fin − f0)/kv; hold-in range ±(2/π)·kd·kv around f0',
    prefix: 'U',
    symbol: PLL_SYMBOL,
    params: [
      numParam('f0', 'Free-running frequency', '10k', 'Hz', { showOnSchematic: true, min: 0, help: 'VCO frequency with 0 V on VCTRL' }),
      numParam('kv', 'VCO gain', '2k', 'Hz/V', { min: 0, help: 'Change of the VCO frequency per volt on VCTRL' }),
      numParam('kd', 'Phase-detector gain', '1', 'V', { min: 0, help: 'Peak output of the phase detector; the average output is (2/π)·kd·sin(phase error)' }),
      numParam('flp', 'Loop-filter cut-off', '500', 'Hz', { min: 0, help: 'Corner of the internal RC filter (10 kΩ and a capacitor) between the phase detector and VCTRL; a capacitor from VCTRL to ground lowers it' }),
      numParam('amplitude', 'Output amplitude', '5', 'V', { min: 0 }),
      selectParam('waveform', 'Output waveform', 'square', [['square', 'Square 0 … amplitude'], ['sine', 'Sine ± amplitude']]),
      numParam('vth', 'Input sensitivity', '10m', 'V', { group: 'advanced', min: 0, help: 'Input amplitude well above this counts as a full-size signal (the input is used through its sign)' }),
    ],
    toSpice: (ctx) => {
      const f0 = pos(ctx, 'f0');
      const kv = ctx.num('kv');
      const kd = ctx.num('kd');
      const flp = pos(ctx, 'flp');
      const amp = ctx.num('amplitude');
      const vth = pos(ctx, 'vth');
      const ph = internalNode(ctx, 'phase');
      const pd = pinConnected(ctx, 'PD') ? ctx.node('PD') : internalNode(ctx, 'pd');
      const vc = ctx.node('VC');
      const rlf = 10e3;
      const vin = pinConnected(ctx, 'IN') ? `V(${ctx.node('IN')})` : '0';
      const vco = `sin(2*pi*V(${ph}))`;
      const out = textOf(ctx, 'waveform', 'square').trim() === 'sine' ? `${ex(amp)}*${vco}` : `${ex(amp / 2)}*(1+tanh(10*${vco}))`;
      return {
        elements: [
          elB(ctx.name('B', 'pd'), pd, '0', 'V', `${ex(kd)}*tanh(${vin}/${ex(vth)})*cos(2*pi*V(${ph}))`),
          elR(ctx.name('R', 'lf'), pd, vc, rlf),
          elC(ctx.name('C', 'lf'), vc, '0', 1 / (2 * Math.PI * rlf * flp)),
          // VCO phase in cycles: the u(time) factor keeps it at 0 in the operating point
          elB(ctx.name('B', 'f'), '0', ph, 'I', `u(time)*(${ex(f0)}+${ex(kv)}*V(${vc}))`),
          elC(ctx.name('C', 'ph'), ph, '0', 1),
          elR(ctx.name('R', 'ph'), ph, '0', 1e15),
          elB(ctx.name('B', 'out'), ctx.node('OUT'), '0', 'V', out),
        ],
      };
    },
    optionalPins: ['PD', 'VC'],
    provenance: 'Ideal behavioural phase-locked loop (multiplier phase detector, first-order RC loop filter, phase-integrating VCO)',
    virtual: true,
    keywords: ['pll', 'phase locked loop', 'phase detector', 'vco', 'frequency synthesizer', 'lock', 'loop filter'],
  },
  { vi: 'Khối vòng khoá pha: bộ so pha, lọc vòng RC (ở chân VCTRL) và VCO f = f0 + kv·V(VCTRL). Khi khoá, OUT có đúng tần số ngõ vào và V(VCTRL) = (fin − f0)/kv; dải giữ khoá ±(2/π)·kd·kv quanh f0', nameVi: 'Vòng khoá pha (PLL)' },
);

// ---------------------------------------------------------------------------------------------
// isolation amplifier

const ISO_SYMBOL = boxSymbol({
  w: 80,
  h: 80,
  left: [{ name: 'IN+', label: '+', type: 'input' }, { name: 'IN-', label: '−', type: 'input' }, { name: 'GND1', label: 'G1' }],
  right: [{ name: 'V+', type: 'power' }, { name: 'OUT', type: 'output' }, { name: 'GND2', label: 'G2' }, { name: 'V-', label: 'V−', type: 'power' }],
  title: 'ISO',
  titlePos: { x: 0, y: -22 },
  extra: [line(-3, -40, -3, 40), line(3, -40, 3, 40)],
});

const isolationAmp: LibraryPartDef = withMeta(
  {
    id: 'analog/isolation-amplifier',
    name: 'Isolation Amplifier',
    group: 'analog',
    family: 'Isolation amplifier',
    description: 'Amplifier across an isolation barrier: V(OUT,GND2) = G·V(IN+,IN−) with a single-pole bandwidth; the input side (GND1) and the output side (GND2) are joined only by the barrier resistance and capacitance, so the input may sit hundreds of volts away from the output ground',
    prefix: 'U',
    symbol: ISO_SYMBOL,
    params: [
      numParam('gain', 'Gain', '1', 'V/V', { showOnSchematic: true }),
      numParam('bw', 'Bandwidth', '50k', 'Hz', { min: 0 }),
      numParam('rin', 'Input resistance', '200k', 'Ω', { min: 0, help: 'Between IN+ and IN−; each input also has 1 GΩ to GND1' }),
      numParam('vmax', 'Output limit (open supplies)', '10', 'V', { min: 0, help: 'Output swing ± this voltage around GND2 when V+ / V− are not connected; with supplies the output stays 1.5 V inside them' }),
      numParam('riso', 'Barrier resistance', '1T', 'Ω', { group: 'advanced', min: 0 }),
      numParam('ciso', 'Barrier capacitance', '2p', 'F', { group: 'advanced', min: 0 }),
      numParam('rout', 'Output resistance', '0.1', 'Ω', { group: 'advanced', min: 0 }),
    ],
    toSpice: (ctx) => {
      const g = ctx.num('gain');
      const bw = pos(ctx, 'bw');
      const g1 = ctx.node('GND1');
      const g2 = ctx.node('GND2');
      const x = internalNode(ctx, 'x');
      const y = internalNode(ctx, 'y');
      const o1 = internalNode(ctx, 'o');
      const vmax = ctx.num('vmax');
      const hasSupply = pinConnected(ctx, 'V+') && pinConnected(ctx, 'V-');
      const hi = hasSupply ? `V(${ctx.node('V+')})-1.5` : `V(${g2})+${ex(vmax)}`;
      const lo = hasSupply ? `V(${ctx.node('V-')})+1.5` : `V(${g2})-${ex(vmax)}`;
      const rbw = 1e3;
      const els: ElementIR[] = [
        elR(ctx.name('R', 'in'), ctx.node('IN+'), ctx.node('IN-'), pos(ctx, 'rin')),
        elR(ctx.name('R', 'cmp'), ctx.node('IN+'), g1, 1e9),
        elR(ctx.name('R', 'cmn'), ctx.node('IN-'), g1, 1e9),
        elE(ctx.name('E'), x, g2, ctx.node('IN+'), ctx.node('IN-'), g),
        elR(ctx.name('R', 'bw'), x, y, rbw),
        elC(ctx.name('C', 'bw'), y, g2, 1 / (2 * Math.PI * rbw * bw)),
        elB(ctx.name('B', 'o'), o1, '0', 'V', `limit(V(${y}),${lo},${hi})`),
        elR(ctx.name('R', 'o'), o1, ctx.node('OUT'), pos(ctx, 'rout')),
        elR(ctx.name('R', 'iso'), g1, g2, pos(ctx, 'riso')),
        elC(ctx.name('C', 'iso'), g1, g2, pos(ctx, 'ciso')),
      ];
      if (hasSupply) els.push(elR(ctx.name('R', 'q'), ctx.node('V+'), ctx.node('V-'), 3e3));
      return { elements: els };
    },
    optionalPins: ['V+', 'V-'],
    provenance: 'Ideal behavioural isolation amplifier (gain, single-pole bandwidth, barrier R ∥ C); defaults typical of a unity-gain capacitive-barrier isolation amplifier',
    virtual: true,
    keywords: ['isolation amplifier', 'isolated', 'galvanic isolation', 'barrier', 'iso amp', 'high voltage measurement'],
  },
  { vi: 'Bộ khuếch đại qua rào cách ly: V(OUT,GND2) = G·V(IN+,IN−) với băng thông một cực; phía vào (GND1) và phía ra (GND2) chỉ nối với nhau qua điện trở và điện dung của rào cách ly, nên phía vào có thể cách đất phía ra hàng trăm vôn', nameVi: 'Khuếch đại cách ly' },
);

// ---------------------------------------------------------------------------------------------
// difference amplifiers

interface DiffRow {
  pn: string;
  r1: number;
  r2: number;
  amp: OpampParams;
  pkg: string;
}

const DIFF_BASE: OpampParams = { avol: 1e6, gbw: 1e6, slew: 3e6, rin: 1e9, rout: 50, vos: 50e-6, iq: 1.5e-3, vsatp: 2, vsatn: 2, isc: 25e-3 };
const DIFF_ROWS: DiffRow[] = [
  { pn: 'INA105', r1: 25e3, r2: 25e3, amp: DIFF_BASE, pkg: 'DIP-8' },
  { pn: 'INA106', r1: 10e3, r2: 100e3, amp: { ...DIFF_BASE, gbw: 5e6 }, pkg: 'DIP-8' },
  { pn: 'INA133', r1: 25e3, r2: 25e3, amp: { ...DIFF_BASE, gbw: 1.5e6, slew: 5e6, iq: 0.95e-3 }, pkg: 'SO-8' },
  { pn: 'AD8276', r1: 40e3, r2: 40e3, amp: { ...DIFF_BASE, gbw: 0.55e6, slew: 1.1e6, iq: 0.2e-3, vsatp: 0.2, vsatn: 0.2 }, pkg: 'SO-8' },
];

const DIFF_SYMBOL = boxSymbol({
  w: 80,
  h: 80,
  left: [{ name: 'IN-', label: '−', type: 'input' }, { name: 'IN+', label: '+', type: 'input' }],
  right: [{ name: 'OUT', type: 'output' }, { name: 'SENSE' }, { name: 'REF' }],
  top: [{ name: 'V+', type: 'power' }],
  bottom: [{ name: 'V-', label: 'V−', type: 'power' }],
  title: 'DIFF',
  titleSize: 8,
  titlePos: { x: 0, y: -22 },
});

const diffAmps: LibraryPartDef[] = DIFF_ROWS.map((r) => {
  const amp = opampSubckt(modelName(r.pn, 'AMP'), r.amp);
  const sub = subckt(modelName(r.pn), ['inn', 'inp', 'ref', 'sense', 'out', 'vcc', 'vee'], [
    elR('R1', 'inn', 'm', r.r1),
    elR('R2', 'm', 'sense', r.r2),
    elR('R3', 'inp', 'p', r.r1),
    elR('R4', 'p', 'ref', r.r2),
    elX('X1', ['p', 'm', 'out', 'vcc', 'vee'], amp.name),
  ]);
  sub.subckts[amp.name.toLowerCase()] = amp;
  const g = r.r2 / r.r1;
  return withMeta(
    {
      id: `analog/${slug(r.pn)}`,
      name: r.pn,
      group: 'analog',
      family: 'Difference amplifier',
      description: `Precision difference amplifier: V(OUT) = ${g}·(V(IN+) − V(IN−)) + V(REF), laser-trimmed ${eng(r.r1, 'Ω')} / ${eng(r.r2, 'Ω')} resistors; SENSE is tied to OUT when left open`,
      prefix: 'U',
      symbol: DIFF_SYMBOL,
      params: [],
      optionalPins: ['SENSE'],
      toSpice: (ctx) => {
        const out = ctx.node('OUT');
        const sense = pinConnected(ctx, 'SENSE') ? ctx.node('SENSE') : out;
        return { elements: [elX(ctx.name('X'), [ctx.node('IN-'), ctx.node('IN+'), ctx.node('REF'), sense, out, ctx.node('V+'), ctx.node('V-')], sub.name)], subckts: [sub] };
      },
      provenance: `MachSim model of the ${r.pn}: op-amp macromodel section (GBW ${eng(r.amp.gbw, 'Hz')}) with the datasheet resistor values ${eng(r.r1, 'Ω')} / ${eng(r.r2, 'Ω')}`,
      footprint: r.pkg,
      keywords: [r.pn.toLowerCase(), 'difference amplifier', 'differential amplifier', 'subtractor', 'current sense', 'unity gain'],
    },
    { vi: `Khuếch đại hiệu chính xác: V(OUT) = ${g}·(V(IN+) − V(IN−)) + V(REF), điện trở ${eng(r.r1, 'Ω')} / ${eng(r.r2, 'Ω')} chỉnh bằng laser; để hở SENSE thì SENSE nối vào OUT`, specs: { gain: g, gbw: r.amp.gbw, package: r.pkg }, sortKey: g, series: 'Difference amplifier' },
  );
});

// ---------------------------------------------------------------------------------------------
// MOSFET gate drivers (group Misc)

export interface DriverParams {
  /** input low / high thresholds, V */
  vil: number;
  vih: number;
  roh: number;
  rol: number;
  ipk: number;
  /** propagation delay, s */
  tpd: number;
  iq: number;
}

/**
 * One driver channel: input `inp` against `inRef`, output `out` between the supply `sup` and
 * `ref`. Returns the elements (names get `tag`).
 */
export function driverChannel(ctx: ToSpiceContext, tag: string, inp: string, inRef: string, out: string, sup: string, ref: string, p: DriverParams, invert: boolean): ElementIR[] {
  const vth = (p.vil + p.vih) / 2;
  const width = Math.max(0.01, (p.vih - p.vil) / 8);
  const sraw = `0.5*(1+tanh((V(${inp},${inRef})-${ex(vth)})/${ex(width)}))`;
  const s0 = internalNode(ctx, `${tag}s0`);
  const els: ElementIR[] = [elB(ctx.name('B', `${tag}in`), s0, '0', 'V', invert ? `1-${sraw}` : sraw)];
  let s = `V(${s0})`;
  if (p.tpd > 0) {
    // exact delay: matched lossless line (1 Ω source and load), so V(s2) = V(s0)/2 delayed by tpd
    const s1 = internalNode(ctx, `${tag}s1`);
    const s2 = internalNode(ctx, `${tag}s2`);
    els.push(elR(ctx.name('R', `${tag}d1`), s0, s1, 1), elT(ctx.name('T', tag), s1, '0', s2, '0', 1, p.tpd), elR(ctx.name('R', `${tag}d2`), s2, '0', 1));
    s = `(2*V(${s2}))`;
  }
  els.push(
    elB(ctx.name('B', `${tag}up`), sup, out, 'I', `${s}*limit(V(${sup},${out})/${ex(p.roh)},0,${ex(p.ipk)})`),
    elB(ctx.name('B', `${tag}dn`), out, ref, 'I', `(1-${s})*limit(V(${out},${ref})/${ex(p.rol)},0,${ex(p.ipk)})`),
    elR(ctx.name('R', `${tag}o`), out, ref, 1e6),
  );
  return els;
}

const DRIVER_SYMBOL = boxSymbol({
  w: 60,
  h: 40,
  left: [{ name: 'IN', type: 'input' }],
  right: [{ name: 'OUT', type: 'output' }],
  top: [{ name: 'VDD', type: 'power' }],
  bottom: [{ name: 'GND', type: 'power' }],
  title: 'DRV',
  titleSize: 8,
});
const DRIVER_INV_SYMBOL = boxSymbol({
  w: 60,
  h: 40,
  left: [{ name: 'IN', type: 'input' }],
  right: [{ name: 'OUT', type: 'output', label: 'OUT̅' }],
  top: [{ name: 'VDD', type: 'power' }],
  bottom: [{ name: 'GND', type: 'power' }],
  title: 'DRV',
  titleSize: 8,
});

const driverParamDefs = (d: DriverParams, extra: ParamDef[] = []): ParamDef[] => [
  numParam('roh', 'Pull-up resistance', String(d.roh), 'Ω', { min: 0, help: 'Output resistance while driving high (to VDD)' }),
  numParam('rol', 'Pull-down resistance', String(d.rol), 'Ω', { min: 0, help: 'Output resistance while driving low (to GND)' }),
  numParam('ipk', 'Peak output current', userNum(d.ipk), 'A', { min: 0 }),
  numParam('tpd', 'Propagation delay', userNum(d.tpd), 's', { min: 0 }),
  numParam('vil', 'Input low threshold', String(d.vil), 'V'),
  numParam('vih', 'Input high threshold', String(d.vih), 'V'),
  numParam('iq', 'Quiescent current', userNum(d.iq), 'A', { group: 'advanced', min: 0 }),
  ...extra,
];

function readDriver(ctx: ToSpiceContext): DriverParams {
  const p: DriverParams = { vil: ctx.num('vil'), vih: ctx.num('vih'), roh: pos(ctx, 'roh'), rol: pos(ctx, 'rol'), ipk: pos(ctx, 'ipk'), tpd: ctx.num('tpd'), iq: ctx.num('iq') };
  if (!(p.vih > p.vil)) throw new Error('bad value for vih: must exceed vil');
  if (p.tpd < 0) throw new Error('bad value for tpd: must be >= 0');
  return p;
}

interface DriverRow {
  pn: string;
  invert: boolean;
  d: DriverParams;
  pkg: string;
  note: string;
  noteVi: string;
}

const TTL_IN = { vil: 0.8, vih: 2.4 };
const DRIVER_ROWS: DriverRow[] = [
  { pn: 'TC4420', invert: false, d: { ...TTL_IN, roh: 2.8, rol: 2.5, ipk: 6, tpd: 25e-9, iq: 0.45e-3 }, pkg: 'DIP-8', note: '6 A non-inverting', noteVi: '6 A không đảo' },
  { pn: 'TC4429', invert: true, d: { ...TTL_IN, roh: 2.8, rol: 2.5, ipk: 6, tpd: 25e-9, iq: 0.45e-3 }, pkg: 'DIP-8', note: '6 A inverting', noteVi: '6 A đảo' },
  { pn: 'TC4427', invert: false, d: { ...TTL_IN, roh: 7, rol: 7, ipk: 1.5, tpd: 30e-9, iq: 1e-3 }, pkg: 'DIP-8', note: '1.5 A non-inverting, one channel of the dual', noteVi: '1.5 A không đảo, một kênh của IC hai kênh' },
  { pn: 'TC4426', invert: true, d: { ...TTL_IN, roh: 7, rol: 7, ipk: 1.5, tpd: 30e-9, iq: 1e-3 }, pkg: 'DIP-8', note: '1.5 A inverting, one channel of the dual', noteVi: '1.5 A đảo, một kênh của IC hai kênh' },
  { pn: 'MIC4422', invert: false, d: { ...TTL_IN, roh: 2.8, rol: 2.8, ipk: 9, tpd: 30e-9, iq: 0.45e-3 }, pkg: 'DIP-8', note: '9 A non-inverting', noteVi: '9 A không đảo' },
];

const lowSideDriver = (id: string, name: string, description: string, vi: string, nameVi: string | undefined, d: DriverParams, invert: boolean, extra: Partial<LibraryPartDef>): LibraryPartDef =>
  withMeta(
    {
      id,
      name,
      group: 'misc',
      family: 'Gate driver',
      description,
      prefix: 'U',
      symbol: invert ? DRIVER_INV_SYMBOL : DRIVER_SYMBOL,
      params: driverParamDefs(d),
      toSpice: (ctx) => {
        const p = readDriver(ctx);
        const vdd = ctx.node('VDD');
        const gnd = ctx.node('GND');
        return { elements: [...driverChannel(ctx, 'a', ctx.node('IN'), gnd, ctx.node('OUT'), vdd, gnd, p, invert), elB(ctx.name('B', 'q'), vdd, gnd, 'I', `${ex(Math.max(0, p.iq))}*limit(V(${vdd},${gnd}),0,1)`)] };
      },
      ...extra,
      keywords: ['gate driver', 'mosfet driver', 'igbt driver', 'low side', 'totem pole', ...(extra.keywords ?? [])],
    } as LibraryPartDef,
    { vi, ...(nameVi ? { nameVi } : {}), specs: { iout: d.ipk, tpd: d.tpd, ...(extra.footprint ? { package: extra.footprint } : {}) }, sortKey: d.ipk, series: 'Gate driver' },
  );

const genericDriverParams: DriverParams = { ...TTL_IN, roh: 2.5, rol: 2.5, ipk: 4, tpd: 20e-9, iq: 0.5e-3 };

const gateDrivers: LibraryPartDef[] = [
  lowSideDriver(
    'misc/gate-driver',
    'MOSFET Gate Driver',
    'Low-side MOSFET / IGBT gate driver: a logic input (thresholds VIL / VIH) switches a totem-pole output between VDD (through ROH) and GND (through ROL), limited to the peak current, after the propagation delay; charges a gate capacitance C in about 2.2·ROH·C (10–90 %)',
    'Mạch lái cổng MOSFET / IGBT phía thấp: ngõ vào logic (ngưỡng VIL / VIH) chuyển ngõ ra kéo-đẩy giữa VDD (qua ROH) và GND (qua ROL), giới hạn ở dòng đỉnh, sau thời gian trễ truyền; nạp điện dung cổng C trong khoảng 2.2·ROH·C (10–90 %)',
    'Mạch lái cổng MOSFET',
    genericDriverParams,
    false,
    { provenance: 'Ideal behavioural gate driver (threshold, exact delay line, resistive totem-pole output with current limit)', virtual: true },
  ),
  ...DRIVER_ROWS.map((r) =>
    lowSideDriver(
      `misc/${slug(r.pn)}`,
      r.pn,
      `${r.note} low-side MOSFET driver: ROH ${eng(r.d.roh, 'Ω')}, ROL ${eng(r.d.rol, 'Ω')}, peak ${eng(r.d.ipk, 'A')}, delay ${eng(r.d.tpd, 's')}, TTL-compatible input`,
      `Mạch lái MOSFET phía thấp ${r.noteVi}: ROH ${eng(r.d.roh, 'Ω')}, ROL ${eng(r.d.rol, 'Ω')}, dòng đỉnh ${eng(r.d.ipk, 'A')}, trễ ${eng(r.d.tpd, 's')}, ngõ vào tương thích TTL`,
      undefined,
      r.d,
      r.invert,
      { provenance: `MachSim behavioural driver parameterised from ${r.pn} datasheet typical values: output resistances ${eng(r.d.roh, 'Ω')} / ${eng(r.d.rol, 'Ω')}, peak current ${eng(r.d.ipk, 'A')}, delay ${eng(r.d.tpd, 's')}, VIL / VIH 0.8 / 2.4 V`, footprint: r.pkg, keywords: [r.pn.toLowerCase()] },
    ),
  ),
  withMeta(
    {
      id: 'misc/half-bridge-driver',
      name: 'Half-Bridge Gate Driver',
      group: 'misc',
      family: 'Gate driver',
      description: 'High- and low-side gate driver for a half bridge: LO switches between VCC and COM, HO between VB and VS (the floating high side, supplied by a bootstrap capacitor from VB to VS); HIN and LIN are logic inputs against COM',
      prefix: 'U',
      symbol: boxSymbol({
        w: 80,
        h: 100,
        left: [{ name: 'HIN', type: 'input' }, { name: 'LIN', type: 'input' }, { name: 'VCC', type: 'power' }, { name: 'COM', type: 'power' }],
        right: [{ name: 'VB', type: 'power' }, { name: 'HO', type: 'output' }, { name: 'VS' }, { name: 'LO', type: 'output' }],
        title: 'HB DRV',
        titleSize: 8,
      }),
      params: driverParamDefs({ ...TTL_IN, roh: 5, rol: 5, ipk: 2, tpd: 100e-9, iq: 0.3e-3 }),
      toSpice: (ctx) => {
        const p = readDriver(ctx);
        const com = ctx.node('COM');
        return {
          elements: [
            ...driverChannel(ctx, 'h', ctx.node('HIN'), com, ctx.node('HO'), ctx.node('VB'), ctx.node('VS'), p, false),
            ...driverChannel(ctx, 'l', ctx.node('LIN'), com, ctx.node('LO'), ctx.node('VCC'), com, p, false),
            elB(ctx.name('B', 'q'), ctx.node('VCC'), com, 'I', `${ex(Math.max(0, p.iq))}*limit(V(${ctx.node('VCC')},${com}),0,1)`),
          ],
        };
      },
      provenance: 'Ideal behavioural half-bridge driver (two channels of the low-side driver model, the high side referred to VS)',
      virtual: true,
      keywords: ['half bridge', 'high side', 'bootstrap', 'gate driver', 'inverter', 'h-bridge'],
    },
    { vi: 'Mạch lái cổng phía cao và phía thấp cho nửa cầu: LO chuyển giữa VCC và COM, HO giữa VB và VS (phía cao thả nổi, cấp nguồn bằng tụ bootstrap từ VB tới VS); HIN và LIN là ngõ vào logic so với COM', nameVi: 'Mạch lái cổng nửa cầu', specs: { iout: 2, tpd: 100e-9 }, sortKey: 100, series: 'Gate driver' },
  ),
];

export const ANALOG_EXTRA_CATALOG: LibraryPartDef[] = [...otas, ...cfoas, pll, isolationAmp, ...diffAmps, ...gateDrivers];
