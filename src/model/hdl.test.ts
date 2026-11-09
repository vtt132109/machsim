/**
 * VHDL / Verilog export: the text of a known truth table and of known equations, the clocked and
 * tri-state forms, port naming, and a check that the exported logic still matches the simulator
 * (every row of the truth table is evaluated with the compiled program).
 */
import { describe, expect, it } from 'vitest';
import { compileLogicProgram, truthTableToEquations } from '../sim/devices/digital/logicExpr';
import { hdlExtension, hdlIdentifier, hdlModule, hdlText, needsClock, needsEnable, verilogText, vhdlText } from './hdl';

/** Compile a program for n inputs and m outputs (and fail the test on an error). */
function prog(text: string, nIn: number, nOut: number) {
  const p = compileLogicProgram(text, nIn, nOut);
  expect(p.errors).toEqual([]);
  return p;
}

describe('HDL export: a known truth table', () => {
  // half adder: SUM = A xor B, CARRY = A and B
  const table = ['A B | O0 O1', '0 0 | 0  0', '0 1 | 1  0', '1 0 | 1  0', '1 1 | 0  1'].join('\n');

  it('a truth table with named columns becomes equations', () => {
    const r = truthTableToEquations(table.replace('A B', 'I1 I0'), 2, 2);
    expect(r.errors).toEqual([]);
    expect(r.equations.split('\n')).toEqual([
      'O0 = (!I1 & I0) | (I1 & !I0)',
      'O1 = (I1 & I0)',
    ]);
  });

  it('exports the half adder as VHDL', () => {
    const p = prog('O0 = I0 ^ I1\nO1 = I0 & I1', 2, 2);
    const m = hdlModule(p, 2, 2, { name: 'half adder', inputs: ['A', 'B'], outputs: ['SUM', 'CARRY'], comment: ['MachSim'] });
    expect(needsClock(m)).toBe(false);
    expect(needsEnable(m)).toBe(false);
    expect(vhdlText(m)).toBe(
      [
        '-- MachSim',
        'library IEEE;',
        'use IEEE.STD_LOGIC_1164.all;',
        '',
        'entity half_adder is',
        '  port (',
        '    A     : in  std_logic;',
        '    B     : in  std_logic;',
        '    SUM   : out std_logic;',
        '    CARRY : out std_logic',
        '  );',
        'end entity half_adder;',
        '',
        'architecture rtl of half_adder is',
        'begin',
        '  SUM <= (A xor B);',
        '  CARRY <= (A and B);',
        'end architecture rtl;',
        '',
      ].join('\n'),
    );
  });

  it('exports the half adder as Verilog', () => {
    const p = prog('O0 = I0 ^ I1\nO1 = I0 & I1', 2, 2);
    const m = hdlModule(p, 2, 2, { name: 'half_adder', inputs: ['A', 'B'], outputs: ['SUM', 'CARRY'] });
    expect(verilogText(m)).toBe(
      [
        '`timescale 1ns / 1ps',
        '',
        'module half_adder (',
        '  input  wire A,',
        '  input  wire B,',
        '  output wire SUM,',
        '  output wire CARRY',
        ');',
        '  assign SUM = (A ^ B);',
        '  assign CARRY = (A & B);',
        'endmodule',
        '',
      ].join('\n'),
    );
  });

  it('a NOT of a plain operand needs no parentheses, a NOT of a group keeps them', () => {
    const p = prog('O0 = !I0\nO1 = !(I0 | I1)', 2, 2);
    const m = hdlModule(p, 2, 2, { name: 'inv' });
    expect(vhdlText(m)).toContain('  O0 <= not I0;');
    expect(vhdlText(m)).toContain('  O1 <= not (I0 or I1);');
    expect(verilogText(m)).toContain('  assign O0 = ~I0;');
    expect(verilogText(m)).toContain('  assign O1 = ~(I0 | I1);');
  });
});

describe('HDL export: registers and tri-state', () => {
  it('a registered output gets a clocked process and a register signal', () => {
    const p = prog('O0 := !O0', 1, 1);
    const m = hdlModule(p, 1, 1, { name: 'divider', inputs: ['EN'], outputs: ['Q'], clock: 'CLOCK' });
    expect(needsClock(m)).toBe(true);
    const v = vhdlText(m);
    expect(v).toContain('    CLOCK : in  std_logic;');
    expect(v).toContain("  signal q_Q : std_logic := '0';");
    expect(v).toContain('  Q <= q_Q;');
    expect(v).toContain('  registers : process (CLOCK) is');
    expect(v).toContain('    if rising_edge(CLOCK) then');
    expect(v).toContain('      q_Q <= not q_Q;');
    const vl = verilogText(m);
    expect(vl).toContain("  reg q_Q = 1'b0;");
    expect(vl).toContain('  always @(posedge CLOCK) begin');
    expect(vl).toContain('    q_Q <= ~q_Q;');
    expect(vl).toContain('  assign Q = q_Q;');
  });

  it('a per-output enable and the global enable become a tri-state assignment', () => {
    const p = prog('O0 = I0 & I1\nO0.oe = I2\nO1 = I0', 3, 2);
    const m = hdlModule(p, 3, 2, { name: 'bus' });
    expect(needsEnable(m)).toBe(true);
    const v = vhdlText(m);
    expect(v).toContain('    OE_N : in  std_logic;');
    expect(v).toContain("  O0 <= (I0 and I1) when (I2 = '1' and OE_N = '0') else 'Z';");
    expect(v).toContain("  O1 <= I0 when (OE_N = '0') else 'Z';");
    const vl = verilogText(m);
    expect(vl).toContain("  assign O0 = (I2 & ~OE_N) ? (I0 & I1) : 1'bz;");
    expect(vl).toContain("  assign O1 = (~OE_N) ? I0 : 1'bz;");
  });

  it('an output with no equation is driven low', () => {
    const p = prog('O0 = I0', 1, 2);
    const m = hdlModule(p, 1, 2, { name: 'partial' });
    expect(vhdlText(m)).toContain("  O1 <= '0';");
    expect(verilogText(m)).toContain("  assign O1 = 1'b0;");
  });

  it('combinational feedback reads the output port itself', () => {
    const p = prog('O0 = I0 | O0', 1, 1);
    const m = hdlModule(p, 1, 1, { name: 'latch', outputs: ['Q'] });
    expect(vhdlText(m)).toContain('  Q <= (I0 or Q);');
  });
});

describe('HDL export: names', () => {
  it('turns any text into a legal identifier', () => {
    expect(hdlIdentifier('Bộ đếm 2 bit', 'mod')).toBe('Bo_dem_2_bit');
    expect(hdlIdentifier('bộ cộng đầy đủ', 'mod')).toBe('bo_cong_day_du');
    expect(hdlIdentifier('3state', 'sig')).toBe('sig_3state');
    expect(hdlIdentifier('   ', 'O0')).toBe('O0');
    expect(hdlIdentifier('a-b.c', 'x')).toBe('a_b_c');
    expect(hdlIdentifier('__x__', 'y')).toBe('x');
  });

  it('duplicate port names are made unique', () => {
    const p = prog('O0 = I0 & I1', 2, 1);
    const m = hdlModule(p, 2, 1, { name: 'dup', inputs: ['SW', 'SW'] });
    expect(m.inputs).toEqual(['SW', 'SW_2']);
    expect(vhdlText(m)).toContain('  O0 <= (SW and SW_2);');
    expect(m.renamed).toEqual([{ from: 'SW', to: 'SW_2' }]);
  });

  it('reserved words of either language are escaped and reported', () => {
    const p = prog('O0 = I0 & I1', 2, 1);
    const m = hdlModule(p, 2, 1, { name: 'end', inputs: ['IN', 'input'], outputs: ['OUT'] });
    expect(m.inputs).toEqual(['IN_s', 'input_s']);
    expect(m.outputs[0].name).toBe('OUT_s');
    expect(m.name).toBe('end_s');
    expect(m.renamed).toEqual([
      { from: 'IN', to: 'IN_s' },
      { from: 'input', to: 'input_s' },
      { from: 'OUT', to: 'OUT_s' },
    ]);
    // the file says what it changed, in both languages
    expect(vhdlText(m)).toContain('-- exported with changed signal names (reserved word or duplicate): IN -> IN_s, input -> input_s, OUT -> OUT_s');
    expect(verilogText(m)).toContain('// exported with changed signal names');
  });

  it('an input named clk does not collide with the clock port of a registered output', () => {
    const p = prog('O0 := I1 & !O0', 2, 1);
    const m = hdlModule(p, 2, 1, { name: 'dem', inputs: ['clk', 'en'], outputs: ['Q'] });
    expect(m.inputs).toEqual(['clk', 'en']);
    expect(m.clock).toBe('CLK_2');
    const ports = [...vhdlText(m).matchAll(/^\s{4}(\w+)\s*:\s*(?:in|out)\s/gm)].map((x) => x[1].toLowerCase());
    expect(ports).toEqual(['clk', 'en', 'clk_2', 'q']);
  });

  it('missing names fall back to I0 / O0 and an empty module name to machsim_logic', () => {
    const p = prog('O0 = I0', 1, 1);
    const m = hdlModule(p, 1, 1, {});
    expect(m.name).toBe('machsim_logic');
    expect(m.inputs).toEqual(['I0']);
    expect(m.outputs[0].name).toBe('O0');
  });

  it('hdlText and hdlExtension pick the language', () => {
    const p = prog('O0 = I0', 1, 1);
    const m = hdlModule(p, 1, 1, { name: 'x' });
    expect(hdlText(m, 'vhdl')).toBe(vhdlText(m));
    expect(hdlText(m, 'verilog')).toBe(verilogText(m));
    expect(hdlExtension('vhdl')).toBe('.vhd');
    expect(hdlExtension('verilog')).toBe('.v');
  });
});

describe('HDL export matches the simulated logic', () => {
  /** Evaluate the printed VHDL assignment of a purely combinational output for one input word. */
  function evalVhdl(line: string, inputs: string[], word: number): number {
    // "  O0 <= (A and B) or (not C);" -> a JavaScript expression
    const rhs = line.slice(line.indexOf('<=') + 2).replace(/;$/, '').trim();
    let js = rhs.replace(/\bnot\b/g, '!').replace(/\band\b/g, '&').replace(/\bor\b/g, '|').replace(/\bxor\b/g, '^');
    js = js.replace(/'1'/g, '1').replace(/'0'/g, '0');
    inputs.forEach((n, k) => {
      js = js.replace(new RegExp(`\\b${n}\\b`, 'g'), String((word >> k) & 1));
    });
    // eslint-disable-next-line no-new-func
    return Number(new Function(`return (${js}) & 1;`)()) & 1;
  }

  it('every row of a 4-input function agrees with the compiled program', () => {
    const text = 'O0 = (I0 & I1) | (I2 ^ !I3)\nO1 = !(I0 | I1) & I2';
    const p = prog(text, 4, 2);
    const names = ['I0', 'I1', 'I2', 'I3'];
    const m = hdlModule(p, 4, 2, { name: 'check' });
    const lines = vhdlText(m).split('\n');
    const assign = (name: string) => lines.find((l) => l.trim().startsWith(`${name} <=`))!;
    for (let word = 0; word < 16; word++) {
      const inputs = names.map((_n, k) => (word >> k) & 1);
      const expected0 = p.outputs.find((o) => o.index === 0)!.fn(inputs, [0, 0]);
      const expected1 = p.outputs.find((o) => o.index === 1)!.fn(inputs, [0, 0]);
      expect(evalVhdl(assign('O0'), names, word), `O0 word ${word}`).toBe(expected0);
      expect(evalVhdl(assign('O1'), names, word), `O1 word ${word}`).toBe(expected1);
    }
  });

  it('a truth-table program exports logic that matches it row by row', () => {
    const table = ['I2 I1 I0 | O0', '0  0  1  | 1', '0  1  0  | 1', '1  -  -  | 1'].join('\n');
    const p = prog(table, 3, 1);
    const m = hdlModule(p, 3, 1, { name: 'majority' });
    const lines = vhdlText(m).split('\n');
    const assign = lines.find((l) => l.trim().startsWith('O0 <='))!;
    const names = ['I0', 'I1', 'I2'];
    for (let word = 0; word < 8; word++) {
      const inputs = names.map((_n, k) => (word >> k) & 1);
      expect(evalVhdl(assign, names, word), `word ${word}`).toBe(p.outputs[0].fn(inputs, [0]));
    }
  });
});
