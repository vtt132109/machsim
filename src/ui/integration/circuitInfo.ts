/**
 * What the analysis UI can offer for a circuit (pure): output expressions, independent sources
 * and sweepable / toleranced elements and models, derived from a NetlistBuild.
 */
import type { ElementTolerance } from '../../model/netlister';
import { isHiddenFaultElement } from '../../model/faults';
import type { NetlistBuild } from '../../model/types';
import { getParamValue } from '../../sim/analyses/modify';
import type { ElementType } from '../../sim/netlist';
import { isGroundNode } from '../../sim/netlist';
import { getWaveformParam, waveformParamNames } from '../../sim/waveforms';
import type { AnalysisElementInfo, SpecContext } from '../analysis/specs';

const BRANCH_OWNERS: ReadonlySet<ElementType> = new Set(['V', 'L', 'E', 'H']);
const SWEEPABLE: ReadonlySet<ElementType> = new Set(['R', 'C', 'L', 'V', 'I', 'E', 'F', 'G', 'H', 'K', 'D', 'Q', 'J', 'M', 'Z', 'S', 'W', 'T', 'B']);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Element names the netlister generated for its own bookkeeping (sense sources, pin shunts, hidden faults). */
export function isInternalElement(name: string): boolean {
  return /^R_NC_/i.test(name) || /^V_PR_/i.test(name) || isHiddenFaultElement(name);
}

/** Output expressions: V(net) for every named or numbered net, then I(x) of branch owners. */
export function circuitOutputs(build: Pick<NetlistBuild, 'netlist' | 'nets'>): string[] {
  const nets = new Set<string>();
  for (const n of build.nets) if (!isGroundNode(n.name)) nets.add(n.name);
  for (const el of build.netlist.elements) for (const n of el.nodes) if (!isGroundNode(n) && !/^NC_/i.test(n)) nets.add(n);
  const v = [...nets].sort(collator.compare).map((n) => `V(${n})`);
  const i = build.netlist.elements.filter((e) => BRANCH_OWNERS.has(e.type)).map((e) => `I(${e.name})`);
  return [...v, ...i];
}

/** Independent V / I source names. */
export function circuitSources(build: Pick<NetlistBuild, 'netlist'>): string[] {
  return build.netlist.elements.filter((e) => (e.type === 'V' || e.type === 'I') && !isInternalElement(e.name)).map((e) => e.name);
}

/** A build, optionally with the part tolerances the netlister collected (NetlistBuildEx). */
export type BuildInfo = Pick<NetlistBuild, 'netlist'> & { tolerances?: readonly ElementTolerance[] };

/**
 * Elements and model cards for sweeps, Monte Carlo and worst case, with what the analyses can
 * change on them (modify.ts getParamValue / setParamValue):
 *  - every element: "value" when it has one (hasValue), plus its numeric instance parameters;
 *  - independent sources: DC "value" only when a DC value exists (a source defined only by its
 *    transient waveform has none), the AC magnitude / phase when set, and the parameters of its
 *    waveform (ampl, freq, td, ... by canonical name);
 *  - models: their numeric parameters.
 * Each element also carries its type, nodes, nominal value, whether it is a signal source and
 * the tolerance set on its part.
 */
export function circuitElements(build: BuildInfo): AnalysisElementInfo[] {
  const out: AnalysisElementInfo[] = [];
  const tolOf = new Map((build.tolerances ?? []).map((t) => [t.element.toLowerCase(), t.tol]));
  for (const el of build.netlist.elements) {
    if (!SWEEPABLE.has(el.type) || isInternalElement(el.name)) continue;
    const value = getParamValue(build.netlist, el.name, 'value');
    const info: AnalysisElementInfo = { name: el.name, type: el.type, nodes: el.nodes.slice(), hasValue: value !== undefined };
    if (value !== undefined) info.value = value;
    const params = Object.keys(el.params).filter((k) => k.toLowerCase() !== 'value');
    if (el.type === 'V' || el.type === 'I') {
      const src = el.source ?? {};
      if (src.acMag !== undefined) params.push('acmag', 'acphase');
      const wave = src.tran;
      if (wave) params.push(...waveformParamNames(wave.type).filter((n) => getWaveformParam(wave, n) !== undefined));
      info.signal = (src.acMag !== undefined && src.acMag !== 0) || wave !== undefined;
    }
    info.params = [...new Set(params)];
    const tol = tolOf.get(el.name.toLowerCase());
    if (tol !== undefined) info.tol = tol;
    out.push(info);
  }
  for (const card of Object.values(build.netlist.models)) out.push({ name: card.name, model: true, params: Object.keys(card.params) });
  return out;
}

/** Global parameters a Parameter sweep can step: the design variables and `.param`s of the netlist. */
export function circuitVariables(build: Pick<NetlistBuild, 'netlist'>): string[] {
  return Object.keys(build.netlist.params).filter((k) => !k.includes('(') && /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
}

/** SpecContext for defaultSpec / validateSpec. */
export function specContext(build: Pick<NetlistBuild, 'netlist' | 'nets'> & { tolerances?: readonly ElementTolerance[] }): SpecContext {
  return { outputs: circuitOutputs(build), sources: circuitSources(build), elements: circuitElements(build), variables: circuitVariables(build) };
}
