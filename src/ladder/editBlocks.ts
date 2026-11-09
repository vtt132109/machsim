/**
 * Editing helpers for word instructions and function-block calls (the parts of the ladder editor
 * that do not fit src/ladder/edit.ts without a circular import): changing the kind of a coil,
 * naming new blocks and instances, keeping calls in step with a renamed block.
 */
import type { Design } from '../model/types';
import { isWordOutput, parseBitAddress, parseWordDest } from './program';
import type { LadderBlock, LadderOutput, LadderOutputKind, LadderRung } from './types';

/**
 * The output `o` changed to another kind, with the fields the new kind needs and without the ones
 * it does not: a word instruction gets an address of a memory word and two operands, a call gets a
 * block and an empty argument list, an ordinary coil goes back to a bit address. What the learner
 * typed that still makes sense (the comment, the address of a bit, the preset) is kept.
 */
export function retypeOutput(o: LadderOutput, kind: LadderOutputKind, blocks: readonly LadderBlock[], instance = 'FB1'): LadderOutput {
  const next: LadderOutput = { kind, address: o.address };
  if (o.comment !== undefined) next.comment = o.comment;
  const bit = parseBitAddress(o.address);
  const isBit = bit !== null && bit !== 'range';
  const isWordDest = parseWordDest(o.address) !== null;
  if (isWordOutput(kind)) {
    if (!isWordDest) next.address = 'MW0';
    next.a = o.a ?? '0';
    if (kind !== 'mov') next.b = o.b ?? '1';
    return next;
  }
  if (kind === 'call') {
    next.address = isWordDest || isBit ? instance : o.address;
    const block = blocks.find((b) => b.name === o.block) ?? blocks[0];
    if (block) next.block = block.name;
    next.args = o.args ?? {};
    return next;
  }
  if (kind === 'ton' || kind === 'tof') {
    if (!isBit || bit.area !== 'TD') next.address = 'T1';
    next.preset = o.preset ?? '1';
    return next;
  }
  if (kind === 'ctu' || kind === 'ctd' || kind === 'creset') {
    if (!isBit || bit.area !== 'CD') next.address = 'C1';
    if (kind !== 'creset') next.preset = o.preset ?? '10';
    return next;
  }
  // a plain coil / set / reset drives a bit
  if (!isBit || bit.area === 'I' || bit.area === 'TD' || bit.area === 'CD') next.address = 'Q0.0';
  return next;
}

/** Every `call` output of the given rungs, in order. */
export function callsIn(rungs: readonly LadderRung[]): LadderOutput[] {
  return rungs.flatMap((r) => r.outputs.filter((o) => o.kind === 'call'));
}

/** An instance name ("FB1", "FB2" …) not in `taken` (case-insensitive). */
export function nextInstanceName(taken: readonly string[], base = 'FB'): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()));
  for (let n = 1; ; n++) if (!used.has(`${base}${n}`.toLowerCase())) return `${base}${n}`;
}

/** A block name ("Block1", "Block2" …) not used by `blocks`. */
export function nextBlockName(blocks: readonly LadderBlock[], base = 'Block'): string {
  return nextInstanceName(blocks.map((b) => b.name), base);
}

/** The rungs with every call of block `from` pointing at block `to` (a block was renamed). */
export function renameBlockCalls(rungs: readonly LadderRung[], from: string, to: string): LadderRung[] {
  const key = from.trim().toLowerCase();
  let changed = false;
  const out = rungs.map((r) => {
    if (!r.outputs.some((o) => o.kind === 'call' && (o.block ?? '').trim().toLowerCase() === key)) return r;
    changed = true;
    return { ...r, outputs: r.outputs.map((o) => (o.kind === 'call' && (o.block ?? '').trim().toLowerCase() === key ? { ...o, block: to } : o)) };
  });
  return changed ? out : (rungs as LadderRung[]);
}

/** A call's arguments with the parameters the block declares (extra keys dropped, missing ones empty). */
export function argsFor(block: LadderBlock, args: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...block.inputs, ...block.outputs]) out[f] = args?.[f] ?? '';
  return out;
}

/** Calls of block `name` in the ladder sheets of every level and in the bodies of the blocks. */
export function countCalls(design: Pick<Design, 'sheets' | 'children' | 'ladderBlocks'>, name: string): number {
  const key = name.trim().toLowerCase();
  const count = (rungs: readonly LadderRung[] | undefined): number =>
    (rungs ?? []).reduce((a, r) => a + r.outputs.filter((o) => o.kind === 'call' && (o.block ?? '').trim().toLowerCase() === key).length, 0);
  let n = 0;
  for (const s of [...design.sheets, ...(design.children ?? []).flatMap((c) => c.sheets)]) if (s.kind === 'ladder') n += count(s.ladder);
  for (const b of design.ladderBlocks ?? []) n += count(b.rungs);
  return n;
}

/** The design with block `id` renamed and every call (sheets of every level, other blocks) following it. */
export function renameLadderBlock(design: Design, id: string, name: string): Design {
  const blocks = design.ladderBlocks ?? [];
  const old = blocks.find((b) => b.id === id)?.name;
  if (old === undefined || old === name) return design;
  const sheets = (list: Design['sheets']): Design['sheets'] => list.map((s) => (s.kind === 'ladder' && s.ladder ? { ...s, ladder: renameBlockCalls(s.ladder, old, name) } : s));
  const next: Design = { ...design, sheets: sheets(design.sheets) };
  if (design.children) next.children = design.children.map((c) => ({ ...c, sheets: sheets(c.sheets) }));
  next.ladderBlocks = blocks.map((b) => ({ ...b, ...(b.id === id ? { name } : {}), rungs: renameBlockCalls(b.rungs, old, name) }));
  return next;
}

/**
 * The blocks of `existing` plus those of `incoming` whose name is not there yet (case-insensitive).
 * A block that comes along keeps its definition; its id is changed when it clashes with another id.
 * Used when a design becomes a hierarchical block of another one: the rungs of its ladder sheets
 * call blocks defined in the root design it came from, and those calls must still find them.
 */
export function mergeLadderBlocks(existing: readonly LadderBlock[] | undefined, incoming: readonly LadderBlock[] | undefined): LadderBlock[] {
  return mergeLadderBlocksReport(existing, incoming).blocks;
}

/** What a block's behaviour is, without ids (two blocks with the same program are the same block). */
function blockProgram(b: LadderBlock): string {
  return JSON.stringify([b.inputs, b.outputs, b.rungs.map((r) => [r.logic, r.outputs])]);
}

/** {@link mergeLadderBlocksReport} result. */
export interface LadderBlockMerge {
  blocks: LadderBlock[];
  /** incoming blocks that kept their program but had to take another name (a DIFFERENT block of that name was already there) */
  renamed: { from: string; to: string }[];
}

/**
 * {@link mergeLadderBlocks} that also tells what it renamed. A block of the same name and the same
 * program is the same block and is not added again; a block of the same name with ANOTHER program
 * is added under a free name ("Motor" -> "Motor_2"), because letting the existing block answer to
 * its calls would silently run the wrong logic. The calls inside the added blocks follow the new
 * names; the caller applies `renamed` to the incoming sheets with {@link renameBlockCalls}.
 */
export function mergeLadderBlocksReport(existing: readonly LadderBlock[] | undefined, incoming: readonly LadderBlock[] | undefined): LadderBlockMerge {
  const out = [...(existing ?? [])];
  const names = new Set(out.map((b) => b.name.trim().toLowerCase()));
  const ids = new Set(out.map((b) => b.id));
  const renamed: { from: string; to: string }[] = [];
  const added: number[] = [];
  for (const b of incoming ?? []) {
    const key = b.name.trim().toLowerCase();
    let name = b.name;
    if (names.has(key)) {
      const same = out.find((x) => x.name.trim().toLowerCase() === key);
      if (same && blockProgram(same) === blockProgram(b)) continue;
      for (let k = 2; names.has(name.trim().toLowerCase()) || name === b.name; k++) name = `${b.name}_${k}`;
      renamed.push({ from: b.name, to: name });
    }
    names.add(name.trim().toLowerCase());
    let id = b.id;
    for (let k = 2; ids.has(id); k++) id = `${b.id}-${k}`;
    ids.add(id);
    added.push(out.length);
    out.push(id === b.id && name === b.name ? b : { ...b, id, name });
  }
  for (const r of renamed) for (const i of added) out[i] = { ...out[i], rungs: renameBlockCalls(out[i].rungs, r.from, r.to) };
  return { blocks: out, renamed };
}
