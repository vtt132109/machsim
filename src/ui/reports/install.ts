/**
 * Start-up wiring of reports, PCB transfer and SPICE-as-schematic import (the dialogs load on first
 * use): commands reports.center / bomFull / componentDetail / modelData / spareGates /
 * crossReference / statistics, file.transfer.kicad / csv / forward / backward,
 * file.importSpiceSchematic and help.commandLine. Called once by the shell (App.tsx).
 */
import { defineBuiltinCommand } from '../app/extensions';
import { openHelp } from '../help/open';
import type { ReportId } from './reportTables';

const reports = () => import('./ReportsDialog');
const pcb = () => import('./pcbFlows');

const REPORT_COMMANDS: [string, ReportId][] = [
  ['reports.center', 'bom'],
  ['reports.bomFull', 'bom'],
  ['reports.componentDetail', 'componentDetail'],
  ['reports.modelData', 'modelData'],
  ['reports.spareGates', 'spareGates'],
  ['reports.crossReference', 'crossReference'],
  ['reports.statistics', 'statistics'],
];

let installed = false;

export function installReports(): void {
  if (installed) return;
  installed = true;
  for (const [id, report] of REPORT_COMMANDS) defineBuiltinCommand(id, async () => (await reports()).openReportsDialog(report));
  defineBuiltinCommand('file.transfer.kicad', async () => (await pcb()).exportKicadNetlist());
  defineBuiltinCommand('file.transfer.csv', async () => (await pcb()).exportCsvNetlist());
  defineBuiltinCommand('file.transfer.forward', async () => (await pcb()).openForwardAnnotation());
  defineBuiltinCommand('file.transfer.backward', async () => (await pcb()).openBackAnnotation());
  defineBuiltinCommand('file.importSpiceSchematic', async () => (await import('./importFlow')).importSpiceAsSchematic());
  defineBuiltinCommand('help.commandLine', () => openHelp({ kind: 'guide', page: 'commandLine' }));
}
