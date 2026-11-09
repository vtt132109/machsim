/**
 * Grapher › Export WAV…: pick a trace of the page being shown, the sample rate, a time stretch and
 * the level options, and save it as a .wav file (src/audio/export.ts). Loads with the Grapher.
 */
import { useMemo, useState } from 'react';
import { WavExportError, traceToWav } from '../../audio/export';
import type { WavEncoding } from '../../audio/wav';
import { aut } from '../../i18n/audioText';
import { useLang } from '../../i18n/react';
import type { AnalysisResult } from '../../sim/results';
import { formatEng } from '../../util/units';
import { actions } from '../store';
import { Dialog } from '../common/Dialog';
import { alertDialog, openCustomDialog } from '../common/dialogs';
import { exportFile } from '../app/files';
import { findPage, pageResult, type GrapherDoc } from '../results/history';

const RATES = [48000, 44100, 22050, 16000, 8000];
const ENCODINGS: [WavEncoding, string][] = [
  ['pcm16', '16-bit'],
  ['pcm24', '24-bit'],
  ['pcm8', '8-bit'],
  ['float32', '32-bit float'],
];

/** Real-valued vectors of a time-domain result that can become sound. */
export function exportableTraces(result: AnalysisResult | undefined): { name: string; unit: string }[] {
  if (!result?.scale || result.type !== 'tran') return [];
  return result.vectors.filter((v) => v.re.length === result.scale!.re.length && !v.im).map((v) => ({ name: v.name, unit: v.unit ?? '' }));
}

function ExportBody({ result, close }: { result: AnalysisResult; close: () => void }) {
  useLang();
  const traces = useMemo(() => exportableTraces(result), [result]);
  const [name, setName] = useState(traces.find((x) => /^v\(out/i.test(x.name))?.name ?? traces[0]?.name ?? '');
  const [rate, setRate] = useState(44100);
  const [stretch, setStretch] = useState(1);
  const [normalize, setNormalize] = useState(true);
  const [removeDc, setRemoveDc] = useState(false);
  const [encoding, setEncoding] = useState<WavEncoding>('pcm16');
  const scale = result.scale!.re;
  const span = scale.length ? scale[scale.length - 1] - scale[0] : 0;
  const duration = span * (stretch > 0 ? stretch : 1);
  const samples = Math.floor(duration * rate);

  const save = async () => {
    const v = result.vectors.find((x) => x.name === name);
    if (!v) return;
    try {
      const out = traceToWav(scale, v.re, { rate, stretch, normalize, removeDc, encoding });
      const file = `${name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'trace'}.wav`;
      const saved = await exportFile(file, new Blob([out.bytes as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), { name: 'WAV', extensions: ['wav'] });
      if (!saved) return;
      actions.addSimMessage('info', aut('exportDone', { name: file, seconds: Number(out.seconds.toFixed(3)), rate: out.rate, bits: out.bits }), 'audio');
      if (out.clipped > 0) actions.addSimMessage('warning', aut('exportClipped'), 'audio');
      close();
    } catch (e) {
      await alertDialog({ title: aut('exportTitle'), message: e instanceof WavExportError ? (e.code === 'rate' ? aut('exportIntro') : aut('exportTooShort')) : e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Dialog
      title={aut('exportTitle')}
      onClose={close}
      width={480}
      footer={
        <>
          <button type="button" className="ms-btn" onClick={close}>
            {aut('exportCancel')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!name || samples < 2} onClick={() => void save()}>
            {aut('exportSave')}
          </button>
        </>
      }
    >
      <div className="ms-form">
        <p className="ms-hint">{aut('exportIntro')}</p>
        <label className="ms-field">
          <span>{aut('exportTrace')}</span>
          <select value={name} onChange={(e) => setName(e.target.value)}>
            {traces.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}
                {x.unit ? ` [${x.unit}]` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="ms-field">
          <span>{aut('exportRate')}</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r} Hz
              </option>
            ))}
          </select>
        </label>
        <label className="ms-field" title={aut('exportStretchTip')}>
          <span>{aut('exportStretch')}</span>
          <input type="number" min={0.001} step="any" value={stretch} onChange={(e) => setStretch(Number(e.target.value))} />
        </label>
        <p className="ms-hint">{aut('exportSeconds', { t: formatEng(duration, 's', 3), n: Number.isFinite(samples) ? samples : 0 })}</p>
        <label className="ms-field">
          <span>{aut('exportEncoding')}</span>
          <select value={encoding} onChange={(e) => setEncoding(e.target.value as WavEncoding)}>
            {ENCODINGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="ms-check" title={aut('exportNormalizeTip')}>
          <input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /> {aut('exportNormalize')}
        </label>
        <label className="ms-check">
          <input type="checkbox" checked={removeDc} onChange={(e) => setRemoveDc(e.target.checked)} /> {aut('exportRemoveDc')}
        </label>
      </div>
    </Dialog>
  );
}

/** Open the export dialog for the page the Grapher shows (an alert when there is nothing to export). */
export async function openWavExport(doc: GrapherDoc): Promise<void> {
  const page = findPage(doc, doc.active);
  const result = page ? pageResult(doc, page) : undefined;
  if (!result || exportableTraces(result).length === 0) {
    await alertDialog({ title: aut('exportTitle'), message: aut('exportNone') });
    return;
  }
  openCustomDialog((close) => <ExportBody result={result} close={close} />);
}

