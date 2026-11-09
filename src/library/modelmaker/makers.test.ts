/**
 * Every model maker: the fitted model, simulated by the real engine in the maker's own benches,
 * reproduces each entered datasheet point within the stated tolerance — for the default inputs
 * and for a second, different datasheet. Also: input validation and the generated text.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../../sim';
import { parseModelLibrary } from '../custom/spiceModels';
import { MAKERS, getMaker } from './index';
import { defaultMakerInput, readMakerInput, runMaker, verifyMaker } from './verify';
import { MakerInputError, type CheckOutcome, type MakerDef } from './types';

function verify(def: MakerDef, input: Record<string, string> = {}, name = 'MTEST'): { outcomes: CheckOutcome[]; text: string } {
  const { values, result } = runMaker(def, { ...defaultMakerInput(def), ...input }, name, (nl) => runAnalyses(nl));
  const outcomes = verifyMaker(def.checks(values, result), (nl) => runAnalyses(nl));
  return { outcomes, text: result.model.kind === 'spice' ? result.model.text : '' };
}

function expectAllPass(outcomes: CheckOutcome[]): void {
  const bad = outcomes.filter((o) => !o.pass).map((o) => `${o.id}${o.params ? JSON.stringify(o.params) : ''}: target ${o.target} measured ${o.measured} (${o.failure ?? `${(o.error * 100).toFixed(2)} %`})`);
  expect(bad).toEqual([]);
  expect(outcomes.length).toBeGreaterThan(0);
}

describe('model maker registry', () => {
  it('has the eleven makers, each with fields and terminals', () => {
    expect(MAKERS.map((m) => m.id)).toEqual(['diode', 'zener', 'led', 'bjt', 'mosfet', 'jfet', 'opamp', 'scr', 'transformer', 'tline', 'acmotor']);
    for (const m of MAKERS) {
      expect(m.fields.length).toBeGreaterThan(2);
      expect(m.terminals.length).toBeGreaterThan(1);
      expect(getMaker(m.id)).toBe(m);
    }
  });

  it('validates inputs: required, numbers, positive values, names', () => {
    const d = getMaker('diode');
    expect(readMakerInput(d, { ...defaultMakerInput(d), vf1: '' }).errors).toEqual([{ key: 'vf1', problem: 'required' }]);
    expect(readMakerInput(d, { ...defaultMakerInput(d), if1: 'abc' }).errors).toEqual([{ key: 'if1', problem: 'number' }]);
    expect(readMakerInput(d, { ...defaultMakerInput(d), if1: '-1m' }).errors).toEqual([{ key: 'if1', problem: 'positive' }]);
    expect(() => runMaker(d, defaultMakerInput(d), '9bad')).toThrow(MakerInputError);
    expect(() => runMaker(d, { ...defaultMakerInput(d), vf2: '0.5' }, 'D1')).toThrow(MakerInputError);
  });
});

describe('diode makers', () => {
  it('diode: three forward points, breakdown and capacitance', () => {
    const { outcomes, text } = verify(getMaker('diode'));
    expectAllPass(outcomes);
    expect(outcomes.map((o) => o.id)).toEqual(['vf', 'vf', 'vf', 'bv', 'ct']);
    const lib = parseModelLibrary(text);
    expect(lib.errors).toEqual([]);
    expect(lib.models[0]).toMatchObject({ name: 'MTEST', type: 'D' });
  });

  it('diode: a small-signal datasheet with two points (RS = 0)', () => {
    const { outcomes } = verify(getMaker('diode'), { if1: '1m', vf1: '0.62', if2: '10m', vf2: '0.74', if3: '', vf3: '', bv: '100', ibv: '5u', ct: '4p', vrct: '0' });
    expectAllPass(outcomes);
  });

  it('zener: VZ, ZZT, leakage and forward voltage', () => {
    expectAllPass(verify(getMaker('zener')).outcomes);
    expectAllPass(verify(getMaker('zener'), { vz: '12', izt: '20m', zzt: '9', ir: '1u', vr: '9', vf: '0.9', if: '10m' }).outcomes);
  });

  it('LED: one point with typical values, and two points', () => {
    expectAllPass(verify(getMaker('led')).outcomes);
    expectAllPass(verify(getMaker('led'), { color: 'blue', vf: '3.0', if: '20m', vf2: '3.4', if2: '60m' }).outcomes);
  });
});

describe('transistor makers', () => {
  it('BJT (NPN): hFE at three currents, VBE, saturation, fT, Cob, Cib', () => {
    const { outcomes } = verify(getMaker('bjt'), { hfe3: '150', ic3: '100u', cib: '8p' });
    expectAllPass(outcomes);
    expect(outcomes.map((o) => o.id)).toEqual(['hfe', 'vbe', 'hfe', 'hfe', 'vcesat', 'vbesat', 'ft', 'cob', 'cib']);
  });

  it('BJT (PNP power transistor datasheet)', () => {
    expectAllPass(
      verify(getMaker('bjt'), { type: 'pnp', hfe1: '75', ic1: '1', vce: '4', vbe: '0.85', hfe2: '25', ic2: '5', ft: '3M', icft: '500m', cob: '120p', vcb: '10', vcesat: '0.6', vbesat: '1.3', icsat: '3', ibsat: '300m' }).outcomes,
    );
  });

  it('MOSFET level 1: small-signal N-channel (RS degeneration) and power N-channel (RD)', () => {
    expectAllPass(verify(getMaker('mosfet')).outcomes);
    const power = verify(getMaker('mosfet'), { vth: '3', idth: '250u', rdson: '44m', vgson: '10', idon: '16', gfs: '21', idg: '16', vdsg: '50', ciss: '1960p', coss: '250p', crss: '40p', vdsc: '25' });
    expectAllPass(power.outcomes);
    expect(power.text).toMatch(/RD=/);
  });

  it('MOSFET level 3 (mobility degradation) and P-channel', () => {
    const l3 = verify(getMaker('mosfet'), { level: '3', vth: '3', idth: '250u', rdson: '44m', vgson: '10', idon: '16', gfs: '21', idg: '16', vdsg: '50' });
    expectAllPass(l3.outcomes);
    expect(l3.text).toMatch(/LEVEL=3/);
    expect(l3.text).toMatch(/THETA=/);
    expectAllPass(verify(getMaker('mosfet'), { type: 'pmos', vth: '2', idth: '250u', rdson: '0.2', vgson: '10', idon: '2', gfs: '3', idg: '2', vdsg: '10' }).outcomes);
  });

  it('JFET: N-channel with gfs (RS) and P-channel', () => {
    expectAllPass(verify(getMaker('jfet')).outcomes);
    expectAllPass(verify(getMaker('jfet'), { type: 'pjf', idss: '3m', vds: '15', vgsoff: '2', gfs: '' }).outcomes);
  });
});

describe('op-amp, thyristor, transformer, line, motor makers', () => {
  it('op-amp macro-model: AOL, GBW, slew rate, offsets, CMRR, swing, Isc, IQ', () => {
    const { outcomes } = verify(getMaker('opamp'));
    expectAllPass(outcomes);
    expect(outcomes.map((o) => o.id)).toEqual(['aol', 'gbw', 'sr', 'vos', 'ib', 'ios', 'cmrr', 'voh', 'vol', 'isc', 'iq']);
    // a fast JFET-input datasheet
    expectAllPass(verify(getMaker('opamp'), { aol: '100', gbw: '3M', sr: '13', vos: '3m', ib: '30p', ios: '5p', cmrr: '86', hdrhi: '1.5', hdrlo: '1.5' }).outcomes);
  });

  it('SCR: IGT, VGT, IH, VTM', () => {
    expectAllPass(verify(getMaker('scr')).outcomes);
    expectAllPass(verify(getMaker('scr'), { igt: '10m', vgt: '1.0', ih: '30m', vtm: '1.6', itm: '20' }).outcomes);
  });

  it('transformer: full-load voltage, no-load current, short-circuit test', () => {
    expectAllPass(verify(getMaker('transformer')).outcomes);
    expectAllPass(verify(getMaker('transformer'), { v1: '400', v2: '24', s: '1000', f: '60', i0: '3', uk: '5', pk: '20', p0: '10' }).outcomes);
  });

  it('transmission line: impedance, delay, loss (direct Z0 and microstrip)', () => {
    expectAllPass(verify(getMaker('tline')).outcomes);
    expectAllPass(verify(getMaker('tline'), { mode: 'microstrip', w: '3m', h: '1.6m', er: '4.4', len: '0.1', loss: '', f: '500M' }).outcomes);
  });

  it('AC induction motor: rated speed and current under rated load', () => {
    const { outcomes } = verify(getMaker('acmotor'));
    expectAllPass(outcomes);
  }, 60_000);
});
