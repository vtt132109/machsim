/**
 * Network analyzer panel: two-port S / Z / Y / H parameters and a Smith chart from the AC
 * result in `ac` (one forward run, or `runs` = [forward, reverse]; see networkAnalysisSpec).
 *
 * Params: z0, fstart, fstop, points (library keys), display (s|z|y|h|smith), param
 * (11|12|21|22), format (db|magphase|reim), marker (Hz).
 */

import { useMemo, useRef } from 'react';
import { formatEng } from '../../util/units';
import { downloadText, safeFileName } from '../results/canvas';
import { niceRange } from '../results/ticks';
import { NETWORK_DEFAULTS, cabs, cargDeg, convertTwoPort, gammaToZ, powerGains, reactanceCircle, resistanceCircle, rollett, sParametersFromAc, twoPortAt } from './network';
import type { Complex, SParameterData, TwoPort, TwoPortKind } from './network';
import { NotConnected, NumberField, Readout, Screen, Section, Segmented, eng, paramApi, userText } from './panelKit';
import { drawAxes, drawCursor, drawLabel, readScreenColors, strokeCurve } from './screen';
import type { AxesMapping, ScreenColors } from './screen';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';
import { MatchDesigner, matchOverlay, type SmithOverlay } from './MatchDesigner';
import { relativeStep, toResolution } from './resolution';

type ParamKey = 'p11' | 'p12' | 'p21' | 'p22';
type Format = 'db' | 'magphase' | 'reim';

const NAN_C: Complex = { re: Number.NaN, im: Number.NaN };

const UNITS: Record<TwoPortKind, Record<ParamKey, string>> = {
  s: { p11: '', p12: '', p21: '', p22: '' },
  z: { p11: 'Ω', p12: 'Ω', p21: 'Ω', p22: 'Ω' },
  y: { p11: 'S', p12: 'S', p21: 'S', p22: 'S' },
  h: { p11: 'Ω', p12: '', p21: '', p22: 'S' },
};

function complexText(z: Complex, unit: string, polar: boolean): string {
  if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) return '—';
  // display resolution: 4½ digits relative to |z|, so a purely real value reads "+ j0"
  const step = relativeStep(cabs(z));
  if (polar) return `${formatEng(cabs(z), unit, 4)} ∠ ${cargDeg(z).toFixed(2)}°`;
  const re = toResolution(z.re, step);
  const im = toResolution(z.im, step);
  return `${formatEng(re, '', 4)} ${im < 0 ? '−' : '+'} j${formatEng(Math.abs(im), '', 4)}${unit ? ` ${unit}` : ''}`;
}

/** Smith chart grid and traces of S11 and S22 inside a square of side `size`. */
function drawSmith(ctx: CanvasRenderingContext2D, w: number, h: number, c: ScreenColors, data: SParameterData | null, marker: number, overlay?: SmithOverlay | null): void {
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const R = Math.min(w, h) / 2 - 14;
  const cx = w / 2;
  const cy = h / 2;
  const X = (g: number) => cx + g * R;
  const Y = (g: number) => cy - g * R;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 1;
  for (const r of [0.2, 0.5, 1, 2, 5]) {
    const k = resistanceCircle(r);
    ctx.beginPath();
    ctx.arc(X(k.cx), Y(k.cy), k.r * R, 0, 2 * Math.PI);
    ctx.stroke();
  }
  for (const x of [0.2, 0.5, 1, 2, 5]) {
    for (const s of [1, -1]) {
      const k = reactanceCircle(s * x);
      ctx.beginPath();
      ctx.arc(X(k.cx), Y(k.cy), k.r * R, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.moveTo(cx - R, cy);
  ctx.lineTo(cx + R, cy);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = c.gridMajor;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = c.text;
  ctx.font = '9px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const r of [0.2, 0.5, 1, 2, 5]) {
    const g = (r - 1) / (r + 1);
    ctx.fillText(String(r), X(g), cy + 2);
  }
  if (!data) return;
  const traces: [ParamKey, string][] = [
    ['p11', c.traces[0]],
    ['p22', c.traces[1]],
  ];
  for (const [key, color] of traces) {
    const xs = new Float64Array(data.s.length);
    const ys = new Float64Array(data.s.length);
    data.s.forEach((s, i) => {
      xs[i] = X(s[key].re);
      ys[i] = Y(s[key].im);
    });
    strokeCurve(ctx, xs, ys, color, { x: 0, y: 0, w, h }, 1.6);
    const at = twoPortAt(data, marker, 's', 50);
    if (at && Number.isFinite(at[key].re)) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(X(at[key].re), Y(at[key].im), 4, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  drawLabel(ctx, 'S11', 6, 6, c.traces[0], c.bg);
  drawLabel(ctx, 'S22', 6, 24, c.traces[1], c.bg);
  if (!overlay) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  overlay.circles.forEach((oc, i) => {
    const color = c.traces[(oc.colorIndex ?? i + 2) % c.traces.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(oc.dashed ? [6, 4] : []);
    ctx.beginPath();
    ctx.arc(X(oc.circle.center.re), Y(oc.circle.center.im), Math.max(0.5, oc.circle.radius * R), 0, 2 * Math.PI);
    ctx.stroke();
    if (oc.label) drawLabel(ctx, oc.label, Math.min(w - 60, Math.max(4, X(oc.circle.center.re) + 4)), Math.min(h - 18, Math.max(4, Y(oc.circle.center.im) - 8)), color, c.bg);
  });
  ctx.setLineDash([]);
  for (const pt of overlay.points) {
    ctx.fillStyle = c.marker;
    ctx.beginPath();
    ctx.arc(X(pt.g.re), Y(pt.g.im), 4.5, 0, 2 * Math.PI);
    ctx.fill();
    drawLabel(ctx, pt.label, X(pt.g.re) + 6, Y(pt.g.im) - 18, c.marker, c.bg);
  }
  ctx.restore();
}

export function NetworkAnalyzerPanel(props: InstrumentPanelProps) {
  const { binding, ac, params, onParamsChange } = props;
  const p = paramApi(params, onParamsChange, NETWORK_DEFAULTS);
  const z0 = p.num('z0', 50) > 0 ? p.num('z0', 50) : 50;
  const displayText = p.text('display').trim().toLowerCase();
  const display: TwoPortKind | 'smith' | 'match' = displayText === 'z' || displayText === 'y' || displayText === 'h' || displayText === 'smith' || displayText === 'match' ? displayText : 's';
  const paramText = p.text('param').trim();
  const pk: ParamKey = paramText === '11' || paramText === '12' || paramText === '22' ? (`p${paramText}` as ParamKey) : 'p21';
  const formatText = p.text('format').trim().toLowerCase();
  const requested: Format = formatText === 'magphase' || formatText === 'reim' ? formatText : 'db';
  const p1 = binding.channels.p1;
  const p2 = binding.channels.p2;
  const data = useMemo(() => {
    if (!ac || ac.error || !p1) return null;
    const d = sParametersFromAc(ac, p1, p2 ?? p1);
    if (!d || p2) return d;
    // one-port measurement: only S11 is meaningful
    return { ...d, full: false, s: d.s.map((s) => ({ p11: s.p11, p12: NAN_C, p21: NAN_C, p22: NAN_C })) };
  }, [ac, p1, p2]);
  const fmin = data?.freq.length ? data.freq[0] : p.num('fstart', 1e6);
  const fmax = data?.freq.length ? data.freq[data.freq.length - 1] : p.num('fstop', 1e10);
  const markerText = p.text('marker').trim();
  const marker = markerText ? p.num('marker', Math.sqrt(fmin * fmax)) : Math.sqrt(Math.max(fmin, 1e-30) * fmax);
  const kind: TwoPortKind = display === 'smith' || display === 'match' ? 's' : display;
  // dB only makes sense for the dimensionless S parameters
  const format: Format = kind !== 's' && requested === 'db' ? 'magphase' : requested;
  const atMarker: TwoPort | null = data ? twoPortAt(data, marker, kind, z0) : null;
  const sAtMarker: TwoPort | null = data ? twoPortAt(data, marker, 's', z0) : null;
  const mapping = useRef<AxesMapping | null>(null);

  const series = useMemo(() => {
    if (!data || display === 'smith' || display === 'match') return null;
    const n = data.freq.length;
    const top = new Float64Array(n);
    const bottom = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const v = convertTwoPort(data.s[i], kind, z0)[pk];
      if (format === 'reim') {
        top[i] = v.re;
        bottom[i] = v.im;
      } else {
        top[i] = format === 'db' ? 20 * Math.log10(cabs(v)) : cabs(v);
        bottom[i] = cargDeg(v);
      }
    }
    return { top, bottom };
  }, [data, display, kind, pk, format, z0]);

  const unit = UNITS[kind][pk];
  const topLabel = format === 'reim' ? t('instruments.networkAnalyzer.real') : format === 'db' ? t('instruments.networkAnalyzer.magnitudeDb') : t('common.magnitude');
  const bottomLabel = format === 'reim' ? t('instruments.networkAnalyzer.imaginary') : t('common.phase');

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    if (display === 'smith' || display === 'match') {
      drawSmith(ctx, w, h, c, data, marker, display === 'match' && sAtMarker && data?.full ? matchOverlay(sAtMarker, params) : null);
      return;
    }
    const half = Math.floor(h / 2);
    const extent = (a: Float64Array | undefined): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const v of a ?? []) {
        if (Number.isFinite(v)) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
      if (!(hi >= lo)) return [-1, 1];
      if (hi === lo) return niceRange(lo, hi);
      const pad = (hi - lo) * 0.05;
      return niceRange(lo - pad, hi + pad);
    };
    const [t0, t1] = extent(series?.top);
    const [b0, b1] = format === 'reim' ? extent(series?.bottom) : [-180, 180];
    const plain = format === 'db';
    const mt = drawAxes(ctx, { x: 0, y: 0, w, h: half }, { min: fmin, max: fmax, log: fmin > 0, unit: 'Hz' }, { min: t0, max: t1, log: false, unit: plain ? '' : unit, plain, label: topLabel }, c);
    const mb = drawAxes(ctx, { x: 0, y: half, w, h: h - half }, { min: fmin, max: fmax, log: fmin > 0, unit: 'Hz', label: t('common.frequency') }, { min: b0, max: b1, log: false, unit: format === 'reim' ? unit : '', plain: format !== 'reim', label: bottomLabel }, c);
    mapping.current = mt;
    if (data && series) {
      const xs = data.freq.map((f) => mt.x(f));
      strokeCurve(ctx, xs, series.top.map((v) => mt.y(v)), c.traces[0], mt.area, 1.6);
      strokeCurve(ctx, xs, series.bottom.map((v) => mb.y(v)), c.traces[1], mb.area, 1.6);
    }
    drawCursor(ctx, mt.x(marker), mt.area, c.marker, 'M');
    drawCursor(ctx, mb.x(marker), mb.area, c.marker, 'M');
  };

  const setMarkerPx = (x: number) => {
    const m = mapping.current;
    if (!m || display === 'smith' || display === 'match') return;
    const f = m.xValue(Math.max(m.area.x, Math.min(m.area.x + m.area.w, x)));
    p.set('marker', userText(Number(f.toPrecision(5))));
  };
  const stepMarker = (dir: 1 | -1) => {
    if (!data?.freq.length) return;
    let best = 0;
    for (let i = 0; i < data.freq.length; i++) if (Math.abs(Math.log(data.freq[i] / marker)) < Math.abs(Math.log(data.freq[best] / marker))) best = i;
    const next = Math.max(0, Math.min(data.freq.length - 1, best + dir));
    p.set('marker', userText(Number(data.freq[next].toPrecision(6))));
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ['Frequency [Hz]', ...(['11', '12', '21', '22'] as const).flatMap((k) => [`S${k} re`, `S${k} im`])];
    const lines = [head.join(',')];
    data.freq.forEach((f, i) => {
      const s = data.s[i];
      lines.push([f, s.p11.re, s.p11.im, s.p12.re, s.p12.im, s.p21.re, s.p21.im, s.p22.re, s.p22.im].map((v) => (Number.isFinite(v) ? String(v) : '')).join(','));
    });
    downloadText(`${safeFileName(binding.refdes)}_sparams.csv`, lines.join('\r\n') + '\r\n');
  };

  const stability = sAtMarker && data?.full ? rollett(sAtMarker) : null;
  const gains = sAtMarker && data?.full ? powerGains(sAtMarker) : null;
  const zin = sAtMarker ? gammaToZ(sAtMarker.p11, z0) : null;
  const letter = kind.toUpperCase();

  let message: string | null = null;
  if (!p1) message = t('instruments.networkAnalyzer.connectPortP1AndP2');
  else if (!ac) message = t('instruments.networkAnalyzer.runSweep', { start: formatEng(p.num('fstart', 1e6), 'Hz', 3), stop: formatEng(p.num('fstop', 1e10), 'Hz', 3) });
  else if (ac.error) message = t('instruments.networkAnalyzer.acAnalysisFailedError', { error: ac.error });
  else if (!data) message = t('instruments.networkAnalyzer.theAcResultDoesNot');
  else if (!data.full && p2) message = t('instruments.networkAnalyzer.forwardRunOnlyS12And');

  return (
    <div className="msi-panel msi-network">
      <Screen draw={draw} height={display === 'smith' || display === 'match' ? 300 : 320} ariaLabel={display === 'smith' || display === 'match' ? t('instruments.networkAnalyzer.smithChart') : t('instruments.networkAnalyzer.letterSliceVersusFrequency', { letter: letter, slice: pk.slice(1) })} onPointerDown={(_e, x) => setMarkerPx(x)} />
      {message && <NotConnected what={message} />}
      <div className="msi-row msi-secondary">
        <button type="button" className="msi-btn msi-btn-icon" aria-label={t('instruments.networkAnalyzer.markerLeft')} title={t('tip.net.marker')} onClick={() => stepMarker(-1)}>
          ◀
        </button>
        <Readout label={t('instruments.networkAnalyzer.marker')} value={eng(marker, 'Hz')} />
        <button type="button" className="msi-btn msi-btn-icon" aria-label={t('instruments.networkAnalyzer.markerRight')} title={t('tip.net.marker')} onClick={() => stepMarker(1)}>
          ▶
        </button>
        {zin && <Readout label={t('instruments.networkAnalyzer.zInPort1')} value={complexText(zin, 'Ω', false)} />}
      </div>
      {atMarker && (
        <table className="msi-table" aria-label={t('instruments.networkAnalyzer.parametersAtTheMarker')}>
          <tbody>
            {(['p11', 'p12', 'p21', 'p22'] as ParamKey[]).map((k) => (
              <tr key={k} className={k === pk && display !== 'smith' && display !== 'match' ? 'msi-row-sel' : undefined}>
                <th scope="row">
                  {letter}
                  {k.slice(1)}
                </th>
                <td className="msi-num">{complexText(atMarker[k], UNITS[kind][k], true)}</td>
                <td className="msi-num">{kind === 's' && Number.isFinite(atMarker[k].re) ? `${(20 * Math.log10(cabs(atMarker[k]))).toFixed(2)} dB` : complexText(atMarker[k], UNITS[kind][k], false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {stability && gains && (
        <div className="msi-row msi-secondary">
          <Readout label={t('instruments.networkAnalyzer.kRollett')} value={Number.isFinite(stability.k) ? stability.k.toFixed(3) : '—'} />
          <Readout label="|Δ|" value={stability.delta.toFixed(3)} />
          <Readout label={t('instruments.networkAnalyzer.stability')} value={stability.unconditional ? t('instruments.networkAnalyzer.unconditional') : t('instruments.networkAnalyzer.potentiallyUnstable')} />
          <Readout label={t('instruments.networkAnalyzer.gt')} value={`${(10 * Math.log10(gains.transducer)).toFixed(2)} dB`} />
          <Readout label={Number.isFinite(gains.mag) ? t('instruments.networkAnalyzer.mag') : t('instruments.networkAnalyzer.msg')} value={`${(10 * Math.log10(Number.isFinite(gains.mag) ? gains.mag : gains.msg)).toFixed(2)} dB`} />
        </div>
      )}
      <div className="msi-row">
        <Segmented
          label={t('common.mode')}
          value={display}
          options={[
            ['smith', t('instruments.networkAnalyzer.smith')],
            ['match', t('instruments.networkAnalyzer.match'), t('tip.net.match')],
            ['s', 'S'],
            ['z', 'Z'],
            ['y', 'Y'],
            ['h', 'H'],
          ]}
          onChange={(d) => p.set('display', d)} title={t('tip.net.mode')}
        />
        {display !== 'smith' && display !== 'match' && (
          <>
            <Segmented
              label={t('common.parameter')}
              value={pk}
              options={(['p11', 'p12', 'p21', 'p22'] as const).map((k) => [k, `${letter}${k.slice(1)}`] as const)}
              onChange={(k) => p.set('param', k.slice(1))} title={t('tip.net.param')}
            />
            <Segmented
              label={t('instruments.networkAnalyzer.format')}
              value={format}
              options={
                kind === 's'
                  ? [
                      ['db', t('instruments.networkAnalyzer.fmtDbPhase')],
                      ['magphase', t('instruments.networkAnalyzer.fmtMagPhase')],
                      ['reim', t('instruments.networkAnalyzer.fmtReIm')],
                    ]
                  : [
                      ['magphase', t('instruments.networkAnalyzer.fmtMagPhase')],
                      ['reim', t('instruments.networkAnalyzer.fmtReIm')],
                    ]
              }
              onChange={(f) => p.set('format', f)} title={t('tip.net.format')}
            />
          </>
        )}
      </div>
      {display === 'match' && <MatchDesigner s={sAtMarker && data?.full ? sAtMarker : null} z0={z0} freq={marker} params={params} onParamsChange={onParamsChange} />}
      <div className="msi-row">
        <Section title={t('instruments.networkAnalyzer.measurementSetup')}>
          <NumberField label="Z0" value={p.text('z0')} unit="Ω" min={0} exclusiveMin onCommit={(t) => p.set('z0', t)} title={t('tip.net.z0')} size={5} />
          <NumberField label={t('common.start')} value={p.text('fstart')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('fstart', t)} title={t('tip.net.fstart')} size={6} />
          <NumberField label={t('common.stop')} value={p.text('fstop')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('fstop', t)} title={t('tip.net.fstop')} size={6} />
          <NumberField label={t('instruments.networkAnalyzer.pointsDecade')} value={p.text('points')} integer min={1} max={10000} onCommit={(t) => p.set('points', t)} title={t('tip.net.points')} size={5} />
          <button type="button" className="msi-btn" onClick={exportCsv} disabled={!data} title={t('tip.kit.saveCsv')}>
            {t('common.saveCsv')}
          </button>
        </Section>
      </div>
    </div>
  );
}
