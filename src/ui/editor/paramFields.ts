/**
 * Pure helpers for the part properties editor: grouping ParamDefs into tabs, validating user
 * input and formatting previews.
 *
 * Number parameters use the user-number syntax of src/util/units.ts (M = mega, m = milli, "meg",
 * u/µ = micro, trailing unit words ignored; the Vietnamese decimal comma "4,7k" and the RKM code
 * "4k7" both mean 4.7k). Text with something unreadable after the number ("4.7.3k", "1,2,3") is
 * refused instead of being cut short. A value written as an expression in braces ("{2*Rload}")
 * is accepted as-is and left to the netlister (design variables).
 */
import type { ParamDef } from '../../library/types';
import { formatEng, parseUserNumber, userNumberLeftover } from '../../util/units';
import { lazyRecord, t } from '../../i18n';
import { optionLabel } from '../../i18n/library';

export type ParamGroup = NonNullable<ParamDef['group']>;

export const PARAM_GROUP_ORDER: ParamGroup[] = ['value', 'model', 'waveform', 'advanced', 'display'];

/** Tab titles of the parameter groups (current language). */
export const PARAM_GROUP_LABEL: Readonly<Record<ParamGroup, string>> = lazyRecord(PARAM_GROUP_ORDER, (g) => t(`editor.paramGroup.${g}`));

export interface ParamTab {
  group: ParamGroup;
  label: string;
  params: ParamDef[];
}

/** Non-empty parameter tabs in canonical order (params without a group go to "value"). */
export function groupParams(defs: readonly ParamDef[]): ParamTab[] {
  const byGroup = new Map<ParamGroup, ParamDef[]>();
  for (const d of defs) {
    const g = d.group ?? 'value';
    const list = byGroup.get(g);
    if (list) list.push(d);
    else byGroup.set(g, [d]);
  }
  return PARAM_GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, label: PARAM_GROUP_LABEL[g], params: byGroup.get(g)! }));
}

/** True for a brace expression such as "{Rload*2}". */
export function isExpression(text: string): boolean {
  const t = text.trim();
  return t.length > 2 && t.startsWith('{') && t.endsWith('}');
}

const BOOL_VALUES = new Set(['true', 'false']);

function boundText(v: number, unit?: string): string {
  return formatEng(v, unit ?? '');
}

/** Validation message for a parameter text, or null when the value is acceptable. */
export function validateParamText(def: ParamDef, text: string): string | null {
  const txt = text.trim();
  switch (def.kind) {
    case 'number': {
      if (!txt) return t('editor.paramFields.enterAValue');
      if (isExpression(txt)) return null;
      const v = parseUserNumber(txt);
      if (Number.isNaN(v)) return t('editor.paramFields.notANumberExamples4');
      if (!Number.isFinite(v)) return t('editor.paramFields.valueMustBeFinite');
      const rest = userNumberLeftover(txt);
      if (rest) return t('editor.paramFields.unreadText', { rest, value: formatEng(v, def.unit ?? '') });
      if (def.min !== undefined && v < def.min) return t('editor.paramFields.mustBeAtLeastBoundtext', { boundText: boundText(def.min, def.unit) });
      if (def.max !== undefined && v > def.max) return t('editor.paramFields.mustBeAtMostBoundtext', { boundText: boundText(def.max, def.unit) });
      return null;
    }
    case 'select':
      if (def.options && def.options.length > 0 && !def.options.some((o) => o.value === txt)) return t('editor.paramFields.chooseOneOfTheListed');
      return null;
    case 'bool':
      return BOOL_VALUES.has(txt) ? null : t('editor.paramFields.mustBeTrueOrFalse');
    case 'text':
      return null;
  }
}

/**
 * Engineering-notation preview of a number parameter ("4.7 kΩ"), or '' when the text is not a
 * plain number (expressions, invalid input, non-number kinds).
 */
export function paramPreview(def: ParamDef, text: string): string {
  if (def.kind !== 'number' || isExpression(text)) return '';
  const v = parseUserNumber(text);
  if (!Number.isFinite(v) || userNumberLeftover(text)) return '';
  return formatEng(v, def.unit ?? '');
}

/**
 * A parameter value as the learner reads it (reports, printouts): the name of the chosen option for
 * a list ("sườn lên", not "rising"), yes / no for a switch, "159 nF" for a number, else the text
 * with its unit.
 */
export function paramDisplay(def: ParamDef, text: string): string {
  if (def.kind === 'select') {
    const o = def.options?.find((x) => x.value === text);
    return o ? optionLabel(o.label) : text;
  }
  if (def.kind === 'bool') return text === 'true' ? t('common.yes') : text === 'false' ? t('common.no') : text;
  const preview = paramPreview(def, text);
  if (preview) return preview;
  return def.unit && text !== '' ? `${text} ${def.unit}` : text;
}

/** Effective text of a parameter on an instance (instance value or library default). */
export function paramValue(def: ParamDef, params: Record<string, string>): string {
  return params[def.key] ?? def.default;
}

/** True when the instance value differs from the library default. */
export function isParamModified(def: ParamDef, params: Record<string, string>): boolean {
  const v = params[def.key];
  return v !== undefined && v !== def.default;
}

/** Valid net-label name: non-empty, no whitespace. */
export function validateNetName(name: string): string | null {
  const txt = name.trim();
  if (!txt) return t('editor.paramFields.enterANetName');
  if (/\s/.test(txt)) return t('editor.paramFields.netNamesCannotContainSpaces');
  return null;
}

/** Valid CSS hex colour (#rgb or #rrggbb). */
export function isHexColor(text: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(text.trim());
}
