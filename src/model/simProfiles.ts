/**
 * Simulation profiles (pure + injectable storage): named sets of analysis settings, simulation
 * options and interactive settings that can be saved, loaded into the analysis dialog, exported
 * as `.msimprofile` files and imported again.
 *
 *   profileFromSettings(name, settings)  build a profile from the dialog's current draft
 *   parseProfile(text) / serializeProfile(profile)   file format 'machsim-sim-profile' v1 (JSON)
 *   ProfileStore(storage)                list / save (replaces a profile of the same name) / remove
 *   BUILTIN_PROFILES                     ready-made option sets for learners (accurate, fast,
 *                                        hard-to-converge circuits); they change options only
 *
 * Invalid files throw ProfileFormatError with readable issues.
 */
import type { AnalysisSettings, InteractiveSettings } from './types';
import type { AnalysisSpec, SimOptions } from '../sim/netlist';
import { DEFAULT_OPTIONS } from '../sim/netlist';

export const PROFILE_FORMAT = 'machsim-sim-profile';
export const PROFILE_EXTENSION = '.msimprofile';
/** localStorage key of the user's profiles */
export const PROFILES_KEY = 'machsim.simprofiles.v1';

export interface ProfileSettings {
  analysis?: AnalysisSettings;
  options: Partial<SimOptions>;
  interactive?: InteractiveSettings;
}

export interface SimProfile extends ProfileSettings {
  format: typeof PROFILE_FORMAT;
  version: 1;
  name: string;
  /** ISO time of saving */
  saved?: string;
  /** built-in profiles are not stored and cannot be deleted */
  builtin?: boolean;
}

export class ProfileFormatError extends Error {
  constructor(readonly issues: string[]) {
    super(`invalid simulation profile: ${issues.join('; ')}`);
    this.name = 'ProfileFormatError';
  }
}

export function profileFromSettings(name: string, settings: ProfileSettings, now = new Date()): SimProfile {
  const p: SimProfile = { format: PROFILE_FORMAT, version: 1, name: name.trim(), saved: now.toISOString(), options: { ...settings.options } };
  if (settings.analysis) p.analysis = JSON.parse(JSON.stringify(settings.analysis)) as AnalysisSettings;
  if (settings.interactive) p.interactive = { ...settings.interactive };
  return p;
}

export function serializeProfile(p: SimProfile): string {
  const { builtin: _builtin, ...rest } = p;
  return JSON.stringify(rest, null, 2);
}

const OPTION_KEYS = new Set(Object.keys(DEFAULT_OPTIONS));

/** Validate a raw profile object. */
export function readProfile(raw: unknown): SimProfile {
  const issues: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ProfileFormatError(['the file does not contain a JSON object']);
  const o = raw as Record<string, unknown>;
  if (o.format !== PROFILE_FORMAT) issues.push(`format: expected "${PROFILE_FORMAT}"`);
  if (o.version !== 1) issues.push('version: expected 1');
  if (typeof o.name !== 'string' || !o.name.trim()) issues.push('name: expected a non-empty text');
  const options: Partial<SimOptions> = {};
  if (o.options !== undefined) {
    if (typeof o.options !== 'object' || o.options === null) issues.push('options: expected an object');
    else {
      for (const [k, v] of Object.entries(o.options as Record<string, unknown>)) {
        if (!OPTION_KEYS.has(k)) {
          issues.push(`options.${k}: unknown option`);
          continue;
        }
        if (k === 'method') {
          if (v !== 'trap' && v !== 'gear') issues.push('options.method: must be "trap" or "gear"');
          else options.method = v;
        } else if (typeof v !== 'number' || !Number.isFinite(v)) issues.push(`options.${k}: expected a number`);
        else (options as Record<string, number>)[k] = v;
      }
    }
  }
  let analysis: AnalysisSettings | undefined;
  if (o.analysis !== undefined) {
    const a = o.analysis as Record<string, unknown>;
    if (typeof a !== 'object' || a === null || typeof a.active !== 'string' || typeof a.specs !== 'object' || a.specs === null) issues.push('analysis: expected { active, specs }');
    else {
      const specs: Record<string, AnalysisSpec> = {};
      for (const [k, s] of Object.entries(a.specs as Record<string, unknown>)) {
        if (typeof s !== 'object' || s === null || (s as { type?: unknown }).type !== k) issues.push(`analysis.specs.${k}: expected a spec of type ${k}`);
        else specs[k] = s as AnalysisSpec;
      }
      analysis = { active: a.active as AnalysisSettings['active'], specs };
      for (const key of ['saves', 'expressions'] as const) {
        const list = a[key];
        if (list === undefined) continue;
        if (Array.isArray(list) && list.every((x) => typeof x === 'string')) analysis[key] = list as string[];
        else issues.push(`analysis.${key}: expected a list of texts`);
      }
    }
  }
  let interactive: InteractiveSettings | undefined;
  if (o.interactive !== undefined) {
    const it = o.interactive as Record<string, unknown>;
    if (typeof it !== 'object' || it === null) issues.push('interactive: expected an object');
    else {
      interactive = {};
      if (it.initial !== undefined) {
        if (it.initial === 'auto' || it.initial === 'op' || it.initial === 'zero' || it.initial === 'uic') interactive.initial = it.initial;
        else issues.push('interactive.initial: must be auto, op, zero or uic');
      }
      for (const k of ['tstep', 'tmax', 'tstop'] as const) {
        const v = it[k];
        if (v === undefined) continue;
        if (typeof v === 'number' && v > 0 && Number.isFinite(v)) interactive[k] = v;
        else issues.push(`interactive.${k}: expected a positive number`);
      }
    }
  }
  if (issues.length) throw new ProfileFormatError(issues);
  const p: SimProfile = { format: PROFILE_FORMAT, version: 1, name: (o.name as string).trim(), options };
  if (typeof o.saved === 'string') p.saved = o.saved;
  if (analysis) p.analysis = analysis;
  if (interactive) p.interactive = interactive;
  return p;
}

export function parseProfile(text: string): SimProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProfileFormatError([`not valid JSON (${e instanceof Error ? e.message : String(e)})`]);
  }
  return readProfile(raw);
}

/** Settings after loading a profile: options replace, analysis / interactive replace when present. */
export function applyProfile(current: ProfileSettings, p: SimProfile): ProfileSettings {
  return {
    options: { ...p.options },
    analysis: p.analysis ? (JSON.parse(JSON.stringify(p.analysis)) as AnalysisSettings) : current.analysis,
    interactive: p.interactive ? { ...p.interactive } : current.interactive,
  };
}

/** Ready-made option sets (names are i18n keys under sim.profile.builtin.*). */
export const BUILTIN_PROFILES: readonly { id: string; options: Partial<SimOptions> }[] = [
  { id: 'default', options: {} },
  { id: 'accurate', options: { reltol: 1e-4, abstol: 1e-14, vntol: 1e-7, chgtol: 1e-16, trtol: 1 } },
  { id: 'fast', options: { reltol: 1e-2, vntol: 1e-4, abstol: 1e-9, trtol: 10 } },
  { id: 'hard', options: { gminSteps: 50, srcSteps: 50, itl1: 500, itl2: 200, itl4: 50, rshunt: 1e12, method: 'gear', reltol: 3e-3 } },
];

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The user's saved profiles in a key-value storage (browser / Electron localStorage). */
export class ProfileStore {
  constructor(private readonly storage: KeyValueStorage | null, private readonly key = PROFILES_KEY) {}

  list(): SimProfile[] {
    if (!this.storage) return [];
    let text: string | null = null;
    try {
      text = this.storage.getItem(this.key);
    } catch {
      return [];
    }
    if (!text) return [];
    try {
      const raw = JSON.parse(text) as unknown;
      if (!Array.isArray(raw)) return [];
      const out: SimProfile[] = [];
      for (const r of raw) {
        try {
          out.push(readProfile(r));
        } catch {
          // a damaged entry is skipped, the others stay usable
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  private write(list: SimProfile[]): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(list.map((p) => JSON.parse(serializeProfile(p)) as unknown)));
    } catch {
      // storage full or blocked: the profile simply is not kept
    }
  }

  /** Save (replacing a profile with the same name, case-insensitive). */
  save(p: SimProfile): SimProfile[] {
    const list = this.list().filter((x) => x.name.toLowerCase() !== p.name.toLowerCase());
    list.push(p);
    list.sort((a, b) => a.name.localeCompare(b.name));
    this.write(list);
    return list;
  }

  remove(name: string): SimProfile[] {
    const list = this.list().filter((x) => x.name.toLowerCase() !== name.toLowerCase());
    this.write(list);
    return list;
  }
}
