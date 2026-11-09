/**
 * Export a sheet as a stand-alone SVG document (and PNG via an off-screen canvas).
 *
 * The drawing is rendered with the same React scene components as the canvas
 * (renderToStaticMarkup), with the scene stylesheet and a fixed print-friendly palette embedded,
 * so the file looks the same everywhere and does not depend on the UI theme.
 *
 * A **ladder sheet** has no schematic items at all — its program lives in `Sheet.ladder` — so the
 * rungs are drawn with {@link ladderSheetSvg} (src/ui/editor/ladderSvg.ts) and scaled into the
 * drawing frame. Print and Export image therefore show the ladder diagram instead of a blank page.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Design, Sheet } from '../../model/types';
import type { PartLookup, Rect } from '../store/types';
import { getSheet, itemsBounds } from '../store/designOps';
import { sheetWireNets } from '../store/connectivity';
import { layerVisible } from '../../model/layers';
import { rectUnion } from '../store/shapes';
import { SceneDefs, SheetScene } from './scene';
import { sheetFrame } from '../../model/paper';
import { EXPORT_TOKENS, exportStyleText } from './sceneStyle';
import { ladderSheetSvg, type LadderSvg } from './ladderSvg';
import { t } from '../../i18n';

export interface SheetSvgOptions {
  /** 'page' (default) = drawing frame plus anything outside it; 'content' = items only */
  area?: 'page' | 'content';
  /**
   * Export exactly this rectangle of the sheet (schematic units) instead of the page or the
   * content area — Capture screen area (src/ui/schematicTools/capture.ts) passes the rectangle the
   * learner dragged. `area` and `margin` are then ignored.
   */
  rect?: Rect;
  /** margin around the content area in schematic units (default 20) */
  margin?: number;
  /** colour tokens (default EXPORT_TOKENS) */
  tokens?: Record<string, string>;
  /** live probe read-outs to include */
  probeValues?: Record<string, string>;
  /** indicator levels to include (LED glow) */
  indicatorLevels?: Record<string, number>;
  /** keep the sheet's own colour scheme instead of the print palette (default false) */
  sheetColors?: boolean;
  /** draw in black on white (print setup "monochrome") */
  monochrome?: boolean;
}

export interface SheetSvg {
  svg: string;
  /** size in CSS pixels (1 schematic unit = 1 px) */
  width: number;
  height: number;
  /** exported area in schematic coordinates */
  area: Rect;
}

/** Margin between the drawing frame and the ladder diagram, in schematic units. */
const LADDER_MARGIN = 40;

/**
 * Where the rungs of a ladder sheet go on the page: the diagram, and the scale that fits it inside
 * the drawing frame (null for a schematic sheet or an empty ladder program).
 */
function ladderPlacement(sheet: Sheet): { svg: LadderSvg; scale: number; rect: Rect } | null {
  const rungs = sheet.kind === 'ladder' ? sheet.ladder : undefined;
  if (!rungs || rungs.length === 0) return null;
  const svg = ladderSheetSvg(rungs);
  const frame = sheetFrame(sheet.props);
  // the title block sits in the bottom-right corner, so leave room for it
  const room = { w: Math.max(1, frame.w - 2 * LADDER_MARGIN), h: Math.max(1, frame.h - 2 * LADDER_MARGIN - 70) };
  const scale = Math.round(Math.min(1, room.w / svg.width, room.h / svg.height) * 1e4) / 1e4;
  return { svg, scale, rect: { x: LADDER_MARGIN, y: LADDER_MARGIN, w: svg.width * scale, h: svg.height * scale } };
}

/** Area of a sheet covered by an export. */
export function exportArea(design: Design, sheetId: string, lookup: PartLookup, area: 'page' | 'content' = 'page', margin = 20): Rect {
  const sheet = getSheet(design, sheetId) ?? design.sheets[0];
  // a ladder sheet has no schematic items: its content is the rung diagram
  const content = itemsBounds(sheet, null, lookup) ?? ladderPlacement(sheet)?.rect ?? null;
  const padded = content ? { x: content.x - margin, y: content.y - margin, w: content.w + 2 * margin, h: content.h + 2 * margin } : null;
  if (area === 'content' && padded) return padded;
  const frame = sheetFrame(sheet.props);
  const page = { x: -5, y: -5, w: frame.w + 10, h: frame.h + 10 };
  return padded ? rectUnion(page, padded) : page;
}

/** The rungs of a ladder sheet as an SVG group placed on the page. */
function ladderGroup(sheet: Sheet) {
  const p = ladderPlacement(sheet);
  if (!p) return null;
  return createElement('g', {
    key: 'ladder',
    transform: `translate(${p.rect.x} ${p.rect.y}) scale(${p.scale})`,
    dangerouslySetInnerHTML: { __html: p.svg.markup },
  });
}

/** Render one sheet as an SVG document string. */
export function sheetToSvg(design: Design, sheetId: string, lookup: PartLookup, opts: SheetSvgOptions = {}): SheetSvg {
  const sheet = getSheet(design, sheetId) ?? design.sheets[0];
  const area = opts.rect ?? exportArea(design, sheet.id, lookup, opts.area ?? 'page', opts.margin ?? 20);
  const width = Math.ceil(area.w);
  const height = Math.ceil(area.h);
  const tokens = opts.monochrome ? MONO_TOKENS : (opts.tokens ?? EXPORT_TOKENS);
  // the print palette replaces a sheet colour scheme unless asked to keep it
  const drawn = opts.sheetColors || !sheet.props?.colors ? sheet : { ...sheet, props: { ...sheet.props, colors: undefined } };
  const tree = createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      width,
      height,
      viewBox: `${area.x} ${area.y} ${area.w} ${area.h}`,
    },
    createElement('title', null, `${design.title} — ${sheet.name}`),
    createElement('style', { dangerouslySetInnerHTML: { __html: exportStyleText(tokens) } }),
    createElement('defs', null, createElement(SceneDefs)),
    createElement('rect', { x: area.x, y: area.y, width: area.w, height: area.h, style: { fill: 'var(--canvas)' } }),
    createElement(SheetScene, {
      design,
      sheet: drawn,
      lookup,
      showPage: !opts.rect && (opts.area ?? 'page') === 'page',
      probeValues: opts.probeValues,
      indicatorLevels: opts.indicatorLevels,
      // the "net names" layer (Edit > Layer settings) needs the nets of the sheet
      wireNets: layerVisible(sheet, 'netNames') ? sheetWireNets(design, sheet.id, lookup) : undefined,
    }),
    ladderGroup(sheet),
  );
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(tree)}`;
  return { svg, width, height, area };
}

/** Black-on-white palette (print setup "monochrome"). */
export const MONO_TOKENS: Record<string, string> = Object.fromEntries(
  Object.entries(EXPORT_TOKENS).map(([k, v]) => [k, k.startsWith('--font') || k === '--mono' ? v : k === '--canvas' || k === '--selection-fill' || k === '--accent-weak' ? (k === '--canvas' ? '#ffffff' : 'transparent') : '#000000']),
);

/** Rasterise an SVG document to a PNG blob (browser only). `scale` multiplies the pixel size. */
export function svgToPngBlob(svg: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(t('editor.exportImage.n2dCanvasIsNotAvailable'));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t('editor.exportImage.pngEncodingFailed')))), 'image/png');
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('editor.exportImage.theSvgDrawingCouldNot')));
    };
    img.src = url;
  });
}
