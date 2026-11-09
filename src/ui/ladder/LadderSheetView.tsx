/**
 * The ladder-diagram editor: the view that replaces the schematic canvas while a ladder sheet is
 * open (App.tsx chooses between them by `Sheet.kind`).
 *
 *   ┌ toolbar: add rung / in series / in parallel / comparison / coil / delete / move ───┐
 *   │ rails and rungs (SVG): ─┤ ├──┤/├──────( )─                                        │
 *   ├ inspector: what the selected contact or coil is, its address, its preset ──────────┤
 *   └ live strip: scans, timers, counters and the input / output image while it runs ─────┘
 *
 * Everything the view does goes through the pure layers, which is why the drawing and the running
 * program always agree: `layoutLadder` (src/ladder/layout.ts) places the elements on a grid and
 * gives each one the same slot number the compiler gives it, `compileLadder` reports the problems
 * of each rung, and the editing functions of src/ladder/edit.ts return new rungs for one undo
 * step (`actions.setLadderRungs`). While a simulation runs, `EditorState.ladderLive` says which
 * slots carry power and the conducting elements light up.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { actions, useEditor } from '../store';
import { getSheet } from '../store/designOps';
import { layoutLadder, rungErrors, type LadderCell, type LadderCoil, type RungLayout } from '../../ladder/layout';
import { COMPARE_SYMBOL, OUTPUT_CODE, compileLadder, isCounterOutput, isTimerOutput, type LadderError } from '../../ladder/program';
import { addOutput, insertParallel, insertSeries, moveRung, newRung, nodeAt, pathOf, removeNode, removeOutput, replaceNode, withLogic, withOutput } from '../../ladder/edit';
import type { LadderContactKind, LadderCompareOp, LadderNode, LadderOutput, LadderOutputKind, LadderRung } from '../../ladder/types';
import { compareText, contactText, ladderErrorText, lt, outputText } from '../../i18n/ladderText';
import { newId } from '../store/ids';
import { openHelp } from '../help/open';
import { LADDER_COIL_COL, LADDER_COL, LADDER_HEAD, LADDER_RAIL_LEFT, LADDER_ROW, ladderRungHeight } from '../editor/ladderSvg';

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

type Sel = { rung: number; kind: 'cell'; path: number[] } | { rung: number; kind: 'coil'; index: number } | { rung: number; kind: 'rung' };

const CONTACT_KINDS: LadderContactKind[] = ['no', 'nc', 'rising', 'falling'];
const OPS: LadderCompareOp[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];
const OUTPUT_KINDS: LadderOutputKind[] = ['coil', 'coil-not', 'set', 'reset', 'ton', 'tof', 'ctu', 'ctd', 'creset'];

const newContact = (): LadderNode => ({ kind: 'contact', type: 'no', address: 'I0.0' });
const newCompare = (): LadderNode => ({ kind: 'compare', op: 'gt', left: 'AI0', right: '5' });

/** Height of one rung block in pixels. */
const rungHeight = ladderRungHeight;

/** One contact of a rung, drawn at its grid place. */
function Cell({ cell, x0, y0, live, selected, onPick }: { cell: LadderCell; x0: number; y0: number; live: boolean; selected: boolean; onPick: () => void }) {
  const cx = x0 + cell.col * COL + COL / 2;
  const cy = y0 + cell.row * ROW + ROW / 2;
  const node = cell.node;
  const label = node.kind === 'contact' ? node.address : node.kind === 'compare' ? `${node.left} ${COMPARE_SYMBOL[node.op]} ${node.right}` : '';
  const mark = node.kind === 'contact' ? (node.type === 'rising' ? 'P' : node.type === 'falling' ? 'N' : '') : '';
  const cls = `ms-l-el${live ? ' is-live' : ''}${selected ? ' is-selected' : ''}`;
  return (
    <g className={cls} onPointerDown={onPick} role="button" tabIndex={-1} aria-label={label}>
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

/** One coil of a rung, drawn against the right rail. */
function Coil({ coil, x, y0, live, selected, onPick }: { coil: LadderCoil; x: number; y0: number; live: boolean; selected: boolean; onPick: () => void }) {
  const cy = y0 + coil.row * ROW + ROW / 2;
  const o = coil.output;
  const code = OUTPUT_CODE[o.kind];
  const cls = `ms-l-el ms-l-coil${live ? ' is-live' : ''}${selected ? ' is-selected' : ''}`;
  const cx = x + 40;
  return (
    <g className={cls} onPointerDown={onPick} role="button" tabIndex={-1} aria-label={o.address}>
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
  onPick,
}: {
  rungs: readonly LadderRung[];
  cols: number;
  errors: readonly LadderError[];
  slots: boolean[] | null;
  sel: Sel | null;
  onPick: (s: Sel) => void;
}) {
  const layout = useMemo(() => layoutLadder(rungs), [rungs]);
  const width = RAIL_LEFT + Math.max(cols, layout.cols) * COL + COIL_COL + 40;
  let y = 0;
  const blocks: ReactElement[] = [];
  layout.rungs.forEach((r, i) => {
    const rung = rungs[i];
    const top = y;
    const y0 = top + HEAD;
    const x0 = RAIL_LEFT;
    const railR = RAIL_LEFT + Math.max(cols, layout.cols) * COL + COIL_COL;
    const problems = rungErrors(errors, i);
    const live = (slot: number) => !!slots?.[slot];
    blocks.push(
      <g key={rung.id} className={`ms-l-rung${rung.disabled ? ' is-off' : ''}${problems.length ? ' is-bad' : ''}${sel?.rung === i ? ' is-current' : ''}`}>
        <rect x={0} y={top} width={width} height={rungHeight(r)} className="ms-l-rungbox" onPointerDown={() => onPick({ rung: i, kind: 'rung' })} />
        <text x={RAIL_LEFT + 4} y={top + 15} className="ms-l-comment">
          {`${lt('rung', { n: i + 1 })}${rung.comment ? ` — ${rung.comment}` : ''}${rung.disabled ? ` ${lt('disabled')}` : ''}`}
        </text>
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
            onPick={() => onPick({ rung: i, kind: 'cell', path: c.path })}
          />
        ))}
        {r.coils.map((c) => (
          <Coil key={c.index} coil={c} x={railR - 40} y0={y0} live={live(c.slot)} selected={sel?.rung === i && sel.kind === 'coil' && sel.index === c.index} onPick={() => onPick({ rung: i, kind: 'coil', index: c.index })} />
        ))}
        {problems.length ? (
          <text x={RAIL_LEFT + 4} y={top + rungHeight(r) - 2} className="ms-l-problem">
            {ladderErrorText(problems[0])}
          </text>
        ) : null}
      </g>,
    );
    y += rungHeight(r);
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

export function LadderSheetView() {
  const design = useEditor((s) => s.design);
  const sheetId = useEditor((s) => s.activeSheetId);
  const live = useEditor((s) => s.ladderLive);
  const sheet = getSheet(design, sheetId);
  const rungs = sheet?.ladder ?? [];
  const [sel, setSel] = useState<Sel | null>(null);
  const compiled = useMemo(() => compileLadder(rungs), [rungs]);

  const set = (next: LadderRung[]) => actions.setLadderRungs(sheetId, next);
  const replace = (index: number, rung: LadderRung) => set(rungs.map((r, i) => (i === index ? rung : r)));
  const current = sel ? rungs[sel.rung] : undefined;
  const selNode = sel && sel.kind === 'cell' && current ? nodeAt(current.logic, sel.path) : undefined;
  const selCoil = sel && sel.kind === 'coil' && current ? current.outputs[sel.index] : undefined;

  const addRung = () => {
    const next = [...rungs, newRung(newId('rung'))];
    set(next);
    setSel({ rung: next.length - 1, kind: 'cell', path: [] });
  };
  const addElement = (how: 'series' | 'parallel' | 'compare') => {
    if (!sel || !current) return;
    const node = how === 'compare' ? newCompare() : newContact();
    const path = sel.kind === 'cell' ? sel.path : [];
    const logic =
      how === 'parallel' ? insertParallel(current.logic, path, node) : insertSeries(current.logic, path, node);
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
    set(rungs.filter((_r, i) => i !== sel.rung));
    setSel(null);
  };
  const move = (by: number) => {
    if (!sel) return;
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

  const hasSel = sel !== null && current !== undefined;
  return (
    <div className="ms-l-view" role="tabpanel">
      <div className="ms-l-bar">
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
        <button type="button" className="ms-btn" disabled={!hasSel} onClick={() => move(-1)}>
          {lt('moveUp')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel} onClick={() => move(1)}>
          {lt('moveDown')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel} onClick={toggleRung}>
          {lt('toggleRung')}
        </button>
        <button type="button" className="ms-btn" disabled={!hasSel} onClick={deleteRung}>
          {lt('deleteRung')}
        </button>
        <span className="ms-l-sep" />
        <button type="button" className="ms-btn" onClick={() => void openHelp({ kind: 'guide', page: 'ladder' })}>
          {lt('help')}
        </button>
        {compiled.errors.length ? <span className="ms-l-badge">{lt('problems', { n: compiled.errors.length })}</span> : null}
      </div>

      <div className="ms-l-canvas">
        {rungs.length === 0 ? (
          <p className="ms-l-empty">{lt('empty')}</p>
        ) : (
          <Diagram rungs={rungs} cols={1} errors={compiled.errors} slots={live?.slots ?? null} sel={sel} onPick={setSel} />
        )}
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
                  <select value={selCoil.kind} onChange={(e) => editCoil({ kind: e.target.value as LadderOutputKind })}>
                    {OUTPUT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {outputText(k)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {lt('address')}
                  <input type="text" value={selCoil.address} title={lt('addressHint')} onChange={(e) => editCoil({ address: e.target.value })} />
                </label>
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
          </>
        ) : (
          <span className="ms-l-hint">{lt('liveOff')}</span>
        )}
      </div>
    </div>
  );
}

export default LadderSheetView;
