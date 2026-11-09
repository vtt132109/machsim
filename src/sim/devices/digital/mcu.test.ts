/**
 * Microcontroller co-simulation (D_MCU8051) through the real engine: an LED blinked by a delay
 * loop whose frequency is the hand-counted machine-cycle total, a square wave produced by the
 * timer 0 interrupt, a pin read back from the circuit, the quasi-bidirectional port structure and
 * the register read-outs published as derived device outputs.
 */
import { describe, expect, it } from 'vitest';
import { findVector, runAnalyses, type AnalysisResult } from '../../index';
import { netlist, res, vdc, vsrc } from '../../engine/testing';
import type { AnalysisSpec, ElementIR, ModelCard } from '../../netlist';
import { buildProgram, encodeImage } from '../../../mcu/program';
import { digitalModelTypes } from './index';
import { MCU_PROBE_KEYS } from '../../../mcu/probes';

/** Node list of an MCU element: "null" everywhere except the named pins. */
function pins(map: Record<string, string>): string[] {
  const out: string[] = [];
  for (let port = 0; port < 4; port++) for (let bit = 0; bit < 8; bit++) out.push(map[`P${port}.${bit}`] ?? 'null');
  out.push(map.RST ?? 'null', map.EA ?? 'null');
  return out;
}

const CARD = 'MCU';

function mcu(nodes: string[], params: Record<string, number> = {}): ElementIR {
  return { type: 'A', name: 'A1', nodes: [...nodes, '0'], model: CARD, params: { pwr: 1, ...params } };
}

function card(source: string, params: Record<string, number> = {}): ModelCard {
  const b = buildProgram(source);
  expect(b.asmErrors, JSON.stringify(b.asmErrors)).toEqual([]);
  return { name: CARD, type: 'D_MCU8051', params: { vol: 0, voh: 5, vnom: 5, rlow: 100, rhigh: 100, vth: 2.5, ...params }, stringParams: { code: encodeImage(b) } };
}

function run(elements: ElementIR[], models: ModelCard[], spec: AnalysisSpec, saves?: string[]): AnalysisResult {
  const r = runAnalyses(netlist(elements, [spec], { models, ...(saves ? { saves } : {}) }))[0];
  expect(r.error, r.error).toBeUndefined();
  return r;
}

const vec = (r: AnalysisResult, name: string): Float64Array => {
  const v = findVector(r, name);
  if (!v) throw new Error(`no vector ${name}`);
  return v.re;
};

/** Times at which a vector crosses a level in one direction. */
function crossings(r: AnalysisResult, name: string, level: number, dir: 'rise' | 'fall'): number[] {
  const t = r.scale!.re;
  const v = vec(r, name);
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) {
    const up = v[i - 1] < level && v[i] >= level;
    const dn = v[i - 1] > level && v[i] <= level;
    if ((dir === 'rise' && up) || (dir === 'fall' && dn)) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  }
  return out;
}

describe('MCU co-simulation', () => {
  it('registers the code-model type', () => {
    expect(digitalModelTypes()).toContain('D_MCU8051');
  });

  it('blinks an LED on P1.0 with the period the machine cycles predict', () => {
    // CPL P1.0 (1) + MOV R7,#1 (1) + [MOV R6,#10 (1) + 10 x DJNZ R6 (2) = 21 ; DJNZ R7 (2)] + SJMP (2)
    // = 1 + 1 + 23 + 2 = 27 machine cycles per half period, 1 µs per cycle at 12 MHz
    const src = ['ORG 0', 'LOOP: CPL P1.0', 'MOV R7,#1', 'D1: MOV R6,#10', 'D2: DJNZ R6,D2', 'DJNZ R7,D1', 'SJMP LOOP'].join('\n');
    const els = [mcu(pins({ 'P1.0': 'led' }), { fosc: 12e6, pdrive: 1 }), res('RL', 'led', '0', 10e3)];
    const r = run(els, [card(src)], { type: 'tran', tstep: 2e-7, tstop: 6e-4 });
    const rise = crossings(r, 'V(led)', 2.5, 'rise');
    expect(rise.length).toBeGreaterThan(5);
    for (let i = 2; i < rise.length; i++) expect(rise[i] - rise[i - 1]).toBeCloseTo(54e-6, 7);
    const fall = crossings(r, 'V(led)', 2.5, 'fall');
    // the two edges are half a period apart
    expect(Math.abs(fall[2] - rise[2])).toBeCloseTo(27e-6, 7);
  });

  it('the crystal frequency scales the blink period', () => {
    const src = ['ORG 0', 'LOOP: CPL P1.0', 'MOV R7,#1', 'D1: MOV R6,#10', 'D2: DJNZ R6,D2', 'DJNZ R7,D1', 'SJMP LOOP'].join('\n');
    const els = [mcu(pins({ 'P1.0': 'led' }), { fosc: 24e6, pdrive: 1 }), res('RL', 'led', '0', 10e3)];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-7, tstop: 3e-4 });
    const rise = crossings(r, 'V(led)', 2.5, 'rise');
    for (let i = 2; i < rise.length; i++) expect(rise[i] - rise[i - 1]).toBeCloseTo(27e-6, 7);
  });

  it('a timer 0 interrupt gives a square wave of the reload period', () => {
    // timer 0 in mode 2 with TH0 = 256 - 50 = 206 overflows every 50 machine cycles; the handler
    // toggles P1.1, so the output period is 100 µs at 12 MHz
    const src = [
      'ORG 0',
      'LJMP MAIN',
      'ORG 0Bh',
      'CPL P1.1',
      'RETI',
      'ORG 30h',
      'MAIN: MOV TMOD,#02h',
      'MOV TH0,#206',
      'MOV TL0,#206',
      'MOV IE,#82h',
      'SETB TR0',
      'HERE: SJMP HERE',
    ].join('\n');
    const els = [mcu(pins({ 'P1.1': 'sq' }), { fosc: 12e6, pdrive: 1 }), res('RL', 'sq', '0', 10e3)];
    const r = run(els, [card(src)], { type: 'tran', tstep: 5e-7, tstop: 1e-3 });
    const rise = crossings(r, 'V(sq)', 2.5, 'rise');
    expect(rise.length).toBeGreaterThan(5);
    for (let i = 2; i < rise.length; i++) expect(rise[i] - rise[i - 1]).toBeCloseTo(100e-6, 7);
  });

  it('reads a pin from the circuit and mirrors it to another port pin', () => {
    // the program copies P1.2 to P1.3; a pulse source drives P1.2
    const src = ['ORG 0', 'LOOP: MOV C,P1.2', 'MOV P1.3,C', 'SJMP LOOP'].join('\n');
    const els = [
      mcu(pins({ 'P1.2': 'btn', 'P1.3': 'out' }), { fosc: 12e6, pdrive: 1 }),
      vsrc('VB', 'btn', '0', { dc: 0, tran: { type: 'PULSE', args: [0, 5, 100e-6, 1e-7, 1e-7, 200e-6, 400e-6] } }),
      res('RL', 'out', '0', 10e3),
    ];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-6, tstop: 8e-4 });
    const t = r.scale!.re;
    const out = vec(r, 'V(out)');
    const at = (x: number) => out[t.findIndex((v) => v >= x)];
    expect(at(50e-6)).toBeLessThan(1); // button released -> output low
    expect(at(200e-6)).toBeGreaterThan(4); // button pressed -> output high
    expect(at(290e-6)).toBeGreaterThan(4);
    expect(at(380e-6)).toBeLessThan(1); // released again at 300 µs
    expect(at(550e-6)).toBeGreaterThan(4); // the next pulse of the 400 µs period
  });

  it('the quasi-bidirectional port sinks current but only pulls up weakly', () => {
    // CLR P1.0 then stop: the pin is driven low; P1.1 stays high through the 50 kΩ pull-up only
    const src = ['ORG 0', 'CLR P1.0', 'HERE: SJMP HERE'].join('\n');
    const els = [
      mcu(pins({ 'P1.0': 'a', 'P1.1': 'b' }), { fosc: 12e6 }),
      res('RA', 'a', 'vcc', 1e3),
      res('RB', 'b', '0', 1e3),
      vdc('VCC', 'vcc', '0', 5),
    ];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-6, tstop: 2e-5 });
    const t = r.scale!.re;
    const i = t.length - 1;
    expect(vec(r, 'V(a)')[i]).toBeLessThan(0.6); // sinking 4.5 mA through 1 kΩ
    // 5 V through 50 kΩ into 1 kΩ is about 0.1 V: a real 8051 cannot source much either
    expect(vec(r, 'V(b)')[i]).toBeLessThan(0.3);
    // push-pull mode drives it high instead
    const push = run(
      [mcu(pins({ 'P1.1': 'b' }), { fosc: 12e6, pdrive: 1 }), res('RB', 'b', '0', 1e3)],
      [card(src)],
      { type: 'tran', tstep: 1e-6, tstop: 2e-5 },
    );
    expect(vec(push, 'V(b)')[push.scale!.re.length - 1]).toBeGreaterThan(4);
  });

  it('the reset pin holds the program at address 0', () => {
    const src = ['ORG 0', 'CLR P1.0', 'HERE: SJMP HERE'].join('\n');
    const els = [
      mcu(pins({ 'P1.0': 'q', RST: 'rst' }), { fosc: 12e6, pdrive: 1 }),
      vsrc('VR', 'rst', '0', { dc: 5, tran: { type: 'PWL', args: [0, 5, 100e-6, 5, 101e-6, 0] } }),
      res('RL', 'q', '0', 10e3),
    ];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-6, tstop: 2e-4 });
    const t = r.scale!.re;
    const q = vec(r, 'V(q)');
    const at = (x: number) => q[t.findIndex((v) => v >= x)];
    expect(at(50e-6)).toBeGreaterThan(4); // held in reset: the latch is high
    expect(at(150e-6)).toBeLessThan(1); // released: CLR P1.0 runs
  });

  it('EA held low stops the core', () => {
    const src = ['ORG 0', 'CLR P1.0', 'HERE: SJMP HERE'].join('\n');
    const els = [mcu(pins({ 'P1.0': 'q', EA: '0' }), { fosc: 12e6, pdrive: 1 }), res('RL', 'q', '0', 10e3)];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-6, tstop: 5e-5 });
    expect(vec(r, 'V(q)')[r.scale!.re.length - 1]).toBeGreaterThan(4);
  });

  it('publishes the registers as derived device outputs', () => {
    const src = ['ORG 0', 'MOV A,#5Ah', 'MOV R3,#7', 'MOV 30h,#99h', 'HERE: SJMP HERE'].join('\n');
    const els = [mcu(pins({ 'P1.0': 'q' }), { fosc: 12e6, pdrive: 1 }), res('RL', 'q', '0', 10e3)];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-6, tstop: 2e-5 }, ['all']);
    const last = r.scale!.re.length - 1;
    expect(vec(r, 'Ma(A1)')[last]).toBe(0x5a);
    expect(vec(r, 'Mr3(A1)')[last]).toBe(7);
    expect(vec(r, 'Mm0(A1)')[last]).toBe(0x99); // the window starts at 30h
    expect(vec(r, 'Mbase(A1)')[last]).toBe(0x30);
    expect(vec(r, 'Mcyc(A1)')[last]).toBeGreaterThan(5);
    expect(vec(r, 'Mhalt(A1)')[last]).toBe(0);
    // every documented key is there
    for (const k of MCU_PROBE_KEYS) expect(findVector(r, `${k}(A1)`), k).toBeDefined();
  });

  it('debug = 0 publishes no read-out vectors', () => {
    const src = ['ORG 0', 'HERE: SJMP HERE'].join('\n');
    const els = [mcu(pins({ 'P1.0': 'q' }), { fosc: 12e6, pdrive: 1, debug: 0 }), res('RL', 'q', '0', 10e3)];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-6, tstop: 1e-5 }, ['all']);
    expect(findVector(r, 'Ma(A1)')).toBeUndefined();
  });

  it('an undefined opcode halts the core and shows up in Mhalt', () => {
    // the image is written by hand: 0xA5 is the one unused opcode
    const code = { name: CARD, type: 'D_MCU8051', params: { vol: 0, voh: 5, vnom: 5, vth: 2.5 }, stringParams: { code: '0:C290A5' } } as ModelCard;
    const els = [mcu(pins({ 'P1.0': 'q' }), { fosc: 12e6, pdrive: 1 }), res('RL', 'q', '0', 10e3)];
    const r = run(els, [code], { type: 'tran', tstep: 1e-6, tstop: 2e-5 }, ['all']);
    const last = r.scale!.re.length - 1;
    expect(vec(r, 'Mhalt(A1)')[last]).toBe(1);
    expect(vec(r, 'V(q)')[last]).toBeLessThan(1); // CLR P1.0 did run before the halt
  });

  it('sends "Hi" on the serial port and the bytes reach the read-outs', () => {
    const src = [
      'ORG 0',
      'MOV TMOD,#20h',
      'MOV TH1,#0FDh',
      'MOV TL1,#0FDh',
      'SETB TR1',
      'MOV SCON,#50h',
      'MOV A,#48h', // 'H'
      'ACALL SEND',
      'MOV A,#69h', // 'i'
      'ACALL SEND',
      'HERE: SJMP HERE',
      'SEND: MOV SBUF,A',
      'W: JNB TI,W',
      'CLR TI',
      'RET',
    ].join('\n');
    const els = [mcu(pins({ 'P3.1': 'txd' }), { fosc: 11.0592e6, pdrive: 1 }), res('RL', 'txd', '0', 10e3)];
    const r = run(els, [card(src)], { type: 'tran', tstep: 1e-5, tstop: 4e-3 }, ['all']);
    const last = r.scale!.re.length - 1;
    expect(vec(r, 'Mtxn(A1)')[last]).toBe(2);
    expect(vec(r, 'Mtx0(A1)')[last]).toBe(0x69);
    expect(vec(r, 'Mtx1(A1)')[last]).toBe(0x48);
    // a 9600 baud frame is 10 bits of 104.17 µs, so two characters take about 2.08 ms
    const starts = crossings(r, 'V(txd)', 2.5, 'fall');
    expect(starts[0]).toBeGreaterThan(0);
    expect(starts[0]).toBeLessThan(1e-4);
  });

  it('refuses an element with the wrong number of pins', () => {
    const bad = { type: 'A', name: 'A1', nodes: ['a', 'b', '0'], model: CARD, params: { pwr: 1 } } as ElementIR;
    const r = runAnalyses(netlist([bad, res('R1', 'a', '0', 1e3)], [{ type: 'op' }], { models: [card('NOP')] }))[0];
    expect(r.error).toMatch(/34 port nodes/);
  });
});
