import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseXml } from '../util/xml';
import { DesignFormatError, parseDesign, serializeDesign } from './serialize';
import { designToXml, isDesignXml, itemName, valueToXml, xmlToDesign, xmlToRaw, xmlToValue } from './xmlDesign';

const EXAMPLES = fileURLToPath(new URL('../../examples/', import.meta.url));
const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.msim')).sort();

describe('MachSim XML exchange format', () => {
  it('maps every JSON value type and reads it back exactly', () => {
    const value = {
      text: 'R1 & <b> "x"',
      empty: '',
      spaces: '  two  ',
      lines: 'a\r\nb\tc\n',
      control: 'bell\u0007 and ￿',
      num: -1.25e-7,
      int: 42,
      tiny: 5e-324,
      yes: true,
      no: false,
      nothing: null,
      list: [1, 'two', [3], { four: 4 }, []],
      obj: {},
      'A.scale': '500m',
      '1': 'digit key',
      'with space': 'x',
      entry: 'named entry',
      xmlns: 'reserved',
      sheets: [{ id: 's1' }],
      children: [{ id: 'c1' }],
      entries: ['e'],
    };
    const xml = valueToXml(value, 'root');
    const back = xmlToValue(parseXml(xml));
    expect(JSON.stringify(back)).toBe(JSON.stringify(value));
    expect(xml).toContain('<A.scale>500m</A.scale>');
    expect(xml).toContain('<entry key="1">digit key</entry>');
    expect(xml).toContain('<entry key="entry">named entry</entry>');
    expect(xml).toContain('<sheets type="array">');
    expect(xml).toContain('<sheet>');
    expect(xml).toContain('<child>');
    expect(xml).toContain('<entries type="array">');
    expect(xml).toContain('<num type="number">-1.25e-7</num>');
    expect(xml).toContain('<control encoding="json">');
    expect(xml).toContain('&#13;');
  });

  it('names array items after the array', () => {
    expect(['sheets', 'parts', 'wires', 'points', 'children', 'entries', 'options', 'status', 'x'].map(itemName)).toEqual(['sheet', 'part', 'wire', 'point', 'child', 'item', 'option', 'item', 'item']);
  });

  for (const f of files) {
    it(`${f}: lossless round trip with the .msim JSON`, () => {
      const json = readFileSync(EXAMPLES + f, 'utf8');
      const design = parseDesign(json);
      const xml = designToXml(design);
      expect(isDesignXml(xml)).toBe(true);
      // the raw object is identical, member order included
      expect(JSON.stringify(xmlToRaw(xml))).toBe(JSON.stringify(design));
      // and it loads to the same design
      expect(serializeDesign(xmlToDesign(xml))).toBe(serializeDesign(design));
    });
  }

  it('reports malformed and foreign XML as design-format errors with the line', () => {
    const issue = (text: string) => {
      try {
        xmlToDesign(text);
        return '';
      } catch (e) {
        expect(e).toBeInstanceOf(DesignFormatError);
        return (e as DesignFormatError).issues[0];
      }
    };
    expect(issue('<machsim-design>\n<title>a</titel>\n</machsim-design>')).toMatch(/line 2: <\/titel> closes <title>/);
    expect(issue('<svg/>')).toMatch(/not a MachSim design XML file/);
    expect(issue('<machsim-design><version type="number">two</version></machsim-design>')).toMatch(/expected a number/);
    expect(issue('<machsim-design xml-format="7"/>')).toMatch(/newer MachSim XML format/);
    expect(isDesignXml('{"format":"machsim-design"}')).toBe(false);
  });

  it('accepts hand-written files with comments, CDATA and CRLF line ends', () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<!-- written by hand -->',
      '<machsim-design>',
      '  <format>machsim-design</format>',
      '  <version type="number">2</version>',
      '  <title><![CDATA[R & C]]></title>',
      '  <sheets type="array"><sheet><id>s</id><name>Trang 1</name>',
      '    <parts type="array"><part><id>p1</id><partId>basic/resistor</partId><refdes>R1</refdes><x type="number">0</x><y type="number">0</y><params><value>4,7k</value></params></part></parts>',
      '  </sheet></sheets>',
      '</machsim-design>',
    ].join('\r\n');
    const d = xmlToDesign(xml);
    expect(d.title).toBe('R & C');
    expect(d.sheets[0].name).toBe('Trang 1');
    expect(d.sheets[0].parts[0].params).toEqual({ value: '4,7k' });
    expect(d.sheets[0].parts[0].rotation).toBe(0);
  });
});
