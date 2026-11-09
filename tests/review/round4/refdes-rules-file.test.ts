/**
 * Correctness review, round 4: Design.refdesRules read from a file.
 *
 * serialize.ts documents the field as "texts only (letters, digits, "_")", and the Tools ›
 * Reference designator prefixes dialog refuses other texts and prefixes that end in a digit
 * (`validateRules`: badText / endsInDigit). The file reader checks neither: a teacher's file, a
 * hand-edited file or one written by another tool opens without a note, and every part placed
 * afterwards gets a designator the dialog would never allow:
 *   map { R: "R X" } -> "R X1" (a space inside a designator; Find, annotate and the SPICE export
 *                       treat the name as two words)
 *   map { R: "R1" }  -> "R11" for the first resistor (indistinguishable from resistor number 11)
 *   map { R: "" }    -> "U1" for a resistor (an empty replacement falls back to "U")
 * The loader should repair (drop) such rules and report it, like the other design-scoped data
 * `parseDesignSafely` repairs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXAMPLES_DIR } from '../../helpers';
import { parseDesignSafely } from '../../../src/model/sanitize';
import { validateRules } from '../../../src/model/refdesRules';
import { DesignFormatError } from '../../../src/model/serialize';
import { placePart } from '../../../src/ui/store/designOps';
import { partLookup } from '../../../src/ui/store';

const raw = (): Record<string, unknown> => JSON.parse(readFileSync(EXAMPLES_DIR + '01-voltage-divider.msim', 'utf8')) as Record<string, unknown>;

describe('prefix rules the dialog would refuse, read from a file', () => {
  for (const [label, rules] of [
    ['a space', { map: { R: 'R X' } }],
    ['a trailing digit', { map: { R: 'R1' } }],
    ['an empty replacement', { map: { R: '' } }],
  ] as const) {
    it(`${label}: repaired or refused, never used as is`, () => {
      const file = { ...raw(), refdesRules: rules };
      let parsed: ReturnType<typeof parseDesignSafely>;
      try {
        parsed = parseDesignSafely(JSON.stringify(file));
      } catch (e) {
        // refusing the file with the format error (a sentence for the learner) is acceptable too
        expect(e).toBeInstanceOf(DesignFormatError);
        return;
      }
      const { design, notes } = parsed;
      const kept = design.refdesRules;
      const problems = validateRules(kept, ['R']);
      const placed = placePart(design, design.sheets[0].id, 'basic/resistor', { x: 600, y: 600 }, 0, false, partLookup);
      const refdes = placed.design.sheets[0].parts.find((p) => p.id === placed.id)!.refdes;
      // the new resistor must get an R-prefixed designator without spaces, and the rules that were kept must be valid
      expect(problems, `kept ${JSON.stringify(kept)}, notes ${JSON.stringify(notes)}`).toEqual([]);
      expect(refdes).toMatch(/^R\d+$/);
    });
  }
});
