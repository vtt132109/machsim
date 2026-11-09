/**
 * Database manager (Tools › Database manager): the master database (built-in library, read-only),
 * the corporate database and the user database.
 *
 * - Left: database choice and its families (group › family); families can be added, renamed and
 *   removed (only when empty).
 * - Right: the parts of the chosen family (or all), with the database's user fields as editable
 *   columns; new / edit / duplicate / delete, copy or move to the other database.
 * - Import (.msimdb, merged by the chosen policy), export, and "update the open design" (its
 *   embedded copies take the database versions).
 * - Master: browse by group and family with a search box; "Copy to the user database" makes an
 *   editable user component that reuses the library model.
 */
import { useMemo, useState } from 'react';
import { GROUPS, listParts } from '../../library';
import type { PartDef, PartGroup } from '../../library/types';
import { isCustomPartId, type CustomPartData, type PartDatabase } from '../../library/custom/types';
import { addFamily, addField, databaseFamilies, mergeDatabases, movePart, parseDatabase, partFromLibrary, removeFamily, removeField, renameFamily, serializeDatabase, setPartField, uniquePartId, upsertPart, removePart, type MergePolicy } from '../../library/custom/database';
import { refreshFromDatabase } from '../../library/custom/design';
import { Dialog } from '../common/Dialog';
import { alertDialog, confirmDialog, openCustomDialog, promptText } from '../common/dialogs';
import { SymbolPreview } from '../editor/SymbolPreview';
import { actions, getState } from '../store';
import { familyName, groupName, partDescription, partName } from '../../i18n/library';
import { localeTag, t } from '../../i18n';
import { commitDatabase, findUserPart, knownCustomIds, usePartDatabases, type DbKind } from './partDatabases';
import { downloadText, pickTextFile } from './fileIo';
import { openWizardDialog } from './ComponentWizard';
import { newWizard, wizardFromPart } from './wizardModel';
import { symbolDef } from './SymbolEditor';
import './parts.css';

type View = 'master' | DbKind;
const VIEWS: View[] = ['master', 'corporate', 'user'];

function modelKind(p: CustomPartData): 'none' | 'maker' | 'builtin' | 'spice' {
  const m = p.model;
  if (m.kind === 'none') return 'none';
  return m.maker ? 'maker' : m.kind;
}

export function DatabaseManager({ close }: { close: () => void }) {
  const dbs = usePartDatabases();
  const [view, setView] = useState<View>('user');
  const [family, setFamily] = useState<{ group: PartGroup; name: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [policy, setPolicy] = useState<MergePolicy>('newer');
  const db: PartDatabase | undefined = view === 'master' ? undefined : dbs[view];
  const other: DbKind = view === 'user' ? 'corporate' : 'user';

  const families = useMemo(() => {
    if (db) return databaseFamilies(db);
    const seen = new Map<string, { group: PartGroup; name: string; n: number }>();
    for (const p of listParts()) {
      if (isCustomPartId(p.id)) continue;
      const k = `${p.group}/${p.family}`;
      const e = seen.get(k) ?? { group: p.group, name: p.family || 'General', n: 0 };
      e.n += 1;
      seen.set(k, e);
    }
    return [...seen.values()].sort((a, b) => GROUPS.findIndex((g) => g.id === a.group) - GROUPS.findIndex((g) => g.id === b.group) || familyName(a.name).localeCompare(familyName(b.name)));
  }, [db]);

  const q = query.trim().toLowerCase();
  const userParts = useMemo(
    () => (db ? db.parts.filter((p) => (!family || (p.group === family.group && p.family.toLowerCase() === family.name.toLowerCase())) && (!q || [p.name, p.description, p.id].some((x) => x.toLowerCase().includes(q)))) : []),
    [db, family, q],
  );
  const masterParts = useMemo(() => {
    if (db) return [];
    return listParts()
      .filter((p) => !isCustomPartId(p.id) && (!family || (p.group === family.group && (p.family || 'General') === family.name)) && (!q || [p.name, partName(p), p.id].some((x) => x.toLowerCase().includes(q))))
      .slice(0, 300);
  }, [db, family, q]);

  const sel = db?.parts.find((p) => p.id === selected);
  const masterSel = !db ? masterParts.find((p) => p.id === selected) : undefined;

  const save = async (next: PartDatabase) => {
    if (view === 'master') return;
    const r = await commitDatabase(view, next);
    if (r.updatedInDesign.length) actions.addSimMessage('info', t('db.designUpdated', { n: r.updatedInDesign.length }), 'parts');
  };

  const newPart = () => {
    close();
    openWizardDialog({ ...newWizard({ db: view === 'master' ? 'user' : view }), ...(family ? { group: family.group, family: family.name } : {}) });
  };
  const editPart = (p: CustomPartData) => {
    close();
    openWizardDialog(wizardFromPart(p, view === 'master' ? 'user' : view));
  };
  const duplicate = async (p: CustomPartData) => {
    if (!db) return;
    const name = t('db.copyName', { name: p.name });
    await save(upsertPart(db, { ...p, id: uniquePartId(name, knownCustomIds()), name }));
  };
  const remove = async (p: CustomPartData) => {
    if (!db) return;
    const used = (getState().design.customParts ?? []).some((c) => c.id === p.id);
    const ok = await confirmDialog({ title: t('db.delete'), message: used ? t('db.confirmDeleteUsed', { name: p.name }) : t('db.confirmDelete', { name: p.name }), okLabel: t('common.delete'), danger: true });
    if (!ok) return;
    await save(removePart(db, p.id));
    setSelected(null);
  };
  const transfer = async (p: CustomPartData, copy: boolean) => {
    if (view === 'master') return;
    const r = movePart(dbs[view], dbs[other], p.id, copy);
    await commitDatabase(other, r.to);
    if (!copy) await commitDatabase(view, r.from);
    actions.addSimMessage('info', t(copy ? 'db.copied' : 'db.moved', { name: p.name, db: t(`db.kind.${other}`) }), 'parts');
  };
  const copyMaster = async (p: PartDef) => {
    const data = partFromLibrary(p, { taken: knownCustomIds() });
    await commitDatabase('user', upsertPart(dbs.user, data));
    actions.addSimMessage('info', t('db.copiedToUser', { name: partName(p) }), 'parts');
    setView('user');
    setFamily({ group: data.group, name: data.family });
    setSelected(data.id);
  };

  const addFam = async () => {
    if (!db) return;
    const name = await promptText({ title: t('db.addFamily'), label: t('db.familyName'), validate: (v) => (v.trim() ? null : t('db.nameRequired')) });
    if (!name) return;
    const group = family?.group ?? 'misc';
    await save(addFamily(db, group, name));
    setFamily({ group, name: name.trim() });
  };
  const renameFam = async () => {
    if (!db || !family) return;
    const name = await promptText({ title: t('db.renameFamily'), label: t('db.familyName'), initial: family.name, validate: (v) => (v.trim() ? null : t('db.nameRequired')) });
    if (!name) return;
    await save(renameFamily(db, family.group, family.name, name));
    setFamily({ group: family.group, name: name.trim() });
  };
  const deleteFam = async () => {
    if (!db || !family) return;
    const r = removeFamily(db, family.group, family.name);
    if (r.blocked) {
      await alertDialog({ title: t('db.deleteFamily'), message: t('db.familyInUse', { n: r.blocked }) });
      return;
    }
    await save(r.db);
    setFamily(null);
  };
  const addFld = async () => {
    if (!db) return;
    const name = await promptText({ title: t('db.addField'), label: t('db.fieldName'), validate: (v) => (v.trim() ? null : t('db.nameRequired')) });
    if (name) await save(addField(db, name));
  };
  const removeFld = async (f: string) => {
    if (!db) return;
    const ok = await confirmDialog({ title: t('db.removeField'), message: t('db.confirmRemoveField', { name: f }), danger: true });
    if (ok) await save(removeField(db, f));
  };

  const doImport = async () => {
    if (!db) return;
    const f = await pickTextFile('.msimdb,.json');
    if (!f) return;
    try {
      const incoming = parseDatabase(f.text);
      const r = mergeDatabases(db, incoming, policy);
      await save(r.db);
      await alertDialog({ title: t('db.import'), message: t('db.imported', { added: r.added, updated: r.updated, skipped: r.skipped }) });
    } catch (e) {
      await alertDialog({ title: t('db.importFailed'), message: e instanceof Error ? e.message : String(e) });
    }
  };
  const doExport = () => {
    if (!db) return;
    void downloadText(serializeDatabase(db), `machsim-${db.kind}.msimdb`, 'application/json');
  };
  const updateDesign = () => {
    let updated: string[] = [];
    actions.applyDesign((d) => {
      const r = refreshFromDatabase(d, (id) => findUserPart(id)?.part);
      updated = r.updated;
      return r.design;
    });
    void alertDialog({ title: t('db.updateDesign'), message: updated.length ? t('db.updated', { n: updated.length }) : t('db.noneUpdated') });
  };

  return (
    <Dialog
      title={t('db.title')}
      onClose={close}
      width={980}
      className="ms-db-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={updateDesign} title={t('tip.db.updateDesign')}>
            {t('db.updateDesign')}
          </button>
          <span className="ms-wiz-spacer" />
          <button type="button" className="ms-btn ms-btn-primary" onClick={close} title={t('common.close')}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{t('db.intro')}</p>
      {dbs.error && view !== 'master' && dbs.error[view] ? <p className="ms-wiz-error">{t('db.loadError', { message: dbs.error[view] ?? '' })}</p> : null}
      <div className="ms-db">
        <aside className="ms-db-side">
          <div className="ms-db-views" role="radiogroup" aria-label={t('db.databases')}>
            {VIEWS.map((v) => (
              <label key={v} className={`ms-db-view${view === v ? ' ms-db-view-on' : ''}`} title={t(`tip.db.kind.${v}`)}>
                <input
                  type="radio"
                  name="ms-db-view"
                  checked={view === v}
                  title={t(`tip.db.kind.${v}`)}
                  onChange={() => {
                    setView(v);
                    setFamily(null);
                    setSelected(null);
                  }}
                />
                {t(`db.kind.${v}`)} <span className="ms-hint">({v === 'master' ? listParts().filter((p) => !isCustomPartId(p.id)).length : dbs[v].parts.length})</span>
              </label>
            ))}
          </div>
          <h4>{t('db.families')}</h4>
          <ul className="ms-db-families">
            <li>
              <button type="button" className={!family ? 'ms-wiz-list-on' : ''} onClick={() => setFamily(null)} title={t('tip.db.allFamilies')}>
                {t('db.allFamilies')}
              </button>
            </li>
            {families.map((f) => (
              <li key={`${f.group}/${f.name}`}>
                <button type="button" className={family && family.group === f.group && family.name === f.name ? 'ms-wiz-list-on' : ''} title={`${groupName(f.group)} › ${familyName(f.name)}`} onClick={() => setFamily({ group: f.group, name: f.name })}>
                  <span className="ms-hint">{groupName(f.group)} ›</span> {familyName(f.name)}
                  {'n' in f ? <span className="ms-hint"> ({(f as { n: number }).n})</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {db ? (
            <div className="ms-db-buttons">
              <button type="button" className="ms-btn ms-btn-small" onClick={() => void addFam()} title={t('tip.db.addFamily')}>
                {t('db.addFamily')}
              </button>
              <button type="button" className="ms-btn ms-btn-small" disabled={!family} onClick={() => void renameFam()} title={t('tip.db.renameFamily')}>
                {t('db.renameFamily')}
              </button>
              <button type="button" className="ms-btn ms-btn-small" disabled={!family} onClick={() => void deleteFam()} title={t('tip.db.deleteFamily')}>
                {t('db.deleteFamily')}
              </button>
            </div>
          ) : null}
        </aside>
        <section className="ms-db-main">
          <div className="ms-db-bar">
            <input className="ms-input" placeholder={t('db.search')} value={query} title={t('tip.db.search')} onChange={(e) => setQuery(e.target.value)} />
            {db ? (
              <>
                <button type="button" className="ms-btn ms-btn-primary" onClick={newPart} title={t('tip.db.new')}>
                  {t('db.new')}
                </button>
                <button type="button" className="ms-btn" onClick={() => void addFld()} title={t('tip.db.addField')}>
                  {t('db.addField')}
                </button>
                <select className="ms-input" value={policy} title={t('tip.db.mergePolicy')} onChange={(e) => setPolicy(e.target.value as MergePolicy)}>
                  {(['newer', 'replace', 'keep'] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`db.merge.${m}`)}
                    </option>
                  ))}
                </select>
                <button type="button" className="ms-btn" onClick={() => void doImport()} title={t('tip.db.import')}>
                  {t('db.import')}
                </button>
                <button type="button" className="ms-btn" onClick={doExport} title={t('tip.db.export')}>
                  {t('db.export')}
                </button>
              </>
            ) : (
              <span className="ms-hint">{t('db.readOnly')}</span>
            )}
          </div>
          <div className="ms-db-table-wrap">
            <table className="ms-table ms-db-table">
              <thead>
                <tr>
                  <th>{t('db.col.name')}</th>
                  <th>{t('db.col.family')}</th>
                  <th>{db ? t('db.col.model') : t('db.col.description')}</th>
                  <th>{t('db.col.footprint')}</th>
                  {db?.fields.map((f) => (
                    <th key={f}>
                      {f}{' '}
                      <button type="button" className="ms-icon-btn" aria-label={t('db.removeFieldNamed', { name: f })} title={t('db.removeFieldNamed', { name: f })} onClick={() => void removeFld(f)}>
                        ×
                      </button>
                    </th>
                  ))}
                  {db ? <th>{t('db.col.modified')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {db
                  ? userParts.map((p) => (
                      <tr key={p.id} className={p.id === selected ? 'ms-db-row-on' : undefined} onClick={() => setSelected(p.id)} onDoubleClick={() => editPart(p)}>
                        <td>{p.name}</td>
                        <td>{familyName(p.family)}</td>
                        <td>{t(`db.model.${modelKind(p)}`)}</td>
                        <td>{p.footprint ?? ''}</td>
                        {db.fields.map((f) => (
                          <td key={f}>
                            <input className="ms-input ms-db-cell" value={p.fields?.[f] ?? ''} aria-label={f} title={t('tip.wiz.field')} onChange={(e) => void save(setPartField(db, p.id, f, e.target.value))} />
                          </td>
                        ))}
                        <td>{p.modified ? new Date(p.modified).toLocaleDateString(localeTag()) : ''}</td>
                      </tr>
                    ))
                  : masterParts.map((p) => (
                      <tr key={p.id} className={p.id === selected ? 'ms-db-row-on' : undefined} onClick={() => setSelected(p.id)}>
                        <td>{partName(p)}</td>
                        <td>{familyName(p.family)}</td>
                        <td className="ms-db-desc">{partDescription(p)}</td>
                        <td>{p.footprint ?? ''}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {(db ? userParts : masterParts).length === 0 ? <p className="ms-hint">{db ? t('db.empty') : t('db.noMatch')}</p> : null}
          </div>
          {sel || masterSel ? (
            <div className="ms-db-detail">
              <SymbolPreview def={symbolDef((sel ?? masterSel)!.symbol, (sel ?? masterSel)!.name)} className="ms-wiz-big-preview" title={t('wiz.symbolPreview')} />
              <div>
                <strong>{sel ? sel.name : partName(masterSel!)}</strong>
                <p className="ms-hint">{sel ? sel.description : partDescription(masterSel!)}</p>
                <div className="ms-db-buttons">
                  {sel ? (
                    <>
                      <button type="button" className="ms-btn ms-btn-small" onClick={() => editPart(sel)} title={t('tip.db.edit')}>
                        {t('db.edit')}
                      </button>
                      <button type="button" className="ms-btn ms-btn-small" onClick={() => void duplicate(sel)} title={t('tip.db.duplicate')}>
                        {t('db.duplicate')}
                      </button>
                      <button type="button" className="ms-btn ms-btn-small" onClick={() => void transfer(sel, true)} title={t('tip.db.copyTo')}>
                        {t('db.copyTo', { db: t(`db.kind.${other}`) })}
                      </button>
                      <button type="button" className="ms-btn ms-btn-small" onClick={() => void transfer(sel, false)} title={t('tip.db.moveTo')}>
                        {t('db.moveTo', { db: t(`db.kind.${other}`) })}
                      </button>
                      <button type="button" className="ms-btn ms-btn-small" onClick={() => actions.startPlacing(sel.id)} title={t('tip.db.place')}>
                        {t('db.place')}
                      </button>
                      <button type="button" className="ms-btn ms-btn-small ms-btn-danger" onClick={() => void remove(sel)} title={t('tip.db.delete')}>
                        {t('db.delete')}
                      </button>
                    </>
                  ) : (
                    <button type="button" className="ms-btn ms-btn-small ms-btn-primary" onClick={() => void copyMaster(masterSel!)} title={t('tip.db.copyToUser')}>
                      {t('db.copyToUser')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}

export function openDatabaseManagerDialog(): void {
  openCustomDialog((close) => <DatabaseManager close={close} />);
}
