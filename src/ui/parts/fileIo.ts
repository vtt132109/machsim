/**
 * Small file helpers of the component tools: pick a text file (desktop open dialog or a browser
 * file input) and save text (desktop save dialog or a browser download). The desktop path is kept
 * so SPICE includes can be read relative to it.
 */
import { getDesktopBridge } from '../../desktop/bridge';

export interface PickedFile {
  name: string;
  text: string;
  /** absolute path (desktop only) */
  path?: string;
}

/** Ask for a text file; `accept` lists extensions (".lib,.mod"). Resolves null when cancelled. */
export async function pickTextFile(accept: string, opts: { spice?: boolean; title?: string } = {}): Promise<PickedFile | null> {
  const bridge = getDesktopBridge();
  if (bridge && opts.spice) {
    const f = await bridge.openFile({ spice: true, ...(opts.title ? { title: opts.title } : {}) });
    return f ? { name: f.name, text: f.content, path: f.path } : null;
  }
  if (typeof document === 'undefined') return null;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(
        (text) => resolve({ name: file.name, text }),
        () => resolve(null),
      );
    });
    input.click();
  });
}

/** Save text under a suggested name (desktop: save dialog; browser: download). */
export async function downloadText(text: string, fileName: string, mime = 'text/plain'): Promise<void> {
  const bridge = getDesktopBridge();
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : 'txt';
  if (bridge) {
    await bridge.exportFile({ suggestedName: fileName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], text });
    return;
  }
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
