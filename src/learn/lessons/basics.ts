/**
 * Basics lessons: Ohm's law, voltage divider, series / parallel, Kirchhoff's current law,
 * capacitor charging and the RC low-pass filter. Text: src/i18n/lessons/basics.ts.
 */
import type { LessonCircuit, PartRef } from '../circuit';
import { builder, fail, fmt, isResult, M, measured, near, need, noun, otherNet, p, pass, pickMeter, plusNet, setAnalyses, withSim } from '../kit';
import type { CheckResult, LessonDef } from '../types';

// ---------------------------------------------------------------------------------------------
// shared checks

function sourceWithValue(c: LessonCircuit, volts: number): CheckResult {
  const src = need(c, M.dcSource, 'source');
  if (isResult(src)) return src;
  const v = c.num(src[0], 'value');
  return near(v, volts, 2) ? pass('okValue', { value: fmt(v, 'V') }) : fail('needValue', { part: noun('source'), value: fmt(volts, 'V') });
}

/** Resistor currents from the OP (device outputs I(Rx)), keyed by refdes. */
async function resistorCurrents(c: LessonCircuit): Promise<{ ref: PartRef; i: number }[]> {
  const op = await c.op();
  return c.parts(M.resistor).map((ref) => ({ ref, i: c.current(op, ref) }));
}

// ---------------------------------------------------------------------------------------------
// 1. Ohm's law

function ohmSolution() {
  const b = builder('Ohm');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '9' });
  const r1 = b.part('basic/resistor', 'R1', 250, 200, { value: '1k' }, { rotation: 90 });
  const xmm = b.part('instruments/multimeter', 'XMM1', 170, 110, { mode: 'a' });
  b.wire(b.pin(v1, '+'), p(100, 140), b.pin(xmm, '+'));
  b.wire(b.pin(xmm, '-'), p(250, 140), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(250, 260), p(100, 260));
  b.wire(b.pin(v1, '-'), p(100, 260));
  b.part('sources/ground', 'GND1', 100, 260);
  return setAnalyses(b.design, 'op', [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 1e-2 }]);
}

export const ohm: LessonDef = {
  id: 'ohm',
  level: 'basics',
  solution: ohmSolution,
  steps: [
    { id: 'source', check: (c) => sourceWithValue(c, 9) },
    {
      id: 'resistor',
      check: (c) => {
        const r = need(c, M.resistor, 'resistor');
        if (isResult(r)) return r;
        const v = c.num(r[0], 'value');
        return near(v, 1000, 2) ? pass('okValue', { value: fmt(v, 'Ω') }) : fail('needValue', { part: noun('resistor'), value: fmt(1000, 'Ω') });
      },
    },
    {
      id: 'loop',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const src = need(c, M.dcSource, 'source');
          if (isResult(src)) return src;
          const r = need(c, M.resistor, 'resistor');
          if (isResult(r)) return r;
          const op = await c.op();
          const i = c.current(op, r[0]);
          if (!(i > 1e-9)) return fail('note:noCurrent');
          return measured(i, c.num(src[0], 'value') / c.num(r[0], 'value'), 3, 'A');
        }),
    },
    {
      id: 'ammeter',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const r = need(c, M.resistor, 'resistor');
          if (isResult(r)) return r;
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const op = await c.op();
          const reading = c.meter(op, pickMeter(c, m, 'a'));
          if (!reading || reading.mode !== 'a') return fail('meterMode', { mode: 'A' });
          const i = c.current(op, r[0]);
          if (!(Math.abs(reading.value) > 1e-6)) return fail('note:ammeterSeries');
          return measured(Math.abs(reading.value), i, 3, 'A');
        }),
    },
  ],
  quiz: [
    { id: 'double', options: 4, answer: 1 },
    { id: 'unit', options: 3, answer: 0 },
    { id: 'series', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 2. Voltage divider

function dividerSolution() {
  const b = builder('Divider');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 150, { value: '20k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 250, { value: '10k' }, { rotation: 90 });
  const xmm = b.part('instruments/multimeter', 'XMM1', 360, 200, { mode: 'v' });
  b.wire(b.pin(v1, '+'), p(100, 120), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(r2, '2'), p(250, 320), p(100, 320));
  b.wire(b.pin(v1, '-'), p(100, 320));
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(p(250, 200), p(350, 200), b.pin(xmm, '+'));
  b.wire(b.pin(xmm, '-'), p(370, 320), p(250, 320));
  b.label('OUT', 250, 200);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

export const divider: LessonDef = {
  id: 'divider',
  level: 'basics',
  solution: dividerSolution,
  steps: [
    {
      id: 'parts',
      check: (c) => {
        const s = sourceWithValue(c, 12);
        if (!s.ok) return s;
        const r = need(c, M.resistor, 'resistor', 2);
        return isResult(r) ? r : pass();
      },
    },
    {
      id: 'series',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const src = c.parts(M.dcSource)[0];
          const rs = c.parts(M.resistor);
          if (!src || rs.length < 2) return fail('note:needTwo');
          const op = await c.op();
          const vs = op.v(plusNet(c, src));
          const top = plusNet(c, src);
          for (const node of new Set(rs.flatMap((r) => c.pinNets(r)))) {
            if (node === '0' || node === top) continue;
            const shared = rs.filter((r) => c.touches(r, node)).length;
            const v = op.v(node);
            if (shared >= 2 && v > 0.02 * vs && v < 0.98 * vs) return pass('okValue', { value: fmt(v, 'V') });
          }
          return fail('note:notSeries');
        }),
    },
    {
      id: 'meter',
      check: (c) => {
        const m = need(c, M.meter, 'meter');
        if (isResult(m)) return m;
        const acrossLower = (x: PartRef) => c.parts(M.resistor).some((r) => c.touches(r, '0') && c.across(x, r));
        const meter = pickMeter(c, m, 'v', acrossLower);
        if (c.meterMode(meter) !== 'v') return fail('meterMode', { mode: 'V' });
        return acrossLower(meter) ? pass() : fail('note:meterLower');
      },
    },
    {
      id: 'target',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const reading = c.meter(await c.op(), pickMeter(c, m, 'v'));
          if (!reading || reading.mode !== 'v') return fail('meterMode', { mode: 'V' });
          return measured(Math.abs(reading.value), 4, 3, 'V');
        }),
    },
  ],
  quiz: [
    { id: 'equal', options: 4, answer: 2 },
    { id: 'load', options: 3, answer: 1 },
    { id: 'formula', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 3. Series and parallel

function seriesParallelSolution() {
  const b = builder('Series parallel');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '10' });
  const r1 = b.part('basic/resistor', 'R1', 190, 160, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 280, 220, { value: '2k' }, { rotation: 90 });
  const r3 = b.part('basic/resistor', 'R3', 360, 220, { value: '2k' }, { rotation: 90 });
  const xmm = b.part('instruments/multimeter', 'XMM1', 460, 200, { mode: 'v' });
  b.wire(b.pin(v1, '+'), p(100, 160), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), p(280, 160), b.pin(r2, '1'));
  b.wire(p(280, 160), p(360, 160), b.pin(r3, '1'));
  b.wire(b.pin(r2, '2'), p(280, 300), p(100, 300));
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.wire(b.pin(r3, '2'), p(360, 300), p(280, 300));
  b.part('sources/ground', 'GND1', 100, 300);
  b.wire(p(360, 160), p(450, 160), b.pin(xmm, '+'));
  b.wire(b.pin(xmm, '-'), p(470, 300), p(360, 300));
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** Resistor pairs that sit on the same two nets. */
function parallelPairs(c: LessonCircuit): [PartRef, PartRef][] {
  const rs = c.parts(M.resistor);
  const out: [PartRef, PartRef][] = [];
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (c.across(rs[i], rs[j])) out.push([rs[i], rs[j]]);
  return out;
}

export const seriesParallel: LessonDef = {
  id: 'series-parallel',
  level: 'basics',
  solution: seriesParallelSolution,
  steps: [
    {
      id: 'parts',
      check: (c) => {
        const r = need(c, M.resistor, 'resistor', 3);
        if (isResult(r)) return r;
        return sourceWithValue(c, 10);
      },
    },
    { id: 'parallel', check: (c) => (parallelPairs(c).length ? pass() : fail('note:noParallel')) },
    {
      id: 'current',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const src = need(c, M.dcSource, 'source');
          if (isResult(src)) return src;
          const name = c.element(src[0], 'V');
          const op = await c.op();
          return measured(Math.abs(op.last(`I(${name})`)), 5e-3, 3, 'A');
        }),
    },
    {
      id: 'voltage',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const pairs = parallelPairs(c);
          const meter = pickMeter(c, m, 'v', (x) => pairs.some(([a]) => c.across(x, a)));
          if (!pairs.some(([a]) => c.across(meter, a))) return fail('note:meterParallel');
          const reading = c.meter(await c.op(), meter);
          if (!reading || reading.mode !== 'v') return fail('meterMode', { mode: 'V' });
          return measured(Math.abs(reading.value), 5, 3, 'V');
        }),
    },
  ],
  quiz: [
    { id: 'parallelEqual', options: 4, answer: 0 },
    { id: 'seriesSum', options: 3, answer: 2 },
    { id: 'sameVoltage', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 4. Kirchhoff's current law

function kirchhoffLayout(meterInBranch: boolean) {
  const b = builder('Kirchhoff');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 240, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 160, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 340, 260, { value: '2k' }, { rotation: 90 });
  const r3 = b.part('basic/resistor', 'R3', 440, 260, { value: '3k' }, { rotation: 90 });
  const xmm = b.part('instruments/multimeter', 'XMM1', meterInBranch ? 390 : 170, 110, { mode: 'a' });
  if (meterInBranch) {
    // ammeter in the R3 branch: node A -> XMM1 -> R3
    b.wire(b.pin(v1, '+'), p(100, 160), b.pin(r1, '1'));
    b.wire(b.pin(r1, '2'), p(340, 160), b.pin(r2, '1'));
    b.wire(p(340, 160), p(380, 160), b.pin(xmm, '+'));
    b.wire(b.pin(xmm, '-'), p(440, 140), b.pin(r3, '1'));
  } else {
    // ammeter in the main line: V1 -> XMM1 -> R1
    b.wire(b.pin(v1, '+'), p(100, 140), b.pin(xmm, '+'));
    b.wire(b.pin(xmm, '-'), p(180, 160), b.pin(r1, '1'));
    b.wire(b.pin(r1, '2'), p(340, 160), b.pin(r2, '1'));
    b.wire(p(340, 160), p(440, 160), b.pin(r3, '1'));
  }
  b.wire(b.pin(r2, '2'), p(340, 330), p(100, 330));
  b.wire(b.pin(r3, '2'), p(440, 330), p(340, 330));
  b.wire(b.pin(v1, '-'), p(100, 330));
  b.part('sources/ground', 'GND1', 100, 330);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** A resistor whose current equals the sum of two others (one current splitting at a node). */
async function kclTriple(c: LessonCircuit): Promise<{ main: PartRef; branches: PartRef[]; currents: Map<PartRef, number> } | null> {
  const list = (await resistorCurrents(c)).filter((x) => x.i > 1e-4);
  const currents = new Map(list.map((x) => [x.ref, x.i]));
  for (const a of list) {
    for (const b of list) {
      for (const d of list) {
        if (a === b || a === d || b === d || b.ref.inst.refdes > d.ref.inst.refdes) continue;
        if (near(a.i, b.i + d.i, 2)) return { main: a.ref, branches: [b.ref, d.ref], currents };
      }
    }
  }
  return null;
}

/** |current| read by every placed multimeter that is in ammeter mode (A), in placement order. */
async function ammeterReadings(c: LessonCircuit, meters: readonly PartRef[]): Promise<number[]> {
  const op = await c.op();
  const out: number[] = [];
  for (const m of meters) {
    const r = c.meter(op, m);
    if (r && r.mode === 'a' && Number.isFinite(r.value)) out.push(Math.abs(r.value));
  }
  return out;
}

export const kirchhoff: LessonDef = {
  id: 'kirchhoff',
  level: 'basics',
  solution: () => kirchhoffLayout(true),
  variants: { mainCurrent: () => kirchhoffLayout(false) },
  steps: [
    {
      id: 'junction',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const r = need(c, M.resistor, 'resistor', 3);
          if (isResult(r)) return r;
          const t = await kclTriple(c);
          if (!t) return fail('note:noJunction');
          return pass('note:kcl', { main: fmt(t.currents.get(t.main)!, 'A'), a: fmt(t.currents.get(t.branches[0])!, 'A'), b: fmt(t.currents.get(t.branches[1])!, 'A') });
        }),
    },
    {
      id: 'mainCurrent',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const t = await kclTriple(c);
          if (!t) return fail('note:noJunction');
          // any ammeter may measure it (a learner often places one in the main line and one in a branch)
          const amps = await ammeterReadings(c, m);
          if (!amps.length) return fail('meterMode', { mode: 'A' });
          const hit = amps.find((i) => near(i, t.currents.get(t.main)!, 2));
          return hit !== undefined ? pass('okValue', { value: fmt(hit, 'A') }) : fail('note:notMain', { value: fmt(amps[0], 'A') });
        }),
    },
    {
      id: 'branchCurrent',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const m = need(c, M.meter, 'meter');
          if (isResult(m)) return m;
          const t = await kclTriple(c);
          if (!t) return fail('note:noJunction');
          const amps = await ammeterReadings(c, m);
          if (!amps.length) return fail('meterMode', { mode: 'A' });
          const hit = amps.find((i) => t.branches.some((b) => near(i, t.currents.get(b)!, 2)));
          // prefer reporting a meter that is not the main-line one
          const shown = amps.find((i) => !near(i, t.currents.get(t.main)!, 2)) ?? amps[0];
          return hit !== undefined ? pass('okValue', { value: fmt(hit, 'A') }) : fail('note:notBranch', { value: fmt(shown, 'A') });
        }),
    },
  ],
  quiz: [
    { id: 'kcl', options: 3, answer: 0 },
    { id: 'larger', options: 3, answer: 2 },
    { id: 'kvl', options: 4, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 5. Capacitor charging

function rcBase(title: string, withParts: boolean, source: 'pulse' | 'ac') {
  const b = builder(title);
  const v1 =
    source === 'pulse'
      ? b.part('sources/pulse-voltage', 'V1', 100, 220, { v1: '0', v2: '5', delay: '0', rise: '1u', fall: '1u', width: '1', period: '2' })
      : b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1k' });
  b.wire(b.pin(v1, '-'), p(100, 300));
  b.part('sources/ground', 'GND1', 100, 300);
  if (withParts) {
    const r1 = b.part('basic/resistor', 'R1', 190, 160, { value: source === 'pulse' ? '10k' : '1.6k' });
    const c1 = b.part('basic/capacitor', 'C1', 280, 220, { value: source === 'pulse' ? '10u' : '100n' }, { rotation: 90 });
    b.wire(b.pin(v1, '+'), p(100, 160), b.pin(r1, '1'));
    b.wire(b.pin(r1, '2'), p(280, 160), b.pin(c1, '1'));
    b.wire(b.pin(c1, '2'), p(280, 300), p(100, 300));
    b.label('OUT', 280, 160);
    if (source === 'pulse') {
      const xsc = b.part('instruments/scope', 'XSC1', 440, 100, { timebase: '50m', 'A.scale': '1', 'trig.source': 'A', 'trig.level': '1' });
      b.wire(p(280, 160), p(390, 160), b.pin(xsc, 'A+'));
      b.labelPin(xsc, 'A-', '0');
    }
  }
  return source === 'pulse'
    ? setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 5e-4, tstop: 0.6 }])
    : setAnalyses(b.design, 'ac', [{ type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e5 }]);
}

/** Resistor and capacitor of an RC network driven by `src`: C grounded, R from the source to C. */
function rcNetwork(c: LessonCircuit, src: PartRef): { r: PartRef; cap: PartRef; out: string } | null {
  const top = plusNet(c, src);
  for (const cap of c.parts(M.capacitor)) {
    if (!c.touches(cap, '0')) continue;
    const out = otherNet(c, cap, '0');
    if (!out || out === top) continue;
    const r = c.parts(M.resistor).find((x) => c.touches(x, out) && otherNet(c, x, out) === top);
    if (r) return { r, cap, out };
  }
  return null;
}

export const rcCharge: LessonDef = {
  id: 'rc-charge',
  level: 'basics',
  starter: () => rcBase('Capacitor charging', false, 'pulse'),
  solution: () => rcBase('Capacitor charging', true, 'pulse'),
  steps: [
    {
      id: 'parts',
      check: (c) => {
        for (const [m, n] of [[M.pulseSource, 'pulseSource'], [M.resistor, 'resistor'], [M.capacitor, 'capacitor']] as const) {
          const r = need(c, m, n);
          if (isResult(r)) return r;
        }
        return pass();
      },
    },
    {
      id: 'wired',
      check: (c) => {
        const src = c.parts(M.pulseSource)[0];
        return src && rcNetwork(c, src) ? pass() : fail('note:rcWiring');
      },
    },
    {
      id: 'scope',
      check: (c) => {
        const src = c.parts(M.pulseSource)[0];
        const net = src ? rcNetwork(c, src) : null;
        const sc = need(c, M.scope, 'scope');
        if (isResult(sc)) return sc;
        const on = net && sc.some((s) => Object.values(c.instrument(s)?.channels ?? {}).some((ch) => ch.kind === 'voltage' && ch.pos === net.out));
        return on ? pass() : fail('note:scopeOnCap');
      },
    },
    {
      id: 'tau',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const src = need(c, M.pulseSource, 'pulseSource');
          if (isResult(src)) return src;
          const net = rcNetwork(c, src[0]);
          if (!net) return fail('note:rcWiring');
          const tau = c.num(net.r, 'value') * c.num(net.cap, 'value');
          if (!(tau >= 1e-6 && tau <= 2)) return fail('note:tauRange', { tau: fmt(tau, 's') });
          const delay = c.num(src[0], 'delay') || 0;
          if (c.num(src[0], 'width') < 3 * tau) return fail('note:pulseShort', { tau: fmt(tau, 's') });
          const v1 = c.num(src[0], 'v1');
          const v2 = c.num(src[0], 'v2');
          const tr = await c.tran(delay + 2 * tau, tau / 200, tau / 50);
          const r = measured(tr.at(net.out, delay + tau), v1 + 0.632 * (v2 - v1), 5, 'V');
          return r.ok ? pass('note:tauOk', { tau: fmt(tau, 's'), value: fmt(tr.at(net.out, delay + tau), 'V') }) : r;
        }),
    },
  ],
  quiz: [
    { id: 'tau', options: 3, answer: 1 },
    { id: 'fiveTau', options: 4, answer: 3 },
    { id: 'doubleC', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 6. RC low-pass filter

const filterSource = (c: LessonCircuit): PartRef | undefined => c.parts(M.acSource)[0];

export const rcFilter: LessonDef = {
  id: 'rc-filter',
  level: 'basics',
  solution: () => rcBase('RC low-pass filter', true, 'ac'),
  steps: [
    {
      id: 'parts',
      check: (c) => {
        for (const [m, n] of [[M.acSource, 'acSource'], [M.resistor, 'resistor'], [M.capacitor, 'capacitor']] as const) {
          const r = need(c, m, n);
          if (isResult(r)) return r;
        }
        return pass();
      },
    },
    {
      id: 'lowpass',
      check: (c) => {
        const src = filterSource(c);
        return src && rcNetwork(c, src) ? pass() : fail('note:lowpassWiring');
      },
    },
    {
      id: 'fc',
      check: (c) => {
        const src = filterSource(c);
        const net = src ? rcNetwork(c, src) : null;
        if (!net) return fail('note:lowpassWiring');
        const fc = 1 / (2 * Math.PI * c.num(net.r, 'value') * c.num(net.cap, 'value'));
        return measured(fc, 1000, 10, 'Hz');
      },
    },
    {
      id: 'gain',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const src = filterSource(c);
          const net = src ? rcNetwork(c, src) : null;
          if (!src || !net) return fail('note:lowpassWiring');
          const fc = 1 / (2 * Math.PI * c.num(net.r, 'value') * c.num(net.cap, 'value'));
          const ac = await c.acAt(fc);
          const input = plusNet(c, src);
          const ref = c.net(src, '-') ?? c.net(src, 'COM') ?? '0';
          const a = ac.phasor(net.out);
          const vi = ac.phasor(input);
          const vr = ac.phasor(ref);
          const g = Math.hypot(a.re - vr.re, a.im - vr.im) / Math.hypot(vi.re - vr.re, vi.im - vr.im);
          const r = measured(g, Math.SQRT1_2, 5, '');
          return r.ok ? pass('note:filterGainOk', { gain: g.toFixed(3), fc: fmt(fc, 'Hz') }) : r;
        }),
    },
  ],
  quiz: [
    { id: 'atFc', options: 4, answer: 1 },
    { id: 'slope', options: 3, answer: 2 },
    { id: 'biggerR', options: 3, answer: 0 },
  ],
};
