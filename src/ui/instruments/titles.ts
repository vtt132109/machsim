/**
 * Instrument names and preferred window widths (no panel code, so the shell, the help system and
 * menus can import it without pulling the instrument panels into the initial bundle).
 */
import type { InstrumentKind } from '../../model/types';
import { lazyRecord, t } from '../../i18n';

export const INSTRUMENT_KINDS: readonly InstrumentKind[] = [
  'multimeter', 'function-generator', 'oscilloscope', 'oscilloscope-4ch', 'bode-plotter', 'wattmeter', 'frequency-counter', 'iv-analyzer',
  'spectrum-analyzer', 'network-analyzer', 'distortion-analyzer', 'logic-analyzer', 'word-generator', 'logic-converter', 'current-clamp',
  'bench-generator', 'bench-multimeter', 'bench-scope', 'mixed-signal-scope',
];

/** Instrument names (current language). */
export const PANEL_TITLES: Readonly<Record<InstrumentKind, string>> = lazyRecord(INSTRUMENT_KINDS, (k) => t(`instrument.${k}`));

/** Window title for an instrument: "Oscilloscope" or, with a refdes, "Oscilloscope – XSC1". */
export function panelTitle(kind: InstrumentKind, refdes?: string): string {
  const base = PANEL_TITLES[kind] ?? kind;
  return refdes ? `${base} – ${refdes}` : base;
}

/** Preferred initial window width (CSS px) per panel. */
export const PANEL_WIDTHS: Record<InstrumentKind, number> = {
  multimeter: 300,
  'function-generator': 360,
  oscilloscope: 720,
  'oscilloscope-4ch': 820,
  'bode-plotter': 620,
  wattmeter: 300,
  'frequency-counter': 360,
  'iv-analyzer': 620,
  'spectrum-analyzer': 680,
  'network-analyzer': 640,
  'distortion-analyzer': 380,
  'logic-analyzer': 720,
  'word-generator': 640,
  'logic-converter': 600,
  'current-clamp': 300,
  'bench-generator': 640,
  'bench-multimeter': 560,
  'bench-scope': 920,
  'mixed-signal-scope': 920,
};
