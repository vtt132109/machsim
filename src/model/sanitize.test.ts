/**
 * The shared integrity layer (src/model/sanitize.ts): every design-scoped reference that enters a
 * design is remapped or stripped, and no entry path can leave a design that cannot be saved and
 * reopened.
 *
 * The test is written from the failure it prevents: for each reference kind, a fragment / design /
 * file carries a reference that means nothing where it arrives, and the result has to (a) carry no
 * dangling reference, (b) serialise and parse again, and (c) report what happened.
 */
import { describe, expect, it } from 'vitest';
import {
  ladderAddressInRange,
  neededVariables,
  parseDesignSafely,
  referencedVariables,
  repairRawDesign,
  sanitizeDesign,
  sanitizeIncoming,
  sanitizeIncomingSheets,
  validateDesignSafely,
  type IncomingFragment,
  type SanitizeCode,
} from './sanitize';
import { DesignFormatError, parseDesign, serializeDesign, validateDesign } from './serialize';
import { newDesign, newSheet, type Design, type PartInstance } from './types';

const codes = (notes: readonly { code: SanitizeCode }[]): SanitizeCode[] => notes.map((n) => n.code);

function part(id: string, partId: string, refdes: string, extra: Partial<PartInstance> = {}): PartInstance {
  return { id, partId, refdes, x: 100, y: 100, rotation: 0, mirror: false, params: {}, ...extra };
}

/** A design that uses variants, a global parameter and per-net settings. */
function board(): Design {
  const d = newDesign('Board');
  d.variants = { list: [{ id: 'v1', name: 'Đầy đủ' }, { id: 'v2', name: 'Không màn hình' }], active: 'v1' };
  d.variables = { Rload: '1k' };
  d.nets = { OUT: { color: '#ff0000', traceWidth: 0.4 } };
  d.sheets[0].parts = [part('p1', 'passives/resistor', 'R1', { params: { r: '{2*Rload}' }, notFitted: ['v2'] })];
  d.sheets[0].labels = [{ id: 'l1', x: 100, y: 100, name: 'OUT', rotation: 0 }];
  return d;
}

function fragmentOf(d: Design): IncomingFragment {
  const s = d.sheets[0];
  return { parts: s.parts, wires: s.wires, labels: s.labels, probes: s.probes, notes: s.notes, anchor: { x: 0, y: 0 } };
}

/** Every reference the validator refuses, so "saves and reopens" is a real assertion. */
function reopens(d: Design): Design {
  return parseDesign(serializeDesign(d));
}

describe('global parameters a value refers to (one rule for paste, snippets and tests)', () => {
  const byLower = new Map([['rload', 'Rload'], ['gain', 'gain']]);

  it('finds names in braces, in a bare expression and in a bare name, never in a plain number', () => {
    expect(referencedVariables('{2*Rload}', byLower)).toEqual(['Rload']);
    expect(referencedVariables('Rload', byLower)).toEqual(['Rload']);
    expect(referencedVariables('2*gain', byLower)).toEqual(['gain']);
    expect(referencedVariables('{Rload}+{gain}', byLower)).toEqual(['Rload', 'gain']);
    expect(referencedVariables('4.7k', byLower)).toEqual([]);
    expect(referencedVariables('', byLower)).toEqual([]);
    // matching ignores case, the declared spelling comes back
    expect(referencedVariables('{RLOAD*2}', byLower)).toEqual(['Rload']);
  });

  it('closes over the definitions the variables use themselves', () => {
    const vars = { Rtop: '{2*Rbot}', Rbot: '{base}', base: '1k', unused: '5k' };
    const parts = [part('p1', 'passives/resistor', 'R1', { params: { r: 'Rtop' } })];
    expect(neededVariables(parts, vars).sort()).toEqual(['Rbot', 'Rtop', 'base']);
  });
});

describe('a fragment entering another design', () => {
  it('remaps an assembly variant by name and strips one the target does not have', () => {
    const source = board();
    const target = newDesign('Target');
    target.variants = { list: [{ id: 'vA', name: 'không màn hình' }], active: 'vA' };
    const r = sanitizeIncoming(target, fragmentOf(source), { variants: source.variants, variables: source.variables });
    // "Không màn hình" exists here under another id: the reference follows the NAME
    expect(r.fragment.parts[0].notFitted).toEqual(['vA']);
    expect(codes(r.notes)).toContain('variantRemapped');

    const other = newDesign('Other');
    other.variants = { list: [{ id: 'vX', name: 'Chỉ nguồn' }] };
    const r2 = sanitizeIncoming(other, fragmentOf(source), { variants: source.variants });
    expect(r2.fragment.parts[0].notFitted).toBeUndefined();
    expect(codes(r2.notes)).toContain('variantDropped');
  });

  it('strips a variant reference when the target has no variants at all, and the paste still saves', () => {
    const source = board();
    const target = newDesign('Target');
    const r = sanitizeIncoming(target, fragmentOf(source), { variants: source.variants });
    const pasted: Design = { ...target, sheets: [{ ...target.sheets[0], parts: r.fragment.parts }] };
    // the failure this prevents: validateDesign refuses "unknown variant id"
    expect(() => reopens(pasted)).not.toThrow();
    expect(reopens(pasted).sheets[0].parts[0].notFitted).toBeUndefined();
  });

  it('brings the global parameters the copied values need, and keeps the target’s own value', () => {
    const source = board();
    const target = newDesign('Target');
    const r = sanitizeIncoming(target, fragmentOf(source), { variables: source.variables });
    expect(r.variables).toEqual({ Rload: '1k' });
    expect(codes(r.notes)).toContain('variableAdded');

    const mine = { ...newDesign('Mine'), variables: { RLOAD: '10k' } };
    const r2 = sanitizeIncoming(mine, fragmentOf(source), { variables: source.variables });
    expect(r2.variables).toEqual({});
    expect(codes(r2.notes)).toContain('variableKept');
  });

  it('brings the per-net settings of the nets the fragment names', () => {
    const source = board();
    const target = newDesign('Target');
    const r = sanitizeIncoming(target, fragmentOf(source), { nets: source.nets });
    expect(r.nets).toEqual({ OUT: { color: '#ff0000', traceWidth: 0.4 } });
    expect(codes(r.notes)).toContain('netSettingsAdded');
    // the target's own settings for that net win
    const mine = { ...newDesign('Mine'), nets: { out: { color: '#00ff00' } } };
    expect(sanitizeIncoming(mine, fragmentOf(source), { nets: source.nets }).nets).toEqual({});
  });

  it('drops a model override no SPICE text defines and keeps one that is defined', () => {
    const frag: IncomingFragment = {
      parts: [part('p1', 'semis/diode', 'D1', { modelOverride: 'MYDIODE' }), part('p2', 'semis/diode', 'D2', { modelOverride: 'GONE' })],
      wires: [],
      labels: [],
      probes: [],
      notes: [],
      anchor: { x: 0, y: 0 },
    };
    const r = sanitizeIncoming(newDesign('T'), frag, { customSpice: '.model MYDIODE D(IS=1e-14)\n' });
    expect(r.fragment.parts[0].modelOverride).toBe('MYDIODE');
    expect(r.fragment.parts[1].modelOverride).toBeUndefined();
    expect(r.customSpice).toContain('MYDIODE');
    expect(codes(r.notes)).toEqual(expect.arrayContaining(['modelOverrideDropped', 'customSpiceAdded']));
  });

  it('removes a part whose user component nobody carries, and a block without its child design', () => {
    const frag: IncomingFragment = {
      parts: [part('p1', 'custom:mything', 'X1'), part('p2', 'hier:gone', 'HB1'), part('p3', 'passives/resistor', 'R1')],
      wires: [],
      labels: [],
      probes: [],
      notes: [],
      anchor: { x: 0, y: 0 },
    };
    const r = sanitizeIncoming(newDesign('T'), frag, {});
    expect(r.fragment.parts.map((p) => p.refdes)).toEqual(['R1']);
    expect(codes(r.notes)).toEqual(expect.arrayContaining(['customPartMissing', 'blockMissing']));
  });

  it('drops a reference probe that stayed behind', () => {
    const frag: IncomingFragment = {
      parts: [],
      wires: [],
      labels: [],
      probes: [{ id: 'pr1', kind: 'voltage', x: 10, y: 10, name: 'P1', color: '#e53935', refProbe: 'pr-left-behind' }],
      notes: [],
      anchor: { x: 0, y: 0 },
    };
    const r = sanitizeIncoming(newDesign('T'), frag, {});
    expect(r.fragment.probes[0].refProbe).toBeUndefined();
    expect(codes(r.notes)).toContain('probeRefDropped');
  });

  it('keeps sheet structure when whole sheets enter (a .msim becoming a block)', () => {
    const source = board();
    source.sheets.push({ ...newSheet('s2', 'Sheet 2'), parts: [part('p9', 'passives/resistor', 'R9', { notFitted: ['v2'] })] });
    const r = sanitizeIncomingSheets(newDesign('T'), source.sheets, { variants: source.variants, variables: source.variables });
    expect(r.sheets).toHaveLength(2);
    expect(r.sheets[0].parts[0].notFitted).toBeUndefined();
    expect(r.sheets[1].parts[0].notFitted).toBeUndefined();
    expect(r.variables).toEqual({ Rload: '1k' });
  });
});

describe('a whole design entering (import, template, project, lesson, block from file)', () => {
  it('drops variant ids nothing declares and resets an unknown active variant', () => {
    const d = board();
    d.variants = { list: [{ id: 'v1', name: 'Đầy đủ' }], active: 'vGone' };
    d.sheets[0].parts[0].notFitted = ['v2'];
    const r = sanitizeDesign(d);
    expect(r.design.variants?.active).toBe('v1');
    expect(r.design.sheets[0].parts[0].notFitted).toBeUndefined();
    expect(codes(r.notes)).toEqual(expect.arrayContaining(['variantDropped', 'activeVariantReset']));
    expect(() => reopens(r.design)).not.toThrow();
  });

  it('returns the same object when there is nothing to repair', () => {
    const d = board();
    const r = sanitizeDesign(d);
    expect(r.design).toBe(d);
    expect(r.notes).toEqual([]);
  });

  it('drops an ERC matrix cell with an unknown pin pair, an empty net-settings entry and a stale library ref', () => {
    const d = board();
    d.erc = { matrix: { 'input|output': 'error', 'banana|output': 'error' } };
    d.nets = { ...d.nets, EMPTY: {} };
    d.libraryRefs = { 'passives/resistor': { sig: 'aa', pins: {}, defaults: {} }, 'semis/diode': { sig: 'bb', pins: {}, defaults: {} } };
    const r = sanitizeDesign(d);
    expect(Object.keys(r.design.erc?.matrix ?? {})).toEqual(['input|output']);
    expect(Object.keys(r.design.nets ?? {})).toEqual(['OUT']);
    expect(Object.keys(r.design.libraryRefs ?? {})).toEqual(['passives/resistor']);
    expect(codes(r.notes)).toEqual(expect.arrayContaining(['ercOptionDropped', 'netSettingsDropped', 'libraryRefDropped']));
  });

  it('reports a ladder address outside what a MachSim rack can address, and keeps the rung', () => {
    const d = newDesign('L');
    d.sheets.push({
      ...newSheet('s2', 'Ladder'),
      kind: 'ladder',
      ladder: [{ id: 'r1', logic: { kind: 'contact', type: 'no', address: 'I9.0' }, outputs: [{ kind: 'coil', address: 'Q0.0' }] }],
    });
    const r = sanitizeDesign(d);
    expect(codes(r.notes)).toContain('ladderAddressOutOfRange');
    expect(r.design.sheets[1].ladder).toHaveLength(1);
  });

  it('ladderAddressInRange knows the areas of a MachSim rack', () => {
    for (const ok of ['I0.0', 'I7.7', 'Q3.2', 'M15.7', 'T1', 'T32', 'T1.ET', 'C32.CV', 'AI7', '2.5', '']) expect(ladderAddressInRange(ok), ok).toBe(true);
    for (const bad of ['I8.0', 'I0.8', 'M16.0', 'T0', 'T33', 'C0', 'AI8']) expect(ladderAddressInRange(bad), bad).toBe(false);
  });
});

describe('a file being loaded is repaired instead of refused', () => {
  /** A .msim text whose part names a variant the file does not declare. */
  function brokenText(): string {
    const d = board();
    const raw = JSON.parse(serializeDesign(d)) as Record<string, unknown>;
    (raw as { variants?: unknown }).variants = { list: [{ id: 'v1', name: 'Đầy đủ' }], active: 'v1' };
    return JSON.stringify(raw);
  }

  it('the strict parser refuses it; parseDesignSafely opens it and says what it repaired', () => {
    const text = brokenText();
    expect(() => parseDesign(text)).toThrow(DesignFormatError);
    const r = parseDesignSafely(text);
    expect(r.design.sheets[0].parts[0].notFitted).toBeUndefined();
    expect(codes(r.notes)).toContain('variantDropped');
    // and what came back round-trips through the strict parser
    expect(() => reopens(r.design)).not.toThrow();
  });

  it('a healthy file takes the strict path and round-trips byte for byte', () => {
    const text = serializeDesign(board());
    const r = parseDesignSafely(text);
    expect(r.notes).toEqual([]);
    expect(serializeDesign(r.design)).toBe(text);
  });

  it('damage the repair cannot resolve still reports the original problem', () => {
    const bad = JSON.stringify({ format: 'machsim-design', version: 2, title: 'x', sheets: [{ id: 's1', name: 'S', parts: [{ id: 'p1', partId: 'r', refdes: 'R1', x: 0, y: 0, rotation: 45, mirror: false, params: {} }], wires: [], labels: [], probes: [], notes: [] }] });
    expect(() => parseDesignSafely(bad)).toThrow(DesignFormatError);
  });

  it('repairs duplicate item ids, a block without a child and a bad net-settings field', () => {
    const raw = {
      format: 'machsim-design',
      version: 2,
      title: 'T',
      sheets: [
        {
          id: 's1',
          name: 'S',
          parts: [part('p1', 'passives/resistor', 'R1'), part('p1', 'passives/resistor', 'R2'), part('p3', 'hier:nope', 'HB1')],
          wires: [],
          labels: [],
          probes: [],
          notes: [],
        },
      ],
      nets: { OUT: { traceWidth: 'wide', color: '#fff' }, '': { color: '#000' } },
    };
    const r = repairRawDesign(raw);
    expect(codes(r.notes)).toEqual(expect.arrayContaining(['idRenumbered', 'blockMissing', 'netSettingsDropped']));
    const d = validateDesign(r.raw);
    expect(d.sheets[0].parts.map((p) => p.id)).toEqual(['p1', 'p1_2']);
    expect(d.sheets[0].parts.map((p) => p.refdes)).toEqual(['R1', 'R2']);
    expect(d.nets).toEqual({ OUT: { color: '#fff' } });
  });

  it('validateDesignSafely is the same repair for a raw document (XML import)', () => {
    const raw = JSON.parse(serializeDesign(board())) as Record<string, unknown>;
    raw.variants = { list: [{ id: 'v1', name: 'Đầy đủ' }], active: 'v1' };
    const r = validateDesignSafely(raw);
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.design.sheets[0].parts[0].notFitted).toBeUndefined();
  });
});
