# MachSim — kiến trúc

MachSim là bộ thiết kế và mô phỏng mạch **nguyên bản**, chạy offline, có phạm vi chức năng tương đương
NI Multisim 14.3 (khảo sát trong `../analysis/`). Đây là sản phẩm độc lập:

- **Không** sao chép mã, tài nguyên, database linh kiện, hình vẽ symbol, template hay thương hiệu của NI.
- Hành vi được đặc tả từ tài liệu công khai và lý thuyết SPICE/MNA chuẩn.
- Tham số model SPICE của linh kiện thật lấy từ model do nhà sản xuất công bố hoặc giá trị generic;
  mỗi part ghi `provenance`.

## Nền tảng

TypeScript (strict) + React 19 + Vite 8, test bằng Vitest. Bộ giải chạy trong Web Worker.
Có thể đóng gói thành ứng dụng Windows (Electron/Tauri) ở giai đoạn sau.

## Bản đồ module (Multisim 14.3 → MachSim)

| Nhóm chức năng (module NI quan sát được) | Module MachSim | Thư mục |
|---|---|---|
| Lõi SPICE/XSPICE (`spiceifs`, `SpiceServer`, `SimulationServer`, `cnc-si`) | Engine MNA: Newton, DC/AC/Transient, LU thưa | `src/sim/engine`, `src/sim/linalg` |
| Thiết bị tuyến tính & nguồn | R C L K V I E F G H S W T | `src/sim/devices/linear` |
| Bán dẫn (`*Ext` model makers) | Diode, BJT Gummel-Poon, JFET, MOSFET | `src/sim/devices/semi` |
| Nguồn hành vi | B-source, biểu thức, LAPLACE / FREQ / CHEBYSHEV | `src/sim/devices/behavioral.ts`, `src/sim/spice/expr.ts`, `src/sim/devices/linear/laplace.ts`, `freqTable.ts` |
| Khối chức năng điều khiển, nguồn đặc biệt | Code model `A_HYST` / `A_ONESHOT` / `A_SAH` / `A_PWM`, catalogue | `src/sim/devices/digital/analogBlocks.ts`, `src/library/catalog/signalBlocks.ts` |
| Netlist SPICE/PSpice (`spiceparser`, `spice2m`) | Parser/writer/flatten (tham số instance thiết bị không dùng → cảnh báo; LTspice `Rser= Lser= Rpar= Cpar=` → phần tử thật; `.meas`, `.step param`) | `src/sim/spice` |
| Analyses (`asys`, `AsysDll`) | OP, DC, AC, Tran + noise, TF, sens, PZ, Fourier, distortion, sweeps, Monte Carlo, worst case, trace width, batch | `src/sim/engine`, `src/sim/analyses` |
| Digital/mixed (`XSPICE`, `logconv`, `PLD`) | Primitive số, cầu ADC/DAC, họ 74xx/40xx | `src/sim/devices/digital`, `src/library/parts` |
| MCU (module đã bị loại bỏ trong 14.3), PLD | Lõi 8051 + trình dịch hợp ngữ + Intel HEX, code model `D_MCU8051`, trình soạn mã; wizard PLD và xuất VHDL / Verilog | `src/mcu`, `src/sim/devices/digital/mcu.ts`, `src/ui/mcu`, `src/model/hdl.ts`, `src/model/wizards/pldDesign.ts` |
| Ladder diagram, mechatronics (đào tạo tự động hoá) | Trang bậc thang + máy quét, giá PLC gom thành một phần tử `A_LADDER`, năm mô hình máy `A_MECHA` vẽ chuyển động trên sơ đồ | `src/ladder`, `src/mecha`, `src/model/ladderBuild.ts`, `src/sim/devices/digital/ladder.ts`, `mecha.ts`, `src/library/catalog/plc.ts`, `mecha.ts`, `src/ui/ladder` |
| Thư viện linh kiện (`Database`, `Library*`, `compedit`) | Catalogue PartDef + symbol + model | `src/library` |
| Họ Basic / Analog bổ sung (RLC không lý tưởng, Z load, RPACK, socket, ký hiệu sơ đồ, 3D, DIP / keypad / công tắc xoay, biến áp nhiều cuộn / bão hoà, OTA, CFA, PLL, cách ly, lái cổng) | Catalogue vòng 3 + `InteractiveDef.controls` | `src/library/catalog/basicExtras.ts`, `analogExtras.ts`, `passiveSeries.ts` |
| Schematic capture (`SchematicCapture`, `SCH_CAP`, `Nets`, `DrwEngine`) | Editor SVG, kết nối, nhãn net, nhiều sheet | `src/ui/editor`, `src/model` |
| Netlister & ERC (`CIRCEXP`, `SETATTR`) | Design → Netlist IR, ERC, BOM | `src/model` |
| Công cụ sơ đồ chuyên nghiệp (ERC options, Net settings, Capture area, Customize UI, Footprint manager) | Ma trận loại chân + dấu NC + báo cáo ERC, cài đặt theo net (màu / PCB), chụp vùng sơ đồ, phím tắt & thanh công cụ tuỳ biến, danh mục chân vỏ, ký hiệu nhiều phần (`packageGroups` chọn phần dẫn đầu **có tham gia**, `packageKey` giữ cả vỏ cùng một refdes qua Đánh số / Dán / Tìm & thay, `placePart`+`joinPackage` cho cổng vừa đặt vào vỏ còn trống cổng ấy) | `src/model/ercMatrix.ts`, `ercReport.ts`, `netSettings.ts`, `sections.ts`, `src/library/footprints.ts`, `sectionKit.ts`, `src/ui/schematicTools`, `src/ui/app/customize.ts` |
| Nhiều thiết kế mở cùng lúc (Multisim: nhiều thiết kế trong một cửa sổ, Close all / Save all) | Thẻ tài liệu: bộ quản lý đổi `DocumentState` vào kho soạn thảo, phần mở rộng cho vị trí tệp / kết quả mô phỏng / Grapher, luồng đóng – lưu – thoát, lưu tự động mọi thiết kế | `src/ui/app/documents.ts`, `documentSet.ts`, `DocumentTabs.tsx`, `documentFlows.ts`, `document.ts`, `src/ui/integration/controller.ts` |
| In, xem trước, Page setup, PDF | Hộp Xem trước khi in dùng chung cho trình duyệt và desktop: phép tính trang (khổ giấy, lề, tỉ lệ, chia tờ, khoảng trang), nguồn nội dung (trang sơ đồ / bậc thang / vùng chọn, thiết bị đo, Grapher, báo cáo, bài học), `window.print` hoặc IPC `printPage` / `printToPdf` | `src/ui/print/*`, `desktop/main.cjs` |
| Order, Layer settings, Paste special, Reference Designator Prefix Setup | Thứ tự vẽ `z`, lớp hiển thị theo trang, ba kiểu dán đặc biệt, quy tắc tiền tố tên theo thiết kế | `src/model/annotationOrder.ts`, `layers.ts`, `refdesRules.ts`, `src/ui/app/editingDialogs.tsx`, `editorStore.ts` |
| Thuộc tính (`prp`) | Dialog thuộc tính theo ParamDef | `src/ui/editor` |
| Grapher & postprocessor (`grapher`, `POSTPROC`) | Đồ thị, cursor, biểu thức, CSV | `src/ui/results` |
| Thiết bị ảo (`SCOPE*`, `FGEN*`, `mulmeter*`, `bode`, `WATTMETR`, `FreqCounter`, `IV_Analyzer`, `spec_an`, `netan`, `distor`, `logican`, `wgen`, `logconv`) | Panel thiết bị | `src/ui/instruments` |
| Mô phỏng tương tác (`interact`, `ProbeExt`) | TransientStepper + công tắc/chiết áp/LED | `src/sim/index.ts`, `src/ui/sim` |
| Wizard (`CircMaker`) | Trình hướng dẫn 555 / lọc / op-amp / khuếch đại BJT, tính trở kháng mạch in | `src/model/wizards`, `src/ui/wizards` |
| Component wizard, model makers, database (`compedit`, `*Ext`) | Trình tạo linh kiện, trình tạo mô hình từ datasheet, cơ sở dữ liệu người dùng / công ty | `src/library/custom`, `src/library/modelmaker`, `src/ui/parts` |
| Place Component, Database Manager quy mô lớn, Update components, Variant manager | Hộp thoại Chọn linh kiện (chi tiết + Detail report + View model), chỉ mục / danh sách ảo hoá 60 000 part, so thư viện với sơ đồ, phương án lắp ráp, hồ sơ `.msimlib` | `src/ui/parts/PlaceComponentDialog.tsx`, `libraryTools.tsx`, `src/library/partInfo.ts`, `partFingerprint.ts`, `src/ui/store/libraryUpdate.ts`, `src/model/variants.ts`, `src/library/custom/profile.ts` |
| PCB/Ultiboard (`UB`, `PCB*`, `Gerber`, `RoutKern`) | Ngoài phạm vi v1; chỉ export netlist/BOM | — |
| Automation COM, LabVIEW, ELVIS | COM / LabVIEW ngoài phạm vi; thay bằng tập lệnh JavaScript trong hộp cát + `MachSim.exe --script` | `src/script/*`, `src/ui/script/ScriptPanel.tsx`, `desktop/main.cjs` |
| MOSFET compact: EKV 2.6, lớp BSIM4 (LEVEL 14 / 54), lõi từ trễ Jiles–Atherton + dòng xoáy | `ekv.ts`, `Bsim3` với cờ BSIM4, lưới điện lõi từ; đồ thị X–Y `vs(y, x)` | `src/sim/devices/semi/ekv.ts`, `bsim3.ts`, `src/library/catalog/compactMos.ts`, `magneticCore.ts`, `src/ui/results/postprocessor.ts` |
| Giao diện gọn cho người mới (MachSim thêm) | Bộ lọc menu / thanh công cụ / phép phân tích theo danh sách lệnh cho phép; mọi lệnh mà một bài học đi kèm bảo dùng đều phải có trong danh sách (test đọc chữ của bài học) | `src/ui/app/beginner.ts`, `tests/review/round3/beginner-lessons.test.ts` |
| Tệp bài học do giáo viên soạn (MachSim thêm) | `.msimlesson` với 4 loại bước mô tả; tiến độ `.msimprog` hoặc lưu trong dự án | `src/learn/lessonFile.ts`, `src/ui/learn/LessonEditor.tsx`, `src/ui/learn/customLessons.ts` |
| IC thật trong bài học (MachSim thêm) | Tìm cổng / flip-flop trong vỏ nhiều phân đoạn, kiểm chân `~PRE` / `~CLR` | `src/learn/gates.ts` |
| Âm thanh: loa, micrô, tệp WAV (MachSim thêm, thay cho thiết bị LabVIEW) | Loa / tai nghe phát điện áp ra card âm thanh theo thời gian thực (kéo giãn thời gian khi mô phỏng chậm), micrô là nguồn PCM streaming, nguồn tệp WAV, xuất WAV từ Grapher; codec WAV tự viết | `src/audio`, `src/library/catalog/audio.ts`, `src/ui/integration/AudioPanel.tsx` |
| Cơ điện nối bằng tên: cuộn + tiếp điểm, rơ-le nhiệt, khởi động từ, biến áp nguồn, bảo vệ | Cuộn là "driver" xuất nút trạng thái `<refdes>.st`, tiếp điểm theo tên cuộn (kể cả ở trang khác), ERC tiếp điểm mất cuộn; cầu chì I²t, áp-tô-mát B/C/D/K/Z có đồ thị | `src/library/catalog/relays.ts`, `protection.ts`, `lineMagnetics.ts`, `src/library/partkit.ts` (`followDriver`), `src/model/netlister.ts` |
| Pin không lý tưởng, nguồn từ thông, nguồn tệp đo lường (LVM / CSV) | Pin theo mức điện tích + điện trở trong + đường cong xả, e = N·dΦ/dt, PWL đọc từ tệp văn bản | `src/library/catalog/batteries.ts`, `lineMagnetics.ts`, `measurementSource.ts` |

## Ngôn ngữ, trợ giúp và nạp theo nhu cầu

- **i18n** (`src/i18n`): tiếng Việt mặc định + tiếng Anh. `t('khoá', {tham số})` đọc catalogue
  `src/i18n/messages/<mục>.ts` (mỗi khoá là cặp `[vi, en]`, `MessageKey` có kiểu nên gõ sai là lỗi biên dịch);
  `useLang()` / `LanguageRoot` trong `react.ts`; thư viện linh kiện dịch qua `library.ts` (`partName`,
  `familyName`, `paramLabel`…); breadboard dùng cặp `LocalizedText` trong `breadboard.ts`; hộp thoại gốc của
  Electron đọc `desktop-strings.json`. Ngôn ngữ lưu trong preferences (Tuỳ chọn > Ngôn ngữ, màn hình chào mừng).
  Số hiển thị luôn theo SPICE (dấu chấm thập phân, hậu tố k/m/µ) ở cả hai ngôn ngữ; số NHẬP vào (`parseUserNumber`)
  đọc cả dấu phẩy thập phân kiểu Việt ("4,7k") và mã RKM ("4k7", "4R7"); phần không đọc được sau số ("4.7.3k") bị ô
  Thuộc tính và ERC (`paramUnreadText`) từ chối thay vì cắt ngắn (`userNumberLeftover`). Test `uiStrings.test.ts` quét mã UI
  (`src/ui`, `src/breadboard`) và báo mọi chuỗi hiển thị chưa qua catalogue.
- **Giải thích lỗi**: `src/i18n/erc.ts` biến thông báo kỹ thuật của ERC / engine thành "sai gì — vì sao — sửa thế
  nào" (`explainErc`, `explainSimError`), kèm nút "Chỉ trên sơ đồ".
- **Trợ giúp** (`src/ui/help`): `openHelp(topic)` mở trình duyệt trợ giúp (nạp lười), `contextTopic()` cho F1
  (hàng đang chọn trong thư viện, linh kiện đang chọn, cửa sổ thiết bị đang mở), `openWelcome()` cho màn hình chào
  mừng lần đầu. Nội dung song ngữ ở `src/i18n/help.ts`; tooltip của nút thiết bị đo ở `messages/tips.ts`.
- **Nạp theo nhu cầu**: `lazyComponent()` (`src/ui/common/lazy.tsx`) tách các phần lớn khỏi bundle khởi động:
  panel thiết bị (`src/ui/instruments/lazyPanels.ts`), Grapher (`src/ui/integration/GrapherWindow.tsx`), hộp
  thoại phân tích (`analysisSettings.tsx`), trợ giúp, breadboard 3D, file ví dụ. React nằm ở chunk `react` riêng
  (vite.config.ts). Smoke test desktop nạp thử mọi chunk qua `app://`.

## Schematic capture (định dạng `.msim` v2)

- **Định dạng v2** (`src/model/serialize.ts`, `CURRENT_DESIGN_VERSION = 2`): mọi trường mới đều tuỳ chọn và chỉ ghi khi
  có, nên file không dùng tính năng mới vẫn gọn như v1 (kể cả `meta` — ai lưu, khi nào — và `grapher` — trang Grapher lưu
  kèm). Migration 1→2 đánh dấu mọi nhãn v1 là `global: true` (giữ
  hành vi "cùng tên là nối ở mọi trang"). Id trang và id đối tượng duy nhất trong cả thiết kế, kể cả trang của thiết kế con.
- **Nhãn và đầu nối** (`NetLabel.kind`): `label` (cục bộ theo trang, hoặc `global`), `offpage` (nối các trang cùng cấp),
  `hier` (cổng của thiết kế con), `global` (mọi nơi), `bus-entry`. Trong một trang, mọi tên giống nhau là một net.
  Luật nằm ở `src/model/connectivity.ts` (netlister) và `src/ui/store/connectivity.ts` (hiển thị).
- **Bus** (`Wire.bus`, `busName`, `src/model/bus.ts`): tên `D[0..7]` / `A,B,C`; bus là lớp riêng (không nối với dây
  thường); đường bus là tên cục bộ của trang; đầu nối mang tên bus nối từng đường; chân bus của khối ghép theo vị trí.
- **Phân cấp** (`Design.children`, `src/model/hierarchy.ts`): mạch con / khối phân cấp lưu trong file cha, đặt như linh
  kiện có `partId = hier:<id>`; `blockPartDef(child)` sinh symbol từ các đầu nối `hier`. Netlister
  (`src/model/netlister.ts`) phân tích từng cấp (`analyzeLevel`), sinh `.subckt HB_/SC_<tên>` cho mỗi bộ giá trị tham số
  và phần tử `X<refdes>`; net toàn cục giữ tên ở mọi cấp và khai báo `.global`; ERC tô-pô chạy trên mạch đã mở rộng.
  Editor: `getSheet/updateSheet` tìm cả trang con, refdes đánh số riêng từng cấp, `levelPath` / `goToParent`,
  `hierarchyOps.ts` (tạo, thay vùng chọn bằng mạch con, khối từ file, lưu khối thành file), `DesignTree.tsx`, breadcrumb
  trong `SheetTabs.tsx`.
- **Chú thích và trang**: `Sheet.shapes` (line/polyline/rect/ellipse/arc/polygon/picture), `TextNote.style` / `comment`,
  `Sheet.props` (khổ giấy, viền, khung tên, lưới, màu — `src/model/paper.ts`), `Design.titleBlock`, `Design.printSetup`
  (`src/ui/app/printPlan.ts`). Thao tác: `src/ui/store/schematicOps.ts` (lock, group, align/distribute, replace
  component, bus, connector, shape, comment); tìm & thay `src/model/findReplace.ts`; mẫu `src/model/templates.ts`.
- **Dự án**: `src/model/project.ts` (`.msimproj`, đóng gói `.msimpack` = ZIP qua `src/util/zip.ts`),
  `src/ui/app/projectDialogs.tsx`; desktop đọc/ghi file theo đường dẫn tương đối trong thư mục dự án qua IPC
  `machsim:project-*` (`desktop/main.cjs`, `preload.cjs`, `src/desktop/bridge.ts`).

## Thư viện quy mô lớn, linh kiện có định mức và lỗi giả lập

- **Catalogue sinh tự động** (`src/library/catalog/*`, ≈ 4 360 part): mỗi file là một nhóm họ (passives, diodes,
  thyristors, bjts, fets, analogics, power, electromech, sensors, rf, connectors, sources). Dữ liệu là bảng gọn (một dòng
  một mã linh kiện: thông số datasheet), generator biến thành `LibraryPartDef` và fit model: Zener 3 phần tử,
  Gummel-Poon giải BF/ISE cho đúng hFE tại dòng thử, MOSFET level 1 từ RDS(on), op-amp macromodel, regulator hành vi,
  khoá PWM trung bình (Vorpérian), máy điện theo phương trình chuẩn, đèn điện tử theo Koren. Mỗi part ghi
  `provenance`, mô tả tiếng Anh + tiếng Việt (`textVi`), `specs` (lọc thông số, `src/library/specs.ts`), `sortKey`,
  `series`. `src/library/parts/index.ts`: `ALL_PARTS = BASE_PARTS + catalogParts(...)` (part viết tay thắng nếu
  trùng id). Chunk riêng `catalogue` (vite.config.ts), vẫn nạp lúc khởi động. Dãy E (`src/library/series.ts`) cho
  `ParamDef.picker`; `ParamDef.fileImport` cho dữ liệu nạp từ file.
- **Thư viện trong UI** (`src/ui/editor/ComponentBrowser.tsx`, `browserModel.ts`): danh sách ảo hoá (hàng 22 px),
  chỉ mục tìm theo part (WeakMap), bộ lọc thông số theo họ, Yêu thích / Gần đây (`libraryPrefs.ts`, lưu trình duyệt),
  xếp hạng tìm kiếm: cả câu khớp tên Anh / Việt (có / không dấu), tiền tố hoặc từ của họ (`FAMILY_SEARCH_VI`: "bóng bán
  dẫn", "điốt"…) đứng trước; token giá trị ("4,7k", "100uF", "5.1V") khớp linh kiện có đúng giá trị đó;
  xem trước kèm thông số (`specText.ts`). Hook dùng chung với hộp thoại Chọn linh kiện ở `catalogueHooks.ts`
  (`useLibraryParts`, `useGroupLoading`, `useCatalogueSearch`, `useIdsLoaded`, `useIdleIndexing`). Properties: chọn giá trị chuẩn, trường dữ liệu + Mở file…, thẻ Lỗi giả lập
  (`PartExtras.tsx`).
- **Linh kiện có định mức** (`src/model/ratings.ts`): `LibraryPartDef.ratings` + tham số bool `burn`. Khi bật, netlister
  chèn nguồn cảm biến, khoá cháy `S_<ref>_blow` điều khiển bởi `V_<ref>_blow`, và nút ứng suất (công suất / ngưỡng
  qua RC nhiệt `<ref>.rpw`, điện áp `<ref>.rv<k>`, dòng `<ref>.ri`); `NetlistBuildEx.ratings`. Controller: interactive
  thì `setParams(blow, dc 1)` ngay khi ứng suất ≥ 1; one-shot thì chạy lại với `applyBlows` (OP: dc 1, transient: PWL tại
  thời điểm cháy). Dấu cháy / nóng: `EditorState.ratingStates`, vẽ ở `PartGlyph`; lời giải thích ở `ui/integration/ratings.ts`.
- **Lỗi giả lập** (`src/model/faults.ts`): `PartInstance.faults` (open = 1 GΩ, short, leak), `Design.autoFault`;
  netlister đổi nút chân trước khi gọi `toSpice` (lỗi trước, định mức sau). Auto fault dùng bộ sinh ngẫu nhiên có hạt
  giống (cùng hạt giống → cùng bài tập), lỗi ẩn không hiện trên sơ đồ cho tới khi Hiện lỗi (`src/ui/app/faultDialogs.tsx`).
  Lỗi ẩn được đặt tên trung tính `R_HF_<n>` / nút `HF.<n>` (các danh sách kết quả coi là nội bộ), và tab Netlist / xuất
  SPICE bị giữ lại (`netlistWithheld`) cho tới khi Hiện lỗi, để không lộ đáp án.

## Thư viện số và hỗn hợp (74xx, 4000, bộ nhớ, PLD, bộ chuyển đổi, màn hình)

- **Code model mới** (`src/sim/devices/digital`): `msi2.ts` (bộ đếm 74190/191/168/169, 4510/4516/4029, 4518/4520,
  4026; thanh ghi dịch 74194/195/595/166, 4014/4021/4094; thanh ghi / chốt tổng quát `D_REG`; chốt đánh địa chỉ;
  mã hoá ưu tiên; ALU 74181 (`alu181`), 74182; so sánh bằng; chẵn lẻ; AOI), `memory.ts` (`D_RAM` / `D_ROM` /
  `D_REGFILE`: nội dung nằm trong behaviour, chỉ ghi ở điểm transient được chấp nhận), `pld.ts` + `logicExpr.ts`
  (phương trình Boole / bảng sự thật → hàm đã biên dịch), `mixed2.ts` (ADC/DAC SPI, ADC0804/0809, VCO tích phân pha,
  bộ so pha PLL 4046), `displays.ts` (LCD kiểu HD44780: mã ký tự, trạng thái và hàng CGRAM ra các nút "code"),
  `memimage.ts` (hex / @địa chỉ / hex-dump / Intel HEX). `msi.ts` thêm `modulus`, decoder có `outputs` / `strobe`,
  mux có `tri` / `invert` / `has_oe`, one-shot 122 / 221 / 4538, 7492, 7448/247/248.
- **Điểm làm việc của phần tử tuần tự** (`core.ts`): mỗi lần lặp Newton tính từ trạng thái của lần giải hội tụ trước
  (lần đầu: trạng thái init), nên chân preset tích cực thấp "trông như đang tích cực" ở lần lặp đầu (mọi nút 0 V) không
  còn chốt sai Q = 1; lần giải hội tụ mới ghi trạng thái (quét DC giữ trạng thái giữa các điểm).
- **Catalogue logic** (`src/library/catalog/logicKit.ts`, `logic74.ts`, `logic4000.ts`): mỗi loại IC mô tả một lần
  (`LogicSpec`: chức năng Anh/Việt, sơ đồ chân dạng chữ gọn `NAME:số`, các họ có loại đó, hàm `build` dùng `IcBuilder`);
  `logicParts()` sinh một part cho mỗi họ: id `ttl/74ls00`, `ttl/74std00` (tên `7400`), `cmos/74hc595`, 4000B
  `cmos/4029`. Họ (`kit.ts FAMILIES`): STD, LS, S, F, ALS, AS, HC, HCT, AC, ACT với mức, ngưỡng, tải vào, trở ra, trễ
  điển hình và `maxFactor`. Chunk riêng `catalogue-digital` (vite.config.ts), vẫn nạp lúc khởi động.
- **Cài đặt mô phỏng số** (`Design.digital`, `DigitalSimSettings`): netlister đưa vào `ToSpiceContextExt.digital`;
  `kit.ts levelsFor()` áp chế độ lý tưởng / trễ lớn nhất / không trễ, `powerNodes()` bỏ qua net nguồn (lý tưởng) hoặc ném
  `PartErcError` (`digitalNoPower`) khi chế độ thực tế thiếu net VCC / VDD. Hộp thoại: `src/ui/app/digitalDialogs.tsx`.
- **Bộ nhớ, PLD, giao tiếp đường dây, bộ chuyển đổi, màn hình**: `digitalMisc.ts`, `mixedSignal.ts`, `displayParts.ts`.
  `ParamDef.memory` bật bảng sửa hex (`openMemoryEditor`); `PartDef.indicator` thêm `lcd` / `matrix` / `alnum`, màu,
  số ô / thanh và vùng `screen`; `IndicatorChannels.signals` / `IndicatorBinding.signals` mang nhiều nút code.
  `live.ts` đưa giá trị vào `indicatorLevels` dưới khoá `${refdes}#k`; `src/ui/editor/displayGlyphs.tsx` vẽ màn hình LCD,
  điểm ma trận, đoạn 7/14/16, thanh LED và đèn đầu dò màu. Ví dụ `examples/09-lcd-hello.msim`.

## Tạo linh kiện, mô hình và cơ sở dữ liệu (component tools)

- **Linh kiện người dùng** (`src/library/custom`): dữ liệu JSON `CustomPartData` (id `custom:<slug>`, nhóm, họ, tiền
  tố, `SymbolDef`, tham số, `CustomModel`, footprint, trường người dùng, `indicator` LED). Mô hình `none` (chỉ vẽ),
  `builtin` (dùng lại toSpice của một part thư viện, ghép chân `pinMap`, đổi giá trị mặc định), `spice` (văn bản
  `.model` / `.subckt`, `name`, `pins[i]` = chân ký hiệu của terminal i; phụ thuộc được tự kéo theo bằng
  `modelDependencies`). `customPartDef(data)` tạo `PartDef` (memo theo object); `customPartProblems` kiểm tra trước
  khi lưu; `validate.ts` kiểm cấu trúc JSON (đường dẫn kiểu `customParts[0].symbol.pins[2].x`).
- **Registry động** (`src/library/index.ts`): `registerRuntimeParts(source, defs)` với nguồn `design` (bản sao trong
  thiết kế đang mở) > `db:user` > `db:corporate` > `seen` (đã gặp trong phiên); `getPart`, `listParts`,
  `subscribeLibrary` / `libraryVersion` (trình duyệt linh kiện tự vẽ lại). Part có sẵn không bao giờ bị thay.
- **Trong thiết kế**: `Design.customParts` (in-use list) — editor store (`commit`) gọi `syncCustomParts` nên thiết
  kế luôn mang đúng các linh kiện đang dùng; `resolvePart` / `designPartLookup` (`hierarchy.ts`) tìm `custom:` trong
  thiết kế trước, nên netlister chạy được trên máy không có cơ sở dữ liệu. `PartInstance.modelOverride` thay mô hình
  của part (cùng loại thiết bị / mạch con cùng số chân, `src/model/modelOverride.ts`; ERC `modelOverrideUnknown`,
  `modelOverrideIncompatible`).
- **Cơ sở dữ liệu** (`src/library/custom/database.ts`, tệp `.msimdb`): Gốc = thư viện có sẵn (chỉ đọc), Công ty, Người
  dùng; họ, trường người dùng, gộp (`newer` / `replace` / `keep`), chuyển / sao chép part, `partFromLibrary`. Lưu ở
  `src/ui/parts/partDatabases.ts`: desktop ghi `userData/databases/partdb-*.json` qua bridge (`readUserData` /
  `writeUserData`), trình duyệt dùng localStorage (`machsim.partdb.*.v1`); sửa part trong cơ sở dữ liệu cập nhật bản
  sao trong thiết kế đang mở.
- **Trình tạo mô hình** (`src/library/modelmaker`): 11 maker (diode, Zener, LED, BJT Gummel-Poon, MOSFET level 1/3,
  JFET, op-amp macro-model, SCR hai transistor, biến áp, đường truyền RF, động cơ KĐB 3 pha). Mỗi maker có `fields`
  (số liệu datasheet), `fit` (công thức giải tích + giải số 1-D, mã nguồn gốc), tuỳ chọn `refine` (hiệu chỉnh bằng mô
  phỏng — SCR), và `checks`: mạch thử hoàn chỉnh + hàm đo, `verifyMaker` mô phỏng từng điểm datasheet và so dung sai.
- **Nhập SPICE** (`src/ui/parts/spiceImport.ts`): `resolveModelText` đọc lần lượt các `.include` / `.lib` còn thiếu
  (desktop: `readIncludeFile` theo thư mục của tệp đã mở; trình duyệt: chọn từng tệp), `inlineIncludes` làm văn bản tự
  chứa, `appendCustomSpice`, `overrideFits`, `quickBench`.
- **UI** (`src/ui/parts`, nạp lười qua `partDialogs.tsx`): Trình tạo linh kiện 8 bước (`wizardModel.ts` thuần,
  `ComponentWizard.tsx`), Trình sửa ký hiệu (`symbolEditModel.ts`, `SymbolEditor.tsx`, tệp `.msimsym`), Quản lý cơ sở
  dữ liệu (`DatabaseManager.tsx`), Nhập mô hình SPICE (`SpiceImportDialog.tsx`); lệnh `tools.componentWizard`,
  `tools.modelMaker`, `tools.symbolEditor`, `tools.databaseManager`, `tools.importModel`, `edit.editComponent`.
  Bộ mô phỏng được nạp trong tiến trình (`import('../../sim')`) cho các mạch thử nhỏ.

## Engine, phân tích và Grapher (vòng mô phỏng)

- **MOSFET level 2** (`src/sim/devices/semi/mos2.ts`): phương trình Grove-Frohman (điện tích khối 2/3·γ, VDSAT giải
  từ dId/dVds = 0, hệ số hẹp kênh DELTA, chia sẻ điện tích XJ/NSUB, suy giảm độ linh động UCRIT/UEXP, VMAX dạng nối
  tiếp, CLM theo LAMBDA hoặc NSUB liên tục tại VDSAT, cận ngưỡng NFS). Số đối ngẫu (`dual.ts`) cho Jacobian đúng.
- **BSIM3v3** (`bsim3.ts`, chọn bởi `mosdevice.ts` theo LEVEL 7/8/49/53; BSIM4 LEVEL 14/54 chạy bằng lõi BSIM3 kèm cảnh
  báo): lõi DC đầy đủ các hiệu ứng chính (Vth với K1/K2/K3/NLX/DVT*/ETA0, Vgsteff hợp nhất, Abulk, độ linh động
  MOBMOD 1–3, VSAT + RDSW trong Vdsat, Vdseff, CLM/DIBL/PVAG/SCBE), binning L/W/P, nhiệt độ (KT1/KT2/UTE/UA1/UB1/UC1/
  AT/PRT), mô hình điện tích bảo toàn dạng capMod 0 (tích luỹ / nghèo / đảo, XPART 40/60, 50/50, 0/100) với ma trận
  điện dung chéo 3×3 không đối xứng cho quá độ và AC. Không có: dòng đế, GIDL, NQS, cạn kiệt poly, capMod 1–3.
- **Đường truyền tổn hao LTRA** (phần tử O, `src/sim/devices/linear/ltra.ts` + `ltraKernels.ts`): LC / RLC / RC / RG như
  SPICE3. Quan hệ cổng dạng tích chập với đáp ứng xung giải tích (hàm Bessel cho RLC, erfc cho RC). RLC: phần đều của
  nhân viết thành tổng hàm mũ từ biểu diễn nhát cắt (θ-quadrature) nên tích chập đệ quy O(1) mỗi bước; RC: dạng dẫn
  nạp y11/y12 (chỉ điện áp) với chuỗi ảnh / chuỗi mode chính xác, O(số điểm) mỗi bước và nén lịch sử. AC dùng quan hệ
  sóng chính xác (không vô hạn ở cộng hưởng). Kiểm chứng: trùng đường T ở R = 0, tiến tới LC khi R → 0, mặt sóng
  e^-αT, thang RLC/RC 200 đoạn, nghiệm chuỗi chính xác của đường RC hở, 1/cosh(γℓ) ở AC.
- **Nguồn LAPLACE** (`E/G … LAPLACE {V(a)} = {N(s)/D(s)}`, `src/sim/spice/laplace.ts`, `devices/linear/laplace.ts`,
  `ElementIR.laplace`): hàm truyền hữu tỉ, thực hiện bằng dạng chính tắc điều khiển được có chuẩn hoá tần số (trạng thái
  là nút nội bộ `<tên>#x<k>` tích phân như tụ); ghi lại thành thẻ LAPLACE khi xuất SPICE.
- **Tuỳ chọn Device**: `SimOptions.defl / defw / defad / defas` (mặc định SPICE), nhóm "Linh kiện" trong thẻ Tuỳ chọn;
  `.options` đọc / ghi các khoá này.
- **Phân tích tự định nghĩa** (`AnalysisSpec` `{ type: 'user', text }`, `src/sim/analyses/user.ts`): thẻ điều khiển
  SPICE được trình phân tích SPICE đọc (`parseUserControls`), áp `.options/.ic/.nodeset/.save` rồi chạy từng thẻ như một
  lô; Grapher tách mỗi thẻ thành một trang.
- **Thẻ Đầu ra** (`AnalysisSettings.saves`, `.expressions`; `src/ui/analysis/OutputTab.tsx`): lọc theo loại biến,
  biểu thức hậu xử lý. Controller gộp biến người dùng với vector mà đầu dò / thiết bị đo cần (`simSettings.effectiveSaves`).
- **Cài đặt mô phỏng tương tác** (`Design.interactive`, `simSettings.resolveInteractive`): điều kiện đầu auto / op /
  zero / uic, bước xuất mẫu, bước tối đa, thời điểm tự dừng (worker dừng đúng `tstop`). Không có khối này thì dùng
  bước của phân tích quá độ như trước.
- **Trợ lý hội tụ** (`src/ui/analysis/convergence.ts`, `controller.tryConvergenceFixes`, `simDialogs.tsx`): phân loại lỗi
  (không hội tụ / suy biến / bước quá nhỏ), thử lần lượt gmin + bước nguồn, ITL, RSHUNT, Gear, nới sai số, GMIN, điện
  trở nối tiếp 1 mΩ (biến đổi netlist), rồi tổ hợp; giữ tuỳ chọn của cách chạy được.
- **Hồ sơ mô phỏng** (`src/model/simProfiles.ts`, `ProfileBar.tsx`): định dạng `machsim-sim-profile` v1 (`.msimprofile`),
  lưu localStorage `machsim.simprofiles.v1`, 4 hồ sơ có sẵn.
- **Grapher nhiều trang** (`src/ui/results/history.ts`, `GrapherWorkspace.tsx`, `runs.ts`): controller ghi mỗi lần chạy
  (và mỗi phiên tương tác khi dừng, `recorder.ts`) vào `LiveState.runs` (tối đa 20); mỗi kết quả thành trang có khoá
  `<loại><số lần chạy>` (vd `tran3`). Trang có thuộc tính trục / đường, vẽ chồng đường của lần chạy khác (kết quả họ
  run), "Thêm từ lần chạy mới nhất", biểu thức tham chiếu trang khác `tran1.V(out)` (lấy mẫu lại theo trục),
  `digital(x, ngưỡng[, ngưỡng cao])`. Xuất CSV, PNG, In và **văn bản đo lường MachSim** (`src/util/measurementText.ts`):
  dòng `MachSim measurement text<TAB>1`, khối đầu `Title`, `Date` (ISO 8601), `X_Label`, `Channels`, dòng
  `***End_of_Header***`, rồi hàng `X_Value<TAB>tên [đơn vị]…` và các hàng số (dấu chấm thập phân, Tab, CR LF; mọi
  đường chung một cột X, nội suy tuyến tính, ô trống ngoài miền dữ liệu).
- **Đầu dò**: loại `reference` (đầu dò tham chiếu), `Probe.refProbe` (đo so với đầu dò tham chiếu cùng cấp, ERC
  `probeRefMissing`), `Probe.show` (giá trị / đỉnh-đỉnh / RMS / DC / tần số trên cờ); sau phân tích quá độ chạy một lần,
  đầu dò hiện giá trị cuối và thống kê của lần chạy.

## Thiết bị đo để bàn và trình hướng dẫn mạch

- **Trình hướng dẫn mạch** (`src/model/wizards`, thuần, có test mô phỏng): mỗi hàm trả `WizardResult` = thiết kế hoàn
  chỉnh (nguồn, tải, thiết bị đo, phân tích đã cài) + bảng giá trị linh kiện + kết quả dự kiến (tính lại với giá trị đã
  làm tròn E-series) + các bước tính / cảnh báo dưới dạng khoá i18n. `timer555.ts` (đa hài chuẩn và có diode — thời gian
  nạp tính số với mô hình 1N4148 của thư viện; đơn ổn), `filterMath.ts` (bậc, cực nguyên mẫu Butterworth / Chebyshev,
  bảng g của thang LC hai đầu điện trở, biến đổi tần số LP/HP/BP/BS thành các tầng bậc 2), `filterDesign.ts` (thang LC thụ
  động; Sallen-Key độ lợi 1; MFB; thông dải MFB; chặn dải biến trạng thái KHN; mỗi tầng có hàm truyền dự kiến từ giá trị
  thật → `response(f)`), `opampStages.ts` (đảo, không đảo, hiệu, cộng đảo / không đảo, cộng có trọng số), `bjtAmp.ts`
  (phân cực cầu chia áp, RE chia RE1 / RE2, tụ ghép theo fL, kiểm lại bằng hybrid-π), `pcbImpedance.ts` (vi dải
  Hammerstad–Jensen, đường dải Wheeler + nghiệm bảo giác, CPW, cặp vi sai IPC-2141A), `logicCircuit.ts` (SOP → mạch
  AND-OR hoặc NAND-NAND với ray đầu vào, cột cổng theo mức logic, kênh nối riêng cho mỗi dây). `WizardSheet`
  (`common.ts`) đặt linh kiện hai chân theo toạ độ chân; quy tắc: dây chỉ nối ở **đầu dây**, mọi điểm nối đều là đầu dây.
- **Hộp thoại** (`src/ui/wizards`, nạp lười, lệnh `tools.wizard.555|filter|opamp|bjt|pcb`, menu Công cụ > Trình hướng dẫn
  mạch): form có tooltip, xem trước sơ đồ (`sheetToSvg` chạy trong effect, không chạy trong render), “Tạo thiết kế mới”
  (`openGeneratedDesign` trong `document.ts`) hoặc “Đặt vào trang hiện tại” (`actions.insertFragment`, đổi tên nhãn trùng).
- **Thiết bị để bàn** (thiết kế mặt máy nguyên bản; `src/library/parts/benchInstruments.ts`): `bench-generator` (XAG,
  sóng ở `benchSignals.ts`: SIN / PULSE / PWL kèm biên độ AC, hoặc nguồn B theo `time` cho AM / FM / burst / quét; ngõ ra
  50 Ω, cài đặt tải High-Z / 50 Ω nhân đôi sức điện động; SYNC), `bench-multimeter` (XDM, HI–LO 10 MΩ / >10 GΩ, cực I qua
  nguồn cảm biến + sun; `benchDmm.ts`: thang, hiển thị 4½–6½ chữ số cố định theo thang, số đọc theo khẩu độ 1 / 20 / 200 ms,
  thống kê Welford, Null / dB / dBm / giới hạn), `bench-scope` (XDS, CH1–CH4 = kênh A–D, EXT, GND) và
  `mixed-signal-scope` (XMS, 2 kênh + D0–D15); `benchScope.ts`: đo tự động kiểu IEEE 181 (mức trên / dưới bằng mode
  histogram, sườn 10–90 %, độ rộng, trễ / pha), kênh toán, FFT cửa sổ, Tự động cài đặt, giải mã bus. Panel:
  `BenchPanels.tsx`, `BenchScopePanel.tsx` (thu nhận dùng `scope.ts selectSweep`). Ví dụ `examples/10-bench-instruments.msim`.
- **Thiết kế phối hợp** (`src/ui/instruments/matching.ts`, `MatchDesigner.tsx`, chế độ “match” của network analyzer): vòng
  ổn định, μ, phối hợp liên hợp đồng thời, vòng độ lợi đơn hướng, mạch L hai lời giải (`lMatch`, `matchToGamma`).
- **Logic converter → mạch** (`src/ui/integration/logicPlacement.ts`, gọi qua `InstrumentPanelProps.host`): vẽ mạch bên
  phải sơ đồ và gắn nhãn vào chân A… / OUT còn trống của bộ chuyển đổi.
- **Cài đặt mặc định thiết bị đo** (`src/ui/instruments/defaults.ts`, localStorage `machsim.instrumentDefaults.v1`):
  `src/ui/store/partDefaults.ts setPlacementDefaults` được integration cài để `createPartInstance` thêm giá trị đã lưu cho
  thiết bị đặt mới. Hộp thoại và in mặt máy: `src/ui/integration/instrumentDialogs.tsx`; chụp mặt máy:
  `src/ui/instruments/faceSnapshot.ts` (clone DOM, canvas → ảnh, SVG foreignObject → PNG).

## Học tập, tệp trao đổi và báo cáo

- **Bài học có hướng dẫn** (`src/learn`, thuần; nội dung `src/i18n/lessons`): 20 bài (`lessons/basics.ts`, `semis.ts`,
  `amps.ts`, `digital.ts`). Mỗi `LessonDef` có các bước `{ id, check(c), simulates? }`, câu hỏi `{ id, options, answer }`,
  mạch mẫu `starter?`, lời giải `solution` và `variants` (lời giải cho bước kiểm tra trạng thái thứ hai: đảo diode, tắt
  đầu vào …). `LessonCircuit` (`circuit.ts`) xem linh kiện đã đặt (`parts(match)`), net của chân (`net`, `across`,
  `touches`), giá trị (`num`) và mô phỏng có nhớ (`op`, `tran`, `acAt`, `simulate`; `meter`, `current`, `pinCurrent`) qua
  `RunFn` tiêm vào. `kit.ts`: bộ khớp `M.*`, `pass` / `fail` với phản hồi `{ id, params }` (`note:<khoá>` ở
  `NOTES`), `withSim` (lỗi ERC / engine thành phản hồi). `runner.ts checkLesson`, `progress.ts` (localStorage
  `machsim.lessons.v1`, bước đã đạt được giữ). UI `src/ui/learn/LessonsPanel.tsx` (cửa sổ nổi `lessons`, lệnh
  `help.lessons`, nút “Bài học” trên thanh công cụ; kiểm tra phần vẽ ngay, phần mô phỏng sau 0.9 s; nút VI / EN riêng).
- **Hộp mô tả** (`Design.descriptionBox`): văn bản cú pháp MachSim (`src/model/richText.ts`, công thức
  `src/model/formula.ts`, vẽ bằng `src/ui/learn/RichText.tsx`), hình nhúng `img:<id>`, câu hỏi chấm bởi
  `src/model/questions.ts` (số có dung sai và dấu phẩy thập phân, chữ không dấu), câu trả lời lưu trong tệp.
  `src/ui/learn/DescriptionBox.tsx` (cửa sổ `description`, lệnh `tools.descriptionBox`, tự mở khi `showOnOpen`).
- **Chế độ giảng viên** (`Design.restrictions`, `src/model/restrictions.ts`): PBKDF2-HMAC-SHA-256 có muối
  (`src/util/sha256.ts`, Web Crypto hoặc mã thuần), ẩn giá trị, khoá linh kiện đang có, tắt phân tích / thiết bị đo, khoá
  hộp mô tả, ẩn đáp án. Thực thi: `editorStore.commit` từ chối (`restrictionViolation`), `schematicOps.unlockedSelection`,
  `placePart`, `controller.runAnalysis`, `InstrumentWindow`, `partValueText(..., hidden)`, Properties, Netlist / BOM /
  báo cáo / xuất SPICE và PCB, Tìm & thay (bỏ trường giá trị), sao chép / dán (bản sao chỉ dán lại vào thiết kế cùng giới
  hạn: `clipboardRestrictionKey` / `pasteAllowed`), Sửa linh kiện (`partValuesHidden`), Lưu khối thành file (giữ
  `restrictions`). Hộp thoại `src/ui/learn/InstructorDialog.tsx` (lệnh `options.instructor`).
- **Nhập SPICE thành sơ đồ** (`src/model/spiceSchematic.ts`): `pspiceCompat`, `spiceToSchematic(netlist)`: phần tử →
  linh kiện thư viện khi tái tạo đúng (R C L, nguồn DC / SIN / PULSE / PWL, E / G tuyến tính, D / Q / M / J có
  `modelOverride`), còn lại → “khối SPICE” (`Design.customParts`, mô hình `.subckt`; K đi cùng cuộn cảm, F / H / W / nguồn
  B đọc I(V) đi cùng nguồn điều khiển). Xếp cột theo BFS từ nguồn, đi dây A* trên lưới 10, đất bằng ký hiệu đất, net
  lớn / không đi được bằng nhãn; tên nút giữ bằng nhãn net. `.include` / `.lib`: `src/model/spiceIncludes.ts
  resolveDeckIncludes` (desktop `readIncludeFile`, trình duyệt chọn tệp, `src/ui/app/spiceIncludeFetch.ts`); lệnh
  `file.importSpiceSchematic` (`src/ui/reports/importFlow.tsx`), và Nhập SPICE (chạy) cũng đọc include.
- **Báo cáo** (`src/model/reports.ts` thuần + `src/ui/reports/reportTables.ts` bản địa hoá + `ReportsDialog.tsx`): BOM
  (nhà sản xuất / mã / nhà cung cấp từ `PartInstance.fields`, dung sai, vỏ), chi tiết linh kiện, dữ liệu mô hình, cổng
  còn trống (`gateSections` theo tên chân `1A 1B 1Y …`), tham chiếu chéo (ô A…F × 1…8), thống kê; `src/model/reportFormat.ts`
  CSV / HTML, in qua iframe ẩn. Lệnh `reports.*`.
- **Chuyển mạch in** (`src/model/pcb.ts`): `kicadNetlist` (s-expression KiCad, `tstamps` = uid của phiên bản linh kiện),
  `csvNetlist`, `readNetlistSnapshot`, `forwardAnnotation`, `annotationText` (`MachSim annotation<TAB>1`),
  `parseAnnotation`, `applyBackAnnotation` (đổi tên đồng thời, giá trị, vỏ). UI `src/ui/reports/pcbFlows.tsx`, lệnh
  `file.transfer.*`.
- **Dòng lệnh desktop** (`src/desktop/cli.ts` parse, `src/desktop/batch.ts runBatch` + định dạng CSV / văn bản đo lường
  / JSON, `src/desktop/batchRenderer.ts`): `desktop/main.cjs` nhận `--batch` / `--help`, mở `index.html?batch` ẩn với
  hồ sơ người dùng tạm, chỉ cho đọc / ghi đường dẫn có trên dòng lệnh (và include SPICE cạnh tệp vào); IPC
  `machsim:batch-job|read|write|include|done`; mã thoát 0 / 1 / 2 / 3.

## Menu Tệp: snippet, mạch mẫu, thông tin tệp, an toàn dữ liệu, trao đổi tệp

- **Mở mọi định dạng** (`src/ui/app/document.ts` `openOpenedFile`, `otherFormatHandler`; `src/ui/files/install.ts`,
  `flows.tsx handleOtherFormat`, nạp lười): `.msim` / `.json`, deck SPICE (`spiceFileHandler`), MachSim XML, KiCad,
  EDIF, snippet `.png` (mở thành thiết kế mới), bản `.bak` (thành bản chưa lưu), định dạng đóng (.ms14…, .dsn, .utsch,
  .msmx, .mp14, .prz → hộp giải thích cách xuất SPICE / EDIF). `files.ts`: `OpenedFile.bytes` cho tệp nhị phân
  (`BINARY_OPEN_RE`), `OPEN_ACCEPT`, `pickBinaryFile`, `openedFromFile` / `openedFromDesktop`; desktop trả `base64` cho
  tệp nhị phân (`DesktopFile.base64`). Kéo thả tệp lên cửa sổ mở thiết kế; thả ảnh snippet lên trang đặt mạch tại
  điểm thả (`editor/controller.ts canvasFileDrop`); Ctrl+V khi bộ nhớ tạm của MachSim trống để trình duyệt phát sự
  kiện paste (tệp .png đã sao chép trong trình quản lý tệp).
- **Snippet** (`src/util/png.ts` codec PNG: chunk, CRC-32, iTXt, `encodePng` zlib stored; `src/model/snippet.ts`):
  chunk iTXt `MachSim-snippet` chứa JSON `{format:'machsim-snippet', version:1, savedBy, created, title, fragment,
  customParts?, variables?, variants?, customSpice?}`; `fragment` có dạng Clipboard của editor (kèm `children` của
  khối). `variables` = **mọi** tham số toàn cục mà giá trị của các linh kiện được chép cần, tìm đúng như
  `src/model/variables.ts` đánh giá chúng (`referencedNames`: tên trong mỗi `{…}`, hoặc cả đoạn văn bản khi nó là tên
  trần / biểu thức trần, không phân biệt hoa thường) rồi **bao đóng** qua các biến mà chính các biến đó dùng.
  `variants` = các phương án lắp ráp mà `PartInstance.notFitted` của linh kiện được chép nhắc tới: thiếu chúng, bộ kiểm
  tệp từ chối (`unknown variant id`) và snippet không đọc lại được. Đọc:
  kiểm CRC, kiểm tra bằng `validateDesign` (một trang tạm), lỗi `SnippetError.code` ('not-png' | 'no-data' | 'damaged' |
  'newer' | 'invalid'). Đặt: `actions.insertSnippet(fragment, extras, at)` = một bước hoàn tác (nhúng linh kiện người
  dùng, thêm tham số / SPICE thiếu, `pasteItems(..., { keepRefdes: true })` giữ refdes nếu chưa dùng). `pasteItems`
  (và `mergeChildren`) còn giữ hai quy tắc của thiết kế đích: các **phần của một vỏ** (`packageKey`,
  `src/model/sections.ts`) nhận **cùng một** refdes mới (U1A + U1B → U2A + U2B, một 7400 trong BOM), và các id phương án
  trong `notFitted` mà thiết kế đích không khai báo bị bỏ (nếu không, bản dán lưu được nhưng tệp không mở lại được). Ảnh vẽ bằng
  `sheetToSvg` + canvas; không có canvas thì ảnh trắng nhỏ (mạch vẫn đủ). Lỗi giả lập ẩn bị bỏ, chế độ ẩn giá trị chặn.
- **Mạch mẫu** (`src/ui/integration/SampleBrowser.tsx` nạp lười, lệnh `file.examples`): `examples.ts` liệt kê 50 thiết kế
  + 5 deck SPICE với `topic` (`SAMPLE_TOPICS`: basics, semiconductors, opamps, digital, mixed, power, rf, instruments,
  analyses, hierarchy) và khoá `sampleKey(file)` vào bảng chữ nạp lười `src/i18n/samples.ts`. Mẫu 11–50 dựng bằng code
  ở `sampleDesigns.ts` (`SAMPLE_BUILDERS`), ghép vào `EXAMPLES` của `exampleDesigns.ts`; tệp `.msim` là đầu ra của
  builder (`MACHSIM_UPDATE_EXAMPLES=1`). Mở: `localizeSample` đổi tiêu đề và "Sheet n" → "Trang n" theo ngôn ngữ.
- **Thông tin tệp** (`src/model/fileInfo.ts designInfo`, `flows.tsx openFileInfoDialog`): số đếm (trang, linh kiện theo
  nhóm / họ, thiết bị đo, ký hiệu, khối, dây / bus, nhãn / đầu nối, net của netlister, tham số, linh kiện người dùng,
  mô hình SPICE, lỗi giả lập), giới hạn giảng viên, thiết lập mô phỏng; đường dẫn / kích thước / ngày từ desktop
  (`bridge.fileStat`) hoặc `File` của trình duyệt (`currentOpenedStat`). `Design.meta` (created / modified / savedBy)
  được `designForSave` đóng dấu ở mỗi lần Lưu (`markSavedAs` thay design mà không thêm bước hoàn tác);
  `registerSaveTransform(fn)` cho phép module khác sửa thiết kế được ghi (trang Grapher).
- **Lưu tự động và khôi phục** (`src/ui/app/recovery.ts` thuần + `document.ts`): `RecoveryStore` cho trình duyệt
  (localStorage `machsim.autosave.v1` + dấu phiên `machsim.session.v1` có nhịp tim 15 s) và desktop (IPC
  `machsim:recovery-read|write`, `machsim:session-info`; main ghi `userData/recovery/session.json` khi khởi động, đánh
  dấu sạch ở `will-quit`, nạp lại renderer bị crash). `recoveryDecision`: hỏi khôi phục chỉ sau khi thoát không bình
  thường hoặc bản ghi chưa có dấu phiên. Chu kỳ `ui.autosaveSeconds` (Tuỳ chọn > Tuỳ chọn tệp), `.bak` khi Lưu ghi đè
  (`ui.backupCount`, `bridge.writeFile(path, text, { backups })`, `rotateBackups` trong main).
- **MachSim XML** (`src/model/xmlDesign.ts`, `src/util/xml.ts`; đặc tả `docs/xml-format.md`): ánh xạ JSON ↔ XML có kiểu
  (`type="number|boolean|null|array|object"`, `<entry key>`, `encoding="json"`), đọc lại qua `migrateDesign` /
  `validateDesign`; khứ hồi không mất dữ liệu trên mọi mẫu.
- **Giá trị và ký hiệu chưa đánh số khi nhập sơ đồ**: `importSchematic.ts valueText` ghép **số với hậu tố qua dấu
  cách** ("4.7 k", "10 kΩ", "100 nF", "1 kohm 5%") trước khi đọc, và `kicadImport.ts` coi "R?" / "R" / rỗng là **chưa
  đánh số** — mỗi ký hiệu như vậy là một linh kiện riêng (khoá chân cũng riêng, nếu không hai "R?" sẽ nối chung net),
  được đặt số thấp nhất còn trống theo tiền tố và báo lại bằng `ImportedNetlist.unannotated` → ghi chú `unannotated`
  (chuỗi `importUnannotated`). Chỉ các **đơn vị** của một refdes đã đánh số mới được gộp làm một linh kiện nhiều phần.
- **KiCad / EDIF** (`src/util/sexpr.ts`, `src/model/kicadImport.ts`, `edifImport.ts`, `importSchematic.ts`): bộ nhập sinh
  `ImportedNetlist` (linh kiện, chân → net, vị trí tuỳ chọn, trường Sim.*), `importedToDesign` ghép linh kiện thư viện /
  khối chung (`custom:import-…`, mô hình none), thêm nguồn DC cho net nguồn không có nguồn, đặt bằng
  `spiceSchematic.placeAndRoute` (vị trí cố định `SchematicItem.at` khi nguồn có toạ độ; chọn hướng khớp chân gốc) rồi đi
  dây A*. Ghi chú nhập (`SchematicImportNote`) hiện trong hộp "Ghi chú khi nhập".
- **Grapher**: `src/util/traceImport.ts` (CSV / TSV / văn bản đo lường → `AnalysisResult` tran / ac / dc,
  `RunSource 'import'`, `ctrl.importRun`); `Design.grapher` (`SavedGrapher`) = lần chạy + trang khi bật "Lưu vào tệp"
  (`src/ui/results/savedGrapher.ts`, `history.applySavedPages`, `integration/grapherPersist.ts`, `ctrl.adoptRuns`).
- **Dự án và mẫu**: `packProject` kèm `components/user-components.msimdb` (`bundleComponents`), `unpackProject` trả
  `components` và giao diện hỏi gộp vào cơ sở dữ liệu Người dùng; `templates.ts parseTemplateFile` / `TEMPLATE_EXTENSION`
  (`.msimtpl`), Tệp > Xuất mẫu ra tệp / Thiết kế mới từ tệp mẫu; Tệp > Dự án gần đây (`recentProjectFiles`).
- Chữ hiển thị: nhãn lệnh / menu ở `src/i18n/messages/files.ts`; chữ của hộp thoại nạp lười ở `src/i18n/filesText.ts`
  (`ft()`), `src/i18n/samples.ts`; trợ giúp: trang hướng dẫn `samples`, `snippets`, `fileSafety`, `exchange`,
  `measurements` (`src/i18n/helpGuides.ts`).

## Nguồn, khối chức năng điều khiển và phương ngữ SPICE

- **Linh kiện** (`src/library/catalog/signalBlocks.ts`, `SIGNAL_BLOCK_CATALOG`; chữ tiếng Việt của tham số ở
  `src/i18n/signalBlocks.vi.ts`, trang F1 từng linh kiện ở `src/i18n/partHelp.ts` `PART_HELP`, nạp cùng hộp trợ giúp):
  nguồn hàm Laplace V / I điều khiển bằng áp / dòng và khối hàm truyền (`laplaceFromParams`: hệ số tử / mẫu, bậc cao
  trước, hoặc biểu thức theo s → `ElementIR.laplace`), bộ đơn ổn, khối hạn dòng, nguồn DC tương tác V / I, khâu trễ
  (đường dây không tổn hao phối hợp: trễ đúng trong quá độ, e^{−jωtd} trong AC), nguồn PWM, nguồn lưỡng cực, răng cưa
  điều khiển bằng áp (`sawtoothOf` ở `partkit.ts`, cũng là lựa chọn của VCO), cộng 2 ngõ vào, tích phân có reset / giới
  hạn (trạng thái 1 nF, đường kẹp / reset 1 S, giữ ở ic trong OP bằng `u(time)`), khối trễ Schmitt, hạn tốc độ biến
  thiên (B nguồn dòng có `limit` vào tụ, τ bám 0.1 µs), lấy mẫu và giữ (sườn / bám), điều chế PWM.
- **Code model có nhớ** (`src/sim/devices/digital/analogBlocks.ts`, đăng ký trong `registry.ts`): `A_HYST`, `A_ONESHOT`,
  `A_SAH`, `A_PWM` dùng vỏ điện của code model (`core.ts`): trạng thái chỉ đổi ở điểm được chấp nhận, thời điểm cắt
  ngưỡng nội suy, breakpoint ngay sau điểm cắt dự đoán, ngõ ra tương tự (`AnalogOutputSpec` lo = hi = REF, span = 1 nên
  giá trị = điện áp ra) có cạnh dốc tuyến tính `edge`. Tham số đặt ở instance (`el.params`), card mẫu không tham số
  (`MS_HYST` …). Độ rộng xung đo giữa hai điểm 50 %: cạnh lên bắt đầu ở điểm được chấp nhận, cạnh xuống ở `wake()`.
- **Nguồn DC tương tác**: `InteractiveDef.stepParam / minParam / maxParam` (`src/library/types.ts`) chỉ tham số instance
  đặt bước / giới hạn của thanh trượt; `editorStore.interact` đọc chúng và truyền cho `nextInteractiveValue(…, range)`.
  Phím của instance (tham số `key`) nay thắng phím mặc định của part (`interaction.ts interactiveTargets`).
- **Đất tham chiếu 1…5** (`sources/ground-ref<n>`): net toàn cục `GNDREF<n>` + điện trở nối `R_GNDREF<n>_tie` 1 GΩ tới
  nút 0 (mọi ký hiệu cùng số phát cùng phần tử, khử trùng theo tên như `V_PWR_`). `erc.ts analyzeReferenceGrounds` chia
  mạch thành các phần nối một chiều (bỏ các điện trở nối và điện trở ≥ 100 MΩ): phần chỉ có một đất tham chiếu → các nút
  của nó đo so với đất đó (netlister đổi `ProbeBinding.signal.neg` và `refName` của đầu dò áp / số, `neg` của đầu dò công
  suất); phần có cả Đất chính → cảnh báo `refGroundNotIsolated`; hai đất tham chiếu trong một phần → `refGroundsJoined`.
- **.meas** (`src/sim/spice/measure.ts` `parseMeasCard` / `formatMeasCard`; `Netlist.measures`, `MeasDirective` ở
  `netlist.ts`): đánh giá bởi `src/sim/analyses/meas.ts` (`applyMeasurements` gọi trong `runAnalyses` và phân tích Tự
  định nghĩa; đi vào mọi lần chạy con của quét / Monte Carlo / batch) → `AnalysisResult.measurements`
  (`MeasurementResult`: name, analysis, value — NaN khi thất bại —, at, error). TRAN / DC tính số thực bằng biểu thức
  SPICE đã biên dịch (vector thiết bị như Ic(Q1) thành biến chạy), AC tính số phức (vdb / vm / vp / vr / vi, idb / ip).
  Trong AC, một **phasor** được đo bằng **độ lớn** và một lượng vốn là số thực (vdb, vp, re, im, phép so sánh, hàm
  thực) giữ dấu; `CVec.real` mang sự phân biệt đó qua cả cây biểu thức, nên kết quả không còn phụ thuộc việc phần ảo
  có đúng bằng 0 hay không (tầng đảo hệ số −10 đo ra 10). Các phép đo theo khoảng (INTEG / AVG / RMS) lấy mẫu theo **x
  tăng**, nên quét DC chạy xuống (`.dc V1 5 0 -0.5`) cho cùng kết quả như chạy lên.
  Grapher: bảng "Phép đo (.meas)" và "theo từng lần chạy" trong `plotModel.resultTables`; dòng lệnh: log, bảng
  `… — .meas` (CSV / văn bản), trường `measurements` (JSON, NaN → null). Trên sơ đồ: thẻ `.meas` trong văn bản SPICE riêng
  của thiết kế (netlister chuyển `customSpice` `.meas` → `netlist.measures`, `.ic` / `.nodeset` theo tên net) hoặc trong
  phân tích Tự định nghĩa.
- **.step param** (`controls.ts parseStepCard` target `param`): `ParamSweepAnalysis.global = true`, gói ngoài cùng (sau
  `.temp`). `AnalysisContext.source` (netlist trước khi phẳng hoá, có ở cấp đầu của `runAnalyses` và ở context con chạy
  trên cùng netlist) được `runParamSweep` đổi `.param` rồi phẳng hoá lại cho mỗi giá trị (`withGlobalParam`).
- **E / G FREQ** (`ElementIR.freqTable` {f, mag, phase, delay}, `src/sim/devices/linear/freqTable.ts`): AC nội suy dB và
  pha theo log f; DC = phần thực tại 0 Hz; quá độ tích chập với đáp ứng xung (IFFT trên lưới N ≤ 16384, Δt = 1/(2 f_max),
  chỉ phần nhân quả, côn 10 % cuối, chuẩn hoá tổng = H(0)), bước tối đa Δt, lịch sử nội suy tuyến tính.
  **CHEBYSHEV** (`src/sim/spice/chebyshev.ts designChebyshev`): bậc nhỏ nhất, cực nguyên mẫu, biến đổi LP / HP / BP / BR,
  chuỗi khâu bậc ≤ 2; trình đọc tách thành các phần tử LAPLACE `<tên>_s<k>` qua `ElementContext.addElement`.
- **Ký sinh LTspice** (`elements.ts splitParasitics`): V Rser / Cpar, C Rser / Lser / Rpar / Cpar, L Rser / Rpar / Cpar thành
  phần tử `R<tên>_rser`, `L<tên>_lser`, `R<tên>_rpar`, `C<tên>_cpar` (phần tử chính dời sang nút sau phần nối tiếp).
- **Nhập SPICE thành sơ đồ**: `.func` / `.ic` / `.nodeset` / `.meas` thành thẻ của `Design.customSpice` (ghi chú `carried`);
  `.step param` không mang sang (giữ phân tích được quét, ghi chú `unsupported`). Trên sơ đồ: xem mục vòng 4 bước 3
  (`src/model/steps.ts`: biến thiết kế dựng lại netlist cho từng giá trị, thẻ `.step` trong văn bản SPICE riêng).
- **Bước thời gian**: `TransientEngine.planStep` không kéo dài bước lên breakpoint quá 50 % — khi LTE đòi bước nhỏ hơn
  `minBreak` (hằng số thời gian rất nhỏ ngay sau một sườn) bước ngắn được dùng và breakpoint quá gần bị gộp (trước đây có
  thể lặp vô hạn).

## Nhóm Cơ bản, IC tương tự và độ sâu catalogue (vòng 3 bước 3)

- **Catalogue mới** (`src/library/catalog/basicExtras.ts` `BASIC_EXTRA_CATALOG`, `analogExtras.ts` `ANALOG_EXTRA_CATALOG`,
  `passiveSeries.ts` `PASSIVE_SERIES_CATALOG`, ghép trong `catalog/index.ts`; chữ tiếng Việt của tham số ở
  `src/i18n/basicExtras.vi.ts`, trang F1 / họ ở `src/i18n/basicExtrasHelp.ts` gộp vào `PART_HELP` và `CATALOG_FAMILY_HELP`,
  trang hướng dẫn `realParts` ở `helpGuides.ts`):
  - **RLC không lý tưởng**: điện trở (Ls nối tiếp, Cp song song), tụ (ESR, ESL, điện trở rò), tụ hoá, cuộn cảm (điện trở
    dây quấn, Cp, tổn hao lõi tuỳ chọn) — AC cho đúng cộng hưởng riêng 1/(2π√(L·C)).
  - **Tải Z** (`zLoadElements`): R + jX hoặc |Z|∠φ tại f, thực hiện bằng R nối tiếp / song song với L (X > 0) hoặc C (X < 0).
  - **Mảng điện trở** SIP chung chân 6 / 8 / 9 / 10, DIP riêng rẽ 8 / 14 / 16, SIP riêng rẽ 8, kết cuối kép SIP-10 (R1 / R2),
    giá trị cố định E6 100 Ω…100 kΩ của SIP-9 / DIP-16. Footprint `SIP-<n>` được breadboard xếp một hàng.
  - **Đế IC** DIP 8…40 và **ký hiệu sơ đồ** (điểm đo, mũi tên tín hiệu vào / ra / hai chiều, ăng-ten, ký hiệu vỏ máy, đất
    bảo vệ, dấu chân không nối): `LibraryPartDef.annotation` = `'placeholder'` / `'symbol'`, không có `toSpice`; chân vẫn nối
    net (đế cho net đi qua), canvas vẽ mờ (`.ms-part.is-annotation`), breadboard bỏ qua (`leadMap` → `none`), BOM giữ phần tử
    vật lý (điểm đo, ăng-ten, đế) và bỏ phần tử `virtual`. Ký hiệu vỏ / đất bảo vệ KHÔNG nối vào nút 0.
  - **Công tắc nhiều nút**: DIP 2…10 vị trí, công tắc xoay 1 cực 3 / 4 / 6 / 8 / 12 vị trí, bàn phím ma trận 4×3 / 4×4.
    `InteractiveDef.controls` (`InteractiveControl` {param, label, key?, value?, at}) + `keysParam`: nhấp khi đang mô phỏng thao
    tác nút gần nhất (`interactive.ts nearestControl`, toạ độ ký hiệu qua `sheetToLocal`), mỗi nút có phím riêng
    (`controlKeys`, `CanvasInteraction.interactiveControlTargets`), nút có `value` là bộ chọn (tiếp điểm công tắc xoay); phím
    chính của part (R của công tắc xoay) vẫn bước vị trí. `editorStore.interact(refdes, phase, control?)`. Canvas vẽ chấm trạng
    thái (`ControlStates` trong `scene.tsx`, `.ms-ctl`), menu chuột phải có một mục cho mỗi nút.
  - **Từ tính**: biến áp 1 + 2, 1 + 3, 2 + 2 cuộn (K giữa mọi cặp), ba cuộn cảm ghép (k12 / k13 / k23, kiểm tra ma trận xác định
    dương), biến áp và cuộn cảm **bão hoà** (`coreBranch`: nút từ thông 1 F tích phân V, dòng từ hoá i(λ) = λ/Lm·(1 + (λ/λsat)^8),
    `coreFit` khớp dòng từ hoá định mức; cuộn dây thứ cấp là biến áp lý tưởng E / F + điện trở đồng; 1 GΩ qua cuộn dây cho ERC).
  - **RLC điều khiển bằng áp**: R / C / L = gốc + hệ số·V(C+,C−) (kẹp ở giá trị nhỏ nhất); C và L dùng phần tử tham chiếu 1 nF /
    1 mH được nhân tỉ lệ (dạng i = C·dv/dt, v = L·di/dt).
  - **Linh kiện 3D cho người học**: ký hiệu hình thật có màu (`bandColors` IEC 60062, đầu LED, vỏ tụ hoá, TO-92, DIP-8, nút nhấn,
    công tắc gạt, chiết áp), giá trị cố định là tham số select một lựa chọn; `toSpice`, chỉ thị LED, tương tác và footprint lấy
    nguyên từ linh kiện chung (cùng hình 3D trên breadboard).
  - **IC tương tự**: OTA (`otaSubckt`: gm = IABC/(2·VT), VT theo `temper`, dòng ra ±IABC lấy từ nguồn, chân IABC hai diode trên V−;
    chung, CA3080, LM13700, NE5517), op-amp hồi tiếp dòng (`cfoaSubckt`: đệm vào, RT ∥ CT, đệm ra; chung, AD844, THS3001), khối
    PLL (`pllHoldRange`: bộ so pha dấu × cos pha VCO, lọc RC 10 kΩ ở chân VCTRL, VCO tích phân pha có `u(time)`), khuếch đại cách
    ly (rào R ∥ C giữa GND1 / GND2), khuếch đại hiệu INA105 / INA106 / INA133 / AD8276 (SENSE để hở nối OUT), 8 khuếch đại đo
    lường mới, 3 op-amp băng rộng; nhóm Linh tinh: mạch lái cổng (`driverChannel`: ngưỡng tanh, trễ bằng đường dây phối hợp,
    ngõ ra kéo-đẩy ROH / ROL có giới hạn dòng; chung, TC4420 / 4429 / 4427 / 4426, MIC4422) và mạch lái nửa cầu.
  - **Độ sâu**: điện trở dán 0805 / 1206 E24 ±1 %, ô-xít kim loại 1 W E12, sứ 5 W E12 (τ nhiệt 1 s), sun 2512 E6 1…100 mΩ; tụ
    hoá E6 1 µF…4,7 mF × 16 / 25 / 35 / 50 / 63 V (bỏ các cặp đã có ở `passives.ts`), tantalum 16 / 35 V, MKT, MKP, MLCC 0805
    X7R; ESR của tụ hoá / tantalum = tan δ/(2π·120 Hz·C) (`esrFromTanDelta`). `passives.ts` xuất `resistorParams` (thêm đối
    số dung sai), `resistorSpice`, `RES_RATINGS`, `icParam`, `valueCode`.
- **Mạch mẫu** 48 (tụ thực, `.meas` tần số cộng hưởng), 49 (PLL khoá, `.meas` điện áp điều khiển và chu kỳ), 50 (công tắc DIP,
  mảng điện trở, LED 3D — tương tác); kiểm bằng công thức trong `tests/samples-physics.test.ts`.
- **Test**: `basicExtras.test.ts`, `analogExtras.test.ts`, `passiveSeries.test.ts` (so với lý thuyết mạch), `src/ui/editor/
  multiControl.test.ts` (nhấp / phím / giữ phím), `src/i18n/basicExtrasHelp.test.ts`.

## Đặt linh kiện, cơ sở dữ liệu quy mô lớn và phương án lắp ráp (vòng 3 bước 4)

- **Hộp thoại Chọn linh kiện** (`src/ui/parts/PlaceComponentDialog.tsx`, lệnh `place.component`, Ctrl+K, chunk riêng):
  cột cơ sở dữ liệu (Gốc = thư viện có sẵn / Công ty / Người dùng, kèm số linh kiện) → nhóm (hoặc tất cả) → họ → linh kiện,
  mọi danh sách là `VirtualList` (`src/ui/common/VirtualList.tsx`, hàng 22 px, chỉ dựng hàng trong khung nhìn + overscan,
  `aria-activedescendant`, tự cuộn hàng đang chọn). Tìm kiếm chạy trong nhóm đang chọn (hoặc cả thư viện) và tăng dần.
  Cột phải: `SymbolPreview`, các trường của `partInfo.partDetails` và nút Báo cáo chi tiết / Xem mô hình. Ghi nhớ cơ sở
  dữ liệu / nhóm / họ / linh kiện và tuỳ chọn trong `localStorage` (`machsim.placeDialog.v1`). “Mở lại sau khi đặt”:
  `keepPlacing(host, partId, reopen)` (`src/ui/parts/keepPlacing.ts`) gọi `actions.startPlacing(id, { once: true })` rồi mở
  lại hộp thoại đúng chỗ cũ khi `onPartPlaced` báo linh kiện đã đặt, và bỏ cuộc khi người học nhấn Esc / đổi công cụ / đổi
  linh kiện. Lưu ý thứ tự của store: đặt xong thì tool quay về `select` (thông báo cho subscriber) **trước** khi gọi
  listener của placement, nên quyết định bỏ cuộc phải hoãn một lượt (`host.defer`) — nếu không hộp thoại sẽ không mở lại.
  Tắt tuỳ chọn thì mỗi lần nhấp đặt thêm một bản.
- **Văn bản của linh kiện**: `partInfo` trả về văn bản gốc (tiếng Anh) của thư viện; lớp ngôn ngữ là
  `src/ui/parts/placeReport.ts` — `functionText(details, def)` và `detailName(details, def)` lấy tên / mô tả tiếng Việt của
  part (`partName` / `partDescription`, văn bản tiếng Việt của part catalogue nằm trên chính định nghĩa `textVi`, nên phải
  truyền `def`), nhãn tham số qua `paramLabel`, nhãn thông số qua `specLabel` / `specValueText`.
- **Thông tin linh kiện** (`src/library/partInfo.ts`, thuần, không phụ thuộc UI): `partDatabaseOf` (master / corporate /
  user / design), `modelInfo` (none / primitive / model / subcircuit / behavioral / code-model / instrument + mã model +
  nhà sản xuất model: hãng nêu trong `provenance` khi part theo model hãng công bố, còn lại là MachSim), `partDetails`
  (Chức năng, vỏ + nhà sản xuất vỏ từ trường người dùng, Liên kết: `PartDef.hyperlink` của linh kiện người dùng, còn lại
  mở trang trợ giúp trong app), `partModelText` (văn bản mô hình: text của người dùng sửa được, part thư viện là listing
  sinh từ `partFragment` + `writeSpice`, chỉ đọc), `partDetailReport` (thêm chân, tham số, thông số, từ khoá).
- **Quy mô** (`src/ui/editor/browserModel.ts`): `indexParts(parts, from, budgetMs)` dựng chỉ mục theo lát `INDEX_BLOCK`
  = 64 part (xem đồng hồ sau mỗi khối, nên lát không bao giờ vượt ngân sách quá một khối), `createSearchJob` tìm theo lát
  `JOB_BLOCK` = 512 part và trả kết quả từng phần kèm `progress`, `treeRowModel` / `listRowModel` / `virtualWindow` chỉ tạo
  đối tượng hàng cho khung nhìn (`ROW_STATS.created` để test kiểm). `useIdleIndexing` dựng chỉ mục khi rảnh trong lúc
  browser / hộp thoại mở. Benchmark `browserBenchmark.test.ts`: 60 000 part tổng hợp (một họ 30 000), tìm dưới 150 ms,
  số hàng dựng cho 60 000 part bằng số hàng cho 6 000, chỉ mục đã dựng không dựng lại.
- **Cập nhật linh kiện từ thư viện** (`src/library/partFingerprint.ts`, `src/ui/store/libraryUpdate.ts`): `partFingerprint`
  = CRC-32 của chân (tên, vị trí, loại, số), tham số (khoá, kiểu, mặc định, đơn vị, lựa chọn), vỏ và đoạn mô phỏng mặc
  định; `libraryRef(def)` là tham chiếu `Design.libraryRefs` được đóng dấu khi lưu (`stampLibraryRefs`). `compareWithLibrary`
  so sơ đồ với thư viện hiện tại và trả `LibraryDiff[]` (`status` changed / missing, danh sách `LibraryChange`);
  `updateFromLibrary` cập nhật những part được chọn trong một bước undo, dời dây theo chân đã di chuyển và bỏ giá trị
  lựa chọn không còn hợp lệ. UI: `libraryTools.openUpdateComponentsDialog` (Công cụ > Cập nhật linh kiện từ thư viện).
- **Phương án lắp ráp** (`src/model/variants.ts`): `Design.variants` (danh sách + `active`) và `PartInstance.notFitted`
  (danh sách id phương án). `variantView(design)` (memo theo object) gắn `excludeFromSim` + `excludeFromBom` cho part không
  lắp, nên netlister, mô phỏng, BOM, báo cáo và PCB đi theo phương án mà không cần biết gì về phương án; `scene.tsx` vẽ mờ
  nét đứt, `StatusBar` hiện tên phương án, Properties có ô “Lắp trong phương án …”, menu Công cụ > Phương án hoạt động đổi
  phương án. Serialize kiểm mọi `notFitted` phải là id phương án có thật. Khối con không lắp bỏ toàn bộ nội dung.
- **Hồ sơ “Thư viện của tôi”** (`src/library/custom/profile.ts`): tệp `.msimlib` (`machsim-library-profile` v1) gồm Yêu
  thích, Gần đây và cơ sở dữ liệu Người dùng (tuỳ chọn cả Công ty); `mergeProfile` gộp theo `MergePolicy` (newer / replace /
  keep). UI `libraryTools.exportLibraryProfileFlow` / `importLibraryProfileFlow`; dự án lưu hồ sơ ở
  `library/my-library.msimlib` (`PROJECT_PROFILE_PATH`, `src/ui/app/projectDialogs.tsx`).
- **Văn bản**: nhãn menu / lệnh ở `src/i18n/messages/placement.ts`, văn bản hộp thoại ở `src/i18n/placeText.ts` (`pt`, nạp
  cùng chunk hộp thoại). Trợ giúp: 4 trang hướng dẫn `placement`, `updateComponents`, `variants`, `myLibrary`.
- **Test**: `browserBenchmark.test.ts` (quy mô), `src/library/partInfo.test.ts` (chi tiết + báo cáo + văn bản mô hình),
  `src/ui/parts/placeReport.test.ts` (văn bản theo ngôn ngữ UI), `src/ui/parts/keepPlacing.test.ts` (mở lại sau khi đặt,
  kể cả thứ tự thông báo của store thật),
  `src/ui/store/libraryUpdate.test.ts` (so sánh, cập nhật, Replace giữ dây), `src/model/variants.test.ts` (netlist, BOM,
  báo cáo, PCB, lưu tệp), `src/library/custom/profile.test.ts`, `src/library/lazyPacks.test.ts` (nạp chunk một lần).

## Vi điều khiển 8051 và logic lập trình được (vòng 3 bước 5)

- **Lõi MCS-51** (`src/mcu/cpu8051.ts`, thuần, không phụ thuộc engine / DOM / i18n): viết từ mô tả tập lệnh công
  khai — đủ 256 vị trí mã lệnh (0xA5 là vị trí duy nhất không dùng: lõi dừng và báo `halted = 'opcode'`), bảng
  `CYCLES` / `LENGTHS` theo số chu kỳ máy và số byte công bố, 256 byte RAM trong (0x80…0xFF chỉ gán tiếp được),
  128 địa chỉ SFR, bốn băng thanh ghi theo PSW.RS1 / RS0, vùng bit 0x20…0x2F, bộ nhố dữ liệu ngoài cho MOVX.
  **Mọi thời gian đếm theo chu kỳ máy** (12 chu kỳ thạch anh), `machineCycleSeconds(fosc)` để đổi sang giây;
  `step()` chạy một lệnh (hoặc nhảy vào một ngắt, hoặc một chu kỳ bị giữ reset) và bên trong nó bộ định thời, xung
  nhịp nối tiếp và bộ phát hiện sườn ngắt ngoài tiến từng chu kỳ một, nên thời điểm chính xác đến chu kỳ máy.
  `pinIn[0..31]` là mức bên ngoài đặt lên P0.0…P3.7, `pinOut(i)` là mức cổng phát ra = chốt AND hàm thay thế (TXD);
  đọc một địa chỉ cổng trả về mức **chân**, trừ các lệnh đọc-sửa-ghi (ANL / ORL / XRL / INC / DEC / DJNZ / CPL bit /
  CLR bit / SETB bit / JBC / MOV bit,C) đọc mức **chốt** — đúng như linh kiện thật. `saveState()` / `restoreState()`
  chụp và phục hồi toàn bộ máy rất rẻ (RAM và SFR copy, RAM ngoài ghi sổ từng ô), dành cho việc chạy trước.
- **Trình dịch hợp ngữ hai lượt** (`asm8051.ts`): nhãn, `ORG`, `EQU` / `SET` / `DATA` / `BIT` / `CODE` / `XDATA` /
  `IDATA`, `DB` / `DW` (byte cao trước) / `DS`, `END`; số dạng 25, 0x19, 19h, 11001b, 31q và ký tự trong dấu nháy;
  biểu thức `+ − * /`, `MOD`, `AND OR XOR NOT` (`& | ^ ~`), `SHL SHR` (`<< >>`), `HIGH LOW`, ngoặc, `$` = địa chỉ
  hiện tại; toán hạng bit `P1.0`, `ACC.7`, `20h.3`, `/bit`. Lượt 1 tính địa chỉ bằng cách “dịch thử” mọi lệnh với
  `EncodeCtx.probe = true` (biểu thức = 0, không kiểm miền giá trị) nên chỉ cần một bảng mã hoá duy nhất cho cả hai
  lượt. Lỗi trả về có cấu trúc (`AsmError` = dòng + mã + văn bản) để `src/i18n/mcuText.ts` `asmErrorText` hiển
  thị bằng tiếng Việt hoặc tiếng Anh; `AsmResult.lines` là bảng dịch, `addrLine` để ánh xạ PC ↔ dòng nguồn
  (dòng đang chạy, điểm dừng).
- **Intel HEX** (`hex.ts`): đọc thẻ 00 / 01 / 02 / 04 (03 / 05 bỏ qua) có kiểm checksum và báo lỗi theo dòng, ghi
  thẻ dữ liệu 16 byte cho phần khác 0 của ảnh. `program.ts buildProgram(text)` tự nhận ra văn bản là Intel HEX
  (mọi dòng bắt đầu bằng ‘:’) hay mã nguồn hợp ngữ, nên netlister, bảng soạn mã và test dùng chung một hàm;
  `encodeImage` / `decodeImage` gói phần ảnh đã dùng thành một chuỗi `"<địa chỉ hex>:<byte hex>"` để thẻ model mang
  được (chương trình giống nhau dùng chung một thẻ).
- **Mô phỏng cùng mạch** (`src/sim/devices/digital/mcu.ts`, code model `D_MCU8051` đăng ký trong `registry.ts`):
  phần tử `A<tên> p0.0 … p3.7 rst ea [vsup] ref <thẻ>`. 32 chân cổng vừa là ngõ vào vừa là ngõ ra `openDrain`
  (P1…P3 có `pullup` 50 kΩ, P0 không) nên giống cổng hai chiều thật; tham số `pdrive` = 1 đổi sang kéo-đẩy cho
  thí nghiệm đầu tiên. **Cách hai trục thời gian gặp nhau**: mỗi lần đánh giá (behaviour có `alwaysEval`) lõi chạy
  tới đúng `io.now`, mỗi chân nhậ n giá trị của nó tại chu kỳ máy đang thực hiện (cắt ngưỡng trong bước được nội
  suy từ `io.cross`), và thay đổi ngõ ra được hỏi lịch đúng chu kỳ máy xảy ra (`io.setTime`). Vì vỏ code model
  chỉ xếp được **một** thay đổi cho mỗi chân ở mỗi thời điểm, behaviour phải bảo đảm có thời điểm đúng chỗ
  chân đổi mức: sau khi chốt, nó chụp trạng thái lõi, **chạy trước** với ngõ vào giữ nguyên cho tới khi một chân
  đổi mức hoặc hết ngân sách `ahead` (mặc định 20 000 chu kỳ), phục hồi, rồi gọi `io.wake(t)` — engine biến đó
  thành breakpoint. Chạy trước chỉ làm lại khi có ngõ vào đổi hoặc đã tới thời điểm đã dự đoán. Ở điểm làm
  việc (DC) lõi **không** chạy: các cổng ở trạng thái sau reset, nên mọi phân tích bắt đầu chương trình từ địa chỉ 0
  (`init` reset lõi).
- **Số liệu ra ngoài worker**: `Behaviour.probes()` (thêm vào hợp đồng behaviour) được `CodeModelDevice.outputs()`
  trả về nên engine biến thành biến kết quả `Mpc(A_U1)`, `Ma(A_U1)`, `Mp1(A_U1)` … (danh sách khoá ở
  `src/mcu/probes.ts` `MCU_PROBE_KEYS`; tiền tố `M` để engine không đọc chữ đầu là đơn vị). Netlister ghi mọi vi
  điều khiển đặt ở cấp gốc vào `NetlistBuildEx.mcus` (`McuBinding`: refdes, tên phần tử, văn bản chương trình,
  có bật số liệu hay không), và `live.ts neededVectors` thêm các biến đó vào danh sách ghi để chúng không bị lọc
  mất khi người dùng tự chọn biến ở thẻ Đầu ra; `needsStreaming` coi sơ đồ có vi điều khiển là cần chạy tương
  tác. Tham số đổi được lúc đang chạy (`ctrl.setElementParam`): `rx` (đẩy một byte vào bộ nhậ n nối tiếp),
  `ramview` (địa chỉ đầu của cửa sổ RAM), `reset`.
- **Linh kiện** (`src/library/catalog/mcu.ts`, `MCU_CATALOG`): `misc-digital/mcu-8051` (đủ 40 chân, số chân DIP-40 theo
  sơ đồ chân công khai, ALE / ~PSEN / XTAL1 / XTAL2 chỉ để vẽ) và `misc-digital/mcu-8051-p1` (ký hiệu gọn cho bài
  học). Tham số: `program` (có `fileImport`), `fosc`, `xram`, `pdrive`, `pullup`, `debug`, `ahead`. `LibraryPartDef.mcu`
  là dấu cho netlister. Chương trình dịch không được thì `toSpice` ném `PartErcError` mã `mcuProgram` (ERC nói rõ
  dòng nào và chỉ cách mở Trình soạn mã).
- **Giao diện** (`src/ui/mcu`, chunk riêng): `mcuModel.ts` thuần (bản ghi `McuView` dựng từ ảnh biến live hoặc từ lõi
  riêng của bảng, cờ PSW, ánh xạ dòng ↔ địa chỉ, điểm dừng, `TerminalDecoder` giải mã byte đã phát từ bộ đếm +
  vòng 4 byte, `StandaloneRun` chạy riêng), `McuPanel.tsx` (bảng), `McuViews.tsx` (các thẻ xem), `PldWizard.tsx`.
  Hai cách chạy: **cùng mạch** (đọc biến của lõi đã mô phỏng — Chạy / Tạm dừng là nút chung của ứng dụng) và
  **chạy riêng** (lõi của bảng, không có mạch, mọi chân đọc mức 1 — đây là chế độ có từng lệnh F11, từng dòng F10
  và điểm dừng). Lệnh `simulate.mcuEditor` (Mô phỏng > Trình soạn mã vi điều khiển), nhấp đúp vào linh kiện
  (`InteractionHost.openMcuEditor`) và menu chuột phải cũng mở được.
- **Logic lập trình được**: `logicExpr.ts` xuất thêm cây biểu thức (`LogicNode`, `CompiledOutput.node` / `oeNode`)
  để `src/model/hdl.ts` sinh VHDL-93 / Verilog-2001 **từ cùng chương trình mà code model `D_PLD` chạy** (ngõ ra tổ
  hợp thành một phép gán, ngõ ra có thanh ghi thành process / always theo sườn lên CLK, ngõ ra ba trạng thái
  thành phép gán có điều kiện; `hdlIdentifier` chuyển tên tiếng Việt thành định danh ASCII và thêm hậu tố `_s` cho
  **từ khoá** của VHDL-93 / Verilog-2001 — `HDL_RESERVED`, danh sách của hai chuẩn — nên "IN", "OUT", "input", "end"
  xuất ra hợp lệ; `hdlModule` làm duy nhất **mọi** cổng trong một lượt, không phân biệt hoa thường như VHDL (ngõ vào,
  CLK, OE, ngõ ra và tín hiệu thanh ghi `q_*`), và liệt kê những tên đã đổi trong `HdlModule.renamed`, mà trình hướng
  dẫn hiện bằng tiếng Việt và tệp xuất ra ghi thành dòng chú thích). `src/model/wizards/
  pldDesign.ts` đổi tên tín hiệu của người học thành dạng `I<k>` / `O<k>` (`translateNames`), chọn khối PLD nhỏ
  nhất vừa đủ chân (`PLD_SIZES`, thêm `pld-2x2` và `pld-16x8` vào catalogue) và dựng một trang có khối, nhãn net
  cho mọi chân đã dùng và đầu dò ở các ngõ ra. **Không xuất JEDEC** (lý do ghi trong `hdl.ts` và trong hộp thoại).
- **Mạch mẫu và bài học**: mẫu 51 (nháy LED bằng vòng trễ), 52 (đếm ra LED 7 đoạn bằng bảng mã và ngắt Timer 0),
  53 (đọc nút nhấn có chống dội), 54 (UART 9600 baud ra cửa sổ nối tiếp, có phát lại); bài học `mcu-blink`
  (`src/learn/lessons/mcu.ts`) kiểm cả cách nối LED, chương trình có dịch được và có đổi mức chân, lần chạy có
  thật sự nháy. Trang trợ giúp `mcu` và `pld` (`helpGuides.ts`), trang họ `Microcontroller` (`catalogHelp.ts`).
- **Test**: `src/mcu/cpu8051.test.ts` (cờ của ADD / ADDC / SUBB / DA, MUL / DIV, nhảy và gọi, thao tác bit, băng thanh
  ghi, luật đọc chốt / chân, số chu kỳ, thời gian ngắt định thời theo chu kỳ máy, khung UART từng bit, chụp /
  phục hồi trạng thái), `asm8051.test.ts` (byte mã hoá so với bảng dịch tay, mọi dạng toán hạng, biểu thức, mọi
  mã lỗi), `hex.test.ts` (khứ hồi, checksum, loại thẻ), `src/sim/devices/digital/mcu.test.ts` (tần số nháy LED
  mô phỏng cùng mạch đúng số chu kỳ đếm tay, sóng vuông từ ngắt Timer 0, đọc chân từ mạch, cổng hai chiều, RST,
  ~EA, biến số liệu), `src/ui/mcu/mcuModel.test.ts`, `src/model/hdl.test.ts` (văn bản VHDL / Verilog của bảng sự
  thật đã biết, và kiểm lại từng dòng bằng chính chương trình đã biên dịch), `src/model/wizards/pldDesign.test.ts`
  (mô phỏng trọn bảng sự thật trên khối do wizard đặt ra), `tests/samples-physics.test.ts` (mẫu 51 / 52 / 54).

## Sơ đồ bậc thang và mô hình cơ điện tử (vòng 3 bước 6)

- **Trang bậc thang** (`Sheet.kind = 'ladder'`, `Sheet.ladder: LadderRung[]`; kiểu tài liệu ở
  `src/ladder/types.ts`): một trang của thiết kế chứa các **bậc** thay vì linh kiện. Logic của mỗi
  bậc là **cây** `contact | compare | series | parallel` chứ không phải lưới ô — đúng như cách đọc
  một bậc ra lời (nối tiếp = VÀ, song song = HOẶC), nhờ đó thao tác sửa chỉ là "thêm nối tiếp /
  song song với phần tử đang chọn" (`src/ladder/edit.ts`, thuần, trả về cây mới cho một bước hoàn
  tác). Địa chỉ là chữ: `I0.0…I7.7`, `Q0.0…Q7.7`, `M0.0…M15.7`, `T1…T32`, `C1…C32`, `AI0…AI7`,
  thêm `T1.ET` / `C1.CV` cho tiếp điểm so sánh. Cuộn dây: thường / đảo / S / R / TON / TOF /
  CTU / CTD / RES.
- **Biên dịch** (`src/ladder/program.ts`): `compileLadder(rungs, { scan, ports })` phân giải địa chỉ
  thành chỉ số, cấp **slot** cho từng phần tử để trình soạn và chương trình đang chạy gọi tên giống
  nhau (slot tính từ số bậc: `rung · SLOTS_PER_RUNG + k`, nên tắt hay sửa một bậc không làm lệch
  slot của bậc khác), cấp một ô nhớ sườn cho mỗi tiếp điểm sườn, và trả về `LadderError[]` có số
  bậc (bậc nào lỗi thì bị bỏ khỏi chương trình, các bậc còn lại vẫn chạy). Chương trình đã biên
  dịch đi vào thẻ model dưới dạng `machsim-ladder1:<hex của JSON>`: một token duy nhất, không dấu
  cách, không ngoặc nhọn — vì trình phẳng hoá coi `{…}` là biểu thức (`flatten.ts isDelimited`) và
  vì tham số model phải xuất ra netlist SPICE rồi đọc lại được y nguyên.
- **Máy quét** (`src/ladder/machine.ts`, thuần): một vòng quét = đọc ngõ vào (ngưỡng + vùng trễ lấy
  từ chính kênh, nên mỗi mô-đun có ngưỡng riêng) → chạy từng bậc theo thứ tự trên cùng một ảnh
  (coil ghi ở bậc 1 được bậc 2 đọc thấy ngay) → ghi ảnh ngõ ra. Quét theo **chu kỳ cố định**
  (`LadderIR.scan`, mặc định 10 ms) và bộ định thời **đếm vòng quét bằng số nguyên** (`timerScans`), không cộng dồn
  số thực — mười lần cộng 0,01 chỉ cho 0,09999999999999999 — nên TON xong đúng `round(preset / scan)` vòng sau khi bậc
  có điện và `timerElapsed` bằng **đúng** preset khi xong (tiếp điểm so sánh `T1.ET = 0.1` khớp được); TOF giữ thêm
  đúng số vòng đó; CTU / CTD đếm theo sườn lên của bậc, RES đưa về giá trị đầu. Độ phân giải thời gian = một vòng
  quét.
- **Giá PLC** (`src/library/catalog/plc.ts`, `LibraryPartDef.ladderIo`): bộ điều khiển (chu kỳ quét,
  bật / tắt số liệu) và các mô-đun vào 4 / 8, ra 4 / 8, vào tương tự 2. Các part này **không có**
  `toSpice`: vì cả chương trình là một trạng thái chung, `src/model/ladderBuild.ts buildLadder` gom
  mọi mô-đun **của một cấp thiết kế**, cấp địa chỉ cho từng kênh, biên dịch các bậc của các trang bậc thang của cấp đó
  rồi dựng **một** phần tử `A_LADDER` (`pwr = 1`, nút cuối là COM của giá). `emitLevel` làm việc này cho cả cấp gốc và
  mỗi khối phân cấp / mạch con (mỗi bản đặt của khối có bộ định thời, bộ đếm, bit nhớ riêng, vì code model giữ một máy
  quét cho mỗi phần tử), nhưng chỉ cấp gốc trả `NetlistBuildEx.ladder` (`LadderBinding`) — tô sáng trực tiếp trong
  trình soạn chỉ theo chương trình ở mức trên cùng.
  ERC: `ladderNoProgram`, `ladderNoModules`, `ladderNoChannels`, `ladderCommonSplit`,
  `ladderDuplicateChannel`, `ladderRung`.
- **Code model `A_LADDER`** (`src/sim/devices/digital/ladder.ts`): mọi kênh vào (số và tương tự) là
  **ngõ vào tương tự** của vỏ code model, vì bộ điều khiển chỉ lấy mẫu một lần mỗi vòng quét — nhờ
  vậy mỗi mô-đun giữ được ngưỡng riêng. Kênh ra là tầng Thevenin tương tự (0 / `von`). Sau mỗi vòng
  quét model gọi `io.wake(vòng quét sau)` nên engine luôn có điểm thời gian đúng chỗ. Ở điểm làm
  việc không quét vòng nào (ngõ ra tắt), nên mọi phân tích bắt đầu chương trình từ vòng quét 1.
  Tải ngõ vào mặc định `rin` = 100 kΩ: không có nó, một công tắc **hở** (1 GΩ) vẫn để kênh ở mức
  nguồn và đọc ra "đang bật".
- **Số liệu ra ngoài worker** (`src/ladder/probes.ts`): `Lscan`, `Li<n>` / `Lq<n>` / `Lm<n>` (byte
  ảnh), `Lt<n>` / `Ltd<n>`, `Lc<n>` / `Lcd<n>`, `Ls<w>` (trạng thái dẫn của 24 phần tử một từ).
  `live.ts neededVectors` thêm chúng vào danh sách ghi, `controller.flushLive` gọi `ladderLive(...)`
  và đặt vào `EditorState.ladderLive`, trình soạn tô sáng theo slot.
- **Giao diện** (`src/ui/ladder/LadderSheetView.tsx`, chunk riêng; App.tsx chọn giữa khung vẽ sơ đồ
  và trình soạn bậc thang theo `Sheet.kind`): thanh công cụ (thêm bậc, nối tiếp, song song, so sánh,
  cuộn dây, xoá, lên / xuống, tắt bậc), hình vẽ SVG dựng từ `src/ladder/layout.ts` (nối tiếp = tổng
  bề rộng, song song = tổng chiều cao, nhánh ngắn được kéo dài bằng đường ngang, hai đầu nhánh nối
  bằng đường dọc), ô sửa phần tử đang chọn và dải trạng thái khi chạy. Lệnh `place.ladderSheet`
  (Đặt > Trang sơ đồ bậc thang).
- **In / xuất ảnh trang bậc thang** (`src/ui/editor/ladderSvg.ts`, thuần, không React): `ladderSheetSvg(rungs)` dựng
  **chuỗi SVG** của các bậc từ cùng `layoutLadder` và cùng các hằng hình học mà trình soạn dùng (trình soạn import
  `LADDER_COL`, `LADDER_ROW`, … từ mô-đun này, nên giấy và màn hình không lệch nhau). Màu lấy từ biến CSS của bảng màu
  xuất ảnh (`var(--wire)`, `var(--text)`, `var(--part)`) qua thuộc tính `style`, nên cùng một chuỗi in màu hoặc đen
  trắng. `sheetToSvg` (`src/ui/editor/exportImage.ts`) gắn nó vào trang như một `<g>` đã co tỉ lệ cho vừa khung
  (`ladderPlacement`), và `exportArea(..., 'content')` cắt đúng khổ của sơ đồ bậc thang — nhờ vậy In, Tệp › Xuất ảnh và
  hình xem trước của trình duyệt mạch mẫu đều thấy các bậc thay vì trang trống.
- **Mô hình cơ điện tử** (`src/mecha/models.ts` thuần + code model `A_MECHA`
  `src/sim/devices/digital/mecha.ts` + `src/library/catalog/mecha.ts`): băng tải có hai cảm biến vật
  (vật chạy đúng tốc độ đặt, tự cấp vật theo chu kỳ hoặc theo chân FEED), nút giao thông hai chiều
  **tự kiểm tra** (hai chiều cùng xanh hay một chiều tối lâu hơn `tfault` → chân ERR), bồn nước (bơm
  lưu lượng không đổi, van xả theo Torricelli `q = qout·√(V/V0)` nên bồn đầy cạn hết sau `2·V0/qout`
  giây, hai công tắc phao và cảm biến mức tương tự), cửa cuốn (công tắc hành trình, mắt thần, khoá
  chéo đếm thời gian kẹt) và thang máy ba tầng (cảm biến tầng, cửa, không chạy khi cửa chưa đóng).
  Phần tử: chân vào (ngõ vào số của vỏ, có tải `rin` nên chân đèn là tải thật), chân cảm biến (tầng
  tương tự 0 / `vout`, hoặc `vref` × tỉ lệ đo), và **nút nội bộ báo trạng thái** (1 V mỗi đơn vị:
  `V(TK1.percent)`, `V(MD1.pos)`, `V(ML1.floor)`, `V(MB1.travel)`) nên vẽ được trong Grapher.
  `bindIndicator` trả về đúng thứ tự chân vào → chân cảm biến → nút báo cáo, và
  `indicator.kind = 'mecha'` (`scene`, `slots`, `screen`) cho `src/ui/editor/mechaGlyphs.tsx` vẽ
  chuyển động trên sơ đồ. Model tiến một bước ở mỗi điểm thời gian được chấp nhận và chỉ giữ **một**
  yêu cầu `wake` (cách `tmax`, mặc định 10 ms) để không làm đầy danh sách breakpoint.
  `PinDef.type` lấy theo **vai trò trong model**, không theo cạnh vẽ: tên nằm trong `spec.inputs` là
  `input`, chân cảm biến / báo cáo là `output`, `COM` là `power`. Sáu chân đèn của nút giao đều là
  ngõ vào dù ba chân nằm bên phải thân, nếu đánh theo cạnh thì ma trận loại chân ERC (bước 7) coi
  chúng là nguồn thứ hai tranh với ngõ ra PLC đang thắp đèn.
- **Mạch mẫu và bài học**: mẫu 55 (khởi động / dừng động cơ tự giữ), 56 (đèn giao thông bằng một bộ
  định thời vòng và sáu tiếp điểm so sánh), 57 (điều khiển mức nước hai điểm + báo động tương tự) —
  chủ đề mới `automation`; bài học `ladder-start-stop` (`src/learn/lessons/ladder.ts`) kiểm giá PLC,
  nối dây, chương trình dịch được và **chạy chính chương trình của người học** trong máy quét để
  chứng minh bậc có tự giữ. Trang hướng dẫn `ladder` và `mecha` (`src/i18n/ladderHelp.ts`).
- **Test**: `src/ladder/program.test.ts` (địa chỉ, slot, mọi mã lỗi, khứ hồi văn bản thẻ model),
  `machine.test.ts` (bảng chân lý tổ hợp, thứ tự quét, tự giữ, S / R, sườn, TON / TOF đúng giây,
  CTU / CTD, ngưỡng kênh có vùng trễ, số liệu ra), `layout.test.ts` + `edit.test.ts` (hình vẽ và
  thao tác sửa khớp slot của trình biên dịch), `src/model/ladderBuild.test.ts` (một phần tử cho cả
  giá, ERC, chạy quá độ: tự giữ, TON, công tắc hở), `src/mecha/models.test.ts` (so với công thức:
  `2·V/q` của Torricelli, thời gian hành trình, tốc độ băng), `src/library/catalog/mecha.test.ts`
  (máy trong mạch thật, và một chương trình bậc thang giữ bồn nước giữa hai công tắc phao),
  `tests/samples-physics.test.ts` (mẫu 55–57).

## Công cụ sơ đồ chuyên nghiệp (vòng 3 bước 7)

Sáu nhóm công cụ mà người học gặp khi sơ đồ lớn dần: ERC chặt chẽ hơn, thuộc tính theo net, chụp hình
một vùng, tuỳ biến phím tắt, trình sửa ký hiệu mạnh hơn và danh mục chân vỏ.

- **Ma trận loại chân ERC** (`src/model/ercMatrix.ts`): `PinType` của `src/library/types.ts` được mở rộng
  thêm `tristate`, `open-collector`, `power-in`, `power-out` (`power` cũ = `power-in`, `normalizePinType`
  chuẩn hoá nên tệp và part cũ vẫn chạy). `DEFAULT_PIN_MATRIX` chỉ bắt những cặp thật sự sai (hai ngõ ra
  đẩy–kéo: lỗi; ngõ ra ↔ nguồn ra: lỗi; ngõ ra trên đường ba trạng thái / cực thu hở: cảnh báo), nên bật
  mặc định không làm người học ngập cảnh báo. `Design.erc` (`ErcSettings`) ghi đè từng ô, tắt cả phép
  kiểm tra, và chọn cách nối chân nguồn ẩn. `checkPinTypes(nets, {settings, prefix})` trả về `ErcMessage`
  mã mới `'pin-type'`; netlister gọi nó cho mọi cấp thiết kế (`pinTypeNets`), **bỏ qua net nguồn / đất**
  vì nhiều chân nguồn trên một đường VCC là bình thường.
- **Dấu không nối (NC)**: `PartInstance.ncPins` (mảng tên chân, có trong `.msim` và XML). Chân được đánh
  dấu không còn cảnh báo `floating-pin`; nếu lại có dây thì báo lỗi `ncPinConnected`. Sửa › Dấu không nối
  (NC) và menu ngữ cảnh của linh kiện mở hộp thoại; scene vẽ dấu × nhỏ (`.ms-nc-mark`).
- **Chân nguồn ẩn**: `hiddenPowerMode(erc, digital)` gộp tuỳ chọn ERC với chế độ mô phỏng số thành
  `'auto' | 'ideal' | 'required'`; netlister truyền xuống `ToSpiceContextExt.hiddenPower` và
  `powerNodes` (`src/library/parts/digital/kit.ts`) dùng nó trước khi xét `Design.digital`.
- **Phạm vi xoá dấu và báo cáo ERC** (`src/model/ercReport.ts`): `ErcScope` = all / sheet / errors /
  warnings / selection với `keepMarkers` / `deleteMarkers`; `ercReportTable` và `ercReportText` dựng báo
  cáo (văn bản / CSV / HTML qua `reportFormat.ts`) với lời giải thích tiếng Việt của từng phát hiện —
  module thuần, chữ do giao diện truyền vào (`ErcReportTexts`).
- **Cài đặt net** (`src/model/netSettings.ts`): `Design.nets` theo tên net (so không phân biệt chữ hoa),
  mỗi net có màu dây, ghi chú, và thuộc tính PCB (lớp net, bề rộng vết, khoảng cách, lớp đi dây, đơn vị
  mm). `applyNetColor` tô mọi dây của net, `renameNetSettings` theo khi đổi tên, `pcbNetLookup` cấp dữ
  liệu cho xuất netlist: netlist kiểu KiCad ghi thêm `(class …) (width …) (clearance …) (layer …)` trong
  từng net (phần mở rộng của MachSim, công cụ khác bỏ qua được).
- **Chụp vùng trên trang** (`src/ui/schematicTools/capture.ts`): công cụ `{ kind: 'capture' }` kéo một
  hình chữ nhật (dùng lại rubber band của `interaction.ts`), `sheetToSvg` nhận tuỳ chọn `rect` mới nên
  ảnh đúng vùng đó, rồi `navigator.clipboard.write` (ClipboardItem PNG) hoặc lưu tệp PNG khi trình duyệt
  không cho phép.
- **Tuỳ biến giao diện** (`src/ui/app/customize.ts`): `UserShortcuts` (lệnh → tổ hợp phím, '' = tắt)
  với `parseChord` / `formatChord` / `chordKey`, `checkChord` (từ chối chữ đơn, Ctrl+C/V/X/A/Z),
  `shortcutRows` / `shortcutConflicts` (phát hiện trùng theo phạm vi phím) và `applyUserShortcuts`, cài
  vào lớp người dùng của `shortcuts.ts` (`setUserBindings` → `activeBindings`), nên menu và tooltip cũng
  đổi theo. `TOOLBAR_GROUPS` bật / tắt từng nhóm nút; cả hai lưu trong `UiState.shortcuts` / `.toolbar`.
- **Ký hiệu nhiều phần** (`src/model/sections.ts`, `src/library/sectionKit.ts`): mỗi phần là một part
  riêng với `LibraryPartDef.pkg = { id, section, sections }` và **tên chân là tên chân của cả vi mạch**
  ('2A', '2B', '2Y'), nên gộp các phần lại là có ngay bản đồ chân của vi mạch. Các phần dùng chung tên
  linh kiện (U1A … U1D): `packageGroups` nhóm theo refdes, netlister chỉ cho phần đầu tiên phát ra vi
  mạch (`packagePins` trong ctx, `packageFragment` nối chân của những phần chưa đặt vào node riêng + 1 TΩ),
  `checkDuplicateRefdes` miễn cho chúng còn `sectionIssues` báo trùng phần / trùng tên khác vi mạch,
  `packageParts` gộp lại cho BOM / PCB / báo cáo nên "Cổng còn trống" liệt kê phần chưa dùng.
  79 part phần (`src/library/parts/digital/sectionParts.ts`) cho 18 vi mạch cổng 74xx / 4000.
- **Trình sửa ký hiệu**: thêm công cụ cung tròn (`arcPrim`), chọn nhiều (`targetsInRect`,
  `moveTargets`, `deleteTargets`), chép / dán (`copyTargets`, `pasteFragment`, chân dán vào được đặt tên
  mới) và tay nắm đổi cỡ (`targetHandles`, `resizeTarget`) trong `src/ui/parts/symbolEditModel.ts`.
- **Danh mục chân vỏ** (`src/library/footprints.ts`): 210 chân vỏ với số chân, bước chân, cỡ thân (mm) và
  `footprintOutline` (vị trí chân hàn + thân) để vẽ hình 2D; `footprintPinCheck` cảnh báo khi số chân
  không khớp. Dùng ở Công cụ › Danh mục chân vỏ và ở bước Chân vỏ của Trình tạo linh kiện. Kích thước lấy
  từ hình dạng vỏ công bố công khai (JEDEC / IEC / EIA, lưới 2.54 mm), làm tròn đến 0,1 mm.
- **Trợ giúp**: 4 trang hướng dẫn mới (`ercTools`, `netSettings`, `customizeUi`, `footprints`) trong
  `helpGuides.ts`; chữ hộp thoại trong `src/i18n/schematicToolsText.ts` (nạp cùng chunk), nhãn lệnh trong
  `src/i18n/messages/schematicTools.ts`.
- **Test**: `src/model/ercMatrix.test.ts` (chuẩn hoá loại chân, mọi cặp ma trận, ghi đè, dấu NC),
  `ercNetlist.test.ts` (hai ngõ ra nối nhau trên sơ đồ thật, net nguồn được miễn, dấu NC trong netlist,
  chân nguồn ẩn ở cả ba chế độ), `ercReport.test.ts` (phạm vi xoá, bảng và văn bản báo cáo),
  `netSettings.test.ts` (lưu / gộp / đổi tên, tô màu dây, lớp net, khứ hồi tệp, và các trường trong
  netlist KiCad), `sections.test.ts` (một vi mạch cho nhiều phần, mô phỏng chuỗi hai cổng, BOM / PCB /
  cổng còn trống, lỗi trùng phần), `src/library/footprints.test.ts` (dữ liệu, hình chân hàn, bao phủ mọi
  tên chân vỏ của thư viện), `src/ui/app/customize.test.ts` (đọc / ghi tổ hợp phím, trùng phím, cài vào
  bộ xử lý phím), `src/ui/parts/symbolEditModel.test.ts` (cung tròn, chọn nhiều, chép / dán, tay nắm).

## Trải nghiệm người học (vòng 3 bước 8)

**Chế độ người mới** (`src/ui/app/beginner.ts`, thuần, có test) là một **bộ lọc** đặt trên mô hình giao diện sẵn có, không phải một giao diện thứ hai:

- `BEGINNER_COMMANDS` là danh sách **cho phép** 54 lệnh cần cho mạch đầu tiên (mở / lưu, clipboard, phóng, đặt linh kiện và dây, đầu dò áp / dòng, Chạy, ERC, toàn bộ menu Trợ giúp). Lệnh nào không có trong danh sách thì bị ẩn — kể cả lệnh thêm về sau, nên mặc định an toàn là "gọn".
- `beginnerMenus(buildMenus(ctx), on)` lọc cây menu: bỏ menu Báo cáo, bỏ mục có `id` không được phép, bỏ submenu mà mọi mục lệnh đều bị ẩn (submenu dựng từ dữ liệu — tệp gần đây, danh sách trang, chủ đề, ngôn ngữ — không có `id` nên vẫn còn), rồi dọn dấu phân cách đầu / cuối / trùng. Để làm được việc đó, `MenuEntry` có thêm `id?` (chỉ thêm) và `menus.ts` gán `id` cho mọi mục chạy lệnh cùng `analysis.<type>` cho danh sách phép phân tích.
- `beginnerAnalyses(all, on, keep)` giữ bốn phép phân tích (OP, quá độ, AC, quét DC) **cộng** phép phân tích mà tệp đang mở dùng, nên bộ chọn không bao giờ hiện giá trị trống.
- `beginnerToolbar(prefs, on)` tắt ba nhóm nút nâng cao mà **không** ghi vào tuỳ chọn của người dùng: tắt chế độ là thanh công cụ trở lại đúng như họ đã đặt.
- Trạng thái nằm ở `UiState.beginner` (lưu trong tuỳ chọn, `prefs.ts`), lệnh `options.beginnerMode`, ô "Người mới" trên `StatusBar`, và bảng chào hỏi mời chọn một lần (`WelcomePrefs.beginnerAsked`).

**Bài học do giáo viên soạn** (`src/learn/lessonFile.ts`): một bài học dựng sẵn viết phép kiểm tra bằng TypeScript, điều giáo viên không làm được. Tệp bài học vì thế **mô tả** phép kiểm tra bằng bốn loại đủ cho bài thực hành — `part` (có đủ n linh kiện loại nào), `connected` (chân của loại linh kiện này cùng net với chân của loại kia, hoặc với đất), `measure` (số đo của đồng hồ / net có nhãn / linh kiện nằm trong dung sai `tolerancePct`, hoặc trong dung sai tuyệt đối `toleranceAbs`; mục tiêu **0** được kiểm bằng ngưỡng tuyệt đối `ZERO_TOLERANCE` = 1 µ của `src/learn/kit.ts`, vì phần trăm của 0 là 0 và mạch thật trả về vài nanovolt) và `erc` (mạch sạch lỗi) — rồi `compileLessonFile` dịch chúng thành một `LessonDef` thật, chạy bởi đúng `src/learn/runner.ts` như bài dựng sẵn. Nhờ vậy bài của giáo viên có đủ trạng thái từng bước, phản hồi có số, gợi ý, tiến độ. Tệp mang theo mạch khởi đầu và lời giải dưới dạng `.msim`, nên "Bắt đầu bài" và "Xem lời giải" vẫn hoạt động. `src/ui/learn/customLessons.ts` giữ danh sách tệp trong bộ nhớ trình duyệt và nạp vào `setCustomLessons` của `src/learn/lessons`; `allLessons()` / `lessonTextOf()` là hai hàm bảng Bài học đọc thay cho `LESSONS` / `LESSON_TEXT`.

**IC thật trong bài học** (`src/learn/gates.ts`): bài học không được buộc người học dùng ký hiệu một cổng. `gateUnits` / `flipflopUnits` nhóm chân theo số phân đoạn đứng đầu tên chân (`2A` → phân đoạn 2), nên một vỏ 7408 cho bốn cổng và một cổng rời `7408-a` cho một cổng, cùng một mã. `pickGate` / `pickFlipflop` chọn **đúng cổng người học đã nối** (ưu tiên cổng có cả ngõ vào và ngõ ra nối), `logicIds('08', …)` liệt kê mọi họ 74 cộng cổng rời, và `heldAsync` giải thích chân `~PRE` / `~CLR` bị nối đất (chỉ chân tác động mức thấp; `SET` / `RESET` tác động mức cao của ký hiệu dạy học và của 4013 không bị tính).

**Mười bài học mới** (`src/learn/lessons/round3.ts`, text `src/i18n/lessons/round3.ts`) dùng tính năng của vòng này: tụ không lý tưởng cộng hưởng, khối trễ Schmitt, khối hàm truyền H(s), một vỏ 7408 dùng hai cổng, flip-flop 7474 thật, 8051 đọc nút nhấn, đèn giao thông bậc thang, và cấp mới **workflow** ("Kỹ năng dùng MachSim") gồm dùng lại một tầng mạch, phương án lắp ráp và phép đo `.meas`. Lời giải mẫu vẽ bằng nhãn net (`labelPin`) nên ngắn và đọc cùng cách với phép kiểm tra; chân của phân đoạn không dùng được đánh dấu NC để lời giải sạch ERC.

**Dọn chữ tiếng Anh còn sót**: hộp thoại "còn thay đổi chưa lưu" gọi `unsavedChangesMessage(fileName, action)` nên hiện đúng tên người học thấy trên thanh tiêu đề ("Chưa đặt tên.msim"); dòng kỹ thuật tiếng Anh của bộ giải và của ERC nằm sau `<details class="ms-tech">` mang nhãn "Chi tiết kỹ thuật"; và mạch mẫu mở bằng **bất kỳ** đường nào (File > Mở, kéo thả, Explorer, danh sách gần đây) cũng được đổi tên sang ngôn ngữ giao diện nhờ `registerOpenTransform` (`document.ts`) + `src/ui/integration/sampleLocalize.ts`. Hàm biến đổi lúc mở là **async**, và nó chỉ nạp bảng tên mạch mẫu khi tên tệp trông giống mạch mẫu (`\d\d-slug.msim`), nên mở một thiết kế thường không tốn gì.

**Trợ giúp**: trang hướng dẫn `whatsNew` ("Có gì mới") tóm tắt vòng 2 và vòng 3 cho người học, lệnh `help.whatsNew`; Bắt đầu nhanh có thêm bước 0 về chế độ người mới và bước 15 nói về trình soạn bài học.

## Lớp toàn vẹn dùng chung và nhất quán giữa các tính năng (vòng 4 bước 1)

MachSim có rất nhiều đường đưa mạch vào thiết kế đang mở. Mỗi đường đều đúng khi đứng một mình; cái hay vỡ là **hai
tính năng gặp nhau**: một snippet lấy từ bản mạch có phương án lắp ráp, dán vào thiết kế có phương án khác, rồi đánh số
lại, rồi lưu — và tệp không mở lại được nữa, vì `validateDesign` từ chối id phương án không có thật.

- **Một mô-đun duy nhất** (`src/model/sanitize.ts`, thuần, không biết UI / i18n / thư viện) nhận mọi **tham chiếu chỉ có
  nghĩa trong thiết kế nguồn**: id phương án lắp ráp (`PartInstance.notFitted`, `Design.variants.active`), tham số toàn
  cục (cả ba cách viết mà `src/model/variables.ts` đánh giá), cài đặt theo net (`Design.nets`), linh kiện người dùng
  (`custom:…`), mạch con của khối (`hier:…`), mô hình thay thế (`modelOverride`), tên linh kiện của vỏ nhiều phần, ô ma
  trận loại chân ERC, địa chỉ bậc thang, tham chiếu thư viện (`Design.libraryRefs`) và đầu dò tham chiếu
  (`Probe.refProbe`). Ba hàm cho ba hình dạng đầu vào:
  - `sanitizeIncoming(target, fragment, extras)` — một **đoạn mạch** vào thiết kế đang mở (dán, snippet, mạch do trình
    hướng dẫn sinh ra). Id phương án được **chuyển theo TÊN** khi thiết kế đích có phương án cùng tên và bị **bỏ** khi
    không có; những gì đoạn mạch cần (tham số toàn cục theo bao đóng, linh kiện người dùng, văn bản mô hình SPICE, cài
    đặt của các net nó mang) trả về riêng để người gọi áp trong **cùng một bước hoàn tác**.
  - `sanitizeIncomingSheets(target, sheets, extras)` — **cả trang** vào thiết kế (một `.msim` thành khối phân cấp).
  - `sanitizeDesign(design)` — **cả thiết kế** vào chương trình (nhập KiCad / EDIF / XML, mẫu, gói dự án, tệp bài học):
    làm các tham chiếu của chính nó nhất quán với nhau. Trả về **đúng object cũ** khi không phải sửa gì.
  - `repairRawDesign(raw)` / `validateDesignSafely(raw)` / `parseDesignSafely(text)` — **tệp đang mở**. Tệp lành đi đường
    kiểm tra nghiêm ngặt (`parseDesign`) nên khứ hồi y nguyên từng byte; tệp có tham chiếu lạ được sửa rồi **vẫn mở**
    kèm ghi chú thay vì bị từ chối. Hỏng về cấu trúc (một `rotation` 45°) vẫn là lỗi, vì đoán ở đó sẽ âm thầm đổi mạch
    của người học.
- **Ghi chú** là dữ liệu (`SanitizeNote`: mã, số lượng, vài cái tên); `src/i18n/sanitize.ts` `sanitizeReport(notes)` biến
  nó thành một đoạn tiếng Việt / tiếng Anh, nên mọi đường vào báo cùng một cách
  (`actions.addSimMessage('warning', …, t('sim.source.integrity'))`). Khoá catalogue `sanitize.<mã>` ở
  `src/i18n/messages/files.ts`.
- **Mọi đường vào đã đi qua lớp này**: `pasteItems` (và `Clipboard.extras` do `clipboardExtras` dựng, nên dán sang thiết
  kế **khác** không còn mất tham số toàn cục), `actions.insertSnippet`, `childFromDesign` (khối từ tệp — trước đây mất
  `customParts` và mang theo id phương án lạ), `unpackProject`, `parseTemplateFile` / `designFromTemplate`,
  `xmlToDesignSafely`, `importedToDesign`, `src/learn/lessonFile.ts`, `loadDesignText`, `SampleBrowser`,
  `src/desktop/batch.ts`.
- **Tầng test bất biến chéo tính năng** (`tests/review/round4/invariants.test.ts`): dựng lại 62 mạch mẫu và mọi lời giải
  / mạch khởi đầu của bài học, rồi chạy các **chuỗi ngẫu nhiên có hạt giống cố định** (mulberry32, hạt giống 1 / 7 /
  20250418) gồm dán, khứ hồi snippet, khứ hồi XML, đổi phương án, Đánh số, Đánh số lại, Tìm & thay, loại khỏi mô phỏng;
  sau **mỗi** bước kiểm bốn bất biến của một thiết kế lưu được: (1) lưu rồi mở lại được và tệp bền qua khứ hồi,
  (2) netlister dựng được netlist, (3) tên linh kiện duy nhất **theo vỏ** (hai part chung một tên chỉ hợp lệ khi là hai
  phân đoạn khác nhau của cùng một vi mạch), (4) không còn tham chiếu treo nào. Ba test "kiểm chính phép kiểm" chứng
  minh phép kiểm bắt được đúng những lỗi ấy.

**Nhất quán chế độ người mới** (`src/ui/app/beginner.ts`): chế độ người mới là một **bộ lọc trên cả giao diện**, nên
`beginnerEntries(items, on)` lọc cả menu chuột phải của khung vẽ và menu chọn loại đầu dò (các mục chạy lệnh nay đều có
`id`); phím tắt của một lệnh bị ẩn không mở hộp thoại nữa mà nói rõ lệnh đó là gì và cách bật giao diện đầy đủ
(`beginner.hiddenCommand`). `resolveMenuPath(path, menus)` / `menuPathsIn(text, menus)` phân giải một **đường menu viết
trong chữ** ("Công cụ › Quản lý phương án", "Đặt → Trang sơ đồ bậc thang") thành id lệnh: tên menu đầu phải khớp **đúng
từng chữ** (nên "nhóm Nguồn → Nguồn điện" không bị coi là đường menu), các đoạn sau khớp theo **số từ đầu trùng nhau**
(nên "Quản lý phương án → “Thêm phương án”" vẫn tìm ra, cũng như "Danh sách vật tư (BOM)…"). Bài học nào nhắc một lệnh
bị ẩn thì trang bài học hiện một dòng kèm nút **“Bật chế độ đầy đủ”** (`src/ui/learn/fullMode.tsx`,
`lessonHiddenCommands`). `tests/review/round4/beginner-menu-paths.test.ts` phân giải mọi đường menu của mọi bài học ở cả
hai ngôn ngữ; nhờ nó ba đường viết sai trong bài học đã được sửa.

**Cài đặt net đi theo net** (`src/model/netSettings.ts` `applyNetColors` / `mergeNetSettings`,
`src/ui/store/netColors.ts`): `followNetColors(design, lookup)` chạy trong `commit` của editor store (và khi mở thiết
kế) và tô màu của net cho **mọi** dây của net đó, ở cả trang gốc và trang của mạch con — nên dây vẽ thêm vào net sau đó
cũng có màu. Hàm trả về đúng object cũ khi `Design.nets` không có màu nào, nên thiết kế chưa bao giờ mở hộp thoại không
tốn gì. Đổi tên nhãn cuối cùng của một net mang cài đặt sang tên mới (`renameNetAcrossSettings`; gộp khi tên mới đã có
cài đặt, trường của net được đổi tên thắng).

**Tệp cũ và Cập nhật linh kiện** (`src/ui/store/libraryUpdate.ts`): `stampLibraryRefsAtLoad` đóng dấu
`Design.libraryRefs` **trong bộ nhớ** khi mở một tệp chưa có trường ấy (đăng ký bằng `registerOpenTransform` trong
`App.tsx`), và `compareWithLibrary` luôn đọc cả **tham số thật sự nằm trên các linh kiện đã đặt**
(`instanceParamChanges`): một khoá tham số mà thư viện hiện tại không còn khai báo là một khác biệt thật, nên tệp cũ của
giáo viên báo đúng chứ không báo "không có gì".

**Các khoảng trống khác đã bù**:
- **Dự án / tệp gần đây trong bản trình duyệt**: `src/ui/app/files.ts` thêm `RecentProject` + `pushRecentProject` /
  `readRecentProjects` / `writeRecentProjects` (khoá `machsim.recentProjects.v1`, trần 400 000 ký tự: bản chụp của entry
  cũ bị bỏ trước, tên dự án luôn còn). `projectDialogs.rememberProject` ghi lại mỗi lần mở / tạo dự án, và
  `openRecentProjectFlow` nhận đường dẫn (desktop) hoặc tên dự án (trình duyệt, dựng lại từ bản chụp).
- **Thông tin tệp đếm sơ đồ bậc thang**: `DesignInfo.ladder` (`ladderInfo`) — số trang, số bậc, bậc đang tắt, tiếp điểm,
  cuộn dây / bộ định thời / bộ đếm và số địa chỉ PLC khác nhau (T1 và T1.ET là một địa chỉ).
- **`.oecl` / `.mspc` / `.pcb`**: đã có hộp giải thích nhưng chưa có trong `OPEN_ACCEPT` / `BINARY_OPEN_RE` / `OPENABLE`
  / `EXPLAIN_ONLY`, nên tệp bị bỏ qua không nói gì; nay mở hoặc kéo thả đều đến được hộp giải thích.
- **ERC ngõ vào không có gì lái** (`src/model/ercMatrix.ts` `checkUndrivenInputs`, `Design.erc.undrivenInputs`): net mà
  **mọi** chân đều là ngõ vào (không ngõ ra, không chân thụ động, không chân nguồn; net nguồn / đất được miễn) là cảnh
  báo kèm giải thích tiếng Việt — lý do thường gặp khiến mạch số đầu tiên "không làm gì".
- **Loại chân ba trạng thái / cực thu hở trên catalogue 74xx**: `logicKit.ts` `outputPinType` và `ttl.ts`
  `withOutputType` suy ra loại chân từ tầng ra đã khai (`LogicSpec.output` / `TtlSpec.output`) cho **mọi họ** cùng lúc,
  nên các dòng ấy của ma trận ERC mới thật sự hoạt động: hai ngõ ra 7403 trên một điện trở treo là cách nối đúng, hai
  ngõ ra 7400 chập nhau là lỗi, ngõ ra đẩy–kéo gặp đường bus 74125 / 74244 là cảnh báo.
- **Test**: `src/model/sanitize.test.ts`, `src/ui/store/netColors.test.ts`, `src/ui/store/libraryUpdate.test.ts`,
  `src/ui/app/files.test.ts`, `src/model/fileInfo.test.ts`, `src/model/ercNetlist.test.ts`,
  `tests/review/round4/{invariants,beginner-menu-paths,logic-pin-types}.test.ts`.

## Nhiều thiết kế mở cùng lúc, in và các lệnh sửa (vòng 4 bước 2)

### Thẻ tài liệu (`src/ui/app/documents.ts`, `documentSet.ts`, `DocumentTabs.tsx`, `documentFlows.ts`)

- **Một kho soạn thảo, nhiều tài liệu.** `editor` (`src/ui/store/index.ts`) vẫn chỉ giữ MỘT tài liệu đang mở: mọi hành động sửa, canvas, bộ điều khiển mô phỏng và hộp thoại làm việc trên nó,
  nên không chỗ nào khác phải biết "tài liệu". Bộ quản lý (`createDocumentManager({ editor, blank })`, thuần, không DOM) cất các tài liệu còn lại thành ảnh chụp
  `DocumentState` (`src/ui/store/types.ts`: `design`, `savedDesign`, `fileName`, `activeSheetId`, `selection`, `views`, `history`, `ercMarkers`, `simMessages`, `probeValues`,
  `indicatorLevels`, `ladderLive`, `ratingStates`, `sim`) và đổi vào kho khi chọn thẻ (`editor.actions.captureDocument` / `restoreDocument` / `makeDocument`). Bố cục, bộ nhớ tạm,
  công cụ và `ui` dùng chung cho mọi tài liệu (bộ nhớ tạm dùng chung chính là cách dán sang thiết kế khác).
- **Phần của tài liệu nằm ngoài kho** đăng ký `DocumentExtension { id, capture, restore, beforeLeave? }` (`documents.registerExtension`): vị trí tệp (`document.ts`, mở đầu tệp),
  kết quả mô phỏng và lịch sử chạy (`controller.documentState()` / `restoreDocumentState()`, đăng ký trong `integration/index.tsx`; `beforeLeave` = `stopForDocumentSwitch()` dừng phiên đang chạy
  trước khi đổi), trang Grapher (`GrapherWindow.tsx`, `grapherDoc`). `restore(undefined)` = tài liệu mới tinh. Mã số lần chạy vẫn tăng đơn điệu qua mọi tài liệu.
- **Quy tắc**: thiết kế mới vào thẻ mới; tài liệu hiện tại "nguyên sơ" (chưa sửa, chưa lưu dưới tên, trống, `setReplaceable()` của lớp tệp cho phép) bị thay thế; File > New luôn thêm thẻ;
  tối đa `MAX_DOCUMENTS` = 16 (`open()` trả null, người học được báo); luôn còn ít nhất một tài liệu; mọi chuyển đổi chạy nối đuôi nhau (`serial`).
  `confirmDiscardChanges()` (document.ts) giữ tên cũ cho các nơi gọi nhưng nay chỉ từ chối khi hết chỗ; `presentDesign()` là chỗ duy nhất đưa thiết kế vào thẻ (mở tệp, thiết kế sinh ra, khôi phục).
- **Đóng / lưu**: `documents.close(id, host)`, `closeAll(host, why)`, `saveAll(host)` với `CloseHost { askUnsaved, saveActive }` (hộp thoại trong `documentFlows.ts`, giả trong test).
  Huỷ hoặc lưu hỏng thì không đóng gì; Đóng tất cả và thoát hỏi MỘT lần kèm danh sách. Desktop: `main.cjs` chặn đóng cửa sổ khi còn thiết kế chưa lưu, gửi `machsim:close-request`, renderer chạy
  `quitFlow()` rồi gọi `bridge.confirmQuit()`; bản cũ của renderer không đăng ký thì vẫn có hộp hỏi cũ nhưng liệt kê tên (`setDirtyDocuments`).
- **Tự lưu / khôi phục**: một bản ghi `AutosaveRecord` giữ thiết kế chưa lưu đầu tiên ở `fileName/text` và các thiết kế khác ở `others` (`files.ts` `parseAutosave`, `recordDocuments`; đọc được bản ghi cũ).
  `buildRecoveryRecord()` / `syncRecovery()` trong `document.ts`; sau Lưu / Đóng bản ghi được ghi lại hoặc xoá theo các thiết kế còn chưa lưu.
- **Kéo giữa các thiết kế**: `InteractionHost.dragOverDocument` / `dropOnDocument` (canvasHost.ts) cho vùng chọn kéo thả lên thẻ (`data-doc-id`); kéo linh kiện thư viện dùng HTML5 DnD (`PART_DRAG_MIME`).
  `copySelectionToDocument` / `placePartInDocument` chép, chuyển sang thẻ đích và dán bằng đường dán thường nên lớp toàn vẹn và hạn chế của giảng viên vẫn áp dụng.
- **Menu / phím**: menu Cửa sổ (`MenuContext.documents` / `switchDocument`), `file.close` (Ctrl+F4, Ctrl+W), `file.closeAll`, `file.saveAll`, `window.next|previous|recent` (Ctrl+Tab, Ctrl+Shift+Tab). Chế độ người mới: `file.close`,
  `window.next`, `window.previous` được phép; menu Cửa sổ ẩn.

### In và xem trước (`src/ui/print/`)

- `printLayout.ts` (thuần, số học): `PageSetup`, `paperSizeMm`, `printableArea`, `itemScale`, `tileCount`, `layoutItems(items, setup) → PrintLayout { pages, all, area, clippedItems, rangeError }`,
  `parsePageRange`, và phân trang chữ (`wrapText`, `paginateTable`, `paginateDocument`). 100 % = kích thước thật; chia tờ chỉ khi tỉ lệ là phần trăm (ô chồng `TILE_OVERLAP_MM` = 8 mm, ô cuối có thể nhỏ hơn);
  số trang tính cả các ô. `setupFromDesign` / `setupToDesign` đọc / ghi `Design.printSetup` (`marginMm`, `tile`, `footer`, `pageRange`, `customMm` thêm vào `PrintSetup`; tệp cũ mở với mặc định).
- `printModel.ts`: `PrintContent` (ảnh có kích thước thật, bảng, tài liệu) → `buildJob` → `PrintJob { items, bodies, captions }`. `printSources.ts`: `buildContents(ctx, choices)` cho trang sơ đồ / bậc thang (cùng bộ xuất
  `sheetToSvg` nên lớp ẩn được tôn trọng), vùng chọn, thiết bị đo, báo cáo (`reportTables`), bài học; cửa sổ khác góp trang qua `registerPrintContribution` (Grapher: `results/printPage.ts` vẽ từng trang ra canvas trắng).
- `PrintPages.tsx` vẽ các trang `.ms-pp` (đơn vị mm) — dùng cho cả xem trước (thu nhỏ bằng `transform`) lẫn in (`printOutput.ts` gắn vào `.ms-print-area` cùng `@page { size; margin: 0 }`, rồi
  `bridge.printPage` (hộp in Windows), `bridge.printToPdf` (ghi PDF) hoặc `window.print()`). `PrintPreview.tsx` là hộp thoại (nạp lười từ lệnh `file.print` / `file.printSetup`); chữ ở `src/i18n/printText.ts`.
  Cài đặt được lưu vào thiết kế khi in; `printPlan.ts` giữ `printSheetIds` / `instrumentSummary`.

### Lớp hiển thị, thứ tự, dán đặc biệt, tiền tố tên

- `src/model/layers.ts`: `Sheet.layers` (`grid, refdes, values, labels, netNames, pinNumbers, comments, graphics`; chỉ ghi phần khác mặc định, `netNames` và `pinNumbers` mặc định tắt).
  `SheetScene` (scene.tsx) đọc `layerVisible` nên canvas, bản xuất SVG / PNG và bản in giống nhau; `netNames` cần `wireNets` (xuất ảnh tự tính bằng `sheetWireNets`).
- `src/model/annotationOrder.ts`: `Shape.z` / `TextNote.z`; `annotationStack`, `reorderAnnotations`, `movedStack`. Không trường `z` nào thì vẽ như trước (hình rồi chữ); có `z` thì một nhóm `ms-layer-annotations`;
  mục chưa có `z` (mới thêm sau) nằm trên cùng. `hitTest` duyệt theo thứ tự này. Action `orderSelection(op)`.
- `editorStore.pasteSpecial(mode, opts)` (`keepNames` | `values` | `block`) trả `PasteSpecialResult`; `designOps.pasteValuesOnly`; `pasteItems(... { keepRefdes })` nay đặt trước mọi tên còn trống rồi mới tìm số mới.
  Dialog / thông báo ở `editingDialogs.tsx`.
- `src/model/refdesRules.ts`: `Design.refdesRules { global?, map? }`; `effectivePrefix`, `libraryPrefixOf`, `validateRules`, `applyRulesToDesign`. `annotate.ts`, `createPartInstance`, `pasteItems`, `renumberParts`, `placeBlock`,
  `replacePart` dùng `effectivePrefix(prefix, design.refdesRules)`; action `setRefdesRules(rules, rename)`.
- **Quy ước khi thêm trường mới vào tệp**: ghi sau trường cuối cùng cùng cấp trong `serialize.ts` (để khứ hồi đúng từng byte) và thêm thao tác vào mảng `OPS` của `tests/review/round4/invariants.test.ts` (đã làm cho các lệnh này).
- **Test**: `documents.test.ts`, `controllerDocuments.test.ts`, `documentTabs.test.ts`, `printLayout.test.ts`, `layers.test.ts`, `annotationOrder.test.ts`, `pasteSpecial.test.ts`, `refdesRules.test.ts`,
  `menus.test.ts`, `beginner.test.ts`, `tests/review/round4/invariants.test.ts`.
## Phần tử sống trong khối, quét tham số trên sơ đồ, `.meas` OP / TF / nhiễu (vòng 4 bước 3)

- **Mỗi bản đặt của một khối có bộ phận sống riêng.** Khối (`hier:<id>`) vẫn là MỘT thiết kế con, nhưng netlister
  (`emitLevel`) nay gắn thiết bị đo (`InstrumentBinding`), chỉ thị (`IndicatorBinding`), đầu dò (`ProbeBinding`) và chương
  trình bậc thang (`LadderBinding`) của thiết kế con bằng tên CỤC BỘ rồi `expandInstances` nhân ra cho TỪNG bản đặt: node
  qua `mapInstanceNode`, phần tử qua `mapElementName` (`V_XFG1_p` trong `XHB1` → `V.XHB1.V_XFG1_p`, đúng tên sau khi phẳng
  hoá). Tên hiển thị là đường dẫn có dấu chấm (`X2.XMM1`, `HB1.X9.XMM1`); `binding.scope = { path, local, childId }`.
  Hai bản đặt đọc điện áp RIÊNG của mình (hai multimeter ở hai khối `X1`, `X2` có biến `RB` khác nhau đọc 2,5 V và 3,75 V).
  Đầu dò trong khối đo bản đặt chứa nó (`ProbeBinding.path`; khối đặt nhiều lần thì tên đầu dò có tiền tố đường dẫn).
  Bốn cảnh báo ERC chỉ có vì chưa hỗ trợ (`instrumentInBlock`, `indicatorInBlock`, `interactiveInBlock`,
  `probeFirstInstance`) đã bỏ cùng chữ giải thích.
- **Trạng thái riêng từng bản đặt** = `PartInstance.inner` (chỉ có ở khối): `{ "S1": { "closed": "true" }, "X2/S1": … }`,
  khoá = đường refdes TƯƠNG ĐỐI so với khối cấp trên cùng (`innerKey`). Bấm công tắc, phím, chiết áp, chỉnh thiết bị đo
  trong khối ghi vào đây (`withLiveParam` / `editorStore.setInteractiveParam(refdes, param, value, path)`), thiết kế con và
  các bản đặt khác không đổi. Netlister áp `inner` lên tham số đã lưu (`emitLevel(..., overrides)`, `childOverrides`);
  hai bản đặt có trạng thái khác nhau cho hai `.subckt` (`HB_X`, `HB_X_2`: khoá của `emitChild` có thêm `overridesKey`).
  Đổi công tắc khi đang chạy KHÔNG khởi động lại: `elementValueChanges` so sánh lại trên netlist đã phẳng hoá khi netlist
  chưa phẳng khác nhau (tên phần tử `R.XHB1.S1` không phụ thuộc tên biến thể). Lưu/mở: `serialize.ts` đọc `inner`; nằm trong
  chuỗi thao tác của `tests/review/round4/invariants.test.ts` (`block copy state`).
- **Mở khối = xem một bản đặt.** `EditorState.viewPath` (đường refdes các khối từ gốc), `activeViewPath(state)` (đường còn
  hợp lệ, không thì bản đầu tiên), `openBlock` / `goToParent` / `findAndShow('X2.LED1')` / `setViewPath`; breadcrumb ghi
  refdes của bản đang xem. Giá trị sống (`indicatorLevels`, `probeValues`) khoá bằng `liveKey(path, local)` (`X2/LED1`,
  `X2/<id đầu dò>`); `SchematicCanvas` lấy đúng khoá của bản đang xem bằng `scopedLive`. Bấm / phím trên khối: `interact(…,
  path)`; phím tác động mọi bản đặt (`interactiveControlTargets` trả `path`). Cửa sổ thiết bị đo gọi theo đường dẫn
  (`resolveLiveName`, `InstrumentWindow`, `controller.instrumentParams`), tab Mô phỏng liệt kê thiết bị theo đường dẫn.
  Bậc thang trong khối: `NetlistBuildEx.ladders` (mỗi bản một `LadderBinding` có `scope`), `flushLive` hiển thị chương trình
  của bản đang xem. Phân tích phụ của thiết bị đo trong khối (Bode, mạng …) chạy trên netlist đã phẳng hoá.
- **Quét tham số trên sơ đồ — một đường chung với `.step`** (`src/model/steps.ts`, `applySteps`): Parameter sweep có
  `global: true` trên một BIẾN THIẾT KẾ (`Design.variables`) và thẻ `.step` trong văn bản SPICE riêng của thiết kế đều
  thành `ParamSweepAnalysis { global: true }`; sơ đồ ghi giá trị linh kiện thành số nên netlist được DỰNG LẠI cho từng giá
  trị (`ParamSweepAnalysis.netlists`, không lưu vào tệp) rồi chạy qua cùng `runParamSweep` với `.step param` của deck SPICE.
  Mọi loại phân tích quét được (nhãn mỗi lần chạy `Rx=1000` là chú giải của Grapher; OP/TF/… thành đường cong theo giá trị).
  Thẻ `.step` (`param` list/lin/dec/oct, phần tử, `temp`) gói quanh phân tích sắp chạy; netlister bỏ thẻ khỏi văn bản
  (`blankStepCards`, giữ số dòng) và `customStepWrapper` đọc bằng bộ đọc SPICE với biến thiết kế + `.param` được khai
  báo. Thẻ thứ hai bị bỏ qua có ghi chú, thẻ trên phân tích đã là họ đường cong có ghi chú, giá trị làm hỏng mạch báo lỗi
  (`StepMessage` → `src/i18n/steps.ts`). `.param` chỉ có trong văn bản SPICE vẫn dùng cách cũ (`ctx.source`); phân tích
  Tự định nghĩa nay truyền `source` đã áp thẻ điều khiển. Controller gọi `applySteps` trong `specFor`; dòng lệnh trong
  `batch.ts`. Biểu mẫu Parameter sweep có thêm lựa chọn "Tham số toàn cục (biến)" (`SpecContext.variables`).
- **`.meas` cho OP, TF và nhiễu**: `MeasAnalysis` có thêm `'op' | 'tf' | 'noise'`. OP / TF là MỘT điểm: `FIND <biểu thức>`
  (không cần AT) và `PARAM`; tên vô hướng của kết quả (`gain`, `rin`, `rout`, `onoise_total` …) và tên vector trần
  (`onoise_spectrum`) dùng được trong biểu thức; nhiễu đo như quét tần số (nội suy log f): `INTEG onoise_psd FROM= TO=` là
  công suất nhiễu ra. Kết quả vào `AnalysisResult.measurements`, bảng "Phép đo" của Grapher, từng bước của `.step`.
- **Bước đo của bài học chọn phân tích** (`src/learn/readings.ts`, `lessonFile.ts`): `measure.analysis` = `op` (mặc định, mọi
  tệp cũ) | `tran` (`tstop`, `reading`: final / at / peak / min / pp / rms / mean / frequency, `at`, `from`) | `ac` (`freq`,
  `reading`: mag / db / phase). Quá độ đo bằng đúng bộ `.meas` (`measureResult`), AC bằng pha-xơ của `acsingle`. Chỉ đo điện
  áp của net có nhãn hoặc trên một linh kiện (đồng hồ / dòng chỉ ở điểm làm việc: lỗi `combination`). Trình soạn bài học có
  chọn phân tích và các ô tương ứng (`ed.analysis*`, `ed.reading*`).
- **Test**: `src/model/blockLive.test.ts`, `src/ui/store/blockView.test.ts`, `src/model/steps.test.ts`,
  `src/sim/analyses/measSingle.test.ts`, `src/learn/lessonMeasure.test.ts`; `tests/review/round2/block-live-parts.test.ts` viết
  lại theo hành vi mới.
## Âm thanh, cơ điện nối bằng tên và nguồn mới (vòng 4 bước 5)

**Âm thanh** (`src/audio`, thuần trừ hai tệp nối với trình duyệt)

- `wav.ts` — codec WAV tự viết (không phụ thuộc ngoài): đọc PCM 8 / 16 / 24 / 32 bit, float 32 / 64, tiêu đề extensible, chunk lạ, tệp bị cắt; ghi PCM 8 / 16 / 24 và float32; `bytesToBase64` / `base64ToBytes`, `wavToParam` / `wavFromParam` (tệp WAV là tham số văn bản base64 của linh kiện).
- `resample.ts` — `hermiteAt` / `resampleUniform` (nội suy Hermite cubic với tiếp tuyến ba điểm, mẫu của mô phỏng thưa đều ở đâu cũng được), `PlaybackScheduler` (hàng đợi mẫu mô phỏng → khối âm thanh thời gian thực; tốc độ phát = lượng mẫu có sẵn / mức đệm, tối đa 1: mô phỏng chậm thì phát chậm lại — **kéo giãn thời gian**, mô phỏng nhanh thì bỏ phần dư), `PcmResampler` (micrô: hạ tần số bằng trung bình ô, kể cả tỉ lệ lẻ), `ToneGenerator`.
- `monitor.ts` — `AudioMonitor` (mỗi loa một `PlaybackScheduler` mỗi kênh, trộn rồi xén ±1, đọc âm lượng / tắt tiếng của linh kiện mỗi khối nên chỉnh Thuộc tính có tác dụng ngay), `PcmFeeder` (giữ luồng micrô đi trước thời gian mô phỏng 0.25 s, trả về các `ParamEdit` `pcm`), `AudioRun` (một lần chạy: loa + micrô + bộ hẹn giờ bơm), `audioState` (store cho cửa sổ Âm thanh; âm lượng chung lưu `machsim.audio.v1`). `AudioSink` và `PcmSource` là giao diện được tiêm vào: test dùng card âm thanh giả.
- `webAudioSink.ts` — card âm thanh qua Web Audio: xếp liên tiếp các `AudioBufferSourceNode` trên đồng hồ của context (không dùng ScriptProcessor). `input.ts` — `InputBuffer`, `ToneSource` và `openInput` (xin quyền micrô; ghi âm bằng AudioWorklet dựng từ Blob, dự phòng ScriptProcessor; bị từ chối / không có thì sóng thử và trạng thái `denied` / `unavailable`). `host.ts` nạp theo nhu cầu từ bộ điều khiển, `audioBackend` là chỗ tiêm cho test. `export.ts` — `traceToWav` (Grapher › Xuất WAV…), `wavParam.ts` — nhập tệp WAV cho linh kiện (mono 16-bit, ≤ 16 kHz, ≤ 240 000 mẫu).
- Nối vào mô phỏng: `SimulationIntegration.startAudio` (chỉ khi thiết kế có loa hoặc micrô: `import('../../audio/host')`) → `AudioRun.chunk(chunk, simTime)` ở mỗi gói `onChunk`, `setPaused` theo trạng thái phiên, đóng khi phiên kết thúc. `needsStreaming` coi micrô như một lý do để chạy tương tác.
- **Micrô trong engine**: phần tử `V` có tham số `pcmfs` (`src/sim/devices/linear/sources.ts`) nhận `setParam('pcm', mẫu)`; mẫu k nằm ở thời điểm k / pcmfs, nội suy tuyến tính, giữ giá trị cuối khi hết mẫu, mỗi thời điểm mẫu là một breakpoint, chỉ giữ ~2 s lịch sử; `setParam('pcmreset')` làm rỗng. Linh kiện `sources/microphone` = nguồn stream ±1 + VCVS hệ số `gain` (phần tử `V<ref>_mic`).
- UI: lệnh `simulate.audio` (Mô phỏng › Âm thanh…, có trong chế độ người mới) mở cửa sổ nổi `audio` (`AudioPanel.tsx`, nạp lười): âm lượng chung, tắt tiếng, vạch mức, thông báo "mô phỏng chậm hơn thời gian thực: ×0.4", từng loa, trạng thái micrô. Chữ ở `src/i18n/audioText.ts` (bảng lười) và `messages/audio.ts` (nhãn menu). Thuộc tính tệp WAV: `ParamDef.binaryImport = 'wav'` → `WavField.tsx`.

**Cơ điện nối bằng tên** (`src/library/catalog/relays.ts`, `protection.ts`, `lineMagnetics.ts`)

- `LibraryPartDef.contactLink`: `{ role: 'driver' }` (cuộn rơ-le / công-tắc-tơ / thời gian, rơ-le nhiệt, khởi động từ) xuất nút trạng thái `<refdes>.st` ∈ 0 … 1 (đóng ở 0.75, nhả ở 0.1 như rơ-le một linh kiện); `{ role: 'contact', param: 'coil' }` (tiếp điểm) theo nút đó. Netlister dựng bảng `linkTargets` cho mỗi cấp thiết kế (mọi trang, bỏ phần loại khỏi mô phỏng) và đưa vào `ToSpiceContextExt.linkTarget(name)` / `warn(id, params)`; `followDriver(ctx, tên)` trong `partkit.ts` là chỗ duy nhất dùng chúng. Thiếu cuộn → cảnh báo ERC `contactNoCoil` / `contactNotCoil` / `contactNoName` (chữ ở `messages/erc.ts`), tiếp điểm nằm ở vị trí nghỉ. Tiếp điểm trong khối phân cấp chỉ thấy cuộn cùng khối.
- Mô hình: `coil()` và `timerState()` của `electromech.ts` (đã xuất); rơ-le nhiệt = nhiệt ∫I²/Ir² qua trễ τ theo cấp (`overloadTau`), tác động ở 1.2·Ir, chốt cho tới Reset; `overloadTripTime(cấp, m) = τ·ln(m²/(m²−1.2))`. Cầu chì I²t: `fuseMeltTime(I, Imin, I²t) = I²t/(I²−Imin²)`; áp-tô-mát: `breakerTripTime` (nhiệt `τ·ln(m²/(m²−1.69))`, từ ~1 ms ở bội số của đường cong). **Mọi phần tử bảo vệ mới bắt đầu nguội ở t = 0** (`u(time)`): điểm làm việc không mang lịch sử nhiệt, nên cầu chì không bao giờ "đã cháy sẵn" khi bắt đầu. `tripElement(..., cold)` của `electromech.ts` có thêm tham số đó (cầu chì / MCB cũ giữ hành vi cũ).
- `LibraryPartDef.tripCurve` + `TripCurve.tsx` (`curveOf`): đồ thị log-log thời gian – dòng điện trong Thuộc tính, vẽ từ chính các công thức trên.
- Biến áp nguồn: `lineTransformerDesign` (điện áp đầy tải → tỉ số vòng theo Vs0, điện trở cuộn dây giải từ `V0² = (Vs + a)² + (ρa)²`, điện kháng tản ρ = 0.5, điện cảm từ hoá từ dòng không tải); mô hình biến áp lý tưởng E/F như biến áp bão hoà. 30 bản có sẵn (230 / 115 V → 6…24 V, 5 / 25 / 100 VA) + bản chỉnh được.

- **Tên cuộn đi theo cuộn** (`src/model/relink.ts`): tiếp điểm gọi cuộn bằng ký hiệu, nên `relinkRenamedCoils(trước, sau)` (gọi trong `commit` của editor: đổi tên ở Thuộc tính, Đánh số lại, Annotate, Tìm & thay đều qua đó) đưa các tiếp điểm cùng cấp theo ký hiệu mới của cuộn (hoán đổi K1 ↔ K2 cũng đúng), còn `relinkPastedContacts` (trong `pasteItems`) cho tiếp điểm dán cùng cuộn trỏ vào cuộn vừa dán. Hàm thuần `annotateDesign` / `replaceInDesign` / `renumberParts` KHÔNG tự làm việc này: ai gọi chúng ngoài store phải tự gọi `relinkRenamedCoils`.

**Nguồn**: pin (`batteries.ts`: mức điện tích là điện áp nút 1 F, `SoC' = I/(3600·Ah)`, giữ điểm làm việc bằng nguồn lệch sau 100 MΩ và `u(time)`; `batteryCellVoltage` / `batteryResistance` / `batteryRuntime`), từ thông (`lineMagnetics.ts`: tụ 1 µF + điện trở 10 Ω dập dao động của luật hình thang), tệp đo lường (`measurementSource.ts` dùng `parseMeasurement` của Grapher), tệp WAV (`audio.ts`: PWL từ mẫu).

**Ba mạch mẫu** (`src/ui/integration/electroSamples.ts`, tệp `examples/70…72`): mở – dừng công-tắc-tơ hai trang, rơ-le thời gian, loa sau lọc RC. Test: `src/library/catalog/electro.test.ts` (liên kết cuộn – tiếp điểm giữa các trang, thời gian rơ-le thời gian, I²t, đường cong áp-tô-mát và rơ-le nhiệt, điều áp biến áp, thời gian xả pin, từ thông, tệp đo lường, WAV), `src/audio/*.test.ts`, `src/sim/devices/linear/pcm.test.ts`, `src/ui/integration/{audio,electroSamples}.test.ts`.

## Phương án có giá trị riêng, phần rời nhiều loại và gỡ lỗi vi điều khiển cùng mạch (vòng 4 bước 4)

**Giá trị riêng theo phương án** (`src/model/variants.ts`). Một phương án không chỉ bỏ linh kiện: `PartInstance.variantValues[id] = { params?, fields? }` thay tham số và trường BOM của linh kiện đó, và `DesignVariant.variables` thay biểu thức của tham số toàn cục. Hai trường mới đều tuỳ chọn, ghi sau `fields` / `description` trong `serialize.ts` nên tệp cũ (chỉ có `notFitted`) mở nguyên và ghi lại từng byte; định dạng vẫn là phiên bản 2 (không cần migrate: thiếu trường = giá trị giống nhau ở mọi phương án, đúng điều tệp cũ vẫn mang nghĩa). `variantView(design)` là nơi DUY NHẤT áp chúng (cùng chỗ nó đánh dấu `excludeFromSim` / `excludeFromBom` cho linh kiện không lắp), nên netlister, mô phỏng, `placedParts` (BOM, báo cáo, `pcbComponents`) đều thấy bản của phương án đang dùng mà không phải sửa gì; `effectiveInstance(inst, variantId)` trả CHÍNH đối tượng khi phương án không đổi gì (canvas, bảng tính dùng để vẽ nhãn giá trị mà không làm mất memo). Sửa: `setVariantParam` / `setVariantField` / `setVariantVariable` / `clearVariantValues` (giá trị trống hoặc bằng giá trị đã lưu = xoá), `variantChanges(design, id)` liệt kê khác biệt. `addVariant(…, copyFrom)` chép cả giá trị, `removeVariant` xoá chúng. Lớp toàn vẹn (`sanitize.ts`) coi khoá của `variantValues` như `notFitted`: chuyển theo TÊN, bỏ khi không có, và `repairRawDesign` bỏ khoá không rõ để tệp vẫn mở. **Sửa lỗi lớp 1 phát hiện khi làm**: `sanitizeIncoming` trước đây giữ id phương án nếu thiết kế đích có id đó, dù tên khác (snippet “Không màn hình” = `v2` dán vào thiết kế mà `v2` là “Lab” thì lặng lẽ gắn nhầm); nay khi nguồn khai báo tên thì TÊN quyết định. Snippet: `buildSnippet(design, frag, now, { bakeVariant })` ghi giá trị của phương án đang dùng thành giá trị đã lưu và bỏ mọi dấu phương án (`flows.tsx` `saveSnippetFlow` hỏi khi mảnh có dữ liệu phương án). Giao diện: lưới của Quản lý phương án (`libraryTools.tsx`) có ô giá trị chính cạnh dấu “Lắp”, bảng mọi tham số + trường BOM của một linh kiện, bảng tham số toàn cục; Thuộc tính ghi “Giá trị riêng trong …”.

**Phần rời nhiều loại** (`src/library/sectionKit.ts`, `src/model/sectionPlan.ts`). `makeSectionParts(pkg, drafts, what)` tạo `<id gói>-a`, `-b` … từ danh sách `SectionDraft { letter, symbol, own, optionalPins }`; phần gọi `packageFragment` nên toàn bộ vi mạch chỉ do phần dẫn đầu sinh ra. Cổng / flip-flop / công tắc tương tự dựng từ nhóm chân tên bắt đầu bằng số (`parts/digital/sectionParts.ts`, thêm `shape: 'ff' | 'switch'`; họ 74xx / 4000 trong `catalog/logicCatalog.ts`); op-amp kép / bốn dựng ra gói “TL072 (kép)” (hộp DIP đủ chân) và phần TL072A / B (`catalog/opampSections.ts`, chân DIP-8 / DIP-14 chuẩn); NE556 / TLC556 từ gói hiện có (`analogics.ts`). Op-amp phần đơn cũ (`analog/tl072`) giữ nguyên. **Chân dùng chung**: chân trùng tên ở nhiều phần (V+ / V−, VCC / GND) lấy node của phần ĐẦU TIÊN CÓ NỐI (`netlister.ts` khối `packageNodes`), `connectivityErc` không báo chân hở cho phần không nối khi phần khác đã nối, và hai phần nối vào hai net khác nhau là lỗi `sectionPinConflict`. Tên phần tử điện trở đệm của chân thừa phân biệt `+` / `-` (`2IN+` ≠ `2IN-`; bản cũ gộp thành một tên và báo `elementConflict`). `sectionPlan.ts` (thuần): `packageUses`, `joinableRefdes(sheets, def, lookup, { newPackage })`, `sectionChoices`, `joinTargets`; `designOps.ts`: `placePart(…, { newPackage })`, `setSection`, `moveToNewPackage`, `moveToPackage`. `UiState.newPackage` (không lưu vào tuỳ chọn) bật bằng Đặt › Mỗi phần vào một vi mạch mới; tab Vi mạch của Thuộc tính (`PackagePanel.tsx`, nạp lười, chữ trong `i18n/sectionText.ts`). Báo cáo “Cổng còn trống” (`reports.ts` `packageSections`) tìm phần qua `getPart(sectionPartId(gói, chữ))` khi tên chân không bắt đầu bằng số, và một phần chỉ nối với chính nó (op-amp bám) vẫn là phần trống.

**Gỡ lỗi vi điều khiển cùng mạch** (`src/mcu/debugger.ts`, `watch.ts`; `src/sim/devices/digital/mcu.ts`; `src/ui/mcu/`). Quy tắc duy nhất: **mạch dừng đúng thời gian lõi đã chạy** = `timeBase + chu kỳ × thời gian một chu kỳ máy`. Đường đi: `CoreDebugger` (thuần, bọc `Cpu8051`) giữ điểm dừng, lệnh bước (`stepInstruction`, `stepCycle`, `stepOver`, `runTo`, `resume`, `breakNow`), 8 ô theo dõi (`encodeWatch(space, addr)`) và `held` / `reason`. Thiết bị `D_MCU8051` đặt các lệnh đó sau tham số chạy `bpadd / bpdel / bpclear / resume / step / stepcycle / stepover / runto / break / watch0…7 / wbreak` (`Behaviour.setParam`), và báo cho engine hai việc: (1) `Behaviour.wakeTimes()` / `lookAhead` đưa thời điểm dừng (đích của bước, điểm dừng sắp tới, ô theo dõi đổi) vào `breakpointsBetween` để engine đặt một mốc thời gian đúng đó (đo trước trên bản chụp của lõi; sau lệnh gõ vào, `repredict()` làm lại ngay vì bước kế đã được lập kế hoạch); (2) `Behaviour.holdRequested()` → `Device.holdRequested` → `InteractiveStepper.advance` dừng sau mốc đó (`TransientStepper.held`), `SimHost` `Session.tick` tự tạm dừng và gửi `{ type: 'state', state: 'paused', held: true }`. Phần còn lại là vector đọc ra thêm (`Mdbg` lý do dừng, `Mmid` chu kỳ trong lệnh đang làm, `Minsn`, `Mbpn`, `Mw0…7`). Lệnh chạy lại chương trình (`reset`) dời `timeBase` để cả hai đồng hồ vẫn khớp; chân RST giữ nguyên hành vi cũ. “Bắt đầu gỡ lỗi” là tham số `dbgstart` chỉ đặt vào netlist của phiên đó (`SimulationIntegration.startDebugging`), không lưu vào thiết kế. Bước **một chu kỳ máy** giữ lệnh nhiều chu kỳ nguyên khối: lõi chạy lệnh ở chu kỳ cuối của nó (đồng hồ mạch đi từng chu kỳ, `Mmid` = k). Biểu thức theo dõi (`compileWatch`, ngôn ngữ C-like nhỏ, ô nhớ cố định → ô cứng qua `planWatches`, địa chỉ tính toán tra trong cửa sổ RAM 16 byte); `McuPanel.tsx` chọn giữa gỡ lỗi sống (`liveDebug`: phiên đang chạy hoặc tạm dừng) và chạy riêng (`StandaloneRun`).

**Tệp / kiểm**: `src/model/variantValues.test.ts`, `sectionsMulti.test.ts`, `src/mcu/watch.test.ts`, `src/sim/devices/digital/mcuDebug.test.ts` (đo thời gian chính xác qua stepper thật), `src/ui/sim/host.test.ts` (phiên tự tạm dừng); `tests/review/round4/invariants.test.ts` thêm hai thao tác (“variant values”, “section moves”).

## Trao đổi định dạng, clipboard hệ thống và bậc thang mở rộng (vòng 4 bước 7)

### Thư viện ký hiệu KiCad (`src/model/kicadSymbols.ts`, `src/ui/parts/kicadSymbolFlows.tsx`)

- **Trung gian `KSymbol`** (mm, y hướng lên, chân = điểm nối + hướng vào thân + chiều dài): `parseKicadSym` (s-expression, KiCad 6+: hình chữ nhật, đa tuyến, tròn, cung ba điểm hoặc `radius`/`angles` của 6.0, Bézier làm phẳng, chữ, chân, `extends`, đơn vị `NAME_u_s`, kiểu thân De Morgan bị bỏ) và `parseLegacyLib` (`.lib` KiCad 5: `DEF/F/DRAW/X/S/C/A/P/B/T`, đơn vị mil) cho cùng một cấu trúc, nên một bộ chuyển `symbolsToParts` phục vụ cả hai.
- **Sang linh kiện người dùng** (`CustomPartData`, vào Cơ sở dữ liệu của tôi): 1 mm = 7,874 đơn vị (1,27 mm = lưới 10), chân căn về lưới 10, đường chân (stub) vẽ tường minh, bong bóng đảo / tam giác xung nhịp, tên chân là nhãn, số chân là `number` và là tên chân dùng để ghép mô hình; ký hiệu nhiều đơn vị thành một linh kiện mỗi đơn vị. `PIN_TYPES` (custom/types.ts) nay có đủ 10 kiểu (thêm `tristate`, `open-collector`, `power-in`, `power-out`; nhãn đã có sẵn).
- **Trường SPICE** (`Sim.*` của KiCad 8, `Spice_*` của 6/7) → `CustomModel`: R/C/L/V/I dùng linh kiện thư viện có giá trị; D/Q/J/M có `Sim.Params` thành thẻ `.model`; tên giá trị trùng một linh kiện MachSim cùng số chân → dùng nó; `Sim.Library` + `Sim.Name` → nhúng `.subckt`/`.model` cùng phần phụ thuộc khi tệp mô hình được đưa kèm (`opts.libraries`, khoá = tên tệp viết thường), nếu không thì ghi chú `modelLibraryMissing`.
- **Xuất** `partsToKicadSym(parts, {libraryName})` → `{ text, models, modelFile }`: cung/đường dẫn SVG/đa tuyến/chữ → đồ hoạ KiCad, chân → `(pin type line (at x y angle) (length …))` với chiều dài đo từ đường chân, trường `Sim.*` cho R/C/L/V/I và subckt (mô hình SPICE ghi riêng ra `.lib`). Đọc lại cho cùng chân, kiểu, số và hình (test vòng tròn).
- Ghi chú có cấu trúc (`KicadSymbolNote`) → câu tiếng Việt/Anh qua `symbolNoteText` (`src/i18n/kicadText.ts`, bảng nạp theo nhu cầu).

### Sơ đồ KiCad: bus, sheet con, KiCad 5 (`kicadImport.ts`, `kicadLegacy.ts`, `kicadProject.ts`)

- `kicadToNetlist` đọc thêm `bus`, `bus_entry`, `bus_alias`, `hierarchical_label`, `sheet` (+ chân sheet nối vào mạng của trang cha qua cùng bộ union-find). Nhãn nằm trên bus (và không nằm trên dây) đặt tên bus, không thành net. `kicadBusName` đổi `D[0..7]`, `{A B}`, `P{X Y}`, bí danh → tên bus MachSim. `ImportedNetlist` thêm `buses`, `busEntries`, `hierLabels`, `sheets`; `ImportedComponent.block` / `.box`.
- `importedToDesign`: khi mọi linh kiện có vị trí, vẽ lại dây bus (trực giao hoá) và với mỗi lối vào bus một dây ngắn + nhãn `bus-entry` đặt tên đường; một nhãn của mỗi `hierLabels` thành đầu nối `hier`; thành phần có `block` là khối phân cấp của thiết kế con (`blockPartDef`). Đã sửa lỗi lưới định tuyến (`placeAndRoute`): `minX/minY` phải là bội của lưới nếu không dây lệch pin vài đơn vị khi bbox của một linh kiện lẻ.
- `kicadLegacy.legacySchToKicadSch` đổi `.sch` thành văn bản KiCad 6 (mil → mm, ma trận hướng 2×2 → góc + `mirror` bằng cách thử cả 8 phép biến đổi với chính `kicadPinPosition` của bộ nhập, `$Comp`, `Wire Wire/Bus`, `Entry Wire`, `Connection`, `Text Label/GLabel/HLabel`, `$Sheet`) kèm `lib_symbols` dựng từ các `.lib`; vì vậy chỉ có MỘT bộ luật nối mạch cho hai thế hệ.
- `importKicadProject(text, {read, libraries})` tải sheet con qua `read(tệp)`, mỗi tệp thành MỘT `ChildDesign` (dùng chung cho nhiều symbol sheet), lồng tối đa 6 tầng, phát hiện vòng, id của thiết kế con được tiền tố bằng id khối. Tệp thiếu → `missing`, symbol sheet thành khối rỗng đúng chân. Luồng giao diện (`flows.tsx` `importKicadFiles`): hỏi người dùng chọn các tệp còn thiếu (nhiều tệp một lần), `.sch` đọc `<tên>.lib` / `<dự án>-cache.lib` qua `readIncludeFile` trên desktop.

### TDMS (`src/util/tdms.ts`, `src/ui/integration/tdmsFlow.ts`, `tdmsText.ts`)

- `parseTdms(bytes)` → `TdmsFile` {properties, groups, channels, segments, warnings}. Đoạn = lead-in 28 byte (thẻ `TDSm`, mặt nạ ToC luôn little-endian, rồi version / offset đoạn kế / offset dữ liệu theo endian của mặt nạ) + siêu dữ liệu (đối tượng, chỉ số dữ liệu thô: không có / như trước / kiểu + số giá trị [+ byte chuỗi], thuộc tính) + dữ liệu thô gồm nhiều khối giống nhau (liên tục hoặc xen kẽ). Không có `NewObjList` thì danh sách đối tượng của đoạn trước tiếp tục; không có siêu dữ liệu thì bố cục lặp lại; offset `0xFFFF…` (đang ghi dở) chạy đến cuối tệp và chỉ giữ khối đầy đủ (cảnh báo `truncated-data` / `ragged-data`). DAQmx, kiểu mở rộng, số phức → `TdmsError` (không đoán).
- `tdmsMeasurement` → `MeasurementData` (trục X: `wf_increment` + `wf_start_offset`, hoặc kênh thời gian cùng nhóm cùng độ dài [mốc thời gian tính tương đối], hoặc số thứ tự mẫu — có cờ `axis`), thưa bớt khi quá `maxPoints`; `tdmsToCsv` → văn bản CSV mà nguồn đo (`measurementPlayback`) và Grapher đọc được. Giao diện: Grapher › Nhập dữ liệu đo nhận `.tdms`; nút "Mở tệp…" của nguồn áp / dòng đọc tệp đo đổi TDMS thành CSV (`BINARY_OPEN_RE` thêm `tdms`).

### Clipboard hệ thống (`src/model/clipboardCircuit.ts`, `src/ui/files/systemClipboard.ts`)

- Một mạch được đưa lên clipboard của HĐH ở bốn dạng: ảnh PNG (chính là PNG snippet), văn bản mô tả, HTML (ảnh mang mạch trong `data-machsim-circuit`) và **định dạng riêng** `application/x-machsim-circuit` (dòng `machsim-circuit-clipboard 1` rồi JSON snippet). Desktop: `bridge.clipboardWrite` / `clipboardRead` (preload + `machsim:clipboard-write|read` trong `main.cjs`; vì mỗi lần ghi của Electron có thể xoá những gì đã có, chuẩn được ghi trước, định dạng riêng sau, nếu ảnh mất thì ghi lại chuẩn — HTML vẫn mang mạch). Trình duyệt: API Clipboard bất đồng bộ, định dạng tuỳ biến `web application/x-machsim-circuit` khi `ClipboardItem.supports` cho phép.
- `judgeClipboard(offer)` quyết định TRƯỚC khi dán: `circuit` (qua `private` / `html` / `picture` / `text`), `picture-only` (có ảnh nhưng dữ liệu mạch đã mất — **hộp giải thích hiện trước, không thử dán rồi báo lỗi sau**), `damaged` (kèm lý do, chỉ khi không dạng nào dùng được) hoặc `nothing`. Lệnh `edit.copySystem` / `edit.pasteSystem`; Ctrl+V khi clipboard của MachSim trống đi qua `pasteFromSystemClipboard`, ảnh dán/thả vào đi qua `placePastedPicture`. Giới hạn của trình duyệt (không có API, không có định dạng tuỳ biến, từ chối quyền đọc) được nói rõ bằng hộp thoại lúc sao chép / dán.

### Bậc thang mở rộng (`src/ladder/blocks.ts`, `editBlocks.ts`, `xref.ts`, `clipboard.ts`)

- **Mô hình**: `LadderOutputKind` thêm `mov add sub mul div call`; `LadderOutput` thêm `a`, `b`, `block`, `args`; `LadderBlock` {id, name, comment?, inputs, outputs, rungs} lưu ở `Design.ladderBlocks` (ghi sau cùng trong `serialize.ts`). Địa chỉ mới: `MW0…MW31` (từ nhớ 16 bit có dấu, `toWord` quay vòng, DIV vào từ nhớ cắt về 0), `AQ0…AQ3` (volt). `LADDER_LIMITS` thêm `words`, `analogOutputs`, `blockDepth`, `localBits`, `timersTotal`…
- **Khối hàm = trải phẳng trước khi biên dịch** (`expandBlocks`): cuộn dây `call` thành cuộn dây ghi bit ẩn `$L<n>` (EN) và các bậc của khối, đã thay tham số hình thức bằng địa chỉ thật và `#tên` bằng bộ nhớ riêng (`$L` bit, `$T33…` bộ định thời, `$C…`, `$MW32…`), đứng ngay sau bậc gọi theo thứ tự quét; mỗi bậc thân khối được nối tiếp với EN. Địa chỉ bắt đầu bằng `$` chỉ do bộ trải phẳng viết (người dùng gõ `$…` bị từ chối: `parseBitAddress(text, internal)`). Bậc sinh ra nhận khe `rungs.length + k` nên khe của bậc thật không đổi. Lỗi có `block` / `innerRung`; bậc gọi hỏng bị bỏ khỏi chương trình (phần còn lại vẫn chạy). Máy quét (`machine.ts`) thêm `local`, `words`, `analogOut`, `mathErrors`; `ports` thêm `{kind:'aq', index, vmax}` (mô-đun `plc-analog-out-2`, `LadderIoSpec.kind = 'analog-output'`), `A_LADDER` điều khiển chân tới ±vmax; probe `Lw<n>`, `Lo<n>`, `Lerr`.
- **Giao diện** (`LadderSheetView.tsx`, `LadderPanels.tsx`): chọn dãy bậc bằng Shift, sao chép / cắt / dán (`clipboard.ts`: bậc / tiếp điểm hoặc nhóm / cuộn dây; văn bản `machsim-ladder-clip` trên clipboard hệ thống), bảng khối hàm (tạo, đổi tên theo mọi lời gọi, xoá, tham số), bảng tham chiếu chéo (`xref.ts`: ĐỌC / GHI từng địa chỉ, nhảy tới bậc, cảnh báo `neverWritten` / `neverRead`), ô lệnh số và ô gọi khối trong ngăn thuộc tính, hộp vẽ cho lệnh số / khối. In: ghi chú bậc xuống dòng (`ladderCaptionLines`) và lựa chọn "Bậc thang" trong Xem trước khi in (`ladderPrint.ts`: tài liệu ghi chú + bảng tham chiếu chéo).

## Tập lệnh, EKV, lớp BSIM4 và lõi từ trễ (vòng 4 bước 8)

### Tập lệnh JavaScript (`src/script/`, `src/ui/script/ScriptPanel.tsx`, `src/i18n/scriptText.ts`)

- **Hộp cát.** Mã của người dùng chạy trong một Web Worker tạo từ Blob (`runner.ts` `browserWorkerFactory`). Chương trình trong worker là hàm tự chứa
  `workerProgram.ts` (được `toString()` rồi nạp; không import, không class field): nó gỡ các tên toàn cục nguy hiểm (`SCRUBBED_GLOBALS`: fetch,
  XMLHttpRequest, WebSocket, importScripts, indexedDB, localStorage, Worker, postMessage, require, process …), che chúng thành `undefined` ở tham số của
  hàm async chạy mã, rồi chỉ còn một đường ra: gọi `MachSim.<hàm>()`. Mỗi lời gọi là một thông điệp `{t:'call'}` JSON; host trả lời lần lượt, theo thứ tự
  script gọi (`protocol.ts`). Worker cũng có `Result` bọc kết quả (get, at, max, rms, crossing, bandwidth, toCsv …), `sweep`, `linspace`, `eng` …
  Nút Dừng gọi `worker.terminate()` (vòng lặp vô hạn không chặn được), quá `SCRIPT_LIMITS.timeoutMs` (10 phút) tự dừng.
- **Host không giao diện.** `session.ts` `ScriptSession` giữ MỘT bản sao thiết kế và trả lời mọi phương thức trong `SCRIPT_METHODS`. Mọi thứ chạm bên ngoài
  đi qua `ScriptIO`: `openFile` / `saveFile` (thẻ xin phép trong cửa sổ, hoặc chỉ các tệp nêu trên dòng lệnh), `runNetlist` (SimClient trong cửa sổ,
  `runAnalyses` trong CLI và test), `currentDesign` / `showDesign` (trình soạn; `showDesign` đi qua `openGeneratedDesign`, nên thiết kế mở thành thẻ mới và
  được lớp toàn vẹn xử lý). Thêm một phương thức: thêm tên vào `SCRIPT_METHODS`, hàm vào `ScriptSession.methods`, mục vào `SCRIPT_DOCS` (scriptText.ts, cả hai ngôn ngữ).
- **Dòng lệnh.** `cli.ts` (`parseScriptArgs`, `runScriptCli`, `isScriptInvocation`) dùng chung cửa sổ ẩn và IPC `machsim:batch-*` với `--batch`
  (`desktop/main.cjs`: `BATCH` cũng đúng với `--script`; `batchRenderer.ts` rẽ nhánh). Quyền tệp = các đường dẫn nêu trên dòng lệnh (main.cjs `batchPaths`).
  Mã thoát là `EXIT` của `--batch`. Test chạy cùng mã worker trên `worker_threads` (`nodeWorker.ts`, `kind: 'node'`).
- **Đồ thị.** `plotSvg.ts` `plotToSvg` (trục 1-2-5 tuyến tính / log, nhiều đường, chú giải) dùng cho cả cửa sổ và `MachSim.plot()` (trả SVG để `saveText`).
- **Trợ giúp / người mới.** Lệnh `tools.script` (không nằm trong danh sách người mới), F1 trên cửa sổ mở trang hướng dẫn `scripting`.

### Mô hình linh kiện

- **EKV 2.6** (`src/sim/devices/semi/ekv.ts`, LEVEL 44, chọn trong `mosdevice.ts`): xem đầu tệp cho từng công thức. Khác báo cáo EKV 2.6 ở ba chỗ, đều
  ghi trong mã: suy giảm độ linh động `1/(1 + THETA'·Vp)`, bão hoà vận tốc `1/(1 + VDE/Vc)` (không dùng kẹp VDSS, vì kẹp đó không về đồng nhất khi Vc → ∞
  và phá nghịch đảo yếu), điều biến độ dài kênh dạng log quanh `VDSAT = VP − VS + 4Vt`. Điện tích theo dạng đóng của hồ sơ điện tích EKV
  (`∫q dx` và mômen bậc một, suy ra từ i = q² + q) — test so với tích phân số.
- **Lớp BSIM4** (`bsim3.ts`): cùng lớp `Bsim3` với cờ `b4` chọn từ LEVEL 14 / 54; `BSIM4_DEFAULTS` + `ALIASES4`; khác lõi BSIM3 ở nhiệt độ ngưỡng
  (LPE0/LPEB, K1ox/K2ox), ba công thức độ linh động, hình học tụ `leffQ/weffQ`, CGSO/CGDO/CF mặc định. BSIM3 không đổi (test cũ giữ nguyên).
- **Jiles–Atherton** (`src/library/catalog/magneticCore.ts`): lưới điện điều khiển bằng từ thông; nút `<ref>.flux .mirr .b .h .m .x .s` (đọc được trong Grapher
  bằng “hiện vector nội bộ”), đầu vào của bộ tích phân từ thông bị cổng hoá `u(time)+u(hertz)` để điểm làm việc DC không “nạp” lõi. Dòng xoáy = một điện trở.
- **Đồ thị X–Y**: `vs(y, x)` trong bộ xử lý sau trả `Vector` có `xValues`; `buildPlotData` vẽ theo `PlotTrace.ownX`; nút “Đường B–H” cho mọi lõi có `V(R.b)` và `V(R.h)`.

## Độ rộng thư viện: 5 072 → 11 517 linh kiện (vòng 4 bước 6)

Thư viện tăng thêm **6 445 part** trong năm gói catalogue nạp theo yêu cầu (`src/library/catalog/more/`, mỗi gói
một chunk nạp động riêng: `logicMore-*.js` 5 kB, `analogMore` 19 kB, `discretesMore` 21 kB, `passivesMore` 3 kB, `sensorsMore` 12 kB, cộng
`variants` 1 kB; phần lớn mã dùng lại chunk `catalogue-logic` / `-diodes` / `-transistors` / `-series`). Nhóm `catalogue` trong `vite.config.ts` **loại**
`catalog/more` ra (`(?!more[\/])`): nếu để các gói này khớp nhóm chung hoặc đặt tên nhóm riêng cho chúng, Rolldown gộp cả catalogue nạp lúc khởi động
vào chunk của gói (580 kB nạp ngay khi mở app). Chunk `catalogue` khởi động chỉ tăng 1,8 kB (458,8 → 460,6 kB: các hàm dựng hàng bảng được xuất ra). Hai nguồn:
part mới dựng từ bảng thông số datasheet (2 920) và **biến thể** của part sẵn có (3 525: đổi vỏ, đổi mã đặt hàng).
Mọi part có tên + mô tả tiếng Việt (`textVi`), dấu vết `provenance`, vỏ có trong `footprints.ts`, và đi qua cả hai bộ
thử toàn danh mục (`catalog-sim.test.ts`: ERC + điểm làm việc DC; `capabilities.test.ts`: OP + quá độ 1 ms với mọi
chân nối 1 MΩ) — không part nào là "chỉ vẽ".

| Gói (`CATALOGUE_PACKS`) | File | Nhóm | Nội dung |
|---|---|---|---|
| `logic-more` | `more/logicMore.ts` | TTL, CMOS | 43 part mới (74x238, 533 / 563 / 564 đảo, 620 / 645, LS290 / 293, CD4724B, thêm họ cho 73 / 20 / 30 / 14 / 109 / 112 / 125 / 164 và HC4022 / 4516 / 4585) + mã đặt hàng của **mọi** IC 74xx / 4000B: `SN74LS00N / D`, `DM74LS00N`, `SN74HC00N / D / PW`, `CD74HC00E`, `CD4017BE / BM / BPW`, `HCF4017BEY`, `HEF4017BP`, `MC14017BCP` … (2 430 part) |
| `analog-more` | `more/analogMore.ts` | Analog, Power | 137 loại op-amp (chính xác, JFET, CMOS rail-to-rail, audio, băng rộng; loại đôi / tư kèm vỏ cả chip + từng phần: 448 part), 16 comparator, 68 nguồn áp chuẩn, 110 ổn áp (78xx / 79xx mở rộng, LDO, LM1117 / LD1117 / NCP1117, ổn áp xung LM257x HV) và biến thể vỏ / hãng (`TL072CD`, `LM358PW`, `MCP6291-E/SN`, `L7805CV`, `MC7805CD2T`, `KA7805`, `LM1117T-3.3`, `LM317T` …) (1 534 part) |
| `discretes-more` | `more/discretesMore.ts` | Diodes, Transistors, RF | 401 Zener (E24 2,4 – 75 V: MMSZ52xx, BZT52C, BZV55C, ZMM, TZMC, ZPD, MMBZ52xx; BZX85C 1,3 W; 1N5913B … 1N5956B và 1SMB59xxB 3 W), 102 LED (thêm cỡ 8 mm, 5 × 2, 3528, 5050, 0402, 3 W và LED dòng thấp 2 mA), 159 BJT, 92 MOSFET (kèm mã `…PBF` và `…S` D2PAK của loại TO-220), 36 JFET, 25 IGBT (1 001 part) |
| `passives-more` | `more/passivesMore.ts` | Basic | điện trở E96 0603 và màng kim loại 1/4 W 1 % (10 Ω – 1 MΩ), 0402 E24, tụ MLCC C0G / X7R 0603 / 0805 / 1206 (1 267 part) |
| `sensors-more` | `more/sensorsMore.ts` | Basic, Misc, Indicators | 80 NTC (R25 × B × vỏ giọt / 0603), 10 KTY, 10 IC đo nhiệt (TMP35 / 37, LM45 / 50 / 60, MCP9700 / 9701, TC1047A) + LM35 theo cấp / vỏ, 8 cảm biến Hall, 45 opto (4N26 … 4N38, H11A, CNY17, SFH615A, PC817 A – D, EL817, LTV-817, TLP521 / 621 / 281), 48 LED 7 đoạn (0,28 – 1,0 inch × 6 màu × CA / CC) + thanh LED 10 vạch (213 part) |

**Biến thể** (`more/variants.ts`): `repackage(base, spec)` sao chép part gốc với id, tên, `footprint`, `specs.package` và
(khi vỏ đánh số chân khác, ví dụ op-amp SOT-23-5: OUT 1, V- 2, IN+ 3, IN- 4, V+ 5) số chân mới; **`toSpice`, tham
số, tên chân và ký hiệu giữ nguyên** — biến thể mô phỏng y hệt part gốc. `LibraryPartDef.variantOf` ghi id part gốc.
Mã đặt hàng theo quy ước công khai của từng hãng (`codesFor(pn)` trong `analogMore.ts`; `ORDER_CODES` trong
`logicMore.ts`); chữ cấp (A / B / C) của hãng không tự sinh, nên vài mã là mã "gần đúng" không có chữ cấp.

**Hợp đồng và chỗ cần biết**
- Gói mới cần: file `more/<tên>.ts` xuất mảng `LibraryPartDef[]`, mục trong `CATALOGUE_PACKS` (`catalog/index.ts`) với
  `counts` đúng từng nhóm (`lazyPacks.test.ts` kiểm), nhóm chunk trong `vite.config.ts`, và cập nhật hai số đếm trong
  `tests/review/completeness/capabilities.test.ts`. Mọi gói lọc id đã có (`fresh()`), nên thêm một part trùng id **không báo lỗi
  mà bị bỏ** — `counts` sẽ lệch và `lazyPacks.test.ts` báo.
- Hàm dựng hàng bảng được xuất ra để dùng chung: `opampRowParts / opampRowPackages / comparatorRow / shuntRow /
  seriesRow` (`analogics.ts`), `regulatorFromText / buckFromText` (`power.ts`), `bjtRowFromText / singleBjt /
  darlingtonPart` (`bjts.ts`), `mosRow / mosPart / jfetFromText / igbtFromText` (`fets.ts`), `resistorPart / filmPart`
  (`passiveSeries.ts`), `optocoupler` (`parts/misc.ts`), và bảng `V_BZX`, `ZZT_BZX`, `LED_COLORS_EXT`, `diodePart` (`diodes.ts`).
- Vỏ mới trong `footprints.ts` (khối `SMD_PACKAGES`): TSSOP / SSOP / SOIC rộng, SOT-23-8, SC-70-5, SOT-89, TO-252, TO-263-3,
  TO-220F, TO-3P, TO-66, TO-46, chip 0402 / 1206 / 1210, tụ tantan A – D, tụ hoá dán, LED 3528 / 5050 / 0402, LED 7 đoạn
  0,28 – 1,0 inch, SOP-4.
- Số liệu trong các bảng mới là giá trị điển hình lấy từ datasheet công khai, **làm tròn một – hai chữ số**
  (`provenance` của từng part nói rõ); các họ 1,3 W / 3 W của Zener có ZZT, IZT ước lượng từ VZ và công suất.
- Quy mô bộ thử: `catalog-sim.test.ts` chạy ~11 500 part trong ≈ 20 s, `capabilities.test.ts` ≈ 50 s — không cần lấy mẫu.

## Hợp đồng dùng chung (chỉ thêm, không đổi nghĩa)

- `src/sim/netlist.ts` — Netlist IR, analysis specs, options.
- `src/sim/device.ts` — giao diện thiết bị ↔ engine (MNA, quy ước dấu, tích phân điện tích).
- `src/sim/results.ts` — kết quả, tên vector.
- `src/sim/api.ts` — `runAnalyses`, `createTransientStepper` (xuất từ `src/sim/index.ts`).
- `src/model/types.ts`, `src/model/geometry.ts` — mô hình sơ đồ, toạ độ, kết quả netlister.
- `src/library/types.ts`, `src/library/index.ts` — định nghĩa và registry linh kiện.
- `src/util/units.ts` — số có hậu tố kỹ thuật (SPICE: M = milli; người dùng: M = mega, dấu phẩy thập phân, mã RKM).
- `src/mcu/cpu8051.ts`, `asm8051.ts`, `hex.ts`, `program.ts`, `probes.ts` — lõi 8051, trình dịch, Intel HEX và tên biến số liệu (thuần, dùng chung giữa engine và giao diện).
- `src/ladder/types.ts` — bậc thang trong tệp thiết kế (`Sheet.kind`, `Sheet.ladder`); `program.ts`, `machine.ts`, `probes.ts`, `layout.ts`, `edit.ts` — biên dịch, vòng quét, biến số liệu, hình vẽ và thao tác sửa (thuần, dùng chung giữa engine và giao diện).
- `src/mecha/models.ts` — mô hình máy (chân vào / chân cảm biến / nút báo trạng thái), dùng bởi code model `A_MECHA` và bởi giao diện để vẽ chuyển động.
- `src/model/ercMatrix.ts`, `ercReport.ts`, `netSettings.ts`, `sections.ts`, `src/library/footprints.ts` — tuỳ chọn ERC + ma trận loại chân, phạm vi / báo cáo ERC, cài đặt theo net, vi mạch nhiều phần, danh mục chân vỏ (thuần).
- `src/ui/app/documents.ts` — `createDocumentManager`, `DocumentExtension`, `CloseHost`; `src/ui/store/types.ts` `DocumentState`; `src/ui/print/printLayout.ts` — phép tính trang in (thuần).
- `src/model/steps.ts` — quét tham số trên sơ đồ (`applySteps`, `customStepWrapper`, `StepMessage`); `src/model/hierarchy.ts` — đường dẫn bản đặt (`resolveLivePart` / `resolveLiveName`, `withLiveParam`, `innerKey`, `liveKey`, `scopedLive`, `copyPaths`); `src/learn/readings.ts` — phép đo quá độ / AC của bước bài học (thuần).
- `src/model/sanitize.ts` — lớp toàn vẹn dùng chung: mọi nội dung vào một thiết kế đi qua đây (`sanitizeIncoming`, `sanitizeIncomingSheets`, `sanitizeDesign`, `parseDesignSafely` / `validateDesignSafely` / `repairRawDesign`, `neededVariables` / `referencedVariables`, `SanitizeNote`). Thuần; `src/i18n/sanitize.ts` dịch ghi chú.
- `src/mcu/debugger.ts`, `watch.ts` — bộ gỡ lỗi của lõi 8051 (điểm dừng, bước, ô theo dõi; `Behaviour.holdRequested` / `wakeTimes`, `TransientStepper.held`) và biểu thức theo dõi (thuần); `src/model/sectionPlan.ts` — luật chọn phần còn trống (thuần); `PartInstance.variantValues`, `DesignVariant.variables` — giá trị riêng theo phương án.
- `src/audio/*` — WAV, lấy mẫu lại, phát thời gian thực và nguồn micrô (thuần trừ `webAudioSink.ts` / `input.ts`); `ToSpiceContextExt.linkTarget` / `warn` và `followDriver` (`src/library/partkit.ts`) cho phần tử nối bằng tên.
- `src/script/protocol.ts` (`SCRIPT_METHODS`, thông điệp worker ↔ host, `ScriptResult`), `session.ts` (`ScriptIO`), `runner.ts` (`startScript`), `cli.ts`; `src/sim/results.ts` `Vector.xValues / xName / xUnit` (đồ thị X–Y, chỉ thêm); `LibraryPartDef` không đổi — lõi từ trễ và MOSFET compact chỉ thêm linh kiện.

## Luồng dữ liệu

```
Design (sheets, parts, wires) ──buildNetlist──▶ NetlistBuild{ netlist IR, nets, instruments, probes, erc }
        ▲                                             │
   Editor UI                                  Web Worker: flattenNetlist → devices → engine
        │                                             │
 Instruments/Grapher ◀── AnalysisResult[] / TransientChunk stream ──┘
```
