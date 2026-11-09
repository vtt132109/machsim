/**
 * Conventions for unevaluated expressions stored in ElementIR.stringParams, shared by the
 * parser (which stores them), flattenNetlist (which evaluates them) and the writer.
 *
 * Keys (lower-case) and the numeric field each one fills once evaluated:
 *   value                 el.value
 *   dc, acmag, acphase    el.source.dc / acMag / acPhase
 *   tran[i]               el.source.tran.args[i]   (args[i] holds NaN until evaluated)
 *   tran.r                el.source.tran.repeatFrom (PWL r=)
 *   tran.td               PWL time shift added to every time point (applied after tran[i])
 *   distof1[0|1], distof2[0|1]   el.source.distof1/2 [magnitude, phase]
 *   ports                 (A elements only) literal XSPICE port layout, never evaluated: the port
 *                         tokens with every node replaced by "#" ("~#" when inverted), e.g.
 *                         "A1 [a b] ~y and2" -> nodes [a, b, y], ports "[ # # ] ~#". Present only
 *                         when the port list has brackets, %modifiers or inversions.
 *   anything else         el.params[key]
 * For X (subcircuit) instances every entry is a parameter override expression.
 * Expression text is stored without surrounding braces.
 */

import type { ElementIR } from '../netlist';

export const LITERAL_ELEMENT_KEYS: ReadonlySet<string> = new Set(['ports']);

export const tranArgKey = (i: number): string => `tran[${i}]`;
export const distofKey = (which: 1 | 2, i: 0 | 1): string => `distof${which}[${i}]`;

const TRAN_ARG_RE = /^tran\[(\d+)\]$/;
const DISTOF_RE = /^distof([12])\[([01])\]$/;

function assign(el: ElementIR, key: string, value: number): void {
  if (key === 'value') {
    el.value = value;
    return;
  }
  if (key === 'dc' || key === 'acmag' || key === 'acphase') {
    el.source = el.source ?? {};
    if (key === 'dc') el.source.dc = value;
    else if (key === 'acmag') el.source.acMag = value;
    else el.source.acPhase = value;
    return;
  }
  const t = TRAN_ARG_RE.exec(key);
  if (t) {
    const tran = el.source?.tran;
    if (!tran) throw new Error(`'${key}' given but the source has no transient waveform`);
    tran.args[Number(t[1])] = value;
    return;
  }
  if (key === 'tran.r') {
    const tran = el.source?.tran;
    if (!tran) throw new Error("'tran.r' given but the source has no transient waveform");
    tran.repeatFrom = value;
    return;
  }
  const d = DISTOF_RE.exec(key);
  if (d) {
    el.source = el.source ?? {};
    const field = d[1] === '1' ? 'distof1' : 'distof2';
    const pair: [number, number] = el.source[field] ?? [0, 0];
    pair[Number(d[2])] = value;
    el.source[field] = pair;
    return;
  }
  el.params[key] = value;
}

/**
 * Evaluate every expression entry of `el.stringParams` with `evaluate` and store the numbers in
 * their fields (mutates `el`). Literal keys are kept; evaluated keys are removed and
 * `stringParams` is deleted when it becomes empty. Errors from `evaluate` propagate, prefixed
 * with the key.
 */
export function applyElementStringParams(el: ElementIR, evaluate: (text: string, key: string) => number): void {
  const sp = el.stringParams;
  if (!sp) return;
  const keep: Record<string, string> = {};
  let shift: number | undefined;
  for (const [key, text] of Object.entries(sp)) {
    if (LITERAL_ELEMENT_KEYS.has(key)) {
      keep[key] = text;
      continue;
    }
    let value: number;
    try {
      value = evaluate(text, key);
    } catch (e) {
      throw new Error(`${key}=${text}: ${(e as Error).message}`);
    }
    if (key === 'tran.td') shift = value;
    else assign(el, key, value);
  }
  if (shift !== undefined && el.source?.tran?.type === 'PWL') {
    const args = el.source.tran.args;
    for (let i = 0; i < args.length; i += 2) args[i] += shift;
  }
  if (Object.keys(keep).length > 0) el.stringParams = keep;
  else delete el.stringParams;
}

/** Deep copy of an element (all nested arrays/objects). */
export function cloneElement(el: ElementIR): ElementIR {
  const out: ElementIR = { ...el, nodes: [...el.nodes], params: { ...el.params } };
  if (el.stringParams) out.stringParams = { ...el.stringParams };
  if (el.inductors) out.inductors = [...el.inductors];
  if (el.source) {
    const s = el.source;
    out.source = { ...s };
    if (s.tran) out.source.tran = { ...s.tran, args: [...s.tran.args] };
    if (s.distof1) out.source.distof1 = [s.distof1[0], s.distof1[1]];
    if (s.distof2) out.source.distof2 = [s.distof2[0], s.distof2[1]];
  }
  return out;
}
