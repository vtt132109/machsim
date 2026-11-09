/**
 * Front panel of the bench oscilloscopes: the 4-channel digital storage oscilloscope
 * (bench-scope) and the mixed-signal oscilloscope (mixed-signal-scope: 2 analog + 16 logic lanes).
 *
 * Screen: 10 × 8 divisions (analog), logic lanes underneath on the MSO, an FFT pane when the math
 * function is FFT. Keys: Run / Stop, Single, Auto setup; per channel on/off, V/div, position,
 * coupling; s/div and position; trigger source (channels, EXT, logic lanes), level, slope, mode;
 * math (A + B, A − B, A × B, FFT); up to six automatic measurements; two time cursors; CSV / PNG.
 * Acquisition is scope.ts (selectSweep); measurements and FFT are benchScope.ts.
 * Params: see benchScopeParams in src/library/parts/benchInstruments.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { formatEng, parseUserNumber } from '../../util/units';
import { downloadCanvasPng, downloadText, safeFileName } from '../results/canvas';
import { decimateMinMax } from '../results/plotModel';
import type { WindowKind } from '../results/dsp';
import { NotConnected, NumberField, Screen, Section, Segmented, SelectField, StepField, eng, paramApi } from './panelKit';
import { SCOPE_DIVS_X, SCOPE_DIVS_Y, applyCoupling, sampleAt, scopeCsv, selectSweep, windowMean } from './scope';
import type { Coupling, SweepWindow, TriggerEdge, TriggerMode } from './scope';
import {
  MEASURE_TYPES,
  MEASURE_UNITS,
  autoSetup,
  busValue,
  formatMeasureSlots,
  logicBit,
  mathChannel,
  nice125,
  measureDelay,
  measureWaveform,
  parseMeasureSlots,
  windowFft,
  type MathOp,
  type MeasureSlot,
  type MeasureType,
} from './benchScope';
import { drawCursor, drawGraticule, drawLabel, readScreenColors, strokeCurve, type Rect } from './screen';
import type { InstrumentPanelProps } from './types';
import { t, tDynamic } from '../../i18n';

interface ChannelState {
  on: boolean;
  scale: number;
  pos: number;
  coupling: Coupling;
}

interface BenchScopeSettings {
  timebase: number;
  xpos: number;
  xy: boolean;
  channels: Record<string, ChannelState>;
  source: string;
  level: number;
  edge: TriggerEdge;
  mode: TriggerMode;
  stopped: boolean;
  math: MathOp;
  mathA: string;
  mathB: string;
  fftWindow: WindowKind;
  slots: MeasureSlot[];
  t1: number;
  t2: number;
  digital: boolean;
  threshold: number;
  bus: 'off' | 'hex' | 'bin';
}

const DEFAULTS: Record<string, string> = {
  timebase: '1m',
  xpos: '0',
  display: 'yt',
  'trig.source': 'A',
  'trig.level': '0',
  'trig.edge': 'rising',
  'trig.mode': 'auto',
  run: 'run',
  'math.op': 'off',
  'math.a': 'A',
  'math.b': 'B',
  'fft.window': 'hann',
  meas: 'freq:A,vpp:A,vrms:A,freq:B,vpp:B',
  t1: '2',
  t2: '7',
  'dig.on': 'on',
  'dig.threshold': '1.4',
  'dig.bus': 'hex',
};
for (const [i, ch] of ['A', 'B', 'C', 'D'].entries()) {
  DEFAULTS[`${ch}.on`] = i < 2 ? 'on' : 'off';
  DEFAULTS[`${ch}.scale`] = '1';
  DEFAULTS[`${ch}.pos`] = '0';
  DEFAULTS[`${ch}.coupling`] = 'dc';
}

const LANES = Array.from({ length: 16 }, (_, k) => `d${k}`);

function parseSettings(params: Record<string, string>, chans: readonly string[]): BenchScopeSettings {
  const get = (k: string) => (params[k] ?? DEFAULTS[k] ?? '').trim();
  const num = (k: string, f: number) => {
    const v = parseUserNumber(get(k));
    return Number.isFinite(v) ? v : f;
  };
  const channels: Record<string, ChannelState> = {};
  for (const ch of chans) {
    const sc = num(`${ch}.scale`, 1);
    const cp = get(`${ch}.coupling`).toLowerCase();
    channels[ch] = { on: get(`${ch}.on`) !== 'off', scale: sc > 0 ? sc : 1, pos: num(`${ch}.pos`, 0), coupling: cp === 'ac' || cp === 'gnd' ? cp : 'dc' };
  }
  const tb = num('timebase', 1e-3);
  const mode = get('trig.mode').toLowerCase();
  const op = get('math.op').toLowerCase();
  const win = get('fft.window').toLowerCase();
  const src = get('trig.source');
  const bus = get('dig.bus').toLowerCase();
  return {
    timebase: tb > 0 ? tb : 1e-3,
    xpos: num('xpos', 0),
    xy: get('display').toLowerCase() === 'xy',
    channels,
    source: src === 'ext' || chans.includes(src) || LANES.includes(src) ? src : chans[0],
    level: num('trig.level', 0),
    edge: get('trig.edge').toLowerCase() === 'falling' ? 'falling' : 'rising',
    mode: mode === 'normal' || mode === 'single' ? mode : 'auto',
    stopped: get('run').toLowerCase() === 'stop',
    math: op === 'add' || op === 'sub' || op === 'mul' || op === 'fft' ? op : 'off',
    mathA: chans.includes(get('math.a')) ? get('math.a') : chans[0],
    mathB: chans.includes(get('math.b')) ? get('math.b') : (chans[1] ?? chans[0]),
    fftWindow: win === 'rect' || win === 'flattop' ? win : 'hann',
    slots: parseMeasureSlots(get('meas')),
    t1: Math.max(0, Math.min(10, num('t1', 2))),
    t2: Math.max(0, Math.min(10, num('t2', 7))),
    digital: get('dig.on') !== 'off',
    threshold: num('dig.threshold', 1.4),
    bus: bus === 'off' || bus === 'bin' ? bus : 'hex',
  };
}


interface Capture {
  window: SweepWindow;
  time: Float64Array;
  values: Record<string, Float64Array>;
}

/** Analog screen rectangle (10:8) inside the top part of the canvas. */
function analogRect(w: number, h: number): Rect {
  const padX = 8;
  const padTop = 18;
  const aw = w - 2 * padX;
  const ah = h - padTop - 6;
  const gw = Math.min(aw, (ah * SCOPE_DIVS_X) / SCOPE_DIVS_Y);
  const gh = (gw * SCOPE_DIVS_Y) / SCOPE_DIVS_X;
  return { x: Math.round((w - gw) / 2), y: padTop, w: Math.round(gw), h: Math.round(gh) };
}

const CH_LABEL = (ch: string) => (ch === 'ext' ? 'EXT' : /^d\d+$/.test(ch) ? ch.toUpperCase() : `CH${'ABCD'.indexOf(ch) + 1}`);

export function BenchScopePanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const mso = binding.kind === 'mixed-signal-scope';
  const chans = useMemo(() => (mso ? ['A', 'B'] : ['A', 'B', 'C', 'D']), [mso]);
  const p = paramApi(params, onParamsChange, DEFAULTS);
  const s = parseSettings({ ...DEFAULTS, ...params }, chans);
  const [sel, setSel] = useState('A');
  const prev = useRef<SweepWindow | null>(null);
  const frozen = useRef<Capture | null>(null);
  const armedAt = useRef(Number.NEGATIVE_INFINITY);
  const lastMode = useRef<TriggerMode | null>(null);
  const [armCount, setArmCount] = useState(0);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<0 | 1 | null>(null);
  const lanes = useMemo(() => (mso ? LANES.filter((l) => binding.channels[l]) : []), [mso, binding.channels]);
  const showLanes = mso && s.digital && lanes.length > 0;
  const fftOn = s.math === 'fft';

  if (lastMode.current !== s.mode) {
    if (s.mode === 'single') armedAt.current = Number.isFinite(stream.endTime) ? stream.endTime : Number.NEGATIVE_INFINITY;
    lastMode.current = s.mode;
  }

  const allCh = useMemo(() => [...chans, ...lanes], [chans, lanes]);
  const acqKey = JSON.stringify([s.timebase, s.xpos, s.mode, s.edge, s.level, s.source, chans.map((c) => s.channels[c].coupling), s.threshold]);
  const live: Capture | null = useMemo(() => {
    if (stream.length < 2) return null;
    const span = SCOPE_DIVS_X * s.timebase;
    const offset = s.xpos * s.timebase;
    const trigCh = s.source;
    const look = (s.mode === 'normal' ? 66 : s.mode === 'single' ? Math.max(6, (stream.endTime - armedAt.current) / span + 2) : 6) * span + Math.abs(offset);
    const trig = stream.readRecent(look, 1 << 18, [trigCh]);
    let tv = trig.values[trigCh] ?? new Float64Array(trig.time.length);
    const isLane = trigCh.startsWith('d');
    if (!isLane && trigCh !== 'ext' && s.channels[trigCh]?.coupling === 'ac' && trig.time.length > 1) {
      const m = windowMean(trig.time, tv, trig.time[0], trig.time[trig.time.length - 1]);
      tv = tv.map((v) => v - m);
    }
    const level = isLane ? s.threshold : s.level;
    const hysteresis = isLane ? 0.05 * Math.max(Math.abs(s.threshold), 0.1) : trigCh === 'ext' ? 1e-3 + 0.002 * Math.abs(level) : 0.1 * (s.channels[trigCh]?.scale ?? 1);
    const win = selectSweep({ start: stream.startTime, end: stream.endTime, trigTime: trig.time, trigValues: tv }, { timebase: s.timebase, xpos: s.xpos, mode: s.mode, edge: s.edge, level, hysteresis }, prev.current, armedAt.current);
    const data = stream.read(win.left, win.right, { channels: allCh });
    const values: Record<string, Float64Array> = {};
    for (const ch of chans) values[ch] = applyCoupling(data.time, data.values[ch], s.channels[ch].coupling, win.left, win.right);
    for (const l of lanes) values[l] = data.values[l];
    return { window: win, time: data.time, values };
  }, [stream, stream.version, acqKey, armCount, allCh]);

  useEffect(() => {
    if (live) prev.current = live.window;
  }, [live]);
  if (!s.stopped && live) frozen.current = live;
  const capture = s.stopped ? frozen.current : live;

  const reArm = () => {
    armedAt.current = Number.isFinite(stream.endTime) ? stream.endTime : Number.NEGATIVE_INFINITY;
    prev.current = null;
    setArmCount((n) => n + 1);
    p.patch({ 'trig.mode': 'single', run: 'run' });
  };
  const doAutoSetup = () => {
    const rec = stream.readRecent(Number.POSITIVE_INFINITY, 1 << 17, chans);
    const wired: Record<string, Float64Array | undefined> = {};
    for (const ch of chans) if (binding.channels[ch]) wired[ch] = rec.values[ch];
    const patch = autoSetup(rec.time, wired, chans);
    if (Object.keys(patch).length) p.patch({ ...patch, run: 'run' });
  };

  const mathValues = useMemo(() => {
    if (!capture || s.math === 'off' || s.math === 'fft') return null;
    return mathChannel(s.math, capture.values[s.mathA], capture.values[s.mathB]);
  }, [capture, s.math, s.mathA, s.mathB]);
  const fft = useMemo(() => (capture && fftOn ? windowFft(capture.time, capture.values[s.mathA], capture.window.left, capture.window.right, s.fftWindow) : null), [capture, fftOn, s.mathA, s.fftWindow]);

  const height = 300 + (showLanes ? 16 * lanes.length + 20 : 0) + (fftOn ? 150 : 0);

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    const r = analogRect(w, 300);
    drawGraticule(ctx, r, SCOPE_DIVS_X, SCOPE_DIVS_Y, c);
    const divW = r.w / SCOPE_DIVS_X;
    const divH = r.h / SCOPE_DIVS_Y;
    const colorOf = (ch: string) => c.traces[Math.max(0, chans.indexOf(ch)) % c.traces.length];
    const yOf = (v: number, ch: string) => r.y + r.h / 2 - (v / s.channels[ch].scale + s.channels[ch].pos) * divH;
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    if (!capture) {
      drawLabel(ctx, running ? t('bench.scope.waiting') : t('bench.scope.startRun'), r.x + r.w / 2, r.y + r.h / 2 - 8, c.text, c.bg, 'center');
      return;
    }
    const { window: win, time, values } = capture;
    const span = win.right - win.left;
    const xOfT = (tt: number) => r.x + ((tt - win.left) / span) * r.w;
    const curve = (ys: ArrayLike<number>, ch: string, color: string) => {
      let tx: ArrayLike<number> = time;
      let ty: ArrayLike<number> = ys;
      if (time.length > 4 * r.w) {
        const d = decimateMinMax(time, ys, 0, time.length - 1, (tt) => xOfT(tt));
        tx = d.x;
        ty = d.y;
      }
      const px = new Float64Array(tx.length);
      const py = new Float64Array(tx.length);
      for (let i = 0; i < tx.length; i++) {
        px[i] = xOfT(tx[i]);
        py[i] = yOf(ty[i], ch);
      }
      strokeCurve(ctx, px, py, color, r, 1.6);
    };
    if (s.xy) {
      const xs = values.A;
      const ys = values.B;
      const px = new Float64Array(time.length);
      const py = new Float64Array(time.length);
      for (let i = 0; i < time.length; i++) {
        px[i] = r.x + r.w / 2 + (xs[i] / s.channels.A.scale + s.channels.A.pos) * divW;
        py[i] = yOf(ys[i], 'B');
      }
      strokeCurve(ctx, px, py, colorOf('B'), r, 1.6);
      drawLabel(ctx, t('bench.scope.xyLabel'), r.x + 4, r.y + 4, c.text, c.bg);
    } else {
      for (const ch of chans) if (s.channels[ch].on && binding.channels[ch]) curve(values[ch], ch, colorOf(ch));
      if (mathValues) curve(mathValues, s.mathA, c.marker);
      if (win.trigger !== null) {
        const tx0 = xOfT(win.trigger);
        if (tx0 >= r.x && tx0 <= r.x + r.w) {
          ctx.fillStyle = c.marker;
          ctx.beginPath();
          ctx.moveTo(tx0 - 5, r.y - 7);
          ctx.lineTo(tx0 + 5, r.y - 7);
          ctx.lineTo(tx0, r.y - 1);
          ctx.fill();
        }
      }
      drawCursor(ctx, r.x + s.t1 * divW, r, c.cursor1, '1');
      drawCursor(ctx, r.x + s.t2 * divW, r, c.cursor2, '2');
    }
    ctx.fillStyle = c.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const status = s.stopped ? t('bench.scope.stopped') : win.status === 'triggered' ? t('bench.scope.trigd') : win.status === 'stopped' ? t('bench.scope.single') : win.status === 'waiting' ? t('bench.scope.wait') : t('bench.scope.auto');
    ctx.fillText(`${status}  ${formatEng(s.timebase, 's', 3)}/div`, 8, 2);
    ctx.textAlign = 'right';
    ctx.fillText(
      chans
        .filter((ch) => s.channels[ch].on && binding.channels[ch])
        .map((ch) => `${CH_LABEL(ch)} ${formatEng(s.channels[ch].scale, 'V', 3)}/div`)
        .join('  '),
      w - 8,
      2,
    );
    let y = 300;
    // logic lanes
    if (showLanes) {
      const laneH = 16;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      lanes.forEach((lane, k) => {
        const top = y + 4 + k * laneH;
        const hi = top + 3;
        const lo = top + laneH - 3;
        ctx.fillStyle = c.text;
        ctx.fillText(lane.toUpperCase(), 2, top + laneH / 2);
        const v = values[lane];
        if (!v) return;
        const px: number[] = [];
        const py: number[] = [];
        let last: number | null = null;
        for (let i = 0; i < time.length; i++) {
          const b = logicBit(v[i], s.threshold);
          const yy = b === 1 ? hi : lo;
          const xx = xOfT(time[i]);
          if (last !== null && yy !== last) {
            px.push(xx);
            py.push(last);
          }
          px.push(xx);
          py.push(yy);
          last = yy;
        }
        strokeCurve(ctx, px, py, c.traces[(k + 2) % c.traces.length], { x: r.x, y: top, w: r.w, h: laneH }, 1.2);
      });
      y += 4 + lanes.length * laneH;
      if (s.bus !== 'off') {
        const laneVals = LANES.map((l) => values[l]);
        const width = Math.max(...lanes.map((l) => Number(l.slice(1)) + 1));
        let prevV: number | null | undefined;
        ctx.fillStyle = c.text;
        ctx.textAlign = 'left';
        for (let i = 0; i < time.length; i++) {
          const bv = busValue(laneVals, i, s.threshold, width);
          if (bv !== prevV) {
            const xx = xOfT(time[i]);
            if (xx >= r.x && xx <= r.x + r.w - 20) {
              ctx.strokeStyle = c.gridMajor;
              ctx.beginPath();
              ctx.moveTo(xx + 0.5, y + 2);
              ctx.lineTo(xx + 0.5, y + 14);
              ctx.stroke();
              ctx.fillText(bv === null ? '?' : s.bus === 'hex' ? bv.toString(16).toUpperCase() : bv.toString(2).padStart(width, '0'), xx + 3, y + 8);
            }
            prevV = bv;
          }
        }
        y += 16;
      }
    }
    // FFT pane
    if (fftOn && fft) {
      const fr: Rect = { x: r.x, y: y + 6, w: r.w, h: 140 };
      drawGraticule(ctx, fr, 10, 5, c);
      // span: about 20 × the strongest tone (harmonics visible), at most the Nyquist frequency
      const nyquist = fft.freq[fft.freq.length - 1] || 1;
      const fmax = Number.isFinite(fft.peakFreq) && fft.peakFreq > 0 ? Math.min(nyquist, nice125(fft.peakFreq * 20)) : nyquist;
      const dbTop = 20;
      const dbBottom = -100;
      const px = new Float64Array(fft.freq.length);
      const py = new Float64Array(fft.freq.length);
      for (let k = 0; k < fft.freq.length; k++) {
        px[k] = fft.freq[k] <= fmax * 1.001 ? fr.x + (fft.freq[k] / fmax) * fr.w : Number.NaN;
        py[k] = fr.y + ((dbTop - Math.max(dbBottom, Math.min(dbTop, fft.db[k]))) / (dbTop - dbBottom)) * fr.h;
      }
      strokeCurve(ctx, px, py, c.marker, fr, 1.2);
      drawLabel(ctx, t('bench.scope.fftLabel', { df: formatEng(fmax / 10, 'Hz', 3), peak: formatEng(fft.peakFreq, 'Hz', 4), db: fft.peakDb.toFixed(1) }), fr.x + 4, fr.y + 4, c.text, c.bg);
    }
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>, x: number, y: number) => {
    if (s.xy) return;
    const canvas = e.currentTarget;
    const r = analogRect(canvas.clientWidth, 300);
    if (y > r.y + r.h) return;
    const divW = r.w / SCOPE_DIVS_X;
    const d1 = Math.abs(r.x + s.t1 * divW - x);
    const d2 = Math.abs(r.x + s.t2 * divW - x);
    if (Math.min(d1, d2) > 10) return;
    drag.current = d1 <= d2 ? 0 : 1;
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>, x: number) => {
    const canvas = e.currentTarget;
    const r = analogRect(canvas.clientWidth, 300);
    const divW = r.w / SCOPE_DIVS_X;
    if (drag.current === null) return;
    const div = Math.max(0, Math.min(SCOPE_DIVS_X, (x - r.x) / divW));
    p.set(drag.current === 0 ? 't1' : 't2', div.toFixed(3));
  };

  // measurements
  const measured = useMemo(() => {
    if (!capture) return [];
    const { time, values, window: win } = capture;
    const cache = new Map<string, ReturnType<typeof measureWaveform>>();
    return s.slots.map((slot) => {
      const v = values[slot.ch];
      if (!v || !binding.channels[slot.ch]) return { slot, value: Number.NaN };
      if (slot.type === 'delay' || slot.type === 'phase') {
        const other = slot.ch === 'A' ? 'B' : 'A';
        const d = values[other] ? measureDelay(time, values[other], v, win.left, win.right) : { delay: Number.NaN, phase: Number.NaN };
        return { slot, value: slot.type === 'delay' ? d.delay : d.phase };
      }
      let m = cache.get(slot.ch);
      if (!m) {
        m = measureWaveform(time, v, win.left, win.right);
        cache.set(slot.ch, m);
      }
      return { slot, value: m[slot.type as Exclude<MeasureType, 'delay' | 'phase'>] as number };
    });
  }, [capture, s.slots, binding.channels]);

  const setSlot = (i: number, patch: Partial<MeasureSlot>) => {
    const next = s.slots.map((x, k) => (k === i ? { ...x, ...patch } : x));
    p.set('meas', formatMeasureSlots(next));
  };
  const addSlot = () => p.set('meas', formatMeasureSlots([...s.slots, { type: 'freq' as MeasureType, ch: sel }].slice(0, 6)));
  const removeSlot = (i: number) => p.set('meas', formatMeasureSlots(s.slots.filter((_, k) => k !== i)));

  const tAt = (div: number) => (capture ? capture.window.left + div * s.timebase : Number.NaN);
  const t1 = tAt(s.t1);
  const t2 = tAt(s.t2);
  const connected = chans.filter((ch) => binding.channels[ch]);
  const ch = s.channels[sel] ? sel : chans[0];
  const cs = s.channels[ch];

  const exportCsv = () => {
    if (!capture) return;
    const cols = [...connected.map((c) => ({ name: CH_LABEL(c), values: capture.values[c] })), ...lanes.map((l) => ({ name: l.toUpperCase(), values: capture.values[l] }))];
    downloadText(`${safeFileName(binding.refdes)}_dso.csv`, scopeCsv(capture.time, cols));
  };
  const trigOptions: (readonly [string, string])[] = [...chans.map((c) => [c, CH_LABEL(c)] as const), ['ext', 'EXT'] as const, ...(mso ? LANES.map((l) => [l, l.toUpperCase()] as const) : [])];

  return (
    <div className={`msi-panel msi-bench msi-bench-scope${mso ? ' msi-bench-mso' : ''}`}>
      <div className="msi-bench-scope-main">
        <div className="msi-bench-scope-screen">
          <Screen
            draw={draw}
            height={height}
            ariaLabel={t('bench.scope.screenAria', { tb: formatEng(s.timebase, 's', 3) })}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => {
              drag.current = null;
            }}
            canvasRef={(c) => {
              canvasEl.current = c;
            }}
          />
          {connected.length === 0 && lanes.length === 0 && <NotConnected what={t('bench.scope.notConnected')} />}
          <div className="msi-bench-measure" aria-label={t('bench.scope.measureTitle')}>
            {measured.map(({ slot, value }, i) => (
              <span key={i} className={`msi-bench-meas msi-ch-${slot.ch}`}>
                {CH_LABEL(slot.ch)} {tDynamic(`bench.meas.${slot.type}`)}: {Number.isFinite(value) ? eng(value, MEASURE_UNITS[slot.type], 4) : '—'}
              </span>
            ))}
          </div>
          {!s.xy && (
            <div className="msi-row msi-secondary">
              <span className="msi-cur1">T1 {eng(t1, 's', 4)}</span>
              <span className="msi-cur2">T2 {eng(t2, 's', 4)}</span>
              <span>ΔT {eng(t2 - t1, 's', 4)}</span>
              <span>1/ΔT {eng(1 / (t2 - t1), 'Hz', 4)}</span>
              {capture &&
                connected.map((c) => (
                  <span key={c} className={`msi-ch-${c}`}>
                    {CH_LABEL(c)} ΔV {eng(sampleAt(capture.time, capture.values[c], t2) - sampleAt(capture.time, capture.values[c], t1), 'V', 4)}
                  </span>
                ))}
            </div>
          )}
        </div>
        <div className="msi-bench-scope-keys">
          <div className="msi-row">
            <button type="button" className={`msi-btn msi-bench-run${s.stopped ? ' msi-bench-stopped' : ''}`} onClick={() => p.set('run', s.stopped ? 'run' : 'stop')} title={t('tip.bench.scope.run')}>
              {s.stopped ? t('bench.scope.run') : t('bench.scope.stop')}
            </button>
            <button type="button" className="msi-btn" onClick={reArm} title={t('tip.bench.scope.single')}>
              {t('bench.scope.singleKey')}
            </button>
            <button type="button" className="msi-btn msi-btn-primary" onClick={doAutoSetup} disabled={stream.length < 4} title={t('tip.bench.scope.autoset')}>
              {t('bench.scope.autoset')}
            </button>
          </div>
          <Section title={t('bench.scope.vertical')}>
            <Segmented
              small
              value={ch}
              options={chans.map((c) => [c, CH_LABEL(c), t('tip.bench.scope.selectChannel', { ch: CH_LABEL(c) })] as const)}
              onChange={(v) => setSel(v)}
              title={t('tip.bench.scope.channel')}
            />
            <button type="button" className={`msi-btn${cs.on ? ' msi-on' : ''}`} aria-pressed={cs.on} onClick={() => p.set(`${ch}.on`, cs.on ? 'off' : 'on')} title={t('tip.bench.scope.channelOn')}>
              {cs.on ? t('bench.scope.on') : t('bench.scope.off')}
            </button>
            <StepField label={t('bench.scope.vdiv')} value={p.text(`${ch}.scale`)} unit="V/div" onCommit={(v) => p.set(`${ch}.scale`, v)} title={t('tip.scope.vdiv')} min={1e-6} max={1e4} />
            <NumberField label={t('bench.scope.position')} value={p.text(`${ch}.pos`)} unit="div" onCommit={(v) => p.set(`${ch}.pos`, v)} title={t('tip.scope.ypos')} size={5} />
            <Segmented
              small
              value={cs.coupling}
              options={[
                ['dc', 'DC', t('instruments.oscilloscope.directCoupling')],
                ['ac', 'AC', t('instruments.oscilloscope.removeTheDcComponent')],
                ['gnd', 'GND', t('instruments.oscilloscope.inputGrounded')],
              ]}
              onChange={(v) => p.set(`${ch}.coupling`, v)}
              title={t('tip.scope.coupling')}
            />
          </Section>
          <Section title={t('bench.scope.horizontal')}>
            <StepField label={t('bench.scope.sdiv')} value={p.text('timebase')} unit="s/div" onCommit={(v) => p.set('timebase', v)} title={t('tip.scope.timebase')} min={1e-12} max={1e3} />
            <NumberField label={t('bench.scope.position')} value={p.text('xpos')} unit="div" onCommit={(v) => p.set('xpos', v)} title={t('tip.scope.xpos')} size={5} />
            {!mso && (
              <Segmented
                small
                value={s.xy ? 'xy' : 'yt'}
                options={[
                  ['yt', 'Y-T', t('tip.bench.scope.yt')],
                  ['xy', 'X-Y', t('tip.bench.scope.xy')],
                ]}
                onChange={(v) => p.set('display', v)}
                title={t('tip.bench.scope.display')}
              />
            )}
          </Section>
          <Section title={t('bench.scope.trigger')}>
            <SelectField label={t('bench.scope.source')} value={s.source} options={trigOptions} onChange={(v) => p.set('trig.source', v)} title={t('tip.scope.trigSource')} />
            {!s.source.startsWith('d') && <NumberField label={t('bench.scope.level')} value={p.text('trig.level')} unit="V" onCommit={(v) => p.set('trig.level', v)} title={t('tip.scope.trigLevel')} size={6} />}
            <Segmented
              small
              value={s.edge}
              options={[
                ['rising', '↑', t('instruments.oscilloscope.risingEdge')],
                ['falling', '↓', t('instruments.oscilloscope.fallingEdge')],
              ]}
              onChange={(v) => p.set('trig.edge', v)}
              title={t('tip.scope.trigEdge')}
            />
            <Segmented
              small
              value={s.mode}
              options={[
                ['auto', t('bench.scope.modeAuto'), t('tip.bench.scope.modeAuto')],
                ['normal', t('bench.scope.modeNormal'), t('tip.bench.scope.modeNormal')],
                ['single', t('bench.scope.modeSingle'), t('tip.bench.scope.single')],
              ]}
              onChange={(v) => p.set('trig.mode', v)}
              title={t('tip.scope.trigMode')}
            />
          </Section>
          <Section title={t('bench.scope.mathTitle')}>
            <Segmented
              small
              value={s.math}
              options={(['off', 'add', 'sub', 'mul', 'fft'] as MathOp[]).map((m) => [m, tDynamic(`bench.scope.math.${m}`), tDynamic(`tip.bench.scope.math.${m}`)] as const)}
              onChange={(v) => p.set('math.op', v)}
              title={t('tip.bench.scope.math')}
            />
            {s.math !== 'off' && <SelectField label={t('bench.scope.mathA')} value={s.mathA} options={chans.map((c) => [c, CH_LABEL(c)] as const)} onChange={(v) => p.set('math.a', v)} title={t('tip.bench.scope.mathA')} />}
            {s.math !== 'off' && s.math !== 'fft' && <SelectField label={t('bench.scope.mathB')} value={s.mathB} options={chans.map((c) => [c, CH_LABEL(c)] as const)} onChange={(v) => p.set('math.b', v)} title={t('tip.bench.scope.mathB')} />}
            {s.math === 'fft' && (
              <SelectField
                label={t('bench.scope.fftWindow')}
                value={s.fftWindow}
                options={[
                  ['hann', t('bench.scope.hann')],
                  ['flattop', t('bench.scope.flattop')],
                  ['rect', t('bench.scope.rect')],
                ]}
                onChange={(v) => p.set('fft.window', v)}
                title={t('tip.bench.scope.fftWindow')}
              />
            )}
          </Section>
          {mso && (
            <Section title={t('bench.scope.logicTitle')}>
              <button type="button" className={`msi-btn${s.digital ? ' msi-on' : ''}`} aria-pressed={s.digital} onClick={() => p.set('dig.on', s.digital ? 'off' : 'on')} title={t('tip.bench.scope.logicOn')}>
                {s.digital ? t('bench.scope.on') : t('bench.scope.off')}
              </button>
              <NumberField label={t('bench.scope.threshold')} value={p.text('dig.threshold')} unit="V" onCommit={(v) => p.set('dig.threshold', v)} title={t('tip.bench.scope.threshold')} size={5} />
              <Segmented
                small
                value={s.bus}
                options={[
                  ['off', t('bench.scope.off'), t('tip.bench.scope.busOff')],
                  ['hex', 'Hex', t('tip.bench.scope.busHex')],
                  ['bin', t('bench.scope.binary'), t('tip.bench.scope.busBin')],
                ]}
                onChange={(v) => p.set('dig.bus', v)}
                title={t('tip.bench.scope.bus')}
              />
              {lanes.length === 0 && <span className="msi-dim">{t('bench.scope.noLanes')}</span>}
            </Section>
          )}
          <Section title={t('bench.scope.measureTitle')}>
            {s.slots.map((slot, i) => (
              <div key={i} className="msi-row">
                <SelectField label={t('bench.scope.measure', { n: i + 1 })} value={slot.type} options={MEASURE_TYPES.map((m) => [m, tDynamic(`bench.meas.${m}`)] as const)} onChange={(v) => setSlot(i, { type: v })} title={t('tip.bench.scope.measureType')} />
                <SelectField label={t('bench.scope.source')} value={slot.ch} options={chans.map((c) => [c, CH_LABEL(c)] as const)} onChange={(v) => setSlot(i, { ch: v })} title={t('tip.bench.scope.measureSource')} />
                <button type="button" className="msi-btn msi-btn-icon" onClick={() => removeSlot(i)} title={t('tip.bench.scope.measureRemove')} aria-label={t('tip.bench.scope.measureRemove')}>
                  ×
                </button>
              </div>
            ))}
            {s.slots.length < 6 && (
              <button type="button" className="msi-btn" onClick={addSlot} title={t('tip.bench.scope.measureAdd')}>
                {t('bench.scope.measureAdd')}
              </button>
            )}
          </Section>
          <div className="msi-row">
            <button type="button" className="msi-btn" onClick={exportCsv} disabled={!capture} title={t('tip.kit.saveCsv')}>
              {t('common.saveCsv')}
            </button>
            <button type="button" className="msi-btn" onClick={() => canvasEl.current && downloadCanvasPng(canvasEl.current, `${safeFileName(binding.refdes)}_dso.png`)} title={t('tip.kit.savePng')}>
              {t('instruments.oscilloscope.savePng')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
