/**
 * Review round 4, step 6: the ERC pin type of a 74xx output follows the device's output stage.
 *
 * `DEFAULT_PIN_MATRIX` (src/model/ercMatrix.ts) has rows for `tristate` and `open-collector`, but
 * no catalogue part ever carried those pin types, so the rows could never fire: two 7403
 * (open-collector) outputs wired onto one pull-up looked exactly like two 7400 outputs shorted
 * together — an error — and the normal wired-AND of a real board was reported as a fault.
 *
 * Now `logicPart` derives the pin type from `LogicSpec.output` for every family at once, so the
 * list below (and every LS / HC / ALS … variant of it) is covered by construction.
 */
import { describe, expect, it } from 'vitest';
import { getPart, listParts, loadAllGroups } from '../../../src/library';
import { asLibraryPart } from '../../../src/library/partkit';
import { normalizePinType, pinPairLevel } from '../../../src/model/ercMatrix';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';
import type { PinType } from '../../../src/library/types';

// the catalogue packs load on demand (src/library/index.ts)
await loadAllGroups();

/** Pin types of the output-side pins of a part (hidden supply pins are not symbol pins). */
function outputTypes(id: string): Set<string> {
  const def = getPart(id);
  if (!def) throw new Error(`no part ${id}`);
  const out = new Set<string>();
  for (const p of def.symbol.pins) {
    const t = normalizePinType(p.type as PinType | undefined);
    if (t === 'output' || t === 'tristate' || t === 'open-collector' || t === 'bidir') out.add(t);
  }
  return out;
}

/** Every family id of a type number, e.g. '03' → ttl/74std03, ttl/74ls03, cmos/74hc03 … */
function familyIds(pn: string): string[] {
  const re = new RegExp(`^(?:ttl|cmos)/74[a-z]*${pn}$`);
  return listParts()
    .map((p) => p.id)
    .filter((id) => re.test(id))
    .sort();
}

const OPEN_COLLECTOR = ['01', '03', '05', '06', '07', '09', '12', '22', '26', '33', '38'];
const THREE_STATE = ['125', '126', '240', '244', '373', '374', '541'];

describe('open-collector 74xx parts carry the open-collector pin type', () => {
  for (const pn of OPEN_COLLECTOR) {
    it(`74xx${pn} in every family it exists in`, () => {
      const ids = familyIds(pn);
      expect(ids.length, `74xx${pn} has no catalogue part`).toBeGreaterThan(0);
      for (const id of ids) {
        // the catalogue parts also carry it as a filterable spec; the hand-written legacy parts
        // (ttl/7447 …) have no spec table, and for them the pin type is the whole statement
        const spec = asLibraryPart(getPart(id)!).specs?.output;
        if (spec !== undefined) expect(spec, id).toBe('open-collector');
        expect(outputTypes(id), id).toEqual(new Set(['open-collector']));
      }
      // at least the LS or HC variant is there, as the task asks
      expect(ids.some((id) => /74(ls|hc)/.test(id)), `74xx${pn}: no LS / HC variant`).toBe(true);
    });
  }
});

describe('3-state 74xx parts carry the tristate (or bidir) pin type', () => {
  for (const pn of THREE_STATE) {
    it(`74xx${pn} in every family it exists in`, () => {
      const ids = familyIds(pn);
      expect(ids.length, `74xx${pn} has no catalogue part`).toBeGreaterThan(0);
      for (const id of ids) {
        const spec = asLibraryPart(getPart(id)!).specs?.output;
        if (spec !== undefined) expect(spec, id).toBe('3-state');
        const types = outputTypes(id);
        // a buffer / latch drives outputs; a transceiver's bus pins are bidirectional
        expect(types.size, id).toBeGreaterThan(0);
        expect([...types].every((t) => t === 'tristate' || t === 'bidir'), `${id}: ${[...types].join(',')}`).toBe(true);
        expect(types.has('output'), `${id} still has a plain output pin`).toBe(false);
      }
      expect(ids.some((id) => /74(ls|hc)/.test(id)), `74xx${pn}: no LS / HC variant`).toBe(true);
    });
  }

  it('the 74245 transceiver keeps bidirectional bus pins', () => {
    expect(outputTypes('ttl/74ls245')).toEqual(new Set(['bidir']));
  });
});

describe('the matrix rows those pin types unlock actually fire', () => {
  /** Two outputs of the given part type wired onto one net, with a pull-up to a 5 V rail. */
  function twoOutputs(partId: string, outPin: string): DesignBuilder {
    const b = new DesignBuilder('Wired outputs');
    const u1 = b.part(partId, 'U1', 0, 0);
    const u2 = b.part(partId, 'U2', 0, 300);
    const s1 = b.part('sources/logic-switch', 'S1', -260, -20, { state: 'true' });
    const s2 = b.part('sources/logic-switch', 'S2', -260, 280, { state: 'false' });
    const r = b.part('basic/resistor', 'R1', 320, -120, { value: '2.2k' });
    const v = b.part('sources/dc-voltage', 'V1', 520, -60, { value: '5' });
    b.part('sources/ground', 'GND1', 520, 60);
    b.wire(b.pin(s1, 'OUT'), { x: -200, y: -20 }, { x: -200, y: 0 }, b.pin(u1, '1A'));
    b.wire(b.pin(u1, '1A'), b.pin(u1, '1B'));
    b.wire(b.pin(s2, 'OUT'), { x: -200, y: 280 }, { x: -200, y: 300 }, b.pin(u2, '1A'));
    b.wire(b.pin(u2, '1A'), b.pin(u2, '1B'));
    // the two outputs meet, and the pull-up reaches the same net
    b.wire(b.pin(u1, outPin), { x: 240, y: 0 }, { x: 240, y: 300 }, b.pin(u2, outPin));
    b.wire({ x: 240, y: 0 }, { x: 240, y: -120 }, b.pin(r, '1'));
    b.connect(r, '2', v, '+');
    b.wire(b.pin(v, '-'), { x: 520, y: 60 });
    return b;
  }

  it('two 7400 (push-pull) outputs on one net are an ERC error', () => {
    const erc = buildNetlist(twoOutputs('ttl/74std00', '1Y').design).erc;
    const clash = erc.filter((m) => m.detail?.id === 'pinTypeClash');
    expect(clash.map((m) => m.severity)).toContain('error');
    expect(clash.some((m) => m.detail?.params?.a === 'output' && m.detail?.params?.b === 'output')).toBe(true);
  });

  it('two 7403 (open-collector) outputs on the same pull-up are accepted', () => {
    const erc = buildNetlist(twoOutputs('ttl/74std03', '1Y').design).erc;
    const clash = erc.filter((m) => m.detail?.id === 'pinTypeClash');
    expect(clash).toEqual([]);
    // the default matrix says so, which is what the pin types now make reachable
    expect(pinPairLevel('open-collector', 'open-collector')).toBe('ok');
    expect(pinPairLevel('output', 'open-collector')).toBe('warning');
    expect(pinPairLevel('output', 'tristate')).toBe('warning');
  });

  it('a push-pull output meeting a 3-state bus line is a warning, not an error', () => {
    const b = new DesignBuilder('Bus clash');
    const buf = b.part('ttl/74ls125', 'U1', 0, 0);
    const g = b.part('misc-digital/nand2', 'U2', 0, 240);
    const s1 = b.part('sources/logic-switch', 'S1', -260, -20, { state: 'true' });
    b.part('sources/ground', 'GND1', -260, 160);
    b.wire(b.pin(s1, 'OUT'), { x: -200, y: -20 }, { x: -200, y: 0 }, b.pin(buf, '1A'));
    b.wire(b.pin(buf, '1Y'), { x: 200, y: 0 }, { x: 200, y: 240 }, b.pin(g, 'Y'));
    b.wire(b.pin(g, 'A'), b.pin(g, 'B'));
    b.labelPin(g, 'A', 'IN2');
    b.labelPin(buf, '1G', 'OE');
    const clash = buildNetlist(b.design).erc.filter((m) => m.detail?.id === 'pinTypeClash');
    expect(clash).toHaveLength(1);
    expect(clash[0].severity).toBe('warning');
    expect([clash[0].detail?.params?.a, clash[0].detail?.params?.b].sort()).toEqual(['output', 'tristate']);
  });
});
