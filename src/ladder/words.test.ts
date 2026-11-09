/**
 * Word instructions of the ladder machine: MOV / ADD / SUB / MUL / DIV on memory words (signed
 * 16-bit integers) and analog outputs, and comparisons of words. Real numbers, written out.
 */
import { describe, expect, it } from 'vitest';
import { LadderMachine, toWord } from './machine';
import { compileLadder, parseBitAddress, parseNumOperand, parseWordDest } from './program';
import { analogOutCount, fillLadderProbes, ladderLive, ladderProbeKeys } from './probes';
import type { LadderNode, LadderOutput, LadderRung } from './types';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const rise = (address: string): LadderNode => ({ kind: 'contact', type: 'rising', address });
const cmp = (left: string, op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge', right: string): LadderNode => ({ kind: 'compare', op, left, right });
const mov = (dest: string, a: string): LadderOutput => ({ kind: 'mov', address: dest, a });
const math = (kind: 'add' | 'sub' | 'mul' | 'div', dest: string, a: string, b: string): LadderOutput => ({ kind, address: dest, a, b });

let seq = 0;
const rung = (logic: LadderNode | undefined, outputs: LadderOutput[]): LadderRung => {
  seq += 1;
  return logic ? { id: `w${seq}`, logic, outputs } : { id: `w${seq}`, outputs };
};

function machine(rungs: LadderRung[]): LadderMachine {
  const { ir, errors } = compileLadder(rungs);
  expect(errors).toEqual([]);
  return new LadderMachine(ir);
}

describe('addresses of words and analog outputs', () => {
  it('reads MWn and AQn as numbers and as destinations', () => {
    expect(parseNumOperand('MW0')).toEqual({ kind: 'mw', n: 0 });
    expect(parseNumOperand(' mw 31 ')).toEqual({ kind: 'mw', n: 31 });
    expect(parseNumOperand('MW32')).toBe('range');
    expect(parseNumOperand('AQ3')).toEqual({ kind: 'aq', n: 3 });
    expect(parseNumOperand('AQ4')).toBe('range');
    expect(parseWordDest('MW7')).toEqual({ area: 'mw', n: 7 });
    expect(parseWordDest('AQ1')).toEqual({ area: 'aq', n: 1 });
    expect(parseWordDest('Q0.0')).toBeNull();
    expect(parseWordDest('I0.0')).toBeNull();
    expect(parseWordDest('5')).toBeNull();
  });

  it('never accepts a generated "$" address from typed text', () => {
    expect(parseBitAddress('$L3')).toBeNull();
    expect(parseNumOperand('$MW40')).toBeNull();
    expect(parseBitAddress('$L3', true)).toEqual({ area: 'L', index: 3 });
    expect(parseNumOperand('$MW40', true)).toEqual({ kind: 'mw', n: 40 });
  });
});

describe('MOV / ADD / SUB / MUL / DIV', () => {
  it('moves a constant and adds, subtracts, multiplies', () => {
    const m = machine([
      rung(undefined, [mov('MW0', '7'), mov('MW1', '5')]),
      rung(no('I0.0'), [math('add', 'MW2', 'MW0', 'MW1'), math('sub', 'MW3', 'MW0', 'MW1'), math('mul', 'MW4', 'MW0', 'MW1')]),
    ]);
    m.scan();
    expect(m.words[0]).toBe(7);
    expect(m.words[1]).toBe(5);
    // the instructions only run while their rung carries power
    expect([m.words[2], m.words[3], m.words[4]]).toEqual([0, 0, 0]);
    m.setInputBit(0, 1);
    m.scan();
    expect([m.words[2], m.words[3], m.words[4]]).toEqual([12, 2, 35]);
  });

  it('divides into a word by truncating toward zero', () => {
    const m = machine([rung(undefined, [math('div', 'MW0', '7', '2'), math('div', 'MW1', '-7', '2'), math('div', 'MW2', '100', '8')])]);
    m.scan();
    expect([m.words[0], m.words[1], m.words[2]]).toEqual([3, -3, 12]);
  });

  it('keeps the exact quotient in an analog output', () => {
    const m = machine([rung(undefined, [math('div', 'AQ0', '7', '2')])]);
    m.scan();
    expect(m.analogOut[0]).toBeCloseTo(3.5, 12);
  });

  it('wraps a word like a 16-bit register', () => {
    expect(toWord(32767)).toBe(32767);
    expect(toWord(32768)).toBe(-32768);
    expect(toWord(-32769)).toBe(32767);
    expect(toWord(65536)).toBe(0);
    expect(toWord(2.5)).toBe(3);
    expect(toWord(-2.5)).toBe(-3);
    expect(toWord(Number.NaN)).toBe(0);
    const m = machine([rung(undefined, [math('mul', 'MW0', '300', '200'), math('add', 'MW1', '32767', '1')])]);
    m.scan();
    // 300 x 200 = 60000 = 60000 - 65536 = -5536 in 16 bits
    expect(m.words[0]).toBe(-5536);
    expect(m.words[1]).toBe(-32768);
  });

  it('division by zero writes nothing and is counted', () => {
    const m = machine([rung(undefined, [mov('MW1', '9'), math('div', 'MW0', 'MW1', 'MW2')])]);
    m.words[0] = 42;
    m.scan();
    expect(m.words[0]).toBe(42);
    expect(m.mathErrors).toBe(1);
    m.scan();
    expect(m.mathErrors).toBe(2);
  });

  it('refuses a division by the constant zero when compiling', () => {
    const { errors } = compileLadder([rung(undefined, [math('div', 'MW0', 'MW1', '0')])]);
    expect(errors.map((e) => e.code)).toEqual(['divZero']);
  });

  it('counts once per press with a rising-edge contact', () => {
    const m = machine([rung(rise('I0.0'), [math('add', 'MW0', 'MW0', '1')])]);
    for (let k = 0; k < 3; k++) {
      m.setInputBit(0, 1);
      m.scan();
      m.scan();
      m.scan();
      m.setInputBit(0, 0);
      m.scan();
    }
    expect(m.words[0]).toBe(3);
  });

  it('reads timers, counters and analog inputs as operands', () => {
    const m = machine([rung(no('I0.0'), [{ kind: 'ton', address: 'T1', preset: '0.05' }]), rung(undefined, [math('mul', 'MW0', 'AI0', '10'), mov('AQ1', 'T1.ET')])]);
    m.setAnalog(0, 2.4);
    m.setInputBit(0, 1);
    for (let k = 0; k < 3; k++) m.scan();
    expect(m.words[0]).toBe(24);
    // the timer starts on scan 1 (0 s), so scan 3 has counted two 10 ms periods
    expect(m.analogOut[1]).toBeCloseTo(0.02, 12);
  });

  it('writes the volts of an analog output exactly (no integer rounding)', () => {
    const m = machine([rung(undefined, [math('mul', 'AQ0', 'AI0', '2.5')])]);
    m.setAnalog(0, 1.234);
    m.scan();
    expect(m.analogOut[0]).toBeCloseTo(3.085, 12);
  });

  it('reports a destination that cannot be written and a missing operand', () => {
    expect(compileLadder([rung(undefined, [mov('Q0.0', '1')])]).errors.map((e) => e.code)).toEqual(['notWritable']);
    expect(compileLadder([rung(undefined, [mov('MW40', '1')])]).errors.map((e) => e.code)).toEqual(['range']);
    expect(compileLadder([rung(undefined, [{ kind: 'add', address: 'MW0', a: '1' }])]).errors.map((e) => e.code)).toEqual(['operandRequired']);
    expect(compileLadder([rung(undefined, [mov('MW0', 'banana')])]).errors.map((e) => e.code)).toEqual(['notNumber']);
  });
});

describe('comparing words', () => {
  it('compares a word with a constant and with another word', () => {
    const m = machine([
      rung(undefined, [math('add', 'MW0', 'MW0', '1')]),
      rung(cmp('MW0', 'ge', '3'), [{ kind: 'coil', address: 'Q0.0' }]),
      rung(cmp('MW0', 'eq', 'MW1'), [{ kind: 'coil', address: 'Q0.1' }]),
    ]);
    m.words[1] = 2;
    const q = (k: number) => m.outputs[k];
    m.scan();
    expect([q(0), q(1)]).toEqual([0, 0]); // MW0 = 1
    m.scan();
    expect([q(0), q(1)]).toEqual([0, 1]); // MW0 = 2 = MW1
    m.scan();
    expect([q(0), q(1)]).toEqual([1, 0]); // MW0 = 3
  });
});

describe('read-outs', () => {
  it('publishes words, analog outputs and the error count', () => {
    const { ir, errors } = compileLadder([rung(undefined, [mov('MW2', '11'), mov('AQ1', '1.5')])]);
    expect(errors).toEqual([]);
    expect(ir.words).toBe(3);
    expect(ir.aouts).toBe(2);
    expect(analogOutCount(ir)).toBe(2);
    const keys = ladderProbeKeys(ir);
    expect(keys).toEqual(expect.arrayContaining(['Lw0', 'Lw1', 'Lw2', 'Lo0', 'Lo1', 'Lerr']));
    const m = new LadderMachine(ir);
    m.scan();
    const into: Record<string, number> = {};
    fillLadderProbes(m, into);
    expect(into.Lw2).toBe(11);
    expect(into.Lo1).toBe(1.5);
    const live = ladderLive(Object.fromEntries(Object.entries(into).map(([k, v]) => [`${k}(a1)`.toLowerCase(), v])), 'A1', ir);
    expect(live?.words).toEqual([0, 0, 11]);
    expect(live?.analogOut).toEqual([0, 1.5]);
  });

  it('a program without word instructions publishes none (old programs are unchanged)', () => {
    const { ir } = compileLadder([rung(no('I0.0'), [{ kind: 'coil', address: 'Q0.0' }])]);
    expect(ir.words).toBeUndefined();
    expect(ir.aouts).toBeUndefined();
    expect(ladderProbeKeys(ir).some((k) => k.startsWith('Lw') || k.startsWith('Lo') || k === 'Lerr')).toBe(false);
  });

  it('limits an analog output port to the module range', () => {
    const { ir } = compileLadder([rung(undefined, [mov('AQ0', '15'), mov('AQ1', '-15')])], { ports: [{ kind: 'aq', index: 0, vmax: 10 }, { kind: 'aq', index: 1, vmax: 10 }] });
    const m = new LadderMachine(ir);
    m.scan();
    expect(m.analogOut[0]).toBe(15);
    expect(m.portOutput(0)).toBe(10);
    expect(m.portOutput(1)).toBe(-10);
  });
});
