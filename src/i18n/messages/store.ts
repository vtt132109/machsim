/** UI messages: store. [vi, en] */
import type { Catalogue } from '../types';

export default {
  'store.refdes.referenceDesignatorCannotBeEmpty': ['Ký hiệu linh kiện không được để trống', 'Reference designator cannot be empty'],
  'store.refdes.useLettersDigitsAndMust': ['Dùng chữ cái, chữ số và "_" (phải bắt đầu bằng chữ cái)', 'Use letters, digits and "_" (must start with a letter)'],
  'store.refdes.tIsAlreadyUsed': ['"{t}" đã được dùng', '"{t}" is already used'],
} as const satisfies Catalogue;
