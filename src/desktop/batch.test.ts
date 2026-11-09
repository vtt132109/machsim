/**
 * Batch runs (the engine of MachSim.exe --batch): designs and SPICE decks through an in-memory
 * file system and the real simulator; checks the numbers in the written CSV / JSON / text files
 * and the exit codes.
 */
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import { DesignBuilder } from '../model/designkit';
import { serializeDesign } from '../model/serialize';
import { parseTracesText } from '../util/measurementText';
import { parseCliArgs, type CliOptions } from './cli';
import { runBatch, type BatchIO } from './batch';

function fs(files: Record<string, string>) {
  const written: Record<string, string> = {};
  const log: { line: string; level: string }[] = [];
  const io: BatchIO = {
    readFile: async (p) => {
      if (!(p in files)) throw new Error('ENOENT');
      return files[p];
    },
    writeFile: async (p, t) => {
      if (p.startsWith('readonly/')) throw new Error('EACCES');
      written[p] = t;
    },
    readInclude: async (rel) => files[rel] ?? null,
    run: (n) => runAnalyses(n),
    log: (line, level) => log.push({ line, level }),
    now: () => new Date('2026-11-09T00:00:00Z'),
  };
  return { io, written, log };
}

function opts(argv: string[]): CliOptions {
  const r = parseCliArgs(argv);
  if (!r.ok || r.help) throw new Error('bad args');
  return r.options;
}

function divider(r2 = '4.7k') {
  const b = new DesignBuilder('Divider');
  const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 100, -60, { value: '10k' });
  const r2p = b.part('basic/resistor', 'R2', 200, 0, { value: '{R}' }, { rotation: 90 });
  b.part('sources/ground', 'G1', 0, 100);
  b.labelPin(v1, '+', 'IN');
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'OUT');
  b.labelPin(r2p, '1', 'OUT');
  b.labelPin(r2p, '2', '0');
  b.labelPin(v1, '-', '0');
  b.design.variables = { R: r2 };
  b.design.analysis = { active: 'op', specs: { op: { type: 'op' }, dc: { type: 'dc', src: 'V1', start: 0, stop: 12, step: 6 }, tran: { type: 'tran', tstep: 1e-4, tstop: 1e-3 } } };
  return serializeDesign(b.design);
}

const csvRows = (text: string) => text.trim().split(/\r?\n/).map((l) => l.split(','));

describe('batch runs', () => {
  it('runs the design’s active analysis and writes the operating point as CSV', async () => {
    const { io, written } = fs({ 'd.msim': divider() });
    const r = await runBatch(opts(['--batch', 'd.msim', '--out', 'r.csv']), io);
    expect(r.code).toBe(0);
    const rows = csvRows(written['r.csv']);
    expect(rows[0]).toEqual(['name', 'value', 'unit']);
    const out = rows.find((x) => x[0] === 'V(OUT)')!;
    expect(Number(out[1])).toBeCloseTo((12 * 4.7) / 14.7, 9);
  });

  it('--set changes a design variable and --analysis dc sweeps the source', async () => {
    const { io, written } = fs({ 'd.msim': divider() });
    const r = await runBatch(opts(['--batch', 'd.msim', '--analysis', 'dc', '--set', 'R=10k', '--out', 'sweep.json']), io);
    expect(r.code).toBe(0);
    const j = JSON.parse(written['sweep.json']);
    expect(j.format).toBe('machsim-results');
    expect(j.date).toBe('2026-11-09T00:00:00.000Z');
    const dc = j.analyses[0];
    expect(dc.type).toBe('dc');
    expect(dc.scale.values).toEqual([0, 6, 12]);
    expect(dc.vectors.find((v: { name: string }) => v.name === 'V(OUT)').values).toEqual([0, 3, 6].map((x) => expect.closeTo(x, 9)));
  });

  it('--tstop overrides the transient and the text format is MachSim measurement text', async () => {
    const { io, written } = fs({ 'd.msim': divider() });
    const r = await runBatch(opts(['--batch', 'd.msim', '--analysis', 'tran', '--tstop', '2m', '--out', 'wave.txt']), io);
    expect(r.code).toBe(0);
    const back = parseTracesText(written['wave.txt']);
    const out = back.traces.find((tr) => tr.label === 'V(OUT)')!;
    expect(out.x[out.x.length - 1]).toBeCloseTo(2e-3, 12);
    expect(out.y[0]).toBeCloseTo((12 * 4.7) / 14.7, 9);
  });

  it('runs every analysis card of a SPICE deck, reading its .include file, and writes AC magnitude / phase', async () => {
    const deck = `RC
.include models.inc
V1 in 0 AC 1
R1 in out {RV}
C1 out 0 100n
.ac dec 5 100 100k
.op
.end`;
    const { io, written } = fs({ 'rc.cir': deck, 'models.inc': '.param RV=1.6k\n' });
    const r = await runBatch(opts(['--batch', 'rc.cir', '--out', 'ac.csv', '--netlist', 'copy.cir']), io);
    expect(r.code).toBe(0);
    expect(r.results.map((x) => x.type)).toEqual(['ac', 'op']);
    const lines = written['ac.csv'].split('\r\n');
    const head = lines[1].split(',');
    expect(head.slice(0, 2)).toEqual(['frequency', 'mag(V(in))']);
    const iMag = head.indexOf('mag(V(out))');
    const iPh = head.indexOf('ph(V(out))');
    const row1k = lines.find((l) => /^1000,/.test(l))!.split(',');
    const fc = 1 / (2 * Math.PI * 1.6e3 * 100e-9);
    expect(Number(row1k[iMag])).toBeCloseTo(1 / Math.hypot(1, 1000 / fc), 6);
    expect(Number(row1k[iPh])).toBeCloseTo((-Math.atan(1000 / fc) * 180) / Math.PI, 4);
    expect(written['copy.cir']).toMatch(/^RC/);
  });

  it('logs and writes the .meas values of a deck (CSV table, JSON field, text table), also per .step run', async () => {
    const deck = `RC step
.param rv=1k
V1 in 0 PULSE(0 1 0 1n 1n 1 2)
R1 in out {rv}
C1 out 0 1u
.tran 10u 5m
.step param rv list 1k 2k
.meas TRAN tau WHEN V(out)=0.632120559
.meas TRAN never WHEN V(out)=7
.end`;
    const { io, written, log } = fs({ 'rc.cir': deck });
    const r = await runBatch(opts(['--batch', 'rc.cir', '--out', 'm.csv']), io);
    expect(r.code).toBe(0);
    const lines = log.map((l) => l.line);
    const tau = lines.filter((l) => /\.meas .*tau = /.test(l));
    expect(tau).toHaveLength(2);
    expect(Number(tau[0].split('= ')[1])).toBeCloseTo(1e-3, 5);
    expect(Number(tau[1].split('= ')[1])).toBeCloseTo(2e-3, 5);
    expect(lines.some((l) => /never: not measured/.test(l) || /never: không đo được/.test(l))).toBe(true);
    const csv = written['m.csv'];
    expect(csv).toMatch(/rv=2000 — \.meas/);
    expect(csv).toMatch(/name,value,at,error/);
    const json = fs({ 'rc.cir': deck });
    await runBatch(opts(['--batch', 'rc.cir', '--out', 'm.json']), json.io);
    const parsed = JSON.parse(json.written['m.json']);
    const m0 = parsed.analyses[0].runs[0].result.measurements;
    expect(m0[0].name).toBe('tau');
    expect(m0[0].value).toBeCloseTo(1e-3, 5);
    expect(m0[1].value).toBeNull();
    const text = fs({ 'rc.cir': deck });
    await runBatch(opts(['--batch', 'rc.cir', '--out', 'm.txt', '--format', 'text']), text.io);
    expect(text.written['m.txt']).toMatch(/name\tvalue\tat\terror/);
  });

  it('only runs the requested analysis of a deck and fails when it has none', async () => {
    const deck = 'D\nV1 a 0 1\nR1 a 0 1k\n.op\n.end\n';
    const ok = fs({ 'd.cir': deck });
    expect((await runBatch(opts(['--batch', 'd.cir', '--analysis', 'op']), ok.io)).results).toHaveLength(1);
    const bad = fs({ 'd.cir': deck });
    expect((await runBatch(opts(['--batch', 'd.cir', '--analysis', 'tran']), bad.io)).code).toBe(1);
  });

  it('exit codes: missing input file 3, invalid design 3, ERC error 1, unwritable output 3, deck syntax error 1', async () => {
    expect((await runBatch(opts(['--batch', 'none.msim']), fs({}).io)).code).toBe(3);
    expect((await runBatch(opts(['--batch', 'x.msim']), fs({ 'x.msim': '{"format":"machsim-design","version":2,"sheets":7}' }).io)).code).toBe(3);
    // no ground: ERC error, the run is refused
    const b = new DesignBuilder('floating');
    const v = b.part('sources/dc-voltage', 'V1', 0, 0);
    const r1 = b.part('basic/resistor', 'R1', 100, 0);
    b.labelPin(v, '+', 'A');
    b.labelPin(r1, '1', 'A');
    b.labelPin(v, '-', 'B');
    b.labelPin(r1, '2', 'B');
    const f = fs({ 'f.msim': serializeDesign(b.design) });
    expect((await runBatch(opts(['--batch', 'f.msim']), f.io)).code).toBe(1);
    expect(f.log.some((l) => l.level === 'error' && /ground/i.test(l.line))).toBe(true);
    expect((await runBatch(opts(['--batch', 'd.msim', '--out', 'readonly/r.csv']), fs({ 'd.msim': divider() }).io)).code).toBe(3);
    expect((await runBatch(opts(['--batch', 'bad.cir']), fs({ 'bad.cir': 'T\nR1 a\n.end\n' }).io)).code).toBe(1);
  });

  it('--erc checks only and writes the messages', async () => {
    const { io, written } = fs({ 'd.msim': divider() });
    const r = await runBatch(opts(['--batch', 'd.msim', '--erc', '--out', 'erc.csv']), io);
    expect(r.code).toBe(0);
    expect(r.results).toEqual([]);
    expect(written['erc.csv'].split('\r\n')[0]).toBe('severity,code,message,refdes,net');
  });
});
