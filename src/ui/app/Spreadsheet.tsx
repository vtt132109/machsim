/**
 * Built-in "Spreadsheet" dock tab: Parts, Nets and Simulation messages.
 *
 * - Parts: every part of the design, sortable; click (or Enter) selects and centres the part,
 *   double-click opens its properties.
 * - Nets: editor connectivity (pins, wires, labels per net); click selects the net's wires on
 *   the first sheet that has some.
 * - Simulation: messages posted with actions.addSimMessage (engine, ERC, shell).
 */
import { valuesHidden } from '../../model/restrictions';
import { activeVariant, effectiveInstance, isFitted } from '../../model/variants';
import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { actions, partLookup, useEditor } from '../store';
import { computeConnectivity } from '../store/connectivity';
import { partValueText } from '../store/shapes';
import { Tabs } from '../common/Tabs';
import { openPropertiesDialog } from './appDialogs';
import { spreadsheetTab, type SpreadsheetTab } from './dockState';
import { localeTag, t, tDynamic } from '../../i18n';
import { SimErrorHint } from '../results/SimErrorBox';
import { familyName, partName } from '../../i18n/library';
import { severityText } from '../../i18n/erc';

interface PartRow {
  id: string;
  refdes: string;
  part: string;
  family: string;
  value: string;
  sheet: string;
  sheetIndex: number;
  sim: boolean;
  bom: boolean;
}

type SortKey = 'refdes' | 'part' | 'family' | 'value' | 'sheet';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function SortHeader({ k, label, sort, setSort }: { k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void }) {
  const active = sort.key === k;
  return (
    <th aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {label}
        {active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );
}

function PartsTable() {
  const design = useDeferredValue(useEditor((s) => s.design));
  const selection = useEditor((s) => s.selection);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'refdes', dir: 1 });
  const rows = useMemo(() => {
    const out: PartRow[] = [];
    // the active design variant decides the values and whether a part is fitted
    const variantId = activeVariant(design)?.id;
    design.sheets.forEach((sh, si) => {
      for (const p of sh.parts) {
        const def = partLookup(p.partId);
        const fitted = isFitted(p, variantId);
        out.push({
          id: p.id,
          refdes: p.refdes,
          part: def ? partName(def) : t('app.spreadsheet.missingPart', { id: p.partId }),
          family: def ? familyName(def.family) : '',
          value: partValueText(effectiveInstance(p, variantId), def, valuesHidden(design)),
          sheet: sh.name,
          sheetIndex: si,
          sim: !p.excludeFromSim && fitted,
          bom: !p.excludeFromBom && fitted,
        });
      }
    });
    return out.sort((a, b) => sort.dir * (sort.key === 'sheet' ? a.sheetIndex - b.sheetIndex || collator.compare(a.refdes, b.refdes) : collator.compare(a[sort.key], b[sort.key])));
  }, [design, sort]);
  const selected = new Set(selection.filter((s) => s.kind === 'part').map((s) => s.id));
  if (rows.length === 0) return <div className="ms-empty">{t('app.spreadsheet.noPartsPlacedYetPick')}</div>;
  return (
    <table className="ms-table">
      <thead>
        <tr>
          <SortHeader k="refdes" label={t('app.spreadsheet.refdes')} sort={sort} setSort={setSort} />
          <SortHeader k="part" label={t('common.part')} sort={sort} setSort={setSort} />
          <SortHeader k="family" label={t('app.spreadsheet.family')} sort={sort} setSort={setSort} />
          <SortHeader k="value" label={t('common.value')} sort={sort} setSort={setSort} />
          <SortHeader k="sheet" label={t('common.sheet')} sort={sort} setSort={setSort} />
          <th>{t('app.spreadsheet.simulate')}</th>
          <th>BOM</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.id}
            tabIndex={0}
            className={selected.has(r.id) ? 'is-selected' : ''}
            onClick={() => actions.findAndShow(r.refdes)}
            onDoubleClick={() => openPropertiesDialog({ kind: 'part', id: r.id })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                actions.findAndShow(r.refdes);
              }
            }}
          >
            <td>
              <strong>{r.refdes}</strong>
            </td>
            <td>{r.part}</td>
            <td>{r.family}</td>
            <td>{r.value}</td>
            <td>{r.sheet}</td>
            <td>{r.sim ? t('app.spreadsheet.yes') : t('app.spreadsheet.excluded')}</td>
            <td>{r.bom ? t('app.spreadsheet.yes') : t('app.spreadsheet.excluded')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NetsTable() {
  const design = useDeferredValue(useEditor((s) => s.design));
  const conn = useMemo(() => computeConnectivity(design, partLookup), [design]);
  const sheetName = (id: string) => design.sheets.find((s) => s.id === id)?.name ?? id;
  const show = (i: number) => {
    const net = conn.nets[i];
    const sheet = design.sheets.find((s) => s.wires.some((w) => net.wireIds.includes(w.id))) ?? design.sheets.find((s) => net.sheetIds.includes(s.id));
    if (!sheet) return;
    actions.setActiveSheet(sheet.id);
    actions.select([...sheet.wires.filter((w) => net.wireIds.includes(w.id)).map((w) => ({ kind: 'wire' as const, id: w.id })), ...sheet.labels.filter((l) => net.labelIds.includes(l.id)).map((l) => ({ kind: 'label' as const, id: l.id }))]);
  };
  if (conn.nets.length === 0) return <div className="ms-empty">{t('app.spreadsheet.noNetsYet')}</div>;
  return (
    <table className="ms-table">
      <thead>
        <tr>
          <th>{t('common.net')}</th>
          <th>{t('app.spreadsheet.connections')}</th>
          <th className="num">{t('app.spreadsheet.pins')}</th>
          <th className="num">{t('app.spreadsheet.wires')}</th>
          <th>{t('app.spreadsheet.sheets')}</th>
        </tr>
      </thead>
      <tbody>
        {conn.nets.map((n, i) => (
          <tr
            key={`${n.name}:${i}`}
            tabIndex={0}
            onClick={() => show(i)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                show(i);
              }
            }}
          >
            <td className="ms-mono">
              {n.named ? <strong>{n.name}</strong> : n.name}
            </td>
            <td className="ms-wrap">{n.pins.map((p) => `${p.refdes}.${p.pin}`).join(', ') || '—'}</td>
            <td className="num">{n.pins.length}</td>
            <td className="num">{n.wireIds.length}</td>
            <td>{n.sheetIds.map(sheetName).join(', ')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Message sources whose errors come from the simulator and get a beginner explanation. */
const EXPLAINED_SOURCES = new Set(['engine', 'simulation', 'netlister', 'spice']);

function MessagesTable() {
  const messages = useEditor((s) => s.simMessages);
  const endRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages.length]);
  return (
    <div className="ms-messages">
      <div className="ms-messages-bar">
        <span className="ms-hint">{t('app.spreadsheet.lengthMessageS', { length: messages.length })}</span>
        <button type="button" className="ms-btn ms-btn-small" disabled={messages.length === 0} onClick={() => actions.clearSimMessages()}>
          {t('common.clear')}
        </button>
      </div>
      {messages.length === 0 ? (
        <div className="ms-empty">{t('app.spreadsheet.noSimulationMessages')}</div>
      ) : (
        <table className="ms-table" aria-live="polite">
          <thead>
            <tr>
              <th>{t('common.time')}</th>
              <th>{t('app.spreadsheet.severity')}</th>
              <th>{t('common.source')}</th>
              <th>{t('app.spreadsheet.message')}</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m, i) => (
              <tr key={m.id} ref={i === messages.length - 1 ? endRef : undefined} className={`ms-msg-${m.severity}`}>
                <td className="ms-mono">{new Date(m.time).toLocaleTimeString(localeTag())}</td>
                <td>{severityText(m.severity)}</td>
                <td>{m.source ? tDynamic(`sim.source.${m.source}`, undefined, m.source) : ''}</td>
                <td className="ms-wrap">
                  {m.text}
                  {m.severity === 'error' && m.source && EXPLAINED_SOURCES.has(m.source) ? <SimErrorHint message={m.text} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Spreadsheet() {
  const tab = useSyncExternalStore(spreadsheetTab.subscribe, spreadsheetTab.getState, spreadsheetTab.getState);
  const errors = useEditor((s) => s.simMessages.filter((m) => m.severity === 'error').length);
  const items: { id: SpreadsheetTab; title: string }[] = [
    { id: 'parts', title: t('app.spreadsheet.parts') },
    { id: 'nets', title: t('app.spreadsheet.nets') },
    { id: 'messages', title: errors ? t('app.spreadsheet.simulationErrors', { n: errors }) : t('common.simulation') },
  ];
  return (
    <div className="ms-spreadsheet">
      <Tabs items={items} active={tab} onSelect={(id) => spreadsheetTab.setState(id as SpreadsheetTab)} ariaLabel={t('app.spreadsheet.spreadsheetViews')} idPrefix="ms-ss" size="small" />
      <div className="ms-spreadsheet-body" role="tabpanel" id={`ms-ss-panel-${tab}`} aria-labelledby={`ms-ss-${tab}`}>
        {tab === 'parts' ? <PartsTable /> : tab === 'nets' ? <NetsTable /> : <MessagesTable />}
      </div>
    </div>
  );
}
