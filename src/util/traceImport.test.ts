import { describe, expect, it } from 'vitest';
import { tracesToText } from './measurementText';
import { measurementResult, MeasurementError, parseMeasurement, splitHeader, unitScale } from './traceImport';

describe('measurement file import', () => {
  it('reads oscilloscope-style CSV with units in the header and scales prefixed units', () => {
    const csv = ['# scope export', 'Time (us),CH1 (V),CH2 (mV)', '0,0,0', '10,1.5,250', '20,3,500', ''].join('\r\n');
    const m = parseMeasurement(csv, 'scope.csv');
    expect(m.title).toBe('scope');
    expect(m.xKind).toBe('time');
    expect(m.traces.map((t) => [t.label, t.unit])).toEqual([['CH1', 'V'], ['CH2', 'V']]);
    [0, 10e-6, 20e-6].forEach((x, i) => expect(m.traces[0].x[i]).toBeCloseTo(x, 15));
    expect(Array.from(m.traces[1].y)).toEqual([0, 0.25, 0.5]);
    const r = measurementResult(m, 'scope.csv');
    expect(r.type).toBe('tran');
    expect(r.scale!.unit).toBe('s');
    expect(r.vectors.map((v) => v.unit)).toEqual(['V', 'V']);
  });

  it('reads semicolon files with Vietnamese decimal commas and a frequency column', () => {
    const text = ['Tần số [Hz];Biên độ [dB];Pha [deg]', '10;0;-0,5', '100;-0,04;-5,7', '1000;-3,01;-45', '10000;-20,04;-84,3'].join('\n');
    const m = parseMeasurement(text, 'bode.csv');
    expect(m.xKind).toBe('frequency');
    expect(m.traces.map((t) => t.label)).toEqual(['Biên độ', 'Pha']);
    expect(Array.from(m.traces[0].y)).toEqual([0, -0.04, -3.01, -20.04]);
    const r = measurementResult(m, 'bode.csv');
    expect(r.type).toBe('ac');
    expect(r.vectors[0].im).toBeUndefined();
    expect(r.vectors.map((v) => v.unit)).toEqual(['dB', 'deg']);
  });

  it('reads whitespace columns without a header as a sweep, and text with ***End_of_Header*** blocks', () => {
    const m = parseMeasurement('0 0\n0.5 0.1\n1 0.9\n', 'iv.dat');
    expect(m.xKind).toBe('sweep');
    expect(m.traces[0].label).toBe('y1');
    expect(measurementResult(m, 'iv').type).toBe('dc');
    const lvm = ['LabVIEW Measurement\t', 'Writer_Version\t2', '***End_of_Header***', '', 'Channels\t1', '***End_of_Header***', 'X_Value\tVoltage', '0\t1', '0.001\t2', ''].join('\r\n');
    const t = parseMeasurement(lvm, 'log.lvm');
    expect(t.xKind).toBe('time');
    expect(Array.from(t.traces[0].y)).toEqual([1, 2]);
  });

  it('round-trips the MachSim measurement text the Grapher exports', () => {
    const text = tracesToText(
      [
        { label: 'V(out)', unit: 'V', x: [0, 1e-3, 2e-3], y: [0, 1, 2] },
        { label: 'I(R1)', unit: 'A', x: [0, 2e-3], y: [1e-3, 3e-3] },
      ],
      { title: 'tran1', xLabel: 'Time', xUnit: 's', date: new Date(0) },
    );
    const m = parseMeasurement(text, 'x.txt');
    expect(m.title).toBe('tran1');
    expect(m.xKind).toBe('time');
    const r = measurementResult(m, 'x');
    expect(Array.from(r.scale!.re)).toEqual([0, 1e-3, 2e-3]);
    expect(Array.from(r.vectors[1].re)).toEqual([1e-3, 2e-3, 3e-3]);
  });

  it('resamples traces on different x samples onto one scale (NaN outside their range)', () => {
    const r = measurementResult(
      { title: 't', xKind: 'time', xLabel: 't', xUnit: 's', skipped: [], traces: [{ label: 'a', unit: 'V', x: [0, 2], y: [0, 2] }, { label: 'b', unit: 'V', x: [1, 2], y: [5, 6] }] },
      't',
    );
    expect(Array.from(r.scale!.re)).toEqual([0, 1, 2]);
    expect(Array.from(r.vectors[0].re)).toEqual([0, 1, 2]);
    expect(Number.isNaN(r.vectors[1].re[0])).toBe(true);
    expect(Array.from(r.vectors[1].re.subarray(1))).toEqual([5, 6]);
  });

  it('sorts descending files, skips broken lines and reports files without numbers', () => {
    const m = parseMeasurement('x,y\n3,30\n2,20\nbroken line\n1,10\n', 'd.csv');
    expect(Array.from(m.traces[0].x)).toEqual([1, 2, 3]);
    expect(m.skipped).toEqual([4]);
    expect(() => parseMeasurement('hello\nworld\n', 'a.txt')).toThrow(MeasurementError);
    expect(() => parseMeasurement('', 'a.txt')).toThrow(MeasurementError);
  });

  it('splits header units and knows unit prefixes', () => {
    expect(splitHeader('V(out) [V]')).toEqual({ name: 'V(out)', unit: 'V' });
    expect(splitHeader('V(out)')).toEqual({ name: 'V(out)', unit: '' });
    expect(splitHeader('time (us)')).toEqual({ name: 'time', unit: 'us' });
    expect(unitScale('kHz')).toEqual({ unit: 'Hz', factor: 1e3 });
    expect(unitScale('mA')).toEqual({ unit: 'A', factor: 1e-3 });
    expect(unitScale('Ω')).toEqual({ unit: 'Ohm', factor: 1 });
    expect(unitScale('furlong')).toEqual({ unit: '', factor: 1 });
  });
});
