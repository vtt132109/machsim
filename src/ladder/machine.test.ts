import { describe, expect, it } from 'vitest';
import { LadderMachine } from './machine';
import { compileLadder, parseBitAddress, type LadderPort } from './program';
import { fillLadderProbes, ladderLive, ladderProbeKeys } from './probes';
import type { LadderNode, LadderOutput, LadderRung } from './types';

const no = (address: string): LadderNode => ({ kind: 'contact', type: 'no', address });
const nc = (address: string): LadderNode => ({ kind: 'contact', type: 'nc', address });
const rise = (address: string): LadderNode => ({ kind: 'contact', type: 'rising', address });
const fall = (address: string): LadderNode => ({ kind: 'contact', type: 'falling', address });
const and = (...items: LadderNode[]): LadderNode => ({ kind: 'series', items });
const or = (...items: LadderNode[]): LadderNode => ({ kind: 'parallel', items });
const coil = (address: string): LadderOutput => ({ kind: 'coil', address });

let seq = 0;
const r = (logic: LadderNode | undefined, outputs: LadderOutput[]): LadderRung => {
  seq += 1;
  return logic ? { id: `r${seq}`, logic, outputs } : { id: `r${seq}`, outputs };
};

function build(rungs: LadderRung[], opts: { scan?: number; ports?: LadderPort[] } = {}): LadderMachine {
  const { ir, errors } = compileLadder(rungs, opts);
  expect(errors).toEqual([]);
  return new LadderMachine(ir);
}

/** Value of a bit address of a machine. */
function bit(m: LadderMachine, address: string): number {
  const ref = parseBitAddress(address);
  if (ref === null || ref === 'range') throw new Error(`bad address ${address}`);
  return m.bit(ref);
}

/** Drive the input bits, run one scan, read the output bits. */
function step(m: LadderMachine, inputs: Record<string, 0 | 1>): void {
  for (const [address, value] of Object.entries(inputs)) {
    const ref = parseBitAddress(address);
    if (ref === null || ref === 'range' || ref.area !== 'I') throw new Error(`bad input ${address}`);
    m.setInputBit(ref.index, value);
  }
  m.scan();
}

describe('ladder combinational logic', () => {
  const cases: { name: string; logic: LadderNode; table: [Record<string, 0 | 1>, number][] }[] = [
    {
      name: 'normally open contact',
      logic: no('I0.0'),
      table: [
        [{ 'I0.0': 0 }, 0],
        [{ 'I0.0': 1 }, 1],
      ],
    },
    {
      name: 'normally closed contact',
      logic: nc('I0.0'),
      table: [
        [{ 'I0.0': 0 }, 1],
        [{ 'I0.0': 1 }, 0],
      ],
    },
    {
      name: 'series = AND',
      logic: and(no('I0.0'), no('I0.1')),
      table: [
        [{ 'I0.0': 0, 'I0.1': 0 }, 0],
        [{ 'I0.0': 1, 'I0.1': 0 }, 0],
        [{ 'I0.0': 0, 'I0.1': 1 }, 0],
        [{ 'I0.0': 1, 'I0.1': 1 }, 1],
      ],
    },
    {
      name: 'parallel = OR',
      logic: or(no('I0.0'), no('I0.1')),
      table: [
        [{ 'I0.0': 0, 'I0.1': 0 }, 0],
        [{ 'I0.0': 1, 'I0.1': 0 }, 1],
        [{ 'I0.0': 0, 'I0.1': 1 }, 1],
        [{ 'I0.0': 1, 'I0.1': 1 }, 1],
      ],
    },
    {
      name: 'two branches in parallel, each a series',
      logic: or(and(no('I0.0'), no('I0.1')), and(no('I0.2'), nc('I0.3'))),
      table: [
        [{ 'I0.0': 1, 'I0.1': 1, 'I0.2': 0, 'I0.3': 0 }, 1],
        [{ 'I0.0': 1, 'I0.1': 0, 'I0.2': 1, 'I0.3': 0 }, 1],
        [{ 'I0.0': 1, 'I0.1': 0, 'I0.2': 1, 'I0.3': 1 }, 0],
        [{ 'I0.0': 0, 'I0.1': 0, 'I0.2': 0, 'I0.3': 0 }, 0],
      ],
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const m = build([r(c.logic, [coil('Q0.0')])]);
      for (const [inputs, want] of c.table) {
        step(m, inputs);
        expect(bit(m, 'Q0.0')).toBe(want);
      }
    });
  }

  it('an unconditional rung is always true', () => {
    const m = build([r(undefined, [coil('Q0.1')])]);
    m.scan();
    expect(bit(m, 'Q0.1')).toBe(1);
  });

  it('coil-not writes the inverse of the rung', () => {
    const m = build([r(no('I0.0'), [{ kind: 'coil-not', address: 'Q0.0' }])]);
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.0')).toBe(0);
  });
});

describe('ladder scan order', () => {
  it('a later rung sees a coil written earlier in the same scan', () => {
    const m = build([
      r(no('I0.0'), [coil('M0.0')]),
      // reads M0.0 after it was written: follows in the same scan
      r(no('M0.0'), [coil('Q0.0')]),
    ]);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
  });

  it('a rung above the coil sees the value of the previous scan (one scan late)', () => {
    const m = build([
      r(no('M0.0'), [coil('Q0.0')]),
      r(no('I0.0'), [coil('M0.0')]),
    ]);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'M0.0')).toBe(1);
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.0')).toBe(1);
  });
});

describe('ladder latching', () => {
  it('start / stop with self-holding keeps the motor on after the button is released', () => {
    // (Start OR Q0.0) AND NOT Stop -> Q0.0
    const m = build([r(and(or(no('I0.0'), no('Q0.0')), nc('I0.1')), [coil('Q0.0')])]);
    step(m, { 'I0.0': 0, 'I0.1': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 1, 'I0.1': 0 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 0, 'I0.1': 0 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 0, 'I0.1': 1 });
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 0, 'I0.1': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
  });

  it('set and reset latch and clear the same bit, reset wins when it comes later', () => {
    const m = build([
      r(no('I0.0'), [{ kind: 'set', address: 'Q0.0' }]),
      r(no('I0.1'), [{ kind: 'reset', address: 'Q0.0' }]),
    ]);
    step(m, { 'I0.0': 1, 'I0.1': 0 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 0, 'I0.1': 0 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 1, 'I0.1': 1 });
    expect(bit(m, 'Q0.0')).toBe(0);
  });
});

describe('ladder edge contacts', () => {
  it('a rising contact conducts for exactly one scan', () => {
    const m = build([r(rise('I0.0'), [coil('Q0.0')])]);
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.0')).toBe(1);
  });

  it('a falling contact conducts on the release', () => {
    const m = build([r(fall('I0.0'), [coil('Q0.0')])]);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'Q0.0')).toBe(1);
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
  });

  it('an edge contact in a branch that is AND-ed off still sees the change', () => {
    // the OR of a rising edge and a held bit: the edge must not be missed while the other
    // branch is off, so every branch is evaluated on every scan
    const m = build([r(and(no('I0.1'), rise('I0.0')), [coil('Q0.0')])]);
    step(m, { 'I0.0': 1, 'I0.1': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
    step(m, { 'I0.0': 1, 'I0.1': 1 });
    expect(bit(m, 'Q0.0')).toBe(0);
  });
});

describe('ladder timers', () => {
  it('an on-delay timer is done exactly `preset` seconds after the rung became true', () => {
    const scan = 0.01;
    const m = build([r(no('I0.0'), [{ kind: 'ton', address: 'T1', preset: '0.5' }]), r(no('T1'), [coil('Q0.0')])], { scan });
    step(m, { 'I0.0': 1 }); // the scan the rung becomes true: the timer starts at 0
    for (let k = 1; k < 50; k++) {
      step(m, { 'I0.0': 1 });
      expect(bit(m, 'Q0.0')).toBe(0);
      expect(m.timerElapsed[0]).toBeCloseTo(k * scan, 12);
    }
    step(m, { 'I0.0': 1 }); // scan 51: elapsed = 0.50 s
    expect(m.timerElapsed[0]).toBeCloseTo(0.5, 12);
    expect(bit(m, 'T1')).toBe(1);
    expect(bit(m, 'Q0.0')).toBe(1);
    // elapsed stops at the preset and the timer stays done
    step(m, { 'I0.0': 1 });
    expect(m.timerElapsed[0]).toBeCloseTo(0.5, 12);
    expect(bit(m, 'T1')).toBe(1);
    // a false rung clears it at once
    step(m, { 'I0.0': 0 });
    expect(m.timerElapsed[0]).toBe(0);
    expect(bit(m, 'T1')).toBe(0);
  });

  it('an off-delay timer follows the rung up and drops out `preset` seconds later', () => {
    const scan = 0.01;
    const m = build([r(no('I0.0'), [{ kind: 'tof', address: 'T1', preset: '0.2' }]), r(no('T1'), [coil('Q0.0')])], { scan });
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'T1')).toBe(0);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'T1')).toBe(1);
    step(m, { 'I0.0': 0 }); // starts running down
    for (let k = 1; k < 20; k++) {
      step(m, { 'I0.0': 0 });
      expect(bit(m, 'T1')).toBe(1);
    }
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'T1')).toBe(0);
  });

  it('finishes after exactly round(preset / scan) scans, with no floating-point drift', () => {
    // ten additions of 0.01 are less than 0.1 in floating point: a scan counter, not a running sum
    const cases: [string, number, number][] = [
      ['0.1', 0.01, 10],
      ['5', 0.01, 500],
      ['2,3', 0.01, 230],
      ['1.1', 0.001, 1100],
      ['0.25', 0.05, 5],
    ];
    for (const [preset, scan, want] of cases) {
      const m = build([r(no('I0.0'), [{ kind: 'ton', address: 'T1', preset }]), r(no('T1'), [coil('Q0.0')])], { scan });
      step(m, { 'I0.0': 1 });
      let scans = -1;
      for (let k = 1; k <= want + 2 && scans < 0; k++) {
        step(m, { 'I0.0': 1 });
        if (bit(m, 'Q0.0') === 1) scans = k;
      }
      expect(scans, `${preset} s at ${scan} s`).toBe(want);
      // the elapsed time IS the preset once the timer is done, so "T1.ET = preset" matches
      expect(m.timerElapsed[0]).toBe(Number(preset.replace(',', '.')));
    }
  });

  it('an off-delay timer drops out after exactly round(preset / scan) scans', () => {
    const m = build([r(no('I0.0'), [{ kind: 'tof', address: 'T1', preset: '0.1' }]), r(no('T1'), [coil('Q0.0')])], { scan: 0.01 });
    step(m, { 'I0.0': 1 });
    step(m, { 'I0.0': 0 });
    for (let k = 1; k < 10; k++) {
      step(m, { 'I0.0': 0 });
      expect(bit(m, 'Q0.0'), `scan ${k}`).toBe(1);
    }
    step(m, { 'I0.0': 0 });
    expect(bit(m, 'Q0.0')).toBe(0);
  });

  it('an equality comparison on the elapsed time fires on the exact preset', () => {
    const m = build(
      [
        r(no('I0.0'), [{ kind: 'ton', address: 'T1', preset: '0.1' }]),
        r({ kind: 'compare', op: 'eq', left: 'T1.ET', right: '0.1' }, [coil('Q0.1')]),
      ],
      { scan: 0.01 },
    );
    for (let k = 0; k < 10; k++) step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.1')).toBe(0);
    step(m, { 'I0.0': 1 });
    expect(bit(m, 'Q0.1')).toBe(1);
  });

  it('a comparison on the elapsed time switches part way through the delay', () => {
    const scan = 0.01;
    const m = build(
      [
        r(no('I0.0'), [{ kind: 'ton', address: 'T1', preset: '1' }]),
        r({ kind: 'compare', op: 'ge', left: 'T1.ET', right: '0.3' }, [coil('Q0.0')]),
      ],
      { scan },
    );
    for (let k = 0; k <= 30; k++) step(m, { 'I0.0': 1 });
    expect(m.timerElapsed[0]).toBeCloseTo(0.3, 12);
    expect(bit(m, 'Q0.0')).toBe(1);
  });
});

describe('ladder counters', () => {
  it('a count-up counter counts the changes of its rung and resets to zero', () => {
    const m = build([
      r(no('I0.0'), [{ kind: 'ctu', address: 'C1', preset: '3' }]),
      r(no('I0.1'), [{ kind: 'creset', address: 'C1' }]),
      r(no('C1'), [coil('Q0.0')]),
    ]);
    const pulse = () => {
      step(m, { 'I0.0': 1, 'I0.1': 0 });
      step(m, { 'I0.0': 0, 'I0.1': 0 });
    };
    pulse();
    expect(m.counterValue[0]).toBe(1);
    pulse();
    pulse();
    expect(m.counterValue[0]).toBe(3);
    expect(bit(m, 'C1')).toBe(1);
    expect(bit(m, 'Q0.0')).toBe(1);
    // holding the input does not count again
    step(m, { 'I0.0': 1, 'I0.1': 0 });
    step(m, { 'I0.0': 1, 'I0.1': 0 });
    expect(m.counterValue[0]).toBe(4);
    step(m, { 'I0.0': 0, 'I0.1': 1 });
    expect(m.counterValue[0]).toBe(0);
    expect(bit(m, 'C1')).toBe(0);
  });

  it('a count-down counter starts at its preset and is done at zero', () => {
    const m = build([r(no('I0.0'), [{ kind: 'ctd', address: 'C1', preset: '2' }]), r(no('C1'), [coil('Q0.0')])]);
    expect(m.counterValue[0]).toBe(2);
    step(m, { 'I0.0': 1 });
    step(m, { 'I0.0': 0 });
    expect(m.counterValue[0]).toBe(1);
    step(m, { 'I0.0': 1 });
    expect(m.counterValue[0]).toBe(0);
    expect(bit(m, 'Q0.0')).toBe(1);
    // it never goes below zero
    step(m, { 'I0.0': 0 });
    step(m, { 'I0.0': 1 });
    expect(m.counterValue[0]).toBe(0);
  });
});

describe('ladder channels', () => {
  it('thresholds a digital input channel with hysteresis and drives the output voltage', () => {
    const ports: LadderPort[] = [
      { kind: 'di', index: 0, vth: 12, vhys: 4 },
      { kind: 'q', index: 0, von: 24 },
    ];
    const m = build([r(no('I0.0'), [coil('Q0.0')])], { ports });
    m.setPortVoltage(0, 0);
    m.scan();
    expect(m.portOutput(1)).toBe(0);
    m.setPortVoltage(0, 13); // inside the hysteresis band: no change yet
    m.scan();
    expect(m.portOutput(1)).toBe(0);
    m.setPortVoltage(0, 20);
    m.scan();
    expect(m.portOutput(1)).toBe(24);
    m.setPortVoltage(0, 11); // still inside the band: stays on
    m.scan();
    expect(m.portOutput(1)).toBe(24);
    m.setPortVoltage(0, 2);
    m.scan();
    expect(m.portOutput(1)).toBe(0);
  });

  it('an analog channel drives a comparison contact', () => {
    const ports: LadderPort[] = [
      { kind: 'ai', index: 0 },
      { kind: 'q', index: 0, von: 24 },
    ];
    const m = build([r({ kind: 'compare', op: 'gt', left: 'AI0', right: '7.5' }, [coil('Q0.0')])], { ports });
    m.setPortVoltage(0, 5);
    m.scan();
    expect(bit(m, 'Q0.0')).toBe(0);
    m.setPortVoltage(0, 8);
    m.scan();
    expect(bit(m, 'Q0.0')).toBe(1);
  });

  it('an input channel with no wire reads off', () => {
    const m = build([r(no('I0.3'), [coil('Q0.0')])]);
    m.scan();
    expect(bit(m, 'Q0.0')).toBe(0);
  });
});

describe('ladder read-outs', () => {
  it('publishes the images, the timers and the element states under stable keys', () => {
    const scan = 0.01;
    const m = build(
      [
        r(and(or(no('I0.0'), no('Q0.0')), nc('I0.1')), [coil('Q0.0')]),
        r(no('Q0.0'), [{ kind: 'ton', address: 'T1', preset: '0.05' }]),
        r(no('T1'), [coil('M1.2')]),
      ],
      { scan },
    );
    const keys = ladderProbeKeys(m.ir);
    expect(keys).toContain('Lscan');
    expect(keys).toContain('Li0');
    expect(keys).toContain('Lq0');
    expect(keys).toContain('Lm1');
    expect(keys).toContain('Lt0');
    expect(keys).toContain('Ltd0');
    for (let k = 0; k <= 6; k++) step(m, { 'I0.0': 1, 'I0.1': 0 });
    const probe: Record<string, number> = {};
    for (const k of keys) probe[k] = 0;
    fillLadderProbes(m, probe);
    expect(Object.keys(probe).sort()).toEqual(keys.slice().sort());
    expect(probe.Lq0).toBe(1);
    expect(probe.Li0).toBe(1);
    expect(probe.Lm1).toBe(4);
    expect(probe.Lt0).toBeCloseTo(0.05, 12);
    expect(probe.Ltd0).toBe(1);

    // the same record read back the way the editor reads it from the live vectors
    const values: Record<string, number> = {};
    for (const [k, v] of Object.entries(probe)) values[`${k}(A_U1)`.toLowerCase()] = v;
    const live = ladderLive(values, 'A_U1', m.ir);
    expect(live).not.toBeNull();
    expect(live!.outputs[0]).toBe(1);
    expect(live!.timers[0].done).toBe(true);
    expect(live!.timers[0].elapsed).toBeCloseTo(0.05, 12);
    // every element of the three rungs conducts in this state
    expect(live!.slots[m.ir.rungs[0].slot]).toBe(true);
    expect(live!.slots[m.ir.rungs[2].slot]).toBe(true);
    expect(ladderLive({}, 'A_U1', m.ir)).toBeNull();
  });

  it('reset puts the machine back to its power-up state', () => {
    const m = build([r(no('I0.0'), [{ kind: 'set', address: 'Q0.0' }]), r(no('I0.1'), [{ kind: 'ctd', address: 'C1', preset: '4' }])]);
    step(m, { 'I0.0': 1, 'I0.1': 1 });
    expect(bit(m, 'Q0.0')).toBe(1);
    expect(m.counterValue[0]).toBe(3);
    m.reset();
    expect(bit(m, 'Q0.0')).toBe(0);
    expect(m.counterValue[0]).toBe(4);
    expect(m.scans).toBe(0);
  });
});
