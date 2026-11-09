/**
 * Default instrument settings (Options > Default instrument settings): per instrument part, the
 * parameter values a NEWLY placed instrument starts with. They are stored per machine (browser /
 * Electron localStorage, key machsim.instrumentDefaults.v1); the settings of placed instruments are
 * part parameters and travel with the design file as before.
 *
 * Light module (no panel code): the store and the placement hook are installed at start-up.
 */
import type { PartDef } from '../../library/types';
import { createStore } from '../store/createStore';

export const INSTRUMENT_DEFAULTS_KEY = 'machsim.instrumentDefaults.v1';

export interface DefaultsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** partId -> parameter values that differ from the library defaults. */
export type DefaultsTable = Record<string, Record<string, string>>;

export const instrumentDefaultsStore = createStore<DefaultsTable>({});

let backing: DefaultsStorage | null = null;

/** Parse a stored table, dropping anything that is not string -> string. */
export function parseDefaultsTable(text: string | null): DefaultsTable {
  if (!text) return {};
  try {
    const raw = JSON.parse(text) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: DefaultsTable = {};
    for (const [partId, params] of Object.entries(raw as Record<string, unknown>)) {
      if (!params || typeof params !== 'object' || Array.isArray(params)) continue;
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(params as Record<string, unknown>)) if (typeof v === 'string') clean[k] = v;
      if (Object.keys(clean).length) out[partId] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

/** Load the table from storage (start-up). */
export function installInstrumentDefaults(storage: DefaultsStorage | null): void {
  backing = storage;
  let text: string | null = null;
  try {
    text = storage?.getItem(INSTRUMENT_DEFAULTS_KEY) ?? null;
  } catch {
    text = null;
  }
  instrumentDefaultsStore.setState(parseDefaultsTable(text));
}

function persist(table: DefaultsTable): void {
  instrumentDefaultsStore.setState(table);
  try {
    backing?.setItem(INSTRUMENT_DEFAULTS_KEY, JSON.stringify(table));
  } catch {
    // storage full or blocked: the defaults still apply for this session
  }
}

/** Only the keys of the part that differ from its library defaults. */
export function differingParams(def: PartDef, params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of def.params) {
    const v = params[p.key];
    if (v !== undefined && v !== p.default) out[p.key] = v;
  }
  return out;
}

/** Saved defaults of an instrument part (undefined = factory settings). */
export function instrumentDefaults(partId: string): Record<string, string> | undefined {
  return instrumentDefaultsStore.getState()[partId];
}

/** Save the given settings as the defaults of a part (factory values are not stored). */
export function saveInstrumentDefaults(def: PartDef, params: Record<string, string>): void {
  const diff = differingParams(def, params);
  const table = { ...instrumentDefaultsStore.getState() };
  if (Object.keys(diff).length) table[def.id] = diff;
  else delete table[def.id];
  persist(table);
}

/** Back to factory settings for one part (or every part). */
export function resetInstrumentDefaults(partId?: string): void {
  if (!partId) {
    persist({});
    return;
  }
  const table = { ...instrumentDefaultsStore.getState() };
  delete table[partId];
  persist(table);
}
