/**
 * Design variables ("global parameters", Design.variables) and their use in part values.
 *
 * A variable value is either
 *  - a plain number in the user syntax of parseUserNumber ("2k", "4.7u", "1M" = mega, "4,7k" and
 *    "4k7" = 4.7k), or
 *  - an expression ("{2*Rload}", "Rbase*2", "sqrt(L*C)") of numbers and other variables.
 *    Inside expressions numbers follow the SPICE expression syntax of src/sim/spice/expr.ts
 *    (1k, 2.2u, 1meg; "m"/"M" = milli), constants pi, e, ... are available.
 * Variables may refer to each other in any order; cycles and unknown names are reported.
 *
 * A NUMBER parameter of a part may then be written as "{expr}" (as the Properties panel
 * suggests) or as the bare name of a variable; {@link substituteVariables} evaluates such text
 * against the variables and replaces it by the plain number before the part is validated and
 * netlisted. Other parameter kinds (text, select, bool) are never touched.
 *
 * The netlister still exports the variables as `.param` lines (plain numbers converted with the
 * user syntax, expressions kept as text), so SPICE export shows them.
 */
import type { PartDef } from '../library/types';
import { evaluateExpression, stripExpressionDelimiters } from '../sim/spice/expr';
import { isPlainUserNumber, parseUserNumber } from '../util/units';

/** Evaluated design variables (lower-case name -> value) and the problems found. */
export interface VariableScope {
  values: ReadonlyMap<string, number>;
  errors: { name: string; message: string }[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * True when the text is a plain user number with nothing but a suffix / unit word after it
 * ("2k", "10 µF", "4,7k", "4k7"; no expression syntax).
 */
export function isPlainNumber(text: string): boolean {
  return isPlainUserNumber(text.trim());
}

/**
 * Evaluate every design variable; unresolvable ones are left out of `values` and reported.
 * `base` (optional) are values visible to the expressions without being redefined — the parent
 * scope of a child design's instance parameters; they are copied into the result unless a
 * variable of the same name replaces them.
 */
export function resolveDesignVariables(vars: Readonly<Record<string, string>> | undefined, base?: ReadonlyMap<string, number>): VariableScope {
  const raw = new Map<string, { name: string; text: string }>();
  for (const [name, v] of Object.entries(vars ?? {})) raw.set(name.toLowerCase(), { name, text: String(v).trim() });
  const values = new Map<string, number>();
  if (base) for (const [k, v] of base) if (!raw.has(k)) values.set(k, v);
  const errors: { name: string; message: string }[] = [];
  const failed = new Set<string>();
  const visiting = new Set<string>();

  const resolve = (key: string): number | undefined => {
    const done = values.get(key);
    if (done !== undefined) return done;
    if (failed.has(key)) return undefined;
    const entry = raw.get(key);
    if (!entry) return undefined;
    if (visiting.has(key)) throw new CycleError(entry.name);
    visiting.add(key);
    try {
      let v: number;
      if (isPlainNumber(entry.text)) v = parseUserNumber(entry.text);
      else {
        v = evaluateExpression(stripExpressionDelimiters(entry.text), {
          params: (name: string) => (raw.has(name) ? resolve(name) : base?.get(name)),
        });
      }
      if (!Number.isFinite(v)) throw new Error(`'${entry.text}' is not a finite number`);
      values.set(key, v);
      return v;
    } catch (e) {
      if (e instanceof CycleError && e.origin !== entry.name) throw e;
      failed.add(key);
      const message = e instanceof CycleError ? 'refers to itself (circular definition)' : e instanceof Error ? e.message : String(e);
      errors.push({ name: entry.name, message });
      return undefined;
    } finally {
      visiting.delete(key);
    }
  };
  for (const key of raw.keys()) resolve(key);
  return { values, errors };
}

/**
 * Value of a parameter text in a scope: a plain user number ("2k"), "{expr}", a bare variable
 * name or a bare expression ("2*gain").
 */
export function evaluateParamText(text: string, scope: VariableScope): { value: number } | { error: string } {
  const t = text.trim();
  if (t === '') return { error: 'empty value' };
  if (isPlainNumber(t)) {
    const v = parseUserNumber(t);
    return Number.isFinite(v) ? { value: v } : { error: `'${t}' is not a number` };
  }
  const ref = resolveParamText(t, scope);
  if (ref) return ref;
  try {
    const value = evaluateExpression(stripExpressionDelimiters(t), { params: scope.values });
    return Number.isFinite(value) ? { value } : { error: 'the expression is not a finite number' };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Scope of one instance of a child design: the parent's values, the instance's overrides
 * (evaluated in the parent scope) and the child's remaining defaults (evaluated in the child,
 * where they may use the overrides, each other and the parent's values). Keys of `overrides`
 * that the child does not declare are ignored; empty override texts mean "use the default".
 */
export function childVariableScope(parent: VariableScope, defaults: Readonly<Record<string, string>>, overrides: Readonly<Record<string, string>>): VariableScope {
  const base = new Map(parent.values);
  const errors: { name: string; message: string }[] = [];
  const declared = new Map(Object.keys(defaults).map((k) => [k.toLowerCase(), k]));
  const rest: Record<string, string> = {};
  const overridden = new Set<string>();
  for (const [k, text] of Object.entries(overrides)) {
    const name = declared.get(k.toLowerCase());
    if (name === undefined || String(text).trim() === '') continue;
    const r = evaluateParamText(String(text), parent);
    if ('error' in r) errors.push({ name, message: r.error });
    else {
      base.set(name.toLowerCase(), r.value);
      overridden.add(name.toLowerCase());
    }
  }
  for (const [k, v] of Object.entries(defaults)) if (!overridden.has(k.toLowerCase())) rest[k] = v;
  const res = resolveDesignVariables(rest, base);
  return { values: res.values, errors: [...errors, ...res.errors] };
}

/** Thrown while resolving a circular variable definition; caught where the cycle started. */
class CycleError extends Error {
  constructor(readonly origin: string) {
    super(`circular definition of ${origin}`);
  }
}

/**
 * Value of a parameter text that refers to design variables: "{expr}" or a bare variable name.
 * Returns null when the text is not such a reference (an ordinary value), otherwise the value or
 * the reason it cannot be evaluated.
 */
export function resolveParamText(text: string, scope: VariableScope): { value: number } | { error: string } | null {
  const t = text.trim();
  const braced = t.length > 2 && t.startsWith('{') && t.endsWith('}');
  if (!braced) {
    if (!IDENT.test(t) || !scope.values.has(t.toLowerCase())) return null;
    return { value: scope.values.get(t.toLowerCase())! };
  }
  try {
    const value = evaluateExpression(stripExpressionDelimiters(t), { params: scope.values });
    if (!Number.isFinite(value)) return { error: 'the expression is not a finite number' };
    return { value };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Parameters with variable references in NUMBER parameters replaced by their values (as plain
 * number text). `params` are the merged values (defaults + instance); the input is returned
 * unchanged when nothing refers to a variable.
 */
export function substituteVariables(
  def: PartDef,
  params: Record<string, string>,
  scope: VariableScope,
): { params: Record<string, string>; errors: { key: string; label: string; text: string; message: string }[] } {
  let out = params;
  const errors: { key: string; label: string; text: string; message: string }[] = [];
  for (const p of def.params) {
    if (p.kind !== 'number') continue;
    const text = params[p.key];
    if (text === undefined) continue;
    const r = resolveParamText(text, scope);
    if (r === null) continue;
    if ('error' in r) {
      errors.push({ key: p.key, label: p.label, text: text.trim(), message: r.error });
      continue;
    }
    if (out === params) out = { ...params };
    out[p.key] = String(r.value);
  }
  return { params: out, errors };
}

/** `.param` value of a design variable: a number for plain numbers, the text for expressions. */
export function variableParamValue(text: string): number | string {
  const t = String(text).trim();
  if (t !== '' && isPlainNumber(t)) {
    const v = parseUserNumber(t);
    if (Number.isFinite(v)) return v;
  }
  return t;
}
