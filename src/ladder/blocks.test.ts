/**
 * User function blocks of the ladder program: calls are expanded into plain rungs, every instance
 * has its own private memory, the enable input gates the body, and every mistake comes back as a
 * structured error that names the rung and the block.
 */
import { describe, expect, it } from 'vitest';
import { expandBlocks, newBlock, validateBlocks } from './blocks';
import { LadderMachine } from './machine';
import { compileLadder, elementSlot, parseBitAddress, type LadderErrorCode } from './program';
import type { LadderBlock, LadderNode, LadderOutput, LadderRung } from './types';
import { newDesign, newSheet } from '../model/types';
import { parseDesign, serializeDesign } from '../model/serialize';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const nc = (address: string): LadderNode => ({ kind: 'contact', type: 'nc', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });
const coil = (address: string): LadderOutput => ({ kind: 'coil', address });
const call = (instance: string, block: string, args: Record<string, string>): LadderOutput => ({ kind: 'call', address: instance, block, args });

let seq = 0;
const rung = (logic: LadderNode | undefined, outputs: LadderOutput[], extra: Partial<LadderRung> = {}): LadderRung => {
  seq += 1;
  // key order of LadderRung (id, comment, logic, outputs, disabled), the order a saved file has
  return { id: `b${seq}`, ...(extra.comment !== undefined ? { comment: extra.comment } : {}), ...(logic ? { logic } : {}), outputs, ...(extra.disabled !== undefined ? { disabled: extra.disabled } : {}) };
};

/** (START or RUN) and not STOP -> RUN, the classic self-holding rung as a block. */
const startStop: LadderBlock = {
  id: 'blk1',
  name: 'StartStop',
  comment: 'motor start / stop with self-holding',
  inputs: ['START', 'STOP'],
  outputs: ['RUN'],
  rungs: [rung(and(or(no('START'), no('RUN')), nc('STOP')), [coil('RUN')], { comment: 'hold in' })],
};

function machine(rungs: LadderRung[], blocks: LadderBlock[]): LadderMachine {
  const { ir, errors } = compileLadder(rungs, { blocks });
  expect(errors).toEqual([]);
  return new LadderMachine(ir);
}

const input = (m: LadderMachine, address: string, value: 0 | 1): void => {
  const ref = parseBitAddress(address);
  if (ref === null || ref === 'range') throw new Error(address);
  m.setInputBit(ref.index, value);
};
const out = (m: LadderMachine, address: string): number => {
  const ref = parseBitAddress(address);
  if (ref === null || ref === 'range') throw new Error(address);
  return m.bit(ref);
};

describe('a function block called twice', () => {
  const program = [
    rung(undefined, [call('M1', 'StartStop', { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' })]),
    rung(undefined, [call('M2', 'StartStop', { START: 'I0.2', STOP: 'I0.3', RUN: 'Q0.1' })]),
  ];

  it('runs each instance on its own addresses', () => {
    const m = machine(program, [startStop]);
    // press and release START of motor 1: it holds itself in
    input(m, 'I0.0', 1);
    m.scan();
    input(m, 'I0.0', 0);
    m.scan();
    expect(out(m, 'Q0.0')).toBe(1);
    expect(out(m, 'Q0.1')).toBe(0);
    // motor 2 is independent
    input(m, 'I0.2', 1);
    m.scan();
    input(m, 'I0.2', 0);
    m.scan();
    expect([out(m, 'Q0.0'), out(m, 'Q0.1')]).toEqual([1, 1]);
    // STOP of motor 1 releases only motor 1
    input(m, 'I0.1', 1);
    m.scan();
    input(m, 'I0.1', 0);
    m.scan();
    expect([out(m, 'Q0.0'), out(m, 'Q0.1')]).toEqual([0, 1]);
  });

  it('expands the body right after the calling rung and keeps the slots of the real rungs', () => {
    const plain = compileLadder([rung(no('I0.0'), [coil('Q0.0')]), rung(no('I0.1'), [coil('Q0.1')])]);
    const { entries } = expandBlocks(program, [startStop]);
    expect(entries.map((e) => (e.source.kind === 'main' ? `main${e.source.index}` : `${e.source.instance}#${e.source.inner}`))).toEqual(['main0', 'M1#1', 'main1', 'M2#1']);
    const { ir } = compileLadder(program, { blocks: [startStop] });
    // 2 real rungs + 2 block rungs, each with 32 slots
    expect(ir.slots).toBe(4 * 32);
    expect(plain.ir.slots).toBe(2 * 32);
    // the calling rungs keep the slots the editor computes from their position
    expect(ir.rungs.map((r) => r.index)).toEqual([0, 2, 1, 3]);
    expect(ir.rungs[0].slot).toBe(elementSlot(0, 31));
  });

  it('a block whose calling rung is false does nothing and its coils fall back', () => {
    const rungs = [rung(no('I0.7'), [call('M1', 'StartStop', { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' })])];
    const m = machine(rungs, [startStop]);
    input(m, 'I0.7', 1);
    input(m, 'I0.0', 1);
    m.scan();
    expect(out(m, 'Q0.0')).toBe(1);
    // EN drops: the body rung loses power, so RUN is 0 even though START is still held
    input(m, 'I0.7', 0);
    m.scan();
    expect(out(m, 'Q0.0')).toBe(0);
  });

  it('the body runs in the same scan as the call: a later rung sees the fresh output', () => {
    const rungs = [
      rung(undefined, [call('M1', 'StartStop', { START: 'I0.0', STOP: 'I0.1', RUN: 'M0.0' })]),
      rung(no('M0.0'), [coil('Q0.5')]),
    ];
    const m = machine(rungs, [startStop]);
    input(m, 'I0.0', 1);
    m.scan();
    expect(out(m, 'Q0.5')).toBe(1);
  });
});

describe('private memory of an instance', () => {
  /** a pulse stretcher: IN starts a private on-delay timer, OUT follows its done bit */
  const delay: LadderBlock = {
    id: 'blk2',
    name: 'Delay',
    inputs: ['IN'],
    outputs: ['OUT'],
    rungs: [rung(no('IN'), [{ kind: 'ton', address: '#T1', preset: '0.05' }]), rung(no('#T1'), [coil('OUT')])],
  };

  it('each instance has its own timer', () => {
    const rungs = [
      rung(undefined, [call('A', 'Delay', { IN: 'I0.0', OUT: 'Q0.0' })]),
      rung(undefined, [call('B', 'Delay', { IN: 'I0.1', OUT: 'Q0.1' })]),
    ];
    const m = machine(rungs, [delay]);
    input(m, 'I0.0', 1);
    for (let k = 0; k < 4; k++) m.scan();
    expect(out(m, 'Q0.0')).toBe(0); // 40 ms elapsed
    for (let k = 0; k < 4; k++) m.scan();
    expect(out(m, 'Q0.0')).toBe(1); // past 50 ms
    // instance B was never started
    expect(out(m, 'Q0.1')).toBe(0);
    // and starts from zero when its own input comes
    input(m, 'I0.1', 1);
    for (let k = 0; k < 3; k++) m.scan();
    expect(out(m, 'Q0.1')).toBe(0);
    expect(out(m, 'Q0.0')).toBe(1);
  });

  it('private timers lie beyond T32 and never clash with the learner timers', () => {
    const rungs = [rung(no('I0.2'), [{ kind: 'ton', address: 'T1', preset: '0.02' }]), rung(undefined, [call('A', 'Delay', { IN: 'I0.0', OUT: 'Q0.0' })])];
    const { ir, errors } = compileLadder(rungs, { blocks: [delay] });
    expect(errors).toEqual([]);
    const timers = ir.rungs.flatMap((r) => r.outputs).filter((o) => o.kind === 'ton');
    expect(timers.map((o) => o.timer)).toEqual([0, 32]);
    expect(ir.timers).toBe(33);
  });

  it('a private bit keeps its state between scans and between calls of the same instance only', () => {
    const latch: LadderBlock = {
      id: 'blk3',
      name: 'Latch',
      inputs: ['SET', 'RESET'],
      outputs: ['Q'],
      rungs: [
        rung(no('SET'), [{ kind: 'set', address: '#mem' }]),
        rung(no('RESET'), [{ kind: 'reset', address: '#mem' }]),
        rung(no('#mem'), [coil('Q')]),
      ],
    };
    const rungs = [
      rung(undefined, [call('L1', 'Latch', { SET: 'I0.0', RESET: 'I0.1', Q: 'Q0.0' })]),
      rung(undefined, [call('L2', 'Latch', { SET: 'I0.2', RESET: 'I0.3', Q: 'Q0.1' })]),
    ];
    const m = machine(rungs, [latch]);
    input(m, 'I0.0', 1);
    m.scan();
    input(m, 'I0.0', 0);
    m.scan();
    expect([out(m, 'Q0.0'), out(m, 'Q0.1')]).toEqual([1, 0]);
    input(m, 'I0.1', 1);
    m.scan();
    expect(out(m, 'Q0.0')).toBe(0);
  });

  it('private words and word formals', () => {
    const accumulate: LadderBlock = {
      id: 'blk4',
      name: 'Accumulate',
      inputs: ['STEP'],
      outputs: ['TOTAL'],
      rungs: [
        { id: 'r-a', outputs: [{ kind: 'add', address: '#W1', a: '#W1', b: 'STEP' }] },
        { id: 'r-b', outputs: [{ kind: 'mov', address: 'TOTAL', a: '#W1' }] },
      ],
    };
    const rungs = [
      rung(undefined, [call('A', 'Accumulate', { STEP: '5', TOTAL: 'MW0' })]),
      rung(undefined, [call('B', 'Accumulate', { STEP: 'MW9', TOTAL: 'MW1' })]),
    ];
    const m = machine(rungs, [accumulate]);
    m.words[9] = 100;
    for (let k = 0; k < 3; k++) m.scan();
    expect(m.words[0]).toBe(15);
    expect(m.words[1]).toBe(300);
  });

  it('timer formals keep their .ET suffix', () => {
    const watch: LadderBlock = {
      id: 'blk5',
      name: 'Watch',
      inputs: ['TIMER'],
      outputs: ['SLOW'],
      rungs: [rung({ kind: 'compare', op: 'ge', left: 'TIMER.ET', right: '0.03' }, [coil('SLOW')])],
    };
    const rungs = [
      rung(no('I0.0'), [{ kind: 'ton', address: 'T1', preset: '1' }]),
      rung(undefined, [call('W', 'Watch', { TIMER: 'T1', SLOW: 'Q0.0' })]),
    ];
    const m = machine(rungs, [watch]);
    input(m, 'I0.0', 1);
    for (let k = 0; k < 3; k++) m.scan();
    expect(out(m, 'Q0.0')).toBe(0);
    for (let k = 0; k < 2; k++) m.scan();
    expect(out(m, 'Q0.0')).toBe(1);
  });
});

describe('blocks that call blocks', () => {
  const inner: LadderBlock = { id: 'i', name: 'Inner', inputs: ['A'], outputs: ['B'], rungs: [rung(no('A'), [coil('B')])] };
  const outer: LadderBlock = {
    id: 'o',
    name: 'Outer',
    inputs: ['X'],
    outputs: ['Y'],
    rungs: [rung(undefined, [call('in1', 'Inner', { A: 'X', B: '#mid' })]), rung(no('#mid'), [coil('Y')])],
  };

  it('passes formals through', () => {
    const m = machine([rung(undefined, [call('o1', 'Outer', { X: 'I0.0', Y: 'Q0.0' })])], [inner, outer]);
    input(m, 'I0.0', 1);
    m.scan();
    expect(out(m, 'Q0.0')).toBe(1);
    input(m, 'I0.0', 0);
    m.scan();
    expect(out(m, 'Q0.0')).toBe(0);
  });

  it('the same instance name may be used inside two different outer instances', () => {
    const rungs = [rung(undefined, [call('o1', 'Outer', { X: 'I0.0', Y: 'Q0.0' })]), rung(undefined, [call('o2', 'Outer', { X: 'I0.1', Y: 'Q0.1' })])];
    const m = machine(rungs, [inner, outer]);
    input(m, 'I0.1', 1);
    m.scan();
    expect([out(m, 'Q0.0'), out(m, 'Q0.1')]).toEqual([0, 1]);
  });

  it('refuses a block that calls itself, directly or in a circle', () => {
    const self: LadderBlock = { id: 's', name: 'Self', inputs: [], outputs: [], rungs: [rung(undefined, [call('me', 'Self', {})])] };
    const a: LadderBlock = { id: 'a', name: 'Ping', inputs: [], outputs: [], rungs: [rung(undefined, [call('p', 'Pong', {})])] };
    const b: LadderBlock = { id: 'b', name: 'Pong', inputs: [], outputs: [], rungs: [rung(undefined, [call('q', 'Ping', {})])] };
    expect(compileLadder([rung(undefined, [call('x', 'Self', {})])], { blocks: [self] }).errors.map((e) => e.code)).toEqual(['blockRecursion']);
    expect(compileLadder([rung(undefined, [call('x', 'Ping', {})])], { blocks: [a, b] }).errors.map((e) => e.code)).toEqual(['blockRecursion']);
  });

  it('stops at the nesting limit', () => {
    const chain: LadderBlock[] = [];
    for (let k = 0; k < 6; k++) chain.push({ id: `c${k}`, name: `L${k}`, inputs: [], outputs: [], rungs: [rung(undefined, k < 5 ? [call(`n${k}`, `L${k + 1}`, {})] : [coil('Q0.0')])] });
    const errors = compileLadder([rung(undefined, [call('top', 'L0', {})])], { blocks: chain }).errors;
    expect(errors.map((e) => e.code)).toEqual(['blockDepth']);
    expect(errors[0].limit).toBe(4);
  });
});

describe('mistakes', () => {
  const codes = (rungs: LadderRung[], blocks: LadderBlock[] = [startStop]): LadderErrorCode[] => compileLadder(rungs, { blocks }).errors.map((e) => e.code);

  it('an unknown block', () => {
    const { errors } = compileLadder([rung(undefined, [coil('Q0.0')]), rung(undefined, [call('x', 'Nope', {})])], { blocks: [startStop] });
    expect(errors).toEqual([{ rung: 2, code: 'blockUnknown', text: 'Nope' }]);
  });

  it('a missing argument names the formal', () => {
    const { errors } = compileLadder([rung(undefined, [call('M1', 'StartStop', { START: 'I0.0', RUN: 'Q0.0' })])], { blocks: [startStop] });
    expect(errors).toEqual([{ rung: 1, code: 'blockArg', text: 'STOP' }]);
  });

  it('an instance name used twice', () => {
    const args = { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' };
    expect(codes([rung(undefined, [call('M1', 'StartStop', args)]), rung(undefined, [call('M1', 'StartStop', { ...args, RUN: 'Q0.1' })])])).toEqual(['blockInstance']);
  });

  it('an instance name that is not a name', () => {
    expect(codes([rung(undefined, [call('1 bad', 'StartStop', { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' })])])).toEqual(['blockName']);
  });

  it('a wrong address inside the block is reported with the block and its rung', () => {
    const bad: LadderBlock = { ...startStop, name: 'Bad', rungs: [rung(no('START'), [coil('RUN')]), rung(no('Z9.9'), [coil('RUN')])] };
    const { errors } = compileLadder([rung(undefined, [call('x', 'Bad', { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' })])], { blocks: [bad] });
    expect(errors).toEqual([{ rung: 1, code: 'badAddress', text: 'Z9.9', block: 'Bad', innerRung: 2 }]);
  });

  it('a calling rung with a problem is skipped, the rest still runs', () => {
    const rungs = [rung(no('I0.0'), [coil('Q0.0')]), rung(undefined, [call('x', 'Nope', {})]), rung(no('I0.1'), [coil('Q0.1')])];
    const { ir, errors } = compileLadder(rungs, { blocks: [] });
    expect(errors.map((e) => e.code)).toEqual(['blockUnknown']);
    expect(ir.rungs.map((r) => r.index)).toEqual([0, 2]);
  });

  it('a hidden address typed by the learner is rejected', () => {
    expect(codes([rung(no('$L0'), [coil('Q0.0')])])).toEqual(['badAddress']);
    expect(codes([rung(undefined, [{ kind: 'mov', address: '$MW40', a: '1' }])])).toEqual(['badAddress']);
    const sneaky: LadderBlock = { ...startStop, name: 'Sneaky', rungs: [rung(no('$L0'), [coil('RUN')])] };
    expect(codes([rung(undefined, [call('x', 'Sneaky', { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' })])], [sneaky])).toEqual(['badAddress']);
  });

  it('validates block names and formal parameters', () => {
    const dup = validateBlocks([startStop, { ...startStop, id: 'x', name: 'startstop' }]);
    expect(dup.map((e) => e.code)).toEqual(['blockName']);
    expect(validateBlocks([{ ...startStop, inputs: ['EN'] }]).map((e) => e.code)).toEqual(['blockName']);
    expect(validateBlocks([{ ...startStop, inputs: ['A', 'a'] }]).map((e) => e.code)).toEqual(['blockName']);
    expect(validateBlocks([{ ...startStop, name: 'two words' }]).map((e) => e.code)).toEqual(['blockName']);
    expect(validateBlocks([startStop])).toEqual([]);
  });

  it('a program without calls is not copied: the very same rung objects come back', () => {
    const rungs = [rung(no('I0.0'), [coil('Q0.0')])];
    const { entries } = expandBlocks(rungs, [startStop]);
    expect(entries[0].rung).toBe(rungs[0]);
  });
});

describe('blocks in a saved design', () => {
  it('saves and reopens, byte for byte', () => {
    const d = newDesign('blocks');
    const sheet = { ...newSheet('s1', 'Ladder'), kind: 'ladder' as const, ladder: [rung(undefined, [call('M1', 'StartStop', { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' })])] };
    const design = { ...d, sheets: [sheet], ladderBlocks: [startStop, newBlock('blk9', 'Fresh', 'r-fresh')] };
    const text = serializeDesign(design);
    const back = parseDesign(text);
    expect(back.ladderBlocks).toEqual(design.ladderBlocks);
    expect(back.sheets[0].ladder?.[0].outputs[0]).toEqual({ kind: 'call', address: 'M1', block: 'StartStop', args: { START: 'I0.0', STOP: 'I0.1', RUN: 'Q0.0' } });
    expect(serializeDesign(back)).toBe(text);
  });
});
