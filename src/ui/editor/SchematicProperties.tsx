/**
 * Property editors added with format version 2 (used by the Properties panel and dialogs):
 * labels / connectors / bus entries, buses, note styles and comments, graphic annotations,
 * blocks (subcircuits / hierarchical blocks) and their child designs, lock / group / align tools
 * for multi-selections, sheet paper / border / grid / colours and the title block.
 * Every field explains itself in a short learner-oriented hint (current language).
 */
import { useMemo } from 'react';
import type { ChildDesign, LabelKind, NetLabel, PaperSize, PartInstance, Rotation, Shape, Sheet, SheetColors, SheetProps, TextNote, TitleBlockFields, Wire } from '../../model/types';
import { busMembers, parseBusName } from '../../model/bus';
import { childIdOfPart, childPorts, getChild } from '../../model/hierarchy';
import { PAPER_SIZES, TITLE_BLOCK_FIELDS, sheetFrame } from '../../model/paper';
import { actions, useEditor } from '../store';
import { findItem } from '../store/designOps';
import { childUseCount } from '../store/hierarchyOps';
import { busOfWire } from '../store/schematicOps';
import type { SelItem } from '../store/types';
import { CheckField, ColorField, CommitField, SelectField } from '../common/Field';
import { validateNetName } from './paramFields';
import { parseVariablesText, variablesToText } from './variablesText';
import { t, type MessageKey } from '../../i18n';

const ROTATIONS = (): { value: string; label: string }[] => (['0', '90', '180', '270'] as const).map((value) => ({ value, label: t(`rotation.${value}`) }));

const LABEL_KINDS: LabelKind[] = ['label', 'offpage', 'hier', 'global', 'bus-entry'];

/** Name check for labels and connectors: a net name, or a bus name such as D[0..7] for connectors on buses. */
export function validateConnectorName(kind: LabelKind, name: string): string | null {
  const txt = name.trim();
  if (kind !== 'bus-entry' && (txt.includes('[') || txt.includes(','))) {
    const p = parseBusName(txt);
    return p.error ? t('schematic.prop.badBusName', { problem: p.error }) : null;
  }
  return validateNetName(txt);
}

/** "Locked" check box for any item (locked items cannot be moved, rotated or deleted). */
export function LockedField({ item, locked }: { item: SelItem; locked: boolean | undefined }) {
  const set = (v: boolean) => {
    actions.select([item]);
    actions.setLocked(v);
  };
  return <CheckField label={t('schematic.prop.locked')} checked={!!locked} onChange={set} />;
}

// ---------------------------------------------------------------------------
// labels and connectors
// ---------------------------------------------------------------------------

export function LabelItemProperties({ label }: { label: NetLabel }) {
  const kind = label.kind ?? 'label';
  const kindOptions = LABEL_KINDS.map((k) => ({ value: k, label: t(`schematic.kind.${k === 'bus-entry' ? 'busEntry' : k}`) }));
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t(`schematic.kind.${kind === 'bus-entry' ? 'busEntry' : kind}`)}</strong>
      </div>
      <CommitField
        label={kind === 'bus-entry' ? t('schematic.prop.busLine') : t('common.netName')}
        value={label.name}
        validate={(v) => validateConnectorName(kind, v)}
        onCommit={(v) => actions.updateLabel(label.id, { name: v.trim() })}
        hint={t(`schematic.kindHelp.${kind === 'bus-entry' ? 'busEntry' : kind}`)}
      />
      <SelectField
        label={t('schematic.prop.kind')}
        value={kind}
        options={kindOptions}
        onChange={(v) => actions.updateLabel(label.id, { kind: v === 'label' ? undefined : (v as LabelKind), ...(v !== 'label' ? { global: undefined } : {}) })}
      />
      {kind === 'label' ? <CheckField label={t('schematic.prop.global')} checked={!!label.global} onChange={(v) => actions.updateLabel(label.id, { global: v ? true : undefined })} /> : null}
      {kind !== 'bus-entry' ? <SelectField label={t('editor.properties.orientation')} value={String(label.rotation)} options={ROTATIONS()} onChange={(v) => actions.updateLabel(label.id, { rotation: Number(v) as Rotation })} /> : null}
      <LockedField item={{ kind: 'label', id: label.id }} locked={label.locked} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// buses
// ---------------------------------------------------------------------------

export function BusProperties({ wire }: { wire: Wire }) {
  const sheet = useEditor((s) => {
    const f = findItem(s.design, 'wire', wire.id);
    return f ? (s.design.sheets.find((x) => x.id === f.sheetId) ?? s.design.children?.flatMap((c) => c.sheets).find((x) => x.id === f.sheetId)) : undefined;
  });
  const bus = useMemo(() => (sheet ? busOfWire(sheet, wire.id) : { wireIds: [] }), [sheet, wire.id]);
  const lines = busMembers(bus.name ?? wire.busName ?? '');
  const entries = sheet ? sheet.labels.filter((l) => l.kind === 'bus-entry').length : 0;
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t('schematic.prop.bus')}</strong>
        <span>{t('schematic.prop.segments', { n: bus.wireIds.length })}</span>
      </div>
      <CommitField
        label={t('schematic.prop.busName')}
        value={bus.name ?? wire.busName ?? ''}
        placeholder={t('schematic.prop.busNamePlaceholder')}
        validate={(v) => (v.trim() === '' || busMembers(v).length ? null : t('schematic.prop.badBusName', { problem: parseBusName(v).error ?? '' }))}
        onCommit={(v) => actions.renameBus(wire.id, v)}
        hint={t('schematic.prop.busNameHint')}
      />
      <dl className="ms-info">
        <dt>{t('schematic.prop.lines')}</dt>
        <dd className="ms-mono">{lines.length ? `${lines.slice(0, 16).join(', ')}${lines.length > 16 ? ' …' : ''} (${lines.length})` : '—'}</dd>
        <dt>{t('schematic.prop.entries')}</dt>
        <dd>{entries}</dd>
      </dl>
      <ColorField label={t('common.colour')} value={wire.color} allowDefault onChange={(c) => actions.updateWire(wire.id, { color: c })} />
      <LockedField item={{ kind: 'wire', id: wire.id }} locked={wire.locked} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// notes, comments and shapes
// ---------------------------------------------------------------------------

export function NoteStyleFields({ note }: { note: TextNote }) {
  const st = note.style ?? {};
  const set = (patch: Partial<NonNullable<TextNote['style']>>) => {
    const next = { ...st, ...patch };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    actions.updateNote(note.id, { style: Object.keys(next).length ? next : undefined });
  };
  return (
    <>
      <div className="ms-prop-sep" />
      {note.comment ? (
        <>
          <CommitField label={t('schematic.prop.author')} value={note.author ?? ''} onCommit={(v) => actions.updateNote(note.id, { author: v.trim() || undefined })} />
          <CheckField label={t('schematic.prop.collapsed')} checked={!!note.collapsed} onChange={(v) => actions.updateNote(note.id, { collapsed: v ? true : undefined })} />
          {note.created ? <p className="ms-hint">{t('schematic.prop.created', { when: note.created.replace('T', ' ').slice(0, 16) })}</p> : null}
        </>
      ) : (
        <>
          <SelectField
            label={t('schematic.prop.font')}
            value={st.font ?? 'sans'}
            options={(['sans', 'serif', 'mono'] as const).map((f) => ({ value: f, label: t(`schematic.font.${f}`) }))}
            onChange={(v) => set({ font: v === 'sans' ? undefined : (v as 'serif' | 'mono') })}
          />
          <div className="ms-btn-row">
            <CheckField label={t('schematic.prop.bold')} checked={!!st.bold} onChange={(v) => set({ bold: v })} />
            <CheckField label={t('schematic.prop.italic')} checked={!!st.italic} onChange={(v) => set({ italic: v })} />
            <CheckField label={t('schematic.prop.underline')} checked={!!st.underline} onChange={(v) => set({ underline: v })} />
          </div>
          <SelectField
            label={t('schematic.prop.align')}
            value={st.align ?? 'start'}
            options={(['start', 'middle', 'end'] as const).map((a) => ({ value: a, label: t(`schematic.align.${a}`) }))}
            onChange={(v) => set({ align: v === 'start' ? undefined : (v as 'middle' | 'end') })}
          />
          <ColorField label={t('common.colour')} value={st.color} allowDefault onChange={(c) => set({ color: c })} />
        </>
      )}
      <CheckField label={t('schematic.prop.comment')} checked={!!note.comment} onChange={(v) => actions.updateNote(note.id, { comment: v ? true : undefined, ...(v && !note.created ? { created: new Date().toISOString() } : {}) })} />
      <LockedField item={{ kind: 'note', id: note.id }} locked={note.locked} />
    </>
  );
}

const DASHES = ['solid', 'dash', 'dot'] as const;

export function ShapeProperties({ shape, onReplaceImage }: { shape: Shape; onReplaceImage?: () => void }) {
  const num = (v: string, lo: number, hi: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= lo && n <= hi ? null : t('schematic.prop.between', { lo, hi });
  };
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t(`schematic.shape.${shape.kind}`)}</strong>
        <span>{t('schematic.prop.points', { n: shape.points.length })}</span>
      </div>
      {shape.kind !== 'picture' ? (
        <>
          <ColorField label={t('schematic.prop.stroke')} value={shape.stroke} allowDefault onChange={(c) => actions.updateShape(shape.id, { stroke: c })} />
          <CommitField label={t('schematic.prop.strokeWidth')} value={String(shape.strokeWidth ?? 1.2)} validate={(v) => num(v, 0.2, 20)} onCommit={(v) => actions.updateShape(shape.id, { strokeWidth: Number(v) === 1.2 ? undefined : Number(v) })} />
          <SelectField label={t('schematic.prop.dash')} value={shape.dash ?? 'solid'} options={DASHES.map((d) => ({ value: d, label: t(`schematic.dash.${d}`) }))} onChange={(v) => actions.updateShape(shape.id, { dash: v === 'solid' ? undefined : (v as 'dash' | 'dot') })} />
          {shape.kind !== 'line' && shape.kind !== 'polyline' && shape.kind !== 'arc' ? (
            <ColorField label={t('schematic.prop.fill')} value={shape.fill || undefined} allowDefault onChange={(c) => actions.updateShape(shape.id, { fill: c })} />
          ) : null}
          {shape.kind === 'arc' ? (
            <>
              <CommitField label={t('schematic.prop.arcStart')} value={String(shape.start ?? 0)} unit="°" validate={(v) => num(v, -360, 720)} onCommit={(v) => actions.updateShape(shape.id, { start: Number(v) })} />
              <CommitField label={t('schematic.prop.arcEnd')} value={String(shape.end ?? 180)} unit="°" validate={(v) => num(v, -360, 720)} onCommit={(v) => actions.updateShape(shape.id, { end: Number(v) })} hint={t('schematic.prop.arcHint')} />
            </>
          ) : null}
        </>
      ) : onReplaceImage ? (
        <button type="button" className="ms-btn ms-btn-small" title={t('schematic.prop.replaceImageTip')} onClick={onReplaceImage}>
          {t('schematic.prop.replaceImage')}
        </button>
      ) : null}
      <LockedField item={{ kind: 'shape', id: shape.id }} locked={shape.locked} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// blocks and child designs
// ---------------------------------------------------------------------------

/** Block (subcircuit / hierarchical block) section of a part's Label tab. */
export function BlockSection({ inst, onSaveAsFile }: { inst: PartInstance; onSaveAsFile?: (childId: string) => void }) {
  const childId = childIdOfPart(inst.partId);
  const child = useEditor((s) => (childId ? getChild(s.design, childId) : undefined));
  const uses = useEditor((s) => (childId ? childUseCount(s.design, childId) : 0));
  if (!childId || !child) return null;
  return (
    <>
      <div className="ms-prop-sep" />
      <div className="ms-prop-head">
        <strong>{child.kind === 'hierarchical' ? t('schematic.kind.hierBlock') : t('schematic.kind.subcircuit')}</strong>
        <span>{t('schematic.prop.uses', { n: uses })}</span>
      </div>
      <p className="ms-hint">{t('schematic.prop.blockHint')}</p>
      <div className="ms-btn-row">
        <button type="button" className="ms-btn ms-btn-small ms-btn-primary" title={t('schematic.prop.openBlockTip')} onClick={() => actions.openBlock(inst.id)}>
          {t('schematic.prop.openBlock')}
        </button>
        {onSaveAsFile ? (
          <button type="button" className="ms-btn ms-btn-small" title={t('schematic.prop.saveBlockTip')} onClick={() => onSaveAsFile(child.id)}>
            {t('schematic.prop.saveBlock')}
          </button>
        ) : null}
      </div>
      <ChildInfoFields child={child} />
    </>
  );
}

/** Name, kind, description, instance parameters and port order of a child design. */
export function ChildInfoFields({ child }: { child: ChildDesign }) {
  const ports = childPorts(child);
  return (
    <>
      <CommitField label={t('common.name')} value={child.name} validate={(v) => (v.trim() ? null : t('editor.properties.enterAName'))} onCommit={(v) => actions.updateChildInfo(child.id, { name: v })} />
      <SelectField
        label={t('schematic.prop.kind')}
        value={child.kind}
        options={[
          { value: 'subcircuit', label: t('schematic.kind.subcircuit') },
          { value: 'hierarchical', label: t('schematic.kind.hierBlock') },
        ]}
        onChange={(v) => actions.updateChildInfo(child.id, { kind: v as ChildDesign['kind'] })}
      />
      <CommitField label={t('common.description')} layout="stack" multiline rows={2} value={child.description ?? ''} onCommit={(v) => actions.updateChildInfo(child.id, { description: v })} />
      <CommitField
        label={t('schematic.prop.parameters')}
        layout="stack"
        multiline
        rows={3}
        placeholder={t('schematic.prop.parametersPlaceholder')}
        value={variablesToText(child.variables)}
        validate={(v) => parseVariablesText(v).error}
        onCommit={(v) => actions.updateChildInfo(child.id, { variables: parseVariablesText(v).vars })}
        hint={t('schematic.prop.parametersHint')}
      />
      <CommitField
        label={t('schematic.prop.portOrder')}
        value={ports.map((p) => p.name).join(', ')}
        onCommit={(v) => actions.updateChildInfo(child.id, { portOrder: v.split(',').map((x) => x.trim()).filter(Boolean) })}
        hint={t('schematic.prop.portOrderHint')}
      />
      {child.sourceFile ? <p className="ms-hint">{t('schematic.prop.sourceFile', { file: child.sourceFile })}</p> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// multi-selection tools
// ---------------------------------------------------------------------------

export function SelectionTools({ count, onReplaceBySubcircuit }: { count: number; onReplaceBySubcircuit?: () => void }) {
  const btn = (key: MessageKey, tip: MessageKey, fn: () => void, disabled = false) => (
    <button type="button" className="ms-btn ms-btn-small" title={t(tip)} disabled={disabled} onClick={fn}>
      {t(key)}
    </button>
  );
  return (
    <>
      <div className="ms-prop-sep" />
      <div className="ms-prop-head">
        <strong>{t('schematic.prop.arrange')}</strong>
      </div>
      <div className="ms-btn-row">
        {btn('schematic.align.left', 'schematic.alignTip.left', () => actions.alignSelection('left'), count < 2)}
        {btn('schematic.align.hcenter', 'schematic.alignTip.hcenter', () => actions.alignSelection('hcenter'), count < 2)}
        {btn('schematic.align.right', 'schematic.alignTip.right', () => actions.alignSelection('right'), count < 2)}
      </div>
      <div className="ms-btn-row">
        {btn('schematic.align.top', 'schematic.alignTip.top', () => actions.alignSelection('top'), count < 2)}
        {btn('schematic.align.vcenter', 'schematic.alignTip.vcenter', () => actions.alignSelection('vcenter'), count < 2)}
        {btn('schematic.align.bottom', 'schematic.alignTip.bottom', () => actions.alignSelection('bottom'), count < 2)}
      </div>
      <div className="ms-btn-row">
        {btn('schematic.distribute.h', 'schematic.distributeTip.h', () => actions.distributeSelection('h'), count < 3)}
        {btn('schematic.distribute.v', 'schematic.distributeTip.v', () => actions.distributeSelection('v'), count < 3)}
      </div>
      <div className="ms-btn-row">
        {btn('schematic.group', 'schematic.groupTip', () => actions.groupSelection(), count < 2)}
        {btn('schematic.ungroup', 'schematic.ungroupTip', () => actions.ungroupSelection())}
        {btn('schematic.lock', 'schematic.lockTip', () => actions.setLocked(true))}
        {btn('schematic.unlock', 'schematic.unlockTip', () => actions.setLocked(false))}
      </div>
      {onReplaceBySubcircuit ? <div className="ms-btn-row">{btn('cmd.place.replaceBySubcircuit', 'schematic.replaceBySubTip', onReplaceBySubcircuit)}</div> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// sheet setup and title block
// ---------------------------------------------------------------------------

const SCHEMES = ['default', 'white', 'black', 'custom'] as const;

/** Paper, orientation, border, title block, grid style and colours of one sheet. */
export function SheetSetupFields({ sheet }: { sheet: Sheet }) {
  const p: SheetProps = sheet.props ?? {};
  const frame = sheetFrame(sheet.props);
  const set = (patch: Partial<SheetProps>) => {
    const next: SheetProps = { ...p, ...patch };
    for (const k of Object.keys(next) as (keyof SheetProps)[]) if (next[k] === undefined) delete next[k];
    actions.setSheetProps(sheet.id, next);
  };
  const colors: SheetColors = p.colors ?? { scheme: 'default' };
  const setColors = (patch: Partial<SheetColors>) => set({ colors: { ...colors, ...patch } });
  const sizeValid = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 100 && n <= 20000 ? null : t('schematic.prop.between', { lo: 100, hi: 20000 });
  };
  return (
    <>
      <SelectField
        label={t('schematic.sheet.paper')}
        value={p.paper ?? 'legacy'}
        options={[{ value: 'legacy', label: t('schematic.sheet.legacy') }, ...PAPER_SIZES.map((s) => ({ value: s, label: s === 'Custom' ? t('schematic.sheet.custom') : s }))]}
        onChange={(v) => set({ paper: v === 'legacy' ? undefined : (v as PaperSize) })}
      />
      {p.paper && p.paper !== 'Custom' ? (
        <SelectField
          label={t('schematic.sheet.orientation')}
          value={p.orientation ?? 'landscape'}
          options={[
            { value: 'landscape', label: t('schematic.sheet.landscape') },
            { value: 'portrait', label: t('schematic.sheet.portrait') },
          ]}
          onChange={(v) => set({ orientation: v === 'landscape' ? undefined : 'portrait' })}
        />
      ) : null}
      {p.paper === 'Custom' ? (
        <>
          <CommitField label={t('schematic.sheet.width')} value={String(p.width ?? frame.w)} validate={sizeValid} onCommit={(v) => set({ width: Number(v) })} />
          <CommitField label={t('schematic.sheet.height')} value={String(p.height ?? frame.h)} validate={sizeValid} onCommit={(v) => set({ height: Number(v) })} hint={t('schematic.sheet.unitsHint')} />
        </>
      ) : null}
      <p className="ms-hint">{t('schematic.sheet.size', { w: frame.w, h: frame.h, mw: Math.round(frame.w / 4), mh: Math.round(frame.h / 4) })}</p>
      <CheckField label={t('schematic.sheet.border')} checked={frame.border} onChange={(v) => set({ border: v ? undefined : false })} />
      <CheckField label={t('schematic.sheet.titleBlock')} checked={frame.titleBlock} onChange={(v) => set({ titleBlock: v ? undefined : false })} />
      <SelectField
        label={t('schematic.sheet.grid')}
        value={p.grid ?? 'dots'}
        options={[
          { value: 'dots', label: t('schematic.sheet.gridDots') },
          { value: 'lines', label: t('schematic.sheet.gridLines') },
        ]}
        onChange={(v) => set({ grid: v === 'dots' ? undefined : 'lines' })}
      />
      <SelectField
        label={t('schematic.sheet.colors')}
        value={colors.scheme}
        options={SCHEMES.map((s) => ({ value: s, label: t(`schematic.scheme.${s}`) }))}
        onChange={(v) => set({ colors: v === 'default' ? undefined : { ...colors, scheme: v as SheetColors['scheme'] } })}
      />
      {colors.scheme === 'custom' ? (
        <>
          <ColorField label={t('schematic.color.background')} value={colors.background} allowDefault onChange={(c) => setColors({ background: c })} />
          <ColorField label={t('schematic.color.wire')} value={colors.wire} allowDefault onChange={(c) => setColors({ wire: c })} />
          <ColorField label={t('schematic.color.bus')} value={colors.bus} allowDefault onChange={(c) => setColors({ bus: c })} />
          <ColorField label={t('schematic.color.component')} value={colors.component} allowDefault onChange={(c) => setColors({ component: c })} />
          <ColorField label={t('schematic.color.text')} value={colors.text} allowDefault onChange={(c) => setColors({ text: c })} />
        </>
      ) : null}
    </>
  );
}

/** Title-block fields of the design (shared by all sheets). */
export function TitleBlockEditor() {
  const tb = useEditor((s) => s.design.titleBlock);
  const title = useEditor((s) => s.design.title);
  const set = (k: keyof TitleBlockFields, v: string) => {
    const next: TitleBlockFields = { ...(tb ?? {}) };
    if (v.trim()) next[k] = v.trim();
    else delete next[k];
    actions.setTitleBlock(next);
  };
  return (
    <>
      <p className="ms-hint">{t('schematic.tb.hint')}</p>
      {TITLE_BLOCK_FIELDS.map((k) => (
        <CommitField
          key={k}
          label={t(`schematic.tb.${k}`)}
          value={tb?.[k] ?? ''}
          placeholder={k === 'title' ? title : k === 'date' ? t('schematic.tb.dateAuto') : undefined}
          onCommit={(v) => set(k, v)}
        />
      ))}
      {!tb ? (
        <button type="button" className="ms-btn ms-btn-small" title={t('schematic.tb.enableTip')} onClick={() => actions.setTitleBlock({ title })}>
          {t('schematic.tb.enable')}
        </button>
      ) : null}
    </>
  );
}
