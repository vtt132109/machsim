/**
 * Display text of catalogue specifications (LibraryPartDef.specs) in the current language:
 * labels from the i18n catalogue (`spec.<key>`), numbers in SPICE engineering notation with the
 * spec's unit, known text values translated (`specValue.<value>`).
 */
import type { PartDef } from '../../library/types';
import { SPEC_DEFS, isSpecKey, partSpecs } from '../../library/specs';
import { tDynamic } from '../../i18n';
import { formatEng } from '../../util/units';

export function specLabel(key: string): string {
  return tDynamic(`spec.${key}`, undefined, key);
}

export function specValueText(key: string, value: number | string): string {
  if (typeof value === 'string') return tDynamic(`specValue.${value}`, undefined, value);
  if (!isSpecKey(key)) return String(value);
  const unit = SPEC_DEFS[key].unit;
  if (key === 'positions' || key === 'words' || key === 'bits') return String(value);
  if (unit === 'mm' || unit === 'rpm' || unit === '%') return `${Number(value.toPrecision(4))} ${unit}`;
  return formatEng(value, unit, 3);
}

/** Specification rows of a part in SPEC_DEFS order (label, value text). */
export function specRows(part: PartDef, max = 8): { key: string; label: string; value: string }[] {
  const s = partSpecs(part);
  const out: { key: string; label: string; value: string }[] = [];
  for (const key of Object.keys(SPEC_DEFS)) {
    const v = s[key];
    if (v === undefined || v === '') continue;
    out.push({ key, label: specLabel(key), value: specValueText(key, v) });
    if (out.length >= max) break;
  }
  return out;
}
