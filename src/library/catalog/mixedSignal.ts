/**
 * Mixed-signal catalogue: ideal parallel ADCs / DACs of several resolutions, SPI-style serial
 * ADCs / DACs, the classic microprocessor converters ADC0804 / ADC0809 and the DAC0808 current
 * DAC, logic-controlled analog switches and a voltage-controlled oscillator with a logic output.
 *
 * Converters are ideal (exact binary weights, no INL / DNL); the classic parts keep their public
 * pinouts and timing (ADC0804 / ADC0809 ≈ 100 µs conversion at the usual 640 kHz clock, rounded
 * to the nearest code). DAC0808: the reference current I = V(VREF) / R14 flows into VREF+ (held at
 * the VREF- potential) and the output IO sinks I · code / 256, as in the datasheet application
 * circuit with an op-amp current-to-voltage converter. Clock, compensation and supply pins of the
 * real parts are drawn for wiring and are not simulated.
 */
import { elB, elR, elS, elV, internalNode, numParam, swModel, type LibraryPartDef } from '../partkit';
import type { ParamDef, ToSpiceContext } from '../types';
import { aElement, familyModel, icSymbol, idealLevels, optionalNode, powerNodes, powerParams, type IcPin, type PowerNodes } from '../parts/digital/kit';
import { names, side } from './logicKit';
import { withMeta } from './kit';

const GROUND_REF: PowerNodes = { nodes: ['0'], pwr: 1 };
const vhigh = (): ParamDef => numParam('vhigh', 'Logic high level', '5', 'V', { min: 0.1, group: 'model' });
const threshold = (): ParamDef => numParam('threshold', 'Logic input threshold', '2.5', 'V', { group: 'model' });

function logicLevels(ctx: ToSpiceContext, delay: number) {
  const vh = ctx.num('vhigh');
  if (!(vh > 0)) throw new Error('bad value for vhigh: must be > 0');
  return idealLevels(vh, delay, ctx.params.threshold !== undefined ? ctx.num('threshold') : vh / 2);
}

const analogPin = (name: string, label = name): IcPin => ({ name, label, type: 'passive' });

function adcParallel(n: number): LibraryPartDef {
  const bits = names('D', n);
  return withMeta(
    {
      id: `mixed/adc${n}`,
      name: `ADC ${n}-bit`,
      group: 'mixed',
      family: 'Converters',
      description: `Ideal ${n}-bit analog-to-digital converter: code = floor(2^${n} (VIN - VREF-) / (VREF+ - VREF-)); a rising SOC starts a conversion (EOC low for tconv), an unconnected SOC converts continuously; OE (open = enabled) tri-states the outputs`,
      prefix: 'U',
      symbol: icSymbol('ADC', [analogPin('VIN'), analogPin('VREFP', 'VREF+'), analogPin('VREFN', 'VREF-'), null, { name: 'SOC', type: 'input' }, { name: 'OE', type: 'input' }], [...bits.map((b) => ({ name: b, type: 'output' as const })), null, { name: 'EOC', type: 'output' }]),
      params: [numParam('tconv', 'Conversion time', '1u', 's', { min: 0, showOnSchematic: true }), vhigh(), threshold()],
      optionalPins: ['SOC', 'OE', 'EOC', ...bits],
      toSpice: (ctx) => {
        const m = familyModel(`MS_ADC${n}`, 'D_ADC', logicLevels(ctx, 10e-9), 1, { tconv: ctx.num('tconv') });
        const ports = [ctx.node('VIN'), ctx.node('VREFP'), ctx.node('VREFN'), optionalNode(ctx, 'SOC'), optionalNode(ctx, 'OE'), ctx.node('EOC'), ...bits.map((b) => ctx.node(b))];
        return { elements: [aElement(ctx.name('A'), ports, GROUND_REF, m.name)], models: [m] };
      },
      keywords: ['adc', 'analog to digital', 'converter', `${n}-bit`],
      provenance: 'MachSim ideal converter code model (D_ADC): truncating quantiser, no INL / DNL',
    },
    { vi: `Bộ chuyển đổi tương tự - số ${n} bit lý tưởng: mã = floor(2^${n} (VIN - VREF-) / (VREF+ - VREF-)); sườn lên SOC bắt đầu chuyển đổi (EOC thấp trong tconv), để trống SOC thì chuyển đổi liên tục; OE (để trống = cho phép) thả nổi ngõ ra`, nameVi: `ADC ${n} bit`, specs: { bits: n }, sortKey: n, series: 'Ideal ADC' },
  );
}

function dacParallel(n: number): LibraryPartDef {
  const bits = names('D', n);
  return withMeta(
    {
      id: `mixed/dac${n}`,
      name: `DAC ${n}-bit`,
      group: 'mixed',
      family: 'Converters',
      description: `Ideal ${n}-bit voltage-output DAC: VOUT = VREF- + code / 2^${n} (VREF+ - VREF-), settling ramp tsettle, output resistance rout`,
      prefix: 'U',
      symbol: icSymbol('DAC', [...bits.map((b) => ({ name: b, type: 'input' as const })), null, analogPin('VREFP', 'VREF+'), analogPin('VREFN', 'VREF-')], [null, null, null, { name: 'VOUT', type: 'output' }]),
      params: [numParam('tsettle', 'Full-scale settling time', '100n', 's', { min: 1e-12, showOnSchematic: true }), numParam('rout', 'Output resistance', '1', 'Ω', { min: 1e-6 }), threshold()],
      toSpice: (ctx) => {
        const m = familyModel(`MS_DAC${n}`, 'D_DAC', idealLevels(5, 0, ctx.num('threshold')), 1, { tsettle: ctx.num('tsettle'), rout: ctx.num('rout'), tpd: 10e-9 });
        const ports = [...bits.map((b) => ctx.node(b)), ctx.node('VREFP'), ctx.node('VREFN'), ctx.node('VOUT')];
        return { elements: [aElement(ctx.name('A'), ports, GROUND_REF, m.name)], models: [m] };
      },
      keywords: ['dac', 'digital to analog', 'converter', `${n}-bit`],
      provenance: 'MachSim ideal converter code model (D_DAC): exact binary weights, linear settling ramp',
    },
    { vi: `Bộ chuyển đổi số - tương tự ${n} bit lý tưởng, ngõ ra áp: VOUT = VREF- + mã / 2^${n} (VREF+ - VREF-), có thời gian xác lập tsettle và trở ra rout`, nameVi: `DAC ${n} bit`, specs: { bits: n }, sortKey: n, series: 'Ideal DAC' },
  );
}

function adcSerial(n: number): LibraryPartDef {
  return withMeta(
    {
      id: `mixed/adc${n}-spi`,
      name: `ADC ${n}-bit SPI`,
      group: 'mixed',
      family: 'Serial converters',
      description: `Serial ${n}-bit ADC (SPI style): ~CS falling samples VIN and puts the MSB on DOUT; every falling SCLK edge shifts out the next bit, MSB first (read on the rising edge); ~CS high releases DOUT`,
      prefix: 'U',
      symbol: icSymbol('ADC SPI', [analogPin('VIN'), analogPin('VREFP', 'VREF+'), analogPin('VREFN', 'VREF-'), null, { name: 'CS', label: '~CS', type: 'input' }, { name: 'SCLK', type: 'input', clock: true }], [null, null, null, null, { name: 'DOUT', type: 'output' }]),
      params: [vhigh(), threshold()],
      toSpice: (ctx) => {
        const m = familyModel(`MS_ADC${n}SPI`, 'D_ADC_SPI', logicLevels(ctx, 20e-9), 1, { n });
        return { elements: [aElement(ctx.name('A'), ['VIN', 'VREFP', 'VREFN', 'CS', 'SCLK', 'DOUT'].map((p) => ctx.node(p)), GROUND_REF, m.name)], models: [m] };
      },
      keywords: ['adc', 'spi', 'serial', 'converter', 'mcp3201', `${n}-bit`],
      provenance: 'MachSim serial converter code model (D_ADC_SPI): ideal truncating quantiser, MSB-first frame',
    },
    { vi: `ADC ${n} bit nối tiếp (kiểu SPI): sườn xuống ~CS lấy mẫu VIN và đưa bit cao nhất ra DOUT; mỗi sườn xuống SCLK dịch bit kế tiếp ra, bit cao trước (đọc ở sườn lên); ~CS cao thả nổi DOUT`, nameVi: `ADC ${n} bit SPI`, specs: { bits: n }, sortKey: n, series: 'Serial ADC' },
  );
}

function dacSerial(n: number): LibraryPartDef {
  return withMeta(
    {
      id: `mixed/dac${n}-spi`,
      name: `DAC ${n}-bit SPI`,
      group: 'mixed',
      family: 'Serial converters',
      description: `Serial ${n}-bit voltage DAC (SPI style): while ~CS is low each rising SCLK edge shifts DIN in, MSB first (only the last ${n} bits are kept); ~CS rising updates the output when ~LDAC is low or open, ~LDAC falling updates it at any time`,
      prefix: 'U',
      symbol: icSymbol('DAC SPI', [{ name: 'CS', label: '~CS', type: 'input' }, { name: 'SCLK', type: 'input', clock: true }, { name: 'DIN', type: 'input' }, { name: 'LDAC', label: '~LDAC', type: 'input' }, null, analogPin('VREFP', 'VREF+'), analogPin('VREFN', 'VREF-')], [null, null, null, { name: 'VOUT', type: 'output' }]),
      params: [numParam('tsettle', 'Full-scale settling time', '1u', 's', { min: 1e-12, showOnSchematic: true }), threshold()],
      optionalPins: ['LDAC'],
      toSpice: (ctx) => {
        const m = familyModel(`MS_DAC${n}SPI`, 'D_DAC_SPI', idealLevels(5, 0, ctx.num('threshold')), 1, { n, tsettle: ctx.num('tsettle'), tpd: 20e-9 });
        const ports = [ctx.node('CS'), ctx.node('SCLK'), ctx.node('DIN'), optionalNode(ctx, 'LDAC'), ctx.node('VREFP'), ctx.node('VREFN'), ctx.node('VOUT')];
        return { elements: [aElement(ctx.name('A'), ports, GROUND_REF, m.name)], models: [m] };
      },
      keywords: ['dac', 'spi', 'serial', 'converter', 'mcp4921', `${n}-bit`],
      provenance: 'MachSim serial converter code model (D_DAC_SPI): exact binary weights, linear settling ramp',
    },
    { vi: `DAC ${n} bit nối tiếp ngõ ra áp (kiểu SPI): khi ~CS thấp, mỗi sườn lên SCLK dịch DIN vào, bit cao trước (chỉ giữ ${n} bit cuối); sườn lên ~CS cập nhật ngõ ra khi ~LDAC thấp hoặc để trống, sườn xuống ~LDAC cập nhật bất kỳ lúc nào`, nameVi: `DAC ${n} bit SPI`, specs: { bits: n }, sortKey: n, series: 'Serial DAC' },
  );
}

const adc0804: LibraryPartDef = withMeta(
  {
    id: 'mixed/adc0804',
    name: 'ADC0804',
    group: 'mixed',
    family: 'Converters',
    description: '8-bit microprocessor-compatible ADC: ~WR pulse (with ~CS low) starts a conversion of V(VIN+) − V(VIN−); ~INTR goes low when the result is ready (≈ 100 µs); ~CS and ~RD low read DB0-DB7. Full scale = 2·V(VREF/2) (open: VCC). CLK IN / CLK R / AGND are drawn for wiring only. Hidden power pins (VCC = 20, GND = 10) on the VCC net.',
    prefix: 'U',
    symbol: icSymbol('ADC0804', side('%VINP@VIN(+):6 %VINN@VIN(-):7 %VREF2@VREF/2:9 | ~CS:1 ~RD:2 ~WR:3 | %CLKIN@CLK_IN:4 %CLKR@CLK_R:19 %AGND:8', 'input'), side('DB0:18 DB1:17 DB2:16 DB3:15 DB4:14 DB5:13 DB6:12 DB7:11 | ~INTR:5', 'output'), { w: 100 }),
    params: [numParam('tconv', 'Conversion time', '100u', 's', { min: 1e-9, showOnSchematic: true, help: 'About 66-73 clock periods: 100 µs with the usual 640 kHz clock' }), ...powerParams('vccnet', 'VCC')],
    optionalPins: ['VREF2', 'CLKIN', 'CLKR', 'AGND', 'INTR'],
    toSpice: (ctx) => {
      const lv = { ...idealLevels(5, 200e-9, 1.4), vin_float: 0 };
      const m = familyModel('MS_ADC0804', 'D_ADC0804', lv, 1, { tconv: ctx.num('tconv'), vnom: 5 });
      const ports = [ctx.node('VINP'), ctx.node('VINN'), optionalNode(ctx, 'VREF2'), ctx.node('CS'), ctx.node('RD'), ctx.node('WR'), ctx.node('INTR'), ...names('DB', 8).map((p) => ctx.node(p))];
      powerNodes(ctx, 'vccnet', 'VCC');
      return { elements: [aElement(ctx.name('A'), ports, GROUND_REF, m.name)], models: [m] };
    },
    footprint: 'DIP-20',
    keywords: ['adc', 'adc0804', 'microprocessor', '8-bit', 'converter'],
    provenance: 'MachSim converter code model (D_ADC0804): ideal rounding quantiser, typical conversion time; public datasheet pinout',
  },
  { vi: 'ADC 8 bit giao tiếp vi xử lý: xung ~WR (khi ~CS thấp) bắt đầu chuyển đổi V(VIN+) − V(VIN−); ~INTR xuống thấp khi có kết quả (≈ 100 µs); ~CS và ~RD thấp thì đọc DB0-DB7. Toàn thang = 2·V(VREF/2) (để trống: VCC). CLK IN / CLK R / AGND chỉ để nối dây.', specs: { bits: 8, positions: 20, package: 'DIP-20' }, sortKey: 8, series: 'Microprocessor ADC' },
);

const adc0809: LibraryPartDef = withMeta(
  {
    id: 'mixed/adc0809',
    name: 'ADC0809',
    group: 'mixed',
    family: 'Converters',
    description: '8-bit ADC with an 8-channel multiplexer: ALE rising latches the channel ADD C B A; START falling starts a conversion (EOC low ≈ 100 µs); OE high drives the result on D0-D7. CLOCK is drawn for wiring only. Hidden power pins (VCC = 11, GND = 13) on the VCC net.',
    prefix: 'U',
    symbol: icSymbol('ADC0809', side(`${[26, 27, 28, 1, 2, 3, 4, 5].map((n, k) => `%IN${k}:${n}`).join(' ')} | %REFP@REF(+):12 %REFN@REF(-):16 | ADDA@ADD_A:25 ADDB@ADD_B:24 ADDC@ADD_C:23 ALE:22 START:6 OE:9 %CLOCK:10`, 'input'), side(`${[17, 14, 15, 8, 18, 19, 20, 21].map((n, k) => `D${k}:${n}`).join(' ')} | EOC:7`, 'output'), { w: 100 }),
    params: [numParam('tconv', 'Conversion time', '100u', 's', { min: 1e-9, showOnSchematic: true, help: 'About 64 clock periods: 100 µs with a 640 kHz clock' }), ...powerParams('vccnet', 'VCC')],
    optionalPins: ['CLOCK', 'IN0', 'IN1', 'IN2', 'IN3', 'IN4', 'IN5', 'IN6', 'IN7'],
    toSpice: (ctx) => {
      const m = familyModel('MS_ADC0809', 'D_ADC0809', { ...idealLevels(5, 200e-9, 1.4), vin_float: 0 }, 1, { tconv: ctx.num('tconv') });
      const ports = [...names('IN', 8), 'REFP', 'REFN', 'ADDA', 'ADDB', 'ADDC', 'ALE', 'START', 'OE', 'EOC', ...names('D', 8)].map((p) => ctx.node(p));
      powerNodes(ctx, 'vccnet', 'VCC');
      return { elements: [aElement(ctx.name('A'), ports, GROUND_REF, m.name)], models: [m] };
    },
    footprint: 'DIP-28',
    keywords: ['adc', 'adc0809', 'adc0808', 'multiplexer', '8 channel', 'converter'],
    provenance: 'MachSim converter code model (D_ADC0809): ideal rounding quantiser, typical conversion time; public datasheet pinout',
  },
  { vi: 'ADC 8 bit có bộ dồn kênh 8 ngõ vào: sườn lên ALE chốt kênh ADD C B A; sườn xuống START bắt đầu chuyển đổi (EOC thấp ≈ 100 µs); OE cao đưa kết quả ra D0-D7. Chân CLOCK chỉ để nối dây.', specs: { bits: 8, positions: 28, package: 'DIP-28' }, sortKey: 8, series: 'Microprocessor ADC' },
);

const dac0808: LibraryPartDef = withMeta(
  {
    id: 'mixed/dac0808',
    name: 'DAC0808',
    group: 'mixed',
    family: 'Converters',
    description: '8-bit multiplying current-output DAC: the reference current I = V(VREF) / R14 flows into VREF+ (held at the VREF− potential); IO sinks I · code / 256 (A1 = MSB). Connect IO to the inverting input of an op-amp with a feedback resistor for a voltage output. VCC, VEE and COMP are drawn for wiring only.',
    prefix: 'U',
    symbol: icSymbol('DAC0808', side(`${[5, 6, 7, 8, 9, 10, 11, 12].map((n, k) => `A${k + 1}:${n}`).join(' ')} | %VREFP@VREF+:14 %VREFN@VREF-:15 | %VCC:13 %VEE:3 %COMP:16 %GND:2`, 'input'), side('| | | %IO:4', 'output'), { w: 100 }),
    params: [threshold()],
    optionalPins: ['VCC', 'VEE', 'COMP', 'GND'],
    toSpice: (ctx) => {
      const frac = internalNode(ctx, 'frac');
      const one = internalNode(ctx, 'one');
      const m = familyModel('MS_DAC0808', 'D_DAC', idealLevels(5, 0, ctx.num('threshold')), 1, { tsettle: 150e-9, rout: 1, tpd: 50e-9 });
      const sense = ctx.name('V', 'ref');
      const bits = [8, 7, 6, 5, 4, 3, 2, 1].map((k) => ctx.node(`A${k}`));
      return {
        elements: [
          elV(sense, ctx.node('VREFP'), ctx.node('VREFN'), { dc: 0 }),
          elV(ctx.name('V', 'one'), one, '0', { dc: 1 }),
          aElement(ctx.name('A'), [...bits, one, '0', frac], GROUND_REF, m.name),
          elB(ctx.name('B', 'io'), ctx.node('IO'), '0', 'I', `I(${sense}) * V(${frac})`),
          elR(ctx.name('R', 'io'), ctx.node('IO'), '0', 1e9),
        ],
        models: [m],
      };
    },
    footprint: 'DIP-16',
    keywords: ['dac', 'dac0808', 'mc1408', 'current output', 'multiplying'],
    provenance: 'MachSim behavioural model: ideal binary-weighted current output from the sensed reference current; public datasheet pinout and application circuit',
  },
  { vi: 'DAC 8 bit ngõ ra dòng kiểu nhân: dòng chuẩn I = V(VREF) / R14 chảy vào VREF+ (được giữ bằng điện thế VREF−); chân IO hút dòng I · mã / 256 (A1 = bit cao nhất). Nối IO vào đầu đảo của op-amp có điện trở hồi tiếp để có ngõ ra áp. VCC, VEE, COMP chỉ để nối dây.', specs: { bits: 8, positions: 16, package: 'DIP-16' }, sortKey: 8, series: 'Current DAC' },
);

function analogSwitch(spdt: boolean): LibraryPartDef {
  return withMeta(
    {
      id: spdt ? 'mixed/analog-switch-spdt' : 'mixed/analog-switch',
      name: spdt ? 'Analog switch SPDT' : 'Analog switch SPST',
      group: 'mixed',
      family: 'Analog switches',
      description: spdt
        ? 'Logic-controlled changeover switch: COM connects to NO while CTRL is above the threshold, to NC otherwise (on-resistance RON, off ROFF)'
        : 'Logic-controlled analog switch: A and B are connected (RON) while CTRL is above the threshold, open (ROFF) otherwise',
      prefix: 'U',
      virtual: true,
      symbol: icSymbol(spdt ? 'SW SPDT' : 'SW SPST', [{ name: 'CTRL', type: 'input' }, null, spdt ? analogPin('COM') : analogPin('A')], spdt ? [analogPin('NO'), null, analogPin('NC')] : [null, null, analogPin('B')], { w: 60 }),
      params: [numParam('ron', 'On resistance', '50', 'Ω', { min: 1e-6, showOnSchematic: true }), numParam('roff', 'Off resistance', '10G', 'Ω', { min: 1 }), numParam('threshold', 'Control threshold', '2.5', 'V', { group: 'model' })],
      toSpice: (ctx) => {
        const vt = ctx.num('threshold');
        const m = swModel(`MS_ASW_${Math.round(ctx.num('ron') * 1000)}_${Math.round(vt * 1000)}_${Math.round(Math.log10(ctx.num('roff')) * 100)}`, vt, 0.05, ctx.num('ron'), ctx.num('roff'));
        const els = spdt
          ? [elS(ctx.name('S', 'no'), ctx.node('COM'), ctx.node('NO'), ctx.node('CTRL'), '0', m.name), elS(ctx.name('S', 'nc'), ctx.node('COM'), ctx.node('NC'), '0', ctx.node('CTRL'), m.name.replace('MS_ASW', 'MS_ASWN'))]
          : [elS(ctx.name('S'), ctx.node('A'), ctx.node('B'), ctx.node('CTRL'), '0', m.name)];
        const models = spdt ? [m, swModel(m.name.replace('MS_ASW', 'MS_ASWN'), -vt, 0.05, ctx.num('ron'), ctx.num('roff'))] : [m];
        return { elements: [...els, elR(ctx.name('R', 'ctl'), ctx.node('CTRL'), '0', 1e12)], models };
      },
      keywords: ['analog switch', 'transmission gate', spdt ? 'spdt' : 'spst', 'multiplexer'],
      provenance: 'MachSim voltage-controlled switch model with logic threshold',
    },
    {
      vi: spdt ? 'Công tắc chuyển mạch điều khiển bằng logic: COM nối NO khi CTRL lớn hơn ngưỡng, nối NC trong trường hợp còn lại (điện trở dẫn RON, hở ROFF)' : 'Công tắc tương tự điều khiển bằng logic: A và B nối với nhau (RON) khi CTRL lớn hơn ngưỡng, hở (ROFF) trong trường hợp còn lại',
      nameVi: spdt ? 'Công tắc tương tự SPDT' : 'Công tắc tương tự SPST',
      sortKey: spdt ? 2 : 1,
      series: 'Analog switch',
    },
  );
}

const vco: LibraryPartDef = withMeta(
  {
    id: 'mixed/vco-logic',
    name: 'VCO (logic output)',
    group: 'mixed',
    family: 'Oscillators',
    description: 'Voltage-controlled oscillator with a square-wave logic output: f = f0 + kv · V(VIN), limited to fmin..fmax; every edge is placed at its exact time',
    prefix: 'U',
    virtual: true,
    symbol: icSymbol('VCO', [analogPin('VIN')], [{ name: 'OUT', type: 'output' }], { w: 60 }),
    params: [
      numParam('f0', 'Frequency at 0 V', '1k', 'Hz', { min: 0, showOnSchematic: true }),
      numParam('kv', 'Gain (Hz per volt)', '1k', 'Hz/V', { showOnSchematic: true }),
      numParam('fmin', 'Minimum frequency', '0', 'Hz', { min: 0, group: 'model' }),
      numParam('fmax', 'Maximum frequency', '1Meg', 'Hz', { min: 1e-6, group: 'model' }),
      numParam('duty', 'Duty cycle', '50', '%', { min: 1, max: 99, group: 'model' }),
      vhigh(),
    ],
    toSpice: (ctx) => {
      const f0 = ctx.num('f0');
      const kv = ctx.num('kv');
      const duty = ctx.num('duty') / 100;
      if (!(duty > 0 && duty < 1)) throw new Error('bad value for duty: must be between 1 and 99 %');
      const m = familyModel('MS_VCO', 'D_VCO', logicLevels(ctx, 0), 0, { va: 0, fa: Math.max(0, f0), vb: 1, fb: Math.max(0, f0 + kv), fmin: ctx.num('fmin'), fmax: ctx.num('fmax'), duty });
      return { elements: [aElement(ctx.name('A'), [ctx.node('VIN'), ctx.node('OUT')], GROUND_REF, m.name), elR(ctx.name('R', 'in'), ctx.node('VIN'), '0', 1e12)], models: [m] };
    },
    keywords: ['vco', 'voltage controlled oscillator', 'fm', 'pll', 'oscillator'],
    provenance: 'MachSim code model (D_VCO): integrated phase, linear tuning law',
  },
  { vi: 'Bộ dao động điều khiển bằng điện áp, ngõ ra xung vuông logic: f = f0 + kv · V(VIN), giới hạn trong fmin..fmax; mỗi sườn xung đặt đúng thời điểm', nameVi: 'VCO (ngõ ra logic)', specs: {}, sortKey: 1, series: 'VCO' },
);

/** Mixed-signal parts added to the hand-written ADC8 / DAC8 / comparator. */
export const MIXED_SIGNAL_CATALOG: LibraryPartDef[] = [
  ...[4, 6, 10, 12, 16].map(adcParallel),
  ...[4, 6, 10, 12, 16].map(dacParallel),
  ...[8, 10, 12].map(adcSerial),
  ...[8, 10, 12].map(dacSerial),
  adc0804,
  adc0809,
  dac0808,
  analogSwitch(false),
  analogSwitch(true),
  vco,
];

