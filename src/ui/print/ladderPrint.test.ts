/** Ladder additions to a printout: rung comments, function blocks, cross-reference tables, wrapped captions. */
import { describe, expect, it } from 'vitest';
import { hasLadder, ladderCommentsDoc, ladderContents, ladderXrefTables, rungCommentLines } from './ladderPrint';
import { ladderBoxLines, ladderCaptionLines, ladderSheetSvg } from '../editor/ladderSvg';
import { paginateDocument, paginateTable } from './printLayout';
import { newDesign, newSheet } from '../../model/types';
import type { LadderBlock, LadderRung } from '../../ladder/types';

const rungs: LadderRung[] = [
  { id: 'r1', comment: 'Start and hold in', logic: { kind: 'contact', type: 'no', address: 'I0.0', comment: 'Start button' }, outputs: [{ kind: 'coil', address: 'Q0.0', comment: 'Motor contactor' }] },
  { id: 'r2', outputs: [{ kind: 'coil', address: 'Q0.1' }] },
  { id: 'r3', comment: 'Run the pump block', disabled: true, outputs: [{ kind: 'call', address: 'P1', block: 'Pump', args: { GO: 'Q0.0', RUN: 'Q0.2' } }] },
];
const pump: LadderBlock = { id: 'b', name: 'Pump', comment: 'Pump with a soft start', inputs: ['GO'], outputs: ['RUN'], rungs: [{ id: 'p1', comment: 'copy GO to RUN', logic: { kind: 'contact', type: 'no', address: 'GO' }, outputs: [{ kind: 'coil', address: 'RUN' }] }] };

function design() {
  const d = newDesign('Tank');
  return { ...d, sheets: [d.sheets[0], { ...newSheet('l1', 'Ladder 1'), kind: 'ladder' as const, ladder: rungs }], ladderBlocks: [pump] };
}

describe('rung comments', () => {
  it('lists the comment of a rung and of its elements, skipping rungs without any', () => {
    const lines = rungCommentLines(rungs);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/1: Start and hold in$/);
    expect(lines[1]).toBe('    I0.0: Start button');
    expect(lines[2]).toBe('    Q0.0: Motor contactor');
    // rung 3 is switched off and says so; rung 2 has no comment and is left out
    expect(lines[3]).toMatch(/3.*: Run the pump block$/);
    expect(lines.join('\n')).not.toMatch(/Q0\.1/);
  });

  it('makes a document with a heading per sheet and per block', () => {
    const doc = ladderCommentsDoc(design())!;
    expect(doc.kind).toBe('doc');
    const headings = doc.blocks.filter((b) => b.kind === 'heading').map((b) => (b.kind === 'heading' ? b.text : ''));
    expect(headings[0]).toBe('Ladder 1');
    expect(headings[1]).toContain('Pump');
    expect(headings[1]).toContain('GO');
    expect(doc.blocks.some((b) => b.kind === 'paragraph' && b.text === 'Pump with a soft start')).toBe(true);
    // it flows over pages
    expect(paginateDocument(doc.blocks, { w: 190, h: 270 }).length).toBeGreaterThan(0);
  });

  it('a design without ladder has nothing to print', () => {
    const d = newDesign('Plain');
    expect(hasLadder(d)).toBe(false);
    expect(ladderCommentsDoc(d)).toBeNull();
    expect(ladderContents(d)).toEqual([]);
    expect(hasLadder(design())).toBe(true);
  });
});

describe('cross-reference tables', () => {
  it('prints each address with the rungs that write and read it', () => {
    const tables = ladderXrefTables(design());
    expect(tables).toHaveLength(1);
    const t = tables[0].table;
    expect(t.header).toHaveLength(4);
    const q0 = t.rows.find((r) => r[0] === 'Q0.0')!;
    // written by rung 1; read by the call in rung 3 (an input of the block)
    expect(q0[2]).toBe('1');
    expect(q0[3]).toBe('3');
    const i0 = t.rows.find((r) => r[0] === 'I0.0')!;
    expect(i0[3]).toBe('1');
    // the block's own parameters are listed under the block
    expect(t.rows.some((r) => r[0] === 'Pump.GO')).toBe(true);
    expect(paginateTable(t, { w: 190, h: 270 }).length).toBeGreaterThan(0);
  });

  it('ladderContents returns the document first, then the tables', () => {
    expect(ladderContents(design()).map((c) => c.kind)).toEqual(['doc', 'table']);
  });
});

describe('the drawn captions', () => {
  it('wrap a long comment instead of cutting it off', () => {
    const long = 'Dong co chay khi nguoi van hanh nhan nut khoi dong, tu giu bang tiep diem cua chinh cuon day va chi dung khi nhan nut dung hoac role nhiet tac dong ngat mach dieu khien';
    const lines = ladderCaptionLines('Rung 4', long, 1);
    expect(lines.length).toBeGreaterThan(1);
    // nothing is lost: the words come back in order
    expect(lines.join(' ').replace(/\s+/g, ' ')).toBe(`Rung 4 — ${long}`);
    expect(lines.every((l) => l.length <= 70)).toBe(true);
    expect(ladderCaptionLines('Rung 1', undefined, 1)).toEqual(['Rung 1']);
  });

  it('a long comment makes the printed rung taller and the markup carries every line', () => {
    const long = 'word '.repeat(60).trim();
    const short = ladderSheetSvg([{ id: 'a', comment: 'short', outputs: [{ kind: 'coil', address: 'Q0.0' }] }]);
    const tall = ladderSheetSvg([{ id: 'a', comment: long, outputs: [{ kind: 'coil', address: 'Q0.0' }] }]);
    expect(tall.height).toBeGreaterThan(short.height);
    expect((tall.markup.match(/word/g) ?? []).length).toBe(60);
  });

  it('draws a word instruction and a call as a box with their text', () => {
    const svg = ladderSheetSvg([
      { id: 'a', outputs: [{ kind: 'add', address: 'MW2', a: 'MW0', b: 'MW1' }] },
      { id: 'b', outputs: [{ kind: 'call', address: 'P1', block: 'Pump', args: {} }] },
    ]);
    expect(svg.markup).toContain('ADD MW2');
    expect(svg.markup).toContain('MW0 + MW1');
    expect(svg.markup).toContain('FB P1');
    expect(svg.markup).toContain('Pump');
    expect(svg.markup).toContain('<rect');
    expect(ladderBoxLines({ kind: 'coil', address: 'Q0.0' })).toBeNull();
    expect(ladderBoxLines({ kind: 'mov', address: 'AQ0', a: 'AI0' })).toEqual(['MOV AQ0', '= AI0']);
    expect(ladderBoxLines({ kind: 'div', address: 'MW1', a: '7', b: '2' })).toEqual(['DIV MW1', '7 ÷ 2']);
  });
});

describe('the print preview choice', () => {
  it('the "ladder" choice adds the comments document and the cross-reference table to the print job', async () => {
    const { buildContents, DEFAULT_CHOICES } = await import('./printSources');
    const d = design();
    const none = await buildContents({ design: d, activeSheetId: d.sheets[0].id, selection: [], monochrome: false }, { ...DEFAULT_CHOICES, sheets: false });
    expect(none).toEqual([]);
    const some = await buildContents({ design: d, activeSheetId: d.sheets[0].id, selection: [], monochrome: false }, { ...DEFAULT_CHOICES, sheets: false, ladder: true });
    expect(some.map((c) => c.kind)).toEqual(['doc', 'table']);
  });
});
