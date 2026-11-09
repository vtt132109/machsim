/**
 * PCB transmission-line / differential impedance calculator (Tools > Circuit wizards): line type,
 * geometry and laminate in, Z0 / Zdiff, effective permittivity, delay and per-length C and L out
 * (src/model/wizards/pcbImpedance.ts); "width for a target impedance" solves the trace width.
 * A cross-section sketch shows which dimension is which. Lengths in mm or mil.
 */
import { useMemo, useState } from 'react';
import { LINE_KINDS, lineImpedance, widthForImpedance, type LineKind } from '../../model/wizards/pcbImpedance';
import { formatEng } from '../../util/units';
import { Dialog } from '../common/Dialog';
import { FieldRow, Group, NumField, SelectField } from '../analysis/fields';
import { t, tDynamic } from '../../i18n';

const MIL = 0.0254;

/** Common laminates (published typical εr at 1 GHz). */
const LAMINATES: [string, number][] = [
  ['fr4', 4.4],
  ['fr4hf', 4.0],
  ['rogers4003', 3.55],
  ['ptfe', 2.2],
  ['alumina', 9.8],
];

function CrossSection({ kind }: { kind: LineKind }) {
  const strip = kind === 'stripline' || kind === 'diff-stripline';
  const pair = kind === 'diff-microstrip' || kind === 'diff-stripline';
  const cpw = kind === 'cpw' || kind === 'gcpw';
  const ground = kind !== 'cpw';
  const embedded = kind === 'embedded';
  const traces = pair ? [70, 130] : [100];
  const ty = strip ? 46 : 26;
  return (
    <svg className="msw-xsect" viewBox="0 0 240 90" role="img" aria-label={t('wizard.pcb.sectionAria')}>
      <rect x="10" y="30" width="220" height={strip ? 40 : 40} className="msw-xs-dielectric" />
      {embedded && <rect x="10" y="12" width="220" height="18" className="msw-xs-dielectric msw-xs-cover" />}
      {ground && <rect x="10" y="70" width="220" height="5" className="msw-xs-copper" />}
      {strip && <rect x="10" y="10" width="220" height="20" className="msw-xs-dielectric" />}
      {strip && <rect x="10" y="5" width="220" height="5" className="msw-xs-copper" />}
      {traces.map((x) => (
        <rect key={x} x={x - 20} y={ty - 4} width="40" height="4" className="msw-xs-copper" />
      ))}
      {cpw && <rect x="10" y={ty - 4} width="58" height="4" className="msw-xs-copper" />}
      {cpw && <rect x="172" y={ty - 4} width="58" height="4" className="msw-xs-copper" />}
      <text x={traces[0]} y={ty - 8} textAnchor="middle" className="msw-xs-label">
        W
      </text>
      {pair && (
        <text x="100" y={ty - 8} textAnchor="middle" className="msw-xs-label">
          S
        </text>
      )}
      {cpw && (
        <text x="74" y={ty - 8} textAnchor="middle" className="msw-xs-label">
          S
        </text>
      )}
      <text x="236" y={strip ? 40 : 52} textAnchor="end" className="msw-xs-label">
        {strip ? 'B' : 'H'}
      </text>
    </svg>
  );
}

export function PcbCalculator({ close }: { close: () => void }) {
  const [kind, setKind] = useState<LineKind>('microstrip');
  const [unit, setUnit] = useState<'mm' | 'mil'>('mm');
  const [w, setW] = useState<number | undefined>(3);
  const [h, setH] = useState<number | undefined>(1.6);
  const [th, setTh] = useState<number | undefined>(0.035);
  const [s, setS] = useState<number | undefined>(0.2);
  const [cover, setCover] = useState<number | undefined>(0.1);
  const [er, setEr] = useState<number | undefined>(4.4);
  const [target, setTarget] = useState<number | undefined>(50);
  const k = unit === 'mil' ? MIL : 1;
  const geom = { w: (w ?? NaN) * k, h: (h ?? NaN) * k, t: (th ?? 0) * k, s: (s ?? NaN) * k, cover: (cover ?? 0) * k, er: er ?? NaN };
  const diff = kind === 'diff-microstrip' || kind === 'diff-stripline';
  const usesS = diff || kind === 'cpw' || kind === 'gcpw';
  const valid = geom.w > 0 && geom.h > 0 && geom.er >= 1 && (!usesS || geom.s > 0);
  const res = useMemo(() => (valid ? lineImpedance(kind, geom) : null), [valid, kind, geom.w, geom.h, geom.t, geom.s, geom.cover, geom.er]);
  const solved = useMemo(() => (valid && target && target > 0 ? widthForImpedance(kind, geom, target) : null), [valid, kind, target, geom.h, geom.t, geom.s, geom.cover, geom.er]);
  const len = (x: number) => `${Number((x / k).toPrecision(4))} ${unit}`;
  return (
    <Dialog title={t('wizard.pcb.title')} onClose={close} width={820} footer={<button type="button" className="ms-btn" onClick={close}>{t('common.close')}</button>}>
      <p className="msa-note">{t('wizard.pcb.intro')}</p>
      <div className="msw-body">
        <div className="msw-form">
          <SelectField label={t('wizard.pcb.kind')} help={t('tip.wizard.pcb.kind')} value={kind} options={LINE_KINDS.map((x) => [x, tDynamic(`wizard.pcb.kind.${x}`)] as const)} onChange={setKind} />
          <SelectField
            label={t('wizard.pcb.unit')}
            help={t('tip.wizard.pcb.unit')}
            value={unit}
            options={[
              ['mm', 'mm'],
              ['mil', 'mil'],
            ]}
            onChange={setUnit}
          />
          <Group title={t('wizard.pcb.geometry')}>
            <FieldRow>
              <NumField label={t('wizard.pcb.w')} help={t('tip.wizard.pcb.w')} unit={unit} value={w} onChange={setW} min={0} exclusiveMin size={7} />
              <NumField label={kind === 'stripline' || kind === 'diff-stripline' ? t('wizard.pcb.b') : t('wizard.pcb.h')} help={t('tip.wizard.pcb.h')} unit={unit} value={h} onChange={setH} min={0} exclusiveMin size={7} />
            </FieldRow>
            <FieldRow>
              <NumField label={t('wizard.pcb.t')} help={t('tip.wizard.pcb.t')} unit={unit} value={th} onChange={setTh} min={0} size={7} />
              {usesS && <NumField label={diff ? t('wizard.pcb.spacing') : t('wizard.pcb.gap')} help={t('tip.wizard.pcb.s')} unit={unit} value={s} onChange={setS} min={0} exclusiveMin size={7} />}
              {kind === 'embedded' && <NumField label={t('wizard.pcb.cover')} help={t('tip.wizard.pcb.cover')} unit={unit} value={cover} onChange={setCover} min={0} size={7} />}
            </FieldRow>
          </Group>
          <Group title={t('wizard.pcb.material')}>
            <NumField label={t('wizard.pcb.er')} help={t('tip.wizard.pcb.er')} value={er} onChange={setEr} min={1} max={100} size={6} />
            <div className="msw-chips">
              {LAMINATES.map(([id, v]) => (
                <button key={id} type="button" className={`ms-btn ms-btn-small${er === v ? ' is-on' : ''}`} onClick={() => setEr(v)} title={t('tip.wizard.pcb.laminate')}>
                  {tDynamic(`wizard.pcb.lam.${id}`)} ({v})
                </button>
              ))}
            </div>
          </Group>
        </div>
        <div className="msw-output">
          <CrossSection kind={kind} />
          {!valid && <p className="msw-error">{t('wizard.pcb.invalid')}</p>}
          {res && (
            <table className="msw-table" aria-label={t('wizard.pcb.resultsTitle')}>
              <caption>{t('wizard.pcb.resultsTitle')}</caption>
              <tbody>
                <tr>
                  <th scope="row">{t('wizard.pcb.z0')}</th>
                  <td className="msw-num">{formatEng(res.z0, 'Ω', 4)}</td>
                </tr>
                {res.zdiff !== undefined && (
                  <tr>
                    <th scope="row">{t('wizard.pcb.zdiff')}</th>
                    <td className="msw-num">{formatEng(res.zdiff, 'Ω', 4)}</td>
                  </tr>
                )}
                <tr>
                  <th scope="row">{t('wizard.pcb.eeff')}</th>
                  <td className="msw-num">{res.eeff.toFixed(3)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('wizard.pcb.delay')}</th>
                  <td className="msw-num">{`${res.delay.toFixed(3)} ps/mm`}</td>
                </tr>
                <tr>
                  <th scope="row">{t('wizard.pcb.cpl')}</th>
                  <td className="msw-num">{formatEng(res.cPerMm * 1e-12, 'F/mm', 4)}</td>
                </tr>
                <tr>
                  <th scope="row">{t('wizard.pcb.lpl')}</th>
                  <td className="msw-num">{formatEng(res.lPerMm * 1e-9, 'H/mm', 4)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {res?.warning && <p className="msw-warnings">{t('wizard.pcb.range')}</p>}
          <Group title={t('wizard.pcb.solveTitle')}>
            <NumField label={diff ? t('wizard.pcb.targetDiff') : t('wizard.pcb.target')} help={t('tip.wizard.pcb.target')} unit="Ω" value={target} onChange={setTarget} min={1} size={6} />
            <p className="msw-solve" role="status">
              {solved === null ? t('wizard.pcb.noSolution') : t('wizard.pcb.solved', { w: len(solved) })}
            </p>
            {solved !== null && (
              <button type="button" className="ms-btn ms-btn-small" onClick={() => setW(Number((solved / k).toPrecision(4)))} title={t('tip.wizard.pcb.useWidth')}>
                {t('wizard.pcb.useWidth')}
              </button>
            )}
          </Group>
          <p className="msa-hint">{tDynamic(`wizard.pcb.formula.${kind}`)}</p>
        </div>
      </div>
    </Dialog>
  );
}
