/**
 * Review: device model equations (SPICE3 forms) at the operating point and in AC.
 *
 * - Zener breakdown: I = −IBV·e^(−(V+BV)/(NBV·Vt)) dominates below −BV, so at a reverse current
 *   I_R: V = −(BV + NBV·Vt·ln(I_R/IBV)) (forward/IS terms < 1e-12 relative here).
 * - Depletion capacitance at reverse bias: C = CJO/(1 − V/VJ)^M; AC current = jωC·v.
 * - Diffusion capacitance at forward bias: C = TT·gd, gd = (I + IS)/(N·Vt).
 * - MOSFET level 1 body effect: Vt = VTO + γ(√(PHI − Vbs) − √PHI).
 * - JFET (SPICE3, B = 1): saturation Id = β(Vgs − VTO)²(1 + λVds).
 * OP values: 1e-4 relative (Newton tolerance, see dc-nonlinear.test.ts); AC: 1e-6 relative.
 */
import { describe, expect, it } from 'vitest';
import { cAt, opValue, rel, runDeck, vec, vtAt } from './ref';

describe('diode', () => {
  it('Zener: V = −(BV + NBV·Vt·ln(I/IBV)) at 10 mA reverse', () => {
    const [r] = runDeck(`zener
I1 a 0 10m
D1 a 0 DZ
.model DZ D(IS=1e-14 BV=5.1 IBV=1m)
.op
.end`);
    // I1 pulls 10 mA out of node a; it can only come from ground through the diode from its
    // cathode (0) to its anode (a): reverse conduction, V(a) ≈ −BV
    const va = opValue(r, 'V(a)');
    const ref = -(5.1 + vtAt(27) * Math.log(10e-3 / 1e-3));
    expect(Math.abs(va - ref)).toBeLessThan(1e-4);
    expect(rel(opValue(r, 'I(D1)'), -10e-3)).toBeLessThan(1e-6);
  });

  it('depletion capacitance CJO/(1 − V/VJ)^M at −5 V', () => {
    const f = 1e6;
    const [r] = runDeck(`cj
V1 a 0 DC -5 AC 1
D1 a 0 DC1
.model DC1 D(IS=1e-14 CJO=10p VJ=0.7 M=0.5)
.ac lin 1 ${f} ${f}
.end`);
    const i = cAt(vec(r, 'I(V1)'), 0);
    const cRef = 10e-12 / Math.pow(1 + 5 / 0.7, 0.5);
    // current into V1's + terminal from the circuit = −(current into the diode)
    expect(rel(Math.abs(i.im) / (2 * Math.PI * f), cRef)).toBeLessThan(1e-6);
  });

  it('diffusion capacitance TT·gd at forward bias', () => {
    const f = 1e3;
    const tt = 10e-9;
    const is = 1e-14;
    const results = runDeck(`cd
V1 a 0 DC 0.65 AC 1
D1 a 0 DT
.model DT D(IS=${is} TT=${tt})
.op
.ac lin 1 ${f} ${f}
.end`);
    const [op, ac] = results;
    const id = opValue(op, 'I(D1)');
    const gd = (id + is) / vtAt(27);
    const i = cAt(vec(ac, 'I(V1)'), 0);
    expect(rel(Math.abs(i.re), gd)).toBeLessThan(1e-4);
    expect(rel(Math.abs(i.im) / (2 * Math.PI * f), tt * gd)).toBeLessThan(1e-4);
  });
});

describe('MOSFET level 1 body effect', () => {
  it('Vt = VTO + γ(√(PHI − Vbs) − √PHI) with Vbs = −2 V', () => {
    const kp = 100e-6;
    const vto = 1;
    const gamma = 0.5;
    const phi = 0.6;
    const vt = vto + gamma * (Math.sqrt(phi + 2) - Math.sqrt(phi));
    const [r] = runDeck(`body
VD d 0 5
VG g 0 2.5
VB b 0 -2
M1 d g 0 b NM W=10u L=1u
.model NM NMOS(LEVEL=1 VTO=${vto} KP=${kp} GAMMA=${gamma} PHI=${phi})
.op
.end`);
    const idRef = 0.5 * kp * 10 * (2.5 - vt) ** 2;
    expect(rel(-opValue(r, 'I(VD)'), idRef)).toBeLessThan(1e-4);
  });
});

describe('JFET square law', () => {
  it('saturation: Id = β(Vgs − VTO)²(1 + λVds)', () => {
    const beta = 1e-3;
    const vto = -2;
    const lambda = 0.01;
    const [r] = runDeck(`jfet
VD d 0 10
VG g 0 -1
J1 d g 0 JN
.model JN NJF(VTO=${vto} BETA=${beta} LAMBDA=${lambda})
.op
.end`);
    const idRef = beta * (-1 - vto) ** 2 * (1 + lambda * 10);
    expect(rel(-opValue(r, 'I(VD)'), idRef)).toBeLessThan(1e-4);
  });
});
