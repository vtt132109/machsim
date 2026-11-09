/**
 * Stand-alone SVG preview of a library symbol (component browser, dialogs). Renders the body at
 * rotation 0 with pin ends marked, scaled to fit its box.
 */
import type { PartDef } from '../../library/types';
import { SymbolBody } from './scene';
import { t } from '../../i18n';
import { partName } from '../../i18n/library';

const ORIGIN = { x: 0, y: 0, rotation: 0 as const, mirror: false };

/** viewBox covering the symbol bbox and all pins with a margin. */
export function symbolViewBox(def: PartDef, margin = 8): { x: number; y: number; w: number; h: number } {
  const b = def.symbol.bbox;
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  for (const p of def.symbol.pins) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0 - margin, y: y0 - margin, w: x1 - x0 + 2 * margin, h: y1 - y0 + 2 * margin };
}

export function SymbolPreview({ def, className, title }: { def: PartDef; className?: string; title?: string }) {
  const vb = symbolViewBox(def);
  return (
    <svg className={className} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={title ?? t('editor.symbolPreview.symbolOfName', { name: partName(def) })}>
      <g className="ms-scene">
        <g className="ms-part">
          <SymbolBody def={def} o={ORIGIN} />
        </g>
        {def.symbol.pins.map((p) => (
          <circle key={p.name} cx={p.x} cy={p.y} r={1.6} className="ms-preview-pin" style={{ fill: 'var(--pin)' }} />
        ))}
      </g>
    </svg>
  );
}
