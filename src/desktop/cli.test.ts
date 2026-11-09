import { describe, expect, it } from 'vitest';
import { argumentPaths, formatOf, isBatchInvocation, parseCliArgs } from './cli';

describe('command-line arguments', () => {
  it('reads the documented batch call', () => {
    const r = parseCliArgs(['--batch', 'file.msim', '--analysis', 'tran', '--out', 'results.csv']);
    expect(r).toEqual({ ok: true, options: { input: 'file.msim', analysis: 'tran', out: 'results.csv', set: {}, erc: false, quiet: false } });
  });

  it('accepts --name=value, repeated --set, numbers with SPICE suffixes, flags and the language', () => {
    const r = parseCliArgs(['--batch=deck.cir', '--tstop=10m', '--tstep', '1u', '--set', 'R=4.7k', '--set=C=10n', '--erc', '--quiet', '--format', 'JSON', '--lang', 'en', '--log', 'run.log', '--netlist', 'out.cir']);
    expect(r.ok && !r.help && r.options).toEqual({ input: 'deck.cir', tstop: 10e-3, tstep: 1e-6, set: { R: '4.7k', C: '10n' }, erc: true, quiet: true, format: 'json', lang: 'en', log: 'run.log', netlist: 'out.cir' });
  });

  it('takes the input as a bare argument after a value-less --batch', () => {
    const r = parseCliArgs(['--batch', '--out', 'x.json', 'design.msim']);
    expect(r.ok && !r.help && r.options.input).toBe('design.msim');
    expect(r.ok && !r.help && r.options.out).toBe('x.json');
  });

  it('defaults the format of an unknown output extension to CSV', () => {
    const r = parseCliArgs(['--batch', 'a.msim', '--out', 'result.dat']);
    expect(r.ok && !r.help && r.options.format).toBe('csv');
    expect(formatOf('r.CSV')).toBe('csv');
    expect(formatOf('r.txt')).toBe('text');
    expect(formatOf('r.json')).toBe('json');
    expect(formatOf('r.dat')).toBeUndefined();
  });

  it('reports every kind of mistake with the offending text', () => {
    expect(parseCliArgs(['--analysis', 'tran'])).toEqual({ ok: false, error: 'missingInput', detail: '--batch' });
    expect(parseCliArgs(['--batch', 'a.msim', '--analysis', 'bode'])).toEqual({ ok: false, error: 'badAnalysis', detail: 'bode' });
    expect(parseCliArgs(['--batch', 'a.msim', '--frobnicate'])).toEqual({ ok: false, error: 'unknownOption', detail: '--frobnicate' });
    expect(parseCliArgs(['--batch', 'a.msim', '--out'])).toEqual({ ok: false, error: 'missingValue', detail: '--out' });
    expect(parseCliArgs(['--batch', 'a.msim', '--tstop', '-1'])).toEqual({ ok: false, error: 'badNumber', detail: '--tstop -1' });
    expect(parseCliArgs(['--batch', 'a.msim', '--set', 'R'])).toEqual({ ok: false, error: 'badSet', detail: 'R' });
    expect(parseCliArgs(['--batch', 'a.msim', '--format', 'xml'])).toEqual({ ok: false, error: 'badFormat', detail: 'xml' });
    expect(parseCliArgs(['--batch', 'a.msim', '--lang', 'fr'])).toEqual({ ok: false, error: 'badLang', detail: 'fr' });
    expect(parseCliArgs(['--batch', 'a.msim', 'b.msim'])).toEqual({ ok: false, error: 'extraArgument', detail: 'b.msim' });
  });

  it('recognises help and ignores Chromium switches', () => {
    expect(parseCliArgs(['--help'])).toEqual({ ok: true, help: true });
    expect(parseCliArgs(['/?'])).toEqual({ ok: true, help: true });
    const r = parseCliArgs(['--enable-logging', '--batch', 'a.msim', '--no-sandbox']);
    expect(r.ok && !r.help && r.options.input).toBe('a.msim');
  });

  it('tells batch invocations from normal starts and lists the paths named', () => {
    expect(isBatchInvocation(['--batch', 'a.msim'])).toBe(true);
    expect(isBatchInvocation(['-h'])).toBe(true);
    expect(isBatchInvocation(['design.msim'])).toBe(false);
    expect(isBatchInvocation(['--smoke'])).toBe(false);
    expect(argumentPaths(['--batch', 'in.msim', '--out', 'o.csv', '--netlist', 'n.cir', '--log', 'l.txt', '--set', 'R=1k'])).toEqual(['in.msim', 'o.csv', 'n.cir', 'l.txt']);
  });
});
