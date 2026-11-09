/**
 * Field-effect and other transistor catalogue (group Transistors, RF MOSFETs in RF):
 * MOSFETs (small-signal, logic-level, power; N and P; depletion mode), JFETs, IGBTs, UJTs /
 * PUTs and GaAs MESFETs.
 *
 * Models (MachSim fits to datasheet figures, approximate away from the fitted points):
 *   MOSFET   mosfetFitModel() of src/library/parts/transistors.ts: SPICE level 1 with
 *            KP·(|VGS| − Vth) = 1 / RDS(on) at the datasheet gate drive, Ciss / Crss as overlap
 *            capacitances, a separate body diode (IS ≈ 0.2 pA per amp of ID, BV = VDSS).
 *            Depletion types: level 1 with negative VTO and KP = 2·IDSS / VTO².
 *   JFET     Shichman-Hodges with BETA = IDSS / VP² (typical IDSS and VGS(off)), CGS / CGD from
 *            Ciss − Crss and Crss.
 *   IGBT     NMOS driving the base of a wide-base PNP (βp = 0.5): the MOSFET is sized so that
 *            VCE(sat) = VEB(on) + VDS matches the datasheet at the rated current and VGE = 15 V;
 *            co-packaged parts ("…D") add the anti-parallel diode.
 *   UJT      the standard PUT equivalent: interbase resistance RBB split by the intrinsic
 *            stand-off ratio η into RB1 / RB2; the emitter fires when V(E) > η·VBB + 0.6 V
 *            (peak current ≈ 20 µA) and turns off below a valley current of a few mA.
 *   PUT      two-transistor latch (anode, n-gate, cathode).
 *   MESFET   Statz model (SPICE element Z) with VTO / BETA from IDSS and the pinch-off voltage.
 */
import type { ElementIR, ModelCard } from '../../sim/netlist';
import { thermalVoltage } from '../../sim/device';
import { parseUserNumber } from '../../util/units';
import { card, elD, elJ, elM, elQ, elR, elX, modelOverride, subckt, type LibraryPartDef } from '../partkit';
import { mosfetFitModel } from '../parts/transistors';
import { circle, jfetSymbol, line, makeSymbol, mosfetSymbol, pin, poly, text } from '../symbols';
import type { PartGroup, SymbolDef } from '../types';
import { eng, modelName, modelOverrideParam, slug, withMeta } from './kit';

const VT = thermalVoltage(300.15);
const W = 100e-6;
const L = 100e-6;

const num = (s: string, pn: string): number => {
  const v = parseUserNumber(s);
  if (!Number.isFinite(v)) throw new Error(`bad catalogue value '${s}' in ${pn}`);
  return v;
};

// ---------------------------------------------------------------------------------------------
// MOSFETs: "pn ch VDS ID RDS(on) VGS@RDS Vth Ciss Crss Coss Pd package [group]"

const MOS_TEXT: string[] = [
  'IRF510 N 100 5.6 0.54 10 3 180p 15p 80p 43 TO-220',
  'IRF520 N 100 9.2 0.27 10 3 360p 34p 150p 60 TO-220',
  'IRF520N N 100 9.7 0.2 10 3 330p 25p 92p 48 TO-220',
  'IRF530 N 100 14 0.16 10 3 670p 60p 250p 88 TO-220',
  'IRF530N N 100 17 0.09 10 3 920p 54p 130p 70 TO-220',
  'IRF540 N 100 28 0.077 10 3 1.7n 120p 560p 150 TO-220',
  'IRF610 N 200 3.3 1.5 10 3 140p 15p 53p 36 TO-220',
  'IRF620 N 200 5.2 0.8 10 3 260p 30p 100p 50 TO-220',
  'IRF630 N 200 9 0.4 10 3 800p 76p 240p 74 TO-220',
  'IRF634 N 250 8.1 0.45 10 3 770p 70p 170p 74 TO-220',
  'IRF640 N 200 18 0.18 10 3 1.3n 120p 430p 125 TO-220',
  'IRF640N N 200 18 0.15 10 3 1.16n 39p 185p 150 TO-220',
  'IRF644 N 250 14 0.28 10 3 1.3n 120p 330p 125 TO-220',
  'IRF710 N 400 2 3.6 10 3 170p 6.5p 34p 36 TO-220',
  'IRF720 N 400 3.3 1.8 10 3 410p 17p 88p 50 TO-220',
  'IRF730 N 400 5.5 1 10 3 700p 65p 170p 74 TO-220',
  'IRF740 N 400 10 0.55 10 3 1.4n 120p 330p 125 TO-220',
  'IRF820 N 500 2.5 3 10 3 360p 37p 92p 50 TO-220',
  'IRF830 N 500 4.5 1.5 10 3 610p 70p 160p 74 TO-220',
  'IRF840 N 500 8 0.85 10 3 1.3n 120p 310p 125 TO-220',
  'IRF9510 P 100 4 1.2 10 3 200p 25p 94p 43 TO-220',
  'IRF9520 P 100 6.8 0.6 10 3 350p 60p 170p 60 TO-220',
  'IRF9530 P 100 12 0.3 10 3 760p 140p 330p 88 TO-220',
  'IRF9540 P 100 19 0.2 10 3 1.4n 300p 590p 150 TO-220',
  'IRF9610 P 200 1.8 3 10 3 170p 15p 50p 20 TO-220',
  'IRF9620 P 200 3.5 1.5 10 3 350p 40p 100p 40 TO-220',
  'IRF9630 P 200 6.5 0.8 10 3 700p 70p 200p 74 TO-220',
  'IRF9640 P 200 11 0.5 10 3 1.2n 140p 400p 125 TO-220',
  'IRFZ24N N 55 17 0.07 10 3 370p 65p 140p 45 TO-220',
  'IRFZ34N N 55 29 0.04 10 3 700p 110p 240p 68 TO-220',
  'IRFZ46N N 55 53 0.0165 10 3 1.7n 230p 520p 107 TO-220',
  'IRFZ48N N 55 64 0.014 10 3 1.97n 260p 650p 130 TO-220',
  'IRF3205 N 55 110 0.008 10 3 3.25n 210p 780p 200 TO-220',
  'IRF1404 N 40 202 0.004 10 3 5.67n 690p 1.66n 200 TO-220',
  'IRF1405 N 55 169 0.0053 10 3 5.48n 380p 1.21n 200 TO-220',
  'IRF1010E N 60 84 0.012 10 3 3.21n 200p 690p 170 TO-220',
  'IRF2807 N 75 82 0.013 10 3 3.82n 360p 610p 230 TO-220',
  'IRF3710 N 100 57 0.023 10 3 3.13n 72p 410p 200 TO-220',
  'IRFB4110 N 100 180 0.0045 10 3 9.62n 230p 670p 370 TO-220',
  'IRF1407 N 75 130 0.0078 10 3 5.6n 250p 890p 330 TO-220',
  'IRF1018E N 60 79 0.0084 10 3 2.29n 130p 360p 110 TO-220',
  'IRF3415 N 150 43 0.042 10 3 2.4n 270p 590p 200 TO-220',
  'BUZ11 N 50 30 0.04 10 3 1.5n 160p 750p 75 TO-220',
  'IRF4905 P 55 74 0.02 10 3 3.4n 900p 1.4n 200 TO-220',
  'IRF5305 P 55 31 0.06 10 3 1.2n 250p 520p 110 TO-220',
  'IRF9Z24N P 55 12 0.175 10 3 350p 92p 170p 45 TO-220',
  'IRF9Z34N P 55 19 0.1 10 3 620p 120p 270p 68 TO-220',
  'IRF5210 P 100 40 0.06 10 3 2.7n 380p 790p 200 TO-220',
  'IRLZ24N N 55 18 0.075 5 1.5 480p 60p 130p 45 TO-220',
  'IRLZ34N N 55 30 0.046 5 1.5 880p 120p 220p 68 TO-220',
  'IRLZ44N N 55 47 0.025 5 1.5 1.7n 120p 400p 110 TO-220',
  'IRL540N N 100 36 0.053 5 1.5 1.8n 85p 300p 140 TO-220',
  'IRL530N N 100 17 0.12 5 1.5 800p 50p 150p 79 TO-220',
  'IRL520N N 100 10 0.22 5 1.5 440p 26p 80p 48 TO-220',
  'IRL2203N N 30 116 0.01 4.5 1.5 3.29n 380p 1.27n 180 TO-220',
  'IRL3705N N 55 89 0.012 5 1.5 3.6n 280p 880p 170 TO-220',
  'IRLB8721 N 30 62 0.0115 4.5 1.8 1.08n 120p 360p 65 TO-220',
  'IRLML2502 N 20 4.2 0.045 4.5 0.8 740p 89p 92p 1.25 SOT-23',
  'IRLML6402 P 20 3.7 0.065 4.5 0.7 633p 110p 145p 1.3 SOT-23',
  'IRLML2402 N 20 1.2 0.25 4.5 0.9 110p 25p 50p 0.54 SOT-23',
  'IRLML0030 N 30 5.3 0.04 4.5 1.7 380p 30p 60p 1.3 SOT-23',
  'IRLML6344 N 30 5 0.037 4.5 0.8 650p 70p 80p 1.3 SOT-23',
  'IRF7413 N 30 13 0.011 10 1 1.7n 230p 690p 2.5 SO-8',
  'IRF7404 P 20 6.7 0.04 4.5 0.7 1.3n 280p 470p 2.5 SO-8',
  'IRF7832 N 30 20 0.004 10 1.9 4.05n 410p 880p 2.5 SO-8',
  'IRFP250N N 200 30 0.075 10 3 2.16n 74p 320p 214 TO-247',
  'IRFP260N N 200 50 0.04 10 3 4.06n 160p 610p 300 TO-247',
  'IRFP460 N 500 20 0.27 10 3 4.2n 340p 870p 280 TO-247',
  'IRFP450 N 500 14 0.4 10 3 2.6n 240p 720p 190 TO-247',
  'IRFP140N N 100 33 0.052 10 3 1.7n 140p 370p 140 TO-247',
  'IRFP150N N 100 42 0.036 10 3 1.9n 220p 450p 160 TO-247',
  'IRFP064N N 55 110 0.008 10 3 4n 330p 1.45n 200 TO-247',
  'IRFP2907 N 75 209 0.0045 10 3 13n 650p 2.4n 470 TO-247',
  'IRFP4468 N 100 290 0.002 10 3 19.98n 530p 1.3n 520 TO-247',
  'IRFP4668 N 200 130 0.008 10 3 10.72n 140p 810p 520 TO-247',
  'IRFP9240 P 200 12 0.5 10 3 1.2n 120p 400p 150 TO-247',
  'STP55NF06 N 60 50 0.018 10 3 1.3n 110p 300p 110 TO-220',
  'STP16NF06 N 60 16 0.08 10 3 315p 30p 70p 45 TO-220',
  'STP36NF06 N 60 30 0.032 10 3 690p 60p 180p 70 TO-220',
  'STP60NF06 N 60 60 0.014 10 3 1.8n 100p 400p 110 TO-220',
  'STP75NF75 N 75 80 0.0095 10 3 3.15n 210p 500p 300 TO-220',
  'STP80NF55 N 55 80 0.0065 10 3 4.5n 310p 1n 300 TO-220',
  'STP10NK60Z N 600 10 0.65 10 3.75 1.37n 37p 160p 115 TO-220',
  'STP4NK60Z N 600 4 1.76 10 3.75 510p 12p 60p 70 TO-220',
  'FQP30N06L N 60 32 0.035 10 1.5 1.04n 50p 270p 79 TO-220',
  'FQP27P06 P 60 27 0.07 10 3 1.1n 180p 440p 120 TO-220',
  'FQP50N06 N 60 50 0.022 10 3 1.25n 60p 400p 120 TO-220',
  'FQP13N10 N 100 12.8 0.142 10 3 370p 15p 75p 65 TO-220',
  'FQP17P10 P 100 16.5 0.15 10 3 900p 120p 280p 100 TO-220',
  'FQP12N60C N 600 12 0.53 10 3 1.76n 21p 180p 225 TO-220',
  'IRFR024N N 55 17 0.075 10 3 370p 65p 140p 45 DPAK',
  'IRFR120 N 100 7.7 0.27 10 3 360p 34p 150p 42 DPAK',
  'AO3400A N 30 5.7 0.0265 10 1 630p 45p 75p 1.4 SOT-23',
  'AO3401A P 30 4 0.05 10 0.9 645p 45p 80p 1.4 SOT-23',
  'AO3402 N 30 4 0.052 10 1 230p 20p 40p 1.4 SOT-23',
  'AO3407A P 30 4.3 0.048 10 1.6 520p 60p 85p 1.4 SOT-23',
  'AO4407A P 30 12 0.014 10 1.8 2.06n 260p 350p 3.1 SO-8',
  'SI2302 N 20 2.6 0.085 4.5 0.65 350p 40p 80p 1.25 SOT-23',
  'SI2301 P 20 2.8 0.112 4.5 0.7 400p 50p 90p 1.25 SOT-23',
  '2N7002 N 60 0.115 1.6 10 2.1 22p 2p 11p 0.2 SOT-23',
  '2N7002K N 60 0.38 1.6 10 1.6 32p 3p 8p 0.35 SOT-23',
  'BSS123 N 100 0.17 1.7 10 1.7 20p 2.5p 8p 0.36 SOT-23',
  'BS250 P 45 0.18 9 10 2.5 30p 10p 20p 0.83 TO-92',
  'VN2222LL N 60 0.15 4 10 1.5 60p 5p 25p 0.4 TO-92',
  'VN10KM N 60 0.3 5 10 1.6 48p 5p 16p 1 TO-92',
  'TP0610L P 60 0.18 8 10 2.4 30p 5p 15p 0.8 TO-92',
  'ZVN2106A N 60 0.45 2 10 1.5 75p 8p 25p 0.7 TO-92',
  'ZVP2106A P 60 0.28 5 10 2.5 100p 15p 30p 0.7 TO-92',
  'RD06HVF1 N 50 1 0.3 10 3 50p 2p 25p 27 TO-220 rf',
  'RD15HVF1 N 50 2.5 0.12 10 3 110p 4p 60p 48 TO-220 rf',
  'RD16HHF1 N 50 3 0.1 10 3 130p 5p 70p 56 TO-220 rf',
];

interface MosRow {
  pn: string;
  pch: boolean;
  vds: number;
  id: number;
  rdson: number;
  vgsOn: number;
  vth: number;
  ciss: number;
  crss: number;
  coss: number;
  pd: number;
  pkg: string;
  group: PartGroup;
}

function mosRow(t: string): MosRow {
  const f = t.trim().split(/\s+/);
  const pn = f[0];
  return {
    pn,
    pch: f[1] === 'P',
    vds: num(f[2], pn),
    id: num(f[3], pn),
    rdson: num(f[4], pn),
    vgsOn: num(f[5], pn),
    vth: num(f[6], pn),
    ciss: num(f[7], pn),
    crss: num(f[8], pn),
    coss: num(f[9], pn),
    pd: num(f[10], pn),
    pkg: f[11],
    group: f[12] === 'rf' ? 'rf' : 'transistors',
  };
}

const MOS_SYM = { n: mosfetSymbol(false, { bodyDiode: true }), p: mosfetSymbol(true, { bodyDiode: true }) };

function mosPart(r: MosRow): LibraryPartDef {
  const logic = r.vgsOn <= 5;
  const power = r.id >= 2;
  const { mos, diode } = mosfetFitModel({
    pn: r.pn.replace(/[^A-Za-z0-9]/g, '_'),
    pch: r.pch,
    description: '',
    vth: r.vth,
    rdson: r.rdson,
    vgsOn: r.vgsOn,
    ciss: r.ciss,
    crss: r.crss,
    lambda: power ? 0.005 : 0.01,
    bvdss: r.vds,
    diodeIs: Number((2e-13 * Math.max(0.1, r.id)).toPrecision(2)),
    coss: r.coss,
    footprint: r.pkg,
  });
  const ch = r.pch ? 'P' : 'N';
  const kindEn = r.group === 'rf' ? 'RF power' : logic ? 'logic-level' : power ? 'power' : 'small-signal';
  const kindVi = r.group === 'rf' ? 'công suất cao tần' : logic ? 'mức logic' : power ? 'công suất' : 'tín hiệu nhỏ';
  const tail = `${r.vds} V / ${eng(r.id, 'A')}, RDS(on) ${eng(r.rdson, 'Ω')} @ VGS = ${r.vgsOn} V, VGS(th) ≈ ${r.vth} V`;
  return withMeta(
    {
      id: `${r.group}/${slug(r.pn)}`,
      name: r.pn,
      group: r.group,
      family: r.group === 'rf' ? 'RF transistor' : r.pch ? 'P-channel MOSFET' : 'N-channel MOSFET',
      description: `${ch}-channel ${kindEn} MOSFET, ${tail}`,
      prefix: 'Q',
      symbol: r.pch ? MOS_SYM.p : MOS_SYM.n,
      params: [modelOverrideParam()],
      toSpice: (ctx) => {
        const m = modelOverride(ctx, mos.name);
        const d = ctx.node('D');
        const s = ctx.node('S');
        return {
          elements: [elM(ctx.name('M'), d, ctx.node('G'), s, s, m, { w: W, l: L }), r.pch ? elD(ctx.name('D', 'body'), d, s, diode.name) : elD(ctx.name('D', 'body'), s, d, diode.name)],
          models: m === mos.name ? [mos, diode] : [diode],
        };
      },
      provenance: `MachSim level-1 fit to the ${r.pn} datasheet: |VGS(th)| ≈ ${r.vth} V, RDS(on) ≈ ${eng(r.rdson, 'Ω')} @ |VGS| = ${r.vgsOn} V, Ciss ${eng(r.ciss, 'F')}, Crss ${eng(r.crss, 'F')}, V(BR)DSS ${r.vds} V (approximation)`,
      footprint: r.pkg,
      keywords: [r.pn.toLowerCase(), 'mosfet', 'fet', r.pch ? 'p-channel' : 'n-channel', kindEn],
    },
    {
      vi: `MOSFET kênh ${ch} ${kindVi}, ${tail}`,
      specs: { polarity: `${ch}-channel`, vds: r.vds, id: r.id, rdson: r.rdson, vth: r.vth, ciss: r.ciss, power: r.pd, package: r.pkg },
      sortKey: r.vds + r.id / 1000,
      series: 'MOSFET',
    },
  );
}

/** Depletion-mode N-MOSFETs: "pn VDS IDSS VGS(off) Ciss Crss package". */
const DEPL_TEXT = ['BSS139 250 30m -1.4 60p 5p SOT-23', 'BSS159 50 70m -2.8 70p 6p SOT-23', 'DN2530 300 200m -2.5 200p 10p TO-92', 'LND150 500 1m -2 10p 1p TO-92'];
const MOS_DEPL_SYM = mosfetSymbol(false, { depletion: true });

const depletion: LibraryPartDef[] = DEPL_TEXT.map((t) => {
  const [pn, vdsS, idssS, vtoS, cissS, crssS, pkg] = t.split(/\s+/);
  const vds = num(vdsS, pn);
  const idss = num(idssS, pn);
  const vto = num(vtoS, pn);
  const ciss = num(cissS, pn);
  const crss = num(crssS, pn);
  const model = card(modelName(pn), 'NMOS', { level: 1, vto, kp: Number(((2 * idss) / (vto * vto)).toPrecision(3)), lambda: 0.01, cgso: (ciss - crss) / W, cgdo: crss / W });
  return withMeta(
    {
      id: `transistors/${slug(pn)}`,
      name: pn,
      group: 'transistors',
      family: 'N-channel MOSFET',
      description: `Depletion-mode N-channel MOSFET (normally on), ${vds} V, IDSS ≈ ${eng(idss, 'A')}, VGS(off) ≈ ${vto} V`,
      prefix: 'Q',
      symbol: MOS_DEPL_SYM,
      params: [modelOverrideParam()],
      toSpice: (ctx) => {
        const m = modelOverride(ctx, model.name);
        const s = ctx.node('S');
        return { elements: [elM(ctx.name('M'), ctx.node('D'), ctx.node('G'), s, s, m, { w: W, l: L })], models: m === model.name ? [model] : [] };
      },
      provenance: `MachSim level-1 depletion fit to the ${pn} datasheet: IDSS ≈ ${eng(idss, 'A')} at VGS = 0, VGS(off) ≈ ${vto} V, Ciss ${eng(ciss, 'F')}`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'mosfet', 'depletion', 'normally on', 'current source'],
    },
    { vi: `MOSFET kênh N chế độ nghèo (dẫn khi VGS = 0), ${vds} V, IDSS ≈ ${eng(idss, 'A')}, VGS(off) ≈ ${vto} V`, specs: { polarity: 'N-channel', vds, idss, vth: vto, package: pkg }, sortKey: vds, series: 'MOSFET depletion' },
  );
});

// ---------------------------------------------------------------------------------------------
// JFETs: "pn ch IDSS VGS(off) Ciss Crss package"

const JFET_TEXT = [
  '2N3819 N 10m -3 6p 1.6p TO-92',
  '2N4391 N 100m -7 14p 3.5p TO-92',
  '2N4392 N 50m -3.5 14p 3.5p TO-92',
  '2N4393 N 15m -1.7 14p 3.5p TO-92',
  '2N4416 N 10m -4 4.8p 0.8p TO-92',
  '2N5484 N 3m -1.6 5p 1p TO-92',
  '2N5485 N 7m -2.2 5p 1p TO-92',
  '2N5486 N 14m -4 5p 1p TO-92',
  '2N5458 N 5m -2.5 6p 1.5p TO-92',
  '2N5459 N 10m -4 6p 1.5p TO-92',
  'J111 N 50m -6 19p 5p TO-92',
  'J112 N 15m -3 19p 5p TO-92',
  'J113 N 5m -1.5 19p 5p TO-92',
  'J201 N 0.5m -0.8 5p 1p TO-92',
  'J202 N 2m -2 5p 1p TO-92',
  'J309 N 20m -2.5 6p 2p TO-92',
  'MPF102 N 10m -4 6.5p 2p TO-92',
  'BF245A N 4m -1.5 5p 1.1p TO-92',
  'BF245B N 10m -2.5 5p 1.1p TO-92',
  'BF245C N 18m -4.5 5p 1.1p TO-92',
  'BF256A N 5m -1.5 5p 1p TO-92',
  'BF256B N 9m -2.5 5p 1p TO-92',
  'BF256C N 14m -3.5 5p 1p TO-92',
  '2SK30A-O N 1m -0.8 8.2p 2.6p TO-92',
  '2SK30A-Y N 2m -1.2 8.2p 2.6p TO-92',
  '2SK30A-GR N 4.5m -1.8 8.2p 2.6p TO-92',
  '2SK170-GR N 4.5m -0.5 30p 6p TO-92',
  '2SK170-BL N 9m -0.6 30p 6p TO-92',
  '2SK117-GR N 4.5m -0.7 13p 3p TO-92',
  '2SK117-BL N 9m -1 13p 3p TO-92',
  'MMBFJ309 N 20m -2.5 6p 2p SOT-23',
  '2N5461 P 5m -3 7p 2p TO-92',
  '2N5462 P 10m -4.5 7p 2p TO-92',
  'J174 P 50m -6 32p 8p TO-92',
  'J175 P 30m -4 32p 8p TO-92',
  'J176 P 10m -2.5 32p 8p TO-92',
  'J177 P 5m -1.5 32p 8p TO-92',
  '2N2608 P 2m -2.5 17p 5p TO-18',
  '2SJ74-BL P 9m -0.6 185p 35p TO-92',
];

const JFET_SYM = { n: jfetSymbol(false), p: jfetSymbol(true) };

/** One JFET table row ("pn ch IDSS VGS(off) Ciss Crss package"). */
export function jfetFromText(t: string): LibraryPartDef {
  const [pn, ch, idssS, vpS, cissS, crssS, pkg] = t.split(/\s+/);
  const pch = ch === 'P';
  const idss = num(idssS, pn);
  const vp = num(vpS, pn);
  const ciss = num(cissS, pn);
  const crss = num(crssS, pn);
  const model = card(modelName(pn), pch ? 'PJF' : 'NJF', { vto: vp, beta: Number((idss / (vp * vp)).toPrecision(3)), lambda: 0.005, rd: 1, rs: 1, is: 1e-14, cgs: ciss - crss, cgd: crss, pb: 1, fc: 0.5 });
  const tail = `IDSS ≈ ${eng(idss, 'A')}, VGS(off) ≈ ${Math.abs(vp)} V, Ciss ${eng(ciss, 'F')}`;
  return withMeta(
    {
      id: `transistors/${slug(pn)}`,
      name: pn,
      group: 'transistors',
      family: pch ? 'P-channel JFET' : 'N-channel JFET',
      description: `${pch ? 'P' : 'N'}-channel JFET, ${tail}`,
      prefix: 'Q',
      symbol: pch ? JFET_SYM.p : JFET_SYM.n,
      params: [modelOverrideParam()],
      toSpice: (ctx) => {
        const m = modelOverride(ctx, model.name);
        return { elements: [elJ(ctx.name('J'), ctx.node('D'), ctx.node('G'), ctx.node('S'), m)], models: m === model.name ? [model] : [] };
      },
      provenance: `MachSim Shichman-Hodges fit to typical ${pn} datasheet values: ${tail}, Crss ${eng(crss, 'F')} (BETA = IDSS / VP²)`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'jfet', 'fet', pch ? 'p-channel' : 'n-channel'],
    },
    { vi: `JFET kênh ${pch ? 'P' : 'N'}, ${tail}`, specs: { polarity: `${pch ? 'P' : 'N'}-channel`, idss, vp, ciss, package: pkg }, sortKey: idss, series: 'JFET' },
  );
}

const jfets: LibraryPartDef[] = JFET_TEXT.map(jfetFromText);

// ---------------------------------------------------------------------------------------------
// IGBTs: "pn VCES IC VCE(sat) VGE(th) Cies package"

const IGBT_TEXT = [
  'IRG4BC30KD 600 28 2.2 4.5 1.1n TO-220',
  'IRG4PC50UD 600 55 1.65 4.5 4n TO-247',
  'IRG4PH50U 1200 45 2.8 4.5 3.6n TO-247',
  'IRGP4063D 600 48 1.6 5 3n TO-247',
  'FGA25N120ANTD 1200 25 2 5.5 2.4n TO-3P',
  'FGH40N60SMD 600 40 1.9 4.5 1.9n TO-247',
  'FGH60N60SMD 600 60 1.9 4.5 2.9n TO-247',
  'HGTG20N60A4D 600 40 1.8 5.5 2.2n TO-247',
  'STGW30NC60VD 600 30 1.75 5 2.4n TO-247',
  'IKW40N120H3 1200 40 2.05 5.8 2.3n TO-247',
  'IKW75N60T 600 75 1.5 5 4.6n TO-247',
];

const IGBT_SYMBOL: SymbolDef = makeSymbol(
  [
    circle(4, 0, 18),
    line(-30, 0, -8, 0),
    line(-8, -10, -8, 10),
    line(-4, -12, -4, 12, 2),
    line(-4, -6, 10, -16),
    line(10, -16, 10, -30),
    line(-4, 6, 10, 16),
    line(10, 16, 10, 30),
    poly([10, 16, 3, 15, 6, 10], true, true),
  ],
  [pin('G', -30, 0, 'left', { number: '1', type: 'input' }), pin('C', 10, -30, 'up', { number: '2' }), pin('E', 10, 30, 'down', { number: '3' })],
  { refPos: { x: 26, y: -6 }, valuePos: { x: 26, y: 8 } },
);

/** One IGBT table row ("pn VCES IC VCE(sat) VGE(th) Cies package"). */
export function igbtFromText(t: string): LibraryPartDef {
  const [pn, vcesS, icS, vsatS, vthS, ciesS, pkg] = t.split(/\s+/);
  const vces = num(vcesS, pn);
  const ic = num(icS, pn);
  const vsat = num(vsatS, pn);
  const vth = num(vthS, pn);
  const cies = num(ciesS, pn);
  const bp = 0.5;
  const imos = ic / (1 + bp);
  const veb = 0.75;
  const vds = Math.max(0.1, vsat - veb);
  const kp = imos / ((15 - vth) * vds - (vds * vds) / 2);
  const tag = pn.replace(/[^A-Za-z0-9]/g, '_');
  const mos = card(`MS_${tag}_M`, 'NMOS', { level: 1, vto: vth, kp: Number(kp.toPrecision(3)), lambda: 0.002, cgso: (cies * 0.9) / W, cgdo: (cies * 0.1) / W });
  const pnp = card(`MS_${tag}_Q`, 'PNP', { is: Number((ic / (1 + bp) / Math.exp(veb / VT)).toPrecision(3)), bf: bp, br: 0.1, rc: 0.002, cje: cies / 4, cjc: cies / 10, tf: 100e-9, tr: 1e-6, vaf: 1000 });
  const els: ElementIR[] = [elQ('QP', 'e', 'n', 'c', pnp.name), elM('MN', 'n', 'g', 'e', 'e', mos.name, { w: W, l: L }), elR('RG', 'gp', 'g', 2)];
  const models: ModelCard[] = [mos, pnp];
  const copack = /D$/.test(pn) || pn.startsWith('IKW');
  if (copack) {
    const d = card(`MS_${tag}_D`, 'D', { is: 1e-9 * ic, n: 1.5, rs: 0.5 / ic, bv: vces, ibv: 1e-6, tt: 100e-9, cjo: cies / 5 });
    els.push(elD('DF', 'e', 'c', d.name));
    models.push(d);
  }
  const sub = subckt(`MS_${tag}`, ['c', 'gp', 'e'], els, models);
  const tail = `${vces} V / ${ic} A, VCE(sat) ≈ ${vsat} V @ VGE = 15 V, VGE(th) ≈ ${vth} V`;
  return withMeta(
    {
      id: `transistors/${slug(pn)}`,
      name: pn,
      group: 'transistors',
      family: 'IGBT',
      description: `N-channel IGBT${copack ? ' with anti-parallel diode' : ''}, ${tail}`,
      prefix: 'Q',
      symbol: IGBT_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('C'), ctx.node('G'), ctx.node('E')], sub.name)], subckts: [sub] }),
      provenance: `MachSim IGBT macromodel (NMOS + wide-base PNP, βp = ${bp}) fitted to the ${pn} datasheet: ${tail}, Cies ${eng(cies, 'F')}`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'igbt', 'insulated gate', 'power switch', 'inverter'],
    },
    { vi: `IGBT kênh N${copack ? ' có diode song song ngược' : ''}, ${tail}`, specs: { vceo: vces, ic, vth, package: pkg }, sortKey: vces + ic / 1000, series: 'IGBT' },
  );
}

const igbts: LibraryPartDef[] = IGBT_TEXT.map(igbtFromText);

// ---------------------------------------------------------------------------------------------
// UJT and PUT

const UJT_SYMBOL: SymbolDef = makeSymbol(
  [circle(0, 0, 18), line(-30, 10, -14, 10), poly([-14, 10, -20, 7, -20, 13], true, true), line(-14, 10, 4, 2), line(4, -14, 4, 14, 2), line(4, -10, 10, -20), line(10, -20, 10, -30), line(4, 10, 10, 20), line(10, 20, 10, 30)],
  [pin('E', -30, 10, 'left', { number: '1', type: 'input' }), pin('B2', 10, -30, 'up', { number: '3' }), pin('B1', 10, 30, 'down', { number: '2' })],
  { refPos: { x: 26, y: -6 }, valuePos: { x: 26, y: 8 } },
);

const PUT_SYMBOL: SymbolDef = makeSymbol(
  [line(-30, 0, -8, 0), poly([-8, -8, -8, 8, 8, 0], true), line(8, -8, 8, 8), line(8, 0, 30, 0), line(-4, -6, -10, -14), line(-10, -14, -10, -20)],
  [pin('A', -30, 0, 'left', { number: '1' }), pin('K', 30, 0, 'right', { number: '3' }), pin('G', -10, -20, 'up', { number: '2', type: 'input' })],
  { refPos: { x: 10, y: -16 }, valuePos: { x: 0, y: 22 } },
);

/**
 * Two-transistor PUT core (ports a g k). `rpk` (n-gate side shunt) and the NPN gain `bn` set the
 * peak and valley currents; both transistors start OFF for the operating point.
 */
function putCore(name: string, rpk: number, bn = 50): { sub: ReturnType<typeof subckt> } {
  const qp = card(`${name}_P`, 'PNP', { is: 1e-14, bf: 1, br: 0.5, cje: 5e-12, cjc: 5e-12, tf: 20e-9, tr: 200e-9 });
  const qn = card(`${name}_N`, 'NPN', { is: 1e-14, bf: bn, br: 0.5, cje: 5e-12, cjc: 3e-12, tf: 10e-9, tr: 200e-9 });
  return { sub: subckt(name, ['a', 'g', 'k'], [elQ('QP', 'pb', 'g', 'a', qp.name, { off: 1 }), elQ('QN', 'g', 'pb', 'k', qn.name, { off: 1 }), elR('RPK', 'pb', 'k', rpk)], [qp, qn]) };
}

type UjtRow = [pn: string, eta: number, rbb: number];
const UJTS: UjtRow[] = [
  ['2N2646', 0.65, 7000],
  ['2N2647', 0.75, 7000],
  ['2N4870', 0.65, 6500],
  ['2N4871', 0.78, 6500],
];

const ujts: LibraryPartDef[] = UJTS.map(([pn, eta, rbb]) => {
  // NPN gain 2: the latch needs several mA of emitter current to hold (valley current ≈ 4 mA)
  const core = putCore(modelName(pn, 'PUT'), 100e3, 2).sub;
  const sub = subckt(modelName(pn), ['e', 'b2', 'b1'], [elR('RB2', 'b2', 'g', rbb * (1 - eta)), elR('RB1', 'g', 'b1', rbb * eta), elX('X1', ['e', 'g', 'b1'], core.name)], []);
  sub.subckts[core.name.toLowerCase()] = core;
  return withMeta(
    {
      id: `transistors/${slug(pn)}`,
      name: pn,
      group: 'transistors',
      family: 'UJT / PUT',
      description: `Unijunction transistor, intrinsic stand-off ratio η ≈ ${eta}, RBB ≈ ${eng(rbb, 'Ω')}; fires when V(E) > η·VBB + 0.6 V`,
      prefix: 'Q',
      symbol: UJT_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('E'), ctx.node('B2'), ctx.node('B1')], sub.name)], subckts: [sub] }),
      provenance: `MachSim UJT equivalent (PUT latch on the RB1 / RB2 divider) with the typical ${pn} datasheet values η = ${eta}, RBB = ${eng(rbb, 'Ω')}`,
      footprint: 'TO-18',
      keywords: [pn.toLowerCase(), 'ujt', 'unijunction', 'relaxation oscillator'],
    },
    { vi: `Transistor một tiếp giáp (UJT), tỉ số η ≈ ${eta}, RBB ≈ ${eng(rbb, 'Ω')}; kích khi V(E) > η·VBB + 0.6 V`, specs: { vp: eta, resistance: rbb, package: 'TO-18' }, sortKey: eta, series: 'UJT' },
  );
});

const puts: LibraryPartDef[] = (
  [
    ['2N6027', 10e3, 'IP ≈ 2 µA, IV ≈ 70 µA (RG = 10 kΩ)'],
    ['2N6028', 100e3, 'IP ≈ 0.2 µA, IV ≈ 25 µA (RG = 10 kΩ)'],
  ] as const
).map(([pn, rpk, figures]) => {
  const core = putCore(modelName(pn), rpk).sub;
  return withMeta(
    {
      id: `transistors/${slug(pn)}`,
      name: pn,
      group: 'transistors',
      family: 'UJT / PUT',
      description: `Programmable unijunction transistor: fires when V(A) exceeds V(G) by ≈ 0.6 V; ${figures}`,
      prefix: 'Q',
      symbol: PUT_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: [elX(ctx.name('X'), [ctx.node('A'), ctx.node('G'), ctx.node('K')], core.name)], subckts: [core] }),
      provenance: `MachSim two-transistor PUT latch fitted to the ${pn} datasheet: ${figures}`,
      footprint: 'TO-92',
      keywords: [pn.toLowerCase(), 'put', 'programmable unijunction', 'oscillator', 'trigger'],
    },
    { vi: `Transistor một tiếp giáp lập trình được (PUT): kích khi V(A) cao hơn V(G) khoảng 0.6 V; ${figures}`, specs: { package: 'TO-92' }, sortKey: rpk, series: 'PUT' },
  );
});

// ---------------------------------------------------------------------------------------------
// GaAs MESFETs: "pn IDSS VP Cgs Cgd package"

const MESFET_TEXT = ['MGF1302 60m -1.5 0.6p 0.06p MICRO-X', 'MGF1801 20m -1 0.4p 0.05p MICRO-X', 'NE76038 50m -1.2 0.5p 0.05p MICRO-X', 'CF739 40m -1 0.5p 0.06p SOT-143', 'CFY30 50m -2 0.6p 0.07p SOT-143'];

const MESFET_SYMBOL = makeSymbol(
  [line(-30, 0, -6, 0), line(-6, -12, -6, 12, 2), line(-6, -8, 10, -8), line(10, -8, 10, -30), line(-6, 8, 10, 8), line(10, 8, 10, 30), text(16, 4, 'GaAs', 7, 'start')],
  [pin('G', -30, 0, 'left', { number: '1', type: 'input' }), pin('D', 10, -30, 'up', { number: '3' }), pin('S', 10, 30, 'down', { number: '2' })],
  { refPos: { x: 22, y: -12 }, valuePos: { x: 22, y: 18 } },
);

const mesfets: LibraryPartDef[] = MESFET_TEXT.map((t) => {
  const [pn, idssS, vpS, cgsS, cgdS, pkg] = t.split(/\s+/);
  const idss = num(idssS, pn);
  const vp = num(vpS, pn);
  const b = 0.3;
  const beta = (idss * (1 + b * -vp)) / (vp * vp);
  const model = card(modelName(pn), 'NMF', { vto: vp, beta: Number(beta.toPrecision(3)), b, alpha: 3, lambda: 0.05, rd: 1, rs: 1, cgs: num(cgsS, pn), cgd: num(cgdS, pn), pb: 0.8, is: 1e-14 });
  return withMeta(
    {
      id: `transistors/${slug(pn)}`,
      name: pn,
      group: 'transistors',
      family: 'GaAsFET',
      description: `GaAs MESFET for low-noise microwave amplifiers, IDSS ≈ ${eng(idss, 'A')}, VP ≈ ${vp} V`,
      prefix: 'Q',
      symbol: MESFET_SYMBOL,
      params: [modelOverrideParam()],
      toSpice: (ctx) => {
        const m = modelOverride(ctx, model.name);
        const el: ElementIR = { type: 'Z', name: ctx.name('Z'), nodes: [ctx.node('D'), ctx.node('G'), ctx.node('S')], model: m, params: {} };
        return { elements: [el], models: m === model.name ? [model] : [] };
      },
      provenance: `MachSim Statz-model fit: IDSS ${eng(idss, 'A')} at VGS = 0 and pinch-off ${vp} V from the ${pn} datasheet, B = ${b}, ALPHA = 3, CGS / CGD from the small-signal capacitances (approximation)`,
      footprint: pkg,
      keywords: [pn.toLowerCase(), 'gaas', 'mesfet', 'microwave', 'low noise'],
    },
    { vi: `MESFET GaAs cho khuếch đại vi ba nhiễu thấp, IDSS ≈ ${eng(idss, 'A')}, VP ≈ ${vp} V`, specs: { idss, vp, package: pkg }, sortKey: idss, series: 'GaAsFET' },
  );
});

export const FET_CATALOG: LibraryPartDef[] = [...MOS_TEXT.map(mosRow).map(mosPart), ...depletion, ...jfets, ...igbts, ...ujts, ...puts, ...mesfets];

/** Round 4 (library breadth): the MOSFET row parser and part builder, for the extra part-number tables. */
export { mosRow, mosPart };
