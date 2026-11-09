/**
 * Function generator panel: waveform selector (sine / triangle / square), frequency, duty cycle,
 * amplitude, offset and square-wave rise/fall time, with a two-period preview of the output.
 *
 * Param keys (exactly): waveform, freq, duty, amplitude, offset, risetime. The '+' output is
 * offset + w(t) relative to COM and '−' is the mirror image (library part
 * `instruments/function-generator`); the integration layer re-netlists or calls setParam on
 * `binding.drives` when the params change.
 */

import { formatEng } from '../../util/units';
import { FGEN_DEFAULTS, fgenSample, fgenSettings, validateFgen } from './fgen';
import type { FgenWaveform } from './fgen';
import { NumberField, Screen, Section, Segmented, paramApi } from './panelKit';
import { drawGraticule, readScreenColors, strokeCurve } from './screen';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';

function WaveIcon({ kind }: { kind: FgenWaveform }) {
  const d =
    kind === 'sine'
      ? 'M1 8 C4 -2 8 -2 11 8 S18 18 21 8'
      : kind === 'triangle'
        ? 'M1 12 L6 3 L16 13 L21 4'
        : 'M1 12 L1 4 L11 4 L11 12 L21 12 L21 4';
  return (
    <svg width="22" height="16" viewBox="0 0 22 16" aria-hidden className="msi-waveicon">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function FunctionGeneratorPanel(props: InstrumentPanelProps) {
  const { binding, params, onParamsChange, simTime, running } = props;
  const p = paramApi(params, onParamsChange, FGEN_DEFAULTS);
  const s = fgenSettings({ ...FGEN_DEFAULTS, ...params });
  const errors = validateFgen({ ...FGEN_DEFAULTS, ...params });
  const errFor = (k: string) => errors.find((e) => e.key === k)?.message;
  const drawPreview = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    const r = { x: 0, y: 0, w, h };
    drawGraticule(ctx, r, 8, 4, c);
    const peak = Math.max(1e-12, Math.abs(s.offset) + s.amplitude);
    const n = 400;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const T = 1 / s.freq;
    for (let i = 0; i < n; i++) {
      const t = (2 * T * i) / (n - 1);
      xs[i] = (i / (n - 1)) * w;
      // '+' output relative to COM, scaled to ±(|offset| + amplitude) = ±0.45 h
      ys[i] = h / 2 - (fgenSample(s, t) / peak) * h * 0.45;
    }
    strokeCurve(ctx, xs, ys, c.traces[0], r, 1.8);
    ctx.fillStyle = c.text;
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(t('instruments.functionGenerator.previewScale', { peak: formatEng(peak, 'V', 3), span: formatEng(T * 2, 's', 3) }), 4, 3);
  };
  const isSquare = s.waveform === 'square';
  return (
    <div className="msi-panel msi-fgen">
      <Screen draw={drawPreview} height={110} ariaLabel={t('instruments.functionGenerator.waveformOutputPreview', { waveform: s.waveform })} />
      <Segmented
        label={t('instruments.functionGenerator.waveforms')}
        value={s.waveform}
        options={[
          ['sine', <WaveIcon key="s" kind="sine" />, t('instruments.functionGenerator.sine')],
          ['triangle', <WaveIcon key="t" kind="triangle" />, t('instruments.functionGenerator.triangle')],
          ['square', <WaveIcon key="q" kind="square" />, t('instruments.functionGenerator.square')],
        ]}
        onChange={(w) => p.set('waveform', w)} title={t('tip.fgen.waveform')}
      />
      <Section title={t('instruments.functionGenerator.signalOptions')}>
        <div className="msi-grid2">
          <NumberField label={t('common.frequency')} value={p.text('freq')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('freq', t)} title={t('tip.fgen.freq')} />
          <NumberField label={t('common.dutyCycle')} value={p.text('duty')} unit="%" min={1} max={99} disabled={s.waveform === 'sine'} onCommit={(t) => p.set('duty', t)} title={t('tip.fgen.duty')} />
          <NumberField label={t('common.amplitude')} value={p.text('amplitude')} unit="Vp" min={0} onCommit={(t) => p.set('amplitude', t)} title={t('instruments.functionGenerator.peakAmplitudeOfEachOutput')} />
          <NumberField label={t('common.offset')} value={p.text('offset')} unit="V" onCommit={(t) => p.set('offset', t)} title={t('tip.fgen.offset')} />
          <NumberField label={t('instruments.functionGenerator.riseFallTime')} value={p.text('risetime')} unit="s" min={0} exclusiveMin disabled={!isSquare} onCommit={(t) => p.set('risetime', t)} title={t('tip.fgen.rise')} />
          <button type="button" className="msi-btn" onClick={() => p.set('risetime', FGEN_DEFAULTS.risetime)} title={t('tip.fgen.defaultEdges')} disabled={!isSquare}>
            {t('instruments.functionGenerator.defaultEdges')}
          </button>
        </div>
      </Section>
      {errors.length > 0 && (
        <ul className="msi-errors" role="alert">
          {errors.map((e) => (
            <li key={e.key}>{errFor(e.key)}</li>
          ))}
        </ul>
      )}
      <div className="msi-row msi-terminals" aria-label={t('instruments.functionGenerator.terminals')}>
        <span>
          <b>+</b> {formatEng(s.offset, 'V', 3)} ± {formatEng(s.amplitude, 'V', 3)}
        </span>
        <span>
          <b>COM</b>{' '}{t('instruments.functionGenerator.reference')}
        </span>
        <span>
          <b>−</b>{' '}{t('instruments.functionGenerator.mirrorOf')}
        </span>
        <span className="msi-dim">
          {running ? `t = ${formatEng(simTime, 's', 4)}` : t('instruments.functionGenerator.stopped')}
          {binding.drives.length === 0 ? t('instruments.functionGenerator.noOutputWired') : ''}
        </span>
      </div>
    </div>
  );
}
