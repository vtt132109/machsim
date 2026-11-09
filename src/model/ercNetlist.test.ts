/**
 * ERC features of round 3 step 7 as the netlister produces them: the pin-type matrix on real
 * schematics, NC markers on pins and the hidden supply pins of digital ICs.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { pinPairKey } from './ercMatrix';
import type { Design, ErcMessage } from './types';

const detail = (erc: ErcMessage[], id: string) => erc.filter((m) => m.detail?.id === id);

/** Two ideal NAND gates whose outputs are wired to the same net. */
function shortedOutputs(): DesignBuilder {
  const b = new DesignBuilder('Shorted outputs');
  const g1 = b.part('misc-digital/nand2', 'U1', 0, 0);
  const g2 = b.part('misc-digital/nand2', 'U2', 0, 160);
  const s1 = b.part('sources/logic-switch', 'S1', -200, -20, { state: 'true' });
  const gnd = b.part('sources/ground', 'GND1', -200, 120);
  b.connect(s1, 'OUT', g1, 'A');
  b.wire(b.pin(g1, 'A'), b.pin(g1, 'B'));
  b.wire(b.pin(g2, 'A'), b.pin(g2, 'B'));
  b.wire(b.pin(g2, 'A'), b.pin(g1, 'A'));
  b.wire(b.pin(g1, 'Y'), { x: 120, y: 0 }, { x: 120, y: 160 }, b.pin(g2, 'Y'));
  void gnd;
  return b;
}

describe('pin-type matrix on a schematic', () => {
  it('reports two logic outputs on one net as an error', () => {
    const build = buildNetlist(shortedOutputs().design);
    const clash = detail(build.erc, 'pinTypeClash');
    expect(clash).toHaveLength(1);
    expect(clash[0].severity).toBe('error');
    expect(clash[0].code).toBe('pin-type');
    expect(clash[0].detail?.params).toMatchObject({ a: 'output', b: 'output' });
    expect(String(clash[0].detail?.params?.left)).toContain('U1.Y');
    expect(String(clash[0].detail?.params?.right)).toContain('U2.Y');
    expect(clash[0].refdes).toBe('U1');
    expect(clash[0].sheetId).toBe('sheet1');
  });

  it('is switched off by Design.erc.pinTypes = false', () => {
    const d: Design = { ...shortedOutputs().design, erc: { pinTypes: false } };
    expect(detail(buildNetlist(d).erc, 'pinTypeClash')).toEqual([]);
  });

  it('follows an override in the design (error -> warning)', () => {
    const d: Design = { ...shortedOutputs().design, erc: { matrix: { [pinPairKey('output', 'output')]: 'warning' } } };
    const clash = detail(buildNetlist(d).erc, 'pinTypeClash');
    expect(clash.map((m) => m.severity)).toEqual(['warning']);
  });

  it('says nothing about an output feeding inputs', () => {
    const b = new DesignBuilder('Chain');
    const g1 = b.part('misc-digital/nand2', 'U1', 0, 0);
    const g2 = b.part('misc-digital/not', 'U2', 160, 0);
    const g3 = b.part('misc-digital/not', 'U3', 160, 120);
    const s1 = b.part('sources/logic-switch', 'S1', -200, -20, { state: 'true' });
    const gnd = b.part('sources/ground', 'GND1', -200, 120);
    b.connect(s1, 'OUT', g1, 'A');
    b.wire(b.pin(g1, 'A'), b.pin(g1, 'B'));
    b.connect(g1, 'Y', g2, 'A');
    b.wire(b.pin(g2, 'A'), b.pin(g3, 'A'));
    void gnd;
    const build = buildNetlist(b.design);
    expect(detail(build.erc, 'pinTypeClash')).toEqual([]);
  });

  it('exempts the supply rails, so many power pins on VCC are fine', () => {
    const b = new DesignBuilder('Rail');
    const u1 = b.part('analog/lm741', 'U1', 0, 0);
    const u2 = b.part('analog/lm741', 'U2', 0, 200);
    const vcc1 = b.part('sources/vcc', 'VCC1', -60, -120, { value: '12' });
    const vcc2 = b.part('sources/vcc', 'VCC2', -60, 80, { value: '12' });
    b.connect(vcc1, '1', u1, 'V+');
    b.connect(vcc2, '1', u2, 'V+');
    b.wire(b.pin(u1, 'V+'), b.pin(u2, 'V+'));
    const build = buildNetlist(b.design);
    expect(detail(build.erc, 'pinTypeClash')).toEqual([]);
  });
});

/** A 7400 with one gate wired; pin 13 (4B) is left open. */
function openPin(): DesignBuilder {
  const b = new DesignBuilder('Open pin');
  const u1 = b.part('ttl/7400', 'U1', 0, 0);
  const s1 = b.part('sources/logic-switch', 'S1', -260, -60, { state: 'true' });
  const gnd = b.part('sources/ground', 'GND1', -260, 160);
  b.connect(s1, 'OUT', u1, '1A');
  void gnd;
  return b;
}

describe('NC markers', () => {
  it('warns about open pins until they are marked NC', () => {
    const b = openPin();
    const before = buildNetlist(b.design).erc.filter((m) => m.code === 'floating-pin');
    expect(before.length).toBeGreaterThan(5);
    const openPins = before.map((m) => m.pin!);
    const design = b.design;
    design.sheets[0].parts.find((p) => p.refdes === 'U1')!.ncPins = openPins;
    const after = buildNetlist(design).erc.filter((m) => m.code === 'floating-pin');
    expect(after).toEqual([]);
  });

  it('marks only the pins it is given', () => {
    const b = openPin();
    const design = b.design;
    design.sheets[0].parts.find((p) => p.refdes === 'U1')!.ncPins = ['1B'];
    const after = buildNetlist(design).erc.filter((m) => m.code === 'floating-pin');
    expect(after.some((m) => m.pin === '1B')).toBe(false);
    expect(after.some((m) => m.pin === '2A')).toBe(true);
  });

  it('reports a marked pin that is wired after all', () => {
    const b = openPin();
    const design = b.design;
    const u1 = design.sheets[0].parts.find((p) => p.refdes === 'U1')!;
    u1.ncPins = ['1A'];
    const erc = buildNetlist(design).erc;
    const wired = detail(erc, 'ncPinConnected');
    expect(wired).toHaveLength(1);
    expect(wired[0].severity).toBe('error');
    expect(wired[0].detail?.params).toMatchObject({ refdes: 'U1', pin: '1A' });
  });

  it('keeps the netlist unchanged: an NC pin still gets its private node and shunt', () => {
    const b = openPin();
    const plain = buildNetlist(b.design);
    const design = b.design;
    design.sheets[0].parts.find((p) => p.refdes === 'U1')!.ncPins = ['4B'];
    const marked = buildNetlist(design);
    expect(marked.netlist.elements.map((e) => e.name)).toEqual(plain.netlist.elements.map((e) => e.name));
    expect(marked.partNets.U1['4B']).toBe(plain.partNets.U1['4B']);
  });
});

/** A 7400 and a VCC symbol (wired to nothing: the IC's supply pins are hidden). */
function hiddenPower(withVcc: boolean): Design {
  const b = new DesignBuilder('Hidden power');
  const u1 = b.part('ttl/7400', 'U1', 0, 0);
  const s1 = b.part('sources/logic-switch', 'S1', -260, -60, { state: 'true' });
  const gnd = b.part('sources/ground', 'GND1', -260, 160);
  b.connect(s1, 'OUT', u1, '1A');
  if (withVcc) {
    const r = b.part('basic/resistor', 'R1', 300, 0);
    const vcc = b.part('sources/vcc', 'VCC1', 300, -120, { value: '5' });
    const g2 = b.part('sources/ground', 'GND2', 300, 120);
    b.connect(vcc, '1', r, '1');
    b.connect(r, '2', g2, '1');
    void g2;
  }
  void gnd;
  return b.design;
}

/** Supply nodes of the gate elements of U1 (the trailing nodes of each 'A' element). */
function supplyNodes(design: Design): { nodes: string[]; pwr: number }[] {
  const build = buildNetlist(design);
  return build.netlist.elements
    .filter((e) => e.type === 'A' && e.name.startsWith('A_U1'))
    .map((e) => ({ nodes: e.nodes.slice(-Number(e.params?.pwr ?? 1)), pwr: Number(e.params?.pwr ?? 1) }));
}

describe('hidden supply pins of digital ICs', () => {
  it('joins the named VCC net when the design has one', () => {
    const got = supplyNodes(hiddenPower(true));
    expect(got).toHaveLength(4);
    expect(got.every((g) => g.pwr === 2 && g.nodes[0] === 'VCC' && g.nodes[1] === '0')).toBe(true);
  });

  it('falls back to the nominal levels when there is no supply net', () => {
    const got = supplyNodes(hiddenPower(false));
    expect(got.every((g) => g.pwr === 1 && g.nodes[0] === '0')).toBe(true);
    expect(buildNetlist(hiddenPower(false)).erc.filter((m) => m.detail?.id === 'digitalNoPower')).toEqual([]);
  });

  it('ignores supply nets when the ERC option says "ideal"', () => {
    const design: Design = { ...hiddenPower(true), erc: { hiddenPower: 'ideal' } };
    expect(supplyNodes(design).every((g) => g.pwr === 1 && g.nodes[0] === '0')).toBe(true);
  });

  it('makes a missing supply net an error when the ERC option says "required"', () => {
    const design: Design = { ...hiddenPower(false), erc: { hiddenPower: 'required' } };
    const erc = buildNetlist(design).erc;
    const missing = detail(erc, 'digitalNoPower');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0].severity).toBe('error');
    expect(missing[0].detail?.params).toMatchObject({ net: 'VCC' });
  });

  it('wires the supply net in "required" mode when it exists', () => {
    const design: Design = { ...hiddenPower(true), erc: { hiddenPower: 'required' } };
    expect(supplyNodes(design).every((g) => g.pwr === 2 && g.nodes[0] === 'VCC')).toBe(true);
  });

  it('lets the ERC option override the digital simulation mode', () => {
    const ideal: Design = { ...hiddenPower(true), digital: { mode: 'real' }, erc: { hiddenPower: 'ideal' } };
    expect(supplyNodes(ideal).every((g) => g.pwr === 1)).toBe(true);
    // without the ERC option the digital mode still decides, as before the option existed
    const real: Design = { ...hiddenPower(false), digital: { mode: 'real' } };
    expect(detail(buildNetlist(real).erc, 'digitalNoPower').length).toBeGreaterThan(0);
  });

  it('still honours the part parameter "Power pins = ideal"', () => {
    const design = hiddenPower(true);
    design.sheets[0].parts.find((p) => p.refdes === 'U1')!.params.power = 'ideal';
    expect(supplyNodes(design).every((g) => g.pwr === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// round 4 step 6: inputs with no driver, and the output pin types of the 74xx catalogue

describe('undriven inputs', () => {
  /** Two NAND inputs wired to each other and to nothing else. */
  function floatingInputs(): DesignBuilder {
    const b = new DesignBuilder('Undriven');
    const g1 = b.part('misc-digital/nand2', 'U1', 0, 0);
    const g2 = b.part('misc-digital/nand2', 'U2', 0, 200);
    b.part('sources/ground', 'GND1', -200, 120);
    // U1.A — U1.B — U2.A: three input pins on one net, nothing driving them
    b.wire(b.pin(g1, 'A'), b.pin(g1, 'B'));
    b.wire(b.pin(g1, 'B'), { x: -120, y: 20 }, { x: -120, y: 200 }, b.pin(g2, 'A'));
    b.wire(b.pin(g2, 'A'), b.pin(g2, 'B'));
    b.labelPin(g1, 'Y', 'OUT1');
    b.labelPin(g2, 'Y', 'OUT2');
    return b;
  }

  it('reports a net whose pins are all inputs, naming them', () => {
    const erc = buildNetlist(floatingInputs().design).erc;
    const found = detail(erc, 'undrivenInput');
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe('warning');
    expect(found[0].code).toBe('pin-type');
    expect(String(found[0].detail?.params?.pins)).toContain('U1.A');
    expect(Number(found[0].detail?.params?.n)).toBeGreaterThanOrEqual(3);
    expect(found[0].sheetId).toBe('sheet1');
  });

  it('says nothing once an output drives the net', () => {
    const b = floatingInputs();
    const s1 = b.part('sources/logic-switch', 'S1', -320, -20, { state: 'true' });
    // the switch output reaches the net at U1.A (−30, 0)
    b.wire(b.pin(s1, 'OUT'), { x: -260, y: -20 }, { x: -260, y: 0 }, { x: -30, y: 0 });
    const erc = buildNetlist(b.design).erc;
    expect(detail(erc, 'undrivenInput')).toEqual([]);
  });

  it('says nothing about a passive pull-up, or a supply rail', () => {
    const b = new DesignBuilder('Pull-up');
    const g1 = b.part('misc-digital/nand2', 'U1', 0, 0);
    const r = b.part('basic/resistor', 'R1', -200, 0, { value: '10k' });
    const v = b.part('sources/dc-voltage', 'V1', -400, 40, { value: '5' });
    b.part('sources/ground', 'GND1', -400, 160);
    b.connect(r, '2', g1, 'A');
    b.wire(b.pin(g1, 'A'), b.pin(g1, 'B'));
    b.connect(v, '+', r, '1');
    b.wire(b.pin(v, '-'), { x: -400, y: 160 });
    b.labelPin(g1, 'Y', 'OUT');
    expect(detail(buildNetlist(b.design).erc, 'undrivenInput')).toEqual([]);
  });

  it('is switched off by Design.erc.undrivenInputs = false', () => {
    const d: Design = { ...floatingInputs().design, erc: { undrivenInputs: false } };
    expect(detail(buildNetlist(d).erc, 'undrivenInput')).toEqual([]);
  });

  it('an NC marker on the pins silences it (the learner meant them open)', () => {
    const b = floatingInputs();
    const d = b.design;
    const marked: Design = {
      ...d,
      sheets: [{ ...d.sheets[0], parts: d.sheets[0].parts.map((p) => (p.refdes === 'U1' || p.refdes === 'U2' ? { ...p, ncPins: ['A', 'B'] } : p)) }],
      erc: { ncConnected: false },
    };
    expect(detail(buildNetlist(marked).erc, 'undrivenInput')).toEqual([]);
  });
});
