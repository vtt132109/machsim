/** UI messages: the professional schematic tools of round 3 step 7 (ERC options, net settings, capture area, customize UI, footprints). [vi, en] */
import type { Catalogue } from '../types';

export default {
  // ---- commands and menus
  'cmd.tools.ercOptions': ['Tuỳ chọn ERC…', 'ERC options…'],
  'cmd.tools.ercReport': ['Xuất báo cáo ERC…', 'Export ERC report…'],
  'cmd.tools.clearErcScope': ['Xoá dấu ERC theo phạm vi…', 'Delete ERC markers…'],
  'cmd.tools.netSettings': ['Cài đặt net…', 'Net settings…'],
  'cmd.tools.footprints': ['Danh mục chân vỏ (footprint)…', 'Footprint manager…'],
  'cmd.options.customizeUi': ['Tuỳ biến giao diện…', 'Customize user interface…'],
  'cmd.edit.captureArea': ['Chụp vùng trên trang', 'Capture screen area'],
  'cmd.edit.ncMarker': ['Dấu không nối (NC)…', 'NC marker…'],
  'menu.ercTools': ['Kiểm tra điện (ERC)', 'Electrical rules check'],
  'editor.toolHint.capture': ['Kéo một hình chữ nhật để chụp vùng đó thành ảnh · Esc để thôi', 'Drag a rectangle to capture that area as a picture · Esc to cancel'],

  // ---- short messages shown in the Simulation messages tab
  'schematicTools.captureCopied': ['Đã chép ảnh vùng {w} × {h} vào bộ nhớ tạm.', 'Copied a {w} × {h} picture of the area to the clipboard.'],
  'schematicTools.captureSaved': ['Đã lưu ảnh vùng vào tệp “{name}”.', 'Saved a picture of the area as “{name}”.'],
  'schematicTools.captureFailed': ['Không chép được vào bộ nhớ tạm (trình duyệt không cho phép), nên ảnh được lưu thành tệp.', 'The clipboard is not available in this browser, so the picture was saved as a file instead.'],
  'schematicTools.markersDeleted': ['Đã xoá {n} dấu ERC.', 'Deleted {n} ERC markers.'],
  'schematicTools.ncMarked': ['{refdes}: đã đánh dấu {n} chân là không nối (NC).', '{refdes}: marked {n} pins as not connected (NC).'],
  'schematicTools.ncCleared': ['{refdes}: đã bỏ dấu không nối trên {n} chân.', '{refdes}: removed the NC marker from {n} pins.'],
  'schematicTools.netApplied': ['Đã lưu cài đặt cho net {net}.', 'Saved the settings of net {net}.'],
  'schematicTools.shortcutsApplied': ['Đã lưu {n} phím tắt riêng.', 'Saved {n} custom shortcuts.'],
  'schematicTools.selectPartFirst': ['Hãy chọn một linh kiện trước (dấu NC đặt trên chân của linh kiện đang chọn).', 'Select a part first (an NC marker belongs to a pin of the selected part).'],
  'schematicTools.selectWireFirst': ['Hãy chọn một dây, nhãn net hoặc chân trước để biết cần đặt cài đặt cho net nào.', 'Select a wire, a net label or a pin first, so MachSim knows which net you mean.'],
} as const satisfies Catalogue;
