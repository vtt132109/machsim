/**
 * Shipped samples in the UI language.
 *
 * The files in examples/ store a canonical English title and the default sheet names ("Sheet 1"),
 * because the sample builders and `tests/examples.test.ts` are written in one language and the
 * sample browser shows the Vietnamese / English texts of src/i18n/samples.ts instead. A learner
 * who opens such a file should still read "Cầu phân áp" and "Trang 1", so:
 *
 *   localizeSample(design, title)                    // title + sheet names in the UI language
 *   localizeNotes(design, pairs)                     // sheet notes in English (the files keep Vietnamese)
 *   await localizeOpenedSample(design, 'x.msim')     // the same, for a file of examples/
 *
 * `localizeOpenedSample` is registered with `registerOpenTransform` (src/ui/integration), so every
 * open route — the sample browser, File > Open, a drop, the Explorer, a recent entry — shows the
 * same thing.
 *
 * A file is taken for a shipped sample when its name looks like one ("07-cmos-inverter.msim") AND
 * the sample text table has an entry under that name. The table (src/i18n/samples.ts) is loaded ON
 * DEMAND and only then, so opening an ordinary design costs one regular-expression test. This
 * module deliberately does not import the sample catalogue (src/ui/integration/examples.ts): its
 * chunk carries the text of all 45 sample designs through `import.meta.glob`, and using it from an
 * eagerly loaded module would put them all in the start-up bundle.
 */
import type { Design } from '../../model/types';
import { getLang, t, tr } from '../../i18n';
import type { NotePair } from '../../i18n/sampleNotes';

/** How the shipped samples are named: a two-digit number, a slug and .msim. */
const SAMPLE_NAME_RE = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.msim$/i;

/** The file name without its folder. */
const baseName = (fileName: string): string => fileName.replace(/^.*[\\/]/, '');

/** Cheap check (nothing loaded) that a file name could be one of the shipped samples. */
export const looksLikeSample = (fileName: string): boolean => SAMPLE_NAME_RE.test(baseName(fileName));

/**
 * Key of a sample in the text tables ("01-voltage-divider.msim" -> "01_voltage_divider"). The same
 * rule as `sampleKey` in examples.ts, repeated here so this module stays free of that chunk.
 */
export function sampleTextKey(fileName: string): string {
  return baseName(fileName)
    .replace(/\.msim$/i, '')
    .replace(/[^A-Za-z0-9]+/g, '_');
}

/** Default sheet name in the UI language ("Sheet 3" -> "Trang 3", "Ladder 1" -> "Bậc thang 1"). */
export function localizeSheetName(name: string): string {
  const m = /^Sheet (\d+)$/.exec(name);
  if (m) return t('sheet.default', { n: Number(m[1]) });
  const l = /^Ladder (\d+)$/.exec(name);
  return l ? t('ladder.sheet.default', { n: Number(l[1]) }) : name;
}

/**
 * A sample design in the UI language: its title is the localized sample title and default sheet
 * names ("Sheet 1") become the UI language's ("Trang 1"), in the root and every child design.
 */
export function localizeSample(design: Design, title: string): Design {
  return {
    ...design,
    title,
    sheets: design.sheets.map((s) => ({ ...s, name: localizeSheetName(s.name) })),
    ...(design.children ? { children: design.children.map((c) => ({ ...c, sheets: c.sheets.map((s) => ({ ...s, name: localizeSheetName(s.name) })) })) } : {}),
  };
}

/**
 * The design with the sheet notes that appear in `pairs` replaced by their English text (the sample
 * files keep Vietnamese notes). A note is replaced only when it still has exactly the stored
 * Vietnamese text, so a note the learner wrote or edited is never touched. Returns the same object
 * when nothing changes.
 */
export function localizeNotes(design: Design, pairs: readonly NotePair[] | undefined): Design {
  if (!pairs || pairs.length === 0) return design;
  const english = new Map(pairs.map(([vi, en]) => [vi, en] as const));
  let changed = false;
  const sheets = (list: Design['sheets']): Design['sheets'] =>
    list.map((s) => {
      if (!s.notes.some((n) => english.has(n.text))) return s;
      changed = true;
      return { ...s, notes: s.notes.map((n) => (english.has(n.text) ? { ...n, text: english.get(n.text) as string } : n)) };
    });
  const root = sheets(design.sheets);
  const children = design.children?.map((c) => ({ ...c, sheets: sheets(c.sheets) }));
  return changed ? { ...design, sheets: root, ...(children ? { children } : {}) } : design;
}

/**
 * The notes of a shipped sample in both languages, but only when the interface is English (the
 * files already hold the Vietnamese text): the table is a lazy chunk nobody loads in Vietnamese.
 */
export async function sampleNotePairs(fileName: string): Promise<readonly NotePair[] | undefined> {
  if (getLang() !== 'en' || !looksLikeSample(fileName)) return undefined;
  const { SAMPLE_NOTES } = await import('../../i18n/sampleNotes');
  return SAMPLE_NOTES[sampleTextKey(fileName)];
}

/**
 * The title of the shipped sample a file name belongs to, in both languages; undefined when the
 * name is not a shipped sample. Loads the text table on demand.
 */
export async function sampleTitles(fileName: string): Promise<{ key: string; vi: string; en: string } | undefined> {
  if (!looksLikeSample(fileName)) return undefined;
  const key = sampleTextKey(fileName);
  const { SAMPLE_TEXT } = await import('../../i18n/samples');
  const text = SAMPLE_TEXT[key];
  return text ? { key, vi: text.title.vi, en: text.title.en } : undefined;
}

/**
 * The localized form of a design opened from `fileName`, or the design unchanged when the file is
 * not one of the shipped samples (or already carries the sample's title in one of the languages).
 */
export async function localizeOpenedSample(design: Design, fileName: string): Promise<Design> {
  if (!looksLikeSample(fileName)) return design;
  const titles = await sampleTitles(fileName);
  if (!titles) return design;
  const want = tr({ vi: titles.vi, en: titles.en });
  const notes = await sampleNotePairs(fileName);
  if (design.title === want && design.sheets.every((s) => s.name === localizeSheetName(s.name))) return localizeNotes(design, notes);
  return localizeNotes(localizeSample(design, want), notes);
}
