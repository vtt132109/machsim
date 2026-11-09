/**
 * Programmatic design construction (tests, examples, wizards).
 *
 *   const b = new DesignBuilder('Divider');
 *   const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
 *   const r1 = b.part('basic/resistor', 'R1', 100, -60);
 *   const g = b.part('sources/ground', 'GND1', 0, 80);
 *   b.connect(v1, '+', r1, '1');        // L-shaped wire between two pins
 *   b.connect(v1, '-', g, '1');
 *   const design = b.design;
 *
 * Positions are schematic units; parts snap nowhere by themselves (use grid multiples).
 * `pin(handle, name)` returns a pin's sheet position (after rotation / mirroring).
 */

import { getPart } from '../library';
import { localToSheet } from './geometry';
import { blockPartId, resolvePart } from './hierarchy';
import type { ChildDesign, Design, LabelKind, NetLabel, PartInstance, Point, Probe, ProbeKind, Rotation, Sheet } from './types';
import { newDesign, newSheet } from './types';
import type { LadderRung } from '../ladder/types';

export interface PartHandle {
  sheet: Sheet;
  inst: PartInstance;
}

export interface PartOptions {
  rotation?: Rotation;
  mirror?: boolean;
  excludeFromSim?: boolean;
  excludeFromBom?: boolean;
}

export interface LabelOptions {
  kind?: LabelKind;
  /** plain labels: global net name (every sheet and hierarchy level) */
  global?: boolean;
  rotation?: Rotation;
}

export interface ChildOptions {
  kind?: ChildDesign['kind'];
  /** instance parameters with defaults */
  variables?: Record<string, string>;
  id?: string;
}

export class DesignBuilder {
  readonly design: Design;
  private sheetIndex = 0;
  private seq = 0;
  /** sheets being built: the root's, or a child design's */
  private target: Sheet[];
  private targetChild: ChildDesign | null = null;

  constructor(title = 'Test') {
    this.design = newDesign(title);
    this.target = this.design.sheets;
  }

  get sheet(): Sheet {
    return this.target[this.sheetIndex];
  }

  /** Append a sheet (to the root or to the current child design) and make it current. */
  addSheet(name?: string): Sheet {
    const n = this.target.length + 1;
    const id = this.targetChild ? `${this.targetChild.id}_sheet${n}` : `sheet${n}`;
    const s = newSheet(id, name ?? `Sheet ${n}`);
    this.target.push(s);
    this.sheetIndex = this.target.length - 1;
    return s;
  }

  useSheet(index: number): void {
    this.sheetIndex = index;
  }

  /**
   * Append a ladder sheet with these rungs and make it current. A ladder sheet holds no parts, so
   * the next `part()` call usually needs a `useSheet(0)` first; the PLC rack that runs the rungs
   * is placed on the schematic sheets of the same design level.
   */
  ladderSheet(rungs: LadderRung[], name?: string): Sheet {
    const s = this.addSheet(name ?? 'Ladder 1');
    s.kind = 'ladder';
    s.ladder = rungs;
    return s;
  }

  /**
   * Start a child design (subcircuit by default, or hierarchical block) with one sheet and make
   * that sheet current; place its hierarchical connectors with `label(name, x, y, { kind: 'hier' })`.
   * Returns the child id (use it with {@link block}). Call {@link root} to go back.
   */
  child(name: string, opts: ChildOptions = {}): string {
    const children = (this.design.children ??= []);
    const id = opts.id ?? `child${children.length + 1}`;
    const c: ChildDesign = { id, kind: opts.kind ?? 'subcircuit', name, sheets: [newSheet(`${id}_sheet1`, 'Sheet 1')], variables: { ...(opts.variables ?? {}) } };
    children.push(c);
    this.target = c.sheets;
    this.targetChild = c;
    this.sheetIndex = 0;
    return id;
  }

  /** Continue on the sheets of an existing child design. */
  useChild(childId: string, sheetIndex = 0): void {
    const c = this.design.children?.find((x) => x.id === childId);
    if (!c) throw new Error(`no child design ${childId}`);
    this.target = c.sheets;
    this.targetChild = c;
    this.sheetIndex = sheetIndex;
  }

  /** Back to the root design's sheets. */
  root(sheetIndex = 0): void {
    this.target = this.design.sheets;
    this.targetChild = null;
    this.sheetIndex = sheetIndex;
  }

  /** Place a block (instance of a child design) on the current sheet. */
  block(childId: string, refdes: string, x: number, y: number, params: Record<string, string> = {}, opts: PartOptions = {}): PartHandle {
    return this.part(blockPartId(childId), refdes, x, y, params, opts);
  }

  private id(kind: string): string {
    this.seq += 1;
    return `${kind}${this.seq}`;
  }

  part(partId: string, refdes: string, x: number, y: number, params: Record<string, string> = {}, opts: PartOptions = {}): PartHandle {
    const inst: PartInstance = { id: this.id('p'), partId, refdes, x, y, rotation: opts.rotation ?? 0, mirror: opts.mirror ?? false, params: { ...params } };
    if (opts.excludeFromSim) inst.excludeFromSim = true;
    if (opts.excludeFromBom) inst.excludeFromBom = true;
    this.sheet.parts.push(inst);
    return { sheet: this.sheet, inst };
  }

  /** Sheet position of a part pin. */
  pin(h: PartHandle, name: string): Point {
    const def = resolvePart(this.design, h.inst.partId, getPart);
    const p = def?.symbol.pins.find((q) => q.name === name);
    if (!def || !p) throw new Error(`${h.inst.refdes} (${h.inst.partId}) has no pin '${name}'`);
    return localToSheet({ x: p.x, y: p.y }, h.inst);
  }

  wire(...points: Point[]): string {
    const id = this.id('w');
    this.sheet.wires.push({ id, points: points.map((p) => ({ x: p.x, y: p.y })) });
    return id;
  }

  /** Orthogonal wire between two pins (horizontal first, then vertical). */
  connect(a: PartHandle, pa: string, b: PartHandle, pb: string): string {
    const p = this.pin(a, pa);
    const q = this.pin(b, pb);
    const pts = p.x === q.x || p.y === q.y ? [p, q] : [p, { x: q.x, y: p.y }, q];
    return this.wire(...pts);
  }

  /**
   * Net label (local to the sheet unless `opts.global`), or a connector / bus entry with
   * `opts.kind` (see LabelKind in types.ts).
   */
  label(name: string, x: number, y: number, opts: LabelOptions = {}): string {
    const id = this.id('l');
    const l: NetLabel = { id, x, y, name, rotation: opts.rotation ?? 0 };
    if (opts.kind && opts.kind !== 'label') l.kind = opts.kind;
    if (opts.global) l.global = true;
    this.sheet.labels.push(l);
    return id;
  }

  /** Net label / connector placed exactly on a part pin. */
  labelPin(h: PartHandle, pin: string, name: string, opts: LabelOptions = {}): string {
    const p = this.pin(h, pin);
    return this.label(name, p.x, p.y, opts);
  }

  /** Bus wire (optionally named, e.g. "D[0..7]"). */
  bus(name: string | undefined, ...points: Point[]): string {
    const id = this.id('w');
    this.sheet.wires.push({ id, points: points.map((p) => ({ x: p.x, y: p.y })), bus: true, ...(name ? { busName: name } : {}) });
    return id;
  }

  probe(kind: ProbeKind, x: number, y: number, name: string, ref?: Point): Probe {
    const pr: Probe = { id: this.id('pr'), kind, x, y, name, color: '#e53935' };
    if (ref) pr.ref = ref;
    this.sheet.probes.push(pr);
    return pr;
  }
}
