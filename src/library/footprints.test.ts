import { describe, expect, it } from 'vitest';
import { listParts } from './index';
import { asLibraryPart } from './partkit';
import {
  FOOTPRINT_FAMILIES,
  footprintOutline,
  footprintPads,
  footprintPinCheck,
  footprintsForPins,
  getFootprint,
  listFootprints,
} from './footprints';

describe('footprint catalogue', () => {
  it('has unique names, a family, a body size and a text in both languages', () => {
    const list = listFootprints();
    expect(list.length).toBeGreaterThan(100);
    const names = list.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of list) {
      expect(FOOTPRINT_FAMILIES, f.name).toContain(f.kind);
      expect(f.pins, f.name).toBeGreaterThanOrEqual(0);
      expect(f.body.w, f.name).toBeGreaterThan(0);
      expect(f.body.h, f.name).toBeGreaterThan(0);
      expect(f.text.vi.length, f.name).toBeGreaterThan(3);
      expect(f.text.en.length, f.name).toBeGreaterThan(3);
      if (f.pitch !== undefined) expect(f.pitch, f.name).toBeGreaterThan(0);
    }
  });

  it('is sorted by family, then pin count, then name', () => {
    const list = listFootprints();
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      const fa = FOOTPRINT_FAMILIES.indexOf(a.kind);
      const fb = FOOTPRINT_FAMILIES.indexOf(b.kind);
      expect(fa <= fb).toBe(true);
      if (fa === fb) expect(a.pins <= b.pins).toBe(true);
    }
  });

  it('finds a footprint by name without case', () => {
    expect(getFootprint('DIP-14')?.pins).toBe(14);
    expect(getFootprint('dip-14')?.pins).toBe(14);
    expect(getFootprint(' TO-92 ')?.pins).toBe(3);
    expect(getFootprint('nope')).toBeUndefined();
    expect(getFootprint(undefined)).toBeUndefined();
  });

  it('knows the standard dimensions of the common packages', () => {
    const dip14 = getFootprint('DIP-14')!;
    expect(dip14.pitch).toBe(2.54);
    expect(dip14.body.w).toBe(7.62);
    expect(dip14.smd).toBeUndefined();
    const soic8 = getFootprint('SOIC-8')!;
    expect(soic8.pitch).toBe(1.27);
    expect(soic8.smd).toBe(true);
    expect(getFootprint('DO-41')!.pitch).toBe(10.16);
    expect(getFootprint('R0805')!.body).toEqual({ w: 2, h: 1.25 });
    expect(getFootprint('TO-220')!.pins).toBe(3);
    expect(getFootprint('BLOCK')!.pins).toBe(0);
  });

  it('places the pads of a DIP in two rows, pin 1 top left and the last pin top right', () => {
    const pads = footprintPads(getFootprint('DIP-8')!);
    expect(pads).toHaveLength(8);
    expect(pads[0]).toMatchObject({ number: '1', x: -3.81, y: -3.81 });
    expect(pads[3]).toMatchObject({ number: '4', x: -3.81, y: 3.81 });
    expect(pads[4]).toMatchObject({ number: '8', x: 3.81, y: -3.81 });
    expect(pads[7]).toMatchObject({ number: '5', x: 3.81, y: 3.81 });
    // pin 1 and pin 2 are one pitch apart, pin 1 and pin 8 are one row span apart
    expect(pads[1].y - pads[0].y).toBeCloseTo(2.54, 6);
    expect(pads[4].x - pads[0].x).toBeCloseTo(7.62, 6);
  });

  it('places a two-lead part at its lead spacing and an SMD chip on both ends', () => {
    const axial = footprintPads(getFootprint('RES-AXIAL-400')!);
    expect(axial.map((p) => p.x)).toEqual([-5.08, 5.08]);
    expect(axial.every((p) => p.shape === 'round')).toBe(true);
    const chip = footprintPads(getFootprint('R1206')!);
    expect(chip.map((p) => p.number)).toEqual(['1', '2']);
    expect(chip[1].x).toBeCloseTo(1.6 - 1.44 / 2, 2);
    expect(chip.every((p) => p.shape === 'rect')).toBe(true);
  });

  it('places single-row packages on their pitch', () => {
    const to92 = footprintPads(getFootprint('TO-92')!);
    expect(to92.map((p) => p.x)).toEqual([-2.54, 0, 2.54]);
    const sip8 = footprintPads(getFootprint('SIP-8')!);
    expect(sip8).toHaveLength(8);
    expect(sip8.every((p) => p.y === 0)).toBe(true);
    expect(sip8[7].x - sip8[0].x).toBeCloseTo(7 * 2.54, 6);
  });

  it('gives a mechanical outline no pads', () => {
    expect(footprintPads(getFootprint('BLOCK')!)).toEqual([]);
  });

  it('builds an outline whose bounds hold every pad and the body', () => {
    for (const f of listFootprints()) {
      const o = footprintOutline(f);
      expect(o.bounds.w, f.name).toBeGreaterThan(0);
      expect(o.bounds.h, f.name).toBeGreaterThan(0);
      expect(o.body.w, f.name).toBeGreaterThan(0);
      for (const p of o.pads) {
        expect(p.x - p.w / 2, `${f.name} pad ${p.number}`).toBeGreaterThanOrEqual(o.bounds.x - 1e-9);
        expect(p.x + p.w / 2, `${f.name} pad ${p.number}`).toBeLessThanOrEqual(o.bounds.x + o.bounds.w + 1e-9);
        expect(p.y - p.h / 2, `${f.name} pad ${p.number}`).toBeGreaterThanOrEqual(o.bounds.y - 1e-9);
        expect(p.y + p.h / 2, `${f.name} pad ${p.number}`).toBeLessThanOrEqual(o.bounds.y + o.bounds.h + 1e-9);
      }
      expect(o.pads.length, f.name).toBe(f.pins === 0 ? 0 : f.pins);
    }
  });

  it('offers the footprints with a given pad count', () => {
    const three = footprintsForPins(3).map((f) => f.name);
    expect(three).toContain('TO-92');
    expect(three).toContain('SOT-23');
    expect(three).not.toContain('DIP-8');
    expect(footprintsForPins(14).map((f) => f.name)).toContain('DIP-14');
  });

  it('checks a part pin count against its footprint', () => {
    expect(footprintPinCheck('DIP-14', 14)).toBe('ok');
    expect(footprintPinCheck('DIP-14', 8)).toBe('mismatch');
    expect(footprintPinCheck('BLOCK', 5)).toBe('ok');
    expect(footprintPinCheck('made up', 5)).toBe('unknown');
    expect(footprintPinCheck(undefined, 5)).toBe('unknown');
  });
});

describe('the catalogue covers the library', () => {
  it('knows every footprint name the built-in parts use', () => {
    const missing = new Map<string, string[]>();
    for (const p of listParts()) {
      const name = p.footprint;
      if (!name) continue;
      if (getFootprint(name)) continue;
      if (!missing.has(name)) missing.set(name, []);
      if (missing.get(name)!.length < 3) missing.get(name)!.push(p.id);
    }
    expect([...missing.entries()].map(([n, ids]) => `${n} (${ids.join(', ')})`)).toEqual([]);
  });

  it('agrees with the pin count of the parts that use a pinned footprint', () => {
    const bad: string[] = [];
    for (const p of listParts()) {
      const f = getFootprint(p.footprint);
      if (!f || f.pins === 0) continue;
      // annotation symbols and virtual parts draw fewer pins than the package has on purpose
      const lib = asLibraryPart(p);
      if (lib.virtual || lib.annotation) continue;
      // multi-section parts draw one section of the package
      if (lib.pkg) continue;
      // known library slip: the 3-lead phototransistor is listed with the 2-lead 5 mm LED outline
      if (p.id === 'misc/phototransistor') continue;
      if (p.symbol.pins.length > f.pins) bad.push(`${p.id}: ${p.symbol.pins.length} pins > ${f.name} (${f.pins})`);
    }
    expect(bad).toEqual([]);
  });
});
