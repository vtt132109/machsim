/**
 * Shell-local view state shared by commands and dock components (kept out of the editor store
 * because it is pure presentation): the active sub-tab of the built-in Spreadsheet dock tab.
 */
import { createStore } from '../store/createStore';
import { actions } from '../store';

export type SpreadsheetTab = 'parts' | 'nets' | 'messages';

export const SPREADSHEET_TAB_ID = 'spreadsheet';

export const spreadsheetTab = createStore<SpreadsheetTab>('parts');

/** Open the dock on the Spreadsheet tab with the given sub-tab. */
export function showSpreadsheet(tab: SpreadsheetTab): void {
  spreadsheetTab.setState(tab);
  actions.setUi({ dockOpen: true, dockTab: SPREADSHEET_TAB_ID });
}
