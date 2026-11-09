/**
 * Component library in the current language.
 *
 * Part definitions (src/library/parts) are written once, in English; this module maps their
 * user-visible strings — group and family names, part names and descriptions, parameter labels,
 * help texts, option labels and interactive labels — to Vietnamese. English is returned when
 * the UI language is English, or (defensively) when a translation is missing; the library test
 * in src/i18n/library.test.ts fails for any missing translation, so new parts must add theirs
 * to library.vi.ts / partDescriptions.vi.ts.
 */
import type { ParamDef, PartDef, PartGroup } from '../library/types';
import { getLang, type LocalizedText } from './core';
import { t } from './index';
import { FAMILY_SEARCH_VI, LIB_TEXT_VI, PART_NAME_VI } from './library.vi';
import { PART_DESC_VI } from './partDescriptions.vi';

const isVi = (): boolean => getLang() === 'vi';

/** Vietnamese text a generated catalogue part carries itself (LibraryPartDef.textVi). */
type ViText = { name?: string; description?: string };

/** Looks a part up by id (installed by src/library/index.ts), for callers that only hold {id, name}. */
let resolvePartText: ((id: string) => object | undefined) | null = null;
export function setPartTextResolver(fn: ((id: string) => object | undefined) | null): void {
  resolvePartText = fn;
}

function ownVi(part: object): ViText | undefined {
  const own = (part as { textVi?: ViText }).textVi;
  if (own) return own;
  // a plain {id, name} (a BOM row) carries no Vietnamese text: take it from the library part
  const id = (part as { id?: unknown }).id;
  const def = resolvePartText && typeof id === 'string' ? resolvePartText(id) : undefined;
  return (def as { textVi?: ViText } | undefined)?.textVi;
}

/** Vietnamese name of a part, if it has one (table or the part's own text). */
export function partNameVi(part: Pick<PartDef, 'id'>): string | undefined {
  return PART_NAME_VI[part.id] ?? ownVi(part)?.name;
}

/** Vietnamese name of a family ("Resistor" -> "Điện trở"), whatever the UI language. */
export function familyNameVi(family: string): string | undefined {
  return LIB_TEXT_VI[family];
}

/** Extra Vietnamese search words of a part's family ("bóng bán dẫn" for BJTs), '' when none. */
export function searchSynonymsVi(part: Pick<PartDef, 'family'>): string {
  return FAMILY_SEARCH_VI[part.family] ?? '';
}

/** Vietnamese description of a part, if it has one (table or the part's own text). */
export function partDescriptionVi(part: Pick<PartDef, 'id'>): string | undefined {
  return PART_DESC_VI[part.id] ?? ownVi(part)?.description;
}

/** Translate one library string (label, help, option, family, interactive label). */
export function libText(english: string): string {
  if (!isVi()) return english;
  return LIB_TEXT_VI[english] ?? english;
}

/** English for the Vietnamese words some part faces and pin labels are drawn with. */
const FACE_TEXT_EN: Record<string, string> = {
  'BĂNG TẢI': 'CONVEYOR',
  'NÚT GIAO': 'JUNCTION',
  'B–N': 'N–S',
  'Đ–T': 'E–W',
  'B–N đỏ': 'N–S red',
  'B–N vàng': 'N–S amber',
  'B–N xanh': 'N–S green',
  'Đ–T đỏ': 'E–W red',
  'Đ–T vàng': 'E–W amber',
  'Đ–T xanh': 'E–W green',
  'BỒN NƯỚC': 'TANK',
  'BƠM': 'PUMP',
  'VAN XẢ': 'DRAIN',
  'CỬA CUỐN': 'GARAGE DOOR',
  'MỞ ▲': 'UP ▲',
  'ĐÓNG ▼': 'DOWN ▼',
  'THANG MÁY': 'LIFT',
  'LÊN ▲': 'UP ▲',
  'XUỐNG ▼': 'DOWN ▼',
  'MỞ CỬA': 'DOOR',
};

/**
 * Text drawn on a part face (a symbol text or a pin label) in the current language. The
 * definitions draw a few faces in Vietnamese ("BỒN NƯỚC", "VÀO 8", "RA 8"); the English UI shows the
 * English words instead. Any other text is returned unchanged.
 */
export function faceText(text: string): string {
  if (isVi()) return text;
  const known = FACE_TEXT_EN[text];
  if (known !== undefined) return known;
  const io = /^(VÀO|RA) (\d+)$/.exec(text);
  return io ? `${io[1] === 'RA' ? 'OUT' : 'IN'} ${io[2]}` : text;
}

export function groupName(group: PartGroup): string {
  return t(`group.${group}`);
}

export function familyName(family: string): string {
  return libText(family || 'General');
}

export function partName(part: Pick<PartDef, 'id' | 'name'>): string {
  return isVi() ? (partNameVi(part) ?? part.name) : part.name;
}

/** Part name in both languages (texts that are built for both at once, e.g. the breadboard guide). */
export function partNameText(part: Pick<PartDef, 'id' | 'name'>): LocalizedText {
  return { vi: partNameVi(part) ?? part.name, en: part.name };
}

const POWER_PINS = /\s*Hidden power pins \((\w+) = (\d+), (\w+) = (\d+)\) on the (\w+) net\.$/;

/** English description without the generated hidden-power-pin sentence, and that sentence's data. */
function splitPowerPins(description: string): { main: string; pins?: RegExpMatchArray } {
  const m = description.match(POWER_PINS);
  return m ? { main: description.slice(0, m.index), pins: m } : { main: description };
}

export function partDescription(part: Pick<PartDef, 'id' | 'description'>): string {
  // blocks (subcircuits / hierarchical blocks) describe their child design
  const block = (part as { block?: { kind: string; ports: unknown[] }; name?: string }).block;
  if (block) return t(block.kind === 'hierarchical' ? 'schematic.block.hb' : 'schematic.block.sc', { name: (part as { name?: string }).name ?? '', n: block.ports.length });
  if (!isVi()) return part.description;
  const vi = partDescriptionVi(part);
  if (!vi) return part.description;
  const { pins } = splitPowerPins(part.description);
  return pins ? `${vi} ${t('library.hiddenPins', { a: pins[1], an: pins[2], b: pins[3], bn: pins[4], net: pins[5] })}` : vi;
}

export function paramLabel(def: Pick<ParamDef, 'label'>): string {
  return libText(def.label);
}

export function paramHelp(def: Pick<ParamDef, 'help'>): string | undefined {
  return def.help === undefined ? undefined : libText(def.help);
}

export function optionLabel(label: string): string {
  return libText(label);
}

export function interactiveLabel(label: string): string {
  return libText(label);
}

/** Every user-visible library string of a part (used by the translation-coverage test). */
export function libraryStrings(part: PartDef): { kind: 'family' | 'label' | 'help' | 'option' | 'interactive'; text: string }[] {
  const out: { kind: 'family' | 'label' | 'help' | 'option' | 'interactive'; text: string }[] = [{ kind: 'family', text: part.family || 'General' }];
  for (const d of part.params) {
    out.push({ kind: 'label', text: d.label });
    if (d.help) out.push({ kind: 'help', text: d.help });
    for (const o of d.options ?? []) out.push({ kind: 'option', text: o.label });
  }
  if (part.interactive) out.push({ kind: 'interactive', text: part.interactive.label });
  return out;
}

/** Text a search box matches against: English and Vietnamese name, family and description. */
export function searchText(part: PartDef): string {
  const vi = [partNameVi(part), partDescriptionVi(part), LIB_TEXT_VI[part.family], FAMILY_SEARCH_VI[part.family]].filter(Boolean).join(' ');
  return `${part.name} ${part.family} ${part.description} ${vi}`;
}
