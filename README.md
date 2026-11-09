# MachSim

**Tiếng Việt** · [English](#english)

MachSim là phần mềm **thiết kế và mô phỏng mạch điện tử** chạy offline, viết mới hoàn toàn, có phạm vi
chức năng tương đương NI Multisim 14.3: vẽ sơ đồ nguyên lý, thư viện linh kiện, bộ mô phỏng kiểu SPICE
(DC, AC, quá độ và các phân tích nâng cao), thiết bị đo ảo, mô phỏng tương tác và breadboard 3D — dùng để
tự học điện tử. Ứng dụng chạy trên Windows (Electron) và cũng chạy được trong trình duyệt.

## Chạy, kiểm thử, đóng gói

Yêu cầu: Node.js 24. Mọi lệnh chạy trong thư mục `machsim/` (đường dẫn có dấu cách và ngoặc — luôn đặt trong dấu nháy).

| Việc | Lệnh |
|---|---|
| Cài thư viện | `npm install` |
| Chạy bản phát triển (trình duyệt) | `npm run dev` rồi mở địa chỉ Vite in ra |
| Kiểm tra kiểu TypeScript | `npx tsc --noEmit` |
| Chạy toàn bộ test | `npx vitest run` (hoặc `npm test`) |
| Chạy một nhóm test | `npx vitest run tests` · `npx vitest run src/sim` |
| Build bản web | `npm run build` (ra `dist/`) |
| Ứng dụng desktop (chạy thử) | `npm run build`, rồi trong `desktop/`: `npm install`, `npm run sync`, `npm start` |
| Kiểm tra nhanh desktop | trong `desktop/`: `npm run sync && node scripts/run-local.cjs --smoke` (in `MACHSIM_SMOKE …`) |
| Bộ cài Windows (NSIS + portable) | trong `desktop/`: `npm run dist` |

Ghi chú: Electron không khởi động được trực tiếp từ ổ D: của máy phát triển này, nên
`desktop/scripts/run-local.cjs` chép runtime sang `%LOCALAPPDATA%\MachSim-dev` rồi chạy từ đó. Bản cài đặt
và bản portable chạy bình thường.

Cập nhật các file ví dụ sau khi sửa mạch mẫu: `MACHSIM_UPDATE_EXAMPLES=1 npx vitest run tests/examples.test.ts`.

## Bắt đầu nhanh

1. **File > Examples…** mở một mạch mẫu (cầu phân áp, lọc RC, chỉnh lưu, khuếch đại BJT, op-amp, 555 nháy LED,
   cổng đảo CMOS, bộ đếm 7 đoạn) hoặc chạy một netlist SPICE mẫu.
2. Nhấn **Run** (F5). Nếu mạch có thiết bị đo, LED/đèn/màn 7 đoạn hoặc công tắc và phân tích đang chọn là
   *Transient*, MachSim chạy **mô phỏng tương tác** theo thời gian thực: nhấp đúp vào thiết bị đo (XMM, XSC,
   XBP …) để mở bảng điều khiển, bấm phím (mặc định Space, A …) để gạt công tắc / xoay chiết áp.
   Ngược lại, phân tích được chạy một lần và kết quả mở trong **Grapher**.
3. **Simulate > Analysis settings…** chọn và cấu hình 19 loại phân tích; dải dưới cùng có các tab
   *Simulation* (tốc độ mô phỏng, giá trị trực tiếp), *ERC*, *Netlist* (văn bản SPICE) và *BOM*.
4. Tab **Breadboard 3D** (cạnh *Schematic*) lắp mạch lên breadboard ảo, tự xếp linh kiện, kiểm tra so với sơ
   đồ và hướng dẫn lắp từng bước; LED sáng theo mô phỏng.

## Tính năng

- **Sơ đồ nguyên lý**: nhiều sheet, dây, nhãn net, que đo (điện áp, dòng, công suất, vi sai, logic), ghi chú,
  undo/redo, tìm linh kiện, đánh số tham chiếu, xuất SVG/PNG, in, tự lưu và khôi phục.
- **Thư viện ~280 linh kiện gốc**: nguồn, R/L/C, biến áp, công tắc, rơ-le, diode/LED/Zener, BJT, JFET, MOSFET,
  op-amp, 555, ổn áp, họ TTL 74xx và CMOS 40xx, ADC/DAC, màn 7 đoạn, đèn, còi, động cơ …; mỗi model SPICE
  ghi rõ nguồn gốc tham số (`provenance`). Nhập model SPICE riêng qua *Design properties*.
- **Bộ mô phỏng** (Web Worker): MNA với LU thưa, Newton có gmin/source stepping; OP, DC sweep, AC,
  transient (trapezoidal/Gear, điều khiển bước theo sai số cắt cụt); noise, noise figure, transfer function,
  sensitivity, pole-zero, Fourier, distortion, parameter/temperature/nested sweep, Monte Carlo, worst case,
  trace width, batch. Thiết bị: R C L K V I E F G H B S W T, diode, Gummel-Poon BJT, JFET, MESFET, MOSFET
  level 1/3, mô hình số kiểu XSPICE (cổng, flip-flop, bộ đếm, giải mã …).
- **SPICE**: đọc/ghi netlist SPICE/PSpice (subcircuit, `.param`, `.model`, `.include`, POLY/TABLE/VALUE),
  *File > Import SPICE netlist…* chạy thẳng một netlist, *Export SPICE netlist…* xuất `.cir`.
- **15 thiết bị đo ảo**: đồng hồ vạn năng, máy phát hàm, dao động ký 2/4 kênh, máy vẽ Bode, wattmeter, đếm tần,
  phân tích IV, phân tích phổ, phân tích mạng (Smith chart), phân tích méo, phân tích logic, máy phát từ,
  bộ chuyển đổi logic, kìm đo dòng.
- **Mô phỏng tương tác**: luồng transient liên tục với tốc độ chỉnh được (0,001× … 1000× thời gian thực hoặc
  nhanh nhất có thể), tạm dừng/tiếp tục, thay giá trị khi đang chạy (công tắc, chiết áp, núm máy phát), LED và
  màn 7 đoạn sáng trên sơ đồ.
- **Grapher & postprocessor**: con trỏ đo, zoom, thang log, dB/pha, biểu thức trên vector, xuất CSV/PNG.
- **ERC, BOM, netlist report**; **breadboard 3D** (three.js) với kiểm tra lắp ráp song ngữ Việt/Anh.

## Cấu trúc thư mục

| Thư mục | Nội dung |
|---|---|
| `src/sim/` | Hợp đồng netlist/kết quả, engine (`engine/`, `linalg/`), thiết bị (`devices/`), phân tích nâng cao (`analyses/`), SPICE I/O (`spice/`) |
| `src/model/` | Mô hình sơ đồ, netlister, ERC, BOM, lưu/đọc file `.msim` |
| `src/library/` | Thư viện linh kiện, ký hiệu, model |
| `src/ui/app/` | Vỏ ứng dụng: menu, toolbar, dock, cửa sổ nổi, tệp tin, API mở rộng (`extensions.ts`) |
| `src/ui/editor/`, `src/ui/store/` | Trình vẽ sơ đồ và kho trạng thái (undo/redo) |
| `src/ui/sim/` | Web Worker mô phỏng: giao thức, host, client |
| `src/ui/integration/` | Nối mọi thứ: bộ điều khiển Run/Pause/Stop, cửa sổ thiết bị đo, Grapher, các tab, lệnh, ví dụ |
| `src/ui/instruments/`, `src/ui/results/`, `src/ui/analysis/` | Bảng thiết bị đo, Grapher/postprocessor, hộp thoại phân tích |
| `src/breadboard/` | Breadboard 3D |
| `src/desktop/`, `desktop/` | Cầu nối và vỏ Electron |
| `examples/` | Mạch mẫu `.msim` và netlist SPICE mẫu (`examples/spice/*.cir`) |
| `tests/` | Kiểm thử đầu-cuối (ví dụ → netlist → mô phỏng → so với tính tay) |
| `docs/ARCHITECTURE.md` | Bản đồ module và luồng dữ liệu |

## Tuyên bố clean-room

MachSim là sản phẩm **độc lập, viết mới hoàn toàn**. Không sao chép mã nguồn, tài nguyên, cơ sở dữ liệu linh
kiện, hình vẽ ký hiệu, văn bản trợ giúp hay thương hiệu của NI Multisim hoặc bất kỳ phần mềm thương mại nào,
và không dịch ngược phần mềm nào. Hành vi được xây dựng từ lý thuyết đã công bố (phương trình thiết bị
SPICE3, MNA, phương pháp số, công thức IPC) và tài liệu công khai. Tham số model của linh kiện thật lấy từ
model SPICE do nhà sản xuất công bố hoặc được MachSim khớp từ số liệu datasheet; mỗi linh kiện ghi nguồn gốc
trong trường `provenance`. "Multisim" và "NI" là thương hiệu của chủ sở hữu tương ứng; MachSim không liên
quan tới họ.

---

<a id="english"></a>

# MachSim (English)

MachSim is an **original, offline circuit design and SPICE-class simulation application** whose feature
scope matches NI Multisim 14.3: schematic capture, a component library, a SPICE-style simulator (DC, AC,
transient and advanced analyses), virtual instruments, interactive simulation and a 3D breadboard — built
for learning electronics. It runs as a Windows desktop app (Electron) and in the browser.

## Run, test, build

Requires Node.js 24. Run every command in `machsim/` (the path contains spaces and parentheses — quote it).

| Task | Command |
|---|---|
| Install | `npm install` |
| Development server (browser) | `npm run dev`, then open the URL Vite prints |
| Type check | `npx tsc --noEmit` |
| All tests | `npx vitest run` (or `npm test`) |
| Some tests | `npx vitest run tests` · `npx vitest run src/sim` |
| Web build | `npm run build` (output in `dist/`) |
| Desktop app (development) | `npm run build`, then in `desktop/`: `npm install`, `npm run sync`, `npm start` |
| Desktop smoke check | in `desktop/`: `npm run sync && node scripts/run-local.cjs --smoke` (prints `MACHSIM_SMOKE …`) |
| Windows installer (NSIS + portable) | in `desktop/`: `npm run dist` |

On the development machine Electron cannot start from drive D: directly, so `desktop/scripts/run-local.cjs`
copies the runtime to `%LOCALAPPDATA%\MachSim-dev` and starts it from there; installed and portable builds
are not affected.

After editing an example builder, rewrite the example files with
`MACHSIM_UPDATE_EXAMPLES=1 npx vitest run tests/examples.test.ts`.

## Quick start

1. **File > Examples…** opens an example design (voltage divider, RC filter, rectifiers, BJT amplifier,
   op-amp, 555 LED flasher, CMOS inverter, 7-segment counter) or runs an example SPICE deck.
2. Press **Run** (F5). When the design has instruments, indicators (LEDs, lamps, displays) or interactive
   parts and the active analysis is *Transient*, MachSim runs an **interactive real-time simulation**:
   double-click an instrument (XMM, XSC, XBP …) to open its panel, press a part's key (Space, A …) to flip
   switches or turn potentiometers. Otherwise the analysis runs once and its results open in the **Grapher**.
3. **Simulate > Analysis settings…** sets up all 19 analysis types. The bottom dock has *Simulation*
   (speed, live readings), *ERC*, *Netlist* (SPICE text) and *BOM* tabs.
4. The **Breadboard 3D** tab (next to *Schematic*) builds the circuit on a virtual breadboard with
   auto-placement, a check against the schematic and step-by-step assembly guidance; LEDs light from the
   simulation.

## Features

- **Schematic capture**: multiple sheets, wires, net labels, probes (voltage, current, power, differential,
  logic), notes, undo/redo, find, annotation, SVG/PNG export, printing, autosave and recovery.
- **~280 original parts**: sources, R/L/C, transformers, switches, relays, diodes/LEDs/Zeners, BJTs, JFETs,
  MOSFETs, op-amps, 555, regulators, 74xx TTL and 40xx CMOS, ADC/DAC, displays, lamps, buzzers, motors …;
  every SPICE model states where its parameters come from (`provenance`). Custom SPICE models can be added
  in the design properties.
- **Simulator** (in a Web Worker): sparse-LU MNA, Newton with gmin and source stepping; OP, DC sweep, AC,
  transient (trapezoidal / Gear, truncation-error step control); noise, noise figure, transfer function,
  sensitivity, pole-zero, Fourier, distortion, parameter / temperature / nested sweeps, Monte Carlo, worst
  case, trace width, batch. Devices: R C L K V I E F G H B S W T, diode, Gummel-Poon BJT, JFET, MESFET,
  MOSFET levels 1 and 3, XSPICE-style digital models (gates, flip-flops, counters, decoders …).
- **SPICE**: SPICE/PSpice reader and writer (subcircuits, `.param`, `.model`, `.include`, POLY/TABLE/VALUE);
  *File > Import SPICE netlist…* simulates a deck directly, *Export SPICE netlist…* writes `.cir`.
- **15 virtual instruments**: multimeter, function generator, 2/4-channel oscilloscope, Bode plotter,
  wattmeter, frequency counter, IV analyzer, spectrum analyzer, network analyzer (Smith chart),
  distortion analyzer, logic analyzer, word generator, logic converter, current clamp.
- **Interactive simulation**: continuous streaming transient at an adjustable speed (0.001× … 1000× real
  time, or as fast as possible), pause / resume, live value changes (switches, potentiometers, generator
  knobs), LEDs and 7-segment displays lit on the schematic.
- **Grapher and postprocessor**: cursors, zoom, log axes, dB/phase, vector expressions, CSV/PNG export.
- **ERC, BOM, netlist report**; **3D breadboard** (three.js) with Vietnamese/English assembly checks.

## Project layout

| Folder | Contents |
|---|---|
| `src/sim/` | Netlist/result contracts, engine (`engine/`, `linalg/`), devices (`devices/`), advanced analyses (`analyses/`), SPICE I/O (`spice/`) |
| `src/model/` | Schematic model, netlister, ERC, BOM, `.msim` serialisation |
| `src/library/` | Component library, symbols, models |
| `src/ui/app/` | Application shell: menus, toolbar, dock, floating windows, files, extension API (`extensions.ts`) |
| `src/ui/editor/`, `src/ui/store/` | Schematic editor and state store (undo/redo) |
| `src/ui/sim/` | Simulation Web Worker: protocol, host, client |
| `src/ui/integration/` | Wiring of everything: Run/Pause/Stop controller, instrument windows, Grapher, dock tabs, commands, examples |
| `src/ui/instruments/`, `src/ui/results/`, `src/ui/analysis/` | Instrument panels, Grapher/postprocessor, analysis setup dialog |
| `src/breadboard/` | 3D breadboard |
| `src/desktop/`, `desktop/` | Electron bridge and shell |
| `examples/` | Example designs (`.msim`) and SPICE decks (`examples/spice/*.cir`) |
| `tests/` | End-to-end tests (example → netlist → simulation → hand calculation) |
| `docs/ARCHITECTURE.md` | Module map and data flow |

## Clean-room statement

MachSim is an **independent, original work**. It contains no code, assets, component database, symbol
artwork, help text or branding from NI Multisim or any other commercial product, and no product was
decompiled. Behaviour is implemented from published theory (SPICE3 device equations, modified nodal
analysis, numerical methods, IPC formulas) and public documentation. Model parameters of real parts come
from manufacturer-published SPICE models or are MachSim fits to datasheet figures; each part records its
source in its `provenance` field. "Multisim" and "NI" are trademarks of their respective owners; MachSim
is not affiliated with them.
