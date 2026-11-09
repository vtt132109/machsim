/**
 * Reading-style instrument panels: multimeter, current clamp, wattmeter, frequency counter and
 * distortion analyzer. Each measures the newest samples of its stream (at most 2^17 per
 * channel) with the algorithms in measure.ts and shows LCD readouts plus its settings.
 */

import { useMemo, useState } from 'react';
import { formatEng } from '../../util/units';
import { counterMeasure, distortionMeasure, meterMeasure, powerMeasure } from './measure';
import type { MeterMeasurement } from './measure';
import { METER_DEFAULTS, METER_MIN_EXP, METER_UNITS, autoRange, formatDb, meterValue, parseMeterSettings } from './meter';
import type { MeterCoupling, MeterFunction } from './meter';
import { Lcd, NotConnected, NumberField, Readout, Section, Segmented, SelectField, eng, paramApi } from './panelKit';
import { signalLabel } from './signals';
import type { InstrumentPanelProps, InstrumentStream, StreamWindow } from './types';
import { t } from '../../i18n';
import { relativeStep } from './resolution';

const MAX_SAMPLES = 1 << 17;

/** Newest samples (at most 2^17) of the given channels, re-read when the stream changes. */
function useRecent(stream: InstrumentStream, channels: readonly string[]): StreamWindow {
  const key = channels.join('|');
  // `version` changes on every push / clear, so it is the cache key for the stream contents
  const version = stream.version;
  return useMemo(() => stream.readRecent(Number.POSITIVE_INFINITY, MAX_SAMPLES, key.split('|')), [stream, version, key]);
}

function hasData(w: StreamWindow, ch: string): boolean {
  const v = w.values[ch];
  if (!v || w.time.length < 2) return false;
  for (let i = v.length - 1; i >= 0 && i >= v.length - 8; i--) if (Number.isFinite(v[i])) return true;
  return false;
}

function idleText(running: boolean, stream: InstrumentStream): string | null {
  if (stream.length >= 2) return null;
  return running ? t('instruments.meterPanels.waitingForSamples') : t('instruments.meterPanels.startTheSimulationToTake');
}

// ---------------------------------------------------------------------------
// Multimeter
// ---------------------------------------------------------------------------

/** Function switch: [value, face, tooltip in the current language]. */
const functionOptions = () =>
  [
    ['a', 'A', t('instruments.meterPanels.functionCurrentTip')],
    ['v', 'V', t('instruments.meterPanels.functionVoltageTip')],
    ['ohm', 'Ω', t('instruments.meterPanels.functionResistanceTip')],
    ['db', 'dB', t('instruments.meterPanels.functionDbTip')],
  ] as const;

/** Coupling switch: [value, face, tooltip in the current language]. */
const couplingOptions = () =>
  [
    ['ac', '∿ AC', t('instruments.meterPanels.couplingAcTip')],
    ['dc', '⎓ DC', t('instruments.meterPanels.couplingDcTip')],
  ] as const;

export function MultimeterPanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const p = paramApi(params, onParamsChange, METER_DEFAULTS);
  const s = parseMeterSettings(params);
  const [showSettings, setShowSettings] = useState(false);
  const data = useRecent(stream, ['v', 'i']);
  const vm: MeterMeasurement | null = hasData(data, 'v') ? meterMeasure(data.time, data.values.v) : null;
  const im: MeterMeasurement | null = hasData(data, 'i') ? meterMeasure(data.time, data.values.i) : null;
  const value = meterValue(s, vm, im);
  const unit = METER_UNITS[s.mode];
  const ranged = s.mode === 'db' ? null : autoRange(value, unit, METER_MIN_EXP[s.mode]);
  const flags = [s.mode === 'ohm' ? 'Ω' : s.coupling.toUpperCase(), 'AUTO'];
  if (ranged?.overload) flags.push('OL');
  const idle = idleText(running, stream);
  const missing = s.mode === 'a' ? !binding.channels.i : !binding.channels.v;
  const source = s.mode === 'a' ? im : vm;
  return (
    <div className="msi-panel msi-multimeter">
      <Lcd
        value={ranged ? ranged.text : formatDb(value)}
        unit={ranged ? (ranged.overload ? unit : `${ranged.prefix}${unit}`) : 'dB'}
        flags={flags}
        caption={ranged && !ranged.overload && Number.isFinite(value) ? t('instruments.meterPanels.rangeRangelabel', { rangeLabel: ranged.rangeLabel }) : s.mode === 'db' ? t('instruments.meterPanels.reValue', { value: formatEng(s.dbref, 'V', 4) }) : undefined}
        ariaLabel={t('instruments.meterPanels.ariaReading', { value: ranged ? `${ranged.text} ${ranged.prefix}${unit}` : `${formatDb(value)} dB` })}
      />
      {missing && <NotConnected what={s.mode === 'a' ? t('instruments.meterPanels.ammeterNotInCircuitYet') : t('instruments.meterPanels.connectTheMetersTerminal')} />}
      {!missing && idle && <NotConnected what={idle} />}
      <div className="msi-row">
        <Segmented label={t('instruments.meterPanels.function')} value={s.mode} options={functionOptions()} onChange={(m: MeterFunction) => p.set('mode', m)} title={t('tip.meter.function')} />
        <Segmented label={t('instruments.meterPanels.coupling')} value={s.coupling} options={couplingOptions()} onChange={(c: MeterCoupling) => p.set('coupling', c)} title={t('tip.meter.coupling')} disabled={s.mode === 'ohm'} />
      </div>
      {source && Number.isFinite(source.freq) && s.mode !== 'ohm' && (
        <div className="msi-row msi-secondary">
          <Readout label={t('common.frequency')} value={eng(source.freq, 'Hz')} />
          <Readout label="DC" value={eng(source.dc, METER_UNITS[s.mode === 'a' ? 'a' : 'v'], 4, relativeStep(source.dc, source.totalRms))} />
          <Readout label={t('instruments.meterPanels.trueRms')} value={eng(source.totalRms, METER_UNITS[s.mode === 'a' ? 'a' : 'v'], 4, relativeStep(source.dc, source.totalRms))} />
        </div>
      )}
      <div className="msi-row">
        <button type="button" className={`msi-btn${showSettings ? ' msi-on' : ''}`} aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)} title={t('tip.meter.settings')}>
          {t('instruments.meterPanels.settings')}
        </button>
        <span className="msi-dim">{binding.channels.v ? signalLabel(binding.channels.v) : ''}</span>
      </div>
      {showSettings && (
        <Section title={t('instruments.meterPanels.meterSettings')}>
          <div className="msi-grid2">
            <NumberField label={t('instruments.meterPanels.ammeterResistanceR')} value={p.text('ra')} unit="Ω" min={0} onCommit={(t) => p.set('ra', t)} title={t('instruments.meterPanels.n0IdealAmmeter')} />
            <NumberField label={t('instruments.meterPanels.voltmeterResistanceR')} value={p.text('ri')} unit="Ω" min={0} exclusiveMin onCommit={(t) => p.set('ri', t)} title={t('tip.meter.ri')} />
            <NumberField label={t('instruments.meterPanels.ohmmeterCurrentI')} value={p.text('itest')} unit="A" min={0} exclusiveMin onCommit={(t) => p.set('itest', t)} title={t('tip.meter.itest')} />
            <NumberField label={t('instruments.meterPanels.dbRelativeValueV')} value={p.text('dbref')} unit="V" min={0} exclusiveMin onCommit={(t) => p.set('dbref', t)} title={t('tip.meter.dbref')} />
          </div>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Current clamp
// ---------------------------------------------------------------------------

export function CurrentClampPanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const p = paramApi(params, onParamsChange, { ratio: '1' });
  const ratio = p.num('ratio', 1);
  const data = useRecent(stream, ['i']);
  const m = hasData(data, 'i') ? meterMeasure(data.time, data.values.i) : null;
  const r = autoRange(m ? m.latest : Number.NaN, 'A', METER_MIN_EXP.a);
  const idle = idleText(running, stream);
  return (
    <div className="msi-panel msi-clamp">
      <Lcd value={r.text} unit={r.overload ? 'A' : `${r.prefix}A`} flags={['INST']} caption={t('instruments.meterPanels.instantaneousCurrent')} />
      {!binding.channels.i && <NotConnected what={t('instruments.meterPanels.routeAConductorThroughThe')} />}
      {binding.channels.i && idle && <NotConnected what={idle} />}
      <div className="msi-row msi-secondary">
        <Readout label={t('common.output')} value={m ? eng(m.latest * ratio, 'V', 4, relativeStep(m.max * ratio, m.min * ratio)) : '—'} />
        <Readout label="DC" value={m ? eng(m.dc, 'A', 4, relativeStep(m.max, m.min)) : '—'} />
        <Readout label="AC RMS" value={m ? eng(m.acRms, 'A', 4, relativeStep(m.max, m.min)) : '—'} />
        <Readout label={t('instruments.meterPanels.peak')} value={m ? eng(Math.max(Math.abs(m.max), Math.abs(m.min)), 'A') : '—'} />
      </div>
      <div className="msi-row">
        <NumberField label={t('instruments.meterPanels.ratio')} value={p.text('ratio')} unit="V/A" onCommit={(t) => p.set('ratio', t)} title={t('instruments.meterPanels.outputVoltagePerAmpereThrough')} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wattmeter
// ---------------------------------------------------------------------------

export function WattmeterPanel(props: InstrumentPanelProps) {
  const { binding, stream, running } = props;
  const data = useRecent(stream, ['v', 'i']);
  const ok = hasData(data, 'v') && hasData(data, 'i');
  const pm = ok ? powerMeasure(data.time, data.values.v, data.values.i) : null;
  const r = autoRange(pm ? pm.power : Number.NaN, 'W', -6);
  const idle = idleText(running, stream);
  return (
    <div className="msi-panel msi-wattmeter">
      <Lcd value={r.text} unit={r.overload ? 'W' : `${r.prefix}W`} flags={['AVG']} caption={t('instruments.meterPanels.averagePower')} />
      {!binding.channels.v && <NotConnected what={t('instruments.meterPanels.connectTheVoltageTerminalsV')} />}
      {binding.channels.v && idle && <NotConnected what={idle} />}
      <div className="msi-row msi-secondary">
        <Readout label={t('instruments.meterPanels.powerFactor')} value={pm && Number.isFinite(pm.powerFactor) ? pm.powerFactor.toFixed(3) : '—'} />
        <Readout label="V RMS" value={pm ? eng(pm.vRms, 'V') : '—'} />
        <Readout label="I RMS" value={pm ? eng(pm.iRms, 'A') : '—'} />
      </div>
      <div className="msi-row msi-secondary">
        <Readout label={t('instruments.meterPanels.apparent')} value={pm ? eng(pm.apparent, 'VA', 4, relativeStep(pm.apparent)) : '—'} />
        <Readout label={t('instruments.meterPanels.reactive')} value={pm ? eng(pm.reactive, 'var', 4, relativeStep(pm.apparent)) : '—'} />
        <Readout label={t('common.frequency')} value={pm ? eng(pm.freq, 'Hz') : '—'} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Frequency counter
// ---------------------------------------------------------------------------

const COUNTER_DEFAULTS: Record<string, string> = { measure: 'freq', coupling: 'ac', sensitivity: '3m', triglevel: '0' };

type CounterMeasureKind = 'freq' | 'period' | 'pulse' | 'edges';

export function FrequencyCounterPanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const p = paramApi(params, onParamsChange, COUNTER_DEFAULTS);
  const kindText = p.text('measure').trim().toLowerCase();
  const kind: CounterMeasureKind = kindText === 'period' || kindText === 'pulse' || kindText === 'edges' ? kindText : 'freq';
  const coupling = p.text('coupling').trim().toLowerCase() === 'dc' ? 'dc' : 'ac';
  const sensitivity = Math.max(0, p.num('sensitivity', 3e-3));
  const level = p.num('triglevel', 0);
  const data = useRecent(stream, ['in']);
  const result = useMemo(() => {
    if (!hasData(data, 'in')) return null;
    const v = data.values.in;
    const meter = meterMeasure(data.time, v);
    // below the sensitivity (RMS) the counter does not count
    if (!(meter.acRms >= sensitivity)) return { m: null, meter };
    const pp = meter.max - meter.min;
    const m = counterMeasure(data.time, v, { coupling, level, sensitivity: Math.min(sensitivity * Math.SQRT2, 0.4 * pp) });
    return { m, meter };
  }, [data, coupling, level, sensitivity]);
  const m = result?.m ?? null;
  const idle = idleText(running, stream);
  let main: { v: number; unit: string; caption: string };
  let second: { label: string; v: number; unit: string } | null = null;
  switch (kind) {
    case 'period':
      main = { v: m ? m.period : Number.NaN, unit: 's', caption: t('instruments.meterPanels.period') };
      break;
    case 'pulse':
      main = { v: m ? m.pulsePos : Number.NaN, unit: 's', caption: t('instruments.meterPanels.positivePulseWidth') };
      second = { label: t('instruments.meterPanels.negativePulse'), v: m ? m.pulseNeg : Number.NaN, unit: 's' };
      break;
    case 'edges':
      main = { v: m ? m.rise : Number.NaN, unit: 's', caption: t('instruments.meterPanels.riseTime1090') };
      second = { label: t('instruments.meterPanels.fallTime'), v: m ? m.fall : Number.NaN, unit: 's' };
      break;
    default:
      main = { v: m ? m.freq : Number.NaN, unit: 'Hz', caption: t('common.frequency') };
  }
  const r = autoRange(main.v, main.unit, main.unit === 'Hz' ? -3 : -12);
  return (
    <div className="msi-panel msi-counter">
      <Lcd value={r.text} unit={r.overload ? main.unit : `${r.prefix}${main.unit}`} flags={[coupling.toUpperCase()]} caption={main.caption} />
      {!binding.channels.in && <NotConnected what={t('instruments.meterPanels.connectTheCounterInput')} />}
      {binding.channels.in && idle && <NotConnected what={idle} />}
      {result && !result.m && <NotConnected what={t('instruments.meterPanels.signalBelowSensitivityValueRms', { value: formatEng(sensitivity, 'V', 3) })} />}
      <div className="msi-row msi-secondary">
        {second && <Readout label={second.label} value={eng(second.v, second.unit)} />}
        <Readout label={t('common.dutyCycle')} value={m && Number.isFinite(m.duty) ? `${(100 * m.duty).toFixed(2)} %` : '—'} />
        <Readout label={t('instruments.meterPanels.edgesCounted')} value={m ? String(m.edges) : '—'} />
      </div>
      <div className="msi-row">
        <Segmented
          label={t('instruments.meterPanels.measurement')}
          value={kind}
          options={[
            ['freq', t('instruments.meterPanels.freq')],
            ['period', t('instruments.meterPanels.period')],
            ['pulse', t('instruments.meterPanels.pulse')],
            ['edges', t('instruments.meterPanels.riseFall')],
          ]}
          onChange={(k) => p.set('measure', k)} title={t('tip.counter.measure')}
        />
        <Segmented
          label={t('instruments.meterPanels.coupling')}
          value={coupling}
          options={[
            ['ac', 'AC'],
            ['dc', 'DC'],
          ]}
          onChange={(c) => p.set('coupling', c)} title={t('tip.counter.coupling')}
        />
      </div>
      <div className="msi-row">
        <NumberField label={t('instruments.meterPanels.sensitivityRms')} value={p.text('sensitivity')} unit="V" min={0} onCommit={(t) => p.set('sensitivity', t)} title={t('tip.counter.sensitivity')} />
        <NumberField
          label={t('instruments.meterPanels.triggerLevel')}
          value={p.text('triglevel')}
          unit="V"
          onCommit={(t) => p.set('triglevel', t)}
          title={coupling === 'ac' ? t('instruments.meterPanels.relativeToTheSignalMean') : t('instruments.meterPanels.absoluteLevelDcCoupling')}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distortion analyzer
// ---------------------------------------------------------------------------

const DISTORTION_DEFAULTS: Record<string, string> = { freq: '1k', mode: 'thd', definition: 'ieee', harmonics: '10', display: 'percent' };

export function DistortionAnalyzerPanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const p = paramApi(params, onParamsChange, DISTORTION_DEFAULTS);
  const mode = p.text('mode').trim().toLowerCase() === 'sinad' ? 'sinad' : 'thd';
  const definition = p.text('definition').trim().toLowerCase() === 'iec' ? 'iec' : 'ieee';
  const display = p.text('display').trim().toLowerCase() === 'db' ? 'db' : 'percent';
  const f0 = p.num('freq', 1e3);
  const harmonics = Math.max(2, Math.min(50, Math.round(p.num('harmonics', 10))));
  const data = useRecent(stream, ['in']);
  const m = useMemo(
    () => (hasData(data, 'in') ? distortionMeasure(data.time, data.values.in, { fundamental: f0 > 0 ? f0 : undefined, harmonics, definition }) : null),
    [data, f0, harmonics, definition],
  );
  const idle = idleText(running, stream);
  const ok = m && m.periods > 0;
  let text = '----';
  const unit = mode === 'sinad' || display === 'db' ? 'dB' : '%';
  if (ok && m) {
    if (mode === 'sinad') text = Number.isFinite(m.sinad) ? m.sinad.toFixed(3) : '∞';
    else if (display === 'db') text = Number.isFinite(m.thdDb) ? m.thdDb.toFixed(3) : '-∞';
    else text = m.thdPercent.toFixed(m.thdPercent < 10 ? 4 : 3);
  }
  const a1 = m?.harmonics[1] ?? 0;
  return (
    <div className="msi-panel msi-distortion">
      <Lcd value={text} unit={unit} flags={[mode.toUpperCase(), definition === 'iec' ? 'IEC' : 'IEEE']} caption={mode === 'sinad' ? 'SINAD' : t('instruments.meterPanels.totalHarmonicDistortion')} />
      {!binding.channels.in && <NotConnected what={t('instruments.meterPanels.connectTheAnalyzerInput')} />}
      {binding.channels.in && idle && <NotConnected what={idle} />}
      {binding.channels.in && !idle && !ok && <NotConnected what={t('instruments.meterPanels.needAtLeastOneFull')} />}
      <div className="msi-row">
        <Segmented
          label={t('instruments.meterPanels.measure')}
          value={mode}
          options={[
            ['thd', 'THD'],
            ['sinad', 'SINAD'],
          ]}
          onChange={(v) => p.set('mode', v)} title={t('tip.disto.measure')}
        />
        {mode === 'thd' && (
          <Segmented
            label={t('instruments.meterPanels.display')}
            value={display}
            options={[
              ['percent', '%'],
              ['db', 'dB'],
            ]}
            onChange={(v) => p.set('display', v)} title={t('tip.disto.display')}
          />
        )}
      </div>
      <div className="msi-row">
        <NumberField label={t('instruments.meterPanels.fundamental')} value={p.text('freq')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('freq', t)} title={t('tip.disto.freq')} />
        <NumberField label={t('instruments.meterPanels.harmonics')} value={p.text('harmonics')} min={2} max={50} integer onCommit={(t) => p.set('harmonics', t)} title={t('tip.disto.harmonics')} size={4} />
        <SelectField
          label={t('instruments.meterPanels.thdDefinition')}
          value={definition}
          options={[
            ['ieee', t('instruments.meterPanels.ieeeVsFundamental')],
            ['iec', t('instruments.meterPanels.iecVsTotalRms')],
          ]}
          onChange={(v) => p.set('definition', v)} title={t('tip.disto.definition')}
        />
      </div>
      {ok && m && a1 > 0 && (
        <table className="msi-table" aria-label={t('instruments.meterPanels.harmonicAmplitudes')}>
          <thead>
            <tr>
              <th scope="col">{t('instruments.meterPanels.harmonic')}</th>
              <th scope="col">{t('common.frequency')}</th>
              <th scope="col">{t('common.amplitude')}</th>
              <th scope="col">{t('instruments.meterPanels.relative')}</th>
            </tr>
          </thead>
          <tbody>
            {m.harmonics.slice(1, Math.min(m.harmonics.length, 11)).map((a, k) => (
              <tr key={k}>
                <th scope="row">{k + 1}</th>
                <td className="msi-num">{eng((k + 1) * m.fundamental, 'Hz')}</td>
                <td className="msi-num">{eng(a, 'V')}</td>
                <td className="msi-num">{k === 0 ? '0 dB' : a > 0 ? `${(20 * Math.log10(a / a1)).toFixed(1)} dB` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
