import { describe, expect, it } from 'vitest';
import { createMecha, mechaNodeCount, type MechaModel } from './models';

const DT = 1e-3;

function make(kind: string, params: Record<string, number> = {}): MechaModel {
  const m = createMecha(kind, (key, def) => params[key] ?? def);
  expect(m).toBeDefined();
  return m!;
}

/** Run for `seconds`, with constant inputs; returns the time the predicate first became true. */
function runUntil(m: MechaModel, inputs: readonly number[], seconds: number, hit: (m: MechaModel) => boolean): number {
  let t = 0;
  while (t < seconds) {
    m.step(DT, inputs);
    t += DT;
    if (hit(m)) return t;
  }
  return NaN;
}

describe('tank', () => {
  it('fills at the pump rate and the switches follow the level', () => {
    const m = make('tank', { volume: 10, qin: 0.5, low: 20, high: 80, start: 0 });
    expect(m.out(0)).toBe(0);
    // 20 % of 10 L at 0.5 L/s is 4 s
    expect(runUntil(m, [1, 0], 20, (x) => x.out(0) === 1)).toBeCloseTo(4, 2);
    // 80 % is 16 s
    expect(runUntil(m, [1, 0], 20, (x) => x.out(1) === 1)).toBeCloseTo(12, 2);
    // it stops at the brim
    runUntil(m, [1, 0], 10, () => false);
    expect(m.report(1)).toBeCloseTo(10, 6);
    expect(m.report(0)).toBeCloseTo(100, 6);
    expect(m.out(2)).toBeCloseTo(1, 6);
  });

  it('empties through the drain valve in 2·V/q seconds (Torricelli)', () => {
    const volume = 10;
    const qout = 0.35;
    const m = make('tank', { volume, qin: 0, qout, start: 100 });
    expect(m.out(2)).toBeCloseTo(1, 6);
    // V(t) = (√V0 − q·t / (2√V0))²: 1 % of the tank is left after
    const want = ((Math.sqrt(volume) - Math.sqrt(0.01 * volume)) * 2 * Math.sqrt(volume)) / qout;
    const got = runUntil(m, [0, 1], 2 * want, (x) => x.report(0) <= 1);
    expect(got / want).toBeGreaterThan(0.99);
    expect(got / want).toBeLessThan(1.01);
  });

  it('pump and drain together settle where the two rates match', () => {
    // equilibrium: qin = qout·√(V/V0) -> V = V0·(qin/qout)²
    const m = make('tank', { volume: 10, qin: 0.2, qout: 0.4, start: 0 });
    runUntil(m, [1, 1], 300, () => false);
    expect(m.report(1)).toBeCloseTo(10 * (0.2 / 0.4) ** 2, 2);
  });

  it('starts where `start` says and lists its pins', () => {
    const m = make('tank', { volume: 10, start: 50, low: 20, high: 80 });
    expect(m.report(0)).toBeCloseTo(50, 6);
    expect(m.out(0)).toBe(1);
    expect(m.out(1)).toBe(0);
    expect(m.spec.inputs).toEqual(['PUMP', 'VALVE']);
    expect(mechaNodeCount(m.spec)).toBe(2 + 3 + 2);
  });
});

describe('conveyor', () => {
  const params = { length: 2, speed: 0.5, s1: 0.5, s2: 1.5, window: 0.1, feed: 0, spacing: 0.5 };

  it('carries an item past both sensors at the belt speed', () => {
    const m = make('conveyor', params);
    // a rising edge of FEED drops one item at the start
    m.step(DT, [1, 0, 1]);
    expect(m.report(2)).toBe(1);
    // the first sensor sits 0.5 m away: 1 s at 0.5 m/s (the window opens 0.05 m early)
    const t1 = runUntil(m, [1, 0, 1], 5, (x) => x.out(0) === 1);
    expect(t1).toBeCloseTo((0.5 - 0.05) / 0.5, 2);
    const t2 = runUntil(m, [1, 0, 1], 5, (x) => x.out(1) === 1);
    expect(t1 + t2).toBeCloseTo((1.5 - 0.05) / 0.5, 2);
    // and falls off the end 2 m from the start
    const t3 = runUntil(m, [1, 0, 1], 5, (x) => x.report(1) === 1);
    expect(t1 + t2 + t3).toBeCloseTo(2 / 0.5, 2);
    expect(m.report(2)).toBe(0);
  });

  it('stands still while the motor is off', () => {
    const m = make('conveyor', params);
    m.step(DT, [0, 0, 1]);
    runUntil(m, [0, 0, 0], 5, () => false);
    expect(m.report(0)).toBe(0);
    expect(m.out(0)).toBe(0);
  });

  it('runs backwards and drops the item off the near end', () => {
    const m = make('conveyor', params);
    m.step(DT, [1, 0, 1]);
    runUntil(m, [1, 0, 0], 2, () => false);
    const before = m.report(0);
    expect(before).toBeCloseTo(1, 1);
    runUntil(m, [0, 1, 0], 3, (x) => x.report(2) === 0);
    expect(m.report(0)).toBeLessThan(before);
    expect(m.report(1)).toBe(0);
  });

  it('feeds by itself every tfeed seconds while it runs', () => {
    const m = make('conveyor', { ...params, feed: 1, tfeed: 1 });
    expect(m.report(2)).toBe(0);
    runUntil(m, [1, 0, 0], 0.5, () => false);
    expect(m.report(2)).toBe(1);
    runUntil(m, [1, 0, 0], 1.1, () => false);
    expect(m.report(2)).toBe(2);
    // item positions come out on the report nodes, newest first
    expect(m.report(3)).toBeLessThan(m.report(4));
    expect(m.report(6)).toBe(-1);
  });

  it('never puts two items on top of each other', () => {
    const m = make('conveyor', { ...params, feed: 0, spacing: 0.5 });
    for (let k = 0; k < 4; k++) {
      m.step(DT, [1, 0, 1]);
      m.step(DT, [1, 0, 0]);
    }
    expect(m.report(2)).toBe(1);
  });
});

describe('junction', () => {
  const green = [0, 0, 1, 1, 0, 0];
  const bothGreen = [0, 0, 1, 0, 0, 1];
  const dark = [0, 0, 0, 1, 0, 0];

  it('does not complain about a correct pair of signals', () => {
    const m = make('junction', { tfault: 0.3 });
    runUntil(m, green, 5, () => false);
    expect(m.out(0)).toBe(0);
    expect(m.report(0)).toBe(0);
  });

  it('raises the alarm after tfault seconds of two greens', () => {
    const m = make('junction', { tfault: 0.3 });
    const t = runUntil(m, bothGreen, 2, (x) => x.out(0) === 1);
    expect(t).toBeCloseTo(0.3, 2);
    expect(m.report(0)).toBe(1);
  });

  it('allows a short overlap during a change', () => {
    const m = make('junction', { tfault: 0.3 });
    runUntil(m, bothGreen, 0.2, () => false);
    expect(m.out(0)).toBe(0);
    runUntil(m, green, 1, () => false);
    expect(m.out(0)).toBe(0);
    expect(m.report(0)).toBe(0);
    expect(m.report(1)).toBeCloseTo(0.2, 2);
  });

  it('complains when a direction shows no signal at all', () => {
    const m = make('junction', { tfault: 0.1 });
    expect(runUntil(m, dark, 1, (x) => x.out(0) === 1)).toBeCloseTo(0.1, 2);
  });
});

describe('door', () => {
  it('travels its whole way in ttravel seconds and stops on the limit switches', () => {
    const m = make('door', { ttravel: 4, start: 0 });
    expect(m.out(1)).toBe(1);
    const t = runUntil(m, [1, 0], 8, (x) => x.out(0) === 1);
    expect(t).toBeCloseTo(4, 2);
    expect(m.report(0)).toBeCloseTo(100, 6);
    expect(m.report(1)).toBe(0);
    const back = runUntil(m, [0, 1], 8, (x) => x.out(1) === 1);
    expect(back).toBeCloseTo(4, 2);
  });

  it('stops and counts the time when both contactors are on', () => {
    const m = make('door', { ttravel: 4, start: 50 });
    runUntil(m, [1, 1], 1, () => false);
    expect(m.report(0)).toBeCloseTo(50, 6);
    expect(m.report(2)).toBeCloseTo(1, 2);
    expect(m.report(1)).toBe(0);
  });

  it('is pushed open again by an obstacle under it while closing', () => {
    const m = make('door', { ttravel: 4, start: 100, tobs: 1, dobs: 1 });
    runUntil(m, [0, 1], 0.9, () => false);
    expect(m.report(0)).toBeLessThan(100);
    expect(m.out(2)).toBe(1);
    // the light barrier breaks at t = 1 s: the door reverses while it is broken
    const low = m.report(0);
    runUntil(m, [0, 1], 0.5, () => false);
    expect(m.out(2)).toBe(0);
    expect(m.report(0)).toBeGreaterThan(low);
    expect(m.report(1)).toBe(1);
  });
});

describe('lift', () => {
  it('needs the door closed before the car moves', () => {
    const m = make('lift', { floors: 3, tfloor: 2, tdoor: 1 });
    // open the door, then ask for up: the car must stay at floor 1
    runUntil(m, [0, 0, 1], 1.2, () => false);
    expect(m.out(3)).toBe(1);
    runUntil(m, [1, 0, 1], 2, () => false);
    expect(m.report(0)).toBeCloseTo(1, 6);
    expect(m.out(0)).toBe(1);
  });

  it('takes tfloor seconds per floor and stops at the top', () => {
    // the floor sensor sees the car `window` floors before it is level, so it answers
    // (1 − window)·tfloor after the start
    const window = 0.04;
    const m = make('lift', { floors: 3, tfloor: 2, tdoor: 1, window });
    const t2 = runUntil(m, [1, 0, 0], 10, (x) => x.out(1) === 1);
    expect(t2).toBeCloseTo((1 - window) * 2, 2);
    const t3 = runUntil(m, [1, 0, 0], 10, (x) => x.out(2) === 1);
    expect(t2 + t3).toBeCloseTo((2 - window) * 2, 2);
    runUntil(m, [1, 0, 0], 3, () => false);
    expect(m.report(0)).toBeCloseTo(3, 6);
    expect(m.report(2)).toBe(0);
    const down = runUntil(m, [0, 1, 0], 10, (x) => x.out(0) === 1);
    expect(down).toBeCloseTo((2 - window) * 2, 2);
  });

  it('stops when both hoist contactors are on', () => {
    const m = make('lift', { floors: 3, tfloor: 2, tdoor: 1 });
    runUntil(m, [1, 1, 0], 2, () => false);
    expect(m.report(0)).toBeCloseTo(1, 6);
  });

  it('opens and closes the door in tdoor seconds', () => {
    const m = make('lift', { floors: 3, tfloor: 2, tdoor: 1.5 });
    expect(runUntil(m, [0, 0, 1], 5, (x) => x.out(3) === 1)).toBeCloseTo(1.5, 2);
    expect(runUntil(m, [0, 0, 0], 5, (x) => x.report(1) <= 0)).toBeCloseTo(1.5, 2);
  });
});

describe('model registry', () => {
  it('an unknown kind gives nothing', () => {
    expect(createMecha('nope', (_k, d) => d)).toBeUndefined();
  });

  it('every model starts in a defined state and lists its nodes', () => {
    for (const kind of ['conveyor', 'junction', 'tank', 'door', 'lift']) {
      const m = make(kind);
      expect(mechaNodeCount(m.spec)).toBe(m.spec.inputs.length + m.spec.outputs.length + m.spec.reports.length);
      for (let k = 0; k < m.spec.outputs.length; k++) expect(Number.isFinite(m.out(k))).toBe(true);
      for (let k = 0; k < m.spec.reports.length; k++) expect(Number.isFinite(m.report(k))).toBe(true);
    }
  });
});
