/**
 * TDMS files in the user interface: the one place that turns the reader's outcome (src/util/tdms.ts)
 * into the learner's sentences. The Grapher import and the "Open file…" button of the measurement
 * sources both use it, so a TDMS file is explained the same way wherever it is opened.
 *
 *   tdmsReason(error)        why a file could not be read
 *   tdmsNotes(import)        what to tell the learner about a file that was read (no time axis,
 *                            thinned values, skipped channels, scaling, truncation)
 */
import { ft } from '../../i18n/filesText';
import { TdmsError, type TdmsImport } from '../../util/tdms';

/** The reason an exception gives for a file that could not be read. */
export function tdmsReason(e: unknown): string {
  if (e instanceof TdmsError) {
    if (e.code === 'not-tdms') return ft('tdmsReasonNot');
    if (e.code === 'daqmx') return ft('tdmsReasonDaqmx');
    if (e.code === 'unsupported-type') return ft('tdmsReasonType');
    return ft('tdmsReasonOther');
  }
  return e instanceof Error ? e.message : String(e);
}

/** Notes about a TDMS file that was read, one sentence each (empty when nothing needs saying). */
export function tdmsNotes(imp: Pick<TdmsImport, 'axis' | 'thinned' | 'skipped' | 'warnings'>): string[] {
  const notes: string[] = [];
  if (imp.axis === 'index') notes.push(ft('tdmsIndexAxis'));
  if (imp.thinned > 1) notes.push(ft('tdmsThinned', { n: imp.thinned }));
  if (imp.skipped.length) notes.push(ft('tdmsSkipped', { names: imp.skipped.join(', ') }));
  if (imp.warnings.some((w) => w.code === 'scaling-ignored')) notes.push(ft('tdmsScaling'));
  if (imp.warnings.some((w) => w.code === 'truncated-data' || w.code === 'ragged-data')) notes.push(ft('tdmsTruncated'));
  return notes;
}
