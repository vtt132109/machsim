/**
 * Microcontroller catalogue: an 8051-compatible part whose ports P0…P3 are ordinary digital pins,
 * co-simulated with the circuit by the `D_MCU8051` code model (src/sim/devices/digital/mcu.ts,
 * core in src/mcu).
 *
 * Two parts, same model:
 *  - **MCU 8051** — the whole 40-pin device: P0…P3, RST, EA, XTAL1 / XTAL2 and the wiring-only
 *    ALE / PSEN pins, with the published 40-pin DIP pin numbers for the BOM and the PCB netlist.
 *  - **MCU 8051 (P1)** — a small symbol for lessons and first experiments: P1, RST and the serial
 *    and INT0 pins of port 3. The pins it does not show are unconnected (XSPICE NULL), so the same
 *    program behaves the same way.
 *
 * Parameters
 *   `program`   the program: MCS-51 assembly source (assembled by src/mcu/asm8051.ts) or Intel HEX
 *               text; it is stored in the .msim with the instance, and the code editor panel
 *               (src/ui/mcu) edits it.
 *   `fosc`      crystal frequency; one machine cycle is 12 oscillator periods, so the default
 *               12 MHz gives the classic 1 µs machine cycle.
 *   `xram`      bytes of external data memory for MOVX (0 = none).
 *   `pdrive`    `real` = quasi-bidirectional ports like the real part (driven low, released high
 *               through the internal pull-up, so an LED must be wired from the supply to the pin);
 *               `pushpull` = symmetric drive, easier for a first experiment.
 *   `debug`     publish the registers, the SFRs and a RAM window as read-out vectors for the
 *               code editor panel (switch it off for the fastest possible run).
 *
 * No part number, package artwork or data of any commercial product is used: the pinout and the
 * instruction set are the published MCS-51 architecture, the symbol is MachSim's own line art.
 */
import { buildProgram, encodeImage, programOk } from '../../mcu/program';
import { boolParam, hash8, numParam, selectParam, textParam, PartErcError, type LibraryPartDef } from '../partkit';
import type { ParamDef, ToSpiceContext } from '../types';
import { FAMILIES, aElement, familyModel, icSymbol, levelsFor, powerNodes, powerParams, type IcPin } from '../parts/digital/kit';
import { withMeta } from './kit';

/** Default program: the blink every learner starts with (Vietnamese comments). */
export const DEFAULT_MCU_PROGRAM = [
  '; Nháy LED ở chân P1.0 — chương trình mẫu của MachSim.',
  '; Thạch anh 12 MHz nên 1 chu kỳ máy = 1 µs.',
  '; LED nối từ nguồn +5 V qua điện trở 330 Ω xuống chân P1.0:',
  '; chân ở mức 0 thì LED sáng (chân 8051 chỉ hút dòng tốt).',
  '',
  '        ORG  0',
  'MAIN:   CPL  P1.0          ; đảo trạng thái chân P1.0',
  '        ACALL DELAY        ; chờ khoảng 100 ms',
  '        SJMP MAIN',
  '',
  'DELAY:  MOV  R7,#200       ; 200 x 503 chu kỳ máy ~ 100 ms',
  'D1:     MOV  R6,#250',
  'D2:     DJNZ R6,D2',
  '        DJNZ R7,D1',
  '        RET',
  '        END',
].join('\n');

/** Node order of the D_MCU8051 element: P0.0 … P3.7, then RST and EA. */
export function mcuPortOrder(): string[] {
  const out: string[] = [];
  for (let port = 0; port < 4; port++) for (let bit = 0; bit < 8; bit++) out.push(`P${port}.${bit}`);
  out.push('RST', 'EA');
  return out;
}

/** Extra function names drawn next to the port-3 pins. */
const P3_ALT = ['RXD', 'TXD', 'INT0', 'INT1', 'T0', 'T1', 'WR', 'RD'];
/** 40-pin DIP numbers of the published MCS-51 pinout. */
const P1_NUM = ['1', '2', '3', '4', '5', '6', '7', '8'];
const P3_NUM = ['10', '11', '12', '13', '14', '15', '16', '17'];
const P2_NUM = ['21', '22', '23', '24', '25', '26', '27', '28'];
const P0_NUM = ['39', '38', '37', '36', '35', '34', '33', '32'];

const XRAM_OPTIONS: [string, string][] = [
  ['0', 'None (MOVX reads 0FFh)'],
  ['256', '256 bytes'],
  ['2048', '2 KB'],
  ['32768', '32 KB'],
  ['65536', '64 KB'],
];

function params(): ParamDef[] {
  return [
    {
      ...textParam('program', 'Program', DEFAULT_MCU_PROGRAM, {
        group: 'value',
        help: 'MCS-51 assembly source or Intel HEX text. Open the code editor (Edit program…) to assemble it, see the errors and run it step by step.',
      }),
      fileImport: '.asm,.a51,.s,.src,.hex,.ihx,.txt',
    },
    numParam('fosc', 'Crystal frequency', '12M', 'Hz', { min: 1e5, max: 60e6, group: 'value', help: 'One machine cycle is 12 oscillator periods: 12 MHz gives a 1 µs machine cycle, 11.0592 MHz gives exact serial baud rates' }),
    selectParam('xram', 'External RAM (MOVX)', '0', XRAM_OPTIONS, { group: 'model', help: 'Data memory reached with MOVX; the address and data buses are not drawn, the memory is inside the model' }),
    selectParam('pdrive', 'Port drive', 'real', [
      ['real', 'Quasi-bidirectional (like the real part)'],
      ['pushpull', 'Push-pull (easier for experiments)'],
    ], { group: 'model', help: 'Real ports pull a pin down strongly and let it float up through a weak pull-up, so a load must be wired to the supply; push-pull drives both levels' }),
    numParam('pullup', 'Internal pull-up', '50k', 'Ω', { min: 100, group: 'model', help: 'Pull-up of the released P1 / P2 / P3 pins (port 0 has none and needs an external pull-up)' }),
    boolParam('debug', 'Register read-outs', true, { group: 'advanced', help: 'Publish the registers, the SFRs and a RAM window as result vectors so the code editor can show them while the simulation runs' }),
    numParam('ahead', 'Look-ahead', '20k', '', { min: 10, max: 1e6, group: 'advanced', help: 'Machine cycles the core may run ahead to find when the program next changes a pin (a timepoint is placed there)' }),
    ...powerParams('vccnet', 'VCC'),
  ];
}

function toSpice(ctx: ToSpiceContext, shown: ReadonlySet<string>): ReturnType<NonNullable<LibraryPartDef['toSpice']>> {
  const build = buildProgram(ctx.params.program ?? '');
  if (!programOk(build)) {
    const first = build.asmErrors[0] ?? build.hexErrors[0];
    throw new PartErcError(`the program has an error on line ${first.line} (${first.code})`, 'mcuProgram', { line: first.line, code: first.code });
  }
  const image = encodeImage(build);
  const fosc = ctx.num('fosc');
  if (!(fosc > 0)) throw new Error('bad value for fosc: must be > 0');
  const pullup = ctx.num('pullup');
  const xram = Number.parseInt(ctx.params.xram ?? '0', 10) || 0;
  const pushPull = (ctx.params.pdrive ?? 'real').trim().toLowerCase() === 'pushpull';
  const debug = (ctx.params.debug ?? 'true').trim().toLowerCase() !== 'false';
  const ahead = Math.max(10, Math.round(ctx.num('ahead')));
  const lv = levelsFor(ctx, FAMILIES.HCT);
  const base = familyModel('MS_MCU8051', 'D_MCU8051', lv, 1, {
    fosc,
    xram,
    pullup,
    pdrive: pushPull ? 1 : 0,
    debug: debug ? 1 : 0,
    ahead,
  });
  const card = { ...base, name: `${base.name}_${hash8(image)}`, stringParams: { code: image } };
  const ext = ctx as ToSpiceContext & { connected?(p: string): boolean };
  const node = (pin: string): string => {
    const known = typeof ext.connected === 'function';
    if (known && !ext.connected!(pin)) return 'null';
    return ctx.node(pin);
  };
  const power = powerNodes(ctx, 'vccnet', 'VCC');
  const ports = mcuPortOrder().map((p) => (shown.has(p) ? node(p) : 'null'));
  return { elements: [aElement(ctx.name('A'), ports, power, card.name)], models: [card] };
}

const inPin = (name: string, number?: string, label?: string): IcPin => ({ name, number, label, type: 'bidir' });

/** The full 40-pin device. */
function fullMcu(): LibraryPartDef {
  const left: (IcPin | null)[] = [
    { name: 'RST', number: '9', type: 'input' },
    { name: 'EA', label: '~EA', number: '31', type: 'input' },
    { name: 'XTAL1', number: '19', type: 'input' },
    { name: 'XTAL2', number: '18', type: 'output' },
    null,
    ...P1_NUM.map((n, k) => inPin(`P1.${k}`, n)),
    null,
    ...P3_NUM.map((n, k) => inPin(`P3.${k}`, n, `P3.${k}/${P3_ALT[k]}`)),
  ];
  const right: (IcPin | null)[] = [
    ...P0_NUM.map((n, k) => inPin(`P0.${k}`, n)),
    null,
    ...P2_NUM.map((n, k) => inPin(`P2.${k}`, n)),
    null,
    { name: 'ALE', number: '30', type: 'output' },
    { name: 'PSEN', label: '~PSEN', number: '29', type: 'output' },
  ];
  const all = mcuPortOrder();
  const allSet = new Set(all);
  return withMeta(
    {
      id: 'misc-digital/mcu-8051',
      name: 'MCU 8051',
      group: 'misc-digital',
      family: 'Microcontroller',
      description:
        'MCS-51 compatible microcontroller co-simulated with the circuit: ports P0…P3 are digital pins, the program is MCS-51 assembly or Intel HEX in the Program parameter, and the Code editor panel assembles it, runs it step by step and shows the registers, the RAM and a serial terminal. RST is active high, ~EA selects internal code when it is high or unconnected; XTAL1 / XTAL2, ALE and ~PSEN are drawn for wiring only (the crystal frequency is a parameter). Hidden power pins (VCC = 40, GND = 20) on the VCC net.',
      prefix: 'U',
      symbol: icSymbol('MCU 8051', left, right, { w: 140 }),
      params: params(),
      toSpice: (ctx) => toSpice(ctx, allSet),
      optionalPins: [...all, 'XTAL1', 'XTAL2', 'ALE', 'PSEN'],
      footprint: 'DIP-40',
      keywords: ['mcu', 'microcontroller', '8051', 'mcs-51', '8052', 'vi dieu khien', 'assembler', 'firmware', 'intel hex'],
      provenance: 'MachSim 8051-compatible core written from the published MCS-51 instruction set (src/mcu); 40-pin DIP pin numbers from the public pinout',
      mcu: { kind: '8051', programParam: 'program' },
    },
    {
      vi: 'Vi điều khiển tương thích MCS-51 (8051) mô phỏng cùng mạch: các cổng P0…P3 là chân số, chương trình viết bằng hợp ngữ MCS-51 hoặc dán mã Intel HEX vào tham số Chương trình. Bảng Trình soạn mã dịch chương trình, chạy từng lệnh và hiện thanh ghi, RAM, cửa sổ nối tiếp. Chân RST tích cực cao; ~EA để hở hoặc mức cao thì chạy mã trong chip. XTAL1 / XTAL2, ALE, ~PSEN chỉ để vẽ (tần số thạch anh là tham số). Chân nguồn ẩn (VCC = 40, GND = 20) nối net VCC.',
      nameVi: 'Vi điều khiển 8051',
      specs: { positions: 40, package: 'DIP-40' },
      sortKey: 40,
      series: 'Microcontroller',
    },
  );
}

/** Compact symbol for lessons: P1, RST and the serial / INT0 pins. */
function miniMcu(): LibraryPartDef {
  const shown = ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5', 'P1.6', 'P1.7', 'P3.0', 'P3.1', 'P3.2', 'RST'];
  const shownSet = new Set(shown);
  const left: (IcPin | null)[] = [
    { name: 'RST', type: 'input' },
    null,
    { name: 'P3.0', label: 'P3.0/RXD', type: 'bidir' },
    { name: 'P3.1', label: 'P3.1/TXD', type: 'bidir' },
    { name: 'P3.2', label: 'P3.2/INT0', type: 'bidir' },
  ];
  const right: (IcPin | null)[] = P1_NUM.map((_n, k) => inPin(`P1.${k}`));
  return withMeta(
    {
      id: 'misc-digital/mcu-8051-p1',
      name: 'MCU 8051 (P1)',
      group: 'misc-digital',
      family: 'Microcontroller',
      description:
        'The same 8051-compatible microcontroller with a small symbol for lessons: port 1, the reset pin and the serial / interrupt pins of port 3. The pins that are not drawn stay unconnected, so a program written for the full part behaves the same way here.',
      prefix: 'U',
      virtual: true,
      symbol: icSymbol('8051', left, right, { w: 120 }),
      params: params(),
      toSpice: (ctx) => toSpice(ctx, shownSet),
      optionalPins: shown,
      keywords: ['mcu', 'microcontroller', '8051', 'mcs-51', 'vi dieu khien', 'lesson', 'bai hoc'],
      provenance: 'MachSim 8051-compatible core written from the published MCS-51 instruction set (src/mcu)',
      mcu: { kind: '8051', programParam: 'program' },
    },
    {
      vi: 'Cùng vi điều khiển 8051 nhưng ký hiệu gọn cho bài học: cổng 1, chân reset và các chân nối tiếp / ngắt của cổng 3. Những chân không vẽ coi như để hở, nên chương trình viết cho bản đầy đủ vẫn chạy như vậy.',
      nameVi: 'Vi điều khiển 8051 (P1)',
      specs: { positions: 13 },
      sortKey: 13,
      series: 'Microcontroller',
    },
  );
}

export const MCU_CATALOG: LibraryPartDef[] = [fullMcu(), miniMcu()];
