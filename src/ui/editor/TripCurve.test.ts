import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getPart, loadAllGroups } from '../../library';
import { breakerTripTime, fuseMeltTime } from '../../library/catalog/protection';
import { overloadTripTime } from '../../library/catalog/relays';
import { audioState, resetAudioState } from '../../audio/monitor';
import { AudioPanel } from '../integration/AudioPanel';
import { exportableTraces } from '../integration/WavExportDialog';
import type { PartInstance } from '../../model/types';
import { TripCurve, curveOf } from './TripCurve';
import { setLang } from '../../i18n';

await loadAllGroups();

describe('trip curves of the protective parts', () => {
  it('the breaker curve is the model formula with the instance values, and its marker is the magnetic trip', () => {
    const def = getPart('electromechanical/breaker-adjustable')!;
    const c = curveOf(def, { curve: 'D', in: '16' })!;
    expect(c.marker).toBe(15);
    expect(c.never).toBe(1.3);
    for (const [m, t] of c.points) expect(t).toBeCloseTo(breakerTripTime('D', m), 9);
    // the thermal part falls with the multiple
    for (let i = 1; i < c.points.length; i++) if (c.points[i][0] < 15) expect(c.points[i][1]).toBeLessThanOrEqual(c.points[i - 1][1]);
    expect(curveOf(def, { curve: 'B' })!.marker).toBe(4);
    expect(curveOf(def, { curve: 'Q' })).toBeNull();
  });

  it('the fuse curve follows I²t / (I² − Imin²) in multiples of the rating', () => {
    const def = getPart('power/fuse-i2t')!;
    const c = curveOf(def, { in: '2', i2t: '10', kmin: '1.5' })!;
    expect(c.marker).toBe(1.5);
    for (const [m, t] of c.points) expect(t).toBeCloseTo(fuseMeltTime(m * 2, 3, 10), 9);
    expect(c.at(1.4)).toBe(Number.POSITIVE_INFINITY);
    expect(curveOf(def, { in: '0' })).toBeNull();
  });

  it('the overload curve follows the trip class', () => {
    const def = getPart('electromechanical/overload-relay-3p')!;
    const c = curveOf(def, { class: '20' })!;
    for (const [m, t] of c.points) expect(t).toBeCloseTo(overloadTripTime('20', m), 9);
    expect(c.at(7.2)).toBeCloseTo(13, 9);
    expect(c.never).toBeCloseTo(Math.sqrt(1.2), 9);
  });

  it('parts without a characteristic have no curve, and the figure renders with the curve text', () => {
    expect(curveOf(getPart('basic/resistor')!, {})).toBeNull();
    setLang('en');
    const inst = { id: 'q', partId: 'electromechanical/breaker-adjustable', refdes: 'Q1', x: 0, y: 0, rotation: 0, params: { curve: 'C', in: '10' } } as unknown as PartInstance;
    const html = renderToStaticMarkup(createElement(TripCurve, { def: getPart(inst.partId)!, inst }));
    expect(html).toContain('<svg');
    expect(html).toContain('Time–current curve');
    expect(html).toContain('No trip below 1.3');
    setLang('vi');
  });
});

describe('Audio window and WAV export dialog', () => {
  it('lists the traces of a time-domain result (and nothing for other analyses)', () => {
    const time = Float64Array.from([0, 1, 2]);
    const tr = { type: 'tran' as const, title: 't', scale: { name: 'time', unit: 's' as const, re: time }, vectors: [{ name: 'V(out)', unit: 'V' as const, re: Float64Array.from([0, 1, 0]) }, { name: 'V(ac)', unit: 'V' as const, re: Float64Array.from([0, 1, 0]), im: Float64Array.from([0, 0, 0]) }], warnings: [] };
    expect(exportableTraces(tr as never)).toEqual([{ name: 'V(out)', unit: 'V' }]);
    expect(exportableTraces({ ...tr, type: 'ac' } as never)).toEqual([]);
    expect(exportableTraces(undefined)).toEqual([]);
  });

  it('shows the stretch notice only while the simulation is slower than real time', () => {
    resetAudioState();
    setLang('en');
    const idle = renderToStaticMarkup(createElement(AudioPanel));
    expect(idle).toContain('Master volume');
    expect(idle).not.toContain('slower than real time');
    audioState.setState((s) => ({ ...s, active: true, slower: true, speed: 0.4 }));
    // the panel reads the simulation state from the editor store: not running here, so it says so
    const html = renderToStaticMarkup(createElement(AudioPanel));
    expect(html).toContain('not running');
    resetAudioState();
    setLang('vi');
  });
});
