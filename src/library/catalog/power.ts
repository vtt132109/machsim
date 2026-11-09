/**
 * Power catalogue (group Power, plus PI / PID blocks in Analog › Control functions):
 * linear and low-dropout regulators, averaged buck switching regulators, averaged converter
 * modules (buck, boost, buck-boost, Ćuk) and the averaged PWM switch, a PWM generator, PI / PID
 * controllers and a phase-angle (firing-angle) controller.
 *
 * Models
 *   linear       the behavioural regulator of src/library/parts/power.ts (output, dropout,
 *                current limit, quiescent current) with each part's datasheet typicals.
 *   PWM switch   Vorpérian's averaged (CCM) PWM switch: v(c,p) = d·v(a,p), i(a) = d·i(c), with
 *                the duty cycle d from the D pin (0…1 V) or the "Duty cycle" parameter. The
 *                averaged model shows the average voltages and currents a real converter has over
 *                one switching period (no ripple), so it simulates fast and gives a correct OP.
 *   converters   the PWM switch wired as buck (a = IN, c = node, p = GND), boost (a = GND, c =
 *                node, p = OUT), inverting buck-boost (a = IN, c = node, p = OUT) and Ćuk (c = GND)
 *                with the inductors, capacitors and winding resistance inside the module.
 *   buck IC      averaged buck regulator: an integrating error amplifier commands the average
 *                switch-node voltage (loop crossover ≈ 100 Hz, so it stays stable with any
 *                practical output LC), 0.15 Ω switch resistance, current limit, input current
 *                = (V(sw) / V(in))·I(sw); the external inductor, catch diode and capacitor are
 *                drawn by the learner exactly as in the datasheet application circuit.
 *   PWM          sawtooth comparator: OUT high while V(VC) is above the internal ramp.
 *   PI / PID     u = Kp·e + Ki·∫e dt + Kd·de/dt (derivative filtered by Tf), e = V(SP) − V(PV),
 *                output and integrator limited to [min, max] (anti-windup).
 *   phase angle  degrees since the last zero crossing of V(L,N) are integrated on two ramps (one
 *                per half wave); a gate pulse of the set width starts at α = 180°·(1 − V(VC)/10 V)
 *                in every half wave, for TRIAC / SCR phase control.
 */
import type { ElementIR, SubcktDef } from '../../sim/netlist';
import { regulatorPart, type RegSpec } from '../parts/power';
import { elB, elC, elL, elR, elSense, elV, elX, ex, internalNode, numParam, pinConnected, subckt, wPulse, type LibraryPartDef } from '../partkit';
import { boxSymbol, line, text } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';
import { eng, modelName, withMeta } from './kit';

// ---------------------------------------------------------------------------------------------
// linear regulators: "pn kind v vdo ilim iq rout package"

const REG_TEXT = [
  ...['7806 6', '7808 8', '7810 10', '7818 18', '7824 24'].map((s) => `${s.split(' ')[0]} pos ${s.split(' ')[1]} 2 1.5 5m 0.02 TO-220`),
  ...['78L05 5', '78L06 6', '78L08 8', '78L09 9', '78L12 12', '78L15 15'].map((s) => `${s.split(' ')[0]} pos ${s.split(' ')[1]} 1.7 0.14 3m 0.1 TO-92`),
  ...['78M05 5', '78M06 6', '78M08 8', '78M09 9', '78M12 12', '78M15 15'].map((s) => `${s.split(' ')[0]} pos ${s.split(' ')[1]} 2 0.7 4.5m 0.05 TO-220`),
  ...['7906 6', '7908 8', '7909 9', '7918 18', '7924 24'].map((s) => `${s.split(' ')[0]} neg ${s.split(' ')[1]} 1.1 1.5 3m 0.02 TO-220`),
  ...['79L05 5', '79L12 12', '79L15 15'].map((s) => `${s.split(' ')[0]} neg ${s.split(' ')[1]} 1.7 0.14 3m 0.1 TO-92`),
  'LM317L adj 1.25 1.7 0.2 50u 0.05 TO-92',
  'LM317M adj 1.25 1.7 0.75 50u 0.02 TO-220',
  'LM317HV adj 1.25 1.7 2.2 50u 0.01 TO-220',
  'LM350 adj 1.25 1.7 4.5 50u 0.005 TO-220',
  'LM338 adj 1.25 1.7 7 50u 0.004 TO-220',
  'LM337L adjneg 1.25 1.7 0.2 65u 0.05 TO-92',
  ...['LM1117-1.8 1.8', 'LM1117-2.5 2.5', 'LM1117-5.0 5'].map((s) => `${s.split(' ')[0]} pos ${s.split(' ')[1]} 1.1 1.2 5m 0.02 SOT-223`),
  'LM1117-ADJ adj 1.25 1.1 1.2 60u 0.02 SOT-223',
  ...['AMS1117-1.2 1.2', 'AMS1117-1.5 1.5', 'AMS1117-1.8 1.8', 'AMS1117-2.5 2.5', 'AMS1117-2.85 2.85', 'AMS1117-3.3 3.3', 'AMS1117-5.0 5'].map((s) => `${s.split(' ')[0]} pos ${s.split(' ')[1]} 1.1 1.1 5m 0.02 SOT-223`),
  'AMS1117-ADJ adj 1.25 1.1 1.1 50u 0.02 SOT-223',
  'LD1117-3.3 pos 3.3 1.0 1.0 5m 0.02 SOT-223',
  'LD1117-5.0 pos 5 1.0 1.0 5m 0.02 SOT-223',
  'LM2940-5.0 pos 5 0.5 1.5 10m 0.02 TO-220',
  'LM2940-12 pos 12 0.5 1.5 10m 0.02 TO-220',
  'LM2937-3.3 pos 3.3 0.5 0.75 2m 0.03 TO-220',
  'LM2937-5.0 pos 5 0.5 0.75 2m 0.03 TO-220',
  'LM2931-5.0 pos 5 0.3 0.15 0.4m 0.1 TO-92',
  'L4940V5 pos 5 0.5 2 5m 0.02 TO-220',
  'LP2950-3.3 pos 3.3 0.38 0.16 75u 0.1 TO-92',
  'LP2950-5.0 pos 5 0.38 0.16 75u 0.1 TO-92',
  'LP2985-3.3 pos 3.3 0.28 0.35 0.85m 0.1 SOT-23-5',
  ...['MCP1700-1.8 1.8', 'MCP1700-2.5 2.5', 'MCP1700-3.3 3.3', 'MCP1700-5.0 5'].map((s) => `${s.split(' ')[0]} pos ${s.split(' ')[1]} 0.178 0.4 1.6u 0.2 SOT-23`),
  'MCP1702-3.3 pos 3.3 0.625 0.4 2u 0.2 SOT-23',
  'MCP1702-5.0 pos 5 0.625 0.4 2u 0.2 SOT-23',
  'HT7333 pos 3.3 0.09 0.3 4u 0.2 TO-92',
  'HT7533 pos 3.3 0.1 0.15 2.5u 0.3 TO-92',
  'XC6206P332 pos 3.3 0.25 0.3 1u 0.3 SOT-23',
  'LM3940-3.3 pos 3.3 0.8 1.5 10m 0.03 TO-220',
  'LT1086-3.3 pos 3.3 1.3 2 5m 0.02 TO-220',
  'LT1086-5 pos 5 1.3 2 5m 0.02 TO-220',
  'LT1083 adj 1.25 1.3 9 55u 0.003 TO-247',
  'LT1084 adj 1.25 1.3 6.5 55u 0.004 TO-220',
  'LT1085 adj 1.25 1.3 4 55u 0.006 TO-220',
  'LM1084-ADJ adj 1.25 1.3 6 55u 0.004 TO-220',
  'LM1085-ADJ adj 1.25 1.3 4 55u 0.006 TO-220',
  'LM1086-3.3 pos 3.3 1.3 2.7 5m 0.01 TO-220',
  'LM1086-5.0 pos 5 1.3 2.7 5m 0.01 TO-220',
  'LM1086-ADJ adj 1.25 1.3 2.7 55u 0.01 TO-220',
  'LM323 pos 5 2 4 12m 0.005 TO-3',
];

const num = (s: string, pn: string): number => {
  const v = Number(s.replace(/u$/, 'e-6').replace(/m$/, 'e-3'));
  if (!Number.isFinite(v)) throw new Error(`bad regulator value '${s}' in ${pn}`);
  return v;
};

const regulators: LibraryPartDef[] = REG_TEXT.map((t) => {
  const [pn, kind, vS, dS, lS, qS, rS, pkg] = t.split(/\s+/);
  const s: RegSpec = { pn, kind: kind as RegSpec['kind'], v: num(vS, pn), vdo: num(dS, pn), ilim: num(lS, pn), iq: num(qS, pn), rout: num(rS, pn), description: '', footprint: pkg };
  const ldo = s.vdo < 0.9;
  const adj = s.kind === 'adj' || s.kind === 'adjneg';
  const neg = s.kind === 'neg' || s.kind === 'adjneg';
  const iout = Number((s.ilim / (s.ilim > 1 ? 1.5 : 1.4)).toPrecision(2));
  const en = adj
    ? `Adjustable ${neg ? 'negative' : 'positive'} ${ldo ? 'low-dropout ' : ''}regulator, ${eng(iout, 'A')}: VOUT = ${neg ? '−' : ''}1.25 V·(1 + R2/R1), dropout ${s.vdo} V`
    : `${neg ? '−' : '+'}${s.v} V ${eng(iout, 'A')} ${ldo ? 'low-dropout' : 'fixed linear'} regulator, dropout ${s.vdo} V, IQ ${eng(s.iq, 'A')}`;
  const vi = adj
    ? `Ổn áp điều chỉnh được ${neg ? 'âm' : 'dương'}${ldo ? ' sụt áp thấp (LDO)' : ''}, ${eng(iout, 'A')}: VOUT = ${neg ? '−' : ''}1.25 V·(1 + R2/R1), sụt áp tối thiểu ${s.vdo} V`
    : `Ổn áp ${ldo ? 'sụt áp thấp (LDO)' : 'tuyến tính cố định'} ${neg ? '−' : '+'}${s.v} V ${eng(iout, 'A')}, sụt áp tối thiểu ${s.vdo} V, IQ ${eng(s.iq, 'A')}`;
  const base = regulatorPart({ ...s, description: en });
  return withMeta({ ...base, keywords: [...(base.keywords ?? []), ...(ldo ? ['ldo', 'low dropout'] : [])] }, { vi, specs: { vout: adj ? 1.25 : s.v * (neg ? -1 : 1), iout, dropout: s.vdo, iq: s.iq, package: pkg }, sortKey: (neg ? -1 : 1) * s.v + iout / 100, series: ldo ? 'LDO' : 'Linear regulator' });
});

// ---------------------------------------------------------------------------------------------
// averaged PWM switch and converter modules

/** Averaged PWM switch elements between a, c, p with duty node d (prefix `k` keeps names unique). */
function pwmSwitch(k: string, a: string, c: string, p: string, d: string): ElementIR[] {
  const sense = `V${k}C`;
  return [
    elB(`B${k}V`, `${k}cx`, p, 'V', `limit(V(${d}),0,0.98)*V(${a},${p})`),
    elSense(sense, `${k}cx`, c),
    elB(`B${k}I`, a, p, 'I', `limit(V(${d}),0,0.98)*I(${sense})`),
  ];
}

const DUTY = (def: string): ParamDef => numParam('duty', 'Duty cycle', def, '', { min: 0, max: 0.98, showOnSchematic: true, help: 'Fraction of the switching period the switch is on (used when the D pin is not connected)' });

/** Duty-cycle node of a module: the D pin when connected, else a source with the duty parameter. */
function dutyNode(ctx: ToSpiceContext, els: ElementIR[]): string {
  if (pinConnected(ctx, 'D')) return ctx.node('D');
  const d = internalNode(ctx, 'd');
  const duty = ctx.num('duty');
  if (!(duty >= 0 && duty <= 0.98)) throw new Error('bad value for duty: must be between 0 and 0.98');
  els.push(elV(ctx.name('V', 'duty'), d, '0', { dc: duty }));
  // the D pin still gets a defined (private) node when it is open
  els.push(elR(ctx.name('R', 'dpin'), ctx.node('D'), '0', 1e9));
  return d;
}

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

const MODULE_SYMBOL = (title: string): SymbolDef =>
  boxSymbol({
    w: 80,
    h: 40,
    left: [{ name: 'IN', number: '1', type: 'power' }],
    right: [{ name: 'OUT', number: '2', type: 'power' }],
    top: [{ name: 'D', number: '4', type: 'input' }],
    bottom: [{ name: 'GND', number: '3', type: 'power' }],
    title,
    titleSize: 8,
    titlePos: { x: 0, y: 4 },
  });

type Topology = 'buck' | 'boost' | 'buckboost' | 'cuk';

interface ConverterSpec {
  topo: Topology;
  name: string;
  nameVi: string;
  title: string;
  en: string;
  vi: string;
  duty: string;
}

const CONVERTERS: ConverterSpec[] = [
  { topo: 'buck', name: 'Buck Converter (averaged)', nameVi: 'Bộ biến đổi giảm áp (mô hình trung bình)', title: 'BUCK', en: 'Averaged step-down converter: VOUT ≈ D·VIN in continuous conduction', vi: 'Bộ biến đổi giảm áp mô hình trung bình: VOUT ≈ D·VIN khi dòng cuộn cảm liên tục', duty: '0.5' },
  { topo: 'boost', name: 'Boost Converter (averaged)', nameVi: 'Bộ biến đổi tăng áp (mô hình trung bình)', title: 'BOOST', en: 'Averaged step-up converter: VOUT ≈ VIN / (1 − D) in continuous conduction', vi: 'Bộ biến đổi tăng áp mô hình trung bình: VOUT ≈ VIN / (1 − D) khi dòng cuộn cảm liên tục', duty: '0.5' },
  { topo: 'buckboost', name: 'Buck-Boost Converter (averaged)', nameVi: 'Bộ biến đổi tăng-giảm áp (mô hình trung bình)', title: 'BUCK-BST', en: 'Averaged inverting buck-boost converter: VOUT ≈ −VIN·D / (1 − D)', vi: 'Bộ biến đổi tăng-giảm áp đảo cực mô hình trung bình: VOUT ≈ −VIN·D / (1 − D)', duty: '0.5' },
  { topo: 'cuk', name: 'Cuk Converter (averaged)', nameVi: 'Bộ biến đổi Ćuk (mô hình trung bình)', title: 'CUK', en: 'Averaged Ćuk converter (inverting, continuous input and output current): VOUT ≈ −VIN·D / (1 − D)', vi: 'Bộ biến đổi Ćuk mô hình trung bình (đảo cực, dòng vào và ra liên tục): VOUT ≈ −VIN·D / (1 − D)', duty: '0.5' },
];

function converterParams(topo: Topology, duty: string): ParamDef[] {
  const out: ParamDef[] = [DUTY(duty), numParam('l', 'Inductance', '100u', 'H', { min: 0 }), numParam('rl', 'Inductor resistance', '50m', 'Ω', { min: 0 }), numParam('c', 'Output capacitance', '100u', 'F', { min: 0 })];
  if (topo === 'cuk') out.push(numParam('l2', 'Output inductance', '100u', 'H', { min: 0 }), numParam('c1', 'Coupling capacitance', '10u', 'F', { min: 0 }));
  return out;
}

function converterSpice(topo: Topology) {
  return (ctx: ToSpiceContext) => {
    const els: ElementIR[] = [];
    const d = dutyNode(ctx, els);
    const vin = ctx.node('IN');
    const out = ctx.node('OUT');
    const gnd = ctx.node('GND');
    const x = internalNode(ctx, 'x');
    const xl = internalNode(ctx, 'xl');
    const l = pos(ctx, 'l');
    const rl = Math.max(1e-6, ctx.num('rl'));
    const c = pos(ctx, 'c');
    const sub = subckt(`MS_PWMSW_${topo.toUpperCase()}`, ['a', 'c', 'p', 'd'], pwmSwitch('1', 'a', 'c', 'p', 'd'));
    const sw = (a: string, cc: string, p: string) => elX(ctx.name('X', 'sw'), [a, cc, p, d], sub.name);
    switch (topo) {
      case 'buck':
        els.push(sw(vin, x, gnd), elR(ctx.name('R', 'l'), x, xl, rl), elL(ctx.name('L'), xl, out, l), elC(ctx.name('C'), out, gnd, c));
        break;
      case 'boost':
        els.push(elR(ctx.name('R', 'l'), vin, xl, rl), elL(ctx.name('L'), xl, x, l), sw(gnd, x, out), elC(ctx.name('C'), out, gnd, c));
        break;
      case 'buckboost':
        els.push(sw(vin, x, out), elR(ctx.name('R', 'l'), x, xl, rl), elL(ctx.name('L'), xl, gnd, l), elC(ctx.name('C'), out, gnd, c));
        break;
      case 'cuk': {
        const y = internalNode(ctx, 'y');
        const yl = internalNode(ctx, 'yl');
        els.push(
          elR(ctx.name('R', 'l'), vin, xl, rl),
          elL(ctx.name('L', '1'), xl, x, l),
          elC(ctx.name('C', '1'), x, y, pos(ctx, 'c1')),
          sw(x, gnd, y),
          elL(ctx.name('L', '2'), y, yl, pos(ctx, 'l2')),
          elR(ctx.name('R', 'l2'), yl, out, rl),
          elC(ctx.name('C'), out, gnd, c),
        );
        break;
      }
    }
    return { elements: els, subckts: [sub] };
  };
}

const converters: LibraryPartDef[] = CONVERTERS.map((s) =>
  withMeta(
    {
      id: `power/${s.topo}-converter`,
      name: s.name,
      group: 'power',
      family: 'Averaged converter',
      description: `${s.en}; duty cycle from the D pin (0…1 V) or the parameter`,
      prefix: 'U',
      symbol: MODULE_SYMBOL(s.title),
      params: converterParams(s.topo, s.duty),
      optionalPins: ['D'],
      toSpice: converterSpice(s.topo),
      provenance: "Averaged PWM-switch converter (Vorpérian's CCM model, published theory) with the inductor, winding resistance and capacitors inside the module",
      footprint: 'MODULE-4P',
      keywords: [s.topo, 'converter', 'smps', 'switching', 'averaged', 'dc-dc'],
    },
    { vi: `${s.vi}; hệ số làm việc lấy từ chân D (0…1 V) hoặc từ tham số`, nameVi: s.nameVi, specs: {}, series: 'Averaged converter' },
  ),
);

const pwmSwitchPart: LibraryPartDef = withMeta(
  {
    id: 'power/pwm-switch',
    name: 'PWM Switch (averaged)',
    group: 'power',
    family: 'Averaged converter',
    description: 'Averaged PWM switch for building any converter: V(C,P) = D·V(A,P), I(A) = D·I(C); A = active switch side, P = diode side, C = common node',
    prefix: 'U',
    symbol: boxSymbol({ w: 60, h: 40, left: [{ name: 'A', number: '1' }], right: [{ name: 'P', number: '3' }], bottom: [{ name: 'C', number: '2' }], top: [{ name: 'D', number: '4', type: 'input' }], title: 'PWM', titleSize: 8, titlePos: { x: 0, y: 4 } }),
    params: [DUTY('0.5')],
    optionalPins: ['D'],
    toSpice: (ctx) => {
      const els: ElementIR[] = [];
      const d = dutyNode(ctx, els);
      const sub = subckt('MS_PWMSW', ['a', 'c', 'p', 'd'], pwmSwitch('1', 'a', 'c', 'p', 'd'));
      els.push(elX(ctx.name('X'), [ctx.node('A'), ctx.node('C'), ctx.node('P'), d], sub.name));
      return { elements: els, subckts: [sub] };
    },
    provenance: "Vorpérian's averaged PWM switch model (continuous conduction mode), published theory",
    footprint: 'MODULE-4P',
    keywords: ['pwm switch', 'averaged', 'smps', 'converter'],
  },
  { vi: 'Khoá PWM mô hình trung bình để tự lắp bộ biến đổi: V(C,P) = D·V(A,P), I(A) = D·I(C); A = phía khoá, P = phía diode, C = nút chung', nameVi: 'Khoá PWM (mô hình trung bình)' },
);

// ---------------------------------------------------------------------------------------------
// averaged buck switching regulators: "pn vout(0 = ADJ) vref ilim fsw iq package"

const BUCK_TEXT = [
  'LM2596-3.3 3.3 1.23 3.5 150k 5m TO-263',
  'LM2596-5.0 5 1.23 3.5 150k 5m TO-263',
  'LM2596-12 12 1.23 3.5 150k 5m TO-263',
  'LM2596-ADJ 0 1.23 3.5 150k 5m TO-263',
  'LM2576-5.0 5 1.23 4.2 52k 5m TO-220-5',
  'LM2576-12 12 1.23 4.2 52k 5m TO-220-5',
  'LM2576-ADJ 0 1.23 4.2 52k 5m TO-220-5',
  'LM2575-5.0 5 1.23 1.7 52k 5m TO-220-5',
  'LM2575-ADJ 0 1.23 1.7 52k 5m TO-220-5',
  'XL4015 0 1.25 6 180k 3m TO-263',
  'MP1584 0 0.8 4 1.5M 0.1m SOIC-8',
  'TPS5430 0 1.221 4 500k 3m SOIC-8',
];

const BUCK_SYMBOL = (title: string): SymbolDef =>
  boxSymbol({ w: 80, h: 40, left: [{ name: 'VIN', number: '1', type: 'power' }], right: [{ name: 'SW', number: '2', type: 'output' }, { name: 'FB', number: '4', type: 'input' }], bottom: [{ name: 'GND', number: '3', type: 'power' }], title, titleSize: 7, titlePos: { x: 0, y: 4 } });

function buckSubckt(name: string, vout: number, vref: number, ilim: number, iq: number): SubcktDef {
  const kfb = vout > 0 ? vref / vout : 1;
  const betaNom = vout > 0 ? kfb : vref / 5;
  const ki = (2 * Math.PI * 100) / betaNom;
  return subckt(name, ['vin', 'gnd', 'sw', 'fb'], [
    elB('BI', 'gnd', 'c', 'I', `${ex(ki)}*(${ex(vref)}-V(fb,gnd)*${ex(kfb)})`),
    elC('CI', 'c', 'gnd', 1),
    elR('RI', 'c', 'gnd', 1e9),
    elB('BCL', 'c', 'gnd', 'I', 'max(V(c,gnd)-max(V(vin,gnd),0),0)*10+min(V(c,gnd),0)*10'),
    elB('BSW', 'swi', 'gnd', 'V', `max(min(V(c,gnd),0.95*max(V(vin,gnd),0))-10*max(I(VS)-${ex(ilim)},0),0)`),
    elR('RON', 'swi', 'sx', 0.15),
    elSense('VS', 'sx', 'sw'),
    elB('BIN', 'vin', 'gnd', 'I', `V(swi,gnd)/max(V(vin,gnd),0.1)*I(VS)+${ex(iq)}*limit(V(vin,gnd)/3,0,1)`),
    elR('RFB', 'fb', 'gnd', 1e7),
  ]);
}

const bucks: LibraryPartDef[] = BUCK_TEXT.map((t) => {
  const [pn, voS, vrS, ilS, fsS, iqS, pkg] = t.split(/\s+/);
  const vout = Number(voS);
  const vref = Number(vrS);
  const ilim = Number(ilS);
  const fsw = Number(fsS.replace(/k$/, 'e3').replace(/M$/, 'e6'));
  const iq = num(iqS, pn);
  const sub = buckSubckt(modelName(pn), vout, vref, ilim, iq);
  const fixed = vout > 0;
  return withMeta(
    {
      id: `power/${pn.toLowerCase()}`,
      name: pn,
      group: 'power',
      family: 'Switching regulator',
      description: `${fixed ? `${vout} V` : `Adjustable (VFB = ${vref} V)`} step-down switching regulator, ${eng(ilim / 1.2, 'A')}, ${eng(fsw, 'Hz')} (averaged model): add the inductor from SW to the output, a Schottky catch diode from GND to SW and the output capacitor; connect FB to ${fixed ? 'the output' : 'a divider: VOUT = VFB·(1 + R2/R1)'}`,
      prefix: 'U',
      symbol: BUCK_SYMBOL(pn.replace(/-.*$/, '')),
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('VIN'), ctx.node('GND'), ctx.node('SW'), ctx.node('FB')], sub.name)], subckts: [sub] }),
      provenance: `MachSim averaged buck regulator from the ${pn} datasheet: ${fixed ? `VOUT ${vout} V` : `VFB ${vref} V`}, switch current limit ≈ ${ilim} A, ${eng(fsw, 'Hz')} switching (averaged, no ripple), integrating error amplifier with ≈ 100 Hz loop crossover`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'buck', 'step-down', 'switching regulator', 'smps', 'dc-dc'],
    },
    {
      vi: `IC ổn áp xung giảm áp ${fixed ? `${vout} V` : `điều chỉnh được (VFB = ${vref} V)`}, ${eng(ilim / 1.2, 'A')}, ${eng(fsw, 'Hz')} (mô hình trung bình): nối cuộn cảm từ SW tới ngõ ra, diode Schottky từ GND lên SW và tụ ngõ ra; nối FB vào ${fixed ? 'ngõ ra' : 'cầu phân áp: VOUT = VFB·(1 + R2/R1)'}`,
      specs: { vout: fixed ? vout : vref, iout: Number((ilim / 1.2).toPrecision(2)), freq: fsw, package: pkg },
      sortKey: vout || 100 + vref,
      series: 'Buck regulator',
    },
  );
});

// ---------------------------------------------------------------------------------------------
// PWM generator, PI / PID, phase-angle controller

const pwmParams: ParamDef[] = [
  numParam('freq', 'Switching frequency', '10k', 'Hz', { min: 0, showOnSchematic: true }),
  numParam('vramp', 'Ramp peak voltage', '5', 'V', { min: 0, help: 'VC = 0 gives 0 % duty, VC = ramp peak gives 100 %' }),
  numParam('vhigh', 'Output high voltage', '5', 'V', { min: 0 }),
];

const pwmController: LibraryPartDef = withMeta(
  {
    id: 'power/pwm-controller',
    name: 'PWM Controller',
    group: 'power',
    family: 'Controllers',
    description: 'Voltage-mode PWM generator: OUT is high while V(VC) is above an internal sawtooth (duty = VC / ramp peak); OUTN is the complement',
    prefix: 'U',
    symbol: boxSymbol({ w: 80, h: 40, left: [{ name: 'VC', number: '1', type: 'input' }], right: [{ name: 'OUT', number: '2', type: 'output' }, { name: 'OUTN', number: '3', type: 'output' }], bottom: [{ name: 'GND', number: '4', type: 'power' }], title: 'PWM', titleSize: 9, titlePos: { x: 0, y: 4 } }),
    params: pwmParams,
    optionalPins: ['OUTN'],
    toSpice: (ctx) => {
      const f = pos(ctx, 'freq');
      const vr = pos(ctx, 'vramp');
      const vh = ctx.num('vhigh');
      const per = 1 / f;
      const ramp = internalNode(ctx, 'ramp');
      const g = ctx.node('GND');
      return {
        elements: [
          elV(ctx.name('V', 'ramp'), ramp, g, { dc: 0, tran: wPulse(0, vr, 0, per * 0.98, per * 0.02, 0, per) }),
          elB(ctx.name('B', 'o'), internalNode(ctx, 'o'), g, 'V', `${ex(vh)}*(0.5+0.5*tanh(200*(V(${ctx.node('VC')},${ramp}))/${ex(vr)}))`),
          elR(ctx.name('R', 'o'), internalNode(ctx, 'o'), ctx.node('OUT'), 10),
          elB(ctx.name('B', 'n'), internalNode(ctx, 'n'), g, 'V', `${ex(vh)}-V(${internalNode(ctx, 'o')},${g})`),
          elR(ctx.name('R', 'n'), internalNode(ctx, 'n'), ctx.node('OUTN'), 10),
        ],
      };
    },
    provenance: 'MachSim behavioural PWM modulator (sawtooth comparator, 10 Ω outputs)',
    footprint: 'DIP-8',
    keywords: ['pwm', 'controller', 'modulator', 'duty cycle', 'smps'],
  },
  { vi: 'Bộ tạo PWM điều khiển theo điện áp: OUT ở mức cao khi V(VC) lớn hơn sóng răng cưa bên trong (hệ số làm việc = VC / đỉnh răng cưa); OUTN là tín hiệu đảo', nameVi: 'Bộ điều khiển PWM' },
);

function pidParams(withD: boolean): ParamDef[] {
  const out: ParamDef[] = [
    numParam('kp', 'Proportional gain Kp', '1', '', { showOnSchematic: true }),
    numParam('ki', 'Integral gain Ki', '10', '1/s', {}),
  ];
  if (withD) out.push(numParam('kd', 'Derivative gain Kd', '1m', 's', {}), numParam('tf', 'Derivative filter time', '100u', 's', { min: 0 }));
  out.push(numParam('omin', 'Output minimum', '-10', 'V', {}), numParam('omax', 'Output maximum', '10', 'V', {}));
  return out;
}

function pidSpice(withD: boolean) {
  return (ctx: ToSpiceContext) => {
    const kp = ctx.num('kp');
    const ki = ctx.num('ki');
    const omin = ctx.num('omin');
    const omax = ctx.num('omax');
    if (!(omax > omin)) throw new Error('bad value for omax: must be above the output minimum');
    const e = internalNode(ctx, 'e');
    const i = internalNode(ctx, 'i');
    const o = internalNode(ctx, 'o');
    const els: ElementIR[] = [
      elB(ctx.name('B', 'e'), e, '0', 'V', `V(${ctx.node('SP')})-V(${ctx.node('PV')})`),
      elB(ctx.name('B', 'i'), '0', i, 'I', `${ex(ki)}*V(${e})`),
      elC(ctx.name('C', 'i'), i, '0', 1),
      elR(ctx.name('R', 'i'), i, '0', 1e9),
      elB(ctx.name('B', 'w'), i, '0', 'I', `max(V(${i})-${ex(omax)},0)*1000+min(V(${i})-${ex(omin)},0)*1000`),
    ];
    let dTerm = '0';
    if (withD) {
      const kd = ctx.num('kd');
      const tf = pos(ctx, 'tf');
      const y = internalNode(ctx, 'y');
      els.push(elR(ctx.name('R', 'y'), e, y, 1), elC(ctx.name('C', 'y'), y, '0', tf));
      dTerm = `${ex(kd / tf)}*V(${e},${y})`;
    }
    els.push(elB(ctx.name('B', 'o'), o, '0', 'V', `limit(${ex(kp)}*V(${e})+V(${i})+${dTerm},${ex(omin)},${ex(omax)})`), elR(ctx.name('R', 'o'), o, ctx.node('OUT'), 1));
    return { elements: els };
  };
}

const PID_SYMBOL = (title: string): SymbolDef => boxSymbol({ w: 60, h: 40, left: [{ name: 'SP', number: '1', type: 'input' }, { name: 'PV', number: '2', type: 'input' }], right: [{ name: 'OUT', number: '3', type: 'output' }], title, titleSize: 9 });

const piController: LibraryPartDef = withMeta(
  {
    id: 'analog/pi-controller',
    name: 'PI Controller',
    group: 'analog',
    family: 'Control functions',
    description: 'PI controller: OUT = Kp·e + Ki·∫e dt with e = V(SP) − V(PV), limited to [min, max] with anti-windup',
    prefix: 'U',
    symbol: PID_SYMBOL('PI'),
    params: pidParams(false),
    toSpice: pidSpice(false),
    provenance: 'Textbook PI control law (behavioural integrator with clamped anti-windup)',
    footprint: 'BLOCK',
    keywords: ['pi', 'controller', 'control loop', 'regulator', 'integral'],
    virtual: true,
  },
  { vi: 'Bộ điều khiển PI: OUT = Kp·e + Ki·∫e dt với e = V(SP) − V(PV), giới hạn trong [min, max], có chống bão hoà tích phân', nameVi: 'Bộ điều khiển PI' },
);

const pidController: LibraryPartDef = withMeta(
  {
    id: 'analog/pid-controller',
    name: 'PID Controller',
    group: 'analog',
    family: 'Control functions',
    description: 'PID controller: OUT = Kp·e + Ki·∫e dt + Kd·de/dt (derivative filtered by Tf), e = V(SP) − V(PV), limited to [min, max]',
    prefix: 'U',
    symbol: PID_SYMBOL('PID'),
    params: pidParams(true),
    toSpice: pidSpice(true),
    provenance: 'Textbook PID control law with first-order filtered derivative (behavioural)',
    footprint: 'BLOCK',
    keywords: ['pid', 'controller', 'control loop', 'derivative', 'integral'],
    virtual: true,
  },
  { vi: 'Bộ điều khiển PID: OUT = Kp·e + Ki·∫e dt + Kd·de/dt (khâu vi phân có lọc Tf), e = V(SP) − V(PV), giới hạn trong [min, max]', nameVi: 'Bộ điều khiển PID' },
);

const phaseParams: ParamDef[] = [
  numParam('freq', 'Line frequency', '50', 'Hz', { min: 1, showOnSchematic: true }),
  numParam('width', 'Pulse width', '10', '°', { min: 1, max: 90 }),
  numParam('vgate', 'Gate pulse voltage', '5', 'V', { min: 0 }),
  numParam('rgate', 'Gate output resistance', '100', 'Ω', { min: 1 }),
];

const phaseController: LibraryPartDef = withMeta(
  {
    id: 'power/phase-angle-controller',
    name: 'Phase-Angle Controller',
    group: 'power',
    family: 'Controllers',
    description: 'Firing-angle controller for TRIAC / SCR phase control: synchronised to V(L,N), fires a gate pulse (G referred to K) at α = 180°·(1 − V(VC)/10 V) in every half wave',
    prefix: 'U',
    symbol: boxSymbol({
      w: 80,
      h: 60,
      left: [{ name: 'L', number: '1' }, { name: 'N', number: '2' }, { name: 'VC', number: '3', type: 'input' }],
      right: [{ name: 'G', number: '4', type: 'output' }, { name: 'K', number: '5' }],
      title: 'α',
      titleSize: 12,
      extra: [line(-20, 16, -8, 16), text(10, 20, '0–10 V', 6)],
    }),
    params: phaseParams,
    toSpice: (ctx) => {
      const f = pos(ctx, 'freq');
      const w = pos(ctx, 'width');
      const vg = ctx.num('vgate');
      const rg = pos(ctx, 'rgate');
      const L = ctx.node('L');
      const N = ctx.node('N');
      const K = ctx.node('K');
      const u = internalNode(ctx, 'u');
      const rp = internalNode(ctx, 'rp');
      const rn = internalNode(ctx, 'rn');
      const a = internalNode(ctx, 'a');
      const g = internalNode(ctx, 'g');
      const deg = ex(360 * f);
      const win = (x: string) => `(0.5*(tanh(2*(V(${x})-V(${a})))-tanh(2*(V(${x})-V(${a})-${ex(w)}))))`;
      return {
        elements: [
          elB(ctx.name('B', 'u'), u, '0', 'V', `0.5+0.5*tanh(50*V(${L},${N}))`),
          elB(ctx.name('B', 'rp'), '0', rp, 'I', `${deg}*V(${u})*u(time)-1e4*V(${rp})*(1-V(${u}))`),
          elC(ctx.name('C', 'rp'), rp, '0', 1),
          elR(ctx.name('R', 'rp'), rp, '0', 1e9),
          elB(ctx.name('B', 'rn'), '0', rn, 'I', `${deg}*(1-V(${u}))*u(time)-1e4*V(${rn})*V(${u})`),
          elC(ctx.name('C', 'rn'), rn, '0', 1),
          elR(ctx.name('R', 'rn'), rn, '0', 1e9),
          elB(ctx.name('B', 'a'), a, '0', 'V', `limit(180*(1-V(${ctx.node('VC')},${N})/10),5,175)`),
          elB(ctx.name('B', 'g'), g, K, 'V', `${ex(vg)}*(V(${u})*${win(rp)}+(1-V(${u}))*${win(rn)})`),
          elR(ctx.name('R', 'g'), g, ctx.node('G'), rg),
        ],
      };
    },
    provenance: 'MachSim behavioural firing-angle controller (zero-crossing synchronised ramps, published phase-control theory)',
    footprint: 'MODULE-5P',
    keywords: ['phase angle', 'firing angle', 'phase control', 'dimmer', 'triac', 'scr', 'thyristor'],
    virtual: true,
  },
  { vi: 'Bộ điều khiển góc kích cho điều khiển pha TRIAC / SCR: đồng bộ theo V(L,N), phát xung cổng (G so với K) tại α = 180°·(1 − V(VC)/10 V) trong mỗi nửa chu kỳ', nameVi: 'Bộ điều khiển góc pha' },
);

export const POWER_CATALOG: LibraryPartDef[] = [...regulators, ...bucks, ...converters, pwmSwitchPart, pwmController, piController, pidController, phaseController];
