/**
 * Logic converter "expression → circuit" on the schematic (loaded on first use by the
 * instrument window): builds the gate circuit (src/model/wizards/logicCircuit.ts), puts it to the
 * right of everything on the converter's sheet as one undo step, and labels the converter's
 * unconnected input pins A… and its OUT pin with the circuit's net names, so the converter's
 * "circuit → truth table" reads the new circuit straight away.
 *
 * Net names are the variable letters and OUT; when the sheet already uses one of them for
 * something else, every name gets the converter's refdes as a prefix (XLC1_A …).
 */
import { localToSheet, samePoint } from '../../model/geometry';
import { logicCircuit, type ProductTerm } from '../../model/wizards/logicCircuit';
import type { NetLabel, Point, Sheet } from '../../model/types';
import { actions, getState, partLookup } from '../store';
import { findPartByRefdes } from '../store/designOps';
import { itemsBounds } from '../store/designOps';
import type { Clipboard } from '../store/types';
import { t } from '../../i18n';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** True when something (wire end or vertex, label, other part pin) touches the point. */
function touched(sheet: Sheet, at: Point, selfId: string): boolean {
  if (sheet.labels.some((l) => samePoint(l, at))) return true;
  if (sheet.wires.some((w) => w.points.some((q) => samePoint(q, at)))) return true;
  for (const part of sheet.parts) {
    if (part.id === selfId) continue;
    const def = partLookup(part.partId);
    if (def?.symbol.pins.some((pin) => samePoint(localToSheet({ x: pin.x, y: pin.y }, part), at))) return true;
  }
  return false;
}

/** Place the circuit; resolves to an error text or null. */
export async function placeLogicCircuitFor(refdes: string, terms: readonly ProductTerm[], n: number, nandOnly: boolean): Promise<string | null> {
  const design = getState().design;
  const found = findPartByRefdes(design, refdes);
  if (!found) return t('instruments.logicConverter.converterGone', { refdes });
  const sheet = design.sheets.find((s) => s.id === found.sheetId) ?? null;
  if (!sheet) return t('instruments.logicConverter.converterGone', { refdes });
  const def = partLookup(found.part.partId);
  if (!def) return t('instruments.logicConverter.converterGone', { refdes });
  const used = new Set(sheet.labels.map((l) => l.name.toUpperCase()));
  const plain = [...LETTERS.slice(0, n), 'OUT'];
  const clash = plain.some((name) => used.has(name) || used.has(`${name}_N`));
  const prefix = clash ? `${refdes}_` : '';
  const names = LETTERS.map((l) => `${prefix}${l}`);
  const output = `${prefix}OUT`;
  const vhigh = Number.parseFloat(found.part.params.vhigh ?? '5') || 5;
  const res = logicCircuit(terms, n, { nandOnly, names, output, vhigh, netPrefix: `${prefix}G` });
  const frag = res.design.sheets[0];
  // to the right of the sheet's content, top aligned
  const b = itemsBounds(sheet, null, partLookup);
  const offset: Point = b ? { x: Math.ceil((b.x + b.w + 80) / 10) * 10, y: Math.ceil(Math.max(b.y, 0) / 10) * 10 } : { x: 100, y: 100 };
  // labels on the converter's free pins (coordinates before the fragment offset)
  const extra: NetLabel[] = [];
  const pinAt = (pin: string): Point | null => {
    const pd = def.symbol.pins.find((x) => x.name === pin);
    return pd ? localToSheet({ x: pd.x, y: pd.y }, found.part) : null;
  };
  const wanted: [string, string][] = [...res.inputs.map((name) => [LETTERS[names.indexOf(name)], name] as [string, string]), ['OUT', output]];
  for (const [pin, net] of wanted) {
    const at = pinAt(pin);
    if (!at || touched(sheet, at, found.part.id)) continue;
    extra.push({ id: `lc${extra.length}`, x: at.x - offset.x, y: at.y - offset.y, name: net, rotation: 0 });
  }
  const clip: Clipboard = {
    parts: frag.parts,
    wires: frag.wires,
    labels: [...frag.labels, ...extra],
    probes: [],
    notes: frag.notes,
    anchor: { x: 0, y: 0 },
  };
  actions.insertFragment(clip, offset, sheet.id);
  const gates = Object.values(res.gates).reduce((a, b2) => a + b2, 0);
  actions.addSimMessage('info', t('instruments.logicConverter.placedMessage', { gates, refdes, out: output }), 'logic');
  return null;
}
