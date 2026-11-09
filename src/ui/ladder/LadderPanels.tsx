/**
 * Panels of the ladder editor that sit beside the diagram:
 *
 * - {@link BlockPanel}: the function blocks of the design — list, new, delete, and the name,
 *   description and parameters of the block being edited (the rungs themselves are edited in the
 *   diagram, which switches to the block's rungs);
 * - {@link XrefPanel}: the address cross-reference — where each address is read and written, with
 *   a click on a rung number to jump to that rung;
 * - {@link CallFields}: the inspector fields of a `call` coil (block, instance name, arguments).
 */
import { useEffect, useMemo, useState } from 'react';
import { isIdentifier } from '../../ladder/blocks';
import { argsFor, countCalls } from '../../ladder/editBlocks';
import { addressKindText, lt } from '../../i18n/ladderText';
import { xrefText, xrefWarnings, type XrefEntry, type XrefUse } from '../../ladder/xref';
import type { LadderBlock, LadderOutput } from '../../ladder/types';
import type { Design } from '../../model/types';

/** A text box that only commits on Enter or when it loses focus (a rename must not be one undo step per key). */
export function CommitInput({ value, onCommit, title, minWidth }: { value: string; onCommit: (v: string) => void; title?: string; minWidth?: number }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const done = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <input
      type="text"
      value={text}
      title={title}
      style={minWidth ? { minWidth } : undefined}
      onChange={(e) => setText(e.target.value)}
      onBlur={done}
      onKeyDown={(e) => {
        if (e.key === 'Enter') done();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

const splitNames = (text: string): string[] =>
  text
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function BlockPanel({
  design,
  blocks,
  editingId,
  onEdit,
  onNew,
  onChange,
  onRename,
  onDelete,
}: {
  design: Design;
  blocks: readonly LadderBlock[];
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onNew: () => void;
  onChange: (id: string, patch: Partial<LadderBlock>) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const editing = blocks.find((b) => b.id === editingId);
  const [problem, setProblem] = useState('');
  const rename = (name: string) => {
    if (!editing) return;
    const n = name.trim();
    const clash = blocks.some((b) => b.id !== editing.id && b.name.trim().toLowerCase() === n.toLowerCase());
    if (!isIdentifier(n) || clash) {
      setProblem(lt('blockNameTaken', { name: n }));
      return;
    }
    setProblem('');
    onRename(editing.id, n);
  };
  const formals = (key: 'inputs' | 'outputs', text: string) => {
    if (!editing) return;
    const names = splitNames(text);
    onChange(editing.id, { [key]: names });
  };
  return (
    <div className="ms-l-panel" role="region" aria-label={lt('blocksTitle')}>
      <p className="ms-l-hint">{lt('blocksIntro')}</p>
      <div className="ms-l-blocklist">
        {blocks.length === 0 ? <span className="ms-l-hint">{lt('noBlocks')}</span> : null}
        {blocks.map((b) => (
          <button key={b.id} type="button" className={`ms-btn${b.id === editingId ? ' is-active' : ''}`} aria-pressed={b.id === editingId} onClick={() => onEdit(b.id === editingId ? null : b.id)} title={b.comment ?? ''}>
            {b.name} <span className="ms-l-unit">({lt('blockUsedBy', { n: countCalls(design, b.name) })})</span>
          </button>
        ))}
        <button type="button" className="ms-btn" onClick={onNew}>
          {lt('newBlock')}
        </button>
      </div>
      {editing ? (
        <div className="ms-l-blockform">
          <label>
            {lt('blockName')}
            <CommitInput value={editing.name} onCommit={rename} />
          </label>
          <label>
            {lt('blockComment')}
            <CommitInput value={editing.comment ?? ''} minWidth={240} onCommit={(v) => onChange(editing.id, { comment: v })} />
          </label>
          <label>
            {lt('blockInputs')}
            <CommitInput value={editing.inputs.join(', ')} onCommit={(v) => formals('inputs', v)} />
          </label>
          <label>
            {lt('blockOutputs')}
            <CommitInput value={editing.outputs.join(', ')} onCommit={(v) => formals('outputs', v)} />
          </label>
          <button type="button" className="ms-btn" onClick={() => onDelete(editing.id)}>
            {lt('deleteBlock')}
          </button>
          {problem ? <span className="ms-l-problem-text">{problem}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function XrefPanel({ entries, onJump }: { entries: readonly XrefEntry[]; onJump: (use: XrefUse) => void }) {
  const [filter, setFilter] = useState('');
  const warnings = useMemo(() => xrefWarnings(entries), [entries]);
  const warnOf = (e: XrefEntry) => warnings.find((w) => w.address === e.address && w.kind === e.kind);
  const q = filter.trim().toLowerCase();
  const shown = q ? entries.filter((e) => e.address.toLowerCase().includes(q) || addressKindText(e.kind).toLowerCase().includes(q)) : entries;
  const copy = () => {
    void navigator.clipboard?.writeText(xrefText(entries)).catch(() => undefined);
  };
  const links = (e: XrefEntry, role: 'read' | 'write') => {
    const seen = new Set<string>();
    return e.uses
      .filter((u) => u.role === role)
      .map((u) => {
        const label = u.scope.kind === 'block' ? `${u.scope.block}:${u.rungIndex + 1}` : `${u.rungIndex + 1}`;
        const key = `${u.scope.kind === 'block' ? u.scope.block : u.scope.sheetId}|${u.rungIndex}`;
        if (seen.has(key)) return null;
        seen.add(key);
        return (
          <button key={`${key}|${u.spot.kind}`} type="button" className="ms-l-jump" title={u.scope.kind === 'sheet' ? u.scope.sheetName : u.scope.block} onClick={() => onJump(u)}>
            {label}
          </button>
        );
      });
  };
  return (
    <div className="ms-l-panel" role="region" aria-label={lt('xref')}>
      <div className="ms-l-xrefbar">
        <strong>{lt('xref')}</strong>
        <input type="search" value={filter} placeholder={lt('xrefFilter')} aria-label={lt('xrefFilter')} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className="ms-btn" onClick={copy} disabled={entries.length === 0}>
          {lt('xrefCopy')}
        </button>
      </div>
      <p className="ms-l-hint">{lt('xrefIntro')}</p>
      {entries.length === 0 ? (
        <p className="ms-l-hint">{lt('xrefEmpty')}</p>
      ) : (
        <table className="ms-l-xref">
          <thead>
            <tr>
              <th>{lt('colAddress')}</th>
              <th>{lt('colKind')}</th>
              <th>{lt('colWrites')}</th>
              <th>{lt('colReads')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const w = warnOf(e);
              return (
                <tr key={`${e.kind}|${e.address}`} className={w ? 'is-warn' : undefined}>
                  <td>
                    <code>{e.address}</code>
                    {w ? (
                      <span className="ms-l-warn" title={`${e.address} ${w.code === 'neverWritten' ? lt('warnNeverWritten') : lt('warnNeverRead')}`}>
                        {' ⚠'}
                      </span>
                    ) : null}
                  </td>
                  <td>{addressKindText(e.kind)}</td>
                  <td>{links(e, 'write')}</td>
                  <td>{links(e, 'read')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Inspector fields of a function-block call: which block, the instance name and the arguments. */
export function CallFields({ output, blocks, onEdit, onOpenBlock }: { output: LadderOutput; blocks: readonly LadderBlock[]; onEdit: (patch: Partial<LadderOutput>) => void; onOpenBlock: (name: string) => void }) {
  const block = blocks.find((b) => b.name === output.block);
  const args = block ? argsFor(block, output.args) : (output.args ?? {});
  const setArg = (name: string, value: string) => onEdit({ args: { ...args, [name]: value } });
  return (
    <>
      <label>
        {lt('blockLabel')}
        <select value={output.block ?? ''} onChange={(e) => onEdit({ block: e.target.value })}>
          {!block ? <option value={output.block ?? ''}>{output.block || '—'}</option> : null}
          {blocks.map((b) => (
            <option key={b.id} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {lt('instanceName')}
        <input type="text" value={output.address} title={lt('instanceHint')} onChange={(e) => onEdit({ address: e.target.value })} />
      </label>
      {block ? (
        <>
          <span className="ms-l-argtitle">{lt('argsTitle')}</span>
          {block.inputs.map((n) => (
            <label key={`i${n}`}>
              {`${n} (${lt('argInput')})`}
              <input type="text" value={args[n] ?? ''} onChange={(e) => setArg(n, e.target.value)} />
            </label>
          ))}
          {block.outputs.map((n) => (
            <label key={`o${n}`}>
              {`${n} (${lt('argOutput')})`}
              <input type="text" value={args[n] ?? ''} onChange={(e) => setArg(n, e.target.value)} />
            </label>
          ))}
          <button type="button" className="ms-btn" onClick={() => onOpenBlock(block.name)}>
            {lt('editing')} {block.name}
          </button>
        </>
      ) : null}
    </>
  );
}
