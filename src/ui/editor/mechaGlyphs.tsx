/**
 * The machines moving on the schematic: the items on a conveyor belt, the lit traffic lamps, the
 * water in a tank, the leaf of a garage door and the car of a lift.
 *
 * Values come from the live indicator levels (src/ui/integration/live.ts): a mechatronics part
 * publishes its input pins, its sensor pins and its report nodes as `${refdes}#k`, in that order,
 * and the model's own pin list (src/mecha/models.ts) says where each group starts — so this file
 * never has to guess an index. Everything is drawn in part-local coordinates inside the part
 * transform, so it follows rotation and mirroring like the rest of the symbol.
 */
import type { ReactElement } from 'react';
import type { PartDef } from '../../library/types';
import type { PartInstance } from '../../model/types';
import { BELT_SLOTS, createMecha, type MechaSpec } from '../../mecha/models';
import { partTransform } from './symbolGeometry';

/** Colours of the moving parts (same in both themes, like the LCD screens). */
const C = {
  water: '#2f80d8',
  waterTop: '#79b4f0',
  item: '#c98a2e',
  belt: '#6b6f76',
  car: '#8a8f98',
  door: '#9aa1ab',
  off: '#3a3d42',
  red: '#e5392f',
  amber: '#e8a92c',
  green: '#35b14a',
  frame: '#7b818a',
};

/** Index of the first report node of a scene (inputs and sensor pins come first). */
function layoutOf(scene: string): { spec: MechaSpec; reports: number } | null {
  const m = createMecha(scene, (_k, d) => d);
  if (!m) return null;
  return { spec: m.spec, reports: m.spec.inputs.length + m.spec.outputs.length };
}

const cache = new Map<string, { spec: MechaSpec; reports: number } | null>();

function layoutCached(scene: string): { spec: MechaSpec; reports: number } | null {
  if (!cache.has(scene)) cache.set(scene, layoutOf(scene));
  return cache.get(scene) ?? null;
}

export interface MechaGlyphProps {
  def: PartDef;
  o: PartInstance;
  /** signal values of the part (`${refdes}#k`), in pin order */
  cells: number[];
}

/**
 * Animated state of a mechatronics part, drawn inside the part's `screen` area. Returns null when
 * the part is not one (or the scene is unknown), so the caller can render it unconditionally.
 */
export function MechaGlyph({ def, o, cells }: MechaGlyphProps): ReactElement | null {
  const ind = def.indicator;
  if (!ind || ind.kind !== 'mecha' || !ind.scene || !ind.screen) return null;
  const l = layoutCached(ind.scene);
  if (!l) return null;
  const sc = ind.screen;
  /** input pin level (volts) */
  const input = (k: number) => cells[k] ?? 0;
  /** sensor pin level (volts) */
  const sensor = (k: number) => cells[l.spec.inputs.length + k] ?? 0;
  /** report value in the model's unit */
  const report = (k: number) => cells[l.reports + k] ?? 0;
  const on = (v: number) => v > 6;
  let body: ReactElement | null = null;

  if (ind.scene === 'conveyor') {
    const travel = report(0);
    const items: ReactElement[] = [];
    const length = 2; // the drawing shows the whole belt whatever its length in metres
    const scale = (x: number) => sc.x + (Math.min(1, Math.max(0, x / length)) * sc.w);
    for (let k = 0; k < BELT_SLOTS; k++) {
      const x = report(3 + k);
      if (x < 0) continue;
      items.push(<rect key={k} x={scale(x) - 5} y={sc.y + sc.h / 2 - 11} width={10} height={10} rx={1.5} fill={C.item} />);
    }
    // the belt surface moves: short marks sliding with the travel
    const marks: ReactElement[] = [];
    const step = sc.w / 10;
    const off = ((travel * 40) % step + step) % step;
    for (let x = sc.x + off; x < sc.x + sc.w; x += step) marks.push(<line key={x} x1={x} y1={sc.y + sc.h / 2 + 2} x2={x + 4} y2={sc.y + sc.h / 2 + 2} stroke={C.belt} strokeWidth={2} />);
    body = (
      <>
        {marks}
        {items}
        <circle cx={sc.x + (sc.w * (0.25 - 0.05)) / length} cy={sc.y + 2} r={3} fill={on(sensor(0)) ? C.red : C.off} />
        <circle cx={sc.x + (sc.w * (1.75 - 0.05)) / length} cy={sc.y + 2} r={3} fill={on(sensor(1)) ? C.red : C.off} />
      </>
    );
  } else if (ind.scene === 'junction') {
    const lamps: ReactElement[] = [];
    const colors = [C.red, C.amber, C.green];
    [-34, 34].forEach((x, head) => {
      for (let k = 0; k < 3; k++) {
        const v = input(head * 3 + k);
        lamps.push(<circle key={`${head}.${k}`} cx={x} cy={-6 + 16 * k} r={5} fill={on(v) ? colors[k] : C.off} />);
      }
    });
    const err = on(sensor(0));
    body = (
      <>
        {lamps}
        {err ? <circle cx={0} cy={30} r={5} fill={C.red} /> : null}
      </>
    );
  } else if (ind.scene === 'tank') {
    const pct = Math.min(100, Math.max(0, report(0)));
    const h = (sc.h * pct) / 100;
    body = (
      <>
        <rect x={sc.x + 1} y={sc.y + sc.h - h} width={sc.w - 2} height={h} fill={C.water} opacity={0.8} />
        {h > 2 ? <line x1={sc.x + 1} y1={sc.y + sc.h - h} x2={sc.x + sc.w - 1} y2={sc.y + sc.h - h} stroke={C.waterTop} strokeWidth={2} /> : null}
        <circle cx={sc.x + sc.w - 7} cy={sc.y + 14} r={3} fill={on(sensor(1)) ? C.green : C.off} />
        <circle cx={sc.x + sc.w - 7} cy={sc.y + sc.h - 14} r={3} fill={on(sensor(0)) ? C.green : C.off} />
      </>
    );
  } else if (ind.scene === 'door') {
    const pct = Math.min(100, Math.max(0, report(0)));
    const h = (sc.h * (100 - pct)) / 100;
    const beamClear = on(sensor(2));
    body = (
      <>
        <rect x={sc.x + 2} y={sc.y} width={sc.w - 4} height={h} fill={C.door} opacity={0.85} />
        <line x1={sc.x + 2} y1={sc.y + sc.h - 4} x2={sc.x + sc.w - 2} y2={sc.y + sc.h - 4} stroke={beamClear ? C.green : C.red} strokeWidth={1.5} strokeDasharray="4 3" />
        <circle cx={sc.x + sc.w - 6} cy={sc.y + 6} r={3} fill={on(sensor(0)) ? C.green : C.off} />
        <circle cx={sc.x + 6} cy={sc.y + sc.h - 10} r={3} fill={on(sensor(1)) ? C.green : C.off} />
      </>
    );
  } else if (ind.scene === 'lift') {
    const floor = Math.min(3, Math.max(1, report(0)));
    const door = Math.min(100, Math.max(0, report(1)));
    const carH = sc.h / 3.4;
    // floor 1 at the bottom of the shaft, floor 3 at the top
    const y = sc.y + sc.h - carH - ((floor - 1) / 2) * (sc.h - carH);
    const gap = ((sc.w - 8) / 2) * (door / 100);
    body = (
      <>
        <rect x={sc.x + 3} y={y} width={sc.w - 6} height={carH} fill={C.car} opacity={0.9} rx={1} />
        <rect x={sc.x + 4} y={y + 2} width={(sc.w - 8) / 2 - gap} height={carH - 4} fill={C.frame} />
        <rect x={sc.x + 4 + (sc.w - 8) / 2 + gap} y={y + 2} width={(sc.w - 8) / 2 - gap} height={carH - 4} fill={C.frame} />
      </>
    );
  }
  if (!body) return null;
  return (
    <g transform={partTransform(o)} className="ms-mecha" pointerEvents="none">
      {body}
    </g>
  );
}
