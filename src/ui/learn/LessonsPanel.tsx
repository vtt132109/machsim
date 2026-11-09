/**
 * Lessons panel (Help > Lessons, floating window 'lessons'; loaded on first use).
 *
 * The list groups the guided lessons by level with each lesson's progress. A lesson page shows
 * the goal, the theory (MachSim markup with formulas), the steps with live status and feedback,
 * hints, and the quiz. Steps are checked automatically on the open design: the drawing-only
 * checks on every change, the simulating ones after a short pause (or at once with "Check now");
 * a passed step stays passed (src/learn/progress.ts). The panel has its own VI / EN switch for
 * the lesson text, independent of the UI language.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LESSON_LEVELS, allLessons, getLesson, lessonTextOf, nextLesson } from '../../learn/lessons';
import { installCustomLessons, removeCustomLesson, useCustomLessons } from './customLessons';
import { checkLesson, simulatingSteps, structuralSteps } from '../../learn/runner';
import type { RunFn } from '../../learn/circuit';
import type { CheckResult, Feedback, LessonDef } from '../../learn/types';
import { PROGRESS_KEY, answerQuiz, lessonStatus, markPassed, parseProgress, resetLesson, serializeProgress, setCurrent, type LessonProgress } from '../../learn/progress';
import { LEVELS, NOUNS, feedbackText, type LessonText } from '../../i18n/lessons';
import { lt } from '../../i18n/learnUi';
import { explainErc, explainSimError } from '../../i18n/erc';
import { getLang, interpolate, tr, type Lang } from '../../i18n';
import type { Design, ErcMessage } from '../../model/types';
import { useEditor } from '../store';
import { newLocalizedDesign } from '../store/editorStore';
import { createStore } from '../store/createStore';
import { browserStorage } from '../app/files';
import { openGeneratedDesign } from '../app/document';
import { FullModeNotice, lessonHiddenCommands } from './fullMode';
import { confirmDialog } from '../common/dialogs';
import { RichText } from './RichText';
import './learn.css';

// ---------------------------------------------------------------------------------------------
// progress (per computer, browser storage)

function loadProgress(): LessonProgress {
  try {
    return parseProgress(browserStorage()?.getItem(PROGRESS_KEY));
  } catch {
    return parseProgress(null);
  }
}

/** Lesson progress of this computer, persisted on every change. */
export const lessonProgress = createStore<LessonProgress>(loadProgress());
lessonProgress.subscribe(() => {
  try {
    browserStorage()?.setItem(PROGRESS_KEY, serializeProgress(lessonProgress.getState()));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
});

/** The simulator (loaded on first use, in-process: lesson circuits are small). */
let sim: Promise<typeof import('../../sim')> | null = null;
const runner: RunFn = async (netlist) => {
  sim ??= import('../../sim');
  return (await sim).runAnalyses(netlist);
};

/** Feedback of a check in `lang`. */
export function feedbackLine(note: Feedback, lang: Lang): string {
  const text = feedbackText(note.id);
  if (!text) return note.id;
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(note.params ?? {})) params[k] = typeof v === 'object' ? tr(NOUNS[v.noun], lang) : v;
  if (note.id === 'ercError') {
    try {
      params.message = explainErc(JSON.parse(String(note.params?.erc)) as ErcMessage).title;
    } catch {
      params.message = String(note.params?.erc ?? '');
    }
  }
  if (note.id === 'simFailed') params.message = explainSimError(String(note.params?.message ?? '')).title;
  return interpolate(tr(text, lang), params);
}

/** Text of a lesson; a lesson whose text went missing falls back to its id so nothing crashes. */
function textOf(id: string): LessonText {
  return lessonTextOf(id) ?? { title: { vi: id, en: id }, goal: { vi: '', en: '' }, theory: { vi: '', en: '' }, steps: {}, quiz: {} };
}

/** A lesson's design, titled and named in the current UI language. */
function lessonDesign(lesson: LessonDef, which: 'start' | 'solution'): Design {
  const title = tr(textOf(lesson.id).title);
  const base = newLocalizedDesign(title);
  const d = which === 'solution' ? lesson.solution() : lesson.starter?.() ?? base;
  d.title = which === 'solution' ? `${title} (${lt('lessons.solutionSuffix')})` : title;
  if (d !== base) d.sheets[0].name = base.sheets[0].name;
  return d;
}

const fileNameOf = (title: string) => `${title.replace(/[<>:"/\\|?*]/g, '_')}.msim`;

/** Lesson-file flows (editor, open, progress export / import) load on first use. */
const lessonFlows = () => import('./lessonFlows');

// ---------------------------------------------------------------------------------------------
// list

function LessonList({ lang, onOpen }: { lang: Lang; onOpen: (id: string) => void }) {
  const progress = useSyncExternalStore(lessonProgress.subscribe, lessonProgress.getState, lessonProgress.getState);
  const files = useCustomLessons();
  const fileIds = new Set(files.map((f) => f.id));
  const lessons = allLessons();
  const authorOf = (id: string) => files.find((f) => f.id === id)?.author;
  return (
    <>
      <p className="ms-hint">{lt('lessons.intro', undefined, lang)}</p>
      {LESSON_LEVELS.map((level) => {
        const inLevel = lessons.filter((l) => l.level === level);
        if (!inLevel.length) return null;
        return (
          <section key={level}>
            <div className="ms-lessons-level">{tr(LEVELS[level], lang)}</div>
            {inLevel.map((l) => {
              const st = lessonStatus(progress, l);
              const text = textOf(l.id);
              const author = authorOf(l.id);
              return (
                <button key={l.id} type="button" className="ms-lesson-row" title={lt('lessons.openTip', { title: tr(text.title, lang) }, lang)} onClick={() => onOpen(l.id)}>
                  <span className={`ms-lesson-badge${st.complete ? ' is-done' : ''}`}>{st.complete ? lt('lessons.doneBadge', undefined, lang) : `${st.stepsPassed}/${st.stepsTotal}`}</span>
                  <span>
                    <strong>{tr(text.title, lang)}</strong>
                    <small>{tr(text.goal, lang)}</small>
                    {fileIds.has(l.id) ? <small className="ms-lesson-author">{author ? lt('lessons.byAuthor', { author }, lang) : lt('lessons.teacherBadge', undefined, lang)}</small> : null}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
      <section className="ms-lesson-section">
        <h4>{lt('lessons.files', undefined, lang)}</h4>
        <div className="ms-btn-row">
          <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.openFileTip', undefined, lang)} onClick={() => void lessonFlows().then((m) => m.openLessonFileFlow())}>
            {lt('lessons.openFile', undefined, lang)}
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.newLessonTip', undefined, lang)} onClick={() => void lessonFlows().then((m) => m.openLessonEditor())}>
            {lt('lessons.newLesson', undefined, lang)}
          </button>
        </div>
        {files.map((f) => (
          <div key={f.id} className="ms-lesson-file">
            <span className="ms-grow">{tr(f.title, lang)}</span>
            <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.newLessonTip', undefined, lang)} onClick={() => void lessonFlows().then((m) => m.openLessonEditor(f.id))}>
              {lt('lessons.editLesson', undefined, lang)}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.removeFileTip', undefined, lang)} onClick={() => void lessonFlows().then((m) => m.removeLessonFileFlow(f, removeCustomLesson))}>
              {lt('lessons.removeFile', undefined, lang)}
            </button>
          </div>
        ))}
        <div className="ms-btn-row">
          <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.exportProgressTip', undefined, lang)} onClick={() => void lessonFlows().then((m) => m.exportProgressFlow())}>
            {lt('lessons.exportProgress', undefined, lang)}
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.importProgressTip', undefined, lang)} onClick={() => void lessonFlows().then((m) => m.importProgressFlow())}>
            {lt('lessons.importProgress', undefined, lang)}
          </button>
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// lesson page

function LessonView({ lesson, lang, onOpen }: { lesson: LessonDef; lang: Lang; onOpen: (id: string | undefined) => void }) {
  const design = useEditor((s) => s.design);
  const progress = useSyncExternalStore(lessonProgress.subscribe, lessonProgress.getState, lessonProgress.getState);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [checking, setChecking] = useState(false);
  const [hints, setHints] = useState<Record<string, boolean>>({});
  const text = textOf(lesson.id);
  const passed = new Set(progress.steps[lesson.id] ?? []);
  const status = lessonStatus(progress, lesson);
  const designRef = useRef(design);
  designRef.current = design;

  const apply = useCallback(
    (r: Record<string, CheckResult>) => {
      setResults((prev) => ({ ...prev, ...r }));
      const ok = Object.entries(r)
        .filter(([, x]) => x.ok)
        .map(([k]) => k);
      if (ok.length) lessonProgress.setState((p) => markPassed(p, lesson.id, ok));
    },
    [lesson],
  );

  const pending = useCallback((ids: string[]) => {
    const done = new Set(lessonProgress.getState().steps[lesson.id] ?? []);
    return ids.filter((s) => !done.has(s));
  }, [lesson]);

  // drawing checks at once, simulating checks after a pause (restarted by every edit)
  useEffect(() => {
    let cancelled = false;
    const structural = pending(structuralSteps(lesson));
    if (structural.length) void checkLesson(lesson, design, runner, structural).then((r) => !cancelled && apply(r));
    const timer = setTimeout(() => {
      const simSteps = pending(simulatingSteps(lesson));
      if (!simSteps.length) return;
      setChecking(true);
      void checkLesson(lesson, design, runner, simSteps)
        .then((r) => !cancelled && apply(r))
        .finally(() => !cancelled && setChecking(false));
    }, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [design, lesson, apply, pending]);

  const checkNow = () => {
    const ids = pending(lesson.steps.map((s) => s.id));
    if (!ids.length) return;
    setChecking(true);
    void checkLesson(lesson, designRef.current, runner, ids)
      .then(apply)
      .finally(() => setChecking(false));
  };

  const firstOpen = lesson.steps.find((s) => !passed.has(s.id))?.id;
  const next = nextLesson(lesson.id);
  const answers = progress.quiz[lesson.id] ?? {};

  return (
    <>
      <div className="ms-lesson-bar" aria-hidden="true">
        <span style={{ width: `${(100 * (status.stepsPassed + status.quizCorrect)) / Math.max(1, status.stepsTotal + status.quizTotal)}%` }} />
      </div>
      <div className="ms-lesson-goal">
        <strong>{lt('lessons.goal', undefined, lang)}: </strong>
        {tr(text.goal, lang)}
      </div>
      <FullModeNotice commands={lessonHiddenCommands(text)} lang={lang} />
      <div className="ms-btn-row">
        <button type="button" className="ms-btn ms-btn-primary" title={lt('lessons.startTip', undefined, lang)} onClick={() => void openGeneratedDesign(lessonDesign(lesson, 'start'), fileNameOf(tr(text.title)))}>
          {lt('lessons.start', undefined, lang)}
        </button>
        <button
          type="button"
          className="ms-btn"
          title={lt('lessons.solutionTip', undefined, lang)}
          onClick={async () => {
            const ok = await confirmDialog({ title: lt('lessons.solution', undefined, lang), message: lt('lessons.solutionConfirm', undefined, lang), okLabel: lt('lessons.solution', undefined, lang) });
            if (ok) {
              const d = lessonDesign(lesson, 'solution');
              await openGeneratedDesign(d, fileNameOf(d.title));
            }
          }}
        >
          {lt('lessons.solution', undefined, lang)}
        </button>
      </div>

      <details className="ms-lesson-section" open={!status.stepsPassed}>
        <summary>{lt('lessons.theory', undefined, lang)}</summary>
        <RichText text={tr(text.theory, lang)} lang={lang} />
      </details>

      <section className="ms-lesson-section">
        <h4>
          {lt('lessons.steps', undefined, lang)} · {lt('lessons.progress', { n: status.stepsPassed, total: status.stepsTotal }, lang)}
        </h4>
        <ol className="ms-lesson-steps">
          {lesson.steps.map((s, i) => {
            const done = passed.has(s.id);
            const r = results[s.id];
            const t = text.steps[s.id];
            const icon = done ? '✓' : checking && s.simulates && s.id === firstOpen ? '…' : s.id === firstOpen ? '●' : '○';
            return (
              <li key={s.id} className={`ms-lesson-step${done ? ' is-ok' : ''}${s.id === firstOpen ? ' is-current' : ''}`}>
                <span className="ms-step-icon" aria-label={done ? lt('lessons.passed', undefined, lang) : lt('lessons.notYet', undefined, lang)}>
                  {icon}
                </span>
                <span>
                  {i + 1}. {tr(t.task, lang)}
                </span>
                {r?.note ? <span className={`ms-step-note${!done && !r.ok ? ' is-bad' : ''}`}>{feedbackLine(r.note, lang)}</span> : null}
                <span className="ms-step-actions">
                  <button type="button" className="ms-linkbtn" aria-expanded={!!hints[s.id]} title={lt('lessons.hintTip', undefined, lang)} onClick={() => setHints((h) => ({ ...h, [s.id]: !h[s.id] }))}>
                    {lt('lessons.hint', undefined, lang)}
                  </button>
                </span>
                {hints[s.id] ? <span className="ms-step-hint">{tr(t.hint, lang)}</span> : null}
              </li>
            );
          })}
        </ol>
        <div className="ms-btn-row">
          <button type="button" className="ms-btn ms-btn-small" disabled={checking || status.stepsPassed === status.stepsTotal} title={lt('lessons.checkTip', undefined, lang)} onClick={checkNow}>
            {checking ? lt('lessons.checking', undefined, lang) : lt('lessons.check', undefined, lang)}
          </button>
        </div>
        <p className="ms-hint">{lt('lessons.sticky', undefined, lang)}</p>
      </section>

      <section className="ms-lesson-section">
        <h4>
          {lt('lessons.quiz', undefined, lang)} · {lt('lessons.quizProgress', { n: status.quizCorrect, total: status.quizTotal }, lang)}
        </h4>
        {lesson.quiz.map((q, qi) => {
          const qt = text.quiz[q.id];
          const chosen = answers[q.id];
          const right = chosen === q.answer;
          return (
            <fieldset key={q.id} className="ms-quiz-q">
              <legend>
                {qi + 1}. {tr(qt.q, lang)}
              </legend>
              {qt.options.map((o, oi) => (
                <label key={oi}>
                  <input type="radio" name={`quiz-${lesson.id}-${q.id}`} checked={chosen === oi} title={lt('lessons.option', { n: oi + 1 }, lang)} onChange={() => lessonProgress.setState((p) => answerQuiz(p, lesson.id, q.id, oi))} />
                  <span>{tr(o, lang)}</span>
                </label>
              ))}
              {chosen !== undefined ? (
                <div className={`ms-quiz-feedback${right ? ' is-ok' : ' is-bad'}`}>
                  {right ? `${lt('lessons.right', undefined, lang)} ${tr(qt.why, lang)}` : lt('lessons.wrong', undefined, lang)}
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </section>

      {status.complete ? <div className="ms-lesson-complete">{lt('lessons.complete', undefined, lang)}</div> : null}
      <div className="ms-lesson-foot">
        {next ? (
          <button type="button" className="ms-btn ms-btn-primary" title={lt('lessons.nextTip', undefined, lang)} onClick={() => onOpen(next.id)}>
            {lt('lessons.next', undefined, lang)}
          </button>
        ) : null}
        <button
          type="button"
          className="ms-btn"
          title={lt('lessons.resetTip', undefined, lang)}
          onClick={async () => {
            if (await confirmDialog({ title: lt('lessons.reset', undefined, lang), message: lt('lessons.resetConfirm', { title: tr(text.title, lang) }, lang), danger: true })) {
              lessonProgress.setState((p) => resetLesson(p, lesson.id));
              setResults({});
            }
          }}
        >
          {lt('lessons.reset', undefined, lang)}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// panel

export function LessonsPanel({ lessonId }: { lessonId?: string }) {
  // lessons a teacher loaded from files are listed next to the built-in ones
  installCustomLessons();
  const [lang, setPanelLang] = useState<Lang>(getLang());
  const [openId, setOpenId] = useState<string | undefined>(() => lessonId ?? lessonProgress.getState().current);
  const lesson = openId ? getLesson(openId) : undefined;
  const open = (id: string | undefined) => {
    setOpenId(id);
    lessonProgress.setState((p) => setCurrent(p, id));
  };
  return (
    <div className="ms-lessons">
      <div className="ms-lessons-head">
        {lesson ? (
          <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.backTip', undefined, lang)} onClick={() => open(undefined)}>
            {lt('lessons.back', undefined, lang)}
          </button>
        ) : null}
        <span className="ms-grow">{lesson ? tr(textOf(lesson.id).title, lang) : lt('lessons.title', undefined, lang)}</span>
        <button type="button" className="ms-btn ms-btn-small" title={lt('lessons.langTip', undefined, lang)} onClick={() => setPanelLang(lang === 'vi' ? 'en' : 'vi')}>
          {lt('lessons.lang', undefined, lang)}
        </button>
      </div>
      <div className="ms-lessons-body">{lesson ? <LessonView key={lesson.id} lesson={lesson} lang={lang} onOpen={open} /> : <LessonList lang={lang} onOpen={open} />}</div>
    </div>
  );
}
