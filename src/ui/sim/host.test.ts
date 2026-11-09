import { describe, expect, it } from 'vitest';
import { cap, netlist, res, vdc, vsrc } from '../../sim/engine/testing';
import { SimHost, type HostClock } from './host';
import type { FromWorker } from './protocol';

/** Manual clock: timers run only when advance() is called. */
class FakeClock implements HostClock {
  t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers.delete(h as number);
  }
  get pending(): number {
    return this.timers.size;
  }
  /** Move time forward, running due timers in order (a timer may schedule further timers). */
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at)) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
    }
    this.t = end;
  }
}

const rc = () => netlist([vdc('V1', 'in', '0', 1), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)]);

function setup() {
  const clock = new FakeClock();
  const msgs: FromWorker[] = [];
  const host = new SimHost((m) => msgs.push(m), clock);
  return { clock, msgs, host };
}

const chunks = (msgs: FromWorker[]) => msgs.filter((m): m is Extract<FromWorker, { type: 'chunk' }> => m.type === 'chunk');
const lastTime = (msgs: FromWorker[]) => {
  const c = chunks(msgs);
  const t = c[c.length - 1]?.chunk.time;
  return t ? t[t.length - 1] : Number.NaN;
};

describe('SimHost batch runs', () => {
  it('runs every netlist and returns one result list per netlist', () => {
    const { msgs, host } = setup();
    const a = netlist([vdc('V1', 'a', '0', 2), res('R1', 'a', 'b', 1e3), res('R2', 'b', '0', 1e3)], [{ type: 'op' }]);
    const b = netlist([vdc('V1', 'a', '0', 9), res('R1', 'a', 'b', 2e3), res('R2', 'b', '0', 1e3)], [{ type: 'op' }, { type: 'dc', src: 'V1', start: 0, stop: 1, step: 0.5 }]);
    host.handle({ type: 'run', id: 7, netlists: [a, b] });
    const done = msgs.find((m) => m.type === 'results');
    expect(done?.type).toBe('results');
    if (done?.type !== 'results') return;
    expect(done.id).toBe(7);
    expect(done.results).toHaveLength(2);
    expect(done.results[0][0].vectors.find((v) => v.name === 'V(b)')?.re[0]).toBeCloseTo(1, 12);
    expect(done.results[1]).toHaveLength(2);
    expect(done.results[1][0].vectors.find((v) => v.name === 'V(b)')?.re[0]).toBeCloseTo(3, 12);
    expect(Array.from(done.results[1][1].scale?.re ?? [])).toEqual([0, 0.5, 1]);
  });

  it('honours a shared abort flag', () => {
    const { msgs, host } = setup();
    const flag = new SharedArrayBuffer(4);
    Atomics.store(new Int32Array(flag), 0, 1);
    host.handle({ type: 'run', id: 1, netlists: [netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 1)], [{ type: 'tran', tstep: 1e-6, tstop: 1e-3 }])], abort: flag });
    expect(msgs.filter((m) => m.type !== 'progress')).toEqual([{ type: 'error', id: 1, message: 'Simulation cancelled', code: 'cancelled', fatal: true }]);
  });
});

describe('SimHost interactive sessions', () => {
  it('starts with the t = 0 sample and follows wall time × speed', () => {
    const { clock, msgs, host } = setup();
    host.handle({ type: 'interactive', id: 3, netlist: rc(), options: { tstep: 1e-5, speed: 0.01, uic: true } });
    expect(msgs[0]).toMatchObject({ type: 'started', id: 3 });
    expect((msgs[0] as { vectors: string[] }).vectors).toContain('V(out)');
    clock.advance(0);
    expect(chunks(msgs)[0].chunk.time[0]).toBe(0);
    clock.advance(1000); // one wall second = 10 ms of simulated time
    const t = lastTime(msgs);
    // on pace the host sleeps between slices (MIN_IDLE_MS = 4 ms wall = 40 µs simulated here)
    expect(t).toBeGreaterThan(0.01 - 5e-5);
    expect(t).toBeLessThan(0.01 + 2e-5);
    // the RC charges with tau = 1 ms: after 10 ms V(out) ≈ 1 - e^-10
    const last = chunks(msgs)[chunks(msgs).length - 1];
    expect(last.latest['V(out)']).toBeCloseTo(1 - Math.exp(-10), 3);
    // samples are contiguous and increasing across chunks
    let prev = -1;
    for (const c of chunks(msgs)) for (const x of c.chunk.time) {
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
  });

  it('pauses without catching up the paused wall time', () => {
    const { clock, msgs, host } = setup();
    host.handle({ type: 'interactive', id: 1, netlist: rc(), options: { tstep: 1e-5, speed: 0.001 } });
    clock.advance(500);
    const before = lastTime(msgs);
    host.handle({ type: 'control', id: 1, action: 'pause' });
    expect(msgs[msgs.length - 1]).toMatchObject({ type: 'state', state: 'paused' });
    expect(clock.pending).toBe(0);
    clock.advance(5000);
    expect(lastTime(msgs)).toBe(before);
    host.handle({ type: 'control', id: 1, action: 'resume' });
    clock.advance(500);
    expect(lastTime(msgs)).toBeCloseTo(before + 0.0005, 4);
    host.handle({ type: 'control', id: 1, action: 'stop' });
    expect(msgs[msgs.length - 1]).toMatchObject({ type: 'state', state: 'stopped' });
    expect(host.sessionCount).toBe(0);
    expect(clock.pending).toBe(0);
  });

  it('finishes at tstop and runs flat out with speed Infinity', () => {
    const { clock, msgs, host } = setup();
    host.handle({ type: 'interactive', id: 2, netlist: rc(), options: { tstep: 1e-5, speed: Infinity, tstop: 2e-3 } });
    for (let i = 0; i < 50 && host.sessionCount; i++) clock.advance(1);
    expect(host.sessionCount).toBe(0);
    expect(msgs[msgs.length - 1]).toMatchObject({ type: 'state', state: 'finished' });
    expect(lastTime(msgs)).toBeGreaterThanOrEqual(2e-3);
    expect(lastTime(msgs)).toBeLessThan(2e-3 + 2e-5);
  });

  it('applies live parameter edits and reports failing ones without stopping', () => {
    const { clock, msgs, host } = setup();
    host.handle({ type: 'interactive', id: 4, netlist: rc(), options: { tstep: 1e-5, speed: 0.01 } });
    clock.advance(1000);
    const c0 = chunks(msgs);
    expect(c0[c0.length - 1].latest['V(out)']).toBeCloseTo(1, 3);
    host.handle({ type: 'params', id: 4, edits: [{ element: 'V1', param: 'dc', value: 3 }, { element: 'Rnope', param: 'value', value: 1 }] });
    const err = msgs.find((m) => m.type === 'error');
    expect(err).toMatchObject({ type: 'error', id: 4, fatal: false, code: 'netlist' });
    clock.advance(1000);
    const c1 = chunks(msgs);
    expect(c1[c1.length - 1].latest['V(out)']).toBeCloseTo(3, 3);
    expect(host.sessionCount).toBe(1);
    host.handle({ type: 'cancel', id: 4 });
    expect(host.sessionCount).toBe(0);
  });

  it('drops the backlog after a stall instead of catching up', () => {
    const { clock, msgs, host } = setup();
    const n = netlist([vsrc('V1', 'in', '0', { dc: 0, tran: { type: 'SIN', args: [0, 1, 1e3] } }), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-7)]);
    host.handle({ type: 'interactive', id: 5, netlist: n, options: { tstep: 1e-5, speed: 1, sliceMs: 5 } });
    clock.advance(10);
    const t0 = lastTime(msgs);
    clock.t += 60_000; // the UI thread stalled for a minute
    clock.advance(0);
    const afterStall = lastTime(msgs);
    // a 5 ms compute slice cannot cover 60 s (6 million steps) of simulation
    expect(afterStall).toBeLessThan(t0 + 30);
    clock.advance(100);
    // re-anchored: the following 100 ms of wall time add at most ~100 ms of simulated time
    expect(lastTime(msgs) - afterStall).toBeLessThan(0.1 + 1e-3);
    host.dispose();
    expect(host.sessionCount).toBe(0);
  });

  it('reports a fatal error when the stepper cannot be created', () => {
    const { msgs, host } = setup();
    const bad = netlist([vdc('V1', 'a', '0', 1), vdc('V2', 'a', '0', 2)]);
    host.handle({ type: 'interactive', id: 9, netlist: bad, options: { tstep: 1e-5 } });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ type: 'error', id: 9, fatal: true });
    expect(host.sessionCount).toBe(0);
  });
});
