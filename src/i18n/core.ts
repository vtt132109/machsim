/**
 * Language state of MachSim (no React, no catalogue): the current UI language, change
 * notifications and the {vi, en} pair helpers used by modules that build both languages at once
 * (breadboard checks, help pages, library translations).
 *
 * Vietnamese is the default. The shell restores the saved choice from the preferences before the
 * first render (src/ui/app/prefs.ts) and switches with setLang(); React components re-render
 * through useLang() (src/i18n/react.ts).
 */

export type Lang = 'vi' | 'en';

/** Every supported language, in menu order. */
export const LANGS: readonly Lang[] = ['vi', 'en'];

/** Name of each language written in that language (language menus show these). */
export const LANG_NAMES: Record<Lang, string> = { vi: 'Tiếng Việt', en: 'English' };

export interface LocalizedText {
  vi: string;
  en: string;
}

/** A {vi, en} pair. */
export const L = (vi: string, en: string): LocalizedText => ({ vi, en });

export function isLang(value: unknown): value is Lang {
  return value === 'vi' || value === 'en';
}

let current: Lang = 'vi';
const listeners = new Set<() => void>();

/** Current UI language. */
export function getLang(): Lang {
  return current;
}

/** Switch the UI language (no-op when unchanged); listeners run synchronously. */
export function setLang(lang: Lang): void {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  for (const l of Array.from(listeners)) l();
}

/** Listen to language changes; returns the unsubscribe function. */
export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** BCP 47 locale of a UI language, for dates and times (numbers stay in SPICE notation). */
export function localeTag(lang: Lang = current): string {
  return lang === 'en' ? 'en-US' : 'vi-VN';
}

/** Pick one language of a {vi, en} pair (default: the current language). */
export function tr(text: LocalizedText, lang: Lang = current): string {
  return lang === 'en' ? text.en : text.vi;
}

/**
 * Substitute `{name}` placeholders. English plural groups `{name|one|other}` choose by
 * Number(params[name]) === 1 (Vietnamese has no plural forms and never needs them).
 */
export function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text
    .replace(/\{(\w+)\|([^|{}]*)\|([^{}]*)\}/g, (all, k: string, one: string, other: string) => (k in params ? (Number(params[k]) === 1 ? one : other) : all))
    .replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all));
}

/** Join list items for a sentence: "a, b và c" / "a, b and c". */
export function joinList(items: readonly string[], lang: Lang = current): string {
  if (items.length <= 1) return items.join('');
  const and = lang === 'vi' ? ' và ' : ' and ';
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1]}`;
}
