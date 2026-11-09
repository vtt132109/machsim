/**
 * Audio input for the microphone part: the default input device of the browser / Electron, or a
 * test tone when there is none (permission refused, no device, no Web Audio).
 *
 *   InputBuffer     the pure part: input blocks at the sound card's rate → resampled to the part's
 *                   rate, kept in a short queue, read by the PcmFeeder (monitor.ts); tracks a peak
 *                   level for the meter
 *   ToneSource      a sine at the part's rate, always available
 *   openInput(part) the browser part: asks for the microphone (the permission prompt), captures it
 *                   with an AudioWorklet (module built from a Blob; ScriptProcessor as a fall-back)
 *                   and resolves to the source and the state shown in the Audio window
 */
import { PcmResampler, ToneGenerator } from './resample';
import type { MicPart, MicState, PcmSource } from './monitor';

/** Longest unread input kept (seconds): older samples are dropped when the simulation is slower than real time. */
export const INPUT_QUEUE_SECONDS = 1;

export class InputBuffer implements PcmSource {
  readonly kind = 'mic' as const;
  private readonly resampler: PcmResampler;
  private queue: number[] = [];
  private peak = 0;
  private closeHook: (() => void) | null;

  constructor(
    inRate: number,
    readonly rate: number,
    onClose?: () => void,
  ) {
    this.resampler = new PcmResampler(inRate, rate);
    this.closeHook = onClose ?? null;
  }

  /** Input samples at the sound card's rate (called from the capture callback). */
  push(block: ArrayLike<number>): void {
    for (let i = 0; i < block.length; i++) this.peak = Math.max(this.peak * 0.99995, Math.abs(block[i]));
    const out = this.resampler.push(block);
    for (const v of out) this.queue.push(v);
    const max = Math.round(INPUT_QUEUE_SECONDS * this.rate);
    if (this.queue.length > max) this.queue.splice(0, this.queue.length - max);
  }

  read(n: number): Float32Array {
    const k = Math.min(n, this.queue.length);
    const out = Float32Array.from(this.queue.splice(0, k));
    return out;
  }

  level(): number {
    return Math.min(1, this.peak);
  }

  close(): void {
    this.closeHook?.();
    this.closeHook = null;
    this.queue = [];
  }
}

export class ToneSource implements PcmSource {
  readonly kind = 'tone' as const;
  private readonly gen: ToneGenerator;
  private peak = 0;

  constructor(
    readonly rate: number,
    freq: number,
    amp = 0.5,
  ) {
    this.gen = new ToneGenerator(rate, freq, amp);
    this.peak = amp;
  }

  read(n: number): Float32Array {
    return this.gen.read(n);
  }

  level(): number {
    return this.peak;
  }

  close(): void {
    /* nothing to release */
  }
}

// ---------------------------------------------------------------------------------------------
// the browser part

const WORKLET_CODE = `
class MachsimCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice());
    return true;
  }
}
registerProcessor('machsim-capture', MachsimCapture);
`;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Open the input for a microphone part. Never rejects: a refused permission, a missing device or a
 * browser without Web Audio resolve to the test tone with the state that says why.
 */
export async function openInput(part: MicPart): Promise<{ source: PcmSource; state: MicState }> {
  const tone = (state: MicState) => ({ source: new ToneSource(part.rate, part.toneFreq) as PcmSource, state });
  const Ctor = audioContextCtor();
  if (!Ctor || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return tone('unavailable');
  let stream: MediaStream;
  try {
    // no processing: the circuit should see the sound as it is
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : '';
    return tone(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
  }
  try {
    const ctx = new Ctor();
    await ctx.resume().catch(() => undefined);
    const node = ctx.createMediaStreamSource(stream);
    const stop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    };
    const buffer = new InputBuffer(ctx.sampleRate, part.rate, stop);
    let ok = false;
    if (ctx.audioWorklet) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET_CODE], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const cap = new AudioWorkletNode(ctx, 'machsim-capture', { numberOfInputs: 1, numberOfOutputs: 0 });
        cap.port.onmessage = (e: MessageEvent<Float32Array>) => buffer.push(e.data);
        node.connect(cap);
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      // ScriptProcessorNode is deprecated but still works everywhere the worklet does not
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      proc.onaudioprocess = (e) => buffer.push(e.inputBuffer.getChannelData(0));
      node.connect(proc);
      // the node must reach a destination to run; its output is silent
      proc.connect(ctx.destination);
    }
    return { source: buffer, state: 'live' };
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return tone('unavailable');
  }
}
