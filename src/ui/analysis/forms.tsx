/**
 * Parameter forms for every AnalysisSpec type, including the meta analyses with a nested base
 * analysis editor (parameter / temperature / nested sweeps, Monte Carlo, worst case, trace width)
 * and the batch item list. Forms are controlled: they emit a complete new spec on every change
 * and display the `issues` of `validateSpec` (paths relative to the spec they edit).
 */

import { useState } from 'react';
import type {
  AcAnalysis,
  AcSingleAnalysis,
  AnalysisSpec,
  AnalysisType,
  BatchAnalysis,
  DcAnalysis,
  DistoAnalysis,
  FourierAnalysis,
  MeasureSpec,
  MonteCarloAnalysis,
  NestedSweepAnalysis,
  NoiseAnalysis,
  NoiseFigureAnalysis,
  ParamSweepAnalysis,
  PzAnalysis,
  SensAnalysis,
  SweepType,
  TempSweepAnalysis,
  TfAnalysis,
  ToleranceSpec,
  TraceWidthAnalysis,
  TranAnalysis,
  UserAnalysis,
  WorstCaseAnalysis,
} from '../../sim/netlist';
import { parseUserControls } from '../../sim/analyses/user';
import { CheckField, FieldRow, Group, IssueList, ListField, NumField, SelectField, TextField } from './fields';
import {
  ANALYSIS_CATALOG,
  BASE_TYPES,
  MEASURE_FUNCS,
  MEASURE_LABELS,
  META_TYPES,
  analysisHeadline,
  analysisInfo,
  dcPointCount,
  defaultSpec,
  frequencyPointCount,
  hasErrors,
  issuesAt,
  issuesUnder,
  nodesFromOutputs,
  elementParamChoices,
  normalizeElements,
  paramForTarget,
  sourceUnit,
  sweepUnit,
  sweepValues,
} from './specs';
import type { AnalysisElementInfo, SpecContext, SpecIssue } from './specs';
import { t } from '../../i18n';

export interface FormContext extends SpecContext {
  /** the dialog's current settings per type, offered when choosing a nested analysis */
  templates?: Partial<Record<AnalysisType, AnalysisSpec>>;
}

export interface SpecFormProps<S extends AnalysisSpec = AnalysisSpec> {
  spec: S;
  onChange: (spec: AnalysisSpec) => void;
  ctx: FormContext;
  issues: readonly SpecIssue[];
  /** nesting depth (0 = top level) */
  depth?: number;
}

/** Deep copy of a spec (specs are plain JSON data). */
export function cloneSpec<S extends AnalysisSpec>(spec: S): S {
  return JSON.parse(JSON.stringify(spec)) as S;
}

const SWEEP_OPTIONS: readonly (readonly [SweepType, string])[] = [
  ['dec', 'Decade'],
  ['oct', 'Octave'],
  ['lin', 'Linear'],
  ['list', 'List'],
];

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

interface FrequencySweepValue {
  sweep: SweepType;
  points: number;
  fstart: number;
  fstop: number;
  list?: number[];
}

function FrequencySweep({ value, onChange, issues, allowList }: { value: FrequencySweepValue; onChange: (v: FrequencySweepValue) => void; issues: readonly SpecIssue[]; allowList: boolean }) {
  const at = (p: string) => issuesAt(issues, p);
  const n = frequencyPointCount(value.sweep, value.points, value.fstart, value.fstop, value.list);
  return (
    <Group title={t('common.frequency')}>
      <FieldRow>
        <SelectField label={t('analysis.forms.sweepType')} value={value.sweep} options={allowList ? SWEEP_OPTIONS : SWEEP_OPTIONS.filter((o) => o[0] !== 'list')} onChange={(sweep) => onChange({ ...value, sweep, list: sweep === 'list' ? value.list ?? [value.fstart > 0 ? value.fstart : 1e3] : value.list })} issues={at('sweep')} />
      </FieldRow>
      {value.sweep === 'list' ? (
        <ListField label={t('analysis.forms.frequencies')} unit="Hz" values={value.list ?? []} onChange={(list) => onChange({ ...value, list })} issues={at('list')} />
      ) : (
        <FieldRow>
          <NumField label={t('analysis.forms.startFrequency')} unit="Hz" value={value.fstart} min={0} onChange={(v) => onChange({ ...value, fstart: v ?? value.fstart })} issues={at('fstart')} />
          <NumField label={t('analysis.forms.stopFrequency')} unit="Hz" value={value.fstop} min={0} exclusiveMin onChange={(v) => onChange({ ...value, fstop: v ?? value.fstop })} issues={at('fstop')} />
          <NumField
            label={value.sweep === 'lin' ? t('analysis.forms.numberOfPoints') : value.sweep === 'dec' ? t('analysis.specs.pointsPerDecade') : t('analysis.specs.pointsPerOctave')}
            value={value.points}
            integer
            min={1}
            onChange={(v) => onChange({ ...value, points: v ?? value.points })}
            issues={at('points')}
            size={6}
          />
        </FieldRow>
      )}
      <span className="msa-hint">{Number.isFinite(n) ? t('analysis.forms.roundFrequencyPoints', { round: Math.round(n) }) : ''}</span>
    </Group>
  );
}

/** Values generator for sweeps: start / stop / points with linear, decade or octave spacing. */
function ValuesGenerator({ unit, onGenerate }: { unit: string; onGenerate: (values: number[]) => void }) {
  const [start, setStart] = useState<number | undefined>(1);
  const [stop, setStop] = useState<number | undefined>(10);
  const [points, setPoints] = useState<number | undefined>(5);
  const [kind, setKind] = useState<'lin' | 'dec' | 'oct'>('lin');
  const values = start !== undefined && stop !== undefined && points !== undefined ? sweepValues(start, stop, points, kind) : [];
  return (
    <div className="msa-generator">
      <SelectField
        label={t('analysis.forms.fill')}
        value={kind}
        options={[
          ['lin', t('common.linear')],
          ['dec', t('common.decade')],
          ['oct', t('common.octave')],
        ]}
        onChange={setKind}
      />
      <NumField label={t('common.start')} unit={unit} value={start} onChange={setStart} size={7} />
      <NumField label={t('common.stop')} unit={unit} value={stop} onChange={setStop} size={7} />
      <NumField label={kind === 'lin' ? t('common.points') : kind === 'dec' ? t('analysis.forms.pointsPerDecadeShort') : t('analysis.forms.pointsPerOctaveShort')} value={points} integer min={1} max={10000} onChange={setPoints} size={5} />
      <button type="button" className="msa-btn" disabled={!values.length} onClick={() => onGenerate(values)} title={values.length ? t('analysis.forms.lengthValues', { length: values.length }) : t('analysis.forms.enterAValidRange')}>
        {t('analysis.forms.generateLength', { length: values.length })}
      </button>
    </div>
  );
}

/** The element / model of a list whose name matches `name` (case-insensitive). */
function byName(list: readonly AnalysisElementInfo[], name: string): AnalysisElementInfo | undefined {
  const key = name.trim().toLowerCase();
  return list.find((e) => e.name.toLowerCase() === key);
}

interface SweepTargetValue {
  target: string;
  param: string;
  model?: boolean;
  /** a global parameter (design variable): stepped by rebuilding the circuit per value */
  global?: boolean;
  values: number[];
}

function SweepTarget({ value, onChange, ctx, issues, title, allowVariable = false }: { value: SweepTargetValue; onChange: (v: SweepTargetValue) => void; ctx: FormContext; issues: readonly SpecIssue[]; title: string; allowVariable?: boolean }) {
  const at = (p: string) => issuesAt(issues, p);
  const els = normalizeElements(ctx.elements).filter((e) => !!e.model === !!value.model);
  const el = els.find((e) => e.name.toLowerCase() === value.target.trim().toLowerCase());
  const params = elementParamChoices(el, !!value.model);
  const variables = ctx.variables ?? [];
  const unit = value.global ? '' : sweepUnit(value.target, value.param, value.model);
  const kindOf = value.global ? 'variable' : value.model ? 'model' : 'element';
  const options: (readonly [string, string])[] = [
    ['element', t('analysis.forms.componentParameter')],
    ['model', t('analysis.forms.modelParameter')],
  ];
  if ((allowVariable && variables.length > 0) || value.global) options.push(['variable', t('analysis.forms.globalParameter')]);
  return (
    <Group title={title}>
      <FieldRow>
        <SelectField
          label={t('analysis.forms.sweepOf')}
          value={kindOf}
          options={options}
          onChange={(k) => {
            if (k === 'variable') onChange({ ...value, global: true, model: undefined, target: variables.find((v) => v.toLowerCase() === value.target.toLowerCase()) ?? variables[0] ?? '', param: 'value' });
            else onChange({ ...value, global: undefined, model: k === 'model' ? true : undefined, param: k === 'model' ? '' : 'value' });
          }}
        />
        {value.global ? (
          <TextField label={t('analysis.forms.globalParameterName')} value={value.target} suggestions={variables} onChange={(target) => onChange({ ...value, target })} issues={at('target')} size={12} />
        ) : (
          <>
            <TextField label={value.model ? t('analysis.forms.model') : t('analysis.forms.component')} value={value.target} suggestions={els.map((e) => e.name)} onChange={(target) => onChange({ ...value, target, param: paramForTarget(byName(els, target), value.param, !!value.model) })} issues={at('target')} size={10} />
            <TextField label={t('common.parameter')} value={value.param} suggestions={params} onChange={(param) => onChange({ ...value, param })} issues={at('param')} size={8} />
          </>
        )}
      </FieldRow>
      {value.global ? <span className="msa-hint">{t('analysis.forms.globalParameterHint')}</span> : null}
      <ListField label={t('common.values')} unit={unit || undefined} values={value.values} onChange={(values) => onChange({ ...value, values })} issues={at('values')} />
      <ValuesGenerator unit={unit} onGenerate={(values) => onChange({ ...value, values })} />
    </Group>
  );
}

/** Picker for the analysis a meta analysis repeats, plus its nested form. */
function BaseEditor({
  base,
  onChange,
  ctx,
  issues,
  depth,
  title = t('analysis.forms.analysisToRepeat'),
  allowed = BASE_TYPES,
}: {
  base: AnalysisSpec;
  onChange: (base: AnalysisSpec) => void;
  ctx: FormContext;
  issues: readonly SpecIssue[];
  depth: number;
  title?: string;
  allowed?: readonly AnalysisType[];
}) {
  const choose = (t: AnalysisType) => {
    const tpl = ctx.templates?.[t];
    onChange(tpl && tpl.type === t && !META_TYPES.has(t) ? cloneSpec(tpl) : defaultSpec(t, ctx));
  };
  return (
    <Group title={title}>
      <FieldRow>
        <SelectField label={t('common.analysis')} value={base.type} options={allowed.map((t) => [t, analysisInfo(t).title] as const)} onChange={choose} issues={issuesAt(issues, 'base')} />
      </FieldRow>
      <div className="msa-nested">
        <SpecForm spec={base} onChange={onChange} ctx={ctx} issues={issuesUnder(issues, 'base')} depth={depth + 1} />
      </div>
    </Group>
  );
}

function Tolerances({ value, onChange, ctx, issues }: { value: ToleranceSpec[]; onChange: (v: ToleranceSpec[]) => void; ctx: FormContext; issues: readonly SpecIssue[] }) {
  const all = normalizeElements(ctx.elements);
  const set = (i: number, t: ToleranceSpec) => onChange(value.map((x, k) => (k === i ? t : x)));
  const add = () => {
    // the next component that has a value and no tolerance row yet; its part tolerance prefills
    const used = new Set(value.filter((t) => !t.model).map((t) => t.target.trim().toLowerCase()));
    const comps = all.filter((e) => !e.model && e.hasValue !== false);
    const first = comps.find((e) => !used.has(e.name.toLowerCase())) ?? comps[0] ?? all.find((e) => !e.model);
    const tol = first?.tol !== undefined && first.tol > 0 && first.tol < 1 ? first.tol : 0.05;
    onChange([...value, { target: first?.name ?? '', param: elementParamChoices(first)[0] ?? 'value', tol, dist: 'uniform' }]);
  };
  return (
    <Group
      title={t('analysis.forms.tolerancesLength', { length: value.length })}
      actions={
        <button type="button" className="msa-btn" onClick={add}>
          {t('analysis.forms.addTolerance')}
        </button>
      }
    >
      <IssueList issues={issuesAt(issues, 'tolerances')} />
      {value.map((tol, i) => {
        const p = `tolerances.${i}`;
        const els = all.filter((e) => !!e.model === !!tol.model);
        const el = els.find((e) => e.name.toLowerCase() === tol.target.trim().toLowerCase());
        return (
          <div key={i} className="msa-tolerance">
            <SelectField
              label={t('common.type')}
              value={tol.model ? 'model' : 'element'}
              options={[
                ['element', t('analysis.forms.component')],
                ['model', t('analysis.forms.model')],
              ]}
              onChange={(k) => set(i, { ...tol, model: k === 'model' ? true : undefined, param: k === 'model' ? '' : 'value' })}
            />
            <TextField label={tol.model ? t('analysis.forms.model') : t('analysis.forms.component')} value={tol.target} suggestions={els.map((e) => e.name)} onChange={(target) => set(i, { ...tol, target, param: paramForTarget(byName(els, target), tol.param, !!tol.model) })} issues={issuesAt(issues, `${p}.target`)} size={9} />
            <TextField label={t('common.parameter')} value={tol.param} suggestions={elementParamChoices(el, !!tol.model)} onChange={(param) => set(i, { ...tol, param })} issues={issuesAt(issues, `${p}.param`)} size={7} />
            <NumField label={t('analysis.forms.tolerance')} unit="%" percent value={tol.tol} min={0} exclusiveMin max={0.999999} onChange={(v) => set(i, { ...tol, tol: v ?? tol.tol })} issues={issuesAt(issues, `${p}.tol`)} size={5} />
            <SelectField
              label={t('analysis.forms.distribution')}
              value={tol.dist}
              options={[
                ['uniform', t('analysis.forms.uniform')],
                ['gaussian', t('analysis.forms.gaussian')],
              ]}
              onChange={(dist) => set(i, { ...tol, dist })}
            />
            <button type="button" className="msa-btn msa-btn-icon" aria-label={t('analysis.forms.removeToleranceValue', { value: i + 1 })} onClick={() => onChange(value.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
        );
      })}
    </Group>
  );
}

function MeasureFields({ value, onChange, ctx, issues, title = t('analysis.forms.measurement') }: { value: MeasureSpec; onChange: (m: MeasureSpec) => void; ctx: FormContext; issues: readonly SpecIssue[]; title?: string }) {
  const at = (p: string) => issuesAt(issues, p);
  return (
    <Group title={title}>
      <FieldRow>
        <TextField label={t('common.output')} value={value.output} suggestions={ctx.outputs} onChange={(output) => onChange({ ...value, output })} issues={at('output')} size={12} />
        <SelectField label={t('analysis.forms.function')} value={value.func} options={MEASURE_FUNCS.map((f) => [f, MEASURE_LABELS[f]] as const)} onChange={(func) => onChange({ ...value, func })} issues={at('func')} />
        {value.func === 'at' && <NumField label={t('analysis.forms.atX')} value={value.at} optional onChange={(at) => onChange({ ...value, at })} issues={issuesAt(issues, 'at')} size={8} />}
        {(value.func === 'rise_edge' || value.func === 'fall_edge') && (
          <NumField label={t('analysis.forms.threshold')} value={value.threshold} optional onChange={(threshold) => onChange({ ...value, threshold })} issues={issuesAt(issues, 'threshold')} size={8} />
        )}
      </FieldRow>
    </Group>
  );
}

function OutputPicker({ selected, available, onChange, issues }: { selected: string[]; available: readonly string[]; onChange: (v: string[]) => void; issues: readonly SpecIssue[] }) {
  const [custom, setCustom] = useState('');
  const all = [...available];
  for (const s of selected) if (!all.some((a) => a.toLowerCase() === s.toLowerCase())) all.push(s);
  const isOn = (o: string) => selected.some((s) => s.toLowerCase() === o.toLowerCase());
  const toggle = (o: string) => onChange(isOn(o) ? selected.filter((s) => s.toLowerCase() !== o.toLowerCase()) : [...selected, o]);
  return (
    <Group title={t('analysis.forms.outputsLengthSelected', { length: selected.length })}>
      <div className="msa-outputs" role="group" aria-label={t('analysis.forms.outputsToAnalyse')}>
        {all.map((o) => {
          const index = selected.findIndex((s) => s.toLowerCase() === o.toLowerCase());
          return (
            <label key={o} className="msa-check">
              <input type="checkbox" checked={index >= 0} onChange={() => toggle(o)} /> <span className="msa-mono">{o}</span>
              {index >= 0 && <IssueList issues={issuesAt(issues, `outputs.${index}`)} />}
            </label>
          );
        })}
      </div>
      <div className="msa-row">
        <input className="msa-input" value={custom} placeholder={t('analysis.forms.addAnExpressionEG')} aria-label={t('analysis.forms.addOutputExpression')} onChange={(e) => setCustom(e.target.value)} />
        <button
          type="button"
          className="msa-btn"
          disabled={!custom.trim() || isOn(custom.trim())}
          onClick={() => {
            onChange([...selected, custom.trim()]);
            setCustom('');
          }}
        >
          {t('common.add')}
        </button>
      </div>
      <IssueList issues={issuesAt(issues, 'outputs')} />
    </Group>
  );
}

// ---------------------------------------------------------------------------
// Basic and small-signal forms
// ---------------------------------------------------------------------------

function OpForm() {
  return <p className="msa-note">{t('analysis.forms.theOperatingPointHasNo')}</p>;
}

function DcForm({ spec, onChange, ctx, issues }: SpecFormProps<DcAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  const sources = [...(ctx.sources ?? []), 'temp'];
  const u = sourceUnit(spec.src);
  const n = dcPointCount(spec.start, spec.stop, spec.step);
  const { src2, ...withoutSrc2 } = spec;
  const u2 = src2 ? sourceUnit(src2.src) : '';
  const n2 = src2 ? dcPointCount(src2.start, src2.stop, src2.step) : Number.NaN;
  return (
    <>
      <Group title={t('analysis.forms.source1')}>
        <FieldRow>
          <TextField label={t('common.source')} value={spec.src} suggestions={sources} onChange={(src) => onChange({ ...spec, src })} issues={at('src')} size={8} help={t('analysis.forms.independentSourceNameOrTemp')} />
          <NumField label={t('analysis.forms.startValue')} unit={u} value={spec.start} onChange={(v) => onChange({ ...spec, start: v ?? spec.start })} issues={at('start')} size={8} />
          <NumField label={t('analysis.forms.stopValue')} unit={u} value={spec.stop} onChange={(v) => onChange({ ...spec, stop: v ?? spec.stop })} issues={at('stop')} size={8} />
          <NumField label={t('common.increment')} unit={u} value={spec.step} onChange={(v) => onChange({ ...spec, step: v ?? spec.step })} issues={at('step')} size={8} />
        </FieldRow>
        <span className="msa-hint">{Number.isFinite(n) ? t('analysis.forms.nPoints', { n: n }) : ''}</span>
      </Group>
      <CheckField
        label={t('analysis.forms.useSource2OneCurve')}
        checked={!!src2}
        onChange={(on) =>
          onChange(on ? { ...spec, src2: { src: ctx.sources?.find((s) => s.toLowerCase() !== spec.src.toLowerCase()) ?? '', start: 0, stop: 1, step: 0.5 } } : withoutSrc2)
        }
      />
      {src2 && (
        <Group title={t('analysis.forms.source2')}>
          <FieldRow>
            <TextField label={t('common.source')} value={src2.src} suggestions={sources} onChange={(src) => onChange({ ...spec, src2: { ...src2, src } })} issues={at('src2.src')} size={8} />
            <NumField label={t('analysis.forms.startValue')} unit={u2} value={src2.start} onChange={(v) => onChange({ ...spec, src2: { ...src2, start: v ?? src2.start } })} issues={at('src2.start')} size={8} />
            <NumField label={t('analysis.forms.stopValue')} unit={u2} value={src2.stop} onChange={(v) => onChange({ ...spec, src2: { ...src2, stop: v ?? src2.stop } })} issues={at('src2.stop')} size={8} />
            <NumField label={t('common.increment')} unit={u2} value={src2.step} onChange={(v) => onChange({ ...spec, src2: { ...src2, step: v ?? src2.step } })} issues={at('src2.step')} size={8} />
          </FieldRow>
          <span className="msa-hint">{Number.isFinite(n2) ? t('analysis.forms.n2Curves', { n2: n2 }) : ''}</span>
        </Group>
      )}
    </>
  );
}

function AcForm({ spec, onChange, issues }: SpecFormProps<AcAnalysis>) {
  return <FrequencySweep value={spec} allowList onChange={(v) => onChange({ ...spec, ...v })} issues={issues} />;
}

function AcSingleForm({ spec, onChange, issues }: SpecFormProps<AcSingleAnalysis>) {
  return (
    <FieldRow>
      <NumField label={t('common.frequency')} unit="Hz" value={spec.freq} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, freq: v ?? spec.freq })} issues={issuesAt(issues, 'freq')} />
    </FieldRow>
  );
}

function TranForm({ spec, onChange, issues }: SpecFormProps<TranAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  const { tmax: _tmax, ...noTmax } = spec;
  return (
    <>
      <Group title={t('common.time')}>
        <FieldRow>
          <NumField label={t('analysis.forms.startTimeTstart')} unit="s" value={spec.tstart} optional placeholder="0" min={0} onChange={(v) => onChange({ ...spec, tstart: v })} issues={at('tstart')} help={t('analysis.forms.outputIsSavedFromThis')} />
          <NumField label={t('analysis.forms.endTimeTstop')} unit="s" value={spec.tstop} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, tstop: v ?? spec.tstop })} issues={at('tstop')} />
          <NumField label={t('analysis.forms.timeStepTstep')} unit="s" value={spec.tstep} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, tstep: v ?? spec.tstep })} issues={at('tstep')} help={t('analysis.forms.outputSpacing')} />
          <NumField
            label={t('analysis.forms.maximumTimeStepTmax')}
            unit="s"
            value={spec.tmax}
            optional
            placeholder={t('common.auto')}
            min={0}
            exclusiveMin
            onChange={(v) => onChange(v === undefined ? noTmax : { ...spec, tmax: v })}
            issues={at('tmax')}
            help={t('analysis.forms.upperLimitOfTheInternal')}
          />
        </FieldRow>
      </Group>
      <FieldRow>
        <SelectField
          label={t('analysis.forms.initialConditions')}
          value={spec.uic ? 'uic' : 'op'}
          options={[
            ['op', t('analysis.forms.calculateDcOperatingPoint')],
            ['uic', t('analysis.forms.useInitialConditionsSkipOperating')],
          ]}
          onChange={(v) => onChange({ ...spec, uic: v === 'uic' ? true : undefined })}
        />
      </FieldRow>
    </>
  );
}

function NoiseForm({ spec, onChange, ctx, issues }: SpecFormProps<NoiseAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  const nodes = nodesFromOutputs(ctx.outputs);
  return (
    <>
      <FieldRow>
        <TextField label={t('analysis.forms.outputNode')} value={spec.output} suggestions={nodes} onChange={(output) => onChange({ ...spec, output })} issues={at('output')} size={8} />
        <TextField label={t('analysis.forms.referenceNode')} value={spec.ref ?? '0'} suggestions={['0', ...nodes]} onChange={(ref) => onChange({ ...spec, ref: ref || '0' })} issues={at('ref')} size={8} />
        <TextField label={t('analysis.forms.inputNoiseReferenceSource')} value={spec.src} suggestions={ctx.sources} onChange={(src) => onChange({ ...spec, src })} issues={at('src')} size={8} />
      </FieldRow>
      <FrequencySweep value={spec} allowList={false} onChange={(v) => onChange({ ...spec, sweep: v.sweep, points: v.points, fstart: v.fstart, fstop: v.fstop })} issues={issues} />
    </>
  );
}

function TfForm({ spec, onChange, ctx, issues }: SpecFormProps<TfAnalysis>) {
  return (
    <FieldRow>
      <TextField label={t('common.output')} value={spec.output} suggestions={ctx.outputs} onChange={(output) => onChange({ ...spec, output })} issues={issuesAt(issues, 'output')} help={t('analysis.forms.vNodeVAB')} />
      <TextField label={t('analysis.forms.inputSource')} value={spec.src} suggestions={ctx.sources} onChange={(src) => onChange({ ...spec, src })} issues={issuesAt(issues, 'src')} size={8} />
    </FieldRow>
  );
}

function SensForm({ spec, onChange, ctx, issues }: SpecFormProps<SensAnalysis>) {
  const { ac, ...dcOnly } = spec;
  return (
    <>
      <FieldRow>
        <TextField label={t('common.output')} value={spec.output} suggestions={ctx.outputs} onChange={(output) => onChange({ ...spec, output })} issues={issuesAt(issues, 'output')} help={t('analysis.forms.vNodeVAB')} />
      </FieldRow>
      <CheckField label={t('analysis.forms.acSensitivityVersusFrequency')} checked={!!ac} onChange={(on) => onChange(on ? { ...spec, ac: { sweep: 'dec', points: 10, fstart: 1, fstop: 1e9 } } : dcOnly)} />
      {ac && <FrequencySweep value={ac} allowList={false} onChange={(v) => onChange({ ...spec, ac: { sweep: v.sweep, points: v.points, fstart: v.fstart, fstop: v.fstop } })} issues={issuesUnder(issues, 'ac')} />}
    </>
  );
}

function PzForm({ spec, onChange, ctx, issues }: SpecFormProps<PzAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  const nodes = ['0', ...nodesFromOutputs(ctx.outputs)];
  return (
    <>
      <FieldRow>
        <SelectField
          label={t('analysis.forms.transferFunction')}
          value={spec.transfer}
          options={[
            ['vol', t('analysis.forms.gainVOutVIn')],
            ['cur', t('analysis.forms.impedanceVOutIIn')],
          ]}
          onChange={(transfer) => onChange({ ...spec, transfer })}
          issues={at('transfer')}
        />
        <SelectField
          label={t('analysis.forms.analysisPerformed')}
          value={spec.find}
          options={[
            ['pz', t('analysis.forms.polesAndZeros')],
            ['pol', t('analysis.forms.polesOnly')],
            ['zer', t('analysis.forms.zerosOnly')],
          ]}
          onChange={(find) => onChange({ ...spec, find })}
          issues={at('find')}
        />
      </FieldRow>
      <Group title={t('analysis.forms.nodes')}>
        <FieldRow>
          <TextField label={t('analysis.forms.input')} value={spec.inPos} suggestions={nodes} onChange={(inPos) => onChange({ ...spec, inPos })} issues={at('inPos')} size={8} />
          <TextField label={t('analysis.forms.input2')} value={spec.inNeg} suggestions={nodes} onChange={(inNeg) => onChange({ ...spec, inNeg: inNeg || '0' })} issues={at('inNeg')} size={8} />
          <TextField label={t('analysis.forms.output')} value={spec.outPos} suggestions={nodes} onChange={(outPos) => onChange({ ...spec, outPos })} issues={at('outPos')} size={8} />
          <TextField label={t('analysis.forms.output2')} value={spec.outNeg} suggestions={nodes} onChange={(outNeg) => onChange({ ...spec, outNeg: outNeg || '0' })} issues={at('outNeg')} size={8} />
        </FieldRow>
      </Group>
    </>
  );
}

function FourierForm({ spec, onChange, ctx, issues }: SpecFormProps<FourierAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  return (
    <>
      <FieldRow>
        <NumField label={t('analysis.forms.fundamentalFrequency')} unit="Hz" value={spec.fundamental} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, fundamental: v ?? spec.fundamental })} issues={at('fundamental')} />
        <NumField label={t('analysis.forms.numberOfHarmonics')} value={spec.harmonics} integer min={1} max={100} onChange={(v) => onChange({ ...spec, harmonics: v ?? spec.harmonics })} issues={at('harmonics')} size={5} />
        <NumField label={t('analysis.forms.settlingCycles')} value={spec.settleCycles} optional integer min={0} placeholder="0" onChange={(settleCycles) => onChange({ ...spec, settleCycles })} issues={at('settleCycles')} size={5} help={t('analysis.forms.fundamentalPeriodsSimulatedBeforeThe')} />
      </FieldRow>
      <FieldRow>
        <NumField label={t('analysis.forms.samplesPerPeriod')} value={spec.samples} optional integer min={4} placeholder="256" onChange={(samples) => onChange({ ...spec, samples })} issues={at('samples')} size={6} />
        <NumField label={t('analysis.forms.transientTimeStep')} unit="s" value={spec.tstep} optional min={0} exclusiveMin placeholder={t('common.auto')} onChange={(tstep) => onChange({ ...spec, tstep })} issues={at('tstep')} size={8} />
      </FieldRow>
      <OutputPicker selected={spec.outputs} available={ctx.outputs ?? []} onChange={(outputs) => onChange({ ...spec, outputs })} issues={issues} />
    </>
  );
}

function DistoForm({ spec, onChange, issues }: SpecFormProps<DistoAnalysis>) {
  const { f2overf1, ...harmonic } = spec;
  return (
    <>
      <FrequencySweep value={spec} allowList={false} onChange={(v) => onChange({ ...spec, sweep: v.sweep, points: v.points, fstart: v.fstart, fstop: v.fstop })} issues={issues} />
      <CheckField label={t('analysis.forms.intermodulationSecondToneF2')} checked={f2overf1 !== undefined} onChange={(on) => onChange(on ? { ...spec, f2overf1: 0.9 } : harmonic)} />
      {f2overf1 !== undefined && (
        <FieldRow>
          <NumField label={t('analysis.forms.f2F1Ratio')} value={f2overf1} min={0} exclusiveMin max={0.999999} onChange={(v) => onChange({ ...spec, f2overf1: v ?? f2overf1 })} issues={issuesAt(issues, 'f2overf1')} size={6} />
        </FieldRow>
      )}
    </>
  );
}

function NoiseFigureForm({ spec, onChange, ctx, issues }: SpecFormProps<NoiseFigureAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  const nodes = nodesFromOutputs(ctx.outputs);
  return (
    <>
      <FieldRow>
        <TextField label={t('analysis.forms.outputNode')} value={spec.output} suggestions={nodes} onChange={(output) => onChange({ ...spec, output })} issues={at('output')} size={8} />
        <TextField label={t('analysis.forms.referenceNode')} value={spec.ref ?? '0'} suggestions={['0', ...nodes]} onChange={(ref) => onChange({ ...spec, ref: ref || '0' })} issues={at('ref')} size={8} />
        <TextField label={t('analysis.forms.inputSource')} value={spec.src} suggestions={ctx.sources} onChange={(src) => onChange({ ...spec, src })} issues={at('src')} size={8} />
      </FieldRow>
      <FieldRow>
        <NumField label={t('analysis.forms.sourceResistance')} unit="Ω" value={spec.rsource} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, rsource: v ?? spec.rsource })} issues={at('rsource')} />
        <NumField label={t('common.frequency')} unit="Hz" value={spec.freq} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, freq: v ?? spec.freq })} issues={at('freq')} />
      </FieldRow>
    </>
  );
}

// ---------------------------------------------------------------------------
// Meta analyses
// ---------------------------------------------------------------------------

/** The sweep with a new target; `global` is dropped (not left undefined) when it no longer applies. */
function withSweepTarget(spec: ParamSweepAnalysis, v: SweepTargetValue): ParamSweepAnalysis {
  const { global: oldGlobal, netlists: built, ...rest } = spec;
  void oldGlobal;
  void built;
  const { global: nowGlobal, ...target } = v;
  return { ...rest, ...target, ...(nowGlobal ? { global: true } : {}) };
}

function ParamSweepForm({ spec, onChange, ctx, issues, depth = 0 }: SpecFormProps<ParamSweepAnalysis>) {
  return (
    <>
      <SweepTarget title={t('analysis.forms.sweepParameter')} value={spec} onChange={(v) => onChange(withSweepTarget(spec, v))} ctx={ctx} issues={issues} allowVariable />
      <BaseEditor base={spec.base} onChange={(base) => onChange({ ...spec, base })} ctx={ctx} issues={issues} depth={depth} />
    </>
  );
}

function TempSweepForm({ spec, onChange, ctx, issues, depth = 0 }: SpecFormProps<TempSweepAnalysis>) {
  return (
    <>
      <Group title={t('analysis.forms.temperatures')}>
        <ListField label={t('analysis.forms.temperatures')} unit="°C" values={spec.temps} onChange={(temps) => onChange({ ...spec, temps })} issues={issuesAt(issues, 'temps')} />
        <ValuesGenerator unit="°C" onGenerate={(temps) => onChange({ ...spec, temps })} />
      </Group>
      <BaseEditor base={spec.base} onChange={(base) => onChange({ ...spec, base })} ctx={ctx} issues={issues} depth={depth} />
    </>
  );
}

function MonteCarloForm({ spec, onChange, ctx, issues, depth = 0 }: SpecFormProps<MonteCarloAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  const { measure, ...noMeasure } = spec;
  return (
    <>
      <FieldRow>
        <NumField label={t('analysis.forms.numberOfRuns')} value={spec.runs} integer min={1} max={100000} onChange={(v) => onChange({ ...spec, runs: v ?? spec.runs })} issues={at('runs')} size={6} />
        <NumField label={t('analysis.forms.randomSeed')} value={spec.seed} integer min={0} max={2147483647} onChange={(v) => onChange({ ...spec, seed: v ?? spec.seed })} issues={at('seed')} size={8} />
      </FieldRow>
      <Tolerances value={spec.tolerances} onChange={(tolerances) => onChange({ ...spec, tolerances })} ctx={ctx} issues={issues} />
      <CheckField
        label={t('analysis.forms.measureOneValuePerRun')}
        checked={!!measure}
        onChange={(on) => onChange(on ? { ...spec, measure: { output: ctx.outputs?.[0] ?? 'V(out)', func: 'max' } } : noMeasure)}
      />
      {measure && <MeasureFields value={measure} onChange={(m) => onChange({ ...spec, measure: m })} ctx={ctx} issues={issuesUnder(issues, 'measure')} />}
      <BaseEditor base={spec.base} onChange={(base) => onChange({ ...spec, base })} ctx={ctx} issues={issues} depth={depth} />
    </>
  );
}

function WorstCaseForm({ spec, onChange, ctx, issues, depth = 0 }: SpecFormProps<WorstCaseAnalysis>) {
  return (
    <>
      <Tolerances value={spec.tolerances} onChange={(tolerances) => onChange({ ...spec, tolerances })} ctx={ctx} issues={issues} />
      <MeasureFields value={spec.measure} onChange={(measure) => onChange({ ...spec, measure })} ctx={ctx} issues={issuesUnder(issues, 'measure')} title={t('analysis.forms.measurementToPush')} />
      <FieldRow>
        <SelectField
          label={t('analysis.forms.direction')}
          value={spec.direction}
          options={[
            ['high', t('analysis.forms.highMaximiseTheMeasurement')],
            ['low', t('analysis.forms.lowMinimiseTheMeasurement')],
          ]}
          onChange={(direction) => onChange({ ...spec, direction })}
          issues={issuesAt(issues, 'direction')}
        />
      </FieldRow>
      <BaseEditor base={spec.base} onChange={(base) => onChange({ ...spec, base })} ctx={ctx} issues={issues} depth={depth} />
    </>
  );
}

function NestedSweepForm({ spec, onChange, ctx, issues, depth = 0 }: SpecFormProps<NestedSweepAnalysis>) {
  return (
    <>
      <SweepTarget title={t('analysis.forms.outerSweep')} value={spec.outer} onChange={(outer) => onChange({ ...spec, outer })} ctx={ctx} issues={issuesUnder(issues, 'outer')} />
      <SweepTarget title={t('analysis.forms.innerSweep')} value={spec.inner} onChange={(inner) => onChange({ ...spec, inner })} ctx={ctx} issues={issuesUnder(issues, 'inner')} />
      <span className="msa-hint">{t('analysis.forms.valueRuns', { value: spec.outer.values.length * spec.inner.values.length })}</span>
      <BaseEditor base={spec.base} onChange={(base) => onChange({ ...spec, base })} ctx={ctx} issues={issues} depth={depth} />
    </>
  );
}

function TraceWidthForm({ spec, onChange, ctx, issues, depth = 0 }: SpecFormProps<TraceWidthAnalysis>) {
  const at = (p: string) => issuesAt(issues, p);
  return (
    <>
      <FieldRow>
        <NumField label={t('analysis.forms.allowedTemperatureRise')} unit="°C" value={spec.tempRise} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, tempRise: v ?? spec.tempRise })} issues={at('tempRise')} size={6} />
        <NumField label={t('analysis.forms.copperWeight')} unit="oz/ft²" value={spec.copperOz} min={0} exclusiveMin onChange={(v) => onChange({ ...spec, copperOz: v ?? spec.copperOz })} issues={at('copperOz')} size={6} />
        <SelectField
          label={t('analysis.forms.layer')}
          value={spec.external ? 'external' : 'internal'}
          options={[
            ['external', t('analysis.forms.externalOuterLayer')],
            ['internal', t('analysis.forms.internalLayer')],
          ]}
          onChange={(v) => onChange({ ...spec, external: v === 'external' })}
        />
      </FieldRow>
      <Group title={t('analysis.forms.transientRunUsedForThe')}>
        <IssueList issues={issuesAt(issues, 'base')} />
        <div className="msa-nested">
          <TranForm spec={spec.base} onChange={(base) => base.type === 'tran' && onChange({ ...spec, base })} ctx={ctx} issues={issuesUnder(issues, 'base')} depth={depth + 1} />
        </div>
      </Group>
    </>
  );
}

const BATCHABLE = ANALYSIS_CATALOG.map((a) => a.type).filter((t) => t !== 'batch');

function BatchForm({ spec, onChange, ctx, issues, depth = 0 }: SpecFormProps<BatchAnalysis>) {
  const [open, setOpen] = useState<number | null>(spec.items.length ? 0 : null);
  const [addType, setAddType] = useState<AnalysisType>('tran');
  const setItem = (i: number, item: AnalysisSpec) => onChange({ ...spec, items: spec.items.map((x, k) => (k === i ? item : x)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= spec.items.length) return;
    const items = spec.items.slice();
    [items[i], items[j]] = [items[j], items[i]];
    onChange({ ...spec, items });
    setOpen(open === i ? j : open === j ? i : open);
  };
  const add = () => {
    const tpl = ctx.templates?.[addType];
    const item = tpl && tpl.type === addType && addType !== 'batch' ? cloneSpec(tpl) : defaultSpec(addType, ctx);
    onChange({ ...spec, items: [...spec.items, item] });
    setOpen(spec.items.length);
  };
  return (
    <>
      <IssueList issues={issuesAt(issues, 'items')} />
      <ol className="msa-batch">
        {spec.items.map((item, i) => {
          const itemIssues = issuesUnder(issues, `items.${i}`);
          const own = issuesAt(issues, `items.${i}`);
          const bad = hasErrors(itemIssues) || hasErrors(own);
          return (
            <li key={i} className={`msa-batch-item${bad ? ' msa-batch-bad' : ''}`}>
              <div className="msa-batch-head">
                <button type="button" className="msa-link" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>
                  {open === i ? '▾' : '▸'} {i + 1}. {analysisInfo(item.type).title}
                </button>
                <span className="msa-batch-summary">{analysisHeadline(item)}</span>
                <button type="button" className="msa-btn msa-btn-icon" aria-label={t('analysis.forms.moveItemValueUp', { value: i + 1 })} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="msa-btn msa-btn-icon" aria-label={t('analysis.forms.moveItemValueDown', { value: i + 1 })} disabled={i === spec.items.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button
                  type="button"
                  className="msa-btn msa-btn-icon"
                  aria-label={t('analysis.forms.removeItemValue', { value: i + 1 })}
                  onClick={() => {
                    onChange({ ...spec, items: spec.items.filter((_, k) => k !== i) });
                    setOpen(null);
                  }}
                >
                  ✕
                </button>
              </div>
              <IssueList issues={own} />
              {open === i && (
                <div className="msa-nested">
                  <SpecForm spec={item} onChange={(s) => setItem(i, s)} ctx={ctx} issues={itemIssues} depth={depth + 1} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="msa-row">
        <SelectField label={t('analysis.forms.addAnalysis')} value={addType} options={BATCHABLE.map((t) => [t, analysisInfo(t).title] as const)} onChange={setAddType} />
        <button type="button" className="msa-btn" onClick={add}>
          {t('analysis.forms.addToBatch')}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// User-defined analysis
// ---------------------------------------------------------------------------

/** Control cards offered as one-click inserts (SPICE syntax, not translated). */
const USER_SNIPPETS: readonly string[] = ['.op', '.tran 10u 1m', '.ac dec 10 1 1meg', '.dc V1 0 5 0.1', '.temp 0 27 85', '.options reltol=1e-4', '.step temp list 0 27 100', '.save all'];

function UserForm({ spec, onChange, issues }: SpecFormProps<UserAnalysis>) {
  const parsed = parseUserControls(spec.text ?? '');
  const insert = (card: string) => onChange({ ...spec, text: `${(spec.text ?? '').replace(/\s*$/, '')}\n${card}`.replace(/^\n/, '') });
  return (
    <>
      <p className="msa-note">{t('analysis.user.help')}</p>
      <label className="msa-field msa-field-wide">
        <span className="msa-label">{t('analysis.user.label')}</span>
        <textarea
          className="msa-input msa-mono msa-user-text"
          rows={9}
          spellCheck={false}
          value={spec.text ?? ''}
          title={t('tip.user.text')}
          aria-label={t('analysis.user.label')}
          onChange={(e) => onChange({ ...spec, text: e.target.value })}
        />
      </label>
      <IssueList issues={issuesAt(issues, 'text')} />
      <div className="msa-row msa-snippets" role="group" aria-label={t('analysis.user.insert')}>
        <span className="msa-label">{t('analysis.user.insert')}</span>
        {USER_SNIPPETS.map((s) => (
          <button key={s} type="button" className="msa-btn msa-btn-small msa-mono" title={t('tip.user.snippet', { card: s })} onClick={() => insert(s)}>
            {s}
          </button>
        ))}
      </div>
      <p className="msa-hint">{parsed.analyses.length ? t('analysis.user.cards', { n: parsed.analyses.length, list: parsed.cards.join(' · ') }) : t('analysis.user.errNoCard')}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Form for any analysis spec (recursive for meta analyses). */
export function SpecForm(props: SpecFormProps) {
  const { spec } = props;
  switch (spec.type) {
    case 'op':
      return <OpForm />;
    case 'dc':
      return <DcForm {...props} spec={spec} />;
    case 'ac':
      return <AcForm {...props} spec={spec} />;
    case 'acsingle':
      return <AcSingleForm {...props} spec={spec} />;
    case 'tran':
      return <TranForm {...props} spec={spec} />;
    case 'noise':
      return <NoiseForm {...props} spec={spec} />;
    case 'tf':
      return <TfForm {...props} spec={spec} />;
    case 'sens':
      return <SensForm {...props} spec={spec} />;
    case 'pz':
      return <PzForm {...props} spec={spec} />;
    case 'four':
      return <FourierForm {...props} spec={spec} />;
    case 'disto':
      return <DistoForm {...props} spec={spec} />;
    case 'noisefig':
      return <NoiseFigureForm {...props} spec={spec} />;
    case 'paramsweep':
      return <ParamSweepForm {...props} spec={spec} />;
    case 'tempsweep':
      return <TempSweepForm {...props} spec={spec} />;
    case 'montecarlo':
      return <MonteCarloForm {...props} spec={spec} />;
    case 'worstcase':
      return <WorstCaseForm {...props} spec={spec} />;
    case 'nestedsweep':
      return <NestedSweepForm {...props} spec={spec} />;
    case 'tracewidth':
      return <TraceWidthForm {...props} spec={spec} />;
    case 'batch':
      return <BatchForm {...props} spec={spec} />;
    case 'user':
      return <UserForm {...props} spec={spec} />;
  }
}
