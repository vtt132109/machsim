/**
 * Shared GPU resources of the breadboard scene.
 *
 * Geometries, materials and textures are created once per key and shared by every part that
 * needs them (a hundred resistors use one body geometry and one material per band colour).
 * `dispose()` frees everything when the view unmounts or the WebGL context is rebuilt.
 *
 * Coordinates: 1 unit = 1 mm. Bench (x, y) maps to three (x, z); +y is up and the board top
 * surface is at y = 0.
 */

import * as THREE from 'three';

export class Resources {
  private geometries = new Map<string, THREE.BufferGeometry>();
  private materials = new Map<string, THREE.Material>();
  private textures = new Map<string, THREE.Texture>();
  /** anisotropy for text textures (set from the renderer capabilities) */
  anisotropy = 4;

  geometry<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
    let g = this.geometries.get(key);
    if (!g) {
      g = make();
      this.geometries.set(key, g);
    }
    return g as T;
  }

  material<T extends THREE.Material>(key: string, make: () => T): T {
    let m = this.materials.get(key);
    if (!m) {
      m = make();
      this.materials.set(key, m);
    }
    return m as T;
  }

  texture<T extends THREE.Texture>(key: string, make: () => T): T {
    let t = this.textures.get(key);
    if (!t) {
      t = make();
      this.textures.set(key, t);
    }
    return t as T;
  }

  /** Standard (PBR) material by colour / roughness / metalness. */
  std(color: string, roughness = 0.55, metalness = 0, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const key = `std:${color}:${roughness}:${metalness}:${JSON.stringify(extra)}`;
    return this.material(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  }

  /** Lead wire metal. */
  get metal(): THREE.MeshStandardMaterial {
    return this.std('#c9ccd1', 0.32, 0.9);
  }

  get gold(): THREE.MeshStandardMaterial {
    return this.std('#d4af37', 0.3, 0.9);
  }

  /** Text rendered on a transparent canvas, cached by content and style. */
  text(text: string, opts: TextStyle = {}): THREE.CanvasTexture {
    const key = `text:${text}:${JSON.stringify(opts)}`;
    return this.texture(key, () => makeTextTexture(text, opts, this.anisotropy));
  }

  /** Material showing a text texture (transparent, unlit so it stays readable). */
  textMaterial(text: string, opts: TextStyle = {}): THREE.MeshBasicMaterial {
    const key = `textmat:${text}:${JSON.stringify(opts)}`;
    return this.material(key, () => new THREE.MeshBasicMaterial({ map: this.text(text, opts), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  }

  /** Unit cylinder (radius 1, height 1, centred) for lead segments. */
  get unitCylinder(): THREE.CylinderGeometry {
    return this.geometry('unit-cyl', () => new THREE.CylinderGeometry(1, 1, 1, 8, 1));
  }

  get unitSphere(): THREE.SphereGeometry {
    return this.geometry('unit-sphere', () => new THREE.SphereGeometry(1, 10, 8));
  }

  get unitBox(): THREE.BoxGeometry {
    return this.geometry('unit-box', () => new THREE.BoxGeometry(1, 1, 1));
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    for (const m of this.materials.values()) m.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }

  get stats(): { geometries: number; materials: number; textures: number } {
    return { geometries: this.geometries.size, materials: this.materials.size, textures: this.textures.size };
  }
}

export interface TextStyle {
  color?: string;
  background?: string;
  /** font size in canvas pixels (texture height scales with it) */
  size?: number;
  bold?: boolean;
  mono?: boolean;
  /** width / height aspect of the texture (text is fitted) */
  aspect?: number;
}

function makeTextTexture(text: string, opts: TextStyle, anisotropy: number): THREE.CanvasTexture {
  const size = opts.size ?? 48;
  const lines = text.split('\n');
  const h = Math.ceil(size * 1.3 * lines.length);
  const w = Math.ceil(h * (opts.aspect ?? Math.max(1, (Math.max(...lines.map((l) => l.length)) * 0.62 * size) / h + 0.1)));
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2048, w);
  canvas.height = Math.min(1024, h);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.fillStyle = opts.color ?? '#e8e8e8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const family = opts.mono ? 'Consolas, "Cascadia Mono", monospace' : '"Segoe UI", Arial, sans-serif';
    let fs = size;
    const fit = () => {
      ctx.font = `${opts.bold ? 'bold ' : ''}${fs}px ${family}`;
      return Math.max(...lines.map((l) => ctx.measureText(l).width));
    };
    while (fit() > canvas.width * 0.94 && fs > 6) fs -= 2;
    lines.forEach((l, i) => ctx.fillText(l, canvas.width / 2, (canvas.height / lines.length) * (i + 0.5)));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  return tex;
}

// ---------------------------------------------------------------------------------------------
// small mesh helpers

const UP = new THREE.Vector3(0, 1, 0);

/** Cylinder segment between two points (shared unit geometry, scaled). */
export function segment(res: Resources, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const m = new THREE.Mesh(res.unitCylinder, material);
  m.position.copy(a).addScaledVector(dir, 0.5);
  if (len > 1e-9) m.quaternion.setFromUnitVectors(UP, dir.normalize());
  m.scale.set(radius, Math.max(len, 1e-4), radius);
  return m;
}

/** Polyline of cylinder segments with rounded joints. */
export function polyline(res: Resources, pts: THREE.Vector3[], radius: number, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i + 1 < pts.length; i++) g.add(segment(res, pts[i], pts[i + 1], radius, material));
  for (let i = 1; i + 1 < pts.length; i++) {
    const s = new THREE.Mesh(res.unitSphere, material);
    s.position.copy(pts[i]);
    s.scale.setScalar(radius);
    g.add(s);
  }
  return g;
}

export function box(res: Resources, w: number, h: number, d: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(res.unitBox, material);
  m.scale.set(w, h, d);
  return m;
}

/** Flat text label (plane) facing +y (lying on a top surface) or +z (on a front face). */
export function label(res: Resources, text: string, width: number, height: number, facing: 'up' | 'front', style: TextStyle = {}): THREE.Mesh {
  const geo = res.geometry('plane1', () => new THREE.PlaneGeometry(1, 1));
  const m = new THREE.Mesh(geo, res.textMaterial(text, { aspect: width / height, ...style }));
  m.scale.set(width, height, 1);
  if (facing === 'up') m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  return m;
}

/** Dispose geometries owned by an object tree that are not shared resources. */
export function disposeOwned(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const own = o.userData.ownGeometry as THREE.BufferGeometry | undefined;
    if (own) own.dispose();
    const ownMat = o.userData.ownMaterial as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(ownMat)) ownMat.forEach((m) => m.dispose());
    else if (ownMat) ownMat.dispose();
  });
}
