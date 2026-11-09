import { describe, expect, it } from 'vitest';
import {
  ExprError,
  builtinFunctionNames,
  calledFunctions,
  compileExpression,
  evaluateExpression,
  formatExpression,
  freeIdentifiers,
  isBuiltinFunction,
  parseExpression,
  resolveExpression,
  signalKey,
  signalName,
  stripExpressionDelimiters,
  type UserFunction,
} from './expr';
import { BOLTZ, CHARGE } from '../device';

const ev = (text: string, params: Record<string, number> = {}, vars?: Record<string, number>) =>
  evaluateExpression(text, { params }, vars);

describe('expression syntax and values', () => {
  it('reads SPICE numbers with suffixes and unit words', () => {
    expect(ev('1k')).toBe(1000);
    expect(ev('2.2u')).toBeCloseTo(2.2e-6, 18);
    expect(ev('1meg')).toBe(1e6);
    expect(ev('1M')).toBeCloseTo(1e-3, 15);
    expect(ev('3mil')).toBeCloseTo(3 * 25.4e-6, 15);
    expect(ev('.5')).toBe(0.5);
    expect(ev('1e-3')).toBe(1e-3);
    expect(ev('10kOhm')).toBe(10000);
    expect(ev('4.7pF')).toBeCloseTo(4.7e-12, 24);
  });

  it('applies C-like precedence with power binding tighter than unary minus', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('-2^2')).toBe(-4);
    expect(ev('2^3^2')).toBe(512);
    expect(ev('2**3')).toBe(8);
    expect(ev('2^-1')).toBe(0.5);
    expect(ev('10 - 4 - 3')).toBe(3);
    expect(ev('24 / 4 / 3')).toBe(2);
    expect(ev('{1 + 1} * 3')).toBe(6);
  });

  it('evaluates comparisons, logic and conditionals', () => {
    expect(ev('3 > 2')).toBe(1);
    expect(ev('3 < 2')).toBe(0);
    expect(ev('2 >= 2 && 1 <= 0')).toBe(0);
    expect(ev('2 == 2 || 0')).toBe(1);
    expect(ev('1 != 1')).toBe(0);
    expect(ev('1 <> 2')).toBe(1);
    expect(ev('!0')).toBe(1);
    expect(ev('!5')).toBe(0);
    expect(ev('1 & 1')).toBe(1);
    expect(ev('0 | 0')).toBe(0);
    expect(ev('1 > 0 ? 10 : 20')).toBe(10);
    expect(ev('0 ? 10 : 0 ? 20 : 30')).toBe(30);
    expect(ev('if(2 > 1, 5, 6)')).toBe(5);
  });

  it('evaluates the built-in functions', () => {
    expect(ev('abs(-3)')).toBe(3);
    expect(ev('sqrt(16)')).toBe(4);
    expect(ev('exp(1)')).toBeCloseTo(Math.E, 14);
    expect(ev('ln(e)')).toBeCloseTo(1, 14);
    expect(ev('log(e^2)')).toBeCloseTo(2, 14);
    expect(ev('log10(1000)')).toBeCloseTo(3, 14);
    expect(ev('sin(pi/2)')).toBeCloseTo(1, 14);
    expect(ev('cos(pi)')).toBeCloseTo(-1, 14);
    expect(ev('tan(pi/4)')).toBeCloseTo(1, 14);
    expect(ev('asin(1)')).toBeCloseTo(Math.PI / 2, 14);
    expect(ev('acos(1)')).toBe(0);
    expect(ev('atan(1)')).toBeCloseTo(Math.PI / 4, 14);
    expect(ev('atan2(1, -1)')).toBeCloseTo((3 * Math.PI) / 4, 14);
    expect(ev('sinh(1)')).toBeCloseTo(Math.sinh(1), 14);
    expect(ev('cosh(1)')).toBeCloseTo(Math.cosh(1), 14);
    expect(ev('tanh(0.5)')).toBeCloseTo(Math.tanh(0.5), 14);
    expect(ev('pow(2, 10)')).toBe(1024);
    expect(ev('pow(-8, 1/3)')).toBeCloseTo(2, 12);
    expect(ev('pwr(-2, 2)')).toBe(4);
    expect(ev('pwrs(-2, 2)')).toBe(-4);
    expect(ev('min(3, -1, 2)')).toBe(-1);
    expect(ev('max(3, -1, 2)')).toBe(3);
    expect(ev('limit(5, 0, 2)')).toBe(2);
    expect(ev('limit(-5, 2, 0)')).toBe(0);
    expect(ev('limit(1.5, 0, 2)')).toBe(1.5);
    expect(ev('floor(-1.5)')).toBe(-2);
    expect(ev('ceil(1.2)')).toBe(2);
    expect(ev('round(2.5)')).toBe(3);
    expect(ev('round(-2.5)')).toBe(-3);
    expect(ev('int(-2.7)')).toBe(-2);
    expect(ev('sgn(-4)')).toBe(-1);
    expect(ev('sgn(0)')).toBe(0);
    expect(ev('u(0.1)')).toBe(1);
    expect(ev('u(0)')).toBe(0);
    expect(ev('uramp(-2)')).toBe(0);
    expect(ev('uramp(3)')).toBe(3);
    expect(ev('db(10)')).toBeCloseTo(20, 12);
  });

  it('interpolates table() and holds the end values', () => {
    expect(ev('table(0.5, 0,0, 1,10, 2,30)')).toBe(5);
    expect(ev('table(1.5, 0,0, 1,10, 2,30)')).toBe(20);
    expect(ev('table(-1, 0,0, 1,10, 2,30)')).toBe(0);
    expect(ev('table(9, 0,0, 1,10, 2,30)')).toBe(30);
    expect(() => ev('table(1, 0, 1, 2)')).toThrow(ExprError);
  });

  it('knows the physical constants and lets parameters shadow them', () => {
    expect(ev('pi')).toBe(Math.PI);
    expect(ev('e')).toBe(Math.E);
    expect(ev('boltz')).toBe(BOLTZ);
    expect(ev('echarge')).toBe(CHARGE);
    expect(ev('pi', { pi: 3 })).toBe(3);
  });

  it('reads parameters case-insensitively and runtime variables from vars', () => {
    expect(ev('Rload * 2', { rload: 50 })).toBe(100);
    expect(ev('time * 2', {}, { time: 0.25 })).toBe(0.5);
    expect(ev('temper')).toBe(27);
    expect(ev('temper + 1', {}, { temper: 100 })).toBe(101);
  });

  it('inlines user functions with lexical scoping', () => {
    const square: UserFunction = { name: 'sq', args: ['x'], body: parseExpression('x*x') };
    const scaled: UserFunction = {
      name: 'scaled',
      args: ['a'],
      body: parseExpression('k*sq(a)'),
      params: { k: 3 },
      funcs: { sq: square },
    };
    expect(evaluateExpression('sq(4) + scaled(2)', { funcs: { sq: square, scaled } })).toBe(16 + 12);
    const rec: UserFunction = { name: 'f', args: ['x'], body: parseExpression('f(x)') };
    expect(() => evaluateExpression('f(1)', { funcs: { f: rec } })).toThrow(/recursive/);
    expect(() => evaluateExpression('sq(1, 2)', { funcs: { sq: square } })).toThrow(/expects 1/);
  });

  it('reports syntax errors with positions', () => {
    const cases: [string, number][] = [
      ['1 +', 3],
      ['(1 + 2', 6],
      ['1 $ 2', 2],
      ['2 3', 2],
    ];
    for (const [text, pos] of cases) {
      let err: unknown;
      try {
        parseExpression(text);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(ExprError);
      expect((err as ExprError).position).toBe(pos);
    }
    expect(() => parseExpression('')).toThrow(/empty/);
    expect(() => ev('foo + 1')).toThrow(/undefined parameter 'foo'/);
    expect(() => ev('nosuch(1)')).toThrow(/unknown function/);
    expect(() => ev('sin(1, 2)')).toThrow(/expects 1/);
    expect(() => parseExpression('I(a,b)')).toThrow(/exactly one/);
  });

  it('strips one level of delimiters only when they enclose the whole text', () => {
    expect(stripExpressionDelimiters(' {a+b} ')).toBe('a+b');
    expect(stripExpressionDelimiters("'a*2'")).toBe('a*2');
    expect(stripExpressionDelimiters('{a}+{b}')).toBe('{a}+{b}');
    expect(stripExpressionDelimiters('a')).toBe('a');
  });

  it('formats expressions so that they parse back to the same tree', () => {
    const texts = [
      '-2^2 + (1 - 3) * 4 / (5 - x)',
      'a - (b - c)',
      'a / (b * c)',
      '(-a)^2',
      '2^(-x)',
      'x > 1 ? (y ? 1 : 2) : -z',
      'V(out,in) * I(V1) + max(a, b, -c)',
      '!(a && b) || c == d',
      'f(1.25e-17, -0.5)',
      '(a ? b : c) + 1',
    ];
    for (const t of texts) {
      const ast = parseExpression(t);
      expect(parseExpression(formatExpression(ast))).toEqual(ast);
    }
  });

  it('lists identifiers and called functions', () => {
    const ast = parseExpression('a*sin(B) + f(c, max(d, 1)) + V(x)');
    expect([...freeIdentifiers(ast)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...calledFunctions(ast)].sort()).toEqual(['f', 'max', 'sin']);
    expect(isBuiltinFunction('TABLE')).toBe(true);
    expect(isBuiltinFunction('if')).toBe(true);
    expect(isBuiltinFunction('foo')).toBe(false);
    expect(builtinFunctionNames()).toContain('uramp');
  });
});

describe('resolution', () => {
  it('folds parameters, normalises ground and maps names', () => {
    const ast = parseExpression('k * V(a, 0) + V(gnd, b) + I(Vs) + V(0)');
    const r = resolveExpression(ast, {
      params: { k: 2 },
      mapNode: (n) => (n === '0' || n.toLowerCase() === 'gnd' ? n : `X1.${n}`),
      mapDevice: (d) => `V.X1.${d}`,
    });
    expect(formatExpression(r)).toBe('2 * V(X1.a) + -V(X1.b) + I(V.X1.Vs) + 0');
  });

  it('keeps unknown identifiers only when allowed', () => {
    const ast = parseExpression('alpha + 1');
    expect(() => resolveExpression(ast)).toThrow(ExprError);
    expect(formatExpression(resolveExpression(ast, { allowUnknownIdentifiers: true }))).toBe('alpha + 1');
    expect(formatExpression(resolveExpression(ast, { variables: ['alpha'] }))).toBe('alpha + 1');
  });

  it('can skip constant folding', () => {
    const ast = parseExpression('1 + 2 * k');
    expect(formatExpression(resolveExpression(ast, { params: { k: 3 }, foldConstants: false }))).toBe('1 + 2 * 3');
    expect(formatExpression(resolveExpression(ast, { params: { k: 3 } }))).toBe('7');
  });
});

describe('compiled expressions and derivatives', () => {
  it('collects signals in first-appearance order', () => {
    const c = compileExpression('V(b) * I(Vsrc) + V(a,b) + V(B)');
    expect(c.signals.map(signalName)).toEqual(['V(b)', 'I(Vsrc)', 'V(a)']);
    expect(c.signals.map(signalKey)).toEqual(['v:b', 'i:vsrc', 'v:a']);
    expect(c.isConstant).toBe(false);
    expect(c.value([2, 3, 5])).toBe(2 * 3 + (5 - 2) + 2);
  });

  it('exposes runtime variables and constant-ness', () => {
    const c = compileExpression('sin(2*pi*1k*time) * temper');
    expect(c.variables).toEqual(['time', 'temper']);
    expect(c.signals).toHaveLength(0);
    expect(c.isConstant).toBe(false);
    expect(c.value(undefined, { time: 0.25e-3, temper: 50 })).toBeCloseTo(50, 12);
    expect(compileExpression('2 * pi').isConstant).toBe(true);
  });

  it('throws when given too few signal values', () => {
    const c = compileExpression('V(a) + V(b)');
    expect(() => c.value([1])).toThrow(/needs 2/);
  });

  const smooth: [string, number[]][] = [
    ['V(a)^3 - 2*V(a)*V(b) + 4', [0.7, -1.3]],
    ['exp(V(a)/0.025) * 1e-14', [0.3, 0]],
    ['V(a) / (1 + V(b)^2)', [1.5, 0.4]],
    ['sqrt(V(a)) + ln(V(b))', [2.2, 3.1]],
    ['sin(V(a)) * cos(V(b)) + tan(V(a)*0.3)', [0.4, 1.2]],
    ['atan2(V(a), V(b)) + atan(V(a)) + asin(V(b)/4) + acos(V(a)/3)', [0.8, 1.1]],
    ['sinh(V(a)) + cosh(V(b)) + tanh(V(a)*V(b))', [0.5, -0.6]],
    ['pow(V(a), V(b)) + pwr(V(b), 2.5) + pwrs(V(b), 1.5)', [1.7, -0.9]],
    ['V(a)^2.5 + (-V(b))^3', [1.3, 0.8]],
    ['max(V(a), V(b), 0.1) + min(V(a), 2*V(b))', [0.4, 0.9]],
    ['limit(V(a)*10, -1, V(b))', [0.05, 2]],
    ['limit(V(a)*10, -1, V(b))', [0.5, 2]],
    ['table(V(a), 0,0, 1,V(b), 2,4)', [0.3, 2.5]],
    ['abs(V(a)-V(b)) + uramp(V(a)) + log10(V(b)) + db(V(a))', [0.7, 0.2]],
    ['V(a) > V(b) ? V(a)^2 : 3*V(b)', [2, 1]],
    ['V(a) > V(b) ? V(a)^2 : 3*V(b)', [1, 2]],
    ['if(V(a) > 0, V(a)*I(Vx), -I(Vx))', [0.5, 0.25]],
    ['V(a,b) * I(Vx) * 1k', [1, 2]],
    ['-V(a) + +V(b) - 2^V(a)', [0.3, 0.6]],
  ];

  it.each(smooth)('gradient of %s matches central finite differences', (text, base) => {
    const c = compileExpression(text);
    const n = c.signals.length;
    const x = Float64Array.from({ length: n }, (_, k) => base[k] ?? 0.5);
    const g = new Float64Array(n);
    const f = c.valueAndGradient(x, g);
    expect(f).toBeCloseTo(c.value(x), 12);
    for (let k = 0; k < n; k++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[k]));
      const xp = Float64Array.from(x);
      const xm = Float64Array.from(x);
      xp[k] += h;
      xm[k] -= h;
      const fd = (c.value(xp) - c.value(xm)) / (2 * h);
      expect(Math.abs(g[k] - fd)).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(fd)));
    }
  });

  it('gives zero derivatives for piecewise-constant functions', () => {
    const c = compileExpression('floor(V(a)) + u(V(a)) + sgn(V(a)) + (V(a) > 1)');
    const g = new Float64Array(1);
    expect(c.valueAndGradient([1.5], g)).toBe(1 + 1 + 1 + 1);
    expect(g[0]).toBe(0);
  });

  it('is reusable across sequential evaluations', () => {
    const c = compileExpression('V(a)*V(a)');
    const g = new Float64Array(1);
    expect(c.valueAndGradient([3], g)).toBe(9);
    expect(g[0]).toBe(6);
    expect(c.valueAndGradient([-2], g)).toBe(4);
    expect(g[0]).toBe(-4);
  });

  it('refuses circuit quantities in evaluateExpression', () => {
    expect(() => evaluateExpression('V(a) + 1')).toThrow(/depends on V\(a\)/);
  });
});
