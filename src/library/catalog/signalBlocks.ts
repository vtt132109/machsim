/**
 * Sources and control-function blocks of round 3 (group Sources and Analog › Control functions):
 *
 * Sources
 *   laplace-vcvs / -vccs / -ccvs / -cccs   arbitrary Laplace function H(s) between a voltage or
 *                     current control and a voltage or current output: numerator / denominator
 *                     coefficients (highest power of s first, like tf() in textbooks) or an
 *                     s-expression. Realised by the LAPLACE device (src/sim/devices/linear/
 *                     laplace.ts): exact in AC, the same H(0) in DC, integrated states in transient.
 *                     Current control: a 0 V sense source in+ → in- and a 1 V/A transresistance.
 *   controlled-one-shot  monostable: A_ONESHOT code model (pulse width pw + kpw·V(CTRL))
 *   current-limiter      V(OUT) follows gain·V(IN) behind rout, but the output current is clamped
 *                        to +isource / −isink (behavioural Norton stage)
 *   dc-interactive-*     DC source whose value is stepped with a key or the slider while the
 *                        interactive simulation runs (InteractiveDef stepParam / minParam / maxParam)
 *   delay                pure time delay: V(out+,out−)(t) = V(in+,in−)(t − td), through a matched
 *                        lossless line (exact delay in transient, e^{−jωtd} in AC, gain 1 in DC)
 *   pwm-voltage          PWM pulse train (A_PWM, duty fixed or sine-modulated)
 *   bipolar-voltage      bipolar pulse train +A / 0 / −A / 0 (gap 0 = a ±A square wave)
 *   ground-ref1..5       separate reference grounds (see REFERENCE GROUNDS below)
 *   vc-sawtooth          voltage-controlled sawtooth oscillator (phase-continuous)
 * Control functions (single-ended, referred to ground)
 *   summer-2             two-input summer
 *   integrator-reset     integrator with reset input and output limits (anti-windup)
 *   hysteresis           Schmitt block (A_HYST)
 *   slew-limiter         slew-rate limiter (separate rising / falling rates)
 *   transfer-function    H(s) block (LAPLACE)
 *   sample-hold          sample-and-hold: edge-sampled (A_SAH) or track-and-hold (switch + C)
 *   pwm-modulator        regular-sampled PWM modulator (A_PWM)
 *
 * REFERENCE GROUNDS ("Đất tham chiếu 1…5"): each number is its own global net GNDREF<n>, NOT the
 * SPICE ground. It is the 0 V reference of an isolated part of the circuit (a transformer or
 * optocoupler secondary, a floating measurement), joined to the main ground only through a
 * 1 GΩ tie resistor R_GNDREF<n>_tie so the circuit stays solvable (an isolated circuit with a
 * reference ground needs no main ground symbol). Voltage probes on a part of the circuit whose
 * only reference is GNDREF<n> read against it; ERC warns when the reference is not isolated (a DC
 * path through the circuit joins it to the main ground or to another reference). See
 * src/model/netlister.ts and src/model/erc.ts checkReferenceGrounds.
 */
import type { ElementIR, ModelCard } from '../../sim/netlist';
import { rationalTransform } from '../../sim/spice/laplace';
import { parseUserNumber } from '../../util/units';
import { boolOf, boolParam, card, sawtoothOf, elB, elC, elE, elG, elH, elI, elR, elS, elSense, elT, elV, ex, internalNode, numParam, optNum, pinConnected, selectParam, swModel, textOf, textParam, wPwl, type LibraryPartDef } from '../partkit';
import { boxSymbol, controlledSourceSymbol, line, makeSymbol, pin, poly, sourceSymbol, text } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';
import { withMeta } from './kit';

// ---------------------------------------------------------------------------------------------
// shared helpers

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

/** Node of an optional pin, or the XSPICE NULL port when it is not connected. */
const optNode = (ctx: ToSpiceContext, pinName: string): string => (pinConnected(ctx, pinName) ? ctx.node(pinName) : 'null');

/** Signal of an input pin for block expressions: V(node), or 0 when the pin is unconnected. */
const inSig = (ctx: ToSpiceContext, pinName: string): string => (pinConnected(ctx, pinName) ? `V(${ctx.node(pinName)})` : '0');

/** Coefficient list "1m 1" / "1, 0, 1e6" (user numbers), highest power first. */
export function parseCoefficients(textIn: string, key: string): number[] {
  // spaces / semicolons separate coefficients; "a, b" works too ("4,7k" stays a decimal comma)
  const parts = textIn
    .split(/[\s;]+|,(?=\s)|,(?![0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error(`bad value for ${key}: give at least one coefficient`);
  const out = parts.map((p) => parseUserNumber(p));
  if (out.some((v) => !Number.isFinite(v))) throw new Error(`bad value for ${key}: every coefficient must be a number`);
  return out;
}

/**
 * H(s) of a Laplace part from its params: form 'coeff' (num / den, highest power of s first) or
 * 'expr' (s-expression). Ascending coefficients, proper, denominator not zero.
 */
export function laplaceFromParams(ctx: ToSpiceContext): { num: number[]; den: number[] } {
  const form = textOf(ctx, 'form', 'coeff').trim().toLowerCase();
  let num: number[];
  let den: number[];
  if (form === 'expr') {
    try {
      ({ num, den } = rationalTransform(textOf(ctx, 'expr')));
    } catch (e) {
      throw new Error(`bad value for expr: ${(e as Error).message}`);
    }
  } else {
    num = parseCoefficients(textOf(ctx, 'num'), 'num').reverse();
    den = parseCoefficients(textOf(ctx, 'den'), 'den').reverse();
    while (den.length > 1 && den[den.length - 1] === 0) den.pop();
    while (num.length > 1 && num[num.length - 1] === 0) num.pop();
    if (den.every((c) => c === 0)) throw new Error('bad value for den: the denominator is zero');
    if (num.length > den.length) throw new Error('bad value for num: the numerator degree must not exceed the denominator degree (H(s) must be proper)');
  }
  const k = ctx.num('gain');
  return { num: num.map((c) => c * k), den };
}

function laplaceParams(): ParamDef[] {
  return [
    selectParam('form', 'Transfer function given as', 'coeff', [
      ['coeff', 'Numerator / denominator coefficients'],
      ['expr', 'Expression in s'],
    ]),
    textParam('num', 'Numerator coefficients', '1', { help: 'Coefficients of the numerator, highest power of s first, separated by spaces: "1" = 1, "1 0" = s, "2 0 5" = 2s² + 5' }),
    textParam('den', 'Denominator coefficients', '1m 1', { showOnSchematic: true, help: 'Coefficients of the denominator, highest power of s first: "1m 1" = 0.001·s + 1 (an RC low-pass with RC = 1 ms)' }),
    textParam('expr', 'Expression in s', '1/(1 + s*1m)', { help: 'Used when the form is "Expression in s": numbers, s, + − * / ^ (whole powers) and brackets, e.g. 1/(1+s*1m) or 1e6/(s^2 + 1e3*s + 1e6)' }),
    numParam('gain', 'Gain', '1', '', { help: 'Constant factor multiplying H(s)' }),
  ];
}

/** Controlled-source symbol with an extra caption next to the body. */
function captioned(sym: SymbolDef, caption: string): SymbolDef {
  return { ...sym, prims: [...sym.prims, text(24, -18, caption, 7, 'start')] };
}

// ---------------------------------------------------------------------------------------------
// Laplace sources

function laplaceSource(out: 'V' | 'I', ctl: 'V' | 'I'): LibraryPartDef {
  const slug = `laplace-${ctl === 'V' ? 'vc' : 'cc'}${out === 'V' ? 'vs' : 'cs'}`;
  const outEn = out === 'V' ? 'Voltage' : 'Current';
  const ctlEn = ctl === 'V' ? 'Voltage' : 'Current';
  const outVi = out === 'V' ? 'áp' : 'dòng';
  const ctlVi = ctl === 'V' ? 'áp' : 'dòng';
  const input = ctl === 'V' ? 'V(in+,in−)' : 'I(in+ → in−)';
  return withMeta(
    {
      id: `sources/${slug}`,
      name: `Laplace ${outEn} Source (${ctlEn}-Controlled)`,
      group: 'sources',
      family: 'Controlled sources',
      description: `Arbitrary Laplace function: ${out === 'V' ? 'V(out+,out−)' : 'the current leaving out+'} = H(s)·${input}, H(s) from numerator / denominator coefficients or an expression in s (exact in AC, the same DC gain H(0), integrated in transient)`,
      prefix: out === 'V' ? 'E' : 'G',
      symbol: captioned(controlledSourceSymbol(out === 'V' ? 'voltage' : 'current', ctl === 'I'), 'H(s)'),
      params: laplaceParams(),
      toSpice: (ctx) => {
        const h = laplaceFromParams(ctx);
        const els: ElementIR[] = [];
        let cp = ctx.node('in+');
        let cn = ctx.node('in-');
        if (ctl === 'I') {
          const sense = ctx.name('V', 'sense');
          const node = internalNode(ctx, 'ictl');
          els.push(elSense(sense, cp, cn), elH(ctx.name('H', 'ctl'), node, '0', sense, 1));
          cp = node;
          cn = '0';
        } else els.push(elR(ctx.name('R', 'in'), cp, cn, 1e12));
        const el = out === 'V' ? elE(ctx.name('E'), ctx.node('out+'), ctx.node('out-'), cp, cn, 1) : elG(ctx.name('G'), ctx.node('out-'), ctx.node('out+'), cp, cn, 1);
        el.laplace = h;
        els.push(el);
        return { elements: els };
      },
      provenance: 'Ideal behavioural Laplace transfer function (controllable canonical form, src/sim/devices/linear/laplace.ts)',
      keywords: ['laplace', 'transfer function', 'h(s)', 's domain', 'arbitrary', 'controlled source', 'abm'],
      virtual: true,
    },
    {
      vi: `Hàm Laplace tuỳ ý: ${out === 'V' ? 'V(out+,out−)' : 'dòng đi ra ở out+'} = H(s)·${input}; H(s) nhập bằng hệ số tử / mẫu hoặc biểu thức theo s (chính xác trong AC, cùng hệ số DC H(0), tích phân trong quá độ)`,
      nameVi: `Nguồn ${outVi} hàm Laplace (điều khiển bằng ${ctlVi})`,
    },
  );
}

// ---------------------------------------------------------------------------------------------
// controlled one-shot, current limiter, interactive DC, delay, PWM, bipolar

const ONESHOT_CARD: ModelCard = card('MS_ONESHOT', 'A_ONESHOT', {});
const HYST_CARD: ModelCard = card('MS_HYST', 'A_HYST', {});
const SAH_CARD: ModelCard = card('MS_SAH', 'A_SAH', {});
const PWM_CARD: ModelCard = card('MS_PWM', 'A_PWM', {});

const oneShot: LibraryPartDef = withMeta(
  {
    id: 'sources/controlled-one-shot',
    name: 'Controlled One-Shot',
    group: 'sources',
    family: 'Controlled sources',
    description: 'Monostable: a rising (or falling) edge on TRIG through the threshold starts one output pulse of width pw + kpw·V(CTRL) (just pw when CTRL is open), measured between the 50 % points; CLR high ends the pulse; optionally retriggerable',
    prefix: 'U',
    symbol: boxSymbol({
      w: 60,
      h: 60,
      left: [{ name: 'TRIG', number: '1', type: 'input' }, { name: 'CTRL', number: '2', type: 'input' }, { name: 'CLR', number: '3', type: 'input' }],
      right: [{ name: 'OUT', number: '4', type: 'output', label: '' }],
      extra: [poly([4, 12, 10, 12, 10, 2, 20, 2, 20, 12, 26, 12])],
      title: '1-SHOT',
      titleSize: 7,
      titlePos: { x: 6, y: -14 },
    }),
    params: [
      numParam('pw', 'Pulse width', '1m', 's', { showOnSchematic: true, min: 0, help: 'Width of the pulse when CTRL is open (or at 0 V on CTRL)' }),
      numParam('kpw', 'Width per volt of CTRL', '1m', 's/V', { help: 'Extra width for each volt on the CTRL pin: width = pw + kpw·V(CTRL)' }),
      numParam('vth', 'Trigger threshold', '2.5', 'V', { help: 'TRIG and CLR count as high above this voltage' }),
      numParam('yhigh', 'Pulse level', '5', 'V'),
      numParam('ylow', 'Idle level', '0', 'V'),
      numParam('edge', 'Edge time', '10n', 's', { min: 0, group: 'advanced', help: 'Rise and fall time of the output edges' }),
      boolParam('retrig', 'Retriggerable', false, { help: 'A trigger during the pulse starts the width again' }),
      boolParam('falling', 'Trigger on falling edge', false),
    ],
    optionalPins: ['CTRL', 'CLR'],
    toSpice: (ctx) => {
      const lo = ctx.num('ylow');
      const hi = ctx.num('yhigh');
      if (lo === hi) throw new Error('bad value for yhigh: must differ from the idle level');
      const a: ElementIR = {
        type: 'A',
        name: ctx.name('A'),
        nodes: [ctx.node('TRIG'), optNode(ctx, 'CTRL'), optNode(ctx, 'CLR'), ctx.node('OUT')],
        model: ONESHOT_CARD.name,
        params: {
          pw: ctx.num('pw'),
          kpw: ctx.num('kpw'),
          vth: ctx.num('vth'),
          ylow: lo,
          yhigh: hi,
          edge: Math.max(1e-12, ctx.num('edge')),
          retrig: boolOf(ctx, 'retrig') ? 1 : 0,
          falling: boolOf(ctx, 'falling') ? 1 : 0,
        },
      };
      return { elements: [a], models: [ONESHOT_CARD] };
    },
    provenance: 'MachSim event-driven code model A_ONESHOT (src/sim/devices/digital/analogBlocks.ts)',
    keywords: ['one-shot', 'monostable', 'pulse', 'timer', 'controlled one shot', 'monoflop'],
    virtual: true,
  },
  { vi: 'Bộ đơn ổn: một sườn lên (hoặc xuống) ở TRIG vượt ngưỡng tạo một xung ra có độ rộng pw + kpw·V(CTRL) (chỉ pw khi để hở CTRL), đo giữa hai điểm 50 %; CLR ở mức cao kết thúc xung; có thể chọn kích lại', nameVi: 'Bộ đơn ổn điều khiển được' },
);

const currentLimiter: LibraryPartDef = withMeta(
  {
    id: 'sources/current-limiter',
    name: 'Current Limiter Block',
    group: 'sources',
    family: 'Controlled sources',
    description: 'V(OUT) follows gain·V(IN) through the output resistance, but the output current is limited to +Isource (out of OUT) and −Isink (into OUT): an amplifier / supply with current limiting',
    prefix: 'U',
    symbol: boxSymbol({ w: 40, h: 40, left: [{ name: 'IN', number: '1', type: 'input' }], right: [{ name: 'OUT', number: '2', type: 'output', label: '' }], title: 'ILIM', titleSize: 7 }),
    params: [
      numParam('gain', 'Gain', '1', 'V/V', { showOnSchematic: true }),
      numParam('rout', 'Output resistance', '1', 'Ω', { min: 0, help: 'Resistance of the output while the current is below the limits' }),
      numParam('isource', 'Source current limit', '10m', 'A', { min: 0, showOnSchematic: true, help: 'Largest current the block pushes out of OUT' }),
      numParam('isink', 'Sink current limit', '10m', 'A', { min: 0, help: 'Largest current the block pulls into OUT' }),
    ],
    toSpice: (ctx) => {
      const r = pos(ctx, 'rout');
      const isrc = ctx.num('isource');
      const isnk = ctx.num('isink');
      if (!(isrc >= 0 && isnk >= 0)) throw new Error('bad value for isource: the limits must not be negative');
      const out = ctx.node('OUT');
      return {
        elements: [
          // current flowing from ground through the source into OUT
          elB(ctx.name('B'), '0', out, 'I', `limit((${ex(ctx.num('gain'))}*${inSig(ctx, 'IN')}-V(${out}))/${ex(r)},${ex(-isnk)},${ex(isrc)})`),
          elR(ctx.name('R', 'leak'), out, '0', 1e12),
        ],
      };
    },
    provenance: 'Ideal behavioural Norton stage with clamped current',
    keywords: ['current limit', 'current limiter', 'foldback', 'limiter', 'ilimit', 'control function'],
    virtual: true,
  },
  { vi: 'V(OUT) bám theo gain·V(IN) qua điện trở ra, nhưng dòng ra bị giới hạn ở +Isource (đi ra khỏi OUT) và −Isink (đi vào OUT): mô hình bộ khuếch đại / nguồn có hạn dòng', nameVi: 'Khối hạn dòng' },
);

function interactiveDc(kind: 'V' | 'I'): LibraryPartDef {
  const isV = kind === 'V';
  const u = isV ? 'V' : 'A';
  const params: ParamDef[] = [
    numParam('value', isV ? 'Voltage' : 'Current', isV ? '5' : '1m', u, { showOnSchematic: true, help: `Present value; the key (Shift+key lowers it) or the slider changes it in steps while the simulation runs` }),
    numParam('step', 'Increment', isV ? '0.5' : '0.5m', u, { min: 0, help: 'Change per key press or slider step' }),
    numParam('vmin', 'Minimum', '0', u, { help: 'Lowest value the key / slider reaches' }),
    numParam('vmax', 'Maximum', isV ? '12' : '10m', u, { help: 'Highest value the key / slider reaches' }),
    textParam('key', 'Key', isV ? 'U' : 'J', { help: "Keyboard key that operates the part during simulation ('Space' or a single character)" }),
  ];
  return withMeta(
    {
      id: `sources/dc-interactive-${isV ? 'voltage' : 'current'}`,
      name: `DC Interactive ${isV ? 'Voltage' : 'Current'} Source`,
      group: 'sources',
      family: isV ? 'Voltage sources' : 'Current sources',
      description: `DC ${isV ? 'voltage' : 'current'} source you turn up and down while the interactive simulation runs: the key raises it by the increment, Shift+key lowers it, the slider in Properties sets it, always between the minimum and maximum${isV ? '' : '; the current leaves through +'}`,
      prefix: kind,
      symbol: sourceSymbol(isV ? 'dc' : 'current', { extra: [line(-16, 16, 16, -16), poly([16, -16, 9, -14, 14, -9], true, true)] }),
      params,
      interactive: { kind: 'slider', param: 'value', label: isV ? 'Voltage' : 'Current', key: isV ? 'U' : 'J', step: isV ? 0.5 : 0.5e-3, stepParam: 'step', minParam: 'vmin', maxParam: 'vmax' },
      toSpice: (ctx) => ({
        elements: [isV ? elV(ctx.name('V'), ctx.node('+'), ctx.node('-'), { dc: ctx.num('value') }) : elI(ctx.name('I'), ctx.node('-'), ctx.node('+'), { dc: ctx.num('value') })],
      }),
      keywords: ['interactive', 'adjustable', 'variable', 'dc', 'supply', 'knob', isV ? 'voltage' : 'current'],
      virtual: true,
    },
    {
      vi: `Nguồn ${isV ? 'áp' : 'dòng'} một chiều chỉnh được khi đang mô phỏng tương tác: phím tắt tăng một bước, Shift+phím giảm, thanh trượt trong Thuộc tính đặt giá trị, luôn nằm giữa giá trị nhỏ nhất và lớn nhất${isV ? '' : '; dòng đi ra ở cực +'}`,
      nameVi: `Nguồn ${isV ? 'áp' : 'dòng'} DC tương tác`,
    },
  );
}

const delay: LibraryPartDef = withMeta(
  {
    id: 'sources/delay',
    name: 'Time Delay',
    group: 'sources',
    family: 'Controlled sources',
    description: 'Pure time delay: V(out+,out−) at time t equals V(in+,in−) at t − td (gain 1, every frequency delayed by td: phase −360°·f·td)',
    prefix: 'U',
    symbol: captioned(controlledSourceSymbol('voltage', false), 'e^-sT'),
    params: [numParam('td', 'Time delay', '1m', 's', { showOnSchematic: true, min: 0, help: 'Delay between input and output (the time step is limited to it, so keep it not too small compared with the simulated time)' })],
    toSpice: (ctx) => {
      const td = pos(ctx, 'td');
      const a = internalNode(ctx, 'a');
      const b = internalNode(ctx, 'b');
      const c = internalNode(ctx, 'c');
      return {
        elements: [
          // a matched 1 Ω lossless line: V(b) = V(in), V(c)(t) = V(b)(t − td)
          elE(ctx.name('E', 'drv'), a, '0', ctx.node('in+'), ctx.node('in-'), 2),
          elR(ctx.name('R', 'src'), a, b, 1),
          elT(ctx.name('T'), b, '0', c, '0', 1, td),
          elR(ctx.name('R', 'load'), c, '0', 1),
          elE(ctx.name('E'), ctx.node('out+'), ctx.node('out-'), c, '0', 1),
          elR(ctx.name('R', 'in'), ctx.node('in+'), ctx.node('in-'), 1e12),
        ],
      };
    },
    provenance: 'Matched lossless transmission line (exact delay)',
    keywords: ['delay', 'time delay', 'dead time', 'transport delay', 'e^-st', 'control function'],
    virtual: true,
  },
  { vi: 'Khâu trễ thuần tuý: V(out+,out−) tại thời điểm t bằng V(in+,in−) tại t − td (độ lợi 1, mọi tần số trễ td: pha −360°·f·td)', nameVi: 'Khâu trễ thời gian' },
);

const pwmSource: LibraryPartDef = withMeta(
  {
    id: 'sources/pwm-voltage',
    name: 'PWM Voltage Source',
    group: 'sources',
    family: 'Voltage sources',
    description: 'Pulse-width-modulated pulse train: every period starts at the high level and goes low after duty·T; with a modulation depth the duty follows duty + (depth/2)·sin(2π·fm·t) (sampled at the start of each period)',
    prefix: 'V',
    symbol: sourceSymbol('pulse', { extra: [text(0, 26, 'PWM', 6)] }),
    params: [
      numParam('freq', 'Frequency', '1k', 'Hz', { showOnSchematic: true, min: 0 }),
      numParam('duty', 'Duty cycle', '50', '%', { showOnSchematic: true, min: 0, max: 100 }),
      numParam('high', 'High level', '5', 'V'),
      numParam('low', 'Low level', '0', 'V'),
      numParam('depth', 'Modulation depth', '0', '%', { min: 0, max: 200, group: 'waveform', help: 'Peak-to-peak change of the duty cycle (0 = fixed duty)' }),
      numParam('fmod', 'Modulation frequency', '50', 'Hz', { min: 0, group: 'waveform' }),
      numParam('edge', 'Edge time', '10n', 's', { min: 0, group: 'advanced' }),
    ],
    toSpice: (ctx) => {
      const lo = ctx.num('low');
      const hi = ctx.num('high');
      if (lo === hi) throw new Error('bad value for high: must differ from the low level');
      // the duty cycle as a voltage (0…1 V): duty + (depth/2)·sin(2π·fm·t), sampled by A_PWM at
      // the start of every period
      const d = internalNode(ctx, 'duty');
      const duty = ctx.num('duty') / 100;
      const depth = ctx.num('depth') / 100;
      const fm = ctx.num('fmod');
      const mod: ElementIR = elV(ctx.name('V', 'duty'), d, '0', depth > 0 && fm > 0 ? { dc: duty, tran: { type: 'SIN', args: [duty, depth / 2, fm] } } : { dc: duty });
      const a: ElementIR = {
        type: 'A',
        name: ctx.name('A'),
        nodes: [d, ctx.node('+'), ctx.node('-')],
        model: PWM_CARD.name,
        params: { pwr: 1, freq: pos(ctx, 'freq'), vmin: 0, vmax: 1, ylow: lo, yhigh: hi, edge: Math.max(1e-12, ctx.num('edge')) },
      };
      return { elements: [mod, a], models: [PWM_CARD] };
    },
    provenance: 'MachSim event-driven code model A_PWM (exact edges)',
    keywords: ['pwm', 'pulse width modulation', 'duty cycle', 'pulse', 'motor control'],
    virtual: true,
  },
  { vi: 'Chuỗi xung điều chế độ rộng: mỗi chu kỳ bắt đầu ở mức cao và xuống mức thấp sau duty·T; khi có độ sâu điều chế, hệ số làm việc thay đổi theo duty + (độ sâu/2)·sin(2π·fm·t) (lấy mẫu ở đầu mỗi chu kỳ)', nameVi: 'Nguồn áp PWM' },
);

const bipolar: LibraryPartDef = withMeta(
  {
    id: 'sources/bipolar-voltage',
    name: 'Bipolar Voltage Source',
    group: 'sources',
    family: 'Voltage sources',
    description: 'Bipolar pulse train: +A for half a period minus the gap, 0 V during the gap, −A, 0 V again; gap 0 gives a symmetric ±A square wave',
    prefix: 'V',
    symbol: sourceSymbol('pulse', { extra: [text(0, 26, '±', 8)] }),
    params: [
      numParam('amplitude', 'Amplitude (peak)', '5', 'V', { showOnSchematic: true, min: 0 }),
      numParam('freq', 'Frequency', '1k', 'Hz', { showOnSchematic: true, min: 0 }),
      numParam('gap', 'Gap at 0 V', '0', 's', { min: 0, group: 'waveform', help: 'Time at 0 V after each pulse (must be shorter than half a period)' }),
      numParam('edge', 'Edge time', '1n', 's', { min: 0, group: 'advanced' }),
    ],
    toSpice: (ctx) => {
      const a = ctx.num('amplitude');
      const T = 1 / pos(ctx, 'freq');
      const gap = Math.max(0, ctx.num('gap'));
      const tr = Math.max(1e-12, Math.min(ctx.num('edge'), T / 20));
      if (!(gap < T / 2 - 2 * tr)) throw new Error('bad value for gap: must be shorter than half a period');
      const h = T / 2;
      const pts =
        gap > 0
          ? [0, 0, tr, a, h - gap - tr, a, h - gap, 0, h, 0, h + tr, -a, T - gap - tr, -a, T - gap, 0, T, 0]
          : [0, 0, tr / 2, a, h - tr / 2, a, h + tr / 2, -a, T - tr / 2, -a, T, 0];
      return { elements: [elV(ctx.name('V'), ctx.node('+'), ctx.node('-'), { dc: 0, tran: wPwl(pts, true) })] };
    },
    keywords: ['bipolar', 'square', 'ami', 'pulse', 'plus minus', 'alternating'],
    virtual: true,
  },
  { vi: 'Chuỗi xung lưỡng cực: +A trong nửa chu kỳ trừ khoảng nghỉ, 0 V trong khoảng nghỉ, rồi −A, rồi 0 V; khoảng nghỉ 0 cho sóng vuông đối xứng ±A', nameVi: 'Nguồn áp lưỡng cực' },
);

// ---------------------------------------------------------------------------------------------
// reference grounds

/** Global net name of reference ground n. */
export const referenceGroundNet = (n: number): string => `GNDREF${n}`;

/** Element name of the tie resistor of reference ground n. */
export const referenceTieName = (n: number): string => `R_GNDREF${n}_tie`;

/** Value of the tie resistor between a reference ground and the main ground. */
export const REFERENCE_TIE_OHMS = 1e9;

function refGroundSymbol(n: number): SymbolDef {
  return makeSymbol(
    [line(0, 0, 0, 10), poly([-12, 10, 12, 10, 0, 22], true), text(16, 20, String(n), 9, 'start', true)],
    [pin('1', 0, 0, 'up', { type: 'power' })],
    { refPos: { x: 16, y: 6 }, valuePos: { x: 26, y: 20 } },
  );
}

const referenceGrounds: LibraryPartDef[] = [1, 2, 3, 4, 5].map((n) =>
  withMeta(
    {
      id: `sources/ground-ref${n}`,
      name: `Reference Ground ${n}`,
      group: 'sources',
      family: 'Power',
      description: `Separate reference ground ${n} (net GNDREF${n}): the 0 V point of an isolated part of the circuit (transformer or optocoupler secondary, floating measurement). It is not the main ground: it joins it only through 1 GΩ, probes on that part read against it, and ERC warns when the part is not really isolated`,
      prefix: 'GND',
      globalNet: referenceGroundNet(n),
      symbol: refGroundSymbol(n),
      params: [],
      toSpice: (ctx) => ({ elements: [elR(referenceTieName(n), ctx.node('1'), '0', REFERENCE_TIE_OHMS)] }),
      keywords: ['ground', 'reference', 'gnd', 'isolated', 'floating', `ref${n}`, 'earth', 'dat'],
      virtual: true,
    },
    {
      vi: `Đất tham chiếu riêng số ${n} (net GNDREF${n}): điểm 0 V của một phần mạch cách ly (cuộn thứ cấp biến áp, phía ra của optocoupler, phép đo thả nổi). Đây không phải Đất chính: nó chỉ nối với Đất chính qua 1 GΩ, đầu dò trên phần mạch đó đo so với nó, và ERC cảnh báo khi phần mạch không thật sự cách ly`,
      nameVi: `Đất tham chiếu ${n}`,
    },
  ),
);

// ---------------------------------------------------------------------------------------------
// voltage-controlled sawtooth

const vcSawtooth: LibraryPartDef = withMeta(
  {
    id: 'sources/vc-sawtooth',
    name: 'Voltage-Controlled Sawtooth',
    group: 'sources',
    family: 'Controlled sources',
    description: 'Voltage-controlled sawtooth oscillator: f = f0 + k·V(in+,in−), phase-continuous; output V(out+,out−) = offset + amplitude·ramp from −1 to +1, then a fast return (1 % of the period)',
    prefix: 'V',
    symbol: controlledSourceSymbol('voltage', false),
    params: [
      numParam('f0', 'Frequency at zero control', '1k', 'Hz', { group: 'waveform', min: 0, showOnSchematic: true }),
      numParam('kf', 'Frequency per volt', '1k', 'Hz/V', { group: 'waveform' }),
      numParam('va', 'Amplitude', '1', 'V', { group: 'waveform' }),
      numParam('vo', 'Offset', '0', 'V', { group: 'waveform' }),
    ],
    toSpice: (ctx) => {
      const ph = internalNode(ctx, 'ph');
      return {
        elements: [
          elB(ctx.name('B', 'ph'), '0', ph, 'I', `max(${ex(ctx.num('f0'))}+${ex(ctx.num('kf'))}*V(${ctx.node('in+')},${ctx.node('in-')}),0)*u(time)`),
          elC(ctx.name('C', 'ph'), ph, '0', 1),
          elR(ctx.name('R', 'ph'), ph, '0', 1e12),
          elB(ctx.name('B'), ctx.node('out+'), ctx.node('out-'), 'V', `${ex(ctx.num('vo'))}+${ex(ctx.num('va'))}*${sawtoothOf(`V(${ph})`)}`),
          elR(ctx.name('R', 'in'), ctx.node('in+'), ctx.node('in-'), 1e9),
        ],
      };
    },
    keywords: ['vco', 'sawtooth', 'ramp', 'controlled oscillator', 'voltage controlled'],
    virtual: true,
  },
  { vi: 'Bộ dao động răng cưa điều khiển bằng điện áp: f = f0 + k·V(in+,in−), liên tục pha; ngõ ra V(out+,out−) = độ lệch + biên độ·dốc từ −1 lên +1 rồi trở về nhanh (1 % chu kỳ)', nameVi: 'Nguồn răng cưa điều khiển bằng áp' },
);

// ---------------------------------------------------------------------------------------------
// control-function blocks

function controlBlock(
  slug: string,
  name: string,
  nameVi: string,
  en: string,
  vi: string,
  symbol: SymbolDef,
  params: ParamDef[],
  build: (ctx: ToSpiceContext) => { elements: ElementIR[]; models?: ModelCard[] },
  keywords: string[],
  optionalPins: string[] = [],
  provenance = 'Ideal behavioral function block',
): LibraryPartDef {
  return withMeta(
    {
      id: `analog/${slug}`,
      name,
      group: 'analog',
      family: 'Control functions',
      description: en,
      prefix: 'A',
      symbol,
      params,
      optionalPins,
      toSpice: build,
      provenance,
      keywords: ['control function', 'block', ...keywords],
      virtual: true,
    },
    { vi, nameVi },
  );
}

const singleBlock = (title: string, titleSize = 10): SymbolDef =>
  boxSymbol({ w: 40, h: 40, left: [{ name: 'IN', type: 'input' }], right: [{ name: 'OUT', label: '', type: 'output' }], title, titleSize });

const summer2 = controlBlock(
  'summer-2',
  'Summer (2 Inputs)',
  'Bộ cộng 2 ngõ vào',
  'V(OUT) = ka·V(A) + kb·V(B) + offset (an unconnected input counts as 0 V)',
  'V(OUT) = ka·V(A) + kb·V(B) + độ lệch (ngõ vào để hở được tính là 0 V)',
  boxSymbol({ w: 60, h: 40, left: [{ name: 'A', type: 'input' }, { name: 'B', type: 'input' }], right: [{ name: 'OUT', label: '', type: 'output' }], title: 'Σ' }),
  [numParam('ka', 'Gain A', '1', ''), numParam('kb', 'Gain B', '1', ''), numParam('offset', 'Offset', '0', 'V')],
  (ctx) => ({ elements: [elB(ctx.name('B'), ctx.node('OUT'), '0', 'V', `${ex(ctx.num('ka'))}*${inSig(ctx, 'A')}+${ex(ctx.num('kb'))}*${inSig(ctx, 'B')}+${ex(ctx.num('offset'))}`)] }),
  ['summer', 'adder', 'sum', 'two input'],
  ['A', 'B'],
);

/**
 * Integrator state: 1 nF charged by k·C·V(IN); the clamp and reset paths are 1 S (τ = 1 ns), so
 * a limit is exceeded by only k·V(IN)·1e-9 V.
 */
const INT_C = 1e-9;
const INT_G = 1;

const integratorReset = controlBlock(
  'integrator-reset',
  'Integrator (Reset, Limits)',
  'Bộ tích phân (có reset, giới hạn)',
  'V(OUT) = initial value + k·∫V(IN)dt, starting at the initial value at t = 0; while V(RST) is above the reset threshold the output is held at the initial value; with limits the output stays between them and the integral does not wind up',
  'V(OUT) = giá trị đầu + k·∫V(IN)dt, bắt đầu từ giá trị đầu tại t = 0; khi V(RST) lớn hơn ngưỡng reset, ngõ ra bị giữ ở giá trị đầu; khi có giới hạn, ngõ ra nằm giữa hai giới hạn và tích phân không bị bão hoà (chống windup)',
  boxSymbol({ w: 40, h: 40, left: [{ name: 'IN', type: 'input' }, { name: 'RST', type: 'input', label: 'R' }], right: [{ name: 'OUT', label: '', type: 'output' }], title: '∫', titleSize: 12 }),
  [
    numParam('k', 'Gain', '1', '1/s', { showOnSchematic: true }),
    numParam('ic', 'Initial output', '0', 'V'),
    numParam('high', 'Upper limit', '', 'V', { help: 'Blank = no upper limit' }),
    numParam('low', 'Lower limit', '', 'V', { help: 'Blank = no lower limit' }),
    numParam('vreset', 'Reset threshold', '2.5', 'V', { help: 'The output is reset while V(RST) is above this voltage' }),
  ],
  (ctx) => {
    const k = ctx.num('k');
    const ic = ctx.num('ic');
    const hi = optNum(ctx, 'high');
    const lo = optNum(ctx, 'low');
    if (hi !== undefined && lo !== undefined && !(hi > lo)) throw new Error('bad value for high: must exceed the lower limit');
    if (hi !== undefined && ic > hi) throw new Error('bad value for ic: the initial output is above the upper limit');
    if (lo !== undefined && ic < lo) throw new Error('bad value for ic: the initial output is below the lower limit');
    const n = internalNode(ctx, 'int');
    // reset gate (1 while V(RST) is above the threshold): it stops the integration and pulls the
    // state to ic; the integration current k·C·V(IN) is also off in the operating point, which
    // holds the state at ic
    const gate = pinConnected(ctx, 'RST') ? `(0.5+0.5*tanh(50*(V(${ctx.node('RST')})-${ex(ctx.num('vreset'))})))` : undefined;
    const parts = [`${ex(k * INT_C)}*${inSig(ctx, 'IN')}*u(time)${gate ? `*(1-${gate})` : ''}`, `${ex(1e-3)}*(${ex(ic)}-V(${n}))*(1-u(time))`];
    if (hi !== undefined) parts.push(`${ex(-INT_G)}*max(V(${n})-${ex(hi)},0)`);
    if (lo !== undefined) parts.push(`${ex(-INT_G)}*min(V(${n})-${ex(lo)},0)`);
    if (gate) parts.push(`${ex(INT_G)}*(${ex(ic)}-V(${n}))*${gate}`);
    const outExpr = hi !== undefined || lo !== undefined ? `limit(V(${n}),${ex(lo ?? -1e30)},${ex(hi ?? 1e30)})` : `V(${n})`;
    return {
      elements: [
        elB(ctx.name('B', 'i'), '0', n, 'I', parts.join('+')),
        elC(ctx.name('C'), n, '0', INT_C, { ic }),
        elR(ctx.name('R', 'leak'), n, '0', 1e12),
        elB(ctx.name('B'), ctx.node('OUT'), '0', 'V', outExpr),
      ],
    };
  },
  ['integrator', 'integral', 'reset', 'anti-windup', 'limits', 'clamp'],
  ['RST'],
);

const hysteresis = controlBlock(
  'hysteresis',
  'Hysteresis Block (Schmitt)',
  'Khối trễ (Schmitt)',
  'Schmitt transfer: OUT goes to the high level when V(IN) rises above the upper threshold and to the low level when it falls below the lower threshold; between them it keeps its level (the hysteresis loop)',
  'Đặc tuyến Schmitt: OUT lên mức cao khi V(IN) tăng vượt ngưỡng trên và xuống mức thấp khi V(IN) giảm dưới ngưỡng dưới; ở giữa hai ngưỡng ngõ ra giữ mức cũ (vòng trễ)',
  boxSymbol({
    w: 40,
    h: 40,
    left: [{ name: 'IN', type: 'input' }],
    right: [{ name: 'OUT', label: '', type: 'output' }],
    extra: [poly([-12, 8, 2, 8, 2, -8, 12, -8]), poly([-12, 8, -2, 8, -2, -8, 12, -8])],
  }),
  [
    numParam('vlow', 'Lower threshold', '1', 'V', { showOnSchematic: true }),
    numParam('vhigh', 'Upper threshold', '2', 'V', { showOnSchematic: true }),
    numParam('ylow', 'Low output level', '0', 'V'),
    numParam('yhigh', 'High output level', '5', 'V'),
    numParam('edge', 'Edge time', '10n', 's', { min: 0, group: 'advanced' }),
    boolParam('init', 'Start high', false, { group: 'advanced', help: 'Level at the start while the input lies between the thresholds' }),
  ],
  (ctx) => {
    const vl = ctx.num('vlow');
    const vh = ctx.num('vhigh');
    if (!(vh >= vl)) throw new Error('bad value for vhigh: the upper threshold must not be below the lower one');
    if (ctx.num('ylow') === ctx.num('yhigh')) throw new Error('bad value for yhigh: the two output levels must differ');
    const a: ElementIR = {
      type: 'A',
      name: ctx.name('A'),
      nodes: [ctx.node('IN'), ctx.node('OUT')],
      model: HYST_CARD.name,
      params: { vlow: vl, vhigh: vh, ylow: ctx.num('ylow'), yhigh: ctx.num('yhigh'), edge: Math.max(1e-12, ctx.num('edge')), init: boolOf(ctx, 'init') ? 1 : 0 },
    };
    return { elements: [a], models: [HYST_CARD] };
  },
  ['hysteresis', 'schmitt', 'comparator', 'backlash', 'relay'],
  [],
  'MachSim event-driven code model A_HYST (src/sim/devices/digital/analogBlocks.ts)',
);

/** Tracking time constant of the slew-rate limiter (its small-signal bandwidth is 1/(2πτ)). */
const SLEW_TAU = 1e-7;

const slewLimiter = controlBlock(
  'slew-limiter',
  'Slew-Rate Limiter',
  'Bộ hạn tốc độ biến thiên',
  'OUT follows IN, but changes at most at the rising rate upwards and the falling rate downwards (V/s); small slow signals pass unchanged (tracking bandwidth about 1.6 MHz)',
  'OUT bám theo IN nhưng thay đổi không nhanh hơn tốc độ tăng khi đi lên và tốc độ giảm khi đi xuống (V/s); tín hiệu nhỏ, chậm đi qua không đổi (dải thông bám khoảng 1.6 MHz)',
  singleBlock('dV/dt', 8),
  [
    numParam('rise', 'Rising slew rate', '1meg', 'V/s', { showOnSchematic: true, min: 0, help: 'Largest rate of rise of the output (1meg V/s = 1 V/µs)' }),
    numParam('fall', 'Falling slew rate', '1meg', 'V/s', { min: 0, help: 'Largest rate of fall of the output' }),
  ],
  (ctx) => {
    const sr = pos(ctx, 'rise');
    const sf = pos(ctx, 'fall');
    const y = internalNode(ctx, 'y');
    const c = 1e-6;
    return {
      elements: [
        elB(ctx.name('B', 'y'), '0', y, 'I', `${ex(c)}*limit((${inSig(ctx, 'IN')}-V(${y}))/${ex(SLEW_TAU)},${ex(-sf)},${ex(sr)})`),
        elC(ctx.name('C'), y, '0', c),
        elR(ctx.name('R', 'leak'), y, '0', 1e12),
        elE(ctx.name('E'), ctx.node('OUT'), '0', y, '0', 1),
      ],
    };
  },
  ['slew rate', 'slew', 'rate limiter', 'ramp limiter'],
);

const transferFunction = controlBlock(
  'transfer-function',
  'Transfer Function Block',
  'Khối hàm truyền',
  'V(OUT) = H(s)·V(IN) with H(s) from numerator / denominator coefficients (highest power of s first) or an expression in s: exact in AC, the same DC gain H(0), integrated in transient',
  'V(OUT) = H(s)·V(IN) với H(s) nhập bằng hệ số tử / mẫu (bậc cao nhất của s trước) hoặc biểu thức theo s: chính xác trong AC, cùng hệ số DC H(0), tích phân trong quá độ',
  singleBlock('H(s)', 8),
  laplaceParams(),
  (ctx) => {
    const e = elE(ctx.name('E'), ctx.node('OUT'), '0', ctx.node('IN'), '0', 1);
    e.laplace = laplaceFromParams(ctx);
    return { elements: [e, elR(ctx.name('R', 'in'), ctx.node('IN'), '0', 1e12)] };
  },
  ['transfer function', 'laplace', 'h(s)', 's domain', 'filter', 'plant'],
);

const sampleHold = controlBlock(
  'sample-hold',
  'Sample and Hold',
  'Bộ lấy mẫu và giữ',
  'Edge mode: at every rising CLK edge OUT takes the value of IN and holds it until the next edge (a staircase). Track mode: OUT follows IN while CLK is high and holds the last value while CLK is low',
  'Chế độ sườn: ở mỗi sườn lên của CLK, OUT lấy giá trị của IN và giữ đến sườn sau (dạng bậc thang). Chế độ bám: OUT bám theo IN khi CLK ở mức cao và giữ giá trị cuối khi CLK ở mức thấp',
  boxSymbol({ w: 60, h: 40, left: [{ name: 'IN', type: 'input' }, { name: 'CLK', type: 'input' }], right: [{ name: 'OUT', label: '', type: 'output' }], title: 'S/H', titleSize: 9 }),
  [
    selectParam('mode', 'Mode', 'edge', [
      ['edge', 'Sample at the clock edge'],
      ['track', 'Track while the clock is high'],
    ]),
    numParam('vth', 'Clock threshold', '2.5', 'V'),
    boolParam('falling', 'Sample on falling edge', false, { help: 'Edge mode: sample at the falling instead of the rising clock edge' }),
  ],
  (ctx) => {
    const vth = ctx.num('vth');
    const mode = textOf(ctx, 'mode', 'edge').trim().toLowerCase();
    if (mode === 'track') {
      const a = internalNode(ctx, 'a');
      const h = internalNode(ctx, 'h');
      const model = swModel(`MS_SAH_SW_${String(vth).replace(/[^0-9a-zA-Z]/g, '_')}`, vth, 0.01, 1, 1e12);
      return {
        elements: [
          elE(ctx.name('E', 'in'), a, '0', ctx.node('IN'), '0', 1),
          elS(ctx.name('S'), a, h, ctx.node('CLK'), '0', model.name),
          elC(ctx.name('C'), h, '0', 1e-9),
          elE(ctx.name('E'), ctx.node('OUT'), '0', h, '0', 1),
          elR(ctx.name('R', 'in'), ctx.node('IN'), '0', 1e12),
          elR(ctx.name('R', 'clk'), ctx.node('CLK'), '0', 1e12),
        ],
        models: [model],
      };
    }
    const el: ElementIR = {
      type: 'A',
      name: ctx.name('A'),
      nodes: [ctx.node('IN'), ctx.node('CLK'), ctx.node('OUT')],
      model: SAH_CARD.name,
      params: { vth, falling: boolOf(ctx, 'falling') ? 1 : 0, edge: 1e-9 },
    };
    return { elements: [el], models: [SAH_CARD] };
  },
  ['sample and hold', 'sample hold', 'track and hold', 's/h', 'zero order hold', 'sampler'],
  [],
  'Edge mode: MachSim code model A_SAH; track mode: ideal switch (1 Ω / 1 TΩ) and 1 nF hold capacitor',
);

const pwmModulator = controlBlock(
  'pwm-modulator',
  'PWM Modulator',
  'Bộ điều chế PWM',
  'Regular-sampled PWM: every period at the set frequency OUT starts high and goes low after D·T, D = (V(IN) − Vmin)/(Vmax − Vmin) clamped to 0…100 %, sampled at the start of the period (exact pulse widths)',
  'PWM lấy mẫu đều: ở mỗi chu kỳ của tần số đã đặt, OUT bắt đầu ở mức cao và xuống mức thấp sau D·T, với D = (V(IN) − Vmin)/(Vmax − Vmin) giới hạn trong 0…100 %, lấy mẫu ở đầu chu kỳ (độ rộng xung chính xác)',
  singleBlock('PWM', 8),
  [
    numParam('freq', 'Switching frequency', '10k', 'Hz', { showOnSchematic: true, min: 0 }),
    numParam('vmin', 'Input for 0 % duty', '0', 'V'),
    numParam('vmax', 'Input for 100 % duty', '5', 'V'),
    numParam('yhigh', 'High output level', '5', 'V'),
    numParam('ylow', 'Low output level', '0', 'V'),
    numParam('edge', 'Edge time', '10n', 's', { min: 0, group: 'advanced' }),
  ],
  (ctx) => {
    const vmin = ctx.num('vmin');
    const vmax = ctx.num('vmax');
    if (!(vmax > vmin)) throw new Error('bad value for vmax: must be above the 0 % input');
    if (ctx.num('ylow') === ctx.num('yhigh')) throw new Error('bad value for yhigh: the two output levels must differ');
    const el: ElementIR = {
      type: 'A',
      name: ctx.name('A'),
      nodes: [ctx.node('IN'), ctx.node('OUT')],
      model: PWM_CARD.name,
      params: { freq: pos(ctx, 'freq'), vmin, vmax, ylow: ctx.num('ylow'), yhigh: ctx.num('yhigh'), edge: Math.max(1e-12, ctx.num('edge')) },
    };
    return { elements: [el], models: [PWM_CARD] };
  },
  ['pwm', 'modulator', 'pulse width', 'duty cycle', 'class d'],
  [],
  'MachSim event-driven code model A_PWM (src/sim/devices/digital/analogBlocks.ts)',
);

export const SIGNAL_BLOCK_CATALOG: LibraryPartDef[] = [
  laplaceSource('V', 'V'),
  laplaceSource('I', 'V'),
  laplaceSource('V', 'I'),
  laplaceSource('I', 'I'),
  oneShot,
  currentLimiter,
  interactiveDc('V'),
  interactiveDc('I'),
  delay,
  pwmSource,
  bipolar,
  ...referenceGrounds,
  vcSawtooth,
  summer2,
  integratorReset,
  hysteresis,
  slewLimiter,
  transferFunction,
  sampleHold,
  pwmModulator,
];

