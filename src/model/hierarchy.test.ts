/**
 * Hierarchy, connectors and buses end to end: designs built with DesignBuilder, netlisted,
 * simulated (OP) and compared with flat equivalents or hand-computed values.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { blockPartDef, childInstanceCounts, childPorts, cyclicChildren, getChild, hierarchyTree } from './hierarchy';
import { parseDesign, serializeDesign } from './serialize';
import { busMembers, isVectorName, mergeMembers, parseBusName } from './bus';
import { buildBom } from './bom';
import { runAnalyses } from '../sim';
import { parseSpice, writeSpice } from '../sim/spice';
import type { Netlist } from '../sim/netlist';
import type { Design, NetlistBuild } from './types';

function op(netlist: Netlist): Record<string, number> {
  const [r] = runAnalyses({ ...netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars ?? {};
}

/** V(node) from an OP result, node name compared case-insensitively ("0" = 0 V). */
function v(res: Record<string, number>, node: string): number {
  if (node === '0') return 0;
  const key = Object.keys(res).find((k) => k.toLowerCase() === `v(${node.toLowerCase()})`);
  if (key === undefined) throw new Error(`no V(${node}) in ${Object.keys(res).join(', ')}`);
  return res[key];
}

const errors = (b: NetlistBuild) => b.erc.filter((m) => m.severity === 'error').map((m) => m.message);
const details = (b: NetlistBuild) => b.erc.map((m) => m.detail?.id ?? m.code);

/**
 * Two levels: root -> HB "Stage" (param gainR) -> SC "Div" (params rtop, rbot).
 * Div:   IN -R1(rtop)- OUT(=MID) -R2(rbot)- gnd
 * Stage: IN -> SC1.IN ; SC1.OUT = X ; R3 1k X -> OUT ; R4 1k VCC -> X (VCC symbol inside)
 * Root:  V1 10 V on A ; HB_i.IN = A ; HB_i.OUT = B_i ; RL_i 1k B_i -> gnd
 */
function hierarchical(instances: Record<string, string>[]): Design {
  const b = new DesignBuilder('Hier');
  const div = b.child('Div', { variables: { rtop: '1k', rbot: '1k' } });
  const r1 = b.part('basic/resistor', 'R1', 0, 0, { value: '{rtop}' });
  const r2 = b.part('basic/resistor', 'R2', 200, 0, { value: '{rbot}' });
  b.labelPin(r1, '1', 'IN', { kind: 'hier' });
  b.labelPin(r1, '2', 'MID');
  b.labelPin(r2, '1', 'MID');
  b.labelPin(r2, '1', 'OUT', { kind: 'hier', rotation: 180 });
  b.labelPin(r2, '2', 'gnd');

  const stage = b.child('Stage', { kind: 'hierarchical', variables: { gainR: '2k' } });
  const sc = b.block(div, 'SC1', 0, 0, { rtop: '{gainR}' });
  b.labelPin(sc, 'IN', 'IN', { kind: 'hier' });
  b.labelPin(sc, 'OUT', 'X');
  const r3 = b.part('basic/resistor', 'R3', 300, 0, { value: '1k' });
  b.labelPin(r3, '1', 'X');
  b.labelPin(r3, '2', 'OUT', { kind: 'hier' });
  const vcc = b.part('sources/vcc', 'VCC', 300, -200, { voltage: '5' });
  const r4 = b.part('basic/resistor', 'R4', 300, -100, { value: '1k' });
  // a local label with the power symbol's name on the same sheet is the same net
  b.labelPin(r4, '1', 'VCC');
  b.labelPin(vcc, '1', 'VCC');
  b.labelPin(r4, '2', 'X');

  b.root();
  const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
  b.labelPin(v1, '+', 'A');
  b.labelPin(v1, '-', 'gnd');
  instances.forEach((params, i) => {
    const hb = b.block(stage, `HB${i + 1}`, 200, i * 300, params);
    b.labelPin(hb, 'IN', 'A');
    b.labelPin(hb, 'OUT', `B${i + 1}`);
    const rl = b.part('basic/resistor', `RL${i + 1}`, 500, i * 300, { value: '1k' });
    b.labelPin(rl, '1', `B${i + 1}`);
    b.labelPin(rl, '2', 'gnd');
  });
  return b.design;
}

/** The same circuit drawn flat. */
function flat(instances: { gainR: number }[]): Design {
  const b = new DesignBuilder('Flat');
  const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '10' });
  b.labelPin(v1, '+', 'A');
  b.labelPin(v1, '-', 'gnd');
  const vcc = b.part('sources/vcc', 'VCC', 0, -300, { voltage: '5' });
  b.labelPin(vcc, '1', 'VCC');
  instances.forEach((p, i) => {
    const n = i + 1;
    const y = i * 300;
    const r1 = b.part('basic/resistor', `R1_${n}`, 100, y, { value: String(p.gainR) });
    b.labelPin(r1, '1', 'A');
    b.labelPin(r1, '2', `MID${n}`);
    const r2 = b.part('basic/resistor', `R2_${n}`, 200, y, { value: '1k' });
    b.labelPin(r2, '1', `MID${n}`);
    b.labelPin(r2, '2', 'gnd');
    const r3 = b.part('basic/resistor', `R3_${n}`, 300, y, { value: '1k' });
    b.labelPin(r3, '1', `MID${n}`);
    b.labelPin(r3, '2', `B${n}`);
    const r4 = b.part('basic/resistor', `R4_${n}`, 400, y, { value: '1k' });
    b.labelPin(r4, '1', 'VCC');
    b.labelPin(r4, '2', `MID${n}`);
    const rl = b.part('basic/resistor', `RL${n}`, 500, y, { value: '1k' });
    b.labelPin(rl, '1', `B${n}`);
    b.labelPin(rl, '2', 'gnd');
  });
  return b.design;
}

describe('hierarchical design (two levels)', () => {
  it('builds block symbols from the hierarchical connectors', () => {
    const d = hierarchical([{}]);
    const div = getChild(d, 'child1')!;
    expect(childPorts(div).map((p) => [p.name, p.side])).toEqual([
      ['IN', 'left'],
      ['OUT', 'right'],
    ]);
    const def = blockPartDef(div);
    expect(def.prefix).toBe('SC');
    expect(def.symbol.pins.map((p) => p.name)).toEqual(['IN', 'OUT']);
    expect(def.params.map((p) => [p.key, p.default])).toEqual([
      ['rtop', '1k'],
      ['rbot', '1k'],
    ]);
    expect(blockPartDef(getChild(d, 'child2')!).prefix).toBe('HB');
    // cached per child object
    expect(blockPartDef(div)).toBe(def);
  });

  it('simulates exactly like the flat equivalent', () => {
    const hb = buildNetlist(hierarchical([{}]));
    expect(errors(hb)).toEqual([]);
    expect(hb.erc.map((m) => m.message)).toEqual([]);
    const fl = buildNetlist(flat([{ gainR: 2000 }]));
    expect(errors(fl)).toEqual([]);
    const a = op(hb.netlist);
    const f = op(fl.netlist);
    // nodal analysis by hand: MID: (10-m)/2k + (5-m)/1k = m/1k + (m-b)/1k ; b = (m-b)/1k*1k -> b = m/2
    // -> 5 - m/2 + 5 - m = m + m/2 -> 10 = 3m -> m = 10/3
    expect(v(f, 'MID1')).toBeCloseTo(10 / 3, 9);
    expect(v(a, hb.partNets.HB1.OUT)).toBeCloseTo(v(f, 'B1'), 12);
    // clear hierarchical names: the Stage net X of instance HB1 is "XHB1.X"
    expect(hb.partNets['HB1/R3']['1']).toBe('XHB1.X');
    expect(v(a, 'XHB1.X')).toBeCloseTo(v(f, 'MID1'), 12);
    // a part two levels down maps through both port lists
    expect(hb.partNets['HB1/SC1/R1']).toEqual({ '1': 'A', '2': 'XHB1.X' });
    expect(hb.instances).toEqual([
      { path: 'HB1', xpath: 'XHB1', childId: 'child2', subckt: 'HB_Stage' },
      { path: 'HB1/SC1', xpath: 'XHB1.XSC1', childId: 'child1', subckt: 'SC_Div' },
    ]);
  });

  it('netlists to .subckt / X with the global rail hoisted and declared', () => {
    const hb = buildNetlist(hierarchical([{}]));
    const n = hb.netlist;
    expect(Object.keys(n.subckts).sort()).toEqual(['hb_stage', 'sc_div']);
    expect(n.subckts.sc_div.ports).toEqual(['IN', 'OUT']);
    expect(n.subckts.hb_stage.ports).toEqual(['IN', 'OUT']);
    // the instance parameter gainR = 2k is evaluated into the nested divider (rtop = {gainR})
    const r1 = n.subckts.sc_div.elements.find((e) => e.name === 'R1')!;
    expect(r1.value).toBe(2000);
    const x = n.elements.find((e) => e.type === 'X')!;
    expect(x).toMatchObject({ name: 'XHB1', model: 'HB_Stage', nodes: ['A', 'B1'] });
    // the VCC symbol inside the block drives the global rail from the top level
    expect(n.elements.some((e) => e.name === 'V_PWR_VCC')).toBe(true);
    expect(n.subckts.hb_stage.elements.some((e) => e.name === 'V_PWR_VCC')).toBe(false);
    expect(n.params['.global']).toBe('VCC');
    // SPICE text round trip simulates the same
    const text = writeSpice(n);
    expect(text).toMatch(/^\.subckt SC_Div IN OUT$/im);
    expect(text).toMatch(/^XHB1 A B1 HB_Stage$/im);
    expect(text).toMatch(/^\.global VCC$/im);
    const back = parseSpice(text);
    expect(back.errors).toEqual([]);
    expect(v(op(back.netlist), 'B1')).toBeCloseTo(v(op(n), 'B1'), 9);
  });

  it('gives every distinct parameter set its own subcircuit', () => {
    const hb = buildNetlist(hierarchical([{}, { gainR: '500' }, { gainR: '{2k}' }]));
    expect(errors(hb)).toEqual([]);
    const names = Object.values(hb.netlist.subckts).map((s) => s.name).sort();
    // HB1 and HB3 share the default value set (2k); HB2 has gainR = 500
    expect(names).toEqual(['HB_Stage', 'HB_Stage_2', 'SC_Div', 'SC_Div_2']);
    const fl = buildNetlist(flat([{ gainR: 2000 }, { gainR: 500 }, { gainR: 2000 }]));
    const a = op(hb.netlist);
    const f = op(fl.netlist);
    for (const n of [1, 2, 3]) expect(v(a, `B${n}`)).toBeCloseTo(v(f, `B${n}`), 12);
    expect(v(a, 'B2')).not.toBeCloseTo(v(a, 'B1'), 3);
  });

  it('lists the parts inside blocks in the BOM, once per placed block, with their values', () => {
    const rows = buildBom(hierarchical([{}, { gainR: '500' }]));
    const r1 = rows.filter((r) => r.refdes.some((d) => d.endsWith('/SC1/R1')));
    expect(r1.map((r) => [r.value, r.refdes])).toEqual([
      ['2 kΩ', ['HB1/SC1/R1']],
      ['500 Ω', ['HB2/SC1/R1']],
    ]);
    const k1 = rows.find((r) => r.value === '1 kΩ')!;
    // RL1, RL2 on the top level and R2 / R3 / R4 inside each of the two blocks
    expect(k1.quantity).toBe(8);
  });

  it('reports a bad instance parameter at the block', () => {
    const hb = buildNetlist(hierarchical([{ gainR: '{nope*2}' }]));
    const m = hb.erc.find((x) => x.code === 'bad-param');
    expect(m).toMatchObject({ refdes: 'HB1', severity: 'error' });
    expect(m!.message).toMatch(/gainR/);
  });

  it('walks the instance tree and detects cycles', () => {
    const d = hierarchical([{}, {}]);
    const tree = hierarchyTree(d);
    expect(tree.children.map((c) => c.path)).toEqual(['HB1', 'HB2']);
    expect(tree.children[0].children.map((c) => c.path)).toEqual(['HB1/SC1']);
    expect([...childInstanceCounts(d)].sort()).toEqual([
      ['child1', 2],
      ['child2', 2],
    ]);
    expect(cyclicChildren(d).size).toBe(0);
    // make Div contain a Stage block: Stage -> Div -> Stage
    const div = getChild(d, 'child1')!;
    div.sheets[0].parts.push({ id: 'loop', partId: 'hier:child2', refdes: 'HB9', x: 600, y: 600, rotation: 0, mirror: false, params: {} });
    expect([...cyclicChildren(d)].sort()).toEqual(['child1', 'child2']);
    const build = buildNetlist(d);
    expect(details(build)).toContain('hierCycle');
    expect(hierarchyTree(d).children[0].children[0].children[0].cyclic).toBe(true);
  });

  it('joins ports tied to ground or shorted inside the child in the parent', () => {
    const b = new DesignBuilder('ties');
    const c = b.child('Tie');
    const r = b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
    b.labelPin(r, '1', 'P', { kind: 'hier' });
    b.labelPin(r, '1', 'Q', { kind: 'hier' }); // P and Q are the same net inside
    b.labelPin(r, '2', 'G', { kind: 'hier' });
    b.labelPin(r, '2', 'gnd'); // port G is ground inside
    b.root();
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '2' });
    b.labelPin(v1, '+', 'A');
    b.labelPin(v1, '-', 'gnd');
    const blk = b.block(c, 'SC1', 200, 0);
    b.labelPin(blk, 'P', 'A');
    b.labelPin(blk, 'Q', 'QQ'); // QQ becomes the same net as A through the block
    const rl = b.part('basic/resistor', 'R9', 400, 0, { value: '2k' });
    b.labelPin(rl, '1', 'QQ');
    b.labelPin(rl, '2', 'gnd');
    const build = buildNetlist(b.design);
    expect(errors(build)).toEqual([]);
    expect(details(build)).toEqual(expect.arrayContaining(['portGround', 'portsShorted']));
    expect(build.netlist.subckts.sc_tie.ports).toEqual(['P']);
    expect(build.partNets.R9['1']).toBe(build.partNets.V1['+']);
    const res = op(build.netlist);
    // V1 drives R1 (inside, to ground) and R9 in parallel: 2 V / (1k || 2k)
    const i = Object.entries(res).find(([k]) => k.toLowerCase() === 'i(v1)')![1];
    expect(i).toBeCloseTo(-(2 / 1000 + 2 / 2000), 12);
  });
});

describe('connectors and label scope', () => {
  it('plain labels are local to their sheet; off-page and global connectors join sheets', () => {
    const b = new DesignBuilder('scope');
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    b.labelPin(v1, '+', 'S');
    b.labelPin(v1, '+', 'LINK', { kind: 'offpage' });
    b.labelPin(v1, '-', 'gnd');
    b.addSheet('Two');
    const r1 = b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
    b.labelPin(r1, '1', 'S'); // local: NOT the S of sheet 1
    b.labelPin(r1, '2', 'gnd');
    const r2 = b.part('basic/resistor', 'R2', 200, 0, { value: '1k' });
    b.labelPin(r2, '1', 'LINK', { kind: 'offpage' });
    b.labelPin(r2, '2', 'gnd');
    const build = buildNetlist(b.design);
    expect(build.partNets.R1['1']).not.toBe(build.partNets.V1['+']);
    expect(build.partNets.R2['1']).toBe(build.partNets.V1['+']);
    // the two local nets named S get distinct SPICE names
    expect([build.partNets.V1['+'], build.partNets.R1['1']].sort()).toEqual(['S', 'S_2']);
    expect(details(build)).toContain('singlePinNet');
  });

  it('a lone off-page connector and a hierarchical connector on the top level are reported', () => {
    const b = new DesignBuilder('lonely');
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    b.labelPin(v1, '+', 'NOWHERE', { kind: 'offpage' });
    b.labelPin(v1, '-', 'P', { kind: 'hier' });
    const build = buildNetlist(b.design);
    expect(details(build)).toEqual(expect.arrayContaining(['offpageAlone', 'hierOnRoot']));
  });

  it('global connectors and power symbols cross hierarchy levels; local look-alikes are flagged', () => {
    const b = new DesignBuilder('global');
    const c = b.child('Load');
    const r = b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
    b.labelPin(r, '1', 'RAIL', { kind: 'global' });
    b.labelPin(r, '2', 'gnd');
    b.labelPin(r, '2', 'K', { kind: 'hier' });
    b.root();
    const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '3' });
    b.labelPin(v1, '+', 'RAIL', { kind: 'global' });
    b.labelPin(v1, '-', 'gnd');
    const blk = b.block(c, 'SC1', 300, 0);
    b.labelPin(blk, 'K', 'gnd');
    b.addSheet('Two');
    const r2 = b.part('basic/resistor', 'R2', 0, 200, { value: '1k' });
    b.labelPin(r2, '1', 'RAIL'); // local label on another sheet: not the global RAIL
    b.labelPin(r2, '2', 'gnd');
    const build = buildNetlist(b.design);
    expect(build.netlist.params['.global']).toBe('RAIL');
    expect(details(build)).toContain('localShadowsGlobal');
    const res = op(build.netlist);
    const i = Object.entries(res).find(([k]) => k.toLowerCase() === 'i(v1)')![1];
    expect(i).toBeCloseTo(-3 / 1000, 12); // only R1 inside the block loads V1
  });
});

describe('buses', () => {
  it('parses bus names', () => {
    expect(busMembers('D[0..3]')).toEqual(['D0', 'D1', 'D2', 'D3']);
    expect(busMembers('A[3..1],CLK')).toEqual(['A3', 'A2', 'A1', 'CLK']);
    expect(busMembers('X')).toEqual(['X']);
    expect(isVectorName('X')).toBe(false);
    expect(isVectorName('A,B')).toBe(true);
    expect(parseBusName('D[0..x]').error).toMatch(/range/);
    expect(parseBusName('A,A').error).toMatch(/twice/);
    expect(mergeMembers(['D[0..1]', 'D[1..2]'])).toEqual(['D0', 'D1', 'D2']);
  });

  /** Bus D[0..3] on sheet 1 with entries to R0..R3; sources drive the lines through local labels. */
  function busDesign(withEntries = true): DesignBuilder {
    const b = new DesignBuilder('bus');
    b.bus('D[0..3]', { x: -50, y: -30 }, { x: 400, y: -30 });
    for (let i = 0; i < 4; i++) {
      const r = b.part('basic/resistor', `R${i}`, 100 * i, 0, { value: '1k' }, { rotation: 90 }); // pins (100i,-30) (100i,30)
      if (withEntries) b.label(`D${i}`, 100 * i, -30, { kind: 'bus-entry' });
      b.labelPin(r, '2', 'gnd');
      const src = b.part('sources/dc-voltage', `V${i}`, 100 * i, 300, { value: String(i + 1) });
      b.labelPin(src, '+', `D${i}`); // a local label joins the bus line of the same name
      b.labelPin(src, '-', 'gnd');
    }
    return b;
  }

  it('bus entries connect wires / pins to bus lines', () => {
    const build = buildNetlist(busDesign().design);
    expect(errors(build)).toEqual([]);
    const res = op(build.netlist);
    for (let i = 0; i < 4; i++) {
      expect(build.partNets[`R${i}`]['1']).toBe(build.partNets[`V${i}`]['+']);
      expect(v(res, build.partNets[`R${i}`]['1'])).toBeCloseTo(i + 1, 12);
    }
  });

  it('a pin on a bus without an entry is not connected', () => {
    const build = buildNetlist(busDesign(false).design);
    expect(build.partNets.R0['1']).not.toBe(build.partNets.V0['+']);
    expect(details(build)).toContain('floatingPin');
  });

  it('off-page connectors with a bus name join every line across sheets', () => {
    const b = busDesign();
    b.label('D[0..3]', 400, -30, { kind: 'offpage' });
    b.addSheet('Two');
    b.bus(undefined, { x: 0, y: 0 }, { x: 300, y: 0 });
    b.label('D[0..3]', 0, 0, { kind: 'offpage' });
    const r = b.part('basic/resistor', 'R7', 200, 30, { value: '2k' }, { rotation: 90 }); // pins (200,0) (200,60)
    b.label('D2', 200, 0, { kind: 'bus-entry' });
    b.labelPin(r, '2', 'gnd');
    const build = buildNetlist(b.design);
    expect(errors(build)).toEqual([]);
    expect(build.partNets.R7['1']).toBe(build.partNets.V2['+']);
    expect(v(op(build.netlist), build.partNets.R7['1'])).toBeCloseTo(3, 12);
  });

  it('reports bus problems', () => {
    const b = busDesign();
    b.label('D9', 50, -30, { kind: 'bus-entry' }); // not a line of D[0..3]
    b.label('D1', 50, -200, { kind: 'bus-entry' }); // not on a bus
    b.wire({ x: 350, y: -100 }, { x: 350, y: -30 }); // wire ending on the bus without entry
    b.bus('Q[0..x]', { x: 0, y: -400 }, { x: 100, y: -400 });
    const ids = details(buildNetlist(b.design));
    expect(ids).toEqual(expect.arrayContaining(['busEntryUnknownLine', 'busEntryOffBus', 'busWireNoEntry', 'busBadName']));
  });

  it('a block bus port maps the lines of the bus at the pin by position', () => {
    const b = new DesignBuilder('bus block');
    const load = b.child('Load4');
    b.bus(undefined, { x: -50, y: -30 }, { x: 400, y: -30 });
    b.label('D[0..3]', -50, -30, { kind: 'hier' });
    for (let i = 0; i < 4; i++) {
      const r = b.part('basic/resistor', `R${i}`, 100 * i, 0, { value: '1k' }, { rotation: 90 });
      b.label(`D${i}`, 100 * i, -30, { kind: 'bus-entry' });
      b.labelPin(r, '2', 'gnd');
    }
    b.root();
    const blk = b.block(load, 'SC1', 400, 0);
    const pin = b.pin(blk, 'D[0..3]');
    b.bus('Q[0..3]', { x: pin.x - 200, y: pin.y }, pin);
    for (let i = 0; i < 4; i++) {
      const src = b.part('sources/dc-voltage', `V${i}`, 100 * i, 300, { value: String(i + 1) });
      b.labelPin(src, '+', `Q${i}`);
      b.labelPin(src, '-', 'gnd');
    }
    const build = buildNetlist(b.design);
    expect(errors(build)).toEqual([]);
    expect(build.netlist.subckts.sc_load4.ports).toEqual(['D0', 'D1', 'D2', 'D3']);
    expect(build.partNets['SC1/R2']['1']).toBe(build.partNets.V2['+']);
    const res = op(build.netlist);
    for (let i = 0; i < 4; i++) {
      const cur = Object.entries(res).find(([k]) => k.toLowerCase() === `i(v${i})`)![1];
      expect(cur).toBeCloseTo(-(i + 1) / 1000, 12);
    }
    // a 3-line bus does not fit the 4-line port
    const bad = new DesignBuilder('bad');
    const l2 = bad.child('Load4');
    bad.label('D[0..3]', 0, 0, { kind: 'hier' });
    bad.root();
    const blk2 = bad.block(l2, 'SC1', 400, 0);
    const p2 = bad.pin(blk2, 'D[0..3]');
    bad.bus('Q[0..2]', { x: p2.x - 100, y: p2.y }, p2);
    expect(details(buildNetlist(bad.design))).toContain('busPinWidth');
  });
});

describe('format version 2', () => {
  it('round-trips every version-2 field', () => {
    const d = hierarchical([{}, { gainR: '500' }]);
    const s0 = d.sheets[0];
    s0.shapes = [
      { id: 'sh1', kind: 'rect', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], stroke: '#336699', strokeWidth: 2, dash: 'dash', fill: '#ffeecc', locked: true },
      { id: 'sh2', kind: 'arc', points: [{ x: 0, y: 0 }, { x: 40, y: 40 }], start: 0, end: 90 },
      { id: 'sh3', kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], group: 'g1' },
      { id: 'sh4', kind: 'picture', points: [{ x: 0, y: 0 }, { x: 16, y: 16 }], src: 'data:image/png;base64,iVBORw0KGgo=' },
    ];
    s0.props = { paper: 'A3', orientation: 'portrait', border: true, titleBlock: false, grid: 'lines', colors: { scheme: 'custom', background: '#000000', wire: '#00ff00' } };
    s0.notes.push({ id: 'n9', x: 1, y: 2, text: 'xem lại R1', comment: true, author: 'An', created: '2026-11-08T10:00:00.000Z', collapsed: true, style: { bold: true, font: 'mono', color: '#aa0000', align: 'middle' } });
    s0.wires.push({ id: 'wb', points: [{ x: 0, y: 500 }, { x: 100, y: 500 }], bus: true, busName: 'D[0..7]', group: 'g1' });
    s0.parts[0].locked = true;
    d.titleBlock = { title: 'Bộ chia', designedBy: 'An', revision: 'B', date: '' };
    d.printSetup = { paper: 'A4', orientation: 'landscape', scale: 'fit', sheets: 'all', includeChildren: true, includeInstruments: true, monochrome: false };
    d.children![0].portOrder = ['OUT', 'IN'];
    d.children![1].sourceFile = 'stage.msim';
    d.children![1].description = 'Tầng khuếch đại';
    const text = serializeDesign(d);
    const back = parseDesign(text);
    expect(back).toEqual(d);
    const normalised = serializeDesign(back);
    expect(serializeDesign(parseDesign(normalised))).toBe(normalised);
    // portOrder changes the pin order of the block
    expect(blockPartDef(back.children![0]).block.ports.map((p) => p.name)).toEqual(['OUT', 'IN']);
  });

  it('rejects invalid version-2 data with JSON paths', () => {
    const d = hierarchical([{}]);
    const raw = JSON.parse(serializeDesign(d));
    raw.sheets[0].labels[0].kind = 'portal';
    raw.children[0].kind = 'macro';
    raw.children[1].sheets[0].id = raw.sheets[0].id;
    raw.sheets[0].shapes = [{ id: 's', kind: 'picture', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], src: 'http://example.com/a.png' }];
    raw.printSetup = { scale: 2 };
    let issues: string[] = [];
    try {
      parseDesign(JSON.stringify(raw));
    } catch (e) {
      issues = (e as { issues: string[] }).issues;
    }
    expect(issues).toEqual([
      'sheets[0].labels[0].kind: must be one of label, offpage, hier, global, bus-entry (got "portal")',
      'sheets[0].shapes[0].src: must be a data:image/... URL (PNG, JPEG, GIF, SVG or WebP)',
      'children[0].kind: must be one of subcircuit, hierarchical (got "macro")',
      `sheets: duplicate id ${JSON.stringify(raw.sheets[0].id)}`,
      "printSetup.scale: must be 'fit' or a percentage between 5 and 1000 (got 2)",
    ]);
  });

  it('migrates version-1 files: every label keeps joining across sheets', () => {
    const v1 = {
      format: 'machsim-design',
      version: 1,
      title: 'Old two-sheet design',
      sheets: [
        {
          id: 's1',
          name: 'One',
          parts: [
            { id: 'p1', partId: 'sources/dc-voltage', refdes: 'V1', x: 0, y: 0, rotation: 0, mirror: false, params: { value: '4' } },
            { id: 'p2', partId: 'sources/ground', refdes: 'GND1', x: 0, y: 100, rotation: 0, mirror: false, params: {} },
          ],
          wires: [],
          labels: [],
          probes: [],
          notes: [],
        },
        {
          id: 's2',
          name: 'Two',
          parts: [{ id: 'p3', partId: 'basic/resistor', refdes: 'R1', x: 0, y: 0, rotation: 0, mirror: false, params: { value: '2k' } }],
          wires: [],
          labels: [],
          probes: [],
          notes: [],
        },
      ],
    };
    // labels on the pins (positions from a builder with the same parts)
    const b = new DesignBuilder();
    const vh = b.part('sources/dc-voltage', 'V1', 0, 0);
    const gh = b.part('sources/ground', 'GND1', 0, 100);
    const rh = b.part('basic/resistor', 'R1', 0, 0);
    const lab = (id: string, name: string, p: { x: number; y: number }) => ({ id, x: p.x, y: p.y, name, rotation: 0 });
    v1.sheets[0].labels = [lab('l1', 'TOP', b.pin(vh, '+')), lab('l2', 'BOT', b.pin(vh, '-')), lab('l3', 'BOT', b.pin(gh, '1'))] as never;
    v1.sheets[1].labels = [lab('l4', 'top', b.pin(rh, '1')), lab('l5', 'BOT', b.pin(rh, '2'))] as never;
    const d = parseDesign(JSON.stringify(v1));
    expect(d.version).toBe(2);
    expect(d.sheets.flatMap((s) => s.labels).every((l) => l.global === true)).toBe(true);
    const build = buildNetlist(d);
    expect(errors(build)).toEqual([]);
    expect(build.partNets.R1['1']).toBe(build.partNets.V1['+']);
    const res = op(build.netlist);
    const i = Object.entries(res).find(([k]) => k.toLowerCase() === 'i(v1)')![1];
    expect(i).toBeCloseTo(-4 / 2000, 12);
  });
});
