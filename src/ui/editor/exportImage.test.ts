import { describe, expect, it } from 'vitest';
import { createEditor } from '../store/editorStore';
import { testLookup } from '../store/testParts';
import { exportArea, sheetToSvg } from './exportImage';
import { PAGE } from './scene';
import { newRung } from '../../ladder/edit';

function demo() {
  const ed = createEditor({ lookup: testLookup });
  ed.actions.placePart('test/resistor', { x: 100, y: 100 });
  ed.actions.placePart('test/resistor', { x: 200, y: 200 }, 90);
  ed.actions.addWire([
    { x: 130, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 170 },
  ]);
  ed.actions.addNetLabel({ x: 160, y: 100 }, 'OUT');
  ed.actions.addProbe('voltage', { x: 170, y: 100 });
  return ed;
}

describe('sheet export', () => {
  it('renders a stand-alone SVG with embedded styles and every object', () => {
    const ed = demo();
    const { design } = ed.getState();
    const r = sheetToSvg(design, design.sheets[0].id, testLookup, { probeValues: { [design.sheets[0].probes[0].id]: '2.5 V' } });
    expect(r.svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(r.svg).toContain('<style>svg{--canvas:#ffffff;');
    expect(r.svg).toContain(".ms-scene text { font-family: var(--font, 'Segoe UI', sans-serif)");
    // two parts with their labels, one wire, the net label, the probe and its value, the title block
    expect(r.svg.match(/class="ms-part"/g)).toHaveLength(2);
    expect(r.svg).toContain('>R1<');
    expect(r.svg).toContain('>R2<');
    expect(r.svg).toContain('>1kΩ<');
    expect(r.svg).toContain('class="ms-wire"');
    expect(r.svg).toContain('points="130,100 200,100 200,170"');
    expect(r.svg).toContain('>OUT<');
    expect(r.svg).toContain('>V Probe1<');
    expect(r.svg).toContain('>2.5 V<');
    expect(r.svg).toContain('class="ms-titleblock"');
    // page area: the drawing frame with a 5 unit margin
    expect(r.area).toEqual({ x: PAGE.x - 5, y: PAGE.y - 5, w: PAGE.w + 10, h: PAGE.h + 10 });
    expect([r.width, r.height]).toEqual([PAGE.w + 10, PAGE.h + 10]);
    expect(r.svg).toContain(`viewBox="${PAGE.x - 5} ${PAGE.y - 5} ${PAGE.w + 10} ${PAGE.h + 10}"`);
  });

  it('content area hugs the items and omits the page frame', () => {
    const ed = demo();
    const { design } = ed.getState();
    const area = exportArea(design, design.sheets[0].id, testLookup, 'content', 10);
    // R1 body starts at x = 70 (bbox -30..30 around 100); R2 rotated 90° spans y 170..230
    expect(area.x).toBe(60);
    expect(area.y + area.h).toBe(240);
    const r = sheetToSvg(design, design.sheets[0].id, testLookup, { area: 'content', margin: 10 });
    expect(r.svg).not.toContain('class="ms-titleblock"');
    expect(r.width).toBe(Math.ceil(area.w));
  });

  it('exports exactly the rectangle the capture tool dragged', () => {
    const ed = demo();
    const { design } = ed.getState();
    const rect = { x: 80, y: 60, w: 120, h: 90 };
    const r = sheetToSvg(design, design.sheets[0].id, testLookup, { rect });
    expect(r.area).toEqual(rect);
    expect([r.width, r.height]).toEqual([120, 90]);
    expect(r.svg).toContain('viewBox="80 60 120 90"');
    // a captured area never draws the page frame or the title block
    expect(r.svg).not.toContain('class="ms-titleblock"');
    // the parts inside the rectangle are still drawn
    expect(r.svg).toContain('ms-part');
  });

  it('draws the rungs of a ladder sheet instead of an empty page', () => {
    const ed = createEditor({ lookup: testLookup });
    ed.actions.addLadderSheet();
    const sheetId = ed.getState().activeSheetId;
    ed.actions.setLadderRungs(sheetId, [newRung('r1', 'I0.0', 'Q0.0')]);
    const { design } = ed.getState();
    const r = sheetToSvg(design, sheetId, testLookup);
    for (const address of ['I0.0', 'Q0.0']) expect(r.svg).toContain(`>${address}<`);
    // the page frame and the title block are still there, so the page prints like any other
    expect(r.svg).toContain('class="ms-titleblock"');
    // 'content' crops to the diagram instead of the whole sheet
    const area = exportArea(design, sheetId, testLookup, 'content', 20);
    expect(area.w).toBeLessThan(600);
    expect(area.h).toBeLessThan(300);
  });

  it('extends the page area to items placed outside the frame', () => {
    const ed = createEditor({ lookup: testLookup });
    ed.actions.placePart('test/resistor', { x: 1500, y: 100 });
    const { design } = ed.getState();
    const area = exportArea(design, design.sheets[0].id, testLookup);
    expect(area.x).toBe(PAGE.x - 5);
    expect(area.x + area.w).toBe(1530 + 20);
  });
});
