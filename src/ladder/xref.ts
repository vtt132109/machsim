/**
 * Address cross-reference of a ladder program: for every address, where it is READ (contacts,
 * comparison operands, instruction operands) and where it is WRITTEN (coils, timers, counters,
 * word instructions, the outputs of a function-block call), with the rung to jump to.
 *
 *   crossReference(sources, blocks)  -> XrefEntry[] sorted by area then by number
 *   xrefWarnings(entries)            -> addresses that are read but never written / written but never read
 *   xrefText(entries)                -> plain text table (for the print preview and a copy to the clipboard)
 *
 * Pure module. Addresses are normalised so "i0.0", "I0.0" and " I0.0 " are one entry, "T1.ET" is a
 * read of timer T1 and "C2.CV" a read of counter C2. Inside a function block the formal parameters
 * and the private `#names` are listed under the block (`Block.NAME`), because they stand for
 * addresses that only exist once the block is called; the actual addresses of a call are listed
 * with their real names, as a read (an input of the block) or a write (an output).
 */
import { findBlock } from './blocks';
import { formatBitAddress, parseBitAddress, parseNumOperand, parseWordDest } from './program';
import type { LadderBlock, LadderNode, LadderOutput, LadderRung } from './types';

/** What an address is, which decides how it is listed and whether "never written" is a warning. */
export type AddressKind = 'input' | 'output' | 'memory' | 'timer' | 'counter' | 'word' | 'analog-in' | 'analog-out' | 'instance' | 'formal' | 'local' | 'other';

/** Where the rung is: a ladder sheet or the definition of a function block. */
export type XrefScope = { kind: 'sheet'; sheetId: string; sheetName: string } | { kind: 'block'; block: string };

/** Which element of the rung holds the use (so the editor can select it). */
export type XrefSpot = { kind: 'cell'; path: number[] } | { kind: 'coil'; index: number };

export interface XrefUse {
  role: 'read' | 'write';
  scope: XrefScope;
  /** 0-based position of the rung in its sheet / block */
  rungIndex: number;
  rungId: string;
  spot: XrefSpot;
  /** what the element is: the contact type, the coil kind or "operand" */
  how: string;
}

export interface XrefEntry {
  /** normalised address */
  address: string;
  kind: AddressKind;
  uses: XrefUse[];
  reads: number;
  writes: number;
}

export interface XrefSource {
  sheetId: string;
  sheetName: string;
  rungs: readonly LadderRung[];
}

const KIND_ORDER: AddressKind[] = ['input', 'output', 'memory', 'word', 'timer', 'counter', 'analog-in', 'analog-out', 'instance', 'formal', 'local', 'other'];

/** Normalise an address text; null for a literal number or an empty text. */
export function normalizeAddress(text: string): { address: string; kind: AddressKind } | null {
  const t = text.trim();
  if (t === '') return null;
  const bit = parseBitAddress(t);
  if (bit && bit !== 'range') {
    const kind: AddressKind = bit.area === 'I' ? 'input' : bit.area === 'Q' ? 'output' : bit.area === 'M' ? 'memory' : bit.area === 'TD' ? 'timer' : 'counter';
    return { address: formatBitAddress(bit), kind };
  }
  const num = parseNumOperand(t);
  if (num && num !== 'range') {
    switch (num.kind) {
      case 'const':
        return null;
      case 'et':
        return { address: `T${num.n + 1}`, kind: 'timer' };
      case 'cv':
        return { address: `C${num.n + 1}`, kind: 'counter' };
      case 'ai':
        return { address: `AI${num.n}`, kind: 'analog-in' };
      case 'mw':
        return { address: `MW${num.n}`, kind: 'word' };
      case 'aq':
        return { address: `AQ${num.n}`, kind: 'analog-out' };
    }
  }
  const dest = parseWordDest(t);
  if (dest && dest !== 'range') return { address: `${dest.area === 'mw' ? 'MW' : 'AQ'}${dest.n}`, kind: dest.area === 'mw' ? 'word' : 'analog-out' };
  // anything else that looks like a number is a literal ("1k", "4,7")
  if (/^[+-]?[\d.,]/.test(t)) return null;
  return { address: t.toUpperCase(), kind: 'other' };
}

class Collector {
  private readonly map = new Map<string, XrefEntry>();

  add(address: string, kind: AddressKind, use: XrefUse): void {
    const key = `${kind}|${address}`;
    let e = this.map.get(key);
    if (!e) {
      e = { address, kind, uses: [], reads: 0, writes: 0 };
      this.map.set(key, e);
    }
    e.uses.push(use);
    if (use.role === 'read') e.reads++;
    else e.writes++;
  }

  entries(): XrefEntry[] {
    const natural = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...this.map.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || natural(a.address, b.address));
  }
}

interface RungCtx {
  scope: XrefScope;
  rungIndex: number;
  rungId: string;
  /** inside a block: lower-case formal names and the block name */
  block?: { name: string; formals: Set<string> };
}

/** Classify a text found in a rung: a real address, a formal parameter or a private name of a block. */
function classify(ctx: RungCtx, text: string): { address: string; kind: AddressKind } | null {
  const t = text.trim();
  if (t === '') return null;
  if (ctx.block) {
    const base = t.replace(/\.(et|cv)$/i, '');
    if (ctx.block.formals.has(base.toLowerCase())) return { address: `${ctx.block.name}.${base.toUpperCase()}`, kind: 'formal' };
    if (base.startsWith('#')) return { address: `${ctx.block.name}.${base.toUpperCase()}`, kind: 'local' };
  }
  return normalizeAddress(t);
}

function walkLogic(col: Collector, ctx: RungCtx, node: LadderNode | undefined): void {
  const visit = (n: LadderNode, path: number[]): void => {
    if (n.kind === 'series' || n.kind === 'parallel') {
      n.items.forEach((item, i) => visit(item, [...path, i]));
      return;
    }
    const spot: XrefSpot = { kind: 'cell', path };
    const read = (text: string, how: string): void => {
      const c = classify(ctx, text);
      if (c) col.add(c.address, c.kind, { role: 'read', scope: ctx.scope, rungIndex: ctx.rungIndex, rungId: ctx.rungId, spot, how });
    };
    if (n.kind === 'contact') read(n.address, n.type);
    else {
      read(n.left, 'compare');
      read(n.right, 'compare');
    }
  };
  if (node) visit(node, []);
}

function walkOutput(col: Collector, ctx: RungCtx, out: LadderOutput, index: number, blocks: readonly LadderBlock[]): void {
  const spot: XrefSpot = { kind: 'coil', index };
  const use = (role: 'read' | 'write', text: string, how: string): void => {
    const c = classify(ctx, text);
    if (c) col.add(c.address, c.kind, { role, scope: ctx.scope, rungIndex: ctx.rungIndex, rungId: ctx.rungId, spot, how });
  };
  if (out.kind === 'call') {
    const instance = out.address.trim();
    if (instance) col.add(instance.toUpperCase(), 'instance', { role: 'write', scope: ctx.scope, rungIndex: ctx.rungIndex, rungId: ctx.rungId, spot, how: out.block ?? 'call' });
    const def = out.block ? findBlock(blocks, out.block) : undefined;
    if (def) {
      const args = new Map<string, string>();
      for (const [k, v] of Object.entries(out.args ?? {})) args.set(k.trim().toLowerCase(), v);
      for (const f of def.inputs) use('read', args.get(f.trim().toLowerCase()) ?? '', 'call');
      for (const f of def.outputs) use('write', args.get(f.trim().toLowerCase()) ?? '', 'call');
    }
    return;
  }
  use('write', out.address, out.kind);
  if (out.a !== undefined) use('read', out.a, 'operand');
  if (out.b !== undefined) use('read', out.b, 'operand');
}

/** Cross-reference of the rungs of the given sheets and of the function-block definitions. */
export function crossReference(sources: readonly XrefSource[], blocks: readonly LadderBlock[] = []): XrefEntry[] {
  const col = new Collector();
  for (const src of sources) {
    const scope: XrefScope = { kind: 'sheet', sheetId: src.sheetId, sheetName: src.sheetName };
    src.rungs.forEach((rung, rungIndex) => {
      const ctx: RungCtx = { scope, rungIndex, rungId: rung.id };
      walkLogic(col, ctx, rung.logic);
      rung.outputs.forEach((o, i) => walkOutput(col, ctx, o, i, blocks));
    });
  }
  for (const def of blocks) {
    const formals = new Set<string>(['en', ...def.inputs.map((f) => f.trim().toLowerCase()), ...def.outputs.map((f) => f.trim().toLowerCase())]);
    def.rungs.forEach((rung, rungIndex) => {
      const ctx: RungCtx = { scope: { kind: 'block', block: def.name }, rungIndex, rungId: rung.id, block: { name: def.name, formals } };
      walkLogic(col, ctx, rung.logic);
      rung.outputs.forEach((o, i) => walkOutput(col, ctx, o, i, blocks));
    });
  }
  return col.entries();
}

export interface XrefWarning {
  address: string;
  kind: AddressKind;
  /** 'neverWritten': read but nothing writes it; 'neverRead': written but nothing reads it */
  code: 'neverWritten' | 'neverRead';
}

/**
 * Suspicious addresses. Inputs and analog inputs are written by the circuit, outputs and analog
 * outputs are read by the circuit, formal parameters and instances by the call, so none of those
 * count.
 */
export function xrefWarnings(entries: readonly XrefEntry[]): XrefWarning[] {
  const out: XrefWarning[] = [];
  for (const e of entries) {
    if (e.kind === 'instance' || e.kind === 'formal' || e.kind === 'other') continue;
    const drivenOutside = e.kind === 'input' || e.kind === 'analog-in';
    const usedOutside = e.kind === 'output' || e.kind === 'analog-out';
    if (e.reads > 0 && e.writes === 0 && !drivenOutside) out.push({ address: e.address, kind: e.kind, code: 'neverWritten' });
    if (e.writes > 0 && e.reads === 0 && !usedOutside) out.push({ address: e.address, kind: e.kind, code: 'neverRead' });
  }
  return out;
}

/** The uses of one address as "R" / "W" with the rung numbers: `W 1, R 2 3` style, for the table. */
export function useSummary(entry: XrefEntry): { reads: string[]; writes: string[] } {
  const label = (u: XrefUse): string => (u.scope.kind === 'block' ? `${u.scope.block}:${u.rungIndex + 1}` : `${u.rungIndex + 1}`);
  const uniq = (list: string[]): string[] => [...new Set(list)];
  return {
    reads: uniq(entry.uses.filter((u) => u.role === 'read').map(label)),
    writes: uniq(entry.uses.filter((u) => u.role === 'write').map(label)),
  };
}

/** Plain text table: `address  kind  writes  reads`. Columns are separated by tabs. */
export function xrefText(entries: readonly XrefEntry[]): string {
  return entries
    .map((e) => {
      const s = useSummary(e);
      return [e.address, e.kind, s.writes.join(' '), s.reads.join(' ')].join('\t');
    })
    .join('\n');
}
