/**
 * Compact-model MOSFETs: generic N- and P-channel transistors evaluated by the EKV 2.6 model
 * (SPICE LEVEL 44, src/sim/devices/semi/ekv.ts) and by the BSIM4-class model (LEVEL 54,
 * src/sim/devices/semi/bsim3.ts with the BSIM4 parameter set). Four terminals (D G S B).
 *
 * The default parameter sets describe a generic 0.18 µm-class CMOS process built from round textbook
 * numbers (threshold about 0.45 V, oxide about 4 nm, supply 1.8 V); they are NOT a foundry model.
 * A learner changes the parameters in the Properties panel, or pastes a real .model card (LEVEL 14 /
 * 44 / 54 / 49) from a manufacturer into the netlist and selects it with the model override.
 */
import { card, defaultNums, elM, numParam, paramModelName, selectParam, type LibraryPartDef } from '../partkit';
import { mosfetSymbol } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';
import { withMeta } from './kit';

interface Spec {
  id: string;
  level: 44 | 54;
  pch: boolean;
}

const EKV_KEYS = ['vto', 'kp', 'gamma', 'phi', 'lambda', 'ucrit', 'theta', 'cox'];
const BSIM4_KEYS = ['vth0', 'toxe', 'ndep', 'u0', 'vsat', 'rdsw', 'eta0', 'dvt0', 'lpe0'];

function ekvParams(pch: boolean): ParamDef[] {
  return [
    numParam('vto', 'Threshold voltage VTO', '0.45', 'V', { group: 'model', showOnSchematic: true, help: 'Long-channel threshold voltage (positive for both N and P; the model takes the polarity from the transistor type)' }),
    numParam('kp', 'Transconductance KP', pch ? '60u' : '170u', 'A/V²', { group: 'model', min: 0, help: 'µ·Cox: the current factor of a square device. Id(sat) ≈ KP·(W/L)·(Vgs − VTO)² / (2n)' }),
    numParam('gamma', 'Body-effect GAMMA', '0.6', '√V', { group: 'model', min: 0, help: 'Body-effect coefficient; sets the slope factor n = 1 + GAMMA / (2·√(Vp + PHI))' }),
    numParam('phi', 'Surface potential PHI', '0.8', 'V', { group: 'model', min: 0.2, help: 'Twice the Fermi potential, about 0.7 … 0.9 V' }),
    numParam('lambda', 'Length modulation LAMBDA', '0.4', '', { group: 'model', min: 0, help: 'Strength of the channel-length modulation (output conductance in saturation)' }),
    numParam('ucrit', 'Critical field UCRIT', '4Meg', 'V/m', { group: 'model', min: 0, help: 'Field at which the carrier velocity saturates: Vc = UCRIT·L. A very large value switches velocity saturation off' }),
    numParam('theta', 'Mobility reduction THETA', '0.5', '1/V', { group: 'advanced', min: 0, help: 'Vertical-field mobility reduction: KP is divided by 1 + THETA·Vp' }),
    numParam('cox', 'Gate capacitance COX', '8m', 'F/m²', { group: 'advanced', min: 0, help: 'Gate-oxide capacitance per area (8 mF/m² is about 4.3 nm of oxide)' }),
    numParam('w', 'Channel width W', '1u', 'm', { group: 'advanced', min: 0 }),
    numParam('l', 'Channel length L', '0.18u', 'm', { group: 'advanced', min: 0 }),
  ];
}

function bsim4Params(pch: boolean): ParamDef[] {
  return [
    numParam('vth0', 'Threshold voltage VTH0', pch ? '-0.42' : '0.42', 'V', { group: 'model', showOnSchematic: true, help: 'Long-channel threshold at zero body bias (negative for a P-channel device)' }),
    numParam('toxe', 'Oxide thickness TOXE', '4.1n', 'm', { group: 'model', min: 0, help: 'Electrical gate-oxide thickness' }),
    numParam('ndep', 'Channel doping NDEP', '3e17', 'cm⁻³', { group: 'model', min: 0, help: 'Doping concentration of the channel; sets the body effect and the surface potential' }),
    numParam('u0', 'Low-field mobility U0', pch ? '0.018' : '0.045', 'm²/V·s', { group: 'model', min: 0, help: 'Mobility at low field (0.045 m²/V·s = 450 cm²/V·s)' }),
    numParam('vsat', 'Saturation velocity VSAT', '9e4', 'm/s', { group: 'model', min: 0, help: 'Carrier velocity limit that bends the output characteristic of a short channel' }),
    numParam('rdsw', 'Source/drain resistance RDSW', '150', 'Ω·µm', { group: 'advanced', min: 0, help: 'Parasitic series resistance per micrometre of width' }),
    numParam('eta0', 'DIBL coefficient ETA0', '0.08', '', { group: 'advanced', help: 'Drain-induced barrier lowering: how much the drain voltage pulls the threshold down' }),
    numParam('dvt0', 'Short-channel effect DVT0', '2.2', '', { group: 'advanced', help: 'Strength of the threshold roll-off at short channel length' }),
    numParam('lpe0', 'Lateral doping LPE0', '174n', 'm', { group: 'advanced', min: 0, help: 'Non-uniform lateral doping: raises the threshold of short devices (reverse short-channel effect)' }),
    selectParam('mobmod', 'Mobility model', '0', [['0', 'mobMod 0'], ['1', 'mobMod 1'], ['2', 'mobMod 2']], { group: 'advanced', help: 'BSIM4 mobility-degradation formula 0, 1 or 2' }),
    numParam('w', 'Channel width W', '1u', 'm', { group: 'advanced', min: 0 }),
    numParam('l', 'Channel length L', '0.18u', 'm', { group: 'advanced', min: 0 }),
  ];
}

function mosPart(s: Spec): LibraryPartDef {
  const keys = s.level === 44 ? EKV_KEYS : BSIM4_KEYS;
  const params = s.level === 44 ? ekvParams(s.pch) : bsim4Params(s.pch);
  const defaults = defaultNums(params, keys);
  const name = s.level === 44 ? `${s.pch ? 'P' : 'N'}MOS EKV (4-terminal)` : `${s.pch ? 'P' : 'N'}MOS BSIM4 (4-terminal)`;
  const family = s.pch ? 'P-channel MOSFET' : 'N-channel MOSFET';
  const model = s.level === 44 ? 'EKV 2.6' : 'BSIM4-class';
  const text = (ctx: ToSpiceContext) => {
    const vals: Record<string, number> = {};
    for (const k of keys) vals[k] = ctx.num(k);
    if (s.level === 54) vals.mobmod = Number(ctx.params.mobmod ?? '0');
    return vals;
  };
  return withMeta(
    {
      id: s.id,
      name,
      group: 'transistors',
      family,
      description: `Generic ${s.pch ? 'P' : 'N'}-channel MOSFET with the ${model} compact model (LEVEL ${s.level}): ${s.level === 44 ? 'one smooth equation from weak through moderate to strong inversion, source/drain symmetric, inversion coefficient shown as IC(M1)' : 'short-channel threshold roll-off, DIBL, velocity saturation, mobility degradation and the charge-based capacitances'}`,
      prefix: 'Q',
      symbol: mosfetSymbol(s.pch, { fourTerminal: true }) as SymbolDef,
      params,
      toSpice: (ctx) => {
        const w = ctx.num('w');
        const l = ctx.num('l');
        if (!(w > 0 && l > 0)) throw new Error('bad value for w/l: must be > 0');
        const vals = text(ctx);
        const mm = elM(ctx.name('M'), ctx.node('D'), ctx.node('G'), ctx.node('S'), ctx.node('B'), '', { w, l });
        const base = `MS_${s.level === 44 ? 'EKV' : 'B4'}_${s.pch ? 'P' : 'N'}`;
        const modelName = paramModelName(base, vals, s.level === 54 ? { ...defaults, mobmod: 0 } : defaults);
        mm.model = modelName;
        return { elements: [mm], models: [card(modelName, s.pch ? 'PMOS' : 'NMOS', { level: s.level, ...vals })] };
      },
      provenance: s.level === 44 ? 'EKV 2.6 charge-based model written from its published equations; generic 0.18 µm-class round-number parameters, not a foundry model' : 'BSIM4-class core (BSIM3 equations with the BSIM4 parameter set, mobility models, LPE0/LPEB and DLC/DWC capacitance geometry); generic 0.18 µm-class round-number parameters, not a foundry model',
      footprint: 'SOT-143',
      keywords: ['mosfet', 'cmos', s.pch ? 'pmos' : 'nmos', s.level === 44 ? 'ekv' : 'bsim4', 'compact model', 'short channel', 'weak inversion', 'level 44', 'level 54'],
    },
    {
      vi: `MOSFET kênh ${s.pch ? 'P' : 'N'} dùng mô hình compact ${model} (LEVEL ${s.level}): ${s.level === 44 ? 'một công thức liền mạch từ nghịch đảo yếu qua trung bình đến mạnh, đối xứng nguồn–máng, hệ số nghịch đảo hiện ở IC(M1)' : 'giảm ngưỡng khi kênh ngắn, DIBL, bão hoà vận tốc, suy giảm độ linh động và tụ điện theo điện tích'}`,
      nameVi: `MOS ${s.pch ? 'P' : 'N'} ${s.level === 44 ? 'EKV' : 'BSIM4'} (4 chân)`,
    },
  );
}

export const COMPACT_MOS_CATALOG: LibraryPartDef[] = [
  mosPart({ id: 'transistors/ekv-nmos', level: 44, pch: false }),
  mosPart({ id: 'transistors/ekv-pmos', level: 44, pch: true }),
  mosPart({ id: 'transistors/bsim4-nmos', level: 54, pch: false }),
  mosPart({ id: 'transistors/bsim4-pmos', level: 54, pch: true }),
];
