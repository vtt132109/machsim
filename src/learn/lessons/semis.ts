/**
 * Semiconductor lessons: diode, LED with series resistor, Zener regulator, rectifier, BJT switch
 * and the common-emitter amplifier. Text: src/i18n/lessons/semis.ts.
 */
import type { LibraryPartDef } from '../../library/partkit';
import type { LessonCircuit, PartRef } from '../circuit';
import { builder, fail, fmt, inRange, isResult, M, measured, need, otherNet, p, pass, pickMeter, setAnalyses, withSim } from '../kit';
import type { CheckResult, LessonDef } from '../types';

function needAll(c: LessonCircuit, list: [Parameters<typeof need>[1], Parameters<typeof need>[2]][]): CheckResult {
  for (const [m, n] of list) {
    const r = need(c, m, n);
    if (isResult(r)) return r;
  }
  return pass();
}

/** Source -> series resistor -> two-terminal part to ground (diode, LED, Zener lessons). */
function seriesLayout(title: string, volts: string, r: string, partId: string, opts: { reverse?: boolean; meter?: 'v' | 'a'; load?: string } = {}) {
  const b = builder(title);
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: volts });
  const r1 = b.part('basic/resistor', 'R1', 190, 160, { value: r });
  const d1 = b.part(partId, partId.includes('led') ? 'LED1' : 'D1', 280, 220, {}, { rotation: opts.reverse ? 270 : 90 });
  const top = opts.reverse ? 'K' : 'A';
  const bottom = opts.reverse ? 'A' : 'K';
  if (opts.meter === 'a') {
    const xmm = b.part('instruments/multimeter', 'XMM1', 110, 60, { mode: 'a' });
    b.wire(b.pin(v1, '+'), b.pin(xmm, '+'));
    b.wire(b.pin(xmm, '-'), p(120, 160), b.pin(r1, '1'));
  } else b.wire(b.pin(v1, '+'), p(100, 160), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(280, 160), b.pin(d1, top));
  b.wire(b.pin(d1, bottom), p(280, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.part('sources/ground', 'GND1', 100, 300);
  if (opts.meter === 'v') {
    const xmm = b.part('instruments/multimeter', 'XMM1', 380, 200, { mode: 'v' });
    b.wire(p(280, 160), p(370, 160), b.pin(xmm, '+'));
    b.wire(b.pin(xmm, '-'), p(390, 300), p(280, 300));
  }
  if (opts.load) {
    const rl = b.part('basic/resistor', 'RL', 360, 220, { value: opts.load }, { rotation: 90 });
    b.wire(p(280, 160), p(360, 160), b.pin(rl, '1'));
    b.wire(b.pin(rl, '2'), p(360, 300), p(280, 300));
  }
  b.label('OUT', 280, 160);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** V(A) − V(K) and the current of a diode-like part. */
async function diodeState(c: LessonCircuit, d: PartRef): Promise<{ vd: number; i: number }> {
  const op = await c.op();
  return { vd: op.vd(c.net(d, 'A'), c.net(d, 'K')), i: c.current(op, d) };
}

// ---------------------------------------------------------------------------------------------
// 7. Diode

export const diode: LessonDef = {
  id: 'diode',
  level: 'semiconductors',
  solution: () => seriesLayout('Diode', '5', '1k', 'diodes/1n4148', { meter: 'v' }),
  variants: { reverse: () => seriesLayout('Diode', '5', '1k', 'diodes/1n4148', { reverse: true, meter: 'v' }) },
  steps: [
    { id: 'parts', check: (c) => needAll(c, [[M.dcSource, 'source'], [M.resistor, 'resistor'], [M.diode, 'diode']]) },
    {
      id: 'forward',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const d = need(c, M.diode, 'diode');
          if (isResult(d)) return d;
          const s = await diodeState(c, d[0]);
          if (s.vd < 0) return fail('note:reversed');
          if (s.i < 0.5e-3) return fail('note:tooLittle', { value: fmt(s.i, 'A') });
          return inRange(s.vd, 0.5, 0.85, 'V');
        }),
    },
    {
      id: 'reverse',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const d = need(c, M.diode, 'diode');
          if (isResult(d)) return d;
          const s = await diodeState(c, d[0]);
          if (-s.vd < 1) return fail('note:notReversed');
          return s.i < 1e-6 ? pass('note:blocking', { value: fmt(s.i, 'A') }) : fail('note:leaking', { value: fmt(s.i, 'A') });
        }),
    },
    {
      id: 'measure',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const d = need(c, M.diode, 'diode');
          if (isResult(d)) return d;
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const meter = pickMeter(c, m, 'v', (x) => c.across(x, d[0]));
          if (!c.across(meter, d[0])) return fail('note:meterAcrossDiode');
          const reading = c.meter(await c.op(), meter);
          if (!reading || reading.mode !== 'v') return fail('meterMode', { mode: 'V' });
          return inRange(Math.abs(reading.value), 0.5, 0.85, 'V');
        }),
    },
  ],
  quiz: [
    { id: 'drop', options: 4, answer: 1 },
    { id: 'band', options: 3, answer: 1 },
    { id: 'reverseCurrent', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 8. LED and current-limiting resistor

async function ledCurrent(c: LessonCircuit): Promise<CheckResult | number> {
  const led = need(c, M.led, 'led');
  if (isResult(led)) return led;
  const i = c.current(await c.op(), led[0]);
  return i;
}

export const led: LessonDef = {
  id: 'led',
  level: 'semiconductors',
  solution: () => seriesLayout('LED', '9', '470', 'diodes/led-red', { meter: 'a' }),
  variants: { twelve: () => seriesLayout('LED', '12', '680', 'diodes/led-red', { meter: 'a' }) },
  steps: [
    { id: 'parts', check: (c) => needAll(c, [[M.dcSource, 'source'], [M.resistor, 'resistor'], [M.led, 'led']]) },
    {
      id: 'current',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const i = await ledCurrent(c);
          if (isResult(i)) return i;
          if (!(i > 1e-6)) return fail('note:ledOff');
          return inRange(i, 10e-3, 20e-3, 'A');
        }),
    },
    {
      id: 'ammeter',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const i = await ledCurrent(c);
          if (isResult(i)) return i;
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const reading = c.meter(await c.op(), pickMeter(c, m, 'a'));
          if (!reading || reading.mode !== 'a') return fail('meterMode', { mode: 'A' });
          if (!(Math.abs(reading.value) > 1e-4)) return fail('note:ammeterSeries');
          return measured(Math.abs(reading.value), i, 3, 'A');
        }),
    },
    {
      id: 'twelve',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const src = need(c, M.dcSource, 'source');
          if (isResult(src)) return src;
          if (c.num(src[0], 'value') < 11.5) return fail('note:set12');
          const i = await ledCurrent(c);
          if (isResult(i)) return i;
          return inRange(i, 10e-3, 20e-3, 'A');
        }),
    },
  ],
  quiz: [
    { id: 'formula', options: 3, answer: 0 },
    { id: 'vf', options: 4, answer: 1 },
    { id: 'noResistor', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 9. Zener regulator

/** Nominal Zener voltage of a part (catalogue specs.vz or the generic part's vz parameter). */
function zenerVolts(c: LessonCircuit, z: PartRef): number {
  const spec = (z.def as LibraryPartDef).specs?.vz;
  if (typeof spec === 'number') return spec;
  return c.num(z, 'vz');
}

async function zenerState(c: LessonCircuit): Promise<CheckResult | { z: PartRef; vz: number; i: number; out: string }> {
  const z = need(c, M.zener, 'zener');
  if (isResult(z)) return z;
  const op = await c.op();
  const vz = op.vd(c.net(z[0], 'K'), c.net(z[0], 'A'));
  if (vz < -0.3) return fail('note:zenerForward');
  return { z: z[0], vz, i: c.current(op, z[0]), out: c.net(z[0], 'K') ?? '' };
}

export const zener: LessonDef = {
  id: 'zener',
  level: 'semiconductors',
  solution: () => seriesLayout('Zener regulator', '12', '470', 'diodes/1n4733a', { reverse: true, load: '1k' }),
  steps: [
    { id: 'parts', check: (c) => needAll(c, [[M.dcSource, 'source'], [M.resistor, 'resistor'], [M.zener, 'zener']]) },
    {
      id: 'regulate',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await zenerState(c);
          if (isResult(s)) return s;
          if (!(s.i >= 1e-3)) return fail('note:zenerOff', { value: Number.isFinite(s.i) ? fmt(s.i, 'A') : '—' });
          const nominal = zenerVolts(c, s.z);
          return Number.isFinite(nominal) ? measured(s.vz, nominal, 10, 'V') : inRange(s.vz, 2, 30, 'V');
        }),
    },
    {
      id: 'load',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await zenerState(c);
          if (isResult(s)) return s;
          const load = c.parts(M.resistor).find((r) => c.across(r, s.z));
          if (!load) return fail('note:noLoad');
          return s.i >= 1e-3 ? pass('note:loadOk', { value: fmt(s.vz, 'V'), iz: fmt(s.i, 'A') }) : fail('note:zenerOff', { value: Number.isFinite(s.i) ? fmt(s.i, 'A') : '—' });
        }),
    },
    {
      id: 'line',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await zenerState(c);
          if (isResult(s)) return s;
          const src = need(c, M.dcSource, 'source');
          if (isResult(src)) return src;
          const name = c.element(src[0], 'V');
          const vs = c.num(src[0], 'value');
          if (!name || !(vs > 0)) return fail('note:noSource');
          const sweep = await c.simulate({ type: 'dc', src: name, start: vs, stop: vs + 3, step: 3 });
          const w = sweep.vec(`V(${s.out})`);
          if (!w || w.re.length < 2) return fail('simFailed', { message: 'no sweep result' });
          const dv = Math.abs(w.re[w.re.length - 1] - w.re[0]);
          return dv <= 0.3 ? pass('note:lineOk', { dv: fmt(dv, 'V') }) : fail('note:lineBad', { dv: fmt(dv, 'V') });
        }),
    },
  ],
  quiz: [
    { id: 'bias', options: 3, answer: 1 },
    { id: 'resistor', options: 3, answer: 0 },
    { id: 'moreLoad', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 10. Rectifier

function rectifierLayout(withFilter: boolean) {
  const b = builder('Rectifier');
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '10', freq: '50', acmag: '0' });
  const d1 = b.part('diodes/1n4007', 'D1', 190, 160);
  const rl = b.part('basic/resistor', 'RL', 360, 220, { value: '1k' }, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 160), b.pin(d1, 'A'));
  b.wire(b.pin(d1, 'K'), p(360, 160), b.pin(rl, '1'));
  b.wire(b.pin(rl, '2'), p(360, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.part('sources/ground', 'GND1', 100, 300);
  if (withFilter) {
    const c1 = b.part('basic/electrolytic', 'C1', 280, 220, { value: '470u' }, { rotation: 90 });
    b.wire(p(280, 160), b.pin(c1, '+'));
    b.wire(b.pin(c1, '-'), p(280, 300));
  }
  const xsc = b.part('instruments/scope', 'XSC1', 520, 100, { timebase: '10m', 'A.scale': '5', 'trig.source': 'A', 'trig.level': '2' });
  b.wire(p(360, 160), p(470, 160), b.pin(xsc, 'A+'));
  b.labelPin(xsc, 'A-', '0');
  b.label('OUT', 360, 160);
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 1e-4, tstop: 0.1 }]);
}

/** Source, diode and load of a half-wave rectifier: the load is grounded and fed by the cathode. */
function rectifierParts(c: LessonCircuit): { src: PartRef; d: PartRef; load: PartRef; out: string } | null {
  const src = c.parts(M.acSource)[0];
  if (!src) return null;
  for (const d of c.parts(M.diode)) {
    const k = c.net(d, 'K');
    if (!k || k === '0') continue;
    const load = c.parts(M.resistor).find((r) => c.touches(r, k) && otherNet(c, r, k) === '0');
    if (load) return { src, d, load, out: k };
  }
  return null;
}

async function rectifierWave(c: LessonCircuit): Promise<CheckResult | { vp: number; max: number; min: number; ripple: number; out: string; parts: NonNullable<ReturnType<typeof rectifierParts>> }> {
  const parts = rectifierParts(c);
  if (!parts) return fail('note:rectWiring');
  const vp = c.num(parts.src, 'amplitude');
  const f = c.num(parts.src, 'freq');
  if (!(vp > 1 && f > 0 && f <= 1e5)) return fail('note:acSettings');
  const tr = await c.tran(4 / f, 1 / (f * 400), 1 / (f * 200));
  const late = tr.range(parts.out, 3 / f);
  const all = tr.range(parts.out, 0);
  return { vp, max: late.max, min: all.min, ripple: late.max - late.min, out: parts.out, parts };
}

export const rectifier: LessonDef = {
  id: 'rectifier',
  level: 'semiconductors',
  solution: () => rectifierLayout(true),
  steps: [
    { id: 'parts', check: (c) => needAll(c, [[M.acSource, 'acSource'], [M.diode, 'diode'], [M.resistor, 'resistor']]) },
    {
      id: 'halfwave',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const w = await rectifierWave(c);
          if (isResult(w)) return w;
          if (w.min < -0.3) return fail('note:negative', { value: fmt(w.min, 'V') });
          return inRange(w.max, w.vp - 1.3, w.vp - 0.3, 'V');
        }),
    },
    {
      id: 'filter',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const w = await rectifierWave(c);
          if (isResult(w)) return w;
          if (!c.parts(M.capacitor).some((cap) => c.across(cap, w.parts.load))) return fail('note:noFilter');
          return w.ripple <= 0.25 * w.vp ? pass('note:rippleOk', { value: fmt(w.ripple, 'V') }) : fail('note:rippleBig', { value: fmt(w.ripple, 'V') });
        }),
    },
    {
      id: 'scope',
      check: (c) => {
        const parts = rectifierParts(c);
        const sc = need(c, M.scope, 'scope');
        if (isResult(sc)) return sc;
        const on = parts && sc.some((s) => Object.values(c.instrument(s)?.channels ?? {}).some((ch) => ch.kind === 'voltage' && ch.pos === parts.out));
        return on ? pass() : fail('note:scopeOnOut');
      },
    },
  ],
  quiz: [
    { id: 'peak', options: 3, answer: 2 },
    { id: 'biggerC', options: 3, answer: 0 },
    { id: 'rippleFreq', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 11. Transistor switch

function switchLayout(vin: string) {
  const b = builder('Transistor switch');
  const q1 = b.part('transistors/2n3904', 'Q1', 300, 260);
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 300, { value: vin });
  const v2 = b.part('sources/dc-voltage', 'V2', 460, 200, { value: '9' });
  const rb = b.part('basic/resistor', 'RB', 200, 260, { value: '1k' });
  const rc = b.part('basic/resistor', 'RC', 310, 100, { value: '470' }, { rotation: 90 });
  const led = b.part('diodes/led-red', 'LED1', 310, 190, {}, { rotation: 90 });
  b.wire(b.pin(v1, '+'), p(100, 260), b.pin(rb, '1'));
  b.wire(b.pin(rb, '2'), b.pin(q1, 'B'));
  b.wire(b.pin(q1, 'C'), b.pin(led, 'K'));
  b.wire(b.pin(led, 'A'), b.pin(rc, '2'));
  b.wire(b.pin(rc, '1'), p(310, 50), p(460, 50), b.pin(v2, '+'));
  b.wire(b.pin(q1, 'E'), p(310, 360), p(100, 360));
  b.wire(b.pin(v1, '-'), p(100, 360));
  b.wire(b.pin(v2, '-'), p(460, 360), p(310, 360));
  b.part('sources/ground', 'GND1', 100, 360);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

export const bjtSwitch: LessonDef = {
  id: 'bjt-switch',
  level: 'semiconductors',
  solution: () => switchLayout('5'),
  variants: { off: () => switchLayout('0') },
  steps: [
    { id: 'parts', check: (c) => needAll(c, [[M.npn, 'npn'], [M.led, 'led'], [M.resistor, 'resistor']]) },
    {
      id: 'emitter',
      check: (c) => {
        const q = need(c, M.npn, 'npn');
        if (isResult(q)) return q;
        return c.net(q[0], 'E') === '0' ? pass() : fail('note:emitterGround');
      },
    },
    {
      id: 'on',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const q = need(c, M.npn, 'npn');
          if (isResult(q)) return q;
          const l = need(c, M.led, 'led');
          if (isResult(l)) return l;
          const b = c.net(q[0], 'B');
          if (!c.parts(M.resistor).some((r) => c.touches(r, b))) return fail('note:baseResistor');
          const op = await c.op();
          const vbe = op.vd(b, c.net(q[0], 'E'));
          if (vbe < 0.5) return fail('note:noBase', { value: fmt(vbe, 'V') });
          const vce = op.vd(c.net(q[0], 'C'), c.net(q[0], 'E'));
          const i = c.current(op, l[0]);
          if (i < 5e-3) return fail('note:ledDim', { value: fmt(i, 'A') });
          return vce < 0.3 ? pass('note:saturated', { vce: fmt(vce, 'V'), i: fmt(i, 'A') }) : fail('note:notSaturated', { vce: fmt(vce, 'V') });
        }),
    },
    {
      id: 'off',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const q = need(c, M.npn, 'npn');
          if (isResult(q)) return q;
          const l = need(c, M.led, 'led');
          if (isResult(l)) return l;
          const op = await c.op();
          const vbe = op.vd(c.net(q[0], 'B'), c.net(q[0], 'E'));
          if (vbe >= 0.5) return fail('note:stillOn', { value: fmt(vbe, 'V') });
          const i = c.current(op, l[0]);
          return i < 1e-4 ? pass('note:offOk', { value: fmt(i, 'A') }) : fail('note:ledDim', { value: fmt(i, 'A') });
        }),
    },
  ],
  quiz: [
    { id: 'vceSat', options: 3, answer: 0 },
    { id: 'baseCurrent', options: 3, answer: 1 },
    { id: 'emitter', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 12. Common-emitter amplifier

function ceLayout(full: boolean) {
  const b = builder('Common-emitter amplifier');
  const vcc = b.part('sources/dc-voltage', 'VCC', 640, 300, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 300, 200, { value: '47k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 300, 400, { value: '10k' }, { rotation: 90 });
  const rc = b.part('basic/resistor', 'RC', 410, 200, { value: '4.7k' }, { rotation: 90 });
  const q1 = b.part('transistors/2n3904', 'Q1', 400, 300);
  const re = b.part('basic/resistor', 'RE', 410, 400, { value: '1k' }, { rotation: 90 });
  const cin = b.part('basic/electrolytic', 'CIN', 230, 300, { value: '10u' }, { mirror: true });
  const cout = b.part('basic/electrolytic', 'COUT', 520, 250, { value: '10u' });
  const rl = b.part('basic/resistor', 'RL', 580, 380, { value: '10k' }, { rotation: 90 });
  const xfg = b.part('instruments/function-generator', 'XFG1', 120, 200, { waveform: 'sine', freq: '1k', amplitude: '10m' });
  // supply rail at y = 140, ground rail at y = 480
  b.wire(b.pin(r1, '1'), p(300, 140), p(640, 140), b.pin(vcc, '+'));
  b.wire(b.pin(rc, '1'), p(410, 140));
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(cin, '+'), p(300, 300));
  b.wire(p(300, 300), b.pin(q1, 'B'));
  b.wire(b.pin(rc, '2'), b.pin(q1, 'C'));
  b.wire(b.pin(q1, 'E'), b.pin(re, '1'));
  b.wire(b.pin(r2, '2'), p(300, 480), p(640, 480), b.pin(vcc, '-'));
  b.wire(b.pin(re, '2'), p(410, 480));
  b.wire(p(410, 250), b.pin(cout, '+'));
  b.wire(b.pin(cout, '-'), p(580, 250), b.pin(rl, '1'));
  b.wire(b.pin(rl, '2'), p(580, 480));
  b.wire(b.pin(xfg, '+'), p(100, 300), b.pin(cin, '-'));
  b.wire(b.pin(xfg, 'COM'), p(120, 480), p(300, 480));
  b.part('sources/ground', 'GND1', 300, 480);
  b.label('IN', 150, 300);
  b.label('OUT', 580, 250);
  if (full) {
    const ce = b.part('basic/electrolytic', 'CE', 480, 400, { value: '100u' }, { rotation: 90 });
    b.wire(p(410, 350), p(480, 350), b.pin(ce, '+'));
    b.wire(b.pin(ce, '-'), p(480, 480));
    const xmm = b.part('instruments/multimeter', 'XMM1', 760, 260, { mode: 'v' });
    b.labelPin(xmm, '+', 'VC');
    b.labelPin(xmm, '-', 'VE');
    b.label('VC', 410, 250);
    b.label('VE', 410, 350);
    const xsc = b.part('instruments/scope', 'XSC1', 760, 420, { timebase: '500u', 'A.scale': '10m', 'B.scale': '1', 'trig.source': 'A', 'trig.level': '0' });
    b.labelPin(xsc, 'A+', 'IN');
    b.labelPin(xsc, 'B+', 'OUT');
  }
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 5e-6, tstop: 5e-3 }, { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e7 }]);
}

/** The emitter resistor: from the transistor's emitter to ground. */
function emitterResistor(c: LessonCircuit, q: PartRef): PartRef | undefined {
  const e = c.net(q, 'E');
  return e && e !== '0' ? c.parts(M.resistor).find((r) => c.touches(r, e) && otherNet(c, r, e) === '0') : undefined;
}

export const ceAmp: LessonDef = {
  id: 'ce-amp',
  level: 'semiconductors',
  starter: () => ceLayout(false),
  solution: () => ceLayout(true),
  steps: [
    {
      id: 'bias',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const q = need(c, M.npn, 'npn');
          if (isResult(q)) return q;
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const meter = pickMeter(c, m, 'v', (x) => c.across(x, q[0], undefined, ['C', 'E']));
          if (!c.across(meter, q[0], undefined, ['C', 'E'])) return fail('note:meterCE');
          const reading = c.meter(await c.op(), meter);
          if (!reading || reading.mode !== 'v') return fail('meterMode', { mode: 'V' });
          return inRange(Math.abs(reading.value), 2, 10, 'V');
        }),
    },
    {
      id: 'bypass',
      check: (c) => {
        const q = need(c, M.npn, 'npn');
        if (isResult(q)) return q;
        const re = emitterResistor(c, q[0]);
        if (!re) return fail('note:noRE');
        const cap = c.parts(M.capacitor).find((x) => c.across(x, re));
        if (!cap) return fail('note:noBypass');
        return c.num(cap, 'value') >= 10e-6 ? pass() : fail('note:smallBypass', { value: fmt(c.num(cap, 'value'), 'F') });
      },
    },
    {
      id: 'gain',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const out = c.namedNet('OUT');
          const input = c.namedNet('IN');
          if (!out || !input) return fail('note:needLabels');
          const g = (await c.acAt(1000)).gain(out, input);
          return g >= 30 ? pass('note:ceGainOk', { gain: g.toFixed(0) }) : fail('note:ceGainLow', { gain: g.toFixed(1) });
        }),
    },
    {
      id: 'scope',
      check: (c) => {
        const sc = need(c, M.scope, 'scope');
        if (isResult(sc)) return sc;
        const want = [c.namedNet('IN'), c.namedNet('OUT')];
        const on = sc.some((s) => {
          const pos = Object.values(c.instrument(s)?.channels ?? {}).map((ch) => (ch.kind === 'voltage' ? ch.pos : ''));
          return want.every((w) => !!w && pos.includes(w));
        });
        return on ? pass() : fail('note:scopeInOut');
      },
    },
  ],
  quiz: [
    { id: 'phase', options: 3, answer: 1 },
    { id: 'bypass', options: 3, answer: 0 },
    { id: 'active', options: 4, answer: 2 },
  ],
};

