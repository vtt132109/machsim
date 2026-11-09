/**
 * Vietnamese texts of the PLC rack and the mechatronics parts
 * (src/library/catalog/plc.ts, mecha.ts): family names, parameter labels, option labels and help
 * texts, keyed by the English text like the rest of LIB_TEXT_VI (src/i18n/library.vi.ts merges
 * this table).
 */
export const LADDER_TEXT_VI: Record<string, string> = {
  // families
  'PLC rack': 'Giá PLC',
  Mechatronics: 'Cơ điện tử',

  // ---- PLC rack
  'Scan period': 'Chu kỳ quét',
  'Time of one scan: inputs are sampled, every rung is run once and the outputs are written. It is also the resolution of the timers (10 ms is a good value for a learner)':
    'Thời gian của một vòng quét: đọc ngõ vào, chạy một lượt mọi bậc rồi ghi ngõ ra. Đây cũng là độ phân giải của các bộ định thời (10 ms là giá trị tốt để học)',
  'Live read-outs': 'Hiện trạng thái khi chạy',
  'Publish the images, the timers, the counters and which rung carries power as result vectors, so the ladder editor lights up the running program':
    'Ghi ảnh vào / ra, bộ định thời, bộ đếm và bậc nào đang có điện thành biến kết quả, để trang bậc thang tô sáng chương trình đang chạy',
  'Address byte': 'Byte địa chỉ',
  'First address of the module: byte 0 gives I0.0 … I0.7, byte 1 gives I1.0 … I1.7':
    'Địa chỉ đầu của mô-đun: byte 0 cho I0.0 … I0.7, byte 1 cho I1.0 … I1.7',
  'First address of the module: byte 0 gives Q0.0 … Q0.7, byte 1 gives Q1.0 … Q1.7':
    'Địa chỉ đầu của mô-đun: byte 0 cho Q0.0 … Q0.7, byte 1 cho Q1.0 … Q1.7',
  'A channel reads ON above this voltage and OFF below it (half of the supply of a 24 V module)':
    'Kênh đọc mức 1 khi điện áp cao hơn giá trị này và mức 0 khi thấp hơn (thường lấy nửa điện áp nguồn của mô-đun 24 V)',
  Hysteresis: 'Vùng trễ',
  'Band around the threshold in which the channel keeps its previous value, so a slow or noisy signal does not chatter':
    'Dải quanh ngưỡng mà kênh giữ nguyên giá trị cũ, nhờ đó tín hiệu chậm hoặc có nhiễu không bị rung',
  'Output voltage': 'Điện áp ra',
  'Voltage a switched-on channel drives against COM': 'Điện áp kênh đang bật phát ra so với COM',
  'Series resistance of the switching element (a real transistor output drops a little)':
    'Điện trở nối tiếp của phần tử đóng cắt (ngõ ra transistor thật sụt một chút)',
  'First channel': 'Kênh đầu tiên',
  'Channel number of the first pin: 0 gives AQ0, AQ1 …': 'Số kênh của chân đầu tiên: 0 cho AQ0, AQ1 …',
  'Output range': 'Phạm vi ra',
  'The pin never goes beyond plus or minus this voltage, whatever the program writes': 'Chân không bao giờ vượt quá ± điện áp này, dù chương trình ghi bao nhiêu',
  'Channel number of the first pin: 0 gives AI0, AI1 …': 'Số kênh của chân đầu tiên: 0 cho AI0, AI1 …',

  // ---- shared parameters of the machines
  'Sensor voltage': 'Điện áp cảm biến',
  'Voltage a closed sensor pin drives against COM (0 V when it is open)':
    'Điện áp chân cảm biến phát ra so với COM khi tác động (0 V khi không tác động)',
  'Analog full scale': 'Thang đo tương tự',
  'Voltage the analog pin gives when the measured value is at its maximum':
    'Điện áp chân tương tự phát ra khi giá trị đo đạt mức lớn nhất',
  'An input pin counts as ON above this voltage': 'Chân vào được coi là bật khi điện áp cao hơn giá trị này',
  'Input load': 'Tải chân vào',
  'Load every input pin puts on its driver (a lamp pin of the junction can be given a real lamp resistance here)':
    'Tải mà mỗi chân vào đặt lên mạch điều khiển (chân đèn của nút giao thông có thể đặt bằng điện trở đèn thật)',
  'Time step': 'Bước thời gian',
  'Longest step the machine is advanced by: smaller means the sensors switch more exactly and the drawing moves more smoothly':
    'Bước thời gian lớn nhất khi tính chuyển động của máy: càng nhỏ thì cảm biến tác động càng đúng lúc và hình vẽ càng mượt',
  'Live drawing': 'Hình động khi chạy',
  'Record the state of the machine so the schematic animates it while the simulation runs':
    'Ghi lại trạng thái của máy để sơ đồ vẽ chuyển động trong lúc mô phỏng chạy',

  // ---- conveyor
  'Belt length': 'Chiều dài băng',
  'Length of the belt from the feed end to the drop end': 'Chiều dài băng tải từ đầu cấp vật tới đầu rơi vật',
  'Belt speed': 'Tốc độ băng',
  'Speed while the motor runs': 'Tốc độ khi động cơ chạy',
  'Sensor 1 position': 'Vị trí cảm biến 1',
  'Distance of the first sensor from the feed end': 'Khoảng cách từ đầu cấp vật tới cảm biến thứ nhất',
  'Sensor 2 position': 'Vị trí cảm biến 2',
  'Distance of the second sensor from the feed end': 'Khoảng cách từ đầu cấp vật tới cảm biến thứ hai',
  'Sensor window': 'Bề rộng vùng cảm biến',
  'How wide an item looks to a sensor (the sensor is on while the item is inside this window)':
    'Bề rộng mà cảm biến “thấy” một vật (cảm biến tác động khi vật còn trong vùng này)',
  'Item spacing': 'Khoảng cách giữa hai vật',
  'An item is only put on when the previous one has moved at least this far':
    'Chỉ đặt vật mới lên băng khi vật trước đã đi được ít nhất khoảng này',
  Feeding: 'Cấp vật',
  'Where the items come from': 'Vật được đưa lên băng từ đâu',
  'Automatic, every feed interval': 'Tự động, theo chu kỳ cấp vật',
  'From the FEED pin': 'Từ chân FEED',
  'Feed interval': 'Chu kỳ cấp vật',
  'Time between two items in automatic feeding': 'Thời gian giữa hai vật khi cấp tự động',

  // ---- junction
  'Fault time': 'Thời gian báo lỗi',
  'How long an unsafe combination of lamps may last before ERR goes high (a short overlap during a change is allowed)':
    'Tổ hợp đèn không an toàn được phép kéo dài bao lâu trước khi chân ERR lên mức cao (cho phép chồng đèn một chút lúc chuyển pha)',

  // ---- tank
  'Tank volume': 'Thể tích bồn',
  'Litres the tank holds when it is full': 'Số lít bồn chứa được khi đầy',
  'Pump flow': 'Lưu lượng bơm',
  'Flow the pump delivers while it runs': 'Lưu lượng bơm cấp vào khi đang chạy',
  'Drain flow (full)': 'Lưu lượng xả (khi đầy)',
  'Flow through the open valve with a full tank; it falls with √level, so the tank empties in 2·volume / this flow':
    'Lưu lượng qua van xả khi bồn đầy; lưu lượng giảm theo √mức, nên bồn đầy cạn hết sau 2·thể tích / lưu lượng này',
  'Low switch': 'Công tắc mức thấp',
  'Height of the lower float switch as a percentage of the tank': 'Vị trí công tắc phao dưới, tính theo phần trăm chiều cao bồn',
  'High switch': 'Công tắc mức cao',
  'Height of the upper float switch': 'Vị trí công tắc phao trên',
  'Level at the start': 'Mức nước lúc bắt đầu',
  'How full the tank is when the simulation starts': 'Bồn đầy bao nhiêu khi mô phỏng bắt đầu',

  // ---- door
  'Travel time': 'Thời gian hành trình',
  'Time the door needs from fully closed to fully open': 'Thời gian cửa đi từ đóng kín tới mở hết',
  'Position at the start': 'Vị trí lúc bắt đầu',
  '0 = closed, 100 = open': '0 = đóng kín, 100 = mở hết',
  'Obstacle appears at': 'Vật xuất hiện lúc',
  'Time an obstacle breaks the light barrier (0 = never)': 'Thời điểm có vật chắn mắt thần (0 = không bao giờ)',
  'Obstacle stays': 'Vật chắn trong',
  'How long the obstacle stays in the way': 'Vật chắn nằm trên lối đi bao lâu',

  // ---- lift
  'Time per floor': 'Thời gian mỗi tầng',
  'Time the car needs to travel one floor': 'Thời gian cabin đi hết một tầng',
  'Door time': 'Thời gian mở cửa',
  'Time the door needs to open (and to close again)': 'Thời gian cửa mở hết (và đóng lại)',
  'How far from the floor the floor sensor already answers, in floors':
    'Cabin còn cách tầng bao nhiêu (tính theo tầng) thì cảm biến tầng đã tác động',
  'Floor at the start': 'Tầng lúc bắt đầu',
  'Floor the car stands on when the simulation starts': 'Tầng cabin đang đứng khi mô phỏng bắt đầu',
};
