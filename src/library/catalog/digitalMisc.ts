/**
 * Misc-digital catalogue: memories (generic and classic RAM / EPROM / EEPROM part numbers with an
 * editable content image), programmable logic blocks (Boolean equations or a truth table) and
 * line drivers / receivers (RS-232, RS-422, RS-485).
 *
 * Memories use the D_RAM / D_ROM code models (src/sim/devices/digital/memory.ts): TTL-compatible
 * CMOS inputs (HCT levels), output delay = the access time parameter, hidden VCC / GND pins as
 * for the logic ICs. The 'data' parameter holds the initial contents (memimage.ts format: hex
 * words, @address markers, hex-dump lines or Intel HEX); the Properties panel opens a hex editor
 * for it. A RAM starts every analysis from this image; writes during a transient do not change
 * the stored parameter.
 * PLD blocks are ideal (virtual) logic with the D_PLD code model (pld.ts / logicExpr.ts).
 * Line drivers / receivers are behavioural: TTL inputs, the interface levels at the outputs
 * (RS-232 ±9 V through 300 Ω, RS-485 / RS-422 differential 0..5 V outputs through 25 Ω, receivers
 * with the standard thresholds). Their bus supply pins (VCC / VEE, charge-pump capacitors) are
 * drawn for wiring and are not simulated.
 */
import { formatMemoryImage, parseMemoryImage } from '../../sim/devices/digital/memimage';
import { compileLogicProgram, programText } from '../../sim/devices/digital/logicExpr';
import { hash8, numParam, textParam, type LibraryPartDef } from '../partkit';
import type { ParamDef, ToSpiceContext } from '../types';
import { FAMILIES, aElement, familyModel, icSymbol, idealLevels, levelsFor, powerNodes, powerParams, type FamilyLevels, type IcPin } from '../parts/digital/kit';
import { IcBuilder } from '../parts/digital/ttl';
import { names, side } from './logicKit';
import { withMeta } from './kit';

// ---------------------------------------------------------------------------------------------
// memories

interface MemSpec {
  id: string;
  name: string;
  nameVi?: string;
  vi: string;
  desc: string;
  descVi: string;
  abits: number;
  dbits: number;
  /** DIP pins (0 = generic block without package) */
  pins: number;
  writable: boolean;
  cs2?: boolean;
  hasOe?: boolean;
  separate?: boolean;
  outInvert?: boolean;
  /** physical numbers: address pins A0.., data pins D0.., q pins Q0.., controls */
  addr?: number[];
  data?: number[];
  q?: number[];
  ctrl?: { CS?: number; CS2?: number; OE?: number; WE?: number };
  /** extra wiring-only pins (VPP, ~PGM, RDY/~BUSY) */
  extra?: string;
  power?: string;
  tacc: string;
  example?: string;
  keywords: string[];
}

function memoryData(ctx: ToSpiceContext, words: number, bits: number): string {
  const r = parseMemoryImage(ctx.params.data ?? '', words, bits);
  if (r.errors.length) throw new Error(`bad value for data: ${r.errors[0]}`);
  return formatMemoryImage(r.data, bits);
}

function memPart(s: MemSpec): LibraryPartDef {
  const words = 2 ** s.abits;
  const num = (list: number[] | undefined, k: number) => (list ? `:${list[k]}` : `:${k + 1}`);
  const pinTok = (name: string, label: string, n: string) => `${name}@${label}${n}`;
  const hasOe = s.hasOe ?? true;
  const dataPrefix = s.writable && !s.separate ? '=' : s.separate ? '-' : '+';
  // generic blocks number their pins in order (no package)
  let counter = 0;
  const auto = () => `:${++counter + 100}`;
  const n = (v: number | undefined) => (s.pins ? `:${v}` : auto());
  const left = [
    ...names('A', s.abits).map((a, k) => (s.pins ? `${a}${num(s.addr, k)}` : `${a}${auto()}`)),
    '|',
    pinTok('~CS', s.cs2 ? '~CS1' : s.writable ? '~CS' : '~CE', n(s.ctrl?.CS)),
    ...(s.cs2 ? [`CS2${n(s.ctrl?.CS2)}`] : []),
    ...(hasOe ? [`~OE${n(s.ctrl?.OE)}`] : []),
    ...(s.writable ? [`~WE${n(s.ctrl?.WE)}`] : []),
    ...(s.separate ? ['|', ...names('D', s.dbits).map((d, k) => `${d}${num(s.data, k)}`)] : []),
    ...(s.extra ? ['|', ...s.extra.split(' ')] : []),
  ].join(' ').replace(/~CS@/g, 'CS@');
  const right = (s.separate ? names('Q', s.dbits).map((q, k) => `${q}@~Q${k}${num(s.q, k)}`) : names('D', s.dbits).map((d, k) => `${dataPrefix}${d}@${s.writable ? 'I/O' : 'O'}${k}${s.pins ? num(s.data, k) : auto()}`)).join(' ');
  const l = side(left, 'input');
  const r = side(right, s.separate ? 'output' : s.writable ? 'bidir' : 'output');
  if (!s.pins) [...l, ...r].forEach((p) => p && (p.number = undefined));
  const param: ParamDef = {
    ...textParam('data', 'Contents (hex)', s.example ?? '', { group: 'value', help: 'Initial memory contents: hex words, @address markers, hex-dump lines or Intel HEX (Edit contents… opens the hex editor)' }),
    fileImport: '.hex,.ihx,.txt,.mem',
    memory: { words, bits: s.dbits },
  };
  const optional = (s.extra ?? '').split(' ').filter(Boolean).map((t) => t.replace(/^[%~]+/, '').split(/[@:]/)[0]);
  const vcc = s.power ?? (s.pins ? `VCC = ${s.pins}, GND = ${s.pins / 2}` : '');
  return withMeta(
    {
      id: s.id,
      name: s.name,
      group: 'misc-digital',
      family: 'Memory',
      description: `${s.desc}${vcc ? ` Hidden power pins (${vcc}) on the VCC net.` : ''}`,
      prefix: 'U',
      symbol: icSymbol(s.name, l, r, { w: 100 }),
      params: [param, numParam('tacc', 'Access time', s.tacc, 's', { min: 1e-12, group: 'model', help: 'Delay from an address or control change to valid output data' }), ...powerParams('vccnet', 'VCC')],
      toSpice: (ctx) => {
        const image = memoryData(ctx, words, s.dbits);
        const tacc = ctx.num('tacc');
        const lv = levelsFor(ctx, { ...FAMILIES.HCT, tplh: tacc, tphl: tacc });
        const m = familyModel(`MS_${s.name.replace(/\W/g, '_').toUpperCase()}`, s.writable ? 'D_RAM' : 'D_ROM', lv, 1, {
          abits: s.abits,
          dbits: s.dbits,
          writable: s.writable ? 1 : 0,
          cs2: s.cs2 ? 1 : 0,
          has_oe: hasOe ? 1 : 0,
          separate: s.separate ? 1 : 0,
          out_invert: s.outInvert ? 1 : 0,
          tz_delay: tacc / 2,
        });
        const card = { ...m, name: `${m.name}_${hash8(image)}`, stringParams: { data: image } };
        const ports = [...names('A', s.abits), ...names('D', s.dbits), ...(s.separate ? names('Q', s.dbits) : []), 'CS', ...(s.cs2 ? ['CS2'] : []), ...(hasOe ? ['OE'] : []), ...(s.writable ? ['WE'] : [])];
        const power = powerNodes(ctx, 'vccnet', 'VCC');
        return { elements: [aElement(ctx.name('A'), ports.map((p) => ctx.node(p)), power, card.name)], models: [card] };
      },
      optionalPins: optional,
      footprint: s.pins ? `DIP-${s.pins}` : undefined,
      keywords: ['memory', s.writable ? 'ram' : 'rom', ...s.keywords],
      provenance: `MachSim memory code model (${s.writable ? 'D_RAM' : 'D_ROM'}): ${words} x ${s.dbits} bits, TTL-compatible inputs, typical access time; public datasheet pinout`,
    },
    {
      vi: `${s.descVi}`,
      nameVi: s.nameVi,
      specs: { words, bits: s.dbits, tpd: Number.parseFloat(s.tacc) * (s.tacc.endsWith('n') ? 1e-9 : 1), ...(s.pins ? { positions: s.pins, package: `DIP-${s.pins}` } : {}) },
      sortKey: words * s.dbits,
      series: s.pins ? 'Memory IC' : 'Generic memory',
    },
  );
}

const range8 = (from: number) => Array.from({ length: 8 }, (_, k) => from + k);
const DIP28_ADDR = [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 1];
const DIP28_DATA = [11, 12, 13, 15, 16, 17, 18, 19];
const DIP24_ADDR = [8, 7, 6, 5, 4, 3, 2, 1, 23, 22, 19];
const DIP24_DATA = [9, 10, 11, 13, 14, 15, 16, 17];

const EXAMPLE_ROM = '// 7-segment font 0-F (a = bit 0 ... g = bit 6)\n3F 06 5B 4F 66 6D 7D 07 7F 6F 77 7C 39 5E 79 71';

const MEMORIES: LibraryPartDef[] = [
  memPart({ id: 'misc-digital/ram-16x4', name: 'RAM 16x4', nameVi: 'RAM 16x4', vi: 'RAM tĩnh 16 từ x 4 bit', desc: 'Generic static RAM, 16 words of 4 bits: ~CS and ~WE low write the I/O pins into the addressed word; ~CS and ~OE low (~WE high) read it.', descVi: 'RAM tĩnh tổng quát 16 từ 4 bit: ~CS và ~WE thấp ghi các chân I/O vào từ có địa chỉ; ~CS và ~OE thấp (~WE cao) thì đọc ra.', abits: 4, dbits: 4, pins: 0, writable: true, tacc: '20n', keywords: ['sram', '16x4'] }),
  memPart({ id: 'misc-digital/ram-256x8', name: 'RAM 256x8', nameVi: 'RAM 256x8', vi: 'RAM tĩnh 256 byte', desc: 'Generic static RAM, 256 bytes: ~CS and ~WE low write; ~CS and ~OE low read.', descVi: 'RAM tĩnh tổng quát 256 byte: ~CS và ~WE thấp thì ghi; ~CS và ~OE thấp thì đọc.', abits: 8, dbits: 8, pins: 0, writable: true, tacc: '20n', keywords: ['sram', '256x8'] }),
  memPart({ id: 'misc-digital/ram-1kx8', name: 'RAM 1Kx8', nameVi: 'RAM 1Kx8', vi: 'RAM tĩnh 1 KB', desc: 'Generic static RAM, 1024 bytes: ~CS and ~WE low write; ~CS and ~OE low read.', descVi: 'RAM tĩnh tổng quát 1024 byte: ~CS và ~WE thấp thì ghi; ~CS và ~OE thấp thì đọc.', abits: 10, dbits: 8, pins: 0, writable: true, tacc: '20n', keywords: ['sram', '1k'] }),
  memPart({ id: 'misc-digital/rom-32x8', name: 'ROM 32x8', nameVi: 'ROM 32x8', vi: 'ROM 32 byte', desc: 'Generic read-only memory, 32 bytes: ~CE and ~OE low drive the addressed byte (contents in the Contents parameter; the default is a 7-segment font table).', descVi: 'Bộ nhớ chỉ đọc tổng quát 32 byte: ~CE và ~OE thấp đưa byte có địa chỉ ra ngõ ra (nội dung ở tham số Nội dung; mặc định là bảng mã LED 7 đoạn).', abits: 5, dbits: 8, pins: 0, writable: false, tacc: '20n', example: EXAMPLE_ROM, keywords: ['rom', 'lookup table', '32x8'] }),
  memPart({ id: 'misc-digital/rom-256x8', name: 'ROM 256x8', nameVi: 'ROM 256x8', vi: 'ROM 256 byte', desc: 'Generic read-only memory, 256 bytes: ~CE and ~OE low drive the addressed byte.', descVi: 'Bộ nhớ chỉ đọc tổng quát 256 byte: ~CE và ~OE thấp đưa byte có địa chỉ ra ngõ ra.', abits: 8, dbits: 8, pins: 0, writable: false, tacc: '20n', example: EXAMPLE_ROM, keywords: ['rom', 'lookup table', '256x8'] }),
  memPart({ id: 'misc-digital/rom-1kx8', name: 'ROM 1Kx8', nameVi: 'ROM 1Kx8', vi: 'ROM 1 KB', desc: 'Generic read-only memory, 1024 bytes: ~CE and ~OE low drive the addressed byte.', descVi: 'Bộ nhớ chỉ đọc tổng quát 1024 byte: ~CE và ~OE thấp đưa byte có địa chỉ ra ngõ ra.', abits: 10, dbits: 8, pins: 0, writable: false, tacc: '20n', keywords: ['rom', '1k'] }),
  memPart({ id: 'misc-digital/74ls189', name: '74LS189', vi: 'RAM 64 bit (16 x 4) ngõ ra đảo ba trạng thái', desc: '64-bit (16 x 4) RAM with separate data inputs and inverted 3-state outputs: ~CS (ME) and ~WE low write D; ~CS low with ~WE high reads (the outputs are the complement).', descVi: 'RAM 64 bit (16 x 4) có chân dữ liệu vào riêng và ngõ ra đảo ba trạng thái: ~CS (ME) và ~WE thấp thì ghi D; ~CS thấp và ~WE cao thì đọc (ngõ ra là giá trị đảo).', abits: 4, dbits: 4, pins: 16, writable: true, hasOe: false, separate: true, outInvert: true, addr: [1, 15, 14, 13], data: [4, 6, 10, 12], q: [5, 7, 9, 11], ctrl: { CS: 2, WE: 3 }, tacc: '35n', keywords: ['74189', 'register file', 'scratchpad'] }),
  memPart({ id: 'misc-digital/2114', name: '2114', vi: 'RAM tĩnh 1K x 4', desc: '4096-bit (1K x 4) static RAM, common I/O, no output enable: ~CS and ~WE low write, ~CS low reads.', descVi: 'RAM tĩnh 4096 bit (1K x 4), chân I/O chung, không có ~OE: ~CS và ~WE thấp thì ghi, ~CS thấp thì đọc.', abits: 10, dbits: 4, pins: 18, writable: true, hasOe: false, addr: [5, 6, 7, 4, 3, 2, 1, 17, 16, 15], data: [14, 13, 12, 11], ctrl: { CS: 8, WE: 10 }, power: 'VCC = 18, GND = 9', tacc: '200n', keywords: ['sram', '1kx4'] }),
  memPart({ id: 'misc-digital/6116', name: '6116', vi: 'RAM tĩnh CMOS 2K x 8', desc: '16-Kbit (2K x 8) CMOS static RAM: ~CS and ~WE low write; ~CS and ~OE low read.', descVi: 'RAM tĩnh CMOS 16 Kbit (2K x 8): ~CS và ~WE thấp thì ghi; ~CS và ~OE thấp thì đọc.', abits: 11, dbits: 8, pins: 24, writable: true, addr: DIP24_ADDR, data: DIP24_DATA, ctrl: { CS: 18, OE: 20, WE: 21 }, power: 'VCC = 24, GND = 12', tacc: '150n', keywords: ['sram', '2k', 'hm6116'] }),
  memPart({ id: 'misc-digital/6264', name: '6264', vi: 'RAM tĩnh CMOS 8K x 8', desc: '64-Kbit (8K x 8) CMOS static RAM with two chip selects: ~CS1 low and CS2 high select it; ~WE low writes, ~OE low reads.', descVi: 'RAM tĩnh CMOS 64 Kbit (8K x 8) có hai chân chọn chip: ~CS1 thấp và CS2 cao thì được chọn; ~WE thấp ghi, ~OE thấp đọc.', abits: 13, dbits: 8, pins: 28, writable: true, cs2: true, addr: DIP28_ADDR.slice(0, 13), data: DIP28_DATA, ctrl: { CS: 20, CS2: 26, OE: 22, WE: 27 }, tacc: '100n', keywords: ['sram', '8k'] }),
  memPart({ id: 'misc-digital/62256', name: '62256', vi: 'RAM tĩnh CMOS 32K x 8', desc: '256-Kbit (32K x 8) CMOS static RAM: ~CS and ~WE low write; ~CS and ~OE low read.', descVi: 'RAM tĩnh CMOS 256 Kbit (32K x 8): ~CS và ~WE thấp thì ghi; ~CS và ~OE thấp thì đọc.', abits: 15, dbits: 8, pins: 28, writable: true, addr: DIP28_ADDR, data: DIP28_DATA, ctrl: { CS: 20, OE: 22, WE: 27 }, tacc: '70n', keywords: ['sram', '32k'] }),
  memPart({ id: 'misc-digital/2716', name: '2716', vi: 'EPROM 2K x 8', desc: '16-Kbit (2K x 8) UV EPROM: ~CE and ~OE low read the addressed byte (contents in the Contents parameter; VPP is not simulated).', descVi: 'EPROM xoá bằng tia cực tím 16 Kbit (2K x 8): ~CE và ~OE thấp đọc byte có địa chỉ (nội dung ở tham số Nội dung; chân VPP không mô phỏng).', abits: 11, dbits: 8, pins: 24, writable: false, addr: DIP24_ADDR, data: DIP24_DATA, ctrl: { CS: 18, OE: 20 }, extra: '%VPP:21', power: 'VCC = 24, GND = 12', tacc: '450n', keywords: ['eprom', 'rom', '2k'] }),
  memPart({ id: 'misc-digital/2764', name: '2764', vi: 'EPROM 8K x 8', desc: '64-Kbit (8K x 8) UV EPROM: ~CE and ~OE low read the addressed byte (VPP and ~PGM are not simulated).', descVi: 'EPROM 64 Kbit (8K x 8): ~CE và ~OE thấp đọc byte có địa chỉ (chân VPP và ~PGM không mô phỏng).', abits: 13, dbits: 8, pins: 28, writable: false, addr: DIP28_ADDR.slice(0, 13), data: DIP28_DATA, ctrl: { CS: 20, OE: 22 }, extra: '%VPP:1 %PGM@~PGM:27', tacc: '250n', keywords: ['eprom', 'rom', '8k'] }),
  memPart({ id: 'misc-digital/27256', name: '27256', vi: 'EPROM 32K x 8', desc: '256-Kbit (32K x 8) UV EPROM: ~CE and ~OE low read the addressed byte (VPP is not simulated).', descVi: 'EPROM 256 Kbit (32K x 8): ~CE và ~OE thấp đọc byte có địa chỉ (chân VPP không mô phỏng).', abits: 15, dbits: 8, pins: 28, writable: false, addr: [10, 9, 8, 7, 6, 5, 4, 3, 25, 24, 21, 23, 2, 26, 27], data: DIP28_DATA, ctrl: { CS: 20, OE: 22 }, extra: '%VPP:1', tacc: '200n', keywords: ['eprom', 'rom', '32k'] }),
  memPart({ id: 'misc-digital/28c16', name: '28C16', vi: 'EEPROM song song 2K x 8', desc: '16-Kbit (2K x 8) parallel EEPROM: read like a ROM (~CE, ~OE low); a ~WE pulse with ~CE low writes a byte (the write cycle completes at once in the model).', descVi: 'EEPROM song song 16 Kbit (2K x 8): đọc như ROM (~CE, ~OE thấp); một xung ~WE khi ~CE thấp ghi một byte (chu kỳ ghi hoàn tất ngay trong mô hình).', abits: 11, dbits: 8, pins: 24, writable: true, addr: DIP24_ADDR, data: DIP24_DATA, ctrl: { CS: 18, OE: 20, WE: 21 }, power: 'VCC = 24, GND = 12', tacc: '150n', keywords: ['eeprom', '2k'] }),
  memPart({ id: 'misc-digital/28c64', name: '28C64', vi: 'EEPROM song song 8K x 8', desc: '64-Kbit (8K x 8) parallel EEPROM: read like a ROM; a ~WE pulse with ~CE low writes a byte (RDY/~BUSY is not simulated).', descVi: 'EEPROM song song 64 Kbit (8K x 8): đọc như ROM; xung ~WE khi ~CE thấp ghi một byte (chân RDY/~BUSY không mô phỏng).', abits: 13, dbits: 8, pins: 28, writable: true, addr: DIP28_ADDR.slice(0, 13), data: DIP28_DATA, ctrl: { CS: 20, OE: 22, WE: 27 }, extra: '%RDY@RDY/~BUSY:1', tacc: '150n', keywords: ['eeprom', '8k'] }),
];

/** 74LS670 4 x 4 register file (separate read / write addresses). */
const regFile670: LibraryPartDef = withMeta(
  {
    id: 'misc-digital/74ls670',
    name: '74LS670',
    group: 'misc-digital',
    family: 'Memory',
    description: '4 x 4 register file with 3-state outputs: ~GW low writes D1-D4 into the word addressed by WB WA; ~GR low drives the word addressed by RB RA on Q1-Q4 (reading and writing at the same time is allowed). Hidden power pins (VCC = 16, GND = 8) on the VCC net.',
    prefix: 'U',
    symbol: icSymbol('74LS670', side('WA:14 WB:13 ~GW:12 | RA:5 RB:4 ~GR:11 | D1:15 D2:1 D3:2 D4:3', 'input'), side('Q1:10 Q2:9 Q3:7 Q4:6', 'output'), { w: 100 }),
    params: [
      { ...textParam('data', 'Contents (hex)', '', { help: 'Initial memory contents: hex words, @address markers, hex-dump lines or Intel HEX (Edit contents… opens the hex editor)' }), fileImport: '.hex,.ihx,.txt,.mem', memory: { words: 4, bits: 4 } },
      ...powerParams('vccnet', 'VCC'),
    ],
    toSpice: (ctx) => {
      const image = memoryData(ctx, 4, 4);
      const b = new IcBuilder(ctx, levelsFor(ctx, FAMILIES.LS), 'MS_74LS670', powerNodes(ctx, 'vccnet', 'VCC'));
      const m = b.model('D_REGFILE', 2.5, { abits: 2, dbits: 4 });
      const card = b.models.find((c) => c.name === m)!;
      const named = { ...card, name: `${card.name}_${hash8(image)}`, stringParams: { data: image } };
      b.models.splice(b.models.indexOf(card), 1, named);
      b.add(undefined, ['WA', 'WB', 'RA', 'RB', 'D1', 'D2', 'D3', 'D4', 'GW', 'GR', 'Q1', 'Q2', 'Q3', 'Q4'], named.name);
      return { elements: b.elements, models: b.models };
    },
    footprint: 'DIP-16',
    keywords: ['register file', 'memory', '74670', 'ttl'],
    provenance: 'MachSim register-file code model (D_REGFILE) with 74LS levels and typical delays; public datasheet pinout',
  },
  { vi: 'Tệp thanh ghi 4 x 4 ngõ ra ba trạng thái: ~GW thấp ghi D1-D4 vào từ có địa chỉ WB WA; ~GR thấp đưa từ có địa chỉ RB RA ra Q1-Q4 (đọc và ghi đồng thời được).', specs: { words: 4, bits: 4, positions: 16, package: 'DIP-16' }, sortKey: 16, series: 'Memory IC' },
);

// ---------------------------------------------------------------------------------------------
// programmable logic

function pldPart(nIn: number, nOut: number, example: string, exampleVi: string): LibraryPartDef {
  const ins = names('I', nIn);
  const outs = names('O', nOut);
  const left: IcPin[] = [...ins.map((n) => ({ name: n, type: 'input' as const })), { name: 'CLK', type: 'input', clock: true }, { name: 'OE', label: '~OE', type: 'input' }];
  const right: IcPin[] = outs.map((n) => ({ name: n, type: 'output' as const }));
  const help = 'Boolean equations, one per line: O0 = I0 & I1 | !I2 (combinational), O1 := O1 ^ I0 (registered on CLK), O2.oe = I3 (output enable); or a truth table (header "I1 I0 | O0", rows of 0 / 1 / -)';
  return withMeta(
    {
      id: `misc-digital/pld-${nIn}x${nOut}`,
      name: `PLD ${nIn}x${nOut}`,
      group: 'misc-digital',
      family: 'PLD',
      description: `Programmable logic block with ${nIn} inputs, ${nOut} outputs, a clock for registered outputs and an active-low output enable. Write the logic as Boolean equations or as a truth table. ${example}`,
      prefix: 'U',
      virtual: true,
      symbol: icSymbol('PLD', left, right, { w: 80 }),
      params: [
        { ...textParam('program', 'Logic program', example.replace(/^Example: /, '').replace(/\. /g, '\n'), { help }), fileImport: '.pld,.eqn,.txt' },
        numParam('delay', 'Propagation delay', '10n', 's', { min: 0, group: 'model' }),
        numParam('vhigh', 'Output high level', '5', 'V', { min: 0.1, group: 'model' }),
        numParam('threshold', 'Input threshold', '2.5', 'V', { group: 'model' }),
      ],
      optionalPins: ['CLK', 'OE', ...ins, ...outs],
      toSpice: (ctx) => {
        const prog = compileLogicProgram(ctx.params.program ?? '', nIn, nOut);
        if (prog.errors.length) throw new Error(`bad value for program: ${prog.errors[0]}`);
        const text = programText(prog).replace(/\n/g, '; ');
        const vhigh = ctx.num('vhigh');
        if (!(vhigh > 0)) throw new Error('bad value for vhigh: must be > 0');
        const lv: FamilyLevels = idealLevels(vhigh, Math.max(0, ctx.num('delay')), ctx.num('threshold'));
        const base = familyModel(`MS_PLD${nIn}X${nOut}`, 'D_PLD', lv, 1, { n_in: nIn, n_out: nOut });
        const card = { ...base, name: `${base.name}_${hash8(text)}`, stringParams: { program: text } };
        const ports = [...ins, 'CLK', 'OE', ...outs].map((p) => (p === 'OE' || p === 'CLK' ? optionalPinNode(ctx, p) : ctx.node(p)));
        return { elements: [aElement(ctx.name('A'), ports, { nodes: ['0'], pwr: 1 }, card.name)], models: [card] };
      },
      keywords: ['pld', 'gal', 'pal', 'programmable logic', 'boolean equation', 'truth table', 'cpld'],
      provenance: 'MachSim programmable-logic code model (D_PLD): equations compiled from the program text, ideal levels',
    },
    { vi: `Khối logic lập trình được có ${nIn} đầu vào, ${nOut} ngõ ra, xung nhịp cho ngõ ra có thanh ghi và chân cho phép ngõ ra tích cực thấp. Viết logic bằng phương trình Boole hoặc bảng sự thật. ${exampleVi}`, nameVi: `PLD ${nIn}x${nOut}`, specs: { positions: nIn + nOut + 2 }, sortKey: nIn * nOut, series: 'PLD' },
  );
}

/** Node of a pin that may stay unconnected: XSPICE NULL when open. */
function optionalPinNode(ctx: ToSpiceContext, pin: string): string {
  const ext = ctx as ToSpiceContext & { connected?(p: string): boolean };
  return typeof ext.connected === 'function' && !ext.connected(pin) ? 'null' : ctx.node(pin);
}

const PLDS: LibraryPartDef[] = [
  pldPart(2, 2, 'Example: O0 = I0 ^ I1. O1 = I0 & I1', 'Ví dụ có sẵn: bộ cộng bán phần (O0 = tổng, O1 = nhớ).'),
  pldPart(4, 4, 'Example: O0 = I0 ^ I1. O1 = I0 & I1. O2 := !O2. O3 := O3 ^ O2', 'Ví dụ có sẵn: bộ cộng bán phần (O0 = tổng, O1 = nhớ) và bộ đếm 2 bit trên O2, O3.'),
  pldPart(8, 8, 'Example: O0 = I0 & I1 | I2 & I3. O1 = !(I4 | I5). O2 = I6 ^ I7. O3 := !O3', 'Ví dụ có sẵn: hàm AND-OR trên O0, NOR trên O1, XOR trên O2 và bộ chia đôi tần số trên O3.'),
  pldPart(16, 8, 'Example: O0 = I0 & I1 & I2 & I3. O1 = I4 | I5 | I6 | I7. O2 := O2 ^ I8', 'Ví dụ có sẵn: AND 4 ngõ vào trên O0, OR 4 ngõ vào trên O1 và ngõ ra có thanh ghi đảo theo I8 trên O2.'),
];

// ---------------------------------------------------------------------------------------------
// line drivers and receivers

interface LineSpec {
  id: string;
  name: string;
  family: 'Line driver' | 'Line receiver' | 'Line transceiver';
  desc: string;
  vi: string;
  pins: number;
  power: string;
  left: string;
  right: string;
  optional?: string[];
  params?: ParamDef[];
  keywords: string[];
  build(b: IcBuilder): void;
}

const RS232 = (b: IcBuilder): FamilyLevels => {
  const v = b.ctx.num('vout');
  return { ...b.levels, vol: -v, voh: v, vnom: v, rlow: 300, rhigh: 300, tr: 1e-6, tf: 1e-6, tplh: 200e-9, tphl: 200e-9 };
};

function linePart(s: LineSpec): LibraryPartDef {
  return withMeta(
    {
      id: `misc-digital/${s.id}`,
      name: s.name,
      group: 'misc-digital',
      family: s.family,
      description: `${s.desc} Hidden power pins (${s.power}) on the VCC net.`,
      prefix: 'U',
      symbol: icSymbol(s.name, side(s.left, 'input'), side(s.right, 'output'), { w: 100 }),
      params: [...(s.params ?? []), ...powerParams('vccnet', 'VCC')],
      toSpice: (ctx) => {
        // the interface levels do not follow the logic supply: outputs run at their nominal levels
        // (powerNodes still reports a missing supply net in real digital mode)
        powerNodes(ctx, 'vccnet', 'VCC');
        const b = new IcBuilder(ctx, levelsFor(ctx, FAMILIES.HCT), `MS_${s.name.toUpperCase()}`, { nodes: ['0'], pwr: 1 });
        s.build(b);
        return { elements: b.elements, models: b.models };
      },
      optionalPins: s.optional,
      footprint: `DIP-${s.pins}`,
      keywords: ['line driver', 'interface', ...s.keywords],
      provenance: 'MachSim behavioural interface model: TTL inputs, standard RS-232 / RS-422 / RS-485 levels and thresholds from public datasheet figures',
    },
    { vi: s.vi, specs: { positions: s.pins, package: `DIP-${s.pins}` }, sortKey: s.pins, series: s.family },
  );
}

const voutParam = (): ParamDef => numParam('vout', 'Output swing (±)', '9', 'V', { min: 1, max: 15, group: 'model', help: 'Magnitude of the RS-232 output levels (the charge pump / ±12 V supplies are not simulated)' });

const LINE: LibraryPartDef[] = [
  linePart({
    id: 'mc1488',
    name: 'MC1488',
    family: 'Line driver',
    desc: 'Quad RS-232 line driver: gate 1 inverts, gates 2-4 are NAND; a TTL high gives −9 V, a low +9 V at the line output (VCC / VEE pins are drawn for wiring only).',
    vi: 'Bốn bộ lái đường dây RS-232: cổng 1 là cổng đảo, cổng 2-4 là NAND; mức TTL cao cho −9 V, mức thấp cho +9 V ở ngõ ra đường dây (chân VCC / VEE chỉ để nối dây).',
    pins: 14,
    power: 'VCC = 14, GND = 7',
    left: '1A:2 | 2A:4 2B:5 | 3A:9 3B:10 | 4A:12 4B:13 | %VEE:1',
    right: '1Y:3 | | 2Y:6 | | 3Y:8 | | 4Y:11',
    optional: ['VEE'],
    params: [voutParam()],
    keywords: ['rs-232', 'rs232', 'serial', 'uart'],
    build: (b) => {
      const lv = RS232(b);
      b.add('1', ['1A', '1Y'], b.model('D_INVERTER', 1, {}, lv));
      const m = b.model('D_NAND', 1, {}, lv);
      for (const k of [2, 3, 4]) b.add(String(k), [`${k}A`, `${k}B`, `${k}Y`], m);
    },
  }),
  linePart({
    id: 'mc1489',
    name: 'MC1489',
    family: 'Line receiver',
    desc: 'Quad RS-232 line receiver: inverting with hysteresis (VT+ ≈ 1.25 V, VT- ≈ 1.0 V), 5 kΩ input to ground, TTL outputs (response-control pins are drawn for wiring only).',
    vi: 'Bốn bộ thu đường dây RS-232: đảo mức có trễ (VT+ ≈ 1,25 V, VT- ≈ 1,0 V), trở vào 5 kΩ xuống đất, ngõ ra mức TTL (chân điều chỉnh đáp ứng chỉ để nối dây).',
    pins: 14,
    power: 'VCC = 14, GND = 7',
    left: '1A:1 %1RC:2 | 2A:4 %2RC:5 | 3A:10 %3RC:9 | 4A:13 %4RC:12',
    right: '1Y:3 | | 2Y:6 | | 3Y:8 | | 4Y:11',
    optional: ['1RC', '2RC', '3RC', '4RC'],
    keywords: ['rs-232', 'rs232', 'serial', 'receiver'],
    build: (b) => {
      const m = b.model('D_SCHMITT_INV', 3, { vtp: 1.25, vtn: 1.0, rin: 5e3, vin_float: 0 });
      for (const k of [1, 2, 3, 4]) b.add(String(k), [`${k}A`, `${k}Y`], m);
    },
  }),
  linePart({
    id: 'max232',
    name: 'MAX232',
    family: 'Line transceiver',
    desc: 'Dual RS-232 driver / receiver with charge pump (5 V supply): T1IN / T2IN (TTL) give inverted ±9 V line outputs, R1IN / R2IN (±25 V) give inverted TTL outputs (thresholds 1.7 / 1.2 V). The charge-pump capacitor pins are drawn for wiring only.',
    vi: 'Hai bộ lái / thu RS-232 có bơm điện tích (nguồn 5 V): T1IN / T2IN (TTL) cho ngõ ra đường dây ±9 V đảo mức, R1IN / R2IN (±25 V) cho ngõ ra TTL đảo mức (ngưỡng 1,7 / 1,2 V). Các chân tụ bơm điện tích chỉ để nối dây.',
    pins: 16,
    power: 'VCC = 16, GND = 15',
    left: 'T1IN:11 T2IN:10 | R1IN:13 R2IN:8 | %C1P@C1+:1 %C1N@C1-:3 %C2P@C2+:4 %C2N@C2-:5 %VP@V+:2 %VN@V-:6',
    right: 'T1OUT:14 T2OUT:7 | R1OUT:12 R2OUT:9',
    optional: ['C1P', 'C1N', 'C2P', 'C2N', 'VP', 'VN'],
    params: [voutParam()],
    keywords: ['rs-232', 'rs232', 'serial', 'uart', 'transceiver', 'max232'],
    build: (b) => {
      const lv = RS232(b);
      const d = b.model('D_INVERTER', 1, {}, lv);
      b.add('t1', ['T1IN', 'T1OUT'], d);
      b.add('t2', ['T2IN', 'T2OUT'], d);
      const r = b.model('D_SCHMITT_INV', 3, { vtp: 1.7, vtn: 1.2, rin: 5e3, vin_float: 0 });
      b.add('r1', ['R1IN', 'R1OUT'], r);
      b.add('r2', ['R2IN', 'R2OUT'], r);
    },
  }),
  linePart({
    id: 'sn75176',
    name: 'SN75176',
    family: 'Line transceiver',
    desc: 'RS-485 / RS-422 differential bus transceiver: DE high drives A = DI, B = ~DI; the receiver output RO = 1 when V(A) − V(B) > +0.2 V, 0 below −0.2 V, enabled while ~RE is low.',
    vi: 'Bộ thu phát bus vi sai RS-485 / RS-422: DE cao thì lái A = DI, B = ~DI; ngõ thu RO = 1 khi V(A) − V(B) > +0,2 V, = 0 khi dưới −0,2 V, hoạt động khi ~RE thấp.',
    pins: 8,
    power: 'VCC = 8, GND = 5',
    left: 'DI:4 DE:3 ~RE:2',
    right: '=A:6 =B:7 | RO:1',
    keywords: ['rs-485', 'rs485', 'rs-422', 'modbus', 'max485', 'differential'],
    build: (b) => {
      const drv = b.model('D_TRISTATE', 1.5, { rlow: 25, rhigh: 25 });
      const inv = b.model('D_TRISTATE', 1.5, { rlow: 25, rhigh: 25, invert: 1 });
      b.add('da', ['DI', 'DE', 'A'], drv);
      b.add('db', ['DI', 'DE', 'B'], inv);
      const ro = b.node('ro');
      b.addNodes('rx', [b.n('A'), b.n('B'), ro], b.model('D_COMPARATOR', 2, { vhys: 0.07 }));
      b.addNodes('re', [ro, b.n('RE'), b.n('RO')], b.model('D_TRISTATE', 0.5, { enable_low: 1 }));
    },
  }),
  linePart({
    id: '26ls31',
    name: '26LS31',
    family: 'Line driver',
    desc: 'Quad RS-422 differential line driver with 3-state outputs: Y = A, Z = ~A while G is high or ~G is low.',
    vi: 'Bốn bộ lái đường dây vi sai RS-422 ngõ ra ba trạng thái: Y = A, Z = ~A khi G cao hoặc ~G thấp.',
    pins: 16,
    power: 'VCC = 16, GND = 8',
    left: '1A:1 2A:7 3A:9 4A:15 | G:4 ~GN@~G:12',
    right: '1Y:2 1Z:3 | 2Y:6 2Z:5 | 3Y:10 3Z:11 | 4Y:14 4Z:13',
    keywords: ['rs-422', 'differential', 'line driver', 'am26ls31'],
    build: (b) => {
      const en = b.node('en');
      const gn = b.node('gn');
      b.addNodes('gn', [b.n('GN'), gn], b.model('D_INVERTER', 0.2));
      b.addNodes('en', [b.n('G'), gn, en], b.model('D_OR', 0.2));
      const y = b.model('D_TRISTATE', 1.5, { rlow: 25, rhigh: 25 });
      const z = b.model('D_TRISTATE', 1.5, { rlow: 25, rhigh: 25, invert: 1 });
      for (const k of [1, 2, 3, 4]) {
        b.addNodes(`y${k}`, [b.n(`${k}A`), en, b.n(`${k}Y`)], y);
        b.addNodes(`z${k}`, [b.n(`${k}A`), en, b.n(`${k}Z`)], z);
      }
    },
  }),
  linePart({
    id: '26ls32',
    name: '26LS32',
    family: 'Line receiver',
    desc: 'Quad RS-422 differential line receiver with 3-state outputs: Y = 1 when V(A) − V(B) > +0.2 V, 0 below −0.2 V, enabled while G is high or ~G is low.',
    vi: 'Bốn bộ thu đường dây vi sai RS-422 ngõ ra ba trạng thái: Y = 1 khi V(A) − V(B) > +0,2 V, = 0 khi dưới −0,2 V, hoạt động khi G cao hoặc ~G thấp.',
    pins: 16,
    power: 'VCC = 16, GND = 8',
    left: '1A:2 1B:1 | 2A:6 2B:7 | 3A:10 3B:9 | 4A:14 4B:15 | G:4 ~GN@~G:12',
    right: '1Y:3 | | 2Y:5 | | 3Y:11 | | 4Y:13',
    keywords: ['rs-422', 'differential', 'line receiver', 'am26ls32'],
    build: (b) => {
      const en = b.node('en');
      const gn = b.node('gn');
      b.addNodes('gn', [b.n('GN'), gn], b.model('D_INVERTER', 0.2));
      b.addNodes('en', [b.n('G'), gn, en], b.model('D_OR', 0.2));
      const cmp = b.model('D_COMPARATOR', 2, { vhys: 0.07 });
      const out = b.model('D_TRISTATE', 0.5);
      for (const k of [1, 2, 3, 4]) {
        const x = b.node(`r${k}`);
        b.addNodes(`c${k}`, [b.n(`${k}A`), b.n(`${k}B`), x], cmp);
        b.addNodes(`o${k}`, [x, en, b.n(`${k}Y`)], out);
      }
    },
  }),
];

/** Memories, programmable logic and line interfaces of the misc-digital group. */
export const DIGITAL_MISC_CATALOG: LibraryPartDef[] = [...MEMORIES, regFile670, ...PLDS, ...LINE];
