/**
 * Review round 2: values typed by a Vietnamese learner. Vietnamese writes the decimal separator
 * as a comma ("4,7 kΩ"), and the RKM form "4k7" is printed on many parts lists. MachSim's own
 * student questions accept "4,7k" (src/model/questions.ts parseAnswerNumber), and the Vietnamese
 * formula texts of the wizards use commas, but the Properties field (src/ui/editor/paramFields.ts
 * validateParamText / paramPreview), the ERC and the netlister read part values with
 * parseUserNumber (src/util/units.ts), which stops at the first character it does not know and
 * ignores the rest. So "4,7k" is accepted silently as 4 Ω and "4k7" as 4 kΩ, and the circuit
 * simulates with the wrong value without any warning.
 *
 * Expected: either the text is read as 4.7 kΩ, or the field / ERC rejects it with a message. The
 * tests fail while the value is silently truncated.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../../../src/library';
import { paramPreview, validateParamText } from '../../../src/ui/editor/paramFields';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';

const resistor = getPart('basic/resistor')!;
const valueDef = resistor.params.find((p) => p.key === 'value')!;

function resistorValueInNetlist(text: string): { value: number | undefined; errors: string[] } {
  const b = new DesignBuilder('comma');
  const v1 = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '9' });
  const r1 = b.part('basic/resistor', 'R1', 100, 0, { value: text });
  const g1 = b.part('sources/ground', 'G1', 0, 100);
  b.wire(b.pin(v1, '+'), b.pin(r1, '1'));
  b.wire(b.pin(r1, '2'), b.pin(v1, '-'));
  b.wire(b.pin(v1, '-'), b.pin(g1, '1'));
  const build = buildNetlist(b.design);
  const el = build.netlist.elements.find((e) => e.name.toUpperCase() === 'R1');
  return { value: el?.value, errors: build.erc.filter((m) => m.severity === 'error').map((m) => m.message) };
}

describe('part values typed with a decimal comma or in RKM form', () => {
  it('control: "4.7k" is 4.7 kΩ everywhere', () => {
    expect(validateParamText(valueDef, '4.7k')).toBeNull();
    expect(paramPreview(valueDef, '4.7k')).toBe('4.7 kΩ');
    expect(resistorValueInNetlist('4.7k').value).toBeCloseTo(4700, 9);
  });

  for (const text of ['4,7k', '4k7']) {
    it(`"${text}" is either read as 4.7 kΩ or refused — never silently another value`, () => {
      const refused = validateParamText(valueDef, text) !== null;
      if (!refused) {
        // accepted by the Properties field: the preview and the simulated value must be 4.7 kΩ
        expect(paramPreview(valueDef, text)).toBe('4.7 kΩ');
        const { value, errors } = resistorValueInNetlist(text);
        if (errors.length === 0) expect(value).toBeCloseTo(4700, 9);
      }
    });
  }
});
