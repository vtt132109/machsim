/**
 * Memory code models: static RAM, ROM / EPROM / EEPROM and a small register file.
 *
 *   D_RAM / D_ROM   a0..a(n-1) d0..d(w-1) [q0..q(w-1)] ~cs [cs2] [~oe] [~we]
 *       params abits (n), dbits (w), writable (D_RAM default 1, D_ROM 0), cs2 (1: active-high
 *       second chip select, 6264), has_oe (default 1), separate (1: separate data inputs d and
 *       3-state outputs q, 74189), out_invert (1: q outputs complemented, 74189); model literal
 *       `data` = initial contents (memimage.ts format).
 *       Read: chip selected, ~oe low and ~we high drive the data (or q) pins with the addressed
 *       word after the output delay (the access time); otherwise the pins are released (Z).
 *       Write (writable): chip selected and ~we low store the data pins at the addressed word at
 *       every accepted timepoint, and once more with the address / data at the end of the write
 *       pulse (rising ~we or deselect). Writes happen only in transient analyses; an operating
 *       point never changes the contents, and every analysis starts from the initial image.
 *   D_REGFILE       wa0..wa(n-1) ra0..ra(n-1) d0..d(w-1) ~gw ~gr q0..q(w-1)
 *       74670 register file: ~gw low writes d to word wa (transparent), ~gr low drives word ra on
 *       the 3-state q outputs. Params abits, dbits.
 *
 * The contents live in the behaviour (not in the engine state vector): writes are applied only
 * in the accept hook, i.e. at accepted timepoints, so rejected steps never see them.
 */
import { Z, netlistError, range, word, wordAt, type BehaviourContext, type BehaviourFactory, type EvalIO } from './behaviour';
import { parseMemoryImage } from './memimage';

function sizeParams(ctx: BehaviourContext): { n: number; w: number } {
  const n = ctx.p.int('abits', 0);
  const w = ctx.p.int('dbits', 0);
  if (!(n >= 1 && n <= 20)) throw netlistError(ctx.name, `abits must be 1..20 (got ${n})`);
  if (!(w >= 1 && w <= 32)) throw netlistError(ctx.name, `dbits must be 1..32 (got ${w})`);
  return { n, w };
}

function initialImage(ctx: BehaviourContext, words: number, bits: number): Uint32Array {
  const text = ctx.p.text('data') ?? '';
  const r = parseMemoryImage(text, words, bits);
  if (r.errors.length) throw netlistError(ctx.name, `memory contents: ${r.errors[0]}`);
  return r.data;
}

function memory(defaultWritable: boolean): BehaviourFactory {
  return (ctx) => {
    const { n, w } = sizeParams(ctx);
    const writable = ctx.p.flag('writable', defaultWritable);
    const cs2 = ctx.p.flag('cs2') ? 1 : 0;
    const hasOe = ctx.p.flag('has_oe', true) ? 1 : 0;
    const separate = ctx.p.flag('separate') ? 1 : 0;
    const outInvert = ctx.p.flag('out_invert');
    const d0 = n;
    const q0 = separate ? n + w : n;
    const cs = n + w * (1 + separate);
    const cs2i = cs2 ? cs + 1 : -1;
    const oe = hasOe ? cs + 1 + cs2 : -1;
    const we = writable ? cs + 1 + cs2 + hasOe : -1;
    const ports = cs + 1 + cs2 + hasOe + (writable ? 1 : 0);
    if (ctx.ports !== ports) throw netlistError(ctx.name, `expected ${ports} port nodes for a ${2 ** n} x ${w} memory, got ${ctx.ports}`);
    const words = 2 ** n;
    const mask = w >= 32 ? 0xffffffff : 2 ** w - 1;
    const image = initialImage(ctx, words, w);
    let mem = image.slice();
    // inputs: address, data (writable only), controls
    const inputs = [...range(0, n), ...(writable ? range(d0, w) : []), cs, ...(cs2 ? [cs2i] : []), ...(hasOe ? [oe] : []), ...(writable ? [we] : [])];
    const at = new Map<number, number>();
    inputs.forEach((port, i) => at.set(port, i));
    const ix = (port: number) => at.get(port)!;
    const selectedAt = (io: EvalIO, t?: number): boolean => {
      const v = (port: number) => (t === undefined ? io.in[ix(port)] : io.at(ix(port), t));
      return v(cs) === 0 && (cs2i < 0 || v(cs2i) === 1);
    };
    const writingAt = (io: EvalIO, t?: number): boolean => writable && selectedAt(io, t) && (t === undefined ? io.in[ix(we)] : io.at(ix(we), t)) === 0;
    const wasWriting = (io: EvalIO): boolean => writable && io.prev[ix(cs)] === 0 && (cs2i < 0 || io.prev[ix(cs2i)] === 1) && io.prev[ix(we)] === 0;
    return {
      inputs,
      outputs: range(q0, w).map((port) => ({ port })),
      state: 0,
      init() {
        mem = image.slice();
      },
      eval(io) {
        if (!io.dc && writable) {
          const a = word(io, 0, n);
          if (writingAt(io)) mem[a] = word(io, ix(d0), w) & mask;
          else if (wasWriting(io)) {
            // end of the write pulse: store what was on the pins when it ended
            let te = io.prevTime;
            for (const p of [cs, we, ...(cs2 ? [cs2i] : [])]) te = Math.max(te, io.cross[ix(p)]);
            const tb = te - 1e-15 * Math.max(1, Math.abs(te));
            mem[wordAt(io, 0, n, tb)] = wordAt(io, ix(d0), w, tb) & mask;
          }
        }
        const reading = selectedAt(io) && (oe < 0 || io.present[ix(oe)] === 0 || io.in[ix(oe)] === 0) && !writingAt(io);
        if (!reading) {
          for (let k = 0; k < w; k++) io.out[k] = Z;
          return;
        }
        let v = mem[word(io, 0, n)];
        if (outInvert) v = ~v & mask;
        for (let k = 0; k < w; k++) {
          io.out[k] = v % 2;
          v = Math.floor(v / 2);
        }
      },
    };
  };
}

const regfile: BehaviourFactory = (ctx) => {
  const { n, w } = sizeParams(ctx);
  const ports = 2 * n + w + 2 + w;
  if (ctx.ports !== ports) throw netlistError(ctx.name, `expected ${ports} port nodes (wa.. ra.. d.. ~gw ~gr q..), got ${ctx.ports}`);
  const words = 2 ** n;
  const image = initialImage(ctx, words, w);
  let mem = image.slice();
  const gw = 2 * n + w;
  const gr = gw + 1;
  return {
    inputs: range(0, gr + 1),
    outputs: range(gr + 1, w).map((port) => ({ port })),
    state: 0,
    init() {
      mem = image.slice();
    },
    eval(io) {
      if (!io.dc && io.in[gw] === 0) mem[word(io, 0, n)] = word(io, 2 * n, w);
      if (io.in[gr] !== 0) {
        for (let k = 0; k < w; k++) io.out[k] = Z;
        return;
      }
      let v = mem[word(io, n, n)];
      for (let k = 0; k < w; k++) {
        io.out[k] = v % 2;
        v = Math.floor(v / 2);
      }
    },
  };
};

export const MEMORY_BEHAVIOURS: Record<string, BehaviourFactory> = {
  D_RAM: memory(true),
  D_ROM: memory(false),
  D_REGFILE: regfile,
};
