/**
 * PLD wizard (Tools > Programmable-logic (PLD) wizard…, loaded on first use).
 *
 * The learner names the inputs and the outputs, writes a truth table or Boolean equations with
 * those names, and the wizard
 *  - compiles the logic with the same compiler the simulated PLD block runs
 *    (src/sim/devices/digital/logicExpr.ts), reporting every problem with its line number;
 *  - picks the smallest catalogue PLD block that fits and shows which one;
 *  - places that block on the current sheet (or opens it as a new design) with a net label on
 *    every used pin and a probe on each output (src/model/wizards/pldDesign.ts);
 *  - exports the same logic as VHDL or Verilog (src/model/hdl.ts), with a preview.
 *
 * JEDEC fuse maps are deliberately not offered; the reason is stated in the dialog.
 */
import { useMemo, useState } from 'react';
import { buildPld, pldDesign, PLD_MAX_INPUTS, PLD_MAX_OUTPUTS } from '../../model/wizards/pldDesign';
import { hdlExtension, hdlText, type HdlLanguage } from '../../model/hdl';
import { programText } from '../../sim/devices/digital/logicExpr';
import { mt } from '../../i18n/mcuText';
import { t } from '../../i18n';
import { actions } from '../app/extensions';
import { openGeneratedDesign } from '../app/document';
import { downloadText } from '../app/files';
import { openHelp } from '../help/open';
import { partName } from '../../i18n/library';
import { getPart } from '../../library';
import './mcu.css';

const DEFAULT_LOGIC = ['SUM = A ^ B ^ CIN', 'COUT = A & B | A & CIN | B & CIN'].join('\n');

/** Split a name list on commas, semicolons or blanks. */
function names(text: string): string[] {
  return text
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** An empty truth table with one row per input combination. */
function emptyTable(inputs: string[], outputs: string[]): string {
  const n = Math.min(8, inputs.length);
  const head = `${inputs.join(' ')} | ${outputs.join(' ')}`;
  const rows: string[] = [];
  for (let word = 0; word < 1 << n; word++) {
    const cells = inputs.map((_x, k) => String((word >> (inputs.length - 1 - k)) & 1));
    rows.push(`${cells.join(' ')} | ${outputs.map(() => '0').join(' ')}`);
  }
  return [head, ...rows].join('\n');
}

export function PldWizard({ close }: { close?: () => void }) {
  const [name, setName] = useState(() => mt('pldDefaultName'));
  const [inputText, setInputText] = useState('A, B, CIN');
  const [outputText, setOutputText] = useState('SUM, COUT');
  const [logic, setLogic] = useState(DEFAULT_LOGIC);
  const [lang, setLang] = useState<HdlLanguage>('vhdl');
  const [status, setStatus] = useState('');

  const inputs = useMemo(() => names(inputText), [inputText]);
  const outputs = useMemo(() => names(outputText), [outputText]);
  const build = useMemo(() => buildPld({ inputs, outputs, program: logic, name, comment: [mt('pldHdlComment')] }), [inputs, outputs, logic, name]);
  const ok = build.errors.length === 0 && build.nameErrors.length === 0 && build.partId !== null;
  const preview = useMemo(() => (build.hdl ? hdlText(build.hdl, lang) : ''), [build.hdl, lang]);
  const blockName = build.partId ? (partName(getPart(build.partId) ?? { id: build.partId, name: build.partId }) ?? build.partId) : '';

  const place = () => {
    const r = pldDesign({ inputs, outputs, program: logic, name });
    if (!r.partId) return;
    const sheet = r.design.sheets[0];
    actions.insertFragment({ parts: sheet.parts, wires: [], labels: sheet.labels, probes: sheet.probes, notes: [], anchor: { x: 0, y: 0 } }, { x: 0, y: 0 });
    setStatus(mt('pldPlaced', { part: blockName }));
    close?.();
  };

  const newDesign = () => {
    const r = pldDesign({ inputs, outputs, program: logic, name });
    void openGeneratedDesign(r.design, `${r.design.title.replace(/[^\w.-]+/g, '_')}.msim`);
    close?.();
  };

  const exportHdl = (which: HdlLanguage) => {
    if (!build.hdl) return;
    const file = `${build.hdl.name}${hdlExtension(which)}`;
    downloadText(file, hdlText(build.hdl, which));
    setStatus(mt('pldExported', { file }));
  };

  return (
    <div className="ms-pld">
      <p className="ms-hint">{mt('pldIntro')}</p>
      <div className="ms-pld-grid">
        <label htmlFor="ms-pld-name">{mt('pldName')}</label>
        <input id="ms-pld-name" className="ms-input" title={mt('tipPldName')} value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="ms-pld-in">{mt('pldInputs')}</label>
        <input
          id="ms-pld-in"
          className="ms-input"
          title={mt('tipPldInputs', { max: PLD_MAX_INPUTS })}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <label htmlFor="ms-pld-out">{mt('pldOutputs')}</label>
        <input
          id="ms-pld-out"
          className="ms-input"
          title={mt('tipPldOutputs', { max: PLD_MAX_OUTPUTS })}
          value={outputText}
          onChange={(e) => setOutputText(e.target.value)}
        />
        <label htmlFor="ms-pld-logic">{mt('pldLogic')}</label>
        <textarea
          id="ms-pld-logic"
          className="ms-pld-logic"
          spellCheck={false}
          title={mt('tipPldLogic')}
          value={logic}
          onChange={(e) => setLogic(e.target.value)}
        />
      </div>

      <div className="ms-mcu-row">
        <button
          type="button"
          className="ms-btn ms-btn-small"
          title={mt('tipPldTable')}
          disabled={inputs.length === 0 || outputs.length === 0}
          onClick={() => setLogic(emptyTable(inputs, outputs))}
        >
          {mt('pldTable')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" onClick={() => openHelp({ kind: 'guide', page: 'pld' })}>
          {mt('help')}
        </button>
      </div>

      <div aria-live="polite">
        {build.nameErrors.map((e, k) => (
          <p className="ms-mcu-error" key={`n${k}`}>
            {mt('pldNameError', {
              name: e.name,
              reason:
                e.reason === 'empty'
                  ? mt('pldReasonEmpty')
                  : e.reason === 'syntax'
                    ? mt('pldReasonSyntax')
                    : e.reason === 'reserved'
                      ? mt('pldReasonReserved')
                      : mt('pldReasonDuplicate'),
            })}
          </p>
        ))}
        {build.unknown.map((n) => (
          <p className="ms-mcu-error" key={`u${n}`}>
            {mt('pldUnknown', { name: n })}
          </p>
        ))}
        {build.compiled.errors.map((e, k) => (
          <p className="ms-mcu-error" key={`c${k}`}>
            {e}
          </p>
        ))}
        {build.partId === null && build.nameErrors.length === 0 ? (
          <p className="ms-mcu-error">
            {mt('pldNoBlock', { inputs: inputs.length, outputs: outputs.length, maxIn: PLD_MAX_INPUTS, maxOut: PLD_MAX_OUTPUTS })}
          </p>
        ) : null}
        {ok ? (
          <>
            <p className="ms-mcu-ok">{mt('pldBlock', { part: blockName, inputs: build.size?.inputs ?? 0, outputs: build.size?.outputs ?? 0 })}</p>
            {build.clocked ? <p className="ms-hint">{mt('pldClocked')}</p> : null}
            {build.triState ? <p className="ms-hint">{mt('pldTriState')}</p> : null}
            {build.hdl && build.hdl.renamed.length > 0 ? (
              <p className="ms-hint">{mt('pldRenamed', { names: build.hdl.renamed.map((r) => `${r.from} → ${r.to}`).join(', ') })}</p>
            ) : null}
          </>
        ) : null}
        {status.length > 0 ? <p className="ms-mcu-ok">{status}</p> : null}
      </div>

      {ok ? (
        <>
          <span className="ms-mcu-cell-label">{mt('pldEquations')}</span>
          <pre className="ms-pld-preview">{programText(build.compiled)}</pre>
        </>
      ) : null}

      <div className="ms-mcu-row">
        <button type="button" className="ms-btn ms-btn-small ms-btn-primary" disabled={!ok} title={mt('tipPldPlace')} onClick={place}>
          {mt('pldPlace')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" disabled={!ok} onClick={newDesign}>
          {mt('pldNewDesign')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" disabled={!build.hdl} onClick={() => exportHdl('vhdl')}>
          {mt('pldExportVhdl')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" disabled={!build.hdl} onClick={() => exportHdl('verilog')}>
          {mt('pldExportVerilog')}
        </button>
        {close ? (
          <button type="button" className="ms-btn ms-btn-small" onClick={close}>
            {t('common.close')}
          </button>
        ) : null}
      </div>

      {build.hdl ? (
        <>
          <div className="ms-mcu-row">
            <span className="ms-mcu-cell-label">{mt('pldPreview')}</span>
            <button
              type="button"
              className={lang === 'vhdl' ? 'ms-btn ms-btn-small is-active' : 'ms-btn ms-btn-small'}
              aria-pressed={lang === 'vhdl'}
              onClick={() => setLang('vhdl')}
            >
              VHDL
            </button>
            <button
              type="button"
              className={lang === 'verilog' ? 'ms-btn ms-btn-small is-active' : 'ms-btn ms-btn-small'}
              aria-pressed={lang === 'verilog'}
              onClick={() => setLang('verilog')}
            >
              Verilog
            </button>
          </div>
          <pre className="ms-pld-preview">{preview}</pre>
        </>
      ) : null}
      <p className="ms-hint">{mt('pldJedec')}</p>
    </div>
  );
}
