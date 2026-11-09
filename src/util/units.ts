/**
 * Number parsing / formatting with engineering suffixes.
 *
 * CONTRACT FILE — semantics are fixed; additive helpers allowed.
 *
 * Two parsers with DIFFERENT 'M' semantics, on purpose:
 *  - parseSpiceNumber: SPICE netlist rules, case-INsensitive. M/m = milli, MEG = mega, MIL = 25.4e-6.
 *  - parseUserNumber: what people type in property fields. Case-sensitive single letters:
 *      M = mega, m = milli; "meg"/"Meg"/"MEG" = mega; u or µ = micro; k/K = kilo.
 *    It also reads the two ways values are written on Vietnamese (and many European) parts lists:
 *      - a decimal COMMA: "4,7k" = 4.7k, "2,2u" = 2.2µ, "0,5" = 0.5 (one comma between digits);
 *      - the RKM code of IEC 60062: the multiplier letter stands for the decimal point,
 *        "4k7" = 4.7k, "2u2" = 2.2µ, "4R7" = 4.7, "1M5" = 1.5M, "3n3" = 3.3n.
 * Both ignore a trailing unit word (e.g. "10kOhm", "1uF", "5V", "2.2 µF", "1 MΩ").
 * Both return NaN when the text does not start with a number.
 *
 * parseUserNumber stays lenient about what follows the number (it reads the longest valid start).
 * Text that a learner probably meant differently ("4.7.3k", "1,2,3", "4k7k7", "5V1") is caught
 * by {@link userNumberLeftover} / {@link isCompleteUserNumber}, which the Properties fields and
 * the ERC use to refuse it with a message instead of simulating another value.
 */

const NUM_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*)$/;

const SPICE_SUFFIX: [string, number][] = [
  ['meg', 1e6],
  ['mil', 25.4e-6],
  ['t', 1e12],
  ['g', 1e9],
  ['k', 1e3],
  ['m', 1e-3],
  ['u', 1e-6],
  ['µ', 1e-6],
  ['μ', 1e-6],
  ['n', 1e-9],
  ['p', 1e-12],
  ['f', 1e-15],
  ['a', 1e-18],
];

export function parseSpiceNumber(text: string): number {
  const m = NUM_RE.exec(text);
  if (!m) return NaN;
  const base = Number(m[1]);
  const rest = m[2].toLowerCase();
  for (const [suf, mul] of SPICE_SUFFIX) {
    if (rest.startsWith(suf)) return base * mul;
  }
  return base;
}

/** Multiplier of a user-syntax suffix letter (case-sensitive; 'R' = 1 for the RKM code). */
const USER_LETTER: Readonly<Record<string, number>> = {
  T: 1e12,
  G: 1e9,
  M: 1e6,
  k: 1e3,
  K: 1e3,
  R: 1,
  m: 1e-3,
  u: 1e-6,
  µ: 1e-6,
  μ: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
};

/** "4,7k" -> "4.7k": one comma between digits right after the leading integer is a decimal comma. */
const DECIMAL_COMMA_RE = /^(\s*[+-]?\d+),(\d)/;
/** RKM code: integer part, multiplier letter, fraction digits ("4k7", "2u2", "4R7", "1meg5"). */
const RKM_RE = /^\s*([+-]?)(\d+)(meg|Meg|MEG|[TGMkKRmuµμnpf])(\d+)(.*)$/s;

interface UserNumberParse {
  value: number;
  /** text after the number and its multiplier (a unit word, or something that was not read) */
  rest: string;
}

function readUserNumber(text: string): UserNumberParse | null {
  const src = text.replace(DECIMAL_COMMA_RE, '$1.$2');
  const rkm = RKM_RE.exec(src);
  if (rkm) {
    const letter = rkm[3];
    const mul = letter.length > 1 ? 1e6 : USER_LETTER[letter];
    const v = Number(`${rkm[1]}${rkm[2]}.${rkm[4]}`) * mul;
    return { value: v, rest: rkm[5] };
  }
  const m = NUM_RE.exec(src);
  if (!m) return null;
  const base = Number(m[1]);
  const rest = m[2];
  if (/^meg/i.test(rest)) return { value: base * 1e6, rest: rest.slice(3) };
  if (/^mil(?![a-z])/i.test(rest) && !/^mili/i.test(rest)) return { value: base * 25.4e-6, rest: rest.slice(3) };
  const c = rest.charAt(0);
  // 'R' is only a multiplier inside the RKM code ("4R7"); "10R" reads as 10 (the unit word R)
  const mul = c !== 'R' ? USER_LETTER[c] : undefined;
  if (mul !== undefined) return { value: base * mul, rest: rest.slice(1) };
  return { value: base, rest };
}

export function parseUserNumber(text: string): number {
  const r = readUserNumber(text);
  return r ? r.value : NaN;
}

/**
 * parseUserNumber with the text after the number and its multiplier: "100uF" -> { value: 1e-4,
 * rest: 'F' }, "4k7 Ω" -> { value: 4700, rest: ' Ω' }; null when the text does not start with a number.
 */
export function parseUserNumberParts(text: string): { value: number; rest: string } | null {
  return readUserNumber(text);
}

/**
 * The part of a user number text that parseUserNumber did NOT read and that does not look like a
 * unit word: '' when the whole text is a number with an optional multiplier and unit ("4.7k",
 * "4,7 kΩ", "4k7", "10 µF", "1e-3 s", "25°C", "5 V/div"), otherwise the unread rest (".3k" for
 * "4.7.3k", ",3" for "1,2,3", "1" for "5V1"). Returns null when the text does not start with a
 * number at all. Fields use it to refuse text that would silently simulate another value.
 */
export function userNumberLeftover(text: string): string | null {
  const r = readUserNumber(text);
  if (!r) return null;
  const rest = r.rest.trim();
  // a unit word never contains digits and never starts with a separator
  return /\d/.test(rest) || /^[.,;:]/.test(rest) ? rest : '';
}

/** True when the whole text is one user number (see {@link userNumberLeftover}). */
export function isCompleteUserNumber(text: string): boolean {
  return userNumberLeftover(text) === '';
}

/**
 * Tokens of a list of user numbers ("1k, 2.2k 4.7k; 10k"): whitespace and ';' always separate;
 * a comma separates too, except a single comma between two digits inside one token, which is the
 * Vietnamese decimal comma ("1,5k 2,2k" = 1.5k and 2.2k; "1,5,10" and "1k,2k" are lists).
 */
export function splitUserNumberList(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text.split(/[\s;]+/)) {
    if (!chunk) continue;
    const commas = chunk.split(',').length - 1;
    if (commas === 1 && /^[+-]?\d+,\d/.test(chunk)) out.push(chunk);
    else out.push(...chunk.split(',').filter(Boolean));
  }
  return out;
}

/**
 * True when the text is a plain user number: a number (decimal point or comma, RKM code) with an
 * optional multiplier and a unit word made of letters only ("2k", "4,7 kΩ", "4k7", "10 µF") — no
 * operators, so "2*gain" or "1/2" are not plain (design variables treat them as expressions).
 */
export function isPlainUserNumber(text: string): boolean {
  const r = readUserNumber(text);
  return !!r && /^\s*[A-Za-zµμΩ°%]*\s*$/.test(r.rest);
}

const PREFIXES: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

/**
 * Format with an engineering prefix: formatEng(1500, 'Ω') -> "1.5 kΩ", formatEng(2.2e-6,'F') -> "2.2 µF".
 * `digits` = significant digits (default 4). Zero -> "0 unit". Non-finite -> "NaN"/"∞".
 */
export function formatEng(value: number, unit = '', digits = 4): string {
  if (Number.isNaN(value)) return 'NaN';
  if (!Number.isFinite(value)) return (value < 0 ? '-∞' : '∞') + (unit ? ' ' + unit : '');
  if (value === 0) return '0' + (unit ? ' ' + unit : '');
  const abs = Math.abs(value);
  let chosen = PREFIXES[PREFIXES.length - 1];
  for (const p of PREFIXES) {
    if (abs >= p[0] * 0.9999999) {
      chosen = p;
      break;
    }
  }
  const scaled = value / chosen[0];
  const text = Number(scaled.toPrecision(digits)).toString();
  const suffix = chosen[1] + unit;
  return suffix ? `${text} ${suffix}` : text;
}

/** Compact SPICE-safe number text (no unit, 'meg' for mega): 1500 -> "1.5k", 1e6 -> "1meg". */
export function toSpiceNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  const table: [number, string][] = [
    [1e12, 't'],
    [1e9, 'g'],
    [1e6, 'meg'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
    [1e-15, 'f'],
  ];
  for (const [mul, suf] of table) {
    if (abs >= mul * 0.9999999) {
      const scaled = Number((value / mul).toPrecision(12));
      return `${scaled}${suf}`;
    }
  }
  return value.toExponential(12).replace(/\.?0+e/, 'e');
}
