/**
 * Circuit construction: flat netlist IR -> devices -> unknown numbering.
 *
 * Steps (see {@link Circuit} constructor):
 * 1. Flatten subcircuits (`flattenNetlist`) when the netlist still contains X instances.
 * 2. Resolve every element's factory through the device registry; an element type without a
 *    factory raises `SimulationError(code 'unsupported')`.
 * 3. Two-pass setup. The contract (src/sim/device.ts) requires node voltages to occupy unknowns
 *    0..numNodes-1 and branch currents to follow, but devices allocate nodes (including internal
 *    ones such as "D1#a") and branches interleaved during setup(). A discovery pass on throw-away
 *    device instances collects every node name in allocation order; the real pass then creates
 *    fresh instances whose node() calls return the final indices and whose branch() calls are
 *    numbered after the last node.
 * 4. bind() resolves cross-device references (F, H, W, K).
 *
 * Names are case-insensitive (lower-cased keys) and keep the case of their first appearance for
 * display. Internal device nodes contain '#' and are excluded from default outputs.
 */
import { GROUND, KELVIN, type BindContext, type SetupContext } from '../device';
import { DEFAULT_OPTIONS, isGroundNode, type ElementIR, type ModelCard, type Netlist, type SimOptions } from '../netlist';
import { SimulationError } from '../results';
import { getDeviceFactory } from '../devices/registry';
import { flattenNetlist } from '../spice/flatten';
import type { EngineDevice } from './hooks';

export interface CircuitBuildOptions {
  /** Overrides applied on top of DEFAULT_OPTIONS and netlist.options. */
  options?: Partial<SimOptions>;
}

/** A resolved .ic / .nodeset entry. */
export interface NodeValue {
  index: number;
  value: number;
  name: string;
}

/** Merge DEFAULT_OPTIONS, netlist options and overrides, ignoring non-finite numeric values. */
export function resolveOptions(...parts: (Partial<SimOptions> | undefined)[]): SimOptions {
  const out: SimOptions = { ...DEFAULT_OPTIONS };
  const target = out as unknown as Record<string, unknown>;
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined) continue;
      if (typeof v === 'number' && !Number.isFinite(v)) continue;
      if (k in DEFAULT_OPTIONS) target[k] = v;
    }
  }
  if (out.method !== 'trap' && out.method !== 'gear') out.method = 'trap';
  return out;
}

function asSimulationError(e: unknown, el: ElementIR): SimulationError {
  if (e instanceof SimulationError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new SimulationError(`${el.name}: ${msg}`, 'netlist', el.line !== undefined ? `line ${el.line}` : undefined);
}

/** Offset of the dummy branch indices handed out during the discovery pass. */
const DISCOVERY_BRANCH_BASE = 1 << 30;

export class Circuit {
  /** The flat netlist the circuit was built from. */
  readonly netlist: Netlist;
  readonly options: SimOptions;
  /** Devices in netlist order. */
  readonly devices: EngineDevice[];
  /** Total number of unknowns (nodes + branches). */
  readonly size: number;
  /** Number of node-voltage unknowns (indices 0..numNodes-1). */
  readonly numNodes: number;
  /** Number of state slots (length of each state vector). */
  readonly numStates: number;
  /** True when every device declares `linear` (single solve per operating point / timepoint). */
  readonly allLinear: boolean;
  /** Warnings collected while building (and later by analyses that share the circuit). */
  readonly warnings: string[] = [];
  /** Resolved .ic entries (node voltages). */
  readonly ic: NodeValue[];
  /** Resolved .nodeset entries. */
  readonly nodeset: NodeValue[];
  /** Circuit temperature in °C (mutable: temperature sweeps). */
  temperature: number;

  private readonly names: string[];
  private readonly nodeMap = new Map<string, number>();
  private readonly deviceMap = new Map<string, EngineDevice>();
  private readonly branchOwners: (EngineDevice | undefined)[] = [];

  /** Build a circuit, flattening subcircuits first. */
  static build(netlist: Netlist, opts: CircuitBuildOptions = {}): Circuit {
    return new Circuit(netlist, opts);
  }

  constructor(netlist: Netlist, opts: CircuitBuildOptions = {}) {
    const flat = netlist.elements.some((e) => e.type === 'X') ? flattenNetlist(netlist) : netlist;
    this.netlist = flat;
    this.options = resolveOptions(flat.options, opts.options);
    this.temperature = this.options.temp;

    const elements = flat.elements;
    const factories = elements.map((el) => {
      const f = getDeviceFactory(el.type);
      if (!f) {
        throw new SimulationError(
          `Element type '${el.type}' (${el.name}) is not supported by the simulator`,
          'unsupported',
          el.line !== undefined ? `line ${el.line}` : undefined,
        );
      }
      return f;
    });
    const lookupModel = (name: string): ModelCard | undefined => {
      const key = name.trim().toLowerCase();
      return flat.models[key] ?? flat.models[name] ?? Object.values(flat.models).find((m) => m.name.toLowerCase() === key);
    };

    // ---- pass 1: discover node names in allocation order --------------------------------
    const nodeNames: string[] = [];
    const discovery = new Map<string, number>();
    let dummyBranches = 0;
    let dummyStates = 0;
    const discoveryCtx: SetupContext = {
      node: (name: string) => {
        if (isGroundNode(name)) return GROUND;
        const key = name.trim().toLowerCase();
        let idx = discovery.get(key);
        if (idx === undefined) {
          idx = nodeNames.length;
          discovery.set(key, idx);
          nodeNames.push(name.trim());
        }
        return idx;
      },
      branch: () => DISCOVERY_BRANCH_BASE + dummyBranches++,
      state: (count: number) => {
        const base = dummyStates;
        dummyStates += Math.max(0, count | 0);
        return base;
      },
      model: lookupModel,
      options: this.options,
      warn: () => undefined,
    };
    elements.forEach((el, k) => {
      try {
        factories[k](el).setup(discoveryCtx);
      } catch (e) {
        throw asSimulationError(e, el);
      }
    });

    // ---- pass 2: real devices with final numbering ---------------------------------------
    this.numNodes = nodeNames.length;
    this.names = nodeNames.slice();
    nodeNames.forEach((n, i) => this.nodeMap.set(n.toLowerCase(), i));
    let numStates = 0;
    let current: EngineDevice | undefined;
    const setupCtx: SetupContext = {
      node: (name: string) => {
        if (isGroundNode(name)) return GROUND;
        const idx = this.nodeMap.get(name.trim().toLowerCase());
        if (idx === undefined) {
          throw new SimulationError(
            `${current?.name ?? 'device'}: node '${name}' was not requested during node discovery (non-deterministic setup)`,
            'internal',
          );
        }
        return idx;
      },
      branch: (label: string) => {
        const idx = this.names.length;
        this.names.push(label || `${current?.name ?? 'branch'}#branch`);
        this.branchOwners.push(current);
        return idx;
      },
      state: (count: number) => {
        const base = numStates;
        numStates += Math.max(0, count | 0);
        return base;
      },
      model: lookupModel,
      options: this.options,
      warn: (message: string) => this.warnings.push(message),
    };
    const devices: EngineDevice[] = [];
    elements.forEach((el, k) => {
      try {
        const d = factories[k](el) as EngineDevice;
        current = d;
        d.setup(setupCtx);
        devices.push(d);
        const key = d.name.toLowerCase();
        if (this.deviceMap.has(key)) this.warnings.push(`Duplicate element name '${d.name}'`);
        else this.deviceMap.set(key, d);
      } catch (e) {
        throw asSimulationError(e, el);
      }
    });
    this.devices = devices;
    this.size = this.names.length;
    this.numStates = numStates;

    const bindCtx: BindContext = {
      findDevice: (name: string) => this.deviceMap.get(name.trim().toLowerCase()),
      warn: (message: string) => this.warnings.push(message),
    };
    devices.forEach((d, k) => {
      try {
        d.bind?.(bindCtx);
      } catch (e) {
        throw asSimulationError(e, elements[k]);
      }
    });
    this.allLinear = devices.every((d) => d.linear === true);
    this.ic = this.resolveNodeValues(flat.ic, '.ic');
    this.nodeset = this.resolveNodeValues(flat.nodeset, '.nodeset');
  }

  private resolveNodeValues(map: Record<string, number> | undefined, what: string): NodeValue[] {
    const out: NodeValue[] = [];
    if (!map) return out;
    for (const [key, value] of Object.entries(map)) {
      if (!Number.isFinite(value)) continue;
      // accept both "out" and "V(out)"
      const m = /^\s*v\s*\(\s*([^,()]+?)\s*\)\s*$/i.exec(key);
      const name = m ? m[1] : key;
      const idx = this.nodeIndex(name);
      if (idx === undefined) this.warnings.push(`${what}: unknown node '${name}' ignored`);
      else if (idx >= 0) out.push({ index: idx, value, name: this.names[idx] });
    }
    return out;
  }

  /** Circuit temperature in kelvin. */
  get tempK(): number {
    return this.temperature + KELVIN;
  }

  /** Index of a node (GROUND for "0"/"gnd"), or undefined when the node does not exist. */
  nodeIndex(name: string): number | undefined {
    if (isGroundNode(name)) return GROUND;
    return this.nodeMap.get(name.trim().toLowerCase());
  }

  /** Branch-current unknown of a device (V, L, E, H, T ...), or -1. */
  branchIndex(deviceName: string): number {
    const d = this.findDevice(deviceName);
    const b = d?.branchIndex ? d.branchIndex() : -1;
    return typeof b === 'number' && b >= 0 ? b : -1;
  }

  findDevice(name: string): EngineDevice | undefined {
    return this.deviceMap.get(name.trim().toLowerCase());
  }

  /** Display name of unknown i: the node name, or the branch label given by its device. */
  unknownName(i: number): string {
    return i === GROUND ? '0' : (this.names[i] ?? `#${i}`);
  }

  isNode(i: number): boolean {
    return i >= 0 && i < this.numNodes;
  }

  /** True for internal device nodes (name contains '#'). */
  isInternalNode(i: number): boolean {
    return this.isNode(i) && this.names[i].includes('#');
  }

  /** Device that allocated branch unknown i (undefined for nodes). */
  branchOwner(i: number): EngineDevice | undefined {
    return i >= this.numNodes ? this.branchOwners[i - this.numNodes] : undefined;
  }

  /** Human-readable description for diagnostics, e.g. "node 'out'" or "branch current of 'V1'". */
  describeUnknown(i: number): string {
    if (i === GROUND) return 'ground';
    if (this.isNode(i)) return `node '${this.names[i]}'`;
    const owner = this.branchOwner(i);
    return `branch current of '${owner?.name ?? this.names[i] ?? `#${i}`}'`;
  }

  /** Names of all node unknowns (index order). */
  nodeNames(): string[] {
    return this.names.slice(0, this.numNodes);
  }
}
