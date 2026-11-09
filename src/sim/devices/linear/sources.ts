/**
 * Independent sources: voltage source (V) and current source (I).
 *
 * Value used in a real load:
 * - transient timepoints and the operating point that starts a transient: the transient waveform
 *   at the current time when one is given, else the DC value;
 * - OP / DC sweep: the DC value, or the waveform value at t = 0 when no DC value is given;
 * - always multiplied by LoadContext.srcFact (source stepping).
 * AC: magnitude `acMag` (default 0) and phase `acPhase` (degrees).
 *
 * V owns a branch unknown (vector "I(V1)", SPICE sign: positive when current flows into the +
 * terminal from the circuit). I pushes its current from n+ through the source to n-.
 *
 * Waveform defaults that depend on the analysis (tstep, tstop) are resolved in beginTransient().
 * Breakpoints come from the waveform (Device.breakpoints and the windowed breakpointsBetween).
 *
 * setParam/getParam: "dc" | "value" (DC value), "acmag" | "ac" | "mag", "acphase", and every
 * waveform parameter by name (src/sim/waveforms.ts): vo/offset, va/ampl, freq, td, theta, phase,
 * v1, v2, tr, tf, pw, per, duty, ... Any other name — including a waveform parameter on a source
 * without that waveform — throws a SimulationError ('unsupported'), so a live edit that cannot be
 * applied is reported instead of silently ignored.
 *
 * Streamed PCM input (microphone part): an element with the instance parameter `pcmfs` (samples
 * per second) plays a sample stream that the UI pushes while the simulation runs, one setParam
 * ("pcm", sample) per sample. Sample k sits at time k / pcmfs; the value in between is the linear
 * interpolation, beyond the last pushed sample the last value is held. Every sample time is a
 * breakpoint, so the engine's step always resolves the stream. setParam "pcmreset" empties the
 * stream (a restarted session). The stream keeps about two seconds of history only.
 *
 * Outputs: V: P (absorbed power v*i). I: I (source current), P (absorbed power v(n+,n-)*I).
 */
import type { AcContext, Device, LoadContext, SetupContext } from '../../device';
import type { ElementIR, ElementType, Waveform } from '../../netlist';
import {
  DEFAULT_TIMING,
  cloneWaveform,
  compileWaveform,
  getWaveformParam,
  setWaveformParam,
  type CompiledWaveform,
  type WaveformTiming,
} from '../../waveforms';
import type { EngineDeviceExtensions, TransientSetup } from '../../engine/hooks';
import { requireNodes, runtimeParamError, stampBranchIncidence, stampBranchIncidenceAc, stampCurrent } from './common';

abstract class IndependentSource implements Device, EngineDeviceExtensions {
  abstract readonly type: ElementType;
  readonly name: string;
  readonly nodeNames: string[];
  readonly linear = true;

  protected dc: number | undefined;
  protected acMag: number;
  protected acPhase: number;
  protected wave: Waveform | undefined;
  protected compiled: CompiledWaveform | undefined;
  protected timing: WaveformTiming = DEFAULT_TIMING;
  protected p = -1;
  protected n = -1;
  /** Value used by the last load (srcFact included). */
  protected lastValue = 0;
  /** streamed PCM samples (microphone input), see the module comment */
  protected pcm: { fs: number; first: number; samples: number[]; lastTime: number } | undefined;

  constructor(el: ElementIR) {
    requireNodes(el, 2);
    this.name = el.name;
    this.nodeNames = el.nodes.slice(0, 2);
    const src = el.source ?? {};
    const dc = src.dc ?? el.value;
    this.dc = dc !== undefined && Number.isFinite(dc) ? dc : undefined;
    this.acMag = src.acMag !== undefined && Number.isFinite(src.acMag) ? src.acMag : 0;
    this.acPhase = src.acPhase !== undefined && Number.isFinite(src.acPhase) ? src.acPhase : 0;
    this.wave = src.tran ? cloneWaveform(src.tran) : undefined;
    const fs = el.params?.pcmfs;
    if (fs !== undefined && Number.isFinite(fs) && fs > 0) this.pcm = { fs, first: 0, samples: [], lastTime: 0 };
    this.recompile();
  }

  /** Interpolated stream value at time t (held beyond the pushed samples). */
  protected pcmAt(t: number): number {
    const p = this.pcm!;
    p.lastTime = Math.max(p.lastTime, t);
    const n = p.samples.length;
    if (n === 0) return 0;
    const x = t * p.fs - p.first;
    if (x <= 0) return p.samples[0];
    if (x >= n - 1) return p.samples[n - 1];
    const i = Math.floor(x);
    return p.samples[i] + (x - i) * (p.samples[i + 1] - p.samples[i]);
  }

  private pcmPush(value: number): void {
    const p = this.pcm!;
    p.samples.push(Number.isFinite(value) ? value : 0);
    // forget samples more than two seconds behind the newest time the engine asked for
    const behind = Math.floor(p.lastTime * p.fs - 2 * p.fs) - p.first;
    if (behind > 4096) {
      p.samples.splice(0, behind);
      p.first += behind;
    }
  }

  protected recompile(): void {
    this.compiled = this.wave ? compileWaveform(this.wave, this.timing) : undefined;
  }

  setup(ctx: SetupContext): void {
    this.p = ctx.node(this.nodeNames[0]);
    this.n = ctx.node(this.nodeNames[1]);
  }

  /** Source value for a real load (time-dependent in transient, srcFact applied). */
  protected value(ctx: LoadContext): number {
    let v: number;
    if (this.pcm && (ctx.mode === 'tran' || ctx.tranOp)) v = this.pcmAt(ctx.time);
    else if (this.compiled && (ctx.mode === 'tran' || ctx.tranOp)) v = this.compiled.value(ctx.time);
    else if (this.dc !== undefined) v = this.dc;
    else if (this.compiled) v = this.compiled.value(0);
    else v = 0;
    v *= ctx.srcFact;
    this.lastValue = v;
    return v;
  }

  /** Instantaneous transient value at time t (DC value when there is no waveform). */
  valueAt(t: number): number {
    if (this.pcm) return this.pcmAt(t);
    if (this.compiled) return this.compiled.value(t);
    return this.dc ?? 0;
  }

  /** AC excitation (re, im). */
  protected acPhasor(): { re: number; im: number } {
    const ph = (this.acPhase * Math.PI) / 180;
    return { re: this.acMag * Math.cos(ph), im: this.acMag * Math.sin(ph) };
  }

  abstract load(ctx: LoadContext): void;
  abstract acLoad(ctx: AcContext): void;

  beginTransient(setup: TransientSetup): void {
    this.timing = { tstep: setup.tstep, tstop: setup.tstop };
    this.recompile();
  }

  breakpoints(tstop: number): number[] {
    return this.compiled ? this.compiled.breakpoints(0, tstop) : [];
  }

  breakpointsBetween(from: number, to: number): number[] {
    if (this.pcm) {
      const out: number[] = [];
      const fs = this.pcm.fs;
      const last = Math.min(to, from + 1);
      for (let k = Math.floor(from * fs) + 1; k / fs <= last && out.length < 20000; k++) out.push(k / fs);
      return out;
    }
    return this.compiled ? this.compiled.breakpoints(from, to) : [];
  }

  setParam(param: string, value: number): void {
    const key = param.trim().toLowerCase();
    switch (key) {
      case 'pcm':
        if (!this.pcm) throw runtimeParamError(this.name, param);
        this.pcmPush(value);
        return;
      case 'pcmreset':
        if (!this.pcm) throw runtimeParamError(this.name, param);
        this.pcm.samples = [];
        this.pcm.first = 0;
        this.pcm.lastTime = 0;
        return;
      case 'dc':
      case 'value':
        this.dc = Number.isFinite(value) ? value : undefined;
        return;
      case 'acmag':
      case 'ac':
      case 'mag':
        if (Number.isFinite(value)) this.acMag = value;
        return;
      case 'acphase':
        if (Number.isFinite(value)) this.acPhase = value;
        return;
      default:
        if (!this.wave || !setWaveformParam(this.wave, key, value)) throw runtimeParamError(this.name, param);
        this.recompile();
    }
  }

  getParam(param: string): number | undefined {
    const key = param.trim().toLowerCase();
    switch (key) {
      case 'dc':
      case 'value':
        return this.dc;
      case 'acmag':
      case 'ac':
      case 'mag':
        return this.acMag;
      case 'acphase':
        return this.acPhase;
      default:
        return this.wave ? getWaveformParam(this.wave, key) : undefined;
    }
  }
}

export class VoltageSource extends IndependentSource {
  readonly type: ElementType = 'V';
  private br = -1;

  override setup(ctx: SetupContext): void {
    super.setup(ctx);
    this.br = ctx.branch(this.name);
  }

  branchIndex(): number {
    return this.br;
  }

  load(ctx: LoadContext): void {
    stampBranchIncidence(ctx, this.p, this.n, this.br);
    ctx.addRhs(this.br, this.value(ctx));
  }

  acLoad(ctx: AcContext): void {
    stampBranchIncidenceAc(ctx, this.p, this.n, this.br);
    const ph = this.acPhasor();
    ctx.addRhs(this.br, ph.re, ph.im);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { P: (x(this.p) - x(this.n)) * x(this.br) };
  }
}

export class CurrentSource extends IndependentSource {
  readonly type: ElementType = 'I';

  load(ctx: LoadContext): void {
    stampCurrent(ctx, this.p, this.n, this.value(ctx));
  }

  acLoad(ctx: AcContext): void {
    const ph = this.acPhasor();
    ctx.addRhs(this.p, -ph.re, -ph.im);
    ctx.addRhs(this.n, ph.re, ph.im);
  }

  outputs(x: (i: number) => number): Record<string, number> {
    return { I: this.lastValue, P: (x(this.p) - x(this.n)) * this.lastValue };
  }

  acOutputs(): Record<string, { re: number; im: number }> {
    return { I: this.acPhasor() };
  }
}

export function createVoltageSource(el: ElementIR): Device {
  return new VoltageSource(el);
}

export function createCurrentSource(el: ElementIR): Device {
  return new CurrentSource(el);
}
