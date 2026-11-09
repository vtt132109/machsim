/**
 * Interactive simulation support: turn a parameter edit into TransientStepper.setParam calls.
 *
 * Interactive parts (switches, push buttons, potentiometers, variable C / L, LDR / thermistor
 * sliders, function generator settings ...) keep a constant topology, so rebuilding the netlist
 * after the edit yields the same elements with different values. `elementValueChanges(prev, next)`
 * compares two netlists and returns the setParam calls that turn `prev` into `next`:
 *   R C L E F G H K         primary value            -> param 'value'
 *   V I                     DC / AC values           -> 'dc', 'acmag', 'acphase'
 *                           transient waveform args  -> canonical waveform names
 *                             SIN vo va freq td theta phase · PULSE v1 v2 td tr tf pw per
 *                             EXP v1 v2 td1 tau1 td2 tau2 · SFFM vo va fc mdi fs · AM va vo mf fc td
 *   any element             numeric instance params  -> the param key (e.g. 'ic', 'w')
 * It returns null when the change cannot be applied in place (elements added / removed / renamed,
 * nodes, models, controls or expressions changed, waveform type or PWL table changed, model or
 * subcircuit definitions changed): the caller must restart the simulation with the new netlist.
 */

import type { ElementIR, Netlist, SourceSpec, WaveformType } from '../sim/netlist';
import { flattenNetlist } from '../sim/spice/flatten';

export interface ParamChange {
  element: string;
  param: string;
  value: number;
}

const WAVE_ARGS: Record<Exclude<WaveformType, 'PWL'>, string[]> = {
  SIN: ['vo', 'va', 'freq', 'td', 'theta', 'phase'],
  PULSE: ['v1', 'v2', 'td', 'tr', 'tf', 'pw', 'per'],
  EXP: ['v1', 'v2', 'td1', 'tau1', 'td2', 'tau2'],
  SFFM: ['vo', 'va', 'fc', 'mdi', 'fs'],
  AM: ['va', 'vo', 'mf', 'fc', 'td'],
};

const eqNum = (a: number | undefined, b: number | undefined): boolean => a === b || (a !== undefined && b !== undefined && Number.isNaN(a) && Number.isNaN(b));

function sameStructure(a: ElementIR, b: ElementIR): boolean {
  if (a.type !== b.type || a.name.toLowerCase() !== b.name.toLowerCase()) return false;
  if (a.nodes.length !== b.nodes.length || a.nodes.some((n, i) => n.toLowerCase() !== b.nodes[i].toLowerCase())) return false;
  if ((a.model ?? '').toLowerCase() !== (b.model ?? '').toLowerCase()) return false;
  if ((a.control ?? '').toLowerCase() !== (b.control ?? '').toLowerCase()) return false;
  if ((a.expr ?? '') !== (b.expr ?? '')) return false;
  if (JSON.stringify(a.inductors ?? []) !== JSON.stringify(b.inductors ?? [])) return false;
  if (JSON.stringify(a.stringParams ?? {}) !== JSON.stringify(b.stringParams ?? {})) return false;
  return true;
}

function sourceChanges(name: string, a: SourceSpec | undefined, b: SourceSpec | undefined, out: ParamChange[]): boolean {
  const sa = a ?? {};
  const sb = b ?? {};
  if (!eqNum(sa.dc, sb.dc)) {
    if (sb.dc === undefined) return false;
    out.push({ element: name, param: 'dc', value: sb.dc });
  }
  if (!eqNum(sa.acMag, sb.acMag)) out.push({ element: name, param: 'acmag', value: sb.acMag ?? 0 });
  if (!eqNum(sa.acPhase, sb.acPhase)) out.push({ element: name, param: 'acphase', value: sb.acPhase ?? 0 });
  if (JSON.stringify(sa.distof1) !== JSON.stringify(sb.distof1) || JSON.stringify(sa.distof2) !== JSON.stringify(sb.distof2)) return false;
  const ta = sa.tran;
  const tb = sb.tran;
  if (!ta && !tb) return true;
  if (!ta || !tb || ta.type !== tb.type || ta.args.length !== tb.args.length || !eqNum(ta.repeatFrom, tb.repeatFrom)) return false;
  if (tb.type === 'PWL') return ta.args.every((v, i) => eqNum(v, tb.args[i]));
  const names = WAVE_ARGS[tb.type];
  for (let i = 0; i < tb.args.length; i++) {
    if (eqNum(ta.args[i], tb.args[i])) continue;
    if (i >= names.length) return false;
    out.push({ element: name, param: names[i], value: tb.args[i] });
  }
  return true;
}

/**
 * setParam calls that turn `prev` into `next`, or null when a restart is required.
 *
 * Blocks: when the two netlists differ only inside subcircuits (a switch closed in ONE placed copy
 * of a block gives that copy its own subcircuit variant, so the X element's model name and the
 * subcircuit definitions change) the comparison is made again on the FLATTENED netlists, whose
 * element names ("R.XHB1.S1") do not depend on the variant names. The running engine was built
 * from the flattened previous netlist, so those names are the ones setParam needs.
 */
export function elementValueChanges(prev: Netlist, next: Netlist): ParamChange[] | null {
  const direct = flatChanges(prev, next);
  if (direct !== null) return direct;
  if (!prev.elements.some((e) => e.type === 'X') || !next.elements.some((e) => e.type === 'X')) return null;
  try {
    return flatChanges(flattenNetlist(prev), flattenNetlist(next));
  } catch {
    return null;
  }
}

function flatChanges(prev: Netlist, next: Netlist): ParamChange[] | null {
  if (prev.elements.length !== next.elements.length) return null;
  if (JSON.stringify(prev.models) !== JSON.stringify(next.models) || JSON.stringify(prev.subckts) !== JSON.stringify(next.subckts)) return null;
  if (JSON.stringify(prev.params) !== JSON.stringify(next.params)) return null;
  const out: ParamChange[] = [];
  for (let i = 0; i < next.elements.length; i++) {
    const a = prev.elements[i];
    const b = next.elements[i];
    if (!sameStructure(a, b)) return null;
    if (!eqNum(a.value, b.value)) {
      if (b.value === undefined) return null;
      out.push({ element: b.name, param: 'value', value: b.value });
    }
    const keys = new Set([...Object.keys(a.params), ...Object.keys(b.params)]);
    for (const k of keys) {
      if (eqNum(a.params[k], b.params[k])) continue;
      if (b.params[k] === undefined) return null;
      out.push({ element: b.name, param: k, value: b.params[k] });
    }
    if ((a.type === 'V' || a.type === 'I') && !sourceChanges(b.name, a.source, b.source, out)) return null;
  }
  return out;
}
