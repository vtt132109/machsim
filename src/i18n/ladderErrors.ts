/**
 * Texts of the ladder compiler's problems (`LadderError` of src/ladder/program.ts), Vietnamese
 * first. A separate small module because two places need them: the ladder editor (lazy) and the
 * ERC list (`explainErc`, eager), which shows the same problems found by the netlister.
 * Original text written for MachSim.
 *
 *   ladderErrorText(error)                         one compiler problem as a sentence
 *   ladderCodeText(code, text, limit)              the problem without the rung prefix
 */
import { interpolate, L, tr, type LocalizedText } from './core';
import type { LadderError } from '../ladder/program';

const errRung = L('Bậc {n}: {text}', 'Rung {n}: {text}');
const err: Record<string, LocalizedText> = {
  badAddress: L('địa chỉ “{text}” không đọc được', 'the address “{text}” cannot be read'),
  notBit: L('“{text}” không phải địa chỉ bit', '“{text}” is not a bit address'),
  notNumber: L('“{text}” không phải một số hay một địa chỉ số', '“{text}” is neither a number nor a number address'),
  writeInput: L('không ghi được vào ngõ vào “{text}” — ngõ vào do mạch quyết định', 'an input “{text}” cannot be written — the circuit decides it'),
  writeTimerBit: L('không ghi trực tiếp vào bit “{text}” của bộ định thời / bộ đếm', 'the timer / counter bit “{text}” cannot be written directly'),
  badPreset: L('giá trị đặt trước “{text}” không đọc được', 'the preset “{text}” cannot be read'),
  presetRequired: L('thiếu giá trị đặt trước (thời gian hay số lần)', 'the preset (a time or a count) is missing'),
  emptyGroup: L('có nhóm rỗng trong phần logic', 'there is an empty group in the logic'),
  noOutput: L('bậc chưa có cuộn dây nào', 'the rung has no coil yet'),
  range: L('“{text}” vượt giới hạn cho phép', '“{text}” is outside the allowed range'),
  notWritable: L('“{text}” không ghi được: đích của lệnh số học phải là một từ nhớ MW0…MW31 hoặc một ngõ ra tương tự AQ0…AQ3', '“{text}” cannot be written: the destination of a word instruction must be a memory word MW0…MW31 or an analog output AQ0…AQ3'),
  operandRequired: L('lệnh ghi vào “{text}” còn thiếu toán hạng A hoặc B', 'the instruction that writes “{text}” is missing operand A or B'),
  divZero: L('chia cho hằng số 0 (“{text}”)', 'division by the constant 0 (“{text}”)'),
  blockUnknown: L('không có khối hàm tên “{text}”', 'there is no function block called “{text}”'),
  blockRecursion: L('khối “{text}” gọi chính nó (trực tiếp hoặc qua khối khác)', 'block “{text}” calls itself (directly or through another block)'),
  blockDepth: L('khối “{text}” lồng nhau quá {limit} tầng', 'block “{text}” is nested more than {limit} levels deep'),
  blockName: L('“{text}” không phải một tên hợp lệ (chữ, số và dấu gạch dưới, không trùng, không phải EN)', '“{text}” is not a valid name (letters, digits and underscore, unique, not EN)'),
  blockArg: L('lời gọi chưa nối tham số “{text}” với địa chỉ nào', 'the call does not tie the parameter “{text}” to any address'),
  blockInstance: L('tên bản thể “{text}” đã được dùng cho một lời gọi khác', 'the instance name “{text}” is already used by another call'),
};
const errInBlock = L('{text} (trong khối {block}, bậc {inner})', '{text} (in block {block}, rung {inner})');
const errBlockDef = L('Khối {block}: {text}', 'Block {block}: {text}');

/** What is wrong, without the rung prefix; an unknown code reads as an unreadable address. */
export function ladderCodeText(code: string, text = '', limit: number | string = 0): string {
  return interpolate(tr(err[code] ?? err.badAddress), { text, limit });
}

/** One compiler problem as a sentence ("Rung 3: the address “Z9.9” cannot be read"). */
export function ladderErrorText(e: LadderError): string {
  return ladderProblemText({ rung: e.rung, code: e.code, text: e.text ?? '', limit: e.limit ?? 0, block: e.block ?? '', innerRung: e.innerRung ?? 0 });
}

/** The same from the plain parameters of an ERC message (`detail.params` of `ladderRung`). */
export function ladderProblemText(p: { rung: number | string; code: string; text?: string; limit?: number | string; block?: string; innerRung?: number | string }): string {
  let text = ladderCodeText(p.code, p.text ?? '', p.limit ?? 0);
  const block = p.block ?? '';
  if (Number(p.rung) === 0 && block) return interpolate(tr(errBlockDef), { block, text });
  if (block && p.code !== 'blockUnknown') text = interpolate(tr(errInBlock), { text, block, inner: p.innerRung ?? 0 });
  return interpolate(tr(errRung), { n: p.rung, text });
}
