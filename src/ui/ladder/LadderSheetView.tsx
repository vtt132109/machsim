/**
 * The ladder-diagram editor: the view that replaces the schematic canvas while a ladder sheet is
 * open (App.tsx chooses between them by `Sheet.kind`).
 *
 *   ┌ toolbar: add rung / in series / in parallel / comparison / coil / copy / cut / paste ──┐
 *   │ block and cross-reference panels (opened from the toolbar)                             │
 *   │ rails and rungs (SVG): ─┤ ├──┤/├──────( )─                                            │
 *   ├ inspector: what the selected contact or coil is, its address, its preset, operands ───┤
 *   └ live strip: scans, timers, counters, words and the input / output image while it runs ─┘
 *
 * Everything the view does goes through the pure layers, which is why the drawing and the running
 * program always agree: `layoutLadder` (src/ladder/layout.ts) places the elements on a grid and
 * gives each one the same slot number the compiler gives it, `compileLadder` reports the problems
 * of each rung, and the editing functions of src/ladder/edit.ts return new rungs for one undo
 * step (`actions.setLadderRungs`). While a simulation runs, `EditorState.ladderLive` says which
 * slots carry power and the conducting elements light up.
 *
 * The same diagram edits the rungs of a **function block** (src/ladder/blocks.ts): choosing a
 * block in the block panel switches the diagram to that block's rungs. Rungs, contacts and coils
 * can be copied, cut and pasted (src/ladder/clipboard.ts), also between designs through the text
 * clipboard, and the cross-reference panel jumps to any rung that reads or writes an address.
 */
import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactElement } from 'react';
import { actions, useEditor } from '../store';
import { getSheet } from '../store/designOps';
import { layoutLadder, rungErrors, type LadderCell, type LadderCoil } from '../../ladder/layout';
import { COMPARE_SYMBOL, OUTPUT_CODE, compileLadder, isCounterOutput, isTimerOutput, isWordOutput, type LadderError } from '../../ladder/program';
import { addOutput, insertParallel, insertSeries, moveRung, newRung, nodeAt, pathOf, removeNode, removeOutput, replaceNode, withLogic, withOutput } from '../../ladder/edit';
import { callsIn, nextBlockName, nextInstanceName, retypeOutput } from '../../ladder/editBlocks';
import { newBlock } from '../../ladder/blocks';
import { copyCoil, copyNode, copyRungs, cutRungs, decodeLadderClip, encodeLadderClip, pasteCoil, pasteNode, pasteRungs, type LadderClip } from '../../ladder/clipboard';
import { crossReference, type XrefUse } from '../../ladder/xref';
import { ladderRungsOf } from '../../model/ladderBuild';
import type { LadderBlock, LadderContactKind, LadderCompareOp, LadderNode, LadderOutput, LadderOutputKind, LadderRung } from '../../ladder/types';
import type { Design, Sheet } from '../../model/types';
import { compareText, contactText, ladderErrorText, lt, outputText } from '../../i18n/ladderText';
import { newId } from '../store/ids';
import { openHelp } from '../help/open';
import { confirmDialog } from '../common/dialogs';
import { LADDER_BOX_H, LADDER_BOX_W, LADDER_COIL_COL, LADDER_COL, LADDER_HEAD, LADDER_LINE, LADDER_RAIL_LEFT, LADDER_ROW, ladderBoxLines, ladderCaptionLines, ladderRungHeight } from '../editor/ladderSvg';
import { BlockPanel, CallFields, XrefPanel } from './LadderPanels';

import './ladder.css';

// the geometry lives in src/ui/editor/ladderSvg.ts, which also draws the printed / exported
// diagram, so paper and screen cannot drift apart
const COL = LADDER_COL;
const ROW = LADDER_ROW;
const RAIL_LEFT = LADDER_RAIL_LEFT;
const COIL_COL = LADDER_COIL_COL;
const HEAD = LADDER_HEAD;
/** unit of the timer read-outs (the same in both languages) */
const SECOND = 's';
/** address prefixes of the word and analog-output read-outs (the same in both languages) */
const WORD_PREFIX = 'MW';
const ANALOG_PREFIX = 'AQ';

type Sel = { rung: number; kind: 'cell'; path: number[] } | { rung: number; kind: 'coil'; index: number } | { rung: number; kind: 'rung' };

const CONTACT_KINDS: LadderContactKind[] = ['no', 'nc', 'rising', 'falling'];
const OPS: LadderCompareOp[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];
const OUTPUT_KINDS: LadderOutputKind[] = ['coil', 'coil-not', 'set', 'reset', 'ton', 'tof', 'ctu', 'ctd', 'creset', 'mov', 'add', 'sub', 'mul', 'div', 'call'];

const newContact = (): LadderNode => ({ kind: 'contact', type: 'no', address: 'I0.0' });
const newCompare = (): LadderNode => ({ kind: 'compare', op: 'gt', left: 'AI0', right: '5' });

/** The block list of a design without blocks (one array, so the memos below do not recompute on every render). */
const NO_BLOCKS: readonly LadderBlock[] = [];

/** What was last copied in this window (the system clipboard text carries the same clip between windows). */
let memoryClip: LadderClip | null = null;

/** The ladder sheets of the design level the sheet `sheetId` belongs to. */
function levelLadderSheets(design: Design, sheetId: string): Sheet[] {
  const level = design.sheets.some((s) => s.id === sheetId) ? design.sheets : ((design.children ?? []).find((c) => c.sheets.some((s) => s.id === sheetId))?.sheets ?? design.sheets);
  return level.filter((s) => s.kind === 'ladder' && s.ladder);
}

/** One contact of a rung, drawn at its grid place. */
function Cell({ cell, x0, y0, live, selected, onPick }: { cell: LadderCell; x0: number; y0: number; live: boolean; selected: boolean; onPick: (shift: boolean) => void }) {
  const cx = x0 + cell.col * COL + COL / 2;
  const cy = y0 + cell.row * ROW + ROW / 2;
  const node = cell.node;
  const label = node.kind === 'contact' ? node.address : node.kind === 'compare' ? `${node.left} ${COMPARE_SYMBOL[node.op]} ${node.right}` : '';
  const mark = node.kind === 'contact' ? (node.type === 'rising' ? 'P' : node.type === 'falling' ? 'N' : '') : '';
  const cls = `ms-l-el${live ? ' is-live' : ''}${selected ? ' is-selected' : ''}`;
  return (
    <g className={cls} onPointerDown={(e) => onPick(e.shiftKey)} role="button" tabIndex={-1} aria-label={label}>
      <line x1={cx - COL / 2} y1={cy} x2={cx + COL / 2} y2={cy} className="ms-l-wire" />
      <rect x={cx - 26} y={cy - 16} width={52} height={32} className="ms-l-hit" />
      <line x1={cx - 8} y1={cy - 11} x2={cx - 8} y2={cy + 11} className="ms-l-bar" />
      <line x1={cx + 8} y1={cy - 11} x2={cx + 8} y2={cy + 11} className="ms-l-bar" />
      {node.kind === 'contact' && node.type === 'nc' ? <line x1={cx - 10} y1={cy + 11} x2={cx + 10} y2={cy - 11} className="ms-l-bar" /> : null}
      {mark ? (
        <text x={cx} y={cy + 4} className="ms-l-mark">
          {mark}
        </text>
      ) : null}
      <text x={cx} y={cy - 15} className="ms-l-addr">
        {label}
      </text>
    </g>
  );
}

/** One coil of a rung, drawn against the right rail (a box for a word instruction or a block call). */
function Coil({ coil, x, y0, live, selected, onPick }: { coil: LadderCoil; x: number; y0: number; live: boolean; selected: boolean; onPick: (shift: boolean) => void }) {
  const cy = y0 + coil.row * ROW + ROW / 2;
  const o = coil.output;
  const code = OUTPUT_CODE[o.kind];
  const cls = `ms-l-el ms-l-coil${live ? ' is-live' : ''}${selected ? ' is-selected' : ''}`;
  const cx = x + 40;
  const box = ladderBoxLines(o);
  if (box) {
    const left = cx - LADDER_BOX_W - 6;
    return (
      <g className={cls} onPointerDown={(e) => onPick(e.shiftKey)} role="button" tabIndex={-1} aria-label={`${box[0]} ${box[1]}`}>
        <line x1={x - COIL_COL + 40} y1={cy} x2={left} y2={cy} className="ms-l-wire" />
        <rect x={left - 4} y={cy - 16} width={LADDER_BOX_W + 8} height={32} className="ms-l-hit" />
        <rect x={left} y={cy - LADDER_BOX_H / 2} width={LADDER_BOX_W} height={LADDER_BOX_H} rx={3} className="ms-l-box" />
        <text x={left + LADDER_BOX_W / 2} y={cy - 3} className="ms-l-boxcode">
          {box[0]}
        </text>
        <text x={left + LADDER_BOX_W / 2} y={cy + 9} className="ms-l-boxtext">
          {box[1]}
        </text>
        <line x1={left + LADDER_BOX_W} y1={cy} x2={cx} y2={cy} className="ms-l-wire" />
      </g>
    );
  }
  return (
    <g className={cls} onPointerDown={(e) => onPick(e.shiftKey)} role="button" tabIndex={-1} aria-label={o.address}>
      <line x1={x - COIL_COL + 40} y1={cy} x2={cx - 14} y2={cy} className="ms-l-wire" />
      <rect x={cx - 24} y={cy - 16} width={48} height={32} className="ms-l-hit" />
      <path d={`M ${cx - 10} ${cy - 11} A 13 13 0 0 0 ${cx - 10} ${cy + 11}`} className="ms-l-arc" />
      <path d={`M ${cx + 10} ${cy - 11} A 13 13 0 0 1 ${cx + 10} ${cy + 11}`} className="ms-l-arc" />
      <line x1={cx + 14} y1={cy} x2={cx + 30} y2={cy} className="ms-l-wire" />
      {code ? (
        <text x={cx} y={cy + 4} className="ms-l-mark">
          {code}
        </text>
      ) : null}
      <text x={cx} y={cy - 15} className="ms-l-addr">
        {o.address}
      </text>
      {o.preset !== undefined && o.preset !== '' ? (
        <text x={cx} y={cy + 20} className="ms-l-preset">
          {o.preset}
        </text>
      ) : null}
    </g>
  );
}

/** The rails, the rungs and everything on them. */
function Diagram({
  rungs,
  cols,
  errors,
  slots,
  sel,
  range,
  onPick,
}: {
  rungs: readonly LadderRung[];
  cols: number;
  errors: readonly LadderError[];
  slots: boolean[] | null;
  sel: Sel | null;
  range: [number, number] | null;
  onPick: (s: Sel, shift: boolean) => void;
}) {
  const layout = useMemo(() => layoutLadder(rungs), [rungs]);
  const width = RAIL_LEFT + Math.max(cols, layout.cols) * COL + COIL_COL + 40;
  let y = 0;
  const blocks: ReactElement[] = [];
  layout.rungs.forEach((r, i) => {
    const rung = rungs[i];
    const top = y;
    const captionCols = Math.max(cols, layout.cols);
    const caption = ladderCaptionLines(`${lt('rung', { n: i + 1 })}${rung.disabled ? ` ${lt('disabled')}` : ''}`, rung.comment, captionCols);
    const y0 = top + HEAD + (caption.length - 1) * LADDER_LINE;
    const x0 = RAIL_LEFT;
    const railR = RAIL_LEFT + Math.max(cols, layout.cols) * COL + COIL_COL;
    const problems = rungErrors(errors, i);
    const live = (slot: number) => !!slots?.[slot];
    const inRange = range !== null && i >= range[0] && i <= range[1];
    const height = ladderRungHeight(r, caption.length);
    blocks.push(
      <g key={rung.id} data-ladder-rung={i} className={`ms-l-rung${rung.disabled ? ' is-off' : ''}${problems.length ? ' is-bad' : ''}${sel?.rung === i ? ' is-current' : ''}${inRange ? ' is-range' : ''}`}>
        <rect x={0} y={top} width={width} height={height} className="ms-l-rungbox" onPointerDown={(e) => onPick({ rung: i, kind: 'rung' }, e.shiftKey)} />
        {caption.map((text, k) => (
          <text key={k} x={RAIL_LEFT + 4} y={top + 15 + k * LADDER_LINE} className="ms-l-comment">
            {text}
          </text>
        ))}
        {/* left and right rails */}
        <line x1={x0} y1={y0} x2={x0} y2={y0 + r.rows * ROW} className="ms-l-rail" />
        <line x1={railR} y1={y0} x2={railR} y2={y0 + r.rows * ROW} className="ms-l-rail" />
        {/* an always-true rung: a plain wire from the rail */}
        {!rung.logic ? <line x1={x0} y1={y0 + ROW / 2} x2={x0 + COL / 2} y2={y0 + ROW / 2} className={`ms-l-wire${live(r.slot) ? ' is-live' : ''}`} /> : null}
        {r.fills.map((f, k) => (
          <line key={`f${k}`} x1={x0 + f.col * COL} y1={y0 + f.row * ROW + ROW / 2} x2={x0 + (f.col + f.len) * COL} y2={y0 + f.row * ROW + ROW / 2} className="ms-l-wire" />
        ))}
        {r.verticals.map((v, k) => (
          <line key={`v${k}`} x1={x0 + v.col * COL} y1={y0 + v.row1 * ROW + ROW / 2} x2={x0 + v.col * COL} y2={y0 + v.row2 * ROW + ROW / 2} className="ms-l-wire" />
        ))}
        {/* the logic reaches the coil column through a link */}
        <line x1={x0 + r.cols * COL} y1={y0 + ROW / 2} x2={railR - COIL_COL + 40} y2={y0 + ROW / 2} className={`ms-l-wire${live(r.slot) ? ' is-live' : ''}`} />
        {r.coils.length > 1 ? <line x1={railR - COIL_COL + 40} y1={y0 + ROW / 2} x2={railR - COIL_COL + 40} y2={y0 + (r.coils.length - 1) * ROW + ROW / 2} className="ms-l-wire" /> : null}
        {r.cells.map((c) => (
          <Cell
            key={c.path.join('.') || 'root'}
            cell={c}
            x0={x0}
            y0={y0}
            live={live(c.slot)}
            selected={sel?.rung === i && sel.kind === 'cell' && sel.path.join('.') === c.path.join('.')}
            onPick={(shift) => onPick({ rung: i, kind: 'cell', path: c.path }, shift)}
          />
        ))}
        {r.coils.map((c) => (
          <Coil key={c.index} coil={c} x={railR - 40} y0={y0} live={live(c.slot)} selected={sel?.rung === i && sel.kind === 'coil' && sel.index === c.index} onPick={(shift) => onPick({ rung: i, kind: 'coil', index: c.index }, shift)} />
        ))}
        {problems.length ? (
          <text x={RAIL_LEFT + 4} y={top + height - 2} className="ms-l-problem">
            {ladderErrorText(problems[0])}
          </text>
        ) : null}
      </g>,
    );
    y += height;
  });
  return (
    <svg className="ms-l-svg" width={width} height={Math.max(y + 10, 80)} role="img" aria-label={lt('title')}>
      {blocks}
    </svg>
  );
}

/** Byte of an image as eight lamps, LSB on the left (how the address reads: Q0.0 first). */
function Bits({ label, value }: { label: string; value: number }) {
  return (
    <span className="ms-l-bits">
      <span className="ms-l-bitlabel">{label}</span>
      {Array.from({ length: 8 }, (_, k) => (
        <i key={k} className={Math.floor(value / 2 ** k) % 2 ? 'is-on' : undefined} />
      ))}
    </span>
  );
}

/** True when the keyboard event target is a text field (copy / paste then belongs to the text). */
function isFormTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

type Mode = { kind: 'sheet' } | { kind: 'block'; id: string };

export function LadderSheetView() {
  const design = useEditor((s) => s.design);
  const sheetId = useEditor((s) => s.activeSheetId);
  const live = useEditor((s) => s.ladderLive);
  const sheet = getSheet(design, sheetId);
  const blocks = design.ladderBlocks ?? NO_BLOCKS;
  const [mode, setMode] = useState<Mode>({ kind: 'sheet' });
  const [panel, setPanel] = useState<'none' | 'blocks' | 'xref'>('none');
  const [sel, setSel] = useState<Sel | null>(null);
  /** other end of a selected run of rungs (Shift+click) */
  const [extra, setExtra] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const viewRef = useRef<HTMLDivElement>(null);

  const editingBlock = mode.kind === 'block' ? blocks.find((b) => b.id === mode.id) : undefined;
  const rungs: readonly LadderRung[] = editingBlock ? editingBlock.rungs : (sheet?.ladder ?? []);

  const levelSheets = useMemo(() => levelLadderSheets(design, sheetId), [design, sheetId]);
  /** every problem of the program of this level, function blocks included */
  const program = useMemo(() => {
    const { rungs: all } = ladderRungsOf(levelSheets);
    return compileLadder(all, { blocks });
  }, [levelSheets, blocks]);
  const compiled = useMemo(() => {
    if (editingBlock) {
      // the problems found inside this block, numbered by the block's own rungs
      const own = program.errors.filter((e) => e.block === editingBlock.name).map((e) => ({ ...e, rung: e.innerRung ?? 0 }));
      return { errors: own };
    }
    return { errors: compileLadder(sheet?.ladder ?? [], { blocks }).errors };
  }, [editingBlock, program, sheet, blocks]);
  const xref = useMemo(() => crossReference(levelSheets.map((s) => ({ sheetId: s.id, sheetName: s.name, rungs: s.ladder ?? [] })), blocks), [levelSheets, blocks]);
  const instanceNames = useMemo(() => [...levelSheets.flatMap((s) => callsIn(s.ladder ?? [])), ...blocks.flatMap((b) => callsIn(b.rungs))].map((c) => c.address), [levelSheets, blocks]);

  const set = (next: LadderRung[]) => {
    if (editingBlock) actions.setLadderBlocks(blocks.map((b) => (b.id === editingBlock.id ? { ...b, rungs: next } : b)));
    else actions.setLadderRungs(sheetId, next);
  };
  const replace = (index: number, rung: LadderRung) => set(rungs.map((r, i) => (i === index ? rung : r)));
  const current = sel ? rungs[sel.rung] : undefined;
  const selNode = sel && sel.kind === 'cell' && current ? nodeAt(current.logic, sel.path) : undefined;
  const selCoil = sel && sel.kind === 'coil' && current ? current.outputs[sel.index] : undefined;
  const range: [number, number] | null = sel && extra !== null ? [Math.min(sel.rung, extra), Math.max(sel.rung, extra)] : null;

  const pick = (s: Sel, shift: boolean) => {
    setNote('');
    if (shift && sel) setExtra(s.rung === sel.rung ? null : s.rung);
    else {
      setExtra(null);
      setSel(s);
    }
  };
  const show = (i: number) => {
    requestAnimationFrame(() => viewRef.current?.querySelector(`[data-ladder-rung="${i}"]`)?.scrollIntoView({ block: 'nearest' }));
  };

  const addRung = () => {
    const next = [...rungs, newRung(newId('rung'))];
    set(next);
    setExtra(null);
    setSel({ rung: next.length - 1, kind: 'cell', path: [] });
    show(next.length - 1);
  };
  const addElement = (how: 'series' | 'parallel' | 'compare') => {
    if (!sel || !current) return;
    const node = how === 'compare' ? newCompare() : newContact();
    const path = sel.kind === 'cell' ? sel.path : [];
    const logic = how === 'parallel' ? insertParallel(current.logic, path, node) : insertSeries(current.logic, path, node);
    replace(sel.rung, withLogic(current, logic));
    // the tree was tidied up, so ask it where the new contact ended up and select it
    const next = pathOf(logic, node);
    if (next) setSel({ rung: sel.rung, kind: 'cell', path: next });
  };
  const removeElement = () => {
    if (!sel || !current) return;
    if (sel.kind === 'cell') {
      replace(sel.rung, withLogic(current, removeNode(current.logic, sel.path)));
      setSel({ rung: sel.rung, kind: 'rung' });
    } else if (sel.kind === 'coil') {
      replace(sel.rung, removeOutput(current, sel.index));
      setSel({ rung: sel.rung, kind: 'rung' });
    }
  };
  const addCoil = () => {
    if (!sel || !current) return;
    replace(sel.rung, addOutput(current, { kind: 'coil', address: 'Q0.0' }));
  };
  const deleteRung = () => {
    if (!sel) return;
    const [lo, hi] = range ?? [sel.rung, sel.rung];
    set(rungs.filter((_r, i) => i < lo || i > hi));
    setSel(null);
    setExtra(null);
  };
  const move = (by: number) => {
    if (!sel || range) return;
    set(moveRung(rungs, sel.rung, sel.rung + by));
    setSel({ ...sel, rung: Math.max(0, Math.min(rungs.length - 1, sel.rung + by)) });
  };
  const toggleRung = () => {
    if (!sel || !current) return;
    const next: LadderRung = { ...current };
    if (next.disabled) delete next.disabled;
    else next.disabled = true;
    replace(sel.rung, next);
  };
  const editNode = (patch: Partial<Extract<LadderNode, { kind: 'contact' }>> & Partial<Extract<LadderNode, { kind: 'compare' }>>) => {
    if (!sel || sel.kind !== 'cell' || !current || !selNode) return;
    replace(sel.rung, withLogic(current, replaceNode(current.logic, sel.path, { ...selNode, ...patch } as LadderNode)));
  };
  const editCoil = (patch: Partial<LadderOutput>) => {
    if (!sel || sel.kind !== 'coil' || !current || !selCoil) return;
    replace(sel.rung, withOutput(current, sel.index, { ...selCoil, ...patch }));
  };
  const retypeCoil = (kind: LadderOutputKind) => {
    if (!sel || sel.kind !== 'coil' || !current || !selCoil) return;
    replace(sel.rung, withOutput(current, sel.index, retypeOutput(selCoil, kind, blocks, nextInstanceName(instanceNames))));
  };

  // ---- copy, cut, paste --------------------------------------------------------------------
  const remember = (clip: LadderClip | null): LadderClip | null => {
    memoryClip = clip;
    return clip;
  };
  const currentClip = (): LadderClip | null => {
    if (!sel || !current) return null;
    if (range) return copyRungs(rungs, range[0], range[1]);
    if (sel.kind === 'cell') return copyNode(current, sel.path);
    if (sel.kind === 'coil') return copyCoil(current, sel.index);
    return copyRungs(rungs, sel.rung);
  };
  const doCopy = (): LadderClip | null => {
    const clip = remember(currentClip());
    if (clip) void navigator.clipboard?.writeText(encodeLadderClip(clip)).catch(() => undefined);
    return clip;
  };
  const doCut = (): LadderClip | null => {
    if (!sel || !current) return null;
    const asRungs = !!range || sel.kind === 'rung';
    if (asRungs) {
      const [lo, hi] = range ?? [sel.rung, sel.rung];
      const r = cutRungs(rungs, lo, hi);
      const clip = remember(r.clip);
      if (clip) void navigator.clipboard?.writeText(encodeLadderClip(clip)).catch(() => undefined);
      set(r.rungs);
      setSel(null);
      setExtra(null);
      return clip;
    }
    const clip = doCopy();
    removeElement();
    return clip;
  };
  const applyPaste = (clip: LadderClip, parallel = false) => {
    if (clip.kind === 'rungs') {
      const after = range ? range[1] : sel ? sel.rung : rungs.length - 1;
      const r = pasteRungs(rungs, after, clip, () => newId('rung'));
      if (!r) return setNote(lt('cannotPasteHere'));
      set(r.rungs);
      setExtra(r.to > r.from ? r.to : null);
      setSel({ rung: r.from, kind: 'rung' });
      show(r.from);
      return setNote(lt('pasted'));
    }
    if (!sel || !current) return setNote(lt('cannotPasteHere'));
    if (clip.kind === 'node') {
      const path = sel.kind === 'cell' ? sel.path : [];
      const r = pasteNode(current, path, clip, parallel ? 'parallel' : 'series');
      if (!r) return setNote(lt('cannotPasteHere'));
      replace(sel.rung, r.rung);
      const at = pathOf(r.rung.logic, r.node);
      if (at) setSel({ rung: sel.rung, kind: 'cell', path: at });
      return setNote(lt('pasted'));
    }
    const r = pasteCoil(current, sel.kind === 'coil' ? sel.index : current.outputs.length - 1, clip);
    if (!r) return setNote(lt('cannotPasteHere'));
    replace(sel.rung, r);
    setNote(lt('pasted'));
  };
  /** The clip to paste: text on the system clipboard when it is a ladder clip, else what was copied here. */
  const doPaste = async (parallel = false) => {
    let clip: LadderClip | null = null;
    try {
      const text = await navigator.clipboard?.readText();
      clip = text ? decodeLadderClip(text) : null;
    } catch {
      clip = null;
    }
    clip = clip ?? memoryClip;
    if (!clip) return setNote(lt('nothingToPaste'));
    applyPaste(clip, parallel);
  };
  const onCopy = (e: ClipboardEvent) => {
    if (isFormTarget(e.target)) return;
    const clip = remember(currentClip());
    if (!clip) return;
    e.clipboardData.setData('text/plain', encodeLadderClip(clip));
    e.preventDefault();
  };
  const onCut = (e: ClipboardEvent) => {
    if (isFormTarget(e.target)) return;
    const clip = doCut();
    if (!clip) return;
    e.clipboardData.setData('text/plain', encodeLadderClip(clip));
    e.preventDefault();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (isFormTarget(e.target)) return;
    const clip = decodeLadderClip(e.clipboardData.getData('text/plain')) ?? memoryClip;
    e.preventDefault();
    // the schematic's own paste handler (src/ui/files/install.ts) must not also run
    e.stopPropagation();
    if (!clip) return setNote(lt('nothingToPaste'));
    applyPaste(clip, false);
  };

  // ---- function blocks ---------------------------------------------------------------------
  const newBlockAction = () => {
    const b = newBlock(newId('block'), nextBlockName(blocks), newId('rung'));
    actions.setLadderBlocks([...blocks, b]);
    setMode({ kind: 'block', id: b.id });
    setSel(null);
    setExtra(null);
  };
  const deleteBlock = async (id: string) => {
    const b = blocks.find((x) => x.id === id);
    if (!b) return;
    if (!(await confirmDialog({ title: lt('deleteBlock'), message: lt('deleteBlockAsk', { name: b.name }), danger: true }))) return;
    actions.setLadderBlocks(blocks.filter((x) => x.id !== id));
    setMode({ kind: 'sheet' });
    setSel(null);
  };
  const editBlock = (id: string | null) => {
    setMode(id ? { kind: 'block', id } : { kind: 'sheet' });
    setSel(null);
    setExtra(null);
  };
  const openBlockByName = (name: string) => {
    const b = blocks.find((x) => x.name === name);
    if (b) editBlock(b.id);
  };

  // ---- cross-reference ---------------------------------------------------------------------
  const jump = (use: XrefUse) => {
    setExtra(null);
    if (use.scope.kind === 'block') {
      const name = use.scope.block;
      const b = blocks.find((x) => x.name === name);
      if (b) setMode({ kind: 'block', id: b.id });
    } else {
      setMode({ kind: 'sheet' });
      if (use.scope.sheetId !== sheetId) actions.setActiveSheet(use.scope.sheetId);
    }
    setSel(use.spot.kind === 'cell' ? { rung: use.rungIndex, kind: 'cell', path: use.spot.path } : { rung: use.rungIndex, kind: 'coil', index: use.spot.index });
    show(use.rungIndex);
  };

  const hasSel = sel !== null && current !== undefined;
  /**
   * Ctrl+C / Ctrl+X act on the selected rung or element (and keep the global shortcut, which would
   * copy schematic items, out of it). Ctrl+V is left to the browser so that its paste event brings
   * the clipboard text without asking for permission; it is only kept from the global shortcut.
   */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isFormTarget(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'v') {
      e.stopPropagation();
      return;
    }
    if ((key === 'c' || key === 'x') && hasSel) {
      if (key === 'c') doCopy();
      else doCut();
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const clipReady = memoryClip !== null;
  const wordKind = selCoil ? isWordOutput(selCoil.kind) : false;
  return (
    <div className="ms-l-view" role="tabpanel" ref={viewRef} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste}>
      <div className="ms-l-bar">
        {editingBlock ? (
          <>
            <span className="ms-l-editing">{`${lt('editing')}: ${editingBlock.name}`}</span>
            <button type="button" className="ms-btn" onClick={() => editBlock(null)}>
              {lt('backToProgram')}
            </button>
            <span className="ms-l-sep" />
          </>
        ) : null}
        <button type="button" className="ms-btn" onClick={addRung}>
          {lt('addRung')}
        </button>
        <button type="button" className="ms-btn" title={lt('tipAddSeries')} disabled={!hasSel} onClick={() => addElement('series')}>
          {lt('addSeries')}
        </button>
        <button type="button" className="ms-btn" title={lt('tipAddParallel')} disabled={!hasSel} onClick={() => addElement('parallel')}>
          {lt('addParallel')}
        </button>
        <button type="button" className="ms-btn" title={lt('tipAddCompare')} disabled={!hasSel} onClick={() => addElement('compare')}>
          {lt('addCompare')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel} onClick={addCoil}>
          {lt('addCoil')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel || sel.kind === 'rung'} onClick={removeElement}>
          {lt('removeElement')}
        </button>
        <span className="ms-l-sep" />
        <button type="button" className="ms-btn" title={lt('tipCopy')} disabled={!hasSel} onClick={() => doCopy()}>
          {lt('copy')}
        </button>
        <button type="button" className="ms-btn" title={lt('tipCut')} disabled={!hasSel} onClick={() => doCut()}>
          {lt('cut')}
        </button>
        <button type="button" className="ms-btn" title={lt('tipPaste')} onClick={() => void doPaste(false)}>
          {lt('paste')}
        </button>
        <button type="button" className="ms-btn" title={lt('tipPasteParallel')} disabled={!hasSel || !clipReady || memoryClip?.kind !== 'node'} onClick={() => void doPaste(true)}>
          {lt('pasteParallel')}
        </button>
        <span className="ms-l-sep" />
        <button type="button" className="ms-btn" disabled={!hasSel || !!range} onClick={() => move(-1)}>
          {lt('moveUp')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel || !!range} onClick={() => move(1)}>
          {lt('moveDown')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel} onClick={toggleRung}>
          {lt('toggleRung')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel} onClick={deleteRung}>
          {lt('deleteRung')}
        </button>
        <span className="ms-l-sep" />
        <button type="button" className={`ms-btn${panel === 'blocks' ? ' is-active' : ''}`} aria-pressed={panel === 'blocks'} title={lt('blocksIntro')} onClick={() => setPanel(panel === 'blocks' ? 'none' : 'blocks')}>
          {lt('blocksTitle')}
        </button>
        <button type="button" className={`ms-btn${panel === 'xref' ? ' is-active' : ''}`} aria-pressed={panel === 'xref'} title={lt('xrefIntro')} onClick={() => setPanel(panel === 'xref' ? 'none' : 'xref')}>
          {lt('xref')}
        </button>
        <button type="button" className="ms-btn" onClick={() => void openHelp({ kind: 'guide', page: 'ladder' })}>
          {lt('help')}
        </button>
        {note ? (
          <span className="ms-l-note" role="status">
            {note}
          </span>
        ) : range ? (
          <span className="ms-l-note">{lt('rungsSelected', { n: range[1] - range[0] + 1 })}</span>
        ) : null}
        {compiled.errors.length ? <span className="ms-l-badge">{lt('problems', { n: compiled.errors.length })}</span> : null}
      </div>

      {panel === 'blocks' ? <BlockPanel design={design} blocks={blocks} editingId={editingBlock?.id ?? null} onEdit={editBlock} onNew={newBlockAction} onChange={(id, patch) => actions.setLadderBlocks(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)))} onRename={(id, name) => actions.renameLadderBlock(id, name)} onDelete={(id) => void deleteBlock(id)} /> : null}
      {panel === 'xref' ? <XrefPanel entries={xref} onJump={jump} /> : null}

      <div className="ms-l-canvas">
        {rungs.length === 0 ? (
          <p className="ms-l-empty">{lt('empty')}</p>
        ) : (
          <Diagram rungs={rungs} cols={1} errors={compiled.errors} slots={editingBlock ? null : (live?.slots ?? null)} sel={sel} range={range} onPick={pick} />
        )}
        {rungs.length > 1 ? <p className="ms-l-hint">{lt('extendHint')}</p> : null}
      </div>

      <div className="ms-l-inspect">
        {!hasSel ? (
          <p className="ms-l-hint">{lt('selectHint')}</p>
        ) : (
          <>
            <label>
              {lt('rungComment')}
              <input type="text" value={current.comment ?? ''} title={lt('rungCommentHint')} onChange={(e) => replace(sel.rung, { ...current, comment: e.target.value })} />
            </label>
            {selNode && selNode.kind === 'contact' ? (
              <>
                <label>
                  {lt('contactType')}
                  <select value={selNode.type} onChange={(e) => editNode({ type: e.target.value as LadderContactKind })}>
                    {CONTACT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {contactText(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {lt('address')}
                  <input type="text" value={selNode.address} title={lt('addressHint')} onChange={(e) => editNode({ address: e.target.value })} />
                </label>
              </>
            ) : null}
            {selNode && selNode.kind === 'compare' ? (
              <>
                <label>
                  {lt('left')}
                  <input type="text" value={selNode.left} title={lt('numberHint')} onChange={(e) => editNode({ left: e.target.value })} />
                </label>
                <label>
                  {lt('operator')}
                  <select value={selNode.op} onChange={(e) => editNode({ op: e.target.value as LadderCompareOp })}>
                    {OPS.map((k) => (
                      <option key={k} value={k}>
                        {`${COMPARE_SYMBOL[k]}  ${compareText(k)}`}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {lt('right')}
                  <input type="text" value={selNode.right} title={lt('numberHint')} onChange={(e) => editNode({ right: e.target.value })} />
                </label>
              </>
            ) : null}
            {selCoil ? (
              <>
                <label>
                  {lt('coilKind')}
                  <select value={selCoil.kind} onChange={(e) => retypeCoil(e.target.value as LadderOutputKind)}>
                    {OUTPUT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {outputText(k)}
                      </option>
                    ))}
                  </select>
                </label>
                {selCoil.kind === 'call' ? (
                  <CallFields output={selCoil} blocks={blocks} onEdit={editCoil} onOpenBlock={openBlockByName} />
                ) : (
                  <label>
                    {wordKind ? lt('destination') : lt('address')}
                    <input type="text" value={selCoil.address} title={wordKind ? lt('wordHint') : lt('addressHint')} onChange={(e) => editCoil({ address: e.target.value })} />
                  </label>
                )}
                {wordKind ? (
                  <>
                    <label>
                      {lt('operandA')}
                      <input type="text" value={selCoil.a ?? ''} title={lt('operandHint')} onChange={(e) => editCoil({ a: e.target.value })} />
                    </label>
                    {selCoil.kind !== 'mov' ? (
                      <label>
                        {lt('operandB')}
                        <input type="text" value={selCoil.b ?? ''} title={lt('operandHint')} onChange={(e) => editCoil({ b: e.target.value })} />
                      </label>
                    ) : null}
                    <span className="ms-l-hint ms-l-wide">{lt('wordHint')}</span>
                  </>
                ) : null}
                {isTimerOutput(selCoil.kind) || (isCounterOutput(selCoil.kind) && selCoil.kind !== 'creset') ? (
                  <label>
                    {isTimerOutput(selCoil.kind) ? lt('presetTime') : lt('presetCount')}
                    <input type="text" value={selCoil.preset ?? ''} onChange={(e) => editCoil({ preset: e.target.value })} />
                  </label>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="ms-l-live">
        {live ? (
          <>
            <span className="ms-l-on">{lt('live')}</span>
            <span>{lt('scans', { n: live.scans })}</span>
            {live.inputs.map((v, k) => (
              <Bits key={`i${k}`} label={`I${k}`} value={v} />
            ))}
            {live.outputs.map((v, k) => (
              <Bits key={`q${k}`} label={`Q${k}`} value={v} />
            ))}
            {live.mem.map((v, k) => (
              <Bits key={`m${k}`} label={`M${k}`} value={v} />
            ))}
            {live.timers.map((x, k) => (
              <span key={`t${k}`} className={x.done ? 'ms-l-timer is-on' : 'ms-l-timer'}>
                {`T${k + 1} ${x.elapsed.toFixed(2)}`}
                <span className="ms-l-unit">{SECOND}</span>
              </span>
            ))}
            {live.counters.map((x, k) => (
              <span key={`c${k}`} className={x.done ? 'ms-l-timer is-on' : 'ms-l-timer'}>{`C${k + 1} ${x.value}`}</span>
            ))}
            {(live.words ?? []).map((v, k) => (
              <span key={`w${k}`} className="ms-l-timer" title={lt('words')}>{`${WORD_PREFIX}${k} ${v}`}</span>
            ))}
            {(live.analogOut ?? []).map((v, k) => (
              <span key={`a${k}`} className="ms-l-timer" title={lt('analogOutputs')}>
                {`${ANALOG_PREFIX}${k} ${v.toFixed(2)}`}
                <span className="ms-l-unit">V</span>
              </span>
            ))}
            {live.mathErrors ? <span className="ms-l-problem-text">{lt('mathErrors', { n: live.mathErrors })}</span> : null}
          </>
        ) : (
          <span className="ms-l-hint">{lt('liveOff')}</span>
        )}
      </div>
    </div>
  );
}

export default LadderSheetView;
