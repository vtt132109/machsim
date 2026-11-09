/**
 * Microcontroller code editor (Simulate > MCU code editor, floating window 'mcu'; loaded on first
 * use, so the 8051 core and the assembler stay out of the start-up bundle).
 *
 * Left: the program of the selected microcontroller as plain text, the Build button and the build
 * output (every problem with its line number, in the interface language; clicking one puts the
 * caret on that line). Build writes the text back into the part as one undo step, so the program
 * is saved with the design.
 *
 * Right: the read-outs. Two run modes:
 *  - **With the circuit**: the values come from the vectors the co-simulated core publishes
 *    (src/mcu/probes.ts), so what the panel shows is the microcontroller that is driving the
 *    schematic. Run / Pause / Stop are the ordinary simulation controls.
 *  - **On its own**: the panel runs the program in its own core with no circuit attached (every
 *    pin reads high). That is the mode with single stepping and breakpoints, for learning the
 *    instruction set without waiting for an analysis.
 *
 * The serial terminal shows the bytes the program transmitted and sends typed characters into the
 * receiver — in live mode through the session parameter `rx` of the core element, in stand-alone
 * mode straight into the panel's core.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildProgram, programHex, programOk, type ProgramBuild } from '../../mcu/program';
import { listingText } from '../../mcu/asm8051';
import { asmErrorText, hexErrorText, mt } from '../../i18n/mcuText';
import { t } from '../../i18n';
import { openHelp } from '../help/open';
import { actions, getState, subscribe } from '../app/extensions';
import { partLookup } from '../store';
import { findPartByRefdes } from '../store/designOps';
import { parseUserNumber } from '../../util/units';
import { downloadText, pickTextFile } from '../app/files';
import type { SimulationIntegration } from '../integration/controller';
import type { McuBinding } from '../../model/netlister';
import {
  StandaloneRun,
  TerminalDecoder,
  appendTerminal,
  breakpointAddresses,
  emptyView,
  lineAtPc,
  viewFromSnapshot,
  type McuView,
} from './mcuModel';
import { ListingView, PortView, RamView, RegisterView, SfrView, SymbolView, TerminalView } from './McuViews';
import { lowerValues } from '../integration/live';
import './mcu.css';

type Tab = 'registers' | 'sfr' | 'ram' | 'ports' | 'terminal' | 'listing' | 'symbols';
type Mode = 'live' | 'standalone';

const TABS: { id: Tab; label: () => string }[] = [
  { id: 'registers', label: () => mt('tabRegisters') },
  { id: 'sfr', label: () => mt('tabSfr') },
  { id: 'ram', label: () => mt('tabRam') },
  { id: 'ports', label: () => mt('tabPorts') },
  { id: 'terminal', label: () => mt('tabTerminal') },
  { id: 'listing', label: () => mt('tabListing') },
  { id: 'symbols', label: () => mt('tabSymbols') },
];

/** Microcontrollers of the open design, found without building a netlist. */
function designMcus(): { refdes: string; element: string; program: string; fosc: number; xram: number; debug: boolean }[] {
  const s = getState();
  const out: { refdes: string; element: string; program: string; fosc: number; xram: number; debug: boolean }[] = [];
  for (const sheet of s.design.sheets) {
    for (const inst of sheet.parts) {
      const def = partLookup(inst.partId);
      const info = def ? (def as { mcu?: { programParam: string } }).mcu : undefined;
      if (!def || !info) continue;
      const params = { ...Object.fromEntries(def.params.map((p) => [p.key, p.default] as const)), ...inst.params };
      out.push({
        refdes: inst.refdes,
        element: elementNameOf(inst.refdes),
        program: params[info.programParam] ?? '',
        fosc: parseUserNumber(params.fosc ?? '12M') || 12e6,
        xram: Number.parseInt(params.xram ?? '0', 10) || 0,
        debug: (params.debug ?? 'true').trim().toLowerCase() !== 'false',
      });
    }
  }
  return out;
}

/** The netlist element name of a part's core: the same rule the netlister uses. */
function elementNameOf(refdes: string): string {
  const ref = refdes.trim().replace(/[^A-Za-z0-9_]/g, '_') || '_';
  return ref.toUpperCase().startsWith('A') ? ref : `A_${ref}`;
}

export function McuPanel({ ctrl, refdes }: { ctrl: SimulationIntegration; refdes?: string }) {
  const editorVersion = useSyncExternalStore(subscribe, () => getState().design, () => getState().design);
  const live = useSyncExternalStore(ctrl.live.subscribe, ctrl.live.getState, ctrl.live.getState);
  const mcus = useMemo(() => designMcus(), [editorVersion]);
  const [selected, setSelected] = useState<string>(refdes ?? '');
  const current = mcus.find((m) => m.refdes === selected) ?? mcus[0];
  const [source, setSource] = useState<string>(current?.program ?? '');
  const [built, setBuilt] = useState<ProgramBuild | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('registers');
  const [mode, setMode] = useState<Mode>('live');
  const [breaks, setBreaks] = useState<ReadonlySet<number>>(new Set<number>());
  const [terminal, setTerminal] = useState('');
  const [standaloneView, setStandaloneView] = useState<McuView>(() => emptyView());
  const [ramBase, setRamBase] = useState(0x30);
  const [note, setNote] = useState('');
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const standalone = useRef<StandaloneRun | null>(null);
  const decoder = useRef(new TerminalDecoder());

  // the selected part changed (or its program was edited elsewhere): take its program
  const partKey = `${current?.refdes ?? ''}:${current?.program ?? ''}`;
  const lastKey = useRef(partKey);
  useEffect(() => {
    if (lastKey.current === partKey) return;
    lastKey.current = partKey;
    setSource(current?.program ?? '');
    setBuilt(current ? buildProgram(current.program) : null);
    setDirty(false);
    setTerminal('');
    decoder.current.reset();
    standalone.current = null;
  }, [partKey, current]);

  // first build of the program that is in the part
  useEffect(() => {
    if (built === null && current) setBuilt(buildProgram(current.program));
  }, [built, current]);

  const asm = built?.asm ?? null;

  // ---- live view ---------------------------------------------------------------------------
  const liveView = useMemo(() => (current ? viewFromSnapshot(lowerValues(live.latest), current.element) : null), [live.latest, current]);
  const view = mode === 'live' ? liveView : standaloneView;

  // the terminal follows whichever core is being watched
  useEffect(() => {
    if (!view) return;
    const chunk = decoder.current.feed(view);
    if (chunk.bytes.length > 0 || chunk.lost > 0) setTerminal((text) => appendTerminal(text, chunk));
  }, [view]);

  // the RAM window of the co-simulated core is moved through the session
  useEffect(() => {
    if (mode !== 'live' || !current) return;
    ctrl.setElementParam(current.element, 'ramview', ramBase);
  }, [ctrl, current, mode, ramBase]);

  const ensureStandalone = useCallback((): StandaloneRun | null => {
    if (!current || !built) return null;
    if (!standalone.current) {
      const run = new StandaloneRun({ fosc: current.fosc, xramSize: current.xram });
      run.load(built.bytes.subarray(0, Math.max(1, built.end)), 0);
      standalone.current = run;
    }
    standalone.current.ramBase = ramBase;
    return standalone.current;
  }, [built, current, ramBase]);

  const refreshStandalone = useCallback(() => {
    const run = standalone.current;
    if (run) setStandaloneView(run.view());
  }, []);

  // ---- actions ----------------------------------------------------------------------------
  const doBuild = useCallback(() => {
    if (!current) return;
    const result = buildProgram(source);
    setBuilt(result);
    standalone.current = null;
    decoder.current.reset();
    if (source !== current.program) {
      const found = findPartByRefdes(getState().design, current.refdes);
      if (found) {
        actions.setPartParam(found.part.id, 'program', source);
        lastKey.current = `${current.refdes}:${source}`;
      }
    }
    setDirty(false);
    setNote(programOk(result) ? mt('liveBuildNote') : '');
  }, [current, source]);

  const doRevert = useCallback(() => {
    if (!current) return;
    setSource(current.program);
    setBuilt(buildProgram(current.program));
    setDirty(false);
  }, [current]);

  const openFile = useCallback(async () => {
    const f = await pickTextFile(['.asm', '.a51', '.s', '.src', '.hex', '.ihx', '.txt']);
    if (!f) return;
    setSource(f.text);
    setDirty(true);
    setBuilt(buildProgram(f.text));
  }, []);

  const saveHex = useCallback(() => {
    if (!built || !current) return;
    downloadText(`${current.refdes}.hex`, programHex(built));
  }, [built, current]);

  const saveListing = useCallback(() => {
    if (!asm || !current) return;
    downloadText(`${current.refdes}.lst`, listingText(asm));
  }, [asm, current]);

  const gotoLine = useCallback((line: number) => {
    const area = sourceRef.current;
    if (!area) return;
    const lines = area.value.split('\n');
    let start = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
    const end = start + (lines[line - 1]?.length ?? 0);
    area.focus();
    area.setSelectionRange(start, end);
  }, []);

  const toggleBreak = useCallback((line: number) => {
    setBreaks((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });
  }, []);

  const stepOnce = useCallback(() => {
    const run = ensureStandalone();
    if (!run) return;
    setMode('standalone');
    run.step();
    refreshStandalone();
  }, [ensureStandalone, refreshStandalone]);

  const stepLine = useCallback(() => {
    const run = ensureStandalone();
    if (!run || !asm) return;
    setMode('standalone');
    run.stepLine(asm.addrLine);
    refreshStandalone();
  }, [asm, ensureStandalone, refreshStandalone]);

  const runToBreak = useCallback(() => {
    const run = ensureStandalone();
    if (!run) return;
    setMode('standalone');
    run.run(asm ? breakpointAddresses(asm, breaks) : new Set<number>());
    refreshStandalone();
  }, [asm, breaks, ensureStandalone, refreshStandalone]);

  const resetRun = useCallback(() => {
    if (mode === 'live') {
      if (current) ctrl.setElementParam(current.element, 'reset', 1);
      return;
    }
    const run = ensureStandalone();
    if (!run) return;
    run.reset();
    decoder.current.reset();
    setTerminal('');
    refreshStandalone();
  }, [ctrl, current, ensureStandalone, mode, refreshStandalone]);

  const sendText = useCallback(
    (text: string, newline: boolean) => {
      const bytes = [...text].map((c) => c.charCodeAt(0) & 0xff);
      if (newline) bytes.push(0x0d);
      if (mode === 'live') {
        if (!current) return;
        for (const b of bytes) ctrl.setElementParam(current.element, 'rx', b);
        return;
      }
      const run = ensureStandalone();
      if (!run) return;
      for (const b of bytes) run.send(b);
      refreshStandalone();
    },
    [ctrl, current, ensureStandalone, mode, refreshStandalone],
  );

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      doBuild();
    } else if (e.key === 'F11') {
      e.preventDefault();
      stepOnce();
    } else if (e.key === 'F10') {
      e.preventDefault();
      stepLine();
    }
  };

  if (!current) {
    return <div className="ms-empty">{t('mcu.noMcu')}</div>;
  }

  const errors = built ? [...built.asmErrors.map((e) => ({ line: e.line, text: asmErrorText(e) })), ...built.hexErrors.map((e) => ({ line: e.line, text: hexErrorText(e) }))] : [];
  const bytes = built ? Math.max(0, built.end - built.start) : 0;
  const currentLine = asm && view ? lineAtPc(asm, view.pc) : undefined;
  const shown = view ?? emptyView(ramBase);

  return (
    <div className="ms-mcu" onKeyDown={onKeyDown}>
      <div className="ms-mcu-head">
        <label className="ms-mcu-cell-label" htmlFor="ms-mcu-part">
          {mt('part')}
        </label>
        <select
          id="ms-mcu-part"
          className="ms-input ms-input-small"
          title={mt('tipPart')}
          value={current.refdes}
          onChange={(e) => setSelected(e.target.value)}
        >
          {mcus.map((m) => (
            <option key={m.refdes} value={m.refdes}>
              {m.refdes}
            </option>
          ))}
        </select>
        <button type="button" className="ms-btn ms-btn-small ms-btn-primary" title={mt('tipBuild')} onClick={doBuild}>
          {mt('build')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={mt('tipRevert')} disabled={!dirty} onClick={doRevert}>
          {mt('revert')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={mt('tipOpenFile')} onClick={() => void openFile()}>
          {mt('openFile')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={mt('tipSaveHex')} disabled={bytes === 0} onClick={saveHex}>
          {mt('saveHex')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" title={mt('tipSaveListing')} disabled={!asm} onClick={saveListing}>
          {mt('saveListing')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" onClick={() => openHelp({ kind: 'guide', page: 'mcu' })}>
          {mt('help')}
        </button>
      </div>

      <div className="ms-mcu-body">
        <div className="ms-mcu-left">
          <label className="ms-mcu-cell-label" htmlFor="ms-mcu-source">
            {mt('program')}
          </label>
          <textarea
            id="ms-mcu-source"
            ref={sourceRef}
            className="ms-mcu-source"
            spellCheck={false}
            title={mt('tipProgram')}
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setDirty(true);
            }}
          />
          <div className="ms-mcu-output" aria-live="polite">
            <span className="ms-mcu-cell-label">{mt('output')}</span>
            {dirty ? <p className="ms-mcu-warn">{mt('unsaved')}</p> : null}
            {errors.length > 0 ? (
              <>
                <p className="ms-mcu-error">{mt('errorCount', { n: errors.length })}</p>
                <ul className="ms-mcu-errors">
                  {errors.map((e, k) => (
                    <li key={k}>
                      <button type="button" className="ms-link" onClick={() => gotoLine(e.line)}>
                        {e.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : built?.kind === 'empty' ? (
              <p className="ms-hint">{mt('empty')}</p>
            ) : built ? (
              <p className="ms-mcu-ok">
                {built.kind === 'hex'
                  ? mt('okHex', { bytes, start: built.start.toString(16).toUpperCase(), end: built.end.toString(16).toUpperCase() })
                  : mt('ok', { bytes, start: built.start.toString(16).toUpperCase(), end: built.end.toString(16).toUpperCase() })}
              </p>
            ) : null}
            {note.length > 0 && errors.length === 0 ? <p className="ms-hint">{note}</p> : null}
          </div>
        </div>

        <div className="ms-mcu-right">
          <div className="ms-mcu-row">
            <span className="ms-mcu-cell-label">{mt('mode')}</span>
            <button
              type="button"
              className={mode === 'live' ? 'ms-btn ms-btn-small is-active' : 'ms-btn ms-btn-small'}
              title={mt('tipModeLive')}
              aria-pressed={mode === 'live'}
              onClick={() => setMode('live')}
            >
              {mt('modeLive')}
            </button>
            <button
              type="button"
              className={mode === 'standalone' ? 'ms-btn ms-btn-small is-active' : 'ms-btn ms-btn-small'}
              title={mt('tipModeStandalone')}
              aria-pressed={mode === 'standalone'}
              onClick={() => {
                setMode('standalone');
                ensureStandalone();
                refreshStandalone();
              }}
            >
              {mt('modeStandalone')}
            </button>
          </div>
          <div className="ms-mcu-row">
            <button type="button" className="ms-btn ms-btn-small" title={mt('tipStep')} onClick={stepOnce}>
              {mt('step')}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={mt('tipStepLine')} disabled={!asm} onClick={stepLine}>
              {mt('stepLine')}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={mt('tipRunTo')} onClick={runToBreak}>
              {mt('runTo')}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={mt('tipResetRun')} onClick={resetRun}>
              {mt('resetRun')}
            </button>
            <span className="ms-hint">{mt('breakpoints', { n: breaks.size })}</span>
            {breaks.size > 0 ? (
              <button type="button" className="ms-link" onClick={() => setBreaks(new Set<number>())}>
                {mt('clearBreaks')}
              </button>
            ) : null}
          </div>
          {shown.halted === 1 ? <p className="ms-mcu-error">{mt('halted', { pc: `${shown.pc.toString(16).toUpperCase()}h` })}</p> : null}
          {shown.halted === 2 ? <p className="ms-mcu-error">{mt('haltedStack')}</p> : null}
          {mode === 'live' && !liveView ? <p className="ms-hint">{mt('liveWaiting')}</p> : null}
          <div className="ms-mcu-tabs" role="tablist">
            {TABS.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                className={tab === x.id ? 'ms-tab is-active' : 'ms-tab'}
                onClick={() => setTab(x.id)}
              >
                {x.label()}
              </button>
            ))}
          </div>
          <div className="ms-mcu-tabbody">
            {tab === 'registers' ? <RegisterView view={shown} fosc={current.fosc} /> : null}
            {tab === 'sfr' ? <SfrView view={shown} /> : null}
            {tab === 'ram' ? <RamView view={{ ...shown, ramBase: mode === 'live' ? shown.ramBase : ramBase }} onBase={setRamBase} /> : null}
            {tab === 'ports' ? <PortView view={shown} /> : null}
            {tab === 'terminal' ? (
              <TerminalView text={terminal} view={shown} canSend={mode === 'standalone' || ctrl.active} onSend={sendText} onClear={() => setTerminal('')} />
            ) : null}
            {tab === 'listing' ? <ListingView asm={asm} breaks={breaks} currentLine={currentLine} onToggle={toggleBreak} /> : null}
            {tab === 'symbols' ? <SymbolView asm={asm} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Refdes list of the microcontrollers on the open design (for the menu / command). */
export function mcuRefdeses(): string[] {
  return designMcus().map((m) => m.refdes);
}

/** Binding-shaped information of the microcontrollers, for callers that have no netlist. */
export function mcuList(): Pick<McuBinding, 'refdes' | 'element' | 'program' | 'debug'>[] {
  return designMcus().map((m) => ({ refdes: m.refdes, element: m.element, program: m.program, debug: m.debug }));
}
