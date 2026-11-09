/**
 * Toolkit of the digital catalogue (TTL, CMOS, misc-digital, mixed, digital indicators and
 * sources): logic families, code-model cards, hidden power pins, IC bodies and IEEE
 * distinctive-shape gate symbols. Every symbol is original line-art drawn from primitives.
 *
 * Logic families (typical datasheet figures at 25 °C, CL ≈ 15 pF for TTL, 50 pF for 4000B)
 *   TTL family param 'family': LS (default), STD, S, F, ALS, AS, HC, HCT, AC, ACT — output levels /
 *   resistances, input threshold and loading, gate delay and edge times (FAMILIES), plus the
 *   worst-case / typical delay ratio used by the "max" timing setting. Each part scales the gate
 *   delay by its own factor (flip-flop clock-to-output, counter, decoder ... paths).
 *   4000-series CMOS: VDD param (3..18 V, default 5 V). Levels are 0 / VDD, threshold VDD/2,
 *   output resistance, delays and edge times scale with VDD (cmosLevels()).
 *
 * Hidden power pins
 *   Multi-gate ICs do not draw VCC / GND (TTL) or VDD / VSS (CMOS) pins. Their code models use
 *   the supply convention of src/sim/devices/digital/core.ts:
 *   - param 'power' = auto (default): when the design has a net with the name in param
 *     'vccnet' (TTL, default "VCC") / 'vddnet' (CMOS, default "VDD") — a supply symbol or a net
 *     label — the IC is powered from that net (pwr = 2: output high level tracks the net,
 *     output current is drawn from it, CMOS thresholds scale with it) and its ground pin is
 *     node 0;
 *   - otherwise (or power = ideal) it runs at the family's nominal levels referenced to node 0
 *     (pwr = 1), so a schematic without supply symbols still simulates.
 *   The quiescent supply current of the logic itself is not modelled.
 *
 * Digital simulation settings (Design.digital, handed to toSpice as ToSpiceContextExt.digital)
 *   mode 'ideal' ignores supply nets and uses ideal levels (levelsFor / idealizeLevels); mode
 *   'real' makes a missing supply net an ERC error (PartErcError 'digitalNoPower'); timing 'max'
 *   multiplies delays by the family's worst-case ratio, 'zero' removes them.
 */
import type { ElementIR, ModelCard } from '../../../sim/netlist';
import { card, hash8, selectParam, textParam, numParam, PartErcError, type LibraryPartDef, type ToSpiceContextExt } from '../../partkit';
import type { DigitalSimSettings } from '../../../model/types';
import { arc, circle, line, makeSymbol, path, pin, poly, rect, text } from '../../symbols';
import type { ParamDef, PinDef, PinType, SymbolDef, SymbolPrim, ToSpiceContext } from '../../types';

// ---------------------------------------------------------------------------------------------
// families

export type TtlFamily = 'LS' | 'STD' | 'S' | 'F' | 'ALS' | 'AS' | 'HC' | 'HCT' | 'AC' | 'ACT';

export interface FamilyLevels {
  /** output low / high level without load (V) */
  vol: number;
  voh: number;
  /** nominal supply (V) */
  vnom: number;
  /** output resistance low / high (Ω) */
  rlow: number;
  rhigh: number;
  /** input switching threshold (V) */
  vth: number;
  /** input resistance to vin_float (Ω) */
  rin: number;
  vin_float: number;
  /** thresholds scale with the supply (CMOS input structure) */
  thresh_scale: number;
  /** gate propagation delay low->high / high->low (s) */
  tplh: number;
  tphl: number;
  /** output 0-100 % rise / fall time (s) */
  tr: number;
  tf: number;
  /** worst-case / typical propagation delay ratio (timing setting "max"; default 2) */
  maxFactor?: number;
}

/**
 * TTL-pinout families. Input model: rin to vin_float reproduces the low-level input current
 * IIL at 0.4 V and makes an open input read high. Output resistances from VOL @ IOL and the
 * short-circuit current. Values are typical public datasheet figures.
 */
export const FAMILIES: Record<TtlFamily, FamilyLevels & { label: string; maxFactor: number }> = {
  STD: { label: '74 (standard TTL)', vol: 0.2, voh: 3.4, vnom: 5, rlow: 12, rhigh: 130, vth: 1.4, rin: 875, vin_float: 1.8, thresh_scale: 0, tplh: 11e-9, tphl: 7e-9, tr: 10e-9, tf: 5e-9, maxFactor: 2 },
  LS: { label: '74LS (low-power Schottky)', vol: 0.25, voh: 3.4, vnom: 5, rlow: 15, rhigh: 70, vth: 1.3, rin: 3500, vin_float: 1.8, thresh_scale: 0, tplh: 9e-9, tphl: 10e-9, tr: 6e-9, tf: 4e-9, maxFactor: 1.6 },
  S: { label: '74S (Schottky)', vol: 0.2, voh: 3.4, vnom: 5, rlow: 10, rhigh: 40, vth: 1.4, rin: 700, vin_float: 1.8, thresh_scale: 0, tplh: 3e-9, tphl: 3e-9, tr: 3e-9, tf: 2e-9, maxFactor: 1.6 },
  F: { label: '74F (FAST Schottky)', vol: 0.2, voh: 3.4, vnom: 5, rlow: 10, rhigh: 45, vth: 1.5, rin: 2330, vin_float: 1.8, thresh_scale: 0, tplh: 3.7e-9, tphl: 3.2e-9, tr: 2.5e-9, tf: 2e-9, maxFactor: 1.5 },
  ALS: { label: '74ALS (advanced low-power Schottky)', vol: 0.25, voh: 3.4, vnom: 5, rlow: 15, rhigh: 60, vth: 1.4, rin: 14000, vin_float: 1.8, thresh_scale: 0, tplh: 5e-9, tphl: 5e-9, tr: 4e-9, tf: 3e-9, maxFactor: 2.2 },
  AS: { label: '74AS (advanced Schottky)', vol: 0.25, voh: 3.4, vnom: 5, rlow: 8, rhigh: 35, vth: 1.5, rin: 2800, vin_float: 1.8, thresh_scale: 0, tplh: 1.7e-9, tphl: 1.6e-9, tr: 1.5e-9, tf: 1.2e-9, maxFactor: 2.5 },
  HC: { label: '74HC (high-speed CMOS)', vol: 0, voh: 5, vnom: 5, rlow: 50, rhigh: 50, vth: 2.5, rin: 1e12, vin_float: 0, thresh_scale: 1, tplh: 8e-9, tphl: 8e-9, tr: 6e-9, tf: 6e-9, maxFactor: 2.4 },
  HCT: { label: '74HCT (CMOS, TTL inputs)', vol: 0, voh: 5, vnom: 5, rlow: 50, rhigh: 50, vth: 1.4, rin: 1e12, vin_float: 0, thresh_scale: 0, tplh: 10e-9, tphl: 10e-9, tr: 6e-9, tf: 6e-9, maxFactor: 2.4 },
  AC: { label: '74AC (advanced CMOS)', vol: 0, voh: 5, vnom: 5, rlow: 12, rhigh: 14, vth: 2.5, rin: 1e12, vin_float: 0, thresh_scale: 1, tplh: 5e-9, tphl: 4.5e-9, tr: 2e-9, tf: 2e-9, maxFactor: 1.8 },
  ACT: { label: '74ACT (advanced CMOS, TTL inputs)', vol: 0, voh: 5, vnom: 5, rlow: 12, rhigh: 14, vth: 1.4, rin: 1e12, vin_float: 0, thresh_scale: 0, tplh: 6e-9, tphl: 5.5e-9, tr: 2e-9, tf: 2e-9, maxFactor: 1.8 },
};

/** CMOS families of the 74 series (in the CMOS group of the library). */
export const CMOS74_FAMILIES: readonly TtlFamily[] = ['HC', 'HCT', 'AC', 'ACT'];

export const TTL_FAMILY_KEYS = Object.keys(FAMILIES) as TtlFamily[];

/** Delay / edge scale factor of 4000B CMOS at VDD (1 at 5 V, 0.5 at 10 V, 0.4 at 15 V). */
export function cmosSpeedFactor(vdd: number): number {
  const v = Math.min(18, Math.max(3, vdd));
  if (v <= 5) return 5 / v;
  if (v <= 10) return 1 - (0.5 * (v - 5)) / 5;
  return 0.5 - (0.1 * (v - 10)) / 5;
}

/**
 * 4000B-series levels at VDD: 0 / VDD outputs, threshold VDD/2 (scales with the supply),
 * output resistance ≈ 800 Ω·5/VDD (strong buffers 4049 / 4050: ≈ 110 Ω·5/VDD), gate delay
 * 60 ns and edges 100 ns at 5 V scaled by cmosSpeedFactor.
 */
export function cmosLevels(vdd: number, strong = false): FamilyLevels {
  const f = cmosSpeedFactor(vdd);
  const r = (strong ? 110 : 800) * (5 / vdd);
  return { vol: 0, voh: vdd, vnom: vdd, rlow: r, rhigh: r, vth: vdd / 2, rin: 1e12, vin_float: 0, thresh_scale: 1, tplh: 60e-9 * f, tphl: 60e-9 * f, tr: 100e-9 * f, tf: 100e-9 * f, maxFactor: 2 };
}

/** Digital simulation settings of the design (empty when the netlister did not pass any). */
export function digitalSettings(ctx: ToSpiceContext): DigitalSimSettings {
  return (ctx as ToSpiceContextExt).digital ?? {};
}

/**
 * Ideal-mode levels: outputs 0 / nominal supply through 10 Ω, threshold at half the supply, no
 * input current (a TTL-type input keeps reading high when it floats: 1 GΩ to the supply level).
 */
export function idealizeLevels(lv: FamilyLevels): FamilyLevels {
  const ttlInput = lv.vin_float > 0;
  return { ...lv, vol: 0, voh: lv.vnom, rlow: 10, rhigh: 10, vth: lv.vnom / 2, rin: ttlInput ? 1e9 : 1e12, vin_float: ttlInput ? lv.vnom : 0 };
}

/** Family levels with the design's digital settings applied (ideal mode, timing). */
export function levelsFor(ctx: ToSpiceContext, base: FamilyLevels): FamilyLevels {
  const st = digitalSettings(ctx);
  let lv = st.mode === 'ideal' ? idealizeLevels(base) : base;
  if (st.timing === 'max') {
    const f = base.maxFactor ?? 2;
    lv = { ...lv, tplh: lv.tplh * f, tphl: lv.tphl * f };
  } else if (st.timing === 'zero') lv = { ...lv, tplh: 0, tphl: 0 };
  return lv;
}

/** Ideal levels of the virtual (misc-digital) parts. */
export function idealLevels(vhigh: number, delay: number, threshold: number, rout = 10): FamilyLevels {
  return { vol: 0, voh: vhigh, vnom: vhigh, rlow: rout, rhigh: rout, vth: threshold, rin: 1e12, vin_float: 0, thresh_scale: 0, tplh: delay, tphl: delay, tr: 1e-9, tf: 1e-9 };
}

// ---------------------------------------------------------------------------------------------
// model cards

/** Stable JSON (sorted keys) for hashing. */
function stableNums(p: Record<string, number>): string {
  return Object.keys(p)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join(';');
}

/**
 * Code-model card for a family: levels + delays scaled by `delayFactor`, plus extra model
 * params. The name is "<base>_<hash of the parameters>", so equal cards share one name.
 */
export function familyModel(base: string, type: string, lv: FamilyLevels, delayFactor = 1, extra: Record<string, number> = {}): ModelCard {
  const params: Record<string, number> = {
    vol: lv.vol,
    voh: lv.voh,
    vnom: lv.vnom,
    rlow: lv.rlow,
    rhigh: lv.rhigh,
    vth: lv.vth,
    rin: lv.rin,
    vin_float: lv.vin_float,
    thresh_scale: lv.thresh_scale,
    rise_delay: lv.tplh * delayFactor,
    fall_delay: lv.tphl * delayFactor,
    rise_time: lv.tr,
    fall_time: lv.tf,
    ...extra,
  };
  return card(`${base}_${hash8(`${type};${stableNums(params)}`)}`, type, params);
}

// ---------------------------------------------------------------------------------------------
// power and elements

export interface PowerNodes {
  /** trailing supply nodes of every A element: [ref] or [vsup, ref] */
  nodes: string[];
  pwr: number;
}

/**
 * Supply nodes of an IC (see module header). The instance param power = ideal always wins; after
 * it the ERC option "hidden power pins" decides, which the netlister passes as
 * `ToSpiceContextExt.hiddenPower` ('auto' joins the named supply net when the design has one,
 * 'ideal' ignores supply nets, 'required' makes a missing net an ERC error). Without it the
 * design's digital mode decides, as before the option existed ('ideal' / 'real').
 */
export function powerNodes(ctx: ToSpiceContext, netKey: string, defaultNet: string): PowerNodes {
  if ((ctx.params.power ?? 'auto').trim().toLowerCase() === 'ideal') return { nodes: ['0'], pwr: 1 };
  const ext = ctx as ToSpiceContextExt;
  const digitalMode = digitalSettings(ctx).mode ?? 'auto';
  const mode = ext.hiddenPower ?? (digitalMode === 'ideal' ? 'ideal' : digitalMode === 'real' ? 'required' : 'auto');
  if (mode === 'ideal') return { nodes: ['0'], pwr: 1 };
  const name = (ctx.params[netKey] ?? defaultNet).trim() || defaultNet;
  const net = typeof ext.resolveNet === 'function' ? ext.resolveNet(name) : undefined;
  if (net === undefined || net === '0') {
    if (mode === 'required') throw new PartErcError(`the hidden supply pin needs a '${name}' net in real digital mode (place a ${name} power symbol or switch to ideal mode)`, 'digitalNoPower', { net: name });
    return { nodes: ['0'], pwr: 1 };
  }
  return { nodes: [net, '0'], pwr: 2 };
}

/** 'A' element: ports + supply nodes, model, numeric instance params (pwr added). */
export function aElement(name: string, ports: string[], power: PowerNodes, model: string, params: Record<string, number> = {}): ElementIR {
  return { type: 'A', name, nodes: [...ports, ...power.nodes], model, params: { ...params, pwr: power.pwr } };
}

/** Node of an optional pin: "null" (XSPICE NULL) when the pin is unconnected. */
export function optionalNode(ctx: ToSpiceContext, pinName: string): string {
  const ext = ctx as ToSpiceContextExt;
  if (typeof ext.connected === 'function' && !ext.connected(pinName)) return 'null';
  return ctx.node(pinName);
}

// ---------------------------------------------------------------------------------------------
// common parameters

export function familyParam(): ParamDef {
  return selectParam(
    'family',
    'Logic family',
    'LS',
    TTL_FAMILY_KEYS.map((k) => [k, FAMILIES[k].label] as [string, string]),
    { group: 'model', help: 'Output levels, input loading and timing of the selected 74xx family' },
  );
}

export function powerParams(netKey: 'vccnet' | 'vddnet', net: string): ParamDef[] {
  return [
    selectParam('power', 'Power pins', 'auto', [['auto', `Hidden pins on the ${net} net when it exists`], ['ideal', 'Ideal levels (ignore supply nets)']], {
      group: 'advanced',
      help: `Hidden supply pins: connected to the ${net} net (and ground) when the design has one; otherwise the part uses its nominal levels`,
    }),
    textParam(netKey, 'Supply net', net, { group: 'advanced', help: 'Net name of the hidden supply pin' }),
  ];
}

export function vddParam(): ParamDef {
  return numParam('vdd', 'VDD (nominal)', '5', 'V', { min: 3, max: 18, group: 'model', help: 'Supply voltage used for levels and timing (4000-series, 3..18 V)' });
}

/** Family of a TTL part instance. */
export function familyOf(ctx: ToSpiceContext): TtlFamily {
  const f = (ctx.params.family ?? 'LS').trim().toUpperCase() as TtlFamily;
  if (!(f in FAMILIES)) throw new Error(`bad value for family: '${ctx.params.family}'`);
  return f;
}

// ---------------------------------------------------------------------------------------------
// IC bodies

export interface IcPin {
  name: string;
  /** label inside the body (default: the name); '~' prefix marks an active-low pin */
  label?: string;
  /** physical pin number */
  number?: string;
  type?: PinType;
  /** draw a clock wedge */
  clock?: boolean;
}

export interface IcOpts {
  /** body width (multiple of 20, default 80) */
  w?: number;
  top?: IcPin[];
  bottom?: IcPin[];
  extra?: SymbolPrim[];
}

/**
 * Rectangular IC body: `left` / `right` slots 20 units apart from the top (null = gap),
 * 10-unit pin stubs, pin numbers above the stubs, title above the first row inside the body.
 */
export function icSymbol(title: string, left: (IcPin | null)[], right: (IcPin | null)[], o: IcOpts = {}): SymbolDef {
  const rows = Math.max(left.length, right.length, 1);
  const w = o.w ?? 80;
  const hw = w / 2;
  const y0 = -(rows - 1) * 10;
  const top = o.top ?? [];
  const bottom = o.bottom ?? [];
  const bodyTop = y0 - 30;
  const bodyBottom = y0 + 20 * (rows - 1) + 20;
  const prims: SymbolPrim[] = [rect(-hw, bodyTop, w, bodyBottom - bodyTop), text(0, bodyTop + 13, title, 9, 'middle', true)];
  const pins: PinDef[] = [];
  const add = (p: IcPin, x: number, y: number, dir: 'left' | 'right' | 'up' | 'down', bx: number, by: number) => {
    prims.push(line(x, y, bx, by));
    const label = p.label ?? p.name;
    pins.push(pin(p.name, x, y, dir, { label: label === '' ? undefined : label, type: p.type ?? 'input', number: p.number }));
    if (p.number) {
      if (dir === 'left' || dir === 'right') prims.push(text((x + bx) / 2, y - 2, p.number, 6, 'middle'));
      else prims.push(text(x + 3, (y + by) / 2 + 2, p.number, 6, 'start'));
    }
    if (p.clock) {
      if (dir === 'left') prims.push(poly([bx, by - 4, bx + 6, by, bx, by + 4]));
      else if (dir === 'right') prims.push(poly([bx, by - 4, bx - 6, by, bx, by + 4]));
      else if (dir === 'up') prims.push(poly([bx - 4, by, bx, by + 6, bx + 4, by]));
      else prims.push(poly([bx - 4, by, bx, by - 6, bx + 4, by]));
    }
  };
  left.forEach((p, i) => p && add(p, -hw - 10, y0 + 20 * i, 'left', -hw, y0 + 20 * i));
  right.forEach((p, i) => p && add(p, hw + 10, y0 + 20 * i, 'right', hw, y0 + 20 * i));
  const xs = (n: number) => Array.from({ length: n }, (_, i) => -(n - 1) * 10 + 20 * i);
  xs(top.length).forEach((x, i) => add(top[i], x, bodyTop - 10, 'up', x, bodyTop));
  xs(bottom.length).forEach((x, i) => add(bottom[i], x, bodyBottom + 10, 'down', x, bodyBottom));
  prims.push(...(o.extra ?? []));
  return makeSymbol(prims, pins, { refPos: { x: 0, y: bodyTop - (top.length ? 22 : 8) }, valuePos: { x: 0, y: bodyBottom + (bottom.length ? 30 : 16) } });
}

/** Output pin helper. */
export const out = (name: string, number?: string, label?: string): IcPin => ({ name, number, label, type: 'output' });
/** Input pin helper. */
export const inp = (name: string, number?: string, label?: string, clock = false): IcPin => ({ name, number, label, type: 'input', clock });

// ---------------------------------------------------------------------------------------------
// gate symbols (IEEE distinctive shapes, 40 x 40 body, inputs at x = -30)

export type GateShape = 'and' | 'or' | 'xor' | 'buf';

/** y positions of n inputs (20 apart, centred). */
export function gateInputYs(n: number): number[] {
  return Array.from({ length: n }, (_, i) => -(n - 1) * 10 + 20 * i);
}

/** x of the OR back curve at height y (quadratic from (-20,-20) via (-10,0) to (-20,20)). */
function orBackX(y: number, shift = 0): number {
  if (y <= -20 || y >= 20) return -20 + shift;
  const t = (y + 20) / 40;
  return -20 + 20 * t * (1 - t) + shift;
}

/**
 * Distinctive-shape gate: `n` inputs named by `names`, output 'Y' (bubble when `invert`).
 * AND: flat back + semicircle; OR: curved back and pointed nose; XOR: OR + extra back curve.
 */
export function gateSymbol(shape: Exclude<GateShape, 'buf'>, n: number, invert: boolean, names: string[] = []): SymbolDef {
  const ys = gateInputYs(n);
  const prims: SymbolPrim[] = [];
  const span = Math.max(20, ...ys.map((y) => Math.abs(y)));
  if (shape === 'and') {
    prims.push(line(-20, -20, 0, -20), line(-20, 20, 0, 20), line(-20, -span, -20, span), arc(0, 0, 20, 270, 450));
  } else {
    prims.push(path('M -20 -20 Q -10 0 -20 20'), path('M -20 -20 Q 5 -20 20 0'), path('M -20 20 Q 5 20 20 0'));
    if (span > 20) prims.push(line(-20, -span, -20, -20), line(-20, 20, -20, span));
    if (shape === 'xor') prims.push(path('M -25 -20 Q -15 0 -25 20'));
  }
  const pins: PinDef[] = [];
  ys.forEach((y, i) => {
    const end = shape === 'and' ? -20 : shape === 'xor' ? orBackX(y, -5) : orBackX(y);
    prims.push(line(-30, y, end, y));
    pins.push(pin(names[i] ?? String.fromCharCode(65 + i), -30, y, 'left', { type: 'input' }));
  });
  if (invert) {
    prims.push(circle(24, 0, 4), line(28, 0, 40, 0));
    pins.push(pin('Y', 40, 0, 'right', { type: 'output' }));
  } else {
    prims.push(line(20, 0, 30, 0));
    pins.push(pin('Y', 30, 0, 'right', { type: 'output' }));
  }
  return makeSymbol(prims, pins, { refPos: { x: 0, y: -span - 8 }, valuePos: { x: 0, y: span + 16 } });
}

/** Buffer / inverter triangle, optional Schmitt glyph and tri-state enable pin 'EN' on top. */
export function bufferSymbol(invert: boolean, o: { schmitt?: boolean; enable?: boolean; enableLabel?: string } = {}): SymbolDef {
  const prims: SymbolPrim[] = [poly([-15, -15, -15, 15, 15, 0], true), line(-30, 0, -15, 0)];
  const pins: PinDef[] = [pin('A', -30, 0, 'left', { type: 'input' })];
  if (invert) prims.push(circle(19, 0, 4), line(23, 0, 30, 0));
  else prims.push(line(15, 0, 30, 0));
  pins.push(pin('Y', 30, 0, 'right', { type: 'output' }));
  if (o.schmitt) prims.push(poly([-10, 4, -4, 4, -4, -4, 2, -4]), poly([-8, 4, -2, 4, -2, -4]));
  if (o.enable) {
    prims.push(line(0, -20, 0, -7.5));
    pins.push(pin('EN', 0, -20, 'up', { type: 'input', label: o.enableLabel }));
  }
  return makeSymbol(prims, pins, { refPos: { x: 0, y: -24 }, valuePos: { x: 0, y: 26 } });
}

// ---------------------------------------------------------------------------------------------
// displays

/** Seven-segment digit glyph inside a box centred at (cx, cy), digit height h. */
export function digitGlyph(cx: number, cy: number, h: number, dp = true): SymbolPrim[] {
  const w = h * 0.5;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const ym = cy;
  const y1 = cy + h / 2;
  const sk = h * 0.06;
  const segs: SymbolPrim[] = [
    line(x0 + sk, y0, x1 + sk, y0, 2),
    line(x1 + sk, y0, x1, ym, 2),
    line(x1, ym, x1 - sk, y1, 2),
    line(x0 - sk, y1, x1 - sk, y1, 2),
    line(x0, ym, x0 - sk, y1, 2),
    line(x0 + sk, y0, x0, ym, 2),
    line(x0, ym, x1, ym, 2),
  ];
  if (dp) segs.push(circle(x1 + 5, y1, 1.5, true));
  return segs;
}

/** Sum of 2^k over the elements of `bits` (helper for tests and display bindings). */
export function maskOf(bits: number[]): number {
  return bits.reduce((acc, b, k) => acc + (b ? 2 ** k : 0), 0);
}

/** Library part with the fields every digital IC shares. */
export function icPart(p: Omit<LibraryPartDef, 'prefix'> & { prefix?: string }): LibraryPartDef {
  return { prefix: 'U', ...p };
}
