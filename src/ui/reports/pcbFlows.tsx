/**
 * Transfer to PCB (File > Transfer to PCB; loaded on first use): KiCad and CSV netlist export,
 * forward annotation (changes since an earlier export -> annotation file) and back annotation
 * (an annotation file from the PCB tool -> renamed / re-valued / re-packaged schematic parts).
 */
import { useState } from 'react';
import { annotationText, applyBackAnnotation, csvNetlist, forwardAnnotation, kicadNetlist, parseAnnotation, pcbComponents, readNetlistSnapshot, type AnnotationChange, type BackAnnotationResult } from '../../model/pcb';
import { valuesHidden } from '../../model/restrictions';
import { Dialog } from '../common/Dialog';
import { alertDialog, openCustomDialog } from '../common/dialogs';
import { exportFile, pickTextFile } from '../app/files';
import { actions, getState } from '../store';
import { rt } from '../../i18n/reportUi';
import { t } from '../../i18n';
import './reports.css';

function stem(): string {
  const s = getState();
  const leaf = (s.fileName.split(/[\\/]/).pop() ?? s.fileName).replace(/\.[^.]*$/, '');
  return (leaf && !/^untitled$/i.test(leaf) ? leaf : s.design.title || 'design').replace(/[<>:"/\\|?*]/g, '_');
}

/** Refuse when the instructor hides values; warn about parts without footprint. Returns false to stop. */
async function precheck(): Promise<boolean> {
  const design = getState().design;
  if (valuesHidden(design)) {
    actions.addSimMessage('warning', t('learn.restricted.export'), 'pcb');
    return false;
  }
  const comps = pcbComponents(design);
  if (!comps.length) {
    await alertDialog({ title: t('menu.transfer'), message: rt('pcb.noComponents') });
    return false;
  }
  const missing = comps.filter((c) => !c.footprint).map((c) => c.ref);
  if (missing.length) actions.addSimMessage('warning', rt('pcb.missingFootprints', { n: missing.length, list: missing.slice(0, 12).join(', ') }), 'pcb');
  return true;
}

export async function exportKicadNetlist(): Promise<void> {
  if (!(await precheck())) return;
  const s = getState();
  const text = kicadNetlist(s.design, { source: s.fileName, date: new Date().toISOString(), tool: 'MachSim' });
  const comps = pcbComponents(s.design);
  const nets = new Set(comps.flatMap((c) => c.pins.map((p) => p.net)).filter(Boolean)).size;
  if (await exportFile(`${stem()}.net`, text, { name: 'KiCad netlist', extensions: ['net'] })) actions.addSimMessage('info', rt('pcb.exportedKicad', { n: comps.length, nets }), 'pcb');
}

export async function exportCsvNetlist(): Promise<void> {
  if (!(await precheck())) return;
  const text = csvNetlist(getState().design);
  const pins = text.split('\r\n').filter(Boolean).length - 1;
  if (await exportFile(`${stem()}-netlist.csv`, text, { name: 'CSV', extensions: ['csv'] })) actions.addSimMessage('info', rt('pcb.exportedCsv', { n: pins }), 'pcb');
}

/** One change as a line of text. */
export function changeText(c: AnnotationChange): string {
  switch (c.kind) {
    case 'rename':
      return rt('pcb.change.rename', { from: c.from, to: c.to });
    case 'value':
      return rt('pcb.change.value', { ref: c.ref, from: c.from || '—', to: c.to });
    case 'footprint':
      return rt('pcb.change.footprint', { ref: c.ref, from: c.from || '—', to: c.to || '—' });
    case 'add':
      return rt('pcb.change.add', { ref: c.ref, value: c.value, footprint: c.footprint || '—' });
    case 'remove':
      return rt('pcb.change.remove', { ref: c.ref });
    case 'net':
      return rt('pcb.change.net', { ref: c.ref, pin: c.pin, from: c.from || '—', to: c.to || '—' });
  }
}

function ForwardDialog({ close }: { close: () => void }) {
  const [changes, setChanges] = useState<AnnotationChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async () => {
    const f = await pickTextFile(['.net', '.csv', '.txt']);
    if (!f) return;
    try {
      setChanges(forwardAnnotation(readNetlistSnapshot(f.text), getState().design));
      setError(null);
    } catch (e) {
      setError(rt('pcb.parseFailed', { message: e instanceof Error ? e.message : String(e) }));
    }
  };
  const save = async () => {
    if (!changes) return;
    await exportFile(`${stem()}-forward.ann.txt`, annotationText(changes, 'forward', new Date().toISOString()), { name: 'Annotation', extensions: ['txt'] });
  };
  return (
    <Dialog
      title={rt('pcb.forwardTitle')}
      onClose={close}
      width={600}
      footer={
        <>
          <button type="button" className="ms-btn" title={rt('pcb.pickOldTip')} onClick={() => void pick()}>
            {rt('pcb.pickOld')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!changes?.length} title={rt('pcb.saveAnnotationTip')} onClick={() => void save()}>
            {rt('pcb.saveAnnotation')}
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p>{rt('pcb.forwardIntro')}</p>
      {error ? <p className="ms-pcb-warn">{error}</p> : null}
      {changes ? (
        changes.length ? (
          <>
            <p>{rt('pcb.changes', { n: changes.length })}</p>
            <ul className="ms-pcb-list">
              {changes.map((c, i) => (
                <li key={i}>{changeText(c)}</li>
              ))}
            </ul>
          </>
        ) : (
          <p>{rt('pcb.noChanges')}</p>
        )
      ) : null}
    </Dialog>
  );
}

function BackwardDialog({ close }: { close: () => void }) {
  const [preview, setPreview] = useState<{ result: BackAnnotationResult; errors: number[]; changes: AnnotationChange[] } | null>(null);
  const pick = async () => {
    const f = await pickTextFile(['.txt', '.ann', '.was', '.csv']);
    if (!f) return;
    const parsed = parseAnnotation(f.text);
    setPreview({ result: applyBackAnnotation(getState().design, parsed.commands), errors: parsed.errors, changes: parsed.commands.map((c) => c.change) });
  };
  const apply = () => {
    if (!preview) return;
    // recompute on the current design (it may have changed while the dialog was open)
    const r = applyBackAnnotation(getState().design, parseAnnotationFromChanges(preview.changes));
    actions.applyDesign(() => r.design);
    actions.addSimMessage('info', rt('pcb.applied', { n: r.applied }), 'pcb');
    close();
  };
  const reason = (s: BackAnnotationResult['skipped'][number]) =>
    s.reason === 'unsupported' ? rt('pcb.reason.unsupported', { kind: s.kind }) : rt(`pcb.reason.${s.reason}`, { ref: s.ref });
  return (
    <Dialog
      title={rt('pcb.backwardTitle')}
      onClose={close}
      width={600}
      footer={
        <>
          <button type="button" className="ms-btn" title={rt('pcb.pickAnnotationTip')} onClick={() => void pick()}>
            {rt('pcb.pickAnnotation')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!preview?.result.applied} title={rt('pcb.applyTip')} onClick={apply}>
            {rt('pcb.apply')}
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p>{rt('pcb.backwardIntro')}</p>
      {preview ? (
        <>
          <p>{rt('pcb.changes', { n: preview.result.applied })}</p>
          <ul className="ms-pcb-list">
            {preview.changes.map((c, i) => (
              <li key={i}>{changeText(c)}</li>
            ))}
          </ul>
          {[...preview.result.skipped.map((s) => rt('pcb.skipped', { line: s.line, reason: reason(s) })), ...preview.errors.map((line) => rt('pcb.skipped', { line, reason: rt('pcb.reason.syntax') }))].map((m, i) => (
            <p key={i} className="ms-pcb-warn">
              {m}
            </p>
          ))}
        </>
      ) : null}
    </Dialog>
  );
}

/** Commands for already parsed changes (line numbers are not needed to apply). */
function parseAnnotationFromChanges(changes: AnnotationChange[]) {
  return changes.map((change, i) => ({ line: i + 1, change }));
}

export function openForwardAnnotation(): void {
  openCustomDialog((close) => <ForwardDialog close={close} />);
}

export function openBackAnnotation(): void {
  openCustomDialog((close) => <BackwardDialog close={close} />);
}
