/**
 * The Scripts window (Tools > Scripts): a code editor, Run / Stop, an output log, the plots a script
 * made, the example scripts and a searchable function reference. The script itself runs in a
 * sandboxed worker (src/script/runner.ts); this component is its host: it owns the design the
 * script builds (a copy, never the open document), runs the analyses in its own simulation worker,
 * and asks the user before a script opens or saves any file (an approval card with the file picker /
 * save dialog behind it — the script never touches the disk itself).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SCRIPT_DOCS, SCRIPT_EXAMPLES, SCRIPT_GROUP_TITLES, st, sx, type ScriptDoc } from '../../i18n/scriptText';
import { tr } from '../../i18n/core';
import { useLang } from '../../i18n/react';
import { SCRIPT_LIMITS, type ScriptLogLevel } from '../../script/protocol';
import { browserWorkerFactory, startScript, type ScriptRun } from '../../script/runner';
import { ScriptSession, type ScriptFileRequest, type ScriptIO } from '../../script/session';
import { openGeneratedDesign } from '../app/document';
import { DESIGN_EXTENSION, exportFile, pickTextFile } from '../app/files';
import { SimClient, createWorkerTransport, type RunHandle } from '../sim/client';
import { getState } from '../store';
import './script.css';

const STORAGE_KEY = 'machsim.script.v1';

interface LogLine {
  id: number;
  level: ScriptLogLevel | 'status' | 'ok';
  text: string;
  line?: number;
}

interface PlotShown {
  id: number;
  title: string;
  svg: string;
}

interface Ask {
  kind: 'open' | 'save';
  request: ScriptFileRequest;
  size: number;
  resolveOpen?: (v: { name: string; text: string } | null) => void;
  resolveSave?: (v: string | null) => void;
}

function loadCode(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeCode(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    /* private window or blocked storage: the text just is not remembered */
  }
}

const FILTERS: Record<ScriptFileRequest['kind'], { name: string; extensions: string[] }> = {
  design: { name: 'MachSim', extensions: ['msim'] },
  text: { name: 'Text', extensions: ['txt'] },
  csv: { name: 'CSV', extensions: ['csv'] },
  svg: { name: 'SVG', extensions: ['svg'] },
};

function sizeText(n: number): string {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} kB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ScriptPanel() {
  useLang();
  const [code, setCode] = useState(loadCode);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [plots, setPlots] = useState<PlotShown[]>([]);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<'out' | 'plots'>('out');
  const [ask, setAsk] = useState<Ask | null>(null);
  const [filter, setFilter] = useState('');
  const runRef = useRef<ScriptRun | null>(null);
  const simRef = useRef<SimClient | null>(null);
  const simRunRef = useRef<RunHandle | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  /** text of the file a script asked to save, held while the approval card is open */
  const pendingSave = useRef('');

  const push = useCallback((level: LogLine['level'], text: string, line?: number) => {
    seq.current += 1;
    const id = seq.current;
    setLogs((old) => [...old.slice(-1999), { id, level, text, ...(line !== undefined ? { line } : {}) }]);
  }, []);

  useEffect(() => {
    storeCode(code);
  }, [code]);
  useEffect(() => {
    logEnd.current?.scrollIntoView?.({ block: 'end' });
  }, [logs]);
  useEffect(
    () => () => {
      runRef.current?.stop();
      simRunRef.current?.cancel();
      simRef.current?.dispose();
    },
    [],
  );

  const gotoLine = useCallback((n: number) => {
    const el = editorRef.current;
    if (!el) return;
    const lines = el.value.split('\n');
    let start = 0;
    for (let i = 0; i < n - 1 && i < lines.length; i++) start += lines[i].length + 1;
    el.focus();
    el.setSelectionRange(start, start + (lines[n - 1]?.length ?? 0));
  }, []);

  const makeIO = useCallback(
    (): ScriptIO => ({
      openFile: (request) =>
        new Promise((resolve) => {
          setAsk({ kind: 'open', request, size: 0, resolveOpen: resolve });
        }),
      saveFile: (request) =>
        new Promise((resolve) => {
          setAsk({ kind: 'save', request: { kind: request.kind, name: request.name }, size: request.text.length, resolveSave: resolve });
          pendingSave.current = request.text;
        }),
      runNetlist: async (netlist) => {
        simRef.current ??= new SimClient(createWorkerTransport);
        const handle = simRef.current.run([netlist]);
        simRunRef.current = handle;
        try {
          const [results] = await handle.promise;
          return results;
        } finally {
          simRunRef.current = null;
        }
      },
      currentDesign: () => getState().design,
      showDesign: async (design, name) => {
        const ok = await openGeneratedDesign(design, name);
        if (!ok) throw new Error(st('noMoreDocs'));
        push('status', st('shownDesign', { name }));
      },
      onPlot: (plot, svg) => {
        seq.current += 1;
        const id = seq.current;
        setPlots((old) => [...old, { id, title: plot.title || st('plotTitle', { n: old.length + 1 }), svg }]);
        setTab('plots');
      },
    }),
    [push],
  );

  const run = useCallback(() => {
    if (running || !code.trim()) return;
    setRunning(true);
    setLogs([]);
    setPlots([]);
    setTab('out');
    setAsk(null);
    push('status', st('running'));
    const started = performance.now();
    const session = new ScriptSession(makeIO());
    const handle = startScript({ code, host: session, createWorker: browserWorkerFactory, onLog: (level, text) => push(level, text) });
    runRef.current = handle;
    void handle.done.then((out) => {
      runRef.current = null;
      setRunning(false);
      setAsk((a) => {
        a?.resolveOpen?.(null);
        a?.resolveSave?.(null);
        return null;
      });
      if (out.ok) {
        if (out.value !== null && out.value !== undefined) push('log', st('returned', { value: typeof out.value === 'string' ? out.value : JSON.stringify(out.value) }));
        push('ok', st('finished', { ms: Math.round(performance.now() - started) }));
      } else if (out.stopped) push('status', st('stopped'));
      else if (out.timedOut) push('error', st('timedOut', { sec: SCRIPT_LIMITS.timeoutMs / 1000 }));
      else push('error', st('failed', { line: out.line ? st('failedLine', { n: out.line }) : '', message: out.error ?? '' }), out.line);
    });
  }, [code, makeIO, push, running]);

  const stop = useCallback(() => {
    simRunRef.current?.cancel();
    runRef.current?.stop();
  }, []);

  const insert = (text: string) => {
    const el = editorRef.current;
    const start = el?.selectionStart ?? code.length;
    const end = el?.selectionEnd ?? code.length;
    const next = code.slice(0, start) + text + code.slice(end);
    setCode(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run();
    } else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      insert('  ');
    }
  };

  const chooseOpen = async () => {
    if (!ask?.resolveOpen) return;
    const f = await pickTextFile([DESIGN_EXTENSION, '.json']);
    if (!f) return;
    push('status', st('openedFile', { name: f.name }));
    ask.resolveOpen({ name: f.name, text: f.text });
    setAsk(null);
  };

  const chooseSave = async () => {
    if (!ask?.resolveSave) return;
    const ok = await exportFile(ask.request.name, pendingSave.current, FILTERS[ask.request.kind]);
    if (!ok) return;
    push('status', st('wroteFile', { name: ask.request.name }));
    ask.resolveSave(ask.request.name);
    pendingSave.current = '';
    setAsk(null);
  };

  const refuse = () => {
    ask?.resolveOpen?.(null);
    ask?.resolveSave?.(null);
    setAsk(null);
  };

  const q = filter.trim().toLowerCase();
  const shown = q ? SCRIPT_DOCS.filter((d) => d.name.toLowerCase().includes(q) || d.signature.toLowerCase().includes(q) || tr(d.text).toLowerCase().includes(q)) : SCRIPT_DOCS;
  const groups = new Map<ScriptDoc['group'], ScriptDoc[]>();
  for (const d of shown) groups.set(d.group, [...(groups.get(d.group) ?? []), d]);
  const docs = [...groups.entries()];

  return (
    <div className="msx-script">
      <p className="msx-script-intro">{st('intro')}</p>
      <div className="msx-script-main">
        <div className="msx-script-left">
          <div className="msx-script-bar">
            <button type="button" className="msx-script-btn is-primary" onClick={run} disabled={running || !code.trim()} title={st('runTip')}>
              {st('run')}
            </button>
            <button type="button" className="msx-script-btn" onClick={stop} disabled={!running} title={st('stopTip')}>
              {st('stop')}
            </button>
            <select
              className="msx-script-select"
              aria-label={st('examples')}
              title={st('examplesTip')}
              value=""
              onChange={(e) => {
                const ex = SCRIPT_EXAMPLES.find((x) => x.id === e.target.value);
                if (ex) setCode(tr(ex.code));
              }}
            >
              <option value="">{st('examples')}</option>
              {SCRIPT_EXAMPLES.map((ex) => (
                <option key={ex.id} value={ex.id} title={tr(ex.description)}>
                  {tr(ex.title)}
                </option>
              ))}
            </select>
            <button type="button" className="msx-script-btn" onClick={() => fileInput.current?.click()} title={st('openScriptTip')}>
              {st('openScript')}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".js,.mjs,.txt"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void f.text().then(setCode);
              }}
            />
            <button type="button" className="msx-script-btn" onClick={() => void exportFile('script.js', code, { name: 'JavaScript', extensions: ['js'] })} disabled={!code.trim()} title={st('saveScriptTip')}>
              {st('saveScript')}
            </button>
          </div>
          <textarea
            ref={editorRef}
            className="msx-script-editor"
            value={code}
            spellCheck={false}
            aria-label={st('editorLabel')}
            placeholder={st('placeholder')}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={onKey}
          />
          {ask && (
            <div className="msx-script-ask" role="alertdialog" aria-label={st('askTitle')}>
              <strong>{st('askTitle')}</strong>
              <span>
                {ask.kind === 'open'
                  ? st('askOpen', { hint: ask.request.name ? st('askOpenHint', { name: ask.request.name }) : '' })
                  : st('askSave', { name: ask.request.name, size: sizeText(ask.size) })}
              </span>
              <small>{st('askNever')}</small>
              <div className="msx-script-ask-buttons">
                <button type="button" className="msx-script-btn is-primary" onClick={() => void (ask.kind === 'open' ? chooseOpen() : chooseSave())}>
                  {ask.kind === 'open' ? st('choose') : st('saveAs')}
                </button>
                <button type="button" className="msx-script-btn" onClick={refuse}>
                  {st('refuse')}
                </button>
              </div>
            </div>
          )}
          <div className="msx-script-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'out'} className={tab === 'out' ? 'is-active' : ''} onClick={() => setTab('out')}>
              {st('outputTab')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'plots'} className={tab === 'plots' ? 'is-active' : ''} onClick={() => setTab('plots')}>
              {st('plotsTab')}
              {plots.length > 0 ? ` (${plots.length})` : ''}
            </button>
            <span className="msx-script-spacer" />
            <button type="button" className="msx-script-link" onClick={() => setLogs([])} disabled={!logs.length}>
              {st('clearLog')}
            </button>
          </div>
          {tab === 'out' ? (
            <div className="msx-script-log" role="log" aria-live="polite">
              {logs.length === 0 && <div className="msx-dim">{st('noOutput')}</div>}
              {logs.map((l) => (
                <div key={l.id} className={`msx-script-line is-${l.level}`}>
                  {l.text}
                  {l.line !== undefined && (
                    <button type="button" className="msx-script-link" onClick={() => gotoLine(l.line!)}>
                      {st('line', { n: l.line })}
                    </button>
                  )}
                </div>
              ))}
              <div ref={logEnd} />
            </div>
          ) : (
            <div className="msx-script-plots">
              {plots.length === 0 && <div className="msx-dim">{st('noPlots')}</div>}
              {plots.map((p) => (
                <figure key={p.id} className="msx-script-plot">
                  <img alt={p.title} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.svg)}`} />
                  <figcaption>
                    {p.title}{' '}
                    <button type="button" className="msx-script-link" onClick={() => void exportFile('plot.svg', p.svg, FILTERS.svg)}>
                      {st('copySvg')}
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
        <aside className="msx-script-api" aria-label={st('apiTitle')}>
          <h3>{st('apiTitle')}</h3>
          <p className="msx-dim">{st('apiIntro')}</p>
          <input type="search" className="msx-script-search" value={filter} placeholder={st('apiSearch')} aria-label={st('apiSearch')} onChange={(e) => setFilter(e.target.value)} />
          {docs.map(([group, list]) => (
            <section key={group}>
              <h4>{tr(SCRIPT_GROUP_TITLES[group])}</h4>
              {list.map((d) => (
                <button key={d.name} type="button" className="msx-script-doc" title={st('apiTip')} onClick={() => insert(`${d.signature.split(' · ')[0]}\n`)}>
                  <code>{d.signature}</code>
                  <span>{tr(d.text)}</span>
                </button>
              ))}
            </section>
          ))}
          <p className="msx-dim">{sx('cliUsage')}</p>
        </aside>
      </div>
    </div>
  );
}
