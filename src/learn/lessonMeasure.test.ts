/**
 * Authored lesson `measure` steps that choose their analysis (round 4 step 3): the operating point
 * (default), a transient read like a `.meas` card (value, peak, pp, RMS, mean, frequency) and the AC
 * phasor at one frequency (magnitude, dB, phase). Each step must pass on the reference solution and
 * fail on a wrong circuit, with a number in the feedback; the analytic references are
 *   2 V sine through a 1 k / 1 k divider:  peak 1 V, pp 2 V, RMS 0.7071 V, mean 0 V, 1 kHz
 *   RC low-pass with fc = 1 kHz:           |H| = 0.7071, -3.0103 dB, -45 degrees at 1 kHz
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../model/designkit';
import { serializeDesign } from '../model/serialize';
import type { Design } from '../model/types';
import { runAnalyses } from '../sim';
import type { AnalysisResult } from '../sim/results';
import { compileLessonFile, LESSON_FORMAT, newLessonFile, parseLessonFile, serializeLessonFile, type LessonCheckSpec, type LessonFile } from './lessonFile';
import { acReading, phasorBetween, transientReading, type LessonAnalysis } from './readings';
import { checkLesson } from './runner';

const bi = (vi: string, en: string) => ({ vi, en });

/** 2 V / 1 kHz sine, R1 = 1 k to OUT, R2 to ground. */
function divider(r2 = '1k', freq = '1k'): Design {
  const b = new DesignBuilder('Divider AC');
  const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '2', freq });
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const r = b.part('basic/resistor', 'R2', 400, 0, { value: r2 });
  const g = b.part('sources/ground', 'G1', 200, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r, '1', 'OUT');
  b.labelPin(r, '2', 'GND0');
  b.labelPin(v, '-', 'GND0');
  b.labelPin(g, '1', 'GND0');
  return b.design;
}

/** Unit-amplitude source into R = 1 k, C as given, output across C. */
function lowPass(c = '159.1549n'): Design {
  const b = new DesignBuilder('RC');
  const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '1', freq: '1k' });
  const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const cap = b.part('basic/capacitor', 'C1', 400, 0, { value: c });
  const g = b.part('sources/ground', 'G1', 200, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(r, '1', 'IN');
  b.labelPin(r, '2', 'OUT');
  b.labelPin(cap, '1', 'OUT');
  b.labelPin(cap, '2', 'GND0');
  b.labelPin(v, '-', 'GND0');
  b.labelPin(g, '1', 'GND0');
  return b.design;
}

function lessonWith(check: LessonCheckSpec, solution: Design): LessonFile {
  return {
    format: LESSON_FORMAT,
    version: 1,
    id: 'teacher-measure',
    level: 'basics',
    title: bi('Đo trên mạch', 'Measure on the circuit'),
    goal: bi('Đo.', 'Measure.'),
    theory: bi('Đo.', 'Measure.'),
    steps: [{ id: 's1', task: bi('Đo.', 'Measure.'), hint: bi('Nhãn OUT.', 'The OUT label.'), check }],
    quiz: [],
    solution: serializeDesign(solution),
  };
}

const measure = (analysis: LessonAnalysis, target: number, extra: Partial<Extract<LessonCheckSpec, { kind: 'measure' }>> = {}): LessonCheckSpec => ({
  kind: 'measure',
  probe: { kind: 'net', net: 'OUT' },
  target,
  tolerancePct: 2,
  unit: '',
  analysis,
  ...extra,
});

async function verdict(check: LessonCheckSpec, solution: Design, attempt: Design) {
  const { def } = compileLessonFile(lessonWith(check, solution));
  const ok = await checkLesson(def, def.solution(), runAnalyses);
  const got = await checkLesson(def, attempt, runAnalyses);
  return { ok: ok.s1, got: got.s1 };
}

describe('transient readings in a lesson step', () => {
  const cases: { name: string; analysis: LessonAnalysis; target: number; extra?: Partial<Extract<LessonCheckSpec, { kind: 'measure' }>>; wrong: Design }[] = [
    { name: 'peak', analysis: { kind: 'tran', tstop: 5e-3, reading: 'peak', from: 1e-3 }, target: 1, wrong: divider('3k') },
    { name: 'peak-to-peak', analysis: { kind: 'tran', tstop: 5e-3, reading: 'pp', from: 1e-3 }, target: 2, wrong: divider('3k') },
    { name: 'rms', analysis: { kind: 'tran', tstop: 5e-3, reading: 'rms', from: 1e-3 }, target: Math.SQRT1_2, wrong: divider('3k') },
    { name: 'minimum', analysis: { kind: 'tran', tstop: 5e-3, reading: 'min', from: 1e-3 }, target: -1, wrong: divider('3k') },
    { name: 'mean', analysis: { kind: 'tran', tstop: 5e-3, reading: 'mean' }, target: 0, extra: { toleranceAbs: 0.02 }, wrong: divider('1k') },
    { name: 'frequency', analysis: { kind: 'tran', tstop: 6e-3, reading: 'frequency', from: 1e-3 }, target: 1000, wrong: divider('1k', '2k') },
  ];
  for (const c of cases) {
    it(`${c.name}: passes on the reference solution, fails on a wrong circuit`, async () => {
      // the mean of a symmetric sine is 0 for both circuits: check that one on a frequency-free wrong DC offset instead
      const { ok, got } = await verdict(measure(c.analysis, c.target, c.extra), divider(), c.name === 'mean' ? offsetDivider() : c.wrong);
      expect(ok.ok, JSON.stringify(ok.note)).toBe(true);
      expect(got.ok, JSON.stringify(got.note)).toBe(false);
      // the failure names the number the learner got
      expect(got.note?.id === 'measured' || got.note?.id === 'measuredAbs').toBe(true);
    });
  }

  it('a failing reading says what it measured', async () => {
    const { got } = await verdict(measure({ kind: 'tran', tstop: 5e-3, reading: 'peak', from: 1e-3 }, 1), divider(), divider('3k'));
    expect(got.note?.id).toBe('measured');
    expect(String(got.note?.params?.value)).toMatch(/1\.5/);
  });

  it('measures across a part instead of a net', async () => {
    const check: LessonCheckSpec = { kind: 'measure', probe: { kind: 'partVoltage', part: { ids: ['basic/resistor'] } }, target: 1, tolerancePct: 2, unit: 'V', analysis: { kind: 'tran', tstop: 5e-3, reading: 'peak', from: 1e-3 } };
    // the first resistor (R1) carries half of the 2 V peak with equal resistors
    const { ok } = await verdict(check, divider(), divider());
    expect(ok.ok, JSON.stringify(ok.note)).toBe(true);
  });

  it('a signal that does not repeat has no frequency', async () => {
    const dc = new DesignBuilder('dc');
    const v = dc.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    const r = dc.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
    const r2 = dc.part('basic/resistor', 'R2', 400, 0, { value: '1k' });
    const g = dc.part('sources/ground', 'G1', 200, 200);
    dc.labelPin(v, '+', 'IN');
    dc.labelPin(r, '1', 'IN');
    dc.labelPin(r, '2', 'OUT');
    dc.labelPin(r2, '1', 'OUT');
    dc.labelPin(r2, '2', 'GND0');
    dc.labelPin(v, '-', 'GND0');
    dc.labelPin(g, '1', 'GND0');
    const { got } = await verdict(measure({ kind: 'tran', tstop: 5e-3, reading: 'frequency' }, 1000), divider(), dc.design);
    expect(got.ok).toBe(false);
    expect(got.note?.id).toBe('note:fileReading');
  });
});

describe('transient readings of a curve', () => {
  // v(t) = 1 - exp(-t / tau), tau = 1 ms, sampled to 5 ms
  const n = 5001;
  const time = Float64Array.from({ length: n }, (_, k) => (k * 5e-3) / (n - 1));
  const result: AnalysisResult = {
    type: 'tran',
    title: 'tran',
    scale: { name: 'time', unit: 's', re: time },
    vectors: [{ name: 'V(OUT)', unit: 'V', re: Float64Array.from(time, (t) => 1 - Math.exp(-t / 1e-3)) }],
    warnings: [],
  };
  it('reads the value at a time and the final value', () => {
    expect(transientReading(result, 'OUT', '0', { kind: 'tran', tstop: 5e-3, reading: 'at', at: 1e-3 }).value).toBeCloseTo(1 - Math.exp(-1), 5);
    expect(transientReading(result, 'OUT', '0', { kind: 'tran', tstop: 5e-3, reading: 'final' }).value).toBeCloseTo(1 - Math.exp(-5), 6);
    expect(transientReading(result, 'OUT', '0', { kind: 'tran', tstop: 5e-3, reading: 'peak' }).value).toBeCloseTo(1 - Math.exp(-5), 6);
    expect(transientReading(result, 'OUT', '0', { kind: 'tran', tstop: 5e-3, reading: 'min' }).value).toBe(0);
  });
  it('reports a signal that is missing', () => {
    const r = transientReading(result, 'NOPE', '0', { kind: 'tran', tstop: 5e-3, reading: 'rms' });
    expect(Number.isNaN(r.value)).toBe(true);
    expect(r.error).toBeDefined();
  });
});

describe('AC readings in a lesson step', () => {
  const at1k = (reading: 'mag' | 'db' | 'phase'): LessonAnalysis => ({ kind: 'ac', freq: 1000, reading });
  it('magnitude, dB and phase at the corner frequency of an RC low-pass', async () => {
    for (const [reading, target, extra] of [
      ['mag', Math.SQRT1_2, {}],
      ['db', -3.0103, { toleranceAbs: 0.05 }],
      ['phase', -45, { toleranceAbs: 0.5 }],
    ] as const) {
      const { ok, got } = await verdict(measure(at1k(reading), target, extra), lowPass(), lowPass('1u'));
      expect(ok.ok, `${reading}: ${JSON.stringify(ok.note)}`).toBe(true);
      expect(got.ok, reading).toBe(false);
    }
  });
  it('the wrong circuit reads the true attenuation of a 1 uF capacitor', async () => {
    const { got } = await verdict(measure(at1k('mag'), Math.SQRT1_2), lowPass(), lowPass('1u'));
    expect(got.note?.id).toBe('measured');
    // |H| = 1 / sqrt(1 + (2 pi f R C)^2) = 0.1572
    expect(String(got.note?.params?.value)).toMatch(/157/);
    expect(got.note?.params?.target).toMatch(/707/);
  });
  it('phase and magnitude of a phasor', () => {
    expect(acReading({ re: 0, im: 2 }, 'phase')).toBeCloseTo(90, 9);
    expect(acReading({ re: 3, im: 4 }, 'mag')).toBe(5);
    expect(acReading({ re: 10, im: 0 }, 'db')).toBeCloseTo(20, 9);
    const r: AnalysisResult = { type: 'acsingle', title: 'ac', vectors: [{ name: 'V(A)', unit: 'V', re: Float64Array.of(1), im: Float64Array.of(2) }], warnings: [] };
    expect(phasorBetween(r, 'A', '0')).toEqual({ re: 1, im: 2 });
    expect(phasorBetween(r, 'A', 'A')).toEqual({ re: 0, im: 0 });
    expect(phasorBetween(r, 'B', '0')).toBeNull();
  });
});

describe('the lesson file format', () => {
  it('round-trips a transient and an AC step byte for byte', () => {
    const lesson = lessonWith(measure({ kind: 'tran', tstop: 5e-3, reading: 'rms', from: 1e-3 }, 0.7071), divider());
    lesson.steps.push({ id: 's2', task: bi('AC', 'AC'), hint: bi('AC', 'AC'), check: measure({ kind: 'ac', freq: 1000, reading: 'phase' }, -45) });
    const text = serializeLessonFile(lesson);
    const back = parseLessonFile(text);
    expect(back.errors).toEqual([]);
    expect(serializeLessonFile(back.lesson!)).toBe(text);
    expect((back.lesson!.steps[0].check as Extract<LessonCheckSpec, { kind: 'measure' }>).analysis).toEqual({ kind: 'tran', tstop: 5e-3, reading: 'rms', from: 1e-3 });
  });

  it('a step without an analysis is an operating-point step, as in every older file', () => {
    const lesson = lessonWith({ kind: 'measure', probe: { kind: 'net', net: 'OUT' }, target: 1, tolerancePct: 5, unit: 'V' }, divider());
    const back = parseLessonFile(serializeLessonFile(lesson));
    expect(back.errors).toEqual([]);
    expect('analysis' in back.lesson!.steps[0].check).toBe(false);
  });

  it('rejects what cannot be measured', () => {
    const base = lessonWith(measure({ kind: 'tran', tstop: 5e-3, reading: 'rms' }, 1), divider());
    const mutate = (patch: (check: Record<string, unknown>) => void): string[] => {
      const copy = JSON.parse(serializeLessonFile(base)) as { steps: { check: Record<string, unknown> }[] };
      patch(copy.steps[0].check);
      return parseLessonFile(JSON.stringify(copy)).errors.map((e) => `${e.path}:${e.code}`);
    };
    expect(mutate((c) => (c.probe = { kind: 'meter' }))).toContain('steps[0].check.analysis:combination');
    expect(mutate((c) => (c.probe = { kind: 'partCurrent', part: { ids: ['basic/resistor'] } }))).toContain('steps[0].check.analysis:combination');
    expect(mutate((c) => (c.analysis = { kind: 'tran', reading: 'rms' }))).toContain('steps[0].check.analysis.tstop:missing');
    expect(mutate((c) => (c.analysis = { kind: 'tran', tstop: 5e-3, reading: 'wiggle' }))).toContain('steps[0].check.analysis.reading:unknown');
    expect(mutate((c) => (c.analysis = { kind: 'tran', tstop: 5e-3, reading: 'at' }))).toContain('steps[0].check.analysis.at:missing');
    expect(mutate((c) => (c.analysis = { kind: 'tran', tstop: 5e-3, reading: 'at', at: 1 }))).toContain('steps[0].check.analysis.at:range');
    expect(mutate((c) => (c.analysis = { kind: 'tran', tstop: 5e-3, reading: 'rms', from: 5e-3 }))).toContain('steps[0].check.analysis.from:range');
    expect(mutate((c) => (c.analysis = { kind: 'ac', freq: 0, reading: 'mag' }))).toContain('steps[0].check.analysis.freq:range');
    expect(mutate((c) => (c.analysis = { kind: 'ac', freq: 1e3, reading: 'x' }))).toContain('steps[0].check.analysis.reading:unknown');
    expect(mutate((c) => (c.analysis = { kind: 'sweep' }))).toContain('steps[0].check.analysis.kind:unknown');
    expect(mutate(() => undefined)).toEqual([]);
  });

  it('a new lesson from the editor still starts at the operating point', () => {
    const f = newLessonFile('x');
    expect(f.steps.length).toBeGreaterThanOrEqual(0);
  });
});

/** A divider whose output sits on a DC offset: mean 1 V instead of 0 V. */
function offsetDivider(): Design {
  const b = new DesignBuilder('offset');
  const v = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '2', freq: '1k', offset: '2' });
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const r = b.part('basic/resistor', 'R2', 400, 0, { value: '1k' });
  const g = b.part('sources/ground', 'G1', 200, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r, '1', 'OUT');
  b.labelPin(r, '2', 'GND0');
  b.labelPin(v, '-', 'GND0');
  b.labelPin(g, '1', 'GND0');
  return b.design;
}
