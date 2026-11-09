/**
 * What each instrument needs from the simulator besides the live transient stream (pure).
 *
 * Most instruments only read `InstrumentPanelProps.stream`. Four need a separate analysis whose
 * result the integration layer passes in `ac` / `dc`:
 *   bode-plotter      AC sweep (`ac`)                       bodeAnalysisSpec(params)
 *   network-analyzer  AC sweep, forward and reverse runs    networkAnalysisSpec(params)
 *   iv-analyzer       nested DC sweep (`dc`)                ivAnalysisSpec(params, binding)
 *   logic-converter   one operating point per truth-table row with the input sources set to
 *                     the given DC values; pass { runs: [{ label: String(row), result }] } as `dc`
 */

import type { InstrumentBinding } from '../../model/types';
import type { AcAnalysis, DcAnalysis } from '../../sim/netlist';
import { bodeAnalysisSpec } from './bode';
import { ivAnalysisSpec } from './iv';
import { converterRowAssignments, parseLogicConverterSettings } from './logicConverter';
import type { RowAssignment } from './logicConverter';
import { networkAnalysisSpec } from './network';
import { t } from '../../i18n';

export type InstrumentNeed =
  | { kind: 'stream' }
  /** run `spec`; pass the result as `ac` */
  | { kind: 'ac'; spec: AcAnalysis }
  /**
   * run `spec` twice: forward (source `forward` acmag 1, `reverse` acmag 0) and reverse (swapped);
   * pass { ...forward, runs: [{ label: 'forward', result }, { label: 'reverse', result }] } as `ac`.
   * Without `reverse` (port 2 not wired) a single forward run is enough.
   */
  | { kind: 'ac-two-port'; spec: AcAnalysis; forward: string; reverse?: string }
  /** run `spec`; pass the result as `dc` */
  | { kind: 'dc'; spec: DcAnalysis }
  /** run one OP per row with `values` applied to the named sources; pass the runs as `dc` */
  | { kind: 'op-rows'; rows: RowAssignment[] }
  /** required terminals are not wired: nothing to run */
  | { kind: 'none'; reason: string };

/** The analysis an instrument instance needs, from its binding and current params. */
export function instrumentNeed(binding: InstrumentBinding, params: Record<string, string>): InstrumentNeed {
  switch (binding.kind) {
    case 'bode-plotter':
      if (!binding.channels.in || !binding.channels.out) return { kind: 'none', reason: t('instruments.needs.inAndOutMustBe') };
      return { kind: 'ac', spec: bodeAnalysisSpec(params) };
    case 'network-analyzer': {
      const forward = binding.drives.find((d) => /_1$/.test(d));
      const reverse = binding.drives.find((d) => /_2$/.test(d));
      if (!forward || !binding.channels.p1) return { kind: 'none', reason: t('instruments.needs.portP1MustBeConnected') };
      return { kind: 'ac-two-port', spec: networkAnalysisSpec(params), forward, reverse };
    }
    case 'iv-analyzer': {
      const spec = ivAnalysisSpec(params, binding);
      return spec ? { kind: 'dc', spec } : { kind: 'none', reason: t('instruments.needs.theDeviceMustBeConnected') };
    }
    case 'logic-converter': {
      if (!binding.drives.length || !binding.channels.out) return { kind: 'none', reason: t('instruments.needs.connectTheInputsAndOut') };
      const s = parseLogicConverterSettings(params);
      return { kind: 'op-rows', rows: converterRowAssignments(binding, s.inputs, s.vhigh) };
    }
    default:
      return { kind: 'stream' };
  }
}
