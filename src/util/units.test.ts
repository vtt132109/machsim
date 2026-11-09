/**
 * User number syntax (src/util/units.ts): engineering suffixes, the Vietnamese decimal comma, the
 * RKM code of IEC 60062 and the leftover check that keeps a mistyped value from simulating as
 * another number.
 */
import { describe, expect, it } from 'vitest';
import { formatEng, isCompleteUserNumber, isPlainUserNumber, parseSpiceNumber, parseUserNumber, splitUserNumberList, toSpiceNumber, userNumberLeftover } from './units';

describe('parseUserNumber', () => {
  it('reads suffixes case-sensitively (M = mega, m = milli) and ignores unit words', () => {
    expect(parseUserNumber('4.7k')).toBeCloseTo(4700, 9);
    expect(parseUserNumber('1M')).toBe(1e6);
    expect(parseUserNumber('1m')).toBe(1e-3);
    expect(parseUserNumber('2meg')).toBe(2e6);
    expect(parseUserNumber('10 µF')).toBeCloseTo(10e-6, 15);
    expect(parseUserNumber('1e-3 s')).toBe(1e-3);
    expect(parseUserNumber('10R')).toBe(10);
    expect(parseUserNumber('5mil')).toBeCloseTo(127e-6, 12);
    expect(parseUserNumber('abc')).toBeNaN();
  });

  it('reads a decimal comma like a decimal point', () => {
    expect(parseUserNumber('4,7k')).toBeCloseTo(4700, 9);
    expect(parseUserNumber('2,2u')).toBeCloseTo(2.2e-6, 15);
    expect(parseUserNumber('1,5')).toBeCloseTo(1.5, 12);
    expect(parseUserNumber('0,47 µF')).toBeCloseTo(0.47e-6, 15);
    expect(parseUserNumber('-1,25 V')).toBeCloseTo(-1.25, 12);
  });

  it('reads the RKM code (letter in place of the decimal point)', () => {
    expect(parseUserNumber('4k7')).toBeCloseTo(4700, 9);
    expect(parseUserNumber('4K7')).toBeCloseTo(4700, 9);
    expect(parseUserNumber('2u2')).toBeCloseTo(2.2e-6, 15);
    expect(parseUserNumber('2µ2F')).toBeCloseTo(2.2e-6, 15);
    expect(parseUserNumber('4R7')).toBeCloseTo(4.7, 12);
    expect(parseUserNumber('1M5')).toBeCloseTo(1.5e6, 6);
    expect(parseUserNumber('3n3')).toBeCloseTo(3.3e-9, 18);
    expect(parseUserNumber('4p7')).toBeCloseTo(4.7e-12, 21);
    expect(parseUserNumber('1m5')).toBeCloseTo(1.5e-3, 12);
    expect(parseUserNumber('1meg5')).toBeCloseTo(1.5e6, 6);
  });

  it('still reads SPICE-style texts written by toSpiceNumber exactly', () => {
    for (const v of [1500, 2.2e-6, 1e6, 47e-12, 0.001, 330]) expect(parseUserNumber(toSpiceNumber(v))).toBeCloseTo(v, 15);
  });
});

describe('unread text after a number', () => {
  it('is empty for complete numbers with a unit word', () => {
    for (const ok of ['4.7k', '4,7k', '4k7', '10 µF', '1e-3 s', '25°C', '5 V/div', '2.2 kOhm', '100 %', '1meg']) {
      expect({ ok, rest: userNumberLeftover(ok) }).toEqual({ ok, rest: '' });
      expect(isCompleteUserNumber(ok)).toBe(true);
    }
  });

  it('names what was not read', () => {
    expect(userNumberLeftover('4.7.3k')).toBe('.3k');
    expect(userNumberLeftover('1,2,3')).toBe(',3');
    expect(userNumberLeftover('5V1')).toBe('V1');
    expect(userNumberLeftover('4.7k 5%')).toBe('5%');
    expect(userNumberLeftover('x')).toBeNull();
    expect(isCompleteUserNumber('2N2222')).toBe(false);
  });

  it('plain numbers have no operators (design variables treat those as expressions)', () => {
    expect(isPlainUserNumber('4,7k')).toBe(true);
    expect(isPlainUserNumber('4k7')).toBe(true);
    expect(isPlainUserNumber('10 µF')).toBe(true);
    expect(isPlainUserNumber('2*gain')).toBe(false);
    expect(isPlainUserNumber('1/2')).toBe(false);
    expect(isPlainUserNumber('Rload')).toBe(false);
  });
});

describe('lists of user numbers', () => {
  it('splits on whitespace, semicolons and list commas, keeping decimal commas', () => {
    expect(splitUserNumberList('1k, 2.2k 4.7k;10k')).toEqual(['1k', '2.2k', '4.7k', '10k']);
    expect(splitUserNumberList('1,5k 2,2k')).toEqual(['1,5k', '2,2k']);
    expect(splitUserNumberList('1,5,10')).toEqual(['1', '5', '10']);
    expect(splitUserNumberList('1k,2k')).toEqual(['1k', '2k']);
    expect(splitUserNumberList('  ')).toEqual([]);
  });
});

describe('SPICE numbers and formatting are unchanged', () => {
  it('parseSpiceNumber keeps SPICE rules (M = milli, comma is not a decimal separator)', () => {
    expect(parseSpiceNumber('1M')).toBe(1e-3);
    expect(parseSpiceNumber('1MEG')).toBe(1e6);
    expect(parseSpiceNumber('4,7')).toBe(4);
  });
  it('formatEng uses a decimal point', () => {
    expect(formatEng(4700, 'Ω')).toBe('4.7 kΩ');
  });
});
