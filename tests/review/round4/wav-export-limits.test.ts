/**
 * Correctness review, round 4: Grapher › Export WAV… with a large time stretch.
 *
 * `traceToWav` (src/audio/export.ts) computes the number of output samples as
 * (span × stretch) × rate and allocates them at once. The dialog (WavExportDialog.tsx) accepts any
 * stretch ≥ 0.001 and only shows the resulting length; nothing caps it. The help text itself
 * suggests "stretch 1000" for a 5 ms trace — the same setting on the 10 s transient of the 555
 * flasher sample asks for 10 000 s = 441 million samples (1.7 GB of float samples plus an 882 MB
 * WAV), which freezes or kills the tab; a longer span throws a raw `RangeError: Invalid typed array
 * length` that the dialog shows in English (it only translates WavExportError). A WAV data chunk is
 * also limited to 4 GiB by its 32-bit size field, so the request should be refused up front with
 * a WavExportError the dialog can explain.
 *
 * The test uses a span that fails immediately (no large allocation is attempted on either side).
 */
import { describe, expect, it } from 'vitest';
import { traceToWav, WavExportError } from '../../../src/audio/export';

describe('WAV export of a very long stretched trace', () => {
  it('is refused with a WavExportError instead of a RangeError / huge allocation', () => {
    const time = [0, 1e6];
    const values = [0, 1];
    let caught: unknown;
    try {
      traceToWav(time, values, { rate: 44100, stretch: 1 });
    } catch (e) {
      caught = e;
    }
    expect(caught, `got ${String(caught)}`).toBeInstanceOf(WavExportError);
  });
});
