import { describe, expect, it } from 'vitest';
import { deleteMarkers, ercReportTable, ercReportText, ercSummary, keepMarkers, markerInScope, type ErcReportTexts } from './ercReport';
import type { ErcMessage } from './types';

const markers: ErcMessage[] = [
  { severity: 'error', code: 'no-ground', message: 'The circuit has no ground' },
  { severity: 'warning', code: 'floating-pin', message: 'R1 pin 2 is not connected', sheetId: 'sheet1', refdes: 'R1', pin: '2', x: 40, y: 10.4 },
  { severity: 'warning', code: 'floating-pin', message: 'U3 pin 7 is not connected', sheetId: 'sheet2', refdes: 'U3', pin: '7', x: 120, y: 60 },
  { severity: 'error', code: 'pin-type', message: 'Net OUT: two outputs', sheetId: 'sheet1', refdes: 'U1', net: 'OUT' },
];

const texts: ErcReportTexts = {
  title: 'ERC report',
  caption: '2 error(s), 2 warning(s)',
  clean: 'No problems were found.',
  columns: { severity: 'Severity', rule: 'Rule', sheet: 'Sheet', refdes: 'Part', pin: 'Pin', net: 'Net', position: 'Position', problem: 'Problem', why: 'Why', fix: 'How to fix' },
  of: (m) => ({ severity: m.severity, rule: m.code, title: m.message, why: `why ${m.code}`, fix: `fix ${m.code}`, sheet: m.sheetId === 'sheet1' ? 'Sheet 1' : m.sheetId === 'sheet2' ? 'Sheet 2' : '' }),
};

describe('marker scopes', () => {
  it('takes everything in the "all" scope', () => {
    expect(deleteMarkers(markers, 'all')).toHaveLength(4);
    expect(keepMarkers(markers, 'all')).toEqual([]);
  });

  it('takes one sheet, and the markers that belong to no sheet', () => {
    const gone = deleteMarkers(markers, 'sheet', { sheetId: 'sheet1' });
    expect(gone.map((m) => m.refdes ?? '-')).toEqual(['-', 'R1', 'U1']);
    expect(keepMarkers(markers, 'sheet', { sheetId: 'sheet1' }).map((m) => m.refdes)).toEqual(['U3']);
    expect(deleteMarkers(markers, 'sheet', { sheetId: 'sheet2' }).map((m) => m.refdes ?? '-')).toEqual(['-', 'U3']);
  });

  it('takes the errors or the warnings', () => {
    expect(deleteMarkers(markers, 'errors').map((m) => m.code)).toEqual(['no-ground', 'pin-type']);
    expect(deleteMarkers(markers, 'warnings')).toHaveLength(2);
    expect(keepMarkers(markers, 'errors').every((m) => m.severity === 'warning')).toBe(true);
  });

  it('takes the markers of the selected parts, without case', () => {
    expect(deleteMarkers(markers, 'selection', { refdes: ['r1'] }).map((m) => m.refdes)).toEqual(['R1']);
    expect(deleteMarkers(markers, 'selection', { refdes: ['R1', 'U1'] })).toHaveLength(2);
    expect(deleteMarkers(markers, 'selection', { refdes: [] })).toEqual([]);
    expect(deleteMarkers(markers, 'selection')).toEqual([]);
  });

  it('answers for one marker too', () => {
    expect(markerInScope(markers[1], 'sheet', { sheetId: 'sheet1' })).toBe(true);
    expect(markerInScope(markers[1], 'sheet', { sheetId: 'sheet2' })).toBe(false);
    expect(markerInScope(markers[0], 'sheet', { sheetId: 'sheet2' })).toBe(true);
  });
});

describe('summary', () => {
  it('counts errors, warnings and the rules', () => {
    const s = ercSummary(markers);
    expect(s).toMatchObject({ errors: 2, warnings: 2, total: 4 });
    expect(s.byRule).toEqual([
      { code: 'floating-pin', count: 2 },
      { code: 'no-ground', count: 1 },
      { code: 'pin-type', count: 1 },
    ]);
    expect(ercSummary([])).toMatchObject({ errors: 0, warnings: 0, total: 0, byRule: [] });
  });
});

describe('the report file', () => {
  it('builds one table with every finding', () => {
    const table = ercReportTable(markers, texts);
    expect(table.columns).toEqual(['Severity', 'Rule', 'Sheet', 'Part', 'Pin', 'Net', 'Position', 'Problem', 'Why', 'How to fix']);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[1]).toEqual(['warning', 'floating-pin', 'Sheet 1', 'R1', '2', '', '40, 10', 'R1 pin 2 is not connected', 'why floating-pin', 'fix floating-pin']);
    expect(table.rows[0]).toEqual(['error', 'no-ground', '', '', '', '', '', 'The circuit has no ground', 'why no-ground', 'fix no-ground']);
    expect(table.caption).toBe('2 error(s), 2 warning(s)');
  });

  it('writes a readable text report', () => {
    const text = ercReportText(markers, texts, { design: 'Amplifier', file: 'amp.msim', date: '2026-01-02', tool: 'MachSim 0.1.0' });
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('ERC report');
    expect(lines).toContain('Amplifier');
    expect(lines).toContain('amp.msim');
    expect(lines).toContain('2 error(s), 2 warning(s)');
    expect(text).toContain('1. [error] no-ground: The circuit has no ground');
    expect(text).toContain('2. [warning] floating-pin: R1 pin 2 is not connected');
    expect(text).toContain('Sheet: Sheet 1 | Part: R1 | Pin: 2 | Position: 40, 10');
    expect(text).toContain('   Why: why floating-pin');
    expect(text).toContain('   How to fix: fix floating-pin');
    // the technical line is kept for reference
    expect(text).toContain('   (Net OUT: two outputs)');
  });

  it('says so when nothing was found', () => {
    const text = ercReportText([], { ...texts, caption: '0 error(s), 0 warning(s)' }, { design: 'Clean' });
    expect(text).toContain('No problems were found.');
    expect(text).not.toContain('1. [');
    expect(ercReportTable([], texts).rows).toEqual([]);
  });
});
