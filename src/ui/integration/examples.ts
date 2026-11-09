/**
 * Catalogue of the files in examples/ for File > Open samples (the sample browser).
 *
 *   examples/*.msim        schematic designs (built by exampleDesigns.ts / sampleDesigns.ts)
 *   examples/spice/*.cir   classic SPICE decks, opened through the SPICE importer
 *
 * Every sample has a topic (SAMPLE_TOPICS, the browser's sections) and Vietnamese / English titles
 * and summaries in the lazily loaded table src/i18n/samples.ts (keyed by sampleKey(file)); the
 * `title` here is the canonical English title stored in the file, `summary` a Vietnamese fallback.
 * The files are bundled as lazily loaded raw text (one chunk per file), so they cost nothing at
 * start-up and work offline in the desktop build.
 */

export type ExampleKind = 'design' | 'spice';

/** Sections of the sample browser, in display order. */
export const SAMPLE_TOPICS = ['basics', 'semiconductors', 'opamps', 'digital', 'mixed', 'power', 'rf', 'instruments', 'analyses', 'hierarchy', 'automation'] as const;
export type SampleTopic = (typeof SAMPLE_TOPICS)[number];

export interface ExampleEntry {
  /** file name relative to examples/ (SPICE decks: "spice/<name>.cir") */
  file: string;
  kind: ExampleKind;
  topic: SampleTopic;
  title: string;
  summary: string;
  /** read the file's text */
  load(): Promise<string>;
}

export interface ExampleMeta {
  file: string;
  topic: SampleTopic;
  title: string;
  summary: string;
}

/** Key of a sample in the text tables: the file stem with non-alphanumerics as "_" ("01_voltage_divider"). */
export function sampleKey(file: string): string {
  return file.replace(/^spice\//, '').replace(/\.(msim|cir)$/, '').replace(/[^A-Za-z0-9]+/g, '_');
}

/** Metadata of the schematic samples in examples/ (builders: exampleDesigns.ts, sampleDesigns.ts). */
export const DESIGN_EXAMPLES: readonly ExampleMeta[] = [
  { file: '01-voltage-divider.msim', topic: 'basics', title: 'Voltage divider + multimeter', summary: 'Cầu phân áp đo bằng đồng hồ vạn năng · DC operating point' },
  { file: '02-rc-lowpass.msim', topic: 'basics', title: 'RC low-pass filter', summary: 'Lọc RC với máy phát hàm, dao động ký và máy vẽ Bode · fc ≈ 1.59 kHz' },
  { file: '03-rectifiers.msim', topic: 'power', title: 'Half-wave and bridge rectifiers', summary: 'Chỉnh lưu nửa chu kỳ và cầu có tụ lọc · gợn sóng 50/100 Hz' },
  { file: '04-common-emitter.msim', topic: 'semiconductors', title: 'BJT common-emitter amplifier', summary: 'Khuếch đại E chung 2N3904 · Av ≈ −27' },
  { file: '05-inverting-amplifier.msim', topic: 'opamps', title: 'Op-amp inverting amplifier', summary: 'Khuếch đại đảo LM741 · Av = −R2/R1 = −10' },
  { file: '06-555-led-flasher.msim', topic: 'mixed', title: '555 astable LED flasher', summary: 'IC 555 dao động ≈ 1 Hz làm LED nhấp nháy' },
  { file: '07-cmos-inverter.msim', topic: 'semiconductors', title: 'CMOS inverter', summary: 'Cổng đảo CMOS · đặc tuyến truyền đạt bằng quét DC' },
  { file: '08-decade-counter.msim', topic: 'digital', title: 'Decade counter with 7-segment display', summary: 'Đếm 7490 + giải mã 7447 + LED 7 đoạn' },
  { file: '09-lcd-hello.msim', topic: 'digital', title: 'Character LCD: hello text', summary: 'Nguồn mẫu gửi lệnh và chữ tới LCD 16x2 (bus 4 bit, kiểu HD44780)' },
  { file: '10-bench-instruments.msim', topic: 'instruments', title: 'Bench instruments', summary: 'Máy phát sóng, đồng hồ 6½ chữ số, dao động ký số và dao động ký hỗn hợp trên mạch lọc RC' },
  { file: '11-ohms-law.msim', topic: 'basics', title: "Ohm's law", summary: 'Định luật Ohm với ampe kế và vôn kế · I = U/R' },
  { file: '12-series-parallel.msim', topic: 'basics', title: 'Series and parallel resistors', summary: 'Điện trở nối tiếp và song song · R tương đương' },
  { file: '13-rc-charging.msim', topic: 'basics', title: 'RC charging and discharging', summary: 'Tụ nạp và xả qua điện trở · τ = R·C' },
  { file: '14-rlc-resonance.msim', topic: 'basics', title: 'Series RLC resonance', summary: 'Cộng hưởng RLC nối tiếp · f0 ≈ 1,59 kHz' },
  { file: '15-wheatstone-bridge.msim', topic: 'basics', title: 'Wheatstone bridge', summary: 'Cầu Wheatstone và điều kiện cân bằng' },
  { file: '16-diode-iv.msim', topic: 'semiconductors', title: 'Diode I-V characteristic', summary: 'Đặc tuyến V–A của diode bằng quét DC' },
  { file: '17-zener-regulator.msim', topic: 'semiconductors', title: 'Zener voltage regulator', summary: 'Ổn áp dùng diode Zener 5,1 V' },
  { file: '18-led-resistor.msim', topic: 'semiconductors', title: 'LED with series resistor', summary: 'Tính điện trở hạn dòng cho LED' },
  { file: '19-bjt-switch.msim', topic: 'semiconductors', title: 'BJT switch driving an LED', summary: 'Transistor làm khoá bật / tắt LED' },
  { file: '20-non-inverting-amplifier.msim', topic: 'opamps', title: 'Op-amp non-inverting amplifier', summary: 'Khuếch đại không đảo · Av = 1 + Rf/Rg' },
  { file: '21-summing-amplifier.msim', topic: 'opamps', title: 'Op-amp summing amplifier', summary: 'Mạch cộng đảo hai điện áp' },
  { file: '22-integrator.msim', topic: 'opamps', title: 'Op-amp integrator', summary: 'Mạch tích phân: vuông → tam giác' },
  { file: '23-schmitt-trigger.msim', topic: 'opamps', title: 'Comparator with hysteresis (Schmitt trigger)', summary: 'Bộ so sánh có trễ (Schmitt trigger)' },
  { file: '24-logic-gates.msim', topic: 'digital', title: 'Basic logic gates', summary: 'Cổng AND, OR, XOR với công tắc và đèn' },
  { file: '25-flipflop-divider.msim', topic: 'digital', title: 'Flip-flop frequency divider', summary: 'Flip-flop T chia tần số · máy phân tích logic' },
  { file: '26-binary-counter.msim', topic: 'digital', title: '4-bit binary counter with hex display', summary: 'Bộ đếm nhị phân 7493 và màn hình hex' },
  { file: '27-555-monostable.msim', topic: 'mixed', title: '555 monostable (one-shot)', summary: '555 đơn ổn tạo xung 0,11 s' },
  { file: '28-r2r-dac.msim', topic: 'mixed', title: 'R-2R digital-to-analog converter', summary: 'Bộ đổi số – tương tự R-2R 4 bit' },
  { file: '29-pwm-comparator.msim', topic: 'mixed', title: 'PWM from a triangle and a comparator', summary: 'Tạo PWM bằng sóng tam giác và bộ so sánh' },
  { file: '30-full-wave-ct.msim', topic: 'power', title: 'Full-wave rectifier with center-tapped transformer', summary: 'Chỉnh lưu toàn sóng dùng biến áp có điểm giữa' },
  { file: '31-regulator-7805.msim', topic: 'power', title: '7805 linear voltage regulator', summary: 'IC ổn áp 7805 · điện áp rơi tối thiểu' },
  { file: '32-voltage-doubler.msim', topic: 'power', title: 'Voltage doubler', summary: 'Mạch nhân đôi điện áp bằng diode và tụ' },
  { file: '33-lc-tank.msim', topic: 'rf', title: 'Parallel LC tank', summary: 'Khung cộng hưởng LC song song · f0 ≈ 159 kHz' },
  { file: '34-am-detector.msim', topic: 'rf', title: 'AM envelope detector', summary: 'Tách sóng AM bằng diode' },
  { file: '35-transmission-line.msim', topic: 'rf', title: 'Transmission line reflections', summary: 'Phản xạ trên đường truyền 50 Ω' },
  { file: '36-wattmeter.msim', topic: 'instruments', title: 'Wattmeter on an RL load', summary: 'Oát kế đo công suất tải R-L' },
  { file: '37-spectrum-square.msim', topic: 'instruments', title: 'Spectrum of a square wave', summary: 'Máy phân tích phổ: hài của sóng vuông' },
  { file: '38-word-generator.msim', topic: 'instruments', title: 'Word generator and logic analyzer', summary: 'Máy phát từ và máy phân tích logic' },
  { file: '39-parameter-sweep.msim', topic: 'analyses', title: 'Parameter sweep of an RC filter', summary: 'Quét tham số R1 của bộ lọc RC' },
  { file: '40-temperature-sweep.msim', topic: 'analyses', title: 'Temperature sweep of a diode', summary: 'Quét nhiệt độ đặc tuyến diode' },
  { file: '41-monte-carlo.msim', topic: 'analyses', title: 'Monte Carlo of a voltage divider', summary: 'Monte Carlo cầu phân áp có dung sai 5 %' },
  { file: '42-fourier-clipper.msim', topic: 'analyses', title: 'Fourier analysis of a clipped sine', summary: 'Phân tích Fourier sóng sin bị xén' },
  { file: '43-subcircuit-cascade.msim', topic: 'hierarchy', title: 'RC subcircuit used twice', summary: 'Mạch con RC dùng hai lần' },
  { file: '44-multi-sheet.msim', topic: 'hierarchy', title: 'Two sheets joined by off-page connectors', summary: 'Hai trang nối bằng đầu nối sang trang' },
  { file: '45-hierarchical-block.msim', topic: 'hierarchy', title: 'Hierarchical amplifier block with a parameter', summary: 'Khối phân cấp có tham số' },
  { file: '46-block-control-loop.msim', topic: 'analyses', title: 'Block-diagram control loop with .meas', summary: 'Vòng điều khiển vẽ bằng khối, đo bằng .meas' },
  { file: '47-reference-ground.msim', topic: 'power', title: 'Isolated secondary on a reference ground', summary: 'Thứ cấp biến áp cách ly trên đất tham chiếu' },
  { file: '48-real-capacitor.msim', topic: 'basics', title: 'Real capacitor: self-resonance', summary: 'Tụ điện thực: ESR, ESL và cộng hưởng riêng' },
  { file: '49-pll-lock.msim', topic: 'mixed', title: 'Phase-locked loop locking to 10.3 kHz', summary: 'Vòng khoá pha bám tín hiệu 10,3 kHz' },
  { file: '50-dip-switch-leds.msim', topic: 'basics', title: 'DIP switch, resistor network and LEDs', summary: 'Công tắc DIP, mảng điện trở và LED' },
  { file: '51-mcu-blink.msim', topic: 'mixed', title: 'Blink an LED with an 8051', summary: 'Vi điều khiển 8051 nháy LED' },
  { file: '52-mcu-seven-segment.msim', topic: 'mixed', title: 'Seven-segment counter with an 8051', summary: '8051 đếm ra LED 7 đoạn' },
  { file: '53-mcu-button.msim', topic: 'mixed', title: 'Read a push-button with an 8051', summary: '8051 đọc nút nhấn' },
  { file: '54-mcu-serial.msim', topic: 'mixed', title: '8051 sends Hello on the serial port', summary: '8051 gửi Hello ra cổng nối tiếp' },
  { file: '55-ladder-start-stop.msim', topic: 'automation', title: 'Motor start / stop with a ladder diagram', summary: 'Khởi động / dừng động cơ bằng sơ đồ bậc thang' },
  { file: '56-ladder-traffic.msim', topic: 'automation', title: 'Traffic-light junction with ladder timers', summary: 'Đèn giao thông bằng bộ định thời bậc thang' },
  { file: '57-ladder-tank.msim', topic: 'automation', title: 'Tank filling control with a ladder diagram', summary: 'Điều khiển mức nước bằng sơ đồ bậc thang' },
  { file: '78-ladder-function-block.msim', topic: 'automation', title: 'Tank control with a function block and word math', summary: 'Khối hàm bơm, lệnh số MUL / ADD và ngõ ra tương tự cho bồn nước' },
  { file: '70-contactor-start-stop.msim', topic: 'automation', title: 'Start-stop contactor with holding contact and overload', summary: 'Mạch mở – dừng bằng công-tắc-tơ: cuộn và tiếp điểm ở hai trang, tự giữ, rơ-le nhiệt' },
  { file: '71-timer-relays.msim', topic: 'automation', title: 'On-delay and off-delay timer relays', summary: 'Rơ-le thời gian trễ đóng và trễ mở cùng một xung 24 V' },
  { file: '72-speaker-filter.msim', topic: 'mixed', title: 'Listen to a filter: two tones through an RC low-pass', summary: 'Hai âm qua lọc RC và mạch đệm tới loa · nghe tác dụng của bộ lọc' },
  { file: '73-dual-opamp-variants.msim', topic: 'opamps', title: 'Dual op-amp in sections with two gain variants', summary: 'LM358 vẽ thành hai phần U1A / U1B, hai phương án lắp ráp khác giá trị R2 · độ lợi 2 và 11' },
];

/** Metadata of the SPICE decks in examples/spice (title = the deck's first line). */
export const SPICE_EXAMPLES: readonly ExampleMeta[] = [
  { file: 'spice/diode-clipper.cir', topic: 'semiconductors', title: 'Diode clipper', summary: 'Hai diode song song ngược chiều xén tín hiệu sin ở ≈ ±0.7 V · .tran' },
  { file: 'spice/bjt-diff-pair.cir', topic: 'semiconductors', title: 'BJT differential pair', summary: 'Cặp vi sai 2N3904 với nguồn dòng đuôi 1 mA · đặc tuyến tanh · .dc' },
  { file: 'spice/cmos-inverter-vtc.cir', topic: 'digital', title: 'CMOS inverter VTC', summary: 'Đặc tuyến truyền đạt cổng đảo CMOS level 1 · .dc' },
  { file: 'spice/rlc-bandpass.cir', topic: 'rf', title: 'RLC band-pass filter', summary: 'Lọc thông dải RLC nối tiếp, f0 ≈ 5.03 kHz, Q ≈ 3.16 · .ac' },
  { file: 'spice/meas-step-filter.cir', topic: 'analyses', title: 'RC filter family with .meas', summary: 'Họ mạch lọc RC với .step param, đo −3 dB và thời gian lên bằng .meas · .ac .tran' },
];

const designLoaders = import.meta.glob('../../../examples/*.msim', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const spiceLoaders = import.meta.glob('../../../examples/spice/*.cir', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

/** Loader for a file relative to examples/, or undefined when it is not bundled. */
function loaderFor(file: string): (() => Promise<string>) | undefined {
  const key = `../../../examples/${file}`;
  return designLoaders[key] ?? spiceLoaders[key];
}

/** Every bundled example, designs first (in catalogue order), then SPICE decks. */
export function exampleCatalog(): ExampleEntry[] {
  const out: ExampleEntry[] = [];
  for (const ex of DESIGN_EXAMPLES) {
    const load = loaderFor(ex.file);
    if (load) out.push({ file: ex.file, kind: 'design', topic: ex.topic, title: ex.title, summary: ex.summary, load });
  }
  for (const ex of SPICE_EXAMPLES) {
    const load = loaderFor(ex.file);
    if (load) out.push({ file: ex.file, kind: 'spice', topic: ex.topic, title: ex.title, summary: ex.summary, load });
  }
  return out;
}

/** Bundled files that have no catalogue entry (should be empty; checked by the tests). */
export function uncataloguedExampleFiles(): string[] {
  const known = new Set([...DESIGN_EXAMPLES.map((e) => e.file), ...SPICE_EXAMPLES.map((e) => e.file)]);
  return [...Object.keys(designLoaders), ...Object.keys(spiceLoaders)]
    .map((k) => k.replace('../../../examples/', ''))
    .filter((f) => !known.has(f));
}
