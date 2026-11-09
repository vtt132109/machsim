/**
 * UI messages of the digital and mixed-signal round: digital simulation settings (ideal / real
 * mode, timing), the hex content editor of memories, the digital ERC check and the catalogue
 * specification labels / values it introduced. [vi, en]
 */
import type { Catalogue } from '../types';

export default {
  // ---------------------------------------------------------------- digital simulation settings
  'cmd.simulate.digitalSettings': ['Cài đặt mô phỏng số…', 'Digital simulation settings…'],
  'digital.settings.title': ['Cài đặt mô phỏng số', 'Digital simulation settings'],
  'digital.settings.intro': [
    'Chọn cách các IC số (74xx, 4000, bộ nhớ, bộ chuyển đổi) được mô phỏng. Cài đặt lưu trong file thiết kế.',
    'Choose how digital ICs (74xx, 4000, memories, converters) are simulated. The setting is saved in the design file.',
  ],
  'digital.settings.mode': ['Chế độ', 'Mode'],
  'digital.mode.auto': ['Tự động (mặc định)', 'Automatic (default)'],
  'digital.mode.autoHelp': [
    'IC dùng nguồn từ net VCC / VDD nếu sơ đồ có ký hiệu nguồn đó; nếu không có thì chạy ở mức logic danh định của họ.',
    'An IC is powered from the VCC / VDD net when the schematic has that power symbol; otherwise it runs at its family’s nominal levels.',
  ],
  'digital.mode.ideal': ['Lý tưởng', 'Ideal'],
  'digital.mode.idealHelp': [
    'Mức logic lý tưởng 0 V / nguồn danh định, ngưỡng ở giữa, không có dòng vào; không cần vẽ chân nguồn. Nhanh và dễ hiểu khi mới học.',
    'Ideal logic levels 0 V / nominal supply, threshold in the middle, no input current; no power pins needed. Fast and easy to read while learning.',
  ],
  'digital.mode.real': ['Thực tế', 'Real'],
  'digital.mode.realHelp': [
    'Mọi IC phải có nguồn: đặt ký hiệu VCC (TTL, 74HC…) hoặc VDD (4000) và đất. Dùng mức áp, ngưỡng, dòng vào và điện trở ra của từng họ, nên thấy được tải và sụt áp.',
    'Every IC needs its supply: place a VCC (TTL, 74HC…) or VDD (4000) symbol and ground. Uses each family’s levels, thresholds, input currents and output resistance, so loading and droop show up.',
  ],
  'digital.settings.timing': ['Thời gian trễ', 'Timing'],
  'digital.timing.typical': ['Điển hình (mặc định)', 'Typical (default)'],
  'digital.timing.typicalHelp': ['Trễ lan truyền điển hình theo datasheet của từng họ.', 'Typical datasheet propagation delays of each family.'],
  'digital.timing.max': ['Lớn nhất (trường hợp xấu)', 'Maximum (worst case)'],
  'digital.timing.maxHelp': ['Nhân trễ với tỉ lệ trường hợp xấu nhất của họ (ví dụ LS × 1,6): kiểm tra mạch còn chạy khi IC chậm.', 'Multiplies the delays by the family’s worst-case ratio (e.g. LS × 1.6): check the circuit still works with slow ICs.'],
  'digital.timing.zero': ['Không trễ', 'Zero delay'],
  'digital.timing.zeroHelp': ['Bỏ trễ lan truyền (sườn xung vẫn có thời gian lên / xuống): chỉ xem chức năng logic.', 'Removes the propagation delays (edges keep their rise / fall time): look at the logic function only.'],
  'digital.settings.apply': ['Áp dụng', 'Apply'],
  'digital.settings.applied': ['Đã đổi cài đặt mô phỏng số: {mode}, {timing}.', 'Digital simulation settings changed: {mode}, {timing}.'],
  'tip.digital.mode': ['Cách cấp nguồn và mức logic của các IC số', 'How digital ICs are powered and which logic levels they use'],
  'tip.digital.timing': ['Trễ lan truyền dùng khi mô phỏng quá độ', 'Propagation delays used in transient simulation'],

  // ---------------------------------------------------------------- memory contents editor
  'mem.edit': ['Sửa nội dung…', 'Edit contents…'],
  'tip.mem.edit': ['Mở bảng sửa nội dung bộ nhớ dạng hex (từng ô một từ)', 'Open the hex editor of the memory contents (one cell per word)'],
  'mem.editor.title': ['{name}: nội dung bộ nhớ', '{name}: memory contents'],
  'mem.editor.size': ['{words} từ × {bits} bit', '{words} words × {bits} bits'],
  'mem.editor.hint': [
    'Gõ giá trị hex vào từng ô (địa chỉ ở cột trái). RAM bắt đầu mỗi lần mô phỏng với nội dung này; ROM / EPROM giữ nguyên nội dung.',
    'Type a hex value into each cell (addresses on the left). A RAM starts every simulation with these contents; a ROM / EPROM always keeps them.',
  ],
  'mem.editor.page': ['Trang địa chỉ', 'Address page'],
  'tip.mem.page': ['Chọn vùng địa chỉ đang hiển thị (256 từ mỗi trang)', 'Choose the address range shown (256 words per page)'],
  'mem.editor.prev': ['◀ Trang trước', '◀ Previous'],
  'mem.editor.next': ['Trang sau ▶', 'Next ▶'],
  'tip.mem.prev': ['Xem 256 từ ở địa chỉ thấp hơn', 'Show the 256 words below'],
  'tip.mem.next': ['Xem 256 từ ở địa chỉ cao hơn', 'Show the 256 words above'],
  'mem.editor.address': ['Địa chỉ', 'Address'],
  'mem.editor.ascii': ['ASCII', 'ASCII'],
  'tip.mem.cell': ['Từ ở địa chỉ {addr} (hex, tối đa {digits} chữ số)', 'Word at address {addr} (hex, up to {digits} digits)'],
  'mem.editor.load': ['Nạp file…', 'Load file…'],
  'tip.mem.load': ['Nạp nội dung từ file Intel HEX hoặc file văn bản hex', 'Load the contents from an Intel HEX or hex text file'],
  'mem.editor.clear': ['Xoá hết về 0', 'Clear all to 0'],
  'tip.mem.clear': ['Đặt mọi từ về 0', 'Set every word to 0'],
  'mem.editor.used': ['{n} từ khác 0', '{n|non-zero word|non-zero words}'],
  'mem.editor.loaded': ['Đã nạp {name}.', 'Loaded {name}.'],
  'mem.editor.bad': ['Không đọc được: {error}', 'Could not read: {error}'],
  'mem.editor.badCell': ['Ô {addr}: “{text}” không phải số hex vừa {bits} bit', 'Cell {addr}: “{text}” is not a hex number that fits in {bits} bits'],

  // ---------------------------------------------------------------- ERC
  'erc.digitalNoPower.title': ['{refdes}: thiếu nguồn cho chân nguồn ẩn ({net})', '{refdes}: no supply for the hidden power pin ({net})'],
  'erc.digitalNoPower.why': [
    'Đang ở chế độ mô phỏng số “Thực tế”: IC chỉ chạy khi chân nguồn ẩn của nó nối được với net {net}, mà sơ đồ chưa có net đó.',
    'The digital simulation mode is “Real”: an IC only works when its hidden power pin reaches the {net} net, and the schematic has no such net.',
  ],
  'erc.digitalNoPower.fix': [
    'Đặt ký hiệu nguồn {net} (và đất) lên sơ đồ, hoặc chọn chế độ Lý tưởng / Tự động trong Mô phỏng › Cài đặt mô phỏng số.',
    'Place a {net} power symbol (and ground) on the schematic, or choose Ideal / Automatic in Simulate › Digital simulation settings.',
  ],

  // ---------------------------------------------------------------- catalogue specs
  'spec.tpd': ['Trễ lan truyền', 'Propagation delay'],
  'spec.words': ['Số từ nhớ', 'Words'],
  'spec.bits': ['Số bit', 'Bits'],
  'specValue.totem-pole': ['kéo-đẩy (totem-pole)', 'totem-pole'],
  'specValue.3-state': ['ba trạng thái', '3-state'],
  'specValue.open-drain': ['máng hở', 'open-drain'],
  'specValue.analog': ['tương tự', 'analog'],
  'specValue.schmitt': ['Schmitt (có trễ)', 'Schmitt (hysteresis)'],
} satisfies Catalogue;
