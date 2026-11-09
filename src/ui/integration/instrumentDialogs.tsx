/**
 * Instrument dialogs (loaded on first use):
 *
 * - Default instrument settings (Options menu): pick an instrument, edit the settings a newly
 *   placed one starts with, save them (per machine, src/ui/instruments/defaults.ts), go back to
 *   the factory settings, or apply them to every instrument of that type already in the design
 *   (one undo step). Settings of placed instruments are saved with the design file.
 * - Print instrument faces (File menu): opens the window of every instrument in the design that is
 *   not open yet, captures each face (faceSnapshot.ts) and prints them, one instrument per page,
 *   with its settings table.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { listParts } from '../../library';
import type { PartDef } from '../../library/types';
import { parseUserNumber } from '../../util/units';
import { Dialog } from '../common/Dialog';
import { alertDialog, openCustomDialog } from '../common/dialogs';
import { closeFloatingWindow, floating, openFloatingWindow } from '../app/extensions';
import { instrumentDefaultsStore, resetInstrumentDefaults, saveInstrumentDefaults } from '../instruments/defaults';
import { actions, getState, partLookup } from '../store';
import { optionLabel, paramHelp, paramLabel, partName } from '../../i18n/library';
import { t } from '../../i18n';

function instrumentParts(): PartDef[] {
  return listParts().filter((p) => p.instrument);
}

function InstrumentDefaultsDialog({ close }: { close: () => void }) {
  const parts = useMemo(instrumentParts, []);
  const table = useSyncExternalStore(instrumentDefaultsStore.subscribe, instrumentDefaultsStore.getState, instrumentDefaultsStore.getState);
  const [partId, setPartId] = useState(parts[0]?.id ?? '');
  const def = parts.find((p) => p.id === partId);
  const saved = table[partId] ?? {};
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const valueOf = (key: string) => draft[key] ?? saved[key] ?? def?.params.find((x) => x.key === key)?.default ?? '';
  const invalid = def ? def.params.filter((x) => x.kind === 'number' && valueOf(x.key).trim() !== '' && !Number.isFinite(parseUserNumber(valueOf(x.key)))) : [];
  const values = () => Object.fromEntries((def?.params ?? []).map((x) => [x.key, valueOf(x.key)]));
  const pick = (id: string) => {
    setPartId(id);
    setDraft({});
    setNote(null);
  };
  const save = () => {
    if (!def || invalid.length) return;
    saveInstrumentDefaults(def, values());
    setDraft({});
    setNote(t('instrumentDefaults.saved', { name: partName(def) }));
  };
  const reset = () => {
    if (!def) return;
    resetInstrumentDefaults(def.id);
    setDraft({});
    setNote(t('instrumentDefaults.resetDone', { name: partName(def) }));
  };
  const apply = () => {
    if (!def || invalid.length) return;
    const v = values();
    let count = 0;
    actions.applyDesign((d) => ({
      ...d,
      sheets: d.sheets.map((sh) => ({
        ...sh,
        parts: sh.parts.map((p) => {
          if (p.partId !== def.id) return p;
          count++;
          return { ...p, params: { ...p.params, ...v } };
        }),
      })),
    }));
    setNote(t('instrumentDefaults.applied', { n: count }));
  };
  return (
    <Dialog
      title={t('instrumentDefaults.title')}
      onClose={close}
      width={760}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={reset} disabled={!def} title={t('tip.instrumentDefaults.reset')}>
            {t('instrumentDefaults.reset')}
          </button>
          <button type="button" className="ms-btn" onClick={apply} disabled={!def || invalid.length > 0} title={t('tip.instrumentDefaults.apply')}>
            {t('instrumentDefaults.apply')}
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={save} disabled={!def || invalid.length > 0} title={t('tip.instrumentDefaults.save')}>
            {t('instrumentDefaults.save')}
          </button>
        </>
      }
    >
      <p className="msx-note">{t('instrumentDefaults.intro')}</p>
      <div className="msx-defaults">
        <ul className="msx-defaults-list" role="listbox" aria-label={t('instrumentDefaults.listAria')}>
          {parts.map((p) => (
            <li key={p.id}>
              <button type="button" role="option" aria-selected={p.id === partId} className={`msx-defaults-item${p.id === partId ? ' is-selected' : ''}`} onClick={() => pick(p.id)} title={t('tip.instrumentDefaults.pick')}>
                {partName(p)}
                {table[p.id] ? <span className="msx-defaults-mark"> ●</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="msx-defaults-form">
          {def?.params.map((x) => {
            const v = valueOf(x.key);
            const set = (nv: string) => setDraft((d) => ({ ...d, [x.key]: nv }));
            const help = paramHelp(x);
            return (
              <label key={x.key} className="msx-defaults-field" title={help ?? paramLabel(x)}>
                <span>
                  {paramLabel(x)}
                  {x.unit ? ` (${x.unit})` : ''}
                </span>
                {x.kind === 'select' ? (
                  <select className="ms-input" value={v} onChange={(e) => set(e.target.value)}>
                    {(x.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {optionLabel(o.label)}
                      </option>
                    ))}
                  </select>
                ) : x.kind === 'bool' ? (
                  <input type="checkbox" checked={v === 'true'} onChange={(e) => set(e.target.checked ? 'true' : 'false')} />
                ) : (
                  <input className={`ms-input${invalid.includes(x) ? ' is-invalid' : ''}`} value={v} onChange={(e) => set(e.target.value)} spellCheck={false} />
                )}
              </label>
            );
          })}
        </div>
      </div>
      {invalid.length > 0 && <p className="msx-error">{t('instrumentDefaults.invalid', { names: invalid.map(paramLabel).join(', ') })}</p>}
      {note && <p className="msx-note" role="status">{note}</p>}
    </Dialog>
  );
}

export function openInstrumentDefaultsDialog(): void {
  openCustomDialog((close) => <InstrumentDefaultsDialog close={close} />);
}

// ---------------------------------------------------------------------------------------------
// print faces

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Capture every instrument of the design (opening missing windows) and print the faces. */
export async function printInstrumentFaces(): Promise<void> {
  const design = getState().design;
  const list: { refdes: string; def: PartDef; params: Record<string, string> }[] = [];
  for (const sh of design.sheets) {
    for (const p of sh.parts) {
      const def = partLookup(p.partId);
      if (def?.instrument) list.push({ refdes: p.refdes, def, params: p.params });
    }
  }
  if (!list.length) {
    await alertDialog({ title: t('printFaces.title'), message: t('printFaces.none') });
    return;
  }
  const opened: string[] = [];
  for (const it of list) {
    const exists = floating.getState().windows.some((w) => w.kind === it.def.instrument && w.props.refdes === it.refdes);
    if (!exists) opened.push(openFloatingWindow(it.def.instrument!, { refdes: it.refdes }));
  }
  // let the windows (and their lazily loaded panels) render and draw
  for (let i = 0; i < 30; i++) {
    await nextFrame();
    if (list.every((it) => document.querySelector(`[data-instrument="${CSS.escape(it.refdes)}"] .msi-panel`))) break;
  }
  await new Promise((r) => setTimeout(r, 120));
  const face = await import('../instruments/faceSnapshot');
  const pages: { title: string; url: string | null; settings: [string, string][] }[] = [];
  for (const it of list) {
    const el = document.querySelector(`[data-instrument="${CSS.escape(it.refdes)}"] .msi-panel`);
    let url: string | null = null;
    if (el instanceof HTMLElement) {
      try {
        url = await face.captureFace(el);
      } catch {
        url = null;
      }
    }
    const settings: [string, string][] = it.def.params.map((x) => [paramLabel(x), `${it.params[x.key] ?? x.default}${x.unit ? ` ${x.unit}` : ''}`]);
    pages.push({ title: `${it.refdes} — ${partName(it.def)}`, url, settings });
  }
  for (const id of opened) closeFloatingWindow(id);
  document.querySelector('.ms-print-area')?.remove();
  const area = document.createElement('div');
  area.className = 'ms-print-area';
  area.setAttribute('aria-hidden', 'true');
  for (const pg of pages) {
    const page = document.createElement('div');
    page.className = 'ms-print-page ms-print-instruments';
    const h = document.createElement('h2');
    h.textContent = pg.title;
    page.appendChild(h);
    if (pg.url) {
      const img = document.createElement('img');
      img.src = pg.url;
      img.alt = pg.title;
      page.appendChild(img);
    } else {
      const p = document.createElement('p');
      p.textContent = t('printFaces.noImage');
      page.appendChild(p);
    }
    const table = document.createElement('table');
    for (const [k, v] of pg.settings) {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      a.textContent = k;
      const b = document.createElement('td');
      b.textContent = v;
      tr.append(a, b);
      table.appendChild(tr);
    }
    page.appendChild(table);
    area.appendChild(page);
  }
  document.body.appendChild(area);
  const cleanup = () => {
    area.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}
