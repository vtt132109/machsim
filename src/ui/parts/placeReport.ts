/**
 * The Detail report and the detail fields of the Select-a-component dialog in the UI language
 * (pure; the data comes from src/library/partInfo.ts):
 *
 *   databaseName(kind)          Master / Corporate / User / In this design only
 *   modelKindText(model)        "Mạch con .subckt", ".model card NPN" …
 *   detailFields(details)       [label, value][] of the detail pane (Function, Model manufacturer /
 *                               ID, Package manufacturer / type)
 *   detailReportTables(report)  report tables (General, Pins, Parameters, Datasheet figures) for
 *                               the dialog, HTML export and copying (`reportText`)
 *
 * `partInfo` holds the library's own (English) texts, so everything a learner reads goes through
 * the i18n catalogue here: the part name and its Function line become the Vietnamese ones when the
 * part has them (`partName` / `partDescription`), and parameter labels go through `paramLabel`.
 */
import type { DetailReport, ModelInfo, PartDatabaseKind, PartDetails } from '../../library/partInfo';
import type { ReportTableData } from '../../model/reportFormat';
import { pt, ptDynamic } from '../../i18n/placeText';
import { familyName, groupName, paramLabel, partDescription, partName } from '../../i18n/library';
import { specLabel, specValueText } from '../editor/specText';
import type { PartDef, PartGroup } from '../../library/types';

export function databaseName(kind: PartDatabaseKind): string {
  switch (kind) {
    case 'master':
      return pt('dbMaster');
    case 'corporate':
      return pt('dbCorporate');
    case 'user':
      return pt('dbUser');
    default:
      return pt('dbDesign');
  }
}

export function modelKindText(m: ModelInfo): string {
  switch (m.kind) {
    case 'none':
      return pt('kindNone');
    case 'primitive':
      return pt('kindPrimitive', { id: m.id || '—' });
    case 'model':
      return pt('kindModel', { type: m.type ?? '' }).trim();
    case 'subcircuit':
      return pt('kindSubcircuit');
    case 'behavioral':
      return pt('kindBehavioral');
    case 'code-model':
      return pt('kindCode');
    case 'instrument':
      return pt('kindInstrument');
  }
}

/**
 * The part's Function line in the UI language (the Vietnamese description when it has one). A
 * catalogue part carries its Vietnamese text on the definition, so pass `def` whenever the caller
 * has it; without it only the parts listed in the i18n tables are translated.
 */
export function functionText(d: Pick<PartDetails, 'id' | 'function'>, def?: Pick<PartDef, 'id' | 'description'>): string {
  return partDescription(def ?? { id: d.id, description: d.function });
}

/** The part's name in the UI language (a Vietnamese name when the catalogue has one; see above). */
export function detailName(d: Pick<PartDetails, 'id' | 'name'>, def?: Pick<PartDef, 'id' | 'name'>): string {
  return partName(def ?? { id: d.id, name: d.name });
}

/** The detail pane rows: Function, Model manufacturer / ID / kind, Package manufacturer / type. */
export function detailFields(d: PartDetails, def?: Pick<PartDef, 'id' | 'description'>): [string, string][] {
  const hasModel = d.model.kind !== 'none';
  return [
    [pt('function'), functionText(d, def) || '—'],
    [pt('modelManufacturer'), hasModel ? d.model.manufacturer || '—' : '—'],
    [pt('modelId'), hasModel && d.model.kind !== 'primitive' && d.model.kind !== 'behavioral' ? d.model.id || '—' : '—'],
    [pt('modelKind'), modelKindText(d.model)],
    [pt('packageManufacturer'), d.packageType ? d.packageManufacturer || pt('generic') : '—'],
    [pt('packageType'), d.packageType || pt('noPackage')],
  ];
}

/** The Detail report as tables (localized labels; numbers as in the library). */
export function detailReportTables(r: DetailReport, def?: PartDef): ReportTableData[] {
  const d = r.details;
  const general: (string | number)[][] = [
    [pt('rowName'), detailName(d, def)],
    [pt('rowId'), d.id],
    [pt('rowDatabase'), databaseName(d.database)],
    [pt('rowGroup'), groupName(d.group as PartGroup)],
    [pt('rowFamily'), familyName(d.family)],
    [pt('rowPrefix'), d.prefix],
    ...detailFields(d, def),
    [pt('hyperlink'), d.hyperlink.kind === 'url' ? d.hyperlink.url : pt('linkHelp')],
  ];
  if (d.provenance) general.push([pt('provenance'), d.provenance]);
  if (r.series) general.push([pt('rowSeries'), r.series]);
  if (r.keywords.length) general.push([pt('rowKeywords'), r.keywords.join(', ')]);
  const tables: ReportTableData[] = [{ title: pt('reportGeneral'), columns: [pt('colItem'), pt('colValue')], rows: general }];
  tables.push({
    title: pt('reportPins'),
    columns: [pt('colPinName'), pt('colPinNumber'), pt('colPinType'), pt('colPinLabel')],
    rows: r.pins.map((p) => [p.name, p.number, ptDynamic(`pinType_${p.type}`, p.type), p.label]),
  });
  if (r.params.length) {
    tables.push({
      title: pt('reportParams'),
      columns: [pt('colParamKey'), pt('colParamLabel'), pt('colParamDefault'), pt('colParamUnit'), pt('colParamKind'), pt('colParamOptions')],
      rows: r.params.map((p) => [p.key, paramLabel({ label: p.label }), p.default, p.unit, ptDynamic(`paramKind_${p.kind}`, p.kind), p.options.join(', ')]),
    });
  }
  if (r.specs.length) {
    tables.push({ title: pt('reportSpecs'), columns: [pt('colSpec'), pt('colValue')], rows: r.specs.map(([k, v]) => [specLabel(k), specValueText(k, v)]) });
  }
  return tables;
}

/** Plain-text form of the report (tables as tab-separated lines, then the model text). */
export function reportText(r: DetailReport, def?: PartDef): string {
  const out: string[] = [pt('reportTitle', { name: detailName(r.details, def) }), ''];
  for (const t of detailReportTables(r, def)) {
    out.push(`== ${t.title} ==`, t.columns.join('\t'));
    for (const row of t.rows) out.push(row.join('\t'));
    out.push('');
  }
  out.push(`== ${pt('reportModel')} ==`, r.model.text || pt('noModelText'));
  return out.join('\n');
}
