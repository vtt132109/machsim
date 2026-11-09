/**
 * ERC options, "delete ERC markers" and the ERC report (lazy chunk, opened by the commands
 * tools.ercOptions / tools.clearErcScope / tools.ercReport and by the ERC tab).
 *
 *   openErcOptionsDialog()   the pin-type matrix (click a cell: allowed → warning → error), the
 *                            hidden-power setting and the NC check; saved in Design.erc
 *   openClearErcDialog()     delete the markers of a scope (all / this sheet / errors / warnings /
 *                            selected parts, src/model/ercReport.ts)
 *   exportErcReportFlow()    the findings as a text, CSV or HTML file, with the Vietnamese
 *                            explanation of every finding
 *   openNcMarkerDialog()     the NC markers of the selected part (PartInstance.ncPins)
 */
import { useMemo, useState } from 'react';
import { DEFAULT_PIN_MATRIX, ERC_PIN_TYPES, normalizePinType, pinPairKey, pinPairLevel, toggleNcPin, type ErcLevel, type ErcPinType, type ErcSettings } from '../../model/ercMatrix';
import { deleteMarkers, ercReportTable, ercReportText, ercSummary, keepMarkers, type ErcReportTexts, type ErcScope } from '../../model/ercReport';
import { tablesToCsv, tablesToHtml } from '../../model/reportFormat';
import type { Design, ErcMessage, PartInstance } from '../../model/types';
import { SAVED_BY } from '../../model/appInfo';
import { buildNetlist } from '../../model/netlister';
import { getSheet } from '../store/designOps';
import { actions, getState, partLookup } from '../store';
import { Dialog } from '../common/Dialog';
import { alertDialog, choiceDialog, openCustomDialog } from '../common/dialogs';
import { Tabs } from '../common/Tabs';
import { openHelp } from '../help/open';
import { exportFile, fileNameForTitle } from '../app/files';
import { explainErc, ruleText, severityText } from '../../i18n/erc';
import { localeTag, t } from '../../i18n';
import { stt } from '../../i18n/schematicToolsText';
import './schematicTools.css';

const LEVELS: ErcLevel[] = ['ok', 'warning', 'error'];
const levelText = (l: ErcLevel): string => stt(l === 'ok' ? 'ercLevelOk' : l === 'warning' ? 'ercLevelWarning' : 'ercLevelError');
const pinTypeText = (p: ErcPinType): string => t(`pinType.${p}`);

/** Number of matrix cells that differ from the defaults. */
function changedCells(matrix: Record<string, ErcLevel> | undefined): number {
  if (!matrix) return 0;
  return Object.entries(matrix).filter(([k, v]) => (DEFAULT_PIN_MATRIX[k] ?? 'ok') !== v).length;
}

function ErcOptionsDialog({ close }: { close: () => void }) {
  const design = getState().design;
  const [settings, setSettings] = useState<ErcSettings>(design.erc ?? {});
  const [tab, setTab] = useState('matrix');
  const matrix = settings.matrix ?? {};

  const cycle = (a: ErcPinType, b: ErcPinType) => {
    const key = pinPairKey(a, b);
    const now = pinPairLevel(a, b, matrix);
    const next = LEVELS[(LEVELS.indexOf(now) + 1) % LEVELS.length];
    const base = DEFAULT_PIN_MATRIX[key] ?? 'ok';
    const nextMatrix = { ...matrix };
    if (next === base) delete nextMatrix[key];
    else nextMatrix[key] = next;
    setSettings({ ...settings, ...(Object.keys(nextMatrix).length ? { matrix: nextMatrix } : { matrix: undefined }) });
  };

  const apply = () => {
    const clean: ErcSettings = {};
    if (settings.pinTypes === false) clean.pinTypes = false;
    if (settings.ncConnected === false) clean.ncConnected = false;
    if (settings.hiddenPower && settings.hiddenPower !== 'auto') clean.hiddenPower = settings.hiddenPower;
    if (settings.matrix && Object.keys(settings.matrix).length) clean.matrix = settings.matrix;
    actions.applyDesign((d) => {
      if (!Object.keys(clean).length) {
        if (!d.erc) return d;
        const { erc: _drop, ...rest } = d;
        return rest as Design;
      }
      return { ...d, erc: clean };
    });
    close();
  };

  const matrixOn = settings.pinTypes !== false;
  return (
    <Dialog
      title={stt('ercTitle')}
      onClose={close}
      width={760}
      className="ms-st-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={() => openHelp({ kind: 'guide', page: 'ercTools' })} title={stt('ercIntro')}>
            {t('help.whatIsThis')}
          </button>
          <button type="button" className="ms-btn" onClick={() => setSettings({})} title={stt('ercReset')}>
            {stt('ercReset')}
          </button>
          <span className="ms-st-spacer" />
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={apply}>
            {'OK'}
          </button>
        </>
      }
    >
      <p className="ms-hint">{stt('ercIntro')}</p>
      <Tabs
        items={[
          { id: 'matrix', title: stt('ercMatrixTab') },
          { id: 'other', title: stt('ercOtherTab') },
        ]}
        active={tab}
        onSelect={setTab}
        ariaLabel={stt('ercTitle')}
        size="small"
      />
      {tab === 'matrix' ? (
        <div>
          <label className="ms-cfield ms-cfield-check">
            <input type="checkbox" checked={matrixOn} onChange={(e) => setSettings({ ...settings, pinTypes: e.target.checked ? undefined : false })} />
            <span>{stt('ercPinTypesOn')}</span>
          </label>
          <p className="ms-hint">{stt('ercMatrixHelp')}</p>
          <p className="ms-hint">{stt('ercMatrixRails')}</p>
          <table className="ms-st-matrix" aria-label={stt('ercMatrixTab')}>
            <thead>
              <tr>
                <th />
                {ERC_PIN_TYPES.map((p) => (
                  <th key={p} scope="col" title={pinTypeText(p)}>
                    {pinTypeText(p)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ERC_PIN_TYPES.map((a) => (
                <tr key={a}>
                  <th scope="row">{pinTypeText(a)}</th>
                  {ERC_PIN_TYPES.map((b) => {
                    const level = pinPairLevel(a, b, matrix);
                    const custom = matrix[pinPairKey(a, b)] !== undefined;
                    return (
                      <td key={b}>
                        <button
                          type="button"
                          className={`ms-st-cell is-${level}${custom ? ' is-custom' : ''}`}
                          disabled={!matrixOn}
                          aria-label={`${pinTypeText(a)} / ${pinTypeText(b)}: ${levelText(level)}`}
                          title={`${pinTypeText(a)} / ${pinTypeText(b)}: ${levelText(level)}`}
                          onClick={() => cycle(a, b)}
                        >
                          {level === 'ok' ? '·' : level === 'warning' ? '!' : '×'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="ms-hint">{stt('ercChanged', { n: changedCells(settings.matrix) })}</p>
        </div>
      ) : (
        <div className="ms-st-fields">
          <label className="ms-cfield ms-cfield-check">
            <input type="checkbox" checked={settings.ncConnected !== false} onChange={(e) => setSettings({ ...settings, ncConnected: e.target.checked ? undefined : false })} />
            <span>{stt('ercNcOn')}</span>
          </label>
          <fieldset className="ms-st-group">
            <legend>{stt('ercHiddenPower')}</legend>
            {(['auto', 'ideal', 'required'] as const).map((m) => (
              <label key={m} className="ms-cfield ms-cfield-check">
                <input type="radio" name="hiddenPower" checked={(settings.hiddenPower ?? 'auto') === m} onChange={() => setSettings({ ...settings, hiddenPower: m })} />
                <span>{stt(m === 'auto' ? 'ercHiddenAuto' : m === 'ideal' ? 'ercHiddenIdeal' : 'ercHiddenRequired')}</span>
              </label>
            ))}
            <p className="ms-hint">{stt('ercHiddenHelp')}</p>
          </fieldset>
        </div>
      )}
    </Dialog>
  );
}

export function openErcOptionsDialog(): void {
  openCustomDialog((close) => <ErcOptionsDialog close={close} />);
}

// ---------------------------------------------------------------------------------------------
// delete markers by scope
// ---------------------------------------------------------------------------------------------

const SCOPES: ErcScope[] = ['all', 'sheet', 'errors', 'warnings', 'selection'];

function ClearErcDialog({ close }: { close: () => void }) {
  const s = getState();
  const markers = s.ercMarkers;
  const sheet = getSheet(s.design, s.activeSheetId);
  const selected = s.selection.filter((i) => i.kind === 'part').map((i) => sheet?.parts.find((p) => p.id === i.id)?.refdes ?? '');
  const opts = { sheetId: s.activeSheetId, refdes: selected.filter(Boolean) };
  const [scope, setScope] = useState<ErcScope>('all');
  const count = (sc: ErcScope) => deleteMarkers(markers, sc, opts).length;
  const run = () => {
    const keep = keepMarkers(markers, scope, opts);
    const removed = markers.length - keep.length;
    actions.setErcMarkers(keep);
    if (!keep.length) actions.clearErcMarkers();
    actions.addSimMessage('info', t('schematicTools.markersDeleted', { n: removed }), 'erc');
    close();
  };
  const label = (sc: ErcScope) =>
    sc === 'all'
      ? stt('scopeAll', { n: count('all') })
      : sc === 'sheet'
        ? stt('scopeSheet', { sheet: sheet?.name ?? '', n: count('sheet') })
        : sc === 'errors'
          ? stt('scopeErrors', { n: count('errors') })
          : sc === 'warnings'
            ? stt('scopeWarnings', { n: count('warnings') })
            : stt('scopeSelection', { n: count('selection') });
  return (
    <Dialog
      title={stt('clearTitle')}
      onClose={close}
      width={460}
      footer={
        <>
          <span className="ms-st-spacer" />
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={count(scope) === 0} onClick={run}>
            {stt('clearButton')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{stt('clearIntro')}</p>
      <div className="ms-st-fields">
        {SCOPES.map((sc) => (
          <label key={sc} className="ms-cfield ms-cfield-check">
            <input type="radio" name="ercScope" checked={scope === sc} disabled={count(sc) === 0} onChange={() => setScope(sc)} />
            <span>{label(sc)}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

export function openClearErcDialog(): void {
  if (!getState().ercMarkers.length) {
    void alertDialog({ title: stt('clearTitle'), message: stt('reportNone') });
    return;
  }
  openCustomDialog((close) => <ClearErcDialog close={close} />);
}

// ---------------------------------------------------------------------------------------------
// ERC report
// ---------------------------------------------------------------------------------------------

/** The localized words of the report (the model stays free of i18n). */
function reportTexts(design: Design, markers: readonly ErcMessage[]): ErcReportTexts {
  const sum = ercSummary(markers);
  const sheetName = (id: string | undefined) => (id === undefined ? '' : (getSheet(design, id)?.name ?? design.children?.flatMap((c) => c.sheets).find((s) => s.id === id)?.name ?? ''));
  return {
    title: stt('reportTitle'),
    caption: stt('reportSummary', { errors: sum.errors, warnings: sum.warnings }),
    clean: stt('reportClean'),
    columns: {
      severity: stt('colSeverity'),
      rule: stt('colRule'),
      sheet: stt('colSheet'),
      refdes: stt('colRefdes'),
      pin: stt('colPin'),
      net: stt('colNet'),
      position: stt('colPosition'),
      problem: stt('colProblem'),
      why: stt('colWhy'),
      fix: stt('colFix'),
    },
    of: (m) => {
      const e = explainErc(m);
      return { severity: severityText(m.severity), rule: ruleText(m.code), title: e.title, why: e.why, fix: e.fix, sheet: sheetName(m.sheetId) };
    },
  };
}

/** Markers to report: the ones on screen, or a fresh ERC run when the tab is empty. */
function markersForReport(): ErcMessage[] {
  const s = getState();
  if (s.ercMarkers.length) return [...s.ercMarkers];
  try {
    return buildNetlist(s.design, { includeAnalysis: false }).erc;
  } catch {
    return [];
  }
}

export type ErcReportFormat = 'txt' | 'csv' | 'html';

/** Ask for the format, then save the ERC findings (the command uses this). */
export async function exportErcReportDialog(): Promise<void> {
  const pick = await choiceDialog({
    title: stt('reportTitle'),
    message: stt('reportFormatAsk'),
    choices: [
      { id: 'txt', label: stt('reportTxt'), primary: true },
      { id: 'csv', label: stt('reportCsv') },
      { id: 'html', label: stt('reportHtml') },
    ],
  });
  if (pick === 'txt' || pick === 'csv' || pick === 'html') await exportErcReportFlow(pick);
}

/** Save the ERC findings as a text, CSV or HTML file. */
export async function exportErcReportFlow(format: ErcReportFormat = 'txt'): Promise<void> {
  const s = getState();
  const markers = markersForReport();
  const texts = reportTexts(s.design, markers);
  const stem = fileNameForTitle(s.design.title || 'design', '').replace(/\.$/, '') || 'design';
  const date = new Date().toLocaleString(localeTag());
  if (format === 'txt') {
    const text = ercReportText(markers, texts, { design: s.design.title, file: s.fileName, date, tool: SAVED_BY });
    await exportFile(`${stem}-erc.txt`, text, { name: stt('reportTitle'), extensions: ['txt'] });
    return;
  }
  const table = ercReportTable(markers, texts);
  if (format === 'csv') {
    await exportFile(`${stem}-erc.csv`, tablesToCsv([table]), { name: 'CSV', extensions: ['csv'] });
    return;
  }
  const html = tablesToHtml(stt('reportTitle'), [table], { lang: localeTag(), lines: [s.design.title, s.fileName, date, SAVED_BY].filter(Boolean) });
  await exportFile(`${stem}-erc.html`, html, { name: 'HTML', extensions: ['html'] });
}

// ---------------------------------------------------------------------------------------------
// NC markers
// ---------------------------------------------------------------------------------------------

function NcMarkerDialog({ inst, close }: { inst: PartInstance; close: () => void }) {
  const def = partLookup(inst.partId);
  const build = useMemo(() => {
    try {
      return buildNetlist(getState().design, { includeAnalysis: false });
    } catch {
      return null;
    }
  }, []);
  const nets = build?.partNets[inst.refdes] ?? {};
  const [marks, setMarks] = useState<string[]>(inst.ncPins ?? []);
  const pins = def ? def.symbol.pins : [];
  const isOpen = (pin: string) => {
    const node = nets[pin];
    return node === undefined || node.startsWith('NC_');
  };
  const toggle = (pin: string) => setMarks((m) => toggleNcPin({ ncPins: m }, pin) ?? []);
  const save = () => {
    const before = (inst.ncPins ?? []).length;
    actions.updatePart(inst.id, { ncPins: marks.length ? [...new Set(marks)].sort() : undefined });
    actions.addSimMessage(
      'info',
      marks.length >= before ? t('schematicTools.ncMarked', { refdes: inst.refdes, n: marks.length }) : t('schematicTools.ncCleared', { refdes: inst.refdes, n: before - marks.length }),
      'erc',
    );
    close();
  };
  return (
    <Dialog
      title={stt('ncTitle', { refdes: inst.refdes })}
      onClose={close}
      width={420}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={() => setMarks(pins.filter((p) => isOpen(p.name)).map((p) => p.name))}>
            {stt('ncAllOpen')}
          </button>
          <button type="button" className="ms-btn" onClick={() => setMarks([])}>
            {stt('ncNone')}
          </button>
          <span className="ms-st-spacer" />
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={save}>
            {'OK'}
          </button>
        </>
      }
    >
      <p className="ms-hint">{stt('ncIntro')}</p>
      <div className="ms-st-pins">
        {pins.map((p) => (
          <label key={p.name} className="ms-cfield ms-cfield-check">
            <input type="checkbox" checked={marks.includes(p.name)} onChange={() => toggle(p.name)} />
            <span>
              {stt('ncPin', { pin: p.name })} <small className="ms-st-dim">{isOpen(p.name) ? stt('ncOpen') : stt('ncConnected')}</small>
              {p.type ? <small className="ms-st-dim"> · {t(`pinType.${normalizePinType(p.type)}`)}</small> : null}
            </span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}

/** NC markers of the selected part (or of `partId`). */
export function openNcMarkerDialog(partId?: string): void {
  const s = getState();
  const sheet = getSheet(s.design, s.activeSheetId);
  const id = partId ?? s.selection.find((i) => i.kind === 'part')?.id;
  const inst = id ? sheet?.parts.find((p) => p.id === id) : undefined;
  if (!inst) {
    void alertDialog({ title: t('cmd.edit.ncMarker'), message: t('schematicTools.selectPartFirst') });
    return;
  }
  openCustomDialog((close) => <NcMarkerDialog inst={inst} close={close} />);
}
