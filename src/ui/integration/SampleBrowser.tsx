/**
 * Sample browser (File > Open samples; lazy chunk): every sample of examples/ by topic (Basics,
 * Semiconductors, Op-amps, Digital, Mixed signal, Power, RF, Instruments, Analyses, Hierarchy),
 * with a search box (Vietnamese with or without accents), a preview picture of the selected
 * sample (its first sheet drawn with the export renderer) and its Vietnamese / English summary.
 *
 * Opening a schematic sample loads it as a new document named after the file, its title and sheet
 * names in the UI language ("Trang 1"); a SPICE deck runs and shows its results in the Grapher.
 */
import { useEffect, useMemo, useState } from 'react';
import { serializeDesign } from '../../model/serialize';
import { parseDesignSafely } from '../../model/sanitize';
import { localizeNotes, localizeSample, sampleNotePairs } from './sampleLocalize';
import { SAMPLE_TEXT, SAMPLE_TOPIC_TEXT, SAMPLE_UI } from '../../i18n/samples';
import { interpolate, t, tr } from '../../i18n';
import { Dialog } from '../common/Dialog';
import { confirmDiscardChanges, loadDesignText } from '../app/document';
import { actions, partLookup } from '../store';
import type { SimulationIntegration } from './controller';
import { runSpiceText } from './commands';
import { exampleCatalog, sampleKey, SAMPLE_TOPICS, type ExampleEntry, type SampleTopic } from './examples';
import { openHelp } from '../help/open';

/** Title / summary of a sample in the current language. */
export function sampleTitle(e: Pick<ExampleEntry, 'file' | 'title'>): string {
  const text = SAMPLE_TEXT[sampleKey(e.file)];
  return text ? tr(text.title) : e.title;
}

function sampleSummary(e: Pick<ExampleEntry, 'file' | 'summary'>): string {
  const text = SAMPLE_TEXT[sampleKey(e.file)];
  return text ? tr(text.summary) : e.summary;
}

/** Lower-case text without Vietnamese diacritics (đ → d) for searching. */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
}

// localizeSample itself lives in sampleLocalize.ts, so a sample file opened by any other route
// (File > Open, a drop, the Explorer, a recent entry) gets the same title and sheet names
export { localizeSample };

/** Open a sample: designs become the document, SPICE decks run. */
export async function openSample(ctrl: SimulationIntegration, e: ExampleEntry): Promise<void> {
  if (e.kind === 'design') {
    if (!(await confirmDiscardChanges(t('integration.commands.openAnExample')))) return;
    if (ctrl.active) await ctrl.stop();
    const design = localizeSample(parseDesignSafely(await e.load()).design, sampleTitle(e));
    await loadDesignText(serializeDesign(design), e.file, null, true);
    actions.addSimMessage('info', t('integration.commands.openedExampleTitlePressRun', { title: sampleTitle(e) }), 'examples');
  } else {
    await runSpiceText(ctrl, await e.load(), e.file.replace(/^spice\//, ''));
  }
}

/** Preview picture (object URL of the first sheet's SVG) of a design sample. */
function usePreview(entry: ExampleEntry | undefined): { url: string | null; busy: boolean } {
  const [state, setState] = useState<{ file: string; url: string | null }>({ file: '', url: null });
  useEffect(() => {
    if (!entry || entry.kind !== 'design') return;
    let cancelled = false;
    let url: string | null = null;
    void (async () => {
      try {
        const [{ sheetToSvg }, text] = await Promise.all([import('../editor/exportImage'), entry.load()]);
        // the notes on the sheet follow the interface language, as they will in the opened design
        const design = localizeNotes(parseDesignSafely(text).design, await sampleNotePairs(entry.file));
        // a ladder sample is about its rungs: preview the ladder sheet, not the rack that feeds it
        const sheet = design.sheets.find((x) => x.kind === 'ladder' && (x.ladder?.length ?? 0) > 0) ?? design.sheets[0];
        const r = sheetToSvg(design, sheet.id, partLookup, { area: 'content', margin: 20 });
        url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
        if (!cancelled) setState({ file: entry.file, url });
      } catch {
        if (!cancelled) setState({ file: entry.file, url: null });
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entry]);
  if (!entry || entry.kind !== 'design') return { url: null, busy: false };
  return state.file === entry.file ? { url: state.url, busy: false } : { url: null, busy: true };
}

export function SampleBrowser({ ctrl, close }: { ctrl: SimulationIntegration; close: () => void }) {
  const catalog = useMemo(() => exampleCatalog(), []);
  const [topic, setTopic] = useState<SampleTopic | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>(catalog[0]?.file ?? '');
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return catalog.filter((e) => (topic === 'all' || e.topic === topic) && (!q || fold(`${sampleTitle(e)} ${sampleSummary(e)} ${e.title} ${e.file}`).includes(q)));
  }, [catalog, topic, query]);
  const current = shown.find((e) => e.file === selected) ?? shown[0];
  const preview = usePreview(current);
  const open = (e: ExampleEntry) => {
    close();
    void openSample(ctrl, e);
  };
  const topics = SAMPLE_TOPICS.filter((tp) => catalog.some((e) => e.topic === tp));
  return (
    <Dialog
      title={tr(SAMPLE_UI.title)}
      onClose={close}
      width={980}
      className="msx-samples-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" title={t('help.whatIsThis')} onClick={() => void openHelp({ kind: 'guide', page: 'samples' })}>
            ?
          </button>
          <span className="ms-hint msx-samples-hint">{current?.kind === 'spice' ? tr(SAMPLE_UI.hintSpice) : tr(SAMPLE_UI.hint)}</span>
          <button type="button" className="ms-btn" onClick={close}>
            {t('common.close')}
          </button>
          <button type="button" className="ms-btn ms-btn-primary" disabled={!current} onClick={() => current && open(current)}>
            {current?.kind === 'spice' ? tr(SAMPLE_UI.run) : tr(SAMPLE_UI.open)}
          </button>
        </>
      }
    >
      <div className="msx-samples">
        <nav className="msx-topics" aria-label={tr(SAMPLE_UI.title)}>
          <button type="button" className={`msx-topic${topic === 'all' ? ' msx-topic-on' : ''}`} onClick={() => setTopic('all')}>
            {tr(SAMPLE_UI.all)} <small>{catalog.length}</small>
          </button>
          {topics.map((tp) => (
            <button key={tp} type="button" className={`msx-topic${topic === tp ? ' msx-topic-on' : ''}`} title={tr(SAMPLE_TOPIC_TEXT[tp].desc)} onClick={() => setTopic(tp)}>
              {tr(SAMPLE_TOPIC_TEXT[tp].title)} <small>{catalog.filter((e) => e.topic === tp).length}</small>
            </button>
          ))}
        </nav>
        <div className="msx-sample-list">
          <input className="ms-input msx-sample-search" type="search" value={query} placeholder={tr(SAMPLE_UI.search)} aria-label={tr(SAMPLE_UI.search)} onChange={(e) => setQuery(e.target.value)} data-autofocus />
          <div className="ms-hint">{interpolate(tr(SAMPLE_UI.count), { n: shown.length })}</div>
          <div role="listbox" aria-label={tr(SAMPLE_UI.title)} className="msx-examples">
            {shown.length ? null : <div className="ms-empty">{tr(SAMPLE_UI.none)}</div>}
            {shown.map((e) => (
              <button
                key={e.file}
                type="button"
                role="option"
                aria-selected={current?.file === e.file}
                className={`msx-example${current?.file === e.file ? ' msx-example-on' : ''}`}
                onClick={() => setSelected(e.file)}
                onDoubleClick={() => open(e)}
              >
                <b>{sampleTitle(e)}</b>
                <em>{tr(SAMPLE_TOPIC_TEXT[e.topic].title)}</em>
                <small>{sampleSummary(e)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="msx-sample-preview">
          {current ? (
            <>
              <h3>{sampleTitle(current)}</h3>
              <div className="msx-preview-box">
                {current.kind === 'spice' ? <p className="ms-hint">{tr(SAMPLE_UI.noPreview)}</p> : preview.url ? <img src={preview.url} alt={sampleTitle(current)} /> : <p className="ms-hint">{tr(SAMPLE_UI.previewing)}</p>}
              </div>
              <p>{sampleSummary(current)}</p>
              <p className="ms-hint">
                {current.kind === 'spice' ? tr(SAMPLE_UI.kindSpice) : tr(SAMPLE_UI.kindDesign)} · {tr(SAMPLE_TOPIC_TEXT[current.topic].title)} · <span className="ms-mono">{current.file}</span>
              </p>
            </>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
