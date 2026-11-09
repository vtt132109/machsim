/**
 * Lessons built on the features of round 4 (part 1): a printed hand-out (page setup and layers
 * saved in the design), a meter inside two copies of one block, a `.step` sweep of a schematic,
 * one dual op-amp drawn as two sections, and an 8051 delay of exactly 1000 machine cycles. Part 2
 * (relay latch, listening to a filter, battery runtime, a scripted divider) is in round4b.ts.
 *
 * Every lesson has a reference solution and checks that read the learner's own circuit: the
 * structural ones look at parts, parameters and nets; the simulating ones run the circuit and
 * compare with the formula in the theory page. Text: src/i18n/lessons/round4.ts.
 */
import { Cpu8051, SFR } from '../../mcu/cpu8051';
import { buildProgram } from '../../mcu/program';
import { layerVisible } from '../../model/layers';
import { applySteps, customStepWrapper } from '../../model/steps';
import type { Design } from '../../model/types';
import type { AnalysisSpec } from '../../sim/netlist';
import { getPart } from '../../library';
import { SimValues, type LessonCircuit, type PartRef } from '../circuit';
import { builder, fail, fmt, isResult, M, measured, need, near, pass, setAnalyses, withSim } from '../kit';
import type { CheckResult, LessonDef } from '../types';
import { EXACT_DELAY_PROGRAM, ledPath, mcuOf, programProblem } from './mcu';

/** The resistor / capacitor pair that share a net other than ground: the stage of an RC filter. */
export function rcStage(c: LessonCircuit): { r: PartRef; cap: PartRef; node: string } | undefined {
  for (const r of c.parts(M.resistor)) {
    for (const cap of c.parts(M.capacitor)) {
      const shared = c.pinNets(r).find((n) => n && n !== '0' && c.pinNets(cap).includes(n));
      if (shared) return { r, cap, node: shared };
    }
  }
  return undefined;
}

/** First time a waveform crosses `level` (falling or rising), linear between samples; NaN when it never does. */
export function crossingTime(time: ArrayLike<number>, w: ArrayLike<number>, level: number, falling: boolean): number {
  for (let i = 1; i < w.length; i++) {
    const hit = falling ? w[i - 1] >= level && w[i] < level : w[i - 1] < level && w[i] >= level;
    if (hit) return time[i - 1] + ((level - w[i - 1]) / (w[i] - w[i - 1])) * (time[i] - time[i - 1]);
  }
  return Number.NaN;
}

// ---------------------------------------------------------------------------------------------
// 1. A hand-out: layers and page setup saved in the design

function handoutDesign(): Design {
  const b = builder('Hand-out');
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1k' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const r1 = b.part('basic/resistor', 'R1', 240, 160, { value: '1k' });
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  const c1 = b.part('basic/capacitor', 'C1', 340, 240, { value: '159n' }, { rotation: 90 });
  b.labelPin(c1, '1', 'OUT');
  b.labelPin(c1, '2', '0');
  b.addSheet('Bài tập');
  const v2 = b.part('sources/ac-voltage', 'V2', 100, 220, { amplitude: '1', freq: '1k' });
  b.labelPin(v2, '+', 'IN');
  b.labelPin(v2, '-', '0');
  b.part('sources/ground', 'GND2', 100, 320);
  b.wire(b.pin(v2, '-'), { x: 100, y: 320 });
  const c2 = b.part('basic/capacitor', 'C2', 240, 160, { value: '159n' });
  b.labelPin(c2, '1', 'IN');
  b.labelPin(c2, '2', 'OUT');
  const r2 = b.part('basic/resistor', 'R2', 340, 240, { value: '1k' }, { rotation: 90 });
  b.labelPin(r2, '1', 'OUT');
  b.labelPin(r2, '2', '0');
  b.useSheet(0);
  const d = setAnalyses(b.design, 'ac', [{ type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e5 }]);
  d.sheets[0].layers = { netNames: true };
  d.printSetup = { paper: 'A4', orientation: 'portrait', scale: 'fit', sheets: 'all', footer: true };
  return d;
}

export const printHandout: LessonDef = {
  id: 'print-handout',
  level: 'workflow',
  solution: handoutDesign,
  steps: [
    {
      id: 'circuit',
      check: (c) => {
        const src = need(c, M.acSource, 'acSource');
        if (isResult(src)) return src;
        const stage = rcStage(c);
        if (!stage) return fail('note:needRcPair');
        const tau = c.num(stage.r, 'value') * c.num(stage.cap, 'value');
        return Number.isFinite(tau) && tau > 0 ? pass('note:handoutCircuit', { fc: fmt(1 / (2 * Math.PI * tau), 'Hz') }) : fail('note:needRcPair');
      },
    },
    {
      id: 'names',
      check: (c) => (c.design.sheets.some((s) => layerVisible(s, 'netNames')) ? pass() : fail('note:needNetNames')),
    },
    {
      id: 'setup',
      check: (c) => {
        const s = c.design.printSetup;
        if (!s?.footer) return fail('note:needFooter');
        if (s.orientation !== 'portrait') return fail('note:needPortrait');
        return pass('note:setupOk', { paper: s.paper ?? 'A4' });
      },
    },
    {
      id: 'sheets',
      check: (c) => {
        const filled = c.design.sheets.filter((s) => s.parts.length >= 2).length;
        return filled >= 2 ? pass('note:sheetsOk', { n: filled }) : fail('note:needTwoSheets', { n: filled });
      },
    },
  ],
  quiz: [
    { id: 'where', options: 3, answer: 1 },
    { id: 'fit', options: 3, answer: 0 },
    { id: 'layer', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 2. A meter inside two copies of one block

function blockDesign(): Design {
  const b = builder('Two copies, two meters');
  const child = b.child('DIV', { kind: 'hierarchical', variables: { RB: '1k' } });
  b.label('IN', -100, 0, { kind: 'hier' });
  const r1 = b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 300, 0, { value: '{RB}' });
  const m = b.part('instruments/multimeter', 'XMM1', 500, 0);
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'MID');
  b.labelPin(r2, '1', 'MID');
  b.labelPin(r2, '2', 'GND');
  b.labelPin(m, '+', 'MID');
  b.labelPin(m, '-', 'GND');
  b.root();
  const v = b.part('sources/dc-voltage', 'V1', 80, 120, { value: '5' });
  const x1 = b.block(child, 'X1', 300, 120, { RB: '1k' });
  const x2 = b.block(child, 'X2', 300, 300, { RB: '3k' });
  b.labelPin(v, '+', 'VIN');
  b.labelPin(x1, 'IN', 'VIN');
  b.labelPin(x2, 'IN', 'VIN');
  b.labelPin(v, '-', 'GND');
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** Placed blocks (instances of a child design) of the root sheets, grouped by child. */
function blockCopies(c: LessonCircuit): Map<string, { refdes: string; params: Record<string, string> }[]> {
  const out = new Map<string, { refdes: string; params: Record<string, string> }[]>();
  for (const sheet of c.design.sheets) {
    for (const inst of sheet.parts) {
      if (!inst.partId.startsWith('hier:')) continue;
      const list = out.get(inst.partId) ?? [];
      list.push({ refdes: inst.refdes, params: inst.params });
      out.set(inst.partId, list);
    }
  }
  return out;
}

export const blockMeters: LessonDef = {
  id: 'block-meters',
  level: 'workflow',
  solution: blockDesign,
  steps: [
    {
      id: 'copies',
      check: (c) => {
        const groups = [...blockCopies(c).values()].filter((g) => g.length >= 2);
        return groups.length ? pass('note:copiesOk', { n: groups[0].length }) : fail('note:needBlockCopies');
      },
    },
    {
      id: 'inside',
      check: (c) => {
        const used = new Set([...blockCopies(c).keys()].map((k) => k.slice('hier:'.length)));
        const hasMeter = (c.design.children ?? []).some((ch) => used.has(ch.id) && ch.sheets.some((s) => s.parts.some((p) => getPart(p.partId)?.instrument !== undefined)));
        return hasMeter ? pass() : fail('note:needMeterInBlock');
      },
    },
    {
      id: 'differ',
      check: (c) => {
        const groups = [...blockCopies(c).values()].filter((g) => g.length >= 2);
        if (!groups.length) return fail('note:needBlockCopies');
        const same = groups.every((g) => new Set(g.map((x) => JSON.stringify(x.params))).size < 2);
        return same ? fail('note:copiesSame') : pass();
      },
    },
    {
      id: 'read',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const scoped = c.build.instruments.filter((i) => i.scope && i.channels.v);
          if (scoped.length < 2) return fail('note:needBlockMeters', { n: scoped.length });
          const op = await c.op();
          const reads = scoped.map((i) => ({ name: i.refdes, value: op.signal(i.channels.v) }));
          if (reads.some((r) => !Number.isFinite(r.value))) return fail('note:needBlockMeters', { n: scoped.length });
          const lo = Math.min(...reads.map((r) => r.value));
          const hi = Math.max(...reads.map((r) => r.value));
          const list = reads.map((r) => `${r.name} = ${fmt(r.value, 'V')}`).join('; ');
          return hi - lo > 0.01 * Math.max(Math.abs(hi), 1e-9) ? pass('note:blockReadOk', { list }) : fail('note:blockReadSame', { list });
        }),
    },
  ],
  quiz: [
    { id: 'name', options: 3, answer: 2 },
    { id: 'why', options: 3, answer: 0 },
    { id: 'store', options: 3, answer: 1 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 3. .step on a schematic

const STEP_AC: AnalysisSpec = { type: 'ac', sweep: 'dec', points: 40, fstart: 10, fstop: 1e5 };

function stepDesign(): Design {
  const b = builder('Step sweep');
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '1k' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const r1 = b.part('basic/resistor', 'R1', 240, 160, { value: '{Rx}' });
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  const c1 = b.part('basic/capacitor', 'C1', 340, 240, { value: '100n' }, { rotation: 90 });
  b.labelPin(c1, '1', 'OUT');
  b.labelPin(c1, '2', '0');
  b.design.variables = { Rx: '1k' };
  b.design.customSpice = '.step param Rx list 1k 2.2k 4.7k';
  return setAnalyses(b.design, 'ac', [STEP_AC]);
}

/** The values the learner's sweep tries, from a `.step` card or a saved Parameter sweep of a variable. */
function stepValues(design: Design): { values: number[]; spec: AnalysisSpec } | undefined {
  const card = customStepWrapper(design);
  if (card.wrapper && card.wrapper.type === 'paramsweep' && card.wrapper.global) return { values: card.wrapper.values, spec: STEP_AC };
  const saved = design.analysis.specs.paramsweep;
  if (saved && saved.type === 'paramsweep' && saved.global) return { values: saved.values, spec: saved };
  return undefined;
}

/** The -3 dB frequency of V(node) in one AC run (log interpolation), NaN when it never falls. */
function minus3dB(v: SimValues, node: string): number {
  const f = v.result.scale?.re;
  const vec = v.vec(`V(${node})`);
  if (!f || !vec?.im) return Number.NaN;
  const m = Array.from(f, (_, k) => Math.hypot(vec.re[k], vec.im![k]));
  const target = m[0] * Math.SQRT1_2;
  for (let k = 1; k < f.length; k++) if (m[k] <= target) return f[k - 1] * Math.pow(f[k] / f[k - 1], (m[k - 1] - target) / (m[k - 1] - m[k]));
  return Number.NaN;
}

export const stepSweep: LessonDef = {
  id: 'step-sweep',
  level: 'workflow',
  solution: stepDesign,
  steps: [
    {
      id: 'variable',
      check: (c) => {
        const stage = rcStage(c);
        if (!stage) return fail('note:needRcPair');
        const m = /^\{\s*([A-Za-z_]\w*)\s*\}$/.exec((stage.r.inst.params.value ?? '').trim());
        if (!m) return fail('note:needVariableRes');
        const names = Object.keys(c.design.variables ?? {}).map((x) => x.toLowerCase());
        return names.includes(m[1].toLowerCase()) ? pass('note:variableOk', { name: m[1] }) : fail('note:needVariableDef', { name: m[1] });
      },
    },
    {
      id: 'values',
      check: (c) => {
        const plan = stepValues(c.design);
        if (!plan) return fail('note:needStepCard');
        return plan.values.length >= 3 ? pass('note:stepValuesOk', { n: plan.values.length }) : fail('note:needStepValues', { n: plan.values.length });
      },
    },
    {
      id: 'curves',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const plan = stepValues(c.design);
          const stage = rcStage(c);
          if (!plan || !stage) return fail('note:needStepCard');
          const out = applySteps(c.design, plan.spec, (n) => ({ ...n, analyses: [] }));
          if (out.errors.length) return fail('note:stepFailed', { message: out.errors[0].text });
          const swept = await c.simulate(out.spec);
          const runs = swept.result.runs ?? [];
          if (runs.length < 3) return fail('note:needStepValues', { n: runs.length });
          const cap = c.num(stage.cap, 'value');
          const lines: string[] = [];
          for (let k = 0; k < runs.length; k++) {
            const rx = plan.values[k];
            const want = 1 / (2 * Math.PI * rx * cap);
            const got = minus3dB(new SimValues(runs[k].result), stage.node);
            lines.push(`${fmt(rx, 'Ω')}: ${fmt(got, 'Hz')}`);
            if (!near(got, want, 5)) return fail('note:stepCornerWrong', { rx: fmt(rx, 'Ω'), value: fmt(got, 'Hz'), want: fmt(want, 'Hz') });
          }
          return pass('note:stepCornerOk', { list: lines.join('; ') });
        }),
    },
  ],
  quiz: [
    { id: 'card', options: 3, answer: 1 },
    { id: 'legend', options: 3, answer: 0 },
    { id: 'fc', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 4. One dual op-amp drawn as two sections

function dualDesign(): Design {
  const b = builder('Dual op-amp sections');
  const vcc = b.part('sources/dc-voltage', 'V1', 100, 120, { value: '12' });
  b.labelPin(vcc, '+', 'VCC');
  b.labelPin(vcc, '-', '0');
  const vin = b.part('sources/dc-voltage', 'V2', 100, 280, { value: '0.5' });
  b.labelPin(vin, '+', 'IN');
  b.labelPin(vin, '-', '0');
  b.part('sources/ground', 'GND1', 100, 380);
  b.wire(b.pin(vin, '-'), { x: 100, y: 380 });
  const ua = b.part('analog/lm358-dual-a', 'U1', 300, 240);
  b.labelPin(ua, '1IN+', 'IN');
  b.labelPin(ua, '1IN-', 'BUF');
  b.labelPin(ua, '1OUT', 'BUF');
  b.labelPin(ua, 'V+', 'VCC');
  b.labelPin(ua, 'V-', '0');
  const ub = b.part('analog/lm358-dual-b', 'U1', 560, 240);
  b.labelPin(ub, '2IN+', 'BUF');
  b.labelPin(ub, '2IN-', 'FB');
  b.labelPin(ub, '2OUT', 'OUT');
  const r1 = b.part('basic/resistor', 'R1', 700, 380, { value: '10k' });
  b.labelPin(r1, '1', 'FB');
  b.labelPin(r1, '2', '0');
  const r2 = b.part('basic/resistor', 'R2', 700, 140, { value: '10k' });
  b.labelPin(r2, '1', 'OUT');
  b.labelPin(r2, '2', 'FB');
  const rl = b.part('basic/resistor', 'RL', 860, 260, { value: '10k' });
  b.labelPin(rl, '1', 'OUT');
  b.labelPin(rl, '2', '0');
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

/** Placed op-amp sections that share a reference designator: the chips drawn as several parts. */
function opampChips(c: LessonCircuit): { refdes: string; sections: PartRef[] }[] {
  const by = new Map<string, PartRef[]>();
  for (const r of c.parts({ families: ['Op-amp'] })) {
    if (!/-[a-d]$/.test(r.def.id)) continue;
    const list = by.get(r.inst.refdes) ?? [];
    list.push(r);
    by.set(r.inst.refdes, list);
  }
  return [...by.entries()].filter(([, s]) => s.length >= 2).map(([refdes, sections]) => ({ refdes, sections }));
}

export const dualOpamp: LessonDef = {
  id: 'dual-opamp',
  level: 'amplifiers',
  solution: dualDesign,
  steps: [
    {
      id: 'sections',
      check: (c) => {
        const chips = opampChips(c);
        return chips.length ? pass('note:sectionsOk', { ref: chips[0].refdes, n: chips[0].sections.length }) : fail('note:needSections');
      },
    },
    {
      id: 'supply',
      check: (c) => {
        const chips = opampChips(c);
        if (!chips.length) return fail('note:needSections');
        // the shared V+ / V- pins are wired on at least one section, to two different nets
        const wired = (pin: string) => chips[0].sections.filter((s) => c.pinConnected(s, pin)).map((s) => c.net(s, pin));
        const plus = wired('V+');
        const minus = wired('V-');
        if (!plus.length || !minus.length) return fail('note:needSupply');
        return plus[0] !== minus[0] ? pass() : fail('note:needSupply');
      },
    },
    {
      id: 'gain',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const input = c.namedNet('IN');
          const out = c.namedNet('OUT');
          if (!input || !out) return fail('note:needLabels2', { names: 'IN, OUT' });
          const op = await c.op();
          const vin = op.v(input);
          const vout = op.v(out);
          if (!(Math.abs(vin) > 0.05)) return fail('note:needInput');
          return near(vout / vin, 2, 4) ? pass('note:dualGainOk', { gain: (vout / vin).toFixed(2) }) : fail('note:dualGainWrong', { gain: Number.isFinite(vout / vin) ? (vout / vin).toFixed(2) : '—' });
        }),
    },
  ],
  quiz: [
    { id: 'name', options: 3, answer: 1 },
    { id: 'supply', options: 3, answer: 2 },
    { id: 'spare', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 5. An 8051 delay of exactly 1000 machine cycles

const HALF_PERIOD = 1000;

function exactDesign(): Design {
  const b = builder('8051 exact delay');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 240, { value: '5' });
  b.labelPin(v1, '+', 'VCC');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 340);
  b.wire(b.pin(v1, '-'), { x: 100, y: 340 });
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 360, 240, { program: EXACT_DELAY_PROGRAM, fosc: '12M' });
  const r1 = b.part('basic/resistor', 'R1', 560, 160, { value: '330' });
  const led = b.part('diodes/led-red', 'LED1', 660, 220, {}, { rotation: 90 });
  b.labelPin(r1, '1', 'VCC');
  b.labelPin(r1, '2', 'A');
  b.labelPin(led, 'A', 'A');
  b.labelPin(led, 'K', 'P1_0');
  b.labelPin(u1, 'P1.0', 'P1_0');
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 1e-2 }]);
}

/**
 * Machine cycles between consecutive changes of P1.0 when the program runs on the bare 8051 core
 * (the same core the circuit simulation uses): the half periods, or an empty list when the pin
 * never changes within `limit` instructions.
 */
export function halfPeriods(program: string, limit = 60000): number[] {
  const build = buildProgram(program);
  const cpu = new Cpu8051();
  cpu.loadCode(build.bytes);
  const pin = () => cpu.sfr[SFR.P1 - 0x80] & 1;
  let last = pin();
  let lastCycle = -1;
  const out: number[] = [];
  for (let i = 0; i < limit && out.length < 4 && cpu.halted === 'none'; i++) {
    cpu.step();
    if (pin() !== last) {
      last = pin();
      if (lastCycle >= 0) out.push(cpu.cycles - lastCycle);
      lastCycle = cpu.cycles;
    }
  }
  return out;
}

export const mcuDebug: LessonDef = {
  id: 'mcu-debug',
  level: 'digital',
  solution: exactDesign,
  steps: [
    {
      id: 'program',
      check: (c) => {
        const m = mcuOf(c);
        if (isResult(m)) return m;
        const problem = programProblem(m.inst.params.program ?? '');
        return problem ? fail(problem.note, problem.params) : pass();
      },
    },
    {
      id: 'cycles',
      check: (c) => {
        const m = mcuOf(c);
        if (isResult(m)) return m;
        if (programProblem(m.inst.params.program ?? '')) return fail('note:fixProgramFirst');
        const halves = halfPeriods(m.inst.params.program ?? '');
        if (halves.length < 2) return fail('note:noToggle');
        const worst = halves.find((h) => h !== HALF_PERIOD);
        return worst === undefined ? pass('note:cyclesOk', { cycles: HALF_PERIOD }) : fail('note:cyclesWrong', { cycles: worst, target: HALF_PERIOD });
      },
    },
    {
      id: 'led',
      check: (c) => {
        const m = mcuOf(c);
        return isResult(m) ? m : ledPath(c, m);
      },
    },
    {
      id: 'blink',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const m = mcuOf(c);
          if (isResult(m)) return m;
          const pin = c.net(m, 'P1.0');
          if (pin === undefined) return fail('note:noPinNet');
          const sim = await c.tran(0.01, 1e-5);
          const f = sim.frequency(pin, 2.5, 1e-3);
          const fosc = c.num(m, 'fosc');
          const want = fosc / 12 / (2 * HALF_PERIOD);
          return f > 0 ? measured(f, want, 3, 'Hz') : fail('note:noBlink');
        }),
    },
  ],
  quiz: [
    { id: 'cycle', options: 3, answer: 0 },
    { id: 'over', options: 3, answer: 2 },
    { id: 'clock', options: 3, answer: 1 },
  ],
};
