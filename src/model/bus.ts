/**
 * Bus names and bus lines (members).
 *
 * Syntax of a bus name (case is kept, comparisons are case-insensitive):
 *   D[0..7]          -> D0, D1, ..., D7          (vector, ascending)
 *   ADDR[15..8]      -> ADDR15, ADDR14, ..., ADDR8 (vector, descending)
 *   A,B,C            -> A, B, C                  (list)
 *   D[0..3],CLK,EN   -> D0..D3, CLK, EN          (mixed)
 * A name without "[a..b]" and without a comma is a scalar name with one member (itself).
 *
 * Bus lines behave like net names local to their sheet (see Wire in src/model/types.ts): line
 * "D3" of a bus is the same net as a local label "D3" on that sheet. A connector (off-page,
 * hierarchical, global) whose name is a vector name connects every line separately, so
 * "D[0..7]" on two sheets joins D0..D7 of both. A hierarchical connector with a vector name
 * becomes a bus pin of the block; the lines of the bus wired to that pin map by position.
 */

/** Largest number of lines a bus name may expand to. */
export const MAX_BUS_WIDTH = 256;

export interface ParsedBusName {
  /** expanded line names in order (one entry for a scalar name) */
  members: string[];
  /** true when the name uses a range or a list (a real bus name) */
  vector: boolean;
  /** problem with the syntax (members are then empty) */
  error?: string;
}

const RANGE = /^([A-Za-z_][A-Za-z0-9_]*)?\[\s*(\d+)\s*\.\.\s*(\d+)\s*\]$/;

/** Expand a bus name (see module header). */
export function parseBusName(name: string): ParsedBusName {
  const text = name.trim();
  if (text === '') return { members: [], vector: false, error: 'empty name' };
  const parts = text.split(',').map((p) => p.trim());
  const vector = parts.length > 1 || text.includes('[');
  const members: string[] = [];
  for (const part of parts) {
    if (part === '') return { members: [], vector, error: 'empty item in the list' };
    if (part.includes('[') || part.includes(']')) {
      const m = RANGE.exec(part);
      if (!m) return { members: [], vector, error: `'${part}' is not a range like D[0..7]` };
      const base = m[1] ?? '';
      const a = Number(m[2]);
      const b = Number(m[3]);
      const step = a <= b ? 1 : -1;
      if (Math.abs(b - a) + 1 + members.length > MAX_BUS_WIDTH) return { members: [], vector, error: `more than ${MAX_BUS_WIDTH} lines` };
      for (let i = a; ; i += step) {
        members.push(`${base}${i}`);
        if (i === b) break;
      }
    } else {
      if (/\s/.test(part)) return { members: [], vector, error: `'${part}' contains a space` };
      members.push(part);
    }
    if (members.length > MAX_BUS_WIDTH) return { members: [], vector, error: `more than ${MAX_BUS_WIDTH} lines` };
  }
  const seen = new Set<string>();
  for (const m of members) {
    const k = m.toLowerCase();
    if (seen.has(k)) return { members: [], vector, error: `line '${m}' appears twice` };
    seen.add(k);
  }
  return { members, vector };
}

/** True for vector / list names ("D[0..7]", "A,B"). */
export function isVectorName(name: string): boolean {
  const p = parseBusName(name);
  return p.vector && !p.error;
}

/** Lines of a bus name ([] when the name is invalid). */
export function busMembers(name: string): string[] {
  return parseBusName(name).members;
}

/** Compact vector name for `base` lines from..to, e.g. vectorName('D', 0, 7) = "D[0..7]". */
export function vectorName(base: string, from: number, to: number): string {
  return `${base}[${from}..${to}]`;
}

/**
 * Merge the line lists of several bus names (order of first appearance, case-insensitive).
 * Used when bus wires with different names are connected (bus merge).
 */
export function mergeMembers(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names) {
    for (const m of busMembers(n)) {
      const k = m.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(m);
      }
    }
  }
  return out;
}

/**
 * Suggest the next bus line for an entry: the first line of `members` not in `used`
 * (case-insensitive), or the first line when all are used.
 */
export function nextFreeMember(members: string[], used: Iterable<string>): string | undefined {
  const u = new Set([...used].map((s) => s.toLowerCase()));
  return members.find((m) => !u.has(m.toLowerCase())) ?? members[0];
}
