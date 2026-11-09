/**
 * Every user-visible text of the virtual breadboard, in Vietnamese (primary) and English.
 * (Merged into the app-wide i18n module; the breadboard keeps its LocalizedText templates because
 * its check / guide / markings logic builds both languages at once.)
 *
 * Logic modules (check, guide, markings) never hard-code prose: they call the template
 * functions below, which return a `LocalizedText` holding both languages, and the UI picks one
 * with `tr(text, lang)`. Static UI labels live in `UI`. Keeping all wording here lets a
 * translator or teacher adjust the explanations in one place.
 */

import type { BoardKind, BreadboardRow } from '../breadboard/types';
import { L, type Lang, type LocalizedText } from './core';

export { L, tr, type Lang, type LocalizedText } from './core';

/** Join several localized fragments with a separator (per language). */
export function joinText(parts: LocalizedText[], sep: LocalizedText = L(', ', ', ')): LocalizedText {
  return { vi: parts.map((p) => p.vi).join(sep.vi), en: parts.map((p) => p.en).join(sep.en) };
}

/** Concatenate localized fragments without a separator. */
export function concatText(...parts: (LocalizedText | string)[]): LocalizedText {
  return {
    vi: parts.map((p) => (typeof p === 'string' ? p : p.vi)).join(''),
    en: parts.map((p) => (typeof p === 'string' ? p : p.en)).join(''),
  };
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** A part name given once (same in both languages) or per language (see partNameText in ./library). */
export type NameText = string | LocalizedText;
const nVi = (n: NameText): string => (typeof n === 'string' ? n : n.vi);
const nEn = (n: NameText): string => (typeof n === 'string' ? n : n.en);

const list = (items: string[], lang: Lang): string => {
  if (items.length <= 1) return items.join('');
  const and = lang === 'vi' ? ' và ' : ' and ';
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1]}`;
};

// ---------------------------------------------------------------------------------------------
// Static UI labels

export const UI = {
  title: L('Breadboard ảo 3D', '3D virtual breadboard'),
  viewTop: L('Nhìn từ trên', 'Top view'),
  viewIso: L('Phối cảnh', 'Isometric'),
  viewFront: L('Nhìn từ trước', 'Front view'),
  toolSelect: L('Chọn / di chuyển', 'Select / move'),
  toolWire: L('Dây nối', 'Jumper wire'),
  wireColor: L('Màu dây', 'Wire colour'),
  autoArrange: L('Tự sắp xếp', 'Auto-arrange'),
  autoArrangeHint: L('Tự động cắm toàn bộ linh kiện theo sơ đồ (thay thế bố trí hiện tại)', 'Place every part automatically from the schematic (replaces the current layout)'),
  check: L('Kiểm tra mạch', 'Check circuit'),
  guide: L('Hướng dẫn lắp', 'Assembly guide'),
  screenshot: L('Chụp ảnh PNG', 'PNG screenshot'),
  undo: L('Hoàn tác (Ctrl+Z)', 'Undo (Ctrl+Z)'),
  redo: L('Làm lại (Ctrl+Y)', 'Redo (Ctrl+Y)'),
  rotate: L('Xoay (R: 90°, Shift+R: 180°)', 'Rotate (R: 90°, Shift+R: 180°)'),
  rotateShort: L('Xoay', 'Rotate'),
  remove: L('Gỡ khỏi board (Delete)', 'Remove from board (Delete)'),
  cancel: L('Huỷ (Esc)', 'Cancel (Esc)'),
  partsBin: L('Hộp linh kiện chưa cắm', 'Parts bin (not placed)'),
  partsBinEmpty: L('Tất cả linh kiện đã được cắm.', 'Every part is on the board.'),
  offBoard: L('Ngoài board (dùng dây kẹp)', 'Off-board (clip leads)'),
  pickPin: L('Chọn chân để kẹp:', 'Pick the pin to clip:'),
  boardKind: L('Loại board', 'Board size'),
  splitRails: L('Thanh nguồn tách đôi', 'Split power rails'),
  language: L('Ngôn ngữ', 'Language'),
  issues: L('Kết quả kiểm tra', 'Check results'),
  noIssues: L('Không có lỗi: breadboard khớp với sơ đồ.', 'No problems: the breadboard matches the schematic.'),
  hints: L('Gợi ý', 'Hints'),
  close: L('Đóng', 'Close'),
  prevStep: L('Bước trước', 'Previous step'),
  nextStep: L('Bước tiếp', 'Next step'),
  step: L('Bước', 'Step'),
  running: L('Đang mô phỏng', 'Simulating'),
  contextLost: L('Mất ngữ cảnh WebGL — đang khôi phục…', 'WebGL context lost — restoring…'),
  noWebgl: L('Trình duyệt không hỗ trợ WebGL nên không hiển thị được breadboard 3D.', 'This browser has no WebGL, so the 3D breadboard cannot be shown.'),
  placing: L('Đang cắm {part}: bấm vào một lỗ (R để xoay, Esc để huỷ).', 'Placing {part}: click a hole (R rotates, Esc cancels).'),
  clipping: L('Kẹp {part}.{pin}: bấm vào lỗ cần kẹp.', 'Clip {part}.{pin}: click the hole to clip onto.'),
  wiring: L('Dây nối: bấm lỗ đầu tiên rồi lỗ thứ hai.', 'Jumper: click the first hole, then the second.'),
  wiringFrom: L('Dây nối từ {hole}: bấm lỗ thứ hai.', 'Jumper from {hole}: click the second hole.'),
  idle: L('Bấm linh kiện để chọn, kéo để di chuyển. Phím mũi tên + Enter để thao tác bằng bàn phím.', 'Click a part to select it, drag to move. Arrow keys + Enter work too.'),
  hoverNet: L('Net sơ đồ', 'Schematic net'),
  hoverStrip: L('Dải', 'Strip'),
  hoverParts: L('Đang cắm', 'Connected'),
  hoverEmpty: L('(trống)', '(empty)'),
  errors: L('lỗi', 'errors'),
  warnings: L('cảnh báo', 'warnings'),
  canvasLabel: L('Breadboard 3D. Dùng phím mũi tên để di chuyển con trỏ lỗ, Enter để chọn.', '3D breadboard. Arrow keys move the hole cursor, Enter selects.'),
  selected: L('Đang chọn', 'Selected'),
  deleteWire: L('Xoá dây', 'Delete wire'),
  deleteClip: L('Gỡ dây kẹp', 'Remove clip lead'),
  boardFull: L('Lớn (63 cột)', 'Full (63 columns)'),
  boardHalf: L('Vừa (30 cột)', 'Half (30 columns)'),
  boardMini: L('Nhỏ (17 cột)', 'Mini (17 columns)'),
  cannotPlace: L('Không cắm được {part} ở {hole}: có chân nằm ngoài board.', 'Cannot place {part} at {hole}: a lead would be off the board.'),
  cannotRotate: L('Không xoay được {part}: có chân sẽ ra ngoài board.', 'Cannot rotate {part}: a lead would leave the board.'),
  cannotMove: L('Không chuyển được {part} tới đó: có chân sẽ ra ngoài board.', 'Cannot move {part} there: a lead would leave the board.'),
} as const;

/** Names of the leads the board check talks about (wire ends, clip leads). */
export const leadText = {
  wireEnd: (id: string): LocalizedText => L(`Đầu dây ${id}`, `Wire ${id} end`),
  wire: (id: string): LocalizedText => L(`dây ${id}`, `wire ${id}`),
  clipOf: (pin: LocalizedText): LocalizedText => concatText(L('Dây kẹp của ', 'Clip lead of '), pin),
  clip: (pin: LocalizedText): LocalizedText => concatText(L('kẹp ', 'clip '), pin),
  missingTitle: (net: LocalizedText): LocalizedText => concatText(L('Thiếu kết nối: ', 'Missing connection: '), net),
};

export function fill(text: LocalizedText, vars: Record<string, string | number>): LocalizedText {
  const sub = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  return { vi: sub(text.vi), en: sub(text.en) };
}

// ---------------------------------------------------------------------------------------------
// Board vocabulary

export function boardKindName(kind: BoardKind): LocalizedText {
  switch (kind) {
    case 'full':
      return L('breadboard lớn (830 lỗ, 63 cột)', 'full-size breadboard (830 holes, 63 columns)');
    case 'half':
      return L('breadboard vừa (400 lỗ, 30 cột)', 'half-size breadboard (400 holes, 30 columns)');
    case 'mini':
      return L('breadboard nhỏ (170 lỗ, 17 cột, không có thanh nguồn)', 'mini breadboard (170 holes, 17 columns, no power rails)');
  }
}

export function railName(row: BreadboardRow, side?: 'L' | 'R'): LocalizedText {
  const half = side === 'L' ? L(' (nửa trái)', ' (left half)') : side === 'R' ? L(' (nửa phải)', ' (right half)') : L('', '');
  const base =
    row === 'top+'
      ? L('thanh nguồn + phía trên', 'top + rail')
      : row === 'top-'
        ? L('thanh nguồn − phía trên', 'top − rail')
        : row === 'bot+'
          ? L('thanh nguồn + phía dưới', 'bottom + rail')
          : L('thanh nguồn − phía dưới', 'bottom − rail');
  return concatText(base, half);
}

export function holeText(name: string, row: BreadboardRow, col: number, boardPrefix: string): LocalizedText {
  if (row.length > 1) {
    const r = railName(row);
    return L(`${boardPrefix}${r.vi}, cột ${col}`, `${boardPrefix}${r.en}, column ${col}`);
  }
  return L(`${boardPrefix}lỗ ${name} (hàng ${row}, cột ${col})`, `${boardPrefix}hole ${name} (row ${row}, column ${col})`);
}

export function terminalStripText(col: number, upper: boolean, boardPrefix: string): LocalizedText {
  return upper
    ? L(`${boardPrefix}cột ${col}, hàng a–e`, `${boardPrefix}column ${col}, rows a–e`)
    : L(`${boardPrefix}cột ${col}, hàng f–j`, `${boardPrefix}column ${col}, rows f–j`);
}

export function boardPrefixText(boardId: string): string {
  return `[${boardId}] `;
}

export function groundNetText(): LocalizedText {
  return L('GND (đất, 0 V)', 'GND (ground, 0 V)');
}

/** Learner description of a pin name (A -> anode ...). */
export function pinRoleText(pin: string): LocalizedText | null {
  switch (pin) {
    case 'A':
      return L('anode, chân dương', 'anode, positive');
    case 'K':
      return L('cathode, chân âm', 'cathode, negative');
    case '+':
      return L('cực dương', 'positive');
    case '-':
      return L('cực âm', 'negative');
    case 'C':
      return L('collector', 'collector');
    case 'B':
      return L('base', 'base');
    case 'E':
      return L('emitter', 'emitter');
    case 'D':
      return L('drain', 'drain');
    case 'G':
      return L('gate', 'gate');
    case 'S':
      return L('source', 'source');
    case 'W':
      return L('con chạy', 'wiper');
    case 'COM':
      return L('chân chung', 'common');
    case 'IN':
      return L('ngõ vào', 'input');
    case 'OUT':
      return L('ngõ ra', 'output');
    case 'GND':
      return L('mass', 'ground');
    case 'ADJ':
      return L('chỉnh áp', 'adjust');
    case 'REF':
      return L('tham chiếu', 'reference');
    default:
      return null;
  }
}

export function pinText(refdes: string, pin: string): LocalizedText {
  if (pin.startsWith('#')) return L(`${refdes} chân ${pin.slice(1)}`, `${refdes} pin ${pin.slice(1)}`);
  const role = pinRoleText(pin);
  return role ? L(`${refdes}.${pin} (${role.vi})`, `${refdes}.${pin} (${role.en})`) : L(`${refdes}.${pin}`, `${refdes}.${pin}`);
}

// ---------------------------------------------------------------------------------------------
// Colour names (resistor bands, wires, LEDs)

const COLOR_NAMES: Record<string, LocalizedText> = {
  black: L('đen', 'black'),
  brown: L('nâu', 'brown'),
  red: L('đỏ', 'red'),
  orange: L('cam', 'orange'),
  yellow: L('vàng', 'yellow'),
  green: L('xanh lá', 'green'),
  blue: L('xanh dương', 'blue'),
  violet: L('tím', 'violet'),
  grey: L('xám', 'grey'),
  white: L('trắng', 'white'),
  gold: L('nhũ vàng', 'gold'),
  silver: L('nhũ bạc', 'silver'),
  none: L('không vạch', 'no band'),
  infrared: L('hồng ngoại', 'infrared'),
  clear: L('trong suốt', 'clear'),
};

export function colorNameText(color: string): LocalizedText {
  return COLOR_NAMES[color] ?? L(color, color);
}

// ---------------------------------------------------------------------------------------------
// Circuit-check messages. Each returns { title, message, fix }.

export interface IssueText {
  title: LocalizedText;
  message: LocalizedText;
  fix: LocalizedText;
}

export const issueText = {
  unplacedPart(refdes: string, partName: NameText): IssueText {
    return {
      title: L(`${refdes} chưa được cắm`, `${refdes} is not placed`),
      message: L(
        `Linh kiện ${refdes} (${nVi(partName)}) có trong sơ đồ nhưng chưa có trên breadboard, nên mạch thật sẽ thiếu nó.`,
        `Part ${refdes} (${nEn(partName)}) is in the schematic but not on the breadboard, so the real circuit is missing it.`,
      ),
      fix: L(`Chọn ${refdes} trong hộp linh kiện rồi bấm vào lỗ muốn cắm.`, `Pick ${refdes} in the parts bin, then click the hole to place it.`),
    };
  },
  clipMissing(refdes: string, pins: string[], partName: NameText): IssueText {
    return {
      title: L(`${refdes} chưa được kẹp dây`, `${refdes} has no clip lead`),
      message: L(
        `${refdes} (${nVi(partName)}) nằm ngoài board và nối vào mạch bằng dây kẹp. Chân ${pins.join(', ')} chưa được kẹp vào lỗ nào.`,
        `${refdes} (${nEn(partName)}) sits off the board and connects with clip leads. Pin ${pins.join(', ')} is not clipped to any hole yet.`,
      ),
      fix: L(`Chọn ${refdes} trong hộp linh kiện, chọn chân rồi bấm vào lỗ cần kẹp.`, `Pick ${refdes} in the parts bin, choose the pin, then click the hole.`),
    };
  },
  leadOffBoard(owner: LocalizedText, where: string): IssueText {
    return {
      title: concatText(owner, L(' nằm ngoài board', ' is off the board')),
      message: concatText(
        owner,
        L(
          ` đang ở vị trí ${where} — chỗ đó không có lỗ cắm nên chân này không nối với gì cả.`,
          ` is at ${where} — there is no hole there, so this lead is not connected to anything.`,
        ),
      ),
      fix: L('Di chuyển linh kiện (hoặc đầu dây) vào một lỗ thật trên board.', 'Move the part (or wire end) into a real hole on the board.'),
    };
  },
  leadMissing(refdes: string, pin: LocalizedText): IssueText {
    return {
      title: L(`${refdes}: thiếu chân`, `${refdes}: lead not placed`),
      message: concatText(pin, L(' chưa được cắm vào lỗ nào.', ' is not in any hole.')),
      fix: L(`Gỡ ${refdes} ra rồi cắm lại để mọi chân đều vào lỗ.`, `Remove ${refdes} and place it again so every lead is in a hole.`),
    };
  },
  holeConflict(hole: string, owners: LocalizedText[]): IssueText {
    return {
      title: L(`Hai chân cùng một lỗ ${hole}`, `Two leads in hole ${hole}`),
      message: concatText(
        L(`Lỗ ${hole} đang chứa `, `Hole ${hole} holds `),
        joinText(owners, L(' và ', ' and ')),
        L('. Mỗi lỗ chỉ cắm vừa một chân; nhét hai chân vào một lỗ làm lỏng tiếp xúc và hỏng lò xo của lỗ.', '. Each hole fits one lead; forcing two leads in one hole gives a loose contact and wears out the clip.'),
      ),
      fix: L('Chuyển một chân sang lỗ khác trong cùng dải (cùng cột) — kết nối điện vẫn y như cũ.', 'Move one lead to another hole of the same strip (same column) — the electrical connection stays the same.'),
    };
  },
  partShorted(refdes: string, strip: LocalizedText, pins: string[]): IssueText {
    return {
      title: L(`${refdes} bị nối tắt`, `${refdes} is shorted`),
      message: concatText(
        L(`Các chân ${pins.join(', ')} của ${refdes} cùng cắm trong một dải (`, `Leads ${pins.join(', ')} of ${refdes} are in the same strip (`),
        strip,
        L(
          '). Năm lỗ của một dải được nối liền với nhau bên trong board, nên dòng điện đi thẳng qua dải mà không qua linh kiện.',
          '). The five holes of a strip are joined inside the board, so current flows straight through the strip and bypasses the part.',
        ),
      ),
      fix: L(`Xoay hoặc dời ${refdes} để mỗi chân nằm ở một cột khác nhau (hoặc vắt qua rãnh giữa).`, `Rotate or move ${refdes} so each lead is in a different column (or across the centre channel).`),
    };
  },
  short(nets: string[], pins: LocalizedText[]): IssueText {
    return {
      title: L(`Chập mạch: ${nets.join(' ↔ ')}`, `Short: ${nets.join(' ↔ ')}`),
      message: concatText(
        L(
          `Trên breadboard các net ${list(nets, 'vi')} đang bị nối với nhau, nhưng trong sơ đồ chúng phải tách riêng. Các chân liên quan: `,
          `On the breadboard nets ${list(nets, 'en')} are joined, but in the schematic they must stay separate. Leads involved: `,
        ),
        joinText(pins),
        L('.', '.'),
      ),
      fix: L(
        'Kiểm tra các chân và dây nối cùng dải: chuyển chân sai sang một cột trống, hoặc bỏ dây nối thừa.',
        'Check the leads and wires sharing the strip: move the wrong lead to an empty column, or remove the extra wire.',
      ),
    };
  },
  missing(net: string, groups: LocalizedText[]): IssueText {
    return {
      title: L(`Thiếu kết nối: net ${net}`, `Missing connection: net ${net}`),
      message: concatText(
        L(`Trong sơ đồ, các chân sau đều thuộc net ${net} và phải nối với nhau, nhưng trên breadboard chúng đang ở các nhóm riêng: `, `In the schematic these leads all belong to net ${net} and must be connected, but on the breadboard they are in separate groups: `),
        joinText(groups, L(' | ', ' | ')),
        L('.', '.'),
      ),
      fix: L('Cắm các chân này vào cùng một dải (cùng cột a–e hoặc f–j), hoặc nối các dải bằng một dây nối.', 'Put these leads in the same strip (same column a–e or f–j), or join the strips with a jumper wire.'),
    };
  },
  polarity(refdes: string, kind: 'led' | 'diode' | 'electrolytic' | 'buzzer'): IssueText {
    const why: Record<typeof kind, LocalizedText> = {
      led: L('LED chỉ sáng khi dòng đi từ anode (chân dài) sang cathode (chân ngắn, phía mép vát). Cắm ngược thì LED tắt.', 'An LED only lights when current flows from the anode (long lead) to the cathode (short lead, flat edge). Reversed, it stays dark.'),
      diode: L('Diode chỉ cho dòng đi từ anode sang cathode (đầu có vạch). Cắm ngược sẽ chặn dòng hoặc làm hỏng mạch.', 'A diode only conducts from anode to cathode (the striped end). Reversed it blocks the current or breaks the circuit.'),
      electrolytic: L('Tụ hoá có cực tính: chân − (vạch sọc trên thân, chân ngắn) phải ở phía điện áp thấp hơn. Cắm ngược tụ có thể phồng hoặc nổ.', 'Electrolytic capacitors are polarised: the − lead (striped side, short lead) must go to the lower voltage. Reversed, the capacitor can bulge or burst.'),
      buzzer: L('Còi có cực tính: chân + (dài, có dấu +) phải nối phía điện áp cao hơn.', 'The buzzer is polarised: the + lead (long, marked +) must go to the higher voltage.'),
    };
    return {
      title: L(`${refdes} bị cắm ngược cực`, `${refdes} is reversed`),
      message: why[kind],
      fix: L(`Xoay ${refdes} 180° để đổi chỗ hai chân: chọn ${refdes} rồi nhấn Shift+R.`, `Rotate ${refdes} by 180° to swap its two leads: select ${refdes} and press Shift+R.`),
    };
  },
  pinsSwapped(refdes: string, order: string): IssueText {
    return {
      title: L(`${refdes}: sai thứ tự chân`, `${refdes}: leads in the wrong order`),
      message: L(
        `Các chân của ${refdes} được nối đúng net nhưng lệch thứ tự. Thứ tự chân thật của linh kiện này là ${order} — hãy xem kỹ mặt chữ của linh kiện.`,
        `The leads of ${refdes} reach the right nets but in the wrong order. The real lead order of this part is ${order} — check the printed face of the part.`,
      ),
      fix: L(`Xoay ${refdes} 180° hoặc cắm lại theo đúng thứ tự ${order}.`, `Rotate ${refdes} by 180° or re-seat it in the order ${order}.`),
    };
  },
  unknownPart(refdes: string): IssueText {
    return {
      title: L(`${refdes} không còn trong sơ đồ`, `${refdes} is no longer in the schematic`),
      message: L(
        `Trên breadboard có ${refdes} nhưng sơ đồ không còn linh kiện này (có thể đã bị xoá hoặc đổi tên).`,
        `The breadboard holds ${refdes}, but the schematic no longer has it (deleted or renamed).`,
      ),
      fix: L(`Gỡ ${refdes} khỏi breadboard.`, `Remove ${refdes} from the breadboard.`),
    };
  },
  unknownPin(refdes: string, pin: string): IssueText {
    return {
      title: L(`${refdes}: chân ${pin} không tồn tại`, `${refdes}: no pin ${pin}`),
      message: L(`Breadboard tham chiếu chân ${pin} của ${refdes} nhưng linh kiện không có chân này.`, `The breadboard refers to pin ${pin} of ${refdes}, but the part has no such pin.`),
      fix: L('Gỡ dây kẹp / linh kiện này rồi cắm lại.', 'Remove this clip lead / part and place it again.'),
    };
  },
  unknownBoard(id: string): IssueText {
    return {
      title: L(`Không có board ${id}`, `No board ${id}`),
      message: L(`Một chân hoặc dây tham chiếu board "${id}" không có trong bố trí.`, `A lead or wire refers to board "${id}", which is not in the layout.`),
      fix: L('Cắm lại chân đó vào một board có thật.', 'Re-seat that lead on an existing board.'),
    };
  },
};

export const hintText = {
  polarityOk(refdes: string, kind: 'led' | 'diode' | 'electrolytic' | 'buzzer', plusHole: string, minusHole: string): IssueText {
    const t: Record<typeof kind, LocalizedText> = {
      led: L(`${refdes}: chân dài (anode) ở ${plusHole}, chân ngắn (cathode, mép vát) ở ${minusHole}.`, `${refdes}: long lead (anode) in ${plusHole}, short lead (cathode, flat edge) in ${minusHole}.`),
      diode: L(`${refdes}: đầu có vạch (cathode) ở ${minusHole}, anode ở ${plusHole}.`, `${refdes}: striped end (cathode) in ${minusHole}, anode in ${plusHole}.`),
      electrolytic: L(`${refdes}: chân + ở ${plusHole}, chân − (phía vạch sọc) ở ${minusHole}.`, `${refdes}: + lead in ${plusHole}, − lead (striped side) in ${minusHole}.`),
      buzzer: L(`${refdes}: chân + ở ${plusHole}, chân − ở ${minusHole}.`, `${refdes}: + lead in ${plusHole}, − lead in ${minusHole}.`),
    };
    return { title: L(`Cực tính ${refdes}`, `${refdes} polarity`), message: t[kind], fix: L('Giữ nguyên chiều này khi lắp mạch thật.', 'Keep this orientation when building the real circuit.') };
  },
  icNoSupply(refdes: string, net: string, supplyPin: string, groundPin: string): IssueText {
    return {
      title: L(`${refdes} cần nguồn ${net}`, `${refdes} needs a ${net} supply`),
      message: L(
        `Sơ đồ không có net ${net}, nên khi mô phỏng ${refdes} chạy ở mức logic lý tưởng. Trên breadboard thật, chân ${supplyPin} phải nối lên nguồn (+5 V) và chân ${groundPin} xuống GND thì IC mới hoạt động.`,
        `The schematic has no ${net} net, so ${refdes} simulates with ideal logic levels. On a real breadboard pin ${supplyPin} must go to the supply (+5 V) and pin ${groundPin} to GND for the IC to work.`,
      ),
      fix: L(`Thêm ký hiệu nguồn ${net} vào sơ đồ, hoặc nối chân ${supplyPin} lên thanh nguồn +.`, `Add a ${net} supply symbol to the schematic, or wire pin ${supplyPin} to the + rail.`),
    };
  },
  danglingWire(hole: string): IssueText {
    return {
      title: L('Dây nối thừa', 'Unused jumper'),
      message: L(`Đầu dây ở ${hole} cắm vào một dải không có gì khác, nên dây này không nối gì.`, `The wire end in ${hole} is in a strip with nothing else, so the wire connects nothing.`),
      fix: L('Có thể bỏ dây này đi cho gọn.', 'You can remove this wire to tidy up.'),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// Assembly guide texts

export const guideText = {
  introTitle: L('Chuẩn bị', 'Get ready'),
  intro(board: LocalizedText, parts: number, wires: number, clips: number): LocalizedText {
    return L(
      `Lấy một ${board.vi}. Mạch gồm ${parts} linh kiện, ${wires} dây nối và ${clips} dây kẹp. Trên board, 5 lỗ cùng một cột (a–e hoặc f–j) được nối liền bên trong thành một "dải"; rãnh giữa tách hai nửa. Mỗi thanh nguồn dài là một dải chạy dọc board.`,
      `Take a ${board.en}. The circuit has ${parts} parts, ${wires} jumper wires and ${clips} clip leads. On the board the 5 holes of one column (a–e or f–j) are joined inside into a "strip"; the centre channel separates the two halves. Each long power rail is one strip along the board.`,
    );
  },
  splitNote: L(
    'Board này có thanh nguồn tách đôi ở giữa: nửa trái và nửa phải của mỗi thanh KHÔNG nối với nhau nếu không có dây nối.',
    'This board has split power rails: the left and right halves of each rail are NOT connected unless you add a jumper.',
  ),
  railsTitle: L('Thanh nguồn', 'Power rails'),
  railUse(rail: LocalizedText, code: string, net: string): LocalizedText {
    return L(`${cap(rail.vi)} (ký hiệu ${code}) dùng cho ${net}.`, `The ${rail.en} (marked ${code}) carries ${net}.`);
  },
  noRails: L('Mạch không dùng thanh nguồn.', 'The circuit does not use the power rails.'),
  partTitle(refdes: string, name: NameText): LocalizedText {
    return L(`Cắm ${refdes} (${nVi(name)})`, `Place ${refdes} (${nEn(name)})`);
  },
  dip(refdes: string, label: string, pins: number, pin1: string, pinN: string): LocalizedText {
    return L(
      `Cắm IC ${refdes} (${label}, ${pins} chân) vắt ngang rãnh giữa, khấc (vết lõm hình bán nguyệt) quay về bên trái. Chân 1 (cạnh chấm tròn) vào ${pin1}, chân ${pins} vào ${pinN}. Ấn đều hai hàng chân để không bị cong.`,
      `Seat IC ${refdes} (${label}, ${pins} pins) across the centre channel with the notch facing left. Pin 1 (next to the dot) goes into ${pin1}, pin ${pins} into ${pinN}. Press both rows evenly so no pin bends.`,
    );
  },
  resistor(refdes: string, value: string, bands: LocalizedText, holes: string): LocalizedText {
    return L(
      `Cắm điện trở ${refdes} ${value} (vạch màu: ${bands.vi}) vào ${holes}. Điện trở không có cực tính, cắm chiều nào cũng được.`,
      `Insert resistor ${refdes} ${value} (bands: ${bands.en}) into ${holes}. Resistors have no polarity, either way round works.`,
    );
  },
  ceramic(refdes: string, value: string, code: string, holes: string): LocalizedText {
    return L(
      `Cắm tụ gốm ${refdes} ${value} (in mã "${code}") vào ${holes}. Tụ gốm không có cực tính.`,
      `Insert ceramic capacitor ${refdes} ${value} (marked "${code}") into ${holes}. Ceramic capacitors have no polarity.`,
    );
  },
  electrolytic(refdes: string, value: string, plus: string, minus: string): LocalizedText {
    return L(
      `Cắm tụ hoá ${refdes} ${value}: chân dài (+) vào ${plus}, chân ngắn (−, phía có vạch sọc) vào ${minus}.`,
      `Insert electrolytic capacitor ${refdes} ${value}: long lead (+) into ${plus}, short lead (−, striped side) into ${minus}.`,
    );
  },
  led(refdes: string, color: LocalizedText, anode: string, cathode: string): LocalizedText {
    return L(
      `Cắm LED ${refdes} màu ${color.vi}: chân dài (anode, +) vào ${anode}, chân ngắn (cathode, −, phía mép vát của vành) vào ${cathode}.`,
      `Insert the ${color.en} LED ${refdes}: long lead (anode, +) into ${anode}, short lead (cathode, −, flat side of the rim) into ${cathode}.`,
    );
  },
  diode(refdes: string, name: NameText, anode: string, cathode: string): LocalizedText {
    return L(
      `Cắm diode ${refdes} (${nVi(name)}): đầu có vạch (cathode) vào ${cathode}, đầu kia (anode) vào ${anode}.`,
      `Insert diode ${refdes} (${nEn(name)}): the striped end (cathode) into ${cathode}, the other end (anode) into ${anode}.`,
    );
  },
  transistor(refdes: string, name: NameText, order: string, holes: string, flat: boolean): LocalizedText {
    return flat
      ? L(
          `Cắm ${refdes} (${nVi(name)}) với mặt phẳng có chữ quay về phía bạn. Thứ tự chân từ trái sang phải: ${order} → ${holes}.`,
          `Insert ${refdes} (${nEn(name)}) with the flat printed face towards you. Lead order left to right: ${order} → ${holes}.`,
        )
      : L(
          `Cắm ${refdes} (${nVi(name)}) với mặt có chữ quay về phía bạn, tản nhiệt kim loại ở phía sau. Thứ tự chân từ trái sang phải: ${order} → ${holes}.`,
          `Insert ${refdes} (${nEn(name)}) with the printed face towards you and the metal tab at the back. Lead order left to right: ${order} → ${holes}.`,
        );
  },
  generic(refdes: string, name: NameText, holes: string): LocalizedText {
    return L(`Cắm ${refdes} (${nVi(name)}): ${holes}.`, `Insert ${refdes} (${nEn(name)}): ${holes}.`);
  },
  pot(refdes: string, value: string, holes: string): LocalizedText {
    return L(
      `Cắm biến trở ${refdes} ${value}; chân giữa là con chạy (W): ${holes}.`,
      `Insert potentiometer ${refdes} ${value}; the middle lead is the wiper (W): ${holes}.`,
    );
  },
  sevenSeg(refdes: string, commonAnode: boolean, pin1: string): LocalizedText {
    const vi = commonAnode ? 'anode chung' : 'cathode chung';
    const en = commonAnode ? 'common anode' : 'common cathode';
    return L(
      `Cắm LED 7 đoạn ${refdes} (${vi}) vắt ngang rãnh giữa, dấu chấm thập phân ở góc dưới bên phải. Chân 1 (đoạn e) vào ${pin1}.`,
      `Seat the 7-segment display ${refdes} (${en}) across the centre channel with the decimal point at the bottom right. Pin 1 (segment e) goes into ${pin1}.`,
    );
  },
  barGraph(refdes: string, pin1: string): LocalizedText {
    return L(
      `Cắm thanh LED ${refdes} vắt ngang rãnh giữa; chân 1 (anode đoạn 1, góc có vát) vào ${pin1}.`,
      `Seat the LED bar graph ${refdes} across the centre channel; pin 1 (anode of segment 1, bevelled corner) goes into ${pin1}.`,
    );
  },
  wiresTitle: L('Dây nối', 'Jumper wires'),
  wire(color: LocalizedText, from: string, to: string, purpose: LocalizedText): LocalizedText {
    return L(`Nối dây ${color.vi} từ ${from} đến ${to}${purpose.vi}.`, `Run a ${color.en} jumper from ${from} to ${to}${purpose.en}.`);
  },
  wireToRail(net: string): LocalizedText {
    return L(` (đưa ${net} ra thanh nguồn)`, ` (takes ${net} to the rail)`);
  },
  wireRailBridge: L(' (nối hai thanh nguồn cùng loại)', ' (bridges two rails of the same supply)'),
  wireNet(net: string): LocalizedText {
    return L(` (net ${net})`, ` (net ${net})`);
  },
  clipsTitle: L('Nguồn và thiết bị đo (cắm sau cùng)', 'Supplies and instruments (connect last)'),
  clip(refdes: string, name: NameText, pin: LocalizedText, hole: string, color: LocalizedText): LocalizedText {
    return L(`Kẹp dây ${color.vi} từ ${pin.vi} của ${refdes} (${nVi(name)}) vào ${hole}.`, `Clip the ${color.en} lead from ${pin.en} of ${refdes} (${nEn(name)}) to ${hole}.`);
  },
  powerLast: L('Luôn nối nguồn sau cùng và kiểm tra lại mạch trước khi cấp điện.', 'Always connect the power last and re-check the wiring before switching on.'),
  checkTitle: L('Kiểm tra', 'Check'),
  checkOk: L('Bố trí khớp hoàn toàn với sơ đồ. Bạn có thể cấp nguồn và chạy mô phỏng.', 'The layout fully matches the schematic. You can power up and run the simulation.'),
  checkBad(errors: number, warnings: number): LocalizedText {
    return L(
      `Bố trí còn ${errors} lỗi và ${warnings} cảnh báo. Mở "Kiểm tra mạch" để xem chi tiết trước khi cấp nguồn.`,
      `The layout still has ${errors} errors and ${warnings} warnings. Open "Check circuit" for details before powering up.`,
    );
  },
  holesJoin(holes: string[]): string {
    return holes.join(' – ');
  },
};

// ---------------------------------------------------------------------------------------------
// Developer demo page

/** Circuit names of the developer demo page (breadboard-demo.html). */
export const DEMO_NAMES: Record<string, LocalizedText> = {
  'series-led': { vi: 'LED + điện trở + pin 9 V', en: 'LED + resistor + 9 V battery' },
  divider: { vi: 'Cầu phân áp', en: 'Voltage divider' },
  'transistor-switch': { vi: 'Transistor làm công tắc', en: 'Transistor switch' },
  'astable-555': { vi: '555 nháy LED', en: '555 LED flasher' },
  'inverting-amp': { vi: 'Op-amp khuếch đại đảo', en: 'Inverting op-amp' },
  'nand-led': { vi: 'Cổng NAND 7400 + LED', en: '7400 NAND + LED' },
  'led-array': { vi: '60 LED song song (120 linh kiện, thử hiệu năng)', en: '60 parallel LEDs (120 parts, performance)' },
};

/** Texts of the developer demo page (breadboard-demo.html). */
export const DEMO_TEXT = {
  title: { vi: 'MachSim — demo breadboard ảo', en: 'MachSim — virtual breadboard demo' },
  circuit: { vi: 'Mạch mẫu', en: 'Example circuit' },
  run: { vi: '▶ Chạy mô phỏng', en: '▶ Run simulation' },
  stop: { vi: '■ Dừng', en: '■ Stop' },
  empty: { vi: 'Board trống', en: 'Empty board' },
  arranged: { vi: 'Đã tự sắp xếp', en: 'Auto-arranged' },
  simError: { vi: 'Lỗi mô phỏng: ', en: 'Simulation error: ' },
  time: { vi: 'Thời gian mô phỏng', en: 'Simulated time' },
};

/** Title of the many-LED stress-test circuit. */
export const ledArrayTitle = (n: number): LocalizedText => L(`${n} LED song song`, `${n} parallel LEDs`);

/** Names of the jumper-wire colour swatches of the breadboard toolbar (same order as its palette). */
export const PALETTE_NAMES: LocalizedText[] = [
  { vi: 'Đỏ', en: 'Red' },
  { vi: 'Đen', en: 'Black' },
  { vi: 'Xanh dương', en: 'Blue' },
  { vi: 'Vàng', en: 'Yellow' },
  { vi: 'Xanh lá', en: 'Green' },
  { vi: 'Cam', en: 'Orange' },
  { vi: 'Tím', en: 'Violet' },
  { vi: 'Trắng', en: 'White' },
];
