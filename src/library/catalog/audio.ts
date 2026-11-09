/**
 * Audio parts: a speaker and headphones that play a node voltage through the sound card during an
 * interactive run, a microphone that feeds the default input device into the circuit, and a WAV
 * file voltage / current source.
 *
 *   speaker        voice coil as a resistor in series with a small inductance (R = 0.8·Z, the
 *                  inductance scales with Z), indicator kind 'speaker': the controller hands the
 *                  voltage across it to the audio monitor (src/audio/monitor.ts), which resamples
 *                  it to the sound card in real time. `volume`, `mute` and `vfull` (the voltage
 *                  that plays at full scale) are instance parameters; key 'M' toggles the mute.
 *   headphones     two speaker channels L and R against a common return COM (stereo)
 *   microphone     a voltage source E = gain · V(stream) behind a streamed PCM source
 *                  (src/sim/devices/linear/sources.ts, element V_<refdes>_mic with pcmfs): the
 *                  audio monitor pushes the input samples while the simulation runs. With
 *                  source = 'tone' it is an ordinary sine source instead, which also works in
 *                  one-shot analyses (and is the fall-back when no microphone is available).
 *   WAV source     the samples of a WAV file (stored as base64 text of a mono 16-bit file by the
 *                  properties panel's "Open WAV file…") become a PWL source; empty = a built-in
 *                  20 ms burst of 1 kHz so the part runs at once.
 */
import type { SourceSpec } from '../../sim/netlist';
import { base64ToBytes, decodeWav, wavLength, WavError, type WavData } from '../../audio/wav';
import { boolOf, boolParam, elE, elI, elL, elR, elV, internalNode, numParam, selectParam, textParam, wPwl, wSin, type InstrumentBindContext, type LibraryPartDef } from '../partkit';
import { arc, circle, line, makeSymbol, pin, poly, rect, sourceSymbol, text, twoPinH } from '../symbols';
import type { SignalRef } from '../../model/types';
import type { ToSpiceContext } from '../types';
import { withMeta } from './kit';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

function across(ctx: InstrumentBindContext, a: string, b: string): SignalRef | null {
  const pa = ctx.net(a);
  const pb = ctx.net(b);
  if (pa === null && pb === null) return null;
  return { kind: 'voltage', pos: pa ?? '0', neg: pb ?? '0' };
}

// ---------------------------------------------------------------------------------------------
// speaker and headphones

/** Voice coil (R + L) between a and b: Re = 0.8·Z, Lvc = 0.2 mH · Z / 8 Ω (an 8 Ω cone). */
function voiceCoil(ctx: ToSpiceContext, tag: string, a: string, b: string, z: number) {
  const mid = internalNode(ctx, `vc${tag}`);
  return [elR(ctx.name('R', `vc${tag}`), a, mid, 0.8 * z), elL(ctx.name('L', `vc${tag}`), mid, b, (0.2e-3 * z) / 8)];
}

const SPEAKER_BODY = [rect(-12, -8, 10, 16), poly([-2, -8, 12, -20, 12, 20, -2, 8], true)];

const volumeParams = (zDefault: string, vfull: string) => [
  numParam('impedance', 'Impedance', zDefault, 'Ω', { min: 0, showOnSchematic: true, help: 'Nominal impedance of the voice coil: the circuit sees about 0.8 times this as resistance, plus a small inductance' }),
  numParam('volume', 'Volume', '50', '%', { group: 'display', min: 0, max: 100, help: 'Playback volume of this speaker (the master volume of the Audio window applies on top)' }),
  numParam('vfull', 'Full-scale voltage', vfull, 'V', { group: 'display', min: 0, help: 'The voltage across the speaker that plays at full scale at 100 % volume; larger signals are clipped' }),
  boolParam('mute', 'Mute', false, { group: 'display', help: "Silences this speaker (key 'M' toggles it while the simulation runs)" }),
];

const speaker = withMeta(
  {
    id: 'indicators/speaker',
    name: 'Speaker',
    group: 'indicators',
    family: 'Speaker',
    description: 'Loudspeaker: the voltage across it is played through the sound card while an interactive simulation runs (real-time resampling, volume and mute). If the circuit is slower than real time the sound is stretched and the Audio window says so',
    prefix: 'LS',
    symbol: twoPinH([...SPEAKER_BODY, arc(12, 0, 8, -50, 50), arc(12, 0, 16, -50, 50)], { names: ['+', '-'], labels: ['+', undefined], bodyHalf: 12, refPos: { x: 0, y: -26 }, valuePos: { x: 0, y: 32 } }),
    params: volumeParams('8', '5'),
    interactive: { kind: 'toggle', param: 'mute', label: 'Mute', key: 'M' },
    indicator: { kind: 'speaker', signal: 'voltage' },
    toSpice: (ctx) => ({ elements: voiceCoil(ctx, '', ctx.node('+'), ctx.node('-'), pos(ctx, 'impedance')) }),
    bindIndicator: (ctx) => {
      const s = across(ctx, '+', '-');
      return s ? { signal: s } : null;
    },
    provenance: 'MachSim speaker: resistive-inductive voice coil (textbook small-signal model without the mechanical branch); the sound is the voltage across it',
    footprint: 'SPEAKER-2P',
    keywords: ['speaker', 'loudspeaker', 'sound', 'audio', 'listen', 'cone'],
  },
  { vi: 'Loa: điện áp trên loa được phát ra card âm thanh khi chạy mô phỏng tương tác (lấy mẫu lại theo thời gian thực, có âm lượng và tắt tiếng). Nếu mạch chạy chậm hơn thời gian thực, âm thanh bị kéo giãn và cửa sổ Âm thanh báo rõ', nameVi: 'Loa', sortKey: 1, series: 'Audio' },
);

const headphones = withMeta(
  {
    id: 'indicators/headphones',
    name: 'Headphones',
    group: 'indicators',
    family: 'Speaker',
    description: 'Stereo headphones: the left and right channels (L, R) are each the voltage against the common return COM and are played on the left and right ear of the sound card',
    prefix: 'LS',
    symbol: makeSymbol(
      [
        line(-30, -10, -6, -10),
        line(-30, 0, -6, 0),
        line(-30, 10, -6, 10),
        rect(-6, -18, 36, 36),
        arc(12, -2, 12, 180, 360),
        rect(-2, -2, 6, 12),
        rect(20, -2, 6, 12),
        text(-14, -14, 'L', 8),
        text(-14, 4, '⏚', 8),
        text(-14, 22, 'R', 8),
      ],
      [pin('L', -30, -10, 'left', { label: 'L', number: '1' }), pin('COM', -30, 0, 'left', { number: '2' }), pin('R', -30, 10, 'left', { label: 'R', number: '3' })],
      { refPos: { x: 12, y: -28 }, valuePos: { x: 12, y: 34 } },
    ),
    params: volumeParams('32', '1'),
    interactive: { kind: 'toggle', param: 'mute', label: 'Mute', key: 'M' },
    indicator: { kind: 'speaker', signal: 'voltage' },
    toSpice: (ctx) => {
      const z = pos(ctx, 'impedance');
      return { elements: [...voiceCoil(ctx, 'l', ctx.node('L'), ctx.node('COM'), z), ...voiceCoil(ctx, 'r', ctx.node('R'), ctx.node('COM'), z)] };
    },
    bindIndicator: (ctx) => {
      const left = across(ctx, 'L', 'COM');
      const right = across(ctx, 'R', 'COM');
      if (!left && !right) return null;
      const zero: SignalRef = { kind: 'voltage', pos: '0', neg: '0' };
      return { signal: left ?? zero, signals: [right ?? zero] };
    },
    provenance: 'MachSim headphones: two resistive-inductive voice coils with a common return',
    footprint: 'JACK-3.5MM',
    keywords: ['headphones', 'earphones', 'stereo', 'audio', 'sound', 'listen'],
  },
  { vi: 'Tai nghe âm thanh nổi: kênh trái và phải (L, R) là điện áp so với đầu chung COM, được phát ra tai trái và tai phải của card âm thanh', nameVi: 'Tai nghe', sortKey: 2, series: 'Audio' },
);

// ---------------------------------------------------------------------------------------------
// microphone

export const MIC_RATES = [8000, 16000, 22050] as const;

const microphone = withMeta(
  {
    id: 'sources/microphone',
    name: 'Microphone',
    group: 'sources',
    family: 'Audio sources',
    description: "Microphone source: while an interactive simulation runs, the default input device (the browser asks for permission) drives the circuit with its signal; a level meter shows the input and a test tone replaces it when no microphone is available. 'Test tone' mode is an ordinary sine source that also works in one-shot analyses",
    prefix: 'V',
    virtual: true,
    symbol: makeSymbol(
      [circle(0, 0, 14), rect(-3, -9, 6, 11, undefined, 3), arc(0, 0, 7, 0, 180), line(0, 7, 0, 10), line(-4, 10, 4, 10), line(0, -30, 0, -14), line(0, 14, 0, 30)],
      [pin('+', 0, -30, 'up', { label: '+', number: '1' }), pin('-', 0, 30, 'down', { number: '2' })],
      { refPos: { x: 24, y: -4 }, valuePos: { x: 24, y: 14 } },
    ),
    params: [
      selectParam('source', 'Signal source', 'mic', [['mic', 'Microphone (live)'], ['tone', 'Test tone']], { showOnSchematic: true }),
      numParam('gain', 'Gain', '1', 'V', { min: 0, help: 'Voltage of a full-scale input (a loud sound): 1 V is a good size for a line-level circuit' }),
      numParam('tonefreq', 'Test-tone frequency', '440', 'Hz', { group: 'waveform', min: 0, help: 'Frequency of the test tone (also used when the microphone is not available)' }),
      selectParam('rate', 'Sample rate', '8000', MIC_RATES.map((r) => [String(r), `${r} Hz`] as [string, string]), { group: 'advanced', help: 'Samples per second fed to the circuit: 8000 Hz is enough for speech and keeps the simulation fast' }),
    ],
    toSpice: (ctx) => {
      const tone = (ctx.params.source ?? 'mic') === 'tone';
      const gain = ctx.num('gain');
      if (!(gain >= 0)) throw new Error('bad value for gain: must be >= 0');
      if (tone) {
        const f = ctx.num('tonefreq');
        return { elements: [elV(ctx.name('V', 'tone'), ctx.node('+'), ctx.node('-'), { tran: wSin(0, gain, f), acMag: gain })] };
      }
      const fs = Number(ctx.params.rate ?? '8000');
      if (!(fs > 0)) throw new Error('bad value for rate: must be > 0');
      const raw = internalNode(ctx, 'raw');
      // the stream source carries ±1 (full scale); the VCVS scales it to volts. A tiny load keeps its node defined.
      const stream = { ...elV(ctx.name('V', 'mic'), raw, '0', {}), params: { pcmfs: fs } };
      return { elements: [stream, elR(ctx.name('R', 'raw'), raw, '0', 1e6), elE(ctx.name('E', 'out'), ctx.node('+'), ctx.node('-'), raw, '0', gain)] };
    },
    provenance: 'MachSim microphone: streamed PCM source (setParam stream) scaled by a VCVS',
    footprint: 'MIC-2P',
    keywords: ['microphone', 'mic', 'audio input', 'sound', 'voice', 'record'],
  },
  { vi: 'Micrô: khi chạy mô phỏng tương tác, thiết bị thu âm mặc định (trình duyệt hỏi quyền) đưa tín hiệu vào mạch; có thanh đo mức vào và sóng thử thay thế khi không có micrô. Chế độ "Âm thử" là nguồn sin thường, chạy được cả trong các phép phân tích một lần', nameVi: 'Micrô', series: 'Audio' },
);

// ---------------------------------------------------------------------------------------------
// WAV file source

/** Longest WAV a source part accepts (samples): 30 s at 8 kHz. */
export const WAV_SOURCE_MAX_SAMPLES = 240_000;

/** The built-in sample of an empty WAV source: a 20 ms burst of 1 kHz at 8 kHz. */
function builtinBurst(): WavData {
  return { sampleRate: 8000, channels: [Float32Array.from({ length: 160 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 8000))] };
}

/** Samples of a WAV source parameter (mono, channels averaged). Throws Error('bad value for wav: …'). */
export function wavSamples(textValue: string): { rate: number; samples: Float32Array } {
  let wav: WavData;
  if (textValue.trim() === '') wav = builtinBurst();
  else {
    try {
      wav = decodeWav(base64ToBytes(textValue));
    } catch (e) {
      throw new Error(`bad value for wav: ${e instanceof WavError ? e.message : 'not a WAV file'}`);
    }
  }
  const n = wavLength(wav);
  if (n > WAV_SOURCE_MAX_SAMPLES) throw new Error(`bad value for wav: ${n} samples are too many (the limit is ${WAV_SOURCE_MAX_SAMPLES}); open a shorter file`);
  const mono = new Float32Array(n);
  for (const ch of wav.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / wav.channels.length;
  return { rate: wav.sampleRate, samples: mono };
}

/** PWL pairs (time, value) of a WAV source: time-scaled, delayed and gained. */
export function wavPwl(textValue: string, gain: number, tscale: number, delay: number): number[] {
  const { rate, samples } = wavSamples(textValue);
  const out: number[] = [];
  if (delay > 0) out.push(0, 0);
  for (let i = 0; i < samples.length; i++) out.push(delay + (i / rate) * tscale, samples[i] * gain);
  return out;
}

const WAV_HELP = 'Text of the WAV file (base64). Use "Open WAV file…" to load a .wav file; the part keeps it as 16-bit mono, at most 30 s';

function wavSource(kind: 'V' | 'I'): LibraryPartDef {
  const unit = kind === 'V' ? 'V' : 'A';
  return withMeta(
    {
      id: `sources/wav-${kind === 'V' ? 'voltage' : 'current'}`,
      name: kind === 'V' ? 'WAV File Voltage Source' : 'WAV File Current Source',
      group: 'sources',
      family: 'Audio sources',
      description: `Plays a WAV file as a ${kind === 'V' ? 'voltage' : 'current'}: full scale (±1) becomes the amplitude; the samples drive a piece-wise linear source, so every analysis sees it. An empty file plays a built-in 20 ms burst of 1 kHz`,
      prefix: kind,
      symbol: sourceSymbol(kind === 'V' ? 'pwl' : 'ac-current'),
      params: [
        { ...textParam('wav', 'WAV file', '', { group: 'waveform', help: WAV_HELP }), binaryImport: 'wav' },
        numParam('amplitude', 'Amplitude', kind === 'V' ? '1' : '1m', unit, { group: 'waveform', showOnSchematic: true, help: 'Value of a full-scale sample (±1)' }),
        numParam('tscale', 'Time scale', '1', '', { group: 'waveform', min: 0, help: '2 plays the file twice as slowly (the pitch falls); 0.5 twice as fast' }),
        numParam('delay', 'Delay', '0', 's', { group: 'waveform', min: 0 }),
        boolParam('repeat', 'Repeat', false, { group: 'waveform', help: 'Start again when the file ends' }),
      ],
      toSpice: (ctx) => {
        const pairs = wavPwl(ctx.params.wav ?? '', ctx.num('amplitude'), pos(ctx, 'tscale'), Math.max(0, ctx.num('delay')));
        const spec: SourceSpec = { dc: pairs[1], tran: wPwl(pairs, boolOf(ctx, 'repeat')) };
        return { elements: [kind === 'V' ? elV(ctx.name('V'), ctx.node('+'), ctx.node('-'), spec) : elI(ctx.name('I'), ctx.node('-'), ctx.node('+'), spec)] };
      },
      virtual: true,
      provenance: 'MachSim WAV source: PCM samples of a RIFF/WAVE file as a PWL waveform',
      keywords: ['wav', 'audio file', 'sound file', 'sample', 'recorded', 'music', 'voice'],
    },
    { vi: `Phát một tệp WAV thành ${kind === 'V' ? 'điện áp' : 'dòng điện'}: mức đầy thang (±1) bằng biên độ; các mẫu điều khiển một nguồn PWL nên phân tích nào cũng thấy. Để trống sẽ phát xung 1 kHz dài 20 ms có sẵn`, nameVi: kind === 'V' ? 'Nguồn áp từ tệp WAV' : 'Nguồn dòng từ tệp WAV', series: 'Audio' },
  );
}

export const AUDIO_CATALOG: LibraryPartDef[] = [speaker, headphones, microphone, wavSource('V'), wavSource('I')];
