/**
 * Completeness review round 4 — the linked electromechanical parts of step 5 (a coil and the
 * contacts that follow it by name, src/library/catalog/relays.ts) are claimed "implemented", and
 * Reports › Bill of materials / the PCB netlist (src/model/bom.ts, src/model/pcb.ts) are claimed
 * "implemented". Together they produce a parts list a learner cannot buy from.
 *
 * A relay drawn the way control diagrams (and the round-4 samples 70 / 71 and the relay-latch
 * lesson) draw it — coil K1 in one place, its normally open and normally closed contacts elsewhere,
 * each contact naming "K1" in its "Cuộn hút" field — is ONE relay. MachSim lists the coil and every
 * contact as separate purchasable items with their own designators (K1, KC1, KC2) and gives each
 * contact its own 2-pin "DIN-RAIL" footprint in the PCB netlist, so the BOM says "1 × 12 V coil,
 * 1 × NO contact, 1 × NC contact" and the PCB tool receives three components instead of one relay.
 * The same happens to a contactor KM1 and its 3-pole main contacts / built-in auxiliary contacts.
 *
 * Multi-section ICs already solve exactly this problem (sections share one designator and the BOM /
 * PCB netlist see one package, src/model/sections.ts). Expected here: contacts that follow a coil
 * are part of that coil's device for the BOM and the PCB netlist — the relay is bought once. (A
 * clip-on supplementary contact block or a separate overload relay IS a separate item and is not
 * tested here.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAllGroups } from '../../../../src/library';
import { buildBom } from '../../../../src/model/bom';
import { DesignBuilder } from '../../../../src/model/designkit';
import { buildNetlist } from '../../../../src/model/netlister';
import { pcbComponents } from '../../../../src/model/pcb';
import type { Design } from '../../../../src/model/types';

beforeAll(async () => {
  await loadAllGroups();
});

/** Relay K1 (12 V DC coil) with one normally open and one normally closed contact. */
function relay(): Design {
  const b = new DesignBuilder('Rơ-le K1');
  b.part('electromechanical/coil-dc-12v', 'K1', 0, 0);
  b.part('electromechanical/relay-contact-no', 'KC1', 0, 200, { coil: 'K1' });
  b.part('electromechanical/relay-contact-nc', 'KC2', 200, 200, { coil: 'K1' });
  return b.design;
}

const quantity = (d: Design): number => buildBom(d).reduce((n, r) => n + r.quantity, 0);

describe('a coil and the contacts that follow it are one device in the BOM and the PCB netlist', () => {
  it('control: the contacts are linked to K1 (no contactNoCoil / contactNotCoil warning)', () => {
    const nb = buildNetlist(relay(), { includeAnalysis: false });
    expect(nb.erc.filter((m) => m.detail?.id?.startsWith('contact'))).toEqual([]);
  });

  it('Reports › Bill of materials lists relay K1 once (today: coil + NO contact + NC contact = 3 items)', () => {
    const rows = buildBom(relay());
    expect(rows.filter((r) => r.partId.includes('relay-contact'))).toEqual([]);
    expect(quantity(relay())).toBe(1);
  });

  it('the PCB netlist has one component for relay K1, not a separate 2-pin footprint per contact', () => {
    const refs = pcbComponents(relay()).map((c) => c.ref);
    expect(refs).toEqual(['K1']);
  });
});
