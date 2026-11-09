/**
 * Code models added for the large digital catalogue, through the real engine: memory images
 * and RAM / ROM read-write, PLD equations and truth tables, the 74181 function table, the
 * character LCD, serial converters, the VCO and a phase-locked loop that locks.
 */
import { describe, expect, it } from 'vitest';
import { findVector, runAnalyses, type AnalysisResult } from '../../index';
import { cap, interpolate, netlist, res, vdc, vsrc } from '../../engine/testing';
import type { AnalysisSpec, ElementIR, ModelCard, Waveform } from '../../netlist';
import { alu181, compileLogicProgram, digitalModelTypes, formatMemoryImage, lcdCellAddress, parseMemoryImage, programText, truthTableToEquations } from './index';

const A = (name: string, nodes: string[], m: string, params: Record<string, number> = {}): ElementIR => ({ type: 'A', name, nodes, model: m, params });
const IDEAL = { vol: 0, voh: 5, rout: 10, rise_delay: 1e-9, fall_delay: 1e-9, rise_time: 1e-9, fall_time: 1e-9 };
const card = (name: string, type: string, params: Record<string, number> = {}, stringParams?: Record<string, string>): ModelCard => ({ name, type, params: { ...IDEAL, ...params }, ...(stringParams ? { stringParams } : {}) });
const logic = (v: number) => (v > 2.5 ? 1 : 0);

function run(elements: ElementIR[], models: ModelCard[], spec: AnalysisSpec): AnalysisResult {
  const r = runAnalyses(netlist(elements, [spec], { models }))[0];
  expect(r.error, r.error).toBeUndefined();
  return r;
}
const vec = (r: AnalysisResult, name: string) => {
  const v = findVector(r, name);
  if (!v) throw new Error(`no vector ${name}`);
  return v.re;
};
const at = (r: AnalysisResult, name: string, t: number) => interpolate(r.scale!.re, vec(r, name), t);
function crossings(r: AnalysisResult, name: string, level: number): number[] {
  const t = r.scale!.re;
  const v = vec(r, name);
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) if (v[i - 1] < level && v[i] >= level) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  return out;
}

/** PWL logic waveform: level values[k] during [k·T, (k+1)·T), 1 ns transitions. */
function steps(values: number[], T: number, high = 5): Waveform {
  const args: number[] = [0, values[0] * high];
  for (let k = 1; k < values.length; k++) {
    if (values[k] === values[k - 1]) continue;
    args.push(k * T, values[k - 1] * high, k * T + 1e-9, values[k] * high);
  }
  return { type: 'PWL', args };
}
const src = (name: string, node: string, w: Waveform): ElementIR => vsrc(name, node, '0', { dc: w.args[1], tran: w });

describe('registry', () => {
  it('registers the new code-model types', () => {
    const types = digitalModelTypes();
    for (const t of ['D_RAM', 'D_ROM', 'D_REGFILE', 'D_PLD', 'D_LCD', 'D_VCO', 'D_PHASE_DET', 'D_ADC_SPI', 'D_DAC_SPI', 'D_ADC0804', 'D_ADC0809', 'D_ALU181', 'D_CLA182', 'D_REG', 'D_SHIFT_STORE', 'D_SHIFT_UNIV', 'D_PRIENC', 'D_PARITY', 'D_AOI', 'D_CNT_UD1', 'D_CNT_UD2', 'D_CNT_UD3', 'D_CNT_EN', 'D_CNT_7SEG', 'D_CNT_DIV2_DIV6', 'D_ADDR_LATCH', 'D_EQCOMP', 'D_SRLATCH_N', 'D_SHIFT_JK', 'D_SHIFT_PISO2']) {
      expect(types, t).toContain(t);
    }
  });
});

describe('operating point of sequential parts', () => {
  it('an inactive active-low preset does not latch during the first Newton iterations', () => {
    // the iterate starts at 0 V, where ~PRE looks active; the solve must still give Q = 0
    for (const nodes of [['j', '0', 'clk', 'hi', 'null', 'q', 'qn'], ['d', 'clk', 'hi', 'null', 'q', 'qn']]) {
      const type = nodes.length === 7 ? 'D_JKFF' : 'D_DFF';
      const r = run([A('A1', nodes, 'ff'), vdc('VJ', 'j', '0', 5), vdc('VD', 'd', '0', 5), vdc('VC', 'clk', '0', 5), vdc('VH', 'hi', '0', 5)], [card('ff', type, { set_low: 1, reset_low: 1 })], { type: 'op' });
      expect(r.scalars!['V(q)'], type).toBeCloseTo(0, 6);
      expect(r.scalars!['V(qn)'], type).toBeCloseTo(5, 6);
    }
  });

  it('a DC sweep keeps the latched state from point to point (hysteresis of an SR latch)', () => {
    // S follows the swept source (5 V down to 0 V), R is tied low: Q is set at the first point
    // and stays set after S returns low
    const r = run([A('A1', ['s', '0', 'null', 'null', 'null', 'q', 'qn'], 'sr'), vdc('VS', 's', '0', 0)], [card('sr', 'D_SRLATCH')], { type: 'dc', src: 'VS', start: 5, stop: 0, step: -0.5 });
    const q = vec(r, 'V(q)');
    expect(r.scale!.re[r.scale!.re.length - 1]).toBeCloseTo(0, 9);
    expect(q[0]).toBeCloseTo(5, 6);
    expect(q[q.length - 1]).toBeCloseTo(5, 6);
  });
});

describe('memory images', () => {
  it('reads plain words, address markers and hex-dump lines', () => {
    const r = parseMemoryImage('3E 01 0xD3 // comment\n@0010 AA,55\n0020: 12 34 # more', 64, 8);
    expect(r.errors).toEqual([]);
    expect([...r.data.slice(0, 4)]).toEqual([0x3e, 0x01, 0xd3, 0]);
    expect([r.data[0x10], r.data[0x11], r.data[0x20], r.data[0x21]]).toEqual([0xaa, 0x55, 0x12, 0x34]);
  });

  it('reads Intel HEX with checksums and extended addresses', () => {
    const r = parseMemoryImage(':0300100001020300\n:02000004000\n'.replace(':02000004000\n', ':00000001FF\n'), 256, 8);
    // checksum of the data record: 03+00+10+00+01+02+03 = 0x19 -> 0xE7
    expect(r.errors.length).toBe(1);
    const ok = parseMemoryImage(':03001000010203E7\n:00000001FF', 256, 8);
    expect(ok.errors).toEqual([]);
    expect([ok.data[0x10], ok.data[0x11], ok.data[0x12]]).toEqual([1, 2, 3]);
  });

  it('reports words that do not fit and addresses outside the memory', () => {
    expect(parseMemoryImage('1FF', 16, 8).errors[0]).toMatch(/does not fit/);
    expect(parseMemoryImage('@20 01', 16, 8).errors[0]).toMatch(/outside/);
    expect(parseMemoryImage('zz', 16, 8).errors[0]).toMatch(/not a hexadecimal/);
  });

  it('formats a compact canonical image that parses back to the same data', () => {
    const data = new Uint32Array(64);
    data[0] = 0x12;
    data[1] = 0xff;
    data[40] = 7;
    const text = formatMemoryImage(data, 8);
    expect(text).toBe('@0000 12 FF 00 00 00 00 00 00 00 00 00 00 00 00 00 00\n@0020 00 00 00 00 00 00 00 00 07 00 00 00 00 00 00 00');
    expect([...parseMemoryImage(text, 64, 8).data]).toEqual([...data]);
    expect(formatMemoryImage(new Uint32Array(8), 4)).toBe('');
  });
});

describe('logic programs', () => {
  it('compiles equations with NOT > AND > XOR > OR priority', () => {
    const p = compileLogicProgram('O0 = I0 & I1 | !I2\nO1 = I0 ^ I1 & I2 ; O2 = (I0 | I1)\'', 3, 3);
    expect(p.errors).toEqual([]);
    for (let w = 0; w < 8; w++) {
      const i = [w & 1, (w >> 1) & 1, (w >> 2) & 1];
      const o = [0, 0, 0];
      expect(p.outputs[0].fn(i, o)).toBe((i[0] & i[1]) | (1 - i[2]));
      expect(p.outputs[1].fn(i, o)).toBe(i[0] ^ (i[1] & i[2]));
      expect(p.outputs[2].fn(i, o)).toBe(1 - (i[0] | i[1]));
    }
    expect(programText(p)).toBe('O0 = I0 & I1 | !I2\nO1 = I0 ^ I1 & I2\nO2 = !(I0 | I1)');
  });

  it('turns a truth table into a sum of products', () => {
    const r = truthTableToEquations('I1 I0 | O0 O1\n0 0 | 0 1\n1 - | 1 0', 2, 2);
    expect(r.errors).toEqual([]);
    expect(r.equations).toBe('O0 = I1\nO1 = (!I1 & !I0)');
    const p = compileLogicProgram('I1 I0 | O0\n0 1 | 1\n1 0 | 1', 2, 1);
    expect(p.kind).toBe('table');
    expect([0, 1, 2, 3].map((w) => p.outputs[0].fn([w & 1, w >> 1], [0]))).toEqual([0, 1, 1, 0]);
  });

  it('explains mistakes with the line number', () => {
    expect(compileLogicProgram('O0 = I9', 4, 2).errors[0]).toMatch(/line 1: input I9 does not exist/);
    expect(compileLogicProgram('O0 = I0 &', 4, 2).errors[0]).toMatch(/line 1/);
    expect(compileLogicProgram('O0 = I0\nO0 = I1', 4, 2).errors[0]).toMatch(/line 2: O0 is defined twice/);
    expect(compileLogicProgram('X = I1', 4, 2).errors[0]).toMatch(/expected/);
  });

  it('PLD: registered outputs form a 2-bit counter, an enable releases an output', () => {
    const prog = 'O0 := !O0\nO1 := O1 ^ O0\nO2 = I0 & O1\nO3 = I1; O3.oe = I0';
    const m = card('pld', 'D_PLD', { n_in: 2, n_out: 4 }, { program: prog });
    const T = 100e-9;
    const clk = steps([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], T);
    const r = run(
      [A('A1', ['i0', 'i1', 'clk', 'null', 'o0', 'o1', 'o2', 'o3'], 'pld'), src('VC', 'clk', clk), vdc('VI0', 'i0', '0', 5), vdc('VI1', 'i1', '0', 5), res('RL', 'o3', '0', 1e4)],
      [m],
      { type: 'tran', tstep: 5e-9, tstop: 11 * T },
    );
    const count = (t: number) => logic(at(r, 'V(o0)', t)) + 2 * logic(at(r, 'V(o1)', t));
    expect([1.9, 3.9, 5.9, 7.9, 9.9].map((k) => count(k * T))).toEqual([1, 2, 3, 0, 1]);
    expect(logic(at(r, 'V(o2)', 4.9 * T))).toBe(1); // O1 high and I0 high
    expect(at(r, 'V(o3)', 4.9 * T)).toBeCloseTo(5, 1);
  });
});

describe('74181 function table (active-high data)', () => {
  const minus = (x: number) => (x + 16) % 16;
  it('arithmetic functions (M = 0) without and with carry', () => {
    const table: Record<number, (a: number, b: number) => number> = {
      0b0000: (a) => a,
      0b0001: (a, b) => a | b,
      0b0010: (a, b) => a | (~b & 15),
      0b0011: () => minus(-1),
      0b0100: (a, b) => a + (a & ~b & 15),
      0b0110: (a, b) => minus(a - b - 1),
      0b1001: (a, b) => a + b,
      0b1011: (a, b) => minus((a & b) - 1),
      0b1100: (a) => a + a,
      0b1111: (a) => minus(a - 1),
    };
    for (const [s, f] of Object.entries(table)) {
      for (let a = 0; a < 16; a++) {
        for (let b = 0; b < 16; b++) {
          const want = f(a, b);
          const r = alu181(a, b, Number(s), 0, 1);
          expect(r.f, `S=${s} A=${a} B=${b}`).toBe(want & 15);
          expect(alu181(a, b, Number(s), 0, 0).f).toBe((want + 1) & 15);
        }
      }
    }
    // carry out and A=B in the subtract mode
    expect(alu181(9, 9, 0b0110, 0, 1).aeqb).toBe(1);
    expect(alu181(9, 3, 0b1001, 0, 1).cn4).toBe(1); // 12, no carry
    expect(alu181(9, 9, 0b1001, 0, 1).cn4).toBe(0); // 18, carry
  });

  it('logic functions (M = 1)', () => {
    const fns = [
      (a: number) => ~a, (a: number, b: number) => ~(a | b), (a: number, b: number) => ~a & b, () => 0,
      (a: number, b: number) => ~(a & b), (_a: number, b: number) => ~b, (a: number, b: number) => a ^ b, (a: number, b: number) => a & ~b,
      (a: number, b: number) => ~a | b, (a: number, b: number) => ~(a ^ b), (_a: number, b: number) => b, (a: number, b: number) => a & b,
      () => 15, (a: number, b: number) => a | ~b, (a: number, b: number) => a | b, (a: number) => a,
    ];
    fns.forEach((f, s) => {
      for (let a = 0; a < 16; a++) for (let b = 0; b < 16; b++) expect(alu181(a, b, s, 1, 1).f, `S=${s}`).toBe(f(a, b) & 15);
    });
  });
});

describe('RAM and ROM', () => {
  it('a 16 x 4 RAM stores words written in a transient and reads them back; ROM reads its image', () => {
    const T = 200e-9;
    // write 4 words (addr k <- 15 - k), then read them back
    const addrs = [0, 0, 1, 1, 2, 2, 3, 3, 0, 1, 2, 3];
    const datas = [15, 15, 14, 14, 13, 13, 12, 12, 0, 0, 0, 0];
    const we = [1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1];
    const drive = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0];
    const els: ElementIR[] = [vdc('VCS', 'cs', '0', 0), vdc('VOE', 'oe', '0', 0)];
    for (let k = 0; k < 4; k++) els.push(src(`VA${k}`, `a${k}`, steps(addrs.map((a) => (a >> k) & 1), T)));
    els.push(src('VWE', 'we', steps(we, T)));
    // data pins are driven through 1 kΩ while writing (the bus driver), floating while reading
    for (let k = 0; k < 4; k++) {
      els.push(src(`VD${k}`, `w${k}`, steps(datas.map((d) => (d >> k) & 1), T)));
      els.push(A(`AD${k}`, [`w${k}`, 'drv', `d${k}`], 'tri'));
    }
    els.push(src('VDRV', 'drv', steps(drive, T)));
    els.push(A('AR', ['a0', 'a1', 'a2', 'a3', 'd0', 'd1', 'd2', 'd3', 'cs', 'oe', 'we'], 'ram'));
    els.push(A('AROM', ['a0', 'a1', 'a2', 'a3', 'q0', 'q1', 'q2', 'q3', 'cs', 'oe'], 'rom'));
    const r = run(els, [card('ram', 'D_RAM', { abits: 4, dbits: 4 }), card('rom', 'D_ROM', { abits: 4, dbits: 4 }, { data: '5 A 3 C' }), card('tri', 'D_TRISTATE')], { type: 'tran', tstep: 10e-9, tstop: 12 * T });
    const word = (pre: string, t: number) => [0, 1, 2, 3].reduce((a, k) => a + logic(at(r, `V(${pre}${k})`, t)) * 2 ** k, 0);
    expect([8, 9, 10, 11].map((k) => word('d', (k + 0.9) * T))).toEqual([15, 14, 13, 12]);
    expect([8, 9, 10, 11].map((k) => word('q', (k + 0.9) * T))).toEqual([5, 10, 3, 12]);
  });
});

describe('character LCD', () => {
  /** Bus waveforms: one E pulse per (rs, bus byte) transfer, transfer period 4 T. */
  function lcdBus(transfers: [number, number][], T: number): ElementIR[] {
    const rsW: number[] = [];
    const eW: number[] = [];
    const dW: number[][] = Array.from({ length: 8 }, () => []);
    for (const [rs, b] of transfers) {
      // phase 0: set up, 1: E high, 2: E low (the falling edge latches), 3: hold
      for (let ph = 0; ph < 4; ph++) {
        rsW.push(rs);
        eW.push(ph === 1 ? 1 : 0);
        for (let k = 0; k < 8; k++) dW[k].push((b >> k) & 1);
      }
    }
    rsW.push(0);
    eW.push(0);
    for (let k = 0; k < 8; k++) dW[k].push(0);
    return [src('VRS', 'rs', steps(rsW, T)), src('VE', 'e', steps(eW, T)), vdc('VRW', 'rw', '0', 0), ...dW.map((w, k) => src(`VD${k}`, `d${k}`, steps(w, T)))];
  }
  /** 4-bit transfers of bytes: high nibble then low nibble on d7..d4. */
  const nibbles = (writes: [number, number][]): [number, number][] => writes.flatMap(([rs, b]) => [[rs, b & 0xf0], [rs, (b << 4) & 0xf0]] as [number, number][]);
  const cells = Array.from({ length: 32 }, (_, k) => `c${k}`);
  const cg = Array.from({ length: 64 }, (_, k) => `g${k}`);
  const lcdEl = A('ALCD', ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', ...cells, 'st', ...cg], 'lcd');
  const lcdModel = card('lcd', 'D_LCD', { cols: 16, rows: 2, texec: 1e-6, tclear: 2e-6 });
  const text = (r: AnalysisResult, t: number, from: number, len: number) => String.fromCharCode(...Array.from({ length: len }, (_, k) => Math.round(at(r, `V(c${from + k})`, t))));

  it('shows text written in 8-bit mode on both lines, with cursor state', () => {
    const T = 1e-6;
    const writes: [number, number][] = [[0, 0x38], [0, 0x0e], [0, 0x01], [0, 0x06], ...[...'XIN CHAO'].map((c) => [1, c.charCodeAt(0)] as [number, number]), [0, 0xc0], ...[...'MachSim'].map((c) => [1, c.charCodeAt(0)] as [number, number])];
    const stop = (writes.length * 4 + 2) * T;
    const r = run([lcdEl, ...lcdBus(writes, T)], [lcdModel], { type: 'tran', tstep: T / 4, tstop: stop });
    expect(text(r, stop, 0, 8)).toBe('XIN CHAO');
    expect(text(r, stop, 16, 7)).toBe('MachSim');
    expect(text(r, stop, 8, 8)).toBe('        ');
    const st = Math.round(at(r, 'V(st)', stop));
    expect(st & 7).toBe(3); // display on, cursor on, no blink
    expect(st >> 3).toBe(16 + 7 + 1); // cursor after "MachSim" on line 2
  });

  it('works in 4-bit mode after the standard initialisation, and stores custom characters', () => {
    const T = 1e-6;
    // one 8-bit transfer "function set, DL = 0" switches to 4-bit, then everything as nibble pairs
    const init: [number, number][] = [[0, 0x28], [0, 0x0c], [0, 0x40], [1, 0x0e], [1, 0x11], [0, 0x80], [1, 0x00], [1, 0x41]];
    const transfers: [number, number][] = [[0, 0x20], ...nibbles(init)];
    const stop = (transfers.length * 4 + 2) * T;
    const r = run([lcdEl, ...lcdBus(transfers, T)], [lcdModel], { type: 'tran', tstep: T / 4, tstop: stop });
    expect(text(r, stop, 0, 2)).toBe('\u0000A');
    expect(Math.round(at(r, 'V(st)', stop)) & 7).toBe(1); // display on, no cursor
    expect([0, 1].map((k) => Math.round(at(r, `V(g${k})`, stop)))).toEqual([0x0e, 0x11]);
  });

  it('maps visible cells of 20 x 4 modules to DDRAM addresses', () => {
    const s = { twoLine: true, shift: 0 };
    expect([lcdCellAddress(s, 0, 0, 20, 4), lcdCellAddress(s, 1, 0, 20, 4), lcdCellAddress(s, 2, 0, 20, 4), lcdCellAddress(s, 3, 19, 20, 4)]).toEqual([0x00, 0x40, 0x14, 0x67]);
    expect(lcdCellAddress({ twoLine: true, shift: 1 }, 0, 0, 16, 2)).toBe(1);
  });
});

describe('serial converters', () => {
  it('SPI ADC -> SPI DAC: 12-bit word clocked MSB first reproduces the input', () => {
    const T = 100e-9;
    const vin = 1.2345;
    // ~CS low for 12 clocks; ADC shifts on falling SCLK, DAC samples on rising SCLK
    const cs = [1, ...Array(26).fill(0), 1, 1];
    const sclk = [0, 0, ...Array.from({ length: 24 }, (_, k) => (k % 2 === 0 ? 1 : 0)), 0, 0, 0];
    const r = run(
      [
        vdc('VIN', 'vin', '0', vin),
        vdc('VREF', 'ref', '0', 4.096),
        src('VCS', 'cs', steps(cs, T)),
        src('VSCK', 'sck', steps(sclk, T)),
        A('AADC', ['vin', 'ref', '0', 'cs', 'sck', 'sdo'], 'adc'),
        res('RPD', 'sdo', '0', 1e6),
        A('ADAC', ['cs', 'sck', 'sdo', 'null', 'ref', '0', 'out'], 'dac'),
      ],
      [card('adc', 'D_ADC_SPI', { n: 12 }), card('dac', 'D_DAC_SPI', { n: 12, tsettle: 10e-9 })],
      { type: 'tran', tstep: 10e-9, tstop: cs.length * T },
    );
    const code = Math.floor((4096 * vin) / 4.096);
    expect(at(r, 'V(out)', cs.length * T)).toBeCloseTo((code / 4096) * 4.096, 9);
  });
});

describe('VCO and phase-locked loop', () => {
  const vcoModel = card('vco', 'D_VCO', { fmin: 5e3, fmax: 25e3, va: 0, vb: 5, fa: 5e3, fb: 25e3 });

  it('VCO frequency follows the control voltage', () => {
    for (const v of [1, 2.5, 4]) {
      const r = run([vdc('VC', 'vc', '0', v), A('AV', ['vc', 'out'], 'vco')], [vcoModel], { type: 'tran', tstep: 1e-6, tstop: 2e-3 });
      const up = crossings(r, 'V(out)', 2.5);
      const f = (up.length - 2) / (up[up.length - 1] - up[1]);
      expect(f / (5e3 + (v / 5) * 20e3)).toBeCloseTo(1, 4);
    }
  });

  it('locks a 12 kHz reference with the edge-sensitive phase comparator and a lag-lead filter', () => {
    const ref = 12e3;
    const r = run(
      [
        vsrc('VREF', 'sig', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 10e-6, 10e-9, 10e-9, 0.5 / ref - 10e-9, 1 / ref] } }),
        A('APD', ['sig', 'vout', 'pc1', 'pc2', 'pcp'], 'pd'),
        res('R3', 'pc2', 'f', 10e3),
        res('R4', 'f', 'fc', 2.2e3),
        cap('C2', 'fc', '0', 100e-9),
        A('AV', ['f', 'vout'], 'vco'),
      ],
      [card('pd', 'D_PHASE_DET', { rout: 200 }), vcoModel],
      { type: 'tran', tstep: 2e-6, tstop: 40e-3 },
    );
    const up = crossings(r, 'V(vout)', 2.5).filter((t) => t > 30e-3);
    const f = (up.length - 1) / (up[up.length - 1] - up[0]);
    expect(f / ref).toBeCloseTo(1, 3);
    // locked: the control voltage settles where the VCO runs at 12 kHz
    expect(at(r, 'V(fc)', 40e-3)).toBeCloseTo(((ref - 5e3) / 20e3) * 5, 1);
    // phase pulses are short: the comparator output is released most of the time
    const t = r.scale!.re;
    const pcp = vec(r, 'V(pcp)');
    let high = 0;
    let total = 0;
    for (let i = 1; i < t.length; i++) {
      if (t[i] < 35e-3) continue;
      const dt = t[i] - t[i - 1];
      total += dt;
      if (pcp[i] > 2.5) high += dt;
    }
    expect(high / total).toBeGreaterThan(0.95);
  });
});
