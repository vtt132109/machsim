/**
 * Document tabs with the real simulation controller: a running simulation is stopped when another
 * design is shown, each design keeps its own results and Grapher run history, and a new design
 * starts with none.
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from '../store/editorStore';
import { createDocumentManager } from '../app/documents';
import { SimClient } from '../sim/client';
import { createInProcessTransport } from '../sim/inprocess';
import { SimulationIntegration, type DocumentLive } from './controller';
import { rcLowPassExample, voltageDividerExample } from './exampleDesigns';
import { newDesign } from '../../model/types';
import { setLang } from '../../i18n';

setLang('en');

async function waitFor(cond: () => boolean, timeoutMs = 8000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function setup() {
  const editor = createEditor({ design: voltageDividerExample(), fileName: 'divider.msim' });
  const ctrl = new SimulationIntegration({ editor, client: new SimClient(() => createInProcessTransport()), speed: Infinity, liveIntervalMs: 20 });
  const manager = createDocumentManager({ editor, blank: () => newDesign('Blank') });
  manager.registerExtension({
    id: 'simulation',
    capture: () => ctrl.documentState(),
    restore: (d) => ctrl.restoreDocumentState(d as DocumentLive | undefined),
    beforeLeave: () => ctrl.stopForDocumentSwitch(),
  });
  return { editor, ctrl, manager };
}

describe('simulation and document tabs', () => {
  it('stops a running simulation when another design is shown and keeps its results with it', async () => {
    const { editor, ctrl, manager } = setup();
    await ctrl.run();
    await waitFor(() => (ctrl.live.getState().streams.XMM1?.length ?? 0) > 20, 8000, 'multimeter samples');
    const a = manager.activeId();
    await manager.open(rcLowPassExample(), 'rc.msim');
    expect(ctrl.active).toBe(false);
    expect(editor.getState().sim.state).toBe('idle');
    // the new design starts without the divider's instrument data
    expect(ctrl.live.getState().streams.XMM1).toBeUndefined();
    expect(ctrl.live.getState().runs).toEqual([]);
    // coming back brings the captured multimeter data back
    await manager.switchTo(a);
    expect(ctrl.live.getState().mode).toBe('idle');
    expect(ctrl.live.getState().streams.XMM1.length).toBeGreaterThan(20);
    expect(editor.getState().fileName).toBe('divider.msim');
  });

  it('keeps one Grapher run history per design', async () => {
    const { ctrl, manager } = setup();
    await ctrl.runAnalysis('op');
    await waitFor(() => ctrl.live.getState().runs.length === 1, 8000, 'first run');
    const a = manager.activeId();
    await manager.open(rcLowPassExample(), 'rc.msim');
    expect(ctrl.live.getState().runs).toHaveLength(0);
    await ctrl.runAnalysis('op');
    await waitFor(() => ctrl.live.getState().runs.length === 1, 8000, 'run in the second design');
    const runB = ctrl.live.getState().runs[0].id;
    await manager.switchTo(a);
    const runsA = ctrl.live.getState().runs;
    expect(runsA).toHaveLength(1);
    // run numbers stay unique across documents
    expect(runsA[0].id).not.toBe(runB);
  });

  it('a one-shot analysis in progress is cancelled by switching and the design stays usable', async () => {
    const { editor, ctrl, manager } = setup();
    void ctrl.runAnalysis('tran');
    await manager.open(newDesign('B'), 'b.msim');
    expect(ctrl.active).toBe(false);
    expect(editor.getState().design.title).toBe('B');
  });
});
