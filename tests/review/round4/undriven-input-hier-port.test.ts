/**
 * Correctness review, round 4: the new "undriven input" ERC check (step 1, `checkUndrivenInputs`
 * in src/model/ercMatrix.ts) inside a hierarchical block.
 *
 * The check runs per design level and fires when every pin of a net is an input. Inside a block,
 * a net that reaches the outside through a hierarchical connector (a `hier` label = a block port)
 * is driven by whatever the PARENT connects to that port, but the port is a label, not a pin, so
 * the child level sees "inputs only" and warns:
 *   "GATES: Net IN only has input pins (U1.A, U1.B): nothing drives it"
 * although a logic switch drives X1.IN at the top level. Every block whose input feeds gate inputs
 * (the usual way to build a reusable logic block) gets this false warning.
 */
import { describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../../src/model/designkit';
import { buildNetlist } from '../../../src/model/netlister';

describe('undriven-input ERC and block ports', () => {
  it('a block input port that the parent drives is not "undriven"', () => {
    const b = new DesignBuilder('Hier gates');
    const child = b.child('GATES', { kind: 'hierarchical' });
    b.label('IN', -100, 0, { kind: 'hier' });
    b.label('Y', 300, 0, { kind: 'hier' });
    const g1 = b.part('misc-digital/nand2', 'U1', 0, 0);
    b.labelPin(g1, 'A', 'IN');
    b.labelPin(g1, 'B', 'IN');
    b.labelPin(g1, 'Y', 'Y');
    b.root();
    const s1 = b.part('sources/logic-switch', 'S1', -300, 0, { state: 'true' });
    const x1 = b.block(child, 'X1', 200, 0);
    const g2 = b.part('misc-digital/nand2', 'U2', 500, 0);
    b.labelPin(s1, 'OUT', 'DRV');
    b.labelPin(x1, 'IN', 'DRV');
    b.labelPin(x1, 'Y', 'Q');
    b.labelPin(g2, 'A', 'Q');
    b.labelPin(g2, 'B', 'Q');
    b.labelPin(g2, 'Y', 'Z');
    const erc = buildNetlist(b.design).erc;
    const undriven = erc.filter((m) => m.detail?.id === 'undrivenInput');
    expect(undriven.map((m) => m.message)).toEqual([]);
  });

  it('a port that nothing outside drives is still reported (the check keeps its purpose)', () => {
    const b = new DesignBuilder('Hier gates open');
    const child = b.child('GATES', { kind: 'hierarchical' });
    b.label('IN', -100, 0, { kind: 'hier' });
    b.label('Y', 300, 0, { kind: 'hier' });
    const g1 = b.part('misc-digital/nand2', 'U1', 0, 0);
    b.labelPin(g1, 'A', 'IN');
    b.labelPin(g1, 'B', 'IN');
    b.labelPin(g1, 'Y', 'Y');
    b.root();
    // two copies whose IN ports are tied together and to nothing else: inputs only, across the hierarchy
    const x1 = b.block(child, 'X1', 200, 0);
    const x2 = b.block(child, 'X2', 200, 200);
    b.labelPin(x1, 'IN', 'FLOAT');
    b.labelPin(x2, 'IN', 'FLOAT');
    b.labelPin(x1, 'Y', 'Q1');
    b.labelPin(x2, 'Y', 'Q2');
    const erc = buildNetlist(b.design).erc;
    // at least the open top-level net or the child net must be reported once
    expect(erc.some((m) => m.detail?.id === 'undrivenInput' || m.detail?.id === 'singlePinNet' || /FLOAT/.test(m.message))).toBe(true);
  });
});
