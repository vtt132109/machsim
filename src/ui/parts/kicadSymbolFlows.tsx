/**
 * KiCad symbol libraries in the component tools (loaded on first use by the Tools commands):
 *
 *   importKicadSymbolsFlow()   choose .kicad_sym / .lib files (and SPICE model files), see what each
 *                              symbol becomes, then add the parts to My database in one step
 *   exportKicadSymbolsFlow()   write the parts of My database as a .kicad_sym (+ a .lib of their SPICE models)
 *
 * The conversion itself is src/model/kicadSymbols.ts; this file is only the dialogs.
 */
import { addFamily, upsertPart } from '../../library/custom/database';
import type { CustomPartData } from '../../library/custom/types';
import { importKicadSymbols, partsToKicadSym, KicadSymbolError, type KicadSymbolNote } from '../../model/kicadSymbols';
import { kt, symbolNoteText } from '../../i18n/kicadText';
import { t } from '../../i18n';
import { loadAllGroups } from '../../library';
import { alertDialog, confirmDialog, promptText } from '../common/dialogs';
import { actions } from '../store';
import { downloadText, pickTextFiles } from './fileIo';
import { commitDatabase, getDatabase } from './partDatabases';
import '../files/files.css';

const SYMBOL_ACCEPT = '.kicad_sym,.lib,.cir,.sp,.spi,.sub,.mod,.txt,.inc';

const baseName = (name: string): string => (name.split(/[\/]/).pop() ?? name).toLowerCase();

/** A text is a symbol library (either generation) rather than a SPICE model file. */
function isSymbolLibrary(name: string, text: string): boolean {
  if (/\.kicad_sym$/i.test(name)) return true;
  return /^\s*EESchema-LIBRARY/i.test(text.replace(/^﻿/, ''));
}

function modelWord(p: CustomPartData): string {
  return p.model.kind === 'spice' ? kt('modelSpice') : p.model.kind === 'builtin' ? kt('modelBuiltin') : kt('modelNone');
}

/** Tools › Component tools › Import KiCad symbols… */
export async function importKicadSymbolsFlow(): Promise<void> {
  const files = await pickTextFiles(SYMBOL_ACCEPT);
  await importKicadSymbolFiles(files);
}

/** The same import for files already in hand (File › Open of a .kicad_sym, a drop). */
export async function importKicadSymbolFiles(files: { name: string; text: string }[]): Promise<void> {
  await loadAllGroups();
  if (!files.length) return;
  const models = new Map<string, string>();
  for (const f of files) if (!isSymbolLibrary(f.name, f.text)) models.set(baseName(f.name), f.text);
  const taken = new Set([...getDatabase('user').parts, ...getDatabase('corporate').parts].map((p) => p.id));
  const parts: CustomPartData[] = [];
  const notes: KicadSymbolNote[] = [];
  const families = new Map<string, { group: CustomPartData['group']; name: string }>();
  const problems: string[] = [];
  let used = 0;
  for (const f of files) {
    if (!isSymbolLibrary(f.name, f.text)) continue;
    try {
      const r = importKicadSymbols(f.text, { fileName: f.name, takenIds: taken, libraries: models });
      used++;
      for (const p of r.parts) taken.add(p.id);
      parts.push(...r.parts);
      notes.push(...r.notes);
      for (const fam of r.families) families.set(`${fam.group}|${fam.name}`, fam);
    } catch (e) {
      problems.push(kt('readFailed', { name: f.name, reason: e instanceof KicadSymbolError || e instanceof Error ? e.message : String(e) }));
    }
  }
  if (!parts.length) {
    await alertDialog({ title: kt('importTitle'), message: [kt('nothing'), ...problems].join('\n') });
    return;
  }
  const lines = [...problems, ...notes.map(symbolNoteText)];
  const ok = await confirmDialog({
    title: kt('importTitle'),
    okLabel: kt('importButton', { n: parts.length }),
    message: (
      <>
        <p>{kt('found', { n: parts.length, files: used })}</p>
        <table className="msf-table">
          <thead>
            <tr>
              <th>{kt('colName')}</th>
              <th>{kt('colPins')}</th>
              <th>{kt('colModel')}</th>
            </tr>
          </thead>
          <tbody>
            {parts.slice(0, 60).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.symbol.pins.length}</td>
                <td>{modelWord(p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {parts.length > 60 ? <p className="ms-hint">… +{parts.length - 60}</p> : null}
        {lines.length ? (
          <>
            <p>
              <b>{kt('notesHeading')}</b>
            </p>
            <ul className="msf-notes">
              {lines.slice(0, 30).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </>
        ) : null}
      </>
    ),
  });
  if (!ok) return;
  let db = getDatabase('user');
  for (const fam of families.values()) db = addFamily(db, fam.group, fam.name);
  for (const p of parts) db = upsertPart(db, p);
  await commitDatabase('user', db);
  actions.addSimMessage('info', kt('imported', { n: parts.length }), 'kicad');
}

/** Tools › Component tools › Export KiCad symbol library… */
export async function exportKicadSymbolsFlow(): Promise<void> {
  const parts = getDatabase('user').parts;
  if (!parts.length) {
    await alertDialog({ title: kt('exportTitle'), message: kt('exportNone') });
    return;
  }
  const name = await promptText({ title: kt('exportTitle'), label: kt('exportName'), initial: 'machsim', validate: (v) => (v.trim() ? null : t('editor.properties.enterAName')) });
  if (!name) return;
  const lib = name.trim().replace(/[^A-Za-z0-9_.-]+/g, '_');
  const out = partsToKicadSym(parts, { libraryName: lib });
  await downloadText(out.text, `${lib}.kicad_sym`);
  const lines = [kt('exported', { n: parts.length, name: `${lib}.kicad_sym` })];
  if (out.models) {
    await downloadText(out.models, out.modelFile);
    lines.push(kt('exportedModels', { name: out.modelFile }));
  }
  actions.addSimMessage('info', lines.join(' '), 'kicad');
}
