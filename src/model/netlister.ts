/**
 * Schematic netlister: Design -> NetlistBuild (Netlist IR + nets + instrument / probe bindings +
 * ERC), see src/model/types.ts for the contract types.
 *
 * Pipeline (per design level: the root design, then every child design reached through a block)
 *  1. Resolve every part instance against the library (unknown ids -> ERC 'unknown-part'); block
 *     instances (`hier:<child id>`, src/model/hierarchy.ts) resolve to their generated symbol.
 *  2. Connectivity (connectivity.ts): wires, T-junctions, pins, labels and connectors, bus lines,
 *     global power nets; current / power probes cut the wire under them.
 *  3. Net naming (deterministic): ground nets are "0"; ports of a child level are named after
 *     their connector (bus ports after each line); global nets of a hierarchical design keep one
 *     name everywhere; labelled / power nets use the sanitized label text ([A-Za-z0-9_], "_2",
 *     "_3" ... on collisions); unconnected pins get a private node "NC_<refdes>_<pin>" (tied to
 *     ground through 1 TΩ so the matrix stays regular) — or "0" for instrument reference pins
 *     listed in `groundWhenOpen`; all other nets are "N1", "N2", ... numbered by first appearance
 *     (sheet order, part order, pin order).
 *  4. Elements: part defaults merged with instance params; number params written as "{expr}" (or
 *     a bare variable name) are evaluated against design.variables (variables.ts) — inside a
 *     child against the instance's parameters too; the result is validated against the
 *     ParamDefs, then part.toSpice(ctx). ctx.name('R') -> "R1" for refdes R1, "R_<refdes>"
 *     otherwise; with a suffix "V_XFG1_p". ctx.internal(s) -> "<refdes>.<s>".
 *     ctx.resolveNet(label) -> SPICE node. Parts with excludeFromSim are skipped, and so are the
 *     parts the active design variant does not fit (variants.ts variantView). Identical
 *     elements / models / subcircuits produced by several parts (e.g. every VCC symbol emits
 *     V_PWR_VCC) are de-duplicated by name; differing definitions with the same name are ERC
 *     errors. Elements of power symbols inside child designs are emitted at the top level.
 *  5. design.customSpice is parsed first: its models / subcircuits override library cards with
 *     the same name (warning), its elements and .params (and .func) are appended, its .ic /
 *     .nodeset values go to the netlist by net name (unknown nets: warning customIcUnknownNet)
 *     and its .meas cards become netlist.measures. A part instance with
 *     `modelOverride` gets its device / subcircuit model swapped for that card after toSpice
 *     (modelOverride.ts; ERC warnings modelOverrideUnknown / modelOverrideIncompatible).
 *     User components (`custom:` ids) resolve against Design.customParts (src/library/custom).
 *  6. Probes: voltage / digital / differential -> SignalRef of the net under the probe (against
 *     the part's reference ground when it hangs only on a "Đất tham chiếu" GNDREF<n>, see
 *     erc.ts analyzeReferenceGrounds);
 *     current / power -> 0 V sense source "V_PR_<probe name>" from side A to side B of the cut, so
 *     I(V_PR_x) is positive in the wire's point order (points[i] -> points[i+1]). Probes on a
 *     child's sheets bind to the first instance of that child (flattened names, see below).
 *  7. Instruments (PartDef.instrument) -> InstrumentBinding via LibraryPartDef.bindInstrument;
 *     indicators (PartDef.indicator) -> IndicatorBinding via bindIndicator (top level only).
 *  8. ERC (erc.ts): floating pins, single-pin nets, dangling wire ends, pins that a wire passes
 *     over without connecting, probes with an open side, bus and connector problems, ground,
 *     voltage loops (inductors count as DC shorts), current cutsets, undefined models, unknown
 *     nets in behavioral expressions.
 *
 * Hierarchy (subcircuits / hierarchical blocks)
 *  - Every child design becomes `.subckt <SC|HB>_<name> <port lines>`; a block with refdes HB1
 *    becomes `XHB1 <nodes> <subckt>`. A child used with different instance parameter values
 *    gets one subcircuit per distinct value set (`HB_Amp`, `HB_Amp_2`, ...): parameter values are
 *    evaluated into the element values, so every instance simulates exactly as placed.
 *  - Names after flattening (src/sim/spice/flatten.ts): element R1 in block HB1 -> "R.XHB1.R1",
 *    internal net N1 -> "XHB1.N1", nested "R.XHB1.XSC1.R1". `partNets` also lists child parts by
 *    instance path ("HB1/R1") with their flattened node names.
 *  - Global nets (power symbols, global labels / connectors) keep their name in every level and
 *    are declared `.global`; a port tied to a global net or to ground inside the child, or two
 *    ports shorted inside it, are joined in the parent instead of being passed as ports.
 * The netlist carries the design's .param variables (plain user numbers converted, expressions
 * as text), options and the active analysis spec.
 */

import { defaultParams, getPart } from '../library';
import {
  asLibraryPart,
  elementName,
  elR,
  elSense,
  internalNodeName,
  sanitizeName,
  type InstrumentBindContext,
  type ToSpiceContextExt,
  PartErcError,
} from '../library/partkit';
import type { PartDef, SpiceFragment } from '../library/types';
import { emptyNetlist, isGroundNode, type ElementIR, type ModelCard, type Netlist, type SubcktDef } from '../sim/netlist';
import { parseSpice } from '../sim/spice/parser';
import { blankStepCards } from '../sim/spice/stepcards';
import { GLOBAL_NODES_KEY } from '../sim/spice/params';
import { parseUserNumber } from '../util/units';
import { computeConnectivity, pinKey, type BusIssue, type ConnNet, type ConnPinRef, type ConnectivityResult, type CutRequest, type PlacedPartInfo } from './connectivity';
import {
  analyzeReferenceGrounds,
  checkCurrentCutsets,
  checkDuplicateRefdes,
  checkGround,
  checkModelRefs,
  checkVoltageLoops,
  unknownPartMessage,
  validateParams,
  type ErcLocation,
} from './erc';
import { checkPinTypes, checkUndrivenInputs, hiddenPowerMode, isNcPin, normalizePinType, type ErcNetPins, type ErcPinEntry } from './ercMatrix';
import { groupIndex, packageGroups, packageOf, sectionIssues, sectionLabel, type PackageGroup } from './sections';
import { instancePins } from './geometry';
import { childIdOfPart, childInstanceCounts, childOverrides, childPorts, cyclicChildren, designPartLookup, getChild, isBlockPartDef, overridesKey, type BlockPort } from './hierarchy';
import type { ChildDesign, Design, ErcDetail, ErcMessage, InstrumentBinding, LiveScope, NetInfo, NetlistBuild, PartInstance, ProbeBinding, Sheet, SignalRef } from './types';
import { childVariableScope, resolveDesignVariables, substituteVariables, variableParamValue, type VariableScope } from './variables';
import { faultInsert } from './faults';
import { applyModelOverride } from './modelOverride';
import { ratingEnabled, ratingInsert, type RatingBinding } from './ratings';
import { variantView } from './variants';
import { buildLadder, ladderRungsOf, type LadderBinding, type LadderModule } from './ladderBuild';

export type IndicatorKind = NonNullable<PartDef['indicator']>['kind'];

/** Signals of an indicator part (LED glow, lamp, meters, probe light, buzzer, motor). */
export interface IndicatorBinding {
  /** refdes of the part; inside a block the dotted path of the placed copy ("X2.LED1", see `scope`) */
  refdes: string;
  /** set when the indicator sits inside a block (one binding per placed copy of the block) */
  scope?: LiveScope;
  partId: string;
  kind: IndicatorKind;
  params: Record<string, string>;
  signal: SignalRef;
  current?: SignalRef;
  /** further code signals of multi-cell displays (LCD cells, dot-matrix rows), see IndicatorChannels */
  signals?: SignalRef[];
}

/**
 * One placed microcontroller (a part with `LibraryPartDef.mcu`): where its program text lives and
 * which netlist element carries its core, so the code editor panel can watch it and the recorded
 * vectors can include its read-outs (src/mcu/probes.ts `mcuVectorNames`).
 */
export interface McuBinding {
  refdes: string;
  partId: string;
  kind: '8051';
  /** netlist element of the core (the 'A' element its toSpice produced) */
  element: string;
  /** program text as the instance holds it (assembly source or Intel HEX) */
  program: string;
  /** the part publishes its register read-outs as vectors */
  debug: boolean;
  sheetId: string;
}

/**
 * One placed microcontroller (a part with `LibraryPartDef.mcu`): where its program text lives and
 * which netlist element carries its core, so the code editor panel can watch it and the recorded
 * vectors can include its read-outs (src/mcu/probes.ts `mcuVectorNames`).
 */
export interface McuBinding {
  refdes: string;
  partId: string;
  kind: '8051';
  /** netlist element of the core (the 'A' element its toSpice produced) */
  element: string;
  /** program text as the instance holds it (assembly source or Intel HEX) */
  program: string;
  /** the part publishes its register read-outs as vectors */
  debug: boolean;
  sheetId: string;
}

/**
 * One placed mechatronics model (a part with `LibraryPartDef.mecha`): which element runs it and
 * where its animated state lives, so the schematic drawing and the Grapher can follow it
 * (src/mecha/models.ts).
 */
export interface MechaBinding {
  refdes: string;
  partId: string;
  kind: string;
  /** netlist element of the model (the 'A' element its toSpice produced) */
  element: string;
  sheetId: string;
}

/** NetlistBuild plus the netlister's extra outputs (structurally a NetlistBuild). */
export interface NetlistBuildEx extends NetlistBuild {
  indicators: IndicatorBinding[];
  /** lower-case element name -> refdes of the part that produced it ("probe:<id>" / "custom SPICE") */
  owners: Record<string, string>;
  /**
   * Component tolerances from the parts' "tolerance" parameter (percent), mapped to the element
   * that carries the part's value (R / C / L). Used to prefill Monte Carlo / worst-case specs.
   */
  tolerances?: ElementTolerance[];
  /**
   * Hierarchical designs: every block instance by path ("HB1", "HB1/SC1") with its X element
   * path ("XHB1", "XHB1.XSC1"), child id and subcircuit name.
   */
  instances?: BlockInstanceInfo[];
  /** rated parts with burn-out switched on (top level, see src/model/ratings.ts) */
  ratings?: RatingBinding[];
  /** microcontrollers placed at the top level (src/mcu, code editor panel) */
  mcus?: McuBinding[];
  /** mechatronics models placed at the top level (src/mecha, animated on the schematic) */
  mechas?: MechaBinding[];
  /** the ladder program of the top level and the element that runs it (src/ladder) */
  ladder?: LadderBinding;
  /** ladder programs inside placed blocks, one per placed copy (`scope` names the copy) */
  ladders?: LadderBinding[];
}

/** One placed block in the expanded hierarchy. */
export interface BlockInstanceInfo {
  /** refdes path, e.g. "HB1/SC1" */
  path: string;
  /** flattened instance prefix, e.g. "XHB1.XSC1" */
  xpath: string;
  childId: string;
  subckt: string;
}

/** Tolerance of one netlist element's primary value. */
export interface ElementTolerance {
  element: string;
  param: 'value';
  /** relative tolerance (0.05 = 5 %) */
  tol: number;
  refdes: string;
}

export interface BuildNetlistOptions {
  /** copy the design's active analysis spec into netlist.analyses (default true) */
  includeAnalysis?: boolean;
}

/** Value of the 1 TΩ resistor that ties an unconnected pin's private node to ground. */
export const FLOATING_PIN_SHUNT = 1e12;

const pinTag = (pin: string): string => pin.replace(/\+/g, 'p').replace(/-/g, 'n');

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const o = val as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    }
    return val;
  });
}

const sameDef = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

interface Owner extends ErcLocation {
  refdes: string;
}

/** X element name of a block refdes ("HB1" -> "XHB1"). */
export function blockElementName(refdes: string): string {
  const r = sanitizeName(refdes);
  return r.toUpperCase().startsWith('X') ? r : `X${r}`;
}

// ---------------------------------------------------------------------------
// shared state of one netlist build
// ---------------------------------------------------------------------------

/** Element list with name de-duplication and owners (one per netlist level). */
class ElementSet {
  readonly elements: ElementIR[] = [];
  readonly index = new Map<string, ElementIR>();
  readonly owners = new Map<string, Owner>();
  constructor(private readonly erc: ErcMessage[]) {}

  add(el: ElementIR, owner: Owner): boolean {
    if (el.name.charAt(0).toUpperCase() !== el.type) {
      this.erc.push({ severity: 'error', code: 'other', message: `${owner.refdes}: element '${el.name}' does not start with its type letter '${el.type}'`, detail: { id: 'elementPrefix', params: { refdes: owner.refdes, element: el.name, type: el.type } }, ...owner });
      return false;
    }
    const k = el.name.toLowerCase();
    const prev = this.index.get(k);
    if (prev) {
      if (!sameDef(prev, el)) {
        const other = this.owners.get(k);
        this.erc.push({
          severity: 'error',
          code: 'other',
          message: `Element ${el.name} is defined differently by ${other?.refdes ?? '?'} and ${owner.refdes}${el.name.startsWith('V_PWR_') ? ' (power symbols of one rail must have the same voltage)' : ''}`,
          detail: { id: el.name.startsWith('V_PWR_') ? 'railConflict' : 'elementConflict', params: { element: el.name, a: other?.refdes ?? '?', b: owner.refdes } },
          ...owner,
        });
      }
      return false;
    }
    this.index.set(k, el);
    this.owners.set(k, owner);
    this.elements.push(el);
    return true;
  }

  uniqueName(base: string): string {
    let name = base;
    for (let k = 2; this.index.has(name.toLowerCase()); k++) name = `${base}_${k}`;
    return name;
  }
}

interface Shared {
  design: Design;
  lookup: (partId: string) => PartDef | undefined;
  erc: ErcMessage[];
  /** messages already reported (child levels are emitted once per parameter set) */
  seen: Set<string>;
  models: Map<string, { card: ModelCard; owner: string; custom: boolean }>;
  subckts: Map<string, { def: SubcktDef; owner: string; custom: boolean }>;
  /** top-level elements (root level, plus power-symbol elements of children) */
  top: ElementSet;
  tolerances: ElementTolerance[];
  /** hierarchical build: global net lower-case name -> SPICE name, shared by all levels */
  globalNames?: Map<string, string>;
  /** child id -> analysis (param independent) */
  childAnalyses: Map<string, LevelAnalysis | null>;
  cyclic: Set<string>;
  /** specialisation key -> emitted subcircuit */
  variants: Map<string, EmittedChild>;
  /** child id -> number of subcircuit variants emitted */
  variantCount: Map<string, number>;
  usedSubcktNames: Set<string>;
  /** hidden faults numbered so far (their elements are named "R_HF_<n>", see faults.ts) */
  hiddenFaults: number;
}

function pushErc(shared: Shared, m: ErcMessage, once: boolean): void {
  if (once) {
    const k = stable(m);
    if (shared.seen.has(k)) return;
    shared.seen.add(k);
  }
  shared.erc.push(m);
}

function addModel(shared: Shared, card: ModelCard, owner: string, custom: boolean, loc: ErcLocation): void {
  const k = card.name.toLowerCase();
  const prev = shared.models.get(k);
  if (!prev) {
    shared.models.set(k, { card, owner, custom });
    return;
  }
  if (sameDef(prev.card, card)) return;
  if (prev.custom && !custom) {
    pushErc(shared, { severity: 'warning', code: 'other', message: `Custom SPICE model '${card.name}' overrides the library model used by ${owner}`, detail: { id: 'customModelOverride', params: { model: card.name, owner } }, ...loc }, true);
    return;
  }
  pushErc(shared, { severity: 'error', code: 'other', message: `Conflicting definitions of model '${card.name}' (${prev.owner} and ${owner})`, detail: { id: 'modelConflict', params: { model: card.name, a: prev.owner, b: owner } }, ...loc }, true);
}

function addSubckt(shared: Shared, def: SubcktDef, owner: string, custom: boolean, loc: ErcLocation): void {
  const k = def.name.toLowerCase();
  const prev = shared.subckts.get(k);
  if (!prev) {
    shared.subckts.set(k, { def, owner, custom });
    return;
  }
  if (sameDef(prev.def, def)) return;
  if (prev.custom && !custom) {
    pushErc(shared, { severity: 'warning', code: 'other', message: `Custom SPICE subcircuit '${def.name}' overrides the library subcircuit used by ${owner}`, detail: { id: 'customModelOverride', params: { model: def.name, owner } }, ...loc }, true);
    return;
  }
  pushErc(shared, { severity: 'error', code: 'other', message: `Conflicting definitions of subcircuit '${def.name}' (${prev.owner} and ${owner})`, detail: { id: 'modelConflict', params: { model: def.name, a: prev.owner, b: owner } }, ...loc }, true);
}

// ---------------------------------------------------------------------------
// level analysis (connectivity and names; independent of parameter values)
// ---------------------------------------------------------------------------

/** How a child's port line reaches the parent. */
interface PortLine {
  /** pin key suffix on the block: port name, or `${port}#${line index}` for bus ports */
  key: string;
  /** line name (connector name / bus line) */
  line: string;
  /** SPICE port node inside the subcircuit (passed ports only) */
  node?: string;
  /** joined to this global net (or "0") inside the child: tied in the parent instead */
  global?: string;
  /** shorted inside the child to the port line with this key: joined in the parent instead */
  joinWith?: string;
}

interface LevelAnalysis {
  child?: ChildDesign;
  sheets: Sheet[];
  placed: PlacedPartInfo[];
  conn: ConnectivityResult;
  netName: string[];
  byName: Map<string, string>;
  spiceNames: Map<string, string>;
  floating: Set<number>;
  groundedOpen: Set<number>;
  splitNets: Set<number>;
  /** ERC found while analysing (reported by the caller in its place in the message order) */
  ercParts: ErcMessage[];
  ercNames: ErcMessage[];
  /** child levels: port lines in subcircuit order */
  ports?: BlockPort[];
  portLines?: PortLine[];
  /** names used by global nets in this level (lower-case) */
  globalsUsed: Set<string>;
}

function firstLabelLoc(net: ConnNet, placed: PlacedPartInfo[]): ErcLocation {
  const l = net.labels[0];
  if (l) return { sheetId: l.sheetId, x: l.x, y: l.y };
  const p = net.pins[0];
  return p ? { sheetId: p.sheetId, refdes: placed[p.part].inst.refdes, x: p.x, y: p.y } : {};
}

function analyzeLevel(sheets: Sheet[], shared: Shared, child?: ChildDesign): LevelAnalysis {
  const ercParts: ErcMessage[] = [];
  const ercNames: ErcMessage[] = [];
  const prefix = child ? `${child.name}: ` : '';

  // ---- 1. parts ---------------------------------------------------------------------------
  const placed: PlacedPartInfo[] = [];
  for (const sheet of sheets) {
    for (const inst of sheet.parts) {
      let def = shared.lookup(inst.partId);
      const childId = childIdOfPart(inst.partId);
      const loc = { sheetId: sheet.id, refdes: inst.refdes, x: inst.x, y: inst.y };
      let info: PlacedPartInfo | null = null;
      if (childId !== undefined && def && isBlockPartDef(def)) {
        if (shared.cyclic.has(childId) || (child && shared.cyclic.has(child.id))) {
          ercParts.push({ severity: 'error', code: 'other', message: `${prefix}${inst.refdes}: block '${def.name}' contains itself (directly or through other blocks)`, detail: { id: 'hierCycle', params: { refdes: inst.refdes, name: def.name } }, ...loc });
          def = undefined;
        } else {
          const ca = childAnalysis(shared, childId);
          if (!ca) def = undefined;
          else {
            const busPins = new Map<string, string[]>();
            for (const p of ca.ports ?? []) if (p.bus) busPins.set(p.name, p.members);
            info = { index: placed.length, sheetId: sheet.id, inst, def, pins: instancePins(inst, def), ...(busPins.size ? { busPins } : {}) };
          }
        }
      }
      if (!info) info = { index: placed.length, sheetId: sheet.id, inst, def, pins: def ? instancePins(inst, def) : [] };
      placed.push(info);
      if (!def && childId !== undefined && !getChild(shared.design, childId)) {
        ercParts.push({ severity: 'error', code: 'unknown-part', message: `${prefix}${inst.refdes}: the block's child design '${childId}' is missing from this file`, detail: { id: 'blockMissing', params: { refdes: inst.refdes } }, ...loc });
      } else if (!def && childId === undefined) ercParts.push({ ...unknownPartMessage(inst.partId, loc), ...(prefix ? { message: `${prefix}${unknownPartMessage(inst.partId, loc).message}` } : {}) });
    }
  }
  ercParts.push(
    // sections of one package share a refdes on purpose (sectionIssues checks them instead)
    ...checkDuplicateRefdes(placed.map((p) => ({ refdes: p.inst.refdes, sheetId: p.sheetId, x: p.inst.x, y: p.inst.y, exempt: p.def?.globalNet !== undefined || packageOf(p.def) !== undefined }))),
  );

  // ---- 2. connectivity (block pins tied by their child's port analysis) ---------------------
  const cuts: CutRequest[] = [];
  for (const sheet of sheets) {
    for (const pr of sheet.probes) if (pr.kind === 'current' || pr.kind === 'power') cuts.push({ probeId: pr.id, sheetId: sheet.id, x: pr.x, y: pr.y });
  }
  const conn = computeConnectivity({ sheets }, placed, cuts);
  applyPortTies(shared, placed, conn);
  const nets = conn.nets;
  const splitNets = new Set<number>();
  for (const s of conn.splits.values()) {
    splitNets.add(s.netA);
    splitNets.add(s.netB);
  }

  // ---- 3. net names ----------------------------------------------------------------------
  const netName: string[] = new Array<string>(nets.length);
  const taken = new Set<string>(['0', 'gnd']);
  const byName = new Map<string, string>();
  const globalsUsed = new Set<string>();
  if (shared.globalNames) for (const n of shared.globalNames.values()) taken.add(n.toLowerCase());
  const unique = (base: string): string => {
    let name = base;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base}_${k}`;
    taken.add(name.toLowerCase());
    return name;
  };
  const isFloating = (net: ConnNet): boolean => net.pins.length === 1 && net.wires.length === 0 && net.labels.length === 0 && net.globals.length === 0 && !net.ground;
  const floating = new Set<number>();
  const groundedOpen = new Set<number>();

  // ports of a child level first: they are the subcircuit's interface
  let ports: BlockPort[] | undefined;
  let portLines: PortLine[] | undefined;
  if (child) {
    ports = childPorts(child);
    portLines = [];
    const portNet = new Map<string, number>();
    for (const net of nets) for (const p of net.ports) portNet.set(p.toLowerCase(), net.id);
    const lineOfNet = new Map<number, string>();
    for (const port of ports) {
      port.members.forEach((m, i) => {
        const key = port.bus ? `${port.name}#${i}` : port.name;
        const id = isGroundNode(m) ? nets.find((n) => n.ground)?.id : portNet.get(m.toLowerCase());
        const net = id === undefined ? undefined : nets[id];
        if (!net) {
          // a declared line nothing in the child uses: still a (dangling) port node
          portLines!.push({ key, line: m, node: unique(sanitizeName(m)) });
          return;
        }
        if (net.ground) {
          portLines!.push({ key, line: m, global: '0' });
          return;
        }
        if (net.globals.length) {
          portLines!.push({ key, line: m, global: net.globals[0] });
          return;
        }
        const prev = lineOfNet.get(net.id);
        if (prev !== undefined) {
          portLines!.push({ key, line: m, joinWith: prev });
          return;
        }
        lineOfNet.set(net.id, key);
        const node = unique(sanitizeName(m));
        netName[net.id] = node;
        portLines!.push({ key, line: m, node });
      });
    }
  }

  for (const net of nets) {
    if (netName[net.id] !== undefined) {
      for (const n of [...net.ports, ...net.labels.map((l) => l.name)]) if (n) byName.set(n.toLowerCase(), netName[net.id]);
      continue;
    }
    const names = [...net.globals, ...net.labels.map((l) => l.name)].filter((n) => n !== '');
    const distinct: string[] = [];
    for (const n of names) if (!distinct.some((d) => d.toLowerCase() === n.toLowerCase())) distinct.push(n);
    if (net.ground) {
      netName[net.id] = '0';
      for (const n of distinct) byName.set(n.toLowerCase(), '0');
      const others = distinct.filter((n) => !isGroundNode(n));
      if (others.length) ercNames.push({ severity: 'warning', code: 'other', message: `${prefix}Net name(s) ${others.join(', ')} are connected to ground`, detail: { id: 'netToGround', params: { names: others.join(', ') } }, ...firstLabelLoc(net, placed) });
      continue;
    }
    if (!distinct.length) continue;
    if (distinct.length > 1) {
      ercNames.push({ severity: 'warning', code: 'other', message: `${prefix}A net has several names (${distinct.join(', ')}); using '${distinct[0]}'`, detail: { id: 'netSeveralNames', params: { names: distinct.join(', '), used: distinct[0] } }, ...firstLabelLoc(net, placed) });
    }
    let name: string;
    const g = net.globals[0];
    if (shared.globalNames && g !== undefined) {
      name = shared.globalNames.get(g.toLowerCase()) ?? unique(sanitizeName(g));
      globalsUsed.add(g.toLowerCase());
    } else name = unique(sanitizeName(distinct[0]));
    netName[net.id] = name;
    for (const n of distinct) byName.set(n.toLowerCase(), name);
  }
  for (const net of nets) {
    if (netName[net.id] !== undefined || !isFloating(net)) continue;
    const pr = net.pins[0];
    const part = placed[pr.part];
    const lib = part.def ? asLibraryPart(part.def) : undefined;
    if (lib?.groundWhenOpen?.includes(pr.pin)) {
      netName[net.id] = '0';
      groundedOpen.add(net.id);
    } else {
      netName[net.id] = unique(sanitizeName(`NC_${part.inst.refdes}_${pinTag(pr.pin)}`));
      floating.add(net.id);
    }
  }
  let counter = 1;
  for (const net of nets) {
    if (netName[net.id] !== undefined) continue;
    let name = `N${counter++}`;
    while (taken.has(name.toLowerCase())) name = `N${counter++}`;
    taken.add(name.toLowerCase());
    netName[net.id] = name;
  }
  const spiceNames = new Map<string, string>();
  for (const n of netName) spiceNames.set(n.toLowerCase(), n);

  // ---- bus problems --------------------------------------------------------------------------
  for (const b of conn.busIssues) ercNames.push(busIssueMessage(b, prefix));

  return { ...(child ? { child } : {}), sheets, placed, conn, netName, byName, spiceNames, floating, groundedOpen, splitNets, ercParts, ercNames, ...(ports ? { ports, portLines } : {}), globalsUsed };
}

/**
 * Tie block pins of a level as their child requires: lines joined to a global net (or ground)
 * inside the child join it here, lines shorted inside the child are shorted here. Done by
 * re-running connectivity with synthetic labels would be wasteful; instead the ties are applied
 * to the computed nets by merging them (`mergeNets`).
 */
function applyPortTies(shared: Shared, placed: PlacedPartInfo[], conn: ConnectivityResult): void {
  const merges: [number, number][] = [];
  const globalTies: [number, string][] = [];
  for (const p of placed) {
    const childId = childIdOfPart(p.inst.partId);
    if (childId === undefined || !p.def || !isBlockPartDef(p.def)) continue;
    const ca = shared.childAnalyses.get(childId);
    if (!ca?.portLines) continue;
    for (const line of ca.portLines) {
      const id = conn.pinNet.get(pinKey(p.index, line.key));
      if (id === undefined) continue;
      if (line.global !== undefined) globalTies.push([id, line.global]);
      if (line.joinWith !== undefined) {
        const other = conn.pinNet.get(pinKey(p.index, line.joinWith));
        if (other !== undefined && other !== id) merges.push([other, id]);
      }
    }
  }
  if (!merges.length && !globalTies.length) return;
  for (const [id, g] of globalTies) {
    const net = conn.nets[id];
    if (isGroundNode(g)) net.ground = true;
    else if (!net.globals.some((x) => x.toLowerCase() === g.toLowerCase())) net.globals.push(g);
  }
  // nets carrying the same global name must become one net too
  const byGlobal = new Map<string, number>();
  for (const net of conn.nets) {
    for (const g of net.globals) {
      const k = g.toLowerCase();
      const prev = byGlobal.get(k);
      if (prev === undefined) byGlobal.set(k, net.id);
      else if (prev !== net.id) merges.push([prev, net.id]);
    }
    if (net.ground) {
      const prev = byGlobal.get('\u0000ground');
      if (prev === undefined) byGlobal.set('\u0000ground', net.id);
      else if (prev !== net.id) merges.push([prev, net.id]);
    }
  }
  mergeNets(conn, merges);
}

/** Merge nets (pairs of ids) in a connectivity result, keeping the lower id of each group. */
function mergeNets(conn: ConnectivityResult, pairs: [number, number][]): void {
  if (!pairs.length) return;
  const parent = conn.nets.map((_n, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of pairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const remap = new Map<number, number>();
  const nets: ConnNet[] = [];
  conn.nets.forEach((n, i) => {
    const r = find(i);
    if (r === i) {
      remap.set(i, nets.length);
      nets.push({ ...n, id: nets.length, pins: [...n.pins], labels: [...n.labels], globals: [...n.globals], wires: [...n.wires], ports: [...n.ports] });
    }
  });
  conn.nets.forEach((n, i) => {
    const r = find(i);
    if (r === i) return;
    const target = nets[remap.get(r)!];
    target.pins.push(...n.pins);
    target.labels.push(...n.labels);
    for (const g of n.globals) if (!target.globals.some((x) => x.toLowerCase() === g.toLowerCase())) target.globals.push(g);
    target.wires.push(...n.wires);
    target.ports.push(...n.ports);
    target.ground = target.ground || n.ground;
    remap.set(i, remap.get(r)!);
  });
  const map = (id: number) => remap.get(id) ?? id;
  conn.nets.splice(0, conn.nets.length, ...nets);
  for (const [k, v] of conn.pinNet) conn.pinNet.set(k, map(v));
  for (const s of conn.splits.values()) {
    s.netA = map(s.netA);
    s.netB = map(s.netB);
  }
  const netAt = conn.netAt;
  conn.netAt = (sheetId, p) => {
    const id = netAt(sheetId, p);
    return id === undefined ? undefined : map(id);
  };
  const netOfName = conn.netOfName;
  conn.netOfName = (sheetId, name) => {
    const id = netOfName(sheetId, name);
    return id === undefined ? undefined : map(id);
  };
}

function busIssueMessage(b: BusIssue, prefix: string): ErcMessage {
  const loc = { sheetId: b.sheetId, x: b.x, y: b.y };
  const name = b.name ?? '';
  switch (b.kind) {
    case 'badName':
      return { severity: 'error', code: 'other', message: `${prefix}Bus name '${name}' is not valid: ${b.detail ?? ''}`, detail: { id: 'busBadName', params: { name, problem: b.detail ?? '' } }, ...loc };
    case 'entryOffBus':
      return { severity: 'warning', code: 'other', message: `${prefix}Bus entry '${name}' is not on a bus`, detail: { id: 'busEntryOffBus', params: { name } }, ...loc };
    case 'entryUnknownLine':
      return { severity: 'warning', code: 'other', message: `${prefix}Bus entry '${name}' names a line that bus ${b.detail ?? ''} does not have`, detail: { id: 'busEntryUnknownLine', params: { name, bus: b.detail ?? '' } }, ...loc };
    case 'wireOnBus':
      return { severity: 'warning', code: 'other', message: `${prefix}A wire ends on a bus without a bus entry, so it is not connected to any bus line`, detail: { id: 'busWireNoEntry' }, ...loc };
    case 'busNames':
      return { severity: 'warning', code: 'other', message: `${prefix}Connected bus wires have different names (${b.detail ?? ''}); their lines are merged`, detail: { id: 'busNames', params: { names: b.detail ?? '' } }, ...loc };
    case 'busPinNoBus':
      return { severity: 'error', code: 'other', message: `${prefix}${name} is a bus pin: connect it with a bus wire`, detail: { id: 'busPinNoBus', params: { pin: name } }, ...loc };
    case 'busPinUnnamed':
      return { severity: 'error', code: 'other', message: `${prefix}The bus at ${name} has no line names: give the bus a name such as D[0..7]`, detail: { id: 'busPinUnnamed', params: { pin: name } }, ...loc };
    case 'busPinWidth':
      return { severity: 'error', code: 'other', message: `${prefix}${name}: the pin has ${b.detail?.split('/')[0]} lines but the bus has ${b.detail?.split('/')[1]}`, detail: { id: 'busPinWidth', params: { pin: name, pinLines: b.detail?.split('/')[0] ?? '', busLines: b.detail?.split('/')[1] ?? '' } }, ...loc };
  }
}

/** Analysis of a child design (memoised; null when it cannot be built). */
function childAnalysis(shared: Shared, childId: string): LevelAnalysis | null {
  if (shared.childAnalyses.has(childId)) return shared.childAnalyses.get(childId) ?? null;
  const child = getChild(shared.design, childId);
  if (!child || shared.cyclic.has(childId)) {
    shared.childAnalyses.set(childId, null);
    return null;
  }
  shared.childAnalyses.set(childId, null); // recursion guard (cycles are pre-checked)
  const a = analyzeLevel(child.sheets, shared, child);
  shared.childAnalyses.set(childId, a);
  return a;
}

// ---------------------------------------------------------------------------
// level emission (elements; depends on parameter values)
// ---------------------------------------------------------------------------

interface EmittedChild {
  name: string;
  childId: string;
  def: SubcktDef;
  analysis: LevelAnalysis;
  /** local element name (lower) -> owner */
  owners: Map<string, Owner>;
  /** local X element (lower) -> subcircuit name of a nested block */
  blocks: Map<string, { subckt: string; refdes: string }>;
  /** probe bindings with local names (bound to the first instance by the root) */
  probes: LocalProbe[];
  /** part refdes -> pin -> local node */
  partNets: Record<string, Record<string, string>>;
  /** instruments and indicators of the child with child-local names (expanded per placed copy) */
  live: LiveBindings;
}

/** Instrument and indicator bindings of one design level. */
interface LiveBindings {
  instruments: InstrumentBinding[];
  indicators: IndicatorBinding[];
  /** the ladder program of a block level (child-local element name) */
  ladder?: LadderBinding;
}

interface LocalProbe {
  binding: ProbeBinding;
}

interface EmitResult {
  set: ElementSet;
  failed: Set<number>;
  partElements: Map<number, ElementIR[]>;
  blocks: Map<string, { subckt: string; refdes: string }>;
  probes: ProbeBinding[];
  partNets: Record<string, Record<string, string>>;
  ratings: RatingBinding[];
  mcus: McuBinding[];
  mechas: MechaBinding[];
  /** the ladder program of the top level and the element that runs it */
  ladder?: LadderBinding;
  /** instruments and indicators of the level (child-local names inside a block) */
  live: LiveBindings;
}

/**
 * `overrides`: parameter values of this level's parts that belong to the placed copy being emitted
 * (PartInstance.inner of the block above), keyed by refdes ("S1") or refdes path ("X2/S1").
 */
function emitLevel(a: LevelAnalysis, scope: VariableScope, shared: Shared, set: ElementSet, once: boolean, customElements: ElementIR[] = [], overrides?: Record<string, Record<string, string>>): EmitResult {
  const prefix = a.child ? `${a.child.name}: ` : '';
  const isChild = a.child !== undefined;
  const failed = new Set<number>();
  const partElements = new Map<number, ElementIR[]>();
  const blocks = new Map<string, { subckt: string; refdes: string }>();
  const ratings: RatingBinding[] = [];
  const mcus: McuBinding[] = [];
  const mechas: MechaBinding[] = [];
  const push = (m: ErcMessage) => pushErc(shared, m, once);
  const partParams = (def: PartDef, inst: PartInstance) => substituteVariables(def, { ...defaultParams(def), ...inst.params, ...(overrides?.[inst.refdes] ?? {}) }, scope);
  const netIdOf = (part: PlacedPartInfo, pin: string): number | undefined => a.conn.pinNet.get(pinKey(part.index, pin));
  const refdesOfSection = (part: PlacedPartInfo): string => sectionLabel(part.inst.refdes, packageOf(part.def)?.section);
  const nodeOf = (part: PlacedPartInfo, pin: string): string | undefined => {
    const id = netIdOf(part, pin);
    return id === undefined ? undefined : a.netName[id];
  };

  // ---- multi-section packages (src/model/sections.ts): one chip per shared refdes -------------
  // a section excluded from the simulation (also how an assembly variant leaves a part out) must
  // not take the chip with it: the leader is the first section that takes part, and only those
  // sections put their pins on the package's pin map — the rest sit idle (sectionKit.ts)
  const sectionsOf = packageGroups(
    a.placed.map((p) => ({ inst: p.inst, def: p.def, index: p.index })),
    { active: (p) => !p.inst.excludeFromSim },
  );
  const groupAt = groupIndex(sectionsOf);
  /** package pin -> node, merged over the placed sections of one group */
  const packageNodes = new Map<PackageGroup<PartInstance>, Map<string, string>>();
  for (const g of sectionsOf) {
    const m = new Map<string, string>();
    /** pins that two sections both carry (the supply pins of a dual op-amp): which section gave the node */
    const owner = new Map<string, PlacedPartInfo>();
    const open = new Set<string>();
    // pins of the chip that more than one placed section carries (V+, V-, VCC, GND): they belong to
    // the CHIP, so a section that is left out of the simulation (excluded, or not fitted in the
    // active variant) still supplies them — the other sections keep their power
    const sharedPins = new Map<string, number>();
    for (const s of g.placed) for (const pin of new Set((s.def?.symbol.pins ?? []).map((x) => x.name))) sharedPins.set(pin, (sharedPins.get(pin) ?? 0) + 1);
    for (const s of g.placed) {
      const idle = g.active && s.inst.excludeFromSim;
      const part = a.placed[s.index];
      for (const pin of part.pins) {
        if (idle && (sharedPins.get(pin.name) ?? 0) < 2) continue;
        const n = nodeOf(part, pin.name);
        if (n === undefined) continue;
        const id = netIdOf(part, pin.name);
        const isOpen = id === undefined || a.floating.has(id);
        const have = m.get(pin.name);
        // a shared pin takes the first node that is actually connected: wiring the supply on one
        // section is enough, whichever section was placed first
        if (have === undefined || (open.has(pin.name) && !isOpen)) {
          m.set(pin.name, n);
          owner.set(pin.name, part);
          if (isOpen) open.add(pin.name);
          else open.delete(pin.name);
        } else if (!isOpen && !open.has(pin.name) && have !== n) {
          const first = owner.get(pin.name)!;
          push({
            severity: 'error',
            code: 'other',
            message: `${prefix}${refdesOfSection(first)} and ${refdesOfSection(part)} connect their shared pin ${pin.name} to different nets`,
            detail: { id: 'sectionPinConflict', params: { refdes: first.inst.refdes, pin: pin.name, a: refdesOfSection(first), b: refdesOfSection(part) } },
            sheetId: part.sheetId,
            refdes: part.inst.refdes,
            pin: pin.name,
            x: part.inst.x,
            y: part.inst.y,
          });
        }
      }
    }
    packageNodes.set(g, m);
    // some sections of ONE chip take part and others do not: a chip cannot be half on the board
    // (the variant manager fits a chip as a unit; this catches a hand-set "exclude from simulation")
    if (g.active) {
      const left = g.placed.filter((s) => s.inst.excludeFromSim);
      if (left.length) {
        const first = a.placed[left[0].index];
        const names = left.map((s) => refdesOfSection(a.placed[s.index])).join(', ');
        push({
          severity: 'warning',
          code: 'other',
          message: `${prefix}${names} of chip ${g.refdes} ${left.length > 1 ? 'are' : 'is'} left out of the simulation while other sections of the same chip take part`,
          detail: { id: 'sectionPartlyLeftOut', params: { refdes: g.refdes, names } },
          sheetId: first.sheetId,
          refdes: g.refdes,
          x: first.inst.x,
          y: first.inst.y,
        });
      }
    }
  }

  // partNets (first occurrence of a refdes wins; the sections of a package contribute together)
  const partNets: Record<string, Record<string, string>> = {};
  for (const p of a.placed) {
    if (!p.def || partNets[p.inst.refdes]) continue;
    const group = groupAt.get(p.index);
    if (group) {
      partNets[p.inst.refdes] = Object.fromEntries(packageNodes.get(group) ?? []);
      continue;
    }
    const m: Record<string, string> = {};
    for (const pin of p.pins) {
      const lines = p.busPins?.get(pin.name);
      if (lines) lines.forEach((line, i) => (m[`${pin.name}#${i}`] = nodeOf(p, `${pin.name}#${i}`) ?? line));
      else m[pin.name] = nodeOf(p, pin.name)!;
    }
    partNets[p.inst.refdes] = m;
  }

  // linked electromechanical parts (coils, overload relays and the contacts that follow them, by
  // refdes, on any sheet of this level): the drivers that exist, by lower-case refdes
  const linkTargets = new Map<string, { refdes: string; partId: string; driver: boolean }>();
  for (const p of a.placed) {
    if (!p.def || p.inst.excludeFromSim) continue;
    const key = p.inst.refdes.trim().toLowerCase();
    if (!linkTargets.has(key)) linkTargets.set(key, { refdes: p.inst.refdes, partId: p.def.id, driver: asLibraryPart(p.def).contactLink?.role === 'driver' });
  }

  for (const part of a.placed) {
    const def = part.def;
    if (!def || part.inst.excludeFromSim) continue;
    const refdes = part.inst.refdes;
    const loc: Owner = { refdes, sheetId: part.sheetId, x: part.inst.x, y: part.inst.y };
    // ---- block instance -> X element -------------------------------------------------------
    const childId = childIdOfPart(part.inst.partId);
    if (childId !== undefined && isBlockPartDef(def)) {
      const child = getChild(shared.design, childId)!;
      const cscope = childVariableScope(scope, child.variables, part.inst.params);
      if (cscope.errors.length) {
        for (const e of cscope.errors) push({ severity: 'error', code: 'bad-param', message: `${prefix}${refdes}: parameter ${e.name}: ${e.message}`, detail: { id: 'paramExpression', params: { refdes, label: e.name, text: part.inst.params[e.name] ?? child.variables[e.name] ?? '', message: e.message } }, ...loc });
        failed.add(part.index);
        continue;
      }
      const emitted = emitChild(shared, childId, cscope, childOverrides(refdes, part.inst.inner, overrides));
      if (!emitted) {
        failed.add(part.index);
        continue;
      }
      const nodes: string[] = [];
      for (const line of emitted.analysis.portLines ?? []) {
        if (line.node === undefined) continue;
        nodes.push(nodeOf(part, line.key) ?? '0');
      }
      const xname = blockElementName(refdes);
      if (set.add({ type: 'X', name: xname, nodes, params: {}, model: emitted.name }, loc)) blocks.set(xname.toLowerCase(), { subckt: emitted.name, refdes });
      partElements.set(part.index, []);
      continue;
    }
    if (!def.toSpice) continue;
    // ---- one chip per package: only the leading section emits it ---------------------------
    const group = groupAt.get(part.index);
    if (group && group.leader !== part.index) {
      partElements.set(part.index, []);
      continue;
    }
    const sub = partParams(def, part.inst);
    if (sub.errors.length) {
      for (const e of sub.errors) push({ severity: 'error', code: 'bad-param', message: `${prefix}${refdes}: ${e.label} = '${e.text}': ${e.message}`, detail: { id: 'paramExpression', params: { refdes, label: e.label, text: e.text, message: e.message } }, ...loc });
      failed.add(part.index);
      continue;
    }
    const params = sub.params;
    const perr = validateParams(def, params, loc);
    if (perr.length) {
      for (const m of perr) push(prefix ? { ...m, message: `${prefix}${m.message}` } : m);
      failed.add(part.index);
      continue;
    }
    const num = (key: string): number => {
      const v = parseUserNumber(params[key] ?? '');
      if (!Number.isFinite(v)) throw new Error(`bad value for ${key}`);
      return v;
    };
    // injected faults and burn-out monitors re-route pins through private nodes
    const pinNodes = new Map<string, string>();
    const extraElements: ElementIR[] = [];
    const extraModels: ModelCard[] = [];
    const netOfPin = (pin: string): string => {
      const n = pinNodes.get(pin) ?? nodeOf(part, pin);
      if (n === undefined) throw new Error(`part ${def.id} has no pin '${pin}'`);
      return n;
    };
    try {
      if (part.inst.faults?.length) {
        // hidden auto faults get neutral names so no list shows which part is broken
        const revealed = !!shared.design.autoFault?.revealed;
        const f = faultInsert(part.inst.faults, def, refdes, netOfPin, (x) => (x.hidden && !revealed ? ++shared.hiddenFaults : undefined));
        for (const [pin, n] of f.nodes) pinNodes.set(pin, n);
        extraElements.push(...f.elements);
      }
      const lib = asLibraryPart(def);
      if (!isChild && lib.ratings && ratingEnabled(lib, params)) {
        const r = ratingInsert(lib, lib.ratings, refdes, netOfPin, num);
        for (const [pin, n] of r.nodes) pinNodes.set(pin, n);
        extraElements.push(...r.elements);
        extraModels.push(...r.models);
        ratings.push({ ...r.binding, sheetId: part.sheetId });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push({ severity: 'error', code: /^bad value/i.test(msg) ? 'bad-param' : 'other', message: `${prefix}${refdes}: ${msg}`, detail: { id: 'partError', params: { refdes, message: msg } }, ...loc });
      failed.add(part.index);
      continue;
    }
    const ctx: ToSpiceContextExt = {
      refdes,
      params,
      node: netOfPin,
      num,
      name: (type, suffix) => elementName(type, refdes, suffix),
      internal: (suffix) => internalNodeName(refdes, suffix),
      connected: (pin) => {
        const id = netIdOf(part, pin);
        return id !== undefined && !a.floating.has(id) && !a.groundedOpen.has(id);
      },
      resolveNet: (name) => (isGroundNode(name) ? '0' : (a.byName.get(name.trim().toLowerCase()) ?? a.spiceNames.get(name.trim().toLowerCase()) ?? shared.globalNames?.get(name.trim().toLowerCase()))),
      linkTarget: (name) => {
        const hit = linkTargets.get(name.trim().toLowerCase());
        return hit ? { ...hit, node: internalNodeName(hit.refdes, 'st') } : undefined;
      },
      warn: (id, wparams) => push({ severity: 'warning', code: 'other', message: `${prefix}${refdes}: ${id}`, detail: { id, params: { refdes, ...wparams } }, ...loc }),
      ...(shared.design.digital ? { digital: shared.design.digital } : {}),
      hiddenPower: hiddenPowerMode(shared.design.erc, shared.design.digital),
      ...(group ? { packagePins: (pin: string) => pinNodes.get(pin) ?? packageNodes.get(group)?.get(pin) } : {}),
    };
    let frag: SpiceFragment;
    try {
      frag = def.toSpice(ctx);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const detail: ErcDetail = e instanceof PartErcError ? { id: e.detailId, params: { refdes, ...e.detailParams } } : { id: 'partError', params: { refdes, message: msg } };
      push({ severity: 'error', code: /^bad value/i.test(msg) ? 'bad-param' : 'other', message: `${prefix}${refdes}: ${msg}`, detail, ...loc });
      failed.add(part.index);
      continue;
    }
    const override = part.inst.modelOverride?.trim();
    if (override) {
      const o = applyModelOverride(frag, override, {
        model: (n) => shared.models.get(n.toLowerCase())?.card ?? frag.models?.find((m) => m.name.toLowerCase() === n.toLowerCase()),
        subckt: (n) => shared.subckts.get(n.toLowerCase())?.def ?? frag.subckts?.find((x) => x.name.toLowerCase() === n.toLowerCase()),
      });
      if (o.problem === 'unknown') push({ severity: 'warning', code: 'other', message: `${prefix}${refdes}: model override '${override}' is not defined (add its .model / .subckt in Custom SPICE); using the part's own model`, detail: { id: 'modelOverrideUnknown', params: { refdes, name: override } }, ...loc });
      else if (o.problem === 'incompatible') push({ severity: 'warning', code: 'other', message: `${prefix}${refdes}: model override '${override}' does not fit this part (other device type or port count); using the part's own model`, detail: { id: 'modelOverrideIncompatible', params: { refdes, name: override } }, ...loc });
      else frag = { ...frag, elements: o.elements };
    }
    partElements.set(part.index, frag.elements);
    const mechaInfo = asLibraryPart(def).mecha;
    if (!isChild && mechaInfo) {
      const core = frag.elements.find((e) => e.type === 'A');
      if (core) mechas.push({ refdes, partId: def.id, kind: mechaInfo.kind, element: core.name, sheetId: part.sheetId });
    }
    const mcuInfo = asLibraryPart(def).mcu;
    if (!isChild && mcuInfo) {
      const core = frag.elements.find((e) => e.type === 'A');
      if (core) {
        mcus.push({
          refdes,
          partId: def.id,
          kind: mcuInfo.kind,
          element: core.name,
          program: params[mcuInfo.programParam] ?? '',
          debug: (params.debug ?? 'true').trim().toLowerCase() !== 'false',
          sheetId: part.sheetId,
        });
      }
    }
    // power symbols inside a child drive their global rail at the top level
    const target = isChild && def.globalNet !== undefined ? shared.top : set;
    for (const el of frag.elements) target.add(el, loc);
    for (const el of extraElements) target.add(el, loc);
    for (const m of extraModels) addModel(shared, m, refdes, false, loc);
    if (def.params.some((p) => p.key === 'tolerance' && p.kind === 'number')) {
      const tol = parseUserNumber(params.tolerance ?? '') / 100;
      const carrier = frag.elements.find((e) => (e.type === 'R' || e.type === 'C' || e.type === 'L') && e.value !== undefined);
      if (carrier && Number.isFinite(tol) && tol > 0 && !isChild) shared.tolerances.push({ element: carrier.name, param: 'value', tol, refdes });
    }
    for (const m of frag.models ?? []) addModel(shared, m, refdes, false, loc);
    for (const s of frag.subckts ?? []) addSubckt(shared, s, refdes, false, loc);
  }

  // ---- programmable controller: one element for the whole rack -----------------------------
  // The PLC parts have no toSpice: the rungs of the ladder sheets of this level, the input and
  // output modules and the controller settings make ONE A_LADDER element (ladderBuild.ts). A rack
  // inside a hierarchical block / subcircuit is built the same way (its own program, timers and
  // counters per placed block); only the top-level program is handed to the ladder editor, so the
  // live highlighting follows the top level.
  let ladder: LadderBinding | undefined;
  {
    const modules: LadderModule[] = [];
    for (const part of a.placed) {
      const def = part.def;
      if (!def || part.inst.excludeFromSim) continue;
      const spec = asLibraryPart(def).ladderIo;
      if (!spec) continue;
      const sub = partParams(def, part.inst);
      modules.push({
        refdes: part.inst.refdes,
        partId: def.id,
        sheetId: part.sheetId,
        spec,
        params: sub.params,
        node: (pin) => {
          const id = netIdOf(part, pin);
          if (id === undefined || a.floating.has(id)) return undefined;
          return a.netName[id];
        },
        x: part.inst.x,
        y: part.inst.y,
      });
    }
    const { rungs, sheetIds } = ladderRungsOf(a.sheets);
    if (rungs.length > 0 || modules.length > 0) {
      const built = buildLadder(rungs, sheetIds, modules, (refdes) => set.uniqueName(elementName('A', refdes, 'plc')), shared.design.ladderBlocks ?? []);
      const owner = built.binding?.refdes ?? modules[0]?.refdes ?? 'PLC';
      const loc: ErcLocation = modules[0] ? { sheetId: modules[0].sheetId, x: modules[0].x, y: modules[0].y } : {};
      for (const el of built.elements) set.add(el, { refdes: owner, ...loc });
      for (const m of built.models) addModel(shared, m, owner, false, loc);
      for (const msg of built.messages) push({ severity: msg.severity, code: 'other', message: `${prefix}${msg.message}`, detail: msg.detail, ...(msg.refdes ? { refdes: msg.refdes } : {}), ...(msg.sheetId ? { sheetId: msg.sheetId } : {}), ...(msg.x !== undefined ? { x: msg.x } : {}), ...(msg.y !== undefined ? { y: msg.y } : {}) });
      ladder = built.binding;
    }
  }

  // private nodes of unconnected pins: 1 TΩ to ground keeps the MNA matrix regular
  const usedNodes = new Set<string>();
  for (const el of set.elements) {
    for (const n of el.nodes) usedNodes.add(n);
    if (el.type === 'B' && el.expr) for (const n of expressionNodes(el.expr)) usedNodes.add(n);
  }
  for (const id of a.floating) {
    const name = a.netName[id];
    if (!usedNodes.has(name)) continue;
    const pr = a.conn.nets[id].pins[0];
    const part = a.placed[pr.part];
    set.add(elR(set.uniqueName(`R_${name}`), name, '0', FLOATING_PIN_SHUNT), { refdes: part.inst.refdes, sheetId: part.sheetId, x: pr.x, y: pr.y });
  }

  for (const el of customElements) set.add(el, { refdes: 'custom SPICE' });

  // ---- probes ------------------------------------------------------------------------------
  const probes: ProbeBinding[] = [];
  for (const sheet of a.sheets) {
    for (const pr of sheet.probes) {
      const loc: ErcLocation = { sheetId: sheet.id, x: pr.x, y: pr.y };
      const label = pr.name || pr.id;
      if (pr.kind === 'current' || pr.kind === 'power') {
        const split = a.conn.splits.get(pr.id);
        if (!split) {
          push({ severity: 'warning', code: 'other', message: `${prefix}${pr.kind === 'power' ? 'Power' : 'Current'} probe '${label}' must be placed on a wire segment`, detail: { id: 'probeOnSegment', params: { name: label } }, ...loc });
          continue;
        }
        const pa = a.netName[split.netA];
        const pb = a.netName[split.netB];
        const ename = set.uniqueName(`V_PR_${sanitizeName(label)}`);
        set.add(elSense(ename, pa, pb), { refdes: `probe:${pr.id}`, ...loc });
        const current: SignalRef = { kind: 'current', element: ename };
        const show = pr.show ? { show: pr.show } : {};
        if (pr.kind === 'current') probes.push({ probeId: pr.id, name: pr.name, kind: pr.kind, color: pr.color, signal: current, ...show });
        else probes.push({ probeId: pr.id, name: pr.name, kind: pr.kind, color: pr.color, signal: { kind: 'voltage', pos: pa, neg: '0' }, current, ...show });
        continue;
      }
      const id = a.conn.netAt(sheet.id, pr);
      if (id === undefined) {
        push({ severity: 'warning', code: 'other', message: `${prefix}Probe '${label}' is not on a wire, pin or label`, detail: { id: 'probeOffCircuit', params: { name: label } }, ...loc });
        continue;
      }
      let neg = '0';
      let refName: string | undefined;
      if (pr.kind === 'differential' && pr.ref) {
        const rid = a.conn.netAt(sheet.id, pr.ref);
        if (rid === undefined) push({ severity: 'warning', code: 'other', message: `${prefix}Reference point of probe '${label}' is not on the circuit; using ground`, detail: { id: 'probeRefOff', params: { name: label } }, sheetId: sheet.id, x: pr.ref.x, y: pr.ref.y });
        else neg = a.netName[rid];
      } else if ((pr.kind === 'voltage' || pr.kind === 'digital') && pr.refProbe) {
        // measured against a reference probe of the same design level
        let found: { sheetId: string; probe: (typeof sheet.probes)[number] } | undefined;
        for (const sh of a.sheets) {
          const rp = sh.probes.find((x) => x.id === pr.refProbe && x.kind === 'reference');
          if (rp) found = { sheetId: sh.id, probe: rp };
        }
        const rid = found ? a.conn.netAt(found.sheetId, found.probe) : undefined;
        if (!found || rid === undefined) push({ severity: 'warning', code: 'other', message: `${prefix}Reference probe of probe '${label}' is missing or not on the circuit; using ground`, detail: { id: 'probeRefMissing', params: { name: label } }, ...loc });
        else {
          neg = a.netName[rid];
          refName = found.probe.name || found.probe.id;
        }
      }
      probes.push({ probeId: pr.id, name: pr.name, kind: pr.kind, color: pr.color, signal: { kind: 'voltage', pos: a.netName[id], neg }, ...(pr.show ? { show: pr.show } : {}), ...(refName ? { refName } : {}) });
    }
  }

  // ---- instruments and indicators of the level (inside a block: child-local names, expanded per copy)
  const live: LiveBindings = { instruments: [], indicators: [] };
  for (const part of a.placed) {
    const def = part.def;
    if (!def || part.inst.excludeFromSim || failed.has(part.index) || (!def.instrument && !def.indicator)) continue;
    const lib = asLibraryPart(def);
    const refdes = part.inst.refdes;
    const params = partParams(def, part.inst).params;
    const bctx: InstrumentBindContext = {
      refdes,
      params,
      net: (pin) => {
        const id = netIdOf(part, pin);
        if (id === undefined || a.floating.has(id)) return null;
        return a.netName[id];
      },
      name: (type, suffix) => elementName(type, refdes, suffix),
      elements: partElements.get(part.index) ?? [],
    };
    const loc: ErcLocation = { refdes, sheetId: part.sheetId, x: part.inst.x, y: part.inst.y };
    try {
      if (def.instrument) {
        const b = lib.bindInstrument ? lib.bindInstrument(bctx) : { channels: {}, drives: [] };
        live.instruments.push({ refdes, partId: def.id, kind: def.instrument, params, channels: b.channels, drives: b.drives });
      }
      if (def.indicator) {
        const b = lib.bindIndicator ? lib.bindIndicator(bctx) : defaultIndicator(def, bctx);
        if (b) live.indicators.push({ refdes, partId: def.id, kind: def.indicator.kind, params, signal: b.signal, ...(b.current ? { current: b.current } : {}), ...(b.signals?.length ? { signals: b.signals } : {}) });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      push({ severity: 'error', code: 'other', message: `${prefix}${refdes}: ${message}`, detail: { id: 'partError', params: { refdes, message } }, ...loc });
    }
  }
  if (ladder && isChild) live.ladder = ladder;
  return { set, failed, partElements, blocks, probes, partNets, ratings, mcus, mechas, live, ...(ladder && !isChild ? { ladder } : {}) };
}

/** Connectivity ERC of a level (floating pins, single-pin nets, dangling wires, ...). */
function connectivityErc(a: LevelAnalysis, shared: Shared, once: boolean): void {
  const prefix = a.child ? `${a.child.name}: ` : '';
  const push = (m: ErcMessage) => pushErc(shared, m, once);
  const isPortNet = (net: ConnNet) => a.child !== undefined && net.ports.length > 0;
  // a pin that two sections of one package share (V+ of a dual op-amp) is connected as soon as one
  // of the sections wires it: the others raise no floating-pin warning for it
  const sharedConnected = new Set<string>();
  for (const g of packageGroups(a.placed.map((p) => ({ inst: p.inst, def: p.def, index: p.index })))) {
    if (g.placed.length < 2) continue;
    const wired = new Set<string>();
    for (const s of g.placed) for (const pin of a.placed[s.index].pins) {
      const id = a.conn.pinNet.get(pinKey(s.index, pin.name));
      if (id !== undefined && !a.floating.has(id)) wired.add(pin.name);
    }
    for (const s of g.placed) for (const pin of a.placed[s.index].pins) if (wired.has(pin.name)) sharedConnected.add(pinKey(s.index, pin.name));
  }
  for (const part of a.placed) {
    const def = part.def;
    if (!def || def.globalNet !== undefined || part.inst.excludeFromSim) continue;
    const lib = asLibraryPart(def);
    for (const pin of part.pins) {
      const id = a.conn.pinNet.get(pinKey(part.index, pin.name));
      if (id === undefined || !a.floating.has(id)) continue;
      if (sharedConnected.has(pinKey(part.index, pin.name))) continue;
      if (lib.optionalPins?.includes(pin.name) || lib.groundWhenOpen?.includes(pin.name)) continue;
      // intentionally open pins: an NC marker (Edit › NC marker) or a pin of type 'nc'
      if (isNcPin(part.inst, pin.name) || normalizePinType(pin.pin.type) === 'nc') continue;
      push({
        severity: 'warning',
        code: 'floating-pin',
        message: `${prefix}${part.inst.refdes} pin ${pin.name} is not connected`,
        detail: { id: 'floatingPin', params: { refdes: part.inst.refdes, pin: pin.name } },
        sheetId: part.sheetId,
        refdes: part.inst.refdes,
        pin: pin.name,
        x: pin.x,
        y: pin.y,
      });
    }
  }
  for (const net of a.conn.nets) {
    if (net.ground || net.globals.length || a.splitNets.has(net.id) || isPortNet(net)) continue;
    if (net.wires.length === 0 && net.labels.length === 0) continue;
    // nets reaching another sheet through an off-page connector count as connected there
    const real = net.pins.filter((p) => a.placed[p.part].def?.globalNet === undefined);
    if (real.length !== 1) continue;
    const p: ConnPinRef = real[0];
    const part = a.placed[p.part];
    push({
      severity: 'warning',
      code: 'single-pin-net',
      message: `${prefix}Net ${a.netName[net.id]} connects only to ${part.inst.refdes} pin ${p.pin}`,
      detail: { id: 'singlePinNet', params: { net: a.netName[net.id], refdes: part.inst.refdes, pin: p.pin } },
      sheetId: p.sheetId,
      refdes: part.inst.refdes,
      pin: p.pin,
      net: a.netName[net.id],
      x: p.x,
      y: p.y,
    });
  }
  for (const d of a.conn.dangling) {
    push({ severity: 'warning', code: 'dangling-wire', message: `${prefix}Wire end at (${d.x}, ${d.y}) is not connected to anything`, detail: { id: 'danglingWire', params: { x: d.x, y: d.y } }, sheetId: d.sheetId, x: d.x, y: d.y });
  }
  for (const o of a.conn.pinsOnWire) {
    const part = a.placed[o.part];
    if (part.inst.excludeFromSim) continue;
    push({
      severity: 'warning',
      code: 'other',
      message: `${prefix}${part.inst.refdes} pin ${o.pin} lies on a wire that passes over it without connecting (only wire ends connect to pins)`,
      detail: { id: 'pinUnderWire', params: { refdes: part.inst.refdes, pin: o.pin } },
      sheetId: o.sheetId,
      refdes: part.inst.refdes,
      pin: o.pin,
      x: o.x,
      y: o.y,
    });
  }
  // a sense source whose side is connected to nothing else reads 0 (probe on an open wire stub)
  const senseTerminals = new Map<number, number>();
  for (const s of a.conn.splits.values()) for (const id of [s.netA, s.netB]) senseTerminals.set(id, (senseTerminals.get(id) ?? 0) + 1);
  for (const sheet of a.sheets) {
    for (const pr of sheet.probes) {
      const s = a.conn.splits.get(pr.id);
      if (!s) continue;
      const open = [s.netA, s.netB].some((id) => {
        const net = a.conn.nets[id];
        return net.pins.length === 0 && net.labels.length === 0 && net.globals.length === 0 && !net.ground && (senseTerminals.get(id) ?? 0) <= 1;
      });
      if (open) {
        push({
          severity: 'warning',
          code: 'other',
          message: `${prefix}${pr.kind === 'power' ? 'Power' : 'Current'} probe '${pr.name || pr.id}' has one side connected to nothing; it will read 0`,
          detail: { id: 'probeOneSide', params: { name: pr.name || pr.id } },
          sheetId: sheet.id,
          x: pr.x,
          y: pr.y,
        });
      }
    }
  }
  // ---- multi-section packages and the pin-type matrix ----------------------------------------
  for (const m of sectionIssues(
    a.placed.map((p) => ({ inst: p.inst, def: p.def, index: p.index })),
    (p) => ({ sheetId: a.placed[p.index].sheetId, x: a.placed[p.index].inst.x, y: a.placed[p.index].inst.y }),
    prefix,
  )) {
    push(m);
  }
  const nets = pinTypeNets(a);
  for (const m of checkPinTypes(nets, { settings: shared.design.erc, prefix })) push(m);
  for (const m of checkUndrivenInputs(nets, { settings: shared.design.erc, prefix })) push(m);
}

/** The nets of a level with the pins that touch them, for the pin-type matrix (src/model/ercMatrix.ts). */
function pinTypeNets(a: LevelAnalysis): ErcNetPins[] {
  const out: ErcNetPins[] = [];
  for (const net of a.conn.nets) {
    const node = a.netName[net.id];
    if (node === undefined || a.floating.has(net.id)) continue;
    const pins: ErcPinEntry[] = [];
    for (const pr of net.pins) {
      const part = a.placed[pr.part];
      const def = part.def;
      if (!def || def.globalNet !== undefined || part.inst.excludeFromSim) continue;
      const pin = def.symbol.pins.find((x) => x.name === pr.pin.replace(/#\d+$/, ''));
      pins.push({
        refdes: sectionLabel(part.inst.refdes, packageOf(def)?.section),
        pin: pr.pin,
        type: normalizePinType(pin?.type),
        ...(isNcPin(part.inst, pr.pin) ? { nc: true } : {}),
        sheetId: pr.sheetId,
        x: pr.x,
        y: pr.y,
      });
    }
    if (pins.length < 2) continue;
    const rail = net.ground || net.globals.length > 0;
    const label = net.labels[0]?.name ?? net.globals[0];
    const port = net.labels.some((l) => l.kind === 'hier');
    out.push({ node, name: label && label.trim() ? label.trim() : node, pins, ...(rail ? { rail: true } : {}), ...(port ? { port: true } : {}) });
  }
  return out;
}

/** Hierarchy-specific checks of a level: local labels shadowing global names, port problems. */
function hierarchyErc(a: LevelAnalysis, shared: Shared, globalNamesAll: Set<string>): void {
  const prefix = a.child ? `${a.child.name}: ` : '';
  // a local label named like a global net is a different net (since version 2): say so
  for (const net of a.conn.nets) {
    if (net.globals.length || net.ground) continue;
    const l = net.labels.find((x) => (x.kind === undefined || x.kind === 'label') && !x.global && globalNamesAll.has(x.name.toLowerCase()));
    if (l) {
      pushErc(shared, { severity: 'warning', code: 'other', message: `${prefix}Local net label '${l.name}' is not connected to the global net '${l.name}'; mark the label global or use a global connector`, detail: { id: 'localShadowsGlobal', params: { name: l.name } }, sheetId: l.sheetId, x: l.x, y: l.y }, true);
    }
  }
  if (a.child) {
    for (const line of a.portLines ?? []) {
      if (line.global === '0' || (line.global !== undefined && isGroundNode(line.global))) {
        pushErc(shared, { severity: 'warning', code: 'other', message: `${prefix}Port ${line.line} is connected to ground inside the block; the block pin is ground`, detail: { id: 'portGround', params: { port: line.line, block: a.child.name } }, ...portLoc(a, line.line) }, true);
      } else if (line.joinWith !== undefined) {
        const other = a.portLines!.find((l) => l.key === line.joinWith);
        pushErc(shared, { severity: 'warning', code: 'other', message: `${prefix}Ports ${other?.line ?? line.joinWith} and ${line.line} are connected together inside the block`, detail: { id: 'portsShorted', params: { a: other?.line ?? line.joinWith, b: line.line, block: a.child.name } }, ...portLoc(a, line.line) }, true);
      }
    }
    if ((a.ports ?? []).length === 0) {
      pushErc(shared, { severity: 'warning', code: 'other', message: `${prefix}The block has no hierarchical connectors, so nothing outside can connect to it`, detail: { id: 'blockNoPorts', params: { block: a.child.name } }, ...(a.sheets[0] ? { sheetId: a.sheets[0].id } : {}) }, true);
    }
    } else {
    // hierarchical connectors on the top level have nothing outside to connect to
    for (const sheet of a.sheets) for (const l of sheet.labels) {
      if (l.kind === 'hier') pushErc(shared, { severity: 'warning', code: 'other', message: `Hierarchical connector '${l.name}' is on a top-level sheet; it only becomes a port inside a subcircuit or hierarchical block`, detail: { id: 'hierOnRoot', params: { name: l.name } }, sheetId: sheet.id, x: l.x, y: l.y }, true);
    }
  }
  // an off-page connector whose name appears on only one sheet joins nothing
  const offpage = new Map<string, { sheets: Set<string>; l: { sheetId: string; x: number; y: number; name: string } }>();
  for (const sheet of a.sheets) for (const l of sheet.labels) {
    if (l.kind !== 'offpage' || !l.name.trim()) continue;
    const k = l.name.trim().toLowerCase();
    const e = offpage.get(k) ?? { sheets: new Set<string>(), l: { sheetId: sheet.id, x: l.x, y: l.y, name: l.name.trim() } };
    e.sheets.add(sheet.id);
    offpage.set(k, e);
  }
  for (const e of offpage.values()) {
    if (e.sheets.size < 2) pushErc(shared, { severity: 'warning', code: 'other', message: `${prefix}Off-page connector '${e.l.name}' has no partner on another sheet`, detail: { id: 'offpageAlone', params: { name: e.l.name } }, sheetId: e.l.sheetId, x: e.l.x, y: e.l.y }, true);
  }
}

function portLoc(a: LevelAnalysis, line: string): ErcLocation {
  for (const s of a.sheets) for (const l of s.labels) if (l.kind === 'hier' && l.name.trim().toLowerCase() === line.toLowerCase()) return { sheetId: s.id, x: l.x, y: l.y };
  return {};
}

/** Emit (or reuse) the subcircuit of a child for one set of parameter values. */
function emitChild(shared: Shared, childId: string, scope: VariableScope, overrides?: Record<string, Record<string, string>>): EmittedChild | null {
  const a = shared.childAnalyses.get(childId) ?? childAnalysis(shared, childId);
  if (!a || !a.child) return null;
  const child = a.child;
  const values = Object.keys(child.variables)
    .map((k) => [k.toLowerCase(), scope.values.get(k.toLowerCase())] as const)
    .sort((x, y) => (x[0] < y[0] ? -1 : 1));
  // copies whose parts hold different live state (a closed and an open switch) get their own subcircuit
  const key = `${childId}\u0000${JSON.stringify(values)}\u0000${overridesKey(overrides)}`;
  const known = shared.variants.get(key);
  if (known) return known;
  const n = (shared.variantCount.get(childId) ?? 0) + 1;
  shared.variantCount.set(childId, n);
  let name = `${child.kind === 'hierarchical' ? 'HB' : 'SC'}_${sanitizeName(child.name)}${n > 1 ? `_${n}` : ''}`;
  while (shared.usedSubcktNames.has(name.toLowerCase())) name = `${name}_`;
  shared.usedSubcktNames.add(name.toLowerCase());
  const first = n === 1;
  const set = new ElementSet(shared.erc);
  // reserve the entry before emitting nested levels (cycles were rejected up front)
  const def: SubcktDef = { name, ports: (a.portLines ?? []).filter((l) => l.node !== undefined).map((l) => l.node!), params: {}, elements: set.elements, models: {}, subckts: {} };
  const emitted: EmittedChild = { name, childId, def, analysis: a, owners: set.owners, blocks: new Map(), probes: [], partNets: {}, live: { instruments: [], indicators: [] } };
  shared.variants.set(key, emitted);
  if (first) {
    for (const m of a.ercParts) pushErc(shared, m, true);
    for (const m of a.ercNames) pushErc(shared, m, true);
  }
  const res = emitLevel(a, scope, shared, set, true, [], overrides);
  emitted.live = res.live;
  emitted.blocks = res.blocks;
  emitted.probes = res.probes.map((binding) => ({ binding }));
  emitted.partNets = res.partNets;
  if (first) connectivityErc(a, shared, true);
  addSubckt(shared, def, child.name, false, {});
  return emitted;
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/** Global names used anywhere in the hierarchy (power symbols, global labels / connectors). */
function collectGlobalNames(design: Design, lookup: (id: string) => PartDef | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (n: string) => {
    const t = n.trim();
    if (!t || isGroundNode(t)) return;
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  const visit = (sheets: Sheet[]) => {
    for (const s of sheets) {
      for (const p of s.parts) {
        const g = lookup(p.partId)?.globalNet;
        if (g !== undefined) add(g);
      }
      for (const l of s.labels) {
        if (l.kind === 'global' || ((l.kind === undefined || l.kind === 'label') && l.global)) {
          const parsed = l.name.includes('[') || l.name.includes(',') ? l.name.split(',') : [l.name];
          for (const n of parsed) add(n);
        }
      }
    }
  };
  visit(design.sheets);
  for (const c of design.children ?? []) visit(c.sheets);
  return out;
}

export function buildNetlist(input: Design, options: BuildNetlistOptions = {}): NetlistBuildEx {
  // the active design variant: parts it does not fit are left out like excludeFromSim parts
  const design = variantView(input);
  const erc: ErcMessage[] = [];
  const lookup = designPartLookup(design, getPart);
  const hierarchical = (design.children?.length ?? 0) > 0;
  const shared: Shared = {
    design,
    lookup,
    erc,
    seen: new Set(),
    models: new Map(),
    subckts: new Map(),
    top: new ElementSet(erc),
    tolerances: [],
    childAnalyses: new Map(),
    cyclic: hierarchical ? cyclicChildren(design) : new Set(),
    variants: new Map(),
    variantCount: new Map(),
    usedSubcktNames: new Set(),
    hiddenFaults: 0,
  };
  const globalList = hierarchical ? collectGlobalNames(design, lookup) : [];
  if (hierarchical) {
    shared.globalNames = new Map();
    const taken = new Set<string>(['0', 'gnd']);
    for (const g of globalList) {
      let name = sanitizeName(g);
      for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${sanitizeName(g)}_${k}`;
      taken.add(name.toLowerCase());
      shared.globalNames.set(g.toLowerCase(), name);
    }
  }

  // global parameters: evaluated once, used by "{expr}" part values (variables.ts)
  const scope = resolveDesignVariables(design.variables);
  for (const e of scope.errors) erc.push({ severity: 'error', code: 'bad-param', message: `Global parameter ${e.name}: ${e.message}`, detail: { id: 'globalParam', params: { name: e.name, message: e.message } } });

  // ---- analysis of the root level (children are analysed on demand, bottom-up) --------------
  const root = analyzeLevel(design.sheets, shared);
  erc.push(...root.ercParts);
  erc.push(...root.ercNames);

  // ---- custom SPICE --------------------------------------------------------------------------
  let customParams: Record<string, number | string> = {};
  let customElements: ElementIR[] = [];
  // .ic / .nodeset / .meas cards of the custom SPICE text (e.g. carried over by SPICE import)
  let customIc: Record<string, number> = {};
  let customNodeset: Record<string, number> = {};
  let customMeasures: Netlist['measures'];
  if (design.customSpice && design.customSpice.trim() !== '') {
    // (.step cards belong to the analysis that runs, see steps.ts; they are blanked, not parsed here)
    const res = parseSpice(blankStepCards(design.customSpice), { hasTitle: false, fileName: 'custom SPICE' });
    for (const e of res.errors) erc.push({ severity: 'error', code: 'other', message: `Custom SPICE line ${e.line}: ${e.message}`, detail: { id: 'customSpiceLine', params: { line: e.line, message: e.message } } });
    for (const c of Object.values(res.netlist.models)) addModel(shared, c, 'custom SPICE', true, {});
    for (const s of Object.values(res.netlist.subckts)) addSubckt(shared, s, 'custom SPICE', true, {});
    customParams = res.netlist.params;
    customElements = res.netlist.elements;
    customIc = res.netlist.ic;
    customNodeset = res.netlist.nodeset;
    customMeasures = res.netlist.measures;
  }

  // ---- 4/5/6. elements and probes of the root (blocks emit their subcircuits) ---------------
  const rootRes = emitLevel(root, scope, shared, shared.top, false, customElements);
  const elements = shared.top.elements;
  const owners = shared.top.owners;
  const probes: ProbeBinding[] = rootRes.probes;
  const netName = root.netName;
  const nets = root.conn.nets;

  // ---- 7. instruments and indicators (top level; blocks add one binding per placed copy) ----
  const instruments: InstrumentBinding[] = [...rootRes.live.instruments];
  const indicators: IndicatorBinding[] = [...rootRes.live.indicators];
  const ladders: LadderBinding[] = [];

  // ---- 8. ERC on connectivity and topology -----------------------------------------------
  connectivityErc(root, shared, false);
  const instancesOut: BlockInstanceInfo[] = [];
  const partNets: Record<string, Record<string, string>> = { ...rootRes.partNets };
  if (hierarchical) {
    const allGlobals = new Set(globalList.map((g) => g.toLowerCase()));
    hierarchyErc(root, shared, allGlobals);
    for (const c of design.children ?? []) {
      const a = shared.childAnalyses.get(c.id);
      if (a) hierarchyErc(a, shared, allGlobals);
    }
    expandInstances(shared, rootRes.blocks, probes, partNets, instancesOut, instruments, indicators, ladders);
  } else {
    for (const sheet of design.sheets) for (const l of sheet.labels) {
      if (l.kind === 'hier') erc.push({ severity: 'warning', code: 'other', message: `Hierarchical connector '${l.name}' is on a top-level sheet; it only becomes a port inside a subcircuit or hierarchical block`, detail: { id: 'hierOnRoot', params: { name: l.name } }, sheetId: sheet.id, x: l.x, y: l.y });
    }
    const offpage = new Map<string, { sheets: Set<string>; sheetId: string; x: number; y: number; name: string }>();
    for (const sheet of design.sheets) for (const l of sheet.labels) {
      if (l.kind !== 'offpage' || !l.name.trim()) continue;
      const k = l.name.trim().toLowerCase();
      const e = offpage.get(k) ?? { sheets: new Set<string>(), sheetId: sheet.id, x: l.x, y: l.y, name: l.name.trim() };
      e.sheets.add(sheet.id);
      offpage.set(k, e);
    }
    for (const e of offpage.values()) {
      if (e.sheets.size < 2) erc.push({ severity: 'warning', code: 'other', message: `Off-page connector '${e.name}' has no partner on another sheet`, detail: { id: 'offpageAlone', params: { name: e.name } }, sheetId: e.sheetId, x: e.x, y: e.y });
    }
    const globalsHere = new Set<string>();
    for (const net of nets) for (const g of net.globals) globalsHere.add(g.toLowerCase());
    for (const net of nets) {
      if (net.globals.length || net.ground) continue;
      const l = net.labels.find((x) => (x.kind === undefined || x.kind === 'label') && !x.global && globalsHere.has(x.name.toLowerCase()));
      if (l) erc.push({ severity: 'warning', code: 'other', message: `Local net label '${l.name}' is not connected to the global net '${l.name}'; mark the label global or use a global connector`, detail: { id: 'localShadowsGlobal', params: { name: l.name } }, sheetId: l.sheetId, x: l.x, y: l.y });
    }
  }

  const modelObj = Object.fromEntries([...shared.models].map(([k, v]) => [k, v.card]));
  const subcktObj = Object.fromEntries([...shared.subckts].map(([k, v]) => [k, v.def]));
  if (!hierarchical || shared.variants.size === 0) {
    const ownerOf = (name: string): ErcLocation | undefined => owners.get(name.toLowerCase());
    const g = checkGround(elements);
    if (g) erc.push(g);
    // inductor loops only break analyses that need a DC operating point; a UIC transient skips it
    const activeSpec = design.analysis?.specs?.[design.analysis.active];
    const uicTran = activeSpec?.type === 'tran' && activeSpec.uic === true;
    erc.push(...checkVoltageLoops(elements, ownerOf, { inductorSeverity: uicTran ? 'warning' : 'error' }));
    if (!g) erc.push(...checkCurrentCutsets(elements, ownerOf));
    erc.push(...checkModelRefs(elements, modelObj, subcktObj, ownerOf));
    erc.push(...checkExpressionNets(elements, ownerOf));
  } else {
    // topology checks on the circuit with every block expanded (library subcircuits stay opaque)
    const expanded = expandForErc(shared, elements);
    const ownerOf = (name: string): ErcLocation | undefined => expanded.owners.get(name.toLowerCase());
    const g = checkGround(expanded.elements);
    if (g) erc.push(g);
    const activeSpec = design.analysis?.specs?.[design.analysis.active];
    const uicTran = activeSpec?.type === 'tran' && activeSpec.uic === true;
    erc.push(...checkVoltageLoops(expanded.elements, ownerOf, { inductorSeverity: uicTran ? 'warning' : 'error' }));
    if (!g) erc.push(...checkCurrentCutsets(expanded.elements, ownerOf));
    erc.push(...checkModelRefs(expanded.elements, modelObj, subcktObj, ownerOf));
    erc.push(...checkExpressionNets(elements, (n) => owners.get(n.toLowerCase())));
    for (const v of shared.variants.values()) {
      const extra = new Set([...(v.def.ports ?? []), ...(shared.globalNames?.values() ?? [])].map((n) => n.toLowerCase()));
      erc.push(...checkExpressionNets(v.def.elements, (n) => v.owners.get(n.toLowerCase()), extra));
    }
  }

  // ---- reference grounds: isolated parts are measured against their own reference ------------
  {
    const ownerOf = (name: string): ErcLocation | undefined => owners.get(name.toLowerCase());
    const refs = analyzeReferenceGrounds(elements, ownerOf);
    erc.push(...refs.messages);
    if (refs.refOf.size) {
      for (const p of probes) {
        if ((p.kind !== 'voltage' && p.kind !== 'digital' && p.kind !== 'power') || p.refName || p.signal.kind !== 'voltage' || !isGroundNode(p.signal.neg)) continue;
        const ref = refs.refOf.get(p.signal.pos.toLowerCase());
        if (ref && ref.toLowerCase() !== p.signal.pos.toLowerCase()) {
          p.signal = { kind: 'voltage', pos: p.signal.pos, neg: ref };
          // power probes: V·I with V against the reference (the flag keeps its plain symbol)
          if (p.kind !== 'power') p.refName = ref;
        }
      }
    }
  }

  // ---- netlist ----------------------------------------------------------------------------
  const netlist: Netlist = emptyNetlist(design.title);
  netlist.elements = elements;
  netlist.models = modelObj;
  netlist.subckts = subcktObj;
  netlist.params = { ...customParams };
  for (const [k, v] of Object.entries(design.variables ?? {})) netlist.params[k] = variableParamValue(v);
  if (hierarchical && shared.globalNames && shared.variants.size > 0) {
    const used = new Set<string>();
    for (const c of design.children ?? []) {
      const a = shared.childAnalyses.get(c.id);
      if (a) for (const g of a.globalsUsed) used.add(g);
    }
    const names = [...used].map((g) => shared.globalNames!.get(g)).filter((n): n is string => !!n);
    if (names.length) {
      const prev = typeof netlist.params[GLOBAL_NODES_KEY] === 'string' ? String(netlist.params[GLOBAL_NODES_KEY]) : '';
      netlist.params[GLOBAL_NODES_KEY] = [...prev.split(/\s+/).filter(Boolean), ...names].join(' ');
    }
  }
  netlist.options = { ...design.options };
  if (Object.keys(customIc).length || Object.keys(customNodeset).length) {
    // node names of .ic / .nodeset are net (label) names: map them to the SPICE nodes
    const known = new Map<string, string>();
    for (const net of nets) {
      const name = netName[net.id];
      if (name === undefined) continue;
      known.set(name.toLowerCase(), name);
      for (const l of net.labels) known.set(l.name.trim().toLowerCase(), name);
      for (const g of net.globals) known.set(g.toLowerCase(), name);
    }
    const mapNodes = (table: Record<string, number>, card: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const [node, v] of Object.entries(table)) {
        const hit = known.get(node.toLowerCase());
        if (hit !== undefined && !isGroundNode(hit)) out[hit] = v;
        else erc.push({ severity: 'warning', code: 'other', message: `Custom SPICE ${card} V(${node}): there is no net '${node}' on the schematic; the value is ignored`, net: node, detail: { id: 'customIcUnknownNet', params: { card, net: node } } });
      }
      return out;
    };
    netlist.ic = mapNodes(customIc, '.ic');
    netlist.nodeset = mapNodes(customNodeset, '.nodeset');
  }
  if (customMeasures?.length) netlist.measures = customMeasures;
  if (options.includeAnalysis !== false) {
    const spec = design.analysis?.specs?.[design.analysis.active];
    if (spec) netlist.analyses = [spec];
  }

  // ---- nets output ------------------------------------------------------------------------
  const info = new Map<string, NetInfo>();
  for (const net of nets) {
    if (!net.pins.length && !root.splitNets.has(net.id) && !net.ground) continue;
    const name = netName[net.id];
    let ni = info.get(name);
    if (!ni) {
      const display = net.ground ? '0' : net.globals[0] ?? net.labels[0]?.name ?? name;
      ni = { name, pins: [], displayName: display, named: net.ground || net.globals.length > 0 || net.labels.length > 0 };
      info.set(name, ni);
    }
    for (const p of net.pins) {
      const part = root.placed[p.part];
      if (part.def) ni.pins.push({ refdes: part.inst.refdes, pin: p.pin });
    }
  }

  const ownersOut: Record<string, string> = {};
  for (const [k, o] of owners) ownersOut[k] = o.refdes;

  return {
    netlist,
    nets: [...info.values()],
    partNets,
    instruments,
    probes,
    erc,
    indicators,
    owners: ownersOut,
    tolerances: shared.tolerances,
    ...(hierarchical ? { instances: instancesOut } : {}),
    ...(rootRes.ratings.length ? { ratings: rootRes.ratings } : {}),
    ...(rootRes.mcus.length ? { mcus: rootRes.mcus } : {}),
    ...(rootRes.mechas.length ? { mechas: rootRes.mechas } : {}),
    ...(rootRes.ladder ? { ladder: rootRes.ladder } : {}),
    ...(ladders.length ? { ladders } : {}),
  };
}

// ---------------------------------------------------------------------------
// expanded views of the hierarchy
// ---------------------------------------------------------------------------

interface InstanceFrame {
  /** flattened prefix, e.g. "XHB1.XSC1" */
  xpath: string;
  /** refdes path, e.g. "HB1/SC1" */
  path: string;
  emitted: EmittedChild;
  /** caller node of every passed port (index = position in def.ports) */
  callerNodes: string[];
}

/** Flattened node name of a child-level node in an instance (ngspice naming, see flatten.ts). */
function mapInstanceNode(frame: InstanceFrame, node: string, globals: Set<string>): string {
  if (isGroundNode(node) || globals.has(node.toLowerCase())) return node;
  const pi = frame.emitted.def.ports.findIndex((p) => p.toLowerCase() === node.toLowerCase());
  if (pi >= 0) return frame.callerNodes[pi];
  return `${frame.xpath}.${node}`;
}

/** Walk every block instance (depth first) with its flattened node mapping. */
function walkInstances(shared: Shared, topBlocks: Map<string, { subckt: string; refdes: string }>, visit: (frame: InstanceFrame) => void): void {
  const bySubckt = new Map<string, EmittedChild>();
  for (const v of shared.variants.values()) bySubckt.set(v.name.toLowerCase(), v);
  const globals = new Set([...(shared.globalNames?.values() ?? [])].map((n) => n.toLowerCase()));
  const recurse = (blocks: Map<string, { subckt: string; refdes: string }>, elements: ElementIR[], parent: InstanceFrame | null, depth: number) => {
    if (depth > 64) return;
    for (const el of elements) {
      if (el.type !== 'X') continue;
      const b = blocks.get(el.name.toLowerCase());
      if (!b) continue;
      const emitted = bySubckt.get(b.subckt.toLowerCase());
      if (!emitted) continue;
      const callerNodes = el.nodes.map((n) => (parent ? mapInstanceNode(parent, n, globals) : n));
      const frame: InstanceFrame = {
        xpath: parent ? `${parent.xpath}.${el.name}` : el.name,
        path: parent ? `${parent.path}/${b.refdes}` : b.refdes,
        emitted,
        callerNodes,
      };
      visit(frame);
      recurse(emitted.blocks, emitted.def.elements, frame, depth + 1);
    }
  };
  recurse(topBlocks, shared.top.elements, null, 0);
}

/**
 * Instance list, child-part nets by path, and the probes, instruments and indicators of child
 * sheets: one binding per placed copy, with the nodes and element names of that copy and its path
 * (a probe measures the copy it sits in; "X2.XMM1" is the multimeter of block X2).
 */
function expandInstances(
  shared: Shared,
  topBlocks: Map<string, { subckt: string; refdes: string }>,
  probes: ProbeBinding[],
  partNets: Record<string, Record<string, string>>,
  out: BlockInstanceInfo[],
  instruments: InstrumentBinding[],
  indicators: IndicatorBinding[],
  ladders: LadderBinding[],
): void {
  const globals = new Set([...(shared.globalNames?.values() ?? [])].map((n) => n.toLowerCase()));
  const counts = childInstanceCounts(shared.design);
  walkInstances(shared, topBlocks, (frame) => {
    out.push({ path: frame.path, xpath: frame.xpath, childId: frame.emitted.childId, subckt: frame.emitted.name });
    for (const [refdes, pins] of Object.entries(frame.emitted.partNets)) {
      const m: Record<string, string> = {};
      for (const [pin, node] of Object.entries(pins)) m[pin] = mapInstanceNode(frame, node, globals);
      partNets[`${frame.path}/${refdes}`] = m;
    }
    const path = frame.path.split('/');
    const mapSig = (s: SignalRef): SignalRef =>
      s.kind === 'voltage' ? { kind: 'voltage', pos: mapInstanceNode(frame, s.pos, globals), neg: mapInstanceNode(frame, s.neg, globals) } : { kind: 'current', element: mapElementName(frame, s.element) };
    const multi = (counts.get(frame.emitted.childId) ?? 0) > 1;
    for (const { binding } of frame.emitted.probes) {
      probes.push({ ...binding, path, ...(multi && binding.name ? { name: `${path.join('.')}.${binding.name}` } : {}), signal: mapSig(binding.signal), ...(binding.current ? { current: mapSig(binding.current) } : {}) });
    }
    for (const b of frame.emitted.live.instruments) {
      instruments.push({ ...b, refdes: [...path, b.refdes].join('.'), scope: { path, local: b.refdes, childId: frame.emitted.childId }, channels: Object.fromEntries(Object.entries(b.channels).map(([k, v]) => [k, mapSig(v)])), drives: b.drives.map((d) => mapElementName(frame, d)) });
    }
    const lad = frame.emitted.live.ladder;
    if (lad) ladders.push({ ...lad, element: mapElementName(frame, lad.element), scope: { path, childId: frame.emitted.childId } });
    for (const b of frame.emitted.live.indicators) {
      indicators.push({ ...b, refdes: [...path, b.refdes].join('.'), scope: { path, local: b.refdes, childId: frame.emitted.childId }, signal: mapSig(b.signal), ...(b.current ? { current: mapSig(b.current) } : {}), ...(b.signals ? { signals: b.signals.map(mapSig) } : {}) });
    }
  });
}

/** Name an element of a block copy gets after flattening ("V_XFG1_p" in "XHB1" -> "V.XHB1.V_XFG1_p"). */
function mapElementName(frame: InstanceFrame, element: string): string {
  return `${element.charAt(0).toUpperCase()}.${frame.xpath}.${element}`;
}

/**
 * Elements with every block instance expanded (names `T.<xpath>.<name>`, nodes mapped like the
 * flattener does) for the topology checks; library subcircuit instances stay as X elements.
 */
function expandForErc(shared: Shared, top: ElementIR[]): { elements: ElementIR[]; owners: Map<string, ErcLocation> } {
  const globals = new Set([...(shared.globalNames?.values() ?? [])].map((n) => n.toLowerCase()));
  const topBlocks = new Map<string, { subckt: string; refdes: string }>();
  // the root's blocks are the X elements whose model is a block subcircuit
  const blockSubckts = new Set([...shared.variants.values()].map((v) => v.name.toLowerCase()));
  for (const el of top) if (el.type === 'X' && el.model && blockSubckts.has(el.model.toLowerCase())) topBlocks.set(el.name.toLowerCase(), { subckt: el.model, refdes: shared.top.owners.get(el.name.toLowerCase())?.refdes ?? el.name });
  const elements: ElementIR[] = top.filter((el) => !(el.type === 'X' && topBlocks.has(el.name.toLowerCase())));
  const owners = new Map<string, ErcLocation>();
  for (const [k, o] of shared.top.owners) owners.set(k, o);
  walkInstances(shared, topBlocks, (frame) => {
    for (const el of frame.emitted.def.elements) {
      if (el.type === 'X' && frame.emitted.blocks.has(el.name.toLowerCase())) continue;
      const name = `${el.type}.${frame.xpath}.${el.name}`;
      const mapped: ElementIR = { ...el, name, nodes: el.nodes.map((n) => mapInstanceNode(frame, n, globals)) };
      if (el.control) mapped.control = frame.emitted.def.elements.some((e) => e.name.toLowerCase() === el.control!.toLowerCase()) ? `V.${frame.xpath}.${el.control}` : el.control;
      if (el.inductors) mapped.inductors = el.inductors.map((l) => (frame.emitted.def.elements.some((e) => e.name.toLowerCase() === l.toLowerCase()) ? `L.${frame.xpath}.${l}` : l));
      elements.push(mapped);
      const o = frame.emitted.owners.get(el.name.toLowerCase());
      if (o) owners.set(name.toLowerCase(), o);
    }
  });
  return { elements, owners };
}

/** Fallback indicator signal: voltage across the first two pins (or pin 1 vs ground). */
function defaultIndicator(def: PartDef, ctx: InstrumentBindContext): { signal: SignalRef; current?: SignalRef; signals?: SignalRef[] } | null {
  const pins = def.symbol.pins;
  if (!pins.length) return null;
  const a = ctx.net(pins[0].name);
  const b = pins.length > 1 ? ctx.net(pins[1].name) : '0';
  if (a === null && b === null) return null;
  return { signal: { kind: 'voltage', pos: a ?? '0', neg: b ?? '0' } };
}

/** Node names referenced by V(a) / V(a,b) inside a behavioral expression. */
export function expressionNodes(expr: string): string[] {
  const out: string[] = [];
  const re = /\b[Vv]\(\s*([^,()]+?)\s*(?:,\s*([^,()]+?)\s*)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    out.push(m[1]);
    if (m[2] !== undefined) out.push(m[2]);
  }
  return out;
}

/** Behavioral sources must only reference nets that exist in the circuit (or in `extra`). */
function checkExpressionNets(elements: ElementIR[], owner: (name: string) => ErcLocation | undefined, extra?: Set<string>): ErcMessage[] {
  const nodes = new Set<string>(extra ?? []);
  for (const el of elements) for (const n of el.nodes) nodes.add(n.toLowerCase());
  const out: ErcMessage[] = [];
  for (const el of elements) {
    if (el.type !== 'B' || !el.expr) continue;
    const missing = new Set<string>();
    for (const n of expressionNodes(el.expr)) if (!isGroundNode(n) && !nodes.has(n.toLowerCase())) missing.add(n);
    if (missing.size) {
      const loc = owner(el.name) ?? {};
      out.push({ severity: 'error', code: 'bad-param', message: `${el.name}: expression refers to unknown net(s) ${[...missing].join(', ')}`, detail: { id: 'exprUnknownNet', params: { element: el.name, nets: [...missing].join(', ') } }, ...loc });
    }
  }
  return out;
}
