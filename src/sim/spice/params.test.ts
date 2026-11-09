import { describe, expect, it } from 'vitest';
import {
  GLOBAL_NODES_KEY,
  ParamError,
  ParamScope,
  buildParamScope,
  globalNodeSet,
  isFuncKey,
  isReservedParamKey,
  makeFuncKey,
  parseFuncKey,
} from './params';

describe('function keys and reserved keys', () => {
  it('encodes and decodes .func signatures', () => {
    expect(makeFuncKey('f', ['a', 'b'])).toBe('f(a,b)');
    expect(makeFuncKey('g', [])).toBe('g()');
    expect(parseFuncKey('f(a, b)')).toEqual({ name: 'f', args: ['a', 'b'] });
    expect(parseFuncKey('g()')).toEqual({ name: 'g', args: [] });
    expect(parseFuncKey('f(1x)')).toBeUndefined();
    expect(parseFuncKey('plain')).toBeUndefined();
    expect(isFuncKey('f(x)')).toBe(true);
    expect(isReservedParamKey(GLOBAL_NODES_KEY)).toBe(true);
    expect(isReservedParamKey('r1')).toBe(false);
  });

  it('collects global nodes, always including ground', () => {
    expect([...globalNodeSet({})].sort()).toEqual(['0', 'gnd']);
    expect([...globalNodeSet({ [GLOBAL_NODES_KEY]: 'VCC  vee' })].sort()).toEqual(['0', 'gnd', 'vcc', 'vee']);
  });
});

describe('parameter scopes', () => {
  it('evaluates in dependency order with functions defined first', () => {
    const s = buildParamScope({ total: '{sq(a) + b}', b: 'a*2', a: 3, 'sq(x)': 'x*x', [GLOBAL_NODES_KEY]: 'vcc' });
    expect(s.ownParams()).toEqual({ a: 3, b: 6, total: 15 });
    expect(s.getParam('TOTAL')).toBe(15);
    expect(s.getFunction('SQ')?.args).toEqual(['x']);
  });

  it('applies overrides and inherits from the parent scope', () => {
    const parent = buildParamScope({ k: 10 });
    const child = buildParamScope({ g: '1', h: 'g*k', p: 'q' }, parent, new Map([['g', 4], ['q', 7]]));
    expect(child.ownParams()).toEqual({ g: 4, h: 40, p: 7, q: 7 });
    expect(child.getParam('k')).toBe(10);
    expect(child.hasOwnParam('k')).toBe(false);
  });

  it('scopes function bodies lexically', () => {
    const outer = buildParamScope({ k: 2, 'scale(x)': 'k*x' });
    const inner = buildParamScope({ k: 100, v: 'scale(3)' }, outer);
    expect(inner.getParam('v')).toBe(6);
  });

  it('reports cycles, undefined names and bad signatures', () => {
    const fail = (table: Record<string, number | string>, re: RegExp, param?: string) => {
      let err: unknown;
      try {
        buildParamScope(table);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ParamError);
      expect((err as Error).message).toMatch(re);
      if (param) expect((err as ParamError).param).toBe(param);
    };
    fail({ a: 'b+1', b: 'c', c: 'a' }, /circular parameter definition: a -> b -> c -> a/, 'a');
    fail({ a: 'zz*2' }, /parameter 'a': undefined parameter 'zz'/, 'a');
    fail({ 'f(1)': 'x' }, /invalid function signature/);
    fail({ a: '1 +' }, /parameter 'a'/);
    fail({ a: 'V(x)' }, /not constant/);
  });

  it('evaluates expressions with delimiters and rejects NaN', () => {
    const s = new ParamScope();
    s.setParam('R', 50);
    expect(s.evaluate('{r*2}')).toBe(100);
    expect(s.evaluate("'r/2'")).toBe(25);
    expect(() => s.evaluate('0/0')).toThrow(/NaN/);
    expect(s.tryEvaluate('nope')).toBeUndefined();
  });
});
