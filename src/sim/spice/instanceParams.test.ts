/**
 * Instance parameters in SPICE decks: LTspice's series resistance Rser= on V / C / L is turned into
 * an explicit series resistor, and any other instance parameter a MachSim device does not use is
 * reported (instead of being stored and silently ignored). MachSim's own exported netlists never
 * trigger the warning.
 */
import { describe, expect, it } from 'vitest';
import { parseSpice, writeSpice } from '.';
import { runAnalyses } from '..';
import { listParts } from '../../library';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { EXAMPLES } from '../../ui/integration/exampleDesigns';
import { LESSONS } from '../../learn/lessons';
import { loadAllGroups } from '../../library';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

function op(text: string) {
  const r = parseSpice(text);
  expect(r.errors).toEqual([]);
  const [res] = runAnalyses(r.netlist);
  return { warnings: r.warnings, s: res.scalars ?? {}, netlist: r.netlist };
}

const paramWarnings = (warnings: readonly string[]) => warnings.filter((w) => /instance parameter/.test(w));

describe('Rser= (LTspice series resistance)', () => {
  it('on a voltage source: the 1 Ω source resistance divides with the 10 Ω load', () => {
    const o = op('* rser\nV1 in 0 5 Rser=1\nR1 in 0 10\n.op\n.end\n');
    expect(o.s['V(in)']).toBeCloseTo((5 * 10) / 11, 9);
    expect(o.s['I(V1)']).toBeCloseTo(-5 / 11, 9);
    expect(paramWarnings(o.warnings)).toEqual([]);
  });

  it('on an inductor: the DC path keeps the 10 Ω winding resistance', () => {
    const o = op('* rser\nV1 in 0 1\nL1 in out 1m Rser=10\nR1 out 0 10\n.op\n.end\n');
    expect(o.s['V(out)']).toBeCloseTo(0.5, 9);
  });

  it('on a capacitor: the ESR appears in series (AC magnitude at a frequency where C is a short)', () => {
    const r = parseSpice('* esr\nV1 in 0 AC 1\nC1 in out 1 Rser=5\nR1 out 0 5\n.ac lin 1 1meg 1meg\n.end\n');
    const [res] = runAnalyses(r.netlist);
    const v = res.vectors.find((x) => x.name.toLowerCase() === 'v(out)')!;
    expect(Math.hypot(v.re[0], v.im?.[0] ?? 0)).toBeCloseTo(0.5, 6);
    expect(r.netlist.elements.map((e) => e.name)).toEqual(['V1', 'C1', 'RC1_rser', 'R1']);
  });

  it('Rser=0 adds nothing, an expression stays an expression, and it works inside a subcircuit', () => {
    const zero = parseSpice('* z\nV1 a 0 1 Rser=0\nR1 a 0 1\n.end\n');
    expect(zero.netlist.elements.map((e) => e.name)).toEqual(['V1', 'R1']);
    const expr = parseSpice('* e\n.param rs=2\nV1 a 0 1 Rser={rs}\nR1 a 0 1\n.end\n');
    expect(expr.netlist.elements.find((e) => e.name === 'RV1_rser')?.stringParams).toEqual({ value: 'rs' });
    const sub = op('* sub\n.subckt bat p n\nV1 p n 9 Rser=2\n.ends\nX1 top 0 bat\nR1 top 0 7\n.op\n.end\n');
    expect(sub.s['V(top)']).toBeCloseTo(7, 9);
  });
});

describe('unsupported instance parameters are reported', () => {
  it('names the parameter and the element', () => {
    // (Cpar on V, Rpar / Cpar on L and Lser / Rpar / Cpar on C are modelled since round 3: see
    // dialect.test.ts; the parasitics an element type does not have are still reported)
    const r = parseSpice('* typos\nV1 a 0 1 Rpar=1k\nR1 a 0 10 foo=3\nL1 a b 1m Lser=1n\nR2 b 0 1\nC1 a 0 1u esl=1n\nD1 a 0 dmod pj=2\n.model dmod d\nI1 0 a 1m Rser=5\n.end\n');
    const w = paramWarnings(r.warnings).join('\n');
    for (const name of ["V1: instance parameter 'Rpar'", "R1: instance parameter 'foo'", "L1: instance parameter 'Lser'", "C1: instance parameter 'esl'", "D1: instance parameter 'pj'", "I1: instance parameter 'Rser'"]) expect(w).toContain(name);
    // the warning carries the card's line number
    expect(paramWarnings(r.warnings)[0]).toMatch(/^line 2:/);
  });

  it('reports a subcircuit instance parameter the subcircuit does not declare', () => {
    const deck = (override: string) => `* x\n.subckt amp in out params: gain=2\nE1 out 0 in 0 {gain}\n.ends\nV1 a 0 1\nX1 a b amp ${override}\nR1 b 0 1k\n.op\n.end\n`;
    const typo = parseSpice(deck('gian=10'));
    expect(typo.warnings).toContain("line 6: X1: instance parameter 'gian' is not a parameter of subcircuit 'amp' and is ignored");
    const fine = op(deck('GAIN=10'));
    expect(paramWarnings(fine.warnings)).toEqual([]);
    expect(fine.s['V(b)']).toBeCloseTo(10, 9);
  });

  it('does not warn about parameters the devices use', () => {
    const r = parseSpice(
      [
        '* fine',
        'R1 a 0 1k tc=1m,2u m=2 temp=50',
        'C1 a 0 1u ic=1 m=2',
        'L1 a b 1m ic=1m',
        'D1 a 0 dmod area=2 off ic=0.6 temp=30 dtemp=1',
        'Q1 c b 0 qmod area=1 m=2 ic=0.7,5 dtemp=2',
        'J1 d g 0 jmod area=1 ic=1,0',
        'M1 d g 0 0 nmod w=10u l=1u ad=1p as=1p pd=1u ps=1u nrd=1 nrs=1 m=1 off',
        'S1 a 0 c 0 smod on',
        'T1 a 0 b 0 z0=50 td=1n',
        '.model dmod d',
        '.model qmod npn',
        '.model jmod njf',
        '.model nmod nmos',
        '.model smod sw',
        '.end',
      ].join('\n'),
    );
    expect(paramWarnings(r.warnings)).toEqual([]);
  });

  it("MachSim's own exported netlists (examples, lesson solutions, every library part) read back without such warnings", () => {
    const designs = [...EXAMPLES.map((e) => ({ label: e.file, d: e.build() })), ...LESSONS.map((l) => ({ label: l.id, d: l.solution() }))];
    for (const p of listParts()) {
      const b = new DesignBuilder(p.id);
      b.part(p.id, `${p.prefix || 'U'}1`, 0, 0);
      designs.push({ label: p.id, d: b.design });
    }
    const found: string[] = [];
    for (const { label, d } of designs) {
      const text = writeSpice(buildNetlist(d).netlist);
      for (const w of paramWarnings(parseSpice(text).warnings)) found.push(`${label}: ${w}`);
    }
    expect(found).toEqual([]);
    expect(designs.length).toBeGreaterThan(2500);
  });
});
