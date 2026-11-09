/**
 * Texts of the Audio window (Simulate › Audio), the WAV import of the properties panel and the WAV
 * export of the Grapher, Vietnamese first. Loaded with those panels (src/ui/integration/AudioPanel.tsx,
 * src/ui/editor/WavField.tsx, the Grapher chunk), so the start-up catalogue stays small; the menu
 * label lives in messages/audio.ts. Original text written for MachSim.
 *
 *   aut('key', { n: 3 })   text in the current language, {placeholders} filled
 */
import { interpolate, L, tr, type LocalizedText } from './core';

export const AUDIO_TEXT = {
  // ---- Audio window
  title: L('Âm thanh', 'Audio'),
  intro: L(
    'Loa và tai nghe trên sơ đồ phát điện áp của mạch ra card âm thanh trong lúc mô phỏng tương tác chạy. Micrô đưa tiếng nói của bạn vào mạch.',
    'Speakers and headphones on the schematic play the circuit’s voltage through the sound card while an interactive simulation runs. The microphone feeds your voice into the circuit.',
  ),
  masterVolume: L('Âm lượng chung', 'Master volume'),
  masterVolumeTip: L('Nhân thêm với âm lượng riêng của từng loa', 'Applies on top of each speaker’s own volume'),
  muteAll: L('Tắt tiếng', 'Mute'),
  unmuteAll: L('Bật tiếng', 'Unmute'),
  muteTip: L('Tắt hoặc bật tiếng mọi loa', 'Silence or restore every speaker'),
  level: L('Mức âm thanh', 'Sound level'),
  levelTip: L('Đỉnh của âm thanh vừa phát; chạm đầu thanh nghĩa là bị xén', 'Peak of the sound just played; reaching the end means clipping'),
  idle: L('Mô phỏng chưa chạy. Nhấn Chạy (F5) để nghe.', 'The simulation is not running. Press Run (F5) to listen.'),
  playing: L('Đang phát đúng thời gian thực.', 'Playing in real time.'),
  paused: L('Mô phỏng đang tạm dừng.', 'The simulation is paused.'),
  slower: L('Mô phỏng chậm hơn thời gian thực: âm thanh phát ×{speed} (bị kéo giãn, nghe trầm đi).', 'Simulation slower than real time: the sound plays at ×{speed} (stretched, lower in pitch).'),
  slowerHelp: L(
    'Mạch nặng hoặc bước thời gian nhỏ làm mô phỏng chậm. Tăng bước thời gian, bớt linh kiện hoặc dùng tín hiệu đơn giản hơn để nghe đúng cao độ.',
    'A heavy circuit or a small time step slows the simulation. Raise the time step, remove parts or use a simpler signal to hear the true pitch.',
  ),
  noSpeaker: L('Chưa có loa nào trên sơ đồ. Đặt “Loa” hoặc “Tai nghe” (nhóm Chỉ thị) vào nút cần nghe.', 'There is no speaker on the schematic. Place a “Speaker” or “Headphones” (Indicators group) on the node you want to hear.'),
  noSink: L('Không mở được card âm thanh trong môi trường này, nên mô phỏng chạy không có tiếng.', 'The sound card could not be opened in this environment, so the simulation runs without sound.'),
  speakersTitle: L('Loa trên sơ đồ', 'Speakers on the schematic'),
  speakerVolume: L('Âm lượng', 'Volume'),
  speakerMute: L('Tắt tiếng', 'Mute'),
  speakerFull: L('Đầy thang: {v} V', 'Full scale: {v} V'),
  speakerMuteTip: L('Tắt tiếng loa này (phím M khi đang mô phỏng)', 'Mute this speaker (key M while simulating)'),
  speakerVolumeTip: L('Âm lượng riêng của loa này', 'Volume of this speaker'),

  // ---- microphone
  micTitle: L('Micrô', 'Microphone'),
  micNone: L('Chưa có micrô trên sơ đồ.', 'There is no microphone on the schematic.'),
  micWaiting: L('Chưa chạy. Khi bạn nhấn Chạy, trình duyệt sẽ hỏi quyền dùng micrô.', 'Not running yet. When you press Run the browser asks for permission to use the microphone.'),
  micAsking: L('Đang chờ bạn cho phép dùng micrô…', 'Waiting for you to allow the microphone…'),
  micLive: L('Đang dùng micrô của máy.', 'Using the machine’s microphone.'),
  micTone: L('Đang dùng âm thử.', 'Using the test tone.'),
  micDenied: L(
    'Bạn đã từ chối quyền dùng micrô, nên mạch nhận âm thử (440 Hz) thay thế. Cho phép lại ở biểu tượng ổ khóa trên thanh địa chỉ rồi chạy lại.',
    'Microphone permission was refused, so the circuit gets a test tone (440 Hz) instead. Allow it again with the lock icon in the address bar, then run again.',
  ),
  micUnavailable: L('Không tìm thấy micrô (hoặc môi trường này không có Web Audio), nên mạch nhận âm thử thay thế.', 'No microphone was found (or this environment has no Web Audio), so the circuit gets a test tone instead.'),
  micLevel: L('Mức vào', 'Input level'),
  micLevelTip: L('Đỉnh của tín hiệu từ micrô; không nhúc nhích nghĩa là chưa có tiếng', 'Peak of the microphone signal; a bar that never moves means no sound arrives'),

  // ---- WAV file import (properties panel)
  wavOpen: L('Mở tệp WAV…', 'Open WAV file…'),
  wavOpenTip: L('Chọn tệp .wav: đổi thành 16-bit đơn kênh, tối đa 30 giây', 'Choose a .wav file: it becomes 16-bit mono, at most 30 seconds'),
  wavClear: L('Xoá (dùng xung 1 kHz có sẵn)', 'Clear (use the built-in 1 kHz burst)'),
  wavBuiltin: L('Chưa nạp tệp: đang dùng xung 1 kHz dài 20 ms có sẵn.', 'No file loaded: using the built-in 20 ms burst of 1 kHz.'),
  wavLoaded: L('{name}: {seconds} s, {rate} Hz, đơn kênh.', '{name}: {seconds} s, {rate} Hz, mono.'),
  wavInfo: L('Tệp đã nạp: {seconds} s, {rate} Hz, đơn kênh.', 'File loaded: {seconds} s, {rate} Hz, mono.'),
  wavCut: L('Tệp dài hơn {max} s nên chỉ giữ {max} s đầu.', 'The file is longer than {max} s, so only the first {max} s are kept.'),
  wavResampled: L('Đã giảm tần số lấy mẫu từ {from} Hz xuống {to} Hz để mô phỏng nhẹ hơn.', 'The sample rate was reduced from {from} Hz to {to} Hz to keep the simulation light.'),
  wavBad: L('Không đọc được tệp WAV: {reason}', 'The WAV file could not be read: {reason}'),
  wavBadNotWav: L('đây không phải tệp RIFF/WAVE', 'it is not a RIFF/WAVE file'),
  wavBadFormat: L('định dạng nén hoặc độ sâu bit không được hỗ trợ (dùng PCM 8 / 16 / 24 / 32-bit hoặc float)', 'a compressed format or bit depth that is not supported (use 8 / 16 / 24 / 32-bit PCM or float)'),
  wavBadEmpty: L('tệp không có mẫu nào', 'the file holds no samples'),
  wavBadOther: L('tệp bị hỏng hoặc bị cắt', 'the file is damaged or cut'),

  // ---- WAV export (Grapher)
  exportTitle: L('Xuất WAV', 'Export WAV'),
  exportIntro: L('Lưu một đường của đồ thị thành tệp âm thanh .wav để nghe bằng chương trình khác. Đường được lấy mẫu lại đều.', 'Save one trace of the graph as a .wav sound file to listen to in another program. The trace is resampled evenly.'),
  exportTrace: L('Đường cần xuất', 'Trace to export'),
  exportRate: L('Tần số lấy mẫu', 'Sample rate'),
  exportSeconds: L('Độ dài thật của tín hiệu: {t} (sẽ thành {n} mẫu).', 'Real length of the signal: {t} (becomes {n} samples).'),
  exportStretch: L('Kéo giãn thời gian ×', 'Time stretch ×'),
  exportStretchTip: L('Kéo giãn thời gian của tín hiệu khi lưu: 1000 biến tín hiệu 5 ms thành 5 giây nghe được', 'Stretch the signal’s time when saving: 1000 turns a 5 ms signal into 5 audible seconds'),
  exportNormalize: L('Chuẩn hoá mức (đỉnh 0.98)', 'Normalise the level (peak 0.98)'),
  exportNormalizeTip: L('Phóng hoặc thu để đỉnh vừa dưới mức đầy thang. Bỏ chọn để giữ tỉ lệ 1 V = đầy thang.', 'Scale so the peak sits just below full scale. Clear it to keep 1 V = full scale.'),
  exportRemoveDc: L('Bỏ thành phần một chiều', 'Remove the DC component'),
  exportEncoding: L('Độ sâu bit', 'Bit depth'),
  exportSave: L('Lưu WAV…', 'Save WAV…'),
  exportCancel: L('Đóng', 'Close'),
  exportDone: L('Đã lưu {name}: {seconds} s, {rate} Hz, {bits}-bit.', 'Saved {name}: {seconds} s, {rate} Hz, {bits}-bit.'),
  exportNone: L('Chưa có đường nào để xuất. Hãy chạy một phân tích theo thời gian trước.', 'There is no trace to export. Run a time-domain analysis first.'),
  exportTooLong: L('Âm thanh dài quá {max} giây (tốn rất nhiều bộ nhớ). Hãy giảm hệ số kéo giãn hoặc tần số lấy mẫu.', 'The sound would be longer than {max} seconds (it would need far too much memory). Lower the time stretch or the sample rate.'),
  exportTooShort: L('Đường này quá ngắn để thành âm thanh.', 'This trace is too short to become sound.'),
  exportClipped: L('Một phần tín hiệu vượt ±1 và bị xén; bật chuẩn hoá để tránh.', 'Part of the signal exceeds ±1 and is clipped; switch normalisation on to avoid it.'),
  exportMenu: L('Xuất WAV…', 'Export WAV…'),
  exportMenuTip: L('Lưu một đường của trang này thành tệp âm thanh .wav', 'Save a trace of this page as a .wav sound file'),

  // ---- trip curve (Properties)
  tripTitle: L('Đường cong thời gian – dòng điện', 'Time–current curve'),
  tripAxisX: L('Dòng điện (bội số của {unit})', 'Current (multiple of {unit})'),
  tripAxisY: L('Thời gian cắt (s)', 'Trip time (s)'),
  tripNever: L('Dưới {m}× không tác động', 'No trip below {m}×'),
  tripAt: L('Ở {m}× tác động sau {t}', 'At {m}× it trips after {t}'),
  tripIntro: L('Vẽ từ đúng công thức của mô hình; đường dọc là ngưỡng cắt từ.', 'Drawn from the model’s own formulas; the vertical line is the magnetic trip.'),
} as const;

export type AudioTextKey = keyof typeof AUDIO_TEXT;

/** One text of the audio tools in the current language. */
export function aut(key: AudioTextKey, params?: Record<string, string | number>): string {
  const entry: LocalizedText = AUDIO_TEXT[key];
  return params ? interpolate(tr(entry), params) : tr(entry);
}
