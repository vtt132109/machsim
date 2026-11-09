/**
 * Command line of script mode:  MachSim.exe --script file.js [options] [arguments...]
 *
 *   parseScriptArgs(argv)      argv after the executable -> { ok: true, options } | { ok: false, error, detail } | { help: true }
 *   isScriptInvocation(argv)   true when argv asks for script mode (--script)
 *   runScriptCli(options, io)  read the script, run it in the sandbox, report; returns the exit code
 *
 * Options: --script <file> (required) · --lang vi|en · --timeout <seconds> (default 600) ·
 * --log <file> (also write the log there) · --quiet (errors only) · --help. Everything else after the
 * options is handed to the script as `MachSim.args`.
 *
 * File access: the script never touches the disk. `MachSim.openDesign(name)` and
 * `MachSim.saveText(name, …)` / `saveDesign(name)` are forwarded to `CliIO`, which in the desktop app
 * is the shell's batch IPC: it allows exactly the paths written on the command line (the same rule
 * as `--batch`), so `MachSim.exe --script gain.js result.csv` lets gain.js write result.csv and nothing else.
 * Exit codes are the batch codes: 0 ok, 1 the script failed or timed out, 2 usage, 3 a file problem.
 */
import { EXIT } from '../desktop/cli';
import { sx } from '../i18n/scriptText';
import { ScriptSession, type ScriptIO } from './session';
import { startScript, browserWorkerFactory } from './runner';
import type { ScriptWorkerFactory } from './protocol';
import type { Netlist } from '../sim/netlist';
import type { AnalysisResult } from '../sim/results';

export interface ScriptCliOptions {
  script: string;
  lang?: 'vi' | 'en';
  timeoutSec: number;
  log?: string;
  quiet: boolean;
  /** everything after the options: handed to the script */
  args: string[];
}

export type ScriptCliParse = { ok: true; help: true } | { ok: true; help?: false; options: ScriptCliOptions } | { ok: false; error: 'missingScript' | 'missingValue' | 'badNumber' | 'badLang'; detail: string };

export const DEFAULT_SCRIPT_TIMEOUT_SEC = 600;

export function isScriptInvocation(argv: readonly string[]): boolean {
  return argv.some((a) => a === '--script' || a.startsWith('--script='));
}

export function parseScriptArgs(argv: readonly string[]): ScriptCliParse {
  const o: ScriptCliOptions = { script: '', timeoutSec: DEFAULT_SCRIPT_TIMEOUT_SEC, quiet: false, args: [] };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help' || arg === '/?') {
      help = true;
      continue;
    }
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = arg.startsWith('--') ? (eq > 0 ? arg.slice(2, eq) : arg.slice(2)).toLowerCase() : '';
    if (name === 'quiet') {
      o.quiet = true;
      continue;
    }
    if (name === 'script' || name === 'lang' || name === 'timeout' || name === 'log') {
      let value: string | undefined;
      if (eq > 0) value = arg.slice(eq + 1);
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) value = argv[++i];
      if (!value) return { ok: false, error: 'missingValue', detail: `--${name}` };
      if (name === 'script') o.script = value;
      else if (name === 'log') o.log = value;
      else if (name === 'lang') {
        const l = value.toLowerCase();
        if (l !== 'vi' && l !== 'en') return { ok: false, error: 'badLang', detail: value };
        o.lang = l;
      } else {
        const n = Number(value);
        if (!(Number.isFinite(n) && n > 0)) return { ok: false, error: 'badNumber', detail: `--timeout ${value}` };
        o.timeoutSec = n;
      }
      continue;
    }
    // switches Chromium / Electron add are not the script's
    if (name && /^(enable|disable|no-|remote-|inspect|allow-|user-data-dir|js-flags)/.test(name)) continue;
    o.args.push(arg);
  }
  if (help) return { ok: true, help: true };
  if (!o.script) return { ok: false, error: 'missingScript', detail: '--script' };
  return { ok: true, options: o };
}

export interface ScriptCliIO {
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  runNetlist(netlist: Netlist): Promise<AnalysisResult[]> | AnalysisResult[];
  /** one log line: 'out' goes to standard output, 'err' to standard error */
  log(line: string, stream: 'out' | 'err'): void;
  createWorker?: ScriptWorkerFactory;
  /** 'web' (default) or 'node' for worker_threads in tests */
  workerKind?: 'web' | 'node';
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Run a script file; resolves with the exit code. */
export async function runScriptCli(o: ScriptCliOptions, io: ScriptCliIO): Promise<number> {
  const lang = o.lang;
  let code: string;
  try {
    code = await io.readFile(o.script);
  } catch (e) {
    io.log(sx('cliNoFile', { file: o.script }, lang) + ` (${message(e)})`, 'err');
    return EXIT.file;
  }
  let fileError: string | undefined;
  const scriptIO: ScriptIO = {
    openFile: async (req) => {
      try {
        return { name: req.name, text: await io.readFile(req.name) };
      } catch (e) {
        fileError = message(e);
        throw new Error(`${sx('cliNotAllowed', { file: req.name }, lang)} (${message(e)})`);
      }
    },
    saveFile: async (req) => {
      try {
        await io.writeFile(req.name, req.text);
      } catch (e) {
        fileError = message(e);
        throw new Error(`${sx('cliNotAllowed', { file: req.name }, lang)} (${message(e)})`);
      }
      if (!o.quiet) io.log(sx('cliWrote', { file: req.name }, lang), 'out');
      return req.name;
    },
    runNetlist: (n) => io.runNetlist(n),
  };
  const session = new ScriptSession(scriptIO);
  const run = startScript({
    code,
    host: session,
    createWorker: io.createWorker ?? browserWorkerFactory,
    kind: io.workerKind ?? 'web',
    args: o.args,
    timeoutMs: o.timeoutSec * 1000,
    onLog: (level, text) => {
      if (level === 'error' || level === 'warn') io.log(text, 'err');
      else if (!o.quiet) io.log(text, 'out');
    },
  });
  const out = await run.done;
  let exit: number = EXIT.ok;
  if (!out.ok) {
    exit = fileError !== undefined ? EXIT.file : EXIT.failed;
    if (out.timedOut) io.log(sx('cliTimeout', { sec: o.timeoutSec }, lang), 'err');
    else io.log(sx('cliFailed', { line: out.line ? sx('cliLine', { n: out.line }, lang) : '', message: out.error ?? '' }, lang), 'err');
  }
  if (!o.quiet) io.log(sx('cliDone', { code: exit }, lang), 'out');
  return exit;
}
