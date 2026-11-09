/**
 * Small test benches for catalogue parts (used by the catalogue tests and the review tests).
 *
 * `biasBench(partId)` places the part alone and ties pin k (of n) through 1 kΩ to a DC source of
 * (n − k) V, so every pin sees a defined, different voltage: diodes are forward biased, BJTs sit
 * in the active region. Supply pins (type 'power' named V+ / VCC / VDD / VIN / IN / VS) get 12 V
 * and ground-side supply pins (V- / VEE / VSS / GND) 0 V, both through 1 Ω, so ICs run from a
 * real supply. Graphic-only parts (connectors) get 1 MΩ to ground.
 * `measureBench` builds the same bench and returns the netlist build, ready for runAnalyses.
 */
import { getPart } from '../index';
import { DesignBuilder } from '../../model/designkit';
import { buildNetlist, type NetlistBuildEx } from '../../model/netlister';
import type { Design } from '../../model/types';

export function biasBench(partId: string, params: Record<string, string> = {}): Design {
  const def = getPart(partId);
  if (!def) throw new Error(`unknown part ${partId}`);
  const b = new DesignBuilder(partId);
  const h = b.part(partId, `${def.prefix}1`, 0, 0, params);
  const n = def.symbol.pins.length;
  def.symbol.pins.forEach((pin, i) => {
    b.labelPin(h, pin.name, `P${i}`);
    const supply = pin.type === 'power' && /^(V\+|VCC|VDD|VIN|IN|VS\+?)$/i.test(pin.name) ? 12 : pin.type === 'power' && /^(V-|VEE|VSS|GND|VS-)$/i.test(pin.name) ? 0 : null;
    const r = b.part('basic/resistor', `RB${i}`, 2000 + i * 300, 1000, { value: !def.toSpice ? '1M' : supply !== null ? '1' : '1k' });
    b.labelPin(r, '1', `P${i}`);
    const g = b.part('sources/ground', `GB${i}`, 2000 + i * 300 + 200, 1400);
    if (def.toSpice) {
      const v = b.part('sources/dc-voltage', `VB${i}`, 2000 + i * 300 + 100, 1200, { value: String(supply ?? n - i) });
      b.connect(r, '2', v, '+');
      b.connect(v, '-', g, '1');
    } else {
      b.connect(r, '2', g, '1');
    }
  });
  return b.design;
}

export function measureBench(partId: string, params: Record<string, string> = {}): NetlistBuildEx {
  return buildNetlist(biasBench(partId, params), { includeAnalysis: false });
}
