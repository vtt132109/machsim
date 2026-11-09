/**
 * What a ladder program adds to a printout (File › Print preview › "Ladder: rung comments and
 * cross-reference"):
 *
 *   - a document with the comment of every rung (and of every contact / coil that has one), by
 *     sheet and by function block, so a printed program can be read without the screen;
 *   - one cross-reference table per design level: each address with the rungs that write it and the
 *     rungs that read it.
 *
 * The drawn sheets already carry the rung captions (src/ui/editor/ladderSvg.ts); this is the
 * companion list for a reader who wants the explanations in one place. Pure apart from the texts.
 */
import type { LadderNode, LadderRung } from '../../ladder/types';
import { crossReference, useSummary, type XrefEntry } from '../../ladder/xref';
import type { Design, Sheet } from '../../model/types';
import { addressKindText, lt } from '../../i18n/ladderText';
import { pt } from '../../i18n/printText';
import type { DocBlock } from './printLayout';
import type { DocContent, TableContent } from './printModel';

/** True when the design has anything to print for a ladder program. */
export function hasLadder(design: Pick<Design, 'sheets' | 'children' | 'ladderBlocks'>): boolean {
  const ladder = (sheets: readonly Sheet[]) => sheets.some((s) => s.kind === 'ladder' && (s.ladder?.length ?? 0) > 0);
  return ladder(design.sheets) || (design.children ?? []).some((c) => ladder(c.sheets)) || (design.ladderBlocks?.length ?? 0) > 0;
}

/** Comments inside the logic of a rung: `address: comment`. */
function elementComments(logic: LadderNode | undefined, out: string[]): void {
  if (!logic) return;
  if (logic.kind === 'contact') {
    if (logic.comment?.trim()) out.push(`${logic.address}: ${logic.comment.trim()}`);
  } else if (logic.kind === 'compare') {
    if (logic.comment?.trim()) out.push(`${logic.left} ${logic.right}: ${logic.comment.trim()}`);
  } else for (const item of logic.items) elementComments(item, out);
}

/** The lines of one list of rungs: `Rung 2: hold in` and the comments of its elements below it. */
export function rungCommentLines(rungs: readonly LadderRung[]): string[] {
  const lines: string[] = [];
  rungs.forEach((r, i) => {
    const own = r.comment?.trim();
    const inner: string[] = [];
    elementComments(r.logic, inner);
    for (const o of r.outputs) if (o.comment?.trim()) inner.push(`${o.kind === 'call' ? `FB ${o.address}` : o.address}: ${o.comment.trim()}`);
    if (!own && inner.length === 0) return;
    lines.push(`${lt('rung', { n: i + 1 })}${r.disabled ? ` ${lt('disabled')}` : ''}${own ? `: ${own}` : ''}`);
    for (const text of inner) lines.push(`    ${text}`);
  });
  return lines;
}

/** The comments document, or null when the design has no ladder program. */
export function ladderCommentsDoc(design: Design): DocContent | null {
  if (!hasLadder(design)) return null;
  const blocks: DocBlock[] = [];
  const sheets = [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)].filter((s) => s.kind === 'ladder' && (s.ladder?.length ?? 0) > 0);
  for (const s of sheets) {
    const lines = rungCommentLines(s.ladder ?? []);
    blocks.push({ kind: 'heading', text: s.name });
    if (lines.length) blocks.push({ kind: 'bullets', items: lines });
    else blocks.push({ kind: 'paragraph', text: pt('ladderNoComments') });
  }
  for (const b of design.ladderBlocks ?? []) {
    blocks.push({ kind: 'heading', text: pt('ladderBlock', { name: b.name, inputs: b.inputs.join(', '), outputs: b.outputs.join(', ') }) });
    if (b.comment?.trim()) blocks.push({ kind: 'paragraph', text: b.comment.trim() });
    const lines = rungCommentLines(b.rungs);
    if (lines.length) blocks.push({ kind: 'bullets', items: lines });
    else blocks.push({ kind: 'paragraph', text: pt('ladderNoComments') });
  }
  return { kind: 'doc', id: 'ladder:comments', label: pt('ladderCommentsLabel'), title: pt('ladderCommentsTitle', { title: design.title }), blocks };
}

function xrefRows(entries: readonly XrefEntry[]): string[][] {
  return entries.map((e) => {
    const s = useSummary(e);
    return [e.address, addressKindText(e.kind), s.writes.join(' '), s.reads.join(' ')];
  });
}

/** One cross-reference table per design level that has a ladder program. */
export function ladderXrefTables(design: Design): TableContent[] {
  const out: TableContent[] = [];
  const level = (name: string, sheets: readonly Sheet[], blocks: Design['ladderBlocks']): void => {
    const sources = sheets.filter((s) => s.kind === 'ladder' && s.ladder).map((s) => ({ sheetId: s.id, sheetName: s.name, rungs: s.ladder ?? [] }));
    if (sources.length === 0 && !(blocks?.length ?? 0)) return;
    const entries = crossReference(sources, blocks ?? []);
    const rows = xrefRows(entries);
    if (rows.length === 0) return;
    out.push({
      kind: 'table',
      id: `ladder:xref:${out.length}`,
      label: pt('ladderXrefLabel'),
      table: { title: pt('ladderXrefTitle', { title: name }), header: [lt('colAddress'), lt('colKind'), lt('colWrites'), lt('colReads')], rows, weights: [2, 2, 3, 3] },
    });
  };
  level(design.title, design.sheets, design.ladderBlocks);
  for (const c of design.children ?? []) level(`${design.title} / ${c.name}`, c.sheets, undefined);
  return out;
}

/** Everything the "ladder" choice prints: the comments document, then the cross-reference tables. */
export function ladderContents(design: Design): (DocContent | TableContent)[] {
  const doc = ladderCommentsDoc(design);
  return [...(doc ? [doc] : []), ...ladderXrefTables(design)];
}
