/**
 * Properties field of a WAV file parameter (ParamDef.binaryImport = 'wav'): instead of a box of
 * base64 text it shows what the part holds and offers "Open WAV file…" (decoded, mixed to mono and
 * reduced by src/audio/wavParam.ts) and a button to go back to the built-in burst. One undo step per
 * change, like every parameter. Loads on demand (the audio texts stay out of the start-up chunk).
 */
import { useState } from 'react';
import type { ParamDef } from '../../library/types';
import type { PartInstance } from '../../model/types';
import { WavError } from '../../audio/wav';
import { WAV_PARAM_MAX_SAMPLES, wavImportFromBytes, wavParamInfo } from '../../audio/wavParam';
import { aut } from '../../i18n/audioText';
import { useLang } from '../../i18n/react';
import { actions } from '../store';
import { paramValue } from './paramFields';

/** Ask for a WAV file (browser input element; works in the desktop app as well). */
function pickWav(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav,audio/wav,audio/x-wav';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      void f.arrayBuffer().then(
        (buf) => resolve({ name: f.name, bytes: new Uint8Array(buf) }),
        () => resolve(null),
      );
    };
    input.click();
  });
}

function reasonOf(e: unknown): string {
  if (e instanceof WavError) {
    if (e.code === 'not-wav') return aut('wavBadNotWav');
    if (e.code === 'unsupported-format' || e.code === 'unsupported-bits') return aut('wavBadFormat');
    if (e.code === 'empty') return aut('wavBadEmpty');
  }
  return aut('wavBadOther');
}

export function WavField({ def, inst, label, trailing }: { def: ParamDef; inst: PartInstance; label: React.ReactNode; trailing?: React.ReactNode }) {
  useLang();
  const [note, setNote] = useState<string | null>(null);
  const value = paramValue(def, inst.params);
  const info = wavParamInfo(value);
  return (
    <div className="ms-data-field ms-wav-field">
      <div className="ms-cfield-label">{label}</div>
      <p className="ms-hint">{note ?? (info ? aut('wavInfo', { seconds: Number(info.seconds.toFixed(2)), rate: info.rate }) : aut('wavBuiltin'))}</p>
      <div className="ms-btn-row">
        <button
          type="button"
          className="ms-btn ms-btn-small"
          title={aut('wavOpenTip')}
          onClick={async () => {
            const f = await pickWav();
            if (!f) return;
            try {
              const imp = wavImportFromBytes(f.bytes);
              actions.setPartParam(inst.id, def.key, imp.text);
              const parts = [aut('wavLoaded', { name: f.name, seconds: Number(imp.seconds.toFixed(2)), rate: imp.rate })];
              if (imp.cut) parts.push(aut('wavCut', { max: Math.round(WAV_PARAM_MAX_SAMPLES / imp.rate) }));
              if (imp.resampledFrom) parts.push(aut('wavResampled', { from: imp.resampledFrom, to: imp.rate }));
              setNote(parts.join(' '));
            } catch (e) {
              setNote(aut('wavBad', { reason: reasonOf(e) }));
            }
          }}
        >
          {aut('wavOpen')}
        </button>
        {value.trim() ? (
          <button
            type="button"
            className="ms-btn ms-btn-small"
            onClick={() => {
              actions.setPartParam(inst.id, def.key, '');
              setNote(null);
            }}
          >
            {aut('wavClear')}
          </button>
        ) : null}
        {trailing}
      </div>
    </div>
  );
}
