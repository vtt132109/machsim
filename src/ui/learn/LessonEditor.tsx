/**
 * Lesson editor (lazy chunk): a teacher writes a lesson inside MachSim — goal, theory, the steps
 * MachSim checks on the student's own circuit, and the quiz — and saves it as a .msimlesson file.
 *
 * Every field is filled in both languages, because the Lessons panel has its own VI / EN switch.
 * A step picks one of the four described check kinds (src/learn/lessonFile.ts) and fills in what it
 * needs; the problems the validator finds are listed under the buttons, so a teacher can see at a
 * glance what is still missing. The open design can be grabbed as the starter circuit or as the
 * reference solution with one click.
 */
import { useState } from 'react';
import type { LocalizedText } from '../../i18n/core';
import { lt } from '../../i18n/learnUi';
import { t } from '../../i18n';
import { LESSON_LEVELS } from '../../learn/types';
import { LEVELS } from '../../i18n/lessons';
import { tr } from '../../i18n';
import {
  newCheckSpec,
  newLessonFile,
  parseLessonFile,
  serializeLessonFile,
  type LessonCheckSpec,
  type LessonEnd,
  type LessonFile,
  type LessonFileError,
  type LessonPartSpec,
  type LessonProbe,
} from '../../learn/lessonFile';
import { AC_READINGS, TRAN_READINGS, type LessonAnalysis } from '../../learn/readings';
import { parseUserNumber, formatEng } from '../../util/units';
import { ZERO_TOLERANCE } from '../../learn/kit';
import { Dialog } from '../common/Dialog';
import { getState } from '../store';
import { serializeDesign } from '../../model/serialize';
import { parseDesignSafely } from '../../model/sanitize';
import './learn.css';

type Patch = (f: LessonFile) => LessonFile;

const CHECK_KINDS: LessonCheckSpec['kind'][] = ['part', 'connected', 'measure', 'erc'];
const PROBE_KINDS: LessonProbe['kind'][] = ['meter', 'net', 'partVoltage', 'partCurrent'];

/** Two text boxes, Vietnamese and English, for one localized field. */
function BiField({ label, hint, value, rows = 1, onChange }: { label: string; hint?: string; value: LocalizedText; rows?: number; onChange: (v: LocalizedText) => void }) {
  const Box = rows > 1 ? 'textarea' : 'input';
  return (
    <div className="ms-ed-bi">
      <label>
        <span>
          {label} · {lt('ed.vi')}
        </span>
        <Box className="ms-input" rows={rows > 1 ? rows : undefined} title={hint ?? label} value={value.vi} onChange={(e: { target: { value: string } }) => onChange({ ...value, vi: e.target.value })} />
      </label>
      <label>
        <span>
          {label} · {lt('ed.en')}
        </span>
        <Box className="ms-input" rows={rows > 1 ? rows : undefined} title={hint ?? label} value={value.en} onChange={(e: { target: { value: string } }) => onChange({ ...value, en: e.target.value })} />
      </label>
    </div>
  );
}

const listText = (v: string[] | undefined): string => (v ?? []).join(', ');
const parseList = (text: string): string[] | undefined => {
  const out = text
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return out.length ? out : undefined;
};

function PartFields({ spec, onChange }: { spec: LessonPartSpec; onChange: (v: LessonPartSpec) => void }) {
  const set = (key: keyof LessonPartSpec, text: string) => {
    const next: LessonPartSpec = { ...spec };
    const list = parseList(text);
    if (list) next[key] = list;
    else delete next[key];
    onChange(next);
  };
  return (
    <div className="ms-ed-row">
      <label>
        <span>{lt('ed.partIds')}</span>
        <input className="ms-input" title={lt('ed.partIdsTip')} value={listText(spec.ids)} onChange={(e) => set('ids', e.target.value)} />
      </label>
      <label>
        <span>{lt('ed.partFamilies')}</span>
        <input className="ms-input" title={lt('ed.partFamiliesTip')} value={listText(spec.families)} onChange={(e) => set('families', e.target.value)} />
      </label>
      <label>
        <span>{lt('ed.partInstruments')}</span>
        <input className="ms-input" title={lt('ed.partInstrumentsTip')} value={listText(spec.instruments)} onChange={(e) => set('instruments', e.target.value)} />
      </label>
    </div>
  );
}

function EndFields({ label, end, onChange }: { label: string; end: LessonEnd; onChange: (v: LessonEnd) => void }) {
  const ground = 'ground' in end;
  return (
    <fieldset className="ms-ed-end">
      <legend>{label}</legend>
      <label className="ms-check">
        <input type="checkbox" checked={ground} title={lt('ed.toGround')} onChange={(e) => onChange(e.target.checked ? { ground: true } : { pin: '1', part: { families: ['Resistor'] } })} />
        <span>{lt('ed.toGround')}</span>
      </label>
      {ground ? null : (
        <>
          <label>
            <span>{lt('ed.pin')}</span>
            <input className="ms-input" title={lt('ed.pinTip')} value={end.pin} onChange={(e) => onChange({ ...end, pin: e.target.value })} />
          </label>
          <PartFields spec={end.part} onChange={(part) => onChange({ ...end, part })} />
        </>
      )}
    </fieldset>
  );
}

function CheckFields({ check, onChange }: { check: LessonCheckSpec; onChange: (v: LessonCheckSpec) => void }) {
  if (check.kind === 'part') {
    return (
      <>
        <PartFields spec={check.part} onChange={(part) => onChange({ ...check, part })} />
        <label className="ms-ed-small">
          <span>{lt('ed.count')}</span>
          <input className="ms-input" type="number" min={1} max={99} title={lt('ed.count')} value={check.count ?? 1} onChange={(e) => onChange({ ...check, count: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })} />
        </label>
      </>
    );
  }
  if (check.kind === 'connected') {
    return (
      <>
        <EndFields label={lt('ed.from')} end={check.from} onChange={(from) => onChange({ ...check, from })} />
        <EndFields label={lt('ed.to')} end={check.to} onChange={(to) => onChange({ ...check, to })} />
      </>
    );
  }
  if (check.kind === 'erc') return null;
  const probe = check.probe;
  const analysis: LessonAnalysis = check.analysis ?? { kind: 'op' };
  // a meter reading and a part current exist at the operating point only
  const probeKinds = analysis.kind === 'op' ? PROBE_KINDS : PROBE_KINDS.filter((k) => k === 'net' || k === 'partVoltage');
  const setAnalysis = (next: LessonAnalysis) => {
    const rest = { ...check };
    delete rest.analysis;
    const probeOk = next.kind === 'op' || probe.kind === 'net' || probe.kind === 'partVoltage';
    onChange({ ...rest, ...(next.kind === 'op' ? {} : { analysis: next }), ...(probeOk ? {} : { probe: { kind: 'net', net: 'OUT' } satisfies LessonProbe }) });
  };
  const secondsInput = (value: number | undefined, tip: string, set: (v: number | undefined) => void) => (
    <input
      className="ms-input"
      title={tip}
      defaultValue={value === undefined ? '' : formatEng(value, '', 6)}
      onBlur={(e) => {
        const raw = e.target.value.trim();
        const v = parseUserNumber(raw);
        set(raw === '' || !Number.isFinite(v) || v < 0 ? undefined : v);
      }}
    />
  );
  return (
    <>
      <label>
        <span>{lt('ed.analysis')}</span>
        <select
          className="ms-select"
          title={lt('ed.analysisTip')}
          value={analysis.kind}
          onChange={(e) => setAnalysis(e.target.value === 'tran' ? { kind: 'tran', tstop: 5e-3, reading: 'final' } : e.target.value === 'ac' ? { kind: 'ac', freq: 1e3, reading: 'mag' } : { kind: 'op' })}
        >
          {(['op', 'tran', 'ac'] as const).map((k) => (
            <option key={k} value={k}>
              {lt(`ed.analysis.${k}`)}
            </option>
          ))}
        </select>
      </label>
      {analysis.kind === 'tran' ? (
        <div className="ms-ed-row">
          <label>
            <span>{lt('ed.tstop')}</span>
            {secondsInput(analysis.tstop, lt('ed.tstopTip'), (v) => v !== undefined && v > 0 && setAnalysis({ ...analysis, tstop: v }))}
          </label>
          <label>
            <span>{lt('ed.reading')}</span>
            <select className="ms-select" title={lt('ed.reading')} value={analysis.reading} onChange={(e) => setAnalysis({ ...analysis, reading: e.target.value as (typeof TRAN_READINGS)[number] })}>
              {TRAN_READINGS.map((r) => (
                <option key={r} value={r}>
                  {lt(`ed.reading.${r}`)}
                </option>
              ))}
            </select>
          </label>
          {analysis.reading === 'at' ? (
            <label>
              <span>{lt('ed.atTime')}</span>
              {secondsInput(analysis.at, lt('ed.tstopTip'), (v) => setAnalysis({ ...analysis, at: v ?? 0 }))}
            </label>
          ) : analysis.reading !== 'final' ? (
            <label>
              <span>{lt('ed.fromTime')}</span>
              {secondsInput(analysis.from, lt('ed.fromTimeTip'), (v) => {
                const { from: _drop, ...rest } = analysis;
                void _drop;
                setAnalysis(v === undefined || v === 0 ? rest : { ...rest, from: v });
              })}
            </label>
          ) : null}
        </div>
      ) : null}
      {analysis.kind === 'ac' ? (
        <div className="ms-ed-row">
          <label>
            <span>{lt('ed.freq')}</span>
            {secondsInput(analysis.freq, lt('ed.freqTip'), (v) => v !== undefined && v > 0 && setAnalysis({ ...analysis, freq: v }))}
          </label>
          <label>
            <span>{lt('ed.reading')}</span>
            <select className="ms-select" title={lt('ed.reading')} value={analysis.reading} onChange={(e) => setAnalysis({ ...analysis, reading: e.target.value as (typeof AC_READINGS)[number] })}>
              {AC_READINGS.map((r) => (
                <option key={r} value={r}>
                  {lt(`ed.reading.${r}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <label>
        <span>{lt('ed.probe')}</span>
        <select
          className="ms-select"
          title={lt('ed.probe')}
          value={probe.kind}
          onChange={(e) => {
            const kind = e.target.value as LessonProbe['kind'];
            const next: LessonProbe = kind === 'meter' ? { kind } : kind === 'net' ? { kind, net: 'OUT' } : { kind, part: { families: ['Resistor'] } };
            onChange({ ...check, probe: next });
          }}
        >
          {probeKinds.map((k) => (
            <option key={k} value={k}>
              {lt(`ed.probe.${k}`)}
            </option>
          ))}
        </select>
      </label>
      {probe.kind === 'net' ? (
        <label>
          <span>{lt('ed.net')}</span>
          <input className="ms-input" title={lt('ed.netTip')} value={probe.net} onChange={(e) => onChange({ ...check, probe: { kind: 'net', net: e.target.value } })} />
        </label>
      ) : null}
      {probe.kind === 'partVoltage' || probe.kind === 'partCurrent' ? <PartFields spec={probe.part} onChange={(part) => onChange({ ...check, probe: { kind: probe.kind, part } })} /> : null}
      <div className="ms-ed-row">
        <label>
          <span>{lt('ed.target')}</span>
          <input
            className="ms-input"
            title={lt('ed.targetTip')}
            defaultValue={formatEng(check.target, '', 6)}
            onBlur={(e) => {
              const v = parseUserNumber(e.target.value);
              if (Number.isFinite(v)) onChange({ ...check, target: v });
            }}
          />
        </label>
        <label>
          <span>{lt('ed.tolerance')}</span>
          <input className="ms-input" type="number" min={0.1} max={100} step={0.1} title={lt('ed.tolerance')} value={check.tolerancePct} onChange={(e) => onChange({ ...check, tolerancePct: Math.max(0.1, Math.min(100, Number(e.target.value) || 5)) })} />
        </label>
        <label>
          <span>{lt('ed.unit')}</span>
          <input className="ms-input" title={lt('ed.unit')} value={check.unit} onChange={(e) => onChange({ ...check, unit: e.target.value })} />
        </label>
        <label>
          <span>{lt('ed.toleranceAbs')}</span>
          <input
            className="ms-input"
            title={lt('ed.toleranceAbsTip')}
            defaultValue={check.toleranceAbs === undefined ? '' : formatEng(check.toleranceAbs, '', 6)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const v = parseUserNumber(raw);
              const next = { ...check };
              if (raw === '' || !Number.isFinite(v) || v <= 0) delete next.toleranceAbs;
              else next.toleranceAbs = v;
              onChange(next);
            }}
          />
        </label>
      </div>
      {check.target === 0 && check.toleranceAbs === undefined ? <p className="ms-hint">{lt('ed.zeroTarget', { band: formatEng(ZERO_TOLERANCE, check.unit, 3) })}</p> : null}
    </>
  );
}

/** How many problems a field has, and the first one's text. */
function problemText(errors: readonly LessonFileError[], prefix: string): string | null {
  const hit = errors.filter((e) => e.path === prefix || e.path.startsWith(`${prefix}.`) || e.path.startsWith(`${prefix}[`));
  if (!hit.length) return null;
  return `${hit[0].path}: ${lt(`ed.err.${hit[0].code}`)}${hit[0].detail ? ` (${hit[0].detail})` : ''}`;
}

function partCount(text: string | undefined): number {
  if (!text) return 0;
  try {
    return parseDesignSafely(text).design.sheets.reduce((n, s) => n + s.parts.length, 0);
  } catch {
    return 0;
  }
}

export function LessonEditorBody({ initial, close, onSave }: { initial: LessonFile; close: () => void; onSave: (file: LessonFile, write: boolean) => void }) {
  const [file, setFile] = useState<LessonFile>(initial);
  const patch = (fn: Patch) => setFile((f) => fn(f));
  const errors = parseLessonFile(serializeLessonFile(file)).errors;

  const stepAt = (i: number, fn: (s: LessonFile['steps'][number]) => LessonFile['steps'][number]) =>
    patch((f) => ({ ...f, steps: f.steps.map((s, k) => (k === i ? fn(s) : s)) }));
  const quizAt = (i: number, fn: (q: LessonFile['quiz'][number]) => LessonFile['quiz'][number]) =>
    patch((f) => ({ ...f, quiz: f.quiz.map((q, k) => (k === i ? fn(q) : q)) }));
  const move = <T,>(list: T[], i: number, d: number): T[] => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const out = [...list];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  };

  return (
    <div className="ms-form ms-lesson-editor">
      <p className="ms-hint">{lt('ed.intro')}</p>
      <div className="ms-ed-row">
        <label>
          <span>{lt('ed.id')}</span>
          <input className="ms-input" title={lt('ed.idTip')} value={file.id} onChange={(e) => patch((f) => ({ ...f, id: e.target.value.trim() }))} />
        </label>
        <label>
          <span>{lt('ed.level')}</span>
          <select className="ms-select" title={lt('ed.levelTip')} value={file.level} onChange={(e) => patch((f) => ({ ...f, level: e.target.value as LessonFile['level'] }))}>
            {LESSON_LEVELS.map((l) => (
              <option key={l} value={l}>
                {tr(LEVELS[l])}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{lt('ed.author')}</span>
          <input className="ms-input" title={lt('ed.authorTip')} value={file.author ?? ''} onChange={(e) => patch((f) => ({ ...f, author: e.target.value }))} />
        </label>
      </div>
      <BiField label={lt('ed.lessonTitle')} value={file.title} onChange={(title) => patch((f) => ({ ...f, title }))} />
      <BiField label={lt('ed.goal')} value={file.goal} rows={2} onChange={(goal) => patch((f) => ({ ...f, goal }))} />
      <BiField label={lt('ed.theory')} hint={lt('ed.theoryTip')} value={file.theory} rows={6} onChange={(theory) => patch((f) => ({ ...f, theory }))} />

      <div className="ms-prop-head">
        <strong>{lt('ed.steps')}</strong>
        <button type="button" className="ms-btn ms-btn-small" title={lt('ed.addStepTip')} onClick={() => patch((f) => ({ ...f, steps: [...f.steps, { id: `step${f.steps.length + 1}`, task: { vi: '', en: '' }, hint: { vi: '', en: '' }, check: newCheckSpec('part') }] }))}>
          {lt('ed.addStep')}
        </button>
      </div>
      {file.steps.length ? null : <p className="ms-hint">{lt('ed.needSteps')}</p>}
      {file.steps.map((s, i) => (
        <fieldset key={i} className="ms-ed-step">
          <legend>
            {i + 1}. {s.id}
          </legend>
          <div className="ms-ed-row">
            <label>
              <span>{lt('ed.id')}</span>
              <input className="ms-input" title={lt('ed.idTip')} value={s.id} onChange={(e) => stepAt(i, (x) => ({ ...x, id: e.target.value.trim() }))} />
            </label>
            <label>
              <span>{lt('ed.checkKind')}</span>
              <select className="ms-select" title={lt('ed.checkKindTip')} value={s.check.kind} onChange={(e) => stepAt(i, (x) => ({ ...x, check: newCheckSpec(e.target.value as LessonCheckSpec['kind']) }))}>
                {CHECK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {lt(`ed.check.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <span className="ms-ed-buttons">
              <button type="button" className="ms-btn ms-btn-small" title={lt('ed.up')} onClick={() => patch((f) => ({ ...f, steps: move(f.steps, i, -1) }))}>
                ↑
              </button>
              <button type="button" className="ms-btn ms-btn-small" title={lt('ed.down')} onClick={() => patch((f) => ({ ...f, steps: move(f.steps, i, 1) }))}>
                ↓
              </button>
              <button type="button" className="ms-btn ms-btn-small" title={lt('ed.remove')} onClick={() => patch((f) => ({ ...f, steps: f.steps.filter((_, k) => k !== i) }))}>
                ✕
              </button>
            </span>
          </div>
          <BiField label={lt('ed.stepTask')} value={s.task} onChange={(task) => stepAt(i, (x) => ({ ...x, task }))} />
          <BiField label={lt('ed.stepHint')} value={s.hint} onChange={(hint) => stepAt(i, (x) => ({ ...x, hint }))} />
          <CheckFields check={s.check} onChange={(check) => stepAt(i, (x) => ({ ...x, check }))} />
          {problemText(errors, `steps[${i}]`) ? <p className="ms-ed-problem">{problemText(errors, `steps[${i}]`)}</p> : null}
        </fieldset>
      ))}

      <div className="ms-prop-head">
        <strong>{lt('ed.quiz')}</strong>
        <button
          type="button"
          className="ms-btn ms-btn-small"
          title={lt('ed.addQuizTip')}
          onClick={() => patch((f) => ({ ...f, quiz: [...f.quiz, { id: `q${f.quiz.length + 1}`, question: { vi: '', en: '' }, options: [{ vi: '', en: '' }, { vi: '', en: '' }], answer: 0, why: { vi: '', en: '' } }] }))}
        >
          {lt('ed.addQuiz')}
        </button>
      </div>
      {file.quiz.map((q, i) => (
        <fieldset key={i} className="ms-ed-step">
          <legend>
            {i + 1}. {q.id}
          </legend>
          <BiField label={lt('ed.question')} value={q.question} onChange={(question) => quizAt(i, (x) => ({ ...x, question }))} />
          <div className="ms-ed-bi">
            <label>
              <span>
                {lt('ed.options')} · {lt('ed.vi')}
              </span>
              <textarea
                className="ms-input"
                rows={3}
                title={lt('ed.options')}
                value={q.options.map((o) => o.vi).join('\n')}
                onChange={(e) => {
                  const lines = e.target.value.split('\n');
                  quizAt(i, (x) => ({ ...x, options: lines.map((v, k) => ({ vi: v, en: x.options[k]?.en ?? '' })) }));
                }}
              />
            </label>
            <label>
              <span>
                {lt('ed.options')} · {lt('ed.en')}
              </span>
              <textarea
                className="ms-input"
                rows={3}
                title={lt('ed.options')}
                value={q.options.map((o) => o.en).join('\n')}
                onChange={(e) => {
                  const lines = e.target.value.split('\n');
                  quizAt(i, (x) => ({ ...x, options: lines.map((v, k) => ({ en: v, vi: x.options[k]?.vi ?? '' })) }));
                }}
              />
            </label>
          </div>
          <div className="ms-ed-row">
            <label className="ms-ed-small">
              <span>{lt('ed.answer')}</span>
              <input className="ms-input" type="number" min={1} max={Math.max(1, q.options.length)} title={lt('ed.answer')} value={q.answer + 1} onChange={(e) => quizAt(i, (x) => ({ ...x, answer: Math.max(0, (Number(e.target.value) || 1) - 1) }))} />
            </label>
            <span className="ms-ed-buttons">
              <button type="button" className="ms-btn ms-btn-small" title={lt('ed.remove')} onClick={() => patch((f) => ({ ...f, quiz: f.quiz.filter((_, k) => k !== i) }))}>
                ✕
              </button>
            </span>
          </div>
          <BiField label={lt('ed.why')} value={q.why} onChange={(why) => quizAt(i, (x) => ({ ...x, why }))} />
          {problemText(errors, `quiz[${i}]`) ? <p className="ms-ed-problem">{problemText(errors, `quiz[${i}]`)}</p> : null}
        </fieldset>
      ))}

      <div className="ms-prop-head">
        <strong>{lt('ed.circuits')}</strong>
      </div>
      <div className="ms-btn-row">
        <button type="button" className="ms-btn ms-btn-small" title={lt('ed.grabStarterTip')} onClick={() => patch((f) => ({ ...f, starter: serializeDesign(getState().design) }))}>
          {lt('ed.grabStarter')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={lt('ed.grabSolutionTip')} onClick={() => patch((f) => ({ ...f, solution: serializeDesign(getState().design) }))}>
          {lt('ed.grabSolution')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={lt('ed.clearStarter')} disabled={!file.starter} onClick={() => patch(({ starter: _drop, ...rest }) => rest as LessonFile)}>
          {lt('ed.clearStarter')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={lt('ed.clearSolution')} disabled={!file.solution} onClick={() => patch(({ solution: _drop, ...rest }) => rest as LessonFile)}>
          {lt('ed.clearSolution')}
        </button>
      </div>
      <p className="ms-hint">
        {lt('ed.grabStarter')}: {file.starter ? lt('ed.hasCircuit', { n: partCount(file.starter) }) : lt('ed.noCircuit')} · {lt('ed.grabSolution')}: {file.solution ? lt('ed.hasCircuit', { n: partCount(file.solution) }) : lt('ed.noCircuit')}
      </p>

      <p className={errors.length ? 'ms-ed-problem' : 'ms-hint'}>{errors.length ? `${lt('ed.problems', { n: errors.length })} — ${errors[0].path}: ${lt(`ed.err.${errors[0].code}`)}` : lt('ed.ready')}</p>
      <div className="ms-btn-row">
        <button type="button" className="ms-btn ms-btn-primary" title={lt('ed.saveTip')} disabled={!!errors.length} onClick={() => onSave(file, true)}>
          {lt('ed.save')}
        </button>
        <button type="button" className="ms-btn" title={lt('ed.applyTip')} disabled={!!errors.length} onClick={() => onSave(file, false)}>
          {lt('ed.apply')}
        </button>
        <button type="button" className="ms-btn" onClick={close}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

/** The editor dialog, for `openLessonEditor` in lessonFlows.tsx. */
export function LessonEditorDialog({ initial, close, onSave }: { initial?: LessonFile; close: () => void; onSave: (file: LessonFile, write: boolean) => void }) {
  return (
    <Dialog title={lt('ed.title')} onClose={close} width="min(900px, 96vw)">
      <LessonEditorBody initial={initial ?? newLessonFile()} close={close} onSave={onSave} />
    </Dialog>
  );
}
