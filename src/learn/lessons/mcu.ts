/**
 * Microcontroller lesson: an 8051 blinking an LED on P1.0.
 *
 * It is the first lesson where the learner writes a *program* instead of only wiring parts, so the
 * checks look at both: the LED must hang from the supply down to the port pin (the pin sinks the
 * current, which is what a real 8051 can do), the program in the part must assemble without an
 * error and must change P1.0 inside a loop, and the transient must really show the pin toggling.
 *
 * Text: src/i18n/lessons/mcu.ts.
 */
import { buildProgram } from '../../mcu/program';
import type { LessonCircuit, PartRef } from '../circuit';
import { builder, fail, fmt, groundAt, isResult, M, need, p, pass, setAnalyses, withSim } from '../kit';
import type { CheckResult, LessonDef } from '../types';

const HIGH = 2.5;

/** The blink program the solution carries (and the one the lesson text quotes). */
export const BLINK_PROGRAM = [
  '; Nhay LED o chan P1.0 / blink an LED on P1.0',
  '        ORG  0',
  'MAIN:   CPL  P1.0',
  '        ACALL DELAY',
  '        SJMP MAIN',
  '',
  'DELAY:  MOV  R7,#100       ; 100 x 503 chu ky may = 50,3 ms',
  'D1:     MOV  R6,#250',
  'D2:     DJNZ R6,D2',
  '        DJNZ R7,D1',
  '        RET',
  '        END',
].join('\n');

/**
 * The program of the debugging lesson (and of sample 93): P1.0 toggles after exactly 1000 machine
 * cycles. Half period = CPL 1 + ACALL 2 + SJMP 2 + MOV 1 + 32 x (MOV 1 + 14 x DJNZ 2 + DJNZ 2) + RET 2.
 */
export const EXACT_DELAY_PROGRAM = [
  '; P1.0 doi trang thai sau dung 1000 chu ky may / toggle P1.0 every 1000 machine cycles',
  '        ORG  0',
  'MAIN:   CPL  P1.0          ; 1 chu ky',
  '        ACALL DELAY        ; 2 chu ky',
  '        SJMP MAIN          ; 2 chu ky',
  '',
  'DELAY:  MOV  R7,#32        ; 1 chu ky',
  'D1:     MOV  R6,#14        ; 1 chu ky',
  'D2:     DJNZ R6,D2         ; 2 chu ky, lap 14 lan',
  '        DJNZ R7,D1         ; 2 chu ky, lap 32 lan',
  '        RET                ; 2 chu ky',
  '        END',
].join('\n');

/** The microcontroller of the design (any of the 8051 parts). */
export function mcuOf(c: LessonCircuit): CheckResult | PartRef {
  const found = need(c, M.mcu, 'mcu');
  if (isResult(found)) return found;
  return found[0];
}

/** Does the program change P1.0 and loop for ever? */
export function programProblem(text: string): { note: string; params?: Record<string, string | number> } | null {
  const build = buildProgram(text);
  const first = build.asmErrors[0] ?? build.hexErrors[0];
  if (first) return { note: 'note:asmError', params: { line: first.line } };
  if (build.end === 0) return { note: 'note:noProgram' };
  if (build.kind !== 'asm' || !build.asm) return { note: 'note:needAsm' };
  const text1 = build.asm.lines.map((l) => l.text.toUpperCase()).join('\n');
  // the program must touch P1.0 (CPL / SETB / CLR of the bit, or a write to the whole port)
  if (!/\b(CPL|SETB|CLR)\s+P1\.0\b/.test(text1) && !/\bMOV\s+P1\s*,/.test(text1)) return { note: 'note:touchPin' };
  if (!/\b(SJMP|AJMP|LJMP|DJNZ)\b/.test(text1)) return { note: 'note:needLoop' };
  return null;
}

/** A resistor in series with an LED between a net above 3 V and the P1.0 pin. */
export function ledPath(c: LessonCircuit, mcu: PartRef): CheckResult {
  const pin = c.net(mcu, 'P1.0');
  if (pin === undefined) return fail('note:noPinNet');
  const leds = c.parts(M.led);
  if (leds.length === 0) return fail('needPart', { part: 'LED' });
  const resistors = c.parts(M.resistor);
  if (resistors.length === 0) return fail('note:needResistor');
  for (const led of leds) {
    const a = c.net(led, 'A');
    const k = c.net(led, 'K');
    if (a === undefined || k === undefined) continue;
    // the cathode may sit on the pin, or behind the resistor
    for (const r of resistors) {
      const [r1, r2] = ['1', '2'].map((x) => c.net(r, x));
      const joins = (x: string | undefined, y: string | undefined) => x !== undefined && x === y;
      // supply -> R -> LED -> pin
      if (joins(r2, a) && k === pin) return pass();
      if (joins(r1, a) && k === pin) return pass();
      // supply -> LED -> R -> pin
      if (joins(k, r1) && r2 === pin) return pass();
      if (joins(k, r2) && r1 === pin) return pass();
    }
  }
  return fail('note:ledToPin');
}

/** The design of the finished lesson. */
function blinkLayout() {
  const b = builder('8051 blink');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 240, { value: '5' });
  groundAt(b, v1, '-', 'GND1', 40);
  b.labelPin(v1, '+', 'VCC');
  const u1 = b.part('misc-digital/mcu-8051-p1', 'U1', 360, 240, { program: BLINK_PROGRAM, fosc: '12M' });
  const r1 = b.part('basic/resistor', 'R1', 560, 160, { value: '330' });
  const led = b.part('diodes/led-red', 'LED1', 660, 220, {}, { rotation: 90 });
  b.labelPin(r1, '1', 'VCC');
  b.labelPin(r1, '2', 'A');
  b.labelPin(led, 'A', 'A');
  b.labelPin(led, 'K', 'P1_0');
  b.labelPin(u1, 'P1.0', 'P1_0');
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-3, tstop: 0.3 }]);
}

export const mcuBlink: LessonDef = {
  id: 'mcu-blink',
  level: 'digital',
  solution: blinkLayout,
  steps: [
    {
      id: 'mcu',
      check: (c) => {
        const m = mcuOf(c);
        return isResult(m) ? m : pass();
      },
    },
    {
      id: 'led',
      check: (c) => {
        const m = mcuOf(c);
        if (isResult(m)) return m;
        return ledPath(c, m);
      },
    },
    {
      id: 'program',
      check: (c) => {
        const m = mcuOf(c);
        if (isResult(m)) return m;
        const problem = programProblem(m.inst.params.program ?? m.def.params.find((x) => x.key === 'program')?.default ?? '');
        return problem ? fail(problem.note, problem.params) : pass();
      },
    },
    {
      id: 'blink',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const m = mcuOf(c);
          if (isResult(m)) return m;
          const problem = programProblem(m.inst.params.program ?? '');
          if (problem) return fail(problem.note, problem.params);
          const pin = c.net(m, 'P1.0');
          if (pin === undefined) return fail('note:noPinNet');
          const sim = await c.tran(0.3, 1e-3);
          const w = sim.wave(pin);
          if (w.length === 0) return fail('note:noPinNet');
          let edges = 0;
          for (let i = 1; i < w.length; i++) if ((w[i - 1] < HIGH) !== (w[i] < HIGH)) edges++;
          if (edges < 2) return fail('note:noBlink');
          const period = (2 * 0.3) / edges;
          return pass('note:blinkOk', { edges, period: fmt(period, 's') });
        }),
    },
  ],
  quiz: [
    { id: 'wiring', options: 3, answer: 1 },
    { id: 'cycle', options: 3, answer: 2 },
    { id: 'toggle', options: 3, answer: 0 },
  ],
};
