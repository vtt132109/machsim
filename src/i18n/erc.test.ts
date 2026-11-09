/**
 * Beginner-friendly ERC and simulation-error explanations: what is wrong (with the names from
 * the circuit), why, and how to fix it — in the current language — for real netlister output.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildNetlist } from '../model/netlister';
import { DesignBuilder } from '../model/designkit';
import { setLang } from './core';
import { explainErc, explainSimError, mentionedRefdes, ruleText, severityText } from './erc';

afterEach(() => setLang('vi'));

function noGroundDesign() {
  const b = new DesignBuilder('t');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
  const r = b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
  b.wire(b.pin(v, '+'), b.pin(r, '1'));
  b.wire(b.pin(v, '-'), b.pin(r, '2'));
  return b.design;
}

describe('ERC explanations', () => {
  it('explains a missing ground in Vietnamese and English', () => {
    const m = buildNetlist(noGroundDesign()).erc.find((x) => x.code === 'no-ground')!;
    expect(m.detail?.id).toBe('noGround');
    const vi = explainErc(m);
    expect(vi.title).toBe('Mạch chưa có điểm đất');
    expect(vi.why).toMatch(/0 V/);
    expect(vi.fix).toMatch(/Đất \(Ground\)/);
    setLang('en');
    expect(explainErc(m).fix).toMatch(/Ground/);
  });

  it('names the part and pin of an open pin and tells how to wire it', () => {
    const b = new DesignBuilder('t');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '5' });
    b.part('sources/ground', 'GND1', 0, 100);
    const r = b.part('basic/resistor', 'R7', 100, 0, { value: '1k' });
    b.wire(b.pin(v, '+'), b.pin(r, '1'));
    b.wire(b.pin(v, '-'), { x: 0, y: 100 });
    const m = buildNetlist(b.design).erc.find((x) => x.code === 'floating-pin' && x.refdes === 'R7')!;
    const e = explainErc(m);
    expect(e.title).toBe('Chân 2 của R7 chưa được nối');
    expect(e.fix).toMatch(/chân 2/);
    expect(severityText(m.severity)).toBe('Cảnh báo');
    expect(ruleText(m.code)).toBe('Chân hở');
  });

  it('falls back to the rule explanation for messages without detail', () => {
    const e = explainErc({ severity: 'error', code: 'voltage-loop', message: 'V1 and V2 in parallel' });
    expect(e.title).toBe('V1 and V2 in parallel');
    expect(e.fix).toMatch(/nguồn/);
  });
});

describe('simulation error explanations', () => {
  it('recognises a floating node, a timestep failure and a convergence failure', () => {
    const s = explainSimError('Singular matrix: no valid pivot for node V(n3); the node may be floating');
    expect(s.title).toContain('node V(n3)');
    expect(s.fix).toMatch(/1 MΩ/);
    expect(explainSimError('Timestep too small at t = 1.2e-3 s (step 1e-15 s): x').title).toContain('1.2e-3');
    expect(explainSimError('Operating point did not converge (Newton, gmin stepping and source stepping failed): V(a)').title).toMatch(/hội tụ/);
    expect(explainSimError('something odd').detail).toBe('something odd');
    setLang('en');
    expect(explainSimError('Simulation cancelled').title).toBe('The simulation was stopped');
  });

  it('finds the parts an error message names', () => {
    expect(mentionedRefdes('R1: bad value; branch current of V_XFG1_p and Q12')).toEqual(['R1', 'XFG1', 'Q12']);
  });
});

describe('explanations of the round-2 ERC checks', () => {
  afterEach(() => setLang('vi'));
  it('unread number text, indicators and interactive parts inside a block are explained in Vietnamese', () => {
    setLang('vi');
    const unread = explainErc({ severity: 'error', code: 'bad-param', message: 'x', detail: { id: 'paramUnreadText', params: { refdes: 'R1', label: 'Điện trở', text: '4.7.3k', rest: '.3k', value: '4.7 Ω' } } });
    expect(unread.title).toContain('.3k');
    expect(unread.why).toContain('4.7 Ω');
    expect(unread.fix).toContain('4,7k');
    const led = explainErc({ severity: 'warning', code: 'other', message: 'x', detail: { id: 'indicatorInBlock', params: { refdes: 'LED1', block: 'SC_LIGHT' } } });
    expect(led.title).toBe('LED1 nằm trong khối SC_LIGHT nên sẽ không sáng');
    const sw = explainErc({ severity: 'warning', code: 'other', message: 'x', detail: { id: 'interactiveInBlock', params: { refdes: 'S1', block: 'B' } } });
    expect(sw.title).toContain('S1');
    expect(sw.fix.length).toBeGreaterThan(10);
  });
});
