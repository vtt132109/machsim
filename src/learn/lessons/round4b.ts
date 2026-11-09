/**
 * Lessons built on the features of round 4 (part 2): a relay latch whose coil and contact are
 * linked by name, listening to a filter through a speaker, the runtime of a battery, and a divider
 * built by a script. Part 1 (hand-out, meters in blocks, `.step`, dual op-amp, 8051 debugging) is
 * in round4.ts. Text: src/i18n/lessons/round4b.ts.
 */
import { getPart } from '../../library';
import { asLibraryPart } from '../../library/partkit';
import type { Design } from '../../model/types';
import type { LessonCircuit, PartRef } from '../circuit';
import { builder, fail, fmt, isResult, M, measured, near, need, pass, plusNet, setAnalyses, withSim } from '../kit';
import type { CheckResult, LessonDef } from '../types';
import { crossingTime, rcStage } from './round4';

// ---------------------------------------------------------------------------------------------
// 6. A relay latch: the coil and its holding contact are joined by name

function latchDesign(): Design {
  const b = builder('Relay latch');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 220, { value: '24' });
  b.labelPin(v1, '+', 'P24');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const v2 = b.part('sources/pulse-voltage', 'V2', 100, 440, { v1: '0', v2: '24', delay: '1', rise: '1m', fall: '1m', width: '1', period: '100' });
  b.labelPin(v2, '+', 'START');
  b.labelPin(v2, '-', '0');
  const d1 = b.part('diodes/1n4007', 'D1', 300, 440);
  b.labelPin(d1, 'A', 'START');
  b.labelPin(d1, 'K', 'COIL');
  const kc1 = b.part('electromechanical/contactor-aux-no', 'KC1', 300, 160, { coil: 'KM1' });
  b.labelPin(kc1, '13', 'P24');
  b.labelPin(kc1, '14', 'COIL');
  const km1 = b.part('electromechanical/contactor-coil-24vdc', 'KM1', 520, 260);
  b.labelPin(km1, 'A1', 'COIL');
  b.labelPin(km1, 'A2', '0');
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 0.01, tstop: 4 }]);
}

/** The coils (drivers) and the contacts that name a coil, among the placed parts. */
function relayParts(c: LessonCircuit): { coils: PartRef[]; contacts: { ref: PartRef; coil: string }[] } {
  const coils: PartRef[] = [];
  const contacts: { ref: PartRef; coil: string }[] = [];
  for (const sheet of c.design.sheets) {
    for (const inst of sheet.parts) {
      const def = getPart(inst.partId);
      if (!def || inst.excludeFromSim) continue;
      const link = asLibraryPart(def).contactLink;
      if (!link) continue;
      const ref: PartRef = { inst, def, sheetId: sheet.id };
      if (link.role === 'driver') coils.push(ref);
      else contacts.push({ ref, coil: c.text(ref, link.param) });
    }
  }
  return { coils, contacts };
}

/** Pin of a coil that is not on ground: the net the supply reaches. */
function coilNet(c: LessonCircuit, coil: PartRef): string | undefined {
  return c.pinNets(coil).find((n) => n && n !== '0');
}

export const relayLatch: LessonDef = {
  id: 'relay-latch',
  level: 'automation',
  solution: latchDesign,
  steps: [
    {
      id: 'link',
      check: (c) => {
        const { coils, contacts } = relayParts(c);
        if (!coils.length) return fail('note:needCoilPart');
        if (!contacts.length) return fail('note:needContactPart');
        const names = coils.map((k) => k.inst.refdes.toLowerCase());
        const hit = contacts.find((k) => names.includes(k.coil));
        if (hit) return pass('note:linkOk', { contact: hit.ref.inst.refdes, coil: coils.find((k) => k.inst.refdes.toLowerCase() === hit.coil)!.inst.refdes });
        return fail('note:contactNotLinked', { contact: contacts[0].ref.inst.refdes, coil: contacts[0].coil || '—', coils: coils.map((k) => k.inst.refdes).join(', ') });
      },
    },
    {
      id: 'hold',
      check: (c) => {
        const { coils, contacts } = relayParts(c);
        const linked = contacts.find((k) => coils.some((q) => q.inst.refdes.toLowerCase() === k.coil));
        if (!linked) return fail('note:needContactPart');
        const coil = coils.find((q) => q.inst.refdes.toLowerCase() === linked.coil)!;
        const net = coilNet(c, coil);
        const nets = c.pinNets(linked.ref);
        if (!net || !nets.includes(net)) return fail('note:needHold');
        const other = nets.find((n) => n !== net);
        return other && other !== '0' ? pass() : fail('note:needHoldSupply');
      },
    },
    {
      id: 'start',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const { coils } = relayParts(c);
          if (!coils.length) return fail('note:needCoilPart');
          const sim = await c.tran(4, 0.01);
          const node = `${coils[0].inst.refdes}.st`;
          const before = sim.at(node, 0.5);
          const during = sim.at(node, 1.5);
          if (!(before < 0.1)) return fail('note:relayEarly', { value: before.toFixed(2) });
          return during > 0.9 ? pass('note:relayStartOk') : fail('note:relayStartWrong', { value: Number.isFinite(during) ? during.toFixed(2) : '—' });
        }),
    },
    {
      id: 'latch',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const { coils } = relayParts(c);
          if (!coils.length) return fail('note:needCoilPart');
          const sim = await c.tran(4, 0.01);
          const late = sim.at(`${coils[0].inst.refdes}.st`, 3.5);
          return late > 0.9 ? pass('note:relayHoldOk') : fail('note:relayHoldWrong', { value: Number.isFinite(late) ? late.toFixed(2) : '—' });
        }),
    },
  ],
  quiz: [
    { id: 'name', options: 3, answer: 1 },
    { id: 'hold', options: 3, answer: 2 },
    { id: 'diode', options: 3, answer: 0 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 7. Listening to a filter

function audioDesign(): Design {
  const b = builder('Listen to a filter');
  const v1 = b.part('sources/ac-voltage', 'V1', 100, 220, { amplitude: '1', freq: '440' });
  b.labelPin(v1, '+', 'IN');
  b.labelPin(v1, '-', '0');
  b.part('sources/ground', 'GND1', 100, 320);
  b.wire(b.pin(v1, '-'), { x: 100, y: 320 });
  const r1 = b.part('basic/resistor', 'R1', 260, 160, { value: '1k' });
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'F');
  const c1 = b.part('basic/capacitor', 'C1', 380, 240, { value: '100n' }, { rotation: 90 });
  b.labelPin(c1, '1', 'F');
  b.labelPin(c1, '2', '0');
  const u1 = b.part('analog/opamp-ideal-3', 'U1', 540, 180);
  b.labelPin(u1, 'IN+', 'F');
  b.labelPin(u1, 'IN-', 'OUT');
  b.labelPin(u1, 'OUT', 'OUT');
  const ls = b.part('indicators/speaker', 'LS1', 720, 200);
  b.labelPin(ls, '+', 'OUT');
  b.labelPin(ls, '-', '0');
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 0.02 }, { type: 'ac', sweep: 'dec', points: 20, fstart: 10, fstop: 1e5 }]);
}

const SPEAKERS = ['indicators/speaker', 'indicators/headphones'];

export const audioFilter: LessonDef = {
  id: 'audio-filter',
  level: 'workflow',
  solution: audioDesign,
  steps: [
    {
      id: 'speaker',
      check: (c) => {
        const sp = c.parts({ ids: SPEAKERS });
        if (!sp.length) return fail('note:needSpeaker');
        return c.pinConnected(sp[0], '+') && c.pinConnected(sp[0], '-') ? pass() : fail('note:speakerWires');
      },
    },
    {
      id: 'filter',
      check: (c) => {
        const stage = rcStage(c);
        if (!stage) return fail('note:needRcPair');
        const fc = 1 / (2 * Math.PI * c.num(stage.r, 'value') * c.num(stage.cap, 'value'));
        if (!Number.isFinite(fc)) return fail('note:needRcPair');
        return fc >= 800 && fc <= 3000 ? pass('note:audioFcOk', { fc: fmt(fc, 'Hz') }) : fail('note:audioFcRange', { fc: fmt(fc, 'Hz') });
      },
    },
    {
      id: 'buffer',
      check: (c) => {
        const sp = c.parts({ ids: SPEAKERS });
        if (!sp.length) return fail('note:needSpeaker');
        const net = c.net(sp[0], '+');
        const amp = c.parts(M.opamp).find((o) => c.net(o, 'OUT') === net);
        return amp ? pass() : fail('note:needBuffer');
      },
    },
    {
      id: 'tones',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const src = need(c, M.acSource, 'acSource');
          if (isResult(src)) return src;
          const sp = c.parts({ ids: SPEAKERS });
          if (!sp.length) return fail('note:needSpeaker');
          const input = plusNet(c, src[0]);
          const out = c.net(sp[0], '+');
          const ratio = async (f: number): Promise<number> => {
            const v = await c.acAt(f);
            const vin = Math.hypot(v.phasor(input).re, v.phasor(input).im);
            return vin > 1e-12 ? Math.hypot(v.phasor(out).re, v.phasor(out).im) / vin : 0;
          };
          const low = await ratio(440);
          const high = await ratio(3000);
          if (!(low >= 0.9)) return fail('note:audioLowLost', { ratio: low.toFixed(2) });
          if (!(high <= 0.55)) return fail('note:audioHighStays', { ratio: high.toFixed(2) });
          return pass('note:audioOk', { low: low.toFixed(2), high: high.toFixed(2) });
        }),
    },
  ],
  quiz: [
    { id: 'buffer', options: 3, answer: 0 },
    { id: 'pitch', options: 3, answer: 1 },
    { id: 'cut', options: 3, answer: 2 },
  ],
};

// ---------------------------------------------------------------------------------------------
// 8. Battery runtime

/** Capacity (Ah) and constant current (A) of the lesson: C * 3600 / I = 360 s. */
const BATTERY_AH = 0.005;
const RUNTIME_S = 360;

function batteryDesign(): Design {
  const b = builder('Battery runtime');
  const bt = b.part('sources/battery-nonideal', 'BT1', 160, 220, { chem: 'liion', cells: '1', capacity: '0.005', soc: '100', r0: '0.05' });
  b.labelPin(bt, '+', 'P1');
  b.labelPin(bt, '-', '0');
  b.part('sources/ground', 'GND1', 160, 340);
  b.wire(b.pin(bt, '-'), { x: 160, y: 340 });
  const i1 = b.part('sources/dc-current', 'I1', 360, 220, { value: '50m' });
  b.labelPin(i1, '+', '0');
  b.labelPin(i1, '-', 'P1');
  return setAnalyses(b.design, 'tran', [{ type: 'op' }, { type: 'tran', tstep: 2, tstop: 420 }]);
}

function batteryOf(c: LessonCircuit): PartRef | undefined {
  return c.parts({ families: ['Batteries'] })[0];
}

export const batteryRuntime: LessonDef = {
  id: 'battery-runtime',
  level: 'workflow',
  solution: batteryDesign,
  steps: [
    {
      id: 'battery',
      check: (c) => {
        const bt = batteryOf(c);
        if (!bt) return fail('note:needBattery');
        const ah = c.num(bt, 'capacity');
        return ah >= 0.0045 && ah <= 0.0055 ? pass() : fail('note:capacityWrong', { ah: fmt(ah * 1000, 'mAh') });
      },
    },
    {
      id: 'load',
      check: (c) => {
        const bt = batteryOf(c);
        if (!bt) return fail('note:needBattery');
        const src = c.parts({ ids: ['sources/dc-current'] })[0];
        if (!src) return fail('note:needLoadSource');
        const [bp, bn] = [c.net(bt, '+'), c.net(bt, '-')];
        const [sp, sn] = [c.net(src, '+'), c.net(src, '-')];
        if (sp === bn && sn === bp) return pass();
        if (sp === bp && sn === bn) return fail('note:chargeDirection');
        return fail('note:loadNotAcross');
      },
    },
    {
      id: 'runtime',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const bt = batteryOf(c);
          if (!bt) return fail('note:needBattery');
          const sim = await c.tran(420, 2);
          const t50 = crossingTime(sim.time, sim.wave(`${bt.inst.refdes}.soc`), 0.5, true);
          if (!Number.isFinite(t50)) return fail('note:neverHalf');
          const runtime = 2 * t50;
          return near(runtime, RUNTIME_S, 6) ? pass('note:runtimeOk', { t: fmt(runtime, 's') }) : fail('note:runtimeWrong', { t: fmt(runtime, 's'), target: fmt(RUNTIME_S, 's') });
        }),
    },
  ],
  quiz: [
    { id: 'formula', options: 3, answer: 2 },
    { id: 'sag', options: 3, answer: 0 },
    { id: 'direction', options: 3, answer: 1 },
  ],
};

export const BATTERY_LESSON = { capacityAh: BATTERY_AH, runtime: RUNTIME_S };

// ---------------------------------------------------------------------------------------------
// 9. A divider built by a script

function scriptDesign(): Design {
  const b = builder('Divider by script');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 200, 150, { value: '2k' });
  const r2 = b.part('basic/resistor', 'R2', 300, 200, { value: '1k' }, { rotation: 90 });
  b.labelPin(v1, '+', 'in');
  b.labelPin(r1, '1', 'in');
  b.labelPin(r1, '2', 'mid');
  b.labelPin(r2, '1', 'mid');
  b.labelPin(v1, '-', '0');
  b.labelPin(r2, '2', '0');
  b.part('sources/ground', 'GND1', 100, 300);
  b.wire(b.pin(v1, '-'), { x: 100, y: 300 });
  return setAnalyses(b.design, 'op', [{ type: 'op' }]);
}

export const scriptSweep: LessonDef = {
  id: 'script-sweep',
  level: 'workflow',
  solution: scriptDesign,
  steps: [
    {
      id: 'parts',
      check: (c): CheckResult => {
        const src = need(c, M.dcSource, 'source');
        if (isResult(src)) return src;
        const rs = need(c, M.resistor, 'resistor', 2);
        return isResult(rs) ? rs : pass();
      },
    },
    {
      id: 'name',
      check: (c) => (c.namedNet('mid') ? pass() : fail('note:needMidLabel')),
    },
    {
      id: 'value',
      simulates: true,
      check: (c) =>
        withSim(c, async () => {
          const mid = c.namedNet('mid');
          if (!mid) return fail('note:needMidLabel');
          const op = await c.op();
          return measured(op.v(mid), 4, 2, 'V');
        }),
    },
  ],
  quiz: [
    { id: 'await', options: 3, answer: 1 },
    { id: 'where', options: 3, answer: 0 },
    { id: 'safe', options: 3, answer: 2 },
  ],
};
