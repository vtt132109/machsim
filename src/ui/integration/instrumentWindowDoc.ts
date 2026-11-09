/**
 * Instrument windows belong to the design they were opened for. When another design tab is shown
 * its meters would otherwise stay on screen and say "X1.XMM1 no longer exists in the design"; with
 * this document extension they are closed when the tab is left and opened again, in the same
 * place, when it is shown again. `capture` only reads (crash recovery also calls it).
 */
import type { DocumentExtension } from '../app/documents';
import { closeFloatingWindow, floating, openFloatingWindow, setFloatingWindowGeometry } from '../app/extensions';

interface SavedWindow {
  kind: string;
  props: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function instrumentWindowsExtension(isInstrumentKind: (kind: string) => boolean): DocumentExtension {
  return {
    id: 'instrumentWindows',
    capture: () =>
      floating
        .getState()
        .windows.filter((w) => isInstrumentKind(w.kind))
        .map((w): SavedWindow => ({ kind: w.kind, props: w.props, x: w.x, y: w.y, w: w.w, h: w.h })),
    restore: (data) => {
      for (const w of floating.getState().windows) if (isInstrumentKind(w.kind)) closeFloatingWindow(w.id);
      if (!Array.isArray(data)) return;
      for (const w of data as SavedWindow[]) {
        const id = openFloatingWindow(w.kind, w.props);
        setFloatingWindowGeometry(id, { x: w.x, y: w.y, w: w.w, h: w.h });
      }
    },
  };
}
