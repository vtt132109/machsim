/**
 * The terminology scanner: every Vietnamese text of the program (menus, dialogs, tips, help
 * guides, lessons, sample titles, part texts ...) and the notes of the shipped samples use the
 * words of src/i18n/glossary.ts. The walk imports every module of src/i18n, takes each
 * { vi, en } text (and each [vi, en] message and each string of a *.vi.ts table) and reports the
 * table, the key and the avoided word.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISTINCT, GLOSSARY, glossaryViolations } from './glossary';

const DIR = __dirname;
const EXAMPLES = join(DIR, '../../examples');

function moduleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...moduleFiles(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && e.name !== 'glossary.ts') out.push(p);
  }
  return out;
}

interface Text {
  where: string;
  text: string;
}

/** Every Vietnamese text of a module, with where it is. */
function vietnameseOf(file: string, mod: Record<string, unknown>): Text[] {
  const name = relative(DIR, file).split(sep).join('/');
  const out: Text[] = [];
  const seen = new Set<unknown>();
  const plainTable = name.endsWith('.vi.ts');
  const walk = (path: string, v: unknown, depth: number): void => {
    if (depth > 9 || v === null || seen.has(v)) return;
    if (typeof v === 'string') {
      if (plainTable) out.push({ where: `${name}${path}`, text: v });
      return;
    }
    if (typeof v !== 'object') return;
    seen.add(v);
    const o = v as Record<string, unknown>;
    if (typeof o.vi === 'string' && typeof o.en === 'string') {
      out.push({ where: `${name}${path}`, text: o.vi });
      return;
    }
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && !plainTable) {
      out.push({ where: `${name}${path}`, text: v[0] });
      return;
    }
    for (const [k, x] of Object.entries(o)) walk(`${path}.${k}`, x, depth + 1);
  };
  walk('', mod, 0);
  return out;
}

describe('the glossary', () => {
  it('lists each term once, with a word to use and something to avoid', () => {
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(15);
    expect(new Set(GLOSSARY.map((t) => t.concept)).size).toBe(GLOSSARY.length);
    for (const t of GLOSSARY) {
      expect(t.use.length, t.concept).toBeGreaterThan(1);
      expect(t.avoid.length, t.concept).toBeGreaterThan(0);
      // the word to use is never one the same entry forbids
      for (const rx of t.avoid) expect(rx.test(t.use), `${t.concept}: "${t.use}" matches its own avoid pattern ${rx}`).toBe(false);
    }
    expect(DISTINCT.length).toBeGreaterThanOrEqual(4);
  });

  it('catches what it is written to catch (and leaves the allowed uses alone)', () => {
    const found = (s: string) => glossaryViolations(s).map((v) => v.found);
    expect(found('Đặt dụng cụ đo vào mạch')).toEqual(['dụng cụ đo']);
    expect(found('Cuộn công tắc tơ 24 V')).toEqual(['công tắc tơ']);
    expect(found('Khởi động từ gồm công-tắc-tơ và rơ-le nhiệt')).toEqual([]);
    expect(found('Dùng API Clipboard của trình duyệt')).toEqual([]);
    expect(found('Sao chép vào clipboard')).toEqual(['clipboard']);
    expect(found('mở tab ERC')).toEqual(['tab']);
    expect(found('micro, nhạc cụ')).toEqual(['micro']);
    expect(found('Lắp trong phương án “{variant}”')).toEqual([]);
    expect(found('phương án lắp ráp (variant)')).toEqual([]);
    expect(found('Ctrl+Tab chuyển thẻ; 5 micro giây; (A, B, Mini, Micro, Type-C)')).toEqual([]);
    expect(found('MachSim.exe --script tep.js chạy tập lệnh')).toEqual([]);
    expect(found('Dụng cụ đo trong khối')).toEqual(['Dụng cụ đo']);
  });

  it('every Vietnamese text of the program follows it', async () => {
    const problems: string[] = [];
    let texts = 0;
    for (const file of moduleFiles(DIR)) {
      const mod = (await import(file)) as Record<string, unknown>;
      for (const t of vietnameseOf(file, mod)) {
        // the search aliases of the library are alternative spellings to find a part by ("rơle", "nút bấm")
        if (t.where.includes('FAMILY_SEARCH_VI')) continue;
        texts += 1;
        for (const v of glossaryViolations(t.text)) problems.push(`${t.where}: "${v.found}" -> "${v.use}" (${v.concept})`);
      }
    }
    expect(texts).toBeGreaterThan(8000);
    expect([...new Set(problems)]).toEqual([]);
  }, 60000);

  it('the notes of every shipped sample follow it', () => {
    const problems: string[] = [];
    for (const f of readdirSync(EXAMPLES).filter((x) => x.endsWith('.msim'))) {
      const d = JSON.parse(readFileSync(join(EXAMPLES, f), 'utf8')) as { title: string; sheets: { name: string; notes: { text: string }[] }[] };
      // the sheet names and notes are Vietnamese; the description holds both languages and is not scanned
      const texts = d.sheets.flatMap((s) => [s.name, ...s.notes.map((n) => n.text)]);
      for (const t of texts) for (const v of glossaryViolations(t)) problems.push(`${f}: "${v.found}" -> "${v.use}"`);
    }
    expect(problems).toEqual([]);
  });
});
