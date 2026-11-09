/**
 * Form controls of the analysis setup dialog. Numeric fields keep a text draft (user number
 * syntax, util/units parseUserNumber) and only report parseable, in-range values; cross-field
 * problems come from `validateSpec` as `issues` and are shown under the field.
 */

import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { isCompleteUserNumber, parseUserNumber, splitUserNumberList } from '../../util/units';
import type { SpecIssue } from './specs';
import { toUserText } from './specs';
import { t } from '../../i18n';

function IssueList({ issues, id }: { issues?: readonly SpecIssue[]; id?: string }) {
  if (!issues || !issues.length) return null;
  return (
    <span id={id} className="msa-issues">
      {issues.map((i, k) => (
        <span key={k} className={i.severity === 'error' ? 'msa-error' : 'msa-warning'}>
          {i.message}
        </span>
      ))}
    </span>
  );
}

export interface NumFieldProps {
  label: ReactNode;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  unit?: string;
  /** blank text means "not set" (onChange(undefined)) */
  optional?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
  /** show / edit the value × 100 (tolerances) */
  percent?: boolean;
  placeholder?: string;
  help?: string;
  issues?: readonly SpecIssue[];
  disabled?: boolean;
  /** input width in characters */
  size?: number;
}

/** Parse field text; returns the value or an error message. */
export function parseFieldText(text: string, o: Pick<NumFieldProps, 'optional' | 'integer' | 'min' | 'max' | 'exclusiveMin' | 'percent'>): { value?: number; error?: string } {
  const txt = text.trim();
  if (!txt) return o.optional ? { value: undefined } : { error: t('analysis.fields.required') };
  const numText = txt.replace(/%\s*$/, '');
  let v = parseUserNumber(numText);
  if (!Number.isFinite(v) || !isCompleteUserNumber(numText)) return { error: t('analysis.fields.notANumber') };
  if (o.percent) v /= 100;
  if (o.integer && !Number.isInteger(v)) return { error: t('analysis.fields.mustBeAWholeNumber') };
  const shown = (x: number) => toUserText(o.percent ? x * 100 : x);
  if (o.min !== undefined && (o.exclusiveMin ? !(v > o.min) : v < o.min)) return { error: t(o.exclusiveMin ? 'analysis.fields.mustBeGreater' : 'analysis.fields.mustBeAtLeast', { shown: shown(o.min) }) };
  if (o.max !== undefined && v > o.max) return { error: t('analysis.fields.mustBeAtMostShown', { shown: shown(o.max) }) };
  return { value: v };
}

export function NumField(p: NumFieldProps) {
  const id = useId();
  const text = p.value === undefined ? '' : toUserText(p.percent ? Number((p.value * 100).toPrecision(12)) : p.value);
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);
  const parsed = parseFieldText(draft, p);
  const localError: SpecIssue[] = parsed.error ? [{ path: '', message: parsed.error, severity: 'error' }] : [];
  const shown = editing && parsed.error ? localError : p.issues ?? [];
  const hasError = shown.some((i) => i.severity === 'error');
  const commit = () => {
    setEditing(false);
    if (parsed.error) {
      setDraft(text);
      return;
    }
    if (parsed.value !== p.value) p.onChange(parsed.value);
  };
  return (
    <div className={`msa-field${hasError ? ' msa-field-error' : ''}`}>
      <label htmlFor={id} className="msa-label" title={p.help}>
        {p.label}
      </label>
      <span className="msa-control">
        <input
          id={id}
          className="msa-input msa-num"
          value={draft}
          size={p.size ?? 10}
          placeholder={p.placeholder}
          disabled={p.disabled}
          spellCheck={false}
          aria-invalid={hasError}
          aria-describedby={shown.length ? `${id}-issues` : undefined}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setEditing(true);
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape' && editing) {
              e.stopPropagation();
              setDraft(text);
              setEditing(false);
            }
          }}
        />
        {p.unit && <span className="msa-unit">{p.unit}</span>}
      </span>
      <IssueList issues={shown} id={`${id}-issues`} />
    </div>
  );
}

export interface TextFieldProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** suggestions offered in a datalist (free text is still allowed) */
  suggestions?: readonly string[];
  placeholder?: string;
  help?: string;
  issues?: readonly SpecIssue[];
  size?: number;
}

/** Free-text field with suggestions; commits on blur / Enter. */
export function TextField(p: TextFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(p.value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(p.value);
  }, [p.value, editing]);
  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    if (t !== p.value) p.onChange(t);
  };
  const hasError = !!p.issues?.some((i) => i.severity === 'error');
  return (
    <div className={`msa-field${hasError ? ' msa-field-error' : ''}`}>
      <label htmlFor={id} className="msa-label" title={p.help}>
        {p.label}
      </label>
      <span className="msa-control">
        <input
          id={id}
          className="msa-input"
          value={draft}
          size={p.size ?? 14}
          list={p.suggestions?.length ? `${id}-list` : undefined}
          placeholder={p.placeholder}
          spellCheck={false}
          aria-invalid={hasError}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setEditing(true);
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        {p.suggestions && p.suggestions.length > 0 && (
          <datalist id={`${id}-list`}>
            {p.suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        )}
      </span>
      <IssueList issues={p.issues} />
    </div>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, help, issues }: { label: ReactNode; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; help?: string; issues?: readonly SpecIssue[] }) {
  const id = useId();
  return (
    <div className="msa-field">
      <label htmlFor={id} className="msa-label" title={help}>
        {label}
      </label>
      <span className="msa-control">
        <select id={id} className="msa-input msa-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </span>
      <IssueList issues={issues} />
    </div>
  );
}

export function CheckField({ label, checked, onChange, help }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <label className="msa-check" title={help}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

/**
 * Parse "1k, 2.2k 4.7k; 10k" into numbers; returns the values or the first bad token. A single
 * comma between digits is a decimal comma ("1,5k 2,2k"), see util/units splitUserNumberList.
 */
export function parseNumberList(text: string): { values: number[]; error?: string } {
  const tokens = splitUserNumberList(text);
  const values: number[] = [];
  for (const tok of tokens) {
    const v = parseUserNumber(tok);
    if (!Number.isFinite(v) || !isCompleteUserNumber(tok)) return { values, error: t('analysis.fields.tokIsNotANumber', { tok: tok }) };
    values.push(v);
  }
  return { values };
}

export interface ListFieldProps {
  label: ReactNode;
  values: readonly number[];
  onChange: (values: number[]) => void;
  unit?: string;
  issues?: readonly SpecIssue[];
  help?: string;
}

/** Comma / space separated list of numbers. */
export function ListField(p: ListFieldProps) {
  const id = useId();
  const text = p.values.map(toUserText).join(', ');
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);
  const parsed = parseNumberList(draft);
  const shown: readonly SpecIssue[] = editing && parsed.error ? [{ path: '', message: parsed.error, severity: 'error' }] : p.issues ?? [];
  const commit = () => {
    setEditing(false);
    if (parsed.error) {
      setDraft(text);
      return;
    }
    if (parsed.values.join() !== p.values.join()) p.onChange(parsed.values);
  };
  return (
    <div className={`msa-field msa-field-wide${shown.some((i) => i.severity === 'error') ? ' msa-field-error' : ''}`}>
      <label htmlFor={id} className="msa-label" title={p.help}>
        {p.label}
        {p.unit ? ` (${p.unit})` : ''}
      </label>
      <textarea
        id={id}
        className="msa-input msa-listinput"
        rows={2}
        value={draft}
        spellCheck={false}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
      />
      <span className="msa-hint">{t('analysis.fields.nValues', { n: p.values.length })}</span>
      <IssueList issues={shown} />
    </div>
  );
}

export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="msa-row">{children}</div>;
}

export function Group({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <fieldset className="msa-group">
      <legend>{title}</legend>
      {actions && <div className="msa-group-actions">{actions}</div>}
      {children}
    </fieldset>
  );
}

export { IssueList };
