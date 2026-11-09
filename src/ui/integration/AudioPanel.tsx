/**
 * The Audio window (Simulate › Audio): master volume and mute, a level bar, the notice "simulation
 * slower than real time" with the playback speed, the speakers of the design with their own volume
 * and mute, and the microphone's state and input level. It only reads `audioState`
 * (src/audio/monitor.ts) and the design; changes go to the audio state or, for a speaker's own
 * volume / mute, to the part's parameters through the editor store (one undo step, applied live).
 */
import { useSyncExternalStore } from 'react';
import { audioState, setMaster, type MicState } from '../../audio/monitor';
import { getPart } from '../../library';
import { defaultParams } from '../../library';
import { aut } from '../../i18n/audioText';
import { useLang } from '../../i18n/react';
import { parseUserNumber } from '../../util/units';
import { actions, useEditor } from '../store';

function Meter({ value, label, tip }: { value: number; label: string; tip: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="msx-audio-meter-row" title={tip}>
      <span className="msx-dim">{label}</span>
      <div className="msx-audio-meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={pct >= 98 ? 'msx-audio-meter-fill is-clip' : 'msx-audio-meter-fill'} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function micText(state: MicState, running: boolean): string {
  switch (state) {
    case 'asking':
      return aut('micAsking');
    case 'live':
      return aut('micLive');
    case 'tone':
      return aut('micTone');
    case 'denied':
      return aut('micDenied');
    case 'unavailable':
      return aut('micUnavailable');
    default:
      return running ? aut('micTone') : aut('micWaiting');
  }
}

export function AudioPanel() {
  useLang();
  const st = useSyncExternalStore(audioState.subscribe, audioState.getState, audioState.getState);
  const design = useEditor((s) => s.design);
  const running = useEditor((s) => s.sim.state === 'running' || s.sim.state === 'paused');
  const paused = useEditor((s) => s.sim.state === 'paused');
  const parts = design.sheets.flatMap((s) => s.parts);
  const speakers = parts.filter((p) => getPart(p.partId)?.indicator?.kind === 'speaker');
  const mics = parts.filter((p) => p.partId === 'sources/microphone');
  const speed = Number(st.speed.toFixed(2));

  return (
    <div className="msx-audio">
      <p className="msx-dim">{aut('intro')}</p>

      <section className="msx-audio-box" aria-label={aut('masterVolume')}>
        <label className="msx-field" title={aut('masterVolumeTip')}>
          <span>
            {aut('masterVolume')}: {Math.round(st.volume)} %
          </span>
          <input type="range" min={0} max={100} step={1} value={st.volume} aria-label={aut('masterVolume')} onChange={(e) => setMaster({ volume: Number(e.target.value) })} />
        </label>
        <div className="msx-row">
          <button type="button" className="ms-btn" aria-pressed={st.mute} title={aut('muteTip')} onClick={() => setMaster({ mute: !st.mute })}>
            {st.mute ? aut('unmuteAll') : aut('muteAll')}
          </button>
        </div>
        <Meter value={st.mute ? 0 : st.level} label={aut('level')} tip={aut('levelTip')} />
      </section>

      <div role="status" aria-live="polite" className={st.active && st.slower ? 'msx-audio-note is-warn' : 'msx-audio-note'}>
        {!running ? aut('idle') : paused ? aut('paused') : st.active && st.slower ? aut('slower', { speed }) : st.active ? aut('playing') : aut('idle')}
        {running && st.active && st.slower ? <small>{aut('slowerHelp')}</small> : null}
      </div>
      {st.noSink ? <p className="msx-audio-note is-warn">{aut('noSink')}</p> : null}

      <h4 className="msx-group-title">{aut('speakersTitle')}</h4>
      {speakers.length === 0 ? (
        <p className="msx-dim">{aut('noSpeaker')}</p>
      ) : (
        <ul className="msx-audio-list">
          {speakers.map((p) => {
            const def = getPart(p.partId);
            const defaults = def ? defaultParams(def) : {};
            const vol = Math.min(100, Math.max(0, parseUserNumber(p.params.volume ?? defaults.volume ?? '50') || 0));
            const muted = /^(true|1|yes|on)$/i.test((p.params.mute ?? defaults.mute ?? 'false').trim());
            const vfull = parseUserNumber(p.params.vfull ?? defaults.vfull ?? '5');
            return (
              <li key={p.id} className="msx-audio-speaker">
                <b>{p.refdes}</b>
                <label className="msx-inline" title={aut('speakerVolumeTip')}>
                  <span className="msx-dim">{aut('speakerVolume')}</span>
                  <input type="range" min={0} max={100} step={1} value={vol} aria-label={`${p.refdes} ${aut('speakerVolume')}`} onChange={(e) => actions.setPartParam(p.id, 'volume', e.target.value)} />
                  <span className="msx-mono">{Math.round(vol)} %</span>
                </label>
                <label className="msx-inline" title={aut('speakerMuteTip')}>
                  <input type="checkbox" checked={muted} onChange={(e) => actions.setPartParam(p.id, 'mute', e.target.checked ? 'true' : 'false')} />
                  <span>{aut('speakerMute')}</span>
                </label>
                <small className="msx-dim">{aut('speakerFull', { v: Number.isFinite(vfull) ? vfull : '?' })}</small>
              </li>
            );
          })}
        </ul>
      )}

      <h4 className="msx-group-title">{aut('micTitle')}</h4>
      {mics.length === 0 && st.mic === 'none' ? (
        <p className="msx-dim">{aut('micNone')}</p>
      ) : (
        <>
          <p className={st.mic === 'denied' || st.mic === 'unavailable' ? 'msx-audio-note is-warn' : 'msx-audio-note'}>{micText(st.mic, running && st.active)}</p>
          <Meter value={st.micLevel} label={aut('micLevel')} tip={aut('micLevelTip')} />
        </>
      )}
    </div>
  );
}
