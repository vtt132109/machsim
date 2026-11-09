/**
 * Per-user component-browser preferences: favourite parts and the recently used parts.
 *
 * Kept in browser storage (a per-viewer convenience: losing it only empties the two lists);
 * every access is guarded, so private windows or blocked storage simply start empty. The recent
 * list holds the last RECENT_MAX part ids, most recent first.
 */
import { useSyncExternalStore } from 'react';

const FAV_KEY = 'machsim.library.favourites.v1';
const RECENT_KEY = 'machsim.library.recent.v1';
export const RECENT_MAX = 20;

export interface LibraryPrefs {
  favourites: readonly string[];
  recent: readonly string[];
}

function load(key: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function save(key: string, list: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(list));
  } catch {
    // storage unavailable: the list lives for this session only
  }
}

let state: LibraryPrefs | null = null;
const listeners = new Set<() => void>();

function current(): LibraryPrefs {
  state ??= { favourites: load(FAV_KEY), recent: load(RECENT_KEY) };
  return state;
}

function set(next: LibraryPrefs): void {
  state = next;
  save(FAV_KEY, next.favourites);
  save(RECENT_KEY, next.recent);
  for (const l of listeners) l();
}

export function getLibraryPrefs(): LibraryPrefs {
  return current();
}

export function subscribeLibraryPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isFavourite(partId: string): boolean {
  return current().favourites.includes(partId);
}

export function toggleFavourite(partId: string): void {
  const s = current();
  set({ ...s, favourites: s.favourites.includes(partId) ? s.favourites.filter((x) => x !== partId) : [...s.favourites, partId] });
}

/** Move a part to the front of the recent list. */
export function recordRecent(partId: string): void {
  const s = current();
  if (s.recent[0] === partId) return;
  set({ ...s, recent: [partId, ...s.recent.filter((x) => x !== partId)].slice(0, RECENT_MAX) });
}

export function clearRecent(): void {
  set({ ...current(), recent: [] });
}

/** Replace both lists (library profile import); the recent list keeps at most RECENT_MAX ids. */
export function replaceLibraryPrefs(next: LibraryPrefs): void {
  set({ favourites: [...new Set(next.favourites)], recent: [...new Set(next.recent)].slice(0, RECENT_MAX) });
}

/** Forget the cached state (tests). */
export function resetLibraryPrefs(): void {
  state = null;
  for (const l of listeners) l();
}

export function useLibraryPrefs(): LibraryPrefs {
  return useSyncExternalStore(subscribeLibraryPrefs, getLibraryPrefs, getLibraryPrefs);
}
