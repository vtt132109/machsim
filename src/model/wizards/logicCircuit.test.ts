/**
 * Logic converter "expression → circuit": the generated AND-OR and NAND-only circuits compute the
 * expression's truth table in the simulator (one operating point per row), have no stray ERC
 * warnings, and use NAND gates only in NAND mode.
 */
import { describe, expect, it } from 'vitest';
import { buildNetlist } from '../netlister';
import { runAnalyses } from '../../sim';
import type { ElementIR } from '../../sim/netlist';
import { expressionToTable, inputBit, minimizeSop, tableMinterms } from '../../ui/instruments/logic';
import { logicCircuit } from './logicCircuit';

const NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Simulated output per truth-table row ('0' / '1'). */
function simulatedTable(expr: string, nandOnly: boolean): { want: string; got: string; gates: Record<string, number>; warnings: string[] } {
  const { table, inputs: n } = expressionToTable(expr);
  const { ones, dontCares } = tableMinterms(table);
  const res = logicCircuit(minimizeSop(n, ones, dontCares), n, { nandOnly });
  const sheet = res.design.sheets[0];
  // drive every input label from a DC source far away
  for (let v = 0; v < n; v++) {
    const x = -300 - 60 * v;
    sheet.parts.push({ id: `src${v}`, partId: 'sources/dc-voltage', refdes: `VIN${v}`, x, y: 600, rotation: 0, mirror: false, params: { value: '0' } });
    sheet.parts.push({ id: `g${v}`, partId: 'sources/ground', refdes: `GNDI${v}`, x, y: 630, rotation: 0, mirror: false, params: {} });
    sheet.labels.push({ id: `lab${v}`, x, y: 570, name: NAMES[v], rotation: 0 });
  }
  // and load the output so it is not a single-pin net
  sheet.parts.push({ id: 'rl', partId: 'basic/resistor', refdes: 'RL', x: -600, y: 800, rotation: 90, mirror: false, params: { value: '100k' } });
  sheet.parts.push({ id: 'rlg', partId: 'sources/ground', refdes: 'GNDL', x: -600, y: 830, rotation: 0, mirror: false, params: {} });
  sheet.labels.push({ id: 'labout', x: -600, y: 770, name: 'OUT', rotation: 0 });
  const b = buildNetlist(res.design, { includeAnalysis: false });
  let got = '';
  for (let row = 0; row < 1 << n; row++) {
    const elements: ElementIR[] = b.netlist.elements.map((e) => {
      const m = /VIN(\d)$/i.exec(e.name);
      if (!m) return e;
      const level = inputBit(row, Number(m[1]), n) ? 5 : 0;
      return { ...e, source: { ...e.source, dc: level } };
    });
    const [r] = runAnalyses({ ...b.netlist, elements, analyses: [{ type: 'op' }] });
    if (r.error) throw new Error(r.error);
    const out = r.vectors.find((x) => x.name.toUpperCase() === 'V(OUT)')!.re[0];
    got += out > 2.5 ? '1' : '0';
  }
  return { want: table, got, gates: res.gates, warnings: b.erc.map((m) => m.message) };
}

const EXPRESSIONS = ["A'B + AB'", 'AB + C', "A'B'C + AB'C' + ABC + A'BC'", "AB + CD + A'C'", 'A', "A'", "ABCDE + A'B'", 'A^B^C^D', "AB'C + D'E + AC'E' + B'D"];

describe('logic converter: expression to gate circuit', () => {
  for (const expr of EXPRESSIONS) {
    for (const nandOnly of [false, true]) {
      it(`${expr} as ${nandOnly ? 'NAND-only' : 'AND-OR'} circuit`, () => {
        const r = simulatedTable(expr, nandOnly);
        // don't-care rows never occur in these expressions
        expect(r.got).toBe(r.want);
        expect(r.warnings).toEqual([]);
        const kinds = Object.keys(r.gates);
        if (nandOnly) expect(kinds.every((k) => k.startsWith('nand'))).toBe(true);
        else expect(kinds.some((k) => k.startsWith('nand'))).toBe(false);
      });
    }
  }

  it('constant functions drive the output from a DC source', () => {
    const one = logicCircuit([{ mask: 0, value: 0 }], 2);
    expect(one.constant).toBe(1);
    expect(one.design.sheets[0].parts.some((p) => p.partId === 'sources/dc-voltage' && p.params.value === '5')).toBe(true);
    const zero = logicCircuit([], 2);
    expect(zero.constant).toBe(0);
  });

  it('uses the requested net names', () => {
    const r = logicCircuit([{ mask: 0b11, value: 0b10 }], 2, { names: ['XLC1_A', 'XLC1_B'], output: 'XLC1_OUT' });
    const labels = r.design.sheets[0].labels.map((l) => l.name);
    expect(labels).toContain('XLC1_A');
    expect(labels).toContain('XLC1_B_N');
    expect(labels).toContain('XLC1_OUT');
    expect(r.inputs).toEqual(['XLC1_A', 'XLC1_B']);
  });
});
