/**
 * Circuit wizard dialogs (Tools > Circuit wizards, loaded on first use): 555 timer, filter,
 * op-amp stage, BJT common-emitter amplifier, and the PCB transmission-line impedance calculator.
 *
 * Each design wizard shows a form (every field with a Vietnamese tooltip), recomputes the
 * circuit on every change (src/model/wizards) and shows a live preview of the generated
 * schematic, the part values, the predicted performance against the target, the design steps
 * and warnings. "Create a new design" opens the circuit as a new document with its analyses and
 * instruments set up, ready to run; "Place on the current sheet" inserts it to the right of the
 * sheet's content (net labels that clash with names already on the sheet are renamed).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Design, NetLabel } from '../../model/types';
import {
  CE_TRANSISTORS,
  OPAMP_MODELS,
  OPAMP_STAGE_KINDS,
  WizardInputError,
  design555Astable,
  design555Monostable,
  designCommonEmitter,
  designFilter,
  designOpampStage,
  stageInputCount,
  type FilterSpec,
  type OpampModel,
  type OpampStageKind,
  type Rounding,
  type WizardResult,
  type WizardText,
} from '../../model/wizards';
import { formatEng } from '../../util/units';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { CheckField, FieldRow, Group, NumField, SelectField, TextField } from '../analysis/fields';
import { openGeneratedDesign } from '../app/document';
import { sheetToSvg } from '../editor/exportImage';
import { actions, getState, partLookup } from '../store';
import { itemsBounds } from '../store/designOps';
import type { Clipboard } from '../store/types';
import { PcbCalculator } from './PcbCalculator';
import { t, tDynamic } from '../../i18n';
import '../analysis/analysis.css';
import './wizards.css';

export type WizardKind = '555' | 'filter' | 'opamp' | 'bjt' | 'pcb';

const ROUNDINGS: Rounding[] = ['exact', 'E12', 'E24', 'E96'];
const roundingOptions = () => ROUNDINGS.map((r) => [r, r === 'exact' ? t('wizard.rounding.exact') : t('wizard.rounding.series', { s: r })] as const);

function text(x: WizardText): string {
  return tDynamic(x.key, x.params);
}

function compute<T>(fn: () => T): { result: T | null; error: string | null } {
  try {
    return { result: fn(), error: null };
  } catch (e) {
    if (e instanceof WizardInputError) return { result: null, error: text(e.text) };
    return { result: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Rename fragment labels whose names already exist on the sheet (IN → IN_2 …). */
export function renameClashingLabels(labels: readonly NetLabel[], existing: Iterable<string>): NetLabel[] {
  const used = new Set([...existing].map((n) => n.toUpperCase()));
  const map = new Map<string, string>();
  for (const l of labels) {
    const key = l.name.toUpperCase();
    if (map.has(key) || !used.has(key)) continue;
    let k = 2;
    while (used.has(`${key}_${k}`)) k++;
    map.set(key, `${l.name}_${k}`);
    used.add(`${key}_${k}`);
  }
  return labels.map((l) => (map.has(l.name.toUpperCase()) ? { ...l, name: map.get(l.name.toUpperCase())! } : l));
}

function placeOnSheet(design: Design): void {
  const s = getState();
  const sheet = s.design.sheets.find((x) => x.id === s.activeSheetId) ?? s.design.sheets[0];
  const frag = design.sheets[0];
  const b = itemsBounds(sheet, null, partLookup);
  const fb = itemsBounds(frag, null, partLookup);
  const offset = { x: Math.ceil(((b ? b.x + b.w + 100 : 0) - (fb ? fb.x : 0)) / 10) * 10, y: Math.ceil(((b ? b.y : 0) - (fb ? fb.y : 0)) / 10) * 10 };
  const clip: Clipboard = {
    parts: frag.parts,
    wires: frag.wires,
    labels: renameClashingLabels(frag.labels, sheet.labels.map((l) => l.name)),
    probes: [],
    notes: frag.notes,
    anchor: { x: 0, y: 0 },
  };
  actions.insertFragment(clip, offset);
  actions.addSimMessage('info', t('wizard.placedMessage', { title: design.title }), 'wizard');
}

async function openAsDesign(design: Design, close: () => void): Promise<void> {
  if (await openGeneratedDesign(design, `${design.title.replace(/[^\w.-]+/g, '_')}.msim`)) {
    actions.addSimMessage('info', t('wizard.createdMessage', { title: design.title }), 'wizard');
    close();
  }
}

/** A predicted figure: dB with 2 decimals, % with 1, plain ratios with 4 digits, else engineering. */
function figureText(v: number, unit: string): string {
  if (unit === 'dB') return `${(Math.abs(v) < 0.005 ? 0 : v).toFixed(2)} dB`;
  if (unit === '%') return `${v.toFixed(1)} %`;
  if (unit === '') return String(Number(v.toPrecision(4)));
  return formatEng(v, unit, 4);
}

/** Results area shared by the design wizards. */
function WizardResults({ result }: { result: WizardResult }) {
  // the preview is rendered with react-dom/server, which must not run inside a React render
  const [preview, setPreview] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => {
    try {
      const svg = sheetToSvg(result.design, result.design.sheets[0].id, partLookup, { area: 'content', margin: 20 });
      setPreview({ url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.svg)}`, w: svg.width, h: svg.height });
    } catch {
      setPreview(null);
    }
  }, [result]);
  return (
    <div className="msw-results">
      {preview && (
        <div className="msw-preview" title={t('tip.wizard.preview')}>
          <img src={preview.url} alt={t('wizard.previewAlt')} style={{ aspectRatio: `${preview.w} / ${preview.h}` }} />
        </div>
      )}
      {result.warnings.length > 0 && (
        <ul className="msw-warnings" role="alert">
          {result.warnings.map((w, i) => (
            <li key={i}>{text(w)}</li>
          ))}
        </ul>
      )}
      <div className="msw-tables">
        <table className="msw-table" aria-label={t('wizard.partsTitle')}>
          <caption>{t('wizard.partsTitle')}</caption>
          <tbody>
            {result.parts.map((p, i) => (
              <tr key={i}>
                <th scope="row">{p.refdes}</th>
                <td className="msw-num">{p.value}</td>
                <td>{tDynamic(p.role, p.roleParams)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="msw-table" aria-label={t('wizard.predictedTitle')}>
          <caption>{t('wizard.predictedTitle')}</caption>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">{t('wizard.predicted')}</th>
              <th scope="col">{t('wizard.target')}</th>
            </tr>
          </thead>
          <tbody>
            {result.predicted.map((f, i) => (
              <tr key={i}>
                <th scope="row">{tDynamic(f.label)}</th>
                <td className="msw-num">{figureText(f.value, f.unit)}</td>
                <td className="msw-num">{f.target === undefined ? '' : figureText(f.target, f.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="msw-explain" aria-label={t('wizard.explainTitle')}>
        {result.explain.map((x, i) => (
          <li key={i}>{text(x)}</li>
        ))}
      </ol>
    </div>
  );
}

function WizardShell({ title, intro, form, result, error, close }: { title: string; intro: string; form: ReactNode; result: WizardResult | null; error: string | null; close: () => void }) {
  return (
    <Dialog
      title={title}
      onClose={close}
      width={1040}
      className="msw-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
          <button type="button" className="ms-btn" disabled={!result} onClick={() => result && (placeOnSheet(result.design), close())} title={t('tip.wizard.place')}>
            {t('wizard.place')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!result} onClick={() => result && void openAsDesign(result.design, close)} title={t('tip.wizard.create')}>
            {t('wizard.create')}
          </button>
        </>
      }
    >
      <p className="msa-note">{intro}</p>
      <div className="msw-body">
        <div className="msw-form">{form}</div>
        <div className="msw-output">
          {error && (
            <p className="msw-error" role="alert">
              {error}
            </p>
          )}
          {result && <WizardResults result={result} />}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// 555

export function Timer555Wizard({ close }: { close: () => void }) {
  const [mode, setMode] = useState<'astable' | 'monostable'>('astable');
  const [freq, setFreq] = useState<number | undefined>(1000);
  const [duty, setDuty] = useState<number | undefined>(0.6);
  const [width, setWidth] = useState<number | undefined>(1e-3);
  const [vcc, setVcc] = useState<number | undefined>(9);
  const [cap, setCap] = useState<number | undefined>(undefined);
  const [variant, setVariant] = useState<'auto' | 'standard' | 'diode'>('auto');
  const [led, setLed] = useState(false);
  const [rounding, setRounding] = useState<Rounding>('E24');
  const { result, error } = useMemo(
    () =>
      compute(() =>
        mode === 'astable'
          ? design555Astable({ freq: freq ?? NaN, duty: duty ?? NaN, vcc: vcc ?? NaN, cap, variant, rounding, led: led || undefined })
          : design555Monostable({ width: width ?? NaN, vcc: vcc ?? NaN, cap, rounding }),
      ),
    [mode, freq, duty, width, vcc, cap, variant, led, rounding],
  );
  const form = (
    <>
      <SelectField
        label={t('wizard.555.mode')}
        help={t('tip.wizard.555.mode')}
        value={mode}
        options={[
          ['astable', t('wizard.555.astable')],
          ['monostable', t('wizard.555.monostable')],
        ]}
        onChange={setMode}
      />
      {mode === 'astable' ? (
        <>
          <NumField label={t('wizard.555.freq')} help={t('tip.wizard.555.freq')} unit="Hz" value={freq} onChange={setFreq} min={0} exclusiveMin />
          <NumField label={t('wizard.555.duty')} help={t('tip.wizard.555.duty')} unit="%" percent value={duty} onChange={setDuty} min={0.05} max={0.95} />
          <SelectField
            label={t('wizard.555.variant')}
            help={t('tip.wizard.555.variant')}
            value={variant}
            options={[
              ['auto', t('wizard.555.variantAuto')],
              ['standard', t('wizard.555.variantStandard')],
              ['diode', t('wizard.555.variantDiode')],
            ]}
            onChange={setVariant}
          />
          <CheckField label={t('wizard.555.led')} help={t('tip.wizard.555.led')} checked={led} onChange={setLed} />
        </>
      ) : (
        <NumField label={t('wizard.555.width')} help={t('tip.wizard.555.width')} unit="s" value={width} onChange={setWidth} min={0} exclusiveMin />
      )}
      <NumField label={t('wizard.vcc')} help={t('tip.wizard.555.vcc')} unit="V" value={vcc} onChange={setVcc} min={4.5} max={16} />
      <NumField label={t('wizard.555.cap')} help={t('tip.wizard.555.cap')} unit="F" value={cap} onChange={setCap} optional min={0} exclusiveMin placeholder={t('wizard.auto')} />
      <SelectField label={t('wizard.rounding')} help={t('tip.wizard.rounding')} value={rounding} options={roundingOptions()} onChange={setRounding} />
    </>
  );
  return <WizardShell title={t('wizard.555.title')} intro={t('wizard.555.intro')} form={form} result={result} error={error} close={close} />;
}

// ---------------------------------------------------------------------------------------------
// filter

export function FilterWizard({ close }: { close: () => void }) {
  const [spec, setSpec] = useState<FilterSpec>({ type: 'lowpass', response: 'butterworth', topology: 'sallen-key', fp: 1000, fs: 4000, f0: 1000, bw: 200, bws: 800, ap: 3, as: 40, gain: 1, opamp: 'ideal' });
  const [fixOrder, setFixOrder] = useState(false);
  const upd = (patch: Partial<FilterSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const band = spec.type === 'bandpass' || spec.type === 'bandstop';
  const passive = spec.topology === 'passive';
  const { result, error } = useMemo(
    () =>
      compute(() => {
        const s: FilterSpec = { ...spec, order: fixOrder ? spec.order : undefined };
        if (band && !passive) s.topology = 'mfb';
        if (passive && s.r === undefined) s.r = 1000;
        return designFilter(s);
      }),
    [spec, fixOrder, band, passive],
  );
  const form = (
    <>
      <FieldRow>
        <SelectField
          label={t('wizard.filter.type')}
          help={t('tip.wizard.filter.type')}
          value={spec.type}
          options={(['lowpass', 'highpass', 'bandpass', 'bandstop'] as const).map((k) => [k, tDynamic(`wizard.filter.type.${k}`)] as const)}
          onChange={(v) => upd({ type: v })}
        />
        <SelectField
          label={t('wizard.filter.response')}
          help={t('tip.wizard.filter.response')}
          value={spec.response}
          options={[
            ['butterworth', t('wizard.filter.response.butterworth')],
            ['chebyshev', t('wizard.filter.response.chebyshev')],
          ]}
          onChange={(v) => upd({ response: v, ap: v === 'butterworth' ? 3 : 1 })}
        />
      </FieldRow>
      <SelectField
        label={t('wizard.filter.topology')}
        help={t('tip.wizard.filter.topology')}
        value={band && !passive ? 'mfb' : spec.topology}
        options={(band ? (['passive', 'mfb'] as const) : (['passive', 'sallen-key', 'mfb'] as const)).map((k) => [k, tDynamic(`wizard.filter.topology.${band && k === 'mfb' ? 'active' : k}`)] as const)}
        onChange={(v) => upd({ topology: v, r: v === 'passive' ? 1000 : 10e3, rounding: v === 'passive' ? 'exact' : 'E96' })}
      />
      <Group title={t('wizard.filter.specTitle')}>
        {band ? (
          <>
            <NumField label={t('wizard.filter.f0')} help={t('tip.wizard.filter.f0')} unit="Hz" value={spec.f0} onChange={(v) => upd({ f0: v })} min={0} exclusiveMin />
            <NumField label={spec.type === 'bandpass' ? t('wizard.filter.bwPass') : t('wizard.filter.bwStopAp')} help={t('tip.wizard.filter.bw')} unit="Hz" value={spec.bw} onChange={(v) => upd({ bw: v })} min={0} exclusiveMin />
            <NumField label={spec.type === 'bandpass' ? t('wizard.filter.bwsPass') : t('wizard.filter.bwsStop')} help={t('tip.wizard.filter.bws')} unit="Hz" value={spec.bws} onChange={(v) => upd({ bws: v })} min={0} exclusiveMin />
          </>
        ) : (
          <>
            <NumField label={t('wizard.filter.fp')} help={t('tip.wizard.filter.fp')} unit="Hz" value={spec.fp} onChange={(v) => upd({ fp: v })} min={0} exclusiveMin />
            <NumField label={t('wizard.filter.fs')} help={t('tip.wizard.filter.fs')} unit="Hz" value={spec.fs} onChange={(v) => upd({ fs: v })} min={0} exclusiveMin />
          </>
        )}
        <FieldRow>
          <NumField label={spec.response === 'chebyshev' ? t('wizard.filter.ripple') : t('wizard.filter.ap')} help={t('tip.wizard.filter.ap')} unit="dB" value={spec.ap} onChange={(v) => upd({ ap: v ?? 3 })} min={0} exclusiveMin max={10} size={6} />
          <NumField label={t('wizard.filter.as')} help={t('tip.wizard.filter.as')} unit="dB" value={spec.as} onChange={(v) => upd({ as: v ?? 40 })} min={1} max={120} size={6} />
        </FieldRow>
        <CheckField label={t('wizard.filter.fixOrder')} help={t('tip.wizard.filter.fixOrder')} checked={fixOrder} onChange={setFixOrder} />
        {fixOrder && <NumField label={t('wizard.filter.order')} help={t('tip.wizard.filter.order')} value={spec.order ?? result?.order ?? 2} onChange={(v) => upd({ order: v })} integer min={1} max={10} size={4} />}
      </Group>
      <Group title={t('wizard.filter.partsTitle')}>
        {passive ? (
          <NumField label={t('wizard.filter.rTerm')} help={t('tip.wizard.filter.rTerm')} unit="Ω" value={spec.r ?? 1000} onChange={(v) => upd({ r: v })} min={1} />
        ) : (
          <>
            <NumField label={t('wizard.filter.gain')} help={t('tip.wizard.filter.gain')} unit="V/V" value={spec.gain} onChange={(v) => upd({ gain: v })} min={0} exclusiveMin max={100} />
            <NumField label={t('wizard.filter.rLevel')} help={t('tip.wizard.filter.rLevel')} unit="Ω" value={spec.r ?? 10e3} onChange={(v) => upd({ r: v })} min={100} />
            <SelectField
              label={t('wizard.opamp.model')}
              help={t('tip.wizard.opamp.model')}
              value={spec.opamp ?? 'ideal'}
              options={(['ideal', 'tl081', 'lm741', 'ne5532', 'op07'] as const).map((m) => [m, m === 'ideal' ? t('wizard.opamp.ideal') : m.toUpperCase()] as const)}
              onChange={(v) => upd({ opamp: v })}
            />
          </>
        )}
        <SelectField label={t('wizard.rounding')} help={t('tip.wizard.rounding')} value={spec.rounding ?? (passive ? 'exact' : 'E96')} options={roundingOptions()} onChange={(v) => upd({ rounding: v })} />
      </Group>
    </>
  );
  return <WizardShell title={t('wizard.filter.title')} intro={t('wizard.filter.intro')} form={form} result={result} error={error} close={close} />;
}

// ---------------------------------------------------------------------------------------------
// op-amp stages

interface InputRow {
  amplitude: number | undefined;
  freq: number | undefined;
}

export function OpampWizard({ close }: { close: () => void }) {
  const [kind, setKind] = useState<OpampStageKind>('inverting');
  const [gain, setGain] = useState<number | undefined>(10);
  const [count, setCount] = useState(2);
  const [weights, setWeights] = useState('1, 2, 0.5, 1');
  const [rows, setRows] = useState<InputRow[]>([
    { amplitude: 0.5, freq: 1000 },
    { amplitude: 0.3, freq: 2000 },
    { amplitude: 0.2, freq: 0 },
    { amplitude: 0.1, freq: 0 },
  ]);
  const [rin, setRin] = useState<number | undefined>(10e3);
  const [supply, setSupply] = useState<number | undefined>(15);
  const [model, setModel] = useState<OpampModel>('ideal');
  const [rounding, setRounding] = useState<Rounding>('E24');
  const n = stageInputCount(kind, count);
  const { result, error } = useMemo(
    () =>
      compute(() =>
        designOpampStage({
          kind,
          gain: gain ?? NaN,
          weights: weights.split(/[\s,;]+/).filter(Boolean).map(Number),
          inputs: rows.slice(0, n).map((r) => ({ amplitude: r.amplitude ?? 0, freq: r.freq ?? 0 })),
          rin,
          supply,
          model,
          rounding,
        }),
      ),
    [kind, gain, weights, rows, n, rin, supply, model, rounding],
  );
  const setRow = (i: number, patch: Partial<InputRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const form = (
    <>
      <SelectField label={t('wizard.opamp.kind')} help={t('tip.wizard.opamp.kind')} value={kind} options={OPAMP_STAGE_KINDS.map((k) => [k, tDynamic(`wizard.opamp.kind.${k}`)] as const)} onChange={setKind} />
      {kind === 'scaling' ? (
        <TextField label={t('wizard.opamp.weights')} help={t('tip.wizard.opamp.weights')} value={weights} onChange={setWeights} />
      ) : (
        <NumField label={kind === 'summing' || kind === 'noninvSumming' ? t('wizard.opamp.gainEach') : t('wizard.opamp.gain')} help={t('tip.wizard.opamp.gain')} unit="V/V" value={gain} onChange={setGain} min={0} exclusiveMin max={1000} />
      )}
      {(kind === 'summing' || kind === 'noninvSumming' || kind === 'scaling') && (
        <SelectField
          label={t('wizard.opamp.inputs')}
          help={t('tip.wizard.opamp.inputs')}
          value={String(count) as '2' | '3' | '4'}
          options={[
            ['2', '2'],
            ['3', '3'],
            ['4', '4'],
          ]}
          onChange={(v) => setCount(Number(v))}
        />
      )}
      <Group title={t('wizard.opamp.sources')}>
        {rows.slice(0, n).map((r, i) => (
          <FieldRow key={i}>
            <NumField label={t('wizard.opamp.amp', { i: i + 1 })} help={t('tip.wizard.opamp.amp')} unit="V" value={r.amplitude} onChange={(v) => setRow(i, { amplitude: v })} size={7} />
            <NumField label={t('wizard.opamp.freq', { i: i + 1 })} help={t('tip.wizard.opamp.freq')} unit="Hz" value={r.freq} onChange={(v) => setRow(i, { freq: v })} min={0} size={7} />
          </FieldRow>
        ))}
      </Group>
      <NumField label={t('wizard.opamp.rin')} help={t('tip.wizard.opamp.rin')} unit="Ω" value={rin} onChange={setRin} min={100} />
      <NumField label={t('wizard.opamp.supply')} help={t('tip.wizard.opamp.supply')} unit="V" value={supply} onChange={setSupply} min={2} max={30} />
      <SelectField label={t('wizard.opamp.model')} help={t('tip.wizard.opamp.model')} value={model} options={OPAMP_MODELS.map((m) => [m, m === 'ideal' ? t('wizard.opamp.ideal') : m === 'generic' ? t('wizard.opamp.generic') : m.toUpperCase()] as const)} onChange={setModel} />
      <SelectField label={t('wizard.rounding')} help={t('tip.wizard.rounding')} value={rounding} options={roundingOptions()} onChange={setRounding} />
    </>
  );
  return <WizardShell title={t('wizard.opamp.title')} intro={t('wizard.opamp.intro')} form={form} result={result} error={error} close={close} />;
}

// ---------------------------------------------------------------------------------------------
// BJT common emitter

export function BjtWizard({ close }: { close: () => void }) {
  const [vcc, setVcc] = useState<number | undefined>(12);
  const [ic, setIc] = useState<number | undefined>(1e-3);
  const [gain, setGain] = useState<number | undefined>(20);
  const [rl, setRl] = useState<number | undefined>(10e3);
  const [flow, setFlow] = useState<number | undefined>(100);
  const [transistor, setTransistor] = useState('2n3904');
  const [rounding, setRounding] = useState<Rounding>('E24');
  const { result, error } = useMemo(
    () => compute(() => designCommonEmitter({ vcc: vcc ?? NaN, ic: ic ?? NaN, gain: gain ?? NaN, rl: rl ?? NaN, flow: flow ?? NaN, transistor, rounding })),
    [vcc, ic, gain, rl, flow, transistor, rounding],
  );
  const form = (
    <>
      <SelectField label={t('wizard.bjt.transistor')} help={t('tip.wizard.bjt.transistor')} value={transistor} options={Object.keys(CE_TRANSISTORS).map((k) => [k, k.toUpperCase()] as const)} onChange={setTransistor} />
      <NumField label={t('wizard.vcc')} help={t('tip.wizard.bjt.vcc')} unit="V" value={vcc} onChange={setVcc} min={5} max={30} />
      <NumField label={t('wizard.bjt.ic')} help={t('tip.wizard.bjt.ic')} unit="A" value={ic} onChange={setIc} min={0} exclusiveMin />
      <NumField label={t('wizard.bjt.gain')} help={t('tip.wizard.bjt.gain')} unit="V/V" value={gain} onChange={setGain} min={1} max={500} />
      <NumField label={t('wizard.bjt.rl')} help={t('tip.wizard.bjt.rl')} unit="Ω" value={rl} onChange={setRl} min={100} />
      <NumField label={t('wizard.bjt.flow')} help={t('tip.wizard.bjt.flow')} unit="Hz" value={flow} onChange={setFlow} min={1} />
      <SelectField label={t('wizard.rounding')} help={t('tip.wizard.rounding')} value={rounding} options={roundingOptions()} onChange={setRounding} />
    </>
  );
  return <WizardShell title={t('wizard.bjt.title')} intro={t('wizard.bjt.intro')} form={form} result={result} error={error} close={close} />;
}

/** Open a circuit wizard. */
export function openCircuitWizard(kind: WizardKind): void {
  openCustomDialog((close) => {
    switch (kind) {
      case '555':
        return <Timer555Wizard close={close} />;
      case 'filter':
        return <FilterWizard close={close} />;
      case 'opamp':
        return <OpampWizard close={close} />;
      case 'bjt':
        return <BjtWizard close={close} />;
      case 'pcb':
        return <PcbCalculator close={close} />;
    }
  });
}
