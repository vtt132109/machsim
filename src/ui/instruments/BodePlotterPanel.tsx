/**
 * Bode plotter panel: magnitude (dB or linear ratio) or phase of
 * H(f) = (V(OUT+) − V(OUT−)) / (V(IN+) − V(IN−)) from the AC result passed in `ac`
 * (the integration layer runs `bodeAnalysisSpec(params)`; the circuit needs an AC source).
 *
 * Params: mode (mag|phase), hscale (log|lin), vscale (log|lin), fstart / fstop (Hz, also the
 * sweep range), points (per decade), mmin / mmax (dB), lmin / lmax (linear ratio),
 * pmin / pmax (deg), cursor (Hz).
 */

import { useMemo, useRef } from 'react';
import type { PointerEvent } from 'react';
import { formatEng } from '../../util/units';
import { downloadText, safeFileName } from '../results/canvas';
import { BODE_DEFAULTS, bodeTransfer, crossingFrequency, interpolateCurve } from './bode';
import { NotConnected, NumberField, Readout, Screen, Section, Segmented, eng, paramApi, userText } from './panelKit';
import { drawAxes, drawCursor, readScreenColors, strokeCurve } from './screen';
import type { AxesMapping } from './screen';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';

const DEFAULTS: Record<string, string> = { ...BODE_DEFAULTS, lmin: '0', lmax: '10' };

export function BodePlotterPanel(props: InstrumentPanelProps) {
  const { binding, ac, params, onParamsChange } = props;
  const p = paramApi(params, onParamsChange, DEFAULTS);
  const mode = p.text('mode') === 'phase' ? 'phase' : 'mag';
  const hlog = p.text('hscale') !== 'lin';
  const vlog = p.text('vscale') !== 'lin';
  const inRef = binding.channels.in;
  const outRef = binding.channels.out;
  const bode = useMemo(() => (ac && inRef && outRef && !ac.error ? bodeTransfer(ac, inRef, outRef) : null), [ac, inRef, outRef]);
  const mapping = useRef<AxesMapping | null>(null);
  const dragging = useRef(false);

  let fmin = p.num('fstart', 1);
  let fmax = p.num('fstop', 1e10);
  if (!(fmin > 0)) fmin = 1;
  if (!(fmax > fmin)) fmax = fmin * 1e3;
  const ys = mode === 'phase' ? bode?.phase : vlog ? bode?.db : bode?.mag;
  let ymin = mode === 'phase' ? p.num('pmin', -720) : vlog ? p.num('mmin', -200) : p.num('lmin', 0);
  let ymax = mode === 'phase' ? p.num('pmax', 720) : vlog ? p.num('mmax', 20) : p.num('lmax', 10);
  if (!(ymax > ymin)) [ymin, ymax] = [Math.min(ymin, ymax) - 1, Math.max(ymin, ymax) + 1];
  const cursorText = p.text('cursor').trim();
  const cursor = cursorText ? p.num('cursor', Math.sqrt(fmin * fmax)) : hlog ? Math.sqrt(fmin * fmax) : (fmin + fmax) / 2;
  const yUnit = mode === 'phase' ? '°' : vlog ? 'dB' : '';
  const yAtCursor = bode && ys ? interpolateCurve(bode.freq, ys, cursor, true) : Number.NaN;

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    const m = drawAxes(
      ctx,
      { x: 0, y: 0, w, h },
      { min: fmin, max: fmax, log: hlog, unit: 'Hz', label: t('common.frequency') },
      { min: ymin, max: ymax, log: false, unit: yUnit, plain: true, label: mode === 'phase' ? t('common.phase') : vlog ? t('instruments.bodePlotter.magnitudeDb') : t('instruments.bodePlotter.magnitudeRatio') },
      c,
    );
    mapping.current = m;
    if (bode && ys) {
      const px = new Float64Array(bode.freq.length);
      const py = new Float64Array(bode.freq.length);
      for (let i = 0; i < px.length; i++) {
        px[i] = bode.freq[i] > 0 || !hlog ? m.x(bode.freq[i]) : Number.NaN;
        py[i] = m.y(ys[i]);
      }
      strokeCurve(ctx, px, py, c.traces[mode === 'phase' ? 1 : 0], m.area, 1.8);
    }
    drawCursor(ctx, m.x(cursor), m.area, c.cursor1, '');
  };

  const moveCursor = (x: number) => {
    const m = mapping.current;
    if (!m) return;
    const xx = Math.max(m.area.x, Math.min(m.area.x + m.area.w, x));
    p.set('cursor', userText(Number(m.xValue(xx).toPrecision(5))));
  };
  const stepCursor = (dir: 1 | -1) => {
    if (!bode || !bode.freq.length) return;
    const f = bode.freq;
    // nearest measured point (log distance on a log axis), then one point left / right
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < f.length; i++) {
      const d = hlog && f[i] > 0 ? Math.abs(Math.log(f[i] / cursor)) : Math.abs(f[i] - cursor);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const next = Math.max(0, Math.min(f.length - 1, best + dir));
    p.set('cursor', userText(Number(f[next].toPrecision(6))));
  };

  const exportCsv = () => {
    if (!bode) return;
    const lines = ['Frequency [Hz],Magnitude [dB],Magnitude [ratio],Phase [deg]'];
    for (let i = 0; i < bode.freq.length; i++) lines.push([bode.freq[i], bode.db[i], bode.mag[i], bode.phase[i]].map((v) => (Number.isFinite(v) ? String(v) : '')).join(','));
    downloadText(`${safeFileName(binding.refdes)}_bode.csv`, lines.join('\r\n') + '\r\n');
  };

  const corner = bode && bode.db.length ? crossingFrequency(bode.freq, bode.db, bode.db[0] - 10 * Math.log10(2)) : Number.NaN;
  const unity = bode ? crossingFrequency(bode.freq, bode.db, 0) : Number.NaN;
  const phaseAtUnity = bode && Number.isFinite(unity) ? interpolateCurve(bode.freq, bode.phase, unity, true) : Number.NaN;

  let message: string | null = null;
  if (!inRef || !outRef) message = t('instruments.bodePlotter.connectBothTheInAnd');
  else if (!ac) message = t('instruments.bodePlotter.runTheAcSweepValue', { value: formatEng(fmin, 'Hz', 3), value2: formatEng(fmax, 'Hz', 3) });
  else if (ac.error) message = t('instruments.bodePlotter.acAnalysisFailedError', { error: ac.error });
  else if (!bode) message = t('instruments.bodePlotter.theAcResultDoesNot');

  return (
    <div className="msi-panel msi-bode">
      <Screen
        draw={draw}
        height={280}
        ariaLabel={t(mode === 'phase' ? 'instruments.bodePlotter.ariaPhase' : 'instruments.bodePlotter.ariaMagnitude')}
        onPointerDown={(_e: PointerEvent<HTMLCanvasElement>, x) => {
          dragging.current = true;
          moveCursor(x);
        }}
        onPointerMove={(_e, x) => {
          if (dragging.current) moveCursor(x);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      />
      {message && <NotConnected what={message} />}
      <div className="msi-row msi-secondary">
        <button type="button" className="msi-btn msi-btn-icon" aria-label={t('instruments.bodePlotter.cursorLeft')} title={t('tip.bode.cursor')} onClick={() => stepCursor(-1)}>
          ◀
        </button>
        <Readout label={t('instruments.bodePlotter.cursor')} value={eng(cursor, 'Hz')} />
        <Readout label={mode === 'phase' ? t('common.phase') : t('common.magnitude')} value={Number.isFinite(yAtCursor) ? `${Number(yAtCursor.toPrecision(5))} ${yUnit}` : '—'} />
        <button type="button" className="msi-btn msi-btn-icon" aria-label={t('instruments.bodePlotter.cursorRight')} title={t('tip.bode.cursor')} onClick={() => stepCursor(1)}>
          ▶
        </button>
        <Readout label="−3 dB" value={eng(corner, 'Hz')} />
        <Readout label="0 dB" value={Number.isFinite(unity) ? `${eng(unity, 'Hz')} (${phaseAtUnity.toFixed(1)}°)` : '—'} />
      </div>
      <div className="msi-row">
        <Segmented
          label={t('common.mode')}
          value={mode}
          options={[
            ['mag', t('common.magnitude')],
            ['phase', t('common.phase')],
          ]}
          onChange={(m) => p.set('mode', m)} title={t('tip.bode.mode')}
        />
        <button type="button" className="msi-btn" onClick={exportCsv} disabled={!bode} title={t('tip.kit.saveCsv')}>
          {t('common.saveCsv')}
        </button>
      </div>
      <div className="msi-bode-axes">
        <Section title={t('instruments.bodePlotter.horizontal')}>
          <Segmented
            small
            value={hlog ? 'log' : 'lin'}
            options={[
              ['log', 'Log'],
              ['lin', 'Lin'],
            ]}
            onChange={(v) => p.set('hscale', v)} title={t('tip.bode.hscale')}
          />
          <NumberField label={t('instruments.bodePlotter.fFinal')} value={p.text('fstop')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('fstop', t)} title={t('tip.bode.fstop')} size={6} />
          <NumberField label={t('instruments.bodePlotter.iInitial')} value={p.text('fstart')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('fstart', t)} title={t('tip.bode.fstart')} size={6} />
        </Section>
        <Section title={t('instruments.bodePlotter.vertical')}>
          {mode === 'mag' && (
            <Segmented
              small
              value={vlog ? 'log' : 'lin'}
              options={[
                ['log', 'Log (dB)'],
                ['lin', 'Lin'],
              ]}
              onChange={(v) => p.set('vscale', v)} title={t('tip.bode.vscale')}
            />
          )}
          {mode === 'phase' ? (
            <>
              <NumberField label={t('instruments.bodePlotter.fMax')} value={p.text('pmax')} unit="°" onCommit={(t) => p.set('pmax', t)} title={t('tip.bode.vmax')} size={6} />
              <NumberField label={t('instruments.bodePlotter.iMin')} value={p.text('pmin')} unit="°" onCommit={(t) => p.set('pmin', t)} title={t('tip.bode.vmin')} size={6} />
            </>
          ) : vlog ? (
            <>
              <NumberField label={t('instruments.bodePlotter.fMax')} value={p.text('mmax')} unit="dB" onCommit={(t) => p.set('mmax', t)} title={t('tip.bode.vmax')} size={6} />
              <NumberField label={t('instruments.bodePlotter.iMin')} value={p.text('mmin')} unit="dB" onCommit={(t) => p.set('mmin', t)} title={t('tip.bode.vmin')} size={6} />
            </>
          ) : (
            <>
              <NumberField label={t('instruments.bodePlotter.fMax')} value={p.text('lmax')} onCommit={(t) => p.set('lmax', t)} title={t('tip.bode.vmax')} size={6} />
              <NumberField label={t('instruments.bodePlotter.iMin')} value={p.text('lmin')} onCommit={(t) => p.set('lmin', t)} title={t('tip.bode.vmin')} size={6} />
            </>
          )}
        </Section>
        <Section title={t('common.sweep')}>
          <NumberField label={t('instruments.bodePlotter.pointsDecade')} value={p.text('points')} min={1} max={10000} integer onCommit={(t) => p.set('points', t)} title={t('tip.bode.points')} size={5} />
        </Section>
      </div>
    </div>
  );
}
