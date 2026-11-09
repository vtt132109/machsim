/**
 * Digital catalogue tests: structure of every part, SPICE IR with defaults (stub context and
 * the real netlister), and behaviour of the ICs through the real engine (count sequences,
 * adders, 7447 + display segment patterns, converters, hidden power pins, families, mixed
 * 555 + counter circuit, interactive parts).
 */
import { describe, expect, it } from 'vitest';
import { DIGITAL_PARTS } from './index';
import { getPart, defaultParams } from '../../index';
import { elementName, internalNodeName, type ToSpiceContextExt } from '../../partkit';
import type { PartDef } from '../../types';
import { createTransientStepper, findVector, runAnalyses, type AnalysisResult } from '../../../sim/index';
import { digitalModelTypes, SEGMENT_FONTS } from '../../../sim/devices/digital';
import { emptyNetlist, type AnalysisSpec, type ElementIR, type ModelCard, type Netlist, type Waveform } from '../../../sim/netlist';
import { flattenNetlist } from '../../../sim/spice/flatten';
import { interpolate } from '../../../sim/engine/testing';
import { validateParams } from '../../../model/erc';
import { buildNetlist } from '../../../model/netlister';
import { elementValueChanges } from '../../../model/interactive';
import { DesignBuilder } from '../../../model/designkit';
import { parseUserNumber } from '../../../util/units';

// ---------------------------------------------------------------------------------------------
// helpers

interface Frag {
  elements: ElementIR[];
  models: ModelCard[];
}

/**
 * Instantiate a part with pins mapped to node names (unmapped pins get a private node with a
 * 1 TΩ shunt, like the netlister); `nets` are resolvable supply / label nets.
 */
function instantiate(partId: string, refdes: string, pins: Record<string, string>, params: Record<string, string> = {}, nets: Record<string, string> = {}): Frag {
  const part = getPart(partId);
  if (!part?.toSpice) throw new Error(`no part ${partId}`);
  const merged = { ...defaultParams(part), ...params };
  const shunts: ElementIR[] = [];
  const names = new Set(part.symbol.pins.map((p) => p.name));
  const ctx: ToSpiceContextExt = {
    refdes,
    params: merged,
    node: (pin) => {
      if (!names.has(pin)) throw new Error(`${partId} has no pin ${pin}`);
      if (pins[pin] !== undefined) return pins[pin];
      const nc = `NC_${refdes}_${pin}`;
      if (!shunts.some((e) => e.nodes[0] === nc)) shunts.push({ type: 'R', name: `R_${nc}`, nodes: [nc, '0'], value: 1e12, params: {} });
      return nc;
    },
    num: (key) => {
      const v = parseUserNumber(merged[key] ?? '');
      if (!Number.isFinite(v)) throw new Error(`bad value for ${key}`);
      return v;
    },
    name: (t, s) => elementName(t, refdes, s),
    internal: (s) => internalNodeName(refdes, s),
    connected: (pin) => pins[pin] !== undefined,
    resolveNet: (name) => nets[name.toLowerCase()],
  };
  const frag = part.toSpice(ctx);
  return { elements: [...frag.elements, ...shunts], models: frag.models ?? [] };
}

function assemble(frags: Frag[], extra: ElementIR[], analyses: AnalysisSpec[]): Netlist {
  const n = emptyNetlist('digital parts');
  for (const f of frags) {
    n.elements.push(...f.elements);
    for (const m of f.models) n.models[m.name.toLowerCase()] = m;
  }
  n.elements.push(...extra);
  n.analyses = analyses;
  return n;
}

function simulate(frags: Frag[], extra: ElementIR[], spec: AnalysisSpec): AnalysisResult {
  const r = runAnalyses(assemble(frags, extra, [spec]))[0];
  expect(r.error, r.error).toBeUndefined();
  return r;
}

const vdc = (name: string, p: string, value: number): ElementIR => ({ type: 'V', name, nodes: [p, '0'], source: { dc: value }, params: {} });
const vwave = (name: string, p: string, dc: number, tran: Waveform): ElementIR => ({ type: 'V', name, nodes: [p, '0'], source: { dc, tran }, params: {} });
const res = (name: string, a: string, b: string, value: number): ElementIR => ({ type: 'R', name, nodes: [a, b], value, params: {} });
const cap = (name: string, a: string, b: string, value: number): ElementIR => ({ type: 'C', name, nodes: [a, b], value, params: {} });
const pulse = (v1: number, v2: number, td: number, tr: number, tf: number, pw: number, per: number): Waveform => ({ type: 'PULSE', args: [v1, v2, td, tr, tf, pw, per] });

const RAILS = [vdc('VHI', 'hi', 5), vdc('VLO', 'lo', 0)];
const bit = (w: number, k: number) => ((w >> k) & 1 ? 'hi' : 'lo');
const ttl = (v: number) => (v > 1.4 ? 1 : 0);
const vec = (r: AnalysisResult, name: string) => {
  const v = findVector(r, name);
  if (!v) throw new Error(`no vector ${name}`);
  return v.re;
};
const at = (r: AnalysisResult, name: string, t: number) => interpolate(r.scale!.re, vec(r, name), t);
function crossings(r: AnalysisResult, name: string, level: number, dir: 'up' | 'down'): number[] {
  const t = r.scale!.re;
  const v = vec(r, name);
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) {
    if (dir === 'up' ? v[i - 1] < level && v[i] >= level : v[i - 1] > level && v[i] <= level) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

describe('digital catalogue', () => {
  it('covers the required parts in their groups', () => {
    const ids = new Set(DIGITAL_PARTS.map((p) => p.id));
    const ttlPns = ['7400', '7402', '7404', '7408', '7410', '7414', '7420', '7432', '7486', '7474', '7476', '74107', '74112', '7447', '7490', '7493', '74161', '74163', '74164', '74165', '74138', '74139', '74151', '74153', '74157', '74174', '74175', '74193', '74283', '7485', '74244', '74245', '74121', '74123'];
    const cmosPns = ['4001', '4011', '4013', '4017', '4027', '4040', '4049', '4050', '4060', '4066', '4069', '4070', '4071', '4081', '4093', '4511'];
    const virt = ['and2', 'and3', 'and4', 'or2', 'or3', 'or4', 'nand2', 'nand3', 'nand4', 'nor2', 'nor3', 'xor2', 'xnor2', 'not', 'buf', 'tristate-buffer', 'dff', 'jkff', 'tff', 'sr-latch', 'd-latch'];
    for (const pn of ttlPns) expect(ids.has(`ttl/${pn}`), pn).toBe(true);
    for (const pn of cmosPns) expect(ids.has(`cmos/${pn}`), pn).toBe(true);
    for (const v of virt) expect(ids.has(`misc-digital/${v}`), v).toBe(true);
    for (const id of ['mixed/adc8', 'mixed/dac8', 'mixed/comparator-logic', 'indicators/seven-seg-ca', 'indicators/seven-seg-cc', 'indicators/hex-display', 'indicators/bargraph', 'indicators/logic-probe', 'sources/digital-clock', 'sources/logic-high', 'sources/logic-low', 'sources/logic-switch']) {
      expect(ids.has(id), id).toBe(true);
    }
    for (const p of DIGITAL_PARTS) expect(p.id.startsWith(`${p.group}/`), p.id).toBe(true);
    expect(getPart('ttl/7400')?.name).toBe('7400');
  });

  it('IC symbols show physical pin numbers matching the DIP pinout', () => {
    const p = getPart('ttl/7400')!;
    const num = (name: string) => p.symbol.pins.find((q) => q.name === name)?.number;
    expect([num('1A'), num('1B'), num('1Y'), num('3Y'), num('4B')]).toEqual(['1', '2', '3', '8', '13']);
    const c = getPart('cmos/4017')!;
    expect(c.symbol.pins.find((q) => q.name === 'Q0')?.number).toBe('3');
    expect(c.symbol.pins.find((q) => q.name === 'CO')?.number).toBe('12');
    // hidden power pins are not drawn
    expect(p.symbol.pins.some((q) => /vcc|gnd/i.test(q.name))).toBe(false);
  });
});

describe.each(DIGITAL_PARTS.map((p) => [p.id, p] as const))('part %s', (_id, part: PartDef) => {
  it('has a grid-aligned symbol and valid default parameters', () => {
    // pin names are unique even case-insensitively (SPICE node names ignore case)
    const names = part.symbol.pins.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    const b = part.symbol.bbox;
    for (const p of part.symbol.pins) {
      expect(Math.abs(p.x % 10), `${p.name}.x`).toBe(0);
      expect(Math.abs(p.y % 10), `${p.name}.y`).toBe(0);
      expect(p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h).toBe(true);
    }
    for (const t of part.symbol.prims) if (t.kind === 'text') expect(t.size ?? 10).toBeGreaterThanOrEqual(6);
    expect(validateParams(part, defaultParams(part))).toEqual([]);
    if (part.interactive) expect(part.params.map((p) => p.key)).toContain(part.interactive.param);
  });

  it('emits valid code-model IR (ideal and powered) that the engine accepts', () => {
    const pins = Object.fromEntries(part.symbol.pins.map((p) => [p.name, `n_${p.name}`]));
    const shunts = part.symbol.pins.map((p, i) => res(`R_sh_${i}`, `n_${p.name}`, '0', 1e6));
    const types = new Set(digitalModelTypes());
    const variants: Record<string, string>[] = [{}, { vcc: 'VCC', vdd: 'VDD' }];
    for (const nets of variants) {
      const frag = instantiate(part.id, 'U7', pins, {}, nets);
      const models = new Map(frag.models.map((m) => [m.name.toLowerCase(), m]));
      for (const el of frag.elements) {
        expect(el.name.includes('U7'), el.name).toBe(true);
        for (const n of el.nodes) expect(n.startsWith('n_') || n === '0' || n === 'null' || n.startsWith('U7.') || n === 'VCC' || n === 'VDD', `${el.name} node ${n}`).toBe(true);
        if (el.type === 'A') {
          const m = models.get(el.model!.toLowerCase());
          expect(m, el.model).toBeDefined();
          expect(types.has(m!.type), m!.type).toBe(true);
          for (const v of [...Object.values(m!.params), ...Object.values(el.params)]) expect(Number.isFinite(v)).toBe(true);
          const powered = 'vcc' in nets && el.params.pwr === 2;
          if (powered) expect(el.nodes.slice(-2)).toEqual([part.group === 'cmos' ? 'VDD' : 'VCC', '0']);
        }
      }
      const extra = [...shunts, vdc('V_VCC', 'VCC', 5), vdc('V_VDD', 'VDD', 5)];
      const n = assemble([frag], extra, [{ type: 'op' }]);
      expect(flattenNetlist(n).elements.length).toBe(n.elements.length);
      const r = runAnalyses(n)[0];
      expect(r.error, `${part.id}: ${r.error}`).toBeUndefined();
    }
  });

  it('simulates through the schematic netlister with supply symbols', () => {
    const b = new DesignBuilder(part.id);
    b.part(part.id, part.prefix === 'U' ? 'U1' : `${part.prefix}1`, 0, 0);
    b.part('sources/ground', 'GND1', 600, 600);
    b.part('sources/vcc', 'VCC1', 800, 600);
    b.part('sources/vdd', 'VDD1', 1000, 600);
    b.design.analysis = { active: 'op', specs: { op: { type: 'op' } } };
    const build = buildNetlist(b.design);
    expect(build.erc.filter((e) => e.severity === 'error')).toEqual([]);
    const r = runAnalyses(build.netlist)[0];
    expect(r.error, r.error).toBeUndefined();
  });
});

describe('TTL behaviour', () => {
  it('7400 truth table, family delays and output levels', () => {
    const frags = [0, 1, 2, 3].map((w) => instantiate('ttl/7400', `U${w}`, { '1A': bit(w, 0), '1B': bit(w, 1), '1Y': `y${w}` }));
    const s = simulate(frags, RAILS, { type: 'op' }).scalars!;
    expect([0, 1, 2, 3].map((w) => ttl(s[`V(y${w})`]))).toEqual([1, 1, 1, 0]);
    expect(s['V(y0)']).toBeCloseTo(3.4, 9); // LS high level (no load)
    expect(s['V(y3)']).toBeCloseTo(0.25, 9);
    // propagation delay per family (50 % of the input edge -> 1.4 V crossing of the output)
    const delay = (family: string) => {
      const f = instantiate('ttl/7400', 'U1', { '1A': 'in', '1B': 'hi', '1Y': 'y' }, { family });
      const r = simulate([f], [...RAILS, vwave('VIN', 'in', 0, pulse(0, 3.4, 20e-9, 1e-9, 1e-9, 50e-9, 1))], { type: 'tran', tstep: 1e-9, tstop: 100e-9 });
      return crossings(r, 'V(y)', 1.825, 'down')[0] - 20.5e-9;
    };
    expect(delay('LS')).toBeGreaterThan(9e-9);
    expect(delay('LS')).toBeLessThan(11e-9);
    expect(delay('S')).toBeLessThan(4e-9);
    expect(delay('STD')).toBeGreaterThan(6e-9);
    expect(delay('STD')).toBeLessThan(8e-9);
  });

  it('a floating TTL input reads high; HC inputs follow VCC/2', () => {
    const f = instantiate('ttl/7404', 'U1', { '1Y': 'y1', '2A': 'lo', '2Y': 'y2' });
    const s = simulate([f], RAILS, { type: 'op' }).scalars!;
    expect(ttl(s['V(y1)'])).toBe(0); // open input = high
    expect(ttl(s['V(y2)'])).toBe(1);
    const hc = instantiate('ttl/7404', 'U2', { '1A': 'in', '1Y': 'y' }, { family: 'HC' });
    const r = simulate([hc], [vdc('VIN', 'in', 0)], { type: 'dc', src: 'VIN', start: 0, stop: 5, step: 0.05 });
    const sw = r.scale!.re[vec(r, 'V(y)').findIndex((v) => v < 2.5)];
    expect(sw).toBeGreaterThan(2.5);
    expect(sw).toBeLessThan(2.56);
  });

  it('hidden VCC pin: outputs track the VCC net when it exists', () => {
    const ideal = instantiate('ttl/7404', 'U1', { '1A': 'lo', '1Y': 'y' });
    const powered = instantiate('ttl/7404', 'U2', { '1A': 'lo', '1Y': 'yp' }, {}, { vcc: 'VCC' });
    const forced = instantiate('ttl/7404', 'U3', { '1A': 'lo', '1Y': 'yi' }, { power: 'ideal' }, { vcc: 'VCC' });
    const s = simulate([ideal, powered, forced], [...RAILS, vdc('V_PWR_VCC', 'VCC', 4.5)], { type: 'op' }).scalars!;
    expect(s['V(y)']).toBeCloseTo(3.4, 9);
    expect(s['V(yp)']).toBeCloseTo(4.5 - 1.6, 9);
    expect(s['V(yi)']).toBeCloseTo(3.4, 9);
  });

  it('7474 captures D on the rising clock; ~PRE / ~CLR are asynchronous', () => {
    const f = instantiate('ttl/7474', 'U1', { '1D': 'd', '1CLK': 'clk', '1PRE': 'pre', '1CLR': 'hi', '1Q': 'q', '1QN': 'qn' });
    const r = simulate(
      [f],
      [
        ...RAILS,
        vwave('VC', 'clk', 0, pulse(0, 5, 100e-9, 2e-9, 2e-9, 98e-9, 200e-9)),
        vwave('VD', 'd', 0, { type: 'PWL', args: [0, 5, 250e-9, 5, 252e-9, 0] }),
        vwave('VP', 'pre', 5, { type: 'PWL', args: [0, 5, 650e-9, 5, 652e-9, 0, 680e-9, 0, 682e-9, 5] }),
      ],
      { type: 'tran', tstep: 5e-9, tstop: 800e-9 },
    );
    const q = (t: number) => ttl(at(r, 'V(q)', t));
    // edges at 101, 301, 501, 701 ns; D low from 251 ns; ~PRE low 651..681 ns
    // (LS74 preset-to-Q delay ≈ 18 ns)
    expect([q(50e-9), q(150e-9), q(290e-9), q(350e-9), q(675e-9), q(690e-9), q(750e-9)]).toEqual([0, 1, 1, 0, 1, 1, 0]);
    expect(ttl(at(r, 'V(qn)', 350e-9))).toBe(1);
  });

  it('7490 wired as BCD counter counts 0..9', () => {
    const f = instantiate('ttl/7490', 'U1', { CKA: 'clk', CKB: 'qa', QA: 'qa', QB: 'qb', QC: 'qc', QD: 'qd', R01: 'lo', R02: 'lo', R91: 'lo', R92: 'lo' });
    const r = simulate([f], [...RAILS, vwave('VC', 'clk', 5, pulse(5, 0, 100e-9, 2e-9, 2e-9, 98e-9, 200e-9))], { type: 'tran', tstep: 10e-9, tstop: 2600e-9 });
    const bcd = (t: number) => ttl(at(r, 'V(qa)', t)) + 2 * ttl(at(r, 'V(qb)', t)) + 4 * ttl(at(r, 'V(qc)', t)) + 8 * ttl(at(r, 'V(qd)', t));
    // falling edges at 100 + 200k ns
    expect(Array.from({ length: 12 }, (_, k) => bcd(200e-9 * k + 190e-9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]);
  });

  it('74161 counts 0..15 with RCO at 15; 74163 clears synchronously', () => {
    const pins = (pre: string, clr: string): Record<string, string> => ({ CLK: 'clk', CLR: clr, LOAD: 'hi', ENP: 'hi', ENT: 'hi', A: 'lo', B: 'lo', C: 'lo', D: 'lo', QA: `${pre}a`, QB: `${pre}b`, QC: `${pre}c`, QD: `${pre}d`, RCO: `${pre}rco` });
    const r = simulate(
      [instantiate('ttl/74161', 'U1', pins('p', 'hi')), instantiate('ttl/74163', 'U2', pins('s', 'clr')), instantiate('ttl/74161', 'U3', pins('a', 'clr'))],
      [...RAILS, vwave('VC', 'clk', 0, pulse(0, 5, 100e-9, 2e-9, 2e-9, 98e-9, 200e-9)), vwave('VCLR', 'clr', 5, { type: 'PWL', args: [0, 5, 1020e-9, 5, 1022e-9, 0, 1150e-9, 0, 1152e-9, 5] })],
      { type: 'tran', tstep: 10e-9, tstop: 3500e-9 },
    );
    const cnt = (p: string, t: number) => ['a', 'b', 'c', 'd'].reduce((acc, s, k) => acc + ttl(at(r, `V(${p}${s})`, t)) * 2 ** k, 0);
    expect(Array.from({ length: 17 }, (_, k) => cnt('p', 200e-9 * k + 190e-9))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1]);
    expect(ttl(at(r, 'V(prco)', 2990e-9))).toBe(1);
    expect(ttl(at(r, 'V(prco)', 3190e-9))).toBe(0);
    expect(cnt('a', 1060e-9)).toBe(0); // 74161: immediate clear
    expect(cnt('s', 1060e-9)).toBe(5); // 74163: still 5 until the 1100 ns edge
    expect(cnt('s', 1130e-9)).toBe(0);
  });

  it('74283 adds 4-bit words with carry', () => {
    const cases: [number, number, number][] = [];
    for (let a = 0; a < 16; a += 3) for (let b = 0; b < 16; b += 5) cases.push([a, b, (a + b) % 2]);
    cases.push([15, 15, 1], [0, 0, 0], [8, 8, 0]);
    const frags = cases.map(([a, b, c], i) =>
      instantiate('ttl/74283', `U${i}`, {
        A1: bit(a, 0), A2: bit(a, 1), A3: bit(a, 2), A4: bit(a, 3),
        B1: bit(b, 0), B2: bit(b, 1), B3: bit(b, 2), B4: bit(b, 3),
        C0: bit(c, 0), S1: `s${i}_0`, S2: `s${i}_1`, S3: `s${i}_2`, S4: `s${i}_3`, C4: `s${i}_4`,
      }),
    );
    const s = simulate(frags, RAILS, { type: 'op' }).scalars!;
    cases.forEach(([a, b, c], i) => {
      const sum = [0, 1, 2, 3, 4].reduce((acc, k) => acc + ttl(s[`V(s${i}_${k})`]) * 2 ** k, 0);
      expect(sum, `${a}+${b}+${c}`).toBe(a + b + c);
    });
  });

  it('7447 drives a common-anode display: segment patterns for 0..15, lamp test and blanking', () => {
    const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const frags: Frag[] = [];
    const extra: ElementIR[] = [...RAILS];
    const stage = (k: number, code: number, ctl: Record<string, string>) => {
      const pins: Record<string, string> = { A: bit(code, 0), B: bit(code, 1), C: bit(code, 2), D: bit(code, 3), ...ctl };
      for (const s of segs) {
        pins[`SEG${s.toUpperCase()}`] = `x${k}${s}`;
        extra.push(res(`R${k}${s}`, `x${k}${s}`, `d${k}${s}`, 330));
      }
      frags.push(instantiate('ttl/7447', `U${k}`, pins));
      frags.push(instantiate('indicators/seven-seg-ca', `DS${k}`, Object.fromEntries([['CA', 'hi'], ...segs.map((s) => [s, `d${k}${s}`])])));
    };
    for (let code = 0; code < 16; code++) stage(code, code, {});
    stage(16, 3, { LT: 'lo' });
    stage(17, 3, { BIRBO: 'lo' });
    stage(18, 0, { RBI: 'lo' });
    const s = simulate(frags, extra, { type: 'op' }).scalars!;
    for (let code = 0; code < 16; code++) expect(s[`V(DS${code}.code)`], `code ${code}`).toBeCloseTo(SEGMENT_FONTS.ttl7447[code], 6);
    expect(s['V(DS16.code)']).toBeCloseTo(0x7f, 6);
    expect(s['V(DS17.code)']).toBeCloseTo(0, 6);
    expect(s['V(DS18.code)']).toBeCloseTo(0, 6); // ripple-blanked zero
    // a lit segment's LED is forward biased near its 20 mA voltage (≈ 8 mA through 330 Ω)
    const vf = 5 - s['V(d8a)'];
    expect(vf).toBeGreaterThan(1.8);
    expect(vf).toBeLessThan(2.0);
    expect((s['V(d8a)'] - s['V(x8a)']) / 330).toBeGreaterThan(7e-3);
  });

  it('74121 pulse width follows ln2 · Rext · Cext', () => {
    const f = instantiate('ttl/74121', 'U1', { A1: 'lo', A2: 'lo', B: 'b', Q: 'q', QN: 'qn' }, { rext: '10k', cext: '10n' });
    const r = simulate([f], [...RAILS, vwave('VB', 'b', 0, pulse(0, 5, 10e-6, 10e-9, 10e-9, 1e-6, 1))], { type: 'tran', tstep: 0.5e-6, tstop: 200e-6 });
    const up = crossings(r, 'V(q)', 1.825, 'up');
    const down = crossings(r, 'V(q)', 1.825, 'down');
    // both edges are delayed (LS: 4 x 9 ns rising, 4 x 10 ns falling): width = tw + 4 ns
    expect(down[0] - up[0]).toBeCloseTo(Math.LN2 * 10e3 * 10e-9 + 4e-9, 11);
  });
});

describe('CMOS behaviour', () => {
  it('4017 decade counter steps through its one-hot outputs; levels follow vdd', () => {
    const outs = Array.from({ length: 10 }, (_, k) => [`Q${k}`, `q${k}`]);
    const f = instantiate('cmos/4017', 'U1', { CLK: 'clk', INH: '0', RST: '0', CO: 'co', ...Object.fromEntries(outs) }, { vdd: '10' });
    const r = simulate([f], [vwave('VC', 'clk', 0, pulse(0, 10, 1e-6, 20e-9, 20e-9, 1e-6, 2e-6))], { type: 'tran', tstep: 50e-9, tstop: 26e-6 });
    const hot = (t: number) => outs.map(([, n]) => (at(r, `V(${n})`, t) > 5 ? 1 : 0)).indexOf(1);
    expect(Array.from({ length: 12 }, (_, k) => hot(2e-6 * k + 1.8e-6))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 1, 2]);
    expect(at(r, 'V(q1)', 2.8e-6)).toBeCloseTo(10, 6);
    expect(at(r, 'V(co)', 7.8e-6)).toBeCloseTo(10, 6); // count 4
    expect(at(r, 'V(co)', 9.8e-6)).toBeCloseTo(0, 6); // count 5
  });

  it('4511 + common-cathode display; hidden VDD pin tracks the VDD net', () => {
    const segs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const frags: Frag[] = [];
    const extra: ElementIR[] = [vdc('VHI', 'hi', 9), vdc('VLO', 'lo', 0), vdc('V_PWR_VDD', 'VDD', 9)];
    for (let code = 0; code < 10; code++) {
      const pins: Record<string, string> = { A: bit(code, 0), B: bit(code, 1), C: bit(code, 2), D: bit(code, 3), LT: 'hi', BL: 'hi', LE: 'lo' };
      for (const s of segs) {
        pins[`SEG${s.toUpperCase()}`] = `x${code}${s}`;
        extra.push(res(`R${code}${s}`, `x${code}${s}`, `d${code}${s}`, 680));
      }
      frags.push(instantiate('cmos/4511', `U${code}`, pins, { vdd: '9' }, { vdd: 'VDD' }));
      frags.push(instantiate('indicators/seven-seg-cc', `DS${code}`, Object.fromEntries([['CC', '0'], ...segs.map((s) => [s, `d${code}${s}`])])));
    }
    const s = simulate(frags, extra, { type: 'op' }).scalars!;
    for (let code = 0; code < 10; code++) expect(s[`V(DS${code}.code)`], `code ${code}`).toBeCloseTo(SEGMENT_FONTS.cmos4511[code], 6);
    expect(s['V(x0e)']).toBeLessThan(9); // sourcing segment current through the output resistance
    expect(s['V(x0e)']).toBeGreaterThan(7);
  });

  it('4066 switch conducts while its control is high', () => {
    const f = instantiate('cmos/4066', 'U1', { '1A': 'hi', '1B': 'o1', '1C': 'hi', '2A': 'hi', '2B': 'o2', '2C': 'lo' });
    const s = simulate([f], [...RAILS, res('R1', 'o1', '0', 10e3), res('R2', 'o2', '0', 10e3)], { type: 'op' }).scalars!;
    expect(s['V(o1)']).toBeCloseTo((5 * 10e3) / (10e3 + 270), 6);
    expect(s['V(o2)']).toBeLessThan(0.01);
  });

  it('4060 RC oscillator and divider (f ≈ 1 / (2.3 Rt Ct))', () => {
    const Rt = 10e3;
    const Ct = 1e-9;
    const f = instantiate('cmos/4060', 'U1', { PHI_I: 'rs', PHI_O: 'rtc', PHI_ON: 'ctc', RST: '0', Q4: 'q4' });
    const r = simulate([f], [res('RS', 'rs', 'j', 100e3), res('RT', 'rtc', 'j', Rt), cap('CT', 'ctc', 'j', Ct)], { type: 'tran', tstep: 0.5e-6, tstop: 1.6e-3 });
    const ups = crossings(r, 'V(rtc)', 2.5, 'up');
    const period = (ups[ups.length - 1] - ups[2]) / (ups.length - 3);
    expect(period / (2.3 * Rt * Ct)).toBeGreaterThan(0.95);
    expect(period / (2.3 * Rt * Ct)).toBeLessThan(1.05);
    // Q4 divides the oscillator by 16
    const q4 = crossings(r, 'V(q4)', 2.5, 'up');
    expect((q4[q4.length - 1] - q4[1]) / (q4.length - 2) / period).toBeCloseTo(16, 1);
  });
});

describe('mixed and interactive parts', () => {
  it('ADC 8-bit -> DAC 8-bit round trip (DC sweep) is exact to the truncation LSB', () => {
    const bits = Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`D${k}`, `b${k}`]));
    const adc = instantiate('mixed/adc8', 'U1', { VIN: 'vin', VREFP: 'vref', VREFN: '0', EOC: 'eoc', ...bits });
    const dac = instantiate('mixed/dac8', 'U2', { VREFP: 'vref', VREFN: '0', VOUT: 'out', ...bits });
    const r = simulate([adc, dac], [vdc('VIN', 'vin', 0), vdc('VREF', 'vref', 2.56)], { type: 'dc', src: 'VIN', start: 0, stop: 2.55, step: 0.0037 });
    const vin = r.scale!.re;
    const out = vec(r, 'V(out)');
    for (let i = 0; i < vin.length; i++) expect(out[i]).toBeCloseTo(Math.floor((vin[i] * 100) / 1 + 1e-9) / 100, 9);
  });

  it('comparator-to-logic converts an analog sine into a square wave', () => {
    const f = instantiate('mixed/comparator-logic', 'U1', { 'IN+': 'in', 'IN-': '0', OUT: 'y' }, { delay: '0' });
    const r = simulate([f], [vwave('VIN', 'in', 0, { type: 'SIN', args: [0, 1, 1e3, 0, 0, 0] })], { type: 'tran', tstep: 2e-6, tstop: 2e-3 });
    const up = crossings(r, 'V(y)', 2.5, 'up');
    expect(up[0]).toBeCloseTo(Math.asin(0.005) / (2 * Math.PI * 1e3), 6);
    expect(up[1] - up[0]).toBeCloseTo(1e-3, 7);
  });

  it('hex display shows the input digit', () => {
    const frags = Array.from({ length: 16 }, (_, c) => instantiate('indicators/hex-display', `H${c}`, { D0: bit(c, 0), D1: bit(c, 1), D2: bit(c, 2), D3: bit(c, 3) }));
    const s = simulate(frags, RAILS, { type: 'op' }).scalars!;
    for (let c = 0; c < 16; c++) expect(s[`V(H${c}.code)`]).toBeCloseTo(SEGMENT_FONTS.hex[c], 9);
    const binding = getPart('indicators/hex-display') as { bindIndicator?: (b: unknown) => unknown };
    expect(binding.bindIndicator!({ refdes: 'H3', net: () => null })).toEqual({ signal: { kind: 'voltage', pos: 'H3.code', neg: '0' } });
  });

  it('555 astable clock drives a 74161 counter (schematic netlister, VCC symbol)', () => {
    const b = new DesignBuilder('555 counter');
    const vcc = b.part('sources/vcc', 'VCC1', 0, 0);
    const gnd = b.part('sources/ground', 'GND1', 0, 400);
    b.labelPin(vcc, '1', 'VCC');
    b.labelPin(gnd, '1', 'GNDNET');
    const t = b.part('analog/555', 'U1', 300, 200);
    const ra = b.part('basic/resistor', 'R1', 600, 100, { value: '1k' });
    const rb = b.part('basic/resistor', 'R2', 600, 300, { value: '10k' });
    const c = b.part('basic/capacitor', 'C1', 600, 500, { value: '10n' });
    for (const [h, p, n] of [
      [t, 'VCC', 'VCC'], [t, 'RST', 'VCC'], [t, 'GND', 'GNDNET'], [t, 'OUT', 'CLK555'], [t, 'DIS', 'DIS'], [t, 'THR', 'THR'], [t, 'TRIG', 'THR'],
      [ra, '1', 'VCC'], [ra, '2', 'DIS'], [rb, '1', 'DIS'], [rb, '2', 'THR'], [c, '1', 'THR'], [c, '2', 'GNDNET'],
    ] as const) {
      b.labelPin(h, p, n);
    }
    const u = b.part('ttl/74161', 'U2', 1000, 200);
    for (const [p, n] of [['CLK', 'CLK555'], ['CLR', 'VCC'], ['LOAD', 'VCC'], ['ENP', 'VCC'], ['ENT', 'VCC'], ['A', 'GNDNET'], ['B', 'GNDNET'], ['C', 'GNDNET'], ['D', 'GNDNET'], ['QA', 'QA'], ['QB', 'QB'], ['QC', 'QC'], ['QD', 'QD']] as const) {
      b.labelPin(u, p, n);
    }
    b.design.analysis = { active: 'tran', specs: { tran: { type: 'tran', tstep: 1e-6, tstop: 2.5e-3 } } };
    const build = buildNetlist(b.design);
    expect(build.erc.filter((e) => e.severity === 'error')).toEqual([]);
    const counter = build.netlist.elements.find((e) => e.type === 'A')!;
    expect(counter.params.pwr).toBe(2); // hidden VCC pin found the VCC net
    const r = runAnalyses(build.netlist)[0];
    expect(r.error, r.error).toBeUndefined();
    const clk = crossings(r, 'V(CLK555)', 1.4, 'up');
    expect(clk.length).toBeGreaterThan(10);
    const period = (clk[clk.length - 1] - clk[1]) / (clk.length - 2);
    expect(period / (0.693 * (1e3 + 2 * 10e3) * 10e-9)).toBeGreaterThan(0.95);
    expect(period / (0.693 * (1e3 + 2 * 10e3) * 10e-9)).toBeLessThan(1.05);
    const count = (tt: number) => ['QA', 'QB', 'QC', 'QD'].reduce((acc, n, k) => acc + ttl(at(r, `V(${n})`, tt)) * 2 ** k, 0);
    for (let i = 1; i + 1 < clk.length; i++) expect((count(clk[i + 1] - 2e-6) - count(clk[i] - 2e-6) + 16) % 16, `edge ${i}`).toBe(1);
  });

  it('interactive logic switch and digital clock change in place (elementValueChanges + stepper)', () => {
    const design = (state: string, freq: string) => {
      const b = new DesignBuilder('interactive');
      const sw = b.part('sources/logic-switch', 'S1', 0, 0, { state });
      const inv = b.part('misc-digital/not', 'U1', 200, 0);
      const clk = b.part('sources/digital-clock', 'V1', 0, 200, { freq });
      b.part('sources/ground', 'GND1', 400, 400);
      b.labelPin(sw, 'OUT', 'IN');
      b.labelPin(inv, 'A', 'IN');
      b.labelPin(inv, 'Y', 'Y');
      b.labelPin(clk, 'OUT', 'CK');
      return buildNetlist(b.design, { includeAnalysis: false }).netlist;
    };
    const off = design('false', '1k');
    const on = design('true', '2k');
    const changes = elementValueChanges(off, on);
    expect(changes).toEqual(
      expect.arrayContaining([
        { element: 'V_S1', param: 'dc', value: 5 },
        { element: 'A_V1', param: 'freq', value: 2000 },
      ]),
    );
    const st = createTransientStepper(off, { tstep: 10e-6 });
    st.advance(2e-3);
    expect(st.latest()['V(Y)']).toBeCloseTo(5, 6);
    for (const c of changes!) st.setParam(c.element, c.param, c.value);
    const chunk = st.advance(6e-3);
    expect(st.latest()['V(Y)']).toBeCloseTo(0, 6);
    const ck = chunk.vectors['V(CK)'];
    const edges: number[] = [];
    for (let i = 1; i < ck.length; i++) if (ck[i - 1] < 2.5 && ck[i] >= 2.5) edges.push(chunk.time[i]);
    expect(edges[edges.length - 1] - edges[edges.length - 2]).toBeCloseTo(0.5e-3, 6);
  });
});
