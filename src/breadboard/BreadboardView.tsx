/**
 * <BreadboardView> — interactive 3D virtual breadboard for a design.
 *
 *   <BreadboardView design={design} onChange={(layout) => setDesign({ ...design, breadboard: layout })}
 *                   indicatorLevels={levels} running={simRunning}
 *                   selectedRefdes={sel} onSelect={setSel} />
 *
 * The layout is controlled: it is read from design.breadboard (an empty full-size board when
 * absent) and every edit is reported through onChange. Undo / redo history is kept inside the
 * view. Features: orbit / pan / zoom with top, isometric and front presets; hovering a hole
 * highlights its strip and shows the hole name, the strip and the schematic net(s) on it; parts
 * bin (click a part, then a hole; R rotates; drag to move; Delete removes); clip leads for
 * off-board sources / instruments; jumper-wire tool with colour picker; auto-arrange; circuit
 * check panel with highlights; step-by-step assembly guide; PNG screenshot; full keyboard
 * control (arrow keys move a hole cursor, Enter acts, R / Delete / Esc / Ctrl+Z / Ctrl+Y,
 * W = wire tool, 1 / 2 / 3 = views). All labels are Vietnamese with an English toggle.
 *
 * indicatorLevels: refdes → brightness 0..1 (LED, lamp, buzzer); 7-segment displays also accept
 * `${refdes}.a` … `${refdes}.dp` per segment, `${refdes}.digit` (0–15) or an integer bit mask
 * (> 1) on the refdes key; bar graphs accept `${refdes}.1` … `${refdes}.10`. Levels are shown
 * while `running` is true (default: true when levels are given).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { Design } from '../model/types';
import { buildNetlist } from '../model/netlister';
import type { BreadboardHole, BreadboardLayout, BoardKind } from './types';
import { autoPlace, WIRE_COLORS } from './autoplace';
import { compareWithSchematic, expectedNets, type BreadboardIssue } from './compare';
import { netOfHole } from './connectivity';
import {
  addClip,
  addWire,
  anchorOf,
  binContents,
  ensureLayout,
  inferRotation,
  itemsAtHole,
  movePart,
  placePart,
  previewPlacement,
  removeClip,
  removePart,
  removeWire,
  rotatePart,
  setBoardKind,
  setSplitRails,
} from './editing';
import { describeHole, describeStrip, gridToHole, holeGrid, holeName, sameHole, stepHole, stripIdOf } from './geometry';
import { buildGuide } from './guide';
import { canRedo, canUndo, createHistory, pushHistory, redo, resetHistory, undo, type History } from './history';
import { fill, PALETTE_NAMES, tr, UI, type Lang, type LocalizedText } from '../i18n/breadboard';
import { BreadboardScene, type GhostLead, type HoleMarker, type ViewPreset } from './three/scene';
import { GuidePanel, IssuesPanel, PartsBin } from './ui/panels';
import './ui/breadboard.css';
import { useLang } from '../i18n/react';
import { LANG_NAMES, LANGS, setLang as setAppLang } from '../i18n/core';

export interface BreadboardViewProps {
  design: Design;
  onChange(layout: BreadboardLayout): void;
  indicatorLevels?: Record<string, number>;
  running?: boolean;
  selectedRefdes?: string | null;
  onSelect?(refdes: string | null): void;
  /**
   * UI language. Omitted (the app): follow the application language (src/i18n), and the
   * language box switches the whole app. Given (stand-alone demo): initial language of the view.
   */
  lang?: Lang;
  /** show the language box in the toolbar (default true; the app sets its language in Options) */
  languageSwitch?: boolean;
  className?: string;
  style?: CSSProperties;
}

const PALETTE = ['#d32f2f', '#212121', '#1565c0', '#fdd835', '#2e7d32', '#ef6c00', '#7b1fa2', '#eceff1'];


type Panel = 'none' | 'check' | 'guide';
type LocalSelection = { kind: 'wire' | 'clip'; id: string } | null;

interface DragState {
  refdes: string;
  startHole: BreadboardHole;
  anchor: BreadboardHole;
  x: number;
  y: number;
  moved: boolean;
  /** anchor hole the part would move to (kept here too: pointerup may run before a re-render) */
  target: BreadboardHole | null;
}

export function BreadboardView({ design, onChange, indicatorLevels, running, selectedRefdes, onSelect, lang: initialLang, languageSwitch = true, className, style }: BreadboardViewProps) {
  const appLang = useLang();
  const [localLang, setLocalLang] = useState<Lang>(initialLang ?? appLang);
  const lang = initialLang === undefined ? appLang : localLang;
  const setLang = (l: Lang) => (initialLang === undefined ? setAppLang(l) : setLocalLang(l));
  const t = useCallback((x: LocalizedText) => tr(x, lang), [lang]);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BreadboardScene | null>(null);
  const [noWebgl, setNoWebgl] = useState(false);
  const [lost, setLost] = useState(false);

  const [tool, setTool] = useState<'select' | 'wire'>('select');
  const [placing, setPlacing] = useState<{ refdes: string; rotation: number } | null>(null);
  const [clipping, setClipping] = useState<{ refdes: string; pin: string } | null>(null);
  const [wireStart, setWireStart] = useState<BreadboardHole | null>(null);
  const [wireColor, setWireColor] = useState(PALETTE[3]);
  const [hover, setHover] = useState<BreadboardHole | null>(null);
  const [cursor, setCursor] = useState<BreadboardHole | null>(null);
  const [localSel, setLocalSel] = useState<LocalSelection>(null);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [activeIssue, setActiveIssue] = useState<string | null>(null);
  const [guideIndex, setGuideIndex] = useState(0);
  const [message, setMessage] = useState<LocalizedText | null>(null);
  const [dragTarget, setDragTarget] = useState<BreadboardHole | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const downRef = useRef<{ x: number; y: number } | null>(null);

  const selected = selectedRefdes !== undefined ? selectedRefdes : ownSelected;
  const select = useCallback(
    (refdes: string | null) => {
      setOwnSelected(refdes);
      if (refdes) setLocalSel(null);
      onSelect?.(refdes);
    },
    [onSelect],
  );

  // ---- derived data ------------------------------------------------------------------------
  const layout = useMemo(() => ensureLayout(design), [design]);
  const build = useMemo(() => buildNetlist(design, { includeAnalysis: false }), [design]);
  const check = useMemo(() => compareWithSchematic(design, layout, { build }), [design, layout, build]);
  const bin = useMemo(() => binContents(design, layout), [design, layout]);
  const guide = useMemo(() => (panel === 'guide' ? buildGuide(design, layout, { build, check }) : []), [panel, design, layout, build, check]);
  const boards = useMemo(() => new Map(layout.boards.map((b) => [b.id, b])), [layout]);
  const multiBoard = layout.boards.length > 1;

  // ---- history -----------------------------------------------------------------------------
  const historyRef = useRef<History<BreadboardLayout>>(createHistory(layout));
  const [, setHistoryTick] = useState(0);
  useEffect(() => {
    // a layout that did not come from this view (new design loaded, edited elsewhere) starts a
    // fresh history: undoing into another design's layout would be wrong
    const h = historyRef.current;
    if (JSON.stringify(h.present) !== JSON.stringify(layout)) {
      historyRef.current = resetHistory(h, layout);
      setHistoryTick((n) => n + 1);
    }
  }, [layout]);
  const commit = useCallback(
    (next: BreadboardLayout) => {
      historyRef.current = pushHistory(historyRef.current, next);
      setHistoryTick((n) => n + 1);
      onChange(next);
    },
    [onChange],
  );
  const doUndo = useCallback(() => {
    if (!canUndo(historyRef.current)) return;
    historyRef.current = undo(historyRef.current);
    setHistoryTick((n) => n + 1);
    onChange(historyRef.current.present);
  }, [onChange]);
  const doRedo = useCallback(() => {
    if (!canRedo(historyRef.current)) return;
    historyRef.current = redo(historyRef.current);
    setHistoryTick((n) => n + 1);
    onChange(historyRef.current.present);
  }, [onChange]);

  // ---- scene lifecycle ---------------------------------------------------------------------
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const sc = new BreadboardScene(el, { onContextLost: () => setLost(true), onContextRestored: () => setLost(false) });
    if (!sc.ok) setNoWebgl(true);
    sceneRef.current = sc;
    return () => {
      sc.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setContent(layout, check.parts);
  }, [layout, check]);

  useEffect(() => {
    sceneRef.current?.setIndicators(indicatorLevels, running ?? indicatorLevels !== undefined);
  }, [indicatorLevels, running, layout]);

  useEffect(() => {
    sceneRef.current?.setHover(hover, cursor);
  }, [hover, cursor, layout]);

  // highlights: hovered strip, active issue, guide step, selection
  const activeIssueObj: BreadboardIssue | undefined = useMemo(() => [...check.issues, ...check.hints].find((i) => i.id === activeIssue), [check, activeIssue]);
  const guideStep = panel === 'guide' ? guide[Math.min(guideIndex, guide.length - 1)] : undefined;
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const strips: string[] = [];
    const hoverHole = hover ?? cursor;
    if (hoverHole) {
      const b = boards.get(hoverHole.board);
      const s = b ? stripIdOf(b, hoverHole.row, hoverHole.col) : null;
      if (s) strips.push(s);
    }
    const holes: HoleMarker[] = [];
    const refdes: string[] = [];
    if (activeIssueObj) {
      const color = activeIssueObj.severity === 'error' ? '#e03131' : activeIssueObj.severity === 'warning' ? '#f08c00' : '#1c7ed6';
      for (const h of activeIssueObj.holes) holes.push({ hole: h, color });
      refdes.push(...activeIssueObj.refdes);
    }
    if (guideStep) {
      for (const h of guideStep.holes) holes.push({ hole: h, color: '#1c7ed6' });
      if (guideStep.refdes) refdes.push(guideStep.refdes);
    }
    sc.setHighlights({
      strips,
      holes,
      refdes,
      selected: selected ? { kind: 'part', id: selected } : localSel,
    });
  }, [hover, cursor, boards, activeIssueObj, guideStep, selected, localSel, layout]);

  // ghost preview of the placement / wire / clip being made
  useEffect(() => {
    const sc = sceneRef.current;
    if (!sc) return;
    const target = dragTarget ?? hover ?? cursor;
    if (placing && target) {
      const p = previewPlacement(design, layout, placing.refdes, target, placing.rotation);
      const leads: GhostLead[] = p ? Object.values(p.pins).map((h) => ({ hole: h, ok: p.ok && !p.conflicts.some((c) => sameHole(c, h)) })) : [];
      if (p && !p.ok) leads.push({ hole: target, ok: false });
      sc.setGhost(leads);
    } else if (dragRef.current && dragTarget) {
      const d = dragRef.current;
      const pl = layout.placements.find((p) => p.refdes === d.refdes);
      const p = previewPlacement(design, layout, d.refdes, dragTarget, pl?.rotation ?? inferRotation(design, layout, d.refdes));
      sc.setGhost(p ? Object.values(p.pins).map((h) => ({ hole: h, ok: p.ok && !p.conflicts.some((c) => sameHole(c, h)) })) : [{ hole: dragTarget, ok: false }]);
    } else if (tool === 'wire' && wireStart) {
      sc.setGhost(null, { from: wireStart, to: target, color: wireColor });
    } else if (clipping && target) {
      sc.setGhost([{ hole: target, ok: true }]);
    } else {
      sc.setGhost(null);
    }
  }, [placing, clipping, tool, wireStart, wireColor, hover, cursor, dragTarget, design, layout]);

  // ---- actions -----------------------------------------------------------------------------
  const flash = useCallback((m: LocalizedText | null) => setMessage(m), []);

  const cancelModes = useCallback(() => {
    setPlacing(null);
    setClipping(null);
    setWireStart(null);
  }, []);

  const clipColor = useCallback(
    (refdes: string, pin: string): string => {
      const part = check.parts.get(refdes);
      const net = part ? expectedNets(part, build)[pin] : null;
      if (net === '0' || pin === '-' || pin === 'COM') return WIRE_COLORS.ground;
      if (pin === '+' || /\+$/.test(pin)) return WIRE_COLORS.positive;
      return WIRE_COLORS.signal[0];
    },
    [check, build],
  );

  const actAt = useCallback(
    (hole: BreadboardHole | null, hit: { part?: string; wire?: string; clip?: string; device?: string }) => {
      if (placing) {
        if (!hole) return;
        const next = placePart(design, layout, placing.refdes, hole, placing.rotation);
        if (!next) {
          flash(fill(UI.cannotPlace, { part: placing.refdes, hole: holeName(hole) }));
          return;
        }
        commit(next);
        select(placing.refdes);
        setPlacing(null);
        flash(null);
        return;
      }
      if (clipping) {
        if (!hole) return;
        commit(addClip(layout, clipping.refdes, clipping.pin, hole, clipColor(clipping.refdes, clipping.pin)).layout);
        setClipping(null);
        return;
      }
      if (tool === 'wire') {
        if (!hole) return;
        if (!wireStart) {
          setWireStart(hole);
          return;
        }
        const res = addWire(layout, wireStart, hole, wireColor);
        if (res) {
          commit(res.layout);
          setLocalSel({ kind: 'wire', id: res.id });
          select(null);
        }
        setWireStart(null);
        return;
      }
      if (hit.part) select(hit.part);
      else if (hit.wire) {
        select(null);
        setLocalSel({ kind: 'wire', id: hit.wire });
      } else if (hit.clip) {
        select(null);
        setLocalSel({ kind: 'clip', id: hit.clip });
      } else if (hit.device) select(hit.device);
      else {
        select(null);
        setLocalSel(null);
      }
    },
    [placing, clipping, tool, wireStart, wireColor, design, layout, commit, select, flash, clipColor],
  );

  const rotateSelected = useCallback(
    (step: 90 | 180 = 90) => {
    if (placing) {
      setPlacing({ ...placing, rotation: (placing.rotation + step) % 360 });
      return;
    }
    if (!selected || !layout.placements.some((p) => p.refdes === selected)) return;
    const next = rotatePart(design, layout, selected, step);
    if (next) commit(next);
    else flash(fill(UI.cannotRotate, { part: selected }));
    },
    [placing, selected, design, layout, commit, flash],
  );

  const deleteSelected = useCallback(() => {
    if (localSel?.kind === 'wire') {
      commit(removeWire(layout, localSel.id));
      setLocalSel(null);
    } else if (localSel?.kind === 'clip') {
      commit(removeClip(layout, localSel.id));
      setLocalSel(null);
    } else if (selected && layout.placements.some((p) => p.refdes === selected)) {
      commit(removePart(layout, selected));
      select(null);
    } else if (selected && layout.clips.some((c) => c.refdes === selected)) {
      commit({ ...layout, clips: layout.clips.filter((c) => c.refdes !== selected) });
      select(null);
    }
  }, [localSel, selected, layout, commit, select]);

  const arrange = useCallback(() => {
    const b0 = layout.boards[0];
    commit(autoPlace(design, { build, kind: b0?.kind ?? 'full', splitRails: b0?.splitRails }));
    cancelModes();
  }, [design, build, layout, commit, cancelModes]);

  const screenshot = useCallback(() => {
    const url = sceneRef.current?.screenshot();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(design.title || 'breadboard').replace(/[\\/:*?"<>|]+/g, '_')}-breadboard.png`;
    a.click();
  }, [design.title]);

  const setView = useCallback((v: ViewPreset) => sceneRef.current?.setView(v), []);

  // ---- pointer -----------------------------------------------------------------------------
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const sc = sceneRef.current;
    if (!sc) return;
    const h = sc.holeAt(e.clientX, e.clientY);
    setHover((prev) => (prev && h && sameHole(prev, h)) || prev === h ? prev : h);
    const d = dragRef.current;
    if (d) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
      if (d.moved && h) {
        const b = boards.get(h.board);
        const g0 = b && holeGrid(b, d.startHole);
        const g1 = b && holeGrid(b, h);
        const ga = b && holeGrid(b, d.anchor);
        let target: BreadboardHole | null = h;
        if (b && g0 && g1 && ga && d.anchor.board === h.board) {
          // keep the grab offset; snap to the nearest hole (the offset may land in the channel)
          const gx = ga.gx + (g1.gx - g0.gx);
          const gy = ga.gy + (g1.gy - g0.gy);
          target = gridToHole(b, gx, gy, 0.3) ?? gridToHole(b, gx, gy, 1.01) ?? gridToHole(b, gx, gy, 1.6);
        }
        d.target = target;
        setDragTarget(d.target);
      }
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    stageRef.current?.focus();
    downRef.current = { x: e.clientX, y: e.clientY };
    const sc = sceneRef.current;
    if (!sc || placing || clipping || tool === 'wire') return;
    const hit = sc.pick(e.clientX, e.clientY);
    if (hit.part && hit.hole) {
      const anchor = anchorOf(design, layout, hit.part);
      if (anchor) {
        dragRef.current = { refdes: hit.part, startHole: hit.hole, anchor, x: e.clientX, y: e.clientY, moved: false, target: null };
        sc.setControlsEnabled(false);
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
    }
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const sc = sceneRef.current;
    const d = dragRef.current;
    dragRef.current = null;
    sc?.setControlsEnabled(true);
    const down = downRef.current;
    downRef.current = null;
    if (!sc) return;
    if (d && d.moved) {
      const target = d.target;
      setDragTarget(null);
      if (target) {
        const next = movePart(design, layout, d.refdes, target);
        if (next) {
          commit(next);
          select(d.refdes);
        } else flash(fill(UI.cannotMove, { part: d.refdes }));
      }
      return;
    }
    setDragTarget(null);
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // orbit / pan drag
    const hit = sc.pick(e.clientX, e.clientY);
    actAt(hit.hole, hit);
  };

  // ---- keyboard ----------------------------------------------------------------------------
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const key = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (key === 'z' || key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (ctrl && (key === 'y' || key === 'Y')) {
      e.preventDefault();
      doRedo();
      return;
    }
    if (key.startsWith('Arrow')) {
      e.preventDefault();
      const b = layout.boards[0];
      if (!b) return;
      const base = cursor ?? hover ?? { board: b.id, row: 'a' as const, col: 1 };
      const board = boards.get(base.board) ?? b;
      const n = e.shiftKey ? 5 : 1;
      const dCol = key === 'ArrowLeft' ? -n : key === 'ArrowRight' ? n : 0;
      const dRow = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
      setCursor(stepHole(board, base, dCol, dRow));
      return;
    }
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      const hole = cursor ?? hover;
      if (!hole) return;
      const items = itemsAtHole(layout, hole);
      actAt(hole, { part: items.parts[0]?.refdes, wire: items.wires[0]?.id, clip: items.clips[0] });
      return;
    }
    if (key === 'r' || key === 'R') {
      e.preventDefault();
      rotateSelected(e.shiftKey ? 180 : 90);
      return;
    }
    if (key === 'Delete' || key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (key === 'Escape') {
      cancelModes();
      setLocalSel(null);
      select(null);
      flash(null);
      return;
    }
    if (key === 'w' || key === 'W') {
      setTool((tl) => (tl === 'wire' ? 'select' : 'wire'));
      cancelModes();
      return;
    }
    if (key === '1') setView('top');
    if (key === '2') setView('iso');
    if (key === '3') setView('front');
  };

  // ---- hover info --------------------------------------------------------------------------
  const info = useMemo(() => {
    const h = hover ?? cursor;
    if (!h) return null;
    const b = boards.get(h.board);
    const strip = b ? stripIdOf(b, h.row, h.col) : null;
    if (!strip) return null;
    const netId = netOfHole(check.connectivity, h);
    const nets = netId === undefined ? [] : (check.schematicNets.get(netId) ?? []);
    const leads = netId === undefined ? [] : check.connectivity.nets[netId].leads.filter((l) => l.kind !== 'wire');
    const leadText = leads.slice(0, 8).map((l) => (l.kind === 'part' ? `${l.refdes}.${l.pin}` : l.kind === 'clip' ? `${l.refdes}.${l.pin}↯` : ''));
    return {
      hole: t(describeHole(h, multiBoard)),
      strip: t(describeStrip(strip, multiBoard)),
      nets: nets.map((n) => check.netDisplay.get(n) ?? n).join(', '),
      leads: leadText.join(', ') + (leads.length > 8 ? ' …' : ''),
    };
  }, [hover, cursor, boards, check, multiBoard, t]);

  const statusText = placing
    ? t(fill(UI.placing, { part: placing.refdes }))
    : clipping
      ? t(fill(UI.clipping, { part: clipping.refdes, pin: clipping.pin }))
      : tool === 'wire'
        ? wireStart
          ? t(fill(UI.wiringFrom, { hole: holeName(wireStart, multiBoard) }))
          : t(UI.wiring)
        : t(UI.idle);

  const board0 = layout.boards[0];
  const isRunning = running ?? indicatorLevels !== undefined;
  const selPlaced = !!selected && layout.placements.some((p) => p.refdes === selected);

  return (
    <div className={`mbb${className ? ` ${className}` : ''}`} style={style} lang={lang}>
      <div className="mbb-toolbar" role="toolbar" aria-label={t(UI.title)}>
        <button type="button" className="mbb-btn" onClick={() => setView('top')} title={`${t(UI.viewTop)} (1)`}>
          ⬒ <span className="mbb-btn-text">{t(UI.viewTop)}</span>
        </button>
        <button type="button" className="mbb-btn" onClick={() => setView('iso')} title={`${t(UI.viewIso)} (2)`}>
          ◩ <span className="mbb-btn-text">{t(UI.viewIso)}</span>
        </button>
        <button type="button" className="mbb-btn" onClick={() => setView('front')} title={`${t(UI.viewFront)} (3)`}>
          ▭ <span className="mbb-btn-text">{t(UI.viewFront)}</span>
        </button>
        <span className="mbb-sep" />
        <button type="button" className="mbb-btn" aria-pressed={tool === 'select'} onClick={() => (setTool('select'), cancelModes())} title={t(UI.toolSelect)}>
          ➚ <span className="mbb-btn-text">{t(UI.toolSelect)}</span>
        </button>
        <button type="button" className="mbb-btn" aria-pressed={tool === 'wire'} onClick={() => (setTool('wire'), cancelModes())} title={`${t(UI.toolWire)} (W)`}>
          〰 <span className="mbb-btn-text">{t(UI.toolWire)}</span>
        </button>
        <span className="mbb-swatches" role="group" aria-label={t(UI.wireColor)}>
          {PALETTE.map((c, i) => (
            <button key={c} type="button" className="mbb-swatch" style={{ background: c }} aria-pressed={wireColor === c} aria-label={`${t(UI.wireColor)}: ${t(PALETTE_NAMES[i])}`} title={t(PALETTE_NAMES[i])} onClick={() => setWireColor(c)} />
          ))}
          <input type="color" className="mbb-color-input" value={/^#[0-9a-f]{6}$/i.test(wireColor) ? wireColor : '#fdd835'} onChange={(e) => setWireColor(e.target.value)} aria-label={t(UI.wireColor)} title={t(UI.wireColor)} />
        </span>
        <span className="mbb-sep" />
        <button type="button" className="mbb-btn" onClick={(e) => rotateSelected(e.shiftKey ? 180 : 90)} disabled={!placing && !selPlaced} title={t(UI.rotate)}>
          ⟳ <span className="mbb-btn-text">{t(UI.rotateShort)}</span>
        </button>
        <button type="button" className="mbb-btn" onClick={() => rotateSelected(180)} disabled={!placing && !selPlaced} title={t(UI.rotate)} aria-label={`${t(UI.rotateShort)} 180°`}>
          ⟲ 180°
        </button>
        <button type="button" className="mbb-btn" onClick={deleteSelected} disabled={!localSel && !selected} title={t(UI.remove)}>
          ✕ <span className="mbb-btn-text">{t(UI.remove)}</span>
        </button>
        <button type="button" className="mbb-btn" onClick={doUndo} disabled={!canUndo(historyRef.current)} title={t(UI.undo)} aria-label={t(UI.undo)}>
          ↶
        </button>
        <button type="button" className="mbb-btn" onClick={doRedo} disabled={!canRedo(historyRef.current)} title={t(UI.redo)} aria-label={t(UI.redo)}>
          ↷
        </button>
        <span className="mbb-sep" />
        <button type="button" className="mbb-btn" onClick={arrange} title={t(UI.autoArrangeHint)}>
          ✦ <span className="mbb-btn-text">{t(UI.autoArrange)}</span>
        </button>
        <button type="button" className="mbb-btn" aria-pressed={panel === 'check'} onClick={() => setPanel(panel === 'check' ? 'none' : 'check')} title={t(UI.check)}>
          ✓ <span className="mbb-btn-text">{t(UI.check)}</span>
        </button>
        <button type="button" className="mbb-btn" aria-pressed={panel === 'guide'} onClick={() => setPanel(panel === 'guide' ? 'none' : 'guide')} title={t(UI.guide)}>
          ☰ <span className="mbb-btn-text">{t(UI.guide)}</span>
        </button>
        <button type="button" className="mbb-btn" onClick={screenshot} title={t(UI.screenshot)}>
          ⎙ <span className="mbb-btn-text">{t(UI.screenshot)}</span>
        </button>
        <span className="mbb-sep" />
        {board0 && (
          <>
            <label className="mbb-field">
              {t(UI.boardKind)}
              <select value={board0.kind} onChange={(e) => commit(setBoardKind(layout, board0.id, e.target.value as BoardKind))}>
                <option value="full">{t(UI.boardFull)}</option>
                <option value="half">{t(UI.boardHalf)}</option>
                <option value="mini">{t(UI.boardMini)}</option>
              </select>
            </label>
            <label className="mbb-field">
              <input type="checkbox" checked={!!board0.splitRails} onChange={(e) => commit(setSplitRails(layout, board0.id, e.target.checked))} />
              {t(UI.splitRails)}
            </label>
          </>
        )}
        {languageSwitch && (
          <label className="mbb-field">
            {t(UI.language)}
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
        )}
        <span style={{ flex: 1 }} />
        {isRunning && <span className="mbb-badge mbb-badge-run">● {t(UI.running)}</span>}
        <span className={`mbb-badge ${check.ok ? 'mbb-badge-ok' : 'mbb-badge-bad'}`} role="status">
          {check.ok ? '✓' : `${check.counts.errors} ${t(UI.errors)} · ${check.counts.warnings} ${t(UI.warnings)}`}
        </span>
      </div>

      <div className="mbb-main">
        <PartsBin
          lang={lang}
          bin={bin}
          placing={placing?.refdes ?? null}
          clipping={clipping}
          onPlace={(refdes) => {
            cancelModes();
            setTool('select');
            setPlacing({ refdes, rotation: 0 });
            stageRef.current?.focus();
          }}
          onClip={(refdes, pin) => {
            cancelModes();
            setTool('select');
            setClipping({ refdes, pin });
            stageRef.current?.focus();
          }}
        />
        <div
          ref={stageRef}
          className="mbb-stage"
          tabIndex={0}
          role="application"
          aria-label={t(UI.canvasLabel)}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKeyDown}
          style={{ cursor: placing || clipping || tool === 'wire' ? 'crosshair' : 'default' }}
        >
          {info && (
            <div className="mbb-hover" aria-live="polite">
              <b>{info.hole}</b>
              <br />
              {t(UI.hoverStrip)}: {info.strip}
              <br />
              {t(UI.hoverNet)}: {info.nets || t(UI.hoverEmpty)}
              <br />
              {t(UI.hoverParts)}: {info.leads || t(UI.hoverEmpty)}
            </div>
          )}
          {noWebgl && <div className="mbb-overlay">{t(UI.noWebgl)}</div>}
          {lost && !noWebgl && <div className="mbb-overlay">{t(UI.contextLost)}</div>}
        </div>
        {panel === 'check' && (
          <IssuesPanel
            lang={lang}
            check={check}
            active={activeIssue}
            onActivate={(i) => {
              setActiveIssue(activeIssue === i.id ? null : i.id);
              if (i.refdes[0]) select(i.refdes[0]);
            }}
            onClose={() => (setPanel('none'), setActiveIssue(null))}
          />
        )}
        {panel === 'guide' && guide.length > 0 && <GuidePanel lang={lang} steps={guide} index={guideIndex} onIndex={setGuideIndex} onClose={() => setPanel('none')} />}
      </div>

      <div className="mbb-status" aria-live="polite">
        <span>{statusText}</span>
        {message && <span className="mbb-msg">{t(message)}</span>}
        {selected && (
          <span>
            {t(UI.selected)}: <b>{selected}</b>
          </span>
        )}
        {localSel && (
          <span>
            {t(UI.selected)}: <b>{localSel.id}</b>
          </span>
        )}
      </div>
    </div>
  );
}

export default BreadboardView;
