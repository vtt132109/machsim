/**
 * Select a component (Place › Component…, Ctrl+K): the database / group / family / component
 * browser with symbol preview and the component's details, loaded on first use.
 *
 * - Database: Master (the built-in library, read-only), Corporate, User (src/ui/parts/partDatabases).
 * - Group (or All groups) → Family (or All families) → Component; every list is virtualised and a
 *   group's catalogue packs load the first time it is chosen. Search covers the chosen group (or
 *   the whole database) incrementally, with or without Vietnamese accents and by value ("4,7k").
 * - Details: Function, Model manufacturer / ID / kind, Package manufacturer / type, Hyperlink (a user
 *   component's web link, else the in-app help page), key specifications; buttons Detail report
 *   (tables + model text, copy / save HTML) and View model (read-only for built-in parts; a user
 *   component's own SPICE text can be edited and saved back to its database).
 * - Place (double-click / Enter): the dialog closes and the ghost follows the cursor. With "Reopen
 *   after placing" (on by default) the tool places one part and the dialog opens again at the same
 *   family for the next part; off, every click places a copy until Esc.
 * The last database / group / family / part and the option are remembered in browser storage.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { GROUPS, getPart, groupState, isBuiltinPart, loadAllGroups, pendingPartCount, runtimeParts } from '../../library';
import type { PartDef, PartGroup } from '../../library/types';
import { partDetailReport, partDetails, partModelText, type PartDatabaseKind } from '../../library/partInfo';
import { isCustomPartDef, customPartProblems } from '../../library/custom/partDef';
import { tablesToHtml } from '../../model/reportFormat';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { VirtualList } from '../common/VirtualList';
import { actions, getState, subscribe } from '../store';
import { focusCanvas } from '../editor/controller';
import { SymbolPreview } from '../editor/SymbolPreview';
import { buildBrowserTree, familiesRowModel, listRowModel, treeKeyModel, type FamilyNode, type RowModel } from '../editor/browserModel';
import { useCatalogueSearch, useGroupLoading, useIdleIndexing, useLibraryParts } from '../editor/catalogueHooks';
import { recordRecent, toggleFavourite, useLibraryPrefs } from '../editor/libraryPrefs';
import { specRows } from '../editor/specText';
import { browserStorage } from '../app/files';
import { openHelp, topicForPart } from '../help/open';
import { familyName, groupName, partDescription, partName } from '../../i18n/library';
import { getLang, localeTag, t, tDynamic } from '../../i18n';
import { pt } from '../../i18n/placeText';
import { databaseName, detailFields, detailReportTables, reportText } from './placeReport';
import { keepPlacing, type PlaceHost } from './keepPlacing';
import { downloadText } from './fileIo';
import { findUserPart, savePart, usePartDatabases, type DbKind } from './partDatabases';
import './place.css';

const ROW = 22;
const PREFS_KEY = 'machsim.placeDialog.v1';

type DbChoice = 'master' | DbKind;

interface PlacePrefs {
  db: DbChoice;
  group: PartGroup | 'all';
  family: string | null;
  partId: string | null;
  keepPlacing: boolean;
}

const DEFAULT_PREFS: PlacePrefs = { db: 'master', group: 'sources', family: null, partId: null, keepPlacing: true };

function readPrefs(): PlacePrefs {
  try {
    const raw = browserStorage()?.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const v = JSON.parse(raw) as Partial<PlacePrefs>;
    return {
      db: v.db === 'user' || v.db === 'corporate' ? v.db : 'master',
      group: v.group === 'all' || GROUPS.some((g) => g.id === v.group) ? (v.group as PlacePrefs['group']) : 'sources',
      family: typeof v.family === 'string' ? v.family : null,
      partId: typeof v.partId === 'string' ? v.partId : null,
      keepPlacing: v.keepPlacing !== false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: PlacePrefs): void {
  try {
    browserStorage()?.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable: the dialog starts from the defaults next time
  }
}

/** Where a part sits in the dialog: its database, group and family. */
function locate(def: PartDef): Pick<PlacePrefs, 'db' | 'group' | 'family'> {
  const db: DbChoice = isBuiltinPart(def.id) ? 'master' : runtimeParts('db:corporate').some((p) => p.id === def.id) && !runtimeParts('db:user').some((p) => p.id === def.id) ? 'corporate' : 'user';
  return { db, group: def.group, family: def.family || 'General' };
}

/** Open the dialog (optionally with a part selected). */
export function openPlaceComponentDialog(opts: { partId?: string } = {}): void {
  openCustomDialog((close) => <PlaceComponentDialog close={close} partId={opts.partId} />);
}

/** The editor store as the "reopen after placing" watcher sees it (src/ui/parts/keepPlacing.ts). */
const editorPlaceHost: PlaceHost = {
  startPlacing: (partId, opts) => actions.startPlacing(partId, opts),
  onPartPlaced: (cb) => actions.onPartPlaced(cb),
  subscribe,
  placingNow: () => {
    const tool = getState().tool;
    return tool.kind === 'place' ? tool.partId : null;
  },
  defer: (fn) => {
    setTimeout(fn, 0);
  },
};

/** Start placing `def`; with keepPlacing on, the dialog reopens after the part is placed. */
function placeFromDialog(def: PartDef, keepPlacingOn: boolean): void {
  recordRecent(def.id);
  if (keepPlacingOn) keepPlacing(editorPlaceHost, def.id, (partId) => openPlaceComponentDialog({ partId }));
  else actions.startPlacing(def.id);
  focusCanvas();
}

function PlaceComponentDialog({ close, partId }: { close: () => void; partId?: string }) {
  const parts = useLibraryParts();
  const dbs = usePartDatabases();
  const prefs = useLibraryPrefs();
  const [state, setState] = useState<PlacePrefs>(() => {
    const p = readPrefs();
    const def = partId ? getPart(partId) : p.partId ? getPart(p.partId) : undefined;
    return def ? { ...p, ...locate(def), partId: def.id } : p;
  });
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<PlacePrefs>) => setState((s) => ({ ...s, ...patch }));
  useEffect(() => writePrefs(state), [state]);

  // the parts of the chosen database
  const dbParts = useMemo(() => {
    if (state.db === 'master') return parts.filter((p) => isBuiltinPart(p.id));
    return [...runtimeParts(`db:${state.db}`)];
    // the databases' parts change with `dbs`
    // (`parts` changes when a catalogue pack or a database is registered)
  }, [parts, state.db, dbs]);
  const tree = useMemo(() => buildBrowserTree(dbParts, GROUPS, state.db === 'master' ? pendingPartCount : undefined), [dbParts, state.db]);
  // a chosen group loads its catalogue packs; "All groups" loads them all
  useGroupLoading(state.group === 'all' ? [] : [state.group]);
  useEffect(() => {
    if (state.group === 'all') void loadAllGroups();
  }, [state.group]);
  // while the dialog is open, the loaded parts get their search index built in the background
  useIdleIndexing(parts);

  const groupNode = state.group === 'all' ? null : (tree.find((g) => g.group.id === state.group) ?? null);
  const families: FamilyNode[] = useMemo(() => (state.group === 'all' ? tree.flatMap((g) => g.families) : (groupNode?.families ?? [])), [tree, groupNode, state.group]);
  const familyLabel = (f: FamilyNode) => {
    if (state.group !== 'all') return familyName(f.name);
    const gid = f.key.slice(2, f.key.indexOf('/'));
    return pt('familyInGroup', { group: groupName(gid as PartGroup), family: familyName(f.name) });
  };
  const scopeParts = useMemo(() => (state.group === 'all' ? dbParts : dbParts.filter((p) => p.group === state.group)), [dbParts, state.group]);
  const search = useCatalogueSearch(scopeParts, query);
  const searching = query.trim().length > 0;
  const family = families.find((f) => f.name === state.family) ?? null;
  const rows: RowModel = useMemo(() => (searching ? listRowModel(search.results) : family ? familiesRowModel([family]) : familiesRowModel(families)), [searching, search.results, family, families]);

  const selected = state.partId ? getPart(state.partId) : undefined;
  const selIndex = selected ? rows.indexOf(`p:${selected.id}`) : -1;
  const groupLoading = state.group !== 'all' ? groupState(state.group) === 'loading' : families.length === 0 && state.db === 'master';
  const total = scopeParts.length + (state.db === 'master' && state.group !== 'all' ? pendingPartCount(state.group) : 0);

  const place = (def: PartDef) => {
    writePrefs({ ...state, partId: def.id });
    close();
    placeFromDialog(def, state.keepPlacing);
  };

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && selected) {
      e.preventDefault();
      place(selected);
      return;
    }
    const r = treeKeyModel(rows, selected ? `p:${selected.id}` : null, e.key);
    if (!r?.active) return;
    e.preventDefault();
    const row = rows.at(rows.indexOf(r.active));
    if (row?.kind === 'part') set({ partId: row.part.id });
  };

  const dbChoices: DbChoice[] = ['master', 'corporate', 'user'];
  const dbCount = (d: DbChoice) => (d === 'master' ? parts.filter((p) => isBuiltinPart(p.id)).length : dbs[d].parts.length);

  return (
    <Dialog
      title={pt('title')}
      onClose={close}
      width="min(1080px, 97vw)"
      className="ms-place-dialog"
      footer={
        <>
          <label className="ms-check ms-place-keep" title={pt('tipKeepPlacing')}>
            <input type="checkbox" checked={state.keepPlacing} onChange={(e) => set({ keepPlacing: e.target.checked })} />
            <span>{pt('keepPlacing')}</span>
          </label>
          <button type="button" className="ms-btn" onClick={() => void openHelp({ kind: 'guide', page: 'placement' })} title={t('help.whatIsThis')}>
            ?
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!selected} title={pt('tipPlace')} onClick={() => selected && place(selected)}>
            {pt('place')}
          </button>
        </>
      }
    >
      <p className="ms-hint ms-place-intro">{pt('intro')}</p>
      <div className="ms-place-bar">
        <label className="ms-place-field" title={pt('tipDatabase')}>
          <span>{pt('database')}</span>
          <select className="ms-input" value={state.db} aria-label={pt('database')} onChange={(e) => set({ db: e.target.value as DbChoice, family: null, partId: null })}>
            {dbChoices.map((d) => (
              <option key={d} value={d}>
                {pt('dbCount', { name: databaseName(d as PartDatabaseKind), n: dbCount(d) })}
              </option>
            ))}
          </select>
        </label>
        <label className="ms-place-field" title={pt('tipGroup')}>
          <span>{pt('group')}</span>
          <select className="ms-input" value={state.group} aria-label={pt('group')} onChange={(e) => set({ group: e.target.value as PlacePrefs['group'], family: null })}>
            <option value="all">{pt('allGroups')}</option>
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {groupName(g.id)}
              </option>
            ))}
          </select>
        </label>
        <label className="ms-place-field ms-place-search" title={pt('tipSearch')}>
          <span>{pt('search')}</span>
          <input
            className="ms-input"
            type="search"
            data-autofocus
            value={query}
            spellCheck={false}
            placeholder={pt('searchPlaceholder')}
            aria-label={pt('search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                const first = rows.at(0);
                if (first?.kind === 'part') set({ partId: first.part.id });
                listRef.current?.querySelector<HTMLElement>('.ms-vlist')?.focus();
              } else if (e.key === 'Enter' && selected) {
                e.preventDefault();
                place(selected);
              }
            }}
          />
        </label>
      </div>
      <div className="ms-place-body">
        <section className="ms-place-col ms-place-families" aria-label={pt('family')}>
          <h4 title={pt('tipFamily')}>{pt('family')}</h4>
          <VirtualList
            count={families.length + 1}
            rowHeight={ROW}
            ariaLabel={pt('family')}
            activeIndex={family ? families.indexOf(family) + 1 : 0}
            renderRow={(i) => {
              const f = i === 0 ? null : families[i - 1];
              const active = f ? f === family : !family;
              return (
                <div key={f?.key ?? '*'} role="option" aria-selected={active} className={`ms-place-row${active ? ' is-active' : ''}`} onClick={() => set({ family: f ? f.name : null })}>
                  <span className="ms-place-label">{f ? familyLabel(f) : pt('allFamilies')}</span>
                  <span className="ms-place-count">{f ? f.size : total}</span>
                </div>
              );
            }}
            onKeyDown={(e) => {
              const idx = family ? families.indexOf(family) + 1 : 0;
              const next = e.key === 'ArrowDown' ? Math.min(families.length, idx + 1) : e.key === 'ArrowUp' ? Math.max(0, idx - 1) : -1;
              if (next < 0) return;
              e.preventDefault();
              set({ family: next === 0 ? null : families[next - 1].name });
            }}
          />
        </section>
        <section className="ms-place-col ms-place-parts" aria-label={pt('components')} ref={listRef}>
          <h4 title={pt('tipComponents')}>
            {pt('components')} <span className="ms-hint">{pt('count', { n: rows.count })}</span>
          </h4>
          {groupLoading ? <div className="ms-hint" role="status">{pt('loadingGroup')}</div> : null}
          {searching && search.progress !== null ? <div className="ms-hint" role="status">{pt('searching', { percent: Math.round(search.progress * 100) })}</div> : null}
          {searching && search.loadingMore ? <div className="ms-hint" role="status">{pt('loadingMore')}</div> : null}
          <VirtualList
            count={rows.count}
            rowHeight={ROW}
            ariaLabel={pt('components')}
            activeIndex={selIndex}
            activeId={selIndex >= 0 ? `ms-place-${selIndex}` : undefined}
            onKeyDown={onListKey}
            empty={searching ? pt('noResults', { q: query.trim() }) : state.db !== 'master' && dbParts.length === 0 ? pt('emptyDb', { db: databaseName(state.db as PartDatabaseKind) }) : null}
            renderRow={(i) => {
              const r = rows.at(i);
              if (!r || r.kind !== 'part') return null;
              const p = r.part;
              const active = p.id === selected?.id;
              return (
                <div
                  key={r.key}
                  id={`ms-place-${i}`}
                  role="option"
                  aria-selected={active}
                  className={`ms-place-row ms-place-part${active ? ' is-active' : ''}`}
                  title={partDescription(p)}
                  onClick={() => set({ partId: p.id })}
                  onDoubleClick={() => place(p)}
                >
                  <span className="ms-place-label">{partName(p)}</span>
                  {p.id.startsWith('custom:') ? <span className="ms-tree-meta ms-tree-user">{pt('userBadge')}</span> : null}
                  <span className="ms-place-desc">{partDescription(p)}</span>
                </div>
              );
            }}
          />
        </section>
        <section className="ms-place-col ms-place-detail" aria-label={pt('symbol')} aria-live="polite">
          {selected ? <PartDetail def={selected} favourite={prefs.favourites.includes(selected.id)} /> : <p className="ms-hint">{pt('pickOne')}</p>}
        </section>
      </div>
    </Dialog>
  );
}

/** Open a part's hyperlink: its web page (new browser window / the system browser on desktop) or its help page. */
function openLink(def: PartDef): void {
  const d = partDetails(def);
  if (d.hyperlink.kind === 'url') window.open(d.hyperlink.url, '_blank', 'noopener,noreferrer');
  else void openHelp(topicForPart(def));
}

function PartDetail({ def, favourite }: { def: PartDef; favourite: boolean }) {
  const d = useMemo(() => partDetails(def), [def]);
  const specs = specRows(def, 6);
  return (
    <div className="ms-place-info">
      <h4>
        {partName(def)} <span className="ms-hint">({def.prefix})</span>
        <button type="button" className={`ms-icon-btn ms-tree-fav ${favourite ? 'is-on' : ''}`} aria-pressed={favourite} title={pt('tipFavourite')} aria-label={pt('favourite')} onClick={() => toggleFavourite(def.id)}>
          {favourite ? '★' : '☆'}
        </button>
      </h4>
      <SymbolPreview def={def} className="ms-place-symbol" />
      <dl className="ms-place-fields">
        {detailFields(d, def).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div>
          <dt>{pt('hyperlink')}</dt>
          <dd>
            <button type="button" className="ms-link-btn" title={d.hyperlink.kind === 'url' ? pt('tipLinkUrl', { url: d.hyperlink.url }) : pt('tipLinkHelp')} onClick={() => openLink(def)}>
              {d.hyperlink.kind === 'url' ? d.hyperlink.url : pt('linkHelp')}
            </button>
          </dd>
        </div>
        {specs.map((s) => (
          <div key={s.key}>
            <dt>{s.label}</dt>
            <dd>{s.value}</dd>
          </div>
        ))}
      </dl>
      <div className="ms-btn-row">
        <button type="button" className="ms-btn ms-btn-small" title={pt('tipDetailReport')} onClick={() => openDetailReport(def)}>
          {pt('detailReport')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={pt('tipViewModel')} onClick={() => openModelView(def)}>
          {pt('viewModel')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Detail report

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function safeName(name: string): string {
  return name.replace(/[<>:"/\\|?*\s]+/g, '_') || 'part';
}

/** Detail report of a part: tables, the model text, copy and save as HTML. */
export function openDetailReport(def: PartDef): void {
  openCustomDialog((close) => <DetailReportDialog def={def} close={close} />);
}

function DetailReportDialog({ def, close }: { def: PartDef; close: () => void }) {
  const report = useMemo(() => partDetailReport(def), [def]);
  const tables = useMemo(() => detailReportTables(report, def), [report, def]);
  const [note, setNote] = useState('');
  const html = () =>
    tablesToHtml(pt('reportTitle', { name: partName(def) }), [...tables, { title: pt('reportModel'), columns: [pt('reportModel')], rows: [[report.model.text || pt('noModelText')]] }], {
      lang: getLang(),
      lines: [new Date().toLocaleString(localeTag()), pt('reportTool')],
    });
  return (
    <Dialog
      title={pt('reportTitle', { name: partName(def) })}
      onClose={close}
      width="min(820px, 96vw)"
      className="ms-place-report"
      footer={
        <>
          {note ? <span className="ms-hint">{note}</span> : null}
          <button type="button" className="ms-btn" onClick={() => void copyText(reportText(report, def)).then((ok) => setNote(ok ? pt('copied') : ''))}>
            {pt('copy')}
          </button>
          <button type="button" className="ms-btn" onClick={() => void downloadText(html(), `${safeName(def.name)}-report.html`, 'text/html')}>
            {pt('saveHtml')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      {tables.map((tb) => (
        <section key={tb.title} className="ms-place-report-table">
          <h4>{tb.title}</h4>
          <table className="ms-table">
            <thead>
              <tr>
                {tb.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j} className="ms-wrap">
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <section className="ms-place-report-table">
        <h4>{pt('reportModel')}</h4>
        <pre className="ms-place-model">{report.model.text || pt('noModelText')}</pre>
      </section>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// View model

/** The SPICE text behind a part (read-only for built-in parts; a user component's own text is editable). */
export function openModelView(def: PartDef): void {
  openCustomDialog((close) => <ModelDialog def={def} close={close} />);
}

function ModelDialog({ def, close }: { def: PartDef; close: () => void }) {
  const m = useMemo(() => partModelText(def), [def]);
  const owner = isCustomPartDef(def) ? findUserPart(def.id) : undefined;
  const editable = m.editable && !!owner;
  const [text, setText] = useState(m.text);
  const [note, setNote] = useState('');
  const save = async () => {
    if (!owner || owner.part.model.kind !== 'spice') return;
    const next = { ...owner.part, model: { ...owner.part.model, text } };
    const problems = customPartProblems(next);
    if (problems.length) {
      setNote(pt('modelProblem', { problem: tDynamic(`parts.issue.${problems[0].code}`, problems[0].params, problems[0].code) }));
      return;
    }
    await savePart(owner.kind, next);
    setNote(pt('modelSaved', { name: partName(def) }));
  };
  const hint = m.source === 'none' ? pt('modelNone') : m.source === 'listing' ? `${pt('modelReadOnly')} ${pt('modelListing')}` : editable ? pt('modelUser', { db: databaseName(owner!.kind) }) : pt('modelDesignOnly');
  return (
    <Dialog
      title={pt('modelTitle', { name: partName(def) })}
      onClose={close}
      width="min(760px, 96vw)"
      footer={
        <>
          {note ? <span className="ms-hint">{note}</span> : null}
          {m.text ? (
            <button type="button" className="ms-btn" onClick={() => void copyText(text).then((ok) => setNote(ok ? pt('copied') : ''))}>
              {pt('copy')}
            </button>
          ) : null}
          {editable ? (
            <button type="button" className="ms-btn" disabled={text === m.text} onClick={() => void save()}>
              {pt('modelSave')}
            </button>
          ) : null}
          <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{hint}</p>
      {m.text ? <textarea className="ms-input ms-place-model" spellCheck={false} readOnly={!editable} value={text} aria-label={pt('viewModel')} onChange={(e) => setText(e.target.value)} /> : null}
    </Dialog>
  );
}
