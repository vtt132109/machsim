/**
 * Mains (line) transformers and magnetic flux sources.
 *
 * LINE TRANSFORMER (`electromechanical/line-transformer-*`, stepped down from a mains winding):
 * the data sheet gives the primary voltage Vp, the secondary voltage Vs AT RATED LOAD, the rated
 * power (VA), the regulation (the rise of the secondary voltage from rated load to no load, as a
 * percentage of Vs) and the no-load current. The model is an ideal transformer (E / F sources, exact
 * turns ratio n = Vp / Vs0 with Vs0 = Vs·(1 + regulation)) with
 *   - a magnetising inductance Lm on the primary: Im = no-load current, Lm = Vp / (ω·Im);
 *   - the winding resistance, split half and half between the two sides, and the leakage reactance
 *     X = ρ·R (ρ = 0.5) in series with the secondary, both chosen so that a resistive load drawing
 *     the rated VA sees exactly Vs. With a = Is·R, Is = VA / Vs: V0² = (Vs + a)² + (ρ·a)², which
 *     gives a = (−Vs + √(Vs² − (1 + ρ²)(Vs² − V0²))) / (1 + ρ²).
 *   - 1 GΩ between the windings (DC reference of the secondary).
 * `lineTransformerDesign` returns the numbers (the tests check them against an AC analysis).
 *
 * MAGNETIC FLUX SOURCES (for the magnetic parts — saturating transformer, saturating inductor and
 * any winding): a flux Φ (webers) through a search coil of N turns induces e = N·dΦ/dt (Faraday's
 * law). The source is the voltage e between + and −; the flux itself is the internal node
 * V(<refdes>.phi) in Wb, so the Grapher can plot it. A constant flux induces nothing; the interactive
 * flux source steps Φ with a key or the slider (the induced pulse shows the derivative); the flux
 * generator drives Φ(t) with a sine, triangle, square or sawtooth.
 *   dΦ/dt is the current of a 1 F capacitor on the flux node, read by a 0 V sense source.
 */
import type { ElementIR } from '../../sim/netlist';
import { elB, elC, elE, elF, elL, elR, elSense, ex, internalNode, keyParam, numParam, selectParam, type LibraryPartDef } from '../partkit';
import { boxSymbol, circle, line, makeSymbol, pin, text } from '../symbols';
import type { ToSpiceContext } from '../types';
import { eng, withMeta } from './kit';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// line transformer

export interface LineTransformerSpec {
  /** primary voltage (V RMS) */
  vp: number;
  /** secondary voltage at rated load (V RMS) */
  vs: number;
  /** rated power (VA) */
  va: number;
  /** regulation (%): (Vs0 − Vs) / Vs */
  regulation: number;
  /** no-load primary current as a percentage of the rated primary current */
  noLoad: number;
  /** mains frequency (Hz) */
  freq: number;
}

export interface LineTransformerDesign {
  /** turns ratio Np : Ns (= Vp / Vs0) */
  n: number;
  /** secondary no-load voltage (V) */
  vs0: number;
  /** rated secondary current (A) */
  is: number;
  /** series winding resistance referred to the secondary (Ω) */
  r: number;
  /** secondary-side resistance and primary-side resistance (Ω) */
  rs: number;
  rp: number;
  /** leakage reactance referred to the secondary (Ω) and the inductance it is (H) */
  x: number;
  llk: number;
  /** magnetising inductance of the primary (H) and the no-load current (A RMS) */
  lm: number;
  im: number;
}

/** Ratio of leakage reactance to winding resistance. */
export const LEAKAGE_RATIO = 0.5;

/** Winding resistances, leakage and magnetising inductance of a line transformer from its data sheet. */
export function lineTransformerDesign(s: LineTransformerSpec): LineTransformerDesign {
  const vs0 = s.vs * (1 + s.regulation / 100);
  const is = s.va / s.vs;
  const rho = LEAKAGE_RATIO;
  const k = 1 + rho * rho;
  const disc = s.vs * s.vs - k * (s.vs * s.vs - vs0 * vs0);
  const a = (-s.vs + Math.sqrt(Math.max(0, disc))) / k;
  const r = a / is;
  const n = s.vp / vs0;
  const w = 2 * Math.PI * s.freq;
  const im = (s.noLoad / 100) * (s.va / s.vp);
  return { n, vs0, is, r, rs: r / 2, rp: (r / 2) * n * n, x: rho * r, llk: (rho * r) / w, lm: s.vp / (w * im), im };
}

/** Typical regulation (%) and no-load current (%) of an EI-core mains transformer of a rating (log-interpolated catalogue ranges). */
export function typicalLineTransformer(va: number): { regulation: number; noLoad: number } {
  const table: [number, number, number][] = [
    [5, 25, 25],
    [10, 20, 20],
    [25, 15, 15],
    [50, 12, 12],
    [100, 10, 10],
    [250, 8, 8],
    [630, 6, 6],
    [1000, 5, 5],
  ];
  if (va <= table[0][0]) return { regulation: table[0][1], noLoad: table[0][2] };
  for (let i = 1; i < table.length; i++) {
    if (va <= table[i][0]) {
      const f = Math.log(va / table[i - 1][0]) / Math.log(table[i][0] / table[i - 1][0]);
      return { regulation: table[i - 1][1] + f * (table[i][1] - table[i - 1][1]), noLoad: table[i - 1][2] + f * (table[i][2] - table[i - 1][2]) };
    }
  }
  const last = table[table.length - 1];
  return { regulation: last[1], noLoad: last[2] };
}

const TRANSFORMER_SYMBOL = (() => {
  const base = boxSymbol({ w: 60, h: 60, left: [{ name: 'P1', number: '1' }, { name: 'P2', number: '2' }], right: [{ name: 'S1', number: '3' }, { name: 'S2', number: '4' }] });
  return { ...base, prims: [...base.prims, line(-4, -24, -4, 24), line(4, -24, 4, 24), text(0, 36, '~ 50 Hz', 6)] };
})();

function lineParams(vp: string, vs: string, va: string, reg: string, inl: string) {
  return [
    numParam('vp', 'Primary voltage', vp, 'V', { min: 0, showOnSchematic: true, help: 'Mains voltage (RMS) the primary is made for' }),
    numParam('vs', 'Secondary voltage at rated load', vs, 'V', { min: 0, help: 'Secondary voltage (RMS) while the rated power is drawn by a resistive load' }),
    numParam('va', 'Rated power', va, 'VA', { min: 0, help: 'Apparent power the secondary can deliver continuously' }),
    numParam('regulation', 'Regulation', reg, '%', { min: 0, help: 'How much the secondary voltage rises from rated load to no load, as a percentage of the rated voltage' }),
    numParam('noload', 'No-load current', inl, '%', { min: 0, help: 'Primary current without load, as a percentage of the rated primary current' }),
    numParam('freq', 'Mains frequency', '50', 'Hz', { group: 'advanced', min: 0 }),
    numParam('riso', 'Isolation resistance', '1G', 'Ω', { group: 'advanced', min: 0, help: 'Leakage between primary and secondary (gives the secondary a DC reference)' }),
  ];
}

function lineToSpice(ctx: ToSpiceContext) {
  const d = lineTransformerDesign({ vp: pos(ctx, 'vp'), vs: pos(ctx, 'vs'), va: pos(ctx, 'va'), regulation: ctx.num('regulation'), noLoad: pos(ctx, 'noload'), freq: pos(ctx, 'freq') });
  if (!(ctx.num('regulation') >= 0)) throw new Error('bad value for regulation: must be >= 0');
  const riso = ctx.num('riso');
  const a = internalNode(ctx, 'a');
  const b = internalNode(ctx, 'b');
  const c = internalNode(ctx, 'c');
  const dnode = internalNode(ctx, 'd');
  const sense = ctx.name('V', 'sec');
  const els: ElementIR[] = [
    elR(ctx.name('R', 'p'), ctx.node('P1'), a, Math.max(d.rp, 1e-6)),
    elL(ctx.name('L', 'm'), a, ctx.node('P2'), d.lm),
    // ideal transformer: V(b, S2) = V(a, P2) / n and the primary carries I(sec) / n
    elE(ctx.name('E', 'sec'), b, ctx.node('S2'), a, ctx.node('P2'), 1 / d.n),
    elSense(sense, b, c),
    elF(ctx.name('F', 'pri'), a, ctx.node('P2'), sense, 1 / d.n),
    elR(ctx.name('R', 's'), c, dnode, Math.max(d.rs, 1e-6)),
    elL(ctx.name('L', 'lk'), dnode, ctx.node('S1'), Math.max(d.llk, 1e-12)),
  ];
  if (riso > 0) els.push(elR(ctx.name('R', 'iso'), ctx.node('P2'), ctx.node('S2'), riso));
  return { elements: els };
}

const lineProvenance = 'MachSim line transformer: ideal transformer + magnetising inductance (no-load current), winding resistance and leakage reactance solved so the rated load sees the rated secondary voltage (regulation from the data sheet)';

function lineTransformerPart(vp: number, vs: number, va: number): LibraryPartDef {
  const t = typicalLineTransformer(va);
  return withMeta(
    {
      id: `electromechanical/line-transformer-${vp}v-${vs}v-${va}va`,
      name: `Line Transformer ${vp} V / ${vs} V ${va} VA`,
      group: 'electromechanical',
      family: 'Line transformer',
      description: `Mains step-down transformer ${vp} V to ${vs} V, ${va} VA: regulation ${t.regulation.toFixed(0)} % (the secondary reads ${eng(vs * (1 + t.regulation / 100), 'V', 3)} unloaded and ${vs} V at rated load) and ${t.noLoad.toFixed(0)} % no-load current`,
      prefix: 'T',
      symbol: TRANSFORMER_SYMBOL,
      params: lineParams(String(vp), String(vs), String(va), t.regulation.toFixed(1), t.noLoad.toFixed(1)),
      toSpice: lineToSpice,
      provenance: lineProvenance,
      footprint: 'XFMR-4P',
      keywords: ['line transformer', 'mains transformer', 'power transformer', 'step down', 'regulation', `${vp}v`, `${vs}v`, `${va}va`],
    },
    {
      vi: `Biến áp nguồn hạ áp ${vp} V xuống ${vs} V, ${va} VA: độ lệch điện áp ${t.regulation.toFixed(0)} % (thứ cấp ${eng(vs * (1 + t.regulation / 100), 'V', 3)} khi không tải và ${vs} V khi đầy tải) và dòng không tải ${t.noLoad.toFixed(0)} %`,
      nameVi: `Biến áp nguồn ${vp} V / ${vs} V ${va} VA`,
      specs: { vin: vp, vout: vs, power: va },
      sortKey: vp * 1e6 + va * 1e3 + vs,
      series: 'Line transformer',
    },
  );
}

const lineTransformers: LibraryPartDef[] = [
  withMeta(
    {
      id: 'electromechanical/line-transformer',
      name: 'Line Transformer',
      group: 'electromechanical',
      family: 'Line transformer',
      description: 'Mains transformer from its data sheet: primary voltage, secondary voltage at rated load, rated VA, regulation and no-load current (defaults: 230 V to 12 V, 50 VA)',
      prefix: 'T',
      symbol: TRANSFORMER_SYMBOL,
      params: lineParams('230', '12', '50', '12', '12'),
      toSpice: lineToSpice,
      provenance: lineProvenance,
      footprint: 'XFMR-4P',
      keywords: ['line transformer', 'mains transformer', 'power transformer', 'step down', 'regulation', 'no load current', 'va rating'],
    },
    { vi: 'Biến áp nguồn theo bảng thông số: điện áp sơ cấp, điện áp thứ cấp khi đầy tải, công suất VA, độ lệch điện áp và dòng không tải (mặc định 230 V xuống 12 V, 50 VA)', nameVi: 'Biến áp nguồn', sortKey: 0, series: 'Line transformer' },
  ),
  ...[230, 115].flatMap((vp) => [6, 9, 12, 15, 24].flatMap((vs) => [5, 25, 100].map((va) => lineTransformerPart(vp, vs, va)))),
];

// ---------------------------------------------------------------------------------------------
// magnetic flux sources

/**
 * Elements that turn the flux node into the induced voltage e = N·dΦ/dt between + and −.
 * A 1 µF capacitor carries i = C·dΦ/dt (read by a 0 V sense source, scaled by 1e6). Its 10 Ω series
 * resistor (corner 16 kHz) damps the ringing the trapezoidal rule would otherwise leave after a
 * kink of Φ(t), at an error of ω·RC (0.3 % at 50 Hz).
 */
function inducedVoltage(ctx: ToSpiceContext, phi: string, turns: number): ElementIR[] {
  const x = internalNode(ctx, 'x');
  const d = internalNode(ctx, 'd');
  const sense = ctx.name('V', 'dphi');
  return [
    elR(ctx.name('R', 'dphi'), phi, x, 10),
    elC(ctx.name('C', 'phi'), x, d, 1e-6),
    elSense(sense, d, '0'),
    elB(ctx.name('B', 'emf'), ctx.node('+'), ctx.node('-'), 'V', `${ex(turns * 1e6)}*I(${sense})`),
    elR(ctx.name('R', 'phi'), phi, '0', 1e12),
  ];
}

const FLUX_SYMBOL = (extra: ReturnType<typeof line>[]) => makeSymbol([circle(0, 0, 14), text(0, 4, 'Φ', 12, 'middle', true), line(0, -30, 0, -14), line(0, 14, 0, 30), ...extra], [pin('+', 0, -30, 'up', { label: '+', number: '1' }), pin('-', 0, 30, 'down', { number: '2' })], { refPos: { x: 24, y: -4 }, valuePos: { x: 24, y: 14 } });

const fluxSource: LibraryPartDef = withMeta(
  {
    id: 'sources/flux-source',
    name: 'Magnetic Flux Source',
    group: 'sources',
    family: 'Magnetic sources',
    description: "Magnetic flux Φ (Wb) through a coil of N turns: the voltage between + and − is the induced EMF e = N·dΦ/dt (Faraday's law). A constant flux induces nothing; step it with the key or the slider while the simulation runs to see the induced pulse. The flux is the node V(<refdes>.phi)",
    prefix: 'V',
    virtual: true,
    symbol: FLUX_SYMBOL([]),
    params: [
      numParam('flux', 'Flux', '1m', 'Wb', { showOnSchematic: true, help: 'Magnetic flux through the coil (webers)' }),
      numParam('turns', 'Turns', '100', '', { min: 0, help: 'Number of turns of the coil the flux passes through' }),
      numParam('step', 'Step', '0.1m', 'Wb', { group: 'advanced', min: 0, help: 'Change of the flux for one press of the key (Shift+key lowers it)' }),
      numParam('fmin', 'Minimum flux', '-10m', 'Wb', { group: 'advanced' }),
      numParam('fmax', 'Maximum flux', '10m', 'Wb', { group: 'advanced' }),
      keyParam('F'),
    ],
    interactive: { kind: 'slider', param: 'flux', label: 'Flux', key: 'F', step: 0.1e-3, stepParam: 'step', minParam: 'fmin', maxParam: 'fmax' },
    toSpice: (ctx) => {
      const phi = internalNode(ctx, 'phi');
      return { elements: [{ ...elB(ctx.name('B', 'flux'), phi, '0', 'V', ex(ctx.num('flux'))) }, ...inducedVoltage(ctx, phi, ctx.num('turns'))] };
    },
    provenance: "Faraday's law of induction e = N·dΦ/dt",
    keywords: ['magnetic flux', 'flux source', 'faraday', 'induced emf', 'search coil', 'magnet', 'weber'],
  },
  { vi: 'Từ thông Φ (Wb) xuyên qua cuộn dây N vòng: điện áp giữa + và − là sức điện động cảm ứng e = N·dΦ/dt (định luật Faraday). Từ thông không đổi thì không cảm ứng; bấm phím hoặc kéo thanh trượt khi đang mô phỏng để thấy xung cảm ứng. Từ thông là nút V(<ký hiệu>.phi)', nameVi: 'Nguồn từ thông', series: 'Magnetic' },
);

const WAVES = [
  ['sin', 'Sine'],
  ['triangle', 'Triangle'],
  ['square', 'Square'],
  ['sawtooth', 'Sawtooth'],
] as [string, string][];

const fluxGenerator: LibraryPartDef = withMeta(
  {
    id: 'sources/flux-generator',
    name: 'Magnetic Flux Generator',
    group: 'sources',
    family: 'Magnetic sources',
    description: "Time-varying magnetic flux Φ(t) = offset + peak·wave(2πft + phase) through a coil of N turns (sine, triangle, square or sawtooth): the voltage between + and − is the induced EMF e = N·dΦ/dt, e.g. a sine of peak Φm and frequency f induces N·2πf·Φm. The flux is the node V(<refdes>.phi)",
    prefix: 'V',
    virtual: true,
    symbol: FLUX_SYMBOL([line(-6, 8, -2, -2), line(-2, -2, 2, 8)]),
    params: [
      selectParam('wave', 'Waveform', 'sin', WAVES, { group: 'waveform' }),
      numParam('peak', 'Peak flux', '1m', 'Wb', { group: 'waveform', showOnSchematic: true }),
      numParam('freq', 'Frequency', '50', 'Hz', { group: 'waveform', min: 0, showOnSchematic: true }),
      numParam('offset', 'Offset', '0', 'Wb', { group: 'waveform' }),
      numParam('phase', 'Phase', '0', '°', { group: 'waveform' }),
      numParam('turns', 'Turns', '100', '', { min: 0 }),
    ],
    toSpice: (ctx) => {
      const peak = ctx.num('peak');
      const f = pos(ctx, 'freq');
      const off = ctx.num('offset');
      const ph = (ctx.num('phase') * Math.PI) / 180;
      // cycles elapsed, phase included; frac(x) = x - floor(x)
      const cyc = `(${ex(f)}*time+${ex(ph / (2 * Math.PI))})`;
      const arg = `(6.283185307179586*${cyc})`;
      const frac = (x: string) => `(${x}-floor(${x}))`;
      const wave = ctx.params.wave ?? 'sin';
      let shape: string;
      if (wave === 'sin') shape = `sin${arg}`;
      else if (wave === 'triangle') shape = `(4*abs(${frac(`(${cyc}-0.25)`)}-0.5)-1)`;
      else if (wave === 'square') shape = `tanh(50*sin${arg})`;
      else if (wave === 'sawtooth') shape = `(2*${frac(`(${cyc}+0.5)`)}-1)`;
      else throw new Error('bad value for wave: choose sin, triangle, square or sawtooth');
      const phi = internalNode(ctx, 'phi');
      return { elements: [elB(ctx.name('B', 'flux'), phi, '0', 'V', `${ex(off)}+${ex(peak)}*${shape}`), ...inducedVoltage(ctx, phi, ctx.num('turns'))] };
    },
    provenance: "Faraday's law of induction e = N·dΦ/dt with Φ(t) from the chosen waveform",
    keywords: ['magnetic flux', 'flux generator', 'faraday', 'induced emf', 'rotating magnet', 'generator', 'weber'],
  },
  { vi: 'Từ thông Φ(t) = độ lệch + đỉnh·sóng(2πft + pha) xuyên qua cuộn N vòng (sin, tam giác, vuông hoặc răng cưa): điện áp giữa + và − là sức điện động cảm ứng e = N·dΦ/dt, ví dụ sóng sin đỉnh Φm tần số f cảm ứng N·2πf·Φm. Từ thông là nút V(<ký hiệu>.phi)', nameVi: 'Máy phát từ thông', series: 'Magnetic' },
);

export const MAGNETICS_CATALOG: LibraryPartDef[] = [...lineTransformers, fluxSource, fluxGenerator];
