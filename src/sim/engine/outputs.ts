/**
 * Output selection and recording.
 *
 * Vector names follow src/sim/results.ts:
 *   V(node)        node voltage (node name as written in the netlist)
 *   V(a,b)         differential voltage (only when requested)
 *   I(Vname)       branch current of a device owning a branch unknown (V, L, E, H, ...)
 *   KEY(dev)       derived device output from Device.outputs(), e.g. I(R1), P(R1), Ic(Q1)
 *
 * Default selection (empty `saves`): every non-internal node voltage (internal device nodes
 * contain '#') and every branch current; with `deviceOutputs` (operating point, or when
 * "all" is requested) also every derived device output. Explicit saves accept "all",
 * "V(a)", "V(a,b)", "I(dev)", "KEY(dev)" and bare node names; unknown requests produce warnings.
 */
import { GROUND } from '../device';
import type { Vector, VectorUnit } from '../results';
import type { Circuit } from './circuit';
import type { EngineDevice } from './hooks';

export type ProbeKind = 'node' | 'branch' | 'device';

export interface Probe {
  /** Vector name, e.g. "V(out)", "I(V1)", "P(R1)". */
  name: string;
  unit: VectorUnit;
  kind: ProbeKind;
  /** node: positive node index; branch: unknown index. GROUND allowed for nodes. */
  a: number;
  /** node: negative node index (GROUND for single-ended). */
  b: number;
  device?: EngineDevice;
  /** Device output key as returned by outputs()/acOutputs(). */
  key?: string;
}

export interface ProbeSelection {
  probes: Probe[];
  warnings: string[];
}

export interface ProbeOptions {
  /** Include derived device outputs in the default selection. */
  deviceOutputs: boolean;
  /** AC analysis: device outputs are only available through acOutputs(). */
  ac?: boolean;
}

/** Unit of a derived output from the first letter of its key. */
export function unitForKey(key: string): VectorUnit {
  switch (key.charAt(0).toUpperCase()) {
    case 'V':
      return 'V';
    case 'I':
      return 'A';
    case 'P':
      return 'W';
    case 'G':
      return 'S';
    case 'R':
      return 'Ohm';
    default:
      return '';
  }
}

/** Keys of a device's derived outputs (empty when it has none or cannot evaluate them yet). */
export function deviceOutputKeys(d: EngineDevice, ac = false): string[] {
  try {
    if (ac) {
      if (!d.acOutputs) return [];
      return Object.keys(d.acOutputs(() => ({ re: 0, im: 0 }), 0));
    }
    if (!d.outputs) return [];
    return Object.keys(d.outputs(() => 0));
  } catch {
    return [];
  }
}

function branchOf(d: EngineDevice): number {
  const b = d.branchIndex ? d.branchIndex() : -1;
  return typeof b === 'number' && b >= 0 ? b : -1;
}

function defaultProbes(circuit: Circuit, deviceOutputs: boolean, ac: boolean): Probe[] {
  const probes: Probe[] = [];
  for (let i = 0; i < circuit.numNodes; i++) {
    if (circuit.isInternalNode(i)) continue;
    probes.push({ name: `V(${circuit.unknownName(i)})`, unit: 'V', kind: 'node', a: i, b: GROUND });
  }
  for (const d of circuit.devices) {
    const br = branchOf(d);
    if (br >= 0) probes.push({ name: `I(${d.name})`, unit: 'A', kind: 'branch', a: br, b: GROUND, device: d });
  }
  if (deviceOutputs) probes.push(...allDeviceProbes(circuit, ac));
  return probes;
}

function allDeviceProbes(circuit: Circuit, ac: boolean): Probe[] {
  const probes: Probe[] = [];
  for (const d of circuit.devices) {
    const hasBranch = branchOf(d) >= 0;
    for (const key of deviceOutputKeys(d, ac)) {
      if (hasBranch && key.toUpperCase() === 'I') continue;
      probes.push({ name: `${key}(${d.name})`, unit: unitForKey(key), kind: 'device', a: -1, b: GROUND, device: d, key });
    }
  }
  return probes;
}

const CALL_RE = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(\s*([^,()]+?)\s*(?:,\s*([^,()]+?)\s*)?\)\s*$/;

/** Resolve the output requests of an analysis into probes. */
export function selectProbes(circuit: Circuit, saves: readonly string[] | undefined, opts: ProbeOptions): ProbeSelection {
  const ac = !!opts.ac;
  const warnings: string[] = [];
  const requests = (saves ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  if (requests.length === 0) return { probes: defaultProbes(circuit, opts.deviceOutputs, ac), warnings };
  const probes: Probe[] = [];
  const seen = new Set<string>();
  const add = (p: Probe) => {
    const k = p.name.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      probes.push(p);
    }
  };
  for (const req of requests) {
    if (req.toLowerCase() === 'all') {
      for (const p of defaultProbes(circuit, true, ac)) add(p);
      continue;
    }
    const m = CALL_RE.exec(req);
    if (!m) {
      const idx = circuit.nodeIndex(req);
      if (idx !== undefined && idx !== GROUND) add({ name: `V(${circuit.unknownName(idx)})`, unit: 'V', kind: 'node', a: idx, b: GROUND });
      else warnings.push(`Output '${req}' not found`);
      continue;
    }
    const fn = m[1];
    const arg1 = m[2];
    const arg2 = m[3];
    if (fn.toLowerCase() === 'v') {
      const a = circuit.nodeIndex(arg1);
      const b = arg2 !== undefined ? circuit.nodeIndex(arg2) : GROUND;
      if (a === undefined || b === undefined) {
        warnings.push(`Output '${req}': unknown node`);
        continue;
      }
      const name =
        arg2 !== undefined ? `V(${circuit.unknownName(a)},${circuit.unknownName(b)})` : `V(${circuit.unknownName(a)})`;
      add({ name, unit: 'V', kind: 'node', a, b });
      continue;
    }
    const d = circuit.findDevice(arg1);
    if (!d) {
      warnings.push(`Output '${req}': unknown element '${arg1}'`);
      continue;
    }
    if (fn.toLowerCase() === 'i') {
      const br = branchOf(d);
      if (br >= 0) {
        add({ name: `I(${d.name})`, unit: 'A', kind: 'branch', a: br, b: GROUND, device: d });
        continue;
      }
    }
    const key = deviceOutputKeys(d, ac).find((k) => k.toLowerCase() === fn.toLowerCase());
    if (key === undefined) {
      warnings.push(`Output '${req}' is not available${ac ? ' in AC analysis' : ''}`);
      continue;
    }
    add({ name: `${key}(${d.name})`, unit: unitForKey(key), kind: 'device', a: -1, b: GROUND, device: d, key });
  }
  return { probes, warnings };
}

/** Evaluates real-valued probes at a solution vector (device outputs computed once per device). */
export class ProbeEvaluator {
  readonly probes: Probe[];
  private readonly devices: EngineDevice[];
  private readonly devIndex: Int32Array;

  constructor(probes: Probe[]) {
    this.probes = probes;
    const devs: EngineDevice[] = [];
    this.devIndex = new Int32Array(probes.length).fill(-1);
    probes.forEach((p, k) => {
      if (p.kind !== 'device' || !p.device) return;
      let i = devs.indexOf(p.device);
      if (i < 0) {
        i = devs.length;
        devs.push(p.device);
      }
      this.devIndex[k] = i;
    });
    this.devices = devs;
  }

  /** Fill out[k] with the value of probe k at solution x. */
  evaluate(x: Float64Array, out: Float64Array): void {
    const read = (i: number): number => (i < 0 ? 0 : x[i]);
    const recs: Record<string, number>[] = this.devices.map((d) => {
      try {
        return d.outputs ? d.outputs(read) : {};
      } catch {
        return {};
      }
    });
    const probes = this.probes;
    for (let k = 0; k < probes.length; k++) {
      const p = probes[k];
      if (p.kind === 'device') {
        const v = recs[this.devIndex[k]][p.key as string];
        out[k] = typeof v === 'number' ? v : Number.NaN;
      } else if (p.kind === 'branch') {
        out[k] = x[p.a];
      } else {
        out[k] = read(p.a) - read(p.b);
      }
    }
  }
}

/** Evaluates probes on a complex (AC) solution. */
export function evaluateComplexProbes(
  probes: Probe[],
  re: Float64Array,
  im: Float64Array,
  omega: number,
  outRe: Float64Array,
  outIm: Float64Array,
): void {
  const reader = (i: number) => (i < 0 ? { re: 0, im: 0 } : { re: re[i], im: im[i] });
  const cache = new Map<EngineDevice, Record<string, { re: number; im: number }>>();
  for (let k = 0; k < probes.length; k++) {
    const p = probes[k];
    if (p.kind === 'device') {
      const d = p.device as EngineDevice;
      let rec = cache.get(d);
      if (!rec) {
        try {
          rec = d.acOutputs ? d.acOutputs(reader, omega) : {};
        } catch {
          rec = {};
        }
        cache.set(d, rec);
      }
      const v = rec[p.key as string];
      outRe[k] = v ? v.re : Number.NaN;
      outIm[k] = v ? v.im : Number.NaN;
    } else if (p.kind === 'branch') {
      outRe[k] = re[p.a];
      outIm[k] = im[p.a];
    } else {
      outRe[k] = (p.a < 0 ? 0 : re[p.a]) - (p.b < 0 ? 0 : re[p.b]);
      outIm[k] = (p.a < 0 ? 0 : im[p.a]) - (p.b < 0 ? 0 : im[p.b]);
    }
  }
}

/** Growable column store: one Float64Array per probe plus an optional scale. */
export class Recorder {
  readonly names: string[];
  readonly units: VectorUnit[];
  length = 0;
  private cols: Float64Array[];
  private colsIm: Float64Array[] | undefined;
  private scale: Float64Array;
  private cap: number;

  constructor(probes: Probe[], complex = false, initialCapacity = 256) {
    this.names = probes.map((p) => p.name);
    this.units = probes.map((p) => p.unit);
    this.cap = Math.max(4, initialCapacity);
    this.cols = probes.map(() => new Float64Array(this.cap));
    this.colsIm = complex ? probes.map(() => new Float64Array(this.cap)) : undefined;
    this.scale = new Float64Array(this.cap);
  }

  private grow(): void {
    const cap = this.cap * 2;
    const g = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    this.cols = this.cols.map(g);
    if (this.colsIm) this.colsIm = this.colsIm.map(g);
    this.scale = g(this.scale);
    this.cap = cap;
  }

  /** Append one sample: scale value plus one value (and imaginary part) per probe. */
  push(scale: number, values: Float64Array, valuesIm?: Float64Array): void {
    if (this.length >= this.cap) this.grow();
    const k = this.length++;
    this.scale[k] = scale;
    for (let j = 0; j < this.cols.length; j++) this.cols[j][k] = values[j];
    if (this.colsIm && valuesIm) for (let j = 0; j < this.colsIm.length; j++) this.colsIm[j][k] = valuesIm[j];
  }

  /** Last recorded value of column j. */
  last(j: number): number {
    return this.length > 0 ? this.cols[j][this.length - 1] : Number.NaN;
  }

  scaleVector(name: string, unit: VectorUnit): Vector {
    return { name, unit, re: this.scale.slice(0, this.length) };
  }

  /** Trimmed copies of every column. */
  vectors(): Vector[] {
    return this.cols.map((c, j) => {
      const v: Vector = { name: this.names[j], unit: this.units[j], re: c.slice(0, this.length) };
      if (this.colsIm) v.im = this.colsIm[j].slice(0, this.length);
      return v;
    });
  }

  /** Columns of samples [from, length) (stepper chunks). */
  slice(from: number): { scale: Float64Array; cols: Float64Array[] } {
    return { scale: this.scale.slice(from, this.length), cols: this.cols.map((c) => c.slice(from, this.length)) };
  }

  /** Drop all samples but keep the last `keep` ones (bounded memory for the stepper). */
  compact(keep: number): void {
    const n = Math.min(keep, this.length);
    const start = this.length - n;
    if (start <= 0) return;
    this.scale.copyWithin(0, start, this.length);
    for (const c of this.cols) c.copyWithin(0, start, this.length);
    if (this.colsIm) for (const c of this.colsIm) c.copyWithin(0, start, this.length);
    this.length = n;
  }
}
