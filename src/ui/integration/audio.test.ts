/**
 * Sound end to end: a speaker on a sine source plays through a fake sound card at the right pitch,
 * the stretch indicator tells when the simulation is slower than real time, a microphone part is
 * fed by the (fake) input device, and mute / volume reach the output.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DesignBuilder } from '../../model/designkit';
import type { Design } from '../../model/types';
import { audioBackend } from '../../audio/host';
import { ToneSource } from '../../audio/input';
import { audioState, resetAudioState, setMaster, type AudioSink } from '../../audio/monitor';
import { createEditor } from '../store/editorStore';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { SimulationIntegration } from './controller';
import { setLang } from '../../i18n';

setLang('en');

async function waitFor(cond: () => boolean, timeoutMs = 10000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** A sound card that plays in real time and records what it was given. */
function fakeCard(rate = 16000) {
  const t0 = Date.now();
  const left: number[] = [];
  const right: number[] = [];
  let opened = 0;
  let closed = 0;
  const sink: AudioSink = {
    sampleRate: rate,
    write(l, r) {
      for (const v of l) left.push(v);
      for (const v of r) right.push(v);
    },
    queued: () => Math.max(0, left.length / rate - (Date.now() - t0) / 1000),
    close: () => {
      closed++;
    },
  };
  return { left, right, rate, opened: () => opened, closed: () => closed, open: () => (opened++, sink) };
}

function frequencyOf(x: ArrayLike<number>, fs: number): number {
  const ups: number[] = [];
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) ups.push(i - 1 + -x[i - 1] / (x[i] - x[i - 1]));
  return ups.length < 3 ? 0 : ((ups.length - 1) * fs) / (ups[ups.length - 1] - ups[0]);
}

const peak = (x: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
};

function speakerDesign(freq: string, extra: Record<string, string> = {}): Design {
  const b = new DesignBuilder('audio');
  const s = b.part('sources/ac-voltage', 'V1', -300, 0, { amplitude: '2', freq });
  b.labelPin(s, '+', 'A');
  b.labelPin(s, '-', '0');
  const r = b.part('basic/resistor', 'R1', -100, 0, { value: '10' });
  b.labelPin(r, '1', 'A');
  b.labelPin(r, '2', 'B');
  const ls = b.part('indicators/speaker', 'LS1', 100, 0, extra);
  b.labelPin(ls, '+', 'B');
  b.labelPin(ls, '-', '0');
  return b.design;
}

function setup(design: Design, speed: number) {
  const editor = createEditor({ design });
  const ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()), speed, liveIntervalMs: 20 });
  return { editor, ctrl };
}

const saved = { sink: audioBackend.sink, openInput: audioBackend.openInput };
afterEach(() => {
  audioBackend.sink = saved.sink;
  audioBackend.openInput = saved.openInput;
  resetAudioState();
});

describe('speaker playback', () => {
  it('a 1 kHz sine on the speaker plays at 1 kHz with the level set by volume and full-scale voltage', async () => {
    const card = fakeCard();
    audioBackend.sink = card.open;
    setMaster({ volume: 80, mute: false });
    const { ctrl } = setup(speakerDesign('1k'), 1);
    await ctrl.run();
    await waitFor(() => card.left.length > card.rate * 1.3, 15000, '1.3 s of sound');
    expect(card.opened()).toBe(1);
    const tail = card.left.slice(-card.rate);
    expect(frequencyOf(tail, card.rate)).toBeGreaterThan(985);
    expect(frequencyOf(tail, card.rate)).toBeLessThan(1015);
    // 2 V source through 10 Ω into a ~6.4 Ω + jωL speaker: the voltage across it is ≈ 2·|Z|/(10+|Z|)
    // played at 50 % volume, 80 % master, 5 V full scale: well inside 0 … 0.2
    expect(peak(tail)).toBeGreaterThan(0.04);
    expect(peak(tail)).toBeLessThan(0.1);
    // mono speaker: both ears carry the same
    expect(card.right.slice(-100)).toEqual(card.left.slice(-100));
    expect(audioState.getState().active).toBe(true);
    expect(audioState.getState().speakers).toBe(1);
    expect(audioState.getState().slower).toBe(false);
    expect(audioState.getState().level).toBeGreaterThan(0.02);
    await ctrl.stop();
    await ctrl.idle();
    expect(card.closed()).toBe(1);
    expect(audioState.getState().active).toBe(false);
    ctrl.dispose();
  }, 30000);

  it('mute (master or per speaker) silences the output and the volume parameter scales it', async () => {
    const card = fakeCard();
    audioBackend.sink = card.open;
    const { editor, ctrl } = setup(speakerDesign('500', { volume: '100' }), 1);
    await ctrl.run();
    await waitFor(() => card.left.length > card.rate * 0.8, 15000, 'sound');
    const loud = peak(card.left.slice(-4000));
    expect(loud).toBeGreaterThan(0.08);
    // master mute
    setMaster({ mute: true });
    const at = card.left.length;
    await waitFor(() => card.left.length > at + card.rate * 0.5, 15000, 'muted sound');
    expect(peak(card.left.slice(at + 4000))).toBe(0);
    setMaster({ mute: false });
    // the speaker's own mute: edit the part parameter while the simulation runs
    const part = editor.getState().design.sheets[0].parts.find((p) => p.refdes === 'LS1')!;
    editor.actions.setPartParam(part.id, 'mute', 'true');
    const at2 = card.left.length;
    await waitFor(() => card.left.length > at2 + card.rate * 0.6, 15000, 'speaker-muted sound');
    expect(peak(card.left.slice(at2 + 6000))).toBe(0);
    editor.actions.setPartParam(part.id, 'mute', 'false');
    editor.actions.setPartParam(part.id, 'volume', '25');
    const at3 = card.left.length;
    await waitFor(() => card.left.length > at3 + card.rate * 0.8, 15000, 'quieter sound');
    const quiet = peak(card.left.slice(-4000));
    expect(quiet).toBeGreaterThan(0.01);
    expect(quiet / loud).toBeGreaterThan(0.2);
    expect(quiet / loud).toBeLessThan(0.3);
    await ctrl.stop();
    ctrl.dispose();
  }, 40000);

  it('a simulation slower than real time is stretched, not broken up, and says so', async () => {
    const card = fakeCard();
    audioBackend.sink = card.open;
    // asked to run at a quarter of real time: 1 kHz in the circuit is heard as ≈ 250 Hz
    const { ctrl } = setup(speakerDesign('1k'), 0.25);
    await ctrl.run();
    await waitFor(() => audioState.getState().slower, 20000, 'the stretch indicator');
    await waitFor(() => card.left.length > card.rate * 4, 30000, '4 s of sound');
    const tail = card.left.slice(-card.rate * 2);
    const f = frequencyOf(tail, card.rate);
    expect(f).toBeGreaterThan(200);
    expect(f).toBeLessThan(310);
    expect(audioState.getState().speed).toBeGreaterThan(0.18);
    expect(audioState.getState().speed).toBeLessThan(0.34);
    await ctrl.stop();
    ctrl.dispose();
  }, 60000);

  it('without a sound card the run goes on silently and the Audio window knows', async () => {
    audioBackend.sink = () => null;
    const { ctrl } = setup(speakerDesign('1k'), Infinity);
    await ctrl.run();
    await waitFor(() => audioState.getState().noSink, 8000, 'noSink');
    expect(ctrl.live.getState().mode).toBe('interactive');
    await ctrl.stop();
    ctrl.dispose();
  });
});

describe('microphone', () => {
  const micDesign = (params: Record<string, string> = {}): Design => {
    const b = new DesignBuilder('mic');
    const m = b.part('sources/microphone', 'V1', -300, 0, { gain: '2', ...params });
    b.labelPin(m, '+', 'A');
    b.labelPin(m, '-', '0');
    const r = b.part('basic/resistor', 'R1', -100, 0, { value: '1k' });
    b.labelPin(r, '1', 'A');
    b.labelPin(r, '2', '0');
    const probe = b.part('indicators/speaker', 'LS1', 100, 0, { impedance: '1k', vfull: '2' });
    b.labelPin(probe, '+', 'A');
    b.labelPin(probe, '-', '0');
    return b.design;
  };

  it('the input device drives the circuit: a 440 Hz input comes out of the speaker at 440 Hz, scaled by the gain', async () => {
    const card = fakeCard();
    audioBackend.sink = card.open;
    audioBackend.openInput = async (part) => ({ source: new ToneSource(part.rate, 440, 0.5), state: 'live' });
    setMaster({ volume: 100, mute: false });
    const { ctrl } = setup(micDesign(), 1);
    await ctrl.run();
    await waitFor(() => audioState.getState().mic === 'live', 8000, 'live microphone');
    await waitFor(() => card.left.length > card.rate * 2.2, 20000, '2.2 s of sound');
    const tail = card.left.slice(-card.rate);
    expect(frequencyOf(tail, card.rate)).toBeGreaterThan(430);
    expect(frequencyOf(tail, card.rate)).toBeLessThan(450);
    // 0.5 full scale × gain 2 V = 1 V peak across the speaker; full scale 2 V, volume 50 %, master 100 %: 0.25
    expect(peak(tail)).toBeGreaterThan(0.2);
    expect(peak(tail)).toBeLessThan(0.3);
    expect(audioState.getState().micLevel).toBeGreaterThan(0.3);
    await ctrl.stop();
    ctrl.dispose();
    expect(audioState.getState().mic).toBe('none');
  }, 40000);

  it('a refused permission falls back to the test tone and the state says why', async () => {
    audioBackend.sink = () => fakeCard().open();
    audioBackend.openInput = async (part) => ({ source: new ToneSource(part.rate, part.toneFreq), state: 'denied' });
    const { ctrl } = setup(micDesign(), 1);
    await ctrl.run();
    await waitFor(() => audioState.getState().mic === 'denied', 8000, 'denied state');
    await waitFor(() => audioState.getState().micLevel > 0.3, 8000, 'tone level');
    await ctrl.stop();
    ctrl.dispose();
  }, 20000);

  it('a microphone alone makes Run stream (no instrument needed) and test-tone mode needs no input device', async () => {
    let asked = 0;
    audioBackend.openInput = async (part) => {
      asked++;
      return { source: new ToneSource(part.rate, 440), state: 'live' };
    };
    audioBackend.sink = () => fakeCard().open();
    const toneOnly = setup(micDesign({ source: 'tone' }), Infinity);
    await toneOnly.ctrl.run();
    expect(toneOnly.ctrl.live.getState().mode === 'interactive' || toneOnly.ctrl.live.getState().mode === 'idle').toBe(true);
    await toneOnly.ctrl.stop();
    toneOnly.ctrl.dispose();
    expect(asked).toBe(0);
  }, 20000);
});
