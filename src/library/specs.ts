/**
 * Parametric data of catalogue parts (LibraryPartDef.specs): the keys the component browser can
 * filter and compare on, their SI unit and kind. Labels come from the i18n catalogue
 * (`spec.<key>` in src/i18n/messages/catalog.ts); values are stored in SI units (A, V, W, Hz, F,
 * Ω, s) or as text (package, polarity, colour …).
 */
import type { PartDef } from './types';
import type { LibraryPartDef } from './partkit';

export interface SpecDef {
  unit: string;
  kind: 'num' | 'text';
}

export const SPEC_DEFS = {
  resistance: { unit: 'Ω', kind: 'num' },
  capacitance: { unit: 'F', kind: 'num' },
  inductance: { unit: 'H', kind: 'num' },
  power: { unit: 'W', kind: 'num' },
  tolerance: { unit: '%', kind: 'num' },
  vrating: { unit: 'V', kind: 'num' },
  irating: { unit: 'A', kind: 'num' },
  vz: { unit: 'V', kind: 'num' },
  vrrm: { unit: 'V', kind: 'num' },
  io: { unit: 'A', kind: 'num' },
  vf: { unit: 'V', kind: 'num' },
  trr: { unit: 's', kind: 'num' },
  vbr: { unit: 'V', kind: 'num' },
  vwm: { unit: 'V', kind: 'num' },
  ppk: { unit: 'W', kind: 'num' },
  cj: { unit: 'F', kind: 'num' },
  igt: { unit: 'A', kind: 'num' },
  vdrm: { unit: 'V', kind: 'num' },
  vceo: { unit: 'V', kind: 'num' },
  ic: { unit: 'A', kind: 'num' },
  hfe: { unit: '', kind: 'num' },
  ft: { unit: 'Hz', kind: 'num' },
  vds: { unit: 'V', kind: 'num' },
  id: { unit: 'A', kind: 'num' },
  rdson: { unit: 'Ω', kind: 'num' },
  vth: { unit: 'V', kind: 'num' },
  ciss: { unit: 'F', kind: 'num' },
  idss: { unit: 'A', kind: 'num' },
  vp: { unit: 'V', kind: 'num' },
  gbw: { unit: 'Hz', kind: 'num' },
  slew: { unit: 'V/s', kind: 'num' },
  vos: { unit: 'V', kind: 'num' },
  vsupply: { unit: 'V', kind: 'num' },
  iq: { unit: 'A', kind: 'num' },
  vout: { unit: 'V', kind: 'num' },
  iout: { unit: 'A', kind: 'num' },
  dropout: { unit: 'V', kind: 'num' },
  vin: { unit: 'V', kind: 'num' },
  freq: { unit: 'Hz', kind: 'num' },
  z0: { unit: 'Ω', kind: 'num' },
  gain: { unit: 'V/V', kind: 'num' },
  speed: { unit: 'rpm', kind: 'num' },
  positions: { unit: '', kind: 'num' },
  pitch: { unit: 'mm', kind: 'num' },
  coil: { unit: 'V', kind: 'num' },
  tpd: { unit: 's', kind: 'num' },
  words: { unit: '', kind: 'num' },
  bits: { unit: '', kind: 'num' },
  polarity: { unit: '', kind: 'text' },
  package: { unit: '', kind: 'text' },
  color: { unit: '', kind: 'text' },
  input: { unit: '', kind: 'text' },
  output: { unit: '', kind: 'text' },
  contacts: { unit: '', kind: 'text' },
  curve: { unit: '', kind: 'text' },
  direction: { unit: '', kind: 'text' },
} satisfies Record<string, SpecDef>;

export type SpecKey = keyof typeof SPEC_DEFS;

export const SPEC_KEYS = Object.keys(SPEC_DEFS) as SpecKey[];

export function isSpecKey(k: string): k is SpecKey {
  return Object.prototype.hasOwnProperty.call(SPEC_DEFS, k);
}

/** Parametric data of a part (empty for parts without). */
export function partSpecs(part: PartDef): Readonly<Record<string, number | string>> {
  return (part as LibraryPartDef).specs ?? {};
}
