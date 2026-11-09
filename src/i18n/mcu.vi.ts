/**
 * Vietnamese texts of the microcontroller parts (src/library/catalog/mcu.ts): the family name,
 * parameter labels, help texts and option labels, keyed by the English text (spread into
 * LIB_TEXT_VI). Original translations.
 */
export const MCU_TEXT_VI: Record<string, string> = {
  // ------------------------------------------------------------------------- family
  Microcontroller: 'Vi điều khiển',
  // ------------------------------------------------------------------------- parameters
  Program: 'Chương trình',
  'MCS-51 assembly source or Intel HEX text. Open the code editor (Edit program…) to assemble it, see the errors and run it step by step.':
    'Mã nguồn hợp ngữ MCS-51 hoặc văn bản Intel HEX. Mở Trình soạn mã (Sửa chương trình…) để dịch, xem lỗi và chạy từng lệnh.',
  'Crystal frequency': 'Tần số thạch anh',
  'One machine cycle is 12 oscillator periods: 12 MHz gives a 1 µs machine cycle, 11.0592 MHz gives exact serial baud rates':
    'Một chu kỳ máy bằng 12 chu kỳ thạch anh: 12 MHz cho chu kỳ máy 1 µs, 11,0592 MHz cho tốc độ truyền nối tiếp đúng chuẩn',
  'External RAM (MOVX)': 'RAM ngoài (lệnh MOVX)',
  'Data memory reached with MOVX; the address and data buses are not drawn, the memory is inside the model':
    'Bộ nhớ dữ liệu mà lệnh MOVX truy cập; không phải vẽ bus địa chỉ và dữ liệu, bộ nhớ nằm trong mô hình',
  'None (MOVX reads 0FFh)': 'Không có (MOVX đọc ra 0FFh)',
  '256 bytes': '256 byte',
  '2 KB': '2 KB',
  '32 KB': '32 KB',
  '64 KB': '64 KB',
  'Port drive': 'Kiểu ngõ ra của cổng',
  'Real ports pull a pin down strongly and let it float up through a weak pull-up, so a load must be wired to the supply; push-pull drives both levels':
    'Cổng thật kéo chân xuống mạnh và chỉ treo chân lên qua điện trở yếu, nên tải phải nối từ nguồn xuống chân; kiểu kéo-đẩy phát cả hai mức',
  'Quasi-bidirectional (like the real part)': 'Hai chiều kiểu 8051 (giống linh kiện thật)',
  'Push-pull (easier for experiments)': 'Kéo-đẩy (dễ thí nghiệm hơn)',
  'Internal pull-up': 'Điện trở treo trong chip',
  'Pull-up of the released P1 / P2 / P3 pins (port 0 has none and needs an external pull-up)':
    'Điện trở treo của các chân P1 / P2 / P3 khi ở mức 1 (cổng 0 không có, phải treo bằng điện trở ngoài)',
  'Register read-outs': 'Số liệu thanh ghi',
  'Publish the registers, the SFRs and a RAM window as result vectors so the code editor can show them while the simulation runs':
    'Xuất thanh ghi, thanh ghi đặc biệt và một cửa sổ RAM thành biến kết quả để Trình soạn mã hiện được chúng trong lúc mô phỏng',
  'Look-ahead': 'Chạy trước',
  'Machine cycles the core may run ahead to find when the program next changes a pin (a timepoint is placed there)':
    'Số chu kỳ máy mà lõi được chạy trước để biết khi nào chương trình đổi mức một chân (bộ mô phỏng sẽ lấy đúng mốc thời gian đó)',
};
