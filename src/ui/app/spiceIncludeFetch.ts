/**
 * Fetcher for the `.include` / `.lib` files of an opened SPICE deck (src/model/spiceIncludes.ts):
 * on the desktop the shell reads them next to the deck (bridge.readIncludeFile; only relative paths
 * with SPICE extensions), in the browser the user picks each file (a dialog names it first).
 */
import type { DeckFetcher } from '../../model/spiceIncludes';
import { getDesktopBridge } from '../../desktop/bridge';
import { choiceDialog } from '../common/dialogs';
import { pickTextFile, type OpenedFile } from './files';
import { t } from '../../i18n';

const SPICE_ACCEPT = ['.lib', '.mod', '.inc', '.cir', '.sp', '.spi', '.sub', '.txt', '.model', '.ckt', '.net'];

export function includeFetcher(deck: OpenedFile): DeckFetcher {
  const bridge = getDesktopBridge();
  if (bridge?.readIncludeFile && deck.target?.kind === 'desktop') {
    const base = deck.target.path;
    return async (path) => {
      try {
        return (await bridge.readIncludeFile!(base, path))?.content ?? null;
      } catch {
        return null;
      }
    };
  }
  return async (path) => {
    const name = path.split(/[\\/]/).pop() ?? path;
    const choice = await choiceDialog({
      title: t('integration.include.title'),
      message: t('integration.include.message', { name }),
      choices: [
        { id: 'pick', label: t('integration.include.pick', { name }), primary: true },
        { id: 'skip', label: t('integration.include.skip') },
      ],
    });
    if (choice !== 'pick') return null;
    const f = await pickTextFile(SPICE_ACCEPT);
    return f?.text ?? null;
  };
}
