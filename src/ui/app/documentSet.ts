/**
 * The application's open documents (see documents.ts for the rules): one manager over the editor
 * singleton. Importing this module is all a feature needs to register state that belongs to a
 * document (`documents.registerExtension`), to open a design in a tab or to ask which documents
 * have unsaved changes.
 */
import { editor } from '../store';
import { newLocalizedDesign } from '../store/editorStore';
import { createDocumentManager } from './documents';

export const documents = createDocumentManager({ editor, blank: () => newLocalizedDesign() });
