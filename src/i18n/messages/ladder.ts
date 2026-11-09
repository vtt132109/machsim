/**
 * UI messages: ladder diagrams and the mechatronics models — menu / command labels, the sheet
 * name, the one-line state of a machine in the Simulation tab and the short messages the start-up
 * code shows. The texts of the ladder editor itself load with its chunk
 * (src/i18n/ladderText.ts). [vi, en]
 */
import type { Catalogue } from '../types';

export default {
  'cmd.place.ladderSheet': ['Trang sơ đồ bậc thang', 'Ladder sheet'],
  'cmd.view.ladderHelp': ['Trợ giúp sơ đồ bậc thang', 'Ladder diagram help'],
  'ladder.sheet.default': ['Bậc thang {n}', 'Ladder {n}'],
  'ladder.added': [
    'Đã thêm trang sơ đồ bậc thang. Hãy đặt “Bộ điều khiển PLC” và các mô-đun vào / ra (nhóm Số linh tinh) lên trang mạch để chương trình điều khiển được mạch.',
    'A ladder sheet was added. Place the “PLC controller” and the input / output modules (Misc digital group) on a schematic sheet so the program can control the circuit.',
  ],
  // one-line state of a machine, shown in the Simulation tab
  'ladder.mecha.conveyor': ['{n} vật trên băng, {passed} vật đã qua', '{n} items on the belt, {passed} have passed'],
  'ladder.mecha.junction': ['{faults} lần tín hiệu không an toàn ({t} s)', '{faults} unsafe signal states ({t} s)'],
  'ladder.mecha.tank': ['mức nước {pct} % ({l} L)', 'level {pct} % ({l} L)'],
  'ladder.mecha.door': ['cửa mở {pct} %', 'door {pct} % open'],
  'ladder.mecha.lift': ['cabin ở tầng {floor}, cửa mở {door} %', 'car at floor {floor}, door {door} % open'],
} satisfies Catalogue;
