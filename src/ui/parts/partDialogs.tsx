/**
 * Entry points of the component tools (loaded on first use by the Tools / Edit commands):
 * component wizard, model maker, symbol editor, database manager, SPICE model import and "edit the
 * selected part's symbol / model and save it as a new part".
 */
import { boxTemplate } from '../../library/custom/templates';
import { isCustomPartDef } from '../../library/custom/partDef';
import { alertDialog } from '../common/dialogs';
import { t } from '../../i18n';
import { openWizardDialog, selectedPart } from './ComponentWizard';
import { openDatabaseManagerDialog } from './DatabaseManager';
import { openSpiceImportDialog } from './SpiceImportDialog';
import { openSymbolEditorDialog } from './SymbolEditor';
import { newWizard, wizardFromPart, wizardFromPlaced } from './wizardModel';
import { findUserPart } from './partDatabases';
import { partValuesHidden } from '../../model/restrictions';
import { getState } from '../store';
import { loadAllGroups } from '../../library';

/*
 * The wizard (library part picker, families) and the database manager (master database) list the
 * whole catalogue, so the catalogue packs that are not loaded yet load before they open.
 */

export async function openComponentWizard(): Promise<void> {
  await loadAllGroups();
  openWizardDialog(newWizard());
}

/** The wizard with "create the model with a model maker" chosen (diode maker first). */
export async function openModelMaker(): Promise<void> {
  await loadAllGroups();
  openWizardDialog(newWizard({ maker: 'diode' }));
}

export function openSymbolEditor(): void {
  openSymbolEditorDialog(boxTemplate(2, 2));
}

export async function openDatabaseManager(): Promise<void> {
  await loadAllGroups();
  openDatabaseManagerDialog();
}

export function openSpiceImport(): void {
  openSpiceImportDialog();
}

/**
 * Edit the selected part: a user component from a database opens for editing (same id, saved
 * back); a library part (or a component embedded in the design only) opens as a new component
 * that keeps its model, with "replace the placed part" ticked.
 */
export async function editSelectedComponent(): Promise<void> {
  const sel = selectedPart();
  if (!sel) {
    await alertDialog({ title: t('cmd.edit.editComponent'), message: t('wiz.selectOnePart') });
    return;
  }
  // the wizard is seeded with the instance's parameter values: not while the instructor hides them
  if (partValuesHidden(getState().design, sel.def)) {
    await alertDialog({ title: t('cmd.edit.editComponent'), message: t('learn.restricted.editComponent') });
    return;
  }
  await loadAllGroups();
  if (isCustomPartDef(sel.def)) {
    const inDb = findUserPart(sel.def.id);
    if (inDb) {
      openWizardDialog({ ...wizardFromPart(inDb.part, inDb.kind), replaceInstance: sel.instId });
      return;
    }
  }
  openWizardDialog(wizardFromPlaced(sel.def, sel.params, sel.instId));
}
