/**
 * Binary measurement files in the TDMS layout (extension .tdms), read from the published file
 * format description (segments with a lead-in, metadata and raw data). Original code, no library.
 *
 *   isTdms(bytes)                       true when the bytes start with the "TDSm" tag
 *   parseTdms(bytes) -> TdmsFile        groups, channels, properties and the values
 *   channelAxis(channel)                time axis of a channel from its waveform properties
 *   tdmsMeasurement(file, opts)         the channels as Grapher traces (MeasurementData)
 *   tdmsToCsv(file, opts)               the channels as the CSV text the measurement-file sources read
 *
 * File layout
 *   A file is a list of segments. Each starts with a 28-byte lead-in: the tag "TDSm", the
 *   table-of-contents mask (always little endian), the version, the offset of the next segment and
 *   the offset of the raw data (both counted from the end of the lead-in). The mask says what the
 *   segment holds: new metadata (bit 1), a new object list (bit 2), raw data (bit 3), interleaved
 *   data (bit 5), big-endian numbers (bit 6) or DAQmx raw data (bit 7, not supported). After the
 *   mask the numbers of the lead-in, the metadata and the data use the endianness of the mask.
 *   Metadata lists objects by path ("/'Group'/'Channel'"), each with a raw-data index (none, "same
 *   as before" or a new data type + value count) and properties (name, type, value).
 *   Raw data of a segment is a number of identical chunks: for each chunk, the values of every
 *   channel that has data, either one channel after the other (contiguous) or one value of each
 *   channel in turn (interleaved).
 * Without a new object list a segment continues the object list of the previous one, and a
 * segment without metadata repeats the previous layout. A segment whose next-segment offset is
 * 0xFFFFFFFFFFFFFFFF (the writer stopped before it could be finished) runs to the end of the file.
 *
 * Data types: 8/16/32/64-bit signed and unsigned integers, 32/64-bit floats (with or without a
 * unit), booleans, strings and timestamps. A timestamp is read as seconds since 1904-01-01 00:00
 * UTC. 64-bit integers are converted to doubles (exact up to 2^53). Extended-precision floats,
 * complex numbers and DAQmx raw data are reported as an unsupported file, not guessed at. Scaling
 * properties (NI_Scale…) are not applied: the values are the raw ones, with a warning.
 */
import type { MeasurementData } from './traceImport';
import type { TextTrace } from './measurementText';

export type TdmsErrorCode = 'not-tdms' | 'truncated' | 'unsupported-type' | 'daqmx' | 'too-large' | 'bad-layout';

export class TdmsError extends Error {
  constructor(
    readonly code: TdmsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TdmsError';
  }
}

/** A property value: numbers (timestamps in seconds since 1904-01-01), booleans and text. */
export type TdmsValue = number | boolean | string;

export interface TdmsProperty {
  /** data type id of the file (TDMS_TYPES) */
  type: number;
  value: TdmsValue;
}

export type TdmsProperties = Record<string, TdmsProperty>;

export interface TdmsChannel {
  /** "/'Group'/'Channel'" */
  path: string;
  group: string;
  name: string;
  /** data type id of the values */
  dataType: number;
  typeName: string;
  properties: TdmsProperties;
  /** numbers, booleans (0 / 1) and timestamps (seconds since 1904); null for a string channel */
  values: Float64Array | null;
  /** string channels */
  strings: string[] | null;
  length: number;
}

export interface TdmsGroup {
  name: string;
  properties: TdmsProperties;
  channels: TdmsChannel[];
}

export interface TdmsFile {
  /** properties of the file itself (object "/") */
  properties: TdmsProperties;
  groups: TdmsGroup[];
  channels: TdmsChannel[];
  segments: number;
  version: number;
  /** things that were read with a reservation (truncated data, scaling not applied …) */
  warnings: TdmsWarning[];
}

export type TdmsWarning = { code: 'truncated-data' | 'ragged-data' | 'scaling-ignored' | 'missing-index' | 'trailing-bytes'; detail?: string };

interface TypeInfo {
  name: string;
  /** bytes per value (0 = variable size) */
  size: number;
  read?: (v: DataView, o: number, le: boolean) => number;
}

const TWO64 = 18446744073709551616;

/** Data types the reader understands, by id. */
export const TDMS_TYPES: Readonly<Record<number, TypeInfo>> = {
  0: { name: 'void', size: 0 },
  1: { name: 'int8', size: 1, read: (v, o) => v.getInt8(o) },
  2: { name: 'int16', size: 2, read: (v, o, le) => v.getInt16(o, le) },
  3: { name: 'int32', size: 4, read: (v, o, le) => v.getInt32(o, le) },
  4: { name: 'int64', size: 8, read: (v, o, le) => Number(v.getBigInt64(o, le)) },
  5: { name: 'uint8', size: 1, read: (v, o) => v.getUint8(o) },
  6: { name: 'uint16', size: 2, read: (v, o, le) => v.getUint16(o, le) },
  7: { name: 'uint32', size: 4, read: (v, o, le) => v.getUint32(o, le) },
  8: { name: 'uint64', size: 8, read: (v, o, le) => Number(v.getBigUint64(o, le)) },
  9: { name: 'float32', size: 4, read: (v, o, le) => v.getFloat32(o, le) },
  10: { name: 'float64', size: 8, read: (v, o, le) => v.getFloat64(o, le) },
  0x19: { name: 'float32', size: 4, read: (v, o, le) => v.getFloat32(o, le) },
  0x1a: { name: 'float64', size: 8, read: (v, o, le) => v.getFloat64(o, le) },
  0x20: { name: 'string', size: 0 },
  0x21: { name: 'boolean', size: 1, read: (v, o) => (v.getUint8(o) ? 1 : 0) },
  0x44: {
    name: 'timestamp',
    size: 16,
    read: (v, o, le) => Number(v.getBigInt64(o + 8, le)) + Number(v.getBigUint64(o, le)) / TWO64,
  },
};

/** Largest number of values a file may hold (all channels together). */
export const TDMS_MAX_VALUES = 60_000_000;

const NO_DATA = 0xffffffff;
const SAME_INDEX = 0;
const UNKNOWN_NEXT = 0xffffffffffffffffn;
const TOC_META = 0x02;
const TOC_NEW_OBJECTS = 0x04;
const TOC_RAW = 0x08;
const TOC_INTERLEAVED = 0x20;
const TOC_BIG_ENDIAN = 0x40;
const TOC_DAQMX = 0x80;

/** True when the bytes begin with the tag of a TDMS segment. */
export function isTdms(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x54 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x6d;
}

/** Seconds since 1904-01-01 00:00:00 UTC as a Date (millisecond resolution). */
export function tdmsTimeToDate(seconds: number): Date {
  // 1904-01-01 to 1970-01-01 is 24107 days
  return new Date((seconds - 2082844800) * 1000);
}

interface Index {
  type: number;
  count: number;
  /** strings: bytes of the offsets and the characters of one chunk */
  stringBytes: number;
}

interface Obj {
  path: string;
  properties: TdmsProperties;
  index: Index | null;
  pieces: (Float64Array | string[])[];
  length: number;
  order: number;
}

class Cursor {
  readonly view: DataView;
  pos: number;
  constructor(
    readonly bytes: Uint8Array,
    pos: number,
    readonly end: number,
    readonly le: boolean,
  ) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = pos;
  }

  need(n: number): void {
    if (this.pos + n > this.end) throw new TdmsError('truncated', 'the file ends in the middle of the metadata');
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, this.le);
    this.pos += 4;
    return v;
  }
  u64(): number {
    this.need(8);
    const v = Number(this.view.getBigUint64(this.pos, this.le));
    this.pos += 8;
    return v;
  }
  string(): string {
    const n = this.u32();
    this.need(n);
    const s = new TextDecoder('utf-8').decode(this.bytes.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  value(type: number): TdmsValue {
    if (type === 0x20) return this.string();
    const info = TDMS_TYPES[type];
    if (!info?.read) throw new TdmsError('unsupported-type', `property of data type ${type} is not supported`);
    this.need(info.size);
    const v = info.read(this.view, this.pos, this.le);
    this.pos += info.size;
    return type === 0x21 ? v !== 0 : v;
  }
}

/** Names in a path: "/'Group'/'Chan''nel'" gives ["Group", "Chan'nel"]. */
export function tdmsPathParts(path: string): string[] {
  const out: string[] = [];
  const re = /'((?:[^']|'')*)'/g;
  for (let m = re.exec(path); m; m = re.exec(path)) out.push(m[1].replace(/''/g, "'"));
  return out;
}

function chunkBytes(o: Obj): number {
  const ix = o.index!;
  if (ix.type === 0x20) return ix.stringBytes;
  return ix.count * (TDMS_TYPES[ix.type]?.size ?? 0);
}

/** Read the values of one chunk; returns the position after it. */
function readContiguous(view: DataView, pos: number, o: Obj, le: boolean): number {
  const ix = o.index!;
  if (ix.type === 0x20) {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const out: string[] = [];
    const base = pos + ix.count * 4;
    let start = 0;
    for (let k = 0; k < ix.count; k++) {
      const end = view.getUint32(pos + k * 4, le);
      out.push(new TextDecoder('utf-8').decode(bytes.subarray(base + start, base + end)));
      start = end;
    }
    o.pieces.push(out);
    o.length += ix.count;
    return pos + ix.stringBytes;
  }
  const info = TDMS_TYPES[ix.type];
  const out = new Float64Array(ix.count);
  for (let k = 0; k < ix.count; k++) out[k] = info.read!(view, pos + k * info.size, le);
  o.pieces.push(out);
  o.length += ix.count;
  return pos + ix.count * info.size;
}

/** Read the file; throws {@link TdmsError} when it is not a TDMS file or uses an unsupported feature. */
export function parseTdms(bytes: Uint8Array): TdmsFile {
  if (!isTdms(bytes)) throw new TdmsError('not-tdms', 'the file does not start with the TDMS tag "TDSm"');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const registry = new Map<string, Obj>();
  const warnings: TdmsWarning[] = [];
  let active: Obj[] = [];
  let interleaved = false;
  let pos = 0;
  let segments = 0;
  let version = 0;
  let values = 0;
  let order = 0;

  const objectOf = (path: string): Obj => {
    let o = registry.get(path);
    if (!o) {
      o = { path, properties: {}, index: null, pieces: [], length: 0, order: order++ };
      registry.set(path, o);
    }
    return o;
  };

  while (pos < bytes.length) {
    if (pos + 28 > bytes.length) {
      warnings.push({ code: 'trailing-bytes', detail: String(bytes.length - pos) });
      break;
    }
    if (!isTdms(bytes.subarray(pos))) {
      if (segments === 0) throw new TdmsError('not-tdms', 'the file does not start with the TDMS tag "TDSm"');
      warnings.push({ code: 'trailing-bytes', detail: String(bytes.length - pos) });
      break;
    }
    const toc = view.getUint32(pos + 4, true);
    const le = (toc & TOC_BIG_ENDIAN) === 0;
    version = view.getUint32(pos + 8, le);
    const next = view.getBigUint64(pos + 12, le);
    const rawOffset = Number(view.getBigUint64(pos + 20, le));
    const leadEnd = pos + 28;
    let segEnd: number;
    if (next === UNKNOWN_NEXT) {
      segEnd = bytes.length;
      warnings.push({ code: 'truncated-data' });
    } else {
      segEnd = leadEnd + Number(next);
      if (segEnd > bytes.length) {
        segEnd = bytes.length;
        warnings.push({ code: 'truncated-data' });
      }
    }
    const dataStart = Math.min(leadEnd + rawOffset, segEnd);
    if (toc & TOC_DAQMX) throw new TdmsError('daqmx', 'DAQmx raw data is not supported');
    segments++;

    if (toc & TOC_META) {
      const cur = new Cursor(bytes, leadEnd, Math.min(dataStart, bytes.length), le);
      const count = cur.u32();
      const listed: { obj: Obj; hasData: boolean; fresh: boolean }[] = [];
      for (let i = 0; i < count; i++) {
        const path = cur.string();
        const obj = objectOf(path);
        const len = cur.u32();
        let hasData = false;
        let fresh = false;
        if (len === NO_DATA) obj.index = null;
        else if (len === SAME_INDEX) {
          if (!obj.index) warnings.push({ code: 'missing-index', detail: path });
          else hasData = true;
        } else if (len === 0x69120000 || len === 0x69130000) throw new TdmsError('daqmx', 'DAQmx raw data is not supported');
        else {
          const type = cur.u32();
          cur.u32(); // array dimension, always 1
          const n = cur.u64();
          let stringBytes = 0;
          if (type === 0x20) stringBytes = cur.u64();
          else if (!TDMS_TYPES[type] || TDMS_TYPES[type].size === 0) throw new TdmsError('unsupported-type', `data type ${type} of ${path} is not supported`);
          obj.index = { type, count: n, stringBytes };
          hasData = true;
          fresh = true;
        }
        const props = cur.u32();
        for (let p = 0; p < props; p++) {
          const name = cur.string();
          const type = cur.u32();
          obj.properties[name] = { type, value: cur.value(type) };
        }
        listed.push({ obj, hasData, fresh });
      }
      if (toc & TOC_NEW_OBJECTS) active = listed.filter((l) => l.hasData).map((l) => l.obj);
      else {
        // the object list of the previous segment goes on; listed objects change in place
        for (const l of listed) {
          const at = active.indexOf(l.obj);
          if (l.hasData && at < 0) active.push(l.obj);
          if (!l.hasData && at >= 0) active.splice(at, 1);
        }
      }
    }
    interleaved = (toc & TOC_INTERLEAVED) !== 0;

    if (toc & TOC_RAW && active.length > 0 && segEnd > dataStart) {
      const dataBytes = segEnd - dataStart;
      const sizes = active.map(chunkBytes);
      const chunk = sizes.reduce((a, b) => a + b, 0);
      if (chunk <= 0) throw new TdmsError('bad-layout', 'a chunk of raw data has no size');
      const chunks = Math.floor(dataBytes / chunk);
      if (chunks * chunk !== dataBytes) {
        if (warnings.every((w) => w.code !== 'ragged-data')) warnings.push({ code: 'ragged-data' });
      }
      const perChunk = active.reduce((a, o) => a + o.index!.count, 0);
      values += perChunk * chunks;
      if (values > TDMS_MAX_VALUES) throw new TdmsError('too-large', `the file holds more than ${TDMS_MAX_VALUES} values`);
      let p = dataStart;
      for (let c = 0; c < chunks; c++) {
        if (!interleaved) {
          for (const o of active) p = readContiguous(view, p, o, le);
          continue;
        }
        const n = active[0].index!.count;
        if (active.some((o) => o.index!.count !== n || o.index!.type === 0x20)) throw new TdmsError('bad-layout', 'interleaved data needs numeric channels of equal length');
        const arrays = active.map(() => new Float64Array(n));
        for (let k = 0; k < n; k++) {
          for (let ch = 0; ch < active.length; ch++) {
            const info = TDMS_TYPES[active[ch].index!.type];
            arrays[ch][k] = info.read!(view, p, le);
            p += info.size;
          }
        }
        active.forEach((o, ch) => {
          o.pieces.push(arrays[ch]);
          o.length += n;
        });
      }
    }
    pos = segEnd;
    if (segEnd >= bytes.length) break;
  }

  // ---- assemble groups and channels
  const file: TdmsFile = { properties: {}, groups: [], channels: [], segments, version, warnings };
  const groups = new Map<string, TdmsGroup>();
  const sorted = [...registry.values()].sort((a, b) => a.order - b.order);
  const groupOf = (name: string): TdmsGroup => {
    let g = groups.get(name);
    if (!g) {
      g = { name, properties: {}, channels: [] };
      groups.set(name, g);
      file.groups.push(g);
    }
    return g;
  };
  for (const o of sorted) {
    const parts = tdmsPathParts(o.path);
    if (o.path === '/' || parts.length === 0) file.properties = o.properties;
    else if (parts.length === 1) groupOf(parts[0]).properties = o.properties;
  }
  for (const o of sorted) {
    const parts = tdmsPathParts(o.path);
    if (parts.length < 2) continue;
    const type = o.index?.type ?? (o.pieces.length ? 10 : 0);
    const isText = type === 0x20;
    const flat = isText ? null : new Float64Array(o.length);
    const text: string[] | null = isText ? [] : null;
    let at = 0;
    for (const piece of o.pieces) {
      if (isText) text!.push(...(piece as string[]));
      else {
        flat!.set(piece as Float64Array, at);
        at += piece.length;
      }
    }
    const ch: TdmsChannel = {
      path: o.path,
      group: parts[0],
      name: parts[1],
      dataType: type,
      typeName: TDMS_TYPES[type]?.name ?? String(type),
      properties: o.properties,
      values: flat,
      strings: text,
      length: o.length,
    };
    groupOf(parts[0]).channels.push(ch);
    file.channels.push(ch);
    if ('NI_Number_Of_Scales' in o.properties && Number(o.properties.NI_Number_Of_Scales.value) > 0 && !warnings.some((w) => w.code === 'scaling-ignored')) warnings.push({ code: 'scaling-ignored', detail: o.path });
  }
  return file;
}

// ---------------------------------------------------------------------------------------------
// channels as traces

const num = (p: TdmsProperty | undefined): number | undefined => (p && typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : undefined);

/** Unit text of a channel ("unit_string" property), '' when none. */
export function channelUnit(ch: TdmsChannel): string {
  const u = ch.properties.unit_string?.value;
  return typeof u === 'string' ? u : '';
}

/**
 * The X axis of a waveform channel from its properties: `wf_start_offset + k · wf_increment`.
 * Null when the channel carries no increment (the caller then looks for a time channel).
 */
export function channelAxis(ch: TdmsChannel): { start: number; step: number } | null {
  const step = num(ch.properties.wf_increment);
  if (step === undefined || !(step > 0)) return null;
  return { start: num(ch.properties.wf_start_offset) ?? 0, step };
}

export interface TdmsImportOptions {
  /** most points kept per trace; longer channels are thinned by taking every n-th value */
  maxPoints?: number;
  /** only this group (default: all groups) */
  group?: string;
}

export interface TdmsImport {
  data: MeasurementData;
  /** names of channels that could not be used (text channels, empty channels) */
  skipped: string[];
  /** how the X axis was found */
  axis: 'waveform' | 'time-channel' | 'index';
  /** values were thinned by this factor (1 = none) */
  thinned: number;
  warnings: TdmsWarning[];
}

const isTimeChannel = (ch: TdmsChannel): boolean => ch.dataType === 0x44 || /^(time|t|x|zeit)$/i.test(ch.name);

/**
 * The numeric channels of a file as Grapher traces. The X axis of each channel is, in this order:
 * its own waveform increment, a time channel of the same group and length (a timestamp channel is
 * shown relative to its first value), or the sample number (flagged in `axis`).
 */
export function tdmsMeasurement(file: TdmsFile, opts: TdmsImportOptions = {}, title = 'tdms'): TdmsImport {
  const max = Math.max(2, Math.floor(opts.maxPoints ?? 200_000));
  const skipped: string[] = [];
  const traces: TextTrace[] = [];
  let axisKind: TdmsImport['axis'] = 'waveform';
  let anyIndex = false;
  let anyTimeChannel = false;
  let thinned = 1;
  const channels = file.channels.filter((c) => !opts.group || c.group === opts.group);
  for (const ch of channels) {
    if (!ch.values || ch.length === 0 || isTimeChannel(ch)) {
      // time channels are axes, not traces; text and empty channels cannot be plotted
      if (!isTimeChannel(ch) || !ch.values || ch.length === 0) skipped.push(ch.name);
      continue;
    }
    const wf = channelAxis(ch);
    let x: Float64Array;
    if (wf) {
      x = new Float64Array(ch.length);
      for (let k = 0; k < ch.length; k++) x[k] = wf.start + k * wf.step;
    } else {
      const tc = file.channels.find((c) => c.group === ch.group && isTimeChannel(c) && c.values && c.length === ch.length);
      if (tc?.values) {
        const t0 = tc.dataType === 0x44 ? tc.values[0] : 0;
        x = Float64Array.from(tc.values, (v) => v - t0);
        anyTimeChannel = true;
      } else {
        x = Float64Array.from({ length: ch.length }, (_, k) => k);
        anyIndex = true;
      }
    }
    let step = 1;
    if (ch.length > max) step = Math.ceil(ch.length / max);
    thinned = Math.max(thinned, step);
    const n = Math.ceil(ch.length / step);
    const tx = new Float64Array(n);
    const ty = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      tx[k] = x[k * step];
      ty[k] = ch.values[k * step];
    }
    const multiGroup = file.groups.length > 1 && !opts.group;
    traces.push({ label: multiGroup ? `${ch.group}/${ch.name}` : ch.name, unit: channelUnit(ch), x: tx, y: ty });
  }
  if (anyIndex) axisKind = 'index';
  else if (anyTimeChannel) axisKind = 'time-channel';
  if (traces.length === 0) throw new TdmsError('bad-layout', 'the file has no numeric channel with values');
  return {
    data: { title, xKind: 'time', xLabel: 'time', xUnit: 's', traces, skipped: [] },
    skipped,
    axis: axisKind,
    thinned,
    warnings: file.warnings,
  };
}

/** Text of a number for a CSV cell (shortest text that reads back the same double). */
const cell = (v: number): string => (Number.isFinite(v) ? String(v) : '');

export interface TdmsCsv {
  text: string;
  /** channel labels in column order (after the time column) */
  labels: string[];
  /** channels left out because their length or axis differs from the first one */
  skipped: string[];
  rows: number;
  thinned: number;
  axis: TdmsImport['axis'];
}

/**
 * The channels as CSV text with a header (`time [s],ch1 [V],…`), the layout the measurement-file
 * sources and the Grapher import read. All columns share the time axis of the first usable
 * channel; channels with another length are left out and named in `skipped`.
 */
export function tdmsToCsv(file: TdmsFile, opts: TdmsImportOptions = {}): TdmsCsv {
  const imp = tdmsMeasurement(file, opts);
  const first = imp.data.traces[0];
  const used = imp.data.traces.filter((t) => t.x.length === first.x.length && t.x[0] === first.x[0] && t.x[t.x.length - 1] === first.x[first.x.length - 1]);
  const skipped = [...imp.skipped, ...imp.data.traces.filter((t) => !used.includes(t)).map((t) => t.label)];
  // a comma, semicolon or tab in a name would add a column
  const clean = (text: string): string => text.replace(/[,;\t\r\n]+/g, ' ').trim();
  const head = (t: TextTrace): string => (t.unit ? `${clean(t.label)} [${clean(t.unit)}]` : clean(t.label));
  const lines = [['time [s]', ...used.map(head)].join(',')];
  for (let k = 0; k < first.x.length; k++) lines.push([cell(first.x[k]), ...used.map((t) => cell(t.y[k]))].join(','));
  return { text: lines.join('\n'), labels: used.map((t) => t.label), skipped, rows: first.x.length, thinned: imp.thinned, axis: imp.axis };
}
