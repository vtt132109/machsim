/**
 * Mechatronics parts: a machine on the schematic, driven by the circuit.
 *
 * Five models (src/mecha/models.ts), each placed like any other part and simulated by the
 * `A_MECHA` code model (src/sim/devices/digital/mecha.ts):
 *   conveyor  belt with two item sensors
 *   junction  signalled road junction that checks its own six lamps
 *   tank      liquid tank with a pump, a drain valve, two level switches and a level transmitter
 *   door      garage door with limit switches and a light barrier
 *   lift      three-floor lift with floor sensors and a door
 *
 * Pins
 *   the input pins are driven by the circuit (a PLC output module, a relay contact, a transistor);
 *   the sensor pins answer with the output voltage of the part (0 / `vout`, or `vref` × the
 *   measured fraction for the tank's level transmitter), so they can be wired straight into a PLC
 *   input module, a logic gate or a comparator. COM is the common the whole part is referred to.
 *
 * The state the drawing animates (belt travel, item positions, level, door and car position …)
 * also lives on internal nodes, 1 V per unit, so it can be plotted in the Grapher: the level of
 * tank TK1 is V(TK1.percent).
 *
 * Original artwork and models: plain line drawings and the ordinary equations of a belt, an
 * outflow and a travelling door. No artwork, data or front panel of any product is used.
 */
import { createMecha, mechaNodeCount, type MechaSpec } from '../../mecha/models';
import {
  boolParam,
  card,
  elR,
  hash8,
  internalNode,
  internalNodeName,
  numParam,
  selectParam,
  type IndicatorChannels,
  type InstrumentBindContext,
  type LibraryPartDef,
} from '../partkit';
import type { ParamDef, PinDef, SymbolDef, SymbolPrim, ToSpiceContext } from '../types';
import { circle, line, makeSymbol, pin, poly, rect, text } from '../symbols';
import { withMeta } from './kit';

/** Spec of a model kind (the model is built once with its defaults just to read the pin list). */
function specOf(kind: string): MechaSpec {
  const m = createMecha(kind, (_k, d) => d);
  if (!m) throw new Error(`mecha: unknown model '${kind}'`);
  return m.spec;
}

interface BuildOpts {
  title: string;
  /** body size */
  w: number;
  h: number;
  /** artwork inside the body */
  art: SymbolPrim[];
  /** area the animation draws in (part-local) */
  screen: { x: number; y: number; w: number; h: number };
  /** pins on the left, in order (names of spec.inputs) */
  left: string[];
  /** pins on the right, in order */
  right: string[];
  /** extra pins along the bottom, after COM */
  bottom?: string[];
  /** label shown next to a pin (default: the pin name) */
  labels?: Record<string, string>;
}

/**
 * Body rectangle with the input pins on the left, the sensor pins on the right and COM (plus any
 * further pins) below. `w` and `h` must be multiples of 20 so every pin lands on the 10-unit grid.
 *
 * The ELECTRICAL kind of a pin comes from the model (`spec.inputs` / `spec.outputs`), never from
 * the side it is drawn on: the junction's six lamp pins are model inputs although three of them
 * sit on the right of the body, and the ERC pin-type matrix (src/model/ercMatrix.ts) would
 * otherwise read them as a second driver fighting the PLC output that lights the lamp.
 */
function mechaSymbol(o: BuildOpts, spec: MechaSpec): SymbolDef {
  const hw = o.w / 2;
  const hh = o.h / 2;
  const prims: SymbolPrim[] = [rect(-hw, -hh, o.w, o.h), text(0, -hh + 12, o.title, 9, 'middle', true), ...o.art];
  const pins: PinDef[] = [];
  const driven = new Set(spec.inputs);
  const pinType = (name: string): PinDef['type'] => (name === 'COM' ? 'power' : driven.has(name) ? 'input' : 'output');
  const spread = (names: string[], side: 'left' | 'right') => {
    const n = names.length;
    const y0 = -((n - 1) * 20) / 2;
    names.forEach((name, i) => {
      const y = y0 + 20 * i;
      const bx = side === 'left' ? -hw : hw;
      const x = side === 'left' ? -hw - 10 : hw + 10;
      prims.push(line(x, y, bx, y));
      pins.push(pin(name, x, y, side, { label: o.labels?.[name] ?? name, type: pinType(name) }));
    });
  };
  spread(o.left, 'left');
  spread(o.right, 'right');
  const below = ['COM', ...(o.bottom ?? [])];
  const x0 = -((below.length - 1) * 40) / 2;
  below.forEach((name, i) => {
    const x = x0 + 40 * i;
    prims.push(line(x, hh, x, hh + 10));
    pins.push(pin(name, x, hh + 10, 'down', { label: o.labels?.[name] ?? name, type: pinType(name) }));
  });
  return makeSymbol(prims, pins, { refPos: { x: -hw, y: -hh - 8 }, valuePos: { x: hw, y: hh + 24 } });
}

/** Common electrical parameters of every mechatronics part. */
function commonParams(analog: boolean): ParamDef[] {
  const out: ParamDef[] = [
    numParam('vout', 'Sensor voltage', '24', 'V', { min: 1, max: 300, group: 'model', help: 'Voltage a closed sensor pin drives against COM (0 V when it is open)' }),
  ];
  if (analog) out.push(numParam('vref', 'Analog full scale', '10', 'V', { min: 0.1, max: 300, group: 'model', help: 'Voltage the analog pin gives when the measured value is at its maximum' }));
  out.push(
    numParam('vth', 'Input threshold', '12', 'V', { min: 0.5, max: 300, group: 'model', help: 'An input pin counts as ON above this voltage' }),
    numParam('rin', 'Input load', '1M', 'Ω', { min: 1, group: 'advanced', help: 'Load every input pin puts on its driver (a lamp pin of the junction can be given a real lamp resistance here)' }),
    numParam('tmax', 'Time step', '10m', 's', { min: 1e-5, max: 1, group: 'advanced', help: 'Longest step the machine is advanced by: smaller means the sensors switch more exactly and the drawing moves more smoothly' }),
    boolParam('debug', 'Live drawing', true, { group: 'advanced', help: 'Record the state of the machine so the schematic animates it while the simulation runs' }),
  );
  return out;
}

/** `A_MECHA` element of a part: inputs, sensor pins, report nodes, then COM as the reference. */
function mechaToSpice(kind: string, spec: MechaSpec, numeric: string[]): NonNullable<LibraryPartDef['toSpice']> {
  return (ctx: ToSpiceContext) => {
    const params: Record<string, number> = {};
    for (const key of numeric) params[key] = ctx.num(key);
    const nodes = [
      ...spec.inputs.map((p) => ctx.node(p)),
      ...spec.outputs.map((o) => ctx.node(o.name)),
      ...spec.reports.map((r) => internalNode(ctx, r.toLowerCase())),
      ctx.node('COM'),
    ];
    const debug = (ctx.params.debug ?? 'true').trim().toLowerCase() !== 'false';
    const model = card(`MS_MECHA_${kind}_${hash8(`${kind};${numeric.map((k) => `${k}=${params[k]}`).join(';')};${debug}`)}`, 'A_MECHA', {
      ...params,
      vhys: Math.max(0.1, params.vout !== undefined ? params.vout / 10 : 2),
      debug: debug ? 1 : 0,
    });
    const withKind = { ...model, stringParams: { kind } };
    return {
      elements: [
        { type: 'A' as const, name: ctx.name('A'), nodes, model: withKind.name, params: { pwr: 1 } },
        // the report nodes only carry a read-out: a high resistance to the common keeps the
        // matrix regular even when nothing else touches them
        ...spec.reports.map((r, i) => elR(ctx.name('R', `rep${i}`), internalNode(ctx, r.toLowerCase()), ctx.node('COM'), 1e7)),
      ],
      models: [withKind],
    };
  };
}

/**
 * Every signal the drawing follows: the input pins (lamps, commands), the sensor pins and the
 * report nodes, in that order — the glyph of each scene knows what its own indices mean.
 */
function mechaIndicator(spec: MechaSpec): (ctx: InstrumentBindContext) => IndicatorChannels | null {
  return (ctx) => {
    const com = ctx.net('COM') ?? '0';
    const volt = (node: string) => ({ kind: 'voltage' as const, pos: node, neg: com });
    const signals = [
      ...spec.inputs.map((p) => volt(ctx.net(p) ?? '0')),
      ...spec.outputs.map((o) => volt(ctx.net(o.name) ?? '0')),
      ...spec.reports.map((r) => volt(internalNodeName(ctx.refdes, r.toLowerCase()))),
    ];
    return { signal: signals[0], signals };
  };
}

interface MechaPartOpts extends BuildOpts {
  id: string;
  kind: string;
  name: string;
  nameVi: string;
  description: string;
  vi: string;
  prefix: string;
  params: ParamDef[];
  analog?: boolean;
  keywords: string[];
}

function mechaPart(o: MechaPartOpts): LibraryPartDef {
  const spec = specOf(o.kind);
  const params = [...o.params, ...commonParams(!!o.analog)];
  const numeric = params.filter((p) => p.kind === 'number').map((p) => p.key);
  const slots = mechaNodeCount(spec);
  return withMeta(
    {
      id: o.id,
      name: o.name,
      group: 'misc',
      family: 'Mechatronics',
      description: o.description,
      prefix: o.prefix,
      symbol: mechaSymbol(o, spec),
      params,
      toSpice: mechaToSpice(o.kind, spec, numeric),
      bindIndicator: mechaIndicator(spec),
      indicator: { kind: 'mecha', scene: o.kind, slots, screen: o.screen },
      mecha: { kind: o.kind },
      virtual: true,
      optionalPins: [...spec.inputs, ...spec.outputs.map((s) => s.name)],
      groundWhenOpen: ['COM'],
      keywords: ['mechatronics', 'co dien tu', 'mo hinh', 'plc', ...o.keywords],
      provenance: 'MachSim original model: ordinary mechanics (constant speed, Torricelli outflow, constant travel time); no data of any product',
    },
    { vi: o.vi, nameVi: o.nameVi, series: 'Mechatronics' },
  );
}

// ---------------------------------------------------------------------------------------------
// the five machines
// ---------------------------------------------------------------------------------------------

function conveyorArt(): SymbolPrim[] {
  return [
    circle(-80, 10, 12),
    circle(80, 10, 12),
    line(-80, -2, 80, -2),
    line(-80, 22, 80, 22),
    // the two sensors look down on the belt
    poly([-40, -24, -34, -12, -46, -12], true),
    poly([50, -24, 56, -12, 44, -12], true),
    text(-40, -28, 'S1', 7),
    text(50, -28, 'S2', 7),
  ];
}

function tankArt(): SymbolPrim[] {
  return [
    rect(-34, -22, 68, 62),
    line(-34, -8, -40, -8),
    text(-46, -5, 'H', 7, 'end'),
    line(-34, 26, -40, 26),
    text(-46, 29, 'L', 7, 'end'),
  ];
}

function doorArt(): SymbolPrim[] {
  return [
    line(-46, -18, -46, 36),
    line(46, -18, 46, 36),
    line(-46, 36, 46, 36),
    line(-50, -18, 50, -18),
    // light barrier across the opening
    line(-46, 30, -52, 30),
    line(46, 30, 52, 30),
  ];
}

function liftArt(): SymbolPrim[] {
  const art: SymbolPrim[] = [rect(-26, -20, 52, 76)];
  for (let k = 0; k < 3; k++) {
    const y = 48 - 24 * k;
    art.push(line(-32, y, -26, y), text(-36, y + 3, String(k + 1), 7, 'end'));
  }
  return art;
}

function junctionArt(): SymbolPrim[] {
  const art: SymbolPrim[] = [];
  const head = (x: number, label: string) => {
    art.push(rect(x - 11, -18, 22, 56, undefined, 3), text(x, 46, label, 7));
    for (let k = 0; k < 3; k++) art.push(circle(x, -6 + 16 * k, 6));
  };
  head(-34, 'B–N');
  head(34, 'Đ–T');
  return art;
}

const CONVEYOR = mechaPart({
  id: 'misc/conveyor-belt',
  kind: 'conveyor',
  name: 'Conveyor belt with item sensors',
  nameVi: 'Băng tải có cảm biến vật',
  prefix: 'MB',
  title: 'BĂNG TẢI',
  w: 220,
  h: 80,
  art: conveyorArt(),
  screen: { x: -92, y: -18, w: 184, h: 36 },
  left: ['RUN', 'REV', 'FEED'],
  right: ['S1', 'S2'],
  labels: { RUN: 'RUN ▶', REV: 'REV ◀', FEED: 'FEED', S1: 'S1', S2: 'S2' },
  description:
    'Conveyor belt that carries items past two photo-electric sensors. RUN drives it forward, REV backwards; while it runs it drops a new item on every "feed interval" seconds (switch that off and use the FEED pin instead, one item per rising edge). ' +
    'S1 and S2 answer with the sensor voltage while an item covers them, so they wire straight into a PLC input module or a counter. The drawing shows the items moving and the sensors lighting up.',
  vi:
    'Băng tải chở vật đi qua hai cảm biến quang. Chân RUN cho chạy xuôi, REV cho chạy ngược; khi đang chạy, cứ sau “chu kỳ cấp vật” giây lại có một vật mới được đặt lên (tắt chế độ này thì dùng chân FEED, mỗi sườn lên là một vật). ' +
    'S1 và S2 phát ra điện áp cảm biến khi có vật che, nối thẳng được vào mô-đun vào của PLC hay vào bộ đếm. Trên sơ đồ, vật chạy và cảm biến sáng lên theo thời gian thực.',
  keywords: ['conveyor', 'belt', 'bang tai', 'cam bien vat', 'dem san pham'],
  params: [
    numParam('length', 'Belt length', '2', 'm', { min: 0.1, max: 50, help: 'Length of the belt from the feed end to the drop end' }),
    numParam('speed', 'Belt speed', '250m', 'm/s', { min: 1e-3, max: 10, help: 'Speed while the motor runs' }),
    numParam('s1', 'Sensor 1 position', '500m', 'm', { min: 0, help: 'Distance of the first sensor from the feed end' }),
    numParam('s2', 'Sensor 2 position', '1.5', 'm', { min: 0, help: 'Distance of the second sensor from the feed end' }),
    numParam('window', 'Sensor window', '120m', 'm', { min: 0.01, help: 'How wide an item looks to a sensor (the sensor is on while the item is inside this window)' }),
    numParam('spacing', 'Item spacing', '500m', 'm', { min: 0.01, help: 'An item is only put on when the previous one has moved at least this far' }),
    selectParam('feed', 'Feeding', '1', [['1', 'Automatic, every feed interval'], ['0', 'From the FEED pin']], { help: 'Where the items come from' }),
    numParam('tfeed', 'Feed interval', '3', 's', { min: 0.05, help: 'Time between two items in automatic feeding' }),
  ],
});

const JUNCTION = mechaPart({
  id: 'misc/traffic-junction',
  kind: 'junction',
  name: 'Traffic-light junction (two directions)',
  nameVi: 'Nút giao thông hai chiều (đèn tín hiệu)',
  prefix: 'MJ',
  title: 'NÚT GIAO',
  w: 160,
  h: 80,
  art: junctionArt(),
  screen: { x: -70, y: -24, w: 140, h: 68 },
  left: ['NSR', 'NSY', 'NSG'],
  right: ['EWR', 'EWY', 'EWG'],
  bottom: ['ERR'],
  labels: { NSR: 'B–N đỏ', NSY: 'B–N vàng', NSG: 'B–N xanh', EWR: 'Đ–T đỏ', EWY: 'Đ–T vàng', EWG: 'Đ–T xanh' },
  description:
    'Road junction with two signal heads: six lamp pins (red / amber / green for the north–south and the east–west direction). Each pin loads its driver like a lamp and lights its lamp in the drawing. ' +
    'The junction checks itself: if both directions show green, or a direction shows no lamp at all, for longer than the fault time, the ERR pin goes high — the mistake every first traffic-light program makes.',
  vi:
    'Nút giao thông có hai cột đèn: sáu chân đèn (đỏ / vàng / xanh cho chiều Bắc–Nam và chiều Đông–Tây). Mỗi chân là một tải đèn thật đối với mạch điều khiển và làm sáng đèn tương ứng trên sơ đồ. ' +
    'Nút giao tự kiểm tra: nếu cả hai chiều cùng xanh, hoặc một chiều không sáng đèn nào, lâu hơn “thời gian báo lỗi” thì chân ERR lên mức cao — đúng lỗi mà chương trình đèn giao thông đầu tiên nào cũng mắc.',
  keywords: ['traffic', 'light', 'junction', 'den giao thong', 'nut giao', 'tin hieu'],
  params: [numParam('tfault', 'Fault time', '300m', 's', { min: 0, max: 10, help: 'How long an unsafe combination of lamps may last before ERR goes high (a short overlap during a change is allowed)' })],
});

const TANK = mechaPart({
  id: 'misc/water-tank',
  kind: 'tank',
  name: 'Liquid tank with pump and valve',
  nameVi: 'Bồn nước có bơm và van xả',
  prefix: 'MT',
  title: 'BỒN NƯỚC',
  w: 140,
  h: 100,
  art: tankArt(),
  screen: { x: -34, y: -22, w: 68, h: 62 },
  left: ['PUMP', 'VALVE'],
  right: ['LOW', 'HIGH', 'LEVEL'],
  labels: { PUMP: 'BƠM', VALVE: 'VAN XẢ', LOW: 'LOW', HIGH: 'HIGH', LEVEL: 'LEVEL' },
  analog: true,
  description:
    'Liquid tank with a filling pump and a drain valve. PUMP delivers a constant flow; the open VALVE drains with Torricelli\'s law (√level), so the tank empties slowly at the end. ' +
    'LOW and HIGH are the two float switches (on while the liquid stands above them) and LEVEL is a level transmitter: 0 V when empty, the analog full scale when full. The tank in the drawing fills and empties while the simulation runs.',
  vi:
    'Bồn chất lỏng có bơm cấp và van xả. Chân BƠM cho lưu lượng vào không đổi; van xả mở thì chảy ra theo định luật Torricelli (tỉ lệ √mức), nên cuối cùng bồn cạn chậm dần. ' +
    'LOW và HIGH là hai công tắc phao (đóng khi nước cao hơn vị trí của chúng), còn LEVEL là cảm biến mức: 0 V khi cạn, bằng “thang đo tương tự” khi đầy. Mức nước trên sơ đồ dâng và hạ ngay khi mô phỏng chạy.',
  keywords: ['tank', 'level', 'pump', 'valve', 'bon nuoc', 'muc nuoc', 'bom', 'van'],
  params: [
    numParam('volume', 'Tank volume', '10', 'L', { min: 1e-3, help: 'Litres the tank holds when it is full' }),
    numParam('qin', 'Pump flow', '500m', 'L/s', { min: 0, help: 'Flow the pump delivers while it runs' }),
    numParam('qout', 'Drain flow (full)', '350m', 'L/s', { min: 0, help: 'Flow through the open valve with a full tank; it falls with √level, so the tank empties in 2·volume / this flow' }),
    numParam('low', 'Low switch', '20', '%', { min: 0, max: 100, help: 'Height of the lower float switch as a percentage of the tank' }),
    numParam('high', 'High switch', '80', '%', { min: 0, max: 100, help: 'Height of the upper float switch' }),
    numParam('start', 'Level at the start', '0', '%', { min: 0, max: 100, help: 'How full the tank is when the simulation starts' }),
  ],
});

const DOOR = mechaPart({
  id: 'misc/garage-door',
  kind: 'door',
  name: 'Garage door with limit switches',
  nameVi: 'Cửa cuốn có công tắc hành trình',
  prefix: 'MD',
  title: 'CỬA CUỐN',
  w: 140,
  h: 80,
  art: doorArt(),
  screen: { x: -46, y: -18, w: 92, h: 54 },
  left: ['UP', 'DOWN'],
  right: ['OPEN', 'CLOSED', 'BEAM'],
  labels: { UP: 'MỞ ▲', DOWN: 'ĐÓNG ▼', OPEN: 'OPEN', CLOSED: 'CLOSED', BEAM: 'BEAM' },
  description:
    'Garage door driven by two contactors. UP opens it, DOWN closes it, and the whole travel takes the travel time. OPEN and CLOSED are the limit switches. BEAM is the light barrier across the opening: it is high while the way is clear and low while something is in it — and a door that is closing then goes back up by itself. ' +
    'UP and DOWN together is a wiring mistake: the door stops (a reversing pair is interlocked) and the drawing says so.',
  vi:
    'Cửa cuốn do hai khởi động từ điều khiển. Chân MỞ cho cửa đi lên, ĐÓNG cho cửa đi xuống, đi hết hành trình mất “thời gian hành trình” giây. OPEN và CLOSED là hai công tắc hành trình. BEAM là mắt thần chắn ngang lối đi: mức cao khi thông thoáng, mức thấp khi có vật — và cửa đang đóng sẽ tự đi lên trở lại. ' +
    'Cấp điện đồng thời MỞ và ĐÓNG là lỗi đấu dây: cửa đứng lại (cặp đảo chiều luôn khoá chéo nhau) và sơ đồ báo điều đó.',
  keywords: ['door', 'garage', 'limit switch', 'cua cuon', 'cong tac hanh trinh', 'mat than'],
  params: [
    numParam('ttravel', 'Travel time', '5', 's', { min: 0.1, help: 'Time the door needs from fully closed to fully open' }),
    numParam('start', 'Position at the start', '0', '%', { min: 0, max: 100, help: '0 = closed, 100 = open' }),
    numParam('tobs', 'Obstacle appears at', '0', 's', { min: 0, help: 'Time an obstacle breaks the light barrier (0 = never)' }),
    numParam('dobs', 'Obstacle stays', '2', 's', { min: 0, help: 'How long the obstacle stays in the way' }),
  ],
});

const LIFT = mechaPart({
  id: 'misc/lift-3',
  kind: 'lift',
  name: 'Lift, three floors',
  nameVi: 'Thang máy ba tầng',
  prefix: 'ML',
  title: 'THANG MÁY',
  w: 160,
  h: 120,
  art: liftArt(),
  screen: { x: -26, y: -20, w: 52, h: 76 },
  left: ['UP', 'DOWN', 'DOOR'],
  right: ['F1', 'F2', 'F3', 'DOPEN'],
  labels: { UP: 'LÊN ▲', DOWN: 'XUỐNG ▼', DOOR: 'MỞ CỬA', F1: 'F1', F2: 'F2', F3: 'F3', DOPEN: 'DOPEN' },
  description:
    'Lift car in a three-floor shaft. UP and DOWN are the hoist contactors, DOOR opens the door while it is high. F1 … F3 are the floor sensors and DOPEN says the door is fully open. ' +
    'The hoist is interlocked: the car does not move while the door is not fully closed, and UP with DOWN stops it — the two mistakes a first lift program makes. The drawing shows the car and the door moving.',
  vi:
    'Cabin thang máy trong giếng ba tầng. Chân LÊN và XUỐNG là hai khởi động từ kéo cabin, chân MỞ CỬA giữ cửa mở khi ở mức cao. F1 … F3 là cảm biến tầng, DOPEN báo cửa đã mở hết. ' +
    'Có khoá liên động: cabin không chạy khi cửa chưa đóng kín, và cấp điện cả LÊN lẫn XUỐNG thì cabin đứng lại — hai lỗi mà chương trình thang máy đầu tiên nào cũng mắc. Trên sơ đồ, cabin và cửa chuyển động theo thời gian thực.',
  keywords: ['lift', 'elevator', 'thang may', 'cabin', 'tang'],
  params: [
    numParam('tfloor', 'Time per floor', '3', 's', { min: 0.1, help: 'Time the car needs to travel one floor' }),
    numParam('tdoor', 'Door time', '1.5', 's', { min: 0.05, help: 'Time the door needs to open (and to close again)' }),
    numParam('window', 'Sensor window', '40m', '', { min: 1e-3, max: 0.4, help: 'How far from the floor the floor sensor already answers, in floors' }),
    numParam('start', 'Floor at the start', '1', '', { min: 1, max: 3, help: 'Floor the car stands on when the simulation starts' }),
  ],
});

export const MECHA_CATALOG: LibraryPartDef[] = [CONVEYOR, JUNCTION, TANK, DOOR, LIFT];
