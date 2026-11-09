/**
 * The circuit on the system clipboard: the private format and the HTML form round trip a real
 * circuit, and judgeClipboard decides what a paste can do (circuit, picture only, damaged, nothing)
 * without pasting anything.
 */
import { describe, expect, it } from 'vitest';
import { getPart } from '../library';
import { runAnalyses } from '../sim';
import { encodePng } from '../util/png';
import { copyItems, pasteItems } from '../ui/store/designOps';
import type { SelItem } from '../ui/store/types';
import { DesignBuilder } from './designkit';
import { buildNetlist } from './netlister';
import { buildSnippet, encodeSnippet, SnippetError, type SnippetData } from './snippet';
import {
  CLIPBOARD_HTML_ATTRIBUTE,
  CLIPBOARD_MAGIC,
  CLIPBOARD_PRIVATE_FORMAT,
  CLIPBOARD_WEB_FORMAT,
  base64ToBytes,
  bytesToBase64,
  circuitFromHtml,
  circuitHtml,
  circuitText,
  decodeCircuitClipboard,
  encodeCircuitClipboard,
  judgeClipboard,
} from './clipboardCircuit';
import type { Design } from './types';

/** 12 V divider with a global parameter and a label. */
function divider(): Design {
  const b = new DesignBuilder('Bộ chia áp');
  const v1 = b.part('sources/dc-voltage', 'V1', 100, 200, { value: '12' });
  const r1 = b.part('basic/resistor', 'R1', 250, 130, { value: '{Rtop}' }, { rotation: 90 });
  const r2 = b.part('basic/resistor', 'R2', 250, 270, { value: '4.7k' }, { rotation: 90 });
  b.part('sources/ground', 'GND1', 100, 330);
  b.wire(b.pin(v1, '+'), { x: 100, y: 100 }, b.pin(r1, '1'));
  b.connect(r1, '2', r2, '1');
  b.wire(b.pin(r2, '2'), { x: 250, y: 330 }, { x: 100, y: 330 });
  b.wire(b.pin(v1, '-'), { x: 100, y: 330 });
  b.label('OUT', 250, 200);
  b.design.variables = { Rtop: '10k' };
  b.design.analysis = { active: 'op', specs: { op: { type: 'op' } } };
  return b.design;
}

const everything = (d: Design): SelItem[] => {
  const s = d.sheets[0];
  return [...s.parts.map((p) => ({ kind: 'part' as const, id: p.id })), ...s.wires.map((w) => ({ kind: 'wire' as const, id: w.id })), ...s.labels.map((l) => ({ kind: 'label' as const, id: l.id }))];
};

const src = divider();
const data: SnippetData = buildSnippet(src, copyItems(src, 'sheet1', everything(src), getPart)!, new Date('2026-11-10T08:00:00Z'));
const picture = encodePng(4, 3, new Uint8Array(48).fill(255));
/** what a clipboard does to a picture: a PNG without any text chunk */
const plainPicture = picture;
/** a snippet PNG that still has its chunk */
const snippetPicture = encodeSnippet(picture, data);

function v(design: Design, node: string): number {
  const build = buildNetlist(design, { includeAnalysis: false });
  expect(build.erc.filter((m) => m.severity === 'error')).toEqual([]);
  const [r] = runAnalyses({ ...build.netlist, analyses: [{ type: 'op' }] });
  return r.scalars![`V(${node})`];
}

describe('the private format', () => {
  it('has the formats named for the two clipboards', () => {
    expect(CLIPBOARD_PRIVATE_FORMAT).toBe('application/x-machsim-circuit');
    expect(CLIPBOARD_WEB_FORMAT).toBe(`web ${CLIPBOARD_PRIVATE_FORMAT}`);
  });

  it('is a magic line followed by the snippet JSON, in UTF-8', () => {
    const bytes = encodeCircuitClipboard(data);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith(`${CLIPBOARD_MAGIC}\n{`)).toBe(true);
    expect(JSON.parse(text.slice(CLIPBOARD_MAGIC.length + 1)).format).toBe('machsim-snippet');
    // the Vietnamese title survives the byte round trip
    expect(decodeCircuitClipboard(bytes).title).toBe('Bộ chia áp');
  });

  it('round-trips the whole circuit, parameters included', () => {
    const back = decodeCircuitClipboard(encodeCircuitClipboard(data));
    expect(back).toEqual(data);
    expect(back.variables).toEqual({ Rtop: '10k' });
    expect(back.fragment.parts.map((p) => p.refdes).sort()).toEqual(['GND1', 'R1', 'R2', 'V1']);
  });

  it('what comes back is a circuit that simulates like the one that went in', () => {
    const back = decodeCircuitClipboard(encodeCircuitClipboard(data));
    const target = divider();
    const clean = { ...target, sheets: [{ ...target.sheets[0], parts: [], wires: [], labels: [] }], variables: {} };
    const r = pasteItems(clean, 'sheet1', { ...back.fragment, extras: { variables: back.variables } } as never, { x: 0, y: 0 }, getPart, {});
    expect(v(r.design, 'OUT')).toBeCloseTo((12 * 4700) / (10000 + 4700), 6);
  });

  it('accepts text as well as bytes', () => {
    const text = new TextDecoder().decode(encodeCircuitClipboard(data));
    expect(decodeCircuitClipboard(text)).toEqual(data);
  });

  it('says why when it is not a circuit', () => {
    const code = (f: () => unknown): string => {
      try {
        f();
      } catch (e) {
        return e instanceof SnippetError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code(() => decodeCircuitClipboard('hello'))).toBe('no-data');
    expect(code(() => decodeCircuitClipboard(`${CLIPBOARD_MAGIC}\n{not json`))).toBe('damaged');
    expect(code(() => decodeCircuitClipboard(`${CLIPBOARD_MAGIC}\n{"format":"other"}`))).toBe('invalid');
    expect(code(() => decodeCircuitClipboard(`${CLIPBOARD_MAGIC}\n${JSON.stringify({ ...data, version: 99 })}`))).toBe('newer');
  });

  it('base64 helpers round trip binary data of any size', () => {
    const big = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) & 255);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
    expect(bytesToBase64(new Uint8Array(0))).toBe('');
  });
});

describe('the HTML form', () => {
  it('carries the circuit in an attribute next to the picture', () => {
    const html = circuitHtml(data, 'data:image/png;base64,AAAA');
    expect(html).toContain(`${CLIPBOARD_HTML_ATTRIBUTE}="`);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt="MachSim: 4 parts');
    expect(circuitFromHtml(html)).toEqual(data);
  });

  it('works without a picture, and wrapped in the fragment markers a clipboard adds', () => {
    const html = `<html><body><!--StartFragment-->${circuitHtml(data)}<!--EndFragment--></body></html>`;
    expect(circuitFromHtml(html)).toEqual(data);
  });

  it('ignores other HTML and a damaged attribute', () => {
    expect(circuitFromHtml('<p>hello</p>')).toBeNull();
    expect(circuitFromHtml(`<img ${CLIPBOARD_HTML_ATTRIBUTE}="AAAA">`)).toBeNull();
    expect(circuitFromHtml(`<img ${CLIPBOARD_HTML_ATTRIBUTE}="!!!">`)).toBeNull();
  });
});

describe('what a paste would find (before pasting)', () => {
  it('the private format wins over everything else', () => {
    const v = judgeClipboard({ privateBytes: encodeCircuitClipboard(data), png: plainPicture, html: '<p>x</p>', text: 'x' });
    expect(v.kind).toBe('circuit');
    if (v.kind === 'circuit') expect(v.via).toBe('private');
  });

  it('then the circuit in the HTML', () => {
    const v = judgeClipboard({ html: circuitHtml(data), png: plainPicture });
    expect(v).toMatchObject({ kind: 'circuit', via: 'html' });
  });

  it('then a picture that still has its chunk (the snippet PNG itself)', () => {
    expect(judgeClipboard({ png: snippetPicture })).toMatchObject({ kind: 'circuit', via: 'picture' });
  });

  it('then the circuit written out as text', () => {
    expect(judgeClipboard({ text: new TextDecoder().decode(encodeCircuitClipboard(data)) })).toMatchObject({ kind: 'circuit', via: 'text' });
  });

  it('a picture from another program that lost the data is "picture only" - decided before any paste', () => {
    expect(judgeClipboard({ png: plainPicture })).toEqual({ kind: 'picture-only' });
    // and the same when the private format is empty or missing
    expect(judgeClipboard({ png: plainPicture, privateBytes: new Uint8Array(0), html: '<img src="x">' })).toEqual({ kind: 'picture-only' });
  });

  it('a picture whose MachSim data is broken is damaged, with the reason', () => {
    const broken = judgeClipboard({ privateBytes: new TextEncoder().encode(`${CLIPBOARD_MAGIC}\n{oops`), png: plainPicture });
    expect(broken.kind).toBe('damaged');
    if (broken.kind === 'damaged') expect(broken.error.code).toBe('damaged');
    const newer = judgeClipboard({ privateBytes: new TextEncoder().encode(`${CLIPBOARD_MAGIC}\n${JSON.stringify({ ...data, version: 5 })}`) });
    expect(newer).toMatchObject({ kind: 'damaged', error: { code: 'newer' } });
  });

  it('a damaged private format does not hide a good circuit in another form', () => {
    const v = judgeClipboard({ privateBytes: new TextEncoder().encode(`${CLIPBOARD_MAGIC}\n{oops`), html: circuitHtml(data) });
    expect(v).toMatchObject({ kind: 'circuit', via: 'html' });
  });

  it('nothing, text that is not a circuit, and an empty offer', () => {
    expect(judgeClipboard({})).toEqual({ kind: 'nothing' });
    expect(judgeClipboard({ text: 'just some words' })).toEqual({ kind: 'nothing' });
    expect(judgeClipboard({ html: '<b>bold</b>' })).toEqual({ kind: 'nothing' });
  });

  it('a one-line description for the plain-text form', () => {
    expect(circuitText(data)).toBe('MachSim circuit: 4 parts, 4 wires (Bộ chia áp)');
  });
});
