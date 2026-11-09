/**
 * Procedural 3D models of breadboard parts (original designs, 1 unit = 1 mm).
 *
 * Every model is built in a local frame derived from its lead holes: +x runs from the first lead
 * towards the next lead along the part, +z is the part's front (towards the viewer for an
 * unrotated part) and +y is up; the board surface is y = 0 and leads end 1.2 mm inside the holes.
 * The body therefore always follows the actual placement (bent leads, rotation, wrong rows …).
 *
 * Models: axial resistor (colour bands from the value), diode (cathode band), inductor (µH bands),
 * fuse; ceramic disc capacitor (printed code), electrolytic capacitor (stripe on the − side,
 * printed value), 5 mm LED (flat on the cathode side, longer anode, glows from the indicator
 * level), crystal, thermistor, LDR, lamp, trimmer; TO-92 / TO-220 with the part number printed;
 * DIP with notch, pin-1 dot and label; potentiometer (knob follows the wiper %), slide / toggle
 * switches and push button (follow their state), 7-segment display and bar graph (segments lit
 * from levels), buzzer, pin header, and a generic labelled box.
 */

import * as THREE from 'three';
import type { BreadboardHole, PartPlacement } from '../types';
import type { PhysicalPart } from '../compare';
import { defaultParams } from '../../library';
import { parseUserNumber } from '../../util/units';
import { BAND_HEX, capacitorCode, electrolyticMarking, inductorBands, resistorBands, type BandColor } from '../markings';
import { box, label, polyline, segment, type Resources } from './resources';

export const LEAD_R = 0.3;
const HOLE_DEPTH = -1.2;

export interface IndicatorInput {
  /** overall brightness 0..1 (7-segment: values > 1 are a segment bit mask, bit 0 = a … bit 7 = dp) */
  level: number;
  /** per-segment brightness (7-segment: a … g, dp; bar graph: 1 … 10) */
  segments?: Record<string, number>;
  /** decoded hexadecimal digit 0..15 for a 7-segment / hex display */
  digit?: number;
}

/** Segments lit for each hexadecimal digit. */
export const HEX_SEGMENTS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg'];
const SEG_ORDER = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];

/** Brightness of each 7-segment element for an indicator input. */
export function sevenSegLevels(input: IndicatorInput): Record<string, number> {
  const out: Record<string, number> = {};
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  if (input.segments && Object.keys(input.segments).length) {
    for (const s of SEG_ORDER) out[s] = clamp(input.segments[s] ?? 0);
  } else if (input.digit !== undefined && Number.isFinite(input.digit)) {
    const glyph = HEX_SEGMENTS[((Math.round(input.digit) % 16) + 16) % 16];
    for (const s of SEG_ORDER) out[s] = glyph.includes(s) && s !== 'dp' ? 1 : 0;
  } else if (input.level > 1 && Number.isInteger(input.level)) {
    SEG_ORDER.forEach((s, i) => (out[s] = (input.level >> i) & 1));
  } else {
    for (const s of SEG_ORDER) out[s] = clamp(input.level);
  }
  return out;
}

export interface PartModel {
  group: THREE.Group;
  setIndicator?(input: IndicatorInput): void;
  dispose(): void;
}

export interface PartModelInput {
  part: PhysicalPart;
  placement: PartPlacement;
  /** world position (board surface) of a hole, or null when it does not exist */
  holePos(h: BreadboardHole): THREE.Vector3 | null;
  res: Resources;
}

export const LED_COLORS: Record<string, string> = {
  red: '#ff2a1a',
  orange: '#ff8c1a',
  yellow: '#ffd21a',
  green: '#22d64a',
  blue: '#2f6bff',
  white: '#f2f6ff',
  infrared: '#7a2a52',
  clear: '#dfe8f0',
};

// ---------------------------------------------------------------------------------------------
// frame

interface Frame {
  group: THREE.Group;
  /** local position of a lead (x, z) at the board surface */
  lead: Record<string, THREE.Vector3>;
  keys: string[];
}

/** Local frame from the placed leads; null when no lead is on the board. */
function makeFrame(input: PartModelInput, axisKeys?: [string, string]): Frame | null {
  const { part, placement } = input;
  const keys = part.map.leads.map((l) => l.key).filter((k) => placement.pins[k] && input.holePos(placement.pins[k]));
  if (!keys.length) return null;
  const world: Record<string, THREE.Vector3> = {};
  for (const k of keys) world[k] = input.holePos(placement.pins[k])!;
  const [ka, kb] = axisKeys && world[axisKeys[0]] && world[axisKeys[1]] ? axisKeys : [keys[0], keys[keys.length - 1]];
  const a = world[ka];
  let b = world[kb];
  if (a.distanceTo(b) < 1e-6) {
    // single lead or coincident leads: orient by the stored rotation (clockwise seen from above)
    const r = ((placement.rotation ?? 0) * Math.PI) / 180;
    b = a.clone().add(new THREE.Vector3(Math.cos(r), 0, Math.sin(r)));
  }
  const center = new THREE.Vector3();
  for (const k of keys) center.add(world[k]);
  center.multiplyScalar(1 / keys.length);
  const axis = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
  const group = new THREE.Group();
  group.position.set(center.x, 0, center.z);
  group.rotation.y = Math.atan2(-axis.z, axis.x);
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const lead: Record<string, THREE.Vector3> = {};
  for (const k of keys) lead[k] = world[k].clone().applyMatrix4(inv).setY(0);
  group.userData = { kind: 'part', refdes: placement.refdes };
  return { group, lead, keys };
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function params(part: PhysicalPart): Record<string, string> {
  return { ...defaultParams(part.def), ...part.inst.params };
}

const num = (p: Record<string, string>, key: string, fallback: number): number => {
  const v = parseUserNumber(p[key] ?? '');
  return Number.isFinite(v) ? v : fallback;
};

/** Straight lead from a body exit point down into the hole (with a bend when offset). */
function lead(res: Resources, from: THREE.Vector3, hole: THREE.Vector3, mat: THREE.Material = res.metal, r = LEAD_R): THREE.Object3D {
  const bottom = V(hole.x, HOLE_DEPTH, hole.z);
  const dx = Math.hypot(from.x - hole.x, from.z - hole.z);
  if (dx < 0.05) return segment(res, from, bottom, r, mat);
  const knee = V(hole.x, Math.min(from.y, Math.max(0.6, from.y - dx)), hole.z);
  return polyline(res, [from, knee, bottom], r, mat);
}

// ---------------------------------------------------------------------------------------------
// shared shapes

function axialProfile(length: number, radius: number, bulge: boolean): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  const n = 28;
  const capLen = radius * 0.6;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const y = -length / 2 + t * length;
    // rounded end caps
    const edge = Math.min(t, 1 - t) * length;
    const cap = edge < capLen ? Math.sqrt(Math.max(0, 1 - ((capLen - edge) / capLen) ** 2)) : 1;
    // "dog bone": full radius over the end thirds, 86 % in the middle, cosine blend between
    const d = Math.abs(t - 0.5);
    const blend = d >= 0.3 ? 1 : d <= 0.15 ? 0 : 0.5 - 0.5 * Math.cos(((d - 0.15) / 0.15) * Math.PI);
    const mid = bulge ? 0.86 + 0.14 * blend : 1;
    pts.push(new THREE.Vector2(Math.max(0.001, radius * mid * cap), y));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateZ(-Math.PI / 2); // lathe axis (y) -> x
  return g;
}

function bandGeometry(res: Resources, radius: number, width: number): THREE.CylinderGeometry {
  return res.geometry(`band:${radius.toFixed(2)}:${width}`, () => {
    const g = new THREE.CylinderGeometry(radius, radius, width, 20, 1, true);
    g.rotateZ(Math.PI / 2);
    return g;
  });
}

function bandMaterial(res: Resources, c: BandColor): THREE.Material {
  const metal = c === 'gold' || c === 'silver';
  return res.std(BAND_HEX[c], metal ? 0.35 : 0.6, metal ? 0.8 : 0);
}

// ---------------------------------------------------------------------------------------------
// axial parts

interface AxialStyle {
  length: number;
  radius: number;
  bodyMat: THREE.Material;
  bulge: boolean;
  bands: { x: number; color: BandColor; width?: number }[];
  extra?: (g: THREE.Group, length: number, radius: number) => void;
}

function axial(input: PartModelInput, style: AxialStyle): PartModel | null {
  const f = makeFrame(input);
  if (!f || f.keys.length < 2) return f ? generic(input) : null;
  const { res } = input;
  const [k0, k1] = f.keys;
  const p0 = f.lead[k0];
  const p1 = f.lead[k1];
  const span = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  const body = new THREE.Group();
  const bodyMesh = new THREE.Mesh(res.geometry(`axial:${style.length}:${style.radius}:${style.bulge}`, () => axialProfile(style.length, style.radius, style.bulge)), style.bodyMat);
  body.add(bodyMesh);
  for (const b of style.bands) {
    const t = (b.x + style.length / 2) / style.length;
    const prof = style.bulge && Math.abs(t - 0.5) > 0.3 ? 1 : style.bulge ? 0.88 : 1;
    const m = new THREE.Mesh(bandGeometry(res, style.radius * prof + 0.03, b.width ?? style.length * 0.075), bandMaterial(res, b.color));
    m.position.x = b.x;
    body.add(m);
  }
  style.extra?.(body, style.length, style.radius);
  const g = f.group;
  if (span >= style.length + 1.2) {
    const h = style.radius + 1.0;
    body.position.set((p0.x + p1.x) / 2, h, (p0.z + p1.z) / 2);
    body.rotation.y = -Math.atan2(p1.z - p0.z, p1.x - p0.x);
    g.add(body);
    const dir = new THREE.Vector3(p1.x - p0.x, 0, p1.z - p0.z).normalize();
    const e0 = body.position.clone().addScaledVector(dir, -style.length / 2 + 0.1);
    const e1 = body.position.clone().addScaledVector(dir, style.length / 2 - 0.1);
    g.add(polyline(res, [e0, V(p0.x, h, p0.z), V(p0.x, HOLE_DEPTH, p0.z)], LEAD_R, res.metal));
    g.add(polyline(res, [e1, V(p1.x, h, p1.z), V(p1.x, HOLE_DEPTH, p1.z)], LEAD_R, res.metal));
  } else {
    // standing mount: body upright over the first lead, second lead loops over the top
    const bottom = 1.0;
    body.rotation.z = Math.PI / 2;
    body.position.set(p0.x, bottom + style.length / 2, p0.z);
    g.add(body);
    const top = bottom + style.length + 1.2;
    g.add(segment(res, V(p0.x, bottom + 0.1, p0.z), V(p0.x, HOLE_DEPTH, p0.z), LEAD_R, res.metal));
    g.add(polyline(res, [V(p0.x, bottom + style.length - 0.1, p0.z), V(p0.x, top, p0.z), V(p1.x, top, p1.z), V(p1.x, HOLE_DEPTH, p1.z)], LEAD_R, res.metal));
  }
  return { group: g, dispose: () => undefined };
}

function resistorModel(input: PartModelInput): PartModel | null {
  const p = params(input.part);
  const code = resistorBands(num(p, 'value', 1000), { tolerance: num(p, 'tolerance', 5) });
  const watts = num(p, 'power', 0.25);
  const length = watts >= 1 ? 11 : watts >= 0.5 ? 8.5 : 6.3;
  const radius = watts >= 1 ? 2.2 : watts >= 0.5 ? 1.6 : 1.2;
  const five = (code?.bands.length ?? 4) >= 5;
  const bands: AxialStyle['bands'] = [];
  if (code) {
    const n = code.bands.length;
    const digitsAndMult = n === 3 ? 3 : n - 1;
    const start = -length / 2 + length * 0.2;
    const step = length * (five ? 0.11 : 0.13);
    for (let i = 0; i < digitsAndMult; i++) bands.push({ x: start + i * step, color: code.bands[i] });
    if (n > 3) bands.push({ x: length / 2 - length * 0.18, color: code.bands[n - 1] });
  }
  return axial(input, { length, radius, bulge: true, bodyMat: input.res.std(five ? '#7fb0dc' : '#dcc79b', 0.7, 0), bands });
}

function diodeModel(input: PartModelInput): PartModel | null {
  const glass = input.part.def.footprint === 'DO-35';
  const length = glass ? 3.8 : 5.0;
  const radius = glass ? 0.95 : 1.35;
  const bodyMat = glass ? input.res.std('#e0812e', 0.15, 0, { transparent: true, opacity: 0.82 }) : input.res.std('#1d1d1f', 0.5, 0);
  // the second template lead is the cathode (K): band at +x
  return axial(input, { length, radius, bulge: false, bodyMat, bands: [{ x: length / 2 - length * 0.17, color: glass ? 'black' : 'silver', width: length * 0.14 }] });
}

function inductorModel(input: PartModelInput): PartModel | null {
  const p = params(input.part);
  const code = inductorBands(num(p, 'value', 1e-3), num(p, 'tolerance', 10));
  const length = 7.5;
  const bands: AxialStyle['bands'] = [];
  if (code) {
    code.bands.slice(0, -1).forEach((c, i) => bands.push({ x: -length / 2 + length * (0.22 + i * 0.13), color: c }));
    bands.push({ x: length / 2 - length * 0.2, color: code.bands[code.bands.length - 1] });
  }
  return axial(input, { length, radius: 1.7, bulge: true, bodyMat: input.res.std('#4a8d5c', 0.6, 0), bands });
}

function fuseModel(input: PartModelInput): PartModel | null {
  const res = input.res;
  return axial(input, {
    length: 10,
    radius: 1.5,
    bulge: false,
    bodyMat: res.std('#dfe9f1', 0.05, 0, { transparent: true, opacity: 0.35 }),
    bands: [
      { x: -4.2, color: 'silver', width: 1.6 },
      { x: 4.2, color: 'silver', width: 1.6 },
    ],
    extra: (g) => {
      const w = segment(res, V(-3.6, 0, 0), V(3.6, 0, 0), 0.12, res.metal);
      g.add(w);
    },
  });
}

// ---------------------------------------------------------------------------------------------
// radial parts

function twoLeads(f: Frame): [THREE.Vector3, THREE.Vector3] {
  const a = f.lead[f.keys[0]];
  const b = f.lead[f.keys[1]] ?? a.clone().add(V(2.54, 0, 0));
  return [a, b];
}

function ceramicModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const p = params(input.part);
  const farads = num(p, 'value', 100e-9);
  const big = farads >= 1e-9;
  const r = farads >= 1e-6 ? 3.0 : big ? 2.5 : 2.1;
  const disc = new THREE.Mesh(
    res.geometry(`disc:${r}`, () => {
      const g = new THREE.CylinderGeometry(r, r, 1.5, 28);
      g.rotateX(Math.PI / 2);
      return g;
    }),
    res.std(big ? '#3f6fc4' : '#d9903b', 0.55, 0),
  );
  const [a, b] = twoLeads(f);
  const cx = (a.x + b.x) / 2;
  const h = 1.8 + r;
  disc.position.set(cx, h, (a.z + b.z) / 2);
  f.group.add(disc);
  const code = capacitorCode(farads, num(p, 'tolerance', NaN))?.code ?? '?';
  const txt = label(res, code, r * 1.6, r * 0.8, 'front', { color: big ? '#f2f2f2' : '#3a2410', bold: true });
  txt.position.set(cx, h, disc.position.z + 0.78);
  f.group.add(txt);
  for (const [pt, s] of [[a, -1], [b, 1]] as const) {
    const top = V(cx + s * Math.min(Math.abs(b.x - a.x) / 2, r * 0.55), 1.9, pt.z);
    f.group.add(polyline(res, [top, V(pt.x, 0.9, pt.z), V(pt.x, HOLE_DEPTH, pt.z)], LEAD_R, res.metal));
  }
  return { group: f.group, dispose: () => undefined };
}

function electrolyticTexture(res: Resources, marking: string): THREE.CanvasTexture {
  return res.texture(`elco:${marking}`, () => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1f2f66';
    ctx.fillRect(0, 0, 512, 256);
    // stripe centred at u = 0.75 (local +x, the − lead)
    ctx.fillStyle = '#c9d0da';
    ctx.fillRect(512 * 0.66, 0, 512 * 0.18, 256);
    ctx.fillStyle = '#1f2f66';
    ctx.font = 'bold 54px "Segoe UI", Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) ctx.fillText('−', 512 * 0.75, 30 + i * 64);
    ctx.fillStyle = '#e7ebf2';
    ctx.font = 'bold 40px "Segoe UI", Arial';
    ctx.save();
    ctx.translate(512 * 0.5, 128);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(marking, 0, 0);
    ctx.restore();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = res.anisotropy;
    return t;
  });
}

function electrolyticModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const p = params(input.part);
  const farads = num(p, 'value', 10e-6);
  const volts = num(p, 'vrating', 25);
  const [r, h] = farads >= 1e-3 ? [5, 13] : farads >= 100e-6 ? [4, 11] : farads >= 33e-6 ? [3.15, 8] : [2.5, 7];
  const marking = electrolyticMarking(farads, volts);
  const tex = electrolyticTexture(res, marking);
  const body = new THREE.Mesh(
    res.geometry(`elco-body:${r}:${h}`, () => {
      const g = new THREE.CylinderGeometry(r, r, h, 32, 1, true, -Math.PI, Math.PI * 2);
      g.translate(0, h / 2, 0);
      return g;
    }),
    res.material(`elco-mat:${marking}`, () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 })),
  );
  const [a, b] = twoLeads(f);
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  body.position.set(cx, 0.6, cz);
  f.group.add(body);
  const top = new THREE.Mesh(res.geometry(`elco-top:${r}`, () => new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2)), res.std('#b9bec6', 0.3, 0.85));
  top.position.set(cx, 0.6 + h, cz);
  f.group.add(top);
  const vent = box(res, r * 1.2, 0.05, 0.25, res.std('#7d838c', 0.4, 0.6));
  vent.position.set(cx, 0.62 + h, cz);
  f.group.add(vent);
  const vent2 = vent.clone();
  vent2.rotation.y = Math.PI / 2;
  f.group.add(vent2);
  const bottom = new THREE.Mesh(res.geometry(`elco-bot:${r}`, () => new THREE.CircleGeometry(r, 32).rotateX(Math.PI / 2)), res.std('#202020', 0.8, 0));
  bottom.position.set(cx, 0.6, cz);
  f.group.add(bottom);
  for (const [pt, s] of [[a, -1], [b, 1]] as const) {
    const exit = V(cx + s * Math.min(r * 0.45, 1.25), 0.6, cz);
    f.group.add(lead(res, exit, pt));
  }
  return { group: f.group, dispose: () => undefined };
}

function glowTexture(res: Resources): THREE.CanvasTexture {
  return res.texture('glow', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

function makeGlow(res: Resources, color: string): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({ map: glowTexture(res), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.visible = false;
  s.userData.ownMaterial = mat;
  s.raycast = () => undefined;
  return s;
}

function ledModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const p = params(input.part);
  const colorName = input.part.def.footprint === 'PD-5MM' ? 'clear' : (p.color ?? 'red').toLowerCase();
  const color = LED_COLORS[colorName] ?? LED_COLORS.red;
  const [a, b] = twoLeads(f);
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  const base = 2.2;
  const epoxy = new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.78, emissive: new THREE.Color(color), emissiveIntensity: 0 });
  const domeGeo = res.geometry('led-dome', () => {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0), new THREE.Vector2(2.5, 0), new THREE.Vector2(2.5, 4.1)];
    for (let i = 1; i <= 10; i++) {
      const t = (i / 10) * (Math.PI / 2);
      pts.push(new THREE.Vector2(2.5 * Math.cos(t), 4.1 + 2.5 * Math.sin(t)));
    }
    return new THREE.LatheGeometry(pts, 28);
  });
  const dome = new THREE.Mesh(domeGeo, epoxy);
  dome.position.set(cx, base + 1.0, cz);
  dome.userData.ownMaterial = epoxy;
  f.group.add(dome);
  // flange with the flat on the cathode (+x) side
  const flangeGeo = res.geometry('led-flange', () => {
    const s = new THREE.Shape();
    const R = 2.95;
    const flat = 2.45;
    const ang = Math.acos(flat / R);
    s.absarc(0, 0, R, ang, Math.PI * 2 - ang, false);
    s.lineTo(flat, R * Math.sin(ang));
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.0, bevelEnabled: false, curveSegments: 24 });
    g.rotateX(-Math.PI / 2);
    return g;
  });
  const flange = new THREE.Mesh(flangeGeo, epoxy);
  flange.position.set(cx, base, cz);
  f.group.add(flange);
  // lead frame inside: anvil (cathode) and post (anode)
  const frameMat = res.std('#8a8f96', 0.4, 0.7);
  const anvil = box(res, 1.2, 2.6, 0.5, frameMat);
  anvil.position.set(cx + 0.9, base + 2.4, cz);
  const post = box(res, 0.5, 2.0, 0.5, frameMat);
  post.position.set(cx - 0.9, base + 2.1, cz);
  f.group.add(anvil, post);
  // leads: the anode (first, -x) has a knee so it reads as the longer lead
  const ax = cx - 1.27;
  const kx = cx + 1.27;
  f.group.add(polyline(res, [V(ax, base + 0.1, cz), V(ax, base - 0.6, cz), V(ax - 0.5, base - 1.0, cz), V(a.x, 0.4, a.z), V(a.x, HOLE_DEPTH, a.z)], LEAD_R * 0.9, res.metal));
  f.group.add(polyline(res, [V(kx, base + 0.1, cz), V(b.x, 0.5, b.z), V(b.x, HOLE_DEPTH, b.z)], LEAD_R * 0.9, res.metal));
  const glow = makeGlow(res, color);
  glow.position.set(cx, base + 5.4, cz);
  f.group.add(glow);
  return {
    group: f.group,
    setIndicator: ({ level }) => {
      const l = Math.max(0, Math.min(1, level));
      epoxy.emissiveIntensity = l * 2.2;
      epoxy.opacity = 0.78 + 0.2 * l;
      glow.visible = l > 0.02;
      (glow.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.25 + l);
      glow.scale.setScalar(6 + 16 * l);
    },
    dispose: () => {
      epoxy.dispose();
      (glow.material as THREE.Material).dispose();
    },
  };
}

function lampModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const [a, b] = twoLeads(f);
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  const glass = new THREE.MeshStandardMaterial({ color: '#f3f0e6', roughness: 0.05, transparent: true, opacity: 0.4, emissive: new THREE.Color('#ffc46b'), emissiveIntensity: 0 });
  const bulb = new THREE.Mesh(res.geometry('lamp-bulb', () => new THREE.SphereGeometry(3.2, 24, 16)), glass);
  bulb.position.set(cx, 6.2, cz);
  f.group.add(bulb);
  const filMat = new THREE.MeshStandardMaterial({ color: '#5b4a3a', emissive: new THREE.Color('#ffb347'), emissiveIntensity: 0 });
  const fil = new THREE.Mesh(res.geometry('lamp-fil', () => new THREE.TorusGeometry(1.0, 0.12, 6, 18, Math.PI)), filMat);
  fil.position.set(cx, 6.0, cz);
  f.group.add(fil);
  const baseMesh = new THREE.Mesh(res.geometry('lamp-base', () => new THREE.CylinderGeometry(1.8, 1.8, 2.4, 20)), res.std('#b8bcc2', 0.3, 0.8));
  baseMesh.position.set(cx, 2.6, cz);
  f.group.add(baseMesh);
  f.group.add(lead(res, V(cx - 0.8, 1.4, cz), a), lead(res, V(cx + 0.8, 1.4, cz), b));
  const glow = makeGlow(res, '#ffd27a');
  glow.position.set(cx, 6.2, cz);
  f.group.add(glow);
  return {
    group: f.group,
    setIndicator: ({ level }) => {
      const l = Math.max(0, Math.min(1, level));
      glass.emissiveIntensity = l * 1.6;
      filMat.emissiveIntensity = l * 4;
      glow.visible = l > 0.02;
      (glow.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.2 + l);
      glow.scale.setScalar(8 + 20 * l);
    },
    dispose: () => {
      glass.dispose();
      filMat.dispose();
      (glow.material as THREE.Material).dispose();
    },
  };
}

function smallRadial(input: PartModelInput, kind: 'crystal' | 'thermistor' | 'ldr' | 'trimmer'): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const [a, b] = twoLeads(f);
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  const p = params(input.part);
  let exitY = 0.8;
  if (kind === 'crystal') {
    const fs = num(p, 'fs', 4e6);
    if (input.part.def.footprint === 'XTAL-TUNING-FORK') {
      const can = new THREE.Mesh(res.geometry('xtal-fork', () => new THREE.CylinderGeometry(1.0, 1.0, 6, 16).rotateZ(Math.PI / 2)), res.std('#c7ccd2', 0.25, 0.9));
      can.position.set(cx + 3.5, 1.2, cz);
      f.group.add(can);
      f.group.add(lead(res, V(cx + 0.5, 1.2, cz - 0.3), a), lead(res, V(cx + 0.5, 1.2, cz + 0.3), b));
      return { group: f.group, dispose: () => undefined };
    }
    const can = new THREE.Mesh(
      res.geometry('hc49', () => {
        const s = new THREE.Shape();
        s.absarc(-3.4, 0, 2.1, Math.PI / 2, (3 * Math.PI) / 2, false);
        s.absarc(3.4, 0, 2.1, -Math.PI / 2, Math.PI / 2, false);
        const g = new THREE.ExtrudeGeometry(s, { depth: 3.6, bevelEnabled: true, bevelSize: 0.2, bevelThickness: 0.2, bevelSegments: 2 });
        g.rotateX(-Math.PI / 2);
        return g;
      }),
      res.std('#c9ced4', 0.22, 0.92),
    );
    can.position.set(cx, 0.6, cz);
    f.group.add(can);
    const t = label(res, fs >= 1e6 ? `${(fs / 1e6).toFixed(3)}` : `${(fs / 1e3).toFixed(3)}K`, 6, 1.6, 'front', { color: '#30343a', bold: true });
    t.position.set(cx, 2.6, cz + 2.35);
    f.group.add(t);
    exitY = 0.7;
  } else if (kind === 'thermistor') {
    const bead = new THREE.Mesh(res.unitSphere, res.std('#2f3d2c', 0.5, 0));
    bead.scale.set(1.9, 1.6, 1.2);
    bead.position.set(cx, 4.0, cz);
    f.group.add(bead);
    exitY = 3.0;
  } else if (kind === 'ldr') {
    const disc = new THREE.Mesh(res.geometry('ldr', () => new THREE.CylinderGeometry(2.6, 2.6, 1.8, 24)), res.std('#e2d6bf', 0.5, 0));
    disc.position.set(cx, 3.2, cz);
    f.group.add(disc);
    const zig = label(res, '≋', 3.6, 3.6, 'up', { color: '#c2521f', bold: true, size: 96 });
    zig.position.set(cx, 4.12, cz);
    f.group.add(zig);
    exitY = 2.3;
  } else {
    const body = box(res, 5, 3, 5, res.std('#f0f0ea', 0.6, 0));
    body.position.set(cx, 2.0, cz);
    const screw = new THREE.Mesh(res.geometry('trim-screw', () => new THREE.CylinderGeometry(1.4, 1.4, 0.6, 18)), res.std('#c3c7cc', 0.3, 0.8));
    screw.position.set(cx, 3.8, cz);
    const slot = box(res, 2.2, 0.2, 0.35, res.std('#555', 0.5, 0.3));
    slot.position.set(cx, 4.1, cz);
    slot.rotation.y = ((num(p, 'percent', 50) - 50) / 100) * Math.PI;
    f.group.add(body, screw, slot);
    exitY = 0.5;
  }
  f.group.add(lead(res, V(cx - 0.9, exitY, cz), a), lead(res, V(cx + 0.9, exitY, cz), b));
  return { group: f.group, dispose: () => undefined };
}

// ---------------------------------------------------------------------------------------------
// transistor packages

function to92Model(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const pts = f.keys.map((k) => f.lead[k]);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const bottom = 3.0;
  const body = new THREE.Mesh(
    res.geometry('to92', () => {
      const g = new THREE.CylinderGeometry(2.4, 2.4, 4.8, 28, 1, false, Math.PI / 2, Math.PI);
      g.translate(0, 2.4, 0);
      return g;
    }),
    res.std('#1b1b1d', 0.55, 0),
  );
  body.position.set(cx, bottom, cz);
  f.group.add(body);
  const face = box(res, 4.8, 4.8, 0.02, res.std('#1b1b1d', 0.55, 0));
  face.position.set(cx, bottom + 2.4, cz);
  f.group.add(face);
  const t = label(res, input.part.map.label, 4.3, 1.5, 'front', { color: '#d9d9d9', bold: true });
  t.position.set(cx, bottom + 3.2, cz + 0.03);
  f.group.add(t);
  f.keys.forEach((k, i) => {
    const exitX = cx + (i - (f.keys.length - 1) / 2) * 1.27;
    f.group.add(lead(res, V(exitX, bottom, cz - 0.4), f.lead[k], res.metal, 0.22));
  });
  return { group: f.group, dispose: () => undefined };
}

function to220Model(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const pts = f.keys.map((k) => f.lead[k]);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const small = input.part.def.footprint === 'TO-126' || input.part.def.footprint === 'SOT-223';
  const W = small ? 7.8 : 10;
  const Hb = small ? 7.5 : 9;
  const bottom = 4.0;
  const body = box(res, W, Hb, small ? 2.8 : 4.4, res.std('#1d1d1f', 0.6, 0));
  body.position.set(cx, bottom + Hb / 2, cz + 0.4);
  f.group.add(body);
  if (!small) {
    const tab = new THREE.Mesh(
      res.geometry('to220-tab', () => {
        const s = new THREE.Shape();
        s.moveTo(-5, 0);
        s.lineTo(5, 0);
        s.lineTo(5, 6.2);
        s.lineTo(-5, 6.2);
        s.closePath();
        const hole = new THREE.Path();
        hole.absarc(0, 3.0, 1.8, 0, Math.PI * 2, true);
        s.holes.push(hole);
        return new THREE.ExtrudeGeometry(s, { depth: 1.3, bevelEnabled: false, curveSegments: 20 });
      }),
      res.std('#c5c9ce', 0.3, 0.9),
    );
    tab.position.set(cx, bottom + Hb, cz - 1.8);
    f.group.add(tab);
    const back = box(res, W, Hb, 1.3, res.std('#c5c9ce', 0.3, 0.9));
    back.position.set(cx, bottom + Hb / 2, cz - 1.15);
    f.group.add(back);
  }
  const t = label(res, input.part.map.label, W * 0.86, 1.9, 'front', { color: '#dcdcdc', bold: true });
  t.position.set(cx, bottom + Hb * 0.62, cz + 0.4 + (small ? 1.42 : 2.22));
  f.group.add(t);
  const legMat = res.std('#c9a95a', 0.35, 0.85);
  f.keys.forEach((k, i) => {
    const exitX = cx + (i - (f.keys.length - 1) / 2) * 2.54;
    f.group.add(lead(res, V(exitX, bottom + 0.2, cz + 0.4), f.lead[k], legMat, 0.35));
  });
  return { group: f.group, dispose: () => undefined };
}

// ---------------------------------------------------------------------------------------------
// DIP-like packages

interface DipFrame extends Frame {
  /** half the pin count */
  half: number;
  pitchX: number;
}

function dipFrame(input: PartModelInput): DipFrame | null {
  const leads = input.part.map.leads;
  const n = input.part.map.dipPins ?? leads.length;
  const half = Math.max(1, Math.ceil(n / 2));
  const first = leads[0]?.key;
  const lastBottom = leads[half - 1]?.key;
  const f = makeFrame(input, first && lastBottom ? [first, lastBottom] : undefined);
  if (!f) return null;
  return { ...f, half, pitchX: 2.54 };
}

function dipBodyGeometry(res: Resources, length: number, width: number, height: number, notch: boolean): THREE.BufferGeometry {
  return res.geometry(`dip-body:${length.toFixed(2)}:${width}:${height}:${notch}`, () => {
    const s = new THREE.Shape();
    const L = length / 2;
    const W = width / 2;
    s.moveTo(-L, -W);
    s.lineTo(L, -W);
    s.lineTo(L, W);
    s.lineTo(-L, W);
    if (notch) {
      s.lineTo(-L, 1.0);
      s.absarc(-L, 0, 1.0, Math.PI / 2, -Math.PI / 2, true);
    }
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 1, curveSegments: 16 });
    g.rotateX(-Math.PI / 2);
    return g;
  });
}

/** Body centre (local) of a DIP-like part: midway between the two pin rows. */
function dipCenter(f: DipFrame): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const k of f.keys) c.add(f.lead[k]);
  return c.multiplyScalar(1 / f.keys.length);
}

function dipPins(res: Resources, f: DipFrame, center: THREE.Vector3, bodyHalfWidth: number, shoulderY: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const k of f.keys) {
    const h = f.lead[k];
    const side = Math.sign(h.z - center.z) || 1;
    const edge = V(h.x, shoulderY, center.z + side * bodyHalfWidth);
    const over = V(h.x, shoulderY, h.z);
    const s1 = segment(res, edge, over, 0.28, mat);
    const s2 = segment(res, over, V(h.x, HOLE_DEPTH, h.z), 0.24, mat);
    g.add(s1, s2);
  }
  return g;
}

function dipModel(input: PartModelInput): PartModel | null {
  const f = dipFrame(input);
  if (!f) return null;
  const { res } = input;
  const c = dipCenter(f);
  const length = f.half * 2.54 + 0.5;
  const width = 6.3;
  const height = 3.2;
  const bottom = 0.9;
  const body = new THREE.Mesh(dipBodyGeometry(res, length, width, height, true), res.std('#202124', 0.65, 0));
  body.position.set(c.x, bottom, c.z);
  f.group.add(body);
  const top = bottom + height + 0.16;
  const dot = new THREE.Mesh(res.geometry('dip-dot', () => new THREE.CircleGeometry(0.55, 16).rotateX(-Math.PI / 2)), res.std('#3a3b3e', 0.9, 0));
  dot.position.set(c.x - length / 2 + 1.6, top + 0.01, c.z + width / 2 - 1.3);
  f.group.add(dot);
  const t = label(res, `${input.part.map.label}\n${input.placement.refdes}`, Math.min(length - 2.6, 18), 4.0, 'up', { color: '#d6d6d6', bold: true, size: 40 });
  t.position.set(c.x + 0.6, top + 0.02, c.z);
  f.group.add(t);
  f.group.add(dipPins(res, f, c, width / 2, 1.7, res.std('#c9ccd1', 0.3, 0.9)));
  return { group: f.group, dispose: () => undefined };
}

const SEGMENT_LAYOUT: Record<string, { x: number; z: number; horizontal: boolean }> = {
  a: { x: 0, z: -6, horizontal: true },
  b: { x: 3, z: -3, horizontal: false },
  c: { x: 3, z: 3, horizontal: false },
  d: { x: 0, z: 6, horizontal: true },
  e: { x: -3, z: 3, horizontal: false },
  f: { x: -3, z: -3, horizontal: false },
  g: { x: 0, z: 0, horizontal: true },
};

function segmentMaterial(color: string): THREE.MeshStandardMaterial {
  const off = new THREE.Color(color).multiplyScalar(0.16);
  return new THREE.MeshStandardMaterial({ color: off, roughness: 0.5, emissive: new THREE.Color(color), emissiveIntensity: 0 });
}

function sevenSegModel(input: PartModelInput): PartModel | null {
  const f = dipFrame(input);
  if (!f) return null;
  const { res } = input;
  const c = dipCenter(f);
  const color = LED_COLORS[(params(input.part).color ?? 'red').toLowerCase()] ?? LED_COLORS.red;
  const straddle = input.part.map.straddle;
  const W = straddle ? 12.6 : Math.max(10, f.keys.length * 2.54 + 1);
  const D = 19;
  const H = 7.5;
  const bottom = 0.9;
  const body = box(res, W, H, D, res.std('#2a2a2c', 0.7, 0));
  body.position.set(c.x, bottom + H / 2, c.z - (straddle ? 0 : 6));
  f.group.add(body);
  const face = box(res, W - 0.6, 0.05, D - 0.6, res.std('#111113', 0.4, 0));
  face.position.set(body.position.x, bottom + H + 0.03, body.position.z);
  f.group.add(face);
  const mats: Record<string, THREE.MeshStandardMaterial> = {};
  const y = bottom + H + 0.12;
  for (const [seg, pos] of Object.entries(SEGMENT_LAYOUT)) {
    const m = segmentMaterial(color);
    mats[seg] = m;
    const s = box(res, pos.horizontal ? 4.6 : 0.95, 0.12, pos.horizontal ? 0.95 : 4.6, m);
    s.position.set(body.position.x + pos.x - pos.z * 0.08, y, body.position.z + pos.z * 1.0);
    f.group.add(s);
  }
  const dpMat = segmentMaterial(color);
  mats.dp = dpMat;
  const dp = new THREE.Mesh(res.geometry('seg-dp', () => new THREE.CylinderGeometry(0.6, 0.6, 0.12, 14)), dpMat);
  dp.position.set(body.position.x + 4.6, y, body.position.z + 6.6);
  f.group.add(dp);
  if (straddle) f.group.add(dipPins(res, f, c, 1.0, 0.7, res.metal));
  else for (const k of f.keys) f.group.add(segment(res, V(f.lead[k].x, bottom, f.lead[k].z), V(f.lead[k].x, HOLE_DEPTH, f.lead[k].z), 0.25, res.metal));
  return {
    group: f.group,
    setIndicator: (input) => {
      const lv = sevenSegLevels(input);
      for (const [seg, m] of Object.entries(mats)) m.emissiveIntensity = (lv[seg] ?? 0) * 2.4;
    },
    dispose: () => Object.values(mats).forEach((m) => m.dispose()),
  };
}

function barGraphModel(input: PartModelInput): PartModel | null {
  const f = dipFrame(input);
  if (!f) return null;
  const { res } = input;
  const c = dipCenter(f);
  const color = LED_COLORS[(params(input.part).color ?? 'red').toLowerCase()] ?? LED_COLORS.red;
  const W = f.half * 2.54 + 0.6;
  const H = 7;
  const bottom = 0.9;
  const body = box(res, W, H, 10, res.std('#2a2a2c', 0.7, 0));
  body.position.set(c.x, bottom + H / 2, c.z);
  f.group.add(body);
  const mats: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 10; i++) {
    const m = segmentMaterial(color);
    mats.push(m);
    const s = box(res, 1.4, 0.12, 5.6, m);
    s.position.set(c.x - W / 2 + 1.27 + i * 2.54 + 0.3, bottom + H + 0.08, c.z);
    f.group.add(s);
  }
  f.group.add(dipPins(res, f, c, 4.0, 0.7, res.metal));
  return {
    group: f.group,
    setIndicator: ({ level, segments }) => mats.forEach((m, i) => (m.emissiveIntensity = Math.max(0, Math.min(1, segments?.[String(i + 1)] ?? level)) * 2.4)),
    dispose: () => mats.forEach((m) => m.dispose()),
  };
}

// ---------------------------------------------------------------------------------------------
// electromechanical

function potModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const pts = f.keys.map((k) => f.lead[k]);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const base = box(res, 9.5, 4.6, 9.5, res.std('#2c5aa0', 0.55, 0));
  base.position.set(cx, 0.6 + 2.3, cz - 2.6);
  f.group.add(base);
  const knob = new THREE.Mesh(res.geometry('pot-knob', () => new THREE.CylinderGeometry(3.3, 3.5, 2.6, 28)), res.std('#ece8dc', 0.5, 0));
  knob.position.set(cx, 0.6 + 4.6 + 1.3, cz - 2.6);
  f.group.add(knob);
  const slot = box(res, 0.6, 0.3, 5.4, res.std('#3c3c3c', 0.6, 0));
  slot.position.set(cx, 0.6 + 4.6 + 2.65, cz - 2.6);
  const pct = num(params(input.part), 'percent', 50);
  slot.rotation.y = -((-135 + (270 * Math.max(0, Math.min(100, pct))) / 100) * Math.PI) / 180;
  f.group.add(slot);
  f.keys.forEach((k, i) => f.group.add(lead(res, V(cx + (i - (f.keys.length - 1) / 2) * 2.54, 0.7, cz), f.lead[k], res.metal, 0.3)));
  return { group: f.group, dispose: () => undefined };
}

function switchModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const p = params(input.part);
  const pts = f.keys.map((k) => f.lead[k]);
  const xs = pts.map((q) => q.x);
  const zs = pts.map((q) => q.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanZ = Math.max(...zs) - Math.min(...zs);
  const body = input.part.map.body;
  if (body === 'push-button') {
    const pressed = (p.pressed ?? 'false') === 'true';
    const base = box(res, 6, 3.5, 6, res.std('#1f1f21', 0.6, 0));
    base.position.set(cx, 0.4 + 1.75, cz);
    const cap = new THREE.Mesh(res.geometry('btn-cap', () => new THREE.CylinderGeometry(1.75, 1.75, 1.6, 20)), res.std('#c62828', 0.45, 0));
    cap.position.set(cx, 0.4 + 3.5 + (pressed ? 0.3 : 0.8), cz);
    f.group.add(base, cap);
    for (const k of f.keys) f.group.add(lead(res, V(f.lead[k].x, 0.5, cz), f.lead[k], res.metal, 0.28));
    return { group: f.group, dispose: () => undefined };
  }
  if (body === 'switch-toggle') {
    const closed = (p.closed ?? 'false') === 'true';
    const base = box(res, spanX + 3.5, 5, 5, res.std('#b9bec4', 0.3, 0.85));
    base.position.set(cx, 0.4 + 2.5, cz);
    const lever = segment(res, V(cx, 5.4, cz), V(cx + (closed ? 2.4 : -2.4), 11, cz), 0.8, res.std('#d7dbe0', 0.25, 0.9));
    f.group.add(base, lever);
    for (const k of f.keys) f.group.add(lead(res, V(f.lead[k].x, 0.5, cz), f.lead[k], res.metal, 0.3));
    return { group: f.group, dispose: () => undefined };
  }
  // slide switch (SPDT / DPDT): the actuator sits towards the selected throw (A = -x, B = +x)
  const pos = (p.position ?? 'A').toUpperCase();
  const base = box(res, spanX + 3.4, 3.8, spanZ + 4.2, res.std('#b9bec4', 0.3, 0.85));
  base.position.set(cx, 0.4 + 1.9, cz);
  const act = box(res, 1.8, 2.6, 1.8, res.std('#1f1f21', 0.6, 0));
  act.position.set(cx + (pos === 'B' ? 1.0 : -1.0), 0.4 + 3.8 + 1.3, cz);
  f.group.add(base, act);
  for (const k of f.keys) f.group.add(lead(res, V(f.lead[k].x, 0.5, f.lead[k].z), f.lead[k], res.metal, 0.3));
  return { group: f.group, dispose: () => undefined };
}

function buzzerModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const [a, b] = twoLeads(f);
  const cx = (a.x + b.x) / 2;
  const cz = (a.z + b.z) / 2;
  const body = new THREE.Mesh(res.geometry('buzzer', () => new THREE.CylinderGeometry(6, 6, 7.5, 40)), res.std('#1c1c1e', 0.55, 0));
  body.position.set(cx, 0.5 + 3.75, cz);
  f.group.add(body);
  const hole = new THREE.Mesh(res.geometry('buzzer-hole', () => new THREE.CircleGeometry(1.0, 20).rotateX(-Math.PI / 2)), res.std('#050505', 0.9, 0));
  hole.position.set(cx, 8.02, cz);
  f.group.add(hole);
  const plus = label(res, '+', 2.2, 2.2, 'up', { color: '#e0e0e0', bold: true, size: 96 });
  plus.position.set(a.x + 1.6, 8.03, cz);
  f.group.add(plus);
  const ringMat = new THREE.MeshStandardMaterial({ color: '#333', emissive: new THREE.Color('#ffb300'), emissiveIntensity: 0 });
  const ring = new THREE.Mesh(res.geometry('buzzer-ring', () => new THREE.TorusGeometry(3.2, 0.25, 8, 40).rotateX(Math.PI / 2)), ringMat);
  ring.position.set(cx, 8.05, cz);
  f.group.add(ring);
  f.group.add(lead(res, V(a.x, 0.5, cz), a), lead(res, V(b.x, 0.5, cz), b));
  return {
    group: f.group,
    setIndicator: ({ level }) => {
      ringMat.emissiveIntensity = Math.max(0, Math.min(1, level)) * 2.5;
    },
    dispose: () => ringMat.dispose(),
  };
}

function headerModel(input: PartModelInput): PartModel | null {
  const f = makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const pts = f.keys.map((k) => f.lead[k]);
  const xs = pts.map((q) => q.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = pts.reduce((s, q) => s + q.z, 0) / pts.length;
  const terminal = /^TB-/.test(input.part.def.footprint ?? '');
  const span = Math.max(...xs) - Math.min(...xs);
  const base = box(res, span + (terminal ? 5 : 2.54), terminal ? 10 : 2.5, terminal ? 7.6 : 2.5, res.std(terminal ? '#2f7d3a' : '#1c1c1e', 0.6, 0));
  base.position.set(cx, (terminal ? 10 : 2.5) / 2 + 0.2, cz);
  f.group.add(base);
  for (const k of f.keys) {
    const h = f.lead[k];
    if (terminal) {
      const screw = new THREE.Mesh(res.geometry('tb-screw', () => new THREE.CylinderGeometry(1.3, 1.3, 0.5, 16)), res.metal);
      screw.position.set(h.x, 10.45, cz);
      f.group.add(screw);
      f.group.add(segment(res, V(h.x, 0.3, h.z), V(h.x, HOLE_DEPTH, h.z), 0.4, res.metal));
    } else {
      f.group.add(box(res, 0.64, 2.5 + 6 + 1.2, 0.64, res.gold).translateX(h.x).translateY((8.5 + HOLE_DEPTH) / 2).translateZ(h.z));
    }
  }
  return { group: f.group, dispose: () => undefined };
}

function generic(input: PartModelInput): PartModel | null {
  const straddle = input.part.map.straddle;
  const f = straddle ? dipFrame(input) : makeFrame(input);
  if (!f) return null;
  const { res } = input;
  const pts = f.keys.map((k) => f.lead[k]);
  const xs = pts.map((q) => q.x);
  const zs = pts.map((q) => q.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const W = Math.max(...xs) - Math.min(...xs) + 2.6;
  const D = straddle ? Math.max(4, Math.max(...zs) - Math.min(...zs) - 1.4) : 3.6;
  const H = straddle ? 3.4 : 5.5;
  const bottom = straddle ? 0.9 : 2.2;
  const body = box(res, W, H, D, res.std('#3b4250', 0.6, 0));
  body.position.set(cx, bottom + H / 2, cz);
  f.group.add(body);
  const t = label(res, `${input.part.map.label}\n${input.placement.refdes}`, Math.max(3, W - 1), Math.max(2, Math.min(D - 0.6, 4)), 'up', { color: '#e3e7ef', bold: true, size: 40 });
  t.position.set(cx, bottom + H + 0.02, cz);
  f.group.add(t);
  for (const k of f.keys) {
    const h = f.lead[k];
    if (straddle) {
      const side = Math.sign(h.z - cz) || 1;
      f.group.add(polyline(res, [V(h.x, 1.6, cz + side * (D / 2)), V(h.x, 1.6, h.z), V(h.x, HOLE_DEPTH, h.z)], 0.26, res.metal));
    } else {
      f.group.add(lead(res, V(h.x, bottom, cz), h, res.metal, 0.28));
    }
  }
  return { group: f.group, dispose: () => undefined };
}

// ---------------------------------------------------------------------------------------------

export function buildPartModel(input: PartModelInput): PartModel | null {
  let m: PartModel | null;
  switch (input.part.map.body) {
    case 'resistor':
      m = resistorModel(input);
      break;
    case 'diode':
      m = diodeModel(input);
      break;
    case 'inductor':
      m = inductorModel(input);
      break;
    case 'fuse':
      m = fuseModel(input);
      break;
    case 'ceramic-cap':
      m = ceramicModel(input);
      break;
    case 'electrolytic-cap':
      m = electrolyticModel(input);
      break;
    case 'led':
      m = ledModel(input);
      break;
    case 'lamp':
      m = lampModel(input);
      break;
    case 'crystal':
    case 'thermistor':
    case 'ldr':
    case 'trimmer':
      m = smallRadial(input, input.part.map.body);
      break;
    case 'to92':
      m = to92Model(input);
      break;
    case 'to220':
      m = to220Model(input);
      break;
    case 'dip':
      m = dipModel(input);
      break;
    case 'seven-seg':
      m = sevenSegModel(input);
      break;
    case 'bargraph':
      m = barGraphModel(input);
      break;
    case 'pot':
      m = potModel(input);
      break;
    case 'switch-slide':
    case 'switch-toggle':
    case 'push-button':
      m = switchModel(input);
      break;
    case 'buzzer':
      m = buzzerModel(input);
      break;
    case 'header':
      m = headerModel(input);
      break;
    default:
      m = generic(input);
  }
  if (m) {
    m.group.name = `part:${input.placement.refdes}`;
    m.group.userData = { kind: 'part', refdes: input.placement.refdes };
  }
  return m;
}
