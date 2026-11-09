/**
 * Print preview (File > Print preview…, Ctrl+P): what will be printed, page by page, with the page
 * setup beside it — paper, orientation, margins, scale (fit the page or a fixed zoom), tiling of a
 * sheet larger than the page, colour or black and white, the sheet frame and title block, a page
 * footer, a page range — and the contents: schematic and ladder sheets (all, the current one or
 * the selection), the instrument list, Grapher pages, a report and a lesson hand-out.
 *
 * Works in the browser (Print opens the browser's print dialog, which can also save a PDF) and on
 * the desktop (Print uses the system dialog with the chosen paper; "Save as PDF" writes a file).
 * The chosen page setup is saved with the design when the learner prints.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Dialog } from '../common/Dialog';
import { openHelp } from '../help/open';
import { CheckField, CommitField, SelectField } from '../common/Field';
import { openCustomDialog } from '../common/dialogs';
import { actions, getState, useEditor } from '../store';
import { localeTag, t } from '../../i18n';
import { pt } from '../../i18n/printText';
import { PAPER_SIZES } from '../../model/paper';
import type { Design, PaperSize } from '../../model/types';
import { PrintPageView } from './PrintPages';
import { buildJob } from './printModel';
import { DEFAULT_PAGE_SETUP, MARGIN_RANGE_MM, clampMargin, clampScale, layoutItems, setupFromDesign, setupToDesign, type PageSetup } from './printLayout';
import { DEFAULT_CHOICES, buildContents, lessonChoices, printContributions, reportChoices, type PrintChoices } from './printSources';
import { canSavePdf, printPages, savePagesAsPdf } from './printOutput';

/** Pixels per millimetre of a CSS pixel at 96 dpi. */
const PX_PER_MM = 96 / 25.4;

/** Choices kept while the application runs (the next preview starts where the last one ended). */
let remembered: PrintChoices | null = null;

function choicesFor(design: Design): PrintChoices {
  const ps = design.printSetup;
  const base = remembered ?? DEFAULT_CHOICES;
  return {
    ...base,
    // a report or a lesson hand-out is chosen for one printout, not remembered
    report: '',
    lesson: '',
    scope: remembered ? base.scope : ps?.sheets === 'active' ? 'current' : 'all',
    children: remembered ? base.children : !!ps?.includeChildren,
    instruments: remembered ? base.instruments : !!ps?.includeInstruments,
  };
}

function PrintPreviewDialog({ close, initialChoices }: { close: () => void; initialChoices?: Partial<PrintChoices> }) {
  const design = useEditor((s) => s.design);
  const [setup, setSetup] = useState<PageSetup>(() => setupFromDesign(getState().design.printSetup));
  const [choices, setChoices] = useState<PrintChoices>(() => ({ ...choicesFor(getState().design), ...initialChoices }));
  const [contents, setContents] = useState<Awaited<ReturnType<typeof buildContents>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lessons, setLessons] = useState<{ id: string; title: string }[]>([]);
  const [reports, setReports] = useState<{ id: string; title: string }[]>([]);
  const contribs = useSyncExternalStore(printContributions.subscribe, printContributions.getState, printContributions.getState);
  const grapherAvailable = contribs.some((c) => c.available());
  const pagesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [zoomPick, setZoomPick] = useState<'fit' | '50' | '75' | '100'>('fit');
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const hasChildren = (design.children?.length ?? 0) > 0;
  const date = useMemo(() => new Date().toLocaleDateString(localeTag()), []);

  useEffect(() => {
    void lessonChoices().then(setLessons);
    void reportChoices().then(setReports);
  }, []);

  // pages are rebuilt when the contents change (not when only the layout does)
  const monochrome = setup.monochrome;
  useEffect(() => {
    let live = true;
    const s = getState();
    const timer = setTimeout(() => {
      setBusy(true);
      buildContents({ design: s.design, activeSheetId: s.activeSheetId, selection: s.selection, probeValues: s.probeValues, monochrome }, choices)
        .then((c) => live && setContents(c))
        .catch((err) => live && setMessage(err instanceof Error ? err.message : String(err)))
        .finally(() => live && setBusy(false));
    }, 120);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [choices, monochrome, design]);

  // the preview scales the pages to the width of its panel
  useEffect(() => {
    const el = pagesRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(200, el.clientWidth - 24));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const job = useMemo(() => buildJob(contents ?? [], setup), [contents, setup]);
  const layout = useMemo(() => layoutItems(job.items, setup), [job, setup]);
  const zoom = zoomPick === 'fit' ? Math.min(1.4, width / (layout.paperMm.w * PX_PER_MM)) : Number(zoomPick) / 100;
  const patch = (p: Partial<PageSetup>) => setSetup((s) => ({ ...s, ...p }));
  const choose = (p: Partial<PrintChoices>) => {
    setChoices((c) => {
      const next = { ...c, ...p };
      remembered = next;
      return next;
    });
  };

  /** keep the page setup and the sheet choices in the design file */
  const persist = () => {
    const base = design.printSetup ?? {};
    const next = setupToDesign(setup, { ...base, sheets: choices.scope === 'current' ? 'active' : 'all', includeChildren: choices.children || undefined, includeInstruments: choices.instruments || undefined });
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
    actions.setPrintSetup(next);
  };

  const props = { job, layout, setup, title: design.title, date };
  const print = async () => {
    persist();
    setBusy(true);
    setMessage(null);
    const r = await printPages(props);
    setBusy(false);
    if (!r.ok && r.error) setMessage(pt('printFailed', { reason: r.error }));
    else close();
  };
  const savePdf = async () => {
    persist();
    setBusy(true);
    setMessage(null);
    const r = await savePagesAsPdf(props, `${design.title || 'MachSim'}.pdf`);
    setBusy(false);
    if (r.saved) {
      actions.addSimMessage('info', pt('pdfSaved', { name: r.saved.name }), t('sim.source.print'));
      close();
    } else if (r.error) setMessage(pt('printFailed', { reason: r.error }));
  };

  const count = { printed: layout.pages.length, total: layout.all.length };
  const empty = layout.pages.length === 0;
  const scaleText = setup.scale === 'fit' ? 'fit' : String(setup.scale);
  const paperOptions = PAPER_SIZES.map((p) => ({ value: p, label: p === 'Custom' ? pt('paperCustom') : p }));

  return (
    <Dialog
      title={pt('title')}
      onClose={close}
      width="min(1120px, 96vw)"
      footer={
        <>
          <span className="ms-pv-summary" role="status">
            {busy ? pt('preparing') : pt('summary', { printed: count.printed, total: count.total })}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" className="ms-btn" title={pt('helpTip')} onClick={() => void openHelp({ kind: 'guide', page: 'printing' })}>
            {pt('help')}
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {pt('close')}
          </button>
          {canSavePdf() ? (
            <button type="button" className="ms-btn" disabled={busy || empty || !!layout.rangeError} onClick={() => void savePdf()} title={pt('pdfTip')}>
              {pt('pdf')}
            </button>
          ) : null}
          <button type="button" className="ms-btn ms-btn-primary" disabled={busy || empty || !!layout.rangeError} onClick={() => void print()} title={canSavePdf() ? pt('printTipDesktop') : pt('printTipBrowser')}>
            {pt('print')}
          </button>
        </>
      }
    >
      <div className="ms-pv">
        <div className="ms-pv-options">
          <fieldset>
            <legend>{pt('contents')}</legend>
            <CheckField label={pt('sheets')} checked={choices.sheets} onChange={(v) => choose({ sheets: v })} />
            <SelectField
              label={pt('scope')}
              value={choices.scope}
              disabled={!choices.sheets}
              options={[
                { value: 'all', label: pt('scopeAll') },
                { value: 'current', label: pt('scopeCurrent') },
                { value: 'selection', label: hasSelection ? pt('scopeSelection') : pt('scopeSelectionNone') },
              ]}
              onChange={(v) => choose({ scope: v as PrintChoices['scope'] })}
            />
            {hasChildren ? <CheckField label={pt('children')} checked={choices.children} disabled={!choices.sheets || choices.scope !== 'all'} onChange={(v) => choose({ children: v })} /> : null}
            <CheckField label={pt('frame')} checked={choices.frame} disabled={!choices.sheets || choices.scope === 'selection'} onChange={(v) => choose({ frame: v })} />
            <CheckField label={pt('instruments')} checked={choices.instruments} onChange={(v) => choose({ instruments: v })} />
            <CheckField label={pt('grapher')} checked={choices.grapher && grapherAvailable} disabled={!grapherAvailable} onChange={(v) => choose({ grapher: v })} />
            {!grapherAvailable ? <p className="ms-hint">{pt('grapherNone')}</p> : null}
            <SelectField label={pt('report')} value={choices.report} options={[{ value: '', label: pt('none') }, ...reports.map((r) => ({ value: r.id, label: r.title }))]} onChange={(v) => choose({ report: v })} />
            <SelectField label={pt('lesson')} value={choices.lesson} options={[{ value: '', label: pt('none') }, ...lessons.map((l) => ({ value: l.id, label: l.title }))]} onChange={(v) => choose({ lesson: v })} />
          </fieldset>
          <fieldset>
            <legend>{pt('page')}</legend>
            <SelectField label={pt('paper')} value={setup.paper} options={paperOptions} onChange={(v) => patch({ paper: v as PaperSize, ...(v === 'Custom' && !setup.customMm ? { customMm: { w: 297, h: 210 } } : {}) })} />
            {setup.paper === 'Custom' ? (
              <>
                <CommitField label={pt('customWidth')} value={String(setup.customMm?.w ?? 297)} unit="mm" validate={(v) => (Number(v) >= 50 && Number(v) <= 2000 ? null : pt('customInvalid'))} onCommit={(v) => patch({ customMm: { w: Number(v), h: setup.customMm?.h ?? 210 } })} />
                <CommitField label={pt('customHeight')} value={String(setup.customMm?.h ?? 210)} unit="mm" validate={(v) => (Number(v) >= 50 && Number(v) <= 2000 ? null : pt('customInvalid'))} onCommit={(v) => patch({ customMm: { w: setup.customMm?.w ?? 297, h: Number(v) } })} />
              </>
            ) : null}
            <SelectField
              label={pt('orientation')}
              value={setup.orientation}
              options={[
                { value: 'landscape', label: pt('landscape') },
                { value: 'portrait', label: pt('portrait') },
              ]}
              onChange={(v) => patch({ orientation: v as 'landscape' | 'portrait' })}
            />
            <CommitField
              label={pt('margin')}
              value={String(setup.marginMm)}
              unit="mm"
              validate={(v) => (Number(v) >= MARGIN_RANGE_MM.min && Number(v) <= MARGIN_RANGE_MM.max ? null : pt('marginInvalid', { min: MARGIN_RANGE_MM.min, max: MARGIN_RANGE_MM.max }))}
              onCommit={(v) => patch({ marginMm: clampMargin(Number(v)) })}
            />
            <CommitField
              label={pt('scale')}
              value={scaleText}
              unit={setup.scale === 'fit' ? undefined : '%'}
              validate={(v) => (v.trim().toLowerCase() === 'fit' || (Number.isFinite(Number(v)) && Number(v) >= 5 && Number(v) <= 1000) ? null : pt('scaleInvalid'))}
              onCommit={(v) => patch({ scale: v.trim().toLowerCase() === 'fit' ? 'fit' : clampScale(Number(v)) })}
              hint={pt('scaleHint')}
            />
            <div className="ms-row" style={{ display: 'flex', gap: 6 }}>
              <button type="button" className={`ms-btn ms-btn-small${setup.scale === 'fit' ? ' ms-btn-primary' : ''}`} onClick={() => patch({ scale: 'fit' })}>
                {pt('scaleFit')}
              </button>
              <button type="button" className={`ms-btn ms-btn-small${setup.scale === 100 ? ' ms-btn-primary' : ''}`} onClick={() => patch({ scale: 100 })}>
                100 %
              </button>
            </div>
            <CheckField label={pt('tile')} checked={setup.tile} disabled={setup.scale === 'fit'} onChange={(v) => patch({ tile: v })} />
            {setup.scale === 'fit' ? <p className="ms-hint">{pt('tileNeedsScale')}</p> : null}
            <SelectField
              label={pt('colour')}
              value={setup.monochrome ? 'mono' : 'colour'}
              options={[
                { value: 'colour', label: pt('colourColour') },
                { value: 'mono', label: pt('colourMono') },
              ]}
              onChange={(v) => patch({ monochrome: v === 'mono' })}
            />
            <CheckField label={pt('footer')} checked={setup.footer} onChange={(v) => patch({ footer: v })} />
            <CommitField label={pt('range')} value={setup.pageRange} placeholder="1-3, 5" validate={() => null} onCommit={(v) => patch({ pageRange: v })} hint={layout.rangeError ? <span className="ms-pv-err">{pt('rangeInvalid', { text: layout.rangeError, total: count.total })}</span> : pt('rangeHint')} />
            <button type="button" className="ms-btn ms-btn-small" onClick={() => setSetup(DEFAULT_PAGE_SETUP)}>
              {pt('reset')}
            </button>
          </fieldset>
          <div className="ms-pv-summary">
            <span>{pt('zoom')}</span>
            <select className="ms-select" value={zoomPick} onChange={(e) => setZoomPick(e.target.value as typeof zoomPick)} aria-label={pt('zoom')}>
              <option value="fit">{pt('zoomFit')}</option>
              <option value="50">50 %</option>
              <option value="75">75 %</option>
              <option value="100">100 %</option>
            </select>
          </div>
          {layout.clippedItems.length ? <p className="ms-pv-warn">{pt('clipped', { n: layout.clippedItems.length })}</p> : null}
          {message ? (
            <p className="ms-pv-err" role="alert">
              {message}
            </p>
          ) : null}
          <p className="ms-hint">{canSavePdf() ? pt('hintDesktop') : pt('hintBrowser')}</p>
        </div>
        <div className="ms-pv-pages" ref={pagesRef} aria-label={pt('pages')}>
          {layout.pages.length === 0 ? (
            <p className="ms-pv-empty">{busy ? pt('preparing') : layout.rangeError ? pt('rangeInvalid', { text: layout.rangeError, total: count.total }) : pt('nothing')}</p>
          ) : (
            layout.pages.map((p) => (
              <div key={p.number} className="ms-pv-slot" style={{ width: layout.paperMm.w * PX_PER_MM * zoom, height: layout.paperMm.h * PX_PER_MM * zoom }}>
                <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: `${layout.paperMm.w}mm`, height: `${layout.paperMm.h}mm` }}>
                  <PrintPageView {...props} page={p} />
                </div>
                <span className="ms-pv-no">
                  {p.number} / {count.total}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** File > Print preview (also File > Print and Print setup): open the preview. */
export function openPrintPreview(initial?: Partial<PrintChoices>): void {
  openCustomDialog((close) => <PrintPreviewDialog close={close} initialChoices={initial} />);
}
