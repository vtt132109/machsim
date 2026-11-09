/**
 * MachSim measurement text: the documented tab-separated export of Grapher traces (and its
 * reader). Not UI text: the header keywords are part of the file format.
 *
 *   MachSim measurement text	1
 *   Title	<page title>
 *   Date	<ISO 8601 time>
 *   X_Label	<x label> [<unit>]
 *   Channels	<n>
 *   ***End_of_Header***
 *   X_Value	<trace 1 label> [unit]	<trace 2 label> [unit]	...
 *   <x>	<y1>	<y2>	...
 *
 * All traces share one X_Value column: the union of their x samples, each trace interpolated
 * linearly at the x values it does not have itself (empty outside its own range). Numbers use a
 * dot as decimal separator and full precision; lines end with CR LF.
 */

/** y at xq by linear interpolation on ascending x (NaN outside the data). */
function interpolate(x: ArrayLike<number>, y: ArrayLike<number>, xq: number): number {
  const n = x.length;
  if (n === 0 || xq < x[0] || xq > x[n - 1]) return Number.NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= xq) lo = mid;
    else hi = mid;
  }
  if (x[hi] === x[lo]) return y[hi];
  return y[lo] + ((xq - x[lo]) / (x[hi] - x[lo])) * (y[hi] - y[lo]);
}

export interface TextTrace {
  label: string;
  unit: string;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}

/** Write traces as MachSim measurement text. */
export function tracesToText(traces: readonly TextTrace[], meta: { title: string; xLabel: string; xUnit: string; date?: Date }): string {
  const xs = [...new Set(traces.flatMap((tr) => Array.from(tr.x)))].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const head = (tr: TextTrace) => (tr.unit ? `${tr.label} [${tr.unit}]` : tr.label);
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
  const lines = [
    'MachSim measurement text\t1',
    `Title\t${clean(meta.title)}`,
    `Date\t${(meta.date ?? new Date()).toISOString()}`,
    `X_Label\t${clean(meta.xLabel)}${meta.xUnit ? ` [${meta.xUnit}]` : ''}`,
    `Channels\t${traces.length}`,
    '***End_of_Header***',
    ['X_Value', ...traces.map((tr) => clean(head(tr)))].join('\t'),
  ];
  for (const x of xs) {
    const row = [String(x)];
    for (const tr of traces) {
      const y = interpolate(tr.x, tr.y, x);
      row.push(Number.isFinite(y) ? String(y) : '');
    }
    lines.push(row.join('\t'));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Parse a MachSim measurement text back into traces (round trip of tracesToText). */
export function parseTracesText(text: string): { title: string; xLabel: string; traces: TextTrace[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  if (!lines[0]?.startsWith('MachSim measurement text')) throw new Error('not a MachSim measurement text');
  const end = lines.indexOf('***End_of_Header***');
  if (end < 0) throw new Error('missing ***End_of_Header***');
  const header = new Map(lines.slice(1, end).map((l) => [l.split('\t')[0], l.split('\t').slice(1).join('\t')] as const));
  const cols = lines[end + 1].split('\t').slice(1);
  const rows = lines.slice(end + 2).map((l) => l.split('\t'));
  const traces = cols.map((c, k) => {
    const m = /^(.*) \[(.*)\]$/.exec(c);
    const x: number[] = [];
    const y: number[] = [];
    for (const r of rows) {
      if (r[k + 1] === undefined || r[k + 1] === '') continue;
      x.push(Number(r[0]));
      y.push(Number(r[k + 1]));
    }
    return { label: m ? m[1] : c, unit: m ? m[2] : '', x: Float64Array.from(x), y: Float64Array.from(y) };
  });
  return { title: header.get('Title') ?? '', xLabel: header.get('X_Label') ?? '', traces };
}
