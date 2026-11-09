/**
 * Extra signal sources (group Sources): triangle, sawtooth, step, chirp, FSK, thermal noise,
 * waveform from a data file, three-phase / two-phase variants, mains presets and voltage- /
 * current-controlled oscillators and a voltage-controlled PWL source.
 *
 * Waveforms (no new engine primitives are needed):
 *   triangle / sawtooth / step / file   SPICE PWL (repeating where periodic), so AC and noise
 *                                        analyses see an ordinary independent source
 *   chirp            B-source: v = Vo + Va·sin(2π·φ(t)), φ = f0·t + (f1 − f0)·t²/(2T) up to T, then f1
 *   FSK / VCO / CCO  phase-continuous: an integrator node accumulates the instantaneous frequency
 *                    (cycles), the output is Vo + Va·sin(2π·φ) (square: tanh-sharpened, triangle:
 *                    (2/π)·asin(sin(2π·φ)))
 *   thermal noise    Johnson noise of a resistor, vrms = √(4·k·T·R·B): Gaussian samples at
 *                    Δt = 1 / (2B) from a seeded generator (same seed, same waveform) in series
 *                    with the resistor itself, so a noise analysis also sees its real noise
 *   VC PWL           v = table(V(in), x1, y1, x2, y2, …): an arbitrary transfer curve
 * Every source follows the library convention: current sources push their current out of '+'.
 */
import type { ElementIR, SourceSpec } from '../../sim/netlist';
import { parseUserNumber } from '../../util/units';
import { BOLTZ, KELVIN } from '../../sim/device';
import { boolOf, boolParam, elB, elC, elI, elR, elSense, elV, ex, internalNode, numParam, parsePairs, pinConnected, textOf, textParam, wPwl, wSin, wTriangle, type LibraryPartDef } from '../partkit';
import { seededRandom } from '../../model/faults';
import { threePhaseSymbol } from '../parts/sources';
import { boxSymbol, circle, controlledSourceSymbol, line, pin, sourceSymbol, text } from '../symbols';
import type { ParamDef, ToSpiceContext } from '../types';
import { withMeta } from './kit';

type Kind = 'V' | 'I';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

function acParams(): ParamDef[] {
  return [
    numParam('acmag', 'AC analysis magnitude', '0', '', { group: 'advanced', help: 'Small-signal magnitude used by AC / noise analyses' }),
    numParam('acphase', 'AC analysis phase', '0', '°', { group: 'advanced' }),
  ];
}

function acSpec(ctx: ToSpiceContext): Pick<SourceSpec, 'acMag' | 'acPhase'> {
  const mag = ctx.num('acmag');
  return mag !== 0 ? { acMag: mag, acPhase: ctx.num('acphase') } : {};
}

function srcEl(ctx: ToSpiceContext, kind: Kind, spec: SourceSpec): ElementIR {
  return kind === 'V' ? elV(ctx.name('V'), ctx.node('+'), ctx.node('-'), spec) : elI(ctx.name('I'), ctx.node('-'), ctx.node('+'), spec);
}

const unit = (k: Kind) => (k === 'V' ? 'V' : 'A');
const word = (k: Kind) => (k === 'V' ? 'Voltage' : 'Current');
const wordVi = (k: Kind) => (k === 'V' ? 'áp' : 'dòng');

interface WaveSpec {
  slug: string;
  en: string;
  vi: string;
  name: (k: Kind) => string;
  nameVi: (k: Kind) => string;
  glyph: Parameters<typeof sourceSymbol>[0];
  params: (k: Kind) => ParamDef[];
  wave: (ctx: ToSpiceContext) => SourceSpec;
  keywords: string[];
}

const WAVES: WaveSpec[] = [
  {
    slug: 'triangle',
    name: (k) => `Triangle ${word(k)} Source`,
    nameVi: (k) => `Nguồn ${wordVi(k)} tam giác`,
    en: 'Periodic triangle wave between the low and high level; "rise time" sets the symmetry (50 % = symmetric)',
    vi: 'Sóng tam giác tuần hoàn giữa mức thấp và mức cao; "thời gian lên" đặt độ đối xứng (50 % = đối xứng)',
    glyph: 'pwl',
    params: (k) => [
      numParam('low', 'Low level', k === 'V' ? '-1' : '-1m', unit(k), { group: 'waveform' }),
      numParam('high', 'High level', k === 'V' ? '1' : '1m', unit(k), { group: 'waveform', showOnSchematic: true }),
      numParam('freq', 'Frequency', '1k', 'Hz', { group: 'waveform', min: 0, showOnSchematic: true }),
      numParam('rise', 'Rise time (% of period)', '50', '%', { group: 'waveform', min: 0.1, max: 99.9 }),
      ...acParams(),
    ],
    wave: (ctx) => ({ tran: wTriangle(ctx.num('low'), ctx.num('high'), pos(ctx, 'freq'), ctx.num('rise') / 100), ...acSpec(ctx) }),
    keywords: ['triangle', 'triangular', 'ramp', 'function generator'],
  },
  {
    slug: 'sawtooth',
    name: (k) => `Sawtooth ${word(k)} Source`,
    nameVi: (k) => `Nguồn ${wordVi(k)} răng cưa`,
    en: 'Periodic sawtooth: a linear ramp from the start level to the end level, then a fast return',
    vi: 'Sóng răng cưa tuần hoàn: dốc tuyến tính từ mức đầu tới mức cuối rồi trở về nhanh',
    glyph: 'pwl',
    params: (k) => [
      numParam('low', 'Start level', k === 'V' ? '0' : '0', unit(k), { group: 'waveform' }),
      numParam('high', 'End level', k === 'V' ? '1' : '1m', unit(k), { group: 'waveform', showOnSchematic: true }),
      numParam('freq', 'Frequency', '1k', 'Hz', { group: 'waveform', min: 0, showOnSchematic: true }),
      numParam('ret', 'Return time (% of period)', '1', '%', { group: 'waveform', min: 0.01, max: 50 }),
      ...acParams(),
    ],
    wave: (ctx) => {
      const per = 1 / pos(ctx, 'freq');
      const r = Math.min(0.5, Math.max(1e-4, ctx.num('ret') / 100));
      return { tran: wPwl([0, ctx.num('low'), per * (1 - r), ctx.num('high'), per, ctx.num('low')], true), ...acSpec(ctx) };
    },
    keywords: ['sawtooth', 'ramp', 'time base'],
  },
  {
    slug: 'step',
    name: (k) => `Step ${word(k)} Source`,
    nameVi: (k) => `Nguồn ${wordVi(k)} bậc thang`,
    en: 'Single step from the initial to the final value at the step time, with a linear rise (step response tests)',
    vi: 'Một bước nhảy từ giá trị đầu tới giá trị cuối tại thời điểm bước, cạnh lên tuyến tính (thử đáp ứng bậc thang)',
    glyph: 'pulse',
    params: (k) => [
      numParam('v0', 'Initial value', '0', unit(k), { group: 'waveform' }),
      numParam('v1', 'Final value', k === 'V' ? '1' : '1m', unit(k), { group: 'waveform', showOnSchematic: true }),
      numParam('tstep', 'Step time', '0', 's', { group: 'waveform', min: 0 }),
      numParam('trise', 'Rise time', '1n', 's', { group: 'waveform', min: 0 }),
      ...acParams(),
    ],
    wave: (ctx) => {
      const td = Math.max(0, ctx.num('tstep'));
      const tr = Math.max(1e-12, ctx.num('trise'));
      const v0 = ctx.num('v0');
      return { tran: wPwl([0, v0, td, v0, td + tr, ctx.num('v1')]), ...acSpec(ctx) };
    },
    keywords: ['step', 'heaviside', 'unit step', 'step response'],
  },
  {
    slug: 'file',
    name: (k) => `${word(k)} Source from File`,
    nameVi: (k) => `Nguồn ${wordVi(k)} từ file dữ liệu`,
    en: 'Arbitrary waveform from a data file (two columns: time and value, separated by spaces, commas, tabs or semicolons; lines starting with # are ignored)',
    vi: 'Dạng sóng tuỳ ý từ file dữ liệu (hai cột: thời gian và giá trị, ngăn bằng dấu cách, phẩy, tab hoặc chấm phẩy; dòng bắt đầu bằng # được bỏ qua)',
    glyph: 'pwl',
    params: () => [
      textParam('data', 'Waveform data', '0 0\n1m 1\n2m 0', { group: 'waveform', fileImport: '.csv,.txt,.pwl,.dat', help: 'One "time value" pair per line; use Open file… to load a CSV / text file' }),
      numParam('tscale', 'Time scale', '1', '', { group: 'waveform', min: 0 }),
      numParam('vscale', 'Value scale', '1', '', { group: 'waveform' }),
      boolParam('repeat', 'Repeat waveform', false, { group: 'waveform' }),
      ...acParams(),
    ],
    wave: (ctx) => {
      const pairs = parseDataFile(textOf(ctx, 'data'));
      const ts = pos(ctx, 'tscale');
      const vs = ctx.num('vscale');
      const scaled = pairs.map((v, i) => (i % 2 === 0 ? v * ts : v * vs));
      return { dc: scaled[1], tran: wPwl(scaled, boolOf(ctx, 'repeat')), ...acSpec(ctx) };
    },
    keywords: ['file', 'csv', 'data', 'arbitrary', 'pwl', 'recorded'],
  },
];

/**
 * "time value" pairs of a data file (space, tab, comma or semicolon separated, user-number
 * syntax): a line with an even count of numbers holds that many pairs ("0 0, 1m 5" on one line
 * works like the PWL source), a line with an odd count (e.g. three CSV columns) gives its first
 * two numbers. Comment lines (#, ;, *, //) and header lines with words are skipped. Throws
 * "bad value for data: …" when no pair remains or times decrease.
 */
export function parseDataFile(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^(#|;|\*|\/\/)/.test(line)) continue;
    const nums = line
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((p) => parseUserNumber(p));
    if (nums.length < 2 || nums.some((x) => !Number.isFinite(x))) continue;
    if (nums.length % 2 === 0) out.push(...nums);
    else out.push(nums[0], nums[1]);
  }
  if (out.length < 2) throw new Error('bad value for data: no "time value" pairs found');
  for (let i = 2; i < out.length; i += 2) if (out[i] < out[i - 2]) throw new Error('bad value for data: times must not decrease');
  return out;
}

function wavePart(s: WaveSpec, kind: Kind): LibraryPartDef {
  return withMeta(
    {
      id: `sources/${s.slug}-${kind === 'V' ? 'voltage' : 'current'}`,
      name: s.name(kind),
      group: 'sources',
      family: kind === 'V' ? 'Voltage sources' : 'Current sources',
      description: s.en,
      prefix: kind,
      symbol: sourceSymbol(kind === 'V' ? s.glyph : 'ac-current'),
      params: s.params(kind),
      toSpice: (ctx) => ({ elements: [srcEl(ctx, kind, s.wave(ctx))] }),
      keywords: s.keywords,
      virtual: true,
    },
    { vi: s.vi, nameVi: s.nameVi(kind) },
  );
}

const waveSources = WAVES.flatMap((s) => [wavePart(s, 'V'), wavePart(s, 'I')]);

// ---------------------------------------------------------------------------------------------
// chirp, FSK, noise

const chirp: LibraryPartDef = withMeta(
  {
    id: 'sources/chirp-voltage',
    name: 'Chirp Voltage Source',
    group: 'sources',
    family: 'Voltage sources',
    description: 'Linear frequency sweep (chirp): the frequency rises from the start to the stop frequency over the sweep time, then stays at the stop frequency',
    prefix: 'V',
    symbol: sourceSymbol('fm'),
    params: [
      numParam('vo', 'Offset', '0', 'V', { group: 'waveform' }),
      numParam('va', 'Amplitude', '1', 'V', { group: 'waveform', showOnSchematic: true }),
      numParam('f0', 'Start frequency', '100', 'Hz', { group: 'waveform', min: 0 }),
      numParam('f1', 'Stop frequency', '10k', 'Hz', { group: 'waveform', min: 0 }),
      numParam('tsweep', 'Sweep time', '10m', 's', { group: 'waveform', min: 0 }),
    ],
    toSpice: (ctx) => {
      const f0 = ctx.num('f0');
      const f1 = ctx.num('f1');
      const T = pos(ctx, 'tsweep');
      const tc = `min(time,${ex(T)})`;
      const phase = `(${ex(f0)}*${tc}+${ex((f1 - f0) / (2 * T))}*${tc}*${tc}+${ex(f1)}*max(time-${ex(T)},0))`;
      return { elements: [elB(ctx.name('B'), ctx.node('+'), ctx.node('-'), 'V', `${ex(ctx.num('vo'))}+${ex(ctx.num('va'))}*sin(6.283185307179586*${phase})`)] };
    },
    keywords: ['chirp', 'sweep', 'swept sine', 'frequency sweep'],
    virtual: true,
  },
  { vi: 'Quét tần số tuyến tính (chirp): tần số tăng từ tần số đầu tới tần số cuối trong thời gian quét rồi giữ ở tần số cuối', nameVi: 'Nguồn áp quét tần (chirp)' },
);

/** Bit pattern ("1011") as a repeating PWL of 0 / 1 levels at the bit rate (1 ns edges). */
function bitsPwl(bits: string, rate: number): number[] {
  const b = bits.replace(/[^01]/g, '');
  if (!b.length) throw new Error('bad value for bits: use a pattern of 0 and 1, e.g. 1011');
  const tb = 1 / rate;
  const edge = Math.min(1e-9, tb / 100);
  const out: number[] = [0, Number(b[0])];
  for (let i = 1; i < b.length; i++) out.push(i * tb, Number(b[i - 1]), i * tb + edge, Number(b[i]));
  out.push(b.length * tb, Number(b[b.length - 1]));
  return out;
}

const FSK_SYMBOL = sourceSymbol('fm', { extra: [line(-30, 0, -15, 0), text(-24, -4, 'K', 6)], extraPins: [pin('KEY', -30, 0, 'left', { number: '3', type: 'input' })] });

const fsk: LibraryPartDef = withMeta(
  {
    id: 'sources/fsk-voltage',
    name: 'FSK Voltage Source',
    group: 'sources',
    family: 'Voltage sources',
    description: 'Frequency-shift keying: phase-continuous sine at the mark frequency f1 for bit 1 and the space frequency f0 for bit 0; bits come from the KEY input (V(KEY,−) above the threshold = 1) or, when KEY is open, from the repeating bit pattern',
    prefix: 'V',
    symbol: FSK_SYMBOL,
    params: [
      numParam('va', 'Amplitude', '1', 'V', { group: 'waveform', showOnSchematic: true }),
      numParam('f0', 'Space frequency (bit 0)', '1k', 'Hz', { group: 'waveform', min: 0 }),
      numParam('f1', 'Mark frequency (bit 1)', '2k', 'Hz', { group: 'waveform', min: 0 }),
      textParam('bits', 'Bit pattern', '10110010', { group: 'waveform', help: 'Used when the KEY pin is not connected' }),
      numParam('rate', 'Bit rate', '500', 'bit/s', { group: 'waveform', min: 0 }),
      numParam('vth', 'KEY threshold', '2.5', 'V', { group: 'waveform' }),
    ],
    optionalPins: ['KEY'],
    toSpice: (ctx) => {
      const els: ElementIR[] = [];
      const neg = ctx.node('-');
      let keyExpr: string;
      if (pinConnected(ctx, 'KEY')) keyExpr = `(0.5+0.5*tanh(50*(V(${ctx.node('KEY')},${neg})-${ex(ctx.num('vth'))})))`;
      else {
        const k = internalNode(ctx, 'k');
        els.push(elV(ctx.name('V', 'bits'), k, '0', { dc: 0, tran: wPwl(bitsPwl(textOf(ctx, 'bits'), pos(ctx, 'rate')), true) }), elR(ctx.name('R', 'key'), ctx.node('KEY'), neg, 1e9));
        keyExpr = `limit(V(${k}),0,1)`;
      }
      const ph = internalNode(ctx, 'ph');
      const f0 = ctx.num('f0');
      const f1 = ctx.num('f1');
      els.push(
        // phase in cycles; held at 0 for the operating point (time = 0)
        elB(ctx.name('B', 'ph'), '0', ph, 'I', `(${ex(f0)}+${ex(f1 - f0)}*${keyExpr})*u(time)`),
        elC(ctx.name('C', 'ph'), ph, '0', 1),
        elR(ctx.name('R', 'ph'), ph, '0', 1e12),
        elB(ctx.name('B'), ctx.node('+'), neg, 'V', `${ex(ctx.num('va'))}*sin(6.283185307179586*V(${ph}))`),
      );
      return { elements: els };
    },
    keywords: ['fsk', 'frequency shift keying', 'modem', 'digital modulation'],
    virtual: true,
  },
  { vi: 'Điều chế dịch tần (FSK): sóng sin liên tục pha ở tần số mark f1 cho bit 1 và tần số space f0 cho bit 0; bit lấy từ chân KEY (V(KEY,−) trên ngưỡng = 1) hoặc, khi để hở KEY, từ chuỗi bit lặp lại', nameVi: 'Nguồn áp FSK' },
);

const noise: LibraryPartDef = withMeta(
  {
    id: 'sources/thermal-noise',
    name: 'Thermal Noise Source',
    group: 'sources',
    family: 'Voltage sources',
    description: 'Johnson (thermal) noise of a resistor: vrms = √(4kTRB) over the bandwidth B, in series with R; set "RMS override" for a louder white-noise test signal. The same seed gives the same waveform',
    prefix: 'V',
    symbol: sourceSymbol('ac', { extra: [text(0, -18, 'n', 7)] }),
    params: [
      numParam('r', 'Resistance', '1k', 'Ω', { group: 'waveform', min: 0, showOnSchematic: true }),
      numParam('temp', 'Temperature', '27', '°C', { group: 'waveform' }),
      numParam('bw', 'Bandwidth', '100k', 'Hz', { group: 'waveform', min: 0 }),
      numParam('vrms', 'RMS override', '', 'V', { group: 'waveform', help: 'Blank = thermal noise √(4kTRB); a value sets the RMS of the noise directly' }),
      numParam('duration', 'Noise record length', '10m', 's', { group: 'waveform', min: 0, help: 'The noise record repeats after this time' }),
      numParam('seed', 'Random seed', '1', '', { group: 'waveform', min: 0 }),
    ],
    toSpice: (ctx) => {
      const r = pos(ctx, 'r');
      const bw = pos(ctx, 'bw');
      const tk = ctx.num('temp') + KELVIN;
      const override = (ctx.params.vrms ?? '').trim() ? ctx.num('vrms') : undefined;
      const vrms = override ?? Math.sqrt(4 * BOLTZ * tk * r * bw);
      const dt = 1 / (2 * bw);
      const n = Math.min(20000, Math.max(8, Math.ceil(pos(ctx, 'duration') / dt)));
      const rnd = seededRandom(Math.round(ctx.num('seed')) || 1);
      const pts: number[] = [];
      for (let i = 0; i < n; i++) {
        // Box–Muller
        const u1 = Math.max(1e-12, rnd());
        const u2 = rnd();
        pts.push(i * dt, vrms * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2));
      }
      pts.push(n * dt, pts[1]);
      const m = internalNode(ctx, 'm');
      return { elements: [elV(ctx.name('V'), ctx.node('+'), m, { dc: 0, tran: wPwl(pts, true) }), elR(ctx.name('R'), m, ctx.node('-'), r)] };
    },
    keywords: ['noise', 'thermal noise', 'johnson', 'white noise', 'random'],
    virtual: true,
  },
  { vi: 'Nhiễu nhiệt (Johnson) của điện trở: vrms = √(4kTRB) trong dải thông B, mắc nối tiếp với R; đặt "RMS ghi đè" để có tín hiệu nhiễu trắng lớn hơn khi thử. Cùng hạt giống cho cùng dạng sóng', nameVi: 'Nguồn nhiễu nhiệt' },
);

// ---------------------------------------------------------------------------------------------
// mains presets, three-phase and two-phase variants

const mains: LibraryPartDef[] = (
  [
    ['mains-220v-50hz', 'Mains 220 V 50 Hz', 'Điện lưới 220 V 50 Hz', 220, 50, 'Single-phase mains as in Vietnam: 220 V RMS, 50 Hz', 'Điện lưới một pha như ở Việt Nam: 220 V hiệu dụng, 50 Hz'],
    ['mains-230v-50hz', 'Mains 230 V 50 Hz', 'Điện lưới 230 V 50 Hz', 230, 50, 'Single-phase mains, 230 V RMS, 50 Hz', 'Điện lưới một pha 230 V hiệu dụng, 50 Hz'],
    ['mains-120v-60hz', 'Mains 120 V 60 Hz', 'Điện lưới 120 V 60 Hz', 120, 60, 'Single-phase mains, 120 V RMS, 60 Hz', 'Điện lưới một pha 120 V hiệu dụng, 60 Hz'],
  ] as const
).map(([slug, name, nameVi, vrms, f, en, vi]) =>
  withMeta(
    {
      id: `sources/${slug}`,
      name,
      group: 'sources',
      family: 'Power',
      description: `${en} (L at +, N at −)`,
      prefix: 'V',
      symbol: sourceSymbol('ac', { names: ['+', '-'] }),
      params: [numParam('vrms', 'Voltage (RMS)', String(vrms), 'V', { showOnSchematic: true, min: 0 }), numParam('freq', 'Frequency', String(f), 'Hz', { showOnSchematic: true, min: 0 })],
      toSpice: (ctx) => ({ elements: [elV(ctx.name('V'), ctx.node('+'), ctx.node('-'), { tran: wSin(0, ctx.num('vrms') * Math.SQRT2, ctx.num('freq')), acMag: ctx.num('vrms') * Math.SQRT2 })] }),
      keywords: ['mains', 'ac power', 'grid', `${vrms}v`, `${f}hz`],
      virtual: true,
    },
    { vi: `${vi} (L ở cực +, N ở cực −)`, nameVi },
  ),
);

const threePhase380: LibraryPartDef = withMeta(
  {
    id: 'sources/three-phase-380v-50hz',
    name: 'Three-Phase 380 V 50 Hz',
    group: 'sources',
    family: 'Power',
    description: 'Three-phase four-wire supply as in Vietnam: 220 V phase / 380 V line, 50 Hz (wye, L1-N 0°, L2-N −120°, L3-N +120°)',
    prefix: 'V',
    symbol: threePhaseSymbol(true),
    params: [numParam('vrms', 'Phase voltage (RMS)', '220', 'V', { showOnSchematic: true, min: 0 }), numParam('freq', 'Frequency', '50', 'Hz', { showOnSchematic: true, min: 0 })],
    toSpice: (ctx) => {
      const vp = ctx.num('vrms') * Math.SQRT2;
      const f = ctx.num('freq');
      const n = ctx.node('N');
      return { elements: [0, -120, 120].map((ph, i) => elV(ctx.name('V', `L${i + 1}`), ctx.node(`L${i + 1}`), n, { tran: wSin(0, vp, f, 0, 0, ph) })) };
    },
    keywords: ['three phase', '380v', '50hz', 'mains', 'wye', 'star'],
    virtual: true,
  },
  { vi: 'Nguồn ba pha bốn dây như lưới điện Việt Nam: 220 V pha / 380 V dây, 50 Hz (nối sao, L1-N 0°, L2-N −120°, L3-N +120°)', nameVi: 'Nguồn ba pha 380 V 50 Hz' },
);

const threePhaseAdj: LibraryPartDef = withMeta(
  {
    id: 'sources/three-phase-adjustable',
    name: 'Three-Phase Source (Adjustable)',
    group: 'sources',
    family: 'Power',
    description: 'Wye three-phase source with per-phase amplitude and phase angle (unbalanced supplies, negative sequence, phase loss)',
    prefix: 'V',
    symbol: threePhaseSymbol(true),
    params: [
      numParam('v1', 'L1 voltage (RMS)', '220', 'V', { min: 0, showOnSchematic: true }),
      numParam('v2', 'L2 voltage (RMS)', '220', 'V', { min: 0 }),
      numParam('v3', 'L3 voltage (RMS)', '220', 'V', { min: 0 }),
      numParam('p1', 'L1 phase', '0', '°', {}),
      numParam('p2', 'L2 phase', '-120', '°', {}),
      numParam('p3', 'L3 phase', '120', '°', {}),
      numParam('freq', 'Frequency', '50', 'Hz', { min: 0, showOnSchematic: true }),
    ],
    toSpice: (ctx) => {
      const f = ctx.num('freq');
      const n = ctx.node('N');
      return { elements: [1, 2, 3].map((i) => elV(ctx.name('V', `L${i}`), ctx.node(`L${i}`), n, { tran: wSin(0, ctx.num(`v${i}`) * Math.SQRT2, f, 0, 0, ctx.num(`p${i}`)) })) };
    },
    keywords: ['three phase', 'unbalanced', 'negative sequence', 'polyphase'],
    virtual: true,
  },
  { vi: 'Nguồn ba pha nối sao với biên độ và góc pha từng pha chỉnh được (nguồn không cân bằng, thứ tự ngược, mất pha)', nameVi: 'Nguồn ba pha (chỉnh được)' },
);

const threePhaseCurrent: LibraryPartDef = withMeta(
  {
    id: 'sources/three-phase-current-wye',
    name: 'Three-Phase Current Source (Wye)',
    group: 'sources',
    family: 'Power',
    description: 'Balanced three-phase current source: currents leave L1, L2, L3 at 0°, −120°, +120° and return through N',
    prefix: 'I',
    symbol: threePhaseSymbol(true),
    params: [numParam('irms', 'Phase current (RMS)', '1', 'A', { min: 0, showOnSchematic: true }), numParam('freq', 'Frequency', '50', 'Hz', { min: 0, showOnSchematic: true })],
    toSpice: (ctx) => {
      const ip = ctx.num('irms') * Math.SQRT2;
      const f = ctx.num('freq');
      const n = ctx.node('N');
      return { elements: [0, -120, 120].map((ph, i) => elI(ctx.name('I', `L${i + 1}`), n, ctx.node(`L${i + 1}`), { tran: wSin(0, ip, f, 0, 0, ph) })) };
    },
    keywords: ['three phase', 'current source', 'polyphase'],
    virtual: true,
  },
  { vi: 'Nguồn dòng ba pha cân bằng: dòng ra ở L1, L2, L3 lệch 0°, −120°, +120° và trở về qua N', nameVi: 'Nguồn dòng ba pha (nối sao)' },
);

const twoPhase: LibraryPartDef = withMeta(
  {
    id: 'sources/two-phase',
    name: 'Two-Phase Source (Quadrature)',
    group: 'sources',
    family: 'Power',
    description: 'Two sine voltages A-N and B-N 90° apart (quadrature), e.g. for two-phase motors, resolvers and I/Q tests',
    prefix: 'V',
    symbol: boxSymbol({ w: 40, h: 40, right: [{ name: 'A', number: '1' }, { name: 'B', number: '2' }], left: [{ name: 'N', number: '3' }], extra: [circle(0, 0, 14), text(0, 4, '2~', 9, 'middle', true)] }),
    params: [numParam('vrms', 'Voltage (RMS)', '10', 'V', { min: 0, showOnSchematic: true }), numParam('freq', 'Frequency', '50', 'Hz', { min: 0, showOnSchematic: true })],
    toSpice: (ctx) => {
      const vp = ctx.num('vrms') * Math.SQRT2;
      const f = ctx.num('freq');
      const n = ctx.node('N');
      return { elements: [elV(ctx.name('V', 'A'), ctx.node('A'), n, { tran: wSin(0, vp, f, 0, 0, 0) }), elV(ctx.name('V', 'B'), ctx.node('B'), n, { tran: wSin(0, vp, f, 0, 0, -90) })] };
    },
    keywords: ['two phase', 'quadrature', 'iq', 'resolver'],
    virtual: true,
  },
  { vi: 'Hai điện áp sin A-N và B-N lệch nhau 90° (vuông pha), dùng cho động cơ hai pha, resolver và thử I/Q', nameVi: 'Nguồn hai pha (vuông pha)' },
);

// ---------------------------------------------------------------------------------------------
// voltage- / current-controlled oscillators and VC PWL

type Shape = 'sine' | 'square' | 'triangle';

function oscParams(ctrl: 'V' | 'I'): ParamDef[] {
  return [
    numParam('f0', 'Frequency at zero control', '1k', 'Hz', { group: 'waveform', min: 0, showOnSchematic: true }),
    numParam('kf', ctrl === 'V' ? 'Frequency per volt' : 'Frequency per ampere', ctrl === 'V' ? '1k' : '1meg', ctrl === 'V' ? 'Hz/V' : 'Hz/A', { group: 'waveform' }),
    numParam('va', 'Amplitude', '1', 'V', { group: 'waveform' }),
    numParam('vo', 'Offset', '0', 'V', { group: 'waveform' }),
  ];
}

function oscPart(shape: Shape, ctrl: 'V' | 'I'): LibraryPartDef {
  const shapeEn = shape === 'sine' ? 'Sine' : shape === 'square' ? 'Square' : 'Triangle';
  const shapeVi = shape === 'sine' ? 'sin' : shape === 'square' ? 'vuông' : 'tam giác';
  const ctlEn = ctrl === 'V' ? 'Voltage' : 'Current';
  const out = (ph: string) => (shape === 'sine' ? `sin(6.283185307179586*${ph})` : shape === 'square' ? `tanh(40*sin(6.283185307179586*${ph}))` : `0.6366197723675814*asin(0.99999*sin(6.283185307179586*${ph}))`);
  return withMeta(
    {
      id: `sources/${ctrl === 'V' ? 'vc' : 'cc'}-${shape}`,
      name: `${ctlEn}-Controlled ${shapeEn}`,
      group: 'sources',
      family: 'Controlled sources',
      description: `${ctlEn}-controlled ${shapeEn.toLowerCase()} oscillator: f = f0 + k·${ctrl === 'V' ? 'V(in+,in−)' : 'I(in+ → in−)'}, phase-continuous; output V(out+,out−) = offset + amplitude·${shape} wave`,
      prefix: 'V',
      symbol: controlledSourceSymbol('voltage', ctrl === 'I'),
      params: oscParams(ctrl),
      toSpice: (ctx) => {
        const els: ElementIR[] = [];
        let ctl: string;
        if (ctrl === 'V') ctl = `V(${ctx.node('in+')},${ctx.node('in-')})`;
        else {
          const sense = ctx.name('V', 'ctl');
          els.push(elSense(sense, ctx.node('in+'), ctx.node('in-')));
          ctl = `I(${sense})`;
        }
        const ph = internalNode(ctx, 'ph');
        els.push(
          elB(ctx.name('B', 'ph'), '0', ph, 'I', `max(${ex(ctx.num('f0'))}+${ex(ctx.num('kf'))}*${ctl},0)*u(time)`),
          elC(ctx.name('C', 'ph'), ph, '0', 1),
          elR(ctx.name('R', 'ph'), ph, '0', 1e12),
          elB(ctx.name('B'), ctx.node('out+'), ctx.node('out-'), 'V', `${ex(ctx.num('vo'))}+${ex(ctx.num('va'))}*${out(`V(${ph})`)}`),
        );
        if (ctrl === 'V') els.push(elR(ctx.name('R', 'in'), ctx.node('in+'), ctx.node('in-'), 1e9));
        return { elements: els };
      },
      keywords: ['vco', 'controlled oscillator', ctlEn.toLowerCase() + ' controlled', shape],
      virtual: true,
    },
    { vi: `Bộ dao động ${shapeVi} điều khiển bằng ${ctrl === 'V' ? 'điện áp' : 'dòng điện'}: f = f0 + k·${ctrl === 'V' ? 'V(in+,in−)' : 'I(in+ → in−)'}, liên tục pha; ngõ ra V(out+,out−) = độ lệch + biên độ·sóng ${shapeVi}`, nameVi: `Nguồn ${shapeVi} điều khiển bằng ${ctrl === 'V' ? 'áp' : 'dòng'}` },
  );
}

const vcPwl: LibraryPartDef = withMeta(
  {
    id: 'sources/vc-pwl',
    name: 'Voltage-Controlled PWL Source',
    group: 'sources',
    family: 'Controlled sources',
    description: 'Arbitrary transfer curve: V(out+,out−) = table(V(in+,in−)) through the given "input output" points (linear between them, flat outside)',
    prefix: 'V',
    symbol: controlledSourceSymbol('voltage', false),
    params: [textParam('points', 'Input / output pairs', '-1 -1, 0 0, 1 2, 2 2', { help: 'Comma-separated "input output" pairs with increasing inputs (user number syntax)' })],
    toSpice: (ctx) => {
      let pairs: number[];
      try {
        pairs = parsePairs(textOf(ctx, 'points'));
      } catch (e) {
        throw new Error(`bad value for points: ${(e as Error).message}`);
      }
      if (pairs.length < 4) throw new Error('bad value for points: give at least two pairs');
      return {
        elements: [
          elB(ctx.name('B'), ctx.node('out+'), ctx.node('out-'), 'V', `table(V(${ctx.node('in+')},${ctx.node('in-')}),${pairs.map(ex).join(',')})`),
          elR(ctx.name('R', 'in'), ctx.node('in+'), ctx.node('in-'), 1e9),
        ],
      };
    },
    keywords: ['pwl', 'table', 'transfer curve', 'nonlinear', 'controlled source'],
    virtual: true,
  },
  { vi: 'Đường cong truyền tuỳ ý: V(out+,out−) = table(V(in+,in−)) qua các điểm "vào ra" đã cho (tuyến tính giữa các điểm, phẳng ở ngoài)', nameVi: 'Nguồn PWL điều khiển bằng áp' },
);

const controlled: LibraryPartDef[] = [oscPart('sine', 'V'), oscPart('square', 'V'), oscPart('triangle', 'V'), oscPart('sine', 'I'), oscPart('square', 'I'), vcPwl];


export const SOURCE_CATALOG: LibraryPartDef[] = [...waveSources, chirp, fsk, noise, ...mains, threePhase380, threePhaseAdj, threePhaseCurrent, twoPhase, ...controlled];
