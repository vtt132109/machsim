/**
 * Magnetic cores with hysteresis and eddy-current loss: the Jiles–Atherton model as a netlist, an
 * inductor and a transformer built on it, and a B–H loop that the Grapher can plot.
 *
 * JILES–ATHERTON (D. C. Jiles and D. L. Atherton, 1986), the published equations with the
 * magnetisation M of a core in an applied field H:
 *   effective field        He  = H + alpha M
 *   anhysteretic           Man = Ms L(He/a),   L(x) = coth x - 1/x  (Langevin)
 *   irreversible part      dMirr/dH = (Man - Mirr) / (k delta - alpha (Man - Mirr)),  delta = sign(dH/dt),
 *                          taken as 0 when delta (Man - Mirr) < 0 (a magnetisation cannot run backwards)
 *   total                  M = (1 - c) Mirr + c Man
 * With B = mu0 (H + M) these give the reversible-plus-irreversible slope
 *   chi = dM/dH = ((1 - c) S + c Man') / (1 - c alpha Man'),   S = dMirr/dH,  Man' = (Ms/a) L'(He/a)
 * and the winding relations v = N A dB/dt, i = H l / N.
 *
 * The model is FLUX-DRIVEN, so it needs no iteration inside a time step: the voltage across the winding
 * integrates to the flux linkage lambda (a 1 F node, as in the saturating core of basicExtras.ts; the input is
 * gated off in the DC operating point so the core starts demagnetised whatever voltage the source has at t = 0),
 * B = lambda / (N A), and everything else follows from the state Mirr (a second 1 F node):
 *   dB/dt = v / (N A),  dH/dt = (dB/dt / mu0) / (1 + chi),  dMirr/dt = S dH/dt
 * and H, M, He are algebraic behavioural nodes. delta = sign(v) because B and H rise and fall together.
 * Nodes (all visible to the Grapher, "show internal vectors"): V(<ref>.b) in T, V(<ref>.h) in A/m,
 * V(<ref>.m) in A/m, V(<ref>.flux) in Wb. The B–H loop is the postprocessor expression
 * vs(V(<ref>.b), V(<ref>.h)) (the Grapher offers it as a one-click "B–H" button).
 *
 * EDDY-CURRENT LOSS (classical, laminations of thickness d and resistivity rho): the extra field
 * He_eddy = (d^2 / (12 rho)) dB/dt makes a loss density (d^2 / (12 rho)) (dB/dt)^2, i.e. P = pi^2 d^2 f^2 B^2 /
 * (6 rho) per volume for a sine. In the winding that is an exactly linear conductance across it,
 *   G = l d^2 / (12 rho N^2 A)     (I = G v),
 * a plain resistor in the netlist. Hysteresis loss is the area of the B–H loop times the frequency.
 *
 * Accuracy: the netlist reproduces the Jiles–Atherton equations to the accuracy of the transient
 * integration; against an independent RK4 integration of the same equations driven by the same H(t)
 * the flux density agrees to about 1 % of its peak (see magneticCore.test.ts). The model equations
 * are a fit to measured loops, not a physical derivation: parameter sets that are not fitted to a
 * material only give loops of the right kind. The default set is the widely quoted 'typical
 * soft steel' example of the Jiles–Atherton literature (Ms = 1.6 MA/m, a = 1100 A/m, k = 400 A/m,
 * c = 0.2, alpha = 1.6e-3); the ferrite and hard-steel presets are illustrative orders of magnitude.
 */
import type { ElementIR } from '../../sim/netlist';
import { elB, elC, elE, elF, elR, elSense, ex, internalNode, numParam, type LibraryPartDef } from '../partkit';
import { circle, humpsV, inductorBody, line, makeSymbol, pin, text, twoPinH } from '../symbols';
import type { ParamDef, SymbolPrim, ToSpiceContext } from '../types';
import { withMeta } from './kit';

/** Vacuum permeability (H/m). */
export const MU0 = 4 * Math.PI * 1e-7;

/** Core and winding in SI units. */
export interface JilesAthertonCore {
  /** turns of the winding the core is wound with */
  n: number;
  /** core cross-section (m^2) */
  ae: number;
  /** magnetic path length (m) */
  le: number;
  /** saturation magnetisation Ms (A/m) */
  ms: number;
  /** anhysteretic shape a (A/m) */
  a: number;
  /** pinning k (A/m): roughly the coercive field */
  k: number;
  /** reversibility c, 0 … 1 */
  c: number;
  /** domain coupling alpha */
  alpha: number;
  /** lamination thickness (m); 0 = no eddy loss */
  lamination: number;
  /** resistivity (ohm m) */
  rho: number;
}

/** Eddy-current conductance across the winding (S): l d^2 / (12 rho N^2 A). 0 without laminations. */
export function eddyConductance(p: Pick<JilesAthertonCore, 'n' | 'ae' | 'le' | 'lamination' | 'rho'>): number {
  if (!(p.lamination > 0) || !(p.rho > 0)) return 0;
  return (p.le * p.lamination * p.lamination) / (12 * p.rho * p.n * p.n * p.ae);
}

/** Classical eddy-current loss per volume (W/m^3) for a sine of peak flux density bpk (T) at f (Hz). */
export function eddyLossDensity(p: Pick<JilesAthertonCore, 'lamination' | 'rho'>, bpk: number, f: number): number {
  return (Math.PI * Math.PI * p.lamination * p.lamination * f * f * bpk * bpk) / (6 * p.rho);
}

/** Langevin function L(x) = coth x - 1/x (series near 0). */
export function langevin(x: number): number {
  return Math.abs(x) < 1e-3 ? x / 3 : 1 / Math.tanh(x) - 1 / x;
}

/** Derivative of the Langevin function. */
export function langevinSlope(x: number): number {
  return Math.abs(x) < 1e-2 ? 1 / 3 - (x * x) / 15 : 1 / (x * x) - 1 / (Math.sinh(x) * Math.sinh(x));
}

/** Text of L(X) for a sub-expression X (behavioural-source syntax). */
const LANG = (x: string): string => `if(abs(${x})<1e-3,(${x})/3,1/tanh(${x})-1/(${x}))`;
/** Text of L'(X). */
const LANGP = (x: string): string => `if(abs(${x})<1e-2,1/3-(${x})*(${x})/15,1/(${x})^2-1/(sinh(${x})*sinh(${x})))`;

/**
 * Netlist of the core between nodes `a` and `b`: flux integrator, Jiles–Atherton state, algebraic
 * B, H, M nodes, the magnetising current source and the eddy-current resistor.
 */
export function jilesAthertonElements(ctx: ToSpiceContext, a: string, b: string, p: JilesAthertonCore): ElementIR[] {
  const flux = internalNode(ctx, 'flux');
  const mirr = internalNode(ctx, 'mirr');
  const nb = internalNode(ctx, 'b');
  const nx = internalNode(ctx, 'x');
  const nm = internalNode(ctx, 'm');
  const nh = internalNode(ctx, 'h');
  const ns = internalNode(ctx, 's');
  const NA = p.n * p.ae;
  /** sign of the winding voltage (+1 at 0) and Man - Mirr in A/m */
  const delta = `if(V(${a},${b})>=0,1,-1)`;
  const dman = `(${ex(p.ms)}*(${LANG(`V(${nx})`)}-V(${mirr})))`;
  const out: ElementIR[] = [
    // flux linkage lambda: d(lambda)/dt = v across the winding. The input is gated off in the DC operating point
    // (time = 0, hertz = 0): a voltage source that starts at its peak would otherwise "charge" the integrator for ever.
    // Transient (time > 0) and AC (hertz > 0) see the full input.
    elB(ctx.name('B', 'flux'), '0', flux, 'I', `V(${a},${b})*(u(time)+u(hertz))`),
    elC(ctx.name('C', 'flux'), flux, '0', 1),
    elR(ctx.name('R', 'flux'), flux, '0', 1e12),
    // B = lambda / (N A)
    elB(ctx.name('B', 'b'), nb, '0', 'V', `V(${flux})/${ex(NA)}`),
    // x = He / a with He = H + alpha M and H = B/mu0 - M
    elB(ctx.name('B', 'x'), nx, '0', 'V', `(V(${nb})/${ex(MU0)}-(1-${ex(p.alpha)})*V(${nm}))/${ex(p.a)}`),
    // M = (1 - c) Mirr + c Man
    elB(ctx.name('B', 'm'), nm, '0', 'V', `(1-${ex(p.c)})*${ex(p.ms)}*V(${mirr})+${ex(p.c)}*${ex(p.ms)}*${LANG(`V(${nx})`)}`),
    // H = B/mu0 - M
    elB(ctx.name('B', 'h'), nh, '0', 'V', `V(${nb})/${ex(MU0)}-V(${nm})`),
    // S = dMirr/dH for delta = sign(v): (Man - Mirr)/(k delta - alpha (Man - Mirr)), 0 when delta (Man - Mirr) < 0
    // (delta is +1 at v = 0, so the quotient never divides by zero)
    elB(
      ctx.name('B', 's'),
      ns,
      '0',
      'V',
      `if(${dman}*${delta}>0,${dman}/(${ex(p.k)}*${delta}-${ex(p.alpha)}*${dman}),0)`,
    ),
    // Mirr (normalised by Ms) integrates dMirr/dt = S dH/dt, dH/dt = v / (mu0 N A (1 + chi))
    elB(
      ctx.name('B', 'mirr'),
      '0',
      mirr,
      'I',
      `V(${ns})*V(${a},${b})/(${ex(MU0 * NA * p.ms)}*(1+((1-${ex(p.c)})*V(${ns})+${ex(p.c)}*${ex(p.ms / p.a)}*${LANGP(`V(${nx})`)})/(1-${ex(p.c * p.alpha * (p.ms / p.a))}*${LANGP(`V(${nx})`)})))`,
    ),
    elC(ctx.name('C', 'mirr'), mirr, '0', 1),
    elR(ctx.name('R', 'mirr'), mirr, '0', 1e12),
    // magnetising current i = H l / N from a through the winding to b
    elB(ctx.name('B', 'i'), a, b, 'I', `V(${nh})*${ex(p.le / p.n)}`),
    // a DC path across the winding for the ERC (the branch itself is a controlled current source)
    elR(ctx.name('R', 'core'), a, b, 1e9),
  ];
  const ge = eddyConductance(p);
  if (ge > 0) out.push(elR(ctx.name('R', 'eddy'), a, b, 1 / ge));
  return out;
}

// ---------------------------------------------------------------------------------------------
// parts

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};
const nonNeg = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v >= 0)) throw new Error(`bad value for ${key}: must be >= 0`);
  return v;
};

interface CorePreset {
  slug: string;
  name: string;
  nameVi: string;
  description: string;
  vi: string;
  ms: string;
  a: string;
  k: string;
  c: string;
  alpha: string;
  lam: string;
  rho: string;
  note: string;
}

const PRESETS: CorePreset[] = [
  {
    slug: 'hysteresis',
    name: 'Inductor with Hysteresis Core',
    nameVi: 'Cuộn cảm lõi từ trễ',
    description: 'Inductor wound on a magnetic core with a Jiles–Atherton hysteresis loop and classical eddy-current loss (silicon steel laminations by default): the inductance depends on the history, the loop area is the core loss; plot V(<ref>.b) against V(<ref>.h) for the B–H loop',
    vi: 'Cuộn cảm quấn trên lõi từ có đường trễ Jiles–Atherton và tổn hao dòng xoáy cổ điển (mặc định thép silic dạng lá): điện cảm phụ thuộc lịch sử, diện tích vòng trễ là tổn hao lõi; vẽ V(<ref>.b) theo V(<ref>.h) để thấy đường B–H',
    ms: '1600',
    a: '1100',
    k: '400',
    c: '0.2',
    alpha: '1.6m',
    lam: '350',
    rho: '0.47',
    note: 'typical soft-steel Jiles–Atherton example set from the literature',
  },
  {
    slug: 'hysteresis-ferrite',
    name: 'Inductor with Ferrite Core (hysteresis)',
    nameVi: 'Cuộn cảm lõi ferrite (có từ trễ)',
    description: 'Inductor on a soft-ferrite core: narrow B–H loop (small coercive field), low saturation flux density and almost no eddy current — illustrative Jiles–Atherton values of the right order of magnitude',
    vi: 'Cuộn cảm lõi ferrite mềm: vòng B–H hẹp (từ trường kháng nhỏ), cảm ứng bão hoà thấp, gần như không có dòng xoáy — giá trị Jiles–Atherton minh hoạ đúng bậc độ lớn',
    ms: '380',
    a: '25',
    k: '18',
    c: '0.5',
    alpha: '4u',
    lam: '0',
    rho: '1',
    note: 'illustrative soft-ferrite values, orders of magnitude only',
  },
  {
    slug: 'hysteresis-hard',
    name: 'Inductor with Hard Magnetic Core (hysteresis)',
    nameVi: 'Cuộn cảm lõi từ cứng (có từ trễ)',
    description: 'Inductor on a hard (high-coercivity) magnetic material: wide, almost rectangular B–H loop and large remanence — illustrative Jiles–Atherton values of the right order of magnitude',
    vi: 'Cuộn cảm lõi vật liệu từ cứng (kháng từ cao): vòng B–H rộng, gần như hình chữ nhật, từ dư lớn — giá trị Jiles–Atherton minh hoạ đúng bậc độ lớn',
    ms: '1100',
    a: '4000',
    k: '3500',
    c: '0.05',
    alpha: '1m',
    lam: '0',
    rho: '1',
    note: 'illustrative hard-magnet values, orders of magnitude only',
  },
];

function coreParams(preset: CorePreset): ParamDef[] {
  return [
    numParam('turns', 'Turns N', '100', '', { showOnSchematic: true, min: 1, help: 'Turns of the winding on the core' }),
    numParam('area', 'Core cross-section Ae', '100', 'mm²', { min: 0, help: 'Magnetic cross-section of the core (100 mm² = 1 cm²)' }),
    numParam('length', 'Magnetic path length le', '100', 'mm', { min: 0, help: 'Mean length of the magnetic path around the core' }),
    numParam('ms', 'Saturation magnetisation Ms', preset.ms, 'kA/m', { group: 'model', min: 0, help: 'Magnetisation when every domain is aligned; μ0·Ms is the saturation flux density (1600 kA/m is about 2 T)' }),
    numParam('a', 'Anhysteretic shape a', preset.a, 'A/m', { group: 'model', min: 0, help: 'Field scale of the ideal (loss-free) magnetisation curve: a bigger a gives a gentler knee' }),
    numParam('k', 'Pinning k', preset.k, 'A/m', { group: 'model', min: 0, help: 'Sets the width of the loop: about the coercive field. 0 = no hysteresis' }),
    numParam('c', 'Reversibility c', preset.c, '', { group: 'model', min: 0, max: 1, help: 'Share of the magnetisation that is reversible (0 … 1)' }),
    numParam('alpha', 'Domain coupling α', preset.alpha, '', { group: 'model', min: 0, help: 'Feedback between the domains (mean-field parameter), about 1e-3' }),
    numParam('lam', 'Lamination thickness d', preset.lam, 'µm', { group: 'advanced', min: 0, help: 'Thickness of the sheets of the core: eddy-current loss grows with d². 0 = solid core without eddy loss' }),
    numParam('rho', 'Resistivity ρ', preset.rho, 'µΩ·m', { group: 'advanced', min: 0, help: 'Electrical resistivity of the core material (silicon steel about 0.47 µΩ·m)' }),
    numParam('rser', 'Winding resistance', '0.1', 'Ω', { group: 'advanced', min: 0 }),
  ];
}

function readCore(ctx: ToSpiceContext): JilesAthertonCore {
  const c = ctx.num('c');
  if (!(c >= 0 && c <= 1)) throw new Error('bad value for c: must be between 0 and 1');
  return {
    n: pos(ctx, 'turns'),
    ae: pos(ctx, 'area') * 1e-6,
    le: pos(ctx, 'length') * 1e-3,
    ms: pos(ctx, 'ms') * 1e3,
    a: pos(ctx, 'a'),
    k: Math.max(nonNeg(ctx, 'k'), 1e-3),
    c,
    alpha: nonNeg(ctx, 'alpha'),
    lamination: nonNeg(ctx, 'lam') * 1e-6,
    rho: Math.max(nonNeg(ctx, 'rho') * 1e-6, 1e-12),
  };
}

function inductorPart(preset: CorePreset): LibraryPartDef {
  return withMeta(
    {
      id: `basic/inductor-${preset.slug}`,
      name: preset.name,
      group: 'basic',
      family: 'Inductor',
      description: preset.description,
      prefix: 'L',
      symbol: twoPinH([...inductorBody(true), text(0, 16, 'JA', 6)]),
      params: coreParams(preset),
      toSpice: (ctx) => {
        const core = readCore(ctx);
        const rs = nonNeg(ctx, 'rser');
        const a = ctx.node('1');
        const m = rs > 0 ? internalNode(ctx, 'r') : a;
        const els: ElementIR[] = rs > 0 ? [elR(ctx.name('R', 'ser'), a, m, rs)] : [];
        els.push(...jilesAthertonElements(ctx, m, ctx.node('2'), core));
        return { elements: els };
      },
      provenance: `Jiles–Atherton hysteresis (1986) as a flux-driven netlist with classical eddy-current loss; ${preset.note}`,
      footprint: 'IND-RADIAL-500',
      keywords: ['hysteresis', 'b-h', 'jiles atherton', 'magnetic core', 'eddy current', 'core loss', 'coercive', 'remanence', 'inductor', 'lõi từ', 'từ trễ'],
    },
    { vi: preset.vi, nameVi: preset.nameVi },
  );
}

/** Winding symbol pieces (same drawing as the multi-winding transformers of basicExtras.ts). */
function windingPrims(side: 'left' | 'right', y0: number, y1: number): SymbolPrim[] {
  const x = side === 'left' ? -10 : 10;
  const px = side === 'left' ? -40 : 40;
  const n = Math.max(2, Math.round((y1 - y0) / 10));
  return [line(px, y0, x, y0), line(px, y1, x, y1), ...humpsV(y0, y1, x, n, side === 'right'), circle(side === 'left' ? -20 : 20, y0 - 6, 1.8, true)];
}

function transformerSymbol() {
  const prims: SymbolPrim[] = [...windingPrims('left', -20, 20), ...windingPrims('right', -20, 20), line(-6, -22, -6, 22), line(6, -22, 6, 22), line(-2, -22, -2, 22), line(2, -22, 2, 22), text(0, 34, 'JA', 6)];
  const pins = [pin('P1', -40, -20, 'left', { number: '1' }), pin('P2', -40, 20, 'left', { number: '2' }), pin('S1', 40, -20, 'right', { number: '3' }), pin('S2', 40, 20, 'right', { number: '4' })];
  return makeSymbol(prims, pins, { refPos: { x: 0, y: -36 }, valuePos: { x: 0, y: 48 } });
}

function transformerPart(): LibraryPartDef {
  const base = PRESETS[0];
  const params: ParamDef[] = [
    numParam('ratio', 'Turns ratio Np:Ns', '10', '', { showOnSchematic: true, min: 0, help: 'Primary turns per secondary turn (10 = 10:1 step-down)' }),
    ...coreParams(base).map((p) => (p.key === 'turns' ? { ...p, label: 'Primary turns Np', help: 'Turns of the primary winding on the core (the core is calculated with these)' } : p)),
    numParam('rs', 'Secondary resistance', '50m', 'Ω', { group: 'advanced', min: 0 }),
    numParam('riso', 'Isolation resistance', '1G', 'Ω', { group: 'advanced', min: 0, help: 'Leakage between windings (gives the secondary a DC reference)' }),
  ];
  return withMeta(
    {
      id: 'basic/transformer-hysteresis',
      name: 'Transformer with Hysteresis Core',
      group: 'basic',
      family: 'Transformer',
      description: 'Transformer whose iron core has a Jiles–Atherton hysteresis loop and eddy-current loss: the magnetising current is distorted (flat-topped, with remanence), the no-load loss is the loop area; exact turns ratio Np:Ns',
      prefix: 'T',
      symbol: transformerSymbol(),
      params,
      toSpice: (ctx) => {
        const n = pos(ctx, 'ratio');
        const core = readCore(ctx);
        const rp = nonNeg(ctx, 'rser');
        const rs = nonNeg(ctx, 'rs');
        const riso = nonNeg(ctx, 'riso');
        const p1 = ctx.node('P1');
        const p2 = ctx.node('P2');
        const s1 = ctx.node('S1');
        const s2 = ctx.node('S2');
        const a = rp > 0 ? internalNode(ctx, 'p') : p1;
        const b = internalNode(ctx, 'sb');
        const c = rs > 0 ? internalNode(ctx, 'sc') : s1;
        const sense = ctx.name('V', 'sec');
        const els: ElementIR[] = [];
        if (rp > 0) els.push(elR(ctx.name('R', 'p'), p1, a, rp));
        els.push(...jilesAthertonElements(ctx, a, p2, core));
        // ideal transformer: V(b,S2) = V(a,P2)/n, and the primary carries I(sec)/n
        els.push(elE(ctx.name('E', 'sec'), b, s2, a, p2, 1 / n), elSense(sense, b, c), elF(ctx.name('F', 'pri'), a, p2, sense, 1 / n));
        if (rs > 0) els.push(elR(ctx.name('R', 's'), c, s1, rs));
        if (riso > 0) els.push(elR(ctx.name('R', 'iso'), p2, s2, riso));
        return { elements: els };
      },
      provenance: 'Jiles–Atherton hysteresis (1986) as a flux-driven netlist with classical eddy-current loss, ideal transformer windings with copper resistance',
      footprint: 'XFMR-4P',
      keywords: ['transformer', 'hysteresis', 'b-h', 'jiles atherton', 'magnetic core', 'eddy current', 'core loss', 'remanence', 'inrush', 'biến áp', 'từ trễ'],
    },
    { vi: 'Biến áp có lõi sắt từ trễ Jiles–Atherton và tổn hao dòng xoáy: dòng từ hoá méo (bị phẳng đỉnh, có từ dư), tổn hao không tải là diện tích vòng trễ; tỉ số vòng Np:Ns chính xác', nameVi: 'Biến áp lõi từ trễ' },
  );
}

export const HYSTERESIS_CATALOG: LibraryPartDef[] = [...PRESETS.map(inductorPart), transformerPart()];

