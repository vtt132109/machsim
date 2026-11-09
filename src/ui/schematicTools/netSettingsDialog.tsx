/**
 * Net settings dialog (lazy chunk, command tools.netSettings and the wire context menu):
 * the name of a net, its wire colour, a note and the PCB properties (net class, trace width,
 * clearance, routing layer) — stored per net in `Design.nets` (src/model/netSettings.ts) and
 * exported with the KiCad netlist.
 *
 *   openNetSettingsDialog(net?)   `net` is the net name; without it the dialog starts on the net
 *                                 of the selection (a wire, a net label or a part pin)
 *   netOfSelection()              that net name, or null
 */
import { useMemo, useState } from 'react';
import { applyNetColor, NET_CLASS_PRESETS, NET_LAYER_HINTS, netSettings, renameNetSettings, setNetSettings } from '../../model/netSettings';
import type { NetSettings } from '../../model/types';
import { computeConnectivity, type EditorNet } from '../store/connectivity';
import { getSheet } from '../store/designOps';
import { actions, getState, partLookup } from '../store';
import { Dialog } from '../common/Dialog';
import { alertDialog, openCustomDialog } from '../common/dialogs';
import { openHelp } from '../help/open';
import { t } from '../../i18n';
import { stt } from '../../i18n/schematicToolsText';
import './schematicTools.css';

/** Nets of the active design level, by the editor's own connectivity view. */
function levelNets(): { nets: EditorNet[]; wireNet: Map<string, number> } {
  const s = getState();
  const loc = s.design.children?.flatMap((c) => c.sheets).some((sh) => sh.id === s.activeSheetId);
  const sheets = loc ? (s.design.children ?? []).find((c) => c.sheets.some((sh) => sh.id === s.activeSheetId))!.sheets : s.design.sheets;
  const conn = computeConnectivity({ ...s.design, sheets }, partLookup);
  return { nets: conn.nets, wireNet: conn.wireNet };
}

/** The net of the current selection (a wire, a net label, or the pin of a selected part). */
export function netOfSelection(): string | null {
  const s = getState();
  const { nets, wireNet } = levelNets();
  for (const item of s.selection) {
    if (item.kind === 'wire') {
      const i = wireNet.get(item.id);
      if (i !== undefined) return nets[i].name;
    }
    if (item.kind === 'label') {
      const net = nets.find((n) => n.labelIds.includes(item.id));
      if (net) return net.name;
    }
    if (item.kind === 'part') {
      const sheet = getSheet(s.design, s.activeSheetId);
      const inst = sheet?.parts.find((p) => p.id === item.id);
      if (!inst) continue;
      const net = nets.find((n) => n.pins.some((p) => p.refdes === inst.refdes));
      if (net) return net.name;
    }
  }
  return null;
}

const NET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function NetSettingsDialog({ initial, close }: { initial: string; close: () => void }) {
  const { nets } = useMemo(levelNets, []);
  const [netName, setNetName] = useState(initial);
  const net = nets.find((n) => n.name.toLowerCase() === netName.toLowerCase());
  const design = getState().design;
  const [form, setForm] = useState<NetSettings>(netSettings(design, netName) ?? {});
  const [rename, setRename] = useState(netName);
  const [error, setError] = useState<string | null>(null);

  const pick = (name: string) => {
    setNetName(name);
    setRename(name);
    setForm(netSettings(getState().design, name) ?? {});
    setError(null);
  };

  const num = (v: string): number | undefined => {
    const n = Number(v.replace(',', '.'));
    return v.trim() === '' || !Number.isFinite(n) || n < 0 ? undefined : n;
  };

  const apply = () => {
    const target = rename.trim();
    if (target !== netName) {
      if (!NET_NAME_RE.test(target)) {
        setError(stt('netNameBad'));
        return;
      }
      if (nets.some((n) => n.name.toLowerCase() === target.toLowerCase())) {
        setError(stt('netNameTaken', { name: target }));
        return;
      }
    }
    const wireIds = (net?.wireIds ?? []).map((wireId) => ({ sheetId: getState().activeSheetId, wireId }));
    actions.applyDesign((d) => {
      let next = setNetSettings(d, netName, { ...form, traceWidth: form.traceWidth, clearance: form.clearance });
      next = applyNetColor(next, wireIds, form.color || undefined);
      if (target !== netName) {
        next = renameNetSettings(next, netName, target);
        // rename the net's labels; a net with no label gets one on its first wire
        next = {
          ...next,
          sheets: next.sheets.map((sh) => ({
            ...sh,
            labels: sh.labels.map((l) => ((net?.labelIds ?? []).includes(l.id) ? { ...l, name: target } : l)),
          })),
        };
      }
      return next;
    });
    actions.addSimMessage('info', t('schematicTools.netApplied', { net: target || netName }), 'erc');
    close();
  };

  const pins = net ? net.pins.map((p) => `${p.refdes}.${p.pin}`) : [];
  return (
    <Dialog
      title={stt('netTitle', { net: netName })}
      onClose={close}
      width={520}
      className="ms-st-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={() => openHelp({ kind: 'guide', page: 'netSettings' })}>
            {t('help.whatIsThis')}
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
      <p className="ms-hint">{stt('netIntro')}</p>
      <div className="ms-st-fields">
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{stt('netPick')}</span>
          <select className="ms-input" value={netName} onChange={(e) => pick(e.target.value)}>
            {nets.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{stt('netName')}</span>
          <input className="ms-input" value={rename} onChange={(e) => setRename(e.target.value)} />
        </label>
        <p className="ms-hint">{stt('netNameHelp')}</p>
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{stt('netColor')}</span>
          <span className="ms-st-row">
            <input type="color" className="ms-input ms-st-color" value={form.color || '#2f8f3f'} onChange={(e) => setForm({ ...form, color: e.target.value })} aria-label={stt('netColor')} />
            <button type="button" className="ms-btn ms-btn-small" onClick={() => setForm({ ...form, color: undefined })}>
              {t('common.clear')}
            </button>
          </span>
        </label>
        <p className="ms-hint">{stt('netColorHelp')}</p>
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{stt('netNote')}</span>
          <input className="ms-input" value={form.note ?? ''} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>
        <label className="ms-cfield ms-cfield-check">
          <input type="checkbox" checked={!!form.keepName} onChange={(e) => setForm({ ...form, keepName: e.target.checked || undefined })} />
          <span>{stt('netKeepName')}</span>
        </label>
        <fieldset className="ms-st-group">
          <legend>{stt('netPcb')}</legend>
          <label className="ms-cfield ms-cfield-row">
            <span className="ms-cfield-label">{stt('netClass')}</span>
            <select className="ms-input" value={form.netClass ?? ''} onChange={(e) => setForm({ ...form, netClass: e.target.value || undefined })}>
              <option value="">{stt('netClassNone')}</option>
              {NET_CLASS_PRESETS.map((c) => (
                <option key={c.id} value={c.id}>
                  {stt(c.id === 'signal' ? 'netClassSignal' : c.id === 'bus' ? 'netClassBus' : c.id === 'power' ? 'netClassPower' : 'netClassHighVoltage')}
                </option>
              ))}
            </select>
          </label>
          <label className="ms-cfield ms-cfield-row">
            <span className="ms-cfield-label">{stt('netWidth')}</span>
            <input className="ms-input" value={form.traceWidth ?? ''} onChange={(e) => setForm({ ...form, traceWidth: num(e.target.value) })} inputMode="decimal" />
          </label>
          <label className="ms-cfield ms-cfield-row">
            <span className="ms-cfield-label">{stt('netClearance')}</span>
            <input className="ms-input" value={form.clearance ?? ''} onChange={(e) => setForm({ ...form, clearance: num(e.target.value) })} inputMode="decimal" />
          </label>
          <label className="ms-cfield ms-cfield-row">
            <span className="ms-cfield-label">{stt('netLayer')}</span>
            <select className="ms-input" value={form.layer ?? 'any'} onChange={(e) => setForm({ ...form, layer: e.target.value === 'any' ? undefined : e.target.value })}>
              {NET_LAYER_HINTS.map((l) => (
                <option key={l} value={l}>
                  {stt(l === 'any' ? 'netLayerAny' : l === 'top' ? 'netLayerTop' : l === 'bottom' ? 'netLayerBottom' : l === 'inner' ? 'netLayerInner' : 'netLayerPower')}
                </option>
              ))}
            </select>
          </label>
          <p className="ms-hint">{stt('netPcbHelp')}</p>
        </fieldset>
        <p className="ms-hint">{stt('netPins', { n: pins.length, pins: pins.slice(0, 8).join(', ') + (pins.length > 8 ? ' …' : '') })}</p>
        {error ? <p className="ms-st-error">{error}</p> : null}
      </div>
    </Dialog>
  );
}

export function openNetSettingsDialog(net?: string): void {
  const start = net ?? netOfSelection();
  if (!start) {
    void alertDialog({ title: t('cmd.tools.netSettings'), message: t('schematicTools.selectWireFirst') });
    return;
  }
  openCustomDialog((close) => <NetSettingsDialog initial={start} close={close} />);
}
