/**
 * User function blocks of a ladder program: validation and expansion.
 *
 * A {@link LadderBlock} is a named piece of ladder (its own inputs, outputs and rungs) that any
 * rung can run with a `call` coil. The scan machine knows nothing about blocks: before compiling,
 * {@link expandBlocks} turns every call into plain rungs, which keeps the machine, the probes and
 * the A_LADDER device exactly as they were and makes the semantics easy to state:
 *
 *   a call is a coil on a hidden enable bit, followed — in the scan order, right after the calling
 *   rung — by the rungs of the block with the instance's addresses written in.
 *
 * Substitution inside a block body (see the doc of {@link LadderBlock}):
 *   - a formal name (input or output) becomes the actual address of the call;
 *   - `EN` becomes the instance's hidden enable bit, and every rung of the body is put in series
 *     with it, so a block whose calling rung is false does nothing and its coils fall back to 0;
 *   - `#name` becomes memory private to the instance: a bit (`$L<n>`), a timer (`#T1` → `$T33` …),
 *     a counter or a word (`#W1` → `$MW32` …). Two instances never share them;
 *   - every other address stays as written (global).
 * Generated addresses start with "$"; text the learner types never parses with one (the expander
 * rejects it first), so a hidden bit cannot be touched by accident.
 *
 * Pure module: no engine, no DOM, no i18n. Errors come back as {@link LadderError}s whose `rung` is
 * the number of the rung that calls the block (0 = the block itself), `block` and `innerRung`
 * telling where the problem is.
 */
import { normalizeNode } from './edit';
import type { LadderError, LadderErrorCode } from './program';
import { LADDER_LIMITS, type LadderBlock, type LadderNode, type LadderOutput, type LadderRung } from './types';

/** Where an expanded rung came from. */
export type ExpandedSource =
  /** a rung of a ladder sheet, `index` its 0-based position in the program */
  | { kind: 'main'; index: number }
  /** a rung of a block instance that runs after top-level rung `host` (0-based) */
  | { kind: 'block'; host: number; instance: string; block: string; inner: number };

export interface ExpandedEntry {
  rung: LadderRung;
  source: ExpandedSource;
}

export interface Expanded {
  /** rungs in scan order: each calling rung is followed by the rungs of its block instances */
  entries: ExpandedEntry[];
  errors: LadderError[];
  /** top-level rungs (0-based) that must not run because a call or an address in them is wrong */
  failedHosts: number[];
}

/** The implicit input of every block. */
export const BLOCK_ENABLE = 'EN';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for a name usable as a block, an instance or a formal parameter. */
export function isIdentifier(text: string): boolean {
  return IDENT.test(text);
}

/** The block of that name (case-insensitive). */
export function findBlock(blocks: readonly LadderBlock[], name: string): LadderBlock | undefined {
  const key = name.trim().toLowerCase();
  return blocks.find((b) => b.name.trim().toLowerCase() === key);
}

/** An empty block ready to edit (one input, one output, one rung that copies one to the other). */
export function newBlock(id: string, name: string, rungId: string): LadderBlock {
  return {
    id,
    name,
    inputs: ['IN1'],
    outputs: ['OUT1'],
    rungs: [{ id: rungId, comment: '', logic: { kind: 'contact', type: 'no', address: 'IN1' }, outputs: [{ kind: 'coil', address: 'OUT1' }] }],
  };
}

/** Every address text of a rung (contacts, comparison operands, coil addresses and operands, call arguments). */
export function rungTexts(rung: LadderRung): string[] {
  const out: string[] = [];
  const walk = (n: LadderNode | undefined): void => {
    if (!n) return;
    if (n.kind === 'contact') out.push(n.address);
    else if (n.kind === 'compare') out.push(n.left, n.right);
    else n.items.forEach(walk);
  };
  walk(rung.logic);
  for (const o of rung.outputs) {
    out.push(o.address);
    if (o.a !== undefined) out.push(o.a);
    if (o.b !== undefined) out.push(o.b);
    if (o.kind === 'call' && o.args) out.push(...Object.values(o.args));
  }
  return out;
}

/** Problems of the block definitions themselves (names, formal parameters). */
export function validateBlocks(blocks: readonly LadderBlock[]): LadderError[] {
  const errors: LadderError[] = [];
  const seen = new Set<string>();
  const add = (code: LadderErrorCode, block: string, text: string): void => {
    errors.push({ rung: 0, code, text, block });
  };
  for (const b of blocks) {
    const key = b.name.trim().toLowerCase();
    if (!isIdentifier(b.name.trim())) add('blockName', b.name, b.name);
    else if (seen.has(key)) add('blockName', b.name, b.name);
    seen.add(key);
    const formals = new Set<string>([BLOCK_ENABLE.toLowerCase()]);
    for (const f of [...b.inputs, ...b.outputs]) {
      const k = f.trim().toLowerCase();
      if (!isIdentifier(f.trim()) || formals.has(k)) add('blockName', b.name, f);
      formals.add(k);
    }
  }
  return errors;
}

interface Ctx {
  /** instance path ("FB1", "FB1/INNER"); empty at the top level */
  path: string;
  /** lower-case formal name → actual address text; undefined at the top level (nothing to substitute) */
  map?: Map<string, string>;
  block?: string;
  inner: number;
  depth: number;
  /** blocks being expanded, lower-case, to catch a circle */
  stack: string[];
}

interface Alloc {
  bits: number;
  timers: number;
  counters: number;
  words: number;
  /** `${path}|${local name}` (lower-case) → generated address */
  names: Map<string, string>;
  instances: Set<string>;
}

/**
 * Expand the function-block calls of a program. Without any call (and without a stray "$"
 * address) the entries are the original rung objects, untouched.
 */
export function expandBlocks(rungs: readonly LadderRung[], blocks: readonly LadderBlock[] = []): Expanded {
  const errors: LadderError[] = validateBlocks(blocks);
  const failed = new Set<number>();
  const entries: ExpandedEntry[] = [];
  const alloc: Alloc = { bits: 0, timers: LADDER_LIMITS.timers, counters: LADDER_LIMITS.counters, words: LADDER_LIMITS.words, names: new Map(), instances: new Set() };

  rungs.forEach((rung, host) => {
    const typedDollar = rungTexts(rung).find((t) => t.trim().startsWith('$'));
    if (typedDollar !== undefined) {
      errors.push({ rung: host + 1, code: 'badAddress', text: typedDollar.trim() });
      failed.add(host);
      entries.push({ rung, source: { kind: 'main', index: host } });
      return;
    }
    if (!rung.outputs.some((o) => o.kind === 'call')) {
      entries.push({ rung, source: { kind: 'main', index: host } });
      return;
    }
    const local: LadderError[] = [];
    const ctx: Ctx = { path: '', inner: 0, depth: 0, stack: [] };
    const out: ExpandedEntry[] = [];
    emitRung(rung, ctx, host, { kind: 'main', index: host }, out, local, alloc, blocks);
    errors.push(...local);
    if (local.length) {
      failed.add(host);
      // keep the calling rung itself (it is reported and skipped), drop what its blocks produced
      entries.push(out[0]);
    } else entries.push(...out);
  });
  return { entries, errors, failedHosts: [...failed] };
}

type Report = (code: LadderErrorCode, text?: string, limit?: number) => void;

function reporter(ctx: Ctx, host: number, sink: LadderError[]): Report {
  return (code, text, limit) => {
    const e: LadderError = { rung: host + 1, code };
    if (text !== undefined) e.text = text;
    if (limit !== undefined) e.limit = limit;
    if (ctx.block !== undefined) {
      e.block = ctx.block;
      if (ctx.inner > 0) e.innerRung = ctx.inner;
    }
    sink.push(e);
  };
}

/** Address of a private bit / timer / counter / word of an instance (allocated on first use). */
function localAddress(ctx: Ctx, name: string, alloc: Alloc, report: Report): string {
  const key = `${ctx.path}|${name.toLowerCase()}`;
  const known = alloc.names.get(key);
  if (known) return known;
  let address: string;
  const body = name.slice(1);
  let m: RegExpExecArray | null;
  if ((m = /^t(\d+)$/i.exec(body))) {
    if (alloc.timers >= LADDER_LIMITS.timersTotal) {
      report('range', name, LADDER_LIMITS.timersTotal);
      return name;
    }
    address = `$T${++alloc.timers}`;
  } else if ((m = /^c(\d+)$/i.exec(body))) {
    if (alloc.counters >= LADDER_LIMITS.countersTotal) {
      report('range', name, LADDER_LIMITS.countersTotal);
      return name;
    }
    address = `$C${++alloc.counters}`;
  } else if (/^(mw|w)\d+$/i.test(body)) {
    if (alloc.words >= LADDER_LIMITS.wordsTotal) {
      report('range', name, LADDER_LIMITS.wordsTotal);
      return name;
    }
    address = `$MW${alloc.words++}`;
  } else if (IDENT.test(body)) {
    if (alloc.bits >= LADDER_LIMITS.localBits) {
      report('range', name, LADDER_LIMITS.localBits);
      return name;
    }
    address = `$L${alloc.bits++}`;
  } else {
    report('badAddress', name);
    return name;
  }
  alloc.names.set(key, address);
  return address;
}

/** Write one address text of a block body in terms of the instance's actual addresses. */
function resolve(ctx: Ctx, text: string, alloc: Alloc, report: Report): string {
  if (!ctx.map) return text;
  const t = text.trim();
  if (t === '') return text;
  if (t.startsWith('$')) {
    report('badAddress', t);
    return t;
  }
  // "T1.ET" / "C1.CV" keep their suffix
  const m = /^(.*?)(\.(?:et|cv))$/i.exec(t);
  const base = m ? m[1].trim() : t;
  const suffix = m ? m[2] : '';
  const formal = ctx.map.get(base.toLowerCase());
  if (formal !== undefined) return formal + suffix;
  if (base.startsWith('#')) return localAddress(ctx, base, alloc, report) + suffix;
  return t;
}

function mapNode(node: LadderNode, ctx: Ctx, alloc: Alloc, report: Report): LadderNode {
  if (!ctx.map) return node;
  if (node.kind === 'contact') return { ...node, address: resolve(ctx, node.address, alloc, report) };
  if (node.kind === 'compare') return { ...node, left: resolve(ctx, node.left, alloc, report), right: resolve(ctx, node.right, alloc, report) };
  return { kind: node.kind, items: node.items.map((n) => mapNode(n, ctx, alloc, report)) };
}

/** Resolve one rung (and the blocks it calls); pushes the rung first, then the rungs of its calls. */
function emitRung(rung: LadderRung, ctx: Ctx, host: number, source: ExpandedSource, out: ExpandedEntry[], errors: LadderError[], alloc: Alloc, blocks: readonly LadderBlock[]): void {
  const report = reporter(ctx, host, errors);
  const bodies: ExpandedEntry[] = [];
  const outputs: LadderOutput[] = [];
  for (const o of rung.outputs) {
    if (o.kind !== 'call') {
      if (!ctx.map) {
        outputs.push(o);
        continue;
      }
      const r: LadderOutput = { ...o, address: resolve(ctx, o.address, alloc, report) };
      if (o.a !== undefined) r.a = resolve(ctx, o.a, alloc, report);
      if (o.b !== undefined) r.b = resolve(ctx, o.b, alloc, report);
      outputs.push(r);
      continue;
    }
    const call = prepareCall(o, ctx, host, errors, alloc, blocks, bodies);
    outputs.push({ kind: 'coil', address: call ?? '$L0', ...(o.comment !== undefined ? { comment: o.comment } : {}) });
  }
  const logic = rung.logic ? mapNode(rung.logic, ctx, alloc, report) : undefined;
  const resolved: LadderRung = { ...rung, outputs };
  if (logic) resolved.logic = logic;
  else delete resolved.logic;
  out.push({ rung: resolved, source });
  out.push(...bodies);
}

/**
 * Prepare one call: bind the formals, allocate the enable bit and expand the body.
 * Returns the address of the enable bit (null after an error); the body rungs go to `bodies`.
 */
function prepareCall(call: LadderOutput, ctx: Ctx, host: number, errors: LadderError[], alloc: Alloc, blocks: readonly LadderBlock[], bodies: ExpandedEntry[]): string | null {
  const report = reporter(ctx, host, errors);
  const name = (call.block ?? '').trim();
  const def = findBlock(blocks, name);
  if (!def) {
    report('blockUnknown', name || call.address);
    return null;
  }
  const key = def.name.trim().toLowerCase();
  if (ctx.stack.includes(key)) {
    report('blockRecursion', def.name);
    return null;
  }
  if (ctx.depth >= LADDER_LIMITS.blockDepth) {
    report('blockDepth', def.name, LADDER_LIMITS.blockDepth);
    return null;
  }
  const instance = call.address.trim();
  if (!isIdentifier(instance)) {
    report('blockName', instance);
    return null;
  }
  const path = ctx.path ? `${ctx.path}/${instance}` : instance;
  if (alloc.instances.has(path.toLowerCase())) {
    report('blockInstance', instance);
    return null;
  }
  alloc.instances.add(path.toLowerCase());

  const map = new Map<string, string>();
  const args = new Map<string, string>();
  for (const [k, v] of Object.entries(call.args ?? {})) args.set(k.trim().toLowerCase(), v);
  let ok = true;
  for (const formal of [...def.inputs, ...def.outputs]) {
    const actual = resolve(ctx, args.get(formal.trim().toLowerCase()) ?? '', alloc, report).trim();
    if (actual === '') {
      report('blockArg', formal);
      ok = false;
    } else map.set(formal.trim().toLowerCase(), actual);
  }
  if (!ok) return null;

  const child: Ctx = { path, map, block: def.name, inner: 0, depth: ctx.depth + 1, stack: [...ctx.stack, key] };
  const enReport = reporter(child, host, errors);
  const enBit = localAddress(child, '#en', alloc, enReport);
  map.set(BLOCK_ENABLE.toLowerCase(), enBit);
  def.rungs.forEach((r, i) => {
    if (r.disabled) return;
    child.inner = i + 1;
    // the enable contact is written as the formal name EN and resolved with the rest of the rung
    const en: LadderNode = { kind: 'contact', type: 'no', address: BLOCK_ENABLE };
    const gated: LadderRung = { ...r, logic: r.logic ? normalizeNode({ kind: 'series', items: [en, r.logic] }) : en };
    emitRung(gated, child, host, { kind: 'block', host, instance: path, block: def.name, inner: i + 1 }, bodies, errors, alloc, blocks);
  });
  return enBit;
}
