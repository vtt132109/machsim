/**
 * Review round 3: assembly variants (step 4) meet the clipboard and snippets (step 1).
 *
 * A placed part that is "not fitted" in a variant carries `PartInstance.notFitted = [variantId]`,
 * and the design validator (src/model/serialize.ts) rejects a part that names a variant the design
 * does not have. Neither the clipboard nor the snippet code strips or remaps those ids:
 *
 *  1. Edit › Snippets › Save snippet on a selection containing a not-fitted part writes a PNG that
 *     MachSim itself cannot read back: decodeSnippet throws SnippetError 'invalid' ("the snippet
 *     circuit is damaged", issue `fragment.parts[1].notFitted: unknown variant id "v2"`).
 *
 *  2. Copy (Ctrl+C) in a design with variants, open or create ANOTHER design (the editor's clipboard
 *     survives opening a document) and paste (Ctrl+V): the pasted part keeps `notFitted: ["v2"]`.
 *     The editor accepts it, Save writes it, and the saved .msim then fails to OPEN with
 *     "Invalid MachSim design file: … unknown variant id" — the learner's file is lost.
 *
 * Expected: a snippet with a not-fitted part decodes, and a paste into a design without that
 * variant produces a design that saves and opens again. Both fail today.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../../../src/library';
import { DesignBuilder } from '../../../src/model/designkit';
import { parseDesign, serializeDesign } from '../../../src/model/serialize';
import { buildSnippet, decodeSnippet, encodeSnippet } from '../../../src/model/snippet';
import type { Design } from '../../../src/model/types';
import { addVariant, setFitted } from '../../../src/model/variants';
import { copyItems, pasteItems } from '../../../src/ui/store/designOps';
import type { SelItem } from '../../../src/ui/store/types';
import { encodePng } from '../../../src/util/png';

/** LED board with two variants; R2 is not fitted in the second one. */
function board(): { design: Design; variantId: string } {
  const b = new DesignBuilder('Board');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '5' });
  const r1 = b.part('basic/resistor', 'R1', 250, 130, { value: '1k' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 270, { value: '1k' }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 100, 330);
  b.wire(b.pin(v1, '+'), { x: 100, y: 100 }, b.pin(r1, '1'));
  b.connect(r1, '2', r2, '1');
  b.wire(b.pin(r2, '2'), { x: 250, y: 330 }, { x: 100, y: 330 });
  b.wire(b.pin(v1, '-'), { x: 100, y: 330 });
  let d = addVariant(b.design, 'Đủ linh kiện').design;
  const second = addVariant(d, 'Rút gọn');
  d = second.design;
  const r2id = d.sheets[0].parts.find((p) => p.refdes === 'R2')!.id;
  d = setFitted(d, [r2id], second.id, false);
  return { design: d, variantId: second.id };
}

const everything = (d: Design): SelItem[] => {
  const s = d.sheets[0];
  return [...s.parts.map((p) => ({ kind: 'part' as const, id: p.id })), ...s.wires.map((w) => ({ kind: 'wire' as const, id: w.id }))];
};

describe('not-fitted parts on the clipboard and in snippets', () => {
  it('control: the board itself saves and opens again', () => {
    const { design, variantId } = board();
    expect(design.sheets[0].parts.find((p) => p.refdes === 'R2')!.notFitted).toEqual([variantId]);
    expect(() => parseDesign(serializeDesign(design))).not.toThrow();
  });

  it('a snippet saved from a selection with a not-fitted part can be read back', () => {
    const { design } = board();
    const frag = copyItems(design, design.sheets[0].id, everything(design), getPart)!;
    const png = encodeSnippet(encodePng(2, 2, new Uint8Array(16).fill(255)), buildSnippet(design, frag));
    let issues: string[] = [];
    try {
      decodeSnippet(png);
    } catch (e) {
      issues = (e as { issues?: string[] }).issues ?? [String(e)];
    }
    expect(issues).toEqual([]);
  });

  it('pasting into another design gives a design that saves and opens again', () => {
    const { design } = board();
    const frag = copyItems(design, design.sheets[0].id, everything(design), getPart)!;
    const other = new DesignBuilder('Bài khác').design;
    const pasted = pasteItems(other, other.sheets[0].id, frag, { x: 40, y: 40 }, getPart).design;
    expect(pasted.sheets[0].parts.length).toBe(4);
    const text = serializeDesign(pasted);
    expect(() => parseDesign(text)).not.toThrow();
  });
});
