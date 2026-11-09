/**
 * Lessons built on the features of round 3: reusable circuit stages (snippets), assembly variants,
 * automatic measurements with `.meas`, the resonance of a real capacitor, the control-function
 * blocks (hysteresis, transfer function H(s)), a real logic IC with four gates in one package, a
 * real 74LS74 flip-flop, an 8051 reading a push-button, and a ladder traffic light.
 *
 * The solutions are drawn with net labels rather than long wires (DesignBuilder.labelPin), which
 * keeps them short and makes them read the same way the checks do: by net. Text:
 * src/i18n/lessons/round3.ts.
 */
import { compileLadder, type BitRef } from '../../ladder/program';
import { LadderMachine } from '../../ladder/machine';
import type { LadderRung } from '../../ladder/types';
import { asLibraryPart } from '../../library/partkit';
import { buildProgram } from '../../mcu/program';
import { setFitted } from '../../model/variants';
import type { Design } from '../../model/types';
import { parseUserNumber } from '../../util/units';
import type { LessonCircuit, PartRef, SimValues } from '../circuit';
import { logicIds, pickFlipflop, pickGate, heldAsync, gateUnits } from '../gates';
import { builder, fail, fmt, inRange, isResult, M, measured, near, need, noun, pass, plusNet, setAnalyses, withSim } from '../kit';
import type { CheckResult, LessonDef } from '../types';

/** Real AND packages (7408 in every 74 family, the 4081, and their single-gate sections). */
const AND_PACKAGES = logicIds('08', ['cmos/4081']);
/** Real dual D flip-flops (74x74 and the 4013). */
const FF_PACKAGES = logicIds('74', ['cmos/4013']);

/**
 * Mark pins of a placed part as "not connected" (the NC markers of round 3 step 7). The lesson
 * solutions use them for the outputs of the sections nobody wired, so ERC stays quiet about pins
 * that are meant to stay open.
 */
function markNc(design: Design, refdes: string, pins: string[]): Design {
  for (const sheet of design.sheets) for (const inst of sheet.parts) if (inst.refdes === refdes) inst.ncPins = pins;
  return design;
}

/** |V(a)| of an AC result. */
const mag = (v: SimValues, net: string | undefined): number => {
  const p = v.phasor(net);
  return Math.hypot(p.re, p.im);
};

/** Ratio |V(out)| / |V(in)| of an AC result (0 when the input is dead). */
function acRatio(v: SimValues, out: string | undefined, input: string | undefined): number {
  const vin = mag(v, input);
  return vin > 1e-12 ? mag(v, out) / vin : 0;
}

/** Nets of a design level with the refdes of every part pin on them. */
function netPins(c: LessonCircuit, node: string | undefined): { refdes: string; pin: string }[] {
  if (!node) return [];
  return c.build.nets.find((n) => n.name === node)?.pins ?? [];
}

// ---------------------------------------------------------------------------------------------
// 1. Two identical RC stages (snippets)

const TAU_RC = 159e-9 * 1000;

function rcStagesDesign(): Design {
  const b = builder('Two RC stages');
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1k' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const r1 = b.part('basic/resistor', 'R1', 240, 160, { value: '1k' });
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'MID');
  const c1 = b.part('basic/capacitor', 'C1', 340, 240, { value: '159n' }, { rotation: 90 });
  b.labelPin(c1, '1', 'MID');
  b.labelPin(c1, '2', '0');
  const r2 = b.part('basic/resistor', 'R2', 460, 160, { value: '1k' });
  b.labelPin(r2, '1', 'MID');
  b.labelPin(r2, '2', 'OUT');
  const c2 = b.part('basic/capacitor', 'C2', 560, 240, { value: '159n' }, { rotation: 90 });
  b.labelPin(c2, '1', 'OUT');
  b.labelPin(c2, '2', '0');
  return setAnalyses(b.design, 'acsingle', [{ type: 'acsingle', freq: 1000 }]);
}

/** The RC product of the k-th resistor / capacitor pair that share a net. */
function rcPairs(c: LessonCircuit): { r: PartRef; cap: PartRef; tau: number }[] {
  const out: { r: PartRef; cap: PartRef; tau: number }[] = [];
  for (const r of c.parts(M.resistor)) {
    for (const cap of c.parts(M.capacitor)) {
      const shared = c.pinNets(r).some((n) => n && c.pinNets(cap).includes(n));
      if (shared) out.push({ r, cap, tau: c.num(r, 'value') * c.num(cap, 'value') });
    }
  }
  return out;
}

export const rcStages: LessonDef = {
  id: 'rc-stages',
  level: 'workflow',
  solution: rcStagesDesign,
  steps: [
    {
      id: 'stages',
      check: (c) => {
        const rs = need(c, M.resistor, 'resistor', 2);
        if (isResult(rs)) return rs;
        const cs = need(c, M.capacitor, 'capacitor', 2);
        if (isResult(cs)) return cs;
        const pairs = rcPairs(c);
        if (pairs.length < 2) return fail('note:twoStages');
        const taus = pairs.map((x) => x.tau).filter((x) => Number.isFinite(x) && x > 0);
        if (taus.length < 2) return fail('note:twoStages');
        const same = taus.every((x) => near(x, taus[0], 10));
        return same ? pass('note:stagesSame', { tau: fmt(taus[0], 's') }) : fail('note:stagesDiffer');
      },
    },
    {
      id: 'cascade',
      check: (c) => {
        const rs = c.parts(M.resistor).map((x) => x.inst.refdes);
        const cs = c.parts(M.capacitor).map((x) => x.inst.refdes);
        for (const net of c.build.nets) {
          const r = net.pins.filter((p) => rs.includes(p.refdes)).length;
          const k = net.pins.filter((p) => cs.includes(p.refdes)).length;
          if (r >= 2 && k >= 1) return pass('note:cascadeOk');
        }
        return fail('note:cascade');
      },
    },
    {
      id: 'labels',
      check: (c) => {
        const missing = ['IN', 'OUT'].filter((n) => !c.namedNet(n));
        return missing.length ? fail('note:needLabels2', { names: missing.join(', ') }) : pass();
      },
    },
    {
      id: 'twice',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const input = c.namedNet('IN');
          const out = c.namedNet('OUT');
          if (!input || !out) return fail('note:needLabels2', { names: 'IN, OUT' });
          const pairs = rcPairs(c);
          const tau = pairs.length ? pairs[0].tau : TAU_RC;
          const fc = 1 / (2 * Math.PI * tau);
          const v = await c.acAt(fc);
          const ratio = acRatio(v, out, input);
          const r = inRange(ratio, 0.25, 0.62, '');
          return r.ok ? pass('note:twiceOk', { value: ratio.toFixed(3), fc: fmt(fc, 'Hz') }) : fail('note:twiceWrong', { value: ratio.toFixed(3), fc: fmt(fc, 'Hz') });
        }),
    },
  ],
  quiz: [
    { id: 'slope', options: 3, answer: 2 },
    { id: 'snippet', options: 3, answer: 1 },
    { id: 'loading', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 2. Two assembly variants of one board

function variantDesign(): Design {
  const b = builder('Two assembly variants');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '9' });
  b.labelPin(v1, '+', 'P9');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const r1 = b.part('basic/resistor', 'R1', 260, 160, { value: '470' });
  b.labelPin(r1, '1', 'P9');
  b.labelPin(r1, '2', 'A1');
  const d1 = b.part('diodes/led-red', 'D1', 380, 160);
  b.labelPin(d1, 'A', 'A1');
  b.labelPin(d1, 'K', '0');
  const r2 = b.part('basic/resistor', 'R2', 260, 260, { value: '470' });
  b.labelPin(r2, '1', 'P9');
  b.labelPin(r2, '2', 'A2');
  const d2 = b.part('diodes/led-red', 'D2', 380, 260);
  b.labelPin(d2, 'A', 'A2');
  b.labelPin(d2, 'K', '0');
  const d = setAnalyses(b.design, 'op', [{ type: 'op' }]);
  d.variants = {
    list: [
      { id: 'full', name: 'Phương án 1' },
      { id: 'lite', name: 'Phương án 2' },
    ],
    active: 'lite',
  };
  const ids: string[] = [];
  for (const sheet of d.sheets) for (const inst of sheet.parts) if (inst.refdes === 'D2' || inst.refdes === 'R2') ids.push(inst.id);
  return setFitted(d, ids, 'lite', false);
}

/** Placed parts that the given variant leaves off the board. */
function notFittedIn(c: LessonCircuit, variantId: string): PartRef[] {
  return c
    .parts({ families: ['LED', 'Resistor'], prefixes: [''] })
    .filter((r) => (r.inst.notFitted ?? []).includes(variantId));
}

export const variantBoards: LessonDef = {
  id: 'variant-boards',
  level: 'workflow',
  solution: variantDesign,
  steps: [
    {
      id: 'two',
      check: (c) => {
        const list = c.design.variants?.list ?? [];
        return list.length >= 2 ? pass('note:variantsOk', { n: list.length }) : fail('note:needVariants');
      },
    },
    {
      id: 'fitted',
      check: (c) => {
        const list = c.design.variants?.list ?? [];
        if (list.length < 2) return fail('note:needVariants');
        const hit = list.find((v) => notFittedIn(c, v.id).length > 0);
        return hit ? pass('note:notFittedOk', { name: hit.name, n: notFittedIn(c, hit.id).length }) : fail('note:needNotFitted');
      },
    },
    {
      id: 'active',
      check: (c) => {
        const list = c.design.variants?.list ?? [];
        const active = list.find((v) => v.id === c.design.variants?.active) ?? list[0];
        if (!active) return fail('note:needVariants');
        return notFittedIn(c, active.id).length ? pass('note:activeOk', { name: active.name }) : fail('note:needActive');
      },
    },
    {
      id: 'dark',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const list = c.design.variants?.list ?? [];
          const active = list.find((v) => v.id === c.design.variants?.active) ?? list[0];
          if (!active) return fail('note:needVariants');
          const leds = c.parts(M.led);
          if (leds.length < 2) return fail('needCount', { part: noun('led'), n: 2, have: leds.length });
          const op = await c.op();
          const off = leds.filter((d) => (d.inst.notFitted ?? []).includes(active.id));
          const on = leds.filter((d) => !(d.inst.notFitted ?? []).includes(active.id));
          if (!off.length) return fail('note:needActive');
          const dark = off.every((d) => {
            const i = c.current(op, d);
            return !Number.isFinite(i) || Math.abs(i) < 1e-9;
          });
          const lit = on.some((d) => c.current(op, d) > 1e-3);
          if (!dark) return fail('note:stillLit');
          return lit ? pass('note:darkOk', { name: active.name }) : fail('note:noneLit');
        }),
    },
  ],
  quiz: [
    { id: 'what', options: 3, answer: 1 },
    { id: 'bom', options: 3, answer: 2 },
    { id: 'sim', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 3. Automatic measurements with .meas

function measDesign(): Design {
  const b = builder('Automatic .meas measurement');
  const v1 = b.part('sources/pulse-voltage', 'V1', 100, 220, { v1: '0', v2: '5', width: '10m', period: '20m', rise: '1n', fall: '1n' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const r1 = b.part('basic/resistor', 'R1', 260, 160, { value: '10k' });
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  const c1 = b.part('basic/capacitor', 'C1', 380, 240, { value: '10n' }, { rotation: 90 });
  b.labelPin(c1, '1', 'OUT');
  b.labelPin(c1, '2', '0');
  const d = setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 1e-6, tstop: 2e-3 }]);
  d.customSpice = '.meas tran t63 WHEN V(OUT)=3.1606';
  return d;
}

/** The time constant of the first resistor / capacitor pair that share a net. */
function tauOf(c: LessonCircuit): number {
  const pairs = rcPairs(c);
  return pairs.length ? pairs[0].tau : NaN;
}

export const measRise: LessonDef = {
  id: 'meas-rise',
  level: 'workflow',
  solution: measDesign,
  steps: [
    {
      id: 'rc',
      check: (c) => {
        const r = need(c, M.resistor, 'resistor');
        if (isResult(r)) return r;
        const k = need(c, M.capacitor, 'capacitor');
        if (isResult(k)) return k;
        const tau = tauOf(c);
        if (!(tau > 0)) return fail('note:twoStages');
        if (!c.namedNet('OUT')) return fail('note:needLabels2', { names: 'OUT' });
        return inRange(tau, 1e-6, 1e-2, 's').ok ? pass('note:tauIs', { tau: fmt(tau, 's') }) : fail('note:tauOutOfRange', { tau: fmt(tau, 's') });
      },
    },
    {
      id: 'card',
      check: (c) => {
        const text = c.design.customSpice ?? '';
        const m = /^[ \t]*\.meas(?:ure)?\s+tran\s+(\w+)/im.exec(text);
        if (!m) return fail('note:needMeasCard');
        return /when|trig|at\b|find/i.test(text) ? pass('note:measCardOk', { name: m[1] }) : fail('note:measCardWhat');
      },
    },
    {
      id: 'value',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const tau = tauOf(c);
          const text = c.design.customSpice ?? '';
          const m = /^[ \t]*\.meas(?:ure)?\s+tran\s+(\w+)/im.exec(text);
          if (!m) return fail('note:needMeasCard');
          const tr = await c.tran(Math.max(5 * tau, 1e-4), Math.max(tau / 200, 1e-9));
          const got = tr.measurement(m[1]);
          if (got === undefined || !Number.isFinite(got)) return fail('note:measFailed', { name: m[1] });
          const r = measured(got, tau, 5, 's');
          return r.ok ? pass('note:measOk', { name: m[1], value: fmt(got, 's'), tau: fmt(tau, 's') }) : r;
        }),
    },
  ],
  quiz: [
    { id: 'what', options: 3, answer: 0 },
    { id: 'when', options: 3, answer: 2 },
    { id: 'where', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 4. A real capacitor resonates

function realCapDesign(): Design {
  const b = builder('A real capacitor resonates');
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1M' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const rs = b.part('basic/resistor', 'RS', 260, 160, { value: '1' });
  b.labelPin(rs, '1', 'IN');
  b.labelPin(rs, '2', 'CAP');
  const cx = b.part('basic/nonideal-capacitor', 'C1', 400, 240, { value: '100n', esr: '30m', esl: '2n' }, { rotation: 90 });
  b.labelPin(cx, '1', 'CAP');
  b.labelPin(cx, '2', '0');
  return setAnalyses(b.design, 'ac', [{ type: 'ac', fstart: 1e3, fstop: 1e8, points: 40, sweep: 'dec' }]);
}

/** The non-ideal capacitor and its self-resonance frequency from the learner's own values. */
function realCap(c: LessonCircuit): { ref: PartRef; f0: number; esr: number } | CheckResult {
  const found = c.parts({ ids: ['basic/nonideal-capacitor', 'basic/nonideal-electrolytic'], families: ['Capacitor (non-ideal)'] });
  if (!found.length) return fail('note:needRealCap');
  const ref = found[0];
  const cap = c.num(ref, 'value');
  const esl = c.num(ref, 'esl');
  const esr = c.num(ref, 'esr');
  if (!(cap > 0) || !(esl > 0)) return fail('note:needEsl');
  return { ref, f0: 1 / (2 * Math.PI * Math.sqrt(esl * cap)), esr };
}

export const realCapacitor: LessonDef = {
  id: 'real-capacitor',
  level: 'basics',
  solution: realCapDesign,
  steps: [
    {
      id: 'part',
      check: (c) => {
        const r = realCap(c);
        if (isResult(r)) return r;
        if (!c.namedNet('CAP') || !c.namedNet('IN')) return fail('note:needLabels2', { names: 'IN, CAP' });
        return pass('note:f0Is', { f0: fmt(r.f0, 'Hz') });
      },
    },
    {
      id: 'lowFreq',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const r = realCap(c);
          if (isResult(r)) return r;
          const v = await c.acAt(r.f0 / 100);
          const ratio = acRatio(v, c.namedNet('CAP'), c.namedNet('IN'));
          return ratio > 0.7 ? pass('note:lowFreqOk', { value: ratio.toFixed(3), f: fmt(r.f0 / 100, 'Hz') }) : fail('note:lowFreqBad', { value: ratio.toFixed(3) });
        }),
    },
    {
      id: 'resonance',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const r = realCap(c);
          if (isResult(r)) return r;
          const v = await c.acAt(r.f0);
          const ratio = acRatio(v, c.namedNet('CAP'), c.namedNet('IN'));
          return ratio < 0.2 ? pass('note:resonanceOk', { value: ratio.toFixed(3), f0: fmt(r.f0, 'Hz'), esr: fmt(r.esr, 'Ω') }) : fail('note:resonanceBad', { value: ratio.toFixed(3), f0: fmt(r.f0, 'Hz') });
        }),
    },
  ],
  quiz: [
    { id: 'why', options: 3, answer: 1 },
    { id: 'above', options: 3, answer: 2 },
    { id: 'floor', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 5. The hysteresis (Schmitt) block

function hysteresisDesign(): Design {
  const b = builder('Hysteresis block');
  const v1 = b.part('sources/pulse-voltage', 'V1', 100, 220, { v1: '0', v2: '5', rise: '0.5m', fall: '0.5m', width: '1u', period: '1m' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const h = b.part('analog/hysteresis', 'U1', 320, 200, { vlow: '1.5', vhigh: '3.5', ylow: '0', yhigh: '5' });
  b.labelPin(h, 'IN', 'IN');
  b.labelPin(h, 'OUT', 'OUT');
  const sc = b.part('instruments/scope', 'XSC1', 560, 180, { timebase: '0.2m', 'A.scale': '2', 'B.scale': '2', 'trig.source': 'A', 'trig.level': '2.5' });
  b.labelPin(sc, 'A+', 'IN');
  b.labelPin(sc, 'A-', '0');
  b.labelPin(sc, 'B+', 'OUT');
  b.labelPin(sc, 'B-', '0');
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 2e-6, tstop: 3e-3 }]);
}

function hystBlock(c: LessonCircuit): { ref: PartRef; vlow: number; vhigh: number } | CheckResult {
  const found = c.parts({ ids: ['analog/hysteresis'] });
  if (!found.length) return fail('note:needHyst');
  const ref = found[0];
  const vlow = c.num(ref, 'vlow');
  const vhigh = c.num(ref, 'vhigh');
  if (!(vhigh > vlow)) return fail('note:hystOrder');
  return { ref, vlow, vhigh };
}

/** Input level at every rising and falling edge of the output. */
function switchLevels(tr: SimValues, inNet: string | undefined, outNet: string | undefined, mid: number): { rise: number[]; fall: number[] } {
  const time = tr.time;
  const out = tr.wave(outNet);
  const rise: number[] = [];
  const fall: number[] = [];
  for (let i = 1; i < out.length; i++) {
    if (out[i - 1] <= mid && out[i] > mid) rise.push(tr.at(inNet, time[i]));
    if (out[i - 1] >= mid && out[i] < mid) fall.push(tr.at(inNet, time[i]));
  }
  return { rise, fall };
}

export const hysteresisBlock: LessonDef = {
  id: 'hysteresis-block',
  level: 'amplifiers',
  solution: hysteresisDesign,
  steps: [
    {
      id: 'block',
      check: (c) => {
        const h = hystBlock(c);
        if (isResult(h)) return h;
        return pass('note:hystIs', { vlow: fmt(h.vlow, 'V'), vhigh: fmt(h.vhigh, 'V') });
      },
    },
    {
      id: 'drive',
      check: (c) => {
        const h = hystBlock(c);
        if (isResult(h)) return h;
        if (!c.pinConnected(h.ref, 'IN')) return fail('note:hystIn');
        return c.pinConnected(h.ref, 'OUT') ? pass() : fail('note:hystOut');
      },
    },
    {
      id: 'levels',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const h = hystBlock(c);
          if (isResult(h)) return h;
          const inNet = c.net(h.ref, 'IN');
          const outNet = c.net(h.ref, 'OUT');
          const ylow = c.num(h.ref, 'ylow');
          const yhigh = c.num(h.ref, 'yhigh');
          const tr = await c.tran(3e-3, 2e-6);
          const { rise, fall } = switchLevels(tr, inNet, outNet, (ylow + yhigh) / 2);
          if (!rise.length || !fall.length) return fail('note:hystNoEdge');
          const tol = 0.1 * Math.max(1, h.vhigh - h.vlow) + 0.15;
          const upOk = rise.every((v) => Math.abs(v - h.vhigh) <= tol);
          const downOk = fall.every((v) => Math.abs(v - h.vlow) <= tol);
          if (upOk && downOk) return pass('note:hystOk', { up: fmt(rise[0], 'V'), down: fmt(fall[0], 'V') });
          return fail('note:hystWrong', { up: fmt(rise[0], 'V'), down: fmt(fall[0], 'V'), vhigh: fmt(h.vhigh, 'V'), vlow: fmt(h.vlow, 'V') });
        }),
    },
  ],
  quiz: [
    { id: 'why', options: 3, answer: 2 },
    { id: 'width', options: 3, answer: 0 },
    { id: 'use', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 6. The transfer-function block H(s)

const TAU_TF = 1 / (2 * Math.PI * 1000);

function transferDesign(): Design {
  const b = builder('Transfer function H(s)');
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1k' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const h = b.part('analog/transfer-function', 'U1', 320, 200, { form: 'coeff', num: '1', den: '159.155u 1', gain: '1' });
  b.labelPin(h, 'IN', 'IN');
  b.labelPin(h, 'OUT', 'OUT');
  // the block drives a load, so the output net is a real net and not a single pin
  const rl = b.part('basic/resistor', 'RL', 520, 260, { value: '1M' }, { rotation: 90 });
  b.labelPin(rl, '1', 'OUT');
  b.labelPin(rl, '2', '0');
  return setAnalyses(b.design, 'acsingle', [{ type: 'acsingle', freq: 1000 }]);
}

/** The first-order corner frequency of a transfer-function block, from its own coefficients. */
function tfBlock(c: LessonCircuit): { ref: PartRef; fc: number } | CheckResult {
  const found = c.parts({ ids: ['analog/transfer-function'] });
  if (!found.length) return fail('note:needTf');
  const ref = found[0];
  if (c.text(ref, 'form') !== 'coeff') return fail('note:tfCoeff');
  const den = c.text(ref, 'den').split(/[\s,]+/).filter(Boolean).map(parseUserNumber);
  const num = c.text(ref, 'num').split(/[\s,]+/).filter(Boolean).map(parseUserNumber);
  if (den.length !== 2 || num.length !== 1 || !den.every(Number.isFinite)) return fail('note:tfFirstOrder');
  const tau = den[0] / den[1];
  if (!(tau > 0)) return fail('note:tfFirstOrder');
  return { ref, fc: 1 / (2 * Math.PI * tau) };
}

export const transferBlock: LessonDef = {
  id: 'transfer-block',
  level: 'amplifiers',
  solution: transferDesign,
  steps: [
    {
      id: 'block',
      check: (c) => {
        const h = tfBlock(c);
        if (isResult(h)) return h;
        if (!c.pinConnected(h.ref, 'IN') || !c.pinConnected(h.ref, 'OUT')) return fail('note:tfWire');
        return pass('note:tfIs', { fc: fmt(h.fc, 'Hz') });
      },
    },
    {
      id: 'cutoff',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const h = tfBlock(c);
          if (isResult(h)) return h;
          const v = await c.acAt(h.fc);
          const ratio = acRatio(v, c.net(h.ref, 'OUT'), c.net(h.ref, 'IN'));
          const r = measured(ratio, Math.SQRT1_2, 4, '');
          return r.ok ? pass('note:tfCutoffOk', { fc: fmt(h.fc, 'Hz'), value: ratio.toFixed(3) }) : r;
        }),
    },
    {
      id: 'decade',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const h = tfBlock(c);
          if (isResult(h)) return h;
          const v = await c.acAt(10 * h.fc);
          const ratio = acRatio(v, c.net(h.ref, 'OUT'), c.net(h.ref, 'IN'));
          const db = 20 * Math.log10(Math.max(ratio, 1e-12));
          return db < -17 && db > -23 ? pass('note:tfDecadeOk', { db: db.toFixed(1), f: fmt(10 * h.fc, 'Hz') }) : fail('note:tfDecadeBad', { db: db.toFixed(1) });
        }),
    },
  ],
  quiz: [
    { id: 'order', options: 3, answer: 1 },
    { id: 'db', options: 3, answer: 2 },
    { id: 'dc', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 7. One 7408 package, two of its gates

function icPackageDesign(on3: boolean): Design {
  const b = builder('One IC, four gates');
  const u1 = b.part('ttl/7408', 'U1', 360, 220);
  const s1 = b.part('sources/logic-switch', 'S1', 120, 140, { state: 'true', key: 'A' });
  const s2 = b.part('sources/logic-switch', 'S2', 120, 220, { state: 'true', key: 'B' });
  const s3 = b.part('sources/logic-switch', 'S3', 120, 300, { state: on3 ? 'true' : 'false', key: 'C' });
  b.labelPin(s1, 'OUT', 'A');
  b.labelPin(s2, 'OUT', 'B');
  b.labelPin(s3, 'OUT', 'C');
  b.labelPin(u1, '1A', 'A');
  b.labelPin(u1, '1B', 'B');
  b.labelPin(u1, '1Y', 'AB');
  b.labelPin(u1, '2A', 'AB');
  b.labelPin(u1, '2B', 'C');
  b.labelPin(u1, '2Y', 'Y');
  const x1 = b.part('indicators/probe-red', 'X1', 600, 220);
  b.labelPin(x1, '1', 'Y');
  b.part('sources/vcc', 'VCC1', 360, 120, { voltage: '5' });
  b.labelPin(u1, '3A', '0');
  b.labelPin(u1, '3B', '0');
  b.labelPin(u1, '4A', '0');
  b.labelPin(u1, '4B', '0');
  // the two gates nobody uses: their inputs are tied low and their outputs are marked NC
  markNc(b.design, 'U1', ['3Y', '4Y']);
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** The two cascaded gates of one package: g1's output feeds one input of g2. */
function cascadedGates(c: LessonCircuit): { g1: GateUnitLike; g2: GateUnitLike } | CheckResult {
  const parts = c.parts({ ids: AND_PACKAGES });
  if (!parts.length) return fail('note:needRealAnd');
  for (const ref of parts) {
    const units = gateUnits(c, ref);
    for (const g1 of units) {
      const outNet = c.net(g1.ref, g1.out);
      if (!outNet) continue;
      for (const g2 of units) {
        if (g2 === g1) continue;
        if (g2.inputs.some((p) => c.net(g2.ref, p) === outNet)) return { g1, g2 };
      }
    }
  }
  return fail('note:needCascade');
}

type GateUnitLike = ReturnType<typeof gateUnits>[number];

export const icPackage: LessonDef = {
  id: 'ic-package',
  level: 'digital',
  solution: () => icPackageDesign(true),
  variants: { zero: () => icPackageDesign(false) },
  steps: [
    {
      id: 'realIc',
      check: (c) => {
        const parts = c.parts({ ids: AND_PACKAGES });
        if (!parts.length) return fail('note:needRealAnd');
        const gates = gateUnits(c, parts[0]).length;
        return gates >= 2 ? pass('note:packageIs', { name: parts[0].def.name, n: gates }) : pass('note:sectionIs', { name: parts[0].def.name });
      },
    },
    {
      id: 'cascade',
      check: (c) => {
        const r = cascadedGates(c);
        if (isResult(r)) return r;
        const open = [...r.g1.inputs, ...r.g2.inputs].filter((p) => !c.pinConnected(r.g1.ref, p));
        return open.length ? fail('note:inputOpen', { pin: open.join(', ') }) : pass('note:cascadeGatesOk');
      },
    },
    {
      id: 'allOn',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const r = cascadedGates(c);
          if (isResult(r)) return r;
          const op = await c.op();
          const inputs = [...r.g1.inputs, ...r.g2.inputs].filter((p) => c.net(r.g2.ref, p) !== c.net(r.g1.ref, r.g1.out));
          const levels = inputs.map((p) => op.v(c.net(r.g1.ref, p)));
          if (!levels.every((v) => v > 2.5)) return fail('note:setInputsHigh');
          const y = op.v(c.net(r.g2.ref, r.g2.out));
          return y > 2.5 ? pass('note:outOne', { value: fmt(y, 'V') }) : fail('note:outNotOne', { value: fmt(y, 'V') });
        }),
    },
    {
      id: 'zero',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const r = cascadedGates(c);
          if (isResult(r)) return r;
          const op = await c.op();
          const inputs = [...r.g1.inputs, ...r.g2.inputs].filter((p) => c.net(r.g2.ref, p) !== c.net(r.g1.ref, r.g1.out));
          const levels = inputs.map((p) => op.v(c.net(r.g1.ref, p)));
          if (!levels.some((v) => v < 0.8)) return fail('note:setInputLow');
          const y = op.v(c.net(r.g2.ref, r.g2.out));
          return y < 0.8 ? pass('note:outZero', { value: fmt(y, 'V') }) : fail('note:outNotZero', { value: fmt(y, 'V') });
        }),
    },
  ],
  quiz: [
    { id: 'sections', options: 3, answer: 0 },
    { id: 'refdes', options: 3, answer: 1 },
    { id: 'spare', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 8. A real 74LS74 flip-flop dividing by two

function realFfDesign(): Design {
  const b = builder('74LS74 frequency divider');
  const u1 = b.part('ttl/7474', 'U1', 360, 220);
  const clk = b.part('sources/digital-clock', 'V1', 120, 220, { freq: '1k', vhigh: '5' });
  b.labelPin(clk, 'OUT', 'CLK');
  b.part('sources/vcc', 'VCC1', 360, 110, { voltage: '5' });
  b.labelPin(u1, '1CLK', 'CLK');
  b.labelPin(u1, '1PRE', 'VCC');
  b.labelPin(u1, '1CLR', 'VCC');
  b.labelPin(u1, '1D', 'QN');
  b.labelPin(u1, '1Q', 'Q');
  b.labelPin(u1, '1QN', 'QN');
  b.labelPin(u1, '2CLK', '0');
  b.labelPin(u1, '2D', '0');
  b.labelPin(u1, '2PRE', 'VCC');
  b.labelPin(u1, '2CLR', 'VCC');
  const sc = b.part('instruments/scope', 'XSC1', 620, 200, { timebase: '1m', 'A.scale': '5', 'B.scale': '5', 'trig.source': 'A', 'trig.level': '2.5' });
  b.labelPin(sc, 'A+', 'CLK');
  b.labelPin(sc, 'A-', '0');
  b.labelPin(sc, 'B+', 'Q');
  b.labelPin(sc, 'B-', '0');
  // the second flip-flop of the package is parked: its outputs are marked NC
  markNc(b.design, 'U1', ['2Q', '2QN']);
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
}

export const realFlipflop: LessonDef = {
  id: 'real-flipflop',
  level: 'digital',
  solution: realFfDesign,
  steps: [
    {
      id: 'ic',
      check: (c) => {
        const parts = c.parts({ ids: FF_PACKAGES });
        if (!parts.length) return fail('note:needRealFf');
        const f = pickFlipflop(c, { ids: FF_PACKAGES });
        return f ? pass('note:ffIs', { name: parts[0].def.name }) : fail('note:needRealFf');
      },
    },
    {
      id: 'async',
      check: (c) => {
        const f = pickFlipflop(c, { ids: FF_PACKAGES });
        if (!f) return fail('note:needRealFf');
        if (!f.asyncLow.length) return pass();
        const held = heldAsync(c, f);
        if (held.length) return fail('note:asyncLow', { pin: held.join(', ') });
        const wired = f.asyncLow.filter((p) => c.pinConnected(f.ref, p));
        return wired.length === f.asyncLow.length ? pass('note:asyncOk', { pin: f.asyncLow.join(', ') }) : fail('note:asyncOpen', { pin: f.asyncLow.filter((p) => !c.pinConnected(f.ref, p)).join(', ') });
      },
    },
    {
      id: 'toggle',
      check: (c) => {
        const f = pickFlipflop(c, { ids: FF_PACKAGES });
        if (!f) return fail('note:needRealFf');
        if (!c.parts(M.clock).some((k) => plusNet(c, k) === c.net(f.ref, f.clk))) return fail('note:clockToClk');
        if (!f.qn) return fail('note:qnToD');
        return c.net(f.ref, f.qn) === c.net(f.ref, f.d) ? pass() : fail('note:qnToD');
      },
    },
    {
      id: 'divide',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const f = pickFlipflop(c, { ids: FF_PACKAGES });
          if (!f) return fail('note:needRealFf');
          const clk = c.parts(M.clock).find((k) => plusNet(c, k) === c.net(f.ref, f.clk));
          if (!clk) return fail('note:clockToClk');
          const fclk = c.num(clk, 'freq') > 0 ? c.num(clk, 'freq') : 1 / c.num(clk, 'period');
          if (!(fclk > 0.5 && fclk < 1e7)) return fail('note:clockRange');
          const tr = await c.tran(12 / fclk, 1 / (fclk * 100));
          const got = tr.frequency(c.net(f.ref, f.q), 2.5, 1 / fclk);
          const r = measured(got, fclk / 2, 5, 'Hz');
          return r.ok ? pass('note:divided', { value: fmt(got, 'Hz'), clock: fmt(fclk, 'Hz') }) : r;
        }),
    },
  ],
  quiz: [
    { id: 'bar', options: 3, answer: 1 },
    { id: 'half', options: 3, answer: 0 },
    { id: 'unused', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 9. An 8051 reading a push-button

const BUTTON_PROGRAM = [
  '; Nút nhấn ở P1.0, LED ở P1.1 (LED treo từ +5 V qua điện trở xuống chân).',
  '; Nhấn nút thì P1.0 = 0; cho P1.1 = 0 để LED sáng.',
  '        ORG  0',
  'MAIN:   MOV  C,P1.0        ; đọc mức chân nút',
  '        MOV  P1.1,C        ; chép sang chân LED',
  '        SJMP MAIN',
  '        END',
].join('\n');

function mcuButtonDesign(): Design {
  const b = builder('8051 reads a push-button');
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 360, 240, { program: BUTTON_PROGRAM, fosc: '12M' });
  b.part('sources/vcc', 'VCC1', 620, 120, { voltage: '5' });
  const s1 = b.part('basic/push-button', 'S1', 160, 220, { pressed: 'true', key: 'B' });
  b.labelPin(s1, '1', 'BTN');
  b.labelPin(s1, '2', '0');
  b.labelPin(u1, 'P1.0', 'BTN');
  const d1 = b.part('diodes/led-red', 'D1', 620, 200, {}, { rotation: 90 });
  b.labelPin(d1, 'A', 'VCC');
  b.labelPin(d1, 'K', 'LEDK');
  const r1 = b.part('basic/resistor', 'R1', 620, 300, { value: '330' }, { rotation: 90 });
  b.labelPin(r1, '1', 'LEDK');
  b.labelPin(r1, '2', 'LED');
  b.labelPin(u1, 'P1.1', 'LED');
  b.part('sources/ground', 'GND1', 160, 340);
  b.wire(b.pin(s1, '2'), { x: 160, y: 340 });
  return setAnalyses(b.design, 'tran', [{ type: 'tran', tstep: 2e-5, tstop: 2e-3 }]);
}

/** The microcontroller, its program and the port pins the circuit uses. */
function mcuOf(c: LessonCircuit): { ref: PartRef } | CheckResult {
  const found = c.parts(M.mcu);
  if (!found.length) return fail('needPart', { part: noun('mcu') });
  return { ref: found[0] };
}

/** Port pins of an MCU that carry a wire, with the net they sit on. */
function portPins(c: LessonCircuit, ref: PartRef): { pin: string; net: string }[] {
  const out: { pin: string; net: string }[] = [];
  for (const p of ref.def.symbol.pins) {
    if (!/^P[0-3]\./.test(p.name)) continue;
    const net = c.net(ref, p.name);
    if (net && c.pinConnected(ref, p.name)) out.push({ pin: p.name, net });
  }
  return out;
}

export const mcuButton: LessonDef = {
  id: 'mcu-button',
  level: 'digital',
  solution: mcuButtonDesign,
  steps: [
    {
      id: 'button',
      check: (c) => {
        const m = mcuOf(c);
        if (isResult(m)) return m;
        const buttons = c.parts({ families: ['Switch'] });
        if (!buttons.length) return fail('note:needButton');
        const pins = portPins(c, m.ref);
        const hit = buttons.find((s) => c.pinNets(s).some((n) => pins.some((p) => p.net === n)));
        if (!hit) return fail('note:buttonToPin');
        return c.pinNets(hit).includes('0') ? pass('note:buttonOk') : fail('note:buttonGround');
      },
    },
    {
      id: 'led',
      check: (c) => {
        const m = mcuOf(c);
        if (isResult(m)) return m;
        const leds = need(c, M.led, 'led');
        if (isResult(leds)) return leds;
        const pins = portPins(c, m.ref);
        const rs = c.parts(M.resistor);
        for (const d of leds) {
          const k = c.net(d, 'K');
          const r = rs.find((x) => c.touches(x, k));
          if (!r) continue;
          const other = c.pinNets(r).find((n) => n !== k);
          if (other && pins.some((p) => p.net === other)) return pass('note:ledOk', { pin: pins.find((p) => p.net === other)!.pin });
        }
        return fail('note:ledToMcu');
      },
    },
    {
      id: 'program',
      check: (c) => {
        const m = mcuOf(c);
        if (isResult(m)) return m;
        const text = (m.ref.inst.params?.program ?? asLibraryPart(m.ref.def).mcu ? c.text(m.ref, 'program') : '') || '';
        const src = m.ref.inst.params?.program ?? text;
        if (!src.trim()) return fail('note:noProgram');
        const built = buildProgram(src);
        if (built.asmErrors.length) return fail('note:asmError', { line: built.asmErrors[0].line });
        if (built.hexErrors.length) return fail('note:asmError', { line: built.hexErrors[0].line });
        if (!built.asm) return fail('note:needAsm');
        const reads = /\b(MOV\s+C\s*,\s*P[0-3]\.[0-7]|JNB|JB)\b/i.test(src);
        const writes = /\b(MOV\s+P[0-3]\.[0-7]\s*,|SETB\s+P[0-3]\.|CLR\s+P[0-3]\.|CPL\s+P[0-3]\.|MOV\s+P[0-3]\s*,)/i.test(src);
        if (!reads) return fail('note:programRead');
        return writes ? pass('note:programOk', { n: built.end - built.start }) : fail('note:programWrite');
      },
    },
    {
      id: 'lit',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const m = mcuOf(c);
          if (isResult(m)) return m;
          const leds = c.parts(M.led);
          if (!leds.length) return fail('needPart', { part: noun('led') });
          const buttons = c.parts({ families: ['Switch'] });
          if (!buttons.some((s) => c.text(s, 'pressed') === 'true')) return fail('note:pressButton');
          const tr = await c.tran(2e-3, 2e-5);
          const i = Math.max(...leds.map((d) => Math.abs(c.current(tr, d))).filter(Number.isFinite));
          return i > 2e-3 ? pass('note:litOk', { value: fmt(i, 'A') }) : fail('note:notLit', { value: Number.isFinite(i) ? fmt(i, 'A') : '—' });
        }),
    },
  ],
  quiz: [
    { id: 'pullup', options: 3, answer: 1 },
    { id: 'bit', options: 3, answer: 0 },
    { id: 'loop', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 10. A ladder traffic light

/** Rungs of the finished traffic light: one cycle timer and three comparison contacts. */
function trafficRungs(): LadderRung[] {
  return [
    {
      id: 'rung1',
      comment: 'Bộ định thời vòng 12 s, tự khởi động lại',
      logic: { kind: 'contact', type: 'nc', address: 'T1' },
      outputs: [{ kind: 'ton', address: 'T1', preset: '12' }],
    },
    {
      id: 'rung2',
      comment: 'Xanh trong 6 s đầu',
      logic: { kind: 'compare', op: 'lt', left: 'T1.ET', right: '6' },
      outputs: [{ kind: 'coil', address: 'Q0.2' }],
    },
    {
      id: 'rung3',
      comment: 'Vàng từ 6 s tới 8 s',
      logic: {
        kind: 'series',
        items: [
          { kind: 'compare', op: 'ge', left: 'T1.ET', right: '6' },
          { kind: 'compare', op: 'lt', left: 'T1.ET', right: '8' },
        ],
      },
      outputs: [{ kind: 'coil', address: 'Q0.1' }],
    },
    {
      id: 'rung4',
      comment: 'Đỏ từ 8 s tới hết vòng',
      logic: { kind: 'compare', op: 'ge', left: 'T1.ET', right: '8' },
      outputs: [{ kind: 'coil', address: 'Q0.0' }],
    },
  ];
}

function trafficDesign(): Design {
  const b = builder('Ladder traffic light');
  const out = b.part('misc-digital/plc-output-8', 'PLCQ1', 420, 240, { byte: '0', von: '24' });
  b.labelPin(out, 'COM', '0');
  b.part('misc-digital/plc-controller', 'PLC1', 420, 440, { scan: '10m' });
  const names = ['RED', 'AMBER', 'GREEN'];
  names.forEach((n, i) => {
    const lamp = b.part('indicators/lamp', `X${i + 1}`, 680, 180 + 90 * i, { vrated: '24', prated: '5' }, { rotation: 90 });
    b.labelPin(lamp, '1', n);
    b.labelPin(lamp, '2', '0');
    b.labelPin(out, `Q${i}`, n);
  });
  b.part('sources/ground', 'GND1', 420, 540);
  b.ladderSheet(trafficRungs(), 'Ladder 1');
  b.useSheet(0);
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 0.05, tstop: 14 }]);
}

/** The rungs of every ladder sheet of the design. */
function rungsOf(c: LessonCircuit): LadderRung[] {
  const out: LadderRung[] = [];
  for (const s of c.design.sheets) if (s.kind === 'ladder' && s.ladder) out.push(...s.ladder);
  return out;
}

/** Output bits the program writes with a coil, in rung order. */
function coilBits(rungs: readonly LadderRung[]): BitRef[] {
  const { ir } = compileLadder(rungs);
  const out: BitRef[] = [];
  for (const r of ir.rungs) {
    for (const o of r.outputs) {
      if ((o.kind === 'coil' || o.kind === 'set') && o.ref?.area === 'Q' && !out.some((x) => x.index === o.ref!.index)) out.push(o.ref);
    }
  }
  return out;
}

/**
 * Run the learner's own program for one cycle and report, for each output bit, how many scans it
 * was on and whether two of them were ever on together.
 */
function runCycle(rungs: readonly LadderRung[], bits: readonly BitRef[], scans: number): { on: number[]; overlap: boolean } {
  const { ir } = compileLadder(rungs, { scan: 0.05 });
  const m = new LadderMachine(ir);
  const on = bits.map(() => 0);
  let overlap = false;
  for (let k = 0; k < scans; k++) {
    m.scan();
    let live = 0;
    bits.forEach((b, i) => {
      if (m.bit(b)) {
        on[i]++;
        live++;
      }
    });
    if (live > 1) overlap = true;
  }
  return { on, overlap };
}

export const ladderTraffic: LessonDef = {
  id: 'ladder-traffic',
  level: 'automation',
  solution: trafficDesign,
  steps: [
    {
      id: 'rack',
      check: (c) => {
        const out = c.parts({ families: ['PLC rack'] }).filter((r) => asLibraryPart(r.def).ladderIo?.kind === 'output');
        if (!out.length) return fail('note:needOutputModule');
        const rungs = rungsOf(c);
        if (!rungs.length) return fail('note:needLadderSheet');
        const lamps = [...c.parts({ families: ['Lamp'] }), ...c.parts(M.led)];
        return lamps.length >= 3 ? pass('note:rackOk', { n: lamps.length }) : fail('note:needThreeLamps', { have: lamps.length });
      },
    },
    {
      id: 'timer',
      check: (c) => {
        const rungs = rungsOf(c);
        if (!rungs.length) return fail('note:needLadderSheet');
        const { ir, errors } = compileLadder(rungs);
        if (errors.length) return fail('note:ladderError', { line: errors[0].rung });
        const timers = ir.rungs.flatMap((r) => r.outputs.filter((o) => o.kind === 'ton' || o.kind === 'tof'));
        if (!timers.length) return fail('note:needTimer');
        const compares = JSON.stringify(ir.rungs).includes('"cmp"');
        return compares ? pass('note:timerOk') : fail('note:needCompare');
      },
    },
    {
      id: 'lamps',
      check: (c) => {
        const rungs = rungsOf(c);
        if (!rungs.length) return fail('note:needLadderSheet');
        const bits = coilBits(rungs);
        return bits.length >= 3 ? pass('note:lampsOk', { n: bits.length }) : fail('note:needThreeCoils', { have: bits.length });
      },
    },
    {
      id: 'cycle',
      check: (c) => {
        const rungs = rungsOf(c);
        const bits = coilBits(rungs);
        if (bits.length < 3) return fail('note:needThreeCoils', { have: bits.length });
        const { errors } = compileLadder(rungs);
        if (errors.length) return fail('note:ladderError', { line: errors[0].rung });
        const { on, overlap } = runCycle(rungs, bits, 600);
        if (overlap) return fail('note:twoLamps');
        const dead = on.filter((n) => n === 0).length;
        if (dead) return fail('note:lampNeverOn', { n: dead });
        return pass('note:cycleOk', { list: on.map((n) => fmt(n * 0.05, 's')).join(', ') });
      },
    },
  ],
  quiz: [
    { id: 'cycle', options: 3, answer: 0 },
    { id: 'compare', options: 3, answer: 2 },
    { id: 'safety', options: 3, answer: 1 },
  ],
};

/** Every lesson of this round, in list order. */
export const ROUND3_LESSONS: readonly LessonDef[] = [realCapacitor, hysteresisBlock, transferBlock, icPackage, realFlipflop, mcuButton, ladderTraffic, rcStages, variantBoards, measRise];
