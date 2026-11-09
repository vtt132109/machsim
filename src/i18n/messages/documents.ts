/** UI messages: document tabs and the editing commands that came with them. [vi, en] */
import type { Catalogue } from '../types';

export default {
  // ---- menus and commands
  'menu.window': ['Cửa sổ', 'Window'],
  'menu.order': ['Thứ tự hình vẽ và chữ', 'Order'],
  'menu.pasteSpecial': ['Dán đặc biệt', 'Paste special'],
  'cmd.file.close': ['Đóng thiết kế', 'Close design'],
  'cmd.file.closeAll': ['Đóng tất cả thiết kế', 'Close all designs'],
  'cmd.file.saveAll': ['Lưu tất cả thiết kế', 'Save all designs'],
  'cmd.window.next': ['Thiết kế kế tiếp', 'Next design'],
  'cmd.window.previous': ['Thiết kế trước đó', 'Previous design'],
  'cmd.window.recent': ['Thiết kế vừa dùng trước đó', 'Last used design'],
  'cmd.edit.order.front': ['Đưa lên trên cùng', 'Bring to front'],
  'cmd.edit.order.back': ['Đưa xuống dưới cùng', 'Send to back'],
  'cmd.edit.order.forward': ['Đưa lên một lớp', 'Bring forward'],
  'cmd.edit.order.backward': ['Đưa xuống một lớp', 'Send backward'],
  'cmd.edit.layers': ['Lớp hiển thị…', 'Layer settings…'],
  'cmd.edit.pasteSpecial.keepNames': ['Dán giữ nguyên tên linh kiện', 'Paste without renaming'],
  'cmd.edit.pasteSpecial.values': ['Dán chỉ giá trị', 'Paste values only'],
  'cmd.edit.pasteSpecial.block': ['Dán thành mạch con…', 'Paste as subcircuit…'],
  'cmd.tools.refdesRules': ['Tiền tố tên linh kiện…', 'Reference designator prefixes…'],

  // ---- document tabs
  'docs.tabs.label': ['Các thiết kế đang mở', 'Open designs'],
  'docs.tab.new': ['Thiết kế mới', 'New design'],
  'docs.tab.close': ['Đóng {name}', 'Close {name}'],
  'docs.tab.unsaved': ['{name} (có thay đổi chưa lưu)', '{name} (unsaved changes)'],
  'docs.tab.closeOthers': ['Đóng các thiết kế khác', 'Close the other designs'],
  'docs.tab.moveLeft': ['Dời sang trái', 'Move left'],
  'docs.tab.moveRight': ['Dời sang phải', 'Move right'],
  'docs.tooMany.title': ['Đang mở quá nhiều thiết kế', 'Too many designs open'],
  'docs.tooMany.message': ['MachSim giữ tối đa {n} thiết kế mở cùng lúc. Hãy đóng bớt một thiết kế (nhớ lưu trước) rồi thử lại.', 'MachSim keeps at most {n} designs open at once. Close one (save it first) and try again.'],
  'docs.recover.many': ['MachSim tìm thấy bản lưu tự động của {n} thiết kế chưa lưu ({names}), lần cuối lúc {when}. Khôi phục tất cả?', 'MachSim found autosaved copies of {n} unsaved designs ({names}), last written at {when}. Recover them all?'],
  'sim.source.documents': ['Nhiều thiết kế', 'Documents'],
  'sim.source.editing': ['Sửa sơ đồ', 'Editing'],
  'sim.source.print': ['In', 'Print'],
} as const satisfies Catalogue;
