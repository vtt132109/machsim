/**
 * Designs and the on-demand catalogue packs (src/library/index.ts): before a design is shown,
 * netlisted or simulated, the packs holding its parts must be loaded.
 *
 *   designPartIds(design)        every library part id the design needs: placed parts on every sheet
 *                                (root and child designs) and the library parts the embedded user
 *                                components reuse ('builtin' models)
 *   missingDesignParts(design)   the ids getPart() does not know yet (synchronous)
 *   designPartsReady(design)     null when everything is known, else a promise that loads the packs
 *                                (callers `if (p) await p` so a loaded design costs no extra tick)
 *   ensureDesignParts(design)    always a promise; resolves with the ids no pack has either
 */
import { ensurePartsLoaded, getPart } from '../library';
import type { Design } from './types';

/** Every library part id a design refers to (user components and blocks are resolved by the design itself). */
export function designPartIds(design: Pick<Design, 'sheets' | 'children' | 'customParts'>): Set<string> {
  const out = new Set<string>();
  const visit = (sheets: Design['sheets']) => {
    for (const s of sheets) for (const p of s.parts) if (!p.partId.startsWith('custom:') && !p.partId.startsWith('hier:')) out.add(p.partId);
  };
  visit(design.sheets);
  for (const c of design.children ?? []) visit(c.sheets);
  for (const c of design.customParts ?? []) if (c.model.kind === 'builtin') out.add(c.model.partId);
  return out;
}

/** Part ids of the design the registry does not know (yet). */
export function missingDesignParts(design: Pick<Design, 'sheets' | 'children' | 'customParts'>): string[] {
  return [...designPartIds(design)].filter((id) => !getPart(id));
}

/** null when every part of the design is known; otherwise a promise that loads the packs it needs. */
export function designPartsReady(design: Pick<Design, 'sheets' | 'children' | 'customParts'>): Promise<string[]> | null {
  const missing = missingDesignParts(design);
  return missing.length ? ensurePartsLoaded(missing) : null;
}

/** Load the packs the design needs; resolves with the part ids that exist in no pack. */
export function ensureDesignParts(design: Pick<Design, 'sheets' | 'children' | 'customParts'>): Promise<string[]> {
  return designPartsReady(design) ?? Promise.resolve([]);
}

/**
 * Keep the catalogue packs of the current design loaded: after every change of the document (open,
 * paste, snippet, undo …) the packs of parts that are not known yet are loaded in the background;
 * the registry then notifies its subscribers (the canvas redraws the parts). Returns the
 * unsubscribe function.
 */
export function installLibraryAutoload(subscribe: (listener: () => void) => () => void, getDesign: () => Pick<Design, 'sheets' | 'children' | 'customParts'>): () => void {
  let last: unknown = null;
  const check = () => {
    const d = getDesign();
    if (d === last) return;
    last = d;
    void designPartsReady(d);
  };
  check();
  return subscribe(check);
}
