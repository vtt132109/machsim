/**
 * Digital-round dialogs (loaded on first use):
 * - Digital simulation settings (Simulate menu): ideal / real / automatic mode and the timing
 *   choice, stored in Design.digital as one undo step;
 * - the hex content editor of memory parts (Properties › Contents › Edit contents…): pages of
 *   256 words, one input per word, ASCII column for byte-wide memories, Intel HEX / text import;
 *   OK writes the compact memory image (src/sim/devices/digital/memimage.ts) into the part's
 *   'data' parameter.
 */
import { useMemo, useState } from 'react';
import type { DigitalSimSettings } from '../../model/types';
import type { ParamDef, PartDef } from '../../library/types';
import { formatMemoryImage, parseMemoryImage, wordDigits } from '../../sim/devices/digital/memimage';
import { actions, getState } from '../store';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { partName } from '../../i18n/library';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------------------------
// digital simulation settings

type Mode = NonNullable<DigitalSimSettings['mode']>;
type Timing = NonNullable<DigitalSimSettings['timing']>;
const MODES: Mode[] = ['auto', 'ideal', 'real'];
const TIMINGS: Timing[] = ['typical', 'max', 'zero'];

function DigitalSettingsDialog({ close }: { close: () => void }) {
  const current = getState().design.digital ?? {};
  const [mode, setMode] = useState<Mode>(current.mode ?? 'auto');
  const [timing, setTiming] = useState<Timing>(current.timing ?? 'typical');
  const apply = () => {
    actions.applyDesign((d) => {
      const next: DigitalSimSettings = {};
      if (mode !== 'auto') next.mode = mode;
      if (timing !== 'typical') next.timing = timing;
      const out = { ...d };
      if (Object.keys(next).length) out.digital = next;
      else delete out.digital;
      return out;
    });
    actions.addSimMessage('info', t('digital.settings.applied', { mode: t(`digital.mode.${mode}`), timing: t(`digital.timing.${timing}`) }), 'simulation');
    close();
  };
  return (
    <Dialog
      title={t('digital.settings.title')}
      onClose={close}
      width={520}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={apply}>
            {t('digital.settings.apply')}
          </button>
        </>
      }
    >
      <div className="ms-prop-section">
        <p className="ms-hint">{t('digital.settings.intro')}</p>
        <fieldset className="ms-fieldset" title={t('tip.digital.mode')}>
          <legend>{t('digital.settings.mode')}</legend>
          {MODES.map((m) => (
            <label key={m} className="ms-radio-row" title={t(`digital.mode.${m}Help`)}>
              <input type="radio" name="ms-digital-mode" checked={mode === m} onChange={() => setMode(m)} />
              <span>
                <strong>{t(`digital.mode.${m}`)}</strong>
                <span className="ms-hint"> — {t(`digital.mode.${m}Help`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="ms-fieldset" title={t('tip.digital.timing')}>
          <legend>{t('digital.settings.timing')}</legend>
          {TIMINGS.map((m) => (
            <label key={m} className="ms-radio-row" title={t(`digital.timing.${m}Help`)}>
              <input type="radio" name="ms-digital-timing" checked={timing === m} onChange={() => setTiming(m)} />
              <span>
                <strong>{t(`digital.timing.${m}`)}</strong>
                <span className="ms-hint"> — {t(`digital.timing.${m}Help`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </Dialog>
  );
}

export function openDigitalSettingsDialog(): void {
  openCustomDialog((close) => <DigitalSettingsDialog close={close} />);
}

// ---------------------------------------------------------------------------------------------
// memory contents editor

const PAGE = 256;
const PER_ROW = 16;

/** Ask for a text file (browser input element; works in the desktop app as well). */
function pickText(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      void f.text().then(
        (text) => resolve({ name: f.name, text }),
        () => resolve(null),
      );
    };
    input.click();
  });
}

function MemoryEditor({ close, instId, def, param, text }: { close: () => void; instId: string; def: PartDef; param: ParamDef; text: string }) {
  const { words, bits } = param.memory!;
  const digits = wordDigits(bits);
  const max = bits >= 32 ? 0xffffffff : 2 ** bits - 1;
  const [data, setData] = useState(() => parseMemoryImage(text, words, bits).data);
  const [page, setPage] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [note, setNote] = useState<string | null>(() => {
    const e = parseMemoryImage(text, words, bits).errors;
    return e.length ? t('mem.editor.bad', { error: e[0] }) : null;
  });
  const pages = Math.max(1, Math.ceil(words / PAGE));
  const hex = (v: number, d: number) => v.toString(16).toUpperCase().padStart(d, '0');
  const addrDigits = Math.max(4, Math.ceil(Math.log2(Math.max(2, words)) / 4));
  const used = useMemo(() => data.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0), [data]);
  const setWord = (addr: number, value: string) => {
    setDrafts((d) => ({ ...d, [addr]: value }));
    const clean = value.trim().replace(/^0x/i, '');
    if (clean === '') return;
    if (!/^[0-9a-f]+$/i.test(clean) || parseInt(clean, 16) > max) {
      setNote(t('mem.editor.badCell', { addr: hex(addr, addrDigits), text: value, bits }));
      return;
    }
    setNote(null);
    setData((prev) => {
      const next = prev.slice();
      next[addr] = parseInt(clean, 16);
      return next;
    });
  };
  const commit = () => {
    actions.setPartParam(instId, param.key, formatMemoryImage(data, bits));
    close();
  };
  const rows: number[] = [];
  for (let a = page * PAGE; a < Math.min(words, (page + 1) * PAGE); a += PER_ROW) rows.push(a);
  return (
    <Dialog
      title={t('mem.editor.title', { name: partName(def) })}
      onClose={close}
      width={bits <= 8 ? 760 : 820}
      footer={
        <>
          <button type="button" className="ms-btn" title={t('tip.mem.load')} onClick={async () => {
            const f = await pickText(param.fileImport ?? '.hex,.txt');
            if (!f) return;
            const r = parseMemoryImage(f.text, words, bits);
            setData(r.data);
            setDrafts({});
            setNote(r.errors.length ? t('mem.editor.bad', { error: r.errors[0] }) : t('mem.editor.loaded', { name: f.name }));
          }}>
            {t('mem.editor.load')}
          </button>
          <button type="button" className="ms-btn" title={t('tip.mem.clear')} onClick={() => {
            setData(new Uint32Array(words));
            setDrafts({});
          }}>
            {t('mem.editor.clear')}
          </button>
          <span className="ms-spacer" />
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={commit}>
            {t('digital.settings.apply')}
          </button>
        </>
      }
    >
      <div className="ms-prop-section ms-mem-editor">
        <p className="ms-hint">
          {t('mem.editor.size', { words, bits })} · {t('mem.editor.used', { n: used })}
        </p>
        <p className="ms-hint">{t('mem.editor.hint')}</p>
        {pages > 1 ? (
          <div className="ms-btn-row">
            <button type="button" className="ms-btn ms-btn-small" disabled={page === 0} title={t('tip.mem.prev')} onClick={() => setPage(page - 1)}>
              {t('mem.editor.prev')}
            </button>
            <label className="ms-cfield-row">
              <span className="ms-cfield-label">{t('mem.editor.page')}</span>
              <select className="ms-input" value={page} title={t('tip.mem.page')} onChange={(e) => setPage(Number(e.target.value))}>
                {Array.from({ length: pages }, (_, p) => (
                  <option key={p} value={p}>
                    {`${hex(p * PAGE, addrDigits)}–${hex(Math.min(words, (p + 1) * PAGE) - 1, addrDigits)}`}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ms-btn ms-btn-small" disabled={page >= pages - 1} title={t('tip.mem.next')} onClick={() => setPage(page + 1)}>
              {t('mem.editor.next')}
            </button>
          </div>
        ) : null}
        <table className="ms-mem-grid">
          <thead>
            <tr>
              <th>{t('mem.editor.address')}</th>
              {Array.from({ length: Math.min(PER_ROW, words) }, (_, c) => (
                <th key={c}>{hex(c, 1)}</th>
              ))}
              {bits <= 8 ? <th>{t('mem.editor.ascii')}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a}>
                <th className="ms-mono">{hex(a, addrDigits)}</th>
                {Array.from({ length: Math.min(PER_ROW, words - a) }, (_, c) => {
                  const addr = a + c;
                  return (
                    <td key={c}>
                      <input
                        className="ms-input ms-mono ms-mem-cell"
                        size={digits}
                        maxLength={digits + 2}
                        value={drafts[addr] ?? hex(data[addr], digits)}
                        title={t('tip.mem.cell', { addr: hex(addr, addrDigits), digits })}
                        aria-label={t('tip.mem.cell', { addr: hex(addr, addrDigits), digits })}
                        onChange={(e) => setWord(addr, e.target.value)}
                        onBlur={() => setDrafts((d) => {
                          const next = { ...d };
                          delete next[addr];
                          return next;
                        })}
                      />
                    </td>
                  );
                })}
                {bits <= 8 ? (
                  <td className="ms-mono ms-mem-ascii">
                    {Array.from({ length: Math.min(PER_ROW, words - a) }, (_, c) => {
                      const v = data[a + c];
                      return v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.';
                    }).join('')}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {note ? <p className="ms-hint ms-warn">{note}</p> : null}
      </div>
    </Dialog>
  );
}

/** Open the hex editor for a memory part's contents parameter. */
export function openMemoryEditor(instId: string, def: PartDef, param: ParamDef, text: string): void {
  if (!param.memory) return;
  openCustomDialog((close) => <MemoryEditor close={close} instId={instId} def={def} param={param} text={text} />);
}
