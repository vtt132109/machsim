/**
 * Component wizard (Tools › Component wizard, Model maker, Edit component): eight steps that make
 * a user component — information, symbol, pins, footprint, simulation model, pin mapping, test
 * simulation, save — with a Vietnamese explanation on every step. The state machine and the part it
 * builds are in wizardModel.ts; model makers in src/library/modelmaker; the simulator is loaded on
 * first use (in-process: the test benches are tiny).
 */
import { useEffect, useMemo, useState } from 'react';
import { GROUPS, listParts, getPart } from '../../library';
import type { PartDef, PartGroup, PinType } from '../../library/types';
import { SYMBOL_TEMPLATES, templateSymbol, type SymbolTemplateId } from '../../library/custom/templates';
import { modelEntries, normalizeIncludePath, parseModelLibrary } from '../../library/custom/spiceModels';
import { PIN_TYPES, type CustomPartData } from '../../library/custom/types';
import { footprintPinCheck, getFootprint, listFootprints } from '../../library/footprints';
import { tr } from '../../i18n/core';
import { databaseFamilies } from '../../library/custom/database';
import { LED_MAKER_COLORS, MAKERS, MakerInputError, getMaker, readMakerInput, runMaker, verifyMaker, type CheckOutcome, type MakerResult } from '../../library/modelmaker';
import { buildNetlist } from '../../model/netlister';
import type { AnalysisResult } from '../../sim/results';
import type { Netlist } from '../../sim/netlist';
import { formatEng } from '../../util/units';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { actions, getState, partLookup } from '../store';
import { SymbolPreview } from '../editor/SymbolPreview';
import { explainErc, explainSimError } from '../../i18n/erc';
import { familyName, groupName, paramHelp, paramLabel, partDescription, partName } from '../../i18n/library';
import { t, tDynamic } from '../../i18n';
import { getDesktopBridge } from '../../desktop/bridge';
import { knownCustomIds, savePart, usePartDatabases } from './partDatabases';
import { openSymbolEditorDialog, symbolDef } from './SymbolEditor';
import { pickTextFile } from './fileIo';
import { resolveModelText } from './spiceImport';
import {
  WIZARD_STEPS,
  buildPart,
  modelNameFor,
  modelTerminals,
  setBuiltin,
  setMaker,
  setMapping,
  setModelSource,
  setSpice,
  setSymbol,
  setTemplate,
  stepIssues,
  testDesign,
  type ModelSource,
  type WizardIssue,
  type WizardState,
} from './wizardModel';
import './parts.css';

/** The simulator, loaded on first use. */
async function simulator(): Promise<(nl: Netlist) => AnalysisResult[]> {
  const sim = await import('../../sim');
  return (nl) => sim.runAnalyses(nl);
}

const SOURCES: ModelSource[] = ['none', 'builtin', 'spice', 'maker'];
/** The footprint names offered by the picker: the whole catalogue (src/library/footprints.ts). */
const FOOTPRINTS = listFootprints().map((f) => f.name);

function issueText(i: WizardIssue): string {
  return tDynamic(`parts.issue.${i.code}`, i.params, i.code);
}

/** A maker error in the current language (field keys become their labels). */
export function makerErrorText(e: unknown, makerId?: string): string {
  if (e instanceof MakerInputError) {
    const key = typeof e.params.field === 'string' ? e.params.field : undefined;
    const field = key && makerId ? tDynamic(`maker.${makerId}.${key}`, undefined, key) : key;
    return tDynamic(`maker.error.${e.code}`, { ...e.params, ...(field ? { field } : {}) }, e.code);
  }
  return e instanceof Error ? e.message : String(e);
}

/** Value with an engineering suffix and unit for tables (4 significant digits). */
function eng(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '—';
  const r = Number(v.toPrecision(4));
  if (unit === 'dB' || unit === '%' || unit === 'rpm' || unit === '') return `${r}${unit ? ` ${unit}` : ''}`;
  return formatEng(r, unit);
}

/** Check-point parameters: numbers get an engineering prefix ("10 m" + "A" in the label). */
function checkParams(params: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
  if (!params) return params;
  const text = (v: number) => {
    const f = formatEng(v, '').trim();
    return f.includes(' ') ? f : `${f} `;
  };
  return Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'number' ? text(v) : v]));
}

// ---------------------------------------------------------------------------------------------

interface MakerRun {
  busy?: boolean;
  result?: MakerResult;
  outcomes?: CheckOutcome[];
  error?: string;
}

interface TestRun {
  busy?: boolean;
  ok?: boolean;
  lines?: string[];
  error?: string;
}

export function ComponentWizard({ init, close }: { init: WizardState; close: () => void }) {
  const [s, setS] = useState<WizardState>(init);
  const [mk, setMk] = useState<MakerRun>({});
  const [test, setTest] = useState<TestRun>({});
  const [place, setPlace] = useState(!init.editingId && !init.replaceInstance);
  const [replace, setReplace] = useState(!!init.replaceInstance);
  const [saved, setSaved] = useState<string | null>(null);
  const dbs = usePartDatabases();
  const step = WIZARD_STEPS[s.step];

  // a changed model invalidates the maker fit and the test
  useEffect(() => setTest({}), [s.source, s.spiceText, s.spiceName, s.builtinId, s.makerId, s.makerInput, s.pinMap, s.builtinMap]);
  useEffect(() => setMk({}), [s.makerId, s.makerInput]);

  const taken = useMemo(() => knownCustomIds(), [dbs]);
  const part: CustomPartData | undefined = useMemo(() => {
    if (s.source === 'maker' && !mk.result) return undefined;
    return buildPart(s, mk.result, taken);
  }, [s, mk.result, taken]);
  const issues = stepIssues(s, step, part, mk.result);
  const canNext = issues.length === 0;

  const runModelMaker = async () => {
    setMk({ busy: true });
    await new Promise((r) => setTimeout(r, 20));
    try {
      const run = await simulator();
      const def = getMaker(s.makerId);
      const { values, result } = runMaker(def, s.makerInput, modelNameFor(s.name || def.id), run);
      setMk({ result, outcomes: verifyMaker(def.checks(values, result), run) });
    } catch (e) {
      setMk({ error: makerErrorText(e, s.makerId) });
    }
  };

  const runTest = async () => {
    if (!part) return;
    setTest({ busy: true });
    await new Promise((r) => setTimeout(r, 20));
    try {
      const run = await simulator();
      const nb = buildNetlist(testDesign(part), { includeAnalysis: false });
      const errors = nb.erc.filter((m) => m.severity === 'error');
      if (errors.length) {
        setTest({ ok: false, lines: errors.map((m) => explainErc(m).title) });
        return;
      }
      const [op] = run({ ...nb.netlist, analyses: [{ type: 'op' }] });
      if (op.error) {
        setTest({ ok: false, error: explainSimError(op.error).title, lines: [op.error] });
        return;
      }
      const lines = part.symbol.pins.map((p, i) => {
        const v = op.vectors.find((x) => x.name.toLowerCase() === `v(p${i})`);
        return t('wiz.test.pinVoltage', { pin: p.name, v: v ? formatEng(v.re[0], 'V') : '—' });
      });
      setTest({ ok: true, lines });
    } catch (e) {
      setTest({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = async (andPlace: boolean) => {
    if (!part) return;
    await savePart(s.db, part);
    setSaved(part.id);
    if (replace && s.replaceInstance) {
      const ok = actions.replacePart(s.replaceInstance, part.id);
      if (!ok) actions.addSimMessage('warning', t('wiz.replaceFailed', { name: part.name }), 'parts');
    }
    actions.addSimMessage('info', t('wiz.saved', { name: part.name, db: t(`wiz.db.${s.db}`) }), 'parts');
    close();
    if (andPlace) actions.startPlacing(part.id);
  };

  const go = (k: number) => setS((p) => ({ ...p, step: Math.max(0, Math.min(WIZARD_STEPS.length - 1, k)) }));

  return (
    <Dialog
      title={s.editingId ? t('wiz.titleEdit', { name: s.name }) : t('wiz.title')}
      onClose={close}
      width={860}
      className="ms-wiz-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close} title={t('common.cancel')}>
            {t('common.cancel')}
          </button>
          <span className="ms-wiz-spacer" />
          <button type="button" className="ms-btn" disabled={s.step === 0} onClick={() => go(s.step - 1)} title={t('tip.wiz.back')}>
            {t('wiz.back')}
          </button>
          {step === 'save' ? (
            <>
              <button type="button" className="ms-btn" disabled={!canNext || !!saved} onClick={() => void save(false)} title={t('tip.wiz.save')}>
                {t('wiz.save')}
              </button>
              <button type="button" className="ms-btn ms-btn-primary" disabled={!canNext || !!saved} onClick={() => void save(place)} title={t('tip.wiz.saveFinish')}>
                {place ? t('wiz.saveAndPlace') : t('wiz.saveClose')}
              </button>
            </>
          ) : (
            <button type="button" className="ms-btn ms-btn-primary" disabled={!canNext} onClick={() => go(s.step + 1)} title={t('tip.wiz.next')}>
              {t('wiz.next')}
            </button>
          )}
        </>
      }
    >
      <div className="ms-wiz">
        <ol className="ms-wiz-steps" aria-label={t('wiz.stepsLabel')}>
          {WIZARD_STEPS.map((k, i) => (
            <li key={k}>
              <button type="button" className={`ms-wiz-step${i === s.step ? ' ms-wiz-step-active' : ''}${i < s.step ? ' ms-wiz-step-done' : ''}`} aria-current={i === s.step ? 'step' : undefined} disabled={i > s.step && !canNext} onClick={() => go(i)} title={t(`wiz.intro.${k}`)}>
                <span className="ms-wiz-step-n">{i + 1}</span> {t(`wiz.step.${k}`)}
              </button>
            </li>
          ))}
        </ol>
        <div className="ms-wiz-body">
          <p className="ms-hint ms-wiz-intro">{t(`wiz.intro.${step}`)}</p>
          {step === 'info' ? <InfoStep s={s} setS={setS} /> : null}
          {step === 'symbol' ? <SymbolStep s={s} setS={setS} /> : null}
          {step === 'pins' ? <PinsStep s={s} setS={setS} /> : null}
          {step === 'footprint' ? <FootprintStep s={s} setS={setS} /> : null}
          {step === 'model' ? <ModelStep s={s} setS={setS} mk={mk} runMaker={runModelMaker} /> : null}
          {step === 'mapping' ? <MappingStep s={s} setS={setS} /> : null}
          {step === 'test' ? <TestStep s={s} mk={mk} test={test} runTest={runTest} runMaker={runModelMaker} /> : null}
          {step === 'save' && part ? <SaveStep s={s} part={part} place={place} setPlace={setPlace} replace={replace} setReplace={setReplace} /> : null}
          {issues.length ? (
            <ul className="ms-wiz-issues" role="alert">
              {issues.map((i, k) => (
                <li key={k}>{issueText(i)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

type StepProps = { s: WizardState; setS: (f: (s: WizardState) => WizardState) => void };

function Row({ label, tip, children }: { label: string; tip: string; children: React.ReactNode }) {
  return (
    <label className="ms-cfield ms-cfield-row ms-wiz-row" title={tip}>
      <span className="ms-cfield-label">{label}</span>
      {children}
    </label>
  );
}

function InfoStep({ s, setS }: StepProps) {
  const dbs = usePartDatabases();
  const families = useMemo(() => {
    const set = new Set<string>();
    for (const p of listParts()) if (p.group === s.group && p.family) set.add(p.family);
    for (const kind of ['user', 'corporate'] as const) for (const f of databaseFamilies(dbs[kind])) if (f.group === s.group) set.add(f.name);
    return [...set].sort((a, b) => familyName(a).localeCompare(familyName(b)));
  }, [s.group, dbs]);
  return (
    <div className="ms-wiz-form">
      <Row label={t('wiz.name')} tip={t('tip.wiz.name')}>
        <input className="ms-input" data-autofocus value={s.name} title={t('tip.wiz.name')} onChange={(e) => setS((p) => ({ ...p, name: e.target.value }))} />
      </Row>
      <Row label={t('wiz.description')} tip={t('tip.wiz.description')}>
        <input className="ms-input" value={s.description} title={t('tip.wiz.description')} onChange={(e) => setS((p) => ({ ...p, description: e.target.value }))} />
      </Row>
      <Row label={t('wiz.group')} tip={t('tip.wiz.group')}>
        <select className="ms-input" value={s.group} title={t('tip.wiz.group')} onChange={(e) => setS((p) => ({ ...p, group: e.target.value as PartGroup }))}>
          {GROUPS.filter((g) => g.id !== 'instruments').map((g) => (
            <option key={g.id} value={g.id}>
              {groupName(g.id)}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('wiz.family')} tip={t('tip.wiz.family')}>
        {/* built-in families are shown in the UI language; picking one stores its library key */}
        <input
          className="ms-input"
          list="ms-wiz-families"
          value={s.family ? familyName(s.family) : ''}
          title={t('tip.wiz.family')}
          onChange={(e) => {
            const typed = e.target.value;
            const key = families.find((f) => familyName(f) === typed);
            setS((p) => ({ ...p, family: key ?? typed }));
          }}
        />
        <datalist id="ms-wiz-families">
          {families.map((f) => (
            <option key={f} value={familyName(f)} />
          ))}
        </datalist>
      </Row>
      <Row label={t('wiz.prefix')} tip={t('tip.wiz.prefix')}>
        <input className="ms-input ms-wiz-short" value={s.prefix} title={t('tip.wiz.prefix')} onChange={(e) => setS((p) => ({ ...p, prefix: e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase() }))} />
      </Row>
      <Row label={t('wiz.keywords')} tip={t('tip.wiz.keywords')}>
        <input className="ms-input" value={s.keywords} title={t('tip.wiz.keywords')} onChange={(e) => setS((p) => ({ ...p, keywords: e.target.value }))} />
      </Row>
      <Row label={t('wiz.db')} tip={t('tip.wiz.db')}>
        <select className="ms-input" value={s.db} title={t('tip.wiz.db')} onChange={(e) => setS((p) => ({ ...p, db: e.target.value as WizardState['db'] }))}>
          <option value="user">{t('wiz.db.user')}</option>
          <option value="corporate">{t('wiz.db.corporate')}</option>
        </select>
      </Row>
    </div>
  );
}

function SymbolStep({ s, setS }: StepProps) {
  const previews = useMemo(() => SYMBOL_TEMPLATES.map((tp) => ({ id: tp.id, def: symbolDef(templateSymbol(tp.id), tp.id) })), []);
  return (
    <div className="ms-wiz-symbol">
      <div className="ms-wiz-gallery" role="radiogroup" aria-label={t('wiz.templates')}>
        {previews.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={s.template === p.id} className={`ms-wiz-tile${s.template === p.id ? ' ms-wiz-tile-on' : ''}`} title={t(`wiz.template.${p.id}`)} onClick={() => setS((x) => setTemplate(x, p.id as SymbolTemplateId))}>
            <SymbolPreview def={p.def} className="ms-wiz-tile-svg" title={t(`wiz.template.${p.id}`)} />
            <span>{t(`wiz.template.${p.id}`)}</span>
          </button>
        ))}
      </div>
      <div className="ms-wiz-symbol-side">
        <SymbolPreview def={symbolDef(s.symbol, s.name)} className="ms-wiz-big-preview" title={t('wiz.symbolPreview')} />
        {s.template === 'box' ? (
          <div className="ms-wiz-form">
            <Row label={t('wiz.boxLeft')} tip={t('tip.wiz.boxPins')}>
              <input className="ms-input ms-wiz-short" type="number" min={0} max={64} value={s.boxLeft} title={t('tip.wiz.boxPins')} onChange={(e) => setS((x) => setTemplate(x, 'box', { left: Number(e.target.value) || 0 }))} />
            </Row>
            <Row label={t('wiz.boxRight')} tip={t('tip.wiz.boxPins')}>
              <input className="ms-input ms-wiz-short" type="number" min={0} max={64} value={s.boxRight} title={t('tip.wiz.boxPins')} onChange={(e) => setS((x) => setTemplate(x, 'box', { right: Number(e.target.value) || 0 }))} />
            </Row>
            <Row label={t('wiz.boxTitle')} tip={t('tip.wiz.boxTitle')}>
              <input className="ms-input" value={s.boxTitle} title={t('tip.wiz.boxTitle')} onChange={(e) => setS((x) => setTemplate(x, 'box', { title: e.target.value }))} />
            </Row>
          </div>
        ) : null}
        <button type="button" className="ms-btn" title={t('tip.wiz.drawSymbol')} onClick={() => openSymbolEditorDialog(s.symbol, { name: s.name, onDone: (sym) => setS((x) => setSymbol(x, sym)) })}>
          {t('wiz.drawSymbol')}
        </button>
        {s.template === 'custom' ? <p className="ms-hint">{t('wiz.symbolCustom')}</p> : null}
      </div>
    </div>
  );
}

function PinsStep({ s, setS }: StepProps) {
  const rename = (index: number, name: string) =>
    setS((x) => {
      const old = x.symbol.pins[index].name;
      const symbol = { ...x.symbol, pins: x.symbol.pins.map((p, i) => (i === index ? { ...p, name } : p)) };
      const pinMap = x.pinMap.map((p) => (p === old ? name : p));
      const builtinMap = Object.fromEntries(Object.entries(x.builtinMap).map(([k, v]) => [k, v === old ? name : v]));
      return { ...x, symbol, pinMap, builtinMap };
    });
  const patch = (index: number, p: Partial<WizardState['symbol']['pins'][number]>) => setS((x) => ({ ...x, symbol: { ...x.symbol, pins: x.symbol.pins.map((q, i) => (i === index ? { ...q, ...p } : q)) } }));
  return (
    <div className="ms-wiz-pins">
      <table className="ms-table ms-wiz-table">
        <thead>
          <tr>
            <th>{t('wiz.pin.name')}</th>
            <th>{t('wiz.pin.number')}</th>
            <th>{t('wiz.pin.label')}</th>
            <th>{t('wiz.pin.type')}</th>
            <th>{t('wiz.pin.side')}</th>
          </tr>
        </thead>
        <tbody>
          {s.symbol.pins.map((p, i) => (
            <tr key={i}>
              <td>
                <input className="ms-input" value={p.name} aria-label={t('wiz.pin.name')} title={t('tip.wiz.pinName')} onChange={(e) => rename(i, e.target.value)} />
              </td>
              <td>
                <input className="ms-input ms-wiz-short" value={p.number ?? ''} aria-label={t('wiz.pin.number')} title={t('tip.wiz.pinNumber')} onChange={(e) => patch(i, { number: e.target.value })} />
              </td>
              <td>
                <input className="ms-input ms-wiz-short" value={p.label ?? ''} aria-label={t('wiz.pin.label')} title={t('tip.wiz.pinLabel')} onChange={(e) => patch(i, { label: e.target.value || undefined })} />
              </td>
              <td>
                <select className="ms-input" value={p.type ?? 'passive'} aria-label={t('wiz.pin.type')} title={t('tip.wiz.pinType')} onChange={(e) => patch(i, { type: e.target.value as PinType })}>
                  {PIN_TYPES.map((k) => (
                    <option key={k} value={k}>
                      {t(`pinType.${k}`)}
                    </option>
                  ))}
                </select>
              </td>
              <td>{t(`pinDir.${p.dir ?? 'left'}`)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ms-wiz-pins-side">
        <SymbolPreview def={symbolDef(s.symbol, s.name)} className="ms-wiz-big-preview" title={t('wiz.symbolPreview')} />
        <button type="button" className="ms-btn" title={t('tip.wiz.drawSymbol')} onClick={() => openSymbolEditorDialog(s.symbol, { name: s.name, onDone: (sym) => setS((x) => setSymbol(x, sym)) })}>
          {t('wiz.addRemovePins')}
        </button>
      </div>
    </div>
  );
}

function FootprintStep({ s, setS }: StepProps) {
  const dbs = usePartDatabases();
  const fields = dbs[s.db].fields;
  // a footprint with the wrong number of pads is a mistake worth saying out loud
  const check = footprintPinCheck(s.footprint, s.symbol.pins.length);
  const fp = getFootprint(s.footprint);
  const footprintNote =
    check === 'mismatch' && fp ? t('wiz.footprintMismatch', { pins: s.symbol.pins.length, name: fp.name, fpPins: fp.pins }) : fp ? `${fp.name}: ${tr(fp.text)}` : '';
  return (
    <div className="ms-wiz-form">
      <Row label={t('wiz.footprint')} tip={t('tip.wiz.footprint')}>
        <input className="ms-input" list="ms-wiz-footprints" value={s.footprint} title={t('tip.wiz.footprint')} onChange={(e) => setS((p) => ({ ...p, footprint: e.target.value }))} />
        <datalist id="ms-wiz-footprints">
          {FOOTPRINTS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button
          type="button"
          className="ms-btn ms-btn-small"
          title={t('cmd.tools.footprints')}
          onClick={() =>
            void import('../schematicTools/flows').then((m) => m.openFootprintManager({ initial: s.footprint, onPick: (name) => setS((p) => ({ ...p, footprint: name })) }))
          }
        >
          {t('wiz.footprintBrowse')}
        </button>
      </Row>
      <p className="ms-hint">{t('wiz.footprintHint')}</p>
      {footprintNote ? <p className="ms-hint">{footprintNote}</p> : null}
      <Row label={t('wiz.hyperlink')} tip={t('tip.wiz.hyperlink')}>
        <input className="ms-input" type="url" value={s.hyperlink} spellCheck={false} title={t('tip.wiz.hyperlink')} onChange={(e) => setS((p) => ({ ...p, hyperlink: e.target.value }))} />
      </Row>
      <h4>{t('wiz.fields')}</h4>
      {fields.length === 0 ? <p className="ms-hint">{t('wiz.noFields')}</p> : null}
      {fields.map((f) => (
        <Row key={f} label={f} tip={t('tip.wiz.field')}>
          <input className="ms-input" value={s.fields[f] ?? ''} title={t('tip.wiz.field')} onChange={(e) => setS((p) => ({ ...p, fields: { ...p.fields, [f]: e.target.value } }))} />
        </Row>
      ))}
    </div>
  );
}

function ModelStep({ s, setS, mk, runMaker: run }: StepProps & { mk: MakerRun; runMaker: () => void }) {
  return (
    <div className="ms-wiz-model">
      <div className="ms-wiz-sources" role="radiogroup" aria-label={t('wiz.step.model')}>
        {SOURCES.map((src) => (
          <label key={src} className={`ms-wiz-source${s.source === src ? ' ms-wiz-source-on' : ''}`} title={t(`wiz.sourceHelp.${src}`)}>
            <input type="radio" name="ms-wiz-source" checked={s.source === src} title={t(`wiz.sourceHelp.${src}`)} onChange={() => setS((x) => setModelSource(x, src))} />
            <span className="ms-wiz-source-name">{t(`wiz.source.${src}`)}</span>
            <span className="ms-hint">{t(`wiz.sourceHelp.${src}`)}</span>
          </label>
        ))}
      </div>
      {s.source === 'builtin' ? <BuiltinPicker s={s} setS={setS} /> : null}
      {s.source === 'spice' ? <SpiceEditor s={s} setS={setS} /> : null}
      {s.source === 'maker' ? <MakerForm s={s} setS={setS} mk={mk} run={run} /> : null}
    </div>
  );
}

function BuiltinPicker({ s, setS }: StepProps) {
  const [q, setQ] = useState('');
  const pins = s.symbol.pins.length;
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    return listParts()
      .filter((p) => p.toSpice && !p.instrument && !p.id.startsWith('custom:') && !p.id.startsWith('hier:'))
      .filter((p) => (query ? [p.id, p.name, p.family, partName(p)].some((x) => x.toLowerCase().includes(query)) : p.symbol.pins.length === pins))
      .slice(0, 80);
  }, [q, pins]);
  const chosen = getPart(s.builtinId);
  return (
    <div className="ms-wiz-builtin">
      <input className="ms-input" placeholder={t('wiz.builtinSearch')} value={q} title={t('tip.wiz.builtinSearch')} onChange={(e) => setQ(e.target.value)} />
      <ul className="ms-wiz-list" role="listbox" aria-label={t('wiz.source.builtin')}>
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" role="option" aria-selected={p.id === s.builtinId} className={p.id === s.builtinId ? 'ms-wiz-list-on' : ''} title={partDescription(p)} onClick={() => setS((x) => setBuiltin(x, p.id))}>
              {partName(p)} <span className="ms-hint">· {familyName(p.family)} · {t('wiz.pinCount', { n: p.symbol.pins.length })}</span>
            </button>
          </li>
        ))}
      </ul>
      {chosen ? <BuiltinParams def={chosen} s={s} setS={setS} /> : null}
    </div>
  );
}

function BuiltinParams({ def, s, setS }: StepProps & { def: PartDef }) {
  const nums = def.params.filter((p) => p.kind === 'number').slice(0, 8);
  if (nums.length === 0) return null;
  return (
    <div className="ms-wiz-form">
      <h4>{t('wiz.builtinDefaults')}</h4>
      {nums.map((p) => (
        <Row key={p.key} label={`${paramLabel(p)}${p.unit ? ` (${p.unit})` : ''}`} tip={paramHelp(p) ?? t('tip.wiz.builtinDefault')}>
          <input className="ms-input" value={s.builtinParams[p.key] ?? p.default} title={paramHelp(p) ?? t('tip.wiz.builtinDefault')} onChange={(e) => setS((x) => ({ ...x, builtinParams: { ...x.builtinParams, [p.key]: e.target.value } }))} />
        </Row>
      ))}
    </div>
  );
}

function SpiceEditor({ s, setS }: StepProps) {
  const lib = useMemo(() => parseModelLibrary(s.spiceText, { files: new Map(s.spiceFiles) }), [s.spiceText, s.spiceFiles]);
  const entries = modelEntries(lib);
  const [basePath, setBasePath] = useState<string | undefined>();
  const open = async () => {
    const f = await pickTextFile('.lib,.mod,.cir,.sp,.spi,.sub,.inc,.txt,.model', { spice: true });
    if (!f) return;
    setBasePath(f.path);
    const bridge = getDesktopBridge();
    const res = await resolveModelText(f.text, async (p) => (f.path && bridge?.readIncludeFile ? ((await bridge.readIncludeFile(f.path, p))?.content ?? null) : null));
    setS((x) => setSpice(x, f.text, '', [...res.files]));
  };
  const pickInclude = async (path: string) => {
    const f = await pickTextFile('.lib,.mod,.cir,.sp,.spi,.sub,.inc,.txt,.model');
    if (!f) return;
    setS((x) => setSpice(x, x.spiceText, x.spiceName, [...x.spiceFiles.filter(([k]) => k !== path), [normalizeIncludePath(path), f.text]]));
  };
  return (
    <div className="ms-wiz-spice">
      <div className="ms-wiz-spice-bar">
        <button type="button" className="ms-btn" onClick={() => void open()} title={t('tip.wiz.spiceOpen')}>
          {t('wiz.spiceOpen')}
        </button>
        {basePath ? <span className="ms-hint">{basePath}</span> : null}
      </div>
      <textarea className="ms-input ms-wiz-code" rows={9} spellCheck={false} value={s.spiceText} placeholder={t('wiz.spicePlaceholder')} title={t('tip.wiz.spiceText')} onChange={(e) => setS((x) => setSpice(x, e.target.value, x.spiceName))} />
      {lib.errors.some((e) => !/include file '.*' not found/.test(e.message)) ? (
        <ul className="ms-wiz-issues">
          {lib.errors.filter((e) => !/include file '.*' not found/.test(e.message)).slice(0, 5).map((e, i) => (
            <li key={i}>{t('wiz.spiceError', { line: e.line, message: e.message })}</li>
          ))}
        </ul>
      ) : null}
      {lib.missing.length ? (
        <div className="ms-wiz-missing">
          <p className="ms-hint">{t('wiz.spiceMissing')}</p>
          {lib.missing.map((m) => (
            <div key={m}>
              <code>{m}</code>{' '}
              <button type="button" className="ms-btn ms-btn-small" title={t('tip.wiz.spicePickFile')} onClick={() => void pickInclude(m)}>
                {t('wiz.spicePickFile')}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {entries.length ? (
        <table className="ms-table ms-wiz-table">
          <thead>
            <tr>
              <th />
              <th>{t('imp.col.name')}</th>
              <th>{t('imp.col.type')}</th>
              <th>{t('imp.col.terminals')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.name}>
                <td>
                  <input type="radio" name="ms-wiz-model" checked={e.name.toLowerCase() === s.spiceName.toLowerCase()} disabled={e.terminals.length === 0} aria-label={e.name} title={t('tip.wiz.spiceModel')} onChange={() => setS((x) => setSpice(x, x.spiceText, e.name))} />
                </td>
                <td>{e.name}</td>
                <td>{e.kind === 'subckt' ? t('imp.type.subckt') : e.type}</td>
                <td>{e.terminals.length ? e.terminals.join(' ') : t('imp.unusable')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="ms-hint">{t('wiz.spiceNone')}</p>
      )}
    </div>
  );
}

function MakerForm({ s, setS, mk, run }: StepProps & { mk: MakerRun; run: () => void }) {
  const def = getMaker(s.makerId);
  const { errors } = readMakerInput(def, s.makerInput);
  const field = (f: (typeof def.fields)[number]) => {
    const label = `${tDynamic(`maker.${def.id}.${f.key}`, undefined, f.key)}${f.unit ? ` (${f.unit})` : ''}`;
    const tip = tDynamic(`tip.maker.${def.id}.${f.key}`, undefined, label);
    const bad = errors.find((e) => e.key === f.key);
    return (
      <Row key={f.key} label={label} tip={tip}>
        {f.kind === 'select' ? (
          <select className="ms-input" value={s.makerInput[f.key] ?? f.default} title={tip} onChange={(e) => setS((x) => ({ ...x, makerInput: { ...x.makerInput, [f.key]: e.target.value } }))}>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {tDynamic(`maker.opt.${o}`, undefined, o)}
              </option>
            ))}
          </select>
        ) : (
          <input className={`ms-input${bad ? ' ms-wiz-bad' : ''}`} value={s.makerInput[f.key] ?? ''} placeholder={f.optional ? t('wiz.optional') : undefined} aria-invalid={!!bad} title={tip} onChange={(e) => setS((x) => ({ ...x, makerInput: { ...x.makerInput, [f.key]: e.target.value } }))} />
        )}
        {bad ? <span className="ms-cfield-msg">{tDynamic(`maker.error.field.${bad.problem}`, { field: label }, bad.problem)}</span> : null}
      </Row>
    );
  };
  return (
    <div className="ms-wiz-maker">
      <Row label={t('wiz.makerChoose')} tip={t('tip.wiz.makerChoose')}>
        <select
          className="ms-input"
          value={s.makerId}
          title={t('tip.wiz.makerChoose')}
          onChange={(e) =>
            setS((x) => {
              const next = setMaker(x, e.target.value as WizardState['makerId']);
              return x.template === 'custom' ? next : setTemplate(next, getMaker(next.makerId).template);
            })
          }
        >
          {MAKERS.map((m) => (
            <option key={m.id} value={m.id}>
              {tDynamic(`maker.${m.id}.title`, undefined, m.id)}
            </option>
          ))}
        </select>
      </Row>
      <p className="ms-hint">{tDynamic(`maker.${def.id}.help`, undefined, '')}</p>
      <div className="ms-wiz-form ms-wiz-maker-fields">{def.fields.filter((f) => f.section !== 'advanced').map(field)}</div>
      <details className="ms-wiz-advanced">
        <summary>{t('wiz.makerAdvanced')}</summary>
        <div className="ms-wiz-form ms-wiz-maker-fields">{def.fields.filter((f) => f.section === 'advanced').map(field)}</div>
      </details>
      {def.id === 'led' ? (
        <Row label={t('wiz.ledColor')} tip={t('tip.wiz.ledColor')}>
          <select className="ms-input" value={s.ledColor} title={t('tip.wiz.ledColor')} onChange={(e) => setS((x) => ({ ...x, ledColor: e.target.value, makerInput: { ...x.makerInput, color: e.target.value } }))}>
            {LED_MAKER_COLORS.map((c) => (
              <option key={c} value={c}>
                {tDynamic(`maker.opt.${c}`, undefined, c)}
              </option>
            ))}
          </select>
        </Row>
      ) : null}
      <div className="ms-wiz-maker-bar">
        <button type="button" className="ms-btn ms-btn-primary" disabled={errors.length > 0 || mk.busy} onClick={run} title={t('tip.wiz.makerRun')}>
          {mk.busy ? t('wiz.makerRunning') : t('wiz.makerRun')}
        </button>
        {mk.error ? <span className="ms-wiz-error">{mk.error}</span> : null}
      </div>
      {mk.result ? <MakerResultView result={mk.result} outcomes={mk.outcomes} /> : null}
    </div>
  );
}

function MakerResultView({ result, outcomes }: { result: MakerResult; outcomes?: CheckOutcome[] }) {
  return (
    <div className="ms-wiz-maker-result">
      {result.notes.length ? (
        <ul className="ms-wiz-notes">
          {result.notes.map((n, i) => (
            <li key={i} className={n.level === 'warn' ? 'ms-wiz-note-warn' : undefined}>
              {tDynamic(`maker.note.${n.id}`, n.params, n.id)}
            </li>
          ))}
        </ul>
      ) : null}
      {outcomes ? <ChecksTable outcomes={outcomes} /> : null}
      <details>
        <summary>{t('wiz.makerFitted')}</summary>
        <table className="ms-table ms-wiz-table">
          <tbody>
            {Object.entries(result.fitted).map(([k, v]) => (
              <tr key={k}>
                <td>{k.toUpperCase()}</td>
                <td>{Number(v.toPrecision(5))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.model.kind === 'spice' ? <textarea className="ms-input ms-wiz-code" rows={8} readOnly value={result.model.text} title={t('tip.wiz.makerText')} /> : null}
      </details>
    </div>
  );
}

export function ChecksTable({ outcomes }: { outcomes: CheckOutcome[] }) {
  const passed = outcomes.filter((o) => o.pass).length;
  return (
    <div>
      <p className={passed === outcomes.length ? 'ms-wiz-ok' : 'ms-wiz-error'}>{t('wiz.test.summary', { n: passed, total: outcomes.length })}</p>
      <table className="ms-table ms-wiz-table ms-wiz-checks">
        <thead>
          <tr>
            <th>{t('wiz.test.point')}</th>
            <th>{t('wiz.test.datasheet')}</th>
            <th>{t('wiz.test.simulated')}</th>
            <th>{t('wiz.test.error')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o, i) => (
            <tr key={i} className={o.pass ? 'ms-wiz-pass' : 'ms-wiz-fail'}>
              <td>{tDynamic(`maker.check.${o.id}`, checkParams(o.params), o.id)}</td>
              <td>{eng(o.target, o.unit)}</td>
              <td>{o.failure ? t('wiz.test.benchFailed') : eng(o.measured, o.unit)}</td>
              <td>{Number.isFinite(o.error) ? `${(o.error * 100).toFixed(2)} %` : '—'}</td>
              <td aria-label={o.pass ? t('wiz.test.pass') : t('wiz.test.fail')}>{o.pass ? '✓' : '✗'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MappingStep({ s, setS }: StepProps) {
  const terms = modelTerminals(s);
  const pins = s.symbol.pins.map((p) => p.name);
  if (s.source === 'none') return <p className="ms-hint">{t('wiz.map.nothing')}</p>;
  return (
    <div className="ms-wiz-mapping">
      <table className="ms-table ms-wiz-table">
        <thead>
          <tr>
            <th>{t('wiz.map.terminal')}</th>
            <th>{t('wiz.map.pin')}</th>
          </tr>
        </thead>
        <tbody>
          {terms.map((term, i) => (
            <tr key={`${term}-${i}`}>
              <td>
                <code>{term}</code>
              </td>
              <td>
                <select className="ms-input" value={s.pinMap[i] ?? ''} aria-label={term} title={t('tip.wiz.mapPin')} onChange={(e) => setS((x) => setMapping(x, i, e.target.value))}>
                  <option value="">{s.source === 'spice' && terms.length === 4 && i === 3 ? t('wiz.map.bulkSource') : t('wiz.map.none')}</option>
                  {pins.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <SymbolPreview def={symbolDef(s.symbol, s.name)} className="ms-wiz-big-preview" title={t('wiz.symbolPreview')} />
    </div>
  );
}

function TestStep({ s, mk, test, runTest, runMaker: rerun }: { s: WizardState; mk: MakerRun; test: TestRun; runTest: () => void; runMaker: () => void }) {
  if (s.source === 'none') return <p className="ms-hint">{t('wiz.test.none')}</p>;
  return (
    <div className="ms-wiz-test">
      {s.source === 'maker' ? (
        <>
          <p className="ms-hint">{t('wiz.test.makerIntro')}</p>
          <button type="button" className="ms-btn" disabled={mk.busy} onClick={rerun} title={t('tip.wiz.makerRun')}>
            {mk.busy ? t('wiz.makerRunning') : t('wiz.test.rerun')}
          </button>
          {mk.outcomes ? <ChecksTable outcomes={mk.outcomes} /> : null}
        </>
      ) : null}
      <h4>{t('wiz.test.biasTitle')}</h4>
      <p className="ms-hint">{t('wiz.test.biasIntro')}</p>
      <button type="button" className="ms-btn ms-btn-primary" disabled={test.busy} onClick={runTest} title={t('tip.wiz.testRun')}>
        {test.busy ? t('wiz.test.running') : t('wiz.test.run')}
      </button>
      {test.ok === true ? <p className="ms-wiz-ok">{t('wiz.test.ok')}</p> : null}
      {test.ok === false ? <p className="ms-wiz-error">{test.error ?? t('wiz.test.failed')}</p> : null}
      {test.lines?.length ? (
        <ul className="ms-wiz-notes">
          {test.lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SaveStep({ s, part, place, setPlace, replace, setReplace }: { s: WizardState; part: CustomPartData; place: boolean; setPlace: (v: boolean) => void; replace: boolean; setReplace: (v: boolean) => void }) {
  const kind: 'maker' | 'spice' | 'builtin' | 'none' = part.model.kind === 'spice' ? (part.model.maker ? 'maker' : 'spice') : part.model.kind === 'builtin' ? (part.model.maker ? 'maker' : 'builtin') : 'none';
  return (
    <div className="ms-wiz-save">
      <SymbolPreview def={symbolDef(part.symbol, part.name)} className="ms-wiz-big-preview" title={t('wiz.symbolPreview')} />
      <dl className="ms-wiz-summary">
        <dt>{t('wiz.name')}</dt>
        <dd>{part.name}</dd>
        <dt>{t('wiz.group')}</dt>
        <dd>
          {groupName(part.group)} › {familyName(part.family)}
        </dd>
        <dt>{t('wiz.prefix')}</dt>
        <dd>{part.prefix}</dd>
        <dt>{t('wiz.step.pins')}</dt>
        <dd>{part.symbol.pins.map((p) => p.name).join(', ')}</dd>
        <dt>{t('wiz.footprint')}</dt>
        <dd>{part.footprint ?? '—'}</dd>
        <dt>{t('wiz.step.model')}</dt>
        <dd>{t(`db.model.${kind}`)}</dd>
        <dt>{t('wiz.db')}</dt>
        <dd>{t(`wiz.db.${s.db}`)}</dd>
      </dl>
      <label className="ms-cfield ms-cfield-check">
        <input type="checkbox" checked={place} title={t('tip.wiz.place')} onChange={(e) => setPlace(e.target.checked)} />
        <span>{t('wiz.placeAfter')}</span>
      </label>
      {s.replaceInstance ? (
        <label className="ms-cfield ms-cfield-check">
          <input type="checkbox" checked={replace} title={t('tip.wiz.replace')} onChange={(e) => setReplace(e.target.checked)} />
          <span>{t('wiz.replacePlaced')}</span>
        </label>
      ) : null}
    </div>
  );
}

/** Open the component wizard on a state (newWizard / wizardFromPart / wizardFromPlaced). */
export function openWizardDialog(state: WizardState): void {
  openCustomDialog((close) => <ComponentWizard init={state} close={close} />);
}

/** Current selection's single part instance and its definition (for "Edit component"). */
export function selectedPart(): { instId: string; def: PartDef; params: Record<string, string> } | undefined {
  const st = getState();
  if (st.selection.length !== 1 || st.selection[0].kind !== 'part') return undefined;
  const id = st.selection[0].id;
  for (const sheet of [...st.design.sheets, ...(st.design.children ?? []).flatMap((c) => c.sheets)]) {
    const inst = sheet.parts.find((p) => p.id === id);
    if (!inst || inst.partId.startsWith('hier:')) continue;
    const def = partLookup(inst.partId);
    return def ? { instId: inst.id, def, params: inst.params } : undefined;
  }
  return undefined;
}
