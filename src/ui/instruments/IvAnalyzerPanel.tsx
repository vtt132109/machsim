/**
 * IV analyzer panel: current-voltage curve families of a diode, BJT or MOSFET from the DC-sweep
 * result in `dc` (the integration layer runs `ivAnalysisSpec(params, binding)`).
 *
 * Params: device (diode|bjt-npn|bjt-pnp|nmos|pmos), vstart / vstop / vstep (main sweep, blank =
 * device preset), cstart / cstop / csteps (stepped base current or gate voltage), iscale
 * (lin|log), vmin / vmax / imin / imax (display range, blank = auto), cursor (V).
 */

import { useMemo, useRef } from 'react';
import { formatEng } from '../../util/units';
import { downloadText, safeFileName } from '../results/canvas';
import { niceRange } from '../results/ticks';
import { interpolateCurve } from './bode';
import { IV_PRESETS, ivAnalysisSpec, ivCurves, ivDevice, ivSweep } from './iv';
import type { IvDevice } from './iv';
import { NotConnected, NumberField, Screen, Section, Segmented, SelectField, eng, paramApi, userText } from './panelKit';
import { drawAxes, drawCursor, readScreenColors, strokeCurve } from './screen';
import type { AxesMapping } from './screen';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';

const DEFAULTS: Record<string, string> = { device: 'diode', iscale: 'lin', cursor: '' };

/** Device choices with their names in the current language. */
const deviceOptions = () => (Object.keys(IV_PRESETS) as IvDevice[]).map((k) => [k, IV_PRESETS[k].label] as const);

export function IvAnalyzerPanel(props: InstrumentPanelProps) {
  const { binding, dc, params, onParamsChange } = props;
  const p = paramApi(params, onParamsChange, DEFAULTS);
  const device = ivDevice(params);
  const preset = IV_PRESETS[device];
  const sweep = ivSweep(params);
  const ilog = p.text('iscale') === 'log';
  const iRef = binding.channels.i;
  const vRef = binding.channels.v;
  const curves = useMemo(() => (dc && iRef && !dc.error ? ivCurves(dc, iRef, vRef) : []), [dc, iRef, vRef]);
  const mapping = useRef<AxesMapping | null>(null);
  const dragging = useRef(false);

  // ranges: explicit when given, otherwise the data extent
  let vlo = Infinity;
  let vhi = -Infinity;
  let ilo = Infinity;
  let ihi = -Infinity;
  for (const c of curves) {
    for (let k = 0; k < c.v.length; k++) {
      const v = c.v[k];
      const i = ilog ? Math.abs(c.i[k]) : c.i[k];
      if (Number.isFinite(v)) {
        vlo = Math.min(vlo, v);
        vhi = Math.max(vhi, v);
      }
      if (Number.isFinite(i) && (!ilog || i > 0)) {
        ilo = Math.min(ilo, i);
        ihi = Math.max(ihi, i);
      }
    }
  }
  if (!(vhi > vlo)) [vlo, vhi] = [Math.min(sweep.vstart, sweep.vstop), Math.max(sweep.vstart, sweep.vstop)];
  if (!(vhi > vlo)) [vlo, vhi] = [vlo - 1, vlo + 1];
  if (!(ihi > ilo)) [ilo, ihi] = ilog ? [1e-12, 1e-3] : [0, 1e-3];
  const blankOr = (key: string, fallback: number) => (p.text(key).trim() ? p.num(key, fallback) : fallback);
  const [nvlo, nvhi] = niceRange(vlo, vhi);
  const [nilo, nihi] = ilog ? niceRange(Math.max(ilo, ihi * 1e-12), ihi, true) : niceRange(ilo, ihi);
  const xr: [number, number] = [blankOr('vmin', nvlo), blankOr('vmax', nvhi)];
  let yr: [number, number] = [blankOr('imin', nilo), blankOr('imax', nihi)];
  if (ilog && !(yr[0] > 0)) yr = [nilo, nihi];
  if (!(xr[1] > xr[0])) xr[1] = xr[0] + 1;
  if (!(yr[1] > yr[0])) yr[1] = ilog ? yr[0] * 10 : yr[0] + 1e-3;

  const cursorText = p.text('cursor').trim();
  const cursor = cursorText ? p.num('cursor', (xr[0] + xr[1]) / 2) : (xr[0] + xr[1]) / 2;

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    const m = drawAxes(ctx, { x: 0, y: 0, w, h }, { min: xr[0], max: xr[1], log: false, unit: 'V', label: preset.sweep.label }, { min: yr[0], max: yr[1], log: ilog, unit: 'A', label: t('instruments.ivAnalyzer.current') }, c);
    mapping.current = m;
    curves.forEach((cv, k) => {
      const px = new Float64Array(cv.v.length);
      const py = new Float64Array(cv.v.length);
      for (let j = 0; j < px.length; j++) {
        px[j] = m.x(cv.v[j]);
        py[j] = ilog ? (Math.abs(cv.i[j]) > 0 ? m.y(Math.abs(cv.i[j])) : Number.NaN) : m.y(cv.i[j]);
      }
      strokeCurve(ctx, px, py, c.traces[k % c.traces.length], m.area, 1.6);
    });
    drawCursor(ctx, m.x(cursor), m.area, c.cursor1, '');
  };

  const moveCursor = (x: number) => {
    const m = mapping.current;
    if (!m) return;
    const v = m.xValue(Math.max(m.area.x, Math.min(m.area.x + m.area.w, x)));
    p.set('cursor', userText(Number(v.toPrecision(4))));
  };

  const exportCsv = () => {
    const lines = ['Curve,Voltage [V],Current [A]'];
    for (const cv of curves) for (let k = 0; k < cv.v.length; k++) lines.push(`"${cv.label.replace(/"/g, '""')}",${cv.v[k]},${cv.i[k]}`);
    downloadText(`${safeFileName(binding.refdes)}_iv.csv`, lines.join('\r\n') + '\r\n');
  };

  const spec = ivAnalysisSpec(params, binding);
  let message: string | null = null;
  if (!iRef) message = t('instruments.ivAnalyzer.connectTheDeviceToThe');
  else if (!spec) message = t('instruments.ivAnalyzer.theAnalyzersControlSourceIs');
  else if (!dc)
    message = spec.src2
      ? t('instruments.ivAnalyzer.runSweepSteps', { src: spec.src, start: formatEng(spec.start, 'V', 3), stop: formatEng(spec.stop, 'V', 3), n: sweep.csteps, control: preset.control?.label ?? '' })
      : t('instruments.ivAnalyzer.runSweep', { src: spec.src, start: formatEng(spec.start, 'V', 3), stop: formatEng(spec.stop, 'V', 3) });
  else if (dc.error) message = t('instruments.ivAnalyzer.sweepFailedError', { error: dc.error });
  else if (!curves.length) message = t('instruments.ivAnalyzer.theDcResultDoesNot');

  return (
    <div className="msi-panel msi-iv">
      <Screen
        draw={draw}
        height={280}
        ariaLabel={t('instruments.ivAnalyzer.ariaCurves', { label: preset.label })}
        onPointerDown={(_e, x) => {
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
      {curves.length > 0 && (
        <table className="msi-table" aria-label={t('instruments.ivAnalyzer.cursorReadout')}>
          <thead>
            <tr>
              <th scope="col">{t('instruments.ivAnalyzer.curve')}</th>
              <th scope="col">V = {eng(cursor, 'V')}</th>
            </tr>
          </thead>
          <tbody>
            {curves.map((cv, k) => (
              <tr key={k}>
                <th scope="row">
                  <span className={`msi-swatch msi-c${(k % 8) + 1}`} aria-hidden /> {cv.label || preset.label}
                </th>
                <td className="msi-num">{eng(interpolateCurve(cv.v, cv.i, cursor), 'A')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="msi-row">
        <SelectField label={t('instruments.ivAnalyzer.components')} value={device} options={deviceOptions()} onChange={(d) => p.set('device', d)} title={t('tip.iv.device')} />
        <Segmented
          label={t('instruments.ivAnalyzer.currentRange')}
          value={ilog ? 'log' : 'lin'}
          options={[
            ['lin', 'Lin'],
            ['log', 'Log'],
          ]}
          onChange={(v) => p.set('iscale', v)} title={t('tip.iv.iscale')}
        />
        <button type="button" className="msi-btn" onClick={exportCsv} disabled={!curves.length} title={t('tip.kit.saveCsv')}>
          {t('common.saveCsv')}
        </button>
      </div>
      <div className="msi-iv-controls">
        <Section title={t('instruments.ivAnalyzer.simulateLabelSweep', { label: preset.sweep.label })}>
          <NumberField label={t('common.start')} value={p.text('vstart')} unit="V" allowBlank placeholder={String(preset.sweep.start)} onCommit={(t) => p.set('vstart', t)} title={t('tip.iv.vstart')} size={6} />
          <NumberField label={t('common.stop')} value={p.text('vstop')} unit="V" allowBlank placeholder={String(preset.sweep.stop)} onCommit={(t) => p.set('vstop', t)} title={t('tip.iv.vstop')} size={6} />
          <NumberField label={t('common.increment')} value={p.text('vstep')} unit="V" allowBlank min={0} exclusiveMin placeholder={String(Math.abs(preset.sweep.step))} onCommit={(t) => p.set('vstep', t)} title={t('tip.iv.vstep')} size={6} />
        </Section>
        {preset.control && (
          <Section title={t('instruments.ivAnalyzer.simulateLabelSteps', { label: preset.control.label })}>
            <NumberField label={t('common.start')} value={p.text('cstart')} unit={preset.control.unit} allowBlank placeholder={userText(preset.control.start)} onCommit={(t) => p.set('cstart', t)} title={t('tip.iv.cstart')} size={6} />
            <NumberField label={t('common.stop')} value={p.text('cstop')} unit={preset.control.unit} allowBlank placeholder={userText(preset.control.stop)} onCommit={(t) => p.set('cstop', t)} title={t('tip.iv.cstop')} size={6} />
            <NumberField label={t('instruments.ivAnalyzer.steps')} value={p.text('csteps')} allowBlank integer min={1} max={50} placeholder={String(preset.control.steps)} onCommit={(t) => p.set('csteps', t)} title={t('tip.iv.csteps')} size={4} />
          </Section>
        )}
        <Section title={t('instruments.ivAnalyzer.displayRangeBlankAuto')}>
          <NumberField label={t('instruments.ivAnalyzer.vMin')} value={p.text('vmin')} unit="V" allowBlank onCommit={(t) => p.set('vmin', t)} title={t('tip.iv.range')} size={6} />
          <NumberField label={t('instruments.ivAnalyzer.vMax')} value={p.text('vmax')} unit="V" allowBlank onCommit={(t) => p.set('vmax', t)} title={t('tip.iv.range')} size={6} />
          <NumberField label={t('instruments.ivAnalyzer.iMin')} value={p.text('imin')} unit="A" allowBlank onCommit={(t) => p.set('imin', t)} title={t('tip.iv.range')} size={6} />
          <NumberField label={t('instruments.ivAnalyzer.iMax')} value={p.text('imax')} unit="A" allowBlank onCommit={(t) => p.set('imax', t)} title={t('tip.iv.range')} size={6} />
        </Section>
      </div>
    </div>
  );
}
