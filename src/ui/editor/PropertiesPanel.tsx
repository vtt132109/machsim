/**
 * Properties editors for the current selection (right-hand panel) and the part properties dialog.
 *
 * - Part: Label tab (refdes, label visibility, simulation / BOM exclusion), one tab per ParamDef
 *   group (value / model / waveform / advanced / display) and an Info tab.
 * - Wire: colour, net (buses: name, lines). Net label / connector / bus entry: name, kind, global,
 *   orientation. Probe: name, kind, colour. Text: text, size, font style; comments. Shapes: stroke,
 *   fill, dash, arc angles. Blocks: open, child design name / parameters / port order.
 * - Several items: rotate / flip / delete, align / distribute, group, lock, replace by subcircuit.
 * - Nothing selected: sheet name, design title / description and global variables.
 * Hosts can add file actions (save a block as a file, replace a picture) through
 * {@link setPropertiesHost}.
 * Every committed change is one undo step.
 */
import { partValuesHidden } from '../../model/restrictions';
import { useDeferredValue, useMemo, useState } from 'react';
import type { ParamDef, PartDef } from '../../library/types';
import type { NetLabel, PartFields, PartInstance, Probe, ProbeKind, ProbeReading, Rotation, Shape, TextNote, Wire } from '../../model/types';
import { isBlockPartId } from '../../model/hierarchy';
import { BlockSection, BusProperties, LabelItemProperties, LockedField, NoteStyleFields, SelectionTools, ShapeProperties } from './SchematicProperties';
import { actions, activeSheet, partLookup, useEditor } from '../store';
import { levelSheetsOf } from '../store/editorStore';
import { computeConnectivity } from '../store/connectivity';
import { findItem, transformItems } from '../store/designOps';
import type { SelItem } from '../store/types';
import { CheckField, ColorField, CommitField, SelectField } from '../common/Field';
import { Tabs } from '../common/Tabs';
import { Icon } from '../common/icons';
import { groupParams, isParamModified, paramPreview, paramValue, validateNetName, validateParamText } from './paramFields';
import './editor.css';
import { t, tDynamic } from '../../i18n';
import { familyName, groupName, interactiveLabel, optionLabel, paramHelp, paramLabel, partDescription, partName } from '../../i18n/library';
import { openHelp, topicForPart } from '../help/open';
import { DataFileField, PartFaultTab, PartModelTools, PartSpecList, ValuePicker } from './PartExtras';
import { lazyComponent } from '../common/lazy';
import { asLibraryPart } from '../../library/partkit';

/** The WAV file field and the time-current curve load on demand (they bring the audio texts and codecs). */
const WavField = lazyComponent(() => import('./WavField').then((m) => m.WavField));
const TripCurve = lazyComponent(() => import('./TripCurve').then((m) => m.TripCurve));
const PackagePanel = lazyComponent(() => import('./PackagePanel').then((m) => m.PackagePanel));
import { isFaultable } from '../../model/faults';
import { formatEng, parseUserNumber } from '../../util/units';

/** Optional actions the application provides to the panel (file dialogs live in src/ui/app). */
export interface PropertiesHost {
  saveChildAsFile?(childId: string): void;
  replaceImage?(shapeId: string): void;
  replaceBySubcircuit?(): void;
  replacePart?(partId: string): void;
}

let host: PropertiesHost = {};
export function setPropertiesHost(h: PropertiesHost): void {
  host = h;
}

const ROTATIONS = (): { value: string; label: string }[] =>
  (['0', '90', '180', '270'] as const).map((value) => ({ value, label: t(`rotation.${value}`) }));

const PROBE_KINDS = (): { value: ProbeKind; label: string }[] =>
  (['voltage', 'current', 'power', 'differential', 'digital', 'reference'] as const).map((value) => ({ value, label: value === 'digital' ? t('probe.kindShort.digital') : t(`probe.kind.${value}`) }));

const PROBE_READINGS: ProbeReading[] = ['value', 'pp', 'rms', 'dc', 'freq'];

// ---------------------------------------------------------------------------
// parameter field
// ---------------------------------------------------------------------------

/**
 * "Pick a coil": the coils and overload relays of the design level, to fill the `coil` field of a
 * relay contact without typing a designator (a contact follows the coil it names; the default "K1"
 * silently points at whatever K1 exists).
 */
function CoilPicker({ inst, def }: { inst: PartInstance; def: ParamDef }) {
  const sheets = useEditor((s) => levelSheetsOf(s));
  const drivers = useMemo(
    () => sheets.flatMap((s) => s.parts).filter((p) => asLibraryPart(partLookup(p.partId) ?? ({} as PartDef)).contactLink?.role === 'driver').map((p) => p.refdes),
    [sheets],
  );
  const unique = [...new Set(drivers)];
  if (!unique.length) return null;
  return (
    <select className="ms-select" value="" title={t('editor.properties.pickCoilTip')} aria-label={t('editor.properties.pickCoil')} onChange={(e) => e.target.value && actions.setPartParam(inst.id, def.key, e.target.value)}>
      <option value="">{t('editor.properties.pickCoil')}</option>
      {unique.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

function ParamField({ def, inst }: { def: ParamDef; inst: PartInstance }) {
  const value = paramValue(def, inst.params);
  const modified = isParamModified(def, inst.params);
  const commit = (v: string) => actions.setPartParam(inst.id, def.key, v.trim());
  const reset = modified ? (
    <button type="button" className="ms-icon-btn ms-reset-btn" title={t('editor.properties.resetToDefaultDefault', { default: def.default })} aria-label={t('editor.properties.resetLabelToDefault', { label: paramLabel(def) })} onClick={() => actions.setPartParam(inst.id, def.key, null)}>
      <Icon name="undo" size={12} />
    </button>
  ) : null;
  const label = (
    <span title={paramHelp(def)}>
      {paramLabel(def)}
      {modified ? <span className="ms-modified" aria-label={t('editor.properties.modified')}> •</span> : null}
    </span>
  );
  switch (def.kind) {
    case 'bool':
      return (
        <div className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{label}</span>
          <div className="ms-cfield-control">
            <CheckField label={value === 'true' ? t('common.yes') : t('common.no')} checked={value === 'true'} onChange={(v) => actions.setPartParam(inst.id, def.key, v ? 'true' : 'false')} />
            {reset}
          </div>
        </div>
      );
    case 'select':
      return <SelectField label={label} value={value} options={(def.options ?? []).map((o) => ({ value: o.value, label: optionLabel(o.label) }))} onChange={(v) => actions.setPartParam(inst.id, def.key, v)} trailing={reset} />;
    case 'number':
      return (
        <CommitField
          label={label}
          value={value}
          unit={def.unit}
          validate={(v) => validateParamText(def, v)}
          onCommit={commit}
          hint={(draft) => {
            const p = paramPreview(def, draft);
            return [p ? `= ${p}` : '', paramHelp(def) ?? ''].filter(Boolean).join(' · ') || null;
          }}
          trailing={
            def.picker ? (
              <>
                <ValuePicker def={def} inst={inst} />
                {reset}
              </>
            ) : (
              reset
            )
          }
        />
      );
    case 'text':
      if (def.binaryImport === 'wav') return <WavField def={def} inst={inst} label={label} trailing={reset} />;
      if (def.fileImport) return <DataFileField def={def} inst={inst} label={label} trailing={reset} />;
      if (isCoilParam(inst, def)) {
        return <CommitField label={label} value={value} unit={def.unit} onCommit={commit} hint={paramHelp(def)} trailing={<><CoilPicker inst={inst} def={def} />{reset}</>} />;
      }
      return <CommitField label={label} value={value} unit={def.unit} onCommit={commit} hint={paramHelp(def)} trailing={reset} />;
  }
}

/** True for the `coil` field of a relay contact (LibraryPartDef.contactLink). */
function isCoilParam(inst: PartInstance, def: ParamDef): boolean {
  const d = partLookup(inst.partId);
  const link = d ? asLibraryPart(d).contactLink : undefined;
  return link?.role === 'contact' && link.param === def.key;
}

/**
 * Range slider of a slider-type interactive part whose bounds come from instance parameters
 * (InteractiveDef.minParam / maxParam / stepParam, e.g. the interactive DC sources). Moving it
 * changes the value like the part's key does: not an undo step, applied live to a running
 * interactive simulation.
 */
function InteractiveSlider({ inst, def }: { inst: PartInstance; def: PartDef }) {
  const idef = def.interactive;
  if (!idef || idef.kind !== 'slider' || !idef.minParam || !idef.maxParam) return null;
  const num = (key: string | undefined): number => {
    if (!key) return Number.NaN;
    const pd = def.params.find((p) => p.key === key);
    return parseUserNumber(inst.params[key] ?? pd?.default ?? '');
  };
  let lo = num(idef.minParam);
  let hi = num(idef.maxParam);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return null;
  if (hi < lo) [lo, hi] = [hi, lo];
  const stepRaw = num(idef.stepParam);
  const step = Number.isFinite(stepRaw) && stepRaw > 0 ? stepRaw : (hi - lo) / 100;
  const value = Math.min(hi, Math.max(lo, num(idef.param)));
  const pdef = def.params.find((p) => p.key === idef.param);
  return (
    <label className="ms-cfield" title={t('editor.properties.sliderTip')}>
      <span className="ms-cfield-label">
        {interactiveLabel(idef.label)} — {formatEng(Number.isFinite(value) ? value : lo, pdef?.unit ?? '')}
      </span>
      <input
        type="range"
        min={lo}
        max={hi}
        step={step}
        value={Number.isFinite(value) ? value : lo}
        aria-label={t('editor.properties.sliderAria', { label: interactiveLabel(idef.label) })}
        onChange={(e) => actions.setInteractiveParam(inst.refdes, idef.param, String(Math.round(Number(e.target.value) * 1e9) / 1e9))}
      />
    </label>
  );
}

/** "Fitted in variant …" of a placed part, one box per design variant (Tools › Variant manager). */
function VariantFields({ inst }: { inst: PartInstance }) {
  const variants = useEditor((s) => s.design.variants?.list);
  if (!variants?.length) return null;
  return (
    <>
      {variants.map((v) => {
        const own = variantValuesOf(inst, v.id);
        const text = own ? [...Object.entries(own.params ?? {}).map(([k, x]) => `${k} = ${x}`), ...Object.entries(own.fields ?? {}).map(([k, x]) => `${k} = ${x}`)].join(', ') : '';
        return (
          <div key={v.id}>
            <CheckField label={t('variant.toggleFitted', { variant: v.name })} checked={isFitted(inst, v.id)} onChange={(on) => actions.applyDesign((d) => setFitted(d, [inst.id], v.id, on, partLookup))} />
            {text ? <div className="ms-hint">{t('variant.ownValues', { variant: v.name, values: text })}</div> : null}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// part
// ---------------------------------------------------------------------------

/**
 * Give a part an absolute orientation as one undo step, using the same transforms as the rotate /
 * flip commands so attached wires follow the pins.
 */
export function setOrientation(partId: string, rotation: Rotation, mirror: boolean): void {
  actions.applyDesign((d) => {
    const f = findItem(d, 'part', partId);
    if (!f) return d;
    const sel = [{ kind: 'part' as const, id: partId }];
    let next = d;
    const current = () => findItem(next, 'part', partId)?.item as PartInstance;
    if (current().mirror !== mirror) next = transformItems(next, f.sheetId, sel, 'flipH', partLookup);
    for (let i = 0; i < 4 && current().rotation !== rotation; i++) next = transformItems(next, f.sheetId, sel, 'cw', partLookup);
    return next;
  });
}

function PartLabelTab({ inst, def }: { inst: PartInstance; def: PartDef | undefined }) {
  const [refError, setRefError] = useState<string | null>(null);
  return (
    <div className="ms-prop-section">
      <CommitField
        label={t('editor.properties.refdes')}
        value={inst.refdes}
        onCommit={(v) => setRefError(actions.setRefdes(inst.id, v))}
        validate={(v) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v.trim()) ? null : t('editor.properties.lettersDigitsAndStartWith'))}
        hint={refError ?? undefined}
      />
      <CheckField label={t('editor.properties.showReferenceDesignator')} checked={!inst.hideRef} onChange={(v) => actions.updatePart(inst.id, { hideRef: v ? undefined : true })} />
      <CheckField label={t('editor.properties.showValue')} checked={!inst.hideValue} onChange={(v) => actions.updatePart(inst.id, { hideValue: v ? undefined : true })} />
      {inst.refOffset || inst.valueOffset ? (
        <button
          type="button"
          className="ms-btn ms-btn-small"
          onClick={() => actions.updatePart(inst.id, { refOffset: undefined, valueOffset: undefined })}
        >
          {t('editor.properties.resetLabelPositions')}
        </button>
      ) : null}
      <div className="ms-prop-sep" />
      <CheckField label={t('editor.properties.excludeFromSimulation')} checked={!!inst.excludeFromSim} onChange={(v) => actions.updatePart(inst.id, { excludeFromSim: v ? true : undefined })} />
      <CheckField label={t('editor.properties.excludeFromBillOfMaterials')} checked={!!inst.excludeFromBom} onChange={(v) => actions.updatePart(inst.id, { excludeFromBom: v ? true : undefined })} />
      <VariantFields inst={inst} />
      <div className="ms-prop-sep" />
      <SelectField
        label={t('editor.properties.rotation')}
        value={String(inst.rotation)}
        options={ROTATIONS()}
        onChange={(v) => setOrientation(inst.id, Number(v) as Rotation, inst.mirror)}
      />
      <CheckField label={t('editor.properties.mirrored')} checked={inst.mirror} onChange={(v) => setOrientation(inst.id, inst.rotation, v)} />
      <LockedField item={{ kind: 'part', id: inst.id }} locked={inst.locked} />
      {host.replacePart && !isBlockPartId(inst.partId) && def?.globalNet === undefined ? (
        <button type="button" className="ms-btn ms-btn-small" title={t('schematic.prop.replacePartTip')} onClick={() => host.replacePart?.(inst.id)}>
          {t('cmd.edit.replaceComponent')}
        </button>
      ) : null}
      {isBlockPartId(inst.partId) ? <BlockSection inst={inst} onSaveAsFile={host.saveChildAsFile ? (id) => host.saveChildAsFile?.(id) : undefined} /> : null}
      {!def ? <p className="ms-field-error">{t('editor.properties.partPartidIsNotIn', { partId: inst.partId })}</p> : null}
    </div>
  );
}

function PartInfoTab({ inst, def }: { inst: PartInstance; def: PartDef | undefined }) {
  if (!def) return <p className="ms-empty">{t('editor.properties.unknownPartPartid', { partId: inst.partId })}</p>;
  return (
    <div className="ms-prop-section">
      <dl className="ms-info">
        <dt>{t('common.part')}</dt>
        <dd>{partName(def)}</dd>
        <dt>{t('editor.properties.family')}</dt>
        <dd>
          {groupName(def.group)} › {familyName(def.family)}
        </dd>
        <dt>{t('common.description')}</dt>
        <dd>
          {partDescription(def)}{' '}
          <button type="button" className="ms-link-btn" onClick={() => openHelp(topicForPart(def))}>
            {t('help.whatIsThis')}
          </button>
        </dd>
        <PartSpecList def={def} />
        <dt>{t('editor.properties.libraryId')}</dt>
        <dd className="ms-mono">{def.id}</dd>
        {def.footprint ? (
          <>
            <dt>{t('editor.properties.footprint')}</dt>
            <dd className="ms-mono">{def.footprint}</dd>
          </>
        ) : null}
        {def.provenance ? (
          <>
            <dt>{t('editor.properties.modelSource')}</dt>
            <dd>{def.provenance}</dd>
          </>
        ) : null}
        {def.interactive ? (
          <>
            <dt>{t('editor.properties.interactive')}</dt>
            <dd>
              {interactiveLabel(def.interactive.label)}
              {def.interactive.key ? (
                <>
                  {' '}
                  — {t('editor.properties.keyWord')} <kbd className="ms-kbd">{def.interactive.key}</kbd>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        <dt>{t('editor.properties.pins')}</dt>
        <dd>{def.symbol.pins.map((p) => `${p.name}${p.label ? ` (${p.label})` : ''}`).join(', ') || '—'}</dd>
      </dl>
      <PartModelTools inst={inst} def={def} />
    </div>
  );
}

/** Full part editor (used by the panel and the properties dialog). */
export function PartProperties({ partId }: { partId: string }) {
  const inst = useEditor((s) => {
    const f = findItem(s.design, 'part', partId);
    return f ? (f.item as PartInstance) : null;
  });
  const def = inst ? partLookup(inst.partId) : undefined;
  // the instructor may hide component values (instruments keep their settings)
  const hidden = useEditor((s) => partValuesHidden(s.design, def));
  const tabs = useMemo(() => (hidden ? [] : groupParams(def?.params ?? [])), [def, hidden]);
  const [tab, setTab] = useState<string>('value');
  if (!inst) return <p className="ms-empty">{t('editor.properties.thePartNoLongerExists')}</p>;
  const items = [
    { id: 'label', title: t('editor.properties.label') },
    ...tabs.map((t) => ({ id: t.group, title: t.label })),
    ...(isFaultable(def) ? [{ id: 'fault', title: t('editor.properties.fault') }] : []),
    ...(def && !def.instrument && def.globalNet === undefined ? [{ id: 'bom', title: t('learn.fields.tab') }] : []),
    // a section of a multi-section chip (7474A, TL072B …): which sections are taken, move / switch
    ...(def && asLibraryPart(def).pkg ? [{ id: 'package', title: t('editor.properties.package') }] : []),
    { id: 'info', title: t('editor.properties.info') },
  ];
  const active = items.some((t) => t.id === tab) ? tab : tabs.length ? tabs[0].group : 'label';
  const current = tabs.find((t) => t.group === active);
  return (
    <div className="ms-part-props">
      <div className="ms-prop-head">
        <strong>{inst.refdes}</strong>
        <span>{def ? partName(def) : inst.partId}</span>
      </div>
      <Tabs items={items} active={active} onSelect={setTab} ariaLabel={t('editor.properties.propertyGroups')} idPrefix={`pp-${inst.id}`} size="small" />
      <div role="tabpanel" id={`pp-${inst.id}-panel-${active}`} aria-labelledby={`pp-${inst.id}-${active}`} className="ms-prop-tabpanel">
        {hidden ? <p className="ms-hint">{t('learn.restricted.values')}</p> : null}
        {active === 'label' ? <PartLabelTab inst={inst} def={def} /> : null}
        {active === 'info' ? <PartInfoTab inst={inst} def={def} /> : null}
        {active === 'fault' ? <PartFaultTab inst={inst} def={def} /> : null}
        {active === 'bom' ? <PartFieldsTab inst={inst} def={def} /> : null}
        {active === 'package' && def ? <PackagePanel def={def} inst={inst} /> : null}
        {current ? (
          <div className="ms-prop-section">
            {current.params.map((p) => (
              <ParamField key={p.key} def={p} inst={inst} />
            ))}
            {def && current.params.some((p) => p.key === def.interactive?.param) ? <InteractiveSlider inst={inst} def={def} /> : null}
            {def && active === 'value' && asLibraryPart(def).tripCurve ? <TripCurve def={def} inst={inst} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** BOM / PCB fields of a placed part: manufacturer, part number, supplier, footprint override. */
function PartFieldsTab({ inst, def }: { inst: PartInstance; def: PartDef | undefined }) {
  const set = (key: keyof PartFields, v: string) => {
    const next: PartFields = { ...(inst.fields ?? {}) };
    if (v.trim()) next[key] = v.trim();
    else delete next[key];
    actions.updatePart(inst.id, { fields: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="ms-prop-section">
      <p className="ms-hint">{t('learn.fields.hint')}</p>
      <CommitField label={<span title={t('learn.fields.manufacturerTip')}>{t('learn.fields.manufacturer')}</span>} value={inst.fields?.manufacturer ?? ''} onCommit={(v) => set('manufacturer', v)} />
      <CommitField label={<span title={t('learn.fields.partNumberTip')}>{t('learn.fields.partNumber')}</span>} value={inst.fields?.partNumber ?? ''} onCommit={(v) => set('partNumber', v)} />
      <CommitField label={<span title={t('learn.fields.supplierTip')}>{t('learn.fields.supplier')}</span>} value={inst.fields?.supplier ?? ''} onCommit={(v) => set('supplier', v)} />
      <CommitField
        label={<span title={t('learn.fields.footprintTip')}>{t('learn.fields.footprint')}</span>}
        value={inst.fields?.footprint ?? ''}
        placeholder={def?.footprint ?? ''}
        onCommit={(v) => set('footprint', v)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// other items
// ---------------------------------------------------------------------------

function WireProperties({ wire }: { wire: Wire }) {
  if (wire.bus) return <BusProperties wire={wire} />;
  return <NetWireProperties wire={wire} />;
}

function NetWireProperties({ wire }: { wire: Wire }) {
  const design = useEditor((s) => s.design);
  const deferred = useDeferredValue(design);
  const net = useMemo(() => {
    const c = computeConnectivity(deferred, partLookup);
    const i = c.wireNet.get(wire.id);
    return i === undefined ? null : c.nets[i];
  }, [deferred, wire.id]);
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t('editor.properties.wire')}</strong>
        <span>{t('editor.properties.valueSegmentS', { value: wire.points.length - 1 })}</span>
      </div>
      <ColorField label={t('common.colour')} value={wire.color} allowDefault onChange={(c) => actions.updateWire(wire.id, { color: c })} />
      <LockedField item={{ kind: 'wire', id: wire.id }} locked={wire.locked} />
      {net ? (
        <dl className="ms-info">
          <dt>{t('common.net')}</dt>
          <dd className="ms-mono">{net.name}</dd>
          <dt>{t('editor.properties.connections')}</dt>
          <dd>{net.pins.map((p) => `${p.refdes}.${p.pin}`).join(', ') || '—'}</dd>
        </dl>
      ) : null}
    </div>
  );
}

function LabelProperties({ label }: { label: NetLabel }) {
  if (label.kind && label.kind !== 'label') return <LabelItemProperties label={label} />;
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t('editor.properties.netLabel')}</strong>
      </div>
      <CommitField label={t('common.netName')} value={label.name} validate={validateNetName} onCommit={(v) => actions.updateLabel(label.id, { name: v.trim() })} hint={t('editor.properties.labelsWithTheSameName')} />
      <CheckField label={t('schematic.prop.global')} checked={!!label.global} onChange={(v) => actions.updateLabel(label.id, { global: v ? true : undefined })} />
      <SelectField
        label={t('schematic.prop.kind')}
        value="label"
        options={(['label', 'offpage', 'hier', 'global', 'bus-entry'] as const).map((k) => ({ value: k, label: t(`schematic.kind.${k === 'bus-entry' ? 'busEntry' : k}`) }))}
        onChange={(v) => actions.updateLabel(label.id, { kind: v === 'label' ? undefined : (v as NetLabel['kind']), global: undefined })}
      />
      <SelectField label={t('editor.properties.orientation')} value={String(label.rotation)} options={ROTATIONS()} onChange={(v) => actions.updateLabel(label.id, { rotation: Number(v) as Rotation })} />
      <LockedField item={{ kind: 'label', id: label.id }} locked={label.locked} />
    </div>
  );
}

function ProbeProperties({ probe }: { probe: Probe }) {
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t('editor.properties.probe')}</strong>
        <span>{probe.name}</span>
      </div>
      <CommitField label={t('common.name')} value={probe.name} validate={(v) => (v.trim() ? null : t('editor.properties.enterAName'))} onCommit={(v) => actions.updateProbe(probe.id, { name: v.trim() })} />
      <SelectField
        label={t('editor.properties.kind')}
        value={probe.kind}
        options={PROBE_KINDS()}
        onChange={(v) => {
          const kind = v as ProbeKind;
          actions.updateProbe(probe.id, kind === 'differential' ? { kind, ref: probe.ref ?? { x: probe.x + 40, y: probe.y } } : { kind, ref: undefined });
        }}
      />
      <ColorField label={t('common.colour')} value={probe.color} onChange={(c) => c && actions.updateProbe(probe.id, { color: c })} />
      {probe.kind === 'differential' && probe.ref ? <p className="ms-hint">{t('editor.properties.referencePointXY', { x: probe.ref.x, y: probe.ref.y })}</p> : null}
      {probe.kind === 'reference' ? <p className="ms-hint">{t('probe.settings.referenceHelp')}</p> : null}
      {probe.kind === 'voltage' || probe.kind === 'digital' ? <ReferenceProbeField probe={probe} /> : null}
      {probe.kind !== 'digital' && probe.kind !== 'reference' ? <ProbeReadingsField probe={probe} /> : null}
    </div>
  );
}

/** Reference probe choice: ground, or a reference probe of the same design level. */
function ReferenceProbeField({ probe }: { probe: Probe }) {
  const sheets = useEditor(levelSheetsOf);
  const refs = sheets.flatMap((sh) => sh.probes.filter((p) => p.kind === 'reference' && p.id !== probe.id));
  return (
    <SelectField
      label={<span title={t('tip.probe.reference')}>{t('probe.settings.reference')}</span>}
      value={probe.refProbe ?? ''}
      options={[{ value: '', label: t('probe.settings.ground') }, ...refs.map((r) => ({ value: r.id, label: r.name || r.id }))]}
      onChange={(v) => actions.updateProbe(probe.id, { refProbe: v || undefined })}
    />
  );
}

/** Which readings the probe flag shows (absent = value, plus p-p / RMS when the signal varies). */
function ProbeReadingsField({ probe }: { probe: Probe }) {
  const shown = probe.show ?? ['value'];
  const toggle = (r: ProbeReading) => {
    const next = shown.includes(r) ? shown.filter((x) => x !== r) : PROBE_READINGS.filter((x) => x === r || shown.includes(x));
    actions.updateProbe(probe.id, { show: next.length ? next : undefined });
  };
  return (
    <fieldset className="ms-prop-readings">
      <legend>{t('probe.settings.readings')}</legend>
      {PROBE_READINGS.map((r) => (
        <label key={r} title={tDynamic(`tip.probe.reading.${r}`)}>
          <input type="checkbox" title={tDynamic(`tip.probe.reading.${r}`)} checked={probe.show ? shown.includes(r) : r === 'value'} onChange={() => toggle(r)} /> {tDynamic(`probe.reading.${r}`)}
        </label>
      ))}
      {probe.show ? (
        <button type="button" className="ms-btn ms-btn-small" title={t('tip.probe.readingsAuto')} onClick={() => actions.updateProbe(probe.id, { show: undefined })}>
          {t('probe.settings.readingsAuto')}
        </button>
      ) : (
        <span className="ms-hint">{t('probe.settings.readingsAutoHint')}</span>
      )}
    </fieldset>
  );
}

function NoteProperties({ note }: { note: TextNote }) {
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t('editor.properties.text')}</strong>
      </div>
      <CommitField label={t('editor.properties.text')} layout="stack" multiline value={note.text} validate={(v) => (v.trim() ? null : t('editor.properties.textCannotBeEmpty'))} onCommit={(v) => actions.updateNote(note.id, { text: v })} hint={t('editor.properties.ctrlEnterApplies')} />
      <CommitField
        label={t('editor.properties.fontSize')}
        value={String(note.size ?? 12)}
        unit="pt"
        validate={(v) => {
          const n = Number(v);
          return Number.isFinite(n) && n >= 6 && n <= 72 ? null : t('editor.properties.between6And72');
        }}
        onCommit={(v) => actions.updateNote(note.id, { size: Number(v) === 12 ? undefined : Number(v) })}
      />
      <NoteStyleFields note={note} />
    </div>
  );
}

/** Editor for one non-part item. */
export function ItemProperties({ item }: { item: SelItem }) {
  const found = useEditor((s) => findItem(s.design, item.kind, item.id)?.item ?? null);
  if (!found) return <p className="ms-empty">{t('editor.properties.theItemNoLongerExists')}</p>;
  switch (item.kind) {
    case 'part':
      return <PartProperties partId={item.id} />;
    case 'wire':
      return <WireProperties wire={found as Wire} />;
    case 'label':
      return <LabelProperties label={found as NetLabel} />;
    case 'probe':
      return <ProbeProperties probe={found as Probe} />;
    case 'note':
      return <NoteProperties note={found as TextNote} />;
    case 'shape':
      return <ShapeProperties shape={found as Shape} onReplaceImage={host.replaceImage ? () => host.replaceImage?.(item.id) : undefined} />;
  }
}

// ---------------------------------------------------------------------------
// sheet / design
// ---------------------------------------------------------------------------

import { parseVariablesText, variablesToText } from './variablesText';
import { isFitted, setFitted, variantValuesOf } from '../../model/variants';
export { parseVariablesText, variablesToText };

export function SheetAndDesignProperties() {
  const sheet = useEditor(activeSheet);
  const design = useEditor((s) => s.design);
  return (
    <div className="ms-prop-section">
      <div className="ms-prop-head">
        <strong>{t('common.sheet')}</strong>
      </div>
      <CommitField label={t('editor.properties.sheetName')} value={sheet.name} validate={(v) => (v.trim() ? null : t('editor.properties.enterAName'))} onCommit={(v) => actions.renameSheet(sheet.id, v)} />
      <p className="ms-hint">
        {t('editor.properties.lengthPartsLength2WiresLength3', { length: sheet.parts.length, length2: sheet.wires.length, length3: sheet.labels.length, length4: sheet.probes.length })}
      </p>
      <div className="ms-prop-sep" />
      <div className="ms-prop-head">
        <strong>{t('editor.properties.design')}</strong>
      </div>
      <CommitField label={t('editor.properties.title')} value={design.title} validate={(v) => (v.trim() ? null : t('editor.properties.enterATitle'))} onCommit={(v) => actions.setDesignInfo({ title: v.trim() })} />
      <CommitField label={t('common.description')} layout="stack" multiline rows={3} value={design.description ?? ''} onCommit={(v) => actions.setDesignInfo({ description: v })} />
      <CommitField
        label={t('editor.properties.globalParameters')}
        layout="stack"
        multiline
        rows={3}
        placeholder={t('editor.properties.rload1kGain10')}
        value={variablesToText(design.variables)}
        validate={(v) => parseVariablesText(v).error}
        onCommit={(v) => actions.setDesignInfo({ variables: parseVariablesText(v).vars })}
        hint={t('editor.properties.oneNameValuePerLine')}
      />
    </div>
  );
}

/** Right-hand properties panel. */
export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  let body;
  if (selection.length === 0) body = <SheetAndDesignProperties />;
  else if (selection.length === 1) body = <ItemProperties key={`${selection[0].kind}:${selection[0].id}`} item={selection[0]} />;
  else {
    const counts = new Map<string, number>();
    for (const it of selection) counts.set(it.kind, (counts.get(it.kind) ?? 0) + 1);
    body = (
      <div className="ms-prop-section">
        <div className="ms-prop-head">
          <strong>{t('editor.properties.lengthItemsSelected', { length: selection.length })}</strong>
        </div>
        <p className="ms-hint">{Array.from(counts.entries()).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ')}</p>
        <div className="ms-btn-row">
          <button type="button" className="ms-btn ms-btn-small" onClick={() => actions.rotateSelection('cw')}>
            {t('editor.properties.rotate')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => actions.flipSelection('h')}>
            {t('editor.properties.flipH')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => actions.flipSelection('v')}>
            {t('editor.properties.flipV')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" onClick={() => actions.deleteSelection()}>
            {t('common.delete')}
          </button>
        </div>
        <SelectionTools count={selection.length} onReplaceBySubcircuit={host.replaceBySubcircuit && selection.some((x) => x.kind === 'part') ? () => host.replaceBySubcircuit?.() : undefined} />
      </div>
    );
  }
  return (
    <aside className="ms-props" aria-label={t('common.properties')}>
      <div className="ms-panel-title">{t('common.properties')}</div>
      <div className="ms-props-body">{body}</div>
    </aside>
  );
}
