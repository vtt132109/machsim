/**
 * Number formatting shared by the analyses (pure; no engine imports, so UI code that only needs
 * labels does not pull the simulator into its bundle).
 */

/** Compact display of a number for labels ("1000", "0.0015", "1e-09"). */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const s = v.toPrecision(6);
  if (s.includes('e')) {
    const [mant, exp] = s.split('e');
    return `${mant.includes('.') ? mant.replace(/\.?0+$/, '') : mant}e${exp}`;
  }
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
