/**
 * Learner-facing text for the integrity layer (src/model/sanitize.ts).
 *
 * `sanitizeDesign` / `sanitizeIncoming` / `parseDesignSafely` report what they repaired as
 * {@link SanitizeNote}s — a code, a count and a few names. This module turns them into one
 * Vietnamese (or English) paragraph, so every entry path says the same thing in the same words:
 *
 *   const { design, notes } = parseDesignSafely(text);
 *   if (notes.length) actions.addSimMessage('warning', sanitizeReport(notes), t('sim.source.integrity'));
 *
 * Catalogue keys are `sanitize.<code>` in src/i18n/messages/files.ts.
 */
import { NOTE_NAMES, type SanitizeNote } from '../model/sanitize';
import { hasMessage, t } from './index';

/** The names of a note as one list, with "and n more" when it was cut off. */
export function sanitizeNames(note: SanitizeNote): string {
  const names = note.names.join(', ');
  const rest = note.count - note.names.length;
  if (rest > 0 && note.names.length >= NOTE_NAMES) return t('sanitize.andMore', { names, n: rest });
  return names;
}

/** One line for one note, in the current language. */
export function sanitizeLine(note: SanitizeNote): string {
  const key = `sanitize.${note.code}`;
  const names = sanitizeNames(note);
  return hasMessage(key) ? t(key, { n: note.count, names }) : `${note.code}: ${names}`;
}

/**
 * The whole report: a heading with the number of repaired references and one line per note.
 * Returns '' for an empty list, so callers can test it directly.
 */
export function sanitizeReport(notes: readonly SanitizeNote[]): string {
  if (!notes.length) return '';
  const total = notes.reduce((n, x) => n + x.count, 0);
  return [t('sanitize.heading', { n: total }), ...notes.map((x) => `• ${sanitizeLine(x)}`)].join('\n');
}
