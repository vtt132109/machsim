/**
 * Jumper wires (bent insulated tubes with bare tips), clip leads (alligator clip on a short
 * pin plus a sagging cable to the off-board device) and the off-board devices themselves
 * (9 V battery, bench supply / generator, instrument box) with one terminal per pin.
 */

import * as THREE from 'three';
import type { ClipLead, JumperWire } from '../types';
import { box, label, segment, type Resources } from './resources';

const WIRE_R = 0.42;

/** Arc height of a jumper (mm) for a given span. */
export function jumperHeight(span: number): number {
  return Math.min(14, 1.6 + span * 0.12);
}

function tube(points: THREE.Vector3[], radius: number, material: THREE.Material, segments = 28): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, segments, radius, 7, false);
  const m = new THREE.Mesh(geo, material);
  m.userData.ownGeometry = geo;
  return m;
}

export function buildJumper(res: Resources, wire: JumperWire, a: THREE.Vector3, b: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = `wire:${wire.id}`;
  g.userData = { kind: 'wire', id: wire.id };
  const span = Math.hypot(b.x - a.x, b.z - a.z);
  const h = jumperHeight(span);
  const insul = res.std(wire.color, 0.5, 0);
  const tip = 0.9;
  const pts: THREE.Vector3[] = [new THREE.Vector3(a.x, tip, a.z), new THREE.Vector3(a.x, h * 0.75, a.z)];
  if (span > 4) {
    const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const r = Math.min(span * 0.25, h * 0.6);
    pts.push(new THREE.Vector3(a.x + dir.x * r, h, a.z + dir.z * r));
    pts.push(new THREE.Vector3(b.x - dir.x * r, h, b.z - dir.z * r));
  } else {
    pts.push(new THREE.Vector3((a.x + b.x) / 2, h, (a.z + b.z) / 2));
  }
  pts.push(new THREE.Vector3(b.x, h * 0.75, b.z), new THREE.Vector3(b.x, tip, b.z));
  g.add(tube(pts, WIRE_R, insul, Math.max(16, Math.min(64, Math.round(span)))));
  g.add(segment(res, new THREE.Vector3(a.x, tip + 0.1, a.z), new THREE.Vector3(a.x, -1.2, a.z), 0.3, res.metal));
  g.add(segment(res, new THREE.Vector3(b.x, tip + 0.1, b.z), new THREE.Vector3(b.x, -1.2, b.z), 0.3, res.metal));
  return g;
}

/** Alligator clip on a short pin at `hole`, cable to the device terminal `to`. */
export function buildClip(res: Resources, clip: ClipLead, hole: THREE.Vector3, to: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = `clip:${clip.id}`;
  g.userData = { kind: 'clip', id: clip.id, refdes: clip.refdes };
  const boot = res.std(clip.color, 0.55, 0);
  // short pin in the hole
  g.add(segment(res, new THREE.Vector3(hole.x, -1.2, hole.z), new THREE.Vector3(hole.x, 4.2, hole.z), 0.3, res.metal));
  // clip: jaws pointing down onto the pin, boot towards the device
  const dir = new THREE.Vector3(to.x - hole.x, 0, to.z - hole.z);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  const clipGroup = new THREE.Group();
  clipGroup.position.set(hole.x, 4.2, hole.z);
  clipGroup.rotation.y = Math.atan2(-dir.z, dir.x);
  const steel = res.std('#c7cbd0', 0.3, 0.9);
  const jawTop = box(res, 6.5, 0.6, 2.2, steel);
  jawTop.position.set(2.8, 0.9, 0);
  jawTop.rotation.z = -0.16;
  const jawBot = box(res, 6.5, 0.6, 2.2, steel);
  jawBot.position.set(2.8, -0.2, 0);
  jawBot.rotation.z = 0.1;
  const sleeve = new THREE.Mesh(
    res.geometry('clip-boot', () => {
      const geo = new THREE.CylinderGeometry(1.5, 2.4, 9, 14);
      geo.rotateZ(-Math.PI / 2);
      return geo;
    }),
    boot,
  );
  sleeve.position.set(9.5, 0.6, 0);
  clipGroup.add(jawTop, jawBot, sleeve);
  g.add(clipGroup);
  // cable with a little sag
  const start = new THREE.Vector3(hole.x + dir.x * 14, 4.8, hole.z + dir.z * 14);
  const dist = start.distanceTo(to);
  const mid = start.clone().lerp(to, 0.5);
  mid.y = Math.max(2.5, Math.min(start.y, to.y) - dist * 0.08);
  g.add(tube([start, start.clone().lerp(mid, 0.5).setY((start.y + mid.y) / 2 + 1), mid, to], 0.7, boot, Math.max(20, Math.min(80, Math.round(dist / 2)))));
  return g;
}

export interface DeviceModel {
  group: THREE.Group;
  /** world position of each pin terminal */
  terminals: Record<string, THREE.Vector3>;
  width: number;
}

const TERMINAL_COLORS: Record<string, string> = { '+': '#c62828', '-': '#212121', COM: '#212121' };

/** Off-board device placed with its front-left corner at `origin` (world, y = bench surface). */
export function buildDevice(res: Resources, refdes: string, name: string, kind: 'battery' | 'supply' | 'instrument' | 'device', pins: string[], origin: THREE.Vector3): DeviceModel {
  const g = new THREE.Group();
  g.name = `device:${refdes}`;
  g.userData = { kind: 'device', refdes };
  const terminals: Record<string, THREE.Vector3> = {};
  if (kind === 'battery') {
    // 9 V block lying on its side: 48.5 × 17.5 × 26.5 mm
    const W = 48.5;
    const body = box(res, W, 17.5, 26.5, res.std('#2b2f36', 0.6, 0.1));
    body.position.set(origin.x + W / 2, origin.y + 8.75, origin.z - 13.25);
    const band = box(res, W * 0.62, 17.6, 26.6, res.std('#d4a017', 0.45, 0.2));
    band.position.copy(body.position).setX(origin.x + W * 0.55);
    const t = label(res, `${refdes}\n9V`, 22, 12, 'up', { color: '#1d1d1d', bold: true, size: 48 });
    t.position.set(origin.x + W * 0.55, origin.y + 17.6, origin.z - 13.25);
    g.add(body, band, t);
    pins.forEach((pin, i) => {
      const x = origin.x + 6;
      const z = origin.z - 8 - i * 10;
      const post = new THREE.Mesh(res.geometry('bat-snap', () => new THREE.CylinderGeometry(2.6, 2.6, 2.4, 6)), res.std('#c0c4c9', 0.3, 0.9));
      post.position.set(x - 6, origin.y + 8.75, z);
      post.rotation.z = Math.PI / 2;
      g.add(post);
      const sign = label(res, pin, 4, 4, 'up', { color: pin === '-' ? '#90caf9' : '#ef9a9a', bold: true, size: 96 });
      sign.position.set(x - 1, origin.y + 17.62, z);
      g.add(sign);
      terminals[pin] = new THREE.Vector3(x - 8, origin.y + 8.75, z);
    });
    return { group: g, terminals, width: W };
  }
  const W = Math.max(46, pins.length * 12 + 10);
  const H = kind === 'device' ? 18 : 26;
  const D = 34;
  const body = box(res, W, H, D, res.std(kind === 'instrument' ? '#d8dde5' : '#3c4656', 0.5, 0.1));
  body.position.set(origin.x + W / 2, origin.y + H / 2, origin.z - D / 2);
  g.add(body);
  const screen = box(res, W - 10, 0.2, 12, res.std(kind === 'instrument' ? '#1c2b3a' : '#0f2a18', 0.3, 0.1));
  screen.position.set(origin.x + W / 2, origin.y + H + 0.1, origin.z - D + 9);
  g.add(screen);
  const t = label(res, `${refdes}\n${name}`, W - 12, 10, 'up', { color: kind === 'instrument' ? '#9fe0ff' : '#8dff9e', bold: true, size: 40, mono: true });
  t.position.set(origin.x + W / 2, origin.y + H + 0.22, origin.z - D + 9);
  g.add(t);
  pins.forEach((pin, i) => {
    const x = origin.x + 8 + i * ((W - 16) / Math.max(1, pins.length - 1 || 1));
    const z = origin.z - 7;
    const color = TERMINAL_COLORS[pin] ?? (/-$/.test(pin) ? '#212121' : /\+$/.test(pin) ? '#c62828' : '#f9a825');
    const post = new THREE.Mesh(res.geometry('dev-post', () => new THREE.CylinderGeometry(2.2, 2.2, 5, 14)), res.std(color, 0.45, 0.1));
    post.position.set(x, origin.y + H + 2.5, z);
    g.add(post);
    const pl = label(res, pin, 7, 3.5, 'up', { color: '#ffffff', bold: true, size: 64 });
    pl.position.set(x, origin.y + H + 0.22, z + 4.8);
    g.add(pl);
    terminals[pin] = new THREE.Vector3(x, origin.y + H + 5, z);
  });
  return { group: g, terminals, width: W };
}
