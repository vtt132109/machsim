/**
 * Protective devices with a stated characteristic: a fuse defined by its melting energy I²t and an
 * adjustable circuit breaker with a selectable trip curve (B, C, D, K, Z), plus the pure formulas
 * behind them (the Help text and the tests quote the same numbers).
 *
 *   fuse I²t       pre-arcing energy: the accumulated ∫ max(I² − Imin², 0) dt reaches I²t → the fuse
 *                  opens and stays open. At a constant current I > Imin that takes
 *                  t = I²t / (I² − Imin²), which is ≈ I²t / I² for large overloads (the published
 *                  rule "melting time = I²t / I²") and infinite below Imin = k·In (default 1.5·In).
 *   breaker        thermal element (heat = I²/In² through a first-order lag τ = 10 s, trips at
 *                  1.3·In sustained, so t = τ·ln(m² / (m² − 1.3²)) for a multiple m = I/In > 1.3)
 *                  plus a magnetic trip at the curve's multiple of In (IEC 60898 bands: B 3–5·In,
 *                  C 5–10·In, D 10–20·In, K 8–14·In, Z 2–3·In; the model uses the middle of each).
 *   overload relay see relays.ts (thermal motor protection with trip classes)
 */
import type { ElementIR, ModelCard } from '../../sim/netlist';
import { boolOf, boolParam, elB, elC, elR, elS, elSense, ex, internalNode, keyParam, numParam, selectParam, swModel, type LibraryPartDef } from '../partkit';
import { circle, line, rect, twoPinH } from '../symbols';
import type { ToSpiceContext } from '../types';
import { tripElement } from './electromech';
import { eng, withMeta } from './kit';

// ---------------------------------------------------------------------------------------------
// pure formulas

/** Trip time (s) of an I²t fuse at a constant current; Infinity at or below the minimum melting current. */
export function fuseMeltTime(current: number, imin: number, i2t: number): number {
  const i = Math.abs(current);
  return i > imin ? i2t / (i * i - imin * imin) : Number.POSITIVE_INFINITY;
}

export type BreakerCurve = 'B' | 'C' | 'D' | 'K' | 'Z';

/** Instantaneous (magnetic) trip band and the multiple of In the model uses. */
export const BREAKER_CURVES: Record<BreakerCurve, { min: number; max: number; mag: number }> = {
  B: { min: 3, max: 5, mag: 4 },
  C: { min: 5, max: 10, mag: 7.5 },
  D: { min: 10, max: 20, mag: 15 },
  K: { min: 8, max: 14, mag: 11 },
  Z: { min: 2, max: 3, mag: 2.5 },
};

/** Thermal element: lag time constant (s) and the heat level (in In²) at which it trips. */
export const BREAKER_TAU = 10;
export const BREAKER_THERMAL = 1.3;

/**
 * Trip time (s) of the breaker model at a multiple m = I / In of its rating, from a cold start:
 * the magnetic release acts within about a millisecond at or above the curve's multiple; below it the
 * thermal element takes τ·ln(m² / (m² − 1.3²)); infinite when m ≤ 1.3.
 */
export function breakerTripTime(curve: BreakerCurve, multiple: number): number {
  if (multiple >= BREAKER_CURVES[curve].mag) return 1e-3;
  if (multiple <= BREAKER_THERMAL) return Number.POSITIVE_INFINITY;
  const m2 = multiple * multiple;
  return BREAKER_TAU * Math.log(m2 / (m2 - BREAKER_THERMAL * BREAKER_THERMAL));
}

/** Points (multiple of In, time s) of a breaker's trip curve, log-spaced: the data of the curve plot. */
export function breakerCurvePoints(curve: BreakerCurve, from = 1.05, to = 50, n = 60): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const m = from * Math.pow(to / from, k / (n - 1));
    const t = breakerTripTime(curve, m);
    if (Number.isFinite(t)) pts.push([m, t]);
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// shared latch

/**
 * An opening element between a and b that a stress expression opens for good: a switch of 10 µΩ
 * in series with `ron`; `stress` ≥ 1 opens it, and the stress rises by ≈ 0.5 once it is open (it
 * follows the voltage across the open contact) so the opened state stays consistent although the
 * current — and with it the stress — has gone.
 */
function latchOpen(ctx: ToSpiceContext, a: string, b: string, sense: string, extra: ElementIR[], stressTerm: string, ron: number): { els: ElementIR[]; model: ModelCard } {
  const m = internalNode(ctx, 'm');
  const c = internalNode(ctx, 'c');
  const stress = internalNode(ctx, 'stress');
  const model = swModel('MS_TRIP', 0, 1, 1e-5, 1e9);
  const vsw = `abs(V(${c},${b}))`;
  return {
    els: [
      elSense(sense, a, m),
      elR(ctx.name('R', 'cold'), m, c, ron),
      ...extra,
      elB(ctx.name('B', 'stress'), stress, '0', 'V', `${stressTerm}+u(time)*0.5*${vsw}/(${vsw}+0.001)`),
      { ...elS(ctx.name('S', 'trip'), c, b, '0', stress, model.name), params: { on: 1 } },
    ],
    model,
  };
}

// ---------------------------------------------------------------------------------------------
// fuse with I²t

const fuseI2t: LibraryPartDef = withMeta(
  {
    id: 'power/fuse-i2t',
    name: 'Fuse (I²t rating)',
    group: 'power',
    family: 'Fuse',
    description: 'Fuse defined by its melting energy I²t (A²s) and rated current: it melts when the accumulated I²t above the minimum melting current (1.5 × rated by default) reaches the rating, so a short circuit blows it in milliseconds and a mild overload takes much longer. Stays open once blown',
    prefix: 'F',
    symbol: twoPinH([rect(-14, -5, 28, 10), line(-20, 0, 20, 0), line(-8, -9, 8, -9)]),
    params: [
      numParam('in', 'Rated current', '1', 'A', { min: 0, showOnSchematic: true, help: 'Current the fuse carries for ever' }),
      numParam('i2t', 'Melting energy I²t', '1', 'A²s', { min: 0, help: 'Pre-arcing energy: ∫I²dt that melts the element (the datasheet value at 10 ms). At a large constant current the fuse blows after I²t / I²' }),
      numParam('kmin', 'Minimum melting current', '1.5', '× In', { group: 'advanced', min: 1, help: 'Below this multiple of the rated current the fuse never blows (1.5 is typical)' }),
    ],
    tripCurve: { kind: 'fuse', ratedParam: 'in', i2tParam: 'i2t', kminParam: 'kmin' },
    toSpice: (ctx) => {
      const inom = ctx.num('in');
      const i2t = ctx.num('i2t');
      const kmin = ctx.num('kmin');
      if (!(inom > 0)) throw new Error('bad value for in: must be > 0');
      if (!(i2t > 0)) throw new Error('bad value for i2t: must be > 0');
      if (!(kmin >= 1)) throw new Error('bad value for kmin: must be >= 1');
      const sense = ctx.name('V', 'sense');
      const acc = internalNode(ctx, 'acc');
      const imin = kmin * inom;
      const extra: ElementIR[] = [
        // acc' = max(I² − Imin², 0): the energy above the non-melting threshold, counted from t = 0
        // (the operating point carries no history: a fuse is never 'already blown' at the start)
        elB(ctx.name('B', 'acc'), '0', acc, 'I', `u(time)*max(I(${sense})*I(${sense})-${ex(imin * imin)},0)`),
        elC(ctx.name('C', 'acc'), acc, '0', 1),
        elR(ctx.name('R', 'acc'), acc, '0', 1e12),
      ];
      const t = latchOpen(ctx, ctx.node('1'), ctx.node('2'), sense, extra, `V(${acc})/${ex(i2t)}`, Math.max(1e-3, 0.05 / inom));
      return { elements: t.els, models: [t.model] };
    },
    provenance: 'MachSim fuse: pre-arcing energy model (published rule: melting time = I²t / I² for large overloads), minimum melting current k·In',
    footprint: 'FUSE-5X20',
    keywords: ['fuse', 'i2t', 'i²t', 'melting energy', 'pre-arcing', 'protection', 'short circuit'],
  },
  { vi: 'Cầu chì xác định bằng năng lượng nóng chảy I²t (A²s) và dòng định mức: chảy khi I²t tích luỹ trên dòng nóng chảy nhỏ nhất (mặc định 1.5 lần định mức) đạt giá trị đặt, nên ngắn mạch làm chảy sau vài mili-giây còn quá tải nhẹ phải lâu hơn nhiều. Chảy rồi thì giữ hở mạch', nameVi: 'Cầu chì (theo I²t)', sortKey: 5000, series: 'Fuse' },
);

// ---------------------------------------------------------------------------------------------
// breaker with a trip curve

const CURVE_OPTIONS = (Object.keys(BREAKER_CURVES) as BreakerCurve[]).map((c) => [c, `${c} (${BREAKER_CURVES[c].min}–${BREAKER_CURVES[c].max} × In)`] as [string, string]);

const BREAKER_SYMBOL = twoPinH([line(-20, 0, -14, 0), circle(-14, 0, 2), line(-13, -1, 12, -9), circle(14, 0, 2), line(14, 0, 20, 0), rect(-4, -16, 8, 6), line(0, -10, 0, -5)]);

const breakerAdjustable: LibraryPartDef = withMeta(
  {
    id: 'electromechanical/breaker-adjustable',
    name: 'Circuit Breaker (trip curve)',
    group: 'electromechanical',
    family: 'Protection',
    description: `Miniature circuit breaker with a selectable rated current and trip curve (B, C, D, K, Z): thermal trip on a sustained overload above 1.3·In (about ${eng(breakerTripTime('C', 2), 's', 3)} at 2·In) and a magnetic trip in about a millisecond at the curve's multiple of In. Key 'B' switches it by hand; the Properties panel draws its time–current curve`,
    prefix: 'Q',
    symbol: BREAKER_SYMBOL,
    params: [
      numParam('in', 'Rated current', '10', 'A', { min: 0, showOnSchematic: true }),
      selectParam('curve', 'Trip curve', 'C', CURVE_OPTIONS, { help: 'B for resistive loads, C for general use, D for motors and transformers (high inrush), K for motors, Z for sensitive electronics' }),
      boolParam('closed', 'Closed', true),
      keyParam('B'),
    ],
    interactive: { kind: 'toggle', param: 'closed', label: 'Toggle', key: 'B' },
    tripCurve: { kind: 'breaker', ratedParam: 'in', curveParam: 'curve' },
    toSpice: (ctx) => {
      const inom = ctx.num('in');
      if (!(inom > 0)) throw new Error('bad value for in: must be > 0');
      const curve = (ctx.params.curve ?? 'C') as BreakerCurve;
      const spec = BREAKER_CURVES[curve];
      if (!spec) throw new Error('bad value for curve: choose B, C, D, K or Z');
      const mid = internalNode(ctx, 'sw');
      const t = tripElement(ctx, ctx.node('1'), mid, inom, BREAKER_TAU, BREAKER_THERMAL, spec.mag, 2e-3, true);
      return { elements: [...t.els, elR(ctx.name('R', 'manual'), mid, ctx.node('2'), boolOf(ctx, 'closed') ? 1e-3 : 1e9)], models: [t.model] };
    },
    provenance: 'MachSim thermal-magnetic breaker with the IEC 60898 magnetic bands B 3–5, C 5–10, D 10–20 × In (K and Z from IEC 60947-2 practice); thermal lag τ = 10 s',
    footprint: 'DIN-RAIL',
    keywords: ['circuit breaker', 'mcb', 'trip curve', 'time-current', 'protection', 'overcurrent', 'b curve', 'c curve', 'd curve'],
  },
  { vi: "Áp-tô-mát tép chọn được dòng định mức và đường cong cắt (B, C, D, K, Z): cắt nhiệt khi quá tải kéo dài trên 1.3·In và cắt từ trong khoảng một mili-giây tại bội số của đường cong; phím 'B' bật / tắt bằng tay, bảng Thuộc tính vẽ đường cong thời gian – dòng điện", nameVi: 'Áp-tô-mát (đường cong cắt)', sortKey: 5000, series: 'MCB' },
);

export const PROTECTION_CATALOG: LibraryPartDef[] = [fuseI2t, breakerAdjustable];
