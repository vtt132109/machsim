/**
 * File > Import SPICE as schematic (loaded on first use): pick a deck, read its .include / .lib
 * files (desktop: next to the deck; browser: the user picks them), convert PSpice-only cards,
 * build the schematic (src/model/spiceSchematic.ts) and open it as a new design after a summary.
 */
import type { ReactNode } from 'react';
import { pspiceCompat, spiceToSchematic, type ImportNote } from '../../model/spiceSchematic';
import { resolveDeckIncludes } from '../../model/spiceIncludes';
import { alertDialog, choiceDialog } from '../common/dialogs';
import { pickTextFile } from '../app/files';
import { openGeneratedDesign } from '../app/document';
import { includeFetcher } from '../app/spiceIncludeFetch';
import { actions } from '../store';
import { newLocalizedDesign } from '../store/editorStore';
import { rt } from '../../i18n/reportUi';
import { t } from '../../i18n';
import './reports.css';

const SPICE_EXTENSIONS = ['.cir', '.sp', '.spi', '.spice', '.net', '.ckt', '.txt', '.lib', '.mod'];

function noteText(n: ImportNote): string {
  switch (n.kind) {
    case 'block':
      return rt('imp2.note.block', { name: n.name });
    case 'label':
      return rt('imp2.note.label', { net: n.net });
    case 'controlled':
      return rt('imp2.note.controlled', { name: n.name, control: n.control });
    case 'pspice':
      return rt('imp2.note.pspice', { what: n.what });
    case 'carried':
      return rt('imp2.note.carried', { what: n.what });
    case 'unsupported':
      return rt('imp2.note.unsupported', { what: n.what });
  }
}

/** Pick, convert and (after the summary) open a SPICE deck as a schematic. */
export async function importSpiceAsSchematic(): Promise<void> {
  const f = await pickTextFile(SPICE_EXTENSIONS);
  if (!f) return;
  const compat = pspiceCompat(f.text);
  const resolved = await resolveDeckIncludes(compat.text, includeFetcher(f), { fileName: f.name });
  const parsed = resolved.result;
  if (parsed.errors.length) {
    await alertDialog({
      title: rt('imp2.title'),
      message: (
        <>
          <p>{rt('imp2.errors', { n: parsed.errors.length })}</p>
          <ul className="ms-pcb-list">
            {parsed.errors.slice(0, 30).map((e, i) => (
              <li key={i}>{`${e.line}: ${e.message}`}</li>
            ))}
          </ul>
        </>
      ),
    });
    return;
  }
  const conv = spiceToSchematic(parsed.netlist, { fileName: f.name, title: parsed.netlist.title || f.name });
  const notes: string[] = [
    ...compat.changed.map((what) => rt('imp2.note.pspice', { what })),
    ...(resolved.missing.length ? [rt('imp2.missingIncludes', { list: resolved.missing.join(', ') })] : []),
    ...conv.notes.map(noteText),
    ...parsed.warnings,
  ];
  const summary = rt('imp2.summary', { parts: conv.stats.parts, wires: conv.stats.wires, labels: conv.stats.labels, blocks: conv.stats.blocks });
  const message: ReactNode = (
    <>
      <p>{rt('imp2.intro')}</p>
      <p>
        <strong>{summary}</strong>
      </p>
      {notes.length ? (
        <>
          <p>{rt('imp2.warnings', { n: notes.length })}</p>
          <ul className="ms-pcb-list">
            {notes.slice(0, 60).map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
  const choice = await choiceDialog({ title: rt('imp2.title'), message, width: 620, choices: [{ id: 'open', label: rt('imp2.open'), primary: true }, { id: 'cancel', label: t('common.cancel') }] });
  if (choice !== 'open') return;
  const design = conv.design;
  design.sheets[0].name = newLocalizedDesign().sheets[0].name;
  const name = f.name.replace(/\.[^.]*$/, '') || 'spice';
  if (await openGeneratedDesign(design, `${name}.msim`)) actions.addSimMessage('info', rt('imp2.done', { file: f.name, summary }), 'import');
}
