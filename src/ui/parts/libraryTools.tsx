/**
 * Library tools of the Tools menu (loaded on first use):
 *
 * - Update components from library (`openUpdateComponentsDialog`): lists the placed parts whose
 *   library definition changed (src/ui/store/libraryUpdate.ts compareWithLibrary) with what changed,
 *   and updates the ticked ones in one undo step (wires follow moved pins).
 * - Variant manager (`openVariantManager`): named variants of the design and a fitted / not-fitted
 *   grid of the placed parts (src/model/variants.ts); the active variant drives the simulation, the
 *   BOM and the reports. Every change is an undo step.
 * - My library (`exportLibraryProfileFlow`, `importLibraryProfileFlow`, `importProfileText`,
 *   `currentProfileText`): favourites, recent parts and the user (optionally corporate) database
 *   in one .msimlib file (src/library/custom/profile.ts), also kept in a project.
 */
import { useMemo, useState } from 'react';
import type { MergePolicy } from '../../library/custom/database';
import { buildProfile, mergeProfile, parseProfile, serializeProfile, PROFILE_EXTENSION, type LibraryProfile } from '../../library/custom/profile';
import { partValue } from '../../model/bom';
import { SAVED_BY } from '../../model/appInfo';
import { activeVariant, addVariant, clearVariantValues, isFitted, notFittedCount, removeVariant, renameVariant, variantNameTaken, setActiveVariant, setFitted, setVariantDescription, setVariantField, setVariantParam, setVariantVariable, variantChanges } from '../../model/variants';
import type { Design, PartFields, PartInstance } from '../../model/types';
import type { ParamDef, PartDef } from '../../library/types';
import { defaultParams } from '../../library';
import { optionLabel, paramLabel } from '../../i18n/library';
import { valuesHidden, HIDDEN_VALUE } from '../../model/restrictions';
import { Dialog } from '../common/Dialog';
import { alertDialog, confirmDialog, openCustomDialog } from '../common/dialogs';
import { actions, partLookup, useEditor } from '../store';
import { compareWithLibrary, updateFromLibrary, type LibraryChange, type LibraryDiff } from '../store/libraryUpdate';
import { getLibraryPrefs, replaceLibraryPrefs } from '../editor/libraryPrefs';
import { openHelp } from '../help/open';
import { localeTag, t } from '../../i18n';
import { partName } from '../../i18n/library';
import { pt, ptDynamic } from '../../i18n/placeText';
import { downloadText, pickTextFile } from './fileIo';
import { commitDatabase, findUserPart, getDatabase, usePartDatabases } from './partDatabases';
import './place.css';

const dbLookup = (id: string) => findUserPart(id)?.part;

function HelpButton({ page }: { page: 'updateComponents' | 'variants' | 'myLibrary' }) {
  return (
    <button type="button" className="ms-btn" title={t('help.whatIsThis')} aria-label={t('help.whatIsThis')} onClick={() => void openHelp({ kind: 'guide', page })}>
      ?
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Update components from library

/** One change in the learner's words. */
export function changeText(c: LibraryChange): string {
  const empty = pt('emptyValue');
  switch (c.kind) {
    case 'optionInvalid':
      return pt('chg_optionInvalid', { key: c.key, value: c.value, refdes: c.refdes.join(', ') });
    case 'defaultChanged':
      return pt('chg_defaultChanged', { key: c.key, from: c.from || empty, to: c.to || empty });
    case 'footprintChanged':
    case 'nameChanged':
      return ptDynamic(`chg_${c.kind}`, c.kind, { from: c.from || empty, to: c.to || empty });
    case 'pinMoved':
    case 'pinAdded':
    case 'pinRemoved':
      return ptDynamic(`chg_${c.kind}`, c.kind, { pin: c.pin });
    case 'paramAdded':
    case 'paramRemoved':
      return ptDynamic(`chg_${c.kind}`, c.kind, { key: c.key });
    default:
      return ptDynamic(`chg_${c.kind}`, c.kind);
  }
}

export function openUpdateComponentsDialog(): void {
  openCustomDialog((close) => <UpdateDialog close={close} />);
}

function UpdateDialog({ close }: { close: () => void }) {
  const design = useEditor((s) => s.design);
  const diffs = useMemo(() => compareWithLibrary(design, partLookup, dbLookup), [design]);
  const updatable = diffs.filter((d) => d.status === 'changed');
  const [picked, setPicked] = useState<Set<string>>(() => new Set(updatable.map((d) => d.partId)));
  const chosen = updatable.filter((d) => picked.has(d.partId));
  const apply = () => {
    let res = { parts: 0, instances: 0 };
    actions.applyDesign((d) => {
      const r = updateFromLibrary(d, chosen.map((x) => x.partId), partLookup, dbLookup);
      res = r;
      return r.design;
    });
    close();
    if (res.parts) actions.addSimMessage('info', pt('updDone', { parts: res.parts, n: res.instances }), 'library');
  };
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <Dialog
      title={pt('updTitle')}
      onClose={close}
      width="min(720px, 96vw)"
      footer={
        <>
          <HelpButton page="updateComponents" />
          {updatable.length ? (
            <>
              <button type="button" className="ms-btn" onClick={() => setPicked(new Set(updatable.map((d) => d.partId)))}>
                {pt('updAll')}
              </button>
              <button type="button" className="ms-btn" onClick={() => setPicked(new Set())}>
                {pt('updNoneSel')}
              </button>
            </>
          ) : null}
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
          {updatable.length ? (
            <button type="button" className="ms-btn ms-btn-primary" disabled={!chosen.length} onClick={apply}>
              {pt('updApply', { n: chosen.length })}
            </button>
          ) : null}
        </>
      }
    >
      <p className="ms-hint">{pt('updIntro')}</p>
      {diffs.length === 0 ? (
        <p role="status">{pt('updNone')}</p>
      ) : (
        <div className="ms-update-list" role="list">
          {diffs.map((d) => (
            <DiffItem key={d.partId} diff={d} checked={picked.has(d.partId)} onToggle={(on) => toggle(d.partId, on)} />
          ))}
        </div>
      )}
    </Dialog>
  );
}

function DiffItem({ diff, checked, onToggle }: { diff: LibraryDiff; checked: boolean; onToggle: (on: boolean) => void }) {
  const refs = diff.instances.map((i) => i.path);
  const shown = refs.length > 12 ? `${refs.slice(0, 12).join(', ')} …` : refs.join(', ');
  return (
    <div role="listitem" className={`ms-update-item${diff.status === 'missing' ? ' is-missing' : ''}`}>
      <label>
        {diff.status === 'changed' ? <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} /> : <span aria-hidden="true">⚠</span>}
        <span>
          {diff.status === 'missing' ? diff.partId : partName(partLookup(diff.partId) ?? { id: diff.partId, name: diff.name })} <span className="ms-update-refs">({diff.kind === 'custom' ? pt('updCustom') : pt('updBuiltin')}) · {pt('updPlaced', { n: refs.length, refs: shown })}</span>
        </span>
      </label>
      <ul>
        {diff.status === 'missing' ? <li>{pt('updMissing')}</li> : diff.changes.map((c, i) => <li key={i}>{changeText(c)}</li>)}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Variant manager

interface PartRow {
  inst: PartInstance;
  path: string;
  name: string;
  value: string;
  def: PartDef | undefined;
}

/** The parameter the grid edits directly: the one the symbol shows as the part's value. */
function primaryParam(def: PartDef | undefined): ParamDef | undefined {
  // an instrument has no value to vary (its "value" is a measuring mode)
  if (def?.instrument) return undefined;
  return def?.params.find((p) => p.showOnSchematic && p.kind !== 'bool');
}

const FIELD_KEYS: (keyof PartFields)[] = ['manufacturer', 'partNumber', 'supplier', 'footprint'];

/** One value box: empty = the part keeps its saved value in this variant (the saved value is the hint). */
function VariantValueInput({ def, saved, own, label, onChange }: { def?: ParamDef; saved: string; own: string | undefined; label: string; onChange: (value: string | undefined) => void }) {
  if (def?.kind === 'select' || def?.kind === 'bool') {
    const options = def.kind === 'bool' ? [{ value: 'true', label: t('common.yes') }, { value: 'false', label: t('common.no') }] : (def.options ?? []).map((o) => ({ value: o.value, label: optionLabel(o.label) }));
    return (
      <select className="ms-input" value={own ?? ''} aria-label={label} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">{pt('varSameAsSaved')}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return <input key={own ?? ''} className={`ms-input${own !== undefined ? ' ms-variant-own' : ''}`} defaultValue={own ?? ''} placeholder={saved} aria-label={label} onBlur={(e) => (e.target.value.trim() === (own ?? '') ? undefined : onChange(e.target.value))} onKeyDown={(e) => (e.key === 'Enter' ? e.currentTarget.blur() : undefined)} />;
}

function variantRows(design: Design): PartRow[] {
  const hidden = valuesHidden(design);
  const rows: PartRow[] = [];
  const add = (sheets: Design['sheets'], prefix: string) => {
    for (const s of sheets) {
      for (const inst of s.parts) {
        const def = partLookup(inst.partId);
        if (def?.globalNet !== undefined) continue;
        const value = def ? partValue(def, { ...defaultParams(def), ...inst.params }) : '';
        rows.push({ inst, path: `${prefix}${inst.refdes}`, name: def ? partName(def) : inst.partId, value: hidden && value ? HIDDEN_VALUE : value, def });
      }
    }
  };
  add(design.sheets, '');
  for (const c of design.children ?? []) add(c.sheets, `${c.name}/`);
  return rows.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export function openVariantManager(): void {
  openCustomDialog((close) => <VariantDialog close={close} />);
}

function VariantDialog({ close }: { close: () => void }) {
  const design = useEditor((s) => s.design);
  const [filter, setFilter] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const variants = design.variants?.list ?? [];
  const active = activeVariant(design);
  const rows = useMemo(() => variantRows(design), [design]);
  const q = filter.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.path.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)) : rows;
  const apply = (fn: (d: Design) => Design) => actions.applyDesign(fn);
  const [nameNote, setNameNote] = useState('');
  /** a refused rename (empty or taken) puts the old name back in the box and says why */
  const rename = (id: string, input: HTMLInputElement) => {
    const old = design.variants?.list.find((x) => x.id === id)?.name ?? '';
    const wanted = input.value.trim();
    if (wanted === old) {
      input.value = old;
      return;
    }
    if (!wanted || variantNameTaken(design, wanted, id)) {
      input.value = old;
      setNameNote(pt('varNameRefused', { name: wanted, old }));
      return;
    }
    setNameNote('');
    apply((d) => renameVariant(d, id, wanted));
  };
  const addNew = () => {
    const name = variants.length ? pt('varNewName', { n: variants.length + 1 }) : pt('varFirstName');
    apply((d) => addVariant(d, name, activeVariant(d)?.id).design);
  };
  const remove = async (id: string, name: string) => {
    if (await confirmDialog({ title: pt('varDelete'), message: pt('varDeleteConfirm', { name }), okLabel: t('common.delete'), danger: true })) apply((d) => removeVariant(d, id));
  };
  return (
    <Dialog
      title={pt('varTitle')}
      onClose={close}
      width="min(900px, 97vw)"
      footer={
        <>
          <HelpButton page="variants" />
          <span className="ms-hint">{pt('varLive')}</span>
          <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{pt('varIntro')}</p>
      {nameNote ? (
        <p className="ms-hint" role="alert">
          {nameNote}
        </p>
      ) : null}
      {variants.length === 0 ? (
        <div className="ms-variant-top">
          <span>{pt('varNone')}</span>
          <button type="button" className="ms-btn ms-btn-primary" onClick={addNew}>
            {pt('varStart')}
          </button>
        </div>
      ) : (
        <>
          <table className="ms-table" aria-label={pt('varTitle')}>
            <thead>
              <tr>
                <th>{pt('varActive')}</th>
                <th>{pt('varName')}</th>
                <th>{pt('varDescription')}</th>
                <th />
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.id}>
                  <td>
                    <input type="radio" name="ms-active-variant" checked={active?.id === v.id} title={pt('tipVarActive')} aria-label={pt('varActive')} onChange={() => apply((d) => setActiveVariant(d, v.id))} />
                  </td>
                  <td>
                    <input className="ms-input" defaultValue={v.name} aria-label={pt('varName')} onBlur={(e) => rename(v.id, e.target)} />
                  </td>
                  <td>
                    <input className="ms-input" defaultValue={v.description ?? ''} aria-label={pt('varDescription')} onBlur={(e) => apply((d) => ((d.variants?.list.find((x) => x.id === v.id)?.description ?? '') === e.target.value.trim() ? d : setVariantDescription(d, v.id, e.target.value)))} />
                  </td>
                  <td className="ms-hint">{pt('varCount', { n: notFittedCount(design, v.id) })}</td>
                  <td className="ms-hint">{pt('varValueCount', { n: variantChanges(design, v.id).filter((c) => c.kind !== 'notFitted').length })}</td>
                  <td>
                    <button type="button" className="ms-btn ms-btn-small" onClick={() => apply((d) => setFitted(d, rows.map((r) => r.inst.id), v.id, true, partLookup))}>
                      {pt('varAllFitted')}
                    </button>{' '}
                    <button type="button" className="ms-btn ms-btn-small" onClick={() => void remove(v.id, v.name)}>
                      {pt('varDelete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ms-variant-top">
            <button type="button" className="ms-btn" title={pt('tipVarAdd')} onClick={addNew}>
              {pt('varAdd')}
            </button>
            <input className="ms-input" type="search" value={filter} placeholder={pt('varFilter')} aria-label={pt('varFilter')} onChange={(e) => setFilter(e.target.value)} />
          </div>
          {rows.length === 0 ? (
            <p className="ms-hint">{pt('varNoParts')}</p>
          ) : (
            <div className="ms-variant-grid">
              <table className="ms-table">
                <thead>
                  <tr>
                    <th>{pt('varColRef')}</th>
                    <th>{pt('varColPart')}</th>
                    <th>{pt('varColValue')}</th>
                    {variants.map((v) => (
                      <th key={v.id} className={active?.id === v.id ? 'is-active' : undefined}>
                        {pt('varFitted')}: {v.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const main = primaryParam(r.def);
                    return (
                      <tr key={r.inst.id} className={detailId === r.inst.id ? 'is-selected' : undefined}>
                        <td>
                          <button type="button" className="ms-link-button" title={pt('tipVarDetail')} aria-expanded={detailId === r.inst.id} onClick={() => setDetailId(detailId === r.inst.id ? null : r.inst.id)}>
                            {r.path}
                          </button>
                        </td>
                        <td>{r.name}</td>
                        <td>{r.value}</td>
                        {variants.map((v) => (
                          <td key={v.id} className="ms-variant-cell">
                            <input type="checkbox" checked={isFitted(r.inst, v.id)} title={pt('tipVarFitted', { name: v.name })} aria-label={`${r.path}: ${pt('tipVarFitted', { name: v.name })}`} onChange={(e) => apply((d) => setFitted(d, [r.inst.id], v.id, e.target.checked, partLookup))} />
                            {main ? (
                              <VariantValueInput
                                def={main}
                                saved={r.inst.params[main.key] ?? main.default}
                                own={r.inst.variantValues?.[v.id]?.params?.[main.key]}
                                label={`${r.path}: ${pt('tipVarValue', { name: v.name })}`}
                                onChange={(val) => apply((d) => setVariantParam(d, r.inst.id, v.id, main.key, val))}
                              />
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(() => {
            const row = rows.find((r) => r.inst.id === detailId);
            return row ? <VariantPartDetail row={row} variants={variants} apply={apply} /> : null;
          })()}
          <VariantVariables design={design} apply={apply} />
        </>
      )}
    </Dialog>
  );
}

/** Every parameter and BOM field of one part, one box per variant (opened from the reference in the grid). */
function VariantPartDetail({ row, variants, apply }: { row: PartRow; variants: { id: string; name: string }[]; apply: (fn: (d: Design) => Design) => void }) {
  const { inst, def } = row;
  return (
    <section className="ms-variant-detail" aria-label={pt('varDetailTitle', { ref: row.path })}>
      <h4>{pt('varDetailTitle', { ref: row.path })}</h4>
      <p className="ms-hint">{pt('varDetailHint')}</p>
      <table className="ms-table">
        <thead>
          <tr>
            <th>{pt('varDetailParam')}</th>
            <th>{pt('varDetailSaved')}</th>
            {variants.map((v) => (
              <th key={v.id}>{v.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(def?.params ?? []).map((p) => (
            <tr key={p.key}>
              <td title={p.key}>{paramLabel(p)}</td>
              <td>{inst.params[p.key] ?? p.default}</td>
              {variants.map((v) => (
                <td key={v.id}>
                  <VariantValueInput def={p} saved={inst.params[p.key] ?? p.default} own={inst.variantValues?.[v.id]?.params?.[p.key]} label={`${paramLabel(p)} — ${v.name}`} onChange={(val) => apply((d) => setVariantParam(d, inst.id, v.id, p.key, val))} />
                </td>
              ))}
            </tr>
          ))}
          {FIELD_KEYS.map((k) => (
            <tr key={k}>
              <td>{pt(`varField_${k}`)}</td>
              <td>{inst.fields?.[k] ?? ''}</td>
              {variants.map((v) => (
                <td key={v.id}>
                  <VariantValueInput saved={inst.fields?.[k] ?? ''} own={inst.variantValues?.[v.id]?.fields?.[k]} label={`${pt(`varField_${k}`)} — ${v.name}`} onChange={(val) => apply((d) => setVariantField(d, inst.id, v.id, k, val))} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ms-variant-top">
        {variants.map((v) => (
          <button key={v.id} type="button" className="ms-btn ms-btn-small" disabled={!inst.variantValues?.[v.id]} onClick={() => apply((d) => clearVariantValues(d, [inst.id], v.id))}>
            {pt('varClearValues', { name: v.name })}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Global parameters (Design.variables) with another expression per variant. */
function VariantVariables({ design, apply }: { design: Design; apply: (fn: (d: Design) => Design) => void }) {
  const names = Object.keys(design.variables);
  const variants = design.variants?.list ?? [];
  if (!names.length) return null;
  return (
    <section className="ms-variant-detail" aria-label={pt('varGlobals')}>
      <h4>{pt('varGlobals')}</h4>
      <p className="ms-hint">{pt('varGlobalsHint')}</p>
      <table className="ms-table">
        <thead>
          <tr>
            <th>{pt('varDetailParam')}</th>
            <th>{pt('varDetailSaved')}</th>
            {variants.map((v) => (
              <th key={v.id}>{v.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.map((n) => (
            <tr key={n}>
              <td>{n}</td>
              <td>{design.variables[n]}</td>
              {variants.map((v) => (
                <td key={v.id}>
                  <VariantValueInput saved={design.variables[n]} own={v.variables?.[n]} label={`${n} — ${v.name}`} onChange={(val) => apply((d) => setVariantVariable(d, v.id, n, val))} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// My library (profile)

/** The current profile text (favourites, recent, user database; corporate when asked). */
export function currentProfileText(opts: { favourites?: boolean; recent?: boolean; user?: boolean; corporate?: boolean } = {}): string {
  const prefs = getLibraryPrefs();
  return serializeProfile(
    buildProfile({
      favourites: opts.favourites === false ? [] : prefs.favourites,
      recent: opts.recent === false ? [] : prefs.recent,
      ...(opts.user === false ? {} : { user: getDatabase('user') }),
      ...(opts.corporate ? { corporate: getDatabase('corporate') } : {}),
      savedBy: SAVED_BY,
    }),
  );
}

export function exportLibraryProfileFlow(): void {
  openCustomDialog((close) => <ExportProfileDialog close={close} />);
}

function ExportProfileDialog({ close }: { close: () => void }) {
  const prefs = getLibraryPrefs();
  const dbs = usePartDatabases();
  const [sel, setSel] = useState({ favourites: true, recent: true, user: true, corporate: false });
  const row = (key: keyof typeof sel, label: string) => (
    <label className="ms-check" key={key}>
      <input type="checkbox" checked={sel[key]} onChange={(e) => setSel((s) => ({ ...s, [key]: e.target.checked }))} />
      <span>{label}</span>
    </label>
  );
  const save = async () => {
    await downloadText(currentProfileText(sel), pt('profFileName'), 'application/json');
    close();
    actions.addSimMessage('info', pt('profSaved', { fav: sel.favourites ? prefs.favourites.length : 0, recent: sel.recent ? prefs.recent.length : 0, parts: sel.user ? dbs.user.parts.length : 0 }), 'library');
  };
  return (
    <Dialog
      title={pt('profTitleExport')}
      onClose={close}
      width={480}
      footer={
        <>
          <HelpButton page="myLibrary" />
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={() => void save()}>
            {pt('profSave')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{pt('profIntro')}</p>
      <div className="ms-form">
        {row('favourites', pt('profFavourites', { n: prefs.favourites.length }))}
        {row('recent', pt('profRecent', { n: prefs.recent.length }))}
        {row('user', pt('profUser', { n: dbs.user.parts.length }))}
        {row('corporate', pt('profCorporate', { n: dbs.corporate.parts.length }))}
      </div>
    </Dialog>
  );
}

export async function importLibraryProfileFlow(): Promise<void> {
  const f = await pickTextFile(`${PROFILE_EXTENSION},.json`);
  if (f) await importProfileText(f.text, f.name);
}

/** Read a profile text and show the import dialog (File picker, project). */
export async function importProfileText(text: string, name: string): Promise<void> {
  let profile: LibraryProfile;
  try {
    profile = parseProfile(text);
  } catch (e) {
    await alertDialog({ title: pt('profTitleImport'), message: pt('profBad', { name, error: e instanceof Error ? e.message : String(e) }) });
    return;
  }
  openCustomDialog((close) => <ImportProfileDialog close={close} profile={profile} name={name} />);
}

function ImportProfileDialog({ close, profile, name }: { close: () => void; profile: LibraryProfile; name: string }) {
  const [sel, setSel] = useState({ favourites: profile.favourites.length > 0, recent: profile.recent.length > 0, user: !!profile.user?.parts.length, corporate: !!profile.corporate?.parts.length });
  const [policy, setPolicy] = useState<MergePolicy>('newer');
  const nothing = !Object.values(sel).some(Boolean);
  const apply = async () => {
    const prefs = getLibraryPrefs();
    const incoming: LibraryProfile = {
      ...profile,
      favourites: sel.favourites ? profile.favourites : [],
      recent: sel.recent ? profile.recent : [],
      ...(sel.user ? {} : { user: undefined }),
      ...(sel.corporate ? {} : { corporate: undefined }),
    };
    const m = mergeProfile({ favourites: prefs.favourites, recent: prefs.recent, user: getDatabase('user'), corporate: getDatabase('corporate') }, incoming, policy);
    replaceLibraryPrefs({ favourites: m.favourites, recent: m.recent });
    if (m.user) await commitDatabase('user', m.user.db);
    if (m.corporate) await commitDatabase('corporate', m.corporate.db);
    close();
    const added = (m.user?.added ?? 0) + (m.corporate?.added ?? 0);
    const updated = (m.user?.updated ?? 0) + (m.corporate?.updated ?? 0);
    const skipped = (m.user?.skipped ?? 0) + (m.corporate?.skipped ?? 0);
    actions.addSimMessage('info', pt('profImported', { fav: m.addedFavourites, added, updated, skipped }), 'library');
  };
  const row = (key: keyof typeof sel, label: string, available: boolean) => (
    <label className="ms-check" key={key}>
      <input type="checkbox" checked={sel[key]} disabled={!available} onChange={(e) => setSel((s) => ({ ...s, [key]: e.target.checked }))} />
      <span>{label}</span>
    </label>
  );
  const date = profile.created ? new Date(profile.created).toLocaleString(localeTag()) : '—';
  return (
    <Dialog
      title={pt('profTitleImport')}
      onClose={close}
      width={520}
      footer={
        <>
          <HelpButton page="myLibrary" />
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={nothing} onClick={() => void apply()}>
            {pt('profApply')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{pt('profFrom', { name, savedBy: profile.savedBy ?? '—', date })}</p>
      {nothing && !profile.favourites.length && !profile.recent.length && !profile.user?.parts.length && !profile.corporate?.parts.length ? <p role="status">{pt('profNothing')}</p> : null}
      <div className="ms-form">
        {row('favourites', pt('profFavourites', { n: profile.favourites.length }), profile.favourites.length > 0)}
        {row('recent', pt('profRecent', { n: profile.recent.length }), profile.recent.length > 0)}
        {row('user', pt('profUser', { n: profile.user?.parts.length ?? 0 }), !!profile.user?.parts.length)}
        {row('corporate', pt('profCorporate', { n: profile.corporate?.parts.length ?? 0 }), !!profile.corporate?.parts.length)}
        <label className="ms-field">
          <span>{pt('profPolicy')}</span>
          <select className="ms-input" value={policy} onChange={(e) => setPolicy(e.target.value as MergePolicy)}>
            <option value="newer">{pt('profPolicyNewer')}</option>
            <option value="replace">{pt('profPolicyReplace')}</option>
            <option value="keep">{pt('profPolicyKeep')}</option>
          </select>
        </label>
      </div>
    </Dialog>
  );
}

