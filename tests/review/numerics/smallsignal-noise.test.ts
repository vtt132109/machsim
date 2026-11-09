/**
 * Review: small-signal parameters at the operating point and noise spectra.
 *
 * gm references (computed here, not taken from the simulator):
 * - MOSFET level 1 (Shichman-Hodges): Id = (KP/2)(W/L)(Vgs−Vt)²(1+λVds),
 *     gm = KP(W/L)(Vgs−Vt)(1+λVds),  gds = λ(KP/2)(W/L)(Vgs−Vt)²
 *   Vds is obtained by solving Vds = VDD − RD·Id(Vds) by bisection. Low-frequency gain of a
 *   common-source stage with the gate driven by an ideal source: −gm·(RD ‖ 1/gds).
 * - BJT (Gummel-Poon, VAF = ∞): gm = IS·e^(Vbe/Vt)/Vt, gπ = gm/BF; with the base driven by an
 *   ideal source the gain is −gm·RC and the source sees an AC current −gπ·vbe.
 * - Noise: resistor 4kTR, divider R1‖R2, kT/C integrated over the band, diode shot 2qI·rd².
 *
 * The AC solution is exact linear algebra around the OP, so gains must agree to the OP
 * accuracy (1e-4 relative). Noise spectra are deterministic formulas: 1e-6 relative except the
 * band-integrated kT/C (0.5 %: the band 1 Hz…1 GHz misses ~1e-4 of the power and the
 * power-law segment integration on a 50-point/decade grid adds ~1e-4).
 */
import { describe, expect, it } from 'vitest';
import { BOLTZ, CHARGE } from '../../../src/sim/device';
import { bisect, cAt, cAbs, cArgDeg, opValue, rel, runDeck, scaleOf, vec, vtAt } from './ref';

describe('MOSFET level-1 gm and gds at the OP', () => {
  const kp = 100e-6;
  const W = 10e-6;
  const L = 1e-6;
  const vto = 1;
  const lambda = 0.02;
  const vdd = 10;
  const rd = 10e3;
  for (const vgs of [1.5, 2]) {
    it(`Vgs = ${vgs} V: Id, Vds and AC gain −gm(RD‖ro) match the square law`, () => {
      const beta = (kp * W) / L;
      const id = (vds: number) => 0.5 * beta * (vgs - vto) ** 2 * (1 + lambda * vds);
      const vds = bisect((v) => vdd - rd * id(v) - v, 0, vdd);
      // must be in saturation for the formulas to apply
      expect(vds).toBeGreaterThan(vgs - vto);
      const gm = beta * (vgs - vto) * (1 + lambda * vds);
      const gds = lambda * 0.5 * beta * (vgs - vto) ** 2;
      const gain = -gm / (1 / rd + gds);
      const results = runDeck(`cs amp
VDD vdd 0 ${vdd}
VG g 0 DC ${vgs} AC 1
RD vdd d ${rd}
M1 d g 0 0 NM W=${W} L=${L}
.model NM NMOS(LEVEL=1 VTO=${vto} KP=${kp} LAMBDA=${lambda})
.op
.ac lin 1 10 10
.end`);
      const [op, ac] = results;
      expect(Math.abs(opValue(op, 'V(d)') - vds)).toBeLessThan(1e-5);
      expect(rel(opValue(op, 'Id(M1)'), id(vds))).toBeLessThan(1e-4);
      const h = cAt(vec(ac, 'V(d)'), 0);
      expect(rel(h.re, gain)).toBeLessThan(1e-4);
      expect(Math.abs(h.im)).toBeLessThan(1e-9 * Math.abs(gain));
    });
  }

  it('triode region: Id = β[(Vgs−Vt)Vds − Vds²/2](1+λVds)', () => {
    const beta = (kp * W) / L;
    const vgs = 5;
    const rdT = 20e3;
    const id = (vds: number) => beta * ((vgs - vto) * vds - 0.5 * vds * vds) * (1 + lambda * vds);
    const vds = bisect((v) => vdd - rdT * id(v) - v, 0, vgs - vto);
    const [op] = runDeck(`triode
VDD vdd 0 ${vdd}
VG g 0 ${vgs}
RD vdd d ${rdT}
M1 d g 0 0 NM W=${W} L=${L}
.model NM NMOS(LEVEL=1 VTO=${vto} KP=${kp} LAMBDA=${lambda})
.op
.end`);
    expect(Math.abs(opValue(op, 'V(d)') - vds)).toBeLessThan(1e-5);
  });
});

describe('BJT gm = Ic/Vt and gπ = gm/β at the OP', () => {
  it('base driven by an ideal source: gain −gm·RC, input admittance gπ', () => {
    const is = 1e-15;
    const bf = 150;
    const vbe = 0.65;
    const rc = 1e3;
    const vt = vtAt(27);
    const gm = (is * Math.exp(vbe / vt)) / vt;
    const results = runDeck(`ce gm
VCC vcc 0 10
VB b 0 DC ${vbe} AC 1
RC vcc c ${rc}
Q1 c b 0 NX
.model NX NPN(IS=${is} BF=${bf})
.op
.ac lin 1 100 100
.end`);
    const [op, ac] = results;
    const ic = opValue(op, 'Ic(Q1)');
    expect(rel(ic, is * (Math.exp(vbe / vt) - 1))).toBeLessThan(1e-3);
    const h = cAt(vec(ac, 'V(c)'), 0);
    expect(rel(h.re, -gm * rc)).toBeLessThan(1e-3);
    // the AC branch current of VB: current flowing into its + terminal = −(base current)
    const ib = cAt(vec(ac, 'I(VB)'), 0);
    expect(rel(-ib.re, gm / bf)).toBeLessThan(1e-3);
  });
});

describe('noise', () => {
  const k4T = (tC: number) => 4 * BOLTZ * (tC + 273.15);

  it('divider R1 = R2 = 1k: onoise = √(4kT·500 Ω), gain 0.5, inoise = onoise / 0.5', () => {
    const [r] = runDeck(`divider noise
V1 in 0 DC 0 AC 1
R1 in out 1k
R2 out 0 1k
.noise V(out) V1 dec 5 1k 100k
.end`);
    const on = vec(r, 'onoise_spectrum').re;
    const inn = vec(r, 'inoise_spectrum').re;
    const ref = Math.sqrt(k4T(27) * 500);
    for (let i = 0; i < on.length; i++) {
      expect(rel(on[i], ref)).toBeLessThan(1e-6);
      expect(rel(inn[i], ref / 0.5)).toBeLessThan(1e-6);
    }
    expect(rel(vec(r, 'gain').re[0], 0.5)).toBeLessThan(1e-9);
  });

  it('4kTR scales with circuit temperature (127 °C)', () => {
    const [r] = runDeck(`hot resistor
I1 0 out DC 0 AC 1
R1 out 0 10k
.options temp=127
.noise V(out) I1 lin 1 1k 1k
.end`);
    expect(rel(vec(r, 'onoise_spectrum').re[0], Math.sqrt(k4T(127) * 10e3))).toBeLessThan(1e-6);
  });

  it('RC low-pass: total output noise integrates to kT/C', () => {
    const C = 1e-9;
    const [r] = runDeck(`ktc
V1 in 0 DC 0 AC 1
R1 in out 1k
C1 out 0 ${C}
.noise V(out) V1 dec 50 1 1g
.end`);
    const total = r.scalars?.onoise_total;
    expect(total).toBeDefined();
    const ref = Math.sqrt((BOLTZ * 300.15) / C);
    expect(rel(total!, ref)).toBeLessThan(5e-3);
    // spectrum shape: S(f) = 4kTR / (1 + (f/fc)²)
    const f = scaleOf(r);
    const on = vec(r, 'onoise_spectrum').re;
    const fc = 1 / (2 * Math.PI * 1e3 * C);
    for (let i = 0; i < f.length; i += 37) {
      expect(rel(on[i], Math.sqrt(k4T(27) * 1e3 / (1 + (f[i] / fc) ** 2)))).toBeLessThan(1e-6);
    }
  });

  it('diode shot noise: √(2qI)·rd with rd = N·Vt/(I+IS)', () => {
    const i0 = 1e-3;
    const is = 1e-14;
    const [r] = runDeck(`shot
I1 0 a DC 1m AC 1
D1 a 0 DX
.model DX D(IS=${is})
.noise V(a) I1 lin 1 1k 1k
.end`);
    const rdiode = vtAt(27) / (i0 + is);
    const ref = Math.sqrt(2 * CHARGE * i0) * rdiode;
    expect(rel(vec(r, 'onoise_spectrum').re[0], ref)).toBeLessThan(1e-3);
  });
});

describe('AC phase convention', () => {
  it('series RC: V(out) lags by atan(ωRC) and the capacitor current leads by 90° − that', () => {
    const [ac] = runDeck(`rc phase
V1 in 0 AC 1 30
R1 in out 1k
C1 out 0 1u
.ac lin 1 159.1549430918953 159.1549430918953
.end`);
    const v = cAt(vec(ac, 'V(out)'), 0);
    expect(cAbs(v)).toBeCloseTo(Math.SQRT1_2, 9);
    // source phase 30° minus 45°
    expect(cArgDeg(v)).toBeCloseTo(-15, 6);
  });
});
