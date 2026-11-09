import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { runAnalyses } from '../sim';
import { encodePng, iTXtChunk, pngTexts, readPngChunks, writePngChunks } from '../util/png';
import { copyItems, pasteItems } from '../ui/store/designOps';
import type { SelItem } from '../ui/store/types';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { buildSnippet, decodeSnippet, encodeSnippet, hasSnippet, SNIPPET_KEYWORD, snippetDesign, snippetFileName, snippetText, SnippetError } from './snippet';
import type { Design } from './types';

const lookup = getPart;

/** 12 V divider R1 10k / R2 4.7k with ground and a label. */
function divider(): Design {
  const b = new DesignBuilder('Divider');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 130, { value: '{Rtop}' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 270, { value: '4.7k' }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 100, 330);
  b.wire(b.pin(v1, '+'), { x: 100, y: 100 }, b.pin(r1, '1'));
  b.connect(r1, '2', r2, '1');
  b.wire(b.pin(r2, '2'), { x: 250, y: 330 }, { x: 100, y: 330 });
  b.wire(b.pin(v1, '-'), { x: 100, y: 330 });
  b.label('OUT', 250, 200);
  b.design.variables = { Rtop: '10k', unused: '5' };
  b.design.analysis = { active: 'op', specs: { op: { type: 'op' } } };
  return b.design;
}

const everything = (d: Design): SelItem[] => {
  const s = d.sheets[0];
  return [...s.parts.map((p) => ({ kind: 'part' as const, id: p.id })), ...s.wires.map((w) => ({ kind: 'wire' as const, id: w.id })), ...s.labels.map((l) => ({ kind: 'label' as const, id: l.id }))];
};

function opValue(design: Design, node: string): number {
  const build = buildNetlist(design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars![`V(${node})`];
}

describe('circuit snippets in PNG files', () => {
  const src = divider();
  const frag = copyItems(src, 'sheet1', everything(src), lookup)!;
  const data = buildSnippet(src, frag, new Date('2026-11-09T08:00:00Z'));
  const picture = encodePng(4, 3, new Uint8Array(48).fill(255));
  const png = encodeSnippet(picture, data);

  it('stores versioned JSON under its own keyword in an iTXt chunk before IEND', () => {
    const chunks = readPngChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'iTXt', 'IEND']);
    const text = pngTexts(chunks)[0];
    expect(text.keyword).toBe(SNIPPET_KEYWORD);
    expect(text.text).toBe(snippetText(data));
    const json = JSON.parse(text.text);
    expect(json.format).toBe('machsim-snippet');
    expect(json.version).toBe(1);
    expect(json.savedBy).toMatch(/^MachSim \d+\.\d+\.\d+$/);
    expect(json.created).toBe('2026-11-09T08:00:00.000Z');
    // only the global parameters the values use travel with the snippet
    expect(json.variables).toEqual({ Rtop: '10k' });
    // the chunk bytes are exactly keyword NUL 0 0 NUL NUL + UTF-8 JSON
    const expected = iTXtChunk(SNIPPET_KEYWORD, snippetText(data)).data;
    expect(chunks[2].data).toEqual(expected);
    // the image chunks are untouched
    expect(png.subarray(0, picture.length - 12)).toEqual(picture.subarray(0, picture.length - 12));
  });

  it('decodes to the same fragment and rebuilds the same circuit', () => {
    const back = decodeSnippet(png);
    expect(back.fragment).toEqual(data.fragment);
    expect(back.variables).toEqual({ Rtop: '10k' });
    expect(hasSnippet(png)).toBe(true);
    const d = snippetDesign(back, 'Mạch dán', 'Trang 1');
    expect(d.sheets[0].name).toBe('Trang 1');
    expect(d.sheets[0].parts.map((p) => p.refdes)).toEqual(['V1', 'R1', 'R2', 'GND1']);
    expect(opValue(d, 'OUT')).toBeCloseTo((12 * 4.7) / 14.7, 9);
  });

  it('pasting into a design that already uses the refdes renumbers only the colliding parts', () => {
    const back = decodeSnippet(png);
    const target = divider();
    target.sheets[0].parts = target.sheets[0].parts.filter((p) => p.refdes === 'R2');
    target.sheets[0].wires = [];
    target.sheets[0].labels = [];
    const r = pasteItems(target, 'sheet1', back.fragment, { x: 400, y: 0 }, lookup, { keepRefdes: true });
    const refs = r.design.sheets[0].parts.map((p) => p.refdes);
    expect(refs).toEqual(['R2', 'V1', 'R1', 'R3', 'GND1']);
    expect(r.selection.filter((s) => s.kind === 'part')).toHaveLength(4);
    // the pasted copy is shifted on the grid and still divides 12 V
    const moved = r.design.sheets[0].parts.find((p) => p.refdes === 'V1')!;
    expect(moved.x).toBe(500);
    expect(r.design.sheets[0].labels.map((l) => l.name)).toEqual(['OUT']);
  });

  it('gives a friendly code for PNGs without MachSim data, damaged files and newer versions', () => {
    const code = (b: Uint8Array) => {
      try {
        decodeSnippet(b);
        return 'ok';
      } catch (e) {
        return e instanceof SnippetError ? e.code : 'other';
      }
    };
    expect(code(picture)).toBe('no-data');
    expect(hasSnippet(picture)).toBe(false);
    expect(code(new TextEncoder().encode('{"format":"machsim-design"}'))).toBe('not-png');
    const broken = png.slice();
    broken[broken.length - 30] ^= 0x20;
    expect(code(broken)).toBe('damaged');
    const chunks = readPngChunks(picture);
    const newer = writePngChunks([...chunks.slice(0, -1), iTXtChunk(SNIPPET_KEYWORD, JSON.stringify({ ...data, version: 9 })), chunks[chunks.length - 1]]);
    expect(code(newer)).toBe('newer');
    const invalid = writePngChunks([...chunks.slice(0, -1), iTXtChunk(SNIPPET_KEYWORD, JSON.stringify({ ...data, fragment: { ...data.fragment, parts: [{ id: 'x', partId: 'basic/resistor', refdes: 'R9', x: 'left', y: 0 }] } })), chunks[chunks.length - 1]]);
    expect(code(invalid)).toBe('invalid');
    try {
      decodeSnippet(invalid);
    } catch (e) {
      expect((e as SnippetError).issues.some((i) => i.startsWith('fragment.parts[0].x'))).toBe(true);
    }
  });

  it('carries child designs of blocks, user components and leaves hidden faults out', () => {
    const b = new DesignBuilder('Blocks');
    const child = b.child('Filter', { kind: 'subcircuit' });
    const r = b.part('basic/resistor', 'R1', 100, 100);
    b.labelPin(r, '1', 'IN', { kind: 'hier' });
    b.labelPin(r, '2', 'OUT', { kind: 'hier' });
    b.root();
    const blk = b.block(child, 'SC1', 300, 200);
    const r9 = b.part('basic/resistor', 'R9', 100, 200);
    r9.inst.faults = [{ pin: '1', kind: 'open', hidden: true }, { pin: '2', kind: 'short', to: '1' }];
    const d = b.design;
    const sel: SelItem[] = [{ kind: 'part', id: blk.inst.id }, { kind: 'part', id: r9.inst.id }];
    const snip = buildSnippet(d, copyItems(d, 'sheet1', sel, (id) => getPart(id) ?? (id.startsWith('hier:') ? getPart('basic/resistor') : undefined))!);
    expect(snip.fragment.children?.map((c) => c.name)).toEqual(['Filter']);
    expect(snip.fragment.parts.find((p) => p.refdes === 'R9')!.faults).toEqual([{ pin: '2', kind: 'short', to: '1' }]);
    const back = decodeSnippet(encodeSnippet(picture, snip));
    expect(back.fragment.children?.[0].sheets[0].parts[0].refdes).toBe('R1');
  });

  it('carries a variable referred to in lower case, as a bare name or through another variable', () => {
    const cases: { top: string; bottom: string; vars: Record<string, string>; want: Record<string, string> }[] = [
      { top: '{rtop}', bottom: '4.7k', vars: { Rtop: '10k', spare: '1' }, want: { Rtop: '10k' } },
      { top: '10k', bottom: 'Rbot', vars: { Rbot: '4.7k', spare: '1' }, want: { Rbot: '4.7k' } },
      { top: '{Rtop}', bottom: '4.7k', vars: { Rtop: '{2*Rbase}', Rbase: '5k', spare: '1' }, want: { Rtop: '{2*Rbase}', Rbase: '5k' } },
    ];
    for (const c of cases) {
      const d = divider();
      d.variables = c.vars;
      d.sheets[0].parts.find((p) => p.refdes === 'R1')!.params.value = c.top;
      d.sheets[0].parts.find((p) => p.refdes === 'R2')!.params.value = c.bottom;
      const snip = buildSnippet(d, copyItems(d, 'sheet1', everything(d), lookup)!);
      expect(snip.variables, `${c.top} / ${c.bottom}`).toEqual(c.want);
      // the snippet opened as a design simulates like the one it came from
      const open = snippetDesign(decodeSnippet(encodeSnippet(picture, snip)), 'S', 'Trang 1');
      expect(opValue(open, 'OUT')).toBeCloseTo(opValue(d, 'OUT'), 9);
    }
  });

  it('carries the assembly variants a not-fitted part names, so the snippet loads again', () => {
    const d = divider();
    d.variants = { list: [{ id: 'v1', name: 'Đủ' }, { id: 'v2', name: 'Rút gọn' }], active: 'v2' };
    d.sheets[0].parts.find((p) => p.refdes === 'R2')!.notFitted = ['v2'];
    const snip = buildSnippet(d, copyItems(d, 'sheet1', everything(d), lookup)!);
    expect(snip.variants).toEqual({ list: [{ id: 'v2', name: 'Rút gọn' }], active: 'v2' });
    const back = decodeSnippet(encodeSnippet(picture, snip));
    expect(back.fragment.parts.find((p) => p.refdes === 'R2')!.notFitted).toEqual(['v2']);
    const open = snippetDesign(back, 'S', 'Trang 1');
    expect(open.variants?.list.map((v) => v.id)).toEqual(['v2']);
  });

  it('drops notFitted ids no variant declares instead of writing a snippet it cannot read', () => {
    const d = divider();
    d.sheets[0].parts.find((p) => p.refdes === 'R2')!.notFitted = ['ghost'];
    const snip = buildSnippet(d, copyItems(d, 'sheet1', everything(d), lookup)!);
    expect(snip.variants).toBeUndefined();
    expect(snip.fragment.parts.every((p) => p.notFitted === undefined)).toBe(true);
    expect(() => decodeSnippet(encodeSnippet(picture, snip))).not.toThrow();
  });

  it('names snippet files after the design title', () => {
    expect(snippetFileName('Cầu phân áp')).toBe('Cầu phân áp - snippet.png');
    expect(snippetFileName('a/b:c')).toBe('a_b_c - snippet.png');
  });
});
