/**
 * IV analyzer (pure): device presets, the nested DC sweep the integration layer runs, and
 * extraction of I-V curve families from the DC-sweep result.
 *
 * Binding contract: `binding.drives[0]` is the voltage source applied across the device's main
 * terminals (anode-cathode, collector-emitter, drain-source); `binding.drives[1]` (BJT / MOSFET
 * only) is the stepped control source (base current source, gate voltage source). Channel `i`
 * is the device current, channel `v` (optional) the device voltage; without `v` the swept source
 * value is used as the voltage axis.
 */

import type { InstrumentBinding, SignalRef } from '../../model/types';
import type { DcAnalysis } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { formatEng, parseUserNumber } from '../../util/units';
import { resultSignal } from './signals';
import { t } from '../../i18n';

export type IvDevice = 'diode' | 'bjt-npn' | 'bjt-pnp' | 'nmos' | 'pmos';

export interface IvPreset {
  label: string;
  /** main sweep: label, unit, start, stop, step */
  sweep: { label: string; start: number; stop: number; step: number };
  /** stepped control (absent for diodes) */
  control?: { label: string; unit: 'A' | 'V'; start: number; stop: number; steps: number };
}

/** Typical initial ranges per device class (users edit them in the panel). */
export const IV_PRESETS: Record<IvDevice, IvPreset> = {
  diode: { get label() { return t('instruments.iv.diode'); }, sweep: { label: 'V(pn)', start: 0, stop: 1, step: 0.01 } },
  'bjt-npn': {
    label: 'BJT NPN',
    sweep: { label: 'Vce', start: 0, stop: 10, step: 0.05 },
    control: { label: 'Ib', unit: 'A', start: 10e-6, stop: 50e-6, steps: 5 },
  },
  'bjt-pnp': {
    label: 'BJT PNP',
    sweep: { label: 'Vce', start: 0, stop: -10, step: -0.05 },
    control: { label: 'Ib', unit: 'A', start: -10e-6, stop: -50e-6, steps: 5 },
  },
  nmos: {
    label: 'MOSFET N',
    sweep: { label: 'Vds', start: 0, stop: 10, step: 0.05 },
    control: { label: 'Vgs', unit: 'V', start: 2, stop: 6, steps: 5 },
  },
  pmos: {
    label: 'MOSFET P',
    sweep: { label: 'Vds', start: 0, stop: -10, step: -0.05 },
    control: { label: 'Vgs', unit: 'V', start: -2, stop: -6, steps: 5 },
  },
};

/**
 * Params (text): device (diode|bjt-npn|bjt-pnp|nmos|pmos), vstart, vstop, vstep (main sweep),
 * cstart, cstop, csteps (control steps), iscale (lin|log), vmin/vmax/imin/imax (display range,
 * empty = auto), cursor (V).
 */
export function ivDevice(params: Record<string, string>): IvDevice {
  const d = (params.device ?? '').trim().toLowerCase();
  return (Object.keys(IV_PRESETS) as IvDevice[]).find((k) => k === d) ?? 'diode';
}

function val(params: Record<string, string>, key: string, fallback: number): number {
  const t = params[key];
  if (t === undefined || !t.trim()) return fallback;
  const v = parseUserNumber(t);
  return Number.isFinite(v) ? v : fallback;
}

export interface IvSweep {
  device: IvDevice;
  vstart: number;
  vstop: number;
  vstep: number;
  cstart: number;
  cstop: number;
  csteps: number;
}

export function ivSweep(params: Record<string, string>): IvSweep {
  const device = ivDevice(params);
  const p = IV_PRESETS[device];
  const vstart = val(params, 'vstart', p.sweep.start);
  const vstop = val(params, 'vstop', p.sweep.stop);
  let vstep = Math.abs(val(params, 'vstep', Math.abs(p.sweep.step)));
  if (!(vstep > 0)) vstep = Math.abs(p.sweep.step);
  return {
    device,
    vstart,
    vstop,
    vstep: vstop >= vstart ? vstep : -vstep,
    cstart: val(params, 'cstart', p.control?.start ?? 0),
    cstop: val(params, 'cstop', p.control?.stop ?? 0),
    csteps: Math.max(1, Math.round(val(params, 'csteps', p.control?.steps ?? 1))),
  };
}

/**
 * The DC sweep for an IV analyzer: drives[0] swept over vstart..vstop; for 3-terminal devices
 * drives[1] stepped in `csteps` equal steps from cstart to cstop (nested `src2`).
 * Returns null when the binding does not name the required sources.
 */
export function ivAnalysisSpec(params: Record<string, string>, binding: Pick<InstrumentBinding, 'drives'>): DcAnalysis | null {
  const s = ivSweep(params);
  const main = binding.drives[0];
  if (!main) return null;
  const spec: DcAnalysis = { type: 'dc', src: main, start: s.vstart, stop: s.vstop, step: s.vstep };
  if (s.device !== 'diode') {
    const ctl = binding.drives[1];
    if (!ctl) return null;
    const step = s.csteps > 1 ? (s.cstop - s.cstart) / (s.csteps - 1) : 1;
    spec.src2 = { src: ctl, start: s.cstart, stop: s.csteps > 1 ? s.cstop : s.cstart, step: step === 0 ? 1 : step };
  }
  return spec;
}

export interface IvCurve {
  label: string;
  v: Float64Array;
  i: Float64Array;
}

function splitOnReset(x: Float64Array): [number, number][] {
  const segs: [number, number][] = [];
  if (!x.length) return segs;
  let start = 0;
  let dir = 0;
  for (let k = 1; k < x.length; k++) {
    const d = Math.sign(x[k] - x[k - 1]);
    if (dir === 0) dir = d;
    else if (d !== 0 && d !== dir) {
      segs.push([start, k - 1]);
      start = k;
      dir = 0;
    }
  }
  segs.push([start, x.length - 1]);
  return segs;
}

/**
 * I-V curves from a DC-sweep result. A family is read from `result.runs` (one curve per run) or,
 * for a single result whose scale restarts (flattened nested sweep), split where the scale
 * changes direction. `invert` flips the current sign (e.g. to plot PNP collector current
 * as a positive quantity).
 */
export function ivCurves(result: AnalysisResult, current: SignalRef, voltage?: SignalRef, invert = false): IvCurve[] {
  const one = (r: AnalysisResult, label: string): IvCurve[] => {
    const scale = r.scale;
    const iSig = resultSignal(r, current);
    if (!scale || !iSig) return [];
    const vSig = voltage ? resultSignal(r, voltage) : null;
    const vx = vSig ? vSig.re : scale.re;
    const sign = invert ? -1 : 1;
    const segs = splitOnReset(scale.re);
    const spec = r.spec?.type === 'dc' ? r.spec : undefined;
    return segs.map(([a, b], k) => {
      let segLabel = label;
      if (segs.length > 1) {
        if (spec?.src2) segLabel = `${spec.src2.src} = ${formatEng(spec.src2.start + k * spec.src2.step, '', 4)}`;
        else segLabel = `${label ? `${label} ` : ''}#${k + 1}`;
      }
      return {
        label: segLabel,
        v: Float64Array.from(vx.subarray(a, b + 1)),
        i: iSig.re.subarray(a, b + 1).map((x) => sign * x),
      };
    });
  };
  if (result.runs?.length) return result.runs.flatMap((run) => one(run.result, run.label));
  return one(result, '');
}
