/**
 * Reports dialog (Reports menu; loaded on first use): bill of materials with manufacturer and
 * tolerance, component detail, model data, spare gates, cross-reference and schematic statistics
 * of the open design, with CSV / HTML export and printing.
 */
import { useMemo, useState } from 'react';
import type { Design } from '../../model/types';
import { tablesToCsv, tablesToHtml, type ReportTableData } from '../../model/reportFormat';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { exportFile } from '../app/files';
import { getState, useEditor } from '../store';
import { rt } from '../../i18n/reportUi';
import { getLang, localeTag, t } from '../../i18n';
import { REPORT_IDS, reportDescription, reportTables, reportTitle, type ReportId } from './reportTables';
import './reports.css';

function baseName(fileName: string, title: string): string {
  const leaf = (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]*$/, '');
  return (leaf && !/^untitled$/i.test(leaf) ? leaf : title || 'design').replace(/[<>:"/\\|?*]/g, '_');
}

/** HTML document of a report (export and print). */
export function reportHtml(id: ReportId, design: Design, tables: ReportTableData[]): string {
  const date = new Date().toLocaleString(localeTag());
  return tablesToHtml(reportTitle(id), tables, {
    lang: getLang(),
    lines: [rt('report.meta.design', { title: design.title }), rt('report.meta.date', { date }), rt('report.meta.tool')],
  });
}

/** Print an HTML document through a hidden frame (the browser / desktop print dialog). */
export function printHtml(html: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = html;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      setTimeout(() => frame.remove(), 60_000);
    }
  };
  document.body.appendChild(frame);
}

function ReportTable({ table }: { table: ReportTableData }) {
  return (
    <section className="ms-report-table">
      {table.title ? <h4>{table.title}</h4> : null}
      {table.caption ? <p className="ms-hint">{table.caption}</p> : null}
      <table className="ms-table">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={typeof v === 'number' ? 'ms-num' : 'ms-wrap'}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function ReportsView({ initial, close }: { initial: ReportId; close: () => void }) {
  const [id, setId] = useState<ReportId>(initial);
  const design = useEditor((s) => s.design);
  const fileName = useEditor((s) => s.fileName);
  const tables = useMemo(() => reportTables(id, design), [id, design]);
  const rows = tables.reduce((n, tb) => n + tb.rows.length, 0);
  const stem = `${baseName(fileName, design.title)} - ${reportTitle(id)}`;
  return (
    <Dialog
      title={rt('report.dialog')}
      onClose={close}
      width="min(1040px, 96vw)"
      className="ms-report-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" disabled={!rows} title={rt('report.exportCsvTip')} onClick={() => void exportFile(`${stem}.csv`, tablesToCsv(tables), { name: 'CSV', extensions: ['csv'] })}>
            {rt('report.exportCsv')}
          </button>
          <button type="button" className="ms-btn" disabled={!rows} title={rt('report.exportHtmlTip')} onClick={() => void exportFile(`${stem}.html`, reportHtml(id, getState().design, tables), { name: 'HTML', extensions: ['html'] })}>
            {rt('report.exportHtml')}
          </button>
          <button type="button" className="ms-btn" disabled={!rows} title={rt('report.printTip')} onClick={() => printHtml(reportHtml(id, getState().design, tables))}>
            {rt('report.print')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="ms-report-body">
        <nav className="ms-report-nav" aria-label={rt('report.listTip')}>
          {REPORT_IDS.map((r) => (
            <button key={r} type="button" className={`ms-report-nav-item${r === id ? ' is-active' : ''}`} aria-current={r === id ? 'page' : undefined} title={reportDescription(r)} onClick={() => setId(r)}>
              {reportTitle(r)}
            </button>
          ))}
        </nav>
        <div className="ms-report-main">
          <h3>{reportTitle(id)}</h3>
          <p className="ms-hint">{reportDescription(id)}</p>
          <p className="ms-hint">{rt('report.rows', { n: rows })}</p>
          {rows ? tables.map((tb, i) => <ReportTable key={i} table={tb} />) : <p className="ms-empty">{rt('report.empty')}</p>}
        </div>
      </div>
    </Dialog>
  );
}

export function openReportsDialog(id: ReportId = 'bom'): void {
  openCustomDialog((close) => <ReportsView initial={id} close={close} />);
}
