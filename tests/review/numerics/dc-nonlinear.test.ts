/**
 * Review: DC operating point of nonlinear circuits against hand-solved references.
 *
 * Reference values are computed here from the published SPICE3 equations only:
 * - diode + series R: exact closed form with Lambert W,
 *     I = (N·Vt/R)·W( (IS·R/(N·Vt))·exp((Vs + IS·R)/(N·Vt)) ) − IS
 * - BJT (Gummel-Poon with qb = q1, no leakage): 2-unknown Newton on (Vb, Vc) in the test itself
 * - temperature: SPICE3 IS(T) = IS·exp((T/Tnom−1)·EG/(N·Vt(T)))·(T/Tnom)^(XTI/N), resistor
 *   R(T) = R·(1 + TC1·ΔT + TC2·ΔT²).
 *
 * Tolerances: the engine stops Newton when updates are below reltol(1e-3)·|x| + vntol(1e-6);
 * Newton is quadratically convergent at the end, so the remaining error is far below the last
 * update. We allow 20 µV on junction voltages and 1e-4 relative on currents — tighter than the
 * engine's own stop criterion would guarantee in the worst case, but any correct SPICE-class
 * solver lands within ~1 µV here. gmin (1e-12 S) contributes < 1e-9 relative and is ignored.
 */
import { describe, expect, it } from 'vitest';
import { bisect, lambertWLog, opValue, rel, runDeck, vtAt } from './ref';

const VT27 = vtAt(27);

function diodeSeriesCurrent(vs: number, r: number, is: number, n: number, vt: number): number {
  const nvt = n * vt;
  // W(a·e^b) = W(e^(ln a + b))
  const L = Math.log((is * r) / nvt) + (vs + is * r) / nvt;
  return (nvt / r) * lambertWLog(L) - is;
}

describe('diode + resistor (Lambert W)', () => {
  for (const c of [
    { vs: 5, r: 1e3, is: 1e-14, n: 1, rs: 0 },
    { vs: 0.8, r: 100, is: 2.52e-9, n: 1.752, rs: 0 },
    { vs: 12, r: 47, is: 1e-14, n: 1, rs: 0 },
    { vs: 5, r: 1e3, is: 2.52e-9, n: 1.752, rs: 0.568 },
  ]) {
    it(`Vs=${c.vs} R=${c.r} IS=${c.is} N=${c.n} RS=${c.rs}`, () => {
      const [r] = runDeck(`diode + R
V1 a 0 ${c.vs}
R1 a k ${c.r}
D1 k 0 DX
.model DX D(IS=${c.is} N=${c.n} RS=${c.rs})
.op
.end`);
      const iRef = diodeSeriesCurrent(c.vs, c.r + c.rs, c.is, c.n, VT27);
      const vkRef = c.vs - iRef * c.r;
      const vk = opValue(r, 'V(k)');
      expect(Math.abs(vk - vkRef)).toBeLessThan(20e-6);
      // source branch current is −I (SPICE sign: delivering power)
      expect(rel(-opValue(r, 'I(V1)'), iRef)).toBeLessThan(1e-4);
      expect(rel(opValue(r, 'I(D1)'), iRef)).toBeLessThan(1e-4);
    });
  }

  it('reverse bias: current is −IS (SPICE3 smooth reverse region) plus gmin leakage', () => {
    const [r] = runDeck(`reverse diode
V1 a 0 -5
R1 a k 1k
D1 k 0 DX
.model DX D(IS=1e-14)
.op
.end`);
    const id = opValue(r, 'I(D1)');
    // −IS·(1+(3Vt/(e·Vd))³) − gmin·5  ≈ −1e-14 − 5e-12
    expect(id).toBeLessThan(0);
    expect(Math.abs(id + 1e-14 + 5e-12)).toBeLessThan(0.05e-12);
  });
});

/** Gummel-Poon forward/reverse transport with qb = q1 = 1/(1 − Vbc/VAF), no leakage terms. */
function bjtRef(p: { vcc: number; rc: number; vbb: number; rb: number; is: number; bf: number; br: number; vaf: number }, vt: number) {
  const cur = (vb: number, vc: number) => {
    const vbe = vb;
    const vbc = vb - vc;
    const cbe = p.is * (Math.exp(vbe / vt) - 1);
    const cbc = p.is * (Math.exp(vbc / vt) - 1);
    const q1 = Number.isFinite(p.vaf) ? 1 / (1 - vbc / p.vaf) : 1;
    const it = (cbe - cbc) / q1;
    const ib = cbe / p.bf + cbc / p.br;
    const ic = it - cbc / p.br;
    return { ib, ic };
  };
  // nested 1-D solves: for a given Vb, Vc solves the collector KCL; then Vb solves the base KCL
  const solveVc = (vb: number) => bisect((vc) => (p.vcc - vc) / p.rc - cur(vb, vc).ic, -1, p.vcc + 1, 1e-15);
  const vb = bisect((vb) => (p.vbb - vb) / p.rb - cur(vb, solveVc(vb)).ib, 0.3, 1.0, 1e-15);
  const vc = solveVc(vb);
  return { vb, vc, ...cur(vb, vc) };
}

describe('BJT fixed bias with finite beta', () => {
  for (const vaf of [Infinity, 50]) {
    it(`VAF=${vaf}: Vb, Vc, Ic, Ib match the Gummel-Poon hand solution`, () => {
      const p = { vcc: 10, rc: 2e3, vbb: 2, rb: 100e3, is: 1e-15, bf: 100, br: 1, vaf };
      const ref = bjtRef(p, VT27);
      const [r] = runDeck(`bjt bias
VCC vcc 0 ${p.vcc}
VBB bb 0 ${p.vbb}
RB bb b ${p.rb}
RC vcc c ${p.rc}
Q1 c b 0 NX
.model NX NPN(IS=${p.is} BF=${p.bf} BR=${p.br}${Number.isFinite(vaf) ? ` VAF=${vaf}` : ''})
.op
.end`);
      expect(Math.abs(opValue(r, 'V(b)') - ref.vb)).toBeLessThan(20e-6);
      expect(Math.abs(opValue(r, 'V(c)') - ref.vc)).toBeLessThan(1e-3);
      expect(rel(opValue(r, 'Ic(Q1)'), ref.ic)).toBeLessThan(1e-4);
      expect(rel(opValue(r, 'Ib(Q1)'), ref.ib)).toBeLessThan(1e-4);
      // KCL at the device: Ie = −(Ic + Ib)
      expect(opValue(r, 'Ie(Q1)')).toBeCloseTo(-(opValue(r, 'Ic(Q1)') + opValue(r, 'Ib(Q1)')), 12);
      // beta check (forward active, VAF = ∞): Ic/Ib = BF within the tiny reverse-junction terms
      if (!Number.isFinite(vaf)) expect(rel(opValue(r, 'Ic(Q1)') / opValue(r, 'Ib(Q1)'), 100)).toBeLessThan(1e-6);
    });
  }

  it('PNP mirror image gives the same magnitudes with reversed signs', () => {
    const p = { vcc: 10, rc: 2e3, vbb: 2, rb: 100e3, is: 1e-15, bf: 100, br: 1, vaf: Infinity };
    const ref = bjtRef(p, VT27);
    const [r] = runDeck(`pnp bias
VCC vcc 0 -10
VBB bb 0 -2
RB bb b 100k
RC vcc c 2k
Q1 c b 0 PX
.model PX PNP(IS=1e-15 BF=100 BR=1)
.op
.end`);
    expect(Math.abs(opValue(r, 'V(b)') + ref.vb)).toBeLessThan(20e-6);
    expect(rel(-opValue(r, 'Ic(Q1)'), ref.ic)).toBeLessThan(1e-4);
  });
});

describe('temperature effects', () => {
  /** SPICE3 saturation-current temperature law. */
  const isAt = (is: number, n: number, eg: number, xti: number, tC: number, tnomC = 27) => {
    const t = tC + 273.15;
    const tn = tnomC + 273.15;
    return is * Math.exp(((t / tn - 1) * eg) / (n * vtAt(tC))) * Math.pow(t / tn, xti / n);
  };

  for (const tC of [-40, 27, 100]) {
    it(`diode Vf at 1 mA, T = ${tC} °C follows IS(T)`, () => {
      const [r] = runDeck(`diode temp
I1 0 a 1m
D1 a 0 DX
.model DX D(IS=1e-14 N=1)
.options temp=${tC}
.op
.end`);
      const ist = isAt(1e-14, 1, 1.11, 3, tC);
      const vref = vtAt(tC) * Math.log(1e-3 / ist + 1);
      expect(Math.abs(opValue(r, 'V(a)') - vref)).toBeLessThan(20e-6);
    });
  }

  it('diode tempco is about −2 mV/°C (sanity on the same law)', () => {
    const v = (tC: number) => opValue(runDeck(`d\nI1 0 a 1m\nD1 a 0 DX\n.model DX D(IS=1e-14)\n.options temp=${tC}\n.op\n.end`)[0], 'V(a)');
    const slope = (v(37) - v(17)) / 20;
    expect(slope).toBeLessThan(-1.7e-3);
    expect(slope).toBeGreaterThan(-2.3e-3);
  });

  it('resistor TC1/TC2 at 100 °C', () => {
    const [r] = runDeck(`r temp
I1 0 a 1m
R1 a 0 1k tc1=0.004 tc2=1e-5
.options temp=100
.op
.end`);
    const dT = 73;
    expect(opValue(r, 'V(a)')).toBeCloseTo(1e-3 * 1e3 * (1 + 0.004 * dT + 1e-5 * dT * dT), 9);
  });

  it('DC sweep of temp moves the diode voltage by the same law', () => {
    const results = runDeck(`d sweep
I1 0 a 1m
D1 a 0 DX
.model DX D(IS=1e-14)
.dc temp 0 100 50
.end`);
    const r = results[0];
    const va = r.vectors.find((x) => x.name.toLowerCase() === 'v(a)')!.re;
    expect(va.length).toBe(3);
    for (const [k, tC] of [0, 50, 100].entries()) {
      const vref = vtAt(tC) * Math.log(1e-3 / isAt(1e-14, 1, 1.11, 3, tC) + 1);
      expect(Math.abs(va[k] - vref)).toBeLessThan(20e-6);
    }
  });
});
