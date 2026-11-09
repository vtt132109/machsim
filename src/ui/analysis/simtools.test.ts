/**
 * Analysis tools: convergence assistant fixes (tried on real failing circuits), simulation
 * profiles, effective output saves and interactive settings.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../../sim';
import { parseSpice } from '../../sim/spice';
import { DEFAULT_OPTIONS } from '../../sim/netlist';
import { applyFixToNetlist, classifyFailure, convergenceFixes, seriesTargets, withSeriesResistance } from './convergence';
import { BUILTIN_PROFILES, ProfileFormatError, ProfileStore, applyProfile, parseProfile, profileFromSettings, serializeProfile } from '../../model/simProfiles';
import { effectiveSaves, resolveInteractive, zeroInitialState } from '../integration/simSettings';
import { newDesign } from '../../model/types';

describe('convergence assistant', () => {
  it('classifies engine messages', () => {
    expect(classifyFailure('Singular matrix: no valid pivot for node a; check for floating nodes')).toBe('singular');
    expect(classifyFailure('Timestep too small at t = 1e-6 s (step 1e-20 s): Q1')).toBe('timestep');
    expect(classifyFailure('Operating point did not converge (Newton, gmin stepping and source stepping failed): node out')).toBe('noconv');
    expect(classifyFailure('Transient analysis: invalid tstep 0')).toBe('other');
  });

  it('proposes only fixes that change something', () => {
    const fixes = convergenceFixes('noconv', { gminSteps: 100, srcSteps: 100 });
    expect(fixes.map((f) => f.id)).not.toContain('stepping');
    expect(fixes[fixes.length - 1].id).toBe('combined');
    expect(convergenceFixes('timestep')[0]).toEqual({ id: 'gear', options: { method: 'gear', maxord: 2 } });
  });

  it('a loop of two ideal voltage sources is singular and the series-resistance fix solves it', () => {
    const net = parseSpice('loop\nV1 a 0 5\nV2 a 0 3\nR1 a 0 1k\n.op\n.end').netlist;
    const [bad] = runAnalyses(net);
    expect(classifyFailure(bad.error ?? '')).toBe('singular');
    const fixes = convergenceFixes('singular');
    const results = fixes.map((f) => runAnalyses(applyFixToNetlist(net, f))[0]);
    const firstOk = fixes.findIndex((_f, i) => !results[i].error);
    expect(fixes[firstOk].id).toBe('seriesR');
    // the two sources now share the 2 V difference through 2 mOhm: 1 kA, and V(a) = 4 V
    const va = results[firstOk].vectors.find((v) => v.name === 'V(a)')!.re[0];
    expect(va).toBeCloseTo(4, 3);
  });

  it('a floating capacitor node is singular in DC and RSHUNT fixes it', () => {
    const net = parseSpice('float\nV1 a 0 1\nR1 a b 1k\nC1 b c 1u\nC2 c 0 1u\n.op\n.end').netlist;
    // c is only connected through capacitors: no DC path
    const [bad] = runAnalyses(net);
    expect(bad.error).toBeDefined();
    const fix = convergenceFixes(classifyFailure(bad.error!)).find((f) => f.id === 'rshunt')!;
    const [ok] = runAnalyses(applyFixToNetlist(net, fix));
    expect(ok.error).toBeUndefined();
  });

  it('series resistance moves the first node of every V and L to an internal node', () => {
    const net = parseSpice('x\nV1 a 0 1\nL1 a b 1m\nR1 b 0 1\n.end').netlist;
    expect(seriesTargets(net)).toEqual(['V1', 'L1']);
    const s = withSeriesResistance(net, 1e-3);
    expect(s.elements.map((e) => `${e.name}:${e.nodes.join(',')}`)).toEqual(['V1:V1#rs,0', 'R_V1_assist:a,V1#rs', 'L1:L1#rs,b', 'R_L1_assist:a,L1#rs', 'R1:b,0']);
  });
});

describe('simulation profiles', () => {
  const settings = {
    options: { reltol: 1e-4, method: 'gear' as const },
    analysis: { active: 'tran' as const, specs: { tran: { type: 'tran' as const, tstep: 1e-6, tstop: 1e-3 } }, saves: ['V(out)'] },
    interactive: { initial: 'zero' as const, tstop: 0.5 },
  };

  it('round-trips through the file format and validates with readable issues', () => {
    const p = profileFromSettings(' Lọc thông thấp ', settings, new Date(Date.UTC(2026, 10, 9)));
    expect(p.name).toBe('Lọc thông thấp');
    const back = parseProfile(serializeProfile(p));
    expect(back).toEqual(p);
    try {
      parseProfile(JSON.stringify({ format: 'machsim-sim-profile', version: 1, name: 'x', options: { reltol: 'a', bogus: 1 }, interactive: { initial: 'later' } }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProfileFormatError);
      expect((e as ProfileFormatError).issues).toEqual(['options.reltol: expected a number', 'options.bogus: unknown option', 'interactive.initial: must be auto, op, zero or uic']);
    }
  });

  it('loading replaces options and, when present, analysis and interactive settings', () => {
    const p = profileFromSettings('a', { options: { gmin: 1e-10 } });
    const next = applyProfile(settings, p);
    expect(next.options).toEqual({ gmin: 1e-10 });
    expect(next.analysis).toEqual(settings.analysis);
    expect(applyProfile({ options: {} }, profileFromSettings('b', settings)).interactive).toEqual({ initial: 'zero', tstop: 0.5 });
  });

  it('stores profiles by name (case-insensitive replace) and survives damaged storage', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    const store = new ProfileStore(storage);
    store.save(profileFromSettings('B', settings));
    store.save(profileFromSettings('a', settings));
    expect(store.save(profileFromSettings('b', { options: {} })).map((p) => p.name)).toEqual(['a', 'b']);
    expect(store.remove('A').map((p) => p.name)).toEqual(['b']);
    data.set('machsim.simprofiles.v1', 'not json');
    expect(store.list()).toEqual([]);
    expect(new ProfileStore(null).list()).toEqual([]);
  });

  it('built-in profiles only use real options', () => {
    for (const b of BUILTIN_PROFILES) for (const k of Object.keys(b.options)) expect(k in DEFAULT_OPTIONS).toBe(true);
  });
});

describe('output saves and interactive settings', () => {
  it('keeps the vectors probes and instruments need when outputs are selected', () => {
    expect(effectiveSaves([], ['V(a)'])).toEqual([]);
    expect(effectiveSaves(['V(out)', 'all'], ['V(a)'])).toEqual([]);
    expect(effectiveSaves(['V(out)', ' I(V1) '], ['v(OUT)', 'I(V_PR_P1)'])).toEqual(['V(out)', 'I(V1)', 'I(V_PR_P1)']);
  });

  it('derives interactive settings from the transient spec unless they are set', () => {
    const d = newDesign();
    expect(resolveInteractive(d)).toMatchObject({ tstep: 1e-5, uic: false, initial: 'op', tstop: Infinity, explicit: false });
    d.interactive = { initial: 'zero', tstep: 2e-6, tstop: 0.01 };
    expect(resolveInteractive(d)).toEqual({ tstep: 2e-6, tmax: undefined, uic: true, initial: 'zero', tstop: 0.01, explicit: true });
    d.interactive = {};
    expect(resolveInteractive(d)).toMatchObject({ initial: 'auto', uic: false });
  });

  it('zero initial state drops .ic, .nodeset and capacitor / inductor ic=', () => {
    const net = parseSpice('x\nV1 a 0 1\nC1 a 0 1u IC=2\nL1 a 0 1m IC=1m\n.ic V(a)=3\n.nodeset V(a)=1\n.end').netlist;
    const z = zeroInitialState(net);
    expect(z.ic).toEqual({});
    expect(z.nodeset).toEqual({});
    expect(z.elements.every((e) => e.params.ic === undefined)).toBe(true);
    expect(net.elements.find((e) => e.name === 'C1')!.params.ic).toBe(2);
  });
});
