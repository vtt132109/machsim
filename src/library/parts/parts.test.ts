import { describe, expect, it } from 'vitest';
import { ALL_PARTS as CORE_PARTS } from './index';
import { GROUPS, defaultParams, getPart, listParts, partsInGroup, searchParts } from '../index';
import { asLibraryPart, elementName, internalNodeName, type InstrumentBindContext } from '../partkit';
import type { PartDef, SpiceFragment, ToSpiceContext } from '../types';
import type { ElementIR, ModelCard, Netlist, SubcktDef } from '../../sim/netlist';
import { emptyNetlist } from '../../sim/netlist';
import { flattenNetlist } from '../../sim/spice/flatten';
import { parseExpression } from '../../sim/spice/expr';
import { thermalVoltage } from '../../sim/device';
import { parseUserNumber } from '../../util/units';
import { validateParams } from '../../model/erc';
import { INSTRUMENT_CHANNELS } from '../../ui/instruments/types';
import { mosfetFitModel } from './transistors';
import { ledModel } from './diodes';
import { generatorWaveform, parseWordPattern, wordBitSource } from './instruments';
import { loadAllGroups } from '../index';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();
/** every built-in part: the start-up list (hand-written + core catalogue) and every catalogue pack */
const ALL_PARTS = listParts();

const MY_GROUPS = ['sources', 'basic', 'diodes', 'transistors', 'analog', 'indicators', 'power', 'misc', 'rf', 'electromechanical', 'connectors', 'instruments'];
const MINE = ALL_PARTS.filter((p) => MY_GROUPS.includes(p.group));

/** Stub ToSpiceContext: pin p -> node "n_<p>", connected pins configurable. */
function stubCtx(part: PartDef, refdes = 'U7', overrides: Record<string, string> = {}, open: string[] = []): ToSpiceContext & { internal(s: string): string; connected(p: string): boolean } {
  const params = { ...defaultParams(part), ...overrides };
  const pins = new Set(part.symbol.pins.map((p) => p.name));
  return {
    refdes,
    params,
    node: (pin) => {
      if (!pins.has(pin)) throw new Error(`no pin ${pin}`);
      return `n_${pin}`;
    },
    num: (key) => {
      const v = parseUserNumber(params[key] ?? '');
      if (!Number.isFinite(v)) throw new Error(`bad value for ${key}`);
      return v;
    },
    name: (type, suffix) => elementName(type, refdes, suffix),
    internal: (s) => internalNodeName(refdes, s),
    connected: (p) => !open.includes(p),
  };
}

const NODE_COUNT: Record<string, number[]> = {
  R: [2], C: [2], L: [2], K: [0], V: [2], I: [2], E: [4], F: [2], G: [4], H: [2], B: [2],
  D: [2], Q: [3, 4], J: [3], M: [4], Z: [3], S: [4], W: [2], T: [4], O: [4],
};

function finite(v: number | undefined, what: string): void {
  if (v !== undefined) expect(Number.isFinite(v), what).toBe(true);
}

/** Structural validation of an element list (top level or subcircuit body). */
function checkElements(els: ElementIR[], models: Record<string, ModelCard>, subckts: Record<string, SubcktDef>, where: string): void {
  const names = new Set<string>();
  for (const el of els) {
    const tag = `${where}: ${el.name}`;
    expect(el.name.charAt(0).toUpperCase(), tag).toBe(el.type);
    expect(names.has(el.name.toLowerCase()), `${tag} duplicate`).toBe(false);
    names.add(el.name.toLowerCase());
    if (el.type === 'X') {
      expect(el.nodes.length, tag).toBeGreaterThan(0);
      const sub = subckts[(el.model ?? '').toLowerCase()];
      expect(sub, `${tag} subckt ${el.model}`).toBeDefined();
      expect(sub.ports.length, `${tag} port count`).toBe(el.nodes.length);
    } else if (el.type === 'A') {
      expect(el.nodes.length, tag).toBeGreaterThan(0);
    } else {
      expect(NODE_COUNT[el.type], tag).toContain(el.nodes.length);
    }
    for (const n of el.nodes) expect(typeof n === 'string' && n.length > 0, `${tag} node`).toBe(true);
    finite(el.value, `${tag} value`);
    for (const [k, v] of Object.entries(el.params)) finite(v, `${tag} param ${k}`);
    if (['R', 'C', 'L', 'E', 'F', 'G', 'H', 'K'].includes(el.type)) expect(el.value, `${tag} value`).toBeDefined();
    if (el.type === 'R' || el.type === 'C' || el.type === 'L') expect(el.value!, `${tag} positive`).toBeGreaterThan(0);
    if (el.type === 'V' || el.type === 'I') {
      expect(el.source, tag).toBeDefined();
      finite(el.source!.dc, `${tag} dc`);
      finite(el.source!.acMag, `${tag} acmag`);
      finite(el.source!.acPhase, `${tag} acphase`);
      for (const a of el.source!.tran?.args ?? []) finite(a, `${tag} tran arg`);
    }
    if (el.type === 'F' || el.type === 'H' || el.type === 'W') {
      expect(el.control, tag).toBeTruthy();
      expect(els.some((e) => e.type === 'V' && e.name.toLowerCase() === el.control!.toLowerCase()), `${tag} control ${el.control}`).toBe(true);
    }
    if (el.type === 'K') {
      expect(el.inductors?.length ?? 0, tag).toBeGreaterThanOrEqual(2);
      for (const l of el.inductors!) expect(els.some((e) => e.type === 'L' && e.name === l), `${tag} inductor ${l}`).toBe(true);
      expect(el.value!, tag).toBeGreaterThan(0);
      expect(el.value!, tag).toBeLessThanOrEqual(1);
    }
    if (el.type === 'B') {
      const m = /^\s*([VI])\s*=([\s\S]+)$/i.exec(el.expr ?? '');
      expect(m, `${tag} expr '${el.expr}'`).not.toBeNull();
      expect(() => parseExpression(m![2]), `${tag} expr parses`).not.toThrow();
    }
    if (['D', 'Q', 'J', 'M', 'Z', 'S', 'W'].includes(el.type)) {
      expect(models[(el.model ?? '').toLowerCase()], `${tag} model ${el.model}`).toBeDefined();
    }
  }
}

function fragmentNetlist(frag: SpiceFragment): Netlist {
  const n = emptyNetlist('part');
  n.elements = frag.elements;
  for (const m of frag.models ?? []) n.models[m.name.toLowerCase()] = m;
  for (const s of frag.subckts ?? []) n.subckts[s.name.toLowerCase()] = s;
  return n;
}

describe('catalogue', () => {
  it('has at least 180 parts with unique ids in their declared groups', () => {
    expect(MINE.length).toBeGreaterThanOrEqual(180);
    const ids = ALL_PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of ALL_PARTS) {
      expect(p.id.startsWith(`${p.group}/`), p.id).toBe(true);
      expect(GROUPS.some((g) => g.id === p.group), p.id).toBe(true);
    }
    for (const g of MY_GROUPS) expect(partsInGroup(g as PartDef['group']).length, g).toBeGreaterThan(0);
  });

  it('registry lookups work', () => {
    expect(getPart('basic/resistor')?.prefix).toBe('R');
    expect(getPart('sources/ground')?.globalNet).toBe('0');
    expect(listParts().length).toBe(ALL_PARTS.length);
    expect(ALL_PARTS.slice(0, CORE_PARTS.length)).toEqual(CORE_PARTS);
    expect(searchParts('1n4148').map((p) => p.id)).toContain('diodes/1n4148');
    expect(searchParts('oscilloscope').some((p) => p.instrument === 'oscilloscope')).toBe(true);
  });

  it('contains the required real part numbers', () => {
    const required = [
      'diodes/1n4148', 'diodes/1n914', 'diodes/1n4001', 'diodes/1n4007', 'diodes/1n5817', 'diodes/1n5819', 'diodes/1n4728a', 'diodes/1n4733a',
      'diodes/1n4735a', 'diodes/1n4739a', 'diodes/1n4742a', 'diodes/1n4744a', 'diodes/led-red', 'diodes/led-green', 'diodes/led-blue',
      'diodes/led-yellow', 'diodes/led-white', 'diodes/bridge-rectifier', 'diodes/varactor', 'diodes/photodiode',
      'transistors/2n2222a', 'transistors/2n3904', 'transistors/2n3906', 'transistors/2n2907a', 'transistors/bc547b', 'transistors/bc557b',
      'transistors/bd139', 'transistors/bd140', 'transistors/tip31c', 'transistors/tip32c', 'transistors/2n3055', 'transistors/tip120',
      'transistors/2n5457', 'transistors/j310', 'transistors/2n5460', 'transistors/2n7000', 'transistors/bs170', 'transistors/irf540n',
      'transistors/irf9540n', 'transistors/irfz44n', 'transistors/bss138', 'transistors/bss84', 'transistors/nmos', 'transistors/pmos-4t',
      'analog/555', 'analog/tl431', 'analog/lm741', 'analog/opamp-ideal-3', 'analog/opamp-ideal-5', 'analog/opamp', 'analog/comparator',
      'analog/instrumentation-amplifier', 'power/7805', 'power/7812', 'power/7905', 'power/lm317', 'power/fuse',
      'instruments/multimeter', 'instruments/function-generator', 'instruments/scope', 'instruments/scope-4ch', 'instruments/bode-plotter',
      'instruments/wattmeter', 'instruments/frequency-counter', 'instruments/iv-analyzer', 'instruments/spectrum-analyzer',
      'instruments/network-analyzer', 'instruments/distortion-analyzer', 'instruments/logic-analyzer', 'instruments/word-generator',
      'instruments/logic-converter', 'instruments/current-clamp', 'electromechanical/dc-motor', 'electromechanical/relay-spdt',
      'rf/transmission-line', 'misc/optocoupler', 'misc/crystal', 'basic/ntc-thermistor', 'basic/transformer-ct', 'basic/potentiometer',
    ];
    for (const id of required) expect(getPart(id), id).toBeDefined();
  });

  it('every SPICE-modelled real part documents its provenance', () => {
    for (const p of MINE) {
      if (!p.toSpice) continue;
      const frag = p.toSpice(stubCtx(p));
      const usesModel = (frag.models?.length ?? 0) > 0 || (frag.subckts?.length ?? 0) > 0;
      if (usesModel && !asLibraryPart(p).virtual) expect(p.provenance ?? '', p.id).not.toBe('');
    }
  });
});

describe.each(MINE.map((p) => [p.id, p] as const))('part %s', (_id, part) => {
  it('has a clean grid-aligned symbol', () => {
    const pins = part.symbol.pins;
    const names = pins.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    const b = part.symbol.bbox;
    for (const p of pins) {
      expect(Math.abs(p.x % 10), `${p.name}.x`).toBe(0);
      expect(Math.abs(p.y % 10), `${p.name}.y`).toBe(0);
      expect(p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h, `${p.name} inside bbox`).toBe(true);
    }
    expect(part.symbol.prims.length).toBeGreaterThan(0);
    if (pins.length === 2 && part.globalNet === undefined && part.group !== 'instruments' && part.group !== 'connectors') {
      const [a, c] = pins;
      expect(Math.hypot(a.x - c.x, a.y - c.y)).toBe(60);
      if (part.group !== 'sources') expect(a.y).toBe(c.y);
    }
    for (const t of part.symbol.prims) if (t.kind === 'text') expect(t.size ?? 10).toBeGreaterThanOrEqual(6);
  });

  it('has valid parameter definitions whose defaults pass ERC', () => {
    const keys = part.params.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of part.params) {
      if (p.kind === 'select') expect(p.options?.some((o) => o.value === p.default), `${p.key} default`).toBe(true);
      if (p.kind === 'number' && p.default.trim() !== '') expect(Number.isFinite(parseUserNumber(p.default)), p.key).toBe(true);
    }
    expect(validateParams(part, defaultParams(part))).toEqual([]);
    if (part.interactive) expect(keys).toContain(part.interactive.param);
  });

  it('produces valid SPICE IR with default parameters', () => {
    if (!part.toSpice) {
      // graphic-only parts: power symbols, instruments, connectors and annotation symbols /
      // sockets; and the PLC rack parts, whose channels become ONE shared A_LADDER element built
      // by the netlister (src/model/ladderBuild.ts)
      expect(
        part.globalNet !== undefined ||
          part.instrument !== undefined ||
          part.group === 'connectors' ||
          asLibraryPart(part).annotation !== undefined ||
          asLibraryPart(part).ladderIo !== undefined,
      ).toBe(true);
      return;
    }
    const frag = part.toSpice(stubCtx(part));
    const models: Record<string, ModelCard> = {};
    for (const m of frag.models ?? []) models[m.name.toLowerCase()] = m;
    const subckts: Record<string, SubcktDef> = {};
    for (const s of frag.subckts ?? []) subckts[s.name.toLowerCase()] = s;
    checkElements(frag.elements, models, subckts, part.id);
    for (const m of frag.models ?? []) for (const [k, v] of Object.entries(m.params)) finite(v, `${m.name}.${k}`);
    for (const s of frag.subckts ?? []) {
      const localModels = { ...models, ...s.models };
      checkElements(s.elements, localModels, { ...subckts, ...s.subckts }, `${part.id}/${s.name}`);
      for (const n of s.elements.flatMap((e) => e.nodes)) expect(n.length).toBeGreaterThan(0);
    }
    // every node is a pin node, ground or an instance-internal node
    const pinNodes = new Set(part.symbol.pins.map((p) => `n_${p.name}`));
    for (const el of frag.elements) {
      for (const n of el.nodes) expect(pinNodes.has(n) || n === '0' || n.startsWith('U7.'), `${el.name} node ${n}`).toBe(true);
      // shared elements of global-net symbols (rail sources V_PWR_<rail>, reference-ground ties
      // R_GNDREF<n>_tie) are named after the net, so every symbol of the net emits the same one
      const shared = (el.type === 'V' && el.name.startsWith('V_PWR_')) || (el.type === 'R' && /^R_GNDREF[1-9]_tie$/.test(el.name));
      if (!shared) expect(el.name === el.type + '7' || el.name.includes('U7'), `${el.name} named after the refdes`).toBe(true);
    }
    // the whole fragment flattens (subcircuits, expressions, model references)
    const flat = flattenNetlist(fragmentNetlist(frag));
    expect(flat.elements.every((e) => e.type !== 'X')).toBe(true);
  });
});

describe('element naming', () => {
  it('follows the ctx.name contract', () => {
    expect(elementName('R', 'R1')).toBe('R1');
    expect(elementName('R', 'U3')).toBe('R_U3');
    expect(elementName('V', 'XFG1', 'p')).toBe('V_XFG1_p');
    expect(elementName('q', 'Q12')).toBe('Q12');
    const r = getPart('basic/resistor')!;
    const frag = r.toSpice!(stubCtx(r, 'R5', { value: '4.7k' }));
    expect(frag.elements[0]).toMatchObject({ type: 'R', name: 'R5', nodes: ['n_1', 'n_2'], value: 4700 });
  });
});

describe('model fits reproduce datasheet figures', () => {
  const VT = thermalVoltage(300.15);
  const vf = (m: ModelCard, i: number) => m.params.n * VT * Math.log(i / m.params.is + 1) + i * (m.params.rs ?? 0);
  const model = (id: string, refdes = 'D1') => {
    const p = getPart(id)!;
    return p.toSpice!(stubCtx(p, refdes)).models![0];
  };

  it('switching and rectifier diodes', () => {
    expect(vf(model('diodes/1n4148'), 10e-3)).toBeGreaterThan(0.65);
    expect(vf(model('diodes/1n4148'), 10e-3)).toBeLessThan(0.75);
    expect(vf(model('diodes/1n4007'), 1)).toBeGreaterThan(0.85);
    expect(vf(model('diodes/1n4007'), 1)).toBeLessThan(1.0);
    expect(model('diodes/1n4007').params.bv).toBe(1000);
    expect(model('diodes/1n4001').params.bv).toBe(50);
    expect(vf(model('diodes/1n5817'), 1)).toBeCloseTo(0.45, 2);
    expect(vf(model('diodes/1n5818'), 1)).toBeCloseTo(0.55, 2);
    expect(vf(model('diodes/1n5819'), 1)).toBeCloseTo(0.6, 2);
    expect(vf(model('diodes/bat54'), 1e-3)).toBeCloseTo(0.32, 2);
  });

  it('LEDs hit their forward voltage at 20 mA', () => {
    const m = ledModel('X', 1.9, 20e-3, 2, 3);
    expect(vf(m, 20e-3)).toBeCloseTo(1.9, 6);
    const red = getPart('diodes/led-red')!;
    const frag = red.toSpice!(stubCtx(red, 'LED1'));
    expect(frag.elements.map((e) => e.name)).toEqual(['V_LED1_i', 'D_LED1']);
    expect(vf(frag.models![0], 20e-3)).toBeCloseTo(1.9, 6);
    const blue = getPart('diodes/led-blue')!;
    expect(vf(blue.toSpice!(stubCtx(blue, 'LED2')).models![0], 20e-3)).toBeCloseTo(3.1, 6);
  });

  it('Zener three-element model gives VZ at IZT', () => {
    const z = getPart('diodes/1n4733a')!;
    const frag = z.toSpice!(stubCtx(z, 'D3'));
    const brk = frag.models!.find((m) => m.name.endsWith('_R'))!;
    const rz = frag.elements.find((e) => e.type === 'R')!.value!;
    expect(rz).toBe(7);
    const vAtIzt = brk.params.bv + VT * Math.log(49e-3 / brk.params.ibv) + 49e-3 * rz;
    expect(vAtIzt).toBeCloseTo(5.1, 9);
  });

  it('MOSFET level-1 fits give the datasheet RDS(on)', () => {
    const { mos } = mosfetFitModel({ pn: 'T', pch: false, description: '', vth: 3, rdson: 0.04, vgsOn: 10, ciss: 1960e-12, crss: 40e-12, lambda: 0, bvdss: 100, diodeIs: 1e-12, coss: 250e-12, footprint: '' });
    expect(1 / (mos.params.kp * (10 - mos.params.vto))).toBeCloseTo(0.04, 12);
    expect(mos.params.cgdo * 100e-6).toBeCloseTo(40e-12, 20);
    const p = getPart('transistors/irf9540n')!;
    const f = p.toSpice!(stubCtx(p, 'Q1'));
    const pm = f.models!.find((m) => m.type === 'PMOS')!;
    expect(pm.params.vto).toBe(-3);
    expect(f.elements.find((e) => e.type === 'D')!.nodes).toEqual(['n_D', 'n_S']);
  });
});

describe('interactive parts', () => {
  it('switches change only resistor values', () => {
    const sw = getPart('basic/switch-spdt')!;
    const a = sw.toSpice!(stubCtx(sw, 'S1', { position: 'A' })).elements;
    const b = sw.toSpice!(stubCtx(sw, 'S1', { position: 'B' })).elements;
    expect(a.map((e) => [e.name, e.nodes])).toEqual(b.map((e) => [e.name, e.nodes]));
    expect(a[0].value).toBe(1e-3);
    expect(a[1].value).toBe(1e9);
    expect(b[0].value).toBe(1e9);
    expect(b[1].value).toBe(1e-3);
    expect(sw.interactive).toMatchObject({ kind: 'toggle', key: 'Space' });
  });

  it('potentiometer splits its resistance by the setting and never reaches zero', () => {
    const pot = getPart('basic/potentiometer')!;
    expect(pot.interactive).toMatchObject({ kind: 'slider', key: 'A', param: 'percent' });
    const e = pot.toSpice!(stubCtx(pot, 'R1', { value: '10k', percent: '30' })).elements;
    expect(e[0]).toMatchObject({ name: 'R1_a', nodes: ['n_1', 'n_W'] });
    expect(e[0].value).toBeCloseTo(3000, 9);
    expect(e[1].value).toBeCloseTo(7000, 9);
    const end = pot.toSpice!(stubCtx(pot, 'R1', { percent: '100' })).elements;
    expect(end[1].value).toBeGreaterThan(0);
    expect(() => pot.toSpice!(stubCtx(pot, 'R1', { percent: '120' }))).toThrow(/percent/);
  });

  it('push button honours NO / NC contacts', () => {
    const pb = getPart('basic/push-button')!;
    expect(pb.toSpice!(stubCtx(pb, 'S2', { pressed: 'true' })).elements[0].value).toBe(1e-3);
    expect(pb.toSpice!(stubCtx(pb, 'S2', { pressed: 'true', contact: 'nc' })).elements[0].value).toBe(1e9);
    expect(pb.interactive?.kind).toBe('momentary');
  });
});

describe('instruments', () => {
  const bindStub = (part: PartDef, refdes: string, frag: SpiceFragment, connected: Record<string, string | null>): InstrumentBindContext => ({
    refdes,
    params: defaultParams(part),
    net: (pin) => (pin in connected ? connected[pin] : `n_${pin}`),
    name: (t, s) => elementName(t, refdes, s),
    elements: frag.elements,
  });

  it.each(MINE.filter((p) => p.group === 'instruments').map((p) => [p.id, p] as const))('%s binds channels the panels understand', (_id, part) => {
    expect(part.instrument).toBeDefined();
    expect(part.prefix.startsWith('X')).toBe(true);
    const lib = asLibraryPart(part);
    expect(lib.virtual).toBe(true);
    expect(typeof lib.bindInstrument).toBe('function');
    const frag = part.toSpice ? part.toSpice(stubCtx(part, 'X9')) : { elements: [] };
    const b = lib.bindInstrument!(bindStub(part, 'X9', frag, {}));
    const allowed = INSTRUMENT_CHANNELS[part.instrument!];
    for (const k of Object.keys(b.channels)) expect(allowed, `${part.id} channel ${k}`).toContain(k);
    for (const d of b.drives) expect(frag.elements.some((e) => e.name === d), `${part.id} drive ${d}`).toBe(true);
  });

  it('function generator drives two sources symmetric about COM', () => {
    const fg = getPart('instruments/function-generator')!;
    const frag = fg.toSpice!(stubCtx(fg, 'XFG1', { amplitude: '2', freq: '500' }));
    expect(frag.elements.map((e) => [e.name, e.nodes])).toEqual([
      ['V_XFG1_p', ['n_+', 'n_COM']],
      ['V_XFG1_n', ['n_COM', 'n_-']],
    ]);
    expect(frag.elements[0].source?.tran).toEqual({ type: 'SIN', args: [0, 2, 500, 0, 0, 0] });
    const b = asLibraryPart(fg).bindInstrument!({ refdes: 'XFG1', params: {}, net: (p) => `n_${p}`, name: (t, s) => elementName(t, 'XFG1', s), elements: frag.elements });
    expect(b.drives).toEqual(['V_XFG1_p', 'V_XFG1_n']);
    expect(b.channels.out).toEqual({ kind: 'voltage', pos: 'n_+', neg: 'n_COM' });
    const onlyPlus = fg.toSpice!(stubCtx(fg, 'XFG1', {}, ['-']));
    expect(onlyPlus.elements.map((e) => e.name)).toEqual(['V_XFG1_p']);
  });

  it('function generator square and triangle waveforms', () => {
    const sq = generatorWaveform({ waveform: 'square', freq: '1k', duty: '25', amplitude: '1', offset: '1', risetime: '1u' });
    expect(sq.tran).toEqual({ type: 'PULSE', args: [0, 2, 0, 1e-6, 1e-6, 0.25e-3 - 1e-6, 1e-3] });
    const tri = generatorWaveform({ waveform: 'triangle', freq: '1k', duty: '50', amplitude: '1', offset: '0', risetime: '1n' });
    expect(tri.tran).toEqual({ type: 'PULSE', args: [-1, 1, 0, 0.5e-3, 0.5e-3, 0, 1e-3] });
    expect(() => generatorWaveform({ waveform: 'saw', freq: '1k', duty: '50', amplitude: '1', offset: '0', risetime: '1n' })).toThrow(/waveform/);
  });

  it('multimeter modes', () => {
    const mm = getPart('instruments/multimeter')!;
    expect(mm.toSpice!(stubCtx(mm, 'XMM1')).elements).toEqual([{ type: 'R', name: 'R_XMM1', nodes: ['n_+', 'n_-'], value: 1e9, params: {} }]);
    const amp = mm.toSpice!(stubCtx(mm, 'XMM1', { mode: 'a' }));
    expect(amp.elements[0]).toMatchObject({ type: 'V', name: 'V_XMM1', nodes: ['n_+', 'n_-'], source: { dc: 0 } });
    const ohm = mm.toSpice!(stubCtx(mm, 'XMM1', { mode: 'ohm' }));
    expect(ohm.elements[1]).toMatchObject({ type: 'I', nodes: ['n_-', 'n_+'], source: { dc: 1e-3 } });
    expect(asLibraryPart(mm).groundWhenOpen).toEqual(['-']);
  });

  it('word generator patterns become per-bit PWL waveforms', () => {
    expect(parseWordPattern('0x0F, ff 100', 8)).toEqual([15, 255, 0]);
    expect(() => parseWordPattern('12, zz', 16)).toThrow(/pattern/);
    const s = { words: [0, 1, 0, 1], freq: 1000, mode: 'cycle' as const, start: 0, end: 3, pos: 0, vlow: 0, vhigh: 5, rise: 1e-6 };
    const src = wordBitSource(s, 0);
    expect(src.tran?.type).toBe('PWL');
    expect(src.tran?.repeatFrom).toBe(0);
    expect(src.tran?.args).toEqual([0, 0, 1e-3 - 1e-6, 0, 1e-3, 5, 2e-3 - 1e-6, 5, 2e-3, 0, 3e-3 - 1e-6, 0, 3e-3, 5, 4e-3 - 1e-6, 5, 4e-3, 0]);
    expect(wordBitSource(s, 1)).toEqual({ dc: 0 });
    expect(wordBitSource({ ...s, mode: 'step', pos: 1 }, 0)).toEqual({ dc: 5 });
    const burst = wordBitSource({ ...s, mode: 'burst' }, 0);
    expect(burst.tran?.repeatFrom).toBeUndefined();
    expect(burst.tran?.args.slice(-2)).toEqual([3e-3, 5]);
  });

  it('IV analyzer exposes sweep and control sources', () => {
    const iv = getPart('instruments/iv-analyzer')!;
    const frag = iv.toSpice!(stubCtx(iv, 'XIV1', { device: 'nmos' }));
    const b = asLibraryPart(iv).bindInstrument!({ refdes: 'XIV1', params: { device: 'nmos' }, net: (p) => `n_${p}`, name: (t, s) => elementName(t, 'XIV1', s), elements: frag.elements });
    expect(b.drives).toEqual(['V_XIV1_v', 'V_XIV1_g']);
    expect(b.channels.i).toEqual({ kind: 'current', element: 'V_XIV1_i' });
    const bjt = iv.toSpice!(stubCtx(iv, 'XIV1', { device: 'bjt-npn' }));
    expect(bjt.elements.find((e) => e.type === 'I')).toMatchObject({ name: 'I_XIV1_b', nodes: ['n_N', 'n_G'], source: { dc: 10e-6 } });
  });
});
