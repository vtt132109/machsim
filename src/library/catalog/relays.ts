/**
 * Linked electromechanical parts: relay coils and the contacts that follow them, by name.
 *
 * Control diagrams draw a coil in one place and its contacts wherever the circuit needs them, often
 * on other sheets. MachSim does the same: a **coil** (relay, contactor, time-delay relay) or a
 * **thermal overload relay** is a *driver* that publishes its switching state as the internal node
 * `<refdes>.st` (0 … 1); a **contact** part (normally open, normally closed, changeover, three-pole
 * main contacts, supplementary blocks, overload contacts) has the text parameter `coil` with the
 * reference designator of its driver (K1, KM1, KT1, FR1) and follows that node. One coil can have
 * any number of contacts of any kind, on any sheet of the same level. A contact whose coil does not
 * exist, or that names a part which is not a coil, is an ERC warning (`contactNoCoil`,
 * `contactNotCoil`, `contactNoName`) and stays in its rest position. Contacts inside a hierarchical
 * block follow coils of the same block only.
 *
 * Models (MachSim behavioural, from published device behaviour):
 *   coil       the existing relay model (electromech.ts `coil`): R–L coil, averaged rectified
 *              current / nominal current as the level, pull-in 75 %, drop-out 10 %; AC coils use a
 *              VA rating (impedance V²/VA at 50 Hz). `st` = that level.
 *   timer coil the same coil plus the on-delay / off-delay timer of electromech.ts `timerState`
 *              (delay is the ramp time of the timer node; the contact follows `st`).
 *   overload   heat = ∫(I²/Ir²) through a lag τ (mean over the poles), tripping at 1.2·Ir (the IEC
 *              60947-4-1 band: no trip at 1.05·Ir, trip at 1.2·Ir) with τ set by the trip class so
 *              that a cold relay trips at 7.2·Ir in 4 s (10A), 7 s (10), 13 s (20) or 20 s (30):
 *              t = τ · ln(m² / (m² − 1.2)). The trip latches until Reset (key R).
 *   contacts   SW models (RON 50 mΩ, ROFF 1 GΩ by default), pole by pole.
 *   starter    a direct-on-line motor starter: three power contacts driven by its coil, a
 *              three-pole thermal overload in the motor leads, a normally closed overload contact
 *              95-96 and a normally open auxiliary contact 13-14.
 */
import type { ElementIR, ModelCard } from '../../sim/netlist';
import { boolOf, boolParam, elB, elC, elR, elS, elSense, elV, ex, followDriver, internalNode, keyParam, numParam, paramModelName, selectParam, swModel, textParam, type LibraryPartDef } from '../partkit';
import { arc, boxSymbol, circle, line, makeSymbol, pin, rect, text } from '../symbols';
import type { ParamDef, PinDef, SymbolDef, SymbolPrim, ToSpiceContext } from '../types';
import { coil, timerState, type TimerKind } from './electromech';
import { eng, withMeta } from './kit';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// pure formulas

/** Overload relay trip classes: trip time (s) of a cold relay at 7.2 × the setting (IEC 60947-4-1 bands). */
export const OVERLOAD_CLASSES = { '10A': 4, '10': 7, '20': 13, '30': 20 } as const;
export type OverloadClass = keyof typeof OVERLOAD_CLASSES;
/** Heat level (in Ir²) at which the bimetal trips: no trip at 1.05·Ir, trip at 1.2·Ir. */
export const OVERLOAD_TRIP_LEVEL = 1.2;

/** Thermal time constant (s) of a trip class. */
export function overloadTau(cls: OverloadClass): number {
  const m2 = 7.2 * 7.2;
  return OVERLOAD_CLASSES[cls] / Math.log(m2 / (m2 - OVERLOAD_TRIP_LEVEL));
}

/** Cold trip time (s) at a multiple m = I / Ir of the setting; Infinity when the heat never reaches the trip level. */
export function overloadTripTime(cls: OverloadClass, multiple: number): number {
  const m2 = multiple * multiple;
  if (m2 <= OVERLOAD_TRIP_LEVEL) return Number.POSITIVE_INFINITY;
  return overloadTau(cls) * Math.log(m2 / (m2 - OVERLOAD_TRIP_LEVEL));
}

// ---------------------------------------------------------------------------------------------
// symbols

const shiftY = (prims: SymbolPrim[], dy: number): SymbolPrim[] =>
  prims.map((p) => {
    switch (p.kind) {
      case 'line':
        return { ...p, y1: p.y1 + dy, y2: p.y2 + dy };
      case 'circle':
      case 'arc':
        return { ...p, cy: p.cy + dy };
      case 'text':
      case 'rect':
        return { ...p, y: p.y + dy };
      default:
        return p;
    }
  });

export type PoleForm = 'no' | 'nc' | 'co';

/**
 * One contact pole drawn on the row y = 0 (pins at x = ±30; changeover: COM on the left, NC above
 * and NO below on the right). The blade pivots at x = -8; a normally closed contact rests against
 * its fixed contact (the bar), a normally open one stands clear of it.
 */
function poleArt(form: PoleForm): SymbolPrim[] {
  if (form === 'no') return [line(-30, 0, -8, 0), line(8, 0, 30, 0), line(-8, 0, 6, -13)];
  if (form === 'nc') return [line(-30, 0, -8, 0), line(8, 0, 30, 0), line(-8, 0, 8, -12), line(8, -12, 8, 0)];
  return [line(-30, 0, -8, 0), line(8, -10, 30, -10), line(8, 10, 30, 10), line(-8, 0, 8, -9)];
}

interface PoleSpec {
  form: PoleForm;
  /** pin names: no / nc → [left, right]; co → [com, nc, no] */
  pins: string[];
  /** row of the pole (poles of a multi-pole part are drawn one under the other) */
  y: number;
}

function poleSymbol(poles: PoleSpec[], extra: SymbolPrim[] = []): SymbolDef {
  const prims: SymbolPrim[] = [];
  const pins: PinDef[] = [];
  for (const p of poles) {
    prims.push(...shiftY(poleArt(p.form), p.y));
    if (p.form === 'co') {
      pins.push(pin(p.pins[0], -30, p.y, 'left', { number: p.pins[0] }), pin(p.pins[1], 30, p.y - 10, 'right', { number: p.pins[1] }), pin(p.pins[2], 30, p.y + 10, 'right', { number: p.pins[2] }));
    } else {
      pins.push(pin(p.pins[0], -30, p.y, 'left', { number: p.pins[0] }), pin(p.pins[1], 30, p.y, 'right', { number: p.pins[1] }));
    }
  }
  const top = poles[0].y;
  const bottom = poles[poles.length - 1].y;
  return makeSymbol([...prims, ...extra], pins, { refPos: { x: 0, y: top - 24 }, valuePos: { x: 0, y: bottom + 30 } });
}

function coilSymbol(label: string, glyph: SymbolPrim[] = []): SymbolDef {
  return makeSymbol(
    [line(-30, 0, -14, 0), line(14, 0, 30, 0), rect(-14, -11, 28, 22), text(0, 4, label, 10, 'middle', true), ...glyph],
    [pin('A1', -30, 0, 'left', { number: 'A1' }), pin('A2', 30, 0, 'right', { number: 'A2' })],
    { refPos: { x: 0, y: -22 }, valuePos: { x: 0, y: 28 } },
  );
}

// ---------------------------------------------------------------------------------------------
// coils (drivers)

interface CoilKind {
  slug: string;
  prefix: string;
  family: string;
  label: string;
}

/** Publish the state node and the driver marker of a coil: st = the averaged coil level. */
function stateFollowsLevel(ctx: ToSpiceContext, level: string): ElementIR {
  return elB(ctx.name('B', 'st'), internalNode(ctx, 'st'), '0', 'V', `V(${level})`);
}

const relayCoilParams = (v: number, r: number): ParamDef[] => [numParam('vcoil', 'Nominal coil voltage', String(v), 'V', { min: 0, showOnSchematic: true }), numParam('rcoil', 'Coil resistance', String(r), 'Ω', { min: 0 })];

const dcCoils: LibraryPartDef[] = [5, 12, 24, 48].map((v) => {
  const rcoil = Number(((v * v) / 0.4).toPrecision(2));
  return withMeta(
    {
      id: `electromechanical/coil-dc-${v}v`,
      name: `Relay Coil ${v} V DC`,
      group: 'electromechanical',
      family: 'Relay coil',
      description: `Coil of a relay, ${v} V DC (${eng(rcoil, 'Ω')}): drive it from the control circuit and name its reference designator (K1 …) in the "coil" parameter of any number of contact parts, on any sheet. Pulls in at 75 % of the nominal current and drops out at 10 %`,
      prefix: 'K',
      symbol: coilSymbol('K'),
      params: relayCoilParams(v, rcoil),
      contactLink: { role: 'driver' },
      toSpice: (ctx) => {
        const r = pos(ctx, 'rcoil');
        const c = coil(ctx, ctx.node('A1'), ctx.node('A2'), r, 0.005 * r, pos(ctx, 'vcoil') / r);
        return { elements: [...c.els, stateFollowsLevel(ctx, c.level)] };
      },
      provenance: `MachSim relay coil: ${v} V / ${eng(rcoil, 'Ω')} (L/R = 5 ms), pull-in 75 %, drop-out 10 % of the nominal coil current`,
      footprint: 'RELAY-COIL',
      keywords: ['relay coil', 'coil', 'relay', `${v}v`, 'control relay', 'electromagnet'],
    },
    { vi: `Cuộn hút của rơ-le ${v} V DC (${eng(rcoil, 'Ω')}): cấp điện từ mạch điều khiển rồi ghi ký hiệu của nó (K1 …) vào tham số "Cuộn hút" của số tiếp điểm tuỳ ý, ở bất kỳ trang nào. Hút ở 75 % và nhả ở 10 % dòng danh định`, nameVi: `Cuộn rơ-le ${v} V DC`, specs: { coil: v }, sortKey: v, series: 'Relay coil' },
  );
});

/** AC coil constants for a VA rating: impedance V²/VA at 50 Hz, R = 0.3 Z, the rest inductive. */
function acCoilConstants(v: number, va: number) {
  const z = (v * v) / va;
  return { r: 0.3 * z, l: (0.95 * z) / (2 * Math.PI * 50), inom: (v / z) * 0.9 };
}

function acCoilPart(slug: string, prefix: string, family: string, glyph: string, v: number, va: number, vi: string, nameVi: string, en: string, name: string): LibraryPartDef {
  return withMeta(
    {
      id: `electromechanical/${slug}`,
      name,
      group: 'electromechanical',
      family,
      description: en,
      prefix,
      symbol: coilSymbol(glyph, [text(10, 10, '~', 8)]),
      params: [numParam('vcoil', 'Nominal coil voltage', String(v), 'V', { min: 0, showOnSchematic: true }), numParam('va', 'Coil rating', String(va), 'VA', { min: 0, help: 'Apparent power of the sealed coil: the impedance is V² / VA at 50 Hz' })],
      contactLink: { role: 'driver' },
      toSpice: (ctx) => {
        const k = acCoilConstants(pos(ctx, 'vcoil'), pos(ctx, 'va'));
        const c = coil(ctx, ctx.node('A1'), ctx.node('A2'), k.r, k.l, k.inom);
        return { elements: [...c.els, stateFollowsLevel(ctx, c.level)] };
      },
      provenance: `MachSim AC coil: ${v} V, ${va} VA, R–L impedance at 50 Hz, rectified and averaged current (no chatter), pull-in 75 % / drop-out 10 %`,
      footprint: 'RELAY-COIL',
      keywords: ['ac coil', 'coil', 'contactor coil', 'relay coil', `${v}v ac`],
    },
    { vi, nameVi, specs: { coil: v }, sortKey: 100 + v, series: family },
  );
}

const acCoils: LibraryPartDef[] = [
  ...[24, 120, 230].map((v) =>
    acCoilPart(
      `coil-ac-${v}v`,
      'K',
      'Relay coil',
      'K',
      v,
      3,
      `Cuộn hút rơ-le ${v} V AC (≈ 3 VA): dòng được chỉnh lưu và lấy trung bình nên không bị rung ở 50 Hz`,
      `Cuộn rơ-le ${v} V AC`,
      `Coil of a relay, ${v} V AC (about 3 VA): the current is rectified and averaged so it does not chatter at 50 Hz`,
      `Relay Coil ${v} V AC`,
    ),
  ),
  ...(
    [
      ['24vdc', 24, 7, 'DC'],
      ['24vac', 24, 7, 'AC'],
      ['230vac', 230, 7, 'AC'],
    ] as const
  ).map(([slug, v, va, kind]) =>
    kind === 'AC'
      ? acCoilPart(
          `contactor-coil-${slug}`,
          'KM',
          'Contactor coil',
          'KM',
          v,
          va,
          `Cuộn hút công-tắc-tơ ${v} V AC (≈ ${va} VA): đặt ký hiệu (KM1 …) vào tham số "Cuộn hút" của các tiếp điểm chính và phụ`,
          `Cuộn công-tắc-tơ ${v} V AC`,
          `Contactor coil, ${v} V AC (about ${va} VA): name its designator (KM1 …) in the "coil" parameter of the main and auxiliary contacts`,
          `Contactor Coil ${v} V AC`,
        )
      : withMeta(
          {
            id: `electromechanical/contactor-coil-${slug}`,
            name: `Contactor Coil ${v} V DC`,
            group: 'electromechanical',
            family: 'Contactor coil',
            description: `Contactor coil, ${v} V DC: name its designator (KM1 …) in the "coil" parameter of the main and auxiliary contacts`,
            prefix: 'KM',
            symbol: coilSymbol('KM'),
            params: relayCoilParams(v, Number(((v * v) / va).toPrecision(2))),
            contactLink: { role: 'driver' },
            toSpice: (ctx) => {
              const r = pos(ctx, 'rcoil');
              const c = coil(ctx, ctx.node('A1'), ctx.node('A2'), r, 0.02 * r, pos(ctx, 'vcoil') / r);
              return { elements: [...c.els, stateFollowsLevel(ctx, c.level)] };
            },
            provenance: `MachSim contactor coil: ${v} V DC, ≈ ${va} W, pull-in 75 % / drop-out 10 %`,
            footprint: 'RELAY-COIL',
            keywords: ['contactor coil', 'coil', 'dc coil', 'contactor'],
          },
          { vi: `Cuộn hút công-tắc-tơ ${v} V DC: đặt ký hiệu (KM1 …) vào tham số "Cuộn hút" của các tiếp điểm chính và phụ`, nameVi: `Cuộn công-tắc-tơ ${v} V DC`, specs: { coil: v }, sortKey: 50 + v, series: 'Contactor coil' },
        ),
  ),
];

const TIMER_COIL_TEXT: Record<'on-delay' | 'off-delay', { en: string; vi: string; name: string; nameVi: string }> = {
  'on-delay': {
    en: 'Coil of an on-delay timer relay (KT): its contacts change over the set delay AFTER the coil is energised and return at once when it is released. Name its designator (KT1 …) in the "coil" parameter of timer contacts',
    vi: 'Cuộn của rơ-le thời gian trễ đóng (KT): tiếp điểm của nó chuyển trạng thái sau thời gian trễ kể từ khi cấp điện và trở lại ngay khi mất điện. Ghi ký hiệu (KT1 …) vào tham số "Cuộn hút" của các tiếp điểm thời gian',
    name: 'Timer Coil On-Delay',
    nameVi: 'Cuộn rơ-le thời gian trễ đóng',
  },
  'off-delay': {
    en: 'Coil of an off-delay timer relay (KT): its contacts change over at once when the coil is energised and return the set delay AFTER it is released. Name its designator (KT1 …) in the "coil" parameter of timer contacts',
    vi: 'Cuộn của rơ-le thời gian trễ mở (KT): tiếp điểm của nó chuyển ngay khi cấp điện và trở lại sau thời gian trễ kể từ khi mất điện. Ghi ký hiệu (KT1 …) vào tham số "Cuộn hút" của các tiếp điểm thời gian',
    name: 'Timer Coil Off-Delay',
    nameVi: 'Cuộn rơ-le thời gian trễ mở',
  },
};

const timerCoils: LibraryPartDef[] = (['on-delay', 'off-delay'] as const).map((kind) =>
  withMeta(
    {
      id: `electromechanical/timer-coil-${kind}`,
      name: TIMER_COIL_TEXT[kind].name,
      group: 'electromechanical',
      family: 'Timer coil',
      description: TIMER_COIL_TEXT[kind].en,
      prefix: 'KT',
      symbol: coilSymbol('KT', [circle(-8, 22, 3), line(-8, 22, -8, 19), line(-8, 22, -6, 22)]),
      params: [numParam('delay', 'Delay time', '1', 's', { min: 0, showOnSchematic: true }), numParam('vcoil', 'Nominal coil voltage', '24', 'V', { min: 0 }), numParam('rcoil', 'Coil resistance', '1k', 'Ω', { min: 0 })],
      contactLink: { role: 'driver' },
      toSpice: (ctx) => {
        const r = pos(ctx, 'rcoil');
        const c = coil(ctx, ctx.node('A1'), ctx.node('A2'), r, 0.005 * r, pos(ctx, 'vcoil') / r);
        return { elements: [...c.els, ...timerState(ctx, kind as TimerKind, pos(ctx, 'delay'), c.level, internalNode(ctx, 'st'))] };
      },
      provenance: 'MachSim timer coil: behavioural timer node (linear ramp over the delay time), contacts follow its state',
      footprint: 'DIN-RAIL',
      keywords: ['timer coil', 'time delay relay', kind, 'on delay', 'off delay', 'ton', 'tof'],
    },
    { vi: TIMER_COIL_TEXT[kind].vi, nameVi: TIMER_COIL_TEXT[kind].nameVi, specs: { coil: 24 }, sortKey: 200, series: 'Timer coil' },
  ),
);

// ---------------------------------------------------------------------------------------------
// contacts (followers)

const CONTACT_TH = 0.425;
const CONTACT_HYS = 0.325;

/** The switch models of a contact pair for given on / off resistances. */
function contactModels(ron: number, roff: number): { no: ModelCard; nc: ModelCard } {
  const base = { ron, roff };
  const defaults = { ron: 0.05, roff: 1e9 };
  return {
    no: swModel(paramModelName('MS_LCONTACT_NO', base, defaults), CONTACT_TH, CONTACT_HYS, ron, roff),
    nc: swModel(paramModelName('MS_LCONTACT_NC', base, defaults), -CONTACT_TH, CONTACT_HYS, ron, roff),
  };
}

/**
 * Elements of the poles of a contact part. With a driver the poles are SW elements controlled by its
 * state node; without one (ERC warning raised) they stay in their rest position as plain resistors.
 */
function poleElements(ctx: ToSpiceContext, poles: PoleSpec[], coilName: string): { elements: ElementIR[]; models: ModelCard[] } {
  const ron = ctx.num('ron');
  const roff = ctx.num('roff');
  if (!(ron >= 0) || !(roff > 0)) throw new Error('bad value for ron/roff: ron must be >= 0 and roff > 0');
  const st = followDriver(ctx, coilName);
  const m = contactModels(Math.max(ron, 1e-6), roff);
  const els: ElementIR[] = [];
  const models: ModelCard[] = [];
  const use = (c: ModelCard) => {
    if (!models.some((x) => x.name === c.name)) models.push(c);
    return c.name;
  };
  poles.forEach((p, k) => {
    const tag = poles.length > 1 ? `${k + 1}` : '';
    const open = (a: string, b: string, t: string) => elR(ctx.name('R', `o${t}`), ctx.node(a), ctx.node(b), roff);
    const closed = (a: string, b: string, t: string) => elR(ctx.name('R', `c${t}`), ctx.node(a), ctx.node(b), Math.max(ron, 1e-6));
    const sw = (a: string, b: string, t: string, nc: boolean): ElementIR =>
      nc ? { ...elS(ctx.name('S', `nc${t}`), ctx.node(a), ctx.node(b), '0', st!, use(m.nc)), params: { on: 1 } } : elS(ctx.name('S', `no${t}`), ctx.node(a), ctx.node(b), st!, '0', use(m.no));
    if (p.form === 'co') {
      const [com, nc, no] = p.pins;
      if (st === null) els.push(closed(com, nc, `nc${tag}`), open(com, no, `no${tag}`));
      else els.push(sw(com, nc, `${tag}c`, true), sw(com, no, `${tag}o`, false));
    } else {
      const [a, b] = p.pins;
      const nc = p.form === 'nc';
      if (st === null) els.push(nc ? closed(a, b, tag) : open(a, b, tag));
      else els.push(sw(a, b, tag, nc));
    }
  });
  return { elements: els, models };
}

function contactParams(defCoil: string): ParamDef[] {
  return [
    textParam('coil', 'Coil', defCoil, { showOnSchematic: true, help: 'Reference designator of the coil (or overload relay) this contact follows, e.g. K1: the same name on any number of contacts, on any sheet' }),
    numParam('ron', 'On resistance', '50m', 'Ω', { group: 'advanced', min: 0 }),
    numParam('roff', 'Off resistance', '1G', 'Ω', { group: 'advanced', min: 0 }),
  ];
}

interface ContactSpec {
  slug: string;
  name: string;
  nameVi: string;
  family: string;
  prefix: string;
  defCoil: string;
  poles: PoleSpec[];
  en: string;
  vi: string;
  keywords: string[];
  glyph?: SymbolPrim[];
  optional?: boolean;
}

function contactPart(s: ContactSpec): LibraryPartDef {
  const pins = s.poles.flatMap((p) => p.pins);
  return withMeta(
    {
      id: `electromechanical/${s.slug}`,
      name: s.name,
      group: 'electromechanical',
      family: s.family,
      description: s.en,
      prefix: s.prefix,
      symbol: poleSymbol(s.poles, s.glyph),
      params: contactParams(s.defCoil),
      contactLink: { role: 'contact', param: 'coil' },
      ...(s.optional || s.poles.length > 1 || s.poles[0].form === 'co' ? { optionalPins: pins } : {}),
      toSpice: (ctx) => poleElements(ctx, s.poles, ctx.params.coil ?? ''),
      provenance: 'MachSim contact follower: SW poles (RON 50 mΩ, ROFF 1 GΩ) switched by the state node of the named coil',
      footprint: 'DIN-RAIL',
      keywords: ['contact', 'relay contact', 'auxiliary contact', ...s.keywords],
    },
    { vi: s.vi, nameVi: s.nameVi, sortKey: s.poles.length * 10 + (s.poles[0].form === 'no' ? 0 : s.poles[0].form === 'nc' ? 1 : 2), series: s.family },
  );
}

const no = (a: string, b: string, y = 0): PoleSpec => ({ form: 'no', pins: [a, b], y });
const nc = (a: string, b: string, y = 0): PoleSpec => ({ form: 'nc', pins: [a, b], y });
const co = (com: string, ncp: string, nop: string, y = 0): PoleSpec => ({ form: 'co', pins: [com, ncp, nop], y });
const label = (t: string): SymbolPrim[] => [text(-6, 14, t, 7, 'start')];

const CONTACTS: ContactSpec[] = [
  // relay contacts (coil K1)
  { slug: 'relay-contact-no', name: 'Relay Contact NO', nameVi: 'Tiếp điểm rơ-le thường hở', family: 'Relay contact', prefix: 'KC', defCoil: 'K1', poles: [no('13', '14')], en: 'Normally open contact of a relay: closes while its coil (parameter "coil", default K1) is energised', vi: 'Tiếp điểm thường hở của rơ-le: đóng khi cuộn hút (tham số "Cuộn hút", mặc định K1) có điện', keywords: ['no', 'normally open', 'make contact'] },
  { slug: 'relay-contact-nc', name: 'Relay Contact NC', nameVi: 'Tiếp điểm rơ-le thường đóng', family: 'Relay contact', prefix: 'KC', defCoil: 'K1', poles: [nc('21', '22')], en: 'Normally closed contact of a relay: opens while its coil (parameter "coil", default K1) is energised', vi: 'Tiếp điểm thường đóng của rơ-le: mở khi cuộn hút (tham số "Cuộn hút", mặc định K1) có điện', keywords: ['nc', 'normally closed', 'break contact'] },
  { slug: 'relay-contact-co', name: 'Relay Contact Changeover', nameVi: 'Tiếp điểm rơ-le chuyển mạch', family: 'Relay contact', prefix: 'KC', defCoil: 'K1', poles: [co('11', '12', '14')], en: 'Changeover contact of a relay: COM-NC at rest, COM-NO while the coil (parameter "coil", default K1) is energised', vi: 'Tiếp điểm chuyển mạch của rơ-le: COM-NC khi nghỉ, COM-NO khi cuộn hút (tham số "Cuộn hút", mặc định K1) có điện', keywords: ['changeover', 'spdt', 'co contact'] },
  // timer contacts (coil KT1)
  { slug: 'timer-contact-no', name: 'Timer Contact NO', nameVi: 'Tiếp điểm thời gian thường hở', family: 'Timer contact', prefix: 'KC', defCoil: 'KT1', poles: [no('17', '18')], glyph: label('t'), en: 'Normally open contact of a time-delay relay: closes (or opens again) according to the on-delay / off-delay timer coil it names (default KT1)', vi: 'Tiếp điểm thường hở của rơ-le thời gian: đóng (hoặc mở lại) theo cuộn thời gian trễ đóng / trễ mở mà nó gọi tên (mặc định KT1)', keywords: ['timer contact', 'time delay', 'ton', 'tof'] },
  { slug: 'timer-contact-nc', name: 'Timer Contact NC', nameVi: 'Tiếp điểm thời gian thường đóng', family: 'Timer contact', prefix: 'KC', defCoil: 'KT1', poles: [nc('15', '16')], glyph: label('t'), en: 'Normally closed contact of a time-delay relay: opens (or closes again) according to the timer coil it names (default KT1)', vi: 'Tiếp điểm thường đóng của rơ-le thời gian: mở (hoặc đóng lại) theo cuộn thời gian mà nó gọi tên (mặc định KT1)', keywords: ['timer contact', 'time delay', 'ton', 'tof'] },
  { slug: 'timer-contact-co', name: 'Timer Contact Changeover', nameVi: 'Tiếp điểm thời gian chuyển mạch', family: 'Timer contact', prefix: 'KC', defCoil: 'KT1', poles: [co('15', '16', '18')], glyph: label('t'), en: 'Changeover contact of a time-delay relay (COM 15, NC 16, NO 18) following the timer coil it names (default KT1)', vi: 'Tiếp điểm chuyển mạch của rơ-le thời gian (COM 15, NC 16, NO 18) theo cuộn thời gian mà nó gọi tên (mặc định KT1)', keywords: ['timer contact', 'time delay', 'changeover'] },
  // contactor contacts (coil KM1)
  { slug: 'contactor-contact-3p', name: 'Contactor Main Contacts 3P', nameVi: 'Tiếp điểm chính công-tắc-tơ 3 cực', family: 'Contactor contact', prefix: 'KC', defCoil: 'KM1', poles: [no('L1', 'T1', -40), no('L2', 'T2', 0), no('L3', 'T3', 40)], glyph: [text(-4, 62, '3P', 7, 'start')], en: 'Three main (power) poles of a contactor, L1-T1, L2-T2, L3-T3: all close together while the contactor coil it names (default KM1) is energised', vi: 'Ba cực chính (công suất) của công-tắc-tơ L1-T1, L2-T2, L3-T3: đóng cùng lúc khi cuộn công-tắc-tơ mà nó gọi tên (mặc định KM1) có điện', keywords: ['contactor', 'main contacts', 'power contacts', 'three pole', 'motor starter'] },
  { slug: 'contactor-aux-no', name: 'Contactor Auxiliary Contact NO', nameVi: 'Tiếp điểm phụ công-tắc-tơ thường hở', family: 'Contactor contact', prefix: 'KC', defCoil: 'KM1', poles: [no('13', '14')], en: 'Auxiliary normally open contact 13-14 of a contactor (the holding / seal-in contact of a start-stop circuit)', vi: 'Tiếp điểm phụ thường hở 13-14 của công-tắc-tơ (tiếp điểm tự giữ của mạch mở – dừng)', keywords: ['auxiliary', 'holding contact', 'seal-in', 'self hold', 'start stop'] },
  { slug: 'contactor-aux-nc', name: 'Contactor Auxiliary Contact NC', nameVi: 'Tiếp điểm phụ công-tắc-tơ thường đóng', family: 'Contactor contact', prefix: 'KC', defCoil: 'KM1', poles: [nc('21', '22')], en: 'Auxiliary normally closed contact 21-22 of a contactor (the interlock contact of a forward-reverse circuit)', vi: 'Tiếp điểm phụ thường đóng 21-22 của công-tắc-tơ (tiếp điểm khoá chéo của mạch thuận – nghịch)', keywords: ['auxiliary', 'interlock', 'forward reverse'] },
  { slug: 'supplementary-block-2no2nc', name: 'Supplementary Contact Block 2NO+2NC', nameVi: 'Khối tiếp điểm phụ 2 hở + 2 đóng', family: 'Supplementary contact', prefix: 'KC', defCoil: 'KM1', poles: [no('13', '14', -60), no('23', '24', -20), nc('31', '32', 20), nc('41', '42', 60)], en: 'Add-on supplementary contact block with two normally open (13-14, 23-24) and two normally closed (31-32, 41-42) contacts that follow the coil it names (default KM1)', vi: 'Khối tiếp điểm phụ gắn thêm với hai tiếp điểm thường hở (13-14, 23-24) và hai thường đóng (31-32, 41-42) theo cuộn mà nó gọi tên (mặc định KM1)', keywords: ['supplementary', 'auxiliary block', 'add-on contacts', '2no 2nc'] },
  // thermal overload contacts (relay FR1)
  { slug: 'overload-contact-nc', name: 'Overload Contact NC (95-96)', nameVi: 'Tiếp điểm rơ-le nhiệt thường đóng (95-96)', family: 'Overload contact', prefix: 'KC', defCoil: 'FR1', poles: [nc('95', '96')], en: 'Normally closed contact 95-96 of a thermal overload relay (default FR1): opens when the overload relay trips; put it in series with the contactor coil', vi: 'Tiếp điểm thường đóng 95-96 của rơ-le nhiệt (mặc định FR1): mở khi rơ-le nhiệt tác động; mắc nối tiếp với cuộn công-tắc-tơ', keywords: ['overload', 'thermal relay', '95 96', 'trip contact'] },
  { slug: 'overload-contact-no', name: 'Overload Contact NO (97-98)', nameVi: 'Tiếp điểm rơ-le nhiệt thường hở (97-98)', family: 'Overload contact', prefix: 'KC', defCoil: 'FR1', poles: [no('97', '98')], en: 'Normally open contact 97-98 of a thermal overload relay (default FR1): closes when the overload relay trips, e.g. to light a fault lamp', vi: 'Tiếp điểm thường hở 97-98 của rơ-le nhiệt (mặc định FR1): đóng khi rơ-le nhiệt tác động, ví dụ để bật đèn báo sự cố', keywords: ['overload', 'thermal relay', '97 98', 'alarm contact'] },
];

const contactParts: LibraryPartDef[] = CONTACTS.map(contactPart);

// ---------------------------------------------------------------------------------------------
// limit switch with two contacts

const limitSwitch2: LibraryPartDef = withMeta(
  {
    id: 'electromechanical/limit-switch-1no1nc',
    name: 'Limit Switch 1NO+1NC',
    group: 'electromechanical',
    family: 'Sensing switch',
    description: "Roller-lever limit (position) switch with one normally open (13-14) and one normally closed (21-22) contact that change over together while the lever is pressed; key 'K' presses it during simulation",
    prefix: 'S',
    symbol: poleSymbol([no('13', '14', -20), nc('21', '22', 20)], [line(0, -14, 0, 14), circle(0, 22, 4)]),
    params: [boolParam('actuated', 'Actuated', false), numParam('ron', 'On resistance', '50m', 'Ω', { group: 'advanced', min: 0 }), numParam('roff', 'Off resistance', '1G', 'Ω', { group: 'advanced', min: 0 }), keyParam('K')],
    interactive: { kind: 'momentary', param: 'actuated', label: 'Actuate', key: 'K' },
    optionalPins: ['13', '14', '21', '22'],
    toSpice: (ctx) => {
      const on = boolOf(ctx, 'actuated');
      const ron = Math.max(ctx.num('ron'), 1e-6);
      const roff = ctx.num('roff');
      if (!(roff > 0)) throw new Error('bad value for roff: must be > 0');
      return { elements: [elR(ctx.name('R', 'no'), ctx.node('13'), ctx.node('14'), on ? ron : roff), elR(ctx.name('R', 'nc'), ctx.node('21'), ctx.node('22'), on ? roff : ron)] };
    },
    provenance: 'MachSim momentary position contacts (constant topology resistors, the state changes with the interactive key)',
    footprint: 'SW-4P',
    keywords: ['limit switch', 'position switch', 'end stop', 'roller lever', '1no 1nc', 'interactive'],
  },
  { vi: "Công tắc hành trình cần con lăn có một tiếp điểm thường hở (13-14) và một thường đóng (21-22) đổi trạng thái cùng lúc khi cần bị ấn; phím 'K' ấn cần khi mô phỏng", nameVi: 'Công tắc hành trình 1 hở + 1 đóng', sortKey: 50, series: 'Limit switch' },
);

// ---------------------------------------------------------------------------------------------
// thermal overload relay

const OVERLOAD_CLASS_OPTIONS = (Object.keys(OVERLOAD_CLASSES) as OverloadClass[]).map((c) => [c, `Class ${c} (${OVERLOAD_CLASSES[c]} s at 7.2 × Ir)`] as [string, string]);

interface OverloadElements {
  els: ElementIR[];
  heat: string;
  st: string;
}

/**
 * Bimetal model on the current sense sources `senses` (one per pole): heat' = (mean I²/Ir² − heat)/τ,
 * a latch that sets at heat ≥ 1.2 and clears with the reset source, and the state node `stNode`.
 */
function overloadModel(ctx: ToSpiceContext, senses: string[], ir: number, cls: OverloadClass, reset: boolean, stNode: string): OverloadElements {
  const heat = internalNode(ctx, 'heat');
  const lat = internalNode(ctx, 'lat');
  const rst = internalNode(ctx, 'rst');
  const sum = senses.map((s) => `I(${s})*I(${s})`).join('+');
  return {
    heat,
    st: stNode,
    els: [
      // from t = 0: a cold relay, the operating point carries no thermal history
      elB(ctx.name('B', 'olheat'), '0', heat, 'I', `u(time)*(${sum})/${ex(senses.length * ir * ir)}`),
      elR(ctx.name('R', 'olheat'), heat, '0', 1),
      elC(ctx.name('C', 'olheat'), heat, '0', overloadTau(cls)),
      elV(ctx.name('V', 'olrst'), rst, '0', { dc: reset ? 1 : 0 }),
      elR(ctx.name('R', 'olrst'), rst, '0', 1e9),
      elB(ctx.name('B', 'ollat'), '0', lat, 'I', `1000*0.5*(1+tanh(400*(V(${heat})-${OVERLOAD_TRIP_LEVEL})))*(1-V(${lat}))-1000*V(${lat})*V(${rst})`),
      elC(ctx.name('C', 'ollat'), lat, '0', 1),
      elR(ctx.name('R', 'ollat'), lat, '0', 1e9),
      elB(ctx.name('B', 'olst'), stNode, '0', 'V', `limit(V(${lat}),0,1)`),
    ],
  };
}

const overloadParams = (): ParamDef[] => [
  numParam('ir', 'Current setting', '6', 'A', { min: 0, showOnSchematic: true, help: 'Dial setting Ir: no trip up to 1.05 × Ir, trip at 1.2 × Ir after the thermal lag' }),
  selectParam('class', 'Trip class', '10', OVERLOAD_CLASS_OPTIONS, { help: 'Class 10A / 10 / 20 / 30: how long a cold relay takes to trip at 7.2 × Ir (a motor start with long run-up needs class 20 or 30)' }),
  boolParam('reset', 'Reset', false, { group: 'advanced', help: "Clears a tripped relay (key 'R' while the simulation runs)" }),
  keyParam('R'),
];

function overloadPart(poles: 1 | 3): LibraryPartDef {
  // one pole: a horizontal 2-pin part; three poles: three columns side by side
  const xs = poles === 1 ? [0] : [-40, 0, 40];
  const heaterV = (x: number): SymbolPrim[] => [line(x, -30, x, -14), line(x, 14, x, 30), rect(x - 8, -14, 16, 28), arc(x, 0, 5, 0, 300)];
  const heaterH: SymbolPrim[] = [line(-30, 0, -14, 0), line(14, 0, 30, 0), rect(-14, -8, 28, 16), arc(0, 0, 5, 0, 300)];
  const pins: PinDef[] = [];
  if (poles === 1) pins.push(pin('L1', -30, 0, 'left', { number: '1' }), pin('T1', 30, 0, 'right', { number: '2' }));
  else xs.forEach((x, k) => pins.push(pin(`L${k + 1}`, x, -30, 'up', { number: `${2 * k + 1}` }), pin(`T${k + 1}`, x, 30, 'down', { number: `${2 * k + 2}` })));
  return withMeta(
    {
      id: `electromechanical/overload-relay-${poles}p`,
      name: poles === 1 ? 'Thermal Overload Relay 1P' : 'Thermal Overload Relay 3P',
      group: 'electromechanical',
      family: 'Overload relay',
      description: `Thermal overload relay (${poles} pole${poles > 1 ? 's' : ''}) for motor protection: the bimetal heats with I²/Ir² and trips at 1.2 × the setting, after a time that depends on the trip class (class 10: 7 s at 7.2 × Ir). The trip latches until Reset (key R). Its 95-96 / 97-98 contacts are separate parts that name this relay (default FR1) in their "coil" parameter`,
      prefix: 'FR',
      symbol: poles === 1 ? makeSymbol([...heaterH, text(0, -14, 'FR', 8, 'middle', true)], pins, { refPos: { x: 0, y: -26 }, valuePos: { x: 0, y: 26 } }) : makeSymbol([...xs.flatMap(heaterV), text(0, 46, 'FR', 8, 'middle', true)], pins, { refPos: { x: 0, y: -42 }, valuePos: { x: 0, y: 62 } }),
      params: overloadParams(),
      contactLink: { role: 'driver' },
      tripCurve: { kind: 'overload', ratedParam: 'ir', curveParam: 'class' },
      interactive: { kind: 'momentary', param: 'reset', label: 'Reset', key: 'R' },
      optionalPins: pins.map((p) => p.name),
      toSpice: (ctx) => {
        const ir = pos(ctx, 'ir');
        const cls = (ctx.params.class ?? '10') as OverloadClass;
        if (!(cls in OVERLOAD_CLASSES)) throw new Error('bad value for class: choose 10A, 10, 20 or 30');
        const senses = xs.map((_, k) => ctx.name('V', `p${k + 1}`));
        const els: ElementIR[] = xs.map((_, k) => elSense(senses[k], ctx.node(`L${k + 1}`), ctx.node(`T${k + 1}`)));
        const m = overloadModel(ctx, senses, ir, cls, boolOf(ctx, 'reset'), internalNode(ctx, 'st'));
        return { elements: [...els, ...m.els] };
      },
      provenance: 'MachSim bimetal model after IEC 60947-4-1 (no trip at 1.05 Ir, trip at 1.2 Ir, class trip times at 7.2 Ir): heat = ∫(I²/Ir²) through a lag set by the trip class',
      footprint: 'DIN-RAIL',
      keywords: ['overload relay', 'thermal relay', 'motor protection', 'bimetal', 'trip class', 'class 10'],
    },
    {
      vi: `Rơ-le nhiệt bảo vệ quá tải động cơ (${poles} cực): tấm lưỡng kim nóng lên theo I²/Ir² và tác động ở 1.2 lần dòng đặt sau một thời gian phụ thuộc cấp tác động (cấp 10: 7 s ở 7.2 × Ir). Tác động được giữ cho tới khi Reset (phím R). Tiếp điểm 95-96 / 97-98 là linh kiện riêng, gọi tên rơ-le này (mặc định FR1) trong tham số "Cuộn hút"`,
      nameVi: `Rơ-le nhiệt ${poles} cực`,
      specs: { poles },
      sortKey: poles,
      series: 'Overload relay',
    },
  );
}

const overloads: LibraryPartDef[] = [overloadPart(1), overloadPart(3)];

// ---------------------------------------------------------------------------------------------
// direct-on-line motor starter

const STARTER_SYMBOL: SymbolDef = boxSymbol({
  w: 100,
  h: 80,
  left: [{ name: 'A1', number: 'A1' }, { name: 'L1', number: '1' }, { name: 'L2', number: '3' }, { name: 'L3', number: '5' }],
  right: [{ name: 'A2', number: 'A2' }, { name: 'T1', number: '2' }, { name: 'T2', number: '4' }, { name: 'T3', number: '6' }],
  top: [{ name: '13', number: '13' }, { name: '95', number: '95' }],
  bottom: [{ name: '14', number: '14' }, { name: '96', number: '96' }],
  title: 'DOL',
  titleSize: 9,
  titlePos: { x: 0, y: -24 },
  extra: [text(0, 8, 'KM + FR', 8)],
});

const starter: LibraryPartDef = withMeta(
  {
    id: 'electromechanical/motor-starter-dol',
    name: 'Motor Starter DOL',
    group: 'electromechanical',
    family: 'Motor starter',
    description: 'Direct-on-line motor starter in one part: a contactor (coil A1-A2, three power poles L1-T1 … L3-T3, auxiliary contact 13-14) with a three-pole thermal overload relay in the motor leads and its normally closed contact 95-96. The overload trip latches; the 95-96 contact opens and, wired in series with the coil, drops the contactor. Its coil designator (KM1) can be named by extra contacts',
    prefix: 'KM',
    symbol: STARTER_SYMBOL,
    params: [
      numParam('vcoil', 'Nominal coil voltage', '24', 'V', { min: 0 }),
      numParam('rcoil', 'Coil resistance', '82', 'Ω', { min: 0 }),
      numParam('ir', 'Overload setting', '6', 'A', { min: 0, showOnSchematic: true }),
      selectParam('class', 'Trip class', '10', OVERLOAD_CLASS_OPTIONS),
      boolParam('reset', 'Reset', false, { group: 'advanced', help: "Clears a tripped overload (key 'R' while the simulation runs)" }),
      keyParam('R'),
    ],
    contactLink: { role: 'driver' },
    interactive: { kind: 'momentary', param: 'reset', label: 'Reset', key: 'R' },
    optionalPins: ['L1', 'L2', 'L3', 'T1', 'T2', 'T3', '13', '14', '95', '96'],
    toSpice: (ctx) => {
      const r = pos(ctx, 'rcoil');
      const ir = pos(ctx, 'ir');
      const cls = (ctx.params.class ?? '10') as OverloadClass;
      if (!(cls in OVERLOAD_CLASSES)) throw new Error('bad value for class: choose 10A, 10, 20 or 30');
      const c = coil(ctx, ctx.node('A1'), ctx.node('A2'), r, 0.02 * r, pos(ctx, 'vcoil') / r);
      const m = contactModels(0.05, 1e9);
      const models: ModelCard[] = [m.no, m.nc];
      const els: ElementIR[] = [...c.els, stateFollowsLevel(ctx, c.level)];
      const senses: string[] = [];
      (['1', '2', '3'] as const).forEach((k) => {
        const mid = internalNode(ctx, `m${k}`);
        const sense = ctx.name('V', `p${k}`);
        senses.push(sense);
        els.push(elS(ctx.name('S', `no${k}`), ctx.node(`L${k}`), mid, c.level, '0', m.no.name), elSense(sense, mid, ctx.node(`T${k}`)));
      });
      els.push(elS(ctx.name('S', 'aux'), ctx.node('13'), ctx.node('14'), c.level, '0', m.no.name));
      const ol = overloadModel(ctx, senses, ir, cls, boolOf(ctx, 'reset'), internalNode(ctx, 'ol'));
      els.push(...ol.els, { ...elS(ctx.name('S', 'trip'), ctx.node('95'), ctx.node('96'), '0', ol.st, m.nc.name), params: { on: 1 } });
      return { elements: els, models };
    },
    provenance: 'MachSim starter: contactor coil model of electromech.ts, three SW power poles, three-pole bimetal model of the overload relay (IEC 60947-4-1 trip classes)',
    footprint: 'DIN-RAIL',
    keywords: ['motor starter', 'dol', 'direct on line', 'contactor', 'overload relay', 'start stop', 'motor control'],
  },
  { vi: 'Khởi động từ trực tiếp (DOL) trong một linh kiện: công-tắc-tơ (cuộn A1-A2, ba cực lực L1-T1 … L3-T3, tiếp điểm phụ 13-14) cùng rơ-le nhiệt ba cực trên dây ra động cơ và tiếp điểm thường đóng 95-96. Rơ-le nhiệt tác động được giữ; tiếp điểm 95-96 mở, mắc nối tiếp với cuộn thì nhả công-tắc-tơ. Có thể thêm tiếp điểm phụ gọi tên cuộn (KM1)', nameVi: 'Khởi động từ trực tiếp (DOL)', sortKey: 1, series: 'Motor starter' },
);

export const RELAY_CATALOG: LibraryPartDef[] = [...dcCoils, ...acCoils, ...timerCoils, ...contactParts, limitSwitch2, ...overloads, starter];
