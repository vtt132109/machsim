import { describe, expect, it } from 'vitest';
import { layoutLadder, layoutRung, logicSize } from './layout';
import { compileLadder, elementSlot, rungSlot } from './program';
import type { LadderNode, LadderRung } from './types';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });

describe('ladder layout', () => {
  it('sizes series and parallel groups', () => {
    expect(logicSize(no('I0.0'))).toEqual({ w: 1, h: 1 });
    expect(logicSize(and(no('I0.0'), no('I0.1'), no('I0.2')))).toEqual({ w: 3, h: 1 });
    expect(logicSize(or(no('I0.0'), no('I0.1')))).toEqual({ w: 1, h: 2 });
    expect(logicSize(and(or(no('I0.0'), no('I0.1')), no('I0.2')))).toEqual({ w: 2, h: 2 });
    expect(logicSize(or(and(no('I0.0'), no('I0.1')), no('I0.2')))).toEqual({ w: 2, h: 2 });
    expect(logicSize(undefined)).toEqual({ w: 0, h: 1 });
  });

  it('places the start / stop rung on the grid with its links', () => {
    const rung: LadderRung = {
      id: 'r1',
      logic: and(or(no('I0.0'), no('Q0.0')), { kind: 'contact', type: 'nc', address: 'I0.1' }),
      outputs: [{ kind: 'coil', address: 'Q0.0' }],
    };
    const l = layoutRung(rung, 0);
    expect(l.cols).toBe(2);
    expect(l.rows).toBe(2);
    expect(l.cells.map((c) => [c.col, c.row])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
    // both branches are one column wide, so nothing has to be stretched
    expect(l.fills).toEqual([]);
    expect(l.verticals).toEqual([
      { col: 0, row1: 0, row2: 1 },
      { col: 1, row1: 0, row2: 1 },
    ]);
    expect(l.coils).toHaveLength(1);
    expect(l.coils[0].row).toBe(0);
  });

  it('gives every drawn element the slot the compiler gave it', () => {
    const rungs: LadderRung[] = [
      { id: 'r1', logic: and(no('I0.0'), or(no('I0.1'), no('I0.2'))), outputs: [{ kind: 'coil', address: 'Q0.0' }, { kind: 'set', address: 'M0.0' }] },
      { id: 'r2', logic: no('M0.0'), outputs: [{ kind: 'coil', address: 'Q0.1' }] },
    ];
    const { ir, errors } = compileLadder(rungs);
    expect(errors).toEqual([]);
    const l = layoutLadder(rungs);
    expect(l.cols).toBe(2);

    const compiledSlots: number[] = [];
    const walk = (e: (typeof ir.rungs)[number]['expr']): void => {
      if (!e) return;
      if (e.k === 'bit' || e.k === 'cmp') compiledSlots.push(e.slot);
      else e.items.forEach(walk);
    };
    walk(ir.rungs[0].expr);
    expect(l.rungs[0].cells.map((c) => c.slot)).toEqual(compiledSlots);
    expect(l.rungs[0].coils.map((c) => c.slot)).toEqual(ir.rungs[0].outputs.map((o) => o.slot));
    expect(l.rungs[0].slot).toBe(rungSlot(0));
    expect(l.rungs[1].cells[0].slot).toBe(elementSlot(1, 0));
    expect(l.rungs[1].coils[0].slot).toBe(elementSlot(1, 1));
  });

  it('stretches a short branch to the width of its group', () => {
    const rung: LadderRung = {
      id: 'r1',
      logic: or(and(no('I0.0'), no('I0.1')), no('I0.2')),
      outputs: [{ kind: 'coil', address: 'Q0.0' }],
    };
    const l = layoutRung(rung, 0);
    expect(l.cols).toBe(2);
    expect(l.cells.map((c) => [c.col, c.row])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    expect(l.fills).toEqual([{ col: 1, row: 1, len: 1 }]);
    expect(l.verticals).toEqual([
      { col: 0, row1: 0, row2: 1 },
      { col: 2, row1: 0, row2: 1 },
    ]);
  });

  it('paths point back at the node that was drawn', () => {
    const rung: LadderRung = { id: 'r1', logic: and(no('I0.0'), or(no('I0.1'), no('I0.2'))), outputs: [{ kind: 'coil', address: 'Q0.0' }] };
    const l = layoutRung(rung, 0);
    expect(l.cells.map((c) => c.path)).toEqual([[0], [1, 0], [1, 1]]);
    expect(l.cells.map((c) => (c.node.kind === 'contact' ? c.node.address : ''))).toEqual(['I0.0', 'I0.1', 'I0.2']);
  });

  it('a rung with more coils than logic rows is as tall as its coils', () => {
    const rung: LadderRung = {
      id: 'r1',
      logic: no('I0.0'),
      outputs: [{ kind: 'coil', address: 'Q0.0' }, { kind: 'coil', address: 'Q0.1' }, { kind: 'coil', address: 'Q0.2' }],
    };
    expect(layoutRung(rung, 0).rows).toBe(3);
  });
});
