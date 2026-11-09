/**
 * Matching-network designer of the network analyzer (display mode "match"): works on the
 * S-parameters at the marker frequency (full two-port sweep needed).
 *
 *   stability    K, |Δ|, μ and the source / load stability circles drawn on the Smith chart
 *   conjugate    simultaneous conjugate match Γ_S, Γ_L (K > 1) and the lumped L-sections that
 *                present them, built from the 50 Ω (Z0) ports
 *   unilateral   unilateral design (S12 ≈ 0): G_S max, G_L max, |S21|², the figure of merit U with
 *                its error bounds, and constant-gain circles for the requested G_S / G_L (dB);
 *                the point of each circle nearest the chart centre is matched with an L-section
 * Params (saved with the instrument): match.mode, match.gs, match.gl (dB).
 */
import { formatEng, parseUserNumber } from '../../util/units';
import { cabs, cargDeg, gammaToZ, type Complex, type TwoPort } from './network';
import {
  conjugateMatch,
  matchToGamma,
  stabilityCircles,
  unilateralFigure,
  unilateralGainCircle,
  unilateralMax,
  type GammaCircle,
  type LNetwork,
} from './matching';
import { NumberField, Readout, Section, Segmented } from './panelKit';
import { t, tDynamic } from '../../i18n';

export type MatchMode = 'stability' | 'conjugate' | 'unilateral';

export interface SmithOverlay {
  circles: { circle: GammaCircle; dashed?: boolean; label?: string; colorIndex?: number }[];
  points: { g: Complex; label: string }[];
}

function mode(params: Record<string, string>): MatchMode {
  const m = (params['match.mode'] ?? 'stability').trim();
  return m === 'conjugate' || m === 'unilateral' ? m : 'stability';
}

function dbParam(params: Record<string, string>, key: string, fallback: number): number {
  const v = parseUserNumber(params[key] ?? '');
  return Number.isFinite(v) ? v : fallback;
}

/** Point of a circle nearest the chart centre (Γ = 0). */
function nearestToCentre(c: GammaCircle): Complex {
  const d = cabs(c.center);
  if (d <= c.radius || d === 0) return { re: 0, im: 0 };
  const k = (d - c.radius) / d;
  return { re: c.center.re * k, im: c.center.im * k };
}

/** Requested unilateral gain circles (clamped to the section maxima). */
function unilateralCircles(s: TwoPort, params: Record<string, string>) {
  const gsMax = 10 * Math.log10(unilateralMax(s.p11));
  const glMax = 10 * Math.log10(unilateralMax(s.p22));
  const gs = Math.min(dbParam(params, 'match.gs', Math.max(0, gsMax - 1)), gsMax);
  const gl = Math.min(dbParam(params, 'match.gl', Math.max(0, glMax - 1)), glMax);
  return { gsMax, glMax, gs, gl, cs: unilateralGainCircle(s.p11, 10 ** (gs / 10)), cl: unilateralGainCircle(s.p22, 10 ** (gl / 10)) };
}

/** Circles and points to draw on the Smith chart for the current designer mode. */
export function matchOverlay(s: TwoPort, params: Record<string, string>): SmithOverlay {
  const m = mode(params);
  if (m === 'stability') {
    const st = stabilityCircles(s);
    return {
      circles: [
        { circle: st.source, dashed: true, label: t('match.sourceCircle'), colorIndex: 2 },
        { circle: st.load, dashed: true, label: t('match.loadCircle'), colorIndex: 3 },
      ],
      points: [],
    };
  }
  if (m === 'conjugate') {
    const cm = conjugateMatch(s);
    return cm ? { circles: [], points: [{ g: cm.gs, label: 'ΓS' }, { g: cm.gl, label: 'ΓL' }] } : { circles: [], points: [] };
  }
  const u = unilateralCircles(s, params);
  const circles: SmithOverlay['circles'] = [];
  const points: SmithOverlay['points'] = [];
  if (u.cs) {
    circles.push({ circle: u.cs, label: `GS ${u.gs.toFixed(1)} dB`, colorIndex: 2 });
    points.push({ g: nearestToCentre(u.cs), label: 'ΓS' });
  }
  if (u.cl) {
    circles.push({ circle: u.cl, label: `GL ${u.gl.toFixed(1)} dB`, colorIndex: 3 });
    points.push({ g: nearestToCentre(u.cl), label: 'ΓL' });
  }
  return { circles, points };
}

const polar = (g: Complex) => `${cabs(g).toFixed(3)} ∠ ${cargDeg(g).toFixed(1)}°`;
const zText = (z: Complex) => `${formatEng(z.re, '', 4)} ${z.im < 0 ? '−' : '+'} j${formatEng(Math.abs(z.im), '', 4)} Ω`;
const db = (x: number) => `${(10 * Math.log10(x)).toFixed(2)} dB`;

function NetworkList({ title, nets }: { title: string; nets: LNetwork[] }) {
  return (
    <div className="msi-match-nets">
      <div className="msi-field-label">{title}</div>
      {nets.length === 0 && <div className="msi-dim">{t('match.noNetwork')}</div>}
      <ol>
        {nets.map((n, i) => (
          <li key={i}>
            {n.elements.length === 0
              ? t('match.direct')
              : n.elements.map((e, k) => (
                  <span key={k}>
                    {k > 0 ? ' → ' : ''}
                    {tDynamic(`match.el.${e.position}`)} {e.kind === 'L' ? formatEng(e.value, 'H', 4) : formatEng(e.value, 'F', 4)}
                  </span>
                ))}
            {n.elements.length > 0 && <span className="msi-dim"> → Z0</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface MatchDesignerProps {
  s: TwoPort | null;
  z0: number;
  freq: number;
  params: Record<string, string>;
  onParamsChange(next: Record<string, string>): void;
}

export function MatchDesigner({ s, z0, freq, params, onParamsChange }: MatchDesignerProps) {
  const m = mode(params);
  const set = (k: string, v: string) => onParamsChange({ ...params, [k]: v });
  return (
    <Section title={t('match.title', { f: formatEng(freq, 'Hz', 4) })} className="msi-match">
      <Segmented
        small
        value={m}
        options={[
          ['stability', t('match.mode.stability'), t('tip.match.stability')],
          ['conjugate', t('match.mode.conjugate'), t('tip.match.conjugate')],
          ['unilateral', t('match.mode.unilateral'), t('tip.match.unilateral')],
        ]}
        onChange={(v) => set('match.mode', v)}
        title={t('tip.match.mode')}
      />
      {!s && <div className="msi-note">{t('match.needFull')}</div>}
      {s && m === 'stability' && <StabilityView s={s} />}
      {s && m === 'conjugate' && <ConjugateView s={s} z0={z0} freq={freq} />}
      {s && m === 'unilateral' && <UnilateralView s={s} z0={z0} freq={freq} params={params} set={set} />}
    </Section>
  );
}

function StabilityView({ s }: { s: TwoPort }) {
  const st = stabilityCircles(s);
  return (
    <>
      <div className="msi-row msi-secondary">
        <Readout label="K" value={Number.isFinite(st.k) ? st.k.toFixed(3) : '—'} />
        <Readout label="|Δ|" value={st.delta.toFixed(3)} />
        <Readout label="μ" value={Number.isFinite(st.mu) ? st.mu.toFixed(3) : '—'} />
        <Readout label={t('instruments.networkAnalyzer.stability')} value={st.unconditional ? t('instruments.networkAnalyzer.unconditional') : t('instruments.networkAnalyzer.potentiallyUnstable')} />
      </div>
      <table className="msi-table" aria-label={t('match.circlesAria')}>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">{t('match.center')}</th>
            <th scope="col">{t('match.radius')}</th>
            <th scope="col">{t('match.stableRegion')}</th>
          </tr>
        </thead>
        <tbody>
          {(['source', 'load'] as const).map((k) => (
            <tr key={k}>
              <th scope="row">{k === 'source' ? t('match.sourceCircle') : t('match.loadCircle')}</th>
              <td className="msi-num">{polar(st[k].center)}</td>
              <td className="msi-num">{st[k].radius.toFixed(3)}</td>
              <td>{st[k].stableInside ? t('match.inside') : t('match.outside')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="msi-dim">{st.unconditional ? t('match.explainStable') : t('match.explainUnstable')}</p>
    </>
  );
}

function ConjugateView({ s, z0, freq }: { s: TwoPort; z0: number; freq: number }) {
  const cm = conjugateMatch(s);
  if (!cm) return <div className="msi-note">{t('match.noConjugate')}</div>;
  const zs = gammaToZ(cm.gs, z0);
  const zl = gammaToZ(cm.gl, z0);
  return (
    <>
      <div className="msi-row msi-secondary">
        <Readout label="ΓS" value={polar(cm.gs)} />
        <Readout label="ZS" value={zText(zs)} />
        <Readout label="ΓL" value={polar(cm.gl)} />
        <Readout label="ZL" value={zText(zl)} />
        <Readout label={t('match.gtMax')} value={db(cm.gain)} />
      </div>
      <div className="msi-row">
        <NetworkList title={t('match.inputNetwork')} nets={matchToGamma(cm.gs, z0, freq)} />
        <NetworkList title={t('match.outputNetwork')} nets={matchToGamma(cm.gl, z0, freq)} />
      </div>
      <p className="msi-dim">{t('match.explainConjugate')}</p>
    </>
  );
}

function UnilateralView({ s, z0, freq, params, set }: { s: TwoPort; z0: number; freq: number; params: Record<string, string>; set: (k: string, v: string) => void }) {
  const u = unilateralCircles(s, params);
  const fom = unilateralFigure(s);
  const g0 = cabs(s.p21) ** 2;
  const gsPt = u.cs ? nearestToCentre(u.cs) : null;
  const glPt = u.cl ? nearestToCentre(u.cl) : null;
  return (
    <>
      <div className="msi-row msi-secondary">
        <Readout label={t('match.gsMax')} value={`${u.gsMax.toFixed(2)} dB`} />
        <Readout label={t('match.glMax')} value={`${u.glMax.toFixed(2)} dB`} />
        <Readout label="|S21|²" value={db(g0)} />
        <Readout label="U" value={fom.u.toFixed(4)} />
        <Readout label={t('match.uBounds')} value={`${fom.lowDb.toFixed(2)} … ${Number.isFinite(fom.highDb) ? fom.highDb.toFixed(2) : '∞'} dB`} />
      </div>
      <div className="msi-row">
        <NumberField label={t('match.gs')} value={params['match.gs'] ?? String(Number(Math.max(0, u.gsMax - 1).toFixed(1)))} unit="dB" max={u.gsMax} onCommit={(v) => set('match.gs', v)} title={t('tip.match.gs')} size={6} />
        <NumberField label={t('match.gl')} value={params['match.gl'] ?? String(Number(Math.max(0, u.glMax - 1).toFixed(1)))} unit="dB" max={u.glMax} onCommit={(v) => set('match.gl', v)} title={t('tip.match.gl')} size={6} />
        <Readout label={t('match.gtu')} value={`${(10 * Math.log10(g0) + u.gs + u.gl).toFixed(2)} dB`} />
      </div>
      <div className="msi-row">
        {gsPt && <NetworkList title={t('match.inputNetworkAt', { g: polar(gsPt) })} nets={matchToGamma(gsPt, z0, freq)} />}
        {glPt && <NetworkList title={t('match.outputNetworkAt', { g: polar(glPt) })} nets={matchToGamma(glPt, z0, freq)} />}
      </div>
      <p className="msi-dim">{t('match.explainUnilateral')}</p>
    </>
  );
}
