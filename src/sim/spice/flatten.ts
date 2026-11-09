/**
 * Subcircuit flattening (CONTRACT API, owned by the SPICE I/O team).
 * flattenNetlist(n) returns an equivalent netlist with no 'X' elements, evaluated .param
 * expressions and merged models. Naming (ngspice style, type letter stays first):
 *   element R3 inside instance X1        -> "R.X1.R3"   (nested: "R.X1.X2.R3")
 *   internal node n5 inside instance X1  -> "X1.n5"     (ports map to the caller's nodes; "0" stays global)
 *   model/subckt local to a subckt       -> "X1.<model>" when it would clash, otherwise unchanged
 *
 * Details
 * - Global .param values are evaluated in dependency order (cycles and undefined names raise
 *   FlattenError). The output's `params` holds only these numbers (functions and the ".global"
 *   entry are consumed).
 * - An instance `X1 ... sub a=1 b={2*k}` evaluates its overrides (stringParams and numeric params)
 *   in the caller's scope; the subcircuit's PARAMS: defaults and local .param/.func entries are
 *   then evaluated on top of the caller's scope (parameters are visible down the instance
 *   hierarchy, as in ngspice/HSPICE).
 * - Nodes: ports are replaced by the caller's (already mapped) nodes; "0", "gnd" and `.global`
 *   nodes stay global; every other node gets the instance path prefix ("X1.X2.n5").
 * - Device references (F/H/W controls, K inductors, I(...) in B expressions) resolve to an
 *   element of the same instance first, then of the enclosing instances, else stay global.
 * - Models: an element uses the innermost definition of its model name (local .model of the
 *   instance, then of the enclosing instances, then the top level). A local card is evaluated in
 *   its instance's scope ({expr} parameters) and registered under its own name, or under
 *   "<instance path>.<name>" when a different card already uses the name. Subcircuit lookup
 *   follows the same innermost-first rule (local definitions only need lookup, they are expanded,
 *   not emitted).
 * - Element expressions (ElementIR.stringParams, see irfields.ts) are evaluated into their numeric
 *   fields; B-source expressions are rewritten with parameters folded, .func calls inlined and
 *   node/device names mapped, so the device needs no parameter context.
 * - The input is not modified. Flattening an already flat netlist is idempotent.
 */
import type { ElementIR, ModelCard, Netlist, SubcktDef } from '../netlist';
import { formatExpression, parseExpression, resolveExpression } from './expr';
import { applyElementStringParams, cloneElement } from './irfields';
import { buildParamScope, globalNodeSet, isReservedParamKey, type ParamScope } from './params';

/** Error raised while flattening; names the element and its source line when known. */
export class FlattenError extends Error {
  readonly element?: string;
  readonly line?: number;
  constructor(message: string, element?: string, line?: number) {
    super(message);
    this.name = 'FlattenError';
    this.element = element;
    this.line = line;
  }
}

export interface FlattenResult {
  netlist: Netlist;
  /** non-fatal findings, e.g. instance parameters the subcircuit does not declare */
  warnings: string[];
}

/** Flatten (see module header). Throws FlattenError on invalid input. */
export function flattenNetlist(netlist: Netlist): Netlist {
  return flattenNetlistWithWarnings(netlist).netlist;
}

/** Same as flattenNetlist, also returning warnings. */
export function flattenNetlistWithWarnings(netlist: Netlist): FlattenResult {
  return new Flattener(netlist).run();
}

const MAX_DEPTH = 64;

/** Expansion context of one subcircuit instance (or the top level when `def` is undefined). */
interface InstanceCtx {
  /** instance path, e.g. "X1.X2" ('' at the top level) */
  path: string;
  scope: ParamScope;
  def?: SubcktDef;
  parent?: InstanceCtx;
  /** lower-case port name -> caller node */
  portMap: Map<string, string>;
  /** lower-case local element name -> flattened name */
  localNames: Map<string, string>;
  /** lower-case local model name -> output model name */
  modelCache: Map<string, string>;
  /** definitions being expanded (recursion guard) */
  chain: SubcktDef[];
}

function lookupCI<T>(table: Record<string, T>, name: string): T | undefined {
  const key = name.toLowerCase();
  if (Object.hasOwn(table, key)) return table[key];
  for (const k of Object.keys(table)) if (k.toLowerCase() === key) return table[k];
  return undefined;
}

function isDelimited(text: string): boolean {
  const t = text.trim();
  return t.length >= 2 && ((t[0] === '{' && t[t.length - 1] === '}') || (t[0] === "'" && t[t.length - 1] === "'"));
}

function sameModel(a: ModelCard, b: ModelCard): boolean {
  const eqRec = <T>(x: Record<string, T> | undefined, y: Record<string, T> | undefined) => {
    const xk = Object.keys(x ?? {});
    const yk = Object.keys(y ?? {});
    return xk.length === yk.length && xk.every((k) => Object.is(x?.[k], y?.[k]));
  };
  return a.type.toUpperCase() === b.type.toUpperCase() && eqRec(a.params, b.params) && eqRec(a.stringParams, b.stringParams);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class Flattener {
  private readonly elements: ElementIR[] = [];
  private readonly models: Record<string, ModelCard> = {};
  private readonly warnings: string[] = [];
  private readonly emittedNames = new Set<string>();
  /** lower-case model name -> path-prefixed names of local variants registered for it */
  private readonly localVariants = new Map<string, string[]>();
  private readonly globals: Set<string>;

  constructor(private readonly src: Netlist) {
    this.globals = globalNodeSet(src.params);
  }

  run(): FlattenResult {
    const src = this.src;
    let scope: ParamScope;
    try {
      scope = buildParamScope(src.params);
    } catch (e) {
      throw new FlattenError(`.param: ${errorMessage(e)}`);
    }
    for (const [key, card] of Object.entries(src.models)) {
      this.models[key] = this.evaluateModel(card, scope, '');
    }
    const top: InstanceCtx = {
      path: '',
      scope,
      portMap: new Map(),
      localNames: new Map(),
      modelCache: new Map(),
      chain: [],
    };
    for (const el of src.elements) this.visit(el, top);

    const params: Record<string, number> = {};
    for (const key of Object.keys(src.params)) {
      if (isReservedParamKey(key)) continue;
      const v = scope.getParam(key);
      if (v !== undefined) params[key] = v;
    }
    const netlist: Netlist = {
      title: src.title,
      elements: this.elements,
      models: this.models,
      subckts: {},
      params,
      options: { ...src.options },
      analyses: structuredClone(src.analyses),
      ic: { ...src.ic },
      nodeset: { ...src.nodeset },
      saves: [...src.saves],
    };
    if (src.measures?.length) netlist.measures = structuredClone(src.measures);
    return { netlist, warnings: this.warnings };
  }

  // ------------------------------------------------------------------ names

  private mapNode(ctx: InstanceCtx, node: string): string {
    if (!ctx.def) return node;
    const key = node.toLowerCase();
    if (this.globals.has(key)) return node;
    const port = ctx.portMap.get(key);
    if (port !== undefined) return port;
    return `${ctx.path}.${node}`;
  }

  private mapDevice(ctx: InstanceCtx, name: string): string {
    const key = name.toLowerCase();
    for (let c: InstanceCtx | undefined = ctx; c && c.def; c = c.parent) {
      const mapped = c.localNames.get(key);
      if (mapped !== undefined) return mapped;
    }
    return name;
  }

  // ------------------------------------------------------------------ models and subcircuits

  private evaluateModel(card: ModelCard, scope: ParamScope, where: string): ModelCard {
    const out: ModelCard = { name: card.name, type: card.type, params: { ...card.params } };
    const literal: Record<string, string> = {};
    for (const [k, v] of Object.entries(card.stringParams ?? {})) {
      if (!isDelimited(v)) {
        literal[k] = v;
        continue;
      }
      try {
        out.params[k] = scope.evaluate(v);
      } catch (e) {
        throw new FlattenError(`model ${card.name}${where}: parameter ${k}=${v}: ${errorMessage(e)}`);
      }
    }
    if (Object.keys(literal).length > 0) out.stringParams = literal;
    return out;
  }

  /** Output name of the model `name` as seen from `ctx` (innermost definition wins). */
  private resolveModel(ctx: InstanceCtx, name: string): string {
    const key = name.toLowerCase();
    for (let c: InstanceCtx | undefined = ctx; c && c.def; c = c.parent) {
      const cached = c.modelCache.get(key);
      if (cached !== undefined) return cached;
      const local = lookupCI(c.def.models, key);
      if (local) {
        const out = this.registerLocalModel(local, c);
        c.modelCache.set(key, out);
        return out;
      }
    }
    return name;
  }

  private registerLocalModel(card: ModelCard, ctx: InstanceCtx): string {
    const evaluated = this.evaluateModel(card, ctx.scope, ` (in ${ctx.path})`);
    const plainKey = card.name.toLowerCase();
    const existing = this.models[plainKey];
    if (!existing) {
      this.models[plainKey] = evaluated;
      return card.name;
    }
    if (sameModel(existing, evaluated)) return existing.name;
    // reuse an identical variant registered by another instance
    const variants = this.localVariants.get(plainKey) ?? [];
    for (const v of variants) {
      const m = this.models[v.toLowerCase()];
      if (m && sameModel(m, evaluated)) return m.name;
    }
    const name = `${ctx.path}.${card.name}`;
    this.models[name.toLowerCase()] = { ...evaluated, name };
    variants.push(name);
    this.localVariants.set(plainKey, variants);
    return name;
  }

  private findSubckt(ctx: InstanceCtx, name: string): SubcktDef | undefined {
    for (let c: InstanceCtx | undefined = ctx; c; c = c.parent) {
      const table = c.def ? c.def.subckts : this.src.subckts;
      const d = lookupCI(table, name);
      if (d) return d;
    }
    return undefined;
  }

  // ------------------------------------------------------------------ expansion

  private visit(el: ElementIR, ctx: InstanceCtx): void {
    if (el.type === 'X') this.expandInstance(el, ctx);
    else this.emit(el, ctx);
  }

  private fail(el: ElementIR, ctx: InstanceCtx, message: string): FlattenError {
    const full = ctx.def ? `${ctx.path}.${el.name}` : el.name;
    const at = el.line !== undefined ? ` (line ${el.line})` : '';
    return new FlattenError(`${full}${at}: ${message}`, full, el.line);
  }

  private expandInstance(x: ElementIR, ctx: InstanceCtx): void {
    if (!x.model) throw this.fail(x, ctx, 'missing subcircuit name');
    const def = this.findSubckt(ctx, x.model);
    if (!def) throw this.fail(x, ctx, `subcircuit '${x.model}' is not defined`);
    if (ctx.chain.includes(def)) throw this.fail(x, ctx, `recursive instantiation of subcircuit '${def.name}'`);
    if (ctx.chain.length >= MAX_DEPTH) throw this.fail(x, ctx, 'subcircuits nested too deeply');
    if (x.nodes.length !== def.ports.length) {
      throw this.fail(x, ctx, `subcircuit '${def.name}' has ${def.ports.length} port(s) but ${x.nodes.length} node(s) are connected`);
    }

    const overrides = new Map<string, number>();
    for (const [k, v] of Object.entries(x.params)) overrides.set(k.toLowerCase(), v);
    for (const [k, text] of Object.entries(x.stringParams ?? {})) {
      try {
        overrides.set(k.toLowerCase(), ctx.scope.evaluate(text));
      } catch (e) {
        throw this.fail(x, ctx, `parameter ${k}=${text}: ${errorMessage(e)}`);
      }
    }
    const declared = new Set(Object.keys(def.params).filter((k) => !isReservedParamKey(k)).map((k) => k.toLowerCase()));
    for (const k of overrides.keys()) {
      if (!declared.has(k)) this.warnings.push(`${ctx.def ? `${ctx.path}.` : ''}${x.name}: parameter '${k}' is not declared by subcircuit '${def.name}'`);
    }
    let scope: ParamScope;
    try {
      scope = buildParamScope(def.params, ctx.scope, overrides);
    } catch (e) {
      throw this.fail(x, ctx, `subcircuit '${def.name}': ${errorMessage(e)}`);
    }

    const path = ctx.path ? `${ctx.path}.${x.name}` : x.name;
    const portMap = new Map<string, string>();
    def.ports.forEach((p, i) => portMap.set(p.toLowerCase(), this.mapNode(ctx, x.nodes[i])));
    const localNames = new Map<string, string>();
    for (const e of def.elements) {
      if (e.type !== 'X') localNames.set(e.name.toLowerCase(), `${e.type}.${path}.${e.name}`);
    }
    const child: InstanceCtx = {
      path,
      scope,
      def,
      parent: ctx,
      portMap,
      localNames,
      modelCache: new Map(),
      chain: [...ctx.chain, def],
    };
    for (const e of def.elements) this.visit(e, child);
  }

  private emit(el: ElementIR, ctx: InstanceCtx): void {
    const out = cloneElement(el);
    if (ctx.def) {
      out.name = `${el.type}.${ctx.path}.${el.name}`;
      out.nodes = el.nodes.map((n) => this.mapNode(ctx, n));
      if (out.control !== undefined) out.control = this.mapDevice(ctx, out.control);
      if (out.inductors) out.inductors = out.inductors.map((n) => this.mapDevice(ctx, n));
    }
    if (out.model !== undefined) out.model = this.resolveModel(ctx, out.model);
    try {
      applyElementStringParams(out, (text) => ctx.scope.evaluate(text));
    } catch (e) {
      throw this.fail(el, ctx, errorMessage(e));
    }
    if (out.type === 'B') out.expr = this.resolveBehavioral(el, ctx);
    const key = out.name.toLowerCase();
    if (this.emittedNames.has(key)) throw this.fail(el, ctx, `duplicate element name '${out.name}' after flattening`);
    this.emittedNames.add(key);
    this.elements.push(out);
  }

  private resolveBehavioral(el: ElementIR, ctx: InstanceCtx): string {
    const m = /^\s*([VvIi])\s*=([\s\S]*)$/.exec(el.expr ?? '');
    if (!m) throw this.fail(el, ctx, "behavioral expression must be 'V=<expr>' or 'I=<expr>'");
    try {
      const resolved = resolveExpression(
        parseExpression(m[2]),
        ctx.scope.env({
          mapNode: (n) => this.mapNode(ctx, n),
          mapDevice: (d) => this.mapDevice(ctx, d),
        }),
      );
      return `${m[1].toUpperCase()}=${formatExpression(resolved)}`;
    } catch (e) {
      throw this.fail(el, ctx, `${m[1].toUpperCase()}=${m[2].trim()}: ${errorMessage(e)}`);
    }
  }
}
