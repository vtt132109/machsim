/**
 * The sound card as an AudioSink (monitor.ts): Web Audio API in the browser and in Electron.
 *
 * Blocks are scheduled back to back as AudioBufferSourceNodes on the context's own clock (no
 * deprecated ScriptProcessor, no worklet): `write` starts a block where the previous one ends, or a
 * few milliseconds from now when the queue ran dry. `queued()` is how far ahead the schedule reaches.
 * A new context starts suspended until the user acts; Run is a click or a key press, which counts.
 */
import type { AudioSink } from './monitor';

type AudioContextCtor = typeof AudioContext;

/** Open the sound card, or null when this environment has no Web Audio. */
export function createWebAudioSink(): AudioSink | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
  void ctx.resume().catch(() => undefined);
  let next = 0;
  return {
    sampleRate: ctx.sampleRate,
    write(left, right) {
      const buf = ctx.createBuffer(2, left.length, ctx.sampleRate);
      buf.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const at = Math.max(ctx.currentTime + 0.01, next);
      src.start(at);
      next = at + left.length / ctx.sampleRate;
    },
    queued: () => Math.max(0, next - ctx.currentTime),
    close() {
      void ctx.close().catch(() => undefined);
    },
  };
}
