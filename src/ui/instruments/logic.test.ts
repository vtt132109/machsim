import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../../sim/results';
import {
  LogicExpressionError,
  expressionToTable,
  minimizeSop,
  normalizeTable,
  parseLogicExpression,
  primeImplicants,
  sopText,
  sopToNand,
  tableFromVoltages,
  tableMinterms,
  tableToCanonical,
  tableToExpression,
  tablesEquivalent,
} from './logic';
import { converterInputSources, converterRowAssignments, parseLogicConverterSettings, resizeTable, tableFromRuns, wiredInputCount } from './logicConverter';
import { setLang } from '../../i18n';

// these tests assert the English UI texts (the app defaults to Vietnamese)
setLang('en');

/** Truth table of an n-input function given as a JS predicate over the input bits (A = MSB). */
function tableOf(n: number, f: (bits: number[]) => boolean): string {
  let s = '';
  for (let row = 0; row < 1 << n; row++) {
    const bits = Array.from({ length: n }, (_, v) => (row >> (n - 1 - v)) & 1);
    s += f(bits) ? '1' : '0';
  }
  return s;
}

describe('truth tables', () => {
  it('normalises length and characters', () => {
    expect(normalizeTable('1x-?', 3)).toBe('1XXX0000');
    expect(tableMinterms('01X1')).toEqual({ ones: [1, 3], dontCares: [2] });
  });

  it('reads voltages back into a table', () => {
    expect(tableFromVoltages([0.1, 4.9, Number.NaN, 2.6], 2.5)).toBe('01X1');
  });
});

describe('Quine–McCluskey minimisation', () => {
  it('finds the classic textbook prime implicants', () => {
    // f(A,B,C,D) = sum m(4,8,10,11,12,15) + d(9,14)
    const primes = primeImplicants(4, [4, 8, 10, 11, 12, 15], [9, 14]).map((p) => sopText([p], 4)).sort();
    expect(primes).toEqual(["AB'", 'AC', "AD'", "BC'D'"].sort());
    const min = minimizeSop(4, [4, 8, 10, 11, 12, 15], [9, 14]);
    // BC'D' is essential (m4), AC is essential (m11/m15); AD' or AB' covers m8
    expect(min.length).toBe(3);
    const text = sopText(min, 4);
    expect(text).toContain("BC'D'");
    expect(text).toContain('AC');
  });

  it('minimises standard functions', () => {
    expect(tableToExpression('0001', 2)).toBe('AB');
    expect(tableToExpression('0111', 2)).toBe('A + B');
    expect(tableToExpression('0110', 2)).toBe("A'B + AB'");
    expect(tableToExpression('1111', 2)).toBe('1');
    expect(tableToExpression('0000', 2)).toBe('0');
    // majority of three
    expect(tableToExpression(tableOf(3, ([a, b, c]) => a + b + c >= 2), 3)).toBe('AB + AC + BC');
    // don't cares absorb into a single literal
    expect(tableToExpression('01XX', 2)).toBe('B');
    expect(tableToExpression('0X1X', 2)).toBe('A');
  });

  it('solves a cyclic core exactly (no essential primes)', () => {
    // f = sum m(0,1,2,5,6,7): every minterm is covered by two primes; optimum has 3 terms
    const min = minimizeSop(3, [0, 1, 2, 5, 6, 7]);
    expect(min.length).toBe(3);
    const table = expressionToTable(sopText(min, 3), 3).table;
    expect(table).toBe(tableOf(3, (b) => [0, 1, 2, 5, 6, 7].includes(b[0] * 4 + b[1] * 2 + b[2])));
  });

  it('always produces an equivalent cover for every 3-input function', () => {
    for (let f = 0; f < 256; f++) {
      let table = '';
      for (let r = 0; r < 8; r++) table += (f >> r) & 1 ? '1' : '0';
      const expr = tableToExpression(table, 3);
      expect(expressionToTable(expr, 3).table, `function ${f}: ${expr}`).toBe(table);
    }
  });

  it('handles 8 inputs (parity is incompressible: 128 minterms)', () => {
    const parity = tableOf(8, (b) => b.reduce((s, x) => s + x, 0) % 2 === 1);
    const min = minimizeSop(8, tableMinterms(parity).ones);
    expect(min.length).toBe(128);
    const sparse = tableOf(8, (b) => b[0] === 1 && b[7] === 0);
    expect(tableToExpression(sparse, 8)).toBe("AH'");
  });

  it('respects don’t-cares when checking equivalence', () => {
    const spec = '0X1X';
    expect(tablesEquivalent(spec, expressionToTable(tableToExpression(spec, 2), 2).table)).toBe(true);
    expect(tablesEquivalent('0011', '0111')).toBe(false);
  });

  it('builds canonical sums of minterms', () => {
    expect(tableToCanonical('0110', 2)).toBe("A'B + AB'");
  });
});

describe('expression parsing', () => {
  it('evaluates operators with the documented precedence', () => {
    expect(expressionToTable("A'B + AB'", 2).table).toBe('0110');
    expect(expressionToTable('A ^ B', 2).table).toBe('0110');
    expect(expressionToTable('!(A & B)', 2).table).toBe('1110');
    expect(expressionToTable('~A | B', 2).table).toBe('1101');
    expect(expressionToTable('A*B+C', 3).table).toBe('01010111');
    // NOT binds tighter than AND, AND tighter than XOR, XOR tighter than OR
    expect(expressionToTable("AB'", 2).table).toBe('0010');
    expect(expressionToTable('A + B ^ C', 3).table).toBe(tableOf(3, ([a, b, c]) => a === 1 || (b ^ c) === 1));
    expect(expressionToTable("(A+B)'", 2).table).toBe('1000');
    expect(expressionToTable('1', 2).table).toBe('1111');
  });

  it('infers the input count and rejects bad syntax', () => {
    expect(parseLogicExpression('A + C').inputs).toBe(3);
    expect(() => parseLogicExpression('A + ')).toThrow(LogicExpressionError);
    expect(() => parseLogicExpression('A + Z')).toThrow(/A..H/);
    expect(() => parseLogicExpression('(A + B')).toThrow(/Missing/);
    expect(() => expressionToTable('D', 2)).toThrow(/4 inputs/);
  });

  it('rewrites a sum of products with NAND gates only', () => {
    for (const table of ['0110', '0001', '0111', '1000', '1101']) {
      const min = minimizeSop(2, tableMinterms(table).ones);
      const nand = sopToNand(min, 2);
      // only NAND structures: (xy)' groups, no '+'
      expect(nand).not.toContain('+');
      expect(expressionToTable(nand, 2).table, nand).toBe(table);
    }
    const maj = minimizeSop(3, tableMinterms(tableOf(3, ([a, b, c]) => a + b + c >= 2)).ones);
    expect(sopToNand(maj, 3)).toBe("((AB)'(AC)'(BC)')'");
  });
});

describe('logic converter instrument glue', () => {
  const binding = { drives: ['V_XLC1_A', 'V_XLC1_b', 'V_XLC1_D'] };

  it('parses settings', () => {
    const s = parseLogicConverterSettings({ inputs: '2', table: '011', vhigh: '3.3' });
    expect(s).toEqual({ inputs: 2, table: '0110', expr: '', vhigh: 3.3, threshold: 2.5 });
    expect(parseLogicConverterSettings({ inputs: '12' }).inputs).toBe(8);
  });

  it('maps drive sources to inputs and builds the per-row stimulus', () => {
    expect(converterInputSources(binding)).toEqual({ A: 'V_XLC1_A', B: 'V_XLC1_b', D: 'V_XLC1_D' });
    expect(wiredInputCount(binding)).toBe(4);
    const rows = converterRowAssignments({ drives: ['V_X_A', 'V_X_B'] }, 2, 5);
    expect(rows).toEqual([
      { row: 0, values: { V_X_A: 0, V_X_B: 0 } },
      { row: 1, values: { V_X_A: 0, V_X_B: 5 } },
      { row: 2, values: { V_X_A: 5, V_X_B: 0 } },
      { row: 3, values: { V_X_A: 5, V_X_B: 5 } },
    ]);
  });

  it('resizes truth tables keeping A as the MSB', () => {
    // f(A,B) = A'B ; with a third input C the function must not depend on C
    expect(resizeTable('0100', 2, 3)).toBe('00110000');
    expect(expressionToTable("A'B", 3).table).toBe('00110000');
    // dropping C fixes it at 0
    expect(resizeTable('01101001', 3, 2)).toBe('0110');
    expect(resizeTable('1X', 1, 1)).toBe('1X');
  });

  it('reads the truth table back from per-row operating points', () => {
    const op = (v: number): AnalysisResult => ({ type: 'op', title: 'OP', vectors: [{ name: 'V(y)', unit: 'V', re: Float64Array.of(v) }], warnings: [] });
    const result: AnalysisResult = {
      type: 'batch',
      title: 'Logic converter',
      vectors: [],
      warnings: [],
      runs: [
        { label: '0', result: op(0.02) },
        { label: '1', result: op(4.98) },
        { label: '2', result: { ...op(0), error: 'no convergence' } },
        { label: '3', result: op(0.01) },
      ],
    };
    expect(tableFromRuns(result, { kind: 'voltage', pos: 'y', neg: '0' }, 2.5, 4)).toBe('01X0');
    expect(tableFromRuns({ ...result, runs: [] }, { kind: 'voltage', pos: 'y', neg: '0' }, 2.5, 4)).toBeNull();
  });
});
