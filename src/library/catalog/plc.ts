/**
 * Programmable-controller rack: the parts that join a ladder diagram to the schematic.
 *
 * A rack is a **controller** plus **input and output modules**. The modules are the only link
 * between the drawing and the program: an input channel reads the switch, push-button or sensor
 * wired to it, an output channel drives the lamp, contactor or motor wired to it, and an analog
 * input channel reads a voltage (a level transmitter, a potentiometer) that a comparison contact
 * can compare with a number.
 *
 * These parts have no `toSpice` of their own on purpose: the rungs, timers and counters of a
 * ladder sheet are ONE program with ONE state, so the netlister collects every module of the
 * sheet level and builds a single `A_LADDER` element for the whole rack
 * (src/model/ladderBuild.ts). The `ladderIo` marker on each part is what it looks for.
 *
 * Addresses follow the module: channel k of an input module with "address byte" 0 is I0.k, of an
 * output module with byte 1 is Q1.k. The address is printed next to every pin, so the drawing and
 * the ladder program read the same names.
 *
 * Original artwork and data: a plain terminal-block rectangle with the channel addresses, no
 * brand, no part number and no look-alike of any product.
 */
import { numParam, selectParam, boolParam, type LibraryPartDef } from '../partkit';
import type { ParamDef } from '../types';
import { icSymbol, type IcPin } from '../parts/digital/kit';
import { withMeta } from './kit';
import { LADDER_LIMITS } from '../../ladder/types';
import { SCAN_DEFAULT, SCAN_MAX, SCAN_MIN } from '../../ladder/program';

/** Address-byte options of a digital module (I0 … I7 / Q0 … Q7). */
function byteOptions(): [string, string][] {
  return Array.from({ length: LADDER_LIMITS.ioBytes }, (_, k) => [String(k), String(k)] as [string, string]);
}

function byteParam(area: 'I' | 'Q'): ParamDef {
  return selectParam('byte', 'Address byte', '0', byteOptions(), {
    group: 'value',
    showOnSchematic: true,
    help: `First address of the module: byte 0 gives ${area}0.0 … ${area}0.7, byte 1 gives ${area}1.0 … ${area}1.7`,
  });
}

/** Pins of a module, with the ladder address printed as the pin label. */
function channelPins(area: string, n: number, type: IcPin['type']): IcPin[] {
  return Array.from({ length: n }, (_, k) => ({ name: `${area}${k}`, label: `${area}x.${k}`, type }));
}

const COM: IcPin = { name: 'COM', label: 'COM (0 V)', type: 'power' };

function inputModule(channels: number): LibraryPartDef {
  const pins = channelPins('I', channels, 'input');
  const id = `misc-digital/plc-input-${channels}`;
  return withMeta(
    {
      id,
      name: `PLC input module, ${channels} channels`,
      group: 'misc-digital',
      family: 'PLC rack',
      description:
        `Input module of the ladder-diagram controller: ${channels} digital channels I<byte>.0 … I<byte>.${channels - 1}. ` +
        'Wire a switch, a push-button or a sensor between the channel pin and the supply; the channel reads high above the threshold and low below it (with hysteresis), sampled once per scan. ' +
        'COM is the common 0 V of the rack and every module of one rack must share it. Set the address byte to place the channels in the input image.',
      prefix: 'PLCI',
      symbol: icSymbol(`VÀO ${channels}`, pins, [], { w: 100, bottom: [COM] }),
      params: [
        byteParam('I'),
        numParam('vth', 'Input threshold', '12', 'V', { min: 0.5, max: 300, group: 'model', help: 'A channel reads ON above this voltage and OFF below it (half of the supply of a 24 V module)' }),
        numParam('vhys', 'Hysteresis', '4', 'V', { min: 0, max: 100, group: 'model', help: 'Band around the threshold in which the channel keeps its previous value, so a slow or noisy signal does not chatter' }),
      ],
      ladderIo: { kind: 'input', channels, pins: pins.map((p) => p.name), com: 'COM', startParam: 'byte' },
      optionalPins: pins.map((p) => p.name),
      keywords: ['plc', 'ladder', 'input', 'module', 'plc vao', 'mo dun vao', 'bac thang', 'dau vao'],
      provenance: 'MachSim original: a generic IEC 61131-style input module (no brand or part number)',
    },
    {
      vi:
        `Mô-đun vào của bộ điều khiển lập trình (sơ đồ bậc thang): ${channels} kênh số I<byte>.0 … I<byte>.${channels - 1}. ` +
        'Nối công tắc, nút nhấn hay cảm biến giữa chân kênh và nguồn; kênh đọc mức 1 khi điện áp vượt ngưỡng và mức 0 khi thấp hơn (có vùng trễ), lấy mẫu một lần mỗi vòng quét. ' +
        'Chân COM là 0 V dùng chung của cả giá; mọi mô-đun trong một giá phải nối cùng COM. Chọn “byte địa chỉ” để biết kênh nằm ở đâu trong ảnh ngõ vào.',
      nameVi: `Mô-đun vào PLC ${channels} kênh`,
      specs: { positions: channels },
      sortKey: channels,
      series: 'PLC rack',
    },
  );
}

function outputModule(channels: number): LibraryPartDef {
  const pins = channelPins('Q', channels, 'output');
  return withMeta(
    {
      id: `misc-digital/plc-output-${channels}`,
      name: `PLC output module, ${channels} channels`,
      group: 'misc-digital',
      family: 'PLC rack',
      description:
        `Output module of the ladder-diagram controller: ${channels} channels Q<byte>.0 … Q<byte>.${channels - 1}. ` +
        'A channel whose coil is energised drives its pin to the output voltage (24 V by default) against COM, so a lamp, a relay coil or a motor model wired from the pin to COM runs. ' +
        'Set the address byte to place the channels in the output image.',
      prefix: 'PLCQ',
      symbol: icSymbol(`RA ${channels}`, [], pins, { w: 100, bottom: [COM] }),
      params: [
        byteParam('Q'),
        numParam('von', 'Output voltage', '24', 'V', { min: 1, max: 300, group: 'model', help: 'Voltage a switched-on channel drives against COM' }),
        numParam('rout', 'Output resistance', '10', 'Ω', { min: 1e-3, group: 'model', help: 'Series resistance of the switching element (a real transistor output drops a little)' }),
      ],
      ladderIo: { kind: 'output', channels, pins: pins.map((p) => p.name), com: 'COM', startParam: 'byte' },
      optionalPins: pins.map((p) => p.name),
      keywords: ['plc', 'ladder', 'output', 'module', 'plc ra', 'mo dun ra', 'bac thang', 'dau ra', 'coil'],
      provenance: 'MachSim original: a generic IEC 61131-style output module (no brand or part number)',
    },
    {
      vi:
        `Mô-đun ra của bộ điều khiển lập trình: ${channels} kênh Q<byte>.0 … Q<byte>.${channels - 1}. ` +
        'Kênh có cuộn dây được cấp điện sẽ đưa chân của nó lên điện áp ra (mặc định 24 V) so với COM, nên đèn, cuộn dây rơ-le hay mô hình động cơ nối từ chân xuống COM sẽ hoạt động. ' +
        'Chọn “byte địa chỉ” để biết kênh nằm ở đâu trong ảnh ngõ ra.',
      nameVi: `Mô-đun ra PLC ${channels} kênh`,
      specs: { positions: channels },
      sortKey: channels,
      series: 'PLC rack',
    },
  );
}

function analogInputModule(channels: number): LibraryPartDef {
  const pins = channelPins('AI', channels, 'input');
  return withMeta(
    {
      id: `misc-digital/plc-analog-in-${channels}`,
      name: `PLC analog input module, ${channels} channels`,
      group: 'misc-digital',
      family: 'PLC rack',
      description:
        `Analog input module: ${channels} channels AI0 … AI${channels - 1} read the voltage on their pin (against COM) in volts. ` +
        'A comparison contact of the ladder program compares a channel with a number or with another value: "AI0 > 7.5" is the rung of a level, temperature or speed limit. Set the first channel number to place them.',
      prefix: 'PLCA',
      symbol: icSymbol(`AI ${channels}`, pins, [], { w: 110, bottom: [COM] }),
      params: [
        selectParam('chan', 'First channel', '0', Array.from({ length: LADDER_LIMITS.analogInputs }, (_, k) => [String(k), `AI${k}`] as [string, string]), {
          group: 'value',
          showOnSchematic: true,
          help: 'Channel number of the first pin: 0 gives AI0, AI1 …',
        }),
      ],
      ladderIo: { kind: 'analog-input', channels, pins: pins.map((p) => p.name), com: 'COM', startParam: 'chan' },
      optionalPins: pins.map((p) => p.name),
      keywords: ['plc', 'ladder', 'analog', 'input', 'module', 'plc vao tuong tu', 'bac thang', 'ai'],
      provenance: 'MachSim original: a generic IEC 61131-style analog input module (no brand or part number)',
    },
    {
      vi:
        `Mô-đun vào tương tự: ${channels} kênh AI0 … AI${channels - 1} đọc điện áp trên chân của nó (so với COM) theo đơn vị vôn. ` +
        'Tiếp điểm so sánh trong sơ đồ bậc thang so kênh này với một số hay với giá trị khác: “AI0 > 7,5” là một bậc kiểm tra ngưỡng mức nước, nhiệt độ hay tốc độ. Chọn số kênh đầu tiên để biết tên kênh.',
      nameVi: `Mô-đun vào tương tự PLC ${channels} kênh`,
      specs: { positions: channels },
      sortKey: channels,
      series: 'PLC rack',
    },
  );
}

function analogOutputModule(channels: number): LibraryPartDef {
  const pins = channelPins('AQ', channels, 'output');
  return withMeta(
    {
      id: `misc-digital/plc-analog-out-${channels}`,
      name: `PLC analog output module, ${channels} channels`,
      group: 'misc-digital',
      family: 'PLC rack',
      description:
        `Analog output module: ${channels} channels AQ0 … AQ${channels - 1} drive their pin (against COM) to the voltage the ladder program last wrote to them. ` +
        'A MOV, ADD, SUB, MUL or DIV instruction with an AQ destination sets the voltage ("AQ0 = AI0 x 2"), so a ladder program can dim a lamp, set a motor speed reference or follow a level. The output is limited to plus or minus the module range. Set the first channel number to place them.',
      prefix: 'PLCO',
      symbol: icSymbol(`AQ ${channels}`, [], pins, { w: 110, bottom: [COM] }),
      params: [
        selectParam('chan', 'First channel', '0', Array.from({ length: LADDER_LIMITS.analogOutputs }, (_, k) => [String(k), `AQ${k}`] as [string, string]), {
          group: 'value',
          showOnSchematic: true,
          help: 'Channel number of the first pin: 0 gives AQ0, AQ1 …',
        }),
        numParam('vmax', 'Output range', '10', 'V', { min: 0.1, max: 300, group: 'model', help: 'The pin never goes beyond plus or minus this voltage, whatever the program writes' }),
      ],
      ladderIo: { kind: 'analog-output', channels, pins: pins.map((p) => p.name), com: 'COM', startParam: 'chan' },
      optionalPins: pins.map((p) => p.name),
      keywords: ['plc', 'ladder', 'analog', 'output', 'module', 'plc ra tuong tu', 'bac thang', 'aq', 'dac'],
      provenance: 'MachSim original: a generic IEC 61131-style analog output module (no brand or part number)',
    },
    {
      vi:
        `Mô-đun ra tương tự: ${channels} kênh AQ0 … AQ${channels - 1} đưa chân của nó lên đúng điện áp mà chương trình bậc thang vừa ghi vào (so với COM). ` +
        'Lệnh MOV, ADD, SUB, MUL hay DIV có đích là AQ đặt điện áp (“AQ0 = AI0 x 2”), nên chương trình bậc thang có thể điều sáng đèn, đặt tốc độ chuẩn cho động cơ hay bám theo một mức. Điện áp bị giới hạn trong khoảng ± phạm vi của mô-đun. Chọn số kênh đầu tiên để biết tên kênh.',
      nameVi: `Mô-đun ra tương tự PLC ${channels} kênh`,
      specs: { positions: channels },
      sortKey: channels,
      series: 'PLC rack',
    },
  );
}

/** The controller itself: it holds the settings of the whole rack. */
function controller(): LibraryPartDef {
  return withMeta(
    {
      id: 'misc-digital/plc-controller',
      name: 'PLC controller (ladder)',
      group: 'misc-digital',
      family: 'PLC rack',
      description:
        'The controller of a ladder-diagram design: it runs the rungs of every ladder sheet, over and over, at the scan period set here. ' +
        'It has no pins — the input and output modules of the rack are the connection to the circuit. Place one next to the modules so the scan period is saved with the design; without one the default 10 ms period is used.',
      prefix: 'PLC',
      symbol: icSymbol('PLC', [], [], { w: 120, extra: [] }),
      params: [
        numParam('scan', 'Scan period', String(SCAN_DEFAULT), 's', {
          min: SCAN_MIN,
          max: SCAN_MAX,
          group: 'value',
          showOnSchematic: true,
          help: 'Time of one scan: inputs are sampled, every rung is run once and the outputs are written. It is also the resolution of the timers (10 ms is a good value for a learner)',
        }),
        boolParam('debug', 'Live read-outs', true, {
          group: 'advanced',
          help: 'Publish the images, the timers, the counters and which rung carries power as result vectors, so the ladder editor lights up the running program',
        }),
      ],
      ladderIo: { kind: 'cpu', channels: 0, pins: [] },
      virtual: true,
      keywords: ['plc', 'ladder', 'controller', 'cpu', 'bac thang', 'bo dieu khien lap trinh', 'scan', 'quet'],
      provenance: 'MachSim original: a generic IEC 61131-style controller (no brand or part number)',
    },
    {
      vi:
        'Bộ điều khiển của thiết kế sơ đồ bậc thang: nó chạy lần lượt mọi bậc của các trang bậc thang, lặp lại mãi, theo chu kỳ quét đặt ở đây. ' +
        'Linh kiện này không có chân — các mô-đun vào / ra của giá mới là chỗ nối với mạch. Hãy đặt một bộ điều khiển cạnh các mô-đun để chu kỳ quét được lưu trong tệp; nếu không có thì dùng chu kỳ mặc định 10 ms.',
      nameVi: 'Bộ điều khiển PLC (bậc thang)',
      sortKey: 0,
      series: 'PLC rack',
    },
  );
}

export const PLC_CATALOG: LibraryPartDef[] = [
  controller(),
  inputModule(4),
  inputModule(8),
  outputModule(4),
  outputModule(8),
  analogInputModule(2),
  analogOutputModule(2),
];
