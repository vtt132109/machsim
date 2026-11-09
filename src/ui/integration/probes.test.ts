/**
 * Probes: reference probes, selectable readings (value, p-p, RMS, DC, frequency), several probes
 * on one wire, file round trip, and read-outs after a one-shot transient.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist } from '../../model/netlister';
import { parseDesign, serializeDesign } from '../../model/serialize';
import type { ProbeBinding } from '../../model/types';
import { runAnalyses } from '../../sim';
import { SignalHistory, lowerValues, probeText } from './live';
import { createEditor } from '../store/editorStore';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { SimulationIntegration } from './controller';
import { setLang } from '../../i18n';

setLang('en');

/** 12 V across R1 (1k) + R2 (2k): V(A) = 12, V(M) = 8. Probes are placed on pins. */
function divider() {
  const b = new DesignBuilder('ref');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 200, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 400, 0, { value: '2k' });
  b.labelPin(v, '+', 'A');
  b.labelPin(v, '-', '0');
  b.labelPin(r1, '1', 'A');
  b.labelPin(r1, '2', 'M');
  b.labelPin(r2, '1', 'M');
  b.labelPin(r2, '2', '0');
  b.part('sources/ground', 'G1', 0, 300);
  return { b, r1, r2 };
}

const v = (op: ReturnType<typeof runAnalyses>[number], name: string) => op.vectors.find((x) => x.name.toLowerCase() === name.toLowerCase())!.re[0];

describe('reference probes', () => {
  it('a voltage probe measures against the net of its reference probe', () => {
    const { b, r1 } = divider();
    const top = b.pin(r1, '1');
    const mid = b.pin(r1, '2');
    const ref = b.probe('reference', mid.x, mid.y, 'REF1');
    const p = b.probe('voltage', top.x, top.y, 'P1');
    p.refProbe = ref.id;
    const build = buildNetlist(b.design, { includeAnalysis: false });
    expect(build.erc).toEqual([]);
    const bp = build.probes.find((x) => x.name === 'P1')!;
    expect(bp.refName).toBe('REF1');
    const [op] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    const values = lowerValues(Object.fromEntries(op.vectors.map((x) => [x.name, x.re[0]])));
    expect(v(op, `V(${(bp.signal as { pos: string }).pos})`) - v(op, `V(${(bp.signal as { neg: string }).neg})`)).toBeCloseTo(4, 9);
    expect(probeText(bp, values)).toBe('V(–REF1): 4 V');
    // the reference probe itself reads its voltage to ground
    expect(probeText(build.probes.find((x) => x.name === 'REF1')!, values)).toBe('V: 8 V');
  });

  it('a missing reference probe falls back to ground with a warning', () => {
    const { b, r1 } = divider();
    const top = b.pin(r1, '1');
    const p = b.probe('voltage', top.x, top.y, 'P1');
    p.refProbe = 'nope';
    const build = buildNetlist(b.design, { includeAnalysis: false });
    expect(build.erc.map((m) => m.detail?.id)).toEqual(['probeRefMissing']);
    expect((build.probes[0].signal as { neg: string }).neg).toBe('0');
  });

  it('reference kind, refProbe and readings survive a file round trip', () => {
    const { b, r1 } = divider();
    const at = b.pin(r1, '2');
    const ref = b.probe('reference', at.x, at.y, 'R');
    const p = b.probe('voltage', at.x, at.y + 0, 'P');
    p.refProbe = ref.id;
    p.show = ['value', 'freq'];
    const back = parseDesign(serializeDesign(b.design));
    const probes = back.sheets[0].probes;
    expect(probes.map((x) => x.kind)).toEqual(['reference', 'voltage']);
    expect(probes[1]).toMatchObject({ refProbe: ref.id, show: ['value', 'freq'] });
    const bad = JSON.parse(serializeDesign(b.design));
    bad.sheets[0].probes[1].show = ['loud'];
    expect(() => parseDesign(JSON.stringify(bad))).toThrow(/show/);
  });
});

describe('probe readings', () => {
  const binding: ProbeBinding = { probeId: 'p', name: 'P', kind: 'voltage', color: '#f00', signal: { kind: 'voltage', pos: 'out', neg: '0' } };
  const sine = () => {
    const h = new SignalHistory();
    // 1 kHz, 2 V amplitude, 1 V offset, over 50 ms
    for (let i = 0; i <= 4000; i++) {
      const t = i * 12.5e-6;
      h.push(t, 1 + 2 * Math.sin(2 * Math.PI * 1000 * t));
    }
    return h;
  };

  it('frequency from the rising crossings of the mean', () => {
    expect(sine().frequency(0.1)!).toBeCloseTo(1000, 0);
    const flat = new SignalHistory();
    for (let i = 0; i < 10; i++) flat.push(i, 3);
    expect(flat.frequency(100)).toBeNull();
  });

  it('shows the selected readings, two per line', () => {
    const text = probeText({ ...binding, show: ['value', 'pp', 'rms', 'dc', 'freq'] }, new Map([['v(out)', 1]]), sine());
    const lines = text.split('\n');
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe('V: 1 V  Vpp: 4 V');
    // RMS of 1 + 2 sin = sqrt(1 + 2) = 1.732; mean 1 V
    expect(lines[1]).toBe('rms: 1.73 V  dc: 1 V');
    expect(lines[2]).toBe('f: 1 kHz');
    // without a selection: value plus p-p / rms
    expect(probeText(binding, new Map([['v(out)', 1]]), sine()).split('\n')[1]).toBe('Vpp: 4 V  rms: 1.73 V');
  });
});

describe('probes after a one-shot transient', () => {
  it('show the final value and the statistics of the run', async () => {
    const b = new DesignBuilder('rc');
    const v1 = b.part('sources/ac-voltage', 'V1', 0, 0, { amplitude: '2', freq: '1k' });
    const r = b.part('basic/resistor', 'R1', 200, 0, { value: '1' });
    b.labelPin(v1, '+', 'IN');
    b.labelPin(v1, '-', '0');
    b.labelPin(r, '1', 'IN');
    b.labelPin(r, '2', '0');
    b.part('sources/ground', 'G1', 0, 300);
    const at = b.pin(r, '1');
    const p = b.probe('voltage', at.x, at.y, 'P1');
    p.show = ['pp', 'freq'];
    b.design.analysis.active = 'tran';
    b.design.analysis.specs.tran = { type: 'tran', tstep: 1e-5, tstop: 0.1 };
    const editor = createEditor({ design: b.design });
    const ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()) });
    await ctrl.run();
    expect(ctrl.live.getState().mode).toBe('idle');
    const text = editor.getState().probeValues[p.id];
    expect(text).toBe('Vpp: 4 V  f: 1 kHz');
    ctrl.dispose();
  });
});
