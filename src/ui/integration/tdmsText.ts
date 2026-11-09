/**
 * TDMS file → the CSV text a measurement-file source part keeps in its "data" parameter
 * (Properties › Open file…). Loaded on demand so the reader stays out of the start-up chunk.
 */
import { ft } from '../../i18n/filesText';
import { MEASUREMENT_MAX_SAMPLES } from '../../library/catalog/measurementSource';
import { parseTdms, tdmsMeasurement, tdmsToCsv } from '../../util/tdms';
import { tdmsNotes, tdmsReason } from './tdmsFlow';

/** The CSV text of the file and a one-paragraph note for the Properties panel (also on failure: text ''). */
export function tdmsFileToCsv(bytes: Uint8Array, name: string): { text: string; note: string } {
  try {
    const file = parseTdms(bytes);
    const csv = tdmsToCsv(file, { maxPoints: MEASUREMENT_MAX_SAMPLES });
    const imp = tdmsMeasurement(file, { maxPoints: MEASUREMENT_MAX_SAMPLES });
    const notes = tdmsNotes({ axis: csv.axis, thinned: csv.thinned, skipped: csv.skipped, warnings: imp.warnings });
    return { text: csv.text, note: [ft('tdmsFileDone', { name, n: csv.labels.length, rows: csv.rows }), ...notes].join(' ') };
  } catch (e) {
    return { text: '', note: ft('tdmsFailed', { name, reason: tdmsReason(e) }) };
  }
}
