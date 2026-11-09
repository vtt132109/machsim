import { describe, expect, it } from 'vitest';
import { CardError, isNumberWord, parseNumberWord, splitLogicalLines, stripInlineComment, tokenValue, tokenizeCard } from './lexer';

describe('inline comments', () => {
  it('strips ;, " $ " and " //" comments but keeps $ node names, braces and quotes', () => {
    expect(stripInlineComment('R1 a b 1k ; note')).toBe('R1 a b 1k ');
    expect(stripInlineComment('R1 a b 1k $ note')).toBe('R1 a b 1k ');
    expect(stripInlineComment('R1 a b 1k // note')).toBe('R1 a b 1k ');
    expect(stripInlineComment('R1 $N_0001 $G_DPWR 1k')).toBe('R1 $N_0001 $G_DPWR 1k');
    expect(stripInlineComment('B1 a 0 V={a;b} ; c')).toBe('B1 a 0 V={a;b} ');
    expect(stripInlineComment(".include 'x;y.lib' ; c")).toBe(".include 'x;y.lib' ");
    expect(stripInlineComment('.include "lib//a.lib"')).toBe('.include "lib//a.lib"');
    expect(stripInlineComment('R1 a b 1k$')).toBe('R1 a b 1k$');
  });
});

describe('logical lines', () => {
  it('joins continuations, skips comments and reports orphan continuations', () => {
    const errors: [number, string][] = [];
    const { title, lines } = splitLogicalLines(
      'Title line\r\n+ orphan\r\nR1 a b\r\n* comment\r\n\r\n+ 1k\r\n*@machsim analysis {"type":"op"}\r\n+ 2\r\n.end',
      'f.cir',
      true,
      (line, msg) => errors.push([line, msg]),
    );
    expect(title).toBe('Title line');
    expect(lines).toEqual([
      { text: 'R1 a b 1k', line: 3, file: 'f.cir' },
      { text: 'analysis {"type":"op"}', line: 7, file: 'f.cir', pragma: true },
      { text: '.end', line: 9, file: 'f.cir' },
    ]);
    expect(errors).toEqual([
      [2, 'continuation line without a preceding card'],
      [8, 'continuation line without a preceding card'],
    ]);
  });

  it('treats the first line as a card when there is no title', () => {
    const { title, lines } = splitLogicalLines('﻿R1 a b 1', undefined, false, () => {});
    expect(title).toBeUndefined();
    expect(lines.map((l) => l.text)).toEqual(['R1 a b 1']);
  });
});

describe('card tokens', () => {
  it('splits words, punctuation, braces, quotes and strings', () => {
    const toks = tokenizeCard(`V1 in 0 SIN(0, {amp*2}) r='a + b' file="my lib.lib" [x]`);
    expect(toks.map((t) => [t.t, t.v])).toEqual([
      ['word', 'V1'],
      ['word', 'in'],
      ['word', '0'],
      ['word', 'SIN'],
      ['(', '('],
      ['word', '0'],
      [',', ','],
      ['brace', 'amp*2'],
      [')', ')'],
      ['word', 'r'],
      ['=', '='],
      ['quote', 'a + b'],
      ['word', 'file'],
      ['=', '='],
      ['string', 'my lib.lib'],
      ['[', '['],
      ['word', 'x'],
      [']', ']'],
    ]);
    const nested = tokenizeCard('B1 a 0 V={max({x}, 2)}');
    expect(nested[5]).toMatchObject({ t: 'brace', v: 'max({x}, 2)', pos: 9, end: 22 });
  });

  it('rejects unbalanced delimiters', () => {
    expect(() => tokenizeCard('R1 a b {x')).toThrow(CardError);
    expect(() => tokenizeCard('R1 a b x}')).toThrow(/unbalanced '}'/);
    expect(() => tokenizeCard("R1 a b 'x")).toThrow(/unbalanced ' quote/);
    expect(() => tokenizeCard('R1 a b {}')).not.toThrow();
    expect(() => tokenValue(tokenizeCard('{}')[0])).toThrow(/empty expression/);
  });
});

describe('numeric words', () => {
  it('reads SPICE numbers, units and RKM codes', () => {
    expect(parseNumberWord('1k')).toBe(1000);
    expect(parseNumberWord('2.2uF')).toBe(2.2e-6);
    expect(parseNumberWord('10MEG')).toBe(1e7);
    expect(parseNumberWord('5V')).toBe(5);
    expect(parseNumberWord('-3.3')).toBe(-3.3);
    expect(parseNumberWord('1e-3')).toBe(1e-3);
    expect(parseNumberWord('4k7')).toBe(4700);
    expect(parseNumberWord('2R2')).toBe(2.2);
    expect(parseNumberWord('4n7')).toBe(4.7e-9);
    expect(parseNumberWord('1meg5')).toBe(1.5e6);
    expect(parseNumberWord('4k7', false)).toBeUndefined();
  });

  it('leaves names alone', () => {
    for (const w of ['rval', '2N2222', '1N4148', 'V(1)', 'k', '1.2.3', 'x1k']) expect(parseNumberWord(w)).toBeUndefined();
    expect(isNumberWord('3n')).toBe(true);
    expect(isNumberWord('abc')).toBe(false);
  });

  it('interprets value tokens', () => {
    const [w, b, q, n] = tokenizeCard("1k {a+1} 'b*2' name");
    expect(tokenValue(w)).toEqual({ num: 1000 });
    expect(tokenValue(b)).toEqual({ expr: 'a+1' });
    expect(tokenValue(q)).toEqual({ expr: 'b*2' });
    expect(tokenValue(n)).toEqual({ expr: 'name' });
    expect(tokenValue(tokenizeCard('(')[0])).toBeUndefined();
  });
});
