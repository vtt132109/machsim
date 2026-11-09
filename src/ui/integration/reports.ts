/**
 * Text reports and SPICE I/O helpers (pure, no DOM): the design's SPICE netlist, the BOM as
 * CSV, and preparing an imported SPICE deck for simulation.
 */
import { buildBom, bomToCsv, type BomRow } from '../../model/bom';
import { buildNetlist } from '../../model/netlister';
import type { Design, ErcMessage } from '../../model/types';
import type { AnalysisSpec, Netlist } from '../../sim/netlist';
import { parseSpice, writeSpice } from '../../sim/spice';
import { includeKey } from '../../model/spiceIncludes';
import { t } from '../../i18n';
import { HIDDEN_VALUE, valuesHidden } from '../../model/restrictions';
import { hiddenFaultCount } from '../../model/faults';

export interface NetlistReport {
  /** SPICE text (ends with ".end") */
  text: string;
  /** ERC messages of the build (the text is still produced when there are errors) */
  erc: ErcMessage[];
  elementCount: number;
  /**
   * Set when the netlist is withheld: 'faults' while the design has hidden auto faults (the
   * listing would show where they are). `text` is then only a comment saying so.
   */
  withheld?: 'faults';
}

/** Why the netlist of a design must not be shown or exported, or undefined. */
export function netlistWithheld(design: Design): NetlistReport['withheld'] {
  return hiddenFaultCount(design) > 0 && !design.autoFault?.revealed ? 'faults' : undefined;
}

/**
 * SPICE netlist of a design. `analyses`: 'active' (default) writes the active analysis,
 * 'all' every saved analysis, 'none' no analysis cards. `digits` rounds the numbers for display
 * (the Netlist tab uses 6); files are written exactly (no `digits`). While the design has hidden
 * faults the netlist is withheld (see NetlistReport.withheld).
 */
export function designNetlistText(design: Design, analyses: 'active' | 'all' | 'none' = 'active', opts: { digits?: number } = {}): NetlistReport {
  const withheld = netlistWithheld(design);
  if (withheld) {
    const title = design.title || t('integration.reports.untitled');
    return { text: [title, `* ${t('learn.restricted.faults')}`, '.end', ''].join('\n'), erc: [], elementCount: 0, withheld };
  }
  const build = buildNetlist(design, { includeAnalysis: analyses === 'active' });
  const netlist: Netlist = { ...build.netlist };
  if (analyses === 'all') netlist.analyses = Object.values(design.analysis.specs).filter((s): s is AnalysisSpec => s !== undefined);
  if (analyses === 'none') netlist.analyses = [];
  const header = [
    `* ${t('integration.reports.generatedBy', { title: design.title || t('integration.reports.untitled') })}`,
    `* ${t('integration.reports.counts', { elements: build.netlist.elements.length, nets: build.nets.length })}${build.erc.length ? t('integration.reports.lengthErcMessageS', { length: build.erc.length }) : ''}`,
  ];
  const body = writeSpice(netlist, { digits: opts.digits });
  // writeSpice's first line is the title; keep it first (SPICE rule) and add the comments after it
  const nl = body.indexOf('\n');
  const text = nl >= 0 ? `${body.slice(0, nl + 1)}${header.join('\n')}\n${body.slice(nl + 1)}` : body;
  return { text, erc: build.erc, elementCount: build.netlist.elements.length };
}

export interface BomReport {
  rows: BomRow[];
  csv: string;
}

export function designBom(design: Design, includeVirtual = false): BomReport {
  // values hidden by the instructor stay hidden in the BOM as well
  const rows = buildBom(design, { includeVirtual }).map((r) => (valuesHidden(design) ? { ...r, value: HIDDEN_VALUE } : r));
  return { rows, csv: bomToCsv(rows) };
}

export interface SpiceDeck {
  netlist: Netlist;
  title: string;
  warnings: string[];
  errors: { line: number; message: string }[];
}

/**
 * Parse a SPICE deck for simulation; a deck without analysis cards runs an operating point.
 * `files` holds the .include / .lib texts already read (src/model/spiceIncludes.ts includeKey keys).
 */
export function prepareSpiceDeck(text: string, fileName: string, files?: ReadonlyMap<string, string>): SpiceDeck {
  const r = parseSpice(text, { fileName, resolveInclude: files ? (path) => files.get(includeKey(path)) : undefined });
  const netlist = r.netlist.analyses.length ? r.netlist : { ...r.netlist, analyses: [{ type: 'op' } as AnalysisSpec] };
  return { netlist, title: r.netlist.title || fileName, warnings: r.warnings, errors: r.errors };
}

/** File name for an exported netlist: "<base>.cir". */
export function netlistFileName(fileName: string, title: string): string {
  const leaf = (fileName.split(/[\\/]/).pop() ?? fileName).replace(/\.[^.]*$/, '');
  const base = leaf && !/^untitled$/i.test(leaf) ? leaf : title || 'netlist';
  return `${base.replace(/[<>:"/\\|?*]/g, '_')}.cir`;
}
