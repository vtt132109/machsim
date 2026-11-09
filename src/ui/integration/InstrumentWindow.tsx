/**
 * Floating-window content of a virtual instrument: mounts the panel registered for the
 * instrument kind (src/ui/instruments) with its binding, live stream, AC / DC results and the
 * part's settings. Settings changes go to the controller (live setParam / restart while
 * simulating, otherwise just stored on the part without an undo step).
 *
 * Before the first Run the binding is derived from a netlist of the current design, so the
 * panel already shows which channels are wired.
 */
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { defaultParams } from '../../library';
import { buildNetlist } from '../../model/netlister';
import type { Design, InstrumentBinding, InstrumentKind } from '../../model/types';
import { hasInstrumentPanel, lazyInstrumentPanel } from '../instruments/lazyPanels';
import { InstrumentStream, type InstrumentHost } from '../instruments/types';
import { saveInstrumentDefaults } from '../instruments/defaults';
import { partLookup, useEditor } from '../store';
import { findPartByRefdes } from '../store/designOps';
import type { SimulationIntegration } from './controller';
import { t } from '../../i18n';
import { instrumentAllowed } from '../../model/restrictions';

/** Binding of an instrument from a fresh netlist of the design (null when not netlistable). */
function previewBinding(design: Design, refdes: string): InstrumentBinding | null {
  try {
    const b = buildNetlist(design, { includeAnalysis: false });
    return b.instruments.find((i) => i.refdes.toUpperCase() === refdes.toUpperCase()) ?? null;
  } catch {
    return null;
  }
}

export interface InstrumentWindowProps {
  refdes: string;
  kind: InstrumentKind;
  ctrl: SimulationIntegration;
}

export function InstrumentWindow({ refdes, kind, ctrl }: InstrumentWindowProps) {
  const live = useSyncExternalStore(ctrl.live.subscribe, ctrl.live.getState, ctrl.live.getState);
  const root = useRef<HTMLDivElement>(null);
  const [toolNote, setToolNote] = useState<string | null>(null);
  const host = useMemo<InstrumentHost>(
    () => ({
      // the gate-circuit builder loads on first use
      placeLogicCircuit: async (terms, inputs, nandOnly) => (await import('./logicPlacement')).placeLogicCircuitFor(refdes, terms, inputs, nandOnly),
    }),
    [refdes],
  );
  const design = useEditor((s) => s.design);
  const found = findPartByRefdes(design, refdes);
  const partParams = found?.part.params;
  const partId = found?.part.partId;
  const params = useMemo(() => {
    const def = partId ? partLookup(partId) : undefined;
    return { ...(def ? defaultParams(def) : {}), ...(partParams ?? {}) };
  }, [partId, partParams]);
  const liveBinding = live.build?.instruments.find((b) => b.refdes.toUpperCase() === refdes.toUpperCase()) ?? null;
  // preview netlist only while there is no simulation binding (re-derived when the design changes)
  const exists = found !== null;
  const preview = useMemo(() => (liveBinding || !exists ? null : previewBinding(design, refdes)), [liveBinding, exists, design, refdes]);
  const binding: InstrumentBinding = liveBinding ?? preview ?? { refdes, partId: partId ?? '', kind, params, channels: {}, drives: [] };
  const liveStream = live.streams[refdes];
  const channelKey = Object.keys(binding.channels).join(',');
  // an empty stream with the binding's channels until the simulation provides one
  const idleStream = useMemo(() => new InstrumentStream(channelKey ? channelKey.split(',') : [], 16), [channelKey]);

  if (!found) return <div className="ms-empty">{t('integration.instrumentWindow.refdesIsNoLongerPart', { refdes: refdes })}</div>;
  if (!instrumentAllowed(design, kind)) return <div className="ms-empty">{t('learn.restricted.instrument', { instrument: refdes })}</div>;
  if (!hasInstrumentPanel(binding.kind)) return <div className="ms-empty">{t('integration.instrumentWindow.noPanelExistsForKind', { kind: binding.kind })}</div>;
  // panels load with the first instrument window (one chunk for all of them)
  const Panel = lazyInstrumentPanel(binding.kind);
  const note = live.needStatus[refdes];
  const def = partId ? partLookup(partId) : undefined;
  const saveDefaults = () => {
    if (!def) return;
    saveInstrumentDefaults(def, params);
    setToolNote(t('integration.instrumentWindow.defaultsSaved'));
  };
  const exportFace = async () => {
    const el = root.current?.querySelector('.msi-panel');
    if (!(el instanceof HTMLElement)) return;
    try {
      const face = await import('../instruments/faceSnapshot');
      face.downloadDataUrl(await face.captureFace(el), `${refdes}_face.png`);
      setToolNote(null);
    } catch (e) {
      setToolNote(t('integration.instrumentWindow.faceFailed', { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  return (
    <div className="msx-instrument" ref={root} data-instrument={refdes}>
      <div className="msx-instrument-tools">
        <button type="button" className="ms-btn ms-btn-small" onClick={saveDefaults} disabled={!def} title={t('tip.instrumentWindow.saveDefaults')}>
          {t('integration.instrumentWindow.saveDefaults')}
        </button>
        <button type="button" className="ms-btn ms-btn-small" onClick={() => void exportFace()} title={t('tip.instrumentWindow.exportFace')}>
          {t('integration.instrumentWindow.exportFace')}
        </button>
        {toolNote && <span className="msx-instrument-toolnote">{toolNote}</span>}
      </div>
      {note ? (
        <div className={`msx-note${note.startsWith('Failed') ? ' is-error' : ''}`} role="status">
          {note}
        </div>
      ) : null}
      <Panel
        binding={binding}
        stream={liveStream ?? idleStream}
        ac={live.ac[refdes]}
        dc={live.dc[refdes]}
        simTime={live.simTime}
        running={live.session === 'running'}
        params={params}
        onParamsChange={(next) => ctrl.instrumentParams(refdes, next)}
        host={host}
      />
    </div>
  );
}
