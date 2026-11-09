/**
 * The program that runs INSIDE the scripting sandbox (a Web Worker, or a Node worker_threads Worker
 * in tests). `workerProgram` is serialised with `toString()` and evaluated in the worker (see
 * workerSource.ts), so it must be self-contained: no imports, no references to anything outside its
 * own body, no class fields. It is deliberately written in plain, loosely typed TypeScript.
 *
 * What the worker adds on top of the host's API calls (`MachSim.<method>()`, every one asynchronous):
 *   - a `Result` wrapper around analysis results with the helpers a learner needs (get a vector,
 *     value at x, max / min / mean / rms, crossing, bandwidth, CSV);
 *   - small numeric helpers: linspace, logspace, range, sleep, parseNumber, eng;
 *   - `MachSim.sweep(refdes, values, fn)` — set a part value in a loop and call back;
 *   - print() / console.log|info|warn|error, which go to the log pane.
 *
 * Sandbox: the global names listed in `scrub` (network, storage, workers, messaging) are removed
 * before the user's code is compiled, and the same names are shadowed as undefined parameters of
 * the function that runs the code, so a script cannot reach the page, the file system or the
 * network; the only way out is an API call, which the host answers (or refuses).
 */

export interface WorkerPort {
  post(msg: unknown): void;
  listen(cb: (msg: any) => void): void;
}

/** Globals removed from the worker before user code runs. */
export const SCRUBBED_GLOBALS: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'WebTransport',
  'importScripts',
  'indexedDB',
  'caches',
  'localStorage',
  'sessionStorage',
  'BroadcastChannel',
  'SharedWorker',
  'Worker',
  'MessageChannel',
  'MessagePort',
  'postMessage',
  'close',
  'require',
  'process',
  'module',
  'exports',
  'Buffer',
  'navigator',
  'location',
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function workerProgram(port: WorkerPort, scrub: string[]): void {
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  let seq = 0;

  function post(msg: any): void {
    port.post(msg);
  }

  function call(method: string, args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      seq += 1;
      pending.set(seq, { resolve, reject });
      let cloneable: any[];
      try {
        cloneable = JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)));
      } catch (e) {
        pending.delete(seq);
        reject(new Error('MachSim.' + method + ': arguments must be plain data (numbers, text, lists, objects)'));
        return;
      }
      post({ t: 'call', id: seq, method, args: cloneable });
    });
  }

  // ---- text of print()
  function show(v: any, depth: number): string {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'function') return '[function]';
    if (v instanceof Error) return v.message;
    if (v && typeof v.toText === 'function') return v.toText();
    try {
      if (Array.isArray(v)) {
        if (depth > 2) return '[…]';
        const items = v.slice(0, 50).map((x: any) => (typeof x === 'string' && depth > 0 ? JSON.stringify(x) : show(x, depth + 1)));
        return '[' + items.join(', ') + (v.length > 50 ? ', … (' + v.length + ')' : '') + ']';
      }
      if (typeof v === 'object') return JSON.stringify(v, (_k, x) => (typeof x === 'number' ? Number(x.toPrecision(10)) : x));
    } catch (e) {
      return String(v);
    }
    return String(v);
  }

  function fmtNum(x: number): string {
    if (!Number.isFinite(x)) return String(x);
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e6) return String(Number(x.toPrecision(6)));
    return x.toExponential(4);
  }

  function logger(level: string): (...a: any[]) => void {
    return (...a: any[]) => {
      post({ t: 'log', level, text: a.map((x) => show(x, 0)).join(' ') });
    };
  }

  // ---- numbers
  const SUFFIX: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

  /** "4.7k", "10u", "1meg", "2e-3" -> number (NaN when it is not a number). */
  function parseNumber(v: any): number {
    if (typeof v === 'number') return v;
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(meg|[tgkmunpfµ])?[a-z]*\s*$/i.exec(String(v).replace(',', '.'));
    if (!m) return NaN;
    const n = parseFloat(m[1]);
    return m[2] ? n * SUFFIX[m[2].toLowerCase()] : n;
  }

  /** 4700 -> "4.7k" */
  function eng(x: number, digits?: number): string {
    if (!Number.isFinite(x) || x === 0) return String(x);
    const d = digits === undefined ? 4 : digits;
    const names = ['f', 'p', 'n', 'u', 'm', '', 'k', 'M', 'G', 'T'];
    let e = Math.floor(Math.log10(Math.abs(x)) / 3);
    e = Math.max(-5, Math.min(4, e));
    const v = x / Math.pow(10, e * 3);
    return String(Number(v.toPrecision(d))) + names[e + 5];
  }

  function linspace(a: number, b: number, n: number): number[] {
    const out: number[] = [];
    const count = Math.max(1, Math.round(n));
    for (let i = 0; i < count; i++) out.push(count === 1 ? a : a + ((b - a) * i) / (count - 1));
    return out;
  }

  function logspace(a: number, b: number, n: number): number[] {
    const x = parseNumber(a);
    const y = parseNumber(b);
    if (!(x > 0 && y > 0)) throw new Error('logspace: both ends must be positive');
    return linspace(Math.log10(x), Math.log10(y), n).map((e) => Math.pow(10, e));
  }

  function range(a: number, b: number, step?: number): number[] {
    const s = step === undefined ? 1 : step;
    if (!(s !== 0) || !Number.isFinite(s)) throw new Error('range: step must not be 0');
    const out: number[] = [];
    const n = Math.floor((b - a) / s + 1e-9);
    for (let i = 0; i <= n && i < 1e6; i++) out.push(a + i * s);
    return out;
  }

  // ---- results
  function find(raw: any, name: string): any {
    const k = String(name).toLowerCase();
    const list: any[] = raw.scale ? [raw.scale].concat(raw.vectors) : raw.vectors;
    let hit = list.find((v) => v.name.toLowerCase() === k);
    if (!hit) hit = list.find((v) => v.name.toLowerCase() === 'v(' + k + ')');
    if (!hit) hit = list.find((v) => v.name.toLowerCase().replace(/^[a-z]+\(|\)$/g, '') === k);
    if (!hit) {
      const names = raw.vectors.map((v: any) => v.name).slice(0, 12).join(', ');
      throw new Error('no vector "' + name + '" in this result (available: ' + names + ')');
    }
    return hit;
  }

  function mags(v: any): number[] {
    return v.imag ? v.values.map((re: number, i: number) => Math.hypot(re, v.imag[i])) : v.values;
  }

  function interp(x: number[], y: number[], at: number): number {
    const n = x.length;
    if (n === 0) return NaN;
    if (n === 1) return y[0];
    const asc = x[n - 1] >= x[0];
    const lo = asc ? x[0] : x[n - 1];
    const hi = asc ? x[n - 1] : x[0];
    if (at < lo || at > hi) return NaN;
    let a = 0;
    let b = n - 1;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (asc ? x[m] <= at : x[m] >= at) a = m;
      else b = m;
    }
    const dx = x[b] - x[a];
    return dx === 0 ? y[a] : y[a] + ((y[b] - y[a]) * (at - x[a])) / dx;
  }

  function wrapResult(raw: any): any {
    const r: any = {
      raw,
      type: raw.type,
      title: raw.title,
      error: raw.error,
      warnings: raw.warnings,
      scalars: raw.scalars,
      measurements: raw.measurements,
      table: raw.table,
      x: raw.scale ? raw.scale.values : [],
      xName: raw.scale ? raw.scale.name : '',
      names: raw.vectors.map((v: any) => v.name),
    };
    r.runs = (raw.runs || []).map((u: any) => ({ label: u.label, result: wrapResult(u.result) }));
    r.get = (name: string) => find(raw, name).values.slice();
    r.mag = (name: string) => mags(find(raw, name)).slice();
    r.db = (name: string) => mags(find(raw, name)).map((m: number) => 20 * Math.log10(m));
    r.phase = (name: string) => {
      const v = find(raw, name);
      if (!v.imag) return v.values.map(() => 0);
      return v.values.map((re: number, i: number) => (Math.atan2(v.imag[i], re) * 180) / Math.PI);
    };
    r.at = (name: string, x: number) => interp(r.x, find(raw, name).values, parseNumber(x));
    r.atMag = (name: string, x: number) => interp(r.x, mags(find(raw, name)), parseNumber(x));
    r.atDb = (name: string, x: number) => 20 * Math.log10(r.atMag(name, x));
    r.atPhase = (name: string, x: number) => {
      const v = find(raw, name);
      if (!v.imag) return 0;
      return (Math.atan2(interp(r.x, v.imag, parseNumber(x)), interp(r.x, v.values, parseNumber(x))) * 180) / Math.PI;
    };
    r.final = (name: string) => {
      const y = find(raw, name).values;
      return y[y.length - 1];
    };
    r.first = (name: string) => find(raw, name).values[0];
    r.max = (name: string) => Math.max.apply(null, mags(find(raw, name)));
    r.min = (name: string) => Math.min.apply(null, mags(find(raw, name)));
    r.pp = (name: string) => r.max(name) - r.min(name);
    /** time-weighted mean (trapezoid) over the sweep */
    r.mean = (name: string) => {
      const y = find(raw, name).values;
      const x = r.x;
      if (x.length < 2) return y[0];
      let s = 0;
      for (let i = 1; i < x.length; i++) s += ((y[i] + y[i - 1]) / 2) * (x[i] - x[i - 1]);
      return s / (x[x.length - 1] - x[0]);
    };
    r.rms = (name: string) => {
      const y = mags(find(raw, name));
      const x = r.x;
      if (x.length < 2) return Math.abs(y[0]);
      let s = 0;
      for (let i = 1; i < x.length; i++) s += ((y[i] * y[i] + y[i - 1] * y[i - 1]) / 2) * (x[i] - x[i - 1]);
      return Math.sqrt(s / (x[x.length - 1] - x[0]));
    };
    /** x of the n-th crossing of `level` (edge: 'rise', 'fall' or 'any'); NaN when there is none */
    r.crossing = (name: string, level: number, edge?: string, nth?: number) => {
      const y = mags(find(raw, name));
      const x = r.x;
      const want = edge === 'fall' ? -1 : edge === 'any' ? 0 : 1;
      let count = 0;
      const target = nth === undefined ? 1 : nth;
      for (let i = 1; i < y.length; i++) {
        const a = y[i - 1] - level;
        const b = y[i] - level;
        if (a === b) continue;
        const up = a < 0 && b >= 0;
        const down = a > 0 && b <= 0;
        if ((want >= 0 && up) || (want <= 0 && down)) {
          count += 1;
          if (count === target) return x[i - 1] + ((x[i] - x[i - 1]) * (level - y[i - 1])) / (y[i] - y[i - 1]);
        }
      }
      return NaN;
    };
    /** -3 dB frequency of a low-pass response (first x where the magnitude has fallen to 1/sqrt 2 of its first value) */
    r.bandwidth = (name: string) => {
      const m = mags(find(raw, name));
      return r.crossing(name, m[0] / Math.SQRT2, 'fall', 1);
    };
    r.scalar = (name: string) => {
      const k = String(name).toLowerCase();
      for (const key of Object.keys(raw.scalars)) if (key.toLowerCase() === k) return raw.scalars[key];
      throw new Error('no scalar "' + name + '"');
    };
    r.meas = (name: string) => {
      const k = String(name).toLowerCase();
      const m = raw.measurements.find((q: any) => q.name.toLowerCase() === k);
      if (!m) throw new Error('no measurement "' + name + '"');
      if (m.error) throw new Error(name + ': ' + m.error);
      return m.value;
    };
    r.toCsv = () => {
      const cols: string[] = [];
      const data: number[][] = [];
      if (raw.scale) {
        cols.push(raw.scale.name);
        data.push(raw.scale.values);
      }
      for (const v of raw.vectors) {
        if (v.imag) {
          cols.push('mag(' + v.name + ')', 'ph(' + v.name + ')');
          data.push(mags(v), r.phase(v.name));
        } else {
          cols.push(v.name);
          data.push(v.values);
        }
      }
      const rows = [cols.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')];
      const n = data.length ? data[0].length : 0;
      for (let i = 0; i < n; i++) rows.push(data.map((d) => d[i]).join(','));
      return rows.join('\r\n') + '\r\n';
    };
    r.toText = () => {
      if (raw.error) return '[' + raw.type + '] ' + raw.title + ': ' + raw.error;
      const parts = ['[' + raw.type + '] ' + raw.title + ' — ' + raw.vectors.length + ' vectors' + (raw.scale ? ', ' + raw.scale.values.length + ' points' : '')];
      if (!raw.scale) {
        for (const v of raw.vectors.slice(0, 30)) parts.push('  ' + v.name + ' = ' + fmtNum(v.values[0]) + (v.imag ? ' + j' + fmtNum(v.imag[0]) : '') + ' ' + v.unit);
      }
      for (const k of Object.keys(raw.scalars).slice(0, 30)) parts.push('  ' + k + ' = ' + fmtNum(raw.scalars[k]));
      for (const m of raw.measurements) parts.push('  .meas ' + m.name + ' = ' + (m.error ? m.error : fmtNum(m.value)));
      return parts.join('\n');
    };
    return r;
  }

  // ---- the MachSim object
  function build(methods: string[], args: string[]): any {
    const M: any = {};
    for (const name of methods) M[name] = (...a: any[]) => call(name, a);
    const rawRun = M.run;
    const rawRunSpice = M.runSpice;
    M.run = async (type?: string, opts?: any) => wrapResult(await rawRun(type, opts));
    M.runSpice = async (text: string, opts?: any) => wrapResult(await rawRunSpice(text, opts));
    M.args = args.slice();
    M.version = 1;
    M.linspace = linspace;
    M.logspace = logspace;
    M.range = range;
    M.parseNumber = parseNumber;
    M.eng = eng;
    M.sleep = (ms: number) => new Promise((res) => setTimeout(res, Math.max(0, Math.min(ms, 60000))));
    /** Set `refdes` (value or `key`) to each of `values`, call `fn(value, index)` and collect what it returns. */
    M.sweep = async (refdes: string, values: any[], fn: (v: any, i: number) => any, opts?: any) => {
      const key = opts && opts.key ? opts.key : 'value';
      const original = await M.getParam(refdes, key);
      const out: any[] = [];
      try {
        for (let i = 0; i < values.length; i++) {
          if (key === 'value') await M.setValue(refdes, String(values[i]));
          else await M.setParam(refdes, key, String(values[i]));
          out.push(await fn(values[i], i));
        }
      } finally {
        if (original !== undefined && original !== null) {
          if (key === 'value') await M.setValue(refdes, String(original));
          else await M.setParam(refdes, key, String(original));
        }
      }
      return out;
    };
    /** Plot series against x: plot(title, x, {name: y[]}) or plot({title, x, series: [...]}) */
    const rawPlot = M.plot;
    M.plot = (a: any, x?: number[], series?: any, opts?: any) => {
      if (a && typeof a === 'object') return rawPlot(a);
      const list = Array.isArray(series) ? series : Object.keys(series || {}).map((k) => ({ name: k, y: series[k] }));
      return rawPlot(Object.assign({ title: a, x, series: list }, opts || {}));
    };
    M.table = (rows: any[][]) => {
      const cells = rows.map((row) => row.map((c) => (typeof c === 'number' ? fmtNum(c) : String(c))));
      const widths: number[] = [];
      for (const row of cells) row.forEach((c, i) => (widths[i] = Math.max(widths[i] || 0, c.length)));
      for (const row of cells) logger('log')(row.map((c, i) => c.padEnd(widths[i])).join('  '));
    };
    return M;
  }

  function lineOf(e: any): number | undefined {
    const stack = e && e.stack ? String(e.stack) : '';
    const m = /<anonymous>:(\d+):\d+/.exec(stack);
    return m ? Math.max(1, Number(m[1]) - 3) : undefined;
  }

  // ---- sandbox
  function lockDown(): void {
    const g: any = typeof globalThis !== 'undefined' ? globalThis : self;
    for (const name of scrub) {
      try {
        Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false });
      } catch (e) {
        try {
          g[name] = undefined;
        } catch (e2) {
          /* not removable here */
        }
      }
    }
  }

  async function runScript(msg: any): Promise<void> {
    const M = build(msg.methods, msg.args || []);
    const out = {
      log: logger('log'),
      info: logger('info'),
      warn: logger('warn'),
      error: logger('error'),
      debug: logger('log'),
    };
    const AsyncFunction = Object.getPrototypeOf(async function () { /* constructor holder */ }).constructor;
    let fn: any;
    try {
      const shadow = scrub.filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== 'undefined');
      fn = new AsyncFunction('MachSim', 'print', 'console', 'sleep', 'self', 'window', 'globalThis', ...shadow, '"use strict";\n' + msg.code);
      const value = await fn(M, out.log, out, M.sleep, undefined, undefined, undefined, ...shadow.map(() => undefined));
      let safe: any = null;
      try {
        safe = value === undefined ? null : JSON.parse(JSON.stringify(value, (_k, v) => (v && typeof v.toText === 'function' && v.raw ? v.raw : v)));
      } catch (e) {
        safe = String(value);
      }
      post({ t: 'done', ok: true, value: safe });
    } catch (e: any) {
      post({ t: 'done', ok: false, error: e && e.message ? String(e.message) : String(e), line: lineOf(e) });
    }
  }

  lockDown();
  port.listen((msg: any) => {
    if (msg.t === 'run') {
      void runScript(msg);
    } else if (msg.t === 'reply') {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.value);
      else p.reject(new Error(msg.error));
    }
  });
}
