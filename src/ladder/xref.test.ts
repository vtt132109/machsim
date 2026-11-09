/** Cross-reference of a ladder program and copy / cut / paste of rungs and elements. */
import { describe, expect, it } from 'vitest';
import { copyCoil, copyNode, copyRungs, cutRungs, decodeLadderClip, encodeLadderClip, pasteCoil, pasteNode, pasteRungs } from './clipboard';
import { crossReference, normalizeAddress, useSummary, xrefText, xrefWarnings, type XrefEntry } from './xref';
import type { LadderBlock, LadderNode, LadderOutput, LadderRung } from './types';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const nc = (address: string): LadderNode => ({ kind: 'contact', type: 'nc', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });
const coil = (address: string): LadderOutput => ({ kind: 'coil', address });

const rungs: LadderRung[] = [
  { id: 'r1', comment: 'hold in', logic: and(or(no('I0.0'), no('Q0.0')), nc('I0.1')), outputs: [coil('Q0.0')] },
  { id: 'r2', logic: no('Q0.0'), outputs: [{ kind: 'ton', address: 'T1', preset: '2' }] },
  { id: 'r3', logic: { kind: 'compare', op: 'ge', left: 'T1.ET', right: '1' }, outputs: [{ kind: 'add', address: 'MW0', a: 'MW0', b: '1' }, coil('M0.0')] },
  { id: 'r4', logic: no('I0.0'), outputs: [{ kind: 'set', address: 'Q0.1' }] },
];
const sheets = [{ sheetId: 's1', sheetName: 'Main', rungs }];

const find = (entries: XrefEntry[], address: string): XrefEntry => {
  const e = entries.find((x) => x.address === address);
  if (!e) throw new Error(`no entry ${address}`);
  return e;
};

describe('normalising addresses', () => {
  it('folds case, spaces and the .ET / .CV forms', () => {
    expect(normalizeAddress(' i0.0 ')).toEqual({ address: 'I0.0', kind: 'input' });
    expect(normalizeAddress('q1 . 3')).toEqual({ address: 'Q1.3', kind: 'output' });
    expect(normalizeAddress('T1.ET')).toEqual({ address: 'T1', kind: 'timer' });
    expect(normalizeAddress('c2.cv')).toEqual({ address: 'C2', kind: 'counter' });
    expect(normalizeAddress('mw 4')).toEqual({ address: 'MW4', kind: 'word' });
    expect(normalizeAddress('AI1')).toEqual({ address: 'AI1', kind: 'analog-in' });
    expect(normalizeAddress('aq0')).toEqual({ address: 'AQ0', kind: 'analog-out' });
  });
  it('a literal number is not an address', () => {
    expect(normalizeAddress('2.5')).toBeNull();
    expect(normalizeAddress('1k')).toBeNull();
    expect(normalizeAddress('')).toBeNull();
    expect(normalizeAddress('4,7')).toBeNull();
  });
});

describe('cross-reference', () => {
  const entries = crossReference(sheets);

  it('lists reads and writes of one address with the rung', () => {
    const q = find(entries, 'Q0.0');
    expect(q.kind).toBe('output');
    expect(q.writes).toBe(1);
    expect(q.reads).toBe(2);
    expect(q.uses.filter((u) => u.role === 'write').map((u) => u.rungIndex)).toEqual([0]);
    expect(q.uses.filter((u) => u.role === 'read').map((u) => u.rungIndex)).toEqual([0, 1]);
    // the read inside rung 1 is the second item of the parallel group, which is the first item of the series
    const hold = q.uses.find((u) => u.role === 'read' && u.rungIndex === 0)!;
    expect(hold.spot).toEqual({ kind: 'cell', path: [0, 1] });
    expect(hold.how).toBe('no');
    expect(summary(q)).toEqual({ reads: ['1', '2'], writes: ['1'] });
  });

  it('counts an input read in two rungs and never written', () => {
    const i = find(entries, 'I0.0');
    expect(i.reads).toBe(2);
    expect(i.writes).toBe(0);
    expect(i.uses.map((u) => u.rungIndex)).toEqual([0, 3]);
  });

  it('a timer is written by its coil and read through its done bit and elapsed time', () => {
    const t = find(entries, 'T1');
    expect(t.kind).toBe('timer');
    expect(t.uses.map((u) => `${u.role}${u.rungIndex}`)).toEqual(['write1', 'read2']);
  });

  it('word instructions read their operands and write the destination', () => {
    const w = find(entries, 'MW0');
    expect(w.kind).toBe('word');
    expect(w.reads).toBe(1);
    expect(w.writes).toBe(1);
    expect(w.uses.find((u) => u.role === 'write')!.spot).toEqual({ kind: 'coil', index: 0 });
  });

  it('sorts by area then by number', () => {
    const order = entries.map((e) => e.address);
    expect(order).toEqual(['I0.0', 'I0.1', 'Q0.0', 'Q0.1', 'M0.0', 'MW0', 'T1']);
  });

  it('warns about an address that is read but never written, and the other way round', () => {
    const w = xrefWarnings(entries);
    // I0.x are written by the circuit and Q0.x are read by it; T1 is both; M0.0 is written but nothing reads it;
    expect(w).toEqual([{ address: 'M0.0', kind: 'memory', code: 'neverRead' }]);
    const more = crossReference([{ sheetId: 's', sheetName: 'S', rungs: [{ id: 'x', logic: no('M3.1'), outputs: [coil('Q0.0')] }] }]);
    expect(xrefWarnings(more)).toEqual([{ address: 'M3.1', kind: 'memory', code: 'neverWritten' }]);
  });

  it('prints a plain table', () => {
    const text = xrefText(entries).split('\n');
    expect(text[0]).toBe('I0.0\tinput\t\t1 4');
    expect(text[2]).toBe('Q0.0\toutput\t1\t1 2');
  });
});

function summary(e: XrefEntry) {
  return useSummary(e);
}

describe('cross-reference of function blocks', () => {
  const block: LadderBlock = {
    id: 'b',
    name: 'Motor',
    inputs: ['START'],
    outputs: ['RUN'],
    rungs: [{ id: 'br', logic: and(or(no('START'), no('RUN')), no('#fault')), outputs: [coil('RUN')] }],
  };
  const calls: LadderRung[] = [{ id: 'c1', outputs: [{ kind: 'call', address: 'M1', block: 'Motor', args: { START: 'I0.0', RUN: 'Q0.5' } }] }];
  const entries = crossReference([{ sheetId: 's', sheetName: 'S', rungs: calls }], [block]);

  it('lists the actual addresses of a call as reads (inputs) and writes (outputs)', () => {
    expect(find(entries, 'I0.0').uses[0]).toMatchObject({ role: 'read', rungIndex: 0, how: 'call' });
    expect(find(entries, 'Q0.5').uses[0]).toMatchObject({ role: 'write', rungIndex: 0, how: 'call' });
    const inst = find(entries, 'M1');
    expect(inst.kind).toBe('instance');
    expect(inst.uses[0].how).toBe('Motor');
  });

  it('lists formals and private names under the block', () => {
    const start = find(entries, 'Motor.START');
    expect(start.kind).toBe('formal');
    expect(start.uses[0].scope).toEqual({ kind: 'block', block: 'Motor' });
    expect(find(entries, 'Motor.#FAULT').kind).toBe('local');
    expect(find(entries, 'Motor.RUN').writes).toBe(1);
    // a formal or an instance is never a "never written" warning; a private name that nothing writes is
    expect(xrefWarnings(entries)).toEqual([{ address: 'Motor.#FAULT', kind: 'local', code: 'neverWritten' }]);
  });
});

describe('copy, cut and paste', () => {
  let n = 0;
  const id = (): string => `new${++n}`;

  it('copies and pastes rungs with fresh ids, below the chosen rung', () => {
    const clip = copyRungs(rungs, 1, 2)!;
    expect(clip.kind).toBe('rungs');
    const r = pasteRungs(rungs, 0, clip, id)!;
    expect(r.rungs.map((x) => x.id)).toEqual(['r1', 'new1', 'new2', 'r2', 'r3', 'r4']);
    expect(r.from).toBe(1);
    expect(r.to).toBe(2);
    expect(r.rungs[1].outputs).toEqual(rungs[1].outputs);
    // a copy, not the same objects
    expect(r.rungs[1]).not.toBe(rungs[1]);
    expect(r.rungs[1].logic).not.toBe(rungs[1].logic);
    // paste at the top
    expect(pasteRungs(rungs, -1, clip, id)!.rungs.map((x) => x.id)).toEqual(['new3', 'new4', 'r1', 'r2', 'r3', 'r4']);
  });

  it('cuts rungs out of the list', () => {
    const r = cutRungs(rungs, 2, 1);
    expect(r.rungs.map((x) => x.id)).toEqual(['r1', 'r4']);
    expect(r.clip && r.clip.kind === 'rungs' && r.clip.rungs.map((x) => x.id)).toEqual(['r2', 'r3']);
  });

  it('a pasted copy is independent of the original', () => {
    const clip = copyRungs(rungs, 0)!;
    const r = pasteRungs(rungs, 3, clip, id)!;
    (r.rungs[4].outputs[0] as LadderOutput).address = 'Q9.9';
    expect(rungs[0].outputs[0].address).toBe('Q0.0');
  });

  it('pastes a contact in series or in parallel next to the selected one', () => {
    const clip = copyNode(rungs[0], [0, 0])!; // I0.0
    const series = pasteNode(rungs[1], [], clip, 'series')!.rung;
    expect(series.logic).toEqual({ kind: 'series', items: [no('Q0.0'), no('I0.0')] });
    const parallel = pasteNode(rungs[1], [], clip, 'parallel')!.rung;
    expect(parallel.logic).toEqual({ kind: 'parallel', items: [no('Q0.0'), no('I0.0')] });
    expect(pasteNode(rungs[1], [], copyCoil(rungs[0], 0)!)).toBeNull();
  });

  it('pastes a whole group', () => {
    const clip = copyNode(rungs[0], [0])!; // the parallel group
    const r = pasteNode(rungs[3], [], clip, 'series')!.rung;
    expect(r.logic).toEqual({ kind: 'series', items: [no('I0.0'), or(no('I0.0'), no('Q0.0'))] });
  });

  it('pastes a coil after the chosen one', () => {
    const clip = copyCoil(rungs[3], 0)!;
    const r = pasteCoil(rungs[0], 0, clip)!;
    expect(r.outputs).toEqual([coil('Q0.0'), { kind: 'set', address: 'Q0.1' }]);
    expect(pasteCoil(rungs[0], 0, copyNode(rungs[0], [])!)).toBeNull();
  });

  it('nothing to copy outside the list', () => {
    expect(copyRungs(rungs, 9)).toBeNull();
    expect(copyNode(rungs[0], [5])).toBeNull();
    expect(copyCoil(rungs[0], 4)).toBeNull();
    expect(pasteRungs(rungs, 0, copyNode(rungs[0], [])!, id)).toBeNull();
  });

  it('stops at the rung limit', () => {
    const clip = copyRungs(rungs, 0, 3)!;
    const r = pasteRungs(rungs, 3, clip, id, 6)!;
    expect(r.rungs).toHaveLength(6);
    expect(r.to - r.from + 1).toBe(2);
    expect(pasteRungs(rungs, 3, clip, id, 4)).toBeNull();
  });
});

describe('clipboard text', () => {
  it('round-trips rungs, a contact and a coil', () => {
    for (const clip of [copyRungs(rungs, 0, 3)!, copyNode(rungs[0], [0])!, copyCoil(rungs[2], 0)!]) {
      const text = encodeLadderClip(clip);
      expect(text.startsWith('machsim-ladder-clip\n')).toBe(true);
      expect(decodeLadderClip(text)).toEqual(clip);
    }
  });

  it('keeps the fields of word instructions and calls', () => {
    const call: LadderRung = { id: 'c', outputs: [{ kind: 'call', address: 'M1', block: 'Motor', args: { START: 'I0.0', RUN: 'Q0.5' } }, { kind: 'mul', address: 'AQ0', a: 'AI0', b: '2' }] };
    expect(decodeLadderClip(encodeLadderClip({ kind: 'rungs', rungs: [call] }))).toEqual({ kind: 'rungs', rungs: [call] });
  });

  it('ignores other text and damaged clips', () => {
    expect(decodeLadderClip('hello')).toBeNull();
    expect(decodeLadderClip('machsim-ladder-clip\n{not json')).toBeNull();
    expect(decodeLadderClip('machsim-ladder-clip\n{"kind":"rungs","rungs":[{"id":"x","outputs":[{"kind":"banana","address":"Q0.0"}]}]}')).toBeNull();
    expect(decodeLadderClip('machsim-ladder-clip\n{"kind":"rungs","rungs":[]}')).toBeNull();
    expect(decodeLadderClip('machsim-ladder-clip\n{"kind":"node","node":{"kind":"contact","type":"zz","address":"I0.0"}}')).toBeNull();
    expect(decodeLadderClip('machsim-ladder-clip\n{"kind":"coil","output":{"kind":"coil"}}')).toBeNull();
  });
});
