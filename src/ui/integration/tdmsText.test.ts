import { describe, expect, it } from 'vitest';
import { tdmsFileToCsv } from './tdmsText';
import { tdmsNotes, tdmsReason } from './tdmsFlow';
import { TdmsError } from '../../util/tdms';
import { parseMeasurement } from '../../util/traceImport';

/** A one-segment file with one float64 channel "V" (3 values) and the given properties. */
function tinyFile(props: boolean): Uint8Array {
  const meta: number[] = [];
  const u32 = (a: number[], v: number) => a.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255);
  const str = (a: number[], s: string) => {
    const b = new TextEncoder().encode(s);
    u32(a, b.length);
    a.push(...b);
  };
  u32(meta, 1);
  str(meta, "/'G'/'V'");
  u32(meta, 20);
  u32(meta, 10);
  u32(meta, 1);
  u32(meta, 3);
  u32(meta, 0); // count high word
  if (props) {
    u32(meta, 2);
    str(meta, 'unit_string');
    u32(meta, 0x20);
    str(meta, 'V');
    str(meta, 'wf_increment');
    u32(meta, 10);
    meta.push(...new Uint8Array(new Float64Array([0.5]).buffer));
  } else u32(meta, 0);
  const data = [...new Uint8Array(new Float64Array([1, 2, 3]).buffer)];
  const lead: number[] = [0x54, 0x44, 0x53, 0x6d];
  u32(lead, 0x0e);
  u32(lead, 4713);
  u32(lead, meta.length + data.length);
  u32(lead, 0);
  u32(lead, meta.length);
  u32(lead, 0);
  return Uint8Array.from([...lead, ...meta, ...data]);
}

describe('TDMS in the interface', () => {
  it('a file becomes the CSV text a source part keeps, with a note', () => {
    const r = tdmsFileToCsv(tinyFile(true), 'run.tdms');
    expect(r.text.split('\n')).toEqual(['time [s],V [V]', '0,1', '0.5,2', '1,3']);
    expect(r.note).toContain('run.tdms');
    expect(r.note).toContain('1');
    // and the text reads back as a measurement
    const back = parseMeasurement(r.text, 'x.csv');
    expect(Array.from(back.traces[0].y)).toEqual([1, 2, 3]);
  });

  it('a file without time information says the axis is the sample number', () => {
    const r = tdmsFileToCsv(tinyFile(false), 'plain.tdms');
    expect(r.text.split('\n')[1]).toBe('0,1');
    expect(r.note.length).toBeGreaterThan(40);
  });

  it('something that is not a TDMS file gives a reason and no text', () => {
    const r = tdmsFileToCsv(new TextEncoder().encode('time,v\n0,1\n'), 'oops.tdms');
    expect(r.text).toBe('');
    expect(r.note).toContain('oops.tdms');
  });

  it('explains the reasons and the notes', () => {
    expect(tdmsReason(new TdmsError('daqmx', 'x'))).toMatch(/DAQmx/);
    expect(tdmsReason(new TdmsError('not-tdms', 'x')).length).toBeGreaterThan(5);
    expect(tdmsReason(new Error('boom'))).toBe('boom');
    expect(tdmsNotes({ axis: 'waveform', thinned: 1, skipped: [], warnings: [] })).toEqual([]);
    expect(tdmsNotes({ axis: 'index', thinned: 4, skipped: ['a', 'b'], warnings: [{ code: 'scaling-ignored' }, { code: 'truncated-data' }] })).toHaveLength(5);
  });
});
