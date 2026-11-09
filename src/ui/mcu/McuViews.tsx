/**
 * Read-out views of the MCU code editor: the register page, the special registers, the internal
 * RAM window, the port bits, the serial terminal, the listing with its breakpoint marks and the
 * symbol table. Split out of McuPanel.tsx so each view stays short and readable.
 */
import { useState, type ReactNode } from 'react';
import { mt } from '../../i18n/mcuText';
import { formatEng } from '../../util/units';
import type { AsmResult } from '../../mcu/asm8051';
import { bits, cyclesAt, hex, mcuTime, pswFlags, type McuView } from './mcuModel';

const SFR_ORDER: readonly string[] = ['TMOD', 'TCON', 'TL0', 'TH0', 'TL1', 'TH1', 'IE', 'IP', 'SCON', 'SBUF', 'PCON'];

function Cell({ label, value, title }: { label: string; value: string; title?: string }): ReactNode {
  return (
    <div className="ms-mcu-cell" title={title}>
      <span className="ms-mcu-cell-label">{label}</span>
      <span className="ms-mcu-cell-value">{value}</span>
    </div>
  );
}

/** Registers, the program counter, the flags and the cycle counter. */
export function RegisterView({ view, fosc }: { view: McuView; fosc: number }): ReactNode {
  const f = pswFlags(view.psw);
  return (
    <div className="ms-mcu-view">
      <div className="ms-mcu-grid">
        <Cell label="PC" value={`${hex(view.pc, 4)}h`} />
        <Cell label="A" value={`${hex(view.a)}h = ${view.a}`} />
        <Cell label="B" value={`${hex(view.b)}h = ${view.b}`} />
        <Cell label="SP" value={`${hex(view.sp)}h`} />
        <Cell label="DPTR" value={`${hex(view.dptr, 4)}h`} />
        <Cell label="PSW" value={`${hex(view.psw)}h`} />
      </div>
      <div className="ms-mcu-grid">
        {view.regs.map((v, k) => (
          <Cell key={k} label={`R${k}`} value={`${hex(v)}h = ${v}`} />
        ))}
      </div>
      <div className="ms-mcu-flags">
        <span className="ms-mcu-cell-label">{mt('flags')}</span>
        {(
          [
            ['CY', f.cy],
            ['AC', f.ac],
            ['F0', f.f0],
            ['OV', f.ov],
            ['P', f.p],
          ] as [string, number][]
        ).map(([name, on]) => (
          <span key={name} className={on ? 'ms-mcu-flag is-on' : 'ms-mcu-flag'}>
            {name}
          </span>
        ))}
        <span className="ms-mcu-cell-label">{mt('bank')}</span>
        <span className="ms-mcu-flag is-on">{f.bank}</span>
      </div>
      <div className="ms-mcu-grid">
        <Cell label={mt('cycles')} value={String(Math.round(view.cycles))} />
        <Cell label={mt('simTime')} value={formatEng(mcuTime(view.cycles, fosc), 's', 4)} />
      </div>
    </div>
  );
}

/** The special function registers the learner uses most. */
export function SfrView({ view }: { view: McuView }): ReactNode {
  return (
    <div className="ms-mcu-view">
      <div className="ms-mcu-grid">
        {SFR_ORDER.map((name) => (
          <Cell key={name} label={name} value={`${hex(view.sfr[name] ?? 0)}h`} />
        ))}
      </div>
      <div className="ms-mcu-grid">
        {view.ports.map((v, k) => (
          <Cell key={k} label={`P${k}`} value={`${hex(v)}h`} />
        ))}
      </div>
    </div>
  );
}

/** 16 bytes of internal RAM from a base address the learner can move. */
export function RamView({ view, onBase }: { view: McuView; onBase: (base: number) => void }): ReactNode {
  const base = view.ramBase & 0xf0;
  return (
    <div className="ms-mcu-view">
      <div className="ms-mcu-row">
        <label className="ms-mcu-cell-label" htmlFor="ms-mcu-ram-base">
          {mt('ramFrom')}
        </label>
        <select
          id="ms-mcu-ram-base"
          className="ms-input ms-input-small"
          title={mt('tipRamFrom')}
          value={String(base)}
          onChange={(e) => onBase(Number(e.target.value))}
        >
          {Array.from({ length: 16 }, (_, k) => k * 16).map((a) => (
            <option key={a} value={String(a)}>{`${hex(a)}h`}</option>
          ))}
        </select>
      </div>
      <table className="ms-mcu-table">
        <tbody>
          <tr>
            <th scope="row">{`${hex(base)}h`}</th>
            {view.ram.slice(0, 8).map((v, k) => (
              <td key={k}>{hex(v)}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">{`${hex(base + 8)}h`}</th>
            {view.ram.slice(8, 16).map((v, k) => (
              <td key={k}>{hex(v)}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <p className="ms-hint">{mt('ramHint')}</p>
    </div>
  );
}

/** The four ports as bit boxes, most significant bit first. */
export function PortView({ view }: { view: McuView }): ReactNode {
  return (
    <div className="ms-mcu-view">
      {view.ports.map((value, port) => (
        <div className="ms-mcu-row" key={port}>
          <span className="ms-mcu-cell-label">{`P${port}`}</span>
          {bits(value).map((b, k) => (
            <span key={k} className={b ? 'ms-mcu-bit is-on' : 'ms-mcu-bit'} title={`P${port}.${7 - k}`}>
              {b}
            </span>
          ))}
          <span className="ms-mcu-cell-value">{`${hex(value)}h`}</span>
        </div>
      ))}
      <p className="ms-hint">{mt('portHint')}</p>
    </div>
  );
}

/** The serial window: what the program sent, and a box for what to send back. */
export function TerminalView({
  text,
  view,
  onSend,
  onClear,
  canSend,
}: {
  text: string;
  view: McuView;
  onSend: (text: string, newline: boolean) => void;
  onClear: () => void;
  canSend: boolean;
}): ReactNode {
  const [line, setLine] = useState('');
  const [newline, setNewline] = useState(true);
  const send = () => {
    if (!canSend || line.length === 0) return;
    onSend(line, newline);
    setLine('');
  };
  return (
    <div className="ms-mcu-view">
      <pre className="ms-mcu-terminal" aria-label={mt('tabTerminal')}>
        {text}
      </pre>
      <div className="ms-mcu-row">
        <input
          className="ms-input"
          value={line}
          disabled={!canSend}
          placeholder={mt('terminalInput')}
          aria-label={mt('terminalInput')}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="ms-btn ms-btn-small" disabled={!canSend || line.length === 0} onClick={send}>
          {mt('terminalSend')}
        </button>
        <label className="ms-mcu-check">
          <input type="checkbox" checked={newline} onChange={(e) => setNewline(e.target.checked)} />
          {mt('terminalNewline')}
        </label>
        <button type="button" className="ms-btn ms-btn-small" onClick={onClear}>
          {mt('terminalClear')}
        </button>
      </div>
      <p className="ms-hint">{mt('terminalSentCount', { rx: view.rxCount, tx: view.txCount })}</p>
      <p className="ms-hint">{mt('terminalHint')}</p>
    </div>
  );
}

/** The listing: address, machine code, source, with a breakpoint toggle and the current line. */
export function ListingView({
  asm,
  breaks,
  currentLine,
  onToggle,
  fosc = 12e6,
}: {
  asm: AsmResult | null;
  breaks: ReadonlySet<number>;
  currentLine: number | undefined;
  onToggle: (line: number) => void;
  /** crystal frequency, for the time of each instruction */
  fosc?: number;
}): ReactNode {
  if (!asm) return <p className="ms-empty">{mt('noListing')}</p>;
  return (
    <div className="ms-mcu-view">
      <ol className="ms-mcu-listing">
        {asm.lines.map((l) => {
          const hasCode = l.bytes.length > 0;
          /** an instruction line (a DB / DW line has bytes but no cycles) */
          const isInsn = hasCode && l.addr !== undefined && asm.addrLine.get(l.addr) === l.line;
          const isBreak = breaks.has(l.line);
          const isCurrent = currentLine === l.line;
          return (
            <li key={l.line} className={isCurrent ? 'ms-mcu-line is-current' : 'ms-mcu-line'}>
              <button
                type="button"
                className={isBreak ? 'ms-mcu-break is-on' : 'ms-mcu-break'}
                disabled={!hasCode}
                title={mt('toggleBreak')}
                aria-label={mt('toggleBreak')}
                aria-pressed={isBreak}
                onClick={() => onToggle(l.line)}
              >
                {isBreak ? '●' : '·'}
              </button>
              <span className="ms-mcu-addr">{hasCode && l.addr !== undefined ? hex(l.addr, 4) : ''}</span>
              <span className="ms-mcu-bytes">{l.bytes.map((b) => hex(b)).join(' ')}</span>
              <span className="ms-mcu-cyc" title={isInsn ? mt('tipListCyclesTime', { n: cyclesAt(l.bytes, 0), time: formatEng(mcuTime(cyclesAt(l.bytes, 0), fosc), 's') }) : undefined}>
                {isInsn ? cyclesAt(l.bytes, 0) : ''}
              </span>
              <span className="ms-mcu-src">{l.text}</span>
            </li>
          );
        })}
      </ol>
      {currentLine !== undefined ? <p className="ms-hint">{`${mt('currentLine')}: ${currentLine}`}</p> : null}
    </div>
  );
}

/** Labels and constants the program declared. */
export function SymbolView({ asm }: { asm: AsmResult | null }): ReactNode {
  if (!asm || asm.symbols.length === 0) return <p className="ms-empty">{mt('noSymbols')}</p>;
  const kindText = (kind: string) => (kind === 'label' ? mt('kindLabel') : kind === 'bit' ? mt('kindBit') : mt('kindNumber'));
  return (
    <table className="ms-mcu-table ms-mcu-symbols">
      <thead>
        <tr>
          <th scope="col">{mt('symbolName')}</th>
          <th scope="col">{mt('symbolValue')}</th>
          <th scope="col">{mt('symbolKind')}</th>
          <th scope="col">{mt('lineLabel', { line: '' }).trim()}</th>
        </tr>
      </thead>
      <tbody>
        {asm.symbols.map((s) => (
          <tr key={s.name}>
            <td>{s.name}</td>
            <td>{`${hex(s.value, s.value > 0xff ? 4 : 2)}h`}</td>
            <td>{kindText(s.kind)}</td>
            <td>{s.line}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
