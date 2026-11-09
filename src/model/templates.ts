/**
 * Design templates: "New from template" and "Save as template".
 *
 * A template is a design whose settings (sheet paper / border / title block / grid / colours,
 * title-block fields, analysis settings, simulation options, global parameters, print setup) and
 * optionally its content are copied into new designs. User templates are stored by the UI
 * (browser storage) as TemplateRecord JSON; built-in templates are made by {@link builtinTemplate}.
 */
import type { Design, SheetProps } from './types';
import { newDesign } from './types';
import { serializeDesign } from './serialize';
import { parseDesignSafely } from './sanitize';

export interface TemplateRecord {
  format: 'machsim-template';
  version: 1;
  /** user-visible template name */
  name: string;
  created: string;
  /** whether the template carries parts / wires (otherwise settings only) */
  withContent: boolean;
  /** serialised design (.msim JSON) */
  design: string;
}

/** Extension of a template exported to a file (one TemplateRecord as JSON). */
export const TEMPLATE_EXTENSION = '.msimtpl';

/**
 * A template read from a file: a .msimtpl (TemplateRecord JSON) or a plain .msim design, which
 * becomes a template with its content (named `fallbackName`). Null when the text is neither.
 */
export function parseTemplateFile(text: string, fallbackName: string, now: Date = new Date()): TemplateRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw === 'object' && raw !== null && (raw as { format?: unknown }).format === 'machsim-template') return parseTemplateList(JSON.stringify([raw]))[0] ?? null;
  try {
    return templateFromDesign(parseDesignSafely(text).design, fallbackName, true, now);
  } catch {
    return null;
  }
}

export type BuiltinTemplateId = 'blank-a4' | 'a4-title' | 'a3-title' | 'lab-report' | 'classic-dark';

export const BUILTIN_TEMPLATES: BuiltinTemplateId[] = ['blank-a4', 'a4-title', 'a3-title', 'lab-report', 'classic-dark'];

/**
 * A design with only the settings of `design` (and its content when `withContent`): every sheet
 * keeps its name and properties; the title-block date is cleared so new designs show their own.
 */
export function templateFromDesign(design: Design, name: string, withContent: boolean, now: Date = new Date()): TemplateRecord {
  const d: Design = JSON.parse(serializeDesign(design)) as Design;
  if (!withContent) {
    d.sheets = d.sheets.map((s) => ({ id: s.id, name: s.name, parts: [], wires: [], labels: [], probes: [], notes: [], ...(s.props ? { props: s.props } : {}) }));
    delete d.children;
    delete d.breadboard;
  }
  if (d.titleBlock) {
    const tb = { ...d.titleBlock };
    delete tb.date;
    d.titleBlock = tb;
  }
  return { format: 'machsim-template', version: 1, name: name.trim() || 'Template', created: now.toISOString(), withContent, design: serializeDesign(d) };
}

/** A new design from a template record (validated like a design file). */
export function designFromTemplate(rec: TemplateRecord, title: string): Design {
  const d = parseDesignSafely(rec.design).design;
  return { ...d, title: title.trim() || d.title };
}

/** Parse a stored template list (invalid entries are dropped). */
export function parseTemplateList(text: string | null): TemplateRecord[] {
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is TemplateRecord => {
      if (typeof r !== 'object' || r === null) return false;
      const o = r as Record<string, unknown>;
      if (o.format !== 'machsim-template' || typeof o.name !== 'string' || typeof o.design !== 'string') return false;
      try {
        parseDesignSafely(o.design);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * Built-in template designs. `sheetName` names the first sheet; `notes` (lab report only) are
 * the instruction lines placed on the sheet, in the UI language.
 */
export function builtinTemplate(id: BuiltinTemplateId, title: string, sheetName: string, notes: string[] = []): Design {
  const d = newDesign(title);
  d.sheets[0].name = sheetName;
  const props = (p: SheetProps) => {
    d.sheets[0].props = p;
  };
  switch (id) {
    case 'blank-a4':
      props({ paper: 'A4', orientation: 'landscape', titleBlock: false });
      break;
    case 'a4-title':
      props({ paper: 'A4', orientation: 'landscape' });
      d.titleBlock = { title, revision: '1' };
      break;
    case 'a3-title':
      props({ paper: 'A3', orientation: 'landscape' });
      d.titleBlock = { title, revision: '1' };
      break;
    case 'lab-report':
      props({ paper: 'A4', orientation: 'landscape' });
      d.titleBlock = { title, revision: '1' };
      notes.forEach((text, i) => d.sheets[0].notes.push({ id: `tpl-note${i + 1}`, x: 40, y: 40 + i * 22, text, size: 12, ...(i === 0 ? { style: { bold: true } } : {}) }));
      d.analysis = { active: 'op', specs: { ...d.analysis.specs } };
      break;
    case 'classic-dark':
      props({ paper: 'A4', orientation: 'landscape', grid: 'lines', colors: { scheme: 'black' } });
      break;
  }
  return d;
}
