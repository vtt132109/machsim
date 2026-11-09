/**
 * Word generator model (pure): pattern text <-> words, preset patterns, output sequencing and
 * per-bit PWL waveforms.
 *
 * Params (text):
 *   pattern  comma-joined hex words, e.g. "0000,0001,00FF" (address 0 first)
 *   freq     word rate (Hz)
 *   bits     output width 1..32 (default 16)
 *   mode     cycle | burst | step
 *   start / end   first / last address played (default 0 .. last word)
 *   pos      current address in step mode
 *   vhigh / vlow  output levels (V), rise  edge time (s) — used by the library's netlist
 *   display  hex | bin (editor display only)
 */

import type { Waveform } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import { t } from '../../i18n';

export type WordGenMode = 'cycle' | 'burst' | 'step';

/** Defaults (same as the library part `instruments/word-generator`). */
export const WORDGEN_DEFAULTS: Record<string, string> = {
  pattern: '0,1,2,3,4,5,6,7,8,9,A,B,C,D,E,F',
  freq: '1k',
  bits: '16',
  mode: 'cycle',
  start: '0',
  end: '',
  pos: '0',
  vhigh: '5',
  vlow: '0',
  rise: '10n',
  display: 'hex',
};

export const MAX_WORDS = 1024;

function maskFor(bits: number): number {
  return bits >= 32 ? 0xffffffff : 2 ** bits - 1;
}

export function clampBits(bits: number): number {
  return Math.max(1, Math.min(32, Math.round(Number.isFinite(bits) ? bits : 16)));
}

export interface ParsedPattern {
  words: number[];
  /** messages for tokens that are not hex numbers */
  errors: string[];
}

/** Parse comma / whitespace separated hex words ("0x" prefix optional), masked to `bits`. */
export function parsePattern(text: string, bits = 16): ParsedPattern {
  const mask = maskFor(clampBits(bits));
  const words: number[] = [];
  const errors: string[] = [];
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  tokens.forEach((tok, i) => {
    const txt = tok.replace(/^0x/i, '');
    if (!/^[0-9a-f]+$/i.test(txt) || txt.length > 8) {
      errors.push(t('instruments.wordgen.wordITokIsNot', { i: i, tok: tok }));
      words.push(0);
      return;
    }
    words.push((parseInt(txt, 16) & mask) >>> 0);
  });
  if (words.length > MAX_WORDS) {
    errors.push(t('instruments.wordgen.onlyTheFirstMaxwordsWords', { MAXWORDS: MAX_WORDS }));
    words.length = MAX_WORDS;
  }
  return { words, errors };
}

/** Upper-case hex text padded to the word width, comma-joined. */
export function formatPattern(words: readonly number[], bits = 16): string {
  const digits = Math.ceil(clampBits(bits) / 4);
  return words.map((w) => (w >>> 0).toString(16).toUpperCase().padStart(digits, '0')).join(',');
}

/** Binary text MSB first. */
export function wordToBinary(word: number, bits = 16): string {
  const b = clampBits(bits);
  return (word >>> 0).toString(2).padStart(32, '0').slice(32 - b);
}

export type PatternPreset = 'clear' | 'up' | 'down' | 'shift-left' | 'shift-right' | 'alternate';

/** Generate a preset pattern of `count` words. */
export function patternPreset(kind: PatternPreset, count: number, bits = 16): number[] {
  const b = clampBits(bits);
  const mask = maskFor(b);
  const n = Math.max(1, Math.min(MAX_WORDS, Math.floor(count)));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let w: number;
    switch (kind) {
      case 'clear':
        w = 0;
        break;
      case 'up':
        w = i;
        break;
      case 'down':
        w = mask - i;
        break;
      case 'shift-left':
        w = 2 ** (i % b);
        break;
      case 'shift-right':
        w = 2 ** (b - 1 - (i % b));
        break;
      case 'alternate':
        w = i % 2 === 0 ? 0x55555555 : 0xaaaaaaaa;
        break;
    }
    out.push(((w & mask) >>> 0) as number);
  }
  return out;
}

export interface WordGenSettings {
  words: number[];
  bits: number;
  freq: number;
  mode: WordGenMode;
  start: number;
  end: number;
  pos: number;
}

export function parseWordGenSettings(params: Record<string, string>): WordGenSettings {
  const bits = clampBits(parseUserNumber(params.bits ?? WORDGEN_DEFAULTS.bits));
  const { words } = parsePattern(params.pattern ?? '', bits);
  const list = words.length ? words : [0];
  const last = list.length - 1;
  const int = (k: string, fallback: number) => {
    const v = parseUserNumber(params[k] ?? '');
    return Number.isFinite(v) ? Math.round(v) : fallback;
  };
  const start = Math.max(0, Math.min(last, int('start', 0)));
  const end = Math.max(start, Math.min(last, int('end', last)));
  const freq = parseUserNumber(params.freq ?? WORDGEN_DEFAULTS.freq);
  const m = (params.mode ?? 'cycle').trim().toLowerCase();
  return {
    words: list,
    bits,
    freq: freq > 0 ? freq : 1e3,
    mode: m === 'burst' || m === 'step' ? m : 'cycle',
    start,
    end,
    pos: Math.max(0, Math.min(last, int('pos', start))),
  };
}

/** Address output at time t (s): cycle repeats start..end, burst plays it once then holds, step holds `pos`. */
export function addressAt(s: WordGenSettings, t: number): number {
  if (s.mode === 'step') return s.pos;
  const k = Math.floor(Math.max(0, t) * s.freq + 1e-9);
  const len = s.end - s.start + 1;
  if (s.mode === 'burst') return Math.min(s.end, s.start + k);
  return s.start + (k % len);
}

export function wordAt(s: WordGenSettings, t: number): number {
  return s.words[addressAt(s, t)] ?? 0;
}

/**
 * PWL waveform (0 .. tstop) of one output bit. Transitions start at each word boundary k / freq
 * and take `rise` seconds. At most `maxWords` word periods are expanded.
 */
export function bitPwl(s: WordGenSettings, bit: number, vlow: number, vhigh: number, tstop: number, rise = 1e-9, maxWords = 100000): Waveform {
  const level = (w: number) => (((w >>> bit) & 1) === 1 ? vhigh : vlow);
  const args: number[] = [0, level(wordAt(s, 0))];
  if (s.mode !== 'step') {
    const T = 1 / s.freq;
    const tr = Math.min(rise, T / 4);
    let prev = args[1];
    const count = Math.min(maxWords, Math.ceil(tstop * s.freq));
    for (let k = 1; k <= count; k++) {
      const t = k * T;
      if (t > tstop) break;
      const v = level(wordAt(s, t));
      if (v !== prev) {
        args.push(t, prev, t + tr, v);
        prev = v;
      }
      if (s.mode === 'burst' && s.start + k > s.end) break;
    }
  }
  return { type: 'PWL', args };
}
