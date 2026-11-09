/**
 * Component browser (left panel): library groups → families → parts as an accessible tree,
 * catalogue search, favourites and recently used parts, per-family specification filters, symbol
 * preview with key specifications, and placement.
 *
 * - Click a part (or press Enter on it) to enter placement mode; the ghost follows the cursor on
 *   the canvas and every click places a copy until Esc.
 * - Drag a part onto the canvas to drop one instance at that point.
 * - ☆ on a part row adds it to the favourites; placed parts appear under "Recent".
 * - Selecting a family (or a part in it) shows the family's specification filters (for example
 *   VCEO, IC and package for transistors); the family row then counts "shown / total".
 * - The list is virtualised (fixed 22 px rows; the row model creates only the rows in view), so
 *   families with tens of thousands of parts stay fast; big catalogues are searched incrementally.
 * - Catalogue packs (big part-number tables) load the first time their group is opened or the
 *   catalogue is searched; the group row shows "loading…" meanwhile.
 * - "Details…" under the preview opens the Select-a-component dialog (function, model, package,
 *   link, detail report, model text).
 * - Keyboard: ↑/↓/Home/End move, → expands / enters, ← collapses / goes to the parent,
 *   Enter places; typing in the search box filters the whole catalogue (Esc clears).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GROUPS, getPart, groupState, pendingPartCount } from '../../library';
import type { PartDef } from '../../library/types';
import { actions, useEditor } from '../store';
import { Icon } from '../common/icons';
import { Tabs } from '../common/Tabs';
import {
  buildBrowserTree,
  familySpecFields,
  isEmptyFilter,
  partKey,
  pathToPart,
  scrollIntoRow,
  treeKeyModel,
  virtualWindow,
  applySpecFilter,
  listRowModel,
  treeRowModel,
  type BrowserRow,
  type FamilyNode,
  type RowModel,
  type SpecField,
  type SpecFilter,
} from './browserModel';
import { useCatalogueSearch, useGroupLoading, useIdleIndexing, useIdsLoaded, useLibraryParts } from './catalogueHooks';
import { SymbolPreview } from './SymbolPreview';
import { focusCanvas, PART_DRAG_MIME } from './controller';
import { clearRecent, recordRecent, toggleFavourite, useLibraryPrefs } from './libraryPrefs';
import { specLabel, specRows, specValueText } from './specText';
import './editor.css';
import { t } from '../../i18n';
import { familyName, groupName, partDescription, partName } from '../../i18n/library';
import { openHelp, setFocusHelp, topicForPart, type HelpTopic } from '../help/open';

/** Height of one tree row in px (must match .ms-tree-row in editor.css). */
export const ROW_HEIGHT = 22;

type View = 'library' | 'favourites' | 'recent';

let searchInput: HTMLInputElement | null = null;

/** Focus the browser's search field (Place > Component…). Returns false when the browser is hidden. */
export function focusComponentSearch(): boolean {
  if (!searchInput || !searchInput.isConnected) return false;
  searchInput.focus();
  searchInput.select();
  return true;
}

function rowId(key: string): string {
  return `ms-cb-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** "What is this?" page of a tree row: its group, family or part. */
function rowTopic(row: BrowserRow): HelpTopic | null {
  if (row.kind === 'group') return { kind: 'group', group: row.node.group.id };
  if (row.kind === 'family') {
    const group = row.node.parts[0]?.group;
    return group ? { kind: 'family', group, family: row.node.name } : null;
  }
  return topicForPart(row.part);
}

function placePart(def: PartDef): void {
  recordRecent(def.id);
  actions.startPlacing(def.id);
  focusCanvas();
}

/** The Select-a-component dialog with this part selected (lazy chunk). */
function openDetails(def: PartDef): void {
  void import('../parts/PlaceComponentDialog').then((m) => m.openPlaceComponentDialog({ partId: def.id }));
}

export function ComponentBrowser() {
  // user components (part databases, the open design) and catalogue packs join the list at run time
  const parts = useLibraryParts();
  const tree = useMemo(() => buildBrowserTree(parts, GROUPS, pendingPartCount), [parts]);
  const families = useMemo(() => new Map(tree.flatMap((g) => g.families.map((f) => [f.key, f] as const))), [tree]);
  const prefs = useLibraryPrefs();
  const [view, setView] = useState<View>('library');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.length ? [tree[0].key] : []));
  const [active, setActive] = useState<string | null>(null);
  const [filters, setFilters] = useState<Map<string, SpecFilter>>(() => new Map());
  // the filter panel starts collapsed (one line) so the tree keeps its room in small windows
  const [filterOpen, setFilterOpen] = useState(false);
  const placing = useEditor((s) => (s.tool.kind === 'place' ? s.tool.partId : null));
  const treeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);
  const pendingScroll = useRef<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);

  const search = useCatalogueSearch(parts, query);
  const results = search.results;
  const searching = query.trim().length > 0;
  const listIds = view === 'library' ? [] : view === 'favourites' ? prefs.favourites : prefs.recent;
  // favourites / recent parts may belong to a catalogue pack not loaded yet
  useIdsLoaded(listIds);
  // an opened group loads its catalogue packs (once)
  useGroupLoading(useMemo(() => [...expanded].filter((k) => k.startsWith('g:')).map((k) => k.slice(2)), [expanded]));
  // and the parts already loaded get their search index built in the background
  useIdleIndexing(parts);
  const listed = useMemo(() => {
    if (view === 'library') return null;
    // (`parts` changes when a catalogue pack arrives)
    return listIds.map((id) => getPart(id)).filter((p): p is PartDef => !!p);
  }, [view, prefs, parts]);
  const rows: RowModel = useMemo(
    () => (searching ? listRowModel(results) : listed ? listRowModel(listed) : treeRowModel(tree, expanded, filters)),
    [searching, results, listed, tree, expanded, filters],
  );
  const activeIndex = active === null ? -1 : rows.indexOf(active);
  const activeRow = activeIndex >= 0 ? (rows.at(activeIndex) ?? null) : null;
  const previewDef = activeRow?.kind === 'part' ? activeRow.part : placing ? getPart(placing) : undefined;

  // the family whose filters are shown: the active family row, or the family of the active part
  const family: FamilyNode | null = !searching && !listed && activeRow ? (activeRow.kind === 'family' ? activeRow.node : activeRow.kind === 'part' && activeRow.parentKey ? (families.get(activeRow.parentKey) ?? null) : null) : null;
  const fields = useMemo(() => (family ? familySpecFields(family.parts) : []), [family]);
  const familyFilter = family ? (filters.get(family.key) ?? {}) : {};

  // F1 while the tree has the focus explains the active group / family / part
  const activeRowRef = useRef(activeRow);
  activeRowRef.current = activeRow;
  useEffect(
    () =>
      setFocusHelp(() => {
        const row = activeRowRef.current;
        return row && treeRef.current?.contains(document.activeElement) ? rowTopic(row) : null;
      }),
    [],
  );

  // viewport height of the virtualised list
  useEffect(() => {
    const el = treeRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewport(el.clientHeight || 400));
    ro.observe(el);
    setViewport(el.clientHeight || 400);
    return () => ro.disconnect();
  }, []);

  // bring a requested row into view once the rows it belongs to exist
  useLayoutEffect(() => {
    const key = pendingScroll.current;
    const el = treeRef.current;
    if (!key || !el) return;
    const idx = rows.indexOf(key);
    if (idx < 0) return;
    pendingScroll.current = null;
    const top = scrollIntoRow(idx, ROW_HEIGHT, el.scrollTop, el.clientHeight || viewport);
    if (top !== el.scrollTop) {
      el.scrollTop = top;
      setScrollTop(top);
    }
  }, [rows, viewport, scrollRequest]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const scrollTo = (key: string) => {
    pendingScroll.current = key;
    // the rows may already contain the key: re-run the layout effect explicitly
    setScrollRequest((n) => n + 1);
  };

  const onTreeKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const r = treeKeyModel(rows, active, e.key);
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();
    if (r.toggle) toggle(r.toggle);
    if (r.active) {
      setActive(r.active);
      scrollTo(r.active);
    }
    if (r.activate) {
      const def = getPart(r.activate);
      if (def) placePart(def);
    }
  };

  const showInTree = (def: PartDef) => {
    setQuery('');
    setView('library');
    setExpanded((prev) => new Set([...prev, ...pathToPart(def)]));
    setActive(partKey(def.id));
    scrollTo(partKey(def.id));
  };

  const setFamilyFilter = (key: string, f: SpecFilter) =>
    setFilters((prev) => {
      const next = new Map(prev);
      if (isEmptyFilter(f)) next.delete(key);
      else next.set(key, f);
      return next;
    });

  const win = virtualWindow(rows.count, ROW_HEIGHT, scrollTop, viewport);
  const viewItems = [
    { id: 'library', title: t('catalog.view.library'), ariaLabel: t('tip.catalog.library') },
    { id: 'favourites', title: t('catalog.view.favourites', { n: prefs.favourites.length }), ariaLabel: t('tip.catalog.favourites') },
    { id: 'recent', title: t('catalog.view.recent', { n: prefs.recent.length }), ariaLabel: t('tip.catalog.recent') },
  ];

  return (
    <aside className="ms-browser" aria-label={t('editor.componentBrowser.componentBrowser')}>
      <div className="ms-panel-title">{t('editor.componentBrowser.components')}</div>
      <div className="ms-browser-views">
        <Tabs
          items={viewItems}
          active={view}
          onSelect={(id) => {
            setView(id as View);
            setActive(null);
            setScrollTop(0);
            if (treeRef.current) treeRef.current.scrollTop = 0;
          }}
          ariaLabel={t('catalog.view.choose')}
          idPrefix="cb-view"
          size="small"
        />
      </div>
      <div className="ms-browser-search">
        <input
          ref={(el) => {
            searchInput = el;
          }}
          className="ms-input"
          type="search"
          placeholder={t('editor.componentBrowser.searchParts')}
          aria-label={t('editor.componentBrowser.searchComponents')}
          title={t('editor.componentBrowser.searchComponents')}
          value={query}
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(null);
            setScrollTop(0);
            if (treeRef.current) treeRef.current.scrollTop = 0;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            } else if (e.key === 'ArrowDown' || (e.key === 'Enter' && rows.count > 0)) {
              e.preventDefault();
              e.stopPropagation();
              const first = rows.at(0);
              if (!first) return;
              setActive(first.key);
              if (e.key === 'Enter' && first.kind === 'part') placePart(first.part);
              else treeRef.current?.focus();
            }
          }}
        />
      </div>
      {searching && (search.progress !== null || search.loadingMore) ? (
        <div className="ms-hint ms-browser-searching" role="status">
          {search.progress !== null ? t('catalog.searchProgress', { percent: Math.round(search.progress * 100) }) : t('catalog.searchLoading')}
        </div>
      ) : null}
      {family && fields.length ? (
        <SpecFilters family={family} fields={fields} filter={familyFilter} open={filterOpen} onToggle={() => setFilterOpen((v) => !v)} onChange={(f) => setFamilyFilter(family.key, f)} />
      ) : null}
      <div
        ref={treeRef}
        className="ms-browser-tree"
        role="tree"
        aria-label={searching ? t('editor.componentBrowser.searchResultsLength', { length: results.length }) : t('editor.componentBrowser.componentGroups')}
        tabIndex={0}
        aria-activedescendant={activeRow ? rowId(activeRow.key) : undefined}
        onKeyDown={onTreeKey}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onFocus={() => {
          const first = rows.at(0);
          if (!activeRow && first) setActive(first.key);
        }}
      >
        {rows.count === 0 ? (
          <div className="ms-browser-empty">
            {searching ? t('editor.componentBrowser.noPartsMatchTrim', { trim: query.trim() }) : view === 'favourites' ? t('catalog.empty.favourites') : view === 'recent' ? t('catalog.empty.recent') : t('editor.componentBrowser.theLibraryIsEmpty')}
          </div>
        ) : null}
        <div style={{ height: win.padTop }} aria-hidden="true" />
        {rows.slice(win.start, win.end).map((r) => (
          <TreeRow
            key={r.key}
            row={r}
            active={r.key === active}
            placing={r.kind === 'part' && r.part.id === placing}
            favourite={r.kind === 'part' && prefs.favourites.includes(r.part.id)}
            onClick={() => {
              setActive(r.key);
              if (r.kind === 'part') placePart(r.part);
              else toggle(r.key);
            }}
          />
        ))}
        <div style={{ height: win.padBottom }} aria-hidden="true" />
      </div>
      {view === 'recent' && prefs.recent.length && !searching ? (
        <div className="ms-btn-row ms-browser-footer">
          <button type="button" className="ms-btn ms-btn-small" title={t('catalog.clearRecent')} onClick={() => clearRecent()}>
            {t('catalog.clearRecent')}
          </button>
        </div>
      ) : null}
      {previewDef ? (
        <div className="ms-browser-preview" aria-live="polite">
          <SymbolPreview def={previewDef} className="ms-browser-preview-svg" />
          <div className="ms-browser-preview-name">
            {partName(previewDef)} <span className="ms-hint">({previewDef.prefix})</span>
            <button type="button" className="ms-icon-btn ms-help-btn" title={t('help.whatIsThis')} aria-label={t('help.whatIsThis')} onClick={() => openHelp(topicForPart(previewDef))}>
              ?
            </button>
          </div>
          <div className="ms-browser-preview-desc" title={partDescription(previewDef)}>
            {partDescription(previewDef)}
          </div>
          <PreviewSpecs def={previewDef} />
          <div className="ms-btn-row">
            {searching || listed ? (
              <button type="button" className="ms-btn ms-btn-small" title={t('editor.componentBrowser.showInTree')} onClick={() => showInTree(previewDef)}>
                {t('editor.componentBrowser.showInTree')}
              </button>
            ) : null}
            <button type="button" className="ms-btn ms-btn-small" title={t('tip.catalog.details')} onClick={() => openDetails(previewDef)}>
              {t('catalog.details')}
            </button>
            <button type="button" className="ms-btn ms-btn-small ms-btn-primary" title={t('editor.componentBrowser.place')} onClick={() => placePart(previewDef)}>
              {t('editor.componentBrowser.place')}
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function PreviewSpecs({ def }: { def: PartDef }) {
  const rows = specRows(def, 4);
  if (!rows.length && !def.footprint) return null;
  return (
    <dl className="ms-browser-specs" aria-label={t('catalog.preview.specs')}>
      {rows.map((r) => (
        <div key={r.key} className="ms-browser-spec">
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
      {def.footprint && !rows.some((r) => r.key === 'package') ? (
        <div className="ms-browser-spec">
          <dt>{t('catalog.preview.footprint')}</dt>
          <dd className="ms-mono">{def.footprint}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function SpecFilters({ family, fields, filter, open, onToggle, onChange }: { family: FamilyNode; fields: SpecField[]; filter: SpecFilter; open: boolean; onToggle: () => void; onChange: (f: SpecFilter) => void }) {
  const shown = isEmptyFilter(filter) ? family.size : applySpecFilter(family.parts, filter).length;
  const set = (key: string, patch: { min?: string; max?: string; value?: string }) => onChange({ ...filter, [key]: { ...filter[key], ...patch } });
  return (
    <div className="ms-browser-filters">
      <div className="ms-browser-filters-head">
        <button type="button" className="ms-link-btn" aria-expanded={open} title={t('tip.catalog.filterToggle')} onClick={onToggle}>
          <span className={`ms-tree-twisty ${open ? 'is-open' : ''}`} aria-hidden="true">
            <Icon name="chevronRight" size={10} />
          </span>
          {t('catalog.filter.title', { family: familyName(family.name) })}
        </button>
        {!isEmptyFilter(filter) ? (
          <button type="button" className="ms-link-btn" title={t('tip.catalog.filterClear')} onClick={() => onChange({})}>
            {t('catalog.filter.clear')}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="ms-browser-filters-body">
          {fields.map((f) => {
            const c = filter[f.key] ?? {};
            const label = specLabel(f.key);
            return (
              <div key={f.key} className="ms-browser-filter">
                <span className="ms-browser-filter-label" title={label}>
                  {label}
                </span>
                {f.kind === 'num' ? (
                  <span className="ms-browser-filter-range">
                    <input className="ms-input" value={c.min ?? ''} placeholder={t('catalog.filter.min')} title={t('tip.catalog.filterMin', { spec: label })} aria-label={t('tip.catalog.filterMin', { spec: label })} spellCheck={false} onChange={(e) => set(f.key, { min: e.target.value })} />
                    <input className="ms-input" value={c.max ?? ''} placeholder={t('catalog.filter.max')} title={t('tip.catalog.filterMax', { spec: label })} aria-label={t('tip.catalog.filterMax', { spec: label })} spellCheck={false} onChange={(e) => set(f.key, { max: e.target.value })} />
                  </span>
                ) : (
                  <select className="ms-input" value={c.value ?? ''} title={t('tip.catalog.filterSelect', { spec: label })} aria-label={t('tip.catalog.filterSelect', { spec: label })} onChange={(e) => set(f.key, { value: e.target.value })}>
                    <option value="">{t('catalog.filter.any')}</option>
                    {f.values.map((v) => (
                      <option key={v} value={v}>
                        {specValueText(f.key, v)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
          <div className="ms-hint">{shown ? t('catalog.filter.count', { shown, total: family.size }) : t('catalog.filter.none')}</div>
        </div>
      ) : null}
    </div>
  );
}

function TreeRow({ row, active, placing, favourite, onClick }: { row: BrowserRow; active: boolean; placing: boolean; favourite: boolean; onClick: () => void }) {
  const indent = { paddingLeft: 4 + (row.level - 1) * 14 };
  if (row.kind === 'part') {
    const p = row.part;
    const name = partName(p);
    return (
      <div
        id={rowId(row.key)}
        role="treeitem"
        aria-level={row.level}
        aria-selected={active}
        className={`ms-tree-row ms-tree-part ${active ? 'is-active' : ''}`}
        style={indent}
        title={t('editor.componentBrowser.nameDescriptionClickToPlace', { name, description: partDescription(p) })}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PART_DRAG_MIME, p.id);
          e.dataTransfer.setData('text/plain', p.name);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={onClick}
      >
        <span className="ms-tree-twisty" aria-hidden="true">
          {placing ? '▸' : ''}
        </span>
        <span className="ms-tree-label">{name}</span>
        {p.id.startsWith('custom:') ? <span className="ms-tree-meta ms-tree-user">{t('parts.custom.badge')}</span> : null}
        {row.level === 1 ? <span className="ms-tree-meta">{familyName(p.family)}</span> : null}
        <button
          type="button"
          className={`ms-icon-btn ms-tree-fav ${favourite ? 'is-on' : ''}`}
          tabIndex={-1}
          aria-pressed={favourite}
          title={favourite ? t('catalog.fav.remove', { name }) : t('catalog.fav.add', { name })}
          aria-label={favourite ? t('catalog.fav.remove', { name }) : t('catalog.fav.add', { name })}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavourite(p.id);
          }}
        >
          {favourite ? '★' : '☆'}
        </button>
      </div>
    );
  }
  const label = row.kind === 'group' ? groupName(row.node.group.id) : familyName(row.node.name);
  // a group whose catalogue packs are not loaded yet counts them in (and says so while they load)
  const loading = row.kind === 'group' && !!row.node.pending && groupState(row.node.group.id) === 'loading';
  const total = row.kind === 'group' ? row.node.count + (row.node.pending ?? 0) : 0;
  const count = row.kind === 'group' ? (loading ? t('catalog.loadingGroup') : String(total)) : row.shown === row.node.size ? String(row.shown) : `${row.shown}/${row.node.size}`;
  const topic = rowTopic(row);
  return (
    <div
      id={rowId(row.key)}
      role="treeitem"
      aria-level={row.level}
      aria-expanded={row.expanded}
      aria-selected={active}
      className={`ms-tree-row ms-tree-${row.kind} ${active ? 'is-active' : ''}`}
      style={indent}
      onClick={onClick}
    >
      <span className={`ms-tree-twisty ${row.expanded ? 'is-open' : ''}`} aria-hidden="true">
        <Icon name="chevronRight" size={10} />
      </span>
      <span className="ms-tree-label">{label}</span>
      <span className="ms-tree-count" title={loading ? t('tip.catalog.loadingGroup', { n: row.kind === 'group' ? (row.node.pending ?? 0) : 0 }) : t('catalog.partCount', { n: row.kind === 'group' ? total : row.shown })}>
        {count}
      </span>
      {topic ? (
        <button
          type="button"
          className="ms-icon-btn ms-tree-help"
          tabIndex={-1}
          title={t('help.whatIsThisName', { name: label })}
          aria-label={t('help.whatIsThisName', { name: label })}
          onClick={(e) => {
            e.stopPropagation();
            void openHelp(topic);
          }}
        >
          ?
        </button>
      ) : null}
    </div>
  );
}
