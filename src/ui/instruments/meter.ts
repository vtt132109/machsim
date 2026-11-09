/**
 * Multimeter / current-clamp reading logic (pure).
 *
 * Param keys (text, user number syntax) — identical to the library part
 * `instruments/multimeter`:
 *   mode      v | a | ohm | db        measured quantity
 *   coupling  dc | ac                 DC = time-weighted mean, AC = true RMS of the AC part
 *   ri        voltmeter input resistance (Ω, default 1 GΩ; also shunts the ohmmeter)
 *   ra        ammeter series resistance (Ω, 0 = ideal)
 *   itest     ohmmeter test current (A, default 1 mA), pushed out of the '+' terminal
 *   dbref     dB reference voltage (V RMS, default 774.597 mV = 1 mW into 600 Ω)
 *
 * Channels: `v` = V(+) − V(−) (always present when '+' is wired), `i` = current flowing into
 * '+' through the meter (ammeter mode only).
 *
 * Ohmmeter model: the meter forces `itest` through the unknown resistance with `ri` in
 * parallel, so Rx = 1 / (itest / v − 1 / ri). Readings at or above `ri` (open leads) or
 * negative ones (an active circuit) read as overload.
 *
 * Auto-ranging follows a 4½-digit meter: full-scale ranges 2·10^k (±19999 counts), the
 * smallest range that holds the value is chosen and the reading is shown with a fixed number of
 * decimals for that range ("1.2345 V", "12.345 V", "123.45 V", "1.2345 kV").
 */

import { parseUserNumber } from '../../util/units';
import type { MeterMeasurement } from './measure';
import { t } from '../../i18n';

export type MeterFunction = 'v' | 'a' | 'ohm' | 'db';
export type MeterCoupling = 'dc' | 'ac';

export interface MeterSettings {
  mode: MeterFunction;
  coupling: MeterCoupling;
  ri: number;
  ra: number;
  itest: number;
  dbref: number;
}

export const METER_DEFAULTS: Record<string, string> = {
  mode: 'v',
  coupling: 'dc',
  ri: '1G',
  ra: '0',
  itest: '1m',
  dbref: '774.597m',
};

function num(params: Record<string, string>, key: string): number {
  const v = parseUserNumber(params[key] ?? '');
  return Number.isFinite(v) ? v : parseUserNumber(METER_DEFAULTS[key]);
}

/** Parse multimeter params; invalid or missing entries take the defaults. */
export function parseMeterSettings(params: Record<string, string>): MeterSettings {
  const m = (params.mode ?? '').trim().toLowerCase();
  const c = (params.coupling ?? '').trim().toLowerCase();
  const ri = num(params, 'ri');
  const ra = num(params, 'ra');
  const itest = num(params, 'itest');
  const dbref = num(params, 'dbref');
  return {
    mode: m === 'a' || m === 'ohm' || m === 'db' ? m : 'v',
    coupling: c === 'ac' ? 'ac' : 'dc',
    ri: ri >= 0 ? ri : 1e9,
    ra: ra >= 0 ? ra : 0,
    itest: itest > 0 ? itest : 1e-3,
    dbref: dbref > 0 ? dbref : 0.774597,
  };
}

/** Field validation for the settings dialog (one message per invalid key). */
export function validateMeterParams(params: Record<string, string>): { key: string; message: string }[] {
  const out: { key: string; message: string }[] = [];
  const check = (key: string, ok: (v: number) => boolean, message: string) => {
    const t = params[key];
    if (t === undefined || !t.trim()) return;
    const v = parseUserNumber(t);
    if (!Number.isFinite(v) || !ok(v)) out.push({ key, message });
  };
  check('ri', (v) => v > 0, t('instruments.meter.voltmeterResistanceMustBe0'));
  check('ra', (v) => v >= 0, t('instruments.meter.ammeterResistanceMustBe0'));
  check('itest', (v) => v > 0, t('instruments.meter.testCurrentMustBe0'));
  check('dbref', (v) => v > 0, t('instruments.meter.dbReferenceMustBe0'));
  return out;
}

export const METER_UNITS: Record<MeterFunction, string> = { v: 'V', a: 'A', ohm: 'Ω', db: 'dB' };

/**
 * Resistance read by the ohmmeter for a measured terminal voltage `v` (V(+) − V(−)).
 * Returns +Infinity for open leads / overload and NaN without a usable voltage.
 */
export function ohmsFromVoltage(v: number, itest: number, ri: number): number {
  if (!Number.isFinite(v) || !(itest > 0)) return Number.NaN;
  if (v <= 0) return v === 0 ? 0 : Number.POSITIVE_INFINITY;
  const g = itest / v - (ri > 0 ? 1 / ri : 0);
  // the external resistance is (nearly) infinite once the shunt explains all of the current
  if (!(g > (ri > 0 ? 1e-6 / ri : 0))) return Number.POSITIVE_INFINITY;
  return 1 / g;
}

/**
 * Primary reading of the meter in base units (V, A, Ω or dB).
 * `v` is the measurement of channel v, `i` the measurement of channel i (ammeter mode).
 */
export function meterValue(s: MeterSettings, v: MeterMeasurement | null, i: MeterMeasurement | null): number {
  const pick = (m: MeterMeasurement | null) => (m ? (s.coupling === 'ac' ? m.acRms : m.dc) : Number.NaN);
  switch (s.mode) {
    case 'v':
      return pick(v);
    case 'a':
      return pick(i);
    case 'ohm':
      return v ? ohmsFromVoltage(v.dc, s.itest, s.ri) : Number.NaN;
    case 'db': {
      const level = v ? (s.coupling === 'ac' ? v.acRms : Math.abs(v.dc)) : Number.NaN;
      return Number.isFinite(level) ? 20 * Math.log10(level / s.dbref) : Number.NaN;
    }
  }
}

export interface RangedReading {
  /** digits of the reading in the range's prefix ("12.345"), or "OL" / "----" */
  text: string;
  /** engineering prefix of the range ('', 'm', 'µ', 'k', ...) */
  prefix: string;
  /** full scale of the selected range in base units (e.g. 20 for the 20 V range) */
  fullScale: number;
  /** full-scale label, e.g. "20 V" */
  rangeLabel: string;
  overload: boolean;
}

const PREFIX_BY_EXP: Record<number, string> = { [-12]: 'p', [-9]: 'n', [-6]: 'µ', [-3]: 'm', 0: '', 3: 'k', 6: 'M', 9: 'G' };

/**
 * Auto-range a reading for a 4½-digit display. `minExp` / `maxExp` bound the range exponent k
 * of the full scale 2·10^k (defaults -9 .. 9). Non-finite values and values beyond the highest
 * range read "OL"; NaN reads "----".
 */
export function autoRange(value: number, unit: string, minExp = -9, maxExp = 9): RangedReading {
  const label = (k: number) => {
    const e3 = Math.floor(k / 3) * 3;
    return `${2 * 10 ** (k - e3)} ${PREFIX_BY_EXP[e3] ?? `e${e3}`}${unit}`;
  };
  if (Number.isNaN(value)) return { text: '----', prefix: '', fullScale: Number.NaN, rangeLabel: '', overload: false };
  const top = 2 * 10 ** maxExp;
  if (!Number.isFinite(value) || Math.abs(value) >= top) {
    return { text: 'OL', prefix: '', fullScale: top, rangeLabel: label(maxExp), overload: true };
  }
  const a = Math.abs(value);
  let k = minExp;
  // smallest range whose ±19999 counts hold the value (rounded to the range resolution)
  while (k < maxExp && Math.round(a / 10 ** (k - 4)) >= 20000) k++;
  const e3 = Math.floor(k / 3) * 3;
  const decimals = 4 - (k - e3);
  const scaled = value / 10 ** e3;
  let text = scaled.toFixed(decimals);
  if (/^-0\.?0*$/.test(text)) text = text.slice(1);
  return { text, prefix: PREFIX_BY_EXP[e3] ?? '', fullScale: 2 * 10 ** k, rangeLabel: label(k), overload: false };
}

/** Lowest auto-range exponent used per function (keeps zero readings sensible). */
export const METER_MIN_EXP: Record<MeterFunction, number> = { v: -3, a: -6, ohm: 0, db: 0 };

/** Text of a dB reading (fixed 2 decimals, no auto-ranging). */
export function formatDb(db: number): string {
  if (Number.isNaN(db)) return '----';
  if (!Number.isFinite(db)) return db < 0 ? '-∞' : 'OL';
  return db.toFixed(2);
}
