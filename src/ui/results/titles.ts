/**
 * Analysis result titles in the current language and the internal-vector rule (light module: no
 * plotting code, so the shell, the Simulation tab, the analysis dialog and the controller can use
 * them without loading the Grapher).
 *
 *   analysisTypeTitle('tran')                          // "Phân tích quá độ" / "Transient analysis"
 *   localizeResultTitle('DC sweep (R1=2k)', 'dc')       // "Quét DC (R1=2k)"
 *
 * The engine titles its results in English (src/sim/engine/titles.ts); a title that is the
 * engine's default for the type, optionally followed by " (detail)", is replaced by the
 * catalogue name (results.type.<type>). Titles the user chose are kept as they are.
 */
import { tDynamic } from '../../i18n';
import { analysisTitle as engineAnalysisTitle } from '../../sim/engine/titles';

const TYPE_KEYS = new Set(['op', 'dc', 'ac', 'acsingle', 'tran', 'noise', 'tf', 'sens', 'pz', 'four', 'disto', 'noisefig', 'paramsweep', 'tempsweep', 'montecarlo', 'worstcase', 'nestedsweep', 'tracewidth', 'batch', 'user']);

/** Display name of an analysis type in the current language. */
export function analysisTypeTitle(type: string): string {
  return TYPE_KEYS.has(type) ? tDynamic(`results.type.${type}`) : type;
}

/**
 * Result title in the current language: the engine's default English title of the result type
 * (optionally followed by a detail such as " (V1=1)") is replaced by the localized name.
 */
export function localizeResultTitle(title: string, type: string): string {
  if (!TYPE_KEYS.has(type)) return title;
  const engine = engineAnalysisTitle(type);
  if (!title || title === engine) return analysisTypeTitle(type);
  if (title.startsWith(`${engine} (`)) return analysisTypeTitle(type) + title.slice(engine.length);
  return title;
}

/**
 * True for helper vectors MachSim adds itself and a learner did not ask for: currents / powers of
 * the netlister's helper elements (0 V current-sense sources such as V_LED1_i, function-generator
 * outputs V_XFG1_p, supply rails V_PWR_VCC) and voltages of nodes inside a part (LED1.a) or of
 * open-pin nodes (NC_R1_2). Probe currents (V_PR_<name>) stay visible, and so do postprocessor
 * expressions (names that are not a single simulator vector).
 */
export function isInternalVector(name: string): boolean {
  const n = name.trim();
  const m = n.match(/^(\w+)\(([^()]*)\)$/);
  // postprocessor expressions ("V(out) - tran1.V(out)") are never helper vectors
  if (!m && !/^[\w#.:$@]+$/.test(n)) return false;
  const fn = m ? m[1].toLowerCase() : '';
  const args = (m ? m[2] : name).split(',').map((a) => a.trim());
  for (const a of args) {
    if (a.includes('.') || /^NC_/i.test(a)) return true;
    if (fn !== 'v' && /^[A-Z]_(?!PR_)[A-Za-z0-9]+_\w+$/i.test(a)) return true;
  }
  return false;
}
