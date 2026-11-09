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
 *
 * Debugging with the circuit (live mode while a simulation runs or is paused): the buttons drive
 * the debugger of the co-simulated core (src/mcu/debugger.ts) through run-time parameters of the
 * core element — breakpoints from the listing, Continue (F5), One instruction (F11), One line =
 * step over (F10), One machine cycle (Shift+F11), Run to cursor (F4) — and the simulation pauses
 * itself at exactly the time the core has executed. The Watch tab shows expressions over the
 * registers, SFRs and memory cells; the cells are given to the core's eight hardware watch slots.
 * Every number on screen comes from the vectors the core publishes, so the panel stays correct
 * when the simulation is paused.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildProgram, programHex, programOk, type ProgramBuild } from '../../mcu/program';
import { listingText } from '../../mcu/asm8051';
import { asmErrorText, hexErrorText, mt, type McuTextKey } from '../../i18n/mcuText';
import { t } from '../../i18n';
import { openHelp } from '../help/open';
import { actions, getState, subscribe } from '../app/extensions';
import { partLookup } from '../store';
import { findPartByRefdes } from '../store/designOps';
import { formatEng, parseUserNumber } from '../../util/units';
import { downloadText, pickTextFile } from '../app/files';
import { machineCycleSeconds } from '../../mcu/cpu8051';
import { encodeWatch } from '../../mcu/debugger';
import { planWatches, type WatchItem } from '../../mcu/watch';
import type { SimulationIntegration } from '../integration/controller';
import type { McuBinding } from '../../model/netlister';
import {
  StandaloneRun,
  TerminalDecoder,
  appendTerminal,
  breakpointAddresses,
  cyclesAt,
  emptyView,
  lineAddresses,
  lineAtPc,
  mcuTime,
  viewFromSnapshot,
  type McuView,
} from './mcuModel';
import { ListingView, PortView, RamView, RegisterView, SfrView, SymbolView, TerminalView } from './McuViews';
import { WatchView, loadWatchItems, saveWatchItems } from './McuWatch';
import { lowerValues } from '../integration/live';
import './mcu.css';

type Tab = 'registers' | 'sfr' | 'ram' | 'ports' | 'watch' | 'terminal' | 'listing' | 'symbols';
type Mode = 'live' | 'standalone';

const TABS: { id: Tab; label: () => string }[] = [
  { id: 'registers', label: () => mt('tabRegisters') },
  { id: 'sfr', label: () => mt('tabSfr') },
  { id: 'ram', label: () => mt('tabRam') },
  { id: 'ports', label: () => mt('tabPorts') },
  { id: 'watch', label: () => mt('tabWatch') },
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
  const [watches, setWatches] = useState<WatchItem[]>(() => loadWatchItems());
  /** 1-based line the caret is on in the program box (Run to cursor) */
  const [caretLine, setCaretLine] = useState(1);
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
  /** the co-simulated core can be driven while a session exists (running or held) */
  const liveDebug = mode === 'live' && (live.session === 'running' || live.session === 'paused');
  const watchPlan = useMemo(() => planWatches(watches), [watches]);
  const changeWatches = useCallback((next: WatchItem[]) => {
    setWatches(next);
    saveWatchItems(next);
  }, []);

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

  // ---- debugger state of the co-simulated core ---------------------------------------------
  // breakpoints: the listing's marks become code addresses in the core (re-sent for every new session)
  const breakKey = asm ? [...breakpointAddresses(asm, breaks)].sort((a, b) => a - b).join(',') : '';
  useEffect(() => {
    if (!liveDebug || !current) return;
    ctrl.setElementParam(current.element, 'bpclear', 1);
    for (const a of breakKey === '' ? [] : breakKey.split(',')) ctrl.setElementParam(current.element, 'bpadd', Number(a));
  }, [ctrl, current, liveDebug, breakKey, live.session === 'starting']);

  // watches: the memory cells they read go to the core's hardware slots, and the stop mask with them
  const slotKey = `${watchPlan.cells.map((c) => encodeWatch(c.space, c.address)).join(',')}|${watchPlan.breakMask}`;
  useEffect(() => {
    if (!liveDebug || !current) return;
    for (let k = 0; k < 8; k++) {
      const cell = watchPlan.cells[k];
      ctrl.setElementParam(current.element, `watch${k}`, cell ? encodeWatch(cell.space, cell.address) : -1);
    }
    ctrl.setElementParam(current.element, 'wbreak', watchPlan.breakMask);
  }, [ctrl, current, liveDebug, slotKey, live.session === 'starting']);

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

  /** Send a debugger command to the co-simulated core and let a held simulation go on. */
  const command = useCallback(
    (key: string, value = 1) => {
      if (!current) return;
      ctrl.setElementParam(current.element, key, value);
      ctrl.resume();
    },
    [ctrl, current],
  );

  const stepOnce = useCallback(() => {
    if (liveDebug) {
      command('step');
      return;
    }
    const run = ensureStandalone();
    if (!run) return;
    setMode('standalone');
    run.step();
    refreshStandalone();
  }, [command, ensureStandalone, liveDebug, refreshStandalone]);

  const stepLine = useCallback(() => {
    if (liveDebug) {
      command('stepover');
      return;
    }
    const run = ensureStandalone();
    if (!run || !asm) return;
    setMode('standalone');
    run.stepLine(asm.addrLine);
    refreshStandalone();
  }, [asm, command, ensureStandalone, liveDebug, refreshStandalone]);

  const stepCycle = useCallback(() => {
    if (liveDebug) command('stepcycle');
  }, [command, liveDebug]);

  const runToBreak = useCallback(() => {
    if (liveDebug) {
      command('resume');
      return;
    }
    const run = ensureStandalone();
    if (!run) return;
    setMode('standalone');
    run.run(asm ? breakpointAddresses(asm, breaks) : new Set<number>());
    refreshStandalone();
  }, [asm, breaks, command, ensureStandalone, liveDebug, refreshStandalone]);

  /** Address of the first instruction at or after the caret line. */
  const cursorAddress = useCallback((): number | undefined => {
    if (!asm) return undefined;
    const byLine = lineAddresses(asm);
    for (let line = caretLine; line <= asm.lines.length; line++) {
      const a = byLine.get(line);
      if (a !== undefined) return a;
    }
    return undefined;
  }, [asm, caretLine]);

  const runCursor = useCallback(() => {
    const at = cursorAddress();
    if (at === undefined) return;
    if (liveDebug) {
      command('runto', at);
      return;
    }
    const run = ensureStandalone();
    if (!run) return;
    setMode('standalone');
    run.run(new Set([at]));
    refreshStandalone();
  }, [command, cursorAddress, ensureStandalone, liveDebug, refreshStandalone]);

  const startDebug = useCallback(() => {
    setMode('live');
    void ctrl.startDebugging();
  }, [ctrl]);

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
      if (e.shiftKey) stepCycle();
      else stepOnce();
    } else if (e.key === 'F10') {
      e.preventDefault();
      stepLine();
    } else if (e.key === 'F5') {
      e.preventDefault();
      runToBreak();
    } else if (e.key === 'F4') {
      e.preventDefault();
      runCursor();
    }
  };

  if (!current) {
    return <div className="ms-empty">{t('mcu.noMcu')}</div>;
  }

  const errors = built ? [...built.asmErrors.map((e) => ({ line: e.line, text: asmErrorText(e) })), ...built.hexErrors.map((e) => ({ line: e.line, text: hexErrorText(e) }))] : [];
  const bytes = built ? Math.max(0, built.end - built.start) : 0;
  const currentLine = asm && view ? lineAtPc(asm, view.pc) : undefined;
  const shown = view ?? emptyView(ramBase);
  // timing: what the next instruction costs and what the held run has executed
  const mcs = machineCycleSeconds(current.fosc);
  const nextCycles = built ? cyclesAt(built.bytes, shown.pc) : 0;
  // the instruction text without its label and comment
  const nextText =
    asm && currentLine !== undefined
      ? asm.lines
          .find((l) => l.line === currentLine)
          ?.text.replace(/;.*$/, '')
          .replace(/^\s*[A-Za-z_?][A-Za-z0-9_?]*:\s*/, '')
          .trim()
      : undefined;
  const held = liveDebug && live.session === 'paused' && shown.dbg.reason > 0 ? shown.dbg : null;
  const reasonText = held
    ? held.reason === 3
      ? held.mid > 0
        ? mt('dbgReason3', { k: held.mid, n: held.insn || nextCycles })
        : mt('dbgReason3end')
      : mt(`dbgReason${held.reason}` as McuTextKey)
    : '';

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
              setCaretLine(e.target.value.slice(0, e.target.selectionStart).split('\n').length);
            }}
            onSelect={(e) => setCaretLine(e.currentTarget.value.slice(0, e.currentTarget.selectionStart).split('\n').length)}
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
            {mode === 'live' && !liveDebug ? (
              <button type="button" className="ms-btn ms-btn-small ms-btn-primary" title={mt('tipDbgStart')} disabled={!programOk(built ?? buildProgram(''))} onClick={startDebug}>
                {mt('dbgStart')}
              </button>
            ) : null}
            <button type="button" className="ms-btn ms-btn-small" title={liveDebug ? mt('tipDbgStepLive') : mt('tipStep')} onClick={stepOnce}>
              {mt('step')}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={liveDebug ? mt('tipDbgStepOverLive') : mt('tipStepLine')} disabled={!asm} onClick={stepLine}>
              {mt('stepLine')}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={mt('tipStepCycle')} disabled={!liveDebug} onClick={stepCycle}>
              {mt('stepCycle')}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={mt('tipRunCursor')} disabled={!asm} onClick={runCursor}>
              {mt('runCursor')}
            </button>
            <button type="button" className="ms-btn ms-btn-small" title={liveDebug ? mt('tipDbgContinue') : mt('tipRunTo')} onClick={runToBreak}>
              {liveDebug ? mt('dbgContinue') : mt('runTo')}
            </button>
            {liveDebug && live.session === 'running' ? (
              <button type="button" className="ms-btn ms-btn-small" title={mt('tipDbgBreakNow')} onClick={() => command('break')}>
                {mt('dbgBreakNow')}
              </button>
            ) : null}
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
          {mode === 'live' && !liveDebug ? <p className="ms-hint">{mt('dbgNeedSim')}</p> : null}
          {held ? (
            <p className="ms-mcu-status" role="status">
              {mt('dbgStatus', {
                reason: reasonText,
                pc: `${shown.pc.toString(16).toUpperCase().padStart(4, '0')}h`,
                line: currentLine !== undefined ? mt('dbgStatusLine', { line: currentLine }) : '',
                cycles: Math.round(shown.cycles),
                time: formatEng(mcuTime(shown.cycles, current.fosc), 's'),
                sim: formatEng(live.simTime, 's'),
              })}
            </p>
          ) : null}
          {view && shown.halted === 0 ? (
            <p className="ms-mcu-timing">
              {nextText
                ? mt('dbgNext', { text: nextText, n: nextCycles, time: formatEng(nextCycles * mcs, 's') })
                : mt('dbgNextNoText', { pc: `${shown.pc.toString(16).toUpperCase().padStart(4, '0')}h`, n: nextCycles, time: formatEng(nextCycles * mcs, 's') })}{' '}
              <span title={mt('dbgCycleTime', { time: formatEng(mcs, 's'), fosc: formatEng(current.fosc, 'Hz') })}>· {mt('dbgCycleTime', { time: formatEng(mcs, 's'), fosc: formatEng(current.fosc, 'Hz') })}</span>
            </p>
          ) : null}
          {shown.halted === 1 ? <p className="ms-mcu-error">{mt('halted', { pc: `${shown.pc.toString(16).toUpperCase()}h` })}</p> : null}
          {shown.halted === 2 ? <p className="ms-mcu-error">{mt('haltedStack')}</p> : null}
          {mode === 'live' && !liveView ? <p className="ms-hint">{mt('liveWaiting')}</p> : null}
          <div className="ms-mcu-tabs" role="tablist" aria-label={mt('title')}>
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
            {tab === 'watch' ? <WatchView items={watches} plan={watchPlan} view={shown} cpu={mode === 'standalone' ? (standalone.current?.cpu ?? undefined) : undefined} live={liveDebug} onChange={changeWatches} /> : null}
            {tab === 'terminal' ? (
              <TerminalView text={terminal} view={shown} canSend={mode === 'standalone' || ctrl.active} onSend={sendText} onClear={() => setTerminal('')} />
            ) : null}
            {tab === 'listing' ? <ListingView asm={asm} breaks={breaks} currentLine={currentLine} onToggle={toggleBreak} fosc={current.fosc} /> : null}
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
