/**
 * SPICE netlist -> schematic: the generated schematic simulates exactly like the deck (node
 * voltages of every deck node at the operating point and over a transient), parts never overlap,
 * every pin is connected, and the deck's node names survive as net labels.
 */
import { describe, expect, it } from 'vitest';
import { parseSpice, writeSpice } from '../sim/spice';
import { resolveDeckIncludes } from './spiceIncludes';
import { runAnalyses } from '../sim';
import type { AnalysisSpec, Netlist } from '../sim/netlist';
import { getPart } from '../library';
import { buildNetlist } from './netlister';
import { designPartLookup } from './hierarchy';
import { instanceBBox } from './geometry';
import { pspiceCompat, spiceToSchematic } from './spiceSchematic';
import { parseDesign, serializeDesign } from './serialize';

function parse(text: string): Netlist {
  const r = parseSpice(text);
  expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
  return r.netlist;
}

function values(netlist: Netlist, spec: AnalysisSpec): Map<string, Float64Array> {
  const res = runAnalyses({ ...netlist, analyses: [spec] })[0];
  expect(res.error, res.error).toBeUndefined();
  return new Map(res.vectors.filter((v) => v.name.startsWith('V(')).map((v) => [v.name.toLowerCase(), v.re]));
}

/** Convert, check layout, and compare every deck node's voltage with the deck itself. */
function roundTrip(text: string, specs: AnalysisSpec[]) {
  const deck = parse(text);
  const r = spiceToSchematic(deck, { fileName: 'test.cir' });
  const design = parseDesign(serializeDesign(r.design));
  const lookup = designPartLookup(design, getPart);
  // no two parts overlap
  const parts = design.sheets[0].parts;
  const boxes = parts.map((p) => ({ p, b: instanceBBox(p, lookup(p.partId)!) }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].b;
      const b = boxes[j].b;
      const overlap = a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
      expect(overlap, `${boxes[i].p.refdes} overlaps ${boxes[j].p.refdes}`).toBe(false);
    }
  const build = buildNetlist(design, { includeAnalysis: false });
  const problems = build.erc.filter((m) => m.code === 'floating-pin' || m.code === 'unknown-part' || m.code === 'bad-param' || m.severity === 'error');
  expect(problems.map((m) => m.message)).toEqual([]);
  expect(build.erc.filter((m) => /passes over|on a wire/i.test(m.message)).map((m) => m.message)).toEqual([]);
  for (const spec of specs) {
    const want = values(deck, spec);
    const got = values(build.netlist, spec);
    let compared = 0;
    for (const [name, w] of want) {
      if (name.includes('.') || name.includes('#')) continue; // internal nodes of subcircuits / devices
      const g = got.get(name);
      expect(g, `${name} missing in the schematic netlist`).toBeDefined();
      const n = Math.min(w.length, g!.length);
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 50))) expect(g![i], `${spec.type} ${name}[${i}]`).toBeCloseTo(w[i], 6);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
  }
  return { r, design, build };
}

describe('SPICE netlist to schematic', () => {
  it('RC low-pass with a pulse source: library parts, wires, node names kept', () => {
    const { r, design } = roundTrip(
      `RC low-pass
V1 in 0 PULSE(0 5 0 1u 1u 0.5m 1m)
R1 in out 1k
C1 out 0 100n
.tran 10u 2m
.end`,
      [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 2e-3 }],
    );
    const ids = design.sheets[0].parts.map((p) => p.partId).sort();
    expect(ids).toEqual(['basic/capacitor', 'basic/resistor', 'sources/ground', 'sources/ground', 'sources/pulse-voltage']);
    expect(r.stats.blocks).toBe(0);
    expect(r.stats.wires).toBeGreaterThanOrEqual(2);
    expect(design.sheets[0].labels.map((l) => l.name).sort()).toEqual(['in', 'out']);
    expect(design.analysis.active).toBe('tran');
    expect(design.analysis.specs.tran).toEqual({ type: 'tran', tstep: 1e-5, tstop: 2e-3 });
  });

  it('BJT amplifier with .model cards: transistors keep the deck models (modelOverride)', () => {
    const { design } = roundTrip(
      `CE amplifier
VCC vcc 0 12
VIN in 0 SIN(0 10m 1k) AC 1
R1 vcc b 47k
R2 b 0 10k
RC vcc c 4.7k
RE e 0 1k
CIN in b 10u
Q1 c b e QN2222
.model QN2222 NPN(IS=1e-14 BF=200 VAF=100 CJE=10p CJC=5p)
.end`,
      [{ type: 'op' }, { type: 'tran', tstep: 1e-5, tstop: 2e-3 }, { type: 'acsingle', freq: 1000 }],
    );
    const q = design.sheets[0].parts.find((p) => p.refdes === 'Q1')!;
    expect(q.partId).toBe('transistors/npn');
    expect(q.modelOverride).toBe('QN2222');
    expect(design.customSpice).toContain('QN2222');
  });

  it('diode bridge, MOSFET and controlled sources', () => {
    roundTrip(
      `mixed
V1 a b SIN(0 10 50)
RG b 0 1meg
D1 a p DX
D2 b p DX
D3 n a DX
D4 n b DX
RL p n 1k
.model DX D(IS=2n N=1.9 RS=0.05)
VDD vdd 0 5
M1 d g 0 0 NM W=10u L=1u
RD vdd d 2k
VG g 0 2
.model NM NMOS(LEVEL=1 VTO=1 KP=100u)
E1 eo 0 d 0 2
RE eo 0 10k
G1 0 go g 0 1m
RGO go 0 1k
.end`,
      [{ type: 'op' }, { type: 'tran', tstep: 1e-4, tstop: 4e-2 }],
    );
  });

  it('subcircuit instances become SPICE blocks; K couplings and F sources stay exact', () => {
    const { r, design } = roundTrip(
      `blocks
.subckt AMP in out PARAMS: G=2
E1 out 0 in 0 {G}
RO out 0 1meg
.ends AMP
VS s 0 SIN(0 1 1k)
X1 s o1 AMP G=3
X2 o1 o2 AMP
R1 o2 0 1k
VP p1 0 SIN(0 1 10k)
RP p1 a 10
L1 a 0 1m
L2 b 0 1m
K1 L1 L2 0.9
RB b 0 100
VX x 0 2
RX x xs 1k
VSENSE xs 0 0
F1 0 fo VSENSE 3
RF fo 0 1k
B1 bo 0 V=V(x)*0.5
RB2 bo 0 1k
.end`,
      [{ type: 'op' }, { type: 'tran', tstep: 1e-6, tstop: 3e-4 }],
    );
    const ids = new Set(design.sheets[0].parts.map((p) => p.partId));
    expect(ids.has('custom:spice-amp')).toBe(true);
    expect(design.customParts?.find((c) => c.id === 'custom:spice-amp')?.symbol.pins.map((p) => p.name)).toEqual(['in', 'out']);
    // X1 carries its PARAMS override, X2 the default
    expect(design.sheets[0].parts.find((p) => p.refdes === 'X1')?.params).toEqual({ G: '3' });
    expect(r.notes.some((n) => n.kind === 'block' && n.name.includes('K1'))).toBe(true);
    expect(r.notes.some((n) => n.kind === 'controlled' && n.name === 'F1')).toBe(true);
    expect(r.notes.some((n) => n.kind === 'block' && n.name === 'B1')).toBe(true);
  });

  it('PSpice netlists: R_R1 names become R1, PSpice-only cards are commented out', () => {
    const src = `* PSpice netlist
.ALIASES
R_R1 R1(1=N001 2=OUT)
.ENDALIASES
.STMLIB "mylib.stl"
V_V1 N001 0 DC 10
R_R1 N001 OUT 2k
R_R2 OUT 0 {RVAL}
.PARAM RVAL=3k
E_E1 EO 0 VALUE {V(OUT)*2}
R_E EO 0 1k
.OP
.END`;
    const compat = pspiceCompat(src);
    expect(compat.changed).toEqual(['.ALIASES', '.STMLIB']);
    const { design } = roundTrip(compat.text, [{ type: 'op' }]);
    const refs = design.sheets[0].parts.map((p) => p.refdes);
    expect(refs).toContain('R1');
    expect(refs).toContain('V1');
    expect(design.variables.RVAL ?? design.variables.rval).toBe('3k');
  });

  it('a large ladder still routes without overlaps and simulates equally', () => {
    const lines = ['ladder', 'V1 n0 0 1'];
    for (let i = 0; i < 12; i++) {
      lines.push(`R${i + 1} n${i} n${i + 1} 1k`);
      lines.push(`C${i + 1} n${i + 1} 0 1n`);
    }
    lines.push('RL n12 0 10k', '.end');
    const { r } = roundTrip(lines.join('\n'), [{ type: 'op' }, { type: 'ac', sweep: 'dec', points: 5, fstart: 1e3, fstop: 1e7 }]);
    expect(r.stats.parts).toBe(26);
  });
});

describe('SPICE export of imported and hierarchical designs', () => {
  it('the exported netlist of an imported design (blocks, overrides, variables) simulates like the deck', () => {
    const text = `export
.param RV=2k
.subckt AMP in out
E1 out 0 in 0 2
.ends AMP
V1 a 0 SIN(0 1 1k)
X1 a b AMP
R1 b c {RV}
D1 c 0 DX
.model DX D(IS=1e-15 N=1.5)
.end`;
    const deck = parse(text);
    const design = spiceToSchematic(deck, { fileName: 'e.cir' }).design;
    const build = buildNetlist(design, { includeAnalysis: false });
    const exported = parse(writeSpice(build.netlist));
    for (const spec of [{ type: 'op' } as AnalysisSpec, { type: 'tran', tstep: 1e-5, tstop: 2e-3 } as AnalysisSpec]) {
      const want = values(deck, spec);
      const got = values(exported, spec);
      for (const node of ['v(a)', 'v(b)', 'v(c)']) {
        const w = want.get(node)!;
        const g = got.get(node)!;
        for (let i = 0; i < w.length; i += Math.max(1, Math.floor(w.length / 40))) expect(g[i]).toBeCloseTo(w[i], 6);
      }
    }
    expect(Object.keys(exported.subckts)).toContain('amp');
  });
});

describe('include resolution', () => {
  it('reads nested .include / .lib files and reports the missing ones', async () => {
    const asked: string[] = [];
    const files: Record<string, string> = {
      'models/top.lib': '.include diodes.inc\n.model QX NPN(BF=50)\n',
      'models/diodes.inc': '.model DX D(IS=1e-14)\n',
    };
    const deck = 'T\n.lib models/top.lib\n.include nothere.inc\nV1 a 0 1\nR1 a b 1k\nD1 b 0 DX\nQ1 a b 0 QX\n.op\n.end\n';
    const r = await resolveDeckIncludes(deck, async (p) => {
      asked.push(p);
      return files[p.split(String.fromCharCode(92)).join('/')] ?? null;
    });
    // the file that could not be found stays a parse error; everything else was read
    expect(r.result.errors.map((e) => e.message)).toEqual(["include file 'nothere.inc' not found"]);
    expect(Object.keys(r.result.netlist.models).sort()).toEqual(['dx', 'qx']);
    expect(r.missing).toEqual(['nothere.inc']);
    expect(asked).toContain('models/diodes.inc');
  });
});

describe('control cards carried into the schematic', () => {
  it('.ic, .nodeset, .func and .meas go to the custom SPICE text and work in the schematic', () => {
    const deck = parse(`* rc ic
.func half(x) {x/2}
V1 in 0 0
R1 in out 1k
C1 out 0 1u
B1 h 0 V={half(V(out))}
R2 h 0 1k
.ic V(out)=2
.nodeset V(in)=0
.tran 10u 3m uic
.meas TRAN v1ms FIND V(out) AT=1m
.meas TRAN hmax MAX V(h)
.end
`);
    const r = spiceToSchematic(deck, { fileName: 'ic.cir' });
    expect(r.notes.filter((n) => n.kind === 'unsupported')).toEqual([]);
    expect(r.notes.filter((n) => n.kind === 'carried').map((n) => (n as { what: string }).what)).toEqual(['.func half(x)', '.ic V(out)', '.nodeset V(in)', '.meas TRAN v1ms', '.meas TRAN hmax']);
    expect(r.design.customSpice).toMatch(/\.ic V\(out\)=2/);
    const design = parseDesign(serializeDesign(r.design));
    const build = buildNetlist(design);
    expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
    expect(build.netlist.ic).toEqual({ out: 2 });
    expect(build.netlist.nodeset).toEqual({ in: 0 });
    const [tr] = runAnalyses(build.netlist);
    expect(tr.error).toBeUndefined();
    // the capacitor discharges from 2 V through 1 kΩ (UIC): 2·e^{-1} at 1 ms; h = V(out)/2 has
    // its maximum at the first solved point (t = 1 µs; the UIC point itself sets only the capacitor)
    const m = new Map(tr.measurements!.map((x) => [x.name, x]));
    expect(m.get('v1ms')!.value).toBeCloseTo(2 * Math.exp(-1), 3);
    expect(m.get('hmax')!.value).toBeCloseTo(Math.exp(-m.get('hmax')!.at! / 1e-3), 5);
  });

  it('warns about an .ic of a net the schematic does not have; a .step param keeps the stepped analysis with a note', () => {
    const r = spiceToSchematic(parse('* s\n.param rv=1k\nV1 a 0 1\nR1 a 0 {rv}\n.op\n.step param rv list 1k 2k\n.ic V(nowhere)=1\n.end\n'), { fileName: 's.cir' });
    expect(r.notes).toContainEqual({ kind: 'unsupported', what: '.step param rv' });
    expect(r.design.analysis.active).toBe('op');
    const build = buildNetlist(r.design);
    expect(build.erc.find((m) => m.detail?.id === 'customIcUnknownNet')?.severity).toBe('warning');
  });
});
