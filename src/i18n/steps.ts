/**
 * Learner-facing text of the stepping layer (src/model/steps.ts): a `.step` card in the circuit's
 * SPICE text or a Parameter sweep of a global parameter. `StepMessage` carries a code and its
 * parameters; this turns it into a sentence in the current language (keys `steps.<code>` in
 * src/i18n/messages/analysis.ts).
 */
import type { StepMessage } from '../model/steps';
import { hasMessage, t } from './index';

export function stepMessage(m: StepMessage): string {
  const key = `steps.${m.code}`;
  return hasMessage(key) ? t(key, m.params) : m.text;
}
