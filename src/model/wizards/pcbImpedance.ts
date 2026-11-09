/**
 * PCB transmission-line impedance calculator (quasi-static, published closed-form formulas).
 * All lengths in millimetres; the results do not depend on the unit except the per-length values.
 *
 *   microstrip        Hammerstad & Jensen (1980): Z01(u) = η0/(2π)·ln(f(u)/u + √(1 + 4/u²)),
 *                     εeff(u) with the a(u)·b(εr) exponent, thickness correction Δu (Wheeler /
 *                     Hammerstad–Jensen); about 0.2 % accurate for 0.01 ≤ w/h ≤ 100.
 *   embedded micro.   microstrip in air, then εeff = εr·(1 − e^(−1.55·hTop/h)) (IPC-2141 style).
 *   stripline         Wheeler (1978) closed form with strip thickness; for t = 0 it agrees with the
 *                     exact conformal-mapping result Z0 = η0/(4√εr)·K(k)/K(k′), k = sech(πw/2b).
 *   coplanar (CPW)    conformal mapping (Wen 1969); grounded CPW after Ghione & Naldi.
 *   differential      edge-coupled pairs from the single-line Z0 with the widely used coupling
 *                     factors: microstrip Zdiff = 2Z0(1 − 0.48·e^(−0.96 s/h)), stripline
 *                     Zdiff = 2Z0(1 − 0.347·e^(−2.9 s/b)) (IPC-2141A / National AN-905).
 * Derived per-length values: delay tpd = √εeff / c0, C′ = √εeff/(c0·Z0), L′ = Z0·√εeff / c0.
 */

export const ETA0 = 376.730313;
export const C0 = 299_792_458;

export type LineKind = 'microstrip' | 'embedded' | 'stripline' | 'cpw' | 'gcpw' | 'diff-microstrip' | 'diff-stripline';
export const LINE_KINDS: readonly LineKind[] = ['microstrip', 'embedded', 'stripline', 'cpw', 'gcpw', 'diff-microstrip', 'diff-stripline'];

export interface LineGeometry {
  /** trace width */
  w: number;
  /** dielectric height trace → ground (microstrip, CPW); stripline: total ground spacing b */
  h: number;
  /** copper thickness (default 0.035 mm = 1 oz) */
  t?: number;
  /** relative permittivity */
  er: number;
  /** gap: CPW slot width, or the spacing between the traces of a differential pair */
  s?: number;
  /** embedded microstrip: dielectric thickness above the trace */
  cover?: number;
}

export interface LineResult {
  /** single-ended characteristic impedance (Ω) */
  z0: number;
  /** effective permittivity */
  eeff: number;
  /** differential impedance (pairs only) */
  zdiff?: number;
  /** propagation delay (ps/mm) */
  delay: number;
  /** capacitance per length (pF/mm) and inductance per length (nH/mm) */
  cPerMm: number;
  lPerMm: number;
  /** a geometry warning (outside the formula's range) */
  warning?: 'range';
}

/** Complete elliptic integral of the first kind K(k) (arithmetic-geometric mean). */
export function ellipticK(k: number): number {
  if (!(k >= 0 && k < 1)) return k >= 1 ? Number.POSITIVE_INFINITY : Number.NaN;
  let a = 1;
  let b = Math.sqrt(1 - k * k);
  for (let i = 0; i < 40 && Math.abs(a - b) > 1e-15 * a; i++) {
    const an = (a + b) / 2;
    b = Math.sqrt(a * b);
    a = an;
  }
  return Math.PI / (2 * a);
}

/** K(k)/K(k′) with k′ = √(1 − k²). */
export function kRatio(k: number): number {
  return ellipticK(k) / ellipticK(Math.sqrt(1 - k * k));
}

function z01(u: number): number {
  const f = 6 + (2 * Math.PI - 6) * Math.exp(-Math.pow(30.666 / u, 0.7528));
  return (ETA0 / (2 * Math.PI)) * Math.log(f / u + Math.sqrt(1 + 4 / (u * u)));
}

function eeffHJ(u: number, er: number): number {
  const a = 1 + Math.log((u ** 4 + (u / 52) ** 2) / (u ** 4 + 0.432)) / 49 + Math.log(1 + (u / 18.1) ** 3) / 18.7;
  const b = 0.564 * Math.pow((er - 0.9) / (er + 3), 0.053);
  return (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 10 / u, -a * b);
}

/** Microstrip Z0 and εeff (Hammerstad–Jensen with thickness correction). */
export function microstripLine(w: number, h: number, t: number, er: number): { z0: number; eeff: number } {
  const u = w / h;
  let u1 = u;
  let ur = u;
  if (t > 0) {
    const th = t / h;
    const coth = 1 / Math.tanh(Math.sqrt(6.517 * u));
    const du1 = (th / Math.PI) * Math.log(1 + (4 * Math.E) / (th * coth * coth));
    const dur = 0.5 * (1 + 1 / Math.cosh(Math.sqrt(Math.max(0, er - 1)))) * du1;
    u1 = u + du1;
    ur = u + dur;
  }
  const er0 = eeffHJ(ur, er);
  const z0 = z01(ur) / Math.sqrt(er0);
  const eeff = er0 * (z01(u1) / z01(ur)) ** 2;
  return { z0, eeff };
}

/** Exact zero-thickness centred stripline Z0 (b = ground plane spacing). */
export function striplineExact(w: number, b: number, er: number): number {
  const k = 1 / Math.cosh((Math.PI * w) / (2 * b));
  return (ETA0 / (4 * Math.sqrt(er))) * kRatio(k);
}

/** Centred stripline Z0 with strip thickness (Wheeler 1978). */
export function striplineLine(w: number, b: number, t: number, er: number): number {
  const x = t / b;
  let wp = w;
  if (t > 0) {
    const m = 2 / (1 + ((2 / 3) * x) / (1 - x));
    const dw = (x / Math.PI) * (1 - 0.5 * Math.log((x / (2 - x)) ** 2 + ((0.0796 * x) / (w / b + 1.1 * x)) ** m));
    wp = w + dw * (b - t);
  }
  const r = (b - t) / wp;
  const a = (4 / Math.PI) * r;
  const inner = (8 / Math.PI) * r;
  return (30 / Math.sqrt(er)) * Math.log(1 + a * (inner + Math.sqrt(inner * inner + 6.27)));
}

/** Coplanar waveguide (no bottom ground) Z0 and εeff, zero thickness. */
export function cpwLine(w: number, s: number, h: number, er: number): { z0: number; eeff: number } {
  const k0 = w / (w + 2 * s);
  const k1 = Math.sinh((Math.PI * w) / (4 * h)) / Math.sinh((Math.PI * (w + 2 * s)) / (4 * h));
  const eeff = 1 + ((er - 1) / 2) * kRatio(k1) / kRatio(k0);
  return { z0: (30 * Math.PI) / (Math.sqrt(eeff) * kRatio(k0)), eeff };
}

/** Grounded (conductor-backed) coplanar waveguide Z0 and εeff, zero thickness. */
export function gcpwLine(w: number, s: number, h: number, er: number): { z0: number; eeff: number } {
  const k0 = w / (w + 2 * s);
  const k3 = Math.tanh((Math.PI * w) / (4 * h)) / Math.tanh((Math.PI * (w + 2 * s)) / (4 * h));
  const r0 = kRatio(k0);
  const r3 = kRatio(k3);
  const eeff = (1 + er * r3 / r0) / (1 + r3 / r0);
  return { z0: (60 * Math.PI) / (Math.sqrt(eeff) * (r0 + r3)), eeff };
}

function perLength(z0: number, eeff: number): Pick<LineResult, 'delay' | 'cPerMm' | 'lPerMm'> {
  const v = Math.sqrt(eeff) / C0; // s/m
  return { delay: v * 1e-3 * 1e12, cPerMm: (v / z0) * 1e-3 * 1e12, lPerMm: z0 * v * 1e-3 * 1e9 };
}

/** Impedance of a line geometry. */
export function lineImpedance(kind: LineKind, g: LineGeometry): LineResult {
  const t = g.t ?? 0.035;
  const s = g.s ?? 0.2;
  let z0: number;
  let eeff: number;
  let zdiff: number | undefined;
  let warning: LineResult['warning'];
  switch (kind) {
    case 'microstrip':
    case 'diff-microstrip': {
      ({ z0, eeff } = microstripLine(g.w, g.h, t, g.er));
      if (g.w / g.h < 0.05 || g.w / g.h > 20) warning = 'range';
      if (kind === 'diff-microstrip') zdiff = 2 * z0 * (1 - 0.48 * Math.exp((-0.96 * s) / g.h));
      break;
    }
    case 'embedded': {
      const air = microstripLine(g.w, g.h, t, 1);
      const cover = g.cover ?? 0.1;
      eeff = g.er * (1 - Math.exp((-1.55 * (g.h + cover)) / g.h));
      z0 = (air.z0 * Math.sqrt(air.eeff)) / Math.sqrt(eeff);
      if (g.w / g.h < 0.1 || g.w / g.h > 10) warning = 'range';
      break;
    }
    case 'stripline':
    case 'diff-stripline': {
      z0 = striplineLine(g.w, g.h, t, g.er);
      eeff = g.er;
      if (t >= g.h / 2 || g.w / (g.h - t) < 0.05) warning = 'range';
      if (kind === 'diff-stripline') zdiff = 2 * z0 * (1 - 0.347 * Math.exp((-2.9 * s) / g.h));
      break;
    }
    case 'cpw':
      ({ z0, eeff } = cpwLine(g.w, s, g.h, g.er));
      break;
    case 'gcpw':
      ({ z0, eeff } = gcpwLine(g.w, s, g.h, g.er));
      break;
  }
  return { z0, eeff, ...(zdiff !== undefined ? { zdiff } : {}), ...perLength(z0, eeff), ...(warning ? { warning } : {}) };
}

/**
 * Trace width giving the target impedance (single-ended Z0, or Zdiff for the pairs), by
 * bisection on log(w) between h/200 and 30·h. Null when the target is out of reach.
 */
export function widthForImpedance(kind: LineKind, g: Omit<LineGeometry, 'w'>, target: number): number | null {
  const diff = kind === 'diff-microstrip' || kind === 'diff-stripline';
  const zOf = (w: number) => {
    const r = lineImpedance(kind, { ...g, w });
    return diff ? (r.zdiff ?? r.z0) : r.z0;
  };
  let lo = Math.log(g.h / 200);
  let hi = Math.log(g.h * 30);
  const zLo = zOf(Math.exp(lo));
  const zHi = zOf(Math.exp(hi));
  if (!(target <= zLo && target >= zHi)) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (zOf(Math.exp(mid)) > target) lo = mid;
    else hi = mid;
  }
  return Math.exp((lo + hi) / 2);
}
