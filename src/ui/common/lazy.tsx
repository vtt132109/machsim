/**
 * Code splitting helpers: big, rarely-first-needed UI (instrument panels, the Grapher, the
 * analysis setup dialog, the help browser) lives in chunks that load on first use, so the
 * start-up bundle stays small.
 *
 *   const Grapher = lazyComponent(() => import('./Grapher').then((m) => m.Grapher));
 *   <Grapher {...props} />            // shows "Đang tải…" for the moment the chunk loads
 *   await Grapher.preload();          // load ahead (later mounts render synchronously)
 *
 * Once the chunk is loaded, new instances render the component directly (no Suspense
 * fallback, and server-side renders in tests see the real content after `preload()`); an
 * instance that mounted while loading keeps its React.lazy wrapper so its state is never reset.
 * A chunk that fails to load throws inside the enclosing ErrorBoundary (floating windows and dock
 * tabs have one, with "Try again"); the failure is not cached, so the next mount retries.
 */
import { createElement, lazy, Suspense, useState, type ComponentType } from 'react';
import { t } from '../../i18n';

/** Placeholder shown while a lazily loaded part of the UI loads. */
export function LoadingPane() {
  return (
    <div className="ms-empty ms-loading" role="status" aria-live="polite">
      {t('common.loading')}
    </div>
  );
}

export type LazyComponent<P> = ComponentType<P> & {
  /** Load the implementation now (resolves when it can render synchronously). */
  preload: () => Promise<void>;
};

/** A component that loads its implementation (`load`) on first render or on preload(). */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>): LazyComponent<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const loadOnce = () => {
    pending ??= load().then(
      (c) => {
        loaded = c;
        return { default: c };
      },
      (e: unknown) => {
        pending = null;
        throw e;
      },
    );
    return pending;
  };
  const Lazy = lazy(loadOnce) as unknown as ComponentType<P>;
  function LazyLoaded(props: P) {
    // decided once per instance: switching wrappers later would remount the component
    const [direct] = useState(() => loaded);
    if (direct) return createElement(direct, props);
    return <Suspense fallback={<LoadingPane />}>{createElement(Lazy, props)}</Suspense>;
  }
  return Object.assign(LazyLoaded, { preload: () => loadOnce().then(() => undefined) });
}
