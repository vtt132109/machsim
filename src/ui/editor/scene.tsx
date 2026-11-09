/**
 * Schematic scene rendering (pure React SVG, no event handling).
 *
 * Used by the interactive canvas (inside its pan/zoom group) and by SVG / PNG export through
 * `renderToStaticMarkup`, so everything here must render deterministically from props.
 * Components are memoised on object identity: thanks to the store's structural sharing only the
 * parts / wires that actually changed re-render.
 */
import { valuesHidden } from '../../model/restrictions';
import { memo, useMemo, type ReactNode } from 'react';
import type React from 'react';
import type { PartDef, SymbolPrim } from '../../library/types';
import type { Design, ErcMessage, NetLabel, PartInstance, Point, Probe, Shape, Sheet, TextNote, Wire } from '../../model/types';
import { instancePins, localToSheet } from '../../model/geometry';
import { asLibraryPart } from '../../library/partkit';
import { controlIsOn } from '../store/interactive';
import { findSheet } from '../../model/hierarchy';
import { sheetColorVars, sheetFrame, titleBlockValues } from '../../model/paper';
import type { PartLookup, RatingState } from '../store/types';
import { visibleFaults } from '../../model/faults';
import { describeFault } from './faultText';
import { sheetPins } from '../store/designOps';
import { junctionPoints } from '../store/wireOps';
import {
  NOTE_DEFAULT_SIZE,
  PROBE_KIND_TAG,
  netLabelLayout,
  noteBox,
  partBox,
  partLabelLayout,
  probeLayout,
} from '../store/shapes';
import {
  arcPath,
  isUprightText,
  partTransform,
  polylinePoints,
  resolveFill,
  uprightTextPlacement,
  type Orientation,
  type TextAnchor,
} from './symbolGeometry';
import { localeTag, t } from '../../i18n';
import { LcdScreen, LitBars, LitSegments, MatrixDots, ProbeLight, displayCells } from './displayGlyphs';
import { MechaGlyph } from './mechaGlyphs';
import { explainErc } from '../../i18n/erc';
import { partDescription, partName } from '../../i18n/library';
import { activeVariant, isFitted } from '../../model/variants';

/** Drawing frame of a sheet without paper settings (schematic units); see model/paper.ts sheetFrame. */
export const PAGE = { x: 0, y: 0, w: 1200, h: 850 } as const;
export const TITLE_BLOCK = { w: 320, h: 64 } as const;
/** Title block with the version-2 fields (designed / checked / approved by, document no., revision). */
export const TITLE_BLOCK_FULL = { w: 380, h: 96 } as const;
const PIN_LABEL_SIZE = 8;
const PIN_LABEL_INSET = 13;

/** Selection key used by scene components: `${kind}:${id}`. */
export function selKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

// ---------------------------------------------------------------------------
// symbols
// ---------------------------------------------------------------------------

function primElement(p: SymbolPrim, key: number, mirror: boolean): ReactNode {
  switch (p.kind) {
    case 'line':
      return <line key={key} className="ms-sym" x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} style={p.width ? { strokeWidth: p.width } : undefined} />;
    case 'rect':
      return <rect key={key} className="ms-sym" x={p.x} y={p.y} width={p.w} height={p.h} rx={p.r} style={{ fill: resolveFill(p.fill) }} />;
    case 'circle':
      return <circle key={key} className="ms-sym" cx={p.cx} cy={p.cy} r={p.r} style={{ fill: resolveFill(p.fill) }} />;
    case 'arc':
      return <path key={key} className="ms-sym" d={arcPath(p.cx, p.cy, p.r, p.start, p.end)} />;
    case 'polyline':
      return p.closed ? (
        <polygon key={key} className="ms-sym" points={polylinePoints(p.points)} style={{ fill: resolveFill(p.fill) }} />
      ) : (
        <polyline key={key} className="ms-sym" points={polylinePoints(p.points)} style={{ fill: resolveFill(p.fill) }} />
      );
    case 'path':
      return <path key={key} className="ms-sym" d={p.d} style={{ fill: resolveFill(p.fill) }} />;
    case 'text': {
      // non-upright text rotates with the body; un-mirror the glyphs so they stay readable
      const anchor: TextAnchor = p.anchor ?? 'start';
      const a: TextAnchor = mirror ? (anchor === 'start' ? 'end' : anchor === 'end' ? 'start' : 'middle') : anchor;
      return (
        <text
          key={key}
          className="ms-sym-text"
          transform={`translate(${p.x} ${p.y})${mirror ? ' scale(-1 1)' : ''}`}
          textAnchor={a}
          fontSize={p.size ?? 10}
          fontWeight={p.bold ? 700 : undefined}
        >
          {p.text}
        </text>
      );
    }
  }
}

/** Upright texts of a symbol (prims + pin labels) in sheet coordinates. */
function uprightTexts(def: PartDef, o: Orientation): ReactNode[] {
  const out: ReactNode[] = [];
  def.symbol.prims.forEach((p, i) => {
    if (!isUprightText(p)) return;
    const t = uprightTextPlacement(p, o);
    out.push(
      <text key={`t${i}`} className="ms-sym-text" x={t.x} y={t.y} textAnchor={t.anchor} fontSize={p.size ?? 10} fontWeight={p.bold ? 700 : undefined}>
        {p.text}
      </text>,
    );
  });
  def.symbol.pins.forEach((pin, i) => {
    if (!pin.label) return;
    let lx = pin.x;
    let ly = pin.y;
    let anchor: TextAnchor = 'middle';
    switch (pin.dir) {
      case 'left':
        lx += PIN_LABEL_INSET;
        anchor = 'start';
        break;
      case 'right':
        lx -= PIN_LABEL_INSET;
        anchor = 'end';
        break;
      case 'up':
        ly += PIN_LABEL_INSET + 2;
        break;
      case 'down':
        ly -= PIN_LABEL_INSET + 2;
        break;
      default:
        break;
    }
    const t = uprightTextPlacement({ x: lx, y: ly, anchor }, o);
    out.push(
      <text key={`p${i}`} className="ms-sym-text" x={t.x} y={t.y} textAnchor={t.anchor} fontSize={PIN_LABEL_SIZE}>
        {pin.label}
      </text>,
    );
  });
  return out;
}

/** Symbol body only (no refdes / value), in sheet coordinates. Used by the canvas and the browser preview. */
export function SymbolBody({ def, o }: { def: PartDef; o: Orientation }) {
  return (
    <>
      <g transform={partTransform(o)}>{def.symbol.prims.map((p, i) => (isUprightText(p) ? null : primElement(p, i, o.mirror)))}</g>
      {uprightTexts(def, o)}
    </>
  );
}

/**
 * State markers of a multi-control interactive part (DIP switch positions, keypad keys, rotary
 * switch contacts): a small dot at every control, filled while the control is on (closed /
 * pressed / selected).
 */
function ControlStates({ def, inst }: { def: PartDef; inst: PartInstance }) {
  const controls = def.interactive?.controls;
  if (!controls?.length) return null;
  const defaults = new Map(def.params.map((d) => [d.key, d.default]));
  return (
    <g className="ms-ctl-states" aria-hidden="true">
      {controls.map((c, i) => {
        const at = localToSheet(c.at, inst);
        const v = inst.params[c.param] ?? defaults.get(c.param);
        const on = c.value !== undefined ? v === c.value : controlIsOn(v);
        return <circle key={i} className={on ? 'ms-ctl is-on' : 'ms-ctl'} cx={at.x} cy={at.y} r={2.6} />;
      })}
    </g>
  );
}

/** Small crosses on the pins the learner marked "not connected" (PartInstance.ncPins). */
function NcMarks({ def, inst }: { def: PartDef; inst: PartInstance }) {
  const marks = inst.ncPins;
  if (!marks?.length) return null;
  const r = 3;
  return (
    <g className="ms-nc-marks" aria-hidden="true">
      {def.symbol.pins
        .filter((p) => marks.includes(p.name))
        .map((p) => {
          const at = localToSheet({ x: p.x, y: p.y }, inst);
          return (
            <g key={p.name} className="ms-nc-mark">
              <line x1={at.x - r} y1={at.y - r} x2={at.x + r} y2={at.y + r} />
              <line x1={at.x + r} y1={at.y - r} x2={at.x - r} y2={at.y + r} />
            </g>
          );
        })}
    </g>
  );
}

export interface PartGlyphProps {
  inst: PartInstance;
  def: PartDef | undefined;
  selected?: boolean;
  /** indicator brightness (> 0 glows) */
  level?: number;
  /** extra class (e.g. "ms-ghost") */
  className?: string;
  /** omit tooltip (ghost / export) */
  noTitle?: boolean;
  /** rated part that is hot or burnt out */
  rating?: RatingState;
  /** visible injected faults of the part (one-line summary, empty / undefined = none) */
  faults?: string;
  /** live slot values of multi-cell displays (LCD cells / status / CGRAM, dot-matrix rows) */
  cells?: number[];
  /** the instructor hides part values: the value label reads "?" */
  hideValue?: boolean;
}

/** Summary of the faults the editor may show for an instance (hidden auto faults stay hidden). */
export function faultSummary(inst: PartInstance, design: Pick<Design, 'autoFault'>): string | undefined {
  if (!inst.faults?.length) return undefined;
  const shown = visibleFaults(inst, design);
  return shown.length ? shown.map(describeFault).join('; ') : undefined;
}

/** One placed part: symbol, labels, indicator glow and tooltip. */
export const PartGlyph = memo(function PartGlyph({ inst, def, selected, level, className, noTitle, rating, faults, cells, hideValue }: PartGlyphProps) {
  const labels = partLabelLayout(inst, def, hideValue);
  const box = partBox(inst, def);
  // segment displays and bar graphs receive the lit mask as their level: draw the segments / bars
  // instead of a glow; LCDs and dot matrices draw their screen from the cell values
  const kind = def?.indicator?.kind;
  const masked = level !== undefined && level >= 1 && Number.isInteger(level);
  const segments = (kind === 'seven-seg' || kind === 'alnum') && masked;
  const bars = kind === 'bargraph' && masked;
  const screen = (kind === 'lcd' || kind === 'matrix') && cells !== undefined;
  const machine = kind === 'mecha' && cells !== undefined;
  const probeLit = kind === 'probe' && !!def?.indicator?.color && level !== undefined && level > 0;
  const glow = !segments && !bars && !screen && !probeLit && kind !== 'lcd' && kind !== 'matrix' && kind !== 'mecha' && level !== undefined && level > 0 ? Math.min(1, level) : 0;
  const blown = rating?.state === 'blown';
  const annotation = def ? asLibraryPart(def).annotation !== undefined : false;
  const cls = `ms-part${selected ? ' is-selected' : ''}${inst.excludeFromSim ? ' is-excluded' : ''}${annotation ? ' is-annotation' : ''}${blown ? ' is-blown' : rating ? ' is-hot' : ''}${className ? ` ${className}` : ''}`;
  const ratingText = rating ? (blown ? t('rating.marker.blown', { refdes: inst.refdes }) : t('rating.marker.hot', { refdes: inst.refdes, pct: Math.round(rating.pct) })) : '';
  return (
    <g className={cls} data-part-id={inst.id}>
      {!noTitle ? (
        <title>
          {[def ? `${inst.refdes} — ${partName(def)}: ${partDescription(def)}` : t('editor.scene.refdesUnknownPartPartid', { refdes: inst.refdes, partId: inst.partId }), ratingText, faults ? t('fault.marker', { refdes: inst.refdes, list: faults }) : '']
            .filter(Boolean)
            .join(String.fromCharCode(10))}
        </title>
      ) : null}
      {glow > 0 ? (
        <circle
          className="ms-glow"
          cx={box.x + box.w / 2}
          cy={box.y + box.h / 2}
          r={Math.min(Math.max(box.w, box.h) / 2 + 8, 34)}
          fill="url(#ms-glow-grad)"
          opacity={0.35 + 0.65 * glow}
        />
      ) : null}
      {def ? (
        <>
          <SymbolBody def={def} o={inst} />
          {segments ? <LitSegments def={def} o={inst} mask={level} /> : null}
          {bars ? <LitBars def={def} o={inst} mask={level} /> : null}
          {screen && kind === 'lcd' ? <LcdScreen def={def} o={inst} cells={cells} /> : null}
          {screen && kind === 'matrix' ? <MatrixDots def={def} o={inst} cells={cells} /> : null}
          {machine ? <MechaGlyph def={def} o={inst} cells={cells} /> : null}
          {probeLit ? <ProbeLight def={def} o={inst} /> : null}
          <ControlStates def={def} inst={inst} />
          <NcMarks def={def} inst={inst} />
        </>
      ) : (
        <>
          <rect className="ms-part-unknown" x={box.x} y={box.y} width={box.w} height={box.h} />
          <text className="ms-sym-text" x={inst.x} y={inst.y} textAnchor="middle" fontSize={14}>
            ?
          </text>
        </>
      )}
      {labels.map((l) =>
        l.visible ? (
          <text key={l.which} className="ms-part-label" x={l.x} y={l.y} textAnchor={l.anchor} data-label={l.which}>
            {l.text}
          </text>
        ) : null,
      )}
      {rating ? (
        blown ? (
          <g className="ms-blown-mark" aria-hidden="true">
            <line x1={box.x} y1={box.y} x2={box.x + box.w} y2={box.y + box.h} />
            <line x1={box.x + box.w} y1={box.y} x2={box.x} y2={box.y + box.h} />
          </g>
        ) : (
          <rect className="ms-hot-mark" x={box.x - 3} y={box.y - 3} width={box.w + 6} height={box.h + 6} rx={4} aria-hidden="true" />
        )
      ) : null}
      {faults ? (
        <g className="ms-fault-badge" aria-hidden="true">
          <circle cx={box.x + box.w + 2} cy={box.y - 2} r={6} />
          <text x={box.x + box.w + 2} y={box.y + 1.5} textAnchor="middle" fontSize={8}>
            !
          </text>
        </g>
      ) : null}
    </g>
  );
});

// ---------------------------------------------------------------------------
// wires, labels, probes, notes
// ---------------------------------------------------------------------------

export const WireGlyph = memo(function WireGlyph({ wire, selected, net }: { wire: Wire; selected?: boolean; net?: string }) {
  const tip = wire.bus ? t('schematic.scene.busTip', { name: wire.busName?.trim() || t('schematic.scene.unnamedBus') }) : net ? t('editor.scene.netNet', { net: net }) : '';
  return (
    <polyline
      className={`${wire.bus ? 'ms-bus' : 'ms-wire'}${selected ? ' is-selected' : ''}${wire.locked ? ' is-locked' : ''}`}
      points={wire.points.map((p) => `${p.x},${p.y}`).join(' ')}
      style={wire.color ? { stroke: wire.color } : undefined}
      data-wire-id={wire.id}
    >
      {tip ? <title>{tip}</title> : null}
    </polyline>
  );
});

/** Tooltip of a label / connector (what it is and how far its name reaches). */
function labelTip(label: NetLabel): string {
  switch (label.kind ?? 'label') {
    case 'offpage':
      return t('schematic.scene.offpageTip', { name: label.name });
    case 'hier':
      return t('schematic.scene.hierTip', { name: label.name });
    case 'global':
      return t('schematic.scene.globalTip', { name: label.name });
    case 'bus-entry':
      return t('schematic.scene.entryTip', { name: label.name });
    default:
      return label.global ? t('schematic.scene.globalLabelTip', { name: label.name }) : t('schematic.scene.localLabelTip', { name: label.name });
  }
}

export const NetLabelGlyph = memo(function NetLabelGlyph({ label, selected }: { label: NetLabel; selected?: boolean }) {
  const lay = netLabelLayout(label);
  const kind = label.kind ?? 'label';
  const cls = `ms-netlabel ms-netlabel-${kind}${label.global ? ' is-global' : ''}${selected ? ' is-selected' : ''}`;
  return (
    <g className={cls} data-label-id={label.id}>
      <title>{labelTip(label)}</title>
      {lay.flag ? (
        <>
          {lay.stem ? <line className="ms-netlabel-mark" x1={lay.stem[0].x} y1={lay.stem[0].y} x2={lay.stem[1].x} y2={lay.stem[1].y} /> : null}
          <polygon className="ms-connector" points={lay.flag.map((p) => `${p.x},${p.y}`).join(' ')} />
          {kind === 'global' ? <circle className="ms-connector-dot" cx={label.x} cy={label.y} r={2.5} /> : null}
          <text className="ms-connector-text" x={lay.tx} y={lay.ty} textAnchor="middle">
            {label.name}
          </text>
        </>
      ) : lay.entry ? (
        <>
          <line className="ms-bus-entry" x1={lay.entry[0].x} y1={lay.entry[0].y} x2={lay.entry[1].x} y2={lay.entry[1].y} />
          <text className="ms-bus-entry-text" x={lay.tx} y={lay.ty} textAnchor="start">
            {label.name}
          </text>
        </>
      ) : (
        <>
          <path className="ms-netlabel-mark" d={`M${label.x - 3} ${label.y}L${label.x} ${label.y - 3}L${label.x + 3} ${label.y}L${label.x} ${label.y + 3}Z`} />
          <text x={lay.tx} y={lay.ty} textAnchor={lay.anchor}>
            {label.name}
          </text>
        </>
      )}
    </g>
  );
});

/** Junction dots of the bus layer (where three or more bus segments meet). */
export function busJunctions(sheet: Sheet): Point[] {
  const buses = sheet.wires.filter((w) => w.bus);
  return buses.length ? junctionPoints(buses, []) : [];
}

const DASH: Record<NonNullable<Shape['dash']>, string | undefined> = { solid: undefined, dash: '8 4', dot: '2 3' };

/** Path of an elliptical arc inside the box of two corner points (angles clockwise from +x). */
function ellipseArcPath(a: Point, b: Point, start: number, end: number): string {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  const rad = (d: number) => (d * Math.PI) / 180;
  const sweep = (((end - start) % 360) + 360) % 360 || 360;
  const p0 = { x: cx + rx * Math.cos(rad(start)), y: cy + ry * Math.sin(rad(start)) };
  const p1 = { x: cx + rx * Math.cos(rad(start + sweep)), y: cy + ry * Math.sin(rad(start + sweep)) };
  if (sweep >= 359.99) return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}`;
  return `M${p0.x} ${p0.y}A${rx} ${ry} 0 ${sweep > 180 ? 1 : 0} 1 ${p1.x} ${p1.y}`;
}

/** Graphic annotation (line, polyline, rectangle, ellipse, arc, polygon, picture). */
export const ShapeGlyph = memo(function ShapeGlyph({ shape, selected }: { shape: Shape; selected?: boolean }) {
  const pts = shape.points;
  const style = {
    stroke: shape.stroke || undefined,
    strokeWidth: shape.strokeWidth ?? undefined,
    strokeDasharray: shape.dash ? DASH[shape.dash] : undefined,
    fill: shape.fill || 'none',
  };
  const cls = `ms-shape${selected ? ' is-selected' : ''}${shape.locked ? ' is-locked' : ''}`;
  const [a, b] = [pts[0] ?? { x: 0, y: 0 }, pts[1] ?? pts[0] ?? { x: 0, y: 0 }];
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  let body: ReactNode;
  switch (shape.kind) {
    case 'line':
    case 'polyline':
      body = <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} style={{ ...style, fill: 'none' }} />;
      break;
    case 'polygon':
      body = <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} style={style} />;
      break;
    case 'rect':
      body = <rect x={x} y={y} width={w} height={h} style={style} />;
      break;
    case 'ellipse':
      body = <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} style={style} />;
      break;
    case 'arc':
      body = <path d={ellipseArcPath(a, b, shape.start ?? 0, shape.end ?? 180)} style={{ ...style, fill: 'none' }} />;
      break;
    case 'picture':
      body = shape.src ? <image href={shape.src} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid meet" /> : <rect x={x} y={y} width={w} height={h} style={style} />;
      break;
  }
  return (
    <g className={cls} data-shape-id={shape.id}>
      {body}
      {selected ? <rect className="ms-note-box" x={x - 3} y={y - 3} width={w + 6} height={h + 6} /> : null}
    </g>
  );
});

export const ProbeGlyph = memo(function ProbeGlyph({ probe, selected, value }: { probe: Probe; selected?: boolean; value?: string }) {
  const lay = probeLayout(probe);
  const lines = value ? value.split('\n') : [];
  const tag = `${PROBE_KIND_TAG[probe.kind]} ${probe.name}`;
  return (
    <g className={`ms-probe${selected ? ' is-selected' : ''}`} data-probe-id={probe.id}>
      <title>{t('editor.scene.probeTitle', { kind: t(`probe.kind.${probe.kind}`), name: probe.name }) + (value ? `\n${value}` : '')}</title>
      {probe.kind === 'differential' && probe.ref ? (
        <>
          <line className="ms-probe-ref" x1={probe.x} y1={probe.y} x2={probe.ref.x} y2={probe.ref.y} style={{ stroke: probe.color }} />
          <circle cx={probe.ref.x} cy={probe.ref.y} r={3} fill="none" stroke={probe.color} strokeWidth={1.2} />
          <text x={probe.ref.x + 5} y={probe.ref.y + 8} fontSize={9} fill={probe.color}>
            {t('editor.scene.ref')}
          </text>
        </>
      ) : null}
      <polyline className="ms-probe-lead" points={`${probe.x},${probe.y} ${lay.flag.x},${lay.flag.y + lay.flag.h}`} style={{ stroke: probe.color }} />
      <circle className="ms-probe-dot" cx={probe.x} cy={probe.y} r={3} style={{ fill: probe.color }} />
      <rect className="ms-probe-flag" x={lay.flag.x} y={lay.flag.y} width={lay.flag.w} height={lay.flag.h} rx={3} style={{ fill: probe.color }} />
      <text className="ms-probe-flag-text" x={lay.flag.x + 5} y={lay.flag.y + lay.flag.h / 2}>
        {tag}
      </text>
      {lines.map((ln, i) => (
        <text key={i} className="ms-probe-value" x={lay.valueAt.x} y={lay.valueAt.y + 6 + i * 12}>
          {ln}
        </text>
      ))}
    </g>
  );
});

const FONT_FAMILY: Record<NonNullable<NonNullable<TextNote['style']>['font']>, string> = {
  sans: "var(--font, 'Segoe UI', sans-serif)",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "var(--mono, Consolas, monospace)",
};

/** Text note (with font / colour style) or sticky comment (collapsible to its pin). */
export const NoteGlyph = memo(function NoteGlyph({ note, selected }: { note: TextNote; selected?: boolean }) {
  const size = note.size ?? NOTE_DEFAULT_SIZE;
  const lines = note.text.split('\n');
  const st = note.style;
  const box = noteBox(note);
  if (note.comment) {
    const pin = <path className="ms-comment-pin" d={`M${note.x} ${note.y}l-6 -12a6 6 0 1 1 12 0z`} />;
    const head = [note.author, note.created ? note.created.slice(0, 10) : ''].filter(Boolean).join(' · ');
    return (
      <g className={`ms-note ms-comment${note.collapsed ? ' is-collapsed' : ''}${selected ? ' is-selected' : ''}`} data-note-id={note.id}>
        <title>{t('schematic.scene.commentTip', { text: note.text, who: head })}</title>
        {note.collapsed ? (
          pin
        ) : (
          <>
            <rect className="ms-comment-box" x={note.x} y={note.y} width={box.w + 12} height={box.h + (head ? 18 : 8)} rx={3} />
            {head ? (
              <text className="ms-comment-head" x={note.x + 6} y={note.y + 8} fontSize={9}>
                {head}
              </text>
            ) : null}
            <text fontSize={size}>
              {lines.map((ln, i) => (
                <tspan key={i} x={note.x + 6} y={note.y + (head ? 14 : 4) + size * 1.3 * (i + 0.5)}>
                  {ln || ' '}
                </tspan>
              ))}
            </text>
            {pin}
          </>
        )}
      </g>
    );
  }
  const anchor = st?.align ?? 'start';
  const ax = anchor === 'middle' ? note.x + box.w / 2 : anchor === 'end' ? note.x + box.w : note.x;
  return (
    <g className={`ms-note${selected ? ' is-selected' : ''}`} data-note-id={note.id}>
      {selected ? <rect className="ms-note-box" x={note.x - 2} y={note.y - 2} width={Math.max(size, ...lines.map((l) => l.length * size * 0.6)) + 4} height={lines.length * size * 1.3 + 4} /> : null}
      <text
        fontSize={size}
        textAnchor={anchor}
        style={
          st
            ? {
                fontFamily: st.font ? FONT_FAMILY[st.font] : undefined,
                fontWeight: st.bold ? 700 : undefined,
                fontStyle: st.italic ? 'italic' : undefined,
                textDecoration: st.underline ? 'underline' : undefined,
                fill: st.color && !selected ? st.color : undefined,
              }
            : undefined
        }
      >
        {lines.map((ln, i) => (
          <tspan key={i} x={ax} y={note.y + size * 1.3 * (i + 0.5)}>
            {ln || ' '}
          </tspan>
        ))}
      </text>
    </g>
  );
});

// ---------------------------------------------------------------------------
// ERC markers
// ---------------------------------------------------------------------------

/** Sheet position of an ERC message, or null when it cannot be located on `sheet`. */
export function ercMarkerPosition(m: ErcMessage, sheet: Sheet, lookup: PartLookup): Point | null {
  if (m.sheetId && m.sheetId !== sheet.id) return null;
  if (m.x !== undefined && m.y !== undefined) return m.sheetId || !m.refdes || sheet.parts.some((p) => p.refdes === m.refdes) ? { x: m.x, y: m.y } : null;
  if (!m.refdes) return null;
  const inst = sheet.parts.find((p) => p.refdes.toUpperCase() === m.refdes!.toUpperCase());
  if (!inst) return null;
  const def = lookup(inst.partId);
  if (def && m.pin) {
    const pin = instancePins(inst, def).find((p) => p.name === m.pin);
    if (pin) return { x: pin.x, y: pin.y };
  }
  const b = partBox(inst, def);
  return { x: b.x, y: b.y };
}

/** Marker tooltip: severity, what is wrong and how to fix it (current language). */
function ercTooltip(m: ErcMessage): string {
  const e = explainErc(m);
  return `${m.severity === 'error' ? t('editor.scene.error') : t('editor.scene.warning')}: ${e.title}
${t('erc.fix')}: ${e.fix}`;
}

export function ErcMarkers({ markers, sheet, lookup }: { markers: ErcMessage[]; sheet: Sheet; lookup: PartLookup }) {
  const placed = markers
    .map((m, i) => ({ m, i, p: ercMarkerPosition(m, sheet, lookup) }))
    .filter((e): e is { m: ErcMessage; i: number; p: Point } => e.p !== null);
  return (
    <g className="ms-erc">
      {placed.map(({ m, i, p }) => (
        <g key={i} transform={`translate(${p.x} ${p.y})`}>
          <title>{ercTooltip(m)}</title>
          {m.severity === 'error' ? <circle className="ms-erc-error" cx={7} cy={-7} r={6} /> : <path className="ms-erc-warning" d="M7 -14L14 -1L0 -1Z" />}
          <text className="ms-erc-glyph" x={7} y={m.severity === 'error' ? -7 : -5}>
            !
          </text>
        </g>
      ))}
    </g>
  );
}

// ---------------------------------------------------------------------------
// page frame
// ---------------------------------------------------------------------------

/** Date used for automatic title-block dates (tests may pin it). */
let titleBlockNow: () => Date = () => new Date();
export function setTitleBlockClock(fn: () => Date): void {
  titleBlockNow = fn;
}

/**
 * Sheet frame: border (from the sheet's paper settings) and title block. Designs without v2
 * title-block fields keep the compact version-1 block (title, sheet, page n of m); with fields
 * the block also shows description, company, designed / checked / approved by, document number,
 * revision and the date (today's date when the field is empty).
 */
export function PageFrame({ design, sheet }: { design: Design; sheet: Sheet }) {
  const frame = sheetFrame(sheet.props);
  const loc = findSheet(design, sheet.id);
  const level = loc?.child ? loc.child.sheets : design.sheets;
  const v = titleBlockValues(design, sheet, level, titleBlockNow(), localeTag());
  const title = loc?.child ? `${v.title} — ${loc.child.name}` : v.title;
  if (!design.titleBlock) {
    const tb = { x: frame.w - TITLE_BLOCK.w - 10, y: frame.h - TITLE_BLOCK.h - 10 };
    return (
      <g className="ms-page" aria-hidden="true">
        {frame.border ? <rect className="ms-page-border" x={0} y={0} width={frame.w} height={frame.h} /> : null}
        {frame.titleBlock ? (
          <g className="ms-titleblock">
            <rect x={tb.x} y={tb.y} width={TITLE_BLOCK.w} height={TITLE_BLOCK.h} />
            <line x1={tb.x} y1={tb.y + 36} x2={tb.x + TITLE_BLOCK.w} y2={tb.y + 36} />
            <line x1={tb.x + 200} y1={tb.y + 36} x2={tb.x + 200} y2={tb.y + TITLE_BLOCK.h} />
            <text x={tb.x + 8} y={tb.y + 10}>
              {t('editor.scene.title')}
            </text>
            <text className="ms-tb-title" x={tb.x + 8} y={tb.y + 24}>
              {title}
            </text>
            <text x={tb.x + 8} y={tb.y + 44}>
              {t('editor.scene.sheet')}
            </text>
            <text x={tb.x + 8} y={tb.y + 55}>
              {sheet.name}
            </text>
            <text x={tb.x + 208} y={tb.y + 44}>
              {t('editor.scene.page')}
            </text>
            <text x={tb.x + 208} y={tb.y + 55}>{t('editor.scene.indexOfLength', { index: v.sheetNumber, length: v.sheetCount })}</text>
          </g>
        ) : null}
      </g>
    );
  }
  const W = TITLE_BLOCK_FULL.w;
  const H = TITLE_BLOCK_FULL.h;
  const tb = { x: frame.w - W - 10, y: frame.h - H - 10 };
  const cell = (x: number, y: number, label: string, value: string, key: string) => (
    <g key={key}>
      <text x={tb.x + x + 5} y={tb.y + y + 7}>
        {label}
      </text>
      <text className="ms-tb-value" x={tb.x + x + 5} y={tb.y + y + 18}>
        {value}
      </text>
    </g>
  );
  return (
    <g className="ms-page" aria-hidden="true">
      {frame.border ? <rect className="ms-page-border" x={0} y={0} width={frame.w} height={frame.h} /> : null}
      {frame.titleBlock ? (
        <g className="ms-titleblock">
          <rect x={tb.x} y={tb.y} width={W} height={H} />
          <line x1={tb.x} y1={tb.y + 34} x2={tb.x + W} y2={tb.y + 34} />
          <line x1={tb.x} y1={tb.y + 65} x2={tb.x + W} y2={tb.y + 65} />
          <line x1={tb.x + 127} y1={tb.y + 34} x2={tb.x + 127} y2={tb.y + H} />
          <line x1={tb.x + 254} y1={tb.y + 34} x2={tb.x + 254} y2={tb.y + H} />
          <line x1={tb.x + 254} y1={tb.y} x2={tb.x + 254} y2={tb.y + 34} />
          <text x={tb.x + 5} y={tb.y + 8}>
            {v.company || t('editor.scene.title')}
          </text>
          <text className="ms-tb-title" x={tb.x + 5} y={tb.y + 22}>
            {title}
          </text>
          {v.description ? (
            <text x={tb.x + 5} y={tb.y + 31}>
              {v.description}
            </text>
          ) : null}
          {cell(254, 0, t('schematic.tb.documentNo'), v.documentNo, 'doc')}
          {cell(0, 34, t('schematic.tb.designedBy'), v.designedBy, 'des')}
          {cell(127, 34, t('schematic.tb.checkedBy'), v.checkedBy, 'chk')}
          {cell(254, 34, t('schematic.tb.approvedBy'), v.approvedBy, 'apr')}
          {cell(0, 65, t('schematic.tb.date'), v.date, 'date')}
          {cell(127, 65, t('schematic.tb.revision'), v.revision, 'rev')}
          {cell(254, 65, t('editor.scene.page'), t('editor.scene.indexOfLength', { index: v.sheetNumber, length: v.sheetCount }), 'page')}
        </g>
      ) : null}
    </g>
  );
}

// ---------------------------------------------------------------------------
// full sheet
// ---------------------------------------------------------------------------

export interface SheetSceneProps {
  design: Design;
  sheet: Sheet;
  lookup: PartLookup;
  /** keys from {@link selKey} */
  selected?: ReadonlySet<string>;
  indicatorLevels?: Record<string, number>;
  /** rated parts: hot / burnt-out marks by refdes */
  ratingStates?: Record<string, RatingState>;
  probeValues?: Record<string, string>;
  ercMarkers?: ErcMessage[];
  /** wire id -> net name (tooltips) */
  wireNets?: Map<string, string>;
  showPage?: boolean;
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Defs shared by scene elements (glow gradient). Render once per <svg>. */
export function SceneDefs() {
  return (
    <radialGradient id="ms-glow-grad">
      <stop offset="0" style={{ stopColor: 'var(--glow)', stopOpacity: 0.95 }} />
      <stop offset="0.55" style={{ stopColor: 'var(--glow)', stopOpacity: 0.45 }} />
      <stop offset="1" style={{ stopColor: 'var(--glow)', stopOpacity: 0 }} />
    </radialGradient>
  );
}

export function SheetScene({ design, sheet, lookup, selected = EMPTY_SET, indicatorLevels, ratingStates, probeValues, ercMarkers, wireNets, showPage = true }: SheetSceneProps) {
  const junctions = useMemo(() => junctionPoints(sheet.wires.some((w) => w.bus) ? sheet.wires.filter((w) => !w.bus) : sheet.wires, sheetPins(sheet, lookup)), [sheet, lookup]);
  const busDots = useMemo(() => busJunctions(sheet), [sheet]);
  const colors = sheetColorVars(sheet.props?.colors);
  const hideValues = valuesHidden(design);
  // parts the active design variant does not fit are drawn dimmed
  const variantId = activeVariant(design)?.id;
  return (
    <g className="ms-scene" style={Object.keys(colors).length ? (colors as React.CSSProperties) : undefined}>
      {showPage ? <PageFrame design={design} sheet={sheet} /> : null}
      {sheet.shapes?.length ? (
        <g className="ms-layer-shapes">
          {sheet.shapes.map((x) => (
            <ShapeGlyph key={x.id} shape={x} selected={selected.has(selKey('shape', x.id))} />
          ))}
        </g>
      ) : null}
      <g className="ms-layer-notes">
        {sheet.notes.map((n) => (
          <NoteGlyph key={n.id} note={n} selected={selected.has(selKey('note', n.id))} />
        ))}
      </g>
      <g className="ms-layer-parts">
        {sheet.parts.map((p) => (
          <PartGlyph key={p.id} inst={p} def={lookup(p.partId)} selected={selected.has(selKey('part', p.id))} level={indicatorLevels?.[p.refdes]} rating={ratingStates?.[p.refdes]} faults={faultSummary(p, design)} cells={displayCells(lookup(p.partId), p.refdes, indicatorLevels)} hideValue={hideValues} className={variantId && !isFitted(p, variantId) ? 'is-not-fitted' : undefined} />
        ))}
      </g>
      <g className="ms-layer-wires">
        {sheet.wires.map((w) => (
          <WireGlyph key={w.id} wire={w} selected={selected.has(selKey('wire', w.id))} net={wireNets?.get(w.id)} />
        ))}
      </g>
      <g className="ms-layer-junctions">
        {junctions.map((j) => (
          <circle key={`${j.x}:${j.y}`} className="ms-junction" cx={j.x} cy={j.y} r={3} />
        ))}
        {busDots.map((j) => (
          <circle key={`b${j.x}:${j.y}`} className="ms-bus-junction" cx={j.x} cy={j.y} r={4.5} />
        ))}
      </g>
      <g className="ms-layer-labels">
        {sheet.labels.map((l) => (
          <NetLabelGlyph key={l.id} label={l} selected={selected.has(selKey('label', l.id))} />
        ))}
      </g>
      <g className="ms-layer-probes">
        {sheet.probes.map((p) => (
          <ProbeGlyph key={p.id} probe={p} selected={selected.has(selKey('probe', p.id))} value={probeValues?.[p.id]} />
        ))}
      </g>
      {ercMarkers && ercMarkers.length ? <ErcMarkers markers={ercMarkers} sheet={sheet} lookup={lookup} /> : null}
    </g>
  );
}
