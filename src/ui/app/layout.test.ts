/**
 * Responsive side panels: at 1024 × 768 the schematic and especially the 3D breadboard keep most
 * of the window; wide windows keep the user's panel sizes.
 */
import { describe, expect, it } from 'vitest';
import { BREADBOARD_SHARE, CENTER_SHARE, fitDockHeight, fitSidePanels, RAIL_WIDTH } from './layout';
import { PANEL_LIMITS } from './prefs';

const DEFAULT = { browserOpen: true, propertiesOpen: true, browserWidth: 250, propertiesWidth: 290 };

describe('fitSidePanels', () => {
  it('keeps the user sizes when the window is wide', () => {
    const l = fitSidePanels(1600, DEFAULT);
    expect(l).toMatchObject({ browser: 'open', browserWidth: 250, properties: 'open', propertiesWidth: 290 });
    expect(l.center).toBe(1600 - 250 - 290 - 10);
  });

  it('shrinks both panels for the schematic in a 1024 px window', () => {
    const l = fitSidePanels(1024, DEFAULT, 'schematic');
    expect(l.browser).toBe('open');
    expect(l.properties).toBe('open');
    expect(l.browserWidth).toBeLessThan(250);
    expect(l.propertiesWidth).toBeLessThan(290);
    expect(l.browserWidth).toBeGreaterThanOrEqual(PANEL_LIMITS.browserWidth.min);
    expect(l.center / 1024).toBeGreaterThanOrEqual(CENTER_SHARE - 0.001);
  });

  it('collapses the properties panel to a rail for the 3D breadboard in a 1024 px window', () => {
    const l = fitSidePanels(1024, DEFAULT, 'other');
    expect(l.properties).toBe('rail');
    expect(l.browser).toBe('open');
    expect(l.center / 1024).toBeGreaterThanOrEqual(BREADBOARD_SHARE - 0.001);
    expect(l.center).toBe(1024 - l.browserWidth - 5 - RAIL_WIDTH);
  });

  it('collapses both panels when even the rails leave too little room', () => {
    const l = fitSidePanels(700, DEFAULT, 'other');
    expect(l.browser).toBe('rail');
    expect(l.properties).toBe('rail');
    expect(l.center).toBe(700 - 2 * RAIL_WIDTH);
  });

  it('never re-opens a panel the user closed', () => {
    const l = fitSidePanels(1024, { ...DEFAULT, propertiesOpen: false }, 'other');
    expect(l.properties).toBe('closed');
    expect(l.center / 1024).toBeGreaterThanOrEqual(BREADBOARD_SHARE - 0.001);
  });
});

describe('fitDockHeight', () => {
  it('limits the dock to about a third of the window height', () => {
    expect(fitDockHeight(768, 400)).toBe(Math.round(768 * 0.32));
    expect(fitDockHeight(1200, 190)).toBe(190);
    expect(fitDockHeight(200, 190)).toBe(PANEL_LIMITS.dockHeight.min);
  });

  it('leaves the 3D breadboard more height in a 768 px window', () => {
    expect(fitDockHeight(768, 400, 'other')).toBe(Math.round(768 * 0.24));
    expect(fitDockHeight(768, 400, 'other')).toBeLessThan(fitDockHeight(768, 400, 'schematic'));
    expect(fitDockHeight(1200, 190, 'other')).toBe(190);
  });
});
