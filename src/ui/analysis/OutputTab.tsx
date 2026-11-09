/**
 * Output tab of the analysis dialog: which variables the simulation saves, filtered by kind
 * (node voltages, currents, powers, device values, internal helper nodes) and by text, plus the
 * output expressions (postprocessor syntax) evaluated on every result of a run.
 *
 *   <OutputTab available saves onSavesChange expressions onExpressionsChange />
 *
 * `outputKind` / `filterOutputs` / `checkExpression` are pure and unit-tested.
 */
import { useState } from 'react';
import { compileExpression, POSTPROCESSOR_FUNCTIONS } from '../results/postprocessor';
import { isInternalVector } from '../results/titles';
import { t } from '../../i18n';

export type OutputKind = 'voltage' | 'current' | 'power' | 'device' | 'internal';
export const OUTPUT_KINDS: readonly OutputKind[] = ['voltage', 'current', 'power', 'device', 'internal'];

/** Kind of an output name: V(..) voltage, I(..) current, P(..) power, other KEY(dev) device value. */
export function outputKind(name: string): OutputKind {
  if (isInternalVector(name)) return 'internal';
  const fn = /^\s*([A-Za-z]+)\(/.exec(name)?.[1]?.toLowerCase() ?? '';
  if (fn === 'v') return 'voltage';
  if (fn === 'i') return 'current';
  if (fn === 'p') return 'power';
  return fn ? 'device' : 'voltage';
}

/** Names matching the text filter (case-insensitive substring) and one of the kinds. */
export function filterOutputs(names: readonly string[], text: string, kinds: ReadonlySet<OutputKind>): string[] {
  const f = text.trim().toLowerCase();
  return names.filter((n) => kinds.has(outputKind(n)) && (!f || n.toLowerCase().includes(f)));
}

/**
 * Problems of an output expression against the circuit's output names (empty = fine). References
 * to other Grapher pages (tran2.V(out)) are accepted as they are only known after runs.
 */
export function checkExpression(expr: string, available: readonly string[]): string | null {
  let compiled;
  try {
    compiled = compileExpression(expr);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  const known = new Set(available.map((n) => n.toLowerCase().replace(/\s+/g, '')));
  const nodes = new Set([...known].map((n) => /^v\(([^,()]+)\)$/.exec(n)?.[1]).filter((x): x is string => !!x));
  for (const ref of compiled.references) {
    const k = ref.toLowerCase().replace(/\s+/g, '');
    if (known.has(k) || /^[a-z]+[0-9]+\./.test(k) || ['time', 'frequency', 'x', 'scale'].includes(k) || k in POSTPROCESSOR_FUNCTIONS) continue;
    const v2 = /^v\(([^,()]+),([^,()]+)\)$/.exec(k);
    if (v2 && (nodes.has(v2[1]) || v2[1] === '0') && (nodes.has(v2[2]) || v2[2] === '0')) continue;
    if (!/[(]/.test(k) && nodes.has(k)) continue;
    return t('analysis.output.unknownName', { name: ref });
  }
  return null;
}

export interface OutputTabProps {
  available: readonly string[];
  saves: readonly string[];
  onSavesChange: (s: string[]) => void;
  expressions?: readonly string[];
  onExpressionsChange?: (e: string[]) => void;
}

export function OutputTab({ available, saves, onSavesChange, expressions, onExpressionsChange }: OutputTabProps) {
  const [filter, setFilter] = useState('');
  const [kinds, setKinds] = useState<Set<OutputKind>>(() => new Set<OutputKind>(['voltage', 'current', 'power', 'device']));
  const [pickLeft, setPickLeft] = useState<string[]>([]);
  const [pickRight, setPickRight] = useState<string[]>([]);
  const [expr, setExpr] = useState('');
  const isSel = (o: string) => saves.some((s) => s.toLowerCase() === o.toLowerCase());
  const left = filterOutputs(available.filter((o) => !isSel(o)), filter, kinds);
  const right = saves.filter((o) => !filter.trim() || o.toLowerCase().includes(filter.trim().toLowerCase()));
  const exprError = expr.trim() ? checkExpression(expr, available) : null;
  const toggleKind = (k: OutputKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  };
  const add = (list: string[]) => onSavesChange([...saves, ...list.filter((o) => !isSel(o))]);
  return (
    <div className="msa-outputsel">
      <p className="msa-note">{t('analysis.output.intro')}</p>
      <div className="msa-row">
        <input className="msa-input" placeholder={t('analysis.analysisSetupDialog.filterVariables')} aria-label={t('analysis.analysisSetupDialog.filterVariables')} title={t('tip.output.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="msa-kinds" role="group" aria-label={t('analysis.output.kinds')}>
          {OUTPUT_KINDS.map((k) => (
            <label key={k} className="msa-check" title={t(`tip.output.kind.${k}`)}>
              <input type="checkbox" checked={kinds.has(k)} onChange={() => toggleKind(k)} /> {t(`analysis.output.kind.${k}`)}
            </label>
          ))}
        </div>
      </div>
      <span className="msa-hint">{saves.length ? t('analysis.analysisSetupDialog.lengthVariablesSaved', { length: saves.length }) : t('analysis.analysisSetupDialog.nothingSelectedAllNodeVoltages')}</span>
      <div className="msa-dual">
        <label className="msa-dual-col">
          <span className="msa-label">{t('analysis.analysisSetupDialog.variablesInCircuit')}</span>
          <select multiple size={12} className="msa-input msa-mono" title={t('tip.output.left')} value={pickLeft} onChange={(e) => setPickLeft(Array.from(e.target.selectedOptions, (o) => o.value))} onDoubleClick={() => pickLeft.length && add(pickLeft)}>
            {left.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <div className="msa-dual-buttons">
          <button type="button" className="msa-btn" title={t('tip.output.add')} disabled={!pickLeft.length} onClick={() => (add(pickLeft), setPickLeft([]))}>
            {t('analysis.analysisSetupDialog.add')}
          </button>
          <button type="button" className="msa-btn" title={t('tip.output.remove')} disabled={!pickRight.length} onClick={() => (onSavesChange(saves.filter((o) => !pickRight.includes(o))), setPickRight([]))}>
            {t('analysis.analysisSetupDialog.remove')}
          </button>
          <button type="button" className="msa-btn" title={t('tip.output.addAll')} disabled={!left.length} onClick={() => add(left)}>
            {t('analysis.analysisSetupDialog.addAll')}
          </button>
          <button type="button" className="msa-btn" title={t('tip.output.removeAll')} disabled={!saves.length} onClick={() => onSavesChange([])}>
            {t('analysis.analysisSetupDialog.removeAll')}
          </button>
        </div>
        <label className="msa-dual-col">
          <span className="msa-label">{t('analysis.analysisSetupDialog.selectedForAnalysis')}</span>
          <select multiple size={12} className="msa-input msa-mono" title={t('tip.output.right')} value={pickRight} onChange={(e) => setPickRight(Array.from(e.target.selectedOptions, (o) => o.value))}>
            {right.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      </div>
      {onExpressionsChange && (
        <div className="msa-exprs">
          <span className="msa-label">{t('analysis.output.expressions')}</span>
          <p className="msa-hint">{t('analysis.output.expressionsHelp')}</p>
          <ul className="msa-expr-list">
            {(expressions ?? []).map((e, i) => (
              <li key={`${e}-${i}`}>
                <code>{e}</code>
                <button type="button" className="msa-btn msa-btn-icon" title={t('tip.output.removeExpr')} aria-label={t('tip.output.removeExpr')} onClick={() => onExpressionsChange((expressions ?? []).filter((_x, k) => k !== i))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="msa-row">
            <input
              className="msa-input msa-mono"
              placeholder={t('analysis.output.placeholder')}
              aria-label={t('analysis.output.newExpression')}
              title={t('tip.output.expression')}
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && expr.trim() && !exprError) {
                  onExpressionsChange([...(expressions ?? []), expr.trim()]);
                  setExpr('');
                }
              }}
            />
            <button
              type="button"
              className="msa-btn"
              title={t('tip.output.addExpr')}
              disabled={!expr.trim() || !!exprError}
              onClick={() => {
                onExpressionsChange([...(expressions ?? []), expr.trim()]);
                setExpr('');
              }}
            >
              {t('analysis.output.addExpression')}
            </button>
          </div>
          {exprError && <span className="msa-error-text">{exprError}</span>}
        </div>
      )}
    </div>
  );
}
