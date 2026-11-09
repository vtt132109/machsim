/**
 * Symbol editor (Tools › Symbol editor, or "Draw / edit symbol" in the component wizard).
 *
 * Tools: select / move (drag; arrow keys nudge), line, rectangle, circle, arc, polyline (click
 * points, double-click or Enter to finish), text, pin (click: a pin with its stub pointing away
 * from the body, direction from the pin-direction control). Everything snaps to the grid (pins
 * always to 10 so they land on the schematic grid). The side panel edits the selected shape or pin.
 * Symbols can start from a template and be imported / exported as `.msimsym` files.
 *
 * Editing like a drawing program (round 3 step 7): drag a box with the select tool to select
 * several items, Shift-click to add one, drag a square handle of the selected shape to resize it,
 * and Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste inside the editor and between symbols. The arc
 * tool drags from the centre outwards (radius and start angle; the angles are then editable).
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { PartDef, PinType, SymbolDef, SymbolPrim } from '../../library/types';
import { SYMBOL_TEMPLATES, templateSymbol, type SymbolTemplateId } from '../../library/custom/templates';
import { PIN_TYPES } from '../../library/custom/types';
import { Dialog } from '../common/Dialog';
import { alertDialog, openCustomDialog, promptText } from '../common/dialogs';
import { SymbolBody } from '../editor/scene';
import { t } from '../../i18n';
import {
  addPin,
  addPrim,
  arcPrim,
  copyTargets,
  deleteTargets,
  fitBBox,
  hasTarget,
  hitTest,
  moveTargets,
  pasteFragment,
  pinIssues,
  parseSymbolFile,
  replacePrim,
  resizeTarget,
  snap,
  symbolToFile,
  targetHandles,
  targetsInRect,
  toggleTarget,
  updatePin,
  type PinDir,
  type SymbolFragment,
  type SymTarget,
} from './symbolEditModel';
import { downloadText, pickTextFile } from './fileIo';
import './parts.css';

type Tool = 'select' | 'line' | 'rect' | 'circle' | 'arc' | 'polyline' | 'text' | 'pin';
const TOOLS: Tool[] = ['select', 'line', 'rect', 'circle', 'arc', 'polyline', 'text', 'pin'];
/** The symbol editor's own clipboard (kept between sessions of the dialog). */
let symbolClipboard: SymbolFragment | null = null;
const DIRS: PinDir[] = ['left', 'right', 'up', 'down'];
const ORIGIN = { x: 0, y: 0, rotation: 0 as const, mirror: false };

/** View box around a symbol box (and around `prev`, so it only grows). */
function viewFor(b: SymbolDef['bbox'], prev?: { x: number; y: number; w: number; h: number }) {
  let x0 = Math.min(b.x - 40, -80);
  let y0 = Math.min(b.y - 40, -60);
  let x1 = Math.max(b.x + b.w + 40, 80);
  let y1 = Math.max(b.y + b.h + 40, 60);
  if (prev) {
    x0 = Math.min(x0, prev.x);
    y0 = Math.min(y0, prev.y);
    x1 = Math.max(x1, prev.x + prev.w);
    y1 = Math.max(y1, prev.y + prev.h);
  }
  const r = (v: number, f: (n: number) => number) => f(v / 10) * 10;
  return { x: r(x0, Math.floor), y: r(y0, Math.floor), w: r(x1, Math.ceil) - r(x0, Math.floor), h: r(y1, Math.ceil) - r(y0, Math.floor) };
}

/** A throw-away PartDef for rendering a bare symbol. */
export function symbolDef(symbol: SymbolDef, name = ''): PartDef {
  return { id: 'custom:preview', name, group: 'misc', family: '', description: '', prefix: 'U', symbol, params: [] };
}

interface Draft {
  kind: Tool;
  start: { x: number; y: number };
  end: { x: number; y: number };
  points?: number[];
}

function draftPrim(d: Draft): SymbolPrim | null {
  const { start: a, end: b } = d;
  switch (d.kind) {
    case 'line':
      return a.x === b.x && a.y === b.y ? null : { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    case 'rect':
      return a.x === b.x || a.y === b.y ? null : { kind: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
    case 'circle': {
      const r = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
      return r > 0 ? { kind: 'circle', cx: a.x, cy: a.y, r } : null;
    }
    case 'arc':
      return arcPrim(a, b);
    case 'polyline':
      return d.points && d.points.length >= 4 ? { kind: 'polyline', points: [...d.points, b.x, b.y] } : null;
    default:
      return null;
  }
}

export function SymbolEditor({ initial, name, close, onDone }: { initial: SymbolDef; name?: string; close: () => void; onDone?: (s: SymbolDef) => void }) {
  const [sym, setSym] = useState<SymbolDef>(() => fitBBox(initial));
  const [tool, setTool] = useState<Tool>('select');
  const [sel, setSel] = useState<SymTarget | null>(null);
  /** every selected item (the first one is `sel`, which the side panel edits) */
  const [multi, setMulti] = useState<SymTarget[]>([]);
  const [box, setBox] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [handle, setHandle] = useState<{ id: string; target: SymTarget } | null>(null);
  const [grid, setGrid] = useState(10);
  const [zoom, setZoom] = useState(4);
  const [dir, setDir] = useState<PinDir>('left');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<{ from: { x: number; y: number }; moved: boolean } | null>(null);
  const [undo, setUndo] = useState<SymbolDef[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const issues = useMemo(() => pinIssues(sym), [sym]);

  const commit = (next: SymbolDef) => {
    setUndo((u) => [...u.slice(-49), sym]);
    setSym(fitBBox(next));
  };

  // the view: the symbol's box plus a margin (at least 160 × 120 units); it only grows while
  // drawing, so the drawing never jumps under the pointer
  const [view, setView] = useState(() => viewFor(sym.bbox));
  useEffect(() => {
    const b = sym.bbox;
    if (b.x < view.x + 10 || b.y < view.y + 10 || b.x + b.w > view.x + view.w - 10 || b.y + b.h > view.y + view.h - 10) setView(viewFor(b, view));
  }, [sym.bbox, view]);

  const toLocal = (e: RPointerEvent | React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return { x: view.x + ((e.clientX - r.left) / r.width) * view.w, y: view.y + ((e.clientY - r.top) / r.height) * view.h };
  };
  const snapped = (p: { x: number; y: number }, g = grid) => ({ x: snap(p.x, g), y: snap(p.y, g) });

  const onDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    // no text selection while dragging over pin names
    e.preventDefault();
    (e.currentTarget as Element).closest<HTMLElement>('.ms-symed')?.focus();
    const p = toLocal(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'select') {
      // a resize handle of the selected shape wins over everything else
      if (sel) {
        const h = targetHandles(sym, sel).find((x) => Math.hypot(x.x - p.x, x.y - p.y) <= 5);
        if (h) {
          setUndo((u) => [...u.slice(-49), sym]);
          setHandle({ id: h.id, target: sel });
          return;
        }
      }
      const hit = hitTest(sym, p.x, p.y, 4);
      if (!hit) {
        if (!e.shiftKey) {
          setSel(null);
          setMulti([]);
        }
        setBox({ a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y } });
        return;
      }
      if (e.shiftKey) {
        const next = toggleTarget(multi.length ? multi : sel ? [sel] : [], hit);
        setMulti(next);
        setSel(next[0] ?? null);
        return;
      }
      const keep = hasTarget(multi, hit) ? multi : [hit];
      setMulti(keep.length > 1 ? keep : []);
      setSel(hit);
      setDrag({ from: snapped(p, hit.kind === 'pin' ? 10 : grid), moved: false });
      return;
    }
    if (tool === 'pin') {
      const at = snapped(p, 10);
      const r = addPin(sym, at.x, at.y, dir);
      commit(r.symbol);
      setSel({ kind: 'pin', index: r.index });
      return;
    }
    if (tool === 'text') {
      const at = snapped(p);
      void promptText({ title: t('symed.tool.text'), label: t('symed.textPrompt'), initial: '' }).then((text) => {
        if (text && text.trim()) commit(addPrim(sym, { kind: 'text', x: at.x, y: at.y, text: text.trim(), size: 8, anchor: 'middle' }));
      });
      return;
    }
    const at = snapped(p);
    if (tool === 'polyline') {
      setDraft((d) => (d ? { ...d, points: [...(d.points ?? []), at.x, at.y], end: at } : { kind: 'polyline', start: at, end: at, points: [at.x, at.y] }));
      return;
    }
    setDraft({ kind: tool, start: at, end: at });
  };

  const onMove = (e: RPointerEvent) => {
    const p = toLocal(e);
    if (handle) {
      const at = snapped(p, grid);
      setSym((s0) => fitBBox(resizeTarget(s0, handle.target, handle.id, at.x, at.y)));
      return;
    }
    if (box) {
      setBox({ ...box, b: { x: p.x, y: p.y } });
      return;
    }
    if (draft) setDraft({ ...draft, end: snapped(p) });
    else if (drag && sel) {
      const g = sel.kind === 'pin' ? 10 : grid;
      const at = snapped(p, g);
      const dx = at.x - drag.from.x;
      const dy = at.y - drag.from.y;
      if (dx || dy) {
        if (!drag.moved) setUndo((u) => [...u.slice(-49), sym]);
        const targets = multi.length ? multi : [sel];
        setSym((s0) => fitBBox(moveTargets(s0, targets, dx, dy)));
        setDrag({ from: at, moved: true });
      }
    }
  };

  const onUp = () => {
    setDrag(null);
    if (handle) {
      setHandle(null);
      return;
    }
    if (box) {
      const rect = { x: Math.min(box.a.x, box.b.x), y: Math.min(box.a.y, box.b.y), w: Math.abs(box.b.x - box.a.x), h: Math.abs(box.b.y - box.a.y) };
      setBox(null);
      if (rect.w > 2 || rect.h > 2) {
        const found = targetsInRect(sym, rect);
        setMulti(found.length > 1 ? found : []);
        setSel(found[0] ?? null);
      }
      return;
    }
    if (draft && draft.kind !== 'polyline') {
      const prim = draftPrim(draft);
      if (prim) commit(addPrim(sym, prim));
      setDraft(null);
    }
  };

  const finishPolyline = () => {
    if (draft?.kind === 'polyline' && draft.points && draft.points.length >= 4) commit(addPrim(sym, { kind: 'polyline', points: draft.points }));
    setDraft(null);
  };

  const removeSelected = () => {
    const targets = multi.length ? multi : sel ? [sel] : [];
    if (!targets.length) return;
    commit(deleteTargets(sym, targets));
    setSel(null);
    setMulti([]);
  };

  const selection = (): SymTarget[] => (multi.length ? multi : sel ? [sel] : []);

  const doCopy = (cut = false) => {
    const targets = selection();
    if (!targets.length) return;
    symbolClipboard = copyTargets(sym, targets);
    if (cut) {
      commit(deleteTargets(sym, targets));
      setSel(null);
      setMulti([]);
    }
  };

  const doPaste = () => {
    if (!symbolClipboard) return;
    const r = pasteFragment(sym, symbolClipboard, grid || 10, grid || 10);
    commit(r.symbol);
    setMulti(r.targets.length > 1 ? r.targets : []);
    setSel(r.targets[0] ?? null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeSelected();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'x')) {
      e.preventDefault();
      doCopy(e.key === 'x');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      doPaste();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      const all: SymTarget[] = [...sym.prims.map((_p, index) => ({ kind: 'prim' as const, index })), ...sym.pins.map((_p, index) => ({ kind: 'pin' as const, index }))];
      setMulti(all);
      setSel(all[0] ?? null);
    } else if (e.key === 'Enter') finishPolyline();
    else if (e.key === 'z' && (e.ctrlKey || e.metaKey) && undo.length) {
      e.preventDefault();
      setSym(undo[undo.length - 1]);
      setUndo((u) => u.slice(0, -1));
      setSel(null);
    } else if (sel && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const targets = selection();
      const step = targets.every((x) => x.kind === 'pin') ? 10 : grid || 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as 'ArrowLeft']!;
      commit(moveTargets(sym, targets, d[0], d[1]));
    }
  };

  useEffect(() => {
    if (tool !== 'polyline') setDraft(null);
  }, [tool]);

  const doImport = async () => {
    const f = await pickTextFile('.msimsym,.json');
    if (!f) return;
    try {
      const r = parseSymbolFile(f.text);
      commit(r.symbol);
      setSel(null);
    } catch (e) {
      await alertDialog({ title: t('symed.importFailed'), message: e instanceof Error ? e.message : String(e) });
    }
  };

  const fromTemplate = (id: SymbolTemplateId) => {
    commit(templateSymbol(id));
    setSel(null);
  };

  const preview = draft ? draftPrim(draft) : null;
  const def = symbolDef(sym, name);
  const selPrim = sel?.kind === 'prim' ? sym.prims[sel.index] : undefined;
  const selPin = sel?.kind === 'pin' ? sym.pins[sel.index] : undefined;

  return (
    <Dialog
      title={name ? t('symed.titleOf', { name }) : t('symed.title')}
      onClose={close}
      width={900}
      className="ms-symed-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={doImport} title={t('tip.symed.import')}>
            {t('symed.import')}
          </button>
          <button type="button" className="ms-btn" onClick={() => downloadText(symbolToFile(sym, name), `${(name || 'symbol').replace(/[^\w.-]+/g, '_')}.msimsym`, 'application/json')} title={t('tip.symed.export')}>
            {t('symed.export')}
          </button>
          <span className="ms-wiz-spacer" />
          <button type="button" className="ms-btn" onClick={close} title={t('common.cancel')}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="ms-btn ms-btn-primary"
            disabled={sym.pins.length === 0 || issues.some((i) => i.code !== 'offGrid')}
            title={t('tip.symed.done')}
            onClick={() => {
              onDone?.(fitBBox(sym));
              close();
            }}
          >
            {onDone ? t('symed.done') : t('common.close')}
          </button>
        </>
      }
    >
      <div className="ms-symed" onKeyDown={onKeyDown} tabIndex={-1}>
        <div className="ms-symed-tools" role="toolbar" aria-label={t('symed.tools')}>
          {TOOLS.map((k) => (
            <button key={k} type="button" className={`ms-btn ms-btn-small${tool === k ? ' ms-btn-primary' : ''}`} aria-pressed={tool === k} title={t(`tip.symed.${k}`)} onClick={() => setTool(k)}>
              {t(`symed.tool.${k}`)}
            </button>
          ))}
          <span className="ms-symed-sep" />
          <label className="ms-symed-inline" title={t('tip.symed.pinDir')}>
            {t('symed.pinDir')}
            <select className="ms-input" value={dir} onChange={(e) => setDir(e.target.value as PinDir)} title={t('tip.symed.pinDir')}>
              {DIRS.map((d) => (
                <option key={d} value={d}>
                  {t(`pinDir.${d}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="ms-symed-inline" title={t('tip.symed.grid')}>
            {t('symed.grid')}
            <select className="ms-input" value={grid} onChange={(e) => setGrid(Number(e.target.value))} title={t('tip.symed.grid')}>
              {[10, 5, 1].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="ms-btn ms-btn-small" title={t('tip.symed.zoomOut')} onClick={() => setZoom((z) => Math.max(2, z - 1))}>
            −
          </button>
          <button type="button" className="ms-btn ms-btn-small" title={t('tip.symed.zoomIn')} onClick={() => setZoom((z) => Math.min(8, z + 1))}>
            +
          </button>
          <button type="button" className="ms-btn ms-btn-small" disabled={!sel} title={t('tip.symed.delete')} onClick={removeSelected}>
            {t('symed.delete')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" disabled={!sel} title={t('tip.symed.copy')} onClick={() => doCopy(false)}>
            {t('symed.copy')}
          </button>
          <button type="button" className="ms-btn ms-btn-small" disabled={!symbolClipboard} title={t('tip.symed.paste')} onClick={doPaste}>
            {t('symed.paste')}
          </button>
          {draft?.kind === 'polyline' ? (
            <button type="button" className="ms-btn ms-btn-small" title={t('tip.symed.finishPolyline')} onClick={finishPolyline}>
              {t('symed.finishPolyline')}
            </button>
          ) : null}
        </div>
        <div className="ms-symed-main">
          <div className="ms-symed-canvas">
            <svg
              ref={svgRef}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              width={view.w * zoom}
              height={view.h * zoom}
              role="img"
              aria-label={t('symed.canvas')}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onDoubleClick={finishPolyline}
              className={`ms-symed-svg ms-symed-tool-${tool}`}
            >
              {grid >= 5 ? (
                <g className="ms-symed-grid">
                  {Array.from({ length: Math.floor(view.w / 10) + 1 }, (_, i) => Math.ceil(view.x / 10) * 10 + i * 10).map((x) => (
                    <line key={`x${x}`} x1={x} y1={view.y} x2={x} y2={view.y + view.h} className={x === 0 ? 'ms-symed-axis' : undefined} />
                  ))}
                  {Array.from({ length: Math.floor(view.h / 10) + 1 }, (_, i) => Math.ceil(view.y / 10) * 10 + i * 10).map((y) => (
                    <line key={`y${y}`} x1={view.x} y1={y} x2={view.x + view.w} y2={y} className={y === 0 ? 'ms-symed-axis' : undefined} />
                  ))}
                </g>
              ) : null}
              <g className="ms-scene">
                <g className="ms-part">
                  <SymbolBody def={def} o={ORIGIN} />
                  {preview ? <SymbolBody def={symbolDef({ ...sym, prims: [preview], pins: [] })} o={ORIGIN} /> : null}
                </g>
              </g>
              {selPrim ? <rect className="ms-symed-selbox" {...boxOf(selPrim)} /> : null}
              {multi
                .filter((x) => x.kind === 'prim' && sym.prims[x.index])
                .map((x) => (
                  <rect key={`m${x.index}`} className="ms-symed-selbox" {...boxOf(sym.prims[x.index])} />
                ))}
              {sel && !multi.length
                ? targetHandles(sym, sel).map((h) => <rect key={h.id} className="ms-symed-handle" x={h.x - 2.5} y={h.y - 2.5} width={5} height={5} />)
                : null}
              {box ? (
                <rect
                  className="ms-symed-band"
                  x={Math.min(box.a.x, box.b.x)}
                  y={Math.min(box.a.y, box.b.y)}
                  width={Math.abs(box.b.x - box.a.x)}
                  height={Math.abs(box.b.y - box.a.y)}
                />
              ) : null}
              {sym.pins.map((p, i) => (
                <g key={`${p.name}-${i}`} className={`ms-symed-pin${sel?.kind === 'pin' && sel.index === i ? ' ms-symed-pin-sel' : ''}${issues.some((x) => x.index === i) ? ' ms-symed-pin-bad' : ''}`}>
                  <circle cx={p.x} cy={p.y} r={2.2} />
                  <text x={p.x + (p.dir === 'right' ? 3 : p.dir === 'left' ? -3 : 3)} y={p.y - 3} textAnchor={p.dir === 'left' ? 'end' : 'start'} fontSize={5}>
                    {p.name}
                  </text>
                </g>
              ))}
            </svg>
          </div>
          <aside className="ms-symed-side">
            <h4>{t('symed.props')}</h4>
            {selPin && sel ? (
              <PinProps pin={selPin} onChange={(patch) => commit(updatePin(sym, sel.index, patch))} />
            ) : selPrim && sel ? (
              <PrimProps prim={selPrim} onChange={(p) => commit(replacePrim(sym, sel.index, p))} />
            ) : (
              <p className="ms-hint">{t('symed.noSelection')}</p>
            )}
            {issues.length ? (
              <ul className="ms-wiz-issues">
                {issues.map((x, i) => (
                  <li key={i}>{t(`symed.issue.${x.code}`, { pin: sym.pins[x.index]?.name ?? '' })}</li>
                ))}
              </ul>
            ) : null}
            <h4>{t('symed.template')}</h4>
            <select className="ms-input" value="" title={t('tip.symed.template')} onChange={(e) => e.target.value && fromTemplate(e.target.value as SymbolTemplateId)}>
              <option value="">{t('symed.templatePick')}</option>
              {SYMBOL_TEMPLATES.map((tp) => (
                <option key={tp.id} value={tp.id}>
                  {t(`wiz.template.${tp.id}`)}
                </option>
              ))}
            </select>
            <p className="ms-hint">{t('symed.hint')}</p>
          </aside>
        </div>
      </div>
    </Dialog>
  );
}

function boxOf(p: SymbolPrim): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  switch (p.kind) {
    case 'line':
      xs.push(p.x1, p.x2);
      ys.push(p.y1, p.y2);
      break;
    case 'rect':
      xs.push(p.x, p.x + p.w);
      ys.push(p.y, p.y + p.h);
      break;
    case 'circle':
    case 'arc':
      xs.push(p.cx - p.r, p.cx + p.r);
      ys.push(p.cy - p.r, p.cy + p.r);
      break;
    case 'polyline':
      p.points.forEach((v, i) => (i % 2 ? ys : xs).push(v));
      break;
    case 'text': {
      const w = p.text.length * (p.size ?? 9) * 0.6;
      xs.push(p.x - w / 2, p.x + w / 2);
      ys.push(p.y - (p.size ?? 9), p.y);
      break;
    }
    default:
      xs.push(0);
      ys.push(0);
  }
  const x0 = Math.min(...xs) - 2;
  const y0 = Math.min(...ys) - 2;
  return { x: x0, y: y0, width: Math.max(...xs) - x0 + 2, height: Math.max(...ys) - y0 + 2 };
}

function NumberCell({ label, value, onChange, tip }: { label: string; value: number; onChange: (v: number) => void; tip: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="ms-cfield ms-cfield-row">
      <span className="ms-cfield-label">{label}</span>
      <input
        className="ms-input"
        value={text}
        title={tip}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = Number(text);
          if (Number.isFinite(v)) onChange(v);
          else setText(String(value));
        }}
      />
    </label>
  );
}

function PrimProps({ prim, onChange }: { prim: SymbolPrim; onChange: (p: SymbolPrim) => void }) {
  const num = (key: string, label: string) => <NumberCell key={key} label={label} tip={t('tip.symed.coord')} value={(prim as unknown as Record<string, number>)[key]} onChange={(v) => onChange({ ...prim, [key]: v } as SymbolPrim)} />;
  const fillable = prim.kind === 'rect' || prim.kind === 'circle' || prim.kind === 'polyline';
  return (
    <div className="ms-symed-props">
      <div className="ms-hint">{t(`symed.prim.${prim.kind}`)}</div>
      {prim.kind === 'line' ? [num('x1', 'x1'), num('y1', 'y1'), num('x2', 'x2'), num('y2', 'y2')] : null}
      {prim.kind === 'rect' ? [num('x', t('symed.x')), num('y', t('symed.y')), num('w', t('symed.w')), num('h', t('symed.h'))] : null}
      {prim.kind === 'circle' || prim.kind === 'arc' ? [num('cx', t('symed.x')), num('cy', t('symed.y')), num('r', t('symed.r'))] : null}
      {prim.kind === 'arc' ? (
        <>
          <NumberCell label={t('symed.arcStart')} tip={t('tip.symed.arcAngle')} value={prim.start} onChange={(v) => onChange({ ...prim, start: v })} />
          <NumberCell label={t('symed.arcEnd')} tip={t('tip.symed.arcAngle')} value={prim.end} onChange={(v) => onChange({ ...prim, end: v })} />
        </>
      ) : null}
      {prim.kind === 'text' ? (
        <>
          <label className="ms-cfield">
            <span className="ms-cfield-label">{t('symed.text')}</span>
            <input className="ms-input" value={prim.text} title={t('tip.symed.textValue')} onChange={(e) => onChange({ ...prim, text: e.target.value })} />
          </label>
          {num('x', t('symed.x'))}
          {num('y', t('symed.y'))}
          <NumberCell label={t('symed.size')} tip={t('tip.symed.size')} value={prim.size ?? 9} onChange={(v) => onChange({ ...prim, size: v })} />
        </>
      ) : null}
      {fillable ? (
        <label className="ms-cfield ms-cfield-check">
          <input type="checkbox" checked={!!(prim as { fill?: unknown }).fill} title={t('tip.symed.fill')} onChange={(e) => onChange({ ...prim, fill: e.target.checked || undefined } as SymbolPrim)} />
          <span>{t('symed.fill')}</span>
        </label>
      ) : null}
    </div>
  );
}

function PinProps({ pin, onChange }: { pin: SymbolDef['pins'][number]; onChange: (p: Partial<SymbolDef['pins'][number]>) => void }) {
  return (
    <div className="ms-symed-props">
      <label className="ms-cfield ms-cfield-row">
        <span className="ms-cfield-label">{t('wiz.pin.name')}</span>
        <input className="ms-input" value={pin.name} title={t('tip.wiz.pinName')} onChange={(e) => onChange({ name: e.target.value })} />
      </label>
      <label className="ms-cfield ms-cfield-row">
        <span className="ms-cfield-label">{t('wiz.pin.number')}</span>
        <input className="ms-input" value={pin.number ?? ''} title={t('tip.wiz.pinNumber')} onChange={(e) => onChange({ number: e.target.value })} />
      </label>
      <label className="ms-cfield ms-cfield-row">
        <span className="ms-cfield-label">{t('wiz.pin.label')}</span>
        <input className="ms-input" value={pin.label ?? ''} title={t('tip.wiz.pinLabel')} onChange={(e) => onChange({ label: e.target.value || undefined })} />
      </label>
      <label className="ms-cfield ms-cfield-row">
        <span className="ms-cfield-label">{t('wiz.pin.type')}</span>
        <select className="ms-input" value={pin.type ?? 'passive'} title={t('tip.wiz.pinType')} onChange={(e) => onChange({ type: e.target.value as PinType })}>
          {PIN_TYPES.map((k) => (
            <option key={k} value={k}>
              {t(`pinType.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="ms-cfield ms-cfield-row">
        <span className="ms-cfield-label">{t('symed.pinDir')}</span>
        <select className="ms-input" value={pin.dir ?? 'left'} title={t('tip.symed.pinDir')} onChange={(e) => onChange({ dir: e.target.value as PinDir })}>
          {DIRS.map((d) => (
            <option key={d} value={d}>
              {t(`pinDir.${d}`)}
            </option>
          ))}
        </select>
      </label>
      <NumberCell label={t('symed.x')} tip={t('tip.symed.coord')} value={pin.x} onChange={(v) => onChange({ x: v })} />
      <NumberCell label={t('symed.y')} tip={t('tip.symed.coord')} value={pin.y} onChange={(v) => onChange({ y: v })} />
    </div>
  );
}

/** Open the symbol editor on `symbol`; `onDone` receives the edited symbol (omit for a stand-alone session). */
export function openSymbolEditorDialog(symbol: SymbolDef, opts: { name?: string; onDone?: (s: SymbolDef) => void } = {}): void {
  openCustomDialog((close) => <SymbolEditor initial={symbol} name={opts.name} close={close} onDone={opts.onDone} />);
}
