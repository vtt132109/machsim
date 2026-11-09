/**
 * Op-amp and timer lessons: inverting and non-inverting amplifiers, the comparator and the 555
 * astable. Text: src/i18n/lessons/amps.ts.
 */
import type { LessonCircuit, PartRef } from '../circuit';
import { builder, fail, fmt, groundAt, inRange, isResult, M, measured, need, otherNet, p, pass, plusNet, setAnalyses, withSim } from '../kit';
import type { CheckResult, LessonDef } from '../types';

/** An op-amp / comparator whose supply pins (when it has them) are connected. */
function amplifier(c: LessonCircuit, match = M.opamp, what: 'opamp' | 'comparator' = 'opamp'): PartRef | CheckResult {
  const u = need(c, match, what);
  if (isResult(u)) return u;
  const ref = u[0];
  for (const pin of ['V+', 'V-']) if (ref.def.symbol.pins.some((x) => x.name === pin) && !c.pinConnected(ref, pin)) return fail('note:supplyPins');
  return ref;
}

// ---------------------------------------------------------------------------------------------
// 13. Inverting amplifier

function invertingLayout() {
  const b = builder('Inverting amplifier');
  const u1 = b.part('analog/opamp-ideal-3', 'U1', 400, 300);
  const rin = b.part('basic/resistor', 'RIN', 300, 290, { value: '1k' });
  const rf = b.part('basic/resistor', 'RF', 400, 220, { value: '10k' });
  const v1 = b.part('sources/dc-voltage', 'V1', 200, 320, { value: '0.5' });
  b.wire(b.pin(rin, '2'), b.pin(u1, 'IN-'));
  b.wire(b.pin(rf, '1'), p(345, 220), p(345, 290));
  b.wire(b.pin(u1, 'OUT'), p(500, 300));
  b.wire(b.pin(rf, '2'), p(460, 220), p(460, 300));
  b.wire(b.pin(u1, 'IN+'), p(350, 310), p(350, 350));
  b.part('sources/ground', 'GND1', 350, 350);
  b.wire(b.pin(v1, '+'), b.pin(rin, '1'));
  groundAt(b, v1, '-', 'GND2');
  b.label('OUT', 500, 300);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** The feedback resistor (OUT to IN−) and the input resistor (to IN−) of an inverting stage. */
function invertingNetwork(c: LessonCircuit, u: PartRef): { rf: PartRef; rin: PartRef; inNode: string } | null {
  const out = c.net(u, 'OUT');
  const inm = c.net(u, 'IN-');
  if (!out || !inm || out === inm) return null;
  const rs = c.parts(M.resistor);
  const rf = rs.find((r) => c.touches(r, out) && otherNet(c, r, out) === inm);
  const rin = rs.find((r) => r !== rf && c.touches(r, inm) && otherNet(c, r, inm) !== out);
  const inNode = rin ? otherNet(c, rin, inm) : undefined;
  return rf && rin && inNode ? { rf, rin, inNode } : null;
}

export const opampInverting: LessonDef = {
  id: 'opamp-inverting',
  level: 'amplifiers',
  solution: invertingLayout,
  steps: [
    {
      id: 'opamp',
      check: (c) => {
        const u = amplifier(c);
        return isResult(u) ? u : pass();
      },
    },
    {
      id: 'plusGround',
      check: (c) => {
        const u = amplifier(c);
        if (isResult(u)) return u;
        return c.net(u, 'IN+') === '0' ? pass() : fail('note:plusToGround');
      },
    },
    {
      id: 'feedback',
      check: (c) => {
        const u = amplifier(c);
        if (isResult(u)) return u;
        return invertingNetwork(c, u) ? pass() : fail('note:feedbackNet');
      },
    },
    {
      id: 'gain',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const u = amplifier(c);
          if (isResult(u)) return u;
          const n = invertingNetwork(c, u);
          if (!n) return fail('note:feedbackNet');
          const op = await c.op();
          const vin = op.v(n.inNode);
          if (!(Math.abs(vin) >= 0.05)) return fail('note:needInput');
          const g = op.v(c.net(u, 'OUT')) / vin;
          const r = measured(g, -10, 3, '');
          return r.ok ? pass('note:gainOk', { gain: g.toFixed(2), vout: fmt(op.v(c.net(u, 'OUT')), 'V') }) : fail('note:gainWrong', { gain: g.toFixed(2) });
        }),
    },
  ],
  quiz: [
    { id: 'gain', options: 3, answer: 2 },
    { id: 'virtualGround', options: 3, answer: 0 },
    { id: 'inputR', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 14. Non-inverting amplifier and follower

function nonInvertingLayout(follower: boolean) {
  const b = builder('Non-inverting amplifier');
  const u1 = b.part('analog/opamp-ideal-3', 'U1', 400, 300);
  const v1 = b.part('sources/dc-voltage', 'V1', 240, 360, { value: '0.3' });
  b.wire(b.pin(v1, '+'), p(240, 310), b.pin(u1, 'IN+'));
  groundAt(b, v1, '-', 'GND1');
  b.wire(b.pin(u1, 'OUT'), p(520, 300));
  if (follower) {
    b.wire(b.pin(u1, 'IN-'), p(340, 290), p(340, 230), p(470, 230), p(470, 300));
  } else {
    const rf = b.part('basic/resistor', 'RF', 410, 230, { value: '10k' });
    const rg = b.part('basic/resistor', 'RG', 340, 170, { value: '1k' }, { rotation: 90 });
    b.wire(b.pin(rg, '2'), p(340, 290), b.pin(u1, 'IN-'));
    b.wire(b.pin(rf, '1'), p(340, 230));
    b.wire(b.pin(rf, '2'), p(470, 230), p(470, 300));
    b.wire(b.pin(rg, '1'), p(340, 120), p(290, 120), p(290, 140));
    b.part('sources/ground', 'GND2', 290, 140);
  }
  b.label('OUT', 520, 300);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

export const opampNonInverting: LessonDef = {
  id: 'opamp-noninverting',
  level: 'amplifiers',
  solution: () => nonInvertingLayout(false),
  variants: { follower: () => nonInvertingLayout(true) },
  steps: [
    {
      id: 'input',
      check: (c) => {
        const u = amplifier(c);
        if (isResult(u)) return u;
        const plus = c.net(u, 'IN+');
        const src = [...c.parts(M.dcSource), ...c.parts(M.acSource)].find((s) => plusNet(c, s) === plus);
        return src && plus !== '0' ? pass() : fail('note:sourceToPlus');
      },
    },
    {
      id: 'network',
      check: (c) => {
        const u = amplifier(c);
        if (isResult(u)) return u;
        const out = c.net(u, 'OUT');
        const inm = c.net(u, 'IN-');
        const rs = c.parts(M.resistor);
        const rf = inm && out && rs.some((r) => c.touches(r, out) && otherNet(c, r, out) === inm);
        const rg = inm && rs.some((r) => c.touches(r, inm) && otherNet(c, r, inm) === '0');
        return rf && rg ? pass() : fail('note:dividerFeedback');
      },
    },
    {
      id: 'gain',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const u = amplifier(c);
          if (isResult(u)) return u;
          const op = await c.op();
          const vin = op.v(c.net(u, 'IN+'));
          if (!(Math.abs(vin) >= 0.05)) return fail('note:needInput');
          const g = op.v(c.net(u, 'OUT')) / vin;
          return measured(g, 11, 3, '').ok ? pass('note:gainOk', { gain: g.toFixed(2), vout: fmt(op.v(c.net(u, 'OUT')), 'V') }) : fail('note:gainWrong', { gain: g.toFixed(2) });
        }),
    },
    {
      id: 'follower',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const u = amplifier(c);
          if (isResult(u)) return u;
          if (c.net(u, 'OUT') !== c.net(u, 'IN-')) return fail('note:outToMinus');
          const op = await c.op();
          const vin = op.v(c.net(u, 'IN+'));
          if (!(Math.abs(vin) >= 0.05)) return fail('note:needInput');
          const g = op.v(c.net(u, 'OUT')) / vin;
          return measured(g, 1, 2, '').ok ? pass('note:followerOk', { gain: g.toFixed(3) }) : fail('note:gainWrong', { gain: g.toFixed(3) });
        }),
    },
  ],
  quiz: [
    { id: 'gain', options: 3, answer: 0 },
    { id: 'phase', options: 3, answer: 1 },
    { id: 'follower', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 15. Comparator

function comparatorLayout(vin: string) {
  const b = builder('Comparator');
  const u1 = b.part('analog/comparator', 'U1', 400, 300);
  const v1 = b.part('sources/dc-voltage', 'V1', 220, 360, { value: vin });
  const vcc = b.part('sources/dc-voltage', 'V2', 100, 220, { value: '5' });
  const r1 = b.part('basic/resistor', 'R1', 300, 120, { value: '10k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 300, 220, { value: '10k' }, { rotation: 90 });
  b.wire(b.pin(vcc, '+'), p(100, 60), p(400, 60), b.pin(u1, 'V+'));
  b.wire(p(300, 60), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(r2, '2'), p(300, 260));
  b.part('sources/ground', 'GND1', 300, 260);
  b.wire(p(300, 170), p(340, 170), p(340, 310), b.pin(u1, 'IN-'));
  b.wire(b.pin(v1, '+'), p(220, 290), b.pin(u1, 'IN+'));
  groundAt(b, v1, '-', 'GND2');
  groundAt(b, vcc, '-', 'GND3');
  groundAt(b, u1, 'V-', 'GND4');
  const led = b.part('indicators/probe-red', 'X1', 500, 300);
  b.wire(b.pin(u1, 'OUT'), b.pin(led, '1'));
  b.label('REF', 300, 170);
  b.label('OUT', 470, 300);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

async function comparatorState(c: LessonCircuit): Promise<CheckResult | { plus: number; minus: number; out: number }> {
  const u = amplifier(c, M.comparator, 'comparator');
  if (isResult(u)) return u;
  const op = await c.op();
  return { plus: op.v(c.net(u, 'IN+')), minus: op.v(c.net(u, 'IN-')), out: op.v(c.net(u, 'OUT')) };
}

export const comparator: LessonDef = {
  id: 'comparator',
  level: 'amplifiers',
  solution: () => comparatorLayout('3'),
  variants: { low: () => comparatorLayout('2') },
  steps: [
    {
      id: 'parts',
      check: (c) => {
        const u = amplifier(c, M.comparator, 'comparator');
        return isResult(u) ? u : pass();
      },
    },
    {
      id: 'reference',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const u = amplifier(c, M.comparator, 'comparator');
          if (isResult(u)) return u;
          const minus = c.net(u, 'IN-');
          if (!minus || c.parts(M.resistor).filter((r) => c.touches(r, minus)).length < 2) return fail('note:refDivider');
          return inRange((await c.op()).v(minus), 2.375, 2.625, 'V');
        }),
    },
    {
      id: 'high',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await comparatorState(c);
          if (isResult(s)) return s;
          if (!(s.plus > s.minus + 0.05)) return fail('note:raiseInput', { value: fmt(s.plus, 'V') });
          return s.out > 3 ? pass('note:outHigh', { value: fmt(s.out, 'V') }) : fail('note:outNotHigh', { value: fmt(s.out, 'V') });
        }),
    },
    {
      id: 'low',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const s = await comparatorState(c);
          if (isResult(s)) return s;
          if (!(s.plus < s.minus - 0.05)) return fail('note:lowerInput', { value: fmt(s.plus, 'V') });
          return s.out < 1 ? pass('note:outLow', { value: fmt(s.out, 'V') }) : fail('note:outNotLow', { value: fmt(s.out, 'V') });
        }),
    },
  ],
  quiz: [
    { id: 'rule', options: 3, answer: 0 },
    { id: 'reference', options: 3, answer: 2 },
    { id: 'hysteresis', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 16. 555 astable

function timerLayout() {
  const b = builder('555 astable');
  const u1 = b.part('analog/555', 'U1', 400, 300);
  const v1 = b.part('sources/dc-voltage', 'V1', 160, 300, { value: '5' });
  const r1 = b.part('basic/resistor', 'R1', 520, 200, { value: '1k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 520, 360, { value: '6.8k' }, { rotation: 90 });
  const c1 = b.part('basic/capacitor', 'C1', 300, 440, { value: '100n' }, { rotation: 90 });
  // supply rail y = 140
  b.wire(b.pin(v1, '+'), p(160, 140), p(520, 140), b.pin(r1, '1'));
  b.wire(b.pin(u1, 'RST'), p(390, 140));
  b.wire(b.pin(u1, 'VCC'), p(410, 140));
  // timing network: R1 - DIS - R2 - THR/TRIG - C1
  b.wire(b.pin(r1, '2'), b.pin(r2, '1'));
  b.wire(b.pin(u1, 'DIS'), p(520, 310));
  b.wire(b.pin(r2, '2'), p(520, 410), b.pin(c1, '1'));
  b.wire(b.pin(u1, 'THR'), p(330, 300), p(330, 410));
  b.wire(b.pin(u1, 'TRIG'), p(330, 280), p(330, 300));
  // ground rail y = 500
  b.wire(b.pin(c1, '2'), p(300, 500), p(160, 500));
  b.wire(b.pin(v1, '-'), p(160, 500));
  b.wire(b.pin(u1, 'GND'), p(400, 500), p(300, 500));
  b.part('sources/ground', 'GND1', 160, 500);
  b.labelPin(u1, 'OUT', 'OUT');
  const xsc = b.part('instruments/scope', 'XSC1', 660, 160, { timebase: '500u', 'A.scale': '2', 'trig.source': 'A', 'trig.level': '2.5' });
  b.labelPin(xsc, 'A+', 'OUT');
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 2e-6, tstop: 6e-3 }]);
}

/** The 555's timing network: R1 from VCC to DIS, R2 from DIS to THR, C from THR to ground. */
function timingNetwork(c: LessonCircuit, u: PartRef): { r1: PartRef; r2: PartRef; cap: PartRef } | null {
  const vcc = c.net(u, 'VCC');
  const dis = c.net(u, 'DIS');
  const thr = c.net(u, 'THR');
  if (!vcc || !dis || !thr || dis === thr) return null;
  const rs = c.parts(M.resistor);
  const r1 = rs.find((r) => c.touches(r, vcc) && otherNet(c, r, vcc) === dis);
  const r2 = rs.find((r) => c.touches(r, dis) && otherNet(c, r, dis) === thr);
  const cap = c.parts(M.capacitor).find((x) => c.touches(x, thr) && otherNet(c, x, thr) === '0');
  return r1 && r2 && cap ? { r1, r2, cap } : null;
}

export const timer555: LessonDef = {
  id: 'timer555',
  level: 'amplifiers',
  solution: timerLayout,
  steps: [
    {
      id: 'power',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const u = need(c, M.timer, 'timer');
          if (isResult(u)) return u;
          if (c.net(u[0], 'GND') !== '0') return fail('note:gndPin');
          const op = await c.op();
          if (!(op.v(c.net(u[0], 'VCC')) >= 4.5)) return fail('note:vccPin');
          return op.v(c.net(u[0], 'RST')) >= 4 ? pass() : fail('note:resetHigh');
        }),
    },
    {
      id: 'timingCap',
      check: (c) => {
        const u = need(c, M.timer, 'timer');
        if (isResult(u)) return u;
        const thr = c.net(u[0], 'THR');
        if (!thr || thr !== c.net(u[0], 'TRIG')) return fail('note:joinThrTrig');
        return c.parts(M.capacitor).some((x) => c.touches(x, thr) && otherNet(c, x, thr) === '0') ? pass() : fail('note:timingCap');
      },
    },
    {
      id: 'resistors',
      check: (c) => {
        const u = need(c, M.timer, 'timer');
        if (isResult(u)) return u;
        return timingNetwork(c, u[0]) ? pass() : fail('note:timingResistors');
      },
    },
    {
      id: 'frequency',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const u = need(c, M.timer, 'timer');
          if (isResult(u)) return u;
          const net = timingNetwork(c, u[0]);
          if (!net) return fail('note:timingResistors');
          const predicted = 1.44 / ((c.num(net.r1, 'value') + 2 * c.num(net.r2, 'value')) * c.num(net.cap, 'value'));
          if (!(predicted > 0.1 && predicted < 1e5)) return fail('note:freqRange', { value: fmt(predicted, 'Hz') });
          const period = 1 / predicted;
          const tr = await c.tran(7 * period, period / 400, period / 100);
          const out = c.net(u[0], 'OUT');
          const vcc = (await c.op()).v(c.net(u[0], 'VCC'));
          const f = tr.frequency(out, vcc / 2, 1.5 * period);
          const r = measured(f, 1000, 10, 'Hz');
          return r.ok ? pass('note:freqOk', { value: fmt(f, 'Hz'), predicted: fmt(predicted, 'Hz') }) : fail('note:freqWrong', { value: fmt(f, 'Hz'), predicted: fmt(predicted, 'Hz') });
        }),
    },
  ],
  quiz: [
    { id: 'formula', options: 3, answer: 1 },
    { id: 'biggerC', options: 3, answer: 0 },
    { id: 'duty', options: 3, answer: 2 },
  ],
};
