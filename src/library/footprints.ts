/**
 * Footprint catalogue (pure): the land patterns the library's parts name in `PartDef.footprint`,
 * with their pin count, pitch, body size and a simple 2D outline the UI can draw.
 *
 * MachSim does not lay out boards, so a footprint here is what a schematic tool needs: a name that
 * travels to the PCB netlist, how many pads it has (so a wrong footprint can be spotted), and a
 * picture a learner can recognise. Dimensions are millimetres and come from the published generic
 * outlines of the packages (JEDEC / IEC / EIA letter drawings and the usual 2.54 mm and 0.1 inch
 * grids), rounded to the tenth of a millimetre — no manufacturer drawing is copied.
 *
 *   listFootprints()                 every footprint, grouped by family and sorted
 *   getFootprint(name)               one footprint by its name (case-insensitive)
 *   footprintPads(fp)                pad centres in mm, origin at the middle of the footprint
 *   footprintOutline(fp)             pads + body rectangle + bounds, ready to draw
 *   footprintsForPins(n)             the footprints that have exactly n pads (part wizard)
 *   footprintPinCheck(name, pins)    'ok' | 'unknown' | 'mismatch' for a part's pin count
 *   FOOTPRINT_FAMILIES               family ids in listing order
 */

export type FootprintKind = 'dip' | 'sip' | 'soic' | 'axial' | 'radial' | 'chip' | 'to' | 'sot' | 'do' | 'connector' | 'display' | 'other';

/** Families in the order the manager lists them. */
export const FOOTPRINT_FAMILIES: FootprintKind[] = ['dip', 'soic', 'sip', 'axial', 'radial', 'chip', 'do', 'to', 'sot', 'connector', 'display', 'other'];

export interface Footprint {
  /** the name a part carries in PartDef.footprint / PartInstance.fields.footprint */
  name: string;
  kind: FootprintKind;
  /** number of pads (0 = mechanical / not pinned) */
  pins: number;
  /** pad pitch in mm (absent for single-pad and free-form outlines) */
  pitch?: number;
  /** body size in mm (w across the pads, h along the rows) */
  body: { w: number; h: number };
  /** surface mount (pads on one side) instead of through-hole */
  smd?: boolean;
  /** lead / pad diameter or width in mm */
  pad?: number;
  /** short explanation, Vietnamese first */
  text: { vi: string; en: string };
}

const fp = (name: string, kind: FootprintKind, pins: number, body: [number, number], vi: string, en: string, extra: Partial<Footprint> = {}): Footprint => ({
  name,
  kind,
  pins,
  body: { w: body[0], h: body[1] },
  text: { vi, en },
  ...extra,
});

/** Dual in-line package: n pads in two rows, 2.54 mm pitch, 7.62 mm (or 15.24 mm) row spacing. */
function dip(pins: number, wide = false, socket = false): Footprint {
  const rows = pins / 2;
  const span = wide ? 15.24 : 7.62;
  return fp(
    socket ? `DIP-${pins}-SOCKET` : `DIP-${pins}`,
    'dip',
    pins,
    [span, (rows - 1) * 2.54 + 2.6],
    socket ? `Đế cắm DIP ${pins} chân, bước 2.54 mm, hai hàng cách ${span} mm` : `Vỏ DIP ${pins} chân, bước 2.54 mm, hai hàng cách ${span} mm`,
    socket ? `${pins}-pin DIP socket, 2.54 mm pitch, ${span} mm between the rows` : `${pins}-pin dual in-line package, 2.54 mm pitch, ${span} mm between the rows`,
    { pitch: 2.54, pad: 1.6 },
  );
}

/** Small-outline IC: n pads in two rows, 1.27 mm pitch. */
function soic(pins: number): Footprint {
  const rows = pins / 2;
  return fp(`SOIC-${pins}`, 'soic', pins, [6, (rows - 1) * 1.27 + 1.6], `Vỏ dán SOIC ${pins} chân, bước 1.27 mm`, `${pins}-pin small-outline IC, 1.27 mm pitch`, { pitch: 1.27, smd: true, pad: 0.6 });
}

/** Single in-line row of pads on a 2.54 mm grid. */
function sip(name: string, pins: number, pitch: number, vi: string, en: string): Footprint {
  return fp(name, 'sip', pins, [2.6, (pins - 1) * pitch + 2.6], vi, en, { pitch, pad: 1.4 });
}

/** A small-outline package under another common name (SO-8 is the SOIC-8 land pattern). */
function soicAlias(name: string, pins: number): Footprint {
  const base = soic(pins);
  return { ...base, name, text: { vi: `Vỏ dán ${name} ${pins} chân, bước 1.27 mm`, en: `${pins}-pin ${name} small-outline package, 1.27 mm pitch` } };
}

const EVEN_DIP = [4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 40];
const SOCKETS = [8, 14, 16, 18, 20, 24, 28, 40];
const SOIC_PINS = [8, 14, 16];
const HEADER_PINS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];

/** Two-lead axial / radial through-hole part: pad spacing in mm. */
function leads(name: string, kind: FootprintKind, span: number, bodyH: number, vi: string, en: string, pad = 0.8): Footprint {
  return fp(name, kind, 2, [span, bodyH], vi, en, { pitch: span, pad });
}

/** Rectangular chip (SMD passive): EIA code, body in mm. */
function chip(name: string, w: number, h: number, vi: string, en: string): Footprint {
  return fp(name, 'chip', 2, [w, h], vi, en, { pitch: w * 0.8, smd: true, pad: Math.max(0.4, h * 0.9) });
}

/** TO / SOT package with `pins` leads on one side. */
function pack(name: string, kind: FootprintKind, pins: number, w: number, h: number, pitch: number, vi: string, en: string, smd = false): Footprint {
  return fp(name, kind, pins, [w, h], vi, en, { pitch, ...(smd ? { smd: true } : {}), pad: smd ? 0.9 : 1.3 });
}

const CATALOG: Footprint[] = [
  // ---- through-hole and surface-mount ICs
  ...EVEN_DIP.map((n) => dip(n)),
  ...SOCKETS.map((n) => dip(n, false, true)),
  { ...dip(24, true), name: 'DIP-24-WIDE' },
  ...SOIC_PINS.map((n) => soic(n)),
  soicAlias('SO-8', 8),
  fp('SO-14', 'soic', 14, [6, 9.9], 'Vỏ dán SO-14, bước 1.27 mm', 'SO-14 small-outline package, 1.27 mm pitch', { pitch: 1.27, smd: true, pad: 0.6 }),

  // ---- single-row packages, headers and terminal blocks
  ...[6, 8, 9, 10].map((n) => sip(`SIP-${n}`, n, 2.54, `Vỏ SIP ${n} chân một hàng, bước 2.54 mm`, `${n}-pin single in-line package, 2.54 mm pitch`)),
  ...HEADER_PINS.map((n) => sip(`HDR-1X${n}-2.54`, n, 2.54, `Hàng chân cắm đực 1×${n}, bước 2.54 mm`, `1×${n} male pin header, 2.54 mm pitch`)),
  ...[...HEADER_PINS, 7].map((n) => sip(`HDR-1X${n}`, n, 2.54, `Hàng chân cắm ${n} chân, bước 2.54 mm`, `${n}-pin header, 2.54 mm pitch`)),
  ...HEADER_PINS.map((n) => sip(`SKT-1X${n}-2.54`, n, 2.54, `Hàng chân cắm cái 1×${n}, bước 2.54 mm`, `1×${n} female socket header, 2.54 mm pitch`)),
  ...[2, 3, 4, 6, 8].map((n) => sip(`TB-${n}P-5.08`, n, 5.08, `Cầu đấu dây bắt vít ${n} vị trí, bước 5.08 mm`, `${n}-way screw terminal block, 5.08 mm pitch`)),
  ...[2, 3, 4, 5, 6].map((n) => sip(`WTB-${n}P-2.5`, n, 2.5, `Đầu nối dây-mạch ${n} chân, bước 2.5 mm`, `${n}-pin wire-to-board connector, 2.5 mm pitch`)),
  sip('POT-3P', 3, 5, 'Biến trở 3 chân, bước 5 mm', '3-pin potentiometer, 5 mm pitch'),
  sip('SW-2P', 2, 5, 'Công tắc 2 chân, bước 5 mm', '2-pin switch, 5 mm pitch'),
  sip('SW-TOGGLE-2P', 2, 4.7, 'Công tắc lật 2 chân', '2-pin toggle switch'),
  sip('SW-TOGGLE-3P', 3, 4.7, 'Công tắc lật 3 chân', '3-pin toggle switch'),
  sip('SW-TOGGLE-6P', 6, 4.7, 'Công tắc lật 6 chân (hai tầng)', '6-pin toggle switch (two poles)'),
  sip('SW-TACT-6MM', 4, 4.5, 'Nút nhấn nhỏ 6 × 6 mm, 4 chân', '6 × 6 mm tactile push button, 4 pins'),
  sip('XFMR-4P', 4, 7.62, 'Biến áp 4 chân (1 sơ cấp, 1 thứ cấp)', '4-pin transformer (one primary, one secondary)'),
  sip('XFMR-5P', 5, 7.62, 'Biến áp 5 chân (thứ cấp có điểm giữa)', '5-pin transformer (centre-tapped secondary)'),
  sip('XFMR-6P', 6, 7.62, 'Biến áp 6 chân (hai thứ cấp)', '6-pin transformer (two secondaries)'),
  sip('XFMR-8P', 8, 7.62, 'Biến áp 8 chân (hai sơ cấp, hai thứ cấp)', '8-pin transformer (two primaries, two secondaries)'),
  sip('RELAY-5P', 5, 5, 'Rơ-le 5 chân (một tiếp điểm đổi chiều)', '5-pin relay (one changeover contact)'),
  sip('RELAY-COIL', 2, 5, 'Cuộn hút rơ-le hai chân', '2-pin relay coil'),
  sip('SW-4P', 4, 5, 'Công tắc hành trình 4 chân (một hở, một đóng)', '4-pin limit switch (one NO, one NC contact)'),
  sip('SPEAKER-2P', 2, 5, 'Loa hai chân', '2-pin loudspeaker'),
  sip('MIC-2P', 2, 2.54, 'Micrô hai chân', '2-pin microphone capsule'),
  sip('JACK-3.5MM', 3, 5, 'Giắc tai nghe 3.5 mm (trái, phải, chung)', '3.5 mm headphone jack (left, right, common)'),
  sip('BATTERY-HOLDER', 2, 20, 'Đế pin hai chân', '2-pin battery holder'),

  // ---- resistors, capacitors, inductors
  leads('RES-AXIAL-400', 'axial', 10.16, 2.5, 'Điện trở hướng trục, thân 6.5 mm, hai lỗ cách 10.16 mm (0.4 inch)', 'Axial resistor, 6.5 mm body, 10.16 mm (0.4 inch) lead spacing'),
  leads('RES-AXIAL-500', 'axial', 12.7, 3.5, 'Điện trở 1 W hướng trục, hai lỗ cách 12.7 mm', '1 W axial resistor, 12.7 mm lead spacing', 1),
  leads('RES-CEMENT-5W', 'axial', 22, 9, 'Điện trở xi măng 5 W, hai lỗ cách 22 mm', '5 W cement resistor, 22 mm lead spacing', 1.2),
  leads('RES-RADIAL-100', 'radial', 2.54, 5, 'Điện trở đứng, hai chân cách 2.54 mm', 'Upright resistor, 2.54 mm lead spacing'),
  leads('R-6', 'axial', 7.62, 2.2, 'Điện trở nhỏ, hai lỗ cách 7.62 mm', 'Small axial resistor, 7.62 mm lead spacing'),
  leads('CAP-RADIAL-200', 'radial', 5, 8, 'Tụ hoá đứng, hai chân cách 5 mm', 'Radial electrolytic capacitor, 5 mm lead spacing'),
  leads('CAP-RADIAL-250', 'radial', 6.3, 11, 'Tụ hoá đứng lớn, hai chân cách 6.3 mm', 'Larger radial electrolytic capacitor, 6.3 mm lead spacing'),
  leads('CAP-FILM-5MM', 'radial', 5, 7, 'Tụ phim, hai chân cách 5 mm', 'Film capacitor, 5 mm lead spacing'),
  leads('CAP-FILM-7.5MM', 'radial', 7.5, 9, 'Tụ phim lớn, hai chân cách 7.5 mm', 'Larger film capacitor, 7.5 mm lead spacing'),
  leads('CAP-DISC-2.5MM', 'radial', 2.54, 4, 'Tụ gốm đĩa, hai chân cách 2.54 mm', 'Ceramic disc capacitor, 2.54 mm lead spacing'),
  sip('CAP-TRIM-3P', 3, 2.54, 'Tụ tinh chỉnh 3 chân', '3-pin trimmer capacitor'),
  leads('IND-AXIAL-500', 'axial', 12.7, 4, 'Cuộn cảm hướng trục, hai lỗ cách 12.7 mm', 'Axial inductor, 12.7 mm lead spacing'),
  leads('IND-RADIAL-500', 'radial', 5, 8, 'Cuộn cảm đứng, hai chân cách 5 mm', 'Radial inductor, 5 mm lead spacing'),
  sip('IND-VAR', 3, 5, 'Cuộn cảm điều chỉnh được, 3 chân', '3-pin adjustable inductor'),
  chip('R0805', 2, 1.25, 'Điện trở dán 0805 (2.0 × 1.25 mm)', '0805 chip resistor (2.0 × 1.25 mm)'),
  chip('R1206', 3.2, 1.6, 'Điện trở dán 1206 (3.2 × 1.6 mm)', '1206 chip resistor (3.2 × 1.6 mm)'),
  chip('R2512', 6.3, 3.2, 'Điện trở dán 2512 (6.3 × 3.2 mm), loại công suất', '2512 chip resistor (6.3 × 3.2 mm), power type'),
  chip('C0805', 2, 1.25, 'Tụ dán 0805', '0805 chip capacitor'),
  chip('CAP-0603', 1.6, 0.8, 'Tụ dán 0603', '0603 chip capacitor'),
  chip('IND-0603', 1.6, 0.8, 'Cuộn cảm dán 0603', '0603 chip inductor'),
  chip('LED-0603', 1.6, 0.8, 'LED dán 0603', '0603 chip LED'),
  chip('LED-0805', 2, 1.25, 'LED dán 0805', '0805 chip LED'),
  chip('LED-1206', 3.2, 1.6, 'LED dán 1206', '1206 chip LED'),

  // ---- diodes
  leads('DO-35', 'do', 7.62, 1.8, 'Điốt thuỷ tinh DO-35, hai lỗ cách 7.62 mm', 'DO-35 glass diode, 7.62 mm lead spacing', 0.6),
  leads('DO-41', 'do', 10.16, 2.7, 'Điốt DO-41 (1N4007), hai lỗ cách 10.16 mm', 'DO-41 diode (1N4007), 10.16 mm lead spacing'),
  leads('DO-15', 'do', 12.7, 3.6, 'Điốt DO-15, hai lỗ cách 12.7 mm', 'DO-15 diode, 12.7 mm lead spacing'),
  leads('DO-201AD', 'do', 15.24, 5.2, 'Điốt công suất DO-201AD (1N540x)', 'DO-201AD power diode (1N540x)', 1.3),
  leads('DO-201AE', 'do', 15.24, 5.2, 'Điốt công suất DO-201AE', 'DO-201AE power diode', 1.3),
  leads('SOD-57', 'do', 10.16, 2.7, 'Điốt SOD-57', 'SOD-57 diode'),
  chip('SOD-323', 1.7, 1.25, 'Điốt dán SOD-323', 'SOD-323 chip diode'),
  chip('SOD-123', 2.7, 1.6, 'Điốt dán SOD-123', 'SOD-123 chip diode'),
  chip('SMA', 4.3, 2.6, 'Điốt dán SMA (DO-214AC)', 'SMA chip diode (DO-214AC)'),
  chip('SMB', 5.3, 3.6, 'Điốt dán SMB (DO-214AA)', 'SMB chip diode (DO-214AA)'),
  chip('SMC', 7.9, 5.9, 'Điốt dán SMC (DO-214AB)', 'SMC chip diode (DO-214AB)'),
  sip('BRIDGE-4P', 4, 5, 'Cầu điốt 4 chân', '4-pin diode bridge'),

  // ---- transistors and power packages
  pack('TO-92', 'to', 3, 4.6, 3.6, 2.54, 'Vỏ nhựa TO-92 (2N3904), 3 chân bước 2.54 mm', 'TO-92 plastic package (2N3904), three leads on a 2.54 mm pitch'),
  pack('TO-18', 'to', 3, 5.3, 5.3, 2.54, 'Vỏ kim loại TO-18, 3 chân', 'TO-18 metal can, three leads'),
  pack('TO-126', 'to', 3, 8, 11, 2.54, 'Vỏ TO-126 có lỗ bắt vít', 'TO-126 package with a mounting hole'),
  pack('TO-220', 'to', 3, 10.2, 15.5, 2.54, 'Vỏ TO-220 (7805, IRF540), 3 chân bước 2.54 mm, có cánh toả nhiệt', 'TO-220 package (7805, IRF540), three leads on 2.54 mm, with a tab'),
  pack('TO-220-2', 'to', 2, 10.2, 15.5, 2.54, 'Vỏ TO-220 chỉ dùng 2 chân', 'TO-220 package with two leads used'),
  pack('TO-247', 'to', 3, 15.9, 21, 5.45, 'Vỏ TO-247 công suất lớn', 'TO-247 high-power package', false),
  pack('TO-3', 'to', 3, 39, 25, 30.1, 'Vỏ kim loại TO-3: hai chân hàn và vỏ (cực thứ ba, bắt vít)', 'TO-3 metal can: two leads plus the case as the third terminal (bolted)'),
  pack('SOT-23', 'sot', 3, 2.9, 2.8, 0.95, 'Vỏ dán SOT-23, 3 chân bước 0.95 mm', 'SOT-23 package, three pads on a 0.95 mm pitch', true),
  pack('SOT-143', 'sot', 4, 2.9, 2.8, 0.95, 'Vỏ dán SOT-143, 4 chân', 'SOT-143 package, four pads', true),
  pack('SOT-223', 'sot', 4, 6.5, 7, 2.3, 'Vỏ dán SOT-223 (ổn áp)', 'SOT-223 package (regulators)', true),

  pack('SOT-23-5', 'sot', 5, 2.9, 2.8, 0.95, 'Vỏ dán SOT-23-5, 5 chân bước 0.95 mm', 'SOT-23-5 package, five pads on a 0.95 mm pitch', true),
  pack('SOT-23-6', 'sot', 6, 2.9, 2.8, 0.95, 'Vỏ dán SOT-23-6, 6 chân bước 0.95 mm', 'SOT-23-6 package, six pads on a 0.95 mm pitch', true),
  fp('MSOP-8', 'soic', 8, [4.9, 3], 'Vỏ dán MSOP-8, bước 0.65 mm', '8-pin MSOP package, 0.65 mm pitch', { pitch: 0.65, smd: true, pad: 0.45 }),
  pack('TO-52', 'to', 3, 4.8, 4.8, 2.54, 'Vỏ kim loại TO-52, 3 chân', 'TO-52 metal can, three leads'),
  pack('TO-263', 'to', 5, 10.2, 9.9, 1.7, 'Vỏ dán công suất TO-263 / D2PAK, 5 chân', 'TO-263 / D2PAK power package, five leads', true),
  pack('TO-220-5', 'to', 5, 10.2, 15.5, 1.7, 'Vỏ TO-220 5 chân (bộ ổn áp xung)', 'Five-lead TO-220 package (switching regulators)'),
  sip('MODULE-4P', 4, 2.54, 'Mô-đun nhỏ 4 chân', '4-pin module'),
  sip('MODULE-5P', 5, 2.54, 'Mô-đun nhỏ 5 chân', '5-pin module'),
  sip('FUSE-BLADE', 2, 5.1, 'Giá cầu chì lưỡi (ATO) 2 chân', '2-pin blade fuse (ATO) holder'),
  sip('RELAY-4P', 4, 5, 'Rơ-le 4 chân (một tiếp điểm thường mở)', '4-pin relay (one normally-open contact)'),
  fp('RELAY-8P', 'connector', 8, [19, 15.5], 'Rơ-le 8 chân (hai tiếp điểm đổi chiều)', '8-pin relay (two changeover contacts)', { pitch: 2.54, pad: 1.5 }),
  sip('SSR-4P', 4, 5, 'Rơ-le bán dẫn 4 chân', '4-pin solid-state relay'),
  sip('REED-2P', 2, 2.54, 'Công tắc lưỡi gà trong ống thuỷ tinh', 'Reed switch in a glass tube'),
  sip('LVDT-4P', 4, 5, 'Cảm biến vị trí LVDT 4 chân', '4-pin LVDT position sensor'),
  sip('ENC-4P', 4, 2.54, 'Bộ mã hoá vòng quay 4 chân', '4-pin rotary encoder'),
  leads('HC-49', 'other', 4.88, 4.8, 'Thạch anh vỏ HC-49, hai chân cách 4.88 mm', 'HC-49 crystal, 4.88 mm lead spacing'),
  leads('XTAL-TUNING-FORK', 'other', 1.5, 6.2, 'Thạch anh 32.768 kHz dạng ống (âm thoa)', '32.768 kHz tuning-fork crystal in a cylinder'),
  fp('NOVAL-9', 'connector', 9, [21, 21], 'Đế đèn điện tử 9 chân (noval)', '9-pin noval valve socket', { pitch: 2.54, pad: 1.8 }),
  fp('OCTAL-8', 'connector', 8, [29, 29], 'Đế đèn điện tử 8 chân (octal)', '8-pin octal valve socket', { pitch: 2.54, pad: 2.2 }),

  // ---- indicators, displays, sensors
  leads('LED-3MM', 'radial', 2.54, 3, 'LED tròn 3 mm, hai chân cách 2.54 mm', '3 mm round LED, 2.54 mm lead spacing'),
  leads('LED-5MM', 'radial', 2.54, 5, 'LED tròn 5 mm, hai chân cách 2.54 mm', '5 mm round LED, 2.54 mm lead spacing'),
  leads('LED-10MM', 'radial', 5.08, 10, 'LED tròn 10 mm', '10 mm round LED'),
  leads('LED-STAR-1W', 'radial', 10, 20, 'LED công suất 1 W trên đế sao', '1 W power LED on a star board'),
  leads('LDR-5MM', 'radial', 3.4, 5.2, 'Quang điện trở 5 mm', '5 mm light-dependent resistor'),
  leads('PD-5MM', 'radial', 2.54, 5, 'Điốt quang 5 mm', '5 mm photodiode'),
  leads('LAMP-2P', 'radial', 5, 8, 'Đèn sợi đốt 2 chân', '2-pin filament lamp'),
  leads('BUZZER-12MM', 'radial', 7.62, 12, 'Còi 12 mm, hai chân cách 7.62 mm', '12 mm buzzer, 7.62 mm lead spacing'),
  fp('DISPLAY-7SEG-10P', 'display', 10, [19, 12.7], 'LED 7 đoạn một chữ số, 10 chân hai hàng', 'Single-digit seven-segment display, 10 pins in two rows', { pitch: 2.54, pad: 1.5 }),
  fp('DISPLAY-HEX', 'display', 14, [19, 15.2], 'Màn hình hex 14 chân', '14-pin hex display', { pitch: 2.54, pad: 1.5 }),
  fp('BARGRAPH-20P', 'display', 20, [25.4, 10.2], 'Thanh LED 10 vạch, 20 chân', '10-segment LED bar graph, 20 pins', { pitch: 2.54, pad: 1.5 }),
  fp('BARGRAPH-10P', 'display', 10, [12.7, 10.2], 'Thanh LED 5 vạch, 10 chân', '5-segment LED bar graph, 10 pins', { pitch: 2.54, pad: 1.5 }),
  fp('BARGRAPH-16P', 'display', 16, [20.3, 10.2], 'Thanh LED 8 vạch, 16 chân', '8-segment LED bar graph, 16 pins', { pitch: 2.54, pad: 1.5 }),
  fp('DISPLAY-14SEG', 'display', 18, [19, 21.6], 'LED 14 đoạn một chữ số, 18 chân', 'Single-digit 14-segment display, 18 pins', { pitch: 2.54, pad: 1.5 }),
  fp('DISPLAY-16SEG', 'display', 18, [19, 21.6], 'LED 16 đoạn một chữ số, 18 chân', 'Single-digit 16-segment display, 18 pins', { pitch: 2.54, pad: 1.5 }),
  fp('MATRIX-5X7-RA', 'display', 12, [20, 27.9], 'Ma trận LED 5 × 7, anốt chung theo hàng, 12 chân', '5 × 7 LED matrix, row anodes, 12 pins', { pitch: 2.54, pad: 1.5 }),
  fp('MATRIX-8X8-RA', 'display', 16, [32, 32], 'Ma trận LED 8 × 8, anốt chung theo hàng, 16 chân', '8 × 8 LED matrix, row anodes, 16 pins', { pitch: 2.54, pad: 1.5 }),
  fp('MATRIX-8X8-CA', 'display', 16, [32, 32], 'Ma trận LED 8 × 8, anốt chung theo cột, 16 chân', '8 × 8 LED matrix, column anodes, 16 pins', { pitch: 2.54, pad: 1.5 }),
  fp('LCD-16P', 'display', 16, [80, 36], 'Màn hình LCD ký tự, hàng chân 16 vị trí', 'Character LCD module, 16-way header', { pitch: 2.54, pad: 1.5 }),
  sip('SENSOR-3P', 3, 2.54, 'Cảm biến 3 chân', '3-pin sensor'),
  sip('SENSOR-4P', 4, 2.54, 'Cảm biến 4 chân', '4-pin sensor'),
  sip('RTD-2P', 2, 5, 'Nhiệt điện trở RTD 2 chân', '2-pin RTD temperature sensor'),
  sip('TC-2P', 2, 5, 'Cặp nhiệt điện 2 chân', '2-pin thermocouple'),
  sip('MOTOR-2P', 2, 5, 'Động cơ 2 chân', '2-pin motor'),
  sip('MOTOR-3P', 3, 5, 'Động cơ 3 chân', '3-pin motor'),
  sip('MOTOR-4P', 4, 5, 'Động cơ 4 chân', '4-pin motor'),
  sip('MOTOR-6P', 6, 5, 'Động cơ 6 chân', '6-pin motor'),
  sip('BATTERY-2P', 2, 5, 'Giá pin 2 chân', '2-pin battery holder'),
  sip('FUSE-5X20', 2, 22, 'Giá cầu chì ống 5 × 20 mm', 'Holder for a 5 × 20 mm cartridge fuse'),

  // ---- connectors and mechanical
  fp('BNC', 'connector', 2, [14, 14], 'Ổ BNC (lõi và vỏ)', 'BNC socket (core and shield)', { pitch: 10, pad: 1.5 }),
  sip('BANANA-4MM', 1, 4, 'Giắc cắm chuối 4 mm', '4 mm banana jack'),
  sip('TP-LOOP', 1, 2.54, 'Điểm đo (vòng dây hoặc chân đơn)', 'Test point (wire loop or single pin)'),
  sip('TESTPOINT', 1, 2.54, 'Điểm đo một lỗ', 'Single-hole test point'),
  sip('ANTENNA', 1, 2.54, 'Điểm hàn dây ăng-ten', 'Antenna wire pad'),
  fp('DSUB-9', 'connector', 9, [30.8, 12.5], 'Đầu nối D-sub 9 chân', '9-pin D-sub connector', { pitch: 2.77, pad: 1.1 }),
  fp('DSUB-15', 'connector', 15, [39.2, 12.5], 'Đầu nối D-sub 15 chân', '15-pin D-sub connector', { pitch: 2.77, pad: 1.1 }),
  fp('DSUB-25', 'connector', 25, [53, 12.5], 'Đầu nối D-sub 25 chân', '25-pin D-sub connector', { pitch: 2.77, pad: 1.1 }),
  fp('RJ45', 'connector', 8, [15.4, 13.5], 'Ổ mạng RJ45 8 chân', '8-pin RJ45 socket', { pitch: 1.02, pad: 0.9 }),
  fp('RJ11', 'connector', 4, [12, 13.5], 'Ổ điện thoại RJ11 4 chân', '4-pin RJ11 socket', { pitch: 1.02, pad: 0.9 }),
  fp('RJ12', 'connector', 6, [12, 13.5], 'Ổ RJ12 6 chân', '6-pin RJ12 socket', { pitch: 1.02, pad: 0.9 }),
  fp('USB-A', 'connector', 5, [13, 14], 'Ổ USB loại A (4 chân tín hiệu và chân vỏ)', 'USB type-A socket (four signal pins and the shell)', { pitch: 2, pad: 1 }),
  fp('USB-B', 'connector', 5, [12, 16], 'Ổ USB loại B (4 chân tín hiệu và chân vỏ)', 'USB type-B socket (four signal pins and the shell)', { pitch: 2, pad: 1 }),
  fp('USB-MINI-B', 'connector', 6, [7.7, 9], 'Ổ USB mini-B (5 chân tín hiệu và chân vỏ)', 'USB mini-B socket (five signal pins and the shell)', { pitch: 0.8, pad: 0.5, smd: true }),
  fp('USB-MICRO-B', 'connector', 6, [7.5, 5.5], 'Ổ USB micro-B (5 chân tín hiệu và chân vỏ)', 'USB micro-B socket (five signal pins and the shell)', { pitch: 0.65, pad: 0.4, smd: true }),
  fp('USB-C-16P', 'connector', 16, [9, 7.5], 'Ổ USB-C 16 chân', '16-pin USB-C socket', { pitch: 0.5, pad: 0.3, smd: true }),
  fp('JACK-3.5-TRS', 'connector', 3, [12, 6.5], 'Giắc 3.5 mm 3 tiếp điểm', '3.5 mm TRS jack', { pitch: 2.5, pad: 1 }),
  fp('JACK-3.5-TRRS', 'connector', 4, [12, 6.5], 'Giắc 3.5 mm 4 tiếp điểm', '3.5 mm TRRS jack', { pitch: 2.5, pad: 1 }),
  fp('JACK-6.35-TRS', 'connector', 3, [30, 12], 'Giắc 6.35 mm 3 tiếp điểm', '6.35 mm TRS jack', { pitch: 5, pad: 1.3 }),
  fp('RCA', 'connector', 2, [10, 13], 'Giắc RCA', 'RCA socket', { pitch: 8, pad: 1.3 }),
  fp('DC-JACK-2.1', 'connector', 3, [14, 11], 'Giắc nguồn DC 2.1 mm', '2.1 mm DC power jack', { pitch: 4.7, pad: 1.5 }),
  fp('BLOCK', 'other', 0, [20, 12], 'Khối cơ khí (không có chân hàn)', 'Mechanical block (no pads)'),
  fp('DIN-RAIL', 'other', 0, [45, 25], 'Thiết bị gắn thanh DIN', 'DIN-rail mounted device'),
  fp('PCB-TRACE', 'other', 4, [20, 1], 'Đường mạch in (không phải linh kiện): hai cổng, mỗi cổng hai đầu', 'Printed trace (not a component): two ports of two terminals each', { pitch: 6, pad: 0.6 }),
  fp('PCB-SPIRAL', 'other', 2, [12, 12], 'Cuộn cảm in xoắn trên mạch', 'Printed spiral inductor', { pitch: 10, pad: 0.6 }),
  fp('COAX', 'other', 4, [30, 6], 'Cáp đồng trục: lõi và vỏ ở hai đầu', 'Coaxial cable: core and shield at both ends', { pitch: 9, pad: 1 }),
  fp('WAVEGUIDE', 'other', 4, [40, 20], 'Ống dẫn sóng: hai cổng, mỗi cổng hai đầu', 'Waveguide: two ports of two terminals each', { pitch: 12, pad: 1 }),
];

/** Rotary switch footprints: one common pad plus n contact pads on a 10 mm circle. */
function rotary(ways: number): Footprint {
  return fp(`ROTARY-1P${ways}T`, 'other', ways + 1, [12, 12], `Công tắc xoay 1 tầng ${ways} vị trí`, `Single-pole ${ways}-way rotary switch`, { pitch: 2.54, pad: 1.2 });
}

/** Thin / shrink small-outline IC (TSSOP, SSOP, wide SOIC): n pads in two rows. */
function sop(name: string, pins: number, pitch: number, span: number, vi: string, en: string): Footprint {
  const rows = pins / 2;
  return fp(name, 'soic', pins, [span, (rows - 1) * pitch + 1.2], vi, en, { pitch, smd: true, pad: Math.min(0.6, pitch * 0.55) });
}

/** Round 4 (library breadth): the surface-mount IC, discrete and passive packages of the catalogue variants. */
const SMD_PACKAGES: Footprint[] = [
  ...[8, 14, 16, 20, 24, 28].map((n) => sop(`TSSOP-${n}`, n, 0.65, n <= 8 ? 4.9 : 6.4, `Vỏ dán TSSOP ${n} chân, bước 0.65 mm`, `${n}-pin thin shrink small-outline package, 0.65 mm pitch`)),
  ...[14, 16, 20, 24, 28].map((n) => sop(`SSOP-${n}`, n, 0.65, 7.8, `Vỏ dán SSOP ${n} chân, bước 0.65 mm`, `${n}-pin shrink small-outline package, 0.65 mm pitch`)),
  ...[20, 24, 28].map((n) => sop(`SOIC-${n}`, n, 1.27, 10.3, `Vỏ dán SOIC ${n} chân (thân rộng 7.5 mm), bước 1.27 mm`, `${n}-pin wide-body small-outline IC (7.5 mm), 1.27 mm pitch`)),
  sop('MSOP-10', 10, 0.5, 4.9, 'Vỏ dán MSOP-10, bước 0.5 mm', '10-pin MSOP package, 0.5 mm pitch'),
  sop('SOIC-8-EP', 8, 1.27, 6, 'Vỏ dán SOIC-8 có miếng tản nhiệt', '8-pin SOIC with exposed thermal pad'),
  pack('SOT-23-8', 'sot', 8, 2.9, 2.8, 0.65, 'Vỏ dán SOT-23-8, 8 chân bước 0.65 mm', 'SOT-23-8 package, eight pads on a 0.65 mm pitch', true),
  pack('SC-70-5', 'sot', 5, 2, 2.1, 0.65, 'Vỏ dán SC-70-5 (SOT-353), 5 chân bước 0.65 mm', 'SC-70-5 (SOT-353) package, five pads on a 0.65 mm pitch', true),
  pack('SOT-323', 'sot', 3, 2, 2.1, 0.65, 'Vỏ dán SOT-323 (SC-70), 3 chân', 'SOT-323 (SC-70) package, three pads', true),
  pack('SOT-89', 'sot', 3, 4.5, 4.1, 1.5, 'Vỏ dán SOT-89, 3 chân bước 1.5 mm', 'SOT-89 package, three pads on a 1.5 mm pitch', true),
  pack('SOT-363', 'sot', 6, 2, 2.1, 0.65, 'Vỏ dán SOT-363 (SC-70-6), 6 chân', 'SOT-363 (SC-70-6) package, six pads', true),
  pack('TO-252', 'to', 3, 6.6, 6.1, 2.29, 'Vỏ dán công suất TO-252 / DPAK, 3 chân', 'TO-252 / DPAK power package, three leads', true),
  pack('TO-263-3', 'to', 3, 10.2, 9.9, 2.54, 'Vỏ dán công suất TO-263 / D2PAK, 3 chân', 'TO-263 / D2PAK power package, three leads', true),
  pack('TO-39', 'to', 3, 9.4, 9.4, 5.08, 'Vỏ kim loại TO-39, 3 chân', 'TO-39 metal can, three leads'),
  pack('TO-66', 'to', 3, 20, 20, 12.7, 'Vỏ kim loại TO-66, 2 chân và vỏ', 'TO-66 metal can, two leads plus the case'),
  pack('TO-46', 'to', 3, 5.8, 5.8, 2.54, 'Vỏ kim loại TO-46, 3 chân', 'TO-46 metal can, three leads'),
  pack('TO-3P', 'to', 3, 15.6, 20, 5.45, 'Vỏ TO-3P công suất lớn', 'TO-3P high-power package'),
  pack('TO-220F', 'to', 3, 10.2, 15.5, 2.54, 'Vỏ TO-220 cách điện toàn phần (TO-220F), 3 chân', 'Fully isolated TO-220F package, three leads'),
  chip('R0402', 1, 0.5, 'Điện trở dán 0402 (1.0 × 0.5 mm)', '0402 chip resistor (1.0 × 0.5 mm)'),
  chip('R0603', 1.6, 0.8, 'Điện trở dán 0603 (1.6 × 0.8 mm)', '0603 chip resistor (1.6 × 0.8 mm)'),
  chip('R1210', 3.2, 2.5, 'Điện trở dán 1210 (3.2 × 2.5 mm)', '1210 chip resistor (3.2 × 2.5 mm)'),
  chip('C0402', 1, 0.5, 'Tụ dán 0402', '0402 chip capacitor'),
  chip('C1206', 3.2, 1.6, 'Tụ dán 1206', '1206 chip capacitor'),
  chip('C1210', 3.2, 2.5, 'Tụ dán 1210', '1210 chip capacitor'),
  chip('IND-0805', 2, 1.25, 'Cuộn cảm dán 0805', '0805 chip inductor'),
  chip('LED-0402', 1, 0.5, 'LED dán 0402', '0402 chip LED'),
  chip('LED-PLCC2', 3.5, 2.8, 'LED dán PLCC-2 (3528)', 'PLCC-2 (3528) chip LED'),
  chip('SOD-523', 1.2, 0.8, 'Điốt dán SOD-523', 'SOD-523 chip diode'),
  chip('SOD-80', 3.5, 1.5, 'Điốt MiniMELF (SOD-80)', 'MiniMELF (SOD-80) diode'),
  chip('TANT-A', 3.2, 1.6, 'Tụ tantan dán cỡ A (EIA 3216)', 'Tantalum chip capacitor, case A (EIA 3216)'),
  chip('TANT-B', 3.5, 2.8, 'Tụ tantan dán cỡ B (EIA 3528)', 'Tantalum chip capacitor, case B (EIA 3528)'),
  chip('TANT-C', 6, 3.2, 'Tụ tantan dán cỡ C (EIA 6032)', 'Tantalum chip capacitor, case C (EIA 6032)'),
  chip('TANT-D', 7.3, 4.3, 'Tụ tantan dán cỡ D (EIA 7343)', 'Tantalum chip capacitor, case D (EIA 7343)'),
  ...[4, 5, 6.3, 8, 10, 13, 16].map((d) => chip(`CAP-SMD-D${d}`, d, d, `Tụ hoá dán đường kính ${d} mm`, `${d} mm surface-mount electrolytic capacitor`)),
  leads('CAP-RADIAL-150', 'radial', 3.5, 6.3, 'Tụ hoá đứng 6.3 mm, hai chân cách 3.5 mm', '6.3 mm radial electrolytic capacitor, 3.5 mm lead spacing'),
  leads('CAP-RADIAL-350', 'radial', 7.5, 13, 'Tụ hoá đứng 13 mm, hai chân cách 7.5 mm', '13 mm radial electrolytic capacitor, 7.5 mm lead spacing'),
  leads('CAP-RADIAL-500', 'radial', 10, 18, 'Tụ hoá đứng 18 mm, hai chân cách 10 mm', '18 mm radial electrolytic capacitor, 10 mm lead spacing'),
  leads('CAP-DISC-5MM', 'radial', 5, 5, 'Tụ gốm đĩa, hai chân cách 5 mm', 'Ceramic disc capacitor, 5 mm lead spacing'),
  leads('CAP-FILM-10MM', 'radial', 10, 6, 'Tụ phim, hai chân cách 10 mm', 'Film capacitor, 10 mm lead spacing'),
  leads('CAP-FILM-15MM', 'radial', 15, 8, 'Tụ phim, hai chân cách 15 mm', 'Film capacitor, 15 mm lead spacing'),
  leads('RES-AXIAL-250', 'axial', 7.62, 2, 'Điện trở 1/4 W hướng trục, hai lỗ cách 7.62 mm', '1/4 W axial resistor, 7.62 mm lead spacing'),
  leads('RES-AXIAL-600', 'axial', 15.24, 3.2, 'Điện trở 2 W hướng trục, hai lỗ cách 15.24 mm', '2 W axial resistor, 15.24 mm lead spacing', 1),
  leads('LED-8MM', 'radial', 2.54, 8, 'LED tròn 8 mm, hai chân cách 2.54 mm', '8 mm round LED, 2.54 mm lead spacing'),
  leads('LED-RECT-5X2', 'radial', 2.54, 5, 'LED chữ nhật 5 × 2 mm', '5 × 2 mm rectangular LED'),
  chip('LED-3528', 3.5, 2.8, 'LED dán 3528', '3528 chip LED'),
  fp('DISPLAY-7SEG-0.28', 'display', 10, [12.7, 10], 'LED 7 đoạn 0.28 inch, 10 chân hai hàng', '0.28 inch single-digit seven-segment display, 10 pins in two rows', { pitch: 2.54, pad: 1.2 }),
  fp('DISPLAY-7SEG-0.36', 'display', 10, [15.6, 10], 'LED 7 đoạn 0.36 inch, 10 chân hai hàng', '0.36 inch single-digit seven-segment display, 10 pins in two rows', { pitch: 2.54, pad: 1.3 }),
  fp('DISPLAY-7SEG-0.8', 'display', 10, [27, 20], 'LED 7 đoạn 0.8 inch, 10 chân hai hàng', '0.8 inch single-digit seven-segment display, 10 pins in two rows', { pitch: 2.54, pad: 1.5 }),
  fp('DISPLAY-7SEG-1.0', 'display', 10, [31, 25], 'LED 7 đoạn 1.0 inch, 10 chân hai hàng', '1.0 inch single-digit seven-segment display, 10 pins in two rows', { pitch: 2.54, pad: 1.5 }),
  sop('SOP-4', 4, 2.54, 6.8, 'Vỏ dán SOP 4 chân (opto), bước 2.54 mm', '4-pin SOP package (optocouplers), 2.54 mm pitch'),
  chip('LED-5050', 5, 5, 'LED dán 5050', '5050 chip LED'),
];

const GENERATED: Footprint[] = [...[3, 4, 6, 8, 12].map(rotary), ...SMD_PACKAGES];

const ALL: Footprint[] = [...CATALOG, ...GENERATED];

const BY_NAME = new Map(ALL.map((f) => [f.name.toLowerCase(), f]));

/** Every footprint, sorted by family and then by pin count and name. */
export function listFootprints(): Footprint[] {
  return [...ALL].sort(
    (a, b) => FOOTPRINT_FAMILIES.indexOf(a.kind) - FOOTPRINT_FAMILIES.indexOf(b.kind) || a.pins - b.pins || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

export function getFootprint(name: string | undefined): Footprint | undefined {
  return name ? BY_NAME.get(name.trim().toLowerCase()) : undefined;
}

/** The footprints with exactly `pins` pads (what the part wizard offers for a symbol). */
export function footprintsForPins(pins: number): Footprint[] {
  return listFootprints().filter((f) => f.pins === pins);
}

/** Whether a part's pin count fits its footprint. */
export function footprintPinCheck(name: string | undefined, pins: number): 'ok' | 'unknown' | 'mismatch' {
  const f = getFootprint(name);
  if (!f) return 'unknown';
  if (f.pins === 0) return 'ok';
  return f.pins === pins ? 'ok' : 'mismatch';
}

export interface FootprintPad {
  number: string;
  /** centre in mm, origin at the middle of the footprint */
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'round' | 'rect';
}

/**
 * Pad centres of a footprint in mm, origin in the middle. Pin 1 is bottom-left for a two-row
 * package (the usual counting: down the left column, then up the right one), left for a single row.
 */
export function footprintPads(f: Footprint): FootprintPad[] {
  const pitch = f.pitch ?? 2.54;
  const size = f.pad ?? 1.4;
  const pad = (number: string, x: number, y: number, shape: 'round' | 'rect' = f.smd ? 'rect' : 'round'): FootprintPad => ({
    number,
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    w: shape === 'rect' ? Math.max(size, 0.6) : size,
    h: shape === 'rect' ? Math.max(size * 0.9, 0.5) : size,
    shape,
  });
  if (f.pins === 0) return [];
  switch (f.kind) {
    case 'dip':
    case 'soic':
    case 'display': {
      const rows = f.pins / 2;
      const span = f.body.w;
      const top = -((rows - 1) * pitch) / 2;
      const out: FootprintPad[] = [];
      for (let i = 0; i < rows; i++) out.push(pad(String(i + 1), -span / 2, top + i * pitch));
      for (let i = 0; i < rows; i++) out.push(pad(String(f.pins - i), span / 2, top + i * pitch));
      return out;
    }
    case 'chip': {
      const x = f.body.w / 2 - (f.pad ?? 0.5) / 2;
      return [pad('1', -x, 0, 'rect'), pad('2', x, 0, 'rect')];
    }
    case 'axial':
    case 'do':
    case 'radial': {
      const x = (f.pitch ?? 2.54) / 2;
      return [pad('1', -x, 0), pad('2', x, 0)];
    }
    case 'to':
    case 'sot':
    case 'connector':
    case 'sip':
    case 'other':
    default: {
      const n = f.pins;
      const start = -((n - 1) * pitch) / 2;
      return Array.from({ length: n }, (_, i) => pad(String(i + 1), start + i * pitch, f.kind === 'sip' ? 0 : f.body.h / 2 - size));
    }
  }
}

export interface FootprintOutline {
  pads: FootprintPad[];
  /** body rectangle in mm, origin in the middle */
  body: { x: number; y: number; w: number; h: number };
  /** everything (pads and body) in mm */
  bounds: { x: number; y: number; w: number; h: number };
}

/** Pads, body rectangle and overall bounds of a footprint, ready for a 2D preview. */
export function footprintOutline(f: Footprint): FootprintOutline {
  const pads = footprintPads(f);
  const twoRow = f.kind === 'dip' || f.kind === 'soic' || f.kind === 'display';
  const bodyW = twoRow ? Math.max(2, f.body.w - 2.5) : f.body.w;
  const bodyH = twoRow ? f.body.h : f.body.h;
  const body = { x: -bodyW / 2, y: -bodyH / 2, w: bodyW, h: bodyH };
  let x0 = body.x;
  let y0 = body.y;
  let x1 = body.x + body.w;
  let y1 = body.y + body.h;
  for (const p of pads) {
    x0 = Math.min(x0, p.x - p.w / 2);
    y0 = Math.min(y0, p.y - p.h / 2);
    x1 = Math.max(x1, p.x + p.w / 2);
    y1 = Math.max(y1, p.y + p.h / 2);
  }
  return { pads, body, bounds: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
