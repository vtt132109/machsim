/**
 * Application dialogs: find part, properties (part / wire / label / probe / note), sheet and
 * design properties and about (help pages live in src/ui/help). Each `open*` function shows
 * a modal through the shared dialog stack (src/ui/common/dialogs.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import { getDesktopBridge } from '../../desktop/bridge';
import { actions, useEditor } from '../store';
import { findItem, searchPartsByRefdes } from '../store/designOps';
import type { SelItem } from '../store/types';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { ItemProperties, PartProperties, SheetAndDesignProperties } from '../editor/PropertiesPanel';
import { focusCanvas } from '../editor/controller';
import { partLookup } from '../store';
import { openHelp } from '../help/open';
import { t } from '../../i18n';
import { partName } from '../../i18n/library';

export { APP_NAME, APP_VERSION } from '../../model/appInfo';
import { APP_NAME, APP_VERSION } from '../../model/appInfo';

function CloseFooter({ close }: { close: () => void }) {
  return (
    <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
      {t('common.close')}
    </button>
  );
}

// ---------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------

function FindDialog({ close }: { close: () => void }) {
  const design = useEditor((s) => s.design);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const results = useMemo(() => searchPartsByRefdes(design, query), [design, query]);
  const sheetName = (id: string) => design.sheets.find((s) => s.id === id)?.name ?? '';
  const go = (i: number) => {
    const r = results[i];
    if (!r) return;
    actions.findAndShow(r.part.refdes);
    close();
    focusCanvas();
  };
  return (
    <Dialog
      title={t('app.appDialogs.findPart')}
      onClose={close}
      width={420}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={results.length === 0} onClick={() => go(index)}>
            {t('common.show')}
          </button>
        </>
      }
    >
      <div className="ms-form">
        <label className="ms-field">
          <span>{t('app.appDialogs.referenceDesignatorPartOfIt')}</span>
          <input
            data-autofocus
            value={query}
            spellCheck={false}
            placeholder={t('app.appDialogs.eGR12U3Xsc')}
            aria-controls="ms-find-results"
            aria-activedescendant={results[index] ? `ms-find-${index}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(index);
              }
            }}
          />
        </label>
        <div id="ms-find-results" role="listbox" aria-label={t('app.appDialogs.matchingParts')} className="ms-find-results">
          {query.trim() && results.length === 0 ? <div className="ms-empty">{t('app.appDialogs.noPartMatchesTrim', { trim: query.trim() })}</div> : null}
          {results.slice(0, 200).map((r, i) => (
            <div
              key={r.part.id}
              id={`ms-find-${i}`}
              role="option"
              aria-selected={i === index}
              className={`ms-find-row ${i === index ? 'is-active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => go(i)}
            >
              <strong>{r.part.refdes}</strong>
              <span>{(() => { const d = partLookup(r.part.partId); return d ? partName(d) : r.part.partId; })()}</span>
              <span className="ms-hint">{sheetName(r.sheetId)}</span>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function openFindDialog(): void {
  openCustomDialog((close) => <FindDialog close={close} />);
}

// ---------------------------------------------------------------------------
// properties
// ---------------------------------------------------------------------------

function PropertiesDialog({ item, close }: { item: SelItem; close: () => void }) {
  const title = useEditor((s) => {
    const f = findItem(s.design, item.kind, item.id);
    if (!f) return t('common.properties');
    if (item.kind === 'part') return t('app.appDialogs.partProperties', { refdes: (f.item as { refdes: string }).refdes });
    return { wire: t('app.appDialogs.wireProperties'), label: t('app.appDialogs.netLabelProperties'), probe: t('app.appDialogs.probeProperties'), note: t('app.appDialogs.textProperties'), part: t('common.properties'), shape: t('schematic.dialog.shapeProperties') }[item.kind];
  });
  return (
    <Dialog title={title} onClose={close} width={460} className="ms-props-dialog" footer={<CloseFooter close={close} />}>
      {item.kind === 'part' ? <PartProperties partId={item.id} /> : <ItemProperties item={item} />}
    </Dialog>
  );
}

/** Properties dialog for one item (changes apply immediately, each commit is one undo step). */
export function openPropertiesDialog(item: SelItem): void {
  openCustomDialog((close) => <PropertiesDialog item={item} close={close} />);
}

export function openSheetPropertiesDialog(): void {
  openCustomDialog((close) => (
    <Dialog title={t('app.appDialogs.sheetAndDesignProperties')} onClose={close} width={460} className="ms-props-dialog" footer={<CloseFooter close={close} />}>
      <SheetAndDesignProperties />
    </Dialog>
  ));
}

// ---------------------------------------------------------------------------
// help
// ---------------------------------------------------------------------------

/** Keyboard-shortcut sheet: the help browser opened on its shortcuts page. */
export function openShortcutsDialog(): void {
  void openHelp({ kind: 'shortcuts' });
}

function AboutBody() {
  const [desktop, setDesktop] = useState<string | null>(null);
  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    bridge
      .info()
      .then((i) => setDesktop(t('app.appDialogs.desktopInfo', { version: i.version, electron: i.electron, platform: i.platform })))
      .catch(() => undefined);
  }, []);
  return (
    <div className="ms-about">
      <div className="ms-about-mark" aria-hidden="true">
        <svg viewBox="0 0 48 48" width="48" height="48">
          <rect x="2" y="2" width="44" height="44" rx="9" fill="var(--accent)" />
          <path d="M9 30h7l4-12 6 18 4-10h9" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <h3>
          {APP_NAME} <span className="ms-hint">{t('app.appDialogs.versionAppversion', { APPVERSION: APP_VERSION })}</span>
        </h3>
        <p>{t('app.appDialogs.offlineSchematicCaptureAndSpice')}</p>
        <p className="ms-hint">
          {t('app.appDialogs.machsimIsOriginalSoftwareIts')}
        </p>
        {desktop ? <p className="ms-hint">{desktop}</p> : null}
      </div>
    </div>
  );
}

export function openAboutDialog(): void {
  openCustomDialog((close) => (
    <Dialog title={t('app.appDialogs.aboutAppname', { APPNAME: APP_NAME })} onClose={close} width={480} footer={<CloseFooter close={close} />}>
      <AboutBody />
    </Dialog>
  ));
}
