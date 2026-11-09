/**
 * Lessons loaded from files on this computer: storage round trip, a damaged entry skipped, the
 * registry the Lessons panel reads, and that a file can never shadow a built-in lesson.
 */
import { describe, expect, it } from 'vitest';
import { LESSONS, allLessons, customLessons, getLesson, lessonTextOf, nextLesson, setCustomLessons } from '../../learn/lessons';
import { compileLessonFile, newLessonFile, serializeLessonFile, type LessonFile } from '../../learn/lessonFile';
import { readLessonFiles, writeLessonFiles, LESSON_FILES_KEY } from './customLessons';
import type { KeyValueStorage } from '../app/files';

function memory(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

/** A small but complete lesson file. */
function lessonFile(id: string, title = 'Bài của cô Lan'): LessonFile {
  return {
    ...newLessonFile(id),
    author: 'Cô Lan',
    title: { vi: title, en: 'Miss Lan’s lesson' },
    goal: { vi: 'Đặt hai điện trở.', en: 'Place two resistors.' },
    theory: { vi: '## Lý thuyết\n$U = I \\cdot R$', en: '## Theory\n$V = I \\cdot R$' },
    steps: [{ id: 'two', task: { vi: 'Đặt hai điện trở.', en: 'Place two resistors.' }, hint: { vi: '', en: '' }, check: { kind: 'part', part: { families: ['Resistor'] }, count: 2 } }],
    quiz: [],
  };
}

describe('lesson files on this computer', () => {
  it('writes and reads them back through browser storage', () => {
    const store = memory();
    const list = [lessonFile('lan-1'), lessonFile('lan-2', 'Bài thứ hai')];
    writeLessonFiles(store, list);
    expect(store.data[LESSON_FILES_KEY]).toContain('lan-2');
    const back = readLessonFiles(store);
    expect(back.map((f) => f.id)).toEqual(['lan-1', 'lan-2']);
    expect(back.map(serializeLessonFile)).toEqual(list.map(serializeLessonFile));
  });

  it('skips a damaged entry instead of losing the others, and survives nonsense', () => {
    const store = memory({ [LESSON_FILES_KEY]: JSON.stringify([serializeLessonFile(lessonFile('ok-1')), '{not json', 7, JSON.stringify({ format: 'machsim-lesson', version: 1 })]) });
    expect(readLessonFiles(store).map((f) => f.id)).toEqual(['ok-1']);
    expect(readLessonFiles(memory({ [LESSON_FILES_KEY]: 'nonsense' }))).toEqual([]);
    expect(readLessonFiles(memory({ [LESSON_FILES_KEY]: '{}' }))).toEqual([]);
    expect(readLessonFiles(null)).toEqual([]);
    // a storage that throws does not take the app down
    const hostile: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };
    expect(() => writeLessonFiles(hostile, [])).not.toThrow();
  });
});

describe('the lesson registry the panel reads', () => {
  it('lists file lessons after the built-in ones and finds their text', () => {
    const compiled = compileLessonFile(lessonFile('lan-1'));
    setCustomLessons([compiled]);
    try {
      expect(allLessons().length).toBe(LESSONS.length + 1);
      expect(allLessons()[LESSONS.length].id).toBe('lan-1');
      expect(getLesson('lan-1')?.level).toBe('basics');
      expect(lessonTextOf('lan-1')?.title.vi).toBe('Bài của cô Lan');
      // built-in text still comes from the catalogue
      expect(lessonTextOf('ohm')?.title.vi).toBeTruthy();
      expect(lessonTextOf('nothing')).toBeUndefined();
      // the last built-in lesson now has a next one
      expect(nextLesson(LESSONS[LESSONS.length - 1].id)?.id).toBe('lan-1');
      expect(nextLesson('lan-1')).toBeUndefined();
      expect(customLessons()).toHaveLength(1);
    } finally {
      setCustomLessons([]);
    }
    expect(allLessons()).toBe(LESSONS);
    expect(getLesson('lan-1')).toBeUndefined();
  });

  it('never lets a file shadow a built-in lesson or another file', () => {
    setCustomLessons([compileLessonFile(lessonFile('ohm', 'Giả mạo')), compileLessonFile(lessonFile('lan-1')), compileLessonFile(lessonFile('lan-1', 'Bản sau'))]);
    try {
      expect(customLessons().map((c) => c.def.id)).toEqual(['lan-1']);
      expect(lessonTextOf('ohm')?.title.vi).not.toBe('Giả mạo');
      expect(lessonTextOf('lan-1')?.title.vi).toBe('Bài của cô Lan');
    } finally {
      setCustomLessons([]);
    }
  });
});
