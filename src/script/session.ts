/**
 * The scripting API (host side): one design being built or edited, and the answers to every
 * `MachSim.<method>()` call a sandboxed script makes (see protocol.ts for the method list and
 * workerProgram.ts for what the script sees). No UI and no browser API: the file system, the
 * simulator and the editor come in through `ScriptIO`, so the same session runs in the Scripts
 * window (the user confirms every open / save), in `MachSim.exe --script` (only the files named on
 * the command line) and in tests (in-memory files, the in-process engine).
 *
 *   const session = new ScriptSession(io);
 *   const info = await session.call('place', ['basic/resistor', 100, 100, { value: '1k' }]);
 *
 * A session works on its OWN copy of a design: `currentDesign()` copies the open document, and
 * nothing reaches the editor until the script calls `showDesign()` (which opens the result as a
 * new document). Coordinates are schematic units on a 10-unit grid; a part's pins are where its
 * symbol puts them (`pin('R1.1')` tells), and wires run orthogonally between two points.
 */
import { getPart, defaultParams, ensurePartsLoaded, loadAllGroups, searchParts } from '../library';
import type { PartDef } from '../library/types';
import { localToSheet } from '../model/geometry';
import { resolvePart } from '../model/hierarchy';
import { buildNetlist } from '../model/netlister';
import { effectivePrefix } from '../model/refdesRules';
import { parseDesignSafely } from '../model/sanitize';
import { parseDesign, serializeDesign } from '../model/serialize';
import { applySteps } from '../model/steps';
import { ensureDesignParts } from '../model/libraryLoad';
import { newDesign, type Design, type PartInstance, type Point, type Rotation, type Sheet } from '../model/types';
import type { AnalysisSpec, AnalysisType, Netlist } from '../sim/netlist';
import type { AnalysisResult, Vector } from '../sim/results';
import { parseSpice, writeSpice } from '../sim/spice';
import { defaultSpec } from '../ui/analysis/specs';
import { specContext } from '../ui/integration/circuitInfo';
import { collectRefdes, nextRefdes } from '../ui/store/refdes';
import { newId } from '../ui/store/ids';
import { isInternalVector } from '../ui/results/titles';
import { parseSpiceNumber } from '../util/units';
import { sx } from '../i18n/scriptText';
import { SCRIPT_LIMITS, type ScriptPlot, type ScriptPointRef, type ScriptResult, type ScriptVector } from './protocol';
import { plotToSvg } from './plotSvg';
import type { ScriptHost } from './runner';

export interface ScriptFileRequest {
  /** what the script asks for: a design (.msim), plain text, CSV or an SVG picture */
  kind: 'design' | 'text' | 'csv' | 'svg';
  /** the name the script gave (may be empty for open) */
  name: string;
}

/** What the environment provides to a session. Everything that touches the outside world is here. */
export interface ScriptIO {
  /** Let the user (or the command-line policy) choose a design file to open; null = declined. */
  openFile(request: ScriptFileRequest): Promise<{ name: string; text: string } | null>;
  /** Save a file after the user's (or the command-line policy's) approval; returns the name written, null = declined. */
  saveFile(request: ScriptFileRequest & { text: string }): Promise<string | null>;
  /** Run the analyses of a netlist (in a worker, or in-process). */
  runNetlist(netlist: Netlist): Promise<AnalysisResult[]> | AnalysisResult[];
  /** The design open in the editor (a copy is taken), when there is an editor. */
  currentDesign?(): Design | undefined;
  /** Open a design as a new document in the editor. */
  showDesign?(design: Design, name: string): Promise<void> | void;
  /** A plot the script made (the Scripts window shows it). */
  onPlot?(plot: ScriptPlot, svg: string): void;
}

const NUMERIC_KEYS = new Set(['tstep', 'tstop', 'tstart', 'tmax', 'fstart', 'fstop', 'start', 'stop', 'step', 'freq', 'points', 'fundamental', 'harmonics', 'rsource', 'runs', 'seed', 'samples', 'settleCycles', 'f2overf1']);
const LIST_KEYS = new Set(['values', 'list', 'temps']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A number or a SPICE/engineering number text ("4.7k", "10u"); throws a localized error otherwise. */
export function scriptNumber(v: unknown, what: string): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseSpiceNumber(v.trim().replace(',', '.'));
    if (Number.isFinite(n)) return n;
    // "Infinity" etc. travel as text through the worker boundary
    const f = Number(v);
    if (Number.isFinite(f)) return f;
  }
  throw new Error(sx('badNumber', { what, value: String(v) }));
}

/** An analysis result as plain data. */
export function toScriptResult(r: AnalysisResult): ScriptResult {
  const vec = (v: Vector): ScriptVector => ({ name: v.name, unit: v.unit, values: Array.from(v.re), ...(v.im ? { imag: Array.from(v.im) } : {}) });
  return {
    type: r.type,
    title: r.title,
    ...(r.error ? { error: r.error } : {}),
    warnings: [...r.warnings],
    ...(r.scale ? { scale: vec(r.scale) } : {}),
    vectors: r.vectors.filter((v) => v !== r.scale && !isInternalVector(v.name)).map(vec),
    scalars: { ...(r.scalars ?? {}) },
    measurements: (r.measurements ?? []).map((m) => ({ name: m.name, value: Number.isFinite(m.value) ? m.value : null, ...(m.at !== undefined ? { at: m.at } : {}), ...(m.error ? { error: m.error } : {}) })),
    ...(r.table ? { table: { columns: [...r.table.columns], rows: r.table.rows.map((row) => [...row]) } } : {}),
    ...(r.runs ? { runs: r.runs.map((u) => ({ label: u.label, result: toScriptResult(u.result) })) } : {}),
  };
}

/** Analysis options of a script (`{ tstop: '10m' }`) merged into a spec; numbers may be SPICE texts. */
export function applyScriptOptions(spec: AnalysisSpec, opts: Record<string, unknown>): AnalysisSpec {
  const out: Record<string, unknown> = { ...spec };
  for (const [key, value] of Object.entries(opts)) {
    if (key === 'type' || key === 'throwOnError') continue;
    if (NUMERIC_KEYS.has(key) && (typeof value === 'string' || typeof value === 'number')) out[key] = scriptNumber(value, key);
    else if (LIST_KEYS.has(key) && Array.isArray(value)) out[key] = value.map((x) => scriptNumber(x, key));
    else out[key] = value;
  }
  return out as unknown as AnalysisSpec;
}

const ROTATIONS: readonly number[] = [0, 90, 180, 270];

export class ScriptSession implements ScriptHost {
  design: Design = newDesign('Script');
  fileName = 'script.msim';
  /** the plots the script made, in order */
  readonly plots: { plot: ScriptPlot; svg: string }[] = [];

  constructor(private readonly io: ScriptIO) {}

  async call(method: string, args: unknown[]): Promise<unknown> {
    // only the API's own methods: never an inherited property such as constructor or toString
    const fn = Object.prototype.hasOwnProperty.call(this.methods, method) ? (this.methods as Record<string, ((...a: never[]) => unknown) | undefined>)[method] : undefined;
    if (!fn) throw new Error(sx('unknownMethod', { name: method }));
    return fn.apply(this.methods, args as never[]);
  }

  // ---------------------------------------------------------------------------------------------
  // helpers

  private sheetByRef(ref?: unknown): Sheet {
    const sheets = this.design.sheets;
    if (ref === undefined || ref === null) return sheets[0];
    if (typeof ref === 'number') {
      const s = sheets[ref - 1];
      if (!s) throw new Error(sx('noSheet', { sheet: String(ref) }));
      return s;
    }
    const s = sheets.find((x) => x.name.toLowerCase() === String(ref).toLowerCase() || x.id === ref);
    if (!s) throw new Error(sx('noSheet', { sheet: String(ref) }));
    return s;
  }

  private findPart(refdes: string): { part: PartInstance; sheet: Sheet } {
    const key = String(refdes).toUpperCase();
    for (const sheet of this.design.sheets) {
      const part = sheet.parts.find((p) => p.refdes.toUpperCase() === key);
      if (part) return { part, sheet };
    }
    throw new Error(sx('noPart', { refdes: String(refdes) }));
  }

  private def(part: PartInstance): PartDef {
    const d = resolvePart(this.design, part.partId, getPart);
    if (!d) throw new Error(sx('unknownPart', { id: part.partId }));
    return d;
  }

  /** Library part for an id or a short name ("resistor", "dc-voltage"), loading its catalogue pack. */
  private async partDef(idOrName: string): Promise<PartDef> {
    const id = String(idOrName).trim();
    const load = async (x: string) => {
      if (!getPart(x)) await ensurePartsLoaded([x]);
      return getPart(x);
    };
    let d = await load(id);
    if (d) return d;
    for (const group of ['basic', 'sources', 'indicators', 'instruments', 'power', 'diodes', 'transistors']) {
      d = await load(`${group}/${id}`);
      if (d) return d;
    }
    await loadAllGroups();
    const hits = searchParts(id);
    const key = id.toLowerCase();
    const exact = hits.filter((h) => h.id.toLowerCase().endsWith(`/${key}`) || h.name.toLowerCase() === key);
    if (exact.length === 1) return exact[0];
    const list = (exact.length ? exact : hits).slice(0, 5).map((h) => h.id);
    throw new Error(list.length ? sx('partSuggest', { id, list: list.join(', ') }) : sx('unknownPart', { id }));
  }

  private pinOf(part: PartInstance, pinRef: string): Point {
    const def = this.def(part);
    const key = pinRef.toLowerCase();
    const pin = def.symbol.pins.find((p) => p.name.toLowerCase() === key) ?? def.symbol.pins.find((p) => p.number !== undefined && p.number.toLowerCase() === key);
    if (!pin) throw new Error(sx('noPin', { refdes: part.refdes, pin: pinRef, list: def.symbol.pins.map((p) => p.name).join(', ') }));
    return localToSheet({ x: pin.x, y: pin.y }, part);
  }

  /** A point on a sheet: "R1.2" (refdes.pin) or {x, y}. */
  private resolvePoint(ref: ScriptPointRef): { point: Point; sheet?: Sheet } {
    if (isRecord(ref)) {
      return { point: { x: scriptNumber(ref.x, 'x'), y: scriptNumber(ref.y, 'y') } };
    }
    const text = String(ref);
    const dot = text.indexOf('.');
    if (dot <= 0) throw new Error(sx('badPinRef', { ref: text }));
    const { part, sheet } = this.findPart(text.slice(0, dot));
    return { point: this.pinOf(part, text.slice(dot + 1)), sheet };
  }

  private addWire(sheet: Sheet, points: Point[]): string {
    const id = newId('w');
    sheet.wires.push({ id, points: points.map((p) => ({ x: p.x, y: p.y })) });
    return id;
  }

  private partInfo(part: PartInstance): Record<string, unknown> {
    const def = this.def(part);
    const pins: Record<string, Point> = {};
    for (const p of def.symbol.pins) pins[p.name] = this.pinOf(part, p.name);
    return { refdes: part.refdes, partId: part.partId, x: part.x, y: part.y, rotation: part.rotation, value: part.params.value ?? defaultParams(def).value ?? null, pins };
  }

  private async buildWithChecks(): Promise<ReturnType<typeof buildNetlist>> {
    await ensureDesignParts(this.design);
    const build = buildNetlist(this.design, { includeAnalysis: false });
    return build;
  }

  // ---------------------------------------------------------------------------------------------
  // the API

  private readonly methods = {
    // ---- designs -------------------------------------------------------------------------------
    newDesign: async (title?: string) => {
      this.design = newDesign(typeof title === 'string' && title ? title : 'Script');
      this.fileName = `${this.design.title.replace(/[^\w.-]+/g, '_') || 'script'}.msim`;
      return { title: this.design.title };
    },

    currentDesign: async () => {
      const d = this.io.currentDesign?.();
      if (!d) throw new Error(sx('noEditor'));
      this.design = parseDesign(serializeDesign(d));
      await ensureDesignParts(this.design);
      return this.methods.designInfo();
    },

    openDesign: async (name?: string) => {
      const file = await this.io.openFile({ kind: 'design', name: typeof name === 'string' ? name : '' });
      if (!file) throw new Error(sx('declined', { what: sx('whatOpen') }));
      const parsed = parseDesignSafely(file.text);
      this.design = parsed.design;
      this.fileName = file.name;
      await ensureDesignParts(this.design);
      return this.methods.designInfo();
    },

    saveDesign: async (name?: string) => {
      const wanted = typeof name === 'string' && name ? name : this.fileName;
      const saved = await this.io.saveFile({ kind: 'design', name: wanted, text: serializeDesign(this.design) });
      if (saved === null) throw new Error(sx('declined', { what: sx('whatSave') }));
      this.fileName = saved;
      return saved;
    },

    showDesign: async () => {
      if (!this.io.showDesign) throw new Error(sx('noEditor'));
      // the editor gets its own copy, so later script calls do not change the open document
      await this.io.showDesign(parseDesign(serializeDesign(this.design)), this.fileName);
      return true;
    },

    designInfo: async () => {
      const parts = this.design.sheets.flatMap((s) => s.parts.map((p) => ({ refdes: p.refdes, partId: p.partId, value: p.params.value ?? null, sheet: s.name, x: p.x, y: p.y })));
      return { title: this.design.title, sheets: this.design.sheets.map((s) => s.name), parts, variables: { ...this.design.variables }, analysis: this.design.analysis.active };
    },

    // ---- library -------------------------------------------------------------------------------
    searchParts: async (query: string, limit?: number) => {
      await loadAllGroups();
      const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 200) : 20;
      return searchParts(String(query)).slice(0, n).map((d) => ({ id: d.id, name: d.name, group: d.group, family: d.family, prefix: d.prefix, description: d.description }));
    },

    partInfo: async (id: string) => {
      const d = await this.partDef(id);
      return {
        id: d.id,
        name: d.name,
        group: d.group,
        family: d.family,
        prefix: d.prefix,
        description: d.description,
        pins: d.symbol.pins.map((p) => ({ name: p.name, number: p.number ?? null, x: p.x, y: p.y })),
        params: d.params.map((p) => ({ key: p.key, label: p.label, unit: p.unit ?? '', default: p.default, kind: p.kind })),
      };
    },

    // ---- editing -------------------------------------------------------------------------------
    place: async (partId: string, x: number, y: number, opts: Record<string, unknown> = {}) => {
      const def = await this.partDef(partId);
      const o = isRecord(opts) ? opts : {};
      const sheet = this.sheetByRef(o.sheet);
      const total = this.design.sheets.reduce((n, s) => n + s.parts.length, 0);
      if (total >= SCRIPT_LIMITS.maxParts) throw new Error(sx('tooManyParts', { max: SCRIPT_LIMITS.maxParts }));
      const rotation = o.rotation === undefined ? 0 : Number(o.rotation);
      if (!ROTATIONS.includes(rotation)) throw new Error(sx('badRotation', { value: String(o.rotation) }));
      const used = collectRefdes(this.design);
      let refdes: string;
      if (typeof o.refdes === 'string' && o.refdes.trim()) {
        refdes = o.refdes.trim();
        if (used.has(refdes.toUpperCase())) throw new Error(sx('duplicateRefdes', { refdes }));
      } else refdes = nextRefdes(effectivePrefix(def.prefix, this.design.refdesRules), used);
      const params: Record<string, string> = {};
      if (isRecord(o.params)) for (const [k, v] of Object.entries(o.params)) params[k] = String(v);
      if (o.value !== undefined && o.value !== null) params.value = String(o.value);
      const part: PartInstance = { id: newId('p'), partId: def.id, refdes, x: scriptNumber(x, 'x'), y: scriptNumber(y, 'y'), rotation: rotation as Rotation, mirror: o.mirror === true, params };
      sheet.parts.push(part);
      return this.partInfo(part);
    },

    remove: async (refdes: string) => {
      const { part, sheet } = this.findPart(refdes);
      sheet.parts = sheet.parts.filter((p) => p !== part);
      return true;
    },

    move: async (refdes: string, x: number, y: number) => {
      const { part } = this.findPart(refdes);
      part.x = scriptNumber(x, 'x');
      part.y = scriptNumber(y, 'y');
      return this.partInfo(part);
    },

    rotate: async (refdes: string, degrees: number) => {
      const { part } = this.findPart(refdes);
      const d = ((Math.round(Number(degrees) / 90) * 90) % 360 + 360) % 360;
      part.rotation = d as Rotation;
      return this.partInfo(part);
    },

    setValue: async (refdes: string, value: unknown) => {
      const { part } = this.findPart(refdes);
      const def = this.def(part);
      if (!def.params.some((p) => p.key === 'value')) throw new Error(sx('noValueParam', { refdes: part.refdes, keys: def.params.map((p) => p.key).join(', ') }));
      part.params = { ...part.params, value: String(value) };
      return part.params.value;
    },

    setParam: async (refdes: string, key: string, value: unknown) => {
      const { part } = this.findPart(refdes);
      const def = this.def(part);
      if (!def.params.some((p) => p.key === key)) throw new Error(sx('noParam', { refdes: part.refdes, key: String(key), keys: def.params.map((p) => p.key).join(', ') }));
      part.params = { ...part.params, [key]: String(value) };
      return part.params[key];
    },

    getParam: async (refdes: string, key?: string) => {
      const { part } = this.findPart(refdes);
      const def = this.def(part);
      const k = typeof key === 'string' && key ? key : 'value';
      if (!def.params.some((p) => p.key === k)) throw new Error(sx('noParam', { refdes: part.refdes, key: k, keys: def.params.map((p) => p.key).join(', ') }));
      return part.params[k] ?? defaultParams(def)[k] ?? null;
    },

    setVariable: async (name: string, value: unknown) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw new Error(sx('badVariable', { name: String(name) }));
      this.design.variables = { ...this.design.variables, [name]: String(value) };
      return String(value);
    },

    pin: async (ref: ScriptPointRef) => this.resolvePoint(ref).point,

    /** SPICE node name a pin is connected to (the name to read with `result.get('V(' + node + ')')`). */
    nodeOf: async (ref: string) => {
      const text = String(ref);
      const dot = text.indexOf('.');
      if (dot <= 0) throw new Error(sx('badPinRef', { ref: text }));
      const { part } = this.findPart(text.slice(0, dot));
      const pinName = text.slice(dot + 1);
      this.pinOf(part, pinName); // validates the pin
      const build = await this.buildWithChecks();
      const def = this.def(part);
      const pin = def.symbol.pins.find((p) => p.name.toLowerCase() === pinName.toLowerCase()) ?? def.symbol.pins.find((p) => p.number?.toLowerCase() === pinName.toLowerCase());
      const node = pin ? build.partNets[part.refdes]?.[pin.name] : undefined;
      if (node === undefined) throw new Error(sx('noNode', { ref: text }));
      return node;
    },

    wire: async (a: ScriptPointRef, b: ScriptPointRef) => {
      const pa = this.resolvePoint(a);
      const pb = this.resolvePoint(b);
      if (pa.sheet && pb.sheet && pa.sheet !== pb.sheet) throw new Error(sx('differentSheets'));
      const sheet = pa.sheet ?? pb.sheet ?? this.sheetByRef();
      const p = pa.point;
      const q = pb.point;
      const pts = p.x === q.x || p.y === q.y ? [p, q] : [p, { x: q.x, y: p.y }, q];
      return this.addWire(sheet, pts);
    },

    wirePath: async (points: ScriptPointRef[]) => {
      if (!Array.isArray(points) || points.length < 2) throw new Error(sx('pathNeedsTwo'));
      const resolved = points.map((r) => this.resolvePoint(r));
      const sheet = resolved.find((r) => r.sheet)?.sheet ?? this.sheetByRef();
      return this.addWire(sheet, resolved.map((r) => r.point));
    },

    /** Name the net that these pins are on: a net label of that name at every pin (pins on different sheets: a global name). */
    net: async (name: string, ...refs: ScriptPointRef[]) => {
      const flat = refs.flat() as ScriptPointRef[];
      if (!String(name).trim()) throw new Error(sx('badNetName'));
      if (!flat.length) throw new Error(sx('netNeedsPins'));
      const resolved = flat.map((r) => this.resolvePoint(r));
      const sheets = new Set(resolved.map((r) => r.sheet ?? this.sheetByRef()));
      for (const r of resolved) {
        const sheet = r.sheet ?? this.sheetByRef();
        sheet.labels.push({ id: newId('l'), x: r.point.x, y: r.point.y, name: String(name), rotation: 0, ...(sheets.size > 1 ? { global: true } : {}) });
      }
      return resolved.length;
    },

    label: async (ref: ScriptPointRef, name: string) => {
      const r = this.resolvePoint(ref);
      const sheet = r.sheet ?? this.sheetByRef();
      sheet.labels.push({ id: newId('l'), x: r.point.x, y: r.point.y, name: String(name), rotation: 0 });
      return true;
    },

    /** Connect a pin to ground: a ground symbol 40 units below the pin and a wire to it. */
    ground: async (ref: ScriptPointRef) => {
      const r = this.resolvePoint(ref);
      const sheet = r.sheet ?? this.sheetByRef();
      const def = await this.partDef('sources/ground');
      const gp = def.symbol.pins[0];
      const used = collectRefdes(this.design);
      const refdes = nextRefdes(effectivePrefix(def.prefix, this.design.refdesRules), used);
      const target = { x: r.point.x, y: r.point.y + 40 };
      const part: PartInstance = { id: newId('p'), partId: def.id, refdes, x: target.x - gp.x, y: target.y - gp.y, rotation: 0, mirror: false, params: {} };
      sheet.parts.push(part);
      this.addWire(sheet, [r.point, target]);
      return refdes;
    },

    // ---- analysis ------------------------------------------------------------------------------
    erc: async () => {
      const build = await this.buildWithChecks();
      return build.erc.map((m) => ({ severity: m.severity, code: m.code, message: m.message, refdes: m.refdes ?? null, net: m.net ?? null }));
    },

    netlist: async () => {
      const build = await this.buildWithChecks();
      return writeSpice({ ...build.netlist, analyses: [] });
    },

    setAnalysis: async (type: string, opts: Record<string, unknown> = {}) => {
      const build = await this.buildWithChecks();
      const t = String(type) as AnalysisType;
      const base = this.design.analysis.specs[t] ?? defaultSpec(t, specContext(build));
      const spec = applyScriptOptions(base, isRecord(opts) ? opts : {});
      this.design.analysis = { ...this.design.analysis, active: t, specs: { ...this.design.analysis.specs, [t]: spec } };
      return spec;
    },

    run: async (type?: string, opts: Record<string, unknown> = {}) => {
      const o = isRecord(opts) ? opts : {};
      const build = await this.buildWithChecks();
      const errors = build.erc.filter((m) => m.severity === 'error');
      if (errors.length) throw new Error(sx('ercErrors', { list: errors.map((m) => m.message).join('; ') }));
      const t = (typeof type === 'string' && type ? type : this.design.analysis.active) as AnalysisType;
      const base = this.design.analysis.specs[t] ?? defaultSpec(t, specContext(build));
      const spec = applyScriptOptions(base, o);
      const stepped = applySteps(this.design, spec, (n) => ({ ...n, analyses: [] }));
      if (stepped.errors.length) throw new Error(stepped.errors.map((m) => m.text).join('; '));
      const results = await this.io.runNetlist({ ...build.netlist, analyses: [stepped.spec] });
      const r = results[0];
      if (!r) throw new Error(sx('noResult'));
      if (r.error && o.throwOnError !== false) throw new Error(r.error);
      return toScriptResult(r);
    },

    runSpice: async (text: string, opts: Record<string, unknown> = {}) => {
      const o = isRecord(opts) ? opts : {};
      const parsed = parseSpice(String(text));
      if (parsed.errors.length) throw new Error(parsed.errors.map((e) => `${e.line}: ${e.message}`).join('; '));
      let netlist = parsed.netlist;
      const type = typeof o.type === 'string' ? (o.type as AnalysisType) : undefined;
      let analyses = netlist.analyses.length ? netlist.analyses : ([{ type: 'op' }] as AnalysisSpec[]);
      if (type) analyses = analyses.filter((a) => a.type === type);
      if (!analyses.length) throw new Error(sx('noDeckAnalysis', { type: String(type) }));
      netlist = { ...netlist, analyses: [applyScriptOptions(analyses[0], o)] };
      const results = await this.io.runNetlist(netlist);
      const r = results[0];
      if (!r) throw new Error(sx('noResult'));
      if (r.error && o.throwOnError !== false) throw new Error(r.error);
      return toScriptResult(r);
    },

    // ---- output --------------------------------------------------------------------------------
    saveText: async (name: string, text: string) => {
      const body = String(text);
      if (body.length > SCRIPT_LIMITS.maxTextBytes) throw new Error(sx('tooLarge'));
      const file = String(name || 'result.txt');
      const ext = /\.([a-z0-9]+)$/i.exec(file)?.[1]?.toLowerCase();
      const kind = ext === 'csv' ? 'csv' : ext === 'svg' ? 'svg' : ext === 'msim' ? 'design' : 'text';
      const saved = await this.io.saveFile({ kind, name: file, text: body });
      if (saved === null) throw new Error(sx('declined', { what: sx('whatSave') }));
      return saved;
    },

    plot: async (spec: Partial<ScriptPlot> & { series?: unknown }) => {
      if (!isRecord(spec)) throw new Error(sx('badPlot'));
      const x = Array.isArray(spec.x) ? spec.x.map((v) => scriptNumber(v, 'x')) : [];
      const series = (Array.isArray(spec.series) ? spec.series : []).map((s, i) => {
        const o: Record<string, unknown> = isRecord(s) ? s : {};
        const y = (Array.isArray(o.y) ? o.y : []).map((v) => (v === null ? Number.NaN : scriptNumber(v, 'y')));
        const sx2 = Array.isArray(o.x) ? o.x.map((v) => scriptNumber(v, 'x')) : undefined;
        return { name: typeof o.name === 'string' ? o.name : `y${i + 1}`, y, ...(sx2 ? { x: sx2 } : {}) };
      });
      if (!series.length) throw new Error(sx('badPlot'));
      const plot: ScriptPlot = { title: String(spec.title ?? ''), xLabel: String(spec.xLabel ?? ''), yLabel: String(spec.yLabel ?? ''), x, series, logX: spec.logX === true, logY: spec.logY === true };
      const svg = plotToSvg(plot);
      this.plots.push({ plot, svg });
      this.io.onPlot?.(plot, svg);
      return svg;
    },
  };
}
