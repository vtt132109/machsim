/**
 * BreadboardScene: the imperative three.js view behind <BreadboardView>.
 *
 * - Renders on demand (camera moves, content / highlight / indicator changes), never in a loop.
 * - Content updates are incremental: boards, parts, wires, clips and off-board devices are
 *   rebuilt only when their own signature changes, so editing one part of a 100-part layout
 *   touches one model.
 * - Shared geometries / materials / textures live in one Resources cache; `dispose()` frees all
 *   GPU memory and releases the WebGL context.
 * - WebGL context loss is handled: rendering stops, the owner is notified, and after the context
 *   is restored three.js re-uploads resources and the view is redrawn.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { BreadboardHole, BreadboardLayout } from '../types';
import type { PhysicalPart } from '../compare';
import { benchBounds, boardMap, holePosition, nearestHole, stripHoles } from '../geometry';
import { BOARD_THICKNESS, buildBoard, type BoardModel } from './board';
import { buildPartModel, type IndicatorInput, type PartModel } from './parts';
import { disposeOwned, Resources } from './resources';
import { buildClip, buildDevice, buildJumper, type DeviceModel } from './wires';

export type ViewPreset = 'top' | 'iso' | 'front';

export interface PickResult {
  hole: BreadboardHole | null;
  part?: string;
  wire?: string;
  clip?: string;
  device?: string;
}

export interface HoleMarker {
  hole: BreadboardHole;
  color: string;
}

export interface SceneHighlights {
  /** strips tinted (hovered strip, guide step) */
  strips?: string[];
  stripColor?: string;
  /** ring markers on holes (issues, guide step) */
  holes?: HoleMarker[];
  /** parts outlined */
  refdes?: string[];
  refdesColor?: string;
  /** selected item (outlined in the accent colour) */
  selected?: { kind: 'part' | 'wire' | 'clip'; id: string } | null;
}

export interface GhostLead {
  hole: BreadboardHole;
  ok: boolean;
}

export interface SceneOptions {
  onContextLost?(): void;
  onContextRestored?(): void;
  /** background colour of the bench */
  background?: string;
}

interface Entry<T> {
  sig: string;
  item: T;
}

const ACCENT = '#1f6feb';

export class BreadboardScene {
  readonly ok: boolean;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 1, 6000);
  private controls: OrbitControls | null = null;
  private readonly res = new Resources();
  private readonly roots = { boards: new THREE.Group(), parts: new THREE.Group(), wires: new THREE.Group(), clips: new THREE.Group(), devices: new THREE.Group(), overlay: new THREE.Group() };
  private boards = new Map<string, Entry<BoardModel>>();
  private parts = new Map<string, Entry<PartModel>>();
  private wires = new Map<string, Entry<THREE.Group>>();
  private clips = new Map<string, Entry<THREE.Group>>();
  private devices = new Map<string, Entry<DeviceModel>>();
  private layout: BreadboardLayout = { version: 1, boards: [], placements: [], wires: [], clips: [] };
  private highlightObjects: THREE.Object3D[] = [];
  private hoverObjects: THREE.Object3D[] = [];
  private ghostObjects: THREE.Object3D[] = [];
  private bench: THREE.Mesh | null = null;
  private pending = 0;
  private lost = false;
  private disposed = false;
  private anim = 0;
  private resizeObserver: ResizeObserver | null = null;
  private lastIndicators: { levels?: Record<string, number>; running: boolean } = { running: false };
  private highlights: SceneHighlights = {};
  private hover: BreadboardHole | null = null;
  private cursor: BreadboardHole | null = null;
  private framedFor = '';
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: SceneOptions = {},
  ) {
    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      renderer = null;
    }
    this.ok = renderer !== null;
    if (!renderer) return;
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(new THREE.Color(opts.background ?? '#dfe4ea'));
    this.res.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);

    this.scene.background = new THREE.Color(opts.background ?? '#dfe4ea');
    const hemi = new THREE.HemisphereLight('#ffffff', '#7d8590', 1.5);
    const sun = new THREE.DirectionalLight('#ffffff', 2.1);
    sun.position.set(-120, 260, 180);
    const fill = new THREE.DirectionalLight('#dfe8ff', 0.7);
    fill.position.set(200, 120, -160);
    this.scene.add(hemi, sun, fill);
    for (const r of Object.values(this.roots)) this.scene.add(r);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 2500;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', this.requestRender);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---- rendering --------------------------------------------------------------------------

  readonly requestRender = (): void => {
    if (this.pending || this.disposed || this.lost || !this.renderer) return;
    this.pending = requestAnimationFrame(() => {
      this.pending = 0;
      this.render();
    });
  };

  private render(): void {
    if (!this.renderer || this.lost || this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private onLost = (e: Event): void => {
    e.preventDefault();
    this.lost = true;
    if (this.pending) cancelAnimationFrame(this.pending);
    this.pending = 0;
    this.opts.onContextLost?.();
  };

  private onRestored = (): void => {
    this.lost = false;
    this.opts.onContextRestored?.();
    this.requestRender();
  };

  // ---- content ----------------------------------------------------------------------------

  private holeWorld(h: BreadboardHole): THREE.Vector3 | null {
    const b = this.boardIndex.get(h.board);
    if (!b) return null;
    const p = holePosition(b, h);
    return p ? new THREE.Vector3(p.x, 0, p.y) : null;
  }

  private boardIndex = new Map<string, BreadboardLayout['boards'][number]>();

  /** Replace the displayed layout (incremental). `parts` = physical parts by refdes. */
  setContent(layout: BreadboardLayout, parts: Map<string, PhysicalPart>): void {
    if (!this.renderer) return;
    this.layout = layout;
    this.boardIndex = boardMap(layout);
    const boardSig = JSON.stringify(layout.boards);

    // boards
    const nextBoards = new Map<string, Entry<BoardModel>>();
    for (const b of layout.boards) {
      const sig = JSON.stringify(b);
      const old = this.boards.get(b.id);
      if (old && old.sig === sig) {
        nextBoards.set(b.id, old);
        continue;
      }
      if (old) this.dropBoard(old);
      const model = buildBoard(b, this.res);
      this.roots.boards.add(model.group);
      nextBoards.set(b.id, { sig, item: model });
    }
    for (const [id, e] of this.boards) if (!nextBoards.has(id)) this.dropBoard(e);
    this.boards = nextBoards;
    this.updateBench();

    // parts
    const nextParts = new Map<string, Entry<PartModel>>();
    for (const pl of layout.placements) {
      const part = parts.get(pl.refdes);
      if (!part || part.map.mounting !== 'board') continue;
      const sig = `${boardSig}|${JSON.stringify(pl)}|${part.def.id}|${JSON.stringify(part.inst.params)}`;
      const old = this.parts.get(pl.refdes);
      if (old && old.sig === sig) {
        nextParts.set(pl.refdes, old);
        continue;
      }
      if (old) this.dropPart(old);
      const model = buildPartModel({ part, placement: pl, holePos: (h) => this.holeWorld(h), res: this.res });
      if (!model) continue;
      this.roots.parts.add(model.group);
      nextParts.set(pl.refdes, { sig, item: model });
    }
    for (const [id, e] of this.parts) if (!nextParts.has(id)) this.dropPart(e);
    this.parts = nextParts;

    // wires
    const nextWires = new Map<string, Entry<THREE.Group>>();
    for (const w of layout.wires) {
      const a = this.holeWorld(w.from);
      const b = this.holeWorld(w.to);
      if (!a || !b) continue;
      const sig = `${boardSig}|${JSON.stringify(w)}`;
      const old = this.wires.get(w.id);
      if (old && old.sig === sig) {
        nextWires.set(w.id, old);
        continue;
      }
      if (old) this.dropGroup(this.roots.wires, old.item);
      const g = buildJumper(this.res, w, a, b);
      this.roots.wires.add(g);
      nextWires.set(w.id, { sig, item: g });
    }
    for (const [id, e] of this.wires) if (!nextWires.has(id)) this.dropGroup(this.roots.wires, e.item);
    this.wires = nextWires;

    // off-board devices in a row behind the first board
    const offboard = [...parts.values()].filter((p) => p.map.mounting === 'offboard');
    const bounds = benchBounds(layout.boards);
    const nextDevices = new Map<string, Entry<DeviceModel>>();
    let x = bounds.x;
    const z = bounds.y - 22;
    for (const p of offboard) {
      const sig = `${x}|${z}|${p.def.id}|${p.map.offboardPins.join(',')}`;
      const old = this.devices.get(p.refdes);
      let model: DeviceModel;
      if (old && old.sig === sig) model = old.item;
      else {
        if (old) this.dropGroup(this.roots.devices, old.item.group);
        model = buildDevice(this.res, p.refdes, p.map.label, p.map.body === 'battery' ? 'battery' : p.map.body === 'supply' ? 'supply' : p.map.body === 'instrument' ? 'instrument' : 'device', p.map.offboardPins, new THREE.Vector3(x, -BOARD_THICKNESS, z));
        this.roots.devices.add(model.group);
      }
      nextDevices.set(p.refdes, { sig, item: model });
      x += model.width + 12;
    }
    for (const [id, e] of this.devices) if (!nextDevices.has(id)) this.dropGroup(this.roots.devices, e.item.group);
    this.devices = nextDevices;

    // clips
    const nextClips = new Map<string, Entry<THREE.Group>>();
    for (const c of layout.clips) {
      const hole = this.holeWorld(c.hole);
      const dev = this.devices.get(c.refdes)?.item;
      const term = dev?.terminals[c.pin];
      if (!hole) continue;
      const to = term ?? new THREE.Vector3(hole.x, 12, bounds.y - 30);
      const sig = `${JSON.stringify(c)}|${hole.toArray().join(',')}|${to.toArray().join(',')}`;
      const old = this.clips.get(c.id);
      if (old && old.sig === sig) {
        nextClips.set(c.id, old);
        continue;
      }
      if (old) this.dropGroup(this.roots.clips, old.item);
      const g = buildClip(this.res, c, hole, to);
      this.roots.clips.add(g);
      nextClips.set(c.id, { sig, item: g });
    }
    for (const [id, e] of this.clips) if (!nextClips.has(id)) this.dropGroup(this.roots.clips, e.item);
    this.clips = nextClips;

    this.applyIndicators();
    this.rebuildHighlights();
    this.rebuildHover();
    // frame the bench on first content and whenever the boards change (new design, more boards)
    const framing = `${JSON.stringify(layout.boards.map((b) => [b.id, b.kind, b.x, b.y]))}|${this.devices.size > 0}`;
    if (framing !== this.framedFor && layout.boards.length) {
      this.framedFor = framing;
      this.setView('iso', false);
    }
    this.requestRender();
  }

  private dropBoard(e: Entry<BoardModel>): void {
    this.roots.boards.remove(e.item.group);
    e.item.dispose();
  }

  private dropPart(e: Entry<PartModel>): void {
    this.roots.parts.remove(e.item.group);
    disposeOwned(e.item.group);
    e.item.dispose();
  }

  private dropGroup(root: THREE.Group, g: THREE.Object3D): void {
    root.remove(g);
    disposeOwned(g);
  }

  private updateBench(): void {
    const b = benchBounds(this.layout.boards);
    const w = b.w + 600;
    const d = b.h + 500;
    if (this.bench) {
      this.scene.remove(this.bench);
      this.bench.geometry.dispose();
    }
    const tex = this.res.texture('bench-grid', () => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#3d5c4d';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = 'rgba(230,240,235,0.16)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 256; i += 25.6) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    const mat = this.res.material('bench-mat', () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
    tex.repeat.set(w / 100, d / 100);
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    this.bench = new THREE.Mesh(geo, mat);
    this.bench.position.set(b.x + b.w / 2, -BOARD_THICKNESS - 0.02, b.y + b.h / 2 - 60);
    this.bench.userData = { kind: 'bench' };
    this.scene.add(this.bench);
  }

  // ---- indicators -------------------------------------------------------------------------

  setIndicators(levels: Record<string, number> | undefined, running: boolean): void {
    this.lastIndicators = { levels, running };
    this.applyIndicators();
    this.requestRender();
  }

  private applyIndicators(): void {
    const { levels, running } = this.lastIndicators;
    for (const [refdes, e] of this.parts) {
      const m = e.item;
      if (!m.setIndicator) continue;
      const input: IndicatorInput = { level: 0 };
      if (running && levels) {
        input.level = levels[refdes] ?? 0;
        const segs: Record<string, number> = {};
        const prefix = `${refdes}.`;
        for (const [k, v] of Object.entries(levels)) if (k.startsWith(prefix)) segs[k.slice(prefix.length)] = v;
        if ('digit' in segs) {
          input.digit = segs.digit;
          delete segs.digit;
        }
        if (Object.keys(segs).length) input.segments = segs;
      }
      m.setIndicator(input);
    }
  }

  // ---- highlights, hover, ghost -----------------------------------------------------------

  private ring(color: string, radius = 1.15): THREE.Mesh {
    const geo = this.res.geometry(`ring:${radius}`, () => new THREE.TorusGeometry(radius, 0.2, 8, 24).rotateX(Math.PI / 2));
    const mat = this.res.material(`ring-mat:${color}`, () => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 }));
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 10;
    m.raycast = () => undefined;
    return m;
  }

  private stripBox(stripId: string, color: string): THREE.Mesh | null {
    const board = this.boardIndex.get(stripId.split(':')[0]);
    if (!board) return null;
    const holes = stripHoles(board, stripId).map((h) => holePosition(board, h)!).filter(Boolean);
    if (!holes.length) return null;
    const xs = holes.map((p) => p.x);
    const ys = holes.map((p) => p.y);
    const mat = this.res.material(`strip-mat:${color}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }));
    const m = new THREE.Mesh(this.res.unitBox, mat);
    const minX = Math.min(...xs) - 1.2;
    const maxX = Math.max(...xs) + 1.2;
    const minY = Math.min(...ys) - 1.2;
    const maxY = Math.max(...ys) + 1.2;
    m.scale.set(maxX - minX, 0.3, maxY - minY);
    m.position.set((minX + maxX) / 2, 0.16, (minY + maxY) / 2);
    m.renderOrder = 5;
    m.raycast = () => undefined;
    return m;
  }

  private outline(obj: THREE.Object3D, color: string): THREE.Object3D {
    const bb = new THREE.Box3().setFromObject(obj);
    bb.expandByScalar(0.6);
    const helper = new THREE.Box3Helper(bb, new THREE.Color(color));
    helper.userData.ownGeometry = helper.geometry;
    helper.userData.ownMaterial = helper.material;
    helper.raycast = () => undefined;
    return helper;
  }

  private clearObjects(list: THREE.Object3D[]): void {
    for (const o of list) {
      this.roots.overlay.remove(o);
      disposeOwned(o);
    }
    list.length = 0;
  }

  setHighlights(h: SceneHighlights): void {
    this.highlights = h;
    this.rebuildHighlights();
    this.requestRender();
  }

  private rebuildHighlights(): void {
    if (!this.renderer) return;
    this.clearObjects(this.highlightObjects);
    const h = this.highlights;
    for (const s of h.strips ?? []) {
      const m = this.stripBox(s, h.stripColor ?? '#ffd43b');
      if (m) this.highlightObjects.push(m);
    }
    for (const mk of h.holes ?? []) {
      const p = this.holeWorld(mk.hole);
      if (!p) continue;
      const r = this.ring(mk.color, 1.35);
      r.position.set(p.x, 0.35, p.z);
      this.highlightObjects.push(r);
    }
    for (const refdes of h.refdes ?? []) {
      const obj = this.parts.get(refdes)?.item.group ?? this.devices.get(refdes)?.item.group;
      if (obj) this.highlightObjects.push(this.outline(obj, h.refdesColor ?? '#e8590c'));
    }
    const sel = h.selected;
    if (sel) {
      const obj = sel.kind === 'part' ? (this.parts.get(sel.id)?.item.group ?? this.devices.get(sel.id)?.item.group) : sel.kind === 'wire' ? this.wires.get(sel.id)?.item : this.clips.get(sel.id)?.item;
      if (obj) this.highlightObjects.push(this.outline(obj, ACCENT));
    }
    for (const o of this.highlightObjects) this.roots.overlay.add(o);
  }

  setHover(hole: BreadboardHole | null, cursor: BreadboardHole | null = this.cursor): void {
    this.hover = hole;
    this.cursor = cursor;
    this.rebuildHover();
    this.requestRender();
  }

  private rebuildHover(): void {
    if (!this.renderer) return;
    this.clearObjects(this.hoverObjects);
    const add = (h: BreadboardHole | null, color: string) => {
      const p = h && this.holeWorld(h);
      if (!p) return;
      const r = this.ring(color);
      r.position.set(p.x, 0.3, p.z);
      this.hoverObjects.push(r);
      this.roots.overlay.add(r);
    };
    add(this.hover, '#f08c00');
    add(this.cursor, '#0b7285');
  }

  /** Placement preview (lead targets) and/or a wire being drawn. */
  setGhost(leads: GhostLead[] | null, wire?: { from: BreadboardHole; to: BreadboardHole | null; color: string } | null): void {
    if (!this.renderer) return;
    this.clearObjects(this.ghostObjects);
    for (const l of leads ?? []) {
      const p = this.holeWorld(l.hole);
      if (!p) continue;
      const color = l.ok ? '#2f9e44' : '#e03131';
      const r = this.ring(color, 1.25);
      r.position.set(p.x, 0.5, p.z);
      const pinMat = this.res.material(`ghost-pin:${color}`, () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
      const pin = new THREE.Mesh(this.res.unitCylinder, pinMat);
      pin.scale.set(0.35, 5, 0.35);
      pin.position.set(p.x, 2.5, p.z);
      pin.raycast = () => undefined;
      this.ghostObjects.push(r, pin);
    }
    if (wire) {
      const a = this.holeWorld(wire.from);
      const b = wire.to ? this.holeWorld(wire.to) : null;
      if (a) {
        const r = this.ring(wire.color, 1.25);
        r.position.set(a.x, 0.5, a.z);
        this.ghostObjects.push(r);
        if (b) {
          const g = buildJumper(this.res, { id: 'ghost', from: wire.from, to: wire.to!, color: wire.color }, a, b);
          g.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) o.raycast = () => undefined;
          });
          this.ghostObjects.push(g);
        }
      }
    }
    for (const o of this.ghostObjects) this.roots.overlay.add(o);
    this.requestRender();
  }

  // ---- camera -----------------------------------------------------------------------------

  setView(preset: ViewPreset, animate = true): void {
    if (!this.controls) return;
    const b = benchBounds(this.layout.boards.length ? this.layout.boards : [{ id: 'x', kind: 'full', x: 0, y: 0 }]);
    const extraBack = this.devices.size ? 70 : 0;
    const target = new THREE.Vector3(b.x + b.w / 2, 0, b.y + b.h / 2 - extraBack / 2);
    const fov = (this.camera.fov * Math.PI) / 180;
    const fitW = b.w / this.camera.aspect;
    const size = Math.max(fitW, b.h + extraBack) * 1.12;
    const dist = size / (2 * Math.tan(fov / 2));
    const dir = preset === 'top' ? new THREE.Vector3(0, 1, 0.002) : preset === 'front' ? new THREE.Vector3(0, 0.5, 1) : new THREE.Vector3(-0.42, 0.95, 0.85);
    dir.normalize();
    const pos = target.clone().addScaledVector(dir, preset === 'top' ? dist : dist * 1.08);
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.requestRender();
      return;
    }
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const t0 = performance.now();
    cancelAnimationFrame(this.anim);
    const step = () => {
      if (this.disposed || !this.controls) return;
      const t = Math.min(1, (performance.now() - t0) / 350);
      const e = t * t * (3 - 2 * t);
      this.camera.position.lerpVectors(fromPos, pos, e);
      this.controls.target.lerpVectors(fromTarget, target, e);
      this.controls.update();
      this.render();
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  setControlsEnabled(enabled: boolean): void {
    if (this.controls) this.controls.enabled = enabled;
  }

  // ---- picking ----------------------------------------------------------------------------

  private ndc(clientX: number, clientY: number): THREE.Vector2 | null {
    if (!this.renderer) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  /** Hole under the pointer (ray through the board surface). */
  holeAt(clientX: number, clientY: number): BreadboardHole | null {
    const n = this.ndc(clientX, clientY);
    if (!n) return null;
    this.raycaster.setFromCamera(n, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
    // 2 mm covers the whole hole grid (diagonal gap ≈ 1.8 mm) but not the channel or rail gaps
    return nearestHole(this.layout.boards, p.x, p.z, 2.0);
  }

  pick(clientX: number, clientY: number): PickResult {
    const out: PickResult = { hole: this.holeAt(clientX, clientY) };
    const n = this.ndc(clientX, clientY);
    if (!n) return out;
    this.raycaster.setFromCamera(n, this.camera);
    const hits = this.raycaster.intersectObjects([this.roots.parts, this.roots.wires, this.roots.clips, this.roots.devices], true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData?.kind) o = o.parent;
      const kind = o?.userData?.kind as string | undefined;
      if (kind === 'part') out.part = o!.userData.refdes as string;
      else if (kind === 'wire') out.wire = o!.userData.id as string;
      else if (kind === 'clip') out.clip = o!.userData.id as string;
      else if (kind === 'device') out.device = o!.userData.refdes as string;
      else continue;
      break;
    }
    return out;
  }

  /** PNG data URL of the current view (hover markers hidden). */
  screenshot(): string | null {
    if (!this.renderer || this.lost) return null;
    const vis = this.hoverObjects.map((o) => o.visible);
    this.hoverObjects.forEach((o) => (o.visible = false));
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.hoverObjects.forEach((o, i) => (o.visible = vis[i]));
    this.requestRender();
    return url;
  }

  get stats(): { parts: number; wires: number; clips: number; resources: { geometries: number; materials: number; textures: number } } {
    return { parts: this.parts.size, wires: this.wires.size, clips: this.clips.size, resources: this.res.stats };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pending) cancelAnimationFrame(this.pending);
    cancelAnimationFrame(this.anim);
    this.resizeObserver?.disconnect();
    this.controls?.removeEventListener('change', this.requestRender);
    this.controls?.dispose();
    this.clearObjects(this.highlightObjects);
    this.clearObjects(this.hoverObjects);
    this.clearObjects(this.ghostObjects);
    for (const e of this.parts.values()) this.dropPart(e);
    for (const e of this.wires.values()) this.dropGroup(this.roots.wires, e.item);
    for (const e of this.clips.values()) this.dropGroup(this.roots.clips, e.item);
    for (const e of this.devices.values()) this.dropGroup(this.roots.devices, e.item.group);
    for (const e of this.boards.values()) this.dropBoard(e);
    this.parts.clear();
    this.wires.clear();
    this.clips.clear();
    this.devices.clear();
    this.boards.clear();
    if (this.bench) this.bench.geometry.dispose();
    this.res.dispose();
    const r = this.renderer;
    if (r) {
      const canvas = r.domElement;
      canvas.removeEventListener('webglcontextlost', this.onLost);
      canvas.removeEventListener('webglcontextrestored', this.onRestored);
      r.dispose();
      r.forceContextLoss();
      canvas.remove();
    }
    this.renderer = null;
  }
}
