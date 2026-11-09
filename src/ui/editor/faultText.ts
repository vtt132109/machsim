/**
 * Learner-facing text of injected pin faults (current language): one line per fault, used by the
 * Fault tab, the schematic fault badge and the Reveal faults list.
 */
import type { PinFault } from '../../model/types';
import { faultResistance } from '../../model/faults';
import { formatEng } from '../../util/units';
import { t } from '../../i18n';

export function describeFault(f: PinFault): string {
  if (f.kind === 'open') return t('fault.describe.open', { pin: f.pin });
  if (f.kind === 'short') return t('fault.describe.short', { pin: f.pin, to: f.to ?? '?' });
  return t('fault.describe.leak', { pin: f.pin, to: f.to ?? '?', r: formatEng(faultResistance(f), 'Ω', 3) });
}
