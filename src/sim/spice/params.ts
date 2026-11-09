/**
 * Parameter scopes for `.param`, `.func` and subcircuit `PARAMS:`.
 *
 * Netlist IR encoding (the IR has no dedicated fields for these, see the SPICE I/O report):
 *   Netlist.params / SubcktDef.params
 *     "name"          -> number or expression text (no braces)       (.param / PARAMS:)
 *     "fname(a,b)"    -> function body expression text               (.func fname(a,b) {body})
 *     ".global"       -> space-separated global node names (Netlist only)  (.global)
 *   Keys containing "(" are functions; keys starting with "." are reserved directives.
 *
 * buildParamScope() evaluates such a table in dependency order (cycle detection) on top of a
 * parent scope. Function bodies are lexically scoped: they see the parameters and functions of
 * the scope that defines them. Names are case-insensitive (stored lower-case).
 */

import {
  ExprError,
  calledFunctions,
  freeIdentifiers,
  parseExpression,
  resolveExpression,
  stripExpressionDelimiters,
  type ExprNode,
  type ResolveEnv,
  type UserFunction,
} from './expr';

/** Reserved Netlist.params key holding `.global` node names (space separated). */
export const GLOBAL_NODES_KEY = '.global';

/** Error in a parameter table; `param` names the offending entry when known. */
export class ParamError extends Error {
  readonly param?: string;
  constructor(message: string, param?: string) {
    super(message);
    this.name = 'ParamError';
    this.param = param;
  }
}

/** True when a params-table key encodes a `.func` definition. */
export function isFuncKey(key: string): boolean {
  return key.includes('(');
}

/** True for keys that are not plain parameters (functions and reserved "." keys). */
export function isReservedParamKey(key: string): boolean {
  return key.startsWith('.') || isFuncKey(key);
}

/** Encode a function signature as a params-table key: makeFuncKey('f', ['a','b']) -> "f(a,b)". */
export function makeFuncKey(name: string, args: readonly string[]): string {
  return `${name}(${args.join(',')})`;
}

/** Decode a function key; undefined when the key is not a well-formed signature. */
export function parseFuncKey(key: string): { name: string; args: string[] } | undefined {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^()]*)\)\s*$/.exec(key);
  if (!m) return undefined;
  const inner = m[2].trim();
  const args = inner === '' ? [] : inner.split(',').map((s) => s.trim());
  if (args.some((a) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(a))) return undefined;
  return { name: m[1], args };
}

/** Global node names declared with `.global` (lower-case), always including "0" and "gnd". */
export function globalNodeSet(params: Record<string, number | string>): Set<string> {
  const out = new Set(['0', 'gnd']);
  const raw = params[GLOBAL_NODES_KEY];
  if (typeof raw === 'string') {
    for (const n of raw.split(/\s+/)) if (n) out.add(n.toLowerCase());
  }
  return out;
}

/** A lexical scope of evaluated parameters and user functions, chained to its parent. */
export class ParamScope {
  readonly parent?: ParamScope;
  private readonly values = new Map<string, number>();
  private readonly funcs = new Map<string, UserFunction>();

  /** Parameter lookup usable as ResolveEnv.params. */
  readonly paramLookup = (name: string): number | undefined => this.getParam(name);
  /** Function lookup usable as ResolveEnv.funcs. */
  readonly funcLookup = (name: string): UserFunction | undefined => this.getFunction(name);

  constructor(parent?: ParamScope) {
    this.parent = parent;
  }

  getParam(name: string): number | undefined {
    const key = name.toLowerCase();
    for (let s: ParamScope | undefined = this; s; s = s.parent) {
      const v = s.values.get(key);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  getFunction(name: string): UserFunction | undefined {
    const key = name.toLowerCase();
    for (let s: ParamScope | undefined = this; s; s = s.parent) {
      const f = s.funcs.get(key);
      if (f) return f;
    }
    return undefined;
  }

  /** True when `name` is defined in this scope itself (not a parent). */
  hasOwnParam(name: string): boolean {
    return this.values.has(name.toLowerCase());
  }

  setParam(name: string, value: number): void {
    this.values.set(name.toLowerCase(), value);
  }

  /** Define a function in this scope; its body sees this scope (lexical scoping). */
  defineFunction(name: string, args: readonly string[], body: string | ExprNode): UserFunction {
    const fn: UserFunction = {
      name,
      args: [...args],
      body: typeof body === 'string' ? parseExpression(stripExpressionDelimiters(body)) : body,
      params: this.paramLookup,
      funcs: this.funcLookup,
    };
    this.funcs.set(name.toLowerCase(), fn);
    return fn;
  }

  /** Parameters defined directly in this scope (lower-case keys). */
  ownParams(): Record<string, number> {
    return Object.fromEntries(this.values);
  }

  /** Resolution environment for this scope, merged with `extra` (e.g. node mapping). */
  env(extra: Partial<ResolveEnv> = {}): ResolveEnv {
    return { params: this.paramLookup, funcs: this.funcLookup, ...extra };
  }

  /**
   * Evaluate a constant expression ("{...}" / "'...'" delimiters allowed) in this scope.
   * Throws ExprError for syntax errors, unknown names, references to V()/I()/runtime variables,
   * or a NaN result.
   */
  evaluate(text: string | ExprNode): number {
    const ast = typeof text === 'string' ? parseExpression(stripExpressionDelimiters(text)) : text;
    const r = resolveExpression(ast, this.env());
    if (r.kind !== 'num') {
      throw new ExprError('expression is not constant (it references circuit quantities or time)');
    }
    if (Number.isNaN(r.value)) throw new ExprError('expression evaluates to NaN');
    return r.value;
  }

  /** Like evaluate(), but returns undefined instead of throwing. */
  tryEvaluate(text: string): number | undefined {
    try {
      return this.evaluate(text);
    } catch {
      return undefined;
    }
  }
}

/** Free identifiers of an expression, following calls into user functions of `scope`. */
function dependencies(ast: ExprNode, scope: ParamScope, seen = new Set<string>()): Set<string> {
  const out = freeIdentifiers(ast);
  for (const fname of calledFunctions(ast)) {
    if (seen.has(fname)) continue;
    seen.add(fname);
    const fn = scope.getFunction(fname);
    if (!fn) continue;
    const args = new Set(fn.args.map((a) => a.toLowerCase()));
    for (const d of dependencies(fn.body, scope, seen)) if (!args.has(d)) out.add(d);
  }
  return out;
}

/**
 * Evaluate a parameter table into a new scope on top of `parent`.
 * - Function keys ("f(a,b)") are defined first; reserved "." keys are skipped.
 * - `overrides` (lower-case name -> value, already evaluated by the caller) replace entries.
 * - Entries are evaluated in dependency order; cycles and undefined names throw ParamError.
 */
export function buildParamScope(
  table: Readonly<Record<string, number | string>>,
  parent?: ParamScope,
  overrides?: ReadonlyMap<string, number>,
): ParamScope {
  const scope = new ParamScope(parent);
  const pending = new Map<string, { name: string; ast: ExprNode }>();

  for (const [key, raw] of Object.entries(table)) {
    if (key.startsWith('.')) continue;
    if (isFuncKey(key)) {
      const sig = parseFuncKey(key);
      if (!sig) throw new ParamError(`invalid function signature '${key}'`, key);
      try {
        scope.defineFunction(sig.name, sig.args, String(raw));
      } catch (e) {
        throw new ParamError(`.func ${sig.name}: ${(e as Error).message}`, key);
      }
    }
  }

  for (const [key, raw] of Object.entries(table)) {
    if (isReservedParamKey(key)) continue;
    const lower = key.toLowerCase();
    const ov = overrides?.get(lower);
    if (ov !== undefined) {
      scope.setParam(lower, ov);
      continue;
    }
    if (typeof raw === 'number') {
      scope.setParam(lower, raw);
      continue;
    }
    try {
      pending.set(lower, { name: key, ast: parseExpression(stripExpressionDelimiters(raw)) });
    } catch (e) {
      throw new ParamError(`parameter '${key}': ${(e as Error).message}`, key);
    }
  }
  if (overrides) {
    for (const [k, v] of overrides) if (!scope.hasOwnParam(k) && !pending.has(k)) scope.setParam(k, v);
  }

  // Depth-first topological evaluation with cycle detection.
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (lower: string): void => {
    const st = state.get(lower);
    if (st === 'done') return;
    const entry = pending.get(lower);
    if (!entry) return;
    if (st === 'visiting') {
      const cycle = [...stack.slice(stack.indexOf(lower)), lower].map((n) => pending.get(n)?.name ?? n);
      throw new ParamError(`circular parameter definition: ${cycle.join(' -> ')}`, entry.name);
    }
    state.set(lower, 'visiting');
    stack.push(lower);
    for (const dep of dependencies(entry.ast, scope)) if (pending.has(dep)) visit(dep);
    stack.pop();
    try {
      scope.setParam(lower, scope.evaluate(entry.ast));
    } catch (e) {
      throw new ParamError(`parameter '${entry.name}': ${(e as Error).message}`, entry.name);
    }
    state.set(lower, 'done');
  };
  for (const lower of pending.keys()) visit(lower);
  return scope;
}
