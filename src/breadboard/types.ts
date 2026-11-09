/**
 * Virtual breadboard layout (CONTRACT — additive changes only).
 *
 * A design may carry one breadboard layout in Design.breadboard. The breadboard is a second,
 * physical view of the same circuit: schematic parts are placed with their leads in breadboard
 * holes and joined with jumper wires. Connectivity comes from the board's internal strips, and
 * is compared against the schematic netlist to teach correct wiring.
 *
 * Hole addressing (per board):
 *   terminal strips: column 1..N (left to right) and row 'a'..'j'; rows a–e of one column are one
 *                    strip, rows f–j another (the centre channel separates them).
 *   power rails:     row 'top+' | 'top-' | 'bot+' | 'bot-' with column 1..N; each rail is one
 *                    strip along the board (full-length rails; split rails are a board option).
 */

export type BoardKind = 'full' | 'half' | 'mini';

export type BreadboardRow = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'top+' | 'top-' | 'bot+' | 'bot-';

export interface BreadboardHole {
  board: string;
  row: BreadboardRow;
  col: number;
}

export interface BoardInstance {
  id: string;
  kind: BoardKind;
  /** board origin on the bench in millimetres (boards can be placed side by side) */
  x: number;
  y: number;
  /** split power rails in the middle (common on full-size boards) */
  splitRails?: boolean;
}

export interface PartPlacement {
  /** schematic refdes */
  refdes: string;
  /** hole for every lead, keyed by the PartDef pin name */
  pins: Record<string, BreadboardHole>;
  /** rotation of the body around the vertical axis, degrees */
  rotation?: number;
  /** body lift above the board in mm (for parts straddling others) */
  lift?: number;
}

export interface JumperWire {
  id: string;
  from: BreadboardHole;
  to: BreadboardHole;
  /** CSS colour */
  color: string;
}

/** Off-board items such as bench supplies/instruments connect through clips to holes. */
export interface ClipLead {
  id: string;
  /** schematic refdes (source or instrument) and its pin name */
  refdes: string;
  pin: string;
  hole: BreadboardHole;
  color: string;
}

export interface BreadboardLayout {
  version: 1;
  boards: BoardInstance[];
  placements: PartPlacement[];
  wires: JumperWire[];
  clips: ClipLead[];
}

export function emptyBreadboard(): BreadboardLayout {
  return { version: 1, boards: [{ id: 'bb1', kind: 'full', x: 0, y: 0 }], placements: [], wires: [], clips: [] };
}
