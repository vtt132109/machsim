/**
 * Part-property editors added with the large catalogue:
 * - ValuePicker: standard-value (E-series) drop-down next to resistance / capacitance /
 *   inductance fields (ParamDef.picker);
 * - DataFileField: multi-line data parameter with "Open file…" (ParamDef.fileImport), e.g. the
 *   waveform of the "source from file";
 * - PartFaultTab: per-pin open / short / leakage faults (troubleshooting practice);
 * - PartSpecList: the catalogue specifications of a part (Info tab).
 * Every change goes through the editor store (one undo step).
 */
import { useState } from 'react';
import type { ParamDef, PartDef } from '../../library/types';
import type { PartInstance, PinFault } from '../../model/types';
import { seriesValues } from '../../library/series';
import { FAULT_KINDS, faultResistance, isFaultable, visibleFaults, type FaultKind } from '../../model/faults';
import { userNum } from '../../library/catalog/kit';
import { actions, partLookup, useEditor } from '../store';
import { CommitField } from '../common/Field';
import { formatEng, parseUserNumber } from '../../util/units';
import { paramValue } from './paramFields';
import { specRows } from './specText';
export { describeFault } from './faultText';
import { t } from '../../i18n';
import { paramHelp } from '../../i18n/library';

// ---------------------------------------------------------------------------------------------
// E-series picker

/** Standard values offered around the present value (one decade below to two above). */
export function pickerValues(def: ParamDef, text: string): number[] {
  if (!def.picker) return [];
  const v = parseUserNumber(text);
  const centre = Number.isFinite(v) && v > 0 ? v : 1000;
  const d = Math.floor(Math.log10(centre));
  return seriesValues(def.picker, Math.pow(10, d - 1), Math.pow(10, d + 2) * 0.999);
}

export function ValuePicker({ def, inst }: { def: ParamDef; inst: PartInstance }) {
  if (!def.picker) return null;
  const values = pickerValues(def, paramValue(def, inst.params));
  const tip = t('tip.catalog.picker', { series: def.picker });
  return (
    <select
      className="ms-input ms-value-picker"
      value=""
      title={tip}
      aria-label={t('catalog.picker.label', { series: def.picker })}
      onChange={(e) => {
        if (e.target.value) actions.setPartParam(inst.id, def.key, e.target.value);
      }}
    >
      <option value="">{t('catalog.picker.choose')}</option>
      {values.map((v) => (
        <option key={v} value={userNum(v)}>
          {formatEng(v, def.unit ?? '', 3)}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------------------------
// data file

/** Ask for a text file (browser input element; works in the desktop app as well). */
function pickText(accept: string): Promise<{ name: string; text: string; bytes?: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      // a binary TDMS file is handed over as bytes, every other file as text
      if (/\.tdms$/i.test(f.name)) {
        void f.arrayBuffer().then(
          (buf) => resolve({ name: f.name, text: '', bytes: new Uint8Array(buf) }),
          () => resolve(null),
        );
        return;
      }
      void f.text().then(
        (text) => resolve({ name: f.name, text }),
        () => resolve(null),
      );
    };
    input.click();
  });
}

export function DataFileField({ def, inst, label, trailing }: { def: ParamDef; inst: PartInstance; label: React.ReactNode; trailing?: React.ReactNode }) {
  const [note, setNote] = useState<string | null>(null);
  const value = paramValue(def, inst.params);
  return (
    <div className="ms-data-field">
      <CommitField label={label} value={value} multiline rows={6} layout="stack" onCommit={(v) => actions.setPartParam(inst.id, def.key, v)} hint={note ?? paramHelp(def) ?? t('tip.catalog.dataText')} trailing={trailing} inputClassName="ms-mono" />
      <div className="ms-btn-row">
        {def.memory ? (
          <button
            type="button"
            className="ms-btn ms-btn-small"
            title={t('tip.mem.edit')}
            onClick={async () => {
              const part = partLookup(inst.partId);
              if (part) (await import('../app/digitalDialogs')).openMemoryEditor(inst.id, part, def, value);
            }}
          >
            {t('mem.edit')}
          </button>
        ) : null}
        <button
          type="button"
          className="ms-btn ms-btn-small"
          title={t('tip.catalog.fileOpen', { accept: def.fileImport ?? '' })}
          onClick={async () => {
            try {
              const f = await pickText(def.fileImport ?? '');
              if (!f) return;
              if (f.bytes) {
                const { tdmsFileToCsv } = await import('../integration/tdmsText');
                const r = tdmsFileToCsv(f.bytes, f.name);
                if (r.text) actions.setPartParam(inst.id, def.key, r.text);
                setNote(r.note);
                return;
              }
              actions.setPartParam(inst.id, def.key, f.text.replace(/\r\n/g, '\n').trim());
              setNote(t('catalog.file.loaded', { name: f.name, lines: f.text.split(/\r?\n/).filter((l) => l.trim()).length }));
            } catch (e) {
              setNote(t('catalog.file.failed', { error: e instanceof Error ? e.message : String(e) }));
            }
          }}
        >
          {t('catalog.file.open')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// faults

const KIND_LABEL = (k: FaultKind | 'none'): string => t(k === 'none' ? 'fault.none' : `fault.${k}`);

export function PartFaultTab({ inst, def }: { inst: PartInstance; def: PartDef | undefined }) {
  const autoFault = useEditor((s) => s.design.autoFault);
  if (!def || !isFaultable(def)) return <p className="ms-empty">{t('fault.notFaultable')}</p>;
  const shown = visibleFaults(inst, { autoFault });
  const hidden = (inst.faults ?? []).filter((f) => !shown.includes(f));
  const pins = def.symbol.pins.map((p) => p.name);
  const write = (next: PinFault[]) => {
    const all = [...hidden, ...next];
    actions.updatePart(inst.id, { faults: all.length ? all : undefined });
  };
  const setPin = (pin: string, kind: FaultKind | 'none') => {
    const rest = shown.filter((f) => f.pin !== pin);
    if (kind === 'none') return write(rest);
    const old = shown.find((f) => f.pin === pin);
    const f: PinFault = { pin, kind };
    if (kind !== 'open') f.to = old?.to && old.to !== pin ? old.to : pins.find((p) => p !== pin);
    if (kind === 'leak') f.r = old?.r ?? 10e3;
    write([...rest, f]);
  };
  const patch = (pin: string, p: Partial<PinFault>) => write(shown.map((f) => (f.pin === pin ? { ...f, ...p } : f)));
  return (
    <div className="ms-prop-section">
      <p className="ms-hint">{t('fault.intro')}</p>
      {autoFault && !autoFault.revealed ? <p className="ms-hint">{t('fault.hiddenNote')}</p> : null}
      {pins.map((pin) => {
        const f = shown.find((x) => x.pin === pin);
        const kind: FaultKind | 'none' = f?.kind ?? 'none';
        return (
          <div key={pin} className="ms-fault-row">
            <span className="ms-cfield-label">{t('fault.pin', { pin })}</span>
            <select className="ms-input" value={kind} title={t('tip.fault.kind', { pin })} aria-label={t('tip.fault.kind', { pin })} onChange={(e) => setPin(pin, e.target.value as FaultKind | 'none')}>
              {(['none', ...FAULT_KINDS] as const).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL(k)}
                </option>
              ))}
            </select>
            {f && f.kind !== 'open' ? (
              <select className="ms-input" value={f.to ?? ''} title={t('tip.fault.to')} aria-label={t('tip.fault.to')} onChange={(e) => patch(pin, { to: e.target.value })}>
                {pins
                  .filter((p) => p !== pin)
                  .map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
              </select>
            ) : null}
            {f && f.kind !== 'open' ? (
              <input
                className="ms-input"
                defaultValue={formatEng(faultResistance(f), '', 3).replace(/\s+/g, '')}
                title={t('tip.fault.r')}
                aria-label={t('tip.fault.r')}
                onBlur={(e) => {
                  const r = parseUserNumber(e.target.value);
                  if (r > 0) patch(pin, { r });
                }}
              />
            ) : null}
          </div>
        );
      })}
      {shown.length ? (
        <button type="button" className="ms-btn ms-btn-small" title={t('fault.clearPart')} onClick={() => write([])}>
          {t('fault.clearPart')}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// specifications

export function PartSpecList({ def }: { def: PartDef }) {
  const rows = specRows(def, 20);
  if (!rows.length) return null;
  return (
    <>
      <dt>{t('catalog.preview.specs')}</dt>
      <dd>
        <dl className="ms-browser-specs">
          {rows.map((r) => (
            <div key={r.key} className="ms-browser-spec">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </dd>
    </>
  );
}

/**
 * SPICE model override of a placed part (PartInstance.modelOverride, see src/model/modelOverride.ts)
 * and, for user components, a button that opens the component wizard. The import dialog and the
 * wizard load on first use.
 */
export function PartModelTools({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const custom = def.id.startsWith('custom:');
  const simulated = !!def.toSpice;
  if (!simulated && !custom) return null;
  const tools = () => import('../parts/partDialogs');
  const selectThis = () => actions.select([{ kind: 'part', id: inst.id }]);
  return (
    <div className="ms-prop-section">
      {simulated ? (
        <>
          <CommitField
            label={t('parts.override.label')}
            value={inst.modelOverride ?? ''}
            placeholder="—"
            hint={inst.modelOverride ? t('parts.override.hint', { name: inst.modelOverride }) : t('tip.parts.override')}
            validate={(v) => (v.trim() === '' || /^[A-Za-z_][\w.$-]*$/.test(v.trim()) ? null : t('parts.issue.modelMissing', { name: v }))}
            onCommit={(v) => actions.updatePart(inst.id, { modelOverride: v.trim() || undefined })}
          />
          <div className="ms-db-buttons">
            <button
              type="button"
              className="ms-btn ms-btn-small"
              title={t('tip.parts.overrideChange')}
              onClick={() => {
                selectThis();
                void tools().then((m) => m.openSpiceImport());
              }}
            >
              {t('parts.override.change')}
            </button>
            {inst.modelOverride ? (
              <button type="button" className="ms-btn ms-btn-small" title={t('tip.parts.override')} onClick={() => actions.updatePart(inst.id, { modelOverride: undefined })}>
                {t('parts.override.clear')}
              </button>
            ) : null}
            <button
              type="button"
              className="ms-btn ms-btn-small"
              title={t('tip.parts.customEdit')}
              onClick={() => {
                selectThis();
                void tools().then((m) => m.editSelectedComponent());
              }}
            >
              {t('parts.custom.edit')}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="ms-btn ms-btn-small"
          title={t('tip.parts.customEdit')}
          onClick={() => {
            selectThis();
            void tools().then((m) => m.editSelectedComponent());
          }}
        >
          {t('parts.custom.edit')}
        </button>
      )}
    </div>
  );
}
