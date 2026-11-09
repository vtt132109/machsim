/**
 * React hooks shared by the component browser (left panel) and the "Select a component" dialog:
 *
 *   useLibraryParts()               listParts(), re-rendered when the library changes (a catalogue
 *                                   pack finished loading, a part database changed)
 *   useGroupLoading(groups)         load the catalogue packs of the groups that are open (once each)
 *   useCatalogueSearch(parts, q)    search results; small catalogues search synchronously, big
 *                                   ones run an incremental search job in time slices, and a
 *                                   search loads the packs not loaded yet (results then grow)
 *   useIdsLoaded(ids)               load the packs of a list of part ids (favourites, recent)
 *   useIdleIndexing(parts)          build the search index in the background while a browser is
 *                                   open, so the first search answers from a ready index
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ensurePartsLoaded, groupState, hasPendingPacks, libraryVersion, listParts, loadAllGroups, loadGroup, subscribeLibrary } from '../../library';
import type { PartDef } from '../../library/types';
import { createSearchJob, indexParts, searchCatalogue } from './browserModel';

/** Up to this many parts a search runs synchronously (a few milliseconds); above it, in slices. */
export const SYNC_SEARCH_LIMIT = 12000;

/** The library part list, re-rendering when it changes. */
export function useLibraryParts(): PartDef[] {
  useSyncExternalStore(subscribeLibrary, libraryVersion, libraryVersion);
  return listParts();
}

/** Load the catalogue packs of every group in `groups` that is not loaded yet. */
export function useGroupLoading(groups: readonly string[]): void {
  const key = groups.join('\u0001');
  useEffect(() => {
    for (const g of key ? key.split('\u0001') : []) if (groupState(g) === 'pending' || groupState(g) === 'error') void loadGroup(g);
  }, [key]);
}

/** Load the packs holding the given part ids (lists of saved ids: favourites, recent parts). */
export function useIdsLoaded(ids: readonly string[]): void {
  const key = ids.join('\u0001');
  useEffect(() => {
    if (key) void ensurePartsLoaded(key.split('\u0001'));
  }, [key]);
}

/**
 * While a component browser is open, build the search index of `parts` in short slices (6 ms of
 * work, then back to the event loop) until it is ready. Already-indexed parts cost nothing, so a
 * new catalogue pack only indexes its own parts. Indexing a 60,000-part database this way takes a
 * few seconds of idle time and never holds the UI for more than one animation frame.
 */
export function useIdleIndexing(parts: readonly PartDef[], enabled = true): void {
  useEffect(() => {
    if (!enabled || parts.length === 0) return;
    let pos = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      timer = null;
      pos = indexParts(parts, pos, 6);
      if (pos < parts.length) timer = setTimeout(tick, 0);
    };
    timer = setTimeout(tick, 0);
    return () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
  }, [parts, enabled]);
}

export interface CatalogueSearch {
  results: PartDef[];
  /** an incremental search is still scanning (0…1 = progress) */
  progress: number | null;
  /** catalogue packs are loading because of the search: more results may follow */
  loadingMore: boolean;
}

/** Search `parts` for `query` without blocking the UI (see the module header). */
export function useCatalogueSearch(parts: readonly PartDef[], query: string): CatalogueSearch {
  const active = query.trim().length > 0;
  const big = parts.length > SYNC_SEARCH_LIMIT;
  const syncResults = useMemo(() => (active && !big ? searchCatalogue(parts, query) : null), [parts, query, active, big]);
  const [job, setJob] = useState<{ results: PartDef[]; progress: number | null }>({ results: [], progress: null });
  const pending = useSyncExternalStore(subscribeLibrary, hasPendingPacks, hasPendingPacks);

  // a search covers the whole catalogue: load the packs not opened yet (one after the other)
  useEffect(() => {
    if (active && pending) void loadAllGroups();
  }, [active, pending]);

  useEffect(() => {
    if (!active || !big) return;
    const j = createSearchJob(parts, query);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = () => {
      if (cancelled) return;
      const done = j.step(10);
      setJob({ results: j.results(), progress: done ? null : j.progress });
      if (!done) timer = setTimeout(tick, 0);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [parts, query, active, big]);

  if (!active) return { results: [], progress: null, loadingMore: false };
  if (syncResults) return { results: syncResults, progress: null, loadingMore: pending };
  return { results: job.results, progress: job.progress, loadingMore: pending };
}
