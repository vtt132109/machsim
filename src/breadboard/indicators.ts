/**
 * Indicator levels from simulation values, for <BreadboardView indicatorLevels>.
 *
 * `indicatorLevels(bindings, values)` maps the netlister's IndicatorBinding list (LED, lamp,
 * buzzer, probe …) and a snapshot of simulation vectors (`TransientStepper.latest()` or one
 * sample of a result: "V(node)", "I(Vname)") to refdes → brightness 0..1:
 *   led     I / imax (param, default 20 mA), 0 when reverse biased or below the turn-on current
 *           ion (param; a leakage of nanoamps through an open switch must not make it glow)
 *   lamp    (|V| / vrated)^1.5
 *   buzzer  1 when V ≥ von (default 1.5 V)
 *   probe   1 when V ≥ threshold (default 2.5 V)
 *   others  |signal| clamped to 0..1
 */

import type { IndicatorBinding } from '../model/netlister';
import type { SignalRef } from '../model/types';
import { parseUserNumber } from '../util/units';

/** Value of a signal from a vector snapshot (case-insensitive names; node "0" is 0 V). */
export function signalValue(sig: SignalRef, values: Record<string, number>): number | undefined {
  const lower = new Map<string, number>();
  for (const [k, v] of Object.entries(values)) lower.set(k.toLowerCase(), v);
  const v = (node: string): number | undefined => (node === '0' ? 0 : lower.get(`v(${node.toLowerCase()})`));
  if (sig.kind === 'current') return lower.get(`i(${sig.element.toLowerCase()})`);
  const a = v(sig.pos);
  const b = v(sig.neg);
  return a === undefined || b === undefined ? undefined : a - b;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const param = (p: Record<string, string>, k: string, d: number) => {
  const v = parseUserNumber(p[k] ?? '');
  return Number.isFinite(v) && v !== 0 ? v : d;
};

export function indicatorLevels(bindings: readonly IndicatorBinding[], values: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bindings) {
    const s = signalValue(b.signal, values);
    if (s === undefined) continue;
    switch (b.kind) {
      case 'led': {
        const ion = parseUserNumber(b.params.ion ?? '');
        if (b.signal.kind === 'current') out[b.refdes] = Number.isFinite(ion) && s < ion ? 0 : clamp01(s / param(b.params, 'imax', 20e-3));
        else out[b.refdes] = clamp01((s - 1.6) / 1.0);
        break;
      }
      case 'lamp':
        out[b.refdes] = clamp01((Math.abs(s) / param(b.params, 'vrated', 12)) ** 1.5);
        break;
      case 'buzzer':
        out[b.refdes] = s >= param(b.params, 'von', 1.5) ? 1 : 0;
        break;
      case 'probe':
        out[b.refdes] = s >= param(b.params, 'threshold', 2.5) ? 1 : 0;
        break;
      default:
        out[b.refdes] = clamp01(Math.abs(s));
    }
  }
  return out;
}
