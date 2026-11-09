/**
 * From a ladder diagram and a rack of I/O modules to one netlist element.
 *
 * The rungs of the ladder sheets of a design level are ONE program with one set of timers,
 * counters and memory bits, so they must run in ONE code-model element. The PLC rack parts
 * (src/library/catalog/plc.ts, marked with `LibraryPartDef.ladderIo`) therefore have no `toSpice`
 * of their own: this module collects them, gives every channel its ladder address, compiles the
 * program and builds the single `A_LADDER` element plus its model card.
 *
 *   channel order of the element  analog inputs (AI0 …), digital inputs (I0.0 …), outputs (Q0.0 …)
 *   last node                     the common of the rack (every module must share it)
 *
 * What it reports back (ERC): a ladder sheet without modules, modules without a ladder sheet,
 * modules on different commons, two modules on the same address byte, and every problem the
 * compiler found in a rung. Nothing here stops the rest of the circuit from simulating.
 */
import { SCAN_DEFAULT, compileLadder, encodeLadderIr, type LadderError, type LadderIR, type LadderPort } from '../ladder/program';
import type { LadderRung } from '../ladder/types';
import { hash8, type LadderIoSpec } from '../library/partkit';
import { parseUserNumber } from '../util/units';
import type { ElementIR, ModelCard } from '../sim/netlist';
import type { ErcDetail } from './types';

/** One placed rack part, as the netlister hands it over. */
export interface LadderModule {
  refdes: string;
  partId: string;
  sheetId: string;
  spec: LadderIoSpec;
  /** merged parameter text of the instance */
  params: Record<string, string>;
  /** SPICE node of a pin, or undefined when the pin is not connected */
  node(pin: string): string | undefined;
  /** position, for the ERC marker */
  x: number;
  y: number;
}

/** One problem found while building the rack. */
export interface LadderBuildMessage {
  severity: 'error' | 'warning';
  message: string;
  detail: ErcDetail;
  refdes?: string;
  sheetId?: string;
  x?: number;
  y?: number;
}

/**
 * The ladder program of a design level and the element that runs it (see
 * `NetlistBuildEx.ladder`), so the ladder editor can follow the live state.
 */
export interface LadderBinding {
  /** netlist element of the controller */
  element: string;
  /** the controller part, when one is placed */
  refdes?: string;
  /** compiled program (the editor highlights by its element slots) */
  ir: LadderIR;
  /** ids of the ladder sheets the program came from, in order */
  sheetIds: string[];
  /** the rack publishes its read-out vectors */
  debug: boolean;
  /** rungs that did not compile */
  errors: LadderError[];
  /**
   * A program inside a block: the placed copy it belongs to (refdes of each block from the top
   * level down) and the child design that holds its sheets. `element` is then the flattened name
   * ("A.XHB1.A_PLC1"). Absent for the top-level program.
   */
  scope?: { path: string[]; childId: string };
}

export interface LadderBuildResult {
  elements: ElementIR[];
  models: ModelCard[];
  binding?: LadderBinding;
  messages: LadderBuildMessage[];
}

const num = (params: Record<string, string>, key: string, def: number): number => {
  const v = parseUserNumber(params[key] ?? '');
  return Number.isFinite(v) ? v : def;
};

const intOf = (params: Record<string, string>, key: string, def: number): number => {
  const v = Number.parseInt((params[key] ?? '').trim(), 10);
  return Number.isFinite(v) ? v : def;
};

/** Address text of a channel, for the messages and the editor's address list. */
export function channelAddress(spec: LadderIoSpec, start: number, channel: number): string {
  if (spec.kind === 'analog-input') return `AI${start + channel}`;
  return `${spec.kind === 'input' ? 'I' : 'Q'}${start}.${channel}`;
}

/**
 * Build the element of one design level.
 *   `rungs`     the rungs of every ladder sheet of the level, in sheet order
 *   `modules`   the rack parts placed on the schematic sheets of the level
 *   `elementName` how to name the element (the netlister's naming rule)
 */
export function buildLadder(rungs: readonly LadderRung[], sheetIds: readonly string[], modules: readonly LadderModule[], elementName: (refdes: string) => string): LadderBuildResult {
  const messages: LadderBuildMessage[] = [];
  const cpu = modules.find((m) => m.spec.kind === 'cpu');
  const io = modules.filter((m) => m.spec.kind !== 'cpu');
  const hasProgram = rungs.length > 0;
  if (!hasProgram && modules.length > 0) {
    messages.push({
      severity: 'warning',
      message: `${modules[0].refdes}: the design has a PLC rack but no ladder sheet with rungs (add one with Place > Ladder sheet)`,
      detail: { id: 'ladderNoProgram', params: { refdes: modules[0].refdes } },
      refdes: modules[0].refdes,
      sheetId: modules[0].sheetId,
      x: modules[0].x,
      y: modules[0].y,
    });
    return { elements: [], models: [], messages };
  }
  if (!hasProgram) return { elements: [], models: [], messages };
  if (io.length === 0) {
    messages.push({
      severity: 'warning',
      message: 'the ladder diagram has no input or output module on the schematic, so it cannot read or drive anything',
      detail: { id: 'ladderNoModules', params: {} },
      ...(sheetIds.length ? { sheetId: sheetIds[0] } : {}),
    });
    return { elements: [], models: [], messages };
  }

  // the common of the rack: the first module's COM net; every other module must share it
  let common: string | undefined;
  for (const m of io) {
    const net = m.spec.com ? m.node(m.spec.com) : undefined;
    if (net === undefined) continue;
    if (common === undefined) common = net;
    else if (net !== common) {
      messages.push({
        severity: 'error',
        message: `${m.refdes}: every module of one PLC rack must share its COM (0 V) net`,
        detail: { id: 'ladderCommonSplit', params: { refdes: m.refdes } },
        refdes: m.refdes,
        sheetId: m.sheetId,
        x: m.x,
        y: m.y,
      });
    }
  }

  const ports: LadderPort[] = [];
  const nodes: string[] = [];
  const analog: { port: LadderPort; node: string }[] = [];
  const digital: { port: LadderPort; node: string }[] = [];
  const outputs: { port: LadderPort; node: string }[] = [];
  /** address -> refdes that already uses it */
  const taken = new Map<string, string>();

  for (const m of io) {
    const spec = m.spec;
    const start = intOf(m.params, spec.startParam ?? '', 0);
    const vth = num(m.params, 'vth', 12);
    const vhys = Math.max(0, num(m.params, 'vhys', 4));
    const von = num(m.params, 'von', 24);
    spec.pins.forEach((pinName, channel) => {
      const node = m.node(pinName);
      if (node === undefined) return; // an unwired channel costs nothing
      const address = channelAddress(spec, start, channel);
      const owner = taken.get(address);
      if (owner !== undefined) {
        messages.push({
          severity: 'error',
          message: `${m.refdes}: channel ${address} is already used by ${owner} (give one of the two modules another address byte)`,
          detail: { id: 'ladderDuplicateChannel', params: { refdes: m.refdes, address, other: owner } },
          refdes: m.refdes,
          sheetId: m.sheetId,
          x: m.x,
          y: m.y,
        });
        return;
      }
      taken.set(address, m.refdes);
      if (spec.kind === 'analog-input') analog.push({ port: { kind: 'ai', index: start + channel }, node });
      else if (spec.kind === 'input') digital.push({ port: { kind: 'di', index: start * 8 + channel, vth, vhys }, node });
      else outputs.push({ port: { kind: 'q', index: start * 8 + channel, von }, node });
    });
  }
  for (const list of [analog, digital, outputs]) {
    for (const item of list) {
      ports.push(item.port);
      nodes.push(item.node);
    }
  }
  if (ports.length === 0) {
    messages.push({
      severity: 'warning',
      message: 'no channel of the PLC rack is wired, so the ladder program cannot read or drive anything',
      detail: { id: 'ladderNoChannels', params: {} },
      refdes: io[0].refdes,
      sheetId: io[0].sheetId,
      x: io[0].x,
      y: io[0].y,
    });
    return { elements: [], models: [], messages };
  }

  const scan = cpu ? num(cpu.params, 'scan', SCAN_DEFAULT) : SCAN_DEFAULT;
  const debug = cpu ? (cpu.params.debug ?? 'true').trim().toLowerCase() !== 'false' : true;
  const { ir, errors } = compileLadder(rungs, { scan, ports });
  for (const e of errors) {
    messages.push({
      severity: 'error',
      message: `ladder rung ${e.rung}: ${e.code}${e.text !== undefined ? ` (${e.text})` : ''}`,
      detail: { id: 'ladderRung', params: { rung: e.rung, code: e.code, text: e.text ?? '', limit: e.limit ?? 0 } },
      ...(sheetIds.length ? { sheetId: sheetIds[0] } : {}),
    });
  }
  const text = encodeLadderIr(ir);
  const name = elementName(cpu?.refdes ?? io[0].refdes);
  const model: ModelCard = {
    name: `MS_LADDER_${hash8(text)}`,
    type: 'A_LADDER',
    params: { debug: debug ? 1 : 0 },
    stringParams: { prog: text },
  };
  const element: ElementIR = {
    type: 'A',
    name,
    nodes: [...nodes, common ?? '0'],
    model: model.name,
    params: { pwr: 1 },
  };
  return {
    elements: [element],
    models: [model],
    binding: { element: name, ...(cpu ? { refdes: cpu.refdes } : {}), ir, sheetIds: [...sheetIds], debug, errors },
    messages,
  };
}

/** Rungs of every ladder sheet of a level, in sheet order. */
export function ladderRungsOf(sheets: readonly { id: string; kind?: string; ladder?: LadderRung[] }[]): { rungs: LadderRung[]; sheetIds: string[] } {
  const rungs: LadderRung[] = [];
  const sheetIds: string[] = [];
  for (const s of sheets) {
    if (s.kind !== 'ladder' || !s.ladder) continue;
    sheetIds.push(s.id);
    rungs.push(...s.ladder);
  }
  return { rungs, sheetIds };
}
