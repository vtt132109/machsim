/**
 * Procedural breadboard model: ivory plastic body, printed markings (row letters, column numbers
 * every five columns, red / blue rail stripes with + / − signs, split-rail gaps), a centre groove
 * and one InstancedMesh for all holes of the board.
 */

import * as THREE from 'three';
import type { BoardInstance } from '../types';
import { allHoles, boardSpec, columnX, LOWER_ROWS, UPPER_ROWS, type BoardSpec } from '../geometry';
import type { Resources } from './resources';

export const BOARD_THICKNESS = 8.5;
const PX_PER_MM = 8;

function drawMarkings(board: BoardInstance, spec: BoardSpec): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(spec.width * PX_PER_MM);
  canvas.height = Math.round(spec.height * PX_PER_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const s = PX_PER_MM;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // centre channel shading
  ctx.fillStyle = 'rgba(120,120,110,0.18)';
  ctx.fillRect(0, (spec.channelY - 1.3) * s, canvas.width, 2.6 * s);

  // rails
  if (spec.hasRails) {
    const firstX = columnX(spec, spec.railColumns[0]) - 2;
    const lastX = columnX(spec, spec.railColumns[spec.railColumns.length - 1]) + 2;
    const splitL = columnX(spec, spec.railGroups[spec.splitAfterGroup - 1].at(-1)!) + 1.2;
    const splitR = columnX(spec, spec.railGroups[spec.splitAfterGroup][0]) - 1.2;
    const stripe = (y: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.45 * s;
      ctx.beginPath();
      if (board.splitRails) {
        ctx.moveTo(firstX * s, y * s);
        ctx.lineTo(splitL * s, y * s);
        ctx.moveTo(splitR * s, y * s);
        ctx.lineTo(lastX * s, y * s);
      } else {
        ctx.moveTo(firstX * s, y * s);
        ctx.lineTo(lastX * s, y * s);
      }
      ctx.stroke();
    };
    const sign = (x: number, y: number, plus: boolean) => {
      ctx.fillStyle = plus ? '#c62828' : '#1e4fb4';
      ctx.font = `bold ${2.6 * s}px "Segoe UI", Arial, sans-serif`;
      ctx.fillText(plus ? '+' : '−', x * s, y * s);
    };
    const y = spec.rowY;
    stripe(y['top+']! - 1.45, '#d32f2f');
    stripe(y['top-']! + 1.45, '#1e56c8');
    stripe(y['bot+']! - 1.45, '#d32f2f');
    stripe(y['bot-']! + 1.45, '#1e56c8');
    for (const x of [1.2, spec.width - 1.2]) {
      sign(x, y['top+']!, true);
      sign(x, y['top-']!, false);
      sign(x, y['bot+']!, true);
      sign(x, y['bot-']!, false);
    }
    if (board.splitRails) {
      ctx.fillStyle = '#7a7a70';
      ctx.font = `${1.6 * s}px "Segoe UI", Arial, sans-serif`;
      const mx = ((splitL + splitR) / 2) * s;
      ctx.fillText('⟷', mx, ((y['top+']! + y['top-']!) / 2) * s);
      ctx.fillText('⟷', mx, ((y['bot+']! + y['bot-']!) / 2) * s);
    }
  }

  // row letters on both ends
  ctx.fillStyle = '#5d5d55';
  ctx.font = `${1.9 * s}px "Segoe UI", Arial, sans-serif`;
  for (const r of [...UPPER_ROWS, ...LOWER_ROWS]) {
    const ry = spec.rowY[r]!;
    ctx.fillText(r, 0.85 * s, ry * s);
    ctx.fillText(r, (spec.width - 0.85) * s, ry * s);
  }
  // column numbers 1, 5, 10, … above row a and below row j
  ctx.font = `${1.6 * s}px "Segoe UI", Arial, sans-serif`;
  for (let c = 1; c <= spec.columns; c++) {
    if (c !== 1 && c % 5 !== 0) continue;
    const x = columnX(spec, c) * s;
    ctx.fillText(String(c), x, (spec.rowY.a! - 1.75) * s);
    ctx.fillText(String(c), x, (spec.rowY.j! + 1.75) * s);
  }
  return canvas;
}

export interface BoardModel {
  group: THREE.Group;
  /** owned resources of this board (markings texture, materials) */
  dispose(): void;
}

export function buildBoard(board: BoardInstance, res: Resources): BoardModel {
  const spec = boardSpec(board.kind);
  const group = new THREE.Group();
  group.name = `board:${board.id}`;
  group.position.set(board.x, 0, board.y);
  group.userData = { kind: 'board', board: board.id };

  const bodyGeo = res.geometry(`board-body:${board.kind}`, () => {
    const g = new THREE.BoxGeometry(spec.width, BOARD_THICKNESS, spec.height);
    g.translate(spec.width / 2, -BOARD_THICKNESS / 2, spec.height / 2);
    return g;
  });
  const body = new THREE.Mesh(bodyGeo, res.std('#f1eee4', 0.78, 0));
  body.userData = { kind: 'board', board: board.id };
  group.add(body);

  // printed markings (one texture per board kind / split setting)
  const tex = res.texture(`board-marks:${board.kind}:${board.splitRails ? 1 : 0}`, () => {
    const t = new THREE.CanvasTexture(drawMarkings(board, spec));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = res.anisotropy;
    return t;
  });
  const marks = new THREE.Mesh(
    res.geometry(`board-plane:${board.kind}`, () => {
      const g = new THREE.PlaneGeometry(spec.width, spec.height);
      g.rotateX(-Math.PI / 2);
      g.translate(spec.width / 2, 0.02, spec.height / 2);
      return g;
    }),
    res.material(`board-marks-mat:${board.kind}:${board.splitRails ? 1 : 0}`, () => new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })),
  );
  marks.renderOrder = 1;
  group.add(marks);

  // centre groove
  const groove = new THREE.Mesh(
    res.geometry(`board-groove:${board.kind}`, () => {
      const g = new THREE.BoxGeometry(spec.width - 0.6, 0.6, 1.6);
      g.translate(spec.width / 2, -0.25, spec.channelY);
      return g;
    }),
    res.std('#c9c5b8', 0.9, 0),
  );
  group.add(groove);

  // holes
  const holes = allHoles(board);
  const holeGeo = res.geometry('hole', () => {
    const g = new THREE.BoxGeometry(1.05, 0.5, 1.05);
    g.translate(0, -0.22, 0);
    return g;
  });
  const inst = new THREE.InstancedMesh(holeGeo, res.std('#2b2d31', 0.9, 0), holes.length);
  const m = new THREE.Matrix4();
  holes.forEach((h, i) => {
    m.makeTranslation(columnX(spec, h.col), 0, spec.rowY[h.row]!);
    inst.setMatrixAt(i, m);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.computeBoundingSphere();
  inst.userData = { kind: 'board', board: board.id };
  group.add(inst);

  return {
    group,
    dispose: () => {
      inst.dispose();
    },
  };
}
