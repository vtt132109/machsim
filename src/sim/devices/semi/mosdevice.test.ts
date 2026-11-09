/**
 * MOSFET dispatcher (level -> implementation) and the device-default options DEFL / DEFW / DEFAD /
 * DEFAS, through SPICE decks.
 */
import { describe, expect, it } from 'vitest';
import { parseSpice, writeSpice } from '../../spice';
import { runAnalyses } from '../../engine';
import { Bsim3 } from './bsim3';
import { Mosfet } from './mosfet';
import { MosDevice, isBsimLevel } from './mosdevice';
import { TestCircuit } from './test-harness';

const vd = (deck: string) => {
  const [op] = runAnalyses(parseSpice(deck).netlist);
  expect(op.error).toBeUndefined();
  return op;
};

describe('MOSFET dispatcher', () => {
  it('chooses BSIM3 for levels 7, 8, 49, 53 (and 14 / 54) and the SPICE levels otherwise', () => {
    for (const l of [7, 8, 49, 53, 14, 54]) expect(isBsimLevel(l)).toBe(true);
    for (const l of [1, 2, 3, undefined]) expect(isBsimLevel(l)).toBe(false);
    const make = (level: number) => {
      const c = new TestCircuit({}).model({ name: 'MM', type: 'NMOS', params: { level } });
      const m = c.element((el) => new MosDevice(el), { type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'MM', params: {} }) as MosDevice;
      c.vsource('VD', 'd', '0', 1);
      c.vsource('VG', 'g', '0', 1);
      c.op();
      return m.implementation;
    };
    expect(make(49)).toBeInstanceOf(Bsim3);
    expect(make(2)).toBeInstanceOf(Mosfet);
  });

  it('replays parameter changes made before setup', () => {
    const d = new MosDevice({ type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'MM', params: {} });
    d.setParam('w', 20e-6);
    const c = new TestCircuit({}).model({ name: 'MM', type: 'NMOS', params: { level: 1, vto: 0.5, kp: 1e-4 } });
    c.element(() => d, { type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'MM', params: {} });
    c.vsource('VD', 'd', '0', 3);
    c.vsource('VG', 'g', '0', 1.5);
    c.op();
    expect(d.getParam('w')).toBe(20e-6);
  });

  it('BSIM4 cards run with the BSIM3 core and a warning', () => {
    const [op] = runAnalyses(parseSpice('b4\nVD d 0 1\nVG g 0 1\nM1 d g 0 0 N4 W=1u L=0.1u\n.model N4 NMOS (LEVEL=54 TOXE=2n NDEP=3e18 VTH0=0.3)\n.op\n.end').netlist);
    expect(op.error).toBeUndefined();
    expect(op.warnings.join(' ')).toMatch(/BSIM4 model \(level 54\) evaluated with the BSIM3v3 core/);
  });
});

describe('device default options', () => {
  // KP = 1e-4, VTO = 0.5, Vgs = 1.5 V, saturation: Id = KP/2 * W/L * 1 V^2
  const deck = (opts: string, inst = '') => `d\nVD d 0 3\nVG g 0 1.5\nM1 d g 0 0 NM ${inst}\n.model NM NMOS (LEVEL=1 VTO=0.5 KP=1e-4 CJ=1e-3)\n${opts}\n.op\n.end`;
  const id = (deck: string) => vd(deck).vectors.find((v) => v.name.toLowerCase() === 'id(m1)')!.re[0];

  it('DEFL / DEFW set the geometry of MOSFETs without W and L', () => {
    // SPICE defaults W = L = 100 um: W/L = 1
    expect(id(deck(''))).toBeCloseTo(5e-5, 9);
    expect(id(deck('.options defl=2u defw=10u'))).toBeCloseTo(5 * 5e-5, 9);
    // an instance value wins over the option
    expect(id(deck('.options defl=2u defw=10u', 'W=4u L=2u'))).toBeCloseTo(2 * 5e-5, 9);
  });

  it('DEFAD / DEFAS give the drain / source junction areas, and the options round-trip through SPICE text', () => {
    const { netlist } = parseSpice(deck('.options defad=4p defas=2p'));
    expect(netlist.options).toMatchObject({ defad: 4e-12, defas: 2e-12 });
    expect(writeSpice(netlist)).toMatch(/\.options .*defad=4p.*defas=2p/i);
    // CJ = 1 mF/m^2: zero-bias bottom capacitances CJ*AD and CJ*AS
    const c = new TestCircuit({ defad: 4e-12, defas: 2e-12 }).model({ name: 'NM', type: 'NMOS', params: { level: 1, vto: 0.5, kp: 1e-4, cj: 1e-3 } });
    const m = c.element((el) => new Mosfet(el), { type: 'M', name: 'M1', nodes: ['d', 'g', '0', '0'], model: 'NM', params: {} }) as Mosfet;
    c.vsource('VD', 'd', '0', 0);
    c.vsource('VG', 'g', '0', 1);
    c.op();
    const t = m.derived(300.15);
    expect(t.depBd.cj0).toBeCloseTo(4e-15, 20);
    expect(t.depBs.cj0).toBeCloseTo(2e-15, 20);
  });
});
