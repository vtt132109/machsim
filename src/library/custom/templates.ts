/**
 * Symbol templates of the component wizard: a ready symbol for the common kinds of component
 * (two-terminal parts, diodes, transistors, op-amps, thyristor, transformer, motor, line) and a
 * generic rectangular IC body with any number of pins. Every template is built from MachSim's own
 * symbol artwork (src/library/symbols.ts and the generic library parts), never from another product.
 *
 *   SYMBOL_TEMPLATES          template list (id, default prefix / group / family)
 *   templateSymbol(id, opts)  a fresh SymbolDef (deep copy, safe to edit)
 *   boxTemplate(left, right)  rectangular IC with pins "1".."n" (left side top-down, then right)
 */
import { getPart } from '../index';
import { ampSymbol, bjtSymbol, boxSymbol, jfetSymbol, mosfetSymbol, type BoxPin } from '../symbols';
import type { PartGroup, SymbolDef } from '../types';

export type SymbolTemplateId =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'zener'
  | 'schottky'
  | 'led'
  | 'npn'
  | 'pnp'
  | 'nmos'
  | 'pmos'
  | 'njfet'
  | 'pjfet'
  | 'opamp'
  | 'opamp3'
  | 'scr'
  | 'transformer'
  | 'motor3'
  | 'tline'
  | 'box';

export interface SymbolTemplate {
  id: SymbolTemplateId;
  prefix: string;
  group: PartGroup;
  /** built-in family a part of this kind usually goes into */
  family: string;
}

export const SYMBOL_TEMPLATES: readonly SymbolTemplate[] = [
  { id: 'resistor', prefix: 'R', group: 'basic', family: 'Resistor' },
  { id: 'capacitor', prefix: 'C', group: 'basic', family: 'Capacitor' },
  { id: 'inductor', prefix: 'L', group: 'basic', family: 'Inductor' },
  { id: 'diode', prefix: 'D', group: 'diodes', family: 'Generic diode' },
  { id: 'zener', prefix: 'D', group: 'diodes', family: 'Zener diode' },
  { id: 'schottky', prefix: 'D', group: 'diodes', family: 'Schottky diode' },
  { id: 'led', prefix: 'LED', group: 'diodes', family: 'LED' },
  { id: 'npn', prefix: 'Q', group: 'transistors', family: 'NPN BJT' },
  { id: 'pnp', prefix: 'Q', group: 'transistors', family: 'PNP BJT' },
  { id: 'nmos', prefix: 'Q', group: 'transistors', family: 'N-channel MOSFET' },
  { id: 'pmos', prefix: 'Q', group: 'transistors', family: 'P-channel MOSFET' },
  { id: 'njfet', prefix: 'J', group: 'transistors', family: 'N-channel JFET' },
  { id: 'pjfet', prefix: 'J', group: 'transistors', family: 'P-channel JFET' },
  { id: 'opamp', prefix: 'U', group: 'analog', family: 'Op-amp' },
  { id: 'opamp3', prefix: 'U', group: 'analog', family: 'Op-amp' },
  { id: 'scr', prefix: 'D', group: 'diodes', family: 'Thyristor' },
  { id: 'transformer', prefix: 'T', group: 'basic', family: 'Transformer' },
  { id: 'motor3', prefix: 'M', group: 'electromechanical', family: 'Motor' },
  { id: 'tline', prefix: 'T', group: 'rf', family: 'Transmission line' },
  { id: 'box', prefix: 'U', group: 'misc', family: 'User' },
];

/** Library part whose symbol a template copies. */
const FROM_PART: Partial<Record<SymbolTemplateId, string>> = {
  resistor: 'basic/resistor',
  capacitor: 'basic/capacitor',
  inductor: 'basic/inductor',
  diode: 'diodes/diode',
  zener: 'diodes/zener',
  schottky: 'diodes/schottky',
  led: 'diodes/led',
  scr: 'diodes/scr',
  transformer: 'basic/transformer',
  motor3: 'electromechanical/induction-motor-3ph',
  tline: 'rf/transmission-line',
};

export function templateInfo(id: SymbolTemplateId): SymbolTemplate {
  return SYMBOL_TEMPLATES.find((t) => t.id === id) ?? SYMBOL_TEMPLATES[SYMBOL_TEMPLATES.length - 1];
}

/** Deep copy of a symbol (templates and library symbols must never be edited in place). */
export function cloneSymbol(s: SymbolDef): SymbolDef {
  return JSON.parse(JSON.stringify(s)) as SymbolDef;
}

/** Rectangular IC body with `left` + `right` pins named and numbered "1".."n" (counter-clockwise like a DIP). */
export function boxTemplate(left: number, right: number, title = ''): SymbolDef {
  const l = Math.max(0, Math.min(64, Math.round(left)));
  const r = Math.max(0, Math.min(64, Math.round(right)));
  const leftPins: BoxPin[] = Array.from({ length: l }, (_, i) => ({ name: String(i + 1), number: String(i + 1) }));
  // right side numbered bottom-up (DIP order), listed top-down
  const rightPins: BoxPin[] = Array.from({ length: r }, (_, i) => ({ name: String(l + r - i), number: String(l + r - i) }));
  return boxSymbol({ left: leftPins, right: rightPins, w: 80, title: title || undefined });
}

export interface TemplateOptions {
  /** box: pins on the left / right side */
  left?: number;
  right?: number;
  /** box: text in the body */
  title?: string;
}

/** A fresh symbol for a template. */
export function templateSymbol(id: SymbolTemplateId, opts: TemplateOptions = {}): SymbolDef {
  switch (id) {
    case 'npn':
      return bjtSymbol(false);
    case 'pnp':
      return bjtSymbol(true);
    case 'nmos':
      return mosfetSymbol(false);
    case 'pmos':
      return mosfetSymbol(true);
    case 'njfet':
      return jfetSymbol(false);
    case 'pjfet':
      return jfetSymbol(true);
    case 'opamp':
      return ampSymbol({ supplies: true });
    case 'opamp3':
      return ampSymbol();
    case 'box':
      return boxTemplate(opts.left ?? 4, opts.right ?? 4, opts.title);
    default: {
      const def = getPart(FROM_PART[id] ?? '');
      return def ? cloneSymbol(def.symbol) : boxTemplate(1, 1);
    }
  }
}
