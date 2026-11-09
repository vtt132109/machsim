import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import { EXIT } from '../desktop/cli';
import { isScriptInvocation, parseScriptArgs, runScriptCli, type ScriptCliOptions } from './cli';
import { nodeWorkerFactory } from './nodeWorker';

function opts(extra: Partial<ScriptCliOptions> = {}): ScriptCliOptions {
  return { script: 'job.js', timeoutSec: 20, quiet: false, args: [], lang: 'en', ...extra };
}

/** In-memory command-line environment: only the files named in `allowed` may be read or written. */
function env(files: Record<string, string>, allowed: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const written: Record<string, string> = {};
  const io = {
    readFile: async (p: string) => {
      if (!allowed.includes(p)) throw new Error('path not named on the command line');
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    writeFile: async (p: string, text: string) => {
      if (!allowed.includes(p)) throw new Error('path not named on the command line');
      written[p] = text;
    },
    runNetlist: (n: Parameters<typeof runAnalyses>[0]) => runAnalyses(n),
    log: (line: string, stream: 'out' | 'err') => (stream === 'out' ? out : err).push(line),
    createWorker: nodeWorkerFactory,
    workerKind: 'node' as const,
  };
  return { io, out, err, written };
}

describe('script command line: arguments', () => {
  it('recognises --script and splits options from script arguments', () => {
    expect(isScriptInvocation(['--script', 'a.js'])).toBe(true);
    expect(isScriptInvocation(['--script=a.js'])).toBe(true);
    expect(isScriptInvocation(['--batch', 'a.msim'])).toBe(false);
    const r = parseScriptArgs(['--script', 'gain.js', '--lang', 'en', '--timeout=30', 'in.msim', 'out.csv', '--log', 'run.txt', '--quiet']);
    expect(r).toEqual({ ok: true, options: { script: 'gain.js', lang: 'en', timeoutSec: 30, log: 'run.txt', quiet: true, args: ['in.msim', 'out.csv'] } });
  });

  it('reports usage problems', () => {
    expect(parseScriptArgs(['a.js'])).toMatchObject({ ok: false, error: 'missingScript' });
    expect(parseScriptArgs(['--script'])).toMatchObject({ ok: false, error: 'missingValue' });
    expect(parseScriptArgs(['--script', 'a.js', '--timeout', 'abc'])).toMatchObject({ ok: false, error: 'badNumber' });
    expect(parseScriptArgs(['--script', 'a.js', '--lang', 'fr'])).toMatchObject({ ok: false, error: 'badLang' });
    expect(parseScriptArgs(['--help'])).toEqual({ ok: true, help: true });
  });

  it('ignores switches Electron adds', () => {
    const r = parseScriptArgs(['--script', 'a.js', '--enable-logging', 'x']);
    expect(r).toMatchObject({ ok: true, options: { args: ['x'] } });
  });
});

describe('script command line: exit codes and output', () => {
  it('runs a script, prints to standard output and exits 0', async () => {
    const e = env({ 'job.js': `print('hello', 1 + 2); return 5;` }, ['job.js']);
    const code = await runScriptCli(opts(), e.io);
    expect(code).toBe(EXIT.ok);
    expect(e.out).toContain('hello 3');
    expect(e.err).toEqual([]);
  });

  it('builds, simulates and writes the result file named on the command line', async () => {
    const script = `
      await MachSim.newDesign('d');
      await MachSim.place('dc-voltage', 100, 200, { value: '12' });
      await MachSim.place('resistor', 200, 150, { value: '1k' });
      await MachSim.place('resistor', 300, 200, { value: '2k', rotation: 90 });
      await MachSim.net('a', 'V1.+', 'R1.1'); await MachSim.net('b', 'R1.2', 'R2.1');
      await MachSim.ground('V1.-'); await MachSim.ground('R2.2');
      const op = await MachSim.run('op');
      await MachSim.saveText(MachSim.args[0], 'vb,' + op.get('b')[0] + '\\n');
      print('vb =', op.get('b')[0]);`;
    const e = env({ 'job.js': script }, ['job.js', 'result.csv']);
    const code = await runScriptCli(opts({ args: ['result.csv'] }), e.io);
    expect(e.err).toEqual([]);
    expect(code).toBe(EXIT.ok);
    // 12 V · 2k / (1k + 2k) = 8 V
    expect(Number(e.written['result.csv'].split(',')[1])).toBeCloseTo(8, 9);
    expect(e.out.some((l) => l.startsWith('vb = 8'))).toBe(true);
    expect(e.out).toContain('Wrote result.csv');
  });

  it('a file that was not named on the command line cannot be written (exit 3, nothing written)', async () => {
    const e = env({ 'job.js': `await MachSim.saveText('secret.txt', 'x');` }, ['job.js']);
    const code = await runScriptCli(opts(), e.io);
    expect(code).toBe(EXIT.file);
    expect(e.written).toEqual({});
    expect(e.err.join('\n')).toMatch(/command line/);
  });

  it('a missing script file exits 3', async () => {
    const e = env({}, ['job.js']);
    expect(await runScriptCli(opts(), e.io)).toBe(EXIT.file);
    expect(e.err[0]).toMatch(/job\.js/);
  });

  it('a script error exits 1 with the message and the line', async () => {
    const e = env({ 'job.js': `print('before');\nconst x = 1;\nthrow new Error('boom');` }, ['job.js']);
    const code = await runScriptCli(opts(), e.io);
    expect(code).toBe(EXIT.failed);
    expect(e.err.join('\n')).toMatch(/boom/);
    expect(e.err.join('\n')).toMatch(/line 3/);
    expect(e.out).toContain('before');
  });

  it('errors and warnings go to standard error, and the time limit exits 1', async () => {
    const e = env({ 'job.js': `console.error('bad'); console.warn('careful'); await MachSim.sleep(3000);` }, ['job.js']);
    const code = await runScriptCli(opts({ timeoutSec: 0.3 }), e.io);
    expect(code).toBe(EXIT.failed);
    expect(e.err).toContain('bad');
    expect(e.err).toContain('careful');
    expect(e.err.join('\n')).toMatch(/stopped/);
  });

  it('works in Vietnamese', async () => {
    const e = env({ 'job.js': `throw new Error('x');` }, ['job.js']);
    await runScriptCli(opts({ lang: 'vi' }), e.io);
    expect(e.err.join('\n')).toMatch(/Tập lệnh lỗi/);
  });
});
