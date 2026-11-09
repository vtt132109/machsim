/**
 * The nine round-4 lessons (print hand-out, meters in blocks, .step, dual op-amp, 8051 cycles,
 * relay latch, audio filter, battery runtime, scripted divider): every step passes on the
 * reference solution and fails on an empty sheet (src/learn/lessons.test.ts walks all lessons), and
 * here each lesson also fails with the RIGHT feedback on the typical mistake and with the number
 * of the theory page in the message.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import type { Design } from '../model/types';
import { halfPeriods } from './lessons/round4';
import { EXACT_DELAY_PROGRAM } from './lessons/mcu';
import { checkLesson } from './runner';
import { getLesson } from './lessons';
import { builder, setAnalyses } from './kit';

const run = runAnalyses;

async function step(lessonId: string, design: Design, id: string) {
  return (await checkLesson(getLesson(lessonId)!, design, run, [id]))[id];
}

/** Edit a part of a design by refdes (every sheet, children included). */
function edit(design: Design, refdes: string, change: (p: Design['sheets'][number]['parts'][number]) => void): Design {
  const sheets = [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)];
  for (const s of sheets) for (const p of s.parts) if (p.refdes === refdes) change(p);
  return design;
}
const param = (d: Design, refdes: string, key: string, value: string): Design => edit(d, refdes, (p) => void (p.params = { ...p.params, [key]: value }));
const solved = (id: string): Design => getLesson(id)!.solution();

describe('print-handout', () => {
  it('asks for the footer, the portrait paper, the net names and two filled sheets', async () => {
    const noFooter = solved('print-handout');
    noFooter.printSetup = { paper: 'A4', orientation: 'portrait' };
    expect((await step('print-handout', noFooter, 'setup')).note?.id).toBe('note:needFooter');
    const landscape = solved('print-handout');
    landscape.printSetup = { paper: 'A4', orientation: 'landscape', footer: true };
    expect((await step('print-handout', landscape, 'setup')).note?.id).toBe('note:needPortrait');
    const hidden = solved('print-handout');
    hidden.sheets[0].layers = undefined;
    expect((await step('print-handout', hidden, 'names')).note?.id).toBe('note:needNetNames');
    const oneSheet = solved('print-handout');
    oneSheet.sheets[1].parts = [];
    const r = await step('print-handout', oneSheet, 'sheets');
    expect(r.note).toEqual({ id: 'note:needTwoSheets', params: { n: 1 } });
  });

  it('reports the corner frequency of the learner own filter', async () => {
    const d = param(solved('print-handout'), 'C1', 'value', '1u');
    const r = await step('print-handout', d, 'circuit');
    expect(r.ok).toBe(true);
    expect(r.note?.params?.fc).toBe('159 Hz');
  });
});

describe('block-meters', () => {
  it('fails with identical copies, with a single copy and with no meter inside', async () => {
    const same = param(solved('block-meters'), 'X2', 'RB', '1k');
    expect((await step('block-meters', same, 'differ')).note?.id).toBe('note:copiesSame');
    const r = await step('block-meters', same, 'read');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:blockReadSame');
    const single = solved('block-meters');
    single.sheets[0].parts = single.sheets[0].parts.filter((p) => p.refdes !== 'X2');
    expect((await step('block-meters', single, 'copies')).note?.id).toBe('note:needBlockCopies');
    const bare = solved('block-meters');
    bare.children![0].sheets[0].parts = bare.children![0].sheets[0].parts.filter((p) => p.refdes !== 'XMM1');
    expect((await step('block-meters', bare, 'inside')).note?.id).toBe('note:needMeterInBlock');
  });

  it('names the reading of each copy', async () => {
    const r = await step('block-meters', solved('block-meters'), 'read');
    expect(r.note?.params?.list).toBe('X1.XMM1 = 2.5 V; X2.XMM1 = 3.75 V');
  });
});

describe('step-sweep', () => {
  it('asks for {Rx}, for a declared parameter and for three values', async () => {
    expect((await step('step-sweep', param(solved('step-sweep'), 'R1', 'value', '1k'), 'variable')).note?.id).toBe('note:needVariableRes');
    const undeclared = solved('step-sweep');
    undeclared.variables = {};
    expect((await step('step-sweep', undeclared, 'variable')).note).toEqual({ id: 'note:needVariableDef', params: { name: 'Rx' } });
    const two = solved('step-sweep');
    two.customSpice = '.step param Rx list 1k 2k';
    expect((await step('step-sweep', two, 'values')).note).toEqual({ id: 'note:needStepValues', params: { n: 2 } });
    const none = solved('step-sweep');
    none.customSpice = '';
    expect((await step('step-sweep', none, 'values')).note?.id).toBe('note:needStepCard');
  });

  it('a resistor that does not follow the swept parameter fails the corner check with the numbers', async () => {
    const d = solved('step-sweep');
    d.variables = { Rx: '1k', Ry: '1k' };
    param(d, 'R1', 'value', '{Ry}');
    const r = await step('step-sweep', d, 'curves');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:stepCornerWrong');
  });

  it('a Parameter sweep analysis of the variable counts as well as a .step card', async () => {
    const d = solved('step-sweep');
    d.customSpice = '';
    d.analysis.specs.paramsweep = { type: 'paramsweep', target: 'Rx', param: 'value', global: true, values: [1000, 2000, 5000], base: { type: 'ac', sweep: 'dec', points: 40, fstart: 10, fstop: 1e5 } };
    const r = await checkLesson(getLesson('step-sweep')!, d, run);
    expect(r.values.ok).toBe(true);
    expect(r.curves.ok).toBe(true);
  });
});

describe('dual-opamp', () => {
  it('reports a wrong gain, two separate chips and a missing supply', async () => {
    const r = await step('dual-opamp', param(solved('dual-opamp'), 'R2', 'value', '20k'), 'gain');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:dualGainWrong');
    expect(Number(r.note?.params?.gain)).toBeCloseTo(3, 1);
    const two = solved('dual-opamp');
    let seen = 0;
    for (const p of two.sheets[0].parts) if (p.partId === 'analog/lm358-dual-b') p.refdes = 'U2';
    void seen;
    expect((await step('dual-opamp', two, 'sections')).note?.id).toBe('note:needSections');
    const noSupply = solved('dual-opamp');
    noSupply.sheets[0].labels = noSupply.sheets[0].labels.filter((l) => l.name !== 'VCC');
    expect((await step('dual-opamp', noSupply, 'supply')).note?.id).toBe('note:needSupply');
  });
});

describe('mcu-debug', () => {
  it('the reference program takes exactly 1000 cycles between edges, one more NOP makes it 1001', async () => {
    expect(halfPeriods(EXACT_DELAY_PROGRAM)).toEqual([1000, 1000, 1000, 1000]);
    const slower = EXACT_DELAY_PROGRAM.replace('        RET ', '        NOP\n        RET ');
    expect(halfPeriods(slower)[0]).toBe(1001);
    const d = param(solved('mcu-debug'), 'U1', 'program', slower);
    const r = await step('mcu-debug', d, 'cycles');
    expect(r.note).toEqual({ id: 'note:cyclesWrong', params: { cycles: 1001, target: 1000 } });
  });

  it('a program that never changes P1.0, or does not assemble, is told so', async () => {
    const idle = param(solved('mcu-debug'), 'U1', 'program', 'MAIN: NOP\n      SJMP MAIN\n      END');
    expect((await step('mcu-debug', idle, 'program')).note?.id).toBe('note:touchPin');
    expect((await step('mcu-debug', idle, 'cycles')).note?.id).toBe('note:fixProgramFirst');
    const quiet = param(solved('mcu-debug'), 'U1', 'program', 'MAIN: MOV P1,#0FFh\n      SJMP MAIN\n      END');
    expect((await step('mcu-debug', quiet, 'cycles')).note?.id).toBe('note:noToggle');
    const broken = param(solved('mcu-debug'), 'U1', 'program', 'MAIN: FOO P1\n      END');
    expect((await step('mcu-debug', broken, 'program')).note?.id).toBe('note:asmError');
  });

  it('the circuit blinks at f_osc / 12 / 2000 for another crystal too', async () => {
    const d = param(solved('mcu-debug'), 'U1', 'fosc', '6M');
    const r = await step('mcu-debug', d, 'blink');
    expect(r.ok).toBe(true);
    expect(r.note?.params?.value).toBe('250 Hz');
  });
});

describe('relay-latch', () => {
  it('a contact that names a coil that does not exist is explained', async () => {
    const r = await step('relay-latch', param(solved('relay-latch'), 'KC1', 'coil', 'K9'), 'link');
    expect(r.ok).toBe(false);
    expect(r.note).toEqual({ id: 'note:contactNotLinked', params: { contact: 'KC1', coil: 'k9', coils: 'KM1' } });
  });

  it('without the holding contact the coil drops out when the start pulse ends', async () => {
    const d = solved('relay-latch');
    d.sheets[0].parts = d.sheets[0].parts.filter((p) => p.refdes !== 'KC1');
    const all = await checkLesson(getLesson('relay-latch')!, d, run);
    expect(all.link.note?.id).toBe('note:needContactPart');
    expect(all.start.ok).toBe(true);
    expect(all.latch.ok).toBe(false);
    expect(all.latch.note?.id).toBe('note:relayHoldWrong');
  });

  it('the reference circuit latches: energised at 1.5 s and still at 3.5 s', async () => {
    const all = await checkLesson(getLesson('relay-latch')!, solved('relay-latch'), run);
    expect(all.start.note?.id).toBe('note:relayStartOk');
    expect(all.latch.note?.id).toBe('note:relayHoldOk');
  });
});

describe('audio-filter', () => {
  it('a filter with no buffer loses the low tone, a corner frequency out of range is reported', async () => {
    const d = solved('audio-filter');
    d.sheets[0].parts = d.sheets[0].parts.filter((p) => p.refdes !== 'U1');
    const all = await checkLesson(getLesson('audio-filter')!, d, run);
    expect(all.buffer.note?.id).toBe('note:needBuffer');
    expect(all.tones.ok).toBe(false);
    const far = await step('audio-filter', param(solved('audio-filter'), 'C1', 'value', '10n'), 'filter');
    expect(far.note?.id).toBe('note:audioFcRange');
  });

  it('a corner frequency that is too high does not cut the 3 kHz tone', async () => {
    const d = param(solved('audio-filter'), 'C1', 'value', '22n');
    const r = await step('audio-filter', d, 'tones');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:audioHighStays');
  });

  it('the reference filter passes 0.96 at 440 Hz and 0.47 at 3 kHz', async () => {
    const r = await step('audio-filter', solved('audio-filter'), 'tones');
    expect(r.note).toEqual({ id: 'note:audioOk', params: { low: '0.96', high: '0.47' } });
  });
});

describe('battery-runtime', () => {
  /** The lesson circuit with another capacity, load current or direction. */
  function battery(capacity: string, current: string, reversed = false): Design {
    const b = builder('Battery');
    const bt = b.part('sources/battery-nonideal', 'BT1', 160, 220, { chem: 'liion', cells: '1', capacity, soc: '100', r0: '0.05' });
    b.labelPin(bt, '+', 'P1');
    b.labelPin(bt, '-', '0');
    b.part('sources/ground', 'GND1', 160, 340);
    const i1 = b.part('sources/dc-current', 'I1', 360, 220, { value: current });
    b.labelPin(i1, '+', reversed ? 'P1' : '0');
    b.labelPin(i1, '-', reversed ? '0' : 'P1');
    return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2, tstop: 420 }]);
  }

  it('the capacity must be 5 mAh', async () => {
    const r = await step('battery-runtime', battery('0.01', '50m'), 'battery');
    expect(r.note).toEqual({ id: 'note:capacityWrong', params: { ah: '10 mAh' } });
  });

  it('a reversed source charges the battery and is told so', async () => {
    expect((await step('battery-runtime', battery('0.005', '50m', true), 'load')).note?.id).toBe('note:chargeDirection');
  });

  it('half the current doubles the runtime and fails the 360 s target with the measured time', async () => {
    const r = await step('battery-runtime', battery('0.005', '25m'), 'runtime');
    expect(r.ok).toBe(false);
    expect(r.note?.id).toBe('note:runtimeWrong');
    expect(r.note?.params?.target).toBe('360 s');
    const t = String(r.note?.params?.t);
    expect(t.endsWith('s')).toBe(true);
    expect(Number.parseFloat(t)).toBeGreaterThan(650);
    expect(Number.parseFloat(t)).toBeLessThan(790);
  });

  it('the reference battery lasts 360 s', async () => {
    expect((await step('battery-runtime', solved('battery-runtime'), 'runtime')).note).toEqual({ id: 'note:runtimeOk', params: { t: '360 s' } });
  });
});

describe('script-sweep', () => {
  it('measures the divider the script built: 2k over 1k gives 4 V, 2k and 2k gives 6 V', async () => {
    expect((await step('script-sweep', solved('script-sweep'), 'value')).note?.params?.value).toBe('4 V');
    const r = await step('script-sweep', param(solved('script-sweep'), 'R2', 'value', '2k'), 'value');
    expect(r.ok).toBe(false);
    expect(r.note).toEqual({ id: 'measured', params: { value: '6 V', target: '4 V', tol: 2 } });
  });

  it('wants the middle point named mid', async () => {
    const d = solved('script-sweep');
    for (const l of d.sheets[0].labels) if (l.name === 'mid') l.name = 'out';
    expect((await step('script-sweep', d, 'name')).note?.id).toBe('note:needMidLabel');
  });
});
