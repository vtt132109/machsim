/**
 * Dialogs and flows of the editing commands that came with document tabs (lazy chunk):
 *  - Edit > Layer settings: show / hide the grid, reference designators, values, net labels, net
 *    names, pin numbers, comments and graphics of a sheet (this sheet, every sheet of the level, or
 *    all), applied live;
 *  - Edit > Order: bring to front / send to back / one step for graphics and text;
 *  - Edit > Paste special: paste keeping the names, paste values only, paste as a subcircuit;
 *  - Tools > Reference designator prefixes: the naming rules of the design.
 */
import { useState } from 'react';
import { Dialog } from '../common/Dialog';
import { openHelp } from '../help/open';
import { CheckField, CommitField, SelectField } from '../common/Field';
import { openCustomDialog, promptText } from '../common/dialogs';
import { actions, getState, partLookup, useEditor } from '../store';
import { levelSheets } from '../store/refdes';
import { allSheets } from '../../model/hierarchy';
import { LAYER_DEFAULTS, LAYER_IDS, layerTable, type LayerId } from '../../model/layers';
import { effectivePrefix, normalizeRules, usedLibraryPrefixes, validateRules, type RuleProblem } from '../../model/refdesRules';
import { annotationRefs } from '../../model/annotationOrder';
import type { RefdesRules } from '../../model/types';
import { dt, type DocsTextKey } from '../../i18n/docsText';
import { t } from '../../i18n';

const SOURCE = () => t('sim.source.editing');

/** "Pasted with names kept": `count` parts were pasted, `renamed` of them got a new name (so `count - renamed` kept theirs). */
export function pasteKeepMessage(count: number, renamed = 0): string {
  return renamed ? dt('pasteKeepDone', { n: count - renamed, renamed }) : dt('pasteKeepAll', { n: count });
}

// ---------------------------------------------------------------------------
// layer settings
// ---------------------------------------------------------------------------

/** text keys of each layer: the name and the one-line explanation */
const LAYER_TEXT: Record<LayerId, readonly [DocsTextKey, DocsTextKey]> = {
  grid: ['layerGrid', 'layerGridTip'],
  refdes: ['layerRefdes', 'layerRefdesTip'],
  values: ['layerValues', 'layerValuesTip'],
  labels: ['layerLabels', 'layerLabelsTip'],
  netNames: ['layerNetNames', 'layerNetNamesTip'],
  pinNumbers: ['layerPinNumbers', 'layerPinNumbersTip'],
  comments: ['layerComments', 'layerCommentsTip'],
  graphics: ['layerGraphics', 'layerGraphicsTip'],
};

type LayerScope = 'sheet' | 'level' | 'all';

/** Ids of the sheets a layer change applies to. */
export function layerTargets(scope: LayerScope): string[] {
  const s = getState();
  if (scope === 'sheet') return [s.activeSheetId];
  if (scope === 'level') return levelSheets(s.design, s.activeSheetId).map((x) => x.id);
  return allSheets(s.design).map((x) => x.id);
}

function LayerSettingsDialog({ close }: { close: () => void }) {
  const sheet = useEditor((s) => levelSheets(s.design, s.activeSheetId).find((x) => x.id === s.activeSheetId));
  const hasMany = useEditor((s) => allSheets(s.design).length > 1);
  const [scope, setScope] = useState<LayerScope>('sheet');
  const table = layerTable(sheet);
  const set = (id: LayerId, v: boolean) => actions.setSheetLayers({ [id]: v }, layerTargets(scope));
  return (
    <Dialog
      title={dt('layersTitle')}
      guide="editingTools"
      onClose={close}
      width={460}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={() => actions.setSheetLayers({ ...LAYER_DEFAULTS }, layerTargets(scope))}>
            {dt('layersReset')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="ms-btn" title={dt('helpTip')} onClick={() => void openHelp({ kind: 'guide', page: 'editingTools' })}>
            {dt('help')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={close}>
            {dt('layersClose')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{dt('layersIntro')}</p>
      {hasMany ? (
        <SelectField
          label={dt('layersScope')}
          value={scope}
          options={[
            { value: 'sheet', label: dt('scopeSheet') },
            { value: 'level', label: dt('scopeLevel') },
            { value: 'all', label: dt('scopeAll') },
          ]}
          onChange={(v) => setScope(v as LayerScope)}
        />
      ) : null}
      <div className="ms-prop-section">
        {LAYER_IDS.map((id) => (
          <div key={id}>
            <CheckField label={dt(LAYER_TEXT[id][0])} checked={table[id]} onChange={(v) => set(id, v)} />
            <p className="ms-hint" style={{ margin: '0 0 6px 24px' }}>
              {dt(LAYER_TEXT[id][1])}
            </p>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function openLayerSettingsDialog(): void {
  openCustomDialog((close) => <LayerSettingsDialog close={close} />);
}

// ---------------------------------------------------------------------------
// drawing order
// ---------------------------------------------------------------------------

/** Edit > Order > …: move the selected graphics / texts; tells the learner when nothing could move. */
export function orderFlow(op: 'front' | 'back' | 'forward' | 'backward'): void {
  const s = getState();
  if (!annotationRefs(s.selection).length) {
    actions.addSimMessage('info', dt('orderNothing'), SOURCE());
    return;
  }
  if (!actions.orderSelection(op)) actions.addSimMessage('info', dt('orderSame'), SOURCE());
}

// ---------------------------------------------------------------------------
// paste special
// ---------------------------------------------------------------------------

export async function pasteSpecialFlow(mode: 'keepNames' | 'values' | 'block'): Promise<void> {
  const say = (text: string, severity: 'info' | 'warning' = 'info') => actions.addSimMessage(severity, text, SOURCE());
  if (!actions.getClipboard()) {
    say(dt('pasteNoClipboard'), 'warning');
    return;
  }
  if (mode === 'block') {
    const name = await promptText({ title: dt('pasteBlockTitle'), label: dt('pasteBlockName'), initial: dt('pasteBlockDefault'), validate: (v) => (v.trim() ? null : t('editor.properties.enterAName')) });
    if (!name) return;
    const r = actions.pasteSpecial('block', { name: name.trim() });
    if (r.ok) say(dt('pasteBlockDone', { name: name.trim() }));
    else say(r.reason === 'noParts' ? dt('pasteBlockNoParts') : dt('pasteRestricted'), 'warning');
    return;
  }
  const r = actions.pasteSpecial(mode);
  if (r.ok) {
    if (mode === 'values') say(dt('pasteValuesDone', { n: r.count }));
    else say(pasteKeepMessage(r.count, r.renamed));
    return;
  }
  if (r.reason === 'noTarget') say(dt('pasteValuesNoTarget'), 'warning');
  else if (r.reason === 'nothingMatched') say(dt('pasteValuesNoMatch'), 'warning');
  else if (r.reason === 'noClipboard') say(dt('pasteNoClipboard'), 'warning');
  else say(dt('pasteRestricted'), 'warning');
}

// ---------------------------------------------------------------------------
// reference designator prefix rules
// ---------------------------------------------------------------------------

function problemText(p: RuleProblem): string {
  switch (p.code) {
    case 'badText':
      return dt('prefixBadText', { text: p.text });
    case 'tooLong':
      return dt('prefixTooLong', { text: p.text, max: 12 });
    case 'endsInDigit':
      return dt('prefixEndsInDigit', { text: p.text });
    case 'clash':
      return dt('prefixClash', { at: p.at, text: p.text });
  }
}

function PrefixRulesDialog({ close }: { close: () => void }) {
  const design = useEditor((s) => s.design);
  const used = usedLibraryPrefixes(design, partLookup);
  const hasParts = used.length > 0;
  const [global, setGlobal] = useState(design.refdesRules?.global ?? '');
  const [map, setMap] = useState<Record<string, string>>(() => ({ ...(design.refdesRules?.map ?? {}) }));
  const [rename, setRename] = useState(hasParts);
  const [extra, setExtra] = useState('');
  const kinds = [...new Set([...used, ...Object.keys(map)])].sort();
  const rules: RefdesRules | undefined = normalizeRules({ global, map });
  const problems = validateRules(rules, used);
  const apply = () => {
    if (problems.length) return;
    const r = actions.setRefdesRules(rules, rename);
    const parts = [rules ? (rename ? dt('prefixDone', { n: r.changed }) : dt('prefixDoneNoRename')) : dt('prefixRemoved')];
    if (r.skipped.length) parts.push(dt('prefixSkipped', { n: r.skipped.length, list: r.skipped.slice(0, 8).join(', ') }));
    actions.addSimMessage(r.skipped.length ? 'warning' : 'info', parts.join(' '), SOURCE());
    close();
  };
  return (
    <Dialog
      title={dt('prefixTitle')}
      guide="editingTools"
      onClose={close}
      width={520}
      footer={
        <>
          <button
            type="button"
            className="ms-btn"
            onClick={() => {
              setGlobal('');
              setMap({});
            }}
          >
            {dt('prefixReset')}
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" className="ms-btn" title={dt('helpTip')} onClick={() => void openHelp({ kind: 'guide', page: 'editingTools' })}>
            {dt('help')}
          </button>
          <button type="button" className="ms-btn" onClick={close}>
            {dt('prefixCancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={problems.length > 0} onClick={apply}>
            {dt('prefixApply')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{dt('prefixIntro')}</p>
      <div className="ms-prop-section">
        <CommitField label={dt('prefixGlobal')} value={global} placeholder="A_" hint={dt('prefixGlobalHint')} onCommit={setGlobal} />
        <table className="ms-table" aria-label={dt('prefixTable')}>
          <thead>
            <tr>
              <th>{dt('prefixKind')}</th>
              <th>{dt('prefixReplace')}</th>
              <th>{dt('prefixExample')}</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => (
              <tr key={k}>
                <td>{k}</td>
                <td>
                  <input
                    className="ms-input"
                    value={map[k] ?? ''}
                    placeholder={k}
                    aria-label={`${dt('prefixReplace')} ${k}`}
                    onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}
                  />
                </td>
                <td>
                  {effectivePrefix(k, rules)}1, {effectivePrefix(k, rules)}2
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <CommitField label={dt('prefixAddLabel')} value={extra} layout="stack" onCommit={setExtra} />
          <button
            type="button"
            className="ms-btn"
            disabled={!/^[A-Za-z]+$/.test(extra.trim())}
            onClick={() => {
              setMap((m) => ({ ...m, [extra.trim().toUpperCase()]: m[extra.trim().toUpperCase()] ?? '' }));
              setExtra('');
            }}
          >
            {dt('prefixAdd')}
          </button>
        </div>
        {hasParts ? <CheckField label={dt('prefixRename')} checked={rename} onChange={setRename} /> : null}
        {problems.map((p, i) => (
          <p key={i} className="ms-field-error" role="alert">
            {problemText(p)}
          </p>
        ))}
      </div>
    </Dialog>
  );
}

export function openRefdesRulesDialog(): void {
  openCustomDialog((close) => <PrefixRulesDialog close={close} />);
}
