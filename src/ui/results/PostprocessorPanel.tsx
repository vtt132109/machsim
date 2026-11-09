/**
 * Postprocessor UI: build vector expressions from the current result's vectors, functions and
 * operators, then add them as plot traces. Syntax is checked live; evaluation errors reported
 * by the grapher are shown next to each defined expression.
 */

import { useRef, useState } from 'react';
import { PostprocessorError, compileExpression } from './postprocessor';
import { t } from '../../i18n';

export interface PostprocessorPanelProps {
  /** vector names available in the active result */
  names: string[];
  expressions: { text: string; error?: string; scalar?: string }[];
  onAdd: (text: string) => void;
  onRemove: (index: number) => void;
}

const FUNCTION_BUTTONS = ['db', 'mag', 'ph', 'real', 'imag', 'deriv', 'integ', 'avg', 'rms', 'max', 'min', 'abs', 'sqrt', 'log10', 'sin', 'cos', 'vs'];

/** Magnetic cores in the result: the references R whose nodes V(R.b) and V(R.h) exist (Jiles–Atherton cores). */
export function bhCores(names: readonly string[]): string[] {
  const lower = new Set(names.map((n) => n.toLowerCase()));
  const out: string[] = [];
  for (const n of names) {
    const m = /^v\((.+)\.b\)$/i.exec(n);
    if (m && lower.has(`v(${m[1].toLowerCase()}.h)`)) out.push(m[1]);
  }
  return out;
}
const OPERATOR_BUTTONS = ['+', '-', '*', '/', '^', '(', ')'];

export function PostprocessorPanel({ names, expressions, onAdd, onRemove }: PostprocessorPanelProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  let syntaxError: string | null = null;
  if (text.trim()) {
    try {
      compileExpression(text);
    } catch (e) {
      syntaxError = e instanceof PostprocessorError ? `${e.message}${e.position >= 0 ? ` (at ${e.position + 1})` : ''}` : String(e);
    }
  }

  const insert = (snippet: string, caretBack = 0) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + snippet + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = start + snippet.length - caretBack;
      el.setSelectionRange(pos, pos);
    });
  };

  const submit = () => {
    if (!text.trim() || syntaxError) return;
    onAdd(text.trim());
    setText('');
  };

  return (
    <section className="msr-post" aria-label={t('common.postprocessor')}>
      <div className="msr-post-row">
        <input
          ref={inputRef}
          className={`msr-post-input${syntaxError ? ' msr-invalid' : ''}`}
          value={text}
          placeholder={t('results.postprocessor.expressionEGDbV')}
          spellCheck={false}
          aria-label={t('results.postprocessor.postprocessorExpression')}
          aria-invalid={!!syntaxError}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <button type="button" className="msr-btn msr-btn-primary" disabled={!text.trim() || !!syntaxError} onClick={submit}>
          {t('results.postprocessor.addTrace')}
        </button>
      </div>
      {syntaxError && <div className="msr-error-text">{syntaxError}</div>}
      <div className="msr-post-palette">
        <div className="msr-post-group" aria-label={t('results.postprocessor.functions')}>
          {FUNCTION_BUTTONS.map((f) => (
            <button key={f} type="button" className="msr-chip" onClick={() => insert(`${f}()`, 1)}>
              {f}()
            </button>
          ))}
          {bhCores(names).map((ref) => (
            <button key={`bh-${ref}`} type="button" className="msr-chip msr-chip-op" title={t('results.postprocessor.bhLoopTip', { ref })} onClick={() => onAdd(`vs(V(${ref}.b), V(${ref}.h))`)}>
              {t('results.postprocessor.bhLoop', { ref })}
            </button>
          ))}
          {OPERATOR_BUTTONS.map((op) => (
            <button key={op} type="button" className="msr-chip msr-chip-op" onClick={() => insert(op)}>
              {op}
            </button>
          ))}
        </div>
        <div className="msr-post-group msr-post-vectors" aria-label={t('results.postprocessor.vectors')}>
          {names.map((n) => (
            <button key={n} type="button" className="msr-chip msr-chip-vec" onClick={() => insert(/[+\-*/^ ]/.test(n) && !/^[A-Za-z]+\(/.test(n) ? `{${n}}` : n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      {expressions.length > 0 && (
        <ul className="msr-post-list">
          {expressions.map((e, i) => (
            <li key={`${e.text}-${i}`}>
              <code>{e.text}</code>
              {e.scalar !== undefined && <span className="msr-post-scalar"> = {e.scalar}</span>}
              {e.error && <span className="msr-error-text"> — {e.error}</span>}
              <button type="button" className="msr-btn msr-btn-small" aria-label={t('results.postprocessor.removeText', { text: e.text })} onClick={() => onRemove(i)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
