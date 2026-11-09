/**
 * Automation lesson: motor start / stop with a ladder diagram.
 *
 * It is the first lesson where the learner writes a *control program* on its own sheet, so the
 * checks look at the rack (an input and an output module on one common), at the wiring (two
 * buttons into input channels, a load on an output channel) and at the program itself. The last
 * step does not simulate the circuit: it runs the learner's OWN compiled rungs in the scan machine
 * (src/ladder/machine.ts) with a pressed-then-released start button, which is the only way to
 * prove the rung holds itself — a learner cannot keep a button pressed while a check runs.
 *
 * Text: src/i18n/lessons/ladder.ts.
 */
import { LadderMachine } from '../../ladder/machine';
import { compileLadder, type BitRef, type ExprIR } from '../../ladder/program';
import type { LadderRung } from '../../ladder/types';
import { asLibraryPart } from '../../library/partkit';
import type { LessonCircuit, PartRef } from '../circuit';
import { builder, fail, M, pass, setAnalyses } from '../kit';
import type { CheckResult, LessonDef } from '../types';

/** Rack parts of a design level, by kind. */
function rack(c: LessonCircuit, kind: 'input' | 'output' | 'cpu'): PartRef[] {
  return c
    .parts({ families: ['PLC rack'] })
    .filter((r) => asLibraryPart(r.def).ladderIo?.kind === kind);
}

/** The rungs of every ladder sheet of the design, in sheet order. */
function rungsOf(c: LessonCircuit): LadderRung[] {
  const out: LadderRung[] = [];
  for (const s of c.design.sheets) if (s.kind === 'ladder' && s.ladder) out.push(...s.ladder);
  return out;
}

/** Every bit the logic of a rung reads. */
function reads(e: ExprIR | null): BitRef[] {
  if (!e) return [];
  if (e.k === 'bit') return [e.ref];
  if (e.k === 'cmp') return [];
  return e.items.flatMap(reads);
}

/** Bits read inside an OR group of a rung (the self-holding branch sits in one). */
function readsInOr(e: ExprIR | null): BitRef[] {
  if (!e || e.k === 'bit' || e.k === 'cmp') return [];
  if (e.k === 'or') return reads(e);
  return e.items.flatMap(readsInOr);
}

/** The first rung that writes an output bit, with the bit it writes. */
function motorRung(rungs: readonly LadderRung[]): { index: number; q: BitRef } | null {
  const { ir } = compileLadder(rungs);
  for (const r of ir.rungs) {
    const out = r.outputs.find((o) => o.kind === 'coil' && o.ref?.area === 'Q');
    if (out?.ref) return { index: r.index, q: out.ref };
  }
  return null;
}

/**
 * Run the learner's program: press the start input for two scans, release it, then press stop.
 * `start` is an input bit the rung reads and `stop` another one; the stop button of the solution
 * is normally closed, so its input is HIGH while it is not pressed.
 */
function latches(rungs: readonly LadderRung[], q: BitRef, start: BitRef, stop: BitRef, stopActiveLow: boolean): boolean {
  const { ir, errors } = compileLadder(rungs);
  if (errors.length) return false;
  const m = new LadderMachine(ir);
  const set = (ref: BitRef, on: boolean) => m.setInputBit(ref.index, on ? 1 : 0);
  const idle = () => set(stop, stopActiveLow);
  idle();
  set(start, false);
  m.scan();
  if (m.bit(q)) return false;
  set(start, true);
  m.scan();
  m.scan();
  if (!m.bit(q)) return false;
  // released: it must stay on
  set(start, false);
  m.scan();
  m.scan();
  if (!m.bit(q)) return false;
  // stop pressed
  set(stop, !stopActiveLow);
  m.scan();
  if (m.bit(q)) return false;
  // and it must not come back by itself
  idle();
  m.scan();
  return !m.bit(q);
}

/** The design of the finished lesson (the same circuit as sample 55). */
function startStopLayout() {
  const b = builder('Ladder start / stop');
  const v = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '24' });
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v, '-'), { x: 100, y: 320 });
  b.labelPin(v, '+', 'P24');
  const s1 = b.part('basic/push-button', 'S1', 240, 160, { key: 'S' });
  b.labelPin(s1, '1', 'P24');
  b.labelPin(s1, '2', 'START');
  const s2 = b.part('basic/push-button', 'S2', 240, 240, { key: 'T', contact: 'nc' });
  b.labelPin(s2, '1', 'P24');
  b.labelPin(s2, '2', 'STOP');
  const inp = b.part('misc-digital/plc-input-8', 'PLCI1', 460, 220, { byte: '0' });
  b.labelPin(inp, 'I0', 'START');
  b.labelPin(inp, 'I1', 'STOP');
  b.labelPin(inp, 'COM', '0');
  const out = b.part('misc-digital/plc-output-8', 'PLCQ1', 680, 220, { byte: '0' });
  b.labelPin(out, 'Q0', 'KM1');
  b.labelPin(out, 'COM', '0');
  b.part('misc-digital/plc-controller', 'PLC1', 460, 420, { scan: '10m' });
  const lamp = b.part('indicators/lamp', 'X1', 880, 220, { vrated: '24', prated: '5' }, { rotation: 90 });
  b.labelPin(lamp, '1', 'KM1');
  b.labelPin(lamp, '2', '0');
  b.ladderSheet(
    [
      {
        id: 'rung1',
        comment: 'Tự giữ: (khởi động HOẶC đang chạy) VÀ chưa dừng → chạy',
        logic: {
          kind: 'series',
          items: [
            { kind: 'parallel', items: [{ kind: 'contact', type: 'no', address: 'I0.0' }, { kind: 'contact', type: 'no', address: 'Q0.0' }] },
            { kind: 'contact', type: 'no', address: 'I0.1' },
          ],
        },
        outputs: [{ kind: 'coil', address: 'Q0.0' }],
      },
    ],
    'Ladder 1',
  );
  b.useSheet(0);
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2e-3, tstop: 2 }]);
}

export const ladderStartStop: LessonDef = {
  id: 'ladder-start-stop',
  level: 'automation',
  solution: startStopLayout,
  steps: [
    {
      id: 'rack',
      check: (c) => {
        if (rack(c, 'input').length === 0) return fail('note:needInputModule');
        if (rack(c, 'output').length === 0) return fail('note:needOutputModule');
        const build = c.build;
        if (!build.ladder) return fail('note:needLadderSheet');
        return pass();
      },
    },
    {
      id: 'wiring',
      check: (c) => {
        const inp = rack(c, 'input')[0];
        const out = rack(c, 'output')[0];
        if (!inp || !out) return fail('note:needInputModule');
        const buttons = c.parts({ families: ['Switch'] });
        if (buttons.length < 2) return fail('note:needTwoButtons');
        const channels = asLibraryPart(inp.def).ladderIo?.pins ?? [];
        const wired = channels.filter((pin) => c.pinConnected(inp, pin));
        if (wired.length < 2) return fail('note:wireTwoChannels');
        const outPins = asLibraryPart(out.def).ladderIo?.pins ?? [];
        const driven = outPins.filter((pin) => c.pinConnected(out, pin));
        if (driven.length === 0) return fail('note:wireOneOutput');
        const loads = [...c.parts({ families: ['Lamp'] }), ...c.parts(M.led), ...c.parts({ families: ['Motor', 'DC motor'] }), ...c.parts({ families: ['Mechatronics'] })];
        const outNet = c.net(out, driven[0]);
        if (!loads.some((l) => c.touches(l, outNet))) return fail('note:needLoad');
        return pass();
      },
    },
    {
      id: 'program',
      check: (c) => {
        const rungs = rungsOf(c);
        if (rungs.length === 0) return fail('note:needRung');
        const { errors } = compileLadder(rungs);
        if (errors.length) return fail('note:ladderError', { line: errors[0].rung });
        const m = motorRung(rungs);
        if (!m) return fail('note:needCoil');
        return pass();
      },
    },
    {
      id: 'holds',
      check: (c) => {
        const rungs = rungsOf(c);
        const m = motorRung(rungs);
        if (!m) return fail('note:needCoil');
        const rung = rungs[m.index];
        const { ir } = compileLadder(rungs);
        const compiled = ir.rungs.find((r) => r.index === m.index)!;
        const held = readsInOr(compiled.expr).some((r) => r.area === 'Q' && r.index === m.q.index);
        if (!held) return fail('note:needSelfHold');
        const inputs = reads(compiled.expr).filter((r) => r.area === 'I');
        if (inputs.length < 2) return fail('note:needStopContact');
        void rung;
        // try both assignments of the two inputs, and both stop-button polarities: any wiring
        // that really latches and really stops is accepted
        for (const [a, b] of [
          [inputs[0], inputs[1]],
          [inputs[1], inputs[0]],
        ]) {
          for (const activeLow of [true, false]) {
            if (latches(rungs, m.q, a, b, activeLow)) return pass('note:holdsOk');
          }
        }
        return fail('note:doesNotHold');
      },
    },
  ],
  quiz: [
    { id: 'hold', options: 3, answer: 0 },
    { id: 'stop', options: 3, answer: 1 },
    { id: 'scan', options: 3, answer: 2 },
  ],
};
