/**
 * Mechatronics models: the machine a control circuit is wired to.
 *
 * Each model is a small, honest piece of physics or geometry (a belt that carries items, a tank
 * that fills and empties, a door and a lift that travel, a signalled junction that checks itself)
 * driven by the logic levels of the schematic and answering with sensor levels. They are what
 * turns "the coil Q0.0 is on" into something a learner can see and reason about.
 *
 * Pure module: no engine, no DOM, no i18n. The `A_MECHA` code model
 * (src/sim/devices/digital/mecha.ts) advances a model at every accepted timepoint; the parts of
 * src/library/catalog/mecha.ts draw it on the schematic from the `report` values, which the model
 * publishes on internal nodes (1 V per unit, see each model).
 *
 * Interface
 *   inputs    digital input pins, in element node order (0 / 1 from the shell's thresholds)
 *   outputs   sensor pins; `out(k)` is 0 … 1 and the element scales it (a digital sensor gives
 *             0 or 1, an analog one the measured fraction of its full scale)
 *   reports   extra values for the drawing, on internal nodes (volts = the unit given per model)
 *
 * Nothing here copies any commercial product: the equations are the ordinary ones (constant
 * speed, Torricelli's law for an outflow, constant travel time) and every default is chosen so
 * the part does something visible within a few seconds of simulated time.
 */

/** One sensor pin of a model. */
export interface MechaOutput {
  name: string;
  /** analog pin: the value is a fraction of the analog full scale instead of 0 / 1 */
  analog?: boolean;
}

export interface MechaSpec {
  /** digital input pin names, in node order */
  inputs: string[];
  outputs: MechaOutput[];
  /** internal report nodes, in node order after the sensor pins (volts = the model's unit) */
  reports: string[];
}

/** Input levels handed to a model: 0 / 1 per input pin (an array or a typed array). */
export interface InputLevels {
  readonly length: number;
  readonly [index: number]: number;
}

export interface MechaModel {
  readonly spec: MechaSpec;
  reset(): void;
  /** advance by `dt` seconds with the present input levels */
  step(dt: number, inp: InputLevels): void;
  /** sensor value, 0 … 1 */
  out(k: number): number;
  /** report value in the model's own unit */
  report(k: number): number;
}

/** Numeric parameter reader handed to a model factory (instance / model card / default). */
export type MechaParams = (key: string, def: number) => number;

export type MechaFactory = (p: MechaParams) => MechaModel;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------------------------
// conveyor belt
// ---------------------------------------------------------------------------------------------

/** Items a belt can carry at once (one report node each). */
export const BELT_SLOTS = 4;

/**
 * Conveyor belt with two item sensors.
 *   inputs   RUN (forward), REV (backwards), FEED (a rising edge puts one item on)
 *   outputs  S1, S2 — the two photo-electric sensors, 1 while an item covers them
 *   reports  TRAVEL (m the belt has moved, for the drawing), PASSED (items that fell off the
 *            end), ONBELT (items on the belt now), X1 … X4 (item positions in m, −1 = empty)
 *
 * `feed` = 1 (the default) drops an item on the belt every `tfeed` seconds while it runs, so the
 * part does something as soon as the motor turns; `feed` = 0 waits for the FEED pin.
 */
class Conveyor implements MechaModel {
  readonly spec: MechaSpec = {
    inputs: ['RUN', 'REV', 'FEED'],
    outputs: [{ name: 'S1' }, { name: 'S2' }],
    reports: ['TRAVEL', 'PASSED', 'ONBELT', ...Array.from({ length: BELT_SLOTS }, (_, k) => `X${k + 1}`)],
  };

  private readonly len: number;
  private readonly speed: number;
  private readonly s1: number;
  private readonly s2: number;
  private readonly window: number;
  private readonly autoFeed: boolean;
  private readonly tfeed: number;
  private readonly spacing: number;

  private items: number[] = [];
  private travel = 0;
  private passed = 0;
  private sinceFeed = 0;
  private prevFeed = 0;

  constructor(p: MechaParams) {
    this.len = Math.max(0.1, p('length', 2));
    this.speed = Math.max(1e-4, p('speed', 0.25));
    this.s1 = clamp(p('s1', 0.25), 0, this.len);
    this.s2 = clamp(p('s2', this.len - 0.25), 0, this.len);
    this.window = Math.max(0.01, p('window', 0.12));
    this.autoFeed = p('feed', 1) !== 0;
    this.tfeed = Math.max(0.05, p('tfeed', 3));
    this.spacing = Math.max(this.window, p('spacing', 0.5));
  }

  reset(): void {
    this.items = [];
    this.travel = 0;
    this.passed = 0;
    this.sinceFeed = this.tfeed;
    this.prevFeed = 0;
  }

  private add(): void {
    if (this.items.length >= BELT_SLOTS) return;
    if (this.items.some((x) => x < this.spacing)) return;
    this.items.unshift(0);
    this.sinceFeed = 0;
  }

  step(dt: number, inp: InputLevels): void {
    const dir = inp[0] ? 1 : inp[1] ? -1 : 0;
    const feed = inp[2] ?? 0;
    if (feed === 1 && this.prevFeed === 0) this.add();
    this.prevFeed = feed;
    if (dir !== 0) {
      const d = dir * this.speed * dt;
      this.travel += d;
      this.items = this.items.map((x) => x + d);
      const kept: number[] = [];
      for (const x of this.items) {
        if (x > this.len) this.passed++;
        else if (x >= 0) kept.push(x);
      }
      this.items = kept;
      if (this.autoFeed && dir > 0) {
        this.sinceFeed += dt;
        if (this.sinceFeed >= this.tfeed) this.add();
      }
    }
  }

  private covered(at: number): number {
    return this.items.some((x) => Math.abs(x - at) <= this.window / 2) ? 1 : 0;
  }

  out(k: number): number {
    return k === 0 ? this.covered(this.s1) : this.covered(this.s2);
  }

  report(k: number): number {
    if (k === 0) return this.travel;
    if (k === 1) return this.passed;
    if (k === 2) return this.items.length;
    const i = k - 3;
    return i < this.items.length ? this.items[i] : -1;
  }

  /** Item positions in m (tests and the drawing). */
  positions(): number[] {
    return this.items.slice();
  }
}

// ---------------------------------------------------------------------------------------------
// signalled junction
// ---------------------------------------------------------------------------------------------

/**
 * Traffic-light junction with two directions, which checks its own signals.
 *   inputs   NSR NSY NSG EWR EWY EWG — the six lamps (each pin loads the driver like a lamp)
 *   outputs  ERR — 1 while the signals are unsafe for longer than `tfault`
 *   reports  FAULTS (how often it has gone unsafe), FAULTT (seconds spent unsafe)
 *
 * Unsafe means: green in both directions at once, or no lamp lit at all in a direction (a lamp
 * that is never red and never green leaves the crossing unsignalled). A short overlap during a
 * change is allowed: the alarm needs `tfault` seconds (default 0.3 s) of it.
 */
class Junction implements MechaModel {
  readonly spec: MechaSpec = {
    inputs: ['NSR', 'NSY', 'NSG', 'EWR', 'EWY', 'EWG'],
    outputs: [{ name: 'ERR' }],
    reports: ['FAULTS', 'FAULTT'],
  };

  private readonly tfault: number;
  private bad = 0;
  private faults = 0;
  private faultTime = 0;
  private alarm = 0;

  constructor(p: MechaParams) {
    this.tfault = Math.max(0, p('tfault', 0.3));
  }

  reset(): void {
    this.bad = 0;
    this.faults = 0;
    this.faultTime = 0;
    this.alarm = 0;
  }

  /** True while the six lamps are an unsafe combination. */
  static unsafe(inp: InputLevels): boolean {
    const ns = { r: inp[0] === 1, y: inp[1] === 1, g: inp[2] === 1 };
    const ew = { r: inp[3] === 1, y: inp[4] === 1, g: inp[5] === 1 };
    if (ns.g && ew.g) return true;
    if (!ns.r && !ns.y && !ns.g) return true;
    if (!ew.r && !ew.y && !ew.g) return true;
    return false;
  }

  step(dt: number, inp: InputLevels): void {
    if (Junction.unsafe(inp)) {
      this.bad += dt;
      this.faultTime += dt;
      if (this.bad >= this.tfault && this.alarm === 0) {
        this.alarm = 1;
        this.faults++;
      }
    } else {
      this.bad = 0;
      this.alarm = 0;
    }
  }

  out(): number {
    return this.alarm;
  }

  report(k: number): number {
    return k === 0 ? this.faults : this.faultTime;
  }
}

// ---------------------------------------------------------------------------------------------
// tank
// ---------------------------------------------------------------------------------------------

/**
 * Liquid tank with a pump, a drain valve and two level switches.
 *   inputs   PUMP (fill), VALVE (drain)
 *   outputs  LOW, HIGH — the level switches (1 while the liquid stands above them),
 *            LEVEL — analog pin, the level as a fraction of the full tank
 *   reports  PERCENT (0 … 100), LITRES
 *
 * The pump delivers a constant `qin` litres per second. The drain follows Torricelli's law,
 * q = qout · √(V / Vfull), so the tank empties slowly at the end — and from full it empties in
 * exactly 2·Vfull / qout seconds, which a test checks against the model.
 */
class Tank implements MechaModel {
  readonly spec: MechaSpec = {
    inputs: ['PUMP', 'VALVE'],
    outputs: [{ name: 'LOW' }, { name: 'HIGH' }, { name: 'LEVEL', analog: true }],
    reports: ['PERCENT', 'LITRES'],
  };

  private readonly volume: number;
  private readonly qin: number;
  private readonly qout: number;
  private readonly low: number;
  private readonly high: number;
  private readonly start: number;
  private level = 0;

  constructor(p: MechaParams) {
    this.volume = Math.max(1e-3, p('volume', 10));
    this.qin = Math.max(0, p('qin', 0.5));
    this.qout = Math.max(0, p('qout', 0.35));
    this.low = clamp(p('low', 20), 0, 100) / 100;
    this.high = clamp(p('high', 80), 0, 100) / 100;
    this.start = clamp(p('start', 0), 0, 100) / 100;
  }

  reset(): void {
    this.level = this.start * this.volume;
  }

  step(dt: number, inp: InputLevels): void {
    const fill = inp[0] ? this.qin : 0;
    const drain = inp[1] ? this.qout * Math.sqrt(Math.max(0, this.level) / this.volume) : 0;
    this.level = clamp(this.level + (fill - drain) * dt, 0, this.volume);
  }

  out(k: number): number {
    const frac = this.level / this.volume;
    if (k === 0) return frac >= this.low ? 1 : 0;
    if (k === 1) return frac >= this.high ? 1 : 0;
    return frac;
  }

  report(k: number): number {
    return k === 0 ? (100 * this.level) / this.volume : this.level;
  }

  /** Litres in the tank (tests). */
  litres(): number {
    return this.level;
  }
}

// ---------------------------------------------------------------------------------------------
// door
// ---------------------------------------------------------------------------------------------

/**
 * Garage door with limit switches and a light barrier.
 *   inputs   UP, DOWN — the two motor contactors
 *   outputs  OPEN, CLOSED — the limit switches, BEAM — the light barrier (1 = clear)
 *   reports  POS (0 = closed … 100 = open), DIR (−1, 0, +1), JAM (seconds both contactors were on)
 *
 * The door travels its whole way in `ttravel` seconds. UP and DOWN together is a wiring mistake:
 * the door stops (a real reversing contactor pair is interlocked) and JAM counts the time, so a
 * learner can see it. An obstacle can be put under the door with `tobs` (the time it appears,
 * 0 = never) and `dobs` (how long it stays): while the barrier is broken the door must not close,
 * and a door that is closing and sees the obstacle at its own position is pushed back open.
 */
class Door implements MechaModel {
  readonly spec: MechaSpec = {
    inputs: ['UP', 'DOWN'],
    outputs: [{ name: 'OPEN' }, { name: 'CLOSED' }, { name: 'BEAM' }],
    reports: ['POS', 'DIR', 'JAM'],
  };

  private readonly ttravel: number;
  private readonly tobs: number;
  private readonly dobs: number;
  private readonly startPos: number;
  private pos = 0;
  private dir = 0;
  private jam = 0;
  private time = 0;

  constructor(p: MechaParams) {
    this.ttravel = Math.max(0.1, p('ttravel', 5));
    this.tobs = Math.max(0, p('tobs', 0));
    this.dobs = Math.max(0, p('dobs', 2));
    this.startPos = clamp(p('start', 0), 0, 100) / 100;
  }

  reset(): void {
    this.pos = this.startPos;
    this.dir = 0;
    this.jam = 0;
    this.time = 0;
  }

  /** The light barrier is broken between tobs and tobs + dobs. */
  private blocked(): boolean {
    return this.tobs > 0 && this.time >= this.tobs && this.time < this.tobs + this.dobs;
  }

  step(dt: number, inp: InputLevels): void {
    this.time += dt;
    const up = inp[0] === 1;
    const down = inp[1] === 1;
    if (up && down) {
      this.dir = 0;
      this.jam += dt;
    } else if (up) this.dir = 1;
    else if (down) this.dir = this.blocked() ? 1 : -1;
    else this.dir = 0;
    this.pos = clamp(this.pos + (this.dir * dt) / this.ttravel, 0, 1);
    if (this.dir > 0 && this.pos >= 1) this.dir = 0;
    if (this.dir < 0 && this.pos <= 0) this.dir = 0;
  }

  out(k: number): number {
    if (k === 0) return this.pos >= 1 ? 1 : 0;
    if (k === 1) return this.pos <= 0 ? 1 : 0;
    return this.blocked() ? 0 : 1;
  }

  report(k: number): number {
    if (k === 0) return 100 * this.pos;
    if (k === 1) return this.dir;
    return this.jam;
  }

  /** Position 0 … 1 (tests and the drawing). */
  position(): number {
    return this.pos;
  }
}

// ---------------------------------------------------------------------------------------------
// lift
// ---------------------------------------------------------------------------------------------

/**
 * Three-floor lift with floor sensors and a door.
 *   inputs   UP, DOWN — the hoist contactors, DOOR — open the door while high
 *   outputs  F1, F2, F3 — the floor sensors (1 while the car is level with that floor),
 *            DOPEN — the door is fully open
 *   reports  FLOOR (1.00 … 3.00, the car position), DOORPOS (0 … 100), DIR (−1, 0, +1)
 *
 * The car needs `tfloor` seconds per floor and the door `tdoor` seconds to open. The hoist is
 * interlocked: the car does not move while the door is not fully closed, and UP with DOWN stops
 * it — the two mistakes a first lift program makes.
 */
class Lift implements MechaModel {
  readonly spec: MechaSpec = {
    inputs: ['UP', 'DOWN', 'DOOR'],
    outputs: [{ name: 'F1' }, { name: 'F2' }, { name: 'F3' }, { name: 'DOPEN' }],
    reports: ['FLOOR', 'DOORPOS', 'DIR'],
  };

  private readonly floors: number;
  private readonly tfloor: number;
  private readonly tdoor: number;
  private readonly window: number;
  private readonly startFloor: number;
  private car = 1;
  private door = 0;
  private dir = 0;

  constructor(p: MechaParams) {
    this.floors = Math.max(2, Math.round(p('floors', 3)));
    this.tfloor = Math.max(0.1, p('tfloor', 3));
    this.tdoor = Math.max(0.05, p('tdoor', 1.5));
    this.window = Math.max(1e-3, p('window', 0.04));
    this.startFloor = clamp(p('start', 1), 1, this.floors);
  }

  reset(): void {
    this.car = this.startFloor;
    this.door = 0;
    this.dir = 0;
  }

  step(dt: number, inp: InputLevels): void {
    const up = inp[0] === 1;
    const down = inp[1] === 1;
    const open = inp[2] === 1;
    this.door = clamp(this.door + ((open ? 1 : -1) * dt) / this.tdoor, 0, 1);
    const canMove = this.door <= 0;
    if (!canMove || (up && down)) this.dir = 0;
    else if (up) this.dir = 1;
    else if (down) this.dir = -1;
    else this.dir = 0;
    this.car = clamp(this.car + (this.dir * dt) / this.tfloor, 1, this.floors);
    if ((this.dir > 0 && this.car >= this.floors) || (this.dir < 0 && this.car <= 1)) this.dir = 0;
  }

  out(k: number): number {
    if (k < 3) {
      const floor = k + 1;
      return floor <= this.floors && Math.abs(this.car - floor) <= this.window ? 1 : 0;
    }
    return this.door >= 1 ? 1 : 0;
  }

  report(k: number): number {
    if (k === 0) return this.car;
    if (k === 1) return 100 * this.door;
    return this.dir;
  }

  /** Car position in floors (tests and the drawing). */
  position(): number {
    return this.car;
  }
}

// ---------------------------------------------------------------------------------------------
// registry
// ---------------------------------------------------------------------------------------------

/** Model kinds, as the `kind` string parameter of the `A_MECHA` card names them. */
export const MECHA_FACTORIES: Record<string, MechaFactory> = {
  conveyor: (p) => new Conveyor(p),
  junction: (p) => new Junction(p),
  tank: (p) => new Tank(p),
  door: (p) => new Door(p),
  lift: (p) => new Lift(p),
};

export type MechaKind = keyof typeof MECHA_FACTORIES;

/** Build a model of `kind`, or undefined when the kind is unknown. */
export function createMecha(kind: string, p: MechaParams): MechaModel | undefined {
  const f = MECHA_FACTORIES[kind.trim().toLowerCase()];
  if (!f) return undefined;
  const m = f(p);
  m.reset();
  return m;
}

/** Node order of a model's element: inputs, then sensor pins, then report nodes. */
export function mechaNodeCount(spec: MechaSpec): number {
  return spec.inputs.length + spec.outputs.length + spec.reports.length;
}

export { Conveyor, Door, Junction, Lift, Tank };
