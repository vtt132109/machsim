/**
 * Electromechanical catalogue: relays by coil voltage and contact form, reed and solid-state
 * relays, three-pole contactors, timed contacts (on-delay, off-delay, interval), sensing switches
 * (pressure, temperature, level, flow, limit), miniature circuit breakers, motors (DC catalogue
 * motors, three-phase induction, BLDC, bipolar stepper) and fuses (group Power › Fuse).
 *
 * Models (MachSim behavioural, from published machine / device equations):
 *   relay / contactor  coil R–L; the coil current (rectified and averaged over 5 ms, so AC coils
 *              do not chatter) drives ideal switches with hysteresis: pull-in at 75 % and drop-out
 *              at 10 % of the nominal coil current. Contacts are SW models (RON 50 mΩ, ROFF 1 GΩ).
 *   timed      an internal timer node ramps from 0 to 1 in the delay time while the coil is
 *              energised (on-delay) or after it is released (off-delay); the contact switches at 1.
 *   sensing    contact state from the interactive process value against the set point (keyboard
 *              operated during simulation), constant topology (RON / ROFF resistor).
 *   breaker    thermal element (I² / In² averaged over τ = 10 s, trips at 1.3·In sustained) plus a
 *              magnetic trip at k·In (B: 4, C: 7.5, D: 15); latches open until the simulation
 *              restarts; also a manual toggle.
 *   fuse       I² / In² averaged over τ (fast F: 20 ms, time-lag T: 1 s, blade: 200 ms); melts at
 *              1.5·In sustained (sooner for larger overloads) and stays open.
 *   induction  approximate per-phase equivalent circuit (Rs, Lls + Llr, Lm ∥ Rr / s) with the slip
 *              computed from the rotor speed: T = Σ V(air gap)²·s / (Rr·ωs), J·dω/dt = T − B·ω − TL.
 *   BLDC       three wye-connected phases R–L–e with trapezoidal back-EMF e = Ke·ω·f(θe),
 *              T = Ke·Σ f·i, Hall outputs H1…H3 from the rotor angle.
 *   stepper    two-phase hybrid stepper: eA = −Km·ω·sin(Nr·θ), eB = Km·ω·cos(Nr·θ), torque
 *              −Km·iA·sin(Nr·θ) + Km·iB·cos(Nr·θ) − Td·sin(4·Nr·θ); 1.8° per full step (Nr = 50).
 * Speeds are V(<ref>.w) in rad/s and angles V(<ref>.deg) in degrees. AC machines (induction,
 * BLDC, stepper) stand still at the operating point (torque and angle integrate from t = 0).

 */
import type { ElementIR, ModelCard } from '../../sim/netlist';
import { dcMotor } from '../parts/misc';
import { boolOf, boolParam, card, elB, elC, elE, elI, elL, elR, elS, elSense, ex, internalNode, internalNodeName, keyParam, numParam, selectParam, stepParam, swModel, textOf, type LibraryPartDef } from '../partkit';
import { boxSymbol, circle, line, rect, text, twoPinH } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';
import { eng, withMeta } from './kit';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// coil + contacts

interface CoilOut {
  els: ElementIR[];
  /** node holding the averaged |coil current| / nominal current (1.0 = rated) */
  level: string;
}

/** Coil R–L between a and b with a sense source; `level` = averaged |I| / Inom. */
function coil(ctx: ToSpiceContext, a: string, b: string, r: number, l: number, inom: number): CoilOut {
  const m1 = internalNode(ctx, 'c1');
  const m2 = internalNode(ctx, 'c2');
  const raw = internalNode(ctx, 'craw');
  const level = internalNode(ctx, 'clev');
  const sense = ctx.name('V', 'coil');
  return {
    els: [
      elR(ctx.name('R', 'coil'), a, m1, r),
      elL(ctx.name('L', 'coil'), m1, m2, l),
      elSense(sense, m2, b),
      elB(ctx.name('B', 'craw'), raw, '0', 'V', `abs(I(${sense}))/${ex(inom)}`),
      elR(ctx.name('R', 'clev'), raw, level, 1000),
      elC(ctx.name('C', 'clev'), level, '0', 5e-3 / 1000),
    ],
    level,
  };
}

const CONTACT_MODEL_NO = (tag: string): ModelCard => swModel(`MS_CONTACT_${tag}_NO`, 0.425, 0.325, 0.05, 1e9);
const CONTACT_MODEL_NC = (tag: string): ModelCard => swModel(`MS_CONTACT_${tag}_NC`, -0.425, 0.325, 0.05, 1e9);

/** NO / NC contact pair driven by a level node (pull-in 0.75, drop-out 0.1). */
function contacts(ctx: ToSpiceContext, level: string, set: { com: string; no?: string; nc?: string; tag: string }[], models: ModelCard[]): ElementIR[] {
  const out: ElementIR[] = [];
  const no = CONTACT_MODEL_NO('RELAY');
  const nc = CONTACT_MODEL_NC('RELAY');
  if (!models.some((m) => m.name === no.name)) models.push(no, nc);
  for (const c of set) {
    if (c.no) out.push(elS(ctx.name('S', `no${c.tag}`), ctx.node(c.com), ctx.node(c.no), level, '0', no.name));
    if (c.nc) out.push({ ...elS(ctx.name('S', `nc${c.tag}`), ctx.node(c.com), ctx.node(c.nc), '0', level, nc.name), params: { on: 1 } });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// relays

type Form = 'SPDT' | 'DPDT';

const RELAY_SYMBOL: Record<Form, SymbolDef> = {
  SPDT: boxSymbol({ w: 80, h: 60, left: [{ name: 'C1', number: '1' }, { name: 'C2', number: '2' }], right: [{ name: 'COM', number: '3' }, { name: 'NO', number: '4' }, { name: 'NC', number: '5' }], title: 'K', extra: [rect(-30, -10, 16, 20)] }),
  DPDT: boxSymbol({
    w: 80,
    h: 120,
    left: [{ name: 'C1', number: '1' }, { name: 'C2', number: '2' }],
    right: [{ name: 'COM1', number: '3' }, { name: 'NO1', number: '4' }, { name: 'NC1', number: '5' }, { name: 'COM2', number: '6' }, { name: 'NO2', number: '7' }, { name: 'NC2', number: '8' }],
    title: 'K',
    extra: [rect(-30, -10, 16, 20)],
  }),
};

interface RelaySpec {
  id: string;
  name: string;
  nameVi: string;
  vcoil: number;
  rcoil: number;
  form: Form;
  rating: number;
  en: string;
  vi: string;
  keywords: string[];
}

function relayPart(s: RelaySpec): LibraryPartDef {
  const params: ParamDef[] = [numParam('rcoil', 'Coil resistance', String(s.rcoil), 'Ω', { min: 0 }), numParam('vcoil', 'Nominal coil voltage', String(s.vcoil), 'V', { min: 0, showOnSchematic: true })];
  return withMeta(
    {
      id: s.id,
      name: s.name,
      group: 'electromechanical',
      family: 'Relay',
      description: s.en,
      prefix: 'K',
      symbol: RELAY_SYMBOL[s.form],
      params,
      optionalPins: s.form === 'SPDT' ? ['NO', 'NC'] : ['NO1', 'NC1', 'NO2', 'NC2', 'COM2'],
      toSpice: (ctx) => {
        const r = pos(ctx, 'rcoil');
        const v = pos(ctx, 'vcoil');
        const c = coil(ctx, ctx.node('C1'), ctx.node('C2'), r, 0.005 * r, v / r);
        const models: ModelCard[] = [];
        const set = s.form === 'SPDT' ? [{ com: 'COM', no: 'NO', nc: 'NC', tag: '' }] : [{ com: 'COM1', no: 'NO1', nc: 'NC1', tag: '1' }, { com: 'COM2', no: 'NO2', nc: 'NC2', tag: '2' }];
        return { elements: [...c.els, ...contacts(ctx, c.level, set, models)], models };
      },
      provenance: `MachSim relay: ${s.vcoil} V coil of ${eng(s.rcoil, 'Ω')} (L/R = 5 ms), pull-in at 75 % and drop-out at 10 % of the nominal coil current; contacts rated ${s.rating} A`,
      footprint: s.form === 'SPDT' ? 'RELAY-5P' : 'RELAY-8P',
      keywords: ['relay', s.form.toLowerCase(), 'coil', ...s.keywords],
    },
    { vi: s.vi, nameVi: s.nameVi, specs: { coil: s.vcoil, contacts: s.form, irating: s.rating }, sortKey: s.vcoil + (s.form === 'DPDT' ? 0.5 : 0), series: 'Relay' },
  );
}

const relays: LibraryPartDef[] = [
  ...[3, 5, 6, 9, 12, 24, 48].flatMap((v) =>
    (['SPDT', 'DPDT'] as Form[]).map((form) => {
      const p = form === 'SPDT' ? 0.36 : 0.2;
      const rcoil = Number(((v * v) / p).toPrecision(2));
      const rating = form === 'SPDT' ? 10 : 2;
      return relayPart({
        id: `electromechanical/relay-${v}v-${form.toLowerCase()}`,
        name: `Relay ${v} V ${form} ${rating} A`,
        nameVi: `Rơ-le ${v} V ${form} ${rating} A`,
        vcoil: v,
        rcoil,
        form,
        rating,
        en: `${form === 'SPDT' ? 'Power' : 'Signal'} relay, ${v} V DC coil (${eng(rcoil, 'Ω')}), ${form === 'SPDT' ? 'one changeover contact' : 'two changeover contacts'} rated ${rating} A`,
        vi: `Rơ-le ${form === 'SPDT' ? 'công suất' : 'tín hiệu'}, cuộn hút ${v} V DC (${eng(rcoil, 'Ω')}), ${form === 'SPDT' ? 'một tiếp điểm chuyển mạch' : 'hai tiếp điểm chuyển mạch'} ${rating} A`,
        keywords: [`${v}v`, form === 'SPDT' ? 'power relay' : 'signal relay'],
      });
    }),
  ),
];

const reedRelays: LibraryPartDef[] = [5, 12].map((v) => {
  const rcoil = v === 5 ? 500 : 1000;
  return withMeta(
    {
      id: `electromechanical/reed-relay-${v}v`,
      name: `Reed Relay ${v} V`,
      group: 'electromechanical',
      family: 'Relay',
      description: `Reed relay, ${v} V coil (${rcoil} Ω), one normally-open reed contact rated 0.5 A, operate time ≈ 0.5 ms`,
      prefix: 'K',
      symbol: boxSymbol({ w: 80, h: 40, left: [{ name: 'C1', number: '1' }, { name: 'C2', number: '2' }], right: [{ name: 'COM', number: '3' }, { name: 'NO', number: '4' }], title: 'K', extra: [rect(-30, -10, 16, 20)] }),
      params: [],
      toSpice: (ctx) => {
        const r = rcoil;
        const c = coil(ctx, ctx.node('C1'), ctx.node('C2'), r, 0.0005 * r, v / r);
        const models: ModelCard[] = [];
        return { elements: [...c.els, ...contacts(ctx, c.level, [{ com: 'COM', no: 'NO', tag: '' }], models)], models };
      },
      provenance: `MachSim reed relay: ${v} V / ${rcoil} Ω coil, pull-in at 75 % of the nominal coil current`,
      footprint: 'DIP-4',
      keywords: ['reed relay', 'relay', `${v}v`],
    },
    { vi: `Rơ-le lưỡi gà, cuộn ${v} V (${rcoil} Ω), một tiếp điểm thường hở 0.5 A, thời gian đóng ≈ 0.5 ms`, nameVi: `Rơ-le lưỡi gà ${v} V`, specs: { coil: v, contacts: 'SPST-NO', irating: 0.5 }, sortKey: 100 + v, series: 'Reed relay' },
  );
});

const ssrs: LibraryPartDef[] = (['dc', 'ac'] as const).map((kind) =>
  withMeta(
    {
      id: `electromechanical/ssr-${kind}`,
      name: kind === 'dc' ? 'Solid-State Relay (DC output)' : 'Solid-State Relay (AC output)',
      group: 'electromechanical',
      family: 'Relay',
      description: `Solid-state relay: input 3–32 V DC (LED + 1 kΩ), output switch closes above 2 mA input current${kind === 'ac' ? ' (bidirectional, for AC loads)' : ' (for DC loads, + to −)'}; no contact bounce`,
      prefix: 'K',
      symbol: boxSymbol({ w: 80, h: 40, left: [{ name: 'IN+', number: '3' }, { name: 'IN-', number: '4' }], right: [{ name: 'OUT1', number: '1' }, { name: 'OUT2', number: '2' }], title: 'SSR', titleSize: 9 }),
      params: [],
      toSpice: (ctx) => {
        const led = card('MS_SSR_LED', 'D', { is: 1e-20, n: 1.6, rs: 5 });
        const a = internalNode(ctx, 'a');
        const k = internalNode(ctx, 'k');
        const ctl = internalNode(ctx, 'ctl');
        const sense = ctx.name('V', 'in');
        const sw = swModel(`MS_SSR_${kind.toUpperCase()}`, 2e-3, 0.5e-3, kind === 'ac' ? 0.1 : 0.05, 1e8);
        return {
          elements: [
            elR(ctx.name('R', 'in'), ctx.node('IN+'), a, 1000),
            elD_(ctx.name('D', 'led'), a, k, led.name),
            elSense(sense, k, ctx.node('IN-')),
            elB(ctx.name('B', 'ctl'), ctl, '0', 'V', `I(${sense})`),
            elS(ctx.name('S', 'out'), ctx.node('OUT1'), ctx.node('OUT2'), ctl, '0', sw.name),
          ],
          models: [led, sw],
        };
      },
      provenance: 'MachSim solid-state relay: LED input with 1 kΩ, ideal output switch with 2 mA turn-on threshold',
      footprint: 'SSR-4P',
      keywords: ['ssr', 'solid state relay', 'optically isolated', kind === 'ac' ? 'ac load' : 'dc load'],
    },
    {
      vi: `Rơ-le bán dẫn: ngõ vào 3–32 V DC (LED + 1 kΩ), khoá ngõ ra đóng khi dòng vào trên 2 mA${kind === 'ac' ? ' (hai chiều, cho tải xoay chiều)' : ' (cho tải một chiều, + về −)'}; không dội tiếp điểm`,
      nameVi: kind === 'dc' ? 'Rơ-le bán dẫn (ra DC)' : 'Rơ-le bán dẫn (ra AC)',
      specs: { contacts: 'SPST-NO', input: '3-32 V DC' },
      sortKey: 200,
      series: 'SSR',
    },
  ),
);

function elD_(name: string, a: string, k: string, model: string): ElementIR {
  return { type: 'D', name, nodes: [a, k], model, params: {} };
}

// ---------------------------------------------------------------------------------------------
// contactors

const CONTACTOR_SYMBOL: SymbolDef = boxSymbol({
  w: 100,
  h: 80,
  left: [{ name: 'A1', number: 'A1' }, { name: 'L1', number: '1' }, { name: 'L2', number: '3' }, { name: 'L3', number: '5' }],
  right: [{ name: 'A2', number: 'A2' }, { name: 'T1', number: '2' }, { name: 'T2', number: '4' }, { name: 'T3', number: '6' }],
  top: [{ name: '13', number: '13' }],
  bottom: [{ name: '14', number: '14' }],
  title: 'KM',
  titleSize: 9,
  titlePos: { x: 0, y: -24 },
});

const CONTACTORS: [amps: number, coil: string, v: number, ac: boolean][] = [
  [9, '24 V DC', 24, false],
  [9, '24 V AC', 24, true],
  [9, '230 V AC', 230, true],
  [18, '24 V DC', 24, false],
  [18, '24 V AC', 24, true],
  [18, '230 V AC', 230, true],
];

const contactors: LibraryPartDef[] = CONTACTORS.map(([amps, label, v, ac]) => {
  const va = amps > 10 ? 9 : 7;
  const z = (v * v) / va;
  const r = ac ? 0.3 * z : z;
  const l = ac ? (0.95 * z) / (2 * Math.PI * 50) : 0.02 * r;
  const inom = ac ? (v / z) * 0.9 : v / r;
  return withMeta(
    {
      id: `electromechanical/contactor-${amps}a-${label.replace(/\s+/g, '').toLowerCase()}`,
      name: `Contactor 3P ${amps} A (${label} coil)`,
      group: 'electromechanical',
      family: 'Contactor',
      description: `Three-pole contactor, ${amps} A (AC-3) main contacts L1-T1, L2-T2, L3-T3 and an auxiliary NO contact 13-14, ${label} coil A1-A2`,
      prefix: 'K',
      symbol: CONTACTOR_SYMBOL,
      params: [],
      optionalPins: ['L1', 'L2', 'L3', 'T1', 'T2', 'T3', '13', '14'],
      toSpice: (ctx) => {
        const c = coil(ctx, ctx.node('A1'), ctx.node('A2'), r, l, inom);
        const models: ModelCard[] = [];
        const set = [
          { com: 'L1', no: 'T1', tag: '1' },
          { com: 'L2', no: 'T2', tag: '2' },
          { com: 'L3', no: 'T3', tag: '3' },
          { com: '13', no: '14', tag: 'a' },
        ];
        return { elements: [...c.els, ...contacts(ctx, c.level, set, models)], models };
      },
      provenance: `MachSim contactor: ${label} coil of ≈ ${va} VA (${ac ? 'R–L impedance at 50 Hz, averaged rectified current' : 'resistive DC coil'}), pull-in at 75 % / drop-out at 10 % of the nominal coil current`,
      footprint: 'DIN-RAIL',
      keywords: ['contactor', 'motor starter', '3 pole', ac ? 'ac coil' : 'dc coil'],
    },
    {
      vi: `Công-tắc-tơ ba cực, tiếp điểm chính ${amps} A (AC-3) L1-T1, L2-T2, L3-T3 và tiếp điểm phụ thường hở 13-14, cuộn hút ${label} A1-A2`,
      nameVi: `Công-tắc-tơ 3 cực ${amps} A (cuộn ${label})`,
      specs: { irating: amps, coil: v, contacts: '3NO+1NO' },
      sortKey: amps * 1000 + v,
      series: 'Contactor',
    },
  );
});

// ---------------------------------------------------------------------------------------------
// timed contacts (timer relays)

type TimerKind = 'on-delay' | 'off-delay' | 'interval';

const TIMER_SYMBOL: SymbolDef = boxSymbol({ w: 80, h: 60, left: [{ name: 'A1', number: 'A1' }, { name: 'A2', number: 'A2' }], right: [{ name: 'COM', number: '15' }, { name: 'NO', number: '18' }, { name: 'NC', number: '16' }], title: 'KT', extra: [circle(-14, 18, 5), line(-14, 18, -14, 14), line(-14, 18, -11, 18)] });

const TIMER_TEXT: Record<TimerKind, { en: string; vi: string; name: string; nameVi: string }> = {
  'on-delay': { en: 'On-delay timer relay: the contact changes over the set delay after the coil is energised and returns at once when it is released', vi: 'Rơ-le thời gian trễ đóng: tiếp điểm chuyển trạng thái sau thời gian trễ kể từ khi cấp điện cho cuộn hút và trở lại ngay khi mất điện', name: 'Timer Relay On-Delay', nameVi: 'Rơ-le thời gian trễ đóng' },
  'off-delay': { en: 'Off-delay timer relay: the contact changes over at once when the coil is energised and returns the set delay after it is released', vi: 'Rơ-le thời gian trễ mở: tiếp điểm chuyển ngay khi cấp điện và trở lại sau thời gian trễ kể từ khi mất điện', name: 'Timer Relay Off-Delay', nameVi: 'Rơ-le thời gian trễ mở' },
  interval: { en: 'Interval timer relay: the contact changes over when the coil is energised and returns after the set time even if the coil stays energised', vi: 'Rơ-le thời gian khoảng: tiếp điểm chuyển khi cấp điện và tự trở lại sau thời gian đặt dù cuộn hút vẫn có điện', name: 'Timer Relay Interval', nameVi: 'Rơ-le thời gian khoảng' },
};

const timerRelays: LibraryPartDef[] = (['on-delay', 'off-delay', 'interval'] as TimerKind[]).map((kind) =>
  withMeta(
    {
      id: `electromechanical/timer-${kind}`,
      name: TIMER_TEXT[kind].name,
      group: 'electromechanical',
      family: 'Timed contact',
      description: TIMER_TEXT[kind].en,
      prefix: 'K',
      symbol: TIMER_SYMBOL,
      params: [numParam('delay', 'Delay time', '1', 's', { min: 0, showOnSchematic: true }), numParam('vcoil', 'Nominal coil voltage', '24', 'V', { min: 0 }), numParam('rcoil', 'Coil resistance', '1k', 'Ω', { min: 0 })],
      optionalPins: ['NO', 'NC'],
      toSpice: (ctx) => {
        const delay = pos(ctx, 'delay');
        const r = pos(ctx, 'rcoil');
        const c = coil(ctx, ctx.node('A1'), ctx.node('A2'), r, 0.005 * r, pos(ctx, 'vcoil') / r);
        const e = internalNode(ctx, 'e');
        const tn = internalNode(ctx, 't');
        const st = internalNode(ctx, 's');
        const k = ex(1 / delay);
        const fast = ex(1000 / delay);
        // energised state e in [0, 1] (pull-in 0.75), timer node t in [0, 1.05]
        let dt: string;
        let state: string;
        if (kind === 'on-delay') {
          dt = `V(${e})*${k}-(1-V(${e}))*V(${tn})*${fast}`;
          state = `V(${e})*0.5*(1+tanh(200*(V(${tn})-1)))`;
        } else if (kind === 'off-delay') {
          dt = `V(${e})*(1.02-V(${tn}))*${fast}-(1-V(${e}))*${k}`;
          state = `0.5*(1+tanh(200*(V(${tn})-0.02)))`;
        } else {
          dt = `V(${e})*${k}-(1-V(${e}))*V(${tn})*${fast}`;
          state = `V(${e})*0.5*(1-tanh(200*(V(${tn})-1)))`;
        }
        const models: ModelCard[] = [];
        const els: ElementIR[] = [
          ...c.els,
          elB(ctx.name('B', 'e'), e, '0', 'V', `0.5+0.5*tanh(20*(V(${c.level})-0.6))`),
          elB(ctx.name('B', 't'), '0', tn, 'I', `${dt}+max(-V(${tn}),0)*1000-max(V(${tn})-1.05,0)*1000`),
          elC(ctx.name('C', 't'), tn, '0', 1),
          elR(ctx.name('R', 't'), tn, '0', 1e9),
          elB(ctx.name('B', 's'), st, '0', 'V', state),
        ];
        els.push(...contacts(ctx, st, [{ com: 'COM', no: 'NO', nc: 'NC', tag: '' }], models));
        return { elements: els, models };
      },
      provenance: 'MachSim timer relay: behavioural timer node (linear ramp over the delay time) driving SW contacts',
      footprint: 'DIN-RAIL',
      keywords: ['timer relay', 'time delay', kind, 'timed contact', 'plc'],
    },
    { vi: TIMER_TEXT[kind].vi, nameVi: TIMER_TEXT[kind].nameVi, specs: { coil: 24 } },
  ),
);

// ---------------------------------------------------------------------------------------------
// sensing switches

interface SenseSpec {
  slug: string;
  name: string;
  nameVi: string;
  en: string;
  vi: string;
  label: string;
  unit: string;
  def: string;
  set: string;
  max: number;
  key: string;
  glyph: string;
}

const SENSES: SenseSpec[] = [
  { slug: 'pressure', name: 'Pressure Switch', nameVi: 'Công tắc áp suất', en: 'Pressure switch: the contact operates when the pressure rises above the set point', vi: 'Công tắc áp suất: tiếp điểm tác động khi áp suất vượt điểm đặt', label: 'Pressure', unit: 'bar', def: '2', set: '5', max: 10, key: 'P', glyph: 'P' },
  { slug: 'temperature', name: 'Temperature Switch', nameVi: 'Công tắc nhiệt (thermostat)', en: 'Temperature switch (thermostat): the contact operates when the temperature rises above the set point', vi: 'Công tắc nhiệt (thermostat): tiếp điểm tác động khi nhiệt độ vượt điểm đặt', label: 'Temperature', unit: '°C', def: '25', set: '60', max: 150, key: 'T', glyph: 'θ' },
  { slug: 'level', name: 'Level Switch', nameVi: 'Công tắc mức (phao)', en: 'Liquid-level (float) switch: the contact operates when the level rises above the set point', vi: 'Công tắc mức chất lỏng (phao): tiếp điểm tác động khi mức vượt điểm đặt', label: 'Level', unit: '%', def: '20', set: '80', max: 100, key: 'L', glyph: 'L' },
  { slug: 'flow', name: 'Flow Switch', nameVi: 'Công tắc lưu lượng', en: 'Flow switch: the contact operates when the flow rises above the set point', vi: 'Công tắc lưu lượng: tiếp điểm tác động khi lưu lượng vượt điểm đặt', label: 'Flow', unit: 'L/min', def: '0', set: '5', max: 50, key: 'F', glyph: 'F' },
];

const SENSE_SYMBOL = (glyph: string): SymbolDef => twoPinH([line(-20, 0, -14, 0), circle(-14, 0, 2), circle(14, 0, 2), line(-13, -1, 12, -11), line(14, 0, 20, 0), line(0, -6, 0, -16), rect(-6, -26, 12, 10), text(0, -18, glyph, 7)]);

function contactParams(): ParamDef[] {
  return [
    selectParam('contact', 'Contact type', 'no', [['no', 'Normally open'], ['nc', 'Normally closed']]),
    numParam('ron', 'On resistance', '50m', 'Ω', { group: 'advanced', min: 0 }),
    numParam('roff', 'Off resistance', '1G', 'Ω', { group: 'advanced', min: 0 }),
  ];
}

const sensingSwitches: LibraryPartDef[] = [
  ...SENSES.map((s) =>
    withMeta(
      {
        id: `electromechanical/${s.slug}-switch`,
        name: s.name,
        group: 'electromechanical',
        family: 'Sensing switch',
        description: `${s.en}. Key '${s.key}' raises the ${s.label.toLowerCase()} (Shift+${s.key} lowers it) during simulation`,
        prefix: 'S',
        symbol: SENSE_SYMBOL(s.glyph),
        params: [
          numParam('value', s.label, s.def, s.unit, { min: 0, max: s.max, showOnSchematic: true }),
          numParam('setpoint', 'Set point', s.set, s.unit, { min: 0, max: s.max }),
          ...contactParams(),
          keyParam(s.key),
          stepParam('5'),
        ],
        interactive: { kind: 'slider', param: 'value', label: s.label, key: s.key, step: 5 },
        toSpice: (ctx) => {
          const over = ctx.num('value') > ctx.num('setpoint');
          const closed = textOf(ctx, 'contact') === 'nc' ? !over : over;
          return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), closed ? pos(ctx, 'ron') : pos(ctx, 'roff'))] };
        },
        provenance: 'MachSim sensing contact (state from the process value against the set point)',
        footprint: 'SW-2P',
        keywords: ['sensing switch', s.slug, 'process switch', 'interactive'],
      },
      { vi: `${s.vi}. Phím '${s.key}' tăng giá trị (Shift+${s.key} giảm) khi mô phỏng`, nameVi: s.nameVi },
    ),
  ),
  withMeta(
    {
      id: 'electromechanical/limit-switch',
      name: 'Limit Switch',
      group: 'electromechanical',
      family: 'Sensing switch',
      description: "Limit (position) switch: the contact operates while the actuator is pressed; key 'K' presses it during simulation",
      prefix: 'S',
      symbol: SENSE_SYMBOL('↯'),
      params: [boolParam('actuated', 'Actuated', false), ...contactParams(), keyParam('K')],
      interactive: { kind: 'momentary', param: 'actuated', label: 'Actuate', key: 'K' },
      toSpice: (ctx) => {
        const on = boolOf(ctx, 'actuated');
        const closed = textOf(ctx, 'contact') === 'nc' ? !on : on;
        return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), closed ? pos(ctx, 'ron') : pos(ctx, 'roff'))] };
      },
      provenance: 'MachSim momentary position contact (constant topology resistor)',
      footprint: 'SW-2P',
      keywords: ['limit switch', 'position switch', 'end stop', 'interactive'],
    },
    { vi: "Công tắc hành trình: tiếp điểm tác động khi cần gạt bị ấn; phím 'K' ấn cần khi mô phỏng", nameVi: 'Công tắc hành trình' },
  ),
];

// ---------------------------------------------------------------------------------------------
// protection: circuit breakers and fuses

/**
 * Latching thermal(/magnetic) element in series between a and b; returns the elements and model.
 * stress = max(heat / thermalTrip², |I| / (magnetic·In)) + latch, where latch ≈ 0.5 once the
 * contact is open (it grows with the voltage across the open contact): the opened state then
 * stays consistent although the current — and with it the heat input — has stopped. The contact
 * itself is 10 µΩ; `ron` is the element's cold resistance in series.
 */
function tripElement(ctx: ToSpiceContext, a: string, b: string, inom: number, tau: number, thermalTrip: number, magnetic: number | null, ron: number): { els: ElementIR[]; model: ModelCard } {
  const sense = ctx.name('V', 'sense');
  const m = internalNode(ctx, 'm');
  const c = internalNode(ctx, 'c');
  const heat = internalNode(ctx, 'heat');
  const stress = internalNode(ctx, 'stress');
  const model = swModel('MS_TRIP', 0, 1, 1e-5, 1e9);
  const terms = [`V(${heat})/${ex(thermalTrip * thermalTrip)}`];
  if (magnetic !== null) terms.push(`abs(I(${sense}))/${ex(magnetic * inom)}`);
  const vsw = `abs(V(${c},${b}))`;
  return {
    els: [
      elSense(sense, a, m),
      elR(ctx.name('R', 'cold'), m, c, ron),
      elB(ctx.name('B', 'heat'), '0', heat, 'I', `I(${sense})*I(${sense})/${ex(inom * inom)}`),
      elR(ctx.name('R', 'heat'), heat, '0', 1),
      elC(ctx.name('C', 'heat'), heat, '0', tau),
      elB(ctx.name('B', 'stress'), stress, '0', 'V', `${terms.length > 1 ? `max(${terms.join(',')})` : terms[0]}+0.5*${vsw}/(${vsw}+0.001)`),
      { ...elS(ctx.name('S', 'trip'), c, b, '0', stress, model.name), params: { on: 1 } },
    ],
    model,
  };
}

const BREAKERS: [curve: 'B' | 'C' | 'D', amps: number][] = [
  ['B', 6], ['B', 10], ['B', 16], ['B', 20],
  ['C', 6], ['C', 10], ['C', 16], ['C', 20], ['C', 25], ['C', 32],
  ['D', 16], ['D', 25],
];
const MAG: Record<'B' | 'C' | 'D', number> = { B: 4, C: 7.5, D: 15 };

const BREAKER_SYMBOL = twoPinH([line(-20, 0, -14, 0), circle(-14, 0, 2), line(-13, -1, 12, -9), circle(14, 0, 2), line(14, 0, 20, 0), rect(-4, -16, 8, 6), line(0, -10, 0, -5)]);

const breakers: LibraryPartDef[] = BREAKERS.map(([curve, amps]) =>
  withMeta(
    {
      id: `electromechanical/mcb-${curve.toLowerCase()}${amps}`,
      name: `MCB ${curve}${amps}`,
      group: 'electromechanical',
      family: 'Protection',
      description: `Miniature circuit breaker, curve ${curve}, ${amps} A: thermal trip on sustained overload (> 1.3·In), magnetic trip at ≈ ${MAG[curve]}·In; key 'B' switches it manually`,
      prefix: 'Q',
      symbol: BREAKER_SYMBOL,
      params: [boolParam('closed', 'Closed', true), keyParam('B')],
      interactive: { kind: 'toggle', param: 'closed', label: 'Toggle', key: 'B' },
      toSpice: (ctx) => {
        const mid = internalNode(ctx, 'sw');
        const t = tripElement(ctx, ctx.node('1'), mid, amps, 10, 1.3, MAG[curve], 2e-3);
        return { elements: [...t.els, elR(ctx.name('R', 'manual'), mid, ctx.node('2'), boolOf(ctx, 'closed') ? 1e-3 : 1e9)], models: [t.model] };
      },
      provenance: `MachSim thermal-magnetic breaker: I²-averaged thermal element (τ = 10 s, trip at 1.3·In sustained) and magnetic trip at ${MAG[curve]}·In (published IEC 60898 curve ${curve} band)`,
      footprint: 'DIN-RAIL',
      keywords: ['circuit breaker', 'mcb', `curve ${curve.toLowerCase()}`, 'protection', 'overcurrent'],
    },
    { vi: `Áp-tô-mát tép (MCB), đường cong ${curve}, ${amps} A: cắt nhiệt khi quá tải kéo dài (> 1.3·In), cắt từ tại ≈ ${MAG[curve]}·In; phím 'B' bật / tắt bằng tay`, specs: { irating: amps, curve }, sortKey: MAG[curve] * 100 + amps, series: 'MCB' },
  ),
);

const FUSE_RATINGS = [0.05, 0.1, 0.125, 0.16, 0.2, 0.25, 0.315, 0.4, 0.5, 0.63, 0.8, 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8, 10];
const FUSE_SYMBOL = twoPinH([rect(-14, -5, 28, 10), line(-20, 0, 20, 0)]);
const ampText = (a: number) => (a < 1 ? `${Math.round(a * 1000)}mA` : `${a}A`);

function fusePart(kind: 'F' | 'T' | 'ATO', amps: number): LibraryPartDef {
  const tau = kind === 'F' ? 20e-3 : kind === 'T' ? 1 : 0.2;
  const label = kind === 'ATO' ? `ATO ${amps}A` : `${kind}${ampText(amps)}`;
  const en = kind === 'F' ? 'fast-acting 5×20 mm' : kind === 'T' ? 'time-lag (slow-blow) 5×20 mm' : 'automotive blade';
  const vi = kind === 'F' ? 'tác động nhanh 5×20 mm' : kind === 'T' ? 'tác động chậm 5×20 mm' : 'dạng lưỡi cho ô tô';
  return withMeta(
    {
      id: `power/fuse-${kind.toLowerCase()}-${ampText(amps).toLowerCase()}`,
      name: label,
      group: 'power',
      family: 'Fuse',
      description: `${en} fuse, ${eng(amps, 'A')}: melts on a sustained overload above 1.5·In, faster for larger overloads, and stays open`,
      prefix: 'F',
      symbol: FUSE_SYMBOL,
      params: [],
      toSpice: (ctx) => {
        const t = tripElement(ctx, ctx.node('1'), ctx.node('2'), amps, tau, 1.5, null, Math.max(1e-3, 0.05 / amps));
        return { elements: t.els, models: [t.model] };
      },
      provenance: `MachSim thermal fuse: I² / In² averaged over τ = ${eng(tau, 's')}, melting at 1.5·In sustained (approximation of the ${en} time-current characteristic)`,
      footprint: kind === 'ATO' ? 'FUSE-BLADE' : 'FUSE-5X20',
      keywords: ['fuse', kind === 'T' ? 'slow blow' : kind === 'F' ? 'fast' : 'blade', 'protection', ampText(amps).toLowerCase()],
    },
    { vi: `Cầu chì ${vi}, ${eng(amps, 'A')}: chảy khi quá tải kéo dài trên 1.5·In (quá tải càng lớn càng nhanh) và giữ hở mạch`, specs: { irating: amps, curve: kind }, sortKey: (kind === 'F' ? 0 : kind === 'T' ? 1000 : 2000) + amps, series: 'Fuse' },
  );
}

const fuses: LibraryPartDef[] = [...FUSE_RATINGS.map((a) => fusePart('F', a)), ...FUSE_RATINGS.map((a) => fusePart('T', a)), ...[1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30].map((a) => fusePart('ATO', a))];

// ---------------------------------------------------------------------------------------------
// motors

const DC_MOTORS: { slug: string; name: string; nameVi: string; en: string; vi: string; v: Record<string, string>; rpm: number; volts: number }[] = [
  { slug: 'dc-motor-130', name: 'DC Motor 3 V (130 size)', nameVi: 'Động cơ DC 3 V (cỡ 130)', en: 'Small 3 V hobby DC motor (130 size): ≈ 6000 rpm no load, ≈ 2 A stall', vi: 'Động cơ DC nhỏ 3 V (cỡ 130): ≈ 6000 vòng/phút không tải, dòng kẹt ≈ 2 A', v: { ra: '1.5', la: '0.2m', kt: '4.5m', j: '1u', b: '1.1u', tload: '0' }, rpm: 6000, volts: 3 },
  { slug: 'dc-motor-555', name: 'DC Motor 12 V (555 size)', nameVi: 'Động cơ DC 12 V (cỡ 555)', en: '12 V DC motor (555 size): ≈ 5000 rpm no load, ≈ 8 A stall', vi: 'Động cơ DC 12 V (cỡ 555): ≈ 5000 vòng/phút không tải, dòng kẹt ≈ 8 A', v: { ra: '1.5', la: '1m', kt: '22m', j: '20u', b: '12.6u', tload: '0' }, rpm: 5000, volts: 12 },
  { slug: 'dc-gearmotor-24v', name: 'DC Gear Motor 24 V 100 rpm', nameVi: 'Động cơ DC giảm tốc 24 V 100 vòng/phút', en: '24 V DC gear motor, ≈ 100 rpm at the output shaft (gearbox included in the constants)', vi: 'Động cơ DC giảm tốc 24 V, ≈ 100 vòng/phút ở trục ra (hộp số đã gộp vào hằng số)', v: { ra: '4', la: '3m', kt: '2.2', j: '1m', b: '10m', tload: '0' }, rpm: 100, volts: 24 },
];

const dcMotors: LibraryPartDef[] = DC_MOTORS.map((m) =>
  withMeta(
    {
      ...dcMotor,
      id: `electromechanical/${m.slug}`,
      name: m.name,
      description: `${m.en}; speed is V(<refdes>.w) in rad/s`,
      params: dcMotor.params.map((p) => (m.v[p.key] !== undefined ? { ...p, default: m.v[p.key] } : p)),
      keywords: ['motor', 'dc motor', `${m.volts}v`, 'electromechanical'],
    },
    { vi: `${m.vi}; tốc độ là V(<refdes>.w) tính bằng rad/s`, nameVi: m.nameVi, specs: { vin: m.volts, speed: m.rpm }, sortKey: m.volts },
  ),
);

const MOTOR_CIRCLE = (letter: string) => [circle(0, 0, 18), text(0, 5, letter, 11, 'middle', true)];

const inductionParams: ParamDef[] = [
  numParam('rs', 'Stator resistance', '10', 'Ω', { min: 0 }),
  numParam('rr', 'Rotor resistance (referred)', '8', 'Ω', { min: 0 }),
  numParam('lls', 'Stator leakage inductance', '38m', 'H', { min: 0 }),
  numParam('llr', 'Rotor leakage inductance', '38m', 'H', { min: 0 }),
  numParam('lm', 'Magnetising inductance', '950m', 'H', { min: 0 }),
  numParam('poles', 'Number of poles', '4', '', { min: 2 }),
  numParam('freq', 'Supply frequency', '50', 'Hz', { min: 1, showOnSchematic: true }),
  numParam('j', 'Rotor inertia', '2m', 'kg·m²', { min: 0 }),
  numParam('b', 'Viscous friction', '500u', 'N·m·s', { min: 0 }),
  numParam('tload', 'Load torque', '0', 'N·m'),
];

const inductionMotor: LibraryPartDef = withMeta(
  {
    id: 'electromechanical/induction-motor-3ph',
    name: 'Induction Motor 3-Phase',
    group: 'electromechanical',
    family: 'Motor',
    description: 'Three-phase squirrel-cage induction motor (wye, per-phase equivalent circuit with dynamic slip); defaults resemble a 0.75 kW 400 V 50 Hz 4-pole motor; speed is V(<refdes>.w) in rad/s',
    prefix: 'M',
    symbol: boxSymbol({ w: 60, h: 60, left: [{ name: 'U', number: '1' }, { name: 'V', number: '2' }, { name: 'W', number: '3' }], extra: [...MOTOR_CIRCLE('M'), text(0, 26, '3~', 8)] }),
    params: inductionParams,
    indicator: { kind: 'motor', signal: 'w' },
    toSpice: (ctx) => {
      const v: Record<string, number> = {};
      for (const k of ['rs', 'rr', 'lls', 'llr', 'lm', 'poles', 'freq', 'j', 'b']) v[k] = pos(ctx, k);
      const tl = ctx.num('tload');
      const ws = (2 * Math.PI * v.freq) / (v.poles / 2);
      const n = internalNode(ctx, 'n');
      const w = internalNode(ctx, 'w');
      // star point referred to ground through 1 kΩ: balanced operation draws no current through it,
      // and the inductive star point stays well defined numerically
      const els: ElementIR[] = [elR(ctx.name('R', 'n'), n, '0', 1e3)];
      const slip = `((${ex(ws)}-V(${w}))/${ex(ws)})`;
      const rotor: string[] = [];
      (['U', 'V', 'W'] as const).forEach((ph, i) => {
        const a = internalNode(ctx, `a${i}`);
        const m = internalNode(ctx, `m${i}`);
        // approximate equivalent circuit: stator and rotor leakage lumped in series on the stator
        // side, so the slip-dependent rotor resistance Rr / s never sits in series with an
        // inductor (a fast-changing slip would otherwise make the rotor branch stiff)
        els.push(
          elR(ctx.name('R', `s${i}`), ctx.node(ph), a, v.rs),
          elL(ctx.name('L', `s${i}`), a, m, v.lls + v.llr),
          elL(ctx.name('L', `m${i}`), m, n, v.lm),
          elB(ctx.name('B', `r${i}`), m, n, 'I', `V(${m},${n})*${slip}/${ex(v.rr)}`),
        );
        rotor.push(`V(${m},${n})*V(${m},${n})`);
      });
      els.push(
        // torque only for t > 0: the operating point of an AC machine is the motor at standstill
        elB(ctx.name('B', 't'), '0', w, 'I', `(${rotor.join('+')})*${slip}/${ex(v.rr * ws)}*u(time)`),
        elC(ctx.name('C', 'j'), w, '0', v.j),
        elR(ctx.name('R', 'b'), w, '0', 1 / v.b),
      );
      if (tl !== 0) els.push(elI(ctx.name('I', 'load'), w, '0', { dc: tl }));
      return { elements: els };
    },
    bindIndicator: (ctx) => ({ signal: { kind: 'voltage', pos: internalNodeName(ctx.refdes, 'w'), neg: '0' } }),
    provenance: 'Approximate per-phase equivalent circuit of the induction machine (textbook, leakage lumped on the stator side) with the slip computed from the simulated rotor speed; torque from the air-gap power',
    footprint: 'MOTOR-3P',
    keywords: ['induction motor', 'asynchronous', 'three phase', 'squirrel cage', 'ac motor'],
  },
  { vi: 'Động cơ không đồng bộ ba pha rô-to lồng sóc (nối sao, mạch tương đương một pha với hệ số trượt thay đổi); mặc định giống động cơ 0.75 kW 400 V 50 Hz 4 cực; tốc độ là V(<refdes>.w) rad/s', nameVi: 'Động cơ không đồng bộ 3 pha', specs: { power: 750, vin: 400 } },
);

const bldcParams: ParamDef[] = [
  numParam('r', 'Phase resistance', '0.5', 'Ω', { min: 0 }),
  numParam('l', 'Phase inductance', '0.5m', 'H', { min: 0 }),
  numParam('ke', 'Back-EMF constant', '20m', 'V·s/rad', { min: 0, showOnSchematic: true }),
  numParam('poles', 'Number of poles', '4', '', { min: 2 }),
  numParam('j', 'Rotor inertia', '20u', 'kg·m²', { min: 0 }),
  numParam('b', 'Viscous friction', '20u', 'N·m·s', { min: 0 }),
  numParam('tload', 'Load torque', '0', 'N·m'),
  numParam('vhall', 'Hall output high', '5', 'V', { min: 0 }),
];

const bldcMotor: LibraryPartDef = withMeta(
  {
    id: 'electromechanical/bldc-motor',
    name: 'BLDC Motor',
    group: 'electromechanical',
    family: 'Motor',
    description: 'Brushless DC motor: three wye phases A, B, C with trapezoidal back-EMF and Hall outputs H1–H3 (0 / 5 V) for six-step commutation; speed V(<refdes>.w) rad/s, angle V(<refdes>.deg)',
    prefix: 'M',
    symbol: boxSymbol({ w: 80, h: 60, left: [{ name: 'A', number: '1' }, { name: 'B', number: '2' }, { name: 'C', number: '3' }], right: [{ name: 'H1', number: '4', type: 'output' }, { name: 'H2', number: '5', type: 'output' }, { name: 'H3', number: '6', type: 'output' }], extra: MOTOR_CIRCLE('BL') }),
    params: bldcParams,
    optionalPins: ['H1', 'H2', 'H3'],
    indicator: { kind: 'motor', signal: 'w' },
    toSpice: (ctx) => {
      const r = pos(ctx, 'r');
      const l = pos(ctx, 'l');
      const ke = pos(ctx, 'ke');
      const pp = pos(ctx, 'poles') / 2;
      const j = pos(ctx, 'j');
      const b = pos(ctx, 'b');
      const tl = ctx.num('tload');
      const vh = ctx.num('vhall');
      const n = internalNode(ctx, 'n');
      const w = internalNode(ctx, 'w');
      const th = internalNode(ctx, 'th');
      const deg = internalNode(ctx, 'deg');
      const els: ElementIR[] = [elR(ctx.name('R', 'n'), n, '0', 1e9), elB(ctx.name('B', 'th'), '0', th, 'I', `V(${w})*u(time)`), elC(ctx.name('C', 'th'), th, '0', 1), elR(ctx.name('R', 'th'), th, '0', 1e12), elE(ctx.name('E', 'deg'), deg, '0', th, '0', 180 / Math.PI)];
      const torque: string[] = [];
      (['A', 'B', 'C'] as const).forEach((ph, k) => {
        const a = internalNode(ctx, `a${k}`);
        const e = internalNode(ctx, `e${k}`);
        const sense = ctx.name('V', `i${k}`);
        const f = `limit(1.6*sin(${ex(pp)}*V(${th})-${ex((2 * Math.PI * k) / 3)}),-1,1)`;
        els.push(elR(ctx.name('R', `${k}`), ctx.node(ph), a, r), elL(ctx.name('L', `${k}`), a, e, l), elSense(sense, e, internalNode(ctx, `x${k}`)), elB(ctx.name('B', `e${k}`), internalNode(ctx, `x${k}`), n, 'V', `${ex(ke)}*V(${w})*${f}`));
        torque.push(`${f}*I(${sense})`);
        const hall = internalNode(ctx, `h${k}`);
        els.push(elB(ctx.name('B', `h${k}`), hall, '0', 'V', `${ex(vh)}*(0.5+0.5*tanh(20*sin(${ex(pp)}*V(${th})-${ex((2 * Math.PI * k) / 3)})))`), elR(ctx.name('R', `h${k}`), hall, ctx.node(`H${k + 1}`), 1000));
      });
      els.push(elB(ctx.name('B', 't'), '0', w, 'I', `${ex(ke)}*(${torque.join('+')})*u(time)`), elC(ctx.name('C', 'j'), w, '0', j), elR(ctx.name('R', 'b'), w, '0', 1 / b));
      if (tl !== 0) els.push(elI(ctx.name('I', 'load'), w, '0', { dc: tl }));
      return { elements: els };
    },
    bindIndicator: (ctx) => ({ signal: { kind: 'voltage', pos: internalNodeName(ctx.refdes, 'w'), neg: '0' } }),
    provenance: 'Standard trapezoidal-EMF BLDC machine equations (published theory); defaults resemble a small 24 V drone / fan motor',
    footprint: 'MOTOR-6P',
    keywords: ['bldc', 'brushless', 'motor', 'hall sensor', 'six step'],
  },
  { vi: 'Động cơ DC không chổi than: ba pha A, B, C nối sao với sức phản điện động hình thang và ngõ ra cảm biến Hall H1–H3 (0 / 5 V) cho chuyển mạch sáu bước; tốc độ V(<refdes>.w) rad/s, góc V(<refdes>.deg)', nameVi: 'Động cơ BLDC' },
);

const stepperParams: ParamDef[] = [
  numParam('r', 'Phase resistance', '1.65', 'Ω', { min: 0 }),
  numParam('l', 'Phase inductance', '2.8m', 'H', { min: 0 }),
  numParam('km', 'Torque constant', '235m', 'N·m/A', { min: 0, showOnSchematic: true }),
  numParam('nr', 'Rotor teeth', '50', '', { min: 1, help: 'Full step angle = 90° / teeth (50 teeth = 1.8°)' }),
  numParam('td', 'Detent torque', '20m', 'N·m', { min: 0 }),
  numParam('j', 'Rotor inertia', '5.4u', 'kg·m²', { min: 0 }),
  numParam('b', 'Viscous friction', '100u', 'N·m·s', { min: 0 }),
  numParam('tload', 'Load torque', '0', 'N·m'),
];

const stepperMotor: LibraryPartDef = withMeta(
  {
    id: 'electromechanical/stepper-bipolar',
    name: 'Stepper Motor Bipolar',
    group: 'electromechanical',
    family: 'Motor',
    description: 'Two-phase bipolar hybrid stepper (windings A+/A−, B+/B−), 1.8° per full step by default (NEMA 17-like constants); angle V(<refdes>.deg) in degrees, speed V(<refdes>.w)',
    prefix: 'M',
    symbol: boxSymbol({ w: 80, h: 60, left: [{ name: 'A+', number: '1' }, { name: 'A-', number: '2' }], right: [{ name: 'B+', number: '3' }, { name: 'B-', number: '4' }], extra: MOTOR_CIRCLE('ST') }),
    params: stepperParams,
    indicator: { kind: 'motor', signal: 'w' },
    toSpice: (ctx) => {
      const r = pos(ctx, 'r');
      const l = pos(ctx, 'l');
      const km = pos(ctx, 'km');
      const nr = pos(ctx, 'nr');
      const td = ctx.num('td');
      const j = pos(ctx, 'j');
      const b = pos(ctx, 'b');
      const tl = ctx.num('tload');
      const w = internalNode(ctx, 'w');
      const th = internalNode(ctx, 'th');
      const deg = internalNode(ctx, 'deg');
      const sA = ctx.name('V', 'ia');
      const sB = ctx.name('V', 'ib');
      const ang = `${ex(nr)}*V(${th})`;
      const els: ElementIR[] = [
        elB(ctx.name('B', 'th'), '0', th, 'I', `V(${w})*u(time)`),
        elC(ctx.name('C', 'th'), th, '0', 1),
        elR(ctx.name('R', 'th'), th, '0', 1e12),
        elE(ctx.name('E', 'deg'), deg, '0', th, '0', 180 / Math.PI),
      ];
      const winding = (tag: string, p: string, m: string, sense: string, emf: string) => {
        const a = internalNode(ctx, `${tag}1`);
        const c = internalNode(ctx, `${tag}2`);
        const d = internalNode(ctx, `${tag}3`);
        els.push(elR(ctx.name('R', tag), ctx.node(p), a, r), elL(ctx.name('L', tag), a, c, l), elSense(sense, c, d), elB(ctx.name('B', tag), d, ctx.node(m), 'V', emf));
      };
      winding('a', 'A+', 'A-', sA, `-${ex(km)}*V(${w})*sin(${ang})`);
      winding('b', 'B+', 'B-', sB, `${ex(km)}*V(${w})*cos(${ang})`);
      els.push(
        elB(ctx.name('B', 't'), '0', w, 'I', `-${ex(km)}*I(${sA})*sin(${ang})+${ex(km)}*I(${sB})*cos(${ang})-${ex(td)}*sin(4*${ang})`),
        elC(ctx.name('C', 'j'), w, '0', j),
        elR(ctx.name('R', 'fric'), w, '0', 1 / b),
      );
      if (tl !== 0) els.push(elI(ctx.name('I', 'load'), w, '0', { dc: tl }));
      return { elements: els };
    },
    bindIndicator: (ctx) => ({ signal: { kind: 'voltage', pos: internalNodeName(ctx.refdes, 'w'), neg: '0' } }),
    provenance: 'Standard two-phase hybrid stepper equations (published theory); defaults resemble a NEMA 17, 1.7 A, 0.4 N·m motor',
    footprint: 'MOTOR-4P',
    keywords: ['stepper', 'stepping motor', 'bipolar', 'nema 17', 'motor'],
  },
  { vi: 'Động cơ bước hai pha lưỡng cực (cuộn A+/A−, B+/B−), mặc định 1.8° mỗi bước đủ (hằng số giống NEMA 17); góc V(<refdes>.deg) tính bằng độ, tốc độ V(<refdes>.w)', nameVi: 'Động cơ bước lưỡng cực' },
);

export const ELECTROMECH_CATALOG: LibraryPartDef[] = [...relays, ...reedRelays, ...ssrs, ...contactors, ...timerRelays, ...sensingSwitches, ...breakers, ...dcMotors, inductionMotor, bldcMotor, stepperMotor];
export const FUSE_CATALOG: LibraryPartDef[] = fuses;
