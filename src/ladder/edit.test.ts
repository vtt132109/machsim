import { describe, expect, it } from 'vitest';
import { addOutput, insertParallel, insertSeries, moveRung, newRung, nodeAt, normalizeNode, pathOf, removeNode, removeOutput, replaceNode, rungElementCount, withLogic, withOutput } from './edit';
import { compileLadder } from './program';
import type { LadderNode } from './types';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });

describe('ladder rung editing', () => {
  it('a new rung compiles and runs at once', () => {
    const r = newRung('r1');
    const { errors } = compileLadder([r]);
    expect(errors).toEqual([]);
    expect(rungElementCount(r)).toBe(2);
  });

  it('flattens nested groups of the same kind and collapses single items', () => {
    expect(normalizeNode(and(no('A0.0'), and(no('I0.1'), no('I0.2'))))).toEqual(and(no('A0.0'), no('I0.1'), no('I0.2')));
    expect(normalizeNode(or(no('I0.0')))).toEqual(no('I0.0'));
    expect(normalizeNode(and(or(no('I0.0'), no('I0.1'))))).toEqual(or(no('I0.0'), no('I0.1')));
  });

  it('inserts in series on either side', () => {
    const logic = no('I0.0');
    expect(insertSeries(logic, [], no('I0.1'))).toEqual(and(no('I0.0'), no('I0.1')));
    expect(insertSeries(logic, [], no('I0.1'), 'before')).toEqual(and(no('I0.1'), no('I0.0')));
    const two = and(no('I0.0'), no('I0.1'));
    expect(insertSeries(two, [1], no('I0.2'))).toEqual(and(no('I0.0'), no('I0.1'), no('I0.2')));
  });

  it('inserts in parallel and keeps the tree tidy', () => {
    const logic = and(no('I0.0'), no('I0.1'));
    const next = insertParallel(logic, [0], no('Q0.0'));
    expect(next).toEqual(and(or(no('I0.0'), no('Q0.0')), no('I0.1')));
    // a second branch joins the same group instead of nesting another one
    expect(insertParallel(next, [0, 1], no('I0.2'))).toEqual(and(or(no('I0.0'), no('Q0.0'), no('I0.2')), no('I0.1')));
  });

  it('removing a branch gives back the tree it started from', () => {
    const start = and(no('I0.0'), no('I0.1'));
    const added = insertParallel(start, [0], no('Q0.0'));
    expect(removeNode(added, [0, 1])).toEqual(start);
  });

  it('removes the last element and leaves an always-true rung', () => {
    expect(removeNode(no('I0.0'), [])).toBeUndefined();
    const r = withLogic(newRung('r1'), undefined);
    expect(r.logic).toBeUndefined();
    const { ir, errors } = compileLadder([r]);
    expect(errors).toEqual([]);
    expect(ir.rungs[0].expr).toBeNull();
  });

  it('replaces a node and reads one back by its path', () => {
    const logic = and(no('I0.0'), or(no('I0.1'), no('I0.2')));
    expect(nodeAt(logic, [1, 0])).toEqual(no('I0.1'));
    expect(nodeAt(logic, [5])).toBeUndefined();
    const next = replaceNode(logic, [1, 0], { kind: 'contact', type: 'nc', address: 'I0.7' });
    expect(nodeAt(next, [1, 0])).toEqual({ kind: 'contact', type: 'nc', address: 'I0.7' });
  });

  it('adds, changes and removes coils but keeps at least one', () => {
    let r = newRung('r1');
    r = addOutput(r, { kind: 'set', address: 'M0.0' });
    expect(r.outputs).toHaveLength(2);
    r = withOutput(r, 1, { kind: 'reset', address: 'M0.0' });
    expect(r.outputs[1]).toEqual({ kind: 'reset', address: 'M0.0' });
    r = removeOutput(r, 1);
    expect(r.outputs).toHaveLength(1);
    expect(removeOutput(r, 0).outputs).toHaveLength(1);
  });

  it('finds where an inserted contact ended up', () => {
    const logic = and(no('I0.0'), no('I0.1'));
    const added = no('I0.2');
    expect(pathOf(insertSeries(logic, [0], added), added)).toEqual([1]);
    const branch = no('Q0.0');
    expect(pathOf(insertParallel(logic, [0], branch), branch)).toEqual([0, 1]);
    expect(pathOf(logic, added)).toBeNull();
  });

  it('moves a rung inside the program', () => {
    const list = [newRung('a'), newRung('b'), newRung('c')];
    expect(moveRung(list, 0, 2).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(moveRung(list, 2, 0).map((r) => r.id)).toEqual(['c', 'a', 'b']);
    expect(moveRung(list, 9, 0).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
