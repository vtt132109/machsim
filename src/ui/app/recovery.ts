/**
 * Crash recovery: where autosaved documents live and whether to offer them at start-up.
 *
 * Recovery slot (one record that holds every document with unsaved changes: the first in the record
 * itself, further ones in `others`, see files.ts AutosaveRecord):
 *   - browsers: localStorage `machsim.autosave.v1` (AutosaveRecord JSON, see files.ts);
 *   - desktop: the user-data folder through the bridge (`recovery/autosave.json`, written via a
 *     temporary file so a crash never leaves half a record); an older record in localStorage is
 *     still read once.
 * Session marker (was the previous run closed normally?):
 *   - browsers: localStorage `machsim.session.v1` = { id, started, beat, clean }; the running
 *     instance refreshes `beat` every HEARTBEAT_MS and sets `clean` when the page is closed;
 *   - desktop: the main process keeps `recovery/session.json` and reports an unclean previous run
 *     (killed, crashed, power loss) or a renderer crash in this run.
 *
 * recoveryDecision() is the pure rule: offer the record only after an unclean exit (or when the
 * record predates session markers); a marker whose heartbeat is still fresh belongs to another
 * open window, whose document must not be taken over.
 */
import type { MachsimDesktopBridge } from '../../desktop/bridge';
import { AUTOSAVE_KEY, clearAutosave, parseAutosave, readAutosave, writeAutosave, type AutosaveRecord, type KeyValueStorage } from './files';

export const SESSION_KEY = 'machsim.session.v1';
export const HEARTBEAT_MS = 15_000;

export interface SessionMarker {
  id: string;
  /** ms since epoch */
  started: number;
  /** last heartbeat, ms since epoch */
  beat: number;
  /** the session ended normally (page closed / app quit) */
  clean: boolean;
}

/** How the previous session ended: 'unknown' = no marker (first run, or a build without markers). */
export type PreviousSession = 'clean' | 'unclean' | 'unknown' | 'other-instance';

export type RecoveryDecision = 'offer' | 'keep' | 'none';

/**
 * Whether to offer an autosaved record at start-up:
 *   'offer' — a record exists and the previous session did not end normally (or ended before
 *             session markers existed, 'unknown');
 *   'keep'  — a record exists but the previous session was closed normally (the user chose not to
 *             save) or is still running in another window: no prompt, the record stays available
 *             (File > Recover autosaved design);
 *   'none'  — nothing to recover.
 */
export function recoveryDecision(previous: PreviousSession, record: AutosaveRecord | null): RecoveryDecision {
  if (!record) return 'none';
  return previous === 'unclean' || previous === 'unknown' ? 'offer' : 'keep';
}

/** How the session in `marker` ended, seen at `now`. */
export function classifyMarker(marker: SessionMarker | null, now: number, heartbeatMs = HEARTBEAT_MS): PreviousSession {
  if (!marker) return 'unknown';
  if (marker.clean) return 'clean';
  // a heartbeat younger than two periods: that window is probably still open
  return now - marker.beat < 2 * heartbeatMs ? 'other-instance' : 'unclean';
}

export function readMarker(storage: KeyValueStorage | null): SessionMarker | null {
  if (!storage) return null;
  try {
    const m = JSON.parse(storage.getItem(SESSION_KEY) ?? 'null') as Partial<SessionMarker> | null;
    if (!m || typeof m.id !== 'string' || typeof m.started !== 'number' || typeof m.beat !== 'number' || typeof m.clean !== 'boolean') return null;
    return { id: m.id, started: m.started, beat: m.beat, clean: m.clean };
  } catch {
    return null;
  }
}

export function writeMarker(storage: KeyValueStorage | null, marker: SessionMarker): void {
  try {
    storage?.setItem(SESSION_KEY, JSON.stringify(marker));
  } catch {
    /* storage full / disabled: recovery still works through the record itself */
  }
}

/** The recovery slot and session marker of one platform. */
export interface RecoveryStore {
  readonly kind: 'browser' | 'desktop';
  readRecord(): Promise<AutosaveRecord | null>;
  writeRecord(rec: AutosaveRecord): Promise<boolean>;
  clearRecord(): Promise<void>;
  /** how the previous session ended (call once, before startSession) */
  previousSession(now?: number): Promise<PreviousSession>;
  /** mark this session as running */
  startSession(now?: number): void;
  /** heartbeat while running */
  beat(now?: number): void;
  /** mark this session as ended normally */
  endSession(now?: number): void;
}

const parseRecord = parseAutosave;

/** Recovery in browser storage (localStorage, or any KeyValueStorage in tests). */
export function browserRecoveryStore(storage: KeyValueStorage | null, newId: () => string = () => Math.random().toString(36).slice(2)): RecoveryStore {
  let marker: SessionMarker | null = null;
  return {
    kind: 'browser',
    readRecord: async () => readAutosave(storage),
    writeRecord: async (rec) => writeAutosave(storage, rec),
    clearRecord: async () => clearAutosave(storage),
    previousSession: async (now = Date.now()) => classifyMarker(readMarker(storage), now),
    startSession(now = Date.now()) {
      marker = { id: newId(), started: now, beat: now, clean: false };
      writeMarker(storage, marker);
    },
    beat(now = Date.now()) {
      if (!marker) return;
      // another window may have taken the marker over: do not overwrite a newer session
      const cur = readMarker(storage);
      if (cur && cur.id !== marker.id && !cur.clean && cur.started > marker.started) return;
      marker = { ...marker, beat: now, clean: false };
      writeMarker(storage, marker);
    },
    endSession(now = Date.now()) {
      if (!marker) return;
      const cur = readMarker(storage);
      if (cur && cur.id !== marker.id && !cur.clean) return;
      marker = { ...marker, beat: now, clean: true };
      writeMarker(storage, marker);
    },
  };
}

/**
 * Recovery in the desktop user-data folder. The main process tracks the session itself (it sees a
 * kill or crash that the renderer never could); `legacy` is the renderer's localStorage, whose
 * record older desktop builds wrote and which is read (and then cleared) when the folder has none.
 */
export function desktopRecoveryStore(bridge: MachsimDesktopBridge, legacy: KeyValueStorage | null): RecoveryStore {
  const hasIpc = typeof bridge.recoveryRead === 'function' && typeof bridge.recoveryWrite === 'function';
  if (!hasIpc) return browserRecoveryStore(legacy);
  return {
    kind: 'desktop',
    async readRecord() {
      const rec = parseRecord((await bridge.recoveryRead!()) ?? null);
      if (rec) return rec;
      return readAutosave(legacy);
    },
    async writeRecord(rec) {
      try {
        await bridge.recoveryWrite!(JSON.stringify(rec));
        return true;
      } catch {
        return false;
      }
    },
    async clearRecord() {
      try {
        await bridge.recoveryWrite!(null);
      } catch {
        /* nothing to clear */
      }
      if (legacy?.getItem(AUTOSAVE_KEY) !== null) clearAutosave(legacy);
    },
    async previousSession() {
      try {
        const info = await bridge.sessionInfo?.();
        if (!info) return 'unknown';
        return info.uncleanExit ? 'unclean' : 'clean';
      } catch {
        return 'unknown';
      }
    },
    // the main process marks the session running at start-up and clean on a normal quit
    startSession: () => undefined,
    beat: () => undefined,
    endSession: () => undefined,
  };
}
