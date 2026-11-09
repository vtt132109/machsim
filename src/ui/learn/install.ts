/**
 * Start-up wiring of the learning tools (small; the panels load on first use):
 *   - floating windows 'lessons' (Lessons panel) and 'description' (description box),
 *   - commands help.lessons, tools.descriptionBox, options.instructor,
 *   - the description box opens by itself when a file whose box has "show on open" is opened.
 * Called once by the shell (App.tsx).
 */
import { createElement } from 'react';
import { lazyComponent } from '../common/lazy';
import { defineBuiltinCommand, openFloatingWindow, registerFloatingWindowKind } from '../app/extensions';
import { getState, subscribe } from '../store';
import { t } from '../../i18n';

const LessonsPanel = lazyComponent(() => import('./LessonsPanel').then((m) => m.LessonsPanel));
const DescriptionBoxPanel = lazyComponent(() => import('./DescriptionBox').then((m) => m.DescriptionBoxPanel));

/** Open the Lessons panel (optionally on one lesson). */
export function openLessons(lessonId?: string): void {
  openFloatingWindow('lessons', lessonId ? { lessonId } : {});
}

export function openDescriptionBox(): void {
  openFloatingWindow('description', {});
}

let installed = false;

export function installLearn(): void {
  if (installed) return;
  installed = true;
  registerFloatingWindowKind('lessons', {
    title: () => t('learn.window.lessons'),
    render: (p) => createElement(LessonsPanel, { lessonId: typeof p.lessonId === 'string' ? p.lessonId : undefined }),
    defaultSize: { w: 440, h: 620 },
    minSize: { w: 320, h: 300 },
  });
  registerFloatingWindowKind('description', {
    title: () => t('learn.window.description'),
    render: () => createElement(DescriptionBoxPanel, {}),
    defaultSize: { w: 520, h: 520 },
    minSize: { w: 320, h: 240 },
  });
  defineBuiltinCommand('help.lessons', () => openLessons());
  defineBuiltinCommand('tools.descriptionBox', () => openDescriptionBox());
  defineBuiltinCommand('options.instructor', async () => (await import('./InstructorDialog')).openInstructorDialog());

  // "show on open": a freshly loaded document (no undo history yet) whose box asks for it
  let last = getState().design;
  subscribe(() => {
    const s = getState();
    if (s.design === last) return;
    last = s.design;
    if (s.design.descriptionBox?.showOnOpen && s.history.past.length === 0 && s.history.future.length === 0 && s.design === s.savedDesign) openDescriptionBox();
  });
}
