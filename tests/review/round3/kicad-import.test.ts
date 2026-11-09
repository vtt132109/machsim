/**
 * Review round 3: KiCad schematic import (src/model/kicadImport.ts + src/model/importSchematic.ts).
 *
 * 1. Unannotated schematics. A learner who draws in KiCad and never runs "Annotate" has every
 *    resistor called "R?". kicadToNetlist merges placed symbols BY REFERENCE (meant for the units of
 *    one multi-unit part), so three different "R?" resistors collapse into ONE component: the
 *    second and third resistor are dropped silently (their pin numbers 1 / 2 already exist), no
 *    note is written, and the imported circuit is a different circuit. KiCad itself treats "R?"
 *    as "not yet annotated", never as "the same part".
 *
 * 2. Values with a space between number and unit ("10 kΩ", "4.7 k", "100 nF") are common in
 *    hand-typed KiCad values. importSchematic.ts valueText() keeps only the first whitespace token,
 *    so "4.7 k" becomes 4.7 Ω, again silently (no defaultValue note).
 *
 * Expected: every placed resistor survives with its own value; the tests fail today.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importKicad, kicadToNetlist } from '../../../src/model/kicadImport';
import { buildNetlist } from '../../../src/model/netlister';

const FIXTURE = fileURLToPath(new URL('../../../src/model/fixtures/divider-diode.kicad_sch', import.meta.url));
const original = readFileSync(FIXTURE, 'utf8');

function resistorValues(text: string): number[] {
  const { design } = importKicad(text, { fileName: 'test.kicad_sch' });
  const build = buildNetlist(design);
  return build.netlist.elements
    .filter((e) => /^r/i.test(e.name) && e.nodes.length === 2 && typeof e.value === 'number')
    .map((e) => e.value as number)
    .sort((a, b) => a - b);
}

describe('KiCad import of an unannotated schematic ("R?")', () => {
  it('control: the annotated fixture imports three resistors 1k / 4.7k / 10k', () => {
    expect(resistorValues(original)).toEqual([1000, 4700, 10000]);
  });

  const unannotated = original
    .replace('"Reference" "R1"', '"Reference" "R?"')
    .replace('"Reference" "R2"', '"Reference" "R?"')
    .replace('"Reference" "R3"', '"Reference" "R?"');

  it('keeps three separate resistors when all of them are called "R?"', () => {
    const net = kicadToNetlist(unannotated, 'unannotated.kicad_sch');
    const resistors = net.components.filter((c) => c.symbol === 'Device:R');
    expect(resistors.length).toBe(3);
  });

  it('simulates the same three resistor values as the annotated file', () => {
    expect(resistorValues(unannotated)).toEqual([1000, 4700, 10000]);
  });
});

describe('KiCad values written with a space before the unit', () => {
  const spaced = original.replace('"Value" "10k"', '"Value" "10 kΩ"').replace('"Value" "4k7"', '"Value" "4.7 k"');

  it('"10 kΩ" and "4.7 k" import as 10 kΩ and 4.7 kΩ (or are reported) — never silently as 10 Ω / 4.7 Ω', () => {
    const { notes } = importKicad(spaced, { fileName: 'spaced.kicad_sch' });
    const reported = notes.filter((n) => n.kind === 'defaultValue').map((n) => (n as { refdes: string }).refdes);
    const values = resistorValues(spaced);
    if (reported.length === 0) expect(values).toEqual([1000, 4700, 10000]);
    else expect(reported.sort()).toEqual(['R1', 'R2']);
  });
});
