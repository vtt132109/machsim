/**
 * The glossary of MachSim's Vietnamese: one name for one idea.
 *
 * A learner who meets "dụng cụ đo" on one page and "thiết bị đo" on the next starts to wonder
 * whether they are two things. Each entry below fixes the word the interface, the help, the
 * lessons and the samples use (`use`) and lists the spellings and synonyms that must not appear in
 * a Vietnamese text (`avoid`). `src/i18n/glossary.test.ts` is the scanner: it walks every text table
 * of src/i18n (menus, dialogs, help guides, lessons, sample notes ...) and fails with the table, the
 * key and the offending words, so a new text is checked the day it is written.
 *
 * Adding a term: put the concept, the word to use, the patterns to avoid (and, where a legitimate
 * use of the avoided word exists, make the pattern skip it with a look-ahead), run the scanner, and
 * fix what it finds. Terms for which two words really are two ideas are listed in `distinct` so
 * nobody "fixes" them: "thông số" (a datasheet figure) is not "tham số" (a parameter), "tờ" is a
 * physical sheet of paper and "trang" a sheet of the schematic.
 */

export interface GlossaryTerm {
  /** the idea, in English (what the English UI calls it) */
  concept: string;
  /** the Vietnamese word the program uses */
  use: string;
  /** Vietnamese spellings and synonyms that must not appear (case-sensitive patterns) */
  avoid: readonly RegExp[];
  /** why, for the person who has to choose */
  note?: string;
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  { concept: 'instrument (virtual measuring device)', use: 'thiết bị đo', avoid: [/[Dd]ụng cụ đo/], note: 'the component group is called "Thiết bị đo"' },
  { concept: 'oscilloscope', use: 'dao động ký', avoid: [/[Mm]áy hiện sóng/, /dao động kí\b/], note: 'the instrument kind id "oscilloscope" in a code example is not a word of the text' },
  { concept: 'microphone', use: 'micrô', avoid: [/\bmicro\b(?! giây)/, /\bmic\b/], note: '"Micro" in the list of USB plug types is a proper name and starts with a capital' },
  { concept: 'contactor', use: 'công-tắc-tơ', avoid: [/công tắc tơ/i, /\bcontactor\b/], note: 'with hyphens, as the library names its parts: "Cuộn công-tắc-tơ", "Tiếp điểm công-tắc-tơ"' },
  { concept: 'relay', use: 'rơ-le', avoid: [/\brơle\b/i, /\brelay\b/], note: 'with the hyphen, as in the part names' },
  { concept: 'circuit breaker (MCB)', use: 'áp-tô-mát', avoid: [/\baptomat\b/i, /áp tô mát/i] },
  { concept: 'clipboard', use: 'bộ nhớ tạm', avoid: [/(?<!API )\bclipboard\b/i], note: '"API Clipboard" of a browser is a proper name' },
  { concept: 'tab of a window or panel', use: 'thẻ', avoid: [/\btab\b/], note: 'the key Tab is written with a capital: Ctrl+Tab' },
  { concept: 'assembly variant', use: 'phương án', avoid: [/\bbiến thể\b/i, /(?<![{(“])\bvariant\b(?![})”])/], note: '"(variant)" as a gloss after the first mention and the placeholder {variant} are fine' },
  { concept: 'push-button', use: 'nút nhấn', avoid: [/nút bấm/i] },
  { concept: 'subcircuit', use: 'mạch con', avoid: [/\bsubcircuit\b/i], note: 'the SPICE card .SUBCKT is written as a card, not as a word' },
  { concept: 'script (JavaScript program)', use: 'tập lệnh', avoid: [/kịch bản/i, /(?<![-\w])script(?![\w.])/] },
  { concept: 'breakpoint', use: 'điểm dừng', avoid: [/\bbreakpoint\b/i] },
  { concept: 'debugging', use: 'gỡ lỗi', avoid: [/\bdebug(?:ging)?\b/i, /sửa lỗi chương trình/i] },
  { concept: 'state of charge', use: 'mức điện tích', avoid: [/trạng thái điện tích/i], note: 'the node V(BT1.soc) is a name, not a word of the text' },
  { concept: 'hand-out', use: 'phiếu bài tập', avoid: [/\bhand-?out\b/i, /tài liệu phát/i] },
  { concept: 'print preview', use: 'xem trước khi in', avoid: [/\bprint preview\b/i] },
  { concept: 'battery', use: 'pin', avoid: [/\bbattery\b/i] },
  { concept: 'speaker', use: 'loa', avoid: [/\bspeaker\b/i] },
];

/**
 * Pairs of words that look like synonyms but are two ideas. The scanner does not look for them;
 * the table is here so the next editor does not "unify" them.
 */
export const DISTINCT: readonly { words: readonly [string, string]; difference: string }[] = [
  { words: ['tham số', 'thông số'], difference: '"tham số" is a parameter you can change (value, Rx); "thông số" is a figure from a datasheet or a specification table' },
  { words: ['trang', 'tờ'], difference: '"trang" is a sheet of the schematic; "tờ" is a physical sheet of paper in the print preview' },
  { words: ['cuộn hút', 'cuộn dây'], difference: '"cuộn hút" is the coil of a relay or contactor; "cuộn dây" is the output coil of a ladder rung' },
  { words: ['công-tắc-tơ', 'khởi động từ'], difference: '"công-tắc-tơ" is the switching device (coil and contacts); "khởi động từ" is the motor starter family: a contactor plus an overload relay' },
  { words: ['tinh thể', 'thạch anh'], difference: '"tinh thể lỏng" is the liquid crystal of an LCD; "thạch anh" is the clock crystal' },
];

/** The terms a Vietnamese text breaks: [concept, the word found, the word to use]. */
export function glossaryViolations(text: string): { concept: string; found: string; use: string }[] {
  const out: { concept: string; found: string; use: string }[] = [];
  for (const term of GLOSSARY) {
    for (const rx of term.avoid) {
      const m = rx.exec(text);
      if (m) {
        out.push({ concept: term.concept, found: m[0], use: term.use });
        break;
      }
    }
  }
  return out;
}
