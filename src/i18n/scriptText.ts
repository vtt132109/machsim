/**
 * Texts of the scripting tools (Tools > Scripts, `MachSim.exe --script`), Vietnamese first: the
 * error messages of the API, the Scripts window, the API reference and the example scripts. Loaded
 * only with the Scripts window / the script runner (src/script, src/ui/script), so the start-up
 * catalogue stays small; the menu label lives in messages/script.ts. Original text.
 *
 *   sx('noPart', { refdes: 'R9' })       an API error in the current language
 *   st('run')                             a Scripts window text
 *   SCRIPT_DOCS / SCRIPT_EXAMPLES         the API reference and the examples (both languages)
 */
import { interpolate, L, tr, type LocalizedText } from './core';

const ERRORS = {
  unknownMethod: L('Hàm MachSim.{name}() không tồn tại.', 'MachSim.{name}() does not exist.'),
  noSheet: L('Không có trang sơ đồ "{sheet}".', 'There is no schematic sheet "{sheet}".'),
  noPart: L('Không có linh kiện "{refdes}" trong thiết kế.', 'There is no part "{refdes}" in the design.'),
  unknownPart: L('Không tìm thấy linh kiện "{id}" trong thư viện. Dùng MachSim.searchParts("{id}") để tìm.', 'Library part "{id}" was not found. Use MachSim.searchParts("{id}") to search.'),
  partSuggest: L('"{id}" chưa rõ là linh kiện nào. Có thể là: {list}.', '"{id}" is ambiguous. Did you mean: {list}?'),
  noPin: L('Linh kiện {refdes} không có chân "{pin}" (các chân: {list}).', 'Part {refdes} has no pin "{pin}" (pins: {list}).'),
  badPinRef: L('"{ref}" không phải tên chân. Viết dạng "R1.2" (tên linh kiện, dấu chấm, chân) hoặc {x, y}.', '"{ref}" is not a pin. Write it as "R1.2" (part, dot, pin) or {x, y}.'),
  noEditor: L('Không có trình soạn sơ đồ ở đây (chạy bằng dòng lệnh).', 'There is no schematic editor here (running from the command line).'),
  declined: L('Bạn đã từ chối: {what}.', 'Declined: {what}.'),
  whatOpen: L('mở tệp thiết kế', 'opening a design file'),
  whatSave: L('lưu tệp', 'saving the file'),
  badNumber: L('{what}: "{value}" không phải là số (viết 1000, 1k hoặc 4.7u).', '{what}: "{value}" is not a number (write 1000, 1k or 4.7u).'),
  tooManyParts: L('Một thiết kế viết bằng tập lệnh có tối đa {max} linh kiện.', 'A scripted design can hold at most {max} parts.'),
  badRotation: L('Góc quay phải là 0, 90, 180 hoặc 270 (nhận "{value}").', 'Rotation must be 0, 90, 180 or 270 (got "{value}").'),
  duplicateRefdes: L('Tên linh kiện {refdes} đã có trong thiết kế.', 'The part name {refdes} is already used in the design.'),
  noValueParam: L('Linh kiện {refdes} không có tham số "value". Dùng setParam với một trong: {keys}.', 'Part {refdes} has no "value" parameter. Use setParam with one of: {keys}.'),
  noParam: L('Linh kiện {refdes} không có tham số "{key}" (có: {keys}).', 'Part {refdes} has no parameter "{key}" (it has: {keys}).'),
  badVariable: L('Tên biến "{name}" không hợp lệ (chữ, số, gạch dưới; không bắt đầu bằng số).', 'Variable name "{name}" is not valid (letters, digits, underscore; not starting with a digit).'),
  noNode: L('Chân {ref} chưa nối vào nút nào.', 'Pin {ref} is not connected to any node.'),
  differentSheets: L('Hai đầu dây nằm ở hai trang khác nhau. Dùng MachSim.net() để nối bằng tên nút.', 'The two ends of the wire are on different sheets. Use MachSim.net() to join them by name.'),
  pathNeedsTwo: L('Đường dây cần ít nhất hai điểm.', 'A wire path needs at least two points.'),
  badNetName: L('Tên nút không được để trống.', 'The net name must not be empty.'),
  netNeedsPins: L('MachSim.net(tên, chân…) cần ít nhất một chân.', 'MachSim.net(name, pin…) needs at least one pin.'),
  ercErrors: L('Mạch có lỗi nên chưa mô phỏng được: {list}', 'The circuit has errors and cannot be simulated yet: {list}'),
  noResult: L('Phân tích không trả về kết quả.', 'The analysis returned no result.'),
  noDeckAnalysis: L('Tệp SPICE không có lệnh phân tích "{type}".', 'The SPICE deck has no "{type}" analysis card.'),
  tooLarge: L('Nội dung quá lớn để lưu.', 'The content is too large to save.'),
  badPlot: L('MachSim.plot cần x (danh sách số) và ít nhất một đường: {series: [{name, y}]}.', 'MachSim.plot needs x (a list of numbers) and at least one line: {series: [{name, y}]}.'),
  cliNoFile: L('Không đọc được tệp: {file}', 'Cannot read the file: {file}'),
  cliNotAllowed: L('Tập lệnh chỉ được mở hoặc lưu các tệp nêu trên dòng lệnh: {file}', 'A script may only open or save files named on the command line: {file}'),
  cliNoScript: L('Thiếu tệp tập lệnh: MachSim.exe --script tep.js', 'Missing script file: MachSim.exe --script file.js'),
  cliBadArgs: L('Tham số không hợp lệ: {detail}', 'Invalid argument: {detail}'),
  cliTimeout: L('Tập lệnh chạy quá {sec} giây nên bị dừng.', 'The script ran longer than {sec} seconds and was stopped.'),
  cliFailed: L('Tập lệnh lỗi{line}: {message}', 'Script error{line}: {message}'),
  cliLine: L(' ở dòng {n}', ' at line {n}'),
  cliDone: L('Tập lệnh chạy xong (mã thoát {code}).', 'Script finished (exit code {code}).'),
  cliWrote: L('Đã ghi {file}', 'Wrote {file}'),
  cliUsage: L(
    'Cách dùng: MachSim.exe --script tep.js [--lang vi|en] [--timeout giây] [--log tep.txt] [tham số…]\nTập lệnh chạy trong hộp cát; chỉ mở/lưu được các tệp nêu trên dòng lệnh. Tham số sau tên tập lệnh có trong MachSim.args.',
    'Usage: MachSim.exe --script file.js [--lang vi|en] [--timeout seconds] [--log file.txt] [arguments…]\nThe script runs in a sandbox and may only open or save files named on the command line. Arguments after the script name are in MachSim.args.',
  ),
} as const;

export type ScriptErrorKey = keyof typeof ERRORS;

/** One API / command-line message in the current language (or `lang`). */
export function sx(key: ScriptErrorKey, params?: Record<string, string | number>, lang?: 'vi' | 'en'): string {
  const entry: LocalizedText = ERRORS[key];
  const text = lang ? tr(entry, lang) : tr(entry);
  return params ? interpolate(text, params) : text;
}

// ---------------------------------------------------------------------------------------------
// API reference

export interface ScriptDoc {
  name: string;
  signature: string;
  group: 'design' | 'library' | 'edit' | 'analysis' | 'result' | 'output' | 'helper';
  text: LocalizedText;
}

export const SCRIPT_GROUP_TITLES: Record<ScriptDoc['group'], LocalizedText> = {
  design: L('Thiết kế', 'Designs'),
  library: L('Thư viện', 'Library'),
  edit: L('Đặt linh kiện và đi dây', 'Placing and wiring'),
  analysis: L('Chạy phân tích', 'Running analyses'),
  result: L('Đọc kết quả (đối tượng trả về bởi run)', 'Reading results (the object returned by run)'),
  output: L('Xuất kết quả', 'Output'),
  helper: L('Hàm tiện ích', 'Helpers'),
};

export const SCRIPT_DOCS: readonly ScriptDoc[] = [
  { name: 'newDesign', signature: 'await MachSim.newDesign(title?)', group: 'design', text: L('Bắt đầu một thiết kế trống (bỏ thiết kế đang dựng).', 'Start an empty design (dropping the one being built).') },
  { name: 'currentDesign', signature: 'await MachSim.currentDesign()', group: 'design', text: L('Lấy một BẢN SAO thiết kế đang mở trong trình soạn. Sửa bản sao không đổi thiết kế gốc.', 'Take a COPY of the design open in the editor. Changing the copy does not change the original.') },
  { name: 'openDesign', signature: 'await MachSim.openDesign(name?)', group: 'design', text: L('Mở một tệp .msim. MachSim luôn hỏi bạn trước khi cho tập lệnh đọc tệp.', 'Open a .msim file. MachSim always asks you before a script may read a file.') },
  { name: 'saveDesign', signature: 'await MachSim.saveDesign(name?)', group: 'design', text: L('Lưu thiết kế đang dựng ra tệp .msim. MachSim hỏi bạn trước khi ghi.', 'Save the design being built as a .msim file. MachSim asks you before writing.') },
  { name: 'showDesign', signature: 'await MachSim.showDesign()', group: 'design', text: L('Mở thiết kế đang dựng thành một thẻ mới trong trình soạn để bạn xem và sửa tiếp bằng tay.', 'Open the design being built as a new tab in the editor so you can look at it and continue by hand.') },
  { name: 'designInfo', signature: 'await MachSim.designInfo()', group: 'design', text: L('Tóm tắt thiết kế: tên, các trang, danh sách linh kiện và biến toàn cục.', 'Summary of the design: title, sheets, parts and global variables.') },
  { name: 'searchParts', signature: 'await MachSim.searchParts(query, limit?)', group: 'library', text: L('Tìm linh kiện trong thư viện; trả về danh sách {id, name, group, …}.', 'Search the library; returns a list of {id, name, group, …}.') },
  { name: 'partInfo', signature: 'await MachSim.partInfo(id)', group: 'library', text: L('Các chân (tên, vị trí) và tham số của một linh kiện. Cũng nhận tên ngắn như "resistor".', 'The pins (name, position) and parameters of a part. Short names such as "resistor" work too.') },
  { name: 'place', signature: 'await MachSim.place(partId, x, y, {value, params, rotation, mirror, refdes, sheet}?)', group: 'edit', text: L('Đặt một linh kiện tại (x, y) — lưới 10 đơn vị. Trả về {refdes, pins:{tên:{x,y}}}. Không đặt refdes thì tự đánh R1, R2…', 'Place a part at (x, y) on the 10-unit grid. Returns {refdes, pins:{name:{x,y}}}. Without a refdes it numbers itself R1, R2…') },
  { name: 'remove', signature: 'await MachSim.remove(refdes)', group: 'edit', text: L('Xoá một linh kiện (dây nối giữ nguyên).', 'Delete a part (its wires stay).') },
  { name: 'move', signature: 'await MachSim.move(refdes, x, y)', group: 'edit', text: L('Dời linh kiện; dây đã vẽ không đi theo — hãy dời trước khi đi dây.', 'Move a part; wires already drawn do not follow, so move before wiring.') },
  { name: 'rotate', signature: 'await MachSim.rotate(refdes, degrees)', group: 'edit', text: L('Quay linh kiện 0 / 90 / 180 / 270 độ.', 'Rotate a part to 0 / 90 / 180 / 270 degrees.') },
  { name: 'setValue', signature: 'await MachSim.setValue(refdes, value)', group: 'edit', text: L('Đặt giá trị chính ("1k", "100n", 4700 …).', 'Set the main value ("1k", "100n", 4700 …).') },
  { name: 'setParam', signature: 'await MachSim.setParam(refdes, key, value)', group: 'edit', text: L('Đặt một tham số khác của linh kiện (xem partInfo).', 'Set another parameter of a part (see partInfo).') },
  { name: 'getParam', signature: 'await MachSim.getParam(refdes, key?)', group: 'edit', text: L('Đọc giá trị (mặc định tham số "value").', 'Read a value (the "value" parameter by default).') },
  { name: 'setVariable', signature: 'await MachSim.setVariable(name, value)', group: 'edit', text: L('Đặt biến toàn cục của thiết kế (dùng trong giá trị như {Rx}).', 'Set a global variable of the design (used in values such as {Rx}).') },
  { name: 'pin', signature: 'await MachSim.pin("R1.2")', group: 'edit', text: L('Toạ độ {x, y} của một chân.', 'The {x, y} position of a pin.') },
  { name: 'nodeOf', signature: 'await MachSim.nodeOf("R1.2")', group: 'edit', text: L('Tên nút SPICE mà chân đang nối vào — dùng để đọc V(nút) trong kết quả.', 'The SPICE node name a pin is on — use it to read V(node) in a result.') },
  { name: 'wire', signature: 'await MachSim.wire("R1.2", "C1.1")', group: 'edit', text: L('Vẽ dây vuông góc giữa hai chân (hoặc hai điểm {x, y}).', 'Draw an orthogonal wire between two pins (or two {x, y} points).') },
  { name: 'wirePath', signature: 'await MachSim.wirePath(["R1.2", {x:300,y:150}, "C1.1"])', group: 'edit', text: L('Vẽ dây đi qua nhiều điểm.', 'Draw a wire through several points.') },
  { name: 'net', signature: 'await MachSim.net("out", "R1.2", "C1.1", …)', group: 'edit', text: L('Đặt cùng một tên nút lên nhiều chân: chúng được nối với nhau, không cần vẽ dây. Cách nhanh nhất để nối mạch.', 'Put the same net name on several pins: they are joined with no wire to draw. The quickest way to connect a circuit.') },
  { name: 'ground', signature: 'await MachSim.ground("V1.-")', group: 'edit', text: L('Đặt ký hiệu đất dưới chân và nối vào.', 'Place a ground symbol below the pin and connect it.') },
  { name: 'label', signature: 'await MachSim.label("R1.2", "out")', group: 'edit', text: L('Đặt một nhãn nút lên chân hoặc điểm.', 'Put a net label on a pin or point.') },
  { name: 'erc', signature: 'await MachSim.erc()', group: 'analysis', text: L('Kiểm tra quy tắc điện (ERC); trả về danh sách lỗi và cảnh báo.', 'Run the electrical rules check; returns the list of errors and warnings.') },
  { name: 'netlist', signature: 'await MachSim.netlist()', group: 'analysis', text: L('Văn bản netlist SPICE của thiết kế.', 'The SPICE netlist text of the design.') },
  { name: 'setAnalysis', signature: 'await MachSim.setAnalysis(type, options?)', group: 'analysis', text: L('Lưu thiết lập phân tích vào thiết kế (cùng tuỳ chọn như run).', 'Store the analysis settings in the design (same options as run).') },
  {
    name: 'run',
    signature: 'await MachSim.run(type?, options?)',
    group: 'analysis',
    text: L(
      'Chạy một phân tích: "op", "dc", "ac", "tran", "noise", "tf", … Tuỳ chọn ví dụ: {tstop:"10m", tstep:"10u"} hoặc {fstart:"10", fstop:"100k", points:20}. Số viết được dạng 1k, 4.7u. Trả về đối tượng kết quả (xem mục kết quả); lỗi phân tích sẽ ném ngoại lệ.',
      'Run an analysis: "op", "dc", "ac", "tran", "noise", "tf", … Example options: {tstop:"10m", tstep:"10u"} or {fstart:"10", fstop:"100k", points:20}. Numbers may be written 1k, 4.7u. Returns the result object (see the result section); an analysis failure throws.',
    ),
  },
  { name: 'runSpice', signature: 'await MachSim.runSpice(netlistText, options?)', group: 'analysis', text: L('Chạy thẳng một đoạn netlist SPICE (không cần dựng sơ đồ).', 'Run a SPICE netlist text directly (no schematic needed).') },
  { name: 'result.get', signature: 'res.get("V(out)") · res.x · res.names', group: 'result', text: L('Mảng giá trị của một vector (không phân biệt hoa thường; "out" cũng được); res.x là trục hoành (thời gian, tần số…).', 'The array of one vector (case-insensitive; "out" works too); res.x is the sweep axis (time, frequency …).') },
  { name: 'result.at', signature: 'res.at(name, x) · res.atDb(name, f) · res.atPhase(name, f)', group: 'result', text: L('Giá trị tại điểm x (nội suy). Với AC: atDb là dB, atPhase là độ.', 'Value at x (interpolated). For AC: atDb is dB, atPhase is degrees.') },
  { name: 'result.stats', signature: 'res.max · min · pp · mean · rms · final · first (name)', group: 'result', text: L('Thống kê của một vector trên cả trục hoành (mean và rms theo trọng số thời gian).', 'Statistics of a vector over the whole axis (mean and rms are time-weighted).') },
  { name: 'result.crossing', signature: 'res.crossing(name, level, "rise"|"fall"|"any", n?) · res.bandwidth(name)', group: 'result', text: L('x tại lần cắt mức thứ n; bandwidth là tần số cắt −3 dB của đáp ứng thông thấp.', 'x at the n-th crossing of a level; bandwidth is the −3 dB corner of a low-pass response.') },
  { name: 'result.mag', signature: 'res.mag(name) · res.db(name) · res.phase(name)', group: 'result', text: L('Biên độ, dB và pha (độ) của vector phức (kết quả AC).', 'Magnitude, dB and phase (degrees) of a complex vector (AC results).') },
  { name: 'result.meas', signature: 'res.scalar(name) · res.meas(name) · res.toCsv() · res.raw', group: 'result', text: L('Đại lượng vô hướng (vd gain của tf), phép đo .meas, văn bản CSV, dữ liệu thô.', 'Scalars (e.g. tf gain), .meas values, the CSV text and the raw data.') },
  { name: 'saveText', signature: 'await MachSim.saveText("ketqua.csv", text)', group: 'output', text: L('Lưu văn bản ra tệp. MachSim hỏi bạn trước khi ghi; tập lệnh không tự đụng được vào ổ đĩa.', 'Save text to a file. MachSim asks you before writing; a script cannot touch the disk by itself.') },
  { name: 'plot', signature: 'await MachSim.plot({title, xLabel, yLabel, x, series:[{name, y}], logX})', group: 'output', text: L('Vẽ đồ thị (hiện ở khung Đồ thị của cửa sổ Tập lệnh). Trả về văn bản SVG để lưu bằng saveText.', 'Draw a plot (shown in the Plots pane of the Scripts window). Returns the SVG text you can save with saveText.') },
  { name: 'print', signature: 'print(…) · console.log(…)', group: 'output', text: L('In ra khung kết quả của cửa sổ Tập lệnh (hoặc ra màn hình khi chạy bằng dòng lệnh).', 'Print to the log of the Scripts window (or to the console when run from the command line).') },
  { name: 'sweep', signature: 'await MachSim.sweep(refdes, values, async (v, i) => …, {key?})', group: 'helper', text: L('Đặt giá trị cho linh kiện lần lượt từng phần tử của values, gọi hàm và gom kết quả; xong tự trả giá trị cũ.', 'Set the part to each of the values in turn, call the function and collect what it returns; the old value is restored at the end.') },
  { name: 'linspace', signature: 'MachSim.linspace(a, b, n) · logspace(a, b, n) · range(a, b, step)', group: 'helper', text: L('Dãy số cách đều, cách đều theo logarit, hoặc theo bước.', 'Evenly spaced, logarithmically spaced or stepped number lists.') },
  { name: 'eng', signature: 'MachSim.eng(4700) → "4.7k" · MachSim.parseNumber("4.7k") → 4700', group: 'helper', text: L('Viết số theo kiểu kỹ thuật và đọc ngược lại.', 'Write a number in engineering style and read it back.') },
  { name: 'table', signature: 'MachSim.table([[a, b], [c, d]]) · MachSim.args · await sleep(ms)', group: 'helper', text: L('In bảng thẳng cột; MachSim.args là tham số dòng lệnh; sleep chờ.', 'Print an aligned table; MachSim.args holds the command-line arguments; sleep waits.') },
];

// ---------------------------------------------------------------------------------------------
// examples

export interface ScriptExample {
  id: string;
  title: LocalizedText;
  description: LocalizedText;
  code: LocalizedText;
}

const RC_VI = `// Quét R1 của mạch lọc thông thấp RC rồi vẽ độ lợi theo tần số.
// Tần số cắt lý thuyết fc = 1 / (2π·R·C).
await MachSim.newDesign('Loc RC');
await MachSim.place('ac-voltage', 100, 200, { params: { amplitude: '1', acmag: '1' } }); // V1
await MachSim.place('resistor', 200, 150, { value: '1k' });                              // R1
await MachSim.place('capacitor', 300, 200, { value: '100n', rotation: 90 });             // C1
await MachSim.net('in', 'V1.+', 'R1.1');       // đặt cùng tên nút = nối với nhau
await MachSim.net('out', 'R1.2', 'C1.1');
await MachSim.ground('V1.-');
await MachSim.ground('C1.2');

const series = [];
for (const r of ['500', '1k', '2k', '5k']) {
  await MachSim.setValue('R1', r);
  const res = await MachSim.run('ac', { fstart: '10', fstop: '100k', points: 20 });
  const fc = res.bandwidth('V(out)');
  print('R1 =', r, '  fc đo được =', MachSim.eng(fc) + 'Hz', '  lý thuyết =', MachSim.eng(1 / (2 * Math.PI * MachSim.parseNumber(r) * 100e-9)) + 'Hz');
  series.push({ name: 'R1 = ' + r, y: res.db('V(out)') });
}
await MachSim.plot({ title: 'Độ lợi theo R1', xLabel: 'Tần số (Hz)', yLabel: 'Độ lợi (dB)', x: MachSim.logspace(10, 100e3, series[0].y.length), series, logX: true });
await MachSim.showDesign(); // mở mạch vừa dựng thành thẻ mới để xem
`;

const RC_EN = `// Sweep R1 of an RC low-pass filter and plot the gain against frequency.
// Theory: fc = 1 / (2π·R·C).
await MachSim.newDesign('RC filter');
await MachSim.place('ac-voltage', 100, 200, { params: { amplitude: '1', acmag: '1' } }); // V1
await MachSim.place('resistor', 200, 150, { value: '1k' });                              // R1
await MachSim.place('capacitor', 300, 200, { value: '100n', rotation: 90 });             // C1
await MachSim.net('in', 'V1.+', 'R1.1');       // the same net name joins the pins
await MachSim.net('out', 'R1.2', 'C1.1');
await MachSim.ground('V1.-');
await MachSim.ground('C1.2');

const series = [];
for (const r of ['500', '1k', '2k', '5k']) {
  await MachSim.setValue('R1', r);
  const res = await MachSim.run('ac', { fstart: '10', fstop: '100k', points: 20 });
  const fc = res.bandwidth('V(out)');
  print('R1 =', r, '  measured fc =', MachSim.eng(fc) + 'Hz', '  theory =', MachSim.eng(1 / (2 * Math.PI * MachSim.parseNumber(r) * 100e-9)) + 'Hz');
  series.push({ name: 'R1 = ' + r, y: res.db('V(out)') });
}
await MachSim.plot({ title: 'Gain versus R1', xLabel: 'Frequency (Hz)', yLabel: 'Gain (dB)', x: MachSim.logspace(10, 100e3, series[0].y.length), series, logX: true });
await MachSim.showDesign(); // open the finished circuit as a new tab
`;

const DIV_VI = `// Dựng mạch phân áp 10 V → 1k / 3k và đọc điện áp giữa.
await MachSim.newDesign('Phan ap');
await MachSim.place('dc-voltage', 100, 200, { value: '10' });                // V1
await MachSim.place('resistor', 200, 150, { value: '1k' });                  // R1
await MachSim.place('resistor', 300, 200, { value: '3k', rotation: 90 });    // R2
await MachSim.net('in', 'V1.+', 'R1.1');
await MachSim.net('mid', 'R1.2', 'R2.1');
await MachSim.ground('V1.-');
await MachSim.ground('R2.2');

const op = await MachSim.run('op');
print('V(mid) =', op.get('mid')[0], 'V   (lý thuyết: 10·3k/(1k+3k) = 7.5 V)');
print('Dòng qua R1 =', MachSim.eng(Math.abs(op.get('I(V1)')[0])) + 'A', '  (I(V1) âm vì nguồn đẩy dòng ra, nên lấy độ lớn)');
`;

const DIV_EN = `// Build a 10 V divider with 1k / 3k and read the middle voltage.
await MachSim.newDesign('Divider');
await MachSim.place('dc-voltage', 100, 200, { value: '10' });                // V1
await MachSim.place('resistor', 200, 150, { value: '1k' });                  // R1
await MachSim.place('resistor', 300, 200, { value: '3k', rotation: 90 });    // R2
await MachSim.net('in', 'V1.+', 'R1.1');
await MachSim.net('mid', 'R1.2', 'R2.1');
await MachSim.ground('V1.-');
await MachSim.ground('R2.2');

const op = await MachSim.run('op');
print('V(mid) =', op.get('mid')[0], 'V   (theory: 10·3k/(1k+3k) = 7.5 V)');
print('Current in V1 =', MachSim.eng(op.get('I(V1)')[0]) + 'A');
`;

const TRAN_VI = `// Mô phỏng quá độ mạch RC với nguồn sin 1 kHz, tính RMS và xuất CSV.
await MachSim.newDesign('RC tran');
await MachSim.place('ac-voltage', 100, 200, { params: { amplitude: '1', freq: '1k' } });
await MachSim.place('resistor', 200, 150, { value: '1k' });
await MachSim.place('capacitor', 300, 200, { value: '100n', rotation: 90 });
await MachSim.net('in', 'V1.+', 'R1.1');
await MachSim.net('out', 'R1.2', 'C1.1');
await MachSim.ground('V1.-');
await MachSim.ground('C1.2');

const res = await MachSim.run('tran', { tstop: '5m', tstep: '10u' });
print('Đỉnh V(out)  =', MachSim.eng(res.max('V(out)')) + 'V');
print('RMS V(out)   =', MachSim.eng(res.rms('V(out)')) + 'V');
print('Số điểm      =', res.x.length);
await MachSim.saveText('rc_tran.csv', res.toCsv()); // MachSim sẽ hỏi bạn trước khi ghi
`;

const TRAN_EN = `// Transient simulation of an RC circuit with a 1 kHz sine source: RMS and CSV export.
await MachSim.newDesign('RC tran');
await MachSim.place('ac-voltage', 100, 200, { params: { amplitude: '1', freq: '1k' } });
await MachSim.place('resistor', 200, 150, { value: '1k' });
await MachSim.place('capacitor', 300, 200, { value: '100n', rotation: 90 });
await MachSim.net('in', 'V1.+', 'R1.1');
await MachSim.net('out', 'R1.2', 'C1.1');
await MachSim.ground('V1.-');
await MachSim.ground('C1.2');

const res = await MachSim.run('tran', { tstop: '5m', tstep: '10u' });
print('Peak V(out)  =', MachSim.eng(res.max('V(out)')) + 'V');
print('RMS V(out)   =', MachSim.eng(res.rms('V(out)')) + 'V');
print('Points       =', res.x.length);
await MachSim.saveText('rc_tran.csv', res.toCsv()); // MachSim asks before writing
`;

const FIND_VI = `// Tìm R để mạch lọc RC (C = 100 nF) có tần số cắt 1 kHz bằng cách thử từng giá trị.
await MachSim.newDesign('Tim R');
await MachSim.place('ac-voltage', 100, 200, { params: { amplitude: '1', acmag: '1' } });
await MachSim.place('resistor', 200, 150, { value: '1k' });
await MachSim.place('capacitor', 300, 200, { value: '100n', rotation: 90 });
await MachSim.net('in', 'V1.+', 'R1.1');
await MachSim.net('out', 'R1.2', 'C1.1');
await MachSim.ground('V1.-');
await MachSim.ground('C1.2');

const candidates = MachSim.logspace(500, 5000, 10);
const fcs = await MachSim.sweep('R1', candidates, async (r) => {
  const res = await MachSim.run('ac', { fstart: '10', fstop: '10k', points: 40 });
  return res.bandwidth('V(out)');
});
let best = 0;
fcs.forEach((fc, i) => { if (Math.abs(fc - 1000) < Math.abs(fcs[best] - 1000)) best = i; });
MachSim.table(candidates.map((r, i) => ['R = ' + MachSim.eng(r) + 'Ω', 'fc = ' + MachSim.eng(fcs[i]) + 'Hz']));
print('Gần 1 kHz nhất:', MachSim.eng(candidates[best]) + 'Ω   (lý thuyết R = 1/(2π·1k·100n) = 1.59 kΩ)');
`;

const FIND_EN = `// Find R so that an RC filter (C = 100 nF) has a 1 kHz corner by trying values.
await MachSim.newDesign('Find R');
await MachSim.place('ac-voltage', 100, 200, { params: { amplitude: '1', acmag: '1' } });
await MachSim.place('resistor', 200, 150, { value: '1k' });
await MachSim.place('capacitor', 300, 200, { value: '100n', rotation: 90 });
await MachSim.net('in', 'V1.+', 'R1.1');
await MachSim.net('out', 'R1.2', 'C1.1');
await MachSim.ground('V1.-');
await MachSim.ground('C1.2');

const candidates = MachSim.logspace(500, 5000, 10);
const fcs = await MachSim.sweep('R1', candidates, async (r) => {
  const res = await MachSim.run('ac', { fstart: '10', fstop: '10k', points: 40 });
  return res.bandwidth('V(out)');
});
let best = 0;
fcs.forEach((fc, i) => { if (Math.abs(fc - 1000) < Math.abs(fcs[best] - 1000)) best = i; });
MachSim.table(candidates.map((r, i) => ['R = ' + MachSim.eng(r) + 'Ω', 'fc = ' + MachSim.eng(fcs[i]) + 'Hz']));
print('Closest to 1 kHz:', MachSim.eng(candidates[best]) + 'Ω   (theory R = 1/(2π·1k·100n) = 1.59 kΩ)');
`;

const SPICE_VI = `// Chạy thẳng một netlist SPICE, không cần dựng sơ đồ.
const res = await MachSim.runSpice(\`Phan ap
V1 in 0 DC 5
R1 in out 2k
R2 out 0 3k
.op
.end\`);
print('V(out) =', res.get('out')[0], 'V   (lý thuyết 3 V)');
`;

const SPICE_EN = `// Run a SPICE netlist directly, no schematic needed.
const res = await MachSim.runSpice(\`Divider
V1 in 0 DC 5
R1 in out 2k
R2 out 0 3k
.op
.end\`);
print('V(out) =', res.get('out')[0], 'V   (theory 3 V)');
`;

export const SCRIPT_EXAMPLES: readonly ScriptExample[] = [
  { id: 'sweep-gain', title: L('Quét R1 và vẽ độ lợi', 'Sweep R1 and plot the gain'), description: L('Dựng mạch lọc RC, quét R1, đo tần số cắt và vẽ các đường độ lợi.', 'Build an RC filter, sweep R1, measure the corner frequency and plot the gain curves.'), code: L(RC_VI, RC_EN) },
  { id: 'divider', title: L('Dựng mạch phân áp và đọc điện áp', 'Build a divider and read the voltage'), description: L('Bước đầu tiên: đặt linh kiện, nối bằng tên nút, chạy phân tích OP.', 'First steps: place parts, join them by net name, run an operating point.'), code: L(DIV_VI, DIV_EN) },
  { id: 'transient-csv', title: L('Quá độ, RMS và xuất CSV', 'Transient, RMS and CSV export'), description: L('Chạy phân tích quá độ, đo đỉnh và RMS, lưu CSV (có hỏi trước khi ghi).', 'Run a transient, measure peak and RMS, save CSV (asks before writing).'), code: L(TRAN_VI, TRAN_EN) },
  { id: 'find-r', title: L('Vòng lặp tìm giá trị R', 'A loop that finds the R value'), description: L('Dùng MachSim.sweep để thử nhiều giá trị và chọn giá trị cho tần số cắt gần 1 kHz nhất.', 'Use MachSim.sweep to try many values and pick the one with a corner closest to 1 kHz.'), code: L(FIND_VI, FIND_EN) },
  { id: 'spice-deck', title: L('Chạy một netlist SPICE', 'Run a SPICE netlist'), description: L('Không cần sơ đồ: đưa văn bản SPICE vào runSpice.', 'No schematic needed: hand SPICE text to runSpice.'), code: L(SPICE_VI, SPICE_EN) },
];

// ---------------------------------------------------------------------------------------------
// the Scripts window

export const SCRIPT_PANEL = {
  title: L('Tập lệnh', 'Scripts'),
  intro: L(
    'Viết chương trình JavaScript ngắn để tự dựng mạch, đổi giá trị, chạy phân tích và đọc kết quả. Tập lệnh chạy trong hộp cát: không đọc được máy tính của bạn, và mọi việc mở / lưu tệp đều phải được bạn đồng ý.',
    'Write a short JavaScript program that builds circuits, changes values, runs analyses and reads the results. The script runs in a sandbox: it cannot see your computer, and every file open / save needs your approval.',
  ),
  run: L('Chạy', 'Run'),
  runTip: L('Chạy tập lệnh (Ctrl+Enter)', 'Run the script (Ctrl+Enter)'),
  stop: L('Dừng', 'Stop'),
  stopTip: L('Dừng ngay tập lệnh, kể cả khi nó đang kẹt trong vòng lặp', 'Stop the script at once, even when it is stuck in a loop'),
  examples: L('Ví dụ…', 'Examples…'),
  examplesTip: L('Nạp một tập lệnh mẫu vào khung soạn', 'Load an example script into the editor'),
  openScript: L('Mở tập lệnh…', 'Open script…'),
  openScriptTip: L('Đọc một tệp .js vào khung soạn', 'Read a .js file into the editor'),
  saveScript: L('Lưu tập lệnh…', 'Save script…'),
  saveScriptTip: L('Lưu nội dung khung soạn thành tệp .js', 'Save the editor text as a .js file'),
  clearLog: L('Xoá kết quả', 'Clear output'),
  editorLabel: L('Mã tập lệnh', 'Script code'),
  placeholder: L('// Gõ tập lệnh ở đây, hoặc chọn một ví dụ.\n// Ví dụ: await MachSim.newDesign("Thu");', '// Type your script here, or pick an example.\n// For example: await MachSim.newDesign("Try");'),
  outputTab: L('Kết quả', 'Output'),
  plotsTab: L('Đồ thị', 'Plots'),
  noOutput: L('Chưa có kết quả. Nhấn Chạy.', 'No output yet. Press Run.'),
  noPlots: L('Chưa có đồ thị. Dùng MachSim.plot({...}) trong tập lệnh.', 'No plots yet. Use MachSim.plot({...}) in the script.'),
  apiTitle: L('Hướng dẫn hàm', 'Function reference'),
  apiSearch: L('Tìm hàm…', 'Search functions…'),
  apiTip: L('Nhấn một hàm để chèn vào tập lệnh', 'Click a function to insert it into the script'),
  apiIntro: L('Mọi hàm MachSim.xxx() đều bất đồng bộ: viết await trước hàm. Toạ độ theo lưới 10 đơn vị; chân gọi là "R1.2" (tên.chân).', 'Every MachSim.xxx() function is asynchronous: write await before it. Coordinates use the 10-unit grid; pins are named "R1.2" (part.pin).'),
  running: L('Đang chạy…', 'Running…'),
  finished: L('Xong ({ms} ms).', 'Finished ({ms} ms).'),
  failed: L('Lỗi{line}: {message}', 'Error{line}: {message}'),
  failedLine: L(' ở dòng {n}', ' at line {n}'),
  stopped: L('Đã dừng.', 'Stopped.'),
  timedOut: L('Dừng vì chạy quá {sec} giây.', 'Stopped: it ran longer than {sec} seconds.'),
  returned: L('Tập lệnh trả về: {value}', 'The script returned: {value}'),
  // ---- the approval cards
  askTitle: L('Tập lệnh xin phép', 'The script asks permission'),
  askOpen: L('Tập lệnh muốn MỞ một tệp thiết kế{hint}. Chọn tệp để cho phép, hoặc từ chối.', 'The script wants to OPEN a design file{hint}. Choose a file to allow it, or refuse.'),
  askOpenHint: L(' ("{name}")', ' ("{name}")'),
  askSave: L('Tập lệnh muốn LƯU tệp "{name}" ({size}). Bạn chọn nơi lưu để cho phép, hoặc từ chối.', 'The script wants to SAVE the file "{name}" ({size}). Choose where to save it to allow it, or refuse.'),
  choose: L('Chọn tệp…', 'Choose file…'),
  saveAs: L('Lưu…', 'Save…'),
  refuse: L('Từ chối', 'Refuse'),
  askNever: L('Tập lệnh không tự đọc hay ghi được ổ đĩa; chỉ tệp bạn chọn ở đây mới được đụng tới.', 'A script cannot read or write the disk by itself; only the file you choose here is touched.'),
  wroteFile: L('Đã lưu: {name}', 'Saved: {name}'),
  openedFile: L('Đã mở: {name}', 'Opened: {name}'),
  shownDesign: L('Đã mở mạch của tập lệnh thành thẻ mới: {name}', 'Opened the script’s circuit as a new tab: {name}'),
  noMoreDocs: L('Không mở thêm được thiết kế (tối đa 16).', 'Cannot open another design (16 at most).'),
  plotTitle: L('Đồ thị {n}', 'Plot {n}'),
  copySvg: L('Lưu SVG…', 'Save SVG…'),
  line: L('Dòng {n}', 'Line {n}'),
} as const;

export type ScriptPanelKey = keyof typeof SCRIPT_PANEL;

/** One Scripts window text in the current language. */
export function st(key: ScriptPanelKey, params?: Record<string, string | number>): string {
  const entry: LocalizedText = SCRIPT_PANEL[key];
  return params ? interpolate(tr(entry), params) : tr(entry);
}
