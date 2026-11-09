/**
 * Command-line arguments of the desktop app's batch mode (pure).
 *
 *   MachSim.exe --batch file.msim --analysis tran --out results.csv
 *   MachSim.exe --batch deck.cir --out results.json
 *
 *   parseCliArgs(argv)   argv after the executable (and the app folder in development) ->
 *                        { ok: true, options } | { ok: false, error, detail } | { ok: true, help }
 *   isBatchInvocation(argv)  true when argv asks for batch mode (--batch, --help, -h, /?)
 *
 * Options (each value may also be given as --name=value):
 *   --batch <file>     design (.msim) or SPICE netlist (.cir .sp .spi .net .ckt .txt) — required
 *   --analysis <type>  op, tran, ac, dc, … (an AnalysisType); default: the design's active analysis,
 *                      or every analysis card of a netlist
 *   --out <file>       result file; --format csv | text | json, else the extension decides (.csv,
 *                      .txt / .tsv = MachSim measurement text, .json); without --out the summary
 *                      only is logged
 *   --tstop <time>, --tstep <time>   transient stop time / output step (SPICE numbers: 10m, 1u)
 *   --set NAME=VALUE   design variable (repeatable)
 *   --netlist <file>   also write the SPICE netlist
 *   --erc              electrical rules check only (exit code 1 when it finds errors)
 *   --log <file>       write the log to a file as well
 *   --quiet            log errors only
 *   --lang vi|en       language of the log (default vi)
 *   --help, -h, /?     usage
 */
import type { AnalysisType } from '../sim/netlist';
import { parseSpiceNumber } from '../util/units';

export const ANALYSIS_NAMES: readonly AnalysisType[] = ['op', 'tran', 'ac', 'dc', 'acsingle', 'noise', 'noisefig', 'four', 'disto', 'tf', 'sens', 'pz', 'paramsweep', 'tempsweep', 'nestedsweep', 'montecarlo', 'worstcase', 'tracewidth', 'batch', 'user'];

export type OutputFormat = 'csv' | 'text' | 'json';

export interface CliOptions {
  input: string;
  analysis?: AnalysisType;
  out?: string;
  format?: OutputFormat;
  tstop?: number;
  tstep?: number;
  set: Record<string, string>;
  netlist?: string;
  erc: boolean;
  log?: string;
  quiet: boolean;
  lang?: 'vi' | 'en';
}

export type CliError = 'missingInput' | 'unknownOption' | 'missingValue' | 'badAnalysis' | 'badNumber' | 'badSet' | 'badFormat' | 'badLang' | 'extraArgument';

export type CliParse = { ok: true; help: true } | { ok: true; help?: false; options: CliOptions } | { ok: false; error: CliError; detail: string };

/** Exit codes of a batch run. */
export const EXIT = { ok: 0, failed: 1, usage: 2, file: 3 } as const;

const VALUE_OPTIONS = new Set(['batch', 'analysis', 'out', 'format', 'tstop', 'tstep', 'set', 'netlist', 'log', 'lang']);
const FLAG_OPTIONS = new Set(['erc', 'quiet', 'help']);

export function isBatchInvocation(argv: readonly string[]): boolean {
  return argv.some((a) => a === '--batch' || a.startsWith('--batch=') || a === '--help' || a === '-h' || a === '/?');
}

/** Output format of a file name (by extension), undefined for an unknown extension. */
export function formatOf(file: string): OutputFormat | undefined {
  const ext = /\.([^./\\]+)$/.exec(file)?.[1]?.toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'txt' || ext === 'tsv' || ext === 'lvm') return 'text';
  if (ext === 'json') return 'json';
  return undefined;
}

export function parseCliArgs(argv: readonly string[]): CliParse {
  const opts: CliOptions = { input: '', set: {}, erc: false, quiet: false };
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '/?') {
      help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      // a bare file name is the input when --batch has none (MachSim.exe --batch --out x.csv file.msim)
      if (!opts.input) {
        opts.input = arg;
        continue;
      }
      return { ok: false, error: 'extraArgument', detail: arg };
    }
    const eq = arg.indexOf('=');
    const name = (eq > 0 ? arg.slice(2, eq) : arg.slice(2)).toLowerCase();
    if (FLAG_OPTIONS.has(name)) {
      if (name === 'help') help = true;
      else if (name === 'erc') opts.erc = true;
      else opts.quiet = true;
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) {
      // switches added by Chromium / Electron (e.g. --enable-logging) are ignored
      if (/^(enable|disable|no-|remote-|inspect|allow-|user-data-dir|js-flags)/.test(name)) continue;
      return { ok: false, error: 'unknownOption', detail: arg };
    }
    let value: string | undefined;
    if (eq > 0) value = arg.slice(eq + 1);
    else {
      const next = argv[i + 1];
      if (next !== undefined && !(next.startsWith('--') && next.length > 2)) {
        value = next;
        i++;
      }
    }
    // "--batch" followed by another option: the input file comes as a bare argument
    if (name === 'batch' && value === undefined) continue;
    if (value === undefined || value === '') return { ok: false, error: 'missingValue', detail: `--${name}` };
    switch (name) {
      case 'batch':
        opts.input = value;
        break;
      case 'analysis': {
        const a = value.toLowerCase() as AnalysisType;
        if (!ANALYSIS_NAMES.includes(a)) return { ok: false, error: 'badAnalysis', detail: value };
        opts.analysis = a;
        break;
      }
      case 'out':
        opts.out = value;
        break;
      case 'format': {
        const f = value.toLowerCase();
        if (f !== 'csv' && f !== 'text' && f !== 'json') return { ok: false, error: 'badFormat', detail: value };
        opts.format = f;
        break;
      }
      case 'tstop':
      case 'tstep': {
        const n = parseSpiceNumber(value);
        if (!(Number.isFinite(n) && n > 0)) return { ok: false, error: 'badNumber', detail: `--${name} ${value}` };
        opts[name] = n;
        break;
      }
      case 'set': {
        const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/.exec(value);
        if (!m) return { ok: false, error: 'badSet', detail: value };
        opts.set[m[1]] = m[2];
        break;
      }
      case 'netlist':
        opts.netlist = value;
        break;
      case 'log':
        opts.log = value;
        break;
      case 'lang': {
        const l = value.toLowerCase();
        if (l !== 'vi' && l !== 'en') return { ok: false, error: 'badLang', detail: value };
        opts.lang = l;
        break;
      }
    }
  }
  if (help) return { ok: true, help: true };
  if (!opts.input) return { ok: false, error: 'missingInput', detail: '--batch' };
  if (opts.out && !opts.format && !formatOf(opts.out)) opts.format = 'csv';
  return { ok: true, options: opts };
}

/** Every file path the arguments name (the desktop shell lets the batch run read / write only these). */
export function argumentPaths(argv: readonly string[]): string[] {
  const r = parseCliArgs(argv);
  if (!r.ok || r.help) return [];
  const o = r.options;
  return [o.input, o.out, o.netlist, o.log].filter((p): p is string => !!p);
}
