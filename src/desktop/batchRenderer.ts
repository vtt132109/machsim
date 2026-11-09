/**
 * Renderer side of the desktop command line (loaded instead of the app when the shell opens
 * index.html?batch): asks the main process for the arguments, runs src/desktop/batch.ts with the
 * in-process simulator, sends the log and the exit code back. File access goes through the shell,
 * which only reads / writes the paths named on the command line (and SPICE includes next to the
 * input).
 */
import { getDesktopBridge, type MachsimDesktopBridge } from './bridge';
import { parseCliArgs, ANALYSIS_NAMES, EXIT } from './cli';
import { runBatch } from './batch';
import { CLI_TEXT, ct, type CliKey } from '../i18n/cliText';
import { interpolate, setLang } from '../i18n';

/** `MachSim.exe --script file.js`: the script sandbox (src/script/cli.ts) instead of a batch analysis. */
async function runScriptFromBridge(bridge: MachsimDesktopBridge, args: string[]): Promise<void> {
  const { parseScriptArgs, runScriptCli } = await import('../script/cli');
  const { sx } = await import('../i18n/scriptText');
  const parsed = parseScriptArgs(args);
  if (!parsed.ok) {
    const detail = sx(parsed.error === 'missingScript' ? 'cliNoScript' : 'cliBadArgs', { detail: parsed.detail });
    bridge.batchDone!(EXIT.usage, '', `${detail}\n\n${sx('cliUsage')}`);
    return;
  }
  if (parsed.help) {
    bridge.batchDone!(EXIT.ok, sx('cliUsage'), '');
    return;
  }
  const o = parsed.options;
  setLang(o.lang ?? 'vi');
  const sim = await import('../sim');
  const out: string[] = [];
  const err: string[] = [];
  const code = await runScriptCli(o, {
    readFile: async (p) => {
      const r = await bridge.batchRead!(p);
      if (r.error !== undefined || r.text === undefined) throw new Error(r.error ?? 'read failed');
      return r.text;
    },
    writeFile: async (p, text) => {
      const r = await bridge.batchWrite!(p, text);
      if (r.error !== undefined) throw new Error(r.error);
    },
    runNetlist: (n) => sim.runAnalyses(n),
    log: (line, stream) => (stream === 'out' ? out : err).push(line),
  });
  if (o.log) {
    try {
      await bridge.batchWrite!(o.log, [...out, ...err].join('\r\n') + '\r\n');
    } catch {
      /* the log file is optional */
    }
  }
  bridge.batchDone!(code, out.join('\n'), err.join('\n'));
}

export async function runBatchFromBridge(): Promise<void> {
  const bridge = getDesktopBridge();
  const job = await bridge?.batchJob?.();
  if (!bridge || !job || !bridge.batchDone) return;
  if (job.args.some((a) => a === '--script' || a.startsWith('--script='))) {
    await runScriptFromBridge(bridge, job.args);
    return;
  }
  const out: string[] = [];
  const err: string[] = [];
  const log = (line: string, level: 'info' | 'error') => (level === 'error' ? err : out).push(line);
  const usage = () => CLI_TEXT.usage.map((u) => interpolate(u, { analyses: ANALYSIS_NAMES.join(', ') })).join('\n\n');
  const parsed = parseCliArgs(job.args);
  if (!parsed.ok) {
    err.push(ct(`error.${parsed.error}` as CliKey, { detail: parsed.detail }), '', usage());
    bridge.batchDone(EXIT.usage, out.join('\n'), err.join('\n'));
    return;
  }
  if (parsed.help) {
    bridge.batchDone(EXIT.ok, usage(), '');
    return;
  }
  const o = parsed.options;
  setLang(o.lang ?? 'vi');
  const sim = await import('../sim');
  let code: number = EXIT.failed;
  try {
    const r = await runBatch(o, {
      readFile: async (p) => {
        const r = await bridge.batchRead!(p);
        if (r.error !== undefined || r.text === undefined) throw new Error(r.error ?? 'read failed');
        return r.text;
      },
      writeFile: async (p, text) => {
        const r = await bridge.batchWrite!(p, text);
        if (r.error !== undefined) throw new Error(r.error);
      },
      readInclude: async (rel) => {
        try {
          return (await bridge.batchInclude?.(o.input, rel)) ?? null;
        } catch {
          return null;
        }
      },
      run: (n) => sim.runAnalyses(n),
      log,
    });
    code = r.code;
  } catch (e) {
    err.push(e instanceof Error ? e.message : String(e));
  }
  out.push(ct('log.done', { code }));
  if (o.log) {
    try {
      await bridge.batchWrite!(o.log, [...out, ...err].join('\r\n') + '\r\n');
    } catch {
      /* the log file is optional */
    }
  }
  bridge.batchDone(code, out.join('\n'), err.join('\n'));
}
