/**
 * The simulation controller behind Run / Pause / Stop (installed with setSimulationController).
 *
 * Run
 *  1. buildNetlist(design); ERC messages become canvas markers and Simulation messages. Errors
 *     block the run, warnings do not.
 *  2. Active analysis 'tran' and the design has instruments, indicators or interactive parts:
 *     an interactive streaming transient (worker session) feeds one InstrumentStream per
 *     instrument, probe read-outs, indicator levels and the status-bar time, paced at `speed`
 *     simulated seconds per wall second. Bode plotters, network / IV analyzers and logic
 *     converters get their extra analyses (instrumentNeed) run first.
 *     Otherwise the active analysis runs once and its results go to the Grapher; an operating
 *     point also updates probes, indicators and meters.
 *  Every one-shot run (and every interactive session when it ends) is appended to the run
 *  history `LiveState.runs` that the Grapher keeps as pages; the Output tab's saved variables are
 *  merged with what probes and instruments need (simSettings.effectiveSaves). Interactive sessions
 *  use Design.interactive (initial conditions, steps, automatic stop time) or, when absent, the
 *  transient analysis; their streamed samples are recorded (recorder.ts) and captured into the
 *  history. tryConvergenceFixes() re-runs a failed analysis with the convergence assistant's
 *  fixes (analysis/convergence.ts) until one works.
 *  While streaming, edits are applied live: an interactive part (switch, potentiometer, key) or
 *  an instrument setting re-netlists the design and sends the changed values to the stepper
 *  (elementValueChanges); a change of circuit structure restarts the session. Ordinary editing
 *  of values is applied live too; structural edits wait for the next Run.
 *
 * All editor access goes through an injected editor instance, so the whole flow runs in tests
 * with createEditor() and the in-process transport.
 */
import { analysisAllowed } from '../../model/restrictions';
import { defaultParams } from '../../library';
import { buildNetlist, type NetlistBuildEx } from '../../model/netlister';
import { designPartsReady } from '../../model/libraryLoad';
import { activeViewPath } from '../store/editorStore';
import { elementValueChanges } from '../../model/interactive';
import { applySteps } from '../../model/steps';
import { stepMessage } from '../../i18n/steps';
import { flattenNetlist } from '../../sim/spice/flatten';
import type { Design, ErcMessage, InstrumentBinding } from '../../model/types';
import type { TransientChunk } from '../../sim/api';
import type { AnalysisSpec, AnalysisType, Netlist, TranAnalysis } from '../../sim/netlist';
import type { AnalysisResult } from '../../sim/results';
import { formatEng } from '../../util/units';
import { defaultSpec, validateSpec } from '../analysis/specs';
import { chunkSignal, pushTransientChunk } from '../instruments/signals';
import { createInstrumentStream, type InstrumentStream } from '../instruments/types';
import { instrumentNeed, type InstrumentNeed } from '../instruments/needs';
import { createStore, type Store } from '../store/createStore';
import { liveParams, resolveLiveName } from '../../model/hierarchy';
import type { Editor } from '../store/editorStore';
import type { SimMessageSeverity } from '../store/types';
import { SimulationCancelled, type InteractiveSession, type RunHandle, type SessionEnd, type SimClient } from '../sim/client';
import { specContext } from './circuitInfo';
import { SignalHistory, probeKey, indicatorReadings, liveLevels, lowerValues, neededVectors, needsStreaming, probeText, type IndicatorReading } from './live';
import { t } from '../../i18n';
import { ANALYSIS_LABELS } from '../app/menus';
import { explainErc } from '../../i18n/erc';
import { ladderLive } from '../../ladder/probes';
import { localizeResultTitle } from '../results/titles';
import { applyBlows, findBlowEvents, type BlowEvent } from '../../model/ratings';
import { chunkBlow, ratingMessage, ratingStates, sameRatingStates } from './ratings';
import { appendRun, type RunRecord, type RunSource } from '../results/runs';
import { ChunkRecorder } from './recorder';
import { effectiveSaves, resolveInteractive, zeroInitialState, type ResolvedInteractive } from './simSettings';
import { applyFixToNetlist, classifyFailure, convergenceFixes, type Fix, type FixAttempt } from '../analysis/convergence';
import type { AudioRun } from '../../audio/monitor';

export type LiveMode = 'idle' | 'analysis' | 'interactive';

/** Observable state of the running (or last) simulation, read by instrument windows and tabs. */
export interface LiveState {
  mode: LiveMode;
  /** interactive session state */
  session: 'none' | 'starting' | 'running' | 'paused';
  /** netlist build of the current / last simulation */
  build: NetlistBuildEx | null;
  /** instrument refdes -> live samples */
  streams: Readonly<Record<string, InstrumentStream>>;
  /** instrument refdes -> AC result (Bode plotter, network analyzer) */
  ac: Readonly<Record<string, AnalysisResult>>;
  /** instrument refdes -> DC result (IV analyzer, logic converter rows) */
  dc: Readonly<Record<string, AnalysisResult>>;
  /** instrument refdes -> why its analysis is missing (not wired, failed, running) */
  needStatus: Readonly<Record<string, string>>;
  simTime: number;
  /** achieved simulated seconds per wall second */
  rate: number;
  /** requested simulated seconds per wall second (Infinity = as fast as possible) */
  speed: number;
  /** newest value of every recorded vector */
  latest: Readonly<Record<string, number>>;
  /** keys for <BreadboardView indicatorLevels> */
  breadboardLevels: Readonly<Record<string, number>>;
  readings: readonly IndicatorReading[];
  /** results of the last one-shot analysis (Grapher) */
  results: readonly AnalysisResult[];
  resultsVersion: number;
  /** run history kept by the Grapher (one-shot runs and captured interactive sessions), oldest first */
  runs: readonly RunRecord[];
  /** the last one-shot analysis that failed (convergence assistant), cleared by a successful run */
  lastFailure: { type: AnalysisType; message: string } | null;
  /** incremented on every streamed chunk */
  version: number;
}

/** The part of {@link LiveState} that belongs to a document (see SimulationIntegration.documentState). */
export type DocumentLive = Omit<LiveState, 'mode' | 'session' | 'speed'>;

export function initialLiveState(speed = 1): LiveState {
  return {
    mode: 'idle',
    session: 'none',
    build: null,
    streams: {},
    ac: {},
    dc: {},
    needStatus: {},
    simTime: 0,
    rate: 0,
    speed,
    latest: {},
    breadboardLevels: {},
    readings: [],
    results: [],
    resultsVersion: 0,
    runs: [],
    lastFailure: null,
    version: 0,
  };
}

export type EditorHandle = Pick<Editor, 'getState' | 'subscribe' | 'actions' | 'lookup'>;

export interface ControllerOptions {
  editor: EditorHandle;
  client: SimClient;
  /** called after a one-shot analysis with its results (the app opens the Grapher) */
  onResults?(results: AnalysisResult[]): void;
  /** called when ERC or the engine reported errors (the app shows the messages tab) */
  onProblems?(): void;
  /** editor-store updates while streaming are throttled to this interval (default 100 ms) */
  liveIntervalMs?: number;
  /** initial streaming speed (default 1 = real time) */
  speed?: number;
}

/** Analysis name for status messages (current language). */
const label = (type: AnalysisType): string => ANALYSIS_LABELS[type] ?? type;

/** One-line ERC text for the status bar and the messages tab (current language). */
function ercText(m: ErcMessage): string {
  return explainErc(m).title;
}

/** Copy of a netlist with some source fields replaced (sources matched case-insensitively). */
function withSources(netlist: Netlist, edits: Record<string, { dc?: number; acMag?: number }>): Netlist {
  const keys = new Map(Object.entries(edits).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ...netlist,
    elements: netlist.elements.map((el) => {
      const e = keys.get(el.name.toLowerCase());
      return e ? { ...el, source: { ...el.source, ...e } } : el;
    }),
  };
}

/** Circuit time after which an interactive run without an end time gets the end-time hint. */
export const LONG_RUN_HINT_S = 60;

export function rateText(rate: number, speed: number): string {
  if (!(rate > 0)) return t('integration.controller.interactiveSimulation');
  const r = rate >= 0.01 && rate < 1000 ? `${Number(rate.toPrecision(3))}×` : `${formatEng(rate, 's', 3)}/s`;
  const behind = Number.isFinite(speed) && rate < 0.8 * speed ? t('integration.controller.circuitSlowerThanTheRequested') : '';
  return t('integration.controller.interactiveRRealTimeBehind', { r: r, behind: behind });
}

export class SimulationIntegration {
  readonly live: Store<LiveState>;
  private readonly editor: EditorHandle;
  private readonly client: SimClient;
  private readonly opts: ControllerOptions;
  private session: InteractiveSession | null = null;
  private sessionBuild: NetlistBuildEx | null = null;
  private sessionSpec: TranAnalysis | null = null;
  private sessionSettings: ResolvedInteractive | null = null;
  /** an 'auto' session already restarted from a zero state after its operating point failed */
  private autoRetried = false;
  /** the "long run without an end time" hint was shown for the current session */
  private longRunHinted = false;
  private recorder = new ChunkRecorder();
  private runCounter = 0;
  private batch: RunHandle | null = null;
  private latest: Record<string, number> = {};
  private histories = new Map<string, SignalHistory>();
  /** rated parts that burnt out in the current / last run, by refdes */
  private blown = new Map<string, BlowEvent>();
  private needKeys = new Map<string, string>();
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private applyTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInteractive = false;
  /**
   * Bumped whenever the user's intent invalidates queued work: Stop, a one-shot run replacing
   * the session, another document being opened, dispose. A pending live edit or an automatic
   * restart only goes ahead while the generation it was queued under is still current.
   */
  private generation = 0;
  /** generation under which the current interactive session was started */
  private sessionGeneration = -1;
  private disposed = false;
  /** sound of the current interactive session (speakers, microphone), see src/audio */
  private audio: AudioRun | null = null;
  private structureWarned = false;
  private fatal: string | null = null;
  private lastDesign: Design;
  private lastFile: string;
  private readonly unsubs: (() => void)[] = [];

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    this.editor = opts.editor;
    this.client = opts.client;
    this.live = createStore(initialLiveState(opts.speed ?? 1));
    const s = this.editor.getState();
    this.lastDesign = s.design;
    this.lastFile = s.fileName;
    this.unsubs.push(this.editor.subscribe(() => this.onEditorChange()));
    this.unsubs.push(
      this.editor.actions.onInteractiveChange(() => {
        if (!this.session) return;
        this.pendingInteractive = true;
        this.scheduleApply();
      }),
    );
  }

  // ------------------------------------------------------------------ public API

  /** Start (or resume) the active analysis / interactive simulation. */
  async run(): Promise<void> {
    if (this.session) {
      if (this.live.getState().session === 'paused') this.resumeSession();
      return;
    }
    if (this.batch) return;
    // a design pasted or opened a moment ago may still wait for a catalogue pack
    const parts = designPartsReady(this.editor.getState().design);
    if (parts) await parts;
    const design = this.editor.getState().design;
    const type = design.analysis.active;
    const build = this.prepare(design);
    if (!build) return;
    const spec = this.specFor(design, type, build);
    if (!spec) return;
    if (spec.type === 'tran' && needsStreaming(build, design, this.editor.lookup)) {
      this.autoRetried = false;
      this.startInteractive(build, spec, resolveInteractive(design, spec));
    } else await this.startBatch(build, this.batchNetlist(design, build, spec), label(spec.type), spec.type);
  }

  /** Netlist of a one-shot run: the analysis and the Output tab's saved variables. */
  private batchNetlist(design: Design, build: NetlistBuildEx, spec: AnalysisSpec): Netlist {
    return { ...build.netlist, analyses: [spec], saves: effectiveSaves(design.analysis.saves, neededVectors(build)) };
  }

  /** Run one analysis type once (Simulate > Run analysis, the setup dialog's Run). */
  async runAnalysis(type: AnalysisType): Promise<void> {
    this.cancelPending();
    if (this.session) await this.stopSession();
    if (this.batch) return;
    const parts = designPartsReady(this.editor.getState().design);
    if (parts) await parts;
    const design = this.editor.getState().design;
    if (!analysisAllowed(design, type)) {
      this.editor.actions.addSimMessage('warning', t('learn.restricted.analysis', { analysis: label(type) }), 'instructor');
      return;
    }
    const build = this.prepare(design);
    if (!build) return;
    const spec = this.specFor(design, type, build);
    if (spec) await this.startBatch(build, this.batchNetlist(design, build, spec), label(spec.type), spec.type);
  }

  /**
   * Convergence assistant: run analysis `type` once per fix proposed for its failure (or for the
   * last failure's kind) until one succeeds. `onAttempt` reports each attempt as it finishes. The
   * successful run goes to the Grapher like any run; the design is not changed (the dialog offers to
   * keep the option changes). Resolves with every attempt and the fix that worked.
   */
  async tryConvergenceFixes(type: AnalysisType, onAttempt?: (a: FixAttempt, index: number, count: number) => void): Promise<{ attempts: FixAttempt[]; fixed: Fix | null }> {
    this.cancelPending();
    if (this.session) await this.stopSession();
    const attempts: FixAttempt[] = [];
    if (this.batch) return { attempts, fixed: null };
    const design = this.editor.getState().design;
    const build = this.prepare(design);
    if (!build) return { attempts, fixed: null };
    const spec = this.specFor(design, type, build);
    if (!spec) return { attempts, fixed: null };
    const base = this.batchNetlist(design, build, spec);
    const previous = this.live.getState().lastFailure;
    const kind = classifyFailure(previous && previous.type === type ? previous.message : '');
    const fixes = convergenceFixes(kind, design.options);
    const name = t('sim.assist.runName', { name: label(spec.type) });
    for (let i = 0; i < fixes.length; i++) {
      const fix = fixes[i];
      this.status({ state: 'running', message: t('sim.assist.trying', { n: i + 1, count: fixes.length }), simTime: 0 });
      const handle = this.client.run([applyFixToNetlist(base, fix)]);
      this.batch = handle;
      let results: AnalysisResult[];
      try {
        [results] = await handle.promise;
      } catch (e) {
        this.batch = null;
        const attempt: FixAttempt = { fix, ok: false, error: e instanceof Error ? e.message : String(e) };
        attempts.push(attempt);
        onAttempt?.(attempt, i, fixes.length);
        if (e instanceof SimulationCancelled) break;
        continue;
      }
      this.batch = null;
      const failed = results.find((r) => r.error);
      const attempt: FixAttempt = failed ? { fix, ok: false, error: failed.error } : { fix, ok: true };
      attempts.push(attempt);
      onAttempt?.(attempt, i, fixes.length);
      if (!failed) {
        this.msg('info', t('sim.assist.worked', { fix: t(`sim.assist.fix.${fix.id}`) }), 'engine');
        this.finishBatch(build, results, name, type);
        return { attempts, fixed: fix };
      }
    }
    this.status({ state: 'error', message: t('sim.assist.noneWorked') });
    this.msg('error', t('sim.assist.noneWorked'), 'engine');
    return { attempts, fixed: null };
  }

  /** Capture the running (or last) interactive session's recording into the Grapher history now. */
  captureInteractive(): boolean {
    const result = this.recorder.toResult(t('integration.controller.interactiveCapture'));
    if (!result) return false;
    this.pushRun('interactive', t('integration.controller.interactiveCapture'), [result]);
    return true;
  }

  /** Add results that did not come from the simulator (Grapher > Import measurement) as a run. */
  importRun(name: string, results: readonly AnalysisResult[]): number {
    this.pushRun('import', name, results);
    return this.runCounter;
  }

  /**
   * Add runs restored from a design file (Design.grapher) under fresh run numbers; returns the
   * old -> new id map for their pages.
   */
  adoptRuns(records: readonly RunRecord[]): Map<number, number> {
    const map = new Map<number, number>();
    let runs = this.live.getState().runs;
    for (const r of records) {
      const id = ++this.runCounter;
      map.set(r.id, id);
      runs = appendRun(runs, { ...r, id });
    }
    this.live.setState((s) => ({ ...s, runs }));
    return map;
  }

  private pushRun(source: RunSource, name: string, results: readonly AnalysisResult[]): void {
    const expressions = this.editor.getState().design.analysis.expressions;
    const record: RunRecord = { id: ++this.runCounter, source, name, time: Date.now(), results, ...(expressions?.length ? { expressions: [...expressions] } : {}) };
    this.live.setState((s) => ({ ...s, runs: appendRun(s.runs, record) }));
  }

  /** Run a ready-made netlist (e.g. an imported SPICE deck) once; results go to the Grapher. */
  async runNetlist(netlist: Netlist, name: string): Promise<void> {
    this.cancelPending();
    if (this.session) await this.stopSession();
    if (this.batch) return;
    await this.startBatch(null, netlist, name, netlist.analyses[0]?.type);
  }

  pause(): void {
    if (this.session && this.live.getState().session === 'running') this.session.pause();
  }

  /** Set by {@link startDebugging} for the next interactive session only. */
  private debugStart = false;

  /**
   * Start the simulation with every microcontroller held before its first instruction, so the
   * program can be single-stepped from the very beginning (MCU code editor "Start debugging").
   * A session that is already running is left alone.
   */
  async startDebugging(): Promise<void> {
    if (this.session) {
      if (this.live.getState().session === 'paused') this.resumeSession();
      return;
    }
    this.debugStart = true;
    await this.run();
    this.debugStart = false;
  }

  /** Resume a session that paused (a debugger stop or the Pause button). */
  resume(): void {
    if (this.session && this.live.getState().session === 'paused') this.session.resume();
  }

  /** True while the session is paused because a microcontroller debugger stop holds it. */
  private debugHeld = false;

  /**
   * Resume after a pause. A hold by the microcontroller debugger is released first (the program
   * continues to its next breakpoint), so the toolbar Run button always means "go on".
   */
  private resumeSession(): void {
    if (!this.session) return;
    if (this.debugHeld) {
      const edits = (this.sessionBuild?.mcus ?? []).map((m) => ({ element: m.element, param: 'resume', value: 1 }));
      if (edits.length) this.session.setParams(edits);
      this.debugHeld = false;
    }
    this.session.resume();
  }

  async stop(): Promise<void> {
    // a live edit queued before Stop must not restart the session afterwards
    this.cancelPending();
    if (this.batch) {
      this.batch.cancel();
      return;
    }
    if (this.session) await this.stopSession();
  }

  /** Streaming speed in simulated seconds per wall second (Infinity = as fast as possible). */
  setSpeed(speed: number): void {
    const s = speed > 0 ? speed : 1;
    this.live.setState((st) => ({ ...st, speed: s }));
    this.session?.setSpeed(s);
  }

  /** An instrument panel changed its settings (complete params record). */
  instrumentParams(refdes: string, next: Record<string, string>): void {
    const design = this.editor.getState().design;
    // `refdes` is a top-level refdes or the dotted path of an instrument inside a block ("X2.XMM1")
    const f = resolveLiveName(design, refdes);
    if (!f) return;
    const def = this.editor.lookup(f.part.partId);
    const current = { ...(def ? defaultParams(def) : {}), ...liveParams(f) };
    for (const [k, v] of Object.entries(next)) {
      if (current[k] !== v) this.editor.actions.setInteractiveParam(f.local, k, v, f.path);
    }
  }

  /**
   * Change one netlist element parameter in the running interactive session (no undo step and no
   * change to the design): the MCU code editor uses it to push a typed character into the serial
   * receiver and to move the RAM read-out window. False when no session is running.
   */
  setElementParam(element: string, param: string, value: number): boolean {
    if (!this.session) return false;
    this.session.setParams([{ element, param, value }]);
    return true;
  }

  /** True while an analysis or interactive session is in progress. */
  get active(): boolean {
    return this.session !== null || this.batch !== null;
  }

  /** Resolves when the current session (if any) has ended. */
  async idle(): Promise<void> {
    while (this.session || this.batch) {
      const s = this.session;
      const b = this.batch;
      if (s) await s.done;
      else if (b) await b.promise.catch(() => undefined);
      await Promise.resolve();
    }
  }

  /**
   * Document tabs (src/ui/app/documents.ts): stop whatever is running on the current document and
   * wait until it has ended, so the document can be left. The results stay.
   */
  async stopForDocumentSwitch(): Promise<void> {
    const wasRunning = this.live.getState().mode !== 'idle';
    await this.stop();
    await this.idle();
    // one simulation runs at a time: say why this one ended, and how to go on when the learner comes back
    if (wasRunning) this.msg('info', t('docs.simStoppedBySwitch'), t('sim.source.documents'));
  }

  /**
   * Document tabs: the simulation results that belong to the current document (instrument data,
   * the Grapher run history, the last analysis), to be kept while another document is shown.
   */
  documentState(): DocumentLive {
    const { mode: _mode, session: _session, speed: _speed, ...rest } = this.live.getState();
    void _mode;
    void _session;
    void _speed;
    return rest;
  }

  /**
   * Document tabs: show the results of a document again (`undefined` = a new document with no
   * results). The streaming speed and the run counter are kept, so run numbers stay unique.
   */
  restoreDocumentState(state: DocumentLive | undefined): void {
    this.cancelPending();
    this.latest = state?.latest ? { ...state.latest } : {};
    this.histories.clear();
    this.blown.clear();
    this.needKeys.clear();
    this.recorder = new ChunkRecorder();
    this.fatal = null;
    this.live.setState((s) => ({ ...initialLiveState(s.speed), ...(state ?? {}), speed: s.speed, version: s.version + 1 }));
  }

  dispose(): void {
    this.disposed = true;
    this.cancelPending();
    for (const u of this.unsubs.splice(0)) u();
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.audio?.close();
    this.audio = null;
    this.session?.stop();
    this.batch?.cancel();
  }

  // ------------------------------------------------------------------ helpers

  /** Drop queued live edits and invalidate any automatic restart in flight. */
  private cancelPending(): void {
    this.generation++;
    this.pendingInteractive = false;
    if (this.applyTimer) {
      clearTimeout(this.applyTimer);
      this.applyTimer = null;
    }
  }

  private msg(severity: SimMessageSeverity, text: string, source = 'simulation'): void {
    this.editor.actions.addSimMessage(severity, text, source);
  }

  private status(p: { state?: 'idle' | 'running' | 'paused' | 'error'; message?: string; simTime?: number }): void {
    this.editor.actions.setSimStatus(p);
  }

  /** Netlist + ERC. Returns null (and reports) when ERC found errors. */
  private prepare(design: Design): NetlistBuildEx | null {
    let build: NetlistBuildEx;
    try {
      build = buildNetlist(design, { includeAnalysis: false });
    } catch (e) {
      const text = t('integration.controller.netlistFailedValue', { value: e instanceof Error ? e.message : String(e) });
      this.msg('error', text, 'netlister');
      this.status({ state: 'error', message: text, simTime: 0 });
      this.opts.onProblems?.();
      return null;
    }
    const { actions } = this.editor;
    if (build.erc.length) actions.setErcMarkers(build.erc);
    else actions.clearErcMarkers();
    for (const m of build.erc) this.msg(m.severity === 'error' ? 'error' : 'warning', ercText(m), 'erc');
    const errors = build.erc.filter((m) => m.severity === 'error');
    if (errors.length) {
      this.status({ state: 'error', message: t('integration.controller.ercLengthErrorSErctext', { length: errors.length, ercText: ercText(errors[0]) }), simTime: 0 });
      this.opts.onProblems?.();
      return null;
    }
    if (!build.netlist.elements.length) {
      const text = t('integration.controller.nothingToSimulatePlaceComponents');
      this.msg('error', text);
      this.status({ state: 'error', message: text, simTime: 0 });
      return null;
    }
    return build;
  }

  /** The saved (or default) spec of an analysis type, validated against the circuit. */
  private specFor(design: Design, type: AnalysisType, build: NetlistBuildEx): AnalysisSpec | null {
    const ctx = specContext(build);
    let spec = design.analysis.specs[type];
    if (!spec) {
      spec = defaultSpec(type, ctx);
      this.msg('info', t('integration.controller.labelNoSavedSettingsUsing', { label: label(type) }));
    }
    const errors = validateSpec(spec, ctx).filter((i) => i.severity === 'error');
    if (errors.length) {
      const text = t('integration.controller.settingsInvalid', { label: label(type), errors: errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('; ') });
      this.msg('error', text);
      this.status({ state: 'error', message: text, simTime: 0 });
      this.opts.onProblems?.();
      return null;
    }
    // `.step` cards of the circuit's SPICE text and Parameter sweeps of a design variable: the
    // circuit is rebuilt for every value (src/model/steps.ts), then all of it runs as one family
    const saves = effectiveSaves(design.analysis.saves, neededVectors(build));
    const stepped = applySteps(design, spec, (n) => ({ ...n, analyses: [], saves }));
    for (const note of stepped.notes) this.msg('info', stepMessage(note), 'step');
    if (stepped.errors.length) {
      const text = t('integration.controller.stepFailed', { error: stepMessage(stepped.errors[0]) });
      this.msg('error', text, 'step');
      this.status({ state: 'error', message: text, simTime: 0 });
      this.opts.onProblems?.();
      return null;
    }
    return stepped.spec;
  }

  // ------------------------------------------------------------------ one-shot analyses

  /** Run `netlist` once (its analyses). `build` links results to the design's instruments / probes. */
  private async startBatch(build: NetlistBuildEx | null, netlist: Netlist, name: string, type?: AnalysisType): Promise<void> {
    this.blown.clear();
    if (Object.keys(this.editor.getState().ratingStates).length) this.editor.actions.setRatingStates({});
    this.live.setState((s) => ({ ...s, mode: 'analysis', build: build ?? s.build }));
    this.status({ state: 'running', message: `${name}…`, simTime: 0 });
    const handle = this.client.run([netlist], {
      onProgress: (f) => this.status({ message: `${name} ${Math.round(f * 100)} %` }),
    });
    this.batch = handle;
    let results: AnalysisResult[];
    try {
      [results] = await handle.promise;
    } catch (e) {
      this.batch = null;
      this.live.setState((s) => ({ ...s, mode: 'idle' }));
      if (e instanceof SimulationCancelled) {
        this.status({ state: 'idle', message: t('integration.controller.nameCancelled', { name: name }) });
        this.msg('info', t('integration.controller.nameCancelled', { name }));
      } else {
        const text = t('integration.controller.nameFailed', { name, error: e instanceof Error ? e.message : String(e) });
        this.status({ state: 'error', message: text });
        this.msg('error', text, 'engine');
        this.opts.onProblems?.();
      }
      return;
    }
    this.batch = null;
    if (build?.ratings?.length) {
      try {
        results = await this.rerunWithBurnouts(build, netlist, results, name);
      } catch (e) {
        if (e instanceof SimulationCancelled) {
          this.live.setState((s) => ({ ...s, mode: 'idle' }));
          this.status({ state: 'idle', message: t('integration.controller.nameCancelled', { name }) });
          return;
        }
        throw e;
      }
    }
    this.finishBatch(build, results, name, type);
  }

  /**
   * Rated parts that reach a rating in a one-shot run burn out: the run is repeated with those
   * parts opened (at the operating point, or from the burn-out instant of a transient) until no
   * new part fails, so the results show the circuit after the failure. Each burn-out is explained
   * in the messages.
   */
  private async rerunWithBurnouts(build: NetlistBuildEx, netlist: Netlist, first: AnalysisResult[], name: string): Promise<AnalysisResult[]> {
    const bindings = build.ratings ?? [];
    let results = first;
    const events: BlowEvent[] = [];
    for (let round = 0; round < 6; round++) {
      const fresh = findBlowEvents(bindings, results, new Set(events.map((e) => e.refdes)));
      if (!fresh.length) break;
      events.push(...fresh);
      for (const e of fresh) {
        this.blown.set(e.refdes, e);
        this.msg('error', ratingMessage(e), 'rating');
      }
      this.status({ state: 'running', message: `${name}…`, simTime: 0 });
      const handle = this.client.run([applyBlows(netlist, events)]);
      this.batch = handle;
      try {
        [results] = await handle.promise;
      } finally {
        this.batch = null;
      }
    }
    if (events.length) {
      this.msg('info', t('rating.rerun'), 'rating');
      this.pushRatingStates(build);
    }
    return results;
  }

  /** Update the hot / burnt marks of rated parts in the editor (only when they changed). */
  private pushRatingStates(build: NetlistBuildEx): void {
    const states = ratingStates(build.ratings ?? [], lowerValues(this.latest), this.blown);
    if (!sameRatingStates(states, this.editor.getState().ratingStates)) this.editor.actions.setRatingStates(states);
  }

  private finishBatch(build: NetlistBuildEx | null, results: AnalysisResult[], name = '', type?: AnalysisType): void {
    let failed: string | null = null;
    for (const r of results) {
      const title = localizeResultTitle(r.title, r.type);
      for (const w of r.warnings) this.msg('warning', `${title}: ${w}`, 'engine');
      if (r.error) {
        failed ??= `${title}: ${r.error}`;
        this.msg('error', `${title}: ${r.error}`, 'engine');
      } else {
        this.msg('info', t('integration.controller.titleFinishedInRoundMs', { title, round: Math.round(r.elapsedMs ?? 0) }), 'engine');
      }
    }
    const ac: Record<string, AnalysisResult> = {};
    const op = results.find((r) => r.type === 'op' && !r.error);
    const acResult = results.find((r) => r.type === 'ac' && !r.error);
    if (acResult && build) for (const b of build.instruments) if (b.kind === 'bode-plotter') ac[b.refdes] = acResult;
    const failure = type && failed ? { type, message: results.find((r) => r.error)?.error ?? failed } : null;
    this.live.setState((s) => ({
      ...s,
      mode: 'idle',
      results,
      resultsVersion: s.resultsVersion + 1,
      ac: { ...s.ac, ...ac },
      lastFailure: failure,
    }));
    this.pushRun(build ? 'analysis' : 'netlist', name, results);
    if (op && build) this.applySnapshot(build, op);
    else if (build?.probes.length) {
      const tran = results.find((r) => r.type === 'tran' && !r.error && r.scale);
      if (tran) this.applyTransientProbes(build, tran);
    }
    if (failed) {
      this.status({ state: 'error', message: failed });
      this.opts.onProblems?.();
    } else {
      const ms = results.reduce((a, r) => a + (r.elapsedMs ?? 0), 0);
      this.status({ state: 'idle', message: t('integration.controller.doneJoinRoundMs', { join: results.map((r) => localizeResultTitle(r.title, r.type)).join(', '), round: Math.round(ms) }) });
    }
    this.opts.onResults?.(results);
  }

  /** Operating-point values -> probes, indicators, readings and one sample in every stream. */
  private applySnapshot(build: NetlistBuildEx, op: AnalysisResult): void {
    const values: Record<string, number> = {};
    for (const v of op.vectors) values[v.name] = v.re[0];
    // two equal samples (panels need a time span to measure): a DC level from t = 0 to 1 s
    const chunk: TransientChunk = {
      time: new Float64Array([0, 1]),
      vectors: Object.fromEntries(op.vectors.map((v) => [v.name, new Float64Array([v.re[0], v.re[0]])])),
    };
    const streams: Record<string, InstrumentStream> = {};
    for (const b of build.instruments) {
      const st = createInstrumentStream(b);
      pushTransientChunk(st, b, chunk);
      streams[b.refdes] = st;
    }
    this.latest = values;
    this.histories.clear();
    this.live.setState((s) => ({ ...s, build, streams, latest: values, simTime: 0, version: s.version + 1 }));
    this.flushLive(build);
  }

  /**
   * Probe read-outs after a one-shot transient: the final value of every probe, with peak-to-peak,
   * RMS, mean and frequency over the last PROBE_STATS_WINDOW of the run (from the result's samples).
   */
  private applyTransientProbes(build: NetlistBuildEx, tran: AnalysisResult): void {
    const time = tran.scale!.re;
    const n = time.length;
    if (!n) return;
    const chunk: TransientChunk = { time, vectors: Object.fromEntries(tran.vectors.map((v) => [v.name, v.re])) };
    const last: Record<string, number> = {};
    for (const v of tran.vectors) last[v.name] = v.re[n - 1];
    const lower = lowerValues(last);
    const probeValues: Record<string, string> = {};
    for (const p of build.probes) {
      const h = new SignalHistory();
      const v = chunkSignal(chunk, p.signal);
      const i = p.kind === 'power' && p.current ? chunkSignal(chunk, p.current) : null;
      for (let k = Math.max(0, n - h.capacity); k < n; k++) h.push(time[k], i ? v[k] * i[k] : v[k]);
      probeValues[probeKey(p)] = probeText(p, lower, h);
    }
    this.editor.actions.setProbeValues(probeValues);
  }

  // ------------------------------------------------------------------ interactive sessions

  private startInteractive(build: NetlistBuildEx, spec: TranAnalysis, settings: ResolvedInteractive): void {
    this.fatal = null;
    this.recorder.clear();
    this.sessionSettings = settings;
    this.blown.clear();
    if (Object.keys(this.editor.getState().ratingStates).length) this.editor.actions.setRatingStates({});
    this.structureWarned = false;
    this.latest = {};
    this.histories = new Map(build.probes.map((p) => [probeKey(p), new SignalHistory()]));
    this.needKeys.clear();
    const streams: Record<string, InstrumentStream> = {};
    for (const b of build.instruments) streams[b.refdes] = createInstrumentStream(b);
    this.editor.actions.clearLiveData();
    this.live.setState((s) => ({
      ...s,
      mode: 'interactive',
      session: 'starting',
      build,
      streams,
      ac: {},
      dc: {},
      needStatus: {},
      simTime: 0,
      rate: 0,
      latest: {},
      breadboardLevels: {},
      readings: [],
      version: s.version + 1,
    }));
    this.sessionBuild = build;
    this.sessionSpec = spec;
    this.sessionGeneration = this.generation;
    // instrument analyses are queued first: the worker answers them before streaming starts
    this.runNeeds(build, false);
    let base: Netlist = { ...build.netlist, analyses: [] };
    if (this.debugStart && (build.mcus?.length ?? 0) > 0) {
      // "Start debugging" (MCU code editor): the microcontrollers hold the run before their first instruction
      const cores = new Set(build.mcus!.map((m) => m.element));
      base = { ...base, elements: base.elements.map((el) => (cores.has(el.name) ? { ...el, params: { ...el.params, dbgstart: 1 } } : el)) };
    }
    this.debugStart = false;
    const netlist = settings.initial === 'zero' ? zeroInitialState(base) : base;
    const session = this.client.startInteractive(
      netlist,
      { tstep: settings.tstep, tmax: settings.tmax, uic: settings.uic, saves: neededVectors(build), speed: this.live.getState().speed, ...(Number.isFinite(settings.tstop) ? { tstop: settings.tstop } : {}) },
      {
        onStarted: (info) => {
          for (const w of info.warnings) this.msg('warning', w, 'engine');
        },
        onChunk: (chunk, info) => this.onChunk(session, chunk, info),
        onState: (state, simTime, held) => {
          if (this.session !== session) return;
          this.debugHeld = state === 'paused' && held === true;
          if (state === 'running' || state === 'paused') {
            this.live.setState((s) => ({ ...s, session: state }));
            this.audio?.setPaused(state === 'paused');
            this.status({ state, message: state === 'paused' ? t(held ? 'integration.controller.debugHold' : 'integration.controller.paused') : rateText(this.live.getState().rate, this.live.getState().speed), simTime });
          }
        },
        onError: (message, fatal) => {
          if (fatal) this.fatal = message;
          this.msg(fatal ? 'error' : 'warning', message, 'engine');
        },
      },
    );
    this.session = session;
    void this.startAudio(build, session);
    this.longRunHinted = false;
    this.status({ state: 'running', message: t('integration.controller.startingInteractiveSimulation'), simTime: 0 });
    void session.done.then((end) => this.sessionEnded(session, end));
  }

  private onChunk(session: InteractiveSession, chunk: TransientChunk, info: { latest: Record<string, number>; simTime: number; rate: number }): void {
    if (this.session !== session || !this.sessionBuild) return;
    const build = this.sessionBuild;
    const st = this.live.getState();
    for (const b of build.instruments) {
      const stream = st.streams[b.refdes];
      if (stream) pushTransientChunk(stream, b, chunk);
    }
    for (const p of build.probes) {
      const h = this.histories.get(probeKey(p));
      if (!h) continue;
      const v = chunkSignal(chunk, p.signal);
      const i = p.kind === 'power' && p.current ? chunkSignal(chunk, p.current) : null;
      for (let k = 0; k < chunk.time.length; k++) h.push(chunk.time[k], i ? v[k] * i[k] : v[k]);
    }
    this.latest = info.latest;
    this.audio?.chunk(chunk, info.simTime);
    this.recorder.push(chunk);
    // rated parts: a stress reaching 1 burns the part out (opened live through its blow source)
    for (const b of build.ratings ?? []) {
      if (this.blown.has(b.refdes)) continue;
      const e = chunkBlow(b, chunk);
      if (!e) continue;
      this.blown.set(b.refdes, e);
      session.setParams([{ element: b.blowSource, param: 'dc', value: 1 }]);
      this.msg('error', ratingMessage(e), 'rating');
      this.opts.onProblems?.();
    }
    this.live.setState((s) => ({ ...s, simTime: info.simTime, rate: info.rate, latest: info.latest, version: s.version + 1 }));
    this.scheduleLive();
  }

  private scheduleLive(): void {
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      if (this.sessionBuild && this.session) this.flushLive(this.sessionBuild);
    }, this.opts.liveIntervalMs ?? 100);
  }

  /** Push probe texts, indicator levels and the status line to the editor store. */
  private flushLive(build: NetlistBuildEx): void {
    const lower = lowerValues(this.latest);
    const probeValues: Record<string, string> = {};
    for (const p of build.probes) probeValues[probeKey(p)] = probeText(p, lower, this.histories.get(probeKey(p)));
    const levels = liveLevels(build.indicators, this.latest);
    const readings = indicatorReadings(build.indicators, this.latest);
    this.editor.actions.setProbeValues(probeValues);
    this.editor.actions.setIndicatorLevels(levels.schematic);
    // the ladder editor lights up the rungs that carry power
    // (a program inside a block: the one of the placed copy the learner has opened)
    const view = activeViewPath(this.editor.getState());
    const lad = view.length ? build.ladders?.find((l) => l.scope?.path.join('/') === view.join('/')) : build.ladder;
    if (lad?.debug) this.editor.actions.setLadderLive(ladderLive(lower, lad.element, lad.ir));
    else if (view.length && build.ladder?.debug) this.editor.actions.setLadderLive(null);
    if (build.ratings?.length) this.pushRatingStates(build);
    this.live.setState((s) => ({ ...s, breadboardLevels: levels.breadboard, readings }));
    const st = this.live.getState();
    if (this.session && st.session === 'running') this.status({ message: rateText(st.rate, st.speed), simTime: st.simTime });
    else if (this.session) this.status({ simTime: st.simTime });
    // an interactive run has no end time by default: after a minute of circuit time, say how to set one
    if (this.session && !this.longRunHinted && st.simTime >= LONG_RUN_HINT_S && !Number.isFinite(this.sessionSettings?.tstop ?? Infinity)) {
      this.longRunHinted = true;
      this.msg('info', t('integration.controller.longRunHint', { t: formatEng(LONG_RUN_HINT_S, 's', 3) }));
    }
  }

  /**
   * Sound of the session: speakers play the streamed chunks, microphone parts are kept fed.
   * The audio code loads on demand and only when the design has a speaker or a live microphone.
   */
  private async startAudio(build: NetlistBuildEx, session: InteractiveSession): Promise<void> {
    const design = this.editor.getState().design;
    const wanted = build.indicators.some((b) => b.kind === 'speaker') || design.sheets.some((s) => s.parts.some((p) => !p.excludeFromSim && p.partId === 'sources/microphone'));
    if (!wanted) return;
    const host = await import('../../audio/host');
    if (this.session !== session || this.disposed) return;
    this.audio = host.startAudioRun(build, design, () => this.editor.getState().design, (edits) => session.setParams(edits));
  }

  private sessionEnded(session: InteractiveSession, end: SessionEnd): void {
    if (this.session !== session) return;
    this.session = null;
    this.audio?.close();
    this.audio = null;
    if (this.liveTimer) {
      clearTimeout(this.liveTimer);
      this.liveTimer = null;
    }
    if (this.applyTimer) {
      clearTimeout(this.applyTimer);
      this.applyTimer = null;
    }
    const build = this.sessionBuild;
    if (build) this.flushLive(build);
    this.sessionBuild = null;
    // 'auto' initial conditions: an operating point that fails at t = 0 restarts from a zero state
    const settings = this.sessionSettings;
    if (build && settings && settings.initial === 'auto' && !this.autoRetried && (end.state === 'error' || this.fatal) && end.simTime === 0 && this.sessionSpec) {
      this.autoRetried = true;
      this.msg('info', t('integration.controller.autoZeroRestart'));
      const spec = this.sessionSpec;
      const gen = this.generation;
      this.live.setState((s) => ({ ...s, mode: 'idle', session: 'none' }));
      queueMicrotask(() => {
        if (this.disposed || gen !== this.generation || this.session || this.batch) return;
        this.startInteractive(build, spec, { ...settings, initial: 'zero', uic: true });
      });
      return;
    }
    const captured = this.recorder.toResult(t('integration.controller.interactiveCapture'));
    if (captured) this.pushRun('interactive', t('integration.controller.interactiveCapture'), [captured]);
    this.live.setState((s) => ({ ...s, mode: 'idle', session: 'none', simTime: end.simTime }));
    this.editor.actions.clearLiveData();
    this.live.setState((s) => ({ ...s, breadboardLevels: {} }));
    const at = `t = ${formatEng(end.simTime, 's', 4)}`;
    if (end.state === 'error' || this.fatal) {
      const text = t('integration.controller.simulationStoppedValue', { value: end.message ?? this.fatal ?? '' });
      this.status({ state: 'error', message: text, simTime: end.simTime });
      this.opts.onProblems?.();
    } else if (end.state === 'finished') {
      // the worker stops exactly at the end time of the interactive settings
      const stopAt = settings?.tstop ?? Infinity;
      if (Number.isFinite(stopAt)) this.msg('info', t('integration.controller.reachedEndTime', { t: formatEng(stopAt, 's', 4) }));
      this.status({ state: 'idle', message: t('integration.controller.finishedAtT', { t: at }), simTime: end.simTime });
    }
    else this.status({ state: 'idle', message: t('integration.controller.stoppedAtT', { t: at }), simTime: end.simTime });
  }

  private async stopSession(): Promise<void> {
    const s = this.session;
    if (!s) return;
    s.stop();
    await s.done;
    // sessionEnded runs on the same resolution; give it a turn
    await Promise.resolve();
  }

  // ------------------------------------------------------------------ live edits

  private onEditorChange(): void {
    const s = this.editor.getState();
    if (s.design === this.lastDesign && s.fileName === this.lastFile) return;
    const prev = this.lastDesign;
    this.lastDesign = s.design;
    const fileChanged = s.fileName !== this.lastFile;
    this.lastFile = s.fileName;
    if (!this.session) return;
    if (fileChanged || replacedDocument(prev, s.design)) {
      // another document was opened: the running circuit no longer exists, and an edit queued
      // for the old document must not be applied to (or restart a session from) the new one
      this.cancelPending();
      this.msg('info', t('integration.controller.simulationStoppedAnotherDesignWas'));
      void this.stopSession();
      return;
    }
    this.scheduleApply();
  }

  private scheduleApply(): void {
    if (this.applyTimer) return;
    this.applyTimer = setTimeout(() => {
      this.applyTimer = null;
      this.applyDesignChange();
    }, 0);
  }

  /** Re-netlist after an edit while streaming and push the changed values to the stepper. */
  private applyDesignChange(): void {
    const session = this.session;
    const prev = this.sessionBuild;
    if (!session || !prev || !this.sessionSpec) return;
    // the session was stopped or its document replaced since it started
    if (this.disposed || this.sessionGeneration !== this.generation) return;
    const interactive = this.pendingInteractive;
    this.pendingInteractive = false;
    let build: NetlistBuildEx;
    try {
      build = buildNetlist(this.editor.getState().design, { includeAnalysis: false });
    } catch (e) {
      this.msg('error', t('integration.controller.changeNotAppliedValue', { value: e instanceof Error ? e.message : String(e) }));
      return;
    }
    const errors = build.erc.filter((m) => m.severity === 'error');
    if (errors.length) {
      this.msg('error', t('integration.controller.changeNotAppliedErctext', { ercText: ercText(errors[0]) }), 'erc');
      return;
    }
    const changes = elementValueChanges(prev.netlist, build.netlist);
    if (changes === null) {
      if (interactive) {
        this.msg('info', t('integration.controller.theCircuitStructureChangedInteractiv'));
        const spec = this.sessionSpec;
        const gen = this.generation;
        void this.stopSession().then(() => {
          // Stop, File > Open/New or a one-shot run while the old session was winding down
          // cancels the restart; so does anything that already started a new session
          if (this.disposed || gen !== this.generation || this.session || this.batch) return;
          this.startInteractive(build, spec, this.sessionSettings ?? resolveInteractive(this.editor.getState().design, spec));
        });
      } else if (!this.structureWarned) {
        this.structureWarned = true;
        this.msg('warning', t('integration.controller.theCircuitWasEditedStop'));
      }
      return;
    }
    if (changes.length) session.setParams(changes);
    this.sessionBuild = build;
    this.live.setState((s) => ({ ...s, build }));
    this.runNeeds(build, true);
  }

  // ------------------------------------------------------------------ instrument analyses

  /** Run the extra analyses instruments need (only those whose need changed when `onlyChanged`). */
  private runNeeds(build: NetlistBuildEx, onlyChanged: boolean): void {
    for (const b of build.instruments) {
      const need = instrumentNeed(b, b.params);
      const key = JSON.stringify(need);
      if (onlyChanged && this.needKeys.get(b.refdes) === key) continue;
      this.needKeys.set(b.refdes, key);
      void this.runNeed(build, b, need);
    }
  }

  private setNeed(refdes: string, patch: { ac?: AnalysisResult; dc?: AnalysisResult; status?: string | null }): void {
    this.live.setState((s) => {
      const needStatus = { ...s.needStatus };
      if (patch.status === null) delete needStatus[refdes];
      else if (patch.status !== undefined) needStatus[refdes] = patch.status;
      return {
        ...s,
        needStatus,
        ac: patch.ac ? { ...s.ac, [refdes]: patch.ac } : s.ac,
        dc: patch.dc ? { ...s.dc, [refdes]: patch.dc } : s.dc,
      };
    });
  }

  private async runNeed(build: NetlistBuildEx, b: InstrumentBinding, need: InstrumentNeed): Promise<void> {
    // an instrument inside a block names the flattened elements of its copy ("V.XHB1.V_XFG1_p"):
    // the sources its analysis sets live in the flat netlist
    const base: Netlist = { ...(b.scope ? flattenNetlist(build.netlist) : build.netlist), analyses: [] };
    let netlists: Netlist[];
    switch (need.kind) {
      case 'stream':
        return;
      case 'none':
        this.setNeed(b.refdes, { status: t('integration.controller.notConnectedReason', { reason: need.reason }) });
        return;
      case 'ac':
        netlists = [{ ...base, analyses: [need.spec] }];
        break;
      case 'ac-two-port':
        netlists = [{ ...withSources(base, { [need.forward]: { acMag: 1 }, ...(need.reverse ? { [need.reverse]: { acMag: 0 } } : {}) }), analyses: [need.spec] }];
        if (need.reverse) netlists.push({ ...withSources(base, { [need.forward]: { acMag: 0 }, [need.reverse]: { acMag: 1 } }), analyses: [need.spec] });
        break;
      case 'dc':
        netlists = [{ ...base, analyses: [need.spec] }];
        break;
      case 'op-rows':
        netlists = need.rows.map((row) => ({
          ...withSources(base, Object.fromEntries(Object.entries(row.values).map(([src, v]) => [src, { dc: v }]))),
          analyses: [{ type: 'op' }],
        }));
        break;
    }
    this.setNeed(b.refdes, { status: t('integration.controller.running') });
    let results: AnalysisResult[][];
    try {
      results = await this.client.run(netlists).promise;
    } catch (e) {
      if (!(e instanceof SimulationCancelled)) this.msg('error', `${b.refdes}: ${e instanceof Error ? e.message : String(e)}`, 'engine');
      this.setNeed(b.refdes, { status: e instanceof SimulationCancelled ? t('integration.controller.cancelled') : t('integration.controller.failedValue', { value: e instanceof Error ? e.message : String(e) }) });
      return;
    }
    // settings changed while this analysis ran: the newer run reports instead
    if (this.needKeys.get(b.refdes) !== JSON.stringify(need)) return;
    const failed = results.flat().find((r) => r.error);
    if (failed) {
      this.msg('error', `${b.refdes}: ${localizeResultTitle(failed.title, failed.type)}: ${failed.error}`, 'engine');
      this.setNeed(b.refdes, { status: t('integration.controller.failedError', { error: failed.error ?? '' }) });
      return;
    }
    if (need.kind === 'ac') this.setNeed(b.refdes, { ac: results[0][0], status: null });
    else if (need.kind === 'ac-two-port') {
      const fwd = results[0][0];
      const runs = [{ label: t('integration.controller.forward'), result: fwd }, ...(results[1] ? [{ label: t('integration.controller.reverse'), result: results[1][0] }] : [])];
      this.setNeed(b.refdes, { ac: { ...fwd, runs }, status: null });
    } else if (need.kind === 'dc') this.setNeed(b.refdes, { dc: results[0][0], status: null });
    else if (need.kind === 'op-rows') {
      const runs = need.rows.map((row, i) => ({ label: String(row.row), result: results[i][0] }));
      this.setNeed(b.refdes, { dc: { type: 'op', title: t('integration.controller.logicConverter'), vectors: [], warnings: [], runs }, status: null });
    }
  }
}

/** Heuristic: the document was replaced (open / new) rather than edited. */
function replacedDocument(prev: Design, next: Design): boolean {
  const ids = (d: Design) => new Set(d.sheets.flatMap((s) => s.parts.map((p) => p.id)));
  const a = ids(prev);
  if (!a.size) return false;
  const b = ids(next);
  for (const id of b) if (a.has(id)) return false;
  return true;
}
