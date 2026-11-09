/**
 * Time–current curve of a protective device (breaker, I²t fuse, thermal overload relay) drawn in
 * the Properties panel from the formulas of the model itself (src/library/catalog/protection.ts,
 * relays.ts): log-log axes, current as a multiple of the rating, trip time in seconds, a marker at
 * a few currents. Loads on demand with the audio texts. It reads the instance parameters, so
 * changing the rating, the curve letter, the trip class or I²t redraws it at once.
 */
import { useMemo } from 'react';
import type { PartDef } from '../../library/types';
import { asLibraryPart } from '../../library/partkit';
import { BREAKER_CURVES, breakerTripTime, fuseMeltTime, type BreakerCurve } from '../../library/catalog/protection';
import { OVERLOAD_CLASSES, overloadTripTime, type OverloadClass } from '../../library/catalog/relays';
import type { PartInstance } from '../../model/types';
import { aut } from '../../i18n/audioText';
import { useLang } from '../../i18n/react';
import { formatEng, parseUserNumber } from '../../util/units';
import { defaultParams } from '../../library';

export interface CurvePoints {
  /** [multiple of the rating, seconds], ascending in the multiple */
  points: [number, number][];
  /** a vertical marker (magnetic trip, minimum melting current), as a multiple */
  marker?: number;
  /** multiple below which the device never trips */
  never: number;
  /** the time function, for the text under the plot */
  at: (m: number) => number;
}

const logspace = (a: number, b: number, n: number): number[] => Array.from({ length: n }, (_, k) => a * Math.pow(b / a, k / (n - 1)));

/** The curve of a protective part with the instance's values (pure; exported for the tests). */
export function curveOf(def: PartDef, params: Record<string, string>): CurvePoints | null {
  const tc = asLibraryPart(def).tripCurve;
  if (!tc) return null;
  const merged = { ...defaultParams(def), ...params };
  if (tc.kind === 'breaker') {
    const curve = (merged[tc.curveParam ?? 'curve'] ?? 'C') as BreakerCurve;
    if (!(curve in BREAKER_CURVES)) return null;
    const at = (m: number) => breakerTripTime(curve, m);
    const mag = BREAKER_CURVES[curve].mag;
    const pts: [number, number][] = [];
    for (const m of logspace(1.05, 60, 80)) if (Number.isFinite(at(m))) pts.push([m, at(m)]);
    return { points: pts, marker: mag, never: 1.3, at };
  }
  if (tc.kind === 'overload') {
    const cls = (merged[tc.curveParam ?? 'class'] ?? '10') as OverloadClass;
    if (!(cls in OVERLOAD_CLASSES)) return null;
    const at = (m: number) => overloadTripTime(cls, m);
    const pts: [number, number][] = [];
    for (const m of logspace(1.1, 12, 70)) if (Number.isFinite(at(m))) pts.push([m, at(m)]);
    return { points: pts, never: Math.sqrt(1.2), at };
  }
  const inom = parseUserNumber(merged[tc.ratedParam] ?? '1');
  const i2t = parseUserNumber(merged[tc.i2tParam ?? 'i2t'] ?? '1');
  const kmin = parseUserNumber(merged[tc.kminParam ?? 'kmin'] ?? '1.5');
  if (!(inom > 0 && i2t > 0 && kmin >= 1)) return null;
  const at = (m: number) => fuseMeltTime(m * inom, kmin * inom, i2t);
  const pts: [number, number][] = [];
  for (const m of logspace(kmin * 1.02, 200, 90)) if (Number.isFinite(at(m))) pts.push([m, at(m)]);
  return { points: pts, marker: kmin, never: kmin, at };
}

const W = 260;
const H = 170;
const PAD = { l: 40, r: 10, t: 10, b: 28 };

export function TripCurve({ def, inst }: { def: PartDef; inst: PartInstance }) {
  useLang();
  const curve = useMemo(() => curveOf(def, inst.params), [def, inst.params]);
  if (!curve || curve.points.length < 2) return null;
  const xs = curve.points.map((p) => p[0]);
  const ys = curve.points.map((p) => p[1]);
  const x0 = Math.log10(Math.min(...xs));
  const x1 = Math.log10(Math.max(...xs));
  const y0 = Math.floor(Math.log10(Math.min(...ys)));
  const y1 = Math.ceil(Math.log10(Math.max(...ys)));
  const px = (m: number) => PAD.l + ((Math.log10(m) - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
  const py = (s: number) => PAD.t + (1 - (Math.log10(s) - y0) / (y1 - y0 || 1)) * (H - PAD.t - PAD.b);
  const d = curve.points.map(([m, s], i) => `${i ? 'L' : 'M'}${px(m).toFixed(1)},${py(s).toFixed(1)}`).join(' ');
  const unit = inst.params[asLibraryPart(def).tripCurve?.ratedParam ?? 'in'] ?? '';
  const xTicks = [1, 2, 5, 10, 20, 50, 100].filter((m) => Math.log10(m) >= x0 - 1e-9 && Math.log10(m) <= x1 + 1e-9);
  const yTicks = Array.from({ length: y1 - y0 + 1 }, (_, k) => y0 + k);
  const sample = [2, 5, 10].map((m) => ({ m, t: curve.at(m) }));
  return (
    <figure className="ms-trip" aria-label={aut('tripTitle')}>
      <figcaption>{aut('tripTitle')}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={aut('tripTitle')}>
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke="var(--border)" />
        {xTicks.map((m) => (
          <g key={`x${m}`}>
            <line x1={px(m)} x2={px(m)} y1={PAD.t} y2={H - PAD.b} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={px(m)} y={H - PAD.b + 12} fontSize="8" textAnchor="middle" fill="var(--text-dim)">
              {m}×
            </text>
          </g>
        ))}
        {yTicks.map((k) => (
          <g key={`y${k}`}>
            <line x1={PAD.l} x2={W - PAD.r} y1={py(10 ** k)} y2={py(10 ** k)} stroke="var(--border)" strokeDasharray="2 3" />
            <text x={PAD.l - 4} y={py(10 ** k) + 3} fontSize="8" textAnchor="end" fill="var(--text-dim)">
              {formatEng(10 ** k, 's', 1).replace(/\s+/g, '')}
            </text>
          </g>
        ))}
        {curve.marker !== undefined && Math.log10(curve.marker) >= x0 && Math.log10(curve.marker) <= x1 ? <line x1={px(curve.marker)} x2={px(curve.marker)} y1={PAD.t} y2={H - PAD.b} stroke="var(--erc-warning)" strokeWidth="1.5" /> : null}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" />
        <text x={(PAD.l + W - PAD.r) / 2} y={H - 4} fontSize="8" textAnchor="middle" fill="var(--text-dim)">
          {aut('tripAxisX', { unit: `${unit || ''}`.trim() ? `${unit} A` : 'In' })}
        </text>
      </svg>
      <p className="ms-hint">
        {aut('tripNever', { m: Number(curve.never.toFixed(2)) })}
        {sample.map((s) => (Number.isFinite(s.t) ? ` · ${aut('tripAt', { m: s.m, t: formatEng(s.t, 's', 3) })}` : '')).join('')}
      </p>
      <p className="ms-hint">{aut('tripIntro')}</p>
    </figure>
  );
}
