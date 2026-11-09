/**
 * Review: races between user commands and the controller's automatic session restart
 * (src/ui/integration/controller.ts), in-process (real editor store, netlister, engine, SimHost).
 */
import { describe, expect, it } from 'vitest';
import { createEditor } from '../../../src/ui/store/editorStore';
import { SimClient } from '../../../src/ui/sim/client';
import { createInProcessTransport } from '../../../src/ui/sim/inprocess';
import { SimulationIntegration } from '../../../src/ui/integration/controller';
import { rcLowPassExample } from '../../../src/ui/integration/exampleDesigns';

async function waitFor(cond: () => boolean, timeoutMs = 8000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function setup() {
  const editor = createEditor({ design: rcLowPassExample() });
  const ctrl = new SimulationIntegration({
    editor,
    client: new SimClient(() => createInProcessTransport()),
    speed: Infinity,
    liveIntervalMs: 20,
  });
  return { editor, ctrl };
}

describe('Stop during an automatic restart', () => {
  it('a structural instrument edit (sine → square) followed at once by Stop leaves nothing running', async () => {
    const { editor, ctrl } = setup();
    await ctrl.run();
    await waitFor(() => ctrl.live.getState().simTime > 1e-3, 8000, 'streaming');
    const params = { ...editor.getState().design.sheets[0].parts.find((p) => p.refdes === 'XFG1')!.params };
    // waveform type change → elementValueChanges() = null → the controller restarts the session
    ctrl.instrumentParams('XFG1', { ...params, waveform: 'square' });
    await ctrl.stop(); // the user presses Stop right away
    // let any pending restart chain (stopSession().then(startInteractive)) run; ctrl.idle() is
    // not awaited here because it never resolves when a restarted open-ended session keeps going
    await new Promise((r) => setTimeout(r, 500));
    const st = ctrl.live.getState();
    const result = { active: ctrl.active, mode: st.mode, session: st.session, status: editor.getState().sim.state };
    ctrl.dispose();
    await new Promise((r) => setTimeout(r, 50));
    expect(result).toEqual({ active: false, mode: 'idle', session: 'none', status: 'idle' });
  });

  it('a structural edit followed by opening another design does not restart the old circuit', async () => {
    const { editor, ctrl } = setup();
    await ctrl.run();
    await waitFor(() => ctrl.live.getState().simTime > 1e-3, 8000, 'streaming');
    const params = { ...editor.getState().design.sheets[0].parts.find((p) => p.refdes === 'XFG1')!.params };
    ctrl.instrumentParams('XFG1', { ...params, waveform: 'square' });
    editor.actions.newDocument('Other'); // File > New while the restart is pending
    await new Promise((r) => setTimeout(r, 300));
    const st = ctrl.live.getState();
    const result = { active: ctrl.active, mode: st.mode, elements: st.build?.netlist.elements.length ?? 0 };
    ctrl.dispose();
    await new Promise((r) => setTimeout(r, 50));
    expect(result).toEqual({ active: false, mode: 'idle', elements: result.elements });
  });
});
