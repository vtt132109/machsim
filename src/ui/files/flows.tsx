/**
 * File features of the shell (lazy chunk, loaded on first use by the commands of commands.ts and
 * by src/ui/files/install.ts):
 *
 *   snippets        saveSnippetFlow (Edit / File > Snippets > Save selection as snippet: a PNG of
 *                   the selection with the circuit in an iTXt chunk, src/model/snippet.ts),
 *                   placeSnippetFromFileFlow, openSnippetFileFlow, placeSnippetBytes (drop / paste)
 *   other formats   handleOtherFormat (File > Open of MachSim XML, KiCad, EDIF, snippet pictures,
 *                   .bak copies, and closed formats of other programs, which get an explanation)
 *   exchange        exportXmlFlow, importSchematicFlow (KiCad 6+ projects with sub-sheets, and KiCad 5
 *                   .sch with its .lib files: the learner is asked for the files that are missing;
 *                   `.kicad_sym` symbol libraries go to src/ui/parts/kicadSymbolFlows.tsx)
 *   clipboard       fragmentPicture / placeSnippetData are shared with systemClipboard.ts (the circuit on
 *                   the operating-system clipboard)
 *   templates       exportTemplateFileFlow (.msimtpl), newFromTemplateFileFlow
 *   dialogs         openFileInfoDialog (File > File information), openFileOptionsDialog
 *                   (Options > File options: autosave interval, .bak copies, recovery)
 *
 * Every flow reports problems in a dialog in the UI language (texts: src/i18n/filesText.ts).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { getDesktopBridge } from '../../desktop/bridge';
import { designInfo, utf8Size } from '../../model/fileInfo';
import { valuesHidden } from '../../model/restrictions';
import { serializeDesign } from '../../model/serialize';
import { buildSnippet, decodeSnippet, encodeSnippet, snippetDesign, snippetFileName, SnippetError, type SnippetData } from '../../model/snippet';
import { designFromTemplate, parseTemplateFile, templateFromDesign, TEMPLATE_EXTENSION } from '../../model/templates';
import type { Design, Point, Sheet } from '../../model/types';
import { designToXml, isDesignXml, xmlToDesignSafely } from '../../model/xmlDesign';
import type { SchematicImportNote, SchematicImportResult } from '../../model/importSchematic';
import { encodePng } from '../../util/png';
import { formatEng } from '../../util/units';
import { ft } from '../../i18n/filesText';
import { kt } from '../../i18n/kicadText';
import { sanitizeReport } from '../../i18n/sanitize';
import { familyName, groupName, partName } from '../../i18n/library';
import { loadAllGroups } from '../../library';
import { ensureDesignParts } from '../../model/libraryLoad';
import { localeTag, t } from '../../i18n';
import { Dialog } from '../common/Dialog';
import { alertDialog, choiceDialog, openCustomDialog, promptText } from '../common/dialogs';
import { openHelp } from '../help/open';
import { actions, getState, isDirty, partLookup } from '../store';
import { copyItems } from '../store/designOps';
import { visibleRect } from '../store/viewport';
import { viewOf } from '../store/editorStore';
import { ANALYSIS_LABELS } from '../app/menus';
import {
  confirmDiscardChanges,
  currentFileTarget,
  currentOpenedStat,
  loadDesignText,
  openGeneratedDesign,
  openOpenedFile,
  recoverAutosaved,
  recoveryStore,
} from '../app/document';
import { baseName, ensureExtension, exportFile, fileNameForTitle, pickBinaryFile, pickTextFile, type OpenedFile } from '../app/files';
import { addUserTemplate } from '../app/schematicDialogs';
import './files.css';

// ---------------------------------------------------------------------------
// snippets
// ---------------------------------------------------------------------------

/** The PNG picture of a fragment (canvas rendering; a blank picture where no canvas exists). */
export async function fragmentPicture(design: Design, fragment: SnippetData['fragment']): Promise<{ png: Uint8Array; blank: boolean }> {
  const sheet: Sheet = { id: '__snippet__', name: design.title, parts: fragment.parts, wires: fragment.wires, labels: fragment.labels, probes: fragment.probes, notes: fragment.notes, ...(fragment.shapes ? { shapes: fragment.shapes } : {}) };
  const temp: Design = { ...design, sheets: [sheet], children: fragment.children ?? design.children };
  try {
    const { sheetToSvg, svgToPngBlob } = await import('../editor/exportImage');
    const r = sheetToSvg(temp, sheet.id, partLookup, { area: 'content', margin: 20 });
    const scale = Math.max(1, Math.min(2, 4096 / Math.max(r.width, r.height)));
    const blob = await svgToPngBlob(r.svg, r.width, r.height, scale);
    return { png: new Uint8Array(await blob.arrayBuffer()), blank: false };
  } catch {
    // no canvas (or the drawing failed): a small white picture still carries the circuit
    return { png: encodePng(64, 48, new Uint8Array(64 * 48 * 4).fill(255)), blank: true };
  }
}

/** Edit / File > Snippets > Save selection as snippet. */
export async function saveSnippetFlow(): Promise<void> {
  const s = getState();
  if (!s.selection.length) {
    await alertDialog({ title: ft('snippetTitle'), message: ft('snippetNothingSelected') });
    return;
  }
  if (valuesHidden(s.design)) {
    await alertDialog({ title: ft('snippetTitle'), message: ft('snippetHidden') });
    return;
  }
  const frag = copyItems(s.design, s.activeSheetId, s.selection, partLookup);
  if (!frag) return;
  const data = buildSnippet(s.design, frag);
  const { png, blank } = await fragmentPicture(s.design, data.fragment);
  const bytes = encodeSnippet(png, data);
  const name = snippetFileName(s.design.title || baseName(s.fileName));
  const ok = await exportFile(name, new Blob([bytes as BlobPart], { type: 'image/png' }), { name: ft('snippetFilter'), extensions: ['png'] });
  if (!ok) return;
  actions.addSimMessage('info', ft('snippetSaved', { name, n: data.fragment.parts.length, w: data.fragment.wires.length }), 'snippet');
  if (blank) actions.addSimMessage('warning', ft('snippetNoCanvas'), 'snippet');
}

export function snippetErrorText(err: unknown, name: string): string {
  if (err instanceof SnippetError) {
    switch (err.code) {
      case 'no-data':
        return ft('snippetNoData', { name });
      case 'not-png':
        return ft('snippetNotPng', { name });
      case 'damaged':
        return ft('snippetDamaged', { name });
      case 'newer':
        return ft('snippetNewer', { name });
      default:
        return `${ft('snippetInvalid', { name })}\n\n${err.issues.slice(0, 8).join('\n')}`;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

/** Centre of the visible part of the active sheet (paste target without a mouse position). */
function viewCenter(): Point {
  const s = getState();
  const r = visibleRect(viewOf(s), s.viewportSize);
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/**
 * Place a snippet picture on the active sheet: its top-left corner at `at` (default: the centre of
 * the view). Returns false (after a message) when the picture has no usable circuit.
 */
export async function placeSnippetBytes(bytes: Uint8Array, name: string, at?: Point): Promise<boolean> {
  let data: SnippetData;
  try {
    data = decodeSnippet(bytes);
  } catch (err) {
    await alertDialog({ title: ft('snippetTitle'), message: snippetErrorText(err, name) });
    return false;
  }
  return placeSnippetData(data, at);
}

/** Place the circuit of a decoded snippet (from a picture or from the system clipboard) on the active sheet. */
export async function placeSnippetData(data: SnippetData, at?: Point): Promise<boolean> {
  // parts of catalogue packs not loaded yet load first (pins are needed to join the wires)
  await ensureDesignParts({ sheets: [{ id: '', name: '', parts: data.fragment.parts, wires: [], labels: [], probes: [], notes: [] }], children: data.fragment.children, customParts: data.customParts });
  const before = new Set(data.fragment.parts.map((p) => p.refdes));
  const target = at ?? viewCenter();
  const sel = actions.insertSnippet(data.fragment, { customParts: data.customParts, variables: data.variables, variants: data.variants, customSpice: data.customSpice, nets: data.nets }, target);
  if (!sel.length) return false;
  const sheet = getState().design.sheets.find((x) => x.id === getState().activeSheetId) ?? getState().design.children?.flatMap((c) => c.sheets).find((x) => x.id === getState().activeSheetId);
  const placed = new Set(sel.filter((x) => x.kind === 'part').map((x) => x.id));
  const renamed = (sheet?.parts ?? []).filter((p) => placed.has(p.id) && !before.has(p.refdes)).map((p) => p.refdes);
  actions.addSimMessage('info', ft('snippetPlaced', { n: placed.size, w: sel.filter((x) => x.kind === 'wire').length }), 'snippet');
  if (renamed.length) actions.addSimMessage('info', ft('snippetRenamed', { list: renamed.join(', ') }), 'snippet');
  return true;
}

/** Message when Ctrl+V finds nothing MachSim can paste. */
export function pasteNothingText(): string {
  return ft('pasteNothing');
}

const SNIPPET_PICK = { accept: ['.png'], filter: () => ({ name: ft('snippetFilter'), extensions: ['png'] }) };

/** File > Snippets > Paste snippet from file. */
export async function placeSnippetFromFileFlow(): Promise<void> {
  const f = await pickBinaryFile(SNIPPET_PICK.accept, SNIPPET_PICK.filter());
  if (f?.bytes) await placeSnippetBytes(f.bytes, f.name);
}

/** Open a snippet picture as a new, unsaved design (File > Open of a .png). */
async function openSnippetAsDesign(bytes: Uint8Array, name: string): Promise<boolean> {
  let data: SnippetData;
  try {
    data = decodeSnippet(bytes);
  } catch (err) {
    await alertDialog({ title: ft('snippetTitle'), message: snippetErrorText(err, name) });
    return false;
  }
  const title = data.title || baseName(name).replace(/ - snippet$/, '');
  return openGeneratedDesign(snippetDesign(data, title, ft('snippetSheet')), fileNameForTitle(title), false);
}

/** File > Snippets > Open snippet as new design. */
export async function openSnippetFileFlow(): Promise<void> {
  if (!(await confirmDiscardChanges(t('app.document.openAnotherDesign')))) return;
  const f = await pickBinaryFile(SNIPPET_PICK.accept, SNIPPET_PICK.filter());
  if (f?.bytes) await openSnippetAsDesign(f.bytes, f.name);
}

// ---------------------------------------------------------------------------
// other formats (File > Open, Explorer, drag and drop)
// ---------------------------------------------------------------------------

const EXCHANGE_RE = /\.(xml|kicad_sch|edf|edif|edn|edo)$/i;
const CLOSED: [RegExp, Parameters<typeof ft>[0]][] = [
  [/\.(ms\d{1,2}|msm)$/i, 'closedWhatDesign'],
  [/\.(dsn|utsch)$/i, 'closedWhatDsn'],
  [/\.(mp14|mpzip)$/i, 'closedWhatProject'],
  [/\.(mst1[34])$/i, 'closedWhatTemplate'],
  [/\.msmx$/i, 'closedWhatTouch'],
  [/\.prz$/i, 'closedWhatComponents'],
  // the closed formats of the PCB side of another suite (layout / Gerber project)
  [/\.(oecl|mspc|pcb3?)$/i, 'closedWhatPcb'],
];

/** Explain how to bring a closed-format file into MachSim. */
async function explainClosedFormat(name: string, what: Parameters<typeof ft>[0] | null): Promise<void> {
  await alertDialog({
    title: ft('closedTitle'),
    message: what ? (
      <>
        <p>{ft('closedIntro', { name, what: ft(what) })}</p>
        <ol className="msf-steps">
          <li>{ft('closedStep1')}</li>
          <li>{ft('closedStep2')}</li>
          <li>{ft('closedStep3')}</li>
          <li>{ft('closedStep4')}</li>
        </ol>
      </>
    ) : (
      <p>{ft('closedKicad5')}</p>
    ),
  });
}

function noteText(n: SchematicImportNote): string {
  switch (n.kind) {
    case 'generic':
      return ft('importGeneric', { ref: n.refdes, symbol: n.symbol });
    case 'supply':
      return ft('importSupply', { net: n.net, volts: formatEng(n.volts) });
    case 'defaultValue':
      return ft('importDefault', { ref: n.refdes, value: n.value });
    case 'unannotated':
      return ft('importUnannotated', { count: n.count });
    case 'label':
      return ft('importLabel', { net: n.net });
    case 'buses':
      return kt('importBuses', { buses: n.buses, entries: n.entries });
    case 'blocks':
      return kt('importBlocks', { names: n.names.join(', ') });
    case 'warning':
      return ft('importWarning', { what: n.what });
    case 'unsupported':
      return ft('importWarning', { what: n.what });
    default:
      return '';
  }
}

/** Open an imported schematic as a new design and list what the learner should check. */
async function openImported(r: SchematicImportResult, name: string): Promise<boolean> {
  const ok = await openGeneratedDesign(r.design, fileNameForTitle(baseName(name)), false);
  if (!ok) return false;
  actions.addSimMessage('info', ft('importDone', { name, parts: r.stats.parts, nets: r.stats.nets }), 'exchange');
  const lines = r.notes.map(noteText).filter(Boolean);
  await alertDialog({
    title: ft('importReport'),
    message: (
      <>
        <p>{ft('importDone', { name, parts: r.stats.parts, nets: r.stats.nets })}</p>
        {lines.length ? (
          <ul className="msf-notes">
            {lines.slice(0, 40).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : null}
        <p className="ms-hint">{ft('importCheck')}</p>
      </>
    ),
  });
  return true;
}

const lowerBase = (name: string): string => (name.split(/[\\/]/).pop() ?? name).toLowerCase();

/**
 * Ask the learner for files the import needs (sub-sheets, symbol libraries): say which ones, then
 * open a file picker that takes several at once. Returns what was chosen, keyed by lower-case base name.
 */
async function askForFiles(message: string, accept: string): Promise<Map<string, string>> {
  const { pickTextFiles } = await import('../parts/fileIo');
  const ok = await choiceDialog({
    title: ft('importReport'),
    message: <p>{message}</p>,
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'pick', label: kt('choose'), primary: true },
    ],
  });
  const out = new Map<string, string>();
  if (ok !== 'pick') return out;
  for (const f of await pickTextFiles(accept)) out.set(lowerBase(f.name), f.text);
  return out;
}

/** The sub-sheets of a KiCad project (and the libraries of a KiCad 5 one) are fetched from the learner's files. */
async function importKicadFiles(f: { name: string; text: string; path?: string }, sheetName: string): Promise<SchematicImportResult> {
  const { importKicadProject, librarySymbols } = await import('../../model/kicadProject');
  const { isLegacySchematic, legacyLibraryNicknames } = await import('../../model/kicadLegacy');
  const legacy = isLegacySchematic(f.text);
  const known = new Map<string, string>();
  const libraries = [] as import('../../model/kicadSymbols').KSymbol[];
  if (legacy) {
    // the libraries the schematic names: next to the file on the desktop, else chosen by the learner
    const bridge = getDesktopBridge();
    const project = lowerBase(f.name).replace(/\.sch$/, '');
    const wanted = [...legacyLibraryNicknames(f.text), `${project}-cache`];
    const bag = new Map<string, string>();
    if (bridge?.readIncludeFile && f.path) {
      for (const nick of wanted) {
        const got = await bridge.readIncludeFile(f.path, `${nick}.lib`).catch(() => null);
        if (got) bag.set(`${nick}.lib`.toLowerCase(), got.content);
      }
    }
    if (bag.size === 0) for (const [k, v] of await askForFiles(kt('libsNeed'), '.lib')) bag.set(k, v);
    for (const text of bag.values()) {
      try {
        libraries.push(...librarySymbols(text));
      } catch {
        // a file that is not a symbol library is simply not used
      }
    }
  }
  let result = await importKicadProject(f.text, { fileName: f.name, sheetName, libraries, read: (file) => known.get(lowerBase(file)) ?? null });
  for (let round = 0; round < 4 && result.missing.length > 0; round++) {
    const more = await askForFiles(kt('sheetsNeed', { files: result.missing.join(', ') }), legacy ? '.sch' : '.kicad_sch');
    let added = 0;
    for (const [k, v] of more) if (!known.has(k)) {
      known.set(k, v);
      added++;
    }
    if (!added) break;
    result = await importKicadProject(f.text, { fileName: f.name, sheetName, libraries, read: (file) => known.get(lowerBase(file)) ?? null });
  }
  if (result.missing.length) result.notes.push({ kind: 'warning', what: kt('missingSheets', { files: result.missing.join(', ') }) });
  if (result.missingSymbols.length) result.notes.push({ kind: 'warning', what: kt('missingSymbols', { names: result.missingSymbols.join(', ') }) });
  return result;
}

/** Read a KiCad / EDIF text into a design (importers load with this chunk only when needed). */
async function importText(text: string, name: string, path?: string): Promise<SchematicImportResult> {
  const sheetName = ft('snippetSheet');
  // imported parts are matched against the whole catalogue
  await loadAllGroups();
  if (/\.(kicad_sch|sch)$/i.test(name)) return importKicadFiles({ name, text, path }, sheetName);
  return (await import('../../model/edifImport')).importEdif(text, { fileName: name, sheetName });
}

/**
 * Handler of otherFormatHandler (document.ts): true / false when the file was one of the formats
 * handled here (opened / refused with a message), null for .msim designs and unknown files.
 */
export async function handleOtherFormat(f: OpenedFile): Promise<boolean | null> {
  const name = f.name;
  if (/\.png$/i.test(name)) return f.bytes ? openSnippetAsDesign(f.bytes, name) : false;
  for (const [re, what] of CLOSED) {
    if (re.test(name)) {
      await explainClosedFormat(name, what);
      return false;
    }
  }
  if (/\.kicad_sym$/i.test(name)) {
    await (await import('../parts/kicadSymbolFlows')).importKicadSymbolFiles([{ name, text: f.text }]);
    return true;
  }
  if (/\.sch$/i.test(name) && /^EESchema Schematic/.test(f.text)) {
    // KiCad 5: converted to the KiCad 6 form, with the symbols of its .lib files
    try {
      return await openImported(await importText(f.text, name, f.target?.kind === 'desktop' ? f.target.path : undefined), name);
    } catch (err) {
      await alertDialog({ title: ft('importFailed', { name }), message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
  if (/\.xml$/i.test(name)) {
    if (!isDesignXml(f.text)) {
      await alertDialog({ title: t('app.document.cannotOpenDesign'), message: ft('xmlNotDesign', { name }) });
      return false;
    }
    try {
      const { design, notes } = xmlToDesignSafely(f.text);
      const ok = await openGeneratedDesign(design, ensureExtension(baseName(name)), false);
      if (ok) {
        actions.addSimMessage('info', ft('xmlOpened', { name }), 'xml');
        if (notes.length) actions.addSimMessage('warning', sanitizeReport(notes), t('sim.source.integrity'));
      }
      return ok;
    } catch (err) {
      await alertDialog({ title: t('app.document.cannotOpenDesign'), message: `${name}\n\n${err instanceof Error ? err.message : String(err)}` });
      return false;
    }
  }
  if (EXCHANGE_RE.test(name)) {
    try {
      return await openImported(await importText(f.text, name, f.target?.kind === 'desktop' ? f.target.path : undefined), name);
    } catch (err) {
      await alertDialog({ title: ft('importFailed', { name }), message: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }
  if (/\.msimtpl$/i.test(name)) {
    const rec = parseTemplateFile(f.text, baseName(name));
    if (!rec) {
      await alertDialog({ title: t('cmd.file.importTemplate'), message: ft('templateBad', { name }) });
      return false;
    }
    return openGeneratedDesign(designFromTemplate(rec, rec.name), fileNameForTitle(rec.name), false);
  }
  const bak = /^(.*?)(\.bak\d*)$/i.exec(name);
  if (bak) {
    const ok = await loadDesignText(f.text, ensureExtension(bak[1].replace(/\.msim$/i, '')), null, false);
    if (ok) actions.addSimMessage('warning', ft('bakOpened', { name }), 'backup');
    return ok;
  }
  return null;
}

/** File > Import KiCad / EDIF schematic (the open dialog lists every format MachSim reads). */
export async function importSchematicFlow(): Promise<void> {
  if (!(await confirmDiscardChanges(t('app.document.openAnotherDesign')))) return;
  const f = await pickTextFile(['.msim', '.kicad_sch', '.edf', '.edif', '.edn', '.edo', '.sch', '.xml']);
  if (f) await openOpenedFile(f);
}

// ---------------------------------------------------------------------------
// exchange: MachSim XML
// ---------------------------------------------------------------------------

/** File > Export > MachSim XML. */
export async function exportXmlFlow(): Promise<void> {
  const s = getState();
  if (valuesHidden(s.design)) {
    actions.addSimMessage('warning', t('learn.restricted.export'), 'instructor');
    return;
  }
  const name = fileNameForTitle(baseName(s.fileName) || s.design.title, '.xml');
  const ok = await exportFile(name, designToXml(s.design), { name: ft('xmlFilter'), extensions: ['xml'] });
  if (ok) actions.addSimMessage('info', ft('xmlExported', { name }), 'xml');
}

// ---------------------------------------------------------------------------
// templates as files
// ---------------------------------------------------------------------------

/** File > Export template to file: the current design's settings (and content) as .msimtpl. */
export async function exportTemplateFileFlow(): Promise<void> {
  const d = getState().design;
  const name = await promptText({ title: t('cmd.file.exportTemplate'), label: t('schematic.tpl.nameLabel'), initial: d.title, validate: (v) => (v.trim() ? null : t('editor.properties.enterAName')) });
  if (!name) return;
  const choice = await choiceDialog({
    title: t('cmd.file.exportTemplate'),
    message: t('schematic.tpl.contentQuestion'),
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'settings', label: t('schematic.tpl.settingsOnly') },
      { id: 'content', label: t('schematic.tpl.withContent'), primary: true },
    ],
  });
  if (choice !== 'settings' && choice !== 'content') return;
  const rec = templateFromDesign(d, name, choice === 'content');
  const file = fileNameForTitle(name, TEMPLATE_EXTENSION);
  const ok = await exportFile(file, JSON.stringify(rec, null, 2), { name: ft('templateFilter'), extensions: [TEMPLATE_EXTENSION.slice(1)] });
  if (ok) actions.addSimMessage('info', ft('templateExported', { name: file }), 'template');
}

/** File > New from template file: a .msimtpl (or a .msim used as a template) becomes a new design. */
export async function newFromTemplateFileFlow(): Promise<void> {
  if (!(await confirmDiscardChanges(t('app.document.startANewDesign')))) return;
  const f = await pickTextFile([TEMPLATE_EXTENSION, '.msim', '.json']);
  if (!f) return;
  const rec = parseTemplateFile(f.text, baseName(f.name));
  if (!rec) {
    await alertDialog({ title: t('cmd.file.importTemplate'), message: ft('templateBad', { name: f.name }) });
    return;
  }
  const choice = await choiceDialog({
    title: t('cmd.file.importTemplate'),
    message: (
      <>
        <p>
          <b>{rec.name}</b> — {rec.withContent ? t('schematic.tpl.withContent') : t('schematic.tpl.settingsOnly')}
        </p>
        <p className="ms-hint">{ft('templateKeep')}</p>
      </>
    ),
    choices: [
      { id: 'cancel', label: t('common.cancel') },
      { id: 'once', label: t('cmd.file.new') },
      { id: 'keep', label: ft('templateKeep'), primary: true },
    ],
  });
  if (choice !== 'once' && choice !== 'keep') return;
  if (choice === 'keep') {
    addUserTemplate(rec);
    actions.addSimMessage('info', ft('templateImported', { name: rec.name }), 'template');
  }
  const title = await promptText({ title: t('cmd.file.newFromTemplate'), label: t('editor.properties.title'), initial: t('schematic.tpl.untitled'), validate: (v) => (v.trim() ? null : t('editor.properties.enterATitle')) });
  if (!title) return;
  await openGeneratedDesign(designFromTemplate(rec, title), fileNameForTitle(title), false);
}

// ---------------------------------------------------------------------------
// File > File information
// ---------------------------------------------------------------------------

function sizeText(bytes: number): string {
  return bytes < 1024 ? ft('infoBytes', { n: bytes }) : ft('infoKib', { kib: formatEng(bytes / 1024, '', 3), n: bytes.toLocaleString(localeTag()) });
}

function dateText(iso: string | number | undefined): string {
  if (iso === undefined || iso === '') return ft('infoNone');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString(localeTag());
}

interface FsFacts {
  path: string;
  size: number | null;
  created: string | null;
  modified: string | null;
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row">{k}</th>
      <td className="ms-wrap">{children}</td>
    </tr>
  );
}

function FileInfoDialog({ close, fs }: { close: () => void; fs: FsFacts }) {
  const s = getState();
  const info = useMemo(() => designInfo(s.design, partLookup), [s.design]);
  const [copied, setCopied] = useState(false);
  const estimate = useMemo(() => utf8Size(serializeDesign(s.design)), [s.design]);
  const instruments = useMemo(() => {
    const names = new Set<string>();
    for (const sheet of [...s.design.sheets, ...(s.design.children ?? []).flatMap((c) => c.sheets)]) for (const p of sheet.parts) {
      const def = partLookup(p.partId);
      if (def?.instrument) names.add(partName(def));
    }
    return [...names];
  }, [s.design]);
  const r = info.restrictions;
  const restrictions = [
    r.hideValues ? ft('infoRHide') : '',
    r.lockParts ? ft('infoRLock', { n: r.lockedParts }) : '',
    r.disabledAnalyses.length ? ft('infoRAnalyses', { list: r.disabledAnalyses.map((a) => ANALYSIS_LABELS[a]).join(', ') }) : '',
    r.disabledInstruments.length ? ft('infoRInstruments', { n: r.disabledInstruments.length }) : '',
    r.lockDescription ? ft('infoRDescription') : '',
    r.hideAnswers ? ft('infoRAnswers') : '',
  ].filter(Boolean);
  const mode = { auto: ft('infoModeAuto'), ideal: ft('infoModeIdeal'), real: ft('infoModeReal') }[info.simulation.digitalMode];
  const timing = { typical: ft('infoTimingTypical'), max: ft('infoTimingMax'), zero: ft('infoTimingZero') }[info.simulation.digitalTiming];
  const rows: [string, string][] = [
    [ft('infoPath'), fs.path],
    [ft('infoSize'), fs.size !== null ? sizeText(fs.size) : ft('infoSizeEstimate', { size: sizeText(estimate) })],
    [ft('infoCreated'), [info.meta.created ? dateText(info.meta.created) : '', fs.created ? ft('infoFileDates', { fs: dateText(fs.created) }) : ''].filter(Boolean).join(' · ') || ft('infoNone')],
    [ft('infoModified'), [info.meta.modified ? dateText(info.meta.modified) : '', fs.modified ? ft('infoFileDates', { fs: dateText(fs.modified) }) : ''].filter(Boolean).join(' · ') || ft('infoNone')],
    [ft('infoSavedBy'), info.meta.savedBy ?? ft('infoSavedByUnknown')],
    [ft('infoFormat'), ft('infoFormatValue', { v: info.version })],
    [ft('infoUnsavedChanges'), isDirty(s) ? ft('infoYes') : ft('infoNo')],
  ];
  const contents: [string, string][] = [
    [ft('infoSheets'), ft('infoSheetsValue', { root: info.sheets.root, child: info.sheets.child })],
    [ft('infoChildren'), String(info.childDesigns.subcircuits + info.childDesigns.hierarchical)],
    [ft('infoParts'), ft('infoPartsValue', { total: info.parts.total, components: info.parts.components, instruments: info.parts.instruments, symbols: info.parts.symbols, blocks: info.parts.blocks })],
    ...(info.parts.excludedFromSim ? ([[ft('infoExcluded'), String(info.parts.excludedFromSim)]] as [string, string][]) : []),
    ...(info.parts.unknown ? ([[ft('infoUnknownParts'), String(info.parts.unknown)]] as [string, string][]) : []),
    [ft('infoWires'), `${info.wires} / ${info.buses}`],
    [ft('infoLabels'), `${info.labels} / ${info.connectors}`],
    [ft('infoNets'), info.nets >= 0 ? String(info.nets) : ft('infoNone')],
    [ft('infoProbes'), String(info.probes)],
    [ft('infoNotes'), `${info.notes} / ${info.shapes}`],
    [ft('infoInstruments'), instruments.length ? instruments.join(', ') : ft('infoNone')],
    [ft('infoVariables'), info.variables ? Object.keys(s.design.variables).join(', ') : ft('infoNone')],
    [ft('infoCustom'), `${info.customParts} / ${info.customModels}`],
    ...(info.ladder.sheets
      ? ([[ft('infoLadder'), ft('infoLadderValue', { sheets: info.ladder.sheets, rungs: info.ladder.rungs, contacts: info.ladder.contacts, outputs: info.ladder.outputs, addresses: info.ladder.addresses })]] as [string, string][])
      : []),
    ...(info.ladder.disabled ? ([[ft('infoLadderDisabled'), String(info.ladder.disabled)]] as [string, string][]) : []),
    [ft('infoFaults'), String(info.faults)],
    [ft('infoDescription'), info.descriptionBox ? ft('infoDescriptionValue', { q: info.questions }) : ft('infoNo')],
    [ft('infoGrapher'), String(info.grapherPages)],
    [ft('infoBreadboard'), info.breadboard ? ft('infoYes') : ft('infoNo')],
  ];
  const sim: [string, string][] = [
    [ft('infoActive'), ANALYSIS_LABELS[info.simulation.active]],
    [ft('infoAnalyses'), info.simulation.analyses.map((a) => ANALYSIS_LABELS[a]).join(', ')],
    [ft('infoOptions'), info.simulation.options.length ? info.simulation.options.join(', ') : ft('infoDefault')],
    [ft('infoDigital'), ft('infoDigitalMode', { mode, timing })],
    [ft('infoInteractive'), info.simulation.interactive ? ft('infoYes') : ft('infoDefault')],
    [ft('infoOutputs'), `${info.simulation.outputVariables} / ${info.simulation.expressions}`],
    [ft('infoRestrictions'), restrictions.length ? ft('infoRestrictionsList', { list: restrictions.join(', ') }) : ft('infoNoRestrictions')],
  ];
  const copy = () => {
    const text = [
      `${s.design.title}`,
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
      ...contents.map(([k, v]) => `${k}: ${v}`),
      '',
      ...info.parts.byFamily.map((f) => `${groupName(f.group as never)} / ${familyName(f.family)}: ${f.count}`),
      '',
      ...sim.map(([k, v]) => `${k}: ${v}`),
    ].join('\n');
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <Dialog
      title={`${ft('infoTitle')} — ${s.design.title}`}
      onClose={close}
      width={640}
      footer={
        <>
          <button type="button" className="ms-btn" title={t('help.whatIsThis')} onClick={() => void openHelp({ kind: 'guide', page: 'fileSafety' })}>
            ?
          </button>
          <span className="ms-hint">{copied ? ft('infoCopied') : ''}</span>
          <button type="button" className="ms-btn" onClick={copy}>
            {ft('infoCopy')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
            {t('common.close')}
          </button>
        </>
      }
    >
      <div className="msf-info">
        <h3>{ft('infoFile')}</h3>
        <table className="ms-table msf-kv">
          <tbody>
            {rows.map(([k, v]) => (
              <Row key={k} k={k}>
                {v}
              </Row>
            ))}
          </tbody>
        </table>
        <h3>{ft('infoContents')}</h3>
        <table className="ms-table msf-kv">
          <tbody>
            {contents.map(([k, v]) => (
              <Row key={k} k={k}>
                {v}
              </Row>
            ))}
          </tbody>
        </table>
        {info.parts.byFamily.length ? (
          <>
            <h3>{ft('infoFamilies')}</h3>
            <table className="ms-table msf-families">
              <thead>
                <tr>
                  <th>{ft('infoGroup')}</th>
                  <th>{ft('infoFamily')}</th>
                  <th>{ft('infoCount')}</th>
                </tr>
              </thead>
              <tbody>
                {info.parts.byFamily.map((f) => (
                  <tr key={`${f.group}/${f.family}`}>
                    <td>{groupName(f.group as never)}</td>
                    <td>{familyName(f.family)}</td>
                    <td className="msf-num">{f.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
        <h3>{ft('infoSimulation')}</h3>
        <table className="ms-table msf-kv">
          <tbody>
            {sim.map(([k, v]) => (
              <Row key={k} k={k}>
                {v}
              </Row>
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

/** File > File information. */
export async function openFileInfoDialog(): Promise<void> {
  const s = getState();
  const target = currentFileTarget();
  const fs: FsFacts = { path: ft('infoNotSaved'), size: null, created: null, modified: null };
  if (target?.kind === 'desktop') {
    fs.path = target.path;
    try {
      const st = await getDesktopBridge()?.fileStat?.(target.path);
      if (st) {
        fs.size = st.size;
        fs.created = st.created;
        fs.modified = st.modified;
      }
    } catch {
      /* the file may have been moved: show what the design itself records */
    }
  } else {
    const opened = currentOpenedStat();
    const name = target?.kind === 'handle' ? target.handle.name : s.fileName;
    if (target || opened) fs.path = ft('infoBrowserFile', { name });
    if (opened?.size !== undefined) fs.size = opened.size;
    if (opened?.lastModified !== undefined) fs.modified = new Date(opened.lastModified).toISOString();
  }
  openCustomDialog((close) => <FileInfoDialog close={close} fs={fs} />);
}

// ---------------------------------------------------------------------------
// Options > File options
// ---------------------------------------------------------------------------

const INTERVALS = [10, 30, 60, 120, 300, 600];

function FileOptionsDialog({ close }: { close: () => void }) {
  const ui = getState().ui;
  const [autosave, setAutosave] = useState(ui.autosave);
  const [seconds, setSeconds] = useState(ui.autosaveSeconds);
  const [backups, setBackups] = useState(ui.backupCount);
  const desktop = !!getDesktopBridge();
  const where = recoveryStore().kind === 'desktop' ? ft('optionsWhereDesktop') : ft('optionsWhereBrowser');
  const apply = () => {
    actions.setUi({ autosave, autosaveSeconds: seconds, backupCount: backups });
    close();
  };
  const label = (n: number) => (n < 60 ? ft('optionsSeconds', { n }) : ft('optionsMinutes', { n: n / 60 }));
  const intervals = INTERVALS.includes(seconds) ? INTERVALS : [...INTERVALS, seconds].sort((a, b) => a - b);
  return (
    <Dialog
      title={ft('optionsTitle')}
      onClose={close}
      width={520}
      footer={
        <>
          <button type="button" className="ms-btn" title={t('help.whatIsThis')} onClick={() => void openHelp({ kind: 'guide', page: 'fileSafety' })}>
            ?
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={apply}>
            {t('files.apply')}
          </button>
        </>
      }
    >
      <div className="ms-form">
        <fieldset className="ms-fieldset">
          <legend>
            <label title={ft('optionsAutosaveTip')}>
              <input type="checkbox" checked={autosave} onChange={(e) => setAutosave(e.target.checked)} /> {ft('optionsAutosave')}
            </label>
          </legend>
          <p className="ms-hint">{ft('optionsAutosaveTip')}</p>
          <label className="ms-field">
            <span>{ft('optionsInterval')}</span>
            <select className="ms-select" value={seconds} disabled={!autosave} onChange={(e) => setSeconds(Number(e.target.value))}>
              {intervals.map((n) => (
                <option key={n} value={n}>
                  {label(n)}
                </option>
              ))}
            </select>
          </label>
          <p className="ms-hint">{ft('optionsWhere', { where })}</p>
          <button type="button" className="ms-btn" onClick={() => void recoverAutosaved()}>
            {ft('optionsRecover')}
          </button>
        </fieldset>
        <fieldset className="ms-fieldset">
          <legend title={ft('optionsBackupsTip')}>{ft('optionsBackups')}</legend>
          <p className="ms-hint">{desktop ? ft('optionsBackupsTip') : ft('optionsBackupsWeb')}</p>
          <label className="ms-field">
            <span>{ft('optionsBackupCount')}</span>
            <select className="ms-select" value={backups} disabled={!desktop} onChange={(e) => setBackups(Number(e.target.value))}>
              {[0, 1, 2, 3, 5, 9].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? ft('optionsBackupsOff') : String(n)}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      </div>
    </Dialog>
  );
}

export function openFileOptionsDialog(): void {
  openCustomDialog((close) => <FileOptionsDialog close={close} />);
}
