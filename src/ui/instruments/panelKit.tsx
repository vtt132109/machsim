/**
 * Shared building blocks of the instrument panels: parameter access, number fields that commit
 * validated user-number text, segmented switches, LCD readouts, 1-2-5 step controls and a
 * HiDPI canvas screen. All controls are controlled components; settings are text values in the
 * instrument's `params` record (user number syntax, see util/units parseUserNumber).
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { formatEng, isCompleteUserNumber, parseUserNumber } from '../../util/units';
import { setupHiDpiCanvas } from '../results/canvas';
import { useElementSize } from '../results/hooks';
import { step125 } from './scope';
import './instruments.css';
import { t } from '../../i18n';
import { formatReading } from './resolution';

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export interface ParamApi {
  /** raw text of a param (default when missing) */
  text(key: string): string;
  /** numeric value (default when missing or invalid) */
  num(key: string, fallback?: number): number;
  set(key: string, value: string): void;
  /** set several keys at once (one onParamsChange call) */
  patch(values: Record<string, string>): void;
}

/** Param accessor with defaults; every write emits the COMPLETE next record. */
export function paramApi(params: Record<string, string>, onChange: (next: Record<string, string>) => void, defaults: Record<string, string>): ParamApi {
  const text = (key: string) => params[key] ?? defaults[key] ?? '';
  return {
    text,
    num: (key, fallback = Number.NaN) => {
      const v = parseUserNumber(text(key));
      if (Number.isFinite(v)) return v;
      const d = parseUserNumber(defaults[key] ?? '');
      return Number.isFinite(d) ? d : fallback;
    },
    set: (key, value) => onChange({ ...params, [key]: value }),
    patch: (values) => onChange({ ...params, ...values }),
  };
}

/** Compact user-number text for a value: 1500 -> "1.5k", 2e-6 -> "2u". */
export function userText(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const table: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'u'],
    [1e-9, 'n'],
    [1e-12, 'p'],
    [1e-15, 'f'],
  ];
  const a = Math.abs(v);
  for (const [mul, suf] of table) {
    if (a >= mul * 0.9999999) return `${Number((v / mul).toPrecision(6))}${suf}`;
  }
  return v.toExponential(4);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export interface NumberFieldProps {
  label: ReactNode;
  /** current param text */
  value: string;
  onCommit: (text: string) => void;
  unit?: string;
  min?: number;
  max?: number;
  /** strict lower bound (value must be > min) */
  exclusiveMin?: boolean;
  integer?: boolean;
  /** accept an empty field (meaning "auto" / "preset") */
  allowBlank?: boolean;
  placeholder?: string;
  title?: string;
  /** input width in characters (default 8) */
  size?: number;
  disabled?: boolean;
}

/** Validate user-number text against bounds; returns an error message or null. */
export function numberFieldError(text: string, o: Pick<NumberFieldProps, 'min' | 'max' | 'exclusiveMin' | 'integer' | 'allowBlank'>): string | null {
  const txt = text.trim();
  if (!txt) return o.allowBlank ? null : t('instruments.panelKit.required');
  const v = parseUserNumber(txt);
  if (!Number.isFinite(v) || !isCompleteUserNumber(txt)) return t('instruments.panelKit.notANumber');
  if (o.integer && !Number.isInteger(v)) return t('instruments.panelKit.mustBeAWholeNumber');
  if (o.min !== undefined && (o.exclusiveMin ? !(v > o.min) : v < o.min)) return t(o.exclusiveMin ? 'instruments.panelKit.mustBeGreater' : 'instruments.panelKit.mustBeAtLeast', { min: userText(o.min) });
  if (o.max !== undefined && v > o.max) return t('instruments.panelKit.mustBeUsertext', { userText: userText(o.max) });
  return null;
}

/** Text input for a number with unit; commits on Enter / blur when valid, Esc reverts. */
export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const [draft, setDraft] = useState(p.value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(p.value);
  }, [p.value, editing]);
  const error = numberFieldError(draft, p);
  const commit = () => {
    setEditing(false);
    if (error) {
      setDraft(p.value);
      return;
    }
    const t = draft.trim();
    if (t !== p.value) p.onCommit(t);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setDraft(p.value);
      setEditing(false);
    }
  };
  return (
    <label className={`msi-field${error && editing ? ' msi-field-invalid' : ''}`} htmlFor={id} title={p.title}>
      <span className="msi-field-label">{p.label}</span>
      <span className="msi-field-box">
        <input
          id={id}
          className="msi-input"
          value={draft}
          size={p.size ?? 8}
          placeholder={p.placeholder}
          disabled={p.disabled}
          spellCheck={false}
          aria-invalid={!!error && editing}
          onFocus={() => setEditing(true)}
          onChange={(e) => {
            setEditing(true);
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={onKey}
        />
        {p.unit && <span className="msi-unit">{p.unit}</span>}
      </span>
      {error && editing && <span className="msi-field-error">{error}</span>}
    </label>
  );
}

export interface SegmentedProps<T extends string> {
  label?: ReactNode;
  value: T;
  options: readonly (readonly [T, ReactNode] | readonly [T, ReactNode, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
  small?: boolean;
  /** tooltip of the whole switch (each option may add its own as the third tuple element) */
  title?: string;
}

/** Row of mutually exclusive push buttons. */
export function Segmented<T extends string>({ label, value, options, onChange, disabled, small, title }: SegmentedProps<T>) {
  return (
    <div className="msi-seg-wrap" title={title}>
      {label && <span className="msi-field-label">{label}</span>}
      <div className={`msi-seg${small ? ' msi-seg-small' : ''}`} role="radiogroup">
        {options.map((o) => (
          <button
            key={o[0]}
            type="button"
            role="radio"
            aria-checked={o[0] === value}
            className={o[0] === value ? 'msi-on' : ''}
            title={o[2]}
            disabled={disabled}
            onClick={() => onChange(o[0])}
          >
            {o[1]}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange, title }: { label: ReactNode; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; title?: string }) {
  const id = useId();
  return (
    <label className="msi-field" htmlFor={id} title={title}>
      <span className="msi-field-label">{label}</span>
      <select id={id} className="msi-select" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`msi-section ${className ?? ''}`}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export interface LcdProps {
  /** digits / text */
  value: string;
  /** unit with prefix, e.g. "mV" */
  unit?: string;
  caption?: ReactNode;
  /** small indicators shown above the digits (e.g. AC, AUTO, OL) */
  flags?: readonly string[];
  size?: 'large' | 'medium' | 'small';
  /** accessible label (defaults to value + unit) */
  ariaLabel?: string;
}

/** Seven-segment style digital readout. */
export function Lcd({ value, unit, caption, flags, size = 'large', ariaLabel }: LcdProps) {
  return (
    <div className={`msi-lcd msi-lcd-${size}`} role="status" aria-live="off" aria-label={ariaLabel ?? `${value} ${unit ?? ''}`.trim()}>
      {flags && flags.length > 0 && (
        <div className="msi-lcd-flags" aria-hidden>
          {flags.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      )}
      <div className="msi-lcd-row" aria-hidden>
        <span className="msi-lcd-digits">{value}</span>
        {unit && <span className="msi-lcd-unit">{unit}</span>}
      </div>
      {caption && <div className="msi-lcd-caption">{caption}</div>}
    </div>
  );
}

/** Readout "label: value" pair for secondary measurements. */
export function Readout({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="msi-readout">
      <span className="msi-readout-label">{label}</span>
      <span className="msi-readout-value">{value}</span>
    </div>
  );
}

export interface StepFieldProps {
  label: ReactNode;
  value: string;
  unit: string;
  onCommit: (text: string) => void;
  min?: number;
  max?: number;
  title?: string;
}

/** Number field with 1-2-5 step buttons (oscilloscope scales). */
export function StepField({ label, value, unit, onCommit, min = 1e-12, max = 1e6, title }: StepFieldProps) {
  const v = parseUserNumber(value);
  const step = (dir: 1 | -1) => {
    const base = Number.isFinite(v) && v > 0 ? v : 1;
    onCommit(userText(step125(base, dir, min, max)));
  };
  return (
    <div className="msi-stepfield">
      <NumberField label={label} value={value} unit={unit} onCommit={onCommit} min={0} exclusiveMin max={max} size={6} title={title} />
      <div className="msi-stepbtns">
        <button type="button" className="msi-btn msi-btn-icon" aria-label={t('instruments.panelKit.decrease', { label: typeof label === 'string' ? label : '' })} title={t('tip.kit.stepDown')} onClick={() => step(-1)}>
          ◀
        </button>
        <button type="button" className="msi-btn msi-btn-icon" aria-label={t('instruments.panelKit.increase', { label: typeof label === 'string' ? label : '' })} title={t('tip.kit.stepUp')} onClick={() => step(1)}>
          ▶
        </button>
      </div>
    </div>
  );
}

/**
 * Format a reading with an engineering prefix, "—" for non-finite values. Values below the
 * solver's noise floor read 0; `step` (the instrument's display resolution) rounds further.
 */
export function eng(v: number, unit: string, digits = 4, step?: number): string {
  return formatReading(v, unit, digits, step);
}

// ---------------------------------------------------------------------------
// Canvas screen
// ---------------------------------------------------------------------------

export interface ScreenProps {
  /** draw callback in CSS pixels; called after every render */
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, canvas: HTMLCanvasElement) => void;
  height: number;
  ariaLabel: string;
  className?: string;
  onPointerDown?: (e: PointerEvent<HTMLCanvasElement>, x: number, y: number) => void;
  onPointerMove?: (e: PointerEvent<HTMLCanvasElement>, x: number, y: number) => void;
  onPointerUp?: (e: PointerEvent<HTMLCanvasElement>, x: number, y: number) => void;
  /** receives the canvas element (PNG export) */
  canvasRef?: (c: HTMLCanvasElement | null) => void;
}

/** Width-filling HiDPI canvas of a fixed CSS height. */
export function Screen({ draw, height, ariaLabel, className, onPointerDown, onPointerMove, onPointerUp, canvasRef }: ScreenProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useElementSize(wrap);
  useEffect(() => {
    canvasRef?.(canvas.current);
    return () => canvasRef?.(null);
  }, [canvasRef]);
  useEffect(() => {
    const c = canvas.current;
    if (!c || size.width < 2) return;
    const ctx = setupHiDpiCanvas(c, size.width, height);
    if (ctx) draw(ctx, size.width, height, c);
  });
  const local = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  return (
    <div ref={wrap} className={`msi-screen ${className ?? ''}`} style={{ height }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={ariaLabel}
        style={{ width: '100%', height }}
        onPointerDown={
          onPointerDown
            ? (e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onPointerDown(e, ...local(e));
              }
            : undefined
        }
        onPointerMove={onPointerMove ? (e) => onPointerMove(e, ...local(e)) : undefined}
        onPointerUp={
          onPointerUp
            ? (e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                onPointerUp(e, ...local(e));
              }
            : undefined
        }
      />
    </div>
  );
}

/** Banner shown when an input channel is not wired. */
export function NotConnected({ what }: { what: string }) {
  return <div className="msi-note">{what}</div>;
}
