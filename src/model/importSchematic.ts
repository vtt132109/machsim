/**
 * Schematics from other programs → MachSim designs (shared by the KiCad and EDIF importers).
 *
 *   importedToDesign(netlist, opts) -> { design, notes, stats }
 *
 * An ImportedNetlist lists components (reference, source symbol name, value, pin → net, optional
 * position and the source's SPICE hints) and the net names. Each component is mapped to a library
 * part when MachSim has one that matches:
 *   R C L (polarised capacitors → electrolytic), diodes / LEDs / Zeners, NPN / PNP, N / P MOSFETs,
 *   N / P JFETs, DC / sine / pulse voltage and current sources, batteries, op-amps whose value names
 *   a library op-amp; a value that names a library part ("2N3904", "1N4148", "LM741") picks that
 *   part. Ground symbols / nets (GND, GNDA, GNDD, GNDREF, Earth, 0) are ground; power symbols name
 *   global nets, and a power net no source drives gets a DC source to ground of the voltage in its
 *   name ("+5V" → 5 V, "-12V" → −12 V, "+3V3" → 3.3 V, VCC → 5 V), noted for the learner.
 * Anything else becomes a generic block (a user component drawn as a box with the source pin
 * names and no model) with a note, so the drawing is complete and the learner sees what is missing.
 * Placement keeps the source positions when every component has one (orientation chosen so the
 * MachSim pins fall closest to the source pins), otherwise the SPICE-import placement is used;
 * nets are routed by the SPICE-import router (src/model/spiceSchematic.ts placeAndRoute).
 */
import { getPart, listParts } from '../library';
import type { CustomPartData } from '../library/custom/types';
import { customPartDef } from '../library/custom/partDef';
import type { PartDef } from '../library/types';
import { parseUserNumber, toSpiceNumber } from '../util/units';
import { localToSheet } from './geometry';
import { blockSymbol, placeAndRoute, type ImportNote, type SchematicItem } from './spiceSchematic';
import type { Design, PartInstance, Rotation } from './types';
import { newDesign, newSheet } from './types';
import { sanitizeDesign, type SanitizeNote } from './sanitize';

export interface ImportedPin {
  /** pin number as written in the source ("1", "2", "B") */
  number: string;
  /** pin name when the source has one ("A", "K", "B", "~") */
  name?: string;
  /** net name ('0' for ground) */
  net: string;
}

export interface ImportedComponent {
  refdes: string;
  /** source symbol / cell name, e.g. "Device:R", "Device:Q_NPN_BCE", "RES" */
  symbol: string;
  value?: string;
  pins: ImportedPin[];
  /** source position in MachSim sheet units, with the source pin positions (orientation fit) */
  at?: { x: number; y: number; pins: Record<string, { x: number; y: number }> };
  /** other source fields (footprint, SPICE fields such as Sim.Params / Sim.Device) */
  fields?: Record<string, string>;
}

export interface ImportedNetlist {
  title: string;
  /** 'kicad' | 'edif' (notes, provenance) */
  source: string;
  fileName?: string;
  components: ImportedComponent[];
  /** nets named in the source (labels, power symbols): kept as net labels */
  namedNets: string[];
  /** power symbol nets with their source names ("+5V", "VCC") */
  powerNets: string[];
  /** diode pin numbering when the pins have no names: KiCad 1 = K, 2 = A; others 1 = A, 2 = K */
  diodeNumbering: 'KA' | 'AK';
  warnings: string[];
  /** symbols the source had not annotated yet, which MachSim numbered itself */
  unannotated?: number;
}

export type SchematicImportNote =
  | ImportNote
  | { kind: 'generic'; refdes: string; symbol: string }
  | { kind: 'supply'; net: string; volts: number }
  | { kind: 'defaultValue'; refdes: string; value: string }
  | { kind: 'unannotated'; count: number }
  | { kind: 'warning'; what: string };

export interface SchematicImportResult {
  design: Design;
  notes: SchematicImportNote[];
  stats: { parts: number; generic: number; wires: number; labels: number; nets: number };
}

const GROUND_NAMES = /^(0|gnd|gnda|gndd|gndref|gnd_?\w*|agnd|dgnd|pgnd|earth|chassis|vss_?gnd)$/i;

/** True for net names that mean ground. */
export function isGroundName(name: string): boolean {
  return GROUND_NAMES.test(name.trim());
}

/** Supply voltage a power-net name stands for: "+5V" 5, "-12V" -12, "+3V3" 3.3, "VCC" 5; null if none. */
export function powerNetVolts(name: string): number | null {
  const n = name.trim().toUpperCase();
  const m = /^([+-]?)(\d+)(?:V(\d+)|(?:[.,](\d+))?V?)$/.exec(n);
  if (m) {
    const v = Number(`${m[2]}.${m[3] ?? m[4] ?? '0'}`);
    return m[1] === '-' ? -v : v;
  }
  if (/^(VCC|VDD|V\+|VPP)$/.test(n)) return 5;
  if (/^(VEE|V-|VNN)$/.test(n)) return -5;
  return null;
}

let nameIndex: Map<string, PartDef[]> | null = null;

/** Library parts by lower-case name ("2n3904" → [transistors/2n3904]). */
function partsNamed(name: string): PartDef[] {
  if (!nameIndex) {
    nameIndex = new Map();
    for (const d of listParts()) {
      const k = d.name.toLowerCase();
      if (!nameIndex.has(k)) nameIndex.set(k, []);
      nameIndex.get(k)!.push(d);
    }
  }
  return nameIndex.get(name.trim().toLowerCase()) ?? [];
}

/**
 * A user-number text for a component value ("10k", "4k7", "100nF", "1Meg"); null when it is not a
 * number.
 *
 * A hand-typed KiCad / EDIF value often puts a space between the number and its unit ("4.7 k",
 * "10 kΩ", "100 nF"). Reading only the first whitespace-separated token turned "4.7 k" into 4.7 Ω
 * and "100 nF" into 100 F, silently — so the number and the suffix that follows it are joined
 * first, and only what comes after them (a tolerance, a rating, "5%") is dropped.
 */
function valueText(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  // number, optional space, suffix / unit (a trailing digit group keeps the "4k7" spelling working)
  const m = /^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?)\s*([A-Za-zΩµμ]*\d*)/.exec(t);
  const first = (m ? m[1] + m[2] : t.split(/\s+/)[0]).replace(/meg/i, 'M').replace(/(Ω|ohms?|F|H|V|A)$/i, '');
  const n = parseUserNumber(first);
  if (!Number.isFinite(n)) return null;
  const s = toSpiceNumber(n).replace(/meg$/i, 'M');
  return Number.isFinite(parseUserNumber(s)) && Math.abs(parseUserNumber(s) - n) <= Math.abs(n) * 1e-12 ? s : String(n);
}

const symName = (c: ImportedComponent) => c.symbol.split(':').pop()!.toLowerCase();
const prefix = (c: ImportedComponent) => (/^[A-Za-z]+/.exec(c.refdes)?.[0] ?? '').toUpperCase();

/** Pin of `c` whose name (or number) is one of `keys`. */
function pinBy(c: ImportedComponent, ...keys: string[]): ImportedPin | undefined {
  const want = keys.map((k) => k.toLowerCase());
  return c.pins.find((p) => p.name && want.includes(p.name.toLowerCase())) ?? c.pins.find((p) => want.includes(p.number.toLowerCase()));
}

function byNumber(c: ImportedComponent): ImportedPin[] {
  return [...c.pins].sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number));
}

interface Mapped {
  partId: string;
  params: Record<string, string>;
  /** MachSim pin → source pin */
  pins: [string, ImportedPin][];
  source?: boolean;
}

/** SPICE source description of a component: value text or Sim.* / Spice_* fields. */
function sourceSpec(c: ImportedComponent): { kind: 'dc' | 'sin' | 'pulse'; args: number[]; params: Record<string, number> } | null {
  const fields = c.fields ?? {};
  const simParams = fields['Sim.Params'] ?? fields['Sim_Params'] ?? '';
  const simType = (fields['Sim.Type'] ?? '').toLowerCase();
  const text = (fields['Spice_Model'] ?? c.value ?? '').trim();
  const kv: Record<string, number> = {};
  for (const m of simParams.matchAll(/(\w+)\s*=\s*"?([^\s"]+)"?/g)) {
    const n = parseUserNumber(m[2].replace(/meg/i, 'M'));
    if (Number.isFinite(n)) kv[m[1].toLowerCase()] = n;
  }
  const sym = symName(c);
  if (Object.keys(kv).length) {
    if (simType === 'sin' || sym.includes('sin')) return { kind: 'sin', args: [], params: kv };
    if (simType === 'pulse' || sym.includes('pulse')) return { kind: 'pulse', args: [], params: kv };
    return { kind: 'dc', args: [kv.dc ?? 0], params: kv };
  }
  const call = /^(dc\s+)?(sin|pulse)?\s*\(?([^)]*)\)?/i.exec(text);
  const kind = call?.[2]?.toLowerCase();
  const nums = (call?.[3] ?? text)
    .replace(/^dc\s+/i, '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => parseUserNumber(t.replace(/meg/i, 'M').replace(/V$/i, '')));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (kind === 'sin') return { kind: 'sin', args: nums, params: {} };
  if (kind === 'pulse') return { kind: 'pulse', args: nums, params: {} };
  return nums.length ? { kind: 'dc', args: nums, params: {} } : null;
}

const num = (v: number) => {
  const s = toSpiceNumber(v).replace(/meg$/i, 'M');
  return Math.abs(parseUserNumber(s) - v) <= Math.abs(v) * 1e-12 ? s : String(v);
};

/** The library part for a component, or null (generic block). */
function mapComponent(c: ImportedComponent, diode: 'KA' | 'AK', notes: SchematicImportNote[]): Mapped | null {
  const sym = symName(c);
  const pre = prefix(c);
  const two = byNumber(c);
  // a value that names a library part with the same pin names wins
  const named = c.value ? partsNamed(c.value) : [];
  for (const def of named) {
    const names = def.symbol.pins.map((p) => p.name);
    const pins: [string, ImportedPin][] = [];
    for (const n of names) {
      const p = pinBy(c, n);
      if (p) pins.push([n, p]);
    }
    if (pins.length === names.length && names.length === c.pins.length) return { partId: def.id, params: {}, pins };
  }
  const isR = /^(r|r_small|r_us|resistor|res|r_\w+)$/.test(sym) || (pre === 'R' && c.pins.length === 2 && !/pot/.test(sym));
  const isC = /^(c|c_small|cap|capacitor|c_\w+|cp|cp_\w+)$/.test(sym) || (pre === 'C' && c.pins.length === 2);
  const isL = /^(l|l_small|ind|inductor|l_\w+)$/.test(sym) || (pre === 'L' && c.pins.length === 2);
  if ((isR || isC || isL) && c.pins.length === 2) {
    const polar = isC && (/^cp|polar|elec/.test(sym) || c.pins.some((p) => p.name === '+'));
    let v = valueText(c.value);
    const fallback = isR ? '1k' : isC ? '1u' : '1m';
    if (!v) {
      v = fallback;
      notes.push({ kind: 'defaultValue', refdes: c.refdes, value: fallback });
    }
    if (polar) {
      const plus = pinBy(c, '+') ?? two[0];
      const minus = c.pins.find((p) => p !== plus)!;
      return { partId: 'basic/electrolytic', params: { value: v }, pins: [['+', plus], ['-', minus]] };
    }
    return { partId: isR ? 'basic/resistor' : isC ? 'basic/capacitor' : 'basic/inductor', params: { value: v }, pins: [['1', two[0]], ['2', two[1]]] };
  }
  if ((pre === 'D' || /^(d|d_\w+|led|led_\w+|diode|zener)/.test(sym)) && c.pins.length === 2) {
    const a = pinBy(c, 'a', 'anode', '+') ?? (diode === 'KA' ? two[1] : two[0]);
    const k = c.pins.find((p) => p !== a)!;
    const led = /led/.test(sym);
    const zener = /zener/.test(sym) || /^z/.test(sym);
    let partId = led ? 'diodes/led-red' : zener ? 'diodes/zener' : 'diodes/1n4148';
    const params: Record<string, string> = {};
    if (zener) {
      const vz = parseUserNumber((c.value ?? '').replace(/^.*?(\d+[.,v]?\d*)\s*v?$/i, '$1').replace(/v/i, '.'));
      if (Number.isFinite(vz) && vz > 0.5 && vz < 300) params.vz = num(vz);
    }
    if (!led && !zener && !named.length) partId = 'diodes/1n4148';
    return { partId, params, pins: [['A', a], ['K', k]] };
  }
  const bjt = /^q_(npn|pnp)/.exec(sym) ?? (/^(npn|pnp)$/.exec(sym) as RegExpExecArray | null);
  if (bjt && c.pins.length === 3) {
    const order = /_(bce|bec|cbe|ceb|ebc|ecb)/.exec(sym)?.[1];
    const pick = (n: string) => pinBy(c, n) ?? (order ? two[order.indexOf(n.toLowerCase())] : undefined);
    const C = pick('C');
    const B = pick('B');
    const E = pick('E');
    if (C && B && E) return { partId: bjt[1] === 'npn' ? 'transistors/2n3904' : 'transistors/2n3906', params: {}, pins: [['C', C], ['B', B], ['E', E]] };
  }
  const mos = /^q_([np])mos/.exec(sym) ?? (/^([np])mos$/.exec(sym) as RegExpExecArray | null);
  if (mos && (c.pins.length === 3 || c.pins.length === 4)) {
    const order = /_(gds|gsd|dgs|dsg|sgd|sdg)/.exec(sym)?.[1];
    const pick = (n: string) => pinBy(c, n) ?? (order ? two[order.indexOf(n.toLowerCase())] : undefined);
    const D = pick('D');
    const G = pick('G');
    const S = pick('S');
    const B = c.pins.length === 4 ? pinBy(c, 'B') : undefined;
    if (D && G && S && (c.pins.length === 3 || B)) {
      const n = mos[1] === 'n';
      if (B) return { partId: n ? 'transistors/nmos-4t' : 'transistors/pmos-4t', params: {}, pins: [['D', D], ['G', G], ['S', S], ['B', B]] };
      return { partId: n ? 'transistors/nmos' : 'transistors/pmos', params: {}, pins: [['D', D], ['G', G], ['S', S]] };
    }
  }
  const jfet = /^q_([np])jfet/.exec(sym) ?? (/^([np])jf(et)?$/.exec(sym) as RegExpExecArray | null);
  if (jfet && c.pins.length === 3) {
    const order = /_(dsg|dgs|gds|gsd|sdg|sgd)/.exec(sym)?.[1];
    const pick = (n: string) => pinBy(c, n) ?? (order ? two[order.indexOf(n.toLowerCase())] : undefined);
    const D = pick('D');
    const G = pick('G');
    const S = pick('S');
    if (D && G && S) return { partId: jfet[1] === 'n' ? 'transistors/njfet' : 'transistors/pjfet', params: {}, pins: [['D', D], ['G', G], ['S', S]] };
  }
  const vsrc = /^(v|vdc|vsin|vpulse|vsource|vsrc|v_\w+|battery|battery_cell)$/.test(sym) || (pre === 'V' && c.pins.length === 2);
  const isrc = /^(i|idc|isin|ipulse|isource|isrc|i_\w+)$/.test(sym) || (pre === 'I' && c.pins.length === 2);
  if ((vsrc || isrc) && c.pins.length === 2) {
    const plus = pinBy(c, '+', 'p', 'pos') ?? two[0];
    const minus = c.pins.find((p) => p !== plus)!;
    // library current sources push their current out of the + pin: SPICE n+ is their − pin
    const pins: [string, ImportedPin][] = vsrc ? [['+', plus], ['-', minus]] : [['-', plus], ['+', minus]];
    const kind = vsrc ? 'voltage' : 'current';
    const spec = sourceSpec(c);
    if (!spec) {
      notes.push({ kind: 'defaultValue', refdes: c.refdes, value: vsrc ? '5' : '1m' });
      return { partId: `sources/dc-${kind}`, params: { value: vsrc ? '5' : '1m' }, pins, source: true };
    }
    if (spec.kind === 'sin') {
      const a = spec.args;
      const p = spec.params;
      return { partId: `sources/ac-${kind}`, params: { offset: num(a[0] ?? p.dc ?? p.vo ?? 0), amplitude: num(a[1] ?? p.ampl ?? p.va ?? 1), freq: num(a[2] ?? p.f ?? p.freq ?? 1000), acmag: '0' }, pins, source: true };
    }
    if (spec.kind === 'pulse') {
      const a = spec.args;
      const p = spec.params;
      const v = (i: number, k: string, d: number) => num(a[i] ?? p[k] ?? d);
      return {
        partId: `sources/pulse-${kind}`,
        params: { v1: v(0, 'y1', 0), v2: v(1, 'y2', 5), delay: v(2, 'td', 0), rise: v(3, 'tr', 1e-9), fall: v(4, 'tf', 1e-9), width: v(5, 'tw', 5e-4), period: v(6, 'per', 1e-3) },
        pins,
        source: true,
      };
    }
    return { partId: `sources/dc-${kind}`, params: { value: num(spec.args[spec.args.length - 1] ?? 0) }, pins, source: true };
  }
  // op-amps named by value with the usual pin names
  if (c.pins.length === 5 && named.length === 0 && /opamp|op_amp|lm741|tl07|lm358/.test(sym + (c.value ?? '').toLowerCase())) {
    const lib = partsNamed(c.value ?? '')[0] ?? getPart('analog/opamp');
    const inm = pinBy(c, '-', 'in-', 'inm');
    const inp = pinBy(c, '+', 'in+', 'inp');
    const vp = pinBy(c, 'v+', 'vcc', 'vs+');
    const vn = pinBy(c, 'v-', 'vee', 'vs-');
    const out = c.pins.find((p) => p !== inm && p !== inp && p !== vp && p !== vn);
    if (lib && inm && inp && vp && vn && out) return { partId: lib.id, params: {}, pins: [['IN-', inm], ['IN+', inp], ['OUT', out], ['V+', vp], ['V-', vn]] };
  }
  return null;
}

/** Orientation of `def` at `origin` whose pins fall closest to the source pin positions. */
function bestOrientation(def: PartDef, origin: { x: number; y: number }, pins: [string, { x: number; y: number } | undefined][]): { rotation: Rotation; mirror: boolean } {
  let best = { rotation: 0 as Rotation, mirror: false };
  let bestErr = Infinity;
  for (const mirror of [false, true]) {
    for (const rotation of [0, 90, 180, 270] as Rotation[]) {
      const inst = { x: origin.x, y: origin.y, rotation, mirror } as PartInstance;
      let err = 0;
      for (const [pin, target] of pins) {
        if (!target) continue;
        const p = def.symbol.pins.find((q) => q.name === pin);
        if (!p) continue;
        const at = localToSheet({ x: p.x, y: p.y }, inst);
        err += (at.x - target.x) ** 2 + (at.y - target.y) ** 2;
      }
      // prefer no mirror when equal
      if (err < bestErr - 1e-6) {
        bestErr = err;
        best = { rotation, mirror };
      }
    }
  }
  return best;
}

const cleanNet = (n: string) => n.replace(/^\//, '').replace(/[^A-Za-z0-9_+\-.]/g, '_') || 'N';

/** Build a MachSim design from an imported netlist (see the module comment). */
export function importedToDesign(imp: ImportedNetlist, opts: { title?: string; sheetName?: string } = {}): SchematicImportResult {
  const notes: SchematicImportNote[] = imp.warnings.map((w) => ({ kind: 'warning' as const, what: w }));
  if (imp.unannotated) notes.push({ kind: 'unannotated', count: imp.unannotated });
  // ---- net names: ground → '0'; named nets keep a clean name; automatic ones N1, N2 …
  const named = new Set(imp.namedNets);
  const netMap = new Map<string, string>();
  const used = new Set<string>(['0']);
  const unnamed = new Set<string>();
  let auto = 0;
  const allNets = [...new Set(imp.components.flatMap((c) => c.pins.map((p) => p.net)))];
  for (const n of allNets) {
    if (isGroundName(n)) {
      netMap.set(n, '0');
      continue;
    }
    if (named.has(n)) {
      let name = cleanNet(n);
      for (let k = 2; used.has(name.toLowerCase()); k++) name = `${cleanNet(n)}_${k}`;
      used.add(name.toLowerCase());
      netMap.set(n, name);
    }
  }
  for (const n of allNets) {
    if (netMap.has(n)) continue;
    let name: string;
    do name = `N${++auto}`;
    while (used.has(name.toLowerCase()));
    used.add(name.toLowerCase());
    netMap.set(n, name);
    unnamed.add(name);
  }
  const net = (n: string) => netMap.get(n) ?? '0';

  // ---- components
  const items: SchematicItem[] = [];
  const customParts: CustomPartData[] = [];
  const refs = new Set<string>();
  const uniqueRef = (r: string) => {
    let ref = r.replace(/[^A-Za-z0-9_]/g, '_') || 'U';
    if (!/^[A-Za-z]/.test(ref)) ref = `U${ref}`;
    const base = ref;
    for (let k = 2; refs.has(ref.toUpperCase()); k++) ref = `${base}_${k}`;
    refs.add(ref.toUpperCase());
    return ref;
  };
  const withAt = imp.components.length > 0 && imp.components.every((c) => c.at);
  let generic = 0;
  for (const c of imp.components) {
    const refdes = uniqueRef(c.refdes);
    const m = mapComponent(c, imp.diodeNumbering, notes);
    let def: PartDef | undefined;
    let pinNets: { pin: string; node: string }[];
    let partId: string;
    let params: Record<string, string> = {};
    let srcPins: [string, ImportedPin][];
    if (m && (def = getPart(m.partId))) {
      partId = m.partId;
      params = m.params;
      srcPins = m.pins;
      pinNets = m.pins.map(([pin, p]) => ({ pin, node: net(p.net) }));
    } else {
      generic++;
      const pinNames: string[] = [];
      srcPins = [];
      for (const p of byNumber(c)) {
        let label = p.name && p.name !== '~' ? p.name : p.number;
        for (let k = 2; pinNames.includes(label); k++) label = `${p.name && p.name !== '~' ? p.name : p.number}_${k}`;
        pinNames.push(label);
        srcPins.push([label, p]);
      }
      const slug = `${imp.source}-${c.symbol}-${pinNames.length}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id = `custom:import-${slug}`;
      let data = customParts.find((x) => x.id === id);
      if (!data) {
        data = {
          id,
          name: c.symbol.split(':').pop() || c.symbol,
          group: 'misc',
          family: 'Imported block',
          description: `${c.symbol}${c.value ? ` (${c.value})` : ''} from ${imp.fileName ?? imp.source}: no MachSim model, drawn only`,
          prefix: (/^[A-Za-z]+/.exec(c.refdes)?.[0] ?? 'U').toUpperCase(),
          symbol: blockSymbol(pinNames.length ? pinNames : ['1'], c.symbol.split(':').pop() || c.symbol),
          model: { kind: 'none' },
          provenance: `${imp.source} schematic${imp.fileName ? ` ${imp.fileName}` : ''}`,
        };
        customParts.push(data);
      }
      def = customPartDef(data);
      partId = id;
      pinNets = srcPins.map(([pin, p]) => ({ pin, node: net(p.net) }));
      notes.push({ kind: 'generic', refdes, symbol: c.symbol });
      if (c.value) params = {};
    }
    const item: SchematicItem = { refdes, partId, def, params, pins: pinNets, source: !!m?.source };
    if (withAt && c.at) {
      const o = bestOrientation(def, c.at, srcPins.map(([pin, p]) => [pin, c.at!.pins[p.number]]));
      item.at = { x: c.at.x, y: c.at.y, ...o };
    }
    items.push(item);
  }

  // ---- power nets no source drives get a DC source to ground
  const driven = new Set(items.filter((it) => it.source).flatMap((it) => it.pins.map((p) => p.node)));
  const powerNames = [...new Set(imp.powerNets.map((n) => net(n)))];
  const supplyDef = getPart('sources/dc-voltage')!;
  const left = Math.min(0, ...items.map((it) => it.at?.x ?? 0)) - 120;
  const top = Math.min(0, ...items.map((it) => it.at?.y ?? 0));
  let supplyCount = 0;
  for (const n of powerNames) {
    if (n === '0' || driven.has(n)) continue;
    const src = imp.powerNets.find((p) => net(p) === n) ?? n;
    const volts = powerNetVolts(src);
    if (volts === null) continue;
    notes.push({ kind: 'supply', net: n, volts });
    let k = 1;
    while (refs.has(`V${k}`)) k++;
    const item: SchematicItem = { refdes: uniqueRef(`V${k}`), partId: supplyDef.id, def: supplyDef, params: { value: num(volts) }, pins: [{ pin: '+', node: n }, { pin: '-', node: '0' }], source: true };
    if (withAt) item.at = { x: left, y: top + 100 * supplyCount, rotation: 0, mirror: false };
    supplyCount++;
    items.push(item);
  }

  const routeNotes: ImportNote[] = [];
  const layout = placeAndRoute(items, routeNotes, { unnamed });
  notes.push(...routeNotes);
  const design = newDesign(opts.title || imp.title || imp.fileName || imp.source);
  const sheet = newSheet('sheet1', opts.sheetName ?? 'Sheet 1');
  sheet.parts = layout.parts;
  sheet.wires = layout.wires;
  sheet.labels = layout.labels;
  design.sheets = [sheet];
  if (customParts.length) design.customParts = customParts;
  design.analysis = { active: 'op', specs: { op: { type: 'op' }, tran: { type: 'tran', tstep: 1e-5, tstop: 1e-2 }, ac: { type: 'ac', sweep: 'dec', points: 20, fstart: 1, fstop: 1e8 } } };
  // the shared integrity layer has the last word: the imported design must save and reopen
  const safe = sanitizeDesign(design);
  for (const n of safe.notes) notes.push({ kind: 'warning', what: sanitizeNoteLine(n) });
  return {
    design: safe.design,
    notes,
    stats: { parts: items.length, generic, wires: layout.wires.length, labels: layout.labels.length, nets: allNets.length },
  };
}

/** A sanitize note as one technical line for the import-notes box (the UI localises the box). */
function sanitizeNoteLine(n: SanitizeNote): string {
  return `${n.code}: ${n.names.join(', ')}${n.count > n.names.length ? ` (+${n.count - n.names.length})` : ''}`;
}
