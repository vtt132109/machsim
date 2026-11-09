/**
 * Step-by-step assembly guide (Vietnamese + English) for a breadboard layout.
 *
 * Order follows good bench practice: board and rails first, ICs and other packages that
 * straddle the channel, transistors and regulators, then resistors, capacitors, diodes and LEDs
 * (each with its value, colour code / capacitor code and polarity instructions), jumper wires
 * (rail bridges, rail jumpers, signal jumpers), and finally the supplies and instruments on clip
 * leads ("connect the power last") and a closing check against the schematic.
 */

import type { Design, NetlistBuild } from '../model/types';
import { buildNetlist } from '../model/netlister';
import { defaultParams } from '../library';
import { parseUserNumber } from '../util/units';
import type { BreadboardHole, BreadboardLayout } from './types';
import { emptyBreadboard } from './types';
import { compareWithSchematic, type CheckResult, type PhysicalPart } from './compare';
import { boardSpec, holeName, isRailRow, parseStripId } from './geometry';
import { stripOfHole } from './connectivity';
import type { BodyKind } from './leads';
import { bandsText, capacitorCode, electrolyticMarking, formatValue, resistorBands, type BandColor } from './markings';
import { boardKindName, colorNameText, concatText, guideText, joinText, L, pinText, railName, type LocalizedText } from '../i18n/breadboard';
import { partNameText } from '../i18n/library';

export type GuideStepKind = 'intro' | 'rails' | 'part' | 'wire' | 'clip' | 'check';

export interface GuideStep {
  id: string;
  kind: GuideStepKind;
  title: LocalizedText;
  text: LocalizedText;
  /** holes to highlight while the step is shown */
  holes: BreadboardHole[];
  refdes?: string;
  wireId?: string;
  clipId?: string;
}

export interface GuideOptions {
  build?: Pick<NetlistBuild, 'partNets' | 'nets'>;
  /** reuse a circuit check of the same layout */
  check?: CheckResult;
}

/** Nearest named colour of a CSS colour (#rgb / #rrggbb / named basic colours). */
export function cssColorName(css: string): LocalizedText {
  const named: Record<string, string> = { red: '#ff0000', black: '#000000', blue: '#0000ff', yellow: '#ffff00', green: '#008000', orange: '#ffa500', white: '#ffffff', grey: '#808080', gray: '#808080', purple: '#800080', violet: '#7f00ff', brown: '#8b4513' };
  let hex = (named[css.trim().toLowerCase()] ?? css).trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}/i.test(hex)) return L(css, css);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
  let name: BandColor;
  if (light < 0.16) name = 'black';
  else if (sat < 0.2 || max - min < 0.12) name = light > 0.8 ? 'white' : 'grey';
  else {
    const d = max - min;
    let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    if (hue < 15 || hue >= 340) name = 'red';
    else if (hue < 45) name = light < 0.33 ? 'brown' : 'orange';
    else if (hue < 70) name = 'yellow';
    else if (hue < 165) name = 'green';
    else if (hue < 255) name = 'blue';
    else name = 'violet';
  }
  return colorNameText(name);
}

const PART_ORDER: BodyKind[] = [
  'dip',
  'seven-seg',
  'bargraph',
  'to220',
  'to92',
  'pot',
  'trimmer',
  'switch-slide',
  'switch-toggle',
  'push-button',
  'header',
  'crystal',
  'resistor',
  'thermistor',
  'ldr',
  'inductor',
  'fuse',
  'ceramic-cap',
  'electrolytic-cap',
  'diode',
  'led',
  'lamp',
  'buzzer',
  'generic',
];

export function buildGuide(design: Design, layout?: BreadboardLayout, opts: GuideOptions = {}): GuideStep[] {
  const lay = layout ?? design.breadboard ?? emptyBreadboard();
  const build = opts.build ?? buildNetlist(design, { includeAnalysis: false });
  const check = opts.check ?? compareWithSchematic(design, lay, { build });
  const multi = lay.boards.length > 1;
  const hn = (h: BreadboardHole) => holeName(h, multi);
  const netName = (n: string) => check.netDisplay.get(n) ?? n;
  const steps: GuideStep[] = [];

  // ---- intro ----------------------------------------------------------------------------------
  const kinds = [...new Set(lay.boards.map((b) => b.kind))];
  const boardText = kinds.length === 1 && lay.boards.length === 1 ? boardKindName(kinds[0]) : joinText(lay.boards.map((b) => concatText(`${b.id}: `, boardKindName(b.kind))), L('; ', '; '));
  let intro = guideText.intro(boardText, lay.placements.length, lay.wires.length, lay.clips.length);
  if (lay.boards.some((b) => b.splitRails && boardSpec(b.kind).hasRails)) intro = concatText(intro, ' ', guideText.splitNote);
  steps.push({ id: 'intro', kind: 'intro', title: guideText.introTitle, text: intro, holes: [] });

  // ---- rails ----------------------------------------------------------------------------------
  const railLines: LocalizedText[] = [];
  const railHoles: BreadboardHole[] = [];
  for (const [strip, netId] of check.connectivity.stripNet) {
    const info = parseStripId(strip);
    if (!info || info.kind !== 'rail' || !info.rail) continue;
    const nets = check.schematicNets.get(netId) ?? [];
    if (!nets.length) continue;
    const code = `${multi ? `${info.board}/` : ''}${info.rail}${info.half ? ` (${info.half})` : ''}`;
    railLines.push(guideText.railUse(railName(info.rail, info.half), code, nets.map(netName).join(', ')));
    for (const l of check.connectivity.nets[netId].leads) if (isRailRow(l.hole.row)) railHoles.push(l.hole);
  }
  steps.push({ id: 'rails', kind: 'rails', title: guideText.railsTitle, text: railLines.length ? joinText(railLines, L(' ', ' ')) : guideText.noRails, holes: railHoles });

  // ---- parts ----------------------------------------------------------------------------------
  const placed = lay.placements
    .map((pl) => ({ pl, part: check.parts.get(pl.refdes) }))
    .filter((x): x is { pl: (typeof lay.placements)[number]; part: PhysicalPart } => x.part !== undefined && x.part.map.mounting === 'board');
  const rank = (b: BodyKind) => {
    const i = PART_ORDER.indexOf(b);
    return i < 0 ? PART_ORDER.length : i;
  };
  placed.sort((a, b) => rank(a.part.map.body) - rank(b.part.map.body) || a.pl.refdes.localeCompare(b.pl.refdes, undefined, { numeric: true }));
  for (const { pl, part } of placed) {
    const params = { ...defaultParams(part.def), ...part.inst.params };
    const holes = part.map.leads.map((l) => pl.pins[l.key]).filter((h): h is BreadboardHole => h !== undefined);
    const holeList = guideText.holesJoin(holes.map(hn));
    const at = (key: string) => (pl.pins[key] ? hn(pl.pins[key]) : '?');
    const { refdes } = pl;
    let text: LocalizedText;
    switch (part.map.body) {
      case 'dip': {
        const n = part.map.dipPins ?? part.map.leads.length;
        text = guideText.dip(refdes, part.map.label, n, at(part.map.leads[0].key), at(part.map.leads[n - 1].key));
        break;
      }
      case 'seven-seg':
        text = part.map.straddle ? guideText.sevenSeg(refdes, part.def.symbol.pins.some((p) => p.name === 'CA'), at(part.map.leads[0].key)) : guideText.generic(refdes, partNameText(part.def), holeList);
        break;
      case 'bargraph':
        text = guideText.barGraph(refdes, at(part.map.leads[0].key));
        break;
      case 'to92':
      case 'to220': {
        const order = part.map.pinout ?? part.map.leads.map((l) => l.key);
        text = guideText.transistor(refdes, partNameText(part.def), order.join('-'), order.map(at).join(' – '), part.map.body === 'to92');
        break;
      }
      case 'resistor': {
        const ohms = parseUserNumber(params.value ?? '');
        const code = resistorBands(ohms, { tolerance: parseUserNumber(params.tolerance ?? '5') });
        text = guideText.resistor(refdes, formatValue(ohms, 'Ω'), code ? bandsText(code) : L('?', '?'), holeList);
        break;
      }
      case 'ceramic-cap': {
        const f = parseUserNumber(params.value ?? '');
        const code = capacitorCode(f, parseUserNumber(params.tolerance ?? ''));
        text = guideText.ceramic(refdes, formatValue(f, 'F'), code?.full ?? '?', holeList);
        break;
      }
      case 'electrolytic-cap': {
        const f = parseUserNumber(params.value ?? '');
        const pol = part.map.polarity;
        text = pol
          ? guideText.electrolytic(refdes, electrolyticMarking(f, parseUserNumber(params.vrating ?? '')), at(pol.plus), at(pol.minus))
          : guideText.generic(refdes, partNameText(part.def), holeList);
        break;
      }
      case 'led': {
        const pol = part.map.polarity!;
        if (pol.kind === 'led') text = guideText.led(refdes, colorNameText((params.color ?? 'red').toLowerCase()), at(pol.plus), at(pol.minus));
        else text = guideText.diode(refdes, partNameText(part.def), at(pol.plus), at(pol.minus));
        break;
      }
      case 'diode': {
        const pol = part.map.polarity;
        text = pol ? guideText.diode(refdes, partNameText(part.def), at(pol.plus), at(pol.minus)) : guideText.generic(refdes, partNameText(part.def), holeList);
        break;
      }
      case 'pot':
        text = guideText.pot(refdes, formatValue(parseUserNumber(params.value ?? ''), 'Ω'), part.map.leads.map((l) => `${l.key}: ${at(l.key)}`).join(', '));
        break;
      default: {
        const list = part.map.leads.map((l) => `${l.key}: ${at(l.key)}`).join(', ');
        text = guideText.generic(refdes, partNameText(part.def), list);
      }
    }
    steps.push({ id: `part:${refdes}`, kind: 'part', title: guideText.partTitle(refdes, partNameText(part.def)), text, holes, refdes });
  }

  // ---- wires ----------------------------------------------------------------------------------
  const conn = check.connectivity;
  const netsOfHole = (h: BreadboardHole): string[] => {
    const s = stripOfHole(conn.boards, h);
    const id = s ? conn.stripNet.get(s) : undefined;
    return id === undefined ? [] : (check.schematicNets.get(id) ?? []);
  };
  const wireRank = (w: (typeof lay.wires)[number]) => (isRailRow(w.from.row) && isRailRow(w.to.row) ? 0 : isRailRow(w.from.row) || isRailRow(w.to.row) ? 1 : 2);
  const wires = [...lay.wires].sort((a, b) => wireRank(a) - wireRank(b));
  for (const w of wires) {
    const r = wireRank(w);
    const nets = netsOfHole(w.from);
    const net = nets.map(netName).join(', ');
    const purpose = r === 0 ? guideText.wireRailBridge : r === 1 ? (net ? guideText.wireToRail(net) : L('', '')) : net ? guideText.wireNet(net) : L('', '');
    steps.push({
      id: `wire:${w.id}`,
      kind: 'wire',
      title: concatText(guideText.wiresTitle, ` ${w.id}`),
      text: guideText.wire(cssColorName(w.color), hn(w.from), hn(w.to), purpose),
      holes: [w.from, w.to],
      wireId: w.id,
    });
  }

  // ---- clips (power last) ---------------------------------------------------------------------
  for (const c of lay.clips) {
    const part = check.parts.get(c.refdes);
    steps.push({
      id: `clip:${c.id}`,
      kind: 'clip',
      title: guideText.clipsTitle,
      text: concatText(guideText.clip(c.refdes, part ? partNameText(part.def) : c.refdes, pinText(c.refdes, c.pin), hn(c.hole), cssColorName(c.color)), ' ', guideText.powerLast),
      holes: [c.hole],
      refdes: c.refdes,
      clipId: c.id,
    });
  }

  // ---- final check ----------------------------------------------------------------------------
  steps.push({
    id: 'check',
    kind: 'check',
    title: guideText.checkTitle,
    text: check.ok ? guideText.checkOk : guideText.checkBad(check.counts.errors, check.counts.warnings),
    holes: check.issues.flatMap((i) => i.holes),
  });
  return steps;
}
