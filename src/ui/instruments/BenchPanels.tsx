/**
 * Front panels of the bench waveform generator and the 6½-digit bench multimeter (original
 * generic designs: a dark display window above labelled key groups, Vietnamese labels).
 *
 * Generator params: see src/library/parts/benchSignals.ts (waveform, freq, amplitude [Vpp],
 * offset, duty, symmetry, width, edge, phase, arb, arbdata, mod, modfreq, depth, deviation,
 * cycles, burstperiod, sweepstop, sweeptime, load, output). The preview screen draws the same
 * waveform function the netlist uses (benchSample).
 *
 * Multimeter params: function, range (auto | full scale), rate, digits, math, nullvalue, dbref,
 * dbmref, limitlow, limithigh, zin (see benchDmm.ts). Statistics accumulate in the panel while it
 * is open (Clear resets them); they restart with a new simulation run.
 */
import { useMemo, useRef, useState } from 'react';
import { formatEng } from '../../util/units';
import { ARB_PRESETS, BENCH_GEN_DEFAULTS, benchGenSettings, benchSample, emfPeak, type ArbPreset, type BenchGenSettings, type BenchModulation, type BenchWaveform } from '../../library/parts/benchSignals';
import {
  BENCH_DMM_DEFAULTS,
  CONTINUITY_OHMS,
  addStat,
  dmmAutoRange,
  dmmFormat,
  dmmMath,
  dmmRanges,
  dmmReadings,
  dmmUnit,
  emptyStats,
  parseDmmSettings,
  statSdev,
  type DmmFunction,
  type DmmMath,
  type DmmRate,
  type DmmStats,
} from './benchDmm';
import { NotConnected, NumberField, Readout, Screen, Section, Segmented, SelectField, eng, paramApi, userText } from './panelKit';
import { drawGraticule, readScreenColors, strokeCurve } from './screen';
import type { InstrumentPanelProps, StreamWindow } from './types';
import { t, tDynamic } from '../../i18n';

// ---------------------------------------------------------------------------------------------
// waveform generator

const WAVE_FACES: Record<BenchWaveform, string> = {
  sine: '∿',
  square: '⊓',
  triangle: '△',
  ramp: '⊿',
  pulse: '⎍',
  noise: '≋',
  dc: '⎓',
  arb: 'ARB',
};

const waveOptions = () =>
  (Object.keys(WAVE_FACES) as BenchWaveform[]).map((w) => [w, WAVE_FACES[w], tDynamic(`tip.bench.wave.${w}`)] as const);

const modOptions = () =>
  (['none', 'am', 'fm', 'burst', 'sweep'] as BenchModulation[]).map((m) => [m, tDynamic(`bench.gen.mod.${m}`), tDynamic(`tip.bench.mod.${m}`)] as const);

function safeSettings(params: Record<string, string>): { s: BenchGenSettings | null; error: string | null } {
  try {
    return { s: benchGenSettings(params), error: null };
  } catch (e) {
    return { s: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Length of the preview: two periods, or one modulation / burst / sweep cycle. */
function previewSpan(s: BenchGenSettings): number {
  switch (s.mod) {
    case 'am':
    case 'fm':
      return 2 / s.modFreq;
    case 'burst':
      return s.burstPeriod * 1.2;
    case 'sweep':
      return s.sweepTime;
    default:
      return s.waveform === 'noise' ? 200 / s.freq : 2 / s.freq;
  }
}

export function BenchGeneratorPanel(props: InstrumentPanelProps) {
  const { binding, params, onParamsChange } = props;
  const p = paramApi(params, onParamsChange, BENCH_GEN_DEFAULTS);
  const merged = { ...BENCH_GEN_DEFAULTS, ...params };
  const { s, error } = safeSettings(merged);
  const wave = (merged.waveform ?? 'sine') as BenchWaveform;
  const mod = (merged.mod ?? 'none') as BenchModulation;
  const outputOn = (merged.output ?? 'on') !== 'off';

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    const r = { x: 6, y: 6, w: w - 12, h: h - 12 };
    drawGraticule(ctx, r, 10, 4, c);
    if (!s) return;
    const span = previewSpan(s);
    const a = Math.max(emfPeak(s) + Math.abs(s.offset), 1e-9);
    const n = Math.max(200, Math.min(4000, Math.round(r.w * 3)));
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const tt = (span * i) / (n - 1);
      xs[i] = r.x + (r.w * i) / (n - 1);
      ys[i] = r.y + r.h / 2 - (benchSample(s, tt) / a) * (r.h / 2) * 0.9;
    }
    strokeCurve(ctx, xs, ys, outputOn ? c.traces[0] : c.grid, r, 1.6);
  };

  const field = (key: string, unit: string, opts: { min?: number; max?: number; exclusiveMin?: boolean } = {}) => (
    <NumberField label={tDynamic(`bench.gen.${key}`)} value={p.text(key)} unit={unit} onCommit={(v) => p.set(key, v)} title={tDynamic(`tip.bench.gen.${key}`)} size={7} {...opts} />
  );

  return (
    <div className="msi-panel msi-bench msi-bench-gen">
      <div className="msi-bench-display" role="status" aria-label={t('bench.gen.displayAria', { f: s ? formatEng(s.freq, 'Hz', 7) : '—', a: s ? formatEng(s.vpp, 'Vpp', 5) : '—' })}>
        <div className="msi-bench-display-row">
          <span className="msi-bench-big">{s ? formatEng(s.freq, 'Hz', 7) : '—'}</span>
          <span className={`msi-bench-flag${outputOn ? ' msi-bench-flag-on' : ''}`}>{outputOn ? t('bench.gen.outputOn') : t('bench.gen.outputOff')}</span>
        </div>
        <div className="msi-bench-display-row msi-bench-small">
          <span>
            {t('bench.gen.ampShort')} {s ? formatEng(s.vpp, 'Vpp', 5) : '—'}
          </span>
          <span>
            {t('bench.gen.offsetShort')} {s ? formatEng(s.offset, 'V', 5) : '—'}
          </span>
          <span>{tDynamic(`bench.gen.wave.${wave}`)}</span>
          {mod !== 'none' && <span>{tDynamic(`bench.gen.mod.${mod}`)}</span>}
          <span>{merged.load === '50' ? t('bench.gen.load50') : t('bench.gen.loadHiz')}</span>
        </div>
      </div>
      <Screen draw={draw} height={110} ariaLabel={t('bench.gen.previewAria')} />
      {error && <div className="msi-field-error" role="alert">{t('bench.invalid', { detail: error })}</div>}
      {!binding.channels.out && <NotConnected what={t('bench.gen.notConnected')} />}
      <div className="msi-row">
        <Segmented label={t('bench.gen.waveform')} value={wave} options={waveOptions()} onChange={(v) => p.set('waveform', v)} title={t('tip.bench.gen.waveform')} />
        <button type="button" className={`msi-btn msi-bench-output${outputOn ? ' msi-on' : ''}`} aria-pressed={outputOn} onClick={() => p.set('output', outputOn ? 'off' : 'on')} title={t('tip.bench.gen.output')}>
          {t('bench.gen.output')}
        </button>
      </div>
      <div className="msi-bench-keys">
        <Section title={t('bench.gen.signal')}>
          {wave !== 'dc' && field('freq', 'Hz', { min: 0, exclusiveMin: true })}
          {wave !== 'dc' && field('amplitude', 'Vpp', { min: 0 })}
          {field('offset', 'V')}
          {wave === 'square' && field('duty', '%', { min: 1, max: 99 })}
          {wave === 'ramp' && field('symmetry', '%', { min: 0, max: 100 })}
          {wave === 'pulse' && field('width', 's', { min: 0, exclusiveMin: true })}
          {(wave === 'square' || wave === 'pulse') && field('edge', 's', { min: 0, exclusiveMin: true })}
          {wave !== 'dc' && wave !== 'noise' && wave !== 'arb' && field('phase', '°')}
        </Section>
        {wave === 'arb' && (
          <Section title={t('bench.gen.arbTitle')}>
            <SelectField label={t('bench.gen.arb')} value={(merged.arb ?? 'sinc') as ArbPreset} options={ARB_PRESETS.map((a) => [a, tDynamic(`bench.gen.arb.${a}`)] as const)} onChange={(v) => p.set('arb', v)} title={t('tip.bench.gen.arb')} />
            {merged.arb === 'user' && (
              <label className="msi-field msi-field-wide" title={t('tip.bench.gen.arbdata')}>
                <span className="msi-field-label">{t('bench.gen.arbdata')}</span>
                <textarea className="msi-input msi-mono" rows={2} defaultValue={merged.arbdata} onBlur={(e) => e.target.value !== merged.arbdata && p.set('arbdata', e.target.value)} spellCheck={false} />
              </label>
            )}
          </Section>
        )}
        <Section title={t('bench.gen.modTitle')}>
          <Segmented small value={mod} options={modOptions()} onChange={(v) => p.set('mod', v)} title={t('tip.bench.gen.mod')} />
          {(mod === 'am' || mod === 'fm') && field('modfreq', 'Hz', { min: 0, exclusiveMin: true })}
          {mod === 'am' && field('depth', '%', { min: 0, max: 120 })}
          {mod === 'fm' && field('deviation', 'Hz', { min: 0 })}
          {mod === 'burst' && field('cycles', '', { min: 1 })}
          {mod === 'burst' && field('burstperiod', 's', { min: 0, exclusiveMin: true })}
          {mod === 'sweep' && field('sweepstop', 'Hz', { min: 0, exclusiveMin: true })}
          {mod === 'sweep' && field('sweeptime', 's', { min: 0, exclusiveMin: true })}
          {mod !== 'none' && wave !== 'sine' && <span className="msi-dim">{t('bench.gen.modSineOnly')}</span>}
        </Section>
        <Section title={t('bench.gen.outputTitle')}>
          <Segmented
            small
            label={t('bench.gen.load')}
            value={merged.load === '50' ? '50' : 'hiz'}
            options={[
              ['hiz', t('bench.gen.loadHiz'), t('tip.bench.gen.loadHiz')],
              ['50', t('bench.gen.load50'), t('tip.bench.gen.load50')],
            ]}
            onChange={(v) => p.set('load', v)}
            title={t('tip.bench.gen.load')}
          />
          <span className="msi-dim">{t('bench.gen.zoutNote', { r: p.text('zout') })}</span>
        </Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 6½-digit multimeter

const FN_FACES: Record<DmmFunction, string> = { dcv: 'V⎓', acv: 'V∿', dci: 'A⎓', aci: 'A∿', ohm: 'Ω', freq: 'Hz', period: 'T', cont: '♪', diode: '▶|' };

const fnOptions = () => (Object.keys(FN_FACES) as DmmFunction[]).map((f) => [f, FN_FACES[f], tDynamic(`tip.bench.dmm.fn.${f}`)] as const);
const mathOptions = () => (['none', 'null', 'db', 'dbm', 'stats', 'limit'] as DmmMath[]).map((m) => [m, tDynamic(`bench.dmm.math.${m}`), tDynamic(`tip.bench.dmm.math.${m}`)] as const);

const MAX_SAMPLES = 1 << 17;

function useRecent(stream: InstrumentPanelProps['stream']): StreamWindow {
  const version = stream.version;
  return useMemo(() => stream.readRecent(Number.POSITIVE_INFINITY, MAX_SAMPLES, ['v', 'i']), [stream, version]);
}

export function BenchMultimeterPanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const p = paramApi(params, onParamsChange, BENCH_DMM_DEFAULTS);
  const s = parseDmmSettings({ ...BENCH_DMM_DEFAULTS, ...params });
  const data = useRecent(stream);
  const stats = useRef<{ key: string; last: number; st: DmmStats; latest: number }>({ key: '', last: -Infinity, st: emptyStats(), latest: Number.NaN });
  const [, setClear] = useState(0);
  // statistics restart when the function or the run changes (time going backwards = new run)
  const key = `${s.fn}|${s.rate}`;
  const t0 = data.time.length ? data.time[0] : Number.NaN;
  if (stats.current.key !== key || (Number.isFinite(t0) && t0 < stats.current.last && data.time[data.time.length - 1] < stats.current.last)) {
    stats.current = { key, last: -Infinity, st: emptyStats(), latest: Number.NaN };
  }
  const fresh = dmmReadings(data.time, data.values.v, data.values.i, s, stats.current.last);
  for (const r of fresh) {
    stats.current.st = addStat(stats.current.st, r.value);
    stats.current.latest = r.value;
    stats.current.last = r.t;
  }
  const reading = stats.current.latest;
  const unit = dmmUnit(s.fn);
  const range = s.range ?? dmmAutoRange(s.fn, reading);
  const ranges = dmmRanges(s.fn);
  const m = dmmMath(s, reading);
  const shown = m.unit
    ? { text: Number.isFinite(m.value) ? `${m.value >= 0 ? '+' : '−'}${Math.abs(m.value).toFixed(3)}` : '-------', unit: m.unit, overload: false, rangeLabel: '' }
    : dmmFormat(m.value, range, s.digits, unit);
  const continuity = s.fn === 'cont' && Number.isFinite(reading) && reading < CONTINUITY_OHMS;
  const open = (s.fn === 'diode' || s.fn === 'cont' || s.fn === 'ohm') && reading === Number.POSITIVE_INFINITY;
  const flags = [FN_FACES[s.fn], s.range === null ? t('bench.dmm.auto') : t('bench.dmm.manual')];
  if (s.math !== 'none') flags.push(tDynamic(`bench.dmm.math.${s.math}`));
  const wired = s.fn === 'dci' || s.fn === 'aci' ? !!binding.channels.i : !!binding.channels.v;
  const st = stats.current.st;
  const stepRange = (dir: 1 | -1) => {
    const idx = Math.max(0, ranges.indexOf(range));
    const next = ranges[Math.max(0, Math.min(ranges.length - 1, idx + dir))];
    p.set('range', userText(next));
  };
  return (
    <div className="msi-panel msi-bench msi-bench-dmm">
      <div className="msi-bench-display" role="status" aria-label={t('bench.dmm.readingAria', { value: `${shown.text} ${shown.unit}` })}>
        <div className="msi-bench-flags">
          {flags.map((f) => (
            <span key={f}>{f}</span>
          ))}
          {shown.rangeLabel && <span>{shown.rangeLabel}</span>}
          {continuity && <span className="msi-bench-flag-on">{t('bench.dmm.beep')}</span>}
          {m.limit && <span className={m.limit === 'pass' ? 'msi-bench-flag-on' : 'msi-bench-flag-bad'}>{tDynamic(`bench.dmm.limit.${m.limit}`)}</span>}
        </div>
        <div className="msi-bench-display-row">
          <span className="msi-bench-big msi-mono">{open ? t('bench.dmm.open') : shown.text}</span>
          <span className="msi-bench-unit">{shown.unit}</span>
        </div>
      </div>
      {!wired && <NotConnected what={s.fn === 'dci' || s.fn === 'aci' ? t('bench.dmm.connectCurrent') : t('bench.dmm.connectVoltage')} />}
      {wired && !data.time.length && <NotConnected what={running ? t('bench.dmm.waiting') : t('bench.dmm.startRun')} />}
      <div className="msi-row">
        <Segmented label={t('bench.dmm.function')} value={s.fn} options={fnOptions()} onChange={(v) => p.set('function', v)} title={t('tip.bench.dmm.function')} />
      </div>
      <div className="msi-bench-keys">
        <Section title={t('bench.dmm.rangeTitle')}>
          <button type="button" className={`msi-btn${s.range === null ? ' msi-on' : ''}`} aria-pressed={s.range === null} onClick={() => p.set('range', 'auto')} title={t('tip.bench.dmm.auto')}>
            {t('bench.dmm.auto')}
          </button>
          <button type="button" className="msi-btn msi-btn-icon" onClick={() => stepRange(-1)} title={t('tip.bench.dmm.rangeDown')} aria-label={t('tip.bench.dmm.rangeDown')}>
            ▼
          </button>
          <button type="button" className="msi-btn msi-btn-icon" onClick={() => stepRange(1)} title={t('tip.bench.dmm.rangeUp')} aria-label={t('tip.bench.dmm.rangeUp')}>
            ▲
          </button>
          <span className="msi-dim">{dmmFormat(0, range, s.digits, unit).rangeLabel}</span>
        </Section>
        <Section title={t('bench.dmm.rateTitle')}>
          <Segmented
            small
            value={s.rate}
            options={(['fast', 'medium', 'slow'] as DmmRate[]).map((r) => [r, tDynamic(`bench.dmm.rate.${r}`), tDynamic(`tip.bench.dmm.rate.${r}`)] as const)}
            onChange={(v) => p.set('rate', v)}
            title={t('tip.bench.dmm.rate')}
          />
          <Segmented
            small
            value={String(s.digits === 4 ? '4.5' : s.digits === 5 ? '5.5' : '6.5') as '4.5' | '5.5' | '6.5'}
            options={[
              ['4.5', '4½', t('tip.bench.dmm.digits')],
              ['5.5', '5½', t('tip.bench.dmm.digits')],
              ['6.5', '6½', t('tip.bench.dmm.digits')],
            ]}
            onChange={(v) => p.set('digits', v)}
            title={t('tip.bench.dmm.digits')}
          />
        </Section>
        <Section title={t('bench.dmm.mathTitle')}>
          <Segmented small value={s.math} options={mathOptions()} onChange={(v) => p.set('math', v)} title={t('tip.bench.dmm.math')} />
          {s.math === 'null' && (
            <>
              <NumberField label={t('bench.dmm.nullvalue')} value={p.text('nullvalue')} unit={unit} onCommit={(v) => p.set('nullvalue', v)} title={t('tip.bench.dmm.nullvalue')} size={8} />
              <button type="button" className="msi-btn" disabled={!Number.isFinite(reading)} onClick={() => p.set('nullvalue', userText(Number(reading.toPrecision(7))))} title={t('tip.bench.dmm.takeNull')}>
                {t('bench.dmm.takeNull')}
              </button>
            </>
          )}
          {s.math === 'db' && <NumberField label={t('bench.dmm.dbref')} value={p.text('dbref')} unit="V" min={0} exclusiveMin onCommit={(v) => p.set('dbref', v)} title={t('tip.bench.dmm.dbref')} size={6} />}
          {s.math === 'dbm' && <NumberField label={t('bench.dmm.dbmref')} value={p.text('dbmref')} unit="Ω" min={0} exclusiveMin onCommit={(v) => p.set('dbmref', v)} title={t('tip.bench.dmm.dbmref')} size={6} />}
          {s.math === 'limit' && (
            <>
              <NumberField label={t('bench.dmm.limitlow')} value={p.text('limitlow')} unit={unit} onCommit={(v) => p.set('limitlow', v)} title={t('tip.bench.dmm.limitlow')} size={7} />
              <NumberField label={t('bench.dmm.limithigh')} value={p.text('limithigh')} unit={unit} onCommit={(v) => p.set('limithigh', v)} title={t('tip.bench.dmm.limithigh')} size={7} />
            </>
          )}
        </Section>
      </div>
      {(s.math === 'stats' || st.count > 0) && (
        <div className="msi-row msi-secondary" aria-label={t('bench.dmm.statsTitle')}>
          <Readout label={t('bench.dmm.count')} value={String(st.count)} />
          <Readout label={t('bench.dmm.mean')} value={st.count ? eng(st.mean, unit, 7) : '—'} />
          <Readout label={t('bench.dmm.sdev')} value={st.count > 1 ? eng(statSdev(st), unit, 4) : '—'} />
          <Readout label={t('bench.dmm.min')} value={st.count ? eng(st.min, unit, 7) : '—'} />
          <Readout label={t('bench.dmm.max')} value={st.count ? eng(st.max, unit, 7) : '—'} />
          <button
            type="button"
            className="msi-btn"
            onClick={() => {
              stats.current = { key, last: data.time.length ? data.time[data.time.length - 1] : -Infinity, st: emptyStats(), latest: reading };
              setClear((n) => n + 1);
            }}
            title={t('tip.bench.dmm.clearStats')}
          >
            {t('bench.dmm.clearStats')}
          </button>
        </div>
      )}
      <div className="msi-row msi-secondary">
        <span className="msi-dim">{t('bench.dmm.terminals')}</span>
        <SelectField
          label={t('bench.dmm.zin')}
          value={(params.zin ?? BENCH_DMM_DEFAULTS.zin).trim() === '10G' ? '10G' : '10M'}
          options={[
            ['10M', '10 MΩ'],
            ['10G', t('bench.dmm.zinHigh')],
          ]}
          onChange={(v) => p.set('zin', v)}
          title={t('tip.bench.dmm.zin')}
        />
      </div>
    </div>
  );
}
