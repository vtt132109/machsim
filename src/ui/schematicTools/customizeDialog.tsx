/**
 * Customize user interface (lazy chunk, command options.customizeUi): the learner's own keyboard
 * shortcuts and which toolbar groups are shown.
 *
 * The key box records the next key combination that is pressed, the table marks clashes in red and
 * says why a combination is refused, and both tables are kept in the UI preferences
 * (src/ui/app/prefs.ts `shortcuts` / `toolbar`), so they survive a restart.
 */
import { useMemo, useState } from 'react';
import {
  applyUserShortcuts,
  checkChord,
  cleanUserShortcuts,
  formatChord,
  shortcutRows,
  TOOLBAR_GROUPS,
  toolbarVisible,
  type ToolbarGroup,
  type ToolbarPrefs,
  type UserShortcuts,
} from '../app/customize';
import { commandRegistry } from '../app/extensions';
import { BUILTIN_COMMANDS } from '../app/commands';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { Tabs } from '../common/Tabs';
import { openHelp } from '../help/open';
import { actions, getState } from '../store';
import { t, tDynamic } from '../../i18n';
import { stt } from '../../i18n/schematicToolsText';
import './schematicTools.css';

const GROUP_TEXT: Record<ToolbarGroup, Parameters<typeof stt>[0]> = {
  file: 'customGroupFile',
  history: 'customGroupHistory',
  clipboard: 'customGroupClipboard',
  tools: 'customGroupTools',
  transform: 'customGroupTransform',
  zoom: 'customGroupZoom',
  view: 'customGroupView',
  simulate: 'customGroupSimulate',
};

/** Every command the dialog can bind: the built-in ids plus the ones extensions registered. */
function allCommands(): string[] {
  return [...new Set([...BUILTIN_COMMANDS, ...Object.keys(commandRegistry.getState())])].sort();
}

const commandLabel = (id: string): string => tDynamic(`cmd.${id}`, undefined, id);

function KeyBox({ chord, onChange }: { chord: string; onChange: (text: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <input
      className={`ms-input ms-st-key${recording ? ' is-recording' : ''}`}
      readOnly
      value={recording ? stt('customPress') : chord || stt('customNoShortcut')}
      aria-label={stt('customKey')}
      onFocus={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Tab') return;
        if (e.key === 'Escape') {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
        onChange(formatChord({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey }));
        setRecording(false);
        (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function CustomizeDialog({ close }: { close: () => void }) {
  const ui = getState().ui;
  const [tab, setTab] = useState('keys');
  const [keys, setKeys] = useState<UserShortcuts>(ui.shortcuts ?? {});
  const [toolbar, setToolbar] = useState<ToolbarPrefs>(ui.toolbar ?? {});
  const [filter, setFilter] = useState('');
  const commands = useMemo(allCommands, []);
  const rows = shortcutRows(keys, commands);
  const needle = filter.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.id.toLowerCase().includes(needle) || commandLabel(r.id).toLowerCase().includes(needle)) : rows;

  const apply = () => {
    const clean = cleanUserShortcuts(keys, commands);
    applyUserShortcuts(clean, commands);
    actions.setUi({ shortcuts: clean, toolbar });
    actions.addSimMessage('info', t('schematicTools.shortcutsApplied', { n: Object.keys(clean).length }), 'ui');
    close();
  };

  return (
    <Dialog
      title={stt('customTitle')}
      onClose={close}
      width={700}
      className="ms-st-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={() => openHelp({ kind: 'guide', page: 'customizeUi' })}>
            {t('help.whatIsThis')}
          </button>
          <button
            type="button"
            className="ms-btn"
            onClick={() => {
              setKeys({});
              setToolbar({});
            }}
          >
            {stt('customResetAll')}
          </button>
          <span className="ms-st-spacer" />
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.cancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" onClick={apply}>
            {'OK'}
          </button>
        </>
      }
    >
      <Tabs
        items={[
          { id: 'keys', title: stt('customKeysTab') },
          { id: 'toolbar', title: stt('customToolbarTab') },
        ]}
        active={tab}
        onSelect={setTab}
        ariaLabel={stt('customTitle')}
        size="small"
      />
      {tab === 'keys' ? (
        <div>
          <p className="ms-hint">{stt('customKeysIntro')}</p>
          <label className="ms-cfield ms-cfield-row">
            <span className="ms-cfield-label">{stt('customFilter')}</span>
            <input className="ms-input" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className="ms-st-scroll">
            <table className="ms-st-table">
              <thead>
                <tr>
                  <th>{stt('customCommand')}</th>
                  <th>{stt('customKey')}</th>
                  <th>{stt('customDefault')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className={r.conflicts.length || r.problem !== 'ok' ? 'is-bad' : undefined}>
                    <td>
                      {commandLabel(r.id)}
                      {r.conflicts.length ? <div className="ms-st-error">{stt('customConflict', { ids: r.conflicts.map(commandLabel).join(', ') })}</div> : null}
                      {r.problem !== 'ok' ? (
                        <div className="ms-st-error">{stt(r.problem === 'unreadable' ? 'customProblemUnreadable' : r.problem === 'bareLetter' ? 'customProblemBareLetter' : 'customProblemReserved')}</div>
                      ) : null}
                    </td>
                    <td>
                      <KeyBox chord={r.chord} onChange={(text) => setKeys((k) => ({ ...k, [r.id]: checkChord(text) === 'ok' ? text : text }))} />
                    </td>
                    <td className="ms-st-dim">{r.original || stt('customNoShortcut')}</td>
                    <td className="ms-st-row">
                      <button type="button" className="ms-btn ms-btn-small" onClick={() => setKeys((k) => ({ ...k, [r.id]: '' }))} title={stt('customClear')}>
                        {stt('customClear')}
                      </button>
                      <button
                        type="button"
                        className="ms-btn ms-btn-small"
                        disabled={r.source === 'default'}
                        onClick={() =>
                          setKeys((k) => {
                            const next = { ...k };
                            delete next[r.id];
                            return next;
                          })
                        }
                        title={stt('customResetRow')}
                      >
                        {stt('customResetRow')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          <p className="ms-hint">{stt('customToolbarIntro')}</p>
          <div className="ms-st-fields">
            {TOOLBAR_GROUPS.map((g) => (
              <label key={g} className="ms-cfield ms-cfield-check">
                <input type="checkbox" checked={toolbarVisible(toolbar, g)} onChange={(e) => setToolbar({ ...toolbar, [g]: e.target.checked ? undefined : false })} />
                <span>{stt(GROUP_TEXT[g])}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function openCustomizeDialog(): void {
  openCustomDialog((close) => <CustomizeDialog close={close} />);
}
