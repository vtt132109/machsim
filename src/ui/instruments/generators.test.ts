import { describe, expect, it } from 'vitest';
import { generatorWaveform, parseWordPattern } from '../../library/parts/instruments';
import { FGEN_DEFAULTS, fgenSample, fgenSettings, fgenSpiceWaveform, validateFgen } from './fgen';
import { addressAt, bitPwl, formatPattern, parsePattern, parseWordGenSettings, patternPreset, wordAt, wordToBinary } from './wordgen';

describe('function generator', () => {
  it('validates every field', () => {
    expect(validateFgen(FGEN_DEFAULTS)).toEqual([]);
    const keys = validateFgen({ waveform: 'saw', freq: '0', duty: '100', amplitude: '-1', offset: 'x', risetime: '0' }).map((e) => e.key);
    expect(keys).toEqual(['waveform', 'freq', 'duty', 'amplitude', 'offset', 'risetime']);
    // 1 ms rise time on a 1 kHz square with 50 % duty is longer than half a pulse
    expect(validateFgen({ ...FGEN_DEFAULTS, waveform: 'square', risetime: '1m' }).map((e) => e.key)).toEqual(['risetime']);
  });

  it('parses settings with fallbacks', () => {
    expect(fgenSettings({ waveform: 'Square', freq: '2k', duty: '25', amplitude: '3', offset: '1', risetime: '1u' })).toEqual({
      waveform: 'square',
      freq: 2000,
      duty: 0.25,
      amplitude: 3,
      offset: 1,
      risetime: 1e-6,
    });
    expect(fgenSettings({ freq: '-3', duty: '0' })).toMatchObject({ waveform: 'sine', freq: 1000, duty: 0.5 });
  });

  it('produces the ideal waveforms', () => {
    const sine = fgenSettings({ waveform: 'sine', freq: '1k', amplitude: '2', offset: '0.5' });
    expect(fgenSample(sine, 0.25e-3)).toBeCloseTo(2.5, 12);
    expect(fgenSample(sine, 0.75e-3)).toBeCloseTo(-1.5, 12);
    const tri = fgenSettings({ waveform: 'triangle', freq: '1k', duty: '25', amplitude: '1', offset: '0' });
    expect(fgenSample(tri, 0)).toBeCloseTo(-1, 12);
    expect(fgenSample(tri, 0.25e-3)).toBeCloseTo(1, 12);
    expect(fgenSample(tri, 0.625e-3)).toBeCloseTo(0, 12);
    const sq = fgenSettings({ waveform: 'square', freq: '1k', duty: '50', amplitude: '5', offset: '0', risetime: '10u' });
    expect(fgenSample(sq, 5e-6)).toBeCloseTo(0, 12);
    expect(fgenSample(sq, 0.2e-3)).toBe(5);
    expect(fgenSample(sq, 0.7e-3)).toBe(-5);
    // periodic
    expect(fgenSample(sq, 1.2e-3)).toBe(5);
  });

  it('emits the same SPICE waveform as the library part', () => {
    for (const p of [
      { waveform: 'sine', freq: '1k', duty: '50', amplitude: '2', offset: '0.5', risetime: '1n' },
      { waveform: 'triangle', freq: '500', duty: '30', amplitude: '1', offset: '0', risetime: '1n' },
      { waveform: 'square', freq: '10k', duty: '20', amplitude: '5', offset: '2.5', risetime: '100n' },
    ]) {
      const mine = fgenSpiceWaveform(fgenSettings(p));
      const lib = generatorWaveform(p).tran;
      expect(mine.type).toBe(lib.type);
      mine.args.forEach((a, i) => expect(a).toBeCloseTo(lib.args[i], 15));
    }
  });
});

describe('word generator', () => {
  it('parses and formats hex patterns', () => {
    expect(parsePattern('0000, 0x00ff ,ABCD;1', 16)).toEqual({ words: [0, 0xff, 0xabcd, 1], errors: [] });
    const bad = parsePattern('12,zz,3', 8);
    expect(bad.words).toEqual([0x12, 0, 3]);
    expect(bad.errors).toHaveLength(1);
    expect(parsePattern('1FF', 8).words).toEqual([0xff]);
    expect(formatPattern([0, 0xff, 0xabcd], 16)).toBe('0000,00FF,ABCD');
    expect(formatPattern([5], 5)).toBe('05');
    expect(wordToBinary(5, 4)).toBe('0101');
    // agrees with the library's parser for the netlist
    expect(parseWordPattern(formatPattern([1, 2, 0xfffe], 16), 16)).toEqual([1, 2, 0xfffe]);
  });

  it('generates preset patterns', () => {
    expect(patternPreset('up', 4, 8)).toEqual([0, 1, 2, 3]);
    expect(patternPreset('down', 3, 8)).toEqual([255, 254, 253]);
    expect(patternPreset('shift-left', 5, 4)).toEqual([1, 2, 4, 8, 1]);
    expect(patternPreset('shift-right', 3, 4)).toEqual([8, 4, 2]);
    expect(patternPreset('alternate', 2, 8)).toEqual([0x55, 0xaa]);
    expect(patternPreset('clear', 2, 8)).toEqual([0, 0]);
  });

  it('sequences addresses in cycle, burst and step mode', () => {
    const base = { pattern: '10,20,30,40', freq: '1k', start: '1', end: '3' };
    const cyc = parseWordGenSettings({ ...base, mode: 'cycle' });
    expect([0, 1, 2, 3, 4].map((k) => addressAt(cyc, k * 1e-3 + 1e-7))).toEqual([1, 2, 3, 1, 2]);
    expect(wordAt(cyc, 1.5e-3)).toBe(0x30);
    const burst = parseWordGenSettings({ ...base, mode: 'burst' });
    expect([0, 1, 2, 3, 10].map((k) => addressAt(burst, k * 1e-3 + 1e-7))).toEqual([1, 2, 3, 3, 3]);
    const step = parseWordGenSettings({ ...base, mode: 'step', pos: '2' });
    expect(addressAt(step, 5)).toBe(2);
    // out-of-range addresses are clamped
    expect(parseWordGenSettings({ pattern: '1,2', end: '9', start: '-3', pos: '7' })).toMatchObject({ start: 0, end: 1, pos: 1 });
  });

  it('builds per-bit PWL waveforms with edges at word boundaries', () => {
    const s = parseWordGenSettings({ pattern: '1,0,1,1', freq: '1k', mode: 'cycle' });
    const w = bitPwl(s, 0, 0, 5, 4e-3, 1e-6);
    expect(w.type).toBe('PWL');
    // high, falls at 1 ms, rises at 2 ms, then stays high: word 3 and the wrapped word 0 are both 1
    expect(w.args).toEqual([0, 5, 1e-3, 5, 1e-3 + 1e-6, 0, 2e-3, 0, 2e-3 + 1e-6, 5]);
    const bit1 = bitPwl(s, 1, 0, 5, 4e-3);
    expect(bit1.args).toEqual([0, 0]);
  });
});
