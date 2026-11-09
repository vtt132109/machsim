/**
 * Connector catalogue (group Connectors): pin headers 1×N and 2×N, socket headers, screw terminal
 * blocks, wire-to-board connectors, USB, audio / video jacks, RF connectors, D-sub, modular jacks
 * and power connectors / test points / jumpers.
 *
 * Connectors are graphic and BOM parts: each position is a pin with no simulation model (the
 * signal passes through the wires drawn to it); every pin may stay unconnected. The jumper is the
 * exception: a closed jumper conducts (1 mΩ), an open one does not.
 */
import { elR, type LibraryPartDef } from '../partkit';
import { boxSymbol, circle, line, text } from '../symbols';
import type { SymbolDef } from '../types';
import { withMeta } from './kit';

interface ConnSpec {
  id: string;
  name: string;
  nameVi?: string;
  family: string;
  pins: string[];
  /** right-hand column (two-row headers) */
  right?: string[];
  en: string;
  vi: string;
  footprint: string;
  keywords: string[];
  specs?: Record<string, number | string>;
  sortKey?: number;
  terminal?: boolean;
}

function connSymbol(s: ConnSpec): SymbolDef {
  const left = s.pins.map((p, i) => ({ name: p, number: s.right ? String(2 * i + 1) : String(i + 1) }));
  const right = (s.right ?? []).map((p, i) => ({ name: p, number: String(2 * i + 2) }));
  const rows = Math.max(left.length, right.length, 1);
  const extra = s.terminal ? left.map((_, i) => circle(0, -(rows - 1) * 10 + 20 * i, 4)) : [];
  return boxSymbol({ w: right.length ? 40 : 20, h: rows * 20, left, right, extra });
}

function connector(s: ConnSpec): LibraryPartDef {
  return withMeta(
    {
      id: s.id,
      name: s.name,
      group: 'connectors',
      family: s.family,
      description: `${s.en} (graphic / BOM only, no simulation model)`,
      prefix: 'J',
      symbol: connSymbol(s),
      params: [],
      optionalPins: [...s.pins, ...(s.right ?? [])],
      footprint: s.footprint,
      keywords: ['connector', ...s.keywords],
    },
    { vi: `${s.vi} (chỉ để vẽ / lập BOM, không có mô hình mô phỏng)`, nameVi: s.nameVi, specs: { positions: s.pins.length + (s.right?.length ?? 0), ...(s.specs ?? {}) }, sortKey: s.sortKey ?? s.pins.length + (s.right?.length ?? 0), series: s.family },
  );
}

const range = (n: number, from = 1) => Array.from({ length: n }, (_, i) => String(i + from));

const headers1: LibraryPartDef[] = range(40).map((n) => Number(n)).filter((n) => n !== 2 && n !== 3 && n !== 4).map((n) =>
  connector({ id: `connectors/header-${n}`, name: `Pin Header 1×${n}`, family: 'Header', pins: range(n), en: `2.54 mm pin header with ${n} position${n > 1 ? 's' : ''}`, vi: `Hàng chân cắm đực 2.54 mm, ${n} chân`, nameVi: `Hàng chân đực 1×${n}`, footprint: `HDR-1X${n}-2.54`, keywords: ['header', 'pin header', 'male'], specs: { pitch: 2.54 } }),
);

const headers2: LibraryPartDef[] = range(39, 2).map(Number).map((n) =>
  connector({
    id: `connectors/header-2x${n}`,
    name: `Pin Header 2×${n}`,
    family: 'Header',
    pins: range(n).map((i) => String(2 * Number(i) - 1)),
    right: range(n).map((i) => String(2 * Number(i))),
    en: `2.54 mm dual-row pin header, 2×${n} positions (also IDC box header)`,
    vi: `Hàng chân cắm đực hai hàng 2.54 mm, 2×${n} chân (dùng cho cáp dẹt IDC)`,
    nameVi: `Hàng chân đực 2×${n}`,
    footprint: `HDR-2X${n}-2.54`,
    keywords: ['header', 'dual row', 'idc', 'box header'],
    specs: { pitch: 2.54 },
    sortKey: 2 * n,
  }),
);

const sockets: LibraryPartDef[] = range(40).map(Number).map((n) =>
  connector({ id: `connectors/socket-${n}`, name: `Socket Header 1×${n}`, family: 'Socket header', pins: range(n), en: `2.54 mm female socket header with ${n} position${n > 1 ? 's' : ''}`, vi: `Hàng chân cắm cái 2.54 mm, ${n} lỗ`, nameVi: `Hàng chân cái 1×${n}`, footprint: `SKT-1X${n}-2.54`, keywords: ['socket', 'female header'], specs: { pitch: 2.54 } }),
);

const terminals: LibraryPartDef[] = range(10, 4).map(Number).map((n) =>
  connector({ id: `connectors/terminal-${n}`, name: `Terminal Block ${n}-way`, family: 'Terminal block', pins: range(n), en: `5.08 mm screw terminal block with ${n} positions`, vi: `Cầu đấu dây bắt vít 5.08 mm, ${n} vị trí`, nameVi: `Cầu đấu dây ${n} vị trí`, footprint: `TB-${n}P-5.08`, keywords: ['terminal block', 'screw terminal'], specs: { pitch: 5.08 }, terminal: true }),
);

const wtb: LibraryPartDef[] = range(9, 2).map(Number).map((n) =>
  connector({ id: `connectors/wtb-${n}`, name: `Wire-to-Board 2.5 mm ${n}-pin`, family: 'Wire-to-board', pins: range(n), en: `2.5 mm pitch polarised wire-to-board connector, ${n} pins`, vi: `Đầu nối dây với mạch có khoá chiều, bước 2.5 mm, ${n} chân`, nameVi: `Đầu nối dây-mạch 2.5 mm ${n} chân`, footprint: `WTB-${n}P-2.5`, keywords: ['wire to board', 'polarised', 'crimp'], specs: { pitch: 2.5 } }),
);

const SPECIAL: ConnSpec[] = [
  { id: 'connectors/usb-a', name: 'USB Type-A', family: 'USB connector', pins: ['VBUS', 'D-', 'D+', 'GND', 'SHIELD'], en: 'USB Type-A receptacle (USB 2.0)', vi: 'Ổ cắm USB loại A (USB 2.0)', nameVi: 'Ổ USB loại A', footprint: 'USB-A', keywords: ['usb', 'type a'] },
  { id: 'connectors/usb-b', name: 'USB Type-B', family: 'USB connector', pins: ['VBUS', 'D-', 'D+', 'GND', 'SHIELD'], en: 'USB Type-B receptacle (USB 2.0)', vi: 'Ổ cắm USB loại B (USB 2.0)', nameVi: 'Ổ USB loại B', footprint: 'USB-B', keywords: ['usb', 'type b'] },
  { id: 'connectors/usb-mini-b', name: 'USB Mini-B', family: 'USB connector', pins: ['VBUS', 'D-', 'D+', 'ID', 'GND', 'SHIELD'], en: 'USB Mini-B receptacle', vi: 'Ổ cắm USB Mini-B', nameVi: 'Ổ USB Mini-B', footprint: 'USB-MINI-B', keywords: ['usb', 'mini'] },
  { id: 'connectors/usb-micro-b', name: 'USB Micro-B', family: 'USB connector', pins: ['VBUS', 'D-', 'D+', 'ID', 'GND', 'SHIELD'], en: 'USB Micro-B receptacle', vi: 'Ổ cắm USB Micro-B', nameVi: 'Ổ USB Micro-B', footprint: 'USB-MICRO-B', keywords: ['usb', 'micro'] },
  { id: 'connectors/usb-c', name: 'USB Type-C (USB 2.0)', family: 'USB connector', pins: ['VBUS', 'CC1', 'CC2', 'D+', 'D-', 'SBU1', 'SBU2', 'GND', 'SHIELD'], en: 'USB Type-C receptacle, USB 2.0 signals (CC pins need 5.1 kΩ pull-downs for a device)', vi: 'Ổ cắm USB Type-C, tín hiệu USB 2.0 (chân CC cần điện trở 5.1 kΩ kéo xuống cho thiết bị)', nameVi: 'Ổ USB Type-C', footprint: 'USB-C-16P', keywords: ['usb', 'type c', 'usb-c'] },
  { id: 'connectors/dc-jack', name: 'DC Barrel Jack', family: 'Power connector', pins: ['TIP', 'SLEEVE', 'SW'], en: '5.5 / 2.1 mm DC power jack (centre pin TIP, sleeve, switch contact)', vi: 'Giắc nguồn DC 5.5 / 2.1 mm (chân giữa TIP, vỏ SLEEVE, tiếp điểm chuyển SW)', nameVi: 'Giắc nguồn DC', footprint: 'DC-JACK-2.1', keywords: ['dc jack', 'barrel', 'power'] },
  { id: 'connectors/banana-red', name: 'Banana Jack Red', family: 'Power connector', pins: ['1'], en: '4 mm banana jack, red (positive)', vi: 'Cọc cắm chuối 4 mm màu đỏ (cực dương)', nameVi: 'Cọc cắm chuối đỏ', footprint: 'BANANA-4MM', keywords: ['banana', 'binding post', 'red'] },
  { id: 'connectors/banana-black', name: 'Banana Jack Black', family: 'Power connector', pins: ['1'], en: '4 mm banana jack, black (negative / common)', vi: 'Cọc cắm chuối 4 mm màu đen (cực âm / chung)', nameVi: 'Cọc cắm chuối đen', footprint: 'BANANA-4MM', keywords: ['banana', 'binding post', 'black'] },
  { id: 'connectors/test-point', name: 'Test Point', family: 'Power connector', pins: ['1'], en: 'Test point loop for probing', vi: 'Điểm đo (vòng móc que đo)', nameVi: 'Điểm đo', footprint: 'TP-LOOP', keywords: ['test point', 'probe'] },
  { id: 'connectors/audio-35-trs', name: 'Audio Jack 3.5 mm TRS', family: 'Audio/video connector', pins: ['T', 'R', 'S'], en: '3.5 mm stereo audio jack (tip = left, ring = right, sleeve = ground)', vi: 'Giắc âm thanh stereo 3.5 mm (tip = trái, ring = phải, sleeve = đất)', nameVi: 'Giắc âm thanh 3.5 mm TRS', footprint: 'JACK-3.5-TRS', keywords: ['audio', 'jack', '3.5mm', 'stereo'] },
  { id: 'connectors/audio-35-trrs', name: 'Audio Jack 3.5 mm TRRS', family: 'Audio/video connector', pins: ['T', 'R1', 'R2', 'S'], en: '3.5 mm headset jack (left, right, ground, microphone)', vi: 'Giắc tai nghe có micro 3.5 mm (trái, phải, đất, micro)', nameVi: 'Giắc âm thanh 3.5 mm TRRS', footprint: 'JACK-3.5-TRRS', keywords: ['audio', 'jack', 'headset', 'microphone'] },
  { id: 'connectors/audio-635-trs', name: 'Audio Jack 6.35 mm TRS', family: 'Audio/video connector', pins: ['T', 'R', 'S'], en: '6.35 mm (1/4") TRS jack for instruments and balanced lines', vi: 'Giắc 6.35 mm (1/4") TRS cho nhạc cụ và đường cân bằng', nameVi: 'Giắc âm thanh 6.35 mm TRS', footprint: 'JACK-6.35-TRS', keywords: ['audio', 'jack', '6.35mm', 'guitar'] },
  { id: 'connectors/rca', name: 'RCA Jack', family: 'Audio/video connector', pins: ['SIG', 'GND'], en: 'RCA (phono) jack for audio / composite video', vi: 'Giắc RCA (bông sen) cho âm thanh / video tổng hợp', nameVi: 'Giắc RCA', footprint: 'RCA', keywords: ['rca', 'phono', 'audio', 'video'] },
  { id: 'connectors/bnc', name: 'BNC Jack', family: 'RF connector', pins: ['SIG', 'SHIELD'], en: '50 Ω BNC jack (instrument / video cables)', vi: 'Giắc BNC 50 Ω (cáp máy đo / video)', nameVi: 'Giắc BNC', footprint: 'BNC', keywords: ['bnc', 'coax', 'rf'] },
  { id: 'connectors/sma', name: 'SMA Jack', family: 'RF connector', pins: ['SIG', 'GND'], en: '50 Ω SMA jack (microwave up to 18 GHz)', vi: 'Giắc SMA 50 Ω (vi ba tới 18 GHz)', nameVi: 'Giắc SMA', footprint: 'SMA', keywords: ['sma', 'coax', 'rf', 'microwave'] },
  { id: 'connectors/de9', name: 'D-Sub DE-9', family: 'D-sub connector', pins: range(9), en: 'D-subminiature 9-pin connector (RS-232 serial)', vi: 'Đầu nối D-sub 9 chân (cổng nối tiếp RS-232)', nameVi: 'Đầu nối D-sub 9 chân', footprint: 'DSUB-9', keywords: ['d-sub', 'db9', 'de9', 'rs232', 'serial'] },
  { id: 'connectors/de15', name: 'D-Sub DE-15 (VGA)', family: 'D-sub connector', pins: range(15), en: 'High-density 15-pin D-sub (VGA video)', vi: 'Đầu nối D-sub mật độ cao 15 chân (video VGA)', nameVi: 'Đầu nối D-sub 15 chân (VGA)', footprint: 'DSUB-HD15', keywords: ['d-sub', 'vga', 'de15'] },
  { id: 'connectors/da15', name: 'D-Sub DA-15', family: 'D-sub connector', pins: range(15), en: 'D-subminiature 15-pin connector', vi: 'Đầu nối D-sub 15 chân', nameVi: 'Đầu nối D-sub 15 chân', footprint: 'DSUB-15', keywords: ['d-sub', 'da15', 'game port'] },
  { id: 'connectors/db25', name: 'D-Sub DB-25', family: 'D-sub connector', pins: range(25), en: 'D-subminiature 25-pin connector (parallel port)', vi: 'Đầu nối D-sub 25 chân (cổng song song)', nameVi: 'Đầu nối D-sub 25 chân', footprint: 'DSUB-25', keywords: ['d-sub', 'db25', 'parallel'] },
  { id: 'connectors/rj45', name: 'RJ45 Jack', family: 'Modular jack', pins: range(8), en: '8P8C modular jack (Ethernet)', vi: 'Ổ cắm mô-đun 8P8C (Ethernet)', nameVi: 'Ổ cắm RJ45', footprint: 'RJ45', keywords: ['rj45', 'ethernet', '8p8c', 'lan'] },
  { id: 'connectors/rj11', name: 'RJ11 Jack', family: 'Modular jack', pins: range(4), en: '6P4C modular jack (telephone)', vi: 'Ổ cắm mô-đun 6P4C (điện thoại)', nameVi: 'Ổ cắm RJ11', footprint: 'RJ11', keywords: ['rj11', 'telephone', '6p4c'] },
  { id: 'connectors/rj12', name: 'RJ12 Jack', family: 'Modular jack', pins: range(6), en: '6P6C modular jack', vi: 'Ổ cắm mô-đun 6P6C', nameVi: 'Ổ cắm RJ12', footprint: 'RJ12', keywords: ['rj12', '6p6c'] },
];

const specials = SPECIAL.map(connector);

const JUMPER_SYMBOL: SymbolDef = boxSymbol({ w: 20, h: 40, left: [{ name: '1', number: '1' }, { name: '2', number: '2' }], extra: [line(-4, -10, -4, 10, 3), text(14, 4, 'JP', 7)] });

const jumper: LibraryPartDef = withMeta(
  {
    id: 'connectors/jumper-2',
    name: 'Jumper 2-pin',
    group: 'connectors',
    family: 'Header',
    description: 'Two-pin header with a shunt jumper: conducts (1 mΩ) when fitted, open when removed',
    prefix: 'JP',
    symbol: JUMPER_SYMBOL,
    params: [{ key: 'fitted', label: 'Jumper fitted', default: 'true', kind: 'bool', group: 'value' }],
    toSpice: (ctx) => ({ elements: [elR(ctx.name('R'), ctx.node('1'), ctx.node('2'), /^(true|1|yes|on)$/i.test(ctx.params.fitted ?? '') ? 1e-3 : 1e9)] }),
    footprint: 'HDR-1X2-2.54',
    keywords: ['jumper', 'shunt', 'header', 'link'],
  },
  { vi: 'Hàng chân 2 chân có nắp nối tắt (jumper): dẫn điện (1 mΩ) khi cắm nắp, hở khi tháo', nameVi: 'Jumper 2 chân', specs: { positions: 2, pitch: 2.54 }, sortKey: 2.5 },
);

export const CONNECTOR_CATALOG: LibraryPartDef[] = [...headers1, ...headers2, jumper, ...sockets, ...terminals, ...wtb, ...specials];
