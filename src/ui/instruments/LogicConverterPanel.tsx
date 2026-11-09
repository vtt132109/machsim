/**
 * Logic converter panel: truth table of up to 8 inputs (A..H, A = MSB) with clickable output
 * cells (0 → 1 → X), and conversions
 *   circuit → table      (from the per-row operating points in `dc`, see logicConverter.ts)
 *   table → expression   (minimised sum of products, Quine–McCluskey)
 *   table → canonical    (sum of minterms)
 *   expression → table
 *   table / expression → NAND-only form
 *
 * Params: inputs, table, expr, vhigh, threshold (see logicConverter.ts).
 */

import { useEffect, useState } from 'react';
import { LOGIC_VARS, LogicExpressionError, MAX_LOGIC_INPUTS, expressionToTable, inputBit, minimizeSop, sopToNand, tableMinterms, tableToCanonical, tableToExpression } from './logic';
import { LOGIC_CONVERTER_DEFAULTS, parseLogicConverterSettings, resizeTable, tableFromRuns, wiredInputCount } from './logicConverter';
import { NotConnected, NumberField, Section, paramApi } from './panelKit';
import type { InstrumentPanelProps } from './types';
import { t } from '../../i18n';

const NEXT: Record<string, string> = { '0': '1', '1': 'X', X: '0' };

export function LogicConverterPanel(props: InstrumentPanelProps) {
  const { binding, dc, params, onParamsChange, host } = props;
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const p = paramApi(params, onParamsChange, LOGIC_CONVERTER_DEFAULTS);
  const s = parseLogicConverterSettings(params);
  const n = s.inputs;
  const rows = 1 << n;
  const [exprDraft, setExprDraft] = useState(s.expr);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setExprDraft(s.expr), [s.expr]);
  const wired = wiredInputCount(binding);
  const fromCircuit = dc && binding.channels.out ? tableFromRuns(dc, binding.channels.out, s.threshold, rows) : null;

  const setTable = (t: string, extra: Record<string, string> = {}) => p.patch({ table: t, ...extra });
  const toggle = (row: number) => {
    const t = s.table.split('');
    t[row] = NEXT[t[row]] ?? '0';
    setTable(t.join(''));
  };
  const setInputs = (k: number) => {
    const next = Math.max(1, Math.min(MAX_LOGIC_INPUTS, k));
    p.patch({ inputs: String(next), table: resizeTable(s.table, n, next) });
  };
  const run = (fn: () => void) => {
    try {
      setError(null);
      fn();
    } catch (e) {
      setError(e instanceof LogicExpressionError ? `${e.message} (at ${e.position + 1})` : e instanceof Error ? e.message : String(e));
    }
  };
  const exprToTable = () =>
    run(() => {
      const r = expressionToTable(exprDraft, Math.max(n, 1));
      p.patch({ table: r.table, inputs: String(r.inputs), expr: exprDraft });
    });
  const exprToNand = () =>
    run(() => {
      const r = expressionToTable(exprDraft, Math.max(n, 1));
      const { ones, dontCares } = tableMinterms(r.table);
      p.patch({ table: r.table, inputs: String(r.inputs), expr: sopToNand(minimizeSop(r.inputs, ones, dontCares), r.inputs) });
    });

  /** expression (or, when empty, the truth table) → gate circuit on the schematic */
  const toCircuit = (nandOnly: boolean) =>
    run(() => {
      if (!host?.placeLogicCircuit) return;
      let table = s.table;
      let inputs = n;
      if (exprDraft.trim()) {
        const r = expressionToTable(exprDraft, Math.max(n, 1));
        table = r.table;
        inputs = r.inputs;
        p.patch({ table: r.table, inputs: String(r.inputs), expr: exprDraft });
      }
      const { ones, dontCares } = tableMinterms(table);
      const terms = minimizeSop(inputs, ones, dontCares);
      setPlacing(true);
      setPlaced(null);
      void host.placeLogicCircuit(terms, inputs, nandOnly).then((err) => {
        setPlacing(false);
        if (err) setError(err);
        else setPlaced(nandOnly ? t('instruments.logicConverter.placedNand') : t('instruments.logicConverter.placedAndOr'));
      });
    });

  return (
    <div className="msi-panel msi-logicconv">
      <div className="msi-row">
        <span className="msi-field-label">{t('instruments.logicConverter.inputs')}</span>
        <div className="msi-seg msi-seg-small" role="radiogroup" aria-label={t('instruments.logicConverter.numberOfInputs')} title={t('tip.lc.inputs')}>
          {LOGIC_VARS.map((v, i) => (
            <button key={v} type="button" role="radio" aria-checked={i < n} className={i < n ? 'msi-on' : ''} onClick={() => setInputs(i + 1)} title={t('instruments.logicConverter.useInputsAV', { v: v })}>
              {v}
            </button>
          ))}
        </div>
        <span className="msi-dim">{wired ? t('instruments.logicConverter.inputsWired', { n: wired }) : t('instruments.logicConverter.noInputsWired')}</span>
      </div>
      <div className="msi-logicconv-body">
        <div className="msi-truth-scroll">
          <table className="msi-table msi-truth" aria-label={t('instruments.logicConverter.truthTable')}>
            <thead>
              <tr>
                <th scope="col">#</th>
                {LOGIC_VARS.slice(0, n).map((v) => (
                  <th key={v} scope="col">
                    {v}
                  </th>
                ))}
                <th scope="col">{t('instruments.logicConverter.out')}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, row) => (
                <tr key={row}>
                  <th scope="row" className="msi-mono">
                    {row}
                  </th>
                  {LOGIC_VARS.slice(0, n).map((v, k) => (
                    <td key={v} className="msi-mono msi-center">
                      {inputBit(row, k, n)}
                    </td>
                  ))}
                  <td className="msi-center">
                    <button type="button" className={`msi-bit msi-out-${s.table[row]}`} aria-label={t('instruments.logicConverter.rowRowOutputValue', { row: row, value: s.table[row] })} title={t('tip.lc.outBit')} onClick={() => toggle(row)}>
                      {s.table[row]}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="msi-logicconv-side">
          <Section title={t('instruments.logicConverter.conversions')}>
            <button
              type="button"
              className="msi-btn msi-btn-block"
              disabled={!fromCircuit}
              title={fromCircuit ? t('instruments.logicConverter.useTheOutputsMeasuredFor') : t('instruments.logicConverter.needsThePerRowOperating')}
              onClick={() => fromCircuit && setTable(fromCircuit)}
            >
              {t('instruments.logicConverter.circuitTruthTable')}
            </button>
            <button type="button" className="msi-btn msi-btn-block" onClick={() => run(() => p.set('expr', tableToCanonical(s.table, n)))} title={t('tip.lc.canonical')}>
              {t('instruments.logicConverter.truthTableSopCanonical')}
            </button>
            <button type="button" className="msi-btn msi-btn-block" onClick={() => run(() => p.set('expr', tableToExpression(s.table, n)))} title={t('tip.lc.simplified')}>
              {t('instruments.logicConverter.truthTableSimplified')}
            </button>
            <button
              type="button"
              className="msi-btn msi-btn-block"
              title={t('tip.lc.nand')}
              onClick={() =>
                run(() => {
                  const { ones, dontCares } = tableMinterms(s.table);
                  p.set('expr', sopToNand(minimizeSop(n, ones, dontCares), n));
                })
              }
            >
              {t('instruments.logicConverter.truthTableNandOnly')}
            </button>
            <button type="button" className="msi-btn msi-btn-block" onClick={exprToTable} title={t('tip.lc.exprTable')}>
              {t('instruments.logicConverter.expressionTruthTable')}
            </button>
            <button type="button" className="msi-btn msi-btn-block" onClick={exprToNand} title={t('tip.lc.exprNand')}>
              {t('instruments.logicConverter.expressionNandOnly')}
            </button>
            <button type="button" className="msi-btn msi-btn-block" disabled={!host?.placeLogicCircuit || placing} onClick={() => toCircuit(false)} title={t('tip.lc.toCircuit')}>
              {t('instruments.logicConverter.expressionCircuit')}
            </button>
            <button type="button" className="msi-btn msi-btn-block" disabled={!host?.placeLogicCircuit || placing} onClick={() => toCircuit(true)} title={t('tip.lc.toNandCircuit')}>
              {t('instruments.logicConverter.expressionNandCircuit')}
            </button>
          </Section>
          <Section title={t('instruments.logicConverter.circuitLevels')}>
            <NumberField label={t('instruments.logicConverter.logic1Drive')} value={p.text('vhigh')} unit="V" onCommit={(t) => p.set('vhigh', t)} title={t('tip.lc.vhigh')} size={5} />
            <NumberField label={t('instruments.logicConverter.outputThreshold')} value={p.text('threshold')} unit="V" onCommit={(t) => p.set('threshold', t)} title={t('tip.lc.threshold')} size={5} />
          </Section>
        </div>
      </div>
      <label className="msi-field msi-field-wide">
        <span className="msi-field-label">{t('instruments.logicConverter.booleanExpressionANotA')}</span>
        <input
          className="msi-input msi-mono"
          value={exprDraft}
          spellCheck={false}
          placeholder={t('instruments.logicConverter.exprPlaceholder')}
          title={t('tip.lc.expr')}
          onChange={(e) => setExprDraft(e.target.value)}
          onBlur={() => exprDraft !== s.expr && p.set('expr', exprDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') exprToTable();
          }}
        />
      </label>
      {error && (
        <div className="msi-field-error" role="alert">
          {error}
        </div>
      )}
      {placed && !error && (
        <div className="msi-note" role="status">
          {placed}
        </div>
      )}
      {!binding.channels.out && wired > 0 && <NotConnected what={t('instruments.logicConverter.connectTheConvertersOutTerminal')} />}
    </div>
  );
}
