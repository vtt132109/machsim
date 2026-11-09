/**
 * UI messages: microcontroller co-simulation and programmable logic — the menu / command labels
 * and the few short texts the start-up code shows. The texts of the code editor panel and of the
 * PLD wizard load with their chunks (src/i18n/mcuText.ts). [vi, en]
 */
import type { Catalogue } from '../types';

export default {
  'cmd.simulate.mcuEditor': ['Trình soạn mã vi điều khiển…', 'MCU code editor…'],
  'cmd.tools.pldWizard': ['Trình hướng dẫn logic lập trình được (PLD)…', 'Programmable-logic (PLD) wizard…'],
  'cmd.tools.exportHdl': ['Xuất logic ra VHDL / Verilog…', 'Export logic to VHDL / Verilog…'],
  'mcu.window.title': ['Trình soạn mã — {refdes}', 'Code editor — {refdes}'],
  'mcu.window.titleEmpty': ['Trình soạn mã vi điều khiển', 'MCU code editor'],
  'mcu.noMcu': [
    'Chưa có vi điều khiển nào trên sơ đồ. Đặt linh kiện “Vi điều khiển 8051” (nhóm Số linh tinh) rồi mở lại bảng này.',
    'There is no microcontroller on the schematic yet. Place the “MCU 8051” part (Misc digital group) and open this panel again.',
  ],
  'mcu.pld.title': ['Trình hướng dẫn logic lập trình được', 'Programmable-logic wizard'],
} satisfies Catalogue;
