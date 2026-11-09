import { describe, expect, it } from 'vitest';
import { argsFor, callsIn, countCalls, mergeLadderBlocks, nextBlockName, nextInstanceName, renameBlockCalls, renameLadderBlock, retypeOutput } from './editBlocks';
import { compileLadder } from './program';
import type { LadderBlock, LadderOutput, LadderRung } from './types';

const block = (name: string, inputs: string[] = ['A'], outputs: string[] = ['B']): LadderBlock => ({ id: name, name, inputs, outputs, rungs: [] });

describe('changing the kind of a coil', () => {
  it('a coil becomes a word instruction with operands and a memory word', () => {
    const o: LadderOutput = { kind: 'coil', address: 'Q0.3', comment: 'x' };
    const add = retypeOutput(o, 'add', []);
    expect(add).toEqual({ kind: 'add', address: 'MW0', a: '0', b: '1', comment: 'x' });
    expect(compileLadder([{ id: 'r', outputs: [add] }]).errors).toEqual([]);
    const mov = retypeOutput(o, 'mov', []);
    expect(mov.b).toBeUndefined();
    expect(compileLadder([{ id: 'r', outputs: [mov] }]).errors).toEqual([]);
  });

  it('keeps the destination and operands when switching between word instructions', () => {
    const add = retypeOutput({ kind: 'coil', address: 'Q0.0' }, 'add', []);
    const custom: LadderOutput = { ...add, address: 'AQ1', a: 'AI0', b: '2.5' };
    expect(retypeOutput(custom, 'mul', [])).toEqual({ kind: 'mul', address: 'AQ1', a: 'AI0', b: '2.5' });
    // and drops them when going back to a coil
    const back = retypeOutput(custom, 'coil', []);
    expect(back).toEqual({ kind: 'coil', address: 'Q0.0' });
  });

  it('a timer gets a timer address and a preset; a call gets a block', () => {
    expect(retypeOutput({ kind: 'coil', address: 'Q0.0' }, 'ton', [])).toEqual({ kind: 'ton', address: 'T1', preset: '1' });
    expect(retypeOutput({ kind: 'coil', address: 'Q0.0' }, 'ctu', [])).toEqual({ kind: 'ctu', address: 'C1', preset: '10' });
    expect(retypeOutput({ kind: 'coil', address: 'Q0.0' }, 'creset', [])).toEqual({ kind: 'creset', address: 'C1' });
    const call = retypeOutput({ kind: 'coil', address: 'Q0.0' }, 'call', [block('Motor'), block('Pump')], 'FB7');
    expect(call).toEqual({ kind: 'call', address: 'FB7', block: 'Motor', args: {} });
    // switching a call to a coil gives a bit address, not an instance name
    expect(retypeOutput(call, 'set', []).address).toBe('Q0.0');
  });

  it('never leaves an input address behind a coil', () => {
    expect(retypeOutput({ kind: 'ton', address: 'T3', preset: '2' }, 'coil', []).address).toBe('Q0.0');
    expect(retypeOutput({ kind: 'coil', address: 'M1.2' }, 'set', []).address).toBe('M1.2');
  });
});

describe('naming', () => {
  it('finds the next free instance and block name', () => {
    expect(nextInstanceName([])).toBe('FB1');
    expect(nextInstanceName(['FB1', 'fb2'])).toBe('FB3');
    expect(nextBlockName([block('Block1'), block('Block2')])).toBe('Block3');
  });
});

describe('calls', () => {
  const rungs: LadderRung[] = [
    { id: 'a', outputs: [{ kind: 'call', address: 'M1', block: 'Motor', args: {} }, { kind: 'coil', address: 'Q0.0' }] },
    { id: 'b', outputs: [{ kind: 'call', address: 'M2', block: 'motor', args: {} }, { kind: 'call', address: 'P1', block: 'Pump', args: {} }] },
  ];

  it('lists the calls', () => {
    expect(callsIn(rungs).map((c) => c.address)).toEqual(['M1', 'M2', 'P1']);
  });

  it('renames the calls of a renamed block (case-insensitive) and nothing else', () => {
    const out = renameBlockCalls(rungs, 'Motor', 'Drive');
    expect(callsIn(out).map((c) => c.block)).toEqual(['Drive', 'Drive', 'Pump']);
    // nothing to rename: the same list comes back
    expect(renameBlockCalls(rungs, 'Nope', 'X')).toBe(rungs);
  });

  it('arguments follow the declared parameters', () => {
    expect(argsFor(block('M', ['A', 'B'], ['C']), { B: 'I0.1', Z: 'junk' })).toEqual({ A: '', B: 'I0.1', C: '' });
  });
});

describe('renaming a block in a design', () => {
  const rung = (id: string, blockName: string): LadderRung => ({ id, outputs: [{ kind: 'call', address: `I${id}`, block: blockName, args: {} }] });
  const design = {
    sheets: [{ id: 's1', name: 'L', kind: 'ladder', ladder: [rung('a', 'Motor')], parts: [], wires: [], labels: [], probes: [], notes: [] }],
    children: [{ id: 'c1', name: 'Child', sheets: [{ id: 's2', name: 'L2', kind: 'ladder', ladder: [rung('b', 'Motor'), rung('c', 'Pump')], parts: [], wires: [], labels: [], probes: [], notes: [] }] }],
    ladderBlocks: [
      { id: 'm', name: 'Motor', inputs: [], outputs: [], rungs: [] },
      { id: 'o', name: 'Outer', inputs: [], outputs: [], rungs: [rung('d', 'Motor')] },
    ],
  } as unknown as import('../model/types').Design;

  it('counts the calls everywhere', () => {
    expect(countCalls(design, 'Motor')).toBe(3);
    expect(countCalls(design, 'pump')).toBe(1);
    expect(countCalls(design, 'None')).toBe(0);
  });

  it('renames the block and follows the calls on every level and in other blocks', () => {
    const next = renameLadderBlock(design, 'm', 'Drive');
    expect(next.ladderBlocks?.map((b) => b.name)).toEqual(['Drive', 'Outer']);
    expect(countCalls(next, 'Motor')).toBe(0);
    expect(countCalls(next, 'Drive')).toBe(3);
    expect(countCalls(next, 'Pump')).toBe(1);
    // the original is untouched
    expect(countCalls(design, 'Motor')).toBe(3);
    expect(renameLadderBlock(design, 'zzz', 'X')).toBe(design);
    expect(renameLadderBlock(design, 'm', 'Motor')).toBe(design);
  });
});

describe('merging blocks when a design becomes a block of another', () => {
  const a: LadderBlock = { id: 'b1', name: 'Motor', inputs: [], outputs: [], rungs: [] };
  const b: LadderBlock = { id: 'b1', name: 'Pump', inputs: ['X'], outputs: [], rungs: [] };

  it('adds the blocks that are not there, keeps the existing ones and fixes a clashing id', () => {
    expect(mergeLadderBlocks(undefined, undefined)).toEqual([]);
    expect(mergeLadderBlocks([a], undefined)).toEqual([a]);
    const merged = mergeLadderBlocks([a], [b, { ...a, id: 'zzz', inputs: ['changed'] }]);
    // a DIFFERENT block of the same name is kept under a free name (round 4 fix): the existing
    // definition is never replaced, and never answers calls meant for the incoming program
    expect(merged.map((x) => [x.id, x.name])).toEqual([['b1', 'Motor'], ['b1-2', 'Pump'], ['zzz', 'Motor_2']]);
    expect(merged[0].inputs).toEqual([]);
    expect(merged[2].inputs).toEqual(['changed']);
  });

  it('the same program under the same name is the same block and is not added twice', () => {
    expect(mergeLadderBlocks([a], [{ ...a, id: 'other' }])).toEqual([a]);
  });
});
