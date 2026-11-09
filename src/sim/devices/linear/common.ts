/**
 * Shared helpers for the linear devices: MNA stamps, IR validation and parameter access.
 *
 * Stamp conventions are those of src/sim/device.ts: KCL rows sum currents leaving a node,
 * a current `i` flowing from a to b through a device stamps rhs[a] -= i, rhs[b] += i, and
 * GROUND (-1) rows/columns are ignored by the engine.
 */
import { GROUND, type AcContext, type LoadContext } from '../../device';
import type { ElementIR } from '../../netlist';
import { SimulationError } from '../../results';

type RealStamper = Pick<LoadContext, 'addMatrix' | 'addRhs'>;

/** Conductance g between nodes a and b. */
export function stampConductance(ctx: RealStamper, a: number, b: number, g: number): void {
  ctx.addMatrix(a, a, g);
  ctx.addMatrix(b, b, g);
  ctx.addMatrix(a, b, -g);
  ctx.addMatrix(b, a, -g);
}

/** Current i flowing from a to b through the device. */
export function stampCurrent(ctx: RealStamper, a: number, b: number, i: number): void {
  ctx.addRhs(a, -i);
  ctx.addRhs(b, i);
}

/** Complex admittance (re + j im) between a and b. */
export function stampAdmittance(ctx: AcContext, a: number, b: number, re: number, im: number): void {
  ctx.addMatrix(a, a, re, im);
  ctx.addMatrix(b, b, re, im);
  ctx.addMatrix(a, b, -re, -im);
  ctx.addMatrix(b, a, -re, -im);
}

/**
 * Branch-current incidence for a branch unknown `br` between nodes p and n:
 * KCL rows get +1 (p) / -1 (n), and the branch row gets +1 / -1 on the node voltages,
 * i.e. the branch equation starts with v(p) - v(n).
 */
export function stampBranchIncidence(ctx: RealStamper, p: number, n: number, br: number): void {
  ctx.addMatrix(p, br, 1);
  ctx.addMatrix(n, br, -1);
  ctx.addMatrix(br, p, 1);
  ctx.addMatrix(br, n, -1);
}

export function stampBranchIncidenceAc(ctx: AcContext, p: number, n: number, br: number): void {
  ctx.addMatrix(p, br, 1, 0);
  ctx.addMatrix(n, br, -1, 0);
  ctx.addMatrix(br, p, 1, 0);
  ctx.addMatrix(br, n, -1, 0);
}

/** Throw a netlist error unless the element has at least `count` nodes. */
export function requireNodes(el: ElementIR, count: number): void {
  if (el.nodes.length < count) {
    throw new SimulationError(
      `${el.name}: expected ${count} nodes, got ${el.nodes.length}`,
      'netlist',
      el.line !== undefined ? `line ${el.line}` : undefined,
    );
  }
}

/** First finite numeric instance parameter among `keys` (lower-case), else undefined. */
export function param(el: ElementIR, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = el.params[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Primary value of an element, or a netlist error when it is missing / not finite. */
export function requireValue(el: ElementIR, what: string): number {
  const v = el.value ?? param(el, 'value');
  if (v === undefined || !Number.isFinite(v)) {
    throw new SimulationError(`${el.name}: missing or invalid ${what}`, 'netlist', el.line !== undefined ? `line ${el.line}` : undefined);
  }
  return v;
}

/** Multiplicity parameter m (parallel copies), validated positive. */
export function multiplicity(el: ElementIR): number {
  const m = param(el, 'm') ?? 1;
  if (!(m > 0)) throw new SimulationError(`${el.name}: multiplicity m must be > 0`, 'netlist');
  return m;
}

/**
 * Error for a setParam name the device does not know. Devices throw it instead of ignoring the
 * call, so a live edit that cannot be applied is reported (SimHost turns it into a message), as
 * the digital code-model shell does.
 */
export function runtimeParamError(device: string, param: string): SimulationError {
  return new SimulationError(`${device}: parameter '${param}' cannot be changed at run time`, 'unsupported');
}

export { GROUND };
