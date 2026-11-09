/**
 * PLD wizard: signal-name translation, the block the wizard picks, the schematic it builds, and a
 * simulation of the generated design that checks every row of the truth table the learner wrote.
 */
import { describe, expect, it } from 'vitest';
import { buildPld, pldDesign, pldPartFor, translateNames } from './pldDesign';
import { verilogText, vhdlText } from '../hdl';
import { buildNetlist } from '../netlister';
import { runAnalyses } from '../../sim';
import { findVector } from '../../sim/results';
import type { Design } from '../types';

describe('PLD wizard: names', () => {
  it('rewrites the learner’s names into the index form of the block', () => {
    const r = translateNames('Q = A & B\nCARRY = A and B', ['A', 'B'], ['Q', 'CARRY']);
    expect(r.nameErrors).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.text).toBe('O0 = I0 & I1\nO1 = I0 and I1');
  });

  it('keeps the operator words and reports an unknown signal', () => {
    const r = translateNames('Q = NOT A OR Z', ['A'], ['Q']);
    expect(r.text).toBe('O0 = NOT I0 OR Z');
    expect(r.unknown).toEqual(['Z']);
  });

  it('rewrites a truth-table header as well', () => {
    const r = translateNames(['A B | Q', '0 1 | 1', '1 0 | 1'].join('\n'), ['A', 'B'], ['Q']);
    expect(r.text.split('\n')[0]).toBe('I0 I1 | O0');
  });

  it('rejects empty, duplicate, reserved and malformed names', () => {
    expect(translateNames('', ['A', 'A'], ['Q']).nameErrors).toEqual([{ name: 'A', reason: 'duplicate' }]);
    expect(translateNames('', ['AND'], ['Q']).nameErrors).toEqual([{ name: 'AND', reason: 'reserved' }]);
    expect(translateNames('', ['2A'], ['Q']).nameErrors).toEqual([{ name: '2A', reason: 'syntax' }]);
    expect(translateNames('', ['A'], ['Q b']).nameErrors).toEqual([{ name: 'Q b', reason: 'syntax' }]);
  });

  it('a name that also exists as an output is rejected as a duplicate', () => {
    expect(translateNames('', ['Q'], ['Q']).nameErrors).toEqual([{ name: 'Q', reason: 'duplicate' }]);
  });
});

describe('PLD wizard: block choice', () => {
  it('picks the smallest block that fits', () => {
    expect(pldPartFor(2, 1)).toBe('misc-digital/pld-2x2');
    expect(pldPartFor(3, 2)).toBe('misc-digital/pld-4x4');
    expect(pldPartFor(4, 5)).toBe('misc-digital/pld-8x8');
    expect(pldPartFor(9, 3)).toBe('misc-digital/pld-16x8');
    expect(pldPartFor(17, 1)).toBeNull();
    expect(pldPartFor(2, 9)).toBeNull();
  });

  it('reports when the signal counts do not fit any block', () => {
    const b = buildPld({ inputs: Array.from({ length: 20 }, (_, k) => `A${k}`), outputs: ['Q'], program: 'Q = A0' });
    expect(b.partId).toBeNull();
    expect(b.errors.some((e) => e.includes('no PLD block'))).toBe(true);
  });

  it('reports the compiler errors with their line numbers', () => {
    const b = buildPld({ inputs: ['A', 'B'], outputs: ['Q'], program: 'Q = A &\nQ = B' });
    expect(b.errors.length).toBeGreaterThan(0);
    expect(b.errors[0]).toMatch(/^line 1:/);
  });
});

describe('PLD wizard: build and export', () => {
  const spec = {
    inputs: ['A', 'B', 'CIN'],
    outputs: ['SUM', 'COUT'],
    program: ['SUM = A ^ B ^ CIN', 'COUT = A & B | A & CIN | B & CIN'].join('\n'),
    name: 'full adder',
  };

  it('compiles a full adder and chooses the 4x4 block', () => {
    const b = buildPld(spec);
    expect(b.errors).toEqual([]);
    expect(b.partId).toBe('misc-digital/pld-4x4');
    expect(b.blockProgram.split('\n')[0]).toBe('SUM = A ^ B ^ CIN'.replace('SUM', 'O0').replace('A', 'I0').replace('B', 'I1').replace('CIN', 'I2'));
    expect(b.clocked).toBe(false);
    expect(b.triState).toBe(false);
  });

  it('exports the adder with the learner’s port names', () => {
    const b = buildPld(spec);
    const v = vhdlText(b.hdl!);
    expect(v).toContain('entity full_adder is');
    expect(v).toContain('    A    : in  std_logic;');
    expect(v).toContain('    SUM  : out std_logic;');
    expect(v).toContain('  SUM <= ((A xor B) xor CIN);');
    expect(v).toContain('  COUT <= (((A and B) or (A and CIN)) or (B and CIN));');
    const vl = verilogText(b.hdl!);
    expect(vl).toContain('module full_adder (');
    expect(vl).toContain('  assign SUM = ((A ^ B) ^ CIN);');
  });

  it('a registered output makes the block clocked and adds the clock port', () => {
    const b = buildPld({ inputs: ['EN'], outputs: ['Q'], program: 'Q := Q ^ EN', name: 'toggle' });
    expect(b.errors).toEqual([]);
    expect(b.clocked).toBe(true);
    expect(vhdlText(b.hdl!)).toContain('  registers : process (CLK) is');
  });

  it('builds a sheet with the block, a label per signal and a probe per output', () => {
    const r = pldDesign(spec);
    expect(r.errors).toEqual([]);
    const sheet = r.design.sheets[0];
    expect(sheet.parts).toHaveLength(1);
    expect(sheet.parts[0].partId).toBe('misc-digital/pld-4x4');
    expect(sheet.parts[0].params.program).toBe(r.blockProgram);
    expect(sheet.labels.map((l) => l.name).sort()).toEqual(['A', 'B', 'CIN', 'COUT', 'SUM']);
    expect(sheet.probes.map((p) => p.name).sort()).toEqual(['COUT', 'SUM']);
    expect(r.design.title).toBe('full adder');
  });

  it('a clocked program also labels the clock pin', () => {
    const r = pldDesign({ inputs: ['EN'], outputs: ['Q'], program: 'Q := Q ^ EN' });
    expect(r.design.sheets[0].labels.map((l) => l.name).sort()).toEqual(['CLK', 'EN', 'Q']);
  });
});

describe('PLD wizard: the generated block simulates the table', () => {
  /** Drive the input labels with DC sources and solve the operating point. */
  function evaluate(design: Design, inputs: string[], word: number, outputs: string[]): number[] {
    const d: Design = structuredClone(design);
    const sheet = d.sheets[0];
    let seq = 0;
    inputs.forEach((name, k) => {
      const label = sheet.labels.find((l) => l.name === name)!;
      // a DC source on the signal's net: the label already names it, so a second label connects it
      const x = label.x - 120;
      const y = label.y;
      seq += 1;
      sheet.parts.push({ id: `src${seq}`, partId: 'sources/dc-voltage', refdes: `V${seq}`, x, y, rotation: 0, mirror: false, params: { value: (word >> k) & 1 ? '5' : '0' } });
      sheet.labels.push({ id: `sl${seq}`, x, y: y - 30, name, rotation: 0 });
      sheet.parts.push({ id: `gnd${seq}`, partId: 'sources/ground', refdes: `GND${seq}`, x, y: y + 30, rotation: 0, mirror: false, params: {} });
    });
    const build = buildNetlist(d);
    const errors = build.erc.filter((e) => e.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
    const r = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] })[0];
    expect(r.error, r.error).toBeUndefined();
    return outputs.map((name) => {
      const v = findVector(r, `V(${name})`);
      if (!v) throw new Error(`no vector V(${name})`);
      return v.re[0] > 2.5 ? 1 : 0;
    });
  }

  it('a full adder built by the wizard adds correctly for all eight input words', () => {
    const r = pldDesign({
      inputs: ['A', 'B', 'CIN'],
      outputs: ['SUM', 'COUT'],
      program: ['SUM = A ^ B ^ CIN', 'COUT = A & B | A & CIN | B & CIN'].join('\n'),
      name: 'adder',
    });
    expect(r.errors).toEqual([]);
    for (let word = 0; word < 8; word++) {
      const bits = [(word >> 0) & 1, (word >> 1) & 1, (word >> 2) & 1];
      const sum = bits[0] + bits[1] + bits[2];
      const [s, c] = evaluate(r.design, ['A', 'B', 'CIN'], word, ['SUM', 'COUT']);
      expect(s, `SUM for word ${word}`).toBe(sum & 1);
      expect(c, `COUT for word ${word}`).toBe(sum >= 2 ? 1 : 0);
    }
  });

  it('a truth table written by the learner simulates row for row', () => {
    const table = ['A B | Q', '0 0 | 1', '0 1 | 0', '1 0 | 0', '1 1 | 1'].join('\n'); // XNOR
    const r = pldDesign({ inputs: ['A', 'B'], outputs: ['Q'], program: table, name: 'xnor' });
    expect(r.errors).toEqual([]);
    expect(r.partId).toBe('misc-digital/pld-2x2');
    for (let word = 0; word < 4; word++) {
      const a = word & 1;
      const b = (word >> 1) & 1;
      const [q] = evaluate(r.design, ['A', 'B'], word, ['Q']);
      expect(q, `word ${word}`).toBe(a === b ? 1 : 0);
    }
  });
});
