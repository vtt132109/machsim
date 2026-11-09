/**
 * Interactive part logic (switches, push-buttons, potentiometers) — pure value transitions.
 *
 * The param named by {@link InteractiveDef.param} is changed according to its ParamDef kind:
 *  - bool:   "true" / "false"
 *  - select: cycles through the options (toggle); momentary uses options[1] pressed, options[0] released
 *  - number: toggle/momentary use "1" / "0"; slider clamps to ParamDef min..max (default 0..100)
 *            in steps of `step` (default 5); the instance params named by stepParam / minParam /
 *            maxParam override the step and the bounds (interactive DC sources)
 *  - text:   treated like bool
 */
import type { InteractiveDef, ParamDef } from '../../library/types';

export type InteractionPhase = 'click' | 'press' | 'release' | 'increase' | 'decrease';

export const DEFAULT_SLIDER_STEP = 5;

function truthy(v: string): boolean {
  return ['true', '1', 'on', 'closed', 'yes'].includes(v.trim().toLowerCase());
}

function formatPercent(v: number): string {
  return String(Math.round(v * 1e6) / 1e6);
}

/**
 * New parameter text for an interaction, or null when the interaction does not apply
 * (e.g. a "release" on a toggle switch).
 */
export function nextInteractiveValue(
  def: InteractiveDef,
  param: ParamDef | undefined,
  current: string,
  phase: InteractionPhase,
  /** instance overrides of a slider's step / bounds (InteractiveDef.stepParam / minParam / maxParam) */
  range: { step?: number; min?: number; max?: number } = {},
): string | null {
  const kind = param?.kind ?? 'text';
  const options = param?.options ?? [];
  const onValue = kind === 'bool' || kind === 'text' ? 'true' : kind === 'select' ? (options[1]?.value ?? options[0]?.value ?? '1') : '1';
  const offValue = kind === 'bool' || kind === 'text' ? 'false' : kind === 'select' ? (options[0]?.value ?? '0') : '0';
  switch (def.kind) {
    case 'toggle': {
      if (phase === 'release') return null;
      if (kind === 'select' && options.length > 0) {
        const idx = options.findIndex((o) => o.value === current);
        return options[(idx + 1) % options.length].value;
      }
      if (kind === 'number') return Number(current) !== 0 && current.trim() !== '' ? '0' : '1';
      return truthy(current) ? 'false' : 'true';
    }
    case 'momentary': {
      if (phase === 'press') return onValue;
      if (phase === 'release') return offValue;
      if (phase === 'click') {
        const on = kind === 'select' ? current === onValue : kind === 'number' ? Number(current) !== 0 : truthy(current);
        return on ? offValue : onValue;
      }
      return null;
    }
    case 'slider': {
      if (phase === 'release') return null;
      const ok = (v: number | undefined): v is number => v !== undefined && Number.isFinite(v);
      const step = ok(range.step) && range.step > 0 ? range.step : def.step && def.step > 0 ? def.step : DEFAULT_SLIDER_STEP;
      let lo = ok(range.min) ? range.min : (param?.min ?? 0);
      let hi = ok(range.max) ? range.max : (param?.max ?? 100);
      if (hi < lo) [lo, hi] = [hi, lo];
      const v = Number.parseFloat(current);
      const base = Number.isFinite(v) ? v : lo;
      const dir = phase === 'decrease' ? -1 : 1;
      return formatPercent(Math.min(hi, Math.max(lo, base + dir * step)));
    }
  }
}

/** Does a keyboard event key match an InteractiveDef key ("A", "space", "Space")? */
export function interactiveKeyMatches(defKey: string | undefined, eventKey: string): boolean {
  if (!defKey) return false;
  if (defKey.toLowerCase() === 'space') return eventKey === ' ' || eventKey.toLowerCase() === 'spacebar';
  return defKey.toLowerCase() === eventKey.toLowerCase();
}

/**
 * Keys of the controls of a multi-control part (InteractiveDef.controls) for one instance: the
 * instance's `keysParam` text (space-separated, in control order; '-' or a missing entry keeps
 * the default) overrides the control's default key.
 */
export function controlKeys(def: InteractiveDef, params: Record<string, string>): (string | undefined)[] {
  const controls = def.controls ?? [];
  const own = def.keysParam ? (params[def.keysParam] ?? '').trim().split(/\s+/).filter(Boolean) : [];
  return controls.map((c, i) => {
    const k = own[i];
    return k && k !== '-' ? k : c.key;
  });
}

/** Index of the control nearest to a symbol-local point (multi-control parts), or undefined. */
export function nearestControl(def: InteractiveDef, local: { x: number; y: number }): number | undefined {
  const controls = def.controls ?? [];
  let best: number | undefined;
  let dist = Infinity;
  controls.forEach((c, i) => {
    const d = Math.hypot(c.at.x - local.x, c.at.y - local.y);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/** Whether the state param of a control reads as "on" (closed switch, pressed key). */
export function controlIsOn(value: string | undefined): boolean {
  return value !== undefined && truthy(value);
}
