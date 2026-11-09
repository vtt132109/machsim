/**
 * Netlist modification for sweeps, Monte Carlo and worst-case analyses.
 *
 * Every modification works on a deep copy of the IR ({@link cloneNetlist}); the input netlist is
 * never mutated. A modification names
 *   - an element (case-insensitive; a flattened instance such as "R.X1.R3" may also be written
 *     "X1.R3") and a parameter:
 *       "value"                     primary value (R, C, L, K, E, F, G, H); DC value of V / I sources
 *       "dc", "acmag", "acphase"    independent-source fields (aliases "ac", "mag" for acmag)
 *       waveform parameter names    vo/offset, va/ampl, freq, td, v1, v2, tr, tf, pw, per, duty, ...
 *                                   (src/sim/waveforms.ts) of the source's transient waveform
 *       anything else              the numeric instance parameter params[key] (lower-case key)
 *   - or, with `model: true`, a model card (by name) and one of its parameters (lower-case key);
 *   - or the pseudo-target "temp" (when no element of that name exists): the circuit temperature
 *     options.temp in °C (the parameter name is ignored).
 * A string (unevaluated) expression stored for the same key is removed so the numeric value wins
 * if the netlist is flattened again.
 */
import type { ElementIR, ModelCard, Netlist } from '../netlist';
import { DEFAULT_OPTIONS } from '../netlist';
import { SimulationError } from '../results';
import { getWaveformParam, setWaveformParam } from '../waveforms';
import { formatNumber } from './format';

/** One parameter change. */
export interface Modification {
  /** Element name, model name (model: true) or "temp". */
  target: string;
  /** "value", a source field, a waveform parameter, an instance parameter or a model parameter. */
  param: string;
  model?: boolean;
  value: number;
}

/** Deep copy of a netlist IR. */
export function cloneNetlist(n: Netlist): Netlist {
  return structuredClone(n);
}

/** Element by (case-insensitive) name; "X1.R3" also finds the flattened "R.X1.R3". */
export function findElement(n: Netlist, name: string): ElementIR | undefined {
  const key = name.trim().toLowerCase();
  const exact = n.elements.find((e) => e.name.toLowerCase() === key);
  if (exact) return exact;
  const dot = key.lastIndexOf('.');
  if (dot > 0) {
    const local = key.slice(dot + 1);
    const flat = `${local.charAt(0)}.${key}`;
    return n.elements.find((e) => e.name.toLowerCase() === flat);
  }
  return undefined;
}

/** Model card by (case-insensitive) name. */
export function findModel(n: Netlist, name: string): ModelCard | undefined {
  const key = name.trim().toLowerCase();
  return n.models[key] ?? Object.values(n.models).find((m) => m.name.toLowerCase() === key);
}

function isTempTarget(n: Netlist, target: string, model?: boolean): boolean {
  return !model && target.trim().toLowerCase() === 'temp' && findElement(n, target) === undefined;
}

const SOURCE_AC_MAG = new Set(['acmag', 'ac', 'mag']);

/** Current value of a parameter, or undefined when the target / parameter does not exist. */
export function getParamValue(n: Netlist, target: string, param: string, model = false): number | undefined {
  const key = param.trim().toLowerCase();
  if (isTempTarget(n, target, model)) return n.options.temp ?? DEFAULT_OPTIONS.temp;
  if (model) {
    const card = findModel(n, target);
    const v = card?.params[key];
    return typeof v === 'number' ? v : undefined;
  }
  const el = findElement(n, target);
  if (!el) return undefined;
  if (el.type === 'V' || el.type === 'I') {
    const src = el.source ?? {};
    if (key === 'value' || key === 'dc') {
      const dc = src.dc ?? el.value;
      if (dc !== undefined) return dc;
      return src.tran ? undefined : 0;
    }
    if (SOURCE_AC_MAG.has(key)) return src.acMag ?? 0;
    if (key === 'acphase') return src.acPhase ?? 0;
    if (src.tran) {
      const w = getWaveformParam(src.tran, key);
      if (w !== undefined) return w;
    }
  } else if (key === 'value') {
    return el.value ?? el.params.value;
  }
  const v = el.params[key];
  return typeof v === 'number' ? v : undefined;
}

/** Apply one modification in place (throws SimulationError 'netlist' for unknown targets). */
export function setParamValue(n: Netlist, target: string, param: string, value: number, model = false): void {
  if (!Number.isFinite(value)) throw new SimulationError(`Cannot set ${paramLabel(target, param, model)} to ${value}`, 'netlist');
  const key = param.trim().toLowerCase();
  if (isTempTarget(n, target, model)) {
    n.options = { ...n.options, temp: value };
    return;
  }
  if (model) {
    const card = findModel(n, target);
    if (!card) throw new SimulationError(`Model '${target}' not found`, 'netlist');
    card.params[key] = value;
    if (card.stringParams) delete card.stringParams[key];
    return;
  }
  const el = findElement(n, target);
  if (!el) throw new SimulationError(`Element '${target}' not found`, 'netlist');
  const dropString = (k: string) => {
    if (el.stringParams) delete el.stringParams[k];
  };
  if (el.type === 'V' || el.type === 'I') {
    const src = (el.source = el.source ?? {});
    if (key === 'value' || key === 'dc') {
      src.dc = value;
      if (el.value !== undefined) el.value = value;
      dropString('value');
      dropString('dc');
      return;
    }
    if (SOURCE_AC_MAG.has(key)) {
      src.acMag = value;
      dropString('acmag');
      return;
    }
    if (key === 'acphase') {
      src.acPhase = value;
      dropString('acphase');
      return;
    }
    if (src.tran && setWaveformParam(src.tran, key, value)) return;
  } else if (key === 'value') {
    el.value = value;
    dropString('value');
    return;
  }
  el.params[key] = value;
  dropString(key);
}

/** Deep copy of `n` with every modification applied in order. */
export function modifyNetlist(n: Netlist, mods: readonly Modification[]): Netlist {
  const out = cloneNetlist(n);
  for (const m of mods) setParamValue(out, m.target, m.param, m.value, m.model);
  return out;
}

/** Deep copy of `n` at circuit temperature `tempC` (°C). */
export function withTemperature(n: Netlist, tempC: number): Netlist {
  const out = cloneNetlist(n);
  out.options = { ...out.options, temp: tempC };
  return out;
}

/** Deep copy of `n` recording the given output requests. */
export function withSaves(n: Netlist, saves: string[]): Netlist {
  const out = cloneNetlist(n);
  out.saves = saves.slice();
  return out;
}

/**
 * Display name of a swept / toleranced quantity: "R1" for an element value, "R1:tc1" for an
 * instance parameter, "QMOD:bf" for a model parameter, "temp" for the temperature.
 */
export function paramLabel(target: string, param: string, model?: boolean): string {
  const key = param.trim().toLowerCase();
  if (!model && target.trim().toLowerCase() === 'temp') return 'temp';
  if (!model && (key === 'value' || key === '')) return target;
  return `${target}:${key}`;
}

/** Label of one swept value, e.g. "R1=1000". */
export function valueLabel(target: string, param: string, model: boolean | undefined, value: number): string {
  return `${paramLabel(target, param, model)}=${formatNumber(value)}`;
}
