/**
 * Net settings follow the net, not the wires (pure).
 *
 * `Design.nets` keys a colour and the PCB properties by **net name**. The Net settings dialog
 * paints the wires that were on the net when it was opened, which is not enough: a wire the
 * learner draws into that net afterwards, a wire that a paste brings in, a net that grows when two
 * labels are joined — all of those have to show the colour too, or the colour looks like a
 * property of individual wires.
 *
 *   followNetColors(design, lookup)   the design with every wire of every coloured net recoloured
 *   netWiresOf(design, lookup)        the nets of every design level with their wire ids
 *   renameNetAcrossSettings(design, from, to)
 *                                     a label rename carries the net's settings with it (merging
 *                                     when the new name already has settings)
 *
 * `followNetColors` runs on every commit of the editor store, so it is a cheap no-op for a design
 * that never opened the dialog: it returns immediately when no entry of `Design.nets` has a colour.
 */
import type { Design } from '../../model/types';
import { applyNetColors, mergeNetSettings, netSettings, type NetWires } from '../../model/netSettings';
import { computeConnectivity } from './connectivity';
import type { PartLookup } from './types';

/** True when some net of the design has a wire colour (the only case worth computing nets for). */
function hasNetColor(design: Pick<Design, 'nets'>): boolean {
  return Object.values(design.nets ?? {}).some((s) => !!s.color);
}

/**
 * The nets of every design level with the ids of their wires. Each level is computed on its own
 * (a child design's sheets are a level of their own), exactly as the canvas highlights nets.
 */
export function netWiresOf(design: Design, lookup: PartLookup): NetWires[] {
  const out: NetWires[] = [];
  const level = (sheets: Design['sheets']) => {
    const conn = computeConnectivity({ ...design, sheets }, lookup);
    const sheetOfWire = new Map<string, string>();
    for (const s of sheets) for (const w of s.wires) sheetOfWire.set(w.id, s.id);
    for (const net of conn.nets) {
      if (!net.wireIds.length) continue;
      out.push({ name: net.name, wires: net.wireIds.map((id) => ({ sheetId: sheetOfWire.get(id) ?? '', wireId: id })) });
    }
  };
  level(design.sheets);
  for (const c of design.children ?? []) level(c.sheets);
  return out;
}

/** The design with every wire of every coloured net carrying that net's colour. */
export function followNetColors(design: Design, lookup: PartLookup): Design {
  if (!hasNetColor(design)) return design;
  return applyNetColors(design, netWiresOf(design, lookup));
}

/**
 * Carry the settings of net `from` over to net `to` after a label was renamed. Nothing happens
 * when the old name had no settings; when the new name already has some, the fields of the
 * renamed net win and the rest is kept (`mergeNetSettings`).
 */
export function renameNetAcrossSettings(design: Design, from: string, to: string): Design {
  const a = from.trim();
  const b = to.trim();
  if (!a || !b || a.toLowerCase() === b.toLowerCase() || !netSettings(design, a)) return design;
  return mergeNetSettings(design, a, b);
}
