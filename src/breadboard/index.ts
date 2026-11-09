/**
 * Virtual breadboard — public API.
 *
 * Pure logic (no DOM, usable in workers and tests) is exported from here; the React view is
 * exported from './BreadboardView' (it pulls in three.js and a stylesheet), so import it
 * separately:  import { BreadboardView } from './breadboard/BreadboardView';
 */

export * from './types';
export {
  PITCH,
  TERMINAL_ROWS,
  RAIL_ROWS,
  boardSpec,
  columnX,
  isValidHole,
  holeKey,
  sameHole,
  holeLocal,
  holePosition,
  stripIdOf,
  parseStripId,
  listStrips,
  stripHoles,
  allHoles,
  holeGrid,
  gridToHole,
  nearestHole,
  stepHole,
  holeName,
  parseHoleName,
  describeHole,
  describeStrip,
  boardMap,
  benchBounds,
  type BoardSpec,
  type StripInfo,
  type TerminalRow,
  type RailRow,
} from './geometry';
export { leadMap, logicalPin, placeLeads, rotateOffset, registerPinout, shortLabel, type LeadMap, type LeadTemplate, type BodyKind, type Mounting, type HiddenPin, type PolarityKind, type PlacedLeads } from './leads';
export { computeBreadboardConnectivity, netOfHole, netOfPin, stripOfHole, layoutLeads, pinId, type BreadboardConnectivity, type BbNet, type LeadRef } from './connectivity';
export {
  compareWithSchematic,
  physicalParts,
  expectedNets,
  netDisplayNames,
  resolveSupplyNet,
  type BreadboardIssue,
  type CheckResult,
  type CheckOptions,
  type IssueKind,
  type IssueSeverity,
  type PhysicalPart,
} from './compare';
export { autoPlace, autoPlaceDetailed, detectSupplies, WIRE_COLORS, type AutoPlaceOptions, type AutoPlaceResult, type SupplyPlan } from './autoplace';
export { buildGuide, cssColorName, type GuideStep, type GuideStepKind, type GuideOptions } from './guide';
export * from './markings';
export * from './editing';
export * from './history';
export { tr, L, fill, UI, type Lang, type LocalizedText } from '../i18n/breadboard';
export { EXAMPLE_CIRCUITS, seriesLedCircuit, dividerCircuit, transistorSwitchCircuit, astable555Circuit, invertingAmpCircuit, nandLedCircuit } from './examples';
