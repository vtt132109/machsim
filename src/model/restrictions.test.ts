/**
 * Instructor restrictions: password hashing (known PBKDF2 / SHA-256 vectors, Web Crypto and the
 * plain fallback agree), the rules, the file format and the editor's enforcement.
 */
import { describe, expect, it } from 'vitest';
import { hmacSha256, pbkdf2Sha256, pbkdf2Sha256Sync, sha256, toHex, utf8 } from '../util/sha256';
import { DesignBuilder } from './designkit';
import { parseDesign, serializeDesign, DesignFormatError } from './serialize';
import { analysisAllowed, createRestrictions, instrumentAllowed, maskValue, partLocked, restrictionOptions, restrictionViolation, updateRestrictions, valuesHidden, verifyPassword } from './restrictions';
import { gradeAll, gradeAnswer, normalizeAnswerText, parseAnswerNumber } from './questions';
import { createEditor } from '../ui/store/editorStore';
import type { Design, StudentQuestion } from './types';

function circuit(): Design {
  const b = new DesignBuilder('Lab');
  b.part('sources/dc-voltage', 'V1', 0, 0, { value: '9' });
  b.part('basic/resistor', 'R1', 100, 0, { value: '1k' });
  b.part('instruments/multimeter', 'XMM1', 200, 0);
  return b.design;
}

describe('hashing', () => {
  it('SHA-256 / HMAC / PBKDF2 match the published test vectors', async () => {
    expect(toHex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    // RFC 4231 test case 2
    expect(toHex(hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    // RFC 7914 §11 (PBKDF2-HMAC-SHA-256, c = 1), first 32 bytes
    expect(toHex(pbkdf2Sha256Sync(utf8('passwd'), utf8('salt'), 1, 32))).toBe('55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc');
    const a = await pbkdf2Sha256(utf8('giảng viên'), utf8('0123456789abcdef'), 2000);
    expect(toHex(a)).toBe(toHex(pbkdf2Sha256Sync(utf8('giảng viên'), utf8('0123456789abcdef'), 2000)));
  });

  it('stores only a salted hash and verifies the password', async () => {
    const d = circuit();
    const r = await createRestrictions('thay-giao', { hideValues: true, lockParts: true }, d, '00112233445566778899aabbccddeeff');
    expect(JSON.stringify(r)).not.toContain('thay-giao');
    expect(r.passwordHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.lockedParts).toEqual(d.sheets[0].parts.map((p) => p.id));
    expect(await verifyPassword(r, 'thay-giao')).toBe(true);
    expect(await verifyPassword(r, 'thay-giao ')).toBe(false);
    // another salt gives another hash
    expect((await createRestrictions('thay-giao', {}, d, 'ffeeddccbbaa99887766554433221100')).passwordHash).not.toBe(r.passwordHash);
  });
});

describe('restriction rules', () => {
  it('answer what is hidden, locked and disabled', async () => {
    const d = circuit();
    d.restrictions = await createRestrictions('pw12', { hideValues: true, lockParts: true, disabledAnalyses: ['ac'], disabledInstruments: ['oscilloscope'] }, d);
    expect(valuesHidden(d)).toBe(true);
    expect(maskValue(d, '1k')).toBe('?');
    expect(partLocked(d, d.sheets[0].parts[1].id)).toBe(true);
    expect(analysisAllowed(d, 'ac')).toBe(false);
    expect(analysisAllowed(d, 'tran')).toBe(true);
    expect(instrumentAllowed(d, 'oscilloscope')).toBe(false);
    expect(instrumentAllowed(d, 'multimeter')).toBe(true);
    expect(restrictionOptions(d.restrictions)).toEqual({ hideValues: true, lockParts: true, disabledAnalyses: ['ac'], disabledInstruments: ['oscilloscope'], lockDescription: false, hideAnswers: false });
    // updating keeps the password and takes the locked parts again
    const u = updateRestrictions(d.restrictions!, { lockParts: true }, d);
    expect(u.passwordHash).toBe(d.restrictions!.passwordHash);
    expect(u.hideValues).toBeUndefined();
  });

  it('flags edits of locked parts and of a locked description box', async () => {
    const d = circuit();
    d.descriptionBox = { text: 'Đo R1', questions: [{ id: 'q1', kind: 'number', prompt: 'R1 = ?', answer: '1k' }] };
    d.restrictions = await createRestrictions('pw12', { lockParts: true, lockDescription: true }, d);
    const moved: Design = { ...d, sheets: [{ ...d.sheets[0], parts: d.sheets[0].parts.map((p, i) => (i === 1 ? { ...p, x: p.x + 10 } : p)) }] };
    expect(restrictionViolation(d, moved)).toBe('lockedPart');
    const deleted: Design = { ...d, sheets: [{ ...d.sheets[0], parts: d.sheets[0].parts.slice(0, 1) }] };
    expect(restrictionViolation(d, deleted)).toBe('lockedPart');
    const answered: Design = { ...d, descriptionBox: { ...d.descriptionBox!, answers: { q1: '1000' } } };
    expect(restrictionViolation(d, answered)).toBeNull();
    const edited: Design = { ...d, descriptionBox: { ...d.descriptionBox!, text: 'khác' } };
    expect(restrictionViolation(d, edited)).toBe('description');
    // the instructor dialog replaces the restrictions object: allowed
    expect(restrictionViolation(d, { ...moved, restrictions: undefined })).toBeNull();
  });

  it('the editor refuses to move, delete or edit a locked part but places new parts', async () => {
    const d = circuit();
    d.restrictions = await createRestrictions('pw12', { lockParts: true, disabledInstruments: ['oscilloscope'] }, d);
    const ed = createEditor({ design: d });
    const r1 = d.sheets[0].parts[1];
    ed.actions.select([{ kind: 'part', id: r1.id }]);
    ed.actions.nudge(10, 0);
    ed.actions.deleteSelection();
    ed.actions.setPartParam(r1.id, 'value', '2k');
    const now = ed.getState().design.sheets[0].parts.find((p) => p.id === r1.id)!;
    expect(now.x).toBe(r1.x);
    expect(now.params.value).toBe('1k');
    expect(ed.getState().simMessages.some((m) => m.source === 'instructor')).toBe(true);
    // a new part is free to edit
    const id = ed.actions.placePart('basic/resistor', { x: 300, y: 300 })!;
    ed.actions.setPartParam(id, 'value', '2k');
    expect(ed.getState().design.sheets[0].parts.find((p) => p.id === id)?.params.value).toBe('2k');
    // a disabled instrument cannot be placed
    expect(ed.actions.placePart('instruments/scope', { x: 400, y: 300 })).toBeNull();
  });
});

describe('student questions', () => {
  const q = (p: Partial<StudentQuestion>): StudentQuestion => ({ id: 'q', kind: 'number', prompt: '', ...p });
  it('grades numbers with tolerance, decimal comma and units', () => {
    expect(parseAnswerNumber('4,7k')).toBe(4700);
    expect(parseAnswerNumber('1,000')).toBe(1000);
    expect(parseAnswerNumber('3.84 V')).toBe(3.84);
    expect(gradeAnswer(q({ answer: '3.84', tolerance: 2 }), '3,8')).toBe('correct');
    expect(gradeAnswer(q({ answer: '3.84', tolerance: 0.5 }), '3.8')).toBe('wrong');
    expect(gradeAnswer(q({ answer: '4.7k' }), '4700 Ω')).toBe('correct');
    expect(gradeAnswer(q({ answer: '0' }), '0')).toBe('correct');
    expect(gradeAnswer(q({ answer: '1m' }), 'abc')).toBe('wrong');
    expect(gradeAnswer(q({ answer: '1m' }), '')).toBe('unanswered');
    expect(gradeAnswer(q({}), '5')).toBe('ungraded');
  });

  it('grades choices and short texts without case or accents', () => {
    expect(gradeAnswer(q({ kind: 'choice', options: ['a', 'b'], answer: '1' }), '1')).toBe('correct');
    expect(gradeAnswer(q({ kind: 'choice', options: ['a', 'b'], answer: '1' }), '0')).toBe('wrong');
    expect(normalizeAnswerText('  Điện Trở!  ')).toBe('dien tro');
    expect(gradeAnswer(q({ kind: 'text', answer: 'điện trở|resistor' }), 'Dien tro')).toBe('correct');
    expect(gradeAnswer(q({ kind: 'text', answer: 'điện trở|resistor' }), 'Resistor.')).toBe('correct');
    expect(gradeAnswer(q({ kind: 'text', answer: 'điện trở' }), 'tụ điện')).toBe('wrong');
    expect(gradeAll({ text: '', questions: [q({ id: 'a', answer: '1' }), q({ id: 'b', answer: '2' })], answers: { a: '1', b: '3' } })).toMatchObject({ total: 2, correct: 1, wrong: 1 });
  });
});

describe('file format', () => {
  it('round-trips the description box, restrictions and BOM fields', async () => {
    const d = circuit();
    d.sheets[0].parts[1].fields = { manufacturer: 'Yageo', partNumber: 'CFR-25JB-1K0', footprint: 'R_Axial' };
    d.descriptionBox = {
      text: '# Bài tập\nĐo $V_{R1}$\n![h](img:img1)',
      images: [{ id: 'img1', src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'h' }],
      questions: [
        { id: 'q1', kind: 'choice', prompt: 'R1?', options: ['1k', '2k'], answer: '0', explanation: 'Đọc màu' },
        { id: 'q2', kind: 'number', prompt: 'V?', answer: '9', tolerance: 2, unit: 'V' },
      ],
      answers: { q1: '0' },
      showOnOpen: true,
    };
    d.restrictions = await createRestrictions('pw12', { hideAnswers: true, disabledAnalyses: ['noise'] }, d);
    const back = parseDesign(serializeDesign(d));
    expect(back.descriptionBox).toEqual(d.descriptionBox);
    expect(back.restrictions).toEqual(d.restrictions);
    expect(back.sheets[0].parts[1].fields).toEqual(d.sheets[0].parts[1].fields);
    // a design without the new fields serialises without them
    expect(serializeDesign(circuit())).not.toMatch(/descriptionBox|restrictions|"fields"/);
  });

  it('reports invalid new fields with JSON paths', () => {
    const d = JSON.parse(serializeDesign(circuit()));
    d.descriptionBox = { text: 'x', images: [{ id: 'a', src: 'http://x/y.png' }], questions: [{ id: 'q', kind: 'choice', prompt: '', options: ['one'], answer: '3' }] };
    d.restrictions = { passwordHash: 'abc', salt: 'zz', iterations: 5, disabledAnalyses: ['bogus'] };
    d.sheets[0].parts[0].fields = { colour: 'red' };
    try {
      parseDesign(JSON.stringify(d));
      throw new Error('accepted');
    } catch (e) {
      expect(e).toBeInstanceOf(DesignFormatError);
      const issues = (e as DesignFormatError).issues.join('\n');
      expect(issues).toContain('descriptionBox.images[0].src');
      expect(issues).toContain('descriptionBox.questions[0].options');
      expect(issues).toContain('descriptionBox.questions[0].answer');
      expect(issues).toContain('restrictions.passwordHash');
      expect(issues).toContain('restrictions.salt');
      expect(issues).toContain('restrictions.iterations');
      expect(issues).toContain('restrictions.disabledAnalyses');
      expect(issues).toContain('sheets[0].parts[0].fields.colour');
    }
  });
});
