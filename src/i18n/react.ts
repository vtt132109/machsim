/**
 * React bindings of the i18n module.
 *
 *   const lang = useLang();      // re-renders the component when the language changes
 *   <LanguageRoot>…</LanguageRoot>  // remounts its subtree on a language switch
 *
 * The app shell wraps everything in LanguageRoot, so plain t() calls during render are always
 * current; useLang() is for components that must react without a remount (none in the shell).
 */
import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { getLang, subscribeLang, type Lang } from './core';

export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}

/**
 * Renders its children keyed by the current language: switching the language remounts the
 * subtree so every t() call is evaluated again. Application state lives in stores, so nothing
 * the user did is lost (only transient widget state such as an open dropdown).
 */
export function LanguageRoot({ children }: { children: ReactNode }) {
  const lang = useLang();
  return createElement(Fragment, { key: lang }, children);
}
