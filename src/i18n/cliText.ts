/**
 * Texts of the desktop command line (batch mode log and usage), Vietnamese and English. Loaded
 * by the batch runner only.
 */
import { getLang, interpolate, type Lang } from './core';

export const CLI_TEXT = {
  usage: [
    `MachSim — chạy mô phỏng từ dòng lệnh
Cách dùng:
  MachSim.exe --batch <tệp.msim | tệp.cir> [--analysis <loại>] [--out <tệp.csv | .txt | .json>]
              [--format csv|text|json] [--tstop <thời gian>] [--tstep <thời gian>] [--set TÊN=GIÁ_TRỊ]
              [--netlist <tệp.cir>] [--erc] [--log <tệp>] [--quiet] [--lang vi|en]
Loại phân tích: {analyses}
Mã thoát: 0 = thành công, 1 = mô phỏng hoặc ERC lỗi, 2 = sai tham số, 3 = lỗi đọc / ghi tệp.
Ví dụ:
  MachSim.exe --batch mach.msim --analysis tran --out ketqua.csv
  MachSim.exe --batch loc.cir --out ketqua.json`,
    `MachSim — run simulations from the command line
Usage:
  MachSim.exe --batch <file.msim | file.cir> [--analysis <type>] [--out <file.csv | .txt | .json>]
              [--format csv|text|json] [--tstop <time>] [--tstep <time>] [--set NAME=VALUE]
              [--netlist <file.cir>] [--erc] [--log <file>] [--quiet] [--lang vi|en]
Analysis types: {analyses}
Exit codes: 0 = success, 1 = simulation or ERC error, 2 = bad arguments, 3 = file read / write error.
Examples:
  MachSim.exe --batch circuit.msim --analysis tran --out results.csv
  MachSim.exe --batch filter.cir --out results.json`,
  ],
  'error.missingInput': ['Thiếu tệp vào: dùng --batch <tệp>.', 'No input file: use --batch <file>.'],
  'error.unknownOption': ['Tham số không biết: {detail}', 'Unknown option: {detail}'],
  'error.missingValue': ['Thiếu giá trị sau {detail}', 'Missing value after {detail}'],
  'error.badAnalysis': ['Loại phân tích không biết: {detail}', 'Unknown analysis type: {detail}'],
  'error.badNumber': ['Số không hợp lệ: {detail}', 'Invalid number: {detail}'],
  'error.badSet': ['--set cần dạng TÊN=GIÁ_TRỊ (nhận được {detail})', '--set needs NAME=VALUE (got {detail})'],
  'error.badFormat': ['Định dạng không biết: {detail} (csv, text hoặc json)', 'Unknown format: {detail} (csv, text or json)'],
  'error.badLang': ['Ngôn ngữ không biết: {detail} (vi hoặc en)', 'Unknown language: {detail} (vi or en)'],
  'error.extraArgument': ['Tham số thừa: {detail}', 'Unexpected argument: {detail}'],
  'log.reading': ['Đọc {file}', 'Reading {file}'],
  'log.readFailed': ['Không đọc được {file}: {message}', 'Cannot read {file}: {message}'],
  'log.writeFailed': ['Không ghi được {file}: {message}', 'Cannot write {file}: {message}'],
  'log.badDesign': ['Tệp thiết kế không hợp lệ: {message}', 'Invalid design file: {message}'],
  'log.spiceError': ['{file} dòng {line}: {message}', '{file} line {line}: {message}'],
  'log.spiceWarning': ['{file}: {message}', '{file}: {message}'],
  'log.missingInclude': ['Thiếu tệp đi kèm: {list}', 'Missing included files: {list}'],
  'log.unknownVariable': ['--set {name}: thiết kế không có biến này, đã thêm mới', '--set {name}: the design has no such variable, added'],
  'log.erc': ['ERC: {errors} lỗi, {warnings} cảnh báo', 'ERC: {errors} errors, {warnings} warnings'],
  'log.ercLine': ['  {severity}: {message}', '  {severity}: {message}'],
  'log.noAnalysis': ['Thiết kế không có thiết lập cho phép phân tích “{type}”; dùng giá trị mặc định.', 'The design has no settings for the “{type}” analysis; using defaults.'],
  'log.noDeckAnalysis': ['Netlist không có thẻ phân tích “{type}”.', 'The netlist has no “{type}” analysis card.'],
  'log.running': ['Chạy {analyses}…', 'Running {analyses}…'],
  'log.result': ['  {title}: {points} điểm, {vectors} vector ({ms} ms)', '  {title}: {points} points, {vectors} vectors ({ms} ms)'],
  'log.resultError': ['  {title}: LỖI {message}', '  {title}: ERROR {message}'],
  'log.wrote': ['Đã ghi {file}', 'Wrote {file}'],
  'log.measure': ['  .meas {name} = {value}', '  .meas {name} = {value}'],
  'log.measureFailed': ['  .meas {name}: không đo được ({message})', '  .meas {name}: not measured ({message})'],
  'log.done': ['Xong (mã thoát {code}).', 'Done (exit code {code}).'],
  'severity.error': ['lỗi', 'error'],
  'severity.warning': ['cảnh báo', 'warning'],
} as const satisfies Record<string, readonly [string, string]>;

export type CliKey = keyof typeof CLI_TEXT;

export function ct(key: CliKey, params?: Record<string, string | number>, lang: Lang = getLang()): string {
  const e = CLI_TEXT[key];
  return interpolate(lang === 'en' ? e[1] : e[0], params);
}
