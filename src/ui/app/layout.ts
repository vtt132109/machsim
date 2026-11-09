/**
 * Responsive side panels (pure): fits the component browser and the properties panel to the
 * window so the centre view — schematic or 3D breadboard — always keeps most of the width.
 *
 * Rules, applied to the panels the user has open:
 *   1. the centre keeps at least CENTER_SHARE of the window (BREADBOARD_SHARE for 3D views);
 *   2. open panels shrink proportionally, down to their minimum widths;
 *   3. if that is not enough, the properties panel and then the browser collapse to a slim rail
 *      (a button that shows the panel as an overlay above the centre).
 * Stored preferences are never changed: widening the window restores the panels.
 */
import { PANEL_LIMITS } from './prefs';

export const RAIL_WIDTH = 26;
export const SPLITTER_WIDTH = 5;
/** Share of the window the centre keeps: schematic / other (3D) main views. */
export const CENTER_SHARE = 0.58;
export const BREADBOARD_SHARE = 0.7;
const CENTER_MIN_PX = { schematic: 420, other: 560 };

export type PanelMode = 'open' | 'rail' | 'closed';

export interface SidePanelsInput {
  browserOpen: boolean;
  propertiesOpen: boolean;
  browserWidth: number;
  propertiesWidth: number;
}

export interface SideLayout {
  browser: PanelMode;
  browserWidth: number;
  properties: PanelMode;
  propertiesWidth: number;
  /** width left for the centre view */
  center: number;
}

export function fitSidePanels(windowWidth: number, ui: SidePanelsInput, view: 'schematic' | 'other' = 'schematic'): SideLayout {
  const share = view === 'schematic' ? CENTER_SHARE : BREADBOARD_SHARE;
  const centerMin = Math.max(CENTER_MIN_PX[view], Math.round(windowWidth * share));
  const avail = Math.max(0, windowWidth - centerMin);
  let browser: PanelMode = ui.browserOpen ? 'open' : 'closed';
  let properties: PanelMode = ui.propertiesOpen ? 'open' : 'closed';
  let bw = ui.browserWidth;
  let pw = ui.propertiesWidth;
  const used = () => (browser === 'open' ? bw + SPLITTER_WIDTH : browser === 'rail' ? RAIL_WIDTH : 0) + (properties === 'open' ? pw + SPLITTER_WIDTH : properties === 'rail' ? RAIL_WIDTH : 0);

  if (used() > avail) {
    // 2. shrink proportionally towards the minimum widths
    const open = (browser === 'open' ? bw : 0) + (properties === 'open' ? pw : 0);
    const room = avail - (browser === 'open' ? SPLITTER_WIDTH : 0) - (properties === 'open' ? SPLITTER_WIDTH : 0);
    const f = open > 0 ? Math.max(0, room) / open : 1;
    if (browser === 'open') bw = Math.max(PANEL_LIMITS.browserWidth.min, Math.floor(bw * f));
    if (properties === 'open') pw = Math.max(PANEL_LIMITS.propertiesWidth.min, Math.floor(pw * f));
  }
  if (used() > avail && properties === 'open') {
    // 3. properties -> rail; give the browser what is left (it may grow back towards its width)
    properties = 'rail';
    if (browser === 'open') bw = Math.max(PANEL_LIMITS.browserWidth.min, Math.min(ui.browserWidth, avail - RAIL_WIDTH - SPLITTER_WIDTH));
  }
  if (used() > avail && browser === 'open') browser = 'rail';
  return { browser, browserWidth: bw, properties, propertiesWidth: pw, center: Math.max(0, windowWidth - used()) };
}

/** Largest share of the window height the bottom dock may take: schematic / 3D views. */
export const DOCK_SHARE = 0.32;
export const DOCK_SHARE_3D = 0.24;

/** Dock height limited to a share of the window height (the centre view keeps the rest). */
export function fitDockHeight(windowHeight: number, dockHeight: number, view: 'schematic' | 'other' = 'schematic'): number {
  const share = view === 'schematic' ? DOCK_SHARE : DOCK_SHARE_3D;
  return Math.max(PANEL_LIMITS.dockHeight.min, Math.min(dockHeight, Math.round(windowHeight * share)));
}
