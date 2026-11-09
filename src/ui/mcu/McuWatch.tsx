/**
 * Watch tab of the MCU code editor: expressions over the registers, SFRs, memory cells and bits
 * (src/mcu/watch.ts), evaluated against the live view of the co-simulated core or the panel's
 * own stand-alone core. The list is a per-viewer convenience kept in localStorage; the cells the
 * expressions read are given to the core's hardware watch slots by McuPanel.
 */
import { useState, type ReactNode } from 'react';
import { mt, type McuTextKey } from '../../i18n/mcuText';
import { formatWatchValue, type WatchItem, type WatchPlan, type WatchRadix } from '../../mcu/watch';
import type { Cpu8051 } from '../../mcu/cpu8051';
import { watchContext, type McuView } from './mcuModel';

const STORAGE_KEY = 'machsim.mcuWatch.v1';

/** The watch list saved in this browser (empty when nothing is saved or storage is unavailable). */
export function loadWatchItems(): WatchItem[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter((x): x is { text: string; stop?: boolean } => typeof x === 'object' && x !== null && typeof (x as { text?: unknown }).text === 'string')
      .slice(0, 32)
      .map((x) => ({ text: x.text, stop: x.stop === true }));
  } catch {
    return [];
  }
}

/** Save the watch list (a convenience: a full or blocked storage is ignored). */
export function saveWatchItems(items: readonly WatchItem[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage full or blocked */
  }
}

const RADIX: [WatchRadix, McuTextKey][] = [
  ['all', 'watchRadixAll'],
  ['dec', 'watchRadixDec'],
  ['hex', 'watchRadixHex'],
  ['bin', 'watchRadixBin'],
];

export function WatchView({
  items,
  plan,
  view,
  cpu,
  live,
  onChange,
}: {
  items: WatchItem[];
  plan: WatchPlan;
  view: McuView;
  /** the stand-alone core (answers any address); absent when watching the co-simulated core */
  cpu?: Cpu8051;
  /** the values come from the co-simulated core, so "stop on change" works */
  live: boolean;
  onChange: (items: WatchItem[]) => void;
}): ReactNode {
  const [draft, setDraft] = useState('');
  const [radix, setRadix] = useState<WatchRadix>('all');
  const ctx = watchContext(view, plan.cells, cpu);
  const add = (): void => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { text, stop: false }]);
    setDraft('');
  };
  return (
    <div className="ms-mcu-view">
      <p className="ms-hint">{mt('watchIntro')}</p>
      <div className="ms-mcu-row">
        <input
          className="ms-input"
          value={draft}
          placeholder={mt('watchPlaceholder')}
          aria-label={mt('watchPlaceholder')}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="ms-btn ms-btn-small" title={mt('tipWatchAdd')} onClick={add}>
          {mt('watchAdd')}
        </button>
        <label className="ms-mcu-check">
          {mt('watchRadix')}
          <select className="ms-input ms-input-small" value={radix} onChange={(e) => setRadix(e.target.value as WatchRadix)}>
            {RADIX.map(([id, label]) => (
              <option key={id} value={id}>
                {mt(label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {items.length === 0 ? <p className="ms-empty">{mt('watchEmpty')}</p> : null}
      {items.map((item, k) => {
        const p = plan.programs[k];
        const value = p?.ok ? p.evaluate(ctx) : undefined;
        const cellExpr = p?.ok && p.refs.length > 0;
        return (
          <div key={k} className="ms-mcu-watch-row">
            <span className="ms-mcu-watch-text">{item.text}</span>
            <span className="ms-mcu-cell-value" title={p?.ok && value === undefined ? mt('watchUnknown') : undefined}>
              {p?.ok ? formatWatchValue(value, radix) : ''}
            </span>
            <label className="ms-mcu-check" title={mt('tipWatchStop')}>
              <input
                type="checkbox"
                checked={item.stop}
                disabled={!live || !cellExpr}
                onChange={(e) => onChange(items.map((x, j) => (j === k ? { ...x, stop: e.target.checked } : x)))}
              />
              {mt('watchStop')}
            </label>
            <button type="button" className="ms-btn ms-btn-small" aria-label={mt('watchRemove', { text: item.text })} title={mt('watchRemove', { text: item.text })} onClick={() => onChange(items.filter((_, j) => j !== k))}>
              ×
            </button>
            {p && !p.ok ? <span className="ms-mcu-watch-error">{mt(`watchErr_${p.error.code}` as McuTextKey, { token: p.error.token ?? '', at: p.error.at })}</span> : null}
          </div>
        );
      })}
      {live ? <p className="ms-hint">{mt('watchLiveOnlyCells')}</p> : null}
    </div>
  );
}
