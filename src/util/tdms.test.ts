/**
 * TDMS reader against hand-built files that follow the published layout: every segment layout the
 * reader claims (contiguous, interleaved, big endian, several chunks, appended segments, a new
 * object list, an unfinished last segment) with numbers that can be checked by hand.
 */
import { describe, expect, it } from 'vitest';
import { TdmsError, channelAxis, isTdms, parseTdms, tdmsMeasurement, tdmsPathParts, tdmsTimeToDate, tdmsToCsv } from './tdms';
import { measurementResult, parseMeasurement } from './traceImport';
import { measurementPlayback } from '../library/catalog/measurementSource';

// ---- a TDMS writer for the tests ------------------------------------------------------------

class Out {
  private parts: number[] = [];
  constructor(readonly le = true) {}
  bytes(b: ArrayLike<number>): this {
    for (let i = 0; i < b.length; i++) this.parts.push(b[i]);
    return this;
  }
  private num(size: number, write: (v: DataView) => void): this {
    const v = new DataView(new ArrayBuffer(size));
    write(v);
    return this.bytes(new Uint8Array(v.buffer));
  }
  u8(x: number) {
    return this.num(1, (v) => v.setUint8(0, x));
  }
  i16(x: number) {
    return this.num(2, (v) => v.setInt16(0, x, this.le));
  }
  u32(x: number) {
    return this.num(4, (v) => v.setUint32(0, x, this.le));
  }
  i32(x: number) {
    return this.num(4, (v) => v.setInt32(0, x, this.le));
  }
  u64(x: number | bigint) {
    return this.num(8, (v) => v.setBigUint64(0, BigInt(x), this.le));
  }
  i64(x: number | bigint) {
    return this.num(8, (v) => v.setBigInt64(0, BigInt(x), this.le));
  }
  f32(x: number) {
    return this.num(4, (v) => v.setFloat32(0, x, this.le));
  }
  f64(x: number) {
    return this.num(8, (v) => v.setFloat64(0, x, this.le));
  }
  str(s: string) {
    const b = new TextEncoder().encode(s);
    return this.u32(b.length).bytes(b);
  }
  get length() {
    return this.parts.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

type Prop = [name: string, type: number, value: number | string | boolean];
type IndexSpec = 'none' | 'same' | { type: number; count: number; stringBytes?: number };
interface ObjSpec {
  path: string;
  index: IndexSpec;
  props?: Prop[];
}

const TYPE = { i8: 1, i16: 2, i32: 3, i64: 4, u8: 5, u16: 6, u32: 7, u64: 8, f32: 9, f64: 10, string: 0x20, bool: 0x21, time: 0x44 };

function metadata(objects: ObjSpec[], le: boolean): Uint8Array {
  const o = new Out(le);
  o.u32(objects.length);
  for (const obj of objects) {
    o.str(obj.path);
    if (obj.index === 'none') o.u32(0xffffffff);
    else if (obj.index === 'same') o.u32(0);
    else {
      const withBytes = obj.index.type === TYPE.string;
      o.u32(withBytes ? 28 : 20).u32(obj.index.type).u32(1).u64(obj.index.count);
      if (withBytes) o.u64(obj.index.stringBytes ?? 0);
    }
    const props = obj.props ?? [];
    o.u32(props.length);
    for (const [name, type, value] of props) {
      o.str(name).u32(type);
      if (type === TYPE.string) o.str(value as string);
      else if (type === TYPE.f64) o.f64(value as number);
      else if (type === TYPE.i32) o.i32(value as number);
      else if (type === TYPE.u32) o.u32(value as number);
      else if (type === TYPE.bool) o.u8(value ? 1 : 0);
      else if (type === TYPE.time) o.u64(0).i64(value as number);
      else throw new Error(`test writer: property type ${type}`);
    }
  }
  return o.done();
}

interface SegSpec {
  objects?: ObjSpec[];
  newList?: boolean;
  data?: Uint8Array;
  interleaved?: boolean;
  big?: boolean;
  daqmx?: boolean;
  /** write 0xFFFF… as the next-segment offset */
  unfinished?: boolean;
  /** cut the data to this many bytes (a file that ends early) */
  cut?: number;
}

function segment(s: SegSpec): Uint8Array {
  const le = !s.big;
  const meta = s.objects ? metadata(s.objects, le) : new Uint8Array(0);
  const data = s.data ?? new Uint8Array(0);
  let toc = 0;
  if (s.objects) toc |= 0x02;
  if (s.newList) toc |= 0x04;
  if (data.length) toc |= 0x08;
  if (s.interleaved) toc |= 0x20;
  if (s.big) toc |= 0x40;
  if (s.daqmx) toc |= 0x80;
  const o = new Out(le);
  o.bytes([0x54, 0x44, 0x53, 0x6d]);
  // the mask is always little endian
  o.bytes(new Uint8Array(new Uint32Array([toc]).buffer));
  o.u32(4713);
  const next = meta.length + data.length;
  if (s.unfinished) o.bytes(new Uint8Array(8).fill(0xff));
  else o.u64(next);
  o.u64(meta.length);
  o.bytes(meta).bytes(s.cut !== undefined ? data.subarray(0, s.cut) : data);
  return o.done();
}

const concat = (...parts: Uint8Array[]): Uint8Array => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
const f64s = (...v: number[]): Uint8Array => {
  const o = new Out();
  v.forEach((x) => o.f64(x));
  return o.done();
};

// ---- tests ---------------------------------------------------------------------------------------

describe('reading TDMS files', () => {
  it('recognises the tag', () => {
    expect(isTdms(segment({}))).toBe(true);
    expect(isTdms(new TextEncoder().encode('time,v\n0,1'))).toBe(false);
    expect(() => parseTdms(new TextEncoder().encode('not a tdms file at all, just text'))).toThrow(TdmsError);
  });

  it('contiguous data: two float64 channels, properties of the file, the group and the channel', () => {
    const file = parseTdms(
      segment({
        newList: true,
        objects: [
          { path: '/', index: 'none', props: [['title', TYPE.string, 'Bench run']] },
          { path: "/'Scope'", index: 'none', props: [['operator', TYPE.string, 'Linh']] },
          { path: "/'Scope'/'Vin'", index: { type: TYPE.f64, count: 4 }, props: [['unit_string', TYPE.string, 'V'], ['wf_increment', TYPE.f64, 0.001], ['wf_start_offset', TYPE.f64, 0.5], ['gain', TYPE.i32, 3]] },
          { path: "/'Scope'/'Vout'", index: { type: TYPE.f64, count: 4 }, props: [['unit_string', TYPE.string, 'V'], ['wf_increment', TYPE.f64, 0.001], ['ok', TYPE.bool, true]] },
        ],
        data: f64s(1, 2, 3, 4, 10, 20, 30, 40),
      }),
    );
    expect(file.segments).toBe(1);
    expect(file.properties.title.value).toBe('Bench run');
    expect(file.groups.map((g) => g.name)).toEqual(['Scope']);
    expect(file.groups[0].properties.operator.value).toBe('Linh');
    const [vin, vout] = file.channels;
    expect(vin.name).toBe('Vin');
    expect(Array.from(vin.values!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(vout.values!)).toEqual([10, 20, 30, 40]);
    expect(vin.properties.gain).toEqual({ type: TYPE.i32, value: 3 });
    expect(vout.properties.ok.value).toBe(true);
    expect(vin.typeName).toBe('float64');
    expect(channelAxis(vin)).toEqual({ start: 0.5, step: 0.001 });
    expect(channelAxis(vout)).toEqual({ start: 0, step: 0.001 });
    expect(file.warnings).toEqual([]);
  });

  it('interleaved data: one value of each channel in turn, mixed types', () => {
    const d = new Out();
    // channel A int16, channel B float32, three values each
    for (const [a, b] of [[1, 0.5], [-2, 1.5], [300, -2.25]] as const) d.i16(a).f32(b);
    const file = parseTdms(
      segment({
        newList: true,
        interleaved: true,
        objects: [
          { path: "/'G'/'A'", index: { type: TYPE.i16, count: 3 } },
          { path: "/'G'/'B'", index: { type: TYPE.f32, count: 3 } },
        ],
        data: d.done(),
      }),
    );
    expect(Array.from(file.channels[0].values!)).toEqual([1, -2, 300]);
    expect(Array.from(file.channels[1].values!)).toEqual([0.5, 1.5, -2.25]);
  });

  it('big-endian numbers in the lead-in, the metadata and the data', () => {
    const d = new Out(false);
    d.i32(-5).i32(70000).i32(123456789);
    const bytes = segment({
      big: true,
      newList: true,
      objects: [{ path: "/'G'/'N'", index: { type: TYPE.i32, count: 3 }, props: [['scale', TYPE.f64, 2.5], ['name', TYPE.string, 'đo']] }],
      data: d.done(),
    });
    const file = parseTdms(bytes);
    expect(Array.from(file.channels[0].values!)).toEqual([-5, 70000, 123456789]);
    expect(file.channels[0].properties.scale.value).toBe(2.5);
    expect(file.channels[0].properties.name.value).toBe('đo');
  });

  it('several chunks in one segment are joined in order', () => {
    // two channels of 2 values, three chunks: contiguous within a chunk
    const data = f64s(1, 2, 10, 20, 3, 4, 30, 40, 5, 6, 50, 60);
    const file = parseTdms(
      segment({
        newList: true,
        objects: [
          { path: "/'G'/'x'", index: { type: TYPE.f64, count: 2 } },
          { path: "/'G'/'y'", index: { type: TYPE.f64, count: 2 } },
        ],
        data,
      }),
    );
    expect(Array.from(file.channels[0].values!)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(file.channels[1].values!)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('interleaved data with several chunks', () => {
    const d = new Out();
    // 2 chunks, 2 values per chunk: (a1 b1 a2 b2)(a3 b3 a4 b4)
    for (const v of [1, 10, 2, 20, 3, 30, 4, 40]) d.f64(v);
    const file = parseTdms(segment({ newList: true, interleaved: true, objects: [{ path: "/'G'/'a'", index: { type: TYPE.f64, count: 2 } }, { path: "/'G'/'b'", index: { type: TYPE.f64, count: 2 } }], data: d.done() }));
    expect(Array.from(file.channels[0].values!)).toEqual([1, 2, 3, 4]);
    expect(Array.from(file.channels[1].values!)).toEqual([10, 20, 30, 40]);
  });

  it('appended segments: "same index" and a segment without metadata continue the channels', () => {
    const objs: ObjSpec[] = [{ path: "/'G'/'v'", index: { type: TYPE.f64, count: 2 }, props: [['unit_string', TYPE.string, 'A']] }];
    const file = parseTdms(
      concat(
        segment({ newList: true, objects: objs, data: f64s(1, 2) }),
        // new metadata, list unchanged, index "same as before", one property added
        segment({ objects: [{ path: "/'G'/'v'", index: 'same', props: [['note', TYPE.string, 'second']] }], data: f64s(3, 4) }),
        // no metadata at all: same layout again
        segment({ data: f64s(5, 6) }),
      ),
    );
    expect(file.segments).toBe(3);
    expect(Array.from(file.channels[0].values!)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(file.channels[0].properties.unit_string.value).toBe('A');
    expect(file.channels[0].properties.note.value).toBe('second');
  });

  it('a new index may change the number of values per chunk', () => {
    const file = parseTdms(
      concat(
        segment({ newList: true, objects: [{ path: "/'G'/'v'", index: { type: TYPE.f64, count: 2 } }], data: f64s(1, 2) }),
        segment({ objects: [{ path: "/'G'/'v'", index: { type: TYPE.f64, count: 3 } }], data: f64s(3, 4, 5) }),
      ),
    );
    expect(Array.from(file.channels[0].values!)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a new object list replaces the channels that carry data', () => {
    const file = parseTdms(
      concat(
        segment({ newList: true, objects: [{ path: "/'G'/'a'", index: { type: TYPE.f64, count: 1 } }, { path: "/'G'/'b'", index: { type: TYPE.f64, count: 1 } }], data: f64s(1, 10) }),
        // only b continues, with its previous index
        segment({ newList: true, objects: [{ path: "/'G'/'b'", index: 'same' }], data: f64s(20) }),
        // a comes back with a new index
        segment({ newList: true, objects: [{ path: "/'G'/'a'", index: { type: TYPE.f64, count: 1 } }, { path: "/'G'/'b'", index: 'same' }], data: f64s(2, 30) }),
      ),
    );
    const byName = Object.fromEntries(file.channels.map((c) => [c.name, Array.from(c.values!)]));
    expect(byName.a).toEqual([1, 2]);
    expect(byName.b).toEqual([10, 20, 30]);
  });

  it('a channel listed without data in a later segment stops receiving values', () => {
    const file = parseTdms(
      concat(
        segment({ newList: true, objects: [{ path: "/'G'/'a'", index: { type: TYPE.f64, count: 1 } }, { path: "/'G'/'b'", index: { type: TYPE.f64, count: 1 } }], data: f64s(1, 10) }),
        segment({ objects: [{ path: "/'G'/'a'", index: 'none' }], data: f64s(20) }),
      ),
    );
    const byName = Object.fromEntries(file.channels.map((c) => [c.name, Array.from(c.values!)]));
    expect(byName.a).toEqual([1]);
    expect(byName.b).toEqual([10, 20]);
  });

  it('strings, booleans, 64-bit integers and timestamps', () => {
    // strings: end offsets then the characters
    const text = new Out();
    const words = ['một', 'hai', 'ba'].map((w) => new TextEncoder().encode(w));
    let end = 0;
    const ends = words.map((w) => (end += w.length));
    ends.forEach((e) => text.u32(e));
    words.forEach((w) => text.bytes(w));
    const stringBytes = text.length;
    const seg = new Out();
    seg.bytes(text.done());
    seg.u8(1).u8(0).u8(1); // booleans
    seg.i64(-9007199254740991).i64(5); // int64
    seg.u64(0).i64(3_000_000_000).u64(2 ** 63).i64(7); // timestamps (fraction 0 and 0.5 s)
    const file = parseTdms(
      segment({
        newList: true,
        objects: [
          { path: "/'G'/'s'", index: { type: TYPE.string, count: 3, stringBytes } },
          { path: "/'G'/'b'", index: { type: TYPE.bool, count: 3 } },
          { path: "/'G'/'i'", index: { type: TYPE.i64, count: 2 } },
          { path: "/'G'/'t'", index: { type: TYPE.time, count: 2 } },
        ],
        data: seg.done(),
      }),
    );
    const ch = Object.fromEntries(file.channels.map((c) => [c.name, c]));
    expect(ch.s.strings).toEqual(['một', 'hai', 'ba']);
    expect(ch.s.values).toBeNull();
    expect(Array.from(ch.b.values!)).toEqual([1, 0, 1]);
    expect(Array.from(ch.i.values!)).toEqual([-9007199254740991, 5]);
    expect(Array.from(ch.t.values!)).toEqual([3_000_000_000, 7.5]);
    expect(tdmsTimeToDate(2082844800).toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('paths with quotes and several groups', () => {
    expect(tdmsPathParts("/'a''b'/'c d'")).toEqual(["a'b", 'c d']);
    expect(tdmsPathParts('/')).toEqual([]);
    const file = parseTdms(
      segment({
        newList: true,
        objects: [
          { path: "/'One'/'x'", index: { type: TYPE.f64, count: 1 } },
          { path: "/'Two'/'it''s'", index: { type: TYPE.f64, count: 1 } },
        ],
        data: f64s(1, 2),
      }),
    );
    expect(file.groups.map((g) => g.name)).toEqual(['One', 'Two']);
    expect(file.channels[1].name).toBe("it's");
    expect(file.channels[1].group).toBe('Two');
  });

  it('an unfinished last segment runs to the end of the file and keeps whole chunks only', () => {
    const file = parseTdms(
      segment({
        newList: true,
        unfinished: true,
        objects: [{ path: "/'G'/'v'", index: { type: TYPE.f64, count: 2 } }],
        // 5 values written, the 5th is half a chunk: 2 whole chunks survive
        data: f64s(1, 2, 3, 4, 5),
      }),
    );
    expect(Array.from(file.channels[0].values!)).toEqual([1, 2, 3, 4]);
    expect(file.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['truncated-data', 'ragged-data']));
  });

  it('a file cut short inside the data keeps what is complete', () => {
    const bytes = segment({ newList: true, objects: [{ path: "/'G'/'v'", index: { type: TYPE.f64, count: 2 } }], data: f64s(1, 2, 3, 4) });
    const file = parseTdms(bytes.subarray(0, bytes.length - 8 * 1));
    expect(Array.from(file.channels[0].values!)).toEqual([1, 2]);
    expect(file.warnings.some((w) => w.code === 'truncated-data')).toBe(true);
  });

  it('refuses what it cannot read instead of guessing', () => {
    expect(() => parseTdms(segment({ daqmx: true, newList: true, objects: [{ path: "/'G'/'v'", index: { type: TYPE.f64, count: 1 } }], data: f64s(1) }))).toThrow(/DAQmx/);
    const code = (f: () => unknown): string => {
      try {
        f();
      } catch (e) {
        return e instanceof TdmsError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code(() => parseTdms(segment({ newList: true, objects: [{ path: "/'G'/'v'", index: { type: 11, count: 1 } }], data: f64s(1) })))).toBe('unsupported-type');
    // metadata that stops in the middle
    const bytes = segment({ newList: true, objects: [{ path: "/'G'/'v'", index: { type: TYPE.f64, count: 1 } }], data: f64s(1) });
    expect(code(() => parseTdms(Uint8Array.from([...bytes.subarray(0, 28), 0, 0, 0, 5])))).toBe('truncated');
    // interleaved channels of different length
    expect(code(() => parseTdms(segment({ newList: true, interleaved: true, objects: [{ path: "/'G'/'a'", index: { type: TYPE.f64, count: 1 } }, { path: "/'G'/'b'", index: { type: TYPE.f64, count: 2 } }], data: f64s(1, 2, 3) })))).toBe('bad-layout');
  });
});

describe('TDMS channels as traces', () => {
  const waveform = parseTdms(
    segment({
      newList: true,
      objects: [
        { path: "/'Scope'/'Vin'", index: { type: TYPE.f64, count: 5 }, props: [['unit_string', TYPE.string, 'V'], ['wf_increment', TYPE.f64, 0.002], ['wf_start_offset', TYPE.f64, 1]] },
        { path: "/'Scope'/'Iin'", index: { type: TYPE.f64, count: 5 }, props: [['unit_string', TYPE.string, 'A'], ['wf_increment', TYPE.f64, 0.002], ['wf_start_offset', TYPE.f64, 1]] },
      ],
      data: f64s(0, 1, 2, 3, 4, 0.1, 0.2, 0.3, 0.4, 0.5),
    }),
  );

  it('time axis from the waveform properties', () => {
    const imp = tdmsMeasurement(waveform, {}, 'run.tdms');
    expect(imp.axis).toBe('waveform');
    expect(imp.data.xKind).toBe('time');
    expect(imp.data.traces.map((t) => [t.label, t.unit])).toEqual([['Vin', 'V'], ['Iin', 'A']]);
    expect(Array.from(imp.data.traces[0].x)).toEqual([1, 1.002, 1.004, 1.006, 1.008].map((v) => expect.closeTo(v, 12)));
    expect(Array.from(imp.data.traces[0].y)).toEqual([0, 1, 2, 3, 4]);
    // the Grapher page
    const page = measurementResult(imp.data, 'run');
    expect(page.type).toBe('tran');
    expect(page.vectors.map((v) => v.name)).toEqual(['Vin', 'Iin']);
    expect(page.vectors[0].unit).toBe('V');
    expect(page.vectors[1].unit).toBe('A');
    expect(page.scale!.re[4]).toBeCloseTo(1.008, 12);
  });

  it('a time channel of the group is the axis, relative to its first value when it is a timestamp', () => {
    const d = new Out();
    d.u64(0).i64(1000).u64(2 ** 63).i64(1000).u64(0).i64(1001);
    const v = new Out();
    v.f64(5).f64(6).f64(7);
    const file = parseTdms(
      segment({
        newList: true,
        objects: [
          { path: "/'G'/'Time'", index: { type: TYPE.time, count: 3 } },
          { path: "/'G'/'V'", index: { type: TYPE.f64, count: 3 }, props: [['unit_string', TYPE.string, 'V']] },
        ],
        data: concat(d.done(), v.done()),
      }),
    );
    const imp = tdmsMeasurement(file);
    expect(imp.axis).toBe('time-channel');
    expect(imp.data.traces).toHaveLength(1);
    expect(Array.from(imp.data.traces[0].x)).toEqual([0, 0.5, 1]);
    expect(Array.from(imp.data.traces[0].y)).toEqual([5, 6, 7]);
  });

  it('without any time information the sample number is the axis, and it is flagged', () => {
    const file = parseTdms(segment({ newList: true, objects: [{ path: "/'G'/'V'", index: { type: TYPE.f64, count: 3 } }], data: f64s(5, 6, 7) }));
    const imp = tdmsMeasurement(file);
    expect(imp.axis).toBe('index');
    expect(Array.from(imp.data.traces[0].x)).toEqual([0, 1, 2]);
  });

  it('long channels are thinned and say so; text channels are skipped', () => {
    const n = 1000;
    const values = new Out();
    for (let k = 0; k < n; k++) values.f64(k);
    const text = new Out();
    text.u32(1).bytes(new TextEncoder().encode('x'));
    const file = parseTdms(
      segment({
        newList: true,
        objects: [
          { path: "/'G'/'V'", index: { type: TYPE.f64, count: n }, props: [['wf_increment', TYPE.f64, 1]] },
          { path: "/'G'/'note'", index: { type: TYPE.string, count: 1, stringBytes: text.length } },
        ],
        data: concat(values.done(), text.done()),
      }),
    );
    const imp = tdmsMeasurement(file, { maxPoints: 100 });
    expect(imp.thinned).toBe(10);
    expect(imp.data.traces[0].x.length).toBe(100);
    expect(imp.data.traces[0].y[99]).toBe(990);
    expect(imp.skipped).toEqual(['note']);
  });

  it('a file with nothing to plot is an error', () => {
    const file = parseTdms(segment({ newList: true, objects: [{ path: "/'G'", index: 'none' }] }));
    expect(() => tdmsMeasurement(file)).toThrow(TdmsError);
  });

  it('CSV text reads back through the measurement reader and plays as a source', () => {
    const csv = tdmsToCsv(waveform);
    expect(csv.labels).toEqual(['Vin', 'Iin']);
    expect(csv.rows).toBe(5);
    expect(csv.text.split('\n')[0]).toBe('time [s],Vin [V],Iin [A]');
    const back = parseMeasurement(csv.text, 'x.csv');
    expect(back.traces.map((t) => t.label)).toEqual(['Vin', 'Iin']);
    expect(Array.from(back.traces[1].y)).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
    const play = measurementPlayback(csv.text, 1, 1, 2, 0, 0);
    // vscale 2: the voltages 0..4 become 0..8; the source plays from t = 0 at the spacing of the file
    expect(play.pairs.filter((_, i) => i % 2 === 1)).toEqual([0, 2, 4, 6, 8]);
    expect(play.pairs[0]).toBe(0);
    expect(play.pairs[8]).toBeCloseTo(0.008, 12);
  });

  it('CSV leaves out a channel with another length and names it', () => {
    const file = parseTdms(
      segment({
        newList: true,
        objects: [
          { path: "/'G'/'a'", index: { type: TYPE.f64, count: 3 }, props: [['wf_increment', TYPE.f64, 1]] },
          { path: "/'G'/'b'", index: { type: TYPE.f64, count: 3 }, props: [['wf_increment', TYPE.f64, 1]] },
        ],
        data: f64s(1, 2, 3, 4, 5, 6),
      }),
    );
    expect(tdmsToCsv(file).labels).toEqual(['a', 'b']);
    const file2 = parseTdms(
      concat(
        segment({ newList: true, objects: [{ path: "/'G'/'a'", index: { type: TYPE.f64, count: 3 }, props: [['wf_increment', TYPE.f64, 1]] }, { path: "/'G'/'b'", index: { type: TYPE.f64, count: 3 }, props: [['wf_increment', TYPE.f64, 0.5]] }], data: f64s(1, 2, 3, 4, 5, 6) }),
      ),
    );
    const csv = tdmsToCsv(file2);
    expect(csv.labels).toEqual(['a']);
    expect(csv.skipped).toEqual(['b']);
  });
});
