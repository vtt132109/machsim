/**
 * Measurement-file sources: play a measured waveform from a text file as a voltage or a current.
 *
 * The file is read by the same reader as the Grapher's "Import measurement" (src/util/traceImport.ts):
 * tab-separated measurement text with a header ending in `***End_of_Header***` (the text form of the
 * LVM measurement files that data-acquisition software writes), MachSim measurement text, and CSV /
 * TSV / semicolon / space separated columns with an X column of time and one column per channel.
 * Decimal commas, header rows with units ("V(out) [mV]") and descending time are understood. The
 * part picks one channel and plays it as a piece-wise linear source, so every analysis sees it:
 *
 *   value(t) = vscale · y(tscale · (t − delay)) + voffset      (t ≥ delay; before it the first value)
 *
 * `tscale` stretches the time axis (2 = twice as slow, 0.5 = twice as fast), `vscale` scales and
 * `voffset` shifts the values, `repeat` starts the file again when it ends.
 */
import type { SourceSpec } from '../../sim/netlist';
import { MeasurementError, parseMeasurement } from '../../util/traceImport';
import { boolOf, boolParam, elI, elV, numParam, textParam, wPwl, type LibraryPartDef } from '../partkit';
import { sourceSymbol } from '../symbols';
import type { ToSpiceContext } from '../types';
import { withMeta } from './kit';

const DEFAULT_DATA = 'time [s],ch1 [V],ch2 [V]\n0,0,0\n0.001,1,0.5\n0.002,0,1\n0.003,-1,0.5\n0.004,0,0';

/** Longest file a source part accepts (samples per channel). */
export const MEASUREMENT_MAX_SAMPLES = 200_000;

export interface MeasurementPlayback {
  /** (time, value) pairs ready for a PWL source */
  pairs: number[];
  /** number of channels in the file */
  channels: number;
  /** label of the channel played */
  label: string;
}

/**
 * The channel `channel` (1-based) of a measurement file as PWL pairs.
 * Throws Error('bad value for …') with the reason for an unreadable file or a missing channel.
 */
export function measurementPlayback(text: string, channel: number, tscale: number, vscale: number, voffset: number, delay: number): MeasurementPlayback {
  let data;
  try {
    data = parseMeasurement(text, 'source');
  } catch (e) {
    throw new Error(`bad value for data: ${e instanceof MeasurementError ? e.message : 'not a measurement file'}`);
  }
  const ch = Math.round(channel);
  if (!(ch >= 1 && ch <= data.traces.length)) throw new Error(`bad value for channel: the file has ${data.traces.length} channel${data.traces.length === 1 ? '' : 's'}`);
  const tr = data.traces[ch - 1];
  if (tr.x.length > MEASUREMENT_MAX_SAMPLES) throw new Error(`bad value for data: ${tr.x.length} samples are too many (the limit is ${MEASUREMENT_MAX_SAMPLES})`);
  const t0 = tr.x[0];
  const pairs: number[] = [];
  if (delay > 0) pairs.push(0, vscale * tr.y[0] + voffset);
  let last = -Infinity;
  for (let i = 0; i < tr.x.length; i++) {
    // equal times would be a zero-width edge: keep the later value a hair after the earlier one
    let t = delay + (tr.x[i] - t0) * tscale;
    if (t <= last) t = last + 1e-15;
    pairs.push(t, vscale * tr.y[i] + voffset);
    last = t;
  }
  return { pairs, channels: data.traces.length, label: tr.label };
}

function playbackOf(ctx: ToSpiceContext): MeasurementPlayback {
  const ts = ctx.num('tscale');
  if (!(ts > 0)) throw new Error('bad value for tscale: must be > 0');
  return measurementPlayback(ctx.params.data ?? '', ctx.num('channel'), ts, ctx.num('vscale'), ctx.num('voffset'), Math.max(0, ctx.num('delay')));
}

function measurementSource(kind: 'V' | 'I'): LibraryPartDef {
  const isV = kind === 'V';
  const unit = isV ? 'V' : 'A';
  return withMeta(
    {
      id: `sources/measurement-${isV ? 'voltage' : 'current'}`,
      name: isV ? 'Measurement File Voltage Source' : 'Measurement File Current Source',
      group: 'sources',
      family: 'Measurement file sources',
      description: `Plays a channel of a measurement text file (LVM text with an End_of_Header line, CSV, TSV; X column = time) as a ${isV ? 'voltage' : 'current'}: the measured waveform drives the circuit, with time scaling, value scaling, offset and repeat`,
      prefix: kind,
      symbol: sourceSymbol(isV ? 'pwl' : 'ac-current'),
      params: [
        textParam('data', 'Measurement data', DEFAULT_DATA, { group: 'waveform', fileImport: '.lvm,.txt,.csv,.tsv,.dat', help: 'The text of the file: an X (time) column and one column per channel; use Open file… to load an LVM text, CSV or TSV file' }),
        numParam('channel', 'Channel', '1', '', { group: 'waveform', min: 1, showOnSchematic: true, help: 'Which value column to play (1 = the first after the time column)' }),
        numParam('tscale', 'Time scale', '1', '', { group: 'waveform', min: 0, help: '2 plays the recording twice as slowly, 0.5 twice as fast' }),
        numParam('vscale', 'Value scale', '1', '×', { group: 'waveform', help: 'Multiplies every value (e.g. 1000 for a file in kV)' }),
        numParam('voffset', 'Value offset', '0', unit, { group: 'waveform' }),
        numParam('delay', 'Delay', '0', 's', { group: 'waveform', min: 0 }),
        boolParam('repeat', 'Repeat', false, { group: 'waveform', help: 'Start again when the recording ends' }),
      ],
      toSpice: (ctx) => {
        const pb = playbackOf(ctx);
        const spec: SourceSpec = { dc: pb.pairs[1], tran: wPwl(pb.pairs, boolOf(ctx, 'repeat')) };
        return { elements: [isV ? elV(ctx.name('V'), ctx.node('+'), ctx.node('-'), spec) : elI(ctx.name('I'), ctx.node('-'), ctx.node('+'), spec)] };
      },
      virtual: true,
      provenance: 'MachSim measurement-file source: the Grapher measurement reader (LVM text, CSV, TSV) and a piece-wise linear waveform',
      keywords: ['lvm', 'measurement', 'recorded', 'data file', 'csv', 'tsv', 'playback', 'daq', 'file source'],
    },
    {
      vi: `Phát một kênh của tệp văn bản đo lường (LVM dạng văn bản có dòng End_of_Header, CSV, TSV; cột X là thời gian) thành ${isV ? 'điện áp' : 'dòng điện'}: dạng sóng đã đo điều khiển mạch, có tỉ lệ thời gian, tỉ lệ giá trị, độ lệch và lặp lại`,
      nameVi: isV ? 'Nguồn áp từ tệp đo lường' : 'Nguồn dòng từ tệp đo lường',
    },
  );
}

export const MEASUREMENT_CATALOG: LibraryPartDef[] = [measurementSource('V'), measurementSource('I')];
