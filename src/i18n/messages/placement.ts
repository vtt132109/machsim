/**
 * UI messages: component placement and the component database at scale — the "Select a component"
 * dialog, catalogue packs loaded on demand, Update components from library, the variant manager
 * and the library profile (favourites, recent parts, user database in one file). Menu / command
 * labels and the few texts the start-up code shows; the dialog texts load with the dialogs
 * (src/i18n/placeText.ts). [vi, en]
 */
import type { Catalogue } from '../types';

export default {
  'cmd.place.componentDialog': ['Chọn linh kiện từ cơ sở dữ liệu…', 'Select a component from the database…'],
  'cmd.tools.updateComponents': ['Cập nhật linh kiện từ thư viện…', 'Update components from library…'],
  'cmd.tools.variants': ['Quản lý phương án lắp ráp…', 'Variant manager…'],
  'cmd.tools.exportLibraryProfile': ['Xuất thư viện của tôi (yêu thích, gần đây, linh kiện tự tạo)…', 'Export my library (favourites, recent, own parts)…'],
  'cmd.tools.importLibraryProfile': ['Nhập thư viện của tôi từ tệp…', 'Import my library from a file…'],
  'menu.myLibrary': ['Thư viện của tôi', 'My library'],
  'menu.activeVariant': ['Phương án đang dùng', 'Active variant'],
  'menu.noVariants': ['(chưa có phương án — mở Quản lý phương án)', '(no variants — open the Variant manager)'],
  'catalog.loadingGroup': ['đang nạp…', 'loading…'],
  'tip.catalog.loadingGroup': ['Đang nạp {n} linh kiện của nhóm này (chỉ nạp lần đầu mở nhóm)', 'Loading the {n} parts of this group (only the first time it is opened)'],
  'catalog.loadFailed': ['Không nạp được một phần thư viện: {error}. Mở lại nhóm để thử lại.', 'Part of the library could not be loaded: {error}. Open the group again to retry.'],
  'catalog.searchLoading': ['Đang nạp thêm linh kiện… kết quả sẽ còn bổ sung.', 'Loading more parts… more results may follow.'],
  'catalog.searchProgress': ['Đang tìm… {percent}%', 'Searching… {percent}%'],
  'catalog.details': ['Chi tiết…', 'Details…'],
  'tip.catalog.details': ['Mở hộp chọn linh kiện với đầy đủ thông tin: chức năng, mô hình, vỏ, liên kết, báo cáo chi tiết', 'Open the component dialog with every detail: function, model, package, link, detail report'],
  'variant.statusBar': ['Phương án: {name}', 'Variant: {name}'],
  'variant.toggleFitted': ['Lắp trong phương án “{variant}”', 'Fitted in variant “{variant}”'],
  'variant.ownValues': ['Giá trị riêng trong “{variant}”: {values} (sửa ở Công cụ › Quản lý phương án)', 'Own values in “{variant}”: {values} (edit in Tools › Variant manager)'],
  'variant.activated': ['Đang dùng phương án “{name}”: mô phỏng, BOM và báo cáo theo phương án này.', 'Variant “{name}” is active: simulation, BOM and reports follow it.'],
  'update.openNotice': ['{n} loại linh kiện trong thiết kế khác với thư viện hiện tại. Xem Công cụ > Cập nhật linh kiện từ thư viện.', '{n} kinds of parts in this design differ from the current library. See Tools > Update components from library.'],
  'sim.source.library': ['Thư viện', 'Library'],
} as const satisfies Catalogue;
