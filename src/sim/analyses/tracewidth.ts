/**
 * Trace width analysis ('tracewidth'): minimum PCB conductor width for the currents of a
 * transient simulation, using the IPC-2221 conductor sizing relation
 *
 *     I = k · ΔT^0.44 · A^0.725        (I in A, ΔT in °C, A = cross-section in mil²)
 *     k = 0.048 for external layers, 0.024 for internal layers
 *     width = A / thickness,  thickness = 1.378 mil per oz/ft² of copper (≈ 35 µm per oz)
 *
 * Heating follows the RMS current, so widths are computed from the time-weighted RMS current over
 * the transient (trapezoidal rule); the width needed for the peak current is reported as well.
 * Every element terminal current is evaluated (two-terminal elements: the element current; BJT
 * Ic/Ib/Ie/Isub; FET Id/Ig/Is/Ib; transmission line port currents); a net's trace must carry the
 * largest current of any terminal connected to it, which is the width reported for the net.
 * Inputs outside the range the IPC-2221 curves cover (I ≤ 35 A, 10 °C ≤ ΔT ≤ 100 °C,
 * 0.5–3 oz copper, width ≤ 400 mil) produce warnings.
 *
 * Result: table ['Net', 'Irms (A)', 'Ipeak (A)', 'Element', 'Width (mil)', 'Width (mm)',
 * 'Width for peak (mil)'] sorted by width; scalars "width(<net>)" in mil, max_width_mil,
 * max_width_mm; runs[0] = the transient analysis (all node voltages and currents).
 */
import { isGroundNode, type ElementIR, type TraceWidthAnalysis } from '../netlist';
import { SimulationError, findVector, type AnalysisResult } from '../results';
import type { AnalysisContext } from '../engine/analysis-registry';
import { analysisTitle } from '../engine/titles';
import { withSaves } from './modify';
import { weightedStats } from './util';

/** Copper thickness per oz/ft² (mil). */
export const MIL_PER_OZ = 1.378;
const MM_PER_MIL = 0.0254;

/** IPC-2221 minimum width for a current (A), temperature rise (°C), copper weight (oz/ft²). */
export function ipc2221Width(current: number, tempRise: number, copperOz: number, external: boolean): { areaMil2: number; widthMil: number; widthMm: number } {
  if (!(tempRise > 0) || !(copperOz > 0)) throw new SimulationError('Trace width: temperature rise and copper weight must be positive', 'netlist');
  const i = Math.abs(current);
  if (i === 0) return { areaMil2: 0, widthMil: 0, widthMm: 0 };
  const k = external ? 0.048 : 0.024;
  const area = Math.pow(i / (k * Math.pow(tempRise, 0.44)), 1 / 0.725);
  const widthMil = area / (MIL_PER_OZ * copperOz);
  return { areaMil2: area, widthMil, widthMm: widthMil * MM_PER_MIL };
}

/** Output keys of an element's terminal currents and the IR node positions each one flows through. */
function terminalCurrents(el: ElementIR): [string, number[]][] {
  switch (el.type) {
    case 'Q':
      return [
        ['Ic', [0]],
        ['Ib', [1]],
        ['Ie', [2]],
        ['Isub', [3]],
      ];
    case 'M':
      return [
        ['Id', [0]],
        ['Ig', [1]],
        ['Is', [2]],
        ['Ib', [3]],
      ];
    case 'J':
    case 'Z':
      return [
        ['Id', [0]],
        ['Ig', [1]],
        ['Is', [2]],
      ];
    case 'T':
    case 'O':
      return [
        ['I1', [0, 1]],
        ['I2', [2, 3]],
      ];
    case 'K':
    case 'X':
    case 'A':
      return [];
    default:
      return [['I', [0, 1]]];
  }
}

interface NetStat {
  name: string;
  rms: number;
  peak: number;
  element: string;
}

export function runTraceWidth(spec: TraceWidthAnalysis, ctx: AnalysisContext): AnalysisResult {
  const what = analysisTitle('tracewidth');
  if (!spec.base || spec.base.type !== 'tran') throw new SimulationError(`${what}: the base analysis must be a transient analysis`, 'netlist');
  if (!(spec.tempRise > 0) || !Number.isFinite(spec.tempRise)) throw new SimulationError(`${what}: invalid temperature rise ${spec.tempRise}`, 'netlist');
  if (!(spec.copperOz > 0) || !Number.isFinite(spec.copperOz)) throw new SimulationError(`${what}: invalid copper weight ${spec.copperOz}`, 'netlist');
  const tran = ctx.runSpec(spec.base, withSaves(ctx.netlist, ['all']));
  if (tran.error !== undefined) throw new SimulationError(`${what}: transient analysis failed: ${tran.error}`, 'noconv');
  const time = tran.scale?.re;
  const warnings = [...tran.warnings];

  const nets = new Map<string, NetStat>();
  for (const el of ctx.netlist.elements) {
    for (const [key, positions] of terminalCurrents(el)) {
      const v = findVector(tran, `${key}(${el.name})`);
      if (!v) continue;
      const rms = weightedStats(v.re, time).rms;
      let peak = 0;
      for (const x of v.re) peak = Math.max(peak, Math.abs(x));
      for (const p of positions) {
        const node = el.nodes[p];
        if (node === undefined) continue;
        const name = isGroundNode(node) ? '0' : node;
        const k = name.toLowerCase();
        const cur = nets.get(k);
        if (!cur || rms > cur.rms) nets.set(k, { name, rms, peak: Math.max(peak, cur?.peak ?? 0), element: el.name });
        else cur.peak = Math.max(cur.peak, peak);
      }
    }
  }
  if (nets.size === 0) throw new SimulationError(`${what}: no element currents available`, 'netlist');

  const scalars: Record<string, number> = {};
  const stats = [...nets.values()].map((s) => {
    const w = ipc2221Width(s.rms, spec.tempRise, spec.copperOz, spec.external);
    const wp = ipc2221Width(s.peak, spec.tempRise, spec.copperOz, spec.external);
    return { ...s, w, wp };
  });
  stats.sort((a, b) => b.w.widthMil - a.w.widthMil);
  let maxMil = 0;
  for (const s of stats) {
    scalars[`width(${s.name})`] = s.w.widthMil;
    maxMil = Math.max(maxMil, s.w.widthMil);
    if (s.peak > 35) warnings.push(`${what}: net ${s.name} carries ${s.peak.toPrecision(3)} A, beyond the 35 A range of IPC-2221`);
    if (s.w.widthMil > 400) warnings.push(`${what}: net ${s.name} needs ${s.w.widthMil.toPrecision(4)} mil, beyond the 400 mil range of IPC-2221`);
  }
  scalars.max_width_mil = maxMil;
  scalars.max_width_mm = maxMil * MM_PER_MIL;
  if (spec.tempRise < 10 || spec.tempRise > 100) warnings.push(`${what}: temperature rise ${spec.tempRise} °C is outside the 10–100 °C range of IPC-2221`);
  if (spec.copperOz < 0.5 || spec.copperOz > 3) warnings.push(`${what}: copper weight ${spec.copperOz} oz is outside the 0.5–3 oz range of IPC-2221`);

  return {
    type: 'tracewidth',
    title: what,
    spec,
    vectors: [],
    scalars,
    table: {
      columns: ['Net', 'Irms (A)', 'Ipeak (A)', 'Element', 'Width (mil)', 'Width (mm)', 'Width for peak (mil)'],
      rows: stats.map((s) => [s.name, s.rms, s.peak, s.element, s.w.widthMil, s.w.widthMm, s.wp.widthMil]),
    },
    runs: [{ label: 'transient', result: tran }],
    warnings,
  };
}
