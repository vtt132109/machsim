/**
 * Report tables and their file formats (pure):
 *
 *   tablesToCsv(tables)                 RFC 4180 CSV (CRLF), one block per table: a title row,
 *                                       the header row, the data rows, a blank line between tables
 *   tablesToHtml(title, tables, meta)   a standalone HTML document (inline styles, escaped text)
 *                                       for saving and for printing
 *   escapeHtml(text)
 */

export interface ReportTableData {
  /** table title (shown above the table; empty = none) */
  title: string;
  columns: string[];
  rows: (string | number)[][];
  /** optional line under the title */
  caption?: string;
}

function csvField(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tablesToCsv(tables: ReportTableData[]): string {
  const lines: string[] = [];
  tables.forEach((t, i) => {
    if (i > 0) lines.push('');
    if (tables.length > 1 && t.title) lines.push(csvField(t.title));
    lines.push(t.columns.map(csvField).join(','));
    for (const r of t.rows) lines.push(r.map(csvField).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface HtmlMeta {
  /** document language (lang attribute) */
  lang: string;
  /** lines printed under the title (design name, date …) */
  lines: string[];
}

const STYLE = `body{font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#111;margin:16px}
h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:18px 0 4px}p.meta{color:#555;margin:0 0 2px}p.caption{color:#555;margin:0 0 4px}
table{border-collapse:collapse;width:100%;margin-bottom:8px}th,td{border:1px solid #bbb;padding:3px 6px;text-align:left;vertical-align:top}
th{background:#eef1f5}tr:nth-child(even) td{background:#fafbfc}td.num{text-align:right;font-variant-numeric:tabular-nums}
@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}`;

/** Standalone HTML document of report tables. */
export function tablesToHtml(title: string, tables: ReportTableData[], meta: HtmlMeta): string {
  const cell = (v: string | number) => (typeof v === 'number' ? `<td class="num">${escapeHtml(String(v))}</td>` : `<td>${escapeHtml(v)}</td>`);
  const body = tables
    .map((t) => {
      const head = t.title ? `<h2>${escapeHtml(t.title)}</h2>` : '';
      const cap = t.caption ? `<p class="caption">${escapeHtml(t.caption)}</p>` : '';
      const ths = t.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      const trs = t.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('\n');
      return `${head}${cap}<table><thead><tr>${ths}</tr></thead><tbody>\n${trs}\n</tbody></table>`;
    })
    .join('\n');
  const lines = meta.lines.map((l) => `<p class="meta">${escapeHtml(l)}</p>`).join('');
  return `<!doctype html>
<html lang="${escapeHtml(meta.lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><h1>${escapeHtml(title)}</h1>${lines}
${body}
</body></html>
`;
}
