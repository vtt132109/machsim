/**
 * Find & replace, projects (pack / unpack), ZIP, templates and sheet paper / title block.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from './designkit';
import { findInDesign, replaceInDesign } from './findReplace';
import { addProjectEntry, newProject, packProject, parseProject, ProjectFormatError, removeProjectEntry, renameProjectEntry, serializeProject, unpackProject } from './project';
import { parseDesign, serializeDesign } from './serialize';
import { BUILTIN_TEMPLATES, builtinTemplate, designFromTemplate, parseTemplateList, templateFromDesign } from './templates';
import { LEGACY_PAGE, sheetColorVars, sheetFrame, titleBlockValues } from './paper';
import { bytesText, crc32, textBytes, unzipFiles, zipFiles } from '../util/zip';
import { newDesign } from './types';

function sample() {
  const b = new DesignBuilder('Find');
  b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
  b.part('basic/resistor', 'R2', 100, 0, { value: '10k' });
  b.label('VOUT', 0, 50);
  b.design.sheets[0].notes.push({ id: 'n1', x: 0, y: 0, text: 'R1 sets the gain' });
  b.bus('D[0..7]', { x: 0, y: 200 }, { x: 100, y: 200 });
  const c = b.child('Inner');
  b.part('basic/resistor', 'R1', 0, 0, { value: '1k' });
  b.root();
  b.block(c, 'SC1', 300, 0);
  return b.design;
}

describe('find and replace', () => {
  it('finds refdes, values, labels, bus names and notes on root and child sheets', () => {
    const d = sample();
    const m = findInDesign(d, 'r1');
    expect(m.map((x) => `${x.field}:${x.text}`)).toEqual(['refdes:R1', 'text:R1 sets the gain', 'refdes:R1']);
    expect(findInDesign(d, '1k', { fields: ['value'] }).map((x) => x.text)).toEqual(['1k', '1k']);
    expect(findInDesign(d, '0k', { fields: ['value'] }).map((x) => x.text)).toEqual(['10k']);
    expect(findInDesign(d, '1k', { fields: ['value'], wholeField: true })).toHaveLength(2);
    expect(findInDesign(d, 'r1', { matchCase: true })).toEqual([]);
    expect(findInDesign(d, 'D[0', { fields: ['bus'] }).map((x) => x.text)).toEqual(['D[0..7]']);
  });

  it('replaces values and labels everywhere and keeps refdes unique per level', () => {
    const d = sample();
    const r = replaceInDesign(d, '1k', '2.2k', { fields: ['value'], wholeField: true });
    expect(r.count).toBe(2);
    expect(r.design.sheets[0].parts.slice(0, 2).map((p) => p.params.value)).toEqual(['2.2k', '10k']);
    expect(r.design.children![0].sheets[0].parts[0].params.value).toBe('2.2k');
    expect(d.sheets[0].parts[0].params.value).toBe('1k'); // input untouched
    // R1 -> R2 clashes on the root (R2 exists) but is free inside the child
    const rr = replaceInDesign(d, 'R1', 'R2', { fields: ['refdes'], wholeField: true });
    expect(rr.count).toBe(1);
    expect(rr.skipped).toEqual(['R1 -> R2']);
    expect(rr.design.children![0].sheets[0].parts[0].refdes).toBe('R2');
    const lab = replaceInDesign(d, 'VOUT', 'OUT', { fields: ['label'] });
    expect(lab.design.sheets[0].labels[0].name).toBe('OUT');
    // only selected matches
    const only = findInDesign(d, 'R1', { fields: ['refdes'] }).slice(1);
    const sel = replaceInDesign(d, 'R1', 'R9', { fields: ['refdes'] }, only);
    expect(sel.design.sheets[0].parts[0].refdes).toBe('R1');
    expect(sel.design.children![0].sheets[0].parts[0].refdes).toBe('R9');
  });

  it('renames every section of a multi-section package together', () => {
    const b = new DesignBuilder('Một 7400');
    b.part('ttl/7400-a', 'U1', 0, 200);
    b.part('ttl/7400-b', 'U1', 200, 0);
    b.part('basic/resistor', 'R1', 400, 0, { value: '1k' });
    const r = replaceInDesign(b.design, 'U1', 'U7', { fields: ['refdes'], wholeField: true });
    expect(r.skipped).toEqual([]);
    expect(r.design.sheets[0].parts.map((p) => p.refdes)).toEqual(['U7', 'U7', 'R1']);
    expect(r.count).toBe(2);
    // a designator another package already uses is still refused
    const c = new DesignBuilder('Hai 7400');
    c.part('ttl/7400-a', 'U1', 0, 0);
    c.part('ttl/7400-a', 'U2', 200, 0);
    const clash = replaceInDesign(c.design, 'U1', 'U2', { fields: ['refdes'], wholeField: true });
    expect(clash.skipped).toEqual(['U1 -> U2']);
  });
});

describe('zip', () => {
  it('round-trips stored entries with UTF-8 names and checks CRC-32', async () => {
    expect(crc32(textBytes('123456789'))).toBe(0xcbf43926);
    const files = [
      { name: 'a.txt', data: textBytes('xin chào') },
      { name: 'thư mục/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ];
    const z = zipFiles(files);
    const back = await unzipFiles(z);
    expect(back.map((e) => e.name)).toEqual(['a.txt', 'thư mục/b.bin']);
    expect(bytesText(back[0].data)).toBe('xin chào');
    expect([...back[1].data]).toEqual([0, 1, 2, 255]);
    const bad = z.slice();
    bad[31 + 'a.txt'.length] ^= 0xff; // corrupt a data byte of the first entry
    await expect(unzipFiles(bad)).rejects.toThrow(/checksum/);
    expect(() => zipFiles([{ name: '../x', data: new Uint8Array() }])).toThrow(/invalid entry/);
  });

  it('reads deflated entries (archives re-packed by other tools)', async () => {
    const CS = (globalThis as { CompressionStream?: new (f: string) => TransformStream<Uint8Array, Uint8Array> }).CompressionStream;
    if (!CS) throw new Error('CompressionStream missing in this Node version');
    const text = 'deflate me '.repeat(50);
    const raw = textBytes(text);
    const comp = new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new CS('deflate-raw'))).arrayBuffer());
    // build a one-entry archive by hand with method 8
    const z = zipFiles([{ name: 'd.txt', data: comp }]);
    const view = new DataView(z.buffer);
    view.setUint16(8, 8, true); // local header method
    view.setUint32(14, crc32(raw), true);
    view.setUint32(22, raw.length, true);
    const cd = 30 + 'd.txt'.length + comp.length;
    view.setUint16(cd + 10, 8, true);
    view.setUint32(cd + 16, crc32(raw), true);
    view.setUint32(cd + 24, raw.length, true);
    const [e] = await unzipFiles(z);
    expect(bytesText(e.data)).toBe(text);
  });
});

describe('projects', () => {
  it('validates project files', () => {
    let p = newProject('Bài thực hành', new Date('2026-11-08T00:00:00Z'));
    p = addProjectEntry(p, { path: 'designs/amp.msim', title: 'Khuếch đại' });
    p = addProjectEntry(p, { path: 'docs\\datasheet.pdf' });
    expect(p.main).toBe('designs/amp.msim');
    expect(p.files[0].path).toBe('docs/datasheet.pdf');
    expect(addProjectEntry(p, { path: 'DESIGNS/AMP.msim' })).toBe(p);
    expect(() => addProjectEntry(p, { path: '../evil.msim' })).toThrow(ProjectFormatError);
    expect(parseProject(serializeProject(p))).toEqual(p);
    const moved = renameProjectEntry(p, 'designs/amp.msim', 'amp2.msim');
    expect(moved.main).toBe('amp2.msim');
    expect(removeProjectEntry(moved, 'amp2.msim').main).toBeUndefined();
    let issues: string[] = [];
    try {
      parseProject(JSON.stringify({ format: 'machsim-project', version: 1, name: 'x', designs: [{ path: 'a.txt' }, { path: 'C:/abs.msim' }], main: 'b.msim' }));
    } catch (e) {
      issues = (e as ProjectFormatError).issues;
    }
    expect(issues).toEqual([
      'designs[0].path: a design must be a .msim file (got "a.txt")',
      'designs[1].path: must be a relative path inside the project folder (got "C:/abs.msim")',
      'main: "b.msim" is not one of the project\'s designs',
    ]);
  });

  it('packs a project into one archive and unpacks it again', async () => {
    let p = newProject('Pack');
    p = addProjectEntry(p, { path: 'a.msim' });
    p = addProjectEntry(p, { path: 'notes/readme.txt' });
    const design = serializeDesign(sample());
    const contents = new Map<string, Uint8Array | string>([
      ['a.msim', design],
      ['notes/readme.txt', 'Đọc kỹ trước khi đo'],
    ]);
    const { bytes, missing } = packProject({ project: p, contents });
    expect(missing).toEqual([]);
    const back = await unpackProject(bytes);
    expect(back.project).toEqual(p);
    expect(back.contents.get('a.msim')).toBe(design);
    expect(bytesText(back.contents.get('notes/readme.txt') as Uint8Array)).toBe('Đọc kỹ trước khi đo');
    expect(parseDesign(back.contents.get('a.msim') as string).children).toHaveLength(1);
    // a damaged design inside the archive is reported
    const broken = packProject({ project: p, contents: new Map([...contents, ['a.msim', '{"format":"machsim-design","version":2}']]) });
    await expect(unpackProject(broken.bytes)).rejects.toThrow(/a\.msim/);
    // missing files are left out of the archive and reported
    expect(packProject({ project: p, contents: new Map([['a.msim', design]]) }).missing).toEqual(['notes/readme.txt']);
  });
});

describe('templates', () => {
  it('saves settings only (or with content) and creates designs from them', () => {
    const d = sample();
    d.sheets[0].props = { paper: 'A3', colors: { scheme: 'black' } };
    d.titleBlock = { designedBy: 'An', date: '2026-01-01' };
    d.variables = { gain: '10' };
    const tpl = templateFromDesign(d, 'Lớp 12A', false);
    const n = designFromTemplate(tpl, 'Bài mới');
    expect(n.title).toBe('Bài mới');
    expect(n.sheets[0].parts).toEqual([]);
    expect(n.sheets[0].props).toEqual({ paper: 'A3', colors: { scheme: 'black' } });
    expect(n.titleBlock).toEqual({ designedBy: 'An' });
    expect(n.variables).toEqual({ gain: '10' });
    expect(n.children).toBeUndefined();
    const full = designFromTemplate(templateFromDesign(d, 'full', true), 'x');
    expect(full.sheets[0].parts).toHaveLength(3);
    expect(full.children).toHaveLength(1);
    expect(parseTemplateList(JSON.stringify([tpl, { format: 'nope' }, 3]))).toEqual([tpl]);
    for (const id of BUILTIN_TEMPLATES) expect(() => parseDesign(serializeDesign(builtinTemplate(id, 'T', 'Trang 1', ['Mục tiêu', 'Dụng cụ'])))).not.toThrow();
    expect(builtinTemplate('lab-report', 'T', 'Trang 1', ['A', 'B']).sheets[0].notes.map((x) => x.text)).toEqual(['A', 'B']);
  });
});

describe('paper and title block', () => {
  it('derives sheet frames from paper settings', () => {
    expect(sheetFrame(undefined)).toMatchObject({ w: LEGACY_PAGE.w, h: LEGACY_PAGE.h, border: true, titleBlock: true, paper: 'legacy' });
    expect(sheetFrame({ paper: 'A4' })).toMatchObject({ w: 1190, h: 840 });
    expect(sheetFrame({ paper: 'A3', orientation: 'portrait', border: false })).toMatchObject({ w: 1190, h: 1680, border: false });
    expect(sheetFrame({ paper: 'Custom', width: 2000, height: 1000 })).toMatchObject({ w: 2000, h: 1000 });
  });

  it('fills automatic title-block values', () => {
    const d = newDesign('Mạch khuếch đại');
    d.sheets.push({ ...d.sheets[0], id: 's2', name: 'Two' });
    const v = titleBlockValues(d, d.sheets[1], d.sheets, new Date(2026, 10, 8), 'vi-VN');
    expect(v).toMatchObject({ title: 'Mạch khuếch đại', sheetNumber: 2, sheetCount: 2, date: '08/11/2026', sheetName: 'Two' });
    d.titleBlock = { title: 'Khác', date: '1/1/2020', revision: 'C' };
    expect(titleBlockValues(d, d.sheets[0], d.sheets, new Date(), 'en-US')).toMatchObject({ title: 'Khác', date: '1/1/2020', revision: 'C', sheetNumber: 1 });
  });

  it('maps colour schemes to scene variables', () => {
    expect(sheetColorVars(undefined)).toEqual({});
    expect(sheetColorVars({ scheme: 'default' })).toEqual({});
    expect(sheetColorVars({ scheme: 'black' })['--canvas']).toBe('#05080c');
    expect(sheetColorVars({ scheme: 'custom', wire: '#ff0000' })).toEqual({ '--wire': '#ff0000', '--junction': '#ff0000' });
  });
});
