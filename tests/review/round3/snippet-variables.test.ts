/**
 * Review round 3: global parameters that travel with a circuit snippet (src/model/snippet.ts).
 *
 * buildSnippet() carries only the design variables whose name appears, with the SAME case, inside
 * `{…}` in a part value (referencedNames). But src/model/variables.ts — the code that actually
 * evaluates part values — documents three more ways a value refers to a variable, and all of them
 * work in the source design:
 *   - names are case-insensitive ("{rtop}" uses the variable "Rtop");
 *   - a NUMBER parameter may be the bare name of a variable ("Rbot", no braces);
 *   - variables may refer to other variables ("Rtop = {2*Rbase}").
 * In each case the snippet is written without the variable, so the circuit dropped onto a sheet of
 * another design (or opened as a new design) fails ERC with "undefined parameter" / "is not a
 * number" although it simulated fine where it was copied from.
 *
 * Expected: the snippet carries every variable the copied values need (directly or through other
 * variables), so the snippet opened as a design builds a netlist without errors and gives the
 * same operating point. Fails today.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../../../src/library';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';
import { buildSnippet, decodeSnippet, encodeSnippet, snippetDesign } from '../../../src/model/snippet';
import type { Design } from '../../../src/model/types';
import { runAnalyses } from '../../../src/sim';
import { copyItems } from '../../../src/ui/store/designOps';
import type { SelItem } from '../../../src/ui/store/types';
import { encodePng } from '../../../src/util/png';

function divider(top: string, bottom: string, variables: Record<string, string>): Design {
  const b = new DesignBuilder('Divider');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 130, { value: top }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 270, { value: bottom }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 100, 330);
  b.wire(b.pin(v1, '+'), { x: 100, y: 100 }, b.pin(r1, '1'));
  b.connect(r1, '2', r2, '1');
  b.wire(b.pin(r2, '2'), { x: 250, y: 330 }, { x: 100, y: 330 });
  b.wire(b.pin(v1, '-'), { x: 100, y: 330 });
  b.label('OUT', 250, 200);
  b.design.variables = variables;
  return b.design;
}

const all = (d: Design): SelItem[] => {
  const s = d.sheets[0];
  return [...s.parts.map((p) => ({ kind: 'part' as const, id: p.id })), ...s.wires.map((w) => ({ kind: 'wire' as const, id: w.id })), ...s.labels.map((l) => ({ kind: 'label' as const, id: l.id }))];
};

function outVolts(d: Design): number {
  const build = buildNetlist(d, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error').map((m) => m.message)).toEqual([]);
  const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
  expect(r.error).toBeUndefined();
  return r.scalars!['V(OUT)'];
}

/** Copy everything into a snippet PNG, read it back and open it as a new design. */
function roundTrip(d: Design): Design {
  const frag = copyItems(d, d.sheets[0].id, all(d), getPart)!;
  const png = encodeSnippet(encodePng(2, 2, new Uint8Array(16).fill(255)), buildSnippet(d, frag));
  return snippetDesign(decodeSnippet(png), 'Snippet', 'Trang 1');
}

const cases: { name: string; top: string; bottom: string; vars: Record<string, string> }[] = [
  { name: 'control: "{Rtop}" with the variable Rtop', top: '{Rtop}', bottom: '4.7k', vars: { Rtop: '10k' } },
  { name: 'a lower-case reference "{rtop}" to the variable Rtop', top: '{rtop}', bottom: '4.7k', vars: { Rtop: '10k' } },
  { name: 'a bare variable name "Rbot" as the value', top: '10k', bottom: 'Rbot', vars: { Rbot: '4.7k' } },
  { name: 'a variable defined through another one (Rtop = {2*Rbase})', top: '{Rtop}', bottom: '4.7k', vars: { Rtop: '{2*Rbase}', Rbase: '5k' } },
];

describe('snippet carries the global parameters its part values need', () => {
  for (const c of cases) {
    it(c.name, () => {
      const src = divider(c.top, c.bottom, c.vars);
      const expected = (12 * 4.7) / 14.7;
      expect(outVolts(src)).toBeCloseTo(expected, 9);
      expect(outVolts(roundTrip(src))).toBeCloseTo(expected, 9);
    });
  }
});
