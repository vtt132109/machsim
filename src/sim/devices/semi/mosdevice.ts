/**
 * MOSFET dispatcher — the registry's factory for element 'M'.
 *
 * The model level decides the implementation, but a device factory only sees the element, not
 * its model card. `MosDevice` therefore resolves the card in setup() and creates the real device:
 * BSIM3 (bsim3.ts) for LEVEL 7 / 8 / 49 / 53, the BSIM4-class variant of the same code for LEVEL 14 / 54,
 * the charge-based EKV 2.6 model (ekv.ts) for LEVEL 44; the SPICE level 1 / 2 / 3 Mosfet (mosfet.ts)
 * for everything else. Every Device method is forwarded.
 * Runtime parameter changes made before setup are replayed on the created device.
 */
import type { AcContext, Device, LoadContext, NoiseContext, NoiseGenerator, SetupContext, TruncContext } from '../../device';
import type { ElementIR } from '../../netlist';
import { Bsim3, BSIM3_LEVELS, BSIM4_LEVELS } from './bsim3';
import { Ekv, EKV_LEVELS } from './ekv';
import { Mosfet } from './mosfet';

/** True when a MOSFET model card of this level is evaluated by the EKV implementation. */
export function isEkvLevel(level: number | undefined): boolean {
  return level !== undefined && Number.isFinite(level) && EKV_LEVELS.has(Math.round(level));
}

/** True when a MOSFET model card of this level is evaluated by the BSIM3 implementation. */
export function isBsimLevel(level: number | undefined): boolean {
  if (level === undefined || !Number.isFinite(level)) return false;
  const l = Math.round(level);
  return BSIM3_LEVELS.has(l) || BSIM4_LEVELS.has(l);
}

export class MosDevice implements Device {
  readonly type = 'M' as const;
  readonly name: string;
  readonly nodeNames: string[];
  private readonly el: ElementIR;
  private inner: Mosfet | Bsim3 | Ekv | null = null;
  private readonly pending: [string, number][] = [];

  constructor(el: ElementIR) {
    this.el = el;
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 4);
  }

  /** The device that evaluates this element (after setup). */
  get implementation(): Mosfet | Bsim3 | Ekv | null {
    return this.inner;
  }

  setup(ctx: SetupContext): void {
    const card = this.el.model ? ctx.model(this.el.model) : undefined;
    const level = card && (card.type.toUpperCase() === 'NMOS' || card.type.toUpperCase() === 'PMOS') ? card.params.level : undefined;
    this.inner = isEkvLevel(level) ? new Ekv(this.el) : isBsimLevel(level) ? new Bsim3(this.el) : new Mosfet(this.el);
    for (const [p, v] of this.pending.splice(0)) this.inner.setParam(p, v);
    this.inner.setup(ctx);
  }

  private dev(): Mosfet | Bsim3 | Ekv {
    if (!this.inner) throw new Error(`${this.name}: MOSFET used before setup`);
    return this.inner;
  }

  load(ctx: LoadContext): void {
    this.dev().load(ctx);
  }

  convTest(ctx: LoadContext): boolean {
    return this.dev().convTest(ctx);
  }

  acLoad(ctx: AcContext): void {
    this.dev().acLoad(ctx);
  }

  truncate(ctx: TruncContext): number {
    return this.dev().truncate(ctx);
  }

  noise(ctx: NoiseContext): NoiseGenerator[] {
    return this.dev().noise(ctx);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return this.inner ? this.inner.outputs(x) : { Id: 0, Ig: 0, Is: 0, Ib: 0, P: 0 };
  }

  setParam(param: string, value: number): void {
    if (this.inner) this.inner.setParam(param, value);
    else this.pending.push([param, value]);
  }

  getParam(param: string): number | undefined {
    return this.inner?.getParam(param);
  }
}

export function createMosDevice(el: ElementIR): Device {
  return new MosDevice(el);
}
