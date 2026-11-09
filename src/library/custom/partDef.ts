/**
 * Turn a user component (`CustomPartData`, types.ts) into a library `PartDef` the editor, the
 * netlister and the BOM can use, and check a component for problems before it is saved.
 *
 *   customPartDef(data)       -> CustomPartDef (memoised per data object)
 *   customPartProblems(data)  -> CustomPartProblem[] (empty = ready to save and simulate)
 *
 * Simulation (see CustomModel in types.ts):
 *   'spice'    `.subckt` -> one X element "X_<refdes>" whose nodes are the mapped symbol pins
 *              (number parameters are passed as subcircuit PARAMS overrides);
 *              `.model`  -> one device element (D / Q / M / J / Z) named after the refdes;
 *              the card itself and every top-level card it references are emitted with it.
 *   'builtin'  the master-library part's toSpice runs with its pins re-mapped to the new symbol
 *              (indicators, interactive keys, burn-out ratings and instrument-free extras follow).
 *   'none'     no toSpice: the part is drawn and listed in the BOM but not simulated.
 * A component with an LED indicator gets a 0 V sense source in series with model terminal 0, so the
 * schematic glow reads the diode current (same as the library LEDs).
 */
import { defaultParams, getPart } from '../index';
import {
  asLibraryPart,
  elD,
  elJ,
  elM,
  elQ,
  elSense,
  elementName,
  internalNode,
  numParam,
  type InstrumentBindContext,
  type LibraryPartDef,
  type ToSpiceContextExt,
} from '../partkit';
import { ledIndicatorParams } from '../parts/diodes';
import type { ParamDef, PartDef, SpiceFragment, ToSpiceContext } from '../types';
import type { ElementIR } from '../../sim/netlist';
import { DEVICE_TERMINALS, findModelCard, findSubckt, modelDependencies, modelTerminals, parseModelLibrary, type ModelLibrary } from './spiceModels';
import { CUSTOM_PREFIX, isCustomPartId, type CustomPartData } from './types';

/** A PartDef built from user data; `custom` is the data it came from. */
export interface CustomPartDef extends LibraryPartDef {
  custom: CustomPartData;
}

export function isCustomPartDef(def: PartDef | undefined): def is CustomPartDef {
  return !!def && (def as Partial<CustomPartDef>).custom !== undefined && isCustomPartId(def.id);
}

// ---------------------------------------------------------------------------------------------
// parsed model text (memoised by text)

const libCache = new Map<string, ModelLibrary>();

/** Parsed model text of a 'spice' component (memoised; the cache keeps the 200 most recent texts). */
export function parsedModelText(text: string): ModelLibrary {
  const hit = libCache.get(text);
  if (hit) return hit;
  const lib = parseModelLibrary(text);
  if (libCache.size >= 200) libCache.delete(libCache.keys().next().value as string);
  libCache.set(text, lib);
  return lib;
}

// ---------------------------------------------------------------------------------------------
// PartDef

const defCache = new WeakMap<CustomPartData, CustomPartDef>();

/** The master-library part a 'builtin' model reuses (never a user component or a block). */
export function builtinBase(partId: string): LibraryPartDef | undefined {
  if (isCustomPartId(partId) || partId.startsWith('hier:')) return undefined;
  const def = getPart(partId);
  return def ? asLibraryPart(def) : undefined;
}

/** Parameters of a component: its own list, the reused library part's (with new defaults), LED display params. */
function partParams(data: CustomPartData): ParamDef[] {
  const out: ParamDef[] = [];
  if (data.model.kind === 'builtin') {
    const base = builtinBase(data.model.partId);
    const over = data.model.params ?? {};
    for (const p of base?.params ?? []) out.push(over[p.key] !== undefined ? { ...p, default: over[p.key] } : p);
  } else {
    out.push(...(data.params ?? []));
  }
  if (data.indicator?.kind === 'led' && !out.some((p) => p.key === 'color')) out.push(...ledIndicatorParams(data.indicator.color));
  return out;
}

function spiceToSpice(data: CustomPartData & { model: { kind: 'spice' } }, ctx: ToSpiceContext): SpiceFragment {
  const m = data.model;
  const lib = parsedModelText(m.text);
  if (lib.errors.length) throw new Error(`the part's SPICE text has an error on line ${lib.errors[0].line}: ${lib.errors[0].message}`);
  const terminals = modelTerminals(lib, m.name);
  if (!terminals) throw new Error(`model ${m.name} is not defined in the part's SPICE text`);
  const nodes = terminals.map((term, i) => {
    const pin = m.pins[i] ?? '';
    if (pin) return ctx.node(pin);
    if (i === 3 && terminals.length === 4 && findModelCard(lib, m.name)) return ''; // MOSFET bulk -> source below
    throw new Error(`model terminal ${term} is not connected to a symbol pin`);
  });
  const elements: ElementIR[] = [];
  if (data.indicator?.kind === 'led' && nodes.length > 0) {
    const mid = internalNode(ctx, 'led');
    elements.push(elSense(ctx.name('V', 'i'), nodes[0], mid));
    nodes[0] = mid;
  }
  const deps = modelDependencies(lib, m.name);
  const sub = findSubckt(lib, m.name);
  if (sub) {
    const stringParams: Record<string, string> = {};
    for (const p of data.params ?? []) {
      if (p.kind !== 'number' || ctx.params[p.key] === undefined || ctx.params[p.key].trim() === '') continue;
      stringParams[p.key] = String(ctx.num(p.key));
    }
    const x: ElementIR = { type: 'X', name: ctx.name('X'), nodes, model: sub.name, params: {} };
    if (Object.keys(stringParams).length) x.stringParams = stringParams;
    elements.push(x);
  } else {
    const card = findModelCard(lib, m.name)!;
    const dev = DEVICE_TERMINALS[card.type.toUpperCase()];
    const name = (letter: string) => ctx.name(letter);
    switch (dev.element) {
      case 'D':
        elements.push(elD(name('D'), nodes[0], nodes[1], card.name));
        break;
      case 'Q':
        elements.push(elQ(name('Q'), nodes[0], nodes[1], nodes[2], card.name));
        break;
      case 'M':
        elements.push(elM(name('M'), nodes[0], nodes[1], nodes[2], nodes[3] || nodes[2], card.name));
        break;
      case 'J':
        elements.push(elJ(name('J'), nodes[0], nodes[1], nodes[2], card.name));
        break;
      default:
        elements.push({ type: 'Z', name: name('Z'), nodes: nodes.slice(0, 3), model: card.name, params: {} });
    }
  }
  return { elements, models: deps.models, subckts: deps.subckts };
}

function builtinToSpice(data: CustomPartData & { model: { kind: 'builtin' } }, ctx: ToSpiceContext): SpiceFragment {
  const base = builtinBase(data.model.partId);
  if (!base?.toSpice) throw new Error(`library part ${data.model.partId} is not available`);
  const map = data.model.pinMap;
  const pinOf = (libPin: string): string => {
    const p = map[libPin];
    if (!p) throw new Error(`pin ${libPin} of ${base.name} is not connected to a symbol pin`);
    return p;
  };
  const ext = ctx as ToSpiceContextExt;
  const sub: ToSpiceContextExt = {
    ...ext,
    params: { ...defaultParams(base), ...ctx.params },
    node: (pin) => ctx.node(pinOf(pin)),
    ...(ext.connected ? { connected: (pin: string) => ext.connected!(pinOf(pin)) } : {}),
  };
  return base.toSpice(sub);
}

/** Library part of a user component (memoised per data object). */
export function customPartDef(data: CustomPartData): CustomPartDef {
  const hit = defCache.get(data);
  if (hit) return hit;
  const base = data.model.kind === 'builtin' ? builtinBase(data.model.partId) : undefined;
  const def: CustomPartDef = {
    id: data.id,
    name: data.name,
    group: data.group,
    family: data.family,
    description: data.description,
    prefix: data.prefix,
    symbol: data.symbol,
    params: partParams(data),
    custom: data,
  };
  if (data.footprint) def.footprint = data.footprint;
  if (data.hyperlink) def.hyperlink = data.hyperlink;
  if (data.keywords?.length) def.keywords = data.keywords;
  def.provenance = data.provenance ?? (base ? base.provenance : undefined);
  const model = data.model;
  if (model.kind === 'spice') {
    def.toSpice = (ctx) => spiceToSpice({ ...data, model }, ctx);
  } else if (model.kind === 'builtin' && base) {
    const map = model.pinMap;
    const mapPin = (pin: string) => map[pin] ?? pin;
    if (base.toSpice) def.toSpice = (ctx) => builtinToSpice({ ...data, model }, ctx);
    if (base.globalNet !== undefined) def.globalNet = base.globalNet;
    if (base.interactive) def.interactive = base.interactive;
    if (base.indicator) def.indicator = base.indicator;
    if (base.virtual) def.virtual = base.virtual;
    if (base.optionalPins) def.optionalPins = base.optionalPins.map(mapPin);
    if (base.groundWhenOpen) def.groundWhenOpen = base.groundWhenOpen.map(mapPin);
    if (base.specs) def.specs = base.specs;
    if (base.ratings) {
      const r = base.ratings;
      def.ratings = {
        ...r,
        ...(r.current ? { current: { ...r.current, pin: mapPin(r.current.pin) } } : {}),
        ...(r.voltages ? { voltages: r.voltages.map((v) => ({ ...v, pins: [mapPin(v.pins[0]), mapPin(v.pins[1])] as [string, string] })) } : {}),
        ...(r.openPin ? { openPin: mapPin(r.openPin) } : {}),
      };
    }
    if (base.bindIndicator) {
      const bind = base.bindIndicator;
      def.bindIndicator = (b: InstrumentBindContext) => bind({ ...b, params: { ...defaultParams(base), ...b.params }, net: (pin) => b.net(mapPin(pin)) });
    }
  }
  if (data.indicator?.kind === 'led' && model.kind === 'spice') {
    def.indicator = { kind: 'led' };
    def.bindIndicator = (b) => ({ signal: { kind: 'current', element: elementName('V', b.refdes, 'i') } });
  }
  // a reused library part of a catalogue pack that is not loaded yet: build again once it is
  if (data.model.kind !== 'builtin' || base) defCache.set(data, def);
  return def;
}

// ---------------------------------------------------------------------------------------------
// problems

export type CustomPartProblemCode =
  | 'noName'
  | 'badId'
  | 'noPins'
  | 'duplicatePin'
  | 'emptyPinName'
  | 'noPrefix'
  | 'spiceError'
  | 'modelMissing'
  | 'modelUnusable'
  | 'terminalUnmapped'
  | 'pinUnknown'
  | 'pinUsedTwice'
  | 'builtinMissing'
  | 'builtinPinUnmapped'
  | 'includeMissing';

export interface CustomPartProblem {
  code: CustomPartProblemCode;
  params?: Record<string, string | number>;
}

/** Everything that would stop a component from being saved or simulated (empty list = fine). */
export function customPartProblems(data: CustomPartData): CustomPartProblem[] {
  const out: CustomPartProblem[] = [];
  if (!data.name.trim()) out.push({ code: 'noName' });
  if (!data.id.startsWith(CUSTOM_PREFIX) || data.id.length <= CUSTOM_PREFIX.length) out.push({ code: 'badId', params: { id: data.id } });
  if (!data.prefix.trim()) out.push({ code: 'noPrefix' });
  const pins = data.symbol.pins.map((p) => p.name);
  if (pins.length === 0) out.push({ code: 'noPins' });
  const seen = new Set<string>();
  for (const p of pins) {
    if (!p.trim()) out.push({ code: 'emptyPinName' });
    else if (seen.has(p)) out.push({ code: 'duplicatePin', params: { pin: p } });
    seen.add(p);
  }
  const m = data.model;
  if (m.kind === 'spice') {
    const lib = parsedModelText(m.text);
    if (lib.errors.length) out.push({ code: 'spiceError', params: { line: lib.errors[0].line, message: lib.errors[0].message } });
    for (const inc of lib.missing) out.push({ code: 'includeMissing', params: { file: inc } });
    if (!findSubckt(lib, m.name) && !findModelCard(lib, m.name)) out.push({ code: 'modelMissing', params: { name: m.name } });
    else {
      const terms = modelTerminals(lib, m.name);
      if (!terms) out.push({ code: 'modelUnusable', params: { name: m.name, type: findModelCard(lib, m.name)?.type ?? '' } });
      else checkMapping(terms, m.pins, pins, out, !!findModelCard(lib, m.name) && terms.length === 4);
    }
  } else if (m.kind === 'builtin') {
    const base = builtinBase(m.partId);
    if (!base) out.push({ code: 'builtinMissing', params: { id: m.partId } });
    else {
      const used = new Map<string, string>();
      for (const bp of base.symbol.pins) {
        const target = m.pinMap[bp.name];
        if (!target) out.push({ code: 'builtinPinUnmapped', params: { pin: bp.name } });
        else if (!pins.includes(target)) out.push({ code: 'pinUnknown', params: { pin: target } });
        else if (used.has(target) && !base.globalNet) out.push({ code: 'pinUsedTwice', params: { pin: target } });
        used.set(target, bp.name);
      }
    }
  }
  return out;
}

function checkMapping(terms: readonly string[], mapped: readonly string[], pins: readonly string[], out: CustomPartProblem[], bulkOptional: boolean): void {
  const used = new Set<string>();
  terms.forEach((term, i) => {
    const pin = mapped[i] ?? '';
    if (!pin) {
      if (!(bulkOptional && i === 3)) out.push({ code: 'terminalUnmapped', params: { terminal: term } });
      return;
    }
    if (!pins.includes(pin)) out.push({ code: 'pinUnknown', params: { pin } });
    else if (used.has(pin)) out.push({ code: 'pinUsedTwice', params: { pin } });
    used.add(pin);
  });
}

/** Number parameters for the PARAMS: defaults of a subcircuit (the wizard offers them in Properties). */
export function subcktParamDefs(params: Record<string, string>): ParamDef[] {
  return Object.entries(params).map(([key, def]) => numParam(key, key, def.replace(/^\{|\}$/g, ''), undefined, { group: 'model' }));
}
