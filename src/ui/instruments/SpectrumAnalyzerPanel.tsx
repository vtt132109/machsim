/**
 * Spectrum analyzer panel: windowed FFT of the newest samples of V(IN+, IN−).
 *
 * Params (library keys): fstart, fstop (Hz), window (hann | rect | flattop | blackman-harris),
 * units (db = dBV re 1 V RMS | dbm into `impedance` | lin = V RMS).
 * Panel keys: ref (reference level at the top of the screen, dB units, default 0),
 * range (dB per division, 10 divisions, default 10), resolution (Hz, blank = span / 400),
 * impedance (Ω for dBm, default 50), marker (Hz, blank = follow the peak).
 * Span can be entered as start / stop or as centre / span (both edit fstart and fstop).
 */

import { useMemo, useRef } from 'react';
import { formatEng, parseUserNumber } from '../../util/units';
import { WINDOW_LABELS } from '../results/dsp';
import type { WindowKind } from '../results/dsp';
import { spectrumLevel, spectrumMeasure } from './measure';
import { NotConnected, NumberField, Readout, Screen, Section, Segmented, SelectField, eng, paramApi, userText } from './panelKit';
import { drawAxes, drawCursor, drawLabel, readScreenColors, strokeCurve } from './screen';
import type { AxesMapping } from './screen';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';

const DEFAULTS: Record<string, string> = {
  fstart: '0',
  fstop: '10k',
  window: 'hann',
  units: 'db',
  ref: '0',
  range: '10',
  resolution: '',
  impedance: '50',
  marker: '',
};

const WINDOWS: WindowKind[] = ['hann', 'flattop', 'blackman-harris', 'rect'];

type Units = 'db' | 'dbm' | 'lin';

export function SpectrumAnalyzerPanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const p = paramApi(params, onParamsChange, DEFAULTS);
  let fstart = Math.max(0, p.num('fstart', 0));
  let fstop = p.num('fstop', 1e4);
  if (!(fstop > fstart)) fstop = fstart + 1e3;
  const span = fstop - fstart;
  const windowText = p.text('window').trim().toLowerCase();
  const win: WindowKind = (WINDOWS as string[]).includes(windowText) ? (windowText as WindowKind) : 'hann';
  const unitsText = p.text('units').trim().toLowerCase();
  const units: Units = unitsText === 'dbm' || unitsText === 'lin' ? unitsText : 'db';
  const resText = p.text('resolution').trim();
  const resolution = resText ? Math.max(1e-6, p.num('resolution', span / 400)) : span / 400;
  const impedance = Math.max(1e-6, p.num('impedance', 50));
  const ref = p.num('ref', 0);
  const range = Math.max(0.1, p.num('range', 10));
  const mapping = useRef<AxesMapping | null>(null);
  const version = stream.version;

  const spec = useMemo(() => {
    if (stream.length < 4) return null;
    const data = stream.readRecent(Number.POSITIVE_INFINITY, 1 << 18, ['in']);
    if (!data.values.in.some((v) => Number.isFinite(v))) return null;
    return spectrumMeasure(data.time, data.values.in, { start: fstart, stop: fstop, resolution, window: win });
  }, [stream, version, fstart, fstop, resolution, win]);

    const unitLabel = units === 'db' ? 'dBV' : units === 'dbm' ? 'dBm' : 'V';
  const levelUnit = units === 'db' ? 'dBV' : units === 'dbm' ? 'dBm' : 'lin';
  const levels = useMemo(() => (spec ? spec.rms.map((v) => spectrumLevel(v, levelUnit, impedance)) : null), [spec, levelUnit, impedance]);
  let ymin: number;
  let ymax: number;
  if (units === 'lin') {
    const peak = levels ? levels.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), 0) : 1;
    ymin = 0;
    ymax = peak > 0 ? peak * 1.15 : 1;
  } else {
    ymax = ref;
    ymin = ref - 10 * range;
  }
  const markerText = p.text('marker').trim();
  const markerFreq = markerText ? p.num('marker', Number.NaN) : spec?.peakFreq ?? Number.NaN;
  let markerLevel = Number.NaN;
  if (spec && levels && Number.isFinite(markerFreq) && spec.freq.length) {
    // nearest bin
    let k = 0;
    while (k < spec.freq.length - 1 && Math.abs(spec.freq[k + 1] - markerFreq) <= Math.abs(spec.freq[k] - markerFreq)) k++;
    markerLevel = levels[k];
  }
  const fmtLevel = (v: number) => (!Number.isFinite(v) ? '—' : units === 'lin' ? formatEng(v, 'V', 4) : `${v.toFixed(2)} ${unitLabel}`);

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    const m = drawAxes(ctx, { x: 0, y: 0, w, h }, { min: fstart, max: fstop, log: false, unit: 'Hz', label: t('common.frequency') }, { min: ymin, max: ymax, log: false, unit: unitLabel === 'V' ? 'V' : '', plain: units !== 'lin', label: unitLabel }, c);
    mapping.current = m;
    if (spec && levels) {
      const px = new Float64Array(spec.freq.length);
      const py = new Float64Array(spec.freq.length);
      for (let i = 0; i < px.length; i++) {
        px[i] = m.x(spec.freq[i]);
        // -inf dB (exact zero) drawn at the bottom edge
        py[i] = Number.isFinite(levels[i]) ? m.y(levels[i]) : m.area.y + m.area.h;
      }
      strokeCurve(ctx, px, py, c.traces[3], m.area, 1.4);
      if (Number.isFinite(markerFreq)) {
        drawCursor(ctx, m.x(markerFreq), m.area, c.marker, 'M');
        drawLabel(ctx, `${formatEng(markerFreq, 'Hz', 5)}  ${fmtLevel(markerLevel)}`, m.area.x + m.area.w - 4, m.area.y + 4, c.text, c.bg, 'right');
      }
    } else {
      drawLabel(ctx, running ? t('instruments.spectrumAnalyzer.acquiring') : t('instruments.spectrumAnalyzer.startTheSimulation'), m.area.x + m.area.w / 2, m.area.y + m.area.h / 2 - 8, c.text, c.bg, 'center');
    }
  };

  const setMarker = (x: number) => {
    const m = mapping.current;
    if (!m) return;
    const f = m.xValue(Math.max(m.area.x, Math.min(m.area.x + m.area.w, x)));
    p.set('marker', userText(Number(f.toPrecision(5))));
  };

  const setCentreSpan = (centre: number, sp: number) => {
    const lo = Math.max(0, centre - sp / 2);
    p.patch({ fstart: userText(Number(lo.toPrecision(9))), fstop: userText(Number((lo + sp).toPrecision(9))) });
  };

  return (
    <div className="msi-panel msi-spectrum">
      <Screen draw={draw} height={260} ariaLabel={t('instruments.spectrumAnalyzer.spectrumDisplay')} onPointerDown={(_e, x) => setMarker(x)} />
      {!binding.channels.in && <NotConnected what={t('instruments.spectrumAnalyzer.connectTheAnalyzerInput')} />}
      <div className="msi-row msi-secondary">
        <Readout label={t('instruments.spectrumAnalyzer.peak')} value={spec ? `${eng(spec.peakFreq, 'Hz')} · ${fmtLevel(spectrumLevel(spec.peakRms, levelUnit, impedance))}` : '—'} />
        <Readout label={t('instruments.spectrumAnalyzer.marker')} value={Number.isFinite(markerFreq) ? `${eng(markerFreq, 'Hz')} · ${fmtLevel(markerLevel)}` : '—'} />
        <Readout label={t('instruments.spectrumAnalyzer.resolution')} value={spec ? eng(spec.df, 'Hz') : '—'} />
        <Readout label={t('instruments.spectrumAnalyzer.record')} value={spec ? t('instruments.spectrumAnalyzer.recordValue', { duration: eng(spec.duration, 's'), n: spec.points }) : '—'} />
        {markerText && (
          <button type="button" className="msi-btn msi-btn-small" onClick={() => p.set('marker', '')} title={t('tip.spec.clearMarker')}>
            {t('instruments.spectrumAnalyzer.markerPeak')}
          </button>
        )}
      </div>
      <div className="msi-spectrum-controls">
        <Section title={t('instruments.spectrumAnalyzer.spanControl')}>
          <NumberField label={t('common.start')} value={p.text('fstart')} unit="Hz" min={0} onCommit={(t) => p.set('fstart', t)} title={t('tip.spec.fstart')} size={7} />
          <NumberField label={t('instruments.spectrumAnalyzer.end')} value={p.text('fstop')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('fstop', t)} title={t('tip.spec.fstop')} size={7} />
          <NumberField label={t('instruments.spectrumAnalyzer.centre')} value={userText(Number(((fstart + fstop) / 2).toPrecision(9)))} unit="Hz" min={0} onCommit={(t) => setCentreSpan(parseUserNumber(t), span)} title={t('tip.spec.centre')} size={7} />
          <NumberField label={t('instruments.spectrumAnalyzer.span')} value={userText(Number(span.toPrecision(9)))} unit="Hz" min={0} exclusiveMin onCommit={(t) => setCentreSpan((fstart + fstop) / 2, parseUserNumber(t))} title={t('tip.spec.span')} size={7} />
          <div className="msi-row">
            <button type="button" className="msi-btn msi-btn-small" onClick={() => p.patch({ fstart: '0' })} title={t('instruments.spectrumAnalyzer.showFromDcToThe')}>
              {t('instruments.spectrumAnalyzer.fullSpan')}
            </button>
          </div>
        </Section>
        <Section title={t('common.amplitude')}>
          <Segmented
            small
            value={units}
            options={[
              ['db', 'dB'],
              ['dbm', 'dBm'],
              ['lin', 'Lin'],
            ]}
            onChange={(u) => p.set('units', u)} title={t('tip.spec.units')}
          />
          {units !== 'lin' && (
            <>
              <NumberField label={t('instruments.spectrumAnalyzer.refLevel')} value={p.text('ref')} unit={unitLabel} onCommit={(t) => p.set('ref', t)} title={t('tip.spec.ref')} size={5} />
              <NumberField label={t('instruments.spectrumAnalyzer.range')} value={p.text('range')} unit="dB/Div" min={0} exclusiveMin onCommit={(t) => p.set('range', t)} title={t('tip.spec.range')} size={5} />
            </>
          )}
          {units === 'dbm' && <NumberField label={t('instruments.spectrumAnalyzer.impedance')} value={p.text('impedance')} unit="Ω" min={0} exclusiveMin onCommit={(t) => p.set('impedance', t)} title={t('tip.spec.impedance')} size={5} />}
        </Section>
        <Section title={t('common.analysis')}>
          <NumberField
            label={t('instruments.spectrumAnalyzer.resolution')}
            value={p.text('resolution')}
            unit="Hz"
            min={0}
            exclusiveMin
            allowBlank
            placeholder={userText(Number((span / 400).toPrecision(3)))}
            onCommit={(t) => p.set('resolution', t)}
            size={7}
            title={t('instruments.spectrumAnalyzer.frequencyResolutionBlankSpan400')}
          />
          <SelectField label={t('instruments.spectrumAnalyzer.window')} value={win} options={WINDOWS.map((k) => [k, WINDOW_LABELS[k]] as const)} onChange={(v) => p.set('window', v)} title={t('tip.spec.window')} />
        </Section>
      </div>
    </div>
  );
}
