/**
 * Resolve instrument `SignalRef`s against simulation output.
 *
 * - Voltage refs: V(pos) - V(neg); ground ("0" / "gnd") reads 0.
 * - Current refs: I(element).
 * Vector lookups are case-insensitive. Missing vectors yield NaN samples (transient) or
 * `null` (analysis results) so panels can say "not connected" instead of showing zeros.
 *
 * `pushTransientChunk` is the one call the integration layer needs to feed a stream.
 */

import type { InstrumentBinding, SignalRef } from '../../model/types';
import type { TransientChunk } from '../../sim/api';
import { isGroundNode } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import type { InstrumentStream } from './types';

/** Simulator vector names a signal depends on (ground nodes omitted). */
export function signalVectorNames(ref: SignalRef): string[] {
  if (ref.kind === 'current') return [`I(${ref.element})`];
  const out: string[] = [];
  if (!isGroundNode(ref.pos)) out.push(`V(${ref.pos})`);
  if (!isGroundNode(ref.neg)) out.push(`V(${ref.neg})`);
  return out;
}

/** Short human label for a signal: "V(out)", "V(a,b)", "I(Vsense)". */
export function signalLabel(ref: SignalRef): string {
  if (ref.kind === 'current') return `I(${ref.element})`;
  if (isGroundNode(ref.neg)) return `V(${ref.pos})`;
  if (isGroundNode(ref.pos)) return `-V(${ref.neg})`;
  return `V(${ref.pos},${ref.neg})`;
}

function lookup<T>(map: Record<string, T>, name: string): T | undefined {
  if (name in map) return map[name];
  const key = name.toLowerCase();
  for (const k in map) if (k.toLowerCase() === key) return map[k];
  return undefined;
}

/** Samples of a signal in a transient chunk (NaN-filled when a vector is missing). */
export function chunkSignal(chunk: TransientChunk, ref: SignalRef): Float64Array {
  const n = chunk.time.length;
  const out = new Float64Array(n);
  if (ref.kind === 'current') {
    const v = lookup(chunk.vectors, `I(${ref.element})`);
    if (!v) out.fill(Number.NaN);
    else out.set(v.subarray(0, n));
    return out;
  }
  const p = isGroundNode(ref.pos) ? null : lookup(chunk.vectors, `V(${ref.pos})`);
  const m = isGroundNode(ref.neg) ? null : lookup(chunk.vectors, `V(${ref.neg})`);
  if ((!isGroundNode(ref.pos) && !p) || (!isGroundNode(ref.neg) && !m)) {
    out.fill(Number.NaN);
    return out;
  }
  for (let i = 0; i < n; i++) out[i] = (p ? p[i] : 0) - (m ? m[i] : 0);
  return out;
}

/** Append every channel of `binding` from a transient chunk to `stream`. */
export function pushTransientChunk(stream: InstrumentStream, binding: InstrumentBinding, chunk: TransientChunk): void {
  if (!chunk.time.length) return;
  const values: Record<string, Float64Array> = {};
  for (const [name, ref] of Object.entries(binding.channels)) values[name] = chunkSignal(chunk, ref);
  stream.pushBlock(chunk.time, values);
}

/** Complex samples (imag = zeros for real results) of a signal in an analysis result. */
export interface ComplexSeries {
  re: Float64Array;
  im: Float64Array;
}

function resultVector(result: AnalysisResult, name: string) {
  const key = name.toLowerCase();
  return result.vectors.find((v) => v.name.toLowerCase() === key);
}

/** Signal of an analysis result (e.g. AC phasors), or null when a vector is missing. */
export function resultSignal(result: AnalysisResult, ref: SignalRef): ComplexSeries | null {
  const len = result.scale?.re.length ?? result.vectors[0]?.re.length ?? 0;
  const get = (name: string): ComplexSeries | null => {
    const v = resultVector(result, name);
    if (!v) return null;
    return { re: v.re, im: v.im ?? new Float64Array(v.re.length) };
  };
  if (ref.kind === 'current') return get(`I(${ref.element})`);
  const p = isGroundNode(ref.pos) ? null : get(`V(${ref.pos})`);
  const m = isGroundNode(ref.neg) ? null : get(`V(${ref.neg})`);
  if ((!isGroundNode(ref.pos) && !p) || (!isGroundNode(ref.neg) && !m)) return null;
  const n = p?.re.length ?? m?.re.length ?? len;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = (p ? p.re[i] : 0) - (m ? m.re[i] : 0);
    im[i] = (p ? p.im[i] : 0) - (m ? m.im[i] : 0);
  }
  return { re, im };
}

/** Channel ref of a binding by key (case-insensitive). */
export function bindingChannel(binding: InstrumentBinding, key: string): SignalRef | undefined {
  return lookup(binding.channels, key);
}
