/**
 * A part's simulation fragment with default values, and a fingerprint of its whole definition
 * (pure, small: no SPICE writer, so the save path can use it).
 *
 *   pinNodes(def)          pin name -> node name used in listings (SPICE identifier, unique)
 *   partFragment(def)      def.toSpice with default parameters and the pins as nodes (null when the
 *                          part has no model or it throws)
 *   partFingerprint(def)   8-hex-digit CRC-32 of the pins (name, position, type, number), the
 *                          parameters (key, kind, default, unit, options), the footprint and the
 *                          simulation fragment: equal fingerprints = the same definition
 *   libraryRef(def)        the PartLibraryRef a design keeps for a placed part (Design.libraryRefs)
 */
import { defaultParams } from './index';
import type { PartDef } from './types';
import { elementName, internalNodeName, type ToSpiceContextExt } from './partkit';
import { parseUserNumber } from '../util/units';
import { crc32 } from '../util/zip';
import type { PartLibraryRef } from '../model/types';

/** Node name of a pin in listings: the pin name as a SPICE identifier, unique per part. */
export function pinNodes(def: PartDef): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  def.symbol.pins.forEach((p, i) => {
    let n = p.name.replace(/\+/g, 'p').replace(/-/g, 'n').replace(/[^A-Za-z0-9_]/g, '_') || `pin${i + 1}`;
    if (/^\d/.test(n)) n = `p${n}`;
    while (used.has(n.toLowerCase())) n = `${n}_${i + 1}`;
    used.add(n.toLowerCase());
    out.set(p.name, n);
  });
  return out;
}

/** The part's simulation fragment with default parameters (pins as nodes); null when none or it fails. */
export function partFragment(def: PartDef, refdes = `${def.prefix || 'U'}1`): ReturnType<NonNullable<PartDef['toSpice']>> | null {
  if (!def.toSpice) return null;
  const params = defaultParams(def);
  const nodes = pinNodes(def);
  const ctx: ToSpiceContextExt = {
    refdes,
    params,
    node: (pin) => nodes.get(pin) ?? `nc_${pin}`,
    num: (key) => {
      const v = parseUserNumber(params[key] ?? '');
      if (!Number.isFinite(v)) throw new Error(`bad value for ${key}`);
      return v;
    },
    name: (type, suffix) => elementName(type, refdes, suffix),
    internal: (s) => internalNodeName(refdes, s),
    connected: () => true,
    resolveNet: () => undefined,
  };
  try {
    return def.toSpice(ctx);
  } catch {
    return null;
  }
}

/** JSON with numbers that are not finite written as text (JSON.stringify would write null). */
function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isFinite(x) ? String(x) : typeof x === 'function' ? undefined : x));
}

const fingerprints = new WeakMap<PartDef, string>();

/** Fingerprint of a part definition (see the module header); memoised per definition object. */
export function partFingerprint(def: PartDef): string {
  const hit = fingerprints.get(def);
  if (hit) return hit;
  const frag = partFragment(def);
  const text = stableJson({
    pins: def.symbol.pins.map((p) => [p.name, p.x, p.y, p.type ?? '', p.number ?? '']),
    params: def.params.map((p) => [p.key, p.kind, p.default, p.unit ?? '', (p.options ?? []).map((o) => o.value)]),
    footprint: def.footprint ?? '',
    model: frag ? { elements: frag.elements, models: frag.models ?? [], subckts: frag.subckts ?? [] } : null,
  });
  const sig = (crc32(new TextEncoder().encode(text)) >>> 0).toString(16).padStart(8, '0');
  fingerprints.set(def, sig);
  return sig;
}

/** The reference a design keeps of a placed part's library definition. */
export function libraryRef(def: PartDef): PartLibraryRef {
  const pins: Record<string, [number, number]> = {};
  for (const p of def.symbol.pins) pins[p.name] = [p.x, p.y];
  return { sig: partFingerprint(def), pins, defaults: defaultParams(def) };
}
