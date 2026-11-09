/**
 * Main toolbar: file, history, clipboard, tools (select / wire / label / text / probe), rotate &
 * flip, zoom, grid, simulation controls and the analysis selector. Every button runs a command
 * by id, shows its shortcut in the tooltip and is disabled when the command is unavailable.
 * The toolbar is one tab stop (role="toolbar"); ←/→ move between its controls.
 */
import { useSyncExternalStore } from 'react';
import type { AnalysisType } from '../../sim/netlist';
import type { ProbeKind } from '../../model/types';
import { actions, useEditor } from '../store';
import { Icon } from '../common/icons';
import { openContextMenu } from '../common/Menu';
import { commandRegistry, hasCommand, runCommand } from './extensions';
import { ANALYSIS_LABELS, ANALYSIS_ORDER, PROBE_KIND_LABELS } from './menus';
import { shortcutLabel } from './shortcuts';
import { toolbarVisible, type ToolbarGroup } from './customize';
import { beginnerAnalyses, beginnerEntries, beginnerToolbar } from './beginner';
import { t } from '../../i18n';

interface ButtonProps {
  id: string;
  icon: string;
  label: string;
  enabled?: boolean;
  pressed?: boolean;
  text?: string;
}

function ToolButton({ id, icon, label, enabled = true, pressed, text }: ButtonProps) {
  const sc = shortcutLabel(id);
  const disabled = !enabled || !hasCommand(id);
  return (
    <button
      type="button"
      className={`ms-icon-btn ms-tb-btn ${text ? 'has-text' : ''}`}
      aria-label={label}
      aria-pressed={pressed}
      title={sc ? `${label} (${sc})` : label}
      disabled={disabled}
      onClick={() => runCommand(id)}
    >
      <Icon name={icon} />
      {text ? <span>{text}</span> : null}
    </button>
  );
}

const Sep = () => <span className="ms-tb-sep" role="separator" aria-orientation="vertical" />;

function onToolbarKey(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
  const target = e.target as HTMLElement;
  if (target.tagName === 'SELECT') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)'));
  const i = items.indexOf(target);
  if (i < 0) return;
  e.preventDefault();
  e.stopPropagation();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}

export function Toolbar() {
  useSyncExternalStore(commandRegistry.subscribe, commandRegistry.getState, commandRegistry.getState);
  // Options > Customize user interface: hidden button groups
  const toolbarPrefs = useEditor((s) => s.ui.toolbar);
  // beginner mode switches the advanced groups off without changing what the learner chose
  const beginner = useEditor((s) => s.ui.beginner === true);
  const groups = beginnerToolbar(toolbarPrefs, beginner);
  const show = (g: ToolbarGroup) => toolbarVisible(groups, g);
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const hasSel = useEditor((s) => s.selection.length > 0);
  const canPaste = useEditor((s) => s.clipboardAvailable);
  const showGrid = useEditor((s) => s.showGrid);
  const showErc = useEditor((s) => s.showErc);
  const sim = useEditor((s) => s.sim.state);
  const analysis = useEditor((s) => s.design.analysis.active);
  const running = sim === 'running';
  const active = sim === 'running' || sim === 'paused';
  const probeKind: ProbeKind = tool.kind === 'probe' ? tool.probeKind : 'voltage';

  const openProbeMenu = (e: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu(
      // beginner mode keeps the voltage and current probes only (src/ui/app/beginner.ts)
      beginnerEntries(
        (Object.keys(PROBE_KIND_LABELS) as ProbeKind[]).map((k) => ({
          id: `place.probe.${k}`,
          label: t('app.toolbar.valueProbe', { value: PROBE_KIND_LABELS[k] }),
          checked: tool.kind === 'probe' && tool.probeKind === k,
          onSelect: () => runCommand(`place.probe.${k}`),
        })),
        beginner,
      ),
      r.left,
      r.bottom,
      e.type === 'keydown',
    );
  };

  return (
    <div className="ms-toolbar" role="toolbar" aria-label={t('app.toolbar.mainToolbar')} onKeyDown={onToolbarKey}>
      {show('file') ? (
        <>
          <ToolButton id="file.new" icon="new" label={t('app.toolbar.newDesign')} />
          <ToolButton id="file.open" icon="open" label={t('app.toolbar.open')} />
          <ToolButton id="file.save" icon="save" label={t('common.save')} />
          <Sep />
        </>
      ) : null}
      {show('history') ? (
        <>
          <ToolButton id="edit.undo" icon="undo" label={t('app.toolbar.undo')} enabled={canUndo} />
          <ToolButton id="edit.redo" icon="redo" label={t('app.toolbar.redo')} enabled={canRedo} />
          <Sep />
        </>
      ) : null}
      {show('clipboard') ? (
        <>
          <ToolButton id="edit.cut" icon="cut" label={t('app.toolbar.cut')} enabled={hasSel} />
          <ToolButton id="edit.copy" icon="copy" label={t('common.copy')} enabled={hasSel} />
          <ToolButton id="edit.paste" icon="paste" label={t('app.toolbar.paste')} enabled={canPaste} />
          <ToolButton id="edit.delete" icon="trash" label={t('common.delete')} enabled={hasSel} />
          <Sep />
        </>
      ) : null}
      {show('tools') ? (
        <>
      <button
        type="button"
        className="ms-icon-btn ms-tb-btn"
        aria-label={t('app.toolbar.selectTool')}
        aria-pressed={tool.kind === 'select'}
        title={t('app.toolbar.selectToolEsc')}
        onClick={() => actions.cancelTool()}
      >
        <Icon name="select" />
      </button>
      <ToolButton id="place.wire" icon="wire" label={t('app.toolbar.wireTool')} pressed={tool.kind === 'wire'} />
      <ToolButton id="place.bus" icon="wire" label={t('cmd.place.bus')} text={t('app.toolbar.busText')} pressed={tool.kind === 'bus'} />
      <ToolButton id="place.label" icon="label" label={t('app.toolbar.netLabelTool')} pressed={tool.kind === 'label' && !tool.labelKind} />
      <ToolButton id="place.offpage" icon="label" label={t('cmd.place.offpage')} text={t('app.toolbar.offpageText')} pressed={tool.kind === 'label' && tool.labelKind === 'offpage'} />
      <ToolButton id="place.text" icon="text" label={t('app.toolbar.textTool')} pressed={tool.kind === 'text'} />
      <span className="ms-tb-split">
        <ToolButton id={`place.probe.${probeKind}`} icon="probe" label={t('app.toolbar.valueProbeTool', { value: PROBE_KIND_LABELS[probeKind] })} pressed={tool.kind === 'probe'} />
        <button
          type="button"
          className="ms-icon-btn ms-tb-btn ms-tb-drop"
          aria-label={t('app.toolbar.chooseProbeType')}
          aria-haspopup="menu"
          title={t('app.toolbar.chooseProbeType')}
          onClick={openProbeMenu}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              openProbeMenu(e);
            }
          }}
        >
          <Icon name="chevronDown" size={10} />
        </button>
      </span>
          <Sep />
        </>
      ) : null}
      {show('transform') ? (
        <>
          <ToolButton id="edit.rotateCw" icon="rotateCw" label={t('app.toolbar.rotateClockwise')} enabled={hasSel} />
          <ToolButton id="edit.rotateCcw" icon="rotateCcw" label={t('app.toolbar.rotateCounterClockwise')} enabled={hasSel} />
          <ToolButton id="edit.flipH" icon="flipH" label={t('app.toolbar.flipHorizontally')} enabled={hasSel} />
          <ToolButton id="edit.flipV" icon="flipV" label={t('app.toolbar.flipVertically')} enabled={hasSel} />
          <Sep />
        </>
      ) : null}
      {show('zoom') ? (
        <>
          <ToolButton id="view.zoomIn" icon="zoomIn" label={t('app.toolbar.zoomIn')} />
          <ToolButton id="view.zoomOut" icon="zoomOut" label={t('app.toolbar.zoomOut')} />
          <ToolButton id="view.fitAll" icon="zoomFit" label={t('app.toolbar.fitSheet')} />
          <ToolButton id="view.fitSelection" icon="zoomSel" label={t('app.toolbar.zoomToSelection')} enabled={hasSel} />
          <Sep />
        </>
      ) : null}
      {show('view') ? (
        <>
          <ToolButton id="view.grid" icon="grid" label={t('app.toolbar.showGrid')} pressed={showGrid} />
          <ToolButton id="view.erc" icon="erc" label={t('cmd.view.erc')} pressed={showErc} />
          <Sep />
        </>
      ) : null}
      {show('simulate') ? (
        <>
      <ToolButton id="simulate.run" icon="run" label={sim === 'paused' ? t('app.toolbar.resumeSimulation') : t('app.toolbar.runSimulation')} enabled={!running} />
      <ToolButton id="simulate.pause" icon="pause" label={t('app.toolbar.pauseSimulation')} enabled={running} />
      <ToolButton id="simulate.stop" icon="stop" label={t('app.toolbar.stopSimulation')} enabled={active} />
      <label className="ms-tb-analysis">
        <span className="ms-visually-hidden">{t('common.activeAnalysis')}</span>
        <select
          className="ms-select"
          value={analysis}
          title={t('common.activeAnalysis')}
          onChange={(e) => actions.setActiveAnalysis(e.target.value as AnalysisType)}
        >
          {beginnerAnalyses(ANALYSIS_ORDER, beginner, analysis).map((t) => (
            <option key={t} value={t}>
              {ANALYSIS_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <ToolButton id="simulate.analysisSettings" icon="settings" label={t('app.toolbar.analysisSettings')} text={t('app.toolbar.settings')} />
      <ToolButton id="tools.erc" icon="erc" label={t('app.toolbar.electricalRulesCheck')} />
          <Sep />
        </>
      ) : null}
      <ToolButton id="help.lessons" icon="book" label={t('learn.toolbar.lessons')} text={t('learn.toolbar.lessonsText')} />
      <ToolButton id="tools.descriptionBox" icon="doc" label={t('learn.toolbar.description')} />
    </div>
  );
}
