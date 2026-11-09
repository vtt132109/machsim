/**
 * The pages of a print job as HTML: one `.ms-pp` box per page, as large as the paper in
 * millimetres. The print preview shows these boxes scaled down; printing mounts the very same
 * component into a print-only container, so what the learner sees is what the printer gets.
 *
 * A picture page holds the part of the picture the layout assigned to it (the whole sheet, or one
 * tile of a large one) inside a clip box at the position the layout computed; a table page draws
 * its rows with the heights the paginator measured; a document page draws its lines.
 */
import type { CSSProperties } from 'react';
import { footerParts, type ItemBody, type PrintJob } from './printModel';
import type { LayoutPage, PageSetup, PrintLayout } from './printLayout';
import { FOOTER_MM } from './printLayout';
import { pt } from '../../i18n/printText';
import './print.css';

const mm = (v: number): string => `${v}mm`;

export interface PrintPagesProps {
  job: PrintJob;
  layout: PrintLayout;
  setup: PageSetup;
  /** design title for the page footer */
  title: string;
  /** printed date for the page footer */
  date: string;
  /** called when a picture has loaded (the preview waits for them before it enables Print) */
  onImage?: () => void;
}

function TableBody({ body }: { body: Extract<ItemBody, { kind: 'table' }> }) {
  const { content, page } = body;
  return (
    <div className="ms-pp-text">
      {page.first ? (
        <>
          <h2>{content.table.title}</h2>
          {content.table.subtitle ? <p className="ms-pp-sub">{content.table.subtitle}</p> : null}
        </>
      ) : null}
      <table style={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          {page.columnsMm.map((w, i) => (
            <col key={i} style={{ width: mm(w) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {content.table.header.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.rows.map((r, i) => (
            <tr key={i} style={{ height: mm(r.heightMm) }}>
              {r.cells.map((lines, j) => (
                <td key={j}>
                  {lines.map((l, k) => (
                    <div key={k}>{l}</div>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocBody({ body }: { body: Extract<ItemBody, { kind: 'doc' }> }) {
  return (
    <div className="ms-pp-text ms-pp-doc">
      {body.index === 0 ? <h1>{body.content.title}</h1> : null}
      {body.page.lines.map((l, i) => (
        <div key={i} className={`ms-pp-line is-${l.kind}`} style={{ minHeight: mm(l.heightMm) }}>
          {l.text}
        </div>
      ))}
    </div>
  );
}

function PictureBody({ body, page, setup, onImage }: { body: Extract<ItemBody, { kind: 'image' }>; page: LayoutPage; setup: PageSetup; onImage?: () => void }) {
  const style: CSSProperties = {
    left: mm(-page.viewMm.x),
    top: mm(-page.viewMm.y),
    width: mm(page.scaledMm.w),
    height: mm(page.scaledMm.h),
    ...(setup.monochrome ? { filter: 'grayscale(1) contrast(1.15)' } : {}),
  };
  return <img className="ms-pp-img" src={body.content.url} alt={body.content.label} style={style} onLoad={onImage} onError={onImage} draggable={false} />;
}

export function PrintPageView({ job, layout, setup, page, title, date, onImage }: PrintPagesProps & { page: LayoutPage }) {
  const body = job.bodies[page.itemId];
  const { w, h } = layout.paperMm;
  const area = layout.area;
  const f = footerParts({ title, caption: job.captions[page.itemId] ?? '', page, total: layout.all.length });
  return (
    <div className="ms-pp" style={{ width: mm(w), height: mm(h) }} data-page={page.number}>
      <div className="ms-pp-clip" style={{ left: mm(page.placeMm.x), top: mm(page.placeMm.y), width: mm(page.viewMm.w), height: mm(page.viewMm.h) }}>
        {body?.kind === 'image' ? <PictureBody body={body} page={page} setup={setup} onImage={onImage} /> : null}
        {body?.kind === 'table' ? <TableBody body={body} /> : null}
        {body?.kind === 'doc' ? <DocBody body={body} /> : null}
      </div>
      {setup.footer ? (
        <div className="ms-pp-footer" style={{ left: mm(area.x), width: mm(area.w), top: mm(area.y + area.h + 1), height: mm(FOOTER_MM - 1) }}>
          <span>{f.left}</span>
          <span>
            {f.tile ? `${pt('tileOf', { col: f.tile.col, row: f.tile.row, cols: f.tile.cols, rows: f.tile.rows })} · ` : ''}
            {pt('footerPage', { n: f.right })} · {date}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function PrintPages(props: PrintPagesProps) {
  return (
    <>
      {props.layout.pages.map((p) => (
        <PrintPageView key={p.number} {...props} page={p} />
      ))}
    </>
  );
}
