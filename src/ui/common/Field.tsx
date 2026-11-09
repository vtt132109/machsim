/**
 * Form fields with a local draft that commit on Enter / blur (Esc reverts), inline validation and
 * an optional unit suffix and hint line. Used by the properties panel and dialogs.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './common.css';
import { t } from '../../i18n';

export interface CommitFieldProps {
  label: ReactNode;
  value: string;
  onCommit: (value: string) => void;
  /** error message for a draft value, or null */
  validate?: (value: string) => string | null;
  unit?: string;
  /** hint under the field (string or function of the draft) */
  hint?: ReactNode | ((draft: string) => ReactNode);
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  /** extra element after the input (e.g. reset button) */
  trailing?: ReactNode;
  /** layout: label left of the input (default) or above it */
  layout?: 'row' | 'stack';
  inputClassName?: string;
  'aria-describedby'?: string;
}

export function CommitField({
  label,
  value,
  onCommit,
  validate,
  unit,
  hint,
  multiline,
  rows = 4,
  placeholder,
  disabled,
  trailing,
  layout = 'row',
  inputClassName,
}: CommitFieldProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const error = validate ? validate(draft) : null;
  const commit = () => {
    if (draft === value) return;
    if (error) {
      setDraft(value);
      return;
    }
    onCommit(draft);
  };
  const hintNode = typeof hint === 'function' ? hint(draft) : hint;
  const describedBy = [error ? errId : '', hintNode ? hintId : ''].filter(Boolean).join(' ') || undefined;

  const common = {
    id,
    value: draft,
    placeholder,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
    className: `ms-input ${inputClassName ?? ''}`,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      commit();
    },
  };

  return (
    <div className={`ms-cfield ms-cfield-${layout}`}>
      <label htmlFor={id} className="ms-cfield-label">
        {label}
      </label>
      <div className="ms-cfield-control">
        {multiline ? (
          <textarea
            {...common}
            rows={rows}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setDraft(value);
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                commit();
              }
            }}
          />
        ) : (
          <input
            {...common}
            type="text"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                if (draft !== value) {
                  e.preventDefault();
                  e.stopPropagation();
                  setDraft(value);
                }
              }
            }}
          />
        )}
        {unit ? <span className="ms-cfield-unit">{unit}</span> : null}
        {trailing}
      </div>
      {error ? (
        <div id={errId} className="ms-field-error ms-cfield-msg" role="alert">
          {error}
        </div>
      ) : hintNode ? (
        <div id={hintId} className="ms-hint ms-cfield-msg">
          {hintNode}
        </div>
      ) : null}
    </div>
  );
}

export interface SelectFieldProps {
  label: ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  trailing?: ReactNode;
  layout?: 'row' | 'stack';
}

export function SelectField({ label, value, options, onChange, disabled, trailing, layout = 'row' }: SelectFieldProps) {
  const id = useId();
  const known = options.some((o) => o.value === value);
  return (
    <div className={`ms-cfield ms-cfield-${layout}`}>
      <label htmlFor={id} className="ms-cfield-label">
        {label}
      </label>
      <div className="ms-cfield-control">
        <select id={id} className="ms-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {!known ? <option value={value}>{value || t('common.field.none')}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {trailing}
      </div>
    </div>
  );
}

export function CheckField({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="ms-check ms-cfield-check">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

const SWATCHES = ['#1a4fd6', '#c62828', '#2e7d32', '#e8590c', '#6741d9', '#0c8599', '#1d2330', '#c2255c'];

/** Colour picker: swatches + native colour input + optional "default" reset. */
export function ColorField({ label, value, onChange, allowDefault }: { label: ReactNode; value: string | undefined; onChange: (v: string | undefined) => void; allowDefault?: boolean }) {
  const id = useId();
  return (
    <div className="ms-cfield ms-cfield-row">
      <label htmlFor={id} className="ms-cfield-label">
        {label}
      </label>
      <div className="ms-cfield-control ms-swatches" role="group" aria-label={typeof label === 'string' ? label : t('common.colour')}>
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`ms-swatch ${value?.toLowerCase() === c ? 'is-active' : ''}`}
            style={{ background: c }}
            aria-label={t('common.field.colourC', { c: c })}
            aria-pressed={value?.toLowerCase() === c}
            onClick={() => onChange(c)}
          />
        ))}
        <input id={id} type="color" className="ms-color-input" value={value ?? '#1a4fd6'} onChange={(e) => onChange(e.target.value)} aria-label={t('common.field.customColour')} />
        {allowDefault ? (
          <button type="button" className="ms-btn ms-btn-small" disabled={value === undefined} onClick={() => onChange(undefined)}>
            {t('common.field.default')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
