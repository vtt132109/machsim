/**
 * Description box (Tools > Description box, floating window 'description'; loaded on first use).
 *
 * View mode renders the design's rich text (MachSim markup, formulas, pictures) and the student
 * questions with answer fields; answers are stored in the design (Design.descriptionBox.answers)
 * so a student can save the file and hand it in. "Check" grades an answer unless the instructor
 * hid the answers (src/model/questions.ts). Edit mode (not available while the instructor locked
 * the box) has a markup editor with a live preview, picture insertion and a question editor.
 * Every change is an editor commit (undo works; typing is coalesced).
 */
import { useMemo, useRef, useState } from 'react';
import type { Design, DescriptionBox as Box, DescriptionImage, QuestionKind, StudentQuestion } from '../../model/types';
import { gradeAll, gradeAnswer, newImageId, newQuestionId, type AnswerGrade } from '../../model/questions';
import { imageRefs, parseRichText } from '../../model/richText';
import { answersHidden, descriptionLocked } from '../../model/restrictions';
import { actions, useEditor } from '../store';
import { lt } from '../../i18n/learnUi';
import { RichText } from './RichText';
import './learn.css';

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Apply a change to the description box as one (coalesced) editor commit. */
function updateBox(fn: (box: Box) => Box, coalesce: string): void {
  actions.applyDesign((d: Design) => {
    const box = fn(d.descriptionBox ?? { text: '' });
    const empty = !box.text && !box.images?.length && !box.questions?.length && !box.answers && !box.showOnOpen;
    const next = { ...d };
    if (empty) delete next.descriptionBox;
    else next.descriptionBox = box;
    return next;
  }, { coalesce, windowMs: 1500 });
}

/** Pick a picture file as a data: URL (null when cancelled or too large). */
function pickImage(): Promise<{ src: string; name: string } | null | 'tooBig'> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/svg+xml,image/webp';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      if (f.size > MAX_IMAGE_BYTES) return resolve('tooBig');
      const reader = new FileReader();
      reader.onload = () => resolve({ src: String(reader.result), name: f.name.replace(/\.[^.]+$/, '') });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(f);
    };
    input.click();
  });
}

// ---------------------------------------------------------------------------------------------
// student view

function GradeText({ g }: { g: AnswerGrade }) {
  return <span className={`ms-q-grade is-${g}`}>{lt(`q.grade.${g}`)}</span>;
}

function StudentQuestionView({ q, n, answer, canCheck }: { q: StudentQuestion; n: number; answer: string | undefined; canCheck: boolean }) {
  const [checked, setChecked] = useState(false);
  const set = (v: string) => {
    setChecked(false);
    updateBox((b) => ({ ...b, answers: { ...(b.answers ?? {}), [q.id]: v } }), `desc-answer-${q.id}`);
  };
  const grade = gradeAnswer(q, answer);
  return (
    <div className="ms-q-student">
      <div>
        <strong>{lt('q.number', { n })}. </strong>
        <RichText text={q.prompt} />
      </div>
      {q.kind === 'choice' ? (
        (q.options ?? []).map((o, i) => (
          <label key={i} className="ms-inline">
            <input type="radio" name={`desc-q-${q.id}`} checked={answer === String(i)} title={o} onChange={() => set(String(i))} /> {o}
          </label>
        ))
      ) : (
        <label className="ms-inline">
          {lt('q.yourAnswer')}{' '}
          <input type="text" value={answer ?? ''} title={lt('q.yourAnswerTip')} onChange={(e) => set(e.target.value)} /> {q.unit ?? ''}
        </label>
      )}
      {canCheck ? (
        <div className="ms-q-row">
          <button type="button" className="ms-btn ms-btn-small" title={lt('q.checkTip')} onClick={() => setChecked(true)}>
            {lt('q.check')}
          </button>
          {checked ? <GradeText g={grade} /> : null}
        </div>
      ) : null}
      {checked && canCheck && q.explanation && grade !== 'unanswered' ? <RichText text={q.explanation} className="ms-hint" /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// editor

function QuestionEditor({ q, index, count }: { q: StudentQuestion; index: number; count: number }) {
  const patch = (p: Partial<StudentQuestion>) =>
    updateBox((b) => ({ ...b, questions: (b.questions ?? []).map((x) => (x.id === q.id ? { ...x, ...p } : x)) }), `desc-q-${q.id}`);
  const kinds: QuestionKind[] = ['choice', 'number', 'text'];
  return (
    <div className="ms-q-edit">
      <div className="ms-q-row">
        <strong>{lt('q.number', { n: index + 1 })}</strong>
        <label className="ms-inline">
          {lt('q.kind')}{' '}
          <select value={q.kind} title={lt('q.kindTip')} onChange={(e) => patch({ kind: e.target.value as QuestionKind, answer: '' })}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {lt(`q.kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <span className="ms-grow" />
        <button
          type="button"
          className="ms-btn ms-btn-small"
          disabled={index === 0}
          title={lt('q.upTip')}
          onClick={() =>
            updateBox((b) => {
              const qs = [...(b.questions ?? [])];
              [qs[index - 1], qs[index]] = [qs[index], qs[index - 1]];
              return { ...b, questions: qs };
            }, 'desc-q-move')
          }
        >
          {lt('q.up')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={lt('q.removeTip')} onClick={() => updateBox((b) => ({ ...b, questions: (b.questions ?? []).filter((x) => x.id !== q.id) }), 'desc-q-remove')}>
          {lt('q.remove')}
        </button>
      </div>
      <label>
        {lt('q.prompt')}
        <textarea rows={2} value={q.prompt} title={lt('q.promptTip')} onChange={(e) => patch({ prompt: e.target.value })} />
      </label>
      {q.kind === 'choice' ? (
        <>
          <label>
            {lt('q.options')}
            <textarea rows={Math.max(3, (q.options?.length ?? 0) + 1)} value={(q.options ?? []).join('\n')} title={lt('q.optionsTip')} onChange={(e) => patch({ options: e.target.value.split('\n') })} />
          </label>
          <label className="ms-inline">
            {lt('q.correct')}{' '}
            <select value={q.answer ?? ''} title={lt('q.correctTip')} onChange={(e) => patch({ answer: e.target.value })}>
              <option value="">{lt('q.choose')}</option>
              {(q.options ?? []).map((o, i) => (
                <option key={i} value={String(i)}>
                  {`${i + 1}. ${o}`}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <div className="ms-q-row">
          <label className="ms-inline">
            {lt('q.correct')}{' '}
            <input type="text" value={q.answer ?? ''} title={q.kind === 'number' ? lt('q.answerNumberTip') : lt('q.answerTextTip')} onChange={(e) => patch({ answer: e.target.value })} />
          </label>
          {q.kind === 'number' ? (
            <>
              <label className="ms-inline">
                {lt('q.tolerance')}{' '}
                <input type="number" min={0} step={1} style={{ width: '5em' }} value={q.tolerance ?? 5} title={lt('q.toleranceTip')} onChange={(e) => patch({ tolerance: Number(e.target.value) })} />
              </label>
              <label className="ms-inline">
                {lt('q.unit')}{' '}
                <input type="text" style={{ width: '5em' }} value={q.unit ?? ''} title={lt('q.unitTip')} onChange={(e) => patch({ unit: e.target.value })} />
              </label>
            </>
          ) : null}
        </div>
      )}
      <label>
        {lt('q.explanation')}
        <textarea rows={2} value={q.explanation ?? ''} title={lt('q.explanationTip')} onChange={(e) => patch({ explanation: e.target.value })} />
      </label>
      {index === count - 1 ? null : <hr />}
    </div>
  );
}

function BoxEditor({ box }: { box: Box }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  const setText = (text: string) => updateBox((b) => ({ ...b, text }), 'desc-text');
  /** Wrap the selection (or insert `fallback`) with markup. */
  const wrap = (before: string, after: string, fallback: string) => {
    const el = area.current;
    const text = box.text;
    const s = el?.selectionStart ?? text.length;
    const e = el?.selectionEnd ?? text.length;
    const inner = text.slice(s, e) || fallback;
    setText(text.slice(0, s) + before + inner + after + text.slice(e));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + before.length, s + before.length + inner.length);
    });
  };
  /** Insert a new line of markup at the cursor line. */
  const line = (prefix: string, fallback: string) => {
    const el = area.current;
    const text = box.text;
    const s = el?.selectionStart ?? text.length;
    const start = text.lastIndexOf('\n', s - 1) + 1;
    const insert = `${start === s ? '' : '\n'}${prefix}${fallback}\n`;
    const at = start === s ? s : text.indexOf('\n', s) < 0 ? text.length : text.indexOf('\n', s);
    setText(text.slice(0, at) + insert + text.slice(at));
  };
  const addImage = async () => {
    const r = await pickImage();
    if (r === 'tooBig') {
      setError(lt('desc.imageTooBig'));
      return;
    }
    if (!r) return;
    setError(null);
    const id = newImageId(box);
    const img: DescriptionImage = { id, src: r.src, alt: r.name };
    const el = area.current;
    const s = el?.selectionEnd ?? box.text.length;
    const ref = `\n![${r.name}](img:${id})\n`;
    updateBox((b) => ({ ...b, images: [...(b.images ?? []), img], text: b.text.slice(0, s) + ref + b.text.slice(s) }), 'desc-image');
  };
  const used = useMemo(() => new Set(imageRefs(parseRichText(box.text))), [box.text]);
  const unused = (box.images ?? []).filter((im) => !used.has(im.id));
  return (
    <div className="ms-desc-edit">
      <div>
        <div className="ms-desc-bar">
          <button type="button" className="ms-btn ms-btn-small" title={lt('desc.boldTip')} onClick={() => wrap('**', '**', lt('desc.bold'))}>
            <b>{lt('desc.bold')}</b>
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={lt('desc.italicTip')} onClick={() => wrap('*', '*', lt('desc.italic'))}>
            <i>{lt('desc.italic')}</i>
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={lt('desc.headingTip')} onClick={() => line('## ', lt('desc.heading'))}>
            {lt('desc.heading')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={lt('desc.listTip')} onClick={() => line('- ', lt('desc.list'))}>
            {lt('desc.list')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={lt('desc.formulaTip')} onClick={() => wrap('$', '$', 'U = I \\cdot R')}>
            {lt('desc.formula')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={lt('desc.imageTip')} onClick={() => void addImage()}>
            {lt('desc.image')}
          </button>
          {unused.length ? (
            <button type="button" className="ms-btn ms-btn-small" title={lt('desc.unusedImagesTip')} onClick={() => updateBox((b) => ({ ...b, images: (b.images ?? []).filter((im) => used.has(im.id)) }), 'desc-image')}>
              {lt('desc.unusedImages', { n: unused.length })}
            </button>
          ) : null}
        </div>
        {error ? <p className="ms-inst-error">{error}</p> : null}
        <textarea ref={area} className="ms-desc-text" value={box.text} title={lt('desc.textTip')} aria-label={lt('desc.text')} onChange={(e) => setText(e.target.value)} />
        <div className="ms-desc-syntax">{lt('desc.syntax')}</div>
        <label className="ms-inline">
          <input type="checkbox" checked={!!box.showOnOpen} title={lt('desc.showOnOpenTip')} onChange={(e) => updateBox((b) => ({ ...b, showOnOpen: e.target.checked || undefined }), 'desc-show')} /> {lt('desc.showOnOpen')}
        </label>
        <h4>{lt('desc.preview')}</h4>
        <RichText text={box.text} images={box.images} />
        <h4>{lt('q.title')}</h4>
        {(box.questions ?? []).map((q, i, all) => (
          <QuestionEditor key={q.id} q={q} index={i} count={all.length} />
        ))}
        <button
          type="button"
          className="ms-btn ms-btn-small"
          title={lt('q.addTip')}
          onClick={() => updateBox((b) => ({ ...b, questions: [...(b.questions ?? []), { id: newQuestionId(b), kind: 'choice', prompt: '', options: ['', ''] }] }), 'desc-q-add')}
        >
          {lt('q.add')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// panel

export function DescriptionBoxPanel() {
  const design = useEditor((s) => s.design);
  const box = design.descriptionBox ?? { text: '' };
  const locked = descriptionLocked(design);
  const canCheck = !answersHidden(design);
  const [editing, setEditing] = useState(false);
  const summary = gradeAll(box);
  const isEditing = editing && !locked;
  return (
    <div className="ms-desc">
      <div className="ms-desc-bar">
        <span className="ms-grow">{locked ? <span className="ms-desc-locked">{lt('desc.locked')}</span> : null}</span>
        {!locked ? (
          <button type="button" className="ms-btn ms-btn-small" title={isEditing ? lt('desc.doneTip') : lt('desc.editTip')} onClick={() => setEditing(!isEditing)}>
            {isEditing ? lt('desc.done') : lt('desc.edit')}
          </button>
        ) : null}
      </div>
      <div className="ms-desc-body">
        {isEditing ? (
          <BoxEditor box={box} />
        ) : (
          <>
            {box.text.trim() ? <RichText text={box.text} images={box.images} /> : !box.questions?.length ? <p className="ms-empty">{lt('desc.empty')}</p> : null}
            {box.questions?.length ? (
              <section>
                <h4>{lt('q.title')}</h4>
                {box.questions.map((q, i) => (
                  <StudentQuestionView key={q.id} q={q} n={i + 1} answer={box.answers?.[q.id]} canCheck={canCheck} />
                ))}
                {canCheck ? <p className="ms-hint">{lt('q.summary', { correct: summary.correct, total: summary.total })}</p> : <p className="ms-hint">{lt('q.hiddenAnswers')}</p>}
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
