/**
 * Interactive SVG schematic canvas: grid, page frame, scene, overlay (ghost part, wire preview,
 * rubber band, pin targets, selection boxes) and all pointer handling.
 *
 * - Wheel zooms at the cursor (Shift+wheel pans horizontally); middle-drag or Space+drag pans.
 * - Pointer input is converted to sheet coordinates and forwarded to the CanvasInteraction
 *   controller (see interaction.ts) which implements the tools.
 * - Library parts can be dropped from the component browser (drag & drop).
 */
import { layerVisible } from '../../model/layers';
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { defaultParams, libraryVersion, subscribeLibrary } from '../../library';
import type { PartInstance, Point } from '../../model/types';
import { GRID } from '../../model/types';
import { findSheet } from '../../model/hierarchy';
import { sheetColorVars } from '../../model/paper';
import { actions, getState, partLookup, setCursor, useEditor } from '../store';
import { computeConnectivity } from '../store/connectivity';
import { getSheet, sheetPins } from '../store/designOps';
import { partBox, probeLayout, rectFromPoints } from '../store/shapes';
import type { ToolState } from '../store/types';
import { DEFAULT_VIEW, screenToSheet, visibleRect } from '../store/viewport';
import { canvasFileDrop, interaction, PART_DRAG_MIME, setCanvasFocusHandler } from './controller';
import { describeHit, type Overlay, type PointerInput } from './interaction';
import { PartGlyph, SceneDefs, SheetScene, selKey } from './scene';
import { ensureSceneStyles } from './sceneStyle';
import './editor.css';
import { lazyRecord, t } from '../../i18n';

/** Status hints of the tools (current language). */
const TOOL_HINTS: Readonly<Record<ToolState['kind'], string>> = lazyRecord(['select', 'place', 'wire', 'label', 'probe', 'text', 'bus', 'shape', 'comment', 'capture'], (k) => t(`editor.toolHint.${k}`));

function toolHint(tool: ToolState, overlay: Overlay): string {
  if (tool.kind === 'probe' && tool.probeKind === 'differential') {
    return overlay.probeRef ? t('editor.schematicCanvas.differentialProbeClickTheReference') : t('editor.schematicCanvas.differentialProbeClickTheMeasured');
  }
  if (tool.kind === 'label' && tool.labelKind && tool.labelKind !== 'label') return t(`schematic.hint.${tool.labelKind === 'bus-entry' ? 'busEntry' : tool.labelKind}`);
  if (tool.kind === 'shape') return tool.shapeKind === 'polyline' || tool.shapeKind === 'polygon' ? t('schematic.hint.points') : tool.shapeKind === 'picture' ? t('schematic.hint.picture') : TOOL_HINTS.shape;
  if (overlay.wire && tool.kind !== 'wire' && tool.kind !== 'bus') return TOOL_HINTS.wire;
  return TOOL_HINTS[tool.kind];
}

/** Outline of the shape being drawn (shape tool). */
function ShapeDraftGlyph({ draft, px }: { draft: NonNullable<Overlay['shape']>; px: number }) {
  const pts = [...draft.points, draft.preview];
  const a = draft.points[0];
  const b = draft.preview;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  const style = { strokeWidth: 1.2 * px };
  switch (draft.kind) {
    case 'rect':
    case 'picture':
      return <rect className="ms-shape-draft" x={x} y={y} width={w} height={h} style={style} />;
    case 'ellipse':
    case 'arc':
      return <ellipse className="ms-shape-draft" cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} style={style} />;
    case 'polygon':
      return <polygon className="ms-shape-draft" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} style={style} />;
    default:
      return <polyline className="ms-shape-draft" points={pts.map((p) => `${p.x},${p.y}`).join(' ')} style={style} />;
  }
}

/** Overlay drawn above the scene (sheet coordinates). */
const OverlayLayer = memo(function OverlayLayer({ overlay, tool, pins, zoom }: { overlay: Overlay; tool: ToolState; pins: Point[]; zoom: number }) {
  const ghostInst: PartInstance | null = useMemo(() => {
    const g = overlay.ghost;
    if (!g) return null;
    const def = partLookup(g.partId);
    return { id: 'ghost', partId: g.partId, refdes: `${def?.prefix ?? 'U'}?`, x: g.x, y: g.y, rotation: g.rotation, mirror: g.mirror, params: def ? defaultParams(def) : {} };
  }, [overlay.ghost]);
  const showPins = tool.kind === 'wire' || tool.kind === 'bus' || overlay.wire !== null || tool.kind === 'probe' || tool.kind === 'label';
  const px = 1 / zoom;
  return (
    <g className="ms-scene ms-overlay">
      {showPins
        ? pins.map((p, i) => <rect key={i} className="ms-pin-mark" x={p.x - 2.5} y={p.y - 2.5} width={5} height={5} style={{ strokeWidth: px }} />)
        : null}
      {ghostInst ? <PartGlyph inst={ghostInst} def={partLookup(ghostInst.partId)} className="ms-ghost" noTitle /> : null}
      {overlay.wire ? (
        <>
          <polyline className={overlay.wire.bus ? 'ms-wire-draft ms-bus-draft' : 'ms-wire-draft'} points={overlay.wire.preview.map((p) => `${p.x},${p.y}`).join(' ')} />
          {overlay.wire.points.map((p, i) => (
            <rect key={i} className="ms-wire-corner" x={p.x - 2} y={p.y - 2} width={4} height={4} />
          ))}
        </>
      ) : null}
      {overlay.target && overlay.target.kind !== 'point' && (tool.kind !== 'select' || overlay.wire || overlay.target.kind === 'pin') ? (
        <circle className={`ms-target ms-target-${overlay.target.kind}`} cx={overlay.target.x} cy={overlay.target.y} r={6} style={{ strokeWidth: 1.5 * px }} />
      ) : null}
      {overlay.cursor && (tool.kind === 'wire' || tool.kind === 'text' || overlay.wire) && (!overlay.target || overlay.target.kind === 'point') ? (
        <path className="ms-crosshair" d={`M${overlay.cursor.x - 5} ${overlay.cursor.y}h10M${overlay.cursor.x} ${overlay.cursor.y - 5}v10`} style={{ strokeWidth: px }} />
      ) : null}
      {overlay.probeRef && overlay.cursor ? (
        <>
          <line className="ms-probe-draft" x1={overlay.probeRef.x} y1={overlay.probeRef.y} x2={overlay.cursor.x} y2={overlay.cursor.y} style={{ strokeWidth: px }} />
          <circle className="ms-target" cx={overlay.probeRef.x} cy={overlay.probeRef.y} r={4} />
        </>
      ) : null}
      {tool.kind === 'label' && overlay.cursor ? (
        <g className="ms-label-ghost" transform={`translate(${overlay.target?.x ?? overlay.cursor.x} ${overlay.target?.y ?? overlay.cursor.y}) rotate(${overlay.labelRotation})`}>
          <path d="M0 0h14" />
          <path d="M14 -4l5 4-5 4" />
        </g>
      ) : null}
      {overlay.shape ? <ShapeDraftGlyph draft={overlay.shape} px={px} /> : null}
      {overlay.band ? (
        <rect
          className={`ms-band ms-band-${overlay.band.mode}`}
          {...(() => {
            const r = rectFromPoints(overlay.band.a, overlay.band.b);
            return { x: r.x, y: r.y, width: r.w, height: r.h };
          })()}
          style={{ strokeWidth: px }}
        />
      ) : null}
    </g>
  );
});

/** Dashed boxes around selected parts and probes (on top of everything). */
const SelectionBoxes = memo(function SelectionBoxes({ sheet, selected, zoom }: { sheet: ReturnType<typeof getSheet>; selected: ReadonlySet<string>; zoom: number }) {
  if (!sheet || selected.size === 0) return null;
  const pad = 3;
  return (
    <g className="ms-selection-boxes">
      {sheet.parts
        .filter((p) => selected.has(selKey('part', p.id)))
        .map((p) => {
          const b = partBox(p, partLookup(p.partId));
          return <rect key={p.id} className="ms-sel-box" x={b.x - pad} y={b.y - pad} width={b.w + 2 * pad} height={b.h + 2 * pad} style={{ strokeWidth: 1 / zoom }} />;
        })}
      {sheet.probes
        .filter((p) => selected.has(selKey('probe', p.id)))
        .map((p) => {
          const b = probeLayout(p).box;
          return <rect key={p.id} className="ms-sel-box" x={b.x - pad} y={b.y - pad} width={b.w + 2 * pad} height={b.h + 2 * pad} style={{ strokeWidth: 1 / zoom }} />;
        })}
    </g>
  );
});

export function SchematicCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const design = useEditor((s) => s.design);
  const sheetId = useEditor((s) => s.activeSheetId);
  const selection = useEditor((s) => s.selection);
  const view = useEditor((s) => s.views[s.activeSheetId] ?? DEFAULT_VIEW);
  const tool = useEditor((s) => s.tool);
  const showGrid = useEditor((s) => s.showGrid);
  const showErc = useEditor((s) => s.showErc);
  const ercMarkers = useEditor((s) => s.ercMarkers);
  const indicatorLevels = useEditor((s) => s.indicatorLevels);
  const ratingStates = useEditor((s) => s.ratingStates);
  const probeValues = useEditor((s) => s.probeValues);
  const size = useEditor((s) => s.viewportSize);
  const overlay = useSyncExternalStore(interaction.overlay.subscribe, interaction.overlay.getState, interaction.overlay.getState);
  // a catalogue pack that finished loading (a part of the design waited for it) redraws the sheet
  const libVersion = useSyncExternalStore(subscribeLibrary, libraryVersion, libraryVersion);
  const [panning, setPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const pan = useRef<{ x: number; y: number; panX: number; panY: number; id: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const sheet = useMemo(() => getSheet(design, sheetId) ?? design.sheets[0], [design, sheetId]);
  const selected = useMemo(() => new Set(selection.map((it) => selKey(it.kind, it.id))), [selection]);
  const pins = useMemo(() => sheetPins(sheet, partLookup).map((p) => ({ x: p.x, y: p.y })), [sheet, libVersion]);
  const deferredDesign = useDeferredValue(design);
  const levelChild = useMemo(() => findSheet(design, sheet.id)?.child, [design, sheet]);
  const levelSheets = levelChild ? levelChild.sheets : design.sheets;
  const wireNets = useMemo(() => {
    // nets of the design level shown (a child design's sheets are a scope of their own)
    const child = findSheet(deferredDesign, sheetId)?.child;
    const c = computeConnectivity(child ? { ...deferredDesign, sheets: child.sheets } : deferredDesign, partLookup);
    const m = new Map<string, string>();
    for (const [wid, idx] of c.wireNet) m.set(wid, c.nets[idx].name);
    return m;
  }, [deferredDesign, sheetId, libVersion]);

  // let other UI (component browser, tool buttons) hand keyboard focus to the canvas
  useEffect(() => {
    ensureSceneStyles();
    setCanvasFocusHandler(() => svgRef.current?.focus({ preventScroll: true }));
    return () => setCanvasFocusHandler(null);
  }, []);

  // keep the store informed about the canvas size
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      actions.setViewportSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // wheel zoom needs a non-passive listener
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      const v = viewRef.current;
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (e.shiftKey && !e.ctrlKey) {
        actions.setView(getState().activeSheetId, { ...v, panX: v.panX - delta });
        return;
      }
      actions.zoomBy(Math.exp(-delta * 0.0015), at);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  // Space held = temporary pan mode
  useEffect(() => {
    const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      // Space pans unless an interactive part in the design is bound to it (switch keys)
      if (e.key === ' ' && !isField(e.target) && document.activeElement === svgRef.current && interaction.interactiveTargets(' ').length === 0) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const input = (e: React.PointerEvent | React.MouseEvent | React.DragEvent): PointerInput => {
    const v = viewRef.current;
    const p = screenToSheet(v, local(e));
    return { x: p.x, y: p.y, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, zoom: v.zoom, clientX: e.clientX, clientY: e.clientY };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    svgRef.current?.focus({ preventScroll: true });
    if (e.button === 1 || (e.button === 0 && spaceHeld)) {
      e.preventDefault();
      const v = viewRef.current;
      pan.current = { x: e.clientX, y: e.clientY, panX: v.panX, panY: v.panY, id: e.pointerId };
      e.currentTarget.setPointerCapture(e.pointerId);
      setPanning(true);
      return;
    }
    if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId);
    interaction.pointerDown(input(e));
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pan.current;
    if (p) {
      actions.setView(getState().activeSheetId, { ...viewRef.current, panX: p.panX + e.clientX - p.x, panY: p.panY + e.clientY - p.y });
      return;
    }
    const inp = input(e);
    interaction.pointerMove(inp);
    const o = interaction.overlay.getState();
    setCursor(o.cursor, describeHit(o.hover, sheet, partLookup));
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pan.current) {
      pan.current = null;
      setPanning(false);
      return;
    }
    interaction.pointerUp(input(e));
  };

  const vis = visibleRect(view, size);
  const minorGrid = view.zoom >= 0.6;
  const cursorClass = panning ? 'is-panning' : spaceHeld ? 'is-pan-ready' : `tool-${tool.kind}`;
  const sheetIndex = levelSheets.findIndex((s) => s.id === sheet.id) + 1;
  const colorVars = sheetColorVars(sheet.props?.colors);
  const lineGrid = sheet.props?.grid === 'lines';

  return (
    <div className="ms-canvas-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`ms-canvas ${cursorClass}`}
        tabIndex={0}
        role="application"
        aria-roledescription={t('editor.schematicCanvas.schematicEditor')}
        aria-label={t('editor.schematicCanvas.schematicNameSheetSheetindexOf', { name: levelChild ? `${levelChild.name} / ${sheet.name}` : sheet.name, sheetIndex: sheetIndex, length: levelSheets.length, length2: sheet.parts.length, length3: sheet.wires.length, toolHint: toolHint(tool, overlay) })}
        style={Object.keys(colorVars).length ? (colorVars as React.CSSProperties) : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          if (!pan.current) {
            interaction.pointerLeave();
            setCursor(null);
          }
        }}
        onDoubleClick={(e) => interaction.doubleClick(input(e))}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(PART_DRAG_MIME) || (canvasFileDrop.current && e.dataTransfer.types.includes('Files'))) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(PART_DRAG_MIME);
          if (!id) {
            // snippet pictures / design files dropped from the file manager
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length && canvasFileDrop.current) {
              const p = input(e);
              if (canvasFileDrop.current(files, { x: p.x, y: p.y })) e.preventDefault();
            }
            return;
          }
          e.preventDefault();
          const p = input(e);
          interaction.dropPart(id, p);
          svgRef.current?.focus({ preventScroll: true });
        }}
      >
        <defs>
          <SceneDefs />
          <pattern id="ms-grid-minor" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={1.1 / view.zoom} className="ms-grid-dot" />
          </pattern>
          <pattern id="ms-grid-major" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={1.7 / view.zoom} className="ms-grid-dot-major" />
          </pattern>
          <pattern id="ms-grid-lines-minor" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path d={`M${GRID} 0H0V${GRID}`} className="ms-grid-line" style={{ strokeWidth: 0.6 / view.zoom }} />
          </pattern>
          <pattern id="ms-grid-lines-major" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
            <path d={`M${GRID * 5} 0H0V${GRID * 5}`} className="ms-grid-line-major" style={{ strokeWidth: 1 / view.zoom }} />
          </pattern>
        </defs>
        <rect className="ms-canvas-bg" width="100%" height="100%" />
        <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
          {showGrid && layerVisible(sheet, 'grid') ? (
            <>
              {minorGrid ? <rect x={vis.x - GRID} y={vis.y - GRID} width={vis.w + 2 * GRID} height={vis.h + 2 * GRID} fill={lineGrid ? 'url(#ms-grid-lines-minor)' : 'url(#ms-grid-minor)'} /> : null}
              <rect x={vis.x - GRID * 5} y={vis.y - GRID * 5} width={vis.w + GRID * 10} height={vis.h + GRID * 10} fill={lineGrid ? 'url(#ms-grid-lines-major)' : 'url(#ms-grid-major)'} />
            </>
          ) : null}
          <SheetScene
            key={libVersion}
            design={design}
            sheet={sheet}
            lookup={partLookup}
            selected={selected}
            indicatorLevels={indicatorLevels}
            ratingStates={ratingStates}
            probeValues={probeValues}
            ercMarkers={showErc ? ercMarkers : undefined}
            wireNets={wireNets}
          />
          <SelectionBoxes sheet={sheet} selected={selected} zoom={view.zoom} />
          <OverlayLayer overlay={overlay} tool={tool} pins={pins} zoom={view.zoom} />
        </g>
      </svg>
      {tool.kind === 'select' && !overlay.wire && sheet.parts.length + sheet.wires.length + sheet.labels.length + sheet.notes.length + sheet.probes.length + (sheet.shapes?.length ?? 0) === 0 ? (
        <div className="ms-canvas-empty" aria-hidden="true">
          <strong>{t('editor.schematicCanvas.thisSheetIsEmpty')}</strong>
          {t('editor.schematicCanvas.pickAPartInThe')}
        </div>
      ) : null}
      <div className="ms-canvas-hint" aria-hidden="true">
        {toolHint(tool, overlay)}
      </div>
    </div>
  );
}
