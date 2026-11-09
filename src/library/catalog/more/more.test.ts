/**
 * Round-4 library breadth (src/library/catalog/more): part counts per group, the variant contract
 * (same model, own footprint / pin numbers), truth tables and pin-outs of the new logic types,
 * regulator output and dropout, Zener voltages, op-amp bandwidth, sensor curves against the datasheet
 * equations, optocoupler transfer ratio and search by Vietnamese name.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder, type PartHandle } from '../../../model/designkit';
import { buildNetlist } from '../../../model/netlister';
import { runAnalyses } from '../../../sim';
import type { AnalysisSpec } from '../../../sim/netlist';
import type { AnalysisResult } from '../../../sim/results';
import { setLang } from '../../../i18n';
import { searchCatalogue } from '../../../ui/editor/browserModel';
import { getPart, listParts, loadAllGroups, pendingPartCount, cataloguePacks } from '../../index';
import { footprintPads, getFootprint } from '../../footprints';
import { asLibraryPart, type LibraryPartDef } from '../../partkit';
import { LOGIC_MORE_CATALOG, LOGIC_NEW } from './logicMore';
import { ANALOG_MORE_CATALOG } from './analogMore';
import { DISCRETES_MORE_CATALOG } from './discretesMore';
import { PASSIVES_MORE_CATALOG } from './passivesMore';
import { SENSORS_MORE_CATALOG } from './sensorsMore';

await loadAllGroups();

const MORE: LibraryPartDef[] = [...LOGIC_MORE_CATALOG, ...ANALOG_MORE_CATALOG, ...DISCRETES_MORE_CATALOG, ...PASSIVES_MORE_CATALOG, ...SENSORS_MORE_CATALOG];
const part = (id: string): LibraryPartDef => {
  const p = getPart(id);
  if (!p) throw new Error(`no part ${id}`);
  return asLibraryPart(p);
};

// ---------------------------------------------------------------------------------------------
// bench

class Bench {
  readonly b = new DesignBuilder('more');
  private x = 0;
  part(id: string, ref: string, params: Record<string, string>, pins: Record<string, string>): PartHandle {
    const h = this.b.part(id, ref, this.x, 0, params);
    this.x += 400;
    for (const [pin, net] of Object.entries(pins)) this.b.labelPin(h, pin, net);
    return h;
  }
  dc(ref: string, net: string, value: number): void {
    this.part('sources/dc-voltage', ref, { value: String(value) }, { '+': net, '-': '0' });
  }
  res(ref: string, a: string, c: string, value: string): void {
    this.part('basic/resistor', ref, { value }, { '1': a, '2': c });
  }
  run(...analyses: AnalysisSpec[]): AnalysisResult[] {
    const build = buildNetlist(this.b.design, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error').map((e) => e.message)).toEqual([]);
    const res = runAnalyses({ ...build.netlist, analyses });
    for (const r of res) expect(r.error, r.error).toBeUndefined();
    return res;
  }
}

const scalar = (r: AnalysisResult, name: string): number => {
  const key = Object.keys(r.scalars ?? {}).find((k) => k.toLowerCase() === name.toLowerCase());
  if (key === undefined) throw new Error(`no ${name}; have ${Object.keys(r.scalars ?? {}).slice(0, 20).join(', ')}`);
  return r.scalars![key];
};
const vec = (r: AnalysisResult, name: string) => {
  const v = r.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!v) throw new Error(`no ${name}; have ${r.vectors.map((x) => x.name).join(', ')}`);
  return v;
};
const lastOf = (r: AnalysisResult, name: string): number => {
  const a = vec(r, name).re;
  return a[a.length - 1];
};
const mag = (r: AnalysisResult, name: string, i: number): number => Math.hypot(vec(r, name).re[i], vec(r, name).im?.[i] ?? 0);

/** Settled output levels (0 / 1 by a 2 V threshold) of a digital part driven by constant input levels. */
function logic(id: string, drive: Record<string, number>, outs: string[], params: Record<string, string> = {}): Record<string, number> {
  const k = new Bench();
  const pins: Record<string, string> = {};
  for (const [pin, v] of Object.entries(drive)) {
    pins[pin] = `n_${pin}`;
    k.dc(`V${pin.replace(/[^A-Za-z0-9]/g, '')}`, `n_${pin}`, v);
  }
  outs.forEach((pin, i) => {
    pins[pin] = `o_${pin}`;
    k.res(`RL${i}`, `o_${pin}`, '0', '1Meg');
  });
  k.part(id, 'U1', params, pins);
  const [tr] = k.run({ type: 'tran', tstep: 20e-9, tstop: 2e-6 });
  return Object.fromEntries(outs.map((pin) => [pin, lastOf(tr, `V(o_${pin})`) > 2 ? 1 : 0]));
}

// ---------------------------------------------------------------------------------------------

describe('part counts and structure', () => {
  it('the library holds at least 10,000 parts, in unique ids, across the groups', () => {
    const all = listParts();
    expect(all.length).toBeGreaterThanOrEqual(10000);
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    const byGroup = new Map<string, number>();
    for (const p of all) byGroup.set(p.group, (byGroup.get(p.group) ?? 0) + 1);
    // the groups that grew most (core + packs): checked as lower bounds so other work can add more
    expect(byGroup.get('ttl')!).toBeGreaterThanOrEqual(1600);
    expect(byGroup.get('cmos')!).toBeGreaterThanOrEqual(1700);
    expect(byGroup.get('analog')!).toBeGreaterThanOrEqual(1400);
    expect(byGroup.get('power')!).toBeGreaterThanOrEqual(600);
    expect(byGroup.get('diodes')!).toBeGreaterThanOrEqual(1600);
    expect(byGroup.get('transistors')!).toBeGreaterThanOrEqual(1000);
    expect(byGroup.get('basic')!).toBeGreaterThanOrEqual(2400);
  });

  it('each pack adds exactly the parts it declares, per group', () => {
    const packs = cataloguePacks();
    const lists: Record<string, LibraryPartDef[]> = { 'logic-more': LOGIC_MORE_CATALOG, 'analog-more': ANALOG_MORE_CATALOG, 'discretes-more': DISCRETES_MORE_CATALOG, 'passives-more': PASSIVES_MORE_CATALOG, 'sensors-more': SENSORS_MORE_CATALOG };
    for (const [id, list] of Object.entries(lists)) {
      const pack = packs.find((p) => p.id === id)!;
      const actual: Record<string, number> = {};
      for (const p of list) actual[p.group] = (actual[p.group] ?? 0) + 1;
      expect(actual, id).toEqual(pack.counts);
      expect(pack.loaded, id).toBe(list.length);
    }
    expect(pendingPartCount('ttl')).toBe(0);
  });

  it('every new part has a Vietnamese description, a known footprint with enough pads and is searchable', () => {
    const bad: string[] = [];
    for (const p of MORE) {
      if (!p.textVi?.description) bad.push(`${p.id}: no Vietnamese description`);
      const fp = getFootprint(p.footprint);
      if (!fp) bad.push(`${p.id}: unknown footprint ${p.footprint}`);
      else if (fp.pins > 0 && p.symbol.pins.length > fp.pins) bad.push(`${p.id}: ${p.symbol.pins.length} pins > ${fp.name} (${fp.pins})`);
      else if (fp.pins > 0 && fp.kind !== 'connector' && footprintPads(fp).length !== fp.pins) bad.push(`${p.id}: ${fp.name} pads`);
      // pin numbers fit the package
      if (fp && fp.pins > 0) for (const pin of p.symbol.pins) if (pin.number && Number(pin.number) > fp.pins) bad.push(`${p.id}: pin ${pin.name} is number ${pin.number} on ${fp.name}`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

describe('variants share the model of their base part', () => {
  const variants = MORE.filter((p) => p.variantOf);
  const base = (v: LibraryPartDef): LibraryPartDef => part(v.variantOf!);

  it('there are thousands of them and each finds its base', () => {
    expect(variants.length).toBeGreaterThan(3500);
    for (const v of variants) expect(getPart(v.variantOf!), v.id).toBeDefined();
  });

  it('keep the model function, the pin names and the parameters of the base', () => {
    const bad: string[] = [];
    for (const v of variants) {
      const b = base(v);
      if (v.toSpice !== b.toSpice) bad.push(`${v.id}: own toSpice`);
      if (v.symbol.pins.map((p) => p.name).join() !== b.symbol.pins.map((p) => p.name).join()) bad.push(`${v.id}: pin names differ`);
      if (v.params.map((d) => d.key).join() !== b.params.map((d) => d.key).join()) bad.push(`${v.id}: params differ`);
      if (v.id === b.id) bad.push(`${v.id}: same id as base`);
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('logic order codes keep the DIP pin numbers in SOIC and TSSOP packages with as many pads as pins', () => {
    for (const name of ['SN74LS00N', 'SN74LS00D', 'DM74LS00N', 'SN74HC00N', 'SN74HC00D', 'SN74HC00PW', 'CD74HC00E', 'CD4017BE', 'CD4017BM', 'CD4017BPW', 'HCF4017BEY', 'HEF4017BP', 'MC14017BCP']) {
      const v = MORE.find((p) => p.name === name);
      expect(v, name).toBeDefined();
      const b = base(v!);
      expect(v!.symbol.pins.map((p) => p.number)).toEqual(b.symbol.pins.map((p) => p.number));
      expect(getFootprint(v!.footprint)!.pins, name).toBe(getFootprint(b.footprint)!.pins);
    }
    expect(MORE.find((p) => p.name === 'SN74HC00PW')!.footprint).toBe('TSSOP-14');
    expect(MORE.find((p) => p.name === 'SN74LS00D')!.footprint).toBe('SOIC-14');
    // the 5-pin SOT-23 version of an op-amp renumbers its pins (OUT 1, V- 2, IN+ 3, IN- 4, V+ 5)
    const sot = MORE.find((p) => p.name === 'MCP6291-E/LT')!;
    expect(Object.fromEntries(sot.symbol.pins.map((p) => [p.name, p.number]))).toEqual({ 'IN-': '4', 'IN+': '3', OUT: '1', 'V+': '5', 'V-': '2' });
    expect(sot.footprint).toBe('SC-70-5');
    const soic = MORE.find((p) => p.name === 'MCP6291-E/SN')!;
    expect(Object.fromEntries(soic.symbol.pins.map((p) => [p.name, p.number]))).toEqual({ 'IN-': '2', 'IN+': '3', OUT: '6', 'V+': '7', 'V-': '4' });
  });

  it('an order-code variant behaves like its base: SN74HC00D is a 74HC00 (NAND truth table)', () => {
    const table = [[0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0]];
    for (const id of ['cmos/74hc00', 'cmos/sn74hc00d', 'cmos/sn74hc00pw', 'cmos/cd74hc00e']) {
      for (const [a, b, y] of table) expect(logic(id, { '1A': a * 5, '1B': b * 5 }, ['1Y']), `${id} ${a}${b}`).toEqual({ '1Y': y });
    }
  });
});

describe('new logic types', () => {
  it('the new types and families exist with their device-family levels and counts', () => {
    expect(LOGIC_NEW.length).toBe(43);
    for (const id of ['cmos/74hc238', 'cmos/74hct238', 'ttl/74ls533', 'cmos/74hc563', 'ttl/74als564', 'cmos/74hc645', 'ttl/74ls620', 'ttl/74ls290', 'ttl/74ls293', 'cmos/4724', 'cmos/74hc73', 'cmos/74ac109', 'ttl/74f30', 'cmos/74hc4022', 'cmos/74hc4585']) expect(getPart(id), id).toBeDefined();
    expect(part('cmos/74hc238').family).toBe('74HC');
    expect(part('ttl/74ls290').family).toBe('74LS');
  });

  it('74HC238 (3-to-8 decoder, active-high outputs): exactly the addressed output is high, none while disabled', () => {
    const outs = ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7'];
    for (let n = 0; n < 8; n++) {
      const drive = { A: (n & 1) * 5, B: ((n >> 1) & 1) * 5, C: ((n >> 2) & 1) * 5, G1: 5, G2A: 0, G2B: 0 };
      const got = logic('cmos/74hc238', drive, outs);
      expect(outs.map((o) => got[o]), `address ${n}`).toEqual(outs.map((_, i) => (i === n ? 1 : 0)));
    }
    const off = logic('cmos/74hc238', { A: 5, B: 0, C: 0, G1: 0, G2A: 0, G2B: 0 }, outs);
    expect(Object.values(off)).toEqual(Array(8).fill(0));
    // pin-out: the 138 pinout (A 1, B 2, C 3, G2A 4, G2B 5, G1 6, Y7 7, Y0 15)
    const pn = Object.fromEntries(part('cmos/74hc238').symbol.pins.map((p) => [p.name, p.number]));
    expect(pn).toMatchObject({ A: '1', B: '2', C: '3', G2A: '4', G2B: '5', G1: '6', Y7: '7', Y6: '9', Y1: '14', Y0: '15' });
  });

  it('74LS533 (octal inverting latch): Q follows ~D while LE is high, the outputs release with ~OE high', () => {
    const d = (bits: number) => Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`D${i + 1}`, ((bits >> i) & 1) * 5]));
    const qs = Array.from({ length: 8 }, (_, i) => `Q${i + 1}`);
    const got = logic('ttl/74ls533', { ...d(0b10110010), LE: 5, OE: 0 }, qs);
    expect(qs.map((q) => got[q])).toEqual(Array.from({ length: 8 }, (_, i) => 1 - ((0b10110010 >> i) & 1)));
    const pn = Object.fromEntries(part('ttl/74ls533').symbol.pins.map((p) => [p.name, p.number]));
    expect(pn).toMatchObject({ OE: '1', Q1: '2', D1: '3', D2: '4', Q2: '5', LE: '11', Q8: '19' });
    // the 563 is the flow-through version: D1..D8 on pins 2..9, Q8..Q1 on 12..19
    const pn563 = Object.fromEntries(part('cmos/74hc563').symbol.pins.map((p) => [p.name, p.number]));
    expect(pn563).toMatchObject({ D1: '2', D8: '9', Q8: '12', Q1: '19', LE: '11', OE: '1' });
  });

  it('74HC645 (octal bus transceiver): DIR high drives B from A, DIR low drives A from B', () => {
    const k = new Bench();
    const pins: Record<string, string> = { DIR: 'dir', G: 'g' };
    k.dc('VDIR', 'dir', 5);
    k.dc('VG', 'g', 0);
    for (let i = 1; i <= 8; i++) {
      pins[`A${i}`] = `a${i}`;
      pins[`B${i}`] = `b${i}`;
      k.dc(`VA${i}`, `a${i}`, i % 2 ? 5 : 0);
      k.res(`RB${i}`, `b${i}`, '0', '1Meg');
    }
    k.part('cmos/74hc645', 'U1', {}, pins);
    const [tr] = k.run({ type: 'tran', tstep: 20e-9, tstop: 2e-6 });
    for (let i = 1; i <= 8; i++) expect(lastOf(tr, `V(b${i})`) > 2 ? 1 : 0, `B${i}`).toBe(i % 2);
  });

  it('74F30 (8-input NAND, new in the F family) is low only with all inputs high', () => {
    const ins = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const all = Object.fromEntries(ins.map((i) => [i, 3.5]));
    expect(logic('ttl/74f30', all, ['Y'])).toEqual({ Y: 0 });
    expect(logic('ttl/74f30', { ...all, E: 0 }, ['Y'])).toEqual({ Y: 1 });
  });

  it('LS290 / LS293 and CD4724B use the pin-outs of the 7490 / 7493 and the 4099', () => {
    const pins = (id: string) => Object.fromEntries(part(id).symbol.pins.map((p) => [p.name, p.number]));
    expect(pins('ttl/74ls290')).toEqual(pins('ttl/74ls90'));
    expect(pins('ttl/74ls293')).toEqual(pins('ttl/74ls93'));
    expect(pins('cmos/4724')).toEqual(pins('cmos/4099'));
  });
});

// ---------------------------------------------------------------------------------------------

describe('regulators', () => {
  /** Output voltage of a three-terminal regulator at input vin with a 10 kΩ load. */
  function regulate(id: string, vin: number): number {
    const p = part(id);
    const ref = p.symbol.pins.find((x) => x.name === 'GND' || x.name === 'ADJ')!.name;
    const k = new Bench();
    k.dc('VIN', 'in', vin);
    k.part(id, 'U1', {}, { IN: 'in', OUT: 'out', [ref]: '0' });
    k.res('RL', 'out', '0', '10k');
    const [op] = k.run({ type: 'op' });
    return scalar(op, 'V(out)');
  }

  it.each([
    ['power/ap2112k-3.3', 3.3], ['power/tlv70033', 3.3], ['power/xc6206p182', 1.8], ['power/mic5205-5.0', 5], ['power/lm340t-12', 12], ['power/78l33', 3.3],
    ['power/lm2937-8.0', 8], ['power/ncp1117-2.0', 2], ['power/lp2985-3.0', 3], ['power/lm1086-1.8', 1.8], ['power/ld1117-2.5', 2.5], ['power/mcp1700-1.2', 1.2],
  ])('%s regulates to %s V', (id, vout) => {
    expect(regulate(id, vout + 3)).toBeCloseTo(vout, 1);
  });

  it('a negative regulator (79M05) gives -5 V', () => {
    const k = new Bench();
    k.dc('VIN', 'in', -9);
    k.part('power/79m05', 'U1', {}, { IN: 'in', OUT: 'out', GND: '0' });
    k.res('RL', 'out', '0', '10k');
    const [op] = k.run({ type: 'op' });
    expect(scalar(op, 'V(out)')).toBeCloseTo(-5, 1);
  });

  it('drops out: the output follows the input minus the dropout voltage below the regulation point', () => {
    // AP2112K-3.3 has 0.25 V dropout, LM1086 1.3 V: at VOUT + vdo / 2 the output sits near VIN - vdo
    expect(regulate('power/ap2112k-3.3', 3.3 + 0.125)).toBeCloseTo(3.425 - 0.25, 1);
    expect(regulate('power/lm1086-1.8', 1.8 + 0.65)).toBeCloseTo(2.45 - 1.3, 1);
    // well above the dropout they regulate
    expect(regulate('power/lm1086-1.8', 5)).toBeCloseTo(1.8, 1);
  });

  it('package variants of the 78xx regulate the same way and carry the right footprints', () => {
    const names: [string, string][] = [['power/l7805cv', 'TO-220'], ['power/l7805cd2t', 'TO-263-3'], ['power/l7805cdt', 'TO-252'], ['power/mc7805ct', 'TO-220'], ['power/ka7805', 'TO-220']];
    for (const [id, fp] of names) {
      expect(part(id).footprint, id).toBe(fp);
      expect(regulate(id, 9), id).toBeCloseTo(5, 1);
    }
    // the SOT-223 / TO-220 LM1117 numbering is GND(ADJ) 1, OUT 2, IN 3
    const pin = Object.fromEntries(part('power/lm1117t-3.3').symbol.pins.map((p) => [p.name, p.number]));
    expect(pin).toEqual({ GND: '1', OUT: '2', IN: '3' });
    expect(regulate('power/lm1117t-3.3', 6)).toBeCloseTo(3.3, 1);
  });
});

describe('Zener diodes', () => {
  /** Voltage across a Zener biased at its test current IZT through a series resistor from a 30 V source. */
  function zenerVoltage(id: string, izt: number): number {
    const vsrc = 30;
    const k = new Bench();
    k.dc('VS', 'vs', vsrc);
    const z = part(id);
    const vz = Number(/([\d.]+) V/.exec(z.description)![1]);
    k.res('R1', 'vs', 'a', String((vsrc - vz) / izt));
    k.part(id, 'D1', {}, { K: 'a', A: '0' });
    // reverse-biased: current from the supply through R1 into the cathode
    const [op] = k.run({ type: 'op' });
    return scalar(op, 'V(a)');
  }

  it.each([
    ['diodes/mmsz5231b', 5.1, 20e-3], ['diodes/bzt52c12', 12, 5e-3], ['diodes/zmm15', 15, 5e-3], ['diodes/bzv55c6v2', 6.2, 5e-3], ['diodes/zpd3.3', 3.3, 5e-3],
    ['diodes/1n5918b', 5.1, 73.5e-3], ['diodes/1smb5929b', 15, 25e-3], ['diodes/bzx85c9v1', 9.1, 28.6e-3], ['diodes/mmbz5245b', 15, 8.5e-3],
  ])('%s holds %s V at its test current', (id, vz, izt) => {
    const z = part(id);
    expect(z.family).toBe('Zener diode');
    const v = zenerVoltage(id, z.name.startsWith('BZX85') || z.name.startsWith('1N59') || z.name.startsWith('1SMB') ? Number(/IZT = ([\d.]+) mA/.exec(z.description)![1]) * 1e-3 : izt);
    expect(Math.abs(v - vz) / vz).toBeLessThan(0.03);
  });

  it('adds the E24 series 2.4 – 75 V in 0.5 W, 1.3 W and 3 W series', () => {
    const power = (id: string) => (part(id).specs as { power: number }).power;
    expect(power('diodes/bzt52c2v4')).toBe(0.5);
    expect(power('diodes/bzx85c3v3')).toBe(1.3);
    expect(power('diodes/1n5913b')).toBe(3);
    const bzt = MORE.filter((p) => p.name.startsWith('BZT52C')).map((p) => (p.specs as { vz: number }).vz);
    expect(bzt).toHaveLength(37);
    expect(bzt[0]).toBe(2.4);
    expect(bzt[bzt.length - 1]).toBe(75);
  });
});

describe('op-amps and comparators', () => {
  /** -3 dB frequency of a non-inverting gain-10 stage built with the op-amp (ideal feedback resistors). */
  function bandwidthAtGain10(id: string, supply: number): number {
    const k = new Bench();
    k.dc('VP', 'vcc', supply / 2);
    k.dc('VN', 'vee', -supply / 2);
    k.part('sources/ac-voltage', 'VIN', { amplitude: '0', acmag: '1' }, { '+': 'in', '-': '0' });
    k.part(id, 'U1', {}, { 'IN+': 'in', 'IN-': 'fb', OUT: 'out', 'V+': 'vcc', 'V-': 'vee' });
    k.res('RF', 'out', 'fb', '9k');
    k.res('RG', 'fb', '0', '1k');
    const fs = Array.from({ length: 200 }, (_, i) => 10 ** (2 + (i * 7) / 199));
    const [ac] = k.run({ type: 'ac', sweep: 'list', points: fs.length, fstart: fs[0], fstop: fs[fs.length - 1], list: fs });
    const g0 = mag(ac, 'V(out)', 0);
    expect(g0).toBeGreaterThan(9.5);
    expect(g0).toBeLessThan(10.2);
    const i3 = fs.findIndex((_, i) => mag(ac, 'V(out)', i) < g0 / Math.SQRT2);
    return fs[i3];
  }

  it.each([
    ['analog/lme49710', 55e6], ['analog/mc33078', 16e6], ['analog/opa172', 10e6], ['analog/ad8615', 24e6], ['analog/tlv9061', 10e6], ['analog/lt1007', 8e6],
  ])('%s has a gain-10 bandwidth near GBW / 10 (GBW %s Hz)', (id, gbw) => {
    const f3 = bandwidthAtGain10(id, id === 'analog/ad8615' || id === 'analog/tlv9061' ? 5 : 30);
    expect(f3).toBeGreaterThan(gbw / 10 / 1.35);
    expect(f3).toBeLessThan((gbw / 10) * 1.35);
  });

  it('dual and quad types come as a whole chip plus a part per amplifier, with package variants of the chip', () => {
    const quad = part('analog/mc33079-quad');
    expect(quad.symbol.pins.length).toBe(14);
    expect(part('analog/mc33079-quad-d').pkg).toMatchObject({ id: 'analog/mc33079-quad', section: 'D' });
    expect(part('analog/mc33079d').footprint).toBe('SOIC-14');
    expect(part('analog/mc33078d').footprint).toBe('SOIC-8');
    expect(part('analog/lm4562pw').footprint).toBe('TSSOP-8');
  });

  it('a comparator variant switches like its base', () => {
    for (const id of ['analog/mcp6561', 'analog/mcp6561-e-sn', 'analog/mcp6561-e-lt']) {
      const run = (vp: number): number => {
        const k = new Bench();
        k.dc('VP', 'vcc', 5);
        k.dc('VM', 'minus', 2.5);
        k.dc('VPL', 'plus', vp);
        k.part(id, 'U1', {}, { 'IN+': 'plus', 'IN-': 'minus', OUT: 'out', 'V+': 'vcc', 'V-': '0' });
        k.res('RL', 'out', '0', '100k');
        const [op] = k.run({ type: 'op' });
        return scalar(op, 'V(out)');
      };
      expect(run(3), id).toBeGreaterThan(4.5);
      expect(run(2), id).toBeLessThan(0.5);
    }
  });
});

describe('sensors', () => {
  const resistorOf = (id: string, params: Record<string, string>): number => {
    const k = new Bench();
    const p = part(id);
    const pins: Record<string, string> = { [p.symbol.pins[0].name]: 'a', [p.symbol.pins[1].name]: '0' };
    k.part(id, 'RT1', params, pins);
    const build = buildNetlist(k.b.design, { includeAnalysis: false });
    return build.netlist.elements.find((e) => e.type === 'R')!.value as number;
  };

  it('NTC thermistors follow R25·exp(B·(1/T − 1/298.15 K)) over the temperature range', () => {
    for (const [id, r25, beta] of [['basic/ntc-10k-b3950', 10e3, 3950], ['basic/ntc-4.7k-b3435-0603', 4.7e3, 3435], ['basic/ntc-100k-b4050', 100e3, 4050]] as const) {
      for (const t of [-20, 0, 25, 50, 85, 125]) {
        const expected = r25 * Math.exp(beta * (1 / (t + 273.15) - 1 / 298.15));
        expect(resistorOf(id, { temp: String(t) }) / expected, `${id} ${t} °C`).toBeCloseTo(1, 9);
      }
    }
    expect(part('basic/ntc-10k-b3950-0603').footprint).toBe('R0603');
    expect(part('basic/ntc-10k-b3950').footprint).toBe('RES-RADIAL-100');
  });

  it('KTY silicon sensors are linear: R25·(1 + α·(T − 25))', () => {
    for (const t of [-40, 25, 100]) expect(resistorOf('basic/kty81-110', { temp: String(t) })).toBeCloseTo(1000 * (1 + 0.0079 * (t - 25)), 6);
    expect(resistorOf('basic/kty81-210', { temp: '25' })).toBeCloseTo(2000, 6);
  });

  /** Output of a three-pin temperature IC powered from 5 V. */
  function tempOut(id: string, t: number): number {
    const k = new Bench();
    k.dc('VS', 'vs', 5);
    k.part(id, 'U1', { temp: String(t) }, { '+VS': 'vs', GND: '0', VOUT: 'out' });
    k.res('RL', 'out', '0', '100k');
    const [op] = k.run({ type: 'op' });
    return scalar(op, 'V(out)');
  }

  it('temperature ICs follow their datasheet transfer functions', () => {
    for (const t of [25, 50, 100]) {
      expect(tempOut('misc/lm50', t)).toBeCloseTo(0.5 + 0.01 * t, 3);
      expect(tempOut('misc/tmp37', t)).toBeCloseTo(0.02 * t, 3);
      expect(tempOut('misc/mcp9701', t)).toBeCloseTo(0.4 + 0.0195 * t, 3);
      expect(tempOut('misc/lm60', t)).toBeCloseTo(0.424 + 0.00625 * t, 3);
    }
    // LM35 grades are the LM35 in another package; the SO-8 version has ground on pin 4
    expect(part('misc/lm35dz').footprint).toBe('TO-92');
    expect(part('misc/lm35dm').symbol.pins.find((p) => p.name === 'GND')!.number).toBe('4');
  });

  it('Hall sensors: SS49E sits at VCC/2 + 14 mV/mT·B, A3144 switches at 35 mT', () => {
    const k = new Bench();
    k.dc('VCC', 'vcc', 5);
    k.part('misc/ss49e', 'U1', { field: '10' }, { VCC: 'vcc', GND: '0', OUT: 'out' });
    k.res('RL', 'out', '0', '100k');
    const [op] = k.run({ type: 'op' });
    // VOUT = VCC·(0.5 + B·sens / 5 V) with sens = 14 mV/mT
    expect(scalar(op, 'V(out)')).toBeCloseTo(5 * (0.5 + (10 * 0.014) / 5), 2);
    const sw = (field: string): number => {
      const kk = new Bench();
      kk.dc('VCC', 'vcc', 5);
      kk.part('misc/a3144', 'U1', { field }, { VCC: 'vcc', GND: '0', OUT: 'out' });
      kk.res('RU', 'vcc', 'out', '10k');
      const [o] = kk.run({ type: 'op' });
      return scalar(o, 'V(out)');
    };
    expect(sw('20')).toBeGreaterThan(4.5);
    expect(sw('50')).toBeLessThan(0.1);
  });

  it('optocouplers transfer the current by their CTR: PC817B (190 %), 4N35 (100 %), CNY17-3 (150 %), 4N33 (500 %)', () => {
    /** collector current per LED current at IF = 10 mA, VCE well above saturation */
    const transfer = (id: string): number => {
      const k = new Bench();
      k.dc('V5', 'v5', 5);
      k.dc('V12', 'v12', 12);
      k.res('RLED', 'v5', 'a', '380');
      k.res('RC', 'v12', 'c', '100');
      k.part(id, 'U1', {}, { A: 'a', K: '0', C: 'c', E: '0' });
      const [op] = k.run({ type: 'op' });
      return (12 - scalar(op, 'V(c)')) / 100 / ((5 - scalar(op, 'V(a)')) / 380);
    };
    const reference = transfer('misc/optocoupler');
    expect(reference).toBeGreaterThan(0.9);
    for (const [id, ctr] of [['misc/pc817b', 190], ['misc/4n35', 100], ['misc/cny17-3', 150], ['misc/4n33', 500]] as const) {
      // the same model as the generic part (CTR 100 %): the ratio of the transfer ratios is the ratio of the CTRs
      expect(transfer(id) / reference, id).toBeGreaterThan((ctr / 100) * 0.9);
      expect(transfer(id) / reference, id).toBeLessThan((ctr / 100) * 1.08);
    }
    // 4-pin DIP numbering of the PC817: anode 1, cathode 2, emitter 3, collector 4
    expect(Object.fromEntries(part('misc/pc817b').symbol.pins.map((p) => [p.name, p.number]))).toEqual({ A: '1', K: '2', E: '3', C: '4' });
    expect(part('misc/4n35').footprint).toBe('DIP-6');
  });
});

describe('passives', () => {
  it('E96 values: the 0603 series has 481 values from 10 Ω to 1 MΩ, in the E96 picker, with the burn-out rating', () => {
    const r0603 = PASSIVES_MORE_CATALOG.filter((p) => p.id.startsWith('basic/r0603-'));
    expect(r0603).toHaveLength(481);
    const sample = part('basic/r0603-4.99k');
    expect(sample.params.find((d) => d.key === 'value')!.picker).toBe('E96');
    expect(sample.footprint).toBe('R0603');
    expect(sample.ratings?.enable).toBe('burn');
    const values = r0603.map((p) => (p.specs as { resistance: number }).resistance);
    expect(values[0]).toBe(10);
    expect(values[values.length - 1]).toBe(1e6);
    // the E96 mantissas are the standard ones
    for (const v of [10.2, 11.5, 249, 4990, 100000]) expect(values).toContain(v);
  });

  it('MLCC chips: C0G 0603 10 pF … 10 nF at 50 V, X7R 1206 up to 10 µF', () => {
    const c0g = part('basic/cap-0603-c0g-100p');
    expect((c0g.specs as { vrating: number }).vrating).toBe(50);
    expect(part('basic/cap-1206-x7r-10u').footprint).toBe('C1206');
    expect(PASSIVES_MORE_CATALOG.filter((p) => p.id.startsWith('basic/cap-0603-c0g-')).length).toBeGreaterThan(30);
  });
});

describe('search by Vietnamese name', () => {
  it('finds the new parts with and without diacritics', () => {
    setLang('vi');
    const all = listParts();
    const has = (q: string, id: string) => expect(searchCatalogue(all, q).some((p) => p.id === id), `${q} -> ${id}`).toBe(true);
    has('nhiệt điện trở NTC 10k', 'basic/ntc-10k-b3950');
    has('nhiet dien tro ntc 100k b4050', 'basic/ntc-100k-b4050');
    has('diode zener 5.1 V', 'diodes/mmsz5231b');
    has('ổn áp sụt áp thấp 3.3', 'power/ap2112k-3.3');
    has('on ap tuyen tinh 12 V', 'power/lm340t-12');
    has('khuếch đại thuật toán rail-to-rail', 'analog/tlv9061');
    has('opto cach ly', 'misc/pc817b');
    has('cam bien nhiet do', 'misc/lm50');
    has('led 7 doan anode chung 0,36', 'indicators/seven-seg-ca-0.36-green');
    has('bo giai ma 3 sang 8', 'cmos/74hc238');
    has('chot trong suot ba trang thai dao', 'ttl/74ls533');
    has('SN74HC00D', 'cmos/sn74hc00d');
    has('HCF4017BEY', 'cmos/hcf4017bey');
    has('LM317T', 'power/lm317t');
    has('IRF3205PBF', 'transistors/irf3205pbf');
    setLang('vi');
  });

  it('the base part still ranks before its package variants', () => {
    const all = listParts();
    expect(searchCatalogue(all, 'irf3205')[0].id).toBe('transistors/irf3205');
    expect(searchCatalogue(all, 'tl072')[0].id).toBe('analog/tl072');
  });
});
