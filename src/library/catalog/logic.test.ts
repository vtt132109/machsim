/**
 * Generated logic catalogue (74xx families and 4000B series): structure of every part, a truth
 * table or state sequence for every device type (table-driven, run through the real engine in the
 * first TTL and the first CMOS family the type exists in), propagation delay per family, and the
 * digital simulation settings (ideal / real mode, timing).
 *
 * Vector format: `in` / `out` list pin names; each row is the input levels then the expected
 * outputs (spaces are ignored): '0' / '1', 'z' = released (3-state), 'x' = not checked; a bidir
 * input may be '-' (not driven). Inputs change at the start of a row and outputs are sampled at
 * its end, so a clock edge is a row whose clock input goes from 0 to 1.
 */
import { describe, expect, it } from 'vitest';
import { getPart, defaultParams, listParts } from '../index';
import { asLibraryPart, elementName, internalNodeName, type ToSpiceContextExt } from '../partkit';
import { findVector, runAnalyses, type AnalysisResult } from '../../sim/index';
import { emptyNetlist, type ElementIR, type ModelCard, type Waveform } from '../../sim/netlist';
import { interpolate } from '../../sim/engine/testing';
import { validateParams } from '../../model/erc';
import { buildNetlist } from '../../model/netlister';
import { DesignBuilder } from '../../model/designkit';
import { parseUserNumber } from '../../util/units';
import { FAMILIES, CMOS74_FAMILIES, cmosLevels } from '../parts/digital/kit';
import type { DigitalSimSettings } from '../../model/types';
import { LOGIC74_SPECS } from './logic74';
import { LOGIC4000_SPECS } from './logic4000';
import { ALL_74, partIdOf, type LogicFamily, type LogicSpec } from './logicKit';
import { loadAllGroups } from '../index';

// the catalogue packs load on demand (src/library/index.ts): load them all so every part is covered
await loadAllGroups();

const SPECS = [...LOGIC74_SPECS, ...LOGIC4000_SPECS];

// ---------------------------------------------------------------------------------------------
// harness

interface Frag {
  elements: ElementIR[];
  models: ModelCard[];
}

function instantiate(partId: string, refdes: string, pins: Record<string, string>, params: Record<string, string> = {}, nets: Record<string, string> = {}, digital?: DigitalSimSettings): Frag {
  const part = getPart(partId);
  if (!part?.toSpice) throw new Error(`no part ${partId}`);
  const merged = { ...defaultParams(part), ...params };
  const shunts: ElementIR[] = [];
  const known = new Set(part.symbol.pins.map((p) => p.name));
  const ctx: ToSpiceContextExt = {
    refdes,
    params: merged,
    node: (pin) => {
      if (!known.has(pin)) throw new Error(`${partId} has no pin ${pin}`);
      if (pins[pin] !== undefined) return pins[pin];
      const nc = `NC_${refdes}_${pin}`;
      if (!shunts.some((e) => e.nodes[0] === nc)) shunts.push({ type: 'R', name: `R_${nc}`, nodes: [nc, '0'], value: 1e12, params: {} });
      return nc;
    },
    num: (key) => {
      const v = parseUserNumber(merged[key] ?? '');
      if (!Number.isFinite(v)) throw new Error(`bad value for ${key}`);
      return v;
    },
    name: (t, s) => elementName(t, refdes, s),
    internal: (s) => internalNodeName(refdes, s),
    connected: (pin) => pins[pin] !== undefined,
    resolveNet: (name) => nets[name.toLowerCase()],
    ...(digital ? { digital } : {}),
  };
  const frag = part.toSpice(ctx);
  return { elements: [...frag.elements, ...shunts], models: frag.models ?? [] };
}

function simulate(frags: Frag[], extra: ElementIR[], spec: Parameters<typeof runAnalyses>[0]['analyses'][number]): AnalysisResult {
  const n = emptyNetlist('logic');
  for (const f of frags) {
    n.elements.push(...f.elements);
    for (const m of f.models) n.models[m.name.toLowerCase()] = m;
  }
  n.elements.push(...extra);
  n.analyses = [spec];
  const r = runAnalyses(n)[0];
  expect(r.error, r.error).toBeUndefined();
  return r;
}

const vdc = (name: string, p: string, value: number): ElementIR => ({ type: 'V', name, nodes: [p, '0'], source: { dc: value }, params: {} });
const vwave = (name: string, p: string, dc: number, tran: Waveform): ElementIR => ({ type: 'V', name, nodes: [p, '0'], source: { dc, tran }, params: {} });
const res = (name: string, a: string, b: string, value: number): ElementIR => ({ type: 'R', name, nodes: [a, b], value, params: {} });
const vec = (r: AnalysisResult, name: string) => {
  const v = findVector(r, name);
  if (!v) throw new Error(`no vector ${name}`);
  return v.re;
};
const at = (r: AnalysisResult, name: string, t: number) => interpolate(r.scale!.re, vec(r, name), t);

interface Vectors {
  in: string;
  out: string;
  rows: string[];
  /** row duration (default 400 ns, 4000 series 4 µs) */
  T?: number;
  params?: Record<string, string>;
}

function levelsOf(fam: LogicFamily): { vol: number; voh: number } {
  return fam === '4000' ? cmosLevels(5) : FAMILIES[fam];
}

/** Run a vector table for one part; returns mismatch descriptions. */
function runVectors(spec: LogicSpec, fam: LogicFamily, v: Vectors): string[] {
  const id = partIdOf(spec, fam);
  const part = getPart(id)!;
  const ins = v.in.trim().split(/\s+/);
  const outs = v.out.trim().split(/\s+/);
  const rows = v.rows.map((r) => r.replace(/\s+/g, ''));
  for (const r of rows) if (r.length !== ins.length + outs.length) throw new Error(`${spec.pn}: row '${r}' has ${r.length} values, expected ${ins.length + outs.length}`);
  const T = v.T ?? (fam === '4000' ? 4e-6 : 400e-9);
  const { vol, voh } = levelsOf(fam);
  const mid = (vol + voh) / 2;
  const hi = fam === '4000' ? 5 : voh >= 4.9 ? 5 : 3.6;
  const pinType = new Map(part.symbol.pins.map((p) => [p.name, p.type ?? 'input']));
  const pins: Record<string, string> = {};
  const extra: ElementIR[] = [vdc('VMID', 'vmid', mid), vdc('VPU', 'vpu', 5)];
  const oc = spec.output === 'open-collector';
  ins.forEach((name, k) => {
    const node = `i_${name}`;
    const bidir = pinType.get(name) === 'bidir';
    const level = (c: string) => (c === '1' ? hi : c === '0' ? 0 : mid);
    const args: number[] = [0, level(rows[0][k])];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][k] === rows[i - 1][k]) continue;
      args.push(i * T, level(rows[i - 1][k]), i * T + 2e-9, level(rows[i][k]));
    }
    if (bidir) {
      pins[name] = `p_${name}`;
      extra.push(vwave(`V_${name}`, node, args[1], { type: 'PWL', args }), res(`RD_${name}`, node, `p_${name}`, 1e3));
    } else {
      pins[name] = node;
      extra.push(vwave(`V_${name}`, node, args[1], { type: 'PWL', args }));
    }
  });
  for (const name of outs) {
    if (pins[name]) continue;
    pins[name] = `o_${name}`;
    extra.push(oc ? res(`RP_${name}`, `o_${name}`, 'vpu', 2.2e3) : res(`RM_${name}`, `o_${name}`, 'vmid', 1e5));
  }
  // unlisted inputs are tied low
  for (const p of part.symbol.pins) if (!pins[p.name] && (p.type ?? 'input') === 'input') pins[p.name] = '0';
  const frag = instantiate(id, 'U1', pins, v.params ?? {});
  const r = simulate([frag], extra, { type: 'tran', tstep: T / 20, tstop: rows.length * T });
  const decode = (x: number): string => (oc ? (x > 2.5 ? '1' : x < 0.8 ? '0' : '?') : x > vol + 0.7 * (voh - vol) ? '1' : x < vol + 0.3 * (voh - vol) ? '0' : 'z');
  const bad: string[] = [];
  rows.forEach((row, i) => {
    const t = (i + 0.95) * T;
    outs.forEach((name, k) => {
      const want = row[ins.length + k];
      if (want === 'x') return;
      const got = decode(at(r, `V(${pins[name]})`, t));
      if (got !== want) bad.push(`${id} row ${i} (${row.slice(0, ins.length)}): ${name} = ${got}, expected ${want}`);
    });
  });
  return bad;
}

/** Families to run the vectors in: the first TTL-type and the first CMOS-type family. */
function testFamilies(spec: LogicSpec): LogicFamily[] {
  const ttl = spec.fams.find((f) => f !== '4000' && !CMOS74_FAMILIES.includes(f));
  const cmos = spec.fams.find((f) => f === '4000' || CMOS74_FAMILIES.includes(f));
  return [ttl, cmos].filter((f): f is LogicFamily => f !== undefined);
}

// ---------------------------------------------------------------------------------------------
// reference-generated tables

const bits = (w: number, n: number) => Array.from({ length: n }, (_, k) => (w >> k) & 1).join('');
const inv = (s: string) => [...s].map((c) => (c === '0' ? '1' : c === '1' ? '0' : c)).join('');

/** Gate function per gate type number (all sections tested with every input combination). */
const GATE_FN: Record<string, (x: number[]) => number> = {};
const nand = (x: number[]) => (x.every((b) => b) ? 0 : 1);
const and = (x: number[]) => (x.every((b) => b) ? 1 : 0);
const nor = (x: number[]) => (x.some((b) => b) ? 0 : 1);
const or = (x: number[]) => (x.some((b) => b) ? 1 : 0);
const xor = (x: number[]) => x.reduce((a, b) => a ^ b, 0);
const not = (x: number[]) => 1 - x[0];
const buf = (x: number[]) => x[0];
for (const pn of ['00', '01', '03', '10', '12', '13', '20', '22', '26', '30', '37', '38', '40', '132', '133', '4012', '4023']) GATE_FN[pn] = nand;
for (const pn of ['08', '09', '11', '15', '21', '4073', '4082']) GATE_FN[pn] = and;
for (const pn of ['02', '27', '28', '33', '4002', '4025']) GATE_FN[pn] = nor;
for (const pn of ['32', '4072', '4075']) GATE_FN[pn] = or;
for (const pn of ['86', '136', '4030']) GATE_FN[pn] = xor;
for (const pn of ['266', '4077']) GATE_FN[pn] = (x) => 1 - xor(x);
for (const pn of ['04', '05', '06', '14', '16', '19', '40106', '4584', '4049']) GATE_FN[pn] = not;
for (const pn of ['07', '17', '4050']) GATE_FN[pn] = buf;

/**
 * Driving pin types: round 4 gives the outputs of an open-collector / 3-state device the pin type
 * the ERC matrix needs ('open-collector' / 'tristate', src/library/catalog/logicKit.ts), so the
 * harness looks for any of them when it hunts for the gate outputs.
 */
const isOutputPin = (type: string | undefined): boolean => type === 'output' || type === 'tristate' || type === 'open-collector';

/** Truth table of a gate package: section k gets combination (row + k) so every section sees every combination. */
function gateVectors(spec: LogicSpec, fn: (x: number[]) => number): Vectors {
  const part = getPart(partIdOf(spec, spec.fams[0]))!;
  const outsNames = part.symbol.pins.filter((p) => isOutputPin(p.type)).map((p) => p.name);
  const sections = outsNames.map((o) => {
    const prefix = o.replace(/Y$/, '');
    const ins = part.symbol.pins.filter((p) => p.type === 'input' && (prefix ? p.name.startsWith(prefix) && /^[0-9]+[A-Z]$/.test(p.name) : true)).map((p) => p.name);
    return { ins, out: o };
  });
  const n = Math.max(...sections.map((s) => s.ins.length));
  const combos = n <= 4 ? Array.from({ length: 2 ** n }, (_, w) => w) : [0, 2 ** n - 1, 2 ** n - 2, 1, 2 ** (n - 1), 0x55 & (2 ** n - 1), 0xaa & (2 ** n - 1), 2 ** n - 1 - 2 ** (n - 1)];
  const rows = combos.map((_, ri) => {
    let inBits = '';
    let outBits = '';
    sections.forEach((s, k) => {
      const w = combos[(ri + k) % combos.length];
      const x = s.ins.map((_, i) => (w >> i) & 1);
      inBits += x.join('');
      outBits += String(fn(x));
    });
    return `${inBits} ${outBits}`;
  });
  return { in: sections.flatMap((s) => s.ins).join(' '), out: sections.map((s) => s.out).join(' '), rows };
}

function decoderRows(nAddr: number, nOut: number, activeLow: boolean, enables: string[], codes: number[] = Array.from({ length: 2 ** nAddr }, (_, k) => k)): string[] {
  const rows: string[] = [];
  for (const c of codes) {
    const o = Array.from({ length: nOut }, (_, k) => (k === c ? '1' : '0')).join('');
    rows.push(`${bits(c, nAddr)} ${enables[0]} ${activeLow ? inv(o) : o}`);
  }
  for (const e of enables.slice(1)) rows.push(`${bits(1, nAddr)} ${e} ${(activeLow ? '1' : '0').repeat(nOut)}`);
  return rows;
}

// ---------------------------------------------------------------------------------------------
// hand-written tables (sequential parts) and generated ones (combinational MSI)

const V: Record<string, Vectors> = {
  // buffers
  '125': { in: '1A 1G 2A 2G', out: '1Y 2Y', rows: ['10 00 1 0', '00 11 0 z', '11 11 z z', '01 10 z 1'] },
  '126': { in: '1A 1G 2A 2G', out: '1Y 2Y', rows: ['11 01 1 0', '01 11 0 1', '10 10 z z'] },
  '365': { in: 'G1 G2 1A 2A 6A', out: '1Y 2Y 6Y', rows: ['00 101 101', '01 101 zzz', '10 010 zzz', '00 010 010'] },
  '366': { in: 'G1 G2 1A 2A 6A', out: '1Y 2Y 6Y', rows: ['00 101 010', '11 101 zzz'] },
  '367': { in: '1G 1A1 1A4 2G 2A1 2A2', out: '1Y1 1Y4 2Y1 2Y2', rows: ['0 10 0 01 1001', '1 10 0 01 zz01', '0 01 1 11 01zz'] },
  '368': { in: '1G 1A1 1A4 2G 2A1 2A2', out: '1Y1 1Y4 2Y1 2Y2', rows: ['0 10 0 01 0110', '1 10 0 01 zz10'] },
  '240': { in: '1G 1A1 1A4 2G 2A1 2A4', out: '1Y1 1Y4 2Y1 2Y4', rows: ['0 10 0 01 0110', '1 10 0 01 zz10', '0 01 1 01 10zz'] },
  '241': { in: '1G 1A1 1A4 2G 2A1 2A4', out: '1Y1 1Y4 2Y1 2Y4', rows: ['0 10 1 01 1001', '1 10 0 01 zzzz', '0 01 0 01 01zz'] },
  '244': { in: '1G 1A1 1A4 2G 2A1 2A4', out: '1Y1 1Y4 2Y1 2Y4', rows: ['0 10 0 01 1001', '1 10 0 01 zz01', '0 01 1 01 01zz'] },
  '540': { in: 'G1 G2 A1 A8', out: 'Y1 Y8', rows: ['00 10 01', '10 10 zz', '01 01 zz', '00 01 10'] },
  '541': { in: 'G1 G2 A1 A8', out: 'Y1 Y8', rows: ['00 10 10', '10 10 zz', '00 01 01'] },
  '245': { in: 'DIR G A1 A8 B1 B8', out: 'A1 A8 B1 B8', rows: ['10 10-- 1010', '10 01-- 0101', '00 --10 1010', '00 --01 0101', '11 ---- zzzz'] },
  '640': { in: 'DIR G A1 A8 B1 B8', out: 'A1 A8 B1 B8', rows: ['10 10-- 1001', '00 --10 0110', '11 ---- zzzz'] },
  '242': { in: 'GAB GBA A1 A4 B1 B4', out: 'A1 A4 B1 B4', rows: ['00 10-- 1001', '11 --10 0110', '10 ---- zzzz'] },
  '243': { in: 'GAB GBA A1 A4 B1 B4', out: 'A1 A4 B1 B4', rows: ['00 10-- 1010', '11 --10 1010', '10 ---- zzzz'] },
  // flip-flops: initial state Q = 0
  '74': { in: '1D 1CLK 1PRE 1CLR', out: '1Q 1QN', rows: ['0011 01', '1011 01', '1111 10', '0111 10', '0011 10', '0111 01', '0101 10', '0111 10', '0110 01', '0100 11'] },
  '73': { in: '1J 1K 1CLK 1CLR', out: '1Q 1QN', rows: ['1011 01', '1001 10', '0111 10', '0101 01', '1111 01', '1101 10', '1111 10', '1101 01', '1010 01'] },
  '76': { in: '1J 1K 1CLK 1PRE 1CLR', out: '1Q 1QN', rows: ['00011 01', '10111 01', '10011 10', '11111 10', '11011 01', '01111 01', '00101 10', '00110 01'] },
  '107': { in: '1J 1K 1CLK 1CLR', out: '1Q 1QN', rows: ['1011 01', '1001 10', '1111 10', '1101 01', '0110 01'] },
  '109': { in: '1J 1K 1CLK 1PRE 1CLR', out: '1Q 1QN', rows: ['11011 01', '11111 10', '00011 10', '00111 01', '10011 01', '10111 10', '10011 10', '10111 01', '01011 01', '01111 01', '00001 10'] },
  '112': { in: '1J 1K 1CLK 1PRE 1CLR', out: '1Q 1QN', rows: ['10111 01', '10011 10', '01111 10', '01011 01', '11111 01', '11011 10', '00110 01', '00101 10'] },
  '113': { in: '1J 1K 1CLK 1PRE', out: '1Q 1QN', rows: ['1011 01', '1001 10', '0111 10', '0101 01', '0010 10'] },
  '114': { in: '1J 1K CLK 1PRE CLR 2J 2K 2PRE', out: '1Q 2Q', rows: ['10111 101 00', '10011 101 11', '01111 011 11', '01011 011 00', '00101 001 10', '00110 001 00'] },
  '174': { in: '1D 6D CLK CLR', out: '1Q 6Q', rows: ['10 01 00', '10 11 10', '01 01 10', '01 11 01', '11 10 00'] },
  '175': { in: '1D 4D CLK CLR', out: '1Q 4Q 1QN 4QN', rows: ['10 01 0011', '10 11 1001', '11 10 0011'] },
  '378': { in: '1D 6D CLK G', out: '1Q 6Q', rows: ['10 00 00', '10 10 10', '01 00 10', '01 11 10', '01 01 10', '01 00 10', '01 10 01'] },
  '173': { in: '1D 4D CLK G1 G2 M N CLR', out: '1Q 4Q', rows: ['10 0 00 00 0 00', '10 1 00 00 0 10', '01 0 10 00 0 10', '01 1 10 00 0 10', '01 0 00 10 0 zz', '01 0 00 00 1 00'] },
  '273': { in: 'D1 D8 CLK CLR', out: 'Q1 Q8', rows: ['10 01 00', '10 11 10', '01 01 10', '01 11 01', '11 10 00'] },
  '374': { in: 'D1 D8 CLK OE', out: 'Q1 Q8', rows: ['10 00 00', '10 10 10', '01 01 zz', '01 11 zz', '01 00 01'] },
  '377': { in: 'D1 D8 CLK EN', out: 'Q1 Q8', rows: ['10 00 00', '10 10 10', '01 01 10', '01 11 10', '01 00 10', '01 10 01'] },
  '373': { in: 'D1 D8 LE OE', out: 'Q1 Q8', rows: ['10 10 10', '01 10 01', '01 00 01', '10 00 01', '11 01 zz', '11 10 11'] },
  '534': { in: 'D1 D8 CLK OE', out: 'Q1 Q8', rows: ['10 00 11', '10 10 01', '10 01 zz'] },
  '259': { in: 'S0 S1 S2 D G CLR', out: 'Q0 Q1 Q5 Q7', rows: ['000 1 0 1 1000', '100 1 1 1 1000', '100 1 0 1 1100', '101 1 1 1 1100', '101 1 0 1 1110', '000 0 1 1 1110', '000 0 0 1 0110', '111 1 1 1 0110', '111 1 0 1 0111', '000 1 1 0 0000', '101 1 0 0 0010'] },
  '279': { in: '1S1 1S2 1R 2S 2R', out: '1Q 2Q', rows: ['11 1 1 1 00', '01 1 0 1 11', '11 1 1 1 11', '11 0 1 0 00', '10 0 0 0 11'] },
  // counters (initial count 0)
  '90': { in: 'CKA CKB R01 R02 R91 R92', out: 'QA QB QC QD', rows: ['1 1 0000 0000', '0 1 0000 1000', '1 0 0000 1100', '0 1 0000 0100', '1 0 0000 0010', '1 1 1100 0000', '1 1 0011 1001'] },
  '92': { in: 'CKA CKB R01 R02', out: 'QA QB QC QD', rows: ['11 00 0000', '10 00 0100', '11 00 0100', '10 00 0010', '11 00 0010', '10 00 0001', '11 00 0001', '10 00 0101', '11 11 0000'] },
  '93': { in: 'CKA CKB R01 R02', out: 'QA QB QC QD', rows: ['11 00 0000', '01 00 1000', '00 00 1100', '10 00 1100', '11 00 1100', '01 00 0100', '11 11 0000'] },
  '193': { in: 'UP DOWN CLR LOAD A B C D', out: 'QA QB QC QD CO BO', rows: ['11 0 1 0000 0000 11', '01 0 1 0000 0000 11', '11 0 1 0000 1000 11', '01 0 1 0000 1000 11', '11 0 1 0000 0100 11', '10 0 1 0000 0100 11', '11 0 1 0000 1000 11', '10 0 1 0000 1000 11', '11 0 1 0000 0000 11', '10 0 1 0000 0000 10', '11 0 0 1111 1111 11', '01 0 1 1111 1111 01', '11 0 1 1111 0000 11', '11 1 1 0000 0000 11'] },
  '192': { in: 'UP DOWN CLR LOAD A B C D', out: 'QA QB QC QD CO BO', rows: ['11 0 0 1001 1001 11', '01 0 1 1001 1001 01', '11 0 1 1001 0000 11', '10 0 1 1001 0000 10', '11 0 1 1001 1001 11'] },
  '390': { in: '1CKA 1CKB 1CLR', out: '1QA 1QB 1QC 1QD', rows: ['11 0 0000', '01 0 1000', '10 0 1100', '01 0 0100', '11 1 0000'] },
  '393': { in: '1A 1CLR', out: '1QA 1QB 1QC 1QD', rows: ['1 0 0000', '0 0 1000', '1 0 1000', '0 0 0100', '1 0 0100', '0 0 1100', '0 1 0000'] },
  '168': { in: 'CLK UD LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 00 1001 0000 1', '1 1 0 00 1001 1001 0', '0 1 1 00 0000 1001 0', '1 1 1 00 0000 0000 1', '0 0 1 00 0000 0000 0', '1 0 1 00 0000 1001 1', '0 0 1 11 0000 1001 1', '1 0 1 11 0000 1001 1'] },
  '169': { in: 'CLK UD LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 00 1111 0000 1', '1 1 0 00 1111 1111 0', '0 1 1 00 0000 1111 0', '1 1 1 00 0000 0000 1', '0 0 1 00 0000 0000 0', '1 0 1 00 0000 1111 1', '0 0 1 10 0000 1111 1', '1 0 1 10 0000 1111 1'] },
  '191': { in: 'CLK CTEN DU LOAD A B C D', out: 'QA QB QC QD MAXMIN RCO', rows: ['0 0 0 0 0111 0111 0 1', '0 0 0 1 0000 0111 0 1', '1 0 0 1 0000 1111 1 1', '0 0 0 1 0000 1111 1 0', '1 0 0 1 0000 0000 0 1', '0 0 1 1 0000 0000 1 0', '1 0 1 1 0000 1111 0 1', '0 1 1 1 0000 1111 0 1', '1 1 1 1 0000 1111 0 1'] },
  '190': { in: 'CLK CTEN DU LOAD A B C D', out: 'QA QB QC QD MAXMIN RCO', rows: ['0 0 0 0 0001 0001 0 1', '0 0 0 1 0000 0001 0 1', '1 0 0 1 0000 1001 1 1', '0 0 0 1 0000 1001 1 0', '1 0 0 1 0000 0000 0 1', '0 0 1 1 0000 0000 1 0', '1 0 1 1 0000 1001 0 1'] },
  '164': { in: 'A B CLK CLR', out: 'QA QB QC QH', rows: ['11 0 1 0000', '11 1 1 1000', '00 0 1 1000', '01 1 1 0100', '11 0 1 0100', '11 1 1 1010', '11 0 0 0000'] },
  '165': { in: 'SHLD CLK INH SER A B C D E F G H', out: 'QH QHN', rows: ['0 0 0 0 00000001 10', '1 0 0 0 00000000 10', '1 1 0 0 00000000 01', '0 0 0 1 10000000 01', '1 0 0 1 00000000 01', '1 1 0 1 00000000 01', '1 0 0 1 00000000 01', '1 0 1 1 00000000 01'] },
  '166': { in: 'SHLD CLK INH SER CLR A B C D E F G H', out: 'QH', rows: ['0 0 0 0 1 00000001 0', '0 1 0 0 1 00000001 1', '1 0 0 1 1 00000000 1', '1 1 0 1 1 00000000 0', '1 0 0 1 0 00000000 0'] },
  '194': { in: 'S0 S1 SR SL CLR CLK A B C D', out: 'QA QB QC QD', rows: ['11 00 1 0 1010 0000', '11 00 1 1 1010 1010', '10 10 1 0 0000 1010', '10 10 1 1 0000 1101', '01 01 1 0 0000 1101', '01 01 1 1 0000 1011', '00 00 1 0 0000 1011', '00 00 1 1 0000 1011', '00 00 0 1 0000 0000'] },
  '195': { in: 'J K SHLD CLK CLR A B C D', out: 'QA QB QC QD QDN', rows: ['00 0 0 1 1101 0000 1', '00 0 1 1 1101 1101 0', '11 1 0 1 0000 1101 0', '11 1 1 1 0000 1110 1', '00 1 0 1 0000 1110 1', '00 1 1 1 0000 0111 0', '10 1 0 1 0000 0111 0', '10 1 1 1 0000 1011 0', '00 1 0 0 0000 0000 1'] },
  '595': { in: 'SER SRCLK SRCLR RCLK OE', out: 'QA QB QH QH2', rows: ['1 0 1 0 0 0000', '1 1 1 0 0 0000', '0 0 1 0 0 0000', '0 1 1 0 0 0000', '0 0 1 1 0 0100', '0 0 1 1 1 zzz0', '0 0 0 0 0 0100', '0 0 0 1 0 0000'] },
  // decoders
  '42': { in: 'A B C D', out: 'Y0 Y1 Y2 Y3 Y4 Y5 Y6 Y7 Y8 Y9', rows: Array.from({ length: 12 }, (_, c) => `${bits(c, 4)} ${inv(Array.from({ length: 10 }, (_, k) => (k === c ? '1' : '0')).join(''))}`) },
  '138': { in: 'A B C G1 G2A G2B', out: 'Y0 Y1 Y2 Y3 Y4 Y5 Y6 Y7', rows: decoderRows(3, 8, true, ['100', '000', '110', '101']) },
  '139': { in: '1A 1B 1G 2A 2B 2G', out: '1Y0 1Y1 1Y2 1Y3 2Y0 2Y1 2Y2 2Y3', rows: ['000 110 0111 1110', '100 010 1011 1101', '010 101 1101 1111', '111 000 1111 0111'] },
  '154': { in: 'A B C D G1 G2', out: 'Y0 Y5 Y10 Y15', rows: ['0000 00 0111', '1010 00 1011', '0101 00 1101', '1111 00 1110', '1111 10 1111'] },
  '155': { in: 'A B 1C 1G 2C 2G', out: '1Y0 1Y1 1Y2 1Y3 2Y0 2Y1 2Y2 2Y3', rows: ['00 10 00 0111 0111', '10 10 10 1011 1111', '11 00 01 1111 1111', '01 11 00 1111 1101'] },
  '147': { in: 'I1 I2 I3 I4 I5 I6 I7 I8 I9', out: 'A B C D', rows: ['111111111 1111', '011111111 0111', '101111111 1011', '001111110 0110', '111011111 1101', '000000011 0001', '111111101 1110'] },
  '148': { in: 'I0 I1 I2 I3 I4 I5 I6 I7 EI', out: 'A0 A1 A2 GS EO', rows: ['11111111 1 11111', '11111111 0 11110', '01111111 0 11101', '10111111 0 01101', '11111110 0 00001', '00000001 0 10001', '00000000 1 11111'] },
  // multiplexers
  '151': { in: 'A B C G D0 D1 D2 D3 D4 D5 D6 D7', out: 'Y W', rows: ['000 0 10101010 10', '100 0 10101010 01', '011 0 10101010 10', '111 0 01010101 10', '111 1 01010101 01'] },
  '251': { in: 'A B C G D0 D1 D2 D3 D4 D5 D6 D7', out: 'Y W', rows: ['000 0 10101010 10', '100 0 10101010 01', '111 1 01010101 zz'] },
  '150': { in: 'A B C D G E0 E5 E15', out: 'W', rows: ['0000 0 100 0', '1010 0 010 0', '1111 0 001 0', '1111 0 110 1', '1111 1 001 1'] },
  '153': { in: 'A B 1G 1C0 1C1 1C2 1C3 2G 2C0 2C1 2C2 2C3', out: '1Y 2Y', rows: ['00 0 1000 0 0111 10', '10 0 0100 0 1011 10', '01 0 0010 1 1101 10', '11 1 0001 0 1110 00'] },
  '253': { in: 'A B 1G 1C0 1C1 1C2 1C3 2G 2C0 2C1 2C2 2C3', out: '1Y 2Y', rows: ['00 0 1000 0 0111 10', '11 1 0001 0 1110 z0'] },
  '157': { in: 'S G 1A 1B 4A 4B', out: '1Y 4Y', rows: ['00 10 01 10', '10 10 01 01', '11 11 11 00'] },
  '158': { in: 'S G 1A 1B 4A 4B', out: '1Y 4Y', rows: ['00 10 01 01', '10 10 01 10', '11 00 00 11'] },
  '257': { in: 'S G 1A 1B 4A 4B', out: '1Y 4Y', rows: ['00 10 01 10', '10 10 01 01', '11 11 11 zz'] },
  '258': { in: 'S G 1A 1B 4A 4B', out: '1Y 4Y', rows: ['00 10 01 01', '10 10 01 10', '11 00 00 zz'] },
  // arithmetic
  '83': { in: 'A1 A2 A3 A4 B1 B2 B3 B4 C0', out: 'S1 S2 S3 S4 C4', rows: ['1010 0110 0 11010', '1111 1000 0 00001', '1111 1111 1 11111', '0000 0000 1 10000'] },
  '85': { in: 'A0 A1 A2 A3 B0 B1 B2 B3 IGT IEQ ILT', out: 'OGT OEQ OLT', rows: ['1010 0010 010 100', '0010 1010 010 001', '1100 1100 010 010', '1100 1100 100 100', '1100 1100 001 001'] },
  '181': {
    in: 'A0 A1 A2 A3 B0 B1 B2 B3 S0 S1 S2 S3 M CN',
    out: 'F0 F1 F2 F3 CN4 AEQB',
    rows: [
      // S = 1001, M = 0: A plus B (5 + 3 = 8), no carry in
      '1010 1100 1001 0 1 0001 1 0',
      // with carry in (Cn low): 5 + 3 + 1 = 9
      '1010 1100 1001 0 0 1001 1 0',
      // carry out: 9 + 9 = 18 -> 2, Cn+4 low
      '1001 1001 1001 0 1 0100 0 0',
      // S = 0110, M = 0, Cn = 1: A minus B minus 1, equal operands give 1111 and A=B
      '1010 1010 0110 0 1 1111 x z',
      // logic: S = 0110 XOR, S = 1011 AND, S = 1110 OR
      '1100 1010 0110 1 1 0110 x 0',
      '1100 1010 1101 1 1 1000 x 0',
      '1100 1010 0111 1 1 1110 x 0',
    ],
  },
  '182': { in: 'CN G0 P0 G1 P1 G2 P2 G3 P3', out: 'CNX CNY CNZ G P', rows: ['1 10 10 10 10 111 10', '1 11 11 11 11 000 11', '0 01 10 11 11 110 11', '0 11 11 11 01 000 01', '1 00 00 00 00 111 00'] },
  '280': { in: 'A B C D E F G H I', out: 'EVEN ODD', rows: ['000000000 10', '100000000 01', '110000000 10', '111111111 01', '101010100 10'] },
  '180': { in: 'A B C D E F G H EVENIN ODDIN', out: 'EVEN ODD', rows: ['00000000 10 10', '10000000 10 01', '10000000 01 10', '11000000 01 01', '11000000 11 00', '11000000 00 11'] },
  '688': { in: 'P0 P1 P7 Q0 Q1 Q7 G', out: 'PEQ', rows: ['101 101 0 0', '101 100 0 1', '101 101 1 1', '000 000 0 0'] },
  '682': { in: 'P0 P1 P7 Q0 Q1 Q7', out: 'PEQ PGT', rows: ['101 101 01', '101 001 10', '100 101 11', '000 000 01'] },
  // 4000 series
  '4042': { in: 'D1 D4 CLK POL', out: 'Q1 Q4 Q1N', rows: ['10 1 1 100', '01 1 1 011', '01 0 1 011', '10 0 1 011', '10 0 0 100', '10 1 0 100', '01 1 0 100'] },
  '4099': { in: 'A0 A1 A2 DATA WD RESET', out: 'Q0 Q1 Q7', rows: ['000 1 0 0 100', '100 1 1 0 100', '100 1 0 0 110', '111 1 1 0 110', '111 1 0 0 111', '000 0 1 1 000', '100 1 0 1 010'] },
  '4076': { in: 'D1 D4 CLK G1 G2 M N RESET', out: 'Q1 Q4', rows: ['10 0 00 00 0 00', '10 1 00 00 0 10', '01 0 01 00 0 10', '01 1 01 00 0 10', '01 0 00 01 0 zz', '01 0 00 00 1 00'] },
  '40174': { in: '1D 6D CLK CLR', out: '1Q 6Q', rows: ['10 01 00', '10 11 10', '01 10 00'] },
  '40175': { in: '1D 4D CLK CLR', out: '1Q 4Q 1QN', rows: ['10 01 001', '10 11 100', '11 10 001'] },
  '4020': { in: 'CLK RST', out: 'Q1 Q4', rows: ['10 00', '00 10', '10 10', '00 00', '10 00', '00 10', '01 00'] },
  '4024': { in: 'CLK RST', out: 'Q1 Q2 Q3', rows: ['10 000', '00 100', '10 100', '00 010', '10 010', '00 110', '01 000'] },
  '4040': { in: 'CLK RST', out: 'Q1 Q2 Q12', rows: ['10 000', '00 100', '10 100', '00 010', '01 000'] },
  '4017': { in: 'CLK INH RST', out: 'Q0 Q1 Q2 Q9 CO', rows: ['000 10001', '100 01001', '000 01001', '100 00101', '110 00101', '010 00101', '001 10001'] },
  '4022': { in: 'CLK INH RST', out: 'Q0 Q1 Q7 CO', rows: ['000 1001', '100 0101', '000 0101', '001 1001'] },
  '4026': { in: 'CLK INH RST DEI', out: 'SEGA SEGB SEGC SEGG CO DEO UC', rows: ['0001 1110 111', '1001 0110 111', '0001 0110 111', '1001 1101 110', '0000 0000 100', '1101 1101 110', '0011 1110 111'] },
  '4029': { in: 'CLK PE CI UD BD J1 J2 J3 J4', out: 'Q1 Q2 Q3 Q4 CO', rows: ['0 1 0 1 0 1001 1001 0', '0 0 0 1 0 0000 1001 0', '1 0 0 1 0 0000 0000 1', '0 0 0 0 1 0000 0000 0', '1 0 0 0 1 0000 1111 1', '0 0 1 0 1 0000 1111 1', '1 0 1 0 1 0000 1111 1'] },
  '4510': { in: 'CLK PE CI UD RESET P1 P2 P3 P4', out: 'Q1 Q2 Q3 Q4 CO', rows: ['0 1 0 1 0 1001 1001 0', '0 0 0 1 0 0000 1001 0', '1 0 0 1 0 0000 0000 1', '0 0 0 0 0 0000 0000 0', '1 0 0 0 0 0000 1001 1', '0 0 0 0 1 0000 0000 0'] },
  '4516': { in: 'CLK PE CI UD RESET P1 P2 P3 P4', out: 'Q1 Q2 Q3 Q4 CO', rows: ['0 1 0 1 0 1111 1111 0', '0 0 0 1 0 0000 1111 0', '1 0 0 1 0 0000 0000 1', '0 0 0 0 0 0000 0000 0', '1 0 0 0 0 0000 1111 1'] },
  '4518': { in: '1CLK 1EN 1RESET', out: '1Q1 1Q2 1Q3 1Q4', rows: ['010 0000', '110 1000', '010 1000', '110 0100', '100 0100', '000 0100', '010 0100', '000 1100', '011 0000'] },
  '4520': { in: '1CLK 1EN 1RESET', out: '1Q1 1Q2 1Q3 1Q4', rows: ['010 0000', '110 1000', '010 1000', '000 0100', '100 0100', '001 0000'] },
  '40161': { in: 'CLK CLR LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 11 1111 0000 0', '1 1 0 11 1111 1111 1', '0 1 1 11 0000 1111 1', '1 1 1 11 0000 0000 0', '0 0 1 11 0000 0000 0'] },
  '40163': { in: 'CLK CLR LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 11 0111 0000 0', '1 1 0 11 0111 0111 0', '0 0 1 11 0000 0111 0', '1 0 1 11 0000 0000 0'] },
  '40193': { in: 'UP DOWN CLR LOAD A B C D', out: 'QA QB QC QD CO BO', rows: ['11 0 1 0000 0000 11', '01 0 1 0000 0000 11', '11 0 1 0000 1000 11', '11 1 1 0000 0000 11'] },
  '40192': { in: 'UP DOWN CLR LOAD A B C D', out: 'QA QB QC QD CO BO', rows: ['11 0 0 1001 1001 11', '01 0 1 1001 1001 01', '11 0 1 1001 0000 11'] },
  '4014': { in: 'SER CLK PS P1 P6 P7 P8', out: 'Q6 Q7 Q8', rows: ['0 0 1 0101 000', '0 1 1 0101 101', '0 0 0 0000 101', '1 1 0 0000 010', '1 0 0 0000 010', '1 1 0 0000 001'] },
  '4021': { in: 'SER CLK PS P1 P6 P7 P8', out: 'Q6 Q7 Q8', rows: ['0 0 1 0101 101', '0 0 0 0000 101', '1 1 0 0000 010', '1 0 0 0000 010', '1 1 0 0000 001'] },
  '4015': { in: '1D 1CLK 1RESET', out: '1Q1 1Q2 1Q4', rows: ['100 000', '110 100', '000 100', '010 010', '001 000'] },
  '4094': { in: 'DATA CLK STROBE OE', out: 'Q1 Q2 Q8 QS QS2', rows: ['1001 000 00', '1101 000 00', '0001 000 00', '0101 000 00', '0011 010 00', '0010 zzz 00', '0001 010 00'] },
  '4028': { in: 'A B C D', out: 'Q0 Q1 Q2 Q3 Q4 Q5 Q6 Q7 Q8 Q9', rows: Array.from({ length: 12 }, (_, c) => `${bits(c, 4)} ${Array.from({ length: 10 }, (_, k) => (k === c ? '1' : '0')).join('')}`) },
  '4514': { in: 'A B C D INHIBIT STROBE', out: 'S0 S5 S10 S15', rows: ['0000 01 1000', '1010 01 0100', '1010 00 0100', '0101 00 0100', '0101 01 0010', '1111 01 0001', '1111 11 0000'] },
  '4515': { in: 'A B C D INHIBIT STROBE', out: 'S0 S5 S10 S15', rows: ['0000 01 0111', '1010 01 1011', '1111 11 1111'] },
  '4555': { in: '1A 1B 1E', out: '1Q0 1Q1 1Q2 1Q3', rows: ['000 1000', '100 0100', '010 0010', '110 0001', '111 0000'] },
  '4556': { in: '1A 1B 1E', out: '1Q0 1Q1 1Q2 1Q3', rows: ['000 0111', '110 1110', '111 1111'] },
  '4511': { in: 'A B C D LT BL LE', out: 'SEGA SEGB SEGC SEGD SEGE SEGF SEGG', rows: ['0000 110 1111110', '1000 110 0110000', '1001 110 1110011', '0101 110 0000000', '0000 010 1111111', '0000 100 0000000', '0000 111 1111110', '1000 111 1111110'] },
  '4543': { in: 'A B C D LD BI PH', out: 'SEGA SEGB SEGC SEGD SEGE SEGF SEGG', rows: ['0000 100 1111110', '1000 100 0110000', '1000 101 1001111', '1000 110 0000000', '1000 000 0110000', '0000 000 0110000'] },
  '4532': { in: 'D0 D1 D2 D3 D4 D5 D6 D7 EI', out: 'Q0 Q1 Q2 GS EO', rows: ['00000000 1 00001', '10000000 1 00010', '01000100 1 10110', '11111111 1 11110', '11111111 0 00000'] },
  '4512': { in: 'A B C INHIBIT DIS X0 X1 X5 X7', out: 'Z', rows: ['000 00 1000 1', '100 00 0100 1', '101 00 0010 1', '111 00 0001 1', '111 10 0001 0', '111 01 0001 z'] },
  '4008': { in: 'A1 A2 A3 A4 B1 B2 B3 B4 CIN', out: 'S1 S2 S3 S4 COUT', rows: ['1010 0110 0 11010', '1111 1111 1 11111'] },
  '4063': { in: 'A0 A1 A2 A3 B0 B1 B2 B3 IGT IEQ ILT', out: 'OGT OEQ OLT', rows: ['1010 0010 010 100', '0010 1010 010 001', '1100 1100 010 010'] },
  '4585': { in: 'A0 A1 A2 A3 B0 B1 B2 B3 IGT IEQ ILT', out: 'OGT OEQ OLT', rows: ['1010 0010 010 100', '1100 1100 010 010'] },
};
V['160'] = { in: 'CLK CLR LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 11 1001 0000 0', '1 1 0 11 1001 1001 1', '0 1 1 11 0000 1001 1', '1 1 1 11 0000 0000 0', '0 1 1 01 0000 0000 0', '1 1 1 01 0000 0000 0', '0 1 1 11 0000 0000 0', '1 1 1 11 0000 1000 0', '0 0 1 11 0000 0000 0'] };
V['161'] = { in: 'CLK CLR LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 11 1111 0000 0', '1 1 0 11 1111 1111 1', '0 1 1 11 0000 1111 1', '1 1 1 11 0000 0000 0', '0 1 1 10 0000 0000 0', '1 1 1 10 0000 0000 0', '0 1 1 11 0000 0000 0', '1 1 1 11 0000 1000 0', '0 0 1 11 0000 0000 0'] };
V['162'] = { in: 'CLK CLR LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 11 1001 0000 0', '1 1 0 11 1001 1001 1', '0 0 1 11 0000 1001 1', '1 0 1 11 0000 0000 0'] };
V['163'] = { in: 'CLK CLR LOAD ENP ENT A B C D', out: 'QA QB QC QD RCO', rows: ['0 1 0 11 0111 0000 0', '1 1 0 11 0111 0111 0', '0 1 1 11 0000 0111 0', '1 1 1 11 0000 1111 1', '0 0 1 11 0000 1111 1', '1 0 1 11 0000 0000 0'] };
V['283'] = V['83'];
V['46'] = { in: 'A B C D LT RBI BIRBO', out: 'SEGA SEGB SEGC SEGD SEGE SEGF SEGG', rows: ['0000 11- 0000001', '1000 11- 1001111', '0110 11- 1100000', '1001 11- 0001100', '1100 01- 0000000', '0000 10- 1111111', '1000 110 1111111'] };
V['47'] = V['46'];
V['247'] = { in: 'A B C D LT RBI BIRBO', out: 'SEGA SEGB SEGC SEGD SEGE SEGF SEGG', rows: ['0110 11- 0100000', '1001 11- 0000100', '1000 11- 1001111'] };
V['48'] = { in: 'A B C D LT RBI BIRBO', out: 'SEGA SEGB SEGC SEGD SEGE SEGF SEGG', rows: ['0000 11- 1111110', '1000 11- 0110000', '0110 11- 0011111', '0000 10- 0000000'] };
V['248'] = { in: 'A B C D LT RBI BIRBO', out: 'SEGA SEGB SEGC SEGD SEGE SEGF SEGG', rows: ['0110 11- 1011111', '1001 11- 1111011'] };
V['145'] = V['42'];
V['156'] = V['155'];
V['573'] = V['373'];
V['574'] = V['374'];
V['375'] = { in: '1D 2D C12 3D C34', out: '1Q 1QN 2Q 3Q 3QN', rows: ['10 1 1 1 10010', '10 0 1 1 10010', '01 0 0 1 10001', '01 1 0 0 01101'] };
V['75'] = V['375'];

// pins of the 7447 family whose bidir BI/RBO is undriven ('-') also count as outputs: not listed

describe('logic catalogue structure', () => {
  const logic = listParts().filter((p) => /^74|^4\d{3}/.test(asLibraryPart(p).series ?? ''));

  it('has the common 74xx and 4000 device types in every family', () => {
    expect(SPECS.length).toBeGreaterThanOrEqual(190);
    expect(logic.length).toBeGreaterThanOrEqual(740);
    for (const fam of ALL_74) expect(logic.filter((p) => p.family === `74${fam}`).length, fam).toBeGreaterThanOrEqual(fam === 'AS' ? 25 : 30);
    for (const id of ['ttl/74ls00', 'ttl/74std00', 'ttl/74f181', 'ttl/74as161', 'cmos/74hc595', 'cmos/74hct245', 'cmos/74ac574', 'cmos/74act138', 'cmos/4046', 'cmos/74hc4051', 'cmos/4029', 'cmos/40106']) expect(getPart(id), id).toBeDefined();
    expect(getPart('ttl/74std00')!.name).toBe('7400');
    expect(getPart('cmos/74hc4040')!.group).toBe('cmos');
    expect(new Set(SPECS.map((s) => s.pn)).size).toBe(SPECS.length);
  });

  it('every part: grid-aligned pins, unique names and DIP numbers, hidden power pins not reused, valid defaults', () => {
    const bad: string[] = [];
    for (const p of logic) {
      const names = p.symbol.pins.map((q) => q.name.toLowerCase());
      if (new Set(names).size !== names.length) bad.push(`${p.id}: duplicate pin names`);
      const nums = p.symbol.pins.map((q) => q.number).filter((n): n is string => !!n);
      if (new Set(nums).size !== nums.length) bad.push(`${p.id}: duplicate pin numbers ${nums.sort().join(',')}`);
      const pkg = Number((p.footprint ?? '').replace('DIP-', ''));
      const m = p.description.match(/Hidden power pins \(\w+ = (\d+), \w+ = (\d+)\)/);
      if (!m) bad.push(`${p.id}: no power pin sentence`);
      else if (nums.includes(m[1]) || nums.includes(m[2])) bad.push(`${p.id}: a signal pin uses power pin ${m[1]} / ${m[2]}`);
      for (const n of nums) if (!(Number(n) >= 1 && Number(n) <= pkg)) bad.push(`${p.id}: pin number ${n} outside DIP-${pkg}`);
      for (const q of p.symbol.pins) if (q.x % 10 !== 0 || q.y % 10 !== 0) bad.push(`${p.id}: pin ${q.name} off grid`);
      if (validateParams(p, defaultParams(p)).length) bad.push(`${p.id}: default params invalid`);
      if (!asLibraryPart(p).textVi?.description) bad.push(`${p.id}: no Vietnamese description`);
    }
    expect(bad).toEqual([]);
  });
});

describe('logic device types: truth tables and state sequences', () => {
  const skip = new Set(['121', '122', '123', '221', '4538', '4016', '4066', '4051', '4052', '4053', '4067', '4046', '4060']);
  const testable = SPECS.filter((s) => !skip.has(s.pn));

  it('every testable type has a vector table', () => {
    expect(testable.filter((s) => !V[s.pn] && !GATE_FN[s.pn]).map((s) => s.pn)).toEqual([]);
  });

  describe.each(testable.map((s) => [`${s.pn} ${s.name}`, s] as const))('%s', (_n, spec) => {
    it.each(testFamilies(spec).map((f) => [f] as const))('family %s', (fam) => {
      const v = V[spec.pn] ?? gateVectors(spec, GATE_FN[spec.pn]);
      expect(runVectors(spec, fam, v)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// timing, analog parts, monostables, PLL, settings

const crossings = (r: AnalysisResult, name: string, level: number, dir: 'up' | 'down') => {
  const t = r.scale!.re;
  const v = vec(r, name);
  const out: number[] = [];
  for (let i = 1; i < t.length; i++) if (dir === 'up' ? v[i - 1] < level && v[i] >= level : v[i - 1] > level && v[i] <= level) out.push(t[i - 1] + ((level - v[i - 1]) / (v[i] - v[i - 1])) * (t[i] - t[i - 1]));
  return out;
};

describe('timing per family', () => {
  /** Rising-input to falling-output delay of a 74x00 gate (50 % in, mid-swing out) and the reverse. */
  function nandDelays(fam: LogicFamily, digital?: DigitalSimSettings): { phl: number; plh: number } {
    const lv = FAMILIES[fam as keyof typeof FAMILIES];
    const id = partIdOf({ pn: '00' }, fam);
    const vin = lv.voh >= 4.9 ? 5 : 3.4;
    const f = instantiate(id, 'U1', { '1A': 'in', '1B': 'hi', '1Y': 'y' }, {}, {}, digital);
    const r = simulate([f], [vdc('VH', 'hi', vin), vwave('VIN', 'in', 0, { type: 'PULSE', args: [0, vin, 20e-9, 0.2e-9, 0.2e-9, 40e-9, 1] })], { type: 'tran', tstep: 0.1e-9, tstop: 100e-9 });
    const thr = (lv.vol + lv.voh) / 2;
    return { phl: crossings(r, 'V(y)', thr, 'down')[0] - 20.1e-9, plh: crossings(r, 'V(y)', thr, 'up')[0] - 60.2e-9 };
  }

  it.each(ALL_74.map((f) => [f] as const))('74%s00 propagation delay matches the family figures', (fam) => {
    const lv = FAMILIES[fam];
    const d = nandDelays(fam);
    expect(d.phl / lv.tphl).toBeGreaterThan(0.85);
    expect(d.phl / lv.tphl).toBeLessThan(1.15);
    expect(d.plh / lv.tplh).toBeGreaterThan(0.85);
    expect(d.plh / lv.tplh).toBeLessThan(1.15);
  });

  it('family speed order: AS < S < F < AC < ALS < HC < LS (gate delay)', () => {
    const avg = (f: LogicFamily) => {
      const d = nandDelays(f);
      return (d.phl + d.plh) / 2;
    };
    const order = (['AS', 'S', 'F', 'AC', 'ALS', 'HC', 'LS'] as LogicFamily[]).map(avg);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it('flip-flop clock-to-output is about two gate delays; 4000B gets faster with VDD', () => {
    const ff = (id: string, params: Record<string, string>, vh: number) => {
      const f = instantiate(id, 'U1', { '1D': 'hi', '1CLK': 'clk', '1PRE': 'hi', '1CLR': 'hi', '1Q': 'q' }, params);
      const r = simulate([f], [vdc('VH', 'hi', vh), vwave('VC', 'clk', 0, { type: 'PULSE', args: [0, vh, 50e-9, 0.2e-9, 0.2e-9, 1e-6, 2e-6] })], { type: 'tran', tstep: 0.5e-9, tstop: 1.5e-6 });
      return crossings(r, 'V(q)', vh === 5 ? 2.5 : 1.8, 'up')[0] - 50.1e-9;
    };
    expect(ff('ttl/74ls74', {}, 3.4) / (2 * FAMILIES.LS.tplh)).toBeCloseTo(1, 1);
    expect(ff('cmos/74hc74', {}, 5) / (2 * FAMILIES.HC.tplh)).toBeCloseTo(1, 1);
    const cd = (vdd: number) => {
      const f = instantiate('cmos/4042', 'U1', { D1: 'hi', CLK: 'clk', POL: 'hi', Q1: 'q' }, { vdd: String(vdd) });
      const r = simulate([f], [vdc('VH', 'hi', vdd), vwave('VC', 'clk', 0, { type: 'PULSE', args: [0, vdd, 100e-9, 1e-9, 1e-9, 5e-6, 10e-6] })], { type: 'tran', tstep: 2e-9, tstop: 3e-6 });
      return crossings(r, 'V(q)', vdd / 2, 'up')[0] - 100.5e-9;
    };
    expect(cd(5) / cd(10)).toBeGreaterThan(1.8);
  });

  it('timing setting: max multiplies by the worst-case ratio, zero removes the delay', () => {
    const typ = nandDelays('LS');
    const max = nandDelays('LS', { timing: 'max' });
    const zero = nandDelays('LS', { timing: 'zero' });
    expect(max.phl / typ.phl).toBeCloseTo(FAMILIES.LS.maxFactor, 1);
    expect(zero.phl).toBeLessThan(3e-9);
  });
});

describe('digital simulation settings', () => {
  const design = (digital: DigitalSimSettings | undefined, withVcc: boolean) => {
    const b = new DesignBuilder('settings');
    const u = b.part('ttl/74ls04', 'U1', 0, 0);
    if (withVcc) b.part('sources/vcc', 'VCC1', 400, 0);
    const g = b.part('sources/ground', 'GND1', 200, 200);
    b.labelPin(u, '1A', 'GNDN');
    b.labelPin(g, '1', 'GNDN');
    b.labelPin(u, '1Y', 'Y');
    if (digital) b.design.digital = digital;
    b.design.analysis = { active: 'op', specs: { op: { type: 'op' } } };
    return b.design;
  };

  it('auto: powered from the VCC net when it exists; ideal: 0 / 5 V levels without supply; real: needs VCC', () => {
    const auto = buildNetlist(design(undefined, true));
    expect(auto.netlist.elements.find((e) => e.type === 'A')!.params.pwr).toBe(2);
    const ideal = buildNetlist(design({ mode: 'ideal' }, true));
    const a = ideal.netlist.elements.find((e) => e.type === 'A')!;
    expect(a.params.pwr).toBe(1);
    const r = runAnalyses(ideal.netlist)[0];
    expect(r.error).toBeUndefined();
    expect(r.scalars!['V(Y)']).toBeCloseTo(5, 6);
    const real = buildNetlist(design({ mode: 'real' }, false));
    const err = real.erc.find((m) => m.detail?.id === 'digitalNoPower');
    expect(err?.severity).toBe('error');
    expect(err?.detail?.params?.net).toBe('VCC');
    const realOk = buildNetlist(design({ mode: 'real' }, true));
    expect(realOk.erc.filter((m) => m.severity === 'error')).toEqual([]);
    const rr = runAnalyses(realOk.netlist)[0];
    expect(rr.scalars!['V(Y)']).toBeCloseTo(5 - 1.6, 6); // LS high level tracks VCC
  });
});

describe('analog switches, multiplexers, monostables and the PLL', () => {
  it('4051 connects COM to the addressed channel; INH opens every switch; 74HC4051 has lower RON', () => {
    const run = (id: string, a: number, inh: number) => {
      const f = instantiate(id, 'U1', { A: a & 1 ? 'hi' : '0', B: a & 2 ? 'hi' : '0', C: a & 4 ? 'hi' : '0', INH: inh ? 'hi' : '0', COM: 'com', ...Object.fromEntries(Array.from({ length: 8 }, (_, k) => [`X${k}`, `x${k}`])) });
      const extra = [vdc('VH', 'hi', 5), vdc('VCOM', 'com', 1)];
      for (let k = 0; k < 8; k++) extra.push(res(`RL${k}`, `x${k}`, '0', 10e3));
      return simulate([f], extra, { type: 'op' }).scalars!;
    };
    const s = run('cmos/4051', 5, 0);
    expect(s['V(x5)']).toBeCloseTo(10e3 / (10e3 + 470), 3);
    expect(s['V(x4)']).toBeLessThan(1e-3);
    expect(run('cmos/4051', 5, 1)['V(x5)']).toBeLessThan(1e-3);
    expect(run('cmos/74hc4051', 5, 0)['V(x5)']).toBeCloseTo(10e3 / (10e3 + 90), 3);
  });

  it('4053 routes each common to channel 0 or 1; 4066-HC switch conducts while its control is high', () => {
    const f = instantiate('cmos/4053', 'U1', { A: 'hi', B: '0', C: 'hi', INH: '0', X: 'x', Y: 'y', Z: 'z', X0: 'x0', X1: 'x1', Y0: 'y0', Y1: 'y1', Z0: 'z0', Z1: 'z1' });
    const extra = [vdc('VH', 'hi', 5), vdc('VX', 'x', 2), vdc('VY', 'y', 2), vdc('VZ', 'z', 2), ...['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].map((n) => res(`R${n}`, n, '0', 1e5))];
    const s = simulate([f], extra, { type: 'op' }).scalars!;
    expect([s['V(x0)'] > 1.9, s['V(x1)'] > 1.9, s['V(y0)'] > 1.9, s['V(y1)'] > 1.9, s['V(z0)'] > 1.9, s['V(z1)'] > 1.9]).toEqual([false, true, true, false, false, true]);
    const g = instantiate('cmos/74hc4066', 'U2', { '1A': 'hi', '1B': 'o1', '1C': 'hi', '2A': 'hi', '2B': 'o2', '2C': '0' });
    const t = simulate([g], [vdc('VH', 'hi', 5), res('R1', 'o1', '0', 1e3), res('R2', 'o2', '0', 1e3)], { type: 'op' }).scalars!;
    expect(t['V(o1)']).toBeCloseTo((5 * 1e3) / 1040, 4);
    expect(t['V(o2)']).toBeLessThan(1e-3);
  });

  it('monostables: 74123 retriggers, 74221 does not, 4538 tw = Rx·Cx', () => {
    const tw = (id: string, pins: Record<string, string>, params: Record<string, string>, trig: Waveform, vh: number, tstop: number) => {
      const f = instantiate(id, 'U1', pins, params);
      const r = simulate([f], [vdc('VH', 'hi', vh), vwave('VT', 'tr', 0, trig)], { type: 'tran', tstep: tstop / 4000, tstop });
      const q = pins['1Q'] ?? pins.Q1;
      return { up: crossings(r, `V(${q})`, vh / 2, 'up'), down: crossings(r, `V(${q})`, vh / 2, 'down') };
    };
    // two trigger pulses 5 µs apart, tw ≈ 0.45 · 10k · 2.2n ≈ 9.9 µs (74221: 0.7 · Rext · Cext)
    const p123 = { '1A': '0', '1B': 'tr', '1CLR': 'hi', '1Q': 'q' };
    const params = { rext1: '10k', cext1: '2.2n' };
    const a = tw('ttl/74ls123', p123, params, { type: 'PWL', args: [0, 0, 1e-6, 0, 1.01e-6, 3.4, 2e-6, 3.4, 2.01e-6, 0, 6e-6, 0, 6.01e-6, 3.4, 7e-6, 3.4, 7.01e-6, 0] }, 3.4, 40e-6);
    expect(a.down[0] - a.up[0]).toBeCloseTo(5e-6 + 0.45 * 10e3 * 2.2e-9, 7);
    const b = tw('ttl/74ls221', p123, params, { type: 'PWL', args: [0, 0, 1e-6, 0, 1.01e-6, 3.4, 2e-6, 3.4, 2.01e-6, 0, 6e-6, 0, 6.01e-6, 3.4, 7e-6, 3.4, 7.01e-6, 0] }, 3.4, 40e-6);
    expect(b.down[0] - b.up[0]).toBeCloseTo(0.7 * 10e3 * 2.2e-9, 7);
    const c = tw('cmos/4538', { TRP1: 'tr', TRN1: 'hi', CD1: 'hi', Q1: 'q1' }, { rx1: '100k', cx1: '10n', vdd: '5' }, { type: 'PULSE', args: [0, 5, 10e-6, 1e-7, 1e-7, 10e-6, 1] }, 5, 3e-3);
    expect(c.down[0] - c.up[0]).toBeCloseTo(1e-3, 6);
  });

  it('4046 PLL locks the VCO to the input frequency', () => {
    const fin = 20e3;
    const f = instantiate('cmos/4046', 'U1', { SIG: 'sig', COMP: 'vco', VCOIN: 'vcoin', INH: '0', VCOOUT: 'vco', PC2: 'pc2', PCP: 'pcp', PC1: 'pc1' }, { vdd: '5', r1: '10k', c1: '1n', r2: '100k' });
    const r = simulate(
      [f],
      [vwave('VS', 'sig', 0, { type: 'PULSE', args: [0, 5, 5e-6, 50e-9, 50e-9, 0.5 / fin, 1 / fin] }), res('R3', 'pc2', 'vcoin', 47e3), res('R4', 'vcoin', 'cf', 4.7e3), { type: 'C', name: 'C2', nodes: ['cf', '0'], value: 47e-9, params: {} }],
      { type: 'tran', tstep: 1e-6, tstop: 30e-3 },
    );
    const up = crossings(r, 'V(vco)', 2.5, 'up').filter((t) => t > 20e-3);
    expect((up.length - 1) / (up[up.length - 1] - up[0]) / fin).toBeCloseTo(1, 3);
    // the 4046 VCO range: fmin = 1/(R2 C1') ≈ 9.7 kHz, fmax = fmin + 1/(R1 C1') ≈ 106.6 kHz
    const cc = 1.032e-9;
    const fmin = 1 / (100e3 * cc);
    const span = 1 / (10e3 * cc);
    expect(at(r, 'V(cf)', 30e-3)).toBeCloseTo(((fin - fmin) / span) * 5, 1);
  });

  it('74HC4060 RC oscillator divides by 16 on Q4', () => {
    const f = instantiate('cmos/74hc4060', 'U1', { PHI_I: 'rs', PHI_O: 'rtc', PHI_ON: 'ctc', RST: '0', Q4: 'q4' });
    const r = simulate([f], [res('RS', 'rs', 'j', 100e3), res('RT', 'rtc', 'j', 10e3), { type: 'C', name: 'CT', nodes: ['ctc', 'j'], value: 1e-9, params: {} }], { type: 'tran', tstep: 0.5e-6, tstop: 1.2e-3 });
    const osc = crossings(r, 'V(rtc)', 2.5, 'up');
    const period = (osc[osc.length - 1] - osc[2]) / (osc.length - 3);
    const q4 = crossings(r, 'V(q4)', 2.5, 'up');
    expect((q4[q4.length - 1] - q4[1]) / (q4.length - 2) / period).toBeCloseTo(16, 1);
  });
});
