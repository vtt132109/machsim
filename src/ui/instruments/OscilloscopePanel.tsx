/**
 * Oscilloscope panel (2-channel and 4-channel instruments).
 *
 * Screen: 10 x 8 divisions. Y/T shows each channel against time; Add shows A + B (channel A
 * scale / position); B/A plots B vertically against A horizontally, A/B the reverse.
 * Controls: timebase (s/div, 1-2-5 steps), X position (div), per-channel V/div, Y position and
 * AC / 0 / DC coupling, trigger edge / level / source (channels or Ext) / mode
 * (single | normal | auto | none), two draggable cursors T1 / T2 with readouts, reverse
 * (white) screen and CSV export of the displayed sweep.
 *
 * Param keys: see SCOPE_DEFAULTS in scope.ts (timebase, xpos, display, trig.*, <ch>.scale,
 * <ch>.pos, <ch>.coupling, t1, t2, reverse). Acquisition logic lives in scope.ts.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { formatEng } from '../../util/units';
import { downloadCanvasPng, downloadText, safeFileName } from '../results/canvas';
import { decimateMinMax } from '../results/plotModel';
import { NotConnected, NumberField, Screen, Section, Segmented, StepField, eng, paramApi } from './panelKit';
import { SCOPE_DEFAULTS, SCOPE_DIVS_X, SCOPE_DIVS_Y, applyCoupling, parseScopeSettings, sampleAt, scopeCsv, selectSweep, windowMean } from './scope';
import type { Coupling, DisplayMode, SweepWindow, TriggerEdge, TriggerMode } from './scope';
import { drawCursor, drawGraticule, drawLabel, readScreenColors, strokeCurve } from './screen';
import type { Rect } from './screen';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';

const CHANNEL_DEFAULTS: Record<string, string> = {};
for (const ch of ['A', 'B', 'C', 'D']) {
  CHANNEL_DEFAULTS[`${ch}.scale`] = '1';
  CHANNEL_DEFAULTS[`${ch}.pos`] = '0';
  CHANNEL_DEFAULTS[`${ch}.coupling`] = 'dc';
}
const DEFAULTS = { ...SCOPE_DEFAULTS, ...CHANNEL_DEFAULTS };

/** Largest 10:8 rectangle centred in the canvas, leaving room for labels. */
function screenRect(w: number, h: number): Rect {
  const padX = 8;
  const padTop = 18;
  const padBottom = 8;
  const aw = w - 2 * padX;
  const ah = h - padTop - padBottom;
  const gw = Math.min(aw, (ah * SCOPE_DIVS_X) / SCOPE_DIVS_Y);
  const gh = (gw * SCOPE_DIVS_Y) / SCOPE_DIVS_X;
  return { x: Math.round((w - gw) / 2), y: Math.round(padTop + (ah - gh) / 2), w: Math.round(gw), h: Math.round(gh) };
}

interface Capture {
  window: SweepWindow;
  time: Float64Array;
  /** coupled values per channel */
  values: Record<string, Float64Array>;
}

export function OscilloscopePanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const four = binding.kind === 'oscilloscope-4ch';
  const chans = useMemo(() => (four ? ['A', 'B', 'C', 'D'] : ['A', 'B']), [four]);
  const p = paramApi(params, onParamsChange, DEFAULTS);
  const s = parseScopeSettings(params, chans);
  const prev = useRef<SweepWindow | null>(null);
  const armedAt = useRef(Number.NEGATIVE_INFINITY);
  const lastMode = useRef<TriggerMode | null>(null);
  const [armCount, setArmCount] = useState(0);
  const canvasEl = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<0 | 1 | null>(null);

  // entering single mode (or pressing Single) arms a new acquisition from the newest sample
  if (lastMode.current !== s.mode) {
    if (s.mode === 'single') armedAt.current = Number.isFinite(stream.endTime) ? stream.endTime : Number.NEGATIVE_INFINITY;
    lastMode.current = s.mode;
  }

  const acqKey = JSON.stringify([s.timebase, s.xpos, s.mode, s.edge, s.level, s.source, chans.map((ch) => [s.channels[ch].coupling, s.channels[ch].scale])]);
  const capture: Capture | null = useMemo(() => {
    if (stream.length < 2) return null;
    const span = SCOPE_DIVS_X * s.timebase;
    const offset = s.xpos * s.timebase;
    const trigCh = s.source;
    const lookBack = (s.mode === 'normal' ? 66 : s.mode === 'single' ? Math.max(6, (stream.endTime - armedAt.current) / span + 2) : 6) * span + Math.abs(offset);
    const trig = stream.readRecent(lookBack, 1 << 18, [trigCh]);
    let trigValues = trig.values[trigCh];
    const trigCoupling: Coupling = trigCh === 'ext' ? 'dc' : s.channels[trigCh]?.coupling ?? 'dc';
    if (trigCoupling === 'ac' && trig.time.length > 1) {
      const m = windowMean(trig.time, trigValues, trig.time[0], trig.time[trig.time.length - 1]);
      trigValues = trigValues.map((v) => v - m);
    }
    const hysteresis = trigCh === 'ext' ? 1e-3 + 0.002 * Math.abs(s.level) : 0.1 * (s.channels[trigCh]?.scale ?? 1);
    const win = selectSweep(
      { start: stream.startTime, end: stream.endTime, trigTime: trig.time, trigValues },
      { ...s, hysteresis },
      prev.current,
      armedAt.current,
    );
    const data = stream.read(win.left, win.right, { channels: chans });
    const values: Record<string, Float64Array> = {};
    for (const ch of chans) values[ch] = applyCoupling(data.time, data.values[ch], s.channels[ch].coupling, win.left, win.right);
    return { window: win, time: data.time, values };
    // acquisition depends on the stream contents and the acquisition settings only (not on the
    // cursors or the screen colours); armCount re-runs it after Re-arm is pressed
  }, [stream, stream.version, acqKey, armCount]);

  useEffect(() => {
    if (capture) prev.current = capture.window;
  }, [capture]);

  const reArm = () => {
    armedAt.current = Number.isFinite(stream.endTime) ? stream.endTime : Number.NEGATIVE_INFINITY;
    prev.current = null;
    setArmCount((n) => n + 1);
  };

  const connected = chans.filter((c) => binding.channels[c]);

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
      const c = readScreenColors(canvas, s.reverse);
      ctx.fillStyle = c.bg;
      ctx.fillRect(0, 0, w, h);
      const r = screenRect(w, h);
      drawGraticule(ctx, r, SCOPE_DIVS_X, SCOPE_DIVS_Y, c);
      const divW = r.w / SCOPE_DIVS_X;
      const divH = r.h / SCOPE_DIVS_Y;
      const yOf = (v: number, ch: string) => r.y + r.h / 2 - (v / s.channels[ch].scale + s.channels[ch].pos) * divH;
      const colorOf = (ch: string) => c.traces[chans.indexOf(ch) % c.traces.length];
      ctx.font = '11px "Segoe UI", system-ui, sans-serif';
      if (!capture) {
        drawLabel(ctx, running ? t('instruments.oscilloscope.waitingForData') : t('instruments.oscilloscope.startTheSimulation'), r.x + r.w / 2, r.y + r.h / 2 - 8, c.text, c.bg, 'center');
        return;
      }
      const { window: win, time, values } = capture;
      const span = win.right - win.left;
      const xOfT = (t: number) => r.x + ((t - win.left) / span) * r.w;
      if (s.display === 'yt' || s.display === 'add') {
        const shown = s.display === 'add' ? ['A+B', ...chans.filter((ch) => ch !== 'A' && ch !== 'B')] : chans;
        for (const name of shown) {
          let ys: Float64Array;
          let scaleCh: string;
          if (name === 'A+B') {
            const a = values.A;
            const b = values.B;
            ys = a.map((v, i) => v + b[i]);
            scaleCh = 'A';
          } else {
            ys = values[name];
            scaleCh = name;
          }
          if (!binding.channels[scaleCh] && name !== 'A+B') continue;
          let tx: ArrayLike<number> = time;
          let ty: ArrayLike<number> = ys;
          if (time.length > 4 * r.w) {
            const d = decimateMinMax(time, ys, 0, time.length - 1, (t) => xOfT(t));
            tx = d.x;
            ty = d.y;
          }
          const px = new Float64Array(tx.length);
          const py = new Float64Array(tx.length);
          for (let i = 0; i < tx.length; i++) {
            px[i] = xOfT(tx[i]);
            py[i] = yOf(ty[i], scaleCh);
          }
          strokeCurve(ctx, px, py, colorOf(scaleCh), r, 1.6);
          // channel ground marker on the left edge
          const gy = yOf(0, scaleCh);
          if (gy >= r.y && gy <= r.y + r.h) {
            ctx.fillStyle = colorOf(scaleCh);
            ctx.beginPath();
            ctx.moveTo(r.x - 7, gy - 4);
            ctx.lineTo(r.x - 1, gy);
            ctx.lineTo(r.x - 7, gy + 4);
            ctx.fill();
          }
        }
        // trigger level marker (right edge) and trigger instant (top edge)
        if (s.mode !== 'none' && s.source !== 'ext' && s.display === 'yt') {
          const ly = yOf(s.level, s.source);
          if (ly >= r.y && ly <= r.y + r.h) {
            ctx.fillStyle = colorOf(s.source);
            ctx.beginPath();
            ctx.moveTo(r.x + r.w + 7, ly - 4);
            ctx.lineTo(r.x + r.w + 1, ly);
            ctx.lineTo(r.x + r.w + 7, ly + 4);
            ctx.fill();
          }
        }
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
      } else {
        const xCh = s.display === 'ba' ? 'A' : 'B';
        const yCh = s.display === 'ba' ? 'B' : 'A';
        const xs = values[xCh];
        const ys = values[yCh];
        const px = new Float64Array(time.length);
        const py = new Float64Array(time.length);
        for (let i = 0; i < time.length; i++) {
          px[i] = r.x + r.w / 2 + (xs[i] / s.channels[xCh].scale + s.channels[xCh].pos) * divW;
          py[i] = yOf(ys[i], yCh);
        }
        strokeCurve(ctx, px, py, colorOf(yCh), r, 1.6);
        drawLabel(ctx, `${yCh} vs ${xCh}`, r.x + 4, r.y + 4, c.text, c.bg);
      }
      const status =
        win.status === 'triggered' ? t('instruments.oscilloscope.trigd') : win.status === 'free-run' ? (s.mode === 'auto' ? t('common.auto') : t('instruments.oscilloscope.freeRun')) : win.status === 'stopped' ? t('common.stop') : t('instruments.oscilloscope.wait');
      ctx.fillStyle = c.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      // status / scale labels live in the strip above the graticule, clear of the trigger marker
      ctx.fillText(`${status}  ${formatEng(s.timebase, 's', 3)}/div`, 8, 2);
      ctx.textAlign = 'right';
      ctx.fillText(
        chans
          .filter((ch) => binding.channels[ch])
          .map((ch) => `${ch}: ${formatEng(s.channels[ch].scale, 'V', 3)}/div`)
          .join('   '),
        w - 8,
        2,
      );
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>, x: number) => {
    if (s.display !== 'yt' && s.display !== 'add') return;
    const canvas = e.currentTarget;
    const r = screenRect(canvas.clientWidth, canvas.clientHeight);
    const divW = r.w / SCOPE_DIVS_X;
    const d1 = Math.abs(r.x + s.t1 * divW - x);
    const d2 = Math.abs(r.x + s.t2 * divW - x);
    if (Math.min(d1, d2) > 10) return;
    drag.current = d1 <= d2 ? 0 : 1;
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>, x: number) => {
    const canvas = e.currentTarget;
    const r = screenRect(canvas.clientWidth, canvas.clientHeight);
    const divW = r.w / SCOPE_DIVS_X;
    if (drag.current === null) {
      const near = Math.min(Math.abs(r.x + s.t1 * divW - x), Math.abs(r.x + s.t2 * divW - x)) <= 10;
      canvas.style.cursor = near && (s.display === 'yt' || s.display === 'add') ? 'ew-resize' : 'default';
      return;
    }
    const div = Math.max(0, Math.min(SCOPE_DIVS_X, (x - r.x) / divW));
    p.set(drag.current === 0 ? 't1' : 't2', div.toFixed(3));
  };
  const onUp = () => {
    drag.current = null;
  };

  const exportCsv = () => {
    if (!capture) return;
    const cols = chans.filter((ch) => binding.channels[ch]).map((ch) => ({ name: `Channel ${ch}`, values: capture.values[ch] }));
    downloadText(`${safeFileName(binding.refdes)}_scope.csv`, scopeCsv(capture.time, cols));
  };

  // cursor readouts
  const tAt = (div: number) => (capture ? capture.window.left + div * s.timebase : Number.NaN);
  const t1 = tAt(s.t1);
  const t2 = tAt(s.t2);
  const valAt = (ch: string, t: number) => (capture ? sampleAt(capture.time, capture.values[ch], t) : Number.NaN);
  // display resolution: 1/100 of a division (a real 8-bit screen resolves about 1/25)
  const tStep = s.timebase / 100;
  const vStep = (ch: string) => (s.channels[ch as keyof typeof s.channels]?.scale ?? 1) / 100;

  return (
    <div className={`msi-panel msi-scope${four ? ' msi-scope4' : ''}`}>
      <Screen
        draw={draw}
        height={four ? 340 : 320}
        ariaLabel={t('instruments.oscilloscope.oscilloscopeScreenValuePerDivision', { value: formatEng(s.timebase, 's', 3) })}
        className="msi-scope-screen"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        canvasRef={(c) => {
          canvasEl.current = c;
        }}
      />
      {connected.length === 0 && <NotConnected what={t('instruments.oscilloscope.connectAtLeastOneChannel')} />}
      <table className="msi-table msi-cursor-table" aria-label={t('instruments.oscilloscope.cursorReadouts')}>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col" className="msi-num">
              {t('common.time')}
            </th>
            {connected.map((ch) => (
              <th key={ch} scope="col" className="msi-num">
                <span className={`msi-chip msi-ch-${ch}`}>{t('instruments.oscilloscope.channelCh', { ch: ch })}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="msi-cur1">
              T1
            </th>
            <td className="msi-num">{eng(t1, 's', 4, tStep)}</td>
            {connected.map((ch) => (
              <td key={ch} className="msi-num">
                {eng(valAt(ch, t1), 'V', 4, vStep(ch))}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row" className="msi-cur2">
              T2
            </th>
            <td className="msi-num">{eng(t2, 's', 4, tStep)}</td>
            {connected.map((ch) => (
              <td key={ch} className="msi-num">
                {eng(valAt(ch, t2), 'V', 4, vStep(ch))}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">T2−T1</th>
            <td className="msi-num">{eng(t2 - t1, 's', 4, tStep)}</td>
            {connected.map((ch) => (
              <td key={ch} className="msi-num">
                {eng(valAt(ch, t2) - valAt(ch, t1), 'V', 4, vStep(ch))}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <div className="msi-row msi-scope-buttons">
        <button type="button" className={`msi-btn${s.reverse ? ' msi-on' : ''}`} aria-pressed={s.reverse} onClick={() => p.set('reverse', s.reverse ? 'false' : 'true')} title={t('tip.scope.reverse')}>
          {t('instruments.oscilloscope.reverse')}
        </button>
        <button type="button" className="msi-btn" onClick={exportCsv} disabled={!capture} title={t('tip.kit.saveCsv')}>
          {t('common.saveCsv')}
        </button>
        <button type="button" className="msi-btn" onClick={() => canvasEl.current && downloadCanvasPng(canvasEl.current, `${safeFileName(binding.refdes)}_scope.png`)} title={t('tip.kit.savePng')}>
          {t('instruments.oscilloscope.savePng')}
        </button>
        <span className="msi-dim">1 / (T2−T1) = {eng(1 / (t2 - t1), 'Hz')}</span>
      </div>
      <div className="msi-scope-controls">
        <Section title={t('instruments.oscilloscope.timebase')}>
          <StepField label={t('common.scale')} value={p.text('timebase')} unit="s/Div" onCommit={(t) => p.set('timebase', t)} title={t('tip.scope.timebase')} min={1e-12} max={1e3} />
          <NumberField label={t('instruments.oscilloscope.xPosDiv')} value={p.text('xpos')} onCommit={(t) => p.set('xpos', t)} title={t('tip.scope.xpos')} size={5} />
          <Segmented
            small
            value={s.display}
            options={[
              ['yt', 'Y/T', t('instruments.oscilloscope.channelsAgainstTime')],
              ['add', t('common.add'), 'A + B'],
              ['ba', 'B/A', t('instruments.oscilloscope.bVerticalAgainstAHorizontal')],
              ['ab', 'A/B', t('instruments.oscilloscope.aVerticalAgainstBHorizontal')],
            ]}
            onChange={(d: DisplayMode) => p.set('display', d)} title={t('tip.scope.display')}
          />
        </Section>
        {chans.map((ch) => (
          <Section key={ch} title={<span className={`msi-ch-${ch}`}>{t('instruments.oscilloscope.channelCh', { ch: ch })}</span>} className={binding.channels[ch] ? '' : 'msi-section-off'}>
            <StepField label={t('common.scale')} value={p.text(`${ch}.scale`)} unit="V/Div" onCommit={(t) => p.set(`${ch}.scale`, t)} title={t('tip.scope.vdiv')} min={1e-9} max={1e6} />
            <NumberField label={t('instruments.oscilloscope.yPosDiv')} value={p.text(`${ch}.pos`)} onCommit={(t) => p.set(`${ch}.pos`, t)} title={t('tip.scope.ypos')} size={5} />
            <Segmented
              small
              value={s.channels[ch].coupling}
              options={[
                ['ac', 'AC', t('instruments.oscilloscope.removeTheDcComponent')],
                ['gnd', '0', t('instruments.oscilloscope.inputGrounded')],
                ['dc', 'DC', t('instruments.oscilloscope.directCoupling')],
              ]}
              onChange={(c: Coupling) => p.set(`${ch}.coupling`, c)} title={t('tip.scope.coupling')}
            />
          </Section>
        ))}
        <Section title={t('common.trigger')}>
          <Segmented
            small
            label={t('common.edge')}
            value={s.edge}
            options={[
              ['rising', '↑', t('instruments.oscilloscope.risingEdge')],
              ['falling', '↓', t('instruments.oscilloscope.fallingEdge')],
            ]}
            onChange={(e: TriggerEdge) => p.set('trig.edge', e)} title={t('tip.scope.trigEdge')}
          />
          <NumberField label={t('common.level')} value={p.text('trig.level')} unit="V" onCommit={(t) => p.set('trig.level', t)} title={t('tip.scope.trigLevel')} size={6} />
          <Segmented
            small
            label={t('common.source')}
            value={s.source}
            options={[...chans.map((ch) => [ch, ch] as const), ['ext', 'Ext'] as const]}
            onChange={(src) => p.set('trig.source', src)} title={t('tip.scope.trigSource')}
          />
          <Segmented
            small
            label={t('common.mode')}
            value={s.mode}
            options={[
              ['single', t('instruments.oscilloscope.single')],
              ['normal', t('instruments.oscilloscope.normal')],
              ['auto', t('common.auto')],
              ['none', t('common.none')],
            ]}
            onChange={(m: TriggerMode) => p.set('trig.mode', m)} title={t('tip.scope.trigMode')}
          />
          {s.mode === 'single' && (
            <button type="button" className="msi-btn" onClick={reArm} title={t('instruments.oscilloscope.armANewSingleAcquisition')}>
              {t('instruments.oscilloscope.reArm')}
            </button>
          )}
          {s.source === 'ext' && !binding.channels.ext && <span className="msi-dim">{t('instruments.oscilloscope.extInputNotWired')}</span>}
        </Section>
      </div>
    </div>
  );
}
