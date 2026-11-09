/**
 * Word generator panel: pattern grid editor (hex words or clickable bits), preset patterns,
 * cycle / burst / step output control, word rate, address range, output levels and an LED view
 * of the word currently driven onto b0..b(bits-1).
 *
 * Outputs params 'pattern' (comma-joined upper-case hex words, address 0 first, padded to the
 * word width) and 'freq', plus mode, bits, start, end, pos, vhigh, vlow, rise, display.
 */

import { useEffect, useState } from 'react';
import { formatEng } from '../../util/units';
import { NumberField, Section, Segmented, SelectField, paramApi } from './panelKit';
import type { InstrumentPanelProps } from './types';
import { MAX_WORDS, WORDGEN_DEFAULTS, addressAt, clampBits, formatPattern, parsePattern, parseWordGenSettings, patternPreset, wordToBinary } from './wordgen';
import type { PatternPreset, WordGenMode } from './wordgen';
import { t } from '../../i18n';

const PAGE = 64;

/** Pattern presets with their names in the current language. */
const presets = (): readonly (readonly [PatternPreset, string])[] => [
  ['up', t('instruments.wordGenerator.presetUp')],
  ['down', t('instruments.wordGenerator.presetDown')],
  ['shift-left', t('instruments.wordGenerator.presetShiftLeft')],
  ['shift-right', t('instruments.wordGenerator.presetShiftRight')],
  ['alternate', t('instruments.wordGenerator.presetAlternate')],
  ['clear', t('instruments.wordGenerator.presetClear')],
];

/** One editable hex word; commits on Enter / blur. */
function HexCell({ value, bits, onCommit, label }: { value: number; bits: number; onCommit: (w: number) => void; label: string }) {
  const digits = Math.ceil(bits / 4);
  const text = (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
  const [draft, setDraft] = useState(text);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);
  const valid = /^(0x)?[0-9a-f]{1,8}$/i.test(draft.trim());
  const commit = () => {
    setEditing(false);
    if (!valid) {
      setDraft(text);
      return;
    }
    const w = parsePattern(draft.trim(), bits).words[0] ?? 0;
    if (w !== value) onCommit(w);
  };
  return (
    <input
      className={`msi-input msi-mono msi-hexcell${valid ? '' : ' msi-invalid'}`}
      value={draft}
      size={Math.max(2, digits + 1)}
      aria-label={label}
      title={t('tip.wg.word')}
      aria-invalid={!valid}
      spellCheck={false}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') {
          setDraft(text);
          setEditing(false);
        }
      }}
    />
  );
}

export function WordGeneratorPanel(props: InstrumentPanelProps) {
  const { binding, params, onParamsChange, simTime, running } = props;
  const p = paramApi(params, onParamsChange, WORDGEN_DEFAULTS);
  const merged = { ...WORDGEN_DEFAULTS, ...params };
  const s = parseWordGenSettings(merged);
  const bits = s.bits;
  const parsed = parsePattern(merged.pattern, bits);
  const words = parsed.words.length ? parsed.words : [0];
  const display = p.text('display') === 'bin' ? 'bin' : 'hex';
  const [page, setPage] = useState(0);
  const [preset, setPreset] = useState<PatternPreset>('up');
  const [presetCount, setPresetCount] = useState('16');
  const [selected, setSelected] = useState(0);
  const pages = Math.max(1, Math.ceil(words.length / PAGE));
  const pg = Math.min(page, pages - 1);
  // address being output (step mode holds `pos`; stopped cycle / burst sit at the start address)
  const current = running || s.mode === 'step' ? addressAt(s, simTime) : s.start;
  const currentWord = words[current] ?? 0;

  const writeWords = (next: number[], extra: Record<string, string> = {}) => p.patch({ pattern: formatPattern(next.slice(0, MAX_WORDS), bits), ...extra });
  const setWord = (i: number, w: number) => {
    const next = words.slice();
    next[i] = w;
    writeWords(next);
  };
  const toggleBit = (i: number, bit: number) => setWord(i, (words[i] ^ (2 ** bit)) >>> 0);
  const stepOnce = () => {
    const next = s.pos >= s.end || s.pos < s.start ? s.start : s.pos + 1;
    p.set('pos', String(next));
  };
  const applyPreset = () => {
    const n = Math.max(1, Math.min(MAX_WORDS, Math.round(Number(presetCount)) || 16));
    writeWords(patternPreset(preset, n, bits), { start: '0', end: String(n - 1), pos: '0' });
    setPage(0);
  };
  const insertWord = () => {
    const at = Math.min(words.length, selected + 1);
    const next = [...words.slice(0, at), 0, ...words.slice(at)];
    writeWords(next);
    setSelected(at);
  };
  const deleteWord = () => {
    if (words.length <= 1) return;
    const next = words.filter((_, i) => i !== selected);
    writeWords(next);
    setSelected(Math.min(selected, next.length - 1));
  };

  const rowsOnPage = words.slice(pg * PAGE, pg * PAGE + PAGE);
  const addrDigits = Math.max(2, Math.ceil(Math.log2(Math.max(2, words.length)) / 4));
  return (
    <div className="msi-panel msi-wordgen">
      <div className="msi-wordgen-top">
        <div className="msi-leds" aria-label={t('instruments.wordGenerator.outputWordValue', { value: formatPattern([currentWord], bits) })} role="img">
          {Array.from({ length: bits }, (_, k) => bits - 1 - k).map((bit) => (
            <span key={bit} className={`msi-led${(currentWord >>> bit) & 1 ? ' msi-led-on' : ''}`} title={`b${bit}`}>
              <span className="msi-led-label">{bit.toString(16).toUpperCase()}</span>
            </span>
          ))}
        </div>
        <div className="msi-dim">
          {t('instruments.wordGenerator.statusLine', { address: current.toString(16).toUpperCase().padStart(addrDigits, '0'), word: formatPattern([currentWord], bits), n: binding.drives.length })}
        </div>
      </div>
      <div className="msi-wordgen-body">
        <div className="msi-wordgen-controls">
          <Section title={t('instruments.wordGenerator.controls')}>
            <Segmented
              small
              value={s.mode}
              options={[
                ['cycle', t('instruments.wordGenerator.cycle'), t('instruments.wordGenerator.repeatStartEndContinuously')],
                ['burst', t('instruments.wordGenerator.burst'), t('instruments.wordGenerator.playStartEndOnceThen')],
                ['step', t('common.step'), t('instruments.wordGenerator.outputOneWordAdvanceWith')],
              ]}
              onChange={(m: WordGenMode) => p.set('mode', m)} title={t('tip.wg.mode')}
            />
            {s.mode === 'step' && (
              <div className="msi-row">
                <button type="button" className="msi-btn" onClick={stepOnce} title={t('tip.wg.step')}>
                  {t('common.step')}
                </button>
                <button type="button" className="msi-btn" onClick={() => p.set('pos', String(s.start))} title={t('tip.wg.reset')}>
                  {t('common.reset')}
                </button>
              </div>
            )}
            <NumberField label={t('common.frequency')} value={p.text('freq')} unit="Hz" min={0} exclusiveMin onCommit={(t) => p.set('freq', t)} title={t('tip.wg.freq')} size={6} />
            <NumberField label={t('instruments.wordGenerator.initialAddress')} value={p.text('start')} integer min={0} max={MAX_WORDS - 1} onCommit={(t) => p.set('start', t)} title={t('tip.wg.start')} size={5} />
            <NumberField label={t('instruments.wordGenerator.finalAddress')} value={p.text('end')} integer min={0} max={MAX_WORDS - 1} allowBlank placeholder={String(words.length - 1)} onCommit={(t) => p.set('end', t)} title={t('tip.wg.end')} size={5} />
            <NumberField label={t('instruments.wordGenerator.wordWidth')} value={p.text('bits')} unit="bit" integer min={1} max={32} onCommit={(t) => p.patch({ bits: t, pattern: formatPattern(words, clampBits(Number(t))) })} title={t('tip.wg.bits')} size={3} />
          </Section>
          <Section title={t('instruments.wordGenerator.outputLevels')}>
            <NumberField label={t('instruments.wordGenerator.high')} value={p.text('vhigh')} unit="V" onCommit={(t) => p.set('vhigh', t)} title={t('tip.wg.vhigh')} size={5} />
            <NumberField label={t('instruments.wordGenerator.low')} value={p.text('vlow')} unit="V" onCommit={(t) => p.set('vlow', t)} title={t('tip.wg.vlow')} size={5} />
            <NumberField label={t('instruments.wordGenerator.edgeTime')} value={p.text('rise')} unit="s" min={0} exclusiveMin onCommit={(t) => p.set('rise', t)} title={t('tip.wg.rise')} size={5} />
          </Section>
          <Section title={t('instruments.wordGenerator.pattern')}>
            <SelectField label={t('instruments.wordGenerator.preset')} value={preset} options={presets()} onChange={setPreset} title={t('tip.wg.preset')} />
            <label className="msi-field">
              <span className="msi-field-label">{t('instruments.wordGenerator.words')}</span>
              <input className="msi-input" size={5} value={presetCount} onChange={(e) => setPresetCount(e.target.value.replace(/[^0-9]/g, ''))} aria-label={t('instruments.wordGenerator.numberOfPresetWords')} title={t('tip.wg.presetCount')} />
            </label>
            <button type="button" className="msi-btn" onClick={applyPreset} title={t('tip.wg.apply')}>
              {t('instruments.wordGenerator.applyPreset')}
            </button>
          </Section>
          <div className="msi-dim">
            {t('instruments.wordGenerator.valuePerWordValue2Words', { value: formatEng(1 / s.freq, 's', 4), value2: s.end - s.start + 1 })}
          </div>
        </div>
        <div className="msi-wordgen-grid">
          <div className="msi-row">
            <Segmented
              small
              value={display}
              options={[
                ['hex', 'Hex'],
                ['bin', t('instruments.wordGenerator.binary')],
              ]}
              onChange={(d) => p.set('display', d)} title={t('tip.wg.display')}
            />
            <button type="button" className="msi-btn msi-btn-small" onClick={insertWord} title={t('tip.wg.insert')} disabled={words.length >= MAX_WORDS}>
              {t('instruments.wordGenerator.insert')}
            </button>
            <button type="button" className="msi-btn msi-btn-small" onClick={deleteWord} title={t('tip.wg.delete')} disabled={words.length <= 1}>
              {t('common.delete')}
            </button>
            <span className="msi-spacer" />
            <button type="button" className="msi-btn msi-btn-small" aria-label={t('instruments.wordGenerator.previousPage')} title={t('tip.wg.page')} disabled={pg === 0} onClick={() => setPage(pg - 1)}>
              ◀
            </button>
            <span className="msi-dim">
              {pg + 1}/{pages}
            </span>
            <button type="button" className="msi-btn msi-btn-small" aria-label={t('instruments.wordGenerator.nextPage')} title={t('tip.wg.page')} disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>
              ▶
            </button>
          </div>
          {parsed.errors.length > 0 && <div className="msi-field-error">{parsed.errors[0]}</div>}
          <table className="msi-table msi-wordtable" aria-label={t('instruments.wordGenerator.wordPattern')}>
            <tbody>
              {rowsOnPage.map((w, j) => {
                const i = pg * PAGE + j;
                const cls = [i === current ? 'msi-row-cur' : '', i === selected ? 'msi-row-sel' : '', i < s.start || i > s.end ? 'msi-row-off' : ''].filter(Boolean).join(' ');
                return (
                  <tr key={i} className={cls || undefined} onClick={() => setSelected(i)}>
                    <th scope="row" className="msi-mono">
                      {i.toString(16).toUpperCase().padStart(addrDigits, '0')}
                    </th>
                    <td>
                      {display === 'hex' ? (
                        <HexCell value={w} bits={bits} onCommit={(nw) => setWord(i, nw)} label={t('instruments.wordGenerator.wordAtAddressI', { i: i })} />
                      ) : (
                        <span className="msi-bits" role="group" aria-label={t('instruments.wordGenerator.bitsOfWordI', { i: i })}>
                          {wordToBinary(w, bits)
                            .split('')
                            .map((ch, k) => {
                              const bit = bits - 1 - k;
                              return (
                                <button
                                  key={bit}
                                  type="button"
                                  className={`msi-bit${ch === '1' ? ' msi-bit-on' : ''}`}
                                  aria-label={t('instruments.wordGenerator.addressIBitBitCh', { i: i, bit: bit, ch: ch })} title={t('tip.wg.bit')}
                                  aria-pressed={ch === '1'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleBit(i, bit);
                                  }}
                                >
                                  {ch}
                                </button>
                              );
                            })}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
