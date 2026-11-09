/**
 * Behaviour of the memories, programmable logic, line interfaces, mixed-signal parts and
 * displays of the digital catalogue through their library definitions and the real engine:
 * RAM / ROM / EEPROM read and write, PLD equations and truth tables, RS-232 / RS-485 levels,
 * converter accuracy and handshakes, analog switches, the VCO, the character LCD showing written
 * text, dot-matrix / alphanumeric / bar-graph / hex displays.
 */
import { describe, expect, it } from 'vitest';
import { getPart, defaultParams } from '../index';
import { elementName, internalNodeName, type ToSpiceContextExt, type LibraryPartDef } from '../partkit';
import { findVector, runAnalyses, type AnalysisResult } from '../../sim/index';
import { emptyNetlist, type ElementIR, type ModelCard, type Waveform } from '../../sim/netlist';
import { interpolate } from '../../sim/engine/testing';
import { buildNetlist } from '../../model/netlister';
import { DesignBuilder } from '../../model/designkit';
import { parseUserNumber } from '../../util/units';
import { SEGMENT_FONTS } from '../../sim/devices/digital';

interface Frag {
  elements: ElementIR[];
  models: ModelCard[];
}

function inst(partId: string, refdes: string, pins: Record<string, string>, params: Record<string, string> = {}): Frag {
  const part = getPart(partId);
  if (!part?.toSpice) throw new Error(`no part ${partId}`);
  const merged = { ...defaultParams(part), ...params };
  const shunts: ElementIR[] = [];
  const known = new Set(part.symbol.pins.map((p) => p.name));
  const ctx: ToSpiceContextExt = {
    refdes,
    params: merged,
    node: (pin) => {
      if (!known.has(pin)) throw new Error(`${partId} has no pin ${pin}`);
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
    resolveNet: () => undefined,
  };
  const frag = part.toSpice(ctx);
  return { elements: [...frag.elements, ...shunts], models: frag.models ?? [] };
}

function sim(frags: Frag[], extra: ElementIR[], spec: Parameters<typeof runAnalyses>[0]['analyses'][number]): AnalysisResult {
  const n = emptyNetlist('misc');
  for (const f of frags) {
    n.elements.push(...f.elements);
    for (const m of f.models) n.models[m.name.toLowerCase()] = m;
  }
  n.elements.push(...extra);
  n.analyses = [spec];
  const r = runAnalyses(n)[0];
  expect(r.error, r.error).toBeUndefined();
  return r;
}

const vdc = (name: string, p: string, value: number): ElementIR => ({ type: 'V', name, nodes: [p, '0'], source: { dc: value }, params: {} });
const res = (name: string, a: string, b: string, value: number): ElementIR => ({ type: 'R', name, nodes: [a, b], value, params: {} });
const vec = (r: AnalysisResult, name: string) => findVector(r, name)!.re;
const at = (r: AnalysisResult, name: string, t: number) => interpolate(r.scale!.re, vec(r, name), t);

/** PWL logic level per step of T seconds (2 ns transitions). */
function steps(values: number[], T: number, high = 5): Waveform {
  const args: number[] = [0, values[0] * high];
  for (let k = 1; k < values.length; k++) if (values[k] !== values[k - 1]) args.push(k * T, values[k - 1] * high, k * T + 2e-9, values[k] * high);
  return { type: 'PWL', args };
}
const src = (name: string, node: string, w: Waveform): ElementIR => ({ type: 'V', name, nodes: [node, '0'], source: { dc: w.args[1], tran: w }, params: {} });
const bits = (w: number, n: number) => Array.from({ length: n }, (_, k) => (w >> k) & 1);
const logic = (v: number, thr = 1.4) => (v > thr ? 1 : 0);

describe('memories', () => {
  it('6116 SRAM: bytes written in a transient read back; the outputs are released while writing or deselected', () => {
    const T = 300e-9;
    // cycles: write A=1 <- 0x5A, write A=2 <- 0xC3, read A=1, read A=2, deselect
    const addr = [1, 1, 2, 2, 1, 2, 2];
    const data = [0x5a, 0x5a, 0xc3, 0xc3, 0, 0, 0];
    const we = [1, 0, 1, 0, 1, 1, 1];
    const drive = [1, 1, 1, 1, 0, 0, 0];
    const cs = [0, 0, 0, 0, 0, 0, 1];
    const pins: Record<string, string> = { CS: 'cs', OE: '0', WE: 'we' };
    const extra: ElementIR[] = [src('VCS', 'cs', steps(cs, T)), src('VWE', 'we', steps(we, T)), src('VDRV', 'drv', steps(drive, T)), vdc('VMID', 'mid', 2.5)];
    const models: ModelCard[] = [{ name: 'tri', type: 'D_TRISTATE', params: { vol: 0, voh: 5, rout: 10 } }];
    for (let k = 0; k < 11; k++) {
      pins[`A${k}`] = k < 2 ? `a${k}` : '0';
      if (k < 2) extra.push(src(`VA${k}`, `a${k}`, steps(addr.map((a) => (a >> k) & 1), T)));
    }
    for (let k = 0; k < 8; k++) {
      pins[`D${k}`] = `d${k}`;
      extra.push(src(`VW${k}`, `w${k}`, steps(data.map((d) => (d >> k) & 1), T)), { type: 'A', name: `AT${k}`, nodes: [`w${k}`, 'drv', `d${k}`], model: 'tri', params: {} }, res(`RM${k}`, `d${k}`, 'mid', 1e5));
    }
    const r = sim([inst('misc-digital/6116', 'U1', pins), { elements: [], models }], extra, { type: 'tran', tstep: 10e-9, tstop: addr.length * T });
    const byte = (t: number) => bits(0, 8).reduce((a, _, k) => a + logic(at(r, `V(d${k})`, t), 2.5) * 2 ** k, 0);
    expect(byte(4.9 * T)).toBe(0x5a);
    expect(byte(5.9 * T)).toBe(0xc3);
    // deselected: the bus floats at the 2.5 V bias
    expect(at(r, 'V(d0)', 6.9 * T)).toBeCloseTo(2.5, 1);
  });

  it('2716 EPROM reads its contents image; a bad image is reported', () => {
    const p: Record<string, string> = { CS: '0', OE: '0' };
    for (let k = 0; k < 11; k++) p[`A${k}`] = k === 0 ? 'a0' : '0';
    for (let k = 0; k < 8; k++) p[`D${k}`] = `q${k}`;
    for (const [a, want] of [[0, 0x12], [1, 0xab]] as const) {
      const r = sim([inst('misc-digital/2716', 'U1', p, { data: '12 AB // two bytes' })], [vdc('VA', 'a0', a * 5)], { type: 'op' });
      expect(bits(0, 8).reduce((acc, _, k) => acc + logic(r.scalars![`V(q${k})`], 2.5) * 2 ** k, 0)).toBe(want);
    }
    expect(() => inst('misc-digital/2716', 'U1', p, { data: '1FF' })).toThrow(/bad value for data: .*does not fit/);
    // the generic 32 x 8 ROM ships with a 7-segment font table
    const q: Record<string, string> = { CS: '0', OE: '0', A0: 'hi', A1: '0', A2: 'hi', A3: '0', A4: '0' };
    for (let k = 0; k < 8; k++) q[`D${k}`] = `q${k}`;
    const s = sim([inst('misc-digital/rom-32x8', 'U2', q)], [vdc('VH', 'hi', 5)], { type: 'op' }).scalars!;
    expect(bits(0, 8).reduce((acc, _, k) => acc + logic(s[`V(q${k})`], 2.5) * 2 ** k, 0)).toBe(SEGMENT_FONTS.hex[5]);
  });

  it('74LS189 stores 4-bit words and outputs their complement; 74LS670 reads and writes separate addresses', () => {
    const T = 300e-9;
    const r = sim(
      [inst('misc-digital/74ls189', 'U1', { A0: 'a0', A1: '0', A2: '0', A3: '0', D0: 'hi', D1: '0', D2: 'hi', D3: 'hi', CS: '0', WE: 'we', Q0: 'q0', Q1: 'q1', Q2: 'q2', Q3: 'q3' })],
      [vdc('VH', 'hi', 3.6), src('VA', 'a0', steps([1, 1, 1, 0], T, 3.6)), src('VWE', 'we', steps([1, 0, 1, 1], T, 3.6)), ...['q0', 'q1', 'q2', 'q3'].map((q) => res(`R${q}`, q, '0', 1e5))],
      { type: 'tran', tstep: 10e-9, tstop: 4 * T },
    );
    // word 1 = 1101 -> outputs ~ = 0010; word 0 untouched (0000 -> 1111)
    expect([0, 1, 2, 3].map((k) => logic(at(r, `V(q${k})`, 2.9 * T)))).toEqual([0, 1, 0, 0]);
    expect([0, 1, 2, 3].map((k) => logic(at(r, `V(q${k})`, 3.9 * T)))).toEqual([1, 1, 1, 1]);
    const f = sim(
      [inst('misc-digital/74ls670', 'U2', { WA: 'hi', WB: '0', RA: 'hi', RB: '0', D1: 'hi', D2: '0', D3: '0', D4: 'hi', GW: 'gw', GR: '0', Q1: 'q1', Q2: 'q2', Q3: 'q3', Q4: 'q4' }, { data: '0 0 0 0' })],
      [vdc('VH', 'hi', 3.6), src('VGW', 'gw', steps([1, 0, 1], T, 3.6))],
      { type: 'tran', tstep: 10e-9, tstop: 3 * T },
    );
    expect([1, 2, 3, 4].map((k) => logic(at(f, `V(q${k})`, 0.9 * T)))).toEqual([0, 0, 0, 0]);
    expect([1, 2, 3, 4].map((k) => logic(at(f, `V(q${k})`, 2.9 * T)))).toEqual([1, 0, 0, 1]);
  });
});

describe('programmable logic', () => {
  it('PLD 4x4 default program: half adder on O0 / O1, 2-bit counter on O2 / O3', () => {
    for (let w = 0; w < 4; w++) {
      const s = sim([inst('misc-digital/pld-4x4', 'U1', { I0: w & 1 ? 'hi' : '0', I1: w & 2 ? 'hi' : '0', O0: 's', O1: 'c' })], [vdc('VH', 'hi', 5)], { type: 'op' }).scalars!;
      expect([logic(s['V(s)'], 2.5), logic(s['V(c)'], 2.5)]).toEqual([(w & 1) ^ (w >> 1), (w & 1) & (w >> 1)]);
    }
    const T = 200e-9;
    const r = sim([inst('misc-digital/pld-4x4', 'U1', { CLK: 'clk', O2: 'q0', O3: 'q1' })], [src('VC', 'clk', steps([0, 1, 0, 1, 0, 1, 0, 1, 0], T))], { type: 'tran', tstep: 5e-9, tstop: 9 * T });
    const count = (t: number) => logic(at(r, 'V(q0)', t), 2.5) + 2 * logic(at(r, 'V(q1)', t), 2.5);
    expect([1.9, 3.9, 5.9, 7.9].map((k) => count(k * T))).toEqual([1, 2, 3, 0]);
  });

  it('PLD truth-table program and error reporting', () => {
    const table = 'I1 I0 | O0\n0 0 | 1\n1 1 | 1';
    for (let w = 0; w < 4; w++) {
      const s = sim([inst('misc-digital/pld-4x4', 'U1', { I0: w & 1 ? 'hi' : '0', I1: w & 2 ? 'hi' : '0', O0: 'y' }, { program: table })], [vdc('VH', 'hi', 5)], { type: 'op' }).scalars!;
      expect(logic(s['V(y)'], 2.5), `w=${w}`).toBe(w === 0 || w === 3 ? 1 : 0);
    }
    expect(() => inst('misc-digital/pld-4x4', 'U1', {}, { program: 'O0 = I7' })).toThrow(/bad value for program: line 1: input I7 does not exist/);
    // through the netlister the mistake becomes an ERC error on the part
    const b = new DesignBuilder('pld');
    b.part('misc-digital/pld-4x4', 'U1', 0, 0, { program: 'O0 = I0 &' });
    b.part('sources/ground', 'GND1', 300, 300);
    const build = buildNetlist(b.design, { includeAnalysis: false });
    expect(build.erc.some((m) => m.severity === 'error' && m.refdes === 'U1' && /program/.test(m.message))).toBe(true);
  });
});

describe('line drivers and receivers', () => {
  it('MAX232: TTL high gives −9 V on the line, a +9 V line gives a TTL low', () => {
    const s = sim([inst('misc-digital/max232', 'U1', { T1IN: 'hi', T2IN: '0', T1OUT: 't1', T2OUT: 't2', R1IN: 'line', R1OUT: 'r1', R2IN: 'neg', R2OUT: 'r2' })], [vdc('VH', 'hi', 5), vdc('VL', 'line', 9), vdc('VN', 'neg', -9), res('RL1', 't1', '0', 3e3), res('RL2', 't2', '0', 3e3)], { type: 'op' }).scalars!;
    expect(s['V(t1)']).toBeLessThan(-8);
    expect(s['V(t2)']).toBeGreaterThan(8);
    expect(logic(s['V(r1)'])).toBe(0);
    expect(logic(s['V(r2)'])).toBe(1);
  });

  it('SN75176: the driver makes a differential pair, the receiver decodes it and tri-states with ~RE', () => {
    const run = (di: number, de: number, re: number) => sim([inst('misc-digital/sn75176', 'U1', { DI: di ? 'hi' : '0', DE: de ? 'hi' : '0', RE: re ? 'hi' : '0', A: 'a', B: 'b', RO: 'ro' })], [vdc('VH', 'hi', 5), res('RT', 'a', 'b', 120), res('RA', 'a', 'mid', 1e4), res('RB', 'b', 'mid', 1e4), vdc('VM', 'mid', 2.5), res('RR', 'ro', 'mid', 1e5)], { type: 'op' }).scalars!;
    const one = run(1, 1, 0);
    expect(one['V(a)'] - one['V(b)']).toBeGreaterThan(1.5);
    expect(logic(one['V(ro)'], 2.5)).toBe(1);
    const zero = run(0, 1, 0);
    expect(zero['V(a)'] - zero['V(b)']).toBeLessThan(-1.5);
    expect(logic(zero['V(ro)'], 2.5)).toBe(0);
    expect(run(1, 1, 1)['V(ro)']).toBeCloseTo(2.5, 2);
  });
});

describe('converters, switches and the VCO', () => {
  it('12-bit parallel ADC -> 12-bit DAC reproduces the input to one LSB; 16-bit DAC weights', () => {
    const bitsPins = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, k) => [`D${k}`, `b${k}`]));
    const adc = inst('mixed/adc12', 'U1', { VIN: 'vin', VREFP: 'ref', VREFN: '0', EOC: 'eoc', ...bitsPins(12) });
    const dac = inst('mixed/dac12', 'U2', { VREFP: 'ref', VREFN: '0', VOUT: 'out', ...bitsPins(12) });
    const r = sim([adc, dac], [vdc('VIN', 'vin', 0), vdc('VREF', 'ref', 4.096)], { type: 'dc', src: 'VIN', start: 0, stop: 4, step: 0.0731 });
    const vin = r.scale!.re;
    const out = vec(r, 'V(out)');
    for (let i = 0; i < vin.length; i++) expect(out[i]).toBeCloseTo(Math.floor(vin[i] * 1000 + 1e-6) / 1000, 9);
    const d16 = inst('mixed/dac16', 'U3', { VREFP: 'ref', VREFN: '0', VOUT: 'o16', D15: 'hi', D0: 'hi' });
    const s = sim([d16], [vdc('VREF', 'ref', 4.096), vdc('VH', 'hi', 5)], { type: 'op' }).scalars!;
    expect(s['V(o16)']).toBeCloseTo(((32768 + 1) / 65536) * 4.096, 9);
  });

  it('ADC0804 handshake: ~WR starts, ~INTR signals the result, ~RD reads it', () => {
    const T = 20e-6;
    // VIN+ = 1.2 V, VREF/2 = 2.56 V -> code = round(256 · 1.2 / 5.12) = 60
    const pins: Record<string, string> = { VINP: 'vin', VINN: '0', VREF2: 'vr', CS: '0', RD: 'rd', WR: 'wr', INTR: 'intr' };
    for (let k = 0; k < 8; k++) pins[`DB${k}`] = `db${k}`;
    const r = sim([inst('mixed/adc0804', 'U1', pins, { tconv: '50u' })], [vdc('VIN', 'vin', 1.2), vdc('VR', 'vr', 2.56), src('VWR', 'wr', steps([1, 0, 1, 1, 1, 1, 1, 1], T)), src('VRD', 'rd', steps([1, 1, 1, 1, 1, 0, 0, 1], T)), ...Array.from({ length: 8 }, (_, k) => res(`R${k}`, `db${k}`, '0', 1e5))], { type: 'tran', tstep: 1e-6, tstop: 8 * T });
    expect(logic(at(r, 'V(intr)', 2.5 * T))).toBe(1); // converting
    expect(logic(at(r, 'V(intr)', 4.9 * T))).toBe(0); // done (start at 2 T + 50 µs)
    expect(bits(0, 8).reduce((a, _, k) => a + logic(at(r, `V(db${k})`, 6.9 * T), 2.5) * 2 ** k, 0)).toBe(60);
    expect(logic(at(r, 'V(intr)', 6.9 * T))).toBe(1); // reading reset ~INTR
    expect(at(r, 'V(db2)', 7.9 * T)).toBeLessThan(0.1); // released, pulled down
  });

  it('ADC0809 converts the channel selected by the latched address', () => {
    const T = 20e-6;
    const pins: Record<string, string> = { REFP: 'ref', REFN: '0', ADDA: 'hi', ADDB: '0', ADDC: 'hi', ALE: 'ale', START: 'st', OE: 'hi', EOC: 'eoc', IN5: 'in5', IN0: 'in0' };
    for (let k = 0; k < 8; k++) pins[`D${k}`] = `d${k}`;
    const r = sim([inst('mixed/adc0809', 'U1', pins)], [vdc('VREF', 'ref', 5), vdc('VH', 'hi', 5), vdc('V5', 'in5', 3), vdc('V0', 'in0', 1), src('VALE', 'ale', steps([0, 1, 0, 0, 0, 0, 0, 0, 0], T)), src('VST', 'st', steps([0, 1, 0, 0, 0, 0, 0, 0, 0], T))], { type: 'tran', tstep: 1e-6, tstop: 9 * T });
    expect(bits(0, 8).reduce((a, _, k) => a + logic(at(r, `V(d${k})`, 8.9 * T), 2.5) * 2 ** k, 0)).toBe(Math.round((256 * 3) / 5));
    expect(logic(at(r, 'V(eoc)', 3 * T), 2.5)).toBe(0);
    expect(logic(at(r, 'V(eoc)', 8 * T), 2.5)).toBe(1);
  });

  it('DAC0808 sinks I_ref · code / 256 at IO', () => {
    // VREF = 10 V through R14 = 5 kΩ: I_ref = 2 mA; code 0x80 (A1 = MSB high) -> 1 mA
    const s = sim([inst('mixed/dac0808', 'U1', { A1: 'hi', VREFP: 'p14', VREFN: '0', IO: 'io' })], [vdc('VH', 'hi', 5), vdc('VREF', 'vref', 10), res('R14', 'vref', 'p14', 5e3), vdc('VIO', 'io', 0)], { type: 'op' }).scalars!;
    expect(s['I(VIO)']).toBeCloseTo(-1e-3, 7);
  });

  it('analog switches follow their logic control; the VCO frequency follows its input', () => {
    const on = sim([inst('mixed/analog-switch', 'U1', { CTRL: 'hi', A: 'v', B: 'o' })], [vdc('VH', 'hi', 5), vdc('VV', 'v', 1), res('RL', 'o', '0', 950)], { type: 'op' }).scalars!;
    expect(on['V(o)']).toBeCloseTo(0.95, 6);
    const spdt = sim([inst('mixed/analog-switch-spdt', 'U2', { CTRL: '0', COM: 'v', NO: 'no', NC: 'nc' })], [vdc('VV', 'v', 1), res('R1', 'no', '0', 1e3), res('R2', 'nc', '0', 1e3)], { type: 'op' }).scalars!;
    expect(spdt['V(nc)']).toBeCloseTo(1e3 / 1050, 4);
    expect(spdt['V(no)']).toBeLessThan(1e-3);
    const r = sim([inst('mixed/vco-logic', 'U3', { VIN: 'vin', OUT: 'out' }, { f0: '1k', kv: '2k' })], [vdc('VIN', 'vin', 1.5)], { type: 'tran', tstep: 5e-6, tstop: 5e-3 });
    const t = r.scale!.re;
    const v = vec(r, 'V(out)');
    const ups: number[] = [];
    for (let i = 1; i < t.length; i++) if (v[i - 1] < 2.5 && v[i] >= 2.5) ups.push(t[i]);
    expect((ups.length - 2) / (ups[ups.length - 1] - ups[1]) / 4e3).toBeCloseTo(1, 3);
  });
});

describe('displays', () => {
  it('LCD 16x2 shows text written through its bus (4-bit mode, as in most learner circuits)', () => {
    const T = 2e-6;
    const text = 'Xin chao';
    const nib = (rs: number, b: number): [number, number][] => [[rs, b >> 4], [rs, b & 15]];
    // 8-bit "function set 4-bit" first, then 2 lines / display on / clear / entry mode, then the text
    const transfers: [number, number][] = [[0, 0x2], ...nib(0, 0x28), ...nib(0, 0x0c), ...nib(0, 0x01), ...nib(0, 0x06), ...[...text].flatMap((c) => nib(1, c.charCodeAt(0))), ...nib(0, 0xc5), ...nib(1, 0x31)];
    const rsW: number[] = [];
    const eW: number[] = [];
    const dW: number[][] = [[], [], [], []];
    for (const [rs, n] of transfers) {
      for (let ph = 0; ph < 4; ph++) {
        rsW.push(rs);
        eW.push(ph === 1 ? 1 : 0);
        for (let k = 0; k < 4; k++) dW[k].push((n >> k) & 1);
      }
    }
    const stop = rsW.length * T + T;
    const els = [src('VRS', 'rs', steps(rsW, T)), src('VE', 'e', steps(eW, T)), ...dW.map((w, k) => src(`VD${k + 4}`, `d${k + 4}`, steps(w, T)))];
    const f = inst('indicators/lcd-16x2', 'LCD1', { RS: 'rs', RW: '0', E: 'e', D4: 'd4', D5: 'd5', D6: 'd6', D7: 'd7' }, { texec: '1u' });
    const r = sim([f], els, { type: 'tran', tstep: T / 4, tstop: stop });
    const cell = (k: number) => String.fromCharCode(Math.round(at(r, `V(LCD1.c${k})`, stop)));
    expect(Array.from({ length: text.length }, (_, k) => cell(k)).join('')).toBe(text);
    expect(cell(16 + 5)).toBe('1');
    expect(Math.round(at(r, 'V(LCD1.st)', stop)) & 1).toBe(1); // display on
    const lcd = getPart('indicators/lcd-16x2') as LibraryPartDef;
    const b = lcd.bindIndicator!({ refdes: 'LCD1', params: {}, net: () => null, name: (t) => t, elements: [] });
    expect(b!.signals!.length).toBe(32 + 1 + 64);
    expect(lcd.indicator).toMatchObject({ kind: 'lcd', cols: 16, rows: 2 });
  });

  it('dot matrix: a driven row / column lights its dot; alphanumeric and bar-graph masks', () => {
    const m = inst('indicators/matrix-5x7', 'M1', { R1: 'ra', C2: 'ck', ...Object.fromEntries([1, 3, 4, 5].map((c) => [`C${c}`, 'hi'])), ...Object.fromEntries([2, 3, 4, 5, 6, 7].map((r) => [`R${r}`, '0'])) });
    const s = sim([m], [vdc('VH', 'hi', 5), vdc('VA', 'va', 5), res('RA', 'va', 'ra', 150), res('RK', 'ck', '0', 1)], { type: 'op' }).scalars!;
    expect(Math.round(s['V(M1.row1)'])).toBe(2); // column 2 of row 1
    expect(Math.round(s['V(M1.row2)'])).toBe(0);
    const segs = ['a', 'b', 'g1'];
    const a = inst('indicators/alnum14-cc', 'A1', { CC: '0', ...Object.fromEntries(segs.map((g) => [`SEG${g.toUpperCase()}`, `s_${g}`])) });
    const t = sim([a], [vdc('VS', 'vs', 5), ...segs.map((g) => res(`R${g}`, 'vs', `s_${g}`, 220))], { type: 'op' }).scalars!;
    expect(Math.round(t['V(A1.code)'])).toBe(1 + 2 + 64); // a = bit 0, b = bit 1, g1 = bit 6
    const bg = inst('indicators/bargraph-10-rgy', 'B1', Object.fromEntries([...Array.from({ length: 10 }, (_, k) => [`A${k + 1}`, k < 7 ? 'hi' : '0']), ...Array.from({ length: 10 }, (_, k) => [`K${k + 1}`, `k${k}`])]));
    const u = sim([bg], [vdc('VH', 'hi', 5), ...Array.from({ length: 10 }, (_, k) => res(`RK${k}`, `k${k}`, '0', 220))], { type: 'op' }).scalars!;
    expect(Math.round(u['V(B1.code)'])).toBe(2 ** 7 - 1);
  });

  it('hex display with decimal point adds bit 7 for DP', () => {
    for (const [code, dp] of [[0xb, 0], [0x7, 1]] as const) {
      const f = inst('indicators/hex-display-dp', 'H1', { D0: code & 1 ? 'hi' : '0', D1: code & 2 ? 'hi' : '0', D2: code & 4 ? 'hi' : '0', D3: code & 8 ? 'hi' : '0', DP: dp ? 'hi' : '0' });
      const s = sim([f], [vdc('VH', 'hi', 5)], { type: 'op' }).scalars!;
      expect(Math.round(s['V(H1.code)'])).toBe(SEGMENT_FONTS.hex[code] + 128 * dp);
    }
    expect(getPart('indicators/logic-probe-green')!.indicator).toMatchObject({ kind: 'probe', color: '#34c759' });
  });
});
