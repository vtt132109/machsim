/**
 * Canvas interaction controller: turns pointer and key input (already converted to sheet
 * coordinates) into editor actions for every tool. DOM-free, so the tools are unit-testable.
 *
 * Tools
 *  - select: click / Shift-click / Ctrl-click selection, drag-move (one undo step), drag of part
 *    ref/value labels, rubber band (left->right = fully inside, right->left = crossing), clicking a
 *    pin starts a wire, double-click opens properties (or the instrument window), right-click asks
 *    the host for a context menu; while simulating, clicking a part with PartDef.interactive
 *    operates it (toggle / momentary press+release / slider step, Shift = step down); on a
 *    multi-control part (InteractiveDef.controls: DIP switch, keypad) the control nearest to the
 *    click is operated, and every control answers to its own key.
 *  - place: ghost follows the cursor; click places (repeat until Esc); R / Ctrl+R rotate
 *    (Shift = counter-clockwise), X / Y mirror.
 *  - wire: click starts on a pin, a wire or an empty grid point; the preview is an L route ('/'
 *    flips which leg comes first); clicks on empty points add corners; a click on a pin or wire
 *    (or a second click on the same point / double-click) finishes; Backspace removes the last
 *    corner, Enter finishes, Esc cancels. Splitting / merging / junctions are automatic.
 *  - label: click on a wire or pin, enter the net name (R rotates the next label).
 *  - probe: click places a probe of the tool's kind; differential probes take two clicks
 *    (measured point, then reference point).
 *  - text: click, enter the note text.
 *  - bus: like the wire tool, draws bus wires (asks for the bus name, e.g. D[0..7], when the new
 *    bus does not join a named one). An ordinary wire ending on a bus asks which line it joins
 *    and places a bus entry there.
 *  - label with a labelKind: off-page / hierarchical / global connector or bus entry (the bus
 *    entry suggests the next free line of the bus under the click).
 *  - shape: line / rectangle / ellipse / arc / picture by dragging a box (or two clicks);
 *    polyline / polygon by clicking points, double-click or Enter finishes; pictures ask for an
 *    image file.
 *  - comment: click, enter the comment text (sticky note with date).
 *  Double-clicking a block (subcircuit / hierarchical block) opens its child design.
 *
 * Transient visuals (ghost, wire preview, rubber band, connection target) are published in the
 * {@link CanvasInteraction.overlay} store for the canvas overlay layer.
 */
import type { InstrumentKind, LabelKind, Point, Rotation, ShapeKind, Sheet } from '../../model/types';
import { isBlockPartId } from '../../model/hierarchy';
import { busMembers, nextFreeMember } from '../../model/bus';
import { busNameAt, onBus } from '../store/schematicOps';
import { onWire } from '../store/wireOps';
import { samePoint, sheetToLocal, snap } from '../../model/geometry';
import { createStore } from '../store/createStore';
import type { Editor } from '../store/editorStore';
import { activeSheet, isSelected } from '../store/editorStore';
import { nextNetLabelName, pinAt } from '../store/designOps';
import { hitTest, itemsInRect, nearestPin, nearestWire, wireAtPoint, type HitResult } from '../store/hitTest';
import { draftPoints, pinStubHorizontal } from '../store/routing';
import { controlKeys, interactiveKeyMatches, nearestControl } from '../store/interactive';
import { partLabelLayout, rectFromPoints } from '../store/shapes';
import type { ItemKind, SelItem } from '../store/types';
import type { PromptOptions } from '../common/dialogs';
import { t } from '../../i18n';
import { partName } from '../../i18n/library';

/** Pointer input in sheet coordinates. */
export interface PointerInput {
  x: number;
  y: number;
  /** 0 = left, 1 = middle, 2 = right */
  button: number;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  /** current zoom (screen px per sheet unit) — converts pixel tolerances */
  zoom: number;
  /** viewport coordinates (context menu placement) */
  clientX?: number;
  clientY?: number;
}

export interface KeyInput {
  key: string;
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  repeat?: boolean;
}

export interface ConnectionTarget {
  kind: 'pin' | 'wire' | 'point';
  x: number;
  y: number;
  /** pin stub orientation (pins only) */
  horizontal?: boolean;
}

export interface WireDraft {
  /** committed points; [0] is the start */
  points: Point[];
  horizontalFirst: boolean;
  /** committed points + L route to the cursor */
  preview: Point[];
  /** the draft was started from a pin with the select tool (stay in select mode afterwards) */
  fromSelect: boolean;
  /** drawing a bus (bus tool) */
  bus?: boolean;
}

/** Graphic annotation being drawn with the shape tool. */
export interface ShapeDraft {
  kind: ShapeKind;
  /** committed points (box tools: the first corner) */
  points: Point[];
  /** cursor point (snapped) */
  preview: Point;
}

export interface Overlay {
  /** snapped cursor position (null when outside the canvas) */
  cursor: Point | null;
  ghost: { partId: string; x: number; y: number; rotation: Rotation; mirror: boolean } | null;
  wire: WireDraft | null;
  band: { a: Point; b: Point; mode: 'inside' | 'crossing' } | null;
  /** connection under the cursor for wire / label / probe tools */
  target: ConnectionTarget | null;
  /** measured point of a differential probe waiting for its reference click */
  probeRef: Point | null;
  labelRotation: Rotation;
  /** object under the cursor (select tool) */
  hover: HitResult | null;
  /** shape being drawn (shape tool) */
  shape: ShapeDraft | null;
}

export interface InteractionHost {
  promptText(opts: PromptOptions): Promise<string | null>;
  openPartProperties(partId: string): void;
  openInstrument(refdes: string, kind: InstrumentKind): void;
  /** open the code editor of a microcontroller part (optional) */
  openMcuEditor?(refdes: string): void;
  /** edit a wire / label / probe / note (double-click) */
  editItem(item: SelItem): void;
  contextMenu(hit: HitResult | null, clientX: number, clientY: number): void;
  /** true while a simulation runs (clicks operate interactive parts) */
  isSimulating(): boolean;
  /** pick an image for a picture annotation (data: URL), null when cancelled (optional) */
  pickImage?(): Promise<string | null>;
  /** the learner dragged a rectangle with the capture tool: copy / save it as a picture (optional) */
  captureArea?(rect: { x: number; y: number; w: number; h: number }): void;
}

/** Host that does nothing (until the application installs a real one). */
export const NULL_HOST: InteractionHost = {
  promptText: async () => null,
  openPartProperties: () => undefined,
  openInstrument: () => undefined,
  editItem: () => undefined,
  contextMenu: () => undefined,
  isSimulating: () => false,
};

/** Pixel tolerances (converted to sheet units with the zoom). */
export const PICK_PX = 6;
export const PIN_PX = 7;
export const DRAG_THRESHOLD_PX = 3;
/** Label drags snap to half a grid step. */
export const LABEL_SNAP = 5;

type Gesture =
  | { kind: 'none' }
  | { kind: 'move'; start: Point; started: boolean }
  | { kind: 'label'; partId: string; which: 'ref' | 'value'; start: Point; startOffset: Point; key: string; moved: boolean }
  | { kind: 'band'; a: Point; additive: boolean; capture?: boolean }
  | { kind: 'momentary'; refdes: string; control?: number };

const EMPTY_OVERLAY: Overlay = {
  cursor: null,
  ghost: null,
  wire: null,
  band: null,
  target: null,
  probeRef: null,
  labelRotation: 0,
  hover: null,
  shape: null,
};

/** Shapes drawn by clicking points (finished with double-click / Enter); the others take a box. */
const POINT_SHAPES: ShapeKind[] = ['polyline', 'polygon'];

/** Plain point of a target (drops kind / orientation so only x, y reach the document). */
function pt(p: Point): Point {
  return { x: p.x, y: p.y };
}

function hitToSel(hit: HitResult): SelItem | null {
  switch (hit.kind) {
    case 'part':
    case 'partLabel':
      return { kind: 'part', id: hit.id };
    case 'wire':
    case 'label':
    case 'probe':
    case 'note':
    case 'shape':
      return { kind: hit.kind as ItemKind, id: hit.id };
    default:
      return null;
  }
}

export class CanvasInteraction {
  readonly overlay = createStore<Overlay>(EMPTY_OVERLAY);
  private gesture: Gesture = { kind: 'none' };
  private busy = false;
  private lastLabelName: string | null = null;
  private host: InteractionHost;
  private lastToolKind: string;
  private lastSheetId: string;

  constructor(
    private readonly editor: Editor,
    host: InteractionHost = NULL_HOST,
  ) {
    this.host = host;
    const s = editor.getState();
    this.lastToolKind = s.tool.kind;
    this.lastSheetId = s.activeSheetId;
    editor.subscribe(() => this.onStoreChange());
  }

  setHost(host: InteractionHost): void {
    this.host = host;
  }

  // ------------------------------------------------------------------ helpers

  private get state() {
    return this.editor.getState();
  }

  private sheet(): Sheet {
    return activeSheet(this.state);
  }

  private patch(p: Partial<Overlay>): void {
    this.overlay.setState((o) => ({ ...o, ...p }));
  }

  /** Reset transient state when the tool or the sheet changes from outside. */
  private onStoreChange(): void {
    const s = this.state;
    const toolKind = s.tool.kind;
    if (toolKind !== this.lastToolKind || s.activeSheetId !== this.lastSheetId) {
      const sameSheet = s.activeSheetId === this.lastSheetId;
      this.lastToolKind = toolKind;
      this.lastSheetId = s.activeSheetId;
      const o = this.overlay.getState();
      // a wire draft survives switching into the wire tool on the same sheet (e.g. W pressed mid-draft)
      const keepWire = (toolKind === 'wire' || toolKind === 'bus') && sameSheet && !!o.wire && !!o.wire.bus === (toolKind === 'bus') ? o.wire : null;
      this.patch({ wire: keepWire, band: null, probeRef: null, ghost: null, target: null, hover: null, shape: null });
      if (this.gesture.kind !== 'momentary') this.gesture = { kind: 'none' };
    }
  }

  /** Resolve the connection point under `p`: pin, point on a wire (grid snapped) or grid point. */
  connectionTarget(p: Point, zoom: number): ConnectionTarget {
    const sheet = this.sheet();
    const lookup = this.editor.lookup;
    const pin = nearestPin(sheet, p, PIN_PX / zoom, lookup);
    if (pin) {
      const inst = sheet.parts.find((x) => x.id === pin.partId);
      const horizontal = inst ? pinStubHorizontal(pin.dir, inst.rotation, inst.mirror) : true;
      return { kind: 'pin', x: pin.x, y: pin.y, horizontal };
    }
    const w = nearestWire(sheet, p, PICK_PX / zoom);
    if (w) {
      const wire = sheet.wires.find((x) => x.id === w.id);
      if (wire) {
        const a = wire.points[w.segment];
        const b = wire.points[w.segment + 1];
        let q: Point;
        if (Math.abs(a.y - b.y) < 0.5) q = { x: Math.min(Math.max(snap(w.x), Math.min(a.x, b.x)), Math.max(a.x, b.x)), y: a.y };
        else if (Math.abs(a.x - b.x) < 0.5) q = { x: a.x, y: Math.min(Math.max(snap(w.y), Math.min(a.y, b.y)), Math.max(a.y, b.y)) };
        else q = { x: w.x, y: w.y };
        return { kind: 'wire', x: q.x, y: q.y };
      }
    }
    const g = { x: snap(p.x), y: snap(p.y) };
    if (pinAt(sheet, g, lookup)) return { kind: 'pin', ...g, horizontal: true };
    if (wireAtPoint(sheet, g)) return { kind: 'wire', ...g };
    return { kind: 'point', ...g };
  }

  private hit(p: PointerInput): HitResult | null {
    return hitTest(this.sheet(), p, { lookup: this.editor.lookup, tolerance: PICK_PX / p.zoom, pinRadius: PIN_PX / p.zoom });
  }

  // ------------------------------------------------------------------- pointer

  pointerDown(p: PointerInput): void {
    const tool = this.state.tool;
    const o = this.overlay.getState();
    if (p.button === 2) {
      // right button: cancel drafts / tools, otherwise context menu
      if (o.wire || o.probeRef || o.shape) {
        this.patch({ wire: null, probeRef: null, shape: null });
        return;
      }
      if (tool.kind !== 'select') {
        this.editor.actions.cancelTool();
        return;
      }
      const hit = this.hit(p);
      const sel = hit ? hitToSel(hit) : null;
      if (sel && !isSelected(this.state, sel.kind, sel.id)) this.editor.actions.select([sel]);
      this.host.contextMenu(hit, p.clientX ?? 0, p.clientY ?? 0);
      return;
    }
    if (p.button !== 0) return;
    if (this.busy) return;
    if (o.wire) {
      this.wireClick(p);
      return;
    }
    switch (tool.kind) {
      case 'select':
        this.selectDown(p);
        return;
      case 'place': {
        this.editor.actions.placePart(tool.partId, { x: p.x, y: p.y }, tool.rotation, tool.mirror);
        return;
      }
      case 'wire':
        this.wireClick(p);
        return;
      case 'label':
        void this.labelClick(p);
        return;
      case 'probe':
        this.probeClick(p, tool.probeKind);
        return;
      case 'text':
        void this.textClick(p);
        return;
      case 'bus':
        this.wireClick(p, true);
        return;
      case 'shape':
        this.shapeDown(p, tool.shapeKind);
        return;
      case 'comment':
        void this.commentClick(p);
        return;
      case 'capture':
        // drag a rectangle; the host turns it into a picture on release
        this.gesture = { kind: 'band', a: { x: p.x, y: p.y }, additive: false, capture: true };
        this.patch({ band: { a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, mode: 'inside' } });
        return;
    }
  }

  pointerMove(p: PointerInput): void {
    const tool = this.state.tool;
    const cursor = { x: snap(p.x), y: snap(p.y) };
    const g = this.gesture;
    const o = this.overlay.getState();
    if (g.kind === 'move') {
      const dist = Math.hypot(p.x - g.start.x, p.y - g.start.y) * p.zoom;
      if (!g.started && dist >= DRAG_THRESHOLD_PX) {
        g.started = true;
        this.editor.actions.beginDrag();
      }
      if (g.started) this.editor.actions.dragTo(snap(p.x - g.start.x), snap(p.y - g.start.y));
      this.patch({ cursor, target: null, hover: null });
      return;
    }
    if (g.kind === 'label') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) * p.zoom < DRAG_THRESHOLD_PX) return;
      g.moved = true;
      const off = { x: snap(g.startOffset.x + dx, LABEL_SNAP), y: snap(g.startOffset.y + dy, LABEL_SNAP) };
      this.editor.actions.setLabelOffset(g.partId, g.which, off, { coalesce: g.key });
      return;
    }
    if (g.kind === 'band') {
      const b = { x: p.x, y: p.y };
      this.patch({ cursor, band: { a: g.a, b, mode: b.x >= g.a.x ? 'inside' : 'crossing' } });
      return;
    }
    if (o.wire) {
      const t = this.connectionTarget(p, p.zoom);
      this.patch({ cursor, target: t, wire: { ...o.wire, preview: draftPoints(o.wire.points, pt(t), o.wire.horizontalFirst) } });
      return;
    }
    switch (tool.kind) {
      case 'place':
        this.patch({ cursor, ghost: { partId: tool.partId, x: cursor.x, y: cursor.y, rotation: tool.rotation, mirror: tool.mirror } });
        return;
      case 'wire':
      case 'label':
      case 'probe':
        this.patch({ cursor, target: this.connectionTarget(p, p.zoom) });
        return;
      case 'text':
      case 'comment':
        this.patch({ cursor });
        return;
      case 'bus':
        this.patch({ cursor, target: this.connectionTarget(p, p.zoom) });
        return;
      case 'shape':
        this.patch({ cursor, ...(o.shape ? { shape: { ...o.shape, preview: cursor } } : {}) });
        return;
      case 'select': {
        const hover = this.hit(p);
        const prev = o.hover;
        const same =
          prev === hover ||
          (!!prev && !!hover && prev.kind === hover.kind && JSON.stringify(prev) === JSON.stringify(hover));
        this.patch({ cursor, ...(same ? {} : { hover }), target: hover?.kind === 'pin' ? { kind: 'pin', x: hover.x, y: hover.y } : null });
        return;
      }
    }
  }

  pointerUp(p: PointerInput): void {
    const g = this.gesture;
    this.gesture = { kind: 'none' };
    // box shapes: a drag from the first corner finishes on release
    const sd = this.overlay.getState().shape;
    const tool = this.state.tool;
    if (sd && tool.kind === 'shape' && !POINT_SHAPES.includes(sd.kind) && sd.points.length === 1) {
      const end = { x: snap(p.x), y: snap(p.y) };
      if (!samePoint(end, sd.points[0])) void this.finishShape([sd.points[0], end]);
      return;
    }
    switch (g.kind) {
      case 'move':
        if (g.started) this.editor.actions.endDrag();
        return;
      case 'band': {
        this.patch({ band: null });
        const w = Math.abs(p.x - g.a.x) * p.zoom;
        const h = Math.abs(p.y - g.a.y) * p.zoom;
        if (g.capture) {
          if (w >= DRAG_THRESHOLD_PX && h >= DRAG_THRESHOLD_PX) this.host.captureArea?.(rectFromPoints(g.a, p));
          else this.editor.actions.cancelTool();
          return;
        }
        if (w < DRAG_THRESHOLD_PX && h < DRAG_THRESHOLD_PX) {
          if (!g.additive) this.editor.actions.clearSelection();
          return;
        }
        const rect = rectFromPoints(g.a, p);
        const items = itemsInRect(this.sheet(), rect, p.x >= g.a.x ? 'inside' : 'crossing', this.editor.lookup);
        if (g.additive) this.editor.actions.addToSelection(items);
        else this.editor.actions.select(items);
        return;
      }
      case 'momentary':
        this.editor.actions.interact(g.refdes, 'release', g.control);
        return;
      default:
        return;
    }
  }

  /** Pointer left the canvas. */
  pointerLeave(): void {
    this.patch({ cursor: null, target: null, hover: null, ghost: null });
  }

  doubleClick(p: PointerInput): void {
    const o = this.overlay.getState();
    if (this.state.tool.kind === 'shape' && o.shape && POINT_SHAPES.includes(o.shape.kind)) {
      // the double-click's own clicks already added its point (twice): finish with the points so far
      const pts = dedupeTail(o.shape.points);
      if (pts.length >= (o.shape.kind === 'polygon' ? 3 : 2)) void this.finishShape(pts);
      return;
    }
    if (this.state.tool.kind !== 'select' || o.wire) return;
    const hit = this.hit(p);
    if (!hit) return;
    if (hit.kind === 'part' || hit.kind === 'partLabel') {
      const inst = this.sheet().parts.find((x) => x.id === hit.id);
      if (!inst) return;
      const def = this.editor.lookup(inst.partId);
      // an instrument opens its front panel from its body and from its name label ("XSC1"):
      // beginners double-click the name; the settings stay in the Properties panel
      if (def?.instrument) this.host.openInstrument(inst.refdes, def.instrument);
      // a microcontroller opens its code editor (its parameters stay in the Properties panel)
      else if (def && (def as { mcu?: unknown }).mcu && this.host.openMcuEditor) this.host.openMcuEditor(inst.refdes);
      // a block opens its child design (its parameters are in the Properties panel)
      else if (hit.kind === 'part' && isBlockPartId(inst.partId)) this.editor.actions.openBlock(inst.id);
      else this.host.openPartProperties(inst.id);
      return;
    }
    const sel = hitToSel(hit);
    if (sel) {
      this.editor.actions.select([sel]);
      this.host.editItem(sel);
    }
  }

  /** Drop of a library part (drag from the component browser). */
  dropPart(partId: string, at: Point): string | null {
    return this.editor.actions.placePart(partId, at, 0, false);
  }

  // --------------------------------------------------------------------- keys

  /** Tool-specific keys. Returns true when the key was consumed. */
  keyDown(k: KeyInput): boolean {
    const tool = this.state.tool;
    const o = this.overlay.getState();
    const key = k.key.length === 1 ? k.key.toLowerCase() : k.key;
    if (key === 'Escape') {
      this.escape();
      return true;
    }
    if (o.shape && this.state.tool.kind === 'shape') {
      if (key === 'Enter' && POINT_SHAPES.includes(o.shape.kind)) {
        const pts = dedupeTail(o.shape.points);
        if (pts.length >= (o.shape.kind === 'polygon' ? 3 : 2)) void this.finishShape(pts);
        return true;
      }
      if (key === 'Backspace') {
        const pts = o.shape.points.slice(0, -1);
        this.patch({ shape: pts.length ? { ...o.shape, points: pts } : null });
        return true;
      }
    }
    if (o.wire) {
      if (key === '/' || key === '\\') {
        const hf = !o.wire.horizontalFirst;
        const t = o.target ?? o.cursor;
        this.patch({ wire: { ...o.wire, horizontalFirst: hf, preview: t ? draftPoints(o.wire.points, pt(t), hf) : o.wire.preview } });
        return true;
      }
      if (key === 'Backspace') {
        if (o.wire.points.length > 1) {
          const pts = o.wire.points.slice(0, -1);
          const t = o.target ?? o.cursor;
          this.patch({ wire: { ...o.wire, points: pts, preview: t ? draftPoints(pts, pt(t), o.wire.horizontalFirst) : pts } });
        } else this.patch({ wire: null });
        return true;
      }
      if (key === 'Enter') {
        this.finishWire(o.wire.preview.length >= 2 ? o.wire.preview : o.wire.points);
        return true;
      }
    }
    if (tool.kind === 'place' && !k.alt) {
      if (key === 'r') {
        this.editor.actions.transformGhost(k.shift ? 'ccw' : 'cw');
        this.refreshGhost();
        return true;
      }
      if (key === 'x' && !k.ctrl) {
        this.editor.actions.transformGhost('flipH');
        this.refreshGhost();
        return true;
      }
      if (key === 'y' && !k.ctrl) {
        this.editor.actions.transformGhost('flipV');
        this.refreshGhost();
        return true;
      }
    }
    if (tool.kind === 'label' && key === 'r' && !k.ctrl && !k.alt) {
      this.patch({ labelRotation: (((o.labelRotation + (k.shift ? 270 : 90)) % 360) as Rotation) });
      return true;
    }
    return false;
  }

  /** Refdes of every part in the design whose PartDef.interactive key matches `key`. */
  interactiveTargets(key: string): string[] {
    return [...new Set(this.interactiveControlTargets(key).map((t) => t.refdes))];
  }

  /**
   * Interactive parts (and, for multi-control parts, the control index) bound to a key. The
   * instance's "key" parameter (keyParam) overrides the part's default key; multi-control parts
   * (DIP switches, keypads) match each control's key (InteractiveDef.keysParam overrides them),
   * and their main key, when they have one, operates the main param (rotary switch: next
   * position).
   */
  interactiveControlTargets(key: string): { refdes: string; control?: number }[] {
    const out: { refdes: string; control?: number }[] = [];
    for (const sheet of this.state.design.sheets) {
      for (const inst of sheet.parts) {
        const def = this.editor.lookup(inst.partId);
        const idef = def?.interactive;
        if (!idef) continue;
        if (idef.controls?.length) {
          controlKeys(idef, inst.params).forEach((k, i) => {
            if (interactiveKeyMatches(k, key)) out.push({ refdes: inst.refdes, control: i });
          });
        }
        // the part's own key (rotary switch: step to the next position); multi-control parts
        // without a main key (DIP switch, keypad) only answer to their control keys
        const own = inst.params.key?.trim();
        if (interactiveKeyMatches(own || idef.key, key)) out.push({ refdes: inst.refdes });
      }
    }
    return out;
  }

  /**
   * Operate interactive parts bound to a key (switch keys, potentiometer keys ...). Toggles act on
   * key down (auto-repeat ignored), momentary parts press on key down and release on key up,
   * sliders step up on every key down (Shift = step down, auto-repeat allowed). Ctrl / Alt
   * combinations are never interactive keys. Returns true when some part uses the key.
   */
  interactiveKey(k: KeyInput, phase: 'down' | 'up'): boolean {
    if (k.ctrl || k.alt) return false;
    const targets = this.interactiveControlTargets(k.key);
    if (targets.length === 0) return false;
    const actions = this.editor.actions;
    for (const { refdes, control } of targets) {
      const found = this.state.design.sheets.flatMap((s) => s.parts).find((p) => p.refdes === refdes);
      const idef = found ? this.editor.lookup(found.partId)?.interactive : undefined;
      if (!idef) continue;
      if (idef.kind === 'momentary') {
        if (phase === 'down' && !k.repeat) actions.interact(refdes, 'press', control);
        else if (phase === 'up') actions.interact(refdes, 'release', control);
      } else if (phase === 'down') {
        if (idef.kind === 'slider') actions.interact(refdes, k.shift ? 'decrease' : 'increase', control);
        else if (!k.repeat) actions.interact(refdes, 'click', control);
      }
    }
    return true;
  }

  /** Escape: abort the innermost operation. */
  escape(): void {
    const o = this.overlay.getState();
    const g = this.gesture;
    if (g.kind === 'move' && g.started) {
      this.editor.actions.cancelDrag();
      this.gesture = { kind: 'none' };
      return;
    }
    if (g.kind === 'band') {
      this.gesture = { kind: 'none' };
      this.patch({ band: null });
      return;
    }
    if (o.wire) {
      this.patch({ wire: null });
      return;
    }
    if (o.shape) {
      this.patch({ shape: null });
      return;
    }
    if (o.probeRef) {
      this.patch({ probeRef: null });
      return;
    }
    if (this.state.tool.kind !== 'select') {
      this.editor.actions.cancelTool();
      return;
    }
    this.editor.actions.clearSelection();
  }

  private refreshGhost(): void {
    const t = this.state.tool;
    const o = this.overlay.getState();
    if (t.kind === 'place' && o.cursor) this.patch({ ghost: { partId: t.partId, x: o.cursor.x, y: o.cursor.y, rotation: t.rotation, mirror: t.mirror } });
  }

  // ------------------------------------------------------------ select tool

  private selectDown(p: PointerInput): void {
    const actions = this.editor.actions;
    const hit = this.hit(p);
    if (hit && this.host.isSimulating() && (hit.kind === 'part' || hit.kind === 'partLabel')) {
      const inst = this.sheet().parts.find((x) => x.id === hit.id);
      const idef = inst ? this.editor.lookup(inst.partId)?.interactive : undefined;
      if (inst && idef) {
        // multi-control parts (DIP switch, keypad): the control nearest to the click
        const control = idef.controls?.length ? nearestControl(idef, sheetToLocal(p, inst)) : undefined;
        if (idef.kind === 'momentary') {
          actions.interact(inst.refdes, 'press', control);
          this.gesture = { kind: 'momentary', refdes: inst.refdes, ...(control !== undefined ? { control } : {}) };
        } else if (idef.kind === 'slider') actions.interact(inst.refdes, p.shift ? 'decrease' : 'increase', control);
        else actions.interact(inst.refdes, 'click', control);
        return;
      }
    }
    if (hit?.kind === 'pin' && !p.shift && !p.ctrl) {
      this.startWire({ kind: 'pin', x: hit.x, y: hit.y, horizontal: this.pinHorizontal(hit) }, true);
      return;
    }
    if (hit?.kind === 'partLabel' && !p.shift && !p.ctrl) {
      const inst = this.sheet().parts.find((x) => x.id === hit.id);
      if (inst) {
        if (!isSelected(this.state, 'part', inst.id)) actions.select([{ kind: 'part', id: inst.id }]);
        const def = this.editor.lookup(inst.partId);
        this.gesture = { kind: 'label', partId: inst.id, which: hit.which, start: { x: p.x, y: p.y }, startOffset: labelOffsetOf(inst, def, hit.which), key: actions.newCoalesceKey('label'), moved: false };
        return;
      }
    }
    const sel = hit ? hitToSel(hit) : null;
    if (sel) {
      if (p.shift || p.ctrl) {
        actions.toggleSelect(sel);
        return;
      }
      if (!isSelected(this.state, sel.kind, sel.id)) actions.select([sel]);
      this.gesture = { kind: 'move', start: { x: p.x, y: p.y }, started: false };
      return;
    }
    this.gesture = { kind: 'band', a: { x: p.x, y: p.y }, additive: !!(p.shift || p.ctrl) };
    this.patch({ band: { a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, mode: 'inside' } });
  }

  private pinHorizontal(hit: Extract<HitResult, { kind: 'pin' }>): boolean {
    const inst = this.sheet().parts.find((x) => x.id === hit.partId);
    return inst ? pinStubHorizontal(hit.dir, inst.rotation, inst.mirror) : true;
  }

  // -------------------------------------------------------------- wire tool

  private startWire(t: ConnectionTarget, fromSelect: boolean, bus = false): void {
    const start = { x: t.x, y: t.y };
    this.patch({
      wire: { points: [start], horizontalFirst: t.kind === 'pin' ? t.horizontal !== false : true, preview: [start], fromSelect, ...(bus ? { bus: true } : {}) },
      target: t,
    });
  }

  private wireClick(p: PointerInput, bus = false): void {
    const o = this.overlay.getState();
    const t = this.connectionTarget(p, p.zoom);
    if (!o.wire) {
      this.startWire(t, false, bus);
      return;
    }
    const draft = o.wire;
    const last = draft.points[draft.points.length - 1];
    const route = draftPoints(draft.points, pt(t), draft.horizontalFirst);
    if (samePoint(t, last)) {
      // second click on the same point (double-click) finishes
      if (draft.points.length >= 2) this.finishWire(draft.points);
      return;
    }
    if (t.kind !== 'point') {
      this.finishWire(route);
      return;
    }
    // corner: commit the route; the next leg starts perpendicular to the last segment
    const n = route.length;
    const lastHorizontal = n >= 2 && Math.abs(route[n - 1].y - route[n - 2].y) < 0.5;
    this.patch({ wire: { ...draft, points: route, horizontalFirst: !lastHorizontal, preview: route } });
  }

  private finishWire(points: Point[]): void {
    const o = this.overlay.getState();
    this.patch({ wire: null });
    if (o.wire?.bus) {
      if (points.length >= 2) void this.finishBus(points);
      return;
    }
    if (points.length >= 2) {
      this.editor.actions.addWire(points);
      void this.offerBusEntries(points);
    }
    if (o.wire?.fromSelect && this.state.tool.kind !== 'select') this.editor.actions.cancelTool();
  }

  /** A new bus that joins no named bus asks for its name (empty = leave unnamed). */
  private async finishBus(points: Point[]): Promise<void> {
    const sheet = this.sheet();
    const named = busNameAt(sheet, points[0]) ?? busNameAt(sheet, points[points.length - 1]);
    if (named) {
      this.editor.actions.addBus(points);
      return;
    }
    this.busy = true;
    try {
      const name = await this.host.promptText({
        title: t('schematic.tool.busName'),
        label: t('schematic.tool.busNameLabel'),
        initial: 'D[0..7]',
        validate: (v) => (v.trim() === '' || busMembers(v).length ? null : t('schematic.tool.busNameInvalid')),
      });
      if (name === null) return;
      this.editor.actions.addBus(points, name.trim() || undefined);
    } finally {
      this.busy = false;
    }
  }

  /** Ends of a new ordinary wire that lie on a bus (and on nothing else) get a bus entry. */
  private async offerBusEntries(points: Point[]): Promise<void> {
    const ends = [points[0], points[points.length - 1]];
    for (const e of ends) {
      const sheet = this.sheet();
      if (!onBus(sheet, e)) continue;
      if (sheet.labels.some((l) => l.kind === 'bus-entry' && samePoint(l, e))) continue;
      if (sheet.wires.some((w) => !w.bus && onWire(w, e) && !w.points.some((q) => samePoint(q, e)))) continue;
      const name = await this.askBusLine(e);
      if (name) this.editor.actions.addLabelItem({ x: e.x, y: e.y }, name, 0, 'bus-entry');
    }
  }

  /** Ask which bus line a bus entry at `at` joins (suggests the next unused line). */
  private async askBusLine(at: Point): Promise<string | null> {
    const sheet = this.sheet();
    const busName = busNameAt(sheet, at);
    const lines = busName ? busMembers(busName) : [];
    const used = sheet.labels.filter((l) => l.kind === 'bus-entry').map((l) => l.name);
    this.busy = true;
    try {
      const name = await this.host.promptText({
        title: t('schematic.tool.busEntry'),
        label: busName ? t('schematic.tool.busLineOf', { bus: busName, lines: lines.slice(0, 8).join(', ') + (lines.length > 8 ? ' …' : '') }) : t('schematic.tool.busLine'),
        initial: nextFreeMember(lines, used) ?? 'D0',
        validate: (v) => (!v.trim() ? t('editor.interaction.enterANetName') : /\s/.test(v.trim()) ? t('editor.interaction.netNamesCannotContainSpaces') : null),
      });
      return name && name.trim() ? name.trim() : null;
    } finally {
      this.busy = false;
    }
  }

  // ---------------------------------------------------------- other tools

  private async labelClick(p: PointerInput): Promise<void> {
    const target = this.connectionTarget(p, p.zoom);
    const o = this.overlay.getState();
    const design = this.state.design;
    const tool = this.state.tool;
    const kind: LabelKind = tool.kind === 'label' ? (tool.labelKind ?? 'label') : 'label';
    if (kind === 'bus-entry') {
      const name = await this.askBusLine(target);
      if (name) this.editor.actions.addLabelItem({ x: target.x, y: target.y }, name, 0, 'bus-entry');
      return;
    }
    const titles: Record<Exclude<LabelKind, 'bus-entry'>, string> = {
      label: t('editor.interaction.placeNetLabel'),
      offpage: t('schematic.tool.placeOffpage'),
      hier: t('schematic.tool.placeHier'),
      global: t('schematic.tool.placeGlobal'),
    };
    this.busy = true;
    try {
      const name = await this.host.promptText({
        title: titles[kind],
        label: kind === 'label' ? t('common.netName') : t('schematic.tool.connectorName'),
        initial: this.suggestLabelName(design),
        validate: (v) => (v.trim() ? (/\s/.test(v.trim()) ? t('editor.interaction.netNamesCannotContainSpaces') : null) : t('editor.interaction.enterANetName')),
      });
      if (name && name.trim()) {
        this.lastLabelName = name.trim();
        if (kind === 'label') this.editor.actions.addNetLabel({ x: target.x, y: target.y }, name.trim(), o.labelRotation);
        else this.editor.actions.addLabelItem({ x: target.x, y: target.y }, name.trim(), o.labelRotation, kind);
      }
    } finally {
      this.busy = false;
    }
  }

  // ------------------------------------------------------------ shapes, comments

  private shapeDown(p: PointerInput, kind: ShapeKind): void {
    const at = { x: snap(p.x), y: snap(p.y) };
    const o = this.overlay.getState();
    if (POINT_SHAPES.includes(kind)) {
      const points = o.shape ? [...o.shape.points, at] : [at];
      this.patch({ shape: { kind, points, preview: at } });
      return;
    }
    if (!o.shape) {
      this.patch({ shape: { kind, points: [at], preview: at } });
      return;
    }
    // second click of a click-click box
    if (!samePoint(at, o.shape.points[0])) void this.finishShape([o.shape.points[0], at]);
  }

  private async finishShape(points: Point[]): Promise<void> {
    const o = this.overlay.getState();
    const kind = o.shape?.kind;
    this.patch({ shape: null });
    if (!kind) return;
    if (kind === 'picture') {
      const src = this.host.pickImage ? await this.host.pickImage() : null;
      if (!src) return;
      this.editor.actions.addShape({ kind, points, src });
      return;
    }
    this.editor.actions.addShape({ kind, points, ...(kind === 'arc' ? { start: 180, end: 360 } : {}) });
  }

  private async commentClick(p: PointerInput): Promise<void> {
    const at = { x: snap(p.x), y: snap(p.y) };
    this.busy = true;
    try {
      const text = await this.host.promptText({ title: t('schematic.tool.placeComment'), label: t('editor.interaction.textCtrlEnterToAccept'), multiline: true, validate: (v) => (v.trim() ? null : t('editor.interaction.enterSomeText')) });
      if (text && text.trim()) this.editor.actions.addComment(at, text);
    } finally {
      this.busy = false;
    }
  }

  private suggestLabelName(design: ReturnType<Editor['getState']>['design']): string {
    if (this.lastLabelName) {
      const m = /^(.*?)(\d+)$/.exec(this.lastLabelName);
      if (m) {
        const used = new Set<string>();
        for (const s of design.sheets) for (const l of s.labels) used.add(l.name.toLowerCase());
        for (let n = Number(m[2]) + 1; n < Number(m[2]) + 10000; n++) if (!used.has(`${m[1]}${n}`.toLowerCase())) return `${m[1]}${n}`;
      }
      return this.lastLabelName;
    }
    return nextNetLabelName(design);
  }

  private probeClick(p: PointerInput, kind: Extract<ReturnType<Editor['getState']>['tool'], { kind: 'probe' }>['probeKind']): void {
    const t = this.connectionTarget(p, p.zoom);
    const pt = { x: t.x, y: t.y };
    if (kind === 'differential') {
      const o = this.overlay.getState();
      if (!o.probeRef) {
        this.patch({ probeRef: pt });
        return;
      }
      if (samePoint(o.probeRef, pt)) return;
      this.editor.actions.addProbe('differential', o.probeRef, pt);
      this.patch({ probeRef: null });
      return;
    }
    this.editor.actions.addProbe(kind, pt);
  }

  private async textClick(p: PointerInput): Promise<void> {
    const at = { x: snap(p.x), y: snap(p.y) };
    this.busy = true;
    try {
      const text = await this.host.promptText({ title: t('editor.interaction.placeText'), label: t('editor.interaction.textCtrlEnterToAccept'), multiline: true, validate: (v) => (v.trim() ? null : t('editor.interaction.enterSomeText')) });
      if (text && text.trim()) this.editor.actions.addNote(at, text);
    } finally {
      this.busy = false;
    }
  }
}

/** Current offset of a part label from the part origin (where a label drag starts). */
function labelOffsetOf(inst: Sheet['parts'][number], def: ReturnType<Editor['lookup']>, which: 'ref' | 'value'): Point {
  const explicit = which === 'ref' ? inst.refOffset : inst.valueOffset;
  if (explicit) return explicit;
  const lay = partLabelLayout(inst, def).find((l) => l.which === which);
  return lay ? lay.offset : { x: 0, y: 0 };
}

/** Short status-bar description of a hit. */
export function describeHit(hit: HitResult | null, sheet: Sheet, lookup: Editor['lookup']): string {
  if (!hit) return '';
  switch (hit.kind) {
    case 'pin': {
      const inst = sheet.parts.find((p) => p.id === hit.partId);
      const def = inst ? lookup(inst.partId) : undefined;
      const pin = def?.symbol.pins.find((x) => x.name === hit.pin);
      return pin?.label ? t('editor.interaction.pinHitLabel', { refdes: inst?.refdes ?? '?', pin: hit.pin, label: pin.label }) : t('editor.interaction.pinHit', { refdes: inst?.refdes ?? '?', pin: hit.pin });
    }
    case 'part':
    case 'partLabel': {
      const inst = sheet.parts.find((p) => p.id === hit.id);
      const def = inst ? lookup(inst.partId) : undefined;
      return inst ? `${inst.refdes} — ${def ? partName(def) : inst.partId}` : '';
    }
    case 'wire':
      return t('editor.interaction.wire');
    case 'label':
      return t('editor.interaction.netLabelValue', { value: sheet.labels.find((l) => l.id === hit.id)?.name ?? '' });
    case 'probe':
      return t('editor.interaction.probeValue', { value: sheet.probes.find((x) => x.id === hit.id)?.name ?? '' });
    case 'note':
      return sheet.notes.find((n) => n.id === hit.id)?.comment ? t('schematic.hit.comment') : t('editor.interaction.text');
    case 'shape':
      return t('schematic.hit.shape');
  }
}

/** Points without a repeated last point (a double-click adds its point twice). */
function dedupeTail(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.length || !samePoint(out[out.length - 1], p)) out.push(p);
  return out;
}
