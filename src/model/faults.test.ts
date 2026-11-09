/**
 * Fault injection: open / short / leakage pin faults change the simulated circuit exactly as
 * described (the drawing stays), survive a save / load round trip, and Auto fault places hidden,
 * reproducible faults that Reveal shows and Clear removes.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { clearFaults, FAULT_OPEN_R, faultInsert, hiddenFaultCount, isFaultable, isHiddenFaultElement, listFaults, placeAutoFaults, revealFaults, seededRandom, visibleFaults } from './faults';
import { parseDesign, serializeDesign } from './serialize';
import type { Design, PinFault } from './types';
import { runAnalyses } from '../sim';

/** 12 V across R1 (10 kΩ) + R2 (4.7 kΩ); returns the design and the divider output label OUT. */
function divider(): Design {
  const b = new DesignBuilder('divider');
  const v = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '12' });
  const g = b.part('sources/ground', 'G1', -200, 200);
  b.connect(v, '-', g, '1');
  const r1 = b.part('basic/resistor', 'R1', 0, 0, { value: '10k' });
  const r2 = b.part('basic/resistor', 'R2', 200, 0, { value: '4.7k' });
  b.connect(v, '+', r1, '1');
  b.connect(r1, '2', r2, '1');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r2, '2', '0');
  return b.design;
}

function withFaults(d: Design, refdes: string, faults: PinFault[]): Design {
  return { ...d, sheets: d.sheets.map((s) => ({ ...s, parts: s.parts.map((p) => (p.refdes === refdes ? { ...p, faults } : p)) })) };
}

function vout(d: Design): number {
  const build = buildNetlist(d, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
  expect(op.error).toBeUndefined();
  return op.vectors.find((v) => v.name === 'V(OUT)')!.re[0];
}

describe('pin faults', () => {
  it('the healthy divider gives 12·4.7/14.7 V', () => {
    expect(vout(divider())).toBeCloseTo((12 * 4.7) / 14.7, 6);
  });

  it('an open pin disconnects the part (1 GΩ remains)', () => {
    const v = vout(withFaults(divider(), 'R2', [{ pin: '1', kind: 'open' }]));
    // R2 + 1 GΩ in series: practically 12 V
    expect(v).toBeCloseTo((12 * (FAULT_OPEN_R + 4.7e3)) / (FAULT_OPEN_R + 14.7e3), 6);
    expect(v).toBeGreaterThan(11.99);
  });

  it('a short across R1 puts the full supply on OUT; a leakage forms a parallel resistor', () => {
    expect(vout(withFaults(divider(), 'R1', [{ pin: '1', kind: 'short', to: '2' }]))).toBeCloseTo(12, 3);
    const rpar = (10e3 * 10e3) / 20e3;
    expect(vout(withFaults(divider(), 'R1', [{ pin: '1', kind: 'leak', to: '2', r: 10e3 }]))).toBeCloseTo((12 * 4.7e3) / (4.7e3 + rpar), 6);
  });

  it('an open transistor base turns the stage off', () => {
    const b = new DesignBuilder('ce');
    const v = b.part('sources/dc-voltage', 'V1', -200, 0, { value: '12' });
    b.labelPin(v, '-', '0');
    const rc = b.part('basic/resistor', 'RC', 0, -200, { value: '1k' });
    const rb = b.part('basic/resistor', 'RB', -100, 0, { value: '100k' });
    const q = b.part('transistors/2n3904', 'Q1', 0, 0);
    b.connect(v, '+', rc, '1');
    b.connect(rc, '2', q, 'C');
    b.labelPin(q, 'C', 'OUT');
    b.connect(v, '+', rb, '1');
    b.connect(rb, '2', q, 'B');
    b.labelPin(q, 'E', '0');
    const healthy = vout(b.design);
    expect(healthy).toBeLessThan(2);
    expect(vout(withFaults(b.design, 'Q1', [{ pin: 'B', kind: 'open' }]))).toBeGreaterThan(11.9);
    // collector-emitter short: OUT at 0 V
    expect(vout(withFaults(b.design, 'Q1', [{ pin: 'C', kind: 'short', to: 'E' }]))).toBeLessThan(0.02);
  });

  it('bad faults are ERC errors, and only simulated multi-pin parts are faultable', () => {
    const build = buildNetlist(withFaults(divider(), 'R1', [{ pin: 'X', kind: 'open' }]), { includeAnalysis: false });
    expect(build.erc.some((m) => m.severity === 'error' && /fault on unknown pin 'X'/.test(m.message))).toBe(true);
    expect(() => faultInsert([{ pin: '1', kind: 'short' }], getPart('basic/resistor')!, 'R1', (p) => p)).toThrow(/needs another pin/);
    expect(isFaultable(getPart('basic/resistor'))).toBe(true);
    expect(isFaultable(getPart('sources/ground'))).toBe(false);
    expect(isFaultable(getPart('instruments/multimeter'))).toBe(false);
  });

  it('faults round-trip through the file format and old files load without them', () => {
    const d = withFaults(divider(), 'R1', [{ pin: '1', kind: 'leak', to: '2', r: 2200, hidden: true }]);
    const back = parseDesign(serializeDesign({ ...d, autoFault: { seed: 7, count: 1 } }));
    expect(back.sheets[0].parts.find((p) => p.refdes === 'R1')!.faults).toEqual([{ pin: '1', kind: 'leak', to: '2', r: 2200, hidden: true }]);
    expect(back.autoFault).toEqual({ seed: 7, count: 1 });
    expect(parseDesign(serializeDesign(divider())).sheets[0].parts.every((p) => p.faults === undefined)).toBe(true);
    expect(() => parseDesign(JSON.stringify({ ...JSON.parse(serializeDesign(divider())), sheets: [{ ...divider().sheets[0], parts: [{ ...divider().sheets[0].parts[2], faults: [{ pin: '1', kind: 'short' }] }] }] }))).toThrow(/is required for a short fault/);
  });
});

describe('auto fault', () => {
  const lookup = (id: string) => getPart(id);

  it('places hidden faults reproducibly from a seed', () => {
    const a = placeAutoFaults(divider(), lookup, { count: 2, seed: 42 });
    const b = placeAutoFaults(divider(), lookup, { count: 2, seed: 42 });
    expect(a.placed).toHaveLength(2);
    expect(a.placed).toEqual(b.placed);
    expect(a.placed.every((p) => ['R1', 'R2', 'V1'].includes(p.refdes) && p.fault.hidden)).toBe(true);
    expect(new Set(a.placed.map((p) => p.refdes)).size).toBe(2);
    expect(hiddenFaultCount(a.design)).toBe(2);
    expect(a.design.autoFault).toEqual({ seed: 42, count: 2, revealed: false });
    // hidden faults are not shown in the editor until revealed
    const inst = a.design.sheets[0].parts.find((p) => p.refdes === a.placed[0].refdes)!;
    expect(visibleFaults(inst, a.design)).toEqual([]);
    const revealed = revealFaults(a.design);
    expect(visibleFaults(revealed.sheets[0].parts.find((p) => p.refdes === a.placed[0].refdes)!, revealed)).toHaveLength(1);
    expect(listFaults(revealed)).toHaveLength(2);
  });

  it('the hidden fault really changes the simulation, and Clear restores it', () => {
    let changed = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { design } = placeAutoFaults(divider(), lookup, { count: 1, kinds: ['open', 'short'], seed });
      if (Math.abs(vout(design) - (12 * 4.7) / 14.7) > 0.05) changed++;
      const cleared = clearFaults(design);
      expect(cleared.autoFault).toBeUndefined();
      expect(listFaults(cleared)).toEqual([]);
      expect(vout(cleared)).toBeCloseTo((12 * 4.7) / 14.7, 6);
    }
    // an open / short on any of the three parts always moves V(OUT) (open V1 pins collapse it)
    expect(changed).toBe(6);
  });

  it('a new auto fault replaces the hidden ones but keeps faults the user set', () => {
    const mine = withFaults(divider(), 'R2', [{ pin: '2', kind: 'open' }]);
    const { design } = placeAutoFaults(mine, lookup, { count: 3, seed: 3 });
    const again = placeAutoFaults(design, lookup, { count: 1, seed: 4 }).design;
    expect(hiddenFaultCount(again)).toBe(1);
    expect(listFaults(again).filter((f) => !f.fault.hidden)).toEqual([{ refdes: 'R2', partId: 'basic/resistor', fault: { pin: '2', kind: 'open' } }]);
  });

  it('the seeded generator is deterministic and uniform enough', () => {
    const r = seededRandom(1);
    const xs = Array.from({ length: 2000 }, () => r());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
    expect(seededRandom(1)()).toBe(xs[0]);
  });
});

describe('hidden faults do not name the faulty part', () => {
  const lookup = (id: string) => getPart(id);
  it('hidden faults become R_HF_<n> / HF.<n>; revealed faults are named after the part and pin', () => {
    for (const seed of [1, 2, 3, 7, 11]) {
      const { design, placed } = placeAutoFaults(divider(), lookup, { count: 2, seed });
      const hidden = buildNetlist(design).netlist;
      const names = hidden.elements.map((e) => e.name);
      const nodes = hidden.elements.flatMap((e) => e.nodes);
      for (const p of placed) expect(names.some((n) => n.toUpperCase().startsWith(`${p.refdes}_F`.toUpperCase()) || n.toUpperCase().includes(`_${p.refdes}_F`.toUpperCase()))).toBe(false);
      expect(names.filter((n) => isHiddenFaultElement(n)).length).toBe(placed.length);
      expect(nodes.filter((n) => /\.fo_/i.test(n))).toEqual([]);
      const revealed = buildNetlist(revealFaults(design)).netlist.elements.map((e) => e.name);
      expect(revealed.filter((n) => isHiddenFaultElement(n))).toEqual([]);
      expect(revealed.filter((n) => /_f[osl]_/i.test(n)).length).toBe(placed.length);
    }
  });

  it('the simulated circuit is the same either way', () => {
    const { design } = placeAutoFaults(divider(), lookup, { count: 1, seed: 7 });
    const out = (d: Design) => {
      const build = buildNetlist(d);
      const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
      return r.scalars!['V(OUT)'];
    };
    expect(out(design)).toBeCloseTo(out(revealFaults(design)), 12);
    expect(Math.abs(out(design) - out(divider()))).toBeGreaterThan(1e-3);
  });
});
