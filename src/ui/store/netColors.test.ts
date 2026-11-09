/**
 * Net settings follow the NET, not the wires (round 4 step 4).
 *
 * The Net settings dialog colours the wires a net had when it was opened. That is not what a
 * learner means by "this net is red": a wire drawn into the net afterwards has to be red too, and
 * renaming the net's label must take its colour (and its PCB properties) along.
 */
import { describe, expect, it } from 'vitest';
import { newDesign, type Design, type Wire } from '../../model/types';
import { applyNetColors, mergeNetSettings, netSettings, setNetSettings } from '../../model/netSettings';
import { followNetColors, netWiresOf, renameNetAcrossSettings } from './netColors';
import { testLookup } from './testParts';
import { createEditor } from './editorStore';

const wire = (id: string, x1: number, y1: number, x2: number, y2: number): Wire => ({ id, points: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });

/**
 * Two wires meeting end to end at (100, 100) with a label "OUT" on the first one, plus a separate
 * net with its own wire.
 */
function design(): Design {
  const d = newDesign('Nets');
  d.sheets[0].wires = [wire('w1', 60, 100, 100, 100), wire('wother', 60, 200, 100, 200)];
  d.sheets[0].labels = [
    { id: 'l1', x: 60, y: 100, name: 'OUT', rotation: 0 },
    { id: 'l2', x: 60, y: 200, name: 'IN', rotation: 0 },
  ];
  return d;
}

describe('a net colour applies to every wire of the net', () => {
  it('colours the wires the net has, and leaves the other net alone', () => {
    const d = setNetSettings(design(), 'OUT', { color: '#ff0000' });
    const out = followNetColors(d, testLookup);
    expect(out.sheets[0].wires.find((w) => w.id === 'w1')?.color).toBe('#ff0000');
    expect(out.sheets[0].wires.find((w) => w.id === 'wother')?.color).toBeUndefined();
  });

  it('a wire drawn into the net later gets the colour (the point of the feature)', () => {
    const d = setNetSettings(design(), 'OUT', { color: '#ff0000' });
    const painted = followNetColors(d, testLookup);
    // the learner extends the net: a new wire from (100,100) onwards
    const grown: Design = { ...painted, sheets: [{ ...painted.sheets[0], wires: [...painted.sheets[0].wires, wire('w2', 100, 100, 160, 100)] }] };
    const after = followNetColors(grown, testLookup);
    expect(after.sheets[0].wires.find((w) => w.id === 'w2')?.color).toBe('#ff0000');
  });

  it('is a no-op (same object) for a design with no coloured net', () => {
    const d = design();
    expect(followNetColors(d, testLookup)).toBe(d);
    // and when every wire already carries the colour
    const once = followNetColors(setNetSettings(d, 'OUT', { color: '#123456' }), testLookup);
    expect(followNetColors(once, testLookup)).toBe(once);
  });

  it('matches the net name without case, like Design.nets itself', () => {
    const d = setNetSettings(design(), 'out', { color: '#00ff00' });
    expect(followNetColors(d, testLookup).sheets[0].wires[0].color).toBe('#00ff00');
  });

  it('applyNetColors also reaches the sheets of a child design', () => {
    const d = setNetSettings(design(), 'OUT', { color: '#0000ff' });
    const child = { id: 'c1', kind: 'subcircuit' as const, name: 'SC', sheets: [{ ...design().sheets[0], id: 'cs1' }], variables: {} };
    const withChild: Design = { ...d, children: [child] };
    const nets = netWiresOf(withChild, testLookup);
    const out = applyNetColors(withChild, nets);
    expect(out.children?.[0].sheets[0].wires.find((w) => w.id === 'w1')?.color).toBe('#0000ff');
  });
});

describe('renaming a net carries its settings', () => {
  it('moves colour and PCB properties to the new name', () => {
    const d = setNetSettings(design(), 'OUT', { color: '#ff0000', traceWidth: 0.6 });
    const after = renameNetAcrossSettings(d, 'OUT', 'VOUT');
    expect(netSettings(after, 'OUT')).toBeUndefined();
    expect(netSettings(after, 'VOUT')).toEqual({ color: '#ff0000', traceWidth: 0.6 });
  });

  it('merges into an existing entry (a rename onto another net), the renamed net winning', () => {
    let d = setNetSettings(design(), 'OUT', { color: '#ff0000' });
    d = setNetSettings(d, 'VOUT', { color: '#00ff00', clearance: 0.3 });
    const after = mergeNetSettings(d, 'OUT', 'VOUT');
    expect(netSettings(after, 'VOUT')).toEqual({ color: '#ff0000', clearance: 0.3 });
    expect(netSettings(after, 'OUT')).toBeUndefined();
  });

  it('does nothing when the old name has no settings or the names are the same net', () => {
    const d = setNetSettings(design(), 'OUT', { color: '#ff0000' });
    expect(renameNetAcrossSettings(d, 'IN', 'ZZZ')).toBe(d);
    expect(renameNetAcrossSettings(d, 'OUT', 'out')).toBe(d);
  });
});

describe('the editor store applies both rules on every edit', () => {
  it('renaming the last label of a net carries the settings, and the new net gets the colour', () => {
    const store = createEditor({ lookup: testLookup });
    store.actions.loadDesign(setNetSettings(design(), 'OUT', { color: '#ff0000' }), 'nets.msim', true);
    // the colour reached the wire through commit()
    expect(store.getState().design.sheets[0].wires.find((w) => w.id === 'w1')?.color).toBe('#ff0000');
    store.actions.updateLabel('l1', { name: 'VOUT' });
    const d = store.getState().design;
    expect(netSettings(d, 'VOUT')).toEqual({ color: '#ff0000' });
    expect(netSettings(d, 'OUT')).toBeUndefined();
    expect(d.sheets[0].wires.find((w) => w.id === 'w1')?.color).toBe('#ff0000');
  });

  it('keeps the settings behind when another label still carries the old name', () => {
    const store = createEditor({ lookup: testLookup });
    const d0 = setNetSettings(design(), 'OUT', { color: '#ff0000' });
    store.actions.loadDesign({ ...d0, sheets: [{ ...d0.sheets[0], labels: [...d0.sheets[0].labels, { id: 'l3', x: 100, y: 100, name: 'OUT', rotation: 0 }] }] }, 'nets.msim', true);
    store.actions.updateLabel('l1', { name: 'VOUT' });
    const d = store.getState().design;
    expect(netSettings(d, 'OUT')).toEqual({ color: '#ff0000' });
    expect(netSettings(d, 'VOUT')).toBeUndefined();
  });
});
