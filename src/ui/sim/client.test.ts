import { describe, expect, it } from 'vitest';
import { cap, netlist, res, vdc } from '../../sim/engine/testing';
import { SimClient, SimulationCancelled, createLazyInProcessTransport, type SimTransport } from './client';
import { createInProcessTransport } from './inprocess';

const rc = () => netlist([vdc('V1', 'in', '0', 2), res('R1', 'in', 'out', 1e3), cap('C1', 'out', '0', 1e-6)]);

describe('SimClient over the in-process transport', () => {
  it('resolves batch runs with progress', async () => {
    const client = new SimClient(() => createInProcessTransport());
    const progress: number[] = [];
    const [a, b] = await client.run(
      [
        { ...rc(), analyses: [{ type: 'op' }] },
        { ...rc(), analyses: [{ type: 'tran', tstep: 1e-5, tstop: 5e-3, uic: true }] },
      ],
      { onProgress: (f) => progress.push(f) },
    ).promise;
    expect(a[0].vectors.find((v) => v.name === 'V(out)')?.re[0]).toBeCloseTo(2, 9);
    const t = b[0].scale!.re;
    const v = b[0].vectors.find((x) => x.name === 'V(out)')!.re;
    expect(t[t.length - 1]).toBeCloseTo(5e-3, 9);
    expect(v[v.length - 1]).toBeCloseTo(2 * (1 - Math.exp(-5)), 3);
    expect(progress.every((f) => f >= 0 && f <= 1)).toBe(true);
    expect(client.busy).toBe(false);
  });

  it('streams an interactive session until tstop', async () => {
    const client = new SimClient(() => createInProcessTransport());
    const times: number[] = [];
    let latest: Record<string, number> = {};
    const states: string[] = [];
    let vectors: string[] = [];
    const s = client.startInteractive(rc(), { tstep: 1e-5, speed: Infinity, tstop: 3e-3, uic: true }, {
      onStarted: (info) => (vectors = info.vectors),
      onChunk: (chunk, info) => {
        times.push(...chunk.time);
        latest = info.latest;
        expect(chunk.vectors['V(out)'].length).toBe(chunk.time.length);
      },
      onState: (st) => states.push(st),
    });
    const end = await s.done;
    expect(end.state).toBe('finished');
    expect(vectors).toEqual(expect.arrayContaining(['V(in)', 'V(out)', 'I(V1)']));
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeGreaterThanOrEqual(3e-3);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    const tEnd = times[times.length - 1];
    expect(latest['V(out)']).toBeCloseTo(2 * (1 - Math.exp(-tEnd / 1e-3)), 3);
    expect(states[0]).toBe('running');
    expect(states[states.length - 1]).toBe('finished');
  });

  it('pauses, applies parameter edits and stops a session', async () => {
    const client = new SimClient(() => createInProcessTransport());
    let latest: Record<string, number> = {};
    let chunks = 0;
    const s = client.startInteractive(rc(), { tstep: 1e-4, speed: 1 }, {
      onChunk: (_c, info) => {
        latest = info.latest;
        chunks++;
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(chunks).toBeGreaterThan(0);
    s.setParams([{ element: 'V1', param: 'dc', value: 5 }]);
    await new Promise((r) => setTimeout(r, 120));
    s.pause();
    await new Promise((r) => setTimeout(r, 30));
    const frozen = chunks;
    await new Promise((r) => setTimeout(r, 80));
    expect(chunks).toBe(frozen);
    // the capacitor is charging towards the new 5 V source value
    expect(latest['V(in)']).toBeCloseTo(5, 9);
    expect(latest['V(out)']).toBeGreaterThan(2.5);
    s.stop();
    expect((await s.done).state).toBe('stopped');
    expect(client.busy).toBe(false);
  });

  it('queues requests until the lazily loaded engine is ready', async () => {
    const client = new SimClient(createLazyInProcessTransport);
    const [a, b] = await Promise.all([
      client.runOne({ ...rc(), analyses: [{ type: 'op' }] }),
      client.runOne({ ...rc(), analyses: [{ type: 'dc', src: 'V1', start: 0, stop: 4, step: 2 }] }),
    ]);
    expect(a[0].vectors.find((v) => v.name === 'V(out)')?.re[0]).toBeCloseTo(2, 9);
    expect(Array.from(b[0].vectors.find((v) => v.name === 'V(out)')!.re)).toEqual([0, 2, 4]);
  });

  it('reports a session that fails to start', async () => {
    const client = new SimClient(() => createInProcessTransport());
    const errors: string[] = [];
    const s = client.startInteractive(netlist([vdc('V1', 'a', '0', 1), vdc('V2', 'a', '0', 2)]), { tstep: 1e-5 }, { onError: (m) => errors.push(m) });
    const end = await s.done;
    expect(end.state).toBe('error');
    expect(errors).toHaveLength(1);
    expect(end.message).toBe(errors[0]);
  });

  it('cancels a run by restarting the transport', async () => {
    let created = 0;
    let terminated = 0;
    const factory = (): SimTransport => {
      created++;
      const t = createInProcessTransport();
      return { ...t, terminate: () => (terminated++, t.terminate()) };
    };
    const client = new SimClient(factory);
    const run = client.run([{ ...rc(), analyses: [{ type: 'tran', tstep: 1e-6, tstop: 1e-3 }] }]);
    run.cancel();
    await expect(run.promise).rejects.toBeInstanceOf(SimulationCancelled);
    expect(terminated).toBe(1);
    // the next request gets a fresh transport
    const [r] = await client.run([{ ...rc(), analyses: [{ type: 'op' }] }]).promise;
    expect(r[0].vectors.find((v) => v.name === 'V(out)')?.re[0]).toBeCloseTo(2, 9);
    expect(created).toBe(2);
  });
});
