/**
 * Instrument panels on demand: every panel lives in one chunk (registry.ts and the panel
 * modules) that loads when the first instrument window opens, so the shell starts without them.
 *
 *   const Panel = lazyInstrumentPanel('oscilloscope');   // stable per kind
 *   <Panel {...instrumentPanelProps} />
 *
 * `hasInstrumentPanel(kind)` answers without loading anything (every InstrumentKind listed in
 * titles.ts has a panel; the registry test checks that).
 */
import type { InstrumentKind } from '../../model/types';
import { lazyComponent, type LazyComponent } from '../common/lazy';
import { INSTRUMENT_KINDS } from './titles';
import type { InstrumentPanelProps } from './types';

const cache = new Map<InstrumentKind, LazyComponent<InstrumentPanelProps>>();

/** True when `kind` has a panel. */
export function hasInstrumentPanel(kind: string): kind is InstrumentKind {
  return (INSTRUMENT_KINDS as readonly string[]).includes(kind);
}

/** Lazily loaded panel component of an instrument kind (the same component for every call). */
export function lazyInstrumentPanel(kind: InstrumentKind): LazyComponent<InstrumentPanelProps> {
  let c = cache.get(kind);
  if (!c) {
    c = lazyComponent<InstrumentPanelProps>(() =>
      import('./registry').then((m) => {
        const panel = m.instrumentPanels[kind];
        if (!panel) throw new Error(`no instrument panel for ${kind}`);
        return panel;
      }),
    );
    cache.set(kind, c);
  }
  return c;
}

/** Load every instrument panel now (tests and server-side renders; the app loads on demand). */
export function preloadInstrumentPanels(): Promise<void> {
  return Promise.all(INSTRUMENT_KINDS.map((k) => lazyInstrumentPanel(k).preload())).then(() => undefined);
}
