/**
 * Dialogs and flows of the schematic-capture round: find & replace, sheet setup (paper, colours,
 * title block), print setup, new subcircuit / hierarchical block, block from a file, replace
 * selection by subcircuit, bus vector connect, replace component, templates and pictures.
 * Each `open*` / flow function is used by a command (commands.ts) or the Properties panel host.
 */
import { useMemo, useState } from 'react';
import { listParts, getPart, loadAllGroups } from '../../library';
import type { ChildDesign, PrintSetup, PaperSize } from '../../model/types';
import { ensureDesignParts } from '../../model/libraryLoad';
import { busMembers } from '../../model/bus';
import { ALL_FIND_FIELDS, findInDesign, replaceInDesign, type FindField, type FindMatch } from '../../model/findReplace';
import { valuesHidden } from '../../model/restrictions';
import { serializeDesign, DesignFormatError } from '../../model/serialize';
import { parseDesignSafely } from '../../model/sanitize';
import { childIdOfPart, getChild } from '../../model/hierarchy';
import { PAPER_SIZES } from '../../model/paper';
import { BUILTIN_TEMPLATES, builtinTemplate, designFromTemplate, parseTemplateList, templateFromDesign, TEMPLATE_EXTENSION, type BuiltinTemplateId, type TemplateRecord } from '../../model/templates';
import { actions, getState, partLookup, useEditor } from '../store';
import { activeSheet } from '../store/editorStore';
import { childAsDesign } from '../store/hierarchyOps';
import { Dialog } from '../common/Dialog';
import { alertDialog, openCustomDialog, promptText } from '../common/dialogs';
import { CheckField, CommitField, SelectField } from '../common/Field';
import { Tabs } from '../common/Tabs';
import { SheetAndDesignProperties } from '../editor/PropertiesPanel';
import { SheetSetupFields, TitleBlockEditor } from '../editor/SchematicProperties';
import { focusCanvas } from '../editor/controller';
import { browserStorage, exportFile, fileNameForTitle, pickTextFile, saveTextAs } from './files';
import { runCommand } from './extensions';
import { confirmDiscardChanges } from './document';
import { t } from '../../i18n';
import { partName } from '../../i18n/library';

function errorText(err: unknown): string {
  if (err instanceof DesignFormatError) return err.issues.slice(0, 8).join('\n');
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// find & replace
// ---------------------------------------------------------------------------

function FindReplaceDialog({ close }: { close: () => void }) {
  const design = useEditor((s) => s.design);
  // hidden part values are not searched (findInDesign skips them); say so instead of a silent gap
  const hidden = valuesHidden(design);
  const [query, setQuery] = useState('');
  const [by, setBy] = useState('');
  const [fields, setFields] = useState<FindField[]>(ALL_FIND_FIELDS);
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [status, setStatus] = useState('');
  const opts = { fields, matchCase, wholeField: whole };
  const matches = useMemo(() => findInDesign(design, query, opts), [design, query, fields, matchCase, whole]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheetName = (id: string) => design.sheets.find((s) => s.id === id)?.name ?? design.children?.flatMap((c) => c.sheets.map((s) => ({ s, c }))).find((x) => x.s.id === id)?.c.name ?? '';
  const show = (m: FindMatch) => {
    actions.setActiveSheet(m.sheetId);
    actions.select([{ kind: m.kind, id: m.id }]);
    actions.fitSelection();
  };
  const replace = (only?: FindMatch[]) => {
    const r = replaceInDesign(design, query, by, opts, only);
    if (r.count) actions.applyDesign(() => r.design);
    setStatus(r.skipped.length ? t('schematic.find.replacedSkipped', { n: r.count, skipped: r.skipped.join(', ') }) : t('schematic.find.replaced', { n: r.count }));
  };
  const toggle = (f: FindField, on: boolean) => setFields((prev) => (on ? [...prev, f] : prev.filter((x) => x !== f)));
  return (
    <Dialog
      title={t('cmd.edit.findReplace')}
      onClose={close}
      width={520}
      footer={
        <>
          <button type="button" className="ms-btn" title={t('schematic.find.replaceOneTip')} disabled={!matches.length} onClick={() => replace([matches[0]])}>
            {t('schematic.find.replaceOne')}
          </button>
          <button type="button" className="ms-btn" title={t('schematic.find.replaceAllTip')} disabled={!matches.length} onClick={() => replace()}>
            {t('schematic.find.replaceAll')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="ms-form">
        <label className="ms-field">
          <span>{t('schematic.find.find')}</span>
          <input data-autofocus value={query} spellCheck={false} placeholder={t('schematic.find.findPlaceholder')} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <label className="ms-field">
          <span>{t('schematic.find.replaceBy')}</span>
          <input value={by} spellCheck={false} onChange={(e) => setBy(e.target.value)} />
        </label>
        <div className="ms-btn-row">
          {ALL_FIND_FIELDS.filter((f) => f !== 'value' || !hidden).map((f) => (
            <CheckField key={f} label={t(`schematic.find.field.${f}`)} checked={fields.includes(f)} onChange={(v) => toggle(f, v)} />
          ))}
        </div>
        {hidden ? <p className="ms-hint">{t('learn.restricted.find')}</p> : null}
        <div className="ms-btn-row">
          <CheckField label={t('schematic.find.matchCase')} checked={matchCase} onChange={setMatchCase} />
          <CheckField label={t('schematic.find.whole')} checked={whole} onChange={setWhole} />
        </div>
        <div role="listbox" aria-label={t('schematic.find.results')} className="ms-find-results">
          {query && !matches.length ? <div className="ms-empty">{t('schematic.find.none')}</div> : null}
          {matches.slice(0, 300).map((m, i) => (
            <div key={`${m.id}-${m.field}-${m.key ?? ''}-${i}`} role="option" aria-selected={false} className="ms-find-row" onClick={() => show(m)}>
              <strong>{t(`schematic.find.field.${m.field}`)}</strong>
              <span className="ms-mono">{m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text}</span>
              <span className="ms-hint">{sheetName(m.sheetId)}</span>
            </div>
          ))}
        </div>
        {status ? <p className="ms-hint">{status}</p> : <p className="ms-hint">{t('schematic.find.hint')}</p>}
      </div>
    </Dialog>
  );
}

export function openFindReplaceDialog(): void {
  openCustomDialog((close) => <FindReplaceDialog close={close} />);
}

// ---------------------------------------------------------------------------
// sheet setup
// ---------------------------------------------------------------------------

function SheetSetupDialog({ close }: { close: () => void }) {
  const sheet = useEditor(activeSheet);
  const [tab, setTab] = useState('sheet');
  const items = [
    { id: 'sheet', title: t('schematic.sheet.tabSheet') },
    { id: 'title', title: t('schematic.sheet.tabTitle') },
    { id: 'design', title: t('editor.properties.design') },
  ];
  return (
    <Dialog title={t('app.appDialogs.sheetAndDesignProperties')} onClose={close} width={500} className="ms-props-dialog" footer={<button type="button" className="ms-btn ms-btn-primary" onClick={close}>{t('common.close')}</button>}>
      <Tabs items={items} active={tab} onSelect={setTab} ariaLabel={t('app.appDialogs.sheetAndDesignProperties')} idPrefix="ms-sheetsetup" size="small" />
      <div role="tabpanel" className="ms-prop-tabpanel">
        {tab === 'sheet' ? (
          <div className="ms-prop-section">
            <CommitField label={t('editor.properties.sheetName')} value={sheet.name} validate={(v) => (v.trim() ? null : t('editor.properties.enterAName'))} onCommit={(v) => actions.renameSheet(sheet.id, v)} />
            <SheetSetupFields sheet={sheet} />
          </div>
        ) : null}
        {tab === 'title' ? (
          <div className="ms-prop-section">
            <TitleBlockEditor />
          </div>
        ) : null}
        {tab === 'design' ? <SheetAndDesignProperties /> : null}
      </div>
    </Dialog>
  );
}

export function openSheetSetupDialog(): void {
  openCustomDialog((close) => <SheetSetupDialog close={close} />);
}

// ---------------------------------------------------------------------------
// print setup
// ---------------------------------------------------------------------------

function PrintSetupDialog({ close, onPrint }: { close: () => void; onPrint: () => void }) {
  const ps = useEditor((s) => s.design.printSetup) ?? {};
  const hasChildren = useEditor((s) => (s.design.children?.length ?? 0) > 0);
  const set = (patch: Partial<PrintSetup>) => {
    const next: PrintSetup = { ...ps, ...patch };
    for (const k of Object.keys(next) as (keyof PrintSetup)[]) if (next[k] === undefined) delete next[k];
    actions.setPrintSetup(next);
  };
  const scaleText = ps.scale === undefined || ps.scale === 'fit' ? 'fit' : String(ps.scale);
  return (
    <Dialog
      title={t('cmd.file.printSetup')}
      onClose={close}
      width={460}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
          <button
            type="button"
            className="ms-btn ms-btn-primary"
            onClick={() => {
              close();
              onPrint();
            }}
          >
            {t('cmd.file.print')}
          </button>
        </>
      }
    >
      <div className="ms-prop-section">
        <SelectField label={t('schematic.print.paper')} value={ps.paper ?? 'A4'} options={PAPER_SIZES.filter((p) => p !== 'Custom').map((p) => ({ value: p, label: p }))} onChange={(v) => set({ paper: v as PaperSize })} />
        <SelectField
          label={t('schematic.sheet.orientation')}
          value={ps.orientation ?? 'landscape'}
          options={[
            { value: 'landscape', label: t('schematic.sheet.landscape') },
            { value: 'portrait', label: t('schematic.sheet.portrait') },
          ]}
          onChange={(v) => set({ orientation: v as 'landscape' | 'portrait' })}
        />
        <CommitField
          label={t('schematic.print.scale')}
          value={scaleText}
          validate={(v) => (v.trim() === 'fit' || (Number.isFinite(Number(v)) && Number(v) >= 5 && Number(v) <= 1000) ? null : t('schematic.print.scaleInvalid'))}
          onCommit={(v) => set({ scale: v.trim() === 'fit' ? 'fit' : Number(v) })}
          hint={t('schematic.print.scaleHint')}
        />
        <SelectField
          label={t('schematic.print.sheets')}
          value={Array.isArray(ps.sheets) ? 'all' : (ps.sheets ?? 'all')}
          options={[
            { value: 'all', label: t('schematic.print.allSheets') },
            { value: 'active', label: t('schematic.print.activeSheet') },
          ]}
          onChange={(v) => set({ sheets: v as 'all' | 'active' })}
        />
        {hasChildren ? <CheckField label={t('schematic.print.children')} checked={!!ps.includeChildren} onChange={(v) => set({ includeChildren: v || undefined })} /> : null}
        <CheckField label={t('schematic.print.instruments')} checked={!!ps.includeInstruments} onChange={(v) => set({ includeInstruments: v || undefined })} />
        <CheckField label={t('schematic.print.mono')} checked={!!ps.monochrome} onChange={(v) => set({ monochrome: v || undefined })} />
        <p className="ms-hint">{t('schematic.print.hint')}</p>
      </div>
    </Dialog>
  );
}

export function openPrintSetupDialog(onPrint: () => void): void {
  openCustomDialog((close) => <PrintSetupDialog close={close} onPrint={onPrint} />);
}

// ---------------------------------------------------------------------------
// hierarchy
// ---------------------------------------------------------------------------

/** Ask for a name and the ports, create the child design and start placing its block. */
export async function newChildFlow(kind: ChildDesign['kind']): Promise<void> {
  const name = await promptText({
    title: kind === 'hierarchical' ? t('cmd.place.newHierBlock') : t('cmd.place.newSubcircuit'),
    label: t('schematic.hier.nameLabel'),
    initial: kind === 'hierarchical' ? t('schematic.hier.defaultHB') : t('schematic.hier.defaultSC'),
    validate: (v) => (v.trim() ? null : t('editor.properties.enterAName')),
  });
  if (!name) return;
  const portsText = await promptText({
    title: t('schematic.hier.portsTitle'),
    label: t('schematic.hier.portsLabel'),
    initial: 'IN, OUT',
    validate: (v) => (v.split(',').every((p) => p.trim() === '' || /^[A-Za-z_][A-Za-z0-9_]*(\[\d+\.\.\d+\])?$/.test(p.trim())) ? null : t('schematic.hier.portsInvalid')),
  });
  if (portsText === null) return;
  const names = portsText.split(',').map((p) => p.trim()).filter(Boolean);
  const ports = names.map((p) => ({ name: p, side: /^(out|vout|q|y|o)\b|out$/i.test(p) ? ('right' as const) : ('left' as const) }));
  const id = actions.createChild({ kind, name, ports });
  actions.startPlacing(`hier:${id}`);
  actions.addSimMessage('info', t('schematic.hier.placeHint', { name }), 'hierarchy');
  focusCanvas();
}

/** Load a .msim file as a hierarchical block and start placing it. */
export async function blockFromFileFlow(): Promise<void> {
  const f = await pickTextFile();
  if (!f) return;
  let design;
  try {
    design = parseDesignSafely(f.text).design;
  } catch (err) {
    await alertDialog({ title: t('schematic.hier.fileFailed'), message: errorText(err) });
    return;
  }
  await ensureDesignParts(design);
  const id = actions.addChildFromDesign(design, design.title || f.name.replace(/\.msim$/i, ''), f.name);
  actions.startPlacing(`hier:${id}`);
  focusCanvas();
}

/** Replace the selection by a new subcircuit (asks for the name). */
export async function replaceBySubcircuitFlow(kind: ChildDesign['kind'] = 'subcircuit'): Promise<void> {
  const s = getState();
  if (!s.selection.some((x) => x.kind === 'part')) {
    await alertDialog({ title: t('cmd.place.replaceBySubcircuit'), message: t('schematic.hier.selectFirst') });
    return;
  }
  const name = await promptText({ title: t('cmd.place.replaceBySubcircuit'), label: t('schematic.hier.nameLabel'), initial: t('schematic.hier.defaultSC'), validate: (v) => (v.trim() ? null : t('editor.properties.enterAName')) });
  if (!name) return;
  const r = actions.replaceWithSubcircuit(kind, name);
  if (r) actions.addSimMessage('info', t('schematic.hier.replaced', { name, ports: r.ports.join(', ') || '—' }), 'hierarchy');
}

/** Save a child design as a stand-alone .msim file. */
export async function saveChildAsFile(childId: string): Promise<void> {
  const d = getState().design;
  const own = childAsDesign(d, childId);
  if (!own) return;
  try {
    await saveTextAs(serializeDesign(own), fileNameForTitle(own.title));
  } catch (err) {
    await alertDialog({ title: t('app.document.saveFailed'), message: errorText(err) });
  }
}

/** Open the child design of the selected block. */
export function openSelectedBlock(): boolean {
  const s = getState();
  const sel = s.selection.find((x) => x.kind === 'part');
  if (!sel) return false;
  return actions.openBlock(sel.id);
}

// ---------------------------------------------------------------------------
// bus vector connect
// ---------------------------------------------------------------------------

function BusVectorDialog({ close, partId }: { close: () => void; partId: string }) {
  const inst = useEditor((s) => activeSheet(s).parts.find((p) => p.id === partId));
  const def = inst ? partLookup(inst.partId) : undefined;
  const allPins = def?.symbol.pins.map((p) => p.name) ?? [];
  const [pins, setPins] = useState(allPins.join(', '));
  const [bus, setBus] = useState('D[0..7]');
  const lines = busMembers(bus);
  const pinList = pins.split(',').map((p) => p.trim()).filter(Boolean);
  const bad = pinList.filter((p) => !allPins.includes(p));
  const n = Math.min(pinList.length, lines.length);
  return (
    <Dialog
      title={t('cmd.place.busVector')}
      onClose={close}
      width={480}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="ms-btn ms-btn-primary"
            disabled={!n || bad.length > 0}
            onClick={() => {
              const k = actions.connectPinsToBus(partId, pinList, lines);
              actions.addSimMessage('info', t('schematic.bus.connected', { n: k }), 'bus');
              close();
            }}
          >
            {t('schematic.bus.connect')}
          </button>
        </>
      }
    >
      <div className="ms-form">
        <p className="ms-hint">{t('schematic.bus.vectorHint')}</p>
        <label className="ms-field">
          <span>{t('schematic.bus.pins', { refdes: inst?.refdes ?? '' })}</span>
          <input data-autofocus value={pins} spellCheck={false} onChange={(e) => setPins(e.target.value)} />
        </label>
        <label className="ms-field">
          <span>{t('schematic.prop.busName')}</span>
          <input value={bus} spellCheck={false} onChange={(e) => setBus(e.target.value)} />
        </label>
        <p className="ms-hint">{bad.length ? t('schematic.bus.badPins', { pins: bad.join(', ') }) : t('schematic.bus.preview', { pairs: pinList.slice(0, n).map((p, i) => `${p}→${lines[i]}`).join(', ') || '—' })}</p>
      </div>
    </Dialog>
  );
}

export async function busVectorFlow(): Promise<void> {
  const s = getState();
  const sel = s.selection.find((x) => x.kind === 'part');
  if (!sel) {
    await alertDialog({ title: t('cmd.place.busVector'), message: t('schematic.bus.selectPart') });
    return;
  }
  openCustomDialog((close) => <BusVectorDialog close={close} partId={sel.id} />);
}

// ---------------------------------------------------------------------------
// replace component
// ---------------------------------------------------------------------------

function ReplacePartDialog({ close, partId }: { close: () => void; partId: string }) {
  const inst = useEditor((s) => activeSheet(s).parts.find((p) => p.id === partId) ?? null);
  const current = inst ? getPart(inst.partId) : undefined;
  const [query, setQuery] = useState('');
  const pinCount = current?.symbol.pins.length ?? 0;
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return listParts()
      .filter((p) => p.id !== current?.id && p.globalNet === undefined && !p.instrument && p.symbol.pins.length === pinCount)
      .filter((p) => !q || p.id.toLowerCase().includes(q) || partName(p).toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
      .slice(0, 200);
  }, [query, current, pinCount]);
  return (
    <Dialog title={t('cmd.edit.replaceComponent')} onClose={close} width={480} footer={<button type="button" className="ms-btn" onClick={close}>{t('common.cancel')}</button>}>
      <div className="ms-form">
        <p className="ms-hint">{t('schematic.replace.hint', { refdes: inst?.refdes ?? '', pins: pinCount })}</p>
        <label className="ms-field">
          <span>{t('schematic.replace.search')}</span>
          <input data-autofocus value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div role="listbox" aria-label={t('schematic.replace.list')} className="ms-find-results">
          {candidates.map((p) => (
            <div
              key={p.id}
              role="option"
              aria-selected={false}
              className="ms-find-row"
              onClick={() => {
                actions.replacePart(partId, p.id);
                close();
                focusCanvas();
              }}
            >
              <strong>{partName(p)}</strong>
              <span className="ms-hint ms-mono">{p.id}</span>
            </div>
          ))}
          {!candidates.length ? <div className="ms-empty">{t('schematic.replace.none')}</div> : null}
        </div>
      </div>
    </Dialog>
  );
}

export function openReplacePartDialog(partId?: string): void {
  const s = getState();
  const id = partId ?? s.selection.find((x) => x.kind === 'part')?.id;
  if (!id) {
    void alertDialog({ title: t('cmd.edit.replaceComponent'), message: t('schematic.replace.selectPart') });
    return;
  }
  const inst = activeSheet(s).parts.find((p) => p.id === id);
  if (inst && childIdOfPart(inst.partId) !== undefined) {
    void alertDialog({ title: t('cmd.edit.replaceComponent'), message: t('schematic.replace.notBlock') });
    return;
  }
  // the candidates come from the whole catalogue: load the packs not opened yet first
  void loadAllGroups().then(() => openCustomDialog((close) => <ReplacePartDialog close={close} partId={id} />));
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

export const TEMPLATES_KEY = 'machsim.templates.v1';

export function userTemplates(): TemplateRecord[] {
  return parseTemplateList(browserStorage()?.getItem(TEMPLATES_KEY) ?? null);
}

/** Add (or replace by name) a user template, e.g. one read from a .msimtpl file. */
export function addUserTemplate(rec: TemplateRecord): void {
  writeTemplates([...userTemplates().filter((r) => r.name !== rec.name), rec]);
}

function writeTemplates(list: TemplateRecord[]): void {
  try {
    browserStorage()?.setItem(TEMPLATES_KEY, JSON.stringify(list));
  } catch {
    /* storage full or unavailable: the template list stays as it was */
  }
}

function TemplateDialog({ close }: { close: () => void }) {
  const [list, setList] = useState(userTemplates);
  const create = async (make: (title: string) => ReturnType<typeof designFromTemplate>) => {
    close();
    if (!(await confirmDiscardChanges(t('app.document.startANewDesign')))) return;
    const title = await promptText({ title: t('cmd.file.newFromTemplate'), label: t('editor.properties.title'), initial: t('schematic.tpl.untitled'), validate: (v) => (v.trim() ? null : t('editor.properties.enterATitle')) });
    if (!title) return;
    const design = make(title);
    await ensureDesignParts(design);
    actions.loadDesign(design, fileNameForTitle(title), false);
  };
  const notes = () => [t('schematic.tpl.lab.goal'), t('schematic.tpl.lab.parts'), t('schematic.tpl.lab.steps'), t('schematic.tpl.lab.results')];
  return (
    <Dialog
      title={t('cmd.file.newFromTemplate')}
      onClose={close}
      width={480}
      footer={
        <>
          <button
            type="button"
            className="ms-btn"
            title={t('files.tpl.openFileTip')}
            onClick={() => {
              close();
              runCommand('file.importTemplate');
            }}
          >
            {t('cmd.file.importTemplate')}
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
        </>
      }
    >
      <div className="ms-form">
        <p className="ms-hint">{t('schematic.tpl.hint')}</p>
        <div role="listbox" aria-label={t('schematic.tpl.builtin')} className="ms-find-results">
          {BUILTIN_TEMPLATES.map((id: BuiltinTemplateId) => (
            <div key={id} role="option" aria-selected={false} className="ms-find-row" title={t(`schematic.tpl.desc.${id}`)} onClick={() => void create((title) => builtinTemplate(id, title, t('sheet.default', { n: 1 }), id === 'lab-report' ? notes() : []))}>
              <strong>{t(`schematic.tpl.name.${id}`)}</strong>
              <span className="ms-hint">{t(`schematic.tpl.desc.${id}`)}</span>
            </div>
          ))}
          {list.map((rec, i) => (
            <div key={`${rec.name}-${i}`} role="option" aria-selected={false} className="ms-find-row" onClick={() => void create((title) => designFromTemplate(rec, title))}>
              <strong>{rec.name}</strong>
              <span className="ms-hint">{rec.withContent ? t('schematic.tpl.withContent') : t('schematic.tpl.settingsOnly')}</span>
              <button
                type="button"
                className="ms-btn ms-btn-small"
                title={t('files.tpl.exportTip')}
                onClick={(e) => {
                  e.stopPropagation();
                  void exportFile(fileNameForTitle(rec.name, TEMPLATE_EXTENSION), JSON.stringify(rec, null, 2), { name: t('files.tpl.filter'), extensions: [TEMPLATE_EXTENSION.slice(1)] });
                }}
              >
                {t('files.tpl.export')}
              </button>
              <button
                type="button"
                className="ms-btn ms-btn-small"
                title={t('schematic.tpl.deleteTip')}
                onClick={(e) => {
                  e.stopPropagation();
                  const next = list.filter((_, j) => j !== i);
                  writeTemplates(next);
                  setList(next);
                }}
              >
                {t('common.delete')}
              </button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export function openNewFromTemplateDialog(): void {
  openCustomDialog((close) => <TemplateDialog close={close} />);
}

/** Save the current design's settings (optionally with content) as a user template. */
export async function saveAsTemplateFlow(): Promise<void> {
  const d = getState().design;
  const name = await promptText({ title: t('cmd.file.saveAsTemplate'), label: t('schematic.tpl.nameLabel'), initial: d.title, validate: (v) => (v.trim() ? null : t('editor.properties.enterAName')) });
  if (!name) return;
  const withContent = await new Promise<boolean | null>((resolve) =>
    openCustomDialog((close) => (
      <Dialog
        title={t('cmd.file.saveAsTemplate')}
        onClose={() => {
          close();
          resolve(null);
        }}
        width={420}
        footer={
          <>
            <button type="button" className="ms-btn" onClick={() => { close(); resolve(false); }}>
              {t('schematic.tpl.settingsOnly')}
            </button>
            <button type="button" className="ms-btn ms-btn-primary" onClick={() => { close(); resolve(true); }}>
              {t('schematic.tpl.withContent')}
            </button>
          </>
        }
      >
        <p>{t('schematic.tpl.contentQuestion')}</p>
      </Dialog>
    )),
  );
  if (withContent === null) return;
  const rec = templateFromDesign(d, name, withContent);
  writeTemplates([...userTemplates().filter((r) => r.name !== rec.name), rec]);
  actions.addSimMessage('info', t('schematic.tpl.saved', { name: rec.name }), 'template');
}

// ---------------------------------------------------------------------------
// pictures
// ---------------------------------------------------------------------------

const IMAGE_MAX = 2_000_000;

/** Let the user choose an image file; resolves a data: URL (null when cancelled / too big). */
export function pickImageDataUrl(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp';
    input.style.display = 'none';
    let done = false;
    const finish = (v: string | null) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      if (file.size > IMAGE_MAX) {
        void alertDialog({ title: t('schematic.picture.title'), message: t('schematic.picture.tooBig', { mb: (IMAGE_MAX / 1e6).toFixed(0) }) });
        return finish(null);
      }
      const reader = new FileReader();
      reader.onload = () => finish(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => finish(null);
      reader.readAsDataURL(file);
    });
    input.addEventListener('cancel', () => finish(null));
    document.body.appendChild(input);
    input.click();
  });
}

/** Replace the image of a picture annotation. */
export async function replacePictureFlow(shapeId: string): Promise<void> {
  const src = await pickImageDataUrl();
  if (src) actions.updateShape(shapeId, { src });
}

/** True when a child id exists in the current design (for menu enabling). */
export function hasChild(id: string): boolean {
  return getChild(getState().design, id) !== undefined;
}
