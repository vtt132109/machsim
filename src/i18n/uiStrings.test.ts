/**
 * Guard against raw (untranslated) user-visible text in the UI source.
 *
 * Every word a learner reads must come from the message catalogue (src/i18n) through t() or the
 * library / help lookups. This test parses the UI sources with the TypeScript compiler and
 * reports, with file:line, every string literal that would reach the screen:
 *   - JSX text between tags,
 *   - literal values of the attributes title, aria-label, placeholder, alt, label (and a few
 *     more, see TEXT_ATTRS),
 *   - literals rendered directly as a JSX child ({'text'} or {cond ? 'a' : 'b'}),
 *   - literals assigned to UI-text properties (label:, title:, message:, ... see TEXT_PROPS)
 *     or to text variables (`text = 'off'`, see TEXT_NAMES), also through arrow-function bodies,
 *   - prose anywhere: template literals whose text parts hold words (`${name} failed: …`) and
 *     sentence-like string constants ('Up counter'), unless they sit in a code position (keys,
 *     class names, comparisons, log / Error messages, DOM queries; see inCodePosition),
 * in .tsx files and in the .ts modules under TS_DIRS (src/ui, src/breadboard).
 * Pure symbols, numbers and the small explicit allowlist of units and technical tokens below are
 * accepted. Calls (t('key'), formatEng(...)) are never descended into.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/** Units, symbols and technical tokens that are the same in every language. */
export const ALLOWED_LITERALS = new Set<string>([
  // product / formats
  'MachSim', 'SPICE', 'CSV', 'PNG', 'SVG', 'JSON', 'BOM', 'ERC', 'XSPICE', 'Electron',
  // units
  'V', 'mV', 'µV', 'uV', 'kV', 'A', 'mA', 'µA', 'uA', 'W', 'mW', 'Ω', 'kΩ', 'MΩ', 'Hz', 'kHz', 'MHz', 'GHz',
  's', 'ms', 'µs', 'us', 'ns', 'ps', 'F', 'H', 'S', 'dB', 'dBm', 'dBV', 'deg', '°', '°C', 'K', '%', 'rad', 'rad/s',
  'V/div', 'A/div', 's/div', 'div', 'Vpp', 'Vp', 'Vrms', 'RMS', 'DC', 'AC', 'V²/Hz', 'V/√Hz', 'A/√Hz', 'A²/Hz',
  // instrument / analysis tokens
  'Y/T', 'A/B', 'B/A', 'X/Y', 'T1', 'T2', 'T2-T1', 'ΔT', 'Δ', 'X', 'Y', 'Z', 'Q', 'f', 't', 'x', 'y', 'n', 'k', 'M',
  'CH', 'A', 'B', 'C', 'D', 'E', 'G', 'P', 'N', 'L', 'R', 'U', 'Ext', 'EXT', 'COM', 'IN', 'OUT', 'GND', 'VCC', 'VDD',
  'THD', 'SINAD', 'FFT', 'S11', 'S21', 'S12', 'S22', 'Re', 'Im', 'Hex', 'hex', 'Bin', 'Dec', 'Oct', 'Lin', 'Log',
  'Vin', 'Vout', 'Vce', 'Ic', 'Ib', 'Vgs', 'Vds', 'Id', 'Vd', 'Vt', 'Vth', 'Av', 'Rin', 'Rout', 'fT', 'hFE',
  'OK', 'Ctrl', 'Shift', 'Alt', 'Esc', 'Enter', 'Del', 'Tab', 'Space', 'F1', 'F5', 'F6', 'F10',
  'BJT', 'NPN', 'PNP', 'MOSFET', 'JFET', 'CMOS', 'TTL', 'LED', 'V(pn)',
  // matching designer and bench instrument symbols / units
  'ΓS', 'ΓL', 'ZS', 'ZL', 'GS', 'GL', 'ΔV', 'mm', 'mil', 'ps/mm',
  // microcontroller registers and hardware-description languages (same name in both languages)
  'PC', 'SP', 'DPTR', 'PSW', 'ACC', 'SBUF', 'VHDL', 'Verilog',
  'Tiếng Việt', 'English',
]);

/** Attributes whose literal value is shown to the user. */
const TEXT_ATTRS = new Set(['title', 'aria-label', 'ariaLabel', 'placeholder', 'alt', 'label', 'aria-description', 'aria-roledescription', 'aria-valuetext', 'tooltip', 'hint', 'help', 'okLabel', 'cancelLabel', 'emptyText', 'caption', 'heading', 'summary', 'description', 'text', 'what', 'note', 'message']);

/** Object properties whose literal value is shown to the user. */
const TEXT_PROPS = new Set(['label', 'title', 'message', 'placeholder', 'tooltip', 'hint', 'help', 'okLabel', 'cancelLabel', 'heading', 'caption', 'detail', 'emptyText', 'summaryText']);

/**
 * .ts modules (no JSX) that build user-visible text from object literals. (src/model/erc.ts and
 * the netlister keep short technical English messages; the UI shows explainErc() texts instead.)
 */
const TS_DIRS = ['ui', 'breadboard'];

/**
 * Sources that are not UI text: test fixtures and modules whose `label:` / `title:` properties are
 * identifiers (protocol fields, list keys) rather than prose.
 */
const SKIP = [
  'ui/store/testParts.ts',
  'ui/store/designOps.ts',
  'ui/sim/client.ts',
  // runs inside the simulation worker: technical English, explained in the UI by explainSimError
  'ui/sim/host.ts',
  // sample metadata: canonical file titles; the sample browser shows the texts of src/i18n/samples.ts
  'ui/integration/exampleDesigns.ts',
  'ui/integration/sampleDesigns.ts',
  'ui/integration/ladderSamples.ts',
  'ui/integration/electroSamples.ts',
  'ui/integration/sectionSamples.ts',
  'ui/integration/examples.ts',
];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
}

const hasWords = (s: string): boolean => /[A-Za-zÀ-ỹ]{2,}/.test(s);

function allowed(text: string): boolean {
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s || !hasWords(s)) return true;
  if (ALLOWED_LITERALS.has(s)) return true;
  // every word an allowed token: "V/div", "T2-T1", "CH A"
  const words = s.split(/[\s,;:()/=+\-−×·]+/).filter(Boolean);
  return words.every((w) => !hasWords(w) || ALLOWED_LITERALS.has(w));
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

function literalTexts(expr: ts.Expression, out: string[]): void {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) out.push(expr.text);
  else if (ts.isTemplateExpression(expr)) {
    out.push(expr.head.text);
    for (const span of expr.templateSpans) out.push(span.literal.text);
  } else if (ts.isConditionalExpression(expr)) {
    literalTexts(expr.whenTrue, out);
    literalTexts(expr.whenFalse, out);
  } else if (ts.isBinaryExpression(expr)) {
    // the condition of `a === 'x' && …` is code, not text; `a ?? 'Text'`, `'a' + b` are text
    const k = expr.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) literalTexts(expr.right, out);
    else if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.PlusToken) {
      literalTexts(expr.left, out);
      literalTexts(expr.right, out);
    }
  } else if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr)) literalTexts(expr.expression, out);
  // `title: (p) => (p.x ? 'A' : 'B')`
  else if (ts.isArrowFunction(expr) && !ts.isBlock(expr.body)) literalTexts(expr.body, out);
}

/** Variables / assignment targets whose value is shown to the user (`text = 'off'`, `const message = …`). */
const TEXT_NAMES = new Set([...TEXT_PROPS, 'text', 'msg', 'note', 'status', 'what', 'summary']);

/** Calls whose arguments are never UI text (keys, logs, internal errors, DOM queries). */
const CODE_CALLS = /^(t|tIn|tDynamic|hasMessage|L|require|import|querySelector(All)?|getElementById|matchMedia|getPropertyValue|setProperty|addEventListener|removeEventListener|postMessage|getItem|setItem|removeItem|startsWith|endsWith|includes|split|replace|replaceAll|match|matchAll|test|indexOf|lastIndexOf|join|padStart|padEnd|toFixed|toPrecision|toString|localeCompare|createElement|createElementNS|setAttribute|getAttribute|setData|getData|has|get|set|delete)$/;

/** JSX attributes / object properties holding code (classes, ids, styles, geometry, keys). */
const CODE_ATTRS = new Set(['className', 'key', 'id', 'style', 'href', 'src', 'd', 'points', 'transform', 'viewBox', 'htmlFor', 'role', 'type', 'name', 'preserveAspectRatio', 'fill', 'stroke', 'font', 'fontFamily', 'idPrefix', 'aria-labelledby', 'aria-controls', 'aria-describedby', 'aria-activedescendant', 'mime', 'accept', 'file', 'path', 'kind', 'icon', 'command', 'shortcut', 'cls', 'class']);

/** Words that are the same in every language (technical tokens, units, product names). */
const PROSE_ALLOWED = new Set(['rms', 'pp', 'avg', 'min', 'max', 'MachSim', 'msim', 'cir', 'json', 'csv', 'png', 'svg', 'deg', 'div', 'rad', 'dBV', 'dBm', 'Hz', 'kHz', 'MHz', 'GHz', 'Vpp', 'Vrms', 'Vp', 'THD', 'SINAD', 'FFT', 'ERC', 'BOM', 'SPICE', 'XSPICE', 'Ctrl', 'Shift', 'Alt', 'Esc', 'Enter', 'Del', 'Tab', 'Space', 'Hex', 'Bin', 'Dec', 'Oct', 'Lin', 'Log', 'Ext', 'GND', 'VCC', 'VDD', 'COM', 'NPN', 'PNP', 'BJT', 'MOSFET', 'JFET', 'CMOS', 'TTL', 'LED', 'DC', 'AC', 'RMS']);

/** Text fragment that reads as prose: a word of ≥ 3 letters next to whitespace (not a class list). */
function prose(fragments: readonly string[]): string | null {
  const all = fragments.join('\u0000');
  const tokens = all.split(/[\s\u0000]+/).filter(Boolean);
  // CSS class lists ("msi-panel msi-", "ms-tree-row ms-tree-") and code/CSS/markup text
  if (tokens.length && tokens.every((w) => /^-?[a-z0-9]+(-[a-z0-9]*)*-?$/.test(w)) && tokens.some((w) => w.includes('-'))) return null;
  if (/[{}<>;=]|monospace|sans-serif|https?:|\b(translate|rotate|scale|matrix)\(/.test(all)) return null;
  for (const f of fragments) {
    if (!/\s/.test(f)) continue;
    for (const w of f.split(/[\s,;:.()[\]/+\-−×·…'"!?]+/)) {
      if (/^[A-Za-z]{3,}$/.test(w) && !PROSE_ALLOWED.has(w) && !ALLOWED_LITERALS.has(w)) return f;
    }
  }
  return null;
}

function calleeName(call: ts.CallExpression | ts.NewExpression): string {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return '';
}

/** True when `node` sits where strings are code: CODE_CALLS arguments, Error messages, code attributes, comparisons, keys. */
function inCodePosition(node: ts.Node, sf: ts.SourceFile): boolean {
  for (let n: ts.Node = node, p = node.parent; p; n = p, p = p.parent) {
    if (ts.isCallExpression(p) && p.arguments.includes(n as ts.Expression)) {
      const name = calleeName(p);
      if (CODE_CALLS.test(name) || (ts.isPropertyAccessExpression(p.expression) && /^console$/.test(p.expression.expression.getText(sf)))) return true;
    }
    if (ts.isNewExpression(p) && /Error$/.test(calleeName(p))) return true;
    if (ts.isThrowStatement(p)) return true;
    if (ts.isJsxAttribute(p) && CODE_ATTRS.has(p.name.getText(sf))) return true;
    if (ts.isPropertyAssignment(p) && n === p.initializer && CODE_ATTRS.has(p.name.getText(sf).replace(/['"]/g, ''))) return true;
    if (ts.isPropertyAssignment(p) && n === p.name) return true;
    if (ts.isElementAccessExpression(p) && n === p.argumentExpression) return true;
    if (ts.isCaseClause(p) && n === p.expression) return true;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
    if (ts.isLiteralTypeNode(p) || ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isTaggedTemplateExpression(p)) return true;
    if (ts.isStatement(p) || ts.isFunctionLike(p)) return false;
  }
  return false;
}

export function scanSource(file: string, code: string): Finding[] {
  const isTsx = file.endsWith('.tsx');
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Finding[] = [];
  const seen = new Set<string>();
  const push = (node: ts.Node, text: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const key = `${line}:${text.trim()}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ file: relative(SRC, file).split(sep).join('/'), line, text: text.trim().slice(0, 80) });
  };
  const report = (node: ts.Node, text: string) => {
    if (!allowed(text)) push(node, text);
  };
  const visit = (node: ts.Node): void => {
    // prose anywhere: template literals with words ("${name} failed: …") and plain sentences ('Up counter')
    if ((ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) && !inCodePosition(node, sf)) {
      const fragments = ts.isTemplateExpression(node) ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)] : [node.text];
      const hit = prose(fragments);
      if (hit && (ts.isTemplateExpression(node) || /^[A-Za-z][a-z]+ [a-z]{2,}/.test(node.text.trim()))) push(node, hit);
    }
    if ((ts.isVariableDeclaration(node) || (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken].includes(node.operatorToken.kind))) && !inCodePosition(node, sf)) {
      const target = ts.isVariableDeclaration(node) ? node.name : node.left;
      const name = ts.isIdentifier(target) ? target.text : ts.isPropertyAccessExpression(target) ? target.name.text : '';
      const value = ts.isVariableDeclaration(node) ? node.initializer : node.right;
      if (value && TEXT_NAMES.has(name)) {
        const texts: string[] = [];
        literalTexts(value, texts);
        for (const t of texts) report(node, t);
      }
    }
    if (isTsx && ts.isJsxText(node)) report(node, node.text);
    else if (isTsx && ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if ((name === 'options' || name === 'choices') && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrayLiteralExpression(node.initializer.expression)) {
        // [value, label] tuples of select fields
        for (const el of node.initializer.expression.elements) {
          if (ts.isArrayLiteralExpression(el) && el.elements[1]) {
            const texts: string[] = [];
            literalTexts(el.elements[1], texts);
            for (const t of texts) report(el, t);
          }
        }
      }
      if (TEXT_ATTRS.has(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) report(node, node.initializer.text);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          const texts: string[] = [];
          literalTexts(node.initializer.expression, texts);
          for (const t of texts) report(node, t);
        }
      }
    } else if (isTsx && ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const texts: string[] = [];
      literalTexts(node.expression, texts);
      for (const t of texts) report(node, t);
    } else if (ts.isPropertyAssignment(node) && TEXT_PROPS.has(node.name.getText(sf).replace(/['"]/g, ''))) {
      const texts: string[] = [];
      literalTexts(node.initializer, texts);
      for (const t of texts) report(node, t);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function uiSources(): string[] {
  const all: string[] = [];
  walk(SRC, all);
  const tsx = all.filter((p) => p.endsWith('.tsx'));
  const ts_: string[] = [];
  for (const d of TS_DIRS) {
    const p = join(SRC, d);
    if (p.endsWith('.ts')) ts_.push(p);
    else {
      const files: string[] = [];
      walk(p, files);
      ts_.push(...files.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')));
    }
  }
  return [...tsx, ...ts_].filter((p) => !p.includes(`${sep}i18n${sep}`) && !SKIP.some((s) => p.split(sep).join('/').endsWith(s)));
}

describe('UI source has no raw English text', () => {
  it('scanner finds untranslated literals (self-check)', () => {
    const code = `const a = <div title="Open file" aria-label={x ? 'Close' : t('k')}>Hello world {'Run'} {formatEng(1, 'V')}</div>;\nconst m = { label: 'Rename…', id: 'x' };\nconst ok = <b title="V/div">CH A</b>;`;
    const f = scanSource(join(SRC, 'x.tsx'), code).map((x) => x.text);
    expect(f).toEqual(['Open file', 'Close', 'Hello world', 'Run', 'Rename…']);
  });

  it('scanner also finds prose in templates, text variables, arrow bodies and sentence constants', () => {
    const code = [
      "this.msg('info', `${name} cancelled`);",
      "const text = lit.length ? `lit: ${x}` : 'off';",
      "register({ title: (p) => (p.post ? 'Postprocessor' : t('k')) });",
      "const PRESETS = [['up', 'Up counter']];",
      "const el = <Screen ariaLabel={`Bode plot, ${mode}`} />;",
      // code positions are not text
      "const cls = `msi-panel msi-${kind}`; const k = `example.${stem}.title`; if (mode === 'Some value') {}",
      "throw new Error(`minimizeSop: 0..${n} inputs supported`); console.warn('Worker failed to start');",
      "const tr = `translate(${x} ${y}) rotate(${r})`; const u = `${formatEng(v, 'V')} · ${n} µs`;",
    ].join('\n');
    const f = scanSource(join(SRC, 'y.tsx'), code).map((x) => x.text);
    expect(f).toEqual(['cancelled', 'lit:', 'off', 'Postprocessor', 'Up counter', 'Bode plot,']);
  });

  it('every .tsx (and UI .ts module) takes its text from the catalogue', () => {
    const findings = uiSources().flatMap((f) => scanSource(f, readFileSync(f, 'utf8')));
    const report = findings.map((f) => `${f.file}:${f.line}  ${JSON.stringify(f.text)}`).join('\n');
    expect(findings.length, `untranslated UI text:\n${report}`).toBe(0);
  });
});
