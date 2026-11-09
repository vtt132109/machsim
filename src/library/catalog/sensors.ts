/**
 * Sensor and vacuum-tube catalogue (group Misc; light-dependent resistors in Basic ›
 * Photoresistor).
 *
 * Sensors are behavioural: the measured quantity is an interactive parameter (slider operated by
 * a key during simulation) and the electrical output follows the published transfer function:
 *   RTD            Callendar–Van Dusen (IEC 60751): R = R0·(1 + A·T + B·T²), A = 3.9083e-3,
 *                  B = −5.775e-7 (T ≥ 0 °C; the C term below 0 °C is neglected)
 *   thermocouple   V = S·(Thot − Tref) with the type's average Seebeck coefficient (K 41, J 52,
 *                  T 43, E 68 µV/°C over 0…400 °C) in series with 10 Ω of wire resistance
 *   IC sensors     10 mV/°C (LM35), 10 mV/°F (LM34), 500 mV + 10 mV/°C (TMP36), 10 mV/K
 *                  shunt (LM335)
 *   Hall           linear: VCC/2 + S·B (S = 2.5 mV/mT at 5 V, ratiometric); switch: open-drain
 *                  low while B > BOP; reed: contact closes above the pull-in field
 *   pressure       bridge: ΔV = 2 mV/V full scale; amplified: VOUT = VCC·(0.1 + 0.8·P / Pmax)
 *   light          phototransistor: base photocurrent ∝ illuminance (hFE 400); ambient light
 *                  sensor: 0.5 µA/lux current output; LDRs: R = R10·(E / 10 lux)^−γ
 *   position       potentiometric slider, LVDT (secondary = k·x·Vprimary), incremental encoder
 *                  (quadrature outputs at the set speed)
 * Vacuum tubes use the Koren triode / pentode equations (published 1996) with the published or
 * typical parameter sets of each type; heater circuits are not modelled.
 */
import type { ElementIR } from '../../sim/netlist';
import { card, elB, elC, elD, elI, elQ, elR, elV, ex, internalNode, keyParam, numParam, stepParam, type LibraryPartDef } from '../partkit';
import { arrow, boxSymbol, circle, line, makeSymbol, pin, poly, rect, resistorBody, text, twoPinH, zigzag } from '../symbols';
import type { ParamDef, SymbolDef, ToSpiceContext } from '../types';
import { eng, withMeta } from './kit';

const pos = (ctx: ToSpiceContext, key: string): number => {
  const v = ctx.num(key);
  if (!(v > 0)) throw new Error(`bad value for ${key}: must be > 0`);
  return v;
};

const slider = (key: string, label: string, def: string, unit: string, min: number, max: number): ParamDef => numParam(key, label, def, unit, { min, max, showOnSchematic: true });

function sensorMeta(vi: string, nameVi: string, specs: Record<string, number | string> = {}) {
  return { vi, nameVi, specs, series: 'Sensor' };
}

// ---------------------------------------------------------------------------------------------
// temperature

const RTD_SYMBOL = twoPinH([...[{ kind: 'polyline' as const, points: zigzag(-20, 20), closed: false }], line(-14, 10, 14, -10), line(14, -10, 20, -10), text(-14, -10, 'θ', 8)]);

const rtds: LibraryPartDef[] = (
  [
    ['pt100', 'PT100', 100],
    ['pt500', 'PT500', 500],
    ['pt1000', 'PT1000', 1000],
  ] as const
).map(([slug, pn, r0]) =>
  withMeta(
    {
      id: `misc/rtd-${slug}`,
      name: `RTD ${pn}`,
      group: 'misc',
      family: 'Temperature sensor',
      description: `Platinum resistance thermometer ${pn} (R0 = ${r0} Ω, α = 0.00385): R = R0·(1 + A·T + B·T²); key 'T' raises the temperature (Shift+T lowers it)`,
      prefix: 'RT',
      symbol: RTD_SYMBOL,
      params: [slider('temp', 'Temperature', '25', '°C', -50, 600), keyParam('T'), stepParam('5')],
      interactive: { kind: 'slider', param: 'temp', label: 'Temperature', key: 'T', step: 5 },
      toSpice: (ctx) => {
        const t = ctx.num('temp');
        const r = r0 * (1 + 3.9083e-3 * t - 5.775e-7 * t * t);
        if (!(r > 0)) throw new Error('bad value for temp: outside the RTD range');
        return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), r)] };
      },
      provenance: 'Callendar–Van Dusen equation with the IEC 60751 coefficients (A = 3.9083e-3, B = −5.775e-7)',
      footprint: 'RTD-2P',
      keywords: ['rtd', pn.toLowerCase(), 'temperature sensor', 'platinum', 'interactive'],
    },
    sensorMeta(`Nhiệt điện trở bạch kim ${pn} (R0 = ${r0} Ω, α = 0.00385): R = R0·(1 + A·T + B·T²); phím 'T' tăng nhiệt độ (Shift+T giảm)`, `Cảm biến RTD ${pn}`, { resistance: r0 }),
  ),
);

const TC_SYMBOL = twoPinH([line(-20, 0, -8, 0), line(-8, 0, 0, -10), line(0, -10, 8, 0, 2), line(8, 0, 20, 0), text(-12, -10, '+', 8)], { names: ['+', '-'] });

const thermocouples: LibraryPartDef[] = (
  [
    ['k', 'K', 41e-6],
    ['j', 'J', 52e-6],
    ['t', 'T', 43e-6],
    ['e', 'E', 68e-6],
  ] as const
).map(([slug, type, s]) =>
  withMeta(
    {
      id: `misc/thermocouple-${slug}`,
      name: `Thermocouple Type ${type}`,
      group: 'misc',
      family: 'Temperature sensor',
      description: `Type ${type} thermocouple: V(+,−) ≈ ${s * 1e6} µV/°C·(Thot − Tref) with 10 Ω loop resistance; key 'T' changes the hot-junction temperature`,
      prefix: 'TC',
      symbol: TC_SYMBOL,
      params: [slider('temp', 'Hot junction temperature', '100', '°C', -100, 1200), numParam('tref', 'Reference junction temperature', '25', '°C', {}), keyParam('T'), stepParam('5')],
      interactive: { kind: 'slider', param: 'temp', label: 'Temperature', key: 'T', step: 5 },
      toSpice: (ctx) => {
        const m = internalNode(ctx, 'm');
        return { elements: [elV(ctx.name('V'), m, ctx.node('-'), { dc: s * (ctx.num('temp') - ctx.num('tref')) }), elR(ctx.name('R'), ctx.node('+'), m, 10)] };
      },
      provenance: `Average Seebeck coefficient of type ${type} over 0…400 °C (published reference tables), linear approximation`,
      footprint: 'TC-2P',
      keywords: ['thermocouple', `type ${type.toLowerCase()}`, 'temperature sensor', 'interactive'],
    },
    sensorMeta(`Cặp nhiệt điện loại ${type}: V(+,−) ≈ ${s * 1e6} µV/°C·(Tnóng − Tchuẩn) với điện trở dây 10 Ω; phím 'T' thay đổi nhiệt độ đầu nóng`, `Cặp nhiệt điện loại ${type}`),
  ),
);

const IC3_SYMBOL = (title: string): SymbolDef => boxSymbol({ w: 60, h: 40, left: [{ name: '+VS', label: 'VS', number: '1', type: 'power' }], right: [{ name: 'VOUT', number: '2', type: 'output' }], bottom: [{ name: 'GND', number: '3', type: 'power' }], title, titleSize: 8, titlePos: { x: 0, y: -6 } });

const tempIcs: LibraryPartDef[] = (
  [
    ['lm35', 'LM35', 'Precision Celsius temperature sensor: VOUT = 10 mV/°C · T', 'Cảm biến nhiệt độ chính xác thang Celsius: VOUT = 10 mV/°C · T', (t: number) => 0.01 * t, '°C'],
    ['lm34', 'LM34', 'Precision Fahrenheit temperature sensor: VOUT = 10 mV/°F · T(°F)', 'Cảm biến nhiệt độ chính xác thang Fahrenheit: VOUT = 10 mV/°F · T(°F)', (t: number) => 0.01 * (t * 1.8 + 32), '°C'],
    ['tmp36', 'TMP36', 'Low-voltage temperature sensor: VOUT = 0.5 V + 10 mV/°C · T', 'Cảm biến nhiệt độ điện áp thấp: VOUT = 0.5 V + 10 mV/°C · T', (t: number) => 0.5 + 0.01 * t, '°C'],
  ] as const
).map(([slug, pn, en, vi, f]) =>
  withMeta(
    {
      id: `misc/${slug}`,
      name: pn,
      group: 'misc',
      family: 'Temperature sensor',
      description: `${en}; key 'T' changes the temperature`,
      prefix: 'U',
      symbol: IC3_SYMBOL(pn),
      params: [slider('temp', 'Temperature', '25', '°C', -55, 150), keyParam('T'), stepParam('5')],
      interactive: { kind: 'slider', param: 'temp', label: 'Temperature', key: 'T', step: 5 },
      toSpice: (ctx) => {
        const o = internalNode(ctx, 'o');
        const vo = f(ctx.num('temp'));
        return {
          elements: [
            elB(ctx.name('B'), o, ctx.node('GND'), 'V', `min(${ex(vo)},max(V(${ctx.node('+VS')},${ctx.node('GND')})-1,0))`),
            elR(ctx.name('R', 'o'), o, ctx.node('VOUT'), 1),
            elR(ctx.name('R', 'q'), ctx.node('+VS'), ctx.node('GND'), 80e3),
          ],
        };
      },
      provenance: `MachSim behavioural model of the ${pn} transfer function (datasheet scale factor and offset), output limited to VS − 1 V`,
      footprint: 'TO-92',
      keywords: [pn.toLowerCase(), 'temperature sensor', 'analog temperature', 'interactive'],
    },
    sensorMeta(`${vi}; phím 'T' thay đổi nhiệt độ`, `Cảm biến nhiệt ${pn}`),
  ),
);

const lm335: LibraryPartDef = withMeta(
  {
    id: 'misc/lm335',
    name: 'LM335',
    group: 'misc',
    family: 'Temperature sensor',
    description: "Kelvin temperature sensor operating like a Zener: V = 10 mV/K · T (2.98 V at 25 °C) when biased with 0.4–5 mA; key 'T' changes the temperature",
    prefix: 'D',
    symbol: twoPinH([line(-20, 0, -8, 0), poly([-8, -8, -8, 8, 8, 0], true), poly([4, -11, 8, -8, 8, 8, 12, 11]), line(8, 0, 20, 0)], { names: ['-', '+'] }),
    params: [slider('temp', 'Temperature', '25', '°C', -40, 100), keyParam('T'), stepParam('5')],
    interactive: { kind: 'slider', param: 'temp', label: 'Temperature', key: 'T', step: 5 },
    toSpice: (ctx) => {
      const vz = 0.01 * (ctx.num('temp') + 273.15);
      const m = internalNode(ctx, 'm');
      const d = card('MS_LM335_D', 'D', { is: 1e-14, n: 1 });
      // shunt regulator: source vz in series with 1 Ω above the knee, blocking below it
      return {
        elements: [elV(ctx.name('V'), m, ctx.node('-'), { dc: vz - 0.6 }), elD(ctx.name('D'), ctx.node('+'), m, d.name), elR(ctx.name('R'), ctx.node('+'), ctx.node('-'), 1e7)],
        models: [d],
      };
    },
    provenance: 'MachSim shunt model of the LM335 (10 mV/K breakdown voltage, about 1 Ω dynamic impedance)',
    footprint: 'TO-92',
    keywords: ['lm335', 'temperature sensor', 'kelvin', 'interactive'],
  },
  sensorMeta("Cảm biến nhiệt thang Kelvin hoạt động như diode Zener: V = 10 mV/K · T (2.98 V ở 25 °C) khi cấp dòng 0.4–5 mA; phím 'T' thay đổi nhiệt độ", 'Cảm biến nhiệt LM335'),
);

// ---------------------------------------------------------------------------------------------
// magnetic

const HALL_SYMBOL = (title: string): SymbolDef => boxSymbol({ w: 60, h: 40, left: [{ name: 'VCC', number: '1', type: 'power' }], right: [{ name: 'OUT', number: '3', type: 'output' }], bottom: [{ name: 'GND', number: '2', type: 'power' }], title, titleSize: 8, titlePos: { x: 0, y: -6 } });

const fieldParam = (): ParamDef => slider('field', 'Magnetic field', '0', 'mT', -200, 200);

const magnetic: LibraryPartDef[] = [
  withMeta(
    {
      id: 'misc/hall-linear',
      name: 'Hall Sensor Linear',
      group: 'misc',
      family: 'Magnetic sensor',
      description: "Ratiometric linear Hall-effect sensor: VOUT = VCC/2 + 2.5 mV/mT·B (at VCC = 5 V); key 'M' changes the field",
      prefix: 'U',
      symbol: HALL_SYMBOL('HALL'),
      params: [fieldParam(), numParam('sens', 'Sensitivity at 5 V', '2.5m', 'V/mT', { min: 0 }), keyParam('M'), stepParam('5')],
      interactive: { kind: 'slider', param: 'field', label: 'Magnetic field', key: 'M', step: 5 },
      toSpice: (ctx) => {
        const o = internalNode(ctx, 'o');
        const vcc = `V(${ctx.node('VCC')},${ctx.node('GND')})`;
        const b = ctx.num('field') * ctx.num('sens');
        return {
          elements: [elB(ctx.name('B'), o, ctx.node('GND'), 'V', `limit(${vcc}*(0.5+${ex(b / 5)}),0.05*${vcc},0.95*${vcc})`), elR(ctx.name('R', 'o'), o, ctx.node('OUT'), 100), elR(ctx.name('R', 'q'), ctx.node('VCC'), ctx.node('GND'), 1e3)],
        };
      },
      provenance: 'MachSim ratiometric linear Hall sensor (typical 2.5 mV/mT, output range 5–95 % of VCC)',
      footprint: 'TO-92',
      keywords: ['hall', 'magnetic', 'field sensor', 'current sensing', 'interactive'],
    },
    sensorMeta("Cảm biến Hall tuyến tính tỉ lệ nguồn: VOUT = VCC/2 + 2.5 mV/mT·B (ở VCC = 5 V); phím 'M' thay đổi từ trường", 'Cảm biến Hall tuyến tính'),
  ),
  withMeta(
    {
      id: 'misc/hall-switch',
      name: 'Hall Switch',
      group: 'misc',
      family: 'Magnetic sensor',
      description: "Unipolar Hall-effect switch with open-drain output: OUT pulls low while B exceeds the operate point (default 20 mT); add a pull-up resistor; key 'M' changes the field",
      prefix: 'U',
      symbol: HALL_SYMBOL('HALL'),
      params: [fieldParam(), numParam('bop', 'Operate point', '20', 'mT', {}), keyParam('M'), stepParam('5')],
      interactive: { kind: 'slider', param: 'field', label: 'Magnetic field', key: 'M', step: 5 },
      toSpice: (ctx) => ({ elements: [elR(ctx.name('R', 'out'), ctx.node('OUT'), ctx.node('GND'), ctx.num('field') > ctx.num('bop') ? 10 : 1e9), elR(ctx.name('R', 'q'), ctx.node('VCC'), ctx.node('GND'), 1e3)] }),
      provenance: 'MachSim unipolar Hall switch (open-drain output, 10 Ω on resistance)',
      footprint: 'TO-92',
      keywords: ['hall switch', 'magnetic', 'proximity', 'interactive'],
    },
    sensorMeta("Công tắc Hall một cực, ngõ ra cực máng hở: OUT kéo xuống thấp khi B vượt điểm tác động (mặc định 20 mT); cần điện trở kéo lên; phím 'M' thay đổi từ trường", 'Công tắc Hall'),
  ),
  withMeta(
    {
      id: 'misc/reed-switch',
      name: 'Reed Switch',
      group: 'misc',
      family: 'Magnetic sensor',
      description: "Magnetic reed switch: the contact closes while |B| exceeds the pull-in field (default 2 mT); key 'M' changes the field",
      prefix: 'S',
      symbol: twoPinH([line(-20, 0, -12, 0), line(-12, 0, 6, -3), line(-6, 3, 12, 0), line(12, 0, 20, 0), rect(-16, -8, 32, 16)]),
      params: [fieldParam(), numParam('bpull', 'Pull-in field', '2', 'mT', { min: 0 }), keyParam('M'), stepParam('1')],
      interactive: { kind: 'slider', param: 'field', label: 'Magnetic field', key: 'M', step: 1 },
      toSpice: (ctx) => ({ elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), Math.abs(ctx.num('field')) > ctx.num('bpull') ? 0.1 : 1e9)] }),
      provenance: 'MachSim reed contact (0.1 Ω closed, 1 GΩ open)',
      footprint: 'REED-2P',
      keywords: ['reed switch', 'magnetic', 'door sensor', 'interactive'],
    },
    sensorMeta("Công tắc lưỡi gà từ: tiếp điểm đóng khi |B| vượt từ trường hút (mặc định 2 mT); phím 'M' thay đổi từ trường", 'Công tắc lưỡi gà'),
  ),
];

// ---------------------------------------------------------------------------------------------
// pressure

const pressure: LibraryPartDef[] = [
  withMeta(
    {
      id: 'misc/pressure-bridge',
      name: 'Pressure Sensor Bridge',
      group: 'misc',
      family: 'Pressure sensor',
      description: "Piezoresistive pressure sensor (Wheatstone bridge, 5 kΩ arms): V(OUT+,OUT−) = 2 mV/V·VEXC at full scale (100 kPa); key 'P' changes the pressure",
      prefix: 'U',
      symbol: boxSymbol({ w: 60, h: 60, left: [{ name: 'EXC+', number: '1', type: 'power' }, { name: 'EXC-', number: '3', type: 'power' }], right: [{ name: 'OUT+', number: '2', type: 'output' }, { name: 'OUT-', number: '4', type: 'output' }], title: 'P', extra: [] }),
      params: [slider('pressure', 'Pressure', '50', 'kPa', 0, 100), numParam('fs', 'Full-scale pressure', '100', 'kPa', { min: 0 }), keyParam('P'), stepParam('5')],
      interactive: { kind: 'slider', param: 'pressure', label: 'Pressure', key: 'P', step: 5 },
      toSpice: (ctx) => {
        const x = (0.002 * ctx.num('pressure')) / pos(ctx, 'fs');
        const r = 5000;
        const ep = ctx.node('EXC+');
        const en = ctx.node('EXC-');
        return {
          elements: [
            elR(ctx.name('R', '1'), ep, ctx.node('OUT+'), r * (1 - 2 * x)),
            elR(ctx.name('R', '2'), ctx.node('OUT+'), en, r * (1 + 2 * x)),
            elR(ctx.name('R', '3'), ep, ctx.node('OUT-'), r * (1 + 2 * x)),
            elR(ctx.name('R', '4'), ctx.node('OUT-'), en, r * (1 - 2 * x)),
          ],
        };
      },
      provenance: 'Full-bridge piezoresistive sensor (published theory): ΔR/R = 2·x gives ΔV / VEXC = 2 mV/V at full scale',
      footprint: 'SENSOR-4P',
      keywords: ['pressure sensor', 'bridge', 'strain', 'piezoresistive', 'interactive'],
    },
    sensorMeta("Cảm biến áp suất áp trở (cầu Wheatstone, nhánh 5 kΩ): V(OUT+,OUT−) = 2 mV/V·VEXC ở toàn thang (100 kPa); phím 'P' thay đổi áp suất", 'Cảm biến áp suất kiểu cầu'),
  ),
  withMeta(
    {
      id: 'misc/pressure-amplified',
      name: 'Pressure Sensor Amplified',
      group: 'misc',
      family: 'Pressure sensor',
      description: "Integrated amplified pressure sensor: VOUT = VCC·(0.1 + 0.8·P / Pmax), ratiometric; key 'P' changes the pressure",
      prefix: 'U',
      symbol: HALL_SYMBOL('P'),
      params: [slider('pressure', 'Pressure', '100', 'kPa', 0, 500), numParam('fs', 'Full-scale pressure', '500', 'kPa', { min: 0 }), keyParam('P'), stepParam('5')],
      interactive: { kind: 'slider', param: 'pressure', label: 'Pressure', key: 'P', step: 5 },
      toSpice: (ctx) => {
        const o = internalNode(ctx, 'o');
        const k = 0.1 + (0.8 * ctx.num('pressure')) / pos(ctx, 'fs');
        return { elements: [elB(ctx.name('B'), o, ctx.node('GND'), 'V', `${ex(k)}*V(${ctx.node('VCC')},${ctx.node('GND')})`), elR(ctx.name('R', 'o'), o, ctx.node('OUT'), 50), elR(ctx.name('R', 'q'), ctx.node('VCC'), ctx.node('GND'), 1e3)] };
      },
      provenance: 'MachSim ratiometric amplified pressure transducer (10–90 % of VCC over the range)',
      footprint: 'SENSOR-3P',
      keywords: ['pressure sensor', 'transducer', 'ratiometric', 'interactive'],
    },
    sensorMeta("Cảm biến áp suất có khuếch đại tích hợp: VOUT = VCC·(0.1 + 0.8·P / Pmax), tỉ lệ theo nguồn; phím 'P' thay đổi áp suất", 'Cảm biến áp suất có khuếch đại'),
  ),
];

// ---------------------------------------------------------------------------------------------
// light

const PHOTO_Q = card('MS_PHOTOTRANSISTOR', 'NPN', { is: 1e-14, bf: 400, vaf: 80, cje: 10e-12, cjc: 15e-12, tf: 1e-6, tr: 10e-6, rb: 10, rc: 20 });

const light: LibraryPartDef[] = [
  withMeta(
    {
      id: 'misc/phototransistor',
      name: 'Phototransistor',
      group: 'misc',
      family: 'Light sensor',
      description: "NPN phototransistor (collector C, emitter E, optional base B): collector current ≈ 2 mA at 1000 lux; key 'L' changes the illuminance",
      prefix: 'Q',
      symbol: makeSymbol(
        [circle(4, 0, 16), line(-2, -10, -2, 10, 2), line(-2, 0, -10, 0), line(-10, 0, -10, 30), line(-2, -4, 10, -14), line(10, -14, 10, -30), line(-2, 4, 10, 14), line(10, 14, 10, 30), poly([10, 14, 4, 13, 7, 9], true, true), ...arrow(-24, -18, -10, -6), ...arrow(-28, -8, -14, 4)],
        [pin('C', 10, -30, 'up', { number: '1' }), pin('E', 10, 30, 'down', { number: '2' }), pin('B', -10, 30, 'down', { number: '3', type: 'input' })],
        { refPos: { x: 24, y: -6 }, valuePos: { x: 24, y: 8 } },
      ),
      optionalPins: ['B'],
      params: [slider('lux', 'Illuminance', '200', 'lux', 0, 10000), keyParam('L'), stepParam('5')],
      interactive: { kind: 'slider', param: 'lux', label: 'Light level', key: 'L', step: 5 },
      toSpice: (ctx) => {
        const b = internalNode(ctx, 'b');
        return {
          elements: [
            elQ(ctx.name('Q'), ctx.node('C'), b, ctx.node('E'), PHOTO_Q.name),
            elI(ctx.name('I', 'ph'), ctx.node('C'), b, { dc: 5e-9 * ctx.num('lux') }),
            elR(ctx.name('R', 'be'), b, ctx.node('E'), 1e8),
            elR(ctx.name('R', 'bpin'), ctx.node('B'), b, 100),
          ],
          models: [PHOTO_Q],
        };
      },
      provenance: 'MachSim phototransistor: base photocurrent 5 nA/lux, βF = 400 (typical 5 mm NPN phototransistor)',
      footprint: 'LED-5MM',
      keywords: ['phototransistor', 'light sensor', 'optical', 'interactive'],
    },
    sensorMeta("Phototransistor NPN (cực C, cực E, cực B tuỳ chọn): dòng collector ≈ 2 mA ở 1000 lux; phím 'L' thay đổi độ rọi", 'Phototransistor'),
  ),
  withMeta(
    {
      id: 'misc/ambient-light-sensor',
      name: 'Ambient Light Sensor',
      group: 'misc',
      family: 'Light sensor',
      description: "Current-output ambient light sensor: 0.5 µA per lux flows from VCC into OUT's load (connect a load resistor from OUT to ground); key 'L' changes the illuminance",
      prefix: 'U',
      symbol: twoPinH([rect(-14, -8, 28, 16), text(0, 4, 'ALS', 7), ...arrow(-14, -24, -6, -12), ...arrow(-4, -24, 4, -12)], { names: ['VCC', 'OUT'] }),
      params: [slider('lux', 'Illuminance', '200', 'lux', 0, 10000), keyParam('L'), stepParam('5')],
      interactive: { kind: 'slider', param: 'lux', label: 'Light level', key: 'L', step: 5 },
      toSpice: (ctx) => {
        const d = card('MS_ALS_D', 'D', { is: 1e-12, n: 1 });
        const m = internalNode(ctx, 'm');
        return {
          elements: [elD(ctx.name('D'), ctx.node('VCC'), m, d.name), elI(ctx.name('I'), m, ctx.node('OUT'), { dc: 0.5e-6 * ctx.num('lux') }), elR(ctx.name('R'), m, ctx.node('OUT'), 1e9)],
          models: [d],
        };
      },
      provenance: 'MachSim current-output light sensor (0.5 µA/lux, about 0.7 V compliance below VCC)',
      footprint: 'TO-92',
      keywords: ['ambient light sensor', 'light sensor', 'lux', 'interactive'],
    },
    sensorMeta("Cảm biến ánh sáng môi trường ngõ ra dòng: 0.5 µA mỗi lux chảy từ VCC qua tải ở OUT (nối điện trở tải từ OUT xuống đất); phím 'L' thay đổi độ rọi", 'Cảm biến ánh sáng môi trường'),
  ),
];

const LDRS: [pn: string, r10: number, gamma: number][] = [
  ['GL5516', 7.5e3, 0.6],
  ['GL5528', 15e3, 0.6],
  ['GL5537', 25e3, 0.65],
  ['GL5539', 75e3, 0.75],
  ['GL5549', 150e3, 0.8],
];

const LDR_SYMBOL = twoPinH([...resistorBody(), ...arrow(-12, -22, -4, -10), ...arrow(-2, -22, 6, -10)]);

const ldrs: LibraryPartDef[] = LDRS.map(([pn, r10, g]) =>
  withMeta(
    {
      id: `basic/ldr-${pn.toLowerCase()}`,
      name: pn,
      group: 'basic',
      family: 'Photoresistor',
      description: `Light-dependent resistor, ${eng(r10, 'Ω')} at 10 lux, γ = ${g}: R = R10·(E / 10 lux)^−γ; key 'L' changes the illuminance`,
      prefix: 'R',
      symbol: LDR_SYMBOL,
      params: [slider('lux', 'Illuminance', '10', 'lux', 0.1, 10000), keyParam('L'), stepParam('5')],
      interactive: { kind: 'slider', param: 'lux', label: 'Light level', key: 'L', step: 5 },
      toSpice: (ctx) => {
        const e = Math.max(0.1, ctx.num('lux'));
        return { elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), Math.min(10e6, r10 * Math.pow(e / 10, -g)))] };
      },
      provenance: `Power-law LDR model with the ${pn} datasheet resistance at 10 lux (${eng(r10, 'Ω')}) and slope γ = ${g}, limited to 10 MΩ (dark)`,
      footprint: 'LDR-5MM',
      keywords: [pn.toLowerCase(), 'ldr', 'photoresistor', 'light sensor', 'interactive'],
    },
    { vi: `Quang trở, ${eng(r10, 'Ω')} ở 10 lux, γ = ${g}: R = R10·(E / 10 lux)^−γ; phím 'L' thay đổi độ rọi`, specs: { resistance: r10 }, sortKey: r10, series: 'LDR' },
  ),
);

// ---------------------------------------------------------------------------------------------
// position

const position: LibraryPartDef[] = [
  withMeta(
    {
      id: 'misc/position-linear',
      name: 'Linear Position Sensor',
      group: 'misc',
      family: 'Position sensor',
      description: "Potentiometric linear position sensor (10 kΩ track): V(W) moves from pin 1 to pin 2 as the position goes 0 → 100 %; key 'X' moves it",
      prefix: 'R',
      symbol: makeSymbol([line(-30, 0, -20, 0), line(20, 0, 30, 0), rect(-20, -6, 40, 12), line(0, -30, 0, -8), poly([-3, -12, 3, -12, 0, -7], true, true)], [pin('1', -30, 0, 'left', { number: '1' }), pin('2', 30, 0, 'right', { number: '3' }), pin('W', 0, -30, 'up', { number: '2' })], { refPos: { x: -22, y: -16 }, valuePos: { x: 0, y: 22 } }),
      params: [slider('position', 'Position', '50', '%', 0, 100), numParam('r', 'Track resistance', '10k', 'Ω', { min: 0 }), keyParam('X'), stepParam('5')],
      interactive: { kind: 'slider', param: 'position', label: 'Position', key: 'X', step: 5 },
      toSpice: (ctx) => {
        const x = Math.min(1 - 1e-6, Math.max(1e-6, ctx.num('position') / 100));
        const r = pos(ctx, 'r');
        return { elements: [elR(ctx.name('R', 'a'), ctx.node('1'), ctx.node('W'), r * x), elR(ctx.name('R', 'b'), ctx.node('W'), ctx.node('2'), r * (1 - x))] };
      },
      provenance: 'Ideal resistive track divider',
      footprint: 'POT-3P',
      keywords: ['position sensor', 'linear', 'potentiometer', 'displacement', 'interactive'],
    },
    sensorMeta("Cảm biến vị trí thẳng kiểu chiết áp (thanh trở 10 kΩ): V(W) chạy từ chân 1 tới chân 2 khi vị trí đi từ 0 → 100 %; phím 'X' di chuyển", 'Cảm biến vị trí thẳng'),
  ),
  withMeta(
    {
      id: 'misc/lvdt',
      name: 'LVDT',
      group: 'misc',
      family: 'Position sensor',
      description: "Linear variable differential transformer: drive the primary P1-P2 with AC; the secondary S1-S2 gives k·x·V(P1,P2) (x = core position −100…100 %, k = 0.5); key 'X' moves the core",
      prefix: 'T',
      symbol: boxSymbol({ w: 60, h: 40, left: [{ name: 'P1', number: '1' }, { name: 'P2', number: '2' }], right: [{ name: 'S1', number: '3' }, { name: 'S2', number: '4' }], title: 'LVDT', titleSize: 8 }),
      params: [slider('position', 'Core position', '0', '%', -100, 100), numParam('k', 'Transfer ratio at full stroke', '0.5', 'V/V', {}), keyParam('X'), stepParam('5')],
      interactive: { kind: 'slider', param: 'position', label: 'Position', key: 'X', step: 5 },
      toSpice: (ctx) => {
        const x = ctx.num('position') / 100;
        const o = internalNode(ctx, 'o');
        return {
          elements: [elR(ctx.name('R', 'p'), ctx.node('P1'), ctx.node('P2'), 200), elB(ctx.name('B'), o, ctx.node('S2'), 'V', `${ex(ctx.num('k') * x)}*V(${ctx.node('P1')},${ctx.node('P2')})`), elR(ctx.name('R', 's'), o, ctx.node('S1'), 100)],
        };
      },
      provenance: 'Ideal LVDT transfer function (secondary voltage proportional to core displacement and primary voltage)',
      footprint: 'LVDT-4P',
      keywords: ['lvdt', 'position sensor', 'displacement', 'transformer', 'interactive'],
    },
    sensorMeta("Biến áp vi sai tuyến tính (LVDT): cấp AC cho cuộn sơ cấp P1-P2; cuộn thứ cấp S1-S2 cho k·x·V(P1,P2) (x = vị trí lõi −100…100 %, k = 0.5); phím 'X' di chuyển lõi", 'Cảm biến LVDT'),
  ),
  withMeta(
    {
      id: 'misc/encoder',
      name: 'Incremental Encoder',
      group: 'misc',
      family: 'Position sensor',
      description: "Incremental quadrature encoder: outputs A and B (0 / VCC, B lags A by 90°) at speed × pulses-per-revolution; key 'S' changes the speed",
      prefix: 'U',
      symbol: boxSymbol({ w: 60, h: 40, left: [{ name: 'VCC', number: '1', type: 'power' }], right: [{ name: 'A', number: '3', type: 'output' }, { name: 'B', number: '4', type: 'output' }], bottom: [{ name: 'GND', number: '2', type: 'power' }], title: 'ENC', titleSize: 8, titlePos: { x: 0, y: -6 } }),
      params: [slider('rpm', 'Speed', '600', 'rpm', -6000, 6000), numParam('ppr', 'Pulses per revolution', '20', '', { min: 1 }), keyParam('S'), stepParam('5')],
      interactive: { kind: 'slider', param: 'rpm', label: 'Speed', key: 'S', step: 5 },
      toSpice: (ctx) => {
        const f = (ctx.num('rpm') / 60) * pos(ctx, 'ppr');
        const vcc = `V(${ctx.node('VCC')},${ctx.node('GND')})`;
        const a = internalNode(ctx, 'a');
        const b = internalNode(ctx, 'b');
        const w = ex(2 * Math.PI * f);
        return {
          elements: [
            elB(ctx.name('B', 'a'), a, ctx.node('GND'), 'V', `${vcc}*(0.5+0.5*tanh(30*sin(${w}*time)))`),
            elB(ctx.name('B', 'b'), b, ctx.node('GND'), 'V', `${vcc}*(0.5+0.5*tanh(30*sin(${w}*time-1.5707963)))`),
            elR(ctx.name('R', 'a'), a, ctx.node('A'), 100),
            elR(ctx.name('R', 'b'), b, ctx.node('B'), 100),
            elR(ctx.name('R', 'q'), ctx.node('VCC'), ctx.node('GND'), 1e3),
          ],
        };
      },
      provenance: 'Ideal quadrature encoder signals (published theory), smooth edges',
      footprint: 'ENC-4P',
      keywords: ['encoder', 'quadrature', 'rotary', 'speed sensor', 'interactive'],
    },
    sensorMeta("Encoder tăng dần cầu phương: ngõ ra A và B (0 / VCC, B trễ A 90°) với tần số = tốc độ × số xung mỗi vòng; phím 'S' thay đổi tốc độ", 'Encoder tăng dần'),
  ),
];

// ---------------------------------------------------------------------------------------------
// vacuum tubes (Koren)

interface TriodeK {
  mu: number;
  ex: number;
  kg1: number;
  kp: number;
  kvb: number;
  cgk: number;
  cgp: number;
  cpk: number;
}

const TRIODE_SYMBOL: SymbolDef = makeSymbol(
  [circle(0, 0, 20), line(0, -30, 0, -14), line(-8, -14, 8, -14, 2), line(-30, 0, -10, 0), line(-10, 0, -6, 0), line(-4, 0, 0, 0), line(2, 0, 6, 0), line(8, 0, 12, 0), poly([-10, 14, -10, 10, 10, 10, 10, 14]), line(-10, 14, -10, 30)],
  [pin('P', 0, -30, 'up', { number: '1' }), pin('G', -30, 0, 'left', { number: '2', type: 'input' }), pin('K', -10, 30, 'down', { number: '3' })],
  { refPos: { x: 24, y: -14 }, valuePos: { x: 24, y: 18 } },
);

const PENTODE_SYMBOL: SymbolDef = makeSymbol(
  [circle(0, 0, 22), line(0, -30, 0, -16), line(-8, -16, 8, -16, 2), line(-30, 0, -8, 0), line(-6, 0, -2, 0), line(2, 0, 6, 0), line(-30, -8, -12, -8), line(-12, -8, -12, -6), line(-10, -6, -6, -6), line(-2, -6, 2, -6), line(6, -6, 10, -6), poly([-10, 14, -10, 10, 10, 10, 10, 14]), line(-10, 14, -10, 30), line(-8, 6, 8, 6)],
  [pin('P', 0, -30, 'up', { number: '3' }), pin('G2', -30, -10, 'left', { number: '4' }), pin('G1', -30, 0, 'left', { number: '5', type: 'input' }), pin('K', -10, 30, 'down', { number: '8' })],
  { refPos: { x: 26, y: -14 }, valuePos: { x: 26, y: 18 } },
);

/** Numerically safe softplus ln(1 + e^x) for expressions. */
const softplus = (x: string) => `(max(${x},0)+ln(1+exp(-abs(${x}))))`;

function triodeElements(ctx: ToSpiceContext, k: TriodeK): ElementIR[] {
  const p = ctx.node('P');
  const g = ctx.node('G');
  const kk = ctx.node('K');
  const vp = `V(${p},${kk})`;
  const vg = `V(${g},${kk})`;
  const e1 = `(max(${vp},0)/${ex(k.kp)}*${softplus(`${ex(k.kp)}*(${ex(1 / k.mu)}+${vg}/sqrt(${ex(k.kvb)}+${vp}*${vp}))`)})`;
  return [
    elB(ctx.name('B', 'p'), p, kk, 'I', `2*pwr(max(${e1},0),${ex(k.ex)})/${ex(k.kg1)}`),
    elC(ctx.name('C', 'gk'), g, kk, k.cgk),
    elC(ctx.name('C', 'gp'), g, p, k.cgp),
    elC(ctx.name('C', 'pk'), p, kk, k.cpk),
    elD(ctx.name('D', 'g'), g, kk, 'MS_TUBE_GRID'),
    elR(ctx.name('R', 'pk'), p, kk, 1e9),
  ];
}

const GRID_MODEL = card('MS_TUBE_GRID', 'D', { is: 1e-10, n: 1.2, rs: 2000 });

const TRIODES: [pn: string, desc: string, k: TriodeK][] = [
  ['12AX7', 'High-µ twin triode (one section), µ ≈ 100, preamplifier stages', { mu: 100, ex: 1.4, kg1: 1060, kp: 600, kvb: 300, cgk: 2.3e-12, cgp: 2.4e-12, cpk: 0.9e-12 }],
  ['ECC83', 'High-µ twin triode (one section), µ ≈ 100 (European designation of the 12AX7)', { mu: 100, ex: 1.4, kg1: 1060, kp: 600, kvb: 300, cgk: 2.3e-12, cgp: 2.4e-12, cpk: 0.9e-12 }],
  ['12AU7', 'Medium-µ twin triode (one section), µ ≈ 20, drivers and cathode followers', { mu: 21.5, ex: 1.3, kg1: 1180, kp: 84, kvb: 300, cgk: 2.3e-12, cgp: 2.2e-12, cpk: 1.0e-12 }],
  ['ECC82', 'Medium-µ twin triode (one section), µ ≈ 20 (European designation of the 12AU7)', { mu: 21.5, ex: 1.3, kg1: 1180, kp: 84, kvb: 300, cgk: 2.3e-12, cgp: 2.2e-12, cpk: 1.0e-12 }],
  ['12AT7', 'High-gm twin triode (one section), µ ≈ 60, phase inverters and RF stages', { mu: 60, ex: 1.35, kg1: 460, kp: 300, kvb: 300, cgk: 2.7e-12, cgp: 2.2e-12, cpk: 1.0e-12 }],
  ['ECC81', 'High-gm twin triode (one section), µ ≈ 60 (European designation of the 12AT7)', { mu: 60, ex: 1.35, kg1: 460, kp: 300, kvb: 300, cgk: 2.7e-12, cgp: 2.2e-12, cpk: 1.0e-12 }],
  ['6DJ8', 'Frame-grid twin triode (one section), µ ≈ 28, low noise', { mu: 28, ex: 1.3, kg1: 330, kp: 320, kvb: 300, cgk: 3.3e-12, cgp: 1.4e-12, cpk: 0.2e-12 }],
  ['ECC88', 'Frame-grid twin triode (one section), µ ≈ 28 (European designation of the 6DJ8)', { mu: 28, ex: 1.3, kg1: 330, kp: 320, kvb: 300, cgk: 3.3e-12, cgp: 1.4e-12, cpk: 0.2e-12 }],
  ['6SN7', 'Medium-µ twin triode (one section, octal), µ ≈ 20', { mu: 20, ex: 1.4, kg1: 1600, kp: 120, kvb: 300, cgk: 2.4e-12, cgp: 3.9e-12, cpk: 0.7e-12 }],
  ['300B', 'Directly heated power triode, µ ≈ 3.9, single-ended output stages', { mu: 3.95, ex: 1.4, kg1: 1550, kp: 65, kvb: 300, cgk: 9e-12, cgp: 15e-12, cpk: 4.3e-12 }],
];

const triodes: LibraryPartDef[] = TRIODES.map(([pn, desc, k]) =>
  withMeta(
    {
      id: `misc/tube-${pn.toLowerCase()}`,
      name: pn,
      group: 'misc',
      family: 'Vacuum tube',
      description: `${desc}; plate P, grid G, cathode K (heater not modelled)`,
      prefix: 'V',
      symbol: TRIODE_SYMBOL,
      params: [],
      toSpice: (ctx) => ({ elements: triodeElements(ctx, k), models: [GRID_MODEL] }),
      provenance: `Koren triode equations with the ${pn} parameter set µ = ${k.mu}, EX = ${k.ex}, KG1 = ${k.kg1}, KP = ${k.kp}, KVB = ${k.kvb}; grid conduction through 2 kΩ; inter-electrode capacitances from the datasheet`,
      footprint: 'NOVAL-9',
      keywords: [pn.toLowerCase(), 'tube', 'valve', 'triode', 'vacuum tube', 'audio'],
    },
    { vi: `${desc.replace('High-µ twin triode (one section)', 'Đèn đôi ba cực hệ số khuếch đại cao (một nửa)').replace('Medium-µ twin triode (one section)', 'Đèn đôi ba cực hệ số khuếch đại trung bình (một nửa)').replace('High-gm twin triode (one section)', 'Đèn đôi ba cực hỗ dẫn cao (một nửa)').replace('Frame-grid twin triode (one section)', 'Đèn đôi ba cực lưới khung (một nửa)').replace('Directly heated power triode', 'Đèn ba cực công suất đốt trực tiếp')}; anốt P, lưới G, katốt K (không mô phỏng sợi đốt)`, specs: { gain: k.mu, package: 'tube' }, sortKey: k.mu, series: 'Triode' },
  ),
);

interface PentodeK extends TriodeK {
  kg2: number;
}

const PENTODES: [pn: string, desc: string, descVi: string, k: PentodeK][] = [
  ['EL34', 'Power pentode, ≈ 25 W per tube in push-pull', 'Đèn năm cực công suất, ≈ 25 W mỗi đèn khi đẩy kéo', { mu: 11, ex: 1.35, kg1: 650, kg2: 4200, kp: 60, kvb: 24, cgk: 15e-12, cgp: 1.1e-12, cpk: 8.4e-12 }],
  ['6L6GC', 'Beam power tetrode, ≈ 30 W per tube in push-pull', 'Đèn bốn cực chùm tia công suất, ≈ 30 W mỗi đèn khi đẩy kéo', { mu: 8.7, ex: 1.35, kg1: 1460, kg2: 4500, kp: 48, kvb: 12, cgk: 10e-12, cgp: 0.6e-12, cpk: 6.5e-12 }],
  ['EL84', 'Small power pentode, ≈ 6 W per tube', 'Đèn năm cực công suất nhỏ, ≈ 6 W mỗi đèn', { mu: 19, ex: 1.35, kg1: 600, kg2: 4500, kp: 200, kvb: 16, cgk: 10.8e-12, cgp: 0.5e-12, cpk: 6.5e-12 }],
  ['6V6GT', 'Beam power tetrode, ≈ 5 W single-ended', 'Đèn bốn cực chùm tia công suất, ≈ 5 W đơn đầu', { mu: 9.6, ex: 1.35, kg1: 1950, kg2: 4500, kp: 45, kvb: 12, cgk: 9e-12, cgp: 0.7e-12, cpk: 7.5e-12 }],
  ['KT88', 'Beam power tetrode, ≈ 50 W per tube in push-pull', 'Đèn bốn cực chùm tia công suất, ≈ 50 W mỗi đèn khi đẩy kéo', { mu: 8.8, ex: 1.35, kg1: 730, kg2: 4200, kp: 32, kvb: 16, cgk: 16e-12, cgp: 1.2e-12, cpk: 12e-12 }],
  ['6550', 'Beam power tetrode, ≈ 50 W per tube in push-pull', 'Đèn bốn cực chùm tia công suất, ≈ 50 W mỗi đèn khi đẩy kéo', { mu: 7.9, ex: 1.35, kg1: 890, kg2: 4800, kp: 60, kvb: 24, cgk: 14e-12, cgp: 0.85e-12, cpk: 12e-12 }],
];

const pentodes: LibraryPartDef[] = PENTODES.map(([pn, desc, descVi, k]) =>
  withMeta(
    {
      id: `misc/tube-${pn.toLowerCase()}`,
      name: pn,
      group: 'misc',
      family: 'Vacuum tube',
      description: `${desc}; plate P, screen G2, control grid G1, cathode K (suppressor tied to K, heater not modelled)`,
      prefix: 'V',
      symbol: PENTODE_SYMBOL,
      params: [],
      toSpice: (ctx) => {
        const p = ctx.node('P');
        const g2 = ctx.node('G2');
        const g1 = ctx.node('G1');
        const kk = ctx.node('K');
        const vg2 = `max(V(${g2},${kk}),1e-3)`;
        const vg1 = `V(${g1},${kk})`;
        const e1 = `(${vg2}/${ex(k.kp)}*${softplus(`${ex(k.kp)}*(${ex(1 / k.mu)}+${vg1}/${vg2})`)})`;
        return {
          elements: [
            elB(ctx.name('B', 'p'), p, kk, 'I', `2*pwr(max(${e1},0),${ex(k.ex)})/${ex(k.kg1)}*atan(max(V(${p},${kk}),0)/${ex(k.kvb)})`),
            elB(ctx.name('B', 's'), g2, kk, 'I', `pwr(max(${vg2}/${ex(k.mu)}+${vg1},0),${ex(k.ex)})/${ex(k.kg2)}`),
            elC(ctx.name('C', 'gk'), g1, kk, k.cgk),
            elC(ctx.name('C', 'gp'), g1, p, k.cgp),
            elC(ctx.name('C', 'pk'), p, kk, k.cpk),
            elD(ctx.name('D', 'g'), g1, kk, GRID_MODEL.name),
            elR(ctx.name('R', 'pk'), p, kk, 1e9),
            elR(ctx.name('R', 'sk'), g2, kk, 1e9),
          ],
          models: [GRID_MODEL],
        };
      },
      provenance: `Koren pentode equations with the ${pn} parameter set µ = ${k.mu}, EX = ${k.ex}, KG1 = ${k.kg1}, KG2 = ${k.kg2}, KP = ${k.kp}, KVB = ${k.kvb}`,
      footprint: 'OCTAL-8',
      keywords: [pn.toLowerCase(), 'tube', 'valve', 'pentode', 'power tube', 'audio'],
    },
    { vi: `${descVi}; anốt P, lưới màn G2, lưới điều khiển G1, katốt K (lưới triệt nối K, không mô phỏng sợi đốt)`, specs: { gain: k.mu, package: 'tube' }, sortKey: 1000 + k.mu, series: 'Pentode' },
  ),
);

export const SENSOR_CATALOG: LibraryPartDef[] = [...rtds, ...thermocouples, ...tempIcs, lm335, ...magnetic, ...pressure, ...light, ...ldrs, ...position, ...triodes, ...pentodes];

/** Round 4 (library breadth): the parameter helpers, for the extra sensor tables (catalog/more/sensorsMore.ts). */
export { slider, keyParam, stepParam, sensorMeta, IC3_SYMBOL };
