/**
 * Logic converter "expression → circuit": turns a minimised sum of products into a gate circuit
 * on a schematic fragment, either AND-OR (with NOT gates for complemented inputs) or NAND only
 * (NAND-NAND, inverters are NAND gates with tied inputs).
 *
 * Gate library: the ideal gates of the misc-digital group (AND / OR / NAND with 2 to 4 inputs,
 * NOT). Wider products or sums become trees: a 6-literal product is AND(AND4, AND2) (NAND only:
 * NAND(NOT(NAND4), NOT(NAND2))), more than four terms an OR tree.
 *
 * Layout (left to right): one vertical rail per input variable (net label with the variable name
 * at its top) and, when the variable appears complemented, an inverter at the top feeding a second
 * rail (label `<name>_N`). Gates sit in columns by logic level. Inputs of the first column come
 * straight from the rails (horizontal wires that start ON the rail); gate-to-gate connections
 * between neighbouring columns are three-segment wires, each in its own vertical channel of the
 * gap between the columns; any other connection uses a pair of net labels. Column c gates sit on
 * rows ≡ 40·c (mod 80) so a wire leaving a gate never runs on top of a wire entering one.
 * Only wire END points ever touch other conductors, as the connectivity rules require.
 */
import { DesignBuilder, type PartHandle } from '../designkit';
import type { Design, Point } from '../types';

/** Product term: `mask` bits are the variables present, `value` their required values (bit of variable v = n − 1 − v). */
export interface ProductTerm {
  mask: number;
  value: number;
}

export interface LogicCircuitOptions {
  /** NAND gates only (default AND-OR-NOT) */
  nandOnly?: boolean;
  /** input names (default A..H) */
  names?: readonly string[];
  /** output net name (default OUT) */
  output?: string;
  /** logic high level of the gates (V, default 5) */
  vhigh?: number;
  /** prefix of the internal net names (default "G") */
  netPrefix?: string;
}

export interface LogicCircuitResult {
  design: Design;
  /** input variables used, in order */
  inputs: string[];
  /** names of the complement nets created (`A_N` …) */
  complements: string[];
  output: string;
  /** number of gates by type ("and2" → 3 …) */
  gates: Record<string, number>;
  /** true for a constant function (the output is driven by a DC source) */
  constant: 0 | 1 | null;
}

const DEFAULT_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
type GateOp = 'and' | 'or' | 'nand' | 'not' | 'buf';

interface Gate {
  op: GateOp;
  inputs: string[];
  output: string;
  level: number;
}

const X0 = 80;
const RAIL_BLOCK = 100;
const Y_TOP = 120;
const Y_INV = 160;
const Y0 = 240;
const GATE_W = 80;

function partFor(op: GateOp, n: number): { id: string; pins: string[]; out: string } {
  const names = ['A', 'B', 'C', 'D'];
  switch (op) {
    case 'not':
      return { id: 'misc-digital/not', pins: ['A'], out: 'Y' };
    case 'buf':
      return { id: 'misc-digital/and2', pins: ['A', 'B'], out: 'Y' };
    case 'and':
      return { id: `misc-digital/and${n}`, pins: names.slice(0, n), out: 'Y' };
    case 'or':
      return { id: `misc-digital/or${n}`, pins: names.slice(0, n), out: 'Y' };
    case 'nand':
      return { id: `misc-digital/nand${Math.max(2, n)}`, pins: names.slice(0, Math.max(2, n)), out: 'Y' };
  }
}

/** Build the gate netlist of a sum of products. */
function synthesize(terms: readonly ProductTerm[], n: number, names: readonly string[], nand: boolean, out: string, prefix: string): { gates: Gate[]; complements: Set<string>; used: Set<number> } {
  const gates: Gate[] = [];
  const levelOf = new Map<string, number>();
  const used = new Set<number>();
  const complements = new Set<string>();
  let seq = 0;
  const fresh = () => `${prefix}${++seq}`;
  const lit = (v: number, positive: boolean) => {
    used.add(v);
    if (positive) return names[v];
    complements.add(names[v]);
    return `${names[v]}_N`;
  };
  const add = (op: GateOp, inputs: string[], output = fresh()): string => {
    const level = 1 + Math.max(0, ...inputs.map((i) => levelOf.get(i) ?? 0));
    gates.push({ op, inputs, output, level });
    levelOf.set(output, level);
    return output;
  };
  /** AND (or NAND when `inverted`) of any number of signals with ≤ 4-input gates. */
  const andTree = (sig: string[], inverted: boolean, output?: string): string => {
    if (sig.length <= 4) return add(inverted ? 'nand' : 'and', sig, output);
    const groups: string[] = [];
    for (let i = 0; i < sig.length; i += 4) groups.push(sig.length - i === 1 ? sig[i] : andTree(sig.slice(i, i + 4), false));
    return andTree(groups, inverted, output);
  };
  /** AND built from NAND gates only (inverted = the NAND itself). */
  const nandAnd = (sig: string[], inverted: boolean, output?: string): string => {
    if (sig.length <= 4) {
      const g = add('nand', sig, inverted ? output : undefined);
      return inverted ? g : add('nand', [g, g], output);
    }
    const groups: string[] = [];
    for (let i = 0; i < sig.length; i += 4) groups.push(sig.length - i === 1 ? sig[i] : nandAnd(sig.slice(i, i + 4), false));
    return nandAnd(groups, inverted, output);
  };
  const orTree = (sig: string[], output?: string): string => {
    if (sig.length <= 4) return add('or', sig, output);
    const groups: string[] = [];
    for (let i = 0; i < sig.length; i += 4) groups.push(sig.length - i === 1 ? sig[i] : orTree(sig.slice(i, i + 4)));
    return orTree(groups, output);
  };
  const literalsOf = (t: ProductTerm): [number, boolean][] => {
    const out: [number, boolean][] = [];
    for (let v = 0; v < n; v++) {
      const bit = 1 << (n - 1 - v);
      if (t.mask & bit) out.push([v, (t.value & bit) !== 0]);
    }
    return out;
  };
  if (!nand) {
    const products = terms.map((t) => {
      const lits = literalsOf(t).map(([v, pos]) => lit(v, pos));
      return lits.length === 1 ? lits[0] : andTree(lits, false, terms.length === 1 ? out : undefined);
    });
    if (terms.length === 1) {
      const only = literalsOf(terms[0]);
      if (only.length === 1) {
        // a single literal: a buffer (AND with tied inputs) or one NOT gate driving the output
        if (only[0][1]) add('buf', [products[0], products[0]], out);
        else {
          complements.delete(names[only[0][0]]);
          add('not', [names[only[0][0]]], out);
        }
      }
    } else orTree(products, out);
  } else {
    // f = NAND(NAND(term1), NAND(term2), …); a one-literal term enters as the complemented literal
    const nands = terms.map((t) => {
      const l = literalsOf(t);
      if (l.length === 1 && terms.length > 1) return lit(l[0][0], !l[0][1]);
      return nandAnd(
        l.map(([v, pos]) => lit(v, pos)),
        true,
      );
    });
    if (terms.length === 1) {
      // a single product: invert its NAND
      add('nand', [nands[0], nands[0]], out);
    } else nandAnd(nands, true, out);
  }
  return { gates, complements, used };
}

/**
 * Gate circuit of a sum of products over `n` inputs (terms from minimizeSop; [] = constant 0,
 * [{ mask: 0 }] = constant 1). The design has one sheet; inputs are net labels (A, B …) at the top
 * of the rails, the output a label at the right.
 */
export function logicCircuit(terms: readonly ProductTerm[], n: number, opts: LogicCircuitOptions = {}): LogicCircuitResult {
  const names = opts.names ?? DEFAULT_NAMES;
  const nand = !!opts.nandOnly;
  const output = opts.output ?? 'OUT';
  const vhigh = opts.vhigh ?? 5;
  const prefix = opts.netPrefix ?? 'G';
  const b = new DesignBuilder(nand ? 'NAND logic' : 'AND-OR logic');
  const gateParams = { vhigh: String(vhigh), threshold: String(vhigh / 2) };
  const constant = terms.length === 0 ? 0 : terms.some((t) => t.mask === 0) ? 1 : null;
  if (constant !== null) {
    const v = b.part('sources/dc-voltage', 'V1', 120, 230, { value: constant ? String(vhigh) : '0' });
    b.part('sources/ground', 'GND1', 120, 260);
    b.wire(b.pin(v, '+'), { x: 120, y: 160 }, { x: 200, y: 160 });
    b.label(output, 200, 160);
    return { design: b.design, inputs: [], complements: [], output, gates: {}, constant };
  }
  const { gates, complements, used } = synthesize(terms, n, names, nand, output, prefix);
  const vars = [...used].sort((a, c) => a - c);
  const counts: Record<string, number> = {};
  let refSeq = 0;
  const place = (op: GateOp, k: number, x: number, y: number): PartHandle => {
    const pf = partFor(op, k);
    counts[pf.id.split('/')[1]] = (counts[pf.id.split('/')[1]] ?? 0) + 1;
    return b.part(pf.id, `U${++refSeq}`, x, y, gateParams);
  };

  // --- rails and inverters
  const levels = Math.max(...gates.map((g) => g.level));
  const columns: Gate[][] = Array.from({ length: levels }, () => []);
  for (const g of gates) columns[g.level - 1].push(g);
  const railX = new Map<string, number>();
  vars.forEach((v, k) => {
    railX.set(names[v], X0 + RAIL_BLOCK * k);
    if (complements.has(names[v])) railX.set(`${names[v]}_N`, X0 + RAIL_BLOCK * k + 80);
  });
  /** lowest point each rail is tapped at (rails end there, so no wire end dangles) */
  const railEnd = new Map<string, number>();
  const tap = (net: string, y: number) => railEnd.set(net, Math.max(railEnd.get(net) ?? -Infinity, y));
  const drawRails = () => {
    vars.forEach((v) => {
      const name = names[v];
      const xt = railX.get(name)!;
      b.label(name, xt, Y_TOP);
      if (complements.has(name)) tap(name, nand ? Y_INV - 10 : Y_INV);
      const end = railEnd.get(name);
      if (end !== undefined) b.wire({ x: xt, y: Y_TOP }, { x: xt, y: end });
      if (!complements.has(name)) return;
      const xc = railX.get(`${name}_N`)!;
      const cEnd = Math.max(railEnd.get(`${name}_N`) ?? -Infinity, Y_INV + 40);
      if (nand) {
        const inv = place('nand', 2, xt + 40, Y_INV);
        b.wire({ x: xt, y: Y_INV - 10 }, b.pin(inv, 'A'));
        b.wire(b.pin(inv, 'A'), b.pin(inv, 'B'));
        b.wire(b.pin(inv, 'Y'), { x: xc, y: cEnd });
      } else {
        const inv = place('not', 1, xt + 40, Y_INV);
        b.wire({ x: xt, y: Y_INV }, b.pin(inv, 'A'));
        b.wire(b.pin(inv, 'Y'), { x: xc, y: Y_INV }, { x: xc, y: cEnd });
      }
      b.label(`${name}_N`, xc, cEnd);
    });
  };

  // --- gate rows: column 0 in creation order, later columns centred on their sources
  const xGates = X0 + RAIL_BLOCK * vars.length + 40;
  const pos = new Map<string, { col: number; y: number; h: PartHandle; gate: Gate }>();
  const inboundCount = (c: number) => columns[c].reduce((s, g) => s + g.inputs.length, 0);
  const colX: number[] = [];
  let x = xGates + 30;
  for (let c = 0; c < levels; c++) {
    if (c > 0) x += GATE_W + 40 + 10 * inboundCount(c);
    colX.push(x);
  }
  for (let c = 0; c < levels; c++) {
    let lastY = -Infinity;
    for (const g of columns[c]) {
      let want: number;
      if (c === 0) want = Y0 + 80 * columns[0].indexOf(g);
      else {
        const src = g.inputs.map((i) => pos.get(i)?.y).filter((v): v is number => v !== undefined);
        want = src.length ? src.reduce((a, v) => a + v, 0) / src.length : Y0;
      }
      // snap to rows ≡ 40c (mod 80) below the previous gate of the column
      const off = (40 * c) % 80;
      let y = Math.round((want - off) / 80) * 80 + off;
      while (y < lastY + 80) y += 80;
      lastY = y;
      const k = g.op === 'not' ? 1 : g.op === 'buf' ? 2 : g.inputs.length;
      const h = place(g.op, k, colX[c], y);
      pos.set(g.output, { col: c, y, h, gate: g });
    }
  }

  // --- connections
  const labelled = new Set<string>();
  const labelAtSource = (net: string) => {
    if (labelled.has(net)) return;
    labelled.add(net);
    const src = pos.get(net);
    if (src) b.labelPin(src.h, 'Y', net);
  };
  for (let c = 0; c < levels; c++) {
    const gapLeft = c === 0 ? 0 : colX[c - 1] + 40;
    let channel = c === 0 ? 0 : colX[c] - 30 - 20;
    for (const g of columns[c]) {
      const here = pos.get(g.output)!;
      const pf = partFor(g.op, g.op === 'not' ? 1 : g.op === 'buf' ? 2 : g.inputs.length);
      // tie the inputs of an inverter-NAND / buffer: same net on every pin
      const ins = g.inputs.length < pf.pins.length ? pf.pins.map((_, i) => g.inputs[Math.min(i, g.inputs.length - 1)]) : g.inputs;
      // sort by source height so wires to one gate never cross
      const order = ins
        .map((net, i) => ({ net, i, y: pos.get(net)?.y ?? (railX.has(net) ? -1e9 + (railX.get(net) ?? 0) : 0) }))
        .sort((a, z) => a.y - z.y);
      const tiedDone = new Set<string>();
      order.forEach((entry, k) => {
        const pinName = pf.pins[k];
        const pinPos: Point = b.pin(here.h, pinName);
        const net = entry.net;
        if (tiedDone.has(net)) {
          // repeated net on this gate: join the pin to the first pin of that net
          const first = pf.pins[order.findIndex((o) => o.net === net)];
          b.wire(b.pin(here.h, first), pinPos);
          return;
        }
        tiedDone.add(net);
        const rail = railX.get(net);
        if (rail !== undefined && c === 0) {
          b.wire({ x: rail, y: pinPos.y }, pinPos);
          tap(net, pinPos.y);
          return;
        }
        const src = pos.get(net);
        if (src && src.col === c - 1) {
          const from = b.pin(src.h, 'Y');
          if (from.y === pinPos.y) b.wire(from, pinPos);
          else {
            b.wire(from, { x: channel, y: from.y }, { x: channel, y: pinPos.y }, pinPos);
            channel -= 10;
          }
          if (channel <= gapLeft + 10) channel = gapLeft + 10;
          return;
        }
        // anything else: a pair of net labels
        if (src) labelAtSource(net);
        b.labelPin(here.h, pinName, net);
      });
    }
  }
  drawRails();
  // output label
  const last = pos.get(output);
  if (last) {
    const o = b.pin(last.h, 'Y');
    b.wire(o, { x: o.x + 40, y: o.y });
    b.label(output, o.x + 40, o.y);
  }
  return { design: b.design, inputs: vars.map((v) => names[v]), complements: [...complements].map((c) => `${c}_N`), output, gates: counts, constant: null };
}
