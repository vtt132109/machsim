import { describe, expect, it } from 'vitest';
import type { MachsimDesktopBridge } from '../../desktop/bridge';
import { AUTOSAVE_KEY, type KeyValueStorage } from './files';
import { browserRecoveryStore, classifyMarker, desktopRecoveryStore, HEARTBEAT_MS, readMarker, recoveryDecision, SESSION_KEY } from './recovery';

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const rec = { fileName: 'Amp.msim', savedAt: 1000, text: '{"format":"machsim-design"}' };

describe('crash recovery rules', () => {
  it('offers a record only after an unclean exit (or without a session marker)', () => {
    expect(recoveryDecision('unclean', rec)).toBe('offer');
    expect(recoveryDecision('unknown', rec)).toBe('offer');
    expect(recoveryDecision('clean', rec)).toBe('keep');
    expect(recoveryDecision('other-instance', rec)).toBe('keep');
    expect(recoveryDecision('unclean', null)).toBe('none');
  });

  it('classifies a marker by its clean flag and heartbeat age', () => {
    const m = { id: 'a', started: 0, beat: 100_000, clean: false };
    expect(classifyMarker(null, 0)).toBe('unknown');
    expect(classifyMarker({ ...m, clean: true }, 10_000_000)).toBe('clean');
    expect(classifyMarker(m, 100_000 + 2 * HEARTBEAT_MS - 1)).toBe('other-instance');
    expect(classifyMarker(m, 100_000 + 2 * HEARTBEAT_MS)).toBe('unclean');
  });

  it('browser store: a session killed without closing is unclean at the next start', async () => {
    const st = new MemoryStorage();
    let n = 0;
    const first = browserRecoveryStore(st, () => `s${++n}`);
    expect(await first.previousSession(0)).toBe('unknown');
    first.startSession(1_000);
    first.beat(16_000);
    expect(await first.writeRecord(rec)).toBe(true);
    // the tab is killed: no endSession. Next start, long after the last heartbeat:
    const second = browserRecoveryStore(st, () => `s${++n}`);
    expect(await second.previousSession(600_000)).toBe('unclean');
    expect(recoveryDecision(await second.previousSession(600_000), await second.readRecord())).toBe('offer');
    // a normal close is clean
    second.startSession(600_000);
    second.endSession(601_000);
    expect(readMarker(st)).toMatchObject({ id: 's2', clean: true });
    const third = browserRecoveryStore(st);
    expect(recoveryDecision(await third.previousSession(700_000), await third.readRecord())).toBe('keep');
    await third.clearRecord();
    expect(st.data.has(AUTOSAVE_KEY)).toBe(false);
    expect(recoveryDecision(await third.previousSession(700_000), await third.readRecord())).toBe('none');
  });

  it('browser store: a second window does not take over a live session marker', async () => {
    const st = new MemoryStorage();
    const a = browserRecoveryStore(st, () => 'a');
    a.startSession(0);
    const b = browserRecoveryStore(st, () => 'b');
    expect(await b.previousSession(5_000)).toBe('other-instance');
    b.startSession(5_000);
    // the older window's heartbeat and close leave the newer marker alone
    a.beat(15_000);
    a.endSession(20_000);
    expect(JSON.parse(st.getItem(SESSION_KEY)!)).toMatchObject({ id: 'b', clean: false });
  });

  it('desktop store: reads the user-data slot, falls back to the old localStorage record once', async () => {
    let slot: string | null = null;
    const legacy = new MemoryStorage();
    legacy.setItem(AUTOSAVE_KEY, JSON.stringify(rec));
    const bridge = {
      recoveryRead: async () => slot,
      recoveryWrite: async (t: string | null) => {
        slot = t;
      },
      sessionInfo: async () => ({ uncleanExit: true }),
    } as unknown as MachsimDesktopBridge;
    const store = desktopRecoveryStore(bridge, legacy);
    expect(store.kind).toBe('desktop');
    expect(await store.previousSession()).toBe('unclean');
    expect(await store.readRecord()).toEqual(rec);
    await store.writeRecord({ ...rec, fileName: 'New.msim' });
    expect(JSON.parse(slot!).fileName).toBe('New.msim');
    expect((await store.readRecord())!.fileName).toBe('New.msim');
    await store.clearRecord();
    expect(slot).toBeNull();
    expect(legacy.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(await store.readRecord()).toBeNull();
  });

  it('desktop builds without the recovery IPC keep using browser storage', () => {
    expect(desktopRecoveryStore({} as MachsimDesktopBridge, new MemoryStorage()).kind).toBe('browser');
  });
});
