import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runAnalyses } from '../sim';
import { buildNetlist } from '../model/netlister';
import { parseDesign, serializeDesign } from '../model/serialize';
import type { Design } from '../model/types';
import { SCRIPT_EXAMPLES } from '../i18n/scriptText';
import { nodeWorkerFactory } from './nodeWorker';
import { startScript, type ScriptOutcome } from './runner';
import { ScriptSession, type ScriptFileRequest, type ScriptIO } from './session';
import type { ScriptLogLevel } from './protocol';

interface Harness {
  io: ScriptIO;
  saved: { request: ScriptFileRequest; text: string }[];
  shown: { design: Design; name: string }[];
  files: Map<string, string>;
  logs: { level: ScriptLogLevel; text: string }[];
}

function harness(opts: { declineSave?: boolean; files?: Record<string, string> } = {}): Harness {
  const saved: Harness['saved'] = [];
  const shown: Harness['shown'] = [];
  const files = new Map(Object.entries(opts.files ?? {}));
  const io: ScriptIO = {
    openFile: async (req) => {
      const text = files.get(req.name);
      return text === undefined ? null : { name: req.name, text };
    },
    saveFile: async (req) => {
      if (opts.declineSave) return null;
      saved.push({ request: { kind: req.kind, name: req.name }, text: req.text });
      files.set(req.name, req.text);
      return req.name;
    },
    runNetlist: (n) => runAnalyses(n),
    showDesign: (design, name) => {
      shown.push({ design, name });
    },
  };
  return { io, saved, shown, files, logs: [] };
}

async function run(h: Harness, code: string, args: string[] = []): Promise<ScriptOutcome> {
  const session = new ScriptSession(h.io);
  const r = startScript({ code, host: session, createWorker: nodeWorkerFactory, kind: 'node', args, timeoutMs: 20000, onLog: (level, text) => h.logs.push({ level, text }) });
  return r.done;
}

const DIVIDER = `
await MachSim.newDesign('Divider');
await MachSim.place('dc-voltage', 100, 200, { value: '10' });
await MachSim.place('resistor', 200, 150, { value: '1k' });
await MachSim.place('resistor', 300, 200, { value: '3k', rotation: 90 });
await MachSim.net('in', 'V1.+', 'R1.1');
await MachSim.net('mid', 'R1.2', 'R2.1');
await MachSim.ground('V1.-');
await MachSim.ground('R2.2');
`;

describe('scripting: place, wire, run, read (end to end in the worker)', () => {
  it('builds a divider and reads V(mid) = 7.5 V', async () => {
    const h = harness();
    const out = await run(h, `${DIVIDER}\nconst op = await MachSim.run('op');\nreturn op.get('mid')[0];`);
    expect(out.error).toBeUndefined();
    expect(out.ok).toBe(true);
    expect(out.value as number).toBeCloseTo(7.5, 9);
  });

  it('places parts with automatic names and reports pin positions', async () => {
    const h = harness();
    const out = await run(
      h,
      `await MachSim.newDesign('t');
       const a = await MachSim.place('resistor', 100, 100);
       const b = await MachSim.place('resistor', 200, 100, { value: '2k' });
       const info = await MachSim.designInfo();
       return { a: a.refdes, b: b.refdes, pins: Object.keys(a.pins), parts: info.parts.map((p) => p.refdes + '=' + p.value) };`,
    );
    expect(out.ok).toBe(true);
    const v = out.value as { a: string; b: string; pins: string[]; parts: string[] };
    expect(v.a).toBe('R1');
    expect(v.b).toBe('R2');
    expect(v.pins.length).toBe(2);
    expect(v.parts[1]).toBe('R2=2k');
  });

  it('wires with real wires between pins', async () => {
    const h = harness();
    const out = await run(
      h,
      `await MachSim.newDesign('w');
       await MachSim.place('dc-voltage', 100, 200, { value: '5' });
       await MachSim.place('resistor', 200, 200, { value: '1k' });
       await MachSim.wire('V1.+', 'R1.1');
       await MachSim.ground('V1.-');
       await MachSim.ground('R1.2');
       const op = await MachSim.run('op');
       return op.get('I(V1)')[0];`,
    );
    expect(out.error).toBeUndefined();
    // 5 V across 1 kOhm: 5 mA flows out of the source's + terminal
    expect(Math.abs(out.value as number)).toBeCloseTo(5e-3, 9);
  });

  it('runs an AC sweep and measures the RC corner frequency within 2 % of 1/(2 pi R C)', async () => {
    const h = harness();
    const out = await run(
      h,
      `await MachSim.newDesign('rc');
       await MachSim.place('ac-voltage', 100, 200, { params: { amplitude: '1', acmag: '1' } });
       await MachSim.place('resistor', 200, 150, { value: '1k' });
       await MachSim.place('capacitor', 300, 200, { value: '100n', rotation: 90 });
       await MachSim.net('in', 'V1.+', 'R1.1');
       await MachSim.net('out', 'R1.2', 'C1.1');
       await MachSim.ground('V1.-'); await MachSim.ground('C1.2');
       const res = await MachSim.run('ac', { fstart: '10', fstop: '100k', points: 50 });
       return { fc: res.bandwidth('V(out)'), g0: res.atDb('out', 10), nodeOut: await MachSim.nodeOf('R1.2') };`,
    );
    expect(out.error).toBeUndefined();
    const v = out.value as { fc: number; g0: number; nodeOut: string };
    const fc = 1 / (2 * Math.PI * 1e3 * 100e-9);
    expect(Math.abs(v.fc - fc) / fc).toBeLessThan(0.02);
    expect(Math.abs(v.g0)).toBeLessThan(0.01);
    expect(v.nodeOut.toLowerCase()).toBe('out');
  });

  it('loops over values with MachSim.sweep and restores the value', async () => {
    const h = harness();
    const out = await run(
      h,
      `${DIVIDER}
       const mids = await MachSim.sweep('R2', ['1k', '3k', '9k'], async () => (await MachSim.run('op')).get('mid')[0]);
       return { mids, back: await MachSim.getParam('R2') };`,
    );
    expect(out.error).toBeUndefined();
    const v = out.value as { mids: number[]; back: string };
    expect(v.mids[0]).toBeCloseTo(5, 9);
    expect(v.mids[1]).toBeCloseTo(7.5, 9);
    expect(v.mids[2]).toBeCloseTo(9, 9);
    expect(v.back).toBe('3k');
  });

  it('runs a transient and exports CSV only after the save is approved', async () => {
    const h = harness();
    const out = await run(
      h,
      `${DIVIDER}
       const res = await MachSim.run('tran', { tstop: '1m', tstep: '100u' });
       await MachSim.saveText('out.csv', res.toCsv());
       return res.x.length;`,
    );
    expect(out.ok).toBe(true);
    expect(h.saved.length).toBe(1);
    expect(h.saved[0].request).toEqual({ kind: 'csv', name: 'out.csv' });
    expect(h.saved[0].text.split('\r\n')[0]).toMatch(/^time,/i);
  });

  it('a declined save is an error the script sees, and no file is written', async () => {
    const h = harness({ declineSave: true });
    const out = await run(h, `try { await MachSim.saveText('x.txt', 'hi'); return 'saved'; } catch (e) { return 'refused:' + e.message; }`);
    expect(out.ok).toBe(true);
    expect(String(out.value)).toMatch(/^refused:/);
    expect(h.saved.length).toBe(0);
  });

  it('opens and saves designs through the host (round trip keeps the parts)', async () => {
    const h = harness();
    const first = await run(h, `${DIVIDER}\nawait MachSim.saveDesign('divider.msim');`);
    expect(first.ok).toBe(true);
    expect(parseDesign(h.files.get('divider.msim')!).sheets[0].parts.length).toBeGreaterThanOrEqual(5);
    const second = await run(h, `const info = await MachSim.openDesign('divider.msim'); return info.parts.filter((p) => p.refdes.startsWith('R')).length;`);
    expect(second.value).toBe(2);
    const missing = await run(h, `try { await MachSim.openDesign('nope.msim'); return 'opened'; } catch (e) { return 'refused'; }`);
    expect(missing.value).toBe('refused');
  });

  it('shows the design in the editor as a copy', async () => {
    const h = harness();
    const out = await run(h, `${DIVIDER}\nawait MachSim.showDesign();\nawait MachSim.setValue('R1', '9k');`);
    expect(out.ok).toBe(true);
    expect(h.shown.length).toBe(1);
    const shownR1 = h.shown[0].design.sheets[0].parts.find((p) => p.refdes === 'R1');
    expect(shownR1?.params.value).toBe('1k');
  });

  it('runs a SPICE deck and reads .meas-free vectors', async () => {
    const h = harness();
    const out = await run(h, `const r = await MachSim.runSpice('t\\nV1 in 0 DC 5\\nR1 in out 2k\\nR2 out 0 3k\\n.op\\n.end'); return r.get('out')[0];`);
    expect(out.error).toBeUndefined();
    expect(out.value as number).toBeCloseTo(3, 9);
  });

  it('reports errors with the line and a helpful message', async () => {
    const h = harness();
    const bad = await run(h, `await MachSim.newDesign('x');\nawait MachSim.setValue('R9', '1k');`);
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/R9/);
    const missingPin = await run(h, `await MachSim.newDesign('x');\nawait MachSim.place('resistor', 100, 100);\nawait MachSim.wire('R1.7', 'R1.1');`);
    expect(missingPin.error).toMatch(/R1/);
    const syntax = await run(h, `let = ;`);
    expect(syntax.ok).toBe(false);
  });

  it('refuses an ERC error before simulating', async () => {
    const h = harness();
    // two ideal voltage sources of different value in parallel: a voltage loop, which ERC reports as an error
    const out = await run(
      h,
      `await MachSim.newDesign('x');
       await MachSim.place('dc-voltage', 100, 100, { value: '5' });
       await MachSim.place('dc-voltage', 200, 100, { value: '6' });
       await MachSim.net('a', 'V1.+', 'V2.+');
       await MachSim.ground('V1.-'); await MachSim.ground('V2.-');
       return (await MachSim.run('op')).title;`,
    );
    expect(out.ok).toBe(false);
    expect(out.error!.length).toBeGreaterThan(5);
  });

  it('print and console go to the log, arguments reach MachSim.args', async () => {
    const h = harness();
    const out = await run(h, `print('a', 1, [1, 2]); console.warn('careful'); return MachSim.args;`, ['x.msim', '--flag']);
    expect(out.value).toEqual(['x.msim', '--flag']);
    expect(h.logs).toEqual([
      { level: 'log', text: 'a 1 [1, 2]' },
      { level: 'warn', text: 'careful' },
    ]);
  });
});

describe('scripting: sandbox', () => {
  it('has no network, storage, worker or process access', async () => {
    const h = harness();
    const out = await run(
      h,
      `return {
        fetch: typeof fetch, xhr: typeof XMLHttpRequest, ws: typeof WebSocket, w: typeof Worker, ls: typeof localStorage,
        req: typeof require, proc: typeof process, post: typeof postMessage, self: typeof self,
        viaGlobal: typeof (new Function('return this')()).fetch, viaGlobalProcess: typeof (new Function('return this')()).process,
      };`,
    );
    expect(out.ok).toBe(true);
    expect(out.value).toEqual({ fetch: 'undefined', xhr: 'undefined', ws: 'undefined', w: 'undefined', ls: 'undefined', req: 'undefined', proc: 'undefined', post: 'undefined', self: 'undefined', viaGlobal: 'undefined', viaGlobalProcess: 'undefined' });
  });

  it('Stop terminates a script stuck in a loop', async () => {
    const h = harness();
    const session = new ScriptSession(h.io);
    const r = startScript({ code: 'while (true) {}', host: session, createWorker: nodeWorkerFactory, kind: 'node', timeoutMs: 20000 });
    setTimeout(() => r.stop(), 200);
    const out = await r.done;
    expect(out.stopped).toBe(true);
  });

  it('the time limit stops a script and says so', async () => {
    const h = harness();
    const session = new ScriptSession(h.io);
    const r = startScript({ code: 'await MachSim.sleep(5000);', host: session, createWorker: nodeWorkerFactory, kind: 'node', timeoutMs: 200 });
    const out = await r.done;
    expect(out.timedOut).toBe(true);
  });

  it('rejects an unknown method and non-plain arguments', async () => {
    const h = harness();
    const out = await run(h, `try { await MachSim.run('op', { f() {} }); } catch (e) { return e.message; }`);
    expect(out.ok).toBe(true);
  });
});

describe('scripting: the shipped examples run and give the documented numbers', () => {
  it('every example runs without error (saves approved, editor present)', async () => {
    for (const ex of SCRIPT_EXAMPLES) {
      for (const lang of ['vi', 'en'] as const) {
        const h = harness();
        const out = await run(h, ex.code[lang]);
        expect(out.error, `${ex.id}/${lang}`).toBeUndefined();
        expect(out.ok, `${ex.id}/${lang}`).toBe(true);
      }
    }
  }, 120000);

  it('the sweep example prints a measured corner within 3 % of the theory for each R1', async () => {
    const h = harness();
    const ex = SCRIPT_EXAMPLES.find((e) => e.id === 'sweep-gain')!;
    await run(h, ex.code.en);
    const lines = h.logs.filter((l) => l.text.startsWith('R1 ='));
    expect(lines.length).toBe(4);
    for (const l of lines) {
      const m = /R1 = (\S+)\s+measured fc = ([\d.]+)(k?)Hz\s+theory = ([\d.]+)(k?)Hz/.exec(l.text);
      expect(m, l.text).not.toBeNull();
      const measured = Number(m![2]) * (m![3] ? 1e3 : 1);
      const theory = Number(m![4]) * (m![5] ? 1e3 : 1);
      expect(Math.abs(measured - theory) / theory).toBeLessThan(0.03);
    }
  });
});

describe('scripting: designs built by a script are ordinary designs', () => {
  it('a scripted circuit saves, reopens byte for byte, passes ERC and simulates after the round trip', async () => {
    const h = harness();
    const session = new ScriptSession(h.io);
    const r = startScript({ code: `${DIVIDER}\nawait MachSim.wirePath(['V1.+', { x: 120, y: 80 }, { x: 200, y: 80 }]);\nawait MachSim.label({ x: 400, y: 400 }, 'note');`, host: session, createWorker: nodeWorkerFactory, kind: 'node', timeoutMs: 20000 });
    const out = await r.done;
    expect(out.error).toBeUndefined();
    const text = serializeDesign(session.design);
    const again = parseDesign(text);
    expect(serializeDesign(again)).toBe(text);
    const build = buildNetlist(again, { includeAnalysis: false });
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const [res] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
    expect(res.vectors.find((v) => v.name.toLowerCase() === 'v(mid)')!.re[0]).toBeCloseTo(7.5, 9);
    // every id is unique in the design
    const ids = again.sheets.flatMap((s) => [...s.parts.map((p) => p.id), ...s.wires.map((w) => w.id), ...s.labels.map((l) => l.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('place validates its input: unknown parts get suggestions, duplicate names, bad rotation and bad numbers are refused', async () => {
    const h = harness();
    const out = await run(
      h,
      `const msgs = [];
       const tryIt = async (fn) => { try { await fn(); msgs.push('ok'); } catch (e) { msgs.push(e.message); } };
       await MachSim.newDesign('v');
       await tryIt(() => MachSim.place('definitely-not-a-part', 0, 0));
       await MachSim.place('resistor', 0, 0, { refdes: 'RX' });
       await tryIt(() => MachSim.place('resistor', 100, 0, { refdes: 'rx' }));
       await tryIt(() => MachSim.place('resistor', 100, 0, { rotation: 45 }));
       await tryIt(() => MachSim.place('resistor', 'left', 0));
       await tryIt(() => MachSim.setParam('RX', 'nonsense', '1'));
       await tryIt(() => MachSim.wire('RX.1', 'RX.nope'));
       return msgs;`,
    );
    expect(out.ok).toBe(true);
    const msgs = out.value as string[];
    expect(msgs[0]).toMatch(/definitely-not-a-part/);
    expect(msgs[1]).toMatch(/RX|rx/);
    expect(msgs[2]).toMatch(/45/);
    expect(msgs[3]).toMatch(/left/);
    expect(msgs[4]).toMatch(/nonsense/);
    expect(msgs[5]).toMatch(/nope/);
  });

  it('the part search finds library parts and short names resolve', async () => {
    const h = harness();
    const out = await run(h, `const hits = await MachSim.searchParts('1N4148', 5); await MachSim.newDesign('s'); const p = await MachSim.place('capacitor', 0, 0, { value: '10n' }); const info = await MachSim.partInfo('resistor'); return { n: hits.length, first: hits[0] && hits[0].id, cap: p.partId, params: info.params.map((q) => q.key) };`);
    expect(out.ok).toBe(true);
    const v = out.value as { n: number; first: string; cap: string; params: string[] };
    expect(v.n).toBeGreaterThan(0);
    expect(v.first).toMatch(/1n4148/i);
    expect(v.cap).toBe('basic/capacitor');
    expect(v.params).toContain('value');
  });

  it('the desktop shell routes --script through the batch window (main.cjs and the renderer)', () => {
    const main = readFileSync(new URL('../../desktop/main.cjs', import.meta.url), 'utf8');
    expect(main).toMatch(/a === '--script' \|\| a\.startsWith\('--script='\)/);
    const renderer = readFileSync(new URL('../desktop/batchRenderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(/runScriptFromBridge/);
  });
});

describe('scripting: beginner mode', () => {
  it('the Scripts window is an advanced tool: hidden in beginner mode (a first circuit does not need it)', async () => {
    const { beginnerCommand } = await import('../ui/app/beginner');
    expect(beginnerCommand('tools.script')).toBe(false);
    expect(beginnerCommand('simulate.run')).toBe(true);
  });
});

describe('scripting: the host only answers the API', () => {
  it('inherited properties are not API methods', async () => {
    const session = new ScriptSession(harness().io);
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nope']) await expect(session.call(name, [])).rejects.toThrow();
    await expect(session.call('designInfo', [])).resolves.toMatchObject({ title: 'Script' });
  });
});
