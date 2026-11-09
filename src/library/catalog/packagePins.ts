/**
 * Pin numbers that follow the package a part is drawn in. A table row names ONE package for a whole
 * family and the hand-written symbols number their pins like the DIP-8 they were drawn for, so a part
 * placed in a 5-pin SOT-23 or a 3-pin SOT-23 / TO-52 reference needs its numbers changed to match the
 * footprint (a KiCad netlist with pin 6 on a 5-pad footprint is unusable).
 *
 *   fitPackage(part)     single op-amp / comparator in SOT-23-5 / SOT-23-6: the DBV pin-out; a dual or
 *                        quad section moves to the SOIC of its chip
 *   fitReference(part)   series voltage reference in a 3-lead package: IN 1, OUT 2, GND 3
 *   withPinNumbers(part, map)   the part with some pins renumbered
 *
 * Original data written for MachSim: the usual public SOT-23 / TO-52 pin-outs.
 */
import type { LibraryPartDef } from '../partkit';

/** SOT-23-5 / SC-70-5 numbering of a single op-amp or comparator (the usual DBV / DCK pin-out). */
export const SOT5: Record<string, string> = { OUT: '1', 'V-': '2', 'IN+': '3', 'IN-': '4', 'V+': '5' };

/** The part with the pins named in `map` renumbered. */
export function withPinNumbers(part: LibraryPartDef, map: Record<string, string> | undefined): LibraryPartDef {
  if (!map) return part;
  return { ...part, symbol: { ...part.symbol, pins: part.symbol.pins.map((p) => (map[p.name] !== undefined ? { ...p, number: map[p.name] } : p)) } };
}

/**
 * A table row names one package for all of its types, but a dual or quad is never sold in a 5-pin SOT-23
 * (its single-amplifier part is drawn in the SO-8 / SO-14 of the chip), and a genuine 5-pin part has the
 * SOT-23-5 numbering instead of the DIP-8 one.
 */
export function fitPackage(part: LibraryPartDef): LibraryPartDef {
  if ((part.footprint !== 'SOT-23-5' && part.footprint !== 'SOT-23-6') || part.pkg) return part;
  const quad = /one section of the quad/.test(part.description);
  if (quad || /one section of the dual/.test(part.description)) return { ...part, footprint: quad ? 'SOIC-14' : 'SOIC-8' };
  return withPinNumbers(part, part.footprint === 'SOT-23-6' ? { ...SOT5, 'V+': '6' } : SOT5);
}

/** The usual 3-lead numbering of a series voltage reference (SOT-23-3, TO-52): IN 1, OUT 2, GND 3 (the SO-8 versions keep IN 2, OUT 6, GND 4). */
export function fitReference(part: LibraryPartDef): LibraryPartDef {
  const threeLead = part.footprint === 'SOT-23' || part.footprint === 'TO-52';
  return threeLead && part.symbol.pins.some((p) => p.name === 'IN') ? withPinNumbers(part, { IN: '1', OUT: '2', GND: '3' }) : part;
}
