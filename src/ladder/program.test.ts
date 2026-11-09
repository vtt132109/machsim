import { describe, expect, it } from 'vitest';
import { compileLadder, decodeLadderIr, encodeLadderIr, elementSlot, formatBitAddress, parseBitAddress, parseNumOperand, rungSlot, MAX_RUNG_ELEMENTS, SLOTS_PER_RUNG } from './program';
import type { LadderNode, LadderRung } from './types';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });

const rung = (id: string, logic: LadderNode | undefined, outputs: LadderRung['outputs']): LadderRung => (logic ? { id, logic, outputs } : { id, outputs });

describe('ladder addresses', () => {
  it('reads every bit area', () => {
    expect(parseBitAddress('I0.0')).toEqual({ area: 'I', index: 0 });
    expect(parseBitAddress('i1.3')).toEqual({ area: 'I', index: 11 });
    expect(parseBitAddress('Q2.7')).toEqual({ area: 'Q', index: 23 });
    expect(parseBitAddress('M15.7')).toEqual({ area: 'M', index: 127 });
    expect(parseBitAddress(' t4 ')).toEqual({ area: 'TD', index: 3 });
    expect(parseBitAddress('C32')).toEqual({ area: 'CD', index: 31 });
  });

  it('round-trips through the address text', () => {
    for (const text of ['I0.0', 'I7.7', 'Q3.2', 'M9.5', 'T1', 'C12']) {
      const ref = parseBitAddress(text);
      expect(ref).not.toBeNull();
      expect(formatBitAddress(ref as Exclude<typeof ref, null | 'range'>)).toBe(text);
    }
  });

  it('tells a bad address from one that is out of range', () => {
    expect(parseBitAddress('X0.0')).toBeNull();
    expect(parseBitAddress('I0.8')).toBeNull();
    expect(parseBitAddress('I8.0')).toBe('range');
    expect(parseBitAddress('M16.0')).toBe('range');
    expect(parseBitAddress('T33')).toBe('range');
    expect(parseBitAddress('T0')).toBe('range');
  });

  it('reads number operands and literals', () => {
    expect(parseNumOperand('T2.ET')).toEqual({ kind: 'et', n: 1 });
    expect(parseNumOperand('c3.cv')).toEqual({ kind: 'cv', n: 2 });
    expect(parseNumOperand('AI1')).toEqual({ kind: 'ai', n: 1 });
    expect(parseNumOperand('2.5')).toEqual({ kind: 'const', value: 2.5 });
    expect(parseNumOperand('1k')).toEqual({ kind: 'const', value: 1000 });
    // Vietnamese decimal comma, like every other value field of MachSim
    expect(parseNumOperand('4,7')).toEqual({ kind: 'const', value: 4.7 });
    expect(parseNumOperand('AI9')).toBe('range');
    expect(parseNumOperand('hello')).toBeNull();
  });
});

describe('compileLadder', () => {
  it('numbers the elements of a rung in reading order and the rung last', () => {
    const r = rung('r1', { kind: 'series', items: [no('I0.0'), { kind: 'parallel', items: [no('I0.1'), no('I0.2')] }] }, [
      { kind: 'coil', address: 'Q0.0' },
      { kind: 'coil', address: 'M0.0' },
    ]);
    const { ir, errors } = compileLadder([r]);
    expect(errors).toEqual([]);
    const expr = ir.rungs[0].expr!;
    expect(expr.k).toBe('and');
    const items = expr.k === 'and' ? expr.items : [];
    expect(items[0].k === 'bit' && items[0].slot).toBe(elementSlot(0, 0));
    const orNode = items[1];
    const branches = orNode.k === 'or' ? orNode.items : [];
    expect(branches[0].k === 'bit' && branches[0].slot).toBe(elementSlot(0, 1));
    expect(branches[1].k === 'bit' && branches[1].slot).toBe(elementSlot(0, 2));
    expect(ir.rungs[0].outputs.map((o) => o.slot)).toEqual([elementSlot(0, 3), elementSlot(0, 4)]);
    expect(ir.rungs[0].slot).toBe(rungSlot(0));
    expect(ir.slots).toBe(SLOTS_PER_RUNG);
  });

  it('keeps slot numbers of later rungs when an earlier rung is disabled or broken', () => {
    const rungs: LadderRung[] = [
      { id: 'a', disabled: true, logic: no('I0.0'), outputs: [{ kind: 'coil', address: 'Q0.0' }] },
      { id: 'b', logic: no('I0.1'), outputs: [{ kind: 'coil', address: 'Q0.1' }] },
    ];
    const { ir } = compileLadder(rungs);
    expect(ir.rungs).toHaveLength(1);
    expect(ir.rungs[0].index).toBe(1);
    expect(ir.rungs[0].slot).toBe(rungSlot(1));
  });

  it('allocates one edge memory per edge contact', () => {
    const { ir } = compileLadder([
      rung('r1', { kind: 'series', items: [{ kind: 'contact', type: 'rising', address: 'I0.0' }, { kind: 'contact', type: 'falling', address: 'I0.1' }] }, [{ kind: 'coil', address: 'Q0.0' }]),
    ]);
    expect(ir.edges).toBe(2);
  });

  it('counts the timers and counters and starts a count-down counter at its preset', () => {
    const { ir, errors } = compileLadder([
      rung('r1', no('I0.0'), [{ kind: 'ton', address: 'T2', preset: '3' }]),
      rung('r2', no('I0.1'), [{ kind: 'ctd', address: 'C1', preset: '5' }]),
      rung('r3', no('I0.2'), [{ kind: 'ctu', address: 'C2', preset: '4' }]),
    ]);
    expect(errors).toEqual([]);
    expect(ir.timers).toBe(2);
    expect(ir.counters).toBe(2);
    expect(ir.counterInit).toEqual([5, 0]);
  });

  it('reports every kind of problem with its rung number and leaves the good rungs running', () => {
    const rungs: LadderRung[] = [
      rung('r1', no('Z9.9'), [{ kind: 'coil', address: 'Q0.0' }]),
      rung('r2', no('I0.0'), [{ kind: 'coil', address: 'I0.1' }]),
      rung('r3', no('I0.0'), [{ kind: 'coil', address: 'T1' }]),
      rung('r4', no('I0.0'), [{ kind: 'ton', address: 'T1' }]),
      rung('r5', no('I0.0'), [{ kind: 'ton', address: 'T1', preset: 'xx' }]),
      rung('r6', no('I0.0'), []),
      rung('r7', { kind: 'compare', op: 'gt', left: 'AI0', right: 'nope' }, [{ kind: 'coil', address: 'Q0.1' }]),
      rung('r8', { kind: 'series', items: [] }, [{ kind: 'coil', address: 'Q0.2' }]),
      rung('r9', no('I0.0'), [{ kind: 'coil', address: 'Q0.3' }]),
    ];
    const { ir, errors } = compileLadder(rungs);
    expect(errors.map((e) => [e.rung, e.code])).toEqual([
      [1, 'badAddress'],
      [2, 'writeInput'],
      [3, 'writeTimerBit'],
      [4, 'presetRequired'],
      [5, 'badPreset'],
      [6, 'noOutput'],
      [7, 'notNumber'],
      [8, 'emptyGroup'],
    ]);
    expect(ir.rungs.map((r) => r.index)).toEqual([8]);
  });

  it('refuses a rung with more elements than one rung holds', () => {
    const items: LadderNode[] = Array.from({ length: MAX_RUNG_ELEMENTS }, (_, k) => no(`I${k % 8}.${k % 8}`));
    const { errors } = compileLadder([rung('big', { kind: 'series', items }, [{ kind: 'coil', address: 'Q0.0' }])]);
    expect(errors.map((e) => e.code)).toEqual(['range']);
  });

  it('clamps the scan period and round-trips through the card text', () => {
    const r = [rung('r1', no('I0.0'), [{ kind: 'coil', address: 'Q0.0' }])];
    expect(compileLadder(r, { scan: 1e-9 }).ir.scan).toBe(1e-4);
    expect(compileLadder(r, { scan: 10 }).ir.scan).toBe(1);
    const ir = compileLadder(r, { scan: 0.02, ports: [{ kind: 'di', index: 0, vth: 12, vhys: 2 }] }).ir;
    const text = encodeLadderIr(ir);
    // the program must be ONE token: no space, brace or quote, so it survives a SPICE netlist
    expect(text).toMatch(/^machsim-ladder1:[0-9a-f]+$/);
    expect(decodeLadderIr(text)).toEqual(ir);
    expect(() => decodeLadderIr('machsim-ladder1:zz')).toThrow(/malformed/);
    expect(() => decodeLadderIr('{}')).toThrow(/malformed/);
  });
});
