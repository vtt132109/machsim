/**
 * MachSim internationalisation: Vietnamese (default) and English.
 *
 *   import { t } from '../../i18n';
 *   t('common.close')                         // "Đóng" / "Close"
 *   t('app.commands.deleteNameAndItsCount', { name, count })
 *
 * Messages live in src/i18n/messages/<section>.ts as `key: [vi, en]`; MessageKey is the union of
 * every key, so a typo is a compile error. Placeholders are `{name}`; English plural groups are
 * `{n|one|other}`. Numbers passed in params must already be formatted (formatEng / formatValue
 * keep SPICE engineering notation with a '.' decimal point in both languages).
 *
 * Other entry points:
 *   - src/i18n/core.ts      language state, LocalizedText {vi, en}, tr(), joinList()
 *   - src/i18n/react.ts     useLang(), LanguageRoot
 *   - src/i18n/library.ts   component library translations (groups, families, parameters …)
 *   - src/i18n/help.ts      learner help pages (getting started, "What is this?")
 *   - src/i18n/breadboard.ts  breadboard texts (LocalizedText templates)
 *   - src/i18n/desktop-strings.json  native dialogs of the Electron shell
 */
import { getLang, interpolate, type Lang } from './core';
import { MESSAGES } from './messages';

export * from './core';

export type MessageKey = keyof typeof MESSAGES;
export type MessageParams = Record<string, string | number>;

/** Translate a message key into the current language. Unknown keys return the key itself. */
export function t(key: MessageKey, params?: MessageParams): string {
  return tIn(getLang(), key, params);
}

/** Translate into an explicit language. */
export function tIn(lang: Lang, key: MessageKey, params?: MessageParams): string {
  const entry = (MESSAGES as Record<string, readonly [string, string]>)[key];
  if (!entry) return key;
  return interpolate(lang === 'en' ? entry[1] : entry[0], params);
}

/** True for a known message key (dynamic keys built at run time). */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(MESSAGES, key);
}

/** Translate a key computed at run time; falls back to `fallback` (default: the key). */
export function tDynamic(key: string, params?: MessageParams, fallback?: string): string {
  return hasMessage(key) ? t(key, params) : (fallback ?? key);
}

/**
 * A read-only record whose values are computed on every read (enumerable getters), so module-level
 * label tables such as ANALYSIS_LABELS always answer in the current language.
 */
export function lazyRecord<K extends string>(keys: readonly K[], get: (key: K) => string): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of keys) Object.defineProperty(out, k, { get: () => get(k), enumerable: true });
  return out;
}
