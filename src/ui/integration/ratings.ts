/**
 * Rated parts in the simulation layer (pure helpers for the controller): explain a burn-out to the
 * learner, find burn-outs in a streamed chunk, and derive the hot / burnt marks of the schematic.
 * The netlist side (stress nodes, burn-out switch) is src/model/ratings.ts.
 */
import type { TransientChunk } from '../../sim/api';
import { ratingStress, type BlowEvent, type RatingBinding } from '../../model/ratings';
import type { RatingState } from '../store/types';
import { chunkSignal } from '../instruments/signals';
import { formatEng } from '../../util/units';
import { t } from '../../i18n';

/** Stress ratio from which a part is marked hot. */
export const HOT_RATIO = 0.8;

const UNIT = { power: 'W', voltage: 'V', current: 'A' } as const;

/** What burnt out, why and how to avoid it (current language). */
export function ratingMessage(e: BlowEvent): string {
  const at = e.time !== undefined ? t('rating.at', { time: formatEng(e.time, 's', 3) }) : '';
  const head = t('rating.blown', {
    refdes: e.refdes,
    quantity: t(`rating.quantity.${e.kind}`),
    value: formatEng(e.value, UNIT[e.kind], 3),
    limit: formatEng(e.limit, UNIT[e.kind], 3),
    at,
  });
  return `${head} ${t(`rating.why.${e.kind}`)} ${t(`rating.fix.${e.kind}`)}`;
}

/**
 * First sample of a streamed chunk at which a part reaches its rating (ratio ≥ 1), or null.
 */
export function chunkBlow(b: RatingBinding, chunk: TransientChunk): BlowEvent | null {
  let best: BlowEvent | null = null;
  for (const term of b.terms) {
    const v = chunkSignal(chunk, term.signal);
    for (let i = 0; i < v.length; i++) {
      if (!(v[i] >= 1)) continue;
      const time = chunk.time[i];
      if (!best || (best.time ?? Infinity) > time) best = { refdes: b.refdes, partId: b.partId, blowSource: b.blowSource, kind: term.kind, ratio: v[i], value: v[i] * term.limit, limit: term.limit, time };
      break;
    }
  }
  return best;
}

/** Hot / burnt marks for the schematic from the newest values and the parts that burnt out. */
export function ratingStates(bindings: readonly RatingBinding[], values: Map<string, number>, blown: ReadonlyMap<string, BlowEvent>): Record<string, RatingState> {
  const out: Record<string, RatingState> = {};
  for (const b of bindings) {
    const e = blown.get(b.refdes);
    if (e) {
      out[b.refdes] = { state: 'blown', pct: Math.round(e.ratio * 100) };
      continue;
    }
    const s = ratingStress(b, values);
    if (s && s.ratio >= HOT_RATIO) out[b.refdes] = { state: 'hot', pct: Math.round(s.ratio * 100) };
  }
  return out;
}

/** Shallow equality of two rating-state maps (avoids store updates that change nothing). */
export function sameRatingStates(a: Record<string, RatingState>, b: Record<string, RatingState>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => b[k] && b[k].state === a[k].state && b[k].pct === a[k].pct);
}
