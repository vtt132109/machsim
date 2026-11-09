/**
 * Import SPICE model (Tools › Import SPICE model): paste or open `.model` / `.subckt` / `.lib`
 * text, resolve `.include` / `.lib` files (desktop: next to the opened file; browser: pick each
 * file), see the models it defines, test one with a small bias circuit, and then
 *   - add it to the design (Custom SPICE, used by name in parts' "SPICE model override"),
 *   - use it for the selected part (PartInstance.modelOverride; the text goes into Custom SPICE),
 *   - or make a new component from it (component wizard with the model filled in).
 */
import { useMemo, useState } from 'react';
import { modelEntries, normalizeIncludePath, parseModelLibrary } from '../../library/custom/spiceModels';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { actions, getState } from '../store';
import { getDesktopBridge } from '../../desktop/bridge';
import { formatEng } from '../../util/units';
import { explainSimError } from '../../i18n/erc';
import { partName } from '../../i18n/library';
import { t, tDynamic } from '../../i18n';
import { appendCustomSpice, inlineIncludes, overrideFits, quickBench, readBench, resolveModelText } from './spiceImport';
import { pickTextFile } from './fileIo';
import { openWizardDialog, selectedPart } from './ComponentWizard';
import { newWizard } from './wizardModel';
import './parts.css';

interface Bench {
  busy?: boolean;
  ok?: boolean;
  text?: string[];
}

export function SpiceImportDialog({ close, initialText = '' }: { close: () => void; initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<Map<string, string>>(() => new Map());
  const [basePath, setBasePath] = useState<string | undefined>();
  const [chosen, setChosen] = useState('');
  const [bench, setBench] = useState<Bench>({});
  const [done, setDone] = useState<string | null>(null);
  const lib = useMemo(() => parseModelLibrary(text, { files }), [text, files]);
  const entries = modelEntries(lib);
  const name = entries.some((e) => e.name === chosen) ? chosen : (entries.find((e) => e.terminals.length)?.name ?? '');
  const target = useMemo(() => selectedPart(), []);
  const fits = !!(target && name && overrideFits(target.def, lib, name));
  const flat = () => (files.size ? inlineIncludes(text, files) : text);

  const open = async () => {
    const f = await pickTextFile('.lib,.mod,.cir,.sp,.spi,.sub,.inc,.txt,.model', { spice: true });
    if (!f) return;
    setBasePath(f.path);
    setText(f.text);
    const bridge = getDesktopBridge();
    const res = await resolveModelText(f.text, async (p) => (f.path && bridge?.readIncludeFile ? ((await bridge.readIncludeFile(f.path, p))?.content ?? null) : null));
    setFiles(res.files);
    setBench({});
  };
  const pickInclude = async (path: string) => {
    const f = await pickTextFile('.lib,.mod,.cir,.sp,.spi,.sub,.inc,.txt,.model');
    if (!f) return;
    setFiles((m) => new Map(m).set(normalizeIncludePath(path), f.text));
  };

  const runBench = async () => {
    const b = quickBench(lib, name);
    if (!b) return;
    setBench({ busy: true });
    const sim = await import('../../sim');
    const r = readBench(b, sim.runAnalyses(b.netlist));
    if (r.ok) setBench({ ok: true, text: r.readings.map((x) => t('imp.reading', { what: tDynamic(`imp.bench.${x.key}`, undefined, x.key), v: formatEng(x.value, x.unit) })) });
    else setBench({ ok: false, text: [explainSimError(r.error).title, r.error] });
  };

  const addToDesign = () => {
    let res = { added: [] as string[], skipped: [] as string[] };
    actions.applyDesign((d) => {
      const r = appendCustomSpice(d, flat(), t('imp.header', { file: basePath ?? '' }));
      res = r;
      return r.design;
    });
    setDone(res.added.length ? t('imp.added', { names: res.added.join(', ') }) : t('imp.skipped', { names: res.skipped.join(', ') }));
  };

  const attach = () => {
    if (!target || !name) return;
    actions.applyDesign((d) => {
      const withText = appendCustomSpice(d, flat()).design;
      const patch = (sheets: typeof d.sheets) => sheets.map((s) => ({ ...s, parts: s.parts.map((p) => (p.id === target.instId ? { ...p, modelOverride: name } : p)) }));
      return { ...withText, sheets: patch(withText.sheets), ...(withText.children ? { children: withText.children.map((c) => ({ ...c, sheets: patch(c.sheets) })) } : {}) };
    });
    setDone(t('imp.attached', { name, part: partName(target.def) }));
  };

  const newPart = () => {
    close();
    openWizardDialog({ ...newWizard({ spice: { text: flat(), name } }), step: 0 });
  };

  return (
    <Dialog
      title={t('imp.title')}
      onClose={close}
      width={820}
      className="ms-imp-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" disabled={!name} onClick={addToDesign} title={t('tip.imp.addToDesign')}>
            {t('imp.addToDesign')}
          </button>
          <button type="button" className="ms-btn" disabled={!fits} onClick={attach} title={target ? (fits ? t('tip.imp.attach') : t('imp.attachIncompatible')) : t('imp.attachNone')}>
            {t('imp.attach')}
          </button>
          <button type="button" className="ms-btn" disabled={!name} onClick={newPart} title={t('tip.imp.newPart')}>
            {t('imp.newPart')}
          </button>
          <span className="ms-wiz-spacer" />
          <button type="button" className="ms-btn ms-btn-primary" onClick={close} title={t('common.close')}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{t('imp.intro')}</p>
      <div className="ms-wiz-spice-bar">
        <button type="button" className="ms-btn" onClick={() => void open()} title={t('tip.wiz.spiceOpen')}>
          {t('wiz.spiceOpen')}
        </button>
        {basePath ? <span className="ms-hint">{basePath}</span> : null}
      </div>
      <textarea
        className="ms-input ms-wiz-code"
        rows={10}
        spellCheck={false}
        data-autofocus
        value={text}
        placeholder={t('wiz.spicePlaceholder')}
        title={t('tip.wiz.spiceText')}
        onChange={(e) => {
          setText(e.target.value);
          setBench({});
          setDone(null);
        }}
      />
      {lib.errors.some((e) => !/include file '.*' not found/.test(e.message)) ? (
        <ul className="ms-wiz-issues">
          {lib.errors.filter((e) => !/include file '.*' not found/.test(e.message)).slice(0, 6).map((e, i) => (
            <li key={i}>{t('wiz.spiceError', { line: e.line, message: e.message })}</li>
          ))}
        </ul>
      ) : null}
      {lib.missing.length ? (
        <div className="ms-wiz-missing">
          <p className="ms-hint">{t('wiz.spiceMissing')}</p>
          {lib.missing.map((m) => (
            <div key={m}>
              <code>{m}</code>{' '}
              <button type="button" className="ms-btn ms-btn-small" title={t('tip.wiz.spicePickFile')} onClick={() => void pickInclude(m)}>
                {t('wiz.spicePickFile')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {entries.length ? (
        <table className="ms-table ms-wiz-table">
          <thead>
            <tr>
              <th />
              <th>{t('imp.col.name')}</th>
              <th>{t('imp.col.type')}</th>
              <th>{t('imp.col.terminals')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.name}>
                <td>
                  <input type="radio" name="ms-imp-model" checked={e.name === name} disabled={e.terminals.length === 0} aria-label={e.name} title={t('tip.wiz.spiceModel')} onChange={() => setChosen(e.name)} />
                </td>
                <td>{e.name}</td>
                <td>{e.kind === 'subckt' ? t('imp.type.subckt') : e.type}</td>
                <td>{e.terminals.length ? e.terminals.join(' ') : t('imp.unusable')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="ms-hint">{t('wiz.spiceNone')}</p>
      )}
      <div className="ms-wiz-maker-bar">
        <button type="button" className="ms-btn" disabled={!name || bench.busy || !quickBench(lib, name)} onClick={() => void runBench()} title={t('tip.imp.test')}>
          {t('imp.test')}
        </button>
        {target ? <span className="ms-hint">{t('imp.selected', { part: partName(target.def) })}</span> : <span className="ms-hint">{t('imp.attachNone')}</span>}
      </div>
      {bench.ok === true ? <p className="ms-wiz-ok">{t('imp.test.ok')}</p> : null}
      {bench.ok === false ? <p className="ms-wiz-error">{t('imp.test.failed')}</p> : null}
      {bench.text?.length ? (
        <ul className="ms-wiz-notes">
          {bench.text.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
      {done ? <p className="ms-wiz-ok">{done}</p> : null}
      {getState().design.customSpice ? <p className="ms-hint">{t('imp.customSpiceNote')}</p> : null}
    </Dialog>
  );
}

export function openSpiceImportDialog(initialText = ''): void {
  openCustomDialog((close) => <SpiceImportDialog close={close} initialText={initialText} />);
}
