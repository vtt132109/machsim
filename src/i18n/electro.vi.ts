/**
 * Vietnamese texts of the round-4 sound and electromechanical parts (src/library/catalog/audio.ts,
 * relays.ts, lineMagnetics.ts, batteries.ts, measurementSource.ts, protection.ts): family names,
 * parameter labels, option labels and help texts, keyed by the English text like the rest of
 * LIB_TEXT_VI (src/i18n/library.vi.ts merges this table).
 */
export const ELECTRO_TEXT_VI: Record<string, string> = {
  // families
  Speaker: 'Loa',
  'Audio sources': 'Nguồn âm thanh',
  'Relay coil': 'Cuộn rơ-le',
  'Contactor coil': 'Cuộn công-tắc-tơ',
  'Timer coil': 'Cuộn rơ-le thời gian',
  'Relay contact': 'Tiếp điểm rơ-le',
  'Timer contact': 'Tiếp điểm thời gian',
  'Contactor contact': 'Tiếp điểm công-tắc-tơ',
  'Supplementary contact': 'Tiếp điểm phụ',
  'Overload contact': 'Tiếp điểm rơ-le nhiệt',
  'Overload relay': 'Rơ-le nhiệt',
  'Motor starter': 'Khởi động từ',
  'Line transformer': 'Biến áp nguồn',
  'Magnetic sources': 'Nguồn từ',
  Batteries: 'Pin và ắc quy',
  'Measurement file sources': 'Nguồn từ tệp đo lường',

  // speaker, headphones
  Impedance: 'Trở kháng',
  'Nominal impedance of the voice coil: the circuit sees about 0.8 times this as resistance, plus a small inductance': 'Trở kháng danh định của cuộn loa: mạch thấy khoảng 0.8 lần giá trị này làm điện trở, cộng một chút điện cảm',
  Volume: 'Âm lượng',
  'Playback volume of this speaker (the master volume of the Audio window applies on top)': 'Âm lượng phát của loa này (âm lượng chung trong cửa sổ Âm thanh nhân thêm lên trên)',
  'Full-scale voltage': 'Điện áp đầy thang',
  'The voltage across the speaker that plays at full scale at 100 % volume; larger signals are clipped': 'Điện áp trên loa phát to hết cỡ ở âm lượng 100 %; tín hiệu lớn hơn bị xén',
  Mute: 'Tắt tiếng',
  "Silences this speaker (key 'M' toggles it while the simulation runs)": "Tắt tiếng loa này (phím 'M' bật / tắt khi đang mô phỏng)",

  // microphone, WAV
  'Signal source': 'Nguồn tín hiệu',
  'Microphone (live)': 'Micrô (trực tiếp)',
  'Test tone': 'Âm thử',
  'Voltage of a full-scale input (a loud sound): 1 V is a good size for a line-level circuit': 'Điện áp của tín hiệu đầy thang (âm thanh to): 1 V là cỡ hợp với mạch mức đường truyền',
  'Test-tone frequency': 'Tần số âm thử',
  'Frequency of the test tone (also used when the microphone is not available)': 'Tần số của âm thử (cũng dùng khi không có micrô)',
  'Sample rate': 'Tần số lấy mẫu',
  'Samples per second fed to the circuit: 8000 Hz is enough for speech and keeps the simulation fast': 'Số mẫu mỗi giây đưa vào mạch: 8000 Hz đủ cho tiếng nói và giữ mô phỏng nhanh',
  'WAV file': 'Tệp WAV',
  'Text of the WAV file (base64). Use "Open WAV file…" to load a .wav file; the part keeps it as 16-bit mono, at most 30 s': 'Nội dung tệp WAV (base64). Dùng "Mở tệp WAV…" để nạp tệp .wav; linh kiện giữ nó dạng 16-bit đơn kênh, dài tối đa 30 giây',
  'Value of a full-scale sample (±1)': 'Giá trị của mẫu đầy thang (±1)',
  '2 plays the file twice as slowly (the pitch falls); 0.5 twice as fast': '2 phát tệp chậm gấp đôi (âm trầm đi); 0.5 nhanh gấp đôi',
  'Start again when the file ends': 'Phát lại từ đầu khi tệp hết',

  // coils
  'Coil rating': 'Công suất cuộn',
  'Apparent power of the sealed coil: the impedance is V² / VA at 50 Hz': 'Công suất biểu kiến của cuộn khi đã hút: tổng trở là V² / VA ở 50 Hz',

  // contacts
  Coil: 'Cuộn hút',
  'Reference designator of the coil (or overload relay) this contact follows, e.g. K1: the same name on any number of contacts, on any sheet': 'Ký hiệu của cuộn hút (hoặc rơ-le nhiệt) mà tiếp điểm này theo, ví dụ K1: cùng một tên cho bao nhiêu tiếp điểm cũng được, ở trang nào cũng được',

  // overload relay, starter
  'Current setting': 'Dòng đặt',
  'Dial setting Ir: no trip up to 1.05 × Ir, trip at 1.2 × Ir after the thermal lag': 'Dòng đặt Ir: không tác động tới 1.05 × Ir, tác động ở 1.2 × Ir sau độ trễ nhiệt',
  'Trip class': 'Cấp tác động',
  'Class 10A / 10 / 20 / 30: how long a cold relay takes to trip at 7.2 × Ir (a motor start with long run-up needs class 20 or 30)': 'Cấp 10A / 10 / 20 / 30: thời gian rơ-le nguội tác động ở 7.2 × Ir (động cơ khởi động lâu cần cấp 20 hoặc 30)',
  'Class 10A (4 s at 7.2 × Ir)': 'Cấp 10A (4 s ở 7.2 × Ir)',
  'Class 10 (7 s at 7.2 × Ir)': 'Cấp 10 (7 s ở 7.2 × Ir)',
  'Class 20 (13 s at 7.2 × Ir)': 'Cấp 20 (13 s ở 7.2 × Ir)',
  'Class 30 (20 s at 7.2 × Ir)': 'Cấp 30 (20 s ở 7.2 × Ir)',
  Reset: 'Đặt lại',
  "Clears a tripped relay (key 'R' while the simulation runs)": "Xoá trạng thái đã tác động (phím 'R' khi đang mô phỏng)",
  'Overload setting': 'Dòng đặt rơ-le nhiệt',
  "Clears a tripped overload (key 'R' while the simulation runs)": "Xoá trạng thái quá tải đã tác động (phím 'R' khi đang mô phỏng)",

  // line transformer
  'Primary voltage': 'Điện áp sơ cấp',
  'Mains voltage (RMS) the primary is made for': 'Điện áp lưới (hiệu dụng) mà cuộn sơ cấp được làm cho',
  'Secondary voltage at rated load': 'Điện áp thứ cấp khi đầy tải',
  'Secondary voltage (RMS) while the rated power is drawn by a resistive load': 'Điện áp thứ cấp (hiệu dụng) khi tải điện trở lấy đủ công suất định mức',
  'Apparent power the secondary can deliver continuously': 'Công suất biểu kiến thứ cấp cấp được liên tục',
  Regulation: 'Độ lệch điện áp',
  'How much the secondary voltage rises from rated load to no load, as a percentage of the rated voltage': 'Điện áp thứ cấp tăng bao nhiêu từ đầy tải lên không tải, tính theo phần trăm điện áp định mức',
  'No-load current': 'Dòng không tải',
  'Primary current without load, as a percentage of the rated primary current': 'Dòng sơ cấp khi không tải, tính theo phần trăm dòng sơ cấp định mức',
  'Mains frequency': 'Tần số lưới',
  'Leakage between primary and secondary (gives the secondary a DC reference)': 'Dòng rò giữa sơ cấp và thứ cấp (cho thứ cấp một điểm tham chiếu một chiều)',

  // magnetic sources
  Flux: 'Từ thông',
  'Magnetic flux through the coil (webers)': 'Từ thông xuyên qua cuộn dây (vêbe)',
  'Number of turns of the coil the flux passes through': 'Số vòng của cuộn dây mà từ thông đi qua',
  'Change of the flux for one press of the key (Shift+key lowers it)': 'Độ đổi của từ thông mỗi lần bấm phím (Shift+phím để giảm)',
  'Minimum flux': 'Từ thông nhỏ nhất',
  'Maximum flux': 'Từ thông lớn nhất',
  Sawtooth: 'Răng cưa',
  'Peak flux': 'Từ thông đỉnh',

  // batteries
  Chemistry: 'Loại pin',
  'Sets the discharge curve and how fast the internal resistance rises (alkaline cells cannot be recharged)': 'Quyết định đường cong xả và tốc độ tăng của điện trở trong (pin kiềm không sạc lại được)',
  Alkaline: 'Kiềm (alkaline)',
  'Li-ion': 'Li-ion',
  'Lead-acid': 'Axit–chì',
  'Cells in series': 'Số cell nối tiếp',
  'A 9 V block is 6 alkaline cells, a 12 V lead-acid battery is 6 cells, a 3S Li-ion pack is 3 cells': 'Pin vuông 9 V là 6 cell kiềm, ắc quy axit–chì 12 V là 6 cell, bộ Li-ion 3S là 3 cell',
  Capacity: 'Dung lượng',
  'Charge the battery delivers from full to empty at a moderate current': 'Điện tích pin cấp được từ đầy tới hết ở dòng vừa phải',
  'Initial charge': 'Điện tích ban đầu',
  'Charge left at the start of the simulation, in percent of the capacity': 'Điện tích còn lại lúc bắt đầu mô phỏng, tính theo phần trăm dung lượng',
  'Internal resistance (full)': 'Điện trở trong (khi đầy)',
  'Internal resistance of the whole battery when full; it rises as the charge falls': 'Điện trở trong của cả pin khi đầy; nó tăng lên khi điện tích giảm',

  // measurement file
  'Measurement data': 'Dữ liệu đo',
  'The text of the file: an X (time) column and one column per channel; use Open file… to load an LVM text, CSV or TSV file': 'Nội dung tệp: một cột X (thời gian) và mỗi kênh một cột; dùng Mở tệp… để nạp tệp LVM dạng văn bản, CSV hoặc TSV',
  Channel: 'Kênh',
  'Which value column to play (1 = the first after the time column)': 'Phát cột giá trị nào (1 = cột đầu sau cột thời gian)',
  '2 plays the recording twice as slowly, 0.5 twice as fast': '2 phát bản ghi chậm gấp đôi, 0.5 nhanh gấp đôi',
  'Multiplies every value (e.g. 1000 for a file in kV)': 'Nhân mọi giá trị (ví dụ 1000 cho tệp tính bằng kV)',
  'Value offset': 'Độ lệch giá trị',
  'Start again when the recording ends': 'Phát lại từ đầu khi bản ghi hết',

  // fuse I²t, breaker
  'Current the fuse carries for ever': 'Dòng cầu chì chịu được vô hạn',
  'Melting energy I²t': 'Năng lượng nóng chảy I²t',
  'Pre-arcing energy: ∫I²dt that melts the element (the datasheet value at 10 ms). At a large constant current the fuse blows after I²t / I²': 'Năng lượng trước khi hồ quang: ∫I²dt làm chảy dây (giá trị trong datasheet ở 10 ms). Ở dòng không đổi lớn, cầu chì chảy sau I²t / I²',
  'Minimum melting current': 'Dòng nóng chảy nhỏ nhất',
  'Below this multiple of the rated current the fuse never blows (1.5 is typical)': 'Dưới bội số này của dòng định mức cầu chì không bao giờ chảy (thường là 1.5)',
  'Trip curve': 'Đường cong cắt',
  'B for resistive loads, C for general use, D for motors and transformers (high inrush), K for motors, Z for sensitive electronics': 'B cho tải điện trở, C dùng chung, D cho động cơ và biến áp (dòng khởi động lớn), K cho động cơ, Z cho thiết bị điện tử nhạy',
};
