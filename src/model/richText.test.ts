import { describe, expect, it } from 'vitest';
import { imageRefs, parseInline, parseRichText, richTextPlain } from './richText';
import { formulaText, parseFormula } from './formula';

describe('MachSim markup', () => {
  it('parses headings, paragraphs with line breaks, lists, notes, rules, block formulas and images', () => {
    const blocks = parseRichText(`# Bài 1
Đo **điện áp** và *dòng điện*.
Dùng \`XMM1\`.

- một
- hai $R_1$
  tiếp

1. bước một
2. bước hai

> Ghi chú

$$V = I \\cdot R$$
$$
\\frac{a}{b}
$$
---
![sơ đồ](img:img1)`);
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph', 'list', 'list', 'note', 'math', 'math', 'rule', 'image']);
    expect(blocks[0]).toEqual({ kind: 'heading', level: 1, inlines: [{ kind: 'text', text: 'Bài 1' }] });
    expect(blocks[1]).toEqual({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'Đo ' },
        { kind: 'bold', children: [{ kind: 'text', text: 'điện áp' }] },
        { kind: 'text', text: ' và ' },
        { kind: 'italic', children: [{ kind: 'text', text: 'dòng điện' }] },
        { kind: 'text', text: '.' },
        { kind: 'break' },
        { kind: 'text', text: 'Dùng ' },
        { kind: 'code', text: 'XMM1' },
        { kind: 'text', text: '.' },
      ],
    });
    expect(blocks[2]).toEqual({ kind: 'list', ordered: false, items: [[{ kind: 'text', text: 'một' }], [{ kind: 'text', text: 'hai ' }, { kind: 'math', tex: 'R_1' }, { kind: 'text', text: ' tiếp' }]] });
    expect(blocks[3]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[5]).toEqual({ kind: 'math', tex: 'V = I \\cdot R' });
    expect(blocks[6]).toEqual({ kind: 'math', tex: '\\frac{a}{b}' });
    expect(blocks[8]).toEqual({ kind: 'image', id: 'img1', alt: 'sơ đồ' });
    expect(imageRefs(blocks)).toEqual(['img1']);
  });

  it('keeps unclosed markers and escapes as text', () => {
    expect(parseInline('5 * 3 = 15 and 2*x')).toEqual([{ kind: 'text', text: '5 * 3 = 15 and 2*x' }]);
    expect(parseInline('price \\$5 and \\*star\\*')).toEqual([{ kind: 'text', text: 'price $5 and *star*' }]);
    expect(parseInline('**bold *inner* text**')).toEqual([{ kind: 'bold', children: [{ kind: 'text', text: 'bold ' }, { kind: 'italic', children: [{ kind: 'text', text: 'inner' }] }, { kind: 'text', text: ' text' }] }]);
    expect(parseInline('a $x')).toEqual([{ kind: 'text', text: 'a $x' }]);
  });

  it('gives plain text for print and search', () => {
    const text = richTextPlain(parseRichText('## Ohm\n$$I = \\frac{U}{R}$$\n- R_1 = 1k\n- **x**'));
    expect(text).toBe('Ohm\n\nI = U/R\n\n- R_1 = 1k\n- x');
  });
});

describe('formulas', () => {
  it('builds sub / superscripts, fractions, roots, Greek letters and text', () => {
    expect(parseFormula('x^2')).toEqual({ k: 'script', base: { k: 'sym', text: 'x', kind: 'ident' }, sup: { k: 'sym', text: '2', kind: 'num' } });
    const f = parseFormula('V_{out} = \\frac{R_2}{R_1 + R_2} \\cdot V_{in}');
    expect(formulaText(f)).toBe('Vout = R2/(R1 + R2) · Vin');
    expect(formulaText(parseFormula('\\sqrt{2} \\approx 1.414'))).toBe('√2 ≈ 1.414');
    expect(formulaText(parseFormula('f_c = \\frac{1}{2\\pi R C}'))).toBe('fc = 1/(2πRC)');
    expect(formulaText(parseFormula('10\\,\\text{k}\\Omega'))).toBe('10\u2009kΩ');
    expect(formulaText(parseFormula('x_1^2'))).toBe('x1^2');
  });

  it('never throws on bad input', () => {
    for (const bad of ['\\frac{a', '}}x^', '\\unknown{1}', '_', '^^', '\\', '{{{']) expect(() => formulaText(parseFormula(bad))).not.toThrow();
    expect(formulaText(parseFormula('\\unknown'))).toBe('unknown');
  });
});
