/**
 * Simulation profile bar of the analysis dialog: pick a built-in or saved profile and load it into
 * the dialog's draft, save the draft as a profile, delete a saved one, export / import a
 * `.msimprofile` file. Storage and files are injected by the host (ProfileHost) so the bar stays
 * testable without a browser.
 */
import { useState } from 'react';
import type { SimOptions } from '../../sim/netlist';
import { BUILTIN_PROFILES, PROFILE_FORMAT, type ProfileSettings, type SimProfile } from '../../model/simProfiles';
import { t, tDynamic } from '../../i18n';

export interface ProfileHost {
  list(): SimProfile[];
  /** returns the new list */
  save(p: SimProfile): SimProfile[];
  remove(name: string): SimProfile[];
  exportFile(p: SimProfile): void;
  /** resolves null when cancelled; throws ProfileFormatError for invalid files */
  importFile(): Promise<SimProfile | null>;
}

/** A built-in profile as a SimProfile (options only). */
export function builtinProfile(id: string): SimProfile {
  const b = BUILTIN_PROFILES.find((x) => x.id === id) ?? BUILTIN_PROFILES[0];
  return { format: PROFILE_FORMAT, version: 1, name: tDynamic(`sim.profile.builtin.${b.id}`), options: { ...b.options } as Partial<SimOptions>, builtin: true };
}

export function ProfileBar({ host, current, onLoad, make }: { host: ProfileHost; current: () => ProfileSettings; onLoad: (p: SimProfile) => void; make: (name: string, s: ProfileSettings) => SimProfile }) {
  const [list, setList] = useState<SimProfile[]>(() => host.list());
  const [sel, setSel] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const selected = sel.startsWith('b:') ? builtinProfile(sel.slice(2)) : list.find((p) => `u:${p.name}` === sel);
  const save = () => {
    const name = typeof window !== 'undefined' ? window.prompt(t('sim.profile.namePrompt'), selected && !selected.builtin ? selected.name : '') : null;
    if (!name || !name.trim()) return;
    const next = host.save(make(name, current()));
    setList(next);
    setSel(`u:${name.trim()}`);
    setMessage(t('sim.profile.saved', { name: name.trim() }));
  };
  const load = () => {
    if (!selected) return;
    onLoad(selected);
    setMessage(t('sim.profile.loaded', { name: selected.name }));
  };
  const remove = () => {
    if (!selected || selected.builtin) return;
    setList(host.remove(selected.name));
    setSel('');
    setMessage(t('sim.profile.deleted', { name: selected.name }));
  };
  const importFile = async () => {
    try {
      const p = await host.importFile();
      if (!p) return;
      setList(host.save(p));
      setSel(`u:${p.name}`);
      setMessage(t('sim.profile.imported', { name: p.name }));
    } catch (e) {
      setMessage(t('sim.profile.importFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  return (
    <div className="msa-profiles" role="group" aria-label={t('sim.profile.title')}>
      <span className="msa-label">{t('sim.profile.title')}</span>
      <select className="msa-input msa-select" value={sel} title={t('tip.profile.select')} aria-label={t('sim.profile.title')} onChange={(e) => setSel(e.target.value)}>
        <option value="">{t('sim.profile.choose')}</option>
        <optgroup label={t('sim.profile.builtinGroup')}>
          {BUILTIN_PROFILES.map((b) => (
            <option key={b.id} value={`b:${b.id}`}>
              {tDynamic(`sim.profile.builtin.${b.id}`)}
            </option>
          ))}
        </optgroup>
        {list.length > 0 && (
          <optgroup label={t('sim.profile.userGroup')}>
            {list.map((p) => (
              <option key={p.name} value={`u:${p.name}`}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <button type="button" className="msa-btn msa-btn-small" title={t('tip.profile.load')} disabled={!selected} onClick={load}>
        {t('sim.profile.load')}
      </button>
      <button type="button" className="msa-btn msa-btn-small" title={t('tip.profile.save')} onClick={save}>
        {t('sim.profile.saveAs')}
      </button>
      <button type="button" className="msa-btn msa-btn-small" title={t('tip.profile.delete')} disabled={!selected || !!selected.builtin} onClick={remove}>
        {t('sim.profile.delete')}
      </button>
      <button type="button" className="msa-btn msa-btn-small" title={t('tip.profile.export')} disabled={!selected} onClick={() => selected && host.exportFile(selected)}>
        {t('sim.profile.export')}
      </button>
      <button type="button" className="msa-btn msa-btn-small" title={t('tip.profile.import')} onClick={() => void importFile()}>
        {t('sim.profile.import')}
      </button>
      {selected?.builtin && <span className="msa-hint">{tDynamic(`sim.profile.builtinHelp.${BUILTIN_PROFILES.find((b) => `b:${b.id}` === sel)?.id ?? 'default'}`)}</span>}
      {message && (
        <span className="msa-hint" role="status">
          {message}
        </span>
      )}
    </div>
  );
}
