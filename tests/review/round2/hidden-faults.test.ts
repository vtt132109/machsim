/**
 * Review round 2: hidden faults (Simulate > Auto fault, src/model/faults.ts) are a
 * troubleshooting exercise: the schematic shows nothing until "Reveal faults". But the bottom
 * dock's Netlist tab (src/ui/integration/reports.ts designNetlistText, shown by
 * integration/panels.tsx NetlistTab) prints the netlist with the fault elements the netlister
 * inserts, named after the faulty part and pin (<refdes>_fo_<pin> / _fs_ / _fl_), e.g.
 * "R1_fl_2 MID IN 6.5k". A student opens the Netlist tab and reads which part is broken and how.
 *
 * Expected: while faults are hidden, the Netlist tab text does not name them (mask the elements
 * or refuse the listing like the instructor's hidden values). Fails while it leaks.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { placeAutoFaults, hiddenFaultCount } from '../../../src/model/faults';
import { designNetlistText } from '../../../src/ui/integration/reports';
import { getPart } from '../../../src/library';

function divider() {
  const b = new DesignBuilder('Fault drill');
  const v = b.part('sources/dc-voltage', 'V1', 0, 0, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
  const r2 = b.part('basic/resistor', 'R2', 200, 0, { value: '1k' });
  const g = b.part('sources/ground', 'G1', 0, 200);
  b.labelPin(v, '+', 'IN');
  b.labelPin(r1, '1', 'IN');
  b.labelPin(r1, '2', 'MID');
  b.labelPin(r2, '1', 'MID');
  b.labelPin(r2, '2', 'GND');
  b.labelPin(v, '-', 'GND');
  b.labelPin(g, '1', 'GND');
  return b.design;
}

describe('hidden auto faults stay hidden', () => {
  it('the Netlist tab does not name the part that carries a hidden fault', () => {
    const { design, placed } = placeAutoFaults(divider(), getPart, { count: 1, seed: 7 });
    expect(placed.length).toBe(1);
    expect(hiddenFaultCount(design)).toBe(1);
    const faulty = placed[0];
    const text = designNetlistText(design, 'none').text;
    // the fault element names embed the refdes: <ref>_fo_ / _fs_ / _fl_ (today: "R1_fl_2 MID IN 6.5k")
    const leaked = text.split('\n').filter((l) => /_f[osl]_/i.test(l));
    expect({ faulty: JSON.stringify(faulty), leaked }).toEqual({ faulty: JSON.stringify(faulty), leaked: [] });
  });
});
