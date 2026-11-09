import { describe, expect, it } from 'vitest';
import type { Device, LoadContext, SetupContext } from '../device';
import { registerDeviceFactory } from '../devices/registry';
import type { ElementIR } from '../netlist';
import { SimulationError, findVector, type AnalysisResult } from '../results';
import { Circuit } from './circuit';
import { gminStepping, solveOperatingPoint, sourceStepping } from './newton';
import { runAnalyses } from './run';
import { RealSystem } from './system';
import { cap, cccs, ccvs, idc, ind, netlist, res, vccs, vcvs, vdc, vswitch, model } from './testing';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);

function op(elements: ElementIR[], extra: Parameters<typeof netlist>[2] = {}): AnalysisResult {
  const [r] = runAnalyses(netlist(elements, [{ type: 'op' }], extra));
  if (r.error) throw new Error(r.error);
  return r;
}

function scalar(r: AnalysisResult, name: string): number {
  const v = r.scalars?.[name];
  if (v === undefined) throw new Error(`missing ${name}; have ${Object.keys(r.scalars ?? {}).join(', ')}`);
  return v;
}

// ---------------------------------------------------------------------------------------------
// A minimal exponential diode used to exercise the Newton machinery with a nonlinear element.
// ---------------------------------------------------------------------------------------------
const IS = 1e-14;
const VT = 0.025852;

class TestDiode implements Device {
  readonly type = 'D' as const;
  readonly name: string;
  readonly nodeNames: string[];
  private a = -1;
  private k = -1;
  private st = -1;
  private readonly limit: boolean;

  constructor(el: ElementIR) {
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 2);
    this.limit = (el.params.limit ?? 1) !== 0;
  }

  setup(ctx: SetupContext): void {
    this.a = ctx.node(this.nodeNames[0]);
    this.k = ctx.node(this.nodeNames[1]);
    this.st = ctx.state(1);
  }

  load(ctx: LoadContext): void {
    let v: number;
    if (ctx.initJunctions) v = this.limit ? 0.6 : 0;
    else {
      const vnew = ctx.x(this.a) - ctx.x(this.k);
      v = vnew;
      if (this.limit) {
        const vold = ctx.state0[this.st];
        const vcrit = VT * Math.log(VT / (Math.SQRT2 * IS));
        if (vnew > vcrit && Math.abs(vnew - vold) > 2 * VT) {
          if (vold > 0) {
            const arg = 1 + (vnew - vold) / VT;
            v = arg > 0 ? vold + VT * Math.log(arg) : vcrit;
          } else v = VT * Math.log(vnew / VT);
        }
        if (v !== vnew) ctx.noncon();
      }
    }
    ctx.state0[this.st] = v;
    const e = Math.exp(v / VT);
    const id = IS * (e - 1) + ctx.gmin * v;
    const gd = (IS * e) / VT + ctx.gmin;
    ctx.addMatrix(this.a, this.a, gd);
    ctx.addMatrix(this.k, this.k, gd);
    ctx.addMatrix(this.a, this.k, -gd);
    ctx.addMatrix(this.k, this.a, -gd);
    const ieq = id - gd * v;
    ctx.addRhs(this.a, -ieq);
    ctx.addRhs(this.k, ieq);
  }
}

registerDeviceFactory('D', (el) => new TestDiode(el));
const diode = (name: string, a: string, k: string, limit = true): ElementIR => ({
  type: 'D',
  name,
  nodes: [a, k],
  params: { limit: limit ? 1 : 0 },
});

/** Diode voltage of V -- R -- D by bisection (reference). */
function diodeReference(V: number, R: number): number {
  let lo = 0;
  let hi = Math.min(V, 2);
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2;
    const f = (V - m) / R - IS * (Math.exp(m / VT) - 1);
    if (f > 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

describe('operating point of linear circuits', () => {
  it('voltage divider: node voltages, SPICE-signed source current, resistor current and power', () => {
    const r = op([vdc('V1', 'in', '0', 10), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 3e3)]);
    expect(scalar(r, 'V(out)')).toBeCloseTo(7.5, 12);
    expect(scalar(r, 'V(in)')).toBeCloseTo(10, 12);
    expect(scalar(r, 'I(V1)')).toBeCloseTo(-2.5e-3, 15);
    expect(scalar(r, 'I(R1)')).toBeCloseTo(2.5e-3, 15);
    expect(scalar(r, 'P(R1)')).toBeCloseTo(6.25e-3, 15);
    expect(findVector(r, 'v(OUT)')?.re[0]).toBeCloseTo(7.5, 12);
  });

  it('Wheatstone bridge matches the nodal solution', () => {
    const [R1, R2, R3, R4, R5, V] = [1e3, 2e3, 3e3, 4e3, 5e3, 10];
    const r = op([
      vdc('V1', 'top', '0', V),
      res('R1', 'top', 'a', R1),
      res('R2', 'a', '0', R2),
      res('R3', 'top', 'b', R3),
      res('R4', 'b', '0', R4),
      res('R5', 'a', 'b', R5),
    ]);
    // [1/R1+1/R2+1/R5, -1/R5; -1/R5, 1/R3+1/R4+1/R5] [va; vb] = [V/R1; V/R3]
    const a11 = 1 / R1 + 1 / R2 + 1 / R5;
    const a12 = -1 / R5;
    const a22 = 1 / R3 + 1 / R4 + 1 / R5;
    const det = a11 * a22 - a12 * a12;
    const va = ((V / R1) * a22 - a12 * (V / R3)) / det;
    const vb = (a11 * (V / R3) - a12 * (V / R1)) / det;
    expect(rel(scalar(r, 'V(a)'), va)).toBeLessThan(1e-12);
    expect(rel(scalar(r, 'V(b)'), vb)).toBeLessThan(1e-12);
    expect(rel(scalar(r, 'I(R5)'), (va - vb) / R5)).toBeLessThan(1e-10);
  });

  it('superposition of a voltage and a current source', () => {
    const R1 = 2e3;
    const R2 = 6e3;
    const V = 12;
    const I = 1.5e-3;
    const both = op([vdc('V1', 'in', '0', V), res('R1', 'in', 'n', R1), res('R2', 'n', '0', R2), idc('I1', '0', 'n', I)]);
    const vOnly = op([vdc('V1', 'in', '0', V), res('R1', 'in', 'n', R1), res('R2', 'n', '0', R2), idc('I1', '0', 'n', 0)]);
    const iOnly = op([vdc('V1', 'in', '0', 0), res('R1', 'in', 'n', R1), res('R2', 'n', '0', R2), idc('I1', '0', 'n', I)]);
    const expected = (V / R1 + I) / (1 / R1 + 1 / R2);
    expect(rel(scalar(both, 'V(n)'), expected)).toBeLessThan(1e-12);
    expect(rel(scalar(vOnly, 'V(n)') + scalar(iOnly, 'V(n)'), scalar(both, 'V(n)'))).toBeLessThan(1e-12);
    // current source outputs: I is the source value, P = v(n+,n-)*I (absorbed, negative when delivering)
    expect(scalar(both, 'I(I1)')).toBeCloseTo(I, 15);
    expect(rel(scalar(both, 'P(I1)'), -expected * I)).toBeLessThan(1e-12);
  });

  it('E, F, G and H controlled sources', () => {
    const r = op([
      vdc('V1', 'in', '0', 2),
      res('Rin', 'in', '0', 1e3),
      // E: out_e = 5 * v(in)
      vcvs('E1', 'oe', '0', 'in', '0', 5),
      res('RLe', 'oe', '0', 1e3),
      // G: 2 mS * v(in) from og to ground -> v(og) = -gm*vin*RL
      vccs('G1', 'og', '0', 'in', '0', 2e-3),
      res('RLg', 'og', '0', 500),
      // ammeter in the input branch: current through V0 = 2 V / 1 kΩ = 2 mA (flows into V0's + terminal)
      vdc('V0', 'in', 'm', 0),
      res('Rm', 'm', '0', 1e3),
      // F: 3 * i(V0) from of to ground -> v(of) = -3*i*RL
      cccs('F1', 'of', '0', 'V0', 3),
      res('RLf', 'of', '0', 100),
      // H: v(oh) = 250 Ω * i(V0)
      ccvs('H1', 'oh', '0', 'V0', 250),
      res('RLh', 'oh', '0', 1e3),
    ]);
    const i0 = 2e-3;
    expect(scalar(r, 'I(V0)')).toBeCloseTo(i0, 15);
    expect(scalar(r, 'V(oe)')).toBeCloseTo(10, 12);
    expect(scalar(r, 'V(og)')).toBeCloseTo(-2e-3 * 2 * 500, 12);
    expect(scalar(r, 'V(of)')).toBeCloseTo(-3 * i0 * 100, 12);
    expect(scalar(r, 'V(oh)')).toBeCloseTo(250 * i0, 12);
    // E delivers 10 mA into RLe, so (SPICE sign) its branch current is negative
    expect(scalar(r, 'I(E1)')).toBeCloseTo(-10 / 1e3, 14);
    expect(scalar(r, 'I(G1)')).toBeCloseTo(4e-3, 15);
    expect(scalar(r, 'I(F1)')).toBeCloseTo(6e-3, 15);
  });

  it('reports a temperature-dependent resistor at the circuit temperature', () => {
    const r = op([vdc('V1', 'in', '0', 1), res('R1', 'in', '0', 100, { tc1: 0.01, tc2: 1e-4 })], { options: { temp: 77 } });
    const R = 100 * (1 + 0.01 * 50 + 1e-4 * 2500);
    expect(rel(scalar(r, 'I(R1)'), 1 / R)).toBeLessThan(1e-12);
  });

  it('honours explicit output requests and names vectors as written in the netlist', () => {
    const r = op([vdc('V1', 'In', '0', 10), res('R1', 'In', 'Out', 1e3), res('R2', 'Out', '0', 1e3)], {
      saves: ['V(out)', 'v(In,Out)', 'I(r1)', 'P(R2)', 'missing', 'Q(R1)'],
    });
    expect(r.vectors.map((v) => v.name)).toEqual(['V(Out)', 'V(In,Out)', 'I(R1)', 'P(R2)']);
    expect(r.vectors.map((v) => v.unit)).toEqual(['V', 'V', 'A', 'W']);
    expect(scalar(r, 'V(In,Out)')).toBeCloseTo(5, 12);
    expect(r.warnings.length).toBe(2);
  });

  it('applies rshunt so that capacitor-only nodes become solvable', () => {
    const elements = [vdc('V1', 'in', '0', 10), res('R1', 'in', 'a', 1e3), cap('C1', 'a', 'b', 1e-6), cap('C2', 'b', '0', 1e-6)];
    const r = op(elements, { options: { rshunt: 1e9 } });
    expect(scalar(r, 'V(b)')).toBeCloseTo(0, 9);
    expect(rel(scalar(r, 'V(a)'), (10 * 1e9) / (1e9 + 1e3))).toBeLessThan(1e-9);
  });

  it('treats .ic as a nodeset in a plain operating point (released before the final solve)', () => {
    const r = op([vdc('V1', 'in', '0', 10), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 3e3)], { ic: { out: 1 } });
    expect(scalar(r, 'V(out)')).toBeCloseTo(7.5, 12);
  });
});

describe('Newton-Raphson with a nonlinear element', () => {
  it('converges to the diode operating point (with limiting)', () => {
    const r = op([vdc('V1', 'in', '0', 5), res('R1', 'in', 'a', 1e3), diode('D1', 'a', '0')]);
    // Newton stops within SPICE tolerances (reltol = 1e-3); the result is far closer than that
    expect(rel(scalar(r, 'V(a)'), diodeReference(5, 1e3))).toBeLessThan(1e-4);
  });

  it('nodeset guides the solution and is then released', () => {
    const r = op([vdc('V1', 'in', '0', 5), res('R1', 'in', 'a', 1e3), diode('D1', 'a', '0')], { nodeset: { a: 0.7 } });
    expect(rel(scalar(r, 'V(a)'), diodeReference(5, 1e3))).toBeLessThan(1e-4);
  });

  it('falls back to stepping when plain Newton diverges, reaching the same solution', () => {
    // no limiting: plain Newton overflows exp() from the zero initial guess
    const circuit = new Circuit(netlist([vdc('V1', 'in', '0', 20), res('R1', 'in', 'a', 1e3), diode('D1', 'a', '0', false)]));
    const sys = new RealSystem(circuit);
    const result = solveOperatingPoint(sys, { mode: 'op' });
    expect(result.strategy).not.toBe('newton');
    const a = circuit.nodeIndex('a') as number;
    expect(rel(sys.x[a], diodeReference(20, 1e3))).toBeLessThan(1e-4);
  });

  it('gmin stepping and source stepping reproduce the plain Newton solution', () => {
    const elements = [vdc('V1', 'in', '0', 3), res('R1', 'in', 'a', 2.2e3), diode('D1', 'a', 'b'), res('R2', 'b', '0', 470)];
    const circuit = new Circuit(netlist(elements));
    const sys = new RealSystem(circuit);
    solveOperatingPoint(sys, { mode: 'op' });
    const ref = sys.x.slice();
    for (const method of [gminStepping, sourceStepping]) {
      const s = new RealSystem(circuit);
      s.ctx.mode = 'op';
      const r = method(s);
      expect(r.converged).toBe(true);
      for (let i = 0; i < ref.length; i++) expect(Math.abs(s.x[i] - ref[i])).toBeLessThan(1e-9 + 1e-4 * Math.abs(ref[i]));
    }
  });
});

describe('stepping on linear circuits', () => {
  it('gmin and source stepping leave linear results unchanged', () => {
    const elements = [
      vdc('V1', 'in', '0', 10),
      res('R1', 'in', 'a', 1e3),
      res('R2', 'a', '0', 2e3),
      idc('I1', '0', 'a', 1e-3),
      vcvs('E1', 'o', '0', 'a', '0', 3),
      res('RL', 'o', '0', 1e3),
    ];
    const circuit = new Circuit(netlist(elements));
    const direct = new RealSystem(circuit);
    solveOperatingPoint(direct, { mode: 'op' });
    for (const method of [gminStepping, sourceStepping]) {
      const s = new RealSystem(circuit);
      const r = method(s);
      expect(r.converged).toBe(true);
      for (let i = 0; i < direct.x.length; i++) expect(Math.abs(s.x[i] - direct.x[i])).toBeLessThan(1e-12 * (1 + Math.abs(direct.x[i])));
    }
  });
});

describe('DC sweep', () => {
  const divider = [vdc('V1', 'in', '0', 0), res('R1', 'in', 'out', 1e3), res('R2', 'out', '0', 3e3), idc('I1', '0', 'out', 0)];

  it('is linear in the swept source, with the scale named after it', () => {
    const [r] = runAnalyses(netlist(divider, [{ type: 'dc', src: 'V1', start: -5, stop: 5, step: 0.5 }]));
    expect(r.error).toBeUndefined();
    expect(r.scale?.name).toBe('V1');
    expect(r.scale?.unit).toBe('V');
    const s = r.scale?.re as Float64Array;
    expect(s.length).toBe(21);
    expect(s[0]).toBe(-5);
    expect(s[20]).toBeCloseTo(5, 12);
    const out = findVector(r, 'V(out)')?.re as Float64Array;
    for (let k = 0; k < s.length; k++) expect(out[k]).toBeCloseTo(0.75 * s[k], 12);
  });

  it('runs a nested sweep with one run per outer value plus flattened vectors', () => {
    const [r] = runAnalyses(
      netlist(divider, [{ type: 'dc', src: 'V1', start: 0, stop: 10, step: 1, src2: { src: 'I1', start: 0, stop: 2e-3, step: 1e-3 } }]),
    );
    expect(r.error).toBeUndefined();
    expect(r.runs?.length).toBe(3);
    expect(r.runs?.map((x) => x.label)).toEqual(['I1=0', 'I1=0.001', 'I1=0.002']);
    expect(r.scale?.re.length).toBe(33);
    r.runs?.forEach((run, j) => {
      const i = j * 1e-3;
      const sc = run.result.scale?.re as Float64Array;
      const out = findVector(run.result, 'V(out)')?.re as Float64Array;
      for (let k = 0; k < sc.length; k++) {
        const expected = (sc[k] / 1e3 + i) / (1 / 1e3 + 1 / 3e3);
        expect(out[k]).toBeCloseTo(expected, 10);
      }
    });
    const flat = findVector(r, 'V(out)')?.re as Float64Array;
    expect(flat[11 + 4]).toBeCloseTo((4 / 1e3 + 1e-3) / (1 / 1e3 + 1 / 3e3), 10);
  });

  it('sweeps the temperature', () => {
    const [r] = runAnalyses(
      netlist([vdc('V1', 'in', '0', 1), res('R1', 'in', '0', 100, { tc1: 2e-3 })], [{ type: 'dc', src: 'temp', start: 27, stop: 127, step: 50 }], {
        saves: ['I(R1)'],
      }),
    );
    expect(r.scale?.name).toBe('temp');
    const i = findVector(r, 'I(R1)')?.re as Float64Array;
    [27, 77, 127].forEach((t, k) => expect(rel(i[k], 1 / (100 * (1 + 2e-3 * (t - 27))))).toBeLessThan(1e-12));
  });

  it('switches with hysteresis keep their state between sweep points', () => {
    // control ramps up then down through the hysteresis window (vt = 2.5, vh = 0.5)
    const sw = model('smod', 'SW', { vt: 2.5, vh: 0.5, ron: 1, roff: 1e6 });
    const elements = [vdc('Vc', 'c', '0', 0), vdc('V1', 'in', '0', 1), res('R1', 'in', 'o', 1e3), vswitch('S1', 'o', '0', 'c', '0', 'smod')];
    const up = runAnalyses(netlist(elements, [{ type: 'dc', src: 'Vc', start: 0, stop: 5, step: 0.25 }], { models: [sw] }))[0];
    const down = runAnalyses(netlist(elements, [{ type: 'dc', src: 'Vc', start: 5, stop: 0, step: 0.25 }], { models: [sw] }))[0];
    const vu = findVector(up, 'V(o)')?.re as Float64Array;
    const vd = findVector(down, 'V(o)')?.re as Float64Array;
    const su = up.scale?.re as Float64Array;
    const sd = down.scale?.re as Float64Array;
    // going up: on only above 3.0 V; going down: off only below 2.0 V
    su.forEach((c, k) => expect(vu[k] < 0.01).toBe(c > 3.0));
    sd.forEach((c, k) => expect(vd[k] < 0.01).toBe(c >= 2.0));
  });
});

describe('error reporting', () => {
  it('names a node that only connects to capacitors', () => {
    const [r] = runAnalyses(
      netlist([vdc('V1', 'in', '0', 10), res('R1', 'in', 'a', 1e3), cap('C1', 'a', 'flt', 1e-6), cap('C2', 'flt', '0', 1e-6)], [{ type: 'op' }]),
    );
    expect(r.error).toMatch(/Singular matrix/);
    expect(r.error).toMatch(/node 'flt'/);
    expect(r.error).toMatch(/floating/);
    const circuit = new Circuit(netlist([vdc('V1', 'in', '0', 10), res('R1', 'in', 'a', 1e3), cap('C1', 'a', 'flt', 1e-6), cap('C2', 'flt', '0', 1e-6)]));
    try {
      solveOperatingPoint(new RealSystem(circuit), { mode: 'op' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SimulationError);
      expect((e as SimulationError).code).toBe('singular');
      expect((e as SimulationError).detail).toBe("node 'flt'");
    }
  });

  it('reports a voltage-source loop', () => {
    const [r] = runAnalyses(netlist([vdc('V1', 'a', '0', 5), vdc('V2', 'a', '0', 3), res('R1', 'a', '0', 1e3)], [{ type: 'op' }]));
    expect(r.error).toMatch(/Singular matrix/);
    expect(r.error).toMatch(/V1|V2/);
    expect(r.error).toMatch(/loop of voltage sources/);
  });

  it('reports an inductor shorting a voltage source in DC', () => {
    const [r] = runAnalyses(netlist([vdc('V1', 'a', '0', 1), ind('L1', 'a', '0', 1e-3)], [{ type: 'op' }]));
    expect(r.error).toMatch(/Singular matrix/);
    expect(r.error).toMatch(/V1|L1|node 'a'/);
  });

  // every contract element type has a device since the lossy line (O, LTRA) was added; an element
  // type outside the contract (as a corrupted IR could carry) still reports 'unsupported'
  it('rejects unsupported element types', () => {
    const odd = { type: 'Y', name: 'Y1', nodes: ['a', '0', 'b', '0'], params: {} } as unknown as ElementIR;
    const n = netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 1), odd], [{ type: 'op' }, { type: 'dc', src: 'V1', start: 0, stop: 1, step: 1 }]);
    const results = runAnalyses(n);
    expect(results.length).toBe(2);
    for (const r of results) expect(r.error).toMatch(/'Y' \(Y1\) is not supported/);
    try {
      new Circuit(n);
      expect.unreachable();
    } catch (e) {
      expect((e as SimulationError).code).toBe('unsupported');
    }
  });

  it('reports unknown controlling sources and analyses without a runner', () => {
    const [r1] = runAnalyses(netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 1), cccs('F1', 'a', '0', 'Vx', 2)], [{ type: 'op' }]));
    expect(r1.error).toMatch(/F1: controlling element 'Vx' not found/);
    const [r2] = runAnalyses(netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', '0', 1)], [{ type: 'pz', inPos: 'a', inNeg: '0', outPos: 'a', outNeg: '0', transfer: 'vol', find: 'pz' }]));
    expect(r2.error).toMatch(/not supported/);
  });

  it('reports progress and honours cancellation', () => {
    const n = netlist(
      [vdc('V1', 'a', '0', 1), res('R1', 'a', 'b', 1e3), cap('C1', 'b', '0', 1e-6)],
      [
        { type: 'dc', src: 'V1', start: 0, stop: 10, step: 0.01 },
        { type: 'tran', tstep: 1e-5, tstop: 1e-2 },
      ],
    );
    const seen: number[] = [];
    const ok = runAnalyses(n, { onProgress: (f) => seen.push(f) });
    expect(ok.every((r) => r.error === undefined)).toBe(true);
    expect(seen.length).toBeGreaterThan(5);
    for (let k = 1; k < seen.length; k++) expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1]);
    expect(seen.some((f) => f > 0 && f < 0.5)).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
    const aborted = runAnalyses(n, { signal: { aborted: true } });
    expect(aborted.map((r) => r.error)).toEqual(['Simulation aborted', 'Simulation aborted']);
  });

  it('runs an operating point when no analysis is given', () => {
    const results = runAnalyses(netlist([vdc('V1', 'a', '0', 2), res('R1', 'a', '0', 1e3)]));
    expect(results.length).toBe(1);
    expect(results[0].type).toBe('op');
    expect(results[0].scalars?.['V(a)']).toBe(2);
    expect(results[0].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('numbers node voltages before branch currents', () => {
    const c = new Circuit(netlist([vdc('V1', 'a', '0', 1), res('R1', 'a', 'b', 1), ind('L1', 'b', 'c', 1e-3), res('R2', 'c', '0', 1)]));
    expect(c.numNodes).toBe(3);
    expect(c.size).toBe(5);
    expect(c.nodeNames()).toEqual(['a', 'b', 'c']);
    expect(c.branchIndex('V1')).toBeGreaterThanOrEqual(3);
    expect(c.branchIndex('l1')).toBeGreaterThanOrEqual(3);
    expect(c.describeUnknown(c.branchIndex('L1'))).toBe("branch current of 'L1'");
    expect(c.nodeIndex('GND')).toBe(-1);
    expect(c.nodeIndex('nope')).toBeUndefined();
  });
});
