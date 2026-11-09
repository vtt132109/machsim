/**
 * Footprint manager (lazy chunk, command tools.footprints; the component wizard opens it to pick a
 * footprint): the list of footprints with their pad count, pitch and body size, a 2D outline
 * preview drawn from src/library/footprints.ts, and which library parts use the one selected.
 *
 *   openFootprintManager({ onPick })  `onPick` turns the dialog into a picker ("Use this footprint")
 */
import { useMemo, useState } from 'react';
import { FOOTPRINT_FAMILIES, footprintOutline, getFootprint, listFootprints, type Footprint, type FootprintKind } from '../../library/footprints';
import { listParts } from '../../library';
import { Dialog } from '../common/Dialog';
import { openCustomDialog } from '../common/dialogs';
import { openHelp } from '../help/open';
import { partName } from '../../i18n/library';
import { tr } from '../../i18n/core';
import { t } from '../../i18n';
import { stt } from '../../i18n/schematicToolsText';
import './schematicTools.css';

const FAMILY_TEXT: Record<FootprintKind, Parameters<typeof stt>[0]> = {
  dip: 'fpFamilyDip',
  soic: 'fpFamilySoic',
  sip: 'fpFamilySip',
  axial: 'fpFamilyAxial',
  radial: 'fpFamilyRadial',
  chip: 'fpFamilyChip',
  do: 'fpFamilyDo',
  to: 'fpFamilyTo',
  sot: 'fpFamilySot',
  connector: 'fpFamilyConnector',
  display: 'fpFamilyDisplay',
  other: 'fpFamilyOther',
};

/** The land pattern as an SVG picture (1 mm = 6 px, pin 1 marked). */
export function FootprintPreview({ fp, scale = 6 }: { fp: Footprint; scale?: number }) {
  const o = footprintOutline(fp);
  const pad = 1.5;
  const vb = { x: o.bounds.x - pad, y: o.bounds.y - pad, w: o.bounds.w + 2 * pad, h: o.bounds.h + 2 * pad };
  return (
    <svg
      className="ms-st-fp-view"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      width={Math.min(360, Math.max(80, vb.w * scale))}
      height={Math.min(260, Math.max(60, vb.h * scale))}
      role="img"
      aria-label={stt('fpPreview')}
    >
      <rect className="ms-st-fp-body" x={o.body.x} y={o.body.y} width={o.body.w} height={o.body.h} rx={0.4} />
      {o.pads.map((p) =>
        p.shape === 'round' ? (
          <circle key={p.number} className={`ms-st-fp-pad${p.number === '1' ? ' is-first' : ''}`} cx={p.x} cy={p.y} r={Math.max(0.35, p.w / 2)} />
        ) : (
          <rect key={p.number} className={`ms-st-fp-pad${p.number === '1' ? ' is-first' : ''}`} x={p.x - p.w / 2} y={p.y - p.h / 2} width={p.w} height={p.h} rx={0.1} />
        ),
      )}
      {o.pads.length ? <text className="ms-st-fp-num" x={o.pads[0].x} y={o.pads[0].y - Math.max(0.8, o.pads[0].h)} textAnchor="middle">1</text> : null}
    </svg>
  );
}

function describe(fp: Footprint): string {
  const bits = [stt(fp.pins ? 'fpPins' : 'fpNoPins', { n: fp.pins })];
  if (fp.pitch !== undefined) bits.push(stt('fpPitch', { v: fp.pitch }));
  const mm = (v: number) => String(Math.round(v * 100) / 100);
  bits.push(stt('fpBody', { w: mm(fp.body.w), h: mm(fp.body.h) }));
  bits.push(stt(fp.smd ? 'fpSmd' : 'fpThrough'));
  return bits.join(' · ');
}

function FootprintManager({ onPick, initial, close }: { onPick?: (name: string) => void; initial?: string; close: () => void }) {
  const all = useMemo(listFootprints, []);
  const [family, setFamily] = useState<FootprintKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string>(initial && getFootprint(initial) ? getFootprint(initial)!.name : all[0].name);
  const needle = query.trim().toLowerCase();
  const shown = all.filter((f) => (family === 'all' || f.kind === family) && (!needle || f.name.toLowerCase().includes(needle) || tr(f.text).toLowerCase().includes(needle)));
  const fp = getFootprint(selected) ?? shown[0] ?? all[0];
  const users = useMemo(() => listParts().filter((p) => p.footprint?.toLowerCase() === fp.name.toLowerCase()), [fp.name]);

  return (
    <Dialog
      title={stt('fpTitle')}
      onClose={close}
      width={760}
      className="ms-st-dialog"
      footer={
        <>
          <button type="button" className="ms-btn" onClick={() => openHelp({ kind: 'guide', page: 'footprints' })}>
            {t('help.whatIsThis')}
          </button>
          <span className="ms-st-spacer" />
          {onPick ? (
            <button
              type="button"
              className="ms-btn ms-btn-primary"
              onClick={() => {
                onPick(fp.name);
                close();
              }}
            >
              {stt('fpPick')}
            </button>
          ) : null}
          <button type="button" className="ms-btn" onClick={close}>
            {onPick ? t('common.cancel') : t('common.close')}
          </button>
        </>
      }
    >
      <p className="ms-hint">{stt('fpIntro')}</p>
      <div className="ms-st-row">
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{stt('fpSearch')}</span>
          <input className="ms-input" value={query} onChange={(e) => setQuery(e.target.value)} data-autofocus />
        </label>
        <label className="ms-cfield ms-cfield-row">
          <span className="ms-cfield-label">{stt('fpFamily')}</span>
          <select className="ms-input" value={family} onChange={(e) => setFamily(e.target.value as FootprintKind | 'all')}>
            <option value="all">{stt('fpAll')}</option>
            {FOOTPRINT_FAMILIES.map((k) => (
              <option key={k} value={k}>
                {stt(FAMILY_TEXT[k])}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ms-st-fp-main">
        <ul className="ms-st-fp-list" role="listbox" aria-label={stt('fpTitle')}>
          {shown.map((f) => (
            <li key={f.name}>
              <button type="button" role="option" aria-selected={f.name === fp.name} className={`ms-st-fp-item${f.name === fp.name ? ' is-sel' : ''}`} onClick={() => setSelected(f.name)}>
                <b>{f.name}</b>
                <small>{stt(f.pins ? 'fpPins' : 'fpNoPins', { n: f.pins })}</small>
              </button>
            </li>
          ))}
        </ul>
        <div className="ms-st-fp-detail">
          <h4>{fp.name}</h4>
          <p>{tr(fp.text)}</p>
          <p className="ms-st-dim">{describe(fp)}</p>
          <FootprintPreview fp={fp} />
          <p className="ms-st-dim">{users.length ? stt('fpUsedBy', { n: users.length }) : stt('fpUsedNone')}</p>
          {users.length ? <p className="ms-st-dim">{users.slice(0, 12).map((p) => partName(p)).join(', ') + (users.length > 12 ? ' …' : '')}</p> : null}
        </div>
      </div>
    </Dialog>
  );
}

export function openFootprintManager(opts: { onPick?: (name: string) => void; initial?: string } = {}): void {
  openCustomDialog((close) => <FootprintManager onPick={opts.onPick} initial={opts.initial} close={close} />);
}
