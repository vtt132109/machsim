/**
 * Localized tables of the design reports (Reports dialog, CSV / HTML export, printing). The data
 * comes from src/model/reports.ts (pure); this module only names the columns and formats the cells
 * in the requested language.
 */
import type { Design } from '../../model/types';
import { componentDetails, crossReference, modelData, schematicStatistics, spareGates } from '../../model/reports';
import { buildBom } from '../../model/bom';
import { HIDDEN_VALUE, valuesHidden } from '../../model/restrictions';
import type { ReportTableData } from '../../model/reportFormat';
import { rt, type ReportKey } from '../../i18n/reportUi';
import { familyName, groupName, paramLabel, partDescription, partName } from '../../i18n/library';
import type { Lang } from '../../i18n';
import type { PartGroup } from '../../library/types';

export const REPORT_IDS = ['bom', 'componentDetail', 'modelData', 'spareGates', 'crossReference', 'statistics'] as const;
export type ReportId = (typeof REPORT_IDS)[number];

export const reportTitle = (id: ReportId, lang?: Lang): string => rt(`report.${id}.title` as ReportKey, undefined, lang);
export const reportDescription = (id: ReportId, lang?: Lang): string => rt(`report.${id}.desc` as ReportKey, undefined, lang);

const col = (k: string, lang?: Lang) => rt(`col.${k}` as ReportKey, undefined, lang);

function bomTables(design: Design, lang?: Lang): ReportTableData[] {
  const hidden = valuesHidden(design);
  const rows = buildBom(design).map((r) => [
    r.item,
    r.quantity,
    r.refdes.join(', '),
    hidden ? HIDDEN_VALUE : r.value,
    r.tolerance,
    partName({ id: r.partId, name: r.name }),
    r.manufacturer ?? '',
    r.partNumber ?? '',
    r.supplier ?? '',
    r.footprint,
    partDescription({ id: r.partId, description: r.description }),
  ]);
  return [{ title: '', columns: ['item', 'qty', 'reference', 'value', 'tolerance', 'part', 'manufacturer', 'partNumber', 'supplier', 'footprint', 'description'].map((k) => col(k, lang)), rows }];
}

function detailTables(design: Design, lang?: Lang): ReportTableData[] {
  return componentDetails(design).map((d) => {
    const rows: (string | number)[][] = [
      [rt('detail.value', undefined, lang), d.value],
      [rt('detail.tolerance', undefined, lang), d.tolerance],
      [rt('detail.sheet', undefined, lang), d.sheet],
      [rt('detail.footprint', undefined, lang), d.fields.footprint],
      [rt('detail.manufacturer', undefined, lang), d.fields.manufacturer],
      [rt('detail.partNumber', undefined, lang), d.fields.partNumber],
      [rt('detail.supplier', undefined, lang), d.fields.supplier],
      [rt('detail.models', undefined, lang), d.models.join(', ')],
    ];
    for (const p of d.params) rows.push([rt('detail.param', { name: paramLabel(p.def) }, lang), p.def.unit && p.value !== HIDDEN_VALUE && p.value !== '' ? `${p.value} ${p.def.unit}` : p.value]);
    for (const pin of d.pins) rows.push([rt('detail.pin', { name: pin.name, number: pin.number || '—', type: pin.type }, lang), pin.net || rt('detail.unconnected', undefined, lang)]);
    const excluded = [d.excludeFromSim ? rt('detail.excludedSim', undefined, lang) : '', d.excludeFromBom ? rt('detail.excludedBom', undefined, lang) : ''].filter(Boolean);
    if (excluded.length) rows.push([rt('detail.excluded', undefined, lang), excluded.join(', ')]);
    rows.push([rt('detail.provenance', undefined, lang), d.provenance]);
    return {
      title: `${d.path} · ${partName(d.def)} (${familyName(d.def.family)})`,
      caption: partDescription(d.def),
      columns: [col('field', lang), col('value', lang)],
      rows: rows.filter((r) => r[1] !== ''),
    };
  });
}

function modelTables(design: Design, lang?: Lang): ReportTableData[] {
  const rows = modelData(design).map((m) => [
    m.name,
    rt(`kind.${m.kind}` as ReportKey, undefined, lang),
    m.type,
    m.usedBy.join(', '),
    m.params.map(([k, v]) => `${k}=${v}`).join(' '),
    m.ports.join(' '),
    m.provenance,
  ]);
  return [{ title: '', columns: ['name', 'kind', 'type', 'usedBy', 'parameters', 'ports', 'provenance'].map((k) => col(k, lang)), rows }];
}

function spareTables(design: Design, lang?: Lang): ReportTableData[] {
  const rows = spareGates(design).map((g) => {
    const spare = g.sections.filter((s) => s.spare);
    return [
      g.path,
      partName(g.def),
      `${g.used}/${g.sections.length}`,
      spare.length ? spare.map((s) => rt('spare.section', { section: s.section, pins: s.pins.join(', ') }, lang)).join('; ') : rt('spare.none', undefined, lang),
    ];
  });
  return [{ title: '', columns: ['reference', 'part', 'sections', 'spare'].map((k) => col(k, lang)), rows }];
}

function crossTables(design: Design, lang?: Lang): ReportTableData[] {
  const x = crossReference(design);
  return [
    {
      title: rt('report.crossReference.parts', undefined, lang),
      columns: ['reference', 'part', 'value', 'sheet', 'zone'].map((k) => col(k, lang)),
      rows: x.parts.map((p) => [p.path, partName(p.def), p.value, p.sheet, p.zone]),
    },
    {
      title: rt('report.crossReference.nets', undefined, lang),
      columns: ['net', 'sheets', 'pins'].map((k) => col(k, lang)),
      rows: x.nets.map((n) => [n.name, n.sheets.join(', '), n.pins.join(', ')]),
    },
  ];
}

function statTables(design: Design, lang?: Lang): ReportTableData[] {
  const s = schematicStatistics(design);
  const keys = ['sheets', 'childDesigns', 'blocks', 'parts', 'components', 'virtualParts', 'instruments', 'powerSymbols'] as const;
  const rows: (string | number)[][] = keys.map((k) => [rt(`stat.${k}`, undefined, lang), s[k]]);
  for (const [g, n] of Object.entries(s.byGroup) as [PartGroup, number][]) rows.push([rt('stat.group', { group: groupName(g) }, lang), n]);
  const more = ['wires', 'segments', 'wireLength', 'buses', 'labels', 'connectors', 'probes', 'notes', 'shapes', 'nets', 'pins', 'unconnectedPins', 'ercErrors', 'ercWarnings'] as const;
  for (const k of more) rows.push([rt(`stat.${k}`, undefined, lang), s[k]]);
  return [{ title: '', columns: [col('field', lang), col('count', lang)], rows }];
}

/** The tables of one report, localized. */
export function reportTables(id: ReportId, design: Design, lang?: Lang): ReportTableData[] {
  switch (id) {
    case 'bom':
      return bomTables(design, lang);
    case 'componentDetail':
      return detailTables(design, lang);
    case 'modelData':
      return modelTables(design, lang);
    case 'spareGates':
      return spareTables(design, lang);
    case 'crossReference':
      return crossTables(design, lang);
    case 'statistics':
      return statTables(design, lang);
  }
}
