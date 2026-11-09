/**
 * Development demo of the virtual breadboard (open /breadboard-demo.html with `npx vite`).
 *
 * Pick a learning circuit (LED + resistor + 9 V, 555 LED flasher, inverting op-amp, …), build it
 * on the 3D breadboard by hand or with auto-arrange, check it, follow the assembly guide, and
 * press "Chạy mô phỏng" to run a real transient simulation whose LED currents light the LEDs.
 */

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/theme.css';
import { BreadboardView } from '../BreadboardView';
import { autoPlace } from '../autoplace';
import { EXAMPLE_CIRCUITS, ledArrayCircuit } from '../examples';
import { indicatorLevels } from '../indicators';
import { DEMO_NAMES as NAMES, DEMO_TEXT as TEXT, tr, type Lang, type LocalizedText } from '../../i18n/breadboard';
import { buildNetlist } from '../../model/netlister';
import { createTransientStepper, type TransientStepper } from '../../sim';
import type { Design } from '../../model/types';
import type { BreadboardLayout } from '../types';

/** demo circuits: the learning examples plus a 120-part stress test */
const CIRCUITS: { id: string; build: () => Design }[] = [...EXAMPLE_CIRCUITS, { id: 'led-array', build: () => ledArrayCircuit(60) }];

function initialDesign(id: string, arranged: boolean): Design {
  const ex = CIRCUITS.find((e) => e.id === id) ?? CIRCUITS[0];
  const d = ex.build();
  return arranged ? { ...d, breadboard: autoPlace(d) } : d;
}

function Demo() {
  const [lang] = useState<Lang>('vi');
  const t = (x: LocalizedText) => tr(x, lang);
  const [circuit, setCircuit] = useState('series-led');
  const [design, setDesign] = useState<Design>(() => initialDesign('series-led', true));
  const [running, setRunning] = useState(false);
  const [levels, setLevels] = useState<Record<string, number> | undefined>(undefined);
  const [simTime, setSimTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const stepperRef = useRef<TransientStepper | null>(null);

  const build = useMemo(() => buildNetlist(design, { includeAnalysis: false }), [design]);

  useEffect(() => {
    if (!running) {
      stepperRef.current = null;
      setLevels(undefined);
      return;
    }
    let stepper: TransientStepper;
    try {
      stepper = createTransientStepper({ ...build.netlist, analyses: [] }, { tstep: 1e-3, tmax: 2e-3 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRunning(false);
      return;
    }
    stepperRef.current = stepper;
    setError(null);
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      try {
        const wall = (performance.now() - t0) / 1000;
        stepper.advance(wall, 12);
        setSimTime(stepper.time);
        setLevels(indicatorLevels(build.indicators, stepper.latest()));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRunning(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, build]);

  const load = (id: string, arranged: boolean) => {
    setRunning(false);
    setCircuit(id);
    setDesign(initialDesign(id, arranged));
    setSelected(null);
  };

  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr', fontFamily: 'var(--font)', background: 'var(--bg)', color: 'var(--text)' }}>
      <header style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{t(TEXT.title)}</strong>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          {t(TEXT.circuit)}
          <select value={circuit} onChange={(e) => load(e.target.value, true)}>
            {CIRCUITS.map((c) => (
              <option key={c.id} value={c.id}>
                {t(NAMES[c.id] ?? { vi: c.id, en: c.id })}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => load(circuit, false)}>
          {t(TEXT.empty)}
        </button>
        <button type="button" onClick={() => load(circuit, true)}>
          {t(TEXT.arranged)}
        </button>
        <button type="button" onClick={() => setRunning((r) => !r)} style={{ fontWeight: 600 }}>
          {running ? t(TEXT.stop) : t(TEXT.run)}
        </button>
        {running && (
          <span>
            {t(TEXT.time)}: {simTime.toFixed(2)} s
          </span>
        )}
        {error && (
          <span style={{ color: 'var(--danger)' }}>
            {t(TEXT.simError)}
            {error}
          </span>
        )}
      </header>
      <BreadboardView
        design={design}
        onChange={(layout: BreadboardLayout) => setDesign((d) => ({ ...d, breadboard: layout }))}
        indicatorLevels={levels}
        running={running}
        selectedRefdes={selected}
        onSelect={setSelected}
        lang={lang}
      />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
