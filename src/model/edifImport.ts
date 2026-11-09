/**
 * EDIF 2 0 0 import (EIA-548 / IEC 61690-1, the vendor-neutral netlist and schematic exchange
 * format that schematic editors can export). Netlist views and schematic views are read the same
 * way: the design's top cell (the `design` statement, else the last cell with contents) gives the
 * instances (cell reference, designator, VALUE property, optional `transform` origin) and the nets
 * (`joined` port references); pages of a schematic view are flattened into one sheet.
 *
 *   edifToNetlist(text, fileName) -> ImportedNetlist (src/model/importSchematic.ts)
 *   importEdif(text, opts)        -> SchematicImportResult
 *
 * Names: an identifier, `(rename id "display")` (the display string is used) or `(name id …)`;
 * a leading '&' of an identifier is dropped. Keywords are case-insensitive; strings may use EDIF's
 * %nn% character escapes. Positions are used only when every instance has one (scaled with the
 * library's `numberDefinition` distance scale, default 1 unit = 0.254 mm); otherwise the parts are
 * placed like an imported SPICE netlist. Diode pins without names are taken as 1 = A, 2 = K.
 */
import { atom, child, children, descendants, head, parseSexpr, type SNode } from '../util/sexpr';
import { importedToDesign, type ImportedComponent, type ImportedNetlist, type SchematicImportResult } from './importSchematic';

const CI = true;

/** Display name of an EDIF name form. */
function nameOf(n: SNode | undefined): string {
  if (n === undefined) return '';
  if (!Array.isArray(n)) return atom(n).replace(/^&/, '');
  const h = head(n).toLowerCase();
  if (h === 'rename') return atom(n[2]) || nameOf(n[1]);
  if (h === 'name') return nameOf(n[1]);
  if (h === 'array') return nameOf(n[1]);
  return '';
}

/** Identifier (for references) of an EDIF name form: the first atom. */
function idOf(n: SNode | undefined): string {
  if (n === undefined) return '';
  if (!Array.isArray(n)) return atom(n).replace(/^&/, '');
  return idOf(n[1]);
}

function propValue(list: SNode[], names: string[]): string | undefined {
  const want = names.map((x) => x.toLowerCase());
  for (const p of children(list, 'property', CI)) {
    const id = idOf(p[1]).toLowerCase();
    const disp = nameOf(p[1]).toLowerCase();
    if (!want.includes(id) && !want.includes(disp)) continue;
    const v = p.find((x, i) => i > 1 && Array.isArray(x));
    if (Array.isArray(v)) return atom(v[1]) || nameOf(v[1]);
  }
  return undefined;
}

/** Metres per EDIF distance unit from a library's numberDefinition (default 0.254 mm). */
function distanceScale(root: SNode[]): number {
  for (const sc of descendants(root, 'scale', CI)) {
    const unit = descendants(sc, 'unit', CI)[0];
    if (unit && atom(unit[1]).toLowerCase() !== 'distance') continue;
    const e = sc.find((x, i) => i > 1 && Array.isArray(x) && head(x).toLowerCase() === 'e') as SNode[] | undefined;
    const user = Number(atom(sc[1])) || 1;
    if (e) return (Number(atom(e[1])) * 10 ** Number(atom(e[2]))) / user;
    const si = Number(atom(sc[2]));
    if (Number.isFinite(si) && si > 0) return si / user;
  }
  return 0.254e-3;
}

/** Connectivity of an EDIF file as an ImportedNetlist. */
export function edifToNetlist(text: string, fileName = ''): ImportedNetlist {
  const root = parseSexpr(text, { edifEscapes: true });
  if (head(root).toLowerCase() !== 'edif') throw new Error(`not an EDIF file (the file starts with "${head(root) || '?'}", expected edif)`);
  const version = child(root, 'edifVersion', CI);
  const warnings: string[] = [];
  if (version && atom(version[1]) !== '2') warnings.push(`EDIF version ${version.slice(1).map((x) => atom(x)).join(' ')}: read as 2 0 0`);
  const libraries = [...children(root, 'library', CI), ...children(root, 'external', CI)];
  const cells = new Map<string, SNode[]>();
  for (const lib of libraries) for (const cell of children(lib, 'cell', CI)) cells.set(`${idOf(lib[1]).toLowerCase()}/${idOf(cell[1]).toLowerCase()}`, cell);
  const cellByName = (name: string, lib?: string): SNode[] | undefined => {
    if (lib) return cells.get(`${lib.toLowerCase()}/${name.toLowerCase()}`);
    for (const [k, v] of cells) if (k.endsWith(`/${name.toLowerCase()}`)) return v;
    return undefined;
  };
  // the top cell: (design name (cellRef c (libraryRef l))), else the last cell that has contents
  let top: SNode[] | undefined;
  const design = child(root, 'design', CI);
  const cref = design ? child(design, 'cellRef', CI) : undefined;
  if (cref) top = cellByName(idOf(cref[1]), idOf(child(cref, 'libraryRef', CI)?.[1]) || undefined);
  if (!top) top = [...cells.values()].reverse().find((c) => descendants(c, 'contents', CI).length > 0);
  if (!top) throw new Error('the EDIF file has no cell with contents (no design to import)');
  const scale = distanceScale(root);
  const toUnits = (v: number) => ((v * scale * 1000) / 1.27) * 10;

  // ---- ports of each cell (display names by identifier)
  const portNames = (cell: SNode[] | undefined): Map<string, string> => {
    const m = new Map<string, string>();
    for (const port of cell ? descendants(cell, 'port', CI) : []) {
      // (port name (direction …)); skip portRef / portImplementation forms
      if (head(port).toLowerCase() !== 'port') continue;
      m.set(idOf(port[1]).toLowerCase(), nameOf(port[1]));
    }
    return m;
  };

  // ---- instances
  interface Inst {
    id: string;
    comp: ImportedComponent;
    ports: Map<string, string>;
  }
  const insts = new Map<string, Inst>();
  const contents = descendants(top, 'contents', CI);
  const instanceNodes = contents.flatMap((c) => descendants(c, 'instance', CI));
  for (const inst of instanceNodes) {
    const id = idOf(inst[1]);
    const view = child(inst, 'viewRef', CI);
    const cellRef = view ? child(view, 'cellRef', CI) : child(inst, 'cellRef', CI);
    const cellName = nameOf(cellRef?.[1]) || idOf(cellRef?.[1]);
    const libName = idOf(child(cellRef, 'libraryRef', CI)?.[1]);
    const cell = cellByName(idOf(cellRef?.[1]), libName || undefined);
    const designator = atom(child(inst, 'designator', CI)?.[1]) || propValue(inst, ['designator', 'refdes', 'reference', 'part_reference']) || nameOf(inst[1]);
    const value = propValue(inst, ['value', 'val', 'part_value', 'comment']) ?? (cell ? propValue(cell, ['value']) : undefined);
    const fields: Record<string, string> = {};
    for (const p of children(inst, 'property', CI)) {
      const v = p.find((x, i) => i > 1 && Array.isArray(x));
      if (Array.isArray(v)) fields[nameOf(p[1])] = atom(v[1]);
    }
    const tr = descendants(inst, 'transform', CI)[0];
    const origin = tr ? descendants(tr, 'pt', CI)[0] : undefined;
    const comp: ImportedComponent = { refdes: designator, symbol: cellName, ...(value ? { value } : {}), pins: [], fields };
    if (origin) comp.at = { x: toUnits(Number(atom(origin[1]))), y: -toUnits(Number(atom(origin[2]))), pins: {} };
    insts.set(id.toLowerCase(), { id, comp, ports: portNames(cell) });
  }

  // ---- nets
  const namedNets = new Set<string>();
  const nets = contents.flatMap((c) => descendants(c, 'net', CI));
  const seenNet = new Map<string, string>();
  for (const net of nets) {
    const name = nameOf(net[1]) || `NET${seenNet.size + 1}`;
    const joined = child(net, 'joined', CI);
    if (!joined) continue;
    // a net split over pages keeps one name (same identifier)
    const id = idOf(net[1]).toLowerCase();
    const netName = seenNet.get(id) ?? name;
    seenNet.set(id, netName);
    if (!/^(n\$?\d+|net\d+|\$n\d+|n_\d+|unnamed.*)$/i.test(netName)) namedNets.add(netName);
    for (const pr of children(joined, 'portRef', CI)) {
      const ir = child(pr, 'instanceRef', CI);
      if (!ir) continue;
      const inst = insts.get(idOf(ir[1]).toLowerCase());
      if (!inst) {
        warnings.push(`net ${netName}: unknown instance ${idOf(ir[1])}`);
        continue;
      }
      const portId = idOf(pr[1]);
      const display = inst.ports.get(portId.toLowerCase()) ?? nameOf(pr[1]);
      if (inst.comp.pins.some((p) => p.number.toLowerCase() === display.toLowerCase())) continue;
      const isNumber = /^\d+$/.test(display);
      inst.comp.pins.push({ number: display, ...(isNumber ? {} : { name: display }), net: netName });
    }
  }
  // unconnected ports: their own net, so the part still shows every pin
  let open = 0;
  for (const inst of insts.values()) {
    for (const [, display] of inst.ports) {
      if (inst.comp.pins.some((p) => p.number.toLowerCase() === display.toLowerCase())) continue;
      inst.comp.pins.push({ number: display, ...(/^\d+$/.test(display) ? {} : { name: display }), net: `__open${++open}` });
    }
  }
  const components = [...insts.values()].map((i) => i.comp).filter((c) => c.pins.length > 0);
  if (!components.every((c) => c.at)) for (const c of components) delete c.at;
  const title = nameOf(root[1]) || fileName.replace(/\.(edf|edif|edn|edo)$/i, '');
  return { title, source: 'edif', fileName, components, namedNets: [...namedNets], powerNets: [], diodeNumbering: 'AK', warnings };
}

/** Import an EDIF 2 0 0 netlist / schematic as a MachSim design. */
export function importEdif(text: string, opts: { fileName?: string; title?: string; sheetName?: string } = {}): SchematicImportResult {
  return importedToDesign(edifToNetlist(text, opts.fileName ?? ''), opts);
}
