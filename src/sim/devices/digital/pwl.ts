/**
 * Piecewise-linear schedule of an output stage quantity (logic level 0..1, drive strength 0..1,
 * or an analog output value) as a function of simulation time.
 *
 * The digital shell only edits a schedule at accepted timepoints, and only in the future:
 * everything at or before the accepted time is immutable history, so a rejected transient step
 * never sees a different waveform when it is retried. Between edits the value is an explicit
 * function of time, which keeps the device's transient stamp independent of the Newton iterate.
 *
 * Scheduling rule (inertial delay): a new change replaces every pending change that would occur
 * after its start; a change back to the current, steady value cancels a pending change that has
 * not started yet (pulses shorter than the propagation delay are swallowed, as in real gates).
 */

/** Shortest ramp accepted (s); a zero-time step would be a discontinuity for the integrator. */
export const MIN_RAMP = 1e-12;

export class Pwl {
  private t: number[] = [0];
  private v: number[] = [0];

  constructor(value = 0) {
    this.reset(value);
  }

  /** Constant value, no history. */
  reset(value: number): void {
    this.t = [0];
    this.v = [value];
  }

  /** Value at time `time` (constant before the first and after the last point). */
  value(time: number): number {
    const t = this.t;
    const v = this.v;
    const n = t.length;
    if (time >= t[n - 1]) return v[n - 1];
    if (time <= t[0]) return v[0];
    let i = n - 2;
    while (i > 0 && t[i] > time) i--;
    const dt = t[i + 1] - t[i];
    return dt > 0 ? v[i] + ((v[i + 1] - v[i]) * (time - t[i])) / dt : v[i + 1];
  }

  /** Value after every scheduled change. */
  get final(): number {
    return this.v[this.v.length - 1];
  }

  /** Time of the last scheduled point. */
  get lastTime(): number {
    return this.t[this.t.length - 1];
  }

  /** Times of the stored points (ramp corners). */
  times(): readonly number[] {
    return this.t;
  }

  /** Number of stored points (diagnostics / tests). */
  get size(): number {
    return this.t.length;
  }

  /** True when `time` lies strictly inside a non-flat segment (a transition is under way). */
  inTransition(time: number): boolean {
    const t = this.t;
    const v = this.v;
    for (let i = 0; i + 1 < t.length; i++) {
      if (t[i] < time && time < t[i + 1]) return v[i] !== v[i + 1];
    }
    return false;
  }

  /** Remove every point after `time`, keeping the value at `time` (a running ramp is cut there). */
  truncate(time: number): void {
    const val = this.value(time);
    let n = this.t.length;
    while (n > 1 && this.t[n - 1] > time) n--;
    this.t.length = n;
    this.v.length = n;
    if (this.v[n - 1] !== val) {
      this.t.push(time);
      this.v.push(val);
    }
  }

  /** Drop history before `time` (keeps the last point at or before it). */
  prune(time: number): void {
    const t = this.t;
    let i = 0;
    while (i + 1 < t.length && t[i + 1] <= time) i++;
    if (i > 0) {
      this.t.splice(0, i);
      this.v.splice(0, i);
    }
  }

  /**
   * Schedule a change to `target` starting at `start` (>= now), ramping at `fullSwing` seconds
   * per unit of value. Returns the [start, end] times of the ramp, or null when nothing changes
   * (already heading to the target, or a pending change was cancelled).
   */
  schedule(now: number, start: number, target: number, fullSwing: number): [number, number] | null {
    if (this.lastTime > now) {
      const vNow = this.value(now);
      if (vNow === target && !this.inTransition(now)) {
        this.truncate(now);
        return null;
      }
    }
    const t0 = Math.max(start, now);
    const v0 = this.value(t0);
    this.truncate(t0);
    if (v0 === target) return null;
    if (this.lastTime < t0) {
      this.t.push(t0);
      this.v.push(v0);
    }
    const t1 = t0 + Math.max(MIN_RAMP, fullSwing * Math.abs(target - v0));
    this.t.push(t1);
    this.v.push(target);
    return [t0, t1];
  }
}
