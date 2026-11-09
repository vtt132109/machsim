/**
 * Logic analyzer panel: 16-channel timing diagram sampled by an internal clock or an external
 * (optionally qualified) clock, thresholded at `threshold`, with pattern or external triggering,
 * pre/post-trigger capture, two cursors (T1 / T2) with word readouts, freeze and CSV export.
 *
 * Params: see LOGIC_ANALYZER_DEFAULTS (threshold, clock, clockrate, clkedge, qual, trigmode,
 * pattern, pre, post) plus t1 / t2 (cursor positions as fractions 0..1 of the capture).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { formatEng } from '../../util/units';
import { downloadText, safeFileName } from '../results/canvas';
import {
  LOGIC_ANALYZER_DEFAULTS,
  LOGIC_CHANNELS,
  captureAtEdges,
  captureWindow,
  externalClock,
  internalClock,
  normalizePattern,
  parseLogicAnalyzerSettings,
  sampleChannels,
  wordHex,
} from './logicAnalyzer';
import type { Capture, LogicSamples } from './logicAnalyzer';
import { NotConnected, NumberField, Readout, Screen, Section, Segmented, eng, paramApi } from './panelKit';
import { drawCursor, drawLabel, readScreenColors } from './screen';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';

const DEFAULTS: Record<string, string> = { ...LOGIC_ANALYZER_DEFAULTS, t1: '0.25', t2: '0.75' };
const DATA_CHANNELS = Array.from({ length: LOGIC_CHANNELS }, (_, i) => `d${i}`);
const LANE_H = 16;
const LABEL_W = 34;

interface Acquired {
  samples: LogicSamples;
  capture: Capture;
}

export function LogicAnalyzerPanel(props: InstrumentPanelProps) {
  const { binding, stream, params, onParamsChange, running } = props;
  const p = paramApi(params, onParamsChange, DEFAULTS);
  const s = parseLogicAnalyzerSettings(params);
  const [frozen, setFrozen] = useState(false);
  const held = useRef<Acquired | null>(null);
  const drag = useRef<'t1' | 't2' | null>(null);
  const version = stream.version;
  const key = JSON.stringify([s.threshold, s.clock, s.clockRate, s.clockEdge, s.qualifier, s.trigMode, s.pattern, s.pre, s.post]);

  const live = useMemo((): Acquired | null => {
    if (stream.length < 2) return null;
    const total = s.pre + s.post;
    const search = s.trigMode === 'none' ? 1.05 : 8;
    const channels = [...DATA_CHANNELS, 'clk', 'qual', 'trig'];
    const data =
      s.clock === 'internal'
        ? stream.readRecent((search * total) / s.clockRate, 1 << 18, channels)
        : stream.readRecent(Number.POSITIVE_INFINITY, 1 << 18, channels);
    if (data.time.length < 2) return null;
    const t0 = data.time[0];
    const t1 = data.time[data.time.length - 1];
    let instants =
      s.clock === 'internal'
        ? internalClock(t0, t1, s.clockRate, Math.ceil(search * total))
        : externalClock(data.time, data.values.clk, s.threshold, s.clockEdge, binding.channels.qual ? data.values.qual : undefined, s.qualifier);
    if (instants.length > search * total) instants = instants.slice(instants.length - Math.ceil(search * total));
    const cols = DATA_CHANNELS.map((ch) => (binding.channels[ch] ? data.values[ch] : undefined));
    const samples = sampleChannels(data.time, cols, instants, s.threshold);
    let capture: Capture;
    if (s.trigMode === 'external' && binding.channels.trig) {
      const edges = externalClock(data.time, data.values.trig, s.threshold, 'rising');
      capture = captureAtEdges(samples, edges, s.pre, s.post);
    } else capture = captureWindow(samples, s);
    return { samples, capture };
  }, [stream, version, key, binding.channels]);

  if (!frozen && live) held.current = live;
  const acq = frozen ? held.current : live;
  const count = acq ? acq.capture.last - acq.capture.first + 1 : 0;
  const t1f = Math.max(0, Math.min(1, p.num('t1', 0.25)));
  const t2f = Math.max(0, Math.min(1, p.num('t2', 0.75)));
  const sampleAtFrac = (f: number) => (acq && count > 0 ? acq.capture.first + Math.min(count - 1, Math.floor(f * count)) : -1);
  const k1 = sampleAtFrac(t1f);
  const k2 = sampleAtFrac(t2f);
  const timeAt = (k: number) => (acq && k >= 0 ? acq.samples.times[k] : Number.NaN);

  const height = (LOGIC_CHANNELS + 1) * LANE_H + 26;
  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, canvas: HTMLCanvasElement) => {
    const c = readScreenColors(canvas);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    const area = { x: LABEL_W, y: 4, w: w - LABEL_W - 6, h: (LOGIC_CHANNELS + 1) * LANE_H };
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (let ch = 0; ch < LOGIC_CHANNELS; ch++) {
      ctx.fillStyle = binding.channels[`d${ch}`] ? c.text : c.grid;
      ctx.fillText(ch.toString(16).toUpperCase(), LABEL_W - 6, area.y + ch * LANE_H + LANE_H / 2);
    }
    ctx.fillStyle = c.text;
    ctx.fillText('Clk', LABEL_W - 6, area.y + LOGIC_CHANNELS * LANE_H + LANE_H / 2);
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(area.x + 0.5, area.y + 0.5, area.w - 1, area.h - 1);
    if (!acq || count === 0) {
      drawLabel(ctx, running ? t('instruments.logicAnalyzer.waitingForClockSamples') : t('instruments.logicAnalyzer.startTheSimulation'), area.x + area.w / 2, area.y + area.h / 2 - 8, c.text, c.bg, 'center');
      return;
    }
    const { samples, capture } = acq;
    const dx = area.w / count;
    const xOf = (k: number) => area.x + (k - capture.first) * dx;
    // time grid every 10 % of the capture
    ctx.strokeStyle = c.grid;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let g = 1; g < 10; g++) {
      const x = Math.round(area.x + (g * area.w) / 10) + 0.5;
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let ch = 0; ch < LOGIC_CHANNELS; ch++) {
      const top = area.y + ch * LANE_H + 3;
      const bottom = area.y + (ch + 1) * LANE_H - 3;
      const levels = samples.levels[ch];
      ctx.strokeStyle = c.traces[ch % c.traces.length];
      ctx.lineWidth = 1.4;
      let prevY: number | null = null;
      for (let k = capture.first; k <= capture.last; k++) {
        const v = levels[k];
        const x0 = xOf(k);
        const x1 = x0 + dx;
        if (Number.isNaN(v)) {
          ctx.setLineDash([2, 3]);
          ctx.beginPath();
          ctx.moveTo(x0, (top + bottom) / 2);
          ctx.lineTo(x1, (top + bottom) / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          prevY = null;
          continue;
        }
        const y = v ? top : bottom;
        ctx.beginPath();
        if (prevY !== null && prevY !== y) {
          ctx.moveTo(x0, prevY);
          ctx.lineTo(x0, y);
        } else ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
        ctx.stroke();
        prevY = y;
      }
    }
    // sample clock ticks
    const clkY = area.y + LOGIC_CHANNELS * LANE_H;
    ctx.strokeStyle = c.text;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const tickEvery = Math.max(1, Math.ceil(count / (area.w / 4)));
    for (let k = capture.first; k <= capture.last; k += tickEvery) {
      const x = Math.round(xOf(k)) + 0.5;
      ctx.moveTo(x, clkY + LANE_H - 3);
      ctx.lineTo(x, clkY + 5);
    }
    ctx.stroke();
    if (capture.trigger !== null) {
      const x = xOf(capture.trigger);
      ctx.strokeStyle = c.marker;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(x, area.y);
      ctx.lineTo(x, area.y + area.h);
      ctx.stroke();
      ctx.setLineDash([]);
      drawLabel(ctx, 'T', x + 2, area.y + area.h + 4, c.marker, c.bg);
    }
    drawCursor(ctx, area.x + t1f * area.w, area, c.cursor1, '1');
    drawCursor(ctx, area.x + t2f * area.w, area, c.cursor2, '2');
    ctx.fillStyle = c.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t('instruments.logicAnalyzer.capturedSamples', { n: count, span: formatEng(samples.times[capture.last] - samples.times[capture.first], 's', 4) }), area.x, area.y + area.h + 6);
  };

  const fracFromX = (canvas: HTMLCanvasElement, x: number) => {
    const w = canvas.clientWidth - LABEL_W - 6;
    return Math.max(0, Math.min(1, (x - LABEL_W) / (w || 1)));
  };

  const exportCsv = () => {
    if (!acq) return;
    const { samples, capture } = acq;
    const lines = ['Time [s],Word (hex),' + DATA_CHANNELS.join(',')];
    for (let k = capture.first; k <= capture.last; k++) {
      const bits = DATA_CHANNELS.map((_, ch) => (Number.isNaN(samples.levels[ch][k]) ? 'Z' : String(samples.levels[ch][k])));
      lines.push(`${samples.times[k]},${wordHex(samples.words[k], samples.unknown[k])},${bits.join(',')}`);
    }
    downloadText(`${safeFileName(binding.refdes)}_logic.csv`, lines.join('\r\n') + '\r\n');
  };

  const anyData = DATA_CHANNELS.some((ch) => binding.channels[ch]);
  return (
    <div className="msi-panel msi-logic">
      <Screen
        draw={draw}
        height={height}
        ariaLabel={t('instruments.logicAnalyzer.logicAnalyzerTimingDiagram')}
        onPointerDown={(e, x) => {
          const f = fracFromX(e.currentTarget, x);
          drag.current = Math.abs(f - t1f) <= Math.abs(f - t2f) ? 't1' : 't2';
          p.set(drag.current, f.toFixed(4));
        }}
        onPointerMove={(e, x) => {
          if (drag.current) p.set(drag.current, fracFromX(e.currentTarget, x).toFixed(4));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
      {!anyData && <NotConnected what={t('instruments.logicAnalyzer.connectAtLeastOneData')} />}
      {s.clock === 'external' && !binding.channels.clk && <NotConnected what={t('instruments.logicAnalyzer.externalClockSelectedButThe')} />}
      <div className="msi-row msi-secondary">
        <Readout label="T1" value={`${eng(timeAt(k1), 's')} · ${acq && k1 >= 0 ? wordHex(acq.samples.words[k1], acq.samples.unknown[k1]) : '—'}`} />
        <Readout label="T2" value={`${eng(timeAt(k2), 's')} · ${acq && k2 >= 0 ? wordHex(acq.samples.words[k2], acq.samples.unknown[k2]) : '—'}`} />
        <Readout label="T2−T1" value={eng(timeAt(k2) - timeAt(k1), 's')} />
      </div>
      <div className="msi-row">
        <button type="button" className={`msi-btn${frozen ? ' msi-on' : ''}`} aria-pressed={frozen} onClick={() => setFrozen(!frozen)} title={t('tip.la.stop')}>
          {frozen ? t('instruments.logicAnalyzer.resume') : t('common.stop')}
        </button>
        <button
          type="button"
          className="msi-btn"
          title={t('tip.la.reset')}
          onClick={() => {
            held.current = null;
            setFrozen(false);
          }}
        >
          {t('common.reset')}
        </button>
        <button type="button" className="msi-btn" onClick={exportCsv} disabled={!acq} title={t('tip.kit.saveCsv')}>
          {t('common.saveCsv')}
        </button>
        <NumberField label={t('instruments.logicAnalyzer.threshold')} value={p.text('threshold')} unit="V" onCommit={(t) => p.set('threshold', t)} title={t('tip.la.threshold')} size={5} />
      </div>
      <div className="msi-logic-controls">
        <Section title={t('instruments.logicAnalyzer.clock')}>
          <Segmented
            small
            value={s.clock}
            options={[
              ['internal', t('instruments.logicAnalyzer.internal')],
              ['external', t('instruments.logicAnalyzer.external')],
            ]}
            onChange={(v) => p.set('clock', v)} title={t('tip.la.clock')}
          />
          {s.clock === 'internal' ? (
            <NumberField label={t('instruments.logicAnalyzer.clockRate')} value={p.text('clockrate')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('clockrate', t)} title={t('tip.la.clockRate')} size={6} />
          ) : (
            <>
              <Segmented
                small
                label={t('common.edge')}
                value={s.clockEdge}
                options={[
                  ['rising', '↑'],
                  ['falling', '↓'],
                ]}
                onChange={(v) => p.set('clkedge', v)} title={t('tip.la.clkEdge')}
              />
              <Segmented
                small
                label={t('instruments.logicAnalyzer.qualifier')}
                value={s.qualifier}
                options={[
                  ['x', 'x'],
                  ['0', '0'],
                  ['1', '1'],
                ]}
                onChange={(v) => p.set('qual', v)} title={t('tip.la.qualifier')}
              />
            </>
          )}
          <NumberField label={t('instruments.logicAnalyzer.preTrigger')} value={p.text('pre')} integer min={0} max={100000} onCommit={(t) => p.set('pre', t)} title={t('tip.la.pre')} size={5} />
          <NumberField label={t('instruments.logicAnalyzer.postTrigger')} value={p.text('post')} integer min={1} max={100000} onCommit={(t) => p.set('post', t)} title={t('tip.la.post')} size={5} />
        </Section>
        <Section title={t('common.trigger')}>
          <Segmented
            small
            value={s.trigMode}
            options={[
              ['none', t('common.none')],
              ['pattern', t('instruments.logicAnalyzer.pattern')],
              ['external', t('instruments.logicAnalyzer.external')],
            ]}
            onChange={(v) => p.set('trigmode', v)} title={t('tip.la.trigMode')}
          />
          {s.trigMode === 'pattern' && (
            <PatternField value={s.pattern} onCommit={(t) => p.set('pattern', t)} />
          )}
          {s.trigMode === 'external' && !binding.channels.trig && <span className="msi-dim">{t('instruments.logicAnalyzer.tTriggerInputNotWired')}</span>}
        </Section>
      </div>
    </div>
  );
}

/** 16-character trigger pattern editor (0 / 1 / x, channel F first); commits on Enter / blur. */
function PatternField({ value, onCommit }: { value: string; onCommit: (pattern: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const valid = /^[01xX]{0,16}$/.test(draft.replace(/\s+/g, ''));
  const commit = () => {
    setEditing(false);
    if (valid) onCommit(normalizePattern(draft));
    else setDraft(value);
  };
  return (
    <label className={`msi-field${valid ? '' : ' msi-field-invalid'}`}>
      <span className="msi-field-label">{t('instruments.logicAnalyzer.patternF0')}</span>
      <input
        className="msi-input msi-mono"
        value={draft}
        size={18}
        spellCheck={false}
        aria-label={t('instruments.logicAnalyzer.triggerPatternUpTo16')} title={t('tip.la.pattern')}
        aria-invalid={!valid}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setEditing(true);
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
      {!valid && <span className="msi-field-error">{t('instruments.logicAnalyzer.useUpTo16Of')}</span>}
    </label>
  );
}
