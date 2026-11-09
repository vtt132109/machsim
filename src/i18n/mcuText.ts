/**
 * Texts of the microcontroller code editor and of the PLD wizard, Vietnamese first. Loaded with
 * those panels (lazy chunks) so the start-up catalogue stays small; the menu and command labels
 * live in messages/mcu.ts. Original text written for MachSim.
 *
 *   mt('build')                     text in the current language
 *   mt('asm.rangeByte', { text })   {placeholders} filled
 */
import { interpolate, L, tr, type LocalizedText } from './core';
import type { AsmError, AsmErrorCode } from '../mcu/asm8051';
import type { HexError } from '../mcu/hex';

export const MCU_TEXT = {
  // ---- panel frame
  title: L('Trình soạn mã vi điều khiển', 'MCU code editor'),
  intro: L(
    'Viết chương trình bằng hợp ngữ MCS-51 (hoặc dán mã Intel HEX), nhấn Dịch, rồi chạy mô phỏng để xem vi điều khiển điều khiển mạch.',
    'Write the program in MCS-51 assembly (or paste Intel HEX), press Build, then run the simulation to watch the microcontroller drive the circuit.',
  ),
  part: L('Vi điều khiển', 'Microcontroller'),
  tipPart: L('Chọn vi điều khiển trên sơ đồ mà bảng này đang làm việc với.', 'Choose the microcontroller on the schematic that this panel works on.'),
  program: L('Chương trình', 'Program'),
  tipProgram: L(
    'Mã nguồn hợp ngữ MCS-51. Nhãn kết thúc bằng dấu hai chấm, chú thích bắt đầu bằng dấu chấm phẩy. Chương trình được lưu trong tệp .msim cùng linh kiện.',
    'MCS-51 assembly source. A label ends with a colon, a comment starts with a semicolon. The program is saved in the .msim file with the part.',
  ),
  build: L('Dịch', 'Build'),
  tipBuild: L('Dịch chương trình và nạp vào vi điều khiển (Ctrl+Enter).', 'Assemble the program and load it into the microcontroller (Ctrl+Enter).'),
  revert: L('Lấy lại từ sơ đồ', 'Reload from the schematic'),
  tipRevert: L('Bỏ các thay đổi chưa dịch và lấy lại chương trình đang nằm trong linh kiện.', 'Throw away the unbuilt changes and take the program that is in the part again.'),
  openFile: L('Mở tệp…', 'Open file…'),
  tipOpenFile: L('Nạp mã nguồn hợp ngữ (.asm, .a51) hoặc tệp Intel HEX (.hex) vào ô chương trình.', 'Load assembly source (.asm, .a51) or an Intel HEX file (.hex) into the program box.'),
  saveHex: L('Lưu Intel HEX…', 'Save Intel HEX…'),
  tipSaveHex: L('Ghi mã máy đã dịch thành tệp .hex để nạp vào chip thật.', 'Write the assembled machine code to a .hex file for a real chip.'),
  saveListing: L('Lưu bảng dịch…', 'Save listing…'),
  tipSaveListing: L('Ghi bảng địa chỉ — mã máy — dòng lệnh ra tệp văn bản.', 'Write the address / machine code / source listing to a text file.'),
  help: L('Trợ giúp', 'Help'),

  // ---- build output
  output: L('Kết quả dịch', 'Build output'),
  ok: L('Dịch xong: {bytes} byte mã máy, từ địa chỉ {start} đến {end}.', 'Built: {bytes} bytes of machine code, from address {start} to {end}.'),
  okHex: L('Đã đọc {bytes} byte từ mã Intel HEX (địa chỉ {start}…{end}).', 'Read {bytes} bytes of Intel HEX (addresses {start}…{end}).'),
  empty: L('Chương trình đang trống. Vi điều khiển sẽ chạy toàn lệnh NOP.', 'The program is empty. The microcontroller will run nothing but NOPs.'),
  errorCount: L('{n} lỗi — sửa dòng được đánh dấu rồi nhấn Dịch lại.', '{n} error(s) — fix the marked lines and press Build again.'),
  lineLabel: L('Dòng {line}', 'Line {line}'),
  unsaved: L('Chương trình đã sửa nhưng chưa dịch.', 'The program was edited but not built yet.'),
  tooLongWarning: L('Chương trình dài hơn bộ nhớ mã 64 KB.', 'The program is longer than the 64 KB of code memory.'),

  // ---- views
  tabRegisters: L('Thanh ghi', 'Registers'),
  tabSfr: L('Thanh ghi đặc biệt', 'Special registers'),
  tabRam: L('RAM trong', 'Internal RAM'),
  tabPorts: L('Cổng', 'Ports'),
  tabTerminal: L('Cửa sổ nối tiếp', 'Serial terminal'),
  tabListing: L('Bảng dịch', 'Listing'),
  tabSymbols: L('Ký hiệu', 'Symbols'),
  cycles: L('Chu kỳ máy', 'Machine cycles'),
  simTime: L('Thời gian đã chạy', 'Time run'),
  flags: L('Cờ', 'Flags'),
  bank: L('Băng thanh ghi', 'Register bank'),
  halted: L('Vi điều khiển đã dừng: gặp mã lệnh không tồn tại tại địa chỉ {pc}.', 'The microcontroller stopped: undefined opcode at address {pc}.'),
  haltedStack: L('Vi điều khiển đã dừng: ngăn xếp tràn (SP quay về 0).', 'The microcontroller stopped: the stack overflowed (SP wrapped to 0).'),
  ramFrom: L('Từ địa chỉ', 'From address'),
  tipRamFrom: L('Địa chỉ đầu của 16 byte RAM đang xem (00h…F0h).', 'First address of the 16 RAM bytes shown (00h…F0h).'),
  ramHint: L('00h–1Fh là bốn băng thanh ghi, 20h–2Fh là vùng bit, 30h–7Fh là RAM dùng chung.', '00h–1Fh are the four register banks, 20h–2Fh the bit area, 30h–7Fh the general RAM.'),
  portHint: L('Giá trị các cổng đang phát ra chân. Chân ở mức 0 được kéo xuống mạnh, mức 1 chỉ được treo lên qua điện trở trong.', 'The levels the ports drive. A pin at 0 is pulled down hard; a pin at 1 is only held up through the internal pull-up.'),

  // ---- run control
  mode: L('Cách chạy', 'Run mode'),
  modeLive: L('Cùng mạch (mô phỏng)', 'With the circuit (simulation)'),
  modeStandalone: L('Chạy riêng (từng lệnh)', 'On its own (step by step)'),
  tipModeLive: L(
    'Xem đúng vi điều khiển đang chạy trong mô phỏng: giá trị cập nhật theo từng mẫu của mô phỏng. Nhấn Chạy trên thanh công cụ để bắt đầu.',
    'Watches the microcontroller that is running in the simulation: the values follow the simulation samples. Press Run on the toolbar to start it.',
  ),
  tipModeStandalone: L(
    'Chạy chương trình riêng, không có mạch (mọi chân đọc mức 1). Dùng để tập đọc hợp ngữ: chạy từng lệnh, đặt điểm dừng và xem thanh ghi thay đổi.',
    'Runs the program on its own with no circuit (every pin reads 1). Use it to learn assembly: step one instruction at a time, set breakpoints and watch the registers change.',
  ),
  step: L('Một lệnh', 'One instruction'),
  tipStep: L('Chạy đúng một lệnh (F11).', 'Execute exactly one instruction (F11).'),
  stepLine: L('Một dòng', 'One line'),
  tipStepLine: L('Chạy tới khi sang dòng lệnh khác (F10) — qua được cả vòng lặp trễ.', 'Run until the program reaches another source line (F10) — that skips a delay loop.'),
  runTo: L('Chạy tới điểm dừng', 'Run to breakpoint'),
  tipRunTo: L('Chạy tới điểm dừng gần nhất, hoặc tới khi hết 2 triệu chu kỳ máy (F5).', 'Run to the next breakpoint, or until two million machine cycles have passed (F5).'),
  resetRun: L('Đặt lại', 'Reset'),
  tipResetRun: L('Đưa vi điều khiển về trạng thái sau khi bật nguồn (PC = 0).', 'Put the microcontroller back to its power-on state (PC = 0).'),
  breakpoints: L('Điểm dừng: {n}', 'Breakpoints: {n}'),
  toggleBreak: L('Bật / tắt điểm dừng ở dòng này', 'Turn the breakpoint on this line on or off'),
  clearBreaks: L('Bỏ hết điểm dừng', 'Clear all breakpoints'),
  noListing: L('Nhấn Dịch để xem bảng địa chỉ — mã máy — dòng lệnh.', 'Press Build to see the address / machine code / source listing.'),
  noSymbols: L('Chương trình chưa khai báo nhãn hay hằng số nào.', 'The program declares no labels or constants yet.'),
  symbolName: L('Tên', 'Name'),
  symbolValue: L('Giá trị', 'Value'),
  symbolKind: L('Loại', 'Kind'),
  kindLabel: L('nhãn', 'label'),
  kindNumber: L('hằng số', 'constant'),
  kindBit: L('bit', 'bit'),
  currentLine: L('Dòng đang chạy', 'Line being executed'),

  // ---- live mode notes
  liveWaiting: L(
    'Chưa có số liệu: nhấn Chạy để mô phỏng. (Nếu tắt “Số liệu thanh ghi” trong Thuộc tính của linh kiện thì bảng này không nhận được giá trị.)',
    'No data yet: press Run to simulate. (If “Register read-outs” is switched off in the part’s Properties, this panel receives no values.)',
  ),
  liveBuildNote: L('Dịch xong rồi nhấn Chạy lại để mô phỏng chương trình mới.', 'After building, press Run again to simulate the new program.'),

  // ---- terminal
  terminalHint: L(
    'Cửa sổ này hiện các byte chương trình gửi ra cổng nối tiếp (SBUF), và gửi vào máy ký tự bạn gõ. Chương trình phải đặt Timer 1 làm bộ tạo tốc độ và SCON ở chế độ 1.',
    'This window shows the bytes the program sends out of the serial port (SBUF) and feeds what you type into it. The program must set timer 1 as the baud-rate generator and SCON to mode 1.',
  ),
  terminalSend: L('Gửi', 'Send'),
  terminalInput: L('Ký tự gửi tới vi điều khiển', 'Characters to send to the microcontroller'),
  terminalClear: L('Xoá cửa sổ', 'Clear the window'),
  terminalSentCount: L('Đã nhận {rx} byte, đã gửi {tx} byte', 'Received {rx} bytes, sent {tx} bytes'),
  terminalNewline: L('Thêm ký tự xuống dòng', 'Add a newline'),

  // ---- PLD wizard
  pldTitle: L('Trình hướng dẫn logic lập trình được (PLD)', 'Programmable-logic (PLD) wizard'),
  pldIntro: L(
    'Khai báo tên các ngõ vào và ngõ ra, viết bảng sự thật hoặc phương trình Boole, rồi đặt khối logic lên sơ đồ hoặc xuất ra VHDL / Verilog.',
    'Name the inputs and the outputs, write a truth table or Boolean equations, then place the logic block on the schematic or export it as VHDL / Verilog.',
  ),
  pldDefaultName: L('bộ cộng đầy đủ', 'full adder'),
  pldName: L('Tên khối', 'Block name'),
  tipPldName: L('Dùng làm tiêu đề và làm tên entity / module trong tệp VHDL / Verilog.', 'Used as the title and as the entity / module name in the VHDL / Verilog file.'),
  pldInputs: L('Ngõ vào', 'Inputs'),
  tipPldInputs: L('Tên các ngõ vào, cách nhau bằng dấu phẩy hoặc dấu cách (tối đa {max}).', 'Names of the inputs, separated by commas or spaces (at most {max}).'),
  pldOutputs: L('Ngõ ra', 'Outputs'),
  tipPldOutputs: L('Tên các ngõ ra, cách nhau bằng dấu phẩy hoặc dấu cách (tối đa {max}).', 'Names of the outputs, separated by commas or spaces (at most {max}).'),
  pldLogic: L('Logic', 'Logic'),
  tipPldLogic: L(
    'Phương trình: “Q = A & B | !C” (tổ hợp), “Q := Q ^ A” (có thanh ghi, chốt theo sườn lên của CLK), “Q.oe = EN” (cho phép ngõ ra). Hoặc bảng sự thật: dòng đầu là tên các cột “A B | Q”, mỗi dòng sau là 0 / 1 / – cho ngõ vào và 0 / 1 cho ngõ ra.',
    'Equations: “Q = A & B | !C” (combinational), “Q := Q ^ A” (registered, loaded on the rising edge of CLK), “Q.oe = EN” (output enable). Or a truth table: the first line names the columns “A B | Q”, each later line gives 0 / 1 / – for the inputs and 0 / 1 for the outputs.',
  ),
  pldTable: L('Bảng sự thật mẫu', 'Example truth table'),
  tipPldTable: L('Chèn một bảng sự thật trống với đủ số dòng cho các ngõ vào đã khai báo.', 'Insert an empty truth table with one row per combination of the declared inputs.'),
  pldBlock: L('Khối sẽ dùng: {part} ({inputs} vào, {outputs} ra)', 'Block to use: {part} ({inputs} in, {outputs} out)'),
  pldNoBlock: L('Không có khối PLD nào đủ chân cho {inputs} ngõ vào và {outputs} ngõ ra (tối đa {maxIn} × {maxOut}).', 'No PLD block has room for {inputs} inputs and {outputs} outputs (at most {maxIn} × {maxOut}).'),
  pldClocked: L('Có ngõ ra dùng thanh ghi, nên khối cần xung nhịp ở chân CLK.', 'Some output is registered, so the block needs a clock on its CLK pin.'),
  pldTriState: L('Có ngõ ra ba trạng thái (chân cho phép).', 'Some output is tri-state (it has an enable).'),
  pldRenamed: L(
    'Trong tệp VHDL / Verilog xuất ra, các tên này phải đổi (là từ khoá của ngôn ngữ hoặc bị trùng): {names}. Mạch mô phỏng vẫn dùng tên bạn đặt.',
    'In the exported VHDL / Verilog these names had to change (a keyword of the language, or a duplicate): {names}. The simulated circuit keeps the names you typed.',
  ),
  pldEquations: L('Phương trình đã chuẩn hoá', 'Normalised equations'),
  pldPlace: L('Đặt lên trang hiện tại', 'Place on the current sheet'),
  tipPldPlace: L('Đặt khối PLD kèm nhãn net cho mọi chân đã dùng và đầu dò ở các ngõ ra.', 'Places the PLD block with a net label on every used pin and a probe on each output.'),
  pldNewDesign: L('Tạo thiết kế mới', 'Create a new design'),
  pldExportVhdl: L('Xuất VHDL…', 'Export VHDL…'),
  pldExportVerilog: L('Xuất Verilog…', 'Export Verilog…'),
  pldPreview: L('Xem trước tệp', 'File preview'),
  pldJedec: L(
    'Không xuất được tệp JEDEC: bản đồ cầu chì phụ thuộc từng dòng chip (thứ tự cầu chì và bit cấu hình macrocell nằm trong tệp thiết bị của hãng), nên MachSim xuất VHDL / Verilog — mọi bộ công cụ PLD / CPLD đều dịch được.',
    'No JEDEC file: a fuse map belongs to one device family (the fuse order and the macrocell configuration bits come from the manufacturer’s device file), so MachSim exports VHDL / Verilog instead — every PLD / CPLD toolchain compiles that.',
  ),
  pldHdlComment: L('Sinh bởi MachSim từ logic của khối PLD', 'Generated by MachSim from the logic of a PLD block'),
  pldNameError: L('Tên tín hiệu “{name}”: {reason}', 'Signal name “{name}”: {reason}'),
  pldReasonEmpty: L('để trống', 'is blank'),
  pldReasonSyntax: L('chỉ được dùng chữ, số và dấu gạch dưới, và phải bắt đầu bằng chữ', 'may only use letters, digits and underscores, and must start with a letter'),
  pldReasonReserved: L('là từ khoá của biểu thức (AND, OR, XOR, NOT, OE, C)', 'is an expression keyword (AND, OR, XOR, NOT, OE, C)'),
  pldReasonDuplicate: L('bị dùng hai lần', 'is used twice'),
  pldUnknown: L('Không biết tín hiệu “{name}” — khai báo nó ở Ngõ vào hoặc Ngõ ra.', 'Unknown signal “{name}” — declare it as an input or an output.'),
  pldPlaced: L('Đã đặt khối {part} với chương trình logic.', 'Placed the {part} block with its logic program.'),
  pldExported: L('Đã lưu {file}.', 'Saved {file}.'),

  // ---- assembler errors
  'asm.badChar': L('ký tự không hợp lệ “{text}”', 'invalid character “{text}”'),
  'asm.badDirective': L('chỉ thị {text} cần một tên ở đầu dòng (ví dụ “LED BIT P1.0”)', 'the {text} directive needs a name in front of it (e.g. “LED BIT P1.0”)'),
  'asm.badExpr': L('biểu thức “{text}” viết sai', 'the expression “{text}” is malformed'),
  'asm.badNumber': L('“{text}” không phải là số (dùng 25, 0x19, 19h, 11001b, 31q)', '“{text}” is not a number (use 25, 0x19, 19h, 11001b, 31q)'),
  'asm.badOperands': L('toán hạng không đúng cho lệnh này: “{text}”', 'the operands do not fit this instruction: “{text}”'),
  'asm.badString': L('thiếu dấu nháy đóng ở “{text}”', 'a closing quote is missing at “{text}”'),
  'asm.duplicateSymbol': L('“{text}” đã được khai báo ở chỗ khác', '“{text}” is already defined somewhere else'),
  'asm.notBit': L('“{text}” không phải là địa chỉ bit (chỉ các thanh ghi đặc biệt chia hết cho 8 và RAM 20h…2Fh có bit)', '“{text}” is not a bit address (only SFRs at a multiple of 8 and RAM 20h…2Fh have bits)'),
  'asm.orgRange': L('địa chỉ {value} nằm ngoài bộ nhớ mã 64 KB', 'address {value} is outside the 64 KB of code memory'),
  'asm.pageMismatch': L('AJMP / ACALL chỉ nhảy trong trang 2 KB hiện tại — dùng LJMP / LCALL tới {text}', 'AJMP / ACALL only reach the current 2 KB page — use LJMP / LCALL for {text}'),
  'asm.rangeByte': L('{text} không vừa một byte (−256…255)', '{text} does not fit in a byte (−256…255)'),
  'asm.rangeWord': L('{text} không vừa 16 bit', '{text} does not fit in 16 bits'),
  'asm.relTooFar': L('nhãn ở xa {text} byte, lệnh nhảy ngắn chỉ tới được −128…127 — dùng LJMP', 'the label is {text} bytes away; a short jump only reaches −128…127 — use LJMP'),
  'asm.reservedName': L('“{text}” là tên thanh ghi có sẵn, hãy chọn tên khác', '“{text}” is a built-in register name; choose another name'),
  'asm.tooLong': L('chương trình vượt quá bộ nhớ mã tại địa chỉ {value}', 'the program runs past the code memory at address {value}'),
  'asm.undefinedSymbol': L('chưa khai báo “{text}”', '“{text}” is not defined'),
  'asm.unknownMnemonic': L('không có lệnh “{text}”', 'there is no instruction “{text}”'),

  // ---- Intel HEX errors
  'hex.notRecord': L('không phải một bản ghi Intel HEX (phải bắt đầu bằng “:” và chỉ gồm chữ số hex)', 'not an Intel HEX record (it must start with “:” and contain only hex digits)'),
  'hex.length': L('độ dài bản ghi không khớp số byte đã khai', 'the record length does not match its byte count'),
  'hex.checksum': L('sai tổng kiểm (checksum)', 'the checksum is wrong'),
  'hex.type': L('kiểu bản ghi {value} không được hỗ trợ', 'record type {value} is not supported'),
  'hex.range': L('địa chỉ {value} nằm ngoài bộ nhớ mã', 'address {value} is outside the code memory'),
} satisfies Record<string, LocalizedText>;

export type McuTextKey = keyof typeof MCU_TEXT;

/** Text of the MCU / PLD panels in the current language. */
export function mt(key: McuTextKey, params?: Record<string, string | number>): string {
  return interpolate(tr(MCU_TEXT[key]), params);
}

/** One assembler problem as a sentence with its line number. */
export function asmErrorText(e: AsmError): string {
  const key = `asm.${e.code}` as McuTextKey;
  const detail = mt(key, { text: e.text ?? '', value: e.value ?? 0 });
  return `${mt('lineLabel', { line: e.line })}: ${detail}`;
}

/** One Intel HEX problem as a sentence with its line number. */
export function hexErrorText(e: HexError): string {
  const key = `hex.${e.code}` as McuTextKey;
  return `${mt('lineLabel', { line: e.line })}: ${mt(key, { value: e.value ?? 0 })}`;
}

/** The message of an assembler error code on its own (for tests and tooltips). */
export function asmCodeText(code: AsmErrorCode, text = ''): string {
  return mt(`asm.${code}` as McuTextKey, { text, value: 0 });
}
