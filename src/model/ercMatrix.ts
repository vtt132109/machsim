/**
 * ERC pin-type matrix, NC pin markers and the ERC options of a design (pure).
 *
 * Every pin of a symbol carries a `PinDef.type` (src/library/types.ts). When two pins meet on one
 * net, some combinations are electrically wrong (two push-pull outputs fighting each other, a
 * supply output shorted to a logic output) and some are only suspicious (an output on a tri-state
 * or open-collector net). The matrix maps every unordered pair of pin types to a level:
 *
 *   'ok'       nothing is reported
 *   'warning'  reported as an ERC warning (the circuit still simulates)
 *   'error'    reported as an ERC error (Run is blocked like any other ERC error)
 *
 * `DEFAULT_PIN_MATRIX` only flags combinations that are wrong on a real board, so switching the
 * check on never buries a learner in warnings; `Design.erc.matrix` overrides single pairs
 * (ERC options dialog) and `Design.erc.pinTypes = false` switches the whole check off.
 *
 * NC markers: `PartInstance.ncPins` lists the pins the learner declared "intentionally open".
 * Such a pin raises no floating-pin warning; a pin that is marked NC (or whose symbol pin type is
 * 'nc') but *is* wired raises `ncPinConnected` instead.
 *
 * Hidden power pins: digital ICs carry their supply as hidden pins that join the named VCC / VDD
 * net (src/library/parts/digital/kit.ts `powerNodes`). `Design.erc.hiddenPower` is the design-wide
 * setting for that behaviour ('auto' = join the net when it exists, 'ideal' = ignore supply nets,
 * 'required' = a missing supply net is an ERC error); `hiddenPowerMode` resolves it together with
 * the digital simulation settings.
 */
import type { DigitalSimSettings, ErcMessage } from './types';
import type { PartInstance } from './types';
import type { PinType } from '../library/types';

/** Pin types of the ERC matrix (the normalised set: 'power' becomes 'power-in'). */
export type ErcPinType = 'input' | 'output' | 'bidir' | 'tristate' | 'open-collector' | 'passive' | 'power-in' | 'power-out' | 'nc';

/** Matrix rows / columns in display order (ERC options dialog). */
export const ERC_PIN_TYPES: ErcPinType[] = ['input', 'output', 'bidir', 'tristate', 'open-collector', 'passive', 'power-in', 'power-out', 'nc'];

export type ErcLevel = 'ok' | 'warning' | 'error';

/** Normalise a symbol pin type (absent = passive, legacy 'power' = 'power-in'). */
export function normalizePinType(type: PinType | undefined): ErcPinType {
  if (type === undefined) return 'passive';
  if (type === 'power') return 'power-in';
  return type;
}

/** Key of an unordered pin-type pair, e.g. `pinPairKey('output','input') === 'input|output'`. */
export function pinPairKey(a: ErcPinType, b: ErcPinType): string {
  const ia = ERC_PIN_TYPES.indexOf(a);
  const ib = ERC_PIN_TYPES.indexOf(b);
  return ia <= ib ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Default levels of the pairs that are not 'ok'. Rationale (standard board practice):
 *  - two push-pull outputs on one net short a high output to a low output: error.
 *  - a supply output (a regulator / power-symbol pin) tied to another supply output or to a logic
 *    output shorts two sources: error.
 *  - an output sharing a net with a tri-state or open-collector output works only while the others
 *    are released, which is easy to get wrong: warning.
 *  - an output driving a supply-input pin is almost always a wiring slip: warning.
 * Everything not listed is 'ok' (passive pins, inputs, open-collector among themselves, a supply
 * output feeding supply inputs …). `nc` is handled by `checkPinTypes` itself.
 */
export const DEFAULT_PIN_MATRIX: Readonly<Record<string, ErcLevel>> = Object.freeze({
  [pinPairKey('output', 'output')]: 'error',
  [pinPairKey('output', 'power-out')]: 'error',
  [pinPairKey('power-out', 'power-out')]: 'error',
  [pinPairKey('output', 'tristate')]: 'warning',
  [pinPairKey('output', 'open-collector')]: 'warning',
  [pinPairKey('output', 'power-in')]: 'warning',
  [pinPairKey('tristate', 'power-out')]: 'warning',
  [pinPairKey('open-collector', 'power-out')]: 'warning',
  [pinPairKey('bidir', 'power-out')]: 'warning',
});

/** Level of a pin-type pair: the design's override if it has one, else the default. */
export function pinPairLevel(a: ErcPinType, b: ErcPinType, overrides?: Record<string, ErcLevel>): ErcLevel {
  const key = pinPairKey(a, b);
  return overrides?.[key] ?? DEFAULT_PIN_MATRIX[key] ?? 'ok';
}

/** How the hidden supply pins of digital ICs are wired (Design.erc.hiddenPower). */
export type HiddenPowerMode = 'auto' | 'ideal' | 'required';

/** ERC options saved with a design (Design.erc); every field is optional. */
export interface ErcSettings {
  /** run the pin-type matrix check (default true) */
  pinTypes?: boolean;
  /** overrides of DEFAULT_PIN_MATRIX, keyed by pinPairKey */
  matrix?: Record<string, ErcLevel>;
  /** hidden supply pins of digital ICs (default 'auto') */
  hiddenPower?: HiddenPowerMode;
  /** report a pin marked NC that is wired anyway (default true) */
  ncConnected?: boolean;
  /** report an input pin whose net carries no driver at all (default true) */
  undrivenInputs?: boolean;
}

/**
 * Hidden-power behaviour of a design: the ERC setting wins when it is set to something other than
 * 'auto'; otherwise the digital simulation mode decides ('ideal' / 'real' = 'required').
 */
export function hiddenPowerMode(erc: ErcSettings | undefined, digital: DigitalSimSettings | undefined): HiddenPowerMode {
  const setting = erc?.hiddenPower ?? 'auto';
  if (setting !== 'auto') return setting;
  const mode = digital?.mode ?? 'auto';
  if (mode === 'ideal') return 'ideal';
  if (mode === 'real') return 'required';
  return 'auto';
}

// ---------------------------------------------------------------------------------------------
// NC markers
// ---------------------------------------------------------------------------------------------

/** Pins of a placed part the learner marked "not connected" (sorted, no duplicates). */
export function ncPinsOf(inst: Pick<PartInstance, 'ncPins'>): string[] {
  return inst.ncPins ? [...new Set(inst.ncPins)].sort() : [];
}

export function isNcPin(inst: Pick<PartInstance, 'ncPins'>, pin: string): boolean {
  return !!inst.ncPins?.includes(pin);
}

/** Add / remove one NC marker; returns the new `ncPins` value (undefined when the list is empty). */
export function toggleNcPin(inst: Pick<PartInstance, 'ncPins'>, pin: string, on?: boolean): string[] | undefined {
  const have = isNcPin(inst, pin);
  const next = (on ?? !have) ? [...ncPinsOf(inst), pin] : ncPinsOf(inst).filter((p) => p !== pin);
  const list = [...new Set(next)].sort();
  return list.length ? list : undefined;
}

// ---------------------------------------------------------------------------------------------
// the check
// ---------------------------------------------------------------------------------------------

/** One pin on a net, as the netlister hands it to the pin-type check. */
export interface ErcPinEntry {
  refdes: string;
  pin: string;
  type: ErcPinType;
  /** the pin is marked NC on its instance (PartInstance.ncPins) */
  nc?: boolean;
  sheetId?: string;
  x?: number;
  y?: number;
}

/** One net of a design level with the pins that touch it. */
export interface ErcNetPins {
  /** SPICE node name ("0" for ground) */
  node: string;
  /** user-visible net name */
  name: string;
  pins: ErcPinEntry[];
  /** the net is a power / ground rail (ground symbol, VCC symbol, power-named label) */
  rail?: boolean;
}

const pinText = (p: ErcPinEntry): string => `${p.refdes}.${p.pin}`;

function listPins(pins: ErcPinEntry[]): string {
  const shown = pins.slice(0, 3).map(pinText);
  return shown.join(', ') + (pins.length > 3 ? `, … (${pins.length})` : '');
}

export interface PinTypeCheckOptions {
  settings?: ErcSettings;
  /** prefix for messages of a child design ("Amp: ") */
  prefix?: string;
}

/**
 * Pin-type findings of one design level: every unordered pair of pin types that meet on a net and
 * whose matrix level is not 'ok' (one message per net and type pair, naming up to three pins of
 * each side), plus pins marked NC that are wired to something.
 *
 * Rails (ground and power-symbol nets) are exempt from the matrix: a supply output feeding many
 * parts and two power symbols of the same rail are normal. NC findings are reported everywhere.
 */
/**
 * Inputs with nothing to drive them: a net whose pins are **all** inputs. On a real board such a
 * net floats — a TTL input reads as a one, a CMOS input oscillates and heats up — and in the
 * simulation the node has no path to anything, which is the usual reason a learner's first
 * counter "does nothing". Rails are exempt (a supply net is driven by the supply), and so is any
 * net that has an output, a bidirectional pin, a passive pin (a pull-up resistor drives it
 * through the rail) or a supply pin on it, so the check only fires when there is genuinely no
 * driver. A net with one single pin is already reported as `floating-pin` / `single-pin-net`.
 *
 * Switch it off per design with `Design.erc.undrivenInputs = false` (Tools › ERC options).
 */
export function checkUndrivenInputs(nets: ErcNetPins[], options: PinTypeCheckOptions = {}): ErcMessage[] {
  if (options.settings?.undrivenInputs === false) return [];
  const prefix = options.prefix ?? '';
  const out: ErcMessage[] = [];
  for (const net of nets) {
    if (net.rail || net.pins.length < 2) continue;
    const live = net.pins.filter((p) => !p.nc && p.type !== 'nc');
    if (live.length < 2 || live.some((p) => p.type !== 'input')) continue;
    const first = live[0];
    out.push({
      severity: 'warning',
      code: 'pin-type',
      message: `${prefix}Net ${net.name} only has input pins (${listPins(live)}): nothing drives it`,
      net: net.name,
      refdes: first.refdes,
      pin: first.pin,
      detail: { id: 'undrivenInput', params: { net: net.name, pins: listPins(live), n: live.length } },
      ...(first.sheetId !== undefined ? { sheetId: first.sheetId } : {}),
      ...(first.x !== undefined ? { x: first.x } : {}),
      ...(first.y !== undefined ? { y: first.y } : {}),
    });
  }
  return out;
}

export function checkPinTypes(nets: ErcNetPins[], options: PinTypeCheckOptions = {}): ErcMessage[] {
  const settings = options.settings ?? {};
  const prefix = options.prefix ?? '';
  const out: ErcMessage[] = [];
  const matrixOn = settings.pinTypes !== false;
  const ncOn = settings.ncConnected !== false;
  for (const net of nets) {
    if (net.pins.length < 2) continue;
    if (ncOn) {
      for (const p of net.pins) {
        if (!p.nc && p.type !== 'nc') continue;
        const others = net.pins.filter((o) => o !== p);
        if (!others.length) continue;
        out.push({
          severity: 'error',
          code: 'pin-type',
          message: `${prefix}${pinText(p)} is marked "not connected" but net ${net.name} wires it to ${listPins(others)}`,
          net: net.name,
          refdes: p.refdes,
          pin: p.pin,
          detail: { id: 'ncPinConnected', params: { refdes: p.refdes, pin: p.pin, net: net.name, others: listPins(others) } },
          ...(p.sheetId !== undefined ? { sheetId: p.sheetId } : {}),
          ...(p.x !== undefined ? { x: p.x } : {}),
          ...(p.y !== undefined ? { y: p.y } : {}),
        });
      }
    }
    if (!matrixOn || net.rail) continue;
    const byType = new Map<ErcPinType, ErcPinEntry[]>();
    for (const p of net.pins) {
      if (p.nc || p.type === 'nc') continue;
      if (!byType.has(p.type)) byType.set(p.type, []);
      byType.get(p.type)!.push(p);
    }
    const types = [...byType.keys()].sort((a, b) => ERC_PIN_TYPES.indexOf(a) - ERC_PIN_TYPES.indexOf(b));
    for (let i = 0; i < types.length; i++) {
      for (let j = i; j < types.length; j++) {
        const a = types[i];
        const b = types[j];
        const groupA = byType.get(a)!;
        const groupB = byType.get(b)!;
        // a type paired with itself needs at least two pins of it
        if (a === b && groupA.length < 2) continue;
        const level = pinPairLevel(a, b, settings.matrix);
        if (level === 'ok') continue;
        // one type against itself: the first pin on the left, the others on the right, so the two
        // sides of the message name different pins ("Q3 meets MJ1.EWR", not "Q3, EWR meets EWR")
        const left = listPins(a === b ? groupA.slice(0, 1) : groupA);
        const right = a === b ? listPins(groupA.slice(1)) : listPins(groupB);
        const first = groupA[0];
        out.push({
          severity: level,
          code: 'pin-type',
          message: `${prefix}Net ${net.name}: a '${a}' pin (${left}) meets a '${b}' pin (${right})`,
          net: net.name,
          refdes: first.refdes,
          pin: first.pin,
          detail: { id: 'pinTypeClash', params: { net: net.name, a, b, left, right } },
          ...(first.sheetId !== undefined ? { sheetId: first.sheetId } : {}),
          ...(first.x !== undefined ? { x: first.x } : {}),
          ...(first.y !== undefined ? { y: first.y } : {}),
        });
      }
    }
  }
  return out;
}
