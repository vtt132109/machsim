/**
 * Read-out vectors of a running ladder program.
 *
 * The `A_LADDER` code model publishes its scan state as derived device outputs (see
 * `Behaviour.probes` in src/sim/devices/digital/behaviour.ts), which the engine turns into result
 * vectors `KEY(A_LADDER1)`. The ladder editor reads them from the live vector snapshot and lights
 * up the rungs that carry power, so the learner watches the program run on the drawing.
 *
 * Keys start with `L` because the engine reads the first letter of a derived output as its unit
 * (V / I / P / G / R, engine/outputs.ts `unitForKey`) and `L` is not one of them. The key set is
 * fixed once the program is compiled, which is what the engine requires.
 *
 *   Lscan      scans run since the start
 *   Li<n>      input image byte n       Lq<n> output image byte n     Lm<n> memory byte n
 *   Lt<n>      elapsed time of timer n+1 (s)        Ltd<n> its done bit
 *   Lc<n>      present value of counter n+1         Lcd<n> its done bit
 *   Lw<n>      memory word MWn           Lo<n> analog output AQn (volts)   Lerr  divisions by zero
 *   Ls<w>      element states, 24 per word, in compile order (LadderMachine.slotWord)
 */
import { SLOT_BITS, type LadderMachine } from './machine';
import { ladderAddresses, type BitArea, type LadderIR } from './program';

/** How many bytes of each image a program touches (at least one, so a probe always exists). */
export interface ImageSizes {
  inputs: number;
  outputs: number;
  mem: number;
}

/** Image bytes a program reads or writes (ports included, so a wired channel is always shown). */
export function ladderImageSizes(ir: LadderIR): ImageSizes {
  const max = { I: -1, Q: -1, M: -1 };
  const bump = (area: BitArea, index: number): void => {
    if (area === 'I' || area === 'Q' || area === 'M') max[area] = Math.max(max[area], Math.floor(index / 8));
  };
  const { reads, writes } = ladderAddresses(ir);
  for (const r of [...reads, ...writes]) bump(r.area, r.index);
  for (const p of ir.ports) {
    if (p.kind === 'di') bump('I', p.index);
    else if (p.kind === 'q') bump('Q', p.index);
  }
  return { inputs: max.I + 1, outputs: max.Q + 1, mem: max.M + 1 };
}

/** Analog output channels a program writes or whose port is wired (at least what the ports say). */
export function analogOutCount(ir: LadderIR): number {
  let n = ir.aouts ?? 0;
  for (const p of ir.ports) if (p.kind === 'aq') n = Math.max(n, p.index + 1);
  return n;
}

/** Number of packed element-state words of a program. */
export function slotWordCount(ir: LadderIR): number {
  return Math.ceil(Math.max(0, ir.slots) / SLOT_BITS);
}

/** Every read-out key of a compiled program, in a fixed order. */
export function ladderProbeKeys(ir: LadderIR): string[] {
  const sizes = ladderImageSizes(ir);
  const keys = ['Lscan'];
  for (let k = 0; k < sizes.inputs; k++) keys.push(`Li${k}`);
  for (let k = 0; k < sizes.outputs; k++) keys.push(`Lq${k}`);
  for (let k = 0; k < sizes.mem; k++) keys.push(`Lm${k}`);
  for (let k = 0; k < ir.timers; k++) keys.push(`Lt${k}`, `Ltd${k}`);
  for (let k = 0; k < ir.counters; k++) keys.push(`Lc${k}`, `Lcd${k}`);
  for (let k = 0; k < (ir.words ?? 0); k++) keys.push(`Lw${k}`);
  for (let k = 0; k < analogOutCount(ir); k++) keys.push(`Lo${k}`);
  if ((ir.words ?? 0) > 0 || analogOutCount(ir) > 0) keys.push('Lerr');
  for (let k = 0; k < slotWordCount(ir); k++) keys.push(`Ls${k}`);
  return keys;
}

/** Fill a read-out record (the same object every time, as the engine reads it per sample). */
export function fillLadderProbes(m: LadderMachine, into: Record<string, number>): void {
  const ir = m.ir;
  const sizes = ladderImageSizes(ir);
  into.Lscan = m.scans;
  for (let k = 0; k < sizes.inputs; k++) into[`Li${k}`] = m.imageByte('I', k);
  for (let k = 0; k < sizes.outputs; k++) into[`Lq${k}`] = m.imageByte('Q', k);
  for (let k = 0; k < sizes.mem; k++) into[`Lm${k}`] = m.imageByte('M', k);
  for (let k = 0; k < ir.timers; k++) {
    into[`Lt${k}`] = m.timerElapsed[k];
    into[`Ltd${k}`] = m.timerDone[k];
  }
  for (let k = 0; k < ir.counters; k++) {
    into[`Lc${k}`] = m.counterValue[k];
    into[`Lcd${k}`] = m.counterDone[k];
  }
  for (let k = 0; k < (ir.words ?? 0); k++) into[`Lw${k}`] = m.words[k];
  for (let k = 0; k < analogOutCount(ir); k++) into[`Lo${k}`] = m.analogOut[k];
  if ((ir.words ?? 0) > 0 || analogOutCount(ir) > 0) into.Lerr = m.mathErrors;
  for (let k = 0; k < slotWordCount(ir); k++) into[`Ls${k}`] = m.slotWord(k);
}

/** Vector names of a ladder element, so the interactive run records them. */
export function ladderVectorNames(element: string, ir: LadderIR): string[] {
  return ladderProbeKeys(ir).map((k) => `${k}(${element})`);
}

/** What the ladder editor shows while the program runs. */
export interface LadderLive {
  scans: number;
  /** conducting state by element slot */
  slots: boolean[];
  inputs: number[];
  outputs: number[];
  mem: number[];
  timers: { elapsed: number; done: boolean }[];
  counters: { value: number; done: boolean }[];
  /** memory words MW0 ... (empty for a program without word instructions) */
  words?: number[];
  /** analog outputs AQ0 ... in volts */
  analogOut?: number[];
  /** divisions by zero met so far */
  mathErrors?: number;
}

/** Read {@link LadderLive} from a live vector snapshot (lower-case keys), null when not recorded. */
export function ladderLive(values: Map<string, number> | Record<string, number>, element: string, ir: LadderIR): LadderLive | null {
  const get = (key: string): number | undefined => {
    const name = `${key}(${element})`.toLowerCase();
    return values instanceof Map ? values.get(name) : values[name];
  };
  const scans = get('Lscan');
  if (scans === undefined) return null;
  const sizes = ladderImageSizes(ir);
  const slots: boolean[] = [];
  for (let w = 0; w < slotWordCount(ir); w++) {
    const v = Math.max(0, Math.round(get(`Ls${w}`) ?? 0));
    for (let k = 0; k < SLOT_BITS; k++) slots.push(Math.floor(v / 2 ** k) % 2 === 1);
  }
  return {
    scans,
    slots: slots.slice(0, ir.slots),
    inputs: Array.from({ length: sizes.inputs }, (_, k) => Math.round(get(`Li${k}`) ?? 0)),
    outputs: Array.from({ length: sizes.outputs }, (_, k) => Math.round(get(`Lq${k}`) ?? 0)),
    mem: Array.from({ length: sizes.mem }, (_, k) => Math.round(get(`Lm${k}`) ?? 0)),
    timers: Array.from({ length: ir.timers }, (_, k) => ({ elapsed: get(`Lt${k}`) ?? 0, done: (get(`Ltd${k}`) ?? 0) > 0.5 })),
    counters: Array.from({ length: ir.counters }, (_, k) => ({ value: get(`Lc${k}`) ?? 0, done: (get(`Lcd${k}`) ?? 0) > 0.5 })),
    words: Array.from({ length: ir.words ?? 0 }, (_, k) => Math.round(get(`Lw${k}`) ?? 0)),
    analogOut: Array.from({ length: analogOutCount(ir) }, (_, k) => get(`Lo${k}`) ?? 0),
    mathErrors: Math.round(get('Lerr') ?? 0),
  };
}
