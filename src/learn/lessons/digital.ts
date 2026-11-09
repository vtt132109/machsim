/**
 * Digital lessons: logic gates, the D flip-flop as a divide-by-two, a decade counter driving a
 * 7-segment display, and ADC / DAC conversion. Text: src/i18n/lessons/digital.ts.
 */
import type { LessonCircuit, PartRef } from '../circuit';
import { builder, fail, fmt, groundAt, inRange, isResult, M, measured, need, noun, otherNet, p, pass, plusNet, setAnalyses, withSim } from '../kit';
import { heldAsync, pickFlipflop, pickGate, type FlipflopUnit, type GateUnit } from '../gates';
import type { CheckResult, LessonDef } from '../types';

const HIGH = 2.5;

function needAll(c: LessonCircuit, list: [Parameters<typeof need>[1], Parameters<typeof need>[2]][]): CheckResult {
  for (const [m, n] of list) {
    const r = need(c, m, n);
    if (isResult(r)) return r;
  }
  return pass();
}

/**
 * The gate the learner wired (the teaching symbol, or one gate of a real 7408 / 74LS08 / 4081
 * package — src/learn/gates.ts), or a "place an AND gate" result.
 */
function needGate(c: LessonCircuit): GateUnit | CheckResult {
  return pickGate(c, M.andGate) ?? fail('needPart', { part: noun('andGate') });
}

/** Any instrument channel (scope, logic analyzer) on `node`. */
function watched(c: LessonCircuit, node: string | undefined): boolean {
  if (!node) return false;
  const insts = c.parts({ instruments: ['oscilloscope', 'oscilloscope-4ch', 'bench-scope', 'logic-analyzer', 'mixed-signal-scope'] });
  return insts.some((s) => Object.values(c.instrument(s)?.channels ?? {}).some((ch) => ch.kind === 'voltage' && ch.pos === node));
}

// ---------------------------------------------------------------------------------------------
// 17. Logic gates

function gatesLayout(b2: boolean) {
  const b = builder('AND gate');
  const g = b.part('misc-digital/and2', 'U1', 300, 200);
  const s1 = b.part('sources/logic-switch', 'S1', 120, 150, { state: 'true', key: 'A' });
  const s2 = b.part('sources/logic-switch', 'S2', 120, 250, { state: b2 ? 'true' : 'false', key: 'B' });
  const x1 = b.part('indicators/probe-red', 'X1', 420, 200);
  b.wire(b.pin(s1, 'OUT'), p(220, 150), p(220, 190), b.pin(g, 'A'));
  b.wire(b.pin(s2, 'OUT'), p(220, 250), p(220, 210), b.pin(g, 'B'));
  b.wire(b.pin(g, 'Y'), b.pin(x1, '1'));
  b.label('A', 190, 150);
  b.label('B', 190, 250);
  b.label('Y', 380, 200);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

async function gateLevels(c: LessonCircuit): Promise<CheckResult | { inputs: number[]; out: number }> {
  const g = needGate(c);
  if (isResult(g)) return g;
  const op = await c.op();
  return { inputs: g.inputs.map((n) => op.v(c.net(g.ref, n))), out: op.v(c.net(g.ref, g.out)) };
}

export const logicGates: LessonDef = {
  id: 'logic-gates',
  level: 'digital',
  solution: () => gatesLayout(true),
  variants: { zero: () => gatesLayout(false) },
  steps: [
    { id: 'gate', check: (c) => needAll(c, [[M.andGate, 'andGate']]) },
    {
      id: 'inputs',
      check: (c) => {
        const g = needGate(c);
        if (isResult(g)) return g;
        const open = g.inputs.filter((n) => !c.pinConnected(g.ref, n));
        return open.length ? fail('note:inputOpen', { pin: open.join(', ') }) : pass();
      },
    },
    {
      id: 'probe',
      check: (c) => {
        const g = needGate(c);
        if (isResult(g)) return g;
        const pl = need(c, M.probeLight, 'probeLight');
        if (isResult(pl)) return pl;
        return pl.some((x) => c.net(x, '1') === c.net(g.ref, g.out)) ? pass() : fail('note:probeOnY');
      },
    },
    {
      id: 'oneOne',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await gateLevels(c);
          if (isResult(s)) return s;
          if (!s.inputs.every((v) => v > HIGH)) return fail('note:setInputsHigh');
          return s.out > HIGH ? pass('note:outOne', { value: fmt(s.out, 'V') }) : fail('note:outNotOne', { value: fmt(s.out, 'V') });
        }),
    },
    {
      id: 'zero',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await gateLevels(c);
          if (isResult(s)) return s;
          if (!s.inputs.some((v) => v < 0.8)) return fail('note:setInputLow');
          return s.out < 0.8 ? pass('note:outZero', { value: fmt(s.out, 'V') }) : fail('note:outNotZero', { value: fmt(s.out, 'V') });
        }),
    },
  ],
  quiz: [
    { id: 'and', options: 4, answer: 3 },
    { id: 'or', options: 3, answer: 0 },
    { id: 'not', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 18. D flip-flop as a divide-by-two

function flipflopLayout() {
  const b = builder('D flip-flop toggle');
  const ff = b.part('misc-digital/dff', 'U1', 300, 220);
  const clk = b.part('sources/digital-clock', 'V1', 120, 230, { freq: '1k' });
  b.wire(b.pin(clk, 'OUT'), b.pin(ff, 'CLK'));
  b.wire(b.pin(ff, 'QN'), p(370, 230), p(370, 140), p(240, 140), p(240, 210), b.pin(ff, 'D'));
  // the Q label sits on the end of a short stub, so no wire end is left open
  b.wire(b.pin(ff, 'Q'), p(420, 210));
  b.label('CLK', 200, 230);
  b.label('Q', 420, 210);
  const xla = b.part('instruments/scope', 'XSC1', 560, 120, { timebase: '1m', 'A.scale': '5', 'B.scale': '5', 'trig.source': 'A', 'trig.level': '2.5' });
  b.labelPin(xla, 'A+', 'CLK');
  b.labelPin(xla, 'B+', 'Q');
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
}

/** The flip-flop the learner wired (teaching symbol or one half of a real 7474), or a result. */
function needFf(c: LessonCircuit): FlipflopUnit | CheckResult {
  return pickFlipflop(c, M.dff) ?? fail('needPart', { part: noun('dff') });
}

/** Frequency of a clock part from its parameters (digital clock: freq; pulse: 1/period). */
function clockFreq(c: LessonCircuit, clk: PartRef): number {
  const f = c.num(clk, 'freq');
  if (Number.isFinite(f) && f > 0) return f;
  const per = c.num(clk, 'period');
  return per > 0 ? 1 / per : NaN;
}

export const flipflop: LessonDef = {
  id: 'flipflop',
  level: 'digital',
  solution: flipflopLayout,
  steps: [
    { id: 'parts', check: (c) => needAll(c, [[M.dff, 'dff'], [M.clock, 'clock']]) },
    {
      id: 'toggle',
      check: (c) => {
        const ff = needFf(c);
        if (isResult(ff)) return ff;
        const clocks = c.parts(M.clock);
        if (!clocks.some((k) => plusNet(c, k) === c.net(ff.ref, ff.clk))) return fail('note:clockToClk');
        // a real 74x74 has ~PRE / ~CLR: held low, the flip-flop can never toggle
        const held = heldAsync(c, ff);
        if (held.length) return fail('note:asyncLow', { pin: held.join(', ') });
        if (!ff.qn) return fail('note:qnToD');
        return c.net(ff.ref, ff.qn) === c.net(ff.ref, ff.d) ? pass() : fail('note:qnToD');
      },
    },
    {
      id: 'divide',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const ff = needFf(c);
          if (isResult(ff)) return ff;
          const clk = c.parts(M.clock).find((k) => plusNet(c, k) === c.net(ff.ref, ff.clk));
          if (!clk) return fail('note:clockToClk');
          const fclk = clockFreq(c, clk);
          if (!(fclk > 0.5 && fclk < 1e7)) return fail('note:clockRange');
          const tr = await c.tran(12 / fclk, 1 / (fclk * 100));
          const f = tr.frequency(c.net(ff.ref, ff.q), HIGH, 1 / fclk);
          const r = measured(f, fclk / 2, 5, 'Hz');
          return r.ok ? pass('note:divided', { value: fmt(f, 'Hz'), clock: fmt(fclk, 'Hz') }) : r;
        }),
    },
    {
      id: 'watch',
      check: (c) => {
        const ff = needFf(c);
        if (isResult(ff)) return ff;
        return watched(c, c.net(ff.ref, ff.q)) ? pass() : fail('note:watchQ');
      },
    },
  ],
  quiz: [
    { id: 'edge', options: 3, answer: 1 },
    { id: 'divide', options: 4, answer: 2 },
    { id: 'chain', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 19. Decade counter and 7-segment display

const SEGS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function counterLayout() {
  const b = builder('Decade counter');
  const clk = b.part('sources/digital-clock', 'V1', 120, 240, { freq: '5', vhigh: '5' });
  const cnt = b.part('ttl/7490', 'U1', 300, 300);
  const dec = b.part('ttl/7447', 'U2', 520, 300);
  const disp = b.part('indicators/seven-seg-ca', 'U3', 860, 300);
  b.wire(b.pin(clk, 'OUT'), b.pin(cnt, 'CKA'));
  b.label('CLK', 200, 240);
  for (const q of ['QA', 'QB', 'QC', 'QD']) b.labelPin(cnt, q, q);
  b.labelPin(cnt, 'CKB', 'QA');
  b.wire(b.pin(cnt, 'R01'), p(230, 300), p(230, 380));
  b.wire(b.pin(cnt, 'R02'), p(230, 320));
  b.wire(b.pin(cnt, 'R91'), p(230, 340));
  b.wire(b.pin(cnt, 'R92'), p(230, 360));
  b.part('sources/ground', 'GND1', 230, 380);
  for (const [i, q] of ['QA', 'QB', 'QC', 'QD'].entries()) b.labelPin(dec, 'ABCD'[i], q);
  b.part('sources/vcc', 'VCC1', 860, 200, { voltage: '5' });
  for (const pin of ['LT', 'RBI', 'BIRBO']) b.labelPin(dec, pin, 'VCC');
  SEGS.forEach((s, i) => {
    const r = b.part('basic/resistor', `R${i + 1}`, 660, 230 + 20 * i, { value: '330' });
    b.wire(b.pin(dec, `SEG${s.toUpperCase()}`), b.pin(r, '1'));
    b.labelPin(r, '2', `S${s.toUpperCase()}`);
    b.labelPin(disp, s, `S${s.toUpperCase()}`);
  });
  b.wire(p(860, 200), b.pin(disp, 'CA'));
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 1e-3, tstop: 3 }]);
}

/** BCD value of the counter outputs at each mid-period instant (−1 for an undefined level). */
async function countSequence(c: LessonCircuit, cnt: PartRef, fclk: number): Promise<number[]> {
  const periods = 12;
  const tr = await c.tran((periods + 0.5) / fclk, 1 / (fclk * 50));
  const nets = ['QA', 'QB', 'QC', 'QD'].map((q) => c.net(cnt, q));
  const out: number[] = [];
  for (let k = 0; k <= periods; k++) {
    const t = (k + 0.5) / fclk;
    let v = 0;
    for (const [bit, n] of nets.entries()) if (tr.at(n, t) > HIGH) v |= 1 << bit;
    out.push(v);
  }
  return out;
}

export const counter7seg: LessonDef = {
  id: 'counter-7seg',
  level: 'digital',
  solution: counterLayout,
  steps: [
    { id: 'parts', check: (c) => needAll(c, [[M.counter, 'counter'], [M.decoder, 'decoder'], [M.display, 'display'], [M.clock, 'clock']]) },
    {
      id: 'bcd',
      check: (c) => {
        const u = need(c, M.counter, 'counter');
        if (isResult(u)) return u;
        const n = (pin: string) => c.net(u[0], pin);
        if (!c.parts(M.clock).some((k) => plusNet(c, k) === n('CKA'))) return fail('note:clockToCka');
        if (n('QA') !== n('CKB')) return fail('note:qaToCkb');
        if (n('R01') !== '0' && n('R02') !== '0') return fail('note:resetLow');
        if (n('R91') !== '0' && n('R92') !== '0') return fail('note:setNineLow');
        return pass();
      },
    },
    {
      id: 'decoder',
      check: (c) => {
        const u = need(c, M.counter, 'counter');
        if (isResult(u)) return u;
        const d = need(c, M.decoder, 'decoder');
        if (isResult(d)) return d;
        const wrong = ['A', 'B', 'C', 'D'].filter((x, i) => c.net(d[0], x) !== c.net(u[0], ['QA', 'QB', 'QC', 'QD'][i]));
        return wrong.length ? fail('note:decoderInputs', { pin: wrong.join(', ') }) : pass();
      },
    },
    {
      id: 'segments',
      check: (c) => {
        const d = need(c, M.decoder, 'decoder');
        if (isResult(d)) return d;
        const disp = need(c, M.display, 'display');
        if (isResult(disp)) return disp;
        const rs = c.parts(M.resistor);
        for (const s of SEGS) {
          const a = c.net(d[0], `SEG${s.toUpperCase()}`);
          const b = c.net(disp[0], s);
          if (!a || !b) return fail('note:segment', { seg: s });
          if (a === b) continue;
          if (!rs.some((r) => c.touches(r, a) && otherNet(c, r, a) === b)) return fail('note:segment', { seg: s });
        }
        const common = disp[0].def.symbol.pins.find((x) => x.name === 'CA' || x.name === 'CC')?.name;
        return common && c.pinConnected(disp[0], common) ? pass() : fail('note:commonPin');
      },
    },
    {
      id: 'count',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const u = need(c, M.counter, 'counter');
          if (isResult(u)) return u;
          const clk = c.parts(M.clock).find((k) => plusNet(c, k) === c.net(u[0], 'CKA'));
          if (!clk) return fail('note:clockToCka');
          const fclk = clockFreq(c, clk);
          if (!(fclk > 0.1 && fclk <= 1e5)) return fail('note:clockRange');
          const seq = await countSequence(c, u[0], fclk);
          const seen = new Set(seq);
          const all = Array.from({ length: 10 }, (_, i) => i).every((d) => seen.has(d));
          const max = Math.max(...seq);
          return all && max <= 9 ? pass('note:counted', { seq: seq.slice(0, 12).join(' ') }) : fail('note:countWrong', { seq: seq.slice(0, 12).join(' ') });
        }),
    },
  ],
  quiz: [
    { id: 'bcd', options: 3, answer: 2 },
    { id: 'activeLow', options: 3, answer: 0 },
    { id: 'after9', options: 4, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 20. ADC and DAC

function adcLayout() {
  const b = builder('ADC and DAC');
  const adc = b.part('mixed/adc8', 'U1', 300, 300);
  const dac = b.part('mixed/dac8', 'U2', 560, 300);
  const vin = b.part('sources/dc-voltage', 'V1', 120, 260, { value: '2' });
  const vref = b.part('sources/dc-voltage', 'V2', 120, 420, { value: '5' });
  b.wire(b.pin(vin, '+'), p(120, 210), b.pin(adc, 'VIN'));
  groundAt(b, vin, '-', 'GND1');
  b.labelPin(vref, '+', 'REF');
  groundAt(b, vref, '-', 'GND2');
  b.labelPin(adc, 'VREFP', 'REF');
  b.labelPin(adc, 'VREFN', '0');
  b.labelPin(dac, 'VREFP', 'REF');
  b.labelPin(dac, 'VREFN', '0');
  for (let i = 0; i < 8; i++) {
    b.labelPin(adc, `D${i}`, `B${i}`);
    b.labelPin(dac, `D${i}`, `B${i}`);
  }
  b.labelPin(dac, 'VOUT', 'OUT');
  // the lesson asks to measure VOUT: a voltmeter on OUT (also keeps the net from ending at one pin)
  const xmm = b.part('instruments/multimeter', 'XMM1', 760, 300, { mode: 'v' });
  b.labelPin(xmm, '+', 'OUT');
  b.labelPin(xmm, '-', '0');
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

async function adcState(c: LessonCircuit): Promise<CheckResult | { code: number; expected: number; vin: number; vrefp: number; vrefn: number }> {
  const a = need(c, M.adc, 'adc');
  if (isResult(a)) return a;
  const op = await c.op();
  const vin = op.v(c.net(a[0], 'VIN'));
  const vrefp = op.v(c.net(a[0], 'VREFP'));
  const vrefn = op.v(c.net(a[0], 'VREFN'));
  let code = 0;
  for (let i = 0; i < 8; i++) if (op.v(c.net(a[0], `D${i}`)) > HIGH) code |= 1 << i;
  const expected = Math.max(0, Math.min(255, Math.floor(((vin - vrefn) / (vrefp - vrefn)) * 256)));
  return { code, expected, vin, vrefp, vrefn };
}

export const adcDac: LessonDef = {
  id: 'adc-dac',
  level: 'digital',
  solution: adcLayout,
  steps: [
    {
      id: 'adc',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const a = need(c, M.adc, 'adc');
          if (isResult(a)) return a;
          if (!c.pinConnected(a[0], 'VIN')) return fail('note:vinOpen');
          if (c.net(a[0], 'VREFN') !== '0') return fail('note:vrefnGround');
          return inRange((await c.op()).v(c.net(a[0], 'VREFP')), 1, 10, 'V');
        }),
    },
    {
      id: 'code',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await adcState(c);
          if (isResult(s)) return s;
          const bin = s.code.toString(2).padStart(8, '0');
          return Math.abs(s.code - s.expected) <= 1 ? pass('note:code', { code: s.code, bin, vin: fmt(s.vin, 'V') }) : fail('note:codeWrong', { code: s.code, expected: s.expected });
        }),
    },
    {
      id: 'dac',
      check: (c) => {
        const a = need(c, M.adc, 'adc');
        if (isResult(a)) return a;
        const d = need(c, M.dac, 'dac');
        if (isResult(d)) return d;
        const wrong = Array.from({ length: 8 }, (_, i) => `D${i}`).filter((x) => c.net(a[0], x) !== c.net(d[0], x));
        if (wrong.length) return fail('note:bitsToDac', { pin: wrong.join(', ') });
        return c.net(d[0], 'VREFP') === c.net(a[0], 'VREFP') ? pass() : fail('note:dacRef');
      },
    },
    {
      id: 'back',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await adcState(c);
          if (isResult(s)) return s;
          const d = need(c, M.dac, 'dac');
          if (isResult(d)) return d;
          const vout = (await c.op()).v(c.net(d[0], 'VOUT'));
          const lsb = (s.vrefp - s.vrefn) / 256;
          return Math.abs(vout - s.vin) <= 1.05 * lsb ? pass('note:backOk', { value: fmt(vout, 'V'), lsb: fmt(lsb, 'V') }) : fail('note:backWrong', { value: fmt(vout, 'V'), vin: fmt(s.vin, 'V') });
        }),
    },
  ],
  quiz: [
    { id: 'lsb', options: 3, answer: 1 },
    { id: 'bits', options: 4, answer: 3 },
    { id: 'error', options: 3, answer: 0 },
  ],
};
